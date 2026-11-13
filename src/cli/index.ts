#!/usr/bin/env node

import 'dotenv/config';
import { program } from 'commander';
import chalk from 'chalk';
import { version } from '../config/version.js';
import { initCommand } from './commands/init.js';
import { runCommand } from './commands/run.js';
import { buildCommand } from './commands/build.js';
import { configCommand } from './commands/config.js';
import { serviceCommand } from './commands/service.js';
import { logsCommand } from './commands/logs.js';
import { doctorCommand } from './commands/doctor.js';
import { deployCommand } from './commands/deploy.js';
import { batchCommand } from './commands/batch.js';

program
  .name('sn')
  .description('SteamNganggur - Steam idler with batch rotation')
  .version(version)
  .addHelpText('after', `
Examples:
  $ sn init                    # First-time interactive setup
  $ sn run                     # Run in development mode
  $ sn run --prod              # Build and run production
  $ sn build                   # Compile TypeScript
  $ sn config show             # Show current configuration
  $ sn config edit             # Edit config.json in $EDITOR
  $ sn service install         # Install systemd service
  $ sn service start           # Start service
  $ sn logs                    # Follow logs
  $ sn doctor                  # Health check
  $ sn deploy user@host        # Deploy to VPS via SSH
  $ sn batch list              # List rotation batches
  $ sn batch add 10 "New" 1234 # Add batch
`);


initCommand(program);
runCommand(program);
buildCommand(program);
configCommand(program);
serviceCommand(program);
logsCommand(program);
doctorCommand(program);
deployCommand(program);
batchCommand(program);

program.exitOverride();

try {
  program.parse(process.argv);
} catch (err: any) {
  if (err.code === 'commander.helpDisplayed' || err.code === 'commander.versionDisplayed') {
    process.exit(0);
  }
  console.error(chalk.red('Error:'), err.message);
  process.exit(1);
}


if (!process.argv.slice(2).length) {
  program.outputHelp();
  process.exit(0);
}
