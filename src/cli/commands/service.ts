import { Command } from 'commander';
import chalk from 'chalk';
import { promises as fs } from 'fs';
import { join } from 'path';
import { spawnSync } from 'child_process';
import { logger } from '../../logger.js';

const log = logger.child({ component: 'CLI:service' });

const SERVICE_NAME = 'steam-rotation';
const SERVICE_FILE = `/etc/systemd/system/${SERVICE_NAME}.service`;
const LOCAL_SERVICE_PATH = join(process.cwd(), 'systemd', 'steam-rotation.service');

interface ServiceOptions {
  user?: string;
}

export function serviceCommand(program: Command): void {
  const service = program
    .command('service')
    .description('Manage systemd service (Linux)');

  service
    .command('install')
    .description('Install systemd service')
    .option('-u, --user <user>', 'Service user (default: steam)')
    .action(async (options: ServiceOptions) => {
      const user = options.user || 'steam';

      console.log(chalk.cyan('\n📦 Installing systemd service...'));

      
      if (process.getuid?.() !== 0) {
        console.log(chalk.yellow('⚠'), 'This command needs sudo. Re-running with sudo...');
        const result = spawnSync('sudo', ['sn', 'service', 'install', '-u', user], {
          stdio: 'inherit',
          shell: true,
        });
        process.exit(result.status ?? 1);
        return;
      }

      try {
        const serviceContent = await fs.readFile(LOCAL_SERVICE_PATH, 'utf8');
        const updatedContent = serviceContent.replace(/^User=.*$/m, `User=${user}`);
        await fs.writeFile(SERVICE_FILE, updatedContent);
        console.log(chalk.green('✓'), `Service file written to ${SERVICE_FILE}`);

        const reloadResult = spawnSync('systemctl', ['daemon-reload'], { stdio: 'inherit' });
        if (reloadResult.status !== 0) {
          throw new Error('systemctl daemon-reload failed');
        }
        console.log(chalk.green('✓'), 'systemd daemon reloaded');

        const enableResult = spawnSync('systemctl', ['enable', SERVICE_NAME], { stdio: 'inherit' });
        if (enableResult.status !== 0) {
          throw new Error('systemctl enable failed');
        }
        console.log(chalk.green('✓'), 'Service enabled (auto-start on boot)');

        console.log(chalk.cyan('\nNext:'), chalk.bold(`sn service start`));

      } catch (err: any) {
        console.error(chalk.red('Install failed:'), err.message);
        process.exit(1);
      }
    });

  service
    .command('start')
    .description('Start the service')
    .action(() => runSystemctl('start'));

  service
    .command('stop')
    .description('Stop the service')
    .action(() => runSystemctl('stop'));

  service
    .command('restart')
    .description('Restart the service')
    .action(() => runSystemctl('restart'));

  service
    .command('status')
    .description('Show service status')
    .action(() => runSystemctl('status'));

  service
    .command('enable')
    .description('Enable auto-start on boot')
    .action(() => runSystemctl('enable'));

  service
    .command('disable')
    .description('Disable auto-start on boot')
    .action(() => runSystemctl('disable'));
}

function runSystemctl(action: string): void {
  const needsSudo = process.getuid?.() !== 0;
  const cmd = needsSudo ? 'sudo' : 'systemctl';
  const args = needsSudo ? ['systemctl', action, SERVICE_NAME] : [action, SERVICE_NAME];

  const result = spawnSync(cmd, args, { stdio: 'inherit' });
  process.exit(result.status ?? 0);
}
