import * as THREE from 'three';
import {
  ABILITIES,
  ARENA,
  INTERACT_RADIUS,
  TICK_DT,
  dist,
  lerp,
  terrainHeight,
  type Snapshot,
} from '@claudestorm/shared';
import { CameraRig } from './game/CameraRig.js';
import { InputManager } from './game/InputManager.js';
import { SnapshotBuffer } from './game/SnapshotBuffer.js';
import { LocalTransport } from './net/LocalTransport.js';
import { AssetLibrary } from './render/assets.js';
import { EntityViews } from './render/EntityViews.js';
import { SceneManager } from './render/SceneManager.js';
import { sfx } from './sfx.js';
import { Hud } from './ui/Hud.js';

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

export class GameApp {
  private sceneMgr!: SceneManager;
  private views!: EntityViews;
  private readonly hud: Hud;
  private readonly input = new InputManager();
  private readonly rig = new CameraRig();
  private readonly buffer = new SnapshotBuffer();
  private transport: LocalTransport | null = null;

  private readonly raycaster = new THREE.Raycaster();
  private readonly groundPlane = new THREE.Plane(new THREE.Vector3(0, 1, 0), 0);
  private readonly aimPoint = new THREE.Vector3();
  private aimX = 0;
  private aimZ = 0;

  private lastInputSend = 0;
  private lastFrame = performance.now();
  private endShown = false;
  private inMatch = false;
  private menuTime = 0;
  private wasLooking = false;

  constructor(private readonly container: HTMLElement) {
    this.hud = new Hud(() => this.restart());
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
      this.startMatch();
    });
    document
      .getElementById('skills-btn')!
      .addEventListener('click', () => this.hud.toggleSkills());
    const botSlider = document.getElementById('bot-count') as HTMLInputElement;
    const botValue = document.getElementById('bot-count-value')!;
    botSlider.addEventListener('input', () => (botValue.textContent = botSlider.value));

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
    this.endShown = false;
    const botCount = Number(
      (document.getElementById('bot-count') as HTMLInputElement | null)?.value ?? 11,
    );
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
    this.views.handleEvents(snap.events, SELF_ID, snap);
    for (const ev of snap.events) {
      if (ev.type === 'hit' && ev.targetId === SELF_ID) this.hud.flashVignette();
      if (ev.type === 'death' && ev.id === SELF_ID && !this.endShown) {
        this.endShown = true;
        this.hud.showEnd(false, snap.aliveCount + 1);
      }
    }
    if (snap.phase === 'ended' && !this.endShown) {
      this.endShown = true;
      const victory = snap.winnerId === SELF_ID;
      if (victory) sfx.victory();
      this.hud.showEnd(victory, victory ? 1 : snap.aliveCount + 1);
    }
  }

  private frame(now: number): void {
    const dt = Math.min(0.1, (now - this.lastFrame) / 1000);
    this.lastFrame = now;

    if (!this.inMatch) {
      // Menu backdrop: a slow flyover of the island.
      this.menuTime += dt;
      const a = this.menuTime * 0.04;
      this.sceneMgr.camera.position.set(Math.cos(a) * 150, 75, Math.sin(a) * 150);
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

      const selfNext = next.players.find((p) => p.id === SELF_ID);
      const selfPrev = prev.players.find((p) => p.id === SELF_ID) ?? selfNext;
      if (selfNext && selfPrev) {
        const x = lerp(selfPrev.x, selfNext.x, t);
        const z = lerp(selfPrev.z, selfNext.z, t);
        const y = lerp(selfPrev.y, selfNext.y, t) + terrainHeight(ARENA.hills, x, z);
        this.rig.update(this.sceneMgr.camera, x, y, z);
        this.updateAim(x, z);
        this.updateInteractPrompt(next, x, z, selfNext.gliding);
      }

      if (now - this.lastInputSend >= TICK_DT * 1000) {
        this.lastInputSend = now;
        this.transport?.sendInput(this.input.buildCommand(this.rig.yaw, this.aimX, this.aimZ));
      }
    }

    this.hud.tick(dt);
    this.sceneMgr.render();
    requestAnimationFrame((n) => this.frame(n));
  }

  private updateAim(selfX: number, selfZ: number): void {
    const ndc = new THREE.Vector2(
      (this.input.mouseX / window.innerWidth) * 2 - 1,
      -(this.input.mouseY / window.innerHeight) * 2 + 1,
    );
    this.raycaster.setFromCamera(ndc, this.sceneMgr.camera);
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
