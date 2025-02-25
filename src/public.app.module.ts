import { Module } from '@nestjs/common';
import { AbiModule } from './features/abi/abi.module';
import { AzureKeyVaultModule } from './common/azure-keyvault/azure-key-vault.module';

@Module({
  imports: [AzureKeyVaultModule, AbiModule],
  exports: [],
  controllers: [],
  providers: [],
})
export class PublicAppModule {}
