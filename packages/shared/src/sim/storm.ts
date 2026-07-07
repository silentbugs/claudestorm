export interface StormPhaseDef {
  /** Seconds the circle holds before shrinking. */
  hold: number;
  /** Seconds the shrink takes. */
  shrink: number;
  targetRadius: number;
  /** Damage per second outside the circle during and after this phase's shrink. */
  dps: number;
}

export const STORM_START_RADIUS = 142;

export const STORM_PHASES: StormPhaseDef[] = [
  { hold: 22, shrink: 24, targetRadius: 78, dps: 5 },
  { hold: 14, shrink: 20, targetRadius: 42, dps: 10 },
  { hold: 10, shrink: 15, targetRadius: 18, dps: 18 },
  { hold: 8, shrink: 10, targetRadius: 4, dps: 30 },
];
