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
}

/**
 * 200×200 island with seven points of interest: center ruins, four corner
 * camps, a north watchtower, and a south grove. Chests, creatures, and loose
 * scrolls cluster around the POIs.
 */
export const ARENA: MapDef = {
  size: 200,
  obstacles: [
    // Center ruins
    { kind: 'box', x: 0, z: 7, hx: 5.5, hz: 1.2, height: 4 },
    { kind: 'box', x: -7, z: -3, hx: 1.2, hz: 4.5, height: 3.5 },
    { kind: 'box', x: 7, z: -5, hx: 1.2, hz: 3, height: 5 },
    { kind: 'circle', x: 2, z: -10, r: 1.6, height: 6 },
    { kind: 'circle', x: -3, z: 12, r: 1.4, height: 5 },
    // NW farm
    { kind: 'box', x: -55, z: -46, hx: 4, hz: 3, height: 4 },
    { kind: 'box', x: -46, z: -53, hx: 2, hz: 2, height: 3 },
    { kind: 'circle', x: -63, z: -38, r: 2.2, height: 7 },
    { kind: 'circle', x: -48, z: -40, r: 1.6, height: 6 },
    // NE camp
    { kind: 'box', x: 57, z: -49, hx: 3, hz: 3, height: 3.5 },
    { kind: 'circle', x: 64, z: -42, r: 1.8, height: 6 },
    { kind: 'circle', x: 50, z: -58, r: 1.5, height: 5 },
    // SW docks
    { kind: 'box', x: -62, z: 51, hx: 5, hz: 2, height: 3 },
    { kind: 'box', x: -53, z: 60, hx: 2, hz: 4, height: 4 },
    { kind: 'circle', x: -68, z: 60, r: 1.7, height: 5 },
    // SE quarry
    { kind: 'circle', x: 56, z: 56, r: 3.5, height: 8 },
    { kind: 'box', x: 64, z: 48, hx: 2.5, hz: 2, height: 3 },
    { kind: 'circle', x: 48, z: 64, r: 2, height: 6 },
    // N watchtower
    { kind: 'circle', x: 2, z: -70, r: 2.6, height: 9 },
    { kind: 'box', x: -5, z: -64, hx: 2, hz: 1.5, height: 3 },
    { kind: 'box', x: 9, z: -64, hx: 1.5, hz: 1.5, height: 3 },
    // S grove
    { kind: 'circle', x: -8, z: 68, r: 2, height: 7 },
    { kind: 'circle', x: 0, z: 74, r: 1.8, height: 6 },
    { kind: 'circle', x: 5, z: 65, r: 1.5, height: 6 },
    // Scattered mid-field cover
    { kind: 'circle', x: -30, z: 10, r: 2, height: 6 },
    { kind: 'circle', x: 30, z: 17, r: 1.8, height: 6 },
    { kind: 'box', x: 13, z: 40, hx: 3, hz: 1.5, height: 3 },
    { kind: 'box', x: -22, z: -30, hx: 2.5, hz: 1.5, height: 3 },
    { kind: 'circle', x: 38, z: -18, r: 1.6, height: 5 },
    { kind: 'circle', x: -42, z: 34, r: 1.7, height: 5 },
    { kind: 'box', x: -10, z: 44, hx: 2, hz: 2, height: 3 },
    { kind: 'box', x: 20, z: -42, hx: 2, hz: 2, height: 3.5 },
    { kind: 'circle', x: 76, z: 4, r: 1.8, height: 6 },
    { kind: 'circle', x: -78, z: -6, r: 1.8, height: 6 },
    { kind: 'box', x: 44, z: 30, hx: 2, hz: 2, height: 3 },
    { kind: 'box', x: -38, z: -58, hx: 2, hz: 1.5, height: 3 },
  ],
  chests: [
    // Center ruins (richest)
    { x: 0, z: 0 }, { x: -5, z: 9 }, { x: 8, z: 2 }, { x: -2, z: -12 },
    // NW farm
    { x: -54, z: -50 }, { x: -47, z: -44 }, { x: -61, z: -43 },
    // NE camp
    { x: 55, z: -53 }, { x: 62, z: -46 }, { x: 49, z: -47 },
    // SW docks
    { x: -59, z: 55 }, { x: -51, z: 53 }, { x: -65, z: 47 },
    // SE quarry
    { x: 59, z: 50 }, { x: 52, z: 59 },
    // N watchtower
    { x: 2, z: -66 }, { x: -2, z: -73 },
    // S grove
    { x: -4, z: 70 }, { x: 3, z: 68 },
    // Field chests
    { x: -29, z: 14 }, { x: 28, z: 21 }, { x: 16, z: -40 }, { x: 74, z: 0 }, { x: -75, z: -2 },
  ],
  mobs: [
    { x: -17, z: 22 }, { x: -21, z: 26 }, { x: 22, z: -25 }, { x: 26, z: -29 },
    { x: -36, z: -15 }, { x: -40, z: -11 }, { x: 38, z: 34 }, { x: 34, z: 38 },
    { x: 0, z: 46 }, { x: 4, z: 50 }, { x: -8, z: -44 }, { x: -4, z: -48 },
    { x: 66, z: 10 }, { x: -66, z: 6 }, { x: 30, z: 60 }, { x: -30, z: 58 },
    { x: 44, z: -60 }, { x: -44, z: -62 },
  ],
  elites: [
    { x: 4, z: 14 },      // center ruins
    { x: -57, z: -42 },   // NW farm
    { x: 53, z: -44 },    // NE camp
    { x: -57, z: 50 },    // SW docks
    { x: 52, z: 52 },     // SE quarry
    { x: 6, z: -70 },     // N watchtower
    { x: -3, z: 71 },     // S grove
  ],
  scrolls: [
    { x: 3, z: 4 }, { x: -51, z: -48 }, { x: 58, z: -50 },
    { x: -55, z: 57 }, { x: 56, z: 53 }, { x: 32, z: 19 },
    { x: 0, z: -68 }, { x: -2, z: 66 },
  ],
  items: [
    { x: -2, z: 2 }, { x: -49, z: -46 }, { x: 54, z: -48 },
    { x: -57, z: 53 }, { x: 54, z: 57 }, { x: 4, z: -67 },
    { x: 1, z: 69 }, { x: -27, z: 12 }, { x: 26, z: 19 }, { x: 70, z: 2 },
  ],
};
