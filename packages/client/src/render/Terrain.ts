import * as THREE from 'three';
import { ARENA } from '@claudestorm/shared';
import type { DetailTextures } from './proctex.js';
import { SHARED_PARS, bindShared } from './shaderlib.js';
import { exactHeight, type TerrainData } from './TerrainData.js';

/**
 * The island's ground: a dense displaced grid wearing a splat-blended set of
 * hand-painted detail textures. The biome (macro tint + grass/dry/rock/sand
 * weights) comes from the baked terrain textures, so the ground, the grass
 * growing on it, and the foliage scattered over it all agree on what's
 * where. Details bump-map the surface from their own brightness, blend at
 * two scales so they never tile visibly, fade to a flat tint in the
 * distance (no shimmer), and darken under drifting cloud shadows.
 */
export function buildTerrain(
  data: TerrainData,
  details: DetailTextures,
  opts: { segments: number; pbr: boolean },
): THREE.Mesh {
  const geo = new THREE.PlaneGeometry(ARENA.size, ARENA.size, opts.segments, opts.segments);
  geo.rotateX(-Math.PI / 2);
  const pos = geo.attributes.position as THREE.BufferAttribute;
  for (let i = 0; i < pos.count; i++) pos.setY(i, exactHeight(pos.getX(i), pos.getZ(i)));
  geo.deleteAttribute('uv');
  geo.computeVertexNormals();

  const material = opts.pbr
    ? new THREE.MeshStandardMaterial({ roughness: 1, metalness: 0 })
    : new THREE.MeshLambertMaterial();
  const uniforms = {
    uGrassTex: { value: details.grass },
    uDryTex: { value: details.dry },
    uRockTex: { value: details.rock },
    uSandTex: { value: details.sand },
    uBumpScale: { value: 0.55 },
  };
  material.onBeforeCompile = (shader) => {
    bindShared(shader);
    Object.assign(shader.uniforms, uniforms);
    shader.vertexShader = shader.vertexShader
      .replace('#include <common>', '#include <common>\nvarying vec3 vTWorld;')
      .replace(
        '#include <worldpos_vertex>',
        '#include <worldpos_vertex>\nvTWorld = ( modelMatrix * vec4( transformed, 1.0 ) ).xyz;',
      );
    shader.fragmentShader = shader.fragmentShader
      .replace(
        '#include <common>',
        `#include <common>
        ${SHARED_PARS}
        varying vec3 vTWorld;
        uniform sampler2D uGrassTex;
        uniform sampler2D uDryTex;
        uniform sampler2D uRockTex;
        uniform sampler2D uSandTex;
        uniform float uBumpScale;
        float tLum = 0.5;
        float tBumpFade = 1.0;
        vec4 tSplat = vec4(1.0, 0.0, 0.0, 0.0);
        // Two-scale sampling: the second scale is irrational relative to the
        // first, so the repeat never lines up into a grid.
        vec3 detailAt( sampler2D tex, vec2 xz, float scale, float bomb ) {
          vec3 a = texture2D( tex, xz / scale ).rgb;
          vec3 b = texture2D( tex, xz / ( scale * 2.618 ) + vec2( 0.31, 0.77 ) ).rgb;
          return mix( a, b, bomb );
        }
        // Bump from a scalar height field's screen-space derivatives (the
        // three.js bumpmap chunk, inlined since no bump map is bound).
        // Guarded against degenerate derivatives: a NaN here would be smeared
        // into a black block by the bloom blur.
        vec3 perturbNormalTerrain( vec3 surf_pos, vec3 surf_norm, vec2 dHdxy, float faceDirection ) {
          vec3 sx = dFdx( surf_pos.xyz );
          vec3 sy = dFdy( surf_pos.xyz );
          if ( dot( sx, sx ) < 1e-12 || dot( sy, sy ) < 1e-12 ) return surf_norm;
          vec3 vSigmaX = normalize( sx );
          vec3 vSigmaY = normalize( sy );
          vec3 vN = surf_norm;
          vec3 R1 = cross( vSigmaY, vN );
          vec3 R2 = cross( vN, vSigmaX );
          float fDet = dot( vSigmaX, R1 ) * faceDirection;
          if ( abs( fDet ) < 1e-6 ) return surf_norm;
          vec3 vGrad = sign( fDet ) * ( dHdxy.x * R1 + dHdxy.y * R2 );
          vec3 n = abs( fDet ) * surf_norm - vGrad;
          return dot( n, n ) > 1e-12 ? normalize( n ) : surf_norm;
        }`,
      )
      .replace(
        '#include <map_fragment>',
        `{
          vec2 tuv = terrainUv( vTWorld.xz );
          tSplat = texture2D( uSplat, tuv );
          vec3 macro = texture2D( uTerrainColor, tuv ).rgb;
          float bomb = texture2D( uNoise, vTWorld.xz * 0.0031 ).r;
          bomb = smoothstep( 0.35, 0.65, bomb );
          vec3 g = detailAt( uGrassTex, vTWorld.xz, 3.6, bomb );
          vec3 d = detailAt( uDryTex, vTWorld.xz, 3.1, bomb );
          vec3 r = detailAt( uRockTex, vTWorld.xz, 9.0, bomb );
          vec3 s = detailAt( uSandTex, vTWorld.xz, 2.7, bomb );
          // Sharpen the transitions: the dominant layer wins a little extra.
          vec4 w = tSplat * tSplat * ( 1.0 + tSplat );
          w /= max( w.r + w.g + w.b + w.a, 1e-4 );
          vec3 detail = g * w.r + d * w.g + r * w.b + s * w.a;
          float camDist = distance( vTWorld, cameraPosition );
          float far = smoothstep( 120.0, 420.0, camDist );
          tBumpFade = 1.0 - smoothstep( 30.0, 110.0, camDist );
          detail = mix( detail, vec3( 0.5 ), far * 0.85 );
          tLum = dot( detail, vec3( 0.299, 0.587, 0.114 ) );
          // The macro tint sets the color; the detail sets the brightness and
          // lends a third of its own hue so rock reads gray under a green tint.
          vec3 albedo = macro * ( 0.8 + tLum * 1.5 );
          albedo = mix( albedo, detail * ( 0.7 + 1.2 * dot( macro, vec3( 0.333 ) ) ), 0.3 );
          albedo *= cloudShadowAt( vTWorld );
          diffuseColor.rgb *= albedo;
        }`,
      )
      .replace(
        '#include <normal_fragment_maps>',
        `{
          vec2 dHdxy = vec2( dFdx( tLum ), dFdy( tLum ) ) * uBumpScale * tBumpFade;
          normal = perturbNormalTerrain( - vViewPosition, normal, dHdxy, faceDirection );
        }`,
      )
      .replace(
        '#include <roughnessmap_fragment>',
        `float roughnessFactor = roughness * mix( 1.0, 0.72, tSplat.a + tSplat.b * 0.6 );`,
      );
  };
  material.customProgramCacheKey = () => (opts.pbr ? 'terrain-pbr' : 'terrain-lambert');

  const mesh = new THREE.Mesh(geo, material);
  mesh.receiveShadow = true;
  mesh.frustumCulled = false; // one mesh, always in view
  mesh.name = 'terrain';
  return mesh;
}
