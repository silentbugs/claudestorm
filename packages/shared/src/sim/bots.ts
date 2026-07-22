import type { InputCommand } from '../protocol/types.js';
import type { PlayerEntity } from './entities.js';
import type { Rng } from '../math/rng.js';
import { ABILITIES } from './abilities.js';
import { dist, norm, yawToward } from '../math/vec.js';

export type BotDifficulty = 'easy' | 'normal' | 'hard';

/** Knobs per difficulty: aim scatter, trigger discipline, and awareness range. */
const DIFFICULTY: Record<BotDifficulty, { spread: number; cast: number; engage: number }> = {
  easy: { spread: 2.1, cast: 0.55, engage: 24 },
  normal: { spread: 1, cast: 1, engage: 30 },
  hard: { spread: 0.45, cast: 1.5, engage: 34 },
};

export interface BotContext {
  tick: number;
  rng: Rng;
  players: Iterable<PlayerEntity>;
  storm: { x: number; z: number; radius: number };
  difficulty: BotDifficulty;
}

function noButtons() {
  return {
    melee: false,
    dive: false,
    roll: false,
    jump: false,
    interact: false,
    heal: false,
    useItem: false,
    swapOffense: false,
    swapUtility: false,
  };
}

/**
 * Bots steer through the exact same InputCommand path as the human player,
 * which keeps them interchangeable with remote players once real netcode lands.
 */
export function computeBotInput(bot: PlayerEntity, ctx: BotContext): InputCommand {
  const { tick, rng, storm } = ctx;
  const diff = DIFFICULTY[ctx.difficulty];
  const st = bot.bot!;
  const buttons = noButtons();
  const slotCasts: number[] = [];
  let moveX = 0;
  let moveZ = 0;
  let aimX = bot.aimX;
  let aimZ = bot.aimZ;
  let yaw = bot.yaw;

  // Drop phase: steer toward the chosen landing spot, occasionally
  // reconsidering it, and diving in once lined up to beat rivals down.
  if (bot.gliding) {
    // Re-scout periodically while still high enough for a change of heart to
    // matter: if other gliders are piling onto the same spot, peel off
    // toward a fresh one instead of landing in a crowd.
    if (bot.y > 60 && tick >= st.nextLandCheckTick) {
      st.nextLandCheckTick = tick + rng.int(60, 100);
      let crowding = 0;
      for (const p of ctx.players) {
        if (p.id === bot.id || !p.alive || !p.gliding || p.teamId === bot.teamId) continue;
        if (dist(p.x, p.z, st.landTargetX, st.landTargetZ) < 25) crowding++;
      }
      if (crowding >= 2) {
        const angle = rng.range(0, Math.PI * 2);
        const r = rng.range(20, 45);
        st.landTargetX += Math.cos(angle) * r;
        st.landTargetZ += Math.sin(angle) * r;
      }
    }

    const d = dist(bot.x, bot.z, st.landTargetX, st.landTargetZ);
    // Already over the spot: hold course and drop in fast — steering from
    // here flips the direction every tick and the bot pirouettes all the
    // way down, and there's no reason to drift lazily once lined up.
    if (d < 2.5) {
      buttons.dive = true;
      return { seq: tick, moveX: 0, moveZ: 0, yaw: bot.yaw, aimX: bot.aimX, aimZ: bot.aimZ, buttons, slotCasts };
    }
    const ease = Math.min(1, d / 8); // slow the approach so it doesn't overshoot
    const dir = norm(st.landTargetX - bot.x, st.landTargetZ - bot.z);
    // Close enough to commit: dive the rest of the way in.
    if (d < 10) buttons.dive = true;
    return {
      seq: tick,
      moveX: dir.x * ease,
      moveZ: dir.z * ease,
      yaw: yawToward(bot.x, bot.z, st.landTargetX, st.landTargetZ),
      aimX: st.landTargetX,
      aimZ: st.landTargetZ,
      buttons,
      slotCasts,
    };
  }

  // Snack on the chicken when hurt; save mobility items for the storm (below).
  if (bot.item === 'chickenCoup' && bot.hp < bot.maxHp * 0.55) buttons.useItem = true;

  let target: PlayerEntity | null = null;
  let targetDist = Infinity;
  for (const p of ctx.players) {
    if (p.id === bot.id || !p.alive || p.stealthTicks > 0 || p.teamId === bot.teamId) continue;
    const d = dist(bot.x, bot.z, p.x, p.z);
    if (d < targetDist) {
      targetDist = d;
      target = p;
    }
  }

  // Mid-charge: keep facing the target and release once charged enough.
  if (bot.chargeSlot !== null) {
    if (target) {
      yaw = yawToward(bot.x, bot.z, target.x, target.z);
      aimX = target.x;
      aimZ = target.z;
    }
    if (bot.chargeTicks >= bot.chargeMaxTicks * 0.7) slotCasts.push(bot.chargeSlot);
    return { seq: tick, moveX: 0, moveZ: 0, yaw, aimX, aimZ, buttons, slotCasts };
  }

  const distFromCenter = dist(bot.x, bot.z, storm.x, storm.z);
  // Safety margin shrinks with the circle — a flat 5m would swallow the whole
  // final circle and leave every bot permanently "fleeing" to the exact center.
  const margin = Math.min(5, storm.radius * 0.3);
  const stormDanger = distFromCenter > storm.radius - margin;

  // Heal strategically: only once the fight has broken off — channeling in
  // combat just hands the enemy an interrupt. Below 30% HP that patience
  // becomes a liability of its own (a shrinking endgame circle keeps
  // "stormDanger"/"retreating" true almost everywhere except dead center,
  // which otherwise locks a cornered bot out of healing entirely while it
  // bleeds out) — desperate bots heal the moment no one can interrupt them,
  // storm position be damned.
  const inCombat = target !== null && targetDist < diff.engage + 8;
  const desperate = bot.hp < bot.maxHp * 0.3;
  if (
    bot.healCdTicks === 0 &&
    bot.healCastTicks === 0 &&
    !inCombat &&
    (desperate || (bot.hp < bot.maxHp * 0.7 && !stormDanger && !st.retreating))
  ) {
    buttons.heal = true;
  }

  // Storm retreat is a commitment: pick a point well inside the circle once
  // and walk to it. Re-deciding every tick made bots jitter in place at the
  // danger line, stepping in and out of the band forever.
  if (st.retreating) {
    const goalStillSafe =
      dist(st.retreatX, st.retreatZ, storm.x, storm.z) < storm.radius - margin;
    if (!goalStillSafe || dist(bot.x, bot.z, st.retreatX, st.retreatZ) < 2.5) {
      st.retreating = false; // arrived, or the circle moved on — re-evaluate
    }
  }
  if (!st.retreating && stormDanger) {
    st.retreating = true;
    // Deep inside, biased toward this bot's own side with lateral spread so
    // the endgame doesn't funnel everyone onto one spot.
    const out = norm(bot.x - storm.x, bot.z - storm.z);
    const turn = rng.range(-0.9, 0.9);
    const cos = Math.cos(turn);
    const sin = Math.sin(turn);
    const safeR = Math.max(0, storm.radius - Math.max(10, margin * 3)) * rng.range(0.5, 0.95);
    st.retreatX = storm.x + (out.x * cos - out.z * sin) * safeR;
    st.retreatZ = storm.z + (out.x * sin + out.z * cos) * safeR;
  }

  if (st.retreating) {
    const dir = norm(st.retreatX - bot.x, st.retreatZ - bot.z);
    moveX = dir.x;
    moveZ = dir.z;
    yaw = yawToward(bot.x, bot.z, st.retreatX, st.retreatZ);
    aimX = bot.x + dir.x * 8;
    aimZ = bot.z + dir.z * 8;
    if (distFromCenter > storm.radius && bot.rollCdTicks === 0) buttons.roll = true;
    if (
      distFromCenter > storm.radius &&
      (bot.item === 'mechanoHog' || bot.item === 'gravityLauncher' || bot.item === 'toTheSkies')
    ) {
      // Redeploying mid-match: glide toward the safe circle.
      if (bot.item === 'toTheSkies') {
        st.landTargetX = storm.x;
        st.landTargetZ = storm.z;
      }
      buttons.useItem = true;
    }
  } else if (target && targetDist < diff.engage && bot.healCastTicks === 0) {
    // Engage: face the target with imperfect aim that worsens with range and
    // improves with difficulty. Spells fire along facing, so the miss lives
    // in the yaw, not the aim point.
    const spread = Math.min(3, targetDist * 0.12) * diff.spread;
    aimX = target.x + rng.range(-spread, spread);
    aimZ = target.z + rng.range(-spread, spread);
    yaw = yawToward(bot.x, bot.z, aimX, aimZ);

    if (targetDist < 2.4) buttons.melee = true;

    // Fire whatever offense slots are ready and in range for their behavior.
    for (let i = 0; i < 2; i++) {
      const equipped = bot.slots.offense[i];
      if (!equipped || bot.slotCds[i]! > 0) continue;
      const def = ABILITIES[equipped.abilityId];
      const inRange =
        def.behavior === 'selfAura'
          ? targetDist < (def.auraRadius ?? 3) + 2.5
          : def.behavior === 'groundAoE'
            ? targetDist < Math.max(def.castRange ?? 20, (def.aoeRadius ?? 0) + 1)
            : def.behavior === 'cone'
              ? targetDist < (def.coneRange ?? 3) + 0.5
              : def.behavior === 'leap'
                ? targetDist > 3 && targetDist < (def.leapRange ?? 10) + 2
                : targetDist < 26;
      if (inRange && rng.next() < 0.45 * diff.cast) slotCasts.push(i);
    }
    // Utility: chains at mid range, defensive tools when hurt, traps/CC up close.
    for (const slot of [2, 3]) {
      const utility = bot.slots.utility[slot - 2];
      if (!utility || bot.slotCds[slot]! > 0) continue;
      const def = ABILITIES[utility.abilityId];
      if (def.pull && targetDist > 7 && targetDist < 16 && rng.next() < 0.4 * diff.cast) slotCasts.push(slot);
      else if (def.behavior === 'shield' && bot.hp < 45 && rng.next() < 0.5 * diff.cast) slotCasts.push(slot);
      else if (def.behavior === 'buff' && bot.hp < 40 && rng.next() < 0.5 * diff.cast) slotCasts.push(slot);
      else if (def.behavior === 'leap' && bot.hp < 35 && rng.next() < 0.35 * diff.cast) slotCasts.push(slot);
      else if (def.behavior === 'trap' && targetDist < 12 && rng.next() < 0.2 * diff.cast) slotCasts.push(slot);
      else if (def.behavior === 'groundAoE' && targetDist < (def.aoeRadius ?? 4) + 1 && rng.next() < 0.35 * diff.cast)
        slotCasts.push(slot);
      else if (def.behavior === 'projectile' && !def.pull && targetDist < 18 && rng.next() < 0.3 * diff.cast)
        slotCasts.push(slot);
    }
    if (bot.rollCdTicks === 0 && rng.next() < 0.02 * diff.cast) buttons.roll = true;

    if (tick >= st.nextDecisionTick) {
      st.strafeSign = rng.next() < 0.5 ? 1 : -1;
      st.nextDecisionTick = tick + rng.int(20, 60);
    }
    const toTarget = norm(target.x - bot.x, target.z - bot.z);
    if (bot.hp < bot.maxHp * 0.3 && bot.healCdTicks === 0) {
      // Desperate with the heal still in pocket: disengage to drink it.
      moveX = -toTarget.x;
      moveZ = -toTarget.z;
    } else if (targetDist > 14) {
      moveX = toTarget.x;
      moveZ = toTarget.z;
    } else if (targetDist < 6 && !buttons.melee) {
      moveX = -toTarget.x;
      moveZ = -toTarget.z;
    } else if (buttons.melee) {
      moveX = toTarget.x;
      moveZ = toTarget.z;
    } else {
      moveX = -toTarget.z * st.strafeSign;
      moveZ = toTarget.x * st.strafeSign;
    }
  } else {
    // Roam toward a waypoint inside the safe circle — unless a living
    // teammate has drifted off, in which case regroup with them instead.
    // Applies to any duo (not just the human's ally), so rival teams look
    // cohesive too. Only kicks in beyond ~12m so a nearby pair doesn't
    // beeline onto each other's exact position.
    let mate: PlayerEntity | null = null;
    for (const p of ctx.players) {
      if (p.id !== bot.id && p.alive && p.teamId === bot.teamId) {
        mate = p;
        break;
      }
    }
    if (mate && dist(bot.x, bot.z, mate.x, mate.z) > 12) {
      const dir = norm(mate.x - bot.x, mate.z - bot.z);
      moveX = dir.x;
      moveZ = dir.z;
      yaw = yawToward(bot.x, bot.z, mate.x, mate.z);
      aimX = bot.x + dir.x * 8;
      aimZ = bot.z + dir.z * 8;
    } else {
      if (dist(bot.x, bot.z, st.waypointX, st.waypointZ) < 2.5 || tick >= st.nextDecisionTick) {
        // Keep waypoints clear of the danger band, even in a tiny final circle.
        const maxR = Math.max(2, storm.radius - Math.max(8, margin * 2));
        const angle = rng.range(0, Math.PI * 2);
        const r = Math.sqrt(rng.next()) * maxR;
        st.waypointX = storm.x + Math.cos(angle) * r;
        st.waypointZ = storm.z + Math.sin(angle) * r;
        st.nextDecisionTick = tick + rng.int(80, 200);
      }
      const dir = norm(st.waypointX - bot.x, st.waypointZ - bot.z);
      moveX = dir.x;
      moveZ = dir.z;
      yaw = yawToward(bot.x, bot.z, st.waypointX, st.waypointZ);
      aimX = bot.x + dir.x * 8;
      aimZ = bot.z + dir.z * 8;
    }
  }

  return { seq: tick, moveX, moveZ, yaw, aimX, aimZ, buttons, slotCasts };
}
