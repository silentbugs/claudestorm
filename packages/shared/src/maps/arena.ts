import { Rng } from '../math/rng.js';

export interface BoxObstacle {
  kind: 'box';
  x: number;
  z: number;
  /** Half-extents. */
  hx: number;
  hz: number;
  height: number;
}

export interface CircleObstacle {
  kind: 'circle';
  x: number;
  z: number;
  r: number;
  height: number;
  /** Renderer hint; the sim only cares about the collision shape. */
  look?: 'tree' | 'rock' | 'cliff';
}

export type Obstacle = BoxObstacle | CircleObstacle;

export interface Point {
  x: number;
  z: number;
}

/** A smooth terrain bump: height h at the center, cosine falloff to 0 at radius r. */
export interface Hill {
  x: number;
  z: number;
  r: number;
  h: number;
}

/** A lake: wading through it slows movement; rendered as water in a terrain bowl. */
export interface LakeDef {
  x: number;
  z: number;
  r: number;
}

/**
 * A sunken pit: easy to drop into, slow to climb out of. Moving outward
 * through the rim band is heavily slowed except within the ramp sector.
 */
export interface PitDef {
  x: number;
  z: number;
  r: number;
  /** Direction (radians, atan2(x, z) convention) of the walk-out ramp. */
  rampAngle: number;
  /** Half-width of the ramp sector where climbing out costs nothing. */
  rampHalfAngle: number;
}

/** The handful of named milestone areas that make the island recognizable. */
export type LandmarkKind = 'wreck' | 'spire' | 'stonering' | 'pit' | 'grove';

export interface LandmarkDef {
  kind: LandmarkKind;
  name: string;
  x: number;
  z: number;
  /** Rough footprint radius (map labels, keep-out). */
  r: number;
}

export interface MapDef {
  /** Square side length; playable area is [-size/2, size/2] on both axes. */
  size: number;
  obstacles: Obstacle[];
  chests: Point[];
  mobs: Point[];
  /** Elite minions: tougher, guard POIs, always drop an ability scroll. */
  elites: Point[];
  /** Loose ability scrolls lying in the world. */
  scrolls: Point[];
  /** Consumable item spawns. */
  items: Point[];
  /** Rolling terrain. Purely cosmetic for combat: entities stand on top of it. */
  hills: Hill[];
  /** Lakes slow anyone wading through them. */
  lakes: LakeDef[];
  /** Sunken areas you must climb (or take the ramp) to leave. */
  pits: PitDef[];
  /** Named milestone areas (rendered distinctively, labeled on the map). */
  landmarks: LandmarkDef[];
}

/**
 * Height of the terrain at a world position: the sum of all hill bumps.
 * Shared by the sim (conceptually flat gameplay) and the renderer (displaced ground).
 */
export function terrainHeight(hills: Hill[], x: number, z: number): number {
  let y = 0;
  for (const hill of hills) {
    const d = Math.hypot(x - hill.x, z - hill.z);
    if (d < hill.r) y += hill.h * 0.5 * (1 + Math.cos((d / hill.r) * Math.PI));
  }
  return y;
}

/**
 * Scatter `count` points across [-half, half]² keeping `minSep` distance from
 * each other and from `existing`. Deterministic for a given Rng; if space runs
 * tight the separation relaxes rather than looping forever.
 */
function scatterPoints(
  rng: Rng,
  count: number,
  minSep: number,
  half: number,
  existing: Point[] = [],
): Point[] {
  const pts: Point[] = [];
  let sep = minSep;
  let attempts = 0;
  while (pts.length < count) {
    if (++attempts > 300) {
      sep *= 0.9;
      attempts = 0;
    }
    const x = rng.range(-half, half);
    const z = rng.range(-half, half);
    if ([...existing, ...pts].every((p) => Math.hypot(p.x - x, p.z - z) >= sep)) {
      pts.push({ x, z });
    }
  }
  return pts;
}

/** Everything a map piece can contribute; landmarks and minor sites stamp into this. */
interface PieceCtx {
  rng: Rng;
  obstacles: Obstacle[];
  chests: Point[];
  mobs: Point[];
  elites: Point[];
  scrolls: Point[];
  items: Point[];
  hills: Hill[];
  pits: PitDef[];
  landmarks: LandmarkDef[];
}

/*
 * Map pieces. Each stamps a self-contained area (terrain, obstacles, loot)
 * around a center point — the pool the map is assembled from today, and the
 * pool a future procedural generator draws from to shuffle the island.
 */

/** Shipwreck Cove: a beached hulk on the east shore, rich pickings around it. */
function stampWreck(ctx: PieceCtx, x: number, z: number): void {
  ctx.landmarks.push({ kind: 'wreck', name: 'Shipwreck Cove', x, z, r: 26 });
  // The hull blocks movement; a couple of rocks scatter the approach.
  ctx.obstacles.push(
    { kind: 'circle', x, z, r: 5.5, height: 9, look: 'rock' },
    { kind: 'circle', x: x - 14, z: z + 9, r: 2.2, height: 3.5, look: 'rock' },
    { kind: 'circle', x: x - 9, z: z - 13, r: 1.8, height: 3, look: 'rock' },
  );
  ctx.chests.push({ x: x - 6, z: z + 5 }, { x: x + 2, z: z - 9 }, { x: x - 13, z: z - 2 });
  ctx.elites.push({ x: x - 8, z: z - 7 });
  ctx.scrolls.push({ x: x - 4, z: z + 10 });
  ctx.items.push({ x: x + 4, z: z + 8 });
}

/** Skyreach Spire: the island's tallest peak, crowned in cliffs with two ways up. */
function stampSpire(ctx: PieceCtx, x: number, z: number): void {
  ctx.landmarks.push({ kind: 'spire', name: 'Skyreach Spire', x, z, r: 30 });
  ctx.hills.push({ x, z, r: 38, h: 17 });
  const segs = 11;
  const gapA = 2;
  const gapB = 7;
  for (let s = 0; s < segs; s++) {
    if (s === gapA || s === gapB) continue; // the two ascents
    const a = (s / segs) * Math.PI * 2;
    ctx.obstacles.push({
      kind: 'circle',
      x: x + Math.sin(a) * 21,
      z: z + Math.cos(a) * 21,
      r: 5.5,
      height: 13,
      look: 'cliff',
    });
  }
  ctx.chests.push({ x, z }, { x: x + 6, z: z - 4 }, { x: x - 5, z: z + 6 });
  ctx.elites.push({ x: x + 3, z: z + 3 });
  ctx.scrolls.push({ x: x - 3, z: z - 5 });
}

/** The Stone Ring: a circle of standing stones on a low mound. */
function stampStoneRing(ctx: PieceCtx, x: number, z: number): void {
  ctx.landmarks.push({ kind: 'stonering', name: 'The Stone Ring', x, z, r: 22 });
  ctx.hills.push({ x, z, r: 26, h: 2.5 });
  const stones = 8;
  for (let s = 0; s < stones; s++) {
    const a = (s / stones) * Math.PI * 2 + 0.2;
    ctx.obstacles.push({
      kind: 'circle',
      x: x + Math.sin(a) * 14,
      z: z + Math.cos(a) * 14,
      r: 1.5,
      height: 7,
      look: 'rock',
    });
  }
  ctx.chests.push({ x, z }, { x: x + 4, z: z + 4 });
  ctx.elites.push({ x: x - 3, z: z + 2 }, { x: x + 5, z: z - 4 });
  ctx.scrolls.push({ x: x - 5, z: z - 3 });
}

/** The Sunken Pit: a deep loot-rich bowl — dropping in is free, leaving is not. */
function stampPit(ctx: PieceCtx, x: number, z: number): void {
  const r = 24;
  ctx.landmarks.push({ kind: 'pit', name: 'The Sunken Pit', x, z, r });
  ctx.pits.push({ x, z, r, rampAngle: ctx.rng.range(0, Math.PI * 2), rampHalfAngle: 0.45 });
  // A steep bowl: most of the drop happens across the rim band.
  ctx.hills.push({ x, z, r: r * 1.6, h: -5 }, { x, z, r: r * 1.05, h: -3.5 });
  // Boulders around the lip warn you before you tumble in.
  for (let s = 0; s < 5; s++) {
    const a = (s / 5) * Math.PI * 2 + 0.7;
    ctx.obstacles.push({
      kind: 'circle',
      x: x + Math.sin(a) * (r + 5),
      z: z + Math.cos(a) * (r + 5),
      r: 1.6,
      height: 2.8,
      look: 'rock',
    });
  }
  ctx.chests.push({ x, z }, { x: x + 6, z: z - 3 }, { x: x - 7, z: z + 4 }, { x: x + 2, z: z + 8 });
  ctx.elites.push({ x: x - 3, z: z - 5 }, { x: x + 5, z: z + 3 });
  ctx.scrolls.push({ x: x - 5, z: z - 1 });
  ctx.items.push({ x: x + 3, z: z - 7 }, { x: x - 2, z: z + 5 });
}

/** Elder Grove: one giant tree ringed by its children. */
function stampGroveLandmark(ctx: PieceCtx, x: number, z: number): void {
  ctx.landmarks.push({ kind: 'grove', name: 'Elder Grove', x, z, r: 24 });
  ctx.hills.push({ x, z, r: 30, h: 3 });
  ctx.obstacles.push({ kind: 'circle', x, z, r: 3.2, height: 13, look: 'tree' });
  for (let s = 0; s < 5; s++) {
    const a = (s / 5) * Math.PI * 2 + 0.5;
    ctx.obstacles.push({
      kind: 'circle',
      x: x + Math.sin(a) * 15,
      z: z + Math.cos(a) * 15,
      r: 1.9,
      height: 8,
      look: 'tree',
    });
  }
  ctx.chests.push({ x: x + 5, z: z + 2 }, { x: x - 4, z: z - 6 });
  ctx.elites.push({ x: x + 2, z: z - 4 });
  ctx.scrolls.push({ x: x - 6, z: z + 4 }, { x: x + 7, z: z - 2 });
}

/** Minor filler site: a small stand of trees with loot tucked inside. */
function stampCopse(ctx: PieceCtx, x: number, z: number, s: number): void {
  ctx.obstacles.push(
    { kind: 'circle', x: x - 6 * s, z: z - 4, r: 2.1, height: 7, look: 'tree' },
    { kind: 'circle', x: x + 7 * s, z: z + 6, r: 1.6, height: 6, look: 'tree' },
    { kind: 'circle', x: x + 1 * s, z: z + 11, r: 1.4, height: 5.5, look: 'tree' },
    { kind: 'circle', x: x - 10 * s, z: z + 5, r: 1.8, height: 6.5, look: 'tree' },
  );
}

/** Minor filler site: a boulder field. */
function stampBoulders(ctx: PieceCtx, x: number, z: number, s: number): void {
  ctx.obstacles.push(
    { kind: 'circle', x: x - 5 * s, z: z - 4, r: 2.4, height: 4.5, look: 'rock' },
    { kind: 'circle', x: x + 4 * s, z: z + 5, r: 1.9, height: 3.6, look: 'rock' },
    { kind: 'circle', x: x - 1 * s, z: z + 9, r: 1.5, height: 2.8, look: 'rock' },
  );
}

/**
 * 760×760 island with real geography and a handful of named landmarks.
 * Mountain ridges (impassable cliff walls over tall massifs) are broken by
 * deliberate gaps — passageways that funnel fights. Lowland basins dip below
 * the plain, five of them holding lakes that slow anyone wading through.
 * Five milestone areas (Shipwreck Cove, Skyreach Spire, The Stone Ring, The
 * Sunken Pit, Elder Grove) anchor navigation, with minor copses and boulder
 * fields filling the space between. Built from a fixed-seed Rng, so the
 * layout is identical every match — the pieces are stamped through the same
 * functions a future procedural generator will shuffle.
 */
function buildArena(): MapDef {
  const rng = new Rng(0x15_1a_9d); // island seed — change for a new layout
  const ctx: PieceCtx = {
    rng,
    obstacles: [],
    chests: [],
    mobs: [],
    elites: [],
    scrolls: [],
    items: [],
    hills: [],
    pits: [],
    landmarks: [],
  };
  const { obstacles, chests, mobs, elites, scrolls, items, hills } = ctx;
  const lakes: LakeDef[] = [];
  /** Anchors that POIs, cover, and loot must keep clear of. */
  const keepOut: Point[] = [];

  // ── Mountain ridges: cliff-wall segments over tall massifs, with gaps ──
  const ridges = scatterPoints(rng, 6, 170, 300);
  for (const ridge of ridges) {
    const angle = rng.range(0, Math.PI);
    const len = rng.range(75, 115);
    const dirX = Math.cos(angle);
    const dirZ = Math.sin(angle);
    // The massif the wall rides on.
    for (const t of [-0.28, 0.05, 0.32]) {
      hills.push({
        x: ridge.x + dirX * t * len,
        z: ridge.z + dirZ * t * len,
        r: rng.range(30, 44),
        h: rng.range(8, 14),
      });
    }
    const segs = Math.round(len / 9);
    const gapAt = rng.int(2, segs - 3); // the pass through this ridge
    const secondGap = rng.next() < 0.4 ? rng.int(2, segs - 3) : -10;
    for (let s = 0; s <= segs; s++) {
      if (Math.abs(s - gapAt) <= 1 || Math.abs(s - secondGap) <= 1) continue; // passageway
      const t = s / segs - 0.5;
      const x = ridge.x + dirX * t * len + rng.range(-2, 2);
      const z = ridge.z + dirZ * t * len + rng.range(-2, 2);
      obstacles.push({ kind: 'circle', x, z, r: rng.range(5, 7.5), height: rng.range(12, 17), look: 'cliff' });
      keepOut.push({ x, z });
    }
  }

  // ── Lowland basins; the first five hold lakes ──
  const basins = scatterPoints(rng, 7, 130, 310, keepOut);
  basins.forEach((b, i) => {
    hills.push({ x: b.x, z: b.z, r: rng.range(36, 52), h: rng.range(-1.6, -1.0) });
    if (i < 5) {
      const r = rng.range(13, 20);
      lakes.push({ x: b.x, z: b.z, r });
      hills.push({ x: b.x, z: b.z, r: r * 2.1, h: -0.9 }); // deepen the bowl
      keepOut.push(b);
    }
  });

  // ── Landmarks: the wreck hugs the east shore, the rest spread inland ──
  const inland = scatterPoints(rng, 4, 180, 250, keepOut);
  stampWreck(ctx, 330, rng.range(-160, 160));
  stampSpire(ctx, inland[0]!.x, inland[0]!.z);
  stampStoneRing(ctx, inland[1]!.x, inland[1]!.z);
  stampPit(ctx, inland[2]!.x, inland[2]!.z);
  stampGroveLandmark(ctx, inland[3]!.x, inland[3]!.z);
  const landmarkAnchors = ctx.landmarks.map((l) => ({ x: l.x, z: l.z }));
  keepOut.push(...landmarkAnchors);

  // Rolling hills across the rest of the island.
  for (const p of scatterPoints(rng, 40, 44, 330, keepOut)) {
    hills.push({ x: p.x, z: p.z, r: rng.range(24, 42), h: rng.range(2.5, 7) });
  }

  // ── Minor sites: copses and boulder fields with loot tucked inside ──
  const sites = scatterPoints(rng, 20, 65, 330, keepOut);
  sites.forEach((site, i) => {
    const { x: px, z: pz } = site;
    const s = i % 2 === 0 ? 1 : -1;
    if (i % 2 === 0) stampCopse(ctx, px, pz, s);
    else stampBoulders(ctx, px, pz, s);
    chests.push({ x: px, z: pz }, { x: px + 5 * s, z: pz + 4 });
    if (i % 3 !== 2) elites.push({ x: px + 2 * s, z: pz + 8 });
    mobs.push({ x: px + 11 * s, z: pz - 8 });
    if (i % 3 === 0) mobs.push({ x: px - 10 * s, z: pz + 10 });
    if (i % 3 !== 0) scrolls.push({ x: px - 2 * s, z: pz + 2 });
    if (i % 2 === 1) items.push({ x: px + 3 * s, z: pz - 5 });
  });

  // ── Field cover between the sites (kept clear of them and the geography) ──
  const cover = scatterPoints(rng, 104, 16, 352, [...sites, ...keepOut]);
  cover.forEach((p, i) => {
    if (i % 3 === 0) {
      obstacles.push({ kind: 'circle', x: p.x, z: p.z, r: 2 + (i % 3) * 0.3, height: 3.4, look: 'rock' });
    } else {
      obstacles.push({ kind: 'circle', x: p.x, z: p.z, r: 1.5 + (i % 4) * 0.25, height: 5 + (i % 3), look: 'tree' });
    }
  });

  // ── Loose pickings and roaming packs for the space between sites ──
  const avoid = [...sites, ...keepOut];
  for (const p of scatterPoints(rng, 44, 28, 340, avoid)) chests.push(p);
  for (const p of scatterPoints(rng, 52, 22, 348, avoid)) mobs.push(p);
  for (const p of scatterPoints(rng, 26, 32, 336, avoid)) scrolls.push(p);
  for (const p of scatterPoints(rng, 24, 30, 340, avoid)) items.push(p);

  return {
    size: 760,
    obstacles,
    chests,
    mobs,
    elites,
    scrolls,
    items,
    hills,
    lakes,
    pits: ctx.pits,
    landmarks: ctx.landmarks,
  };
}

export const ARENA: MapDef = buildArena();
