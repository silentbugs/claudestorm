import type { AbilityId } from '@claudestorm/shared';

/** Tiny synthesized sound effects — no audio assets needed for the slice. */
class Sfx {
  private ctx: AudioContext | null = null;
  private lastCoin = 0;

  unlock(): void {
    if (!this.ctx) this.ctx = new AudioContext();
    if (this.ctx.state === 'suspended') void this.ctx.resume();
  }

  private tone(
    freq: number,
    duration: number,
    type: OscillatorType,
    volume: number,
    freqEnd?: number,
  ): void {
    const ctx = this.ctx;
    if (!ctx || ctx.state !== 'running') return;
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    osc.type = type;
    osc.frequency.setValueAtTime(freq, ctx.currentTime);
    if (freqEnd !== undefined) {
      osc.frequency.exponentialRampToValueAtTime(Math.max(20, freqEnd), ctx.currentTime + duration);
    }
    gain.gain.setValueAtTime(volume, ctx.currentTime);
    gain.gain.exponentialRampToValueAtTime(0.0001, ctx.currentTime + duration);
    osc.connect(gain).connect(ctx.destination);
    osc.start();
    osc.stop(ctx.currentTime + duration);
  }

  cast(ability: AbilityId): void {
    switch (ability) {
      case 'frostArrow':
        this.tone(760, 0.12, 'triangle', 0.11, 1050);
        break;
      case 'stormCall':
        this.tone(300, 0.18, 'sawtooth', 0.07, 180);
        break;
      case 'flameCyclone':
        this.tone(180, 0.4, 'sawtooth', 0.08, 320);
        break;
      case 'venomOrb':
        this.tone(420, 0.15, 'triangle', 0.1, 240);
        break;
      case 'graspingChains':
        this.tone(900, 0.1, 'square', 0.06, 500);
        break;
      case 'gustLeap':
        this.tone(340, 0.25, 'sine', 0.12, 720);
        break;
      case 'stoneShield':
        this.tone(220, 0.3, 'triangle', 0.12, 330);
        break;
    }
  }

  melee(combo: number): void {
    const base = combo === 3 ? 340 : 280;
    this.tone(base, 0.08, 'square', 0.07, base * 0.6);
  }

  hit(): void {
    this.tone(220, 0.1, 'square', 0.09, 120);
  }

  detonate(): void {
    this.tone(140, 0.35, 'sawtooth', 0.15, 40);
  }

  death(isSelf: boolean): void {
    this.tone(isSelf ? 330 : 400, 0.5, 'triangle', 0.14, 60);
  }

  coin(): void {
    const now = performance.now();
    if (now - this.lastCoin < 90) return;
    this.lastCoin = now;
    this.tone(1180, 0.09, 'triangle', 0.08, 1560);
  }

  levelUp(): void {
    this.tone(523, 0.12, 'triangle', 0.12);
    setTimeout(() => this.tone(784, 0.2, 'triangle', 0.12), 120);
  }

  equip(): void {
    this.tone(620, 0.12, 'sine', 0.11, 880);
  }

  chest(): void {
    this.tone(190, 0.25, 'triangle', 0.12, 320);
  }

  victory(): void {
    this.tone(523, 0.15, 'triangle', 0.12);
    setTimeout(() => this.tone(659, 0.15, 'triangle', 0.12), 150);
    setTimeout(() => this.tone(784, 0.3, 'triangle', 0.12), 300);
  }
}

export const sfx = new Sfx();
