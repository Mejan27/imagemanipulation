import { useCallback, useEffect, useRef, useState } from 'react';
import JSZip from 'jszip';
import { Archive, Download, RefreshCw, UploadCloud, X } from 'lucide-react';
import type { ComplianceRule, PngItem, ToastType } from '../types/converter';
import {
  MAX_IMAGE_BYTES,
  computeTargetDimensions,
  formatBytes,
  generateDemoBatch,
  hexToRgb,
  loadImageFromFile,
  sampleCornerHex,
  triggerBlobDownload,
} from '../utils/mediaUtils';
import { ComplianceStrip } from './ComplianceStrip';
import { Dropzone } from './Dropzone';

interface PngConverterProps {
  onToast: (message: string, type?: ToastType) => void;
}

export function PngConverter({ onToast }: PngConverterProps) {
  const [items, setItems] = useState<PngItem[]>([]);
  const [selectedIndex, setSelectedIndex] = useState<number>(-1);
  const [bgMode, setBgMode] = useState<'auto' | 'keep'>('auto');
  const [bgColor, setBgColor] = useState('#ffffff');
  const [tolerance, setTolerance] = useState(28);
  const [feather, setFeather] = useState(12);
  const [contiguous, setContiguous] = useState(true);
  const [targetMP, setTargetMP] = useState(4.2);

  const [isProcessing, setIsProcessing] = useState(false);
  const [progress, setProgress] = useState<{ current: number; total: number; fileName: string } | null>(null);
  const [statusMessage, setStatusMessage] = useState(
    'Upload one or multiple images to inspect transparency and megapixels.'
  );

  const origCanvasRef = useRef<HTMLCanvasElement | null>(null);
  const outCanvasRef = useRef<HTMLCanvasElement | null>(null);
  const itemsRef = useRef<PngItem[]>(items);
  itemsRef.current = items;

  const selectedItem = selectedIndex >= 0 && selectedIndex < items.length ? items[selectedIndex] : null;

  // Sync split canvas previews whenever selectedItem changes
  useEffect(() => {
    const origCanvas = origCanvasRef.current;
    const outCanvas = outCanvasRef.current;
    if (!origCanvas || !outCanvas) return;

    if (!selectedItem) {
      origCanvas.getContext('2d')?.clearRect(0, 0, origCanvas.width, origCanvas.height);
      outCanvas.getContext('2d')?.clearRect(0, 0, outCanvas.width, outCanvas.height);
      return;
    }

    origCanvas.width = selectedItem.sourceImg.width;
    origCanvas.height = selectedItem.sourceImg.height;
    origCanvas.getContext('2d')?.drawImage(selectedItem.sourceImg, 0, 0);

    if (selectedItem.previewDataUrl) {
      const pImg = new Image();
      pImg.onload = () => {
        outCanvas.width = pImg.width;
        outCanvas.height = pImg.height;
        outCanvas.getContext('2d')?.drawImage(pImg, 0, 0);
      };
      pImg.src = selectedItem.previewDataUrl;
    } else {
      outCanvas.getContext('2d')?.clearRect(0, 0, outCanvas.width, outCanvas.height);
    }
  }, [selectedItem]);

  const renderSingleItem = useCallback(
    async (
      item: PngItem,
      opts: {
        mode: 'auto' | 'keep';
        color: string;
        tolVal: number;
        featherVal: number;
        isContiguous: boolean;
        mpVal: number;
      }
    ): Promise<PngItem> => {
      const img = item.sourceImg;
      const workMax = 1400;
      const scaleWork = Math.min(1, workMax / Math.max(img.width, img.height));
      const wW = Math.max(1, Math.round(img.width * scaleWork));
      const wH = Math.max(1, Math.round(img.height * scaleWork));

      const workCanvas = document.createElement('canvas');
      workCanvas.width = wW;
      workCanvas.height = wH;
      const wCtx = workCanvas.getContext('2d')!;
      wCtx.drawImage(img, 0, 0, wW, wH);

      const imgData = wCtx.getImageData(0, 0, wW, wH);
      const data = imgData.data;

      if (opts.mode === 'auto') {
        const targetRgb = hexToRgb(opts.color);
        const tol = (opts.tolVal / 100) * 441.67;
        const featherDist = (opts.featherVal / 100) * 180;

        const colorDist = (idx: number) => {
          const dr = data[idx] - targetRgb.r;
          const dg = data[idx + 1] - targetRgb.g;
          const db = data[idx + 2] - targetRgb.b;
          return Math.sqrt(dr * dr + dg * dg + db * db);
        };

        if (opts.isContiguous) {
          const visited = new Uint8Array(wW * wH);
          const stack: number[] = [];
          for (let x = 0; x < wW; x++) stack.push(x, (wH - 1) * wW + x);
          for (let y = 0; y < wH; y++) stack.push(y * wW, y * wW + (wW - 1));
          while (stack.length > 0) {
            const p = stack.pop()!;
            if (visited[p]) continue;
            visited[p] = 1;
            const idx = p * 4;
            const d = colorDist(idx);
            if (d <= tol + featherDist) {
              if (d <= tol) {
                data[idx + 3] = 0;
              } else {
                const alphaRatio = (d - tol) / Math.max(1, featherDist);
                data[idx + 3] = Math.min(data[idx + 3], Math.round(alphaRatio * 255));
              }
              const x = p % wW;
              const y = (p - x) / wW;
              if (x > 0 && !visited[p - 1]) stack.push(p - 1);
              if (x < wW - 1 && !visited[p + 1]) stack.push(p + 1);
              if (y > 0 && !visited[p - wW]) stack.push(p - wW);
              if (y < wH - 1 && !visited[p + wW]) stack.push(p + wW);
            }
          }
        } else {
          for (let i = 0; i < data.length; i += 4) {
            const d = colorDist(i);
            if (d <= tol) {
              data[i + 3] = 0;
            } else if (d <= tol + featherDist) {
              const alphaRatio = (d - tol) / Math.max(1, featherDist);
              data[i + 3] = Math.min(data[i + 3], Math.round(alphaRatio * 255));
            }
          }
        }
        wCtx.putImageData(imgData, 0, 0);
      }

      let transparentCount = 0;
      for (let i = 3; i < data.length; i += 16) {
        if (data[i] < 250) transparentCount++;
      }
      const hasTransparency = transparentCount > 5;
      const previewDataUrl = workCanvas.toDataURL('image/png');

      const dims = computeTargetDimensions(img.width, img.height, opts.mpVal);
      const outCanvas = document.createElement('canvas');
      outCanvas.width = dims.width;
      outCanvas.height = dims.height;
      const outCtx = outCanvas.getContext('2d')!;
      outCtx.imageSmoothingEnabled = true;
      outCtx.imageSmoothingQuality = 'high';
      outCtx.drawImage(workCanvas, 0, 0, dims.width, dims.height);

      const blob = await new Promise<Blob | null>((res) => outCanvas.toBlob(res, 'image/png'));
      if (!blob) throw new Error('Canvas memory limit reached for this resolution');

      return {
        ...item,
        previewDataUrl,
        outputBlob: blob,
        width: dims.width,
        height: dims.height,
        mp: dims.mp,
        hasTransparency,
        compliant: blob.size <= MAX_IMAGE_BYTES && dims.mp >= 4.0 && dims.mp <= 100 && hasTransparency,
      };
    },
    []
  );

  const runBatch = useCallback(
    async (
      targetItems: PngItem[],
      overrides?: Partial<{
        mode: 'auto' | 'keep';
        color: string;
        tolVal: number;
        featherVal: number;
        isContiguous: boolean;
        mpVal: number;
      }>
    ) => {
      if (!targetItems.length) return;
      setIsProcessing(true);
      const opts = {
        mode: overrides?.mode ?? bgMode,
        color: overrides?.color ?? bgColor,
        tolVal: overrides?.tolVal ?? tolerance,
        featherVal: overrides?.featherVal ?? feather,
        isContiguous: overrides?.isContiguous ?? contiguous,
        mpVal: overrides?.mpVal ?? targetMP,
      };

      try {
        const updated: PngItem[] = [...targetItems];
        for (let i = 0; i < updated.length; i++) {
          setProgress({ current: i + 1, total: updated.length, fileName: updated[i].origName });
          await new Promise((r) => setTimeout(r, 15));
          updated[i] = await renderSingleItem(updated[i], opts);
          setItems([...updated]);
        }
        const passCount = updated.filter((x) => x.compliant).length;
        setStatusMessage(
          `Batch complete: ${passCount} of ${updated.length} images passed all Transparent PNG rules.`
        );
      } catch (err) {
        console.error(err);
        onToast('Batch error rendering PNGs. Try lowering target MP if browser memory is exceeded.', 'error');
      } finally {
        setIsProcessing(false);
        setTimeout(() => setProgress(null), 900);
      }
    },
    [bgMode, bgColor, tolerance, feather, contiguous, targetMP, renderSingleItem, onToast]
  );

  const addEntries = useCallback(
    (entries: Array<{ img: HTMLImageElement; name: string }>) => {
      const newItems: PngItem[] = entries.map((entry, i) => ({
        id: `${Date.now()}-${i}-${Math.random().toString(36).slice(2, 6)}`,
        name: `${entry.name.replace(/\.[^/.]+$/, '')}-transparent.png`,
        origName: entry.name,
        sourceImg: entry.img,
        previewDataUrl: null,
        outputBlob: null,
        width: 0,
        height: 0,
        mp: 0,
        hasTransparency: false,
        compliant: false,
      }));

      const merged = [...itemsRef.current, ...newItems];
      const nextIndex = itemsRef.current.length === 0 ? 0 : itemsRef.current.length;
      setItems(merged);
      setSelectedIndex(nextIndex);

      const activeItem = merged[nextIndex];
      let nextMp = targetMP;
      let nextColor = bgColor;
      if (activeItem) {
        const naturalMP = (activeItem.sourceImg.width * activeItem.sourceImg.height) / 1_000_000;
        if (naturalMP >= 4.1 && naturalMP <= 100) {
          nextMp = parseFloat(naturalMP.toFixed(1));
          setTargetMP(nextMp);
        }
        const sampled = sampleCornerHex(activeItem.sourceImg);
        if (!sampled.isTransparent && sampled.hex) {
          nextColor = sampled.hex;
          setBgColor(sampled.hex);
        }
      }
      runBatch(merged, { mpVal: nextMp, color: nextColor });
    },
    [targetMP, bgColor, runBatch]
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
    const demos = await generateDemoBatch('png');
    addEntries(demos);
  };

  const handleClearAll = () => {
    setItems([]);
    setSelectedIndex(-1);
    setStatusMessage('Upload one or multiple images to inspect transparency and megapixels.');
  };

  const handleRemoveItem = (idx: number) => {
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

  const handleAutoSampleCorner = () => {
    const current = selectedItem ?? items[0];
    if (!current) return;
    const sampled = sampleCornerHex(current.sourceImg);
    if (sampled.isTransparent || !sampled.hex) {
      onToast('Selected image already has transparent corners.', 'info');
      return;
    }
    setBgColor(sampled.hex);
    onToast(`Sampled background color: ${sampled.hex.toUpperCase()}`, 'info');
    runBatch(items, { color: sampled.hex });
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
    triggerBlobDownload(content, `transparent-png-batch-${ready.length}-files.zip`);
    onToast(`Exported ${ready.length} Transparent PNGs in ZIP.`, 'success');
  };

  const readyCount = items.filter((x) => x.outputBlob).length;

  const rules: ComplianceRule[] = [
    {
      id: 'alpha',
      label: 'Transparent BG',
      detail: selectedItem?.outputBlob
        ? selectedItem.hasTransparency
          ? 'Alpha verified'
          : 'No transparent px'
        : 'No background',
      status: selectedItem?.outputBlob
        ? selectedItem.hasTransparency
          ? 'pass'
          : 'warn'
        : 'idle',
    },
    {
      id: 'format',
      label: 'PNG Format',
      detail: 'PNG only (.png)',
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
        sectionLabel="Section 1"
        title="Transparent PNG Converter"
        description="Removes solid backgrounds, enforces a transparent alpha channel, scales proportionally between 4MP–100MP, and verifies file size ≤ 45MB."
        rules={rules}
      />

      <div className="grid grid-cols-1 lg:grid-cols-12 gap-6 items-start">
        {/* Left Controls */}
        <div className="lg:col-span-4 space-y-5">
          <Dropzone
            icon={<UploadCloud className="w-5 h-5" />}
            accentRingClass="border-blue-500 bg-blue-500/5"
            iconBgClass="bg-blue-50 dark:bg-blue-500/10 text-blue-600 dark:text-blue-400"
            promptText="Drop multiple images or"
            browseAccentClass="text-blue-600 dark:text-blue-400"
            subtitle="Batch PNG, JPG, WEBP, BMP → Transparent PNG"
            hasItems={items.length > 0}
            onFilesSelected={handleFilesSelected}
            onLoadDemo={handleLoadDemo}
            onClearAll={handleClearAll}
          />

          {/* Background Removal Controls */}
          <div className="bg-white dark:bg-[#0f1624] rounded-xl border border-slate-200 dark:border-[#1c263b] p-5 space-y-4">
            <h3 className="text-xs font-bold tracking-wide text-slate-500 dark:text-slate-400">
              1. Background Removal
            </h3>

            <div className="grid grid-cols-2 gap-2">
              <button
                type="button"
                onClick={() => {
                  setBgMode('auto');
                  if (items.length) runBatch(items, { mode: 'auto' });
                }}
                className={`px-3 py-2.5 rounded-lg text-xs font-semibold border transition-colors whitespace-nowrap ${
                  bgMode === 'auto'
                    ? 'border-blue-600 bg-blue-600/10 text-blue-600 dark:text-blue-400'
                    : 'border-slate-200 dark:border-[#2a3752] text-slate-600 dark:text-slate-400 hover:bg-slate-100 dark:hover:bg-[#1c263b]'
                }`}
              >
                Auto-Remove BG
              </button>
              <button
                type="button"
                onClick={() => {
                  setBgMode('keep');
                  if (items.length) runBatch(items, { mode: 'keep' });
                }}
                className={`px-3 py-2.5 rounded-lg text-xs font-semibold border transition-colors whitespace-nowrap ${
                  bgMode === 'keep'
                    ? 'border-blue-600 bg-blue-600/10 text-blue-600 dark:text-blue-400'
                    : 'border-slate-200 dark:border-[#2a3752] text-slate-600 dark:text-slate-400 hover:bg-slate-100 dark:hover:bg-[#1c263b]'
                }`}
              >
                Keep Alpha Only
              </button>
            </div>

            <div className={`space-y-4 pt-1 ${bgMode === 'keep' ? 'opacity-40 pointer-events-none' : ''}`}>
              <div className="flex items-center justify-between gap-3">
                <label htmlFor="png-bg-color" className="text-xs font-medium text-slate-700 dark:text-slate-300">
                  Target BG Color
                </label>
                <div className="flex items-center gap-2">
                  <button
                    type="button"
                    onClick={handleAutoSampleCorner}
                    className="text-[11px] font-semibold px-2.5 py-1.5 rounded-lg bg-slate-100 dark:bg-[#1c263b] hover:bg-slate-200 dark:hover:bg-[#2a3752] text-slate-700 dark:text-slate-200 transition-colors whitespace-nowrap"
                  >
                    Auto-Detect Corner
                  </button>
                  <input
                    id="png-bg-color"
                    type="color"
                    value={bgColor}
                    onChange={(e) => {
                      const val = e.target.value;
                      setBgColor(val);
                      if (items.length) runBatch(items, { color: val });
                    }}
                    className="w-8 h-8 rounded-lg border-0 bg-transparent cursor-pointer"
                  />
                </div>
              </div>

              <div>
                <div className="flex justify-between text-xs mb-1.5">
                  <span className="font-medium text-slate-700 dark:text-slate-300">Color Tolerance</span>
                  <span className="font-mono font-bold tabular-nums text-blue-600 dark:text-blue-400">
                    {tolerance}%
                  </span>
                </div>
                <input
                  type="range"
                  min={1}
                  max={85}
                  value={tolerance}
                  onChange={(e) => setTolerance(parseInt(e.target.value, 10))}
                  onMouseUp={() => items.length && runBatch(items)}
                  onKeyUp={() => items.length && runBatch(items)}
                  onTouchEnd={() => items.length && runBatch(items)}
                  className="w-full"
                />
              </div>

              <div>
                <div className="flex justify-between text-xs mb-1.5">
                  <span className="font-medium text-slate-700 dark:text-slate-300">Smart Edge Feathering</span>
                  <span className="font-mono font-bold tabular-nums text-blue-600 dark:text-blue-400">
                    {feather}%
                  </span>
                </div>
                <input
                  type="range"
                  min={0}
                  max={40}
                  value={feather}
                  onChange={(e) => setFeather(parseInt(e.target.value, 10))}
                  onMouseUp={() => items.length && runBatch(items)}
                  onKeyUp={() => items.length && runBatch(items)}
                  onTouchEnd={() => items.length && runBatch(items)}
                  className="w-full"
                />
              </div>

              <label className="flex items-center gap-2.5 text-xs font-medium text-slate-700 dark:text-slate-300 cursor-pointer">
                <input
                  type="checkbox"
                  checked={contiguous}
                  onChange={(e) => {
                    const checked = e.target.checked;
                    setContiguous(checked);
                    if (items.length) runBatch(items, { isContiguous: checked });
                  }}
                  className="w-4 h-4 rounded text-blue-600 focus:ring-blue-500"
                />
                <span>Flood-fill from outer edges only (protects inner details)</span>
              </label>
            </div>
          </div>

          {/* Target Resolution */}
          <div className="bg-white dark:bg-[#0f1624] rounded-xl border border-slate-200 dark:border-[#1c263b] p-5 space-y-4">
            <div className="flex items-center justify-between">
              <h3 className="text-xs font-bold tracking-wide text-slate-500 dark:text-slate-400">
                2. Target Resolution (4MP–100MP)
              </h3>
              <span className="text-xs font-mono font-bold tabular-nums text-blue-600 dark:text-blue-400">
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
              {[4.2, 8.3, 16, 25].map((preset) => (
                <button
                  key={preset}
                  type="button"
                  onClick={() => {
                    setTargetMP(preset);
                    if (items.length) runBatch(items, { mpVal: preset });
                  }}
                  className={`py-2 rounded-lg text-xs font-mono font-semibold tabular-nums transition-colors ${
                    Math.abs(targetMP - preset) < 0.05
                      ? 'bg-blue-600 text-white'
                      : 'bg-slate-100 dark:bg-[#1c263b] hover:bg-blue-600 hover:text-white text-slate-700 dark:text-slate-300'
                  }`}
                >
                  {preset} MP
                </button>
              ))}
            </div>

            <p className="text-[11px] text-slate-500 dark:text-slate-400 leading-relaxed">
              Images below 4MP are automatically upscaled proportionally to ≥ 4.1MP. Supports 4.1MP up to 100MP with ≤ 45MB verification.
            </p>

            <button
              type="button"
              onClick={() => runBatch(items)}
              disabled={!items.length || isProcessing}
              className="w-full py-2.5 px-4 rounded-xl font-bold text-sm bg-blue-600 hover:bg-blue-700 disabled:opacity-40 disabled:cursor-not-allowed text-white transition-colors flex items-center justify-center gap-2"
            >
              <RefreshCw className={`w-4 h-4 ${isProcessing ? 'animate-spin' : ''}`} />
              <span className="whitespace-nowrap">
                {items.length ? `Convert All (${items.length}) to Transparent PNG` : 'Convert All to Transparent PNG'}
              </span>
            </button>

            {progress && (
              <div className="space-y-1.5 pt-1">
                <div className="flex justify-between text-[11px] font-semibold">
                  <span className="text-blue-600 dark:text-blue-400 truncate max-w-[220px]">
                    Processing {progress.current} / {progress.total}: {progress.fileName}
                  </span>
                  <span className="font-mono tabular-nums">
                    {Math.round((progress.current / progress.total) * 100)}%
                  </span>
                </div>
                <div className="w-full h-2 bg-slate-200 dark:bg-[#1c263b] rounded-full overflow-hidden">
                  <div
                    className="h-full bg-blue-600 transition-all duration-150"
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
                  <span className="font-bold text-slate-700 dark:text-slate-200">Batch Queue</span>
                  <span aria-hidden="true" className="text-slate-400">·</span>
                  <span className="font-mono tabular-nums text-blue-600 dark:text-blue-400 font-semibold">
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
                          ? 'border-blue-600 bg-blue-600/10'
                          : 'border-slate-200 dark:border-[#1c263b] bg-slate-50 dark:bg-[#141d2f] hover:border-blue-400'
                      }`}
                    >
                      <img
                        src={item.previewDataUrl || item.sourceImg.src}
                        alt={item.origName}
                        className="w-11 h-11 rounded-md object-cover checkerboard border border-slate-200 dark:border-[#2a3752] shrink-0"
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
              <div className="flex items-center gap-2 text-xs">
                <span className="text-sm font-bold text-slate-900 dark:text-slate-100">Split Preview</span>
                <span aria-hidden="true" className="text-slate-400">·</span>
                <span className="text-slate-500 dark:text-slate-400">Checkerboard indicates transparency</span>
              </div>
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
                  <span>Original Source</span>
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
                  {!selectedItem && (
                    <span className="text-xs text-slate-400">Source image preview</span>
                  )}
                </div>
              </div>

              <div className="flex flex-col rounded-lg border border-slate-200 dark:border-[#1c263b] overflow-hidden checkerboard">
                <div className="px-3 py-2 text-[11px] font-semibold bg-slate-200/90 dark:bg-[#141d2f]/90 text-slate-700 dark:text-slate-300 flex justify-between">
                  <span>Transparent PNG Output</span>
                  <span className="text-emerald-600 dark:text-emerald-400">
                    {selectedItem?.outputBlob ? (selectedItem.hasTransparency ? 'Alpha Ready' : 'Opaque') : 'Ready'}
                  </span>
                </div>
                <div className="flex-1 flex items-center justify-center p-4 overflow-hidden">
                  <canvas
                    ref={outCanvasRef}
                    className={`max-w-full max-h-[300px] object-contain ${
                      selectedItem?.previewDataUrl ? '' : 'hidden'
                    }`}
                  />
                  {!selectedItem?.previewDataUrl && (
                    <span className="text-xs text-slate-500 dark:text-slate-400 bg-white/80 dark:bg-[#0f1624]/80 px-3 py-1.5 rounded-md">
                      Transparent output appears here
                    </span>
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
