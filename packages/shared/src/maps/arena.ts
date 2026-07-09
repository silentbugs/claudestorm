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

/**
 * 420×420 island. Eighteen named POIs scattered across the whole map — no
 * special center — plus lone loot, mobs roaming the open fields, and cover
 * between them. Built from a fixed-seed Rng, so the layout is identical
 * every match.
 */
function buildArena(): MapDef {
  const rng = new Rng(0x15_1a_9d); // island seed — change for a new layout
  const obstacles: Obstacle[] = [];
  const chests: Point[] = [];
  const mobs: Point[] = [];
  const elites: Point[] = [];
  const scrolls: Point[] = [];
  const items: Point[] = [];

  // Rolling hills, everywhere rather than radiating from the middle.
  const hills: Hill[] = scatterPoints(rng, 22, 40, 172).map((p) => ({
    x: p.x,
    z: p.z,
    r: rng.range(22, 38),
    h: rng.range(2.5, 6.5),
  }));

  // ── Eighteen POIs spread over the island, each a different kit ──
  const pois = scatterPoints(rng, 18, 55, 180);
  pois.forEach((poi, i) => {
    const { x: px, z: pz } = poi;
    const s = i % 2 === 0 ? 1 : -1;
    switch (i % 4) {
      case 0: // ruin: broken walls, a pillar, and a collapsed corner
        obstacles.push(
          { kind: 'box', x: px, z: pz + 8, hx: 6, hz: 1.3, height: 4.5 },
          { kind: 'box', x: px - 8 * s, z: pz - 3, hx: 1.3, hz: 5, height: 3.5 },
          { kind: 'box', x: px + 9 * s, z: pz - 1, hx: 1.2, hz: 3.5, height: 2.8 },
          { kind: 'circle', x: px + 2 * s, z: pz - 10, r: 1.7, height: 6 },
        );
        break;
      case 1: // camp: huts around a clearing
        obstacles.push(
          { kind: 'box', x: px + 4 * s, z: pz - 3, hx: 3, hz: 2.5, height: 3.6 },
          { kind: 'box', x: px - 5 * s, z: pz + 6, hx: 1.8, hz: 1.8, height: 3 },
          { kind: 'box', x: px - 1 * s, z: pz - 9, hx: 2.2, hz: 1.8, height: 3.2 },
        );
        break;
      case 2: // grove: a stand of big trees
        obstacles.push(
          { kind: 'circle', x: px - 6 * s, z: pz - 4, r: 2.1, height: 7 },
          { kind: 'circle', x: px + 7 * s, z: pz + 6, r: 1.6, height: 6 },
          { kind: 'circle', x: px + 1 * s, z: pz + 11, r: 1.4, height: 5.5 },
          { kind: 'circle', x: px - 10 * s, z: pz + 5, r: 1.8, height: 6.5 },
        );
        break;
      default: // quarry: rocks and cut blocks
        obstacles.push(
          { kind: 'box', x: px + 3 * s, z: pz + 4, hx: 2.2, hz: 2.2, height: 3.2 },
          { kind: 'box', x: px - 2 * s, z: pz + 10, hx: 1.6, hz: 1.6, height: 2.4 },
          { kind: 'circle', x: px - 5 * s, z: pz - 4, r: 2.4, height: 4.5 },
        );
    }
    chests.push({ x: px, z: pz }, { x: px + 5 * s, z: pz + 4 });
    if (i % 3 !== 2) chests.push({ x: px - 6 * s, z: pz - 2 });
    if (i % 4 !== 3) elites.push({ x: px + 2 * s, z: pz + 8 });
    mobs.push({ x: px + 11 * s, z: pz - 8 });
    if (i % 3 === 0) mobs.push({ x: px - 10 * s, z: pz + 10 });
    if (i % 3 !== 0) scrolls.push({ x: px - 2 * s, z: pz + 2 });
    if (i % 2 === 1) items.push({ x: px + 3 * s, z: pz - 5 });
  });

  // ── Field cover between the POIs (kept clear of them) ──
  const cover = scatterPoints(rng, 48, 15, 196, pois);
  cover.forEach((p, i) => {
    if (i % 3 === 0) {
      obstacles.push({ kind: 'box', x: p.x, z: p.z, hx: 2, hz: 1.6, height: 3 });
    } else {
      obstacles.push({ kind: 'circle', x: p.x, z: p.z, r: 1.5 + (i % 4) * 0.25, height: 5 + (i % 3) });
    }
  });

  // ── Loose pickings and roaming packs for the space between POIs ──
  for (const p of scatterPoints(rng, 14, 26, 190, pois)) chests.push(p);
  for (const p of scatterPoints(rng, 24, 18, 195, pois)) mobs.push(p);
  for (const p of scatterPoints(rng, 9, 30, 185, pois)) scrolls.push(p);
  for (const p of scatterPoints(rng, 10, 26, 190, pois)) items.push(p);

  return { size: 420, obstacles, chests, mobs, elites, scrolls, items, hills };
}

export const ARENA: MapDef = buildArena();
