import { ApiProperty } from '@nestjs/swagger';
import {
  IsNotEmpty,
  IsObject,
  IsOptional,
  IsString,
  Length,
} from 'class-validator';
import { AbiDefinition } from '../types/abi.types';
import { Type } from 'class-transformer';

export class GenerateWarpRequestDto {
  @IsString()
  @IsNotEmpty()
  @ApiProperty({
    type: 'string',
    example: 'erd1qqqqqqqqqqqqqpgqycdpxfm123m3cxylsyff3tkw6yhc6gwga6mqhhv6wn',
  })
  contractAddress: string;

  @IsObject()
  @IsNotEmpty()
  @Type(() => AbiDefinition)
  @ApiProperty({
    type: AbiDefinition,
    description: 'The ABI JSON for the contract',
  })
  abiJson: AbiDefinition;

  @IsOptional()
  @IsString()
  @Length(3, 50)
  @ApiProperty({
    type: 'string',
    example: 'userX',
  })
  creator?: string;
}
