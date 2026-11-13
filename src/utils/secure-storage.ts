import keytar from 'keytar';
import { logger } from '../logger.js';

const log = logger.child({ component: 'SecureStorage' });

const SERVICE_NAME = 'steam-nganggur';
const ACCOUNT_PREFIX = 'steam-account';

export interface StoredCredentials {
  accountName: string;
  refreshToken: string;
  updatedAt: string;
}

export interface SecureStorageOptions {
  serviceName?: string;
  accountPrefix?: string;
}

export class SecureStorage {
  private serviceName: string;
  private accountPrefix: string;

  constructor(options: SecureStorageOptions = {}) {
    this.serviceName = options.serviceName ?? SERVICE_NAME;
    this.accountPrefix = options.accountPrefix ?? ACCOUNT_PREFIX;
  }

  private getAccountKey(accountName: string): string {
    return `${this.accountPrefix}-${accountName}`;
  }

  /**
   * Store refresh token for an account
   */
  async setRefreshToken(accountName: string, refreshToken: string): Promise<void> {
    const accountKey = this.getAccountKey(accountName);
    const data: StoredCredentials = {
      accountName,
      refreshToken,
      updatedAt: new Date().toISOString(),
    };

    try {
      await keytar.setPassword(this.serviceName, accountKey, JSON.stringify(data));
      log.debug('Refresh token stored securely', { accountName });
    } catch (err) {
      log.error('Failed to store refresh token', { accountName, error: err instanceof Error ? err.message : String(err) });
      throw new Error(`Secure storage write failed: ${err instanceof Error ? err.message : String(err)}`);
    }
  }

  /**
   * Retrieve refresh token for an account
   */
  async getRefreshToken(accountName: string): Promise<string | null> {
    const accountKey = this.getAccountKey(accountName);

    try {
      const stored = await keytar.getPassword(this.serviceName, accountKey);
      if (!stored) {
        log.debug('No refresh token found', { accountName });
        return null;
      }

      const data = JSON.parse(stored) as StoredCredentials;
      log.debug('Refresh token retrieved', { accountName, updatedAt: data.updatedAt });
      return data.refreshToken;
    } catch (err) {
      log.error('Failed to retrieve refresh token', { accountName, error: err instanceof Error ? err.message : String(err) });
      return null;
    }
  }

  /**
   * Delete stored credentials for an account
   */
  async deleteCredentials(accountName: string): Promise<boolean> {
    const accountKey = this.getAccountKey(accountName);

    try {
      const result = await keytar.deletePassword(this.serviceName, accountKey);
      log.debug('Credentials deleted', { accountName, deleted: result });
      return result;
    } catch (err) {
      log.error('Failed to delete credentials', { accountName, error: err instanceof Error ? err.message : String(err) });
      return false;
    }
  }

  /**
   * Check if credentials exist for an account
   */
  async hasCredentials(accountName: string): Promise<boolean> {
    const token = await this.getRefreshToken(accountName);
    return token !== null;
  }

  /**
   * List all stored accounts
   */
  async listAccounts(): Promise<string[]> {
    try {
      const credentials = await keytar.findCredentials(this.serviceName);
      const prefix = `${this.accountPrefix}-`;
      return credentials
        .filter((c: any) => c.account.startsWith(prefix))
        .map((c: any) => c.account.slice(prefix.length));
    } catch (err) {
      log.error('Failed to list accounts', { error: err instanceof Error ? err.message : String(err) });
      return [];
    }
  }
}

export const secureStorage = new SecureStorage();
