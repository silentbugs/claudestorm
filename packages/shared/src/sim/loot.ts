import type { AbilityId, Rarity } from '../protocol/types.js';
import type { Rng } from '../math/rng.js';
import { ABILITY_IDS } from './abilities.js';

const RARITY_WEIGHTS: [Rarity, number][] = [
  ['common', 50],
  ['uncommon', 30],
  ['rare', 15],
  ['epic', 5],
];

export function rollRarity(rng: Rng): Rarity {
  const total = RARITY_WEIGHTS.reduce((sum, [, w]) => sum + w, 0);
  let roll = rng.next() * total;
  for (const [rarity, weight] of RARITY_WEIGHTS) {
    roll -= weight;
    if (roll <= 0) return rarity;
  }
  return 'common';
}

export function rollAbility(rng: Rng): AbilityId {
  return ABILITY_IDS[rng.int(0, ABILITY_IDS.length)]!;
}

export const CHEST_COINS_MIN = 4;
export const CHEST_COINS_MAX = 7;
export const CHEST_SCROLLS_MIN = 1;
export const CHEST_SCROLLS_MAX = 2;

export const MOB_COINS_MIN = 3;
export const MOB_COINS_MAX = 5;
export const MOB_SCROLL_CHANCE = 0.25;
