import * as THREE from 'three';
import { SHARED_PARS, bindShared } from './shaderlib.js';

/**
 * GPU meadow. One instanced draw of many three-blade tufts laid on a jittered
 * grid that snaps to the camera: every blade's world position, height,
 * color, wind bend, and reaction to a passing character is computed in the
 * vertex shader from the baked terrain textures. Nothing is touched on the
 * CPU per frame beyond a handful of uniforms, and the tuft grid is stable
 * across snaps (blades are keyed by world cell, not instance index), so the
 * meadow never swims. Blades fade out with distance before they turn into
 * shimmer, and a few percent of tufts carry a flower head.
 */
export interface GrassPreset {
  /** Draw radius around the camera in meters. */
  radius: number;
  /** Grid spacing in meters (one tuft per cell). */
  spacing: number;
}

const MAX_PUSHERS = 8;

export class GrassField {
  readonly mesh: THREE.Mesh;
  private readonly uniforms: {
    uOrigin: THREE.IUniform<THREE.Vector2>;
    uSpacing: THREE.IUniform<number>;
    uRadius: THREE.IUniform<number>;
    uPushers: THREE.IUniform<THREE.Vector4[]>;
    uSunColor: THREE.IUniform<THREE.Color>;
  };
  private readonly spacing: number;
  private readonly radius: number;

  constructor(preset: GrassPreset) {
    this.spacing = preset.spacing;
    this.radius = preset.radius;
    const n = Math.ceil((preset.radius * 2) / preset.spacing);
    const geo = buildTuftGeometry();
    const cells = new Float32Array(n * n * 2);
    for (let j = 0; j < n; j++) {
      for (let i = 0; i < n; i++) {
        cells[(j * n + i) * 2] = i;
        cells[(j * n + i) * 2 + 1] = j;
      }
    }
    geo.setAttribute('aCell', new THREE.InstancedBufferAttribute(cells, 2));
    geo.instanceCount = n * n;

    this.uniforms = {
      uOrigin: { value: new THREE.Vector2() },
      uSpacing: { value: preset.spacing },
      uRadius: { value: preset.radius },
      uPushers: { value: Array.from({ length: MAX_PUSHERS }, () => new THREE.Vector4(0, 0, 0, 0)) },
      uSunColor: { value: new THREE.Color(0xffffff) },
    };
    const material = new THREE.MeshLambertMaterial({ side: THREE.DoubleSide });
    const uniforms = this.uniforms;
    material.onBeforeCompile = (shader) => {
      bindShared(shader);
      Object.assign(shader.uniforms, uniforms);
      shader.vertexShader = shader.vertexShader
        .replace(
          '#include <common>',
          `#include <common>
          ${SHARED_PARS}
          attribute vec2 aCell;
          attribute float aBlade;
          uniform vec2 uOrigin;
          uniform float uSpacing;
          uniform float uRadius;
          uniform vec4 uPushers[${MAX_PUSHERS}];
          varying vec3 vTint;
          float hash12( vec2 p ) {
            vec3 p3 = fract( vec3( p.xyx ) * 0.1031 );
            p3 += dot( p3, p3.yzx + 33.33 );
            return fract( ( p3.x + p3.y ) * p3.z );
          }
          vec3 gPos;`,
        )
        .replace(
          '#include <beginnormal_vertex>',
          `vec2 cellWorld = uOrigin + aCell * uSpacing;
          vec2 cellId = floor( cellWorld / uSpacing + 0.5 );
          float r1 = hash12( cellId );
          float r2 = hash12( cellId + 17.3 );
          float r3 = hash12( cellId + 43.7 );
          float r4 = hash12( cellId + 91.1 );
          vec2 base = cellWorld + vec2( r1, r2 ) * uSpacing;
          vec2 tuv = terrainUv( base );
          float h = texture2D( uHeightMap, tuv ).r;
          vec4 tcol = texture2D( uTerrainColor, tuv );
          vec4 splat = texture2D( uSplat, tuv );
          float density = ( splat.r + splat.g * 0.35 ) * tcol.a;
          float grows = step( r3, density * 1.2 - 0.05 );
          float dist = distance( base, cameraPosition.xz );
          float fade = 1.0 - smoothstep( uRadius * 0.62, uRadius, dist );
          float tall = grows * fade * ( 0.55 + r4 * 0.6 ) * mix( 1.0, 0.7, splat.g );
          // Terrain normal from the heightmap; blades share one soft up-ish
          // normal so a tuft reads as a mass, not a fan of dark facets.
          float e = 1.6 / uTerrainSize;
          float hx = texture2D( uHeightMap, tuv + vec2( e, 0.0 ) ).r - h;
          float hz = texture2D( uHeightMap, tuv + vec2( 0.0, e ) ).r - h;
          vec3 tn = normalize( vec3( -hx, 1.6, -hz ) );
          vec3 objectNormal = normalize( tn + vec3( 0.0, 0.8, 0.0 ) );
          float t = position.y;
          float isFlower = step( 2.5, aBlade );
          float ang = r1 * 6.2831 + aBlade * 2.094;
          vec2 side = vec2( cos( ang ), sin( ang ) );
          float taper = 1.0 - t * t * 0.85;
          float width = ( 0.028 + r2 * 0.022 ) * taper;
          float height = 0.75 * tall;
          vec3 p = vec3( base.x + side.x * position.x * width, h + t * height, base.y + side.y * position.x * width );
          // Wind: bend grows with height squared, plus a per-tuft flutter.
          vec2 wind = windAt( base );
          float flutter = sin( uTime * 3.4 + r1 * 25.0 + base.x * 0.7 ) * 0.07;
          vec2 bend = ( wind * ( 0.8 + 0.4 * r4 ) + side * flutter ) * t * t * tall;
          // Characters push the blades away as they pass.
          for ( int i = 0; i < ${MAX_PUSHERS}; i++ ) {
            vec4 P = uPushers[ i ];
            vec2 d = base - P.xy;
            float l = length( d );
            float f = ( 1.0 - smoothstep( 0.0, P.z, l ) ) * P.w;
            bend += ( d / max( l, 0.05 ) ) * f * t * 1.1;
          }
          p.xz += bend;
          p.y -= dot( bend, bend ) * 0.35;
          // Flower heads: a small camera-facing quad on the center blade's tip.
          if ( isFlower > 0.5 ) {
            float bloom = step( 0.955, r3 ) * tall;
            vec3 right = vec3( viewMatrix[0][0], viewMatrix[1][0], viewMatrix[2][0] );
            vec3 up = vec3( viewMatrix[0][1], viewMatrix[1][1], viewMatrix[2][1] );
            float size = 0.06 * bloom;
            p = vec3( base.x, h + height * 1.02, base.y ) + vec3( bend.x, - dot( bend, bend ) * 0.35, bend.y )
              + right * position.x * size + up * position.z * size;
          }
          gPos = p;
          // Color: the ground's own tint, shaded dark at the root and bright
          // at the tip, with a little per-tuft hue jitter.
          vec3 tint = tcol.rgb * mix( 0.5, 1.5, t );
          tint *= vec3( 0.92 + r3 * 0.16, 0.95 + r2 * 0.1, 0.9 + r1 * 0.2 );
          tint = mix( tint, tint * vec3( 1.1, 0.95, 0.75 ), splat.g );
          if ( isFlower > 0.5 ) {
            float pick = r4 * 4.0;
            tint = pick < 1.0 ? vec3( 1.0, 0.95, 0.9 ) : pick < 2.0 ? vec3( 1.0, 0.85, 0.3 )
                 : pick < 3.0 ? vec3( 0.75, 0.45, 0.95 ) : vec3( 0.95, 0.35, 0.35 );
            tint *= 0.95;
          }
          vTint = tint;`,
        )
        .replace('#include <begin_vertex>', 'vec3 transformed = gPos;');
      shader.fragmentShader = shader.fragmentShader
        .replace(
          '#include <common>',
          `#include <common>
          ${SHARED_PARS}
          varying vec3 vTint;
          varying vec3 vGWorld;`,
        )
        .replace(
          '#include <color_fragment>',
          `#include <color_fragment>
          diffuseColor.rgb *= vTint;`,
        )
        // Blades are double-sided but share one up-facing normal: never flip
        // it for back faces, or half the meadow lights as if facing away.
        .replace(
          '#include <normal_fragment_begin>',
          `float faceDirection = gl_FrontFacing ? 1.0 : - 1.0;
          vec3 normal = normalize( vNormal );`,
        );
      // World position for the cloud shadow: Lambert has no world varying.
      shader.vertexShader = shader.vertexShader
        .replace('varying vec3 vTint;', 'varying vec3 vTint;\nvarying vec3 vGWorld;')
        .replace('vec3 transformed = gPos;', 'vec3 transformed = gPos;\nvGWorld = gPos;');
      shader.fragmentShader = shader.fragmentShader.replace(
        'diffuseColor.rgb *= vTint;',
        'diffuseColor.rgb *= vTint * cloudShadowAt( vGWorld );',
      );
    };
    material.customProgramCacheKey = () => 'grass';

    this.mesh = new THREE.Mesh(geo, material);
    this.mesh.frustumCulled = false;
    this.mesh.receiveShadow = true;
    this.mesh.castShadow = false;
    this.mesh.name = 'grass';
  }

  /** Re-center the tuft grid on the camera (snapped, so blades stay put). */
  update(camX: number, camZ: number): void {
    const s = this.spacing;
    this.uniforms.uOrigin.value.set(
      Math.floor((camX - this.radius) / s) * s,
      Math.floor((camZ - this.radius) / s) * s,
    );
  }

  /** Characters (x, z, radius, strength) that bend the blades this frame. */
  setPushers(pushers: { x: number; z: number; radius: number; strength: number }[]): void {
    const list = this.uniforms.uPushers.value;
    for (let i = 0; i < MAX_PUSHERS; i++) {
      const p = pushers[i];
      if (p) list[i]!.set(p.x, p.z, p.radius, p.strength);
      else list[i]!.set(0, 0, 0, 0);
    }
  }

  dispose(): void {
    this.mesh.geometry.dispose();
    (this.mesh.material as THREE.Material).dispose();
  }
}

/**
 * A tuft: three blades of two segments each fanned at 120°, plus a flower
 * quad (collapsed to nothing on most tufts). position.x = ±1 across the
 * blade, position.y = 0..1 up it; aBlade picks the blade (3 = flower).
 */
function buildTuftGeometry(): THREE.InstancedBufferGeometry {
  const positions: number[] = [];
  const blades: number[] = [];
  const index: number[] = [];
  const pushBlade = (blade: number): void => {
    const start = positions.length / 3;
    const levels = [0, 0.45, 0.8];
    for (const t of levels) {
      positions.push(-1, t, 0, 1, t, 0);
      blades.push(blade, blade);
    }
    positions.push(0, 1, 0);
    blades.push(blade);
    for (let l = 0; l < levels.length - 1; l++) {
      const a = start + l * 2;
      index.push(a, a + 1, a + 2, a + 1, a + 3, a + 2);
    }
    const top = start + (levels.length - 1) * 2;
    index.push(top, top + 1, start + levels.length * 2);
  };
  pushBlade(0);
  pushBlade(1);
  pushBlade(2);
  // Flower head: a hexagon fan in view space (x across, z up).
  const f = positions.length / 3;
  for (let k = 0; k < 6; k++) {
    const a = (k / 6) * Math.PI * 2;
    positions.push(Math.cos(a), 1, Math.sin(a));
    blades.push(3);
  }
  for (let k = 1; k < 5; k++) index.push(f, f + k, f + k + 1);

  const geo = new THREE.InstancedBufferGeometry();
  geo.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
  geo.setAttribute('aBlade', new THREE.Float32BufferAttribute(blades, 1));
  // A normal attribute keeps three.js's shader happy; the real one is computed.
  geo.setAttribute('normal', new THREE.Float32BufferAttribute(new Array(positions.length).fill(0), 3));
  geo.setIndex(index);
  return geo;
}
