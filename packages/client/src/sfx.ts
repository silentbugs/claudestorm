import { GLIDE_FALL_SPEED, GLIDE_MOVE_SPEED, type AbilityId } from '@claudestorm/shared';

/** Cruise speed used to normalize glide-wind intensity (drop dive + full lateral push). */
const GLIDE_CRUISE_SPEED = GLIDE_MOVE_SPEED + GLIDE_FALL_SPEED;

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
    {
      gain: GainNode;
      pan: StereoPannerNode;
      filter: BiquadFilterNode;
      src: AudioBufferSourceNode;
      lfo: OscillatorNode;
      lfoDepth: GainNode;
      // Motion tracking, smoothed frame to frame so the wind reacts to the
      // flight itself rather than jittering with raw per-tick deltas.
      lastX: number;
      lastZ: number;
      lastY: number;
      lastT: number;
      lastHeading: number;
      speed: number;
      turnRate: number;
    }
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

  /**
   * Two seconds of looped brown noise. White noise spreads its energy evenly
   * and reads as hiss; integrating it pushes everything down the spectrum,
   * which is the deep airy rumble of wind over fabric.
   */
  private noiseBuffer(ctx: AudioContext): AudioBuffer {
    if (!this.noiseBuf) {
      const len = ctx.sampleRate * 2;
      this.noiseBuf = ctx.createBuffer(1, len, ctx.sampleRate);
      const data = this.noiseBuf.getChannelData(0);
      let last = 0;
      for (let i = 0; i < len; i++) {
        const white = Math.random() * 2 - 1;
        last = (last + 0.02 * white) / 1.02;
        data[i] = last * 3.5;
      }
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
   * Rushing-wind loops for players mid-glide, called every frame with the
   * current gliders, each fading and panning with distance like every other
   * world sound. Noise loops stack additively, and a full 50-player drop
   * launches everyone from the same spot — unmanaged, that's a deafening
   * wall of hiss. Two guards keep it sane: only the loudest few chutes get a
   * voice at all, and the ensemble is normalized to a fixed total loudness
   * (your own chute always keeps its place). Loops for players who landed
   * (or died) fade out and stop.
   *
   * On top of that, each loop tracks its own velocity and turn rate frame to
   * frame: diving/accelerating swells the volume and brightens the filter,
   * decelerating dulls and quiets it, and a hard direction change kicks the
   * flutter deeper for a beat — the CoD-Warzone-flight feel of wind actually
   * responding to how you're flying, not just a static loop.
   */
  updateGlideWinds(gliders: { id: number; x: number; z: number; y: number; isSelf: boolean }[]): void {
    const ctx = this.ctx;
    if (!ctx || ctx.state !== 'running') return;
    // Loudest chutes first; everyone past the voice cap is dropped outright.
    const MAX_VOICES = 5;
    const voiced = gliders
      .map((g) => ({ ...g, ...(g.isSelf ? { vol: 1, pan: 0 } : this.spatial(g.x, g.z)) }))
      .filter((g) => g.vol > 0.01)
      .sort((a, b) => (b.isSelf ? 1 : 0) - (a.isSelf ? 1 : 0) || b.vol - a.vol)
      .slice(0, MAX_VOICES);
    // Normalize: alone you get full volume, a crowded sky shares one budget.
    const total = voiced.reduce((sum, g) => sum + g.vol, 0);
    const ensemble = Math.min(1, 1.4 / Math.max(1, total));
    const now = ctx.currentTime;
    const live = new Set<number>();
    for (const g of voiced) {
      live.add(g.id);
      let loop = this.glideLoops.get(g.id);
      if (!loop) {
        const src = ctx.createBufferSource();
        src.buffer = this.noiseBuffer(ctx);
        src.loop = true;
        // Low-passed brown noise: a deep canvas rumble, no hiss on top. A
        // touch of per-glider detune keeps a crowded sky from phasing.
        const filter = ctx.createBiquadFilter();
        filter.type = 'lowpass';
        filter.frequency.value = 340 + (g.id % 5) * 35;
        filter.Q.value = 0.4;
        // The cloth flap: a slow LFO pumps a flutter stage so the canopy
        // audibly beats in the wind instead of streaming evenly.
        const flutter = ctx.createGain();
        flutter.gain.value = 1;
        const lfo = ctx.createOscillator();
        lfo.frequency.value = 3.6 + (g.id % 7) * 0.45; // each chute flaps its own rhythm
        const lfoDepth = ctx.createGain();
        lfoDepth.gain.value = 0.4;
        lfo.connect(lfoDepth).connect(flutter.gain);
        lfo.start();
        const gain = ctx.createGain();
        gain.gain.value = 0;
        const pan = ctx.createStereoPanner();
        src.connect(filter).connect(flutter).connect(gain).connect(pan).connect(ctx.destination);
        src.start();
        loop = {
          gain,
          pan,
          filter,
          src,
          lfo,
          lfoDepth,
          lastX: g.x,
          lastZ: g.z,
          lastY: g.y,
          lastT: now,
          lastHeading: 0,
          speed: GLIDE_CRUISE_SPEED * 0.55, // start mid-cruise, not silent
          turnRate: 0,
        };
        this.glideLoops.set(g.id, loop);
      }
      // Instantaneous velocity from the position delta since last frame.
      const dt = Math.max(0.001, now - loop.lastT);
      const dx = g.x - loop.lastX;
      const dz = g.z - loop.lastZ;
      const dy = g.y - loop.lastY;
      const lateral = Math.hypot(dx, dz) / dt;
      const descent = Math.max(0, -dy / dt); // diving adds extra rush, climbing doesn't
      const rawSpeed = lateral + descent * 1.2;
      const heading = lateral > 0.05 ? Math.atan2(dx, dz) : loop.lastHeading;
      let headingDelta = heading - loop.lastHeading;
      // Wrap to [-pi, pi] so a heading crossing +-pi doesn't register as a spin.
      headingDelta = Math.atan2(Math.sin(headingDelta), Math.cos(headingDelta));
      const rawTurn = Math.abs(headingDelta) / dt;
      // Smooth so the sound follows the flight, not per-tick jitter.
      loop.speed += (rawSpeed - loop.speed) * Math.min(1, dt * 6);
      loop.turnRate += (rawTurn - loop.turnRate) * Math.min(1, dt * 8);
      loop.lastX = g.x;
      loop.lastZ = g.z;
      loop.lastY = g.y;
      loop.lastHeading = heading;
      loop.lastT = now;

      const norm = Math.min(1.4, loop.speed / GLIDE_CRUISE_SPEED);
      const turnBoost = Math.min(1, loop.turnRate / 3.5); // hard bank ~= full kick

      // Smooth per-frame retargeting; the slow sweep billows the timbre.
      const intensity = 0.55 + 0.75 * norm;
      loop.gain.gain.setTargetAtTime(0.3 * g.vol * ensemble * intensity, now, 0.08);
      loop.pan.pan.setTargetAtTime(g.pan, now, 0.08);
      const baseCutoff = g.isSelf ? 380 : 340 + (g.id % 5) * 35;
      loop.filter.frequency.setTargetAtTime(
        baseCutoff +
          norm * 620 +
          turnBoost * 260 +
          Math.sin(now * 0.9 + g.id) * 70,
        now,
        0.1,
      );
      // Flapping speeds up and deepens the faster/harder you're flying.
      loop.lfo.frequency.setTargetAtTime(3.2 + (g.id % 7) * 0.45 + norm * 4.5, now, 0.12);
      loop.lfoDepth.gain.setTargetAtTime(0.32 + norm * 0.25 + turnBoost * 0.35, now, 0.1);
    }
    for (const [id, loop] of this.glideLoops) {
      if (!live.has(id)) {
        loop.gain.gain.setTargetAtTime(0, now, 0.12);
        loop.src.stop(now + 0.6);
        loop.lfo.stop(now + 0.6);
        this.glideLoops.delete(id);
      }
    }
  }

  /**
   * A soft, low footfall tick, timed to the stride by the caller. Directional
   * and distance-faded like any other world sound; your own steps use the
   * same math but land at ~zero distance from the listener, so they stay
   * quiet and centered rather than panning around underfoot.
   */
  footstep(x: number, z: number, isSelf: boolean, alt: boolean): void {
    const freq = alt ? 92 : 104; // alternating feet, a hair apart in pitch
    this.tone(freq, 0.06, 'sine', isSelf ? 0.025 : 0.05, freq * 0.55, { x, z });
  }

  /** A dive-bomb landing: a heavy low thump with a short crunch on top. */
  diveImpact(x: number, z: number, isSelf: boolean): void {
    const at = { x, z };
    this.tone(70, 0.28, 'sine', isSelf ? 0.35 : 0.22, 32, at);
    this.tone(220, 0.09, 'sawtooth', isSelf ? 0.12 : 0.08, 60, at);
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
