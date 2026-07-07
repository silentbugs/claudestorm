export interface Vec2 {
  x: number;
  z: number;
}

export function len(x: number, z: number): number {
  return Math.hypot(x, z);
}

export function dist(ax: number, az: number, bx: number, bz: number): number {
  return Math.hypot(bx - ax, bz - az);
}

/** Returns a normalized copy; zero vectors stay zero. */
export function norm(x: number, z: number): Vec2 {
  const l = Math.hypot(x, z);
  if (l < 1e-8) return { x: 0, z: 0 };
  return { x: x / l, z: z / l };
}

export function clamp(v: number, lo: number, hi: number): number {
  return v < lo ? lo : v > hi ? hi : v;
}

export function lerp(a: number, b: number, t: number): number {
  return a + (b - a) * t;
}

/** Yaw so that an object with +Z forward looks from (x,z) toward (tx,tz). */
export function yawToward(x: number, z: number, tx: number, tz: number): number {
  return Math.atan2(tx - x, tz - z);
}
