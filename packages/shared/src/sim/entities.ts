import type { AbilityId, PlayerSlots } from '../protocol/types.js';

export interface BotState {
  landTargetX: number;
  landTargetZ: number;
  waypointX: number;
  waypointZ: number;
  strafeSign: 1 | -1;
  nextDecisionTick: number;
  /** Committed storm-retreat point; sticking to it prevents edge jitter. */
  retreating: boolean;
  retreatX: number;
  retreatZ: number;
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
  /** Held while gliding to plunge; release re-pops the canopy. */
  diveHeld: boolean;
  pendingButtons: Set<'roll' | 'jump' | 'interact' | 'heal' | 'useItem' | 'swapOffense' | 'swapUtility'>;
  pendingSlotCasts: Set<number>;

  /** Ticks remaining: [offense0, offense1, utility0, utility1]. */
  slotCds: number[];
  meleeCdTicks: number;
  rollCdTicks: number;
  healCdTicks: number;
  /** Remaining ticks of the channeled heal (0 = not casting). */
  healCastTicks: number;
  comboCount: number;
  comboExpireTick: number;

  gliding: boolean;
  rollTicks: number;
  rollDirX: number;
  rollDirZ: number;
  rootTicks: number;
  slowTicks: number;
  slowFactor: number;
  stunTicks: number;
  poisonTicks: number;
  poisonDps: number;
  poisonSourceId: number;
  stealthTicks: number;
  immuneTicks: number;
  faeTicks: number;
  speedBuffTicks: number;
  speedBuffMult: number;

  shieldHp: number;
  shieldTicks: number;

  auraTicks: number;
  auraDps: number;
  auraRadius: number;

  /** Charge-and-release cast: the slot being charged, or null. */
  chargeSlot: number | null;
  chargeTicks: number;
  chargeMaxTicks: number;

  leapTicks: number;
  leapTotalTicks: number;
  leapDirX: number;
  leapDirZ: number;
  leapSpeed: number;
  leapDamage: number;
  leapLandRadius: number;
  leapKnockback: number;
  leapLandStun: number;
  /** Ground dash (no arc); damages enemies passed through when leapDashDamage > 0. */
  leapFlat: boolean;
  leapDashDamage: number;
  leapHitIds: Set<number>;

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
  /** Held consumable (one at a time). */
  item: import('./items.js').ItemId | null;
  /** Heal-over-time (Chicken Coup). */
  hotTicks: number;
  hotPerTick: number;

  bot: BotState | null;
}

export interface MobEntity {
  id: number;
  elite: boolean;
  /** Tougher near the match's endgame (rolled final storm center) than on the periphery. */
  level: number;
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

export interface ItemEntity {
  id: number;
  x: number;
  z: number;
  itemId: import('./items.js').ItemId;
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
  /** Boomerang (Holy Shield): pierces, then flies back to its owner. */
  returning: boolean;
  /** Targets already struck (piercing projectiles hit each enemy once). */
  hitIds: Set<number>;
}

export interface ZoneEntity {
  id: number;
  abilityId: AbilityId;
  ownerId: number;
  kind: 'telegraph' | 'pool' | 'trap';
  x: number;
  z: number;
  radius: number;
  damage: number;
  /** telegraph: tick of detonation; pool/trap: tick it disappears. */
  endTick: number;
  /** pool damage per second (already scaled). */
  dps: number;
  /** pool: slow applied to enemies standing inside (1 = none). */
  slowFactor: number;
  /** trap: root duration in seconds when sprung. */
  rootDuration: number;
}
