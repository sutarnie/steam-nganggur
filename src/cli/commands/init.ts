import { Command } from 'commander';
import chalk from 'chalk';
import { promises as fs } from 'fs';
import { join } from 'path';
import { spawnSync } from 'child_process';
import { stdin as input, stdout as output } from 'node:process';
import * as readline from 'readline/promises';
import { logger } from '../../logger.js';

const log = logger.child({ component: 'CLI:init' });

interface InitOptions {
  skipInstall?: boolean;
  skipBuild?: boolean;
  nonInteractive?: boolean;
  yes?: boolean;
}

export function initCommand(program: Command): void {
  program
    .command('init')
    .description('First-time interactive setup')
    .option('--skip-install', 'Skip npm install')
    .option('--skip-build', 'Skip npm run build')
    .option('-y, --yes', 'Non-interactive mode (use defaults)')
    .action(async (options: InitOptions) => {
      console.log(chalk.cyan('\n╔═══════════════════════════════════════════╗'));
      console.log(chalk.cyan('║') + chalk.bold('  SteamNganggur - First Time Setup  ') + chalk.cyan('║'));
      console.log(chalk.cyan('╚═══════════════════════════════════════════╝\n'));

      const rl = readline.createInterface({ input, output });

      try {
        await checkNodeVersion();

        if (!options.skipInstall) {
          await runNpmInstall(options.yes);
        }

        await setupEnv(rl, options.yes);

        await setupConfig(rl, options.yes);

        if (!options.skipBuild) {
          await runBuild();
        }

        showNextSteps();

      } catch (err: any) {
        log.error('Setup failed', { error: err.message });
        console.error(chalk.red('\n✗ Setup failed:'), err.message);
        process.exit(1);
      } finally {
        rl.close();
      }
    });
}

async function checkNodeVersion(): Promise<void> {
  const version = process.version;
  const versionStr = (typeof version === 'string' && version) ? version : 'unknown';
  const parts = versionStr.slice(1).split('.');
  const major = parseInt(parts[0] ?? '0', 10);

  if (major < 18) {
    throw new Error(`Node.js >= 18 required, found ${versionStr}`);
  }
  console.log(chalk.green('✓'), `Node.js ${versionStr} detected`);
}

async function runNpmInstall(nonInteractive: boolean = false): Promise<void> {
  console.log(chalk.cyan('\n📦 Installing dependencies...'));

  const result = spawnSync('npm', ['install'], {
    stdio: nonInteractive ? 'pipe' : 'inherit',
    shell: true,
  });

  if (result.status !== 0) {
    throw new Error('npm install failed');
  }
  console.log(chalk.green('✓'), 'Dependencies installed');
}

async function setupEnv(rl: readline.Interface, nonInteractive: boolean = false): Promise<void> {
  const envPath = join(process.cwd(), '.env');
  const examplePath = join(process.cwd(), '.env.example');

  try {
    await fs.access(envPath);
    console.log(chalk.yellow('⚠'), '.env already exists, skipping');
    return;
  } catch {
    }

  console.log(chalk.cyan('\n🔐 Steam Credentials Setup'));

  let accountName = '';
  let password = '';
  let loginMethod = 'credentials';
  let twoFactorSecret = '';
  let identitySecret = '';

  if (!nonInteractive) {
    accountName = (await rl.question('Steam Account Name: ')) ?? '';

    const method = (await rl.question('Login method (credentials/qr) [credentials]: ')) ?? '';
    loginMethod = method === 'qr' ? 'qr' : 'credentials';

    if (loginMethod === 'credentials') {
      console.log(chalk.gray('  (password input will be visible)'));
      password = (await rl.question('Steam Password (or app password): ')) ?? '';
    }

    const twoFA = (await rl.question('2FA Shared Secret (optional, for auto-2FA): ')) ?? '';
    twoFactorSecret = twoFA.trim();

    const identity = (await rl.question('Identity Secret (optional, for trade confirms): ')) ?? '';
    identitySecret = identity.trim();
  } else {
    const example = await fs.readFile(examplePath, 'utf8');
    await fs.writeFile(envPath, example);
    console.log(chalk.yellow('⚠'), 'Created .env from example - please edit with your credentials');
    return;
  }

  
  const envContent = `# Steam Credentials
STEAM_USER=${accountName}
${loginMethod === 'credentials' ? `STEAM_PASS=${password}` : '# STEAM_PASS= (not needed for QR login)'}
STEAM_LOGIN=${loginMethod}
${twoFactorSecret ? `STEAM_2FA=${twoFactorSecret}` : '# STEAM_2FA='}
${identitySecret ? `STEAM_IDENTITY=${identitySecret}` : '# STEAM_IDENTITY='}

# Idler Behavior
HEARTBEAT=300
RECONNECT=true
MAX_RETRY=0
RETRY_DELAY=5000
LOG_LEVEL=info

# Login Retry Settings
LOGIN_MAX_RETRIES=5
LOGIN_BASE_DELAY=5000
LOGIN_MAX_DELAY=300000
LOGIN_RATE_LIMIT_MULTIPLIER=3

# Game selection is in config.json (batches + alwaysIdle)
`;

  await fs.writeFile(envPath, envContent);
  console.log(chalk.green('✓'), '.env created');
}

async function setupConfig(rl: readline.Interface, nonInteractive: boolean = false): Promise<void> {
  const configPath = join(process.cwd(), 'config.json');
  const examplePath = join(process.cwd(), 'config.example.json');

  try {
    await fs.access(configPath);
    console.log(chalk.yellow('⚠'), 'config.json already exists, skipping');
    return;
  } catch {
    }

  console.log(chalk.cyan('\n⚙️  Rotation Configuration'));

  if (!nonInteractive) {
    const useExample = await rl.question('Use example config (9 batches)? [Y/n]: ');
    if (useExample.toLowerCase() !== 'n') {
      const example = await fs.readFile(examplePath, 'utf8');
      await fs.writeFile(configPath, example);
      console.log(chalk.green('✓'), 'config.json created from example');
      return;
    }

    const permanentInput = await rl.question('Always Idle Game App IDs (comma-separated) []: ');
    const alwaysIdle = permanentInput
      .split(',')
      .map(s => s.trim())
      .filter(s => s.length > 0)
      .map(s => parseInt(s, 10))
      .filter(n => !Number.isNaN(n) && n > 0);

    const config = {
      alwaysIdle,
      batches: [],
    };

    await fs.writeFile(configPath, JSON.stringify(config, null, 2));
    console.log(chalk.green('✓'), 'config.json created (empty batches - edit to add)');
  } else {
    const example = await fs.readFile(examplePath, 'utf8');
    await fs.writeFile(configPath, example);
    console.log(chalk.green('✓'), 'config.json created from example');
  }
}

async function runBuild(): Promise<void> {
  console.log(chalk.cyan('\n🔨 Building TypeScript...'));

  const result = spawnSync('npm', ['run', 'build'], {
    stdio: 'inherit',
    shell: true,
  });

  if (result.status !== 0) {
    throw new Error('Build failed');
  }
  console.log(chalk.green('✓'), 'Build complete');
}

function showNextSteps(): void {
  console.log(chalk.cyan('\n═══════════════════════════════════════'));
  console.log(chalk.bold('  Setup Complete!  '));
  console.log(chalk.cyan('═══════════════════════════════════════\n'));

  console.log('Next steps:');
  console.log(chalk.gray('  1.'), 'Run in foreground (dev):', chalk.cyan('sn run'));
  console.log(chalk.gray('  2.'), 'Or build & run production:', chalk.cyan('sn run --prod'));
  console.log(chalk.gray('  3.'), 'Install as systemd service (Linux VPS):', chalk.cyan('sn service install'));
  console.log(chalk.gray('  4.'), 'View logs:', chalk.cyan('sn logs'));
  console.log(chalk.gray('  5.'), 'Health check:', chalk.cyan('sn doctor'));
  console.log();
}
