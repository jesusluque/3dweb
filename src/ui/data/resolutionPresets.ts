export interface ResolutionPreset {
  label: string;
  w: number;
  h: number;
  /** Optional free-text note (frame rate, codec hint, etc.) */
  note?: string;
}
export interface ResolutionGroup {
  group: string;
  presets: ResolutionPreset[];
}

export const RESOLUTION_PRESET_GROUPS: ResolutionGroup[] = [
  {
    group: 'SD / HD',
    presets: [
      { label: 'SD  720×576 (PAL)',       w: 720,  h: 576  },
      { label: 'SD  720×480 (NTSC)',       w: 720,  h: 480  },
      { label: 'HD  1280×720',             w: 1280, h: 720  },
      { label: 'FHD 1920×1080',            w: 1920, h: 1080 },
      { label: 'QHD 2560×1440',            w: 2560, h: 1440 },
      { label: '4K  3840×2160',            w: 3840, h: 2160 },
      { label: '8K  7680×4320',            w: 7680, h: 4320 },
    ],
  },
  {
    group: 'Digital Cinema (DCI)',
    presets: [
      { label: 'DCI 2K  2048×1080',        w: 2048, h: 1080, note: '1.896:1' },
      { label: 'DCI 4K  4096×2160',        w: 4096, h: 2160, note: '1.896:1' },
      { label: 'DCI Flat 1998×1080',       w: 1998, h: 1080, note: '1.85:1' },
      { label: 'DCI Scope 2048×858',       w: 2048, h: 858,  note: '2.39:1' },
      { label: 'DCI 4K Flat 3996×2160',    w: 3996, h: 2160, note: '1.85:1' },
      { label: 'DCI 4K Scope 4096×1716',   w: 4096, h: 1716, note: '2.39:1' },
    ],
  },
  {
    group: 'Square / Social',
    presets: [
      { label: 'Square 1:1  1080×1080',    w: 1080, h: 1080 },
      { label: 'Portrait 9:16  1080×1920', w: 1080, h: 1920 },
      { label: 'Twitter  1200×675',        w: 1200, h: 675  },
    ],
  },
  {
    group: 'Aspect Presets',
    presets: [
      { label: '4:3   1440×1080',          w: 1440, h: 1080 },
      { label: '16:9  1920×1080',          w: 1920, h: 1080 },
      { label: '2:1   2048×1024',          w: 2048, h: 1024 },
      { label: '2.39:1 2390×1000',         w: 2390, h: 1000 },
      { label: '1.85:1 1850×1000',         w: 1850, h: 1000 },
    ],
  },
];

export const DEFAULT_RESOLUTION: ResolutionPreset = { label: 'FHD 1920×1080', w: 1920, h: 1080 };
