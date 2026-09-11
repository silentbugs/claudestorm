import { coastRadius, type MapDef, type Obstacle } from '../maps/arena.js';

/*
 * Obstacle lookups go through a uniform grid built once per map: every
 * obstacle is filed into each cell its bounds (padded by the largest
 * collider the sim resolves) overlap, so a query only ever visits the one
 * cell under the entity. Several hundred walls, stakes, trees and rocks
 * cost the same per tick as a dozen did.
 */
const GRID_CELL = 32;
/** Largest collider radius the sim ever resolves against obstacles, plus slack. */
const GRID_PAD = 4;
interface ObstacleGrid {
  half: number;
  cols: number;
  buckets: Obstacle[][];
}
const grids = new WeakMap<MapDef, ObstacleGrid>();

function gridFor(map: MapDef): ObstacleGrid {
  let grid = grids.get(map);
  if (grid) return grid;
  const half = map.size / 2 + GRID_CELL * 2;
  const cols = Math.ceil((half * 2) / GRID_CELL);
  const buckets: Obstacle[][] = Array.from({ length: cols * cols }, () => []);
  const idx = (v: number): number => Math.min(cols - 1, Math.max(0, Math.floor((v + half) / GRID_CELL)));
  for (const ob of map.obstacles) {
    const ex = (ob.kind === 'circle' ? ob.r : ob.hx) + GRID_PAD;
    const ez = (ob.kind === 'circle' ? ob.r : ob.hz) + GRID_PAD;
    const i0 = idx(ob.x - ex);
    const i1 = idx(ob.x + ex);
    const j0 = idx(ob.z - ez);
    const j1 = idx(ob.z + ez);
    for (let j = j0; j <= j1; j++) for (let i = i0; i <= i1; i++) buckets[j * cols + i]!.push(ob);
  }
  grid = { half, cols, buckets };
  grids.set(map, grid);
  return grid;
}

/** The obstacles that could touch a collider of radius ≤ GRID_PAD at (x, z). */
export function nearbyObstacles(map: MapDef, x: number, z: number): Obstacle[] {
  const g = gridFor(map);
  const i = Math.min(g.cols - 1, Math.max(0, Math.floor((x + g.half) / GRID_CELL)));
  const j = Math.min(g.cols - 1, Math.max(0, Math.floor((z + g.half) / GRID_CELL)));
  return g.buckets[j * g.cols + i]!;
}
import { clamp } from '../math/vec.js';

/** Push a circle of the given radius out of arena bounds and all obstacles. */
export function resolveCollisions(
  x: number,
  z: number,
  radius: number,
  map: MapDef,
): { x: number; z: number } {
  const half = map.size / 2 - radius;
  x = clamp(x, -half, half);
  z = clamp(z, -half, half);
  if (map.coastR) {
    // Island maps: the sea is the boundary, not the square.
    const maxR = coastRadius(map.coastR, Math.atan2(x, z)) - radius;
    const r = Math.hypot(x, z);
    if (r > maxR) {
      x *= maxR / r;
      z *= maxR / r;
    }
  }

  for (const ob of nearbyObstacles(map, x, z)) {
    if (ob.kind === 'circle') {
      const dx = x - ob.x;
      const dz = z - ob.z;
      const minDist = ob.r + radius;
      const d2 = dx * dx + dz * dz;
      if (d2 < minDist * minDist) {
        const d = Math.sqrt(d2);
        if (d > 1e-8) {
          x = ob.x + (dx / d) * minDist;
          z = ob.z + (dz / d) * minDist;
        } else {
          x = ob.x + minDist;
        }
      }
    } else {
      const cx = clamp(x, ob.x - ob.hx, ob.x + ob.hx);
      const cz = clamp(z, ob.z - ob.hz, ob.z + ob.hz);
      const dx = x - cx;
      const dz = z - cz;
      const d2 = dx * dx + dz * dz;
      if (d2 >= radius * radius) continue;
      if (d2 > 1e-12) {
        const d = Math.sqrt(d2);
        x = cx + (dx / d) * radius;
        z = cz + (dz / d) * radius;
      } else {
        // Center is inside the box: exit through the nearest face.
        const toLeft = x - (ob.x - ob.hx);
        const toRight = ob.x + ob.hx - x;
        const toNear = z - (ob.z - ob.hz);
        const toFar = ob.z + ob.hz - z;
        const m = Math.min(toLeft, toRight, toNear, toFar);
        if (m === toLeft) x = ob.x - ob.hx - radius;
        else if (m === toRight) x = ob.x + ob.hx + radius;
        else if (m === toNear) z = ob.z - ob.hz - radius;
        else z = ob.z + ob.hz + radius;
      }
    }
  }
  return { x, z };
}

/** True if a circle at (x,z) overlaps any obstacle or leaves the arena — used for projectiles. */
export function circleBlocked(x: number, z: number, radius: number, map: MapDef): boolean {
  const half = map.size / 2;
  if (Math.abs(x) > half || Math.abs(z) > half) return true;
  if (map.coastR && Math.hypot(x, z) > coastRadius(map.coastR, Math.atan2(x, z))) return true;
  for (const ob of nearbyObstacles(map, x, z)) {
    if (ob.kind === 'circle') {
      const minDist = ob.r + radius;
      const dx = x - ob.x;
      const dz = z - ob.z;
      if (dx * dx + dz * dz < minDist * minDist) return true;
    } else {
      const cx = clamp(x, ob.x - ob.hx, ob.x + ob.hx);
      const cz = clamp(z, ob.z - ob.hz, ob.z + ob.hz);
      const dx = x - cx;
      const dz = z - cz;
      if (dx * dx + dz * dz < radius * radius) return true;
    }
  }
  return false;
}
