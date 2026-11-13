import { logger } from '../logger.js';
import type { RandomizedCycle, RandomizedBatch } from './randomizer.js';

const log = logger.child({ component: 'CycleManager' });

export interface CycleState {
  cycleNumber: number;
  cycleOrder: number[];
  currentBatchIndex: number;
  currentBatchId: number | null;
  batchStartedAt: string | null;
  batchEndsAt: string | null;
  batchDurationMinutes: number | null;
  completedBatches: number[];
  lastUpdatedAt: string;
}

export class CycleManager {
  private cycle: RandomizedCycle | null = null;
  private state: CycleState;

  constructor(initialState?: Partial<CycleState>) {
    this.state = {
      cycleNumber: initialState?.cycleNumber ?? 0,
      cycleOrder: initialState?.cycleOrder ?? [],
      currentBatchIndex: initialState?.currentBatchIndex ?? -1,
      currentBatchId: initialState?.currentBatchId ?? null,
      batchStartedAt: initialState?.batchStartedAt ?? null,
      batchEndsAt: initialState?.batchEndsAt ?? null,
      batchDurationMinutes: initialState?.batchDurationMinutes ?? null,
      completedBatches: initialState?.completedBatches ?? [],
      lastUpdatedAt: initialState?.lastUpdatedAt ?? new Date().toISOString(),
    };
  }

  initialize(cycle: RandomizedCycle): void {
    this.cycle = cycle;
    this.state = {
      cycleNumber: cycle.cycleNumber,
      cycleOrder: cycle.batches.map(b => b.id),
      currentBatchIndex: 0,
      currentBatchId: cycle.batches[0]?.id ?? null,
      batchStartedAt: new Date().toISOString(),
      batchEndsAt: null,
      batchDurationMinutes: cycle.batches[0]?.durationMinutes ?? null,
      completedBatches: [],
      lastUpdatedAt: new Date().toISOString(),
    };
    log.info('Cycle initialized', { cycle: this.state.cycleNumber, totalBatches: cycle.batches.length });
  }

  startCurrentBatch(): void {
    if (!this.cycle) throw new Error('No cycle initialized');

    const now = new Date().toISOString();
    const batch = this.getCurrentBatch();
    if (!batch) throw new Error('No current batch');

    this.state.batchStartedAt = now;
    this.state.batchEndsAt = new Date(Date.now() + batch.durationMinutes * 60000).toISOString();
    this.state.batchDurationMinutes = batch.durationMinutes;

    log.info('Batch started', {
      batch: batch.name,
      duration: `${batch.durationMinutes} min`,
      endsAt: this.state.batchEndsAt,
    });
  }

  advance(): RandomizedBatch | null {
    if (!this.cycle) throw new Error('No cycle initialized');

    
    if (this.state.currentBatchId) {
      this.state.completedBatches.push(this.state.currentBatchId);
    }

    this.state.currentBatchIndex++;

    if (this.state.currentBatchIndex >= this.cycle.batches.length) {
      log.info('Cycle completed', { cycle: this.state.cycleNumber });
      return null;
    }

    const nextBatch = this.cycle.batches[this.state.currentBatchIndex];
    if (!nextBatch) {
      log.warn('No next batch available, cycle may be complete');
      return null;
    }
    this.state.currentBatchId = nextBatch.id;
    this.state.batchStartedAt = new Date().toISOString();
    this.state.batchEndsAt = new Date(Date.now() + nextBatch.durationMinutes * 60000).toISOString();
    this.state.batchDurationMinutes = nextBatch.durationMinutes;

    log.info('Advanced to next batch', {
      batch: nextBatch.name,
      duration: `${nextBatch.durationMinutes} min`,
      endsAt: this.state.batchEndsAt,
      progress: `${this.state.currentBatchIndex + 1}/${this.cycle.batches.length}`,
    });

    return nextBatch;
  }

  /**
   * Get current batch info
   */
  getCurrentBatch(): RandomizedBatch | null {
    if (!this.cycle || this.state.currentBatchIndex < 0) return null;
    const batch = this.cycle.batches[this.state.currentBatchIndex];
    return batch ?? null;
  }

  /**
   * Get remaining minutes in current batch
   */
  getRemainingMinutes(): number {
    if (!this.state.batchEndsAt) return 0;
    const remaining = new Date(this.state.batchEndsAt).getTime() - Date.now();
    return Math.max(0, Math.ceil(remaining / 60000));
  }

  isCurrentBatchEnded(): boolean {
    if (!this.state.batchEndsAt) return false;
    return Date.now() >= new Date(this.state.batchEndsAt).getTime();
  }

  isCycleComplete(): boolean {
    return this.state.currentBatchIndex >= (this.cycle?.batches.length ?? 0);
  }

  toState(): CycleState {
    return { ...this.state };
  }

  restore(cycle: RandomizedCycle, state: CycleState): void {
    this.cycle = cycle;
    this.state = { ...state };
    log.debug('Cycle state restored', { cycle: state.cycleNumber, batchIndex: state.currentBatchIndex });
  }

  getCycleNumber(): number {
    return this.state.cycleNumber;
  }

  getProgress(): { current: number; total: number } {
    return {
      current: this.state.currentBatchIndex + 1,
      total: this.cycle?.batches.length ?? 0,
    };
  }

  getBatchEndTime(): Date {
    if (!this.state.batchEndsAt) return new Date();
    return new Date(this.state.batchEndsAt);
  }
}
