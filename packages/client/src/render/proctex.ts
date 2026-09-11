import * as THREE from 'three';

/*
 * Procedural, tileable textures generated at load time — no image downloads,
 * no photo-tiling. Everything is built from seeded lattice noise so the
 * ground, sky, water, and wind all read as one hand-painted world.
 */

/** Integer lattice hash → [0, 1). Deterministic, cheap, no allocation. */
function hash(ix: number, iy: number, seed: number): number {
  let h = (Math.imul(ix, 374761393) + Math.imul(iy, 668265263) + Math.imul(seed, 1274126177)) | 0;
  h = Math.imul(h ^ (h >>> 13), 1274126177);
  return ((h ^ (h >>> 16)) >>> 0) / 4294967296;
}

function smooth(t: number): number {
  return t * t * (3 - 2 * t);
}

/** Tileable value noise: the lattice wraps every `period` cells. */
export function valueNoise(x: number, y: number, period: number, seed: number): number {
  const xi = Math.floor(x);
  const yi = Math.floor(y);
  const u = smooth(x - xi);
  const v = smooth(y - yi);
  const x0 = ((xi % period) + period) % period;
  const y0 = ((yi % period) + period) % period;
  const x1 = (x0 + 1) % period;
  const y1 = (y0 + 1) % period;
  const a = hash(x0, y0, seed);
  const b = hash(x1, y0, seed);
  const c = hash(x0, y1, seed);
  const d = hash(x1, y1, seed);
  return a + (b - a) * u + (c - a) * v + (a - b - c + d) * u * v;
}

/** Fractal sum of tileable value noise in [0, 1]. */
export function fbm(x: number, y: number, period: number, octaves: number, seed: number, gain = 0.5): number {
  let sum = 0;
  let amp = 1;
  let norm = 0;
  let freq = 1;
  for (let o = 0; o < octaves; o++) {
    sum += valueNoise(x * freq, y * freq, period * freq, seed + o * 31) * amp;
    norm += amp;
    amp *= gain;
    freq *= 2;
  }
  return sum / norm;
}

/**
 * Tileable cellular (Worley) noise: distance to the nearest and second
 * nearest feature point, for cracks, pebbles, and cloud cells.
 */
export function cellNoise(x: number, y: number, period: number, seed: number): { f1: number; f2: number } {
  const xi = Math.floor(x);
  const yi = Math.floor(y);
  let f1 = 9;
  let f2 = 9;
  for (let dy = -1; dy <= 1; dy++) {
    for (let dx = -1; dx <= 1; dx++) {
      const cx = xi + dx;
      const cy = yi + dy;
      const wx = ((cx % period) + period) % period;
      const wy = ((cy % period) + period) % period;
      const px = cx + hash(wx, wy, seed);
      const py = cy + hash(wx, wy, seed + 7);
      const d = (px - x) * (px - x) + (py - y) * (py - y);
      if (d < f1) {
        f2 = f1;
        f1 = d;
      } else if (d < f2) {
        f2 = d;
      }
    }
  }
  return { f1: Math.sqrt(f1), f2: Math.sqrt(f2) };
}

function finish<T extends THREE.Texture>(tex: T, srgb: boolean, anisotropy: number): T {
  tex.wrapS = tex.wrapT = THREE.RepeatWrapping;
  tex.minFilter = THREE.LinearMipmapLinearFilter;
  tex.magFilter = THREE.LinearFilter;
  tex.generateMipmaps = true;
  tex.anisotropy = anisotropy;
  if (srgb) tex.colorSpace = THREE.SRGBColorSpace;
  tex.needsUpdate = true;
  return tex;
}

/**
 * A 4-channel tileable noise atlas every shader shares: R = soft 4-octave
 * fbm, G = a second independent fbm, B = cellular (cloud/foam cells),
 * A = fine high-frequency grain. One texture lookup buys four noises.
 */
export function makeNoiseTexture(size = 256): THREE.DataTexture {
  const data = new Uint8Array(size * size * 4);
  const period = 8;
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const fx = (x / size) * period;
      const fy = (y / size) * period;
      const i = (y * size + x) * 4;
      data[i] = Math.round(fbm(fx, fy, period, 4, 11) * 255);
      data[i + 1] = Math.round(fbm(fx + 3.7, fy + 1.9, period, 4, 97) * 255);
      const c = cellNoise(fx * 2, fy * 2, period * 2, 41);
      data[i + 2] = Math.round(Math.min(1, c.f1 * 1.1) * 255);
      data[i + 3] = Math.round(valueNoise(fx * 8, fy * 8, period * 8, 5) * 255);
    }
  }
  const tex = new THREE.DataTexture(data, size, size, THREE.RGBAFormat);
  return finish(tex, false, 1);
}

type Painter = (u: number, v: number, out: THREE.Color) => void;

/**
 * Paints into a canvas rather than a raw DataTexture: the painted textures
 * double as ordinary `map`s on standard materials (ruin walls, palisades),
 * and the canvas upload path is the one every GPU driver exercises.
 */
function paint(size: number, painter: Painter, anisotropy: number): THREE.CanvasTexture {
  const canvas = document.createElement('canvas');
  canvas.width = canvas.height = size;
  const ctx = canvas.getContext('2d')!;
  const img = ctx.createImageData(size, size);
  const data = img.data;
  const c = new THREE.Color();
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      painter(x / size, y / size, c);
      const i = (y * size + x) * 4;
      data[i] = Math.round(THREE.MathUtils.clamp(c.r, 0, 1) * 255);
      data[i + 1] = Math.round(THREE.MathUtils.clamp(c.g, 0, 1) * 255);
      data[i + 2] = Math.round(THREE.MathUtils.clamp(c.b, 0, 1) * 255);
      data[i + 3] = 255;
    }
  }
  ctx.putImageData(img, 0, 0);
  return finish(new THREE.CanvasTexture(canvas), true, anisotropy);
}

export interface DetailTextures {
  grass: THREE.Texture;
  dry: THREE.Texture;
  rock: THREE.Texture;
  sand: THREE.Texture;
}

/**
 * Hand-painted-style ground details. Each tile is a few meters of ground:
 * grass is streaky (blade-shaped anisotropic noise over soft blotches),
 * dry earth is pebbly, rock is cracked slabs, sand is rippled.
 */
export function makeDetailTextures(anisotropy: number, size = 256): DetailTextures {
  const P = 6;
  const tmp = new THREE.Color();
  const grass = paint(
    size,
    (u, v, out) => {
      const x = u * P;
      const y = v * P;
      const blotch = fbm(x * 0.5, y * 0.5, P * 0.5, 3, 3);
      // Blades: stretched vertically so the streaks read as tufts.
      const blades = valueNoise(x * 9, y * 2.2, P * 9, 21) * 0.55 + valueNoise(x * 18, y * 4.5, P * 18, 23) * 0.45;
      const tuft = smooth(THREE.MathUtils.clamp((blades - 0.35) * 2.2, 0, 1));
      out.setHex(0x5a9c45).lerp(tmp.setHex(0x8fc25a), tuft * 0.75);
      out.lerp(tmp.setHex(0x3f7a3a), (1 - blotch) * 0.45);
      out.multiplyScalar(0.9 + valueNoise(x * 30, y * 30, P * 30, 9) * 0.2);
    },
    anisotropy,
  );
  const dry = paint(
    size,
    (u, v, out) => {
      const x = u * P;
      const y = v * P;
      const base = fbm(x, y, P, 4, 51);
      const pebbles = cellNoise(x * 6, y * 6, P * 6, 61);
      const pebble = smooth(THREE.MathUtils.clamp((0.42 - pebbles.f1) * 4, 0, 1));
      out.setHex(0xa38a5a).lerp(tmp.setHex(0x7d6a44), (1 - base) * 0.5);
      out.lerp(tmp.setHex(0xc4ae7c), pebble * 0.45);
      out.multiplyScalar(0.92 + valueNoise(x * 24, y * 24, P * 24, 55) * 0.16);
    },
    anisotropy,
  );
  const rock = paint(
    size,
    (u, v, out) => {
      const x = u * P;
      const y = v * P;
      const cells = cellNoise(x * 2.2, y * 2.2, Math.round(P * 2.2), 71);
      const crack = smooth(THREE.MathUtils.clamp((cells.f2 - cells.f1) * 5, 0, 1)); // 0 at the seams
      const grain = fbm(x * 3, y * 3, P * 3, 3, 77);
      // Mid-gray slabs with darker seams: bright enough to serve as a plain
      // material map on masonry, not just as terrain detail.
      out.setHex(0xc4bfb7).lerp(tmp.setHex(0x8a867f), (1 - crack) * 0.5);
      out.lerp(tmp.setHex(0xdcd8d0), grain * 0.35);
      out.lerp(tmp.setHex(0x95a0ac), (1 - grain) * 0.12); // cool shadows in the pits
    },
    anisotropy,
  );
  const sand = paint(
    size,
    (u, v, out) => {
      const x = u * P;
      const y = v * P;
      const ripple = Math.sin((y + fbm(x, y, P, 3, 81) * 0.6) * Math.PI * 2 * 3) * 0.5 + 0.5;
      const grain = valueNoise(x * 26, y * 26, P * 26, 83);
      out.setHex(0xe6d39d).lerp(tmp.setHex(0xc9b27a), ripple * 0.35);
      out.multiplyScalar(0.93 + grain * 0.14);
    },
    anisotropy,
  );
  return { grass, dry, rock, sand };
}

/** A soft radial dot: motes, glows, hover lights, loot sparkles. */
export function makeGlowSprite(size = 64): THREE.DataTexture {
  const data = new Uint8Array(size * size * 4);
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const dx = (x + 0.5) / size - 0.5;
      const dy = (y + 0.5) / size - 0.5;
      const d = Math.min(1, Math.hypot(dx, dy) * 2);
      const a = Math.pow(1 - d, 2.2);
      const i = (y * size + x) * 4;
      data[i] = data[i + 1] = data[i + 2] = 255;
      data[i + 3] = Math.round(a * 255);
    }
  }
  const tex = new THREE.DataTexture(data, size, size, THREE.RGBAFormat);
  tex.minFilter = THREE.LinearMipmapLinearFilter;
  tex.magFilter = THREE.LinearFilter;
  tex.generateMipmaps = true;
  tex.needsUpdate = true;
  return tex;
}
