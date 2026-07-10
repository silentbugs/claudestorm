import { statsStore, type MatchStats } from '../stats.js';

function fmtTime(seconds: number): string {
  return `${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, '0')}`;
}

/** The Match History overlay: lifetime totals plus the most recent matches. */
export class StatsPanel {
  private readonly overlay = document.getElementById('stats-overlay')!;
  private readonly summary = document.getElementById('stats-summary')!;
  private readonly list = document.getElementById('stats-list')!;

  constructor() {
    document.getElementById('stats-btn')!.addEventListener('click', () => void this.toggle());
    window.addEventListener('keydown', (e) => {
      if (e.code === 'Escape') this.overlay.classList.add('hidden');
    });
  }

  private async toggle(): Promise<void> {
    if (!this.overlay.classList.contains('hidden')) {
      this.overlay.classList.add('hidden');
      return;
    }
    this.render(await statsStore.all());
    this.overlay.classList.remove('hidden');
  }

  private render(matches: MatchStats[]): void {
    if (matches.length === 0) {
      this.summary.innerHTML = '';
      this.list.innerHTML = '<div id="stats-empty">No matches on record yet — go win one.</div>';
      return;
    }

    const sum = (f: (m: MatchStats) => number): number => matches.reduce((a, m) => a + f(m), 0);
    const wins = sum((m) => (m.victory ? 1 : 0));
    const chip = (label: string, value: string | number): string =>
      `<div class="stat-chip"><b>${value}</b>${label}</div>`;
    this.summary.innerHTML = [
      chip('matches', matches.length),
      chip('wins', wins),
      chip('win rate', `${Math.round((wins / matches.length) * 100)}%`),
      chip('kills', sum((m) => m.kills)),
      chip('best', `#${Math.min(...matches.map((m) => m.placement))}`),
      chip('damage dealt', sum((m) => m.damageDealt)),
      chip('plunder', `⛃ ${sum((m) => m.plunder)}`),
      chip('creatures', sum((m) => m.mobKills + m.eliteKills)),
      chip('chests', sum((m) => m.chestsOpened)),
      chip('longest', fmtTime(Math.max(...matches.map((m) => m.survivalSeconds)))),
    ].join('');

    const recent = matches.slice(-15).reverse();
    const rows = recent
      .map((m) => {
        const date = new Date(m.endedAt).toLocaleDateString(undefined, {
          month: 'short',
          day: 'numeric',
        });
        const fate = m.victory ? 'Last one standing' : `Fell to ${m.killedBy ?? 'the storm'}`;
        return `<div class="match-row">
          <span class="place${m.victory ? ' win' : ''}">${m.victory ? '👑' : `#${m.placement}`}</span>
          <span>${date}</span>
          <span>${m.kills} kills</span>
          <span>${m.damageDealt} dmg</span>
          <span>⛃ ${m.plunder}</span>
          <span>${fmtTime(m.survivalSeconds)}</span>
          <span>${fate}</span>
        </div>`;
      })
      .join('');
    this.list.innerHTML =
      `<div class="match-row head"><span>Place</span><span>Date</span><span>Kills</span>` +
      `<span>Damage</span><span>Plunder</span><span>Time</span><span>Fate</span></div>` +
      rows;
  }
}
