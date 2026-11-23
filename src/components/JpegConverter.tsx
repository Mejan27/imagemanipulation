import { useCallback, useEffect, useRef, useState } from 'react';
import JSZip from 'jszip';
import { Archive, Download, Image as ImageIcon, RefreshCw, X } from 'lucide-react';
import type { ComplianceRule, JpegItem, ToastType } from '../types/converter';
import {
  MAX_IMAGE_BYTES,
  computeTargetDimensions,
  formatBytes,
  generateDemoBatch,
  loadImageFromFile,
  triggerBlobDownload,
} from '../utils/mediaUtils';
import { ComplianceStrip } from './ComplianceStrip';
import { Dropzone } from './Dropzone';

interface JpegConverterProps {
  onToast: (message: string, type?: ToastType) => void;
}

export function JpegConverter({ onToast }: JpegConverterProps) {
  const [items, setItems] = useState<JpegItem[]>([]);
  const [selectedIndex, setSelectedIndex] = useState<number>(-1);
  const [targetMP, setTargetMP] = useState(4.2);
  const [quality, setQuality] = useState(92);
  const [matteColor, setMatteColor] = useState('#ffffff');

  const [isProcessing, setIsProcessing] = useState(false);
  const [progress, setProgress] = useState<{ current: number; total: number; fileName: string } | null>(null);
  const [statusMessage, setStatusMessage] = useState(
    'Upload one or multiple images to convert to compliant ≥ 4MP JPEG files.'
  );

  const origCanvasRef = useRef<HTMLCanvasElement | null>(null);
  const itemsRef = useRef<JpegItem[]>(items);
  itemsRef.current = items;

  const selectedItem = selectedIndex >= 0 && selectedIndex < items.length ? items[selectedIndex] : null;

  useEffect(() => {
    const origCanvas = origCanvasRef.current;
    if (!origCanvas) return;
    if (!selectedItem) {
      origCanvas.getContext('2d')?.clearRect(0, 0, origCanvas.width, origCanvas.height);
      return;
    }
    origCanvas.width = selectedItem.sourceImg.width;
    origCanvas.height = selectedItem.sourceImg.height;
    origCanvas.getContext('2d')?.drawImage(selectedItem.sourceImg, 0, 0);
  }, [selectedItem]);

  useEffect(() => {
    return () => {
      itemsRef.current.forEach((item) => {
        if (item.previewUrl) URL.revokeObjectURL(item.previewUrl);
      });
    };
  }, []);

  const renderSingleItem = useCallback(
    async (
      item: JpegItem,
      opts: { mpVal: number; qualityVal: number; matte: string }
    ): Promise<JpegItem> => {
      const img = item.sourceImg;
      const dims = computeTargetDimensions(img.width, img.height, opts.mpVal);

      const canvas = document.createElement('canvas');
      canvas.width = dims.width;
      canvas.height = dims.height;
      const ctx = canvas.getContext('2d')!;

      ctx.fillStyle = opts.matte;
      ctx.fillRect(0, 0, dims.width, dims.height);
      ctx.imageSmoothingEnabled = true;
      ctx.imageSmoothingQuality = 'high';
      ctx.drawImage(img, 0, 0, dims.width, dims.height);

      const blob = await new Promise<Blob | null>((res) =>
        canvas.toBlob(res, 'image/jpeg', opts.qualityVal / 100)
      );
      if (!blob) throw new Error('Canvas memory limit reached for this resolution');

      if (item.previewUrl) URL.revokeObjectURL(item.previewUrl);
      const previewUrl = URL.createObjectURL(blob);

      return {
        ...item,
        previewUrl,
        outputBlob: blob,
        width: dims.width,
        height: dims.height,
        mp: dims.mp,
        compliant: blob.size <= MAX_IMAGE_BYTES && dims.mp >= 4.0 && dims.mp <= 100,
      };
    },
    []
  );

  const runBatch = useCallback(
    async (
      targetItems: JpegItem[],
      overrides?: Partial<{ mpVal: number; qualityVal: number; matte: string }>
    ) => {
      if (!targetItems.length) return;
      setIsProcessing(true);
      const opts = {
        mpVal: overrides?.mpVal ?? targetMP,
        qualityVal: overrides?.qualityVal ?? quality,
        matte: overrides?.matte ?? matteColor,
      };

      try {
        const updated = [...targetItems];
        for (let i = 0; i < updated.length; i++) {
          setProgress({ current: i + 1, total: updated.length, fileName: updated[i].origName });
          await new Promise((r) => setTimeout(r, 15));
          updated[i] = await renderSingleItem(updated[i], opts);
          setItems([...updated]);
        }
        const passCount = updated.filter((x) => x.compliant).length;
        setStatusMessage(
          `Batch complete: ${passCount} of ${updated.length} JPEG files compliant (≥ 4MP, ≤ 45MB).`
        );
      } catch (err) {
        console.error(err);
        onToast('Batch error rendering JPEGs. Try lowering target MP if browser memory is exceeded.', 'error');
      } finally {
        setIsProcessing(false);
        setTimeout(() => setProgress(null), 900);
      }
    },
    [targetMP, quality, matteColor, renderSingleItem, onToast]
  );

  const addEntries = useCallback(
    (entries: Array<{ img: HTMLImageElement; name: string }>) => {
      const newItems: JpegItem[] = entries.map((entry, i) => ({
        id: `${Date.now()}-${i}-${Math.random().toString(36).slice(2, 6)}`,
        name: `${entry.name.replace(/\.[^/.]+$/, '')}.jpg`,
        origName: entry.name,
        sourceImg: entry.img,
        previewUrl: null,
        outputBlob: null,
        width: 0,
        height: 0,
        mp: 0,
        compliant: false,
      }));

      const merged = [...itemsRef.current, ...newItems];
      const nextIdx = itemsRef.current.length === 0 ? 0 : itemsRef.current.length;
      setItems(merged);
      setSelectedIndex(nextIdx);

      let nextMp = targetMP;
      const activeItem = merged[nextIdx];
      if (activeItem) {
        const naturalMP = (activeItem.sourceImg.width * activeItem.sourceImg.height) / 1_000_000;
        if (naturalMP >= 4.1 && naturalMP <= 100) {
          nextMp = parseFloat(naturalMP.toFixed(1));
          setTargetMP(nextMp);
        }
      }
      runBatch(merged, { mpVal: nextMp });
    },
    [targetMP, runBatch]
  );

  const handleFilesSelected = async (files: File[]) => {
    try {
      const loaded: Array<{ img: HTMLImageElement; name: string }> = [];
      for (const file of files) {
        if (file.type.startsWith('image/')) {
          loaded.push({ img: await loadImageFromFile(file), name: file.name });
        }
      }
      if (!loaded.length) {
        onToast('Please select valid image file(s).', 'warning');
        return;
      }
      addEntries(loaded);
    } catch {
      onToast('Could not load one or more image files.', 'error');
    }
  };

  const handleLoadDemo = async () => {
    const demos = await generateDemoBatch('jpeg');
    addEntries(demos);
  };

  const handleClearAll = () => {
    items.forEach((item) => {
      if (item.previewUrl) URL.revokeObjectURL(item.previewUrl);
    });
    setItems([]);
    setSelectedIndex(-1);
    setStatusMessage('Upload one or multiple images to convert to compliant ≥ 4MP JPEG files.');
  };

  const handleRemoveItem = (idx: number) => {
    const target = items[idx];
    if (target?.previewUrl) URL.revokeObjectURL(target.previewUrl);
    const next = items.filter((_, i) => i !== idx);
    if (!next.length) {
      handleClearAll();
      return;
    }
    setItems(next);
    if (selectedIndex >= next.length) {
      setSelectedIndex(next.length - 1);
    } else if (selectedIndex === idx) {
      setSelectedIndex(Math.max(0, idx - 1));
    }
  };

  const handleDownloadSelected = () => {
    if (!selectedItem?.outputBlob) return;
    triggerBlobDownload(selectedItem.outputBlob, selectedItem.name);
    onToast(`Downloaded ${selectedItem.name}`, 'success');
  };

  const handleDownloadZip = async () => {
    const ready = items.filter((x) => x.outputBlob);
    if (!ready.length) return;
    const zip = new JSZip();
    ready.forEach((item, idx) => {
      zip.file(`${String(idx + 1).padStart(2, '0')}-${item.name}`, item.outputBlob!);
    });
    const content = await zip.generateAsync({ type: 'blob' });
    triggerBlobDownload(content, `stock-jpeg-batch-${ready.length}-files.zip`);
    onToast(`Exported ${ready.length} JPEG files in ZIP.`, 'success');
  };

  const readyCount = items.filter((x) => x.outputBlob).length;

  const rules: ComplianceRule[] = [
    {
      id: 'format',
      label: 'JPEG Format',
      detail: 'JPEG only (.jpg)',
      status: 'pass',
    },
    {
      id: 'res',
      label: '4MP – 100MP',
      detail: selectedItem?.outputBlob
        ? `${selectedItem.mp.toFixed(2)} MP (${selectedItem.width}×${selectedItem.height})`
        : 'Auto-upscale ≥ 4MP',
      status: selectedItem?.outputBlob
        ? selectedItem.mp >= 4.0 && selectedItem.mp <= 100
          ? 'pass'
          : 'fail'
        : 'idle',
    },
    {
      id: 'size',
      label: 'Max 45MB',
      detail: selectedItem?.outputBlob
        ? `${formatBytes(selectedItem.outputBlob.size)} / 45 MB`
        : 'Waiting for file',
      status: selectedItem?.outputBlob
        ? selectedItem.outputBlob.size <= MAX_IMAGE_BYTES
          ? 'pass'
          : 'fail'
        : 'idle',
    },
  ];

  return (
    <div className="space-y-6">
      <ComplianceStrip
        sectionLabel="Section 2"
        title="JPEG Images Converter"
        description="Flattens transparency onto pure white or custom matte, enforces 4MP–100MP resolution, and optimizes ≤ 45MB JPEG output."
        rules={rules}
      />

      <div className="grid grid-cols-1 lg:grid-cols-12 gap-6 items-start">
        {/* Left Controls */}
        <div className="lg:col-span-4 space-y-5">
          <Dropzone
            icon={<ImageIcon className="w-5 h-5" />}
            accentRingClass="border-indigo-500 bg-indigo-500/5"
            iconBgClass="bg-indigo-50 dark:bg-indigo-500/10 text-indigo-600 dark:text-indigo-400"
            promptText="Drop multiple images or"
            browseAccentClass="text-indigo-600 dark:text-indigo-400"
            subtitle="Batch converts PNG, WEBP, SVG, BMP → High-Res JPEG"
            hasItems={items.length > 0}
            onFilesSelected={handleFilesSelected}
            onLoadDemo={handleLoadDemo}
            onClearAll={handleClearAll}
          />

          {/* Resolution */}
          <div className="bg-white dark:bg-[#0f1624] rounded-xl border border-slate-200 dark:border-[#1c263b] p-5 space-y-4">
            <div className="flex items-center justify-between">
              <h3 className="text-xs font-bold tracking-wide text-slate-500 dark:text-slate-400">
                1. Target Resolution (4MP–100MP)
              </h3>
              <span className="text-xs font-mono font-bold tabular-nums text-indigo-600 dark:text-indigo-400">
                {targetMP.toFixed(1)} MP
              </span>
            </div>

            <div>
              <input
                type="range"
                min={4.1}
                max={100}
                step={0.1}
                value={targetMP}
                onChange={(e) => setTargetMP(parseFloat(e.target.value))}
                onMouseUp={() => items.length && runBatch(items)}
                onKeyUp={() => items.length && runBatch(items)}
                onTouchEnd={() => items.length && runBatch(items)}
                className="w-full"
              />
              <div className="flex justify-between text-[11px] font-mono tabular-nums text-slate-400 mt-1">
                <span>4.1 MP (Min)</span>
                <span>50 MP</span>
                <span>100 MP (Max)</span>
              </div>
            </div>

            <div className="grid grid-cols-4 gap-1.5">
              {[4.2, 12, 24, 48].map((preset) => (
                <button
                  key={preset}
                  type="button"
                  onClick={() => {
                    setTargetMP(preset);
                    if (items.length) runBatch(items, { mpVal: preset });
                  }}
                  className={`py-2 rounded-lg text-xs font-mono font-semibold tabular-nums transition-colors ${
                    Math.abs(targetMP - preset) < 0.05
                      ? 'bg-indigo-600 text-white'
                      : 'bg-slate-100 dark:bg-[#1c263b] hover:bg-indigo-600 hover:text-white text-slate-700 dark:text-slate-300'
                  }`}
                >
                  {preset} MP
                </button>
              ))}
            </div>
          </div>

          {/* Compression & Flatten */}
          <div className="bg-white dark:bg-[#0f1624] rounded-xl border border-slate-200 dark:border-[#1c263b] p-5 space-y-4">
            <h3 className="text-xs font-bold tracking-wide text-slate-500 dark:text-slate-400">
              2. Compression &amp; Flatten
            </h3>

            <div>
              <div className="flex justify-between text-xs mb-1.5">
                <span className="font-medium text-slate-700 dark:text-slate-300">JPEG Quality</span>
                <span className="font-mono font-bold tabular-nums text-indigo-600 dark:text-indigo-400">
                  {quality}%
                </span>
              </div>
              <input
                type="range"
                min={10}
                max={100}
                value={quality}
                onChange={(e) => setQuality(parseInt(e.target.value, 10))}
                onMouseUp={() => items.length && runBatch(items)}
                onKeyUp={() => items.length && runBatch(items)}
                onTouchEnd={() => items.length && runBatch(items)}
                className="w-full"
              />
            </div>

            <div className="flex items-center justify-between text-xs">
              <label htmlFor="jpeg-matte-color" className="text-slate-700 dark:text-slate-300 font-medium">
                Alpha Matte Fill Color
              </label>
              <div className="flex items-center gap-2">
                <span className="text-slate-400 text-[11px]">Default: Pure White</span>
                <input
                  id="jpeg-matte-color"
                  type="color"
                  value={matteColor}
                  onChange={(e) => {
                    const val = e.target.value;
                    setMatteColor(val);
                    if (items.length) runBatch(items, { matte: val });
                  }}
                  className="w-7 h-7 rounded-md border-0 bg-transparent cursor-pointer"
                />
              </div>
            </div>

            <button
              type="button"
              onClick={() => runBatch(items)}
              disabled={!items.length || isProcessing}
              className="w-full py-2.5 px-4 rounded-xl font-bold text-sm bg-indigo-600 hover:bg-indigo-700 disabled:opacity-40 disabled:cursor-not-allowed text-white transition-colors flex items-center justify-center gap-2"
            >
              <RefreshCw className={`w-4 h-4 ${isProcessing ? 'animate-spin' : ''}`} />
              <span className="whitespace-nowrap">
                {items.length ? `Convert All (${items.length}) to Stock JPEG` : 'Convert All to Stock JPEG'}
              </span>
            </button>

            {progress && (
              <div className="space-y-1.5 pt-1">
                <div className="flex justify-between text-[11px] font-semibold">
                  <span className="text-indigo-600 dark:text-indigo-400 truncate max-w-[220px]">
                    Processing {progress.current} / {progress.total}: {progress.fileName}
                  </span>
                  <span className="font-mono tabular-nums">
                    {Math.round((progress.current / progress.total) * 100)}%
                  </span>
                </div>
                <div className="w-full h-2 bg-slate-200 dark:bg-[#1c263b] rounded-full overflow-hidden">
                  <div
                    className="h-full bg-indigo-600 transition-all duration-150"
                    style={{ width: `${Math.round((progress.current / progress.total) * 100)}%` }}
                  />
                </div>
              </div>
            )}
          </div>
        </div>

        {/* Right Preview & Queue */}
        <div className="lg:col-span-8 flex flex-col gap-5">
          {items.length > 0 && (
            <div className="bg-white dark:bg-[#0f1624] rounded-xl border border-slate-200 dark:border-[#1c263b] p-4">
              <div className="flex items-center justify-between mb-3">
                <div className="flex items-center gap-2 text-xs">
                  <span className="font-bold text-slate-700 dark:text-slate-200">JPEG Batch Queue</span>
                  <span aria-hidden="true" className="text-slate-400">·</span>
                  <span className="font-mono tabular-nums text-indigo-600 dark:text-indigo-400 font-semibold">
                    {items.length} file{items.length > 1 ? 's' : ''}
                  </span>
                </div>
                <span className="text-[11px] text-slate-500 dark:text-slate-400">
                  Click any item to inspect preview
                </span>
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-3 gap-2.5 max-h-[220px] overflow-y-auto pr-1">
                {items.map((item, idx) => {
                  const isSelected = idx === selectedIndex;
                  const origMP = ((item.sourceImg.width * item.sourceImg.height) / 1_000_000).toFixed(1);
                  const statusLabel = !item.outputBlob ? 'QUEUED' : item.compliant ? 'PASS' : 'FAIL';
                  const statusClass = !item.outputBlob
                    ? 'text-slate-500 dark:text-slate-400'
                    : item.compliant
                    ? 'text-emerald-600 dark:text-emerald-400'
                    : 'text-rose-600 dark:text-rose-400';

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
                          ? 'border-indigo-600 bg-indigo-600/10'
                          : 'border-slate-200 dark:border-[#1c263b] bg-slate-50 dark:bg-[#141d2f] hover:border-indigo-400'
                      }`}
                    >
                      <img
                        src={item.previewUrl || item.sourceImg.src}
                        alt={item.origName}
                        className="w-11 h-11 rounded-md object-cover border border-slate-200 dark:border-[#2a3752] shrink-0"
                      />
                      <div className="min-w-0 flex-1">
                        <div className="text-xs font-semibold truncate text-slate-900 dark:text-slate-100">
                          {item.origName}
                        </div>
                        <div className="text-[11px] font-mono tabular-nums text-slate-500 dark:text-slate-400 mt-0.5">
                          {origMP}MP → {item.mp ? `${item.mp.toFixed(1)}MP` : '—'} ·{' '}
                          {item.outputBlob ? formatBytes(item.outputBlob.size) : 'Pending'}
                        </div>
                        <div className={`text-[10px] font-bold mt-0.5 ${statusClass}`}>{statusLabel}</div>
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

          {/* Split Preview Stage */}
          <div className="bg-white dark:bg-[#0f1624] rounded-xl border border-slate-200 dark:border-[#1c263b] p-5 flex flex-col">
            <div className="flex flex-wrap items-center justify-between gap-2 pb-3 mb-4 border-b border-slate-200 dark:border-[#1c263b]">
              <span className="text-sm font-bold text-slate-900 dark:text-slate-100">JPEG Output Preview</span>
              <div className="flex flex-wrap items-center gap-3 text-xs font-medium text-slate-500 dark:text-slate-400 font-mono tabular-nums">
                <span>
                  Dimensions:{' '}
                  <strong className="text-slate-900 dark:text-white">
                    {selectedItem?.width ? `${selectedItem.width} × ${selectedItem.height} px` : '—'}
                  </strong>
                </span>
                <span>
                  Resolution:{' '}
                  <strong className="text-slate-900 dark:text-white">
                    {selectedItem?.mp ? `${selectedItem.mp.toFixed(2)} MP` : '—'}
                  </strong>
                </span>
                <span>
                  File Size:{' '}
                  <strong className="text-slate-900 dark:text-white">
                    {selectedItem?.outputBlob ? formatBytes(selectedItem.outputBlob.size) : '—'}
                  </strong>
                </span>
              </div>
            </div>

            <div className="grid grid-cols-1 md:grid-cols-2 gap-4 min-h-[340px]">
              <div className="flex flex-col rounded-lg border border-slate-200 dark:border-[#1c263b] overflow-hidden bg-slate-100 dark:bg-[#090d16]">
                <div className="px-3 py-2 text-[11px] font-semibold bg-slate-200/70 dark:bg-[#141d2f] text-slate-700 dark:text-slate-300 flex justify-between">
                  <span>Original Input</span>
                  <span className="font-mono tabular-nums">
                    {selectedItem
                      ? `${selectedItem.sourceImg.width}×${selectedItem.sourceImg.height} (${(
                          (selectedItem.sourceImg.width * selectedItem.sourceImg.height) /
                          1_000_000
                        ).toFixed(2)}MP)`
                      : 'No file'}
                  </span>
                </div>
                <div className="flex-1 flex items-center justify-center p-4 overflow-hidden">
                  <canvas
                    ref={origCanvasRef}
                    className={`max-w-full max-h-[300px] object-contain rounded-md ${
                      selectedItem ? '' : 'hidden'
                    }`}
                  />
                  {!selectedItem && <span className="text-xs text-slate-400">Source image preview</span>}
                </div>
              </div>

              <div className="flex flex-col rounded-lg border border-slate-200 dark:border-[#1c263b] overflow-hidden bg-slate-100 dark:bg-[#090d16]">
                <div className="px-3 py-2 text-[11px] font-semibold bg-slate-200/70 dark:bg-[#141d2f] text-slate-700 dark:text-slate-300 flex justify-between">
                  <span>Converted JPEG (.jpg)</span>
                  <span className="font-mono tabular-nums text-indigo-600 dark:text-indigo-400">
                    {selectedItem?.outputBlob ? `Q: ${quality}%` : 'Ready'}
                  </span>
                </div>
                <div className="flex-1 flex items-center justify-center p-4 overflow-hidden">
                  {selectedItem?.previewUrl ? (
                    <img
                      src={selectedItem.previewUrl}
                      alt={`Converted ${selectedItem.name}`}
                      className="max-w-full max-h-[300px] object-contain rounded-md"
                    />
                  ) : (
                    <span className="text-xs text-slate-400">Converted preview appears here</span>
                  )}
                </div>
              </div>
            </div>

            <div className="mt-4 pt-4 border-t border-slate-200 dark:border-[#1c263b] flex flex-col sm:flex-row items-center justify-between gap-3">
              <p className="text-xs text-slate-600 dark:text-slate-400">{statusMessage}</p>
              <div className="flex flex-wrap items-center gap-2 w-full sm:w-auto justify-end shrink-0">
                <button
                  type="button"
                  onClick={handleDownloadSelected}
                  disabled={!selectedItem?.outputBlob || selectedItem.outputBlob.size > MAX_IMAGE_BYTES}
                  className="flex-1 sm:flex-initial py-2.5 px-4 rounded-xl font-semibold text-xs sm:text-sm bg-slate-800 dark:bg-[#1c263b] hover:bg-slate-700 dark:hover:bg-[#2a3752] disabled:opacity-40 disabled:cursor-not-allowed text-white transition-colors flex items-center justify-center gap-2 whitespace-nowrap"
                >
                  <Download className="w-4 h-4" />
                  <span>Download Selected</span>
                </button>
                <button
                  type="button"
                  onClick={handleDownloadZip}
                  disabled={readyCount === 0}
                  className="flex-1 sm:flex-initial py-2.5 px-4 rounded-xl font-bold text-xs sm:text-sm bg-emerald-600 hover:bg-emerald-700 disabled:opacity-40 disabled:cursor-not-allowed text-white transition-colors flex items-center justify-center gap-2 whitespace-nowrap"
                >
                  <Archive className="w-4 h-4" />
                  <span>{readyCount > 1 ? `Download All (${readyCount}) as ZIP` : 'Download ZIP'}</span>
                </button>
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
