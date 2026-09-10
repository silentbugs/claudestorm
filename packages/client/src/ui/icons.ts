import type { AbilityId, ItemId } from '@claudestorm/shared';

/*
 * Painted ability icons in the World of Warcraft / Plunderstorm idiom:
 * square tiles with a smoky, vignetted background in the spell's palette,
 * airbrushed shapes lit from the upper left with glossy highlights and
 * soft glows — no cartoon outlines — and the thin dark bevel WoW frames
 * every icon with. Each spell's subject follows its Plunderstorm icon
 * (an icy arrow, a golden winged shield, a green fish, a bear trap…),
 * drawn from scratch on canvas at load and cached as a canvas (for 3D
 * sprites) and a data URL (for the DOM).
 */

export type IconKind = 'ability' | 'item' | 'builtin';
export type BuiltinIconId = 'slap' | 'heal' | 'roll' | 'dive';

const SIZE = 128;
const canvases = new Map<string, HTMLCanvasElement>();
const urls = new Map<string, string>();

type Ctx = CanvasRenderingContext2D;
type Stops = [number, string][];

/* ── Painterly helpers ─────────────────────────────────────────────── */

/** Tiny seeded PRNG so the smoke wisps are the same every load. */
function rng(seed: number): () => number {
  let s = seed >>> 0 || 1;
  return () => {
    s = (Math.imul(s, 1664525) + 1013904223) >>> 0;
    return s / 4294967296;
  };
}

function lin(ctx: Ctx, x0: number, y0: number, x1: number, y1: number, stops: Stops): CanvasGradient {
  const g = ctx.createLinearGradient(x0, y0, x1, y1);
  for (const [t, c] of stops) g.addColorStop(t, c);
  return g;
}

function rad(ctx: Ctx, x: number, y: number, r: number, stops: Stops, x0 = x, y0 = y, r0 = 0): CanvasGradient {
  const g = ctx.createRadialGradient(x0, y0, r0, x, y, r);
  for (const [t, c] of stops) g.addColorStop(t, c);
  return g;
}

function roundRect(ctx: Ctx, x: number, y: number, w: number, h: number, r: number): void {
  ctx.moveTo(x + r, y);
  ctx.arcTo(x + w, y, x + w, y + h, r);
  ctx.arcTo(x + w, y + h, x, y + h, r);
  ctx.arcTo(x, y + h, x, y, r);
  ctx.arcTo(x, y, x + w, y, r);
  ctx.closePath();
}

/**
 * Background: a deep base with soft wisps of the mid tone drifting through
 * it and a hot spot behind the subject — the smoky, lit-from-within look
 * every WoW icon shares.
 */
function smoke(ctx: Ctx, deep: string, mid: string, hot: string, seed: number, hotX = 60, hotY = 56): void {
  const s = SIZE;
  const r = rng(seed);
  ctx.fillStyle = deep;
  ctx.fillRect(0, 0, s, s);
  ctx.save();
  ctx.globalCompositeOperation = 'lighter';
  for (let i = 0; i < 9; i++) {
    const x = r() * s;
    const y = r() * s;
    const rr = 18 + r() * 40;
    ctx.fillStyle = rad(ctx, x, y, rr, [[0, mid], [1, 'rgba(0,0,0,0)']]);
    ctx.globalAlpha = 0.16 + r() * 0.16;
    ctx.fillRect(x - rr, y - rr, rr * 2, rr * 2);
  }
  ctx.globalAlpha = 0.9;
  ctx.fillStyle = rad(ctx, hotX, hotY, 60, [[0, hot], [0.45, mid], [1, 'rgba(0,0,0,0)']]);
  ctx.fillRect(0, 0, s, s);
  ctx.restore();
}

/** Fill a path with a drop shadow, then a subtle darker edge to seat it. */
function paint(ctx: Ctx, path: () => void, fill: string | CanvasGradient, shadow = 7, edge = 'rgba(0,0,0,0.35)'): void {
  ctx.save();
  if (shadow > 0) {
    ctx.shadowColor = 'rgba(0,0,0,0.65)';
    ctx.shadowBlur = shadow;
    ctx.shadowOffsetX = 2;
    ctx.shadowOffsetY = 3;
  }
  ctx.fillStyle = fill;
  ctx.beginPath();
  path();
  ctx.fill();
  ctx.restore();
  if (edge) {
    ctx.save();
    ctx.strokeStyle = edge;
    ctx.lineWidth = 1.5;
    ctx.lineJoin = 'round';
    ctx.beginPath();
    path();
    ctx.stroke();
    ctx.restore();
  }
}

/** A soft stroke (no shadow) — for rays, lines, arcs. */
function stroke(ctx: Ctx, path: () => void, style: string | CanvasGradient, width: number, blur = 0): void {
  ctx.save();
  ctx.strokeStyle = style;
  ctx.lineWidth = width;
  ctx.lineCap = 'round';
  ctx.lineJoin = 'round';
  if (blur > 0) {
    ctx.shadowColor = typeof style === 'string' ? style : '#fff';
    ctx.shadowBlur = blur;
  }
  ctx.beginPath();
  path();
  ctx.stroke();
  ctx.restore();
}

/** Additive glow spot. */
function glow(ctx: Ctx, x: number, y: number, r: number, color: string, alpha = 1): void {
  ctx.save();
  ctx.globalCompositeOperation = 'lighter';
  ctx.globalAlpha = alpha;
  ctx.fillStyle = rad(ctx, x, y, r, [[0, color], [1, 'rgba(0,0,0,0)']]);
  ctx.fillRect(x - r, y - r, r * 2, r * 2);
  ctx.restore();
}

/** Glossy highlight: a white sheen across the top of a path. */
function sheen(ctx: Ctx, path: () => void, x0: number, y0: number, x1: number, y1: number, alpha = 0.45): void {
  ctx.save();
  ctx.beginPath();
  path();
  ctx.clip();
  ctx.fillStyle = lin(ctx, x0, y0, x1, y1, [[0, `rgba(255,255,255,${alpha})`], [0.55, 'rgba(255,255,255,0)']]);
  ctx.fillRect(0, 0, SIZE, SIZE);
  ctx.restore();
}

function poly(ctx: Ctx, pts: number[], close = true): void {
  ctx.moveTo(pts[0]!, pts[1]!);
  for (let i = 2; i < pts.length; i += 2) ctx.lineTo(pts[i]!, pts[i + 1]!);
  if (close) ctx.closePath();
}

function star(ctx: Ctx, cx: number, cy: number, outer: number, inner: number, points = 5, rot = -Math.PI / 2): void {
  for (let i = 0; i < points * 2; i++) {
    const r = i % 2 === 0 ? outer : inner;
    const a = rot + (i / (points * 2)) * Math.PI * 2;
    const x = cx + Math.cos(a) * r;
    const y = cy + Math.sin(a) * r;
    if (i === 0) ctx.moveTo(x, y);
    else ctx.lineTo(x, y);
  }
  ctx.closePath();
}

/** Sparkle: a four-point star with a glow. */
function sparkle(ctx: Ctx, x: number, y: number, r: number, color = '#ffffff'): void {
  glow(ctx, x, y, r * 2.2, color, 0.7);
  paint(ctx, () => star(ctx, x, y, r, r * 0.3, 4), color, 0, '');
}

/** The WoW frame: vignette, grain, a dark outer bevel with a light inner line. */
function frame(ctx: Ctx, seed: number): void {
  const s = SIZE;
  ctx.save();
  ctx.fillStyle = rad(ctx, s / 2, s / 2, s * 0.78, [[0, 'rgba(0,0,0,0)'], [0.6, 'rgba(0,0,0,0.08)'], [1, 'rgba(0,0,0,0.6)']]);
  ctx.fillRect(0, 0, s, s);
  // Fine grain so the airbrush reads as paint, not plastic.
  const r = rng(seed * 7 + 3);
  ctx.globalAlpha = 0.05;
  for (let i = 0; i < 900; i++) {
    ctx.fillStyle = r() < 0.5 ? '#000' : '#fff';
    ctx.fillRect(r() * s, r() * s, 1.5, 1.5);
  }
  ctx.restore();
  ctx.lineWidth = 5;
  ctx.strokeStyle = 'rgba(8,6,12,0.95)';
  ctx.beginPath();
  roundRect(ctx, 2.5, 2.5, s - 5, s - 5, 6);
  ctx.stroke();
  ctx.lineWidth = 1.5;
  ctx.strokeStyle = 'rgba(255,235,200,0.28)';
  ctx.beginPath();
  roundRect(ctx, 6, 6, s - 12, s - 12, 4);
  ctx.stroke();
}

/* ── Palettes: [deep, mid, hot] per spell family ─────────────────── */

const FROST = ['#061a33', '#1f5fa8', '#8fd6ff'] as const;
const FIRE = ['#2a0803', '#b3360e', '#ffb347'] as const;
const EARTH = ['#1c1108', '#6e4420', '#d9a066'] as const;
const HOLY = ['#2a1c05', '#9a6a12', '#ffe9a0'] as const;
const STORM = ['#06122a', '#1a4d9c', '#a6e4ff'] as const;
const ARCANE = ['#140a2e', '#5a2fb8', '#d6b8ff'] as const;
const NATURE = ['#07200c', '#2b7a2a', '#a8f070'] as const;
const WIND = ['#0a2622', '#1f7a6a', '#b8ffe8'] as const;
const SHADOW = ['#07040f', '#2d1a5e', '#8a5cff'] as const;
const STEEL = ['#0c0f16', '#3c4658', '#c8d2e6'] as const;
const GOODS = ['#1a1006', '#6b4a22', '#e8c07a'] as const;

/* ── Ability painters ─────────────────────────────────────────────── */

const ABILITY: Record<AbilityId, (ctx: Ctx) => void> = {
  rimeArrow: (ctx) => {
    smoke(ctx, ...FROST, 11, 78, 48);
    glow(ctx, 84, 42, 34, '#bff0ff', 0.8);
    // Shaft, fletching, a crystalline head with frost mist trailing.
    stroke(ctx, () => { ctx.moveTo(26, 102); ctx.lineTo(90, 38); }, lin(ctx, 26, 102, 90, 38, [[0, '#8cc4ec'], [1, '#ffffff']]), 6, 6);
    paint(ctx, () => poly(ctx, [104, 24, 66, 34, 76, 46, 88, 58]), lin(ctx, 66, 34, 104, 24, [[0, '#9fdcff'], [0.5, '#ffffff'], [1, '#c6ecff']]), 6);
    paint(ctx, () => poly(ctx, [26, 102, 18, 84, 34, 92]), '#bfe6ff', 4);
    paint(ctx, () => poly(ctx, [26, 102, 44, 110, 36, 94]), '#bfe6ff', 4);
    for (const [x, y, r] of [[58, 62, 4], [50, 76, 3], [70, 52, 2.5]] as const) sparkle(ctx, x, y, r, '#e8fbff');
    glow(ctx, 40, 90, 22, '#6fb8ff', 0.4);
  },
  fireWhirl: (ctx) => {
    smoke(ctx, ...FIRE, 12, 64, 60);
    // A whirlwind of fire: five flame tongues spiraling around a white-hot
    // eye, each tapering to a flickering tip, embers thrown off the rim.
    for (let i = 0; i < 5; i++) {
      const a = (i / 5) * Math.PI * 2 + 0.3;
      const tongue = (): void => {
        ctx.moveTo(64 + Math.cos(a) * 12, 64 + Math.sin(a) * 12);
        ctx.quadraticCurveTo(64 + Math.cos(a + 0.55) * 34, 64 + Math.sin(a + 0.55) * 34, 64 + Math.cos(a + 1.35) * 52, 64 + Math.sin(a + 1.35) * 52);
        ctx.quadraticCurveTo(64 + Math.cos(a + 1.0) * 36, 64 + Math.sin(a + 1.0) * 36, 64 + Math.cos(a + 0.9) * 26, 64 + Math.sin(a + 0.9) * 26);
        ctx.quadraticCurveTo(64 + Math.cos(a + 0.7) * 18, 64 + Math.sin(a + 0.7) * 18, 64 + Math.cos(a + 0.45) * 11, 64 + Math.sin(a + 0.45) * 11);
        ctx.closePath();
      };
      paint(ctx, tongue, rad(ctx, 64, 64, 52, [[0, '#fff6c0'], [0.3, '#ffcc4a'], [0.6, '#ff6a1e'], [1, '#8a1a06']]), 5, 'rgba(80,15,0,0.3)');
      glow(ctx, 64 + Math.cos(a + 1.3) * 46, 64 + Math.sin(a + 1.3) * 46, 8, '#ffb347', 0.7);
    }
    glow(ctx, 64, 64, 32, '#ffd27a', 0.9);
    glow(ctx, 64, 64, 13, '#ffffff', 1);
    for (const [x, y] of [[104, 30], [22, 40], [100, 100], [30, 104]] as const) sparkle(ctx, x, y, 3.5, '#ffd27a');
  },
  earthbreaker: (ctx) => {
    smoke(ctx, ...EARTH, 13, 60, 40);
    // A stone gauntlet driving down into cracking bedrock.
    const fist = (): void => poly(ctx, [40, 20, 88, 18, 100, 40, 94, 70, 52, 74, 30, 52]);
    paint(ctx, fist, lin(ctx, 40, 20, 94, 74, [[0, '#e0b384'], [0.5, '#a3703f'], [1, '#5a3819']]), 8);
    stroke(ctx, () => { ctx.moveTo(58, 34); ctx.lineTo(66, 50); ctx.moveTo(74, 30); ctx.lineTo(80, 46); ctx.moveTo(44, 44); ctx.lineTo(52, 56); }, 'rgba(60,30,10,0.7)', 3);
    sheen(ctx, fist, 40, 18, 70, 60, 0.35);
    // Ground: a slab splitting into fissures lit from below.
    paint(ctx, () => poly(ctx, [14, 84, 114, 84, 118, 116, 10, 116]), lin(ctx, 0, 84, 0, 116, [[0, '#8a5a30'], [1, '#2e1a0a']]), 0, '');
    stroke(ctx, () => {
      ctx.moveTo(64, 78); ctx.lineTo(50, 92); ctx.lineTo(40, 112); ctx.moveTo(64, 78); ctx.lineTo(80, 90); ctx.lineTo(96, 110);
      ctx.moveTo(64, 78); ctx.lineTo(62, 100); ctx.lineTo(70, 116); ctx.moveTo(56, 88); ctx.lineTo(28, 96); ctx.moveTo(74, 86); ctx.lineTo(104, 94);
    }, '#ffcf70', 3, 8);
    glow(ctx, 64, 84, 26, '#ffb060', 0.7);
  },
  holyShield: (ctx) => {
    smoke(ctx, ...HOLY, 14, 64, 56);
    glow(ctx, 64, 60, 56, '#fff1c0', 0.8);
    // Golden winged shield.
    for (const side of [-1, 1]) {
      paint(ctx, () => {
        ctx.moveTo(64 + side * 24, 40); ctx.quadraticCurveTo(64 + side * 56, 26, 64 + side * 58, 58);
        ctx.quadraticCurveTo(64 + side * 44, 52, 64 + side * 34, 66); ctx.closePath();
      }, lin(ctx, 64, 26, 64 + side * 58, 66, [[0, '#fff2c8'], [1, '#c9931a']]), 6);
    }
    const shield = (): void => {
      ctx.moveTo(64, 22); ctx.lineTo(96, 34); ctx.quadraticCurveTo(96, 86, 64, 110); ctx.quadraticCurveTo(32, 86, 32, 34); ctx.closePath();
    };
    paint(ctx, shield, lin(ctx, 40, 24, 90, 108, [[0, '#ffe9a8'], [0.45, '#e2b23a'], [1, '#8a5c10']]), 8);
    sheen(ctx, shield, 40, 22, 70, 80, 0.5);
    stroke(ctx, () => { ctx.moveTo(64, 36); ctx.lineTo(64, 94); ctx.moveTo(44, 56); ctx.lineTo(84, 56); }, '#fff8e0', 6, 6);
    glow(ctx, 64, 56, 16, '#ffffff', 0.8);
  },
  stormArchon: (ctx) => {
    smoke(ctx, ...STORM, 15, 64, 52);
    glow(ctx, 64, 50, 46, '#8fd6ff', 0.8);
    // An elemental of living lightning: a figure of bolts with a blazing core.
    stroke(ctx, () => {
      ctx.moveTo(64, 26); ctx.lineTo(56, 44); ctx.lineTo(68, 46); ctx.lineTo(60, 66); ctx.lineTo(72, 68); ctx.lineTo(62, 92);
      ctx.moveTo(60, 50); ctx.lineTo(36, 58); ctx.lineTo(44, 66); ctx.lineTo(22, 80);
      ctx.moveTo(68, 50); ctx.lineTo(92, 56); ctx.lineTo(84, 66); ctx.lineTo(106, 78);
      ctx.moveTo(62, 92); ctx.lineTo(48, 108); ctx.moveTo(66, 92); ctx.lineTo(82, 110);
    }, '#fff9c0', 4, 10);
    stroke(ctx, () => { ctx.moveTo(64, 26); ctx.lineTo(56, 44); ctx.lineTo(68, 46); ctx.lineTo(60, 66); ctx.lineTo(72, 68); ctx.lineTo(62, 92); }, '#ffffff', 2);
    glow(ctx, 64, 30, 14, '#ffffff', 0.9);
    glow(ctx, 64, 56, 22, '#bfe8ff', 0.6);
  },
  manaSphere: (ctx) => {
    smoke(ctx, ...ARCANE, 16, 64, 62);
    glow(ctx, 64, 64, 58, '#b48cff', 0.7);
    const orb = (): void => { ctx.arc(64, 64, 30, 0, Math.PI * 2); };
    paint(ctx, orb, rad(ctx, 64, 64, 30, [[0, '#f0e6ff'], [0.35, '#9d6bff'], [0.8, '#3d1a8c'], [1, '#1b0a45']], 54, 52, 2), 10);
    sheen(ctx, orb, 44, 36, 70, 70, 0.55);
    // Energy swirling across the surface.
    ctx.save();
    ctx.beginPath(); orb(); ctx.clip();
    stroke(ctx, () => { ctx.moveTo(34, 70); ctx.quadraticCurveTo(64, 40, 94, 72); ctx.moveTo(38, 84); ctx.quadraticCurveTo(66, 60, 92, 88); }, 'rgba(230,214,255,0.6)', 2.5, 4);
    ctx.restore();
    glow(ctx, 56, 54, 10, '#ffffff', 0.9);
  },
  searingAxe: (ctx) => {
    smoke(ctx, ...FIRE, 17, 48, 52);
    // Haft, then a molten crescent blade dripping lava.
    stroke(ctx, () => { ctx.moveTo(56, 56); ctx.lineTo(104, 108); }, lin(ctx, 56, 56, 104, 108, [[0, '#6a3a1c'], [1, '#2a1408']]), 10);
    stroke(ctx, () => { ctx.moveTo(84, 84); ctx.lineTo(90, 90); }, '#c9a06e', 12);
    const blade = (): void => {
      ctx.moveTo(30, 24); ctx.quadraticCurveTo(70, 14, 80, 52); ctx.quadraticCurveTo(66, 68, 40, 80); ctx.quadraticCurveTo(18, 56, 30, 24); ctx.closePath();
    };
    paint(ctx, blade, lin(ctx, 26, 24, 80, 80, [[0, '#fff0b0'], [0.3, '#ffb347'], [0.65, '#e0461a'], [1, '#5a1608']]), 9);
    sheen(ctx, blade, 30, 20, 60, 60, 0.4);
    stroke(ctx, () => { ctx.moveTo(40, 34); ctx.quadraticCurveTo(62, 30, 70, 50); }, '#ffffff', 2.5, 6);
    for (const [x, y] of [[48, 84], [60, 76], [38, 88]] as const) paint(ctx, () => { ctx.ellipse(x, y + 6, 3, 6, 0, 0, Math.PI * 2); }, '#ff8a2e', 4, '');
    glow(ctx, 50, 50, 30, '#ff9a3a', 0.6);
  },
  slicingWinds: (ctx) => {
    smoke(ctx, ...WIND, 18, 64, 60);
    // Three crescent gales cutting up and to the right.
    for (const [dx, dy, a] of [[-14, 20, 0.7], [0, 0, 1], [14, -20, 0.8]] as const) {
      stroke(ctx, () => { ctx.moveTo(28 + dx, 88 + dy); ctx.quadraticCurveTo(58 + dx, 36 + dy, 104 + dx, 40 + dy); },
        lin(ctx, 28 + dx, 88 + dy, 104 + dx, 40 + dy, [[0, `rgba(184,255,232,${a * 0.2})`], [0.6, `rgba(230,255,246,${a})`], [1, `rgba(255,255,255,${a})`]]), 9, 10);
      stroke(ctx, () => { ctx.moveTo(40 + dx, 80 + dy); ctx.quadraticCurveTo(62 + dx, 44 + dy, 100 + dx, 42 + dy); }, `rgba(255,255,255,${a * 0.9})`, 2.5);
    }
    glow(ctx, 96, 40, 24, '#e0fff4', 0.5);
  },
  starBomb: (ctx) => {
    smoke(ctx, ...ARCANE, 19, 66, 50);
    // A blazing star plunging with a long trail toward impact sparks.
    stroke(ctx, () => { ctx.moveTo(24, 18); ctx.lineTo(64, 56); }, lin(ctx, 24, 18, 64, 56, [[0, 'rgba(214,184,255,0)'], [1, '#ffffff']]), 14, 12);
    glow(ctx, 66, 56, 40, '#d6b8ff', 0.9);
    paint(ctx, () => star(ctx, 66, 58, 28, 12), rad(ctx, 66, 58, 28, [[0, '#ffffff'], [0.5, '#fff3b0'], [1, '#c8a0ff']]), 8, '');
    glow(ctx, 66, 58, 14, '#ffffff', 1);
    for (const [x, y, r] of [[30, 100, 5], [98, 104, 4], [60, 110, 3.5], [104, 82, 3]] as const) sparkle(ctx, x, y, r, '#f0e0ff');
    stroke(ctx, () => { ctx.moveTo(40, 98); ctx.quadraticCurveTo(66, 84, 94, 100); }, 'rgba(230,214,255,0.7)', 3, 6);
  },
  toxicSmackerel: (ctx) => {
    smoke(ctx, ...NATURE, 20, 56, 64);
    glow(ctx, 60, 66, 44, '#8fe060', 0.5);
    // The fish: a plump body, spined fins, a fanned tail, a toxic glint.
    const body = (): void => { ctx.ellipse(54, 68, 36, 22, -0.2, 0, Math.PI * 2); };
    paint(ctx, () => poly(ctx, [86, 62, 116, 40, 110, 70, 118, 96]), lin(ctx, 86, 40, 118, 96, [[0, '#8be25a'], [1, '#2c7a22']]), 6);
    paint(ctx, () => poly(ctx, [40, 50, 58, 30, 76, 48]), lin(ctx, 40, 30, 76, 50, [[0, '#a8f070'], [1, '#3f9a32']]), 5);
    paint(ctx, body, lin(ctx, 20, 46, 90, 92, [[0, '#c4f58a'], [0.4, '#6cc94a'], [1, '#1f5f1c']]), 9);
    sheen(ctx, body, 24, 46, 60, 80, 0.5);
    paint(ctx, () => poly(ctx, [48, 84, 62, 100, 70, 84]), '#3f9a32', 4);
    paint(ctx, () => { ctx.arc(32, 62, 6.5, 0, Math.PI * 2); }, '#f6ffe0', 3, '');
    paint(ctx, () => { ctx.arc(33, 62, 3.5, 0, Math.PI * 2); }, '#12200a', 0, '');
    stroke(ctx, () => { ctx.moveTo(22, 72); ctx.quadraticCurveTo(30, 80, 40, 78); }, 'rgba(20,50,10,0.6)', 2.5);
    for (const [x, y, r] of [[96, 26, 4], [108, 18, 3], [88, 18, 2.5]] as const) paint(ctx, () => { ctx.arc(x, y, r, 0, Math.PI * 2); }, 'rgba(220,255,200,0.8)', 0, '');
  },
  celestialBarrage: (ctx) => {
    smoke(ctx, ...ARCANE, 21, 64, 40);
    // A shower of falling stars, streaking down and left.
    for (const [x, y, r, len] of [[70, 34, 10, 40], [40, 62, 7, 30], [96, 70, 6, 26], [58, 96, 5, 22]] as const) {
      stroke(ctx, () => { ctx.moveTo(x + len, y - len); ctx.lineTo(x, y); }, lin(ctx, x + len, y - len, x, y, [[0, 'rgba(214,184,255,0)'], [1, '#ffffff']]), r * 0.9, 8);
      glow(ctx, x, y, r * 3, '#d6b8ff', 0.9);
      paint(ctx, () => star(ctx, x, y, r, r * 0.4, 4), '#ffffff', 0, '');
    }
    glow(ctx, 64, 60, 50, '#8a5aff', 0.35);
  },
  quakingLeap: (ctx) => {
    smoke(ctx, ...EARTH, 22, 64, 50);
    // A leaping silhouette against a burst of light, ground cracking below.
    glow(ctx, 64, 44, 44, '#ffcf80', 0.8);
    const figure = (): void => {
      ctx.moveTo(56, 34); ctx.lineTo(72, 34); ctx.lineTo(78, 60); ctx.lineTo(96, 40);
      ctx.lineTo(100, 48); ctx.lineTo(80, 70); ctx.lineTo(72, 66); ctx.lineTo(84, 92); ctx.lineTo(74, 96); ctx.lineTo(60, 72); ctx.lineTo(42, 86);
      ctx.lineTo(36, 78); ctx.lineTo(54, 58); ctx.lineTo(50, 46); ctx.lineTo(30, 56); ctx.lineTo(26, 48); ctx.lineTo(52, 36); ctx.closePath();
    };
    const fill = lin(ctx, 30, 20, 100, 96, [[0, '#5a3818'], [1, '#1e1006']]);
    paint(ctx, figure, fill, 8, 'rgba(255,200,120,0.35)');
    paint(ctx, () => { ctx.arc(64, 22, 9, 0, Math.PI * 2); }, fill, 8, 'rgba(255,200,120,0.35)');
    stroke(ctx, () => {
      ctx.moveTo(18, 104); ctx.lineTo(36, 108); ctx.lineTo(50, 100); ctx.lineTo(66, 108); ctx.lineTo(82, 100); ctx.lineTo(98, 108); ctx.lineTo(112, 104);
      ctx.moveTo(44, 104); ctx.lineTo(38, 118); ctx.moveTo(86, 104); ctx.lineTo(94, 118);
    }, '#ffd28a', 4, 8);
  },
  huntersChains: (ctx) => {
    smoke(ctx, ...STEEL, 23, 60, 60);
    // Heavy links running to a barbed hook.
    for (let i = 0; i < 4; i++) {
      const x = 28 + i * 22;
      const y = 96 - i * 20;
      ctx.save();
      ctx.lineWidth = 7;
      ctx.shadowColor = 'rgba(0,0,0,0.6)';
      ctx.shadowBlur = 5;
      ctx.shadowOffsetY = 2;
      ctx.strokeStyle = lin(ctx, x - 12, y - 10, x + 12, y + 10, [[0, '#f0f4ff'], [0.5, '#9aa4b8'], [1, '#3a4252']]);
      ctx.beginPath();
      ctx.ellipse(x, y, 15, 9, -0.75, 0, Math.PI * 2);
      ctx.stroke();
      ctx.restore();
    }
    paint(ctx, () => { ctx.moveTo(104, 24); ctx.quadraticCurveTo(122, 36, 108, 56); ctx.lineTo(100, 50); ctx.quadraticCurveTo(108, 40, 100, 32); ctx.closePath(); },
      lin(ctx, 100, 24, 116, 56, [[0, '#e8ecf4'], [1, '#6b7382']]), 6);
    glow(ctx, 70, 66, 30, '#c8d2e6', 0.25);
  },
  steelTraps: (ctx) => {
    smoke(ctx, ...STEEL, 24, 64, 66);
    // A bear trap from above: steel ring, two rows of teeth, the trigger plate.
    ctx.save();
    ctx.lineWidth = 9;
    ctx.shadowColor = 'rgba(0,0,0,0.6)';
    ctx.shadowBlur = 6;
    ctx.strokeStyle = lin(ctx, 22, 24, 106, 108, [[0, '#f4f7ff'], [0.5, '#8c96aa'], [1, '#2e3644']]);
    ctx.beginPath();
    ctx.arc(64, 66, 42, 0, Math.PI * 2);
    ctx.stroke();
    ctx.restore();
    for (let t = 0; t < 6; t++) {
      const x = 30 + t * 13.6;
      paint(ctx, () => poly(ctx, [x, 42, x + 13.6, 42, x + 6.8, 62]), lin(ctx, x, 42, x, 62, [[0, '#f8faff'], [1, '#9aa4b8']]), 3, 'rgba(0,0,0,0.25)');
      paint(ctx, () => poly(ctx, [x, 90, x + 13.6, 90, x + 6.8, 70]), lin(ctx, x, 90, x, 70, [[0, '#f8faff'], [1, '#9aa4b8']]), 3, 'rgba(0,0,0,0.25)');
    }
    stroke(ctx, () => { ctx.moveTo(24, 42); ctx.lineTo(104, 42); ctx.moveTo(24, 90); ctx.lineTo(104, 90); }, '#5a6474', 4);
    paint(ctx, () => { ctx.arc(64, 66, 9, 0, Math.PI * 2); }, rad(ctx, 62, 63, 9, [[0, '#ffd27a'], [1, '#8a5a10']]), 4);
  },
  windstorm: (ctx) => {
    smoke(ctx, ...WIND, 25, 64, 50);
    glow(ctx, 64, 52, 48, '#b8ffe8', 0.4);
    // A cyclone: stacked whirling bands narrowing to the ground, debris flying.
    for (let i = 0; i < 6; i++) {
      const w = 46 - i * 7;
      const y = 26 + i * 15;
      const x = 64 + (i % 2 ? 5 : -5) * (1 - i / 6);
      stroke(ctx, () => { ctx.ellipse(x, y, w, 8, 0, 0, Math.PI * 2); }, `rgba(232,255,246,${0.9 - i * 0.08})`, 5 - i * 0.4, 6);
    }
    for (const [x, y] of [[20, 40], [110, 70], [26, 84]] as const) paint(ctx, () => poly(ctx, [x, y, x + 8, y - 4, x + 6, y + 6]), '#cfe8dd', 3, '');
  },
  explosiveCaltrops: (ctx) => {
    smoke(ctx, ...FIRE, 26, 64, 66);
    glow(ctx, 64, 60, 44, '#ffb347', 0.5);
    // Steel caltrop with a detonation blooming behind it.
    paint(ctx, () => star(ctx, 64, 60, 44, 14, 8, 0.2), rad(ctx, 64, 60, 44, [[0, '#fff2b0'], [0.4, '#ff9a3a'], [1, 'rgba(120,20,0,0)']]), 0, '');
    ctx.save();
    ctx.lineWidth = 9;
    ctx.lineCap = 'round';
    ctx.shadowColor = 'rgba(0,0,0,0.6)';
    ctx.shadowBlur = 6;
    ctx.strokeStyle = lin(ctx, 40, 30, 90, 100, [[0, '#f4f7ff'], [0.5, '#9aa4b8'], [1, '#3a4252']]);
    ctx.beginPath();
    ctx.moveTo(64, 66); ctx.lineTo(64, 26); ctx.moveTo(64, 66); ctx.lineTo(30, 92); ctx.moveTo(64, 66); ctx.lineTo(98, 92); ctx.moveTo(64, 66); ctx.lineTo(80, 108);
    ctx.stroke();
    ctx.restore();
    for (const [x, y] of [[64, 24], [28, 94], [100, 94], [82, 110]] as const) sparkle(ctx, x, y, 5, '#ffe6a0');
  },
  snowdrift: (ctx) => {
    smoke(ctx, ...FROST, 27, 64, 70);
    // A drift of snow banked under a great crystalline flake.
    paint(ctx, () => { ctx.moveTo(10, 118); ctx.quadraticCurveTo(30, 82, 64, 92); ctx.quadraticCurveTo(96, 80, 118, 118); ctx.closePath(); },
      lin(ctx, 0, 84, 0, 118, [[0, '#ffffff'], [1, '#9fd0f0']]), 6, '');
    glow(ctx, 64, 54, 44, '#c8f0ff', 0.7);
    stroke(ctx, () => {
      for (let i = 0; i < 6; i++) {
        const a = (i / 6) * Math.PI * 2;
        const c = Math.cos(a);
        const s = Math.sin(a);
        ctx.moveTo(64, 54); ctx.lineTo(64 + c * 34, 54 + s * 34);
        ctx.moveTo(64 + c * 20, 54 + s * 20); ctx.lineTo(64 + Math.cos(a + 0.5) * 30, 54 + Math.sin(a + 0.5) * 30);
        ctx.moveTo(64 + c * 20, 54 + s * 20); ctx.lineTo(64 + Math.cos(a - 0.5) * 30, 54 + Math.sin(a - 0.5) * 30);
      }
    }, '#f4fcff', 4, 8);
    glow(ctx, 64, 54, 10, '#ffffff', 0.9);
  },
  lightningBulwark: (ctx) => {
    smoke(ctx, ...STORM, 28, 64, 60);
    const shield = (): void => {
      ctx.moveTo(64, 18); ctx.lineTo(102, 32); ctx.quadraticCurveTo(102, 86, 64, 112); ctx.quadraticCurveTo(26, 86, 26, 32); ctx.closePath();
    };
    paint(ctx, shield, lin(ctx, 30, 20, 100, 110, [[0, '#8fd6ff'], [0.45, '#2b6fd0'], [1, '#0d2a6a']]), 9);
    sheen(ctx, shield, 30, 18, 66, 76, 0.45);
    glow(ctx, 64, 62, 30, '#a6e4ff', 0.7);
    paint(ctx, () => poly(ctx, [74, 32, 50, 68, 64, 68, 54, 98, 84, 58, 68, 58]), lin(ctx, 50, 32, 84, 98, [[0, '#ffffff'], [0.5, '#fff066'], [1, '#e0a000']]), 6, 'rgba(255,255,255,0.4)');
    glow(ctx, 66, 62, 12, '#ffffff', 0.8);
  },
  fadeToShadow: (ctx) => {
    smoke(ctx, ...SHADOW, 29, 64, 56);
    // A hooded silhouette dissolving into violet smoke, eyes still burning.
    glow(ctx, 64, 60, 46, '#6a3ac8', 0.6);
    const hood = (): void => {
      ctx.moveTo(64, 20); ctx.quadraticCurveTo(100, 36, 96, 80); ctx.quadraticCurveTo(86, 96, 72, 108); ctx.quadraticCurveTo(64, 98, 56, 108);
      ctx.quadraticCurveTo(42, 96, 32, 80); ctx.quadraticCurveTo(28, 36, 64, 20); ctx.closePath();
    };
    paint(ctx, hood, lin(ctx, 40, 20, 90, 108, [[0, '#4a2c8a'], [0.5, '#1e0f42'], [1, '#08040f']]), 10, 'rgba(160,110,255,0.3)');
    paint(ctx, () => { ctx.moveTo(64, 40); ctx.quadraticCurveTo(86, 48, 84, 74); ctx.quadraticCurveTo(64, 70, 44, 74); ctx.quadraticCurveTo(42, 48, 64, 40); ctx.closePath(); }, '#05030a', 0, '');
    for (const x of [55, 73]) {
      glow(ctx, x, 60, 9, '#c9a8ff', 1);
      paint(ctx, () => { ctx.ellipse(x, 60, 4, 2.5, 0, 0, Math.PI * 2); }, '#f5ecff', 0, '');
    }
    for (const [x, y, r] of [[30, 96, 9], [98, 100, 8], [24, 70, 6]] as const) glow(ctx, x, y, r * 2, '#8a5cff', 0.5);
  },
  repel: (ctx) => {
    smoke(ctx, ...ARCANE, 30, 64, 64);
    // A translucent barrier bubble with force radiating outward.
    const bubble = (): void => { ctx.arc(64, 64, 34, 0, Math.PI * 2); };
    paint(ctx, bubble, rad(ctx, 64, 64, 34, [[0, 'rgba(230,214,255,0.15)'], [0.75, 'rgba(200,170,255,0.35)'], [1, 'rgba(255,255,255,0.85)']]), 0, 'rgba(255,255,255,0.7)');
    sheen(ctx, bubble, 40, 34, 66, 70, 0.6);
    for (let i = 0; i < 8; i++) {
      const a = (i / 8) * Math.PI * 2 + Math.PI / 8;
      const c = Math.cos(a);
      const s = Math.sin(a);
      stroke(ctx, () => { ctx.moveTo(64 + c * 40, 64 + s * 40); ctx.lineTo(64 + c * 56, 64 + s * 56); },
        lin(ctx, 64 + c * 40, 64 + s * 40, 64 + c * 56, 64 + s * 56, [[0, 'rgba(255,255,255,0.9)'], [1, 'rgba(214,184,255,0)']]), 5, 6);
    }
    glow(ctx, 64, 64, 22, '#e6d6ff', 0.5);
  },
  faeform: (ctx) => {
    smoke(ctx, '#160a2a', '#7a2f9e', '#ffb0e8', 31, 64, 56);
    glow(ctx, 64, 58, 46, '#ff9ee0', 0.6);
    // A fae fox: pointed ears, a glowing muzzle, trailing sparkles.
    const head = (): void => { poly(ctx, [28, 26, 50, 52, 78, 52, 100, 26, 104, 62, 64, 104, 24, 62]); };
    paint(ctx, head, lin(ctx, 30, 26, 100, 104, [[0, '#ffd6f2'], [0.5, '#f07ad0'], [1, '#7a2f9e']]), 9, 'rgba(255,200,240,0.4)');
    sheen(ctx, head, 30, 26, 70, 70, 0.4);
    for (const x of [50, 78]) {
      glow(ctx, x, 66, 8, '#ffffff', 0.9);
      paint(ctx, () => { ctx.ellipse(x, 66, 4, 6, 0, 0, Math.PI * 2); }, '#3a1050', 0, '');
    }
    paint(ctx, () => { ctx.arc(64, 84, 4, 0, Math.PI * 2); }, '#3a1050', 0, '');
    for (const [x, y, r] of [[18, 92, 5], [110, 96, 4.5], [20, 22, 4], [108, 18, 3.5]] as const) sparkle(ctx, x, y, r, '#fff0ff');
  },
};

/* ── Item painters ────────────────────────────────────────────────── */

const ITEM: Record<ItemId, (ctx: Ctx) => void> = {
  chickenCoup: (ctx) => {
    smoke(ctx, ...GOODS, 40, 60, 60);
    // A plump white hen: body, tail feathers, red comb and wattle, beak.
    const body = (): void => { ctx.ellipse(60, 70, 34, 26, -0.2, 0, Math.PI * 2); };
    paint(ctx, () => poly(ctx, [30, 60, 14, 40, 34, 48, 22, 30, 42, 46]), lin(ctx, 14, 30, 42, 60, [[0, '#ffffff'], [1, '#c8c0b0']]), 5);
    paint(ctx, body, lin(ctx, 30, 44, 90, 96, [[0, '#ffffff'], [0.5, '#f0ebe0'], [1, '#a89f8e']]), 9);
    sheen(ctx, body, 30, 44, 62, 80, 0.5);
    paint(ctx, () => { ctx.arc(90, 44, 15, 0, Math.PI * 2); }, lin(ctx, 76, 30, 104, 58, [[0, '#ffffff'], [1, '#c8c0b0']]), 6);
    paint(ctx, () => poly(ctx, [84, 30, 90, 20, 96, 30, 102, 22, 104, 32]), '#e0302a', 3);
    paint(ctx, () => poly(ctx, [102, 46, 118, 50, 102, 54]), '#ffb030', 3);
    paint(ctx, () => { ctx.ellipse(98, 58, 4, 7, 0, 0, Math.PI * 2); }, '#e0302a', 3, '');
    paint(ctx, () => { ctx.arc(94, 42, 2.5, 0, Math.PI * 2); }, '#1a1208', 0, '');
    stroke(ctx, () => { ctx.moveTo(52, 96); ctx.lineTo(50, 110); ctx.moveTo(68, 96); ctx.lineTo(70, 110); }, '#ffb030', 4);
  },
  smokeBomb: (ctx) => {
    smoke(ctx, ...STEEL, 41, 48, 74);
    // Billowing smoke above an iron bomb with a lit fuse.
    for (const [x, y, r] of [[92, 34, 14], [76, 24, 12], [106, 22, 10], [64, 38, 9]] as const) {
      paint(ctx, () => { ctx.arc(x, y, r, 0, Math.PI * 2); }, rad(ctx, x - r * 0.3, y - r * 0.3, r, [[0, '#f0f2f8'], [1, '#8a92a4']]), 6, '');
    }
    const bomb = (): void => { ctx.arc(56, 76, 30, 0, Math.PI * 2); };
    paint(ctx, bomb, rad(ctx, 56, 76, 30, [[0, '#6a7080'], [0.5, '#2c313c'], [1, '#0c0e14']], 46, 66, 2), 10);
    sheen(ctx, bomb, 30, 48, 60, 80, 0.35);
    paint(ctx, () => poly(ctx, [70, 52, 82, 46, 88, 56, 76, 62]), '#4a505c', 4);
    stroke(ctx, () => { ctx.moveTo(84, 50); ctx.quadraticCurveTo(92, 40, 88, 30); }, '#c9a06e', 4);
    sparkle(ctx, 88, 28, 7, '#ffd66a');
  },
  mechanoHog: (ctx) => {
    smoke(ctx, ...FIRE, 42, 64, 62);
    // The goblin chopper: a spoked wheel, a chromed engine, an exhaust flame.
    ctx.save();
    ctx.lineWidth = 10;
    ctx.shadowColor = 'rgba(0,0,0,0.6)';
    ctx.shadowBlur = 6;
    ctx.strokeStyle = lin(ctx, 36, 38, 104, 106, [[0, '#3a3f4a'], [0.5, '#0e1016'], [1, '#3a3f4a']]);
    ctx.beginPath();
    ctx.arc(70, 72, 34, 0, Math.PI * 2);
    ctx.stroke();
    ctx.restore();
    stroke(ctx, () => { ctx.arc(70, 72, 34, 0, Math.PI * 2); }, 'rgba(255,255,255,0.18)', 3);
    stroke(ctx, () => {
      for (let i = 0; i < 8; i++) { const a = (i / 8) * Math.PI * 2; ctx.moveTo(70, 72); ctx.lineTo(70 + Math.cos(a) * 28, 72 + Math.sin(a) * 28); }
    }, '#9aa4b8', 3);
    paint(ctx, () => { ctx.arc(70, 72, 10, 0, Math.PI * 2); }, rad(ctx, 66, 68, 10, [[0, '#fff0c0'], [1, '#b06a10']]), 5);
    // Engine block and pipes up front, flame out the back.
    paint(ctx, () => poly(ctx, [18, 46, 52, 40, 56, 64, 26, 70]), lin(ctx, 18, 40, 56, 70, [[0, '#e8ecf4'], [0.5, '#8c96aa'], [1, '#2e3644']]), 7);
    stroke(ctx, () => { ctx.moveTo(22, 74); ctx.lineTo(10, 92); ctx.moveTo(34, 74); ctx.lineTo(24, 96); }, '#c8d2e6', 5);
    paint(ctx, () => poly(ctx, [10, 96, 30, 90, 22, 104, 36, 110, 14, 112]), '#ff8a2e', 4, '');
    glow(ctx, 16, 102, 14, '#ffb347', 0.8);
    stroke(ctx, () => { ctx.moveTo(40, 40); ctx.lineTo(52, 22); ctx.lineTo(68, 26); }, '#c8d2e6', 5);
  },
  gravityLauncher: (ctx) => {
    smoke(ctx, ...STORM, 43, 64, 60);
    // A gnomish spring-loaded launch pad firing a figure skyward.
    paint(ctx, () => poly(ctx, [24, 100, 104, 100, 112, 116, 16, 116]), lin(ctx, 0, 100, 0, 116, [[0, '#c8d2e6'], [1, '#3c4658']]), 7);
    stroke(ctx, () => {
      for (let i = 0; i < 4; i++) { ctx.moveTo(40, 98 - i * 8); ctx.lineTo(88, 94 - i * 8); }
    }, '#e8b040', 4);
    paint(ctx, () => poly(ctx, [36, 70, 92, 70, 96, 78, 32, 78]), lin(ctx, 0, 70, 0, 78, [[0, '#ffe08a'], [1, '#b07a10']]), 5);
    glow(ctx, 64, 60, 36, '#8fd6ff', 0.7);
    paint(ctx, () => poly(ctx, [64, 14, 90, 46, 74, 46, 74, 66, 54, 66, 54, 46, 38, 46]), lin(ctx, 64, 14, 64, 66, [[0, '#ffffff'], [1, '#8fd6ff']]), 7, 'rgba(255,255,255,0.4)');
    stroke(ctx, () => { ctx.moveTo(24, 40); ctx.lineTo(34, 30); ctx.moveTo(104, 40); ctx.lineTo(94, 30); }, '#bfe8ff', 4, 6);
  },
  toTheSkies: (ctx) => {
    smoke(ctx, ...STORM, 44, 64, 46);
    // A red-and-white rocket climbing on a plume of fire.
    glow(ctx, 64, 104, 26, '#ffb347', 0.9);
    paint(ctx, () => poly(ctx, [54, 92, 74, 92, 64, 122]), lin(ctx, 0, 92, 0, 122, [[0, '#ffffff'], [0.3, '#ffd166'], [1, '#ff5a1e']]), 0, '');
    const hull = (): void => {
      ctx.moveTo(64, 10); ctx.quadraticCurveTo(86, 36, 80, 88); ctx.lineTo(48, 88); ctx.quadraticCurveTo(42, 36, 64, 10); ctx.closePath();
    };
    paint(ctx, hull, lin(ctx, 44, 20, 84, 88, [[0, '#ffffff'], [0.5, '#e8ecf4'], [1, '#8c96aa']]), 9);
    sheen(ctx, hull, 44, 10, 70, 60, 0.5);
    paint(ctx, () => { ctx.moveTo(64, 10); ctx.quadraticCurveTo(80, 28, 78, 40); ctx.lineTo(50, 40); ctx.quadraticCurveTo(48, 28, 64, 10); ctx.closePath(); }, lin(ctx, 50, 10, 78, 40, [[0, '#ff7a5a'], [1, '#c8261a']]), 4, '');
    paint(ctx, () => poly(ctx, [48, 70, 30, 96, 50, 90]), lin(ctx, 30, 70, 50, 96, [[0, '#ff7a5a'], [1, '#c8261a']]), 5);
    paint(ctx, () => poly(ctx, [80, 70, 98, 96, 78, 90]), lin(ctx, 78, 70, 98, 96, [[0, '#ff7a5a'], [1, '#c8261a']]), 5);
    paint(ctx, () => { ctx.arc(64, 56, 8, 0, Math.PI * 2); }, rad(ctx, 62, 54, 8, [[0, '#bfe8ff'], [1, '#1f5fa8']]), 4);
  },
};

/* ── Builtins ─────────────────────────────────────────────────────── */

const BUILTIN: Record<BuiltinIconId, (ctx: Ctx) => void> = {
  slap: (ctx) => {
    smoke(ctx, ...GOODS, 50, 66, 70);
    glow(ctx, 66, 74, 40, '#ffd9a8', 0.7);
    // An open palm, fingers spread, mid-swing.
    const hand = (): void => {
      ctx.moveTo(40, 112); ctx.lineTo(36, 66); ctx.lineTo(44, 62); ctx.lineTo(50, 78);
      ctx.lineTo(48, 28); ctx.lineTo(58, 26); ctx.lineTo(62, 68); ctx.lineTo(66, 18); ctx.lineTo(76, 20);
      ctx.lineTo(76, 68); ctx.lineTo(82, 26); ctx.lineTo(92, 30); ctx.lineTo(88, 74); ctx.lineTo(96, 48);
      ctx.lineTo(106, 54); ctx.lineTo(94, 100); ctx.lineTo(84, 112); ctx.closePath();
    };
    paint(ctx, hand, lin(ctx, 40, 20, 100, 112, [[0, '#ffe6c0'], [0.5, '#f0b878'], [1, '#8a5a2e']]), 9, 'rgba(60,30,10,0.35)');
    sheen(ctx, hand, 40, 20, 70, 70, 0.4);
    stroke(ctx, () => { ctx.moveTo(18, 60); ctx.lineTo(28, 62); ctx.moveTo(16, 76); ctx.lineTo(26, 76); ctx.moveTo(20, 92); ctx.lineTo(30, 88); }, 'rgba(255,240,200,0.7)', 3, 5);
  },
  heal: (ctx) => {
    smoke(ctx, ...NATURE, 51, 64, 60);
    glow(ctx, 64, 60, 46, '#b8ffb8', 0.7);
    const heart = (): void => {
      ctx.moveTo(64, 106); ctx.bezierCurveTo(20, 76, 20, 34, 46, 30); ctx.bezierCurveTo(56, 28, 62, 36, 64, 42);
      ctx.bezierCurveTo(66, 36, 72, 28, 82, 30); ctx.bezierCurveTo(108, 34, 108, 76, 64, 106); ctx.closePath();
    };
    paint(ctx, heart, lin(ctx, 30, 30, 96, 104, [[0, '#d8ffd0'], [0.45, '#7ee07a'], [1, '#1f6a2a']]), 9, 'rgba(255,255,255,0.35)');
    sheen(ctx, heart, 30, 28, 64, 70, 0.5);
    stroke(ctx, () => { ctx.moveTo(64, 50); ctx.lineTo(64, 86); ctx.moveTo(46, 68); ctx.lineTo(82, 68); }, '#ffffff', 7, 8);
  },
  roll: (ctx) => {
    smoke(ctx, ...GOODS, 52, 64, 64);
    // A wooden barrel tumbling, with a motion arc.
    stroke(ctx, () => { ctx.arc(64, 64, 46, Math.PI * 0.9, Math.PI * 1.7); }, 'rgba(255,230,180,0.8)', 6, 8);
    paint(ctx, () => poly(ctx, [24, 44, 34, 30, 40, 44]), '#ffe6b0', 4, '');
    const barrel = (): void => { ctx.moveTo(40, 40); ctx.quadraticCurveTo(64, 30, 88, 40); ctx.lineTo(92, 88); ctx.quadraticCurveTo(64, 98, 36, 88); ctx.closePath(); };
    paint(ctx, barrel, lin(ctx, 36, 30, 92, 98, [[0, '#d9a066'], [0.5, '#9a6234'], [1, '#4a2a12']]), 9);
    sheen(ctx, barrel, 40, 30, 66, 70, 0.35);
    stroke(ctx, () => { ctx.moveTo(38, 52); ctx.quadraticCurveTo(64, 46, 90, 52); ctx.moveTo(37, 78); ctx.quadraticCurveTo(64, 84, 91, 78); }, '#5a6474', 5);
  },
  dive: (ctx) => {
    smoke(ctx, ...STORM, 53, 64, 70);
    glow(ctx, 64, 90, 30, '#bfe8ff', 0.6);
    paint(ctx, () => poly(ctx, [64, 112, 32, 72, 52, 72, 52, 20, 76, 20, 76, 72, 96, 72]), lin(ctx, 64, 20, 64, 112, [[0, '#ffffff'], [1, '#6fb8ff']]), 8, 'rgba(255,255,255,0.4)');
    stroke(ctx, () => { ctx.moveTo(22, 42); ctx.lineTo(40, 42); ctx.moveTo(88, 42); ctx.lineTo(106, 42); ctx.moveTo(18, 58); ctx.lineTo(34, 58); ctx.moveTo(94, 58); ctx.lineTo(110, 58); }, 'rgba(191,232,255,0.8)', 4, 6);
  },
};

/* ── Cache ────────────────────────────────────────────────────────── */

function render(kind: IconKind, id: string): HTMLCanvasElement {
  const key = `${kind}:${id}`;
  let canvas = canvases.get(key);
  if (canvas) return canvas;
  canvas = document.createElement('canvas');
  canvas.width = canvas.height = SIZE;
  const ctx = canvas.getContext('2d')!;
  let seed = 1;
  for (const ch of key) seed = (seed * 31 + ch.charCodeAt(0)) >>> 0;
  const painter =
    kind === 'ability' ? ABILITY[id as AbilityId] : kind === 'item' ? ITEM[id as ItemId] : BUILTIN[id as BuiltinIconId];
  if (painter) painter(ctx);
  else smoke(ctx, ...STEEL, seed);
  frame(ctx, seed);
  canvases.set(key, canvas);
  return canvas;
}

/** The painted icon as a canvas (for CanvasTexture sprites). */
export function iconCanvas(kind: IconKind, id: string): HTMLCanvasElement {
  return render(kind, id);
}

/** The painted icon as a data URL (for CSS background-image). */
export function iconUrl(kind: IconKind, id: string): string {
  const key = `${kind}:${id}`;
  let url = urls.get(key);
  if (!url) {
    url = render(kind, id).toDataURL('image/png');
    urls.set(key, url);
  }
  return url;
}
