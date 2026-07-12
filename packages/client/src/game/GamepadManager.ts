import type { InputManager } from './InputManager.js';

/** Standard-mapping button indices (Xbox naming). */
const BTN = {
  A: 0,
  B: 1,
  X: 2,
  Y: 3,
  LB: 4,
  RB: 5,
  LT: 6,
  RT: 7,
  SELECT: 8,
  START: 9,
  DPAD_UP: 12,
  DPAD_DOWN: 13,
  DPAD_LEFT: 14,
  DPAD_RIGHT: 15,
} as const;

const DEADZONE = 0.18;

/** Deadzone + a gentle response curve so small deflections aim finely. */
function shaped(v: number): number {
  const a = Math.abs(v);
  if (a < DEADZONE) return 0;
  const t = (a - DEADZONE) / (1 - DEADZONE);
  return Math.sign(v) * t * t;
}

/**
 * Gamepad layer, polled once per frame. Left stick moves, right stick steers
 * character + camera (WoW right-mouse style). A jump · B roll · X loot ·
 * Y spell 4 · LT/LB/RB spells 1–3 · RT slap (held) · d-pad heal/item/swaps ·
 * Start menu · Select map. Everything funnels into the same InputManager
 * state the keyboard uses, so the sim can't tell the difference.
 */
export class GamepadManager {
  private prev: boolean[] = [];
  private lastActive = -Infinity;

  /** Pad input seen recently — spells then aim along the facing, not the mouse. */
  get recentlyActive(): boolean {
    return performance.now() - this.lastActive < 2000;
  }

  /**
   * Read the first connected pad. While `menuOnly` (pause open), only Start
   * gets through, so you can't cast from inside the menu.
   */
  poll(
    input: InputManager,
    menuOnly: boolean,
    onMenu: () => void,
    onMap: () => void,
  ): { lookX: number; lookY: number } {
    const pad = navigator.getGamepads?.().find((p) => p !== null) ?? null;
    if (!pad) {
      input.padMoveF = 0;
      input.padMoveS = 0;
      input.padMelee = false;
      return { lookX: 0, lookY: 0 };
    }
    const pressed = (i: number): boolean => pad.buttons[i]?.pressed ?? false;
    const edge = (i: number): boolean => pressed(i) && !this.prev[i];

    if (edge(BTN.START)) onMenu();
    let lookX = 0;
    let lookY = 0;
    if (menuOnly) {
      input.padMoveF = 0;
      input.padMoveS = 0;
      input.padMelee = false;
    } else {
      input.padMoveS = shaped(pad.axes[0] ?? 0);
      input.padMoveF = -shaped(pad.axes[1] ?? 0);
      lookX = shaped(pad.axes[2] ?? 0);
      lookY = shaped(pad.axes[3] ?? 0);
      input.padMelee = pressed(BTN.RT);
      if (edge(BTN.A)) input.pressEdge('jump');
      if (edge(BTN.B)) input.pressEdge('roll');
      if (edge(BTN.X)) input.pressEdge('interact');
      if (edge(BTN.DPAD_UP)) input.pressEdge('heal');
      if (edge(BTN.DPAD_DOWN)) input.pressEdge('useItem');
      if (edge(BTN.DPAD_LEFT)) input.pressEdge('swapOffense');
      if (edge(BTN.DPAD_RIGHT)) input.pressEdge('swapUtility');
      if (edge(BTN.LT)) input.pressSlot(0);
      if (edge(BTN.LB)) input.pressSlot(1);
      if (edge(BTN.RB)) input.pressSlot(2);
      if (edge(BTN.Y)) input.pressSlot(3);
      if (edge(BTN.SELECT)) onMap();
    }

    if (
      input.padMoveS !== 0 ||
      input.padMoveF !== 0 ||
      lookX !== 0 ||
      lookY !== 0 ||
      pad.buttons.some((b) => b.pressed)
    ) {
      this.lastActive = performance.now();
    }
    this.prev = pad.buttons.map((b) => b.pressed);
    return { lookX, lookY };
  }
}
