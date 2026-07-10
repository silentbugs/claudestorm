import * as THREE from 'three';
import {
  ABILITIES,
  ARENA,
  INTERACT_RADIUS,
  buildStormPhases,
  dist,
  lerp,
  terrainHeight,
  type BotDifficulty,
  type Snapshot,
} from '@claudestorm/shared';
import { CameraRig } from './game/CameraRig.js';
import { InputManager } from './game/InputManager.js';
import { SnapshotBuffer } from './game/SnapshotBuffer.js';
import { LocalTransport } from './net/LocalTransport.js';
import { AssetLibrary } from './render/assets.js';
import { EntityViews } from './render/EntityViews.js';
import { SceneManager, type EnvironmentId } from './render/SceneManager.js';
import { sfx } from './sfx.js';
import { Hud } from './ui/Hud.js';
import { MapView } from './ui/MapView.js';

const SELF_ID = 1;
const BOT_NAMES = [
  'Swabbie', 'Cutpurse', 'Corsair', 'Freebooter', 'Sea Dog', 'Powder Monkey',
  'Bilge Rat', 'Deckhand', 'Buccaneer', 'Lookout', 'Quartermaster', 'Mutineer',
  'Castaway', 'Privateer', 'First Mate', 'Bosun', 'Shipwright', 'Harpooner',
  'Gunner', 'Sailmaker', 'Plunderer', 'Marauder', 'Scallywag', 'Keelhauler',
];

function botName(i: number): string {
  const base = BOT_NAMES[i % BOT_NAMES.length]!;
  return i < BOT_NAMES.length ? base : `${base} ${Math.floor(i / BOT_NAMES.length) + 1}`;
}

/** Hero color choices offered on the start screen (first is the default). */
const HERO_COLORS = [0x4da6ff, 0x3ec9a7, 0xa26bff, 0x69d84f, 0xffd75e, 0xff7ab8];

/** The selected value of a segmented .choices group. */
function choiceValue(id: string): string {
  const selected = document.querySelector<HTMLElement>(`#${id} button.selected`);
  return selected?.dataset.value ?? '';
}

export class GameApp {
  private sceneMgr!: SceneManager;
  private views!: EntityViews;
  private readonly hud: Hud;
  private readonly map = new MapView();
  private readonly input = new InputManager();
  private readonly rig = new CameraRig();
  private readonly buffer = new SnapshotBuffer();
  private transport: LocalTransport | null = null;

  private readonly raycaster = new THREE.Raycaster();
  private readonly groundPlane = new THREE.Plane(new THREE.Vector3(0, 1, 0), 0);
  private readonly aimPoint = new THREE.Vector3();
  private readonly ndc = new THREE.Vector2();
  private aimX = 0;
  private aimZ = 0;

  private lastFrame = performance.now();
  private endShown = false;
  private deadShown = false;
  private deathPlacement = 0;
  private spectateId: number | null = null;
  private latestSnap: Snapshot | null = null;
  private inMatch = false;
  private menuTime = 0;
  private wasLooking = false;

  constructor(private readonly container: HTMLElement) {
    this.hud = new Hud(
      () => this.restart(),
      () => this.startSpectate(),
    );
    window.addEventListener('keydown', (e) => {
      if (this.spectateId === null) return;
      if (e.code === 'ArrowLeft') this.cycleSpectate(-1);
      else if (e.code === 'ArrowRight') this.cycleSpectate(1);
    });
  }

  private startSpectate(): void {
    this.hud.hideEnd();
    this.spectateId = -1; // resolved to the first living player next frame
  }

  private cycleSpectate(dir: number): void {
    const alive = (this.latestSnap?.players ?? []).filter((p) => p.alive && p.id !== SELF_ID);
    if (alive.length === 0) return;
    const idx = alive.findIndex((p) => p.id === this.spectateId);
    this.spectateId = alive[(idx + dir + alive.length) % alive.length]!.id;
  }

  start(): void {
    this.input.attach();
    window.addEventListener('pointerdown', () => sfx.unlock(), { once: true });
    window.addEventListener('keydown', () => sfx.unlock(), { once: true });

    // The match waits behind the start screen; the island slowly orbits below it.
    const hudRoot = document.getElementById('hud')!;
    hudRoot.classList.add('in-menu');
    const startBtn = document.getElementById('start-btn') as HTMLButtonElement;
    startBtn.disabled = true;
    startBtn.textContent = 'Loading…';
    startBtn.addEventListener('click', () => {
      document.getElementById('start-screen')!.classList.add('hidden');
      hudRoot.classList.remove('in-menu');
      this.inMatch = true;
      this.map.setActive(true);
      this.startMatch();
    });
    document
      .getElementById('skills-btn')!
      .addEventListener('click', () => this.hud.toggleSkills());
    const botSlider = document.getElementById('bot-count') as HTMLInputElement;
    const botValue = document.getElementById('bot-count-value')!;
    botSlider.addEventListener('input', () => (botValue.textContent = botSlider.value));

    // Hero color swatches, then one-of-N selection for every .choices group.
    const swatches = document.getElementById('color-swatches')!;
    HERO_COLORS.forEach((color, i) => {
      const btn = document.createElement('button');
      btn.className = i === 0 ? 'swatch selected' : 'swatch';
      btn.dataset.value = String(color);
      btn.style.background = `#${color.toString(16).padStart(6, '0')}`;
      swatches.appendChild(btn);
    });
    for (const group of document.querySelectorAll<HTMLElement>('.choices')) {
      group.addEventListener('click', (e) => {
        const btn = (e.target as HTMLElement).closest('button');
        if (!btn) return;
        for (const b of group.querySelectorAll('button')) b.classList.remove('selected');
        btn.classList.add('selected');
      });
    }
    // Time of day previews live on the menu's island flyover.
    document.getElementById('time-choice')!.addEventListener('click', () => {
      this.sceneMgr?.setEnvironment((choiceValue('time-choice') || 'day') as EnvironmentId);
    });

    // Scene and renderer come up once the art is in; only then can you start.
    void AssetLibrary.load().then((assets) => {
      this.sceneMgr = new SceneManager(this.container, assets);
      this.views = new EntityViews(this.sceneMgr.scene, assets);
      startBtn.disabled = false;
      startBtn.textContent = 'Start Game';
      requestAnimationFrame((now) => this.frame(now));
    });
  }

  private startMatch(): void {
    this.buffer.reset();
    this.views.clear();
    this.hud.hideEnd();
    this.hud.showSpectate(null);
    this.endShown = false;
    this.deadShown = false;
    this.deathPlacement = 0;
    this.spectateId = null;
    this.latestSnap = null;
    const botCount = Number(
      (document.getElementById('bot-count') as HTMLInputElement | null)?.value ?? 11,
    );
    this.views.setSelfColor(Number(choiceValue('color-swatches')) || HERO_COLORS[0]!);
    this.sceneMgr.setEnvironment((choiceValue('time-choice') || 'day') as EnvironmentId);
    const difficulty = (choiceValue('difficulty-choice') || 'normal') as BotDifficulty;
    const circles = Number(choiceValue('circles-choice')) || 5;
    const paceMult = Number(choiceValue('pace-choice')) || 1;
    this.transport = new LocalTransport(
      {
        seed: Date.now() & 0x7fffffff,
        players: [
          { id: SELF_ID, name: 'You', isBot: false },
          ...Array.from({ length: botCount }, (_, i) => ({
            id: i + 2,
            name: botName(i),
            isBot: true,
          })),
        ],
        stormPhases: buildStormPhases(circles, paceMult),
        botDifficulty: difficulty,
      },
      SELF_ID,
    );
    this.transport.start((snap) => {
      this.buffer.push(snap);
      this.onSnapshot(snap);
    });
  }

  private restart(): void {
    this.transport?.dispose();
    this.startMatch();
  }

  private onSnapshot(snap: Snapshot): void {
    this.latestSnap = snap;
    this.views.handleEvents(snap.events, SELF_ID, snap);
    for (const ev of snap.events) {
      if (ev.type === 'hit' && ev.targetId === SELF_ID) this.hud.flashVignette();
      if (ev.type === 'death' && ev.id === SELF_ID && !this.deadShown) {
        this.deadShown = true;
        this.deathPlacement = snap.aliveCount + 1;
        // Offer to watch the rest of the match play out.
        if (snap.phase !== 'ended') this.hud.showEnd(false, this.deathPlacement, true);
      }
    }
    if (snap.phase === 'ended' && !this.endShown) {
      this.endShown = true;
      this.spectateId = null;
      this.hud.showSpectate(null);
      const victory = snap.winnerId === SELF_ID;
      if (victory) sfx.victory();
      this.hud.showEnd(victory, victory ? 1 : this.deathPlacement || snap.aliveCount + 1);
    }
  }

  private frame(now: number): void {
    const dt = Math.min(0.1, (now - this.lastFrame) / 1000);
    this.lastFrame = now;

    if (!this.inMatch) {
      // Menu backdrop: a slow flyover of the island.
      this.menuTime += dt;
      const a = this.menuTime * 0.04;
      const r = ARENA.size * 0.36;
      this.sceneMgr.camera.position.set(Math.cos(a) * r, ARENA.size * 0.18, Math.sin(a) * r);
      this.sceneMgr.camera.lookAt(0, 6, 0);
      this.sceneMgr.render();
      requestAnimationFrame((n) => this.frame(n));
      return;
    }

    const look = this.input.takeLook();
    // Engaging right-mouse snaps the character to the camera's heading (WoW).
    if (this.input.isLooking && !this.wasLooking) this.rig.foldOrbit();
    this.wasLooking = this.input.isLooking;
    this.rig.applyLook(look.dx, look.dy, look.zoom);
    this.rig.applyOrbit(look.odx, look.ody);

    this.buffer.advance(dt);
    const sampled = this.buffer.sample();
    if (sampled) {
      const { prev, next, t } = sampled;
      this.views.sync(prev, next, t, SELF_ID, this.sceneMgr.camera, dt);
      this.sceneMgr.setStorm(
        lerp(prev.storm.x, next.storm.x, t),
        lerp(prev.storm.z, next.storm.z, t),
        lerp(prev.storm.radius, next.storm.radius, t),
      );
      this.hud.update(next, SELF_ID);

      // Camera focus: yourself, or whoever you're spectating after death.
      let focusNext = next.players.find((p) => p.id === SELF_ID);
      if (this.spectateId !== null) {
        let target = next.players.find((p) => p.id === this.spectateId && p.alive);
        if (!target) {
          // First pick, or the one we watched just died: follow someone alive.
          target = next.players.find((p) => p.alive && p.id !== SELF_ID);
          this.spectateId = target?.id ?? null;
        }
        if (target) {
          focusNext = target;
          this.hud.showSpectate(`Spectating ${target.name} · ←/→ to switch`);
        }
      }
      const focusPrev = focusNext
        ? (prev.players.find((p) => p.id === focusNext.id) ?? focusNext)
        : undefined;
      if (focusNext && focusPrev) {
        const x = lerp(focusPrev.x, focusNext.x, t);
        const z = lerp(focusPrev.z, focusNext.z, t);
        const y = lerp(focusPrev.y, focusNext.y, t) + terrainHeight(ARENA.hills, x, z);
        this.rig.update(this.sceneMgr.camera, x, y, z);
        this.sceneMgr.setFocus(x, z);
        sfx.setListener(x, z, this.rig.camYaw);
        this.map.update(next.storm, x, z, this.spectateId !== null ? focusNext.facing : this.rig.yaw);
        if (this.spectateId === null) {
          this.updateAim(x, z);
          this.updateInteractPrompt(next, x, z, focusNext.gliding);
        } else {
          this.hud.showInteract(null);
        }
      }

      // Send input every frame: the sim coalesces per tick (edge presses
      // accumulate), and unthrottled sends shave up to 50ms off input lag.
      if (this.spectateId === null) {
        this.transport?.sendInput(this.input.buildCommand(this.rig.yaw, this.aimX, this.aimZ));
      }
    }

    this.hud.tick(dt);
    this.sceneMgr.render();
    requestAnimationFrame((n) => this.frame(n));
  }

  private updateAim(selfX: number, selfZ: number): void {
    this.ndc.set(
      (this.input.mouseX / window.innerWidth) * 2 - 1,
      -(this.input.mouseY / window.innerHeight) * 2 + 1,
    );
    this.raycaster.setFromCamera(this.ndc, this.sceneMgr.camera);
    if (this.raycaster.ray.intersectPlane(this.groundPlane, this.aimPoint)) {
      this.aimX = this.aimPoint.x;
      this.aimZ = this.aimPoint.z;
    } else {
      this.aimX = selfX;
      this.aimZ = selfZ - 5;
    }
  }

  private updateInteractPrompt(snap: Snapshot, x: number, z: number, gliding: boolean): void {
    if (gliding) {
      this.hud.showInteract(null);
      return;
    }
    let best: string | null = null;
    let bestDist = INTERACT_RADIUS;
    for (const s of snap.scrolls) {
      const d = dist(x, z, s.x, s.z);
      if (d < bestDist) {
        bestDist = d;
        best = `Take ${ABILITIES[s.abilityId].name} (${s.rarity})`;
      }
    }
    if (!best) {
      for (const c of snap.chests) {
        if (c.opened) continue;
        const d = dist(x, z, c.x, c.z);
        if (d < bestDist) {
          bestDist = d;
          best = 'Open chest';
        }
      }
    }
    this.hud.showInteract(best);
  }
}
