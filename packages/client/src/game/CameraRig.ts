import * as THREE from 'three';
import { clamp } from '@claudestorm/shared';

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
    this.pitch = clamp(this.pitch + dy * 0.0032, 0.12, 1.25);
    this.dist = clamp(this.dist + zoom * 0.01, 5, 18);
  }

  /** Left-mouse orbit: swing the camera only; the character keeps facing. */
  applyOrbit(dx: number, dy: number): void {
    this.orbit -= dx * 0.0032;
    this.pitch = clamp(this.pitch + dy * 0.0032, 0.12, 1.25);
  }

  /** Engaging right-mouse turns the character to where the camera looks (WoW). */
  foldOrbit(): void {
    this.yaw += this.orbit;
    this.orbit = 0;
  }

  update(camera: THREE.PerspectiveCamera, x: number, y: number, z: number): void {
    const horiz = this.dist * Math.cos(this.pitch);
    const height = this.dist * Math.sin(this.pitch);
    camera.position.set(
      x - Math.sin(this.camYaw) * horiz,
      y + 1.6 + height,
      z - Math.cos(this.camYaw) * horiz,
    );
    camera.lookAt(x, y + 1.6, z);
  }
}
