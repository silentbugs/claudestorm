import { describe, expect, it } from 'vitest';
import {
  CHEST_CHANNEL_SECONDS,
  PLAYER_BASE_HP,
  LEVEL_HP_BONUS,
  TICK_RATE,
  XP_PER_CHEST,
} from '../src/constants.js';
import { cmd, loadout, makeSim, player, FLAT_MAP } from './helpers.js';

const PRESS_INTERACT = { melee: false, roll: false, jump: false, interact: true, heal: false };
const HOLD_MELEE = { melee: true, roll: false, jump: false, interact: false, heal: false };

describe('chests', () => {
  it('opens after channeling and spawns loot', () => {
    const map = { ...FLAT_MAP, chests: [{ x: 2, z: 0 }] };
    // Full loadout so spawned scrolls are not auto-equipped before we count them.
    const full = loadout(['frostArrow', 'stormCall'], ['gustLeap']);
    const sim = makeSim([player(1, 0, 0, { loadout: full })], { map });
    sim.applyInput(1, cmd({ buttons: PRESS_INTERACT }));
    const channelTicks = Math.round(CHEST_CHANNEL_SECONDS * TICK_RATE);
    let snap = sim.step();
    expect(snap.players[0]!.channeling).toBeGreaterThanOrEqual(0);
    for (let i = 0; i < channelTicks + 2; i++) snap = sim.step();
    expect(snap.chests[0]!.opened).toBe(true);
    expect(snap.scrolls.length).toBeGreaterThanOrEqual(1);
    expect(sim.players.get(1)!.xp).toBeGreaterThanOrEqual(XP_PER_CHEST);
    // Coins spawned; some may already be auto-collected.
    expect(snap.coins.length + sim.players.get(1)!.plunder).toBeGreaterThanOrEqual(4);
  });

  it('channel is cancelled by moving', () => {
    const map = { ...FLAT_MAP, chests: [{ x: 2, z: 0 }] };
    const sim = makeSim([player(1, 0, 0)], { map });
    sim.applyInput(1, cmd({ buttons: PRESS_INTERACT }));
    sim.step();
    sim.applyInput(1, cmd({ moveX: 1 }));
    let snap = sim.step();
    expect(snap.players[0]!.channeling).toBe(-1);
    for (let i = 0; i < 40; i++) snap = sim.step();
    expect(snap.chests[0]!.opened).toBe(false);
  });
});

describe('scrolls', () => {
  it('auto-equips into an empty slot when walked over', () => {
    const map = { ...FLAT_MAP, scrolls: [{ x: 1, z: 0 }] };
    const sim = makeSim([player(1, 0, 0)], { map });
    const snap = sim.step();
    expect(snap.scrolls).toHaveLength(0);
    const slots = snap.players[0]!.slots;
    const equippedCount =
      slots.offense.filter(Boolean).length + slots.utility.filter(Boolean).length;
    expect(equippedCount).toBe(1);
    expect(snap.events.some((e) => e.type === 'equip')).toBe(true);
  });
});

describe('mobs and leveling', () => {
  it('killing a mob drops coins and levels the killer up', () => {
    const map = { ...FLAT_MAP, mobs: [{ x: 2, z: 0 }] };
    const sim = makeSim([player(1, 0, 0)], { map });
    sim.applyInput(1, cmd({ yaw: Math.PI / 2, buttons: HOLD_MELEE }));
    let mobDied = false;
    for (let i = 0; i < TICK_RATE * 6 && !mobDied; i++) {
      const snap = sim.step();
      if (snap.events.some((e) => e.type === 'mobDeath')) mobDied = true;
    }
    expect(mobDied).toBe(true);
    for (let i = 0; i < TICK_RATE; i++) sim.step(); // walk-over pickup radius collects coins
    const p = sim.players.get(1)!;
    expect(p.level).toBeGreaterThanOrEqual(2); // 30 mob XP + coin XP crosses 40
    expect(p.maxHp).toBe(PLAYER_BASE_HP + LEVEL_HP_BONUS * (p.level - 1));
    expect(p.plunder).toBeGreaterThanOrEqual(3);
  });

  it('mobs aggro and bite a player in range', () => {
    const map = { ...FLAT_MAP, mobs: [{ x: 5, z: 0 }] };
    const sim = makeSim([player(1, 0, 0)], { map });
    for (let i = 0; i < TICK_RATE * 3; i++) sim.step();
    expect(sim.players.get(1)!.hp).toBeLessThan(PLAYER_BASE_HP);
  });
});
