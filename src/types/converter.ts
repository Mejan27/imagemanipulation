export type ConverterSection = 'png' | 'jpeg' | 'svg' | 'video';

export type RuleStatus = 'idle' | 'pass' | 'warn' | 'fail';

export interface ComplianceRule {
  id: string;
  label: string;
  detail: string;
  status: RuleStatus;
}

export type ToastType = 'success' | 'error' | 'warning' | 'info';

export interface ToastMessage {
  id: string;
  message: string;
  type: ToastType;
}

export interface PngItem {
  id: string;
  name: string;
  origName: string;
  sourceImg: HTMLImageElement;
  previewDataUrl: string | null;
  outputBlob: Blob | null;
  width: number;
  height: number;
  mp: number;
  hasTransparency: boolean;
  compliant: boolean;
}

export interface JpegItem {
  id: string;
  name: string;
  origName: string;
  sourceImg: HTMLImageElement;
  previewUrl: string | null;
  outputBlob: Blob | null;
  width: number;
  height: number;
  mp: number;
  compliant: boolean;
}

export interface SvgItem {
  id: string;
  name: string;
  origName: string;
  sourceImg: HTMLImageElement;
  svgString: string;
  byteSize: number;
  pathCount: number;
  width: number;
  height: number;
  mp: number;
  compliant: boolean;
}

export interface VideoItem {
  id: string;
  origName: string;
  img: HTMLImageElement;
  videoBlob: Blob | null;
  videoUrl: string | null;
  ext: string;
}

export type VideoResolutionPreset = '720p' | '1080p' | '4k';
export type VideoAspectRatio = '16:9' | '9:16' | '1:1';
export type VideoBatchMode = 'slideshow' | 'separate';
export type VideoMotionType = 'zoom-in' | 'zoom-out' | 'pan-right' | 'float' | 'static';
