import * as THREE from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import {
  ABILITIES,
  ARENA,
  ITEMS,
  MOB_MAX_LEVEL,
  PLAYER_SPEED,
  groundHeight,
  lerp,
  type AbilityId,
  type GameEvent,
  type Rarity,
  type Snapshot,
} from '@claudestorm/shared';
import { ABILITY_ELEMENT, ELEMENT_PALETTE, elementKeyOf, elementOf, type Element } from '../elements.js';
import { sfx } from '../sfx.js';
import type { AssetLibrary } from './assets.js';
import { addRimGlow } from './shaderlib.js';
import { iconCanvas, type IconKind } from '../ui/icons.js';
import {
  bearTrap,
  caltrops,
  chainLine,
  crackDecal,
  fireWhirl,
  fishSlap,
  lightningArcs,
  lightPillar,
  makeSigil,
  meteor,
  rockSpikes,
  shockwave,
  snowfall,
  tornado,
  wardMaterial,
  type FxHandle,
} from './SpellFX.js';
import {
  archonArcs,
  chicken,
  launchPad,
  mechanoHog,
  rocketFlame,
  searingAxe,
  smokeCloud,
  type Attachment,
} from './Accessories.js';

/** Motion trails a character can leave: a dash's wind, faeform's sparkle, an arc's vapor, a roll's dust. */
export type TrailKind = 'wind' | 'fae' | 'air' | 'roll';

/**
 * Draw distances for small entities (players are always drawn). A critter at
 * 300m is a couple of pixels and already deep in the fog; culling it there
 * keeps a far look from paying draw calls for the entire island's wildlife
 * and loot.
 */
const MOB_DRAW_DIST = 230;
const CHEST_DRAW_DIST = 230;
const PICKUP_DRAW_DIST = 150;
/** Other players cull too — at 380m in the fog a cloud is a smudge of pixels. */
const PLAYER_DRAW_DIST = 380;

const SELF_COLOR = 0x4da6ff;
const BOT_COLOR = 0xd9534f;
/** A teammate reads as "not a threat" at a glance — distinct from both your own blue and enemy red. */
const ALLY_COLOR = 0x3ec9a7;
const DEAD_COLOR = 0x50505a;
const SLOW_COLOR = 0x9fd8ff;
const MOB_COLOR = 0x8a6b3d;
const ELITE_COLOR = 0x9c3f3f;
const SWING_DURATION = 0.28;
/** Unlit glow bits render brighter than white so the bloom pass haloes them. */
const VISOR_HDR = 2.4;
/** How far a character bends the grass, and how hard. */
const GRASS_PUSH_RADIUS = 1.4;
const GRASS_PUSH = 0.55;

export const RARITY_COLORS: Record<Rarity, number> = {
  common: 0xb8b5a5,
  uncommon: 0x4bc26b,
  rare: 0x4d9be6,
  epic: 0xb05df0,
};

/** Painted spell/item icons as sprite textures, so drops show what they are at a glance. */
const iconTextures = new Map<string, THREE.Texture>();
function iconTexture(kind: IconKind, id: string): THREE.Texture {
  const key = `${kind}:${id}`;
  let tex = iconTextures.get(key);
  if (!tex) {
    tex = new THREE.CanvasTexture(iconCanvas(kind, id));
    tex.colorSpace = THREE.SRGBColorSpace;
    tex.anisotropy = 4;
    iconTextures.set(key, tex);
  }
  return tex;
}

/** Small per-element particle shapes for spawnElementBurst — one geometry per motif, scattered per-instance. */
const EMBER_GEO = new THREE.TetrahedronGeometry(0.12);
const SHARD_GEO = new THREE.OctahedronGeometry(0.15, 0);
const CHUNK_GEO = new THREE.BoxGeometry(0.22, 0.22, 0.22);
const MOTE_GEO = new THREE.SphereGeometry(0.12, 6, 5);
const LEAF_GEO = new THREE.PlaneGeometry(0.18, 0.3);
const RAY_GEO = new THREE.BoxGeometry(0.05, 0.05, 0.4);

/**
 * Per-element particle motifs for spawnElementBurst: fire flicks up in warm
 * embers, frost scatters icy shards, electric snaps out as jittery bolts,
 * earth pops chunky debris, nature swirls leaves, holy radiates rays, arcane
 * scatters glowing motes, shadow's motes collapse inward instead of out,
 * wind streaks low and fast, physical kicks up plain debris.
 */
const ELEMENT_PARTICLE_SPEC: Record<
  Element,
  {
    geo: THREE.BufferGeometry;
    count: number;
    speed: number;
    rise: number;
    spin: number;
    ttl: number;
    growth: number;
    inward?: boolean;
  }
> = {
  fire: { geo: EMBER_GEO, count: 7, speed: 2.2, rise: 1.9, spin: 6, ttl: 0.5, growth: 0.4 },
  frost: { geo: SHARD_GEO, count: 6, speed: 3.0, rise: -0.5, spin: 4, ttl: 0.45, growth: 0.3 },
  electric: { geo: RAY_GEO, count: 6, speed: 6.5, rise: 0, spin: 0, ttl: 0.14, growth: 0.8 },
  earth: { geo: CHUNK_GEO, count: 6, speed: 2.4, rise: 2.3, spin: 5, ttl: 0.5, growth: 0.25 },
  nature: { geo: LEAF_GEO, count: 7, speed: 1.7, rise: 1.0, spin: 7, ttl: 0.6, growth: 0.2 },
  holy: { geo: RAY_GEO, count: 8, speed: 3.4, rise: 0.5, spin: 0, ttl: 0.3, growth: 1.3 },
  arcane: { geo: MOTE_GEO, count: 6, speed: 1.6, rise: 0.9, spin: 8, ttl: 0.5, growth: 0.4 },
  shadow: { geo: MOTE_GEO, count: 6, speed: 2.8, rise: 0.2, spin: 3, ttl: 0.4, growth: -0.7, inward: true },
  wind: { geo: RAY_GEO, count: 5, speed: 6.5, rise: 0, spin: 0, ttl: 0.18, growth: 0.5 },
  physical: { geo: CHUNK_GEO, count: 5, speed: 2.0, rise: 0.6, spin: 5, ttl: 0.35, growth: 0.2 },
};

const PROJECTILE_COLORS: Partial<Record<AbilityId, number>> = {
  rimeArrow: ELEMENT_PALETTE.frost.glow,
  holyShield: ELEMENT_PALETTE.holy.glow,
  stormArchon: ELEMENT_PALETTE.electric.core,
  manaSphere: ELEMENT_PALETTE.arcane.core,
  huntersChains: ELEMENT_PALETTE.physical.glow,
  windstorm: ELEMENT_PALETTE.wind.glow,
  celestialBarrage: ELEMENT_PALETTE.arcane.glow,
};

/** Ground circles tinted per spell [outline, fill]; unlisted fall back by kind. */
const ZONE_COLORS: Partial<Record<AbilityId, [number, number]>> = {
  snowdrift: [ELEMENT_PALETTE.frost.glow, ELEMENT_PALETTE.frost.core],
  rimeArrow: [ELEMENT_PALETTE.frost.glow, ELEMENT_PALETTE.frost.core],
  starBomb: [ELEMENT_PALETTE.arcane.glow, ELEMENT_PALETTE.arcane.core],
  earthbreaker: [ELEMENT_PALETTE.earth.glow, ELEMENT_PALETTE.earth.core],
  toxicSmackerel: [ELEMENT_PALETTE.nature.glow, ELEMENT_PALETTE.nature.core],
  explosiveCaltrops: [ELEMENT_PALETTE.fire.glow, ELEMENT_PALETTE.fire.deep!],
};

/*
 * Shared unit geometries for everything transient. Effects and zones fire
 * constantly (every swing, hit, and endgame lightning); building a fresh
 * BufferGeometry per spawn uploads to the GPU each time and, undisposed,
 * accumulates for the whole match — the source of mid-fight lag spikes.
 * These are built once and scaled per instance instead.
 */
const FLASH_GEO = new THREE.SphereGeometry(1, 12, 10);
const BURST_GEO = new THREE.CylinderGeometry(1, 1, 0.6, 32, 1, true);
const COLUMN_GEO = new THREE.CylinderGeometry(1, 0.4, 1, 8);
const MELEE_ARC = (Math.PI * 2) / 3;
const MELEE_GEO = new THREE.RingGeometry(1.1, 2.5, 18, 1, -Math.PI / 2 - MELEE_ARC / 2, MELEE_ARC);
const ZONE_RING_GEO = new THREE.RingGeometry(0.94, 1, 48);
const ZONE_FILL_GEO = new THREE.CircleGeometry(1, 48);
const X_AXIS = new THREE.Vector3(1, 0, 0);
const Y_AXIS = new THREE.Vector3(0, 1, 0);
const tmpQuat = new THREE.Quaternion();

/** Shared, cached materials for things whose look never animates per instance. */
const gemMats = new Map<Rarity, THREE.MeshStandardMaterial>();
function gemMaterial(rarity: Rarity): THREE.MeshStandardMaterial {
  let mat = gemMats.get(rarity);
  if (!mat) {
    mat = new THREE.MeshStandardMaterial({
      color: RARITY_COLORS[rarity],
      emissive: RARITY_COLORS[rarity],
      emissiveIntensity: 1.3,
      roughness: 0.3,
    });
    gemMats.set(rarity, mat);
  }
  return mat;
}

const iconMats = new Map<string, THREE.SpriteMaterial>();
function iconMaterial(kind: IconKind, id: string): THREE.SpriteMaterial {
  const key = `${kind}:${id}`;
  let mat = iconMats.get(key);
  if (!mat) {
    mat = new THREE.SpriteMaterial({ map: iconTexture(kind, id), transparent: true, depthWrite: false });
    iconMats.set(key, mat);
  }
  return mat;
}

/**
 * Loot beams: a soft additive pillar of light in the drop's rarity color,
 * so a scroll on the ground reads from across the field (Plunderstorm's
 * own tell). One cached shader per rarity; the geometry is shared.
 */
const BEAM_GEO = new THREE.CylinderGeometry(0.28, 0.42, 7, 10, 1, true);
BEAM_GEO.translate(0, 3.5, 0);
const beamMats = new Map<Rarity, THREE.ShaderMaterial>();
function beamMaterial(rarity: Rarity): THREE.ShaderMaterial {
  let mat = beamMats.get(rarity);
  if (!mat) {
    mat = new THREE.ShaderMaterial({
      transparent: true,
      depthWrite: false,
      side: THREE.DoubleSide,
      blending: THREE.AdditiveBlending,
      uniforms: { uColor: { value: new THREE.Color(RARITY_COLORS[rarity]) }, uTime: { value: 0 } },
      vertexShader: /* glsl */ `
        varying vec2 vUv;
        void main() {
          vUv = uv;
          gl_Position = projectionMatrix * modelViewMatrix * vec4( position, 1.0 );
        }`,
      fragmentShader: /* glsl */ `
        uniform vec3 uColor;
        uniform float uTime;
        varying vec2 vUv;
        void main() {
          // MSAA can extrapolate uv past 1 at edges; pow of a negative is NaN.
          float fade = pow( clamp( 1.0 - vUv.y, 0.0, 1.0 ), 1.6 );
          float ripple = 0.85 + 0.15 * sin( vUv.y * 30.0 - uTime * 4.0 );
          gl_FragColor = vec4( uColor * 1.3, fade * ripple * 0.55 );
        }`,
    });
    beamMats.set(rarity, mat);
  }
  return mat;
}

/** Soft additive glow sprite (hover lights, chest sparkles); the texture is injected by the scene. */
let glowTexture: THREE.Texture | null = null;
function makeGlow(color: number, size: number, opacity: number): THREE.Sprite {
  const mat = new THREE.SpriteMaterial({
    map: glowTexture,
    color,
    transparent: true,
    opacity,
    depthWrite: false,
    blending: THREE.AdditiveBlending,
  });
  const sprite = new THREE.Sprite(mat);
  sprite.scale.set(size, size, 1);
  return sprite;
}

/** Terrain height under a world position — everything dynamic stands on the hills. */
export function groundAt(x: number, z: number): number {
  return groundHeight(ARENA, x, z);
}

function lerpAngle(a: number, b: number, t: number): number {
  let d = (b - a) % (Math.PI * 2);
  if (d > Math.PI) d -= Math.PI * 2;
  if (d < -Math.PI) d += Math.PI * 2;
  return a + d * t;
}

function makeBar(width: number): { group: THREE.Group; fill: THREE.Mesh } {
  const bg = new THREE.Mesh(
    new THREE.PlaneGeometry(width, 0.16),
    new THREE.MeshBasicMaterial({ color: 0x22232e }),
  );
  const fill = new THREE.Mesh(
    new THREE.PlaneGeometry(width, 0.16),
    new THREE.MeshBasicMaterial({ color: 0x5fce6a }),
  );
  fill.position.z = 0.001;
  const group = new THREE.Group();
  group.add(bg, fill);
  return { group, fill };
}

function setBar(fill: THREE.Mesh, frac: number, width: number): void {
  const f = Math.max(0.001, Math.min(1, frac));
  fill.scale.x = f;
  fill.position.x = -(1 - f) * (width / 2);
}

/*
 * Player characters ARE the storm: each one is a tiny living thundercloud.
 * A dense cumulus of smooth puffs in the hero color rides on a darker
 * underbelly, its only "face" a glowing visor slit (no faces ever), with a
 * little lightning bolt dangling beneath like a stinger — it flickers with
 * the cloud's mood and blazes on the finisher. The two floating hands
 * remain: melee swells one into a giant glowing mitt that slaps through
 * the arc. Geometries are shared; each view owns only its tintable
 * materials.
 */
const WISP_HAND_GEO = new THREE.SphereGeometry(0.095, 12, 10);
const CLOUD_PUFF_GEO = new THREE.SphereGeometry(1, 14, 12); // unit; scaled per puff
/** Puff layout: position + radius, sculpting a chunky little cumulus. */
const CLOUD_PUFFS: [number, number, number, number][] = [
  [0, 0.18, 0, 0.32],
  [-0.26, 0.12, 0.02, 0.24],
  [0.26, 0.14, -0.02, 0.24],
  [0.05, 0.37, 0.04, 0.2],
  [0.02, 0.14, 0.2, 0.21],
];
const CLOUD_VISOR_GEO = new THREE.TorusGeometry(0.235, 0.032, 6, 12, 1.15);
CLOUD_VISOR_GEO.rotateZ(Math.PI / 2 - 0.575); // center the arc upward...
CLOUD_VISOR_GEO.rotateX(Math.PI / 2); // ...then swing it to face forward
const BOLT_SEG_GEO = new THREE.BoxGeometry(0.055, 0.17, 0.04);

const CORE_GEO = new THREE.SphereGeometry(0.075, 12, 10);

// Ember: a living flame — one smooth teardrop lathe; the inner tongue reuses
// the same geometry at a smaller scale in the glow material.
const FLAME_GEO = new THREE.LatheGeometry(
  [
    [0.02, 0.0], [0.24, 0.05], [0.36, 0.18], [0.40, 0.36], [0.34, 0.58],
    [0.22, 0.78], [0.10, 0.95], [0.03, 1.08], [0.0, 1.14],
  ].map(([r, y]) => new THREE.Vector2(r!, y!)),
  20,
);
FLAME_GEO.translate(0, -0.55, 0); // pivot mid-flame
const SPARK_GEO = new THREE.SphereGeometry(0.05, 8, 6);

// Sky Jelly: a translucent bell with trailing tendrils, swimming in place.
const JELLY_BELL_GEO = new THREE.LatheGeometry(
  [
    [0.02, -0.10], [0.30, -0.06], [0.40, 0.04], [0.43, 0.16], [0.38, 0.30],
    [0.26, 0.41], [0.12, 0.47], [0.0, 0.49],
  ].map(([r, y]) => new THREE.Vector2(r!, y!)),
  22,
);
const JELLY_TENDRIL_GEO = new THREE.CylinderGeometry(0.026, 0.006, 0.62, 5);
JELLY_TENDRIL_GEO.translate(0, -0.31, 0); // pivot at the bell rim

// Tempest: a funnel of horizontal rings, wide crown to narrow base. Slightly
// elliptical so their spin actually reads; top ring first.
const VORTEX_RING_GEOS = [0.34, 0.27, 0.2, 0.13].map((r, i) => {
  const geo = new THREE.TorusGeometry(r, 0.075 - i * 0.009, 8, 22);
  geo.rotateX(Math.PI / 2);
  geo.scale(1, 1, 0.86);
  return geo;
});
const PEBBLE_GEO = new THREE.SphereGeometry(0.05, 7, 6);

// Crescent: a fat moon-sliver cradle, opening upward, a star orbiting through.
const MOON_ARC = Math.PI * 1.25;
const MOON_GEO = new THREE.TorusGeometry(0.4, 0.15, 12, 28, MOON_ARC);
MOON_GEO.rotateZ(-Math.PI / 2 - MOON_ARC / 2); // center the arc at the bottom
const STAR_GEO = new THREE.OctahedronGeometry(0.08);

/** Paraglider canopy: a squashed sphere slice, tinted per hero. */
const CHUTE_CANOPY_GEO = new THREE.SphereGeometry(1.5, 14, 6, 0, Math.PI * 2, 0, Math.PI * 0.42);
CHUTE_CANOPY_GEO.scale(1, 0.62, 0.85);
const CHUTE_LINE_GEO = new THREE.CylinderGeometry(0.012, 0.012, 1, 4);
const CHUTE_LINE_MAT = new THREE.MeshBasicMaterial({ color: 0x2a2a33 });

/** Scratch colors for per-frame tinting — never allocate in update(). */
const TINT = new THREE.Color();
const TINT_MIX = new THREE.Color();
const WHITE = new THREE.Color(0xffffff);

/**
 * Selectable body designs; all share the slap hands and the same chassis.
 * Every body follows the Storm Cloud recipe the user liked: one cohesive
 * elemental silhouette, a glowing visor slit for a face, one signature
 * accent (the cloud's bolt, the moon's star…), and an idle that never sits
 * still.
 */
export type HeroModel = 'cloud' | 'ember' | 'jelly' | 'vortex' | 'moon';
export const HERO_MODELS: { id: HeroModel; name: string }[] = [
  { id: 'cloud', name: 'Storm Cloud' },
  { id: 'ember', name: 'Ember' },
  { id: 'jelly', name: 'Sky Jelly' },
  { id: 'vortex', name: 'Tempest' },
  { id: 'moon', name: 'Crescent' },
];

/** How a body's materials take the hero tint (and their resting opacity). */
interface TintMat {
  mat: THREE.MeshStandardMaterial;
  mode: 'light' | 'plain' | 'dark';
  baseOpacity: number;
}

class PlayerView {
  readonly group = new THREE.Group();
  private readonly bodyPivot = new THREE.Group();
  private readonly handMat: THREE.MeshStandardMaterial;
  private visorMat!: THREE.MeshBasicMaterial;
  private readonly tintMats: TintMat[] = [];
  /** Per-model idle/travel animation, assigned by the body builder. */
  private animateBody: (bob: number, speed: number, dt: number) => void = () => {};
  private deathStyle: 'dissipate' | 'topple' = 'topple';
  /** Objects hidden on death (the cloud's bolt gutters out). */
  private readonly deathHide: THREE.Object3D[] = [];
  private baseScale = 0.9;
  private handRestY = 0.06;
  private readonly handL = new THREE.Group();
  private readonly handR = new THREE.Group();
  private readonly chute = new THREE.Group();
  private readonly shield: THREE.Mesh;
  private readonly reviveBeacon: THREE.Mesh;
  private readonly hoverGlow: THREE.Sprite;
  private readonly sigil: { mesh: THREE.Mesh; mat: THREE.ShaderMaterial };
  private sigilTimer = 0;
  private castElement: Element = 'holy';
  private readonly chargeOrb: THREE.Mesh;
  private readonly chargeMat: THREE.MeshBasicMaterial;
  private readonly whirl: ReturnType<typeof fireWhirl>;
  private readonly wardMat: THREE.ShaderMaterial;
  private readonly wisps: THREE.Sprite[] = [];
  private hitFlash = 0;
  /** Props riding on the body (mounts, the hen, the axe, a rocket plume). */
  private readonly attachments: Attachment[] = [];
  private lift = 0;
  /** Rim color the body glows with: the hero tint, shifting to the spell's element on a cast. */
  private readonly rimColor = new THREE.Color();
  private castGlow = 0;
  /** Trail this frame (see TrailKind), and whether a trail puff is due. */
  trail: TrailKind | null = null;
  trailEmit = false;
  private trailTimer = 0;
  /** Fade to Shadow: a puff is owed at the arrival point of the blink. */
  private pendingBlink = false;
  blinkArrived: { x: number; z: number } | null = null;
  private readonly hpGroup: THREE.Group;
  private readonly hpFill: THREE.Mesh;
  /** Set for one frame when the glider folds away on touchdown. */
  landed = false;
  private wasGliding = false;
  private deadFor = 0;
  private rollSpin = 0;
  private swingTimer = 0;
  private swingCombo = 1;
  private castTimer = 0;
  private bobPhase = 0;
  private deploy = 0;
  /** Squash-and-stretch: >0 squashes (landing), <0 stretches (leaping). */
  private squash = 0;
  private wasAirborne = false;
  private lastFacing = Number.NaN;
  private bank = 0;
  /** Body lunge on a slap, in meters forward. */
  private lunge = 0;
  private pulse = 0;
  /** Set for one frame when a footstep lands (for dust). */
  step = false;
  private lastX = Number.NaN;
  private lastZ = Number.NaN;
  private stepTimer = 0;
  private stepAlt = false;
  private readonly base: number;
  private readonly glowBase = new THREE.Color();

  constructor(
    isSelf: boolean,
    isBot: boolean,
    selfColor: number = SELF_COLOR,
    model: HeroModel = 'cloud',
    isAlly = false,
  ) {
    this.base = isSelf || !isBot ? selfColor : isAlly ? ALLY_COLOR : BOT_COLOR;
    this.glowBase.setHex(this.base).lerp(WHITE, 0.72);
    // Hands glow when they strike — the hero's "weapon" is a giant slap.
    this.handMat = new THREE.MeshStandardMaterial({
      color: new THREE.Color(this.base).lerp(WHITE, 0.3),
      roughness: 0.6,
      emissive: this.glowBase,
      emissiveIntensity: 0,
    });
    this.visorMat = new THREE.MeshBasicMaterial({ color: this.glowBase });
    this.rimColor.copy(this.glowBase);

    // Pivot at mid-body so roll tumbles read naturally.
    this.bodyPivot.position.y = 1.0;
    if (model === 'ember') this.buildEmber();
    else if (model === 'jelly') this.buildJelly();
    else if (model === 'vortex') this.buildVortex();
    else if (model === 'moon') this.buildMoon();
    else this.buildCloud();
    this.bodyPivot.scale.setScalar(this.baseScale);

    // Floating mitten hands — no weapon: swings swell them into giant
    // glowing slaps, alternating sides, both clapping on the finisher.
    for (const [hand, side] of [
      [this.handL, -1],
      [this.handR, 1],
    ] as const) {
      const palm = new THREE.Mesh(WISP_HAND_GEO, this.handMat);
      palm.position.set(side * 0.02, -0.16, 0.06);
      palm.castShadow = true;
      hand.add(palm);
      hand.position.set(side * 0.42, this.handRestY, 0.06);
      hand.rotation.x = 0.15;
      this.bodyPivot.add(hand);
    }

    this.group.add(this.bodyPivot);

    // Paraglider: tinted canopy on suspension lines, swaying above the wisp.
    const canopyMat = new THREE.MeshStandardMaterial({
      color: new THREE.Color(this.base).lerp(WHITE, 0.18),
      roughness: 0.75,
      side: THREE.DoubleSide,
    });
    const canopy = new THREE.Mesh(CHUTE_CANOPY_GEO, canopyMat);
    canopy.position.y = 1.5;
    this.chute.add(canopy);
    const lineTop = new THREE.Vector3();
    const lineBottom = new THREE.Vector3();
    const lineDir = new THREE.Vector3();
    for (let i = 0; i < 6; i++) {
      const a = (i / 6) * Math.PI * 2 + Math.PI / 6;
      lineTop.set(Math.sin(a) * 1.32, 1.68, Math.cos(a) * 1.12);
      lineBottom.set(Math.sin(a) * 0.2, 0, Math.cos(a) * 0.17);
      const line = new THREE.Mesh(CHUTE_LINE_GEO, CHUTE_LINE_MAT);
      lineDir.subVectors(lineTop, lineBottom);
      line.scale.y = lineDir.length();
      line.position.copy(lineBottom).addScaledVector(lineDir, 0.5);
      line.quaternion.setFromUnitVectors(Y_AXIS, lineDir.normalize());
      this.chute.add(line);
    }
    this.chute.position.y = 1.15; // hangs from the shoulders
    this.chute.visible = false;
    this.group.add(this.chute);

    // Wards (Lightning Bulwark, Repel): a bubble alive with crawling arcs.
    this.wardMat = wardMaterial();
    this.shield = new THREE.Mesh(new THREE.SphereGeometry(1.15, 24, 18), this.wardMat);
    this.shield.position.y = 1;
    this.shield.visible = false;
    this.shield.renderOrder = 3;
    this.group.add(this.shield);

    // Fire Whirl: tongues of flame orbiting the body.
    this.whirl = fireWhirl();
    this.whirl.obj.position.y = 0.3;
    this.whirl.obj.visible = false;
    this.group.add(this.whirl.obj);

    // Cast sigil under the feet and the charge orb between the hands.
    this.sigil = makeSigil(0xffffff, 1.5);
    this.sigil.mesh.position.y = 0.06;
    this.sigil.mesh.visible = false;
    this.group.add(this.sigil.mesh);
    this.chargeMat = new THREE.MeshBasicMaterial({ color: 0xffffff, transparent: true, opacity: 0.9, depthWrite: false });
    this.chargeOrb = new THREE.Mesh(CORE_GEO, this.chargeMat);
    this.chargeOrb.position.set(0, 0.05, 0.42);
    this.chargeOrb.visible = false;
    this.bodyPivot.add(this.chargeOrb);
    // Wisps: shadow motes while stealthed, fae sparkles while transformed.
    for (let i = 0; i < 3; i++) {
      const w = makeGlow(0xffffff, 0.5, 0.8);
      w.visible = false;
      this.group.add(w);
      this.wisps.push(w);
    }

    // Duos: marks a downed teammate's corpse as revivable — pulses so it
    // reads at a glance from across the arena, unlike the shrinking body.
    this.reviveBeacon = new THREE.Mesh(
      new THREE.RingGeometry(0.9, 1.15, 24),
      new THREE.MeshBasicMaterial({
        color: ALLY_COLOR,
        transparent: true,
        opacity: 0.8,
        side: THREE.DoubleSide,
        depthWrite: false,
      }),
    );
    this.reviveBeacon.rotation.x = -Math.PI / 2;
    this.reviveBeacon.position.y = 0.05;
    this.reviveBeacon.visible = false;
    this.group.add(this.reviveBeacon);

    // The construct's energy lights the ground under it: a soft tinted pool
    // that breathes with the hover, which also anchors the body visually.
    this.hoverGlow = makeGlow(this.glowBase.getHex(), 2.6, 0.45);
    this.hoverGlow.position.y = 0.12;
    this.group.add(this.hoverGlow);

    const bar = makeBar(1.3);
    this.hpGroup = bar.group;
    this.hpFill = bar.fill;
    this.hpGroup.position.y = 2.2;
    this.group.add(this.hpGroup);
  }

  private tintable(
    mode: TintMat['mode'],
    opts: THREE.MeshStandardMaterialParameters = {},
    baseOpacity = 1,
  ): THREE.MeshStandardMaterial {
    const mat = new THREE.MeshStandardMaterial(opts);
    if (baseOpacity < 1) {
      mat.transparent = true;
      mat.opacity = baseOpacity;
    }
    // Storm energy along every silhouette: the glow tint, brightest on the
    // dark underbellies so the body reads as lit from inside.
    addRimGlow(mat, this.rimColor, mode === 'dark' ? 0.9 : 0.55);
    this.tintMats.push({ mat, mode, baseOpacity });
    return mat;
  }

  /** A tiny living thundercloud with a bolt dangling beneath like a stinger. */
  private buildCloud(): void {
    const cloudMat = this.tintable('light', { roughness: 0.95 });
    const underMat = this.tintable('dark', { roughness: 0.95 });
    const cloudGroup = new THREE.Group();
    for (const [px, py, pz, r] of CLOUD_PUFFS) {
      const puff = new THREE.Mesh(CLOUD_PUFF_GEO, cloudMat);
      puff.position.set(px, py, pz);
      puff.scale.setScalar(r);
      puff.castShadow = true;
      cloudGroup.add(puff);
    }
    const belly = new THREE.Mesh(CLOUD_PUFF_GEO, underMat);
    belly.position.y = -0.04;
    belly.scale.set(0.35, 0.16, 0.32);
    cloudGroup.add(belly);
    const visor = new THREE.Mesh(CLOUD_VISOR_GEO, this.visorMat);
    visor.position.set(0, 0.16, 0.2);
    cloudGroup.add(visor);
    this.bodyPivot.add(cloudGroup);

    const bolt = new THREE.Group();
    let segY = -0.28;
    for (const [dx, tilt] of [[0.03, 0.4], [-0.03, -0.42], [0.03, 0.38]] as const) {
      const seg = new THREE.Mesh(BOLT_SEG_GEO, this.visorMat);
      seg.position.set(dx, segY, 0.04);
      seg.rotation.z = tilt;
      bolt.add(seg);
      segY -= 0.13;
    }
    this.bodyPivot.add(bolt);

    this.deathStyle = 'dissipate';
    this.deathHide.push(bolt);
    this.animateBody = (bob, _speed, _dt) => {
      const breathe = 1 + Math.sin(bob * 1.2) * 0.035;
      cloudGroup.scale.setScalar(breathe);
      cloudGroup.rotation.z = Math.sin(bob * 0.55) * 0.07;
      bolt.visible = true;
      bolt.rotation.z = Math.sin(bob * 0.9 + 0.5) * 0.18;
      bolt.position.y = Math.sin(bob * 1.4) * 0.02;
    };
  }

  /** A living flame: flickering teardrop, hot heart, sparks spiraling off. */
  private buildEmber(): void {
    const flameMat = this.tintable('light', { roughness: 0.9 }, 0.92);
    const flame = new THREE.Mesh(FLAME_GEO, flameMat);
    flame.castShadow = true;
    const heart = new THREE.Mesh(FLAME_GEO, this.visorMat);
    heart.scale.setScalar(0.55);
    heart.position.y = -0.18;
    const flameGroup = new THREE.Group();
    flameGroup.add(flame, heart);
    this.bodyPivot.add(flameGroup);
    const visor = new THREE.Mesh(CLOUD_VISOR_GEO, this.visorMat);
    visor.position.set(0, 0.08, 0.3);
    this.bodyPivot.add(visor);
    const sparks: THREE.Mesh[] = [];
    for (let i = 0; i < 3; i++) {
      const spark = new THREE.Mesh(SPARK_GEO, this.visorMat);
      sparks.push(spark);
      this.bodyPivot.add(spark);
    }

    this.deathStyle = 'dissipate';
    this.deathHide.push(...sparks);
    this.handRestY = 0.1;
    this.animateBody = (bob, speed, _dt) => {
      // Fluid: two beat frequencies so the flicker never visibly repeats,
      // volume-preserving, leaning back like a blown candle at speed.
      const flicker = 1 + Math.sin(bob * 4.3) * 0.05 + Math.sin(bob * 9.7 + 1.3) * 0.04;
      flameGroup.scale.set(2 - flicker, flicker, 2 - flicker);
      flameGroup.rotation.x = -Math.min(0.35, speed * 0.035);
      flameGroup.rotation.z = Math.sin(bob * 2.1) * 0.05;
      // Sparks spiral up off the crown and are reborn at the base.
      sparks.forEach((s, i) => {
        const t = (bob * 0.35 + i / 3) % 1;
        const a = t * 5 + i * 2.1;
        const r = 0.2 * (1 - t * 0.6);
        s.position.set(Math.sin(a) * r, 0.15 + t * 0.85, Math.cos(a) * r);
        s.scale.setScalar(Math.max(0.2, 1 - t * 0.8));
      });
    };
  }

  /** A sky jellyfish: pulsing translucent bell, tendrils trailing the swim. */
  private buildJelly(): void {
    const bellMat = this.tintable('plain', { roughness: 0.3, metalness: 0.05 }, 0.72);
    const tendrilMat = this.tintable('light', { roughness: 0.6 }, 0.85);
    const bell = new THREE.Mesh(JELLY_BELL_GEO, bellMat);
    bell.castShadow = true;
    this.bodyPivot.add(bell);
    const nucleus = new THREE.Mesh(CORE_GEO, this.visorMat);
    nucleus.scale.setScalar(1.6);
    nucleus.position.y = 0.1;
    this.bodyPivot.add(nucleus);
    const visor = new THREE.Mesh(CLOUD_VISOR_GEO, this.visorMat);
    visor.position.set(0, 0.14, 0.33);
    this.bodyPivot.add(visor);
    const tendrils: THREE.Mesh[] = [];
    for (let i = 0; i < 5; i++) {
      const a = (i / 5) * Math.PI * 2 + 0.4;
      const tendril = new THREE.Mesh(JELLY_TENDRIL_GEO, tendrilMat);
      tendril.position.set(Math.sin(a) * 0.24, -0.04, Math.cos(a) * 0.24);
      tendrils.push(tendril);
      this.bodyPivot.add(tendril);
    }

    this.deathStyle = 'dissipate';
    this.handRestY = 0.14;
    this.animateBody = (bob, speed, _dt) => {
      // Fluid: real medusa swimming — the bell contracts, the body rises on
      // the stroke, and the tendrils lag half a beat behind.
      const pulse = Math.sin(bob * 2.2);
      bell.scale.set(1 + pulse * 0.08, 1 - pulse * 0.11, 1 + pulse * 0.08);
      this.bodyPivot.position.y += Math.sin(bob * 2.2 - 1.1) * 0.06;
      const drag = Math.min(0.55, speed * 0.055);
      tendrils.forEach((t, i) => {
        t.rotation.x = drag + Math.sin(bob * 2.2 - 1.9 + i * 0.7) * 0.24;
        t.rotation.z = Math.cos(bob * 1.6 + i * 1.3) * 0.12;
      });
    };
  }

  /** A storm funnel: a ring vortex spinning wide crown over narrow base. */
  private buildVortex(): void {
    const lightMat = this.tintable('light', { roughness: 0.85 });
    const darkMat = this.tintable('dark', { roughness: 0.85 });
    const rings: THREE.Group[] = [];
    VORTEX_RING_GEOS.forEach((geo, i) => {
      const holder = new THREE.Group();
      const ring = new THREE.Mesh(geo, i % 2 === 0 ? lightMat : darkMat);
      ring.castShadow = i < 2;
      holder.add(ring);
      holder.position.y = 0.38 - i * 0.27;
      rings.push(holder);
      this.bodyPivot.add(holder);
    });
    // Debris caught in the spin — the funnel's bolt-equivalent accent.
    for (const [ringIdx, a] of [[0, 1.1], [2, 3.9]] as const) {
      const pebble = new THREE.Mesh(PEBBLE_GEO, this.visorMat);
      const r = 0.36 - ringIdx * 0.07 + 0.09;
      pebble.position.set(Math.sin(a) * r, 0.02, Math.cos(a) * r);
      rings[ringIdx]!.add(pebble);
    }
    const visor = new THREE.Mesh(CLOUD_VISOR_GEO, this.visorMat);
    visor.position.set(0, 0.52, 0.18);
    this.bodyPivot.add(visor);

    this.deathStyle = 'dissipate';
    this.animateBody = (bob, speed, dt) => {
      // Fluid: never stops spinning — faster toward the base like a real
      // funnel, the whole stack wobbling off-axis, harder when traveling.
      const spin = 2.6 + Math.min(10, speed * 0.9);
      rings.forEach((holder, i) => {
        holder.rotation.y += dt * spin * (1 + i * 0.45);
        holder.position.x = Math.sin(bob * 1.4 + i * 1.2) * (0.02 + i * 0.012);
        holder.position.z = Math.cos(bob * 1.1 + i * 1.2) * (0.02 + i * 0.012);
      });
    };
  }

  /** A crescent-moon sprite rocking like a cradle, a star sailing its gap. */
  private buildMoon(): void {
    const moonMat = this.tintable('plain', { metalness: 0.3, roughness: 0.4 });
    const moon = new THREE.Mesh(MOON_GEO, moonMat);
    moon.castShadow = true;
    const moonGroup = new THREE.Group();
    moonGroup.add(moon);
    const visor = new THREE.Mesh(CLOUD_VISOR_GEO, this.visorMat);
    visor.position.set(0, -0.1, 0.2);
    moonGroup.add(visor);
    const star = new THREE.Mesh(STAR_GEO, this.visorMat);
    moonGroup.add(star);
    this.bodyPivot.add(moonGroup);

    this.deathStyle = 'dissipate';
    this.deathHide.push(star);
    this.animateBody = (bob, speed, dt) => {
      // Fluid: a hammock rock that deepens on the move, while the signature
      // star loops through the crescent's opening.
      moonGroup.rotation.z = Math.sin(bob * 0.8) * (0.12 + Math.min(0.1, speed * 0.012));
      moonGroup.rotation.x = Math.min(0.3, speed * 0.03);
      const a = bob * 1.3;
      star.position.set(Math.sin(a) * 0.42, Math.cos(a) * 0.42 + 0.12, 0.05);
      star.rotation.y += dt * 3;
      star.rotation.x += dt * 2.2;
    };
  }

  update(
    p: {
      x: number;
      y: number;
      z: number;
      facing: number;
      hpFrac: number;
      alive: boolean;
      slowed: boolean;
      gliding: boolean;
      diving: boolean;
      rolling: boolean;
      shielded: boolean;
      stealthed: boolean;
      immune: boolean;
      fae: boolean;
      poisoned: boolean;
      auraActive: boolean;
      auraRadius: number;
      charging: number;
      channeling: number;
      channelKind: 'chest' | 'heal' | 'revive' | null;
    },
    isSelf: boolean,
    isBot: boolean,
    dt: number,
    camera: THREE.Camera,
    isRevivableAlly = false,
  ): void {
    this.group.position.set(p.x, p.y, p.z);
    if (!p.alive) {
      this.deadFor += dt;
      if (this.deathStyle === 'dissipate') {
        // A dead cloud doesn't fall — it goes gray, sinks, and dissipates.
        this.bodyPivot.rotation.x = 0.35;
        this.bodyPivot.position.y = Math.max(0.45, 1.0 - this.deadFor * 0.4);
        this.bodyPivot.scale.setScalar(this.baseScale * Math.max(0.25, 1 - this.deadFor * 0.35));
      } else {
        this.bodyPivot.rotation.x = Math.PI / 2;
        this.bodyPivot.position.y = 0.5;
      }
      for (const t of this.tintMats) t.mat.color.setHex(t.mode === 'dark' ? 0x33333c : DEAD_COLOR);
      this.handMat.color.setHex(DEAD_COLOR);
      this.visorMat.color.setHex(0x777788);
      for (const o of this.deathHide) o.visible = false;
      this.hpGroup.visible = false;
      this.shield.visible = false;
      this.chute.visible = false;
      this.hoverGlow.visible = false;
      this.whirl.obj.visible = false;
      this.sigil.mesh.visible = false;
      this.chargeOrb.visible = false;
      for (const w of this.wisps) w.visible = false;
      for (const a of this.attachments) this.group.remove(a.obj);
      this.attachments.length = 0;
      this.trail = null;
      this.trailEmit = false;
      this.landed = false;
      this.wasGliding = false;
      this.reviveBeacon.visible = isRevivableAlly;
      if (isRevivableAlly) {
        const pulse = 0.5 + Math.sin(this.deadFor * 3) * 0.3;
        (this.reviveBeacon.material as THREE.MeshBasicMaterial).opacity = pulse;
        this.reviveBeacon.scale.setScalar(1 + Math.sin(this.deadFor * 3) * 0.08);
      }
      // A revivable corpse has no expiry — it has to stay visible indefinitely,
      // unlike a normal death fade-out which would otherwise hide it here too.
      if (this.deadFor > 2.5 && !isRevivableAlly) this.group.visible = false;
      return;
    }
    this.deadFor = 0;
    this.group.visible = true;
    this.reviveBeacon.visible = false;

    this.group.rotation.y = p.facing;
    const now = performance.now() / 1000;
    // Observed horizontal speed drives the hover cycle, trails, and mounts.
    const moved = Number.isNaN(this.lastX) ? 0 : Math.hypot(p.x - this.lastX, p.z - this.lastZ);
    this.lastX = p.x;
    this.lastZ = p.z;
    const speed = dt > 0 ? moved / dt : 0;
    const airborne = p.y > 0.08 && !p.gliding;
    this.shield.visible = p.shielded || p.immune;
    if (this.shield.visible) {
      // Repel's arcane ward vs. Lightning Bulwark's electric charge.
      (this.wardMat.uniforms.uColor!.value as THREE.Color).setHex(
        p.immune ? ELEMENT_PALETTE.arcane.glow : ELEMENT_PALETTE.electric.core,
      );
      this.wardMat.uniforms.uArcs!.value = p.immune ? 0.4 : 1;
      this.shield.scale.setScalar(1 + 0.03 * Math.sin(now * 9));
    }
    this.whirl.obj.visible = p.auraActive;
    if (p.auraActive) this.whirl.anim(now, p.auraRadius);
    // Sigil: flares on every cast, holds while a charge is wound up or a
    // heal is channeled (in the heal's green).
    this.sigilTimer = Math.max(0, this.sigilTimer - dt);
    const charging = p.charging >= 0;
    const healing = p.channeling >= 0 && p.channelKind === 'heal';
    if (healing && this.castElement !== 'nature') {
      this.castElement = 'nature';
      (this.sigil.mat.uniforms.uColor!.value as THREE.Color).setHex(0x7ee07a);
    }
    this.sigil.mesh.visible = this.sigilTimer > 0 || charging || healing;
    if (this.sigil.mesh.visible) {
      this.sigil.mat.uniforms.uFade!.value = charging
        ? 0.6 + p.charging * 0.5
        : healing ? 0.5 + 0.2 * Math.sin(now * 6) : Math.min(1, this.sigilTimer / 0.25);
      this.sigil.mat.uniforms.uSpin!.value = now * 1.2;
      this.sigil.mesh.rotation.y = -p.facing; // stays world-aligned while the body turns
    }
    this.chargeOrb.visible = charging;
    if (charging) {
      const c = 0.5 + p.charging * 1.6;
      this.chargeOrb.scale.setScalar(c * (1 + 0.1 * Math.sin(now * 20)));
      this.chargeMat.color.setHex(ELEMENT_PALETTE[this.castElement].glow).multiplyScalar(1.5 + p.charging * 2);
    }
    // Wisps: shadow motes while stealthed, fae sparkles while transformed,
    // green mending motes spiraling up while a heal is channeled, and
    // arcane stars gathering while Celestial Barrage charges.
    const wispKind = p.stealthed ? 'shadow' : p.fae ? 'fae' : healing ? 'heal' : charging && this.castElement === 'arcane' ? 'stars' : null;
    this.wisps.forEach((w, i) => {
      w.visible = wispKind !== null;
      if (!wispKind) return;
      const m = w.material as THREE.SpriteMaterial;
      if (wispKind === 'heal') {
        const cycle = (now * 0.9 + i / 3) % 1;
        const a = cycle * Math.PI * 4 + i;
        w.position.set(Math.sin(a) * 0.6, 0.3 + cycle * 1.8, Math.cos(a) * 0.6);
        m.color.setHex(0x9df0a5);
        m.opacity = Math.sin(cycle * Math.PI) * 0.9;
        w.scale.setScalar(0.4);
        return;
      }
      if (wispKind === 'stars') {
        const a = now * 5 + (i / 3) * Math.PI * 2;
        const r = 0.9 - p.charging * 0.4;
        w.position.set(Math.sin(a) * r, 1.2 + Math.sin(now * 4 + i * 2) * 0.35, Math.cos(a) * r);
        m.color.setHex(0xd6b8ff);
        m.opacity = 0.9;
        w.scale.setScalar(0.5 + p.charging * 0.3);
        return;
      }
      const a = now * (wispKind === 'fae' ? 4 : 1.6) + (i / 3) * Math.PI * 2;
      const r = wispKind === 'fae' ? 0.7 : 0.55;
      w.position.set(Math.sin(a) * r, 1 + Math.sin(now * 3 + i) * 0.3, Math.cos(a) * r);
      m.color.setHex(wispKind === 'fae' ? 0xffb0e8 : 0x5a3a90);
      m.opacity = wispKind === 'fae' ? 0.9 : 0.6;
      w.scale.setScalar(0.5);
    });
    // Cast glow: the body's rim takes the spell's color for a moment.
    this.castGlow = Math.max(0, this.castGlow - dt * 1.6);
    this.rimColor.copy(this.glowBase).lerp(TINT_MIX.setHex(ELEMENT_PALETTE[this.castElement].glow), this.castGlow);
    // Attachments ride along, animate, and expire.
    let wantLift = 0;
    for (let i = this.attachments.length - 1; i >= 0; i--) {
      const a = this.attachments[i]!;
      a.age += dt;
      if (a.age >= a.ttl) {
        this.group.remove(a.obj);
        this.attachments.splice(i, 1);
        continue;
      }
      a.anim(a.age / a.ttl, now, speed, dt);
      if (a.lift) wantLift = Math.max(wantLift, a.lift);
    }
    this.lift += (wantLift - this.lift) * Math.min(1, dt * 8);
    this.bodyPivot.position.y += this.lift;
    // Trails: a dash's wind, faeform's sparkle, an arc's vapor, a roll's dust.
    this.trail = p.rolling
      ? 'roll'
      : p.fae && speed > 1
        ? 'fae'
        : airborne && speed > 6
          ? 'air'
          : !p.gliding && !airborne && speed > 11
            ? 'wind'
            : null;
    this.trailEmit = false;
    if (this.trail) {
      this.trailTimer -= dt;
      if (this.trailTimer <= 0) {
        this.trailTimer = this.trail === 'fae' ? 0.08 : 0.05;
        this.trailEmit = true;
      }
    }
    // Fade to Shadow: the blink lands where the body next appears.
    if (this.pendingBlink && moved > 2.5) {
      this.pendingBlink = false;
      this.blinkArrived = { x: p.x, z: p.z };
    }
    // Hit flash: the body blinks white for a few frames.
    this.hitFlash = Math.max(0, this.hitFlash - dt * 6);
    for (const t of this.tintMats) t.mat.emissive.setScalar(this.hitFlash * 0.9);
    this.handMat.emissive.copy(this.glowBase).lerp(WHITE, this.hitFlash);

    // Footsteps: a soft directional tick timed to the stride, silent while
    // airborne, gliding, or rolling — those are tumbles, not a walking gait.
    if (!airborne && !p.gliding && !p.rolling && speed > 0.6) {
      this.stepTimer -= dt;
      if (this.stepTimer <= 0) {
        this.stepAlt = !this.stepAlt;
        sfx.footstep(p.x, p.z, isSelf, this.stepAlt);
        this.step = true;
        // Faster stride ticks faster; clamp so a sprint or crawl still reads.
        this.stepTimer = Math.max(0.24, Math.min(0.7, (0.5 * PLAYER_SPEED) / speed));
      }
    } else {
      this.stepTimer = 0; // next step lands immediately once moving resumes
    }
    this.bobPhase += dt * (2.4 + Math.min(9, speed * 1.1));
    this.bodyPivot.position.y = 1.0 + Math.sin(this.bobPhase) * (speed > 0.6 ? 0.06 : 0.035);
    this.animateBody(this.bobPhase, speed, dt);
    // Squash on touchdown, stretch on takeoff; both spring back.
    if (this.wasAirborne && !airborne && !p.gliding) this.squash = 1;
    else if (!this.wasAirborne && airborne) this.squash = -0.6;
    this.wasAirborne = airborne;
    this.squash *= Math.max(0, 1 - dt * 9);
    // Bank into turns: lean the body by the facing's rate of change.
    const facingRate = Number.isNaN(this.lastFacing) ? 0 : lerpAngle(this.lastFacing, p.facing, 1) - this.lastFacing;
    this.lastFacing = p.facing;
    const bankTarget = THREE.MathUtils.clamp((dt > 0 ? facingRate / dt : 0) * -0.06, -0.35, 0.35);
    this.bank += (bankTarget - this.bank) * Math.min(1, dt * 10);
    this.pulse *= Math.max(0, 1 - dt * 7);
    this.lunge *= Math.max(0, 1 - dt * 12);
    const sq = this.squash;
    const pulse = 1 + this.pulse * 0.12;
    this.bodyPivot.scale.set(
      this.baseScale * (1 + sq * 0.22) * pulse,
      this.baseScale * (1 - sq * 0.28) * pulse,
      this.baseScale * (1 + sq * 0.22) * pulse,
    );
    this.bodyPivot.position.z = this.lunge;
    if (p.rolling) {
      this.rollSpin += dt * 18;
      this.bodyPivot.rotation.x = this.rollSpin;
    } else if (p.gliding) {
      this.rollSpin = 0;
      // Nose down harder mid-dive — the plunge reads in the posture alone.
      this.bodyPivot.rotation.x = p.diving ? -1.3 : -0.9;
    } else {
      this.rollSpin = 0;
      // Lean into the direction of travel; pull up a touch mid-jump.
      this.bodyPivot.rotation.x = airborne ? -0.12 : Math.min(0.2, speed * 0.018);
    }
    this.bodyPivot.rotation.z = p.rolling ? 0 : this.bank;

    // Paraglider: pops open on deploy, folds in for a dive, and re-pops the
    // instant the dive releases — the same ease-out pop, just retargetable.
    this.chute.visible = p.gliding;
    if (p.gliding) {
      const target = p.diving ? 0.15 : 1;
      const rate = p.diving ? 1 / 0.25 : 1 / 0.4; // folding is snappier than opening
      const delta = target - this.deploy;
      this.deploy += Math.sign(delta) * Math.min(Math.abs(delta), dt * rate);
      const e = 1 - (1 - this.deploy) * (1 - this.deploy); // ease-out pop
      const breathe = 1 + Math.sin(this.bobPhase * 1.7) * 0.03;
      this.chute.scale.set((0.25 + 0.75 * e) * breathe, 0.25 + 0.75 * e, (0.25 + 0.75 * e) * breathe);
      this.chute.rotation.z = Math.sin(this.bobPhase * 1.1) * 0.08;
      this.chute.rotation.x = -0.12 + Math.sin(this.bobPhase * 0.8) * 0.05;
    } else {
      this.deploy = 0;
    }
    this.landed = this.wasGliding && !p.gliding;
    this.wasGliding = p.gliding;

    // Hands drift on their own slightly offset rhythms.
    this.handL.position.y = this.handRestY + Math.sin(this.bobPhase + 1.6) * 0.03;
    if (this.swingTimer <= 0) {
      this.handR.position.y = this.handRestY + Math.sin(this.bobPhase) * 0.03;
    }

    // The slap: the striking hand swells into a giant glowing mitt and whips
    // through the arc — right, then left, then BOTH on the combo finisher.
    let slapL = 0;
    let slapR = 0;
    if (this.swingTimer > 0) {
      this.swingTimer = Math.max(0, this.swingTimer - dt);
      const t = 1 - this.swingTimer / SWING_DURATION;
      const whip = t < 0.4 ? lerp(0.15, -2.05, t / 0.4) : lerp(-2.05, 0.15, (t - 0.4) / 0.6);
      const act = Math.sin(Math.PI * t); // swell in, shrink out
      const finisher = this.swingCombo === 3;
      if (finisher || this.swingCombo % 2 === 1) {
        this.handR.rotation.x = whip;
        slapR = act;
      }
      if (finisher || this.swingCombo % 2 === 0) {
        this.handL.rotation.x = whip;
        slapL = act;
      }
      if (finisher) {
        slapR *= 1.35;
        slapL *= 1.35;
      }
    }
    if (slapR === 0) this.handR.rotation.x = 0.15;
    this.handR.scale.setScalar(1 + 1.5 * slapR);
    this.handL.scale.setScalar(1 + 1.5 * slapL);
    this.handMat.emissiveIntensity = Math.max(slapL, slapR) * 0.9;
    // The off-hand rises while casting (unless it's mid-slap).
    if (this.castTimer > 0) {
      this.castTimer = Math.max(0, this.castTimer - dt);
      if (slapL === 0) {
        this.handL.rotation.x = -1.7;
        this.handL.position.y += 0.16;
      }
    } else if (slapL === 0) {
      this.handL.rotation.x = 0.15;
    }

    TINT.setHex(this.base);
    if (p.slowed) TINT.lerp(TINT_MIX.setHex(SLOW_COLOR), 0.55);
    if (p.poisoned) TINT.lerp(TINT_MIX.setHex(0x5fce6a), 0.4);
    if (p.fae) TINT.lerp(TINT_MIX.setHex(0xe98fd8), 0.7);
    this.handMat.color.copy(TINT).lerp(WHITE, 0.3);
    // The visor (and any glow bits) flicker, blazing on the finisher.
    this.visorMat.color
      .copy(this.glowBase)
      .multiplyScalar(0.82 + Math.sin(this.bobPhase * 1.3) * 0.1 + Math.sin(this.bobPhase * 7.7) * 0.08);
    if (this.swingCombo === 3) this.visorMat.color.lerp(WHITE, Math.min(1, slapR));
    this.visorMat.color.multiplyScalar(VISOR_HDR);
    // Stealth: nearly invisible to enemies, ghostly to yourself.
    const opacity = p.stealthed ? (isSelf ? 0.4 : 0.12) : 1;
    this.hoverGlow.visible = !p.stealthed && !p.gliding;
    if (this.hoverGlow.visible) {
      const pulse = 0.38 + Math.sin(this.bobPhase * 1.2) * 0.07 + Math.max(slapL, slapR) * 0.35;
      (this.hoverGlow.material as THREE.SpriteMaterial).opacity = pulse * (airborne ? 0.5 : 1);
      const glowSize = 2.4 + Math.min(0.8, speed * 0.05);
      this.hoverGlow.scale.set(glowSize, glowSize, 1);
      this.hoverGlow.position.y = 0.12 + (airborne ? -p.y : 0) + 0.02;
    }
    for (const t of this.tintMats) {
      if (t.mode === 'light') t.mat.color.copy(TINT).lerp(WHITE, 0.45);
      else if (t.mode === 'dark') t.mat.color.copy(TINT).multiplyScalar(0.5);
      else t.mat.color.copy(TINT);
      t.mat.transparent = t.baseOpacity * opacity < 1;
      t.mat.opacity = t.baseOpacity * opacity;
    }
    this.handMat.transparent = this.visorMat.transparent = opacity < 1;
    this.handMat.opacity = opacity;
    this.visorMat.opacity = opacity;
    this.hpGroup.visible = !p.stealthed;
    setBar(this.hpFill, p.hpFrac, 1.3);
    // Billboard: cancel the parent's facing rotation so the bar always faces the camera.
    this.hpGroup.quaternion.copy(this.group.quaternion).invert().multiply(camera.quaternion);
  }

  triggerSwing(combo: number): void {
    this.swingTimer = SWING_DURATION;
    this.swingCombo = combo;
    this.lunge = combo === 3 ? 0.35 : 0.2;
  }

  /** Mount a prop on the body for its lifetime (chopper, hen, axe, rocket plume). */
  attach(a: Attachment): void {
    this.attachments.push(a);
    this.group.add(a.obj);
  }

  /** A charge-and-release slam: the body drops into the blow. */
  slam(): void {
    this.squash = 1.3;
    this.lunge = 0.25;
    this.pulse = 0.6;
  }

  /** Fade to Shadow was cast: watch for the blink's landing point. */
  expectBlink(): void {
    this.pendingBlink = true;
  }

  triggerCast(abilityId?: AbilityId): void {
    this.castTimer = 0.35;
    this.sigilTimer = 0.55;
    this.pulse = 1;
    if (abilityId) {
      this.castElement = elementKeyOf(abilityId);
      (this.sigil.mat.uniforms.uColor!.value as THREE.Color).setHex(ELEMENT_PALETTE[this.castElement].glow);
      this.castGlow = 1;
    }
  }

  /** A hit landed on this character. */
  flashHit(): void {
    this.hitFlash = 1;
  }
}

class MobView {
  readonly group = new THREE.Group();
  private readonly hideMat: THREE.MeshStandardMaterial;
  private hitFlash = 0;
  private readonly hpFill: THREE.Mesh;
  private readonly hpGroup: THREE.Group;
  private readonly barWidth: number;
  private readonly elite: boolean;
  private readonly legs: THREE.Mesh[] = [];
  private walkPhase = 0;
  private lastX = Number.NaN;
  private lastZ = Number.NaN;

  constructor(elite: boolean, seed: number, level: number) {
    this.elite = elite;
    const beast = new THREE.Group();
    // Slight per-critter hue/lightness variation so packs don't look cloned.
    const hide = new THREE.Color(elite ? ELITE_COLOR : MOB_COLOR);
    hide.offsetHSL(((seed % 5) - 2) * 0.015, 0, ((seed % 3) - 1) * 0.04);
    // Higher-level mobs read as battle-worn: darker, more saturated hide.
    if (level > 1) hide.offsetHSL(0.02 * (level - 1), 0.08 * (level - 1), -0.05 * (level - 1));
    const hideMat = new THREE.MeshStandardMaterial({ color: hide, roughness: 0.85 });
    this.hideMat = hideMat;
    // A fur-like rim: light catching the bristles along the silhouette.
    addRimGlow(hideMat, new THREE.Color(hide).lerp(new THREE.Color(0xfff0d0), 0.5), elite ? 0.5 : 0.3, 3.2);
    const darkMat = new THREE.MeshStandardMaterial({ color: 0x6e5430, roughness: 0.8 });
    const body = new THREE.Mesh(new THREE.CapsuleGeometry(0.42, 0.55, 4, 10), hideMat);
    body.rotation.x = Math.PI / 2;
    body.position.y = 0.52;
    body.scale.set(1.15, 1, 1.05); // chunky, boar-like bulk
    body.castShadow = true;
    beast.add(body);
    // A shoulder hump behind the head, the classic WoW boar silhouette.
    const hump = new THREE.Mesh(new THREE.SphereGeometry(0.34, 10, 8), hideMat);
    hump.position.set(0, 0.74, 0.28);
    hump.scale.set(1.15, 0.8, 1);
    beast.add(hump);
    const snout = new THREE.Mesh(new THREE.ConeGeometry(0.18, 0.4, 8), darkMat);
    snout.rotation.x = Math.PI / 2;
    snout.position.set(0, 0.45, 0.78);
    beast.add(snout);
    // Tusks: rooted beside the snout, curving up-forward and flaring out.
    const tuskMat = new THREE.MeshStandardMaterial({ color: 0xe8dcc0, roughness: 0.5 });
    const tuskGeo = new THREE.ConeGeometry(0.045, 0.22, 6);
    tuskGeo.translate(0, 0.11, 0); // pivot at the root so rotations read as growth
    for (const side of [-1, 1]) {
      const tusk = new THREE.Mesh(tuskGeo, tuskMat);
      tusk.position.set(side * 0.14, 0.34, 0.74);
      tusk.rotation.set(0.6, 0, side * -0.45);
      beast.add(tusk);
    }
    // Stub legs at the four corners, pivoting at the shoulder for the scurry.
    const legGeo = new THREE.CylinderGeometry(0.09, 0.11, 0.3, 8);
    legGeo.translate(0, -0.15, 0);
    for (const [lx, lz] of [[-0.26, 0.3], [0.26, 0.3], [-0.26, -0.3], [0.26, -0.3]]) {
      const leg = new THREE.Mesh(legGeo, darkMat);
      leg.position.set(lx!, 0.3, lz!);
      beast.add(leg);
      this.legs.push(leg);
    }
    // Ears, eyes, tail.
    const earGeo = new THREE.ConeGeometry(0.09, 0.22, 6);
    for (const side of [-1, 1]) {
      const ear = new THREE.Mesh(earGeo, hideMat);
      ear.position.set(side * 0.2, 0.82, 0.5);
      beast.add(ear);
    }
    const eyeGeo = new THREE.SphereGeometry(0.05, 8, 6);
    const eyeMat = new THREE.MeshStandardMaterial({
      color: 0x1a1208,
      roughness: 0.3,
      emissive: elite ? 0xff4020 : 0xffb040,
      emissiveIntensity: elite ? 2.2 : 0.9,
    });
    for (const side of [-1, 1]) {
      const eye = new THREE.Mesh(eyeGeo, eyeMat);
      eye.position.set(side * 0.15, 0.62, 0.68);
      beast.add(eye);
    }
    const tail = new THREE.Mesh(new THREE.ConeGeometry(0.08, 0.35, 6), hideMat);
    tail.rotation.x = -Math.PI / 2.4;
    tail.position.set(0, 0.6, -0.82);
    beast.add(tail);
    if (elite) {
      beast.scale.setScalar(1.6);
      const gold = new THREE.MeshStandardMaterial({ color: 0xd4af37, metalness: 0.6, roughness: 0.3 });
      const crown = new THREE.Mesh(new THREE.CylinderGeometry(0.26, 0.32, 0.24, 6), gold);
      crown.position.set(0, 1.02, 0.3);
      beast.add(crown);
      // Crown points, so the boss reads from across a field.
      const pointGeo = new THREE.ConeGeometry(0.05, 0.16, 4);
      for (let k = 0; k < 4; k++) {
        const point = new THREE.Mesh(pointGeo, gold);
        const a = (k / 4) * Math.PI * 2;
        point.position.set(Math.cos(a) * 0.24, 1.18, 0.3 + Math.sin(a) * 0.24);
        beast.add(point);
      }
    }
    this.group.add(beast);

    this.barWidth = elite ? 1.4 : 0.9;
    const bar = makeBar(this.barWidth);
    this.hpGroup = bar.group;
    this.hpFill = bar.fill;
    this.hpGroup.position.y = elite ? 2.1 : 1.4;
    this.group.add(this.hpGroup);

    // A tier strip above the bar reads the danger level at a glance without
    // cluttering the beast with a floating number: amber at 2, red at 3.
    if (level > 1) {
      const tierColor = level >= MOB_MAX_LEVEL ? 0xe64d3a : 0xe6a83a;
      const tier = new THREE.Mesh(
        new THREE.PlaneGeometry(this.barWidth, 0.06),
        new THREE.MeshBasicMaterial({ color: tierColor }),
      );
      tier.position.y = 0.13;
      this.hpGroup.add(tier);
    }
  }

  flashHit(): void {
    this.hitFlash = 1;
  }

  update(x: number, z: number, facing: number, hpFrac: number, camera: THREE.Camera, dt: number): void {
    this.group.position.set(x, groundAt(x, z), z);
    this.group.rotation.y = facing;
    this.hitFlash = Math.max(0, this.hitFlash - dt * 6);
    this.hideMat.emissive.setScalar(this.hitFlash * 0.8);

    // Scurry: diagonal leg pairs alternate while moving.
    const moved = Number.isNaN(this.lastX) ? 0 : Math.hypot(x - this.lastX, z - this.lastZ);
    this.lastX = x;
    this.lastZ = z;
    const speed = dt > 0 ? moved / dt : 0;
    if (speed > 0.4) {
      this.walkPhase += dt * Math.min(18, speed * 3);
      const swing = Math.sin(this.walkPhase) * 0.6;
      this.legs.forEach((leg, i) => {
        leg.rotation.x = i === 0 || i === 3 ? swing : -swing;
      });
    } else {
      for (const leg of this.legs) leg.rotation.x *= 0.7;
    }

    this.hpGroup.visible = this.elite || hpFrac < 1;
    setBar(this.hpFill, hpFrac, this.barWidth);
    // Billboard: cancel the beast's facing so the bar tracks the camera.
    this.hpGroup.quaternion.copy(this.group.quaternion).invert().multiply(camera.quaternion);
  }
}

class ChestView {
  readonly group: THREE.Group;
  private readonly lid: THREE.Object3D | null;
  private readonly sparkle: THREE.Sprite;
  private readonly sparkleSize: number;
  private opened = false;

  constructor(assets: AssetLibrary, x: number, z: number) {
    // The pirate-kit chest ships with a separate hinged lid node.
    this.group = assets.model('chest');
    const scale = 1.5 / Math.max(0.001, assets.size('chest').x);
    this.group.scale.setScalar(scale);
    this.lid = this.group.getObjectByName('lid') ?? null;
    this.group.position.set(x, groundAt(x, z), z);
    this.group.rotation.y = (x * 7 + z * 13) % Math.PI;
    // A golden glint hovering over unopened plunder.
    this.sparkleSize = 1.2 / scale;
    this.sparkle = makeGlow(0xffd75e, this.sparkleSize, 0.7);
    this.sparkle.position.y = 1.3 / scale;
    this.group.add(this.sparkle);
  }

  setOpened(opened: boolean): void {
    if (opened === this.opened) return;
    this.opened = opened;
    if (this.lid) this.lid.rotation.x = opened ? -2.1 : 0;
    this.sparkle.visible = !opened;
  }

  animate(now: number): void {
    if (this.opened) return;
    const phase = now * 3.1 + this.group.position.x;
    (this.sparkle.material as THREE.SpriteMaterial).opacity = 0.5 + 0.25 * Math.sin(phase);
    const s = this.sparkleSize * (1 + 0.08 * Math.sin(now * 5 + phase));
    this.sparkle.scale.set(s, s, 1);
  }
}

interface Effect {
  obj: THREE.Object3D;
  /** Per-effect material (opacity animates); disposed when the effect ends. */
  mat: THREE.Material & { opacity: number };
  age: number;
  ttl: number;
  growth: number;
  /** Base scale the growth multiplies (geometries are shared unit shapes). */
  baseX: number;
  baseY: number;
  baseZ: number;
  /** Upward drift in m/s (heal sparkles, smoke). */
  rise?: number;
  /** Horizontal drift in m/s — scattering or converging particle bursts. */
  vx?: number;
  vz?: number;
  /** Tumble rate in rad/s, for debris/leaves/motes. */
  spin?: number;
  /** Set when the effect owns its geometry (chain lines) and must dispose it. */
  ownsGeometry?: boolean;
  /** Peak opacity (default 0.85); the effect fades from here to zero. */
  maxOpacity?: number;
}

/*
 * Per-ability projectile bodies. Every look is a small composite (core +
 * ornaments + an additive motion tail) with its own flight animation, all
 * assembled from these shared geometries — nothing is built per shot.
 */
const ARROW_GEO = new THREE.ConeGeometry(0.16, 0.95, 8);
ARROW_GEO.rotateX(Math.PI / 2); // point along +z so rotation.y aims it
const SHARD_TRAIL_GEO = new THREE.OctahedronGeometry(0.12);
const DISC_GEO = new THREE.CylinderGeometry(0.55, 0.55, 0.12, 18);
DISC_GEO.rotateX(Math.PI / 2);
const DISC_RIM_GEO = new THREE.TorusGeometry(0.56, 0.05, 6, 20);
const DISC_BOSS_GEO = new THREE.SphereGeometry(0.15, 10, 8);
const ARCHON_GEO = new THREE.OctahedronGeometry(0.28);
const MANA_GEO = new THREE.SphereGeometry(0.5, 14, 12);
const ORBIT_RING_GEO = new THREE.TorusGeometry(0.66, 0.035, 6, 22);
const CHAIN_LINK_GEO = new THREE.TorusGeometry(0.11, 0.036, 6, 10);
CHAIN_LINK_GEO.rotateX(Math.PI / 2); // link plane contains the flight axis
const ORB_GEO = new THREE.SphereGeometry(0.32, 12, 10);
/** Motion tail: an additive cone streaming back from the projectile. */
const TAIL_GEO = new THREE.ConeGeometry(0.22, 1.3, 8, 1, true);
TAIL_GEO.rotateX(-Math.PI / 2); // apex points backward (−z)
TAIL_GEO.translate(0, 0, -0.55);

/** Storm Archon's sparks snap yellow off its blue core — the electric two-tone. */
const ELECTRIC_SPARK_MAT = new THREE.MeshBasicMaterial({
  color: ELEMENT_PALETTE.electric.glow,
  transparent: true,
  opacity: 0.95,
  depthWrite: false,
});

/** Cached materials per ability: lit core, additive tail, unlit glow bits. */
const projMats = new Map<
  AbilityId,
  { core: THREE.MeshStandardMaterial; tail: THREE.MeshBasicMaterial; glow: THREE.MeshBasicMaterial }
>();
function projMaterials(abilityId: AbilityId): NonNullable<ReturnType<typeof projMats.get>> {
  let m = projMats.get(abilityId);
  if (!m) {
    const color = PROJECTILE_COLORS[abilityId] ?? 0xffe38a;
    m = {
      core: new THREE.MeshStandardMaterial({ color, emissive: color, emissiveIntensity: 1.5 }),
      tail: new THREE.MeshBasicMaterial({
        color,
        transparent: true,
        opacity: 0.4,
        blending: THREE.AdditiveBlending,
        depthWrite: false,
      }),
      glow: new THREE.MeshBasicMaterial({ color, transparent: true, opacity: 0.9, depthWrite: false }),
    };
    projMats.set(abilityId, m);
  }
  return m;
}

/** A live projectile: the scene object plus its per-frame flight animation. */
interface ProjView {
  obj: THREE.Object3D;
  anim: (now: number) => void;
}

function makeProjectileView(abilityId: AbilityId): ProjView {
  if (abilityId === 'celestialBarrage') {
    return { obj: new THREE.Mesh(CELESTIAL_GEO, CELESTIAL_MAT), anim: () => {} };
  }
  const { core, tail, glow } = projMaterials(abilityId);
  const group = new THREE.Group();
  const addTail = (len: number, width: number): void => {
    const t = new THREE.Mesh(TAIL_GEO, tail);
    t.scale.set(width, width, len);
    group.add(t);
  };
  switch (abilityId) {
    case 'rimeArrow': {
      // An ice bolt rolling in flight, shedding crystal shards behind it.
      const head = new THREE.Mesh(ARROW_GEO, core);
      const shards = [-0.55, -0.95].map((z, i) => {
        const s = new THREE.Mesh(SHARD_TRAIL_GEO, glow);
        s.position.z = z;
        s.scale.setScalar(1 - i * 0.4);
        group.add(s);
        return s;
      });
      group.add(head);
      addTail(0.9, 0.7);
      return {
        obj: group,
        anim: (now) => {
          head.rotation.z = now * 7;
          shards.forEach((s, i) => {
            s.rotation.x = now * (5 + i * 2);
            s.position.y = Math.sin(now * 9 + i * 2.4) * 0.06;
          });
        },
      };
    }
    case 'holyShield': {
      // A blessed discus: rim and boss gleaming, wobbling on its axis.
      const spinner = new THREE.Group();
      spinner.add(new THREE.Mesh(DISC_GEO, core), new THREE.Mesh(DISC_RIM_GEO, glow));
      const boss = new THREE.Mesh(DISC_BOSS_GEO, glow);
      boss.position.z = 0.09;
      spinner.add(boss);
      group.add(spinner);
      return {
        obj: group,
        anim: (now) => {
          spinner.rotation.z = now * 13;
          spinner.rotation.y = Math.sin(now * 4.5) * 0.3;
        },
      };
    }
    case 'stormArchon': {
      // A crackling core with stray sparks snapping around it, and jagged
      // arcs of lightning crawling off it.
      const orb = new THREE.Mesh(ARCHON_GEO, core);
      group.add(orb);
      const arcs = lightningArcs(3, 6, 0.6);
      group.add(arcs.obj);
      const bolts = [0, 1].map((i) => {
        const b = new THREE.Mesh(BOLT_SEG_GEO, ELECTRIC_SPARK_MAT);
        b.scale.setScalar(1.4 - i * 0.4);
        group.add(b);
        return b;
      });
      addTail(0.8, 0.6);
      return {
        obj: group,
        anim: (now) => {
          orb.rotation.x = now * 9;
          orb.rotation.y = now * 7;
          arcs.anim(now);
          bolts.forEach((b, i) => {
            const a = now * 23 + i * Math.PI;
            b.position.set(Math.sin(a) * 0.34, Math.cos(a * 1.3) * 0.22, Math.sin(a * 0.7) * 0.12);
            b.rotation.z = a;
          });
        },
      };
    }
    case 'manaSphere': {
      // A heavy arcane orb inside two counter-tumbling rings.
      const orb = new THREE.Mesh(MANA_GEO, core);
      const ringA = new THREE.Mesh(ORBIT_RING_GEO, glow);
      const ringB = new THREE.Mesh(ORBIT_RING_GEO, glow);
      ringB.scale.setScalar(0.82);
      group.add(orb, ringA, ringB);
      addTail(1.1, 1.1);
      return {
        obj: group,
        anim: (now) => {
          orb.scale.setScalar(1 + 0.1 * Math.sin(now * 11));
          ringA.rotation.x = now * 5;
          ringA.rotation.y = now * 3;
          ringB.rotation.x = -now * 4;
          ringB.rotation.z = now * 6;
        },
      };
    }
    case 'windstorm': {
      // A tornado: a spinning vapor funnel carrying debris, with a wake.
      const funnel = tornado();
      group.add(funnel.obj);
      addTail(1.4, 1.2);
      return { obj: group, anim: funnel.anim };
    }
    case 'huntersChains': {
      // Real chain links, planes alternating around the flight axis.
      const chain = new THREE.Group();
      for (let i = 0; i < 3; i++) {
        const holder = new THREE.Group();
        holder.add(new THREE.Mesh(CHAIN_LINK_GEO, core));
        holder.position.z = -i * 0.21;
        holder.rotation.z = (i % 2) * (Math.PI / 2);
        chain.add(holder);
      }
      group.add(chain);
      return {
        obj: group,
        anim: (now) => {
          chain.rotation.z = now * 9;
        },
      };
    }
    default: {
      // Glowing orb with a modest wake.
      const orb = new THREE.Mesh(ORB_GEO, core);
      group.add(orb);
      addTail(0.9, 0.9);
      return {
        obj: group,
        anim: (now) => {
          orb.scale.setScalar(1 + 0.08 * Math.sin(now * 13));
        },
      };
    }
  }
}

/**
 * Celestial Barrage flies as an aurora sheet: a tall vertical veil, blazing
 * at the leading edge and dimming back along its length, rippling with
 * electric-purple rays. Three sheets fanned around the flight axis give the
 * beam real width from every viewing angle; additive overlap brightens the
 * spine. One shared geometry and shader for all three stars.
 */
const CELESTIAL_GEO = mergeGeometries(
  [-0.55, 0, 0.55].map((roll) => {
    const sheet = new THREE.PlaneGeometry(3.6, 4.6, 1, 1);
    sheet.rotateY(-Math.PI / 2); // uv.x runs along +z, so the bright edge leads
    sheet.rotateZ(roll); // fan around the flight axis for visible width
    sheet.translate(0, 1.2, 0); // rises from the ground up
    return sheet;
  }),
)!;
const CELESTIAL_MAT = new THREE.ShaderMaterial({
  transparent: true,
  depthWrite: false,
  side: THREE.DoubleSide,
  blending: THREE.AdditiveBlending,
  uniforms: { uTime: { value: 0 } },
  vertexShader: `
    varying vec2 vUv;
    void main() {
      vUv = uv;
      gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
    }`,
  fragmentShader: `
    uniform float uTime;
    varying vec2 vUv;
    void main() {
      float x = clamp(vUv.x, 0.0, 1.0);                   // MSAA may extrapolate uv past the edge
      float head = pow(x, 2.2);                            // dims from the front backwards
      float vert = sin(vUv.y * 3.14159);                   // soft top and bottom
      float rays = 0.72 + 0.28 * sin(vUv.y * 26.0 + uTime * 9.0 + vUv.x * 6.0);
      float flicker = 0.8 + 0.2 * sin(uTime * 27.0 + vUv.x * 18.0);
      vec3 col = mix(vec3(0.36, 0.16, 0.85), vec3(0.75, 0.55, 1.0), vUv.y);
      col += vec3(0.55, 0.6, 1.0) * pow(x, 8.0);           // electric leading edge
      gl_FragColor = vec4(col, head * vert * rays * flicker * 0.85);
    }`,
});

/** Creates/updates meshes for everything dynamic in a snapshot, plus transient effects. */
export class EntityViews {
  private players = new Map<number, PlayerView>();
  private mobs = new Map<number, MobView>();
  private chests = new Map<number, ChestView>();
  private scrolls = new Map<number, { group: THREE.Group; spin: THREE.Group }>();
  private coins = new Map<number, THREE.Mesh>();
  private items = new Map<number, THREE.Group>();
  private projectiles = new Map<number, ProjView>();
  private zones = new Map<
    number,
    { group: THREE.Group; fill: THREE.Mesh; outline: THREE.Mesh; radius: number; kind: string }
  >();
  private effects: Effect[] = [];
  /** Self-animating spell effects (meteors, spikes, chains…). */
  private fx: FxHandle[] = [];
  /** Zone dressing that lives as long as the zone: snow, caltrops, traps. */
  private readonly zoneDressing = new Map<number, THREE.Object3D>();
  private readonly glowSprite: THREE.Texture;
  /** prev-snapshot lookups, rebuilt only when a new snapshot arrives (20 Hz, not per frame). */
  private cachedPrev: Snapshot | null = null;
  private readonly prevPlayerMap = new Map<number, Snapshot['players'][number]>();
  private readonly prevMobMap = new Map<number, Snapshot['mobs'][number]>();
  private readonly prevProjMap = new Map<number, Snapshot['projectiles'][number]>();

  private readonly scrollGeo = new THREE.OctahedronGeometry(0.35);
  private readonly coinGeo = new THREE.CylinderGeometry(0.22, 0.22, 0.06, 12);
  private readonly coinMat = new THREE.MeshStandardMaterial({
    color: 0xf3c53d,
    metalness: 0.6,
    roughness: 0.3,
  });

  private selfColor = SELF_COLOR;
  private selfModel: HeroModel = 'cloud';
  /** Characters near the camera this frame, for the grass to bend around. */
  readonly pushers: { x: number; z: number; radius: number; strength: number }[] = [];

  constructor(
    private readonly scene: THREE.Scene,
    private readonly assets: AssetLibrary,
    glowSprite: THREE.Texture,
  ) {
    glowTexture = glowSprite;
    this.glowSprite = glowSprite;
  }

  /** Hero color from the start screen; applies to views created afterwards. */
  setSelfColor(color: number): void {
    this.selfColor = color;
  }

  /** Hero body from the start screen; applies to views created afterwards. */
  setSelfModel(model: HeroModel): void {
    this.selfModel = model;
  }

  /** Refresh the prev-snapshot lookup maps only when `prev` actually changed. */
  private ensurePrevMaps(prev: Snapshot): void {
    if (prev === this.cachedPrev) return;
    this.cachedPrev = prev;
    this.prevPlayerMap.clear();
    for (const p of prev.players) this.prevPlayerMap.set(p.id, p);
    this.prevMobMap.clear();
    for (const m of prev.mobs) this.prevMobMap.set(m.id, m);
    this.prevProjMap.clear();
    for (const proj of prev.projectiles) this.prevProjMap.set(proj.id, proj);
  }

  sync(prev: Snapshot, next: Snapshot, t: number, selfId: number, camera: THREE.Camera, dt: number): void {
    const now = performance.now() / 1000;
    CELESTIAL_MAT.uniforms.uTime!.value = now;
    for (const mat of beamMats.values()) mat.uniforms.uTime!.value = now;
    const camX = camera.position.x;
    const camZ = camera.position.z;
    this.pushers.length = 0;
    const pushRange = 60 * 60;
    const beyond = (x: number, z: number, drawDist: number): boolean =>
      (x - camX) * (x - camX) + (z - camZ) * (z - camZ) > drawDist * drawDist;
    this.ensurePrevMaps(prev);

    // Players
    const prevPlayers = this.prevPlayerMap;
    const selfTeamId = next.players.find((p) => p.id === selfId)?.teamId ?? selfId;
    for (const p of next.players) {
      let view = this.players.get(p.id);
      if (!view) {
        // You wear your chosen body; bots spread across the roster for variety.
        const model =
          p.id === selfId || !p.isBot
            ? this.selfModel
            : HERO_MODELS[p.id % HERO_MODELS.length]!.id;
        const isAlly = p.teamId === selfTeamId && p.id !== selfId;
        view = new PlayerView(p.id === selfId, p.isBot, this.selfColor, model, isAlly);
        this.players.set(p.id, view);
        this.scene.add(view.group);
      }
      if (p.id !== selfId && beyond(p.x, p.z, PLAYER_DRAW_DIST)) {
        view.group.visible = false;
        continue;
      }
      // Re-show players that come back into range (dead ones manage their own fade).
      if (p.alive) view.group.visible = true;
      const pp = prevPlayers.get(p.id) ?? p;
      const ix = lerp(pp.x, p.x, t);
      const iz = lerp(pp.z, p.z, t);
      view.update(
        {
          x: ix,
          y: lerp(pp.y, p.y, t) + groundAt(ix, iz),
          z: iz,
          facing: lerpAngle(pp.facing, p.facing, t),
          hpFrac: p.hp / p.maxHp,
          alive: p.alive,
          slowed: p.slowed,
          gliding: p.gliding,
          diving: p.diving,
          rolling: p.rolling,
          shielded: p.shieldHp > 0,
          stealthed: p.stealthed,
          immune: p.immune,
          fae: p.fae,
          poisoned: p.poisoned,
          auraActive: p.auraActive,
          auraRadius: ABILITIES.fireWhirl.auraRadius ?? 3,
          charging: p.charging,
          channeling: p.channeling,
          channelKind: p.channelKind,
        },
        p.id === selfId,
        p.isBot,
        dt,
        camera,
        !p.alive && p.teamId === selfTeamId && p.id !== selfId,
      );
      if (view.landed) {
        // Touchdown: a puff of dust kicked up as the glider folds.
        this.spawnBurst(ix, iz, 1.8, 0xd8c8a0, 0.4);
        this.spawnElementBurst(ix, iz, 'physical', 0.8);
      }
      if (view.trailEmit) this.spawnTrail(ix, lerp(pp.y, p.y, t) + groundAt(ix, iz), iz, view.trail!);
      if (view.blinkArrived) {
        // The shadow re-forms where the blink landed.
        this.spawnBurst(view.blinkArrived.x, view.blinkArrived.z, 1.4, ELEMENT_PALETTE.shadow.core, 0.45, 0.8);
        this.spawnElementBurst(view.blinkArrived.x, view.blinkArrived.z, 'shadow', 0.9);
        view.blinkArrived = null;
      }
      if (view.step) {
        view.step = false;
        // A scuff of dust under each stride, close by only.
        const dx = ix - camX;
        const dz = iz - camZ;
        if (dx * dx + dz * dz < 30 * 30) this.spawnDust(ix, iz);
      }
      if (p.alive && !p.gliding && this.pushers.length < 8) {
        const dx = ix - camX;
        const dz = iz - camZ;
        if (dx * dx + dz * dz < pushRange) {
          this.pushers.push({ x: ix, z: iz, radius: GRASS_PUSH_RADIUS, strength: GRASS_PUSH });
        }
      }
    }

    // Mobs
    const prevMobs = this.prevMobMap;
    const liveMobs = new Set<number>();
    for (const m of next.mobs) {
      liveMobs.add(m.id);
      let view = this.mobs.get(m.id);
      if (!view) {
        view = new MobView(m.elite, m.id, m.level);
        this.mobs.set(m.id, view);
        this.scene.add(view.group);
      }
      if (beyond(m.x, m.z, MOB_DRAW_DIST)) {
        view.group.visible = false;
        continue;
      }
      view.group.visible = true;
      const pm = prevMobs.get(m.id) ?? m;
      const mx = lerp(pm.x, m.x, t);
      const mz = lerp(pm.z, m.z, t);
      view.update(mx, mz, lerpAngle(pm.facing, m.facing, t), m.hp / m.maxHp, camera, dt);
      if (this.pushers.length < 8 && (mx - camX) * (mx - camX) + (mz - camZ) * (mz - camZ) < pushRange) {
        this.pushers.push({ x: mx, z: mz, radius: m.elite ? 2.2 : 1.2, strength: m.elite ? 0.7 : 0.4 });
      }
    }
    for (const [id, view] of this.mobs) {
      if (!liveMobs.has(id)) {
        this.scene.remove(view.group);
        this.mobs.delete(id);
      }
    }

    // Chests (static; only lid state changes)
    for (const c of next.chests) {
      let view = this.chests.get(c.id);
      if (!view) {
        view = new ChestView(this.assets, c.x, c.z);
        this.chests.set(c.id, view);
        this.scene.add(view.group);
      }
      view.group.visible = !beyond(c.x, c.z, CHEST_DRAW_DIST);
      view.setOpened(c.opened);
      if (view.group.visible) view.animate(now);
    }

    // Scrolls: a rarity-colored gem with the spell's icon floating above it,
    // so you can tell what dropped from across the fight.
    const liveScrolls = new Set<number>();
    for (const s of next.scrolls) {
      liveScrolls.add(s.id);
      let view = this.scrolls.get(s.id);
      if (!view) {
        const group = new THREE.Group();
        const spin = new THREE.Group();
        const gem = new THREE.Mesh(this.scrollGeo, gemMaterial(s.rarity));
        spin.add(gem);
        const icon = new THREE.Sprite(iconMaterial('ability', s.abilityId));
        icon.scale.set(0.8, 0.8, 1);
        icon.position.y = 0.95;
        spin.add(icon);
        group.add(spin);
        // The rarity beam stands still while the gem spins inside it.
        const beam = new THREE.Mesh(BEAM_GEO, beamMaterial(s.rarity));
        beam.position.y = -0.8;
        beam.renderOrder = 2;
        group.add(beam);
        view = { group, spin };
        this.scrolls.set(s.id, view);
        this.scene.add(group);
      }
      if (beyond(s.x, s.z, PICKUP_DRAW_DIST)) {
        view.group.visible = false;
        continue;
      }
      view.group.visible = true;
      view.group.position.set(s.x, groundAt(s.x, s.z) + 0.85 + Math.sin(now * 2.2 + s.id) * 0.12, s.z);
      view.spin.rotation.y = now * 1.6 + s.id;
    }
    for (const [id, view] of this.scrolls) {
      if (!liveScrolls.has(id)) {
        // Gem, glyph, and beam materials are cached and shared — nothing to dispose.
        this.scene.remove(view.group);
        this.scrolls.delete(id);
      }
    }

    // Items: supply barrels with the consumable's icon floating above.
    const liveItems = new Set<number>();
    for (const it of next.items) {
      liveItems.add(it.id);
      let group = this.items.get(it.id);
      if (!group) {
        group = new THREE.Group();
        group.add(this.assets.modelAtHeight('barrel', 0.75));
        const icon = new THREE.Sprite(iconMaterial('item', it.itemId));
        icon.scale.set(0.7, 0.7, 1);
        icon.position.y = 1.25;
        group.add(icon);
        this.items.set(it.id, group);
        this.scene.add(group);
      }
      if (beyond(it.x, it.z, PICKUP_DRAW_DIST)) {
        group.visible = false;
        continue;
      }
      group.visible = true;
      group.position.set(it.x, groundAt(it.x, it.z) + 0.05 + Math.sin(now * 2 + it.id) * 0.05, it.z);
      group.rotation.y = now * 1.2 + it.id;
    }
    for (const [id, group] of this.items) {
      if (!liveItems.has(id)) {
        // Model materials are shared with the asset templates — leave them be.
        this.scene.remove(group);
        this.items.delete(id);
      }
    }

    // Coins
    const liveCoins = new Set<number>();
    for (const c of next.coins) {
      liveCoins.add(c.id);
      let mesh = this.coins.get(c.id);
      if (!mesh) {
        mesh = new THREE.Mesh(this.coinGeo, this.coinMat);
        mesh.rotation.x = Math.PI / 2;
        this.coins.set(c.id, mesh);
        this.scene.add(mesh);
      }
      if (beyond(c.x, c.z, PICKUP_DRAW_DIST)) {
        mesh.visible = false;
        continue;
      }
      mesh.visible = true;
      mesh.position.set(c.x, groundAt(c.x, c.z) + 0.35, c.z);
      mesh.rotation.z = now * 2 + c.id;
    }
    for (const [id, mesh] of this.coins) {
      if (!liveCoins.has(id)) {
        this.scene.remove(mesh);
        this.coins.delete(id);
      }
    }

    // Projectiles: each look animates itself (spin, sparks, tumbling rings).
    const prevProj = this.prevProjMap;
    const liveProj = new Set<number>();
    for (const proj of next.projectiles) {
      liveProj.add(proj.id);
      let view = this.projectiles.get(proj.id);
      if (!view) {
        view = makeProjectileView(proj.abilityId);
        this.projectiles.set(proj.id, view);
        this.scene.add(view.obj);
      }
      const pp = prevProj.get(proj.id) ?? proj;
      const px = lerp(pp.x, proj.x, t);
      const pz = lerp(pp.z, proj.z, t);
      view.obj.position.set(px, groundAt(px, pz) + 1.1, pz);
      view.obj.rotation.y = Math.atan2(proj.dirX, proj.dirZ);
      view.anim(now);
    }
    for (const [id, view] of this.projectiles) {
      if (!liveProj.has(id)) {
        // Geometries and materials are shared per ability — nothing to dispose.
        this.scene.remove(view.obj);
        this.projectiles.delete(id);
      }
    }

    // Zones: orange telegraphs that fill in, green persistent pools. Shared
    // unit geometries, scaled per zone; only the two small materials are owned.
    const liveZones = new Set<number>();
    for (const zone of next.zones) {
      liveZones.add(zone.id);
      let view = this.zones.get(zone.id);
      if (!view) {
        let color: number;
        let fillColor: number;
        const tinted = ZONE_COLORS[zone.abilityId];
        if (tinted) {
          [color, fillColor] = tinted;
        } else if (zone.kind === 'trap') {
          [color, fillColor] = [0xb8bcc8, 0x6a6f7d];
        } else if (zone.kind === 'pool') {
          [color, fillColor] = [0xff8c5e, 0xd45a2e];
        } else {
          [color, fillColor] = [0xffb14d, 0xff8c2e];
        }
        const group = new THREE.Group();
        const outline = new THREE.Mesh(
          ZONE_RING_GEO,
          new THREE.MeshBasicMaterial({ color, transparent: true, opacity: 0.9 }),
        );
        outline.rotation.x = -Math.PI / 2;
        outline.scale.setScalar(zone.radius);
        const fill = new THREE.Mesh(
          ZONE_FILL_GEO,
          new THREE.MeshBasicMaterial({
            color: fillColor,
            transparent: true,
            opacity: zone.kind === 'pool' ? 0.4 : zone.kind === 'trap' ? 0.25 : 0.3,
          }),
        );
        fill.rotation.x = -Math.PI / 2;
        fill.scale.setScalar(zone.radius);
        group.add(outline, fill);
        const zoneY = groundAt(zone.x, zone.z);
        group.position.set(zone.x, zoneY + 0.06, zone.z);
        view = { group, fill, outline, radius: zone.radius, kind: zone.kind };
        this.zones.set(zone.id, view);
        this.scene.add(group);
        // Spell-specific dressing on top of the telegraph/pool disc.
        let dressing: THREE.Object3D | null = null;
        if (zone.abilityId === 'starBomb' && zone.kind === 'telegraph') {
          this.addFx(meteor(zone.x, zoneY, zone.z, Math.max(0.2, zone.endsIn), this.glowSprite));
        } else if (zone.abilityId === 'snowdrift' && zone.kind === 'pool') {
          dressing = snowfall(zone.x, zoneY + 0.1, zone.z, zone.radius, this.glowSprite);
        } else if (zone.abilityId === 'explosiveCaltrops' && zone.kind === 'pool') {
          dressing = caltrops(zone.x, groundAt, zone.z, zone.radius);
        } else if (zone.kind === 'trap') {
          dressing = bearTrap(zone.x, zoneY + 0.02, zone.z, zone.radius);
        }
        if (dressing) {
          this.zoneDressing.set(zone.id, dressing);
          this.scene.add(dressing);
        }
      }
      if (zone.kind === 'telegraph') {
        const telegraph = ABILITIES[zone.abilityId].telegraph ?? 1;
        const progress = 1 - Math.min(1, zone.endsIn / telegraph);
        view.fill.scale.setScalar(Math.max(0.01, progress) * view.radius);
        (view.fill.material as THREE.MeshBasicMaterial).opacity = 0.3 + 0.15 * Math.sin(now * 18);
        // The rim breathes urgently while the strike winds up.
        view.outline.scale.setScalar(view.radius * (1 + 0.035 * Math.sin(now * 12)));
      } else {
        (view.fill.material as THREE.MeshBasicMaterial).opacity =
          0.35 + 0.1 * Math.sin(now * 6 + zone.id);
      }
    }
    for (const [id, view] of this.zones) {
      if (!liveZones.has(id)) {
        this.scene.remove(view.group);
        (view.fill.material as THREE.Material).dispose();
        (view.outline.material as THREE.Material).dispose();
        this.zones.delete(id);
        this.removeZoneDressing(id, view);
      }
    }

    this.updateEffects(dt);
    this.updateFx(dt);
  }

  private removeZoneDressing(id: number, view: { group: THREE.Group; radius: number; kind: string }, silent = false): void {
    const dressing = this.zoneDressing.get(id);
    if (!dressing) return;
    this.zoneDressing.delete(id);
    this.scene.remove(dressing);
    const x = view.group.position.x;
    const z = view.group.position.z;
    if (dressing instanceof THREE.Points) {
      dressing.geometry.dispose();
      (dressing.material as THREE.Material).dispose();
    } else if (silent) {
      // Match teardown: no farewell puffs.
    } else if (view.kind === 'trap') {
      // Sprung or expired: the jaws snap shut in a puff.
      this.spawnFlash(x, z, 0.8, ELEMENT_PALETTE.physical.glow, 0.15);
      this.spawnElementBurst(x, z, 'physical', 0.7);
    } else if (view.kind === 'pool') {
      // Caltrops go up in flame when the pool ends.
      this.spawnBurst(x, z, view.radius, ELEMENT_PALETTE.fire.core, 0.35);
      this.spawnElementBurst(x, z, 'fire', view.radius * 0.5);
    }
  }

  private addFx(handle: FxHandle): void {
    this.scene.add(handle.obj);
    this.fx.push(handle);
  }

  private updateFx(dt: number): void {
    let alive = 0;
    for (const h of this.fx) {
      h.age += dt;
      if (h.age >= h.ttl) {
        this.scene.remove(h.obj);
        h.dispose();
        continue;
      }
      h.tick(Math.min(1, h.age / h.ttl), dt);
      this.fx[alive++] = h;
    }
    this.fx.length = alive;
  }

  handleEvents(events: GameEvent[], selfId: number, snap: Snapshot): void {
    const playerById = new Map(snap.players.map((p) => [p.id, p]));
    for (const ev of events) {
      switch (ev.type) {
        case 'cast':
          this.players.get(ev.casterId)?.triggerCast(ev.abilityId);
          switch (ev.abilityId) {
            case 'quakingLeap':
            case 'explosiveCaltrops':
              this.spawnBurst(ev.x, ev.z, 1.6, elementOf(ev.abilityId).glow, 0.35); // dust kick at takeoff
              break;
            case 'slicingWinds':
              this.spawnBurst(ev.x, ev.z, 1.6, ELEMENT_PALETTE.wind.glow, 0.35); // gust kicked up at the lunge
              break;
            case 'rimeArrow':
            case 'snowdrift':
              this.spawnFlash(ev.x, ev.z, 0.9, ELEMENT_PALETTE.frost.glow, 0.16);
              break;
            case 'earthbreaker':
              this.spawnBurst(ev.x, ev.z, 1.4, ELEMENT_PALETTE.earth.core, 0.3);
              break;
            case 'fireWhirl':
              this.spawnBurst(ev.x, ev.z, 1.2, ELEMENT_PALETTE.fire.core, 0.3);
              break;
            case 'searingAxe': {
              // The axe itself, molten, chopped through the arc — and the
              // lava it spews forward along the facing.
              this.spawnBurst(ev.x, ev.z, 1.2, ELEMENT_PALETTE.fire.core, 0.3);
              const caster = playerById.get(ev.casterId);
              if (caster) this.spawnMeleeArc(ev.x, ev.z, caster.facing, 1, ELEMENT_PALETTE.fire.glow);
              this.players.get(ev.casterId)?.attach(searingAxe());
              this.spawnElementBurst(ev.x, ev.z, 'fire', 0.9);
              break;
            }
            case 'toxicSmackerel': {
              // The fish itself, whipped through the arc, plus its slime.
              const caster = playerById.get(ev.casterId);
              if (caster) {
                this.spawnMeleeArc(ev.x, ev.z, caster.facing, 1, ELEMENT_PALETTE.nature.glow);
                this.addFx(fishSlap(ev.x, groundAt(ev.x, ev.z), ev.z, caster.facing));
              }
              this.spawnElementBurst(ev.x, ev.z, 'nature', 0.8);
              break;
            }
            case 'fadeToShadow':
              this.spawnBurst(ev.x, ev.z, 1.4, ELEMENT_PALETTE.shadow.core, 0.45, 0.8); // shadow puff at origin
              this.spawnElementBurst(ev.x, ev.z, 'shadow', 0.9);
              this.players.get(ev.casterId)?.expectBlink();
              break;
            case 'repel':
              this.spawnFlash(ev.x, ev.z, 1.5, ELEMENT_PALETTE.arcane.glow, 0.3); // arcane ward shimmers up
              this.addFx(shockwave(ev.x, groundAt(ev.x, ev.z), ev.z, 5, ELEMENT_PALETTE.arcane.glow, 0.5));
              break;
            case 'faeform':
              this.spawnBurst(ev.x, ev.z, 1.4, 0xe98fd8, 0.4, 1.0); // fae's own pink, not plain nature-green
              break;
            case 'celestialBarrage':
              this.spawnFlash(ev.x, ev.z, 1.4, ELEMENT_PALETTE.arcane.glow, 0.3); // starlight gathers
              break;
            case 'stormArchon':
              // The caster becomes the archon for a beat: lightning crawls
              // over the body while the volley flies. Yellow spark snapping
              // off the blue charge — the electric two-tone.
              this.spawnFlash(ev.x, ev.z, 1.1, ELEMENT_PALETTE.electric.core, 0.16);
              this.spawnFlash(ev.x, ev.z, 0.6, ELEMENT_PALETTE.electric.glow, 0.12);
              this.players.get(ev.casterId)?.attach(archonArcs(lightningArcs(4, 6, 0.8)));
              break;
            case 'lightningBulwark':
              this.spawnFlash(ev.x, ev.z, 1.3, ELEMENT_PALETTE.electric.core, 0.3);
              this.spawnFlash(ev.x, ev.z, 0.7, ELEMENT_PALETTE.electric.glow, 0.15);
              break;
            default:
              this.spawnElementBurst(ev.x, ev.z, elementKeyOf(ev.abilityId));
          }
          sfx.cast(ev.abilityId, ev);
          break;
        case 'chargeRelease': {
          // Bigger flash the longer the charge was held, tinted by element.
          const color = elementOf(ev.abilityId).glow;
          this.spawnBurst(ev.x, ev.z, 1.2 + ev.fraction * 1.6, color, 0.3);
          this.spawnFlash(ev.x, ev.z, 1.0 + ev.fraction, color, 0.2);
          // Earthbreaker drops the body into the blow; a wind dash streaks.
          if (ev.abilityId === 'earthbreaker') this.players.get(ev.casterId)?.slam();
          if (ev.abilityId === 'slicingWinds') {
            const caster = playerById.get(ev.casterId);
            if (caster) this.spawnMeleeArc(ev.x, ev.z, caster.facing, 1, ELEMENT_PALETTE.wind.glow);
          }
          sfx.cast(ev.abilityId, ev);
          break;
        }
        case 'melee': {
          this.spawnMeleeArc(ev.x, ev.z, ev.facing, ev.combo);
          this.players.get(ev.casterId)?.triggerSwing(ev.combo);
          // The two-handed finisher shakes the ground.
          if (ev.combo === 3) this.addFx(shockwave(ev.x, groundAt(ev.x, ev.z), ev.z, 2.6, 0xffe38a, 0.35));
          sfx.melee(ev.combo, ev);
          break;
        }
        case 'detonate': {
          const groundY = groundAt(ev.x, ev.z);
          if (ev.abilityId === 'starBomb') {
            // The meteor lands: a column of light, a shockwave, and stardust.
            this.spawnColumn(ev.x, ev.z, 0.5, 16, ELEMENT_PALETTE.arcane.glow, 0.25);
            this.spawnBurst(ev.x, ev.z, ev.radius, ELEMENT_PALETTE.arcane.core, 0.35);
            this.addFx(shockwave(ev.x, groundY, ev.z, ev.radius * 1.4, ELEMENT_PALETTE.arcane.glow, 0.55));
            this.addFx(crackDecal(ev.x, groundY, ev.z, ev.radius * 0.7, ELEMENT_PALETTE.arcane.glow, 3));
            this.spawnElementBurst(ev.x, ev.z, 'arcane', ev.radius * 0.5);
            this.spawnFlash(ev.x, ev.z, ev.radius * 0.5, 0xffffff, 0.12);
          } else if (ev.abilityId === 'snowdrift') {
            this.spawnBurst(ev.x, ev.z, ev.radius, ELEMENT_PALETTE.frost.glow, 0.4);
            this.spawnElementBurst(ev.x, ev.z, 'frost', ev.radius * 0.5);
          } else if (ev.abilityId === 'earthbreaker') {
            // The earth heaves: spikes tear up through a fractured ring.
            this.spawnBurst(ev.x, ev.z, ev.radius, ELEMENT_PALETTE.earth.core, 0.4);
            this.spawnFlash(ev.x, ev.z, ev.radius * 0.5, ELEMENT_PALETTE.earth.glow, 0.25);
            this.spawnElementBurst(ev.x, ev.z, 'earth', ev.radius * 0.6);
            this.addFx(rockSpikes(ev.x, groundAt, ev.z, ev.radius, 10, 1.8));
            this.addFx(crackDecal(ev.x, groundY, ev.z, ev.radius, ELEMENT_PALETTE.earth.glow, 3));
            this.addFx(shockwave(ev.x, groundY, ev.z, ev.radius * 1.3, ELEMENT_PALETTE.earth.glow, 0.4));
          } else if (ev.abilityId === 'quakingLeap') {
            this.spawnBurst(ev.x, ev.z, ev.radius, ELEMENT_PALETTE.earth.glow, 0.35);
            this.spawnElementBurst(ev.x, ev.z, 'earth', ev.radius * 0.5);
            this.addFx(rockSpikes(ev.x, groundAt, ev.z, ev.radius * 0.9, 6, 1.2));
            this.addFx(shockwave(ev.x, groundY, ev.z, ev.radius * 1.4, ELEMENT_PALETTE.earth.glow, 0.4));
            this.addFx(crackDecal(ev.x, groundY, ev.z, ev.radius * 0.8, ELEMENT_PALETTE.earth.glow, 2));
          } else if (ev.abilityId === 'steelTraps') {
            this.spawnFlash(ev.x, ev.z, 1.0, ELEMENT_PALETTE.physical.glow, 0.2);
          } else {
            this.spawnElementBurst(ev.x, ev.z, elementKeyOf(ev.abilityId), ev.radius * 0.5);
            this.spawnFlash(ev.x, ev.z, ev.radius * 0.6, elementOf(ev.abilityId).glow, 0.25);
          }
          sfx.impact(ev.abilityId, ev);
          break;
        }
        case 'hit':
          if (ev.sourceId !== null) {
            this.spawnFlash(ev.x, ev.z, 0.8, 0xff5b4d, 0.18);
            this.players.get(ev.targetId)?.flashHit();
            this.mobs.get(ev.targetId)?.flashHit();
          }
          if (ev.sourceId !== null && ev.amount > 3) sfx.hit(ev);
          break;
        case 'projectileGone': {
          // Spend the projectile in its own color, sized to the spell, plus
          // a small element-flavored scatter so impacts read distinctly.
          const element = elementKeyOf(ev.abilityId);
          const color = PROJECTILE_COLORS[ev.abilityId] ?? ELEMENT_PALETTE[element].core;
          this.spawnFlash(ev.x, ev.z, 0.7, color, 0.16);
          this.spawnElementBurst(ev.x, ev.z, element, 0.6);
          sfx.impact(ev.abilityId, ev);
          if (ev.abilityId === 'stormArchon') {
            this.spawnFlash(ev.x, ev.z, 0.4, ELEMENT_PALETTE.electric.glow, 0.1); // yellow spark on impact
          }
          if (ev.abilityId === 'manaSphere' || ev.abilityId === 'windstorm') {
            this.spawnBurst(ev.x, ev.z, 1.3, color, 0.25);
          }
          break;
        }
        case 'death':
          // The construct comes apart: a storm-colored flash and scattered sparks.
          this.spawnBurst(ev.x, ev.z, 2.2, 0x3a3a4a, 0.6);
          this.spawnFlash(ev.x, ev.z, 1.6, ELEMENT_PALETTE.electric.core, 0.25);
          this.spawnElementBurst(ev.x, ev.z, 'electric', 1.4);
          this.spawnElementBurst(ev.x, ev.z, 'arcane', 1.2);
          sfx.death(ev.id === selfId, ev);
          break;
        case 'revived':
          this.spawnBurst(ev.x, ev.z, 2.0, ALLY_COLOR, 0.5);
          sfx.revive(ev);
          break;
        case 'mobDeath':
          this.spawnBurst(ev.x, ev.z, ev.elite ? 2.6 : 1.4, ev.elite ? 0xd4af37 : 0x8a6b3d, ev.elite ? 0.6 : 0.4);
          break;
        case 'chestOpened':
          this.spawnFlash(ev.x, ev.z, 1.4, 0xffd75e, 0.4);
          this.addFx(lightPillar(ev.x, groundAt(ev.x, ev.z), ev.z, 0xffd75e, 5, 0.8));
          sfx.chest(ev);
          break;
        case 'levelUp': {
          const p = playerById.get(ev.playerId);
          if (p) {
            this.spawnBurst(p.x, p.z, 2.5, 0xffd75e, 0.7);
            this.addFx(lightPillar(p.x, groundAt(p.x, p.z), p.z, 0xffd75e, 9, 1.1));
            this.addFx(shockwave(p.x, groundAt(p.x, p.z), p.z, 3.5, 0xffd75e, 0.5));
          }
          if (ev.playerId === selfId) sfx.levelUp();
          break;
        }
        case 'equip':
          if (ev.playerId === selfId) sfx.equip();
          break;
        case 'upgrade': {
          const p = playerById.get(ev.playerId);
          if (p) this.spawnBurst(p.x, p.z, 1.8, RARITY_COLORS[ev.rarity], 0.55, 1.2);
          if (ev.playerId === selfId) sfx.levelUp();
          break;
        }
        case 'coin':
          if (ev.playerId === selfId) sfx.coin();
          break;
        case 'heal':
          this.spawnBurst(ev.x, ev.z, 1.6, 0x5fce6a, 0.5, 1.6); // green ring floats upward
          this.spawnFlash(ev.x, ev.z, 1.0, 0x9df0a5, 0.3);
          sfx.heal(ev);
          break;
        case 'itemPickup':
          if (ev.playerId === selfId) sfx.equip();
          break;
        case 'itemUsed': {
          this.spawnBurst(ev.x, ev.z, 1.4, ITEMS[ev.itemId].color, 0.45, 1.0);
          const view = this.players.get(ev.playerId);
          const groundY = groundAt(ev.x, ev.z);
          switch (ev.itemId) {
            case 'chickenCoup':
              // A hen struts a lap around you, then gets devoured — feathers everywhere.
              view?.attach(chicken());
              this.spawnElementBurst(ev.x, ev.z, 'holy', 0.6);
              break;
            case 'smokeBomb':
              this.addFx(smokeCloud(ev.x, groundY, ev.z, this.glowSprite));
              break;
            case 'mechanoHog':
              // Rev the chopper: mount up in a cloud of dust.
              view?.attach(mechanoHog());
              this.spawnBurst(ev.x, ev.z, 1.6, 0xc9b48a, 0.4);
              this.spawnElementBurst(ev.x, ev.z, 'fire', 0.7);
              break;
            case 'gravityLauncher':
              this.addFx(launchPad(ev.x, groundY, ev.z));
              this.addFx(shockwave(ev.x, groundY, ev.z, 3.5, 0x7fd4ff, 0.4));
              this.addFx(lightPillar(ev.x, groundY, ev.z, 0x7fd4ff, 8, 0.6));
              break;
            case 'toTheSkies':
              view?.attach(rocketFlame());
              this.addFx(shockwave(ev.x, groundY, ev.z, 3, 0xffb347, 0.4));
              this.spawnBurst(ev.x, ev.z, 1.8, 0xd8c8a0, 0.5);
              this.spawnElementBurst(ev.x, ev.z, 'fire', 1.0);
              break;
          }
          if (ev.playerId === selfId) sfx.equip();
          break;
        }
        case 'pull': {
          const a = playerById.get(ev.casterId);
          const b = playerById.get(ev.targetId);
          if (a && b) {
            this.addFx(chainLine(
              new THREE.Vector3(a.x, groundAt(a.x, a.z) + 1.1, a.z),
              new THREE.Vector3(b.x, groundAt(b.x, b.z) + 1.0, b.z),
            ));
          }
          break;
        }
        case 'diveImpact':
          this.spawnBurst(ev.x, ev.z, 2.4, 0xc9b48a, 0.5);
          this.spawnFlash(ev.x, ev.z, 1.6, 0xfff2d0, 0.2);
          this.addFx(shockwave(ev.x, groundAt(ev.x, ev.z), ev.z, 4, 0xe8d8b0, 0.4));
          this.addFx(crackDecal(ev.x, groundAt(ev.x, ev.z), ev.z, 2.2, 0xe8d8b0, 2));
          sfx.diveImpact(ev.x, ev.z, ev.playerId === selfId);
          break;
      }
    }
  }

  /** A sweeping front arc: the slap's wave, and cone spells in their color. */
  private spawnMeleeArc(x: number, z: number, facing: number, combo: number, color?: number): void {
    const mat = new THREE.MeshBasicMaterial({
      color: color ?? (combo === 3 ? 0xffe38a : 0xe8e6d9),
      transparent: true,
      opacity: 0.75,
      side: THREE.DoubleSide,
    });
    const ring = new THREE.Mesh(MELEE_GEO, mat);
    // Lay the shared arc flat, then spin it to the caster's facing.
    ring.quaternion
      .setFromAxisAngle(X_AXIS, -Math.PI / 2)
      .premultiply(tmpQuat.setFromAxisAngle(Y_AXIS, facing));
    ring.position.set(x, groundAt(x, z) + 1, z);
    this.scene.add(ring);
    this.effects.push({ obj: ring, mat, age: 0, ttl: 0.16, growth: 0.15, baseX: 1, baseY: 1, baseZ: 1 });
  }

  private spawnChainLine(x1: number, z1: number, x2: number, z2: number): void {
    const mat = new THREE.LineBasicMaterial({ color: 0xd8d8e8, transparent: true, opacity: 0.9 });
    const geo = new THREE.BufferGeometry().setFromPoints([
      new THREE.Vector3(x1, groundAt(x1, z1) + 1.2, z1),
      new THREE.Vector3(x2, groundAt(x2, z2) + 1.2, z2),
    ]);
    const line = new THREE.Line(geo, mat);
    this.scene.add(line);
    this.effects.push({ obj: line, mat, age: 0, ttl: 0.25, growth: 0, baseX: 1, baseY: 1, baseZ: 1, ownsGeometry: true });
  }

  /**
   * A scatter of small particles shaped and moved after the element's own
   * motif (see ELEMENT_PARTICLE_SPEC) rather than one uniform blob — this is
   * what makes fire read as fire and shadow read as shadow beyond just hue.
   */
  private spawnElementBurst(x: number, z: number, element: Element, size = 1): void {
    const palette = ELEMENT_PALETTE[element];
    const spec = ELEMENT_PARTICLE_SPEC[element];
    const y = groundAt(x, z) + 0.4;
    const startRadius = spec.inward ? 1.4 * size : 0;
    for (let i = 0; i < spec.count; i++) {
      const angle = (i / spec.count) * Math.PI * 2 + Math.random() * 0.5;
      const dirX = Math.sin(angle);
      const dirZ = Math.cos(angle);
      const mat = new THREE.MeshBasicMaterial({
        color: i % 2 === 0 ? palette.core : palette.glow,
        transparent: true,
        opacity: 0.85,
        side: THREE.DoubleSide,
      });
      const mesh = new THREE.Mesh(spec.geo, mat);
      mesh.position.set(x + dirX * startRadius, y, z + dirZ * startRadius);
      mesh.rotation.set(Math.random() * Math.PI, Math.random() * Math.PI, Math.random() * Math.PI);
      this.scene.add(mesh);
      const jitter = 0.7 + Math.random() * 0.6;
      const sign = spec.inward ? -1 : 1;
      this.effects.push({
        obj: mesh,
        mat,
        age: 0,
        ttl: spec.ttl * (0.85 + Math.random() * 0.3),
        growth: spec.growth,
        baseX: size,
        baseY: size,
        baseZ: size,
        vx: dirX * spec.speed * jitter * sign,
        vz: dirZ * spec.speed * jitter * sign,
        rise: spec.rise * size,
        spin: spec.spin * (Math.random() < 0.5 ? 1 : -1),
      });
    }
  }

  /** A trail puff behind a moving character, styled by what's moving them. */
  private spawnTrail(x: number, y: number, z: number, kind: TrailKind): void {
    const style =
      kind === 'wind'
        ? { color: 0xdafff0, opacity: 0.5, size: 0.8, ttl: 0.3, rise: 0.2, growth: 1.2 }
        : kind === 'fae'
          ? { color: 0xffb0e8, opacity: 0.9, size: 0.35, ttl: 0.55, rise: 0.7, growth: -0.6 }
          : kind === 'air'
            ? { color: 0xe8e8f0, opacity: 0.4, size: 0.6, ttl: 0.5, rise: 0.1, growth: 1.4 }
            : { color: 0xcfc2a0, opacity: 0.35, size: 0.6, ttl: 0.4, rise: 0.4, growth: 1.6 };
    const mat = new THREE.SpriteMaterial({
      map: glowTexture,
      color: style.color,
      transparent: true,
      opacity: style.opacity,
      depthWrite: false,
      blending: kind === 'fae' || kind === 'wind' ? THREE.AdditiveBlending : THREE.NormalBlending,
    });
    const puff = new THREE.Sprite(mat);
    puff.position.set(x + (Math.random() - 0.5) * 0.4, y + (kind === 'roll' ? 0.2 : 0.9) + (Math.random() - 0.5) * 0.3, z + (Math.random() - 0.5) * 0.4);
    this.scene.add(puff);
    this.effects.push({
      obj: puff, mat, age: 0, ttl: style.ttl, growth: style.growth, baseX: style.size, baseY: style.size, baseZ: 1, rise: style.rise, maxOpacity: style.opacity,
    });
  }

  /** One soft dust puff at ground level: footsteps and scuffs. */
  private spawnDust(x: number, z: number): void {
    const mat = new THREE.SpriteMaterial({
      map: glowTexture,
      color: 0xcfc2a0,
      transparent: true,
      opacity: 0.35,
      depthWrite: false,
    });
    const puff = new THREE.Sprite(mat);
    puff.position.set(x + (Math.random() - 0.5) * 0.3, groundAt(x, z) + 0.15, z + (Math.random() - 0.5) * 0.3);
    this.scene.add(puff);
    this.effects.push({ obj: puff, mat, age: 0, ttl: 0.4, growth: 1.6, baseX: 0.5, baseY: 0.5, baseZ: 1, rise: 0.5, maxOpacity: 0.35 });
  }

  private spawnFlash(x: number, z: number, size: number, color: number, ttl: number): void {
    // Flashes are additive light, run hot (HDR) so the bloom pass haloes them.
    const mat = new THREE.MeshBasicMaterial({
      color,
      transparent: true,
      opacity: 0.85,
      blending: THREE.AdditiveBlending,
      depthWrite: false,
    });
    mat.color.multiplyScalar(1.4);
    const mesh = new THREE.Mesh(FLASH_GEO, mat);
    mesh.position.set(x, groundAt(x, z) + 1, z);
    this.scene.add(mesh);
    this.effects.push({ obj: mesh, mat, age: 0, ttl, growth: 1.5, baseX: size, baseY: size, baseZ: size });
  }

  private spawnBurst(x: number, z: number, radius: number, color: number, ttl: number, rise = 0): void {
    const mat = new THREE.MeshBasicMaterial({
      color,
      transparent: true,
      opacity: 0.7,
      side: THREE.DoubleSide,
    });
    mat.color.multiplyScalar(1.35);
    const mesh = new THREE.Mesh(BURST_GEO, mat);
    mesh.position.set(x, groundAt(x, z) + 0.3, z);
    this.scene.add(mesh);
    this.effects.push({ obj: mesh, mat, age: 0, ttl, growth: 2.2, rise, baseX: radius, baseY: 1, baseZ: radius });
  }

  private spawnColumn(x: number, z: number, radius: number, height: number, color: number, ttl: number): void {
    const mat = new THREE.MeshBasicMaterial({ color, transparent: true, opacity: 0.95 });
    const mesh = new THREE.Mesh(COLUMN_GEO, mat);
    mesh.position.set(x, groundAt(x, z) + height / 2, z);
    this.scene.add(mesh);
    this.effects.push({ obj: mesh, mat, age: 0, ttl, growth: 0.4, baseX: radius, baseY: height, baseZ: radius });
  }

  private updateEffects(dt: number): void {
    const survivors: Effect[] = [];
    for (const fx of this.effects) {
      fx.age += dt;
      const t = fx.age / fx.ttl;
      if (t >= 1) {
        this.scene.remove(fx.obj);
        this.disposeEffect(fx);
        continue;
      }
      const s = Math.max(0.001, 1 + fx.growth * t);
      fx.obj.scale.set(fx.baseX * s, fx.baseY * s, fx.baseZ * s);
      if (fx.rise) fx.obj.position.y += fx.rise * dt;
      if (fx.vx) fx.obj.position.x += fx.vx * dt;
      if (fx.vz) fx.obj.position.z += fx.vz * dt;
      if (fx.spin) {
        fx.obj.rotation.x += fx.spin * dt;
        fx.obj.rotation.y += fx.spin * 0.7 * dt;
      }
      fx.mat.opacity = (1 - t) * (fx.maxOpacity ?? 0.85);
      survivors.push(fx);
    }
    this.effects = survivors;
  }

  private disposeEffect(fx: Effect): void {
    fx.mat.dispose();
    if (fx.ownsGeometry) ((fx.obj as THREE.Mesh).geometry as THREE.BufferGeometry).dispose();
  }

  clear(): void {
    for (const view of this.players.values()) this.scene.remove(view.group);
    for (const view of this.mobs.values()) this.scene.remove(view.group);
    for (const view of this.chests.values()) this.scene.remove(view.group);
    for (const view of this.scrolls.values()) this.scene.remove(view.group);
    for (const mesh of this.coins.values()) this.scene.remove(mesh);
    for (const mesh of this.items.values()) this.scene.remove(mesh);
    for (const view of this.projectiles.values()) this.scene.remove(view.obj);
    for (const view of this.zones.values()) {
      this.scene.remove(view.group);
      (view.fill.material as THREE.Material).dispose();
      (view.outline.material as THREE.Material).dispose();
    }
    for (const fx of this.effects) {
      this.scene.remove(fx.obj);
      this.disposeEffect(fx);
    }
    for (const h of this.fx) {
      this.scene.remove(h.obj);
      h.dispose();
    }
    this.fx = [];
    for (const [id, view] of this.zones) this.removeZoneDressing(id, view, true);
    this.zoneDressing.clear();
    this.players.clear();
    this.mobs.clear();
    this.chests.clear();
    this.scrolls.clear();
    this.coins.clear();
    this.items.clear();
    this.projectiles.clear();
    this.zones.clear();
    this.effects = [];
  }
}
