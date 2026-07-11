import * as THREE from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import {
  ABILITIES,
  ARENA,
  ITEMS,
  groundHeight,
  lerp,
  type AbilityId,
  type GameEvent,
  type Rarity,
  type Snapshot,
} from '@claudestorm/shared';
import { sfx } from '../sfx.js';
import type { AssetLibrary } from './assets.js';

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
const DEAD_COLOR = 0x50505a;
const SLOW_COLOR = 0x9fd8ff;
const MOB_COLOR = 0x8a6b3d;
const ELITE_COLOR = 0x9c3f3f;
const SWING_DURATION = 0.28;

export const RARITY_COLORS: Record<Rarity, number> = {
  common: 0xb8b5a5,
  uncommon: 0x4bc26b,
  rare: 0x4d9be6,
  epic: 0xb05df0,
};

/** Glyphs rendered to textures, so drops show what they are at a glance. */
const glyphTextures = new Map<string, THREE.Texture>();
function glyphTexture(glyph: string): THREE.Texture {
  let tex = glyphTextures.get(glyph);
  if (!tex) {
    const canvas = document.createElement('canvas');
    canvas.width = canvas.height = 128;
    const ctx = canvas.getContext('2d')!;
    ctx.font = '96px serif';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText(glyph, 64, 72);
    tex = new THREE.CanvasTexture(canvas);
    glyphTextures.set(glyph, tex);
  }
  return tex;
}

const PROJECTILE_COLORS: Partial<Record<AbilityId, number>> = {
  rimeArrow: 0x7fd4ff,
  holyShield: 0xffe9a8,
  stormArchon: 0x8fd0ff,
  manaSphere: 0x7a8cff,
  huntersChains: 0xd8d8e8,
  windstorm: 0xcfe8dd,
  celestialBarrage: 0xd8c8ff,
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
      emissiveIntensity: 0.6,
    });
    gemMats.set(rarity, mat);
  }
  return mat;
}

const glyphMats = new Map<string, THREE.SpriteMaterial>();
function glyphMaterial(glyph: string): THREE.SpriteMaterial {
  let mat = glyphMats.get(glyph);
  if (!mat) {
    mat = new THREE.SpriteMaterial({ map: glyphTexture(glyph), transparent: true, depthWrite: false });
    glyphMats.set(glyph, mat);
  }
  return mat;
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

// Wisp: one smooth ghost-robe silhouette under a faceless helm.
const WISP_BODY_GEO = new THREE.LatheGeometry(
  [
    [0.02, 0.0], [0.10, 0.06], [0.20, 0.16], [0.30, 0.30], [0.365, 0.48],
    [0.375, 0.66], [0.335, 0.88], [0.315, 1.06], [0.325, 1.22], [0.30, 1.36],
    [0.22, 1.50], [0.11, 1.58], [0.0, 1.61],
  ].map(([r, y]) => new THREE.Vector2(r!, y!)),
  24,
);
WISP_BODY_GEO.translate(0, -0.8, 0); // pivot mid-body
const WISP_HELM_GEO = new THREE.SphereGeometry(0.345, 18, 10, 0, Math.PI * 2, 0, Math.PI * 0.58);
const WISP_VISOR_GEO = new THREE.TorusGeometry(0.315, 0.038, 6, 12, 1.25);
WISP_VISOR_GEO.rotateZ(Math.PI / 2 - 0.625);
WISP_VISOR_GEO.rotateX(Math.PI / 2);
const WISP_CREST_GEO = new THREE.BoxGeometry(0.04, 0.24, 0.34);

// Spectral mask: a floating face plate, a core heart, and trailing rings.
const MASK_GEO = new THREE.SphereGeometry(0.34, 20, 14, 0, Math.PI);
MASK_GEO.scale(0.85, 1.3, 0.62);
const MASK_HORN_GEO = new THREE.TorusGeometry(0.2, 0.028, 6, 10, 1.9);
const TRAIL_RING_GEOS = [0.24, 0.17, 0.11].map((r) => {
  const geo = new THREE.TorusGeometry(r, 0.033, 6, 20);
  geo.rotateX(Math.PI / 2);
  return geo;
});
const CORE_GEO = new THREE.SphereGeometry(0.075, 12, 10);

// Slime: one smooth dome blob, translucent, with a glowing nucleus.
const SLIME_GEO = new THREE.LatheGeometry(
  [
    [0.02, 0.0], [0.3, 0.02], [0.42, 0.14], [0.44, 0.3], [0.38, 0.5],
    [0.26, 0.66], [0.12, 0.76], [0.0, 0.8],
  ].map(([r, y]) => new THREE.Vector2(r!, y!)),
  20,
);
SLIME_GEO.translate(0, -0.4, 0); // pivot mid-blob

/** Paraglider canopy: a squashed sphere slice, tinted per hero. */
const CHUTE_CANOPY_GEO = new THREE.SphereGeometry(1.5, 14, 6, 0, Math.PI * 2, 0, Math.PI * 0.42);
CHUTE_CANOPY_GEO.scale(1, 0.62, 0.85);
const CHUTE_LINE_GEO = new THREE.CylinderGeometry(0.012, 0.012, 1, 4);
const CHUTE_LINE_MAT = new THREE.MeshBasicMaterial({ color: 0x2a2a33 });

/** Scratch colors for per-frame tinting — never allocate in update(). */
const TINT = new THREE.Color();
const TINT_MIX = new THREE.Color();
const WHITE = new THREE.Color(0xffffff);

/** Selectable body designs; all share the slap hands and the same chassis. */
export type HeroModel = 'cloud' | 'wisp' | 'mask' | 'dust' | 'slime';
export const HERO_MODELS: { id: HeroModel; name: string }[] = [
  { id: 'cloud', name: 'Storm Cloud' },
  { id: 'wisp', name: 'Wisp' },
  { id: 'mask', name: 'Spectral Mask' },
  { id: 'dust', name: 'Dust Devil' },
  { id: 'slime', name: 'Slime' },
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
  private readonly aura: THREE.Mesh;
  private readonly hpGroup: THREE.Group;
  private readonly hpFill: THREE.Mesh;
  private deadFor = 0;
  private rollSpin = 0;
  private swingTimer = 0;
  private swingCombo = 1;
  private castTimer = 0;
  private bobPhase = 0;
  private deploy = 0;
  private lastX = Number.NaN;
  private lastZ = Number.NaN;
  private readonly base: number;
  private readonly glowBase = new THREE.Color();

  constructor(
    isSelf: boolean,
    isBot: boolean,
    selfColor: number = SELF_COLOR,
    model: HeroModel = 'cloud',
  ) {
    this.base = isSelf || !isBot ? selfColor : BOT_COLOR;
    this.glowBase.setHex(this.base).lerp(WHITE, 0.72);
    // Hands glow when they strike — the hero's "weapon" is a giant slap.
    this.handMat = new THREE.MeshStandardMaterial({
      color: new THREE.Color(this.base).lerp(WHITE, 0.3),
      roughness: 0.6,
      emissive: this.glowBase,
      emissiveIntensity: 0,
    });
    this.visorMat = new THREE.MeshBasicMaterial({ color: this.glowBase });

    // Pivot at mid-body so roll tumbles read naturally.
    this.bodyPivot.position.y = 1.0;
    if (model === 'wisp') this.buildWisp();
    else if (model === 'mask') this.buildMask();
    else if (model === 'dust') this.buildDust();
    else if (model === 'slime') this.buildSlime();
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

    this.shield = new THREE.Mesh(
      new THREE.SphereGeometry(1.15, 18, 14),
      new THREE.MeshBasicMaterial({ color: 0x9fc4e8, transparent: true, opacity: 0.3, depthWrite: false }),
    );
    this.shield.position.y = 1;
    this.shield.visible = false;
    this.group.add(this.shield);

    this.aura = new THREE.Mesh(
      new THREE.TorusGeometry(1, 0.22, 10, 32),
      new THREE.MeshBasicMaterial({ color: 0xff7b2e, transparent: true, opacity: 0.7 }),
    );
    this.aura.rotation.x = Math.PI / 2;
    this.aura.position.y = 0.9;
    this.aura.visible = false;
    this.group.add(this.aura);

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

  /** A smooth ghost-robe silhouette under a faceless crested helm. */
  private buildWisp(): void {
    const robeMat = this.tintable('plain', { roughness: 0.62 });
    const helmMat = this.tintable('dark', { metalness: 0.5, roughness: 0.35 });
    const body = new THREE.Mesh(WISP_BODY_GEO, robeMat);
    body.castShadow = true;
    this.bodyPivot.add(body);
    const helm = new THREE.Mesh(WISP_HELM_GEO, helmMat);
    helm.position.y = 0.5;
    helm.castShadow = true;
    this.bodyPivot.add(helm);
    const visor = new THREE.Mesh(WISP_VISOR_GEO, this.visorMat);
    visor.position.y = 0.45;
    this.bodyPivot.add(visor);
    const crest = new THREE.Mesh(WISP_CREST_GEO, helmMat);
    crest.position.set(0, 0.82, -0.04);
    crest.rotation.x = -0.3;
    this.bodyPivot.add(crest);

    this.baseScale = 0.86;
    this.handRestY = 0.28;
    this.animateBody = (bob, speed, _dt) => {
      body.rotation.z = Math.sin(bob * 0.8) * (0.04 + Math.min(0.05, speed * 0.006));
    };
  }

  /** A floating mask over a bright core, translucent rings trailing below. */
  private buildMask(): void {
    const maskMat = this.tintable('dark', {
      metalness: 0.45,
      roughness: 0.3,
      side: THREE.DoubleSide,
    });
    const ringMat = this.tintable('plain', { roughness: 0.55, depthWrite: false }, 0.42);
    const maskGroup = new THREE.Group();
    const plate = new THREE.Mesh(MASK_GEO, maskMat);
    plate.castShadow = true;
    maskGroup.add(plate);
    const visor = new THREE.Mesh(CLOUD_VISOR_GEO, this.visorMat);
    visor.position.set(0, 0.05, 0.05);
    maskGroup.add(visor);
    for (const side of [-1, 1]) {
      const horn = new THREE.Mesh(MASK_HORN_GEO, maskMat);
      horn.position.set(side * 0.2, 0.3, -0.06);
      horn.rotation.y = Math.PI / 2;
      horn.rotation.z = side * -0.45;
      horn.castShadow = true;
      maskGroup.add(horn);
    }
    maskGroup.position.y = 0.34;
    this.bodyPivot.add(maskGroup);
    const core = new THREE.Mesh(CORE_GEO, this.visorMat);
    core.position.y = -0.02;
    this.bodyPivot.add(core);
    const rings: THREE.Mesh[] = [];
    TRAIL_RING_GEOS.forEach((geo, i) => {
      const ring = new THREE.Mesh(geo, ringMat);
      ring.position.y = -0.22 - i * 0.2;
      rings.push(ring);
      this.bodyPivot.add(ring);
    });

    this.animateBody = (bob, _speed, dt) => {
      maskGroup.rotation.z = Math.sin(bob * 0.55) * 0.09;
      maskGroup.position.y = 0.34 + Math.sin(bob * 1.15 + 0.7) * 0.02;
      rings.forEach((ring, i) => {
        ring.rotation.y += dt * (0.8 + i * 0.5) * (i % 2 === 0 ? 1 : -1);
        ring.position.y = -0.22 - i * 0.2 + Math.sin(bob + i * 0.9) * 0.025;
      });
    };
  }

  /** A little whirlwind: two counter-rotating tiers of dust, always turning. */
  private buildDust(): void {
    const dustMat = this.tintable('light', { roughness: 1 });
    const darkMat = this.tintable('dark', { roughness: 1 });
    const swirlA = new THREE.Group();
    const swirlB = new THREE.Group();
    for (let i = 0; i < 10; i++) {
      const t = i / 9;
      const a = i * 2.4; // golden-angle spiral
      const r = 0.08 + t * 0.3; // narrow base, wide crown
      const puff = new THREE.Mesh(CLOUD_PUFF_GEO, i % 3 === 0 ? darkMat : dustMat);
      puff.position.set(Math.sin(a) * r, -0.45 + t * 0.95, Math.cos(a) * r);
      puff.scale.setScalar(0.09 + t * 0.14);
      puff.castShadow = i % 2 === 0;
      (i % 2 === 0 ? swirlA : swirlB).add(puff);
    }
    this.bodyPivot.add(swirlA, swirlB);
    const visor = new THREE.Mesh(CLOUD_VISOR_GEO, this.visorMat);
    visor.position.set(0, 0.3, 0.12);
    this.bodyPivot.add(visor);

    this.deathStyle = 'dissipate';
    this.animateBody = (bob, speed, dt) => {
      // Fluid: the vortex never stops turning, and speeds up with travel.
      const spin = 2.2 + Math.min(9, speed * 0.9);
      swirlA.rotation.y += dt * spin;
      swirlB.rotation.y -= dt * spin * 0.7;
      const sway = Math.sin(bob * 0.7) * 0.06;
      swirlA.rotation.z = sway;
      swirlB.rotation.z = -sway * 0.6;
    };
  }

  /** A grounded blob that hops and squash-stretches instead of hovering. */
  private buildSlime(): void {
    const slimeMat = this.tintable('plain', { roughness: 0.25, metalness: 0.05 }, 0.88);
    const blob = new THREE.Mesh(SLIME_GEO, slimeMat);
    blob.castShadow = true;
    this.bodyPivot.add(blob);
    const core = new THREE.Mesh(CORE_GEO, this.visorMat);
    core.position.y = -0.06;
    core.scale.setScalar(1.4);
    this.bodyPivot.add(core);
    const visor = new THREE.Mesh(CLOUD_VISOR_GEO, this.visorMat);
    visor.position.set(0, 0.08, 0.22);
    this.bodyPivot.add(visor);

    this.deathStyle = 'dissipate';
    this.animateBody = (bob, speed, _dt) => {
      // Fluid: hop along the ground with volume-preserving squash & stretch.
      const hop = Math.abs(Math.sin(bob * 1.3)) * Math.min(0.3, 0.04 + speed * 0.03);
      this.bodyPivot.position.y = 0.42 + hop;
      const amp = 0.05 + Math.min(0.09, speed * 0.009);
      const wobble = Math.sin(bob * 2.6) * amp;
      blob.scale.set(1 - wobble * 0.55, 1 + wobble, 1 - wobble * 0.55);
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
      rolling: boolean;
      shielded: boolean;
      stealthed: boolean;
      immune: boolean;
      fae: boolean;
      poisoned: boolean;
      auraActive: boolean;
      auraRadius: number;
    },
    isSelf: boolean,
    isBot: boolean,
    dt: number,
    camera: THREE.Camera,
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
      this.aura.visible = false;
      this.chute.visible = false;
      if (this.deadFor > 2.5) this.group.visible = false;
      return;
    }
    this.bodyPivot.scale.setScalar(this.baseScale);

    this.group.rotation.y = p.facing;
    this.shield.visible = p.shielded || p.immune;
    (this.shield.material as THREE.MeshBasicMaterial).color.setHex(
      p.immune ? 0xcfe0ff : 0x9fc4e8,
    );
    this.aura.visible = p.auraActive;
    if (p.auraActive) {
      this.aura.scale.setScalar(p.auraRadius);
      this.aura.rotation.z += dt * 6;
    }

    // Hover cycle driven by observed horizontal speed: faster bob on the move.
    const moved = Number.isNaN(this.lastX) ? 0 : Math.hypot(p.x - this.lastX, p.z - this.lastZ);
    this.lastX = p.x;
    this.lastZ = p.z;
    const speed = dt > 0 ? moved / dt : 0;
    const airborne = p.y > 0.08 && !p.gliding;
    this.bobPhase += dt * (2.4 + Math.min(9, speed * 1.1));
    this.bodyPivot.position.y = 1.0 + Math.sin(this.bobPhase) * (speed > 0.6 ? 0.06 : 0.035);
    this.animateBody(this.bobPhase, speed, dt);
    if (p.rolling) {
      this.rollSpin += dt * 18;
      this.bodyPivot.rotation.x = this.rollSpin;
    } else if (p.gliding) {
      this.rollSpin = 0;
      this.bodyPivot.rotation.x = -0.9;
    } else {
      this.rollSpin = 0;
      // Lean into the direction of travel; pull up a touch mid-jump.
      this.bodyPivot.rotation.x = airborne ? -0.12 : Math.min(0.2, speed * 0.018);
    }

    // Paraglider: pops open on deploy, then breathes and sways on the wind.
    this.chute.visible = p.gliding;
    if (p.gliding) {
      this.deploy = Math.min(1, this.deploy + dt / 0.4);
      const e = 1 - (1 - this.deploy) * (1 - this.deploy); // ease-out pop
      const breathe = 1 + Math.sin(this.bobPhase * 1.7) * 0.03;
      this.chute.scale.set((0.25 + 0.75 * e) * breathe, 0.25 + 0.75 * e, (0.25 + 0.75 * e) * breathe);
      this.chute.rotation.z = Math.sin(this.bobPhase * 1.1) * 0.08;
      this.chute.rotation.x = -0.12 + Math.sin(this.bobPhase * 0.8) * 0.05;
    } else {
      this.deploy = 0;
    }

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
    // Stealth: nearly invisible to enemies, ghostly to yourself.
    const opacity = p.stealthed ? (isSelf ? 0.4 : 0.12) : 1;
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
  }

  triggerCast(): void {
    this.castTimer = 0.35;
  }
}

class MobView {
  readonly group = new THREE.Group();
  private readonly hpFill: THREE.Mesh;
  private readonly hpGroup: THREE.Group;
  private readonly barWidth: number;
  private readonly elite: boolean;
  private readonly legs: THREE.Mesh[] = [];
  private walkPhase = 0;
  private lastX = Number.NaN;
  private lastZ = Number.NaN;

  constructor(elite: boolean, seed: number) {
    this.elite = elite;
    const beast = new THREE.Group();
    // Slight per-critter hue/lightness variation so packs don't look cloned.
    const hide = new THREE.Color(elite ? ELITE_COLOR : MOB_COLOR);
    hide.offsetHSL(((seed % 5) - 2) * 0.015, 0, ((seed % 3) - 1) * 0.04);
    const hideMat = new THREE.MeshStandardMaterial({ color: hide, roughness: 0.85 });
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
    const eyeMat = new THREE.MeshStandardMaterial({ color: 0x1a1208, roughness: 0.3 });
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
  }

  update(x: number, z: number, facing: number, hpFrac: number, camera: THREE.Camera, dt: number): void {
    this.group.position.set(x, groundAt(x, z), z);
    this.group.rotation.y = facing;

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
  private opened = false;

  constructor(assets: AssetLibrary, x: number, z: number) {
    // The pirate-kit chest ships with a separate hinged lid node.
    this.group = assets.model('chest');
    this.group.scale.setScalar(1.5 / Math.max(0.001, assets.size('chest').x));
    this.lid = this.group.getObjectByName('lid') ?? null;
    this.group.position.set(x, groundAt(x, z), z);
    this.group.rotation.y = (x * 7 + z * 13) % Math.PI;
  }

  setOpened(opened: boolean): void {
    if (opened === this.opened) return;
    this.opened = opened;
    if (this.lid) this.lid.rotation.x = opened ? -2.1 : 0;
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
  /** Set when the effect owns its geometry (chain lines) and must dispose it. */
  ownsGeometry?: boolean;
}

/** Per-ability projectile geometry (built once; anything unlisted is a glowing orb). */
function buildProjectileGeometry(abilityId: AbilityId): { geo: THREE.BufferGeometry; glow: number } {
  switch (abilityId) {
    case 'rimeArrow': {
      const geo = new THREE.ConeGeometry(0.16, 0.95, 8);
      geo.rotateX(Math.PI / 2); // point along +z so rotation.y aims it
      return { geo, glow: 1.6 };
    }
    case 'holyShield': {
      // Spinning golden disc.
      const geo = new THREE.CylinderGeometry(0.55, 0.55, 0.12, 16);
      geo.rotateX(Math.PI / 2);
      return { geo, glow: 1.3 };
    }
    case 'stormArchon':
      return { geo: new THREE.OctahedronGeometry(0.28), glow: 1.8 };
    case 'manaSphere':
      return { geo: new THREE.SphereGeometry(0.5, 14, 12), glow: 1.3 };
    case 'windstorm':
      return { geo: new THREE.TorusKnotGeometry(0.3, 0.1, 32, 6), glow: 1.2 };
    case 'huntersChains':
      return { geo: new THREE.BoxGeometry(0.24, 0.24, 0.24), glow: 1.2 };
    default:
      return { geo: new THREE.SphereGeometry(0.32, 12, 10), glow: 1.4 };
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
      float head = pow(vUv.x, 2.2);                        // dims from the front backwards
      float vert = sin(vUv.y * 3.14159);                   // soft top and bottom
      float rays = 0.72 + 0.28 * sin(vUv.y * 26.0 + uTime * 9.0 + vUv.x * 6.0);
      float flicker = 0.8 + 0.2 * sin(uTime * 27.0 + vUv.x * 18.0);
      vec3 col = mix(vec3(0.36, 0.16, 0.85), vec3(0.75, 0.55, 1.0), vUv.y);
      col += vec3(0.55, 0.6, 1.0) * pow(vUv.x, 8.0);       // electric leading edge
      gl_FragColor = vec4(col, head * vert * rays * flicker * 0.85);
    }`,
});

/** Projectiles share one geometry + material per ability across the whole match. */
const projLooks = new Map<AbilityId, { geo: THREE.BufferGeometry; mat: THREE.MeshStandardMaterial }>();
function makeProjectileMesh(abilityId: AbilityId): THREE.Mesh {
  if (abilityId === 'celestialBarrage') return new THREE.Mesh(CELESTIAL_GEO, CELESTIAL_MAT);
  let look = projLooks.get(abilityId);
  if (!look) {
    const color = PROJECTILE_COLORS[abilityId] ?? 0xffffff;
    const { geo, glow } = buildProjectileGeometry(abilityId);
    look = {
      geo,
      mat: new THREE.MeshStandardMaterial({ color, emissive: color, emissiveIntensity: glow }),
    };
    projLooks.set(abilityId, look);
  }
  return new THREE.Mesh(look.geo, look.mat);
}

/** Creates/updates meshes for everything dynamic in a snapshot, plus transient effects. */
export class EntityViews {
  private players = new Map<number, PlayerView>();
  private mobs = new Map<number, MobView>();
  private chests = new Map<number, ChestView>();
  private scrolls = new Map<number, THREE.Group>();
  private coins = new Map<number, THREE.Mesh>();
  private items = new Map<number, THREE.Group>();
  private projectiles = new Map<number, THREE.Mesh>();
  private zones = new Map<
    number,
    { group: THREE.Group; fill: THREE.Mesh; outline: THREE.Mesh; radius: number; kind: string }
  >();
  private effects: Effect[] = [];
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

  constructor(
    private readonly scene: THREE.Scene,
    private readonly assets: AssetLibrary,
  ) {}

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
    const camX = camera.position.x;
    const camZ = camera.position.z;
    const beyond = (x: number, z: number, drawDist: number): boolean =>
      (x - camX) * (x - camX) + (z - camZ) * (z - camZ) > drawDist * drawDist;
    this.ensurePrevMaps(prev);

    // Players
    const prevPlayers = this.prevPlayerMap;
    for (const p of next.players) {
      let view = this.players.get(p.id);
      if (!view) {
        // You wear your chosen body; bots spread across the roster for variety.
        const model =
          p.id === selfId || !p.isBot
            ? this.selfModel
            : HERO_MODELS[p.id % HERO_MODELS.length]!.id;
        view = new PlayerView(p.id === selfId, p.isBot, this.selfColor, model);
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
          rolling: p.rolling,
          shielded: p.shieldHp > 0,
          stealthed: p.stealthed,
          immune: p.immune,
          fae: p.fae,
          poisoned: p.poisoned,
          auraActive: p.auraActive,
          auraRadius: ABILITIES.fireWhirl.auraRadius ?? 3,
        },
        p.id === selfId,
        p.isBot,
        dt,
        camera,
      );
    }

    // Mobs
    const prevMobs = this.prevMobMap;
    const liveMobs = new Set<number>();
    for (const m of next.mobs) {
      liveMobs.add(m.id);
      let view = this.mobs.get(m.id);
      if (!view) {
        view = new MobView(m.elite, m.id);
        this.mobs.set(m.id, view);
        this.scene.add(view.group);
      }
      if (beyond(m.x, m.z, MOB_DRAW_DIST)) {
        view.group.visible = false;
        continue;
      }
      view.group.visible = true;
      const pm = prevMobs.get(m.id) ?? m;
      view.update(lerp(pm.x, m.x, t), lerp(pm.z, m.z, t), lerpAngle(pm.facing, m.facing, t), m.hp / m.maxHp, camera, dt);
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
    }

    // Scrolls: a rarity-colored gem with the spell's icon floating above it,
    // so you can tell what dropped from across the fight.
    const liveScrolls = new Set<number>();
    for (const s of next.scrolls) {
      liveScrolls.add(s.id);
      let group = this.scrolls.get(s.id);
      if (!group) {
        group = new THREE.Group();
        const gem = new THREE.Mesh(this.scrollGeo, gemMaterial(s.rarity));
        group.add(gem);
        const icon = new THREE.Sprite(glyphMaterial(ABILITIES[s.abilityId].icon));
        icon.scale.set(0.85, 0.85, 1);
        icon.position.y = 0.95;
        group.add(icon);
        this.scrolls.set(s.id, group);
        this.scene.add(group);
      }
      if (beyond(s.x, s.z, PICKUP_DRAW_DIST)) {
        group.visible = false;
        continue;
      }
      group.visible = true;
      group.position.set(s.x, groundAt(s.x, s.z) + 0.85 + Math.sin(now * 2.2 + s.id) * 0.12, s.z);
      group.rotation.y = now * 1.6 + s.id;
    }
    for (const [id, group] of this.scrolls) {
      if (!liveScrolls.has(id)) {
        // Gem and glyph materials are cached and shared — nothing to dispose.
        this.scene.remove(group);
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
        const icon = new THREE.Sprite(glyphMaterial(ITEMS[it.itemId].icon));
        icon.scale.set(0.75, 0.75, 1);
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

    // Projectiles
    const prevProj = this.prevProjMap;
    const liveProj = new Set<number>();
    for (const proj of next.projectiles) {
      liveProj.add(proj.id);
      let mesh = this.projectiles.get(proj.id);
      if (!mesh) {
        mesh = makeProjectileMesh(proj.abilityId);
        this.projectiles.set(proj.id, mesh);
        this.scene.add(mesh);
      }
      const pp = prevProj.get(proj.id) ?? proj;
      const px = lerp(pp.x, proj.x, t);
      const pz = lerp(pp.z, proj.z, t);
      mesh.position.set(px, groundAt(px, pz) + 1.1, pz);
      mesh.rotation.y = Math.atan2(proj.dirX, proj.dirZ);
      if (proj.abilityId === 'huntersChains') mesh.rotation.z = now * 14;
      else if (proj.abilityId === 'holyShield') mesh.rotation.z = now * 12;
      else if (proj.abilityId === 'manaSphere') mesh.scale.setScalar(1 + 0.1 * Math.sin(now * 11));
      else if (proj.abilityId === 'windstorm') mesh.rotation.z = now * 8;
    }
    for (const [id, mesh] of this.projectiles) {
      if (!liveProj.has(id)) {
        this.scene.remove(mesh);
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
        const icy = zone.abilityId === 'snowdrift' || zone.abilityId === 'rimeArrow';
        let color: number;
        let fillColor: number;
        if (zone.kind === 'trap') {
          [color, fillColor] = [0xb8bcc8, 0x6a6f7d];
        } else if (zone.kind === 'pool') {
          [color, fillColor] = icy ? [0x9fd8ff, 0x4d9be6] : [0xff8c5e, 0xd45a2e];
        } else {
          [color, fillColor] = icy ? [0x9fd8ff, 0x4d9be6] : [0xffb14d, 0xff8c2e];
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
        group.position.set(zone.x, groundAt(zone.x, zone.z) + 0.06, zone.z);
        view = { group, fill, outline, radius: zone.radius, kind: zone.kind };
        this.zones.set(zone.id, view);
        this.scene.add(group);
      }
      if (zone.kind === 'telegraph') {
        const telegraph = ABILITIES[zone.abilityId].telegraph ?? 1;
        const progress = 1 - Math.min(1, zone.endsIn / telegraph);
        view.fill.scale.setScalar(Math.max(0.01, progress) * view.radius);
        (view.fill.material as THREE.MeshBasicMaterial).opacity = 0.3 + 0.15 * Math.sin(now * 18);
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
      }
    }

    this.updateEffects(dt);
  }

  handleEvents(events: GameEvent[], selfId: number, snap: Snapshot): void {
    const playerById = new Map(snap.players.map((p) => [p.id, p]));
    for (const ev of events) {
      switch (ev.type) {
        case 'cast':
          this.players.get(ev.casterId)?.triggerCast();
          switch (ev.abilityId) {
            case 'quakingLeap':
            case 'slicingWinds':
            case 'explosiveCaltrops':
              this.spawnBurst(ev.x, ev.z, 1.6, 0xd8cfb8, 0.35); // dust kick at takeoff
              break;
            case 'rimeArrow':
            case 'snowdrift':
              this.spawnFlash(ev.x, ev.z, 0.9, 0x9fd8ff, 0.16);
              break;
            case 'earthbreaker':
              this.spawnBurst(ev.x, ev.z, 1.4, 0xa8845a, 0.3);
              break;
            case 'fireWhirl':
            case 'searingAxe':
              this.spawnBurst(ev.x, ev.z, 1.2, 0xff7b2e, 0.3);
              break;
            case 'fadeToShadow':
              this.spawnBurst(ev.x, ev.z, 1.4, 0x3a2f55, 0.45, 0.8); // shadow puff at origin
              break;
            case 'repel':
              this.spawnFlash(ev.x, ev.z, 1.5, 0x9fb8ff, 0.3);
              break;
            case 'faeform':
              this.spawnBurst(ev.x, ev.z, 1.4, 0xe98fd8, 0.4, 1.0);
              break;
            case 'celestialBarrage':
              this.spawnFlash(ev.x, ev.z, 1.4, 0xd8c8ff, 0.3); // starlight gathers
              break;
            case 'lightningBulwark':
              this.spawnFlash(ev.x, ev.z, 1.3, 0xc9e2ff, 0.3);
              break;
            default:
              this.spawnFlash(ev.x, ev.z, 1.1, 0xcfe8ff, 0.16);
          }
          sfx.cast(ev.abilityId, ev);
          break;
        case 'chargeRelease': {
          // Bigger flash the longer the charge was held.
          const color = ev.abilityId === 'celestialBarrage' ? 0xd8c8ff : 0xcfe8dd;
          this.spawnBurst(ev.x, ev.z, 1.2 + ev.fraction * 1.6, color, 0.3);
          this.spawnFlash(ev.x, ev.z, 1.0 + ev.fraction, color, 0.2);
          sfx.cast(ev.abilityId, ev);
          break;
        }
        case 'melee': {
          this.spawnMeleeArc(ev.x, ev.z, ev.facing, ev.combo);
          this.players.get(ev.casterId)?.triggerSwing(ev.combo);
          sfx.melee(ev.combo, ev);
          break;
        }
        case 'detonate':
          if (ev.abilityId === 'starBomb') {
            // Cosmic blast: a bright column stabbing down from the sky.
            this.spawnColumn(ev.x, ev.z, 0.5, 16, 0xd8c8ff, 0.25);
            this.spawnBurst(ev.x, ev.z, ev.radius, 0xb89aff, 0.35);
          } else if (ev.abilityId === 'snowdrift') {
            this.spawnBurst(ev.x, ev.z, ev.radius, 0x9fd8ff, 0.4);
          } else if (ev.abilityId === 'earthbreaker') {
            this.spawnBurst(ev.x, ev.z, ev.radius, 0xa8845a, 0.4);
            this.spawnFlash(ev.x, ev.z, ev.radius * 0.5, 0xd9c9a8, 0.25);
          } else if (ev.abilityId === 'quakingLeap') {
            this.spawnBurst(ev.x, ev.z, ev.radius, 0xd8cfb8, 0.35);
          } else if (ev.abilityId === 'steelTraps') {
            this.spawnFlash(ev.x, ev.z, 1.0, 0xd8d8e8, 0.2);
          } else {
            this.spawnBurst(ev.x, ev.z, ev.radius, 0xffe38a, 0.35);
            this.spawnFlash(ev.x, ev.z, ev.radius * 0.6, 0xfff6d9, 0.25);
          }
          sfx.detonate(ev);
          break;
        case 'hit':
          if (ev.sourceId !== null) this.spawnFlash(ev.x, ev.z, 0.8, 0xff5b4d, 0.18);
          if (ev.sourceId !== null && ev.amount > 3) sfx.hit(ev);
          break;
        case 'projectileGone':
          this.spawnFlash(ev.x, ev.z, 0.5, 0x9fd8ff, 0.14);
          break;
        case 'death':
          this.spawnBurst(ev.x, ev.z, 2.2, 0x3a3a4a, 0.6);
          sfx.death(ev.id === selfId, ev);
          break;
        case 'mobDeath':
          this.spawnBurst(ev.x, ev.z, ev.elite ? 2.6 : 1.4, ev.elite ? 0xd4af37 : 0x8a6b3d, ev.elite ? 0.6 : 0.4);
          break;
        case 'chestOpened':
          this.spawnFlash(ev.x, ev.z, 1.4, 0xffd75e, 0.4);
          sfx.chest(ev);
          break;
        case 'levelUp': {
          const p = playerById.get(ev.playerId);
          if (p) this.spawnBurst(p.x, p.z, 2.5, 0xffd75e, 0.7);
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
        case 'itemUsed':
          this.spawnBurst(ev.x, ev.z, 1.4, ITEMS[ev.itemId].color, 0.45, 1.0);
          if (ev.playerId === selfId) sfx.equip();
          break;
        case 'pull': {
          const a = playerById.get(ev.casterId);
          const b = playerById.get(ev.targetId);
          if (a && b) this.spawnChainLine(a.x, a.z, b.x, b.z);
          break;
        }
      }
    }
  }

  private spawnMeleeArc(x: number, z: number, facing: number, combo: number): void {
    const mat = new THREE.MeshBasicMaterial({
      color: combo === 3 ? 0xffe38a : 0xe8e6d9,
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

  private spawnFlash(x: number, z: number, size: number, color: number, ttl: number): void {
    const mat = new THREE.MeshBasicMaterial({ color, transparent: true, opacity: 0.85 });
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
      const s = 1 + fx.growth * t;
      fx.obj.scale.set(fx.baseX * s, fx.baseY * s, fx.baseZ * s);
      if (fx.rise) fx.obj.position.y += fx.rise * dt;
      fx.mat.opacity = (1 - t) * 0.85;
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
    for (const group of this.scrolls.values()) this.scene.remove(group);
    for (const mesh of this.coins.values()) this.scene.remove(mesh);
    for (const mesh of this.items.values()) this.scene.remove(mesh);
    for (const mesh of this.projectiles.values()) this.scene.remove(mesh);
    for (const view of this.zones.values()) {
      this.scene.remove(view.group);
      (view.fill.material as THREE.Material).dispose();
      (view.outline.material as THREE.Material).dispose();
    }
    for (const fx of this.effects) {
      this.scene.remove(fx.obj);
      this.disposeEffect(fx);
    }
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
