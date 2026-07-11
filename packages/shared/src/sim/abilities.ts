import type { AbilityId, Rarity, SlotCategory } from '../protocol/types.js';

/**
 * Behavior primitives the sim implements. Every Plunderstorm spell is config
 * over one of these:
 * - projectile: travels, hits (optional slow/stun/knockback/pull/splash/boomerang/volley)
 * - groundAoE:  telegraphed circle (optional stun/root; optional lingering pool)
 * - cone:       instant swing in a front arc (optional knockback/poison)
 * - selfAura:   damage aura around the moving caster (optional speed boost)
 * - leap:       arc or flat dash (optional landing damage/stun, pass-through damage,
 *               backward hop, blink+stealth, caltrop pool at origin)
 * - shield:     damage absorb
 * - buff:       timed self status (immunity, faeform)
 * - trap:       armed zones ahead of the caster that root when sprung
 */
export type AbilityBehavior =
  | 'projectile'
  | 'groundAoE'
  | 'cone'
  | 'selfAura'
  | 'leap'
  | 'shield'
  | 'buff'
  | 'trap';

export const RARITY_MULT: Record<Rarity, number> = {
  common: 1,
  uncommon: 1.3,
  rare: 1.6,
  epic: 2,
};

export const RARITY_ORDER: Rarity[] = ['common', 'uncommon', 'rare', 'epic'];

/**
 * All times in seconds, distances in meters. Damage-like numbers are base values,
 * scaled by rank (rarity) and caster level at cast time. Adding an ability = adding config.
 */
export interface AbilityDef {
  id: AbilityId;
  name: string;
  /** Hotbar / compendium icon (emoji placeholder art). */
  icon: string;
  /** One-line description for the skills compendium. */
  description: string;
  category: SlotCategory;
  behavior: AbilityBehavior;
  cooldown: number;
  damage: number;
  /** projectile */
  projectileSpeed?: number;
  projectileRadius?: number;
  projectileLifetime?: number;
  slowDuration?: number;
  slowFactor?: number;
  stunDuration?: number;
  knockbackDistance?: number;
  /** Splash damage to other enemies near the impact (fraction of damage). */
  splashRadius?: number;
  splashMult?: number;
  /** Pull the struck enemy to the caster and briefly root them. */
  pull?: boolean;
  rootDuration?: number;
  /** Pierces and returns to the caster (Holy Shield). */
  boomerang?: boolean;
  /** Fires N projectiles in a fan (Storm Archon). */
  volley?: number;
  volleySpreadRad?: number;
  /** Leave a pool where the effect lands (poison, blizzard, caltrops). */
  poolRadius?: number;
  poolDuration?: number;
  poolDps?: number;
  poolSlowFactor?: number;
  /** groundAoE */
  castRange?: number;
  telegraph?: number;
  aoeRadius?: number;
  /** cone */
  coneRange?: number;
  /** Cosine of the cone half-angle. */
  coneArcCos?: number;
  poisonDps?: number;
  poisonDuration?: number;
  /** Bonus multiplier when the target is already poisoned (Toxic Smackerel). */
  poisonBonusMult?: number;
  /** selfAura */
  auraRadius?: number;
  auraDuration?: number;
  auraSpeedMult?: number;
  /** leap / dash */
  leapRange?: number;
  leapDuration?: number;
  landRadius?: number;
  landStunDuration?: number;
  /** Damage enemies passed through mid-dash (Slicing Winds). */
  dashDamage?: boolean;
  /** Pierces every enemy in its path instead of dying on first hit (Celestial Barrage). */
  pierce?: boolean;
  /**
   * Fire toward the cursor's aim point instead of the character's facing
   * (Celestial Barrage). Everything else launches where the character looks.
   */
  aimAtCursor?: boolean;
  /**
   * Charge-and-release: pressing starts a charge, pressing again (or reaching
   * chargeSeconds) releases. Damage and reach scale with how long you charged.
   */
  chargeSeconds?: number;
  /** Effect fraction when released instantly (scales up to 1 at full charge). */
  chargeMinFraction?: number;
  /** Rise into the air while charging (Celestial Barrage). */
  chargeAir?: boolean;
  /** Ground dash: no arc. */
  dashFlat?: boolean;
  /** Hop backward instead of forward (Explosive Caltrops). */
  dashBackward?: boolean;
  /** Teleport instantly instead of dashing (Fade to Shadow). */
  blink?: boolean;
  stealthDuration?: number;
  /** shield */
  shieldAmount?: number;
  shieldDuration?: number;
  /** buff */
  buffKind?: 'immune' | 'faeform';
  buffDuration?: number;
  /** trap */
  trapCount?: number;
  trapRadius?: number;
  trapDuration?: number;
}

export const ABILITIES: Record<AbilityId, AbilityDef> = {
  // ── Offense ────────────────────────────────────────────────────────────────
  rimeArrow: {
    id: 'rimeArrow',
    name: 'Rime Arrow',
    icon: '🏹',
    description: 'Fire an icy arrow that damages your target and chills enemies near the impact.',
    category: 'offense',
    behavior: 'projectile',
    cooldown: 3,
    damage: 20,
    projectileSpeed: 32,
    projectileRadius: 0.55,
    projectileLifetime: 1.1,
    slowDuration: 1.5,
    slowFactor: 0.6,
    splashRadius: 2.2,
    splashMult: 0.6,
  },
  fireWhirl: {
    id: 'fireWhirl',
    name: 'Fire Whirl',
    icon: '🔥',
    description: 'Engulf yourself in flames and rush forward, burning everyone you pass through.',
    category: 'offense',
    behavior: 'selfAura',
    cooldown: 9,
    damage: 24, // dps while active
    auraRadius: 2.8,
    auraDuration: 2.5,
    auraSpeedMult: 1.3,
  },
  earthbreaker: {
    id: 'earthbreaker',
    name: 'Earthbreaker',
    icon: '⛰️',
    description:
      'Charge seismic force, then release to sunder the earth at the aimed spot, damaging and stunning everyone caught in the quake. Charging longer reaches farther and hits harder.',
    category: 'offense',
    behavior: 'groundAoE',
    cooldown: 11,
    damage: 32,
    castRange: 22,
    telegraph: 0.45,
    aoeRadius: 4.5,
    stunDuration: 1.5,
    chargeSeconds: 1.4,
    chargeMinFraction: 0.45,
  },
  holyShield: {
    id: 'holyShield',
    name: 'Holy Shield',
    icon: '✨',
    description: 'Hurl a blessed shield that damages enemies in its path, then returns to you.',
    category: 'offense',
    behavior: 'projectile',
    cooldown: 7,
    damage: 16,
    projectileSpeed: 24,
    projectileRadius: 0.7,
    projectileLifetime: 0.8, // outward leg; it flies back after
    boomerang: true,
  },
  stormArchon: {
    id: 'stormArchon',
    name: 'Storm Archon',
    icon: '⚡',
    description: 'Call the elements and unleash a crackling volley in front of you.',
    category: 'offense',
    behavior: 'projectile',
    cooldown: 8,
    damage: 9, // per bolt
    projectileSpeed: 28,
    projectileRadius: 0.45,
    projectileLifetime: 0.9,
    volley: 5,
    volleySpreadRad: 0.5,
  },
  manaSphere: {
    id: 'manaSphere',
    name: 'Mana Sphere',
    icon: '🔮',
    description: 'Project a heavy sphere of mana that damages and knocks back the enemy it strikes.',
    category: 'offense',
    behavior: 'projectile',
    cooldown: 6,
    damage: 24,
    projectileSpeed: 26,
    projectileRadius: 0.65,
    projectileLifetime: 1.0,
    knockbackDistance: 5,
  },
  searingAxe: {
    id: 'searingAxe',
    name: 'Searing Axe',
    icon: '🪓',
    description: 'Slam down a molten axe, spewing lava forward that damages and knocks enemies back.',
    category: 'offense',
    behavior: 'cone',
    cooldown: 6,
    damage: 30,
    coneRange: 4.5,
    coneArcCos: 0.4,
    knockbackDistance: 4,
  },
  slicingWinds: {
    id: 'slicingWinds',
    name: 'Slicing Winds',
    icon: '🌪️',
    description:
      'Charge razor winds, then release to lunge forward and slice enemies in your path. Charging longer lunges farther and cuts deeper.',
    category: 'offense',
    behavior: 'leap',
    cooldown: 7,
    damage: 30,
    leapRange: 18,
    leapDuration: 0.55,
    landRadius: 0,
    dashDamage: true,
    dashFlat: true,
    chargeSeconds: 1.2,
    chargeMinFraction: 0.4,
  },
  starBomb: {
    id: 'starBomb',
    name: 'Star Bomb',
    icon: '💫',
    description: 'Compress the cosmic void into a bomb that blankets a huge area at the aimed spot.',
    category: 'offense',
    behavior: 'groundAoE',
    cooldown: 7,
    damage: 40,
    castRange: 26,
    telegraph: 1.1,
    aoeRadius: 7,
  },
  celestialBarrage: {
    id: 'celestialBarrage',
    name: 'Celestial Barrage',
    icon: '🌠',
    description:
      'Rise into the air and gather starlight, then release a barrage that slices through every enemy in its path — even very far away.',
    category: 'offense',
    behavior: 'projectile',
    cooldown: 11,
    damage: 16, // per star, per enemy pierced
    projectileSpeed: 46,
    projectileRadius: 0.8,
    projectileLifetime: 1.6,
    volley: 3,
    volleySpreadRad: 0.16,
    pierce: true,
    chargeSeconds: 1.6,
    chargeMinFraction: 0.35,
    chargeAir: true,
  },
  toxicSmackerel: {
    id: 'toxicSmackerel',
    name: 'Toxic Smackerel',
    icon: '🐟',
    description: 'Smack enemies in front of you with a venomous fish. Poisoned targets take extra smack.',
    category: 'offense',
    behavior: 'cone',
    cooldown: 4,
    damage: 14,
    coneRange: 3.2,
    coneArcCos: 0.5,
    poisonDps: 6,
    poisonDuration: 5, // outlasts the cooldown so the bonus-smack combo connects
    poisonBonusMult: 1.6,
  },
  // ── Utility ────────────────────────────────────────────────────────────────
  quakingLeap: {
    id: 'quakingLeap',
    name: 'Quaking Leap',
    icon: '🦘',
    description: 'Leap forward in a great arc and crash down, damaging and stunning enemies you land on.',
    category: 'utility',
    behavior: 'leap',
    cooldown: 9,
    damage: 12,
    leapRange: 10,
    leapDuration: 0.5,
    landRadius: 3.5,
    landStunDuration: 0.8,
    knockbackDistance: 3,
  },
  huntersChains: {
    id: 'huntersChains',
    name: "Hunter's Chains",
    icon: '⛓️',
    description: 'Skillshot chain that drags the struck enemy to you and roots them.',
    category: 'utility',
    behavior: 'projectile',
    cooldown: 10,
    damage: 8,
    projectileSpeed: 40,
    projectileRadius: 0.5,
    projectileLifetime: 0.45,
    pull: true,
    rootDuration: 0.5,
  },
  steelTraps: {
    id: 'steelTraps',
    name: 'Steel Traps',
    icon: '🪤',
    description: 'Toss a cluster of steel traps ahead of you that root and damage whoever springs them.',
    category: 'utility',
    behavior: 'trap',
    cooldown: 11,
    damage: 14,
    rootDuration: 1.2,
    trapCount: 3,
    trapRadius: 1.2,
    trapDuration: 15,
  },
  windstorm: {
    id: 'windstorm',
    name: 'Windstorm',
    icon: '🌬️',
    description: 'Turbulent winds surge forward, damaging and stunning the first enemy struck.',
    category: 'utility',
    behavior: 'projectile',
    cooldown: 9,
    damage: 12,
    projectileSpeed: 22,
    projectileRadius: 0.8,
    projectileLifetime: 1.0,
    stunDuration: 1.0,
  },
  explosiveCaltrops: {
    id: 'explosiveCaltrops',
    name: 'Explosive Caltrops',
    icon: '🧨',
    description: 'Hop backward while scattering caltrops that slow and burn enemies crossing them.',
    category: 'utility',
    behavior: 'leap',
    cooldown: 9,
    damage: 0,
    leapRange: 6,
    leapDuration: 0.3,
    landRadius: 0,
    dashFlat: true,
    dashBackward: true,
    poolRadius: 2.8,
    poolDuration: 4,
    poolDps: 10,
    poolSlowFactor: 0.6,
  },
  snowdrift: {
    id: 'snowdrift',
    name: 'Snowdrift',
    icon: '❄️',
    description: 'Conjure a blizzard around you that chills enemies to the bone the longer they stay.',
    category: 'utility',
    behavior: 'groundAoE',
    cooldown: 10,
    damage: 0,
    castRange: 0,
    telegraph: 0.3,
    aoeRadius: 4,
    poolRadius: 4,
    poolDuration: 4.5,
    poolDps: 4,
    poolSlowFactor: 0.45,
  },
  lightningBulwark: {
    id: 'lightningBulwark',
    name: 'Lightning Bulwark',
    icon: '🛡️',
    description: 'Raise a charged bulwark that soaks damage before it reaches your health.',
    category: 'utility',
    behavior: 'shield',
    cooldown: 12,
    damage: 0,
    shieldAmount: 42,
    shieldDuration: 4,
  },
  fadeToShadow: {
    id: 'fadeToShadow',
    name: 'Fade to Shadow',
    icon: '🌑',
    description: 'Teleport in the direction you are moving and melt into stealth.',
    category: 'utility',
    behavior: 'leap',
    cooldown: 12,
    damage: 0,
    leapRange: 9,
    leapDuration: 0.05,
    landRadius: 0,
    blink: true,
    stealthDuration: 2.5,
  },
  repel: {
    id: 'repel',
    name: 'Repel',
    icon: '🌀',
    description: 'Erect an arcane barrier that repels all damage for a short moment.',
    category: 'utility',
    behavior: 'buff',
    cooldown: 13,
    damage: 0,
    buffKind: 'immune',
    buffDuration: 1.5,
  },
  faeform: {
    id: 'faeform',
    name: 'Faeform',
    icon: '🧚',
    description: 'Become a fae creature: swift and hard to hurt, but unable to attack.',
    category: 'utility',
    behavior: 'buff',
    cooldown: 14,
    damage: 0,
    buffKind: 'faeform',
    buffDuration: 3,
  },
};

export const ABILITY_IDS = Object.keys(ABILITIES) as AbilityId[];
export const OFFENSE_ABILITIES = ABILITY_IDS.filter((id) => ABILITIES[id].category === 'offense');
export const UTILITY_ABILITIES = ABILITY_IDS.filter((id) => ABILITIES[id].category === 'utility');

/** Plunderstorm action bar: slots 0/1 are offense, 2/3 are utility. */
export const SLOT_COUNT = 4;
export function slotCategory(slotIndex: number): SlotCategory {
  return slotIndex < 2 ? 'offense' : 'utility';
}

/** Next rank when stacking a duplicate scroll: max(current+1, scroll's own rank), capped at epic. */
export function stackedRarity(current: Rarity, pickup: Rarity): Rarity | null {
  const cur = RARITY_ORDER.indexOf(current);
  const target = Math.max(cur + 1, RARITY_ORDER.indexOf(pickup));
  if (cur >= RARITY_ORDER.length - 1) return null; // already epic
  return RARITY_ORDER[Math.min(target, RARITY_ORDER.length - 1)]!;
}
