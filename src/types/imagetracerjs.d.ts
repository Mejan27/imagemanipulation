declare module 'imagetracerjs' {
  export interface TraceOptions {
    ltres?: number;
    qtres?: number;
    pathomit?: number;
    colorsampling?: number;
    numberofcolors?: number;
    mincolorratio?: number;
    colorquantcycles?: number;
    scale?: number;
    roundcoords?: number;
    viewbox?: boolean;
    desc?: boolean;
  }

  export function imagedataToSVG(imgd: ImageData, options?: TraceOptions): string;
  const ImageTracer: {
    imagedataToSVG: typeof imagedataToSVG;
  };
  export default ImageTracer;
}
