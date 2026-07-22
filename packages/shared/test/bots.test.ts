import { describe, expect, it } from 'vitest';
import { computeBotInput } from '../src/sim/bots.js';
import { Rng } from '../src/math/rng.js';
import { makeSim, player } from './helpers.js';

describe('bot heal decisions', () => {
  it('heals when desperately low, even while stuck flagged as storm-retreating', () => {
    const sim = makeSim([player(1, 0, 0, { isBot: true })]);
    const bot = sim.players.get(1)!;
    bot.hp = bot.maxHp * 0.2; // below the 30% "desperate" threshold
    // Simulates the bug: a shrinking endgame circle can leave a bot flagged
    // "retreating" almost permanently, which used to block healing outright.
    bot.bot!.retreating = true;
    bot.bot!.retreatX = 50;
    bot.bot!.retreatZ = 0;

    const cmd = computeBotInput(bot, {
      tick: 0,
      rng: new Rng(1),
      players: [bot],
      storm: { x: 0, z: 0, radius: 100 },
      difficulty: 'normal',
    });

    expect(cmd.buttons.heal).toBe(true);
  });

  it('does not override the conservative rule above 30% HP', () => {
    const sim = makeSim([player(1, 0, 0, { isBot: true })]);
    const bot = sim.players.get(1)!;
    bot.hp = bot.maxHp * 0.5; // hurt, but not desperate
    bot.bot!.retreating = true;
    bot.bot!.retreatX = 50;
    bot.bot!.retreatZ = 0;

    const cmd = computeBotInput(bot, {
      tick: 0,
      rng: new Rng(1),
      players: [bot],
      storm: { x: 0, z: 0, radius: 100 },
      difficulty: 'normal',
    });

    expect(cmd.buttons.heal).toBe(false);
  });
});

describe('bot glide decisions', () => {
  it('dives once lined up over its landing spot', () => {
    const sim = makeSim([player(1, 0, 0, { isBot: true })], { skipDrop: false });
    const bot = sim.players.get(1)!;
    bot.gliding = true;
    bot.y = 50;
    bot.bot!.landTargetX = bot.x;
    bot.bot!.landTargetZ = bot.z; // already lined up

    const cmd = computeBotInput(bot, {
      tick: 0,
      rng: new Rng(1),
      players: [bot],
      storm: { x: 0, z: 0, radius: 400 },
      difficulty: 'normal',
    });

    expect(cmd.buttons.dive).toBe(true);
  });

  it('peels off toward a fresh spot when its landing zone is crowded with other gliders', () => {
    const sim = makeSim(
      [
        player(1, 0, 0, { isBot: true }),
        player(2, 5, 0, { isBot: true }),
        player(3, -5, 0, { isBot: true }),
      ],
      { skipDrop: false },
    );
    const bot = sim.players.get(1)!;
    const p2 = sim.players.get(2)!;
    const p3 = sim.players.get(3)!;
    bot.gliding = true;
    bot.y = 100;
    p2.gliding = true;
    p3.gliding = true;
    bot.bot!.landTargetX = 0;
    bot.bot!.landTargetZ = 0;
    p2.x = 5;
    p2.z = 0; // within the 25m crowding radius of the shared target
    p3.x = -5;
    p3.z = 0;

    computeBotInput(bot, {
      tick: 0,
      rng: new Rng(1),
      players: [bot, p2, p3],
      storm: { x: 0, z: 0, radius: 400 },
      difficulty: 'normal',
    });

    const moved = bot.bot!.landTargetX !== 0 || bot.bot!.landTargetZ !== 0;
    expect(moved).toBe(true);
  });

  it('does not peel off when the "crowd" is entirely teammates', () => {
    const sim = makeSim(
      [
        player(1, 0, 0, { isBot: true, teamId: 1 }),
        player(2, 5, 0, { isBot: true, teamId: 1 }),
        player(3, -5, 0, { isBot: true, teamId: 1 }),
      ],
      { skipDrop: false },
    );
    const bot = sim.players.get(1)!;
    const p2 = sim.players.get(2)!;
    const p3 = sim.players.get(3)!;
    bot.gliding = true;
    bot.y = 100;
    p2.gliding = true;
    p3.gliding = true;
    bot.bot!.landTargetX = 0;
    bot.bot!.landTargetZ = 0;
    p2.x = 5;
    p2.z = 0;
    p3.x = -5;
    p3.z = 0;

    computeBotInput(bot, {
      tick: 0,
      rng: new Rng(1),
      players: [bot, p2, p3],
      storm: { x: 0, z: 0, radius: 400 },
      difficulty: 'normal',
    });

    expect(bot.bot!.landTargetX).toBe(0);
    expect(bot.bot!.landTargetZ).toBe(0);
  });
});

describe('duos target acquisition', () => {
  it('never targets a living teammate, even when it is the nearest player', () => {
    const sim = makeSim([
      player(1, 0, 0, { isBot: true, teamId: 1 }),
      player(2, 1, 0, { teamId: 1 }), // teammate, closest
      player(3, 20, 0, { teamId: 2 }), // rival, farther away
    ]);
    const bot = sim.players.get(1)!;
    const mate = sim.players.get(2)!;
    const rival = sim.players.get(3)!;

    const cmd = computeBotInput(bot, {
      tick: 0,
      rng: new Rng(1),
      players: [bot, mate, rival],
      storm: { x: 0, z: 0, radius: 400 },
      difficulty: 'normal',
    });

    // Aim scatter (up to a few meters) means this can't be an exact match, but
    // the teammate- and rival-aim ranges don't overlap (teammate at x=1 aims
    // land under 10, rival at x=20 land well above it) — so this robustly
    // proves the rival was picked, not the much-closer teammate.
    expect(cmd.aimX).toBeGreaterThan(10);
  });
});

describe('duos revive behavior', () => {
  it('holds still and presses interact next to a downed teammate', () => {
    const sim = makeSim([
      player(1, 0, 0, { isBot: true, teamId: 1 }),
      player(2, 1, 0, { teamId: 1 }), // downed teammate, within INTERACT_RADIUS
    ]);
    const bot = sim.players.get(1)!;
    const mate = sim.players.get(2)!;
    mate.alive = false;

    const cmd = computeBotInput(bot, {
      tick: 0,
      rng: new Rng(1),
      players: [bot, mate],
      storm: { x: 0, z: 0, radius: 400 },
      difficulty: 'normal',
    });

    expect(cmd.buttons.interact).toBe(true);
    expect(cmd.moveX).toBe(0);
    expect(cmd.moveZ).toBe(0);
  });

  it('steers toward a distant downed teammate', () => {
    const sim = makeSim([
      player(1, 0, 0, { isBot: true, teamId: 1 }),
      player(2, 20, 0, { teamId: 1 }), // downed teammate, out of interact range
    ]);
    const bot = sim.players.get(1)!;
    const mate = sim.players.get(2)!;
    mate.alive = false;

    const cmd = computeBotInput(bot, {
      tick: 0,
      rng: new Rng(1),
      players: [bot, mate],
      storm: { x: 0, z: 0, radius: 400 },
      difficulty: 'normal',
    });

    expect(cmd.buttons.interact).toBe(false);
    expect(cmd.moveX).toBeCloseTo(1, 1);
    expect(cmd.moveZ).toBeCloseTo(0, 1);
  });

  it('does not divert to a downed teammate while already in combat', () => {
    const sim = makeSim([
      player(1, 0, 0, { isBot: true, teamId: 1 }),
      player(2, 1, 0, { teamId: 1 }), // downed teammate, within interact range
      player(3, 5, 0, { teamId: 2 }), // living rival, close enough to be "in combat"
    ]);
    const bot = sim.players.get(1)!;
    const mate = sim.players.get(2)!;
    const rival = sim.players.get(3)!;
    mate.alive = false;

    const cmd = computeBotInput(bot, {
      tick: 0,
      rng: new Rng(1),
      players: [bot, mate, rival],
      storm: { x: 0, z: 0, radius: 400 },
      difficulty: 'normal',
    });

    expect(cmd.buttons.interact).toBe(false);
  });

  it('does not path toward a downed teammate stranded outside the safe storm radius', () => {
    const sim = makeSim([
      player(1, 0, 0, { isBot: true, teamId: 1 }),
      player(2, 97, 0, { teamId: 1 }), // downed teammate, beyond storm.radius - margin (95)
    ]);
    const bot = sim.players.get(1)!;
    const mate = sim.players.get(2)!;
    mate.alive = false;

    const cmd = computeBotInput(bot, {
      tick: 0,
      rng: new Rng(1),
      players: [bot, mate],
      storm: { x: 0, z: 0, radius: 100 },
      difficulty: 'normal',
    });

    expect(cmd.buttons.interact).toBe(false);
  });
});

describe('duos regroup behavior', () => {
  it('roams toward a distant living teammate instead of a random waypoint', () => {
    const sim = makeSim([
      player(1, 0, 0, { isBot: true, teamId: 1 }),
      player(2, 50, 0, { teamId: 1 }),
    ]);
    const bot = sim.players.get(1)!;
    const mate = sim.players.get(2)!;

    const cmd = computeBotInput(bot, {
      tick: 0,
      rng: new Rng(1),
      players: [bot, mate],
      storm: { x: 0, z: 0, radius: 400 },
      difficulty: 'normal',
    });

    // No enemies exist (the only other player is a teammate), no storm danger,
    // so this must be the roam branch — and with a teammate 50m away, it
    // should head straight for them (+x) rather than a random waypoint.
    expect(cmd.moveX).toBeCloseTo(1, 1);
    expect(cmd.moveZ).toBeCloseTo(0, 1);
  });
});
