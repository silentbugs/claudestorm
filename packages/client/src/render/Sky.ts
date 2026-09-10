import * as THREE from 'three';
import { SHARED_PARS, bindShared } from './shaderlib.js';

/**
 * The sky dome: a gradient with a warm sun-side glow, a sun (or moon) disc
 * bright enough to bloom, a drifting cloud layer painted from the shared
 * noise atlas — the very same lookup the ground uses for its cloud
 * shadows, so the shadows on the meadow belong to the clouds overhead —
 * and a field of twinkling stars that only the night preset switches on.
 * The dome follows the camera every frame.
 */
export interface SkySettings {
  zenith: number;
  horizon: number;
  glow: number;
  glowStrength: number;
  /** Disc color and HDR intensity (sun by day, moon by night). */
  disc: number;
  discIntensity: number;
  discSize: number;
  cloudColor: number;
  cloudShade: number;
  cloudCover: number;
  cloudOpacity: number;
  stars: number;
}

export class SkyDome {
  readonly mesh: THREE.Mesh;
  private readonly mat: THREE.ShaderMaterial;

  constructor() {
    this.mat = new THREE.ShaderMaterial({
      side: THREE.BackSide,
      depthWrite: false,
      fog: false,
      uniforms: {
        uZenith: { value: new THREE.Color() },
        uHorizon: { value: new THREE.Color() },
        uGlowColor: { value: new THREE.Color() },
        uGlowStrength: { value: 0.5 },
        uDisc: { value: new THREE.Color() },
        uDiscIntensity: { value: 1 },
        uDiscSize: { value: 0.9995 },
        uCloudColor: { value: new THREE.Color() },
        uCloudShade: { value: new THREE.Color() },
        uCloudCover: { value: 0.5 },
        uCloudOpacity: { value: 0.8 },
        uStars: { value: 0 },
      },
      vertexShader: /* glsl */ `
        varying vec3 vDir;
        void main() {
          vDir = position;
          vec4 mv = modelViewMatrix * vec4( position, 1.0 );
          gl_Position = projectionMatrix * mv;
        }`,
      fragmentShader: /* glsl */ `
        ${SHARED_PARS}
        uniform vec3 uZenith;
        uniform vec3 uHorizon;
        uniform vec3 uGlowColor;
        uniform float uGlowStrength;
        uniform vec3 uDisc;
        uniform float uDiscIntensity;
        uniform float uDiscSize;
        uniform vec3 uCloudColor;
        uniform vec3 uCloudShade;
        uniform float uCloudCover;
        uniform float uCloudOpacity;
        uniform float uStars;
        varying vec3 vDir;

        float hash13( vec3 p3 ) {
          p3 = fract( p3 * 0.1031 );
          p3 += dot( p3, p3.zyx + 31.32 );
          return fract( ( p3.x + p3.y ) * p3.z );
        }

        void main() {
          vec3 dir = normalize( vDir );
          float up = clamp( dir.y, 0.0, 1.0 );
          vec3 col = mix( uHorizon, uZenith, smoothstep( 0.0, 0.55, up ) );
          // Haze band hugging the horizon.
          col = mix( col, uHorizon * 1.06, pow( 1.0 - up, 7.0 ) * 0.5 );
          float sunDot = dot( dir, uSunDir );
          col += uGlowColor * pow( max( sunDot, 0.0 ), 14.0 ) * uGlowStrength;
          col += uGlowColor * pow( max( sunDot, 0.0 ), 3.0 ) * uGlowStrength * 0.22;

          // Stars: sparse bright cells on a fine 3D lattice, twinkling.
          if ( uStars > 0.0 && dir.y > 0.0 ) {
            vec3 sp = dir * 220.0;
            vec3 cell = floor( sp );
            vec3 f = fract( sp ) - 0.5;
            float h = hash13( cell );
            float star = smoothstep( 0.975, 1.0, h ) * ( 1.0 - smoothstep( 0.0, 0.32, length( f ) ) );
            float twinkle = 0.65 + 0.35 * sin( uTime * 2.5 + h * 60.0 );
            col += vec3( 0.9, 0.95, 1.0 ) * star * twinkle * uStars * smoothstep( 0.0, 0.2, dir.y ) * 1.6;
          }

          // Sun / moon disc, HDR so the bloom pass haloes it.
          float disc = smoothstep( uDiscSize, uDiscSize + 0.0004, sunDot );
          col += uDisc * disc * uDiscIntensity;

          // Cloud layer: the shared noise projected onto a plane overhead.
          if ( dir.y > 0.015 ) {
            float k = uCloudHeight / dir.y;
            vec2 at = cameraPosition.xz + dir.xz * k;
            vec2 uv = at * uCloudShadow.w + uCloudShadow.xy * uTime;
            float n = texture2D( uNoise, uv ).r * 0.7 + texture2D( uNoise, uv * 2.7 + 0.37 ).g * 0.3;
            float cov = smoothstep( 0.5 - uCloudCover * 0.12, 0.72, n );
            float thick = smoothstep( 0.55, 0.85, n );
            // Lit on the sun side, shaded underneath where the cloud is thick.
            float lit = 0.55 + 0.45 * max( sunDot, 0.0 );
            vec3 cloud = mix( uCloudColor * lit, uCloudShade, thick * 0.75 );
            cloud = mix( cloud, uCloudColor * 1.15, uGlowStrength * pow( max( sunDot, 0.0 ), 6.0 ) * ( 1.0 - thick ) );
            float horizonFade = smoothstep( 0.015, 0.18, dir.y );
            col = mix( col, cloud, cov * horizonFade * uCloudOpacity );
          }
          gl_FragColor = vec4( col, 1.0 );
        }`,
    });
    bindShared(this.mat);
    this.mesh = new THREE.Mesh(new THREE.SphereGeometry(1000, 32, 16), this.mat);
    this.mesh.frustumCulled = false;
    this.mesh.name = 'sky';
  }

  apply(s: SkySettings): void {
    const u = this.mat.uniforms;
    (u.uZenith!.value as THREE.Color).setHex(s.zenith);
    (u.uHorizon!.value as THREE.Color).setHex(s.horizon);
    (u.uGlowColor!.value as THREE.Color).setHex(s.glow);
    u.uGlowStrength!.value = s.glowStrength;
    (u.uDisc!.value as THREE.Color).setHex(s.disc);
    u.uDiscIntensity!.value = s.discIntensity;
    u.uDiscSize!.value = s.discSize;
    (u.uCloudColor!.value as THREE.Color).setHex(s.cloudColor);
    (u.uCloudShade!.value as THREE.Color).setHex(s.cloudShade);
    u.uCloudCover!.value = s.cloudCover;
    u.uCloudOpacity!.value = s.cloudOpacity;
    u.uStars!.value = s.stars;
  }
}
