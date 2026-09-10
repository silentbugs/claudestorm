import * as THREE from 'three';
import { SHARED_PARS, bindShared } from './shaderlib.js';

/**
 * Ambient motes: a cloud of tiny additive sparks drifting in a box around
 * the camera — pollen and dust by day, embers at dusk, fireflies at night.
 * Every mote lives in the vertex shader: its path is a noise-driven wander
 * wrapped inside the box, so the cloud follows the camera without ever
 * being rebuilt, and it fades at the box's edges so nothing pops.
 */
export class Motes {
  readonly mesh: THREE.Mesh;
  private readonly mat: THREE.ShaderMaterial;

  constructor(count: number, sprite: THREE.Texture) {
    const geo = new THREE.InstancedBufferGeometry();
    geo.setAttribute(
      'position',
      new THREE.Float32BufferAttribute([-1, -1, 0, 1, -1, 0, -1, 1, 0, 1, 1, 0], 3),
    );
    geo.setAttribute('uv', new THREE.Float32BufferAttribute([0, 0, 1, 0, 0, 1, 1, 1], 2));
    geo.setIndex([0, 1, 2, 1, 3, 2]);
    const seeds = new Float32Array(count * 4);
    for (let i = 0; i < count; i++) {
      seeds[i * 4] = Math.random();
      seeds[i * 4 + 1] = Math.random();
      seeds[i * 4 + 2] = Math.random();
      seeds[i * 4 + 3] = Math.random();
    }
    geo.setAttribute('aSeed', new THREE.InstancedBufferAttribute(seeds, 4));
    geo.instanceCount = count;

    this.mat = new THREE.ShaderMaterial({
      transparent: true,
      depthWrite: false,
      blending: THREE.AdditiveBlending,
      uniforms: {
        uSprite: { value: sprite },
        uColor: { value: new THREE.Color(0xfff2b0) },
        uIntensity: { value: 0.6 },
        uBox: { value: new THREE.Vector3(34, 14, 34) },
        uSize: { value: 0.09 },
        uRise: { value: 0.2 },
      },
      vertexShader: /* glsl */ `
        ${SHARED_PARS}
        attribute vec4 aSeed;
        uniform vec3 uBox;
        uniform float uSize;
        uniform float uRise;
        varying vec2 vUv;
        varying float vFade;
        void main() {
          vUv = uv;
          // A slow wander: each mote follows its own noise path through the box.
          float t = uTime * ( 0.05 + aSeed.w * 0.06 );
          vec3 wander = vec3(
            texture2D( uNoise, vec2( aSeed.x, t ) ).r,
            texture2D( uNoise, vec2( aSeed.y, t * 0.7 + 0.3 ) ).g,
            texture2D( uNoise, vec2( aSeed.z, t * 1.3 + 0.6 ) ).r ) - 0.5;
          vec3 local = ( aSeed.xyz - 0.5 ) * uBox + wander * uBox * 0.6;
          local.y += uTime * uRise * ( 0.5 + aSeed.w );
          // Wrap inside the camera box, then fade toward its faces.
          vec3 rel = mod( local + uBox * 0.5, uBox ) - uBox * 0.5;
          vec3 world = cameraPosition + rel;
          vec3 edge = 1.0 - abs( rel ) / ( uBox * 0.5 );
          vFade = smoothstep( 0.0, 0.25, min( edge.x, min( edge.y, edge.z ) ) );
          // Height above the terrain: motes hover over the ground, not under it.
          float ground = terrainHeightAt( world.xz );
          world.y = max( world.y, ground + 0.4 + aSeed.y * 2.0 );
          float twinkle = 0.55 + 0.45 * sin( uTime * ( 2.0 + aSeed.x * 3.0 ) + aSeed.z * 20.0 );
          vFade *= twinkle;
          vec4 mv = viewMatrix * vec4( world, 1.0 );
          float size = uSize * ( 0.6 + aSeed.w * 0.8 );
          mv.xy += position.xy * size;
          gl_Position = projectionMatrix * mv;
        }`,
      fragmentShader: /* glsl */ `
        uniform sampler2D uSprite;
        uniform vec3 uColor;
        uniform float uIntensity;
        varying vec2 vUv;
        varying float vFade;
        void main() {
          float a = texture2D( uSprite, vUv ).a;
          gl_FragColor = vec4( uColor * uIntensity * a * vFade, a * vFade );
        }`,
    });
    bindShared(this.mat);
    this.mesh = new THREE.Mesh(geo, this.mat);
    this.mesh.frustumCulled = false;
    this.mesh.renderOrder = 5;
    this.mesh.name = 'motes';
  }

  apply(color: number, intensity: number, size: number, rise: number): void {
    (this.mat.uniforms.uColor!.value as THREE.Color).setHex(color);
    this.mat.uniforms.uIntensity!.value = intensity;
    this.mat.uniforms.uSize!.value = size;
    this.mat.uniforms.uRise!.value = rise;
  }

  dispose(): void {
    this.mesh.geometry.dispose();
    this.mat.dispose();
  }
}
