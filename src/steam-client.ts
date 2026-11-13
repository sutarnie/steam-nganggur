import SteamUser from 'steam-user';
import type { SteamUser as SteamUserType, LoggedOnDetails } from 'steam-user';

const EPersonaState = SteamUser.EPersonaState;
const EResult = SteamUser.EResult;
import { getAuthCode } from 'steam-totp';
import { LoginSession, EAuthTokenPlatformType } from 'steam-session';
import qrcode from 'qrcode-terminal';
import { SteamConfig, IdlerSettings, LoginRetrySettings, PersonaState, PersonaRotationConfig } from './config/types.js';
import { logger } from './logger.js';

const EBillingType = {
  NoCost: 0,
  GuestPass: 1,
  FreeOnDemand: 2,
  FreeCommercialLicense: 3,
} as const;

const log = logger.child({ component: 'SteamClient' });

function getErrorDescription(eresult: number): string {
  const name = EResult[eresult] ?? `Unknown (${eresult})`;
  const descriptions: Record<number, string> = {
    [EResult.InvalidPassword]: 'Invalid password',
    [EResult.AccountLogonDenied]: 'Email Steam Guard code required',
    [EResult.AccountLoginDeniedNeedTwoFactor]: '2FA code required',
    [EResult.TwoFactorCodeMismatch]: 'Invalid 2FA code',
    [EResult.RateLimitExceeded]: 'Rate limit exceeded (too many login attempts)',
    [EResult.AccountLoginDeniedThrottle]: 'Login throttled (too many attempts)',
    [EResult.InvalidLoginAuthCode]: 'Invalid Steam Guard code',
    [EResult.AccountLockedDown]: 'Account locked',
    [EResult.AccountDisabled]: 'Account disabled',
    [EResult.ServiceUnavailable]: 'Steam service unavailable',
    [EResult.TryAnotherCM]: 'Try another Steam server',
    [EResult.LoggedInElsewhere]: 'Already logged in elsewhere',
    [EResult.AlreadyLoggedInElsewhere]: 'Already logged in elsewhere',
    [EResult.Fail]: 'Login failed',
    [EResult.Timeout]: 'Login timeout',
    [EResult.NoConnection]: 'No connection to Steam',
    [EResult.InvalidParam]: 'Invalid login parameters',
    [EResult.AccessDenied]: 'Access denied',
    [EResult.Banned]: 'Account banned',
    [EResult.ExpiredLoginAuthCode]: 'Expired Steam Guard code',
    [EResult.TwoFactorActivationCodeMismatch]: 'Invalid 2FA activation code',
  };
  return descriptions[eresult] ?? name;
}

function isRateLimitError(eresult: number): boolean {
  return eresult === EResult.RateLimitExceeded || eresult === EResult.AccountLoginDeniedThrottle;
}

function isAuthError(eresult: number): boolean {
  return [
    EResult.InvalidPassword,
    EResult.AccountLogonDenied,
    EResult.AccountLoginDeniedNeedTwoFactor,
    EResult.TwoFactorCodeMismatch,
    EResult.InvalidLoginAuthCode,
    EResult.AccountLockedDown,
    EResult.AccountDisabled,
    EResult.AccessDenied,
    EResult.Banned,
    EResult.ExpiredLoginAuthCode,
    EResult.TwoFactorActivationCodeMismatch,
  ].includes(eresult);
}

export class SteamClient {
  private client: SteamUserType;
  private config: SteamConfig;
  private idlerSettings: IdlerSettings;
  private loginRetrySettings: LoginRetrySettings;
  private heartbeatTimer?: ReturnType<typeof setInterval>;
  private reconnectAttempts = 0;
  private loginSession?: LoginSession;
  private loginResolve?: (value: void) => void;
  private loginReject?: (reason: Error) => void;
  private currentLoginPromise?: Promise<void>;
  private loginAttempts = 0;
  
  private personaRotationTimer?: ReturnType<typeof setInterval>;
  private currentPersonaIndex = 0;
  
  private currentPersonaState: number = EPersonaState.Online;

  constructor(steamConfig: SteamConfig, idlerSettings: IdlerSettings, loginRetrySettings: LoginRetrySettings) {
    this.config = steamConfig;
    this.idlerSettings = idlerSettings;
    this.loginRetrySettings = loginRetrySettings;

    this.client = new SteamUser({
      autoRelogin: true,
      promptSteamGuardCode: false,
      ...(this.idlerSettings.proxy ? { proxy: this.idlerSettings.proxy } : {}),
    });

    this.setupEventHandlers();
  }

  private setupEventHandlers(): void {
    
    this.client.on('error', (err: Error & { eresult?: number }) => {
      const eresult = err.eresult;
      if (eresult !== undefined) {
        const description = getErrorDescription(eresult);
        const errorName = EResult[eresult] ?? `Unknown (${eresult})`;

        if (isRateLimitError(eresult)) {
          if (!log.isPretty()) {
            log.error('Rate limit / throttle detected', {
              eresult: errorName,
              description,
              accountName: this.config.accountName,
            });
          }
        } else if (isAuthError(eresult)) {
          if (!log.isPretty()) {
            log.error('Authentication failed', {
              eresult: errorName,
              description,
              accountName: this.config.accountName,
            });
          }
        } else {
          if (!log.isPretty()) {
            log.error('Steam login error', {
              eresult: errorName,
              description,
              message: err.message,
            });
          }
        }

        
        if (this.loginReject) {
          const enhancedError = new Error(description);
          (enhancedError as any).eresult = eresult;
          this.loginReject(enhancedError);
          this.loginResolve = undefined;
          this.loginReject = undefined;
        }
      } else {
        if (!log.isPretty()) {
          log.error('Steam client error', { error: err.message });
        }
      }
    });

    this.client.on('debug', (msg: string) => {
      log.debug(msg);
    });

    this.client.on('loggedOn', async (details: LoggedOnDetails) => {
      if (!log.isPretty()) {
        log.info('Logged on to Steam', { steamID: details.steamID?.toString() });
      }
      this.reconnectAttempts = 0;
      
      

      
      if (this.idlerSettings.autoRequestFreeLicenses) {
        await this.requestFreeLicensesForIdleGames();
      }

      
      if (this.loginResolve) {
        this.loginResolve();
        this.loginResolve = undefined;
        this.loginReject = undefined;
      }
    });

    this.client.on('disconnected', (eresult: number, msg: string) => {
      if (!log.isPretty()) {
        log.warn('Disconnected from Steam', { eresult, msg });
      }
      log.printConnectionStatus(false);
      this.stopHeartbeat();
      this.handleReconnect();
    });

    this.client.on('steamGuard', (domain: string, callback: (code: string) => void) => {
      if (this.config.twoFactorSecret) {
        const code = getAuthCode(this.config.twoFactorSecret);
        log.debug('Generated 2FA code from shared secret', { domain });
        callback(code);
      } else {
        if (!log.isPretty()) {
          log.warn('Steam Guard required but no 2FA secret configured', { domain });
        }
        callback('');
      }
    });

    
    this.client.on('refreshToken', (token: string) => {
      if (!log.isPretty()) {
        log.info('Received new refresh token');
      }
      
    });

    
    if (this.idlerSettings.afkMessage) {
      this.client.chat.on('friendMessage', (message: any) => {
        
        const isAway = this.currentPersonaState === EPersonaState.Away || this.currentPersonaState === EPersonaState.Snooze;

        if (isAway && message.chat_entry_type === 1 && !message.local_echo) {
          
          const friendId = message.steamid_friend;
          const msgText = message.message_no_bbcode || message.message;

          if (!log.isPretty()) {
            log.info('AFK auto-reply triggered', { friendId: friendId.toString(), message: msgText });
          }

          
          const afkMsg = this.idlerSettings.afkMessage;
          if (afkMsg) {
            this.client.chat.sendFriendMessage(friendId, afkMsg).catch((err) => {
              if (!log.isPretty()) {
                log.warn('Failed to send AFK auto-reply', { error: err.message, friendId: friendId.toString() });
              }
            });
          }
        }
      });
    }
  }

  private setPersonaOnline(): void {
    const state = EPersonaState.Online;
    this.client.setPersona(state);
    if (!log.isPretty()) {
      log.debug('Persona set', { state: EPersonaState[state] ?? state });
    }
  }

  private startPersonaRotation(rotationConfig: PersonaRotationConfig): void {
    if (!rotationConfig.enabled || rotationConfig.states.length === 0) return;

    this.stopPersonaRotation();

    
    const initialState = rotationConfig.states[0] as number;
    this.client.setPersona(initialState);
    this.currentPersonaState = initialState;
    this.currentPersonaIndex = 0;
    if (!log.isPretty()) {
      log.debug('Persona rotation started', { initialState: EPersonaState[initialState] ?? initialState });
    }

    const intervalMs = rotationConfig.intervalHours * 60 * 60 * 1000;
    this.personaRotationTimer = setInterval(() => {
      this.currentPersonaIndex = (this.currentPersonaIndex + 1) % rotationConfig.states.length;
      const nextState = rotationConfig.states[this.currentPersonaIndex] as number;
      this.client.setPersona(nextState);
      this.currentPersonaState = nextState;
      if (!log.isPretty()) {
        log.debug('Persona rotated', { state: EPersonaState[nextState] ?? nextState, index: this.currentPersonaIndex });
      }
    }, intervalMs);
    this.personaRotationTimer.unref();
  }

  private stopPersonaRotation(): void {
    if (this.personaRotationTimer) {
      clearInterval(this.personaRotationTimer);
      this.personaRotationTimer = undefined;
      this.currentPersonaIndex = 0;
    }
  }

  /** Switch persona for a specific batch (called when batch changes) */
  setPersonaForBatch(batchPersonaState?: PersonaState, rotationConfig?: PersonaRotationConfig): void {
    
    this.stopPersonaRotation();

    
    if (batchPersonaState !== undefined) {
      this.client.setPersona(batchPersonaState as number);
      this.currentPersonaState = batchPersonaState as number;
      if (!log.isPretty()) {
        log.debug('Persona set for batch', { state: EPersonaState[batchPersonaState] ?? batchPersonaState });
      }
      return;
    }

    
    if (rotationConfig?.enabled && rotationConfig.states.length > 0) {
      this.startPersonaRotation(rotationConfig);
    } else {
      const state = EPersonaState.Online;
      this.client.setPersona(state);
      this.currentPersonaState = state;
      if (!log.isPretty()) {
        log.debug('Persona set (default)', { state: EPersonaState[state] ?? state });
      }
    }
  }

  private startIdling(appIds: number[]): void {
    if (!log.isPretty()) {
      log.info('Starting to idle games', { appIds });
    }
    this.client.gamesPlayed(appIds, true);
  }

  private startHeartbeat(appIds: number[]): void {
    this.stopHeartbeat();
    this.heartbeatTimer = setInterval(() => {
      if (!log.isPretty()) {
        log.debug('Heartbeat: re-sending gamesPlayed');
      }
      this.client.gamesPlayed(appIds, true);
    }, this.idlerSettings.heartbeatInterval * 1000);
    this.heartbeatTimer.unref();
  }

  private stopHeartbeat(): void {
    if (this.heartbeatTimer) {
      clearInterval(this.heartbeatTimer);
      this.heartbeatTimer = undefined;
    }
  }

  private handleReconnect(): void {
    if (!this.idlerSettings.autoReconnect) {
      if (!log.isPretty()) {
        log.info('Auto-reconnect disabled, stopping');
      }
      return;
    }

    if (this.idlerSettings.maxReconnectAttempts > 0 &&
        this.reconnectAttempts >= this.idlerSettings.maxReconnectAttempts) {
      if (!log.isPretty()) {
        log.error('Max reconnection attempts reached, giving up');
      }
      return;
    }

    this.reconnectAttempts++;
    if (!log.isPretty()) {
      log.info('Scheduling reconnect', {
        attempt: this.reconnectAttempts,
        delayMs: this.idlerSettings.reconnectDelay,
      });
    }

    setTimeout(() => {
      log.printConnectionStatus(true);
      this.login().catch((err) => {
        if (!log.isPretty()) {
          log.error('Reconnect login failed', { error: err.message });
        }
      });
    }, this.idlerSettings.reconnectDelay);
  }

  /**
   * Request free licenses for all currently idle F2P games
   * Uses steam-user's requestFreeLicense method with PICS cache
   */
  private async requestFreeLicensesForIdleGames(): Promise<void> {
    if (!log.isPretty()) {
      log.info('Checking for F2P licenses to request...');
    }

    try {
      
      this.client.setOption('enablePicsCache', true);

      
      const currentGames = this.getCurrentGames();
      if (currentGames.length === 0) {
        if (!log.isPretty()) {
          log.debug('No games currently idling, skipping free license request');
        }
        return;
      }

      if (!log.isPretty()) {
        log.info('Requesting free licenses for idle games', { appIds: currentGames });
      }

      
      
      const result = await this.client.requestFreeLicense(currentGames);

      if (result.grantedAppIds.length > 0 || result.grantedPackageIds.length > 0) {
        if (!log.isPretty()) {
          log.info('Free licenses granted', {
            grantedAppIds: result.grantedAppIds,
            grantedPackageIds: result.grantedPackageIds,
          });
        } else {
          log.success(`F2P licenses granted: ${result.grantedAppIds.length} apps, ${result.grantedPackageIds.length} packages`);
        }
      } else {
        if (!log.isPretty()) {
          log.debug('No new free licenses granted (already owned or not F2P)');
        }
      }
    } catch (err) {
      
      if (!log.isPretty()) {
        log.warn('Failed to request free licenses', { error: err instanceof Error ? err.message : String(err) });
      } else {
        log.warnMsg(`F2P license request failed: ${err instanceof Error ? err.message : String(err)}`);
      }
    }
  }

  /**
   * Get currently idling games from steam-user
   * This reads the internal _playingAppIds property
   */
  private getCurrentGames(): number[] {
    
    const client = this.client as any;
    return client._playingAppIds ?? [];
  }

  private async loginWithQR(): Promise<void> {
    if (!log.isPretty()) {
      log.info('Starting QR code login via steam-session');
    }

    this.loginSession = new LoginSession(EAuthTokenPlatformType.SteamClient);
    this.loginSession.loginTimeout = 120000;

    this.loginSession.on('polling', () => {
      if (!log.isPretty()) {
        log.info('Waiting for QR code scan on Steam mobile app...');
      }
    });

    this.loginSession.on('remoteInteraction', () => {
      if (!log.isPretty()) {
        log.info('QR code scanned, waiting for confirmation...');
      }
    });

    this.loginSession.on('debug', (msg: string, ...args: unknown[]) => {
      log.debug(msg, args.length > 0 ? { args } : undefined);
    });

    this.loginSession.on('debug-handler', (msg: string, ...args: unknown[]) => {
      log.debug('[handler] ' + msg, args.length > 0 ? { args } : undefined);
    });

    this.loginSession.on('polling', () => {
      if (!log.isPretty()) {
        log.info('Polling for QR login confirmation...');
      }
    });

    try {
      const result = await this.loginSession.startWithQR();

      if (result.qrChallengeUrl) {
        if (!log.isPretty()) {
          log.info('QR code generated - scan with Steam mobile app');
        }
        console.log('\n=== SCAN QR CODE WITH STEAM MOBILE APP ===');
        qrcode.generate(result.qrChallengeUrl, { small: false });
        console.log(result.qrChallengeUrl);
        console.log('==========================================\n');
      }

      await new Promise<void>((resolve, reject) => {
        this.loginSession!.once('authenticated', () => resolve());
        this.loginSession!.once('error', (err: Error) => reject(err));
        this.loginSession!.once('timeout', () => reject(new Error('QR login timeout')));
      });

      const refreshToken = this.loginSession.refreshToken;
      if (!refreshToken) {
        throw new Error('No refresh token received after QR login');
      }

      if (!log.isPretty()) {
        log.info('QR login successful, logging in with refresh token');
      }
      
      this.client.logOn({
        refreshToken,
        rememberPassword: true,
      } as any);

    } catch (err) {
      log.error('QR login failed', { error: err instanceof Error ? err.message : String(err) });
      throw err;
    }
  }

  /**
   * Calculate exponential backoff delay with jitter
   * @param attempt - Current attempt number (0-based)
   * @param isRateLimit - Whether this is a rate limit error (uses longer delay)
   * @returns Delay in milliseconds
   */
  private calculateBackoffDelay(attempt: number, isRateLimit: boolean): number {
    const baseDelay = this.loginRetrySettings.baseDelay;
    const maxDelay = this.loginRetrySettings.maxDelay;
    const rateLimitMultiplier = this.loginRetrySettings.rateLimitMultiplier;

    
    let delay = baseDelay * Math.pow(2, attempt);

    
    if (isRateLimit) {
      delay *= rateLimitMultiplier;
    }

    
    const jitter = delay * 0.25 * (Math.random() * 2 - 1);
    delay += jitter;

    
    return Math.min(Math.max(delay, baseDelay), maxDelay);
  }

  /**
   * Login to Steam with exponential backoff retry
   * Returns a Promise that resolves on successful login or rejects on failure
   */
  async login(): Promise<void> {
    
    if (this.client.steamID !== null) {
      if (!log.isPretty()) {
        log.debug('Already logged in');
      }
      return;
    }

    
    if (this.currentLoginPromise) {
      return this.currentLoginPromise;
    }

    const maxRetries = this.loginRetrySettings.maxRetries;

    this.currentLoginPromise = this.attemptLoginWithRetry(maxRetries);

    try {
      await this.currentLoginPromise;
    } finally {
      this.currentLoginPromise = undefined;
      this.loginResolve = undefined;
      this.loginReject = undefined;
      this.loginAttempts = 0;
    }
  }

  /**
   * Attempt login with retry logic
   */
  private async attemptLoginWithRetry(maxRetries: number): Promise<void> {
    this.loginAttempts = 0;

    while (true) {
      try {
        await this.performLoginAttempt();
        return;
      } catch (err: any) {
        const eresult = err.eresult;
        const isRateLimit = eresult !== undefined && isRateLimitError(eresult);
        const isAuthFailure = eresult !== undefined && isAuthError(eresult);

        
        if (isAuthFailure) {
          if (!log.isPretty()) {
            log.error('Auth failure, not retrying', {
              eresult: EResult[eresult] ?? `Unknown (${eresult})`,
              attempt: this.loginAttempts + 1,
            });
          } else {
            log.failure('Login failed: ' + (err.message || 'Authentication error'));
          }
          throw err;
        }

        this.loginAttempts++;

        
        if (this.loginAttempts > maxRetries) {
          if (!log.isPretty()) {
            log.error('Max login retries exceeded', {
              maxRetries,
              lastError: err.message,
              eresult: eresult !== undefined ? EResult[eresult] : 'unknown',
            });
          } else {
            log.failure(`Max login retries (${maxRetries}) exceeded`);
          }
          throw err;
        }

        
        const delay = this.calculateBackoffDelay(this.loginAttempts - 1, isRateLimit);

        if (!log.isPretty()) {
          log.warn('Login failed, scheduling retry', {
            attempt: this.loginAttempts,
            maxRetries,
            delayMs: Math.round(delay),
            isRateLimit,
            error: err.message,
            eresult: eresult !== undefined ? EResult[eresult] : 'unknown',
          });
        } else {
          log.printLoginRetry(this.loginAttempts, maxRetries, delay, isRateLimit);
        }

        
        await new Promise(resolve => setTimeout(resolve, delay));
      }
    }
  }

  /**
   * Perform a single login attempt
   * Returns a Promise that resolves on success or rejects on failure
   */
  private performLoginAttempt(): Promise<void> {
    return new Promise<void>((resolve, reject) => {
      this.loginResolve = resolve;
      this.loginReject = reject;

      if (!log.isPretty()) {
        log.info('Logging in to Steam', {
          accountName: this.config.accountName,
          method: this.config.loginMethod ?? 'credentials',
          attempt: this.loginAttempts + 1,
        });
      } else {
        log.infoMsg(`Logging in to Steam (attempt ${this.loginAttempts + 1}/${this.loginRetrySettings.maxRetries})...`);
      }

      if (this.config.loginMethod === 'qr') {
        this.loginWithQR()
          .then(resolve)
          .catch(reject);
        return;
      }

      const twoFactorCode = this.config.twoFactorSecret
        ? getAuthCode(this.config.twoFactorSecret)
        : undefined;

      this.client.logOn({
        accountName: this.config.accountName,
        password: this.config.password,
        twoFactorCode,
        rememberPassword: true,
      });
    });
  }

  logOff(): void {
    if (!log.isPretty()) {
      log.info('Logging off from Steam');
    }
    this.stopHeartbeat();
    this.client.logOff();
    if (this.loginSession) {
      this.loginSession.cancelLoginAttempt();
    }
  }

  getClient(): SteamUserType {
    return this.client;
  }

  isLoggedOn(): boolean {
    return this.client.steamID !== null;
  }
}
