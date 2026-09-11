import { Rng } from '../math/rng.js';

export interface BoxObstacle {
  kind: 'box';
  x: number;
  z: number;
  /** Half-extents. */
  hx: number;
  hz: number;
  height: number;
  /**
   * Renderer hint; the sim only cares about the collision box. Masonry by
   * default; 'wood' for palisades; 'house' and 'barn' are roofed buildings
   * the renderer swaps a model in for; 'none' is a footprint under landmark
   * dressing that the renderer must not draw again.
   */
  look?: 'stone' | 'wood' | 'house' | 'barn' | 'none';
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
  look?: 'tree' | 'rock' | 'cliff' | 'tower' | 'citadel' | 'hut' | 'totem' | 'pillar' | 'hall' | 'none';
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
  | 'cove'
  | 'keep'
  | 'wall'
  | 'fort'
  | 'farm'
  | 'manor'
  | 'village'
  | 'bridge'
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
 * Lake water geometry, shared by the sim (wading), the renderer (the water
 * disc), the map paint, and the camera's underwater check — one source of
 * truth so "the camera is below the surface" means the same thing everywhere.
 * The waterline sits where the surface meets the bowl's slope.
 */
export const LAKE_SURFACE_FRACTION = 0.25;
export const LAKE_WATERLINE_FACTOR = 1.45;

/** World-space height of a lake's water surface. */
export function lakeSurfaceY(map: MapDef, lake: LakeDef): number {
  return groundHeight(map, lake.x, lake.z) * LAKE_SURFACE_FRACTION;
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
 * around a center point. The island is Arathi Highlands as Plunderstorm
 * plays it: Stromgarde Keep on its hill by the western sea, Thoradin's Wall
 * along the coast, Hammerfall's palisade in the east, Faldir's Cove, the
 * four Circles of Binding, farms, a manor, a troll village, and the stub of
 * Thandol Span reaching north into the water.
 */

/** Faldir's Cove: pirates' landing on the southwest shore — the beached hulk, a camp, rich pickings. */
function stampCove(ctx: PieceCtx, x: number, z: number): void {
  ctx.landmarks.push({ kind: 'cove', name: "Faldir's Cove", x, z, r: 28 });
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
  ctx.mobs.push({ x: x + 12, z: z + 4 });
}

/** A gate in a wall: a gap flanked by two pillars, so the arch the renderer draws matches the passage. */
function gate(ctx: PieceCtx, x: number, z: number, alongX: boolean, height: number, look: BoxObstacle['look']): void {
  for (const side of [-1, 1]) {
    ctx.obstacles.push(
      alongX
        ? { kind: 'box', x: x + side * 1.7, z, hx: 0.5, hz: 1.0, height, look }
        : { kind: 'box', x, z: z + side * 1.7, hx: 1.0, hz: 0.5, height, look },
    );
  }
}

/**
 * Stromgarde Keep: the ruined city on its hill above the western sea. A
 * walled compound with corner towers, a citadel, gates east and south, and
 * the broken houses of the old town inside — the richest ground on the map.
 */
function stampKeep(ctx: PieceCtx, x: number, z: number): void {
  ctx.landmarks.push({ kind: 'keep', name: 'Stromgarde Keep', x, z, r: 46 });
  ctx.hills.push({ x, z, r: 95, h: 5 });
  const W = 30;
  const D = 26;
  const wallH = 7;
  const t = 1.3;
  // North and west walls run whole; the east and south walls open at gates.
  ctx.obstacles.push(
    { kind: 'box', x, z: z + D, hx: W, hz: t, height: wallH },
    { kind: 'box', x: x + W, z, hx: t, hz: D, height: wallH },
    { kind: 'box', x: x - W, z: z + D / 2 + 1.5, hx: t, hz: D / 2 - 1.5, height: wallH },
    { kind: 'box', x: x - W, z: z - D / 2 - 1.5, hx: t, hz: D / 2 - 1.5, height: wallH },
    { kind: 'box', x: x + W / 2 + 1.5, z: z - D, hx: W / 2 - 1.5, hz: t, height: wallH },
    { kind: 'box', x: x - W / 2 - 1.5, z: z - D, hx: W / 2 - 1.5, hz: t, height: wallH },
  );
  gate(ctx, x - W, z, false, wallH, 'none');
  gate(ctx, x, z - D, true, wallH, 'none');
  for (const [sx, sz] of [[1, 1], [-1, 1], [1, -1], [-1, -1]] as const) {
    ctx.obstacles.push({ kind: 'circle', x: x + sx * W, z: z + sz * D, r: 2.6, height: 11, look: 'tower' });
  }
  ctx.obstacles.push({ kind: 'circle', x: x + 9, z: z + 8, r: 3.4, height: 16, look: 'citadel' });
  // The old town: roofless houses around a plaza, rubble in the streets.
  ruinedHouse(ctx, x - 14, z - 9, 4, 3);
  ruinedHouse(ctx, x + 15, z - 12, 4, 3);
  ruinedHouse(ctx, x - 15, z + 13, 3.5, 3);
  ruinedHouse(ctx, x + 18, z + 14, 3.5, 2.8);
  ctx.obstacles.push(
    { kind: 'box', x: x - 2, z: z - 20, hx: 1.6, hz: 1.1, height: 1.3 },
    { kind: 'box', x: x + 4, z: z + 1, hx: 1.2, hz: 1.2, height: 1.1 },
  );
  ctx.chests.push(
    { x: x - 14, z: z - 9 }, { x: x + 15, z: z - 12 }, { x: x - 15, z: z + 13 }, { x: x + 18, z: z + 14 },
    { x: x - 2, z: z + 6 }, { x: x + 6, z: z - 5 },
  );
  ctx.elites.push({ x: x - 4, z: z - 3 }, { x: x + 10, z: z + 2 }, { x: x - 8, z: z + 8 });
  ctx.scrolls.push({ x: x + 2, z: z - 14 }, { x: x - 22, z: z + 2 });
  ctx.items.push({ x: x + 22, z: z + 4 }, { x: x - 6, z: z - 16 });
}

/** Thoradin's Wall: the old dwarven wall running north–south along the western coast, towers and gates along its length. */
function stampWall(ctx: PieceCtx, x: number, z0: number, z1: number): void {
  const len = z1 - z0;
  ctx.landmarks.push({ kind: 'wall', name: "Thoradin's Wall", x, z: (z0 + z1) / 2, r: 22 });
  const seg = 14;
  const n = Math.max(3, Math.round(len / seg));
  const gaps = new Set([Math.floor(n / 3), Math.floor((2 * n) / 3)]);
  for (let i = 0; i < n; i++) {
    const zc = z0 + (i + 0.5) * (len / n);
    if (gaps.has(i)) {
      gate(ctx, x, zc, false, 8, 'none');
      ctx.chests.push({ x: x + 5, z: zc });
      continue;
    }
    if (i % 3 === 0 || i === n - 1) {
      ctx.obstacles.push({ kind: 'circle', x, z: zc, r: 2.6, height: 11, look: 'tower' });
    } else {
      ctx.obstacles.push({ kind: 'box', x, z: zc, hx: 1.5, hz: len / n / 2, height: 8 });
    }
  }
  ctx.elites.push({ x: x - 6, z: (z0 + z1) / 2 });
  ctx.scrolls.push({ x: x + 6, z: z0 + len * 0.2 });
  ctx.mobs.push({ x: x - 8, z: z0 + len * 0.8 });
}

/** Hammerfall: the Horde's palisade fort on the eastern plain — a great hall, huts, a watch post. */
function stampFort(ctx: PieceCtx, x: number, z: number): void {
  ctx.landmarks.push({ kind: 'fort', name: 'Hammerfall', x, z, r: 32 });
  ctx.hills.push({ x, z, r: 42, h: 2 });
  const W = 22;
  const D = 20;
  const h = 4.5;
  ctx.obstacles.push(
    { kind: 'box', x, z: z + D, hx: W, hz: 0.7, height: h, look: 'wood' },
    { kind: 'box', x: x - W, z, hx: 0.7, hz: D, height: h, look: 'wood' },
    { kind: 'box', x: x + W, z: z + D / 2 + 1.5, hx: 0.7, hz: D / 2 - 1.5, height: h, look: 'wood' },
    { kind: 'box', x: x + W, z: z - D / 2 - 1.5, hx: 0.7, hz: D / 2 - 1.5, height: h, look: 'wood' },
    { kind: 'box', x: x + W / 2 + 1.5, z: z - D, hx: W / 2 - 1.5, hz: 0.7, height: h, look: 'wood' },
    { kind: 'box', x: x - W / 2 - 1.5, z: z - D, hx: W / 2 - 1.5, hz: 0.7, height: h, look: 'wood' },
  );
  gate(ctx, x + W, z, false, h, 'wood');
  gate(ctx, x, z - D, true, h, 'wood');
  for (const [sx, sz] of [[1, 1], [-1, 1], [1, -1], [-1, -1]] as const) {
    ctx.obstacles.push({ kind: 'circle', x: x + sx * W, z: z + sz * D, r: 1.4, height: 7, look: 'tower' });
  }
  ctx.obstacles.push({ kind: 'circle', x: x - 5, z: z + 6, r: 4.2, height: 6.5, look: 'hall' });
  ctx.obstacles.push(
    { kind: 'circle', x: x + 11, z: z + 9, r: 2.2, height: 3.6, look: 'hut' },
    { kind: 'circle', x: x + 12, z: z - 8, r: 2.2, height: 3.6, look: 'hut' },
    { kind: 'circle', x: x - 12, z: z - 10, r: 2.0, height: 3.4, look: 'hut' },
  );
  ctx.chests.push({ x: x - 5, z }, { x: x + 4, z: z + 12 }, { x: x + 4, z: z - 13 }, { x: x - 14, z: z - 2 });
  ctx.elites.push({ x: x + 2, z: z + 2 }, { x: x - 10, z: z + 12 });
  ctx.scrolls.push({ x: x + 16, z: z + 1 }, { x: x - 2, z: z - 6 });
  ctx.items.push({ x: x + 8, z: z + 16 });
  ctx.mobs.push({ x: x + 30, z: z + 8 }, { x: x - 6, z: z - 30 });
}

/** A farmstead: a house, a barn, a well, fields the renderer sows, and boars in the crops. */
function stampFarm(ctx: PieceCtx, x: number, z: number, name: string, s: number): void {
  ctx.landmarks.push({ kind: 'farm', name, x, z, r: 30 });
  ctx.hills.push({ x, z, r: 36, h: 1.2 });
  ctx.obstacles.push(
    { kind: 'box', x: x - 9 * s, z: z + 6, hx: 3.6, hz: 3.0, height: 4.6, look: 'house' },
    { kind: 'box', x: x + 11 * s, z: z - 9, hx: 3.2, hz: 4.2, height: 4.2, look: 'barn' },
    { kind: 'circle', x: x - 1 * s, z: z - 3, r: 0.9, height: 1.2, look: 'rock' },
    { kind: 'circle', x: x - 16 * s, z: z - 6, r: 1.5, height: 6, look: 'tree' },
  );
  ctx.chests.push({ x: x - 9 * s, z: z + 1 }, { x: x + 11 * s, z: z - 3 }, { x: x + 2 * s, z: z + 12 });
  ctx.elites.push({ x: x + 4 * s, z: z - 2 });
  ctx.scrolls.push({ x: x - 3 * s, z: z + 14 });
  ctx.items.push({ x: x + 16 * s, z: z + 4 });
  ctx.mobs.push({ x: x + 8 * s, z: z + 10 }, { x: x + 14 * s, z: z + 14 });
}

/** Northfold Manor: a lord's ruined house and its walled garden on a rise. */
function stampManor(ctx: PieceCtx, x: number, z: number): void {
  ctx.landmarks.push({ kind: 'manor', name: 'Northfold Manor', x, z, r: 28 });
  ctx.hills.push({ x, z, r: 36, h: 2.5 });
  ctx.obstacles.push(
    { kind: 'box', x, z: z + 5, hx: 6.5, hz: 3.6, height: 6, look: 'house' },
    { kind: 'box', x: x - 9, z: z - 1, hx: 3, hz: 4, height: 5, look: 'house' },
    { kind: 'circle', x: x + 9, z: z + 7, r: 2.2, height: 9.5, look: 'tower' },
    // Garden walls, low and broken.
    { kind: 'box', x: x + 2, z: z - 12, hx: 9, hz: 0.6, height: 1.3 },
    { kind: 'box', x: x + 13, z: z - 5, hx: 0.6, hz: 6, height: 1.3 },
  );
  ctx.chests.push({ x, z: z - 3 }, { x: x - 9, z: z - 7 }, { x: x + 8, z: z - 8 });
  ctx.elites.push({ x: x + 4, z: z - 6 });
  ctx.scrolls.push({ x: x - 14, z: z + 6 }, { x: x + 15, z: z + 1 });
  ctx.items.push({ x: x - 2, z: z - 16 });
}

/** Witherbark Village: troll huts and totems around a bonfire. */
function stampVillage(ctx: PieceCtx, x: number, z: number): void {
  ctx.landmarks.push({ kind: 'village', name: 'Witherbark Village', x, z, r: 26 });
  ctx.hills.push({ x, z, r: 32, h: 1.5 });
  for (let k = 0; k < 4; k++) {
    const a = (k / 4) * Math.PI * 2 + 0.6;
    ctx.obstacles.push({ kind: 'circle', x: x + Math.sin(a) * 12, z: z + Math.cos(a) * 12, r: 2.3, height: 3.8, look: 'hut' });
    const b = a + Math.PI / 4;
    ctx.obstacles.push({ kind: 'circle', x: x + Math.sin(b) * 7, z: z + Math.cos(b) * 7, r: 0.7, height: 4, look: 'totem' });
  }
  ctx.chests.push({ x: x + 3, z: z + 2 }, { x: x - 12, z: z + 3 }, { x: x + 8, z: z - 12 });
  ctx.elites.push({ x: x - 3, z: z - 3 }, { x: x + 10, z: z + 8 });
  ctx.scrolls.push({ x: x - 5, z: z + 9 });
  ctx.items.push({ x: x + 14, z: z - 2 });
  ctx.mobs.push({ x: x + 18, z: z + 14 }, { x: x - 18, z: z - 10 }, { x: x - 2, z: z + 20 });
}

/** Thandol Span: the great bridge north, broken off over the water — its gatehouse and pillars remain. */
function stampBridge(ctx: PieceCtx, x: number, z: number, dirX: number, dirZ: number): void {
  ctx.landmarks.push({ kind: 'bridge', name: 'Thandol Span', x, z, r: 22 });
  const px = dirZ;
  const pz = -dirX;
  for (const side of [-1, 1]) {
    ctx.obstacles.push(
      { kind: 'circle', x: x + px * side * 7 - dirX * 8, z: z + pz * side * 7 - dirZ * 8, r: 2.2, height: 9, look: 'tower' },
      { kind: 'circle', x: x + px * side * 4.5 + dirX * 4, z: z + pz * side * 4.5 + dirZ * 4, r: 2.4, height: 10, look: 'pillar' },
      { kind: 'circle', x: x + px * side * 4.5 + dirX * 18, z: z + pz * side * 4.5 + dirZ * 18, r: 2.4, height: 10, look: 'pillar' },
    );
  }
  ctx.chests.push({ x: x - dirX * 14, z: z - dirZ * 14 }, { x: x + px * 12 - dirX * 10, z: z + pz * 12 - dirZ * 10 });
  ctx.elites.push({ x: x - dirX * 20, z: z - dirZ * 20 });
  ctx.scrolls.push({ x: x - px * 12 - dirX * 12, z: z - pz * 12 - dirZ * 12 });
}

/** A Circle of Binding: standing stones on a low mound around an elemental altar. */
function stampStoneRing(ctx: PieceCtx, x: number, z: number, name: string): void {
  ctx.landmarks.push({ kind: 'stonering', name, x, z, r: 18 });
  ctx.hills.push({ x, z, r: 24, h: 2.2 });
  const stones = 6;
  for (let s = 0; s < stones; s++) {
    const a = (s / stones) * Math.PI * 2 + 0.2;
    ctx.obstacles.push({ kind: 'circle', x: x + Math.sin(a) * 11, z: z + Math.cos(a) * 11, r: 1.3, height: 6.5, look: 'rock' });
  }
  ctx.chests.push({ x, z }, { x: x + 4, z: z + 4 });
  ctx.elites.push({ x: x - 3, z: z + 2 });
  ctx.scrolls.push({ x: x - 5, z: z - 3 });
}

/** Bouldergor: the ogres' pit — dropping in is free, leaving is not. */
function stampPit(ctx: PieceCtx, x: number, z: number): void {
  const r = 24;
  ctx.landmarks.push({ kind: 'pit', name: 'Bouldergor', x, z, r });
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

/** Galen's Fall: a wooded hillside, one giant tree ringed by its children. */
function stampGroveLandmark(ctx: PieceCtx, x: number, z: number): void {
  ctx.landmarks.push({ kind: 'grove', name: "Galen's Fall", x, z, r: 24 });
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
 * Drywhisker Gorge: the kobolds' sunken ravine. Rock walls line both rims;
 * the only comfortable ways in are the two open ends, and the loot-rich
 * floor sits ~8m below the plain, out of sight.
 */
function stampRavine(ctx: PieceCtx, x: number, z: number): void {
  ctx.landmarks.push({ kind: 'ravine', name: 'Drywhisker Gorge', x, z, r: 34 });
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
  ctx.mobs.push({ x: x + dirX * 30, z: z + dirZ * 30 }, { x: x - dirX * 30, z: z - dirZ * 30 });
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

/** Refuge Pointe: the Alliance camp among ruined stone buildings on the central plain — juking country. */
function stampHamlet(ctx: PieceCtx, x: number, z: number): void {
  ctx.landmarks.push({ kind: 'hamlet', name: 'Refuge Pointe', x, z, r: 30 });
  ruinedHouse(ctx, x - 14, z - 8, 5, 4);
  ruinedHouse(ctx, x + 12, z - 13, 4, 5);
  ruinedHouse(ctx, x + 11, z + 12, 6, 4);
  ruinedHouse(ctx, x - 12, z + 14, 4, 3.5);
  // Rubble in the plaza, and the camp's watch post.
  ctx.obstacles.push(
    { kind: 'box', x: x + 1, z: z - 1, hx: 1.5, hz: 1.1, height: 1.4 },
    { kind: 'circle', x: x - 5, z: z + 3, r: 1.3, height: 2.2, look: 'rock' },
    { kind: 'circle', x: x + 2, z: z + 20, r: 1.8, height: 8, look: 'tower' },
  );
  ctx.chests.push({ x: x - 14, z: z - 8 }, { x: x + 12, z: z - 13 }, { x: x + 11, z: z + 12 }, { x: x - 12, z: z + 14 });
  ctx.elites.push({ x: x + 3, z: z + 3 }, { x: x - 4, z: z - 5 });
  ctx.scrolls.push({ x: x + 5, z: z - 4 }, { x: x - 2, z: z + 6 });
  ctx.items.push({ x, z: z - 3 });
  ctx.mobs.push({ x: x + 18, z: z + 4 });
}

/** Boulderfist Hall: the ogre mound, crowned with standing stones and a great fallen head. */
function stampBarrow(ctx: PieceCtx, x: number, z: number): void {
  ctx.landmarks.push({ kind: 'barrow', name: 'Boulderfist Hall', x, z, r: 26 });
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
  ctx.mobs.push({ x: x + 16, z: z - 12 });
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
 * Arathi Highlands, the way Plunderstorm plays it: an 840×840 island whose
 * named places sit where they do on the real map (north is +z, west is +x
 * on the in-game map). The landmarks are hand-placed; the geography
 * between them — ridges, lake basins, rolling hills, copses, boulder
 * fields, field cover, and loose loot — is scattered from a fixed-seed Rng
 * around them, so the layout is identical every match.
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

  // The irregular coastline everything must stay inside of.
  const COAST = 356;
  const inland =
    (margin: number) =>
    (x: number, z: number): boolean =>
      Math.hypot(x, z) < coastRadius(COAST, Math.atan2(x, z)) - margin;
  /** Pull a point inside the coast by at least `margin`. */
  const ashore = (x: number, z: number, margin: number): Point => {
    const r = Math.hypot(x, z);
    const maxR = coastRadius(COAST, Math.atan2(x, z)) - margin;
    return r > maxR ? { x: (x * maxR) / r, z: (z * maxR) / r } : { x, z };
  };
  const onCoast = (angle: number, inset: number): Point => {
    const r = coastRadius(COAST, angle) - inset;
    return { x: Math.sin(angle) * r, z: Math.cos(angle) * r };
  };

  // ── The named places of Arathi, hand-placed ──
  const keep = ashore(215, -95, 70);
  stampKeep(ctx, keep.x, keep.z);
  const wallX = ashore(285, 45, 34).x;
  stampWall(ctx, wallX, -30, 130);
  const cove = onCoast(2.35, 24);
  stampCove(ctx, cove.x, cove.z);
  const grove = ashore(238, 45, 40);
  stampGroveLandmark(ctx, grove.x, grove.z);
  const manor = ashore(170, 215, 45);
  stampManor(ctx, manor.x, manor.z);
  const outer = ashore(85, 255, 40);
  stampStoneRing(ctx, outer.x, outer.z, 'Circle of Outer Binding');
  const span = onCoast(0.05, 8);
  stampBridge(ctx, span.x, span.z, Math.sin(0.05), Math.cos(0.05));
  const dabyrie = ashore(-40, 175, 40);
  stampFarm(ctx, dabyrie.x, dabyrie.z, "Dabyrie's Farmstead", 1);
  const gorge = ashore(-165, 225, 60);
  stampRavine(ctx, gorge.x, gorge.z);
  const hammerfall = ashore(-235, 120, 55);
  stampFort(ctx, hammerfall.x, hammerfall.z);
  const east = ashore(-245, -25, 40);
  stampStoneRing(ctx, east.x, east.z, 'Circle of East Binding');
  stampHamlet(ctx, 35, 25);
  stampStoneRing(ctx, 120, 100, 'Circle of West Binding');
  stampStoneRing(ctx, -45, -95, 'Circle of Inner Binding');
  stampPit(ctx, 65, -195);
  const goshek = ashore(-85, -235, 45);
  stampFarm(ctx, goshek.x, goshek.z, "Go'Shek Farm", -1);
  stampBarrow(ctx, -185, -150);
  const witherbark = ashore(-255, -230, 45);
  stampVillage(ctx, witherbark.x, witherbark.z);
  stampPassage(ctx, goshek.x, goshek.z, -185, -150);

  /** Anchors that scattered geography, sites, and loot must keep clear of. */
  const keepOut: { x: number; z: number; r: number }[] = ctx.landmarks.map((l) => ({ x: l.x, z: l.z, r: l.r }));
  for (let z = -30; z <= 130; z += 12) keepOut.push({ x: wallX, z, r: 10 });
  {
    // The trench of the passage, too.
    const dx = -185 - goshek.x;
    const dz = -150 - goshek.z;
    const len = Math.hypot(dx, dz);
    for (let t = 0; t <= len; t += 12) keepOut.push({ x: goshek.x + (dx / len) * t, z: goshek.z + (dz / len) * t, r: 14 });
  }
  const clearOf = (margin: number) => (x: number, z: number): boolean =>
    keepOut.every((k) => Math.hypot(k.x - x, k.z - z) > k.r + margin);
  const both = (...fns: ((x: number, z: number) => boolean)[]) => (x: number, z: number): boolean => fns.every((f) => f(x, z));

  // ── Mountain ridges: chains of tall massifs — open high ground, no walls ──
  const ridges = scatterPoints(rng, 6, 150, 335, [], both(inland(45), clearOf(40)));
  for (const ridge of ridges) {
    const angle = rng.range(0, Math.PI);
    const len = rng.range(70, 105);
    const dirX = Math.cos(angle);
    const dirZ = Math.sin(angle);
    for (const t of [-0.28, 0.05, 0.32]) {
      const hx = ridge.x + dirX * t * len;
      const hz = ridge.z + dirZ * t * len;
      if (!clearOf(20)(hx, hz)) continue;
      hills.push({ x: hx, z: hz, r: rng.range(30, 44), h: rng.range(8, 14) });
    }
    // Keep sites and loot off the crests.
    const segs = Math.round(len / 9);
    for (let s = 0; s <= segs; s++) {
      const t = s / segs - 0.5;
      keepOut.push({ x: ridge.x + dirX * t * len, z: ridge.z + dirZ * t * len, r: 12 });
    }
  }

  // ── Lowland basins; the first five hold lakes ──
  const basins = scatterPoints(rng, 8, 120, 345, [], both(inland(48), clearOf(45)));
  basins.forEach((b, i) => {
    hills.push({ x: b.x, z: b.z, r: rng.range(36, 52), h: rng.range(-1.6, -1.0) });
    if (i < 5) {
      const r = rng.range(13, 20);
      lakes.push({ x: b.x, z: b.z, r });
      // A real pool: over your head in the middle, water filling the bowl up
      // to the waterline, so a chest-deep wader only has to nudge the camera
      // down for it to submerge.
      hills.push({ x: b.x, z: b.z, r: r * 2.1, h: -3.6 });
      keepOut.push({ x: b.x, z: b.z, r: r * 1.6 });
    }
  });

  // Rolling hills across the rest of the island.
  for (const p of scatterPoints(rng, 44, 44, 365, [], both(inland(28), clearOf(14)))) {
    hills.push({ x: p.x, z: p.z, r: rng.range(24, 42), h: rng.range(2.5, 7) });
  }

  // ── Minor sites: copses and boulder fields with loot tucked inside ──
  const sites = scatterPoints(rng, 22, 65, 365, [], both(inland(30), clearOf(24)));
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

  // ── Field cover between the sites (kept clear of them and the landmarks) ──
  const cover = scatterPoints(rng, 110, 16, 390, sites, both(inland(16), clearOf(6)));
  cover.forEach((p, i) => {
    if (i % 3 === 0) {
      obstacles.push({ kind: 'circle', x: p.x, z: p.z, r: 2 + (i % 3) * 0.3, height: 3.4, look: 'rock' });
    } else {
      obstacles.push({ kind: 'circle', x: p.x, z: p.z, r: 1.5 + (i % 4) * 0.25, height: 5 + (i % 3), look: 'tree' });
    }
  });

  // ── Loose pickings and roaming packs for the space between sites ──
  const openGround = both(inland(18), clearOf(4));
  for (const p of scatterPoints(rng, 46, 28, 375, sites, openGround)) chests.push(p);
  for (const p of scatterPoints(rng, 56, 22, 385, sites, openGround)) mobs.push(p);
  for (const p of scatterPoints(rng, 28, 32, 370, sites, openGround)) scrolls.push(p);
  for (const p of scatterPoints(rng, 26, 30, 375, sites, openGround)) items.push(p);

  // ── Nudge every static pickup out of anything it spawned inside ──
  // A chest inside a tree trunk helps no one.
  const clearLoot = (pts: Point[]): void => {
    for (const p of pts) {
      for (let pass = 0; pass < 4; pass++) {
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
            // Boxes (walls): push out along the shallower axis.
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
  clearLoot(mobs);

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
