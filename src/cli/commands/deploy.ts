import { Command } from 'commander';
import chalk from 'chalk';
import { spawnSync } from 'child_process';
import { promises as fs } from 'fs';
import { join } from 'path';
import { logger } from '../../logger.js';

const log = logger.child({ component: 'CLI:deploy' });

interface DeployOptions {
  user?: string;
  path?: string;
  branch?: string;
}

export function deployCommand(program: Command): void {
  program
    .command('deploy <host>')
    .description('Deploy to VPS via SSH')
    .option('-u, --user <user>', 'SSH user (default: root)')
    .option('-p, --path <path>', 'Remote path (default: /opt/steam-rotation)')
    .option('-b, --branch <branch>', 'Git branch to deploy (default: current)')
    .action(async (host: string, options: DeployOptions) => {
      const user = options.user || 'root';
      const remotePath = options.path || '/opt/steam-rotation';
      const sshTarget = `${user}@${host}`;

      console.log(chalk.cyan('\n═══════════════════════════════════'));
      console.log(chalk.bold(`  Deploying to ${sshTarget}:${remotePath}  `));
      console.log(chalk.cyan('═══════════════════════════════════\n'));

      try {
        await checkGitClean();

        const branch = options.branch || await getCurrentBranch();
        const commit = await getCurrentCommit();

        console.log(chalk.gray(`Branch: ${branch} (${commit.slice(0, 7)})`));

        const deployScript = createDeployScript(remotePath, branch);

        await rsyncProject(sshTarget, remotePath);

        await runRemoteDeploy(sshTarget, remotePath, deployScript);

        console.log(chalk.green('\n✓ Deployment complete!'));
        console.log(chalk.cyan('\nNext steps on VPS:'));
        console.log(`  ssh ${sshTarget}`);
        console.log(`  sudo -u steam sn service install`);
        console.log(`  sudo -u steam sn service start`);
        console.log(`  sn logs`);

      } catch (err: any) {
        console.error(chalk.red('Deployment failed:'), err.message);
        process.exit(1);
      }
    });
}

async function checkGitClean(): Promise<void> {
  const result = spawnSync('git', ['status', '--porcelain'], { encoding: 'utf8' });
  if (result.stdout.trim()) {
    console.log(chalk.yellow('⚠'), 'Working directory has uncommitted changes');
  }
}

async function getCurrentBranch(): Promise<string> {
  const result = spawnSync('git', ['rev-parse', '--abbrev-ref', 'HEAD'], { encoding: 'utf8' });
  return result.stdout.trim() || 'main';
}

async function getCurrentCommit(): Promise<string> {
  const result = spawnSync('git', ['rev-parse', 'HEAD'], { encoding: 'utf8' });
  return result.stdout.trim() || 'unknown';
}

function createDeployScript(remotePath: string, branch: string): string {
  return `#!/bin/bash
set -e

echo "📦 Deploying to ${remotePath}"

# Create directory
sudo mkdir -p ${remotePath}
sudo chown -R steam:steam ${remotePath}

# Switch to steam user for npm operations
cd ${remotePath}

echo "📥 Installing dependencies..."
sudo -u steam npm ci --omit=dev

echo "🔨 Building..."
sudo -u steam npm run build

echo "✓ Deploy complete"
`;
}

async function rsyncProject(sshTarget: string, remotePath: string): Promise<void> {
  console.log(chalk.cyan('📤 Syncing project files...'));

  const excludes = [
    '--exclude=node_modules',
    '--exclude=dist',
    '--exclude=data',
    '--exclude=.git',
    '--exclude=*.log',
    '--exclude=.DS_Store',
  ].join(' ');

  const result = spawnSync('rsync', [
    '-avz',
    '--delete',
    ...excludes.split(' '),
    `${join(process.cwd(), '/')}`,
    `${sshTarget}:${remotePath}/`,
  ], { stdio: 'inherit', shell: true });

  if (result.status !== 0) {
    throw new Error('rsync failed');
  }
  console.log(chalk.green('✓'), 'Files synced');
}

async function runRemoteDeploy(sshTarget: string, remotePath: string, deployScript: string): Promise<void> {
  console.log(chalk.cyan('🚀 Running remote deploy...'));

  const scriptPath = '/tmp/steam-nganggur-deploy.sh';

  const writeResult = spawnSync('ssh', [
    sshTarget,
    `cat > ${scriptPath} << 'EOF'\n${deployScript}\nEOF`
  ], { stdio: 'inherit' });

  if (writeResult.status !== 0) {
    throw new Error('Failed to write deploy script');
  }

  const runResult = spawnSync('ssh', [
    sshTarget,
    `chmod +x ${scriptPath} && ${scriptPath}`
  ], { stdio: 'inherit' });

  if (runResult.status !== 0) {
    throw new Error('Remote deploy script failed');
  }

  console.log(chalk.green('✓'), 'Remote deploy complete');
}
