import { Module, DynamicModule } from '@nestjs/common';
import {
  HttpModule as NestHttpModule,
  HttpService as NestHttpService,
} from '@nestjs/axios';
import { HttpService } from './http.service';
import { HttpServiceConfig } from './http.types';

@Module({
  imports: [NestHttpModule],
  providers: [
    {
      provide: HttpService,
      useFactory: (nestHttpService: NestHttpService) =>
        new HttpService(nestHttpService, {}),
      inject: [NestHttpService],
    },
  ],
  exports: [HttpService],
})
export class HttpModule {
  static forRoot(config: HttpServiceConfig = {}): DynamicModule {
    return {
      module: HttpModule,
      imports: [NestHttpModule],
      providers: [
        {
          provide: HttpService,
          useFactory: (nestHttpService: NestHttpService) =>
            new HttpService(nestHttpService, config),
          inject: [NestHttpService],
        },
      ],
      exports: [HttpService],
    };
  }
}
