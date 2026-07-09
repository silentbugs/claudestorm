export interface StormPhaseDef {
  /** Seconds the circle holds before shrinking. */
  hold: number;
  /** Seconds the shrink takes. */
  shrink: number;
  targetRadius: number;
  /** Damage per second outside the circle during and after this phase's shrink. */
  dps: number;
  /** Violent Lightnings rake the safe zone once this phase starts shrinking. */
  lightnings?: boolean;
}

export const STORM_START_RADIUS = 212;

/**
 * Long holds are the "cooldowns" between closes — time to loot and fight.
 * The next-to-last circle is the endgame arena with real room to duel; the
 * last phase is a slow, inescapable creep down to almost nothing while
 * Violent Lightnings hammer whatever space is left.
 */
export const STORM_PHASES: StormPhaseDef[] = [
  { hold: 35, shrink: 35, targetRadius: 130, dps: 4 },
  { hold: 25, shrink: 30, targetRadius: 78, dps: 8 },
  { hold: 22, shrink: 24, targetRadius: 44, dps: 14 },
  { hold: 20, shrink: 18, targetRadius: 26, dps: 20 },
  { hold: 14, shrink: 75, targetRadius: 4, dps: 32, lightnings: true },
];
