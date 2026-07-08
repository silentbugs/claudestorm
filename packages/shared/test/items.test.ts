import { describe, expect, it } from 'vitest';
import { PLAYER_BASE_HP, TICK_RATE } from '../src/constants.js';
import { CHICKEN_HEAL_TOTAL, LAUNCHER_RANGE, SKIES_LAUNCH_HEIGHT } from '../src/sim/items.js';
import { buttons, cmd, makeSim, player, FLAT_MAP } from './helpers.js';

const USE_ITEM = buttons({ useItem: true });

describe('consumable items', () => {
  it('auto-picks up an item into the empty item slot, one at a time', () => {
    const map = { ...FLAT_MAP, items: [{ x: 1, z: 0 }, { x: 1.2, z: 0 }] };
    const sim = makeSim([player(1, 0, 0)], { map });
    const snap = sim.step();
    expect(snap.players[0]!.item).not.toBeNull();
    expect(snap.items).toHaveLength(1); // second item stays — hands full
    expect(snap.events.some((e) => e.type === 'itemPickup')).toBe(true);
  });

  it('Chicken Coup heals over time when used', () => {
    const sim = makeSim([player(1, 0, 0)]);
    const p = sim.players.get(1)!;
    p.item = 'chickenCoup';
    p.hp = 30;
    sim.applyInput(1, cmd({ buttons: USE_ITEM }));
    sim.step();
    expect(sim.step().players[0]!.item).toBeNull(); // consumed
    for (let i = 0; i < TICK_RATE * 7; i++) sim.step();
    expect(p.hp).toBeCloseTo(Math.min(PLAYER_BASE_HP, 30 + CHICKEN_HEAL_TOTAL), 1);
  });

  it('Gravity Launcher hurls the user across the map', () => {
    const sim = makeSim([player(1, 0, 0)]);
    const p = sim.players.get(1)!;
    p.item = 'gravityLauncher';
    sim.applyInput(1, cmd({ moveX: 1, buttons: USE_ITEM }));
    for (let i = 0; i < 16; i++) sim.step();
    expect(p.x).toBeGreaterThan(LAUNCHER_RANGE - 2);
  });

  it('Mechano-Hog grants a speed burst', () => {
    const sim = makeSim([player(1, 0, 0)]);
    const p = sim.players.get(1)!;
    p.item = 'mechanoHog';
    sim.applyInput(1, cmd({ moveX: 1, buttons: USE_ITEM }));
    sim.step();
    expect(p.speedBuffTicks).toBeGreaterThan(0);
    expect(p.speedBuffMult).toBeGreaterThan(1);
  });

  it('To the Skies! rockets the user up into a glide', () => {
    const sim = makeSim([player(1, 0, 0)]);
    const p = sim.players.get(1)!;
    p.item = 'toTheSkies';
    sim.applyInput(1, cmd({ buttons: USE_ITEM }));
    sim.step();
    expect(p.gliding).toBe(true);
    expect(p.y).toBeGreaterThan(SKIES_LAUNCH_HEIGHT - 1); // minus one tick of glide descent
    // Steer while gliding, land eventually.
    sim.applyInput(1, cmd({ moveX: 1 }));
    for (let i = 0; i < TICK_RATE * 10 && p.gliding; i++) sim.step();
    expect(p.gliding).toBe(false);
    expect(p.x).toBeGreaterThan(5);
  });

  it('Smoke Bomb grants stealth', () => {
    const sim = makeSim([player(1, 0, 0)]);
    const p = sim.players.get(1)!;
    p.item = 'smokeBomb';
    sim.applyInput(1, cmd({ buttons: USE_ITEM }));
    const snap = sim.step();
    expect(snap.players[0]!.stealthed).toBe(true);
  });
});
