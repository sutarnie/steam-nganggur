import { Command } from 'commander';
import chalk from 'chalk';
import { promises as fs } from 'fs';
import { join } from 'path';
import { loadRotationConfig } from '../../config/loader.js';
import { logger } from '../../logger.js';
import type { RotationConfig, BatchConfig } from '../../config/types.js';

const log = logger.child({ component: 'CLI:batch' });

const CONFIG_PATH = join(process.cwd(), 'config.json');

interface BatchAddOptions {
  min?: string;
  max?: string;
  minMin?: string;
  maxMin?: string;
}

interface BatchEditOptions {
  name?: string;
  appId?: string;
  min?: string;
  max?: string;
  minMin?: string;
  maxMin?: string;
}

async function readConfig(): Promise<RotationConfig> {
  return loadRotationConfig(CONFIG_PATH);
}

async function writeConfig(config: RotationConfig): Promise<void> {
  const backupPath = CONFIG_PATH + '.bak';
  await fs.copyFile(CONFIG_PATH, backupPath);
  await fs.writeFile(CONFIG_PATH, JSON.stringify(config, null, 2), 'utf8');
  log.debug('Config saved', { backup: backupPath });
}

function validateBatchId(id: number, batches: BatchConfig[], excludeId?: number): void {
  if (batches.some(b => b.id === id && b.id !== excludeId)) {
    throw new Error(`Batch ID ${id} already exists`);
  }
}

function validateDuration(minHours: number, minMinutes: number, maxHours: number, maxMinutes: number): void {
  const minTotal = minHours * 60 + minMinutes;
  const maxTotal = maxHours * 60 + maxMinutes;
  if (minTotal > maxTotal) {
    throw new Error('Minimum duration cannot be greater than maximum duration');
  }
  if (minTotal < 1) {
    throw new Error('Minimum duration must be at least 1 minute');
  }
}

function validateAppId(appId: number): void {
  if (!Number.isInteger(appId) || appId <= 0) {
    throw new Error('App ID must be a positive integer');
  }
}

function parseIntOrThrow(value: string | undefined, fieldName: string): number {
  if (value === undefined) {
    throw new Error(`${fieldName} is required`);
  }
  const parsed = parseInt(value, 10);
  if (Number.isNaN(parsed)) {
    throw new Error(`${fieldName} must be an integer`);
  }
  return parsed;
}

function formatDurationDisplay(minHours: number, minMinutes: number, maxHours: number, maxMinutes: number): string {
  const minStr = minMinutes > 0 ? `${minHours}h ${minMinutes}m` : `${minHours}h`;
  const maxStr = maxMinutes > 0 ? `${maxHours}h ${maxMinutes}m` : `${maxHours}h`;
  return `${minStr} - ${maxStr}`;
}

export function batchCommand(program: Command): void {
  const batchCmd = program
    .command('batch')
    .description('Manage rotation batches');

  batchCmd
    .command('list')
    .description('List all batches')
    .action(async () => {
      try {
        const config = await readConfig();
        console.log(chalk.cyan('\n═══════════════════════════════════════'));
        console.log(chalk.bold('  Rotation Batches  '));
        console.log(chalk.cyan('═══════════════════════════════════════\n'));

        console.log(chalk.bold('Always Active Games:'), config.alwaysIdle.length > 0 ? config.alwaysIdle.join(', ') : '(none)');
        console.log();

        for (const batch of config.batches) {
          const duration = formatDurationDisplay(
            batch.minDurationHours,
            batch.minDurationMinutes ?? 0,
            batch.maxDurationHours,
            batch.maxDurationMinutes ?? 0
          );
          const appIds = batch.appIds.join(', ');
          console.log(`  [${batch.id}] ${chalk.bold(batch.name)}`);
          console.log(`       App IDs: ${appIds}`);
          console.log(`       Duration: ${duration}`);
          console.log(`       Base: ${batch.baseDurationHours}h`);
          console.log();
        }
      } catch (err: any) {
        console.error(chalk.red('Error:'), err.message);
        process.exit(1);
      }
    });

  batchCmd
    .command('add <id> <name> <appId>')
    .description('Add a new batch')
    .option('--min <hours>', 'Minimum duration hours', '1')
    .option('--max <hours>', 'Maximum duration hours', '24')
    .option('--min-min <minutes>', 'Minimum duration minutes (0-59)', '0')
    .option('--max-min <minutes>', 'Maximum duration minutes (0-59)', '0')
    .action(async (idStr: string, name: string, appIdStr: string, options: BatchAddOptions) => {
      try {
        const id = parseInt(idStr, 10);
        const appId = parseInt(appIdStr, 10);
        const minHours = parseIntOrThrow(options.min, 'min');
        const maxHours = parseIntOrThrow(options.max, 'max');
        const minMinutes = parseIntOrThrow(options.minMin, 'min-min');
        const maxMinutes = parseIntOrThrow(options.maxMin, 'max-min');

        if (Number.isNaN(id) || id <= 0) throw new Error('ID must be a positive integer');
        if (Number.isNaN(appId) || appId <= 0) throw new Error('App ID must be a positive integer');
        if (minMinutes < 0 || minMinutes > 59) throw new Error('min-min must be 0-59');
        if (maxMinutes < 0 || maxMinutes > 59) throw new Error('max-min must be 0-59');

        validateDuration(minHours, minMinutes, maxHours, maxMinutes);
        validateAppId(appId);

        const config = await readConfig();
        validateBatchId(id, config.batches);

        const totalMin = minHours * 60 + minMinutes;
        const totalMax = maxHours * 60 + maxMinutes;
        const newBatch: BatchConfig = {
          id,
          name,
          appIds: [appId],
          baseDurationHours: Math.round((totalMin + totalMax) / 2 / 60),
          minDurationHours: minHours,
          maxDurationHours: maxHours,
          minDurationMinutes: minMinutes,
          maxDurationMinutes: maxMinutes,
        };

        config.batches.push(newBatch);
        config.batches.sort((a, b) => a.id - b.id);

        await writeConfig(config);
        console.log(chalk.green('✓'), `Batch "${name}" (ID: ${id}) added`);
      } catch (err: any) {
        console.error(chalk.red('Error:'), err.message);
        process.exit(1);
      }
    });

  batchCmd
    .command('edit <id>')
    .description('Edit an existing batch')
    .option('--name <name>', 'New batch name')
    .option('--appId <id>', 'New App ID')
    .option('--min <hours>', 'New minimum duration hours')
    .option('--max <hours>', 'New maximum duration hours')
    .option('--min-min <minutes>', 'New minimum duration minutes (0-59)')
    .option('--max-min <minutes>', 'New maximum duration minutes (0-59)')
    .action(async (idStr: string, options: BatchEditOptions) => {
      try {
        const id = parseInt(idStr, 10);
        if (Number.isNaN(id) || id <= 0) throw new Error('ID must be a positive integer');

        const config = await readConfig();
        const batchIndex = config.batches.findIndex(b => b.id === id);
        if (batchIndex === -1) throw new Error(`Batch with ID ${id} not found`);

        const batch = config.batches[batchIndex]!;
        let changed = false;

        if (options.name !== undefined) {
          batch.name = options.name;
          changed = true;
        }
        if (options.appId !== undefined) {
          const appId = parseIntOrThrow(options.appId, 'appId');
          validateAppId(appId);
          batch.appIds = [appId];
          changed = true;
        }
        if (options.min !== undefined) {
          const minHours = parseIntOrThrow(options.min, 'min');
          if (options.minMin !== undefined) {
            const minMinutes = parseIntOrThrow(options.minMin, 'min-min');
            if (minMinutes < 0 || minMinutes > 59) throw new Error('min-min must be 0-59');
            batch.minDurationMinutes = minMinutes;
          }
          validateDuration(minHours, batch.minDurationMinutes ?? 0, batch.maxDurationHours, batch.maxDurationMinutes ?? 0);
          batch.minDurationHours = minHours;
          changed = true;
        }
        if (options.max !== undefined) {
          const maxHours = parseIntOrThrow(options.max, 'max');
          if (options.maxMin !== undefined) {
            const maxMinutes = parseIntOrThrow(options.maxMin, 'max-min');
            if (maxMinutes < 0 || maxMinutes > 59) throw new Error('max-min must be 0-59');
            batch.maxDurationMinutes = maxMinutes;
          }
          validateDuration(batch.minDurationHours, batch.minDurationMinutes ?? 0, maxHours, batch.maxDurationMinutes ?? 0);
          batch.maxDurationHours = maxHours;
          changed = true;
        }
        if (options.minMin !== undefined && options.min === undefined) {
          const minMinutes = parseIntOrThrow(options.minMin, 'min-min');
          if (minMinutes < 0 || minMinutes > 59) throw new Error('min-min must be 0-59');
          validateDuration(batch.minDurationHours, minMinutes, batch.maxDurationHours, batch.maxDurationMinutes ?? 0);
          batch.minDurationMinutes = minMinutes;
          changed = true;
        }
        if (options.maxMin !== undefined && options.max === undefined) {
          const maxMinutes = parseIntOrThrow(options.maxMin, 'max-min');
          if (maxMinutes < 0 || maxMinutes > 59) throw new Error('max-min must be 0-59');
          validateDuration(batch.minDurationHours, batch.minDurationMinutes ?? 0, batch.maxDurationHours, maxMinutes);
          batch.maxDurationMinutes = maxMinutes;
          changed = true;
        }

        if (changed) {
          const totalMin = batch.minDurationHours * 60 + (batch.minDurationMinutes ?? 0);
          const totalMax = batch.maxDurationHours * 60 + (batch.maxDurationMinutes ?? 0);
          batch.baseDurationHours = Math.round((totalMin + totalMax) / 2 / 60);
          await writeConfig(config);
          console.log(chalk.green('✓'), `Batch ${id} updated`);
        } else {
          console.log(chalk.yellow('No changes made'));
        }
      } catch (err: any) {
        console.error(chalk.red('Error:'), err.message);
        process.exit(1);
      }
    });

  batchCmd
    .command('delete <id>')
    .description('Delete a batch')
    .option('-y, --yes', 'Skip confirmation')
    .action(async (idStr: string, options: { yes?: boolean }) => {
      try {
        const id = parseInt(idStr, 10);
        if (Number.isNaN(id) || id <= 0) throw new Error('ID must be a positive integer');

        const config = await readConfig();
        const batchIndex = config.batches.findIndex(b => b.id === id);
        if (batchIndex === -1) throw new Error(`Batch with ID ${id} not found`);

        const batch = config.batches[batchIndex]!;

        if (!options.yes) {
          console.log(chalk.yellow(`About to delete batch: [${batch.id}] ${batch.name}`));
          console.log(chalk.gray('Use --yes to skip this prompt'));
          process.exit(0);
        }

        config.batches.splice(batchIndex, 1);
        await writeConfig(config);
        console.log(chalk.green('✓'), `Batch ${id} deleted`);
      } catch (err: any) {
        console.error(chalk.red('Error:'), err.message);
        process.exit(1);
      }
    });

  batchCmd
    .command('reorder <id> <newIndex>')
    .description('Move batch to new position (0-based index)')
    .action(async (idStr: string, newIndexStr: string) => {
      try {
        const id = parseInt(idStr, 10);
        const newIndex = parseInt(newIndexStr, 10);

        if (Number.isNaN(id) || id <= 0) throw new Error('ID must be a positive integer');
        if (Number.isNaN(newIndex) || newIndex < 0) throw new Error('New index must be a non-negative integer');

        const config = await readConfig();
        const batchIndex = config.batches.findIndex(b => b.id === id);
        if (batchIndex === -1) throw new Error(`Batch with ID ${id} not found`);

        if (newIndex >= config.batches.length) {
          throw new Error(`Index out of range (max: ${config.batches.length - 1})`);
        }

        const removed = config.batches.splice(batchIndex, 1);
        const batch = removed[0]!;
        config.batches.splice(newIndex, 0, batch);

        await writeConfig(config);
        console.log(chalk.green('✓'), `Batch ${id} moved to position ${newIndex}`);
      } catch (err: any) {
        console.error(chalk.red('Error:'), err.message);
        process.exit(1);
      }
    });
}
