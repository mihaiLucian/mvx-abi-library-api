import { ApiProperty, PickType } from '@nestjs/swagger';
import { AbiDefinition } from '../types/abi.types';

export class SmartContractDoc {
  @ApiProperty({
    description: 'Type of the data',
    example: 'sc-info',
  })
  dataType: string;

  @ApiProperty({
    description: 'Smart contract address',
    example: 'erd1qqqqqqqqqqqqqpgqf6gmx6eu01356m0rq0g6dye3etu6u4nw2jpspmkqzf',
  })
  address: string;

  @ApiProperty({
    description: 'Title of the smart contract',
    example: 'My Contract',
  })
  name: string;

  @ApiProperty({
    description: 'Generic description of the smart contract',
    example:
      'This smart contract serves generic functions in the decentralized ecosystem.',
  })
  description: string;

  @ApiProperty({
    description: 'Owner address of the smart contract',
    example: 'erd1qqqqqqqqqqqqqpgqf6gmx6eu0pm1350rq0g6dye3etu6u4nw2jpspmkqzf',
  })
  ownerAddress: string;

  @ApiProperty({
    description: 'ABI JSON configuration',
    type: AbiDefinition,
  })
  abiJson: AbiDefinition;

  @ApiProperty({
    description: 'Code hash of the smart contract',
    example: 'ac69acefa1024403b0d9efb19befbac55b107f75bbebbac11b800735a634a9a2',
  })
  codeHash: string;

  @ApiProperty({
    description: 'Unique identifier of the smart contract',
    example:
      'sc_erd1qqqqqqqqqqqqqpgqf6gmx6eu0pm26m1350g6dye3etu6u4nw2jpspmkqzf',
  })
  id: string;

  @ApiProperty({
    description: 'Tags associated with the smart contract',
    type: Array,
    example: ['Staking', 'Marketplace', 'NFT'],
  })
  tags: string[];

  pk?: string;
}

export class SmartContractLibraryDto extends PickType(SmartContractDoc, [
  'address',
  'name',
  'description',
  'ownerAddress',
]) {}
