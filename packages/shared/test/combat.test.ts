import { describe, expect, it } from 'vitest';
import {
  HEAL_AMOUNT,
  MELEE_COMBO_FINISHER_MULT,
  MELEE_DAMAGE,
  PLAYER_BASE_HP,
  PLAYER_SPEED,
  TICK_DT,
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

describe('Rime Arrow', () => {
  it('damages, slows, and splashes chill to nearby enemies', () => {
    const sim = makeSim([
      player(1, 0, 0, { loadout: loadout(['rimeArrow']) }),
      player(2, 10, 0),
      player(3, 10, 1.5), // inside splash radius of the impact
    ]);
    sim.applyInput(1, castCmd(0, 10, 0));
    for (let i = 0; i < 10; i++) sim.step();
    const def = ABILITIES.rimeArrow;
    const b = sim.players.get(2)!;
    expect(b.hp).toBeCloseTo(PLAYER_BASE_HP - def.damage, 5);
    expect(b.slowTicks).toBeGreaterThan(0);
    const c = sim.players.get(3)!;
    expect(c.hp).toBeCloseTo(PLAYER_BASE_HP - def.damage * def.splashMult!, 5);
    expect(c.slowTicks).toBeGreaterThan(0);
  });

  it('respects slot cooldown', () => {
    const sim = makeSim([player(1, 0, 0, { loadout: loadout(['rimeArrow']) }), player(2, 40, 40)]);
    let castEvents = 0;
    for (let i = 0; i < 5; i++) {
      sim.applyInput(1, castCmd(0, 10, 0));
      const snap = sim.step();
      castEvents += snap.events.filter((e) => e.type === 'cast').length;
    }
    expect(castEvents).toBe(1);
  });

  it('rank scales damage', () => {
    const sim = makeSim([
      player(1, 0, 0, { loadout: loadout(['rimeArrow'], [null, null], 'epic') }),
      player(2, 10, 0),
    ]);
    sim.applyInput(1, castCmd(0, 10, 0));
    for (let i = 0; i < 10; i++) sim.step();
    expect(sim.players.get(2)!.hp).toBeCloseTo(PLAYER_BASE_HP - ABILITIES.rimeArrow.damage * 2, 5);
  });

  it('barrel roll grants projectile immunity', () => {
    const sim = makeSim([
      player(1, 0, 0, { loadout: loadout(['rimeArrow']) }),
      player(2, 10, 0),
    ]);
    // Target faces the caster and rolls into the incoming arrow.
    sim.applyInput(1, castCmd(0, 10, 0));
    sim.applyInput(2, cmd({ yaw: -Math.PI / 2, buttons: PRESS_ROLL }));
    for (let i = 0; i < 20; i++) sim.step();
    expect(sim.players.get(2)!.hp).toBe(PLAYER_BASE_HP);
  });
});

describe('Star Bomb', () => {
  it('damages only after the telegraph, only inside the zone', () => {
    const sim = makeSim([
      player(1, 0, 0, { loadout: loadout(['starBomb']) }),
      player(2, 5, 0),
      player(3, 30, 30),
    ]);
    sim.applyInput(1, castCmd(0, 5, 0));
    const telegraphTicks = Math.round(ABILITIES.starBomb.telegraph! * TICK_RATE);
    for (let i = 0; i < telegraphTicks - 2; i++) sim.step();
    expect(sim.players.get(2)!.hp).toBe(PLAYER_BASE_HP);
    for (let i = 0; i < 4; i++) sim.step();
    expect(sim.players.get(2)!.hp).toBeCloseTo(PLAYER_BASE_HP - ABILITIES.starBomb.damage, 5);
    expect(sim.players.get(3)!.hp).toBe(PLAYER_BASE_HP);
  });
});

describe('Fire Whirl', () => {
  it('burns nearby enemies and speeds the caster up while active', () => {
    const sim = makeSim([
      player(1, 0, 0, { loadout: loadout(['fireWhirl']) }),
      player(2, 2, 0),
    ]);
    sim.applyInput(1, castCmd(0, 0, 0));
    sim.step();
    expect(sim.players.get(1)!.speedBuffTicks).toBeGreaterThan(0);
    for (let i = 0; i < 20; i++) sim.step(); // ~1s of aura
    const lost = PLAYER_BASE_HP - sim.players.get(2)!.hp;
    expect(lost).toBeGreaterThan(ABILITIES.fireWhirl.damage * 0.8);
    expect(lost).toBeLessThan(ABILITIES.fireWhirl.damage * 1.2);
  });
});

describe('Earthbreaker', () => {
  it('erupts around the caster and stuns whoever is caught', () => {
    const sim = makeSim([
      player(1, 0, 0, { loadout: loadout(['earthbreaker']) }),
      player(2, 3, 0),
      player(3, 30, 30),
    ]);
    sim.applyInput(1, castCmd(0, 50, 50)); // aim far — still centers on caster
    const telegraphTicks = Math.round(ABILITIES.earthbreaker.telegraph! * TICK_RATE);
    for (let i = 0; i < telegraphTicks + 2; i++) sim.step();
    const b = sim.players.get(2)!;
    expect(b.hp).toBeCloseTo(PLAYER_BASE_HP - ABILITIES.earthbreaker.damage, 5);
    expect(b.stunTicks).toBeGreaterThan(0);
    // Stunned: movement input does nothing.
    const xBefore = b.x;
    sim.applyInput(2, cmd({ moveX: 1 }));
    sim.step();
    expect(b.x).toBe(xBefore);
    expect(sim.players.get(3)!.hp).toBe(PLAYER_BASE_HP);
  });
});

describe('Mana Sphere', () => {
  it('damages and knocks the target back', () => {
    const sim = makeSim([
      player(1, 0, 0, { loadout: loadout(['manaSphere']) }),
      player(2, 8, 0),
    ]);
    sim.applyInput(1, castCmd(0, 8, 0));
    for (let i = 0; i < 12; i++) sim.step();
    const b = sim.players.get(2)!;
    expect(b.hp).toBeCloseTo(PLAYER_BASE_HP - ABILITIES.manaSphere.damage, 5);
    expect(b.x).toBeGreaterThan(9.5); // shoved away from the caster
  });
});

describe('Searing Axe', () => {
  it('hits in a front cone and knocks back; misses behind', () => {
    const sim = makeSim([
      player(1, 0, 0, { loadout: loadout(['searingAxe']) }),
      player(2, 3, 0), // in front (facing +x)
      player(3, -3, 0), // behind
    ]);
    sim.applyInput(1, cmd({ yaw: Math.PI / 2, slotCasts: [0] }));
    sim.step();
    const b = sim.players.get(2)!;
    expect(b.hp).toBeCloseTo(PLAYER_BASE_HP - ABILITIES.searingAxe.damage, 5);
    expect(sim.players.get(3)!.hp).toBe(PLAYER_BASE_HP);
    for (let i = 0; i < 5; i++) sim.step();
    expect(b.x).toBeGreaterThan(4); // knocked back
  });
});

describe('Toxic Smackerel', () => {
  it('poisons the target and smacks poisoned targets harder', () => {
    const sim = makeSim([
      player(1, 0, 0, { loadout: loadout(['toxicSmackerel']) }),
      player(2, 2.5, 0),
    ]);
    const def = ABILITIES.toxicSmackerel;
    sim.applyInput(1, cmd({ yaw: Math.PI / 2, slotCasts: [0] }));
    sim.step();
    const b = sim.players.get(2)!;
    expect(b.poisonTicks).toBeGreaterThan(0);
    const afterFirst = b.hp;
    // First smack plus the same-tick poison tick.
    expect(PLAYER_BASE_HP - afterFirst).toBeCloseTo(def.damage + def.poisonDps! * TICK_DT, 5);
    // Wait out the cooldown (poison keeps ticking), then smack again for bonus damage.
    const cdTicks = Math.round(def.cooldown * TICK_RATE);
    for (let i = 0; i < cdTicks - 1; i++) sim.step();
    const beforeSecond = b.hp;
    sim.applyInput(1, cmd({ yaw: Math.PI / 2, slotCasts: [0] }));
    sim.step();
    const secondHit = beforeSecond - b.hp - def.poisonDps! * TICK_DT; // minus that tick's poison
    expect(secondHit).toBeCloseTo(def.damage * def.poisonBonusMult!, 1);
  });
});

describe('Storm Archon', () => {
  it('unleashes a fan of bolts', () => {
    const sim = makeSim([player(1, 0, 0, { loadout: loadout(['stormArchon']) }), player(2, 40, 40)]);
    sim.applyInput(1, castCmd(0, 10, 0));
    const snap = sim.step();
    expect(snap.projectiles).toHaveLength(ABILITIES.stormArchon.volley!);
  });
});

describe('Holy Shield', () => {
  it('pierces through, returns to the caster, and hits each enemy once', () => {
    const sim = makeSim([
      player(1, 0, 0, { loadout: loadout(['holyShield']) }),
      player(2, 8, 0),
    ]);
    sim.applyInput(1, castCmd(0, 8, 0));
    let snap = sim.step();
    for (let i = 0; i < 60; i++) snap = sim.step();
    expect(sim.players.get(2)!.hp).toBeCloseTo(PLAYER_BASE_HP - ABILITIES.holyShield.damage, 5);
    expect(snap.projectiles).toHaveLength(0); // caught by the owner
  });
});

describe('Slicing Winds', () => {
  it('dashes forward, slicing enemies passed through', () => {
    const sim = makeSim([
      player(1, 0, 0, { loadout: loadout(['slicingWinds']) }),
      player(2, 5, 0),
    ]);
    sim.applyInput(1, cmd({ moveX: 1, slotCasts: [0] }));
    for (let i = 0; i < 10; i++) sim.step();
    expect(sim.players.get(1)!.x).toBeGreaterThan(ABILITIES.slicingWinds.leapRange! - 2);
    expect(sim.players.get(2)!.hp).toBeCloseTo(PLAYER_BASE_HP - ABILITIES.slicingWinds.damage, 5);
  });
});

describe('Quaking Leap', () => {
  it('crashes down, damaging and stunning enemies at the landing point', () => {
    const sim = makeSim([
      player(1, 0, 0, { loadout: loadout([null, null], ['quakingLeap']) }),
      player(2, 10, 0),
    ]);
    sim.applyInput(1, cmd({ moveX: 1, slotCasts: [2] }));
    for (let i = 0; i < 12; i++) sim.step();
    const b = sim.players.get(2)!;
    expect(b.hp).toBeCloseTo(PLAYER_BASE_HP - ABILITIES.quakingLeap.damage, 5);
    expect(b.stunTicks).toBeGreaterThan(0);
  });
});

describe("Hunter's Chains", () => {
  it('pulls the struck enemy to the caster and roots them', () => {
    const sim = makeSim([
      player(1, 0, 0, { loadout: loadout([null, null], ['huntersChains']) }),
      player(2, 10, 0),
    ]);
    sim.applyInput(1, castCmd(2, 10, 0));
    for (let i = 0; i < 10; i++) sim.step();
    const b = sim.players.get(2)!;
    expect(b.x).toBeCloseTo(1.5, 1);
    expect(b.rootTicks).toBeGreaterThan(0);
    expect(b.hp).toBeCloseTo(PLAYER_BASE_HP - ABILITIES.huntersChains.damage, 5);
  });
});

describe('Steel Traps', () => {
  it('roots and damages the enemy who springs a trap', () => {
    const sim = makeSim([
      player(1, 0, 0, { loadout: loadout([null, null], ['steelTraps']) }),
      player(2, 3, 0), // standing right where the middle trap lands
    ]);
    sim.applyInput(1, cmd({ yaw: Math.PI / 2, slotCasts: [2] })); // facing +x
    sim.step();
    const b = sim.players.get(2)!;
    expect(b.hp).toBeCloseTo(PLAYER_BASE_HP - ABILITIES.steelTraps.damage, 5);
    expect(b.rootTicks).toBeGreaterThan(0);
  });
});

describe('Windstorm', () => {
  it('stuns the first enemy struck', () => {
    const sim = makeSim([
      player(1, 0, 0, { loadout: loadout([null, null], ['windstorm']) }),
      player(2, 8, 0),
    ]);
    sim.applyInput(1, castCmd(2, 8, 0));
    for (let i = 0; i < 12; i++) sim.step();
    const b = sim.players.get(2)!;
    expect(b.hp).toBeCloseTo(PLAYER_BASE_HP - ABILITIES.windstorm.damage, 5);
    expect(b.stunTicks).toBeGreaterThan(0);
  });
});

describe('Explosive Caltrops', () => {
  it('hops the caster backward and leaves a slowing, burning patch', () => {
    const sim = makeSim([
      player(1, 0, 0, { loadout: loadout([null, null], ['explosiveCaltrops']) }),
      player(2, 1.5, 0), // standing in the caltrop patch
    ]);
    sim.applyInput(1, cmd({ moveX: 1, slotCasts: [2] })); // moving +x → hops to -x
    for (let i = 0; i < 7; i++) sim.step();
    expect(sim.players.get(1)!.x).toBeLessThan(-3); // right after the hop
    sim.applyInput(1, cmd({})); // stop steering
    for (let i = 0; i < 15; i++) sim.step();
    const b = sim.players.get(2)!;
    expect(b.hp).toBeLessThan(PLAYER_BASE_HP);
    expect(b.slowTicks).toBeGreaterThan(0);
  });
});

describe('Snowdrift', () => {
  it('leaves a blizzard that chills enemies inside', () => {
    const sim = makeSim([
      player(1, 0, 0, { loadout: loadout([null, null], ['snowdrift']) }),
      player(2, 2.5, 0),
    ]);
    sim.applyInput(1, castCmd(2, 0, 0));
    for (let i = 0; i < 30; i++) sim.step();
    const b = sim.players.get(2)!;
    expect(b.slowTicks).toBeGreaterThan(0);
    expect(b.hp).toBeLessThan(PLAYER_BASE_HP);
  });
});

describe('Lightning Bulwark', () => {
  it('absorbs incoming damage before health', () => {
    const sim = makeSim([
      player(1, 0, 0, { loadout: loadout([null, null], ['lightningBulwark']) }),
      player(2, 10, 0, { loadout: loadout(['rimeArrow']) }),
    ]);
    sim.applyInput(1, castCmd(2, 0, 0));
    sim.step();
    sim.applyInput(2, castCmd(0, 0, 0));
    for (let i = 0; i < 10; i++) sim.step();
    const a = sim.players.get(1)!;
    expect(a.hp).toBe(PLAYER_BASE_HP);
    expect(a.shieldHp).toBeCloseTo(
      ABILITIES.lightningBulwark.shieldAmount! - ABILITIES.rimeArrow.damage,
      5,
    );
  });
});

describe('Fade to Shadow', () => {
  it('teleports in the move direction and grants stealth', () => {
    const sim = makeSim([
      player(1, 0, 0, { loadout: loadout([null, null], ['fadeToShadow']) }),
      player(2, 40, 40),
    ]);
    sim.applyInput(1, cmd({ moveX: 1, slotCasts: [2] }));
    sim.step();
    const a = sim.players.get(1)!;
    expect(a.x).toBeGreaterThan(ABILITIES.fadeToShadow.leapRange! - 1);
    expect(a.stealthTicks).toBeGreaterThan(0);
  });

  it('attacking breaks stealth', () => {
    const sim = makeSim([
      player(1, 0, 0, { loadout: loadout([null, null], ['fadeToShadow']) }),
      player(2, 40, 40),
    ]);
    sim.applyInput(1, cmd({ slotCasts: [2] }));
    sim.step();
    expect(sim.players.get(1)!.stealthTicks).toBeGreaterThan(0);
    sim.applyInput(1, cmd({ buttons: HOLD_MELEE }));
    sim.step();
    expect(sim.players.get(1)!.stealthTicks).toBe(0);
  });
});

describe('Repel', () => {
  it('makes the caster immune to damage while active', () => {
    const sim = makeSim([
      player(1, 0, 0, { loadout: loadout([null, null], ['repel']) }),
      player(2, 2, 0),
    ]);
    sim.applyInput(1, castCmd(2, 0, 0));
    sim.applyInput(2, cmd({ yaw: -Math.PI / 2, buttons: HOLD_MELEE }));
    for (let i = 0; i < 10; i++) sim.step(); // repel lasts 1.5s > these 0.5s
    expect(sim.players.get(1)!.hp).toBe(PLAYER_BASE_HP);
  });
});

describe('Faeform', () => {
  it('reduces damage taken and prevents attacking', () => {
    const sim = makeSim([
      player(1, 0, 0, { loadout: loadout([null, null], ['faeform']) }),
      player(2, 2, 0),
    ]);
    sim.applyInput(1, cmd({ yaw: Math.PI / 2, slotCasts: [2] }));
    sim.step(); // transform first
    sim.applyInput(1, cmd({ yaw: Math.PI / 2, buttons: HOLD_MELEE }));
    sim.applyInput(2, cmd({ yaw: -Math.PI / 2, buttons: HOLD_MELEE }));
    sim.step();
    // Fae caster cannot attack…
    expect(sim.players.get(2)!.hp).toBe(PLAYER_BASE_HP);
    // …and takes reduced damage from the enemy swing.
    expect(sim.players.get(1)!.hp).toBeCloseTo(PLAYER_BASE_HP - MELEE_DAMAGE * 0.4, 5);
  });
});
