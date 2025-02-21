import { Injectable, Logger } from '@nestjs/common';
import { SecretClient } from '@azure/keyvault-secrets';
import { DefaultAzureCredential } from '@azure/identity';

const REQUIRED_SECRETS = {
  AZURE_OPEN_AI_KEY: 'azure-open-ai-key',
  GOOGLE_AI_KEY: 'google-ai-key',
  AZURE_SEARCH_KEY: 'azure-search-key',
  COSMOS_DB_SECRET: 'cosmos-db-secret',
} as const;

@Injectable()
export class AzureKeyVaultService {
  private readonly logger = new Logger(AzureKeyVaultService.name);
  private client: SecretClient;
  private initializationPromise: Promise<void> | null = null;

  constructor() {}

  async initialize(): Promise<void> {
    if (this.initializationPromise) {
      return this.initializationPromise;
    }

    this.initializationPromise = (async () => {
      try {
        const vaultUrl = process.env.AZURE_KEY_VAULT_ENDPOINT;
        if (!vaultUrl) {
          throw new Error('Azure Key Vault Endpoint is not configured');
        }

        const credential = new DefaultAzureCredential();
        this.client = new SecretClient(vaultUrl, credential);
        this.logger.log('Azure Key Vault client initialized successfully');
      } catch (error) {
        this.logger.error('Failed to initialize Azure Key Vault client', error);
        this.initializationPromise = null;
        throw error;
      }
    })();

    return this.initializationPromise;
  }

  private ensureInitialized(): void {
    if (!this.client) {
      throw new Error(
        'Azure Key Vault service is not initialized. Call initialize() first',
      );
    }
  }

  async getSecret(secretName: string): Promise<string | null> {
    this.ensureInitialized();
    try {
      const result = await this.client.getSecret(secretName);
      return result.value || null;
    } catch (error) {
      this.logger.error(`Failed to get secret: ${secretName}`, error);
      throw error;
    }
  }

  async setSecret(secretName: string, value: string): Promise<void> {
    try {
      await this.client.setSecret(secretName, value);
      this.logger.debug(`Secret ${secretName} set successfully`);
    } catch (error) {
      this.logger.error(`Failed to set secret: ${secretName}`, error);
      throw error;
    }
  }

  async deleteSecret(secretName: string): Promise<void> {
    try {
      await this.client.beginDeleteSecret(secretName);
      this.logger.debug(`Secret ${secretName} deletion initiated`);
    } catch (error) {
      this.logger.error(`Failed to delete secret: ${secretName}`, error);
      throw error;
    }
  }

  async loadAndSetRequiredSecrets(): Promise<void> {
    await this.initialize();

    try {
      const secretPromises = Object.entries(REQUIRED_SECRETS).map(
        async ([envKey, secretName]) => {
          const secretValue = await this.getSecret(secretName);
          if (!secretValue) {
            throw new Error(
              `Required secret ${secretName} not found in Key Vault`,
            );
          }
          process.env[envKey] = secretValue;
          return envKey;
        },
      );

      const loadedSecrets = await Promise.all(secretPromises);
      this.logger.log(
        `Successfully loaded secrets: ${loadedSecrets.join(', ')}`,
      );
    } catch (error) {
      this.logger.error(
        'Failed to load required secrets from Key Vault',
        error,
      );
      throw error;
    }
  }
}
