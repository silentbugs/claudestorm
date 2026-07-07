export interface StormPhaseDef {
  /** Seconds the circle holds before shrinking. */
  hold: number;
  /** Seconds the shrink takes. */
  shrink: number;
  targetRadius: number;
  /** Damage per second outside the circle during and after this phase's shrink. */
  dps: number;
}

export const STORM_START_RADIUS = 115;

export const STORM_PHASES: StormPhaseDef[] = [
  { hold: 20, shrink: 22, targetRadius: 62, dps: 5 },
  { hold: 12, shrink: 18, targetRadius: 34, dps: 10 },
  { hold: 10, shrink: 14, targetRadius: 15, dps: 18 },
  { hold: 8, shrink: 10, targetRadius: 4, dps: 30 },
];
