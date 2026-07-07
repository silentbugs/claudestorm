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
- **Q / E** — offense ability slots (looted)
- **R** — utility ability slot (looted)
- **H** — heal (builtin, 20s cooldown)
- **Space** — jump
- **Shift** — barrel roll (dodges projectiles)
- **F** — open chests / take scrolls
- **T** — skills compendium (every ability with stats)
- **Wheel** — zoom

## The match

1. **Drop in** — steer your glide to a landing spot; seven points of interest on a 200×200 island hold the loot.
2. **Loot** — chests (channel to open), creatures, and loose scrolls give ability scrolls in four rarities (common → epic; rarity scales power) plus plunder coins. Each POI is guarded by a crowned **elite** that always drops a rare-or-epic skill.
3. **Level** — coins, kills, and chests grant XP; each level adds max HP and damage.
4. **Survive** — the storm shrinks in phases; last player standing wins.

Ability roster (10): Frost Arrow (skillshot + slow), Flame Cyclone (spin AoE while moving), Storm Call (telegraphed lightning), Venom Orb (lobbed, leaves a poison pool), Frost Nova (self-centered burst + root), Shadow Lance (heavy skillshot), Gust Leap (leap + landing knockback), Grasping Chains (pull + root), Stone Shield (absorb), Wind Rush (escape dash). Press **T** in game for the full compendium.

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
4. **Abilities are data** (`shared/src/sim/abilities.ts`) over behavior primitives (`projectile`, `groundAoE`, `selfAura`, `leap`, `shield`). New abilities are mostly new config entries.

The sim is deterministic for a given seed + input stream (covered by a test), which keeps the door open for replays and server reconciliation.
