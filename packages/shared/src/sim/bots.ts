import type { InputCommand } from '../protocol/types.js';
import type { PlayerEntity } from './entities.js';
import type { Rng } from '../math/rng.js';
import { ABILITIES } from './abilities.js';
import { dist, norm, yawToward } from '../math/vec.js';

export interface BotContext {
  tick: number;
  rng: Rng;
  players: Iterable<PlayerEntity>;
  storm: { x: number; z: number; radius: number };
}

function noButtons() {
  return {
    melee: false,
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
  const st = bot.bot!;
  const buttons = noButtons();
  const slotCasts: number[] = [];
  let moveX = 0;
  let moveZ = 0;
  let aimX = bot.aimX;
  let aimZ = bot.aimZ;
  let yaw = bot.yaw;

  // Drop phase: steer toward the chosen landing spot.
  if (bot.gliding) {
    const dir = norm(st.landTargetX - bot.x, st.landTargetZ - bot.z);
    return {
      seq: tick,
      moveX: dir.x,
      moveZ: dir.z,
      yaw: yawToward(bot.x, bot.z, st.landTargetX, st.landTargetZ),
      aimX: st.landTargetX,
      aimZ: st.landTargetZ,
      buttons,
      slotCasts,
    };
  }

  // Everyone has the builtin heal — use it when hurt.
  if (bot.healCdTicks === 0 && bot.hp < bot.maxHp * 0.45) buttons.heal = true;
  // Snack on the chicken when hurt; save mobility items for the storm (below).
  if (bot.item === 'chickenCoup' && bot.hp < bot.maxHp * 0.55) buttons.useItem = true;

  let target: PlayerEntity | null = null;
  let targetDist = Infinity;
  for (const p of ctx.players) {
    if (p.id === bot.id || !p.alive || p.stealthTicks > 0) continue;
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
  const stormDanger = distFromCenter > storm.radius - 5;

  if (stormDanger) {
    const dir = norm(storm.x - bot.x, storm.z - bot.z);
    moveX = dir.x;
    moveZ = dir.z;
    yaw = yawToward(bot.x, bot.z, storm.x, storm.z);
    aimX = bot.x + dir.x * 8;
    aimZ = bot.z + dir.z * 8;
    if (distFromCenter > storm.radius && bot.rollCdTicks === 0) buttons.roll = true;
    if (
      distFromCenter > storm.radius &&
      (bot.item === 'mechanoHog' || bot.item === 'gravityLauncher')
    ) {
      buttons.useItem = true;
    }
  } else if (target && targetDist < 30) {
    // Engage: face the target, imperfect aim that worsens with range.
    yaw = yawToward(bot.x, bot.z, target.x, target.z);
    const spread = Math.min(3, targetDist * 0.12);
    aimX = target.x + rng.range(-spread, spread);
    aimZ = target.z + rng.range(-spread, spread);

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
      if (inRange && rng.next() < 0.45) slotCasts.push(i);
    }
    // Utility: chains at mid range, defensive tools when hurt, traps/CC up close.
    for (const slot of [2, 3]) {
      const utility = bot.slots.utility[slot - 2];
      if (!utility || bot.slotCds[slot]! > 0) continue;
      const def = ABILITIES[utility.abilityId];
      if (def.pull && targetDist > 7 && targetDist < 16 && rng.next() < 0.4) slotCasts.push(slot);
      else if (def.behavior === 'shield' && bot.hp < 45 && rng.next() < 0.5) slotCasts.push(slot);
      else if (def.behavior === 'buff' && bot.hp < 40 && rng.next() < 0.5) slotCasts.push(slot);
      else if (def.behavior === 'leap' && bot.hp < 35 && rng.next() < 0.35) slotCasts.push(slot);
      else if (def.behavior === 'trap' && targetDist < 12 && rng.next() < 0.2) slotCasts.push(slot);
      else if (def.behavior === 'groundAoE' && targetDist < (def.aoeRadius ?? 4) + 1 && rng.next() < 0.35)
        slotCasts.push(slot);
      else if (def.behavior === 'projectile' && !def.pull && targetDist < 18 && rng.next() < 0.3)
        slotCasts.push(slot);
    }
    if (bot.rollCdTicks === 0 && rng.next() < 0.02) buttons.roll = true;

    if (tick >= st.nextDecisionTick) {
      st.strafeSign = rng.next() < 0.5 ? 1 : -1;
      st.nextDecisionTick = tick + rng.int(20, 60);
    }
    const toTarget = norm(target.x - bot.x, target.z - bot.z);
    if (targetDist > 14) {
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
    // Roam toward a waypoint inside the safe circle.
    if (dist(bot.x, bot.z, st.waypointX, st.waypointZ) < 2.5 || tick >= st.nextDecisionTick) {
      const maxR = Math.max(5, storm.radius - 8);
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

  return { seq: tick, moveX, moveZ, yaw, aimX, aimZ, buttons, slotCasts };
}
