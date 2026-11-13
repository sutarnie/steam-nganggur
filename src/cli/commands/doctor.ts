import { Command } from 'commander';
import chalk from 'chalk';
import { promises as fs } from 'fs';
import { join } from 'path';
import { loadFullConfig } from '../../config/loader.js';
import { acquireLockOrExit } from '../../lock/single-instance.js';
import { StateStore } from '../../storage/state.js';
import { logger } from '../../logger.js';

const log = logger.child({ component: 'CLI:doctor' });

interface CheckResult {
  name: string;
  passed: boolean;
  message: string;
}

export function doctorCommand(program: Command): void {
  program
    .command('doctor')
    .description('Run health checks')
    .action(async () => {
      console.log(chalk.cyan('\n═══════════════════════════════════'));
      console.log(chalk.bold('  SteamNganggur Health Check  '));
      console.log(chalk.cyan('═══════════════════════════════════\n'));

      const checks: CheckResult[] = [];

      checks.push(await checkNodeVersion());
      checks.push(await checkEnvFile());
      checks.push(await checkConfigFile());
      checks.push(await checkConfigValidation());
      checks.push(await checkLockFile());
      checks.push(await checkStateFile());
      checks.push(await checkDistExists());
      checks.push(await checkDependencies());

      printResults(checks);

      const failed = checks.filter(c => !c.passed).length;
      if (failed > 0) {
        console.log(chalk.red(`\n✗ ${failed} check(s) failed`));
        process.exit(1);
      } else {
        console.log(chalk.green('\n✓ All checks passed'));
      }
    });
}

async function checkNodeVersion(): Promise<CheckResult> {
  const version = process.version;
  const versionStr = (typeof version === 'string' && version) ? version : 'v0.0.0';
  const parts = versionStr.slice(1).split('.');
  const major = parseInt(parts[0] ?? '0', 10);

  if (major >= 18) {
    return { name: 'Node.js version', passed: true, message: `${versionStr} (>= 18 required)` };
  }
  return { name: 'Node.js version', passed: false, message: `${versionStr} (>= 18 required)` };
}

async function checkEnvFile(): Promise<CheckResult> {
  const envPath = join(process.cwd(), '.env');
  try {
    await fs.access(envPath);
    return { name: '.env file', passed: true, message: 'Found' };
  } catch {
    return { name: '.env file', passed: false, message: 'Missing (run: sn init)' };
  }
}

async function checkConfigFile(): Promise<CheckResult> {
  const configPath = join(process.cwd(), 'config.json');
  try {
    await fs.access(configPath);
    return { name: 'config.json', passed: true, message: 'Found' };
  } catch {
    return { name: 'config.json', passed: false, message: 'Missing (run: sn init)' };
  }
}

async function checkConfigValidation(): Promise<CheckResult> {
  try {
    const config = await loadFullConfig();
    return {
      name: 'Config validation',
      passed: true,
      message: `OK (${config.rotation.alwaysIdle.length} always idle, ${config.rotation.batches.length} batches)`
    };
  } catch (err: any) {
    return { name: 'Config validation', passed: false, message: err.message };
  }
}

async function checkLockFile(): Promise<CheckResult> {
  const lockPath = join(process.cwd(), 'data', 'steam-rotation.lock');
  try {
    const content = await fs.readFile(lockPath, 'utf8');
    const pid = parseInt(content.trim(), 10);

    if (!Number.isNaN(pid) && pid > 0) {
      try {
        process.kill(pid, 0);
        return { name: 'Lock file', passed: false, message: `Active (PID ${pid}) - another instance running` };
      } catch {
        return { name: 'Lock file', passed: true, message: `Stale (PID ${pid} not running) - will be cleaned on start` };
      }
    }
    return { name: 'Lock file', passed: true, message: 'Exists but invalid PID' };
  } catch {
    return { name: 'Lock file', passed: true, message: 'No lock file (OK)' };
  }
}

async function checkStateFile(): Promise<CheckResult> {
  const statePath = join(process.cwd(), 'data', 'state.json');
  try {
    const content = await fs.readFile(statePath, 'utf8');
    const state = JSON.parse(content);
    return {
      name: 'State file',
      passed: true,
      message: `Cycle ${state.cycleNumber}, batch ${state.currentBatchIndex + 1}/${state.cycleOrder.length}`
    };
  } catch {
    return { name: 'State file', passed: true, message: 'No state file (fresh start)' };
  }
}

async function checkDistExists(): Promise<CheckResult> {
  const distPath = join(process.cwd(), 'dist', 'index.js');
  try {
    await fs.access(distPath);
    return { name: 'Production build', passed: true, message: 'dist/index.js exists' };
  } catch {
    return { name: 'Production build', passed: false, message: 'Not built (run: sn build)' };
  }
}

async function checkDependencies(): Promise<CheckResult> {
  const nodeModules = join(process.cwd(), 'node_modules');
  try {
    await fs.access(nodeModules);
    return { name: 'Dependencies', passed: true, message: 'node_modules exists' };
  } catch {
    return { name: 'Dependencies', passed: false, message: 'Not installed (run: npm install)' };
  }
}

function printResults(checks: CheckResult[]): void {
  for (const check of checks) {
    const icon = check.passed ? chalk.green('✓') : chalk.red('✗');
    const name = check.passed ? check.name : chalk.red(check.name);
    console.log(`  ${icon} ${name}: ${check.message}`);
  }
}
