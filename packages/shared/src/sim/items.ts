import type { Rng } from '../math/rng.js';

/**
 * Plunderstorm-style consumables: found in the world and in chests,
 * one held at a time, used with G.
 */
export type ItemId = 'chickenCoup' | 'smokeBomb' | 'mechanoHog' | 'gravityLauncher';

export interface ItemDef {
  id: ItemId;
  name: string;
  icon: string;
  description: string;
  color: number;
}

export const ITEMS: Record<ItemId, ItemDef> = {
  chickenCoup: {
    id: 'chickenCoup',
    name: 'Chicken Coup',
    icon: '🐔',
    description: 'Devour a suspiciously fortifying chicken: restores 60 health over 6 seconds.',
    color: 0xf5ead2,
  },
  smokeBomb: {
    id: 'smokeBomb',
    name: 'Smoke Bomb',
    icon: '💨',
    description: 'Vanish in a puff of smoke: 3 seconds of stealth. Attacking breaks it.',
    color: 0x9a9aa8,
  },
  mechanoHog: {
    id: 'mechanoHog',
    name: 'Mechano-Hog',
    icon: '🏍️',
    description: 'Rev a goblin chopper: +60% movement speed for 4 seconds.',
    color: 0xd45a2e,
  },
  gravityLauncher: {
    id: 'gravityLauncher',
    name: 'Gnomish Gravity Launcher',
    icon: '🚀',
    description: 'Launch yourself in a huge arc in the direction you are moving.',
    color: 0x7fd4ff,
  },
};

export const ITEM_IDS = Object.keys(ITEMS) as ItemId[];

export function rollItem(rng: Rng): ItemId {
  return ITEM_IDS[rng.int(0, ITEM_IDS.length)]!;
}

/** Chance a chest also drops a consumable item. */
export const CHEST_ITEM_CHANCE = 0.4;

/** Heal-over-time numbers for the Chicken Coup. */
export const CHICKEN_HEAL_TOTAL = 60;
export const CHICKEN_HEAL_SECONDS = 6;
export const SMOKE_STEALTH_SECONDS = 3;
export const HOG_SPEED_MULT = 1.6;
export const HOG_SPEED_SECONDS = 4;
export const LAUNCHER_RANGE = 16;
export const LAUNCHER_DURATION = 0.7;
