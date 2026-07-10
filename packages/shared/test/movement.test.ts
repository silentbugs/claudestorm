import { describe, expect, it } from 'vitest';
import { JUMP_VELOCITY, LAKE_WADE_FACTOR, PLAYER_RADIUS, PLAYER_SPEED, TICK_RATE } from '../src/constants.js';
import { coastRadius, type MapDef } from '../src/maps/arena.js';
import { buttons, cmd, makeSim, player, FLAT_MAP } from './helpers.js';

describe('movement', () => {
  it('moves at PLAYER_SPEED', () => {
    const sim = makeSim([player(1, 0, 0)]);
    sim.applyInput(1, cmd({ moveX: 1 }));
    for (let i = 0; i < TICK_RATE; i++) sim.step();
    const p = sim.players.get(1)!;
    expect(p.x).toBeCloseTo(PLAYER_SPEED, 5);
    expect(p.z).toBeCloseTo(0, 5);
  });

  it('clamps to arena bounds', () => {
    const sim = makeSim([player(1, 48, 0)]);
    sim.applyInput(1, cmd({ moveX: 1 }));
    for (let i = 0; i < TICK_RATE * 2; i++) sim.step();
    expect(sim.players.get(1)!.x).toBeCloseTo(50 - PLAYER_RADIUS, 5);
  });

  it('clamps to the coastline on island maps', () => {
    const map: MapDef = { ...FLAT_MAP, coastR: 40 };
    const sim = makeSim([player(1, 0, 0)], { map });
    sim.applyInput(1, cmd({ moveX: 1 }));
    for (let i = 0; i < TICK_RATE * 7; i++) sim.step();
    // Walking due east (+x): held at the sea's edge, not the square bound.
    expect(sim.players.get(1)!.x).toBeCloseTo(coastRadius(40, Math.PI / 2) - PLAYER_RADIUS, 5);
    expect(sim.players.get(1)!.z).toBeCloseTo(0, 5);
  });

  it('is pushed out of box obstacles', () => {
    const map: MapDef = {
      ...FLAT_MAP,
      obstacles: [{ kind: 'box', x: 5, z: 0, hx: 1, hz: 1, height: 3 }],
    };
    const sim = makeSim([player(1, 0, 0)], { map });
    sim.applyInput(1, cmd({ moveX: 1 }));
    for (let i = 0; i < TICK_RATE * 3; i++) sim.step();
    expect(sim.players.get(1)!.x).toBeCloseTo(5 - 1 - PLAYER_RADIUS, 3);
  });

  it('wades slowly through lakes', () => {
    const map: MapDef = { ...FLAT_MAP, lakes: [{ x: 0, z: 0, r: 30 }] };
    const sim = makeSim([player(1, 0, 0)], { map });
    sim.applyInput(1, cmd({ moveX: 1 }));
    for (let i = 0; i < TICK_RATE; i++) sim.step();
    expect(sim.players.get(1)!.x).toBeCloseTo(PLAYER_SPEED * LAKE_WADE_FACTOR, 5);
  });

  it('climbs slowly out of a pit, except on the ramp', () => {
    // Pit rim band spans r*0.45..r = 13.5..30; the ramp faces +x.
    const map: MapDef = {
      ...FLAT_MAP,
      pits: [{ x: 0, z: 0, r: 30, rampAngle: Math.PI / 2, rampHalfAngle: 0.45 }],
    };
    const run = (moveX: number, moveZ: number): { x: number; z: number } => {
      const sim = makeSim([player(1, 0, 0)], { map });
      sim.applyInput(1, cmd({ moveX, moveZ }));
      for (let i = 0; i < TICK_RATE * 3; i++) sim.step();
      return sim.players.get(1)!;
    };
    // Walking into the wall (-z: off the ramp): full speed across the floor,
    // then a crawl through the rim band — well short of a free 24m walk.
    const wall = run(0, -1);
    expect(-wall.z).toBeGreaterThan(13.5);
    expect(-wall.z).toBeLessThan(20);
    // Taking the ramp (+x) climbs out at full speed.
    expect(run(1, 0).x).toBeCloseTo(PLAYER_SPEED * 3, 5);
  });

  it('faces the commanded yaw', () => {
    const sim = makeSim([player(1, 0, 0)]);
    sim.applyInput(1, cmd({ yaw: 1.25 }));
    sim.step();
    expect(sim.players.get(1)!.facing).toBeCloseTo(1.25, 5);
  });

  it('jumps and lands under gravity', () => {
    const sim = makeSim([player(1, 0, 0)]);
    sim.applyInput(1, cmd({ buttons: buttons({ jump: true }) }));
    sim.step();
    let peak = 0;
    let airborneTicks = 0;
    for (let i = 0; i < TICK_RATE * 2; i++) {
      sim.step();
      const y = sim.players.get(1)!.y;
      if (y > 0) airborneTicks++;
      peak = Math.max(peak, y);
    }
    expect(peak).toBeGreaterThan(0.8);
    expect(peak).toBeLessThan((JUMP_VELOCITY * JUMP_VELOCITY) / (2 * 20) + 0.5);
    expect(airborneTicks).toBeGreaterThan(5);
    expect(sim.players.get(1)!.y).toBe(0);
  });

  it('barrel roll covers ROLL_DISTANCE and goes on cooldown', () => {
    const sim = makeSim([player(1, 0, 0)]);
    sim.applyInput(1, cmd({ moveX: 1, buttons: buttons({ roll: true }) }));
    const snap1 = sim.step();
    expect(snap1.players.find((p) => p.id === 1)!.rolling).toBe(true);
    for (let i = 0; i < 7; i++) sim.step();
    // 7 roll ticks at roll speed plus one tick of normal run.
    expect(sim.players.get(1)!.x).toBeGreaterThan(6);
    expect(sim.players.get(1)!.rollCdTicks).toBeGreaterThan(0);
  });
});
