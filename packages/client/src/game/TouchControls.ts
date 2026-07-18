import type { InputManager } from './InputManager.js';
import type { MapView } from '../ui/MapView.js';

/**
 * Touch layer for phones/tablets (created only on coarse-pointer devices):
 * - touch the left half of the screen for a floating move stick;
 * - drag anywhere on the right half to steer character + camera;
 * - the hotbar becomes tappable (hold the slap slot to keep swinging),
 *   the interact prompt is a button, tapping the minimap opens the map;
 * - dedicated JUMP button (doubles as hold-to-dive while gliding) and a
 *   menu (⚙) button.
 * Everything funnels into the same InputManager state the keyboard uses.
 */
export class TouchControls {
  private stickId: number | null = null;
  private lookId: number | null = null;
  private stickCX = 0;
  private stickCY = 0;
  private lastLookX = 0;
  private lastLookY = 0;
  private readonly stick: HTMLElement;
  private readonly nub: HTMLElement;

  constructor(
    private readonly input: InputManager,
    canvas: HTMLCanvasElement,
    map: MapView,
    openMenu: () => void,
  ) {
    document.body.classList.add('touch-mode');
    const hud = document.getElementById('hud')!;

    this.stick = document.createElement('div');
    this.stick.id = 'touch-stick';
    this.stick.className = 'hidden';
    this.nub = document.createElement('div');
    this.nub.id = 'touch-nub';
    this.stick.appendChild(this.nub);
    hud.appendChild(this.stick);

    const jump = document.createElement('button');
    jump.id = 'touch-jump';
    jump.textContent = 'JUMP';
    hud.appendChild(jump);
    jump.addEventListener('pointerdown', (e) => {
      e.preventDefault();
      this.input.pressEdge('jump');
      // Same button doubles as dive (held) while gliding — mutually
      // exclusive sim states, so grounded jump and mid-air dive never clash.
      this.input.touchDive = true;
    });
    const stopDive = () => {
      this.input.touchDive = false;
    };
    jump.addEventListener('pointerup', stopDive);
    jump.addEventListener('pointercancel', stopDive);
    jump.addEventListener('pointerleave', stopDive);

    const menu = document.createElement('button');
    menu.id = 'touch-menu';
    menu.textContent = '⚙';
    hud.appendChild(menu);
    menu.addEventListener('pointerdown', (e) => {
      e.preventDefault();
      openMenu();
    });

    // The hotbar is the spell pad: hold the slap slot, tap the rest.
    for (const el of document.querySelectorAll<HTMLElement>('.slot')) {
      const key = el.dataset.slot!;
      el.addEventListener('pointerdown', (e) => {
        e.preventDefault();
        if (key === 'melee') this.input.touchMelee = true;
        else if (key === 'heal') this.input.pressEdge('heal');
        else if (key === 'item') this.input.pressEdge('useItem');
        else if (key === 'roll') this.input.pressEdge('roll');
        else this.input.pressSlot(Number(key));
      });
      const stop = () => {
        if (key === 'melee') this.input.touchMelee = false;
      };
      el.addEventListener('pointerup', stop);
      el.addEventListener('pointercancel', stop);
      el.addEventListener('pointerleave', stop);
    }
    document
      .getElementById('interact-prompt')!
      .addEventListener('pointerdown', (e) => {
        e.preventDefault();
        this.input.pressEdge('interact');
      });
    document.getElementById('minimap')!.addEventListener('pointerdown', (e) => {
      e.preventDefault();
      map.toggleOverlay();
    });
    document.getElementById('map-overlay')!.addEventListener('pointerdown', () => {
      map.toggleOverlay();
    });

    canvas.addEventListener('pointerdown', this.onDown);
    canvas.addEventListener('pointermove', this.onMove);
    canvas.addEventListener('pointerup', this.onEnd);
    canvas.addEventListener('pointercancel', this.onEnd);
  }

  private readonly onDown = (e: PointerEvent): void => {
    if (e.pointerType !== 'touch') return;
    e.preventDefault();
    // Keep receiving moves even when the finger drifts over HUD elements.
    (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
    if (e.clientX < window.innerWidth * 0.45 && this.stickId === null) {
      // The stick floats: it appears where the thumb lands.
      this.stickId = e.pointerId;
      this.stickCX = e.clientX;
      this.stickCY = e.clientY;
      this.stick.style.left = `${e.clientX - 62}px`;
      this.stick.style.top = `${e.clientY - 62}px`;
      this.stick.classList.remove('hidden');
      this.nub.style.transform = 'translate(0px, 0px)';
    } else if (this.lookId === null) {
      this.lookId = e.pointerId;
      this.lastLookX = e.clientX;
      this.lastLookY = e.clientY;
    }
  };

  private readonly onMove = (e: PointerEvent): void => {
    if (e.pointerId === this.stickId) {
      const R = 56;
      let dx = e.clientX - this.stickCX;
      let dy = e.clientY - this.stickCY;
      const mag = Math.hypot(dx, dy);
      if (mag > R) {
        dx *= R / mag;
        dy *= R / mag;
      }
      this.nub.style.transform = `translate(${dx}px, ${dy}px)`;
      this.input.touchMoveS = dx / R;
      this.input.touchMoveF = -dy / R;
    } else if (e.pointerId === this.lookId) {
      // Right-half drags steer like holding right-mouse.
      this.input.lookDX += (e.clientX - this.lastLookX) * 2.2;
      this.input.lookDY += (e.clientY - this.lastLookY) * 2.2;
      this.lastLookX = e.clientX;
      this.lastLookY = e.clientY;
    }
  };

  private readonly onEnd = (e: PointerEvent): void => {
    if (e.pointerId === this.stickId) {
      this.stickId = null;
      this.input.touchMoveS = 0;
      this.input.touchMoveF = 0;
      this.stick.classList.add('hidden');
    } else if (e.pointerId === this.lookId) {
      this.lookId = null;
    }
  };
}
