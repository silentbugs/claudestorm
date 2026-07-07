import type { AbilityId, PlayerSlots } from '../protocol/types.js';

export interface BotState {
  landTargetX: number;
  landTargetZ: number;
  waypointX: number;
  waypointZ: number;
  strafeSign: 1 | -1;
  nextDecisionTick: number;
}

export interface ChestChannel {
  chestId: number;
  ticksLeft: number;
  totalTicks: number;
}

export interface PlayerEntity {
  id: number;
  name: string;
  isBot: boolean;
  x: number;
  /** Height above ground. */
  y: number;
  z: number;
  vy: number;
  facing: number;
  hp: number;
  maxHp: number;
  alive: boolean;

  /** Latest input intent. */
  moveX: number;
  moveZ: number;
  yaw: number;
  aimX: number;
  aimZ: number;
  meleeHeld: boolean;
  pendingButtons: Set<'roll' | 'jump' | 'interact' | 'heal'>;
  pendingSlotCasts: Set<number>;

  /** Ticks remaining: [offense0, offense1, utility0, utility1]. */
  slotCds: number[];
  meleeCdTicks: number;
  rollCdTicks: number;
  healCdTicks: number;
  comboCount: number;
  comboExpireTick: number;

  gliding: boolean;
  rollTicks: number;
  rollDirX: number;
  rollDirZ: number;
  rootTicks: number;
  slowTicks: number;
  slowFactor: number;

  shieldHp: number;
  shieldTicks: number;

  auraTicks: number;
  auraDps: number;
  auraRadius: number;

  leapTicks: number;
  leapTotalTicks: number;
  leapDirX: number;
  leapDirZ: number;
  leapSpeed: number;
  leapDamage: number;
  leapLandRadius: number;
  leapKnockback: number;

  kbTicks: number;
  kbVelX: number;
  kbVelZ: number;

  pullTicks: number;
  pullToX: number;
  pullToZ: number;

  channel: ChestChannel | null;
  /** Set when damaged this tick — cancels chest channeling. */
  damagedThisTick: boolean;

  level: number;
  xp: number;
  plunder: number;
  slots: PlayerSlots;

  bot: BotState | null;
}

export interface MobEntity {
  id: number;
  elite: boolean;
  x: number;
  z: number;
  facing: number;
  hp: number;
  maxHp: number;
  /** Stats baked at spawn so elites and normal mobs share the update code. */
  radius: number;
  speed: number;
  aggroRadius: number;
  leashRadius: number;
  biteRange: number;
  biteDamage: number;
  homeX: number;
  homeZ: number;
  targetId: number | null;
  wanderX: number;
  wanderZ: number;
  nextDecisionTick: number;
  biteCdTicks: number;
}

export interface ChestEntity {
  id: number;
  x: number;
  z: number;
  opened: boolean;
}

export interface ScrollEntity {
  id: number;
  x: number;
  z: number;
  abilityId: AbilityId;
  rarity: import('../protocol/types.js').Rarity;
}

export interface CoinEntity {
  id: number;
  x: number;
  z: number;
}

export interface ProjectileEntity {
  id: number;
  abilityId: AbilityId;
  ownerId: number;
  x: number;
  z: number;
  dirX: number;
  dirZ: number;
  speed: number;
  radius: number;
  damage: number;
  ticksLeft: number;
  /** Damage multiplier captured at cast (rarity × level). */
  scale: number;
}

export interface ZoneEntity {
  id: number;
  abilityId: AbilityId;
  ownerId: number;
  kind: 'telegraph' | 'pool';
  x: number;
  z: number;
  radius: number;
  damage: number;
  /** telegraph: tick of detonation; pool: tick it disappears. */
  endTick: number;
  /** pool damage per second (already scaled). */
  dps: number;
}
