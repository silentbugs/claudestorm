import { describe, expect, it } from 'vitest';
import {
  CHEST_CHANNEL_SECONDS,
  ELITE_HP,
  PLAYER_BASE_HP,
  LEVEL_HP_BONUS,
  TICK_RATE,
  XP_PER_CHEST,
  XP_PER_ELITE,
} from '../src/constants.js';
import { cmd, loadout, makeSim, player, FLAT_MAP } from './helpers.js';

const PRESS_INTERACT = { melee: false, roll: false, jump: false, interact: true, heal: false };
const HOLD_MELEE = { melee: true, roll: false, jump: false, interact: false, heal: false };

describe('chests', () => {
  it('opens after channeling and spawns loot', () => {
    const map = { ...FLAT_MAP, chests: [{ x: 2, z: 0 }] };
    // Full loadout so spawned scrolls are not auto-equipped before we count them.
    const full = loadout(['rimeArrow', 'starBomb'], ['quakingLeap']);
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

describe('ability rank-ups', () => {
  it('picking up a duplicate scroll upgrades the equipped rank', () => {
    const map = { ...FLAT_MAP, scrolls: [{ x: 1, z: 0 }] };
    const sim = makeSim([player(1, 0, 0, { loadout: loadout(['rimeArrow']) })], { map });
    // Force the world scroll to be a common duplicate of the equipped ability.
    const scroll = [...sim.scrolls.values()][0]!;
    scroll.abilityId = 'rimeArrow';
    scroll.rarity = 'common';
    const snap = sim.step(); // auto-pickup range
    expect(snap.scrolls).toHaveLength(0);
    expect(snap.events.some((e) => e.type === 'upgrade')).toBe(true);
    expect(sim.players.get(1)!.slots.offense[0]!.rarity).toBe('uncommon');
  });

  it('a higher-rarity duplicate jumps straight to its rank; epic caps and leaves the scroll', () => {
    const map = { ...FLAT_MAP, scrolls: [{ x: 1, z: 0 }] };
    const sim = makeSim([player(1, 0, 0, { loadout: loadout(['rimeArrow']) })], { map });
    const scroll = [...sim.scrolls.values()][0]!;
    scroll.abilityId = 'rimeArrow';
    scroll.rarity = 'epic';
    sim.step();
    expect(sim.players.get(1)!.slots.offense[0]!.rarity).toBe('epic');
    // Second epic duplicate: nothing to gain, scroll stays on the ground.
    const map2 = { ...FLAT_MAP, scrolls: [{ x: 1, z: 0 }] };
    const sim2 = makeSim([player(1, 0, 0, { loadout: loadout(['rimeArrow'], [null, null], 'epic') })], { map: map2 });
    const scroll2 = [...sim2.scrolls.values()][0]!;
    scroll2.abilityId = 'rimeArrow';
    scroll2.rarity = 'common';
    const snap2 = sim2.step();
    expect(snap2.scrolls).toHaveLength(1);
    expect(sim2.players.get(1)!.slots.offense[0]!.rarity).toBe('epic');
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

  it('elites always drop a rare-or-better skill scroll and extra coins', () => {
    const full = loadout(['rimeArrow', 'starBomb'], ['quakingLeap']); // block auto-equip
    const map = { ...FLAT_MAP, elites: [{ x: 2, z: 0 }] };
    const sim = makeSim([player(1, 0, 0, { loadout: full })], { map });
    const elite = [...sim.mobs.values()][0]!;
    expect(elite.elite).toBe(true);
    expect(elite.maxHp).toBe(ELITE_HP);
    elite.hp = 1; // skip the grind; the drop is what's under test
    sim.applyInput(1, cmd({ yaw: Math.PI / 2, buttons: HOLD_MELEE }));
    let snap = sim.step();
    expect(snap.events.some((e) => e.type === 'mobDeath' && e.elite)).toBe(true);
    expect(snap.scrolls).toHaveLength(1);
    expect(['rare', 'epic']).toContain(snap.scrolls[0]!.rarity);
    for (let i = 0; i < TICK_RATE; i++) snap = sim.step(); // collect coins
    expect(sim.players.get(1)!.plunder).toBeGreaterThanOrEqual(4);
    expect(sim.players.get(1)!.xp).toBeGreaterThanOrEqual(XP_PER_ELITE);
  });

  it('mobs aggro and bite a player in range', () => {
    const map = { ...FLAT_MAP, mobs: [{ x: 5, z: 0 }] };
    const sim = makeSim([player(1, 0, 0)], { map });
    for (let i = 0; i < TICK_RATE * 3; i++) sim.step();
    expect(sim.players.get(1)!.hp).toBeLessThan(PLAYER_BASE_HP);
  });
});
