import * as THREE from 'three';
import { ELEMENT_PALETTE } from '../elements.js';
import type { FxHandle } from './SpellFX.js';

/*
 * Props that ride on a character for a while — the goblin chopper you
 * mount for Mechano-Hog, the hen that Chicken Coup conjures, the molten
 * axe that Searing Axe swings, the rocket flame under To the Skies! —
 * plus the one-shot world props they leave behind (a launch pad, a bomb,
 * a smoke cloud). All built once from shared geometry; each attachment is
 * a group with its own animation closure.
 */

export interface Attachment {
  obj: THREE.Object3D;
  ttl: number;
  age: number;
  /** t in [0, 1] over the attachment's life; speed is the wearer's m/s. */
  anim: (t: number, now: number, speed: number, dt: number) => void;
  /** Lifts the body while worn (mounts). */
  lift?: number;
}

const WHITE_MAT = new THREE.MeshStandardMaterial({ color: 0xf6f1e6, roughness: 0.8 });
const RED_MAT = new THREE.MeshStandardMaterial({ color: 0xe0302a, roughness: 0.6 });
const ORANGE_MAT = new THREE.MeshStandardMaterial({ color: 0xffb030, roughness: 0.6 });
const EYE_MAT = new THREE.MeshBasicMaterial({ color: 0x1a1208 });
const RUBBER_MAT = new THREE.MeshStandardMaterial({ color: 0x1a1c22, roughness: 0.9 });
const CHROME_MAT = new THREE.MeshStandardMaterial({ color: 0xcfd6e2, roughness: 0.25, metalness: 0.9 });
const HOG_MAT = new THREE.MeshStandardMaterial({ color: 0xc8401a, roughness: 0.45, metalness: 0.3 });
const HEADLIGHT_MAT = new THREE.MeshBasicMaterial({ color: new THREE.Color(0xfff2c0).multiplyScalar(2.5) });
const HAFT_MAT = new THREE.MeshStandardMaterial({ color: 0x5a3a1c, roughness: 0.9 });
const BLADE_MAT = new THREE.MeshStandardMaterial({
  color: 0x4a2a14,
  roughness: 0.4,
  metalness: 0.5,
  emissive: ELEMENT_PALETTE.fire.core,
  emissiveIntensity: 1.6,
});
const IRON_MAT = new THREE.MeshStandardMaterial({ color: 0x23262e, roughness: 0.5, metalness: 0.6 });
const PAD_MAT = new THREE.MeshStandardMaterial({ color: 0x6a7280, roughness: 0.5, metalness: 0.6 });
const PAD_RING_MAT = new THREE.MeshBasicMaterial({ color: new THREE.Color(0x7fd4ff).multiplyScalar(2.2) });

const FLAME_OUTER_MAT = new THREE.MeshBasicMaterial({
  color: new THREE.Color(ELEMENT_PALETTE.fire.core).multiplyScalar(1.8),
  transparent: true,
  opacity: 0.8,
  blending: THREE.AdditiveBlending,
  depthWrite: false,
});
const FLAME_INNER_MAT = new THREE.MeshBasicMaterial({
  color: new THREE.Color(0xfff2b0).multiplyScalar(2.2),
  transparent: true,
  opacity: 0.9,
  blending: THREE.AdditiveBlending,
  depthWrite: false,
});

const BODY_GEO = new THREE.SphereGeometry(0.22, 12, 10);
const HEAD_GEO = new THREE.SphereGeometry(0.13, 10, 8);
const COMB_GEO = new THREE.BoxGeometry(0.05, 0.1, 0.1);
const BEAK_GEO = new THREE.ConeGeometry(0.045, 0.12, 6);
BEAK_GEO.rotateZ(-Math.PI / 2);
const LEG_GEO = new THREE.CylinderGeometry(0.015, 0.015, 0.2, 5);
LEG_GEO.translate(0, -0.1, 0);
const TAIL_GEO = new THREE.ConeGeometry(0.09, 0.22, 6);
TAIL_GEO.rotateZ(Math.PI / 2);
const EYE_GEO = new THREE.SphereGeometry(0.02, 6, 5);

/** A hen: plump body, bobbing head, comb, beak, stick legs, a fan tail. */
export function chicken(): Attachment {
  const group = new THREE.Group();
  const body = new THREE.Mesh(BODY_GEO, WHITE_MAT);
  body.scale.set(1.3, 1, 1);
  body.position.y = 0.32;
  body.castShadow = true;
  const head = new THREE.Group();
  head.position.set(0.24, 0.5, 0);
  head.add(new THREE.Mesh(HEAD_GEO, WHITE_MAT));
  const comb = new THREE.Mesh(COMB_GEO, RED_MAT);
  comb.position.y = 0.13;
  head.add(comb);
  const beak = new THREE.Mesh(BEAK_GEO, ORANGE_MAT);
  beak.position.set(0.16, 0, 0);
  head.add(beak);
  const wattle = new THREE.Mesh(EYE_GEO, RED_MAT);
  wattle.scale.set(1, 2, 1);
  wattle.position.set(0.1, -0.1, 0);
  head.add(wattle);
  for (const side of [-1, 1]) {
    const eye = new THREE.Mesh(EYE_GEO, EYE_MAT);
    eye.position.set(0.08, 0.04, side * 0.09);
    head.add(eye);
  }
  const legs = [-1, 1].map((side) => {
    const leg = new THREE.Mesh(LEG_GEO, ORANGE_MAT);
    leg.position.set(0, 0.22, side * 0.08);
    return leg;
  });
  const tail = new THREE.Mesh(TAIL_GEO, WHITE_MAT);
  tail.position.set(-0.3, 0.42, 0);
  tail.rotation.z = -0.5;
  group.add(body, head, tail, ...legs);
  group.scale.setScalar(1.2);
  return {
    obj: group,
    ttl: 2.6,
    age: 0,
    anim: (t, now) => {
      // Struts a tight circle around its owner, hopping and pecking.
      const a = now * 2.6;
      group.position.set(Math.sin(a) * 0.9, Math.abs(Math.sin(now * 9)) * 0.12, Math.cos(a) * 0.9);
      group.rotation.y = a + Math.PI / 2;
      head.rotation.z = Math.sin(now * 14) * 0.35 - 0.2;
      legs[0]!.rotation.z = Math.sin(now * 14) * 0.6;
      legs[1]!.rotation.z = -Math.sin(now * 14) * 0.6;
      // Pops in, then gets eaten: shrinks away at the end.
      const s = 1.2 * Math.min(1, t * 8) * (1 - Math.max(0, (t - 0.85) / 0.15));
      group.scale.setScalar(Math.max(0.001, s));
    },
  };
}

const WHEEL_GEO = new THREE.TorusGeometry(0.3, 0.1, 8, 20);
const HUB_GEO = new THREE.CylinderGeometry(0.2, 0.2, 0.12, 12);
HUB_GEO.rotateX(Math.PI / 2);
const SPOKE_GEO = new THREE.BoxGeometry(0.03, 0.5, 0.03);
const FRAME_GEO = new THREE.BoxGeometry(0.34, 0.3, 1.0);
const TANK_GEO = new THREE.SphereGeometry(0.2, 10, 8);
const SEAT_GEO = new THREE.BoxGeometry(0.3, 0.08, 0.4);
const BAR_GEO = new THREE.CylinderGeometry(0.03, 0.03, 0.7, 8);
BAR_GEO.rotateZ(Math.PI / 2);
const FORK_GEO = new THREE.CylinderGeometry(0.035, 0.035, 0.7, 8);
const PIPE_GEO = new THREE.CylinderGeometry(0.05, 0.06, 0.8, 8);
const LAMP_GEO = new THREE.SphereGeometry(0.09, 8, 6);

/** The goblin chopper: two fat wheels, a red tank, chrome pipes, a blazing headlamp. */
export function mechanoHog(): Attachment {
  const group = new THREE.Group();
  const wheels: THREE.Group[] = [];
  for (const z of [0.62, -0.5]) {
    const w = new THREE.Group();
    w.add(new THREE.Mesh(WHEEL_GEO, RUBBER_MAT), new THREE.Mesh(HUB_GEO, CHROME_MAT));
    for (let k = 0; k < 3; k++) {
      const spoke = new THREE.Mesh(SPOKE_GEO, CHROME_MAT);
      spoke.rotation.z = (k / 3) * Math.PI;
      w.add(spoke);
    }
    w.position.set(0, 0.4, z);
    wheels.push(w);
    group.add(w);
  }
  const frame = new THREE.Mesh(FRAME_GEO, HOG_MAT);
  frame.position.set(0, 0.55, 0.05);
  frame.castShadow = true;
  const tank = new THREE.Mesh(TANK_GEO, HOG_MAT);
  tank.scale.set(1, 0.8, 1.6);
  tank.position.set(0, 0.78, 0.2);
  const seat = new THREE.Mesh(SEAT_GEO, RUBBER_MAT);
  seat.position.set(0, 0.76, -0.3);
  const fork = new THREE.Mesh(FORK_GEO, CHROME_MAT);
  fork.position.set(0, 0.7, 0.6);
  fork.rotation.x = -0.45;
  const bar = new THREE.Mesh(BAR_GEO, CHROME_MAT);
  bar.position.set(0, 1.02, 0.46);
  const lamp = new THREE.Mesh(LAMP_GEO, HEADLIGHT_MAT);
  lamp.position.set(0, 0.85, 0.72);
  group.add(frame, tank, seat, fork, bar, lamp);
  for (const side of [-1, 1]) {
    const pipe = new THREE.Mesh(PIPE_GEO, CHROME_MAT);
    pipe.position.set(side * 0.22, 0.42, -0.45);
    pipe.rotation.x = Math.PI / 2 - 0.25;
    group.add(pipe);
  }
  return {
    obj: group,
    ttl: 4,
    age: 0,
    lift: 0.45,
    anim: (t, now, speed) => {
      const spin = speed * 3.3;
      for (const w of wheels) w.rotation.x -= spin * 0.016;
      // Engine shudder, a wheelie on the way in, and it rides off at the end.
      group.position.y = Math.sin(now * 40) * 0.01;
      group.rotation.x = -Math.min(0.35, Math.max(0, 0.35 - t * 3)) * (speed > 0.5 ? 1 : 0.3);
      const s = Math.min(1, t * 6) * (1 - Math.max(0, (t - 0.9) / 0.1));
      group.scale.setScalar(Math.max(0.001, s));
    },
  };
}

const HAFT_GEO = new THREE.CylinderGeometry(0.035, 0.045, 1.1, 8);
const BLADE_GEO = (() => {
  const shape = new THREE.Shape();
  shape.moveTo(0, -0.28);
  shape.quadraticCurveTo(0.42, -0.34, 0.5, 0);
  shape.quadraticCurveTo(0.42, 0.34, 0, 0.28);
  shape.quadraticCurveTo(0.12, 0, 0, -0.28);
  const geo = new THREE.ExtrudeGeometry(shape, { depth: 0.06, bevelEnabled: false });
  geo.translate(0, 0, -0.03);
  return geo;
})();

/** Searing Axe: a molten-bladed axe whipped through the front arc, then gone. */
export function searingAxe(): Attachment {
  const pivot = new THREE.Group();
  const axe = new THREE.Group();
  const haft = new THREE.Mesh(HAFT_GEO, HAFT_MAT);
  haft.position.y = 0.45;
  const blade = new THREE.Mesh(BLADE_GEO, BLADE_MAT);
  blade.position.set(0.04, 0.92, 0);
  axe.add(haft, blade);
  axe.position.set(0.45, -0.1, 0.35);
  axe.rotation.z = -0.35;
  pivot.add(axe);
  return {
    obj: pivot,
    ttl: 0.45,
    age: 0,
    anim: (t) => {
      // Wind up over the shoulder, then chop across the arc.
      const swing = t < 0.3 ? -0.9 * (t / 0.3) : -0.9 + 2.8 * ((t - 0.3) / 0.7);
      pivot.rotation.y = swing;
      axe.rotation.x = t < 0.3 ? -1.2 * (t / 0.3) : -1.2 + 1.9 * ((t - 0.3) / 0.7);
      BLADE_MAT.emissiveIntensity = 1.2 + Math.sin(t * 40) * 0.5;
    },
  };
}

const FLAME_GEO = new THREE.ConeGeometry(0.28, 1.4, 10, 1, true);
FLAME_GEO.rotateX(Math.PI); // apex down
FLAME_GEO.translate(0, -0.7, 0);

/** To the Skies!: a rocket plume roaring under the wearer while they climb. */
export function rocketFlame(seconds = 1.3): Attachment {
  const group = new THREE.Group();
  const outer = new THREE.Mesh(FLAME_GEO, FLAME_OUTER_MAT);
  const inner = new THREE.Mesh(FLAME_GEO, FLAME_INNER_MAT);
  inner.scale.set(0.5, 0.7, 0.5);
  group.add(outer, inner);
  group.position.y = 0.55;
  return {
    obj: group,
    ttl: seconds,
    age: 0,
    anim: (t, now) => {
      const flicker = 1 + Math.sin(now * 45) * 0.15 + Math.sin(now * 31 + 1) * 0.1;
      const fade = 1 - Math.max(0, (t - 0.7) / 0.3);
      outer.scale.set(flicker * fade, (1.2 + Math.sin(now * 27) * 0.2) * fade, flicker * fade);
      inner.scale.set(0.5 * flicker * fade, 0.8 * fade, 0.5 * flicker * fade);
      group.rotation.y = now * 6;
    },
  };
}

/** Storm Archon: crackling arcs riding the body while the volley flies. */
export function archonArcs(arcs: { obj: THREE.Group; anim: (now: number) => void }, seconds = 1.6): Attachment {
  arcs.obj.position.y = 1.0;
  return {
    obj: arcs.obj,
    ttl: seconds,
    age: 0,
    anim: (t, now) => {
      arcs.anim(now);
      arcs.obj.scale.setScalar(Math.max(0.001, 1.6 * (1 - Math.max(0, (t - 0.75) / 0.25))));
    },
  };
}

/* ── One-shot world props ─────────────────────────────────────────── */

const PAD_GEO = new THREE.CylinderGeometry(1.1, 1.25, 0.16, 20);
const PAD_RING_GEO = new THREE.TorusGeometry(1.05, 0.05, 6, 32);
PAD_RING_GEO.rotateX(Math.PI / 2);
const SPRING_GEO = new THREE.CylinderGeometry(0.35, 0.45, 0.5, 10, 1, true);

/** Gnomish Gravity Launcher: a pad that compresses, then kicks. */
export function launchPad(x: number, y: number, z: number): FxHandle {
  const group = new THREE.Group();
  const pad = new THREE.Mesh(PAD_GEO, PAD_MAT);
  pad.position.y = 0.08;
  const ring = new THREE.Mesh(PAD_RING_GEO, PAD_RING_MAT);
  ring.position.y = 0.18;
  const spring = new THREE.Mesh(SPRING_GEO, CHROME_MAT);
  spring.position.y = 0.4;
  group.add(pad, ring, spring);
  group.position.set(x, y, z);
  return {
    obj: group,
    ttl: 1.1,
    age: 0,
    tick: (t) => {
      // Slam down, then spring up and fade.
      const squash = t < 0.2 ? 1 - t * 3 : t < 0.35 ? 0.4 + (t - 0.2) * 8 : 1.6 - (t - 0.35) * 0.9;
      spring.scale.y = Math.max(0.05, squash);
      spring.position.y = 0.16 + 0.25 * spring.scale.y;
      ring.scale.setScalar(1 + Math.max(0, t - 0.3) * 2.5);
      (ring.material as THREE.MeshBasicMaterial).opacity = 1;
      group.scale.setScalar(Math.max(0.001, 1 - Math.max(0, (t - 0.8) / 0.2)));
    },
    dispose: () => {},
  };
}

const BOMB_GEO = new THREE.SphereGeometry(0.2, 10, 8);
const FUSE_GEO = new THREE.CylinderGeometry(0.015, 0.015, 0.16, 5);

/** Smoke Bomb: the bomb drops, then the cloud billows out for the stealth window. */
export function smokeCloud(x: number, y: number, z: number, sprite: THREE.Texture, seconds = 3.2): FxHandle {
  const group = new THREE.Group();
  const bomb = new THREE.Group();
  bomb.add(new THREE.Mesh(BOMB_GEO, IRON_MAT));
  const fuse = new THREE.Mesh(FUSE_GEO, HAFT_MAT);
  fuse.position.set(0.08, 0.22, 0);
  fuse.rotation.z = -0.5;
  bomb.add(fuse);
  bomb.position.y = 1.0;
  group.add(bomb);
  const puffs: { sprite: THREE.Sprite; mat: THREE.SpriteMaterial; dx: number; dz: number; r: number; phase: number }[] = [];
  for (let i = 0; i < 10; i++) {
    const mat = new THREE.SpriteMaterial({ map: sprite, color: 0x9a9aa8, transparent: true, opacity: 0, depthWrite: false });
    const s = new THREE.Sprite(mat);
    const a = (i / 10) * Math.PI * 2 + Math.random() * 0.5;
    puffs.push({ sprite: s, mat, dx: Math.sin(a), dz: Math.cos(a), r: 0.6 + Math.random() * 1.4, phase: Math.random() * 6 });
    group.add(s);
  }
  group.position.set(x, y, z);
  return {
    obj: group,
    ttl: seconds,
    age: 0,
    tick: (t, dt) => {
      const drop = Math.min(1, t * 6);
      bomb.position.y = 1.0 - drop * drop * 0.85;
      bomb.visible = t < 0.2;
      const cloud = Math.max(0, (t - 0.15) / 0.85);
      const grow = 1 - Math.pow(1 - Math.min(1, cloud * 2.5), 2);
      const fade = 1 - Math.max(0, (cloud - 0.6) / 0.4);
      for (const p of puffs) {
        const spread = p.r * grow;
        p.sprite.position.set(p.dx * spread, 0.5 + grow * 1.2 + Math.sin(p.phase + cloud * 4) * 0.2 + cloud * 0.8, p.dz * spread);
        const size = 1.2 + grow * 2.2;
        p.sprite.scale.set(size, size, 1);
        p.mat.opacity = 0.55 * Math.min(1, cloud * 5) * fade;
      }
      void dt;
    },
    dispose: () => {
      for (const p of puffs) p.mat.dispose();
    },
  };
}

