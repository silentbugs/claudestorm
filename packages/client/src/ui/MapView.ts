import {
  ARENA,
  LAKE_WATERLINE_FACTOR,
  coastRadius,
  groundHeight,
  type StormSnapshot,
} from '@claudestorm/shared';

/** Background paint resolution; upscaled smoothly onto both canvases. */
const BG_RES = 704;

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
const SEA_DEEP: [number, number, number] = [10, 28, 46];
const LAKE: [number, number, number] = [45, 106, 138];
const LAKE_DEEP: [number, number, number] = [24, 62, 92];
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

  private readonly dpr = Math.min(2, window.devicePixelRatio || 1);

  constructor() {
    this.bg.width = this.bg.height = BG_RES;
    // Both canvases get device-pixel backing stores; the CSS size stays put.
    this.mini.width = this.mini.height = Math.round(200 * this.dpr);
    void this.paintBackground();
    window.addEventListener('keydown', (e) => {
      if (!this.active) return;
      if (e.code === 'KeyM') this.overlay.classList.toggle('hidden');
      else if (e.code === 'Escape') this.overlay.classList.add('hidden');
    });
  }

  /** Gamepad Select / minimap tap: same as pressing M. */
  toggleOverlay(): void {
    if (this.active) this.overlay.classList.toggle('hidden');
  }

  /** Only meaningful during a match; hides everything otherwise. */
  setActive(active: boolean): void {
    this.active = active;
    this.mini.classList.toggle('hidden', !active);
    if (!active) this.overlay.classList.add('hidden');
  }

  private miniCd = 0;
  private bigCd = 0;

  update(dt: number, storm: StormSnapshot, selfX: number, selfZ: number, selfYaw: number): void {
    if (!this.active) return;
    // Repainting canvases every rendered frame is wasted main-thread time;
    // nothing on the map moves fast enough to need more than ~8/30 Hz.
    this.miniCd -= dt;
    this.bigCd -= dt;
    if (this.miniCd <= 0) {
      this.miniCd = 0.12;
      this.draw(this.mini, storm, selfX, selfZ, selfYaw, false);
    }
    if (!this.overlay.classList.contains('hidden') && this.bigCd <= 0) {
      this.bigCd = 0.033;
      this.draw(this.big, storm, selfX, selfZ, selfYaw, true);
    }
  }

  /**
   * Terrain, lakes, cliffs, and landmark dots — the once-only paint.
   * Pass 1 samples the shared heightfield into a grid (chunked with awaits so
   * the ~500k groundHeight calls don't freeze the menu); pass 2 colors it with
   * hillshaded relief; pass 3 stamps every tree/rock/ruin as a speck.
   */
  private async paintBackground(): Promise<void> {
    const R = BG_RES;
    const half = ARENA.size / 2;
    const coastBase = ARENA.coastR ?? half;
    // The x axis is mirrored (see draw()): the world is left-handed relative
    // to a north-up map, so this keeps map turns matching on-screen turns.
    const world = (p: number): number => half - ((p + 0.5) / R) * ARENA.size;
    const heights = new Float32Array(R * R);
    const overs = new Float32Array(R * R);
    for (let row = 0; row < R; row += 48) {
      const end = Math.min(R, row + 48);
      for (let py = row; py < end; py++) {
        const z = world(py);
        for (let px = 0; px < R; px++) {
          const x = world(px);
          const i = py * R + px;
          overs[i] = Math.hypot(x, z) - coastRadius(coastBase, Math.atan2(x, z));
          heights[i] = overs[i] > 0 ? -5 : groundHeight(ARENA, x, z);
        }
      }
      await new Promise((resolve) => setTimeout(resolve, 0));
    }

    const ctx = this.bg.getContext('2d')!;
    const img = ctx.createImageData(R, R);
    const c: [number, number, number] = [0, 0, 0];
    for (let py = 0; py < R; py++) {
      const z = world(py);
      for (let px = 0; px < R; px++) {
        const x = world(px);
        const i = py * R + px;
        const over = overs[i]!;
        if (over > 0) {
          c[0] = SEA[0]; c[1] = SEA[1]; c[2] = SEA[2];
          mix(c, SEA_DEEP, over / 70); // deepens away from shore
        } else {
          const h = heights[i]!;
          c[0] = GRASS_LOW[0]; c[1] = GRASS_LOW[1]; c[2] = GRASS_LOW[2];
          mix(c, GRASS_HIGH, h / 6);
          if (h > 7) mix(c, ROCK, (h - 7) / 5);
          if (h < -0.3) mix(c, MARSH, -(h + 0.3) / 1.5);
          if (h < -2.5) mix(c, ROCK, -(h + 2.5) / 3);
          if (over > -12) mix(c, SAND, (over + 12) / 10);
          let water = false;
          for (const lake of ARENA.lakes) {
            if (Math.hypot(x - lake.x, z - lake.z) < lake.r * LAKE_WATERLINE_FACTOR) {
              c[0] = LAKE[0]; c[1] = LAKE[1]; c[2] = LAKE[2];
              mix(c, LAKE_DEEP, -h / 4); // darker where it's deep
              water = true;
            }
          }
          // Hillshade from the height grid: slopes catch light from the
          // top-left of the map, giving ridges and trenches real relief.
          if (!water) {
            const gx = heights[i + (px > 0 ? -1 : 0)]! - heights[i + (px < R - 1 ? 1 : 0)]!;
            const gz = heights[i - (py > 0 ? R : 0)]! - heights[i + (py < R - 1 ? R : 0)]!;
            const shade = Math.max(0.6, Math.min(1.25, 1 + (gx + gz) * 0.16));
            c[0] *= shade; c[1] *= shade; c[2] *= shade;
          }
        }
        const o = i * 4;
        img.data[o] = c[0];
        img.data[o + 1] = c[1];
        img.data[o + 2] = c[2];
        img.data[o + 3] = 255;
      }
    }
    ctx.putImageData(img, 0, 0);

    // Every piece of standing cover, so the map reads like the island.
    const sx = (wx: number): number => ((half - wx) / ARENA.size) * R;
    const sy = (wz: number): number => ((half - wz) / ARENA.size) * R;
    const scale = R / ARENA.size;
    for (const ob of ARENA.obstacles) {
      if (ob.kind === 'circle' && ob.look === 'none') continue; // invisible collision
      if (ob.kind === 'box') {
        ctx.fillStyle = 'rgba(196, 190, 176, 0.95)';
        ctx.fillRect(
          sx(ob.x) - ob.hx * scale,
          sy(ob.z) - ob.hz * scale,
          Math.max(1, ob.hx * 2 * scale),
          Math.max(1, ob.hz * 2 * scale),
        );
        continue;
      }
      ctx.fillStyle =
        ob.look === 'tree'
          ? 'rgba(38, 92, 44, 0.9)'
          : ob.look === 'cliff'
            ? 'rgba(96, 94, 88, 0.9)'
            : 'rgba(120, 117, 108, 0.9)';
      ctx.beginPath();
      ctx.arc(sx(ob.x), sy(ob.z), Math.max(0.8, ob.r * scale), 0, Math.PI * 2);
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
    if (labels) {
      // Match the overlay's CSS size in device pixels so it renders crisp.
      const desired = Math.round(
        Math.min(window.innerHeight * 0.78, window.innerWidth * 0.9) * this.dpr,
      );
      if (canvas.width !== desired) canvas.width = canvas.height = desired;
    }
    const ctx = canvas.getContext('2d')!;
    const size = canvas.width;
    const half = ARENA.size / 2;
    // x mirrored to match the world's handedness (turning right on screen
    // must turn the arrow clockwise on the map).
    const cx = (wx: number): number => ((half - wx) / ARENA.size) * size;
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
    ctx.rotate(-selfYaw); // mirrored x flips the rotation sense too
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
