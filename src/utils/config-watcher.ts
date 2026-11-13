import { promises as fsp } from 'fs';
import { watch, FSWatcher } from 'fs';
import { join, resolve } from 'path';
import { EventEmitter } from 'events';
import { logger } from '../logger.js';
import { loadRotationConfig } from '../config/loader.js';
import type { RotationConfig } from '../config/types.js';

const log = logger.child({ component: 'ConfigWatcher' });

export class ConfigWatcher extends EventEmitter {
  private configPath: string;
  private watcher?: FSWatcher;
  private debounceTimer?: ReturnType<typeof setTimeout>;
  private lastConfig?: RotationConfig;
  private isWatching = false;

  constructor(configPath?: string) {
    super();
    this.configPath = resolve(configPath ?? join(process.cwd(), 'config.json'));
  }

  /**
   * Start watching the config file
   */
  async start(): Promise<void> {
    if (this.isWatching) {
      log.debug('Already watching config');
      return;
    }

    this.lastConfig = await loadRotationConfig(this.configPath);
    log.info('Config watcher started', { path: this.configPath });

    this.watcher = watch(this.configPath, { persistent: false });

    this.watcher.on('change', () => {
      this.handleChange();
    });

    (this.watcher as any).unref?.();
    this.isWatching = true;
  }

  /**
   * Stop watching
   */
  stop(): void {
    if (this.watcher) {
      this.watcher.close();
      this.watcher = undefined;
    }
    if (this.debounceTimer) {
      clearTimeout(this.debounceTimer);
      this.debounceTimer = undefined;
    }
    this.isWatching = false;
    log.info('Config watcher stopped');
  }

  /**
   * Handle file change event with debouncing
   */
  private handleChange(): void {
    if (this.debounceTimer) {
      clearTimeout(this.debounceTimer);
    }

    this.debounceTimer = setTimeout(async () => {
      try {
        await this.reloadConfig();
      } catch (err) {
        this.emit('error', err instanceof Error ? err : new Error(String(err)));
      }
    }, 500);
  }

  /**
   * Reload config and emit event if changed
   */
  private async reloadConfig(): Promise<void> {
    try {
      const newConfig = await loadRotationConfig(this.configPath);

      if (this.configsEqual(this.lastConfig, newConfig)) {
        log.debug('Config file changed but content unchanged, ignoring');
        return;
      }

      log.info('Config changed, reloading rotation config', {
        batches: newConfig.batches.length,
        alwaysIdle: newConfig.alwaysIdle.length,
      });

      this.lastConfig = newConfig;
      this.emit('configChanged', newConfig);
    } catch (err) {
      log.error('Failed to reload config', { error: err instanceof Error ? err.message : String(err) });
      throw err;
    }
  }

  /**
   * Compare two configs for equality (shallow comparison of key fields)
   */
  private configsEqual(a?: RotationConfig, b?: RotationConfig): boolean {
    if (!a || !b) return false;
    if (a.alwaysIdle.length !== b.alwaysIdle.length) return false;
    if (a.batches.length !== b.batches.length) return false;

    const idleEqual = a.alwaysIdle.every((id: number, i: number) => id === b.alwaysIdle[i]);
    if (!idleEqual) return false;

    for (let i = 0; i < a.batches.length; i++) {
      const ba = a.batches[i];
      const bb = b.batches[i];
      if (!ba || !bb) return false;
      if (ba.id !== bb.id || ba.name !== bb.name) return false;
      if (ba.appIds.length !== bb.appIds.length) return false;
      if (!ba.appIds.every((id: number, j: number) => id === bb.appIds[j])) return false;
      if (ba.minDurationHours !== bb.minDurationHours) return false;
      if (ba.maxDurationHours !== bb.maxDurationHours) return false;
      if ((ba.minDurationMinutes ?? 0) !== (bb.minDurationMinutes ?? 0)) return false;
      if ((ba.maxDurationMinutes ?? 0) !== (bb.maxDurationMinutes ?? 0)) return false;
    }

    return true;
  }

  /**
   * Get current config
   */
  getConfig(): RotationConfig | undefined {
    return this.lastConfig;
  }

  /**
   * Manually trigger reload
   */
  async reload(): Promise<void> {
    await this.reloadConfig();
  }
}
