import { logger } from '../logger.js';
import type { BatchConfig } from '../config/types.js';

const log = logger.child({ component: 'Randomizer' });

export interface RandomizedBatch {
  id: number;
  name: string;
  appIds: number[];
  durationMinutes: number;
  personaState?: 1 | 3 | 5 | 6 | 7;
}

export interface RandomizedCycle {
  cycleNumber: number;
  batches: RandomizedBatch[];
  generatedAt: string;
}

export function shuffle<T>(array: readonly T[]): T[] {
  const result = [...array];
  for (let i = result.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    const temp = result[i];
    result[i] = result[j]!;
    result[j] = temp!;
  }
  return result;
}

function randomInt(min: number, max: number): number {
  return Math.floor(Math.random() * (max - min + 1)) + min;
}

function randomizeDuration(minHours: number, maxHours: number, minMinutes: number = 0, maxMinutes: number = 0): number {
  const minTotalMinutes = minHours * 60 + minMinutes;
  const maxTotalMinutes = maxHours * 60 + maxMinutes;
  return randomInt(minTotalMinutes, maxTotalMinutes);
}

export function generateCycle(
  cycleNumber: number,
  batchConfigs: BatchConfig[]
): RandomizedCycle {
  const shuffled = shuffle(batchConfigs);

  const batches: RandomizedBatch[] = shuffled.map(config => ({
    id: config.id,
    name: config.name,
    appIds: [...config.appIds],
    durationMinutes: randomizeDuration(
      config.minDurationHours,
      config.maxDurationHours,
      config.minDurationMinutes ?? 0,
      config.maxDurationMinutes ?? 0
    ),
    personaState: config.personaState,
  }));

  const cycle: RandomizedCycle = {
    cycleNumber,
    batches,
    generatedAt: new Date().toISOString(),
  };

  if (!log.isPretty()) {
    log.info('Generated new cycle', {
      cycle: cycleNumber,
      order: batches.map(b => b.id).join(' → '),
      durations: batches.map(b => `${b.name}: ${formatDuration(b.durationMinutes)}`).join(', '),
    });
  }

  return cycle;
}

export function formatDuration(minutes: number): string {
  const hours = Math.floor(minutes / 60);
  const mins = minutes % 60;
  return mins > 0 ? `${hours}h ${mins}m` : `${hours}h`;
}

export function pickBatchDuration(config: BatchConfig): number {
  return randomizeDuration(config.minDurationHours, config.maxDurationHours);
}
