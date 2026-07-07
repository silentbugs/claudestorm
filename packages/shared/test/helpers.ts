import { GameSim, type GameSimOptions, type PlayerSetup } from '../src/sim/GameSim.js';
import type { MapDef } from '../src/maps/arena.js';
import type { StormPhaseDef } from '../src/sim/storm.js';
import type { AbilityId, InputCommand, PlayerSlots, Rarity } from '../src/protocol/types.js';

export const FLAT_MAP: MapDef = {
  size: 100,
  obstacles: [],
  chests: [],
  mobs: [],
  elites: [],
  scrolls: [],
};

/** Storm that never threatens anyone — for tests that aren't about the storm. */
export const CALM_STORM: StormPhaseDef[] = [
  { hold: 100000, shrink: 1, targetRadius: 200, dps: 0 },
];

export function makeSim(
  players: PlayerSetup[],
  overrides: Partial<GameSimOptions> = {},
): GameSim {
  return new GameSim({
    seed: 1,
    players,
    map: FLAT_MAP,
    stormPhases: CALM_STORM,
    stormStartRadius: 200,
    skipDrop: true,
    ...overrides,
  });
}

export function loadout(
  offense: (AbilityId | null)[] = [null, null],
  utility: (AbilityId | null)[] = [null],
  rarity: Rarity = 'common',
): PlayerSlots {
  return {
    offense: offense.map((a) => (a ? { abilityId: a, rarity } : null)),
    utility: utility.map((a) => (a ? { abilityId: a, rarity } : null)),
  };
}

export function cmd(partial: Partial<InputCommand> = {}): InputCommand {
  return {
    seq: 0,
    moveX: 0,
    moveZ: 0,
    yaw: 0,
    aimX: 0,
    aimZ: 0,
    buttons: { melee: false, roll: false, jump: false, interact: false, heal: false },
    slotCasts: [],
    ...partial,
  };
}

/** Cast the given slot while aiming at a point. */
export function castCmd(slot: number, aimX: number, aimZ: number): InputCommand {
  return cmd({ aimX, aimZ, slotCasts: [slot] });
}

export function player(
  id: number,
  x: number,
  z: number,
  extra: Partial<PlayerSetup> = {},
): PlayerSetup {
  return { id, name: `P${id}`, isBot: false, spawn: { x, z }, ...extra };
}
