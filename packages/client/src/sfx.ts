import type { AbilityId } from '@claudestorm/shared';

/** A world position a sound comes from; omit for UI/self sounds. */
export interface SoundAt {
  x: number;
  z: number;
}

/** Beyond this, world sounds don't play at all. */
const AUDIBLE_RANGE = 130;

/**
 * Tiny synthesized sound effects — no audio assets needed for the slice.
 * World-positioned sounds fade with distance and pan left/right based on
 * where the camera is looking.
 */
class Sfx {
  private ctx: AudioContext | null = null;
  private lastCoin = 0;
  private listenerX = 0;
  private listenerZ = 0;
  private listenerYaw = 0;
  private noiseBuf: AudioBuffer | null = null;
  private readonly glideLoops = new Map<
    number,
    { gain: GainNode; pan: StereoPannerNode; filter: BiquadFilterNode; src: AudioBufferSourceNode }
  >();

  unlock(): void {
    if (!this.ctx) this.ctx = new AudioContext();
    if (this.ctx.state === 'suspended') void this.ctx.resume();
  }

  /** Follow the player's ears: their position, the camera's heading. */
  setListener(x: number, z: number, camYaw: number): void {
    this.listenerX = x;
    this.listenerZ = z;
    this.listenerYaw = camYaw;
  }

  private tone(
    freq: number,
    duration: number,
    type: OscillatorType,
    volume: number,
    freqEnd?: number,
    at?: SoundAt,
  ): void {
    const ctx = this.ctx;
    if (!ctx || ctx.state !== 'running') return;
    let pan = 0;
    if (at) {
      const dx = at.x - this.listenerX;
      const dz = at.z - this.listenerZ;
      const d = Math.hypot(dx, dz);
      if (d > AUDIBLE_RANGE) return;
      volume *= 1 / (1 + d * d * 0.004); // ~70% at 10m, ~20% at 30m, whisper past 60m
      if (d > 0.5) {
        // Screen-right for camYaw is (-cos, sin); sounds on-top stay centered.
        pan = ((dx * -Math.cos(this.listenerYaw) + dz * Math.sin(this.listenerYaw)) / d) *
          Math.min(1, d / 6) * 0.8;
      }
    }
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    osc.type = type;
    osc.frequency.setValueAtTime(freq, ctx.currentTime);
    if (freqEnd !== undefined) {
      osc.frequency.exponentialRampToValueAtTime(Math.max(20, freqEnd), ctx.currentTime + duration);
    }
    gain.gain.setValueAtTime(volume, ctx.currentTime);
    gain.gain.exponentialRampToValueAtTime(0.0001, ctx.currentTime + duration);
    const panner = ctx.createStereoPanner();
    panner.pan.value = Math.max(-1, Math.min(1, pan));
    osc.connect(gain).connect(panner).connect(ctx.destination);
    osc.start();
    osc.stop(ctx.currentTime + duration);
  }

  /** Two seconds of white noise, looped by every wind sound. */
  private noiseBuffer(ctx: AudioContext): AudioBuffer {
    if (!this.noiseBuf) {
      const len = ctx.sampleRate * 2;
      this.noiseBuf = ctx.createBuffer(1, len, ctx.sampleRate);
      const data = this.noiseBuf.getChannelData(0);
      for (let i = 0; i < len; i++) data[i] = Math.random() * 2 - 1;
    }
    return this.noiseBuf;
  }

  /** Distance/pan for a world position, shared by tone() and the wind loops. */
  private spatial(x: number, z: number): { vol: number; pan: number } {
    const dx = x - this.listenerX;
    const dz = z - this.listenerZ;
    const d = Math.hypot(dx, dz);
    if (d > AUDIBLE_RANGE) return { vol: 0, pan: 0 };
    const vol = 1 / (1 + d * d * 0.004);
    const pan =
      d > 0.5
        ? ((dx * -Math.cos(this.listenerYaw) + dz * Math.sin(this.listenerYaw)) / d) *
          Math.min(1, d / 6) *
          0.8
        : 0;
    return { vol, pan };
  }

  /**
   * Rushing-wind loops for everyone mid-glide, called every frame with the
   * current gliders: the sky is loud with parachutes at the drop, each one
   * fading and panning with distance like every other world sound. Loops for
   * players who landed (or died) fade out and stop.
   */
  updateGlideWinds(gliders: { id: number; x: number; z: number; isSelf: boolean }[]): void {
    const ctx = this.ctx;
    if (!ctx || ctx.state !== 'running') return;
    const live = new Set<number>();
    for (const g of gliders) {
      live.add(g.id);
      let loop = this.glideLoops.get(g.id);
      if (!loop) {
        const src = ctx.createBufferSource();
        src.buffer = this.noiseBuffer(ctx);
        src.loop = true;
        // Band-passed noise reads as wind; a touch of detune per glider keeps
        // a sky full of parachutes from phasing into one flat hiss.
        const filter = ctx.createBiquadFilter();
        filter.type = 'bandpass';
        filter.frequency.value = 480 + (g.id % 5) * 60;
        filter.Q.value = 0.9;
        const gain = ctx.createGain();
        gain.gain.value = 0;
        const pan = ctx.createStereoPanner();
        src.connect(filter).connect(gain).connect(pan).connect(ctx.destination);
        src.start();
        loop = { gain, pan, filter, src };
        this.glideLoops.set(g.id, loop);
      }
      const target = g.isSelf ? { vol: 1, pan: 0 } : this.spatial(g.x, g.z);
      // Smooth per-frame retargeting; the flutter wobbles the pitch a little.
      loop.gain.gain.setTargetAtTime(0.22 * target.vol, ctx.currentTime, 0.08);
      loop.pan.pan.setTargetAtTime(target.pan, ctx.currentTime, 0.08);
      loop.filter.frequency.setTargetAtTime(
        (g.isSelf ? 520 : 480 + (g.id % 5) * 60) + Math.sin(ctx.currentTime * 2.3 + g.id) * 40,
        ctx.currentTime,
        0.1,
      );
    }
    for (const [id, loop] of this.glideLoops) {
      if (!live.has(id)) {
        loop.gain.gain.setTargetAtTime(0, ctx.currentTime, 0.12);
        loop.src.stop(ctx.currentTime + 0.6);
        this.glideLoops.delete(id);
      }
    }
  }

  cast(ability: AbilityId, at?: SoundAt): void {
    const t = (freq: number, dur: number, type: OscillatorType, vol: number, freqEnd?: number) =>
      this.tone(freq, dur, type, vol, freqEnd, at);
    switch (ability) {
      // Offense
      case 'rimeArrow':
        t(760, 0.12, 'triangle', 0.11, 1050);
        break;
      case 'fireWhirl':
        t(180, 0.4, 'sawtooth', 0.08, 320);
        break;
      case 'earthbreaker':
        t(120, 0.35, 'sawtooth', 0.12, 45);
        break;
      case 'holyShield':
        t(660, 0.2, 'triangle', 0.1, 880);
        break;
      case 'stormArchon':
        t(500, 0.14, 'square', 0.07, 900);
        break;
      case 'manaSphere':
        t(340, 0.2, 'sine', 0.12, 200);
        break;
      case 'searingAxe':
        t(200, 0.22, 'sawtooth', 0.11, 80);
        break;
      case 'slicingWinds':
        t(420, 0.18, 'sine', 0.1, 980);
        break;
      case 'starBomb':
        t(300, 0.18, 'sawtooth', 0.07, 180);
        break;
      case 'toxicSmackerel':
        t(420, 0.15, 'triangle', 0.1, 240);
        break;
      // Utility
      case 'quakingLeap':
        t(340, 0.25, 'sine', 0.12, 720);
        break;
      case 'huntersChains':
        t(900, 0.1, 'square', 0.06, 500);
        break;
      case 'steelTraps':
        t(700, 0.09, 'square', 0.07, 350);
        break;
      case 'windstorm':
        t(280, 0.25, 'sine', 0.1, 760);
        break;
      case 'explosiveCaltrops':
        t(520, 0.12, 'square', 0.08, 260);
        break;
      case 'snowdrift':
        t(980, 0.2, 'triangle', 0.1, 520);
        break;
      case 'lightningBulwark':
        t(220, 0.3, 'triangle', 0.12, 330);
        break;
      case 'fadeToShadow':
        t(300, 0.25, 'sine', 0.09, 90);
        break;
      case 'repel':
        t(540, 0.2, 'triangle', 0.11, 720);
        break;
      case 'faeform':
        t(620, 0.25, 'sine', 0.1, 1240);
        break;
    }
  }

  melee(combo: number, at?: SoundAt): void {
    const base = combo === 3 ? 340 : 280;
    this.tone(base, 0.08, 'square', 0.07, base * 0.6, at);
  }

  hit(at?: SoundAt): void {
    this.tone(220, 0.1, 'square', 0.09, 120, at);
  }

  detonate(at?: SoundAt): void {
    this.tone(140, 0.35, 'sawtooth', 0.15, 40, at);
  }

  death(isSelf: boolean, at?: SoundAt): void {
    this.tone(isSelf ? 330 : 400, 0.5, 'triangle', 0.14, 60, at);
  }

  coin(): void {
    const now = performance.now();
    if (now - this.lastCoin < 90) return;
    this.lastCoin = now;
    this.tone(1180, 0.09, 'triangle', 0.08, 1560);
  }

  heal(at?: SoundAt): void {
    this.tone(392, 0.14, 'sine', 0.12, 587, at);
    setTimeout(() => this.tone(587, 0.2, 'sine', 0.1, 784, at), 110);
  }

  levelUp(): void {
    this.tone(523, 0.12, 'triangle', 0.12);
    setTimeout(() => this.tone(784, 0.2, 'triangle', 0.12), 120);
  }

  equip(): void {
    this.tone(620, 0.12, 'sine', 0.11, 880);
  }

  chest(at?: SoundAt): void {
    this.tone(190, 0.25, 'triangle', 0.12, 320, at);
  }

  victory(): void {
    this.tone(523, 0.15, 'triangle', 0.12);
    setTimeout(() => this.tone(659, 0.15, 'triangle', 0.12), 150);
    setTimeout(() => this.tone(784, 0.3, 'triangle', 0.12), 300);
  }
}

export const sfx = new Sfx();
