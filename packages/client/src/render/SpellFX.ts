import * as THREE from 'three';
import { ELEMENT_PALETTE, type Element } from '../elements.js';
import { SHARED, bindShared } from './shaderlib.js';

/*
 * Bespoke spell visuals in the Plunderstorm mold — every spell gets a look
 * of its own beyond a tinted flash: Star Bomb's meteor actually falls,
 * Earthbreaker heaves rock spikes out of the ground, Windstorm is a
 * tornado, Toxic Smackerel is a fish. Everything here is built from shared
 * geometries and cheap shaders; per-instance state is a handful of
 * uniforms or transforms, never fresh geometry.
 */

/** A live effect: the scene object plus how it animates and when it dies. */
export interface FxHandle {
  obj: THREE.Object3D;
  /** Seconds to live; the owner removes and disposes it when it runs out. */
  ttl: number;
  age: number;
  /** Per-frame animation with normalized progress `t` in [0, 1]. */
  tick: (t: number, dt: number) => void;
  /** Owned materials/geometries to dispose. */
  dispose: () => void;
}

const Y_AXIS = new THREE.Vector3(0, 1, 0);

/* ── Cast sigil: a rune ring under the caster in the spell's element color ── */

const SIGIL_GEO = new THREE.CircleGeometry(1, 48);
SIGIL_GEO.rotateX(-Math.PI / 2);

function sigilMaterial(color: number): THREE.ShaderMaterial {
  const mat = new THREE.ShaderMaterial({
    transparent: true,
    depthWrite: false,
    blending: THREE.AdditiveBlending,
    uniforms: { uColor: { value: new THREE.Color(color) }, uFade: { value: 1 }, uSpin: { value: 0 } },
    vertexShader: /* glsl */ `
      varying vec2 vUv;
      void main() {
        vUv = uv;
        gl_Position = projectionMatrix * modelViewMatrix * vec4( position, 1.0 );
      }`,
    fragmentShader: /* glsl */ `
      uniform vec3 uColor;
      uniform float uFade;
      uniform float uSpin;
      varying vec2 vUv;
      void main() {
        vec2 p = vUv * 2.0 - 1.0;
        float r = length( p );
        float a = atan( p.y, p.x + 1e-5 ); // never atan(0,0): NaN on some GPUs
        // Outer and inner rings, a band of rune ticks spinning between them,
        // and three orbiting points.
        float outer = smoothstep( 0.04, 0.0, abs( r - 0.92 ) - 0.015 );
        float inner = smoothstep( 0.03, 0.0, abs( r - 0.62 ) - 0.01 );
        float band = step( 0.7, r ) * step( r, 0.84 );
        float ticks = step( 0.55, fract( a * 3.8197 + uSpin ) ) * step( 0.45, fract( a * 11.459 - uSpin * 2.0 ) );
        float dots = 0.0;
        for ( int i = 0; i < 3; i++ ) {
          float da = uSpin * 1.5 + float( i ) * 2.0944;
          vec2 q = vec2( cos( da ), sin( da ) ) * 0.92;
          dots += smoothstep( 0.09, 0.0, distance( p, q ) );
        }
        float glowFill = ( 1.0 - smoothstep( 0.0, 0.62, r ) ) * 0.18;
        float m = outer + inner + band * ticks * 0.8 + dots + glowFill;
        gl_FragColor = vec4( uColor * 1.6, m * uFade * step( r, 1.0 ) );
      }`,
  });
  return mat;
}

/** A sigil that lives under a caster; the owner moves it and sets fade. */
export function makeSigil(color: number, radius: number): { mesh: THREE.Mesh; mat: THREE.ShaderMaterial } {
  const mat = sigilMaterial(color);
  const mesh = new THREE.Mesh(SIGIL_GEO, mat);
  mesh.scale.setScalar(radius);
  mesh.renderOrder = 4;
  return { mesh, mat };
}

/* ── Star Bomb: a meteor that falls onto the telegraph for its whole wind-up ── */

const METEOR_GEO = new THREE.OctahedronGeometry(0.55, 0);
const METEOR_TAIL_GEO = new THREE.ConeGeometry(0.5, 6, 10, 1, true);
METEOR_TAIL_GEO.translate(0, 3, 0);

export function meteor(x: number, groundY: number, z: number, seconds: number, glowSprite: THREE.Texture): FxHandle {
  const group = new THREE.Group();
  const core = new THREE.MeshBasicMaterial({ color: new THREE.Color(ELEMENT_PALETTE.arcane.glow).multiplyScalar(2.2) });
  const tail = new THREE.MeshBasicMaterial({
    color: ELEMENT_PALETTE.arcane.core,
    transparent: true,
    opacity: 0.55,
    blending: THREE.AdditiveBlending,
    depthWrite: false,
    side: THREE.DoubleSide,
  });
  const halo = new THREE.SpriteMaterial({
    map: glowSprite,
    color: ELEMENT_PALETTE.arcane.glow,
    transparent: true,
    blending: THREE.AdditiveBlending,
    depthWrite: false,
  });
  const rock = new THREE.Mesh(METEOR_GEO, core);
  const streak = new THREE.Mesh(METEOR_TAIL_GEO, tail);
  const sprite = new THREE.Sprite(halo);
  sprite.scale.setScalar(3.2);
  group.add(rock, streak, sprite);
  // Comes in at a slant so the tail reads against the sky.
  const startY = groundY + 34;
  const startX = x - 9;
  const startZ = z + 4;
  group.position.set(startX, startY, startZ);
  const dir = new THREE.Vector3(x - startX, groundY - startY, z - startZ).normalize();
  streak.quaternion.setFromUnitVectors(Y_AXIS, dir.clone().negate());
  return {
    obj: group,
    ttl: seconds,
    age: 0,
    tick: (t) => {
      const e = t * t; // accelerates
      group.position.set(startX + (x - startX) * e, startY + (groundY + 0.6 - startY) * e, startZ + (z - startZ) * e);
      rock.rotation.x += 0.3;
      rock.rotation.y += 0.21;
      const s = 0.6 + t * 0.9;
      rock.scale.setScalar(s);
      sprite.scale.setScalar(2.4 + t * 2.6);
      tail.opacity = 0.25 + t * 0.5;
    },
    dispose: () => {
      core.dispose();
      tail.dispose();
      halo.dispose();
    },
  };
}

/* ── Shockwave: an expanding ground ring ── */

const SHOCK_GEO = new THREE.TorusGeometry(1, 0.08, 6, 48);
SHOCK_GEO.rotateX(Math.PI / 2);

export function shockwave(x: number, y: number, z: number, radius: number, color: number, seconds = 0.45): FxHandle {
  const mat = new THREE.MeshBasicMaterial({
    color: new THREE.Color(color).multiplyScalar(1.6),
    transparent: true,
    opacity: 0.9,
    blending: THREE.AdditiveBlending,
    depthWrite: false,
  });
  const mesh = new THREE.Mesh(SHOCK_GEO, mat);
  mesh.position.set(x, y + 0.25, z);
  return {
    obj: mesh,
    ttl: seconds,
    age: 0,
    tick: (t) => {
      const r = 0.3 + radius * (1 - (1 - t) * (1 - t));
      mesh.scale.set(r, 1 + t * 1.2, r);
      mat.opacity = 0.9 * (1 - t);
    },
    dispose: () => mat.dispose(),
  };
}

/* ── Earthbreaker / Quaking Leap: rock spikes heave out of the ground ── */

const SPIKE_GEO = new THREE.ConeGeometry(0.35, 1, 5);
SPIKE_GEO.translate(0, 0.5, 0);
const SPIKE_MAT = new THREE.MeshStandardMaterial({ color: 0x8a6a46, roughness: 0.95, flatShading: true });
const SPIKE_HOT_MAT = new THREE.MeshStandardMaterial({
  color: 0x8a6a46,
  roughness: 0.9,
  flatShading: true,
  emissive: ELEMENT_PALETTE.earth.glow,
  emissiveIntensity: 0.5,
});

export function rockSpikes(x: number, groundAt: (x: number, z: number) => number, z: number, radius: number, count: number, seconds = 1.6): FxHandle {
  const group = new THREE.Group();
  const spikes: { mesh: THREE.Mesh; h: number; delay: number }[] = [];
  for (let i = 0; i < count; i++) {
    const a = (i / count) * Math.PI * 2 + Math.random() * 0.6;
    const d = radius * (0.25 + Math.random() * 0.7);
    const sx = x + Math.sin(a) * d;
    const sz = z + Math.cos(a) * d;
    const mesh = new THREE.Mesh(SPIKE_GEO, i % 3 === 0 ? SPIKE_HOT_MAT : SPIKE_MAT);
    const h = 0.8 + Math.random() * 1.4;
    mesh.position.set(sx, groundAt(sx, sz) - 0.05, sz);
    mesh.rotation.set((Math.random() - 0.5) * 0.7, Math.random() * Math.PI, (Math.random() - 0.5) * 0.7);
    mesh.scale.set(0.6 + Math.random() * 0.6, 0.001, 0.6 + Math.random() * 0.6);
    mesh.castShadow = true;
    group.add(mesh);
    spikes.push({ mesh, h, delay: Math.random() * 0.12 });
  }
  return {
    obj: group,
    ttl: seconds,
    age: 0,
    tick: (t) => {
      for (const s of spikes) {
        // Snap up in the first tenth, hold, then sink away.
        const up = Math.min(1, Math.max(0, (t - s.delay) / 0.08));
        const sink = Math.max(0, (t - 0.65) / 0.35);
        s.mesh.scale.y = Math.max(0.001, s.h * (1 - (1 - up) * (1 - up)) * (1 - sink * sink));
      }
    },
    dispose: () => {},
  };
}

/* ── Crack decal: a dark fracture star that lingers on the ground ── */

const CRACK_GEO = new THREE.CircleGeometry(1, 32);
CRACK_GEO.rotateX(-Math.PI / 2);

export function crackDecal(x: number, y: number, z: number, radius: number, glowColor: number, seconds = 2.4): FxHandle {
  const mat = new THREE.ShaderMaterial({
    transparent: true,
    depthWrite: false,
    uniforms: { uGlow: { value: new THREE.Color(glowColor) }, uFade: { value: 1 }, uSeed: { value: Math.random() * 10 } },
    vertexShader: /* glsl */ `
      varying vec2 vUv;
      void main() {
        vUv = uv;
        gl_Position = projectionMatrix * modelViewMatrix * vec4( position, 1.0 );
      }`,
    fragmentShader: /* glsl */ `
      uniform vec3 uGlow;
      uniform float uFade;
      uniform float uSeed;
      varying vec2 vUv;
      void main() {
        vec2 p = vUv * 2.0 - 1.0;
        float r = length( p );
        float a = atan( p.y, p.x + 1e-5 );
        // Seven jagged fissures radiating from the center.
        float spokes = abs( sin( a * 3.5 + sin( r * 9.0 + uSeed ) * 0.6 + uSeed ) );
        float crack = smoothstep( 0.985, 1.0, spokes ) * ( 1.0 - smoothstep( 0.55, 1.0, r ) );
        float rim = ( 1.0 - smoothstep( 0.0, 0.2, r ) ) * 0.6;
        float dark = ( crack + rim ) * 0.85;
        vec3 col = mix( vec3( 0.05, 0.03, 0.02 ), uGlow, crack * 0.5 * uFade );
        gl_FragColor = vec4( col, dark * uFade * step( r, 1.0 ) );
      }`,
  });
  const mesh = new THREE.Mesh(CRACK_GEO, mat);
  mesh.position.set(x, y + 0.08, z);
  mesh.scale.setScalar(radius);
  mesh.renderOrder = 1;
  return {
    obj: mesh,
    ttl: seconds,
    age: 0,
    tick: (t) => {
      mat.uniforms.uFade!.value = 1 - t * t;
    },
    dispose: () => mat.dispose(),
  };
}

/* ── Windstorm: a tornado funnel with debris ── */

const FUNNEL_GEO = new THREE.CylinderGeometry(1.7, 0.3, 3.4, 24, 6, true);
FUNNEL_GEO.translate(0, 1.7, 0);
const FUNNEL_MAT = new THREE.ShaderMaterial({
  transparent: true,
  depthWrite: false,
  side: THREE.DoubleSide,
  blending: THREE.AdditiveBlending,
  uniforms: {},
  vertexShader: /* glsl */ `
    varying vec2 vUv;
    void main() {
      vUv = uv;
      gl_Position = projectionMatrix * modelViewMatrix * vec4( position, 1.0 );
    }`,
  fragmentShader: /* glsl */ `
    uniform float uTime;
    uniform sampler2D uNoise;
    varying vec2 vUv;
    void main() {
      // Bands of vapor spiraling up the funnel.
      float swirl = vUv.x * 3.0 + vUv.y * 2.5 - uTime * 3.0;
      float n = texture2D( uNoise, vec2( fract( swirl ), vUv.y * 0.8 - uTime * 0.6 ) ).r;
      float band = smoothstep( 0.35, 0.75, n );
      float edge = sin( vUv.y * 3.14159 );
      gl_FragColor = vec4( vec3( 0.8, 1.0, 0.95 ) * 1.4, band * edge * 0.8 + 0.06 * edge );
    }`,
});
bindShared(FUNNEL_MAT);
const DEBRIS_GEO = new THREE.BoxGeometry(0.12, 0.12, 0.12);
const DEBRIS_MAT = new THREE.MeshBasicMaterial({ color: 0x8a7a5a });

/** The Windstorm projectile body — animated by the owner via anim(now). */
export function tornado(): { obj: THREE.Object3D; anim: (now: number) => void } {
  const group = new THREE.Group();
  const funnel = new THREE.Mesh(FUNNEL_GEO, FUNNEL_MAT);
  funnel.position.y = -1.1;
  group.add(funnel);
  const debris: THREE.Mesh[] = [];
  for (let i = 0; i < 6; i++) {
    const d = new THREE.Mesh(DEBRIS_GEO, DEBRIS_MAT);
    debris.push(d);
    group.add(d);
  }
  return {
    obj: group,
    anim: (now) => {
      funnel.rotation.y = now * 9;
      funnel.scale.set(1 + Math.sin(now * 7) * 0.06, 1, 1 + Math.cos(now * 6) * 0.06);
      debris.forEach((d, i) => {
        const a = now * (6 + i) + i * 1.3;
        const h = ((now * 0.9 + i * 0.37) % 1) * 3.2 - 1.1;
        const r = 0.35 + (h + 1.1) * 0.45;
        d.position.set(Math.sin(a) * r, h, Math.cos(a) * r);
        d.rotation.set(a, a * 0.7, 0);
      });
    },
  };
}

/* ── Toxic Smackerel: the fish ── */

const FISH_BODY_GEO = new THREE.SphereGeometry(0.3, 10, 8);
FISH_BODY_GEO.scale(1.7, 1, 0.7);
const FISH_TAIL_GEO = new THREE.ConeGeometry(0.25, 0.35, 4);
FISH_TAIL_GEO.rotateZ(Math.PI / 2);
FISH_TAIL_GEO.scale(1, 1.6, 0.3);
const FISH_MAT = new THREE.MeshStandardMaterial({ color: 0x6fce4a, roughness: 0.4, metalness: 0.2, emissive: 0x2a6a1a, emissiveIntensity: 0.4 });
const FISH_EYE_MAT = new THREE.MeshBasicMaterial({ color: 0x111111 });

/** A fish whipped through a front arc, then gone. */
export function fishSlap(x: number, y: number, z: number, facing: number, seconds = 0.4): FxHandle {
  const pivot = new THREE.Group();
  pivot.position.set(x, y + 1.0, z);
  pivot.rotation.y = facing;
  const fish = new THREE.Group();
  const body = new THREE.Mesh(FISH_BODY_GEO, FISH_MAT);
  const tail = new THREE.Mesh(FISH_TAIL_GEO, FISH_MAT);
  tail.position.x = -0.6;
  const eye = new THREE.Mesh(new THREE.SphereGeometry(0.05, 6, 5), FISH_EYE_MAT);
  eye.position.set(0.3, 0.1, 0.18);
  fish.add(body, tail, eye);
  fish.position.set(0.55, 0, 1.0); // held out in front, right hand
  fish.rotation.z = 0.4;
  pivot.add(fish);
  return {
    obj: pivot,
    ttl: seconds,
    age: 0,
    tick: (t) => {
      // Wind back, then whip across the front arc.
      const swing = t < 0.3 ? -0.5 * (t / 0.3) : -0.5 + 2.6 * ((t - 0.3) / 0.7);
      pivot.rotation.y = facing + swing;
      fish.rotation.x = Math.sin(t * 30) * 0.3;
      const s = 1 + Math.sin(Math.PI * t) * 0.35;
      fish.scale.setScalar(s);
    },
    dispose: () => eye.geometry.dispose(),
  };
}

/* ── Snowdrift: snowflakes drifting down over the pool ── */

const SNOW_MAT = new THREE.ShaderMaterial({
  transparent: true,
  depthWrite: false,
  uniforms: { uRadius: { value: 4 }, uSprite: { value: null as THREE.Texture | null }, uTime: SHARED.uTime },
  vertexShader: /* glsl */ `
    attribute vec3 aSeed;
    uniform float uRadius;
    uniform float uTime;
    varying float vAlpha;
    void main() {
      float fall = fract( aSeed.z + uTime * 0.28 );
      float r = sqrt( aSeed.x ) * uRadius;
      float a = aSeed.y * 6.2831 + fall * 1.5;
      vec3 p = vec3( cos( a ) * r, 3.2 * ( 1.0 - fall ), sin( a ) * r );
      p.x += sin( uTime * 1.7 + aSeed.y * 30.0 ) * 0.25;
      vAlpha = smoothstep( 0.0, 0.1, fall ) * ( 1.0 - smoothstep( 0.85, 1.0, fall ) );
      vec4 mv = modelViewMatrix * vec4( p, 1.0 );
      gl_PointSize = ( 6.0 + aSeed.z * 6.0 ) * ( 40.0 / max( 1.0, - mv.z ) );
      gl_Position = projectionMatrix * mv;
    }`,
  fragmentShader: /* glsl */ `
    uniform sampler2D uSprite;
    varying float vAlpha;
    void main() {
      float a = texture2D( uSprite, gl_PointCoord ).a * vAlpha;
      gl_FragColor = vec4( vec3( 1.2, 1.3, 1.4 ), a );
    }`,
});

/** Snow falling over a zone; the owner removes it when the zone ends. */
export function snowfall(x: number, y: number, z: number, radius: number, glowSprite: THREE.Texture): THREE.Points {
  const count = 70;
  const seeds = new Float32Array(count * 3);
  for (let i = 0; i < seeds.length; i++) seeds[i] = Math.random();
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.Float32BufferAttribute(new Float32Array(count * 3), 3));
  geo.setAttribute('aSeed', new THREE.Float32BufferAttribute(seeds, 3));
  const mat = SNOW_MAT.clone();
  mat.uniforms.uRadius!.value = radius;
  mat.uniforms.uSprite!.value = glowSprite;
  mat.uniforms.uTime = SHARED.uTime;
  const points = new THREE.Points(geo, mat);
  points.position.set(x, y, z);
  points.frustumCulled = false;
  return points;
}

/* ── Explosive Caltrops: spiked jacks scattered on the pool ── */

const CALTROP_GEO = (() => {
  const spike = new THREE.ConeGeometry(0.05, 0.28, 4);
  spike.translate(0, 0.14, 0);
  const parts: THREE.BufferGeometry[] = [];
  const dirs = [
    new THREE.Vector3(0, 1, 0),
    new THREE.Vector3(0.94, -0.33, 0),
    new THREE.Vector3(-0.47, -0.33, 0.82),
    new THREE.Vector3(-0.47, -0.33, -0.82),
  ];
  for (const d of dirs) {
    const g = spike.clone();
    g.applyQuaternion(new THREE.Quaternion().setFromUnitVectors(Y_AXIS, d));
    parts.push(g);
  }
  const merged = new THREE.BufferGeometry();
  // Simple concatenation (all parts share the attribute set).
  let total = 0;
  for (const p of parts) total += p.attributes.position!.count;
  const pos = new Float32Array(total * 3);
  const nor = new Float32Array(total * 3);
  let off = 0;
  for (const p of parts) {
    const pp = p.attributes.position as THREE.BufferAttribute;
    const pn = p.attributes.normal as THREE.BufferAttribute;
    for (let i = 0; i < pp.count; i++) {
      pos[(off + i) * 3] = pp.getX(i);
      pos[(off + i) * 3 + 1] = pp.getY(i);
      pos[(off + i) * 3 + 2] = pp.getZ(i);
      nor[(off + i) * 3] = pn.getX(i);
      nor[(off + i) * 3 + 1] = pn.getY(i);
      nor[(off + i) * 3 + 2] = pn.getZ(i);
    }
    off += pp.count;
  }
  merged.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  merged.setAttribute('normal', new THREE.BufferAttribute(nor, 3));
  merged.translate(0, 0.16, 0);
  return merged;
})();
const CALTROP_MAT = new THREE.MeshStandardMaterial({ color: 0x5a5e6a, roughness: 0.5, metalness: 0.7, emissive: 0xff5a1e, emissiveIntensity: 0.35 });

export function caltrops(x: number, groundAt: (x: number, z: number) => number, z: number, radius: number): THREE.Group {
  const group = new THREE.Group();
  for (let i = 0; i < 9; i++) {
    const a = (i / 9) * Math.PI * 2 + Math.random();
    const d = radius * (0.2 + Math.random() * 0.7);
    const cx = x + Math.sin(a) * d;
    const cz = z + Math.cos(a) * d;
    const c = new THREE.Mesh(CALTROP_GEO, CALTROP_MAT);
    c.position.set(cx, groundAt(cx, cz), cz);
    c.rotation.y = Math.random() * Math.PI;
    c.castShadow = true;
    group.add(c);
  }
  return group;
}

/* ── Steel Traps: bear traps lying open in the grass ── */

const TRAP_RING_GEO = new THREE.TorusGeometry(1, 0.07, 6, 28);
TRAP_RING_GEO.rotateX(Math.PI / 2);
const TRAP_TOOTH_GEO = new THREE.ConeGeometry(0.06, 0.26, 4);
TRAP_TOOTH_GEO.translate(0, 0.13, 0);
const TRAP_MAT = new THREE.MeshStandardMaterial({ color: 0x9aa0ae, roughness: 0.45, metalness: 0.8 });
const TRAP_PLATE_GEO = new THREE.CylinderGeometry(0.28, 0.28, 0.05, 12);

export function bearTrap(x: number, y: number, z: number, radius: number): THREE.Group {
  const group = new THREE.Group();
  const ring = new THREE.Mesh(TRAP_RING_GEO, TRAP_MAT);
  ring.scale.set(radius, 1, radius);
  ring.position.y = 0.06;
  group.add(ring);
  // Two rows of teeth along the hinge line, splayed open.
  for (let side = -1; side <= 1; side += 2) {
    for (let k = 0; k < 6; k++) {
      const tooth = new THREE.Mesh(TRAP_TOOTH_GEO, TRAP_MAT);
      const t = (k / 5 - 0.5) * 1.7 * radius;
      tooth.position.set(t, 0.08, side * 0.45 * radius);
      tooth.rotation.x = side * 0.9;
      group.add(tooth);
    }
  }
  const plate = new THREE.Mesh(TRAP_PLATE_GEO, TRAP_MAT);
  plate.position.y = 0.05;
  group.add(plate);
  group.position.set(x, y, z);
  group.rotation.y = Math.random() * Math.PI;
  return group;
}

/* ── Hunter's Chains: a chain of links between two points ── */

const LINK_GEO = new THREE.TorusGeometry(0.16, 0.045, 6, 12);
const LINK_MAT = new THREE.MeshStandardMaterial({ color: 0xd0d4de, roughness: 0.4, metalness: 0.85 });

export function chainLine(from: THREE.Vector3, to: THREE.Vector3, seconds = 0.35): FxHandle {
  const group = new THREE.Group();
  const dir = to.clone().sub(from);
  const len = dir.length();
  dir.normalize();
  const count = Math.min(40, Math.max(2, Math.floor(len / 0.28)));
  const q = new THREE.Quaternion().setFromUnitVectors(new THREE.Vector3(0, 0, 1), dir);
  const links: THREE.Mesh[] = [];
  for (let i = 0; i < count; i++) {
    const link = new THREE.Mesh(LINK_GEO, LINK_MAT);
    link.position.copy(from).addScaledVector(dir, (i + 0.5) * (len / count));
    link.quaternion.copy(q);
    link.rotateZ((i % 2) * (Math.PI / 2));
    link.rotateX(Math.PI / 2);
    group.add(link);
    links.push(link);
  }
  return {
    obj: group,
    ttl: seconds,
    age: 0,
    tick: (t) => {
      // Reels in from the target end, sagging a little in the middle.
      const reel = t * t;
      links.forEach((l, i) => {
        const f = (i + 0.5) / count;
        l.visible = f > reel;
        l.position.copy(from).addScaledVector(dir, f * len);
        l.position.y += Math.sin(f * Math.PI) * -0.35 * (1 - t);
      });
    },
    dispose: () => {},
  };
}

/* ── Electric / arcane ward: a bubble alive with crawling arcs ── */

export function wardMaterial(): THREE.ShaderMaterial {
  const mat = new THREE.ShaderMaterial({
    transparent: true,
    depthWrite: false,
    blending: THREE.AdditiveBlending,
    uniforms: { uColor: { value: new THREE.Color(ELEMENT_PALETTE.electric.core) }, uArcs: { value: 1 } },
    vertexShader: /* glsl */ `
      varying vec3 vNormalW;
      varying vec3 vViewDir;
      varying vec3 vLocal;
      void main() {
        vLocal = position;
        vec4 world = modelMatrix * vec4( position, 1.0 );
        vNormalW = normalize( mat3( modelMatrix ) * normal );
        vViewDir = normalize( cameraPosition - world.xyz );
        gl_Position = projectionMatrix * viewMatrix * world;
      }`,
    fragmentShader: /* glsl */ `
      uniform vec3 uColor;
      uniform float uArcs;
      uniform float uTime;
      uniform sampler2D uNoise;
      varying vec3 vNormalW;
      varying vec3 vViewDir;
      varying vec3 vLocal;
      void main() {
        float fres = pow( clamp( 1.0 - abs( dot( normalize( vNormalW ), normalize( vViewDir ) ) ), 0.0, 1.0 ), 2.5 );
        // Crawling arcs: thin ridges of a scrolling noise field.
        vec2 uv = vec2( atan( vLocal.z, vLocal.x + 1e-5 ) * 0.6, vLocal.y * 0.8 ) + uTime * vec2( 0.15, 0.4 );
        float n = texture2D( uNoise, uv ).r;
        float arc = smoothstep( 0.035, 0.0, abs( n - 0.5 ) ) * uArcs;
        float flicker = 0.8 + 0.2 * sin( uTime * 40.0 + vLocal.y * 10.0 );
        vec3 col = uColor * ( fres * 0.9 + 0.05 ) + vec3( 1.0 ) * arc * flicker * 1.4;
        gl_FragColor = vec4( col, fres * 0.4 + 0.04 + arc * 0.6 );
      }`,
  });
  bindShared(mat);
  return mat;
}

/* ── Fire Whirl: flame tongues orbiting the caster ── */

const TONGUE_GEO = new THREE.LatheGeometry(
  [
    [0.02, 0], [0.16, 0.08], [0.2, 0.25], [0.14, 0.45], [0.06, 0.62], [0, 0.72],
  ].map(([r, y]) => new THREE.Vector2(r!, y!)),
  10,
);
const TONGUE_MAT = new THREE.MeshBasicMaterial({
  color: new THREE.Color(ELEMENT_PALETTE.fire.core).multiplyScalar(1.8),
  transparent: true,
  opacity: 0.9,
  blending: THREE.AdditiveBlending,
  depthWrite: false,
});
const TONGUE_HOT_MAT = new THREE.MeshBasicMaterial({
  color: new THREE.Color(ELEMENT_PALETTE.fire.glow).multiplyScalar(2.2),
  transparent: true,
  opacity: 0.9,
  blending: THREE.AdditiveBlending,
  depthWrite: false,
});

/** The whirl body: attach to a character, call anim() while active. */
export function fireWhirl(): { obj: THREE.Group; anim: (now: number, radius: number) => void } {
  const group = new THREE.Group();
  const tongues: THREE.Mesh[] = [];
  for (let i = 0; i < 7; i++) {
    const t = new THREE.Mesh(TONGUE_GEO, i % 2 ? TONGUE_HOT_MAT : TONGUE_MAT);
    t.scale.setScalar(1.4);
    group.add(t);
    tongues.push(t);
  }
  const ring = new THREE.Mesh(SHOCK_GEO, new THREE.MeshBasicMaterial({
    color: new THREE.Color(ELEMENT_PALETTE.fire.deep!).multiplyScalar(1.4),
    transparent: true,
    opacity: 0.5,
    blending: THREE.AdditiveBlending,
    depthWrite: false,
  }));
  ring.position.y = 0.15;
  group.add(ring);
  return {
    obj: group,
    anim: (now, radius) => {
      ring.scale.set(radius, 1, radius);
      tongues.forEach((t, i) => {
        const a = now * 5.5 + (i / tongues.length) * Math.PI * 2;
        const r = radius * (0.8 + 0.12 * Math.sin(now * 9 + i));
        t.position.set(Math.sin(a) * r, 0.2 + 0.15 * Math.sin(now * 13 + i * 2), Math.cos(a) * r);
        t.rotation.set(0.4 * Math.sin(now * 11 + i), -a, 0.3);
        const flick = 1 + 0.25 * Math.sin(now * 17 + i * 1.7);
        t.scale.set(1.4, 1.6 * flick, 1.4);
      });
    },
  };
}

/* ── Storm Archon: jagged lightning around the core ── */

export function lightningArcs(count = 3, segments = 6, reach = 0.55): { obj: THREE.Group; anim: (now: number) => void } {
  const group = new THREE.Group();
  const mat = new THREE.LineBasicMaterial({ color: new THREE.Color(ELEMENT_PALETTE.electric.glow).multiplyScalar(2), transparent: true, opacity: 0.9 });
  const lines: { line: THREE.Line; pos: THREE.BufferAttribute }[] = [];
  for (let i = 0; i < count; i++) {
    const geo = new THREE.BufferGeometry();
    const pos = new THREE.BufferAttribute(new Float32Array((segments + 1) * 3), 3);
    pos.setUsage(THREE.DynamicDrawUsage);
    geo.setAttribute('position', pos);
    const line = new THREE.Line(geo, mat);
    group.add(line);
    lines.push({ line, pos });
  }
  let last = -1;
  return {
    obj: group,
    anim: (now) => {
      // Re-jitter every few frames so the arcs crackle instead of sliding.
      const frame = Math.floor(now * 24);
      if (frame === last) return;
      last = frame;
      for (const { pos } of lines) {
        const dx = (Math.random() - 0.5) * 2;
        const dy = (Math.random() - 0.5) * 2;
        const dz = (Math.random() - 0.5) * 2;
        for (let s = 0; s <= segments; s++) {
          const f = s / segments;
          pos.setXYZ(
            s,
            dx * f * reach + (Math.random() - 0.5) * 0.15,
            dy * f * reach + (Math.random() - 0.5) * 0.15,
            dz * f * reach + (Math.random() - 0.5) * 0.15,
          );
        }
        pos.needsUpdate = true;
      }
    },
  };
}

/* ── Pillar of light: level-ups, chest pops ── */

const PILLAR_GEO = new THREE.CylinderGeometry(0.6, 1.1, 1, 16, 1, true);
PILLAR_GEO.translate(0, 0.5, 0);

export function lightPillar(x: number, y: number, z: number, color: number, height: number, seconds = 0.9): FxHandle {
  const mat = new THREE.ShaderMaterial({
    transparent: true,
    depthWrite: false,
    side: THREE.DoubleSide,
    blending: THREE.AdditiveBlending,
    uniforms: { uColor: { value: new THREE.Color(color) }, uFade: { value: 1 }, uTime: SHARED.uTime },
    vertexShader: /* glsl */ `
      varying vec2 vUv;
      void main() {
        vUv = uv;
        gl_Position = projectionMatrix * modelViewMatrix * vec4( position, 1.0 );
      }`,
    fragmentShader: /* glsl */ `
      uniform vec3 uColor;
      uniform float uFade;
      uniform float uTime;
      varying vec2 vUv;
      void main() {
        float rays = 0.7 + 0.3 * sin( vUv.x * 40.0 + uTime * 6.0 );
        float a = pow( clamp( 1.0 - vUv.y, 0.0, 1.0 ), 1.4 ) * rays * uFade;
        gl_FragColor = vec4( uColor * 1.8, a * 0.7 );
      }`,
  });
  const mesh = new THREE.Mesh(PILLAR_GEO, mat);
  mesh.position.set(x, y, z);
  mesh.scale.set(1, height, 1);
  return {
    obj: mesh,
    ttl: seconds,
    age: 0,
    tick: (t) => {
      mat.uniforms.uFade!.value = 1 - t;
      mesh.scale.set(1 + t * 0.6, height, 1 + t * 0.6);
    },
    dispose: () => mat.dispose(),
  };
}

/** Element palette helper for effect colors. */
export function elementGlow(element: Element): number {
  return ELEMENT_PALETTE[element].glow;
}
