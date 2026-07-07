import { describe, expect, it } from 'vitest';
import {
  HEAL_AMOUNT,
  MELEE_COMBO_FINISHER_MULT,
  MELEE_DAMAGE,
  PLAYER_BASE_HP,
  TICK_RATE,
} from '../src/constants.js';
import { ABILITIES } from '../src/sim/abilities.js';
import { castCmd, cmd, loadout, makeSim, player } from './helpers.js';

const HOLD_MELEE = { melee: true, roll: false, jump: false, interact: false, heal: false };
const PRESS_ROLL = { melee: false, roll: true, jump: false, interact: false, heal: false };
const PRESS_HEAL = { melee: false, roll: false, jump: false, interact: false, heal: true };

describe('melee', () => {
  it('sword swing damages a target in the front arc', () => {
    const sim = makeSim([player(1, 0, 0), player(2, 2, 0)]);
    sim.applyInput(1, cmd({ yaw: Math.PI / 2, buttons: HOLD_MELEE }));
    sim.step();
    expect(sim.players.get(2)!.hp).toBeCloseTo(PLAYER_BASE_HP - MELEE_DAMAGE, 5);
  });

  it('does not hit targets behind the attacker', () => {
    const sim = makeSim([player(1, 0, 0), player(2, -2, 0)]);
    sim.applyInput(1, cmd({ yaw: Math.PI / 2, buttons: HOLD_MELEE })); // facing +x, target at -x
    sim.step();
    expect(sim.players.get(2)!.hp).toBe(PLAYER_BASE_HP);
  });

  it('third combo hit is a finisher', () => {
    const sim = makeSim([player(1, 0, 0), player(2, 2, 0)]);
    sim.applyInput(1, cmd({ yaw: Math.PI / 2, buttons: HOLD_MELEE }));
    for (let i = 0; i < 24; i++) sim.step(); // three swings at 0.55s interval
    const expected = PLAYER_BASE_HP - MELEE_DAMAGE * (2 + MELEE_COMBO_FINISHER_MULT);
    expect(sim.players.get(2)!.hp).toBeCloseTo(expected, 5);
  });
});

describe('builtin heal', () => {
  it('restores health up to max and starts its cooldown', () => {
    const sim = makeSim([player(1, 0, 0), player(2, 40, 40)]);
    const p = sim.players.get(1)!;
    p.hp = 30;
    sim.applyInput(1, cmd({ buttons: PRESS_HEAL }));
    const snap = sim.step();
    expect(p.hp).toBe(30 + HEAL_AMOUNT);
    expect(snap.players.find((s) => s.id === 1)!.healCd).toBeGreaterThan(0);
    expect(snap.events.some((e) => e.type === 'heal' && e.playerId === 1)).toBe(true);
  });

  it('does not overheal past max health', () => {
    const sim = makeSim([player(1, 0, 0), player(2, 40, 40)]);
    const p = sim.players.get(1)!;
    p.hp = p.maxHp - 5;
    sim.applyInput(1, cmd({ buttons: PRESS_HEAL }));
    sim.step();
    expect(p.hp).toBe(p.maxHp);
  });

  it('is gated by cooldown and does nothing at full health', () => {
    const sim = makeSim([player(1, 0, 0), player(2, 40, 40)]);
    const p = sim.players.get(1)!;
    sim.applyInput(1, cmd({ buttons: PRESS_HEAL }));
    sim.step();
    expect(p.healCdTicks).toBe(0); // full hp: not consumed
    p.hp = 20;
    sim.applyInput(1, cmd({ buttons: PRESS_HEAL }));
    sim.step();
    expect(p.hp).toBe(20 + HEAL_AMOUNT);
    sim.applyInput(1, cmd({ buttons: PRESS_HEAL }));
    sim.step();
    expect(p.hp).toBe(20 + HEAL_AMOUNT); // still on cooldown
  });
});

describe('frost arrow', () => {
  it('travels, damages, and slows the target', () => {
    const sim = makeSim([
      player(1, 0, 0, { loadout: loadout(['frostArrow']) }),
      player(2, 10, 0),
    ]);
    sim.applyInput(1, castCmd(0, 10, 0));
    for (let i = 0; i < 10; i++) sim.step();
    const b = sim.players.get(2)!;
    expect(b.hp).toBeCloseTo(PLAYER_BASE_HP - ABILITIES.frostArrow.damage, 5);
    expect(b.slowTicks).toBeGreaterThan(0);
  });

  it('respects slot cooldown', () => {
    const sim = makeSim([player(1, 0, 0, { loadout: loadout(['frostArrow']) }), player(2, 40, 40)]);
    let castEvents = 0;
    for (let i = 0; i < 5; i++) {
      sim.applyInput(1, castCmd(0, 10, 0));
      const snap = sim.step();
      castEvents += snap.events.filter((e) => e.type === 'cast').length;
    }
    expect(castEvents).toBe(1);
  });

  it('rarity scales damage', () => {
    const sim = makeSim([
      player(1, 0, 0, { loadout: loadout(['frostArrow'], [null], 'epic') }),
      player(2, 10, 0),
    ]);
    sim.applyInput(1, castCmd(0, 10, 0));
    for (let i = 0; i < 10; i++) sim.step();
    expect(sim.players.get(2)!.hp).toBeCloseTo(PLAYER_BASE_HP - ABILITIES.frostArrow.damage * 2, 5);
  });

  it('barrel roll grants projectile immunity', () => {
    const sim = makeSim([
      player(1, 0, 0, { loadout: loadout(['frostArrow']) }),
      player(2, 10, 0),
    ]);
    // Target faces the caster and rolls into the incoming arrow.
    sim.applyInput(1, castCmd(0, 10, 0));
    sim.applyInput(2, cmd({ yaw: -Math.PI / 2, buttons: PRESS_ROLL }));
    for (let i = 0; i < 20; i++) sim.step();
    expect(sim.players.get(2)!.hp).toBe(PLAYER_BASE_HP);
  });
});

describe('storm call', () => {
  it('damages only after the telegraph, only inside the zone', () => {
    const sim = makeSim([
      player(1, 0, 0, { loadout: loadout(['stormCall']) }),
      player(2, 5, 0),
      player(3, 30, 30),
    ]);
    sim.applyInput(1, castCmd(0, 5, 0));
    const telegraphTicks = Math.round(ABILITIES.stormCall.telegraph! * TICK_RATE);
    for (let i = 0; i < telegraphTicks - 2; i++) sim.step();
    expect(sim.players.get(2)!.hp).toBe(PLAYER_BASE_HP);
    for (let i = 0; i < 4; i++) sim.step();
    expect(sim.players.get(2)!.hp).toBeCloseTo(PLAYER_BASE_HP - ABILITIES.stormCall.damage, 5);
    expect(sim.players.get(3)!.hp).toBe(PLAYER_BASE_HP);
  });
});

describe('flame cyclone', () => {
  it('ticks damage on nearby enemies while active', () => {
    const sim = makeSim([
      player(1, 0, 0, { loadout: loadout(['flameCyclone']) }),
      player(2, 2, 0),
    ]);
    sim.applyInput(1, castCmd(0, 0, 0));
    for (let i = 0; i < 21; i++) sim.step(); // cast + ~1s of aura
    const lost = PLAYER_BASE_HP - sim.players.get(2)!.hp;
    expect(lost).toBeGreaterThan(ABILITIES.flameCyclone.damage * 0.8);
    expect(lost).toBeLessThan(ABILITIES.flameCyclone.damage * 1.2);
  });
});

describe('venom orb', () => {
  it('leaves a damaging pool where it lands', () => {
    const sim = makeSim([
      player(1, 0, 0, { loadout: loadout(['venomOrb']) }),
      player(2, 17, 2), // beside the impact point, inside the pool
    ]);
    sim.applyInput(1, castCmd(0, 20, 0));
    const flightTicks = Math.round(ABILITIES.venomOrb.projectileLifetime! * TICK_RATE);
    for (let i = 0; i < flightTicks + 20; i++) sim.step(); // pool ticks for ~1s
    const lost = PLAYER_BASE_HP - sim.players.get(2)!.hp;
    expect(lost).toBeGreaterThan(ABILITIES.venomOrb.poolDps! * 0.8);
    expect(lost).toBeLessThan(ABILITIES.venomOrb.poolDps! * 1.3);
  });
});

describe('grasping chains', () => {
  it('pulls the struck enemy to the caster and roots them', () => {
    const sim = makeSim([
      player(1, 0, 0, { loadout: loadout([null, null], ['graspingChains']) }),
      player(2, 10, 0),
    ]);
    sim.applyInput(1, castCmd(2, 10, 0));
    for (let i = 0; i < 10; i++) sim.step();
    const b = sim.players.get(2)!;
    expect(b.x).toBeCloseTo(1.5, 1);
    expect(b.rootTicks).toBeGreaterThan(0);
    expect(b.hp).toBeCloseTo(PLAYER_BASE_HP - ABILITIES.graspingChains.damage, 5);
  });
});

describe('gust leap', () => {
  it('leaps forward and knocks back enemies at the landing point', () => {
    const sim = makeSim([
      player(1, 0, 0, { loadout: loadout([null, null], ['gustLeap']) }),
      player(2, 10, 0),
    ]);
    sim.applyInput(1, cmd({ moveX: 1, slotCasts: [2] }));
    for (let i = 0; i < 20; i++) sim.step();
    const a = sim.players.get(1)!;
    const b = sim.players.get(2)!;
    expect(a.x).toBeGreaterThan(9);
    expect(b.x).toBeGreaterThan(13); // knocked away
    expect(b.hp).toBeCloseTo(PLAYER_BASE_HP - ABILITIES.gustLeap.damage, 5);
  });
});

describe('frost nova', () => {
  it('erupts around the caster regardless of aim, damaging and rooting', () => {
    const sim = makeSim([
      player(1, 0, 0, { loadout: loadout(['frostNova']) }),
      player(2, 3, 0), // inside the nova
      player(3, 30, 30), // far away
    ]);
    sim.applyInput(1, castCmd(0, 50, 50)); // aim far — nova still centers on caster
    const telegraphTicks = Math.round(ABILITIES.frostNova.telegraph! * TICK_RATE);
    for (let i = 0; i < telegraphTicks + 2; i++) sim.step();
    const b = sim.players.get(2)!;
    expect(b.hp).toBeCloseTo(PLAYER_BASE_HP - ABILITIES.frostNova.damage, 5);
    expect(b.rootTicks).toBeGreaterThan(0);
    expect(sim.players.get(3)!.hp).toBe(PLAYER_BASE_HP);
  });
});

describe('shadow lance', () => {
  it('deals heavy single-target damage', () => {
    const sim = makeSim([
      player(1, 0, 0, { loadout: loadout(['shadowLance']) }),
      player(2, 12, 0),
    ]);
    sim.applyInput(1, castCmd(0, 12, 0));
    for (let i = 0; i < 12; i++) sim.step();
    expect(sim.players.get(2)!.hp).toBeCloseTo(PLAYER_BASE_HP - ABILITIES.shadowLance.damage, 5);
  });
});

describe('wind rush', () => {
  it('dashes the caster forward without damaging anyone', () => {
    const sim = makeSim([
      player(1, 0, 0, { loadout: loadout([null, null], ['windRush']) }),
      player(2, 12, 0),
    ]);
    sim.applyInput(1, cmd({ moveX: 1, slotCasts: [2] }));
    for (let i = 0; i < 12; i++) sim.step();
    expect(sim.players.get(1)!.x).toBeGreaterThan(ABILITIES.windRush.leapRange! - 1);
    expect(sim.players.get(2)!.hp).toBe(PLAYER_BASE_HP);
  });
});

describe('stone shield', () => {
  it('absorbs incoming damage before health', () => {
    const sim = makeSim([
      player(1, 0, 0, { loadout: loadout([null, null], ['stoneShield']) }),
      player(2, 10, 0, { loadout: loadout(['frostArrow']) }),
    ]);
    sim.applyInput(1, castCmd(2, 0, 0));
    sim.step();
    sim.applyInput(2, castCmd(0, 0, 0));
    for (let i = 0; i < 10; i++) sim.step();
    const a = sim.players.get(1)!;
    expect(a.hp).toBe(PLAYER_BASE_HP);
    expect(a.shieldHp).toBeCloseTo(
      ABILITIES.stoneShield.shieldAmount! - ABILITIES.frostArrow.damage,
      5,
    );
  });
});
