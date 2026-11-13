import { Command } from 'commander';
import chalk from 'chalk';
import { spawnSync } from 'child_process';
import { logger } from '../../logger.js';

const log = logger.child({ component: 'CLI:logs' });

const SERVICE_NAME = 'steam-rotation';

interface LogsOptions {
  lines?: number;
  follow?: boolean;
  since?: string;
}

export function logsCommand(program: Command): void {
  program
    .command('logs')
    .description('View service logs (journalctl)')
    .option('-n, --lines <number>', 'Number of lines to show', '50')
    .option('-f, --follow', 'Follow logs (like tail -f)')
    .option('-s, --since <time>', 'Show logs since time (e.g., "1 hour ago", "2024-01-01")')
    .action(async (options: LogsOptions) => {
      const needsSudo = process.getuid?.() !== 0;
      const cmd = needsSudo ? 'sudo' : 'journalctl';

      let args: string[] = [];

      if (needsSudo) {
        args.push('journalctl');
      }

      args.push('-u', SERVICE_NAME);

      if (options.follow) {
        args.push('-f');
      } else {
        args.push('-n', String(options.lines));
      }

      if (options.since) {
        args.push('--since', options.since);
      }

      console.log(chalk.cyan(`Fetching logs for ${SERVICE_NAME}...`));

      const result = spawnSync(cmd, args, { stdio: 'inherit' });
      process.exit(result.status ?? 0);
    });
}
