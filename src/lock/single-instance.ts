import { promises as fs } from 'fs';
import { join } from 'path';
import { logger } from '../logger.js';

const log = logger.child({ component: 'SingleInstance' });

export class SingleInstanceLock {
  private lockPath: string;
  private fileHandle: fs.FileHandle | null = null;
  private released = false;

  constructor(lockPath?: string) {
    const defaultPath = join(process.cwd(), 'data', 'steam-rotation.lock');
    this.lockPath = lockPath ?? defaultPath;
  }

  async acquire(): Promise<boolean> {
    try {
      this.fileHandle = await fs.open(this.lockPath, 'wx');
      await this.fileHandle.writeFile(String(process.pid), 'utf8');

      log.debug('Lock acquired', { path: this.lockPath, pid: process.pid });
      return true;
    } catch (err: any) {
      if (err.code === 'EEXIST') {
        const existingPid = await this.readExistingPid();
        if (existingPid && this.isProcessAlive(existingPid)) {
          log.warn('Another instance is running', { pid: existingPid });
          return false;
        }
        log.warn('Stale lock detected, removing', { pid: existingPid });
        await fs.unlink(this.lockPath).catch(() => {});
        return this.acquire();
      }
      log.error('Failed to acquire lock', { error: err.message });
      throw err;
    }
  }

  private async readExistingPid(): Promise<number | null> {
    try {
      const content = await fs.readFile(this.lockPath, 'utf8');
      const pid = parseInt(content.trim(), 10);
      return Number.isNaN(pid) ? null : pid;
    } catch {
      return null;
    }
  }

  private isProcessAlive(pid: number): boolean {
    try {
      process.kill(pid, 0);
      return true;
    } catch (err: any) {
      return err.code !== 'ESRCH';
    }
  }

  async release(): Promise<void> {
    if (this.released || this.fileHandle === null) return;

    try {
      await this.fileHandle.close();
      await fs.unlink(this.lockPath).catch(() => {});
      this.released = true;
      this.fileHandle = null;
      log.debug('Lock released');
    } catch (err: any) {
      log.warn('Error releasing lock', { error: err.message });
    }
  }
}

export async function acquireLockOrExit(lockPath?: string): Promise<SingleInstanceLock> {
  const lock = new SingleInstanceLock(lockPath);
  const acquired = await lock.acquire();

  if (!acquired) {
    console.error('Another instance is already running. Exiting.');
    process.exit(1);
  }

  
  const cleanup = async () => {
    await lock.release();
    process.exit(0);
  };

  process.on('SIGINT', cleanup);
  process.on('SIGTERM', cleanup);
  process.on('exit', () => lock.release().catch(() => {}));

  return lock;
}
