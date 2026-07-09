# Claudestorm

A standalone, web-based battle-royale slice inspired by WoW's Plunderstorm: glide in, loot ability scrolls, level up on plunder, and be the last one standing against 11 bots.

## Play

```bash
npm install
npm run dev     # open http://localhost:5173, then hit Start Game
```

- **WASD** — move (camera-relative)
- **Hold right mouse** — look around (character faces camera)
- **R** — sword auto-attack (3-hit combo, big finisher)
- **1 / 2** — offense spell slots (looted); charge-and-release spells cast on press, release on re-press
- **3 / 4** — utility spell slots (looted)
- Spells fire **where your character faces** (turn to aim, Plunderstorm-style); ground circles land in your facing at the cursor's distance. Celestial Barrage is the exception — it tracks the cursor.
- **Z / X** — swap the offense pair / the utility pair
- **G** — use held item (one consumable at a time)
- **H** — heal (builtin, 20s cooldown)
- **Space** — jump
- **Shift** — barrel roll (dodges projectiles)
- **F** — open chests / take scrolls
- **T** — skills compendium (every spell and item with stats)
- **Wheel** — zoom

## The match

1. **Drop in** — steer your glide onto a 420×420 island of rolling hills with eighteen POIs (ruins, camps, groves, quarries) scattered across the whole map — no privileged center — plus creatures roaming the open fields between them.
2. **Loot** — chests (channel to open), creatures, and loose scrolls give spells in four ranks (common → epic). **Picking up a duplicate of an equipped spell stacks its rank**, Plunderstorm-style. Most POIs are guarded by a crowned **elite** that always drops a rare-or-epic spell. Consumable items (Chicken Coup, Smoke Bomb, Mechano-Hog, Gravity Launcher, To the Skies!) fill a single item slot. Coins fly to you from a distance, and **killed players drop their scrolls, a share of their plunder, and their item**.
3. **Level** — coins, kills, and chests grant XP; each level adds max HP and damage.
4. **Survive** — the storm closes in circles that always settle off-center, so the safe zone wanders across the island. Long holds between shrinks leave real time to loot and fight; the next-to-last circle is a roomy dueling arena, and the endgame is a slow creep down to almost nothing while Violent Lightnings rake whatever space is left. Last one standing wins.

The spell roster is the authentic Plunderstorm set — 11 offensive (Rime Arrow, Fire Whirl, Earthbreaker, Holy Shield, Storm Archon, Mana Sphere, Searing Axe, Slicing Winds, Star Bomb, Toxic Smackerel, Celestial Barrage) and 10 utility (Quaking Leap, Hunter's Chains, Steel Traps, Windstorm, Explosive Caltrops, Snowdrift, Lightning Bulwark, Fade to Shadow, Repel, Faeform) — implemented over the sim's behavior primitives (stun, poison, stealth, immunity, dashes, boomerangs, volleys, traps, pools). **Slicing Winds** and **Celestial Barrage** are charge-and-release casts: press to start charging, press again (or hold to max) to release — charge time scales damage and reach, and Celestial Barrage lifts you into the air before loosing a volley that pierces everything in its path. Press **T** in game for the full compendium.

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
