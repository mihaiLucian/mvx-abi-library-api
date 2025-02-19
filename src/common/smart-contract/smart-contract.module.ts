import { Module } from '@nestjs/common';
import { HttpModule } from '@nestjs/axios';
import { SmartContractService } from './smart-contract.service';

@Module({
  imports: [HttpModule],
  providers: [SmartContractService],
  exports: [SmartContractService],
})
export class SmartContractModule {}
