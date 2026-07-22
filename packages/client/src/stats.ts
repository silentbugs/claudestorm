import type { Snapshot } from '@claudestorm/shared';

/** Everything worth remembering about one finished match. */
export interface MatchStats {
  endedAt: number;
  victory: boolean;
  placement: number;
  survivalSeconds: number;
  /** Player kills. */
  kills: number;
  mobKills: number;
  eliteKills: number;
  /** Damage dealt to players (mobs excluded). */
  damageDealt: number;
  damageTaken: number;
  plunder: number;
  level: number;
  chestsOpened: number;
  spellsCast: number;
  slaps: number;
  /** Killer's name, 'the storm', or null on a win. */
  killedBy: string | null;
  /** Match setup, for filtering later. */
  bots: number;
  difficulty: string;
  circles: number;
}

export interface MatchSetup {
  bots: number;
  difficulty: string;
  circles: number;
}

/**
 * Derives one MatchStats from the snapshot stream — pure observation of the
 * same events the renderer consumes, so a future server could compute the
 * identical record. consume() returns the finished record exactly once:
 * when the tracked player dies or the match ends.
 */
export class StatsTracker {
  private readonly names = new Map<number, string>();
  private readonly playerIds = new Set<number>();
  private kills = 0;
  private mobKills = 0;
  private eliteKills = 0;
  private damageDealt = 0;
  private damageTaken = 0;
  private chestsOpened = 0;
  private spellsCast = 0;
  private slaps = 0;
  private done = false;

  constructor(
    private readonly selfId: number,
    private readonly selfTeamId: number = selfId,
    private readonly setup: MatchSetup = { bots: 0, difficulty: 'normal', circles: 0 },
  ) {}

  consume(snap: Snapshot): MatchStats | null {
    if (this.done) return null;
    if (this.names.size === 0) {
      for (const p of snap.players) {
        this.names.set(p.id, p.name);
        this.playerIds.add(p.id);
      }
    }

    let selfDied = false;
    let killedBy: string | null = null;
    for (const ev of snap.events) {
      switch (ev.type) {
        case 'hit':
          if (ev.targetId === this.selfId) this.damageTaken += ev.amount;
          else if (ev.sourceId === this.selfId && this.playerIds.has(ev.targetId)) {
            this.damageDealt += ev.amount;
          }
          break;
        case 'death':
          if (ev.id === this.selfId) {
            selfDied = true;
            killedBy = ev.killerId !== null ? (this.names.get(ev.killerId) ?? 'a rival') : 'the storm';
          } else if (ev.killerId === this.selfId) {
            this.kills++;
          }
          break;
        case 'mobDeath':
          if (ev.killerId === this.selfId) {
            if (ev.elite) this.eliteKills++;
            else this.mobKills++;
          }
          break;
        case 'chestOpened':
          if (ev.playerId === this.selfId) this.chestsOpened++;
          break;
        case 'cast':
          if (ev.casterId === this.selfId) this.spellsCast++;
          break;
        case 'melee':
          if (ev.casterId === this.selfId) this.slaps++;
          break;
      }
    }

    const ended = snap.phase === 'ended';
    if (!selfDied && !ended) return null;
    this.done = true;
    const self = snap.players.find((p) => p.id === this.selfId);
    const victory = ended && snap.winnerTeamId === this.selfTeamId;
    return {
      endedAt: Date.now(),
      victory,
      placement: victory ? 1 : snap.aliveTeamCount + 1,
      survivalSeconds: Math.round(snap.time),
      kills: this.kills,
      mobKills: this.mobKills,
      eliteKills: this.eliteKills,
      damageDealt: Math.round(this.damageDealt),
      damageTaken: Math.round(this.damageTaken),
      plunder: self?.plunder ?? 0,
      level: self?.level ?? 1,
      chestsOpened: this.chestsOpened,
      spellsCast: this.spellsCast,
      slaps: this.slaps,
      killedBy: victory ? null : killedBy,
      ...this.setup,
    };
  }
}

/*
 * Local match database: IndexedDB, one record per finished match (abandoned
 * matches are never saved). All access is fire-and-forget safe — a browser
 * with IndexedDB blocked just plays without history.
 */
const DB_NAME = 'claudestorm';
const STORE = 'matches';

function openDb(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, 1);
    req.onupgradeneeded = () => {
      if (!req.result.objectStoreNames.contains(STORE)) {
        req.result.createObjectStore(STORE, { autoIncrement: true });
      }
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error as Error);
  });
}

export const statsStore = {
  async add(match: MatchStats): Promise<void> {
    try {
      const db = await openDb();
      await new Promise<void>((resolve, reject) => {
        const tx = db.transaction(STORE, 'readwrite');
        tx.objectStore(STORE).add(match);
        tx.oncomplete = () => resolve();
        tx.onerror = () => reject(tx.error as Error);
      });
      db.close();
    } catch {
      // No storage available — the match just isn't remembered.
    }
  },

  async all(): Promise<MatchStats[]> {
    try {
      const db = await openDb();
      const matches = await new Promise<MatchStats[]>((resolve, reject) => {
        const req = db.transaction(STORE, 'readonly').objectStore(STORE).getAll();
        req.onsuccess = () => resolve(req.result as MatchStats[]);
        req.onerror = () => reject(req.error as Error);
      });
      db.close();
      return matches;
    } catch {
      return [];
    }
  },
};
