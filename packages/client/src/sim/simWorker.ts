import { GameSim, TICK_DT, type GameSimOptions, type InputCommand } from '@claudestorm/shared';

let sim: GameSim | null = null;
let timer: ReturnType<typeof setTimeout> | undefined;
let nextTickTime = 0;

type WorkerMsg =
  | { type: 'start'; opts: GameSimOptions }
  | { type: 'input'; playerId: number; cmd: InputCommand }
  | { type: 'stop' };

const TICK_MS = TICK_DT * 1000;

/**
 * setInterval drifts: each callback is scheduled relative to when the
 * *previous* one actually ran, not a fixed clock, so any jitter (a slow
 * tick, a GC pause) compounds instead of correcting. This schedules each
 * tick against an absolute target time instead, so a late tick shortens the
 * next delay to catch back up — snapshots land on schedule instead of
 * drifting, which is what the client's render-side interpolation buffer
 * needs to avoid stalling on stale data.
 */
function scheduleNextTick(): void {
  const now = performance.now();
  nextTickTime += TICK_MS;
  // Fell far behind (backgrounded, a long pause): catching up tick-by-tick
  // would just fire a burst of ticks back-to-back. Resync instead.
  if (nextTickTime < now - TICK_MS * 4) nextTickTime = now + TICK_MS;
  timer = setTimeout(runTick, Math.max(0, nextTickTime - now));
}

function runTick(): void {
  if (!sim) return;
  self.postMessage({ type: 'snapshot', snap: sim.step() });
  scheduleNextTick();
}

self.onmessage = (e: MessageEvent<WorkerMsg>) => {
  const msg = e.data;
  if (msg.type === 'start') {
    sim = new GameSim(msg.opts);
    nextTickTime = performance.now();
    scheduleNextTick();
  } else if (msg.type === 'input') {
    sim?.applyInput(msg.playerId, msg.cmd);
  } else if (msg.type === 'stop') {
    clearTimeout(timer);
    sim = null;
  }
};
