import * as THREE from 'three';
import { ARENA } from '@claudestorm/shared';

/**
 * Uniform objects shared by every custom shader in the scene. They're the
 * same JS objects everywhere, so SceneManager sets `uTime.value` once per
 * frame and the sky, water, grass, terrain, foliage, and storm wall all see
 * it — nothing walks a material list.
 */
export const SHARED = {
  uTime: { value: 0 },
  /** RGBA tileable noise atlas (see proctex.makeNoiseTexture). */
  uNoise: { value: null as THREE.Texture | null },
  /** xy = wind direction, z = strength (m of bend), w = gust scale. */
  uWind: { value: new THREE.Vector4(0.8, 0.6, 0.35, 1) },
  /** xy = cloud drift (uv/s), z = shadow darkness, w = uv per world meter. */
  uCloudShadow: { value: new THREE.Vector4(0.004, 0.0025, 0.22, 0.0016) },
  /** The height the cloud layer's shadow is projected from. */
  uCloudHeight: { value: 140 },
  uSunDir: { value: new THREE.Vector3(0.55, 0.5, 0.32).normalize() },
  uTerrainSize: { value: ARENA.size },
  uHeightMap: { value: null as THREE.Texture | null },
  uTerrainColor: { value: null as THREE.Texture | null },
  uSplat: { value: null as THREE.Texture | null },
};

/** GLSL declarations for the shared uniforms (paste into `pars` sections). */
export const SHARED_PARS = /* glsl */ `
uniform float uTime;
uniform sampler2D uNoise;
uniform vec4 uWind;
uniform vec4 uCloudShadow;
uniform float uCloudHeight;
uniform vec3 uSunDir;
uniform float uTerrainSize;
uniform sampler2D uHeightMap;
uniform sampler2D uTerrainColor;
uniform sampler2D uSplat;

vec2 terrainUv(vec2 worldXZ) { return worldXZ / uTerrainSize + 0.5; }

/** Height of the baked terrain under a world xz (deep sea outside the bake). */
float terrainHeightAt(vec2 worldXZ) {
  vec2 uv = terrainUv(worldXZ);
  vec2 inside = step(vec2(0.0), uv) * step(uv, vec2(1.0));
  float h = texture2D(uHeightMap, uv).r;
  return mix(-30.0, h, inside.x * inside.y);
}

/**
 * Wind at a world xz: a steady breeze modulated by rolling gust bands from
 * the noise atlas and a travelling wave along the wind direction. Returns
 * the horizontal bend in meters for a 1m stalk.
 */
vec2 windAt(vec2 worldXZ) {
  vec2 dir = uWind.xy;
  float along = dot(worldXZ, dir);
  float gust = texture2D(uNoise, worldXZ * 0.006 * uWind.w - dir * uTime * 0.045).g;
  float wave = sin(along * 0.22 - uTime * 2.1) * 0.5 + 0.5;
  return dir * uWind.z * (0.3 + gust * 1.1 + wave * 0.35);
}

/**
 * Cloud shadow factor (1 = sunlit) at a world position, projected along
 * the sun direction from the cloud layer so it lines up with the clouds the
 * sky dome draws — the same noise, the same drift.
 */
float cloudShadowAt(vec3 world) {
  vec2 at = world.xz + uSunDir.xz / max(uSunDir.y, 0.2) * (uCloudHeight - world.y);
  vec2 uv = at * uCloudShadow.w + uCloudShadow.xy * uTime;
  float n = texture2D(uNoise, uv).r * 0.7 + texture2D(uNoise, uv * 2.7 + 0.37).g * 0.3;
  return 1.0 - smoothstep(0.5, 0.72, n) * uCloudShadow.z;
}
`;

/** Bind the shared uniforms into a material's compiled shader. */
export function bindShared(shader: { uniforms: Record<string, THREE.IUniform> }): void {
  Object.assign(shader.uniforms, SHARED);
}

/**
 * Fresnel rim glow on a lit material: an emissive halo along silhouette
 * edges in the given color, which the bloom pass then picks up. The hero
 * constructs are made of storm energy — this is what makes them look lit
 * from within instead of painted.
 */
export function addRimGlow(
  material: THREE.MeshStandardMaterial,
  color: THREE.Color,
  strength = 0.6,
  power = 2.6,
): { color: THREE.Color; strength: { value: number } } {
  const uRim = { value: color };
  const uRimStrength = { value: strength };
  material.onBeforeCompile = (shader) => {
    shader.uniforms.uRim = uRim;
    shader.uniforms.uRimStrength = uRimStrength;
    shader.fragmentShader = shader.fragmentShader
      .replace(
        '#include <common>',
        `#include <common>
        uniform vec3 uRim;
        uniform float uRimStrength;`,
      )
      .replace(
        '#include <emissivemap_fragment>',
        `#include <emissivemap_fragment>
        {
          vec3 rimN = normalize( vNormal );
          vec3 rimV = normalize( vViewPosition );
          float rim = pow( 1.0 - max( dot( rimN, rimV ), 0.0 ), ${power.toFixed(1)} );
          totalEmissiveRadiance += uRim * rim * uRimStrength;
        }`,
      );
  };
  material.customProgramCacheKey = () => `rim${power.toFixed(1)}`;
  return { color: uRim.value, strength: uRimStrength };
}
