import { readFileSync } from 'fs';
import { join } from 'path';

const packageJson = JSON.parse(
  readFileSync(join(import.meta.dirname, '../../package.json'), 'utf8')
);

export const version = packageJson.version;
export const name = packageJson.name;
