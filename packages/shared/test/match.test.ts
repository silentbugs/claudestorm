import { describe, expect, it } from 'vitest';
import { GameSim } from '../src/sim/GameSim.js';
import {
  DROP_START_Y,
  DROP_TIMEOUT_SECONDS,
  PLAYER_BASE_HP,
  TICK_RATE,
} from '../src/constants.js';
import { buildStormPhases } from '../src/sim/storm.js';
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

  it('bots hold course once over their landing spot instead of spinning', () => {
    const sim = makeSim([{ id: 1, name: 'B', isBot: true }], { skipDrop: false });
    const b = sim.players.get(1)!;
    const yawsOverTarget: number[] = [];
    for (let i = 0; i < (DROP_TIMEOUT_SECONDS + 1) * TICK_RATE && b.gliding; i++) {
      sim.step();
      if (b.gliding && Math.hypot(b.x - b.bot!.landTargetX, b.z - b.bot!.landTargetZ) < 2.5) {
        yawsOverTarget.push(b.yaw);
      }
    }
    // The bot reached its spot early and then descended without twitching.
    expect(yawsOverTarget.length).toBeGreaterThan(5);
    for (const y of yawsOverTarget) expect(y).toBe(yawsOverTarget[0]);
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
    // Settle phase 1 (hold 0.5s + shrink 0.5s), grab the center, then phase 2.
    for (let i = 0; i < TICK_RATE * 1.2; i++) snap = sim.step();
    const c1 = { x: snap.storm.x, z: snap.storm.z };
    for (let i = 0; i < TICK_RATE * 1.8; i++) snap = sim.step();
    // Each circle settles meaningfully away from the previous center — the
    // safe zone wanders instead of collapsing toward the middle.
    expect(Math.hypot(c1.x, c1.z)).toBeGreaterThan(5);
    expect(Math.hypot(snap.storm.x - c1.x, snap.storm.z - c1.z)).toBeGreaterThan(5);
    expect(Math.hypot(snap.storm.x, snap.storm.z)).toBeLessThan(50); // still near the map
  });

  it('bots keep fighting inside a tiny final circle instead of freezing', () => {
    // Two bots in a radius-5 circle: the old flat 5m danger margin made every
    // spot "dangerous", so they scrambled for the center and never attacked.
    const sim = makeSim(
      [
        { id: 1, name: 'B1', isBot: true, spawn: { x: 2, z: 0 } },
        { id: 2, name: 'B2', isBot: true, spawn: { x: -2, z: 0 } },
      ],
      {
        stormPhases: [{ hold: 100000, shrink: 1, targetRadius: 5, dps: 0 }],
        stormStartRadius: 5,
      },
    );
    let damaged = false;
    for (let i = 0; i < TICK_RATE * 20 && !damaged; i++) {
      sim.step();
      damaged =
        sim.players.get(1)!.hp < PLAYER_BASE_HP || sim.players.get(2)!.hp < PLAYER_BASE_HP;
    }
    expect(damaged).toBe(true);
  });

  it('violent lightnings start during a lightnings-flagged shrink, not just after it', () => {
    const sim = makeSim([player(1, 30, 30)], {
      stormPhases: [{ hold: 0.5, shrink: 60, targetRadius: 5, dps: 0, lightnings: true }],
      stormStartRadius: 60,
    });
    let radiusWhenSeen = 0;
    for (let i = 0; i < TICK_RATE * 8 && radiusWhenSeen === 0; i++) {
      const snap = sim.step();
      if (snap.zones.some((z) => z.kind === 'telegraph')) radiusWhenSeen = snap.storm.radius;
    }
    // Struck while the slow endgame creep was still far from its target.
    expect(radiusWhenSeen).toBeGreaterThan(30);
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

describe('storm script generator', () => {
  it('builds the requested number of circles, ending in a slow lightning creep', () => {
    for (const n of [3, 5, 8]) {
      const phases = buildStormPhases(n);
      expect(phases).toHaveLength(n);
      const last = phases[phases.length - 1]!;
      expect(last.lightnings).toBe(true);
      expect(last.targetRadius).toBe(4);
      expect(last.shrink).toBeGreaterThan(phases[phases.length - 2]!.shrink); // the slow creep
      for (let i = 1; i < n; i++) {
        expect(phases[i]!.targetRadius).toBeLessThan(phases[i - 1]!.targetRadius);
      }
    }
  });

  it('paceMult stretches every hold and shrink', () => {
    const normal = buildStormPhases(5, 1);
    const slow = buildStormPhases(5, 1.5);
    for (let i = 0; i < 5; i++) {
      expect(slow[i]!.hold).toBeGreaterThan(normal[i]!.hold);
      expect(slow[i]!.shrink).toBeGreaterThan(normal[i]!.shrink);
      expect(slow[i]!.targetRadius).toBe(normal[i]!.targetRadius);
    }
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
