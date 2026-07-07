import type { MapDef } from '../maps/arena.js';
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

  for (const ob of map.obstacles) {
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
  for (const ob of map.obstacles) {
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
