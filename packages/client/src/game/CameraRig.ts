import * as THREE from 'three';
import { ARENA, clamp, groundHeight } from '@claudestorm/shared';

/**
 * Orbit camera, WoW-style: right-drag turns the character (camera follows),
 * left-drag orbits the camera around the character without turning them.
 */
export class CameraRig {
  /** Character facing. Right-mouse look steers this. */
  yaw = 0;
  /** Extra camera-only yaw from left-mouse orbiting. */
  orbit = 0;
  pitch = 0.55;
  dist = 11;

  /** Where the camera actually looks from. */
  get camYaw(): number {
    return this.yaw + this.orbit;
  }

  /** Right-mouse look: turn the character and camera together. */
  applyLook(dx: number, dy: number, zoom: number): void {
    this.yaw -= dx * 0.0032;
    // Negative pitch lets the camera dip below head height (and below a
    // lake's surface); the terrain clamp keeps it out of the ground.
    this.pitch = clamp(this.pitch + dy * 0.0032, -0.55, 1.25);
    this.dist = clamp(this.dist + zoom * 0.01, 5, 18);
  }

  /** Left-mouse orbit: swing the camera only; the character keeps facing. */
  applyOrbit(dx: number, dy: number): void {
    this.orbit -= dx * 0.0032;
    this.pitch = clamp(this.pitch + dy * 0.0032, -0.55, 1.25);
  }

  /** Engaging right-mouse turns the character to where the camera looks (WoW). */
  foldOrbit(): void {
    this.yaw += this.orbit;
    this.orbit = 0;
  }

  /** Boom length after terrain collision, smoothed so it never pops outward. */
  private boomDist = 11;

  update(camera: THREE.PerspectiveCamera, x: number, y: number, z: number, dt: number): void {
    const px = x;
    const py = y + 1.6;
    const pz = z;
    const ox = -Math.sin(this.camYaw) * Math.cos(this.pitch);
    const oy = Math.sin(this.pitch);
    const oz = -Math.cos(this.camYaw) * Math.cos(this.pitch);
    // WoW-style camera collision: when the boom would dip into terrain, it
    // shortens (zooms toward the head) instead of riding up over the slope.
    // That keeps the camera inside lake bowls, so it can actually submerge.
    const STEPS = 16;
    let allowed = this.dist;
    for (let i = 1; i <= STEPS; i++) {
      const d = (i / STEPS) * this.dist;
      const floor = groundHeight(ARENA, px + ox * d, pz + oz * d) + 0.35;
      if (py + oy * d < floor) {
        allowed = ((i - 1) / STEPS) * this.dist;
        break;
      }
    }
    allowed = Math.max(1.6, allowed);
    // Snap inward instantly (never clip), ease back out.
    this.boomDist =
      allowed < this.boomDist ? allowed : Math.min(allowed, this.boomDist + dt * 14);
    camera.position.set(
      px + ox * this.boomDist,
      py + oy * this.boomDist,
      pz + oz * this.boomDist,
    );
    camera.lookAt(px, py, pz);
  }
}
