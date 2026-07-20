import * as THREE from 'three';
import {
  ABILITIES,
  ARENA,
  INTERACT_RADIUS,
  ITEMS,
  LAKE_WATERLINE_FACTOR,
  STORM_START_RADIUS,
  buildStormPhases,
  dist,
  groundHeight,
  lakeSurfaceY,
  lerp,
  type BotDifficulty,
  type Snapshot,
} from '@claudestorm/shared';
import { CameraRig } from './game/CameraRig.js';
import { GamepadManager } from './game/GamepadManager.js';
import { InputManager } from './game/InputManager.js';
import { TouchControls } from './game/TouchControls.js';
import { SnapshotBuffer } from './game/SnapshotBuffer.js';
import { LocalTransport } from './net/LocalTransport.js';
import { AssetLibrary } from './render/assets.js';
import { EntityViews, type HeroModel } from './render/EntityViews.js';
import { SceneManager, type EnvironmentId } from './render/SceneManager.js';
import { sfx } from './sfx.js';
import { StatsTracker, statsStore, type MatchStats } from './stats.js';
import { Hud } from './ui/Hud.js';
import { MapView } from './ui/MapView.js';
import { StatsPanel } from './ui/StatsPanel.js';

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
  private readonly gamepads = new GamepadManager();
  /** Coarse pointer = phone/tablet: touch controls, no pointer lock. */
  private readonly touchMode = window.matchMedia('(pointer: coarse)').matches;
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
  private tracker: StatsTracker | null = null;
  private lastMatch: MatchStats | null = null;
  private inMatch = false;
  private menuTime = 0;
  private milestoneThresholds: number[] = [];
  private readonly announcedMilestones = new Set<number>();
  private wasLooking = false;
  private fpsAccum = 0;
  private fpsFrames = 0;
  private fpsWorst = 0;
  private readonly underwaterEl = document.getElementById('underwater')!;
  private isUnder = false;
  private readonly pauseEl = document.getElementById('pause-menu')!;
  private pauseOpen = false;
  /** Set before we exit pointer lock on purpose, so it doesn't open the pause menu. */
  private expectedUnlock = false;

  constructor(private readonly container: HTMLElement) {
    this.hud = new Hud(
      () => this.restart(),
      () => this.startSpectate(),
      () => this.returnToMenu(),
      this.touchMode,
    );
    if (this.touchMode) {
      const rotateHint = document.getElementById('rotate-hint')!;
      const checkOrientation = () => {
        rotateHint.classList.toggle('hidden', window.innerWidth >= window.innerHeight);
      };
      checkOrientation();
      window.addEventListener('resize', checkOrientation);
      window.addEventListener('orientationchange', checkOrientation);

      // Kill double-tap-to-zoom globally. touch-action CSS handles most of
      // this, but the double-tap gesture specifically predates that spec in
      // some mobile browsers and ignores it — this is the standard
      // cross-browser fallback: a second tap within 350ms gets eaten instead
      // of reaching the browser's zoom handling.
      let lastTouchEnd = 0;
      document.addEventListener(
        'touchend',
        (e) => {
          const now = Date.now();
          if (now - lastTouchEnd < 350) e.preventDefault();
          lastTouchEnd = now;
        },
        { passive: false },
      );
    }
    // Re-engage the lock after a stray unlock (click lands on the canvas).
    window.addEventListener('mousedown', (e) => {
      if (
        this.inMatch &&
        !this.pauseOpen &&
        e.target instanceof HTMLCanvasElement &&
        document.getElementById('end-screen')!.classList.contains('hidden')
      ) {
        this.lockPointer();
      }
    });
    window.addEventListener('keydown', (e) => {
      if (this.spectateId !== null) {
        if (e.code === 'ArrowLeft') this.cycleSpectate(-1);
        else if (e.code === 'ArrowRight') this.cycleSpectate(1);
        else if (e.code === 'Escape') {
          // Back out of spectating to the death screen (Play Again / Main Menu).
          this.spectateId = null;
          this.hud.showSpectate(null);
          this.hud.showEnd(false, this.deathPlacement, true);
        }
        return;
      }
      // Esc while unlocked toggles the pause menu (while locked, the browser
      // consumes Esc to release the lock; the pointerlockchange handler opens
      // the menu in that case).
      if (
        e.code === 'Escape' &&
        this.inMatch &&
        !this.deadShown &&
        document.getElementById('end-screen')!.classList.contains('hidden')
      ) {
        if (this.pauseOpen) this.closePause(true);
        else this.openPause();
      }
    });
    // Esc during a locked match releases the pointer — that IS the pause key.
    document.addEventListener('pointerlockchange', () => {
      if (document.pointerLockElement) return;
      const expected = this.expectedUnlock;
      this.expectedUnlock = false;
      if (
        !expected &&
        this.inMatch &&
        !this.deadShown &&
        this.spectateId === null &&
        document.getElementById('end-screen')!.classList.contains('hidden')
      ) {
        this.openPause();
      }
    });
    document.getElementById('pause-resume-btn')!.addEventListener('click', () => this.closePause(true));
    // The only way to reach the compendium mid-match on touch — there's no
    // physical T key to press there.
    document.getElementById('pause-skills-btn')!.addEventListener('click', () => {
      this.closePause(false);
      this.hud.toggleSkills();
    });
    document.getElementById('pause-menu-btn')!.addEventListener('click', () => {
      this.closePause(false);
      this.returnToMenu();
    });
  }

  private togglePause(): void {
    if (this.pauseOpen) this.closePause(true);
    else if (
      this.inMatch &&
      !this.deadShown &&
      this.spectateId === null &&
      document.getElementById('end-screen')!.classList.contains('hidden')
    ) {
      this.openPause();
    }
  }

  /** The in-game menu: the sim keeps running behind it (battle royale — no pausing the storm). */
  private openPause(): void {
    if (this.pauseOpen) return;
    this.pauseOpen = true;
    this.pauseEl.classList.remove('hidden');
    // The menu takes the front: fold away the map and skills overlays.
    document.getElementById('map-overlay')!.classList.add('hidden');
    document.getElementById('skills-overlay')!.classList.add('hidden');
    if (document.pointerLockElement) {
      this.expectedUnlock = true;
      document.exitPointerLock();
    }
  }

  private closePause(relock: boolean): void {
    if (!this.pauseOpen) return;
    this.pauseOpen = false;
    this.pauseEl.classList.add('hidden');
    if (relock) this.lockPointer();
  }

  private startSpectate(): void {
    this.hud.hideEnd();
    this.spectateId = -1; // resolved to the first living player next frame
    this.lockPointer();
  }

  /**
   * The pointer stays locked for the whole match (WoW-style): raw look input,
   * an in-game drawn cursor, and no browser context menu — including
   * Firefox's shift+right-click, which ignores preventDefault, and its
   * pointer-lock banner now shows once per match instead of on every turn.
   */
  private lockPointer(): void {
    if (this.touchMode) return; // no pointer to lock on a touchscreen
    if (document.pointerLockElement) return;
    try {
      const lock = this.sceneMgr.renderer.domElement.requestPointerLock() as
        | Promise<void>
        | undefined;
      void lock?.catch(() => {});
    } catch {
      // Lock unavailable (or throttled after Esc) — the game still plays unlocked.
    }
  }

  /** Tear the match down and bring the start screen (and its flyover) back. */
  private returnToMenu(): void {
    this.transport?.dispose();
    this.transport = null;
    this.buffer.reset();
    this.views.clear();
    this.hud.hideEnd();
    this.hud.showSpectate(null);
    this.hud.showInteract(null);
    this.spectateId = null;
    this.tracker = null; // abandoned matches are not recorded
    this.inMatch = false;
    sfx.updateGlideWinds([]);
    this.expectedUnlock = true;
    document.exitPointerLock();
    this.map.setActive(false);
    this.sceneMgr.setStorm(0, 0, STORM_START_RADIUS);
    document.getElementById('start-screen')!.classList.remove('hidden');
    document.getElementById('hud')!.classList.add('in-menu');
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
      this.requestFullscreenIfMobile();
      document.getElementById('start-screen')!.classList.add('hidden');
      hudRoot.classList.remove('in-menu');
      this.inMatch = true;
      this.map.setActive(true);
      this.startMatch();
    });
    document
      .getElementById('skills-btn')!
      .addEventListener('click', () => this.hud.toggleSkills());
    new StatsPanel();
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
      this.sceneMgr = new SceneManager(this.container, assets, this.touchMode);
      this.views = new EntityViews(this.sceneMgr.scene, assets);
      if (this.touchMode) {
        new TouchControls(this.input, this.sceneMgr.renderer.domElement, this.map, () =>
          this.togglePause(),
        );
      }
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
    this.hud.resetMatchUi();
    this.endShown = false;
    this.deadShown = false;
    this.deathPlacement = 0;
    this.spectateId = null;
    this.latestSnap = null;
    const botCount = Number(
      (document.getElementById('bot-count') as HTMLInputElement | null)?.value ?? 11,
    );
    this.announcedMilestones.clear();
    // Candidate callouts, filtered to ones that actually happen this match.
    this.milestoneThresholds = [20, 10, 5, 3, 2].filter((n) => n < botCount + 1);
    this.views.setSelfColor(Number(choiceValue('color-swatches')) || HERO_COLORS[0]!);
    this.views.setSelfModel((choiceValue('model-choice') || 'cloud') as HeroModel);
    this.sceneMgr.setEnvironment((choiceValue('time-choice') || 'day') as EnvironmentId);
    const difficulty = (choiceValue('difficulty-choice') || 'normal') as BotDifficulty;
    const circles = Number(choiceValue('circles-choice')) || 5;
    const paceMult = Number(choiceValue('pace-choice')) || 1;
    const maxLevel = Number(choiceValue('max-level-choice')) || 10;
    this.tracker = new StatsTracker(SELF_ID, { bots: botCount, difficulty, circles });
    this.lastMatch = null;
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
        maxLevel,
      },
      SELF_ID,
    );
    this.transport.start((snap) => {
      this.buffer.push(snap);
      this.onSnapshot(snap);
    });
    this.lockPointer();
  }

  private restart(): void {
    this.requestFullscreenIfMobile();
    this.transport?.dispose();
    this.startMatch();
  }

  /**
   * Mobile browser chrome (address bar, nav buttons) eats real screen space
   * a phone can't spare. Fullscreen needs a user gesture, so this only ever
   * fires from click handlers; it's best-effort — some mobile browsers
   * (notably iOS Safari outside of a home-screen PWA) don't support it at
   * all, so a rejection here is expected and not an error worth surfacing.
   */
  private requestFullscreenIfMobile(): void {
    if (!this.touchMode || document.fullscreenElement) return;
    void document.documentElement.requestFullscreen?.().catch(() => {});
  }

  private onSnapshot(snap: Snapshot): void {
    this.latestSnap = snap;
    // The tracker finishes exactly once (self death or match end): remember
    // the record for the end screen and file it in the local database.
    const finished = this.tracker?.consume(snap);
    if (finished) {
      this.lastMatch = finished;
      void statsStore.add(finished);
    }
    this.views.handleEvents(snap.events, SELF_ID, snap);
    for (const ev of snap.events) {
      if (ev.type === 'hit' && ev.targetId === SELF_ID) this.hud.flashVignette();
      // Name every cast you make: charge spells stay named while held,
      // instant spells flash their name briefly.
      if (ev.type === 'cast' && ev.casterId === SELF_ID) {
        const def = ABILITIES[ev.abilityId];
        this.hud.showCast(def.name, def.chargeSeconds ? def.chargeSeconds + 0.4 : 0.9);
      }
      if (ev.type === 'chargeRelease' && ev.casterId === SELF_ID) {
        this.hud.showCast(ABILITIES[ev.abilityId].name, 0.6);
      }
      if (ev.type === 'death' && ev.id === SELF_ID && !this.deadShown) {
        this.deadShown = true;
        this.deathPlacement = snap.aliveCount + 1;
        // Offer to watch the rest of the match play out.
        if (snap.phase !== 'ended') {
          this.closePause(false);
          this.expectedUnlock = true;
          document.exitPointerLock();
          this.hud.showEnd(false, this.deathPlacement, true, this.matchSummary());
        }
      }
      if (ev.type === 'death') {
        const victim = snap.players.find((p) => p.id === ev.id);
        if (victim) {
          let killerName: string | null = null;
          if (ev.killerId !== null) {
            const killer = snap.players.find((p) => p.id === ev.killerId);
            if (killer) killerName = killer.name;
            else {
              const mob = snap.mobs.find((m) => m.id === ev.killerId);
              if (mob) killerName = mob.elite ? 'an elite guardian' : 'a mob';
            }
          }
          this.hud.pushKillfeed(killerName, victim.name);
        }
      }
    }
    for (const threshold of this.milestoneThresholds) {
      if (snap.aliveCount <= threshold && !this.announcedMilestones.has(threshold)) {
        this.announcedMilestones.add(threshold);
        this.hud.announceMilestone(`${threshold} Plunderers remain`);
      }
    }
    if (snap.phase === 'ended' && !this.endShown) {
      this.endShown = true;
      this.spectateId = null;
      this.hud.showSpectate(null);
      const victory = snap.winnerId === SELF_ID;
      if (victory) sfx.victory();
      this.closePause(false);
      this.expectedUnlock = true;
      document.exitPointerLock();
      this.hud.showEnd(
        victory,
        victory ? 1 : this.deathPlacement || snap.aliveCount + 1,
        false,
        this.matchSummary(),
      );
    }
  }

  /** One line of the match's numbers for the end screen. */
  private matchSummary(): string {
    const m = this.lastMatch;
    if (!m) return '';
    const time = `${Math.floor(m.survivalSeconds / 60)}:${String(m.survivalSeconds % 60).padStart(2, '0')}`;
    return `${m.kills} kills · ${m.damageDealt} damage · ⛃ ${m.plunder} · survived ${time}`;
  }

  private frame(now: number): void {
    const rawDt = (now - this.lastFrame) / 1000;
    const dt = Math.min(0.1, rawDt);
    this.lastFrame = now;

    // FPS readout: the average alone hides single dropped frames (vsync pins
    // it at the refresh rate), so the worst frame of each window shows too.
    this.fpsAccum += rawDt;
    this.fpsFrames++;
    this.fpsWorst = Math.max(this.fpsWorst, rawDt);
    if (this.fpsAccum >= 0.5) {
      const worstMs = Math.round(this.fpsWorst * 1000);
      const el = document.getElementById('fps')!;
      el.textContent = `${Math.round(this.fpsFrames / this.fpsAccum)} FPS · worst ${worstMs} ms`;
      el.classList.toggle('spiking', worstMs > 40);
      this.fpsAccum = 0;
      this.fpsFrames = 0;
      this.fpsWorst = 0;
    }

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
    // Keyboard turning (A/D): ~150°/s, close to WoW's default turn rate.
    this.rig.yaw += this.input.keyTurn * 2.6 * dt;
    // Gamepad: right stick steers like right-mouse; buttons feed the same input state.
    const padLook = this.gamepads.poll(
      this.input,
      this.pauseOpen,
      () => this.togglePause(),
      () => this.map.toggleOverlay(),
    );
    this.rig.applyLook(padLook.lookX * 850 * dt, padLook.lookY * 620 * dt, 0);

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
      // The HUD mirrors whoever the camera follows: while spectating, the
      // vitals, hotbar, cooldowns, and level are the spectated player's.
      this.hud.update(next, focusNext?.id ?? SELF_ID);
      const focusPrev = focusNext
        ? (prev.players.find((p) => p.id === focusNext.id) ?? focusNext)
        : undefined;
      if (focusNext && focusPrev) {
        const x = lerp(focusPrev.x, focusNext.x, t);
        const z = lerp(focusPrev.z, focusNext.z, t);
        const y = lerp(focusPrev.y, focusNext.y, t) + groundHeight(ARENA, x, z);
        this.rig.update(this.sceneMgr.camera, x, y, z, dt);
        this.sceneMgr.setFocus(x, z);
        this.updateUnderwater();
        sfx.setListener(x, z, this.rig.camYaw);
        // The drop is audible: every open parachute streams positional wind.
        sfx.updateGlideWinds(
          next.players
            .filter((p) => p.alive && p.gliding)
            .map((p) => ({ id: p.id, x: p.x, z: p.z, y: p.y, isSelf: p.id === focusNext.id })),
        );
        this.map.update(dt, next.storm, x, z, this.spectateId !== null ? focusNext.facing : this.rig.yaw);
        if (this.spectateId === null) {
          if (this.touchMode || this.gamepads.recentlyActive) {
            // No cursor to aim with: ground circles land mid-range along the facing.
            this.aimX = x + Math.sin(this.rig.yaw) * 16;
            this.aimZ = z + Math.cos(this.rig.yaw) * 16;
          } else {
            this.updateAim(x, z);
          }
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

  /**
   * WoW-style: the blue wash appears exactly when the camera itself is below
   * a lake's surface — nothing else triggers it.
   */
  private updateUnderwater(): void {
    const cam = this.sceneMgr.camera.position;
    let under = false;
    for (const lake of ARENA.lakes) {
      if (Math.hypot(cam.x - lake.x, cam.z - lake.z) < lake.r * LAKE_WATERLINE_FACTOR) {
        // lakeSurfaceY is the exact height the water disc renders at.
        if (cam.y < lakeSurfaceY(ARENA, lake)) {
          under = true;
          break;
        }
      }
    }
    if (under !== this.isUnder) {
      this.isUnder = under;
      this.underwaterEl.classList.toggle('hidden', !under);
    }
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
      const held = snap.players.find((p) => p.id === SELF_ID)?.item ?? null;
      for (const it of snap.items) {
        const d = dist(x, z, it.x, it.z);
        if (d < bestDist) {
          bestDist = d;
          best = `Take ${ITEMS[it.itemId].name}${held ? ` (swap ${ITEMS[held].name})` : ''}`;
        }
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
