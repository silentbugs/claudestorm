# Claudestorm

A standalone, web-based battle-royale slice inspired by WoW's Plunderstorm: glide in, loot ability scrolls, level up on plunder, and be the last one standing against 11 bots.

## Play

```bash
npm install
npm run dev     # open http://localhost:5173, then hit Start Game
```

Set up your match on the start screen — hero color, opponent count (3–23 bots), bot difficulty, time of day (Day / Dusk / Night, previewed live on the menu), how many circles the storm has (3–6), and how fast they close — then hit Start Game.

- **WASD** — move (relative to your character's facing)
- **Hold right mouse** — turn your character with the camera (WoW-style)
- **Hold left mouse** — orbit the camera without turning your character; pressing RMB snaps you to the camera's heading
- **R** — melee slap (3-hit combo; the third is a two-handed finisher)
- **1 / 2** — offense spell slots (looted); charge-and-release spells cast on press, release on re-press
- **3 / 4** — utility spell slots (looted)
- Spells fire **where your character faces** (turn to aim, Plunderstorm-style); ground circles land in your facing at the cursor's distance.
- **Z / X** — swap the offense pair / the utility pair
- **G** — use held item (one consumable at a time)
- **H** — heal (builtin, 20s cooldown): a 3s channel that pulses 20 hp per second; taking damage or attacking interrupts it, and the cooldown is spent either way
- **Space** — jump
- **Shift** — barrel roll (dodges projectiles)
- **F** — open chests / take scrolls
- **M** — full-screen map (a minimap sits top right: storm circle, next circle, you)
- **T** — skills compendium (every spell and item with stats)
- **Wheel** — zoom
- After you fall: **Spectate** follows the survivors; **←/→** switch targets

## The match

1. **Drop in** — steer your glide onto a 760×760 island with real geography: mountain ridges of open high ground, lowland basins, lakes that slow you to a wade, and five named landmarks that make the map readable at a glance — **Shipwreck Cove**, **Skyreach Spire** (the island's tallest peak, watchtower on top), **The Stone Ring**, **The Sunken Pit** (loot-rich, but climbing out is a crawl unless you find the ramp), and **Elder Grove** — with copses, boulder fields, and roaming creatures filling the space between. Landmarks are stamped by per-piece functions, the pool a future procedural island generator will shuffle.
2. **Loot** — chests (channel to open), creatures, and loose scrolls give spells in four ranks (common → epic). **Picking up a duplicate of an equipped spell stacks its rank**, Plunderstorm-style. Most POIs are guarded by a crowned **elite** that always drops a rare-or-epic spell. Consumable items (Chicken Coup, Smoke Bomb, Mechano-Hog, Gravity Launcher, To the Skies!) fill a single item slot. Coins fly to you from a distance, and **killed players drop their scrolls, a share of their plunder, and their item**.
3. **Level** — coins, kills, and chests grant XP; each level adds max HP and damage.
4. **Survive** — the storm converges on a random point rolled at each match's start, so the safe zone wanders toward a different part of the island every game (the minimap shows both the current circle and where it's headed). Long holds between shrinks leave real time to loot and fight, the wall never outruns a walking player, the next-to-last circle is a roomy dueling arena, and the endgame is a slow creep down to almost nothing while Violent Lightnings rake whatever space is left. Last one standing wins.

Every finished match (win or death — abandons don't count) is recorded to a local IndexedDB database: placement, kills, damage dealt and taken, plunder, level, creatures and chests, spells cast, slaps thrown, survival time, who got you, and the match settings. **Match History** on the start screen shows lifetime totals and your recent games, and the end screen summarizes the match you just played.

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

Art: the client bundles CC0 models from Kenney's Nature and Pirate kits plus MIT textures from the three.js examples (see `packages/client/public/assets/ASSETS.md`), loaded through `AssetLibrary` before the start screen unlocks. Characters are procedural "storm constructs" — hovering crystalline creatures built from shared low-poly geometries that tint to the hero color.
