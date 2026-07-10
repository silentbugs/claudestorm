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

/** A lake: wading through it slows movement; rendered as water in a terrain bowl. */
export interface LakeDef {
  x: number;
  z: number;
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
 * 760×760 island with real geography. Mountain ridges (impassable cliff walls
 * over tall massifs) are broken by deliberate gaps — passageways that funnel
 * fights. Lowland basins dip below the plain, five of them holding lakes that
 * slow anyone wading through. Thirty-six named POIs fill the space between —
 * no special center — plus lone loot, roaming mobs, and field cover. Built
 * from a fixed-seed Rng, so the layout is identical every match.
 */
function buildArena(): MapDef {
  const rng = new Rng(0x15_1a_9d); // island seed — change for a new layout
  const obstacles: Obstacle[] = [];
  const chests: Point[] = [];
  const mobs: Point[] = [];
  const elites: Point[] = [];
  const scrolls: Point[] = [];
  const items: Point[] = [];
  const hills: Hill[] = [];
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
      obstacles.push({ kind: 'circle', x, z, r: rng.range(5, 7.5), height: rng.range(12, 17) });
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

  // Rolling hills across the rest of the island.
  for (const p of scatterPoints(rng, 40, 44, 330, keepOut)) {
    hills.push({ x: p.x, z: p.z, r: rng.range(24, 42), h: rng.range(2.5, 7) });
  }

  // ── Thirty-six POIs spread over the island, each a different kit ──
  const pois = scatterPoints(rng, 36, 62, 330, keepOut);
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

  // ── Field cover between the POIs (kept clear of them and the geography) ──
  const cover = scatterPoints(rng, 104, 16, 352, [...pois, ...keepOut]);
  cover.forEach((p, i) => {
    if (i % 3 === 0) {
      obstacles.push({ kind: 'box', x: p.x, z: p.z, hx: 2, hz: 1.6, height: 3 });
    } else {
      obstacles.push({ kind: 'circle', x: p.x, z: p.z, r: 1.5 + (i % 4) * 0.25, height: 5 + (i % 3) });
    }
  });

  // ── Loose pickings and roaming packs for the space between POIs ──
  const avoid = [...pois, ...keepOut];
  for (const p of scatterPoints(rng, 28, 30, 340, avoid)) chests.push(p);
  for (const p of scatterPoints(rng, 46, 22, 348, avoid)) mobs.push(p);
  for (const p of scatterPoints(rng, 18, 34, 336, avoid)) scrolls.push(p);
  for (const p of scatterPoints(rng, 20, 30, 340, avoid)) items.push(p);

  return { size: 760, obstacles, chests, mobs, elites, scrolls, items, hills, lakes };
}

export const ARENA: MapDef = buildArena();
