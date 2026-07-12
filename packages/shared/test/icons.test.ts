import { describe, expect, it } from 'vitest';
import { ABILITIES } from '../src/sim/abilities.js';
import { ITEMS } from '../src/sim/items.js';

describe('icons', () => {
  it('every spell, item, and builtin shows a unique icon — no two drops look alike', () => {
    const builtins = ['👋', '💚', '🤸']; // slap, heal, roll (Hud)
    const icons = [
      ...Object.values(ABILITIES).map((d) => d.icon),
      ...Object.values(ITEMS).map((d) => d.icon),
      ...builtins,
    ];
    const seen = new Map<string, number>();
    for (const icon of icons) seen.set(icon, (seen.get(icon) ?? 0) + 1);
    const dupes = [...seen.entries()].filter(([, n]) => n > 1).map(([icon]) => icon);
    expect(dupes).toEqual([]);
  });
});
