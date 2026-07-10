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

export const STORM_START_RADIUS = 537; // covers the 760×760 island corner to corner

/**
 * Build a storm script. Long holds are the "cooldowns" between closes — time
 * to loot and fight; holds and shrinks get shorter as the match tightens. The
 * next-to-last circle stays roomy enough to duel in, and the last phase is a
 * slow, inescapable creep down to almost nothing under Violent Lightnings.
 *
 * @param circles   How many circles the match has (clamped 2–8).
 * @param paceMult  Scales every hold/shrink duration: <1 faster, >1 slower.
 */
export function buildStormPhases(circles = 5, paceMult = 1): StormPhaseDef[] {
  const n = Math.max(2, Math.min(8, Math.round(circles)));
  const first = STORM_START_RADIUS * 0.42;
  const phases: StormPhaseDef[] = [];
  for (let i = 0; i < n; i++) {
    const t = i / (n - 1);
    const last = i === n - 1;
    phases.push({
      hold: Math.round((35 - 21 * t) * paceMult),
      shrink: Math.round((last ? 80 : 45 - 25 * t) * paceMult),
      // Radii fall geometrically; the 0.8 exponent keeps the late circles roomy.
      targetRadius: last ? 4 : Math.round(first * Math.pow(4 / first, t * 0.8)),
      dps: Math.round(4 + 28 * t),
      ...(last ? { lightnings: true } : {}),
    });
  }
  return phases;
}

export const STORM_PHASES: StormPhaseDef[] = buildStormPhases();
