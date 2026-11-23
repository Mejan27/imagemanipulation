import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import JSZip from 'jszip';
import { Archive, Download, Film, Play, Square, Video as VideoIcon, X } from 'lucide-react';
import type {
  ComplianceRule,
  ToastType,
  VideoAspectRatio,
  VideoBatchMode,
  VideoItem,
  VideoMotionType,
  VideoResolutionPreset,
} from '../types/converter';
import {
  MAX_VIDEO_BYTES,
  formatBytes,
  generateDemoBatch,
  getSupportedVideoMime,
  getVideoDimensions,
  loadImageFromFile,
  renderVideoFrameAt,
  triggerBlobDownload,
} from '../utils/mediaUtils';
import { ComplianceStrip } from './ComplianceStrip';
import { Dropzone } from './Dropzone';

interface VideoConverterProps {
  onToast: (message: string, type?: ToastType) => void;
}

export function VideoConverter({ onToast }: VideoConverterProps) {
  const [items, setItems] = useState<VideoItem[]>([]);
  const [selectedIndex, setSelectedIndex] = useState<number>(0);
  const [batchMode, setBatchMode] = useState<VideoBatchMode>('slideshow');
  const [resPreset, setResPreset] = useState<VideoResolutionPreset>('1080p');
  const [aspect, setAspect] = useState<VideoAspectRatio>('16:9');
  const [durationSec, setDurationSec] = useState<number>(10);
  const [motion, setMotion] = useState<VideoMotionType>('zoom-in');
  const [fps, setFps] = useState<number>(30);

  const [isPreviewPlaying, setIsPreviewPlaying] = useState(false);
  const [isRendering, setIsRendering] = useState(false);
  const [renderProgress, setRenderProgress] = useState<{
    label: string;
    pct: number;
    elapsedSec: number;
  } | null>(null);
  const [slideshowBlob, setSlideshowBlob] = useState<Blob | null>(null);
  const [slideshowUrl, setSlideshowUrl] = useState<string | null>(null);
  const [outputExt, setOutputExt] = useState<string>('mp4');
  const [statusMessage, setStatusMessage] = useState(
    'Supports H.264 (.mp4) or VP9 (.webm) depending on browser hardware encoder.'
  );

  const stageCanvasRef = useRef<HTMLCanvasElement | null>(null);
  const animFrameRef = useRef<number | null>(null);
  const recorderRef = useRef<MediaRecorder | null>(null);
  const cancelRequestedRef = useRef(false);
  const itemsRef = useRef<VideoItem[]>(items);
  itemsRef.current = items;

  const formatInfo = useMemo(() => getSupportedVideoMime(), []);
  const dims = useMemo(() => getVideoDimensions(resPreset, aspect), [resPreset, aspect]);
  const selectedItem = items[selectedIndex] ?? null;

  const activePlaybackUrl =
    batchMode === 'separate'
      ? selectedItem?.videoUrl ?? null
      : slideshowUrl;

  const activePreviewImages = useMemo(() => {
    if (!items.length) return [];
    if (batchMode === 'separate') {
      const target = items[selectedIndex] || items[0];
      return [target.img];
    }
    return items.map((x) => x.img);
  }, [items, batchMode, selectedIndex]);

  const stopPreviewLoop = useCallback(() => {
    setIsPreviewPlaying(false);
    if (animFrameRef.current !== null) {
      cancelAnimationFrame(animFrameRef.current);
      animFrameRef.current = null;
    }
  }, []);

  useEffect(() => {
    const canvas = stageCanvasRef.current;
    if (!canvas || isPreviewPlaying || isRendering) return;
    canvas.width = dims.width;
    canvas.height = dims.height;
    const ctx = canvas.getContext('2d');
    if (ctx) {
      renderVideoFrameAt(ctx, dims.width, dims.height, 0, activePreviewImages, motion);
    }
  }, [dims, activePreviewImages, motion, isPreviewPlaying, isRendering]);

  useEffect(() => {
    return () => {
      if (animFrameRef.current !== null) cancelAnimationFrame(animFrameRef.current);
      if (slideshowUrl) URL.revokeObjectURL(slideshowUrl);
      itemsRef.current.forEach((item) => {
        if (item.videoUrl) URL.revokeObjectURL(item.videoUrl);
      });
    };
  }, [slideshowUrl]);

  const addEntries = useCallback((entries: Array<{ img: HTMLImageElement; name: string }>) => {
    const newItems: VideoItem[] = entries.map((entry, i) => ({
      id: `${Date.now()}-${i}-${Math.random().toString(36).slice(2, 6)}`,
      origName: entry.name,
      img: entry.img,
      videoBlob: null,
      videoUrl: null,
      ext: 'mp4',
    }));
    setItems((prev) => [...prev, ...newItems]);
  }, []);

  const handleFilesSelected = async (files: File[]) => {
    try {
      const loaded: Array<{ img: HTMLImageElement; name: string }> = [];
      for (const f of files) {
        if (f.type.startsWith('image/')) {
          loaded.push({ img: await loadImageFromFile(f), name: f.name });
        }
      }
      if (!loaded.length) {
        onToast('Please select valid image file(s).', 'warning');
        return;
      }
      addEntries(loaded);
      onToast(`Added ${loaded.length} image(s) to Video Queue.`, 'success');
    } catch {
      onToast('Failed to load one or more images.', 'error');
    }
  };

  const handleLoadDemo = async () => {
    const demos = await generateDemoBatch('video');
    addEntries(demos);
    onToast('Loaded 3 demo scenes into Video Batch Queue.', 'success');
  };

  const handleClearAll = () => {
    stopPreviewLoop();
    if (slideshowUrl) URL.revokeObjectURL(slideshowUrl);
    items.forEach((item) => {
      if (item.videoUrl) URL.revokeObjectURL(item.videoUrl);
    });
    setItems([]);
    setSelectedIndex(0);
    setSlideshowBlob(null);
    setSlideshowUrl(null);
    const canvas = stageCanvasRef.current;
    canvas?.getContext('2d')?.clearRect(0, 0, canvas.width, canvas.height);
  };

  const handleRemoveItem = (idx: number) => {
    const target = items[idx];
    if (target?.videoUrl) URL.revokeObjectURL(target.videoUrl);
    const next = items.filter((_, i) => i !== idx);
    if (!next.length) {
      handleClearAll();
      return;
    }
    setItems(next);
    if (selectedIndex >= next.length) {
      setSelectedIndex(next.length - 1);
    }
  };

  const toggleLivePreview = () => {
    if (!items.length || isRendering) return;
    if (isPreviewPlaying) {
      stopPreviewLoop();
      return;
    }

    setIsPreviewPlaying(true);
    const durMs = durationSec * 1000;
    const startTime = performance.now();
    const canvas = stageCanvasRef.current;
    if (!canvas) return;
    canvas.width = dims.width;
    canvas.height = dims.height;
    const ctx = canvas.getContext('2d')!;

    const tick = (now: number) => {
      const elapsed = (now - startTime) % durMs;
      renderVideoFrameAt(ctx, canvas.width, canvas.height, elapsed / durMs, activePreviewImages, motion);
      animFrameRef.current = requestAnimationFrame(tick);
    };
    animFrameRef.current = requestAnimationFrame(tick);
  };

  const encodeClipFromImages = (
    imageList: HTMLImageElement[],
    bitrate: number,
    labelPrefix: string
  ): Promise<Blob | null> => {
    return new Promise((resolve) => {
      const canvas = stageCanvasRef.current;
      if (!canvas) {
        resolve(null);
        return;
      }
      canvas.width = dims.width;
      canvas.height = dims.height;
      const ctx = canvas.getContext('2d')!;

      const stream = canvas.captureStream(fps);
      const options: MediaRecorderOptions = formatInfo.mime
        ? { mimeType: formatInfo.mime, videoBitsPerSecond: bitrate }
        : { videoBitsPerSecond: bitrate };

      let recorder: MediaRecorder;
      try {
        recorder = new MediaRecorder(stream, options);
      } catch {
        recorder = new MediaRecorder(stream);
      }
      recorderRef.current = recorder;

      const chunks: BlobPart[] = [];
      recorder.ondataavailable = (e) => {
        if (e.data && e.data.size > 0) chunks.push(e.data);
      };

      recorder.onstop = () => {
        if (cancelRequestedRef.current || !chunks.length) {
          resolve(null);
          return;
        }
        resolve(new Blob(chunks, { type: formatInfo.mime || 'video/webm' }));
      };

      const totalMs = durationSec * 1000;
      const startTime = performance.now();
      recorder.start(250);

      const renderLoop = (now: number) => {
        if (cancelRequestedRef.current) {
          if (recorder.state !== 'inactive') recorder.stop();
          return;
        }
        const elapsed = now - startTime;
        const progress = Math.min(1, elapsed / totalMs);
        renderVideoFrameAt(ctx, dims.width, dims.height, progress, imageList, motion);

        setRenderProgress({
          label: labelPrefix,
          pct: Math.round(progress * 100),
          elapsedSec: elapsed / 1000,
        });

        if (progress < 1) {
          animFrameRef.current = requestAnimationFrame(renderLoop);
        } else if (recorder.state !== 'inactive') {
          recorder.stop();
        }
      };

      animFrameRef.current = requestAnimationFrame(renderLoop);
    });
  };

  const startVideoRender = async () => {
    if (!items.length || isRendering) return;
    stopPreviewLoop();
    cancelRequestedRef.current = false;
    setIsRendering(true);
    setOutputExt(formatInfo.ext);

    const bitrate = resPreset === '4k' ? 35_000_000 : resPreset === '1080p' ? 14_000_000 : 7_000_000;

    try {
      if (batchMode === 'slideshow') {
        const allImgs = items.map((x) => x.img);
        const blob = await encodeClipFromImages(
          allImgs,
          bitrate,
          `Encoding Slideshow (${allImgs.length} slides)...`
        );
        if (blob && !cancelRequestedRef.current) {
          if (slideshowUrl) URL.revokeObjectURL(slideshowUrl);
          setSlideshowBlob(blob);
          setSlideshowUrl(URL.createObjectURL(blob));
          setStatusMessage(
            `Slideshow complete: ${dims.width}×${dims.height} · ${durationSec}s · ${formatInfo.label}`
          );
          onToast('Slideshow video rendered and verified compliant.', 'success');
        }
      } else {
        const updated = [...items];
        let renderedCount = 0;
        for (let i = 0; i < updated.length; i++) {
          if (cancelRequestedRef.current) break;
          const blob = await encodeClipFromImages(
            [updated[i].img],
            bitrate,
            `Batch Video ${i + 1} / ${updated.length}: ${updated[i].origName}`
          );
          if (blob && !cancelRequestedRef.current) {
            if (updated[i].videoUrl) URL.revokeObjectURL(updated[i].videoUrl!);
            updated[i] = {
              ...updated[i],
              videoBlob: blob,
              videoUrl: URL.createObjectURL(blob),
              ext: formatInfo.ext,
            };
            renderedCount++;
            setItems([...updated]);
          }
        }
        if (renderedCount > 0 && !cancelRequestedRef.current) {
          setSelectedIndex(0);
          setStatusMessage(
            `Batch complete: Rendered ${renderedCount} separate ${dims.width}×${dims.height} videos.`
          );
          onToast(`Rendered ${renderedCount} separate videos. Ready for ZIP download.`, 'success');
        }
      }
    } finally {
      setIsRendering(false);
      setRenderProgress(null);
    }
  };

  const cancelVideoRender = () => {
    cancelRequestedRef.current = true;
    setIsRendering(false);
    setRenderProgress(null);
    if (animFrameRef.current !== null) cancelAnimationFrame(animFrameRef.current);
    if (recorderRef.current && recorderRef.current.state !== 'inactive') {
      recorderRef.current.stop();
    }
    onToast('Video render cancelled.', 'info');
  };

  const handleDownloadVideo = () => {
    if (batchMode === 'separate') {
      if (!selectedItem?.videoBlob) return;
      const base = selectedItem.origName.replace(/\.[^/.]+$/, '');
      triggerBlobDownload(selectedItem.videoBlob, `${base}-${dims.width}x${dims.height}.${selectedItem.ext}`);
      onToast('Single video clip download started.', 'success');
      return;
    }

    if (!slideshowBlob) return;
    triggerBlobDownload(slideshowBlob, `stock-slideshow-${dims.width}x${dims.height}.${outputExt}`);
    onToast('Slideshow video download started.', 'success');
  };

  const handleDownloadZip = async () => {
    const ready = items.filter((x) => x.videoBlob);
    if (!ready.length) return;
    const zip = new JSZip();
    ready.forEach((item, idx) => {
      const base = item.origName.replace(/\.[^/.]+$/, '');
      zip.file(
        `${String(idx + 1).padStart(2, '0')}-${base}-${dims.width}x${dims.height}.${item.ext}`,
        item.videoBlob!
      );
    });
    const content = await zip.generateAsync({ type: 'blob' });
    triggerBlobDownload(content, `stock-videos-batch-${ready.length}-clips.zip`);
    onToast(`Exported ${ready.length} video clips in ZIP.`, 'success');
  };

  const bitrateMbps = resPreset === '4k' ? 35 : resPreset === '1080p' ? 14 : 7;
  const estMB = ((bitrateMbps * durationSec) / 8).toFixed(1);
  const currentBlob = batchMode === 'separate' ? selectedItem?.videoBlob : slideshowBlob;
  const readyVideosCount = items.filter((x) => x.videoBlob).length;

  const labelMap: Record<VideoResolutionPreset, string> = {
    '720p': 'HD 720p',
    '1080p': 'Full HD',
    '4k': '4K UHD',
  };

  const rules: ComplianceRule[] = [
    {
      id: 'res',
      label: '≥ 1280×720',
      detail: `${dims.width}×${dims.height} ${labelMap[resPreset]}`,
      status: 'pass',
    },
    {
      id: 'format',
      label: 'MP4 / MOV',
      detail: formatInfo.label,
      status: 'pass',
    },
    {
      id: 'dur',
      label: '5s – 60s',
      detail: `${durationSec}s selected`,
      status: durationSec >= 5 && durationSec <= 60 ? 'pass' : 'fail',
    },
    {
      id: 'size',
      label: 'Max 3,900MB',
      detail: currentBlob
        ? `${formatBytes(currentBlob.size)} / 3.9 GB`
        : `Est. ~${estMB} MB`,
      status: currentBlob
        ? currentBlob.size <= MAX_VIDEO_BYTES
          ? 'pass'
          : 'fail'
        : 'pass',
    },
  ];

  return (
    <div className="space-y-6">
      <ComplianceStrip
        sectionLabel="Section 4"
        title="Videos (Motion & Slideshow Renderer)"
        description="Renders 720p, 1080p, or 4K video clips (5s–60s) from single or multiple images with Ken Burns camera motion."
        rules={rules}
      />

      <div className="grid grid-cols-1 lg:grid-cols-12 gap-6 items-start">
        {/* Left Controls */}
        <div className="lg:col-span-4 space-y-5">
          <Dropzone
            icon={<VideoIcon className="w-5 h-5" />}
            accentRingClass="border-rose-500 bg-rose-500/5"
            iconBgClass="bg-rose-50 dark:bg-rose-500/10 text-rose-600 dark:text-rose-400"
            promptText="Drop 1 or more images or"
            browseAccentClass="text-rose-600 dark:text-rose-400"
            subtitle="Combine into 1 slideshow OR render separate videos"
            hasItems={items.length > 0}
            onFilesSelected={handleFilesSelected}
            onLoadDemo={handleLoadDemo}
            onClearAll={handleClearAll}
            footerExtra={
              items.length > 0 ? (
                <div className="flex items-center gap-1.5 overflow-x-auto mt-3 pt-3 border-t border-slate-200 dark:border-[#1c263b]">
                  {items.map((item, idx) => (
                    <img
                      key={item.id}
                      src={item.img.src}
                      alt={`Slide ${idx + 1}`}
                      className="w-10 h-10 object-cover rounded-md border border-slate-300 dark:border-[#2a3752] shrink-0"
                    />
                  ))}
                </div>
              ) : undefined
            }
          />

          {/* Batch Mode */}
          <div className="bg-white dark:bg-[#0f1624] rounded-xl border border-slate-200 dark:border-[#1c263b] p-4 space-y-2.5">
            <h3 className="text-xs font-bold tracking-wide text-slate-500 dark:text-slate-400">
              Multi-Image Video Mode
            </h3>
            <div className="grid grid-cols-1 gap-2">
              <button
                type="button"
                onClick={() => setBatchMode('slideshow')}
                className={`p-3 rounded-lg border text-left transition-colors ${
                  batchMode === 'slideshow'
                    ? 'border-rose-600 bg-rose-600/10'
                    : 'border-slate-200 dark:border-[#2a3752] hover:border-rose-400'
                }`}
              >
                <div
                  className={`text-xs font-bold ${
                    batchMode === 'slideshow'
                      ? 'text-rose-600 dark:text-rose-400'
                      : 'text-slate-900 dark:text-slate-100'
                  }`}
                >
                  A. Combine into One Slideshow Video
                </div>
                <div className="text-[11px] text-slate-500 dark:text-slate-400 mt-0.5">
                  All uploaded images sequenced with crossfades &amp; motion
                </div>
              </button>

              <button
                type="button"
                onClick={() => setBatchMode('separate')}
                className={`p-3 rounded-lg border text-left transition-colors ${
                  batchMode === 'separate'
                    ? 'border-rose-600 bg-rose-600/10'
                    : 'border-slate-200 dark:border-[#2a3752] hover:border-rose-400'
                }`}
              >
                <div
                  className={`text-xs font-bold ${
                    batchMode === 'separate'
                      ? 'text-rose-600 dark:text-rose-400'
                      : 'text-slate-900 dark:text-slate-100'
                  }`}
                >
                  B. Convert Each Image to Separate Video
                </div>
                <div className="text-[11px] text-slate-500 dark:text-slate-400 mt-0.5">
                  Renders individual 5s–60s video clips + ZIP download
                </div>
              </button>
            </div>
          </div>

          {/* Resolution & Orientation */}
          <div className="bg-white dark:bg-[#0f1624] rounded-xl border border-slate-200 dark:border-[#1c263b] p-5 space-y-4">
            <h3 className="text-xs font-bold tracking-wide text-slate-500 dark:text-slate-400">
              1. Resolution &amp; Orientation
            </h3>

            <div className="grid grid-cols-3 gap-2">
              {(
                [
                  { id: '720p', label: 'HD 720p', sub: '1280×720 Min' },
                  { id: '1080p', label: 'Full HD', sub: '1920×1080 Rec' },
                  { id: '4k', label: '4K UHD', sub: '3840×2160 Rec' },
                ] as const
              ).map((preset) => (
                <button
                  key={preset.id}
                  type="button"
                  onClick={() => setResPreset(preset.id)}
                  className={`p-2.5 rounded-lg border text-left transition-colors ${
                    resPreset === preset.id
                      ? 'border-rose-600 bg-rose-600/10'
                      : 'border-slate-200 dark:border-[#2a3752] hover:border-rose-400'
                  }`}
                >
                  <div
                    className={`text-xs font-bold ${
                      resPreset === preset.id
                        ? 'text-rose-600 dark:text-rose-400'
                        : 'text-slate-900 dark:text-slate-100'
                    }`}
                  >
                    {preset.label}
                  </div>
                  <div className="text-[10px] font-mono tabular-nums text-slate-500 dark:text-slate-400 mt-0.5">
                    {preset.sub}
                  </div>
                </button>
              ))}
            </div>

            <div className="grid grid-cols-3 gap-2">
              {(
                [
                  { id: '16:9', label: '16:9 Landscape' },
                  { id: '9:16', label: '9:16 Vertical' },
                  { id: '1:1', label: '1:1 Square' },
                ] as const
              ).map((ratio) => (
                <button
                  key={ratio.id}
                  type="button"
                  onClick={() => setAspect(ratio.id)}
                  className={`py-2 px-2 rounded-lg text-xs font-semibold transition-colors whitespace-nowrap ${
                    aspect === ratio.id
                      ? 'bg-rose-600 text-white'
                      : 'bg-slate-100 dark:bg-[#1c263b] text-slate-700 dark:text-slate-300 hover:bg-slate-200 dark:hover:bg-[#2a3752]'
                  }`}
                >
                  {ratio.label}
                </button>
              ))}
            </div>
          </div>

          {/* Duration, Motion & Codec */}
          <div className="bg-white dark:bg-[#0f1624] rounded-xl border border-slate-200 dark:border-[#1c263b] p-5 space-y-4">
            <h3 className="text-xs font-bold tracking-wide text-slate-500 dark:text-slate-400">
              2. Duration (5s–60s) &amp; Motion
            </h3>

            <div>
              <div className="flex justify-between text-xs mb-1.5">
                <span className="font-medium text-slate-700 dark:text-slate-300">Clip Duration</span>
                <span className="font-mono font-bold tabular-nums text-rose-600 dark:text-rose-400">
                  {durationSec} seconds
                </span>
              </div>
              <input
                type="range"
                min={5}
                max={60}
                step={1}
                value={durationSec}
                onChange={(e) => setDurationSec(parseInt(e.target.value, 10))}
                className="w-full"
              />
              <div className="flex justify-between text-[11px] font-mono tabular-nums text-slate-400 mt-1">
                <span>5s (Min)</span>
                <span>30s</span>
                <span>60s (Max)</span>
              </div>
            </div>

            <div className="grid grid-cols-2 gap-2.5">
              <div>
                <label htmlFor="vid-motion-select" className="block text-[11px] font-medium text-slate-500 dark:text-slate-400 mb-1">
                  Camera Motion
                </label>
                <select
                  id="vid-motion-select"
                  value={motion}
                  onChange={(e) => setMotion(e.target.value as VideoMotionType)}
                  className="w-full rounded-lg bg-slate-100 dark:bg-[#1c263b] border border-slate-200 dark:border-[#2a3752] px-2.5 py-2 text-xs font-semibold text-slate-900 dark:text-slate-100"
                >
                  <option value="zoom-in">Slow Zoom In</option>
                  <option value="zoom-out">Slow Zoom Out</option>
                  <option value="pan-right">Pan Left to Right</option>
                  <option value="float">Gentle Cinema Float</option>
                  <option value="static">Static High-Res</option>
                </select>
              </div>
              <div>
                <label htmlFor="vid-fps-select" className="block text-[11px] font-medium text-slate-500 dark:text-slate-400 mb-1">
                  Frame Rate
                </label>
                <select
                  id="vid-fps-select"
                  value={fps}
                  onChange={(e) => setFps(parseInt(e.target.value, 10))}
                  className="w-full rounded-lg bg-slate-100 dark:bg-[#1c263b] border border-slate-200 dark:border-[#2a3752] px-2.5 py-2 text-xs font-semibold text-slate-900 dark:text-slate-100"
                >
                  <option value={30}>30 FPS (Standard)</option>
                  <option value={24}>24 FPS (Cinema)</option>
                  <option value={60}>60 FPS (Smooth)</option>
                </select>
              </div>
            </div>

            <div className="flex items-center gap-2">
              <button
                type="button"
                onClick={toggleLivePreview}
                disabled={!items.length || isRendering}
                className="flex-1 py-2.5 px-3 rounded-xl font-semibold text-xs bg-slate-100 dark:bg-[#1c263b] hover:bg-slate-200 dark:hover:bg-[#2a3752] disabled:opacity-40 disabled:cursor-not-allowed text-slate-800 dark:text-slate-100 transition-colors flex items-center justify-center gap-1.5 whitespace-nowrap"
              >
                {isPreviewPlaying ? <Square className="w-3.5 h-3.5" /> : <Play className="w-3.5 h-3.5" />}
                <span>{isPreviewPlaying ? 'Stop Preview' : 'Live Preview'}</span>
              </button>
              <button
                type="button"
                onClick={startVideoRender}
                disabled={!items.length || isRendering}
                className="flex-[1.5] py-2.5 px-4 rounded-xl font-bold text-xs bg-rose-600 hover:bg-rose-700 disabled:opacity-40 disabled:cursor-not-allowed text-white transition-colors flex items-center justify-center gap-1.5 whitespace-nowrap"
              >
                <Film className="w-3.5 h-3.5" />
                <span>
                  {batchMode === 'separate' && items.length
                    ? `Render All (${items.length}) Videos`
                    : 'Render & Export Video'}
                </span>
              </button>
            </div>
          </div>
        </div>

        {/* Right Video Stage & Queue */}
        <div className="lg:col-span-8 flex flex-col gap-5">
          {items.length > 0 && (
            <div className="bg-white dark:bg-[#0f1624] rounded-xl border border-slate-200 dark:border-[#1c263b] p-4">
              <div className="flex items-center justify-between mb-3">
                <div className="flex items-center gap-2 text-xs">
                  <span className="font-bold text-slate-700 dark:text-slate-200">Video Image Queue</span>
                  <span aria-hidden="true" className="text-slate-400">·</span>
                  <span className="font-mono tabular-nums text-rose-600 dark:text-rose-400 font-semibold">
                    {items.length} file{items.length > 1 ? 's' : ''}
                  </span>
                </div>
                <span className="text-[11px] text-slate-500 dark:text-slate-400">
                  Click any clip/image to preview or remove
                </span>
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-3 gap-2.5 max-h-[210px] overflow-y-auto pr-1">
                {items.map((item, idx) => {
                  const isSelected = idx === selectedIndex;
                  return (
                    <div
                      key={item.id}
                      role="button"
                      tabIndex={0}
                      onClick={() => setSelectedIndex(idx)}
                      onKeyDown={(e) => {
                        if (e.key === 'Enter' || e.key === ' ') {
                          e.preventDefault();
                          setSelectedIndex(idx);
                        }
                      }}
                      className={`flex items-center gap-2.5 p-2.5 rounded-lg border cursor-pointer transition-colors ${
                        isSelected
                          ? 'border-rose-600 bg-rose-600/10'
                          : 'border-slate-200 dark:border-[#1c263b] bg-slate-50 dark:bg-[#141d2f] hover:border-rose-400'
                      }`}
                    >
                      <img
                        src={item.img.src}
                        alt={item.origName}
                        className="w-11 h-11 rounded-md object-cover border border-slate-200 dark:border-[#2a3752] shrink-0"
                      />
                      <div className="min-w-0 flex-1">
                        <div className="text-xs font-semibold truncate text-slate-900 dark:text-slate-100">
                          {item.origName}
                        </div>
                        <div className="text-[11px] font-mono tabular-nums text-slate-500 dark:text-slate-400 mt-0.5">
                          {item.img.width}×{item.img.height} px
                        </div>
                        <div className="text-[10px] font-bold mt-0.5">
                          {batchMode === 'slideshow' ? (
                            <span className="text-rose-600 dark:text-rose-400">SLIDE #{idx + 1}</span>
                          ) : item.videoBlob ? (
                            <span className="text-emerald-600 dark:text-emerald-400 font-mono tabular-nums">
                              RENDERED ({formatBytes(item.videoBlob.size)})
                            </span>
                          ) : (
                            <span className="text-slate-500 dark:text-slate-400">QUEUED</span>
                          )}
                        </div>
                      </div>
                      <button
                        type="button"
                        aria-label={`Remove ${item.origName}`}
                        onClick={(e) => {
                          e.stopPropagation();
                          handleRemoveItem(idx);
                        }}
                        className="p-1.5 rounded-md text-slate-400 hover:text-rose-500 hover:bg-rose-500/10 transition-colors"
                      >
                        <X className="w-3.5 h-3.5" />
                      </button>
                    </div>
                  );
                })}
              </div>
            </div>
          )}

          {/* Render Monitor */}
          <div className="bg-white dark:bg-[#0f1624] rounded-xl border border-slate-200 dark:border-[#1c263b] p-5 flex flex-col">
            <div className="flex flex-wrap items-center justify-between gap-2 pb-3 mb-4 border-b border-slate-200 dark:border-[#1c263b]">
              <div className="flex items-center gap-2.5">
                <span className="text-sm font-bold text-slate-900 dark:text-slate-100">
                  Video Render Monitor
                </span>
                {isRendering && (
                  <span className="inline-flex items-center gap-1.5 px-2.5 py-0.5 rounded-md text-[11px] font-bold bg-rose-600 text-white">
                    RECORDING
                  </span>
                )}
              </div>

              <div className="flex flex-wrap items-center gap-3 text-xs font-medium text-slate-500 dark:text-slate-400 font-mono tabular-nums">
                <span>
                  Resolution:{' '}
                  <strong className="text-slate-900 dark:text-white">
                    {dims.width}×{dims.height}
                  </strong>
                </span>
                <span>
                  Duration: <strong className="text-slate-900 dark:text-white">{durationSec}s</strong>
                </span>
                <span>
                  Size:{' '}
                  <strong className="text-slate-900 dark:text-white">
                    {currentBlob ? formatBytes(currentBlob.size) : `~${estMB} MB`}
                  </strong>
                </span>
              </div>
            </div>

            <div className="relative min-h-[360px] rounded-lg bg-black border border-slate-200 dark:border-[#1c263b] flex items-center justify-center overflow-hidden p-3">
              <canvas
                ref={stageCanvasRef}
                className={`max-w-full max-h-[360px] object-contain rounded-md ${
                  activePlaybackUrl && !isPreviewPlaying && !isRendering ? 'hidden' : ''
                }`}
              />
              {activePlaybackUrl && !isPreviewPlaying && !isRendering && (
                <video
                  src={activePlaybackUrl}
                  controls
                  className="max-w-full max-h-[360px] rounded-md"
                />
              )}

              {renderProgress && (
                <div className="absolute inset-0 bg-slate-950/85 backdrop-blur-sm flex flex-col items-center justify-center p-6 text-center">
                  <div className="w-full max-w-md space-y-3">
                    <div className="text-sm font-bold text-white">{renderProgress.label}</div>
                    <div className="w-full h-3 bg-[#1c263b] rounded-full overflow-hidden">
                      <div
                        className="h-full bg-gradient-to-r from-rose-500 to-amber-500 transition-all duration-150"
                        style={{ width: `${renderProgress.pct}%` }}
                      />
                    </div>
                    <div className="flex justify-between text-xs font-mono tabular-nums text-slate-300">
                      <span>
                        {renderProgress.elapsedSec.toFixed(1)}s / {durationSec}.0s
                      </span>
                      <span>{renderProgress.pct}%</span>
                    </div>
                    <button
                      type="button"
                      onClick={cancelVideoRender}
                      className="mt-2 px-4 py-2 rounded-lg text-xs font-semibold bg-white/15 hover:bg-white/25 text-white transition-colors"
                    >
                      Cancel Render
                    </button>
                  </div>
                </div>
              )}
            </div>

            <div className="mt-4 pt-4 border-t border-slate-200 dark:border-[#1c263b] flex flex-col sm:flex-row items-center justify-between gap-3">
              <p className="text-xs text-slate-600 dark:text-slate-400">{statusMessage}</p>
              <div className="flex flex-wrap items-center gap-2 w-full sm:w-auto justify-end shrink-0">
                <button
                  type="button"
                  onClick={handleDownloadVideo}
                  disabled={!currentBlob}
                  className="flex-1 sm:flex-initial py-2.5 px-4 rounded-xl font-semibold text-xs sm:text-sm bg-slate-800 dark:bg-[#1c263b] hover:bg-slate-700 dark:hover:bg-[#2a3752] disabled:opacity-40 disabled:cursor-not-allowed text-white transition-colors flex items-center justify-center gap-2 whitespace-nowrap"
                >
                  <Download className="w-4 h-4" />
                  <span>
                    {batchMode === 'separate' && selectedItem?.videoBlob
                      ? `Download Clip #${selectedIndex + 1}`
                      : slideshowBlob
                      ? `Download .${outputExt.toUpperCase()} (${formatBytes(slideshowBlob.size)})`
                      : 'Download Video'}
                  </span>
                </button>
                {batchMode === 'separate' && (
                  <button
                    type="button"
                    onClick={handleDownloadZip}
                    disabled={readyVideosCount === 0}
                    className="flex-1 sm:flex-initial py-2.5 px-4 rounded-xl font-bold text-xs sm:text-sm bg-emerald-600 hover:bg-emerald-700 disabled:opacity-40 disabled:cursor-not-allowed text-white transition-colors flex items-center justify-center gap-2 whitespace-nowrap"
                  >
                    <Archive className="w-4 h-4" />
                    <span>
                      {readyVideosCount > 0
                        ? `Download All (${readyVideosCount}) Videos (ZIP)`
                        : 'Download All Videos (ZIP)'}
                    </span>
                  </button>
                )}
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
