import { ApiProperty } from '@nestjs/swagger';
import { Expose } from 'class-transformer';
import { SmartContractDoc } from './contract-details.dto';

export class ContractLibraryResponseDto extends SmartContractDoc {
  @ApiProperty()
  @Expose()
  name: string;

  @ApiProperty()
  @Expose()
  description: string;

  @ApiProperty()
  @Expose()
  address: string;

  @ApiProperty()
  @Expose()
  ownerAddress: string;
}
