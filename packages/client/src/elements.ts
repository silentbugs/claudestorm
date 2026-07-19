import type { AbilityId } from '@claudestorm/shared';

/**
 * Every spell reads by its element: electrical bolts are yellow/blue, earth
 * is brown, fire is orange, frost is icy blue, and so on. `core` is the
 * saturated body color (projectile cores, bursts), `glow` the paler
 * accent/flash tone, and `deep` an optional darker fill for zone interiors.
 * Shared by rendering (VFX/colors) and audio (per-element sound flavor) so
 * the two systems can't drift apart on what element a spell is.
 */
export type Element =
  | 'fire'
  | 'frost'
  | 'electric'
  | 'earth'
  | 'nature'
  | 'holy'
  | 'arcane'
  | 'shadow'
  | 'wind'
  | 'physical';

export const ELEMENT_PALETTE: Record<Element, { core: number; glow: number; deep?: number }> = {
  fire: { core: 0xff6a2e, glow: 0xffab6a, deep: 0xd45a2e },
  frost: { core: 0x4d9be6, glow: 0x9fd8ff },
  electric: { core: 0x4da6ff, glow: 0xfff066 },
  earth: { core: 0xa8703a, glow: 0xd9a86a },
  nature: { core: 0x5da83a, glow: 0x9fe07a },
  holy: { core: 0xffcf5c, glow: 0xffe9a8 },
  arcane: { core: 0x8a5aff, glow: 0xc9a8ff },
  shadow: { core: 0x3a2f55, glow: 0x6a4a9c },
  wind: { core: 0x9fe0c8, glow: 0xcfe8dd },
  physical: { core: 0xb8bcc8, glow: 0xd8d8e8 },
};

/** Which element each spell reads as, for coloring projectiles/zones/VFX and picking its sound flavor. */
export const ABILITY_ELEMENT: Partial<Record<AbilityId, Element>> = {
  rimeArrow: 'frost',
  fireWhirl: 'fire',
  earthbreaker: 'earth',
  holyShield: 'holy',
  stormArchon: 'electric',
  manaSphere: 'arcane',
  searingAxe: 'fire',
  slicingWinds: 'wind',
  starBomb: 'arcane',
  celestialBarrage: 'arcane',
  toxicSmackerel: 'nature',
  quakingLeap: 'earth',
  huntersChains: 'physical',
  steelTraps: 'physical',
  windstorm: 'wind',
  explosiveCaltrops: 'fire',
  snowdrift: 'frost',
  lightningBulwark: 'electric',
  fadeToShadow: 'shadow',
  repel: 'arcane',
  faeform: 'nature',
};

export function elementOf(abilityId: AbilityId): { core: number; glow: number; deep?: number } {
  return ELEMENT_PALETTE[ABILITY_ELEMENT[abilityId] ?? 'holy'];
}

export function elementKeyOf(abilityId: AbilityId): Element {
  return ABILITY_ELEMENT[abilityId] ?? 'holy';
}
