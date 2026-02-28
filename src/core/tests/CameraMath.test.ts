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
});
