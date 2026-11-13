import { promises as fs } from 'fs';
import { join } from 'path';
import { logger } from '../logger.js';

const log = logger.child({ component: 'StateStore' });

export interface RotationState {
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

const DEFAULT_STATE: RotationState = {
  cycleNumber: 0,
  cycleOrder: [],
  currentBatchIndex: -1,
  currentBatchId: null,
  batchStartedAt: null,
  batchEndsAt: null,
  batchDurationMinutes: null,
  completedBatches: [],
  lastUpdatedAt: new Date().toISOString(),
};

export class StateStore {
  private statePath: string;
  private tempPath: string;

  constructor(statePath?: string) {
    const defaultPath = join(process.cwd(), 'data', 'state.json');
    this.statePath = statePath ?? defaultPath;
    this.tempPath = this.statePath + '.tmp';
  }

  async read(): Promise<RotationState> {
    try {
      const content = await fs.readFile(this.statePath, 'utf8');
      const state = JSON.parse(content) as RotationState;
      if (!log.isPretty()) {
        log.debug('State loaded', { cycle: state.cycleNumber, batch: state.currentBatchId });
      }
      return this.validateAndMigrate(state);
    } catch (err: any) {
      if (err.code === 'ENOENT') {
        if (!log.isPretty()) {
          log.info('No state file, starting fresh');
        }
        return DEFAULT_STATE;
      }
      log.error('Failed to read state', { error: err.message });
      throw err;
    }
  }

  async write(state: RotationState): Promise<void> {
    const now = new Date().toISOString();
    const payload = { ...state, lastUpdatedAt: now };

    
    await fs.writeFile(this.tempPath, JSON.stringify(payload, null, 2), 'utf8');
    await fs.rename(this.tempPath, this.statePath);

    if (!log.isPretty()) {
      log.debug('State saved', { cycle: payload.cycleNumber, batch: payload.currentBatchId });
    }
  }

  private validateAndMigrate(state: any): RotationState {
    
    return {
      cycleNumber: state.cycleNumber ?? 0,
      cycleOrder: Array.isArray(state.cycleOrder) ? state.cycleOrder : [],
      currentBatchIndex: typeof state.currentBatchIndex === 'number' ? state.currentBatchIndex : -1,
      currentBatchId: state.currentBatchId ?? null,
      batchStartedAt: state.batchStartedAt ?? null,
      batchEndsAt: state.batchEndsAt ?? null,
      batchDurationMinutes: typeof state.batchDurationMinutes === 'number' ? state.batchDurationMinutes : null,
      completedBatches: Array.isArray(state.completedBatches) ? state.completedBatches : [],
      lastUpdatedAt: state.lastUpdatedAt ?? new Date().toISOString(),
    };
  }
}
