export type AbilityId =
  | 'frostArrow'
  | 'flameCyclone'
  | 'stormCall'
  | 'venomOrb'
  | 'frostNova'
  | 'shadowLance'
  | 'gustLeap'
  | 'graspingChains'
  | 'stoneShield'
  | 'windRush';

export type Rarity = 'common' | 'uncommon' | 'rare' | 'epic';
export type SlotCategory = 'offense' | 'utility';
export type MatchPhase = 'drop' | 'live' | 'ended';

export interface EquippedAbility {
  abilityId: AbilityId;
  rarity: Rarity;
}

export interface InputButtons {
  /** Held state — sword swings repeat while held. */
  melee: boolean;
  /** Edge-triggered presses accumulated since the last command. */
  roll: boolean;
  jump: boolean;
  interact: boolean;
  heal: boolean;
}

/** One tick worth of player intent. The only way anything controls a character. */
export interface InputCommand {
  seq: number;
  /** Desired move direction in world space (client rotates by camera yaw). */
  moveX: number;
  moveZ: number;
  /** Character facing (camera yaw in mouse-look). */
  yaw: number;
  /** World-space aim point on the ground for targeted abilities. */
  aimX: number;
  aimZ: number;
  buttons: InputButtons;
  /** Ability slot presses this tick: 0/1 = offense, 2 = utility. */
  slotCasts: number[];
}

export interface PlayerSlots {
  offense: (EquippedAbility | null)[];
  utility: (EquippedAbility | null)[];
}

export interface PlayerSnapshot {
  id: number;
  name: string;
  isBot: boolean;
  x: number;
  /** Height above ground (jumping, gliding, leaping). */
  y: number;
  z: number;
  facing: number;
  hp: number;
  maxHp: number;
  alive: boolean;
  level: number;
  xp: number;
  /** XP needed for next level; 0 at max level. */
  xpToNext: number;
  plunder: number;
  shieldHp: number;
  gliding: boolean;
  rolling: boolean;
  rooted: boolean;
  slowed: boolean;
  auraActive: boolean;
  /** Chest-open progress 0..1, or -1 when not channeling. */
  channeling: number;
  slots: PlayerSlots;
  /** Seconds remaining: [offense0, offense1, utility0]. */
  slotCds: number[];
  meleeCd: number;
  rollCd: number;
  healCd: number;
}

export interface MobSnapshot {
  id: number;
  elite: boolean;
  x: number;
  z: number;
  facing: number;
  hp: number;
  maxHp: number;
}

export interface ChestSnapshot {
  id: number;
  x: number;
  z: number;
  opened: boolean;
}

export interface ScrollSnapshot {
  id: number;
  x: number;
  z: number;
  abilityId: AbilityId;
  rarity: Rarity;
}

export interface CoinSnapshot {
  id: number;
  x: number;
  z: number;
}

export interface ProjectileSnapshot {
  id: number;
  x: number;
  z: number;
  dirX: number;
  dirZ: number;
  abilityId: AbilityId;
}

export interface ZoneSnapshot {
  id: number;
  x: number;
  z: number;
  radius: number;
  kind: 'telegraph' | 'pool';
  /** Seconds until detonation (telegraph) or disappearance (pool). */
  endsIn: number;
  abilityId: AbilityId;
}

export interface StormSnapshot {
  x: number;
  z: number;
  radius: number;
  targetRadius: number;
  shrinking: boolean;
  dps: number;
  nextShrinkIn: number;
}

export type GameEvent =
  | { type: 'hit'; targetId: number; sourceId: number | null; amount: number; x: number; z: number }
  | { type: 'death'; id: number; killerId: number | null; x: number; z: number }
  | { type: 'cast'; casterId: number; abilityId: AbilityId; x: number; z: number }
  | { type: 'detonate'; x: number; z: number; radius: number; abilityId: AbilityId }
  | { type: 'projectileGone'; id: number; x: number; z: number }
  | { type: 'melee'; casterId: number; x: number; z: number; facing: number; combo: number }
  | { type: 'chestOpened'; x: number; z: number }
  | { type: 'mobDeath'; x: number; z: number; elite: boolean }
  | { type: 'levelUp'; playerId: number; level: number }
  | { type: 'equip'; playerId: number; abilityId: AbilityId; rarity: Rarity }
  | { type: 'pull'; casterId: number; targetId: number }
  | { type: 'coin'; playerId: number }
  | { type: 'heal'; playerId: number; amount: number; x: number; z: number };

export interface Snapshot {
  tick: number;
  /** Sim time in seconds. */
  time: number;
  phase: MatchPhase;
  winnerId: number | null;
  aliveCount: number;
  storm: StormSnapshot;
  players: PlayerSnapshot[];
  mobs: MobSnapshot[];
  chests: ChestSnapshot[];
  scrolls: ScrollSnapshot[];
  coins: CoinSnapshot[];
  projectiles: ProjectileSnapshot[];
  zones: ZoneSnapshot[];
  events: GameEvent[];
}

/**
 * The client's only channel to the simulation. LocalTransport (Web Worker) for
 * the slice; NetworkTransport (WebSocket) later without touching sim or renderer.
 */
export interface Transport {
  start(onSnapshot: (snap: Snapshot) => void): void;
  sendInput(cmd: InputCommand): void;
  dispose(): void;
}
