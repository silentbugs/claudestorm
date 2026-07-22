import { describe, expect, it } from 'vitest';
import { REVIVE_CHANNEL_SECONDS, REVIVE_HP_FRACTION, TICK_RATE } from '../src/constants.js';
import { buttons, cmd, loadout, makeSim, player } from './helpers.js';

const PRESS_INTERACT = buttons({ interact: true });
const HOLD_MELEE = buttons({ melee: true });

/** Kills `victimId` for real (through the actual damage path, not a manual flag flip)
 * so dropDeathLoot/grounding/etc. all run — an enemy at (3, 0) melees a 1-hp victim at (1, 0). */
function killForReal(sim: ReturnType<typeof makeSim>, victimId: number): void {
  sim.players.get(victimId)!.hp = 1;
  sim.applyInput(3, cmd({ yaw: -Math.PI / 2, buttons: HOLD_MELEE }));
  sim.step();
  // Release the swing — a lingering held melee would keep firing (once its
  // cooldown clears) and could re-kill the target the instant they're revived.
  sim.applyInput(3, cmd({ buttons: buttons() }));
}

describe('reviving a downed teammate', () => {
  it('starts a revive channel on a downed teammate, not a downed enemy', () => {
    const sim = makeSim([
      player(1, 0, 0, { teamId: 1 }),
      player(2, 1, 0, { teamId: 1 }), // teammate
      player(3, -1, 0, { teamId: 2 }), // enemy
    ]);
    sim.players.get(2)!.alive = false;
    sim.players.get(3)!.alive = false;
    sim.applyInput(1, cmd({ buttons: PRESS_INTERACT }));
    const snap = sim.step();
    expect(snap.players.find((p) => p.id === 1)!.channelKind).toBe('revive');
  });

  it('does nothing when the only downed nearby player is an enemy', () => {
    const sim = makeSim([player(1, 0, 0, { teamId: 1 }), player(3, 1, 0, { teamId: 2 })]);
    sim.players.get(3)!.alive = false;
    sim.applyInput(1, cmd({ buttons: PRESS_INTERACT }));
    const snap = sim.step();
    expect(snap.players.find((p) => p.id === 1)!.channelKind).toBe(null);
  });

  it('completes after REVIVE_CHANNEL_SECONDS: revives at partial HP and fires the event', () => {
    const sim = makeSim([
      player(1, 0, 0, { teamId: 1 }),
      player(2, 1, 0, { teamId: 1 }),
      player(3, 3, 0, { teamId: 2 }),
    ]);
    const mate = sim.players.get(2)!;
    killForReal(sim, 2);
    expect(mate.alive).toBe(false);

    sim.applyInput(1, cmd({ buttons: PRESS_INTERACT }));
    const channelTicks = Math.round(REVIVE_CHANNEL_SECONDS * TICK_RATE);
    let snap = sim.step();
    expect(snap.players.find((p) => p.id === 1)!.channelKind).toBe('revive');

    let revivedEvent = false;
    for (let i = 0; i < channelTicks + 2 && !revivedEvent; i++) {
      snap = sim.step();
      revivedEvent = snap.events.some((e) => e.type === 'revived' && e.id === 2 && e.reviverId === 1);
    }

    expect(revivedEvent).toBe(true);
    expect(mate.alive).toBe(true);
    expect(mate.hp).toBeCloseTo(mate.maxHp * REVIVE_HP_FRACTION, 5);
  });

  it('channel is cancelled by the reviver moving', () => {
    const sim = makeSim([
      player(1, 0, 0, { teamId: 1 }),
      player(2, 1, 0, { teamId: 1 }),
      player(3, 3, 0, { teamId: 2 }),
    ]);
    killForReal(sim, 2);
    sim.applyInput(1, cmd({ buttons: PRESS_INTERACT }));
    sim.step();
    sim.applyInput(1, cmd({ moveX: 1 }));
    const snap = sim.step();
    expect(snap.players.find((p) => p.id === 1)!.channelKind).toBe(null);
  });

  it('channel is cancelled by the reviver taking damage', () => {
    const sim = makeSim([
      player(1, 0, 0, { teamId: 1 }),
      player(2, 1, 0, { teamId: 1 }),
      player(3, 3, 0, { teamId: 2 }),
    ]);
    killForReal(sim, 2); // enemy at (3,0) vs. victim at (1,0) — too far to also clip player 1
    sim.applyInput(1, cmd({ buttons: PRESS_INTERACT }));
    sim.step();
    // The enemy closes in and turns on the reviver instead (teleported, same
    // "skip the grind" pattern other tests in this suite already use).
    const enemy = sim.players.get(3)!;
    enemy.x = 1.5;
    enemy.z = 0;
    enemy.meleeCdTicks = 0; // the kill swing above put melee on cooldown; clear it so this swing lands now
    sim.applyInput(3, cmd({ yaw: -Math.PI / 2, buttons: HOLD_MELEE }));
    sim.applyInput(1, cmd({ buttons: buttons() })); // stop pressing interact, hold still
    sim.step(); // the swing lands this tick, setting damagedThisTick
    sim.applyInput(3, cmd({ buttons: buttons() })); // release — don't keep swinging into next tick
    // The cancellation is observed at the start of the *next* tick (damage
    // taken during a tick can't be seen until the following one — see the
    // comment on the damagedThisTick check in updatePlayer).
    const snap = sim.step();
    expect(snap.players.find((p) => p.id === 1)!.channelKind).toBe(null);
  });

  it('does not restore the loadout that scattered on death', () => {
    const full = loadout(['rimeArrow', 'starBomb'], ['quakingLeap']);
    const sim = makeSim([
      player(1, 0, 0, { teamId: 1 }),
      player(2, 1, 0, { teamId: 1, loadout: full }),
      player(3, 3, 0, { teamId: 2 }),
    ]);
    const mate = sim.players.get(2)!;
    killForReal(sim, 2);
    expect(mate.slots.offense.every((s) => s === null)).toBe(true);
    expect(mate.slots.utility.every((s) => s === null)).toBe(true);
    // Push the scrolls dropDeathLoot just scattered out of auto-pickup range —
    // otherwise, standing revived right on top of them would legitimately vacuum
    // them back up (SCROLL_AUTO_PICKUP_RADIUS), which is a separate mechanic
    // from what this test checks: that revivePlayer itself never restores slots.
    for (const scroll of sim.scrolls.values()) {
      scroll.x = 1000;
      scroll.z = 1000;
    }

    sim.applyInput(1, cmd({ buttons: PRESS_INTERACT }));
    const channelTicks = Math.round(REVIVE_CHANNEL_SECONDS * TICK_RATE);
    let revived = false;
    for (let i = 0; i < channelTicks + 2 && !revived; i++) {
      const snap = sim.step();
      revived = snap.events.some((e) => e.type === 'revived' && e.id === 2);
    }

    expect(mate.alive).toBe(true);
    expect(mate.slots.offense.every((s) => s === null)).toBe(true);
    expect(mate.slots.utility.every((s) => s === null)).toBe(true);
  });

  it('does not resume a status effect that was frozen at the moment of death', () => {
    const sim = makeSim([
      player(1, 0, 0, { teamId: 1 }),
      player(2, 1, 0, { teamId: 1 }),
      player(3, 3, 0, { teamId: 2 }),
    ]);
    const mate = sim.players.get(2)!;
    killForReal(sim, 2);
    // Simulate having died mid-poison — damagePlayer's death branch doesn't
    // touch poison, so this is exactly the state a real poisoned death leaves.
    mate.poisonTicks = 100;
    mate.poisonDps = 999;

    sim.applyInput(1, cmd({ buttons: PRESS_INTERACT }));
    const channelTicks = Math.round(REVIVE_CHANNEL_SECONDS * TICK_RATE);
    for (let i = 0; i < channelTicks + 2; i++) sim.step();

    expect(mate.alive).toBe(true);
    expect(mate.poisonTicks).toBe(0);
    // If the poison had resumed, one more tick would gut a 50%-HP revive.
    sim.step();
    expect(mate.hp).toBeCloseTo(mate.maxHp * REVIVE_HP_FRACTION, 5);
  });
});
