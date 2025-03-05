import { Module } from '@nestjs/common';
import { AbiController } from './abi.controller';
import { AbiService } from './abi.service';
import { CosmosDbModule } from 'src/common/cosmos-db/cosmos-db.module';
import { GoogleAiModule } from 'src/common/google-ai/google-ai.module';
import { CosmosDbContainer } from 'src/common/cosmos-db/entities/cosmos-db-container.enum';
import { HttpModule } from 'src/common/http/http.module';
import { AzureSearchModule } from 'src/common/azure-search/azure-search.module';
import { AzureOpenaiModule } from 'src/common/azure-openai/azure-openai.module';

@Module({
  imports: [
    CosmosDbModule.forRoot(CosmosDbContainer.ABI_DATA),
    GoogleAiModule,
    HttpModule,
    AzureSearchModule,
    AzureOpenaiModule,
  ],
  exports: [AbiService],
  controllers: [AbiController],
  providers: [AbiService],
})
export class AbiModule {}
