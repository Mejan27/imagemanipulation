import ImageTracer from 'imagetracerjs';
import type {
  ConverterSection,
  VideoAspectRatio,
  VideoMotionType,
  VideoResolutionPreset,
} from '../types/converter';

export const MAX_IMAGE_BYTES = 45 * 1024 * 1024; // 45 MB
export const MAX_VIDEO_BYTES = 3900 * 1024 * 1024; // 3,900 MB

export function formatBytes(bytes: number): string {
  if (!bytes || bytes <= 0) return '0 B';
  const units = ['B', 'KB', 'MB', 'GB'];
  const i = Math.min(units.length - 1, Math.floor(Math.log(bytes) / Math.log(1024)));
  return `${(bytes / Math.pow(1024, i)).toFixed(i === 0 ? 0 : 2)} ${units[i]}`;
}

export function hexToRgb(hex: string): { r: number; g: number; b: number } {
  const num = parseInt(hex.replace('#', ''), 16);
  return { r: (num >> 16) & 255, g: (num >> 8) & 255, b: num & 255 };
}

export function computeTargetDimensions(
  origW: number,
  origH: number,
  targetMP: number
): { width: number; height: number; mp: number } {
  const targetPixels = targetMP * 1_000_000;
  const aspect = origW / Math.max(1, origH);
  let height = Math.round(Math.sqrt(targetPixels / aspect));
  let width = Math.round(height * aspect);
  if ((width * height) / 1_000_000 > 100) {
    const shrink = Math.sqrt((99.8 * 1_000_000) / (width * height));
    width = Math.floor(width * shrink);
    height = Math.floor(height * shrink);
  }
  return {
    width: Math.max(1, width),
    height: Math.max(1, height),
    mp: (width * height) / 1_000_000,
  };
}

export function loadImageFromFile(file: File): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = (e) => {
      const img = new Image();
      img.onload = () => resolve(img);
      img.onerror = reject;
      img.src = String(e.target?.result ?? '');
    };
    reader.onerror = reject;
    reader.readAsDataURL(file);
  });
}

export function createDemoGraphicCanvas(variant: number): HTMLCanvasElement {
  const c = document.createElement('canvas');
  c.width = 1200;
  c.height = 900;
  const ctx = c.getContext('2d')!;
  ctx.fillStyle = '#ffffff';
  ctx.fillRect(0, 0, c.width, c.height);

  const palettes = [
    ['#2563eb', '#7c3aed', '#ec4899', '#fbbf24'],
    ['#059669', '#0d9488', '#0284c7', '#f59e0b'],
    ['#e11d48', '#f97316', '#eab308', '#3b82f6'],
  ];
  const p = palettes[variant % palettes.length];
  const grad = ctx.createLinearGradient(300, 150, 900, 750);
  grad.addColorStop(0, p[0]);
  grad.addColorStop(0.5, p[1]);
  grad.addColorStop(1, p[2]);

  ctx.fillStyle = grad;
  ctx.beginPath();
  if (variant % 3 === 0) {
    ctx.arc(600, 450, 310, 0, Math.PI * 2);
  } else if (variant % 3 === 1) {
    ctx.roundRect(300, 180, 600, 540, 80);
  } else {
    ctx.moveTo(600, 130);
    ctx.lineTo(920, 450);
    ctx.lineTo(600, 770);
    ctx.lineTo(280, 450);
    ctx.closePath();
  }
  ctx.fill();

  ctx.fillStyle = p[3];
  ctx.beginPath();
  ctx.moveTo(600, 220);
  ctx.lineTo(780, 550);
  ctx.lineTo(420, 550);
  ctx.closePath();
  ctx.fill();

  ctx.fillStyle = '#0f172a';
  ctx.beginPath();
  ctx.arc(600, 465, 80, 0, Math.PI * 2);
  ctx.fill();
  return c;
}

export function createDemoSceneCanvas(variant: number): HTMLCanvasElement {
  const c = document.createElement('canvas');
  c.width = 1200;
  c.height = 900;
  const ctx = c.getContext('2d')!;
  const themes = [
    ['#0f172a', '#1e3a8a', '#f97316', '#fde047', '#fef08a', '#1e293b'],
    ['#064e3b', '#047857', '#34d399', '#a7f3d0', '#ecfdf5', '#022c22'],
    ['#31102f', '#701a75', '#db2777', '#f472b6', '#fbcfe8', '#1f091d'],
  ];
  const t = themes[variant % themes.length];
  const sky = ctx.createLinearGradient(0, 0, 0, 900);
  sky.addColorStop(0, t[0]);
  sky.addColorStop(0.45, t[1]);
  sky.addColorStop(0.75, t[2]);
  sky.addColorStop(1, t[3]);
  ctx.fillStyle = sky;
  ctx.fillRect(0, 0, 1200, 900);

  ctx.fillStyle = t[4];
  ctx.beginPath();
  ctx.arc(450 + variant * 150, 510, 125, 0, Math.PI * 2);
  ctx.fill();

  ctx.fillStyle = t[5];
  ctx.beginPath();
  ctx.moveTo(0, 900);
  ctx.lineTo(0, 620);
  ctx.lineTo(340, 430 + variant * 20);
  ctx.lineTo(660, 640);
  ctx.lineTo(960, 410 - variant * 15);
  ctx.lineTo(1200, 580);
  ctx.lineTo(1200, 900);
  ctx.closePath();
  ctx.fill();
  return c;
}

export async function generateDemoBatch(
  section: ConverterSection
): Promise<Array<{ img: HTMLImageElement; name: string }>> {
  const demos: Array<{ img: HTMLImageElement; name: string }> = [];
  for (let i = 0; i < 3; i++) {
    const c =
      section === 'png' || section === 'svg'
        ? createDemoGraphicCanvas(i)
        : createDemoSceneCanvas(i);
    const img = await new Promise<HTMLImageElement>((resolve) => {
      const im = new Image();
      im.onload = () => resolve(im);
      im.src = c.toDataURL('image/png');
    });
    demos.push({ img, name: `demo-${section}-${i + 1}.png` });
  }
  return demos;
}

export function sampleCornerHex(img: HTMLImageElement): { hex: string | null; isTransparent: boolean } {
  const c = document.createElement('canvas');
  c.width = 64;
  c.height = 64;
  const ctx = c.getContext('2d')!;
  ctx.drawImage(img, 0, 0, 64, 64);
  const data = ctx.getImageData(0, 0, 64, 64).data;
  const r = data[0];
  const g = data[1];
  const b = data[2];
  const a = data[3];
  if (a < 50) {
    return { hex: null, isTransparent: true };
  }
  const hex = '#' + [r, g, b].map((x) => x.toString(16).padStart(2, '0')).join('');
  return { hex, isTransparent: false };
}

export function fallbackVectorize(
  imgData: ImageData,
  w: number,
  h: number,
  artW: number,
  artH: number,
  colors: number
): string {
  const step = Math.max(1, Math.round(256 / Math.max(2, Math.cbrt(colors))));
  const buckets = new Map<string, string[]>();
  const d = imgData.data;
  for (let y = 0; y < h; y++) {
    let x = 0;
    while (x < w) {
      const i = (y * w + x) * 4;
      if (d[i + 3] < 128) {
        x++;
        continue;
      }
      const r = Math.min(255, Math.round(d[i] / step) * step);
      const g = Math.min(255, Math.round(d[i + 1] / step) * step);
      const b = Math.min(255, Math.round(d[i + 2] / step) * step);
      const hex = `#${[r, g, b].map((v) => v.toString(16).padStart(2, '0')).join('')}`;
      let run = 1;
      while (x + run < w) {
        const ni = (y * w + x + run) * 4;
        if (d[ni + 3] < 128) break;
        const nr = Math.min(255, Math.round(d[ni] / step) * step);
        const ng = Math.min(255, Math.round(d[ni + 1] / step) * step);
        const nb = Math.min(255, Math.round(d[ni + 2] / step) * step);
        if (nr !== r || ng !== g || nb !== b) break;
        run++;
      }
      if (!buckets.has(hex)) buckets.set(hex, []);
      buckets.get(hex)!.push(`M${x} ${y}h${run}v1h-${run}z`);
      x += run;
    }
  }
  const sx = (artW / w).toFixed(4);
  const sy = (artH / h).toFixed(4);
  let paths = '';
  buckets.forEach((cmds, color) => {
    paths += `<path fill="${color}" d="${cmds.join('')}"/>`;
  });
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${artW}px" height="${artH}px" viewBox="0 0 ${artW} ${artH}"><g transform="scale(${sx},${sy})">${paths}</g></svg>`;
}

export function traceImageToSvg(
  img: HTMLImageElement,
  targetArtboardMP: number,
  colorCount: number,
  smooth: number
): {
  svgString: string;
  byteSize: number;
  pathCount: number;
  width: number;
  height: number;
  mp: number;
} {
  const traceMax = 420;
  const scale = Math.min(1, traceMax / Math.max(img.width, img.height));
  const tW = Math.max(32, Math.round(img.width * scale));
  const tH = Math.max(32, Math.round(img.height * scale));

  const c = document.createElement('canvas');
  c.width = tW;
  c.height = tH;
  const ctx = c.getContext('2d')!;
  ctx.drawImage(img, 0, 0, tW, tH);
  const imgData = ctx.getImageData(0, 0, tW, tH);

  const artboard = computeTargetDimensions(img.width, img.height, targetArtboardMP);

  let rawSvg = '';
  const tracer = ImageTracer as unknown as {
    imagedataToSVG?: (data: ImageData, opts?: Record<string, unknown>) => string;
  };

  if (tracer && typeof tracer.imagedataToSVG === 'function') {
    rawSvg = tracer.imagedataToSVG(imgData, {
      ltres: smooth,
      qtres: smooth,
      pathomit: Math.round(smooth * 6),
      colorsampling: 2,
      numberofcolors: colorCount,
      mincolorratio: 0,
      colorquantcycles: 3,
      scale: 1,
      roundcoords: 1,
      viewbox: true,
      desc: false,
    });
    const scaleX = (artboard.width / tW).toFixed(4);
    const scaleY = (artboard.height / tH).toFixed(4);
    rawSvg = rawSvg
      .replace(
        /<svg[^>]*>/i,
        `<svg xmlns="http://www.w3.org/2000/svg" version="1.1" width="${artboard.width}px" height="${artboard.height}px" viewBox="0 0 ${artboard.width} ${artboard.height}"><g transform="scale(${scaleX}, ${scaleY})">`
      )
      .replace(/<\/svg>/i, '</g></svg>');
  } else {
    rawSvg = fallbackVectorize(imgData, tW, tH, artboard.width, artboard.height, colorCount);
  }

  const byteSize = new Blob([rawSvg], { type: 'image/svg+xml' }).size;
  const pathMatches = rawSvg.match(/<path/gi);
  const pathCount = pathMatches ? pathMatches.length : 0;

  return {
    svgString: rawSvg,
    byteSize,
    pathCount,
    width: artboard.width,
    height: artboard.height,
    mp: artboard.mp,
  };
}

export function getVideoDimensions(
  resPreset: VideoResolutionPreset,
  aspect: VideoAspectRatio
): { width: number; height: number } {
  const baseMap: Record<VideoResolutionPreset, { long: number; short: number }> = {
    '720p': { long: 1280, short: 720 },
    '1080p': { long: 1920, short: 1080 },
    '4k': { long: 3840, short: 2160 },
  };
  const b = baseMap[resPreset];
  if (aspect === '16:9') return { width: b.long, height: b.short };
  if (aspect === '9:16') return { width: b.short, height: b.long };
  return { width: b.short, height: b.short };
}

export function getSupportedVideoMime(): { mime: string; ext: string; label: string } {
  const candidates = [
    { mime: 'video/mp4;codecs=avc1.42E01E', ext: 'mp4', label: 'H.264 (.mp4)' },
    { mime: 'video/mp4', ext: 'mp4', label: 'MP4 Video (.mp4)' },
    { mime: 'video/webm;codecs=vp9', ext: 'webm', label: 'VP9 (.webm)' },
    { mime: 'video/webm', ext: 'webm', label: 'WebM Video (.webm)' },
  ];
  if (typeof MediaRecorder !== 'undefined') {
    for (const c of candidates) {
      if (MediaRecorder.isTypeSupported(c.mime)) return c;
    }
  }
  return { mime: '', ext: 'webm', label: 'Standard Stream' };
}

export function renderVideoFrameAt(
  ctx: CanvasRenderingContext2D,
  width: number,
  height: number,
  progress: number,
  imageList: HTMLImageElement[],
  motion: VideoMotionType
): void {
  ctx.fillStyle = '#000000';
  ctx.fillRect(0, 0, width, height);
  if (!imageList || !imageList.length) return;

  const count = imageList.length;
  const segLen = 1 / count;
  const idx = Math.min(count - 1, Math.floor(progress / segLen));
  const localT = (progress - idx * segLen) / segLen;

  const drawSlide = (img: HTMLImageElement, t: number, alpha: number) => {
    ctx.save();
    ctx.globalAlpha = alpha;
    const imgAspect = img.width / img.height;
    const canvasAspect = width / height;
    let baseW: number;
    let baseH: number;
    if (imgAspect > canvasAspect) {
      baseH = height;
      baseW = height * imgAspect;
    } else {
      baseW = width;
      baseH = width / imgAspect;
    }

    let scale = 1.0;
    let offsetX = 0;
    let offsetY = 0;

    if (motion === 'zoom-in') {
      scale = 1.0 + 0.14 * t;
    } else if (motion === 'zoom-out') {
      scale = 1.14 - 0.14 * t;
    } else if (motion === 'pan-right') {
      scale = 1.12;
      offsetX = (t - 0.5) * (baseW * 0.1);
    } else if (motion === 'float') {
      scale = 1.08 + 0.04 * Math.sin(t * Math.PI);
      offsetY = Math.sin(t * Math.PI * 2) * (baseH * 0.025);
    } else {
      scale = 1.0;
    }

    const drawW = baseW * scale;
    const drawH = baseH * scale;
    const dx = (width - drawW) / 2 + offsetX;
    const dy = (height - drawH) / 2 + offsetY;
    ctx.drawImage(img, dx, dy, drawW, drawH);
    ctx.restore();
  };

  drawSlide(imageList[idx], localT, 1.0);

  if (count > 1 && idx < count - 1 && localT > 0.82) {
    const fadeT = (localT - 0.82) / 0.18;
    drawSlide(imageList[idx + 1], 0, fadeT);
  }
}

export function triggerBlobDownload(blob: Blob, filename: string): void {
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 2500);
}
