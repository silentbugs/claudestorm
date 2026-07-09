import {
  CHEST_CHANNEL_SECONDS,
  COIN_MAGNET_RADIUS,
  COIN_MAGNET_SPEED,
  COIN_PICKUP_RADIUS,
  DEATH_COIN_DROP_FRACTION,
  DEATH_COIN_DROP_MAX,
  DROP_START_Y,
  DROP_TIMEOUT_SECONDS,
  GLIDE_FALL_SPEED,
  ELITE_AGGRO_RADIUS,
  ELITE_BITE_DAMAGE,
  ELITE_BITE_RANGE,
  ELITE_HP,
  ELITE_LEASH_RADIUS,
  ELITE_RADIUS,
  ELITE_SPEED,
  GLIDE_MOVE_SPEED,
  GRAVITY,
  HEAL_AMOUNT,
  HEAL_COOLDOWN,
  INTERACT_RADIUS,
  JUMP_VELOCITY,
  LEVEL_HP_BONUS,
  MAX_LEVEL,
  MELEE_ARC_COS,
  MELEE_COMBO_FINISHER_MULT,
  MELEE_COMBO_WINDOW,
  MELEE_DAMAGE,
  MELEE_INTERVAL,
  MELEE_RANGE,
  MOB_AGGRO_RADIUS,
  MOB_BITE_DAMAGE,
  MOB_BITE_INTERVAL,
  MOB_BITE_RANGE,
  MOB_HP,
  MOB_LEASH_RADIUS,
  MOB_RADIUS,
  MOB_SPEED,
  PLAYER_BASE_HP,
  PLAYER_RADIUS,
  PLAYER_SPEED,
  ROLL_COOLDOWN,
  ROLL_DISTANCE,
  ROLL_DURATION,
  SCROLL_AUTO_PICKUP_RADIUS,
  TICK_DT,
  TICK_RATE,
  XP_PER_CHEST,
  XP_PER_COIN,
  XP_PER_ELITE,
  XP_PER_MOB,
  XP_PER_PLAYER_KILL,
  XP_THRESHOLDS,
  levelDamageMult,
} from '../constants.js';
import { ARENA, type MapDef } from '../maps/arena.js';
import { Rng } from '../math/rng.js';
import { dist, lerp, norm, yawToward } from '../math/vec.js';
import type {
  GameEvent,
  InputCommand,
  MatchPhase,
  PlayerSlots,
  Rarity,
  Snapshot,
} from '../protocol/types.js';
import {
  ABILITIES,
  OFFENSE_ABILITIES,
  RARITY_MULT,
  SLOT_COUNT,
  UTILITY_ABILITIES,
  slotCategory,
  stackedRarity,
  type AbilityDef,
} from './abilities.js';
import { computeBotInput } from './bots.js';
import type {
  ChestEntity,
  CoinEntity,
  ItemEntity,
  MobEntity,
  PlayerEntity,
  ProjectileEntity,
  ScrollEntity,
  ZoneEntity,
} from './entities.js';
import {
  CHEST_ITEM_CHANCE,
  CHICKEN_HEAL_SECONDS,
  CHICKEN_HEAL_TOTAL,
  HOG_SPEED_MULT,
  HOG_SPEED_SECONDS,
  LAUNCHER_DURATION,
  LAUNCHER_RANGE,
  SKIES_LAUNCH_HEIGHT,
  SMOKE_STEALTH_SECONDS,
  rollItem,
  type ItemId,
} from './items.js';
import {
  CHEST_COINS_MAX,
  CHEST_COINS_MIN,
  CHEST_SCROLLS_MAX,
  CHEST_SCROLLS_MIN,
  ELITE_COINS_MAX,
  ELITE_COINS_MIN,
  MOB_COINS_MAX,
  MOB_COINS_MIN,
  MOB_SCROLL_CHANCE,
  rollAbility,
  rollEliteRarity,
  rollRarity,
} from './loot.js';
import { circleBlocked, resolveCollisions } from './movement.js';
import { STORM_PHASES, STORM_START_RADIUS, type StormPhaseDef } from './storm.js';

export interface PlayerSetup {
  id: number;
  name: string;
  isBot: boolean;
  /** Test hook: land at this position instead of dropping in. */
  spawn?: { x: number; z: number };
  /** Starting loadout (bots get a random one when omitted). */
  loadout?: PlayerSlots;
}

export interface GameSimOptions {
  seed: number;
  players: PlayerSetup[];
  map?: MapDef;
  stormPhases?: StormPhaseDef[];
  stormStartRadius?: number;
  /** Test hook: skip the glide drop and start the match live on the ground. */
  skipDrop?: boolean;
}

/**
 * Headless, fixed-tick, server-authoritative game simulation.
 * No DOM or rendering imports — this is exactly what a game server runs later.
 */
export class GameSim {
  readonly map: MapDef;
  readonly players = new Map<number, PlayerEntity>();
  readonly mobs = new Map<number, MobEntity>();
  readonly chests = new Map<number, ChestEntity>();
  readonly scrolls = new Map<number, ScrollEntity>();
  readonly coins = new Map<number, CoinEntity>();
  readonly items = new Map<number, ItemEntity>();

  private tick = 0;
  private phase: MatchPhase;
  private winnerId: number | null = null;
  private readonly rng: Rng;

  private projectiles: ProjectileEntity[] = [];
  private zones: ZoneEntity[] = [];
  private events: GameEvent[] = [];
  private nextEntityId = 1000;

  private readonly stormPhases: StormPhaseDef[];
  private stormPhaseIndex = 0;
  private stormPhaseTime = 0;
  private stormRadius: number;
  private stormRadiusAtPhaseStart: number;
  /** The circle drifts: each phase closes on a new center inside the old circle. */
  private stormCenterX = 0;
  private stormCenterZ = 0;
  private stormCenterAtPhaseStartX = 0;
  private stormCenterAtPhaseStartZ = 0;
  private stormTargetCenterX = 0;
  private stormTargetCenterZ = 0;
  private nextLightningTick = 0;

  constructor(opts: GameSimOptions) {
    this.map = opts.map ?? ARENA;
    this.rng = new Rng(opts.seed);
    this.stormPhases = opts.stormPhases ?? STORM_PHASES;
    this.stormRadius = opts.stormStartRadius ?? STORM_START_RADIUS;
    this.stormRadiusAtPhaseStart = this.stormRadius;
    this.phase = opts.skipDrop ? 'live' : 'drop';
    const firstPhase = this.stormPhases[0];
    if (firstPhase) this.pickStormTargetCenter(firstPhase);

    const n = opts.players.length;
    opts.players.forEach((setup, i) => {
      const angle = (i / Math.max(1, n)) * Math.PI * 2;
      const dropping = !opts.skipDrop && !setup.spawn;
      const x = setup.spawn?.x ?? Math.cos(angle) * 6;
      const z = setup.spawn?.z ?? Math.sin(angle) * 6;
      const loadout: PlayerSlots =
        setup.loadout ??
        (setup.isBot ? this.randomBotLoadout() : { offense: [null, null], utility: [null, null] });
      const landAngle = this.rng.range(0, Math.PI * 2);
      const landR = this.rng.range(15, this.map.size * 0.4);
      this.players.set(setup.id, {
        id: setup.id,
        name: setup.name,
        isBot: setup.isBot,
        x,
        y: dropping ? DROP_START_Y : 0,
        z,
        vy: 0,
        facing: yawToward(x, z, 0, 0),
        hp: PLAYER_BASE_HP,
        maxHp: PLAYER_BASE_HP,
        alive: true,
        moveX: 0,
        moveZ: 0,
        yaw: 0,
        aimX: 0,
        aimZ: 0,
        meleeHeld: false,
        pendingButtons: new Set(),
        pendingSlotCasts: new Set(),
        slotCds: [0, 0, 0, 0],
        meleeCdTicks: 0,
        rollCdTicks: 0,
        healCdTicks: 0,
        comboCount: 0,
        comboExpireTick: 0,
        gliding: dropping,
        rollTicks: 0,
        rollDirX: 0,
        rollDirZ: 0,
        rootTicks: 0,
        slowTicks: 0,
        slowFactor: 1,
        stunTicks: 0,
        poisonTicks: 0,
        poisonDps: 0,
        poisonSourceId: 0,
        stealthTicks: 0,
        immuneTicks: 0,
        faeTicks: 0,
        speedBuffTicks: 0,
        speedBuffMult: 1,
        shieldHp: 0,
        shieldTicks: 0,
        auraTicks: 0,
        auraDps: 0,
        auraRadius: 0,
        chargeSlot: null,
        chargeTicks: 0,
        chargeMaxTicks: 0,
        leapTicks: 0,
        leapTotalTicks: 0,
        leapDirX: 0,
        leapDirZ: 0,
        leapSpeed: 0,
        leapDamage: 0,
        leapLandRadius: 0,
        leapKnockback: 0,
        leapLandStun: 0,
        leapFlat: false,
        leapDashDamage: 0,
        leapHitIds: new Set(),
        kbTicks: 0,
        kbVelX: 0,
        kbVelZ: 0,
        pullTicks: 0,
        pullToX: 0,
        pullToZ: 0,
        channel: null,
        damagedThisTick: false,
        level: 1,
        xp: 0,
        plunder: 0,
        slots: loadout,
        item: setup.isBot && this.rng.next() < 0.5 ? rollItem(this.rng) : null,
        hotTicks: 0,
        hotPerTick: 0,
        bot: setup.isBot
          ? {
              landTargetX: Math.cos(landAngle) * landR,
              landTargetZ: Math.sin(landAngle) * landR,
              waypointX: x,
              waypointZ: z,
              strafeSign: 1,
              nextDecisionTick: 0,
            }
          : null,
      });
    });

    for (const p of this.map.chests) {
      const id = this.nextEntityId++;
      this.chests.set(id, { id, x: p.x, z: p.z, opened: false });
    }
    for (const p of this.map.mobs) this.spawnMob(p.x, p.z, false);
    for (const p of this.map.elites) this.spawnMob(p.x, p.z, true);
    for (const p of this.map.scrolls) {
      this.spawnScroll(p.x, p.z, rollAbility(this.rng), rollRarity(this.rng));
    }
    for (const p of this.map.items) {
      this.spawnItem(p.x, p.z, rollItem(this.rng));
    }
  }

  private spawnItem(x: number, z: number, itemId: ItemId): void {
    const id = this.nextEntityId++;
    this.items.set(id, { id, x, z, itemId });
  }

  private spawnMob(x: number, z: number, elite: boolean): void {
    const id = this.nextEntityId++;
    this.mobs.set(id, {
      id,
      elite,
      x,
      z,
      facing: 0,
      hp: elite ? ELITE_HP : MOB_HP,
      maxHp: elite ? ELITE_HP : MOB_HP,
      radius: elite ? ELITE_RADIUS : MOB_RADIUS,
      speed: elite ? ELITE_SPEED : MOB_SPEED,
      aggroRadius: elite ? ELITE_AGGRO_RADIUS : MOB_AGGRO_RADIUS,
      leashRadius: elite ? ELITE_LEASH_RADIUS : MOB_LEASH_RADIUS,
      biteRange: elite ? ELITE_BITE_RANGE : MOB_BITE_RANGE,
      biteDamage: elite ? ELITE_BITE_DAMAGE : MOB_BITE_DAMAGE,
      homeX: x,
      homeZ: z,
      targetId: null,
      wanderX: x,
      wanderZ: z,
      nextDecisionTick: 0,
      biteCdTicks: 0,
    });
  }

  private randomBotLoadout(): PlayerSlots {
    const offense: PlayerSlots['offense'] = [null, null];
    const utility: PlayerSlots['utility'] = [null, null];
    const o1 = OFFENSE_ABILITIES[this.rng.int(0, OFFENSE_ABILITIES.length)]!;
    offense[0] = { abilityId: o1, rarity: rollRarity(this.rng) };
    if (this.rng.next() < 0.6) {
      const rest = OFFENSE_ABILITIES.filter((a) => a !== o1);
      offense[1] = { abilityId: rest[this.rng.int(0, rest.length)]!, rarity: rollRarity(this.rng) };
    }
    if (this.rng.next() < 0.7) {
      const u1 = UTILITY_ABILITIES[this.rng.int(0, UTILITY_ABILITIES.length)]!;
      utility[0] = { abilityId: u1, rarity: rollRarity(this.rng) };
      if (this.rng.next() < 0.4) {
        const rest = UTILITY_ABILITIES.filter((a) => a !== u1);
        utility[1] = { abilityId: rest[this.rng.int(0, rest.length)]!, rarity: rollRarity(this.rng) };
      }
    }
    return { offense, utility };
  }

  get currentTick(): number {
    return this.tick;
  }

  get matchPhase(): MatchPhase {
    return this.phase;
  }

  applyInput(playerId: number, cmd: InputCommand): void {
    const p = this.players.get(playerId);
    if (!p || !p.alive) return;
    const mag = Math.hypot(cmd.moveX, cmd.moveZ);
    if (mag > 1) {
      p.moveX = cmd.moveX / mag;
      p.moveZ = cmd.moveZ / mag;
    } else {
      p.moveX = cmd.moveX;
      p.moveZ = cmd.moveZ;
    }
    p.yaw = cmd.yaw;
    p.aimX = cmd.aimX;
    p.aimZ = cmd.aimZ;
    p.meleeHeld = cmd.buttons.melee;
    if (cmd.buttons.roll) p.pendingButtons.add('roll');
    if (cmd.buttons.jump) p.pendingButtons.add('jump');
    if (cmd.buttons.interact) p.pendingButtons.add('interact');
    if (cmd.buttons.heal) p.pendingButtons.add('heal');
    if (cmd.buttons.useItem) p.pendingButtons.add('useItem');
    if (cmd.buttons.swapOffense) p.pendingButtons.add('swapOffense');
    if (cmd.buttons.swapUtility) p.pendingButtons.add('swapUtility');
    for (const s of cmd.slotCasts) {
      if (s >= 0 && s < SLOT_COUNT) p.pendingSlotCasts.add(s);
    }
  }

  /** Advance one fixed tick and return the authoritative snapshot. */
  step(): Snapshot {
    this.tick++;
    this.updatePhase();

    const stormView = { x: this.stormCenterX, z: this.stormCenterZ, radius: this.stormRadius };
    for (const p of this.players.values()) {
      if (p.isBot && p.alive) {
        this.applyInput(
          p.id,
          computeBotInput(p, {
            tick: this.tick,
            rng: this.rng,
            players: this.players.values(),
            storm: stormView,
          }),
        );
      }
    }

    for (const p of this.players.values()) {
      if (!p.alive) {
        p.pendingButtons.clear();
        p.pendingSlotCasts.clear();
        continue;
      }
      this.updatePlayer(p);
    }

    this.updateProjectiles();
    this.updateZones();
    this.updateMobs();
    this.updatePickups();
    this.updateStorm();
    this.checkWin();
    return this.makeSnapshot();
  }

  private updatePhase(): void {
    if (this.phase !== 'drop') return;
    let anyGliding = false;
    for (const p of this.players.values()) {
      if (p.alive && p.gliding) anyGliding = true;
    }
    if (!anyGliding) {
      this.phase = 'live';
    } else if (this.tick >= DROP_TIMEOUT_SECONDS * TICK_RATE) {
      for (const p of this.players.values()) {
        if (p.gliding) {
          p.gliding = false;
          p.y = 0;
        }
      }
      this.phase = 'live';
    }
  }

  private updatePlayer(p: PlayerEntity): void {
    p.damagedThisTick = false;
    p.facing = p.yaw;

    for (let i = 0; i < SLOT_COUNT; i++) if (p.slotCds[i]! > 0) p.slotCds[i]!--;
    if (p.meleeCdTicks > 0) p.meleeCdTicks--;
    if (p.rollCdTicks > 0) p.rollCdTicks--;
    if (p.healCdTicks > 0) p.healCdTicks--;
    if (p.slowTicks > 0) p.slowTicks--;
    if (p.rootTicks > 0) p.rootTicks--;
    if (p.stunTicks > 0) p.stunTicks--;
    if (p.stealthTicks > 0) p.stealthTicks--;
    if (p.immuneTicks > 0) p.immuneTicks--;
    if (p.faeTicks > 0) p.faeTicks--;
    if (p.speedBuffTicks > 0) p.speedBuffTicks--;
    if (p.poisonTicks > 0) {
      p.poisonTicks--;
      this.damagePlayer(p, p.poisonDps * TICK_DT, p.poisonSourceId);
      if (!p.alive) return;
    }
    if (p.hotTicks > 0) {
      p.hotTicks--;
      p.hp = Math.min(p.maxHp, p.hp + p.hotPerTick);
    }
    if (p.shieldTicks > 0) {
      p.shieldTicks--;
      if (p.shieldTicks === 0) p.shieldHp = 0;
    }
    if (p.comboCount > 0 && this.tick > p.comboExpireTick) p.comboCount = 0;

    if (p.auraTicks > 0) {
      p.auraTicks--;
      this.auraDamage(p);
    }

    // Charge-and-release casts: build up each tick; a stun cancels the cast
    // (half cooldown), reaching full charge auto-releases.
    if (p.chargeSlot !== null) {
      if (p.stunTicks > 0) {
        this.cancelCharge(p);
      } else {
        p.chargeTicks++;
        if (p.chargeTicks >= p.chargeMaxTicks) this.releaseCharge(p);
      }
    }

    // Buttons. Stun blocks everything; faeform blocks attacks but not movement tools.
    const stunned = p.stunTicks > 0;
    const charging = p.chargeSlot !== null;
    const canAct = !p.gliding && this.phase === 'live' && !stunned && !charging;
    const canAttack = canAct && p.faeTicks === 0;
    if (p.pendingButtons.has('jump') && p.y === 0 && !p.gliding && p.leapTicks === 0 && !stunned && !charging) {
      p.vy = JUMP_VELOCITY;
    }
    if (p.pendingButtons.has('roll') && !p.gliding && p.rollCdTicks === 0 && p.leapTicks === 0 && !stunned && !charging) {
      const dir =
        Math.hypot(p.moveX, p.moveZ) > 0.1
          ? norm(p.moveX, p.moveZ)
          : { x: Math.sin(p.facing), z: Math.cos(p.facing) };
      p.rollDirX = dir.x;
      p.rollDirZ = dir.z;
      p.rollTicks = Math.round(ROLL_DURATION * TICK_RATE);
      p.rollCdTicks = Math.round(ROLL_COOLDOWN * TICK_RATE);
      p.channel = null;
    }
    if (p.pendingButtons.has('interact') && !p.gliding && !charging) this.handleInteract(p);
    if (canAct && p.pendingButtons.has('heal') && p.healCdTicks === 0 && p.hp < p.maxHp) {
      const amount = Math.min(HEAL_AMOUNT, p.maxHp - p.hp);
      p.hp += amount;
      p.healCdTicks = Math.round(HEAL_COOLDOWN * TICK_RATE);
      this.events.push({ type: 'heal', playerId: p.id, amount, x: p.x, z: p.z });
    }
    if (canAct && p.pendingButtons.has('useItem') && p.item) this.useItem(p);
    // Rearranging the bar is always safe except mid-charge (chargeSlot is an index).
    if (!charging && p.pendingButtons.has('swapOffense')) this.swapSlotPair(p, 'offense');
    if (!charging && p.pendingButtons.has('swapUtility')) this.swapSlotPair(p, 'utility');
    if (canAttack && p.meleeHeld && p.meleeCdTicks === 0 && p.leapTicks === 0) this.meleeSwing(p);
    if (canAttack) {
      for (const slot of p.pendingSlotCasts) this.tryCastSlot(p, slot);
    } else if (p.chargeSlot !== null && !stunned && this.phase === 'live') {
      // Re-pressing the charging slot releases the cast early.
      if (p.pendingSlotCasts.has(p.chargeSlot)) this.releaseCharge(p);
    }
    p.pendingButtons.clear();
    p.pendingSlotCasts.clear();

    // Channel: cancelled by moving, acting, or taking damage.
    if (p.channel) {
      const moved = Math.hypot(p.moveX, p.moveZ) > 0.1;
      if (moved || p.damagedThisTick || p.rollTicks > 0) {
        p.channel = null;
      } else {
        p.channel.ticksLeft--;
        if (p.channel.ticksLeft <= 0) {
          const chest = this.chests.get(p.channel.chestId);
          p.channel = null;
          if (chest && !chest.opened) this.openChest(chest, p);
        }
      }
    }

    // Movement
    let vx = 0;
    let vz = 0;
    if (p.gliding) {
      vx = p.moveX * GLIDE_MOVE_SPEED;
      vz = p.moveZ * GLIDE_MOVE_SPEED;
      p.y -= GLIDE_FALL_SPEED * TICK_DT;
      if (p.y <= 0) {
        p.y = 0;
        p.gliding = false;
      }
    } else if (p.pullTicks > 0) {
      const remaining = p.pullTicks;
      vx = (p.pullToX - p.x) / (remaining * TICK_DT);
      vz = (p.pullToZ - p.z) / (remaining * TICK_DT);
      p.pullTicks--;
    } else if (p.kbTicks > 0) {
      vx = p.kbVelX;
      vz = p.kbVelZ;
      p.kbTicks--;
    } else if (p.leapTicks > 0) {
      vx = p.leapDirX * p.leapSpeed;
      vz = p.leapDirZ * p.leapSpeed;
      p.leapTicks--;
      if (p.leapFlat) {
        p.y = 0;
      } else {
        const t = 1 - p.leapTicks / p.leapTotalTicks;
        p.y = Math.max(0, 10 * t * (1 - t));
      }
      // Slicing Winds: carve through anyone touched mid-dash, once each.
      if (p.leapDashDamage > 0) {
        for (const target of this.players.values()) {
          if (!target.alive || target.id === p.id || p.leapHitIds.has(target.id)) continue;
          if (dist(p.x, p.z, target.x, target.z) < 1.4) {
            p.leapHitIds.add(target.id);
            this.damagePlayer(target, p.leapDashDamage, p.id);
          }
        }
        for (const mob of this.mobs.values()) {
          if (p.leapHitIds.has(mob.id)) continue;
          if (dist(p.x, p.z, mob.x, mob.z) < 1.4 + mob.radius) {
            p.leapHitIds.add(mob.id);
            this.damageMob(mob, p.leapDashDamage, p.id);
          }
        }
      }
      if (p.leapTicks === 0) {
        p.y = 0;
        this.leapLand(p);
      }
    } else if (p.chargeSlot !== null) {
      if (this.chargeDef(p)?.chargeAir) {
        // Celestial Barrage: rise and hover while gathering starlight.
        p.y = Math.min(2.4, p.y + 5 * TICK_DT);
        p.vy = 0;
      } else {
        // Ground charge (Slicing Winds): creep while winding up.
        const speed = PLAYER_SPEED * 0.4 * (p.slowTicks > 0 ? p.slowFactor : 1);
        vx = p.moveX * speed;
        vz = p.moveZ * speed;
      }
    } else if (p.rollTicks > 0) {
      p.rollTicks--;
      vx = p.rollDirX * (ROLL_DISTANCE / ROLL_DURATION);
      vz = p.rollDirZ * (ROLL_DISTANCE / ROLL_DURATION);
    } else if (p.rootTicks > 0 || p.stunTicks > 0) {
      // rooted or stunned: no horizontal movement
    } else {
      const speed =
        PLAYER_SPEED *
        (p.slowTicks > 0 ? p.slowFactor : 1) *
        (p.speedBuffTicks > 0 ? p.speedBuffMult : 1) *
        (p.faeTicks > 0 ? 1.4 : 1);
      vx = p.moveX * speed;
      vz = p.moveZ * speed;
    }

    // Jump physics (not while gliding, leaping, or hovering — those own y).
    const hovering = p.chargeSlot !== null && this.chargeDef(p)?.chargeAir === true;
    if (!p.gliding && p.leapTicks === 0 && !hovering && (p.y > 0 || p.vy !== 0)) {
      p.vy -= GRAVITY * TICK_DT;
      p.y += p.vy * TICK_DT;
      if (p.y <= 0) {
        p.y = 0;
        p.vy = 0;
      }
    }

    const resolved = resolveCollisions(p.x + vx * TICK_DT, p.z + vz * TICK_DT, PLAYER_RADIUS, this.map);
    p.x = resolved.x;
    p.z = resolved.z;
  }

  private meleeSwing(p: PlayerEntity): void {
    p.stealthTicks = 0; // attacking breaks stealth
    p.meleeCdTicks = Math.round(MELEE_INTERVAL * TICK_RATE);
    p.comboCount = p.comboCount >= 3 ? 1 : p.comboCount + 1;
    p.comboExpireTick = this.tick + Math.round(MELEE_COMBO_WINDOW * TICK_RATE);
    const mult = (p.comboCount === 3 ? MELEE_COMBO_FINISHER_MULT : 1) * levelDamageMult(p.level);
    const damage = MELEE_DAMAGE * mult;
    const fx = Math.sin(p.facing);
    const fz = Math.cos(p.facing);
    this.events.push({ type: 'melee', casterId: p.id, x: p.x, z: p.z, facing: p.facing, combo: p.comboCount });

    for (const target of this.players.values()) {
      if (!target.alive || target.id === p.id) continue;
      if (!this.inMeleeArc(p.x, p.z, fx, fz, target.x, target.z, PLAYER_RADIUS)) continue;
      this.damagePlayer(target, damage, p.id);
    }
    for (const mob of this.mobs.values()) {
      if (!this.inMeleeArc(p.x, p.z, fx, fz, mob.x, mob.z, mob.radius)) continue;
      this.damageMob(mob, damage, p.id);
    }
  }

  private inMeleeArc(
    x: number,
    z: number,
    fx: number,
    fz: number,
    tx: number,
    tz: number,
    targetRadius: number,
  ): boolean {
    const d = dist(x, z, tx, tz);
    if (d > MELEE_RANGE + targetRadius) return false;
    if (d < 0.01) return true;
    const dot = ((tx - x) / d) * fx + ((tz - z) / d) * fz;
    return dot > MELEE_ARC_COS;
  }

  private tryCastSlot(p: PlayerEntity, slotIndex: number): void {
    const category = slotCategory(slotIndex);
    const equipped =
      category === 'offense' ? p.slots.offense[slotIndex] : p.slots.utility[slotIndex - 2];
    if (!equipped || p.slotCds[slotIndex]! > 0) return;
    const def = ABILITIES[equipped.abilityId];
    const scale = RARITY_MULT[equipped.rarity] * levelDamageMult(p.level);
    if (def.chargeSeconds) {
      // Charge-and-release: cooldown and effect land when the cast is released.
      p.chargeSlot = slotIndex;
      p.chargeTicks = 0;
      p.chargeMaxTicks = Math.max(1, Math.round(def.chargeSeconds * TICK_RATE));
      p.channel = null;
      p.stealthTicks = 0;
      this.events.push({ type: 'cast', casterId: p.id, abilityId: def.id, x: p.x, z: p.z });
      return;
    }
    p.slotCds[slotIndex] = Math.round(def.cooldown * TICK_RATE);
    p.channel = null;
    if (def.behavior !== 'buff' && !def.blink) p.stealthTicks = 0; // attacking breaks stealth
    this.events.push({ type: 'cast', casterId: p.id, abilityId: def.id, x: p.x, z: p.z });

    switch (def.behavior) {
      case 'projectile': {
        this.spawnProjectiles(p, def, scale, 1);
        break;
      }
      case 'groundAoE': {
        // The circle lands along the character's facing; the cursor's distance
        // from the caster only picks how far out (clamped to cast range).
        const d = Math.min(dist(p.x, p.z, p.aimX, p.aimZ), def.castRange!);
        const tx = p.x + Math.sin(p.facing) * d;
        const tz = p.z + Math.cos(p.facing) * d;
        this.zones.push({
          id: this.nextEntityId++,
          abilityId: def.id,
          ownerId: p.id,
          kind: 'telegraph',
          x: tx,
          z: tz,
          radius: def.aoeRadius!,
          damage: def.damage * scale,
          endTick: this.tick + Math.round(def.telegraph! * TICK_RATE),
          dps: 0,
          slowFactor: 1,
          rootDuration: 0,
        });
        break;
      }
      case 'cone': {
        this.coneAttack(p, def, scale);
        break;
      }
      case 'selfAura': {
        p.auraTicks = Math.round(def.auraDuration! * TICK_RATE);
        p.auraDps = def.damage * scale;
        p.auraRadius = def.auraRadius!;
        if (def.auraSpeedMult) {
          p.speedBuffTicks = p.auraTicks;
          p.speedBuffMult = def.auraSpeedMult;
        }
        break;
      }
      case 'leap': {
        this.startLeap(p, def, scale, 1);
        break;
      }
      case 'shield': {
        p.shieldHp = def.shieldAmount! * scale;
        p.shieldTicks = Math.round(def.shieldDuration! * TICK_RATE);
        break;
      }
      case 'buff': {
        const ticks = Math.round(def.buffDuration! * TICK_RATE);
        if (def.buffKind === 'immune') p.immuneTicks = ticks;
        else p.faeTicks = ticks;
        break;
      }
      case 'trap': {
        const fx = Math.sin(p.facing);
        const fz = Math.cos(p.facing);
        const count = def.trapCount ?? 3;
        for (let i = 0; i < count; i++) {
          const side = (i - (count - 1) / 2) * 1.6;
          this.zones.push({
            id: this.nextEntityId++,
            abilityId: def.id,
            ownerId: p.id,
            kind: 'trap',
            x: p.x + fx * 3 + -fz * side,
            z: p.z + fz * 3 + fx * side,
            radius: def.trapRadius ?? 1.2,
            damage: def.damage * scale,
            endTick: this.tick + Math.round((def.trapDuration ?? 15) * TICK_RATE),
            dps: 0,
            slowFactor: 1,
            rootDuration: def.rootDuration ?? 1,
          });
        }
        break;
      }
    }
  }

  /** Fire a projectile (or fan volley) along the caster's facing. reachMult stretches lifetime (charged casts). */
  private spawnProjectiles(p: PlayerEntity, def: AbilityDef, scale: number, reachMult: number): void {
    // Plunderstorm-style: spells launch where the character looks; only
    // aimAtCursor spells (Celestial Barrage) track the cursor's ground point.
    let dir = def.aimAtCursor
      ? norm(p.aimX - p.x, p.aimZ - p.z)
      : { x: Math.sin(p.facing), z: Math.cos(p.facing) };
    if (dir.x === 0 && dir.z === 0) dir = { x: Math.sin(p.facing), z: Math.cos(p.facing) };
    const count = def.volley ?? 1;
    const spread = def.volleySpreadRad ?? 0;
    const baseAngle = Math.atan2(dir.x, dir.z);
    for (let i = 0; i < count; i++) {
      const angle = baseAngle + (count > 1 ? spread * (i / (count - 1) - 0.5) : 0);
      const dx = Math.sin(angle);
      const dz = Math.cos(angle);
      const spawnDist = PLAYER_RADIUS + def.projectileRadius! + 0.1;
      this.projectiles.push({
        id: this.nextEntityId++,
        abilityId: def.id,
        ownerId: p.id,
        x: p.x + dx * spawnDist,
        z: p.z + dz * spawnDist,
        dirX: dx,
        dirZ: dz,
        speed: def.projectileSpeed!,
        radius: def.projectileRadius!,
        damage: def.damage * scale,
        ticksLeft: Math.max(1, Math.round(def.projectileLifetime! * TICK_RATE * reachMult)),
        scale,
        returning: false,
        hitIds: new Set(),
      });
    }
  }

  /** Begin a leap/dash/blink. reachMult scales the distance covered (charged casts). */
  private startLeap(p: PlayerEntity, def: AbilityDef, scale: number, reachMult: number): void {
    let dir = norm(p.moveX, p.moveZ);
    if (dir.x === 0 && dir.z === 0) dir = { x: Math.sin(p.facing), z: Math.cos(p.facing) };
    if (def.dashBackward) dir = { x: -dir.x, z: -dir.z };
    // Explosive Caltrops: the cluster lands where you were standing.
    if (def.poolRadius) {
      this.zones.push({
        id: this.nextEntityId++,
        abilityId: def.id,
        ownerId: p.id,
        kind: 'pool',
        x: p.x,
        z: p.z,
        radius: def.poolRadius,
        damage: 0,
        endTick: this.tick + Math.round(def.poolDuration! * TICK_RATE),
        dps: (def.poolDps ?? 0) * scale,
        slowFactor: def.poolSlowFactor ?? 1,
        rootDuration: 0,
      });
    }
    if (def.blink) {
      // Fade to Shadow: instant reposition + stealth.
      const resolved = resolveCollisions(
        p.x + dir.x * def.leapRange! * reachMult,
        p.z + dir.z * def.leapRange! * reachMult,
        PLAYER_RADIUS,
        this.map,
      );
      p.x = resolved.x;
      p.z = resolved.z;
      p.stealthTicks = Math.round((def.stealthDuration ?? 0) * TICK_RATE);
      return;
    }
    p.leapDirX = dir.x;
    p.leapDirZ = dir.z;
    p.leapTotalTicks = Math.max(1, Math.round(def.leapDuration! * reachMult * TICK_RATE));
    p.leapTicks = p.leapTotalTicks;
    p.leapSpeed = (def.leapRange! * reachMult) / (p.leapTotalTicks * TICK_DT);
    p.leapDamage = def.damage * scale;
    p.leapLandRadius = def.landRadius!;
    p.leapKnockback = def.knockbackDistance ?? 0;
    p.leapLandStun = def.landStunDuration ?? 0;
    p.leapFlat = def.dashFlat ?? false;
    p.leapDashDamage = def.dashDamage ? def.damage * scale : 0;
    p.leapHitIds = new Set();
  }

  /** The ability currently being charged, or null. */
  private chargeDef(p: PlayerEntity): AbilityDef | null {
    if (p.chargeSlot === null) return null;
    const equipped =
      slotCategory(p.chargeSlot) === 'offense'
        ? p.slots.offense[p.chargeSlot]
        : p.slots.utility[p.chargeSlot - 2];
    return equipped ? ABILITIES[equipped.abilityId] : null;
  }

  /** Release a charged cast: effect and cooldown scale with how long it was held. */
  private releaseCharge(p: PlayerEntity): void {
    const slotIndex = p.chargeSlot!;
    const def = this.chargeDef(p);
    const fraction = p.chargeMaxTicks > 0 ? Math.min(1, p.chargeTicks / p.chargeMaxTicks) : 1;
    p.chargeSlot = null;
    if (!def?.chargeSeconds) return;
    const category = slotCategory(slotIndex);
    const equipped =
      category === 'offense' ? p.slots.offense[slotIndex] : p.slots.utility[slotIndex - 2];
    if (!equipped) return;
    // Effect power: chargeMinFraction at an instant tap, 1 at full charge.
    const min = def.chargeMinFraction ?? 0.5;
    const power = min + (1 - min) * fraction;
    const scale = RARITY_MULT[equipped.rarity] * levelDamageMult(p.level) * power;
    p.slotCds[slotIndex] = Math.round(def.cooldown * TICK_RATE);
    this.events.push({
      type: 'chargeRelease',
      casterId: p.id,
      abilityId: def.id,
      x: p.x,
      z: p.z,
      fraction: power,
    });
    if (def.behavior === 'leap') this.startLeap(p, def, scale, power);
    else if (def.behavior === 'projectile') this.spawnProjectiles(p, def, scale, power);
  }

  /** A stun (or death) interrupts the charge: no effect, half cooldown. */
  private cancelCharge(p: PlayerEntity): void {
    const slotIndex = p.chargeSlot!;
    const def = this.chargeDef(p);
    p.chargeSlot = null;
    if (def) p.slotCds[slotIndex] = Math.round(def.cooldown * 0.5 * TICK_RATE);
  }

  /** Swap the two slots of a pair (1↔2 or 3↔4), cooldowns included. */
  private swapSlotPair(p: PlayerEntity, category: 'offense' | 'utility'): void {
    const pair = category === 'offense' ? p.slots.offense : p.slots.utility;
    [pair[0], pair[1]] = [pair[1] ?? null, pair[0] ?? null];
    const base = category === 'offense' ? 0 : 2;
    const tmp = p.slotCds[base]!;
    p.slotCds[base] = p.slotCds[base + 1]!;
    p.slotCds[base + 1] = tmp;
  }

  private useItem(p: PlayerEntity): void {
    const itemId = p.item!;
    p.item = null;
    this.events.push({ type: 'itemUsed', playerId: p.id, itemId, x: p.x, z: p.z });
    switch (itemId) {
      case 'chickenCoup': {
        const ticks = Math.round(CHICKEN_HEAL_SECONDS * TICK_RATE);
        p.hotTicks = ticks;
        p.hotPerTick = CHICKEN_HEAL_TOTAL / ticks;
        break;
      }
      case 'smokeBomb':
        p.stealthTicks = Math.round(SMOKE_STEALTH_SECONDS * TICK_RATE);
        break;
      case 'mechanoHog':
        p.speedBuffTicks = Math.round(HOG_SPEED_SECONDS * TICK_RATE);
        p.speedBuffMult = HOG_SPEED_MULT;
        break;
      case 'gravityLauncher': {
        let dir = norm(p.moveX, p.moveZ);
        if (dir.x === 0 && dir.z === 0) dir = { x: Math.sin(p.facing), z: Math.cos(p.facing) };
        p.leapDirX = dir.x;
        p.leapDirZ = dir.z;
        p.leapTotalTicks = Math.round(LAUNCHER_DURATION * TICK_RATE);
        p.leapTicks = p.leapTotalTicks;
        p.leapSpeed = LAUNCHER_RANGE / LAUNCHER_DURATION;
        p.leapDamage = 0;
        p.leapLandRadius = 0;
        p.leapKnockback = 0;
        p.leapLandStun = 0;
        p.leapFlat = false;
        p.leapDashDamage = 0;
        p.leapHitIds = new Set();
        break;
      }
      case 'toTheSkies':
        p.gliding = true;
        p.y = Math.max(p.y, SKIES_LAUNCH_HEIGHT);
        p.vy = 0;
        p.leapTicks = 0;
        p.channel = null;
        break;
    }
  }

  /** Instant swing in a front arc (Searing Axe, Toxic Smackerel). */
  private coneAttack(p: PlayerEntity, def: AbilityDef, scale: number): void {
    const fx = Math.sin(p.facing);
    const fz = Math.cos(p.facing);
    const range = def.coneRange!;
    const arcCos = def.coneArcCos!;
    const inCone = (tx: number, tz: number, r: number): boolean => {
      const d = dist(p.x, p.z, tx, tz);
      if (d > range + r) return false;
      if (d < 0.01) return true;
      return ((tx - p.x) / d) * fx + ((tz - p.z) / d) * fz > arcCos;
    };
    for (const target of this.players.values()) {
      if (!target.alive || target.id === p.id) continue;
      if (!inCone(target.x, target.z, PLAYER_RADIUS)) continue;
      let damage = def.damage * scale;
      if (def.poisonBonusMult && target.poisonTicks > 0) damage *= def.poisonBonusMult;
      this.damagePlayer(target, damage, p.id);
      if (!target.alive) continue;
      if (def.poisonDps) {
        target.poisonTicks = Math.round(def.poisonDuration! * TICK_RATE);
        target.poisonDps = def.poisonDps * scale;
        target.poisonSourceId = p.id;
      }
      if (def.knockbackDistance) {
        const dir = norm(target.x - p.x, target.z - p.z);
        target.kbTicks = 4;
        target.kbVelX = dir.x * def.knockbackDistance * 5;
        target.kbVelZ = dir.z * def.knockbackDistance * 5;
      }
    }
    for (const mob of this.mobs.values()) {
      if (inCone(mob.x, mob.z, mob.radius)) this.damageMob(mob, def.damage * scale, p.id);
    }
  }

  private leapLand(p: PlayerEntity): void {
    if (p.leapLandRadius <= 0) return; // pure movement dash: no landing slam
    this.events.push({ type: 'detonate', x: p.x, z: p.z, radius: p.leapLandRadius, abilityId: 'quakingLeap' });
    for (const target of this.players.values()) {
      if (!target.alive || target.id === p.id) continue;
      const d = dist(p.x, p.z, target.x, target.z);
      if (d > p.leapLandRadius) continue;
      this.damagePlayer(target, p.leapDamage, p.id);
      if (target.alive) {
        if (p.leapLandStun > 0) {
          target.stunTicks = Math.max(target.stunTicks, Math.round(p.leapLandStun * TICK_RATE));
        }
        if (p.leapKnockback > 0) {
          const dir = d > 0.01 ? norm(target.x - p.x, target.z - p.z) : { x: 1, z: 0 };
          target.kbTicks = 4;
          target.kbVelX = dir.x * p.leapKnockback * 5;
          target.kbVelZ = dir.z * p.leapKnockback * 5;
        }
      }
    }
    for (const mob of this.mobs.values()) {
      if (dist(p.x, p.z, mob.x, mob.z) <= p.leapLandRadius) {
        this.damageMob(mob, p.leapDamage, p.id);
      }
    }
  }

  private auraDamage(p: PlayerEntity): void {
    for (const target of this.players.values()) {
      if (!target.alive || target.id === p.id) continue;
      if (dist(p.x, p.z, target.x, target.z) <= p.auraRadius + PLAYER_RADIUS) {
        this.damagePlayer(target, p.auraDps * TICK_DT, p.id);
      }
    }
    for (const mob of this.mobs.values()) {
      if (dist(p.x, p.z, mob.x, mob.z) <= p.auraRadius + mob.radius) {
        this.damageMob(mob, p.auraDps * TICK_DT, p.id);
      }
    }
  }

  private handleInteract(p: PlayerEntity): void {
    let bestScroll: ScrollEntity | null = null;
    let bestScrollDist = INTERACT_RADIUS;
    for (const s of this.scrolls.values()) {
      const d = dist(p.x, p.z, s.x, s.z);
      if (d < bestScrollDist) {
        bestScrollDist = d;
        bestScroll = s;
      }
    }
    if (bestScroll) {
      this.equipScroll(p, bestScroll, true);
      return;
    }
    let bestChest: ChestEntity | null = null;
    let bestChestDist = INTERACT_RADIUS;
    for (const c of this.chests.values()) {
      if (c.opened) continue;
      const d = dist(p.x, p.z, c.x, c.z);
      if (d < bestChestDist) {
        bestChestDist = d;
        bestChest = c;
      }
    }
    if (bestChest && !p.channel) {
      const total = Math.round(CHEST_CHANNEL_SECONDS * TICK_RATE);
      p.channel = { chestId: bestChest.id, ticksLeft: total, totalTicks: total };
    }
  }

  private equipScroll(p: PlayerEntity, scroll: ScrollEntity, force: boolean): boolean {
    const def = ABILITIES[scroll.abilityId];
    const arr = def.category === 'offense' ? p.slots.offense : p.slots.utility;
    // Duplicate of an equipped ability: stack it into a higher rank (Plunderstorm-style).
    const dupIdx = arr.findIndex((s) => s?.abilityId === scroll.abilityId);
    if (dupIdx !== -1) {
      const next = stackedRarity(arr[dupIdx]!.rarity, scroll.rarity);
      if (next === null) return false; // already max rank — leave the scroll
      arr[dupIdx] = { abilityId: scroll.abilityId, rarity: next };
      this.scrolls.delete(scroll.id);
      this.events.push({ type: 'upgrade', playerId: p.id, abilityId: scroll.abilityId, rarity: next });
      return true;
    }
    let idx = arr.findIndex((s) => s === null);
    if (idx === -1) {
      if (!force) return false;
      idx = 0;
      const old = arr[0]!;
      this.spawnScroll(p.x, p.z, old.abilityId, old.rarity);
    }
    arr[idx] = { abilityId: scroll.abilityId, rarity: scroll.rarity };
    this.scrolls.delete(scroll.id);
    this.events.push({ type: 'equip', playerId: p.id, abilityId: scroll.abilityId, rarity: scroll.rarity });
    return true;
  }

  private openChest(chest: ChestEntity, opener: PlayerEntity): void {
    chest.opened = true;
    this.events.push({ type: 'chestOpened', x: chest.x, z: chest.z });
    const coins = this.rng.int(CHEST_COINS_MIN, CHEST_COINS_MAX + 1);
    for (let i = 0; i < coins; i++) this.spawnCoin(chest.x, chest.z);
    const scrolls = this.rng.int(CHEST_SCROLLS_MIN, CHEST_SCROLLS_MAX + 1);
    for (let i = 0; i < scrolls; i++) {
      const angle = this.rng.range(0, Math.PI * 2);
      const r = this.rng.range(0.8, 1.8);
      this.spawnScroll(
        chest.x + Math.cos(angle) * r,
        chest.z + Math.sin(angle) * r,
        rollAbility(this.rng),
        rollRarity(this.rng),
      );
    }
    if (this.rng.next() < CHEST_ITEM_CHANCE) {
      const angle = this.rng.range(0, Math.PI * 2);
      this.spawnItem(chest.x + Math.cos(angle) * 1.4, chest.z + Math.sin(angle) * 1.4, rollItem(this.rng));
    }
    this.awardXp(opener, XP_PER_CHEST);
  }

  private spawnScroll(x: number, z: number, abilityId: ScrollEntity['abilityId'], rarity: Rarity): void {
    const id = this.nextEntityId++;
    this.scrolls.set(id, { id, x, z, abilityId, rarity });
  }

  private spawnCoin(x: number, z: number): void {
    const id = this.nextEntityId++;
    const angle = this.rng.range(0, Math.PI * 2);
    const r = this.rng.range(0.3, 1.6);
    this.coins.set(id, { id, x: x + Math.cos(angle) * r, z: z + Math.sin(angle) * r });
  }

  private updateProjectiles(): void {
    const survivors: ProjectileEntity[] = [];
    for (const proj of this.projectiles) {
      const def = ABILITIES[proj.abilityId];
      const owner = this.players.get(proj.ownerId);

      // Boomerang (Holy Shield): after the outward leg, home back to the owner.
      if (def.boomerang && proj.ticksLeft <= 0 && !proj.returning) {
        proj.returning = true;
      }
      if (proj.returning && owner?.alive) {
        const back = norm(owner.x - proj.x, owner.z - proj.z);
        proj.dirX = back.x;
        proj.dirZ = back.z;
      }
      proj.x += proj.dirX * proj.speed * TICK_DT;
      proj.z += proj.dirZ * proj.speed * TICK_DT;
      proj.ticksLeft--;

      let gone = false;
      if (proj.returning) {
        // Caught by the owner (or owner died mid-flight).
        if (!owner?.alive || dist(proj.x, proj.z, owner.x, owner.z) < 1.0) gone = true;
      } else if (!def.pierce && circleBlocked(proj.x, proj.z, proj.radius, this.map)) {
        gone = true;
      } else if (proj.ticksLeft <= 0 && !def.boomerang) {
        gone = true;
      }

      if (!gone) {
        for (const target of this.players.values()) {
          if (!target.alive || target.id === proj.ownerId || proj.hitIds.has(target.id)) continue;
          if (target.rollTicks > 0) continue; // barrel roll dodges projectiles
          if (dist(proj.x, proj.z, target.x, target.z) < proj.radius + PLAYER_RADIUS) {
            proj.hitIds.add(target.id);
            this.damagePlayer(target, proj.damage, proj.ownerId);
            if (target.alive) {
              if (def.slowDuration) {
                target.slowTicks = Math.round(def.slowDuration * TICK_RATE);
                target.slowFactor = def.slowFactor ?? 1;
              }
              if (def.stunDuration) {
                target.stunTicks = Math.max(target.stunTicks, Math.round(def.stunDuration * TICK_RATE));
              }
              if (def.knockbackDistance) {
                const dir = norm(target.x - proj.x + proj.dirX, target.z - proj.z + proj.dirZ);
                target.kbTicks = 4;
                target.kbVelX = dir.x * def.knockbackDistance * 5;
                target.kbVelZ = dir.z * def.knockbackDistance * 5;
              }
              if (def.pull) this.pullTarget(proj.ownerId, target, def.rootDuration ?? 0);
            }
            // Chilling splash around the impact (Rime Arrow).
            if (def.splashRadius) {
              for (const other of this.players.values()) {
                if (!other.alive || other.id === proj.ownerId || other.id === target.id) continue;
                if (dist(proj.x, proj.z, other.x, other.z) <= def.splashRadius) {
                  this.damagePlayer(other, proj.damage * (def.splashMult ?? 0.5), proj.ownerId);
                  if (other.alive && def.slowDuration) {
                    other.slowTicks = Math.round(def.slowDuration * TICK_RATE);
                    other.slowFactor = def.slowFactor ?? 1;
                  }
                }
              }
            }
            if (!def.boomerang && !def.pierce) gone = true;
            break;
          }
        }
        if (!gone) {
          for (const mob of this.mobs.values()) {
            if (proj.hitIds.has(mob.id)) continue;
            if (dist(proj.x, proj.z, mob.x, mob.z) < proj.radius + mob.radius) {
              proj.hitIds.add(mob.id);
              this.damageMob(mob, proj.damage, proj.ownerId);
              if (!def.boomerang && !def.pierce) gone = true;
              break;
            }
          }
        }
      }

      if (gone) {
        if (def.poolRadius) {
          this.zones.push({
            id: this.nextEntityId++,
            abilityId: proj.abilityId,
            ownerId: proj.ownerId,
            kind: 'pool',
            x: proj.x,
            z: proj.z,
            radius: def.poolRadius,
            damage: 0,
            endTick: this.tick + Math.round(def.poolDuration! * TICK_RATE),
            dps: (def.poolDps ?? 0) * proj.scale,
            slowFactor: def.poolSlowFactor ?? 1,
            rootDuration: 0,
          });
        }
        this.events.push({ type: 'projectileGone', id: proj.id, x: proj.x, z: proj.z });
      } else {
        survivors.push(proj);
      }
    }
    this.projectiles = survivors;
  }

  private pullTarget(casterId: number, target: PlayerEntity, rootDuration: number): void {
    const caster = this.players.get(casterId);
    if (!caster || !caster.alive) return;
    const dir = norm(target.x - caster.x, target.z - caster.z);
    target.pullToX = caster.x + dir.x * 1.5;
    target.pullToZ = caster.z + dir.z * 1.5;
    target.pullTicks = 4;
    target.rootTicks = Math.round(rootDuration * TICK_RATE) + 4;
    this.events.push({ type: 'pull', casterId, targetId: target.id });
  }

  private updateZones(): void {
    const survivors: ZoneEntity[] = [];
    for (const zone of this.zones) {
      if (zone.kind === 'telegraph') {
        if (this.tick < zone.endTick) {
          survivors.push(zone);
          continue;
        }
        this.events.push({ type: 'detonate', x: zone.x, z: zone.z, radius: zone.radius, abilityId: zone.abilityId });
        const zoneDef = ABILITIES[zone.abilityId];
        for (const target of this.players.values()) {
          if (!target.alive || target.id === zone.ownerId) continue;
          if (dist(zone.x, zone.z, target.x, target.z) <= zone.radius + PLAYER_RADIUS / 2) {
            if (zone.damage > 0) this.damagePlayer(target, zone.damage, zone.ownerId);
            if (!target.alive) continue;
            if (zoneDef.stunDuration) {
              target.stunTicks = Math.max(target.stunTicks, Math.round(zoneDef.stunDuration * TICK_RATE));
            }
            if (zoneDef.rootDuration) {
              target.rootTicks = Math.max(target.rootTicks, Math.round(zoneDef.rootDuration * TICK_RATE));
            }
          }
        }
        for (const mob of this.mobs.values()) {
          if (zone.damage > 0 && dist(zone.x, zone.z, mob.x, mob.z) <= zone.radius + mob.radius) {
            this.damageMob(mob, zone.damage, zone.ownerId);
          }
        }
        // Snowdrift: the detonation leaves a chilling pool behind.
        if (zoneDef.poolRadius && zoneDef.behavior === 'groundAoE') {
          const scale = zone.damage > 0 ? zone.damage / Math.max(1, zoneDef.damage) : 1;
          this.zones.push({
            id: this.nextEntityId++,
            abilityId: zone.abilityId,
            ownerId: zone.ownerId,
            kind: 'pool',
            x: zone.x,
            z: zone.z,
            radius: zoneDef.poolRadius,
            damage: 0,
            endTick: this.tick + Math.round(zoneDef.poolDuration! * TICK_RATE),
            dps: (zoneDef.poolDps ?? 0) * scale,
            slowFactor: zoneDef.poolSlowFactor ?? 1,
            rootDuration: 0,
          });
        }
      } else if (zone.kind === 'trap') {
        if (this.tick >= zone.endTick) continue;
        let sprung = false;
        for (const target of this.players.values()) {
          if (!target.alive || target.id === zone.ownerId) continue;
          if (dist(zone.x, zone.z, target.x, target.z) <= zone.radius + PLAYER_RADIUS / 2) {
            this.damagePlayer(target, zone.damage, zone.ownerId);
            if (target.alive) {
              target.rootTicks = Math.max(target.rootTicks, Math.round(zone.rootDuration * TICK_RATE));
            }
            this.events.push({ type: 'detonate', x: zone.x, z: zone.z, radius: zone.radius, abilityId: zone.abilityId });
            sprung = true;
            break;
          }
        }
        if (!sprung) survivors.push(zone);
      } else {
        // Damaging / chilling pool
        if (this.tick >= zone.endTick) continue;
        for (const target of this.players.values()) {
          if (!target.alive || target.id === zone.ownerId) continue;
          if (dist(zone.x, zone.z, target.x, target.z) <= zone.radius + PLAYER_RADIUS / 2) {
            if (zone.dps > 0) this.damagePlayer(target, zone.dps * TICK_DT, zone.ownerId);
            if (target.alive && zone.slowFactor < 1) {
              target.slowTicks = Math.max(target.slowTicks, 8); // refreshed while inside
              target.slowFactor = zone.slowFactor;
            }
          }
        }
        for (const mob of this.mobs.values()) {
          if (zone.dps > 0 && dist(zone.x, zone.z, mob.x, mob.z) <= zone.radius + mob.radius) {
            this.damageMob(mob, zone.dps * TICK_DT, zone.ownerId);
          }
        }
        survivors.push(zone);
      }
    }
    this.zones = survivors;
  }

  private updateMobs(): void {
    for (const mob of this.mobs.values()) {
      if (mob.biteCdTicks > 0) mob.biteCdTicks--;

      // Acquire / validate target
      let target: PlayerEntity | null = mob.targetId !== null ? (this.players.get(mob.targetId) ?? null) : null;
      if (target && (!target.alive || target.gliding || dist(mob.homeX, mob.homeZ, mob.x, mob.z) > mob.leashRadius)) {
        target = null;
        mob.targetId = null;
      }
      if (!target) {
        let best = mob.aggroRadius;
        for (const p of this.players.values()) {
          if (!p.alive || p.gliding || p.stealthTicks > 0) continue;
          const d = dist(mob.x, mob.z, p.x, p.z);
          if (d < best) {
            best = d;
            target = p;
          }
        }
        mob.targetId = target?.id ?? null;
      }

      let vx = 0;
      let vz = 0;
      if (target) {
        const d = dist(mob.x, mob.z, target.x, target.z);
        mob.facing = yawToward(mob.x, mob.z, target.x, target.z);
        if (d > mob.biteRange) {
          const dir = norm(target.x - mob.x, target.z - mob.z);
          vx = dir.x * mob.speed;
          vz = dir.z * mob.speed;
        } else if (mob.biteCdTicks === 0 && this.phase === 'live') {
          mob.biteCdTicks = Math.round(MOB_BITE_INTERVAL * TICK_RATE);
          this.damagePlayer(target, mob.biteDamage, mob.id);
        }
      } else {
        if (dist(mob.x, mob.z, mob.wanderX, mob.wanderZ) < 1 || this.tick >= mob.nextDecisionTick) {
          const angle = this.rng.range(0, Math.PI * 2);
          const r = this.rng.range(0, 6);
          mob.wanderX = mob.homeX + Math.cos(angle) * r;
          mob.wanderZ = mob.homeZ + Math.sin(angle) * r;
          mob.nextDecisionTick = this.tick + this.rng.int(40, 160);
        }
        const dir = norm(mob.wanderX - mob.x, mob.wanderZ - mob.z);
        vx = dir.x * mob.speed * 0.5;
        vz = dir.z * mob.speed * 0.5;
        if (Math.abs(vx) + Math.abs(vz) > 0.01) {
          mob.facing = Math.atan2(vx, vz);
        }
      }
      const resolved = resolveCollisions(mob.x + vx * TICK_DT, mob.z + vz * TICK_DT, mob.radius, this.map);
      mob.x = resolved.x;
      mob.z = resolved.z;
    }
  }

  private updatePickups(): void {
    // Coins fly toward the nearest player before being collected (plunder vacuum).
    for (const coin of this.coins.values()) {
      let nearest: PlayerEntity | null = null;
      let nearestDist = Infinity;
      for (const p of this.players.values()) {
        if (!p.alive || p.gliding) continue;
        const d = dist(p.x, p.z, coin.x, coin.z);
        if (d < nearestDist) {
          nearestDist = d;
          nearest = p;
        }
      }
      if (!nearest) continue;
      if (nearestDist < COIN_PICKUP_RADIUS) {
        this.coins.delete(coin.id);
        nearest.plunder++;
        this.events.push({ type: 'coin', playerId: nearest.id });
        this.awardXp(nearest, XP_PER_COIN);
      } else if (nearestDist < COIN_MAGNET_RADIUS) {
        const dir = norm(nearest.x - coin.x, nearest.z - coin.z);
        coin.x += dir.x * COIN_MAGNET_SPEED * TICK_DT;
        coin.z += dir.z * COIN_MAGNET_SPEED * TICK_DT;
      }
    }
    for (const p of this.players.values()) {
      if (!p.alive || p.gliding) continue;
      for (const scroll of this.scrolls.values()) {
        if (dist(p.x, p.z, scroll.x, scroll.z) < SCROLL_AUTO_PICKUP_RADIUS) {
          this.equipScroll(p, scroll, false); // auto-pickup only fills empty slots
        }
      }
      if (!p.item) {
        for (const item of this.items.values()) {
          if (dist(p.x, p.z, item.x, item.z) < SCROLL_AUTO_PICKUP_RADIUS) {
            p.item = item.itemId;
            this.items.delete(item.id);
            this.events.push({ type: 'itemPickup', playerId: p.id, itemId: item.itemId });
            break;
          }
        }
      }
    }
  }

  private awardXp(p: PlayerEntity, amount: number): void {
    if (!p.alive) return;
    p.xp += amount;
    while (p.level < MAX_LEVEL && p.xp >= XP_THRESHOLDS[p.level]!) {
      p.level++;
      p.maxHp += LEVEL_HP_BONUS;
      p.hp = Math.min(p.maxHp, p.hp + LEVEL_HP_BONUS);
      this.events.push({ type: 'levelUp', playerId: p.id, level: p.level });
    }
  }

  /**
   * Pick where the next circle settles: always meaningfully off-center — like the
   * original, the safe zone wanders instead of collapsing toward the middle.
   */
  private pickStormTargetCenter(phase: StormPhaseDef): void {
    const maxOffset = Math.max(0, this.stormRadius - phase.targetRadius) * 0.95;
    const angle = this.rng.range(0, Math.PI * 2);
    const r = maxOffset * this.rng.range(0.45, 1);
    const clampTo = Math.max(0, this.map.size / 2 - phase.targetRadius * 0.5);
    this.stormTargetCenterX = Math.max(-clampTo, Math.min(clampTo, this.stormCenterX + Math.cos(angle) * r));
    this.stormTargetCenterZ = Math.max(-clampTo, Math.min(clampTo, this.stormCenterZ + Math.sin(angle) * r));
  }

  private updateStorm(): void {
    if (this.phase !== 'live') return;
    const phase = this.stormPhases[this.stormPhaseIndex];
    if (!phase) return;

    this.stormPhaseTime += TICK_DT;
    if (this.stormPhaseTime <= phase.hold) {
      // holding
    } else if (this.stormPhaseTime <= phase.hold + phase.shrink) {
      const t = (this.stormPhaseTime - phase.hold) / phase.shrink;
      this.stormRadius = lerp(this.stormRadiusAtPhaseStart, phase.targetRadius, t);
      this.stormCenterX = lerp(this.stormCenterAtPhaseStartX, this.stormTargetCenterX, t);
      this.stormCenterZ = lerp(this.stormCenterAtPhaseStartZ, this.stormTargetCenterZ, t);
    } else {
      this.stormRadius = phase.targetRadius;
      this.stormCenterX = this.stormTargetCenterX;
      this.stormCenterZ = this.stormTargetCenterZ;
      if (this.stormPhaseIndex < this.stormPhases.length - 1) {
        this.stormPhaseIndex++;
        this.stormPhaseTime = 0;
        this.stormRadiusAtPhaseStart = this.stormRadius;
        this.stormCenterAtPhaseStartX = this.stormCenterX;
        this.stormCenterAtPhaseStartZ = this.stormCenterZ;
        this.pickStormTargetCenter(this.stormPhases[this.stormPhaseIndex]!);
      } else {
        // Final circle: Violent Lightnings hammer the remaining playspace.
        if (this.tick >= this.nextLightningTick) {
          this.nextLightningTick = this.tick + this.rng.int(18, 45);
          const angle = this.rng.range(0, Math.PI * 2);
          const r = Math.sqrt(this.rng.next()) * (this.stormRadius + 4);
          this.zones.push({
            id: this.nextEntityId++,
            abilityId: 'starBomb',
            ownerId: -1, // the storm itself
            kind: 'telegraph',
            x: this.stormCenterX + Math.cos(angle) * r,
            z: this.stormCenterZ + Math.sin(angle) * r,
            radius: 2.6,
            damage: 30,
            endTick: this.tick + Math.round(1.1 * TICK_RATE),
            dps: 0,
            slowFactor: 1,
            rootDuration: 0,
          });
        }
      }
    }

    for (const p of this.players.values()) {
      if (!p.alive) continue;
      if (dist(p.x, p.z, this.stormCenterX, this.stormCenterZ) > this.stormRadius) {
        this.damagePlayer(p, phase.dps * TICK_DT, null);
      }
    }
    for (const mob of this.mobs.values()) {
      if (dist(mob.x, mob.z, this.stormCenterX, this.stormCenterZ) > this.stormRadius) {
        this.damageMob(mob, phase.dps * TICK_DT, null);
      }
    }
  }

  private damagePlayer(target: PlayerEntity, amount: number, sourceId: number | null): void {
    if (this.phase !== 'live' || !target.alive) return;
    if (target.immuneTicks > 0) return; // Repel: the barrier turns everything away
    if (target.faeTicks > 0) amount *= 0.4; // Faeform damage reduction
    target.stealthTicks = 0; // taking damage reveals you
    let remaining = amount;
    if (target.shieldHp > 0) {
      const absorbed = Math.min(target.shieldHp, remaining);
      target.shieldHp -= absorbed;
      remaining -= absorbed;
    }
    target.hp -= remaining;
    target.damagedThisTick = true;
    this.events.push({ type: 'hit', targetId: target.id, sourceId, amount, x: target.x, z: target.z });
    if (target.hp <= 0) {
      target.hp = 0;
      target.alive = false;
      target.channel = null;
      target.chargeSlot = null;
      this.dropDeathLoot(target);
      this.events.push({ type: 'death', id: target.id, killerId: sourceId, x: target.x, z: target.z });
      const killer = sourceId !== null ? this.players.get(sourceId) : undefined;
      if (killer && killer.alive) this.awardXp(killer, XP_PER_PLAYER_KILL);
    }
  }

  /** Like the original: the fallen drop their spell scrolls, a share of plunder, and their item. */
  private dropDeathLoot(p: PlayerEntity): void {
    for (const equipped of [...p.slots.offense, ...p.slots.utility]) {
      if (!equipped) continue;
      const angle = this.rng.range(0, Math.PI * 2);
      const r = this.rng.range(0.6, 2.2);
      this.spawnScroll(
        p.x + Math.cos(angle) * r,
        p.z + Math.sin(angle) * r,
        equipped.abilityId,
        equipped.rarity,
      );
    }
    const coins = Math.min(DEATH_COIN_DROP_MAX, Math.floor(p.plunder * DEATH_COIN_DROP_FRACTION));
    for (let i = 0; i < coins; i++) this.spawnCoin(p.x, p.z);
    if (p.item) {
      this.spawnItem(p.x + this.rng.range(-1.2, 1.2), p.z + this.rng.range(-1.2, 1.2), p.item);
      p.item = null;
    }
  }

  private damageMob(mob: MobEntity, amount: number, sourceId: number | null): void {
    if (this.phase !== 'live' || mob.hp <= 0) return;
    mob.hp -= amount;
    this.events.push({ type: 'hit', targetId: mob.id, sourceId, amount, x: mob.x, z: mob.z });
    if (mob.hp <= 0) {
      this.mobs.delete(mob.id);
      this.events.push({ type: 'mobDeath', x: mob.x, z: mob.z, elite: mob.elite });
      const coins = mob.elite
        ? this.rng.int(ELITE_COINS_MIN, ELITE_COINS_MAX + 1)
        : this.rng.int(MOB_COINS_MIN, MOB_COINS_MAX + 1);
      for (let i = 0; i < coins; i++) this.spawnCoin(mob.x, mob.z);
      if (mob.elite) {
        // Elites always drop a skill, and a good one.
        this.spawnScroll(mob.x, mob.z, rollAbility(this.rng), rollEliteRarity(this.rng));
      } else if (this.rng.next() < MOB_SCROLL_CHANCE) {
        this.spawnScroll(mob.x, mob.z, rollAbility(this.rng), rollRarity(this.rng));
      }
      const killer = sourceId !== null ? this.players.get(sourceId) : undefined;
      if (killer && killer.alive) this.awardXp(killer, mob.elite ? XP_PER_ELITE : XP_PER_MOB);
    }
  }

  private checkWin(): void {
    if (this.phase !== 'live') return;
    // A solo sandbox (tests, practice) never auto-ends.
    if (this.players.size <= 1) return;
    let aliveCount = 0;
    let lastAlive: PlayerEntity | null = null;
    for (const p of this.players.values()) {
      if (p.alive) {
        aliveCount++;
        lastAlive = p;
      }
    }
    if (aliveCount <= 1) {
      this.phase = 'ended';
      this.winnerId = lastAlive?.id ?? null;
    }
  }

  private makeSnapshot(): Snapshot {
    const phaseDef = this.stormPhases[this.stormPhaseIndex];
    const shrinking =
      this.phase === 'live' &&
      phaseDef !== undefined &&
      this.stormPhaseTime > phaseDef.hold &&
      this.stormPhaseTime <= phaseDef.hold + phaseDef.shrink;

    let aliveCount = 0;
    for (const p of this.players.values()) if (p.alive) aliveCount++;

    const snapshot: Snapshot = {
      tick: this.tick,
      time: this.tick * TICK_DT,
      phase: this.phase,
      winnerId: this.winnerId,
      aliveCount,
      storm: {
        x: this.stormCenterX,
        z: this.stormCenterZ,
        radius: this.stormRadius,
        targetRadius: phaseDef?.targetRadius ?? this.stormRadius,
        shrinking,
        dps: phaseDef?.dps ?? 0,
        nextShrinkIn:
          this.phase === 'live' && phaseDef && this.stormPhaseTime <= phaseDef.hold
            ? phaseDef.hold - this.stormPhaseTime
            : 0,
      },
      players: [...this.players.values()].map((p) => ({
        id: p.id,
        name: p.name,
        isBot: p.isBot,
        x: p.x,
        y: p.y,
        z: p.z,
        facing: p.facing,
        hp: p.hp,
        maxHp: p.maxHp,
        alive: p.alive,
        level: p.level,
        xp: p.xp,
        xpToNext: p.level < MAX_LEVEL ? XP_THRESHOLDS[p.level]! - p.xp : 0,
        plunder: p.plunder,
        shieldHp: p.shieldHp,
        gliding: p.gliding,
        rolling: p.rollTicks > 0,
        rooted: p.rootTicks > 0,
        slowed: p.slowTicks > 0,
        stunned: p.stunTicks > 0,
        poisoned: p.poisonTicks > 0,
        stealthed: p.stealthTicks > 0,
        immune: p.immuneTicks > 0,
        fae: p.faeTicks > 0,
        auraActive: p.auraTicks > 0,
        channeling: p.channel ? 1 - p.channel.ticksLeft / p.channel.totalTicks : -1,
        charging:
          p.chargeSlot !== null && p.chargeMaxTicks > 0
            ? Math.min(1, p.chargeTicks / p.chargeMaxTicks)
            : -1,
        slots: {
          offense: p.slots.offense.map((s) => (s ? { ...s } : null)),
          utility: p.slots.utility.map((s) => (s ? { ...s } : null)),
        },
        slotCds: p.slotCds.map((t) => t * TICK_DT),
        meleeCd: p.meleeCdTicks * TICK_DT,
        rollCd: p.rollCdTicks * TICK_DT,
        healCd: p.healCdTicks * TICK_DT,
        item: p.item,
      })),
      mobs: [...this.mobs.values()].map((m) => ({
        id: m.id,
        elite: m.elite,
        x: m.x,
        z: m.z,
        facing: m.facing,
        hp: m.hp,
        maxHp: m.maxHp,
      })),
      chests: [...this.chests.values()].map((c) => ({ id: c.id, x: c.x, z: c.z, opened: c.opened })),
      scrolls: [...this.scrolls.values()].map((s) => ({
        id: s.id,
        x: s.x,
        z: s.z,
        abilityId: s.abilityId,
        rarity: s.rarity,
      })),
      coins: [...this.coins.values()].map((c) => ({ id: c.id, x: c.x, z: c.z })),
      items: [...this.items.values()].map((i) => ({ id: i.id, x: i.x, z: i.z, itemId: i.itemId })),
      projectiles: this.projectiles.map((proj) => ({
        id: proj.id,
        x: proj.x,
        z: proj.z,
        dirX: proj.dirX,
        dirZ: proj.dirZ,
        abilityId: proj.abilityId,
      })),
      zones: this.zones.map((zone) => ({
        id: zone.id,
        x: zone.x,
        z: zone.z,
        radius: zone.radius,
        kind: zone.kind,
        endsIn: (zone.endTick - this.tick) * TICK_DT,
        abilityId: zone.abilityId,
      })),
      events: this.events,
    };
    this.events = [];
    return snapshot;
  }
}
