import { Command } from 'commander';
import chalk from 'chalk';
import { spawnSync } from 'child_process';
import { promises as fs } from 'fs';
import { join } from 'path';
import { logger } from '../../logger.js';

const log = logger.child({ component: 'CLI:build' });

interface BuildOptions {
  clean?: boolean;
}

export function buildCommand(program: Command): void {
  program
    .command('build')
    .description('Compile TypeScript to dist/')
    .option('--clean', 'Clean dist/ before building')
    .action(async (options: BuildOptions) => {
      if (options.clean) {
        console.log(chalk.cyan('🧹 Cleaning dist/...'));
        try {
          await fs.rm(join(process.cwd(), 'dist'), { recursive: true, force: true });
        } catch {
        }
      }

      console.log(chalk.cyan('🔨 Building...'));
      const result = spawnSync('npm', ['run', 'build'], {
        stdio: 'inherit',
        shell: true,
      });

      if (result.status !== 0) {
        console.error(chalk.red('Build failed'));
        process.exit(1);
      }

      console.log(chalk.green('✓ Build complete'));
    });
}
