# Claudestorm

A standalone, web-based battle-royale slice inspired by WoW's Plunderstorm: glide in, loot ability scrolls, level up on plunder, and be the last one standing against 11 bots.

## Play

```bash
npm install
npm run dev     # open http://localhost:5173
```

- **WASD** — move (camera-relative)
- **Hold right mouse** — look around (character faces camera)
- **Left mouse** — sword auto-attack (3-hit combo, big finisher)
- **1 / 2** — offense spell slots (looted)
- **3 / 4** — utility spell slots (looted)
- **G** — use held item (one consumable at a time)
- **H** — heal (builtin, 20s cooldown)
- **Space** — jump
- **Shift** — barrel roll (dodges projectiles)
- **F** — open chests / take scrolls
- **T** — skills compendium (every spell and item with stats)
- **Wheel** — zoom

## The match

1. **Drop in** — steer your glide onto a 300×300 island of rolling hills: central ruins, an inner ring of camps, and an outer ring of eight POIs.
2. **Loot** — chests (channel to open), creatures, and loose scrolls give spells in four ranks (common → epic). **Picking up a duplicate of an equipped spell stacks its rank**, Plunderstorm-style. Every POI is guarded by a crowned **elite** that always drops a rare-or-epic spell. Consumable items (Chicken Coup, Smoke Bomb, Mechano-Hog, Gravity Launcher) fill a single item slot.
3. **Level** — coins, kills, and chests grant XP; each level adds max HP and damage.
4. **Survive** — the storm closes in drifting circles; the final circle is raked by Violent Lightnings. Last one standing wins.

The spell roster is the authentic Plunderstorm set — 10 offensive (Rime Arrow, Fire Whirl, Earthbreaker, Holy Shield, Storm Archon, Mana Sphere, Searing Axe, Slicing Winds, Star Bomb, Toxic Smackerel) and 10 utility (Quaking Leap, Hunter's Chains, Steel Traps, Windstorm, Explosive Caltrops, Snowdrift, Lightning Bulwark, Fade to Shadow, Repel, Faeform) — implemented over the sim's behavior primitives (stun, poison, stealth, immunity, dashes, boomerangs, volleys, traps, pools). Press **T** in game for the full compendium.

## Scripts

- `npm test` — sim unit tests (Vitest)
- `npm run typecheck` — typecheck both packages
- `npm run build` — production build

## Architecture

npm-workspaces monorepo, designed so the slice grows into the full game (real multiplayer, more abilities, terrain) without rewrites:

```
packages/
  shared/   headless fixed-tick (20 Hz) game simulation + protocol types.
            No DOM or Three.js imports — this is what a game server will run.
  client/   Three.js renderer, input, HUD. Talks to the sim ONLY through the
            Transport interface (currently LocalTransport: sim in a Web Worker).
```

Load-bearing rules:

1. **Client ↔ sim only via `Transport`** (`sendInput(InputCommand)` in, `Snapshot` out). Real multiplayer later = a `NetworkTransport` over WebSocket hosting the same sim in `packages/server`; sim and renderer stay untouched.
2. **`shared` never imports rendering/DOM.** Verify with a grep for `three`/`document.`/`window.` under `packages/shared/src`.
3. **Bots drive characters through the same `InputCommand` path as the player**, so bots and remote players are interchangeable.
4. **Abilities are data** (`shared/src/sim/abilities.ts`) over behavior primitives (`projectile`, `groundAoE`, `cone`, `selfAura`, `leap`, `shield`, `buff`, `trap`). New abilities are mostly new config entries. Terrain is data too: `terrainHeight()` in `shared/maps` drives both the renderer's ground mesh and entity placement.

The sim is deterministic for a given seed + input stream (covered by a test), which keeps the door open for replays and server reconciliation.
