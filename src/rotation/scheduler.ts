import { logger } from '../logger.js';
import type { CycleManager } from './cycle.js';
import type { RandomizedBatch } from './randomizer.js';
import type { SteamGamesUpdater } from '../steam/games.js';

const log = logger.child({ component: 'Scheduler' });

export interface SchedulerCallbacks {
  onBatchChange: (batch: RandomizedBatch | null, isNewCycle: boolean) => Promise<void>;
  onCycleComplete: (cycleNumber: number) => Promise<void>;
  onError: (error: Error) => void;
}

export class Scheduler {
  private manager: CycleManager;
  private callbacks: SchedulerCallbacks;
  private timer: ReturnType<typeof setTimeout> | null = null;
  private running = false;

  constructor(manager: CycleManager, callbacks: SchedulerCallbacks) {
    this.manager = manager;
    this.callbacks = callbacks;
  }

  start(): void {
    if (this.running) return;
    this.running = true;
    this.scheduleNext();
  }

  stop(): void {
    this.running = false;
    if (this.timer) {
      clearTimeout(this.timer);
      this.timer = null;
    }
  }

  private scheduleNext(): void {
    if (!this.running) return;

    const waitMinutes = this.manager.getRemainingMinutes();

    if (waitMinutes <= 0) {
      this.advanceBatch();
      return;
    }

    const waitMs = waitMinutes * 60000;
    log.debug('Scheduled next rotation', { waitMinutes, waitMs });

    this.timer = setTimeout(() => {
      this.timer = null;
      this.advanceBatch();
    }, waitMs);

    this.timer.unref?.();
  }

  private async advanceBatch(): Promise<void> {
    if (!this.running) return;

    try {
      const isNewCycle = this.manager.isCycleComplete();
      const nextBatch = this.manager.advance();

      if (isNewCycle || !nextBatch) {
        await this.callbacks.onCycleComplete(this.manager.getCycleNumber());

        if (!this.running) return;
        return;
      }

      this.manager.startCurrentBatch();
      await this.callbacks.onBatchChange(nextBatch, false);

      this.scheduleNext();

    } catch (err) {
      this.callbacks.onError(err instanceof Error ? err : new Error(String(err)));
      this.timer = setTimeout(() => {
        this.timer = null;
        this.advanceBatch();
      }, 60000);
      this.timer.unref?.();
    }
  }

  /**
   * Called when a new cycle is initialized externally
   */
  onNewCycleInitialized(): void {
    this.scheduleNext();
  }

  getStatus(): {
    running: boolean;
    currentBatch: string | null;
    remainingMinutes: number;
    progress: { current: number; total: number };
  } {
    return {
      running: this.running,
      currentBatch: this.manager.getCurrentBatch()?.name ?? null,
      remainingMinutes: this.manager.getRemainingMinutes(),
      progress: this.manager.getProgress(),
    };
  }
}
