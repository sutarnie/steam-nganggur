import { promises as fs } from 'fs';
import { join } from 'path';
import { logger } from '../logger.js';
import { config as dotenvConfig } from 'dotenv';
import type {
  RotationConfig,
  SteamConfig,
  PersonaState,
  PersonaRotationConfig,
  LoggingConfig,
  LogLevel,
  LogColorMode,
  LogFormat,
  SettingsConfig
} from './types.js';

const log = logger.child({ component: 'Config' });

function loadEnvFiles(): void {
  const cwd = process.cwd();
  dotenvConfig({ path: join(cwd, 'account.env'), override: false });
  dotenvConfig({ path: join(cwd, '.env'), override: false });
}

loadEnvFiles();

function getEnv(name: string): string | undefined {
  return process.env[name];
}

function getEnvInt(name: string, defaultValue: number): number {
  const val = getEnv(name);
  return val ? parseInt(val, 10) : defaultValue;
}

function getEnvBool(name: string, defaultValue: boolean): boolean {
  const val = getEnv(name);
  return val ? val !== 'false' : defaultValue;
}

function getEnvPersonaState(name: string, defaultValue: PersonaState | undefined): PersonaState | undefined {
  const val = getEnv(name);
  if (!val) return defaultValue;
  const parsed = parseInt(val, 10);
  return [1, 3, 5, 6, 7].includes(parsed) ? (parsed as PersonaState) : defaultValue;
}

function getPersonaRotationConfig(): PersonaRotationConfig | undefined {
  const enabled = getEnvBool('PERSONA_ROTATION_ENABLED', true);
  const intervalHours = getEnvInt('PERSONA_ROTATION_INTERVAL_HOURS', 4);
  const statesStr = getEnv('PERSONA_ROTATION_STATES');
  const states: PersonaState[] = statesStr
    ? statesStr.split(',').map(s => parseInt(s.trim(), 10)).filter(s => [1, 3, 5, 6, 7].includes(s)) as PersonaState[]
    : [1, 3, 5];
  return { enabled, intervalHours, states };
}

function getEnvLogLevel(name: string, defaultValue: LogLevel): LogLevel {
  const val = getEnv(name);
  if (!val) return defaultValue;
  const levels: LogLevel[] = ['error', 'warn', 'info', 'debug'];
  return levels.includes(val as LogLevel) ? (val as LogLevel) : defaultValue;
}

function getEnvLogColor(name: string, defaultValue: LogColorMode): LogColorMode {
  const val = getEnv(name);
  if (!val) return defaultValue;
  if (val === 'auto' || val === 'true' || val === 'false') return val as LogColorMode;
  return defaultValue;
}

function getEnvLogFormat(name: string, defaultValue: LogFormat): LogFormat {
  const val = getEnv(name);
  if (!val) return defaultValue;
  return val === 'json' ? 'json' : 'pretty';
}

export function loadLoggingConfig(): LoggingConfig {
  return {
    level: getEnvLogLevel('LOG_LEVEL', 'info'),
    color: getEnvLogColor('LOG_COLOR', 'auto'),
    format: getEnvLogFormat('LOG_FORMAT', 'pretty'),
  };
}

export async function loadSettingsConfig(settingsPath?: string): Promise<SettingsConfig> {
  const defaultPath = join(process.cwd(), 'settings.json');
  const path = settingsPath ?? defaultPath;

  try {
    const content = await fs.readFile(path, 'utf8');
    const config = JSON.parse(content) as SettingsConfig;

    const idler = config.idler ?? {};
    const loginRetry = config.loginRetry ?? {};
    const logging = config.logging ?? {};

    return {
      idler: {
        heartbeatInterval: typeof idler.heartbeatInterval === 'number' ? idler.heartbeatInterval : 300,
        autoReconnect: typeof idler.autoReconnect === 'boolean' ? idler.autoReconnect : true,
        maxReconnectAttempts: typeof idler.maxReconnectAttempts === 'number' ? idler.maxReconnectAttempts : 0,
        reconnectDelay: typeof idler.reconnectDelay === 'number' ? idler.reconnectDelay : 5000,
        loginDelay: typeof idler.loginDelay === 'number' ? idler.loginDelay : 3000,
        autoRequestFreeLicenses: typeof idler.autoRequestFreeLicenses === 'boolean' ? idler.autoRequestFreeLicenses : true,
        afkMessage: typeof idler.afkMessage === 'string' ? idler.afkMessage : undefined,
        proxy: typeof idler.proxy === 'string' && idler.proxy.trim() !== '' ? idler.proxy.trim() : undefined,
      },
      loginRetry: {
        maxRetries: typeof loginRetry.maxRetries === 'number' ? loginRetry.maxRetries : 5,
        baseDelay: typeof loginRetry.baseDelay === 'number' ? loginRetry.baseDelay : 5000,
        maxDelay: typeof loginRetry.maxDelay === 'number' ? loginRetry.maxDelay : 300000,
        rateLimitMultiplier: typeof loginRetry.rateLimitMultiplier === 'number' ? loginRetry.rateLimitMultiplier : 3,
      },
      logging: {
        level: (logging.level as LogLevel) ?? 'info',
        color: (logging.color as LogColorMode) ?? 'auto',
        format: (logging.format as LogFormat) ?? 'pretty',
      },
    };
  } catch (err: any) {
    if (err.code === 'ENOENT') {
      log.warn('Settings file not found, using defaults', { path });
      return {
        idler: { heartbeatInterval: 300, autoReconnect: true, maxReconnectAttempts: 0, reconnectDelay: 5000, loginDelay: 3000, autoRequestFreeLicenses: true, afkMessage: 'I\'m currently AFK. Will reply when I\'m back!', proxy: undefined },
        loginRetry: { maxRetries: 5, baseDelay: 5000, maxDelay: 300000, rateLimitMultiplier: 3 },
        logging: { level: 'info', color: 'auto', format: 'pretty' },
      };
    }
    log.error('Failed to load settings config', { error: err.message });
    throw err;
  }
}

export function loadSteamConfig(): SteamConfig {
  const accountName = getEnv('STEAM_USER');
  const password = getEnv('STEAM_PASS');
  const loginMethodRaw = getEnv('STEAM_LOGIN');
  const loginMethod: 'credentials' | 'qr' = loginMethodRaw === 'qr' ? 'qr' : 'credentials';

  if (!accountName) {
    throw new Error('STEAM_USER is required');
  }

  if (loginMethod === 'credentials' && !password) {
    throw new Error('STEAM_PASS is required for credentials login');
  }

  return {
    accountName,
    password,
    twoFactorSecret: getEnv('STEAM_2FA'),
    identitySecret: getEnv('STEAM_IDENTITY'),
    loginMethod,
  };
}

export async function loadFullConfig(): Promise<FullConfig> {
  return {
    steam: loadSteamConfig(),
    settings: await loadSettingsConfig(),
    rotation: await loadRotationConfig(),
  };
}


const DEFAULT_MIN_DURATION_HOURS = 1;
const DEFAULT_MAX_DURATION_HOURS = 999999;
const MAX_ALLOWED_DURATION_HOURS = 999999;

function getDurationHours(batch: any, field: 'minDurationHours' | 'maxDurationHours', defaultValue: number): number {
  const value = batch[field];
  return typeof value === 'number' && !Number.isNaN(value) ? value : defaultValue;
}

function getDurationMinutes(batch: any, field: 'minDurationMinutes' | 'maxDurationMinutes'): number {
  const value = batch[field];
  return typeof value === 'number' && !Number.isNaN(value) ? value : 0;
}

function validateDurationRange(minHours: number, minMinutes: number, maxHours: number, maxMinutes: number, batchId: number): void {
  const minTotalMinutes = minHours * 60 + minMinutes;
  const maxTotalMinutes = maxHours * 60 + maxMinutes;

  if (minTotalMinutes > maxTotalMinutes) {
    throw new Error(`Batch ${batchId}: min duration (${minHours}h ${minMinutes}m) > max duration (${maxHours}h ${maxMinutes}m)`);
  }
  if (minTotalMinutes < 1) {
    throw new Error(`Batch ${batchId}: minimum duration must be at least 1 minute`);
  }
  if (maxTotalMinutes > MAX_ALLOWED_DURATION_HOURS * 60) {
    throw new Error(`Batch ${batchId}: maximum duration exceeds ${MAX_ALLOWED_DURATION_HOURS} hours`);
  }
}

export async function loadRotationConfig(configPath?: string): Promise<RotationConfig> {
  const defaultPath = join(process.cwd(), 'config.json');
  const path = configPath ?? defaultPath;

  try {
    const content = await fs.readFile(path, 'utf8');
    const config = JSON.parse(content) as RotationConfig;

    
    if (!Array.isArray(config.alwaysIdle)) {
      throw new Error('alwaysIdle must be an array');
    }
    if (!Array.isArray(config.batches) || config.batches.length === 0) {
      throw new Error('batches must be a non-empty array');
    }

    for (const batch of config.batches) {
      if (!batch.id || !batch.name || !Array.isArray(batch.appIds)) {
        throw new Error(`Invalid batch config: ${JSON.stringify(batch)}`);
      }

      const minHours = getDurationHours(batch, 'minDurationHours', DEFAULT_MIN_DURATION_HOURS);
      const maxHours = getDurationHours(batch, 'maxDurationHours', DEFAULT_MAX_DURATION_HOURS);
      const minMinutes = getDurationMinutes(batch, 'minDurationMinutes');
      const maxMinutes = getDurationMinutes(batch, 'maxDurationMinutes');

      validateDurationRange(minHours, minMinutes, maxHours, maxMinutes, batch.id);

      const minTotalMinutes = minHours * 60 + minMinutes;
      const maxTotalMinutes = maxHours * 60 + maxMinutes;
      const avgTotalMinutes = Math.round((minTotalMinutes + maxTotalMinutes) / 2);
      const baseHours = maxHours >= 100000 ? minHours : Math.round(avgTotalMinutes / 60);

      batch.minDurationHours = minHours;
      batch.maxDurationHours = maxHours;
      batch.minDurationMinutes = minMinutes;
      batch.maxDurationMinutes = maxMinutes;
      batch.baseDurationHours = baseHours;
    }

    if (config.personaRotation) {
      const pr = config.personaRotation;
      if (typeof pr.enabled !== 'boolean') {
        throw new Error('personaRotation.enabled must be boolean');
      }
      if (!Number.isInteger(pr.intervalHours) || pr.intervalHours < 1) {
        throw new Error('personaRotation.intervalHours must be a positive integer');
      }
      if (!Array.isArray(pr.states) || pr.states.length === 0) {
        throw new Error('personaRotation.states must be a non-empty array');
      }
      for (const state of pr.states) {
        if (![1, 3, 5, 6, 7].includes(state)) {
          throw new Error(`Invalid persona state in personaRotation.states: ${state}`);
        }
      }
    } else {
      config.personaRotation = getPersonaRotationConfig();
    }

    log.info('Rotation config loaded', {
      alwaysIdle: config.alwaysIdle.length,
      batches: config.batches.length,
      personaRotation: config.personaRotation ? { enabled: config.personaRotation.enabled, intervalHours: config.personaRotation.intervalHours, statesCount: config.personaRotation.states.length } : 'disabled',
    });

    return config;
  } catch (err: any) {
    if (err.code === 'ENOENT') {
      throw new Error(`Config file not found: ${path}. Copy config.example.json to config.json`);
    }
    log.error('Failed to load rotation config', { error: err.message });
    throw err;
  }
}

export interface FullConfig {
  steam: SteamConfig;
  settings: SettingsConfig;
  rotation: RotationConfig;
}
