import * as THREE from 'three';
import { ARENA, LAKE_WATERLINE_FACTOR, coastRadius, groundHeight, lakeSurfaceY } from '@claudestorm/shared';
import { fbm, valueNoise } from './proctex.js';

/**
 * The island baked into textures once at load, so the GPU can look the
 * terrain up anywhere: the grass places every blade from the heightmap, the
 * water reads depth for shoreline foam, and the ground shader blends its
 * detail textures by the splat weights instead of per-vertex colors.
 *
 * Height covers the whole 840m arena in a half-float texture (~0.8m per
 * texel); color and splat live at half that resolution.
 */
export interface TerrainData {
  /** World-space side length the textures span, centered on the origin. */
  readonly size: number;
  /** R16F world height. */
  readonly height: THREE.DataTexture;
  /** RGB macro tint: the biome color underneath the detail textures. */
  readonly color: THREE.DataTexture;
  /** Blend weights: R grass, G dry earth, B rock, A sand (sum to 1). */
  readonly splat: THREE.DataTexture;
  /** CPU copy of the heights for placement queries. */
  readonly heights: Float32Array;
  readonly heightRes: number;
}

/**
 * Bilinear height lookup on the baked grid — the same value the GPU sees,
 * for scattering foliage so it lands where the grass shader thinks the
 * ground is.
 */
export function sampleHeight(data: TerrainData, x: number, z: number): number {
  const n = data.heightRes;
  const fx = THREE.MathUtils.clamp((x / data.size + 0.5) * n - 0.5, 0, n - 1);
  const fz = THREE.MathUtils.clamp((z / data.size + 0.5) * n - 0.5, 0, n - 1);
  const x0 = Math.floor(fx);
  const z0 = Math.floor(fz);
  const x1 = Math.min(n - 1, x0 + 1);
  const z1 = Math.min(n - 1, z0 + 1);
  const u = fx - x0;
  const v = fz - z0;
  const h = data.heights;
  const a = h[z0 * n + x0]!;
  const b = h[z0 * n + x1]!;
  const c = h[z1 * n + x0]!;
  const d = h[z1 * n + x1]!;
  return a + (b - a) * u + (c - a) * v + (a - b - c + d) * u * v;
}

/**
 * Biome classification at a world point — shared between the color/splat
 * bake and foliage scattering, so bushes only grow where the ground shader
 * paints grass.
 */
export interface BiomeSample {
  grass: number;
  dry: number;
  rock: number;
  sand: number;
  /** Below a lake's waterline or the sea. */
  submerged: boolean;
  r: number;
  g: number;
  b: number;
}

// Arathi's palette: chartreuse highland grass yellowing on the crests,
// browner in the hollows, blue-gray stone on the massifs.
const LOW = new THREE.Color(0x8fb83e);
const HIGH = new THREE.Color(0xb8b54a);
const ROCK = new THREE.Color(0x8b939c);
const MARSH = new THREE.Color(0x6b7f3a);
const MUD = new THREE.Color(0x8a7a52);
const SAND = new THREE.Color(0xd9c58a);
const DRY = new THREE.Color(0xb1a34a);
const LUSH = new THREE.Color(0x6aa03a);
const ROAD = new THREE.Color(0xa39b8c);
const tmp = new THREE.Color();

/** Distance from a point to the nearest cobbled road, in meters. */
function roadDistance(x: number, z: number): number {
  let best = Infinity;
  for (const road of ARENA.roads) {
    for (let i = 1; i < road.length; i++) {
      const a = road[i - 1]!;
      const b = road[i]!;
      const dx = b.x - a.x;
      const dz = b.z - a.z;
      const len2 = dx * dx + dz * dz || 1;
      const t = Math.max(0, Math.min(1, ((x - a.x) * dx + (z - a.z) * dz) / len2));
      const px = a.x + dx * t;
      const pz = a.z + dz * t;
      const d2 = (x - px) * (x - px) + (z - pz) * (z - pz);
      if (d2 < best) best = d2;
    }
  }
  return Math.sqrt(best);
}

export function sampleBiome(x: number, z: number, h: number, slope: number, out: BiomeSample): BiomeSample {
  const half = ARENA.size / 2;
  const coastBase = ARENA.coastR ?? half;
  tmp.copy(LOW).lerp(HIGH, Math.min(1, h / 6));
  // Meadow patchiness: broad dry/lush blotches so the plain never reads as
  // one repeating green. Non-tileable is fine — this is world space.
  const patch = fbm(x * 0.012, z * 0.012, 1 << 20, 3, 5) * 0.65 + valueNoise(x * 0.05, z * 0.05, 1 << 20, 7) * 0.35;
  let dry = 0;
  if (patch > 0.52) dry = Math.min(1, (patch - 0.52) * 2.2);
  else if (patch < 0.44) tmp.lerp(LUSH, Math.min(1, (0.44 - patch) * 2.2));
  tmp.lerp(DRY, dry * 0.5);
  tmp.multiplyScalar(0.94 + valueNoise(x * 0.14 + 41, z * 0.14 - 17, 1 << 20, 9) * 0.12);
  // High massifs go stony, steep faces go bare, lowland basins go marshy,
  // pits go bare rock.
  let rock = 0;
  if (h > 7) rock = Math.max(rock, Math.min(1, (h - 7) / 5));
  rock = Math.max(rock, THREE.MathUtils.smoothstep(slope, 0.42, 0.7));
  if (h < -0.3) {
    tmp.lerp(MARSH, Math.min(1, -(h + 0.3) / 1.5));
    dry = Math.max(dry, Math.min(0.6, -(h + 0.3) / 2.5));
  }
  if (h < -2.5) rock = Math.max(rock, Math.min(1, -(h + 2.5) / 3));
  tmp.lerp(ROCK, rock * 0.6);
  // Cobbled roads: a worn band of packed earth and stone, ragged at the edges.
  const roadD = roadDistance(x, z) + valueNoise(x * 0.5, z * 0.5, 1 << 20, 13) * 1.2;
  const road = 1 - THREE.MathUtils.smoothstep(roadD, 1.6, 3.4);
  if (road > 0) {
    tmp.lerp(ROAD, road * 0.8);
    dry = Math.max(dry, road * 0.9);
  }
  // Muddy shores ringing each lake's waterline; submerged below it.
  let submerged = false;
  for (const lake of ARENA.lakes) {
    const d = Math.hypot(x - lake.x, z - lake.z);
    const waterline = lake.r * LAKE_WATERLINE_FACTOR;
    if (d < waterline + 5) {
      const mud = 0.7 * Math.min(1, (waterline + 5 - d) / 9);
      tmp.lerp(MUD, mud);
      dry = Math.max(dry, mud);
      if (d < waterline && h < lakeSurfaceY(ARENA, lake)) submerged = true;
    }
  }
  // Beach where the land meets the sea; the drowned skirt is all sand.
  const over = Math.hypot(x, z) - coastRadius(coastBase, Math.atan2(x, z));
  let sand = 0;
  if (over > -12) sand = Math.min(1, (over + 12) / 10);
  if (h < -0.55) submerged = true;
  tmp.lerp(SAND, sand);
  // Normalize: sand and rock override, dry sits on grass.
  const grassW = Math.max(0, 1 - dry) * (1 - rock) * (1 - sand);
  const dryW = dry * (1 - rock) * (1 - sand);
  const rockW = rock * (1 - sand);
  const total = grassW + dryW + rockW + sand || 1;
  out.grass = grassW / total;
  out.dry = dryW / total;
  out.rock = rockW / total;
  out.sand = sand / total;
  out.submerged = submerged;
  out.r = tmp.r;
  out.g = tmp.g;
  out.b = tmp.b;
  return out;
}

/** Exact `groundHeight` on a grid, accumulated per hill so it costs O(island). */
function bakeHeights(n: number): Float32Array {
  const size = ARENA.size;
  const heights = new Float32Array(n * n);
  const toWorld = (i: number): number => (i / n - 0.5) * size;
  for (const hill of ARENA.hills) {
    const i0 = Math.max(0, Math.floor(((hill.x - hill.r) / size + 0.5) * n));
    const i1 = Math.min(n - 1, Math.ceil(((hill.x + hill.r) / size + 0.5) * n));
    const j0 = Math.max(0, Math.floor(((hill.z - hill.r) / size + 0.5) * n));
    const j1 = Math.min(n - 1, Math.ceil(((hill.z + hill.r) / size + 0.5) * n));
    for (let j = j0; j <= j1; j++) {
      const z = toWorld(j);
      for (let i = i0; i <= i1; i++) {
        const x = toWorld(i);
        const d = Math.hypot(x - hill.x, z - hill.z);
        if (d < hill.r) heights[j * n + i]! += hill.h * 0.5 * (1 + Math.cos((d / hill.r) * Math.PI));
      }
    }
  }
  // The coast: hills flatten to the beach and the seabed drops away —
  // identical to groundHeight() in shared/maps.
  if (ARENA.coastR) {
    for (let j = 0; j < n; j++) {
      const z = toWorld(j);
      for (let i = 0; i < n; i++) {
        const x = toWorld(i);
        const over = Math.hypot(x, z) - coastRadius(ARENA.coastR, Math.atan2(x, z));
        if (over > -16) {
          const fade = Math.min(1, Math.max(0, (over + 16) / 16));
          const dive = Math.min(1, Math.max(0, over / 12));
          const k = j * n + i;
          heights[k] = heights[k]! * (1 - fade) - dive * dive * 5;
        }
      }
    }
  }
  return heights;
}

export function bakeTerrainData(): TerrainData {
  const size = ARENA.size;
  const heightRes = 1024;
  const heights = bakeHeights(heightRes);
  const half = new Uint16Array(heightRes * heightRes);
  for (let i = 0; i < heights.length; i++) half[i] = THREE.DataUtils.toHalfFloat(heights[i]!);
  const height = new THREE.DataTexture(half, heightRes, heightRes, THREE.RedFormat, THREE.HalfFloatType);
  height.minFilter = THREE.LinearFilter;
  height.magFilter = THREE.LinearFilter;
  height.wrapS = height.wrapT = THREE.ClampToEdgeWrapping;
  height.generateMipmaps = false;
  height.needsUpdate = true;

  const res = 512;
  const colorData = new Uint8Array(res * res * 4);
  const splatData = new Uint8Array(res * res * 4);
  const biome: BiomeSample = { grass: 1, dry: 0, rock: 0, sand: 0, submerged: false, r: 0, g: 0, b: 0 };
  const data: TerrainData = { size, height, color: null!, splat: null!, heights, heightRes };
  const step = size / res;
  for (let j = 0; j < res; j++) {
    const z = (j / res - 0.5) * size;
    for (let i = 0; i < res; i++) {
      const x = (i / res - 0.5) * size;
      const h = sampleHeight(data, x, z);
      // Slope from the baked grid: steep faces read as bare rock.
      const hx = sampleHeight(data, x + step, z) - sampleHeight(data, x - step, z);
      const hz = sampleHeight(data, x, z + step) - sampleHeight(data, x, z - step);
      const slope = Math.min(1, Math.hypot(hx, hz) / (2 * step));
      sampleBiome(x, z, h, slope, biome);
      const k = (j * res + i) * 4;
      colorData[k] = Math.round(biome.r * 255);
      colorData[k + 1] = Math.round(biome.g * 255);
      colorData[k + 2] = Math.round(biome.b * 255);
      colorData[k + 3] = biome.submerged ? 0 : 255; // alpha: land the grass may grow on
      splatData[k] = Math.round(biome.grass * 255);
      splatData[k + 1] = Math.round(biome.dry * 255);
      splatData[k + 2] = Math.round(biome.rock * 255);
      splatData[k + 3] = Math.round(biome.sand * 255);
    }
  }
  const color = new THREE.DataTexture(colorData, res, res, THREE.RGBAFormat);
  color.colorSpace = THREE.SRGBColorSpace;
  const splat = new THREE.DataTexture(splatData, res, res, THREE.RGBAFormat);
  for (const t of [color, splat]) {
    t.minFilter = THREE.LinearFilter;
    t.magFilter = THREE.LinearFilter;
    t.wrapS = t.wrapT = THREE.ClampToEdgeWrapping;
    t.generateMipmaps = false;
    t.needsUpdate = true;
  }
  return { ...data, color, splat };
}

/** Exact terrain height (the sim's own function) — for the ground mesh itself. */
export function exactHeight(x: number, z: number): number {
  return groundHeight(ARENA, x, z);
}
