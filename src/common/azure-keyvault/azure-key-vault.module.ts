import { Module } from '@nestjs/common';
import { AzureKeyVaultService } from './azure-key-vault.service';

@Module({
  providers: [AzureKeyVaultService],
  exports: [AzureKeyVaultService],
})
export class AzureKeyVaultModule {}
