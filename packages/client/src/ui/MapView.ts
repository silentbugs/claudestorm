import { ARENA, terrainHeight, type StormSnapshot } from '@claudestorm/shared';

/** Background paint resolution; upscaled smoothly onto both canvases. */
const BG_RES = 256;

function lerpChannel(a: number, b: number, t: number): number {
  return a + (b - a) * t;
}

function mix(c: [number, number, number], to: [number, number, number], t: number): void {
  const k = Math.max(0, Math.min(1, t));
  c[0] = lerpChannel(c[0], to[0], k);
  c[1] = lerpChannel(c[1], to[1], k);
  c[2] = lerpChannel(c[2], to[2], k);
}

const SEA: [number, number, number] = [22, 52, 74];
const LAKE: [number, number, number] = [45, 106, 138];
const GRASS_LOW: [number, number, number] = [118, 179, 86];
const GRASS_HIGH: [number, number, number] = [195, 189, 102];
const ROCK: [number, number, number] = [141, 138, 128];
const MARSH: [number, number, number] = [94, 127, 78];
const SAND: [number, number, number] = [224, 198, 132];

/**
 * The island map: a minimap pinned top-right during play, and a full-screen
 * overlay on M. The terrain is rendered once into an offscreen canvas from
 * the same data the 3D ground uses; per frame we only stamp storm circles
 * (current in purple, where it's headed in white) and the player arrow.
 */
export class MapView {
  private readonly mini = document.getElementById('minimap') as HTMLCanvasElement;
  private readonly overlay = document.getElementById('map-overlay')!;
  private readonly big = document.getElementById('map-canvas') as HTMLCanvasElement;
  private readonly bg = document.createElement('canvas');
  private active = false;

  constructor() {
    this.bg.width = this.bg.height = BG_RES;
    this.paintBackground();
    window.addEventListener('keydown', (e) => {
      if (!this.active) return;
      if (e.code === 'KeyM') this.overlay.classList.toggle('hidden');
      else if (e.code === 'Escape') this.overlay.classList.add('hidden');
    });
  }

  /** Only meaningful during a match; hides everything otherwise. */
  setActive(active: boolean): void {
    this.active = active;
    this.mini.classList.toggle('hidden', !active);
    if (!active) this.overlay.classList.add('hidden');
  }

  update(storm: StormSnapshot, selfX: number, selfZ: number, selfYaw: number): void {
    if (!this.active) return;
    this.draw(this.mini, storm, selfX, selfZ, selfYaw, false);
    if (!this.overlay.classList.contains('hidden')) {
      this.draw(this.big, storm, selfX, selfZ, selfYaw, true);
    }
  }

  /** Terrain, lakes, cliffs, and landmark dots — the once-only paint. */
  private paintBackground(): void {
    const ctx = this.bg.getContext('2d')!;
    const img = ctx.createImageData(BG_RES, BG_RES);
    const half = ARENA.size / 2;
    const c: [number, number, number] = [0, 0, 0];
    for (let py = 0; py < BG_RES; py++) {
      const z = half - ((py + 0.5) / BG_RES) * ARENA.size;
      for (let px = 0; px < BG_RES; px++) {
        const x = -half + ((px + 0.5) / BG_RES) * ARENA.size;
        if (Math.max(Math.abs(x), Math.abs(z)) >= half) {
          c[0] = SEA[0]; c[1] = SEA[1]; c[2] = SEA[2];
        } else {
          const h = terrainHeight(ARENA.hills, x, z);
          c[0] = GRASS_LOW[0]; c[1] = GRASS_LOW[1]; c[2] = GRASS_LOW[2];
          mix(c, GRASS_HIGH, h / 6);
          if (h > 7) mix(c, ROCK, (h - 7) / 5);
          if (h < -0.3) mix(c, MARSH, -(h + 0.3) / 1.5);
          if (h < -2.5) mix(c, ROCK, -(h + 2.5) / 3);
          const edge = Math.max(Math.abs(x), Math.abs(z)) / half;
          if (edge > 0.9) mix(c, SAND, (edge - 0.9) / 0.08);
          for (const lake of ARENA.lakes) {
            if (Math.hypot(x - lake.x, z - lake.z) < lake.r) {
              c[0] = LAKE[0]; c[1] = LAKE[1]; c[2] = LAKE[2];
            }
          }
        }
        const o = (py * BG_RES + px) * 4;
        img.data[o] = c[0];
        img.data[o + 1] = c[1];
        img.data[o + 2] = c[2];
        img.data[o + 3] = 255;
      }
    }
    ctx.putImageData(img, 0, 0);
    // Cliff walls read as dark stone dots — the ridges and their passes.
    ctx.fillStyle = '#55514a';
    const scale = BG_RES / ARENA.size;
    for (const ob of ARENA.obstacles) {
      if (ob.kind !== 'circle' || ob.look !== 'cliff') continue;
      ctx.beginPath();
      ctx.arc((ob.x + half) * scale, (half - ob.z) * scale, Math.max(1.5, ob.r * scale), 0, Math.PI * 2);
      ctx.fill();
    }
  }

  private draw(
    canvas: HTMLCanvasElement,
    storm: StormSnapshot,
    selfX: number,
    selfZ: number,
    selfYaw: number,
    labels: boolean,
  ): void {
    const ctx = canvas.getContext('2d')!;
    const size = canvas.width;
    const half = ARENA.size / 2;
    const cx = (wx: number): number => ((wx + half) / ARENA.size) * size;
    const cy = (wz: number): number => ((half - wz) / ARENA.size) * size;
    const cr = (wr: number): number => (wr / ARENA.size) * size;

    ctx.clearRect(0, 0, size, size);
    ctx.drawImage(this.bg, 0, 0, size, size);

    // Everything outside the current circle drowns in storm purple.
    ctx.beginPath();
    ctx.rect(0, 0, size, size);
    ctx.arc(cx(storm.x), cy(storm.z), cr(storm.radius), 0, Math.PI * 2, true);
    ctx.fillStyle = 'rgba(96, 40, 150, 0.42)';
    ctx.fill('evenodd');
    ctx.beginPath();
    ctx.arc(cx(storm.x), cy(storm.z), cr(storm.radius), 0, Math.PI * 2);
    ctx.strokeStyle = '#c77dff';
    ctx.lineWidth = size / 220;
    ctx.stroke();
    // Where the circle is headed next.
    ctx.beginPath();
    ctx.arc(cx(storm.targetX), cy(storm.targetZ), cr(storm.targetRadius), 0, Math.PI * 2);
    ctx.strokeStyle = 'rgba(255, 255, 255, 0.9)';
    ctx.setLineDash([size / 60, size / 90]);
    ctx.stroke();
    ctx.setLineDash([]);

    if (labels) {
      ctx.font = `bold ${Math.max(11, size / 46)}px 'Trebuchet MS', sans-serif`;
      ctx.textAlign = 'center';
      ctx.fillStyle = '#ffe9a8';
      ctx.strokeStyle = 'rgba(0, 0, 0, 0.8)';
      ctx.lineWidth = 3;
      for (const lm of ARENA.landmarks) {
        const lx = cx(lm.x);
        const ly = cy(lm.z);
        ctx.beginPath();
        ctx.arc(lx, ly, size / 130, 0, Math.PI * 2);
        ctx.fill();
        ctx.strokeText(lm.name, lx, ly - size / 70);
        ctx.fillText(lm.name, lx, ly - size / 70);
      }
    }

    // You: an arrow pointing where the character faces.
    const px = cx(selfX);
    const py = cy(selfZ);
    const s = size / 40;
    ctx.save();
    ctx.translate(px, py);
    ctx.rotate(selfYaw);
    ctx.beginPath();
    ctx.moveTo(0, -s);
    ctx.lineTo(s * 0.62, s * 0.7);
    ctx.lineTo(0, s * 0.3);
    ctx.lineTo(-s * 0.62, s * 0.7);
    ctx.closePath();
    ctx.fillStyle = '#ffffff';
    ctx.strokeStyle = '#10131f';
    ctx.lineWidth = Math.max(1, size / 320);
    ctx.fill();
    ctx.stroke();
    ctx.restore();
  }
}
