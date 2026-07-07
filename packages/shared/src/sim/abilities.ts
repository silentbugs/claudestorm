import type { AbilityId, Rarity, SlotCategory } from '../protocol/types.js';

export type AbilityBehavior = 'projectile' | 'groundAoE' | 'selfAura' | 'leap' | 'shield';

export const RARITY_MULT: Record<Rarity, number> = {
  common: 1,
  uncommon: 1.3,
  rare: 1.6,
  epic: 2,
};

export const RARITY_ORDER: Rarity[] = ['common', 'uncommon', 'rare', 'epic'];

/**
 * All times in seconds, distances in meters. Damage-like numbers are base values,
 * scaled by rarity and caster level at cast time. Adding an ability = adding config.
 */
export interface AbilityDef {
  id: AbilityId;
  name: string;
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
  /** Pull the struck enemy to the caster and briefly root them. */
  pull?: boolean;
  rootDuration?: number;
  /** Leave a damaging pool where the projectile ends. */
  poolRadius?: number;
  poolDuration?: number;
  poolDps?: number;
  /** groundAoE */
  castRange?: number;
  telegraph?: number;
  aoeRadius?: number;
  /** selfAura */
  auraRadius?: number;
  auraDuration?: number;
  /** leap */
  leapRange?: number;
  leapDuration?: number;
  landRadius?: number;
  knockbackDistance?: number;
  /** shield */
  shieldAmount?: number;
  shieldDuration?: number;
}

export const ABILITIES: Record<AbilityId, AbilityDef> = {
  frostArrow: {
    id: 'frostArrow',
    name: 'Frost Arrow',
    category: 'offense',
    behavior: 'projectile',
    cooldown: 2,
    damage: 18,
    projectileSpeed: 30,
    projectileRadius: 0.55,
    projectileLifetime: 1.2,
    slowDuration: 1.5,
    slowFactor: 0.55,
  },
  flameCyclone: {
    id: 'flameCyclone',
    name: 'Flame Cyclone',
    category: 'offense',
    behavior: 'selfAura',
    cooldown: 8,
    damage: 22, // dps while active
    auraRadius: 3,
    auraDuration: 3,
  },
  stormCall: {
    id: 'stormCall',
    name: 'Storm Call',
    category: 'offense',
    behavior: 'groundAoE',
    cooldown: 6,
    damage: 38,
    castRange: 26,
    telegraph: 0.9,
    aoeRadius: 4,
  },
  venomOrb: {
    id: 'venomOrb',
    name: 'Venom Orb',
    category: 'offense',
    behavior: 'projectile',
    cooldown: 7,
    damage: 10,
    projectileSpeed: 20,
    projectileRadius: 0.6,
    projectileLifetime: 0.8,
    poolRadius: 2.6,
    poolDuration: 4,
    poolDps: 12,
  },
  gustLeap: {
    id: 'gustLeap',
    name: 'Gust Leap',
    category: 'utility',
    behavior: 'leap',
    cooldown: 9,
    damage: 10,
    leapRange: 10,
    leapDuration: 0.5,
    landRadius: 3.5,
    knockbackDistance: 6,
  },
  graspingChains: {
    id: 'graspingChains',
    name: 'Grasping Chains',
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
  stoneShield: {
    id: 'stoneShield',
    name: 'Stone Shield',
    category: 'utility',
    behavior: 'shield',
    cooldown: 12,
    damage: 0,
    shieldAmount: 40,
    shieldDuration: 4,
  },
};

export const ABILITY_IDS = Object.keys(ABILITIES) as AbilityId[];
export const OFFENSE_ABILITIES = ABILITY_IDS.filter((id) => ABILITIES[id].category === 'offense');
export const UTILITY_ABILITIES = ABILITY_IDS.filter((id) => ABILITIES[id].category === 'utility');

/** Slot layout: indices 0/1 are offense, 2 is utility. */
export const SLOT_COUNT = 3;
export function slotCategory(slotIndex: number): SlotCategory {
  return slotIndex < 2 ? 'offense' : 'utility';
}
