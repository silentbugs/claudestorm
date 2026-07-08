export interface StormPhaseDef {
  /** Seconds the circle holds before shrinking. */
  hold: number;
  /** Seconds the shrink takes. */
  shrink: number;
  targetRadius: number;
  /** Damage per second outside the circle during and after this phase's shrink. */
  dps: number;
}

export const STORM_START_RADIUS = 212;

export const STORM_PHASES: StormPhaseDef[] = [
  { hold: 24, shrink: 26, targetRadius: 115, dps: 5 },
  { hold: 14, shrink: 20, targetRadius: 62, dps: 10 },
  { hold: 12, shrink: 16, targetRadius: 28, dps: 18 },
  { hold: 8, shrink: 12, targetRadius: 5, dps: 30 },
];
