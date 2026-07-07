import * as THREE from 'three';
import { clamp } from '@claudestorm/shared';

/** Orbit camera: yaw/pitch around the character, wheel zoom, WoW-style. */
export class CameraRig {
  yaw = 0;
  pitch = 0.55;
  dist = 11;

  applyLook(dx: number, dy: number, zoom: number): void {
    this.yaw -= dx * 0.0032;
    this.pitch = clamp(this.pitch + dy * 0.0032, 0.12, 1.25);
    this.dist = clamp(this.dist + zoom * 0.01, 5, 18);
  }

  update(camera: THREE.PerspectiveCamera, x: number, y: number, z: number): void {
    const horiz = this.dist * Math.cos(this.pitch);
    const height = this.dist * Math.sin(this.pitch);
    camera.position.set(
      x - Math.sin(this.yaw) * horiz,
      y + 1.6 + height,
      z - Math.cos(this.yaw) * horiz,
    );
    camera.lookAt(x, y + 1.6, z);
  }
}
