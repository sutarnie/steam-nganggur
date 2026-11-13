import { Command } from 'commander';
import chalk from 'chalk';
import { promises as fs } from 'fs';
import { join } from 'path';
import { spawnSync } from 'child_process';
import { loadFullConfig } from '../../config/loader.js';
import { logger } from '../../logger.js';

const log = logger.child({ component: 'CLI:config' });

export function configCommand(program: Command): void {
  const config = program
    .command('config')
    .description('Manage configuration');

  config
    .command('show')
    .description('Show current configuration')
    .action(async () => {
      try {
        const fullConfig = await loadFullConfig();

        console.log(chalk.cyan('\n═══════════════════════════════════'));
        console.log(chalk.bold('  Current Configuration  '));
        console.log(chalk.cyan('═══════════════════════════════════\n'));

        console.log(chalk.bold('Steam:'));
        console.log(`  Account: ${fullConfig.steam.accountName}`);
        console.log(`  Login Method: ${fullConfig.steam.loginMethod}`);
        console.log(`  2FA: ${fullConfig.steam.twoFactorSecret ? 'Configured' : 'Not configured'}`);
        console.log(`  Identity Secret: ${fullConfig.steam.identitySecret ? 'Configured' : 'Not configured'}`);

        console.log(chalk.bold('\nIdler:'));
        console.log(`  Heartbeat: ${fullConfig.settings.idler.heartbeatInterval}s`);
        console.log(`  Auto-reconnect: ${fullConfig.settings.idler.autoReconnect}`);
        console.log(`  Max reconnect: ${fullConfig.settings.idler.maxReconnectAttempts === 0 ? 'Infinite' : fullConfig.settings.idler.maxReconnectAttempts}`);
        console.log(`  Reconnect delay: ${fullConfig.settings.idler.reconnectDelay}ms`);
        console.log(`  Log level: ${fullConfig.settings.logging.level}`);

        console.log(chalk.bold('\nRotation:'));
        console.log(`  Always idle games: ${fullConfig.rotation.alwaysIdle.length}`);
        if (fullConfig.rotation.alwaysIdle.length > 0) {
          console.log(`    ${fullConfig.rotation.alwaysIdle.join(', ')}`);
        }
        console.log(`  Batches: ${fullConfig.rotation.batches.length}`);
        for (const batch of fullConfig.rotation.batches) {
          console.log(`    [${batch.id}] ${batch.name}: ${batch.appIds.join(', ')} (${batch.minDurationHours}-${batch.maxDurationHours}h)`);
        }

      } catch (err: any) {
        console.error(chalk.red('Error:'), err.message);
        process.exit(1);
      }
    });

  config
    .command('edit')
    .description('Edit config.json in $EDITOR')
    .action(async () => {
      const configPath = join(process.cwd(), 'config.json');
      const editor = process.env['EDITOR'] || process.env['VISUAL'] || 'notepad';

      console.log(chalk.cyan(`Opening ${configPath} in ${editor}...`));
      const result = spawnSync(editor, [configPath], {
        stdio: 'inherit',
        shell: true,
      });

      if (result.status !== 0) {
        console.error(chalk.red('Editor exited with error'));
        process.exit(1);
      }

      try {
        await loadFullConfig();
        console.log(chalk.green('✓ Config is valid'));
      } catch (err: any) {
        console.error(chalk.red('Config validation failed:'), err.message);
        process.exit(1);
      }
    });

  config
    .command('validate')
    .description('Validate configuration files')
    .action(async () => {
      try {
        await loadFullConfig();
        console.log(chalk.green('✓ All configuration is valid'));
      } catch (err: any) {
        console.error(chalk.red('Validation failed:'), err.message);
        process.exit(1);
      }
    });
}
