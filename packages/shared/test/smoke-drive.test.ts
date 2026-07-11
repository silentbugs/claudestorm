import { describe, expect, it } from 'vitest';
import { GameSim } from '../src/sim/GameSim.js';
import { ARENA } from '../src/maps/arena.js';
import { STORM_PHASES, STORM_START_RADIUS } from '../src/sim/storm.js';
import { TICK_RATE } from '../src/constants.js';

describe('headless full-match smoke', () => {
  it('a full 50-player match on the real arena runs to a winner without errors', () => {
    const players = Array.from({ length: 50 }, (_, i) => ({
      id: i + 1,
      name: `Bot${i + 1}`,
      isBot: true,
      spawn: { x: -135 + (i % 10) * 30, z: -125 + Math.floor(i / 10) * 60 },
    }));
    const sim = new GameSim({
      seed: 42,
      players,
      map: ARENA,
      stormPhases: STORM_PHASES,
      stormStartRadius: STORM_START_RADIUS,
    });
    let snap = sim.step();
    const maxTicks = TICK_RATE * 60 * 10; // 10 minutes of sim time, way past the storm script
    for (let i = 0; i < maxTicks && snap.phase !== 'ended'; i++) snap = sim.step();
    expect(snap.phase).toBe('ended');
    expect(snap.winnerId).not.toBeNull();
    expect(snap.aliveCount).toBeLessThanOrEqual(1);
  });
});
