export type PersonaState = 1 | 3 | 5 | 6 | 7;

export type LogLevel = 'error' | 'warn' | 'info' | 'debug';
export type LogColorMode = 'auto' | true | false;
export type LogFormat = 'pretty' | 'json';

export interface LoggingConfig {
  level: LogLevel;
  color: LogColorMode;
  format: LogFormat;
}

export interface BatchConfig {
  id: number;
  name: string;
  appIds: number[];
  baseDurationHours: number;
  minDurationHours: number;
  maxDurationHours: number;
  minDurationMinutes?: number;
  maxDurationMinutes?: number;
  personaState?: PersonaState;
}

export interface PersonaRotationConfig {
  enabled: boolean;
  intervalHours: number;
  states: PersonaState[];
}

export interface RotationConfig {
  alwaysIdle: number[];
  batches: BatchConfig[];
  personaRotation?: PersonaRotationConfig;
}

export interface SteamConfig {
  accountName: string;
  password?: string;
  twoFactorSecret?: string;
  identitySecret?: string;
  loginMethod: 'credentials' | 'qr';
}


export interface IdlerSettings {
  heartbeatInterval: number;      
  autoReconnect: boolean;
  maxReconnectAttempts: number;   
  reconnectDelay: number;         
  loginDelay: number;             
  autoRequestFreeLicenses: boolean;
  afkMessage?: string;            
  proxy?: string;                 
}

export interface LoginRetrySettings {
  maxRetries: number;
  baseDelay: number;              
  maxDelay: number;               
  rateLimitMultiplier: number;
}

export interface SettingsConfig {
  idler: IdlerSettings;
  loginRetry: LoginRetrySettings;
  logging: LoggingConfig;
}
