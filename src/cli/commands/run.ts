import { Command } from 'commander';
import chalk from 'chalk';
import { spawnSync } from 'child_process';
import { logger } from '../../logger.js';

const log = logger.child({ component: 'CLI:run' });

interface RunOptions {
  prod?: boolean;
}

export function runCommand(program: Command): void {
  program
    .command('run')
    .description('Run the idler in foreground')
    .option('--prod', 'Build and run production mode')
    .action(async (options: RunOptions) => {
      if (options.prod) {
        console.log(chalk.cyan('🚀 Building and running production...'));

        const buildResult = spawnSync('npm', ['run', 'build'], {
          stdio: 'inherit',
          shell: true,
        });

        if (buildResult.status !== 0) {
          console.error(chalk.red('Build failed'));
          process.exit(1);
        }

        console.log(chalk.cyan('▶ Starting production...'));
        const runResult = spawnSync('npm', ['start'], {
          stdio: 'inherit',
          shell: true,
        });
        process.exit(runResult.status ?? 0);
      } else {
        console.log(chalk.cyan('▶ Starting development mode...'));
        const result = spawnSync('npm', ['run', 'dev'], {
          stdio: 'inherit',
          shell: true,
        });
        process.exit(result.status ?? 0);
      }
    });
}
