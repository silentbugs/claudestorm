import * as THREE from 'three';
import {
  ABILITIES,
  lerp,
  type AbilityId,
  type GameEvent,
  type Rarity,
  type Snapshot,
} from '@claudestorm/shared';
import { sfx } from '../sfx.js';

const SELF_COLOR = 0x4da6ff;
const BOT_COLOR = 0xd9534f;
const DEAD_COLOR = 0x50505a;
const SLOW_COLOR = 0x9fd8ff;
const MOB_COLOR = 0x8a6b3d;
const ELITE_COLOR = 0x9c3f3f;

export const RARITY_COLORS: Record<Rarity, number> = {
  common: 0xb8b5a5,
  uncommon: 0x4bc26b,
  rare: 0x4d9be6,
  epic: 0xb05df0,
};

const PROJECTILE_COLORS: Partial<Record<AbilityId, number>> = {
  frostArrow: 0x7fd4ff,
  venomOrb: 0x6fd44a,
  graspingChains: 0xd8d8e8,
  shadowLance: 0xb05df0,
};

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

class PlayerView {
  readonly group = new THREE.Group();
  private readonly bodyPivot = new THREE.Group();
  private readonly body: THREE.Mesh;
  private readonly bodyMat: THREE.MeshStandardMaterial;
  private readonly nose: THREE.Mesh;
  private readonly glider: THREE.Mesh;
  private readonly shield: THREE.Mesh;
  private readonly aura: THREE.Mesh;
  private readonly hpGroup: THREE.Group;
  private readonly hpFill: THREE.Mesh;
  private deadFor = 0;
  private rollSpin = 0;

  constructor(isSelf: boolean, isBot: boolean) {
    this.bodyMat = new THREE.MeshStandardMaterial({
      color: isSelf ? SELF_COLOR : isBot ? BOT_COLOR : SELF_COLOR,
      roughness: 0.6,
    });
    this.body = new THREE.Mesh(new THREE.CapsuleGeometry(0.5, 1.0, 4, 14), this.bodyMat);
    this.body.castShadow = true;
    this.bodyPivot.position.y = 1;
    this.bodyPivot.add(this.body);
    this.group.add(this.bodyPivot);

    this.nose = new THREE.Mesh(
      new THREE.ConeGeometry(0.2, 0.5, 10),
      new THREE.MeshStandardMaterial({ color: 0xf5e9c9, roughness: 0.5 }),
    );
    this.nose.rotation.x = Math.PI / 2;
    this.nose.position.set(0, 1.35, 0.6);
    this.group.add(this.nose);

    this.glider = new THREE.Mesh(
      new THREE.ConeGeometry(1.5, 0.8, 4),
      new THREE.MeshStandardMaterial({ color: 0xe0b34c, roughness: 0.7, side: THREE.DoubleSide }),
    );
    this.glider.position.y = 3;
    this.glider.visible = false;
    this.group.add(this.glider);

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
    this.hpGroup.position.y = 2.5;
    this.group.add(this.hpGroup);
  }

  private baseColor(isSelf: boolean, isBot: boolean): number {
    return isSelf ? SELF_COLOR : isBot ? BOT_COLOR : SELF_COLOR;
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
      this.bodyPivot.rotation.x = Math.PI / 2;
      this.bodyPivot.position.y = 0.5;
      this.bodyMat.color.setHex(DEAD_COLOR);
      this.nose.visible = false;
      this.hpGroup.visible = false;
      this.shield.visible = false;
      this.aura.visible = false;
      this.glider.visible = false;
      if (this.deadFor > 2.5) this.group.visible = false;
      return;
    }

    this.group.rotation.y = p.facing;
    if (p.rolling) {
      this.rollSpin += dt * 18;
      this.bodyPivot.rotation.x = this.rollSpin;
    } else if (p.gliding) {
      this.rollSpin = 0;
      this.bodyPivot.rotation.x = -0.9;
    } else {
      this.rollSpin = 0;
      this.bodyPivot.rotation.x = 0;
    }
    this.bodyPivot.position.y = 1;
    this.glider.visible = p.gliding;
    this.shield.visible = p.shielded;
    this.aura.visible = p.auraActive;
    if (p.auraActive) {
      this.aura.scale.setScalar(p.auraRadius);
      this.aura.rotation.z += dt * 6;
    }

    const color = new THREE.Color(this.baseColor(isSelf, isBot));
    if (p.slowed) color.lerp(new THREE.Color(SLOW_COLOR), 0.55);
    this.bodyMat.color.copy(color);
    this.nose.visible = true;
    this.hpGroup.visible = true;
    setBar(this.hpFill, p.hpFrac, 1.3);
    this.hpGroup.quaternion.copy(camera.quaternion);
    this.hpGroup.rotation.z = 0;
  }
}

class MobView {
  readonly group = new THREE.Group();
  private readonly hpFill: THREE.Mesh;
  private readonly hpGroup: THREE.Group;
  private readonly barWidth: number;
  private readonly elite: boolean;

  constructor(elite: boolean) {
    this.elite = elite;
    const beast = new THREE.Group();
    const body = new THREE.Mesh(
      new THREE.CapsuleGeometry(0.45, 0.5, 4, 10),
      new THREE.MeshStandardMaterial({ color: elite ? ELITE_COLOR : MOB_COLOR, roughness: 0.85 }),
    );
    body.rotation.x = Math.PI / 2;
    body.position.y = 0.5;
    body.castShadow = true;
    beast.add(body);
    const snout = new THREE.Mesh(
      new THREE.ConeGeometry(0.18, 0.4, 8),
      new THREE.MeshStandardMaterial({ color: 0x6e5430, roughness: 0.8 }),
    );
    snout.rotation.x = Math.PI / 2;
    snout.position.set(0, 0.45, 0.75);
    beast.add(snout);
    if (elite) {
      beast.scale.setScalar(1.55);
      const crown = new THREE.Mesh(
        new THREE.CylinderGeometry(0.24, 0.3, 0.22, 6),
        new THREE.MeshStandardMaterial({ color: 0xd4af37, metalness: 0.6, roughness: 0.3 }),
      );
      crown.position.set(0, 0.85, 0.55);
      beast.add(crown);
    }
    this.group.add(beast);

    this.barWidth = elite ? 1.4 : 0.9;
    const bar = makeBar(this.barWidth);
    this.hpGroup = bar.group;
    this.hpFill = bar.fill;
    this.hpGroup.position.y = elite ? 2.1 : 1.4;
    this.group.add(this.hpGroup);
  }

  update(x: number, z: number, facing: number, hpFrac: number, camera: THREE.Camera): void {
    this.group.position.set(x, 0, z);
    this.group.rotation.y = facing;
    this.hpGroup.visible = this.elite || hpFrac < 1;
    setBar(this.hpFill, hpFrac, this.barWidth);
    this.hpGroup.quaternion.copy(camera.quaternion);
  }
}

class ChestView {
  readonly group = new THREE.Group();
  private readonly lid: THREE.Mesh;
  private opened = false;

  constructor(x: number, z: number) {
    const base = new THREE.Mesh(
      new THREE.BoxGeometry(1.2, 0.55, 0.8),
      new THREE.MeshStandardMaterial({ color: 0x7a4f28, roughness: 0.8 }),
    );
    base.position.y = 0.28;
    base.castShadow = true;
    this.lid = new THREE.Mesh(
      new THREE.BoxGeometry(1.2, 0.25, 0.8),
      new THREE.MeshStandardMaterial({ color: 0x8f5c2e, roughness: 0.8 }),
    );
    this.lid.position.set(0, 0.68, 0);
    const band = new THREE.Mesh(
      new THREE.BoxGeometry(1.26, 0.14, 0.86),
      new THREE.MeshStandardMaterial({ color: 0xd4af37, metalness: 0.5, roughness: 0.4 }),
    );
    band.position.y = 0.4;
    this.group.add(base, this.lid, band);
    this.group.position.set(x, 0, z);
    this.group.rotation.y = (x * 7 + z * 13) % Math.PI;
  }

  setOpened(opened: boolean): void {
    if (opened === this.opened) return;
    this.opened = opened;
    this.lid.rotation.x = opened ? -1.9 : 0;
    this.lid.position.z = opened ? -0.35 : 0;
    this.lid.position.y = opened ? 0.75 : 0.68;
  }
}

interface Effect {
  obj: THREE.Object3D;
  mat: THREE.Material & { opacity: number };
  age: number;
  ttl: number;
  growth: number;
}

/** Creates/updates meshes for everything dynamic in a snapshot, plus transient effects. */
export class EntityViews {
  private players = new Map<number, PlayerView>();
  private mobs = new Map<number, MobView>();
  private chests = new Map<number, ChestView>();
  private scrolls = new Map<number, THREE.Mesh>();
  private coins = new Map<number, THREE.Mesh>();
  private projectiles = new Map<number, THREE.Mesh>();
  private zones = new Map<number, { group: THREE.Group; fill: THREE.Mesh; kind: string }>();
  private effects: Effect[] = [];

  private readonly scrollGeo = new THREE.OctahedronGeometry(0.35);
  private readonly coinGeo = new THREE.CylinderGeometry(0.22, 0.22, 0.06, 12);
  private readonly coinMat = new THREE.MeshStandardMaterial({
    color: 0xf3c53d,
    metalness: 0.6,
    roughness: 0.3,
  });

  constructor(private readonly scene: THREE.Scene) {}

  sync(prev: Snapshot, next: Snapshot, t: number, selfId: number, camera: THREE.Camera, dt: number): void {
    const now = performance.now() / 1000;

    // Players
    const prevPlayers = new Map(prev.players.map((p) => [p.id, p]));
    for (const p of next.players) {
      let view = this.players.get(p.id);
      if (!view) {
        view = new PlayerView(p.id === selfId, p.isBot);
        this.players.set(p.id, view);
        this.scene.add(view.group);
      }
      const pp = prevPlayers.get(p.id) ?? p;
      view.update(
        {
          x: lerp(pp.x, p.x, t),
          y: lerp(pp.y, p.y, t),
          z: lerp(pp.z, p.z, t),
          facing: lerpAngle(pp.facing, p.facing, t),
          hpFrac: p.hp / p.maxHp,
          alive: p.alive,
          slowed: p.slowed,
          gliding: p.gliding,
          rolling: p.rolling,
          shielded: p.shieldHp > 0,
          auraActive: p.auraActive,
          auraRadius: ABILITIES.flameCyclone.auraRadius ?? 3,
        },
        p.id === selfId,
        p.isBot,
        dt,
        camera,
      );
    }

    // Mobs
    const prevMobs = new Map(prev.mobs.map((m) => [m.id, m]));
    const liveMobs = new Set<number>();
    for (const m of next.mobs) {
      liveMobs.add(m.id);
      let view = this.mobs.get(m.id);
      if (!view) {
        view = new MobView(m.elite);
        this.mobs.set(m.id, view);
        this.scene.add(view.group);
      }
      const pm = prevMobs.get(m.id) ?? m;
      view.update(lerp(pm.x, m.x, t), lerp(pm.z, m.z, t), lerpAngle(pm.facing, m.facing, t), m.hp / m.maxHp, camera);
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
        view = new ChestView(c.x, c.z);
        this.chests.set(c.id, view);
        this.scene.add(view.group);
      }
      view.setOpened(c.opened);
    }

    // Scrolls
    const liveScrolls = new Set<number>();
    for (const s of next.scrolls) {
      liveScrolls.add(s.id);
      let mesh = this.scrolls.get(s.id);
      if (!mesh) {
        mesh = new THREE.Mesh(
          this.scrollGeo,
          new THREE.MeshStandardMaterial({
            color: RARITY_COLORS[s.rarity],
            emissive: RARITY_COLORS[s.rarity],
            emissiveIntensity: 0.6,
          }),
        );
        this.scrolls.set(s.id, mesh);
        this.scene.add(mesh);
      }
      mesh.position.set(s.x, 0.85 + Math.sin(now * 2.2 + s.id) * 0.12, s.z);
      mesh.rotation.y = now * 1.6 + s.id;
    }
    for (const [id, mesh] of this.scrolls) {
      if (!liveScrolls.has(id)) {
        (mesh.material as THREE.Material).dispose();
        this.scene.remove(mesh);
        this.scrolls.delete(id);
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
      mesh.position.set(c.x, 0.35, c.z);
      mesh.rotation.z = now * 2 + c.id;
    }
    for (const [id, mesh] of this.coins) {
      if (!liveCoins.has(id)) {
        this.scene.remove(mesh);
        this.coins.delete(id);
      }
    }

    // Projectiles
    const prevProj = new Map(prev.projectiles.map((p) => [p.id, p]));
    const liveProj = new Set<number>();
    for (const proj of next.projectiles) {
      liveProj.add(proj.id);
      let mesh = this.projectiles.get(proj.id);
      if (!mesh) {
        const color = PROJECTILE_COLORS[proj.abilityId] ?? 0xffffff;
        mesh = new THREE.Mesh(
          new THREE.SphereGeometry(0.32, 12, 10),
          new THREE.MeshStandardMaterial({ color, emissive: color, emissiveIntensity: 1.4 }),
        );
        this.projectiles.set(proj.id, mesh);
        this.scene.add(mesh);
      }
      const pp = prevProj.get(proj.id) ?? proj;
      mesh.position.set(lerp(pp.x, proj.x, t), 1.1, lerp(pp.z, proj.z, t));
    }
    for (const [id, mesh] of this.projectiles) {
      if (!liveProj.has(id)) {
        this.scene.remove(mesh);
        this.projectiles.delete(id);
      }
    }

    // Zones: orange telegraphs that fill in, green persistent pools.
    const liveZones = new Set<number>();
    for (const zone of next.zones) {
      liveZones.add(zone.id);
      let view = this.zones.get(zone.id);
      if (!view) {
        const isPool = zone.kind === 'pool';
        const color = isPool ? 0x59c33a : 0xffb14d;
        const fillColor = isPool ? 0x3f9c28 : 0xff8c2e;
        const group = new THREE.Group();
        const outline = new THREE.Mesh(
          new THREE.RingGeometry(zone.radius - 0.15, zone.radius, 48),
          new THREE.MeshBasicMaterial({ color, transparent: true, opacity: 0.9 }),
        );
        outline.rotation.x = -Math.PI / 2;
        const fill = new THREE.Mesh(
          new THREE.CircleGeometry(zone.radius, 48),
          new THREE.MeshBasicMaterial({ color: fillColor, transparent: true, opacity: isPool ? 0.4 : 0.3 }),
        );
        fill.rotation.x = -Math.PI / 2;
        group.add(outline, fill);
        group.position.set(zone.x, 0.05, zone.z);
        view = { group, fill, kind: zone.kind };
        this.zones.set(zone.id, view);
        this.scene.add(group);
      }
      if (zone.kind === 'telegraph') {
        const telegraph = ABILITIES[zone.abilityId].telegraph ?? 1;
        const progress = 1 - Math.min(1, zone.endsIn / telegraph);
        view.fill.scale.setScalar(Math.max(0.01, progress));
        (view.fill.material as THREE.MeshBasicMaterial).opacity = 0.3 + 0.15 * Math.sin(now * 18);
      } else {
        (view.fill.material as THREE.MeshBasicMaterial).opacity =
          0.35 + 0.1 * Math.sin(now * 6 + zone.id);
      }
    }
    for (const [id, view] of this.zones) {
      if (!liveZones.has(id)) {
        this.scene.remove(view.group);
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
          this.spawnFlash(ev.x, ev.z, 1.1, 0xcfe8ff, 0.16);
          sfx.cast(ev.abilityId);
          break;
        case 'melee': {
          this.spawnMeleeArc(ev.x, ev.z, ev.facing, ev.combo);
          sfx.melee(ev.combo);
          break;
        }
        case 'detonate':
          this.spawnBurst(ev.x, ev.z, ev.radius, 0xffe38a, 0.35);
          this.spawnFlash(ev.x, ev.z, ev.radius * 0.6, 0xfff6d9, 0.25);
          sfx.detonate();
          break;
        case 'hit':
          if (ev.sourceId !== null) this.spawnFlash(ev.x, ev.z, 0.8, 0xff5b4d, 0.18);
          if (ev.sourceId !== null && ev.amount > 3) sfx.hit();
          break;
        case 'projectileGone':
          this.spawnFlash(ev.x, ev.z, 0.5, 0x9fd8ff, 0.14);
          break;
        case 'death':
          this.spawnBurst(ev.x, ev.z, 2.2, 0x3a3a4a, 0.6);
          sfx.death(ev.id === selfId);
          break;
        case 'mobDeath':
          this.spawnBurst(ev.x, ev.z, ev.elite ? 2.6 : 1.4, ev.elite ? 0xd4af37 : 0x8a6b3d, ev.elite ? 0.6 : 0.4);
          break;
        case 'chestOpened':
          this.spawnFlash(ev.x, ev.z, 1.4, 0xffd75e, 0.4);
          sfx.chest();
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
        case 'coin':
          if (ev.playerId === selfId) sfx.coin();
          break;
        case 'heal':
          this.spawnBurst(ev.x, ev.z, 1.6, 0x5fce6a, 0.5);
          this.spawnFlash(ev.x, ev.z, 1.0, 0x9df0a5, 0.3);
          if (ev.playerId === selfId) sfx.heal();
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
    const arc = (Math.PI * 2) / 3;
    const mat = new THREE.MeshBasicMaterial({
      color: combo === 3 ? 0xffe38a : 0xe8e6d9,
      transparent: true,
      opacity: 0.75,
      side: THREE.DoubleSide,
    });
    const ring = new THREE.Mesh(
      new THREE.RingGeometry(1.1, 2.5, 18, 1, facing - Math.PI / 2 - arc / 2, arc),
      mat,
    );
    ring.rotation.x = -Math.PI / 2;
    ring.position.set(x, 1, z);
    this.scene.add(ring);
    this.effects.push({ obj: ring, mat, age: 0, ttl: 0.16, growth: 0.15 });
  }

  private spawnChainLine(x1: number, z1: number, x2: number, z2: number): void {
    const mat = new THREE.LineBasicMaterial({ color: 0xd8d8e8, transparent: true, opacity: 0.9 });
    const geo = new THREE.BufferGeometry().setFromPoints([
      new THREE.Vector3(x1, 1.2, z1),
      new THREE.Vector3(x2, 1.2, z2),
    ]);
    const line = new THREE.Line(geo, mat);
    this.scene.add(line);
    this.effects.push({ obj: line, mat, age: 0, ttl: 0.25, growth: 0 });
  }

  private spawnFlash(x: number, z: number, size: number, color: number, ttl: number): void {
    const mat = new THREE.MeshBasicMaterial({ color, transparent: true, opacity: 0.85 });
    const mesh = new THREE.Mesh(new THREE.SphereGeometry(size, 12, 10), mat);
    mesh.position.set(x, 1, z);
    this.scene.add(mesh);
    this.effects.push({ obj: mesh, mat, age: 0, ttl, growth: 1.5 });
  }

  private spawnBurst(x: number, z: number, radius: number, color: number, ttl: number): void {
    const mat = new THREE.MeshBasicMaterial({
      color,
      transparent: true,
      opacity: 0.7,
      side: THREE.DoubleSide,
    });
    const mesh = new THREE.Mesh(new THREE.CylinderGeometry(radius, radius, 0.6, 32, 1, true), mat);
    mesh.position.set(x, 0.3, z);
    this.scene.add(mesh);
    this.effects.push({ obj: mesh, mat, age: 0, ttl, growth: 2.2 });
  }

  private updateEffects(dt: number): void {
    const survivors: Effect[] = [];
    for (const fx of this.effects) {
      fx.age += dt;
      const t = fx.age / fx.ttl;
      if (t >= 1) {
        this.scene.remove(fx.obj);
        continue;
      }
      const s = 1 + fx.growth * t;
      fx.obj.scale.set(s, s, s);
      fx.mat.opacity = (1 - t) * 0.85;
      survivors.push(fx);
    }
    this.effects = survivors;
  }

  clear(): void {
    for (const view of this.players.values()) this.scene.remove(view.group);
    for (const view of this.mobs.values()) this.scene.remove(view.group);
    for (const view of this.chests.values()) this.scene.remove(view.group);
    for (const mesh of this.scrolls.values()) this.scene.remove(mesh);
    for (const mesh of this.coins.values()) this.scene.remove(mesh);
    for (const mesh of this.projectiles.values()) this.scene.remove(mesh);
    for (const view of this.zones.values()) this.scene.remove(view.group);
    for (const fx of this.effects) this.scene.remove(fx.obj);
    this.players.clear();
    this.mobs.clear();
    this.chests.clear();
    this.scrolls.clear();
    this.coins.clear();
    this.projectiles.clear();
    this.zones.clear();
    this.effects = [];
  }
}
