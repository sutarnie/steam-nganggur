import { promises as fs } from 'fs';
import { join } from 'path';

export async function ensureDataDir(cwd: string = process.cwd()): Promise<void> {
  const dataDir = join(cwd, 'data');
  try {
    await fs.mkdir(dataDir, { recursive: true });
  } catch (err: any) {
    if (err.code !== 'EEXIST') {
      throw err;
    }
  }
}
