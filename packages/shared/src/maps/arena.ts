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
  /**
   * Renderer hint; the sim only cares about the collision shape. 'none'
   * marks collision-only footprints under landmark dressing (the watchtower,
   * the wreck's hull) that the renderer must not decorate again.
   */
  look?: 'tree' | 'rock' | 'cliff' | 'none';
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
export type LandmarkKind =
  | 'wreck'
  | 'spire'
  | 'stonering'
  | 'pit'
  | 'grove'
  | 'ravine'
  | 'hamlet'
  | 'barrow'
  | 'passage';

export interface LandmarkDef {
  kind: LandmarkKind;
  name: string;
  x: number;
  z: number;
  /** Rough footprint radius (map labels, keep-out). */
  r: number;
}

export interface MapDef {
  /** Square side length; the world (and sea) spans [-size/2, size/2]. */
  size: number;
  /**
   * Base radius of the island's irregular coastline (see coastRadius).
   * When set, movement clamps to the coast instead of the square bounds.
   */
  coastR?: number;
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
 * Where the island meets the sea in a given direction (angle in the sim's
 * atan2(x, z) convention): the base radius modulated by fixed sine bands —
 * bays and headlands instead of a square slab.
 */
export function coastRadius(base: number, angle: number): number {
  return (
    base *
    (1 +
      0.08 * Math.sin(angle * 3 + 1.7) +
      0.055 * Math.sin(angle * 5 - 0.8) +
      0.028 * Math.sin(angle * 9 + 3.1))
  );
}

/**
 * Render/placement ground height: the hills, flattening into a beach at the
 * coastline and diving under the sea beyond it. The sim itself stays flat —
 * players simply can't cross the coast (see resolveCollisions).
 */
export function groundHeight(map: MapDef, x: number, z: number): number {
  let h = terrainHeight(map.hills, x, z);
  if (map.coastR) {
    const over = Math.hypot(x, z) - coastRadius(map.coastR, Math.atan2(x, z));
    if (over > -16) {
      const fade = Math.min(1, Math.max(0, (over + 16) / 16));
      h *= 1 - fade; // hills flatten toward the waterline
      const dive = Math.min(1, Math.max(0, over / 12));
      h -= dive * dive * 5; // then the seabed drops away
    }
  }
  return h;
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
  valid?: (x: number, z: number) => boolean,
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
    if (valid && !valid(x, z)) continue;
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
  // The hull itself blocks movement (two footprints along the ship's axis,
  // matching the renderer's -0.5 facing); rocks scatter the approach.
  const hx = Math.sin(-0.5);
  const hz = Math.cos(-0.5);
  ctx.obstacles.push(
    { kind: 'circle', x: x + hx * 5, z: z + hz * 5, r: 4.5, height: 9, look: 'none' },
    { kind: 'circle', x: x - hx * 5, z: z - hz * 5, r: 4.5, height: 9, look: 'none' },
    { kind: 'circle', x: x - 14, z: z + 9, r: 2.2, height: 3.5, look: 'rock' },
    { kind: 'circle', x: x - 9, z: z - 13, r: 1.8, height: 3, look: 'rock' },
  );
  ctx.chests.push({ x: x - 6, z: z + 5 }, { x: x + 2, z: z - 9 }, { x: x - 13, z: z - 2 });
  ctx.elites.push({ x: x - 8, z: z - 7 });
  ctx.scrolls.push({ x: x - 4, z: z + 10 });
  ctx.items.push({ x: x + 4, z: z + 8 });
}

/** Skyreach Spire: the island's tallest peak, with a watchtower on the summit. */
function stampSpire(ctx: PieceCtx, x: number, z: number): void {
  ctx.landmarks.push({ kind: 'spire', name: 'Skyreach Spire', x, z, r: 30 });
  ctx.hills.push({ x, z, r: 38, h: 17 });
  // The watchtower's footing is solid.
  ctx.obstacles.push({ kind: 'circle', x, z, r: 2.4, height: 9, look: 'none' });
  ctx.chests.push({ x: x + 4, z: z + 2 }, { x: x + 6, z: z - 4 }, { x: x - 5, z: z + 6 });
  ctx.elites.push({ x: x + 3, z: z + 5 });
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

/**
 * The Undercroft: a deep sunken ravine — the island's underground. Rock
 * walls line both rims; the only comfortable ways in are the two open ends,
 * and the loot-rich floor sits ~8m below the plain, out of sight.
 */
function stampRavine(ctx: PieceCtx, x: number, z: number): void {
  ctx.landmarks.push({ kind: 'ravine', name: 'The Undercroft', x, z, r: 34 });
  const angle = ctx.rng.range(0, Math.PI);
  const dirX = Math.sin(angle);
  const dirZ = Math.cos(angle);
  // The trench: overlapping deep bowls along the axis.
  for (const t of [-24, -8, 8, 24]) {
    ctx.hills.push({ x: x + dirX * t, z: z + dirZ * t, r: 22, h: -6.5 });
  }
  // Rock walls along both rims; the ends stay open as entrances.
  const px = dirZ;
  const pz = -dirX;
  for (const t of [-21, -10.5, 0, 10.5, 21]) {
    for (const side of [-1, 1]) {
      ctx.obstacles.push({
        kind: 'circle',
        x: x + dirX * t + px * side * 13,
        z: z + dirZ * t + pz * side * 13,
        r: ctx.rng.range(2.4, 3.2),
        height: ctx.rng.range(6, 9),
        look: 'rock',
      });
    }
  }
  ctx.chests.push({ x, z }, { x: x + dirX * 12, z: z + dirZ * 12 }, { x: x - dirX * 12, z: z - dirZ * 12 });
  ctx.elites.push({ x: x + dirX * 5, z: z + dirZ * 5 }, { x: x - dirX * 6, z: z - dirZ * 6 });
  ctx.scrolls.push({ x: x + px * 4, z: z + pz * 4 });
  ctx.items.push({ x: x - px * 4, z: z - pz * 4 });
}

/** One roofless ruined house: walls with a doorway and collapsed gaps. */
function ruinedHouse(ctx: PieceCtx, cx: number, cz: number, w: number, d: number): void {
  const h = (): number => ctx.rng.range(2.2, 3.6);
  ctx.obstacles.push(
    { kind: 'box', x: cx, z: cz + d, hx: w, hz: 0.7, height: h() },
    // South wall split by the doorway.
    { kind: 'box', x: cx - w * 0.55, z: cz - d, hx: w * 0.45, hz: 0.7, height: h() },
    { kind: 'box', x: cx + w * 0.65, z: cz - d, hx: w * 0.35, hz: 0.7, height: h() },
    // Side walls partially collapsed.
    { kind: 'box', x: cx - w, z: cz + d * 0.25, hx: 0.7, hz: d * 0.7, height: h() },
    { kind: 'box', x: cx + w, z: cz - d * 0.2, hx: 0.7, hz: d * 0.55, height: h() },
  );
}

/** Fallen Hamlet: ruined stone buildings around a plaza — juking country. */
function stampHamlet(ctx: PieceCtx, x: number, z: number): void {
  ctx.landmarks.push({ kind: 'hamlet', name: 'Fallen Hamlet', x, z, r: 30 });
  ruinedHouse(ctx, x - 14, z - 8, 5, 4);
  ruinedHouse(ctx, x + 12, z - 13, 4, 5);
  ruinedHouse(ctx, x + 11, z + 12, 6, 4);
  ruinedHouse(ctx, x - 12, z + 14, 4, 3.5);
  // Rubble in the plaza.
  ctx.obstacles.push(
    { kind: 'box', x: x + 1, z: z - 1, hx: 1.5, hz: 1.1, height: 1.4 },
    { kind: 'circle', x: x - 5, z: z + 3, r: 1.3, height: 2.2, look: 'rock' },
  );
  ctx.chests.push({ x: x - 14, z: z - 8 }, { x: x + 12, z: z - 13 }, { x: x + 11, z: z + 12 }, { x: x - 12, z: z + 14 });
  ctx.elites.push({ x: x + 3, z: z + 3 }, { x: x - 4, z: z - 5 });
  ctx.scrolls.push({ x: x + 5, z: z - 4 }, { x: x - 2, z: z + 6 });
  ctx.items.push({ x, z: z - 3 });
  ctx.mobs.push({ x: x + 18, z: z + 4 });
}

/** The Barrow: a burial mound crowned with standing stones. */
function stampBarrow(ctx: PieceCtx, x: number, z: number): void {
  ctx.landmarks.push({ kind: 'barrow', name: 'The Barrow', x, z, r: 26 });
  ctx.hills.push({ x, z, r: 30, h: 6 });
  for (let s = 0; s < 6; s++) {
    const a = (s / 6) * Math.PI * 2 + 0.4;
    ctx.obstacles.push({
      kind: 'circle',
      x: x + Math.sin(a) * 9,
      z: z + Math.cos(a) * 9,
      r: 1.3,
      height: 5,
      look: 'rock',
    });
  }
  ctx.chests.push({ x, z }, { x: x + 4, z: z - 3 });
  ctx.elites.push({ x: x - 3, z: z + 3 });
  ctx.scrolls.push({ x: x + 3, z: z + 4 });
}

/**
 * Smugglers' Passage: a deep, rock-walled trench running underground between
 * two areas — enter at either end, cross out of sight, come up on the other
 * side. A little loot rewards taking the low road.
 */
function stampPassage(ctx: PieceCtx, ax: number, az: number, bx: number, bz: number): void {
  const dx = bx - ax;
  const dz = bz - az;
  const len = Math.hypot(dx, dz);
  const ux = dx / len;
  const uz = dz / len;
  const start = 32;
  const end = len - 32;
  const midX = ax + ux * (len / 2);
  const midZ = az + uz * (len / 2);
  ctx.landmarks.push({ kind: 'passage', name: "Smugglers' Passage", x: midX, z: midZ, r: 20 });
  for (let t = start; t <= end; t += 12) {
    ctx.hills.push({ x: ax + ux * t, z: az + uz * t, r: 17, h: -7 });
  }
  const px = uz;
  const pz = -ux;
  for (let t = start + 5; t <= end - 5; t += 9) {
    for (const side of [-1, 1]) {
      ctx.obstacles.push({
        kind: 'circle',
        x: ax + ux * t + px * side * 10.5,
        z: az + uz * t + pz * side * 10.5,
        r: ctx.rng.range(2, 2.8),
        height: ctx.rng.range(5, 8),
        look: 'rock',
      });
    }
  }
  ctx.chests.push({ x: midX, z: midZ });
  ctx.scrolls.push({ x: midX + px * 3, z: midZ + pz * 3 });
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
 * Mountain ridges are chains of tall massifs — open, climbable high ground.
 * Lowland basins dip below the plain, five of them holding lakes that slow
 * anyone wading through.
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

  // The irregular coastline everything must stay inside of.
  const COAST = 356;
  const inland =
    (margin: number) =>
    (x: number, z: number): boolean =>
      Math.hypot(x, z) < coastRadius(COAST, Math.atan2(x, z)) - margin;

  // ── Mountain ridges: chains of tall massifs — open high ground, no walls ──
  const ridges = scatterPoints(rng, 7, 170, 335, [], inland(45));
  for (const ridge of ridges) {
    const angle = rng.range(0, Math.PI);
    const len = rng.range(75, 115);
    const dirX = Math.cos(angle);
    const dirZ = Math.sin(angle);
    for (const t of [-0.28, 0.05, 0.32]) {
      hills.push({
        x: ridge.x + dirX * t * len,
        z: ridge.z + dirZ * t * len,
        r: rng.range(30, 44),
        h: rng.range(8, 14),
      });
    }
    // Keep sites and loot off the crests.
    const segs = Math.round(len / 9);
    for (let s = 0; s <= segs; s++) {
      const t = s / segs - 0.5;
      keepOut.push({ x: ridge.x + dirX * t * len, z: ridge.z + dirZ * t * len });
    }
  }

  // ── Lowland basins; the first five hold lakes ──
  const basins = scatterPoints(rng, 8, 130, 345, keepOut, inland(48));
  basins.forEach((b, i) => {
    hills.push({ x: b.x, z: b.z, r: rng.range(36, 52), h: rng.range(-1.6, -1.0) });
    if (i < 5) {
      const r = rng.range(13, 20);
      lakes.push({ x: b.x, z: b.z, r });
      // Deep enough that a wader is chest-under and the camera can submerge.
      hills.push({ x: b.x, z: b.z, r: r * 2.1, h: -1.5 });
      keepOut.push(b);
    }
  });

  // ── Landmarks: the wreck sits right on the east coast, the rest inland ──
  const spots = scatterPoints(rng, 6, 165, 285, keepOut, inland(62));
  const wreckAngle = rng.range(1.2, 1.9); // roughly east, atan2(x, z) convention
  const wreckR = coastRadius(COAST, wreckAngle) - 22;
  stampWreck(ctx, Math.sin(wreckAngle) * wreckR, Math.cos(wreckAngle) * wreckR);
  stampSpire(ctx, spots[0]!.x, spots[0]!.z);
  stampStoneRing(ctx, spots[1]!.x, spots[1]!.z);
  stampPit(ctx, spots[2]!.x, spots[2]!.z);
  stampGroveLandmark(ctx, spots[3]!.x, spots[3]!.z);
  stampRavine(ctx, spots[4]!.x, spots[4]!.z);
  // The hamlet and its barrow sit ~150m apart, joined by the underground
  // passage — a matched pair you can cross between out of sight.
  const hamlet = spots[5]!;
  stampHamlet(ctx, hamlet.x, hamlet.z);
  let barrow = { x: hamlet.x + 150, z: hamlet.z };
  for (let k = 0; k < 8; k++) {
    const a = rng.range(0, Math.PI * 2) + (k * Math.PI) / 4;
    const candidate = { x: hamlet.x + Math.sin(a) * 150, z: hamlet.z + Math.cos(a) * 150 };
    if (
      inland(60)(candidate.x, candidate.z) &&
      keepOut.every((p) => Math.hypot(p.x - candidate.x, p.z - candidate.z) > 60)
    ) {
      barrow = candidate;
      break;
    }
  }
  stampBarrow(ctx, barrow.x, barrow.z);
  stampPassage(ctx, hamlet.x, hamlet.z, barrow.x, barrow.z);
  const landmarkAnchors = ctx.landmarks.map((l) => ({ x: l.x, z: l.z }));
  keepOut.push(...landmarkAnchors);

  // Rolling hills across the rest of the island.
  for (const p of scatterPoints(rng, 46, 44, 365, keepOut, inland(28))) {
    hills.push({ x: p.x, z: p.z, r: rng.range(24, 42), h: rng.range(2.5, 7) });
  }

  // ── Minor sites: copses and boulder fields with loot tucked inside ──
  const sites = scatterPoints(rng, 24, 65, 365, keepOut, inland(30));
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
  const cover = scatterPoints(rng, 120, 16, 390, [...sites, ...keepOut], inland(16));
  cover.forEach((p, i) => {
    if (i % 3 === 0) {
      obstacles.push({ kind: 'circle', x: p.x, z: p.z, r: 2 + (i % 3) * 0.3, height: 3.4, look: 'rock' });
    } else {
      obstacles.push({ kind: 'circle', x: p.x, z: p.z, r: 1.5 + (i % 4) * 0.25, height: 5 + (i % 3), look: 'tree' });
    }
  });

  // ── Loose pickings and roaming packs for the space between sites ──
  const avoid = [...sites, ...keepOut];
  for (const p of scatterPoints(rng, 50, 28, 375, avoid, inland(18))) chests.push(p);
  for (const p of scatterPoints(rng, 60, 22, 385, avoid, inland(18))) mobs.push(p);
  for (const p of scatterPoints(rng, 30, 32, 370, avoid, inland(18))) scrolls.push(p);
  for (const p of scatterPoints(rng, 28, 30, 375, avoid, inland(18))) items.push(p);

  // ── Nudge every static pickup out of anything it spawned inside ──
  // A chest inside a tree trunk helps no one.
  const clearLoot = (pts: Point[]): void => {
    for (const p of pts) {
      for (let pass = 0; pass < 3; pass++) {
        let moved = false;
        for (const ob of obstacles) {
          const dx = p.x - ob.x;
          const dz = p.z - ob.z;
          if (ob.kind === 'circle') {
            const clearance = ob.r + 1.4;
            const d = Math.hypot(dx, dz);
            if (d >= clearance) continue;
            if (d > 1e-6) {
              p.x = ob.x + (dx / d) * clearance;
              p.z = ob.z + (dz / d) * clearance;
            } else {
              p.x = ob.x + clearance;
            }
            moved = true;
          } else {
            // Boxes (ruin walls): push out along the shallower axis.
            const overX = ob.hx + 1.2 - Math.abs(dx);
            const overZ = ob.hz + 1.2 - Math.abs(dz);
            if (overX <= 0 || overZ <= 0) continue;
            if (overX < overZ) p.x = ob.x + Math.sign(dx || 1) * (ob.hx + 1.2);
            else p.z = ob.z + Math.sign(dz || 1) * (ob.hz + 1.2);
            moved = true;
          }
        }
        if (!moved) break;
      }
    }
  };
  clearLoot(chests);
  clearLoot(scrolls);
  clearLoot(items);
  clearLoot(elites);

  return {
    size: 840,
    coastR: COAST,
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
