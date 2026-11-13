import { logger } from '../logger.js';
import type { SteamUser } from 'steam-user';
import type { RandomizedBatch } from '../rotation/randomizer.js';
import { createPlaytimeLogger, type PlaytimeLogger, type PlaytimeEntry } from './playtime.js';

const log = logger.child({ component: 'SteamGames' });

export interface SteamGamesUpdater {
  updateGames(alwaysIdle: number[], batch: RandomizedBatch | null, gameNames?: Map<number, string>): Promise<void>;
  getCurrentGames(): number[];
  setCycleNumber(cycleNumber: number): void;
}

export function createSteamGamesUpdater(
  client: SteamUser,
  alwaysIdle: number[],
  playtimeLogger?: PlaytimeLogger
): SteamGamesUpdater {
  let currentGames: number[] = [];
  let currentBatchName: string | null = null;
  let currentCycleNumber: number | null = null;

  function mergeGames(batch: RandomizedBatch | null): number[] {
    const batchIds = batch?.appIds ?? [];
    const all = [...alwaysIdle, ...batchIds];
    return [...new Set(all)];
  }

  async function updateGames(
    alwaysIdleList: number[],
    batch: RandomizedBatch | null,
    gameNames?: Map<number, string>
  ): Promise<void> {
    const merged = mergeGames(batch);

    const changed = merged.length !== currentGames.length ||
      merged.some((id, i) => id !== currentGames[i]);

    if (!changed) {
      log.debug('Games list unchanged, skipping gamesPlayed');
      return;
    }

    const added = merged.filter(id => !currentGames.includes(id));
    const removed = currentGames.filter(id => !merged.includes(id));

    const newBatchName = batch?.name ?? null;
    const newCycleNumber = batch ? 1 : null;

    if (newBatchName !== currentBatchName) {
      currentBatchName = newBatchName;
    }

    if (playtimeLogger) {
      const endedEntries = playtimeLogger.endSessions(merged);
      if (endedEntries.length > 0) {
        await playtimeLogger.writeEntries(endedEntries);
      }
      if (added.length > 0) {
        playtimeLogger.startSession(added, currentBatchName ?? undefined, currentCycleNumber ?? undefined);
      }
    }

    if (logger.isPretty() && (added.length > 0 || removed.length > 0)) {
      logger.printGamesUpdate(added, removed, gameNames ?? new Map());
    } else {
      log.info('Updating Steam games', {
        total: merged.length,
        alwaysIdle: alwaysIdleList.length,
        batch: batch?.name ?? 'none',
        batchGames: batch?.appIds.length ?? 0,
        added,
        removed,
      });
    }

    try {
      client.gamesPlayed(merged, true);
      currentGames = merged;
      log.debug('gamesPlayed sent successfully');
    } catch (err) {
      log.error('Failed to send gamesPlayed', { error: err instanceof Error ? err.message : String(err) });
      throw err;
    }
  }

  function getCurrentGames(): number[] {
    return [...currentGames];
  }

  function setCycleNumber(cycleNumber: number): void {
    currentCycleNumber = cycleNumber;
  }

  return { updateGames, getCurrentGames, setCycleNumber };
}
