import { describe, expect, it } from 'vitest';
import { GameSim } from '../src/sim/GameSim.js';
import {
  DROP_START_Y,
  DROP_TIMEOUT_SECONDS,
  PLAYER_BASE_HP,
  TICK_RATE,
} from '../src/constants.js';
import { buttons, cmd, loadout, makeSim, player, CALM_STORM, FLAT_MAP } from './helpers.js';

describe('drop phase', () => {
  it('players glide down, steer, and the match goes live once everyone lands', () => {
    const sim = makeSim(
      [
        { id: 1, name: 'A', isBot: false },
        { id: 2, name: 'B', isBot: false },
      ],
      { skipDrop: false },
    );
    sim.applyInput(1, cmd({ moveX: 1 }));
    let snap = sim.step();
    expect(snap.phase).toBe('drop');
    expect(snap.players[0]!.gliding).toBe(true);
    expect(snap.players[0]!.y).toBeLessThan(DROP_START_Y);
    for (let i = 0; i < (DROP_TIMEOUT_SECONDS + 1) * TICK_RATE; i++) snap = sim.step();
    expect(snap.phase).toBe('live');
    for (const p of snap.players) {
      expect(p.gliding).toBe(false);
      expect(p.y).toBe(0);
    }
    // The steering player drifted away from the drop line.
    expect(snap.players[0]!.x).toBeGreaterThan(30);
  });

  it('no damage is dealt during the drop', () => {
    const sim = makeSim(
      [
        { id: 1, name: 'A', isBot: false },
        { id: 2, name: 'B', isBot: false },
      ],
      { skipDrop: false },
    );
    sim.applyInput(1, cmd({ buttons: buttons({ melee: true }) }));
    for (let i = 0; i < 20; i++) sim.step();
    expect(sim.players.get(2)!.hp).toBe(PLAYER_BASE_HP);
  });
});

describe('storm', () => {
  it('shrinks to target radius and kills players caught outside', () => {
    const sim = makeSim([player(1, 0, 0), player(2, 15, 0)], {
      stormPhases: [{ hold: 1, shrink: 1, targetRadius: 10, dps: 50 }],
      stormStartRadius: 20,
    });
    let snap = sim.step();
    for (let i = 0; i < TICK_RATE * 10; i++) snap = sim.step();
    expect(snap.storm.radius).toBeCloseTo(10, 5);
    expect(snap.phase).toBe('ended');
    expect(snap.winnerId).toBe(1);
    expect(sim.players.get(2)!.alive).toBe(false);
  });

  it('drifts toward a new center inside the previous circle each phase', () => {
    const sim = makeSim([player(1, 0, 0)], {
      stormPhases: [
        { hold: 0.5, shrink: 0.5, targetRadius: 30, dps: 0 },
        { hold: 0.5, shrink: 0.5, targetRadius: 12, dps: 0 },
      ],
      stormStartRadius: 50,
      seed: 7,
    });
    let snap = sim.step();
    const centers: string[] = [];
    for (let i = 0; i < TICK_RATE * 3; i++) {
      snap = sim.step();
      centers.push(`${snap.storm.x.toFixed(2)},${snap.storm.z.toFixed(2)}`);
    }
    // The center moved at some point, and the final circle sits off origin.
    expect(new Set(centers).size).toBeGreaterThan(1);
    expect(Math.hypot(snap.storm.x, snap.storm.z)).toBeGreaterThan(0.01);
    expect(Math.hypot(snap.storm.x, snap.storm.z)).toBeLessThan(50); // still near the map
  });

  it('violent lightnings strike inside the final circle', () => {
    const sim = makeSim([player(1, 30, 30)], {
      stormPhases: [{ hold: 0.2, shrink: 0.3, targetRadius: 10, dps: 0 }],
      stormStartRadius: 12,
    });
    let sawLightning = false;
    for (let i = 0; i < TICK_RATE * 5 && !sawLightning; i++) {
      const snap = sim.step();
      if (snap.zones.some((z) => z.kind === 'telegraph')) sawLightning = true;
    }
    expect(sawLightning).toBe(true);
  });
});

describe('match flow', () => {
  it('ends with a winner when only one player remains', () => {
    const sim = makeSim([
      player(1, 0, 0, { loadout: loadout(['rimeArrow']) }),
      player(2, 6, 0),
    ]);
    let snap = sim.step();
    for (let i = 0; i < TICK_RATE * 30 && snap.phase !== 'ended'; i++) {
      sim.applyInput(1, cmd({ aimX: 6, aimZ: 0, slotCasts: [0] }));
      snap = sim.step();
    }
    expect(snap.phase).toBe('ended');
    expect(snap.winnerId).toBe(1);
    expect(snap.aliveCount).toBe(1);
  });
});

describe('determinism', () => {
  it('two sims with the same seed and inputs produce identical snapshots', () => {
    const build = () =>
      new GameSim({
        seed: 42,
        players: [
          { id: 1, name: 'Human', isBot: false, loadout: loadout(['rimeArrow', 'starBomb'], ['huntersChains'], 'rare') },
          { id: 2, name: 'Bot1', isBot: true },
          { id: 3, name: 'Bot2', isBot: true },
          { id: 4, name: 'Bot3', isBot: true },
        ],
      });
    const a = build();
    const b = build();
    let lastA = '';
    let lastB = '';
    for (let i = 0; i < 320; i++) {
      const input = cmd({
        moveX: Math.sin(i / 10),
        moveZ: Math.cos(i / 10),
        yaw: Math.sin(i / 9) * Math.PI,
        aimX: Math.sin(i / 7) * 20,
        aimZ: Math.cos(i / 7) * 20,
        buttons: buttons({ melee: i % 30 < 10, roll: i % 90 === 0, jump: i % 45 === 0, interact: i % 60 === 0 }),
        slotCasts: i % 25 === 0 ? [0] : i % 40 === 0 ? [1] : i % 55 === 0 ? [2] : [],
      });
      a.applyInput(1, input);
      b.applyInput(1, input);
      lastA = JSON.stringify(a.step());
      lastB = JSON.stringify(b.step());
    }
    expect(lastA).toBe(lastB);
  });
});

describe('helpers sanity', () => {
  it('calm storm never harms anyone', () => {
    const sim = makeSim([player(1, 45, 45), player(2, -45, -45)], {
      stormPhases: CALM_STORM,
      map: FLAT_MAP,
    });
    for (let i = 0; i < TICK_RATE * 5; i++) sim.step();
    expect(sim.players.get(1)!.hp).toBe(PLAYER_BASE_HP);
  });
});
