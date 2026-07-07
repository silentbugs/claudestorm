export const TICK_RATE = 20;
export const TICK_DT = 1 / TICK_RATE;

export const PLAYER_RADIUS = 0.5;
export const PLAYER_SPEED = 8;
export const PLAYER_BASE_HP = 100;

export const SNAPSHOT_INTERP_TICKS = 2;

/** Sword auto-attack. */
export const MELEE_RANGE = 2.6;
/** Cosine of half the swing arc (120° total). */
export const MELEE_ARC_COS = 0.5;
export const MELEE_DAMAGE = 12;
export const MELEE_INTERVAL = 0.55;
export const MELEE_COMBO_WINDOW = 1.4;
export const MELEE_COMBO_FINISHER_MULT = 1.8;

/** Barrel roll: quick dodge with projectile immunity. */
export const ROLL_DISTANCE = 7;
export const ROLL_DURATION = 0.35;
export const ROLL_COOLDOWN = 4;

export const JUMP_VELOCITY = 7.5;
export const GRAVITY = 22;

/** Drop-in glide at match start. */
export const DROP_START_Y = 90;
export const GLIDE_FALL_SPEED = 9;
export const GLIDE_MOVE_SPEED = 16;
export const DROP_TIMEOUT_SECONDS = 12;

/** Leveling: plunder/XP gathered mid-match. */
export const XP_THRESHOLDS = [0, 40, 90, 150, 220, 300, 390, 490];
export const MAX_LEVEL = XP_THRESHOLDS.length;
export const LEVEL_HP_BONUS = 10;
export const LEVEL_DAMAGE_BONUS = 0.08;

export const XP_PER_COIN = 5;
export const XP_PER_MOB = 30;
export const XP_PER_CHEST = 20;
export const XP_PER_PLAYER_KILL = 100;

export const COIN_PICKUP_RADIUS = 2.2;
export const SCROLL_AUTO_PICKUP_RADIUS = 1.4;
export const INTERACT_RADIUS = 2.6;
export const CHEST_CHANNEL_SECONDS = 1.5;

/** Mobs (wild creatures that drop loot). */
export const MOB_HP = 40;
export const MOB_SPEED = 5.5;
export const MOB_AGGRO_RADIUS = 9;
export const MOB_LEASH_RADIUS = 22;
export const MOB_BITE_RANGE = 1.4;
export const MOB_BITE_DAMAGE = 6;
export const MOB_BITE_INTERVAL = 1.0;
export const MOB_RADIUS = 0.55;

export function levelDamageMult(level: number): number {
  return 1 + LEVEL_DAMAGE_BONUS * (level - 1);
}
