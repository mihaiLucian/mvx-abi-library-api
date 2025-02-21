import { CosmosClient } from '@azure/cosmos';
import { DynamicModule, FactoryProvider, Global, Module } from '@nestjs/common';
import { CosmosDbService } from './cosmos-db.service';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { CosmosDbDatabase } from './entities/cosmos-db-database.enum';
import { CosmosDbContainer } from './entities/cosmos-db-container.enum';

export const CosmosDbServiceFactory: FactoryProvider<CosmosDbService> = {
  provide: CosmosDbService,
  useFactory: (cosmosClient: CosmosClient, containerId: CosmosDbContainer) => {
    const databaseId = CosmosDbDatabase.MVX_AI_ASSISTANT;
    return new CosmosDbService(cosmosClient, databaseId, containerId);
  },
  inject: [CosmosClient, 'COSMOS_DB_CONTAINER'],
};

@Global()
@Module({
  imports: [ConfigModule],
  providers: [
    {
      provide: CosmosClient,
      useFactory: (configService: ConfigService) => {
        const secretName = 'COSMOS_DB_SECRET';
        const secret = configService.get<string>(secretName);
        if (!secret) {
          throw new Error(
            `[${secretName}] is not defined in the environment variables`,
          );
        }
        return new CosmosClient(secret);
      },
      inject: [ConfigService],
    },
  ],
  exports: [CosmosClient],
})
export class CosmosDbModule {
  static forRoot(container: CosmosDbContainer): DynamicModule {
    return {
      module: CosmosDbModule,
      providers: [
        {
          provide: 'COSMOS_DB_CONTAINER',
          useValue: container,
        },
        CosmosDbServiceFactory,
      ],
      exports: [CosmosDbService],
    };
  }
}
