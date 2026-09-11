import { GameSim, type GameSimOptions, type PlayerSetup } from '../src/sim/GameSim.js';
import type { MapDef } from '../src/maps/arena.js';
import type { StormPhaseDef } from '../src/sim/storm.js';
import type {
  AbilityId,
  InputButtons,
  InputCommand,
  PlayerSlots,
  Rarity,
} from '../src/protocol/types.js';

export const FLAT_MAP: MapDef = {
  size: 100,
  obstacles: [],
  chests: [],
  mobs: [],
  elites: [],
  scrolls: [],
  items: [],
  hills: [],
  lakes: [],
  pits: [],
  landmarks: [],
  roads: [],
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
  utility: (AbilityId | null)[] = [null, null],
  rarity: Rarity = 'common',
): PlayerSlots {
  const pad = (arr: (AbilityId | null)[]) => {
    const out = arr.map((a) => (a ? { abilityId: a, rarity } : null));
    while (out.length < 2) out.push(null);
    return out;
  };
  return { offense: pad(offense), utility: pad(utility) };
}

/** All-false buttons with the given overrides. */
export function buttons(partial: Partial<InputButtons> = {}): InputButtons {
  return {
    melee: false,
    dive: false,
    roll: false,
    jump: false,
    interact: false,
    heal: false,
    useItem: false,
    swapOffense: false,
    swapUtility: false,
    ...partial,
  };
}

export function cmd(partial: Partial<InputCommand> = {}): InputCommand {
  // Spells fire along the character's facing. Tests cast from the origin, so
  // when no yaw is given, face the aim point (matching how a player would turn).
  const yaw =
    partial.yaw ??
    (partial.aimX || partial.aimZ ? Math.atan2(partial.aimX ?? 0, partial.aimZ ?? 0) : 0);
  return {
    seq: 0,
    moveX: 0,
    moveZ: 0,
    aimX: 0,
    aimZ: 0,
    buttons: buttons(),
    slotCasts: [],
    ...partial,
    yaw,
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
