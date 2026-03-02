import { describe, it, expect } from 'vitest';
import { CameraNode, FilmFit } from '../dag/CameraNode';

describe('CameraNode - Cinematic Math Validations', () => {
  it('Computes default 35mm lens Vertical FOV accurately', () => {
    const cam = new CameraNode('TestCam');
    
    // Default is 35mm focal length, Vertical Aperture = 0.945 inches, Horizontal Aperture = 1.417
    const filmAspect = (1.417 * 25.4) / (0.945 * 25.4);
    
    // We pass the exact film aspect so no cropping occurs due to fit modes
    const projection = cam.getProjectionData(filmAspect); 
    
    // Mathematics verification (0.945 in = ~24mm vertical sensor)
    // Vertical FOV = 2 * atan((0.945 * 25.4) / (2 * 35)) = ~37.849 degrees
    expect(projection.fovV).toBeCloseTo(37.849, 2);
  });

  it('Adjusts FOV dynamically when FilmFit is Horizontal', () => {
    const cam = new CameraNode('TestCam');
    cam.filmFit.setValue(FilmFit.Horizontal);

    // 16:9 Screen (wider than 35mm film aspect which is ~ 1.5)
    // Should crop top and bottom, meaning the effective vertical sensor drops.
    const projWidescreen = cam.getProjectionData(16 / 9);
    
    // 1:1 Screen 
    // Means horizontal drives it, requires expanding vertical FOV
    const projSquare = cam.getProjectionData(1);

    expect(projWidescreen.fovV).toBeLessThan(projSquare.fovV);
  });

  it('Overscan shows LARGER fovV than Fill for the same viewport aspect', () => {
    // With a 16:9 render (wider than 35mm film 1.5 aspect):
    //   Fill      → Horizontal fit → crops top/bottom      → smaller fovV (tighter)
    //   Overscan  → Vertical   fit → full film height shown → fovV = native vertical fov
    const viewAspect = 16 / 9;

    const camFill = new CameraNode('Fill');
    camFill.filmFit.setValue(FilmFit.Fill);
    const { fovV: fovFill } = camFill.getProjectionData(viewAspect);

    const camOver = new CameraNode('Overscan');
    camOver.filmFit.setValue(FilmFit.Overscan);
    const { fovV: fovOver } = camOver.getProjectionData(viewAspect);

    // Overscan must show a bigger vertical field than Fill
    expect(fovOver).toBeGreaterThan(fovFill);

    // Overscan fovV with wider render == native vertical fov (vMm/fl based)
    const vMm = 0.945 * 25.4;
    const fl  = 35;
    const nativeFovV = 2 * Math.atan(vMm / (2 * fl)) * (180 / Math.PI);
    expect(fovOver).toBeCloseTo(nativeFovV, 2);

    // Fill fovV must be less than native (it crops by using the horizontal sensor drive)
    expect(fovFill).toBeLessThan(nativeFovV);
  });
});
