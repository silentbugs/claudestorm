import { SNAPSHOT_INTERP_TICKS, TICK_DT, type Snapshot } from '@claudestorm/shared';

export interface SampledState {
  prev: Snapshot;
  next: Snapshot;
  t: number;
}

/** Buffers snapshots and advances a render clock a couple of ticks behind the sim. */
export class SnapshotBuffer {
  private snaps: Snapshot[] = [];
  private renderTime = -1;
  /**
   * Set by the last sample() call when the render clock caught up to the
   * newest buffered snapshot — there's nothing fresher to interpolate
   * toward, so that frame renders the same position as the one before it.
   * The render loop still runs on schedule (rAF-measured FPS looks fine);
   * this is the stall an FPS counter can't see on its own.
   */
  stalled = false;

  get latest(): Snapshot | null {
    return this.snaps.length > 0 ? this.snaps[this.snaps.length - 1]! : null;
  }

  push(snap: Snapshot): void {
    this.snaps.push(snap);
    if (this.snaps.length > 60) this.snaps.shift();
    if (this.renderTime < 0) {
      this.renderTime = snap.time - SNAPSHOT_INTERP_TICKS * TICK_DT;
    }
  }

  advance(dt: number): void {
    const latest = this.latest;
    if (!latest || this.renderTime < 0) return;
    this.renderTime += dt;
    const target = latest.time - SNAPSHOT_INTERP_TICKS * TICK_DT;
    const drift = target - this.renderTime;
    if (Math.abs(drift) > 0.3) this.renderTime = target;
    else this.renderTime += drift * 0.05;
  }

  sample(): SampledState | null {
    if (this.snaps.length === 0) return null;
    let prev = this.snaps[0]!;
    let next = this.snaps[this.snaps.length - 1]!;
    this.stalled = false;
    if (this.renderTime <= prev.time) {
      next = prev;
    } else if (this.renderTime >= next.time) {
      prev = next;
      this.stalled = true;
    } else {
      for (let i = this.snaps.length - 1; i > 0; i--) {
        if (this.snaps[i - 1]!.time <= this.renderTime) {
          prev = this.snaps[i - 1]!;
          next = this.snaps[i]!;
          break;
        }
      }
    }
    const span = next.time - prev.time;
    const t = span > 1e-9 ? (this.renderTime - prev.time) / span : 0;
    return { prev, next, t };
  }

  reset(): void {
    this.snaps = [];
    this.renderTime = -1;
  }
}
