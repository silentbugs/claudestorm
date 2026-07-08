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
 * 300×300 island. A central ruin, an inner ring of four camps, an outer ring of
 * eight POIs, rolling hills, and scattered field cover. Built deterministically —
 * same layout every match.
 */
function buildArena(): MapDef {
  const obstacles: Obstacle[] = [];
  const chests: Point[] = [];
  const mobs: Point[] = [];
  const elites: Point[] = [];
  const scrolls: Point[] = [];
  const items: Point[] = [];

  const hills: Hill[] = [
    { x: 0, z: 0, r: 34, h: 3 }, // the ruins sit on a rise
    { x: -70, z: -55, r: 30, h: 5 },
    { x: 75, z: -60, r: 26, h: 4 },
    { x: -80, z: 60, r: 28, h: 4.5 },
    { x: 70, z: 70, r: 32, h: 6 }, // quarry hill
    { x: 0, z: -100, r: 26, h: 5 },
    { x: -10, z: 100, r: 24, h: 3.5 },
    { x: -120, z: 0, r: 30, h: 4 },
    { x: 118, z: 8, r: 28, h: 4 },
    { x: 40, z: -40, r: 20, h: 2 },
    { x: -45, z: 35, r: 22, h: 2.5 },
  ];

  // ── Center ruins ──
  obstacles.push(
    { kind: 'box', x: 0, z: 8, hx: 6, hz: 1.3, height: 4.5 },
    { kind: 'box', x: -8, z: -3, hx: 1.3, hz: 5, height: 3.5 },
    { kind: 'box', x: 8, z: -5, hx: 1.3, hz: 3.5, height: 5 },
    { kind: 'circle', x: 2, z: -11, r: 1.7, height: 6 },
    { kind: 'circle', x: -4, z: 13, r: 1.5, height: 5 },
  );
  chests.push({ x: 0, z: 0 }, { x: -6, z: 10 }, { x: 9, z: 2 }, { x: -2, z: -13 }, { x: 5, z: 12 });
  elites.push({ x: 4, z: 16 });
  scrolls.push({ x: 3, z: 4 }, { x: -3, z: -6 });
  items.push({ x: -2, z: 2 });
  mobs.push({ x: -16, z: 20 }, { x: 18, z: -22 });

  // ── Inner ring: four camps at ~55m ──
  const inner = [
    { x: 55, z: 0 },
    { x: -55, z: 8 },
    { x: 4, z: 55 },
    { x: -8, z: -55 },
  ];
  inner.forEach((p, i) => {
    obstacles.push({ kind: 'box', x: p.x + 3, z: p.z - 2, hx: 2.2, hz: 2.2, height: 3.2 });
    obstacles.push({ kind: 'circle', x: p.x - 5, z: p.z + 4, r: 1.6, height: 6 });
    chests.push({ x: p.x, z: p.z + 3 }, { x: p.x - 3, z: p.z - 4 });
    mobs.push({ x: p.x + 8, z: p.z + 6 }, { x: p.x - 9, z: p.z - 7 });
    if (i % 2 === 0) scrolls.push({ x: p.x + 2, z: p.z - 6 });
    items.push({ x: p.x - 2, z: p.z + 6 });
  });

  // ── Outer ring: eight POIs at ~100m ──
  for (let i = 0; i < 8; i++) {
    const angle = (i / 8) * Math.PI * 2 + 0.35;
    const px = Math.round(Math.cos(angle) * 100);
    const pz = Math.round(Math.sin(angle) * 100);
    // A hut, a big tree, and a rock — arranged differently per POI.
    const s = i % 2 === 0 ? 1 : -1;
    obstacles.push(
      { kind: 'box', x: px + 4 * s, z: pz - 3, hx: 3, hz: 2.5, height: 3.6 },
      { kind: 'box', x: px - 5 * s, z: pz + 6, hx: 1.8, hz: 1.8, height: 3 },
      { kind: 'circle', x: px - 7 * s, z: pz - 5, r: 2.1, height: 7 },
      { kind: 'circle', x: px + 7 * s, z: pz + 7, r: 1.5, height: 5.5 },
    );
    chests.push(
      { x: px, z: pz },
      { x: px + 5 * s, z: pz + 4 },
      { x: px - 6 * s, z: pz - 2 },
    );
    elites.push({ x: px + 2 * s, z: pz + 8 });
    mobs.push({ x: px + 12 * s, z: pz - 9 }, { x: px - 11 * s, z: pz + 11 });
    scrolls.push({ x: px - 2 * s, z: pz + 2 });
    if (i % 2 === 1) items.push({ x: px + 3 * s, z: pz - 5 });
  }

  // ── Scattered field cover, spiraling outward (golden angle) ──
  for (let i = 0; i < 22; i++) {
    const angle = i * 2.39996;
    const r = 28 + (i / 22) * 105;
    const x = Math.round(Math.cos(angle) * r);
    const z = Math.round(Math.sin(angle) * r);
    if (i % 3 === 0) {
      obstacles.push({ kind: 'box', x, z, hx: 2, hz: 1.6, height: 3 });
    } else {
      obstacles.push({ kind: 'circle', x, z, r: 1.5 + (i % 4) * 0.25, height: 5 + (i % 3) });
    }
    if (i % 4 === 0) chests.push({ x: x + 3, z: z + 2 });
    if (i % 5 === 0) mobs.push({ x: x - 4, z: z + 4 });
    if (i % 7 === 0) items.push({ x: x + 2, z: z - 3 });
  }

  return { size: 300, obstacles, chests, mobs, elites, scrolls, items, hills };
}

export const ARENA: MapDef = buildArena();
