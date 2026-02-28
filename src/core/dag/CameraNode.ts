import { DAGNode } from './DAGNode';
import { Plug, PlugType } from '../dg/Plug';

export enum FilmFit {
  Fill,
  Horizontal,
  Vertical,
  Overscan
}

export class CameraNode extends DAGNode {
  public focalLength: Plug<number>;
  public horizontalFilmAperture: Plug<number>; // in inches
  public verticalFilmAperture: Plug<number>; // in inches
  public nearClip: Plug<number>;
  public farClip: Plug<number>;
  public filmFit: Plug<number>; // FilmFit enum cast to number
  
  constructor(name: string) {
    super(name);
    this.nodeType = 'CameraNode';
    
    // Default 35mm lens, 35mm full aperture sensor
    this.focalLength = this.addPlug('focalLength', PlugType.Float, 35.0);
    this.horizontalFilmAperture = this.addPlug('horizontalFilmAperture', PlugType.Float, 1.417);
    this.verticalFilmAperture = this.addPlug('verticalFilmAperture', PlugType.Float, 0.945);
    this.nearClip = this.addPlug('nearClip', PlugType.Float, 0.1);
    this.farClip = this.addPlug('farClip', PlugType.Float, 10000.0);
    this.filmFit = this.addPlug('filmFit', PlugType.Float, FilmFit.Horizontal as number);
  }

  // Mathematics converting DCC focal length / filmback to standard engine perspective attributes
  public getProjectionData(viewportAspect: number): { fovV: number, aspect: number } {
    const fLen = this.focalLength.getValue();
    const hInch = this.horizontalFilmAperture.getValue();
    const vInch = this.verticalFilmAperture.getValue();
    const fit = this.filmFit.getValue() as FilmFit;

    const hMm = hInch * 25.4;
    const vMm = vInch * 25.4;
    const filmAspect = hMm / vMm;

    let activeVMm = vMm;

    if (fit === FilmFit.Horizontal || (fit === FilmFit.Fill && viewportAspect < filmAspect)) {
      activeVMm = hMm / viewportAspect;
    } else if (fit === FilmFit.Vertical || (fit === FilmFit.Fill && viewportAspect >= filmAspect)) {
      activeVMm = vMm;
    } else if (fit === FilmFit.Overscan) {
      if (viewportAspect < filmAspect) activeVMm = vMm;
      else activeVMm = hMm / viewportAspect;
    }

    const fovRad = 2 * Math.atan(activeVMm / (2 * fLen));
    const fovV = fovRad * (180 / Math.PI); // vertical fov in degrees

    return { fovV, aspect: viewportAspect };
  }
}
