/**
 * Camera Sensor Presets
 * Source: https://vfxcamdb.com/ (sensor dimensions) + traditional film formats.
 *
 * All filmback values are stored in INCHES (Maya convention).
 * hAperture = sensor width  in inches = mm / 25.4
 * vAperture = sensor height in inches = mm / 25.4
 *
 * For multi-format cameras the "primary" (largest native) mode is used.
 */

export interface CameraPreset {
  /** Display name shown in the dropdown */
  name: string;
  /** Sensor / film-gate width in inches */
  hAperture: number;
  /** Sensor / film-gate height in inches */
  vAperture: number;
  /** Typical (native) focal length in mm — applied with the preset */
  focalLength: number;
  /** Extra info shown as a tooltip */
  notes?: string;
}

export interface CameraPresetGroup {
  group: string;
  presets: CameraPreset[];
}

// ─── Helpers ───────────────────────────────────────────────────────────────────
/** Convert mm to inches (3 decimal places precision) */
const mm = (w: number, h: number): [number, number] => [
  Math.round((w / 25.4) * 1000) / 1000,
  Math.round((h / 25.4) * 1000) / 1000,
];

// ─── Preset Database ───────────────────────────────────────────────────────────
export const CAMERA_PRESET_GROUPS: CameraPresetGroup[] = [
  // ── Traditional Film ────────────────────────────────────────────────────────
  {
    group: 'Film Formats',
    presets: [
      {
        name: '35mm Full Aperture (Academy Silent)',
        ...(() => { const [h, v] = mm(24.89, 18.67); return { hAperture: h, vAperture: v }; })(),
        focalLength: 35,
        notes: '35mm full aperture / silent gate – 0.980 × 0.735 in',
      },
      {
        name: '35mm Academy (Sound)',
        ...(() => { const [h, v] = mm(21.95, 16.00); return { hAperture: h, vAperture: v }; })(),
        focalLength: 35,
        notes: '35mm Academy sound gate – 0.864 × 0.630 in',
      },
      {
        name: '35mm Anamorphic (2x Squeeze)',
        ...(() => { const [h, v] = mm(21.95, 18.59); return { hAperture: h, vAperture: v }; })(),
        focalLength: 35,
        notes: '35mm CinemaScope / Panavision anamorphic gate',
      },
      {
        name: '35mm Super 35 (Full Frame)',
        ...(() => { const [h, v] = mm(24.89, 18.67); return { hAperture: h, vAperture: v }; })(),
        focalLength: 35,
        notes: 'Super 35 full frame – same physical gate as Silent',
      },
      {
        name: '35mm 1.85:1 Flat',
        ...(() => { const [h, v] = mm(20.96, 11.33); return { hAperture: h, vAperture: v }; })(),
        focalLength: 35,
        notes: '35mm flat 1.85:1 theatrical print aperture',
      },
      {
        name: '35mm 2.39:1 Scope (2x Anamorphic)',
        ...(() => { const [h, v] = mm(21.95, 9.19); return { hAperture: h, vAperture: v }; })(),
        focalLength: 35,
        notes: '35mm projected scope (2.39:1)',
      },
      {
        name: 'VistaVision (8-perf 35mm)',
        ...(() => { const [h, v] = mm(37.72, 25.17); return { hAperture: h, vAperture: v }; })(),
        focalLength: 50,
        notes: 'VistaVision horizontal 8-perf – 1.485 × 0.991 in',
      },
      {
        name: '65mm / 70mm IMAX Film',
        ...(() => { const [h, v] = mm(70.41, 52.63); return { hAperture: h, vAperture: v }; })(),
        focalLength: 75,
        notes: 'IMAX 70mm film gate – 2.772 × 2.072 in',
      },
      {
        name: '16mm Standard',
        ...(() => { const [h, v] = mm(10.26, 7.49); return { hAperture: h, vAperture: v }; })(),
        focalLength: 25,
        notes: '16mm standard gate – 0.404 × 0.295 in',
      },
      {
        name: 'Super 16mm',
        ...(() => { const [h, v] = mm(12.52, 7.41); return { hAperture: h, vAperture: v }; })(),
        focalLength: 25,
        notes: 'Super 16mm gate – 0.493 × 0.292 in',
      },
    ],
  },

  // ── ARRI ─────────────────────────────────────────────────────────────────────
  {
    group: 'ARRI',
    presets: [
      {
        name: 'ARRI ALEXA 65 – Open Gate (6.5K)',
        ...(() => { const [h, v] = mm(54.12, 25.58); return { hAperture: h, vAperture: v }; })(),
        focalLength: 65,
        notes: '6560×3100  54.12×25.58 mm  (source: vfxcamdb.com)',
      },
      {
        name: 'ARRI ALEXA LF – Open Gate (4.5K)',
        ...(() => { const [h, v] = mm(36.70, 25.54); return { hAperture: h, vAperture: v }; })(),
        focalLength: 40,
        notes: '4448×3096  36.70×25.54 mm  (source: vfxcamdb.com)',
      },
      {
        name: 'ARRI ALEXA LF – 4K UHD 16:9',
        ...(() => { const [h, v] = mm(31.68, 17.82); return { hAperture: h, vAperture: v }; })(),
        focalLength: 35,
        notes: '3840×2160  31.68×17.82 mm  (source: vfxcamdb.com)',
      },
      {
        name: 'ARRI ALEXA Mini – Open Gate (3.4K)',
        ...(() => { const [h, v] = mm(28.25, 18.17); return { hAperture: h, vAperture: v }; })(),
        focalLength: 35,
        notes: '3424×2202  28.25×18.17 mm  (source: vfxcamdb.com)',
      },
      {
        name: 'ARRI ALEXA Mini – 4K UHD 16:9',
        ...(() => { const [h, v] = mm(26.40, 14.85); return { hAperture: h, vAperture: v }; })(),
        focalLength: 35,
        notes: '3840×2160  26.40×14.85 mm  (source: vfxcamdb.com)',
      },
      {
        name: 'ARRI ALEXA Mini – 2.8K 4:3',
        ...(() => { const [h, v] = mm(23.76, 17.82); return { hAperture: h, vAperture: v }; })(),
        focalLength: 35,
        notes: '2880×2160  23.76×17.82 mm  (source: vfxcamdb.com)',
      },
      {
        name: 'ARRI ALEXA SXT / XT – ARRIRAW 3.2K',
        ...(() => { const [h, v] = mm(28.17, 18.13); return { hAperture: h, vAperture: v }; })(),
        focalLength: 35,
        notes: '3414×2198  28.17×18.13 mm  (S35 Open Gate)',
      },
    ],
  },

  // ── Sony ──────────────────────────────────────────────────────────────────────
  {
    group: 'Sony',
    presets: [
      {
        name: 'Sony VENICE – Full Frame 6K 3:2',
        ...(() => { const [h, v] = mm(35.9, 24.0); return { hAperture: h, vAperture: v }; })(),
        focalLength: 40,
        notes: '6048×4032  35.9×24.0 mm  (source: vfxcamdb.com)',
      },
      {
        name: 'Sony VENICE – Full Frame 6K 1.85:1',
        ...(() => { const [h, v] = mm(36.0, 19.4); return { hAperture: h, vAperture: v }; })(),
        focalLength: 40,
        notes: '6054×3272  36.0×19.4 mm  (source: vfxcamdb.com)',
      },
      {
        name: 'Sony VENICE – Super35 4K DCI',
        ...(() => { const [h, v] = mm(24.3, 12.8); return { hAperture: h, vAperture: v }; })(),
        focalLength: 35,
        notes: '4096×2160  24.3×12.8 mm  (source: vfxcamdb.com)',
      },
      {
        name: 'Sony VENICE – 4K Anamorphic 4:3',
        ...(() => { const [h, v] = mm(24.3, 18.0); return { hAperture: h, vAperture: v }; })(),
        focalLength: 40,
        notes: '4096×3024  24.3×18.0 mm  (source: vfxcamdb.com)',
      },
      {
        name: 'Sony α7S III / A7S II (Full Frame)',
        ...(() => { const [h, v] = mm(35.6, 23.8); return { hAperture: h, vAperture: v }; })(),
        focalLength: 35,
        notes: 'Sony A7S series full-frame CMOS  35.6×23.8 mm',
      },
      {
        name: 'Sony FX9 – Full Frame 6K',
        ...(() => { const [h, v] = mm(35.6, 23.8); return { hAperture: h, vAperture: v }; })(),
        focalLength: 35,
        notes: 'Sony FX9 full-frame sensor  35.6×23.8 mm',
      },
    ],
  },

  // ── RED ──────────────────────────────────────────────────────────────────────
  {
    group: 'RED',
    presets: [
      {
        name: 'RED WEAPON HELIUM 8K S35 – FF',
        ...(() => { const [h, v] = mm(29.90, 15.77); return { hAperture: h, vAperture: v }; })(),
        focalLength: 35,
        notes: '8192×4320  29.90×15.77 mm  (source: vfxcamdb.com)',
      },
      {
        name: 'RED WEAPON DRAGON 6K S35 – FF',
        ...(() => { const [h, v] = mm(30.70, 15.80); return { hAperture: h, vAperture: v }; })(),
        focalLength: 35,
        notes: '6144×3160  30.70×15.80 mm  (source: vfxcamdb.com)',
      },
      {
        name: 'RED WEAPON DRAGON 6K – 4K HD',
        ...(() => { const [h, v] = mm(19.19, 10.79); return { hAperture: h, vAperture: v }; })(),
        focalLength: 35,
        notes: '3840×2160  19.19×10.79 mm  (source: vfxcamdb.com)',
      },
      {
        name: 'RED MONSTRO 8K VV – Full Frame',
        ...(() => { const [h, v] = mm(40.96, 21.60); return { hAperture: h, vAperture: v }; })(),
        focalLength: 50,
        notes: 'RED MONSTRO VistaVision format  40.96×21.60 mm',
      },
      {
        name: 'RED RAVEN 4.5K – FF',
        ...(() => { const [h, v] = mm(23.04, 12.16); return { hAperture: h, vAperture: v }; })(),
        focalLength: 35,
        notes: 'RED RAVEN 4.5K FF  23.04×12.16 mm',
      },
    ],
  },

  // ── Blackmagic ───────────────────────────────────────────────────────────────
  {
    group: 'Blackmagic',
    presets: [
      {
        name: 'Blackmagic URSA Mini Pro 4.6K – 16:9',
        ...(() => { const [h, v] = mm(25.34, 14.25); return { hAperture: h, vAperture: v }; })(),
        focalLength: 35,
        notes: '4608×2592  25.34×14.25 mm  (source: vfxcamdb.com)',
      },
      {
        name: 'Blackmagic URSA Mini Pro 4.6K – DCI 4K',
        ...(() => { const [h, v] = mm(22.52, 11.87); return { hAperture: h, vAperture: v }; })(),
        focalLength: 35,
        notes: '4096×2160  22.52×11.87 mm  (source: vfxcamdb.com)',
      },
      {
        name: 'Blackmagic Pocket Cinema 6K',
        ...(() => { const [h, v] = mm(23.1, 12.99); return { hAperture: h, vAperture: v }; })(),
        focalLength: 35,
        notes: 'BMPCC 6K Super 35  23.1×12.99 mm',
      },
      {
        name: 'Blackmagic Pocket Cinema 4K',
        ...(() => { const [h, v] = mm(18.96, 10.00); return { hAperture: h, vAperture: v }; })(),
        focalLength: 35,
        notes: 'BMPCC 4K Micro Four Thirds  18.96×10.0 mm',
      },
    ],
  },

  // ── Canon ──────────────────────────────────────────────────────────────────
  {
    group: 'Canon',
    presets: [
      {
        name: 'Canon EOS 5D Mark IV (Full Frame)',
        ...(() => { const [h, v] = mm(36.00, 20.25); return { hAperture: h, vAperture: v }; })(),
        focalLength: 35,
        notes: '36.0×20.25 mm  (source: vfxcamdb.com)',
      },
      {
        name: 'Canon EOS 5D Mark III (Full Frame)',
        ...(() => { const [h, v] = mm(36.00, 24.00); return { hAperture: h, vAperture: v }; })(),
        focalLength: 35,
        notes: 'Canon 5D Mk3 full-frame stills sensor  36×24 mm',
      },
      {
        name: 'Canon EOS 7D Mark II (APS-C)',
        ...(() => { const [h, v] = mm(22.40, 14.96); return { hAperture: h, vAperture: v }; })(),
        focalLength: 24,
        notes: 'Canon APS-C sensor  22.4×14.96 mm',
      },
      {
        name: 'Canon C300 Mark II / C500 (Super 35)',
        ...(() => { const [h, v] = mm(26.20, 13.80); return { hAperture: h, vAperture: v }; })(),
        focalLength: 35,
        notes: 'Canon Cinema EOS Super 35  26.2×13.8 mm',
      },
    ],
  },

  // ── Nikon ─────────────────────────────────────────────────────────────────
  {
    group: 'Nikon',
    presets: [
      {
        name: 'Nikon D850 (Full Frame)',
        ...(() => { const [h, v] = mm(35.9, 23.9); return { hAperture: h, vAperture: v }; })(),
        focalLength: 35,
        notes: 'Nikon D850 FX sensor  35.9×23.9 mm',
      },
      {
        name: 'Nikon D500 (APS-C / DX)',
        ...(() => { const [h, v] = mm(23.5, 15.7); return { hAperture: h, vAperture: v }; })(),
        focalLength: 24,
        notes: 'Nikon DX sensor  23.5×15.7 mm',
      },
    ],
  },

  // ── DJI / Drone ──────────────────────────────────────────────────────────
  {
    group: 'DJI / Drone',
    presets: [
      {
        name: 'DJI Zenmuse X7 (Super 35)',
        ...(() => { const [h, v] = mm(23.5, 15.7); return { hAperture: h, vAperture: v }; })(),
        focalLength: 35,
        notes: 'DJI X7 Super 35  23.5×15.7 mm',
      },
      {
        name: 'DJI Zenmuse X5S (Micro 4/3)',
        ...(() => { const [h, v] = mm(17.3, 13.0); return { hAperture: h, vAperture: v }; })(),
        focalLength: 25,
        notes: 'DJI X5S MFT  17.3×13.0 mm',
      },
      {
        name: 'DJI Mavic 3 (4/3 sensor)',
        ...(() => { const [h, v] = mm(17.3, 13.0); return { hAperture: h, vAperture: v }; })(),
        focalLength: 24,
        notes: 'DJI Mavic 3 Hasselblad 4/3 sensor  17.3×13.0 mm',
      },
    ],
  },

  // ── Action ───────────────────────────────────────────────────────────────
  {
    group: 'Action / Sport',
    presets: [
      {
        name: 'GoPro HERO 7 Black (1/2.3")',
        ...(() => { const [h, v] = mm(6.17, 4.63); return { hAperture: h, vAperture: v }; })(),
        focalLength: 3,
        notes: '6.17×4.63 mm  (source: vfxcamdb.com)',
      },
      {
        name: 'GoPro HERO 6 Black (1/2.3")',
        ...(() => { const [h, v] = mm(6.17, 4.63); return { hAperture: h, vAperture: v }; })(),
        focalLength: 3,
        notes: 'Same sensor as HERO 7  6.17×4.63 mm',
      },
    ],
  },

  // ── Virtual / CG ─────────────────────────────────────────────────────────
  {
    group: 'Virtual / CG Default',
    presets: [
      {
        name: 'Maya Default (1.417 × 0.945 in)',
        hAperture: 1.417,
        vAperture: 0.945,
        focalLength: 35,
        notes: 'Maya / Arnold default filmback — 35mm full aperture',
      },
      {
        name: 'Houdini / Nuke Default (1.0 × 0.5625 in)',
        hAperture: 1.0,
        vAperture: 0.5625,
        focalLength: 50,
        notes: 'Common CG default for 16:9 HD renders',
      },
      {
        name: 'HD 16:9 (1.0 × 0.5625 in)',
        hAperture: 1.0,
        vAperture: 0.5625,
        focalLength: 35,
        notes: 'Generic HD 1920×1080 virtual camera',
      },
      {
        name: '2K DCI (2048 × 1080)',
        ...(() => { const [h, v] = mm(24.89, 13.15); return { hAperture: h, vAperture: v }; })(),
        focalLength: 35,
        notes: '2K DCI container  24.89×13.15 mm (1.898:1)',
      },
      {
        name: '4K DCI (4096 × 2160)',
        ...(() => { const [h, v] = mm(25.6, 13.5); return { hAperture: h, vAperture: v }; })(),
        focalLength: 35,
        notes: '4K DCI container  25.6×13.5 mm (1.9:1)',
      },
    ],
  },
];

/** Flat lookup: preset name → preset */
export const CAMERA_PRESET_MAP: Record<string, CameraPreset> = {};
for (const g of CAMERA_PRESET_GROUPS) {
  for (const p of g.presets) {
    CAMERA_PRESET_MAP[p.name] = p;
  }
}
