/** The authentic Plunderstorm roster: 11 offensive + 10 utility spells. */
export type AbilityId =
  // Offense
  | 'rimeArrow'
  | 'fireWhirl'
  | 'earthbreaker'
  | 'holyShield'
  | 'stormArchon'
  | 'manaSphere'
  | 'searingAxe'
  | 'slicingWinds'
  | 'starBomb'
  | 'toxicSmackerel'
  | 'celestialBarrage'
  // Utility
  | 'quakingLeap'
  | 'huntersChains'
  | 'steelTraps'
  | 'windstorm'
  | 'explosiveCaltrops'
  | 'snowdrift'
  | 'lightningBulwark'
  | 'fadeToShadow'
  | 'repel'
  | 'faeform';

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
  /** Use the held consumable item. */
  useItem: boolean;
  /** Swap the two offense slots (1 ↔ 2). */
  swapOffense: boolean;
  /** Swap the two utility slots (3 ↔ 4). */
  swapUtility: boolean;
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
  /** Ability slot presses this tick: 0/1 = offense, 2/3 = utility. */
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
  /** Level cap for this match (a match setting, not a fixed constant). */
  maxLevel: number;
  xp: number;
  /** XP needed for next level; 0 at max level. */
  xpToNext: number;
  plunder: number;
  shieldHp: number;
  gliding: boolean;
  rolling: boolean;
  rooted: boolean;
  slowed: boolean;
  stunned: boolean;
  poisoned: boolean;
  /** Hidden from bots; rendered translucent. */
  stealthed: boolean;
  /** Repel barrier: immune to all damage. */
  immune: boolean;
  /** Faeform: fast, damage-reduced, cannot attack. */
  fae: boolean;
  auraActive: boolean;
  /** Chest-open/heal progress 0..1, or -1 when not channeling. */
  channeling: number;
  /** What the channel bar is for. */
  channelKind: 'chest' | 'heal' | null;
  /** Charge-and-release cast progress 0..1, or -1 when not charging. */
  charging: number;
  slots: PlayerSlots;
  /** Seconds remaining: [offense0, offense1, utility0, utility1]. */
  slotCds: number[];
  meleeCd: number;
  rollCd: number;
  healCd: number;
  /** Held consumable, or null. */
  item: import('../sim/items.js').ItemId | null;
}

export interface MobSnapshot {
  id: number;
  elite: boolean;
  level: number;
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

export interface ItemSnapshot {
  id: number;
  x: number;
  z: number;
  itemId: import('../sim/items.js').ItemId;
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
  kind: 'telegraph' | 'pool' | 'trap';
  /** Seconds until detonation (telegraph) or disappearance (pool/trap). */
  endsIn: number;
  abilityId: AbilityId;
}

export interface StormSnapshot {
  x: number;
  z: number;
  radius: number;
  /** Where the current/next circle settles (minimap "next circle" indicator). */
  targetX: number;
  targetZ: number;
  targetRadius: number;
  shrinking: boolean;
  dps: number;
  nextShrinkIn: number;
}

export type GameEvent =
  | { type: 'hit'; targetId: number; sourceId: number | null; amount: number; x: number; z: number }
  | { type: 'death'; id: number; killerId: number | null; x: number; z: number }
  | { type: 'cast'; casterId: number; abilityId: AbilityId; x: number; z: number }
  | { type: 'chargeRelease'; casterId: number; abilityId: AbilityId; x: number; z: number; fraction: number }
  | { type: 'detonate'; x: number; z: number; radius: number; abilityId: AbilityId }
  | { type: 'projectileGone'; id: number; abilityId: AbilityId; x: number; z: number }
  | { type: 'melee'; casterId: number; x: number; z: number; facing: number; combo: number }
  | { type: 'chestOpened'; playerId: number; x: number; z: number }
  | { type: 'mobDeath'; killerId: number | null; x: number; z: number; elite: boolean }
  | { type: 'levelUp'; playerId: number; level: number }
  | { type: 'equip'; playerId: number; abilityId: AbilityId; rarity: Rarity }
  | { type: 'upgrade'; playerId: number; abilityId: AbilityId; rarity: Rarity }
  | { type: 'pull'; casterId: number; targetId: number }
  | { type: 'coin'; playerId: number }
  | { type: 'heal'; playerId: number; amount: number; x: number; z: number }
  | { type: 'itemPickup'; playerId: number; itemId: import('../sim/items.js').ItemId }
  | { type: 'itemUsed'; playerId: number; itemId: import('../sim/items.js').ItemId; x: number; z: number };

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
  items: ItemSnapshot[];
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
