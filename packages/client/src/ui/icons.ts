import type { AbilityId, ItemId } from '@claudestorm/shared';
import { ELEMENT_PALETTE, elementKeyOf, type Element } from '../elements.js';

/*
 * Painted ability icons in the WoW / Plunderstorm mold: a square tile with
 * a deep-to-bright radial wash in the spell's element colors, a bold
 * glyph drawn in light strokes over a dark outline, a glossy top edge and
 * a beveled rim. Everything is drawn on a canvas at load — no image files —
 * and cached as both a canvas (for 3D sprites) and a data URL (for the DOM).
 */

export type IconKind = 'ability' | 'item' | 'builtin';
export type BuiltinIconId = 'slap' | 'heal' | 'roll' | 'dive';

const SIZE = 128;
const canvases = new Map<string, HTMLCanvasElement>();
const urls = new Map<string, string>();

type Ctx = CanvasRenderingContext2D;

function hex(c: number): string {
  return `#${c.toString(16).padStart(6, '0')}`;
}

function shade(c: number, f: number): string {
  const r = Math.min(255, Math.round(((c >> 16) & 255) * f));
  const g = Math.min(255, Math.round(((c >> 8) & 255) * f));
  const b = Math.min(255, Math.round((c & 255) * f));
  return `rgb(${r},${g},${b})`;
}

/** Background wash + frame; the glyph is painted on top by the caller. */
function tile(ctx: Ctx, core: number, deep: number): void {
  const s = SIZE;
  ctx.save();
  ctx.beginPath();
  roundRect(ctx, 0, 0, s, s, 14);
  ctx.clip();
  const g = ctx.createRadialGradient(s * 0.45, s * 0.4, s * 0.05, s * 0.5, s * 0.5, s * 0.75);
  g.addColorStop(0, shade(core, 1.05));
  g.addColorStop(0.55, hex(deep));
  g.addColorStop(1, shade(deep, 0.45));
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, s, s);
  // Faint diagonal texture so the wash reads painted, not flat.
  ctx.globalAlpha = 0.08;
  ctx.strokeStyle = '#ffffff';
  ctx.lineWidth = 2;
  for (let i = -s; i < s * 2; i += 9) {
    ctx.beginPath();
    ctx.moveTo(i, 0);
    ctx.lineTo(i + s, s);
    ctx.stroke();
  }
  ctx.globalAlpha = 1;
  ctx.restore();
}

function finish(ctx: Ctx): void {
  const s = SIZE;
  ctx.save();
  ctx.beginPath();
  roundRect(ctx, 0, 0, s, s, 14);
  ctx.clip();
  // Gloss on the upper half.
  const gloss = ctx.createLinearGradient(0, 0, 0, s * 0.5);
  gloss.addColorStop(0, 'rgba(255,255,255,0.28)');
  gloss.addColorStop(1, 'rgba(255,255,255,0)');
  ctx.fillStyle = gloss;
  ctx.fillRect(0, 0, s, s * 0.5);
  // Vignette.
  const vig = ctx.createRadialGradient(s / 2, s / 2, s * 0.35, s / 2, s / 2, s * 0.75);
  vig.addColorStop(0, 'rgba(0,0,0,0)');
  vig.addColorStop(1, 'rgba(0,0,0,0.45)');
  ctx.fillStyle = vig;
  ctx.fillRect(0, 0, s, s);
  ctx.restore();
  // Beveled rim: dark outer, light inner.
  ctx.lineWidth = 6;
  ctx.strokeStyle = 'rgba(12,10,20,0.95)';
  ctx.beginPath();
  roundRect(ctx, 3, 3, s - 6, s - 6, 12);
  ctx.stroke();
  ctx.lineWidth = 2;
  ctx.strokeStyle = 'rgba(255,240,200,0.35)';
  ctx.beginPath();
  roundRect(ctx, 7, 7, s - 14, s - 14, 9);
  ctx.stroke();
}

function roundRect(ctx: Ctx, x: number, y: number, w: number, h: number, r: number): void {
  ctx.moveTo(x + r, y);
  ctx.arcTo(x + w, y, x + w, y + h, r);
  ctx.arcTo(x + w, y + h, x, y + h, r);
  ctx.arcTo(x, y + h, x, y, r);
  ctx.arcTo(x, y, x + w, y, r);
  ctx.closePath();
}

/** Glyph strokes: a dark outline pass, then the bright pass on top. */
function stroked(ctx: Ctx, path: () => void, color = '#fff5dc', width = 7): void {
  ctx.lineCap = 'round';
  ctx.lineJoin = 'round';
  ctx.strokeStyle = 'rgba(10,8,18,0.85)';
  ctx.lineWidth = width + 6;
  ctx.beginPath();
  path();
  ctx.stroke();
  ctx.strokeStyle = color;
  ctx.lineWidth = width;
  ctx.beginPath();
  path();
  ctx.stroke();
}

function filled(ctx: Ctx, path: () => void, color: string, outline = true): void {
  ctx.lineJoin = 'round';
  if (outline) {
    ctx.strokeStyle = 'rgba(10,8,18,0.85)';
    ctx.lineWidth = 7;
    ctx.beginPath();
    path();
    ctx.stroke();
  }
  ctx.fillStyle = color;
  ctx.beginPath();
  path();
  ctx.fill();
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

function glow(ctx: Ctx, x: number, y: number, r: number, color: string): void {
  const g = ctx.createRadialGradient(x, y, 0, x, y, r);
  g.addColorStop(0, color);
  g.addColorStop(1, 'rgba(255,255,255,0)');
  ctx.fillStyle = g;
  ctx.fillRect(x - r, y - r, r * 2, r * 2);
}

const WHITE = '#fff6e0';
const GOLD = '#ffd75e';

/** One painter per ability, in a 128×128 space. */
const ABILITY_GLYPHS: Record<AbilityId, (ctx: Ctx) => void> = {
  rimeArrow: (ctx) => {
    glow(ctx, 84, 44, 40, 'rgba(180,230,255,0.55)');
    // Shaft bottom-left → top-right, head, fletching, frost spikes.
    stroked(ctx, () => { ctx.moveTo(30, 98); ctx.lineTo(92, 36); }, WHITE, 8);
    filled(ctx, () => poly(ctx, [100, 28, 68, 36, 92, 60]), '#dff4ff');
    stroked(ctx, () => { ctx.moveTo(30, 98); ctx.lineTo(24, 82); ctx.moveTo(30, 98); ctx.lineTo(46, 104); }, '#bfe6ff', 7);
    stroked(ctx, () => {
      ctx.moveTo(52, 76); ctx.lineTo(44, 62); ctx.moveTo(60, 68); ctx.lineTo(74, 76);
      ctx.moveTo(66, 62); ctx.lineTo(58, 48);
    }, '#e8f8ff', 5);
  },
  fireWhirl: (ctx) => {
    glow(ctx, 64, 64, 44, 'rgba(255,200,90,0.6)');
    // Three flame tongues spiraling around the center.
    for (let i = 0; i < 3; i++) {
      const a = (i / 3) * Math.PI * 2;
      filled(ctx, () => {
        ctx.moveTo(64 + Math.cos(a) * 14, 64 + Math.sin(a) * 14);
        ctx.quadraticCurveTo(64 + Math.cos(a + 0.9) * 46, 64 + Math.sin(a + 0.9) * 46, 64 + Math.cos(a + 1.9) * 40, 64 + Math.sin(a + 1.9) * 40);
        ctx.quadraticCurveTo(64 + Math.cos(a + 1.3) * 30, 64 + Math.sin(a + 1.3) * 30, 64 + Math.cos(a + 0.6) * 12, 64 + Math.sin(a + 0.6) * 12);
        ctx.closePath();
      }, i === 1 ? '#ffd166' : '#ff8a3a');
    }
    filled(ctx, () => { ctx.arc(64, 64, 9, 0, Math.PI * 2); }, '#fff2c0');
  },
  earthbreaker: (ctx) => {
    // Boulder fist slamming down; cracks radiating from the impact.
    filled(ctx, () => poly(ctx, [44, 24, 84, 22, 96, 44, 88, 68, 50, 70, 34, 50]), '#c9a06e');
    stroked(ctx, () => { ctx.moveTo(60, 40); ctx.lineTo(70, 52); ctx.moveTo(74, 34); ctx.lineTo(82, 48); }, '#8a5f38', 4);
    stroked(ctx, () => {
      ctx.moveTo(64, 78); ctx.lineTo(48, 90); ctx.lineTo(40, 106);
      ctx.moveTo(64, 78); ctx.lineTo(82, 88); ctx.lineTo(96, 104);
      ctx.moveTo(64, 78); ctx.lineTo(66, 96); ctx.lineTo(60, 112);
      ctx.moveTo(64, 78); ctx.lineTo(30, 84); ctx.moveTo(64, 78); ctx.lineTo(100, 82);
    }, '#ffe6b8', 5);
  },
  holyShield: (ctx) => {
    glow(ctx, 64, 60, 46, 'rgba(255,240,180,0.6)');
    filled(ctx, () => {
      ctx.moveTo(64, 20); ctx.lineTo(100, 34); ctx.quadraticCurveTo(100, 84, 64, 108);
      ctx.quadraticCurveTo(28, 84, 28, 34); ctx.closePath();
    }, '#ffe9a8');
    stroked(ctx, () => { ctx.moveTo(64, 36); ctx.lineTo(64, 92); ctx.moveTo(42, 56); ctx.lineTo(86, 56); }, '#c9931a', 8);
    filled(ctx, () => star(ctx, 64, 56, 10, 4, 4), '#fff8e0', false);
  },
  stormArchon: (ctx) => {
    glow(ctx, 64, 64, 48, 'rgba(120,200,255,0.55)');
    stroked(ctx, () => { ctx.arc(64, 64, 40, 0, Math.PI * 2); }, '#8ecbff', 5);
    filled(ctx, () => poly(ctx, [72, 22, 44, 68, 62, 68, 52, 106, 86, 56, 68, 56]), '#fff066');
  },
  manaSphere: (ctx) => {
    glow(ctx, 64, 64, 52, 'rgba(200,170,255,0.6)');
    filled(ctx, () => { ctx.arc(64, 64, 28, 0, Math.PI * 2); }, '#b48cff');
    glow(ctx, 54, 54, 16, 'rgba(255,255,255,0.8)');
    stroked(ctx, () => { ctx.ellipse(64, 64, 48, 14, -0.5, 0, Math.PI * 2); }, '#e6d6ff', 4);
    stroked(ctx, () => { ctx.ellipse(64, 64, 48, 14, 0.7, 0, Math.PI * 2); }, '#e6d6ff', 4);
  },
  searingAxe: (ctx) => {
    glow(ctx, 44, 52, 40, 'rgba(255,160,60,0.6)');
    stroked(ctx, () => { ctx.moveTo(52, 52); ctx.lineTo(100, 104); }, '#8a5a3a', 10);
    filled(ctx, () => {
      ctx.moveTo(30, 28); ctx.quadraticCurveTo(66, 20, 76, 50); ctx.quadraticCurveTo(66, 64, 40, 78);
      ctx.quadraticCurveTo(22, 58, 30, 28); ctx.closePath();
    }, '#ffb347');
    filled(ctx, () => {
      ctx.moveTo(36, 30); ctx.quadraticCurveTo(46, 14, 52, 30); ctx.quadraticCurveTo(58, 16, 66, 32);
      ctx.quadraticCurveTo(54, 36, 42, 40); ctx.closePath();
    }, '#ffe066', false);
  },
  slicingWinds: (ctx) => {
    for (const [dx, dy] of [[-16, 18], [0, 0], [16, -18]] as const) {
      stroked(ctx, () => {
        ctx.moveTo(30 + dx, 84 + dy); ctx.quadraticCurveTo(60 + dx, 40 + dy, 100 + dx, 46 + dy);
      }, '#e6fff5', 8);
    }
  },
  starBomb: (ctx) => {
    glow(ctx, 64, 50, 46, 'rgba(220,190,255,0.6)');
    filled(ctx, () => star(ctx, 64, 52, 30, 13), '#fff3b0');
    stroked(ctx, () => {
      for (let i = 0; i < 5; i++) {
        const a = Math.PI * (0.15 + (i / 4) * 0.7);
        ctx.moveTo(64 + Math.cos(a) * 34, 96 - Math.sin(a) * 8);
        ctx.lineTo(64 + Math.cos(a) * 50, 108 - Math.sin(a) * 6);
      }
    }, '#d9b8ff', 5);
  },
  toxicSmackerel: (ctx) => {
    glow(ctx, 64, 64, 44, 'rgba(120,240,110,0.5)');
    filled(ctx, () => {
      ctx.ellipse(56, 66, 34, 20, -0.25, 0, Math.PI * 2);
    }, '#7ed957');
    filled(ctx, () => poly(ctx, [86, 60, 112, 42, 108, 70, 114, 92]), '#5cbf3a');
    filled(ctx, () => { ctx.arc(36, 60, 5, 0, Math.PI * 2); }, '#1a2a10', false);
    stroked(ctx, () => { ctx.moveTo(50, 50); ctx.quadraticCurveTo(62, 44, 74, 54); }, '#b6f59a', 4);
    for (const [x, y, r] of [[92, 30, 4], [102, 20, 3], [84, 22, 2.5]] as const) {
      filled(ctx, () => { ctx.arc(x, y, r, 0, Math.PI * 2); }, '#e8ffd8', false);
    }
  },
  celestialBarrage: (ctx) => {
    glow(ctx, 64, 40, 50, 'rgba(200,180,255,0.6)');
    filled(ctx, () => poly(ctx, [40, 16, 88, 16, 72, 110, 56, 110]), '#d7c6ff');
    for (const [x, y, r] of [[64, 34, 9], [58, 62, 6], [68, 86, 5]] as const) {
      filled(ctx, () => star(ctx, x, y, r, r * 0.45, 4), '#ffffff', false);
    }
  },
  quakingLeap: (ctx) => {
    filled(ctx, () => poly(ctx, [64, 16, 94, 52, 76, 52, 76, 80, 52, 80, 52, 52, 34, 52]), '#e6c890');
    stroked(ctx, () => {
      ctx.moveTo(24, 96); ctx.lineTo(40, 100); ctx.lineTo(56, 94); ctx.lineTo(72, 100); ctx.lineTo(88, 94); ctx.lineTo(104, 98);
      ctx.moveTo(44, 102); ctx.lineTo(36, 114); ctx.moveTo(84, 102); ctx.lineTo(94, 114);
    }, '#ffe6b8', 5);
  },
  huntersChains: (ctx) => {
    for (let i = 0; i < 3; i++) {
      const x = 34 + i * 30;
      const y = 92 - i * 28;
      stroked(ctx, () => { ctx.ellipse(x, y, 16, 10, -0.75, 0, Math.PI * 2); }, i % 2 ? '#e8e8f0' : '#b8bcc8', 7);
    }
  },
  steelTraps: (ctx) => {
    // A bear trap seen from above: a steel ring, two rows of teeth meeting
    // at the middle, the trigger plate in the center.
    stroked(ctx, () => { ctx.arc(64, 64, 42, 0, Math.PI * 2); }, '#cfd4de', 8);
    for (let t = 0; t < 6; t++) {
      const x = 30 + t * 13.6;
      filled(ctx, () => poly(ctx, [x, 40, x + 13.6, 40, x + 6.8, 62]), '#f2f4f8');
      filled(ctx, () => poly(ctx, [x, 88, x + 13.6, 88, x + 6.8, 66]), '#f2f4f8');
    }
    stroked(ctx, () => { ctx.moveTo(24, 40); ctx.lineTo(104, 40); ctx.moveTo(24, 88); ctx.lineTo(104, 88); }, '#9aa0ae', 5);
    filled(ctx, () => { ctx.arc(64, 64, 8, 0, Math.PI * 2); }, '#ffb347');
  },
  windstorm: (ctx) => {
    glow(ctx, 64, 60, 46, 'rgba(200,255,235,0.4)');
    for (let i = 0; i < 5; i++) {
      const w = 44 - i * 8;
      stroked(ctx, () => { ctx.ellipse(64 + (i % 2 ? 4 : -4), 30 + i * 17, w, 8, 0, 0, Math.PI * 2); }, '#e0fff4', 5);
    }
  },
  explosiveCaltrops: (ctx) => {
    glow(ctx, 64, 60, 40, 'rgba(255,170,80,0.5)');
    stroked(ctx, () => {
      ctx.moveTo(64, 64); ctx.lineTo(64, 24); ctx.moveTo(64, 64); ctx.lineTo(30, 90);
      ctx.moveTo(64, 64); ctx.lineTo(98, 90); ctx.moveTo(64, 64); ctx.lineTo(80, 104);
    }, '#d8d8e0', 9);
    for (const [x, y] of [[64, 22], [28, 92], [100, 92]] as const) {
      filled(ctx, () => star(ctx, x, y, 8, 3, 4), '#ffd166', false);
    }
  },
  snowdrift: (ctx) => {
    glow(ctx, 64, 64, 48, 'rgba(200,240,255,0.55)');
    stroked(ctx, () => {
      for (let i = 0; i < 6; i++) {
        const a = (i / 6) * Math.PI * 2;
        const c = Math.cos(a);
        const s = Math.sin(a);
        ctx.moveTo(64, 64); ctx.lineTo(64 + c * 42, 64 + s * 42);
        ctx.moveTo(64 + c * 26, 64 + s * 26); ctx.lineTo(64 + Math.cos(a + 0.5) * 36, 64 + Math.sin(a + 0.5) * 36);
        ctx.moveTo(64 + c * 26, 64 + s * 26); ctx.lineTo(64 + Math.cos(a - 0.5) * 36, 64 + Math.sin(a - 0.5) * 36);
      }
    }, '#f0fbff', 5);
  },
  lightningBulwark: (ctx) => {
    filled(ctx, () => {
      ctx.moveTo(64, 18); ctx.lineTo(102, 32); ctx.quadraticCurveTo(102, 84, 64, 110);
      ctx.quadraticCurveTo(26, 84, 26, 32); ctx.closePath();
    }, '#4da6ff');
    filled(ctx, () => poly(ctx, [72, 34, 50, 68, 64, 68, 56, 96, 82, 58, 68, 58]), '#fff066');
  },
  fadeToShadow: (ctx) => {
    glow(ctx, 64, 64, 46, 'rgba(90,60,140,0.7)');
    filled(ctx, () => {
      ctx.arc(64, 64, 36, Math.PI * 0.2, Math.PI * 1.8);
      ctx.arc(80, 64, 30, Math.PI * 1.6, Math.PI * 0.4, true);
      ctx.closePath();
    }, '#8f6ad0');
    for (const x of [58, 74]) {
      filled(ctx, () => { ctx.ellipse(x, 60, 5, 8, 0, 0, Math.PI * 2); }, '#f5e6ff', false);
    }
  },
  repel: (ctx) => {
    glow(ctx, 64, 64, 46, 'rgba(210,180,255,0.6)');
    stroked(ctx, () => { ctx.arc(64, 64, 22, 0, Math.PI * 2); }, '#e6d6ff', 6);
    for (let i = 0; i < 4; i++) {
      const a = (i / 4) * Math.PI * 2 + Math.PI / 4;
      const c = Math.cos(a);
      const s = Math.sin(a);
      stroked(ctx, () => {
        ctx.moveTo(64 + c * 30, 64 + s * 30); ctx.lineTo(64 + c * 50, 64 + s * 50);
        ctx.moveTo(64 + c * 50, 64 + s * 50); ctx.lineTo(64 + Math.cos(a + 0.5) * 40, 64 + Math.sin(a + 0.5) * 40);
        ctx.moveTo(64 + c * 50, 64 + s * 50); ctx.lineTo(64 + Math.cos(a - 0.5) * 40, 64 + Math.sin(a - 0.5) * 40);
      }, '#ffffff', 5);
    }
  },
  faeform: (ctx) => {
    glow(ctx, 64, 60, 46, 'rgba(255,170,230,0.55)');
    // Fox head: ears, muzzle.
    filled(ctx, () => poly(ctx, [30, 30, 50, 52, 78, 52, 98, 30, 100, 62, 64, 102, 28, 62]), '#ffb7e6');
    for (const x of [50, 78]) filled(ctx, () => { ctx.ellipse(x, 66, 4, 6, 0, 0, Math.PI * 2); }, '#3a1a3a', false);
    filled(ctx, () => { ctx.arc(64, 84, 4, 0, Math.PI * 2); }, '#3a1a3a', false);
    for (const [x, y] of [[22, 88], [108, 90], [20, 24]] as const) {
      filled(ctx, () => star(ctx, x, y, 6, 2.5, 4), '#ffffff', false);
    }
  },
};

const ITEM_GLYPHS: Record<ItemId, (ctx: Ctx) => void> = {
  chickenCoup: (ctx) => {
    // A roast drumstick.
    filled(ctx, () => { ctx.ellipse(52, 56, 30, 24, -0.6, 0, Math.PI * 2); }, '#d98b3f');
    stroked(ctx, () => { ctx.moveTo(72, 74); ctx.lineTo(98, 100); }, '#f3e5c8', 10);
    filled(ctx, () => { ctx.arc(102, 104, 8, 0, Math.PI * 2); }, '#f3e5c8');
    glow(ctx, 44, 46, 14, 'rgba(255,230,180,0.6)');
  },
  smokeBomb: (ctx) => {
    filled(ctx, () => { ctx.arc(60, 74, 28, 0, Math.PI * 2); }, '#3a3d4c');
    stroked(ctx, () => { ctx.moveTo(74, 52); ctx.quadraticCurveTo(84, 36, 98, 32); }, '#c9a06e', 5);
    for (const [x, y, r] of [[98, 30, 8], [88, 18, 10], [106, 16, 7]] as const) {
      filled(ctx, () => { ctx.arc(x, y, r, 0, Math.PI * 2); }, '#d8d8e2', false);
    }
    glow(ctx, 50, 64, 12, 'rgba(255,255,255,0.5)');
  },
  mechanoHog: (ctx) => {
    // Spoked wheel with a gear hub and exhaust flame.
    stroked(ctx, () => { ctx.arc(64, 68, 34, 0, Math.PI * 2); }, '#d0d4de', 8);
    stroked(ctx, () => {
      for (let i = 0; i < 6; i++) {
        const a = (i / 6) * Math.PI * 2;
        ctx.moveTo(64, 68); ctx.lineTo(64 + Math.cos(a) * 30, 68 + Math.sin(a) * 30);
      }
    }, '#9aa0ae', 4);
    filled(ctx, () => star(ctx, 64, 68, 13, 9, 8), '#ffb347');
    filled(ctx, () => poly(ctx, [96, 96, 116, 88, 108, 104, 118, 110, 100, 108]), '#ff7a2e', false);
  },
  gravityLauncher: (ctx) => {
    glow(ctx, 64, 64, 46, 'rgba(140,220,255,0.5)');
    stroked(ctx, () => { ctx.arc(64, 70, 30, Math.PI * 0.15, Math.PI * 0.85); }, '#bfe8ff', 7);
    filled(ctx, () => poly(ctx, [64, 22, 88, 50, 72, 50, 72, 78, 56, 78, 56, 50, 40, 50]), '#e8f6ff');
    stroked(ctx, () => { ctx.moveTo(34, 96); ctx.lineTo(94, 96); }, '#8fd0ff', 6);
  },
  toTheSkies: (ctx) => {
    glow(ctx, 64, 40, 40, 'rgba(180,230,255,0.5)');
    filled(ctx, () => {
      ctx.moveTo(64, 14); ctx.quadraticCurveTo(84, 40, 78, 82); ctx.lineTo(50, 82); ctx.quadraticCurveTo(44, 40, 64, 14);
      ctx.closePath();
    }, '#e8f0ff');
    filled(ctx, () => poly(ctx, [50, 70, 34, 92, 52, 86]), '#ff7a2e');
    filled(ctx, () => poly(ctx, [78, 70, 94, 92, 76, 86]), '#ff7a2e');
    filled(ctx, () => { ctx.arc(64, 46, 7, 0, Math.PI * 2); }, '#4da6ff', false);
    filled(ctx, () => poly(ctx, [56, 88, 72, 88, 64, 114]), '#ffd166', false);
  },
};

const BUILTIN_GLYPHS: Record<BuiltinIconId, { core: number; deep: number; draw: (ctx: Ctx) => void }> = {
  slap: {
    core: 0xf0b070, deep: 0x7a3d24,
    draw: (ctx) => {
      // Open palm with five fingers.
      filled(ctx, () => {
        ctx.moveTo(40, 112); ctx.lineTo(36, 66); ctx.lineTo(44, 62); ctx.lineTo(50, 78);
        ctx.lineTo(48, 28); ctx.lineTo(58, 26); ctx.lineTo(62, 68); ctx.lineTo(66, 18); ctx.lineTo(76, 20);
        ctx.lineTo(76, 68); ctx.lineTo(82, 26); ctx.lineTo(92, 30); ctx.lineTo(88, 74); ctx.lineTo(96, 48);
        ctx.lineTo(106, 54); ctx.lineTo(94, 100); ctx.lineTo(84, 112); ctx.closePath();
      }, '#ffd9a8');
      glow(ctx, 66, 84, 22, 'rgba(255,255,255,0.45)');
    },
  },
  heal: {
    core: 0x7ef08a, deep: 0x1d5a2a,
    draw: (ctx) => {
      glow(ctx, 64, 60, 44, 'rgba(180,255,190,0.5)');
      filled(ctx, () => {
        ctx.moveTo(64, 106); ctx.bezierCurveTo(20, 76, 20, 34, 46, 30); ctx.bezierCurveTo(56, 28, 62, 36, 64, 42);
        ctx.bezierCurveTo(66, 36, 72, 28, 82, 30); ctx.bezierCurveTo(108, 34, 108, 76, 64, 106); ctx.closePath();
      }, '#9df0a5');
      stroked(ctx, () => { ctx.moveTo(64, 48); ctx.lineTo(64, 84); ctx.moveTo(46, 66); ctx.lineTo(82, 66); }, '#ffffff', 8);
    },
  },
  roll: {
    core: 0xa8c8ff, deep: 0x2a3a6a,
    draw: (ctx) => {
      stroked(ctx, () => { ctx.arc(64, 64, 32, Math.PI * 0.2, Math.PI * 1.75); }, '#e8f0ff', 9);
      filled(ctx, () => poly(ctx, [96, 26, 104, 60, 74, 48]), '#e8f0ff');
    },
  },
  dive: {
    core: 0xbfe8ff, deep: 0x1f4a6a,
    draw: (ctx) => {
      filled(ctx, () => poly(ctx, [64, 110, 32, 70, 52, 70, 52, 20, 76, 20, 76, 70, 96, 70]), '#e8f6ff');
      stroked(ctx, () => { ctx.moveTo(22, 40); ctx.lineTo(40, 40); ctx.moveTo(88, 40); ctx.lineTo(106, 40); ctx.moveTo(18, 56); ctx.lineTo(34, 56); ctx.moveTo(94, 56); ctx.lineTo(110, 56); }, '#bfe8ff', 4);
    },
  },
};

/** Element background wash: the spell's own colors, darkened toward the rim. */
function elementTile(ctx: Ctx, element: Element): void {
  const p = ELEMENT_PALETTE[element];
  tile(ctx, p.glow, p.deep ?? p.core);
}

function render(kind: IconKind, id: string): HTMLCanvasElement {
  const key = `${kind}:${id}`;
  let canvas = canvases.get(key);
  if (canvas) return canvas;
  canvas = document.createElement('canvas');
  canvas.width = canvas.height = SIZE;
  const ctx = canvas.getContext('2d')!;
  if (kind === 'ability') {
    const draw = ABILITY_GLYPHS[id as AbilityId];
    elementTile(ctx, elementKeyOf(id as AbilityId));
    draw?.(ctx);
  } else if (kind === 'item') {
    const draw = ITEM_GLYPHS[id as ItemId];
    tile(ctx, 0xd9a86a, 0x4a3320);
    draw?.(ctx);
  } else {
    const b = BUILTIN_GLYPHS[id as BuiltinIconId];
    tile(ctx, b?.core ?? 0x888888, b?.deep ?? 0x222222);
    b?.draw(ctx);
  }
  finish(ctx);
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

void GOLD;
