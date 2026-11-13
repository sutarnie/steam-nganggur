import 'dotenv/config';
import { logger } from './logger.js';
import { loadFullConfig } from './config/loader.js';
import { acquireLockOrExit } from './lock/single-instance.js';
import { StateStore } from './storage/state.js';
import { generateCycle } from './rotation/randomizer.js';
import { CycleManager } from './rotation/cycle.js';
import { recover } from './rotation/recovery.js';
import { Scheduler } from './rotation/scheduler.js';
import { createSteamGamesUpdater } from './steam/games.js';
import { createPlaytimeLogger } from './steam/playtime.js';
import { SteamClient } from './steam-client.js';
import { ensureDataDir } from './utils/fs.js';

const log = logger.child({ component: 'Main' });

const GAME_NAMES = new Map<number, string>([
  [730, 'CS2'],
  [570, 'Dota 2'],
  [440, 'TF2'],
  [252490, 'Rust'],
  [578080, 'PUBG'],
  [1172470, 'Apex Legends'],
  [230410, 'Warframe'],
  [1085660, 'Destiny 2'],
  [1245620, 'Elden Ring'],
  [4732690, 'Game 4732690'],
  [4195600, 'Game 4195600'],
  [3879660, 'Game 3879660'],
  [3301060, 'Game 3301060'],
  [1920960, 'Game 1920960'],
  [1671200, 'Game 1671200'],
  [2325290, 'Game 2325290'],
  [2302530, 'Game 2302530'],
]);

async function main(): Promise<void> {
  await ensureDataDir();

  const lock = await acquireLockOrExit();
  log.info('Single-instance lock acquired');

  let config;
  try {
    config = await loadFullConfig();
  } catch (err) {
    log.error('Configuration error', { error: err instanceof Error ? err.message : String(err) });
    process.exit(1);
  }

  logger.setLevel(config.settings.logging.level);
  logger.setOptions({
    color: config.settings.logging.color,
    format: config.settings.logging.format,
  });

  const steamClient = new SteamClient(config.steam, config.settings.idler, config.settings.loginRetry);

  const stateStore = new StateStore();

  const playtimeLogger = createPlaytimeLogger(GAME_NAMES);
  const gamesUpdater = createSteamGamesUpdater(
    steamClient.getClient(),
    config.rotation.alwaysIdle,
    playtimeLogger
  );

  steamClient.getClient().once('loggedOn', async () => {
    logger.success('Steam connected');
    logger.success('Rotation engine initialized');

    try {
      await initializeRotation(
        config.rotation,
        stateStore,
        gamesUpdater,
        steamClient
      );
    } catch (err) {
      log.error('Rotation initialization failed', { error: err instanceof Error ? err.message : String(err) });
      process.exit(1);
    }
  });

  steamClient.getClient().on('error', (err: Error) => {
    log.error('Steam client error', { error: err.message });
  });

  const loginDelay = config.settings.idler.loginDelay ?? 0;
  if (loginDelay > 0) {
    if (!log.isPretty()) {
      log.info('Initial login delay', { delayMs: loginDelay });
    }
    await new Promise(resolve => setTimeout(resolve, loginDelay));
  }
  steamClient.login();

  let shuttingDown = false;
  const shutdown = async (signal: string) => {
    if (shuttingDown) return;
    shuttingDown = true;
    log.info(`Received ${signal}, shutting down...`);

    try {
      await stateStore.write({
        cycleNumber: 0,
        cycleOrder: [],
        currentBatchIndex: -1,
        currentBatchId: null,
        batchStartedAt: null,
        batchEndsAt: null,
        batchDurationMinutes: null,
        completedBatches: [],
        lastUpdatedAt: new Date().toISOString(),
      });
    } catch (err) {
      log.warn('Failed to save final state', { error: err instanceof Error ? err.message : String(err) });
    }

    try {
      const endedEntries = playtimeLogger.endAllSessions();
      if (endedEntries.length > 0) {
        await playtimeLogger.writeEntries(endedEntries);
      }
    } catch (err) {
      log.warn('Failed to write final playtime entries', { error: err instanceof Error ? err.message : String(err) });
    }

    steamClient.logOff();
    await lock.release();
    process.exit(0);
  };

  process.on('SIGINT', () => shutdown('SIGINT'));
  process.on('SIGTERM', () => shutdown('SIGTERM'));
}

async function initializeRotation(
  rotationConfig: any,
  stateStore: StateStore,
  gamesUpdater: any,
  steamClient: SteamClient
): Promise<void> {
  const persistedState = await stateStore.read();

  const recovery = recover(persistedState, rotationConfig.batches);

  const cycleManager = recovery.cycleManager;

  if (recovery.action !== 'new_cycle') {
    cycleManager.startCurrentBatch();
  }

  await gamesUpdater.updateGames(rotationConfig.alwaysIdle, recovery.nextBatch, GAME_NAMES);

  gamesUpdater.setCycleNumber(cycleManager.getCycleNumber());

  steamClient.setPersonaForBatch(
    rotationConfig.batches[0]?.personaState,
    rotationConfig.personaRotation
  );

  const currentBatch = cycleManager.getCurrentBatch();
  const cycleNumber = cycleManager.getCycleNumber();
  if (currentBatch) {
    const endTime = cycleManager.getBatchEndTime();
    logger.printCycleBox(
      cycleNumber,
      currentBatch.name,
      Math.round(currentBatch.durationMinutes / 60),
      rotationConfig.batches.length,
      endTime
    );
  }

  const scheduler = new Scheduler(cycleManager, {
    onBatchChange: async (batch, isNewCycle) => {
      if (batch) {
        const endTime = cycleManager.getBatchEndTime();
        logger.printCycleBox(
          cycleManager.getCycleNumber(),
          batch.name,
          Math.round(batch.durationMinutes / 60),
          rotationConfig.batches.length,
          endTime
        );

        gamesUpdater.setCycleNumber(cycleManager.getCycleNumber());

        steamClient.setPersonaForBatch(
          batch?.personaState,
          rotationConfig.personaRotation
        );
        await gamesUpdater.updateGames(rotationConfig.alwaysIdle, batch, GAME_NAMES);
        await persistState(stateStore, cycleManager);
      }
    },
    onCycleComplete: async (cycleNumber) => {
      logger.success(`Cycle ${cycleNumber} complete`);

      const newCycle = generateCycle(cycleNumber + 1, rotationConfig.batches);
      cycleManager.initialize(newCycle);
      cycleManager.startCurrentBatch();

      const firstBatch = cycleManager.getCurrentBatch();
      
      steamClient.setPersonaForBatch(
        firstBatch?.personaState,
        rotationConfig.personaRotation
      );
      gamesUpdater.setCycleNumber(cycleManager.getCycleNumber());
      await gamesUpdater.updateGames(rotationConfig.alwaysIdle, firstBatch, GAME_NAMES);
      await persistState(stateStore, cycleManager);

      if (firstBatch) {
        const endTime = cycleManager.getBatchEndTime();
        logger.printCycleBox(
          cycleManager.getCycleNumber(),
          firstBatch.name,
          Math.round(firstBatch.durationMinutes / 60),
          rotationConfig.batches.length,
          endTime
        );
      }

      scheduler.onNewCycleInitialized();
    },
    onError: (error) => {
      log.error('Scheduler error', { error: error.message });
    },
  });

  
  scheduler.start();

  
  if (currentBatch) {
    logger.printStatusLine(cycleNumber, currentBatch.name, cycleManager.getRemainingMinutes());
  }

  
  setInterval(async () => {
    await persistState(stateStore, cycleManager);
  }, 5 * 60 * 1000);
  
  (setInterval as any).unref?.();
}

async function persistState(stateStore: StateStore, cycleManager: CycleManager): Promise<void> {
  const state = cycleManager.toState();
  await stateStore.write(state);
}

main().catch(err => {
  log.error('Fatal error', { error: err.message, stack: err.stack });
  process.exit(1);
});
