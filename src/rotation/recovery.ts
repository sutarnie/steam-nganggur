import { logger } from '../logger.js';
import type { RotationState } from '../storage/state.js';
import type { RandomizedCycle, RandomizedBatch } from './randomizer.js';
import type { BatchConfig } from '../config/types.js';
import { generateCycle } from './randomizer.js';
import { CycleManager } from './cycle.js';

const log = logger.child({ component: 'Recovery' });

export interface RecoveryResult {
  cycle: RandomizedCycle;
  cycleManager: CycleManager;
  action: 'new_cycle' | 'resume' | 'catch_up' | 'advance';
  nextBatch: RandomizedBatch | null;
  waitMinutes: number;
}

export function recover(
  persistedState: RotationState,
  batchConfigs: BatchConfig[]
): RecoveryResult {
  const now = Date.now();
  const lastUpdated = new Date(persistedState.lastUpdatedAt).getTime();
  const timeSinceUpdate = now - lastUpdated;

  if (!log.isPretty()) {
    log.info('Recovery started', {
      cycle: persistedState.cycleNumber,
      currentBatch: persistedState.currentBatchId,
      batchEndsAt: persistedState.batchEndsAt,
      timeSinceUpdateMinutes: Math.round(timeSinceUpdate / 60000),
    });
  }

  
  if (!persistedState.cycleOrder.length ||
      persistedState.currentBatchIndex < 0 ||
      persistedState.completedBatches.length >= batchConfigs.length) {
    return createNewCycle(persistedState.cycleNumber + 1, batchConfigs);
  }

  const cycle = reconstructCycle(persistedState, batchConfigs);
  const manager = new CycleManager();
  manager.restore(cycle, persistedState as any);

  const batchEndsAt = persistedState.batchEndsAt
    ? new Date(persistedState.batchEndsAt).getTime()
    : null;

  
  if (batchEndsAt && now < batchEndsAt) {
    const waitMinutes = Math.ceil((batchEndsAt - now) / 60000);
    if (!log.isPretty()) {
      log.info('Resuming current batch', {
        batch: cycle.batches[persistedState.currentBatchIndex]?.name,
        waitMinutes,
      });
    }
    return {
      cycle,
      cycleManager: manager,
      action: 'resume',
      nextBatch: manager.getCurrentBatch(),
      waitMinutes,
    };
  }

  if (batchEndsAt && now >= batchEndsAt) {
    return catchUp(manager, cycle, now, batchConfigs);
  }

  if (!log.isPretty()) {
    log.warn('Batch has no end time, starting fresh');
  }
  return {
    cycle,
    cycleManager: manager,
    action: 'new_cycle',
    nextBatch: manager.getCurrentBatch(),
    waitMinutes: 0,
  };
}

export function createNewCycle(
  cycleNumber: number,
  batchConfigs: BatchConfig[]
): RecoveryResult {
  const cycle = generateCycle(cycleNumber, batchConfigs);
  const manager = new CycleManager();
  manager.initialize(cycle);
  manager.startCurrentBatch();

  return {
    cycle,
    cycleManager: manager,
    action: 'new_cycle',
    nextBatch: manager.getCurrentBatch(),
    waitMinutes: 0,
  };
}

function reconstructCycle(
  state: RotationState,
  batchConfigs: BatchConfig[]
): RandomizedCycle {
  const batchMap = new Map(batchConfigs.map(b => [b.id, b]));

  const batches = state.cycleOrder
    .map(id => batchMap.get(id))
    .filter((b): b is BatchConfig => b !== undefined)
    .map((config, index) => ({
      id: config.id,
      name: config.name,
      appIds: [...config.appIds],
      durationMinutes: index === state.currentBatchIndex && state.batchDurationMinutes
        ? state.batchDurationMinutes
        : pickDuration(config),
    }));

  return {
    cycleNumber: state.cycleNumber,
    batches,
    generatedAt: state.lastUpdatedAt,
  };
}

function pickDuration(config: BatchConfig): number {
  const minTotalMinutes = config.minDurationHours * 60 + (config.minDurationMinutes ?? 0);
  const maxTotalMinutes = config.maxDurationHours * 60 + (config.maxDurationMinutes ?? 0);
  return Math.floor(Math.random() * (maxTotalMinutes - minTotalMinutes + 1)) + minTotalMinutes;
}

function catchUp(
  manager: CycleManager,
  cycle: RandomizedCycle,
  now: number,
  batchConfigs: BatchConfig[]
): RecoveryResult {
  let action: 'catch_up' | 'advance' = 'catch_up';
  let missed = 0;

  while (!manager.isCycleComplete() && manager.isCurrentBatchEnded()) {
    const next = manager.advance();
    if (next) {
      missed++;
      if (!log.isPretty()) {
        log.info('Catch-up: skipped completed batch', { batch: next.name });
      }
    }
  }

  if (manager.isCycleComplete()) {
    if (!log.isPretty()) {
      log.info('Cycle completed during downtime, starting new cycle');
    }
    return createNewCycle(cycle.cycleNumber + 1, batchConfigs);
  }

  const currentBatch = manager.getCurrentBatch();
  const waitMinutes = manager.getRemainingMinutes();

  if (!log.isPretty()) {
    log.info('Catch-up complete', {
      missedBatches: missed,
      currentBatch: currentBatch?.name,
      waitMinutes,
    });
  }

  return {
    cycle,
    cycleManager: manager,
    action,
    nextBatch: currentBatch,
    waitMinutes,
  };
}
