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
  /** Loose ability scrolls lying in the world. */
  scrolls: Point[];
}

/**
 * 160×160 island with five points of interest: center ruins plus four camps.
 * Chests, creatures, and loose scrolls cluster around the POIs.
 */
export const ARENA: MapDef = {
  size: 160,
  obstacles: [
    // Center ruins
    { kind: 'box', x: 0, z: 6, hx: 5, hz: 1.2, height: 4 },
    { kind: 'box', x: -6, z: -3, hx: 1.2, hz: 4, height: 3.5 },
    { kind: 'box', x: 6, z: -4, hx: 1.2, hz: 3, height: 5 },
    { kind: 'circle', x: 2, z: -8, r: 1.6, height: 6 },
    // NW farm
    { kind: 'box', x: -45, z: -38, hx: 4, hz: 3, height: 4 },
    { kind: 'box', x: -36, z: -44, hx: 2, hz: 2, height: 3 },
    { kind: 'circle', x: -52, z: -30, r: 2.2, height: 7 },
    // NE camp
    { kind: 'box', x: 46, z: -40, hx: 3, hz: 3, height: 3.5 },
    { kind: 'circle', x: 52, z: -33, r: 1.8, height: 6 },
    { kind: 'circle', x: 40, z: -48, r: 1.5, height: 5 },
    // SW docks
    { kind: 'box', x: -50, z: 42, hx: 5, hz: 2, height: 3 },
    { kind: 'box', x: -42, z: 50, hx: 2, hz: 4, height: 4 },
    // SE quarry
    { kind: 'circle', x: 45, z: 45, r: 3.5, height: 8 },
    { kind: 'box', x: 52, z: 38, hx: 2.5, hz: 2, height: 3 },
    { kind: 'circle', x: 38, z: 52, r: 2, height: 6 },
    // Scattered mid-field cover
    { kind: 'circle', x: -25, z: 8, r: 2, height: 6 },
    { kind: 'circle', x: 24, z: 14, r: 1.8, height: 6 },
    { kind: 'box', x: 10, z: 32, hx: 3, hz: 1.5, height: 3 },
    { kind: 'box', x: -18, z: -24, hx: 2.5, hz: 1.5, height: 3 },
    { kind: 'circle', x: 30, z: -14, r: 1.6, height: 5 },
    { kind: 'circle', x: -34, z: 28, r: 1.7, height: 5 },
    { kind: 'box', x: -8, z: 46, hx: 2, hz: 2, height: 3 },
    { kind: 'box', x: 16, z: -34, hx: 2, hz: 2, height: 3.5 },
  ],
  chests: [
    // Center ruins (richest)
    { x: 0, z: 0 }, { x: -4, z: 8 }, { x: 7, z: 2 }, { x: -2, z: -10 },
    // NW farm
    { x: -44, z: -42 }, { x: -38, z: -36 }, { x: -50, z: -35 },
    // NE camp
    { x: 44, z: -44 }, { x: 50, z: -37 },
    // SW docks
    { x: -47, z: 46 }, { x: -40, z: 44 },
    // SE quarry
    { x: 48, z: 41 }, { x: 42, z: 48 },
    // Field chests
    { x: -24, z: 12 }, { x: 22, z: 18 }, { x: 12, z: -32 },
  ],
  mobs: [
    { x: -14, z: 18 }, { x: -18, z: 22 }, { x: 18, z: -20 }, { x: 22, z: -24 },
    { x: -30, z: -12 }, { x: -34, z: -8 }, { x: 32, z: 28 }, { x: 28, z: 32 },
    { x: 0, z: 38 }, { x: 4, z: 42 }, { x: -6, z: -36 }, { x: -2, z: -40 },
    { x: 54, z: 8 }, { x: -54, z: 4 },
  ],
  scrolls: [
    { x: 3, z: 4 }, { x: -41, z: -40 }, { x: 47, z: -41 },
    { x: -44, z: 47 }, { x: 45, z: 44 }, { x: 26, z: 16 },
  ],
};
