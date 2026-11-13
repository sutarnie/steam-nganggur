import pino from 'pino';
import type { Logger as PinoLogger } from 'pino';
import * as pc from 'picocolors';

export type LogLevel = 'trace' | 'debug' | 'info' | 'warn' | 'error' | 'fatal';
export type LogColorMode = 'auto' | true | false;
export type LogFormat = 'pretty' | 'json';

interface LoggerOptions {
  level: LogLevel;
  color: LogColorMode;
  format: LogFormat;
}

function detectColorSupport(mode: LogColorMode): boolean {
  if (mode === true) return true;
  if (mode === false) return false;
  if (process.env['NO_COLOR']) return false;
  return Boolean(process.stdout.isTTY);
}

function formatLocalTime(date: Date = new Date()): string {
  return date.toLocaleTimeString(undefined, {
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    hour12: false,
  });
}

function formatLocalDateTime(date: Date = new Date()): string {
  return date.toLocaleString(undefined, {
    year: 'numeric',
    month: 'short',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
  });
}

function getTimezoneAbbr(): string {
  try {
    return Intl.DateTimeFormat().resolvedOptions().timeZone;
  } catch {
    return 'UTC';
  }
}

const RESET = pc.reset;
const BOLD = pc.bold;
const DIM = pc.dim;
const GREEN = pc.green;
const RED = pc.red;
const YELLOW = pc.yellow;
const BLUE = pc.blue;
const CYAN = pc.cyan;
const MAGENTA = pc.magenta;
const GRAY = pc.gray;

const SYMBOLS = {
  success: '✓',
  error: '✗',
  warning: '⚠',
  info: 'ℹ',
  bullet: '●',
  arrow: '→',
} as const;

const BOX = {
  tl: '┌',
  tr: '┐',
  bl: '└',
  br: '┘',
  h: '─',
  v: '│',
} as const;

const BOX_ASCII = {
  tl: '+',
  tr: '+',
  bl: '+',
  br: '+',
  h: '-',
  v: '|',
} as const;

function useUnicode(): boolean {
  if (process.platform !== 'win32') return true;
  return Boolean(process.env['WT_SESSION'] || process.env['TERM_PROGRAM'] === 'vscode' || process.env['ConEmuDir']);
}

const B = useUnicode() ? BOX : BOX_ASCII;

export class Logger {
  private logger: PinoLogger;
  private minLevel: LogLevel;
  private options: LoggerOptions;
  private useColor: boolean;
  private usePretty: boolean;

  constructor(options: Partial<LoggerOptions> = {}) {
    this.minLevel = options.level ?? 'info';
    this.options = {
      level: this.minLevel,
      color: options.color ?? 'auto',
      format: options.format ?? 'pretty',
    };
    this.useColor = detectColorSupport(this.options.color);
    this.usePretty = this.options.format === 'pretty';

    const pinoOptions: pino.LoggerOptions = {
      level: this.minLevel,
      base: { pid: process.pid },
      timestamp: this.usePretty ? () => `,"time":"${formatLocalTime()}"` : pino.stdTimeFunctions.isoTime,
      formatters: {
        level: (label) => ({ level: label }),
      },
    };

    this.logger = pino(pinoOptions);
  }

  setLevel(level: LogLevel): void {
    this.minLevel = level;
    this.logger.level = level;
  }

  setOptions(options: Partial<LoggerOptions>): void {
    this.options = { ...this.options, ...options };
    this.useColor = detectColorSupport(this.options.color);
    this.usePretty = this.options.format === 'pretty';
  }

  child(bindings: Record<string, unknown>): Logger {
    const child = new Logger(this.options);
    child.minLevel = this.minLevel;
    child.logger = this.logger.child(bindings);
    child.useColor = this.useColor;
    child.usePretty = this.usePretty;
    return child;
  }

  private log(level: LogLevel, message: string, context?: Record<string, unknown>): void {
    const fn = this.logger[level] as PinoLogger[LogLevel];
    context ? fn.call(this.logger, context, message) : fn.call(this.logger, message);
  }

  trace(msg: string, ctx?: Record<string, unknown>): void { this.log('trace', msg, ctx); }
  debug(msg: string, ctx?: Record<string, unknown>): void { this.log('debug', msg, ctx); }
  info(msg: string, ctx?: Record<string, unknown>): void { this.log('info', msg, ctx); }
  warn(msg: string, ctx?: Record<string, unknown>): void { this.log('warn', msg, ctx); }
  error(msg: string, ctx?: Record<string, unknown>): void { this.log('error', msg, ctx); }
  fatal(msg: string, ctx?: Record<string, unknown>): void { this.log('fatal', msg, ctx); }

  private pretty(level: 'success' | 'error' | 'warning' | 'info', message: string): void {
    if (!this.usePretty) return;

    const timestamp = formatLocalTime();
    const ts = this.useColor ? DIM(`[${timestamp}]`) : `[${timestamp}]`;

    let prefix: string;
    switch (level) {
      case 'success':
        prefix = this.useColor ? GREEN(SYMBOLS.success) : SYMBOLS.success;
        break;
      case 'error':
        prefix = this.useColor ? RED(SYMBOLS.error) : SYMBOLS.error;
        break;
      case 'warning':
        prefix = this.useColor ? YELLOW(SYMBOLS.warning) : SYMBOLS.warning;
        break;
      case 'info':
        prefix = this.useColor ? BLUE(SYMBOLS.info) : SYMBOLS.info;
        break;
    }

    console.log(`${ts} ${prefix} ${message}`);
  }

  success(msg: string): void { this.pretty('success', msg); }
  failure(msg: string): void { this.pretty('error', msg); }
  warnMsg(msg: string): void { this.pretty('warning', msg); }
  infoMsg(msg: string): void { this.pretty('info', msg); }

  printBanner(): void {
    if (!this.usePretty) return;

    const name = this.useColor ? CYAN(BOLD('STEAM NGANGGUR')) : 'STEAM NGANGGUR';
    const tagline = this.useColor ? DIM('Idle. Rotate. Repeat.') : 'Idle. Rotate. Repeat.';

    console.log(`\n${name}`);
    console.log(`${tagline}\n`);
  }

  printCycleBox(cycle: number, batchName: string, durationHours: number, batchCount: number, endTime: Date): void {
    if (!this.usePretty) return;

    const title = this.useColor ? CYAN(BOLD(` Cycle ${cycle} `)) : ` Cycle ${cycle} `;
    const tz = getTimezoneAbbr();
    const endStr = endTime.toLocaleString(undefined, {
      month: 'short',
      day: 'numeric',
      hour: '2-digit',
      minute: '2-digit',
      hour12: false,
    });

    const lines = [
      ` Games    : ${batchName}`,
      ` Duration : ${durationHours} hour${durationHours !== 1 ? 's' : ''}`,
      ` Batches  : ${batchCount}`,
      ` Next     : ${endStr} ${tz}`,
    ];

    const maxLen = Math.max(...lines.map(l => l.length), title.length);
    const width = maxLen + 2;

    const top = `${B.tl}${B.h.repeat(width)}${B.tr}`;
    const bottom = `${B.bl}${B.h.repeat(width)}${B.br}`;
    const titleLine = `${B.v} ${title}${' '.repeat(width - title.length - 1)}${B.v}`;

    console.log(this.useColor ? CYAN(top) : top);
    console.log(this.useColor ? CYAN(titleLine) : titleLine);

    for (const line of lines) {
      const padded = `${B.v} ${line}${' '.repeat(width - line.length - 1)}${B.v}`;
      console.log(this.useColor ? CYAN(B.v) + ' ' + line + ' '.repeat(width - line.length - 1) + CYAN(B.v) : padded);
    }

    console.log(this.useColor ? CYAN(bottom) : bottom);
    console.log('');
  }

  printGamesUpdate(added: number[], removed: number[], gameNames: Map<number, string>): void {
    if (!this.usePretty) return;

    this.success('Steam games updated');

    if (added.length > 0) {
      for (const id of added) {
        const name = gameNames.get(id) ?? `App ${id}`;
        const prefix = this.useColor ? GREEN('+ Added  ') : '+ Added  ';
        console.log(`             ${prefix}: ${name}`);
      }
    }

    if (removed.length > 0) {
      for (const id of removed) {
        const name = gameNames.get(id) ?? `App ${id}`;
        const prefix = this.useColor ? RED('- Removed') : '- Removed';
        console.log(`             ${prefix}: ${name}`);
      }
    }

    if (added.length === 0 && removed.length === 0) {
      const msg = this.useColor ? DIM('No changes') : 'No changes';
      console.log(`             ${msg}`);
    }
  }

  printStatusLine(cycle: number, batchName: string, remainingMinutes: number): void {
    if (!this.usePretty) return;

    const hours = Math.floor(remainingMinutes / 60);
    const mins = remainingMinutes % 60;
    const timeStr = hours > 0 ? `${hours}h ${mins}m` : `${mins}m`;

    const bullet = this.useColor ? GREEN(SYMBOLS.bullet) : SYMBOLS.bullet;
    const cycleStr = this.useColor ? CYAN(`Cycle ${cycle}`) : `Cycle ${cycle}`;
    const batchStr = this.useColor ? BOLD(batchName) : batchName;
    const timeStrColored = this.useColor ? YELLOW(timeStr) : timeStr;

    console.log(`${bullet} Running... | ${cycleStr} • ${batchStr} • ${timeStrColored}\n`);
  }

  printNextRotation(remainingMinutes: number): void {
    if (!this.usePretty) return;

    const hours = Math.floor(remainingMinutes / 60);
    const mins = remainingMinutes % 60;
    const timeStr = hours > 0 ? `${hours}h ${mins}m` : `${mins}m`;

    const prefix = this.useColor ? BLUE(SYMBOLS.info) : SYMBOLS.info;
    console.log(`${prefix} Next rotation in ${timeStr}`);
  }

  printConnectionStatus(connected: boolean): void {
    if (!this.usePretty) return;

    if (connected) {
      this.success('Steam connection restored');
    } else {
      this.warnMsg('Steam connection interrupted');
    }
  }

  printLoginRetry(attempt: number, maxRetries: number, delayMs: number, isRateLimit: boolean): void {
    if (!this.usePretty) return;

    const delaySec = Math.round(delayMs / 1000);
    const type = isRateLimit ? ' (rate limited)' : '';
    const prefix = this.useColor ? YELLOW(SYMBOLS.warning) : SYMBOLS.warning;
    console.log(`${prefix} Login failed, retrying in ${delaySec}s (attempt ${attempt}/${maxRetries})${type}`);
  }

  getPinoLogger(): PinoLogger {
    return this.logger;
  }

  getOptions(): LoggerOptions {
    return { ...this.options };
  }

  isPretty(): boolean {
    return this.usePretty;
  }
}


export const logger = new Logger();
