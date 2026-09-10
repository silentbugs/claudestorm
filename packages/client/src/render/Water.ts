import * as THREE from 'three';
import { SHARED_PARS, bindShared } from './shaderlib.js';

/**
 * Sea and lake surfaces. The water knows how deep it is at every pixel —
 * it reads the baked terrain height under itself — so it goes from clear
 * turquoise over the sand to deep blue, laps the shore with a soft alpha
 * edge, and breaks into animated foam bands where the bottom comes up.
 * Two scrolling normal-map layers make the sun glint and the sky reflect.
 */
export interface WaterSettings {
  fog: number;
  deep: number;
  shallow: number;
  skyTint: number;
  sunTint: number;
}

export function makeWaterMaterial(
  normals: THREE.Texture,
  opts: { alpha: number; transparent: boolean; sea?: { coastR: number } },
): THREE.ShaderMaterial {
  const mat = new THREE.ShaderMaterial({
    transparent: opts.transparent,
    side: opts.alpha < 1 ? THREE.DoubleSide : THREE.FrontSide,
    depthWrite: !opts.transparent,
    uniforms: {
      uNormals: { value: normals },
      uFogColor: { value: new THREE.Color() },
      uDeep: { value: new THREE.Color(0x0a1c33) },
      uShallow: { value: new THREE.Color(0x3fa3a8) },
      uSkyTint: { value: new THREE.Color(0x5c5c7a) },
      uSunTint: { value: new THREE.Color(0xffd08a) },
      uAlpha: { value: opts.alpha },
      uFogRange: { value: new THREE.Vector2(280, 920) },
      uCoastR: { value: opts.sea?.coastR ?? 0 },
    },
    vertexShader: /* glsl */ `
      ${SHARED_PARS}
      varying vec3 vWorld;
      varying vec3 vView;
      varying float vDist;
      void main() {
        vec3 p = position;
        vec4 world = modelMatrix * vec4( p, 1.0 );
        // Barely-there swell so the surface breathes without heaving.
        world.y += sin( world.x * 0.06 + uTime * 0.8 ) * 0.05 + cos( world.z * 0.05 + uTime * 0.6 ) * 0.04;
        vWorld = world.xyz;
        vView = cameraPosition - world.xyz;
        vec4 mv = viewMatrix * world;
        vDist = - mv.z;
        gl_Position = projectionMatrix * mv;
      }`,
    fragmentShader: /* glsl */ `
      ${SHARED_PARS}
      uniform sampler2D uNormals;
      uniform vec3 uFogColor;
      uniform vec3 uDeep;
      uniform vec3 uShallow;
      uniform vec3 uSkyTint;
      uniform vec3 uSunTint;
      uniform float uAlpha;
      uniform vec2 uFogRange;
      uniform float uCoastR;
      varying vec3 vWorld;
      varying vec3 vView;
      varying float vDist;
      // The island's irregular coastline (shared/maps coastRadius): the sea
      // exists only outside it, so sunken inland floors — the Undercroft,
      // the Pit, the smugglers' trench — stay dry.
      float coastRadiusAt( float angle ) {
        return uCoastR * ( 1.0 + 0.08 * sin( angle * 3.0 + 1.7 ) + 0.055 * sin( angle * 5.0 - 0.8 ) + 0.028 * sin( angle * 9.0 + 3.1 ) );
      }
      void main() {
        if ( uCoastR > 0.0 ) {
          float over = length( vWorld.xz ) - coastRadiusAt( atan( vWorld.x, vWorld.z ) );
          if ( over < -14.0 ) discard;
        }
        float ground = terrainHeightAt( vWorld.xz );
        float depth = max( vWorld.y - ground, 0.0 );
        vec3 n1 = texture2D( uNormals, vWorld.xz * 0.020 + vec2( uTime * 0.020, uTime * 0.014 ) ).xyz * 2.0 - 1.0;
        vec3 n2 = texture2D( uNormals, vWorld.xz * 0.055 - vec2( uTime * 0.016, uTime * 0.024 ) ).xyz * 2.0 - 1.0;
        // Calmer in the shallows: ripples flatten as the water thins out.
        float calm = mix( 0.55, 1.0, smoothstep( 0.0, 2.0, depth ) );
        vec3 n = normalize( vec3( ( n1.x + n2.x ) * calm, 3.2, ( n1.y + n2.y ) * calm ) );
        vec3 viewDir = normalize( vView );
        float fresnel = pow( 1.0 - max( dot( viewDir, n ), 0.0 ), 3.0 );
        vec3 body = mix( uShallow, uDeep, smoothstep( 0.0, 3.0, depth ) );
        vec3 col = mix( body, uSkyTint, fresnel * 0.8 );
        vec3 halfway = viewDir + uSunDir;
        halfway = dot( halfway, halfway ) > 1e-6 ? normalize( halfway ) : n;
        float spec = pow( max( dot( n, halfway ), 0.0 ), 90.0 );
        col += uSunTint * spec * 1.4;
        // Shoreline foam: a thin lace at the waterline, lapping in and out,
        // broken up by the noise atlas so it never reads as a solid ring.
        float foamN = texture2D( uNoise, vWorld.xz * 0.09 + vec2( uTime * 0.025, uTime * 0.018 ) ).r;
        float lap = 0.11 + 0.07 * sin( uTime * 1.3 + foamN * 6.0 );
        float shore = 1.0 - smoothstep( 0.0, lap, depth );
        float lace = smoothstep( 0.42, 0.7, foamN + shore * 0.35 ) * shore;
        float edge = ( 1.0 - smoothstep( 0.0, 0.05, depth ) ) * 0.4;
        float foam = clamp( lace + edge, 0.0, 1.0 );
        col = mix( col, mix( uSkyTint, vec3( 1.0 ), 0.65 ), foam * 0.8 );
        // Depth-based translucency, opaque out at sea; a soft alpha edge on the sand.
        float alpha = mix( 0.2, uAlpha, smoothstep( 0.0, 1.2, depth ) );
        alpha = max( alpha, foam * 0.85 );
        col = mix( col, uFogColor, smoothstep( uFogRange.x, uFogRange.y, vDist ) );
        gl_FragColor = vec4( col, alpha );
      }`,
  });
  bindShared(mat);
  return mat;
}

export function applyWaterSettings(mat: THREE.ShaderMaterial, s: WaterSettings, fogNear: number, fogFar: number): void {
  const u = mat.uniforms;
  (u.uFogColor!.value as THREE.Color).setHex(s.fog);
  (u.uDeep!.value as THREE.Color).setHex(s.deep);
  (u.uShallow!.value as THREE.Color).setHex(s.shallow);
  (u.uSkyTint!.value as THREE.Color).setHex(s.skyTint);
  (u.uSunTint!.value as THREE.Color).setHex(s.sunTint);
  (u.uFogRange!.value as THREE.Vector2).set(fogNear, fogFar);
}
