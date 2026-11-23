import { useCallback, useEffect, useRef, useState } from 'react';
import JSZip from 'jszip';
import { Archive, Download, PenTool, Sparkles, X } from 'lucide-react';
import type { ComplianceRule, SvgItem, ToastType } from '../types/converter';
import {
  MAX_IMAGE_BYTES,
  formatBytes,
  generateDemoBatch,
  loadImageFromFile,
  traceImageToSvg,
  triggerBlobDownload,
} from '../utils/mediaUtils';
import { ComplianceStrip } from './ComplianceStrip';
import { Dropzone } from './Dropzone';

interface SvgConverterProps {
  onToast: (message: string, type?: ToastType) => void;
}

type SvgPreset = 'detailed' | 'flat' | 'logo' | 'ultraclean';

export function SvgConverter({ onToast }: SvgConverterProps) {
  const [items, setItems] = useState<SvgItem[]>([]);
  const [selectedIndex, setSelectedIndex] = useState<number>(-1);
  const [targetMP, setTargetMP] = useState(25);
  const [preset, setPreset] = useState<SvgPreset>('detailed');
  const [colorCount, setColorCount] = useState(16);
  const [smooth, setSmooth] = useState(1.0);
  const [zoom, setZoom] = useState(1.0);

  const [isProcessing, setIsProcessing] = useState(false);
  const [progress, setProgress] = useState<{ current: number; total: number; fileName: string } | null>(null);

  const origCanvasRef = useRef<HTMLCanvasElement | null>(null);
  const svgContainerRef = useRef<HTMLDivElement | null>(null);
  const itemsRef = useRef<SvgItem[]>(items);
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
    const container = svgContainerRef.current;
    if (!container) return;
    if (!selectedItem?.svgString) {
      container.innerHTML = '';
      return;
    }
    container.innerHTML = selectedItem.svgString;
    const svgEl = container.querySelector('svg');
    if (svgEl) {
      svgEl.style.maxWidth = '100%';
      svgEl.style.maxHeight = '290px';
      svgEl.style.width = 'auto';
      svgEl.style.height = 'auto';
      svgEl.style.transform = `scale(${zoom})`;
      svgEl.style.transformOrigin = 'center center';
    }
  }, [selectedItem, zoom]);

  const runBatch = useCallback(
    async (
      targetItems: SvgItem[],
      overrides?: Partial<{ mpVal: number; colorsVal: number; smoothVal: number }>
    ) => {
      if (!targetItems.length) return;
      setIsProcessing(true);
      const mpVal = overrides?.mpVal ?? targetMP;
      const colorsVal = overrides?.colorsVal ?? colorCount;
      const smoothVal = overrides?.smoothVal ?? smooth;

      try {
        const updated = [...targetItems];
        for (let i = 0; i < updated.length; i++) {
          setProgress({ current: i + 1, total: updated.length, fileName: updated[i].origName });
          await new Promise((r) => setTimeout(r, 20));
          const traced = traceImageToSvg(updated[i].sourceImg, mpVal, colorsVal, smoothVal);
          updated[i] = {
            ...updated[i],
            ...traced,
            compliant: traced.byteSize <= MAX_IMAGE_BYTES && traced.mp >= 15.0 && traced.mp <= 65.0,
          };
          setItems([...updated]);
        }
      } catch (err) {
        console.error(err);
        onToast('Batch error tracing SVGs.', 'error');
      } finally {
        setIsProcessing(false);
        setTimeout(() => setProgress(null), 900);
      }
    },
    [targetMP, colorCount, smooth, onToast]
  );

  const addEntries = useCallback(
    (entries: Array<{ img: HTMLImageElement; name: string }>) => {
      const newItems: SvgItem[] = entries.map((entry, i) => ({
        id: `${Date.now()}-${i}-${Math.random().toString(36).slice(2, 6)}`,
        name: `${entry.name.replace(/\.[^/.]+$/, '')}.svg`,
        origName: entry.name,
        sourceImg: entry.img,
        svgString: '',
        byteSize: 0,
        pathCount: 0,
        width: 0,
        height: 0,
        mp: 0,
        compliant: false,
      }));

      const merged = [...itemsRef.current, ...newItems];
      const nextIdx = itemsRef.current.length === 0 ? 0 : itemsRef.current.length;
      setItems(merged);
      setSelectedIndex(nextIdx);
      runBatch(merged);
    },
    [runBatch]
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
        onToast('Please select valid image file(s) for vectorization.', 'warning');
        return;
      }
      addEntries(loaded);
    } catch {
      onToast('Could not load one or more files.', 'error');
    }
  };

  const handleLoadDemo = async () => {
    const demos = await generateDemoBatch('svg');
    addEntries(demos);
  };

  const handleClearAll = () => {
    setItems([]);
    setSelectedIndex(-1);
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

  const handlePresetChange = (nextPreset: SvgPreset) => {
    setPreset(nextPreset);
    let nextColors = 16;
    let nextSmooth = 1.0;
    if (nextPreset === 'flat') {
      nextColors = 8;
      nextSmooth = 1.4;
    } else if (nextPreset === 'logo') {
      nextColors = 3;
      nextSmooth = 1.8;
    } else if (nextPreset === 'ultraclean') {
      nextColors = 12;
      nextSmooth = 2.4;
    }
    setColorCount(nextColors);
    setSmooth(nextSmooth);
    if (items.length) {
      runBatch(items, { colorsVal: nextColors, smoothVal: nextSmooth });
    }
  };

  const handleDownloadSelected = () => {
    if (!selectedItem?.svgString) return;
    const blob = new Blob([selectedItem.svgString], { type: 'image/svg+xml;charset=utf-8' });
    triggerBlobDownload(blob, selectedItem.name);
    onToast(`Downloaded ${selectedItem.name}`, 'success');
  };

  const handleDownloadZip = async () => {
    const ready = items.filter((x) => x.svgString);
    if (!ready.length) return;
    const zip = new JSZip();
    ready.forEach((item, idx) => {
      zip.file(`${String(idx + 1).padStart(2, '0')}-${item.name}`, item.svgString);
    });
    const content = await zip.generateAsync({ type: 'blob' });
    triggerBlobDownload(content, `vectors-svg-batch-${ready.length}-files.zip`);
    onToast(`Exported ${ready.length} Scalable SVGs in ZIP.`, 'success');
  };

  const readyCount = items.filter((x) => x.svgString).length;

  const rules: ComplianceRule[] = [
    {
      id: 'min',
      label: 'Min 15MP',
      detail: selectedItem?.svgString ? `${selectedItem.mp.toFixed(1)} MP ≥ 15MP` : 'Artboard ≥ 15MP',
      status: selectedItem?.svgString ? (selectedItem.mp >= 15.0 ? 'pass' : 'fail') : 'pass',
    },
    {
      id: 'max',
      label: 'Max 65MP',
      detail: selectedItem?.svgString ? `${selectedItem.mp.toFixed(1)} MP ≤ 65MP` : 'Artboard ≤ 65MP',
      status: selectedItem?.svgString ? (selectedItem.mp <= 65.0 ? 'pass' : 'fail') : 'pass',
    },
    {
      id: 'format',
      label: 'SVG Vector',
      detail: 'AI / EPS / SVG ready',
      status: 'pass',
    },
    {
      id: 'size',
      label: 'Max 45MB',
      detail: selectedItem?.svgString
        ? `${formatBytes(selectedItem.byteSize)} / 45 MB`
        : 'Waiting for trace',
      status: selectedItem?.svgString
        ? selectedItem.byteSize <= MAX_IMAGE_BYTES
          ? 'pass'
          : 'fail'
        : 'idle',
    },
  ];

  return (
    <div className="space-y-6">
      <ComplianceStrip
        sectionLabel="Section 3"
        title="Vectors (SVG Tracer & Artboard Scaler)"
        description="Converts raster graphics into clean multi-layer SVG vector paths with 15MP–65MP artboard dimensions."
        rules={rules}
      />

      <div className="grid grid-cols-1 lg:grid-cols-12 gap-6 items-start">
        {/* Left Controls */}
        <div className="lg:col-span-4 space-y-5">
          <Dropzone
            icon={<PenTool className="w-5 h-5" />}
            accentRingClass="border-purple-500 bg-purple-500/5"
            iconBgClass="bg-purple-50 dark:bg-purple-500/10 text-purple-600 dark:text-purple-400"
            promptText="Drop multiple graphics or"
            browseAccentClass="text-purple-600 dark:text-purple-400"
            subtitle="Batch traces PNG, JPG, WEBP into 15–65MP SVG files"
            hasItems={items.length > 0}
            onFilesSelected={handleFilesSelected}
            onLoadDemo={handleLoadDemo}
            onClearAll={handleClearAll}
          />

          {/* Artboard Megapixels */}
          <div className="bg-white dark:bg-[#0f1624] rounded-xl border border-slate-200 dark:border-[#1c263b] p-5 space-y-4">
            <div className="flex items-center justify-between">
              <h3 className="text-xs font-bold tracking-wide text-slate-500 dark:text-slate-400">
                1. Artboard Resolution (15–65MP)
              </h3>
              <span className="text-xs font-mono font-bold tabular-nums text-purple-600 dark:text-purple-400">
                {targetMP.toFixed(1)} MP
              </span>
            </div>

            <div>
              <input
                type="range"
                min={15}
                max={65}
                step={0.5}
                value={targetMP}
                onChange={(e) => setTargetMP(parseFloat(e.target.value))}
                onMouseUp={() => items.length && runBatch(items)}
                onKeyUp={() => items.length && runBatch(items)}
                onTouchEnd={() => items.length && runBatch(items)}
                className="w-full"
              />
              <div className="flex justify-between text-[11px] font-mono tabular-nums text-slate-400 mt-1">
                <span>15 MP (Min)</span>
                <span>40 MP</span>
                <span>65 MP (Max)</span>
              </div>
            </div>

            <div className="grid grid-cols-4 gap-1.5">
              {[15, 25, 40, 65].map((presetMp) => (
                <button
                  key={presetMp}
                  type="button"
                  onClick={() => {
                    setTargetMP(presetMp);
                    if (items.length) runBatch(items, { mpVal: presetMp });
                  }}
                  className={`py-2 rounded-lg text-xs font-mono font-semibold tabular-nums transition-colors ${
                    Math.abs(targetMP - presetMp) < 0.2
                      ? 'bg-purple-600 text-white'
                      : 'bg-slate-100 dark:bg-[#1c263b] hover:bg-purple-600 hover:text-white text-slate-700 dark:text-slate-300'
                  }`}
                >
                  {presetMp} MP
                </button>
              ))}
            </div>
          </div>

          {/* Vector Tracing Engine */}
          <div className="bg-white dark:bg-[#0f1624] rounded-xl border border-slate-200 dark:border-[#1c263b] p-5 space-y-4">
            <h3 className="text-xs font-bold tracking-wide text-slate-500 dark:text-slate-400">
              2. Vector Tracing Engine
            </h3>

            <div>
              <label htmlFor="svg-preset-select" className="block text-xs font-medium text-slate-700 dark:text-slate-300 mb-1.5">
                Tracing Mode Preset
              </label>
              <select
                id="svg-preset-select"
                value={preset}
                onChange={(e) => handlePresetChange(e.target.value as SvgPreset)}
                className="w-full rounded-lg bg-slate-100 dark:bg-[#1c263b] border border-slate-200 dark:border-[#2a3752] px-3 py-2 text-xs font-semibold text-slate-900 dark:text-slate-100 focus:outline-none focus:ring-2 focus:ring-purple-500"
              >
                <option value="detailed">Detailed Color Illustration (16 Colors)</option>
                <option value="flat">Flat Vector Graphic (8 Colors)</option>
                <option value="logo">Logo / Clean Silhouette (3 Colors)</option>
                <option value="ultraclean">Ultra-Clean Smooth Paths (12 Colors)</option>
              </select>
            </div>

            <div>
              <div className="flex justify-between text-xs mb-1.5">
                <span className="font-medium text-slate-700 dark:text-slate-300">Color Palette Count</span>
                <span className="font-mono font-bold tabular-nums text-purple-600 dark:text-purple-400">
                  {colorCount}
                </span>
              </div>
              <input
                type="range"
                min={2}
                max={32}
                value={colorCount}
                onChange={(e) => setColorCount(parseInt(e.target.value, 10))}
                onMouseUp={() => items.length && runBatch(items)}
                onKeyUp={() => items.length && runBatch(items)}
                onTouchEnd={() => items.length && runBatch(items)}
                className="w-full"
              />
            </div>

            <div>
              <div className="flex justify-between text-xs mb-1.5">
                <span className="font-medium text-slate-700 dark:text-slate-300">Path Smoothing</span>
                <span className="font-mono font-bold tabular-nums text-purple-600 dark:text-purple-400">
                  {smooth.toFixed(1)}
                </span>
              </div>
              <input
                type="range"
                min={0.2}
                max={3.0}
                step={0.2}
                value={smooth}
                onChange={(e) => setSmooth(parseFloat(e.target.value))}
                onMouseUp={() => items.length && runBatch(items)}
                onKeyUp={() => items.length && runBatch(items)}
                onTouchEnd={() => items.length && runBatch(items)}
                className="w-full"
              />
            </div>

            <button
              type="button"
              onClick={() => runBatch(items)}
              disabled={!items.length || isProcessing}
              className="w-full py-2.5 px-4 rounded-xl font-bold text-sm bg-purple-600 hover:bg-purple-700 disabled:opacity-40 disabled:cursor-not-allowed text-white transition-colors flex items-center justify-center gap-2"
            >
              <Sparkles className="w-4 h-4" />
              <span className="whitespace-nowrap">
                {items.length ? `Vectorize All (${items.length}) to Scalable SVG` : 'Vectorize All to Scalable SVG'}
              </span>
            </button>

            {progress && (
              <div className="space-y-1.5 pt-1">
                <div className="flex justify-between text-[11px] font-semibold">
                  <span className="text-purple-600 dark:text-purple-400 truncate max-w-[220px]">
                    Tracing {progress.current} / {progress.total}: {progress.fileName}
                  </span>
                  <span className="font-mono tabular-nums">
                    {Math.round((progress.current / progress.total) * 100)}%
                  </span>
                </div>
                <div className="w-full h-2 bg-slate-200 dark:bg-[#1c263b] rounded-full overflow-hidden">
                  <div
                    className="h-full bg-purple-600 transition-all duration-150"
                    style={{ width: `${Math.round((progress.current / progress.total) * 100)}%` }}
                  />
                </div>
              </div>
            )}
          </div>
        </div>

        {/* Right Inspector & Queue */}
        <div className="lg:col-span-8 flex flex-col gap-5">
          {items.length > 0 && (
            <div className="bg-white dark:bg-[#0f1624] rounded-xl border border-slate-200 dark:border-[#1c263b] p-4">
              <div className="flex items-center justify-between mb-3">
                <div className="flex items-center gap-2 text-xs">
                  <span className="font-bold text-slate-700 dark:text-slate-200">Vector Batch Queue</span>
                  <span aria-hidden="true" className="text-slate-400">·</span>
                  <span className="font-mono tabular-nums text-purple-600 dark:text-purple-400 font-semibold">
                    {items.length} file{items.length > 1 ? 's' : ''}
                  </span>
                </div>
                <span className="text-[11px] text-slate-500 dark:text-slate-400">
                  Click any item to inspect paths
                </span>
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-3 gap-2.5 max-h-[220px] overflow-y-auto pr-1">
                {items.map((item, idx) => {
                  const isSelected = idx === selectedIndex;
                  const statusLabel = !item.svgString ? 'QUEUED' : item.compliant ? 'PASS' : 'FAIL';
                  const statusClass = !item.svgString
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
                          ? 'border-purple-600 bg-purple-600/10'
                          : 'border-slate-200 dark:border-[#1c263b] bg-slate-50 dark:bg-[#141d2f] hover:border-purple-400'
                      }`}
                    >
                      <img
                        src={item.sourceImg.src}
                        alt={item.origName}
                        className="w-11 h-11 rounded-md object-cover checkerboard border border-slate-200 dark:border-[#2a3752] shrink-0"
                      />
                      <div className="min-w-0 flex-1">
                        <div className="text-xs font-semibold truncate text-slate-900 dark:text-slate-100">
                          {item.origName}
                        </div>
                        <div className="text-[11px] font-mono tabular-nums text-slate-500 dark:text-slate-400 mt-0.5">
                          {item.mp ? `${item.mp.toFixed(1)}MP Artboard` : 'Pending'} ·{' '}
                          {item.byteSize ? formatBytes(item.byteSize) : '—'}
                        </div>
                        <div className="mt-0.5 flex items-center gap-1.5 text-[10px]">
                          <span className={`font-bold ${statusClass}`}>{statusLabel}</span>
                          {item.pathCount > 0 && (
                            <>
                              <span aria-hidden="true" className="text-slate-400">·</span>
                              <span className="font-mono tabular-nums text-slate-500 dark:text-slate-400">
                                {item.pathCount} paths
                              </span>
                            </>
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

          {/* Vector Inspector Stage */}
          <div className="bg-white dark:bg-[#0f1624] rounded-xl border border-slate-200 dark:border-[#1c263b] p-5 flex flex-col">
            <div className="flex flex-wrap items-center justify-between gap-2 pb-3 mb-4 border-b border-slate-200 dark:border-[#1c263b]">
              <div className="flex items-center gap-3">
                <span className="text-sm font-bold text-slate-900 dark:text-slate-100">
                  Vector Path Inspector
                </span>
                <div className="flex items-center gap-1 bg-slate-100 dark:bg-[#1c263b] rounded-lg p-1">
                  <button
                    type="button"
                    aria-label="Zoom out vector preview"
                    onClick={() => setZoom((z) => Math.max(0.25, z * 0.8))}
                    className="px-2 py-0.5 text-xs font-bold hover:bg-white dark:hover:bg-[#2a3752] rounded transition-colors"
                  >
                    -
                  </button>
                  <span className="text-[11px] font-mono font-semibold tabular-nums px-1.5">
                    {Math.round(zoom * 100)}%
                  </span>
                  <button
                    type="button"
                    aria-label="Zoom in vector preview"
                    onClick={() => setZoom((z) => Math.min(4, z * 1.25))}
                    className="px-2 py-0.5 text-xs font-bold hover:bg-white dark:hover:bg-[#2a3752] rounded transition-colors"
                  >
                    +
                  </button>
                </div>
              </div>

              <div className="flex flex-wrap items-center gap-3 text-xs font-medium text-slate-500 dark:text-slate-400 font-mono tabular-nums">
                <span>
                  Artboard:{' '}
                  <strong className="text-slate-900 dark:text-white">
                    {selectedItem?.width ? `${selectedItem.width} × ${selectedItem.height} px` : '—'}
                  </strong>
                </span>
                <span>
                  Megapixels:{' '}
                  <strong className="text-slate-900 dark:text-white">
                    {selectedItem?.mp ? `${selectedItem.mp.toFixed(2)} MP` : '—'}
                  </strong>
                </span>
                <span>
                  SVG Size:{' '}
                  <strong className="text-slate-900 dark:text-white">
                    {selectedItem?.byteSize ? formatBytes(selectedItem.byteSize) : '—'}
                  </strong>
                </span>
              </div>
            </div>

            <div className="grid grid-cols-1 md:grid-cols-2 gap-4 min-h-[340px]">
              <div className="flex flex-col rounded-lg border border-slate-200 dark:border-[#1c263b] overflow-hidden bg-slate-100 dark:bg-[#090d16]">
                <div className="px-3 py-2 text-[11px] font-semibold bg-slate-200/70 dark:bg-[#141d2f] text-slate-700 dark:text-slate-300 flex justify-between">
                  <span>Raster Source</span>
                  <span className="font-mono tabular-nums">
                    {selectedItem
                      ? `${selectedItem.sourceImg.width}×${selectedItem.sourceImg.height} px`
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
                  {!selectedItem && <span className="text-xs text-slate-400">Raster source preview</span>}
                </div>
              </div>

              <div className="flex flex-col rounded-lg border border-slate-200 dark:border-[#1c263b] overflow-hidden checkerboard">
                <div className="px-3 py-2 text-[11px] font-semibold bg-slate-200/90 dark:bg-[#141d2f]/90 text-slate-700 dark:text-slate-300 flex justify-between">
                  <span>Traced Vector (.SVG)</span>
                  <span className="font-mono tabular-nums text-purple-600 dark:text-purple-400">
                    {selectedItem?.pathCount ? `${selectedItem.pathCount.toLocaleString()} paths` : '0 paths'}
                  </span>
                </div>
                <div className="flex-1 flex items-center justify-center p-4 overflow-auto relative">
                  <div
                    ref={svgContainerRef}
                    className={`flex items-center justify-center ${
                      selectedItem?.svgString ? '' : 'hidden'
                    }`}
                  />
                  {!selectedItem?.svgString && (
                    <span className="text-xs text-slate-500 dark:text-slate-400 bg-white/80 dark:bg-[#0f1624]/80 px-3 py-1.5 rounded-md">
                      Traced vector artwork appears here
                    </span>
                  )}
                </div>
              </div>
            </div>

            <div className="mt-4 pt-4 border-t border-slate-200 dark:border-[#1c263b] flex flex-col sm:flex-row items-center justify-between gap-3">
              <p className="text-[11px] text-slate-500 dark:text-slate-400">
                Output is standard XML <code className="font-mono">.svg</code> (15MP–65MP viewBox) importable into Adobe Illustrator (.AI) or EPS workflows.
              </p>
              <div className="flex flex-wrap items-center gap-2 w-full sm:w-auto justify-end shrink-0">
                <button
                  type="button"
                  onClick={handleDownloadSelected}
                  disabled={!selectedItem?.svgString || selectedItem.byteSize > MAX_IMAGE_BYTES}
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
