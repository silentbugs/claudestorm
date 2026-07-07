import { GameSim, TICK_DT, type GameSimOptions, type InputCommand } from '@claudestorm/shared';

let sim: GameSim | null = null;
let timer: ReturnType<typeof setInterval> | undefined;

type WorkerMsg =
  | { type: 'start'; opts: GameSimOptions }
  | { type: 'input'; playerId: number; cmd: InputCommand }
  | { type: 'stop' };

self.onmessage = (e: MessageEvent<WorkerMsg>) => {
  const msg = e.data;
  if (msg.type === 'start') {
    sim = new GameSim(msg.opts);
    timer = setInterval(() => {
      if (sim) self.postMessage({ type: 'snapshot', snap: sim.step() });
    }, TICK_DT * 1000);
  } else if (msg.type === 'input') {
    sim?.applyInput(msg.playerId, msg.cmd);
  } else if (msg.type === 'stop') {
    clearInterval(timer);
    sim = null;
  }
};
