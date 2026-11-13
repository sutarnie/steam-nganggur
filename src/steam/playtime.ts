import { promises as fs } from 'fs';
import { join } from 'path';
import { logger } from '../logger.js';
import { ensureDataDir } from '../utils/fs.js';

const log = logger.child({ component: 'PlaytimeLogger' });

export interface PlaytimeEntry {
  appId: number;
  gameName?: string;
  startTime: string;
  endTime: string;
  durationMinutes: number;
  batchName?: string;
  cycleNumber?: number;
}

interface GameSession {
  appId: number;
  gameName?: string;
  startTime: Date;
  batchName?: string;
  cycleNumber?: number;
}

export class PlaytimeLogger {
  private sessions: Map<number, GameSession> = new Map();
  private filePath: string;
  private gameNames: Map<number, string>;

  constructor(gameNames: Map<number, string> = new Map(), cwd: string = process.cwd()) {
    this.filePath = join(cwd, 'data', 'playtime.txt');
    this.gameNames = gameNames;
  }

  /**
   * Start tracking a game session (when gamesPlayed is called with new games)
   */
  startSession(appIds: number[], batchName?: string, cycleNumber?: number): void {
    const now = new Date();
    for (const appId of appIds) {
      if (!this.sessions.has(appId)) {
        this.sessions.set(appId, {
          appId,
          gameName: this.gameNames.get(appId),
          startTime: now,
          batchName,
          cycleNumber,
        });
        if (!log.isPretty()) {
          log.debug('Playtime session started', { appId, batchName, cycleNumber });
        }
      }
    }
  }

  /**
   * End tracking for games that are no longer being idled
   * Returns completed entries for writing to file
   */
  endSessions(currentAppIds: number[]): PlaytimeEntry[] {
    const ended: PlaytimeEntry[] = [];
    const now = new Date();

    for (const [appId, session] of this.sessions) {
      if (!currentAppIds.includes(appId)) {
        const durationMs = now.getTime() - session.startTime.getTime();
        const durationMinutes = Math.round(durationMs / 60000);

        ended.push({
          appId: session.appId,
          gameName: session.gameName,
          startTime: session.startTime.toISOString(),
          endTime: now.toISOString(),
          durationMinutes,
          batchName: session.batchName,
          cycleNumber: session.cycleNumber,
        });

        this.sessions.delete(appId);

        if (!log.isPretty()) {
          log.debug('Playtime session ended', { appId, durationMinutes, batchName: session.batchName });
        }
      }
    }

    return ended;
  }

  /**
   * End all active sessions (on shutdown)
   */
  endAllSessions(): PlaytimeEntry[] {
    const ended: PlaytimeEntry[] = [];
    const now = new Date();

    for (const [appId, session] of this.sessions) {
      const durationMs = now.getTime() - session.startTime.getTime();
      const durationMinutes = Math.round(durationMs / 60000);

      ended.push({
        appId: session.appId,
        gameName: session.gameName,
        startTime: session.startTime.toISOString(),
        endTime: now.toISOString(),
        durationMinutes,
        batchName: session.batchName,
        cycleNumber: session.cycleNumber,
      });

      if (!log.isPretty()) {
        log.debug('Playtime session ended (shutdown)', { appId, durationMinutes });
      }
    }

    this.sessions.clear();
    return ended;
  }

  /**
   * Write playtime entries to file (append, JSON Lines format)
   */
  async writeEntries(entries: PlaytimeEntry[]): Promise<void> {
    if (entries.length === 0) return;

    await ensureDataDir();

    const lines = entries.map(e => JSON.stringify(e)).join('\n') + '\n';

    try {
      await fs.appendFile(this.filePath, lines, 'utf8');
      if (!log.isPretty()) {
        log.info('Playtime entries written', { count: entries.length, file: this.filePath });
      } else {
        log.success(`Playtime logged: ${entries.length} game(s)`);
      }
    } catch (err) {
      log.error('Failed to write playtime entries', { error: err instanceof Error ? err.message : String(err) });
      throw err;
    }
  }

  /**
   * Get currently active sessions (for debugging)
   */
  getActiveSessions(): GameSession[] {
    return [...this.sessions.values()];
  }
}

export function createPlaytimeLogger(
  gameNames: Map<number, string> = new Map(),
  cwd: string = process.cwd()
): PlaytimeLogger {
  return new PlaytimeLogger(gameNames, cwd);
}
