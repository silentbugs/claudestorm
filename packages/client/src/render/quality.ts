/**
 * Graphics tiers. Everything that costs fill rate or vertex work scales
 * here, so the same scene runs on a phone at Low and looks its best at
 * High without either path hoping the hardware keeps up.
 */
export type Quality = 'low' | 'medium' | 'high';

export interface QualityPreset {
  /** Post pipeline (MSAA + bloom) on at all; off means direct rendering. */
  post: boolean;
  msaaSamples: number;
  bloomStrength: number;
  shadowMap: number;
  softShadows: boolean;
  /** Terrain grid segments per side. */
  terrainSegments: number;
  /** PBR (standard) ground vs. cheaper Lambert. */
  terrainPbr: boolean;
  grassRadius: number;
  grassSpacing: number;
  /** Transparent sea with a soft shoreline (costs blending across the horizon). */
  softSea: boolean;
  motes: number;
  maxPixelRatio: number;
  /** Fraction of the scattered foliage (bushes, flowers, mushrooms) to keep. */
  foliage: number;
}

export const QUALITY_PRESETS: Record<Quality, QualityPreset> = {
  low: {
    post: false,
    msaaSamples: 0,
    bloomStrength: 0,
    shadowMap: 1024,
    softShadows: false,
    terrainSegments: 200,
    terrainPbr: false,
    grassRadius: 22,
    grassSpacing: 0.8,
    softSea: false,
    motes: 0,
    maxPixelRatio: 1.5,
    foliage: 0.5,
  },
  medium: {
    post: true,
    msaaSamples: 4,
    bloomStrength: 0.32,
    shadowMap: 2048,
    softShadows: true,
    terrainSegments: 288,
    terrainPbr: true,
    grassRadius: 36,
    grassSpacing: 0.62,
    softSea: true,
    motes: 160,
    maxPixelRatio: 2,
    foliage: 0.8,
  },
  high: {
    post: true,
    msaaSamples: 4,
    bloomStrength: 0.38,
    shadowMap: 4096,
    softShadows: true,
    terrainSegments: 336,
    terrainPbr: true,
    grassRadius: 46,
    grassSpacing: 0.55,
    softSea: true,
    motes: 260,
    maxPixelRatio: 2,
    foliage: 1,
  },
};

const STORAGE_KEY = 'claudestorm.quality';

export function loadQuality(fallback: Quality): Quality {
  try {
    const stored = localStorage.getItem(STORAGE_KEY);
    if (stored === 'low' || stored === 'medium' || stored === 'high') return stored;
  } catch {
    // storage blocked: run with the fallback
  }
  return fallback;
}

export function saveQuality(q: Quality): void {
  try {
    localStorage.setItem(STORAGE_KEY, q);
  } catch {
    // storage blocked: the choice just doesn't persist
  }
}
