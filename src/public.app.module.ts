import { Module } from '@nestjs/common';
import { AbiModule } from './modules/abi/abi.module';

@Module({
  imports: [AbiModule],
  exports: [],
  controllers: [],
  providers: [],
})
export class PublicAppModule {}
