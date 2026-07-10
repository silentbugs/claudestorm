import type { InputCommand } from '@claudestorm/shared';

/**
 * WoW-style controls: free cursor for aiming, hold right-mouse to look around,
 * WASD camera-relative movement. Edge presses are accumulated so taps between
 * command sends are never lost; melee (R) is a held state.
 */
export class InputManager {
  private keys = new Set<string>();
  private pendingEdges = new Set<
    'roll' | 'jump' | 'interact' | 'heal' | 'useItem' | 'swapOffense' | 'swapUtility'
  >();
  private pendingSlots = new Set<number>();
  private seq = 0;
  private rmbHeld = false;
  private lmbHeld = false;

  mouseX = 0;
  mouseY = 0;
  /** Accumulated look deltas (right mouse: turns the character) — consumed by the camera. */
  lookDX = 0;
  lookDY = 0;
  /** Accumulated orbit deltas (left mouse: camera only, character keeps facing). */
  orbitDX = 0;
  orbitDY = 0;
  /** Accumulated wheel delta — consumed by the camera. */
  zoomDelta = 0;

  private readonly onKeyDown = (e: KeyboardEvent) => {
    if (e.repeat) return;
    this.keys.add(e.code);
    switch (e.code) {
      case 'Space':
        this.pendingEdges.add('jump');
        e.preventDefault();
        break;
      case 'ShiftLeft':
      case 'ShiftRight':
        this.pendingEdges.add('roll');
        break;
      case 'KeyF':
        this.pendingEdges.add('interact');
        break;
      case 'KeyH':
        this.pendingEdges.add('heal');
        break;
      case 'KeyG':
        this.pendingEdges.add('useItem');
        break;
      case 'KeyZ':
        this.pendingEdges.add('swapOffense');
        break;
      case 'KeyX':
        this.pendingEdges.add('swapUtility');
        break;
      case 'Digit1':
        this.pendingSlots.add(0);
        break;
      case 'Digit2':
        this.pendingSlots.add(1);
        break;
      case 'Digit3':
        this.pendingSlots.add(2);
        break;
      case 'Digit4':
        this.pendingSlots.add(3);
        break;
    }
  };

  private readonly onKeyUp = (e: KeyboardEvent) => {
    this.keys.delete(e.code);
  };

  private readonly onMouseMove = (e: MouseEvent) => {
    this.mouseX = e.clientX;
    this.mouseY = e.clientY;
    if (this.rmbHeld) {
      this.lookDX += e.movementX;
      this.lookDY += e.movementY;
    } else if (this.lmbHeld) {
      this.orbitDX += e.movementX;
      this.orbitDY += e.movementY;
    }
  };

  private readonly onMouseDown = (e: MouseEvent) => {
    if (e.button === 2) {
      this.rmbHeld = true;
      // Lock the pointer while turning: raw deltas, no cursor drift, and no
      // browser context menu — including Firefox's shift+right-click, which
      // ignores preventDefault. Only when the press lands on the game canvas.
      if (e.target instanceof HTMLCanvasElement) {
        try {
          const lock = e.target.requestPointerLock() as Promise<void> | undefined;
          void lock?.catch(() => {});
        } catch {
          // Denied (e.g. re-lock throttling) — mouse-look still works unlocked.
        }
      }
    }
    if (e.button === 0) this.lmbHeld = true;
  };

  private readonly onMouseUp = (e: MouseEvent) => {
    if (e.button === 2) {
      this.rmbHeld = false;
      if (document.pointerLockElement) document.exitPointerLock();
    }
    if (e.button === 0) this.lmbHeld = false;
  };

  private readonly onWheel = (e: WheelEvent) => {
    this.zoomDelta += e.deltaY;
  };

  private readonly onBlur = () => {
    this.keys.clear();
    this.rmbHeld = false;
    this.lmbHeld = false;
  };

  attach(): void {
    window.addEventListener('keydown', this.onKeyDown);
    window.addEventListener('keyup', this.onKeyUp);
    window.addEventListener('mousemove', this.onMouseMove);
    window.addEventListener('mousedown', this.onMouseDown);
    window.addEventListener('mouseup', this.onMouseUp);
    window.addEventListener('wheel', this.onWheel, { passive: true });
    window.addEventListener('blur', this.onBlur);
    window.addEventListener('contextmenu', (e) => e.preventDefault());
  }

  detach(): void {
    window.removeEventListener('keydown', this.onKeyDown);
    window.removeEventListener('keyup', this.onKeyUp);
    window.removeEventListener('mousemove', this.onMouseMove);
    window.removeEventListener('mousedown', this.onMouseDown);
    window.removeEventListener('mouseup', this.onMouseUp);
    window.removeEventListener('wheel', this.onWheel);
    window.removeEventListener('blur', this.onBlur);
  }

  get isLooking(): boolean {
    return this.rmbHeld;
  }

  /** Consume accumulated look/orbit/zoom deltas. */
  takeLook(): { dx: number; dy: number; odx: number; ody: number; zoom: number } {
    const out = {
      dx: this.lookDX,
      dy: this.lookDY,
      odx: this.orbitDX,
      ody: this.orbitDY,
      zoom: this.zoomDelta,
    };
    this.lookDX = 0;
    this.lookDY = 0;
    this.orbitDX = 0;
    this.orbitDY = 0;
    this.zoomDelta = 0;
    return out;
  }

  /** Build the next command; consumes accumulated edge presses. */
  buildCommand(camYaw: number, aimX: number, aimZ: number): InputCommand {
    const fwd = (this.keys.has('KeyW') ? 1 : 0) - (this.keys.has('KeyS') ? 1 : 0);
    const strafe = (this.keys.has('KeyD') ? 1 : 0) - (this.keys.has('KeyA') ? 1 : 0);
    // forward = (sin yaw, cos yaw); screen-right = (-cos yaw, sin yaw)
    const fx = Math.sin(camYaw);
    const fz = Math.cos(camYaw);
    let moveX = fx * fwd + -fz * strafe;
    let moveZ = fz * fwd + fx * strafe;
    const mag = Math.hypot(moveX, moveZ);
    if (mag > 1) {
      moveX /= mag;
      moveZ /= mag;
    }
    const cmd: InputCommand = {
      seq: this.seq++,
      moveX,
      moveZ,
      yaw: camYaw,
      aimX,
      aimZ,
      buttons: {
        melee: this.keys.has('KeyR'),
        roll: this.pendingEdges.has('roll'),
        jump: this.pendingEdges.has('jump'),
        interact: this.pendingEdges.has('interact'),
        heal: this.pendingEdges.has('heal'),
        useItem: this.pendingEdges.has('useItem'),
        swapOffense: this.pendingEdges.has('swapOffense'),
        swapUtility: this.pendingEdges.has('swapUtility'),
      },
      slotCasts: [...this.pendingSlots],
    };
    this.pendingEdges.clear();
    this.pendingSlots.clear();
    return cmd;
  }
}
