import {
  ABILITIES,
  HEAL_CAST_SECONDS,
  HEAL_COOLDOWN,
  HEAL_TICK_AMOUNT,
  ITEMS,
  MELEE_COMBO_FINISHER_MULT,
  MELEE_DAMAGE,
  MELEE_INTERVAL,
  ROLL_COOLDOWN,
  ROLL_DISTANCE,
  type AbilityDef,
  type PlayerSnapshot,
  type Rarity,
  type Snapshot,
} from '@claudestorm/shared';

const RARITY_CSS: Record<Rarity, string> = {
  common: '#b8b5a5',
  uncommon: '#4bc26b',
  rare: '#4d9be6',
  epic: '#b05df0',
};

interface SlotEls {
  root: HTMLElement;
  icon: HTMLElement;
  name: HTMLElement;
  overlay: HTMLElement;
  text: HTMLElement;
}

/** DOM overlay: health/shield, hotbar, XP/level, plunder, prompts, end screen. */
export class Hud {
  private readonly alive = document.getElementById('alive')!;
  private readonly stormStatus = document.getElementById('storm-status')!;
  private readonly plunder = document.getElementById('plunder')!;
  private readonly levelBadge = document.getElementById('level-badge')!;
  private readonly xpFill = document.getElementById('xpfill')!;
  private readonly centerMsg = document.getElementById('center-msg')!;
  private readonly interactPrompt = document.getElementById('interact-prompt')!;
  private readonly channelBar = document.getElementById('channel-bar')!;
  private readonly channelFill = document.getElementById('channel-fill')!;
  private readonly castName = document.getElementById('cast-name')!;
  private castNameTimer = 0;
  private readonly hpFill = document.getElementById('hpfill')!;
  private readonly shieldFill = document.getElementById('shieldfill')!;
  private readonly hpText = document.getElementById('hptext')!;
  private readonly endScreen = document.getElementById('end-screen')!;
  private readonly endTitle = document.getElementById('end-title')!;
  private readonly endSub = document.getElementById('end-sub')!;
  private readonly endStats = document.getElementById('end-stats')!;
  private readonly spectateBtn = document.getElementById('spectate-btn')!;
  private readonly spectateBanner = document.getElementById('spectate-banner')!;
  private readonly spectatePrev = document.getElementById('spectate-prev')!;
  private readonly spectateNext = document.getElementById('spectate-next')!;
  private readonly vignette = document.getElementById('vignette')!;
  private readonly killfeed = document.getElementById('killfeed')!;
  private readonly killfeedRows: { el: HTMLElement; ttl: number }[] = [];
  private readonly milestoneBanner = document.getElementById('milestone-banner')!;
  private milestoneTimer = 0;
  private readonly slotEls = new Map<string, SlotEls>();
  private vignetteStrength = 0;

  private readonly skillsOverlay = document.getElementById('skills-overlay')!;

  // update() runs every rendered frame; unconditional textContent/style writes
  // force style+layout work at 120Hz and starve the main thread (felt as lag
  // even while the FPS counter reads full rate). Every write goes through
  // these caches so the DOM is only touched when a value actually changed.
  private readonly textCache = new Map<HTMLElement, string>();
  private readonly styleCache = new Map<HTMLElement, Record<string, string>>();
  private interactText: string | null = null;

  private setText(el: HTMLElement, text: string): void {
    if (this.textCache.get(el) === text) return;
    this.textCache.set(el, text);
    el.textContent = text;
  }

  private setStyle(el: HTMLElement, prop: string, value: string): void {
    let props = this.styleCache.get(el);
    if (!props) this.styleCache.set(el, (props = {}));
    if (props[prop] === value) return;
    props[prop] = value;
    el.style.setProperty(prop, value);
  }

  constructor(
    onRestart: () => void,
    onSpectate: () => void,
    onMenu: () => void,
    private readonly touchMode: boolean,
  ) {
    document.getElementById('restart-btn')!.addEventListener('click', onRestart);
    this.spectateBtn.addEventListener('click', onSpectate);
    document.getElementById('menu-btn')!.addEventListener('click', onMenu);
    for (const el of document.querySelectorAll<HTMLElement>('.slot')) {
      this.slotEls.set(el.dataset.slot!, {
        root: el,
        icon: el.querySelector<HTMLElement>('.icon')!,
        name: el.querySelector<HTMLElement>('.name')!,
        overlay: el.querySelector<HTMLElement>('.cd-overlay')!,
        text: el.querySelector<HTMLElement>('.cd-text')!,
      });
    }
    this.buildSkillsList();
    // A tappable close button, not just the T/Esc hints — touch has no keyboard.
    document
      .getElementById('skills-close-btn')!
      .addEventListener('click', () => this.skillsOverlay.classList.add('hidden'));
    window.addEventListener('keydown', (e) => {
      if (e.code === 'KeyT') this.skillsOverlay.classList.toggle('hidden');
      else if (e.code === 'Escape') this.skillsOverlay.classList.add('hidden');
    });
  }

  /** The skills compendium: builtins plus every lootable ability, straight from the sim's data. */
  private buildSkillsList(): void {
    const list = document.getElementById('skills-list')!;
    const row = (
      icon: string,
      name: string,
      key: string,
      tag: string,
      stats: string,
      description: string,
    ) => `
      <div class="skill-row">
        <span class="skill-icon">${icon}</span>
        <div class="skill-body">
          <div class="skill-head">
            <span class="skill-name">${name}</span>
            <span class="skill-key">${key}</span>
            <span class="skill-tag ${tag.toLowerCase()}">${tag}</span>
          </div>
          <div class="skill-desc">${description}</div>
          <div class="skill-stats">${stats}</div>
        </div>
      </div>`;

    const abilityStats = (def: AbilityDef): string => {
      const parts: string[] = [];
      if (def.damage > 0)
        parts.push(
          `${def.behavior === 'selfAura' ? `${def.damage}/s` : def.damage} damage${def.volley ? ` ×${def.volley}` : ''}`,
        );
      parts.push(`${def.cooldown}s cooldown`);
      if (def.slowDuration || (def.poolSlowFactor ?? 1) < 1) parts.push('slows');
      if (def.stunDuration || def.landStunDuration) parts.push('stuns');
      if (def.rootDuration) parts.push('roots');
      if (def.pull) parts.push('pulls');
      if (def.poisonDps) parts.push('poisons');
      if (def.boomerang) parts.push('returns to you');
      if (def.poolDps) parts.push(`${def.poolDps}/s pool`);
      if (def.shieldAmount) parts.push(`${def.shieldAmount} absorb`);
      if (def.knockbackDistance) parts.push('knockback');
      if (def.stealthDuration) parts.push('stealth');
      if (def.buffKind === 'immune') parts.push(`${def.buffDuration}s immunity`);
      if (def.buffKind === 'faeform') parts.push('fast + tough, no attacks');
      if (def.trapCount) parts.push(`${def.trapCount} traps`);
      if (def.chargeSeconds) parts.push('charge & release');
      if (def.pierce) parts.push('pierces everything');
      return parts.join(' · ');
    };

    const builtins = [
      row('👋', 'Slap', 'R', 'Builtin',
        `${MELEE_DAMAGE} damage · ${MELEE_INTERVAL}s swing · 3rd hit ×${MELEE_COMBO_FINISHER_MULT}`,
        'Wind up a giant glowing hand and slap everything in a front arc. The third hit is a two-handed finisher.'),
      row('💚', 'Heal', 'H', 'Builtin',
        `${HEAL_TICK_AMOUNT * HEAL_CAST_SECONDS} healing over ${HEAL_CAST_SECONDS}s · ${HEAL_COOLDOWN}s cooldown`,
        'Channel a mend that pulses every second. Taking damage or attacking interrupts it — and the cooldown is spent either way.'),
      row('🤸', 'Barrel Roll', 'Shift', 'Builtin', `${ROLL_DISTANCE}m · ${ROLL_COOLDOWN}s cooldown`,
        'Quick dodge roll. You are immune to projectiles while rolling.'),
      row('🪂', 'Dive', 'Space', 'Builtin', 'hold to plunge · release to re-pop the canopy',
        'While gliding, hold to accelerate straight down. Landing on a mob crushes it instantly — even elites.'),
    ].join('');

    const abilities = Object.values(ABILITIES)
      .map((def) =>
        row(
          def.icon,
          def.name,
          def.category === 'offense' ? '1 / 2' : '3 / 4',
          def.category === 'offense' ? 'Offense' : 'Utility',
          abilityStats(def),
          def.description,
        ),
      )
      .join('');

    const items = Object.values(ITEMS)
      .map((item) => row(item.icon, item.name, 'G', 'Item', 'one held at a time', item.description))
      .join('');

    list.innerHTML =
      `<div class="skill-section">Builtins — always on your bar</div>${builtins}` +
      `<div class="skill-section">Lootable abilities — duplicates stack the rank up to epic</div>${abilities}` +
      `<div class="skill-section">Items — consumables from chests and the world</div>${items}`;
  }

  update(snap: Snapshot, selfId: number): void {
    this.setText(this.alive, `${snap.aliveCount} alive`);
    const self = snap.players.find((p) => p.id === selfId);

    // Keyed to this player's own glide state, not the global phase: you can
    // act the instant you land even if stragglers keep the match in 'drop',
    // so the hint should clear the instant you land too.
    this.setText(
      this.centerMsg,
      self?.gliding
        ? this.touchMode
          ? 'Steer with the stick — pick a landing spot! Hold JUMP to dive.'
          : 'Steer with WASD — pick a landing spot! Hold Space to dive.'
        : '',
    );

    if (snap.phase === 'drop') {
      this.setText(this.stormStatus, '');
    } else if (snap.storm.shrinking) {
      this.setText(this.stormStatus, 'Storm is shrinking!');
      this.stormStatus.classList.add('warning');
    } else if (snap.storm.nextShrinkIn > 0) {
      this.setText(this.stormStatus, `Storm shrinks in ${Math.ceil(snap.storm.nextShrinkIn)}s`);
      this.stormStatus.classList.remove('warning');
    } else {
      this.setText(this.stormStatus, 'Final circle');
      this.stormStatus.classList.add('warning');
    }

    if (!self) return;

    this.setText(this.plunder, `⛃ ${self.plunder}`);
    this.setText(this.levelBadge, `${self.level}/${self.maxLevel}`);
    const xpSpan = self.xp + self.xpToNext;
    this.setStyle(
      this.xpFill,
      'width',
      self.xpToNext > 0 && xpSpan > 0 ? `${Math.min(100, (self.xp / xpSpan) * 100)}%` : '100%',
    );

    const total = self.maxHp + self.shieldHp;
    this.setStyle(this.hpFill, 'width', `${Math.max(0, (self.hp / total) * 100)}%`);
    this.setStyle(this.shieldFill, 'width', `${Math.max(0, (self.shieldHp / total) * 100)}%`);
    this.setStyle(this.shieldFill, 'left', `${Math.max(0, (self.hp / total) * 100)}%`);
    this.setText(
      this.hpText,
      self.shieldHp > 0
        ? `${Math.ceil(self.hp)} +${Math.ceil(self.shieldHp)} / ${self.maxHp}`
        : `${Math.ceil(self.hp)} / ${self.maxHp}`,
    );

    this.updateSlot('melee', 'Slap', '👋', null, self.meleeCd, MELEE_INTERVAL, false);
    this.updateAbilitySlot('0', self, 0);
    this.updateAbilitySlot('1', self, 1);
    this.updateAbilitySlot('2', self, 2);
    this.updateAbilitySlot('3', self, 3);
    if (self.item) {
      const item = ITEMS[self.item];
      this.updateSlot('item', item.name, item.icon, null, 0, 1, false);
    } else {
      this.updateSlot('item', '—', '', null, 0, 1, true);
    }
    this.updateSlot('heal', 'Heal', '💚', null, self.healCd, HEAL_COOLDOWN, false);
    this.updateSlot('roll', 'Roll', '🤸', null, self.rollCd, ROLL_COOLDOWN, false);

    // The channel bar doubles as the charge-and-release meter.
    const progress = self.charging >= 0 ? self.charging : self.channeling;
    if (progress >= 0) {
      this.channelBar.classList.remove('hidden');
      this.setStyle(this.channelFill, 'width', `${progress * 100}%`);
    } else {
      this.channelBar.classList.add('hidden');
    }
    // Channels name themselves for as long as they run; instant casts and
    // charges are named by showCast() (event-driven) and simply time out.
    if (self.channeling >= 0 && self.channelKind) {
      this.castNameTimer = 0;
      this.setText(this.castName, self.channelKind === 'heal' ? 'Heal' : 'Opening chest');
      this.castName.classList.remove('hidden');
    } else if (this.castNameTimer <= 0) {
      this.castName.classList.add('hidden');
    }
  }

  /** Flash the name of a cast spell over the hotbar for `seconds`. */
  showCast(name: string, seconds: number): void {
    this.setText(this.castName, name);
    this.castName.classList.remove('hidden');
    this.castNameTimer = seconds;
  }

  private updateAbilitySlot(key: string, self: PlayerSnapshot, slotIndex: number): void {
    const equipped =
      slotIndex < 2 ? self.slots.offense[slotIndex] : self.slots.utility[slotIndex - 2];
    if (!equipped) {
      this.updateSlot(key, '—', '', null, 0, 1, true);
      return;
    }
    const def = ABILITIES[equipped.abilityId];
    this.updateSlot(key, def.name, def.icon, equipped.rarity, self.slotCds[slotIndex] ?? 0, def.cooldown, false);
  }

  private updateSlot(
    key: string,
    name: string,
    icon: string,
    rarity: Rarity | null,
    cd: number,
    cdTotal: number,
    empty: boolean,
  ): void {
    const els = this.slotEls.get(key);
    if (!els) return;
    this.setText(els.icon, icon);
    this.setText(els.name, name);
    els.root.classList.toggle('empty', empty);
    this.setStyle(els.root, 'border-color', rarity ? RARITY_CSS[rarity] : '#444a63');
    this.setStyle(els.overlay, 'height', `${Math.min(100, (cd / cdTotal) * 100)}%`);
    this.setText(els.text, cd > 0.25 ? cd.toFixed(1) : '');
  }

  toggleSkills(): void {
    this.skillsOverlay.classList.toggle('hidden');
  }

  showInteract(text: string | null): void {
    if (text === this.interactText) return;
    this.interactText = text;
    if (text) {
      this.interactPrompt.innerHTML = `<span class="kb">F</span>${text}`;
      this.interactPrompt.classList.remove('hidden');
    } else {
      this.interactPrompt.classList.add('hidden');
    }
  }

  flashVignette(): void {
    this.vignetteStrength = 0.9;
  }

  tick(dt: number): void {
    if (this.vignetteStrength > 0) {
      this.vignetteStrength = Math.max(0, this.vignetteStrength - dt * 2.5);
      this.vignette.style.opacity = this.vignetteStrength.toFixed(2);
    }
    if (this.castNameTimer > 0) {
      this.castNameTimer -= dt;
      if (this.castNameTimer <= 0) this.castName.classList.add('hidden');
    }
    for (let i = this.killfeedRows.length - 1; i >= 0; i--) {
      const row = this.killfeedRows[i]!;
      row.ttl -= dt;
      if (row.ttl <= 0.6) row.el.classList.add('fade');
      if (row.ttl <= 0) {
        row.el.remove();
        this.killfeedRows.splice(i, 1);
      }
    }
    if (this.milestoneTimer > 0) {
      this.milestoneTimer -= dt;
      if (this.milestoneTimer <= 0) this.milestoneBanner.classList.add('hidden');
    }
  }

  showEnd(victory: boolean, placement: number, canSpectate = false, statsLine = ''): void {
    this.endScreen.classList.remove('hidden');
    this.endTitle.textContent = victory ? 'VICTORY' : 'DEFEAT';
    this.endTitle.className = victory ? 'victory' : 'defeat';
    this.endSub.textContent = victory
      ? 'Last one standing — the plunder is yours!'
      : `You placed #${placement}`;
    this.endStats.textContent = statsLine;
    this.endStats.classList.toggle('hidden', !statsLine);
    this.spectateBtn.classList.toggle('hidden', !canSpectate);
  }

  hideEnd(): void {
    this.endScreen.classList.add('hidden');
  }

  /**
   * Banner while following someone else after death; null hides it. The
   * prev/next buttons ride along — desktop cycles with arrow keys instead
   * (there's no keyboard on touch, so the buttons are the only way there;
   * touch-mode CSS is what actually keeps them off desktop).
   */
  showSpectate(text: string | null): void {
    if (text) {
      this.spectateBanner.textContent = text;
      this.spectateBanner.classList.remove('hidden');
      this.spectatePrev.classList.remove('hidden');
      this.spectateNext.classList.remove('hidden');
    } else {
      this.spectateBanner.classList.add('hidden');
      this.spectatePrev.classList.add('hidden');
      this.spectateNext.classList.add('hidden');
    }
  }

  /** One line in the top-right feed: `killerName ⚔ victimName`, or just the victim if the source wasn't a player. */
  pushKillfeed(killerName: string | null, victimName: string): void {
    const row = document.createElement('div');
    row.className = 'killfeed-row';
    row.innerHTML = killerName
      ? `<span class="kf-killer">${killerName}</span> ⚔ <span class="kf-victim">${victimName}</span>`
      : `<span class="kf-victim">${victimName}</span> fell`;
    this.killfeed.appendChild(row);
    this.killfeedRows.push({ el: row, ttl: 4.5 });
    while (this.killfeedRows.length > 5) {
      this.killfeedRows.shift()!.el.remove();
    }
  }

  /** Big transient center callout for alive-count milestones ("10 Plunderers remain"). */
  announceMilestone(text: string): void {
    this.setText(this.milestoneBanner, text);
    this.milestoneBanner.classList.remove('hidden');
    this.milestoneTimer = 3;
  }

  /** Clear transient per-match UI (killfeed, milestone banner) for a fresh match. */
  resetMatchUi(): void {
    for (const row of this.killfeedRows) row.el.remove();
    this.killfeedRows.length = 0;
    this.milestoneTimer = 0;
    this.milestoneBanner.classList.add('hidden');
  }
}
