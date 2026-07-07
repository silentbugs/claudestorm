import type { GameSimOptions, InputCommand, Snapshot, Transport } from '@claudestorm/shared';

/**
 * Runs the authoritative sim in a Web Worker. The worker boundary forces all
 * communication through messages, exactly like the future NetworkTransport —
 * the rest of the client cannot tell the difference.
 */
export class LocalTransport implements Transport {
  private worker: Worker | null = null;

  constructor(
    private readonly opts: GameSimOptions,
    private readonly playerId: number,
  ) {}

  start(onSnapshot: (snap: Snapshot) => void): void {
    this.worker = new Worker(new URL('../sim/simWorker.ts', import.meta.url), {
      type: 'module',
    });
    this.worker.onmessage = (e: MessageEvent<{ type: string; snap: Snapshot }>) => {
      if (e.data.type === 'snapshot') onSnapshot(e.data.snap);
    };
    this.worker.postMessage({ type: 'start', opts: this.opts });
  }

  sendInput(cmd: InputCommand): void {
    this.worker?.postMessage({ type: 'input', playerId: this.playerId, cmd });
  }

  dispose(): void {
    this.worker?.postMessage({ type: 'stop' });
    this.worker?.terminate();
    this.worker = null;
  }
}
