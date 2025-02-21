import {
  Body,
  Controller,
  Get,
  Param,
  Post,
  Query,
  UsePipes,
  Version,
} from '@nestjs/common';
import { AbiService } from './abi.service';
import {
  ApiBody,
  ApiOperation,
  ApiParam,
  ApiQuery,
  ApiResponse,
  ApiTags,
} from '@nestjs/swagger';
import { Warp } from './dtos/warp.dto';
import { GenerateWarpRequestDto } from './dtos/generate-warp-request.dto';
import { RequestBodyValidationPipe } from 'src/common/pipes/parse-request-body.pipe';
import {
  SmartContractDoc,
  SmartContractLibraryDto,
} from './dtos/contract-details.dto';
import { ParseAddressPipe } from 'src/common/pipes/parse-address.pipe';

@ApiTags('ABI Utilities')
@Controller('abi')
export class AbiController {
  constructor(private readonly abiService: AbiService) {}

  @Version('beta')
  @ApiOperation({ summary: 'Get library of smart contract ABIs' })
  @ApiResponse({
    status: 200,
    description: 'Library of contracts',
    type: SmartContractLibraryDto,
    isArray: true,
  })
  @Get('library')
  async getLibrary(): Promise<SmartContractLibraryDto[]> {
    return this.abiService.getContracts();
  }

  @Version('beta')
  @ApiOperation({ summary: 'Get smart contract details and ABI by address' })
  @ApiParam({
    name: 'address',
    description: 'Smart contract address',
    type: String,
    required: true,
  })
  @ApiResponse({
    status: 200,
    description: 'Smart contract details',
    type: SmartContractDoc,
  })
  @Get('library/:address')
  async getContractByAddress(
    @Param('address', ParseAddressPipe) address: string,
  ): Promise<SmartContractDoc> {
    return this.abiService.getContractByAddress(address);
  }

  @Version('beta')
  @ApiOperation({
    summary: 'Generate warps for an existing smart contract by address',
  })
  @ApiParam({
    name: 'address',
    description: 'Smart contract address',
    type: String,
    required: true,
  })
  @ApiQuery({
    name: 'creator',
    description: 'Creator of the warp',
    type: String,
    required: false,
    example: 'userX',
  })
  @ApiResponse({
    status: 200,
    description: 'Warps generated from contract ABI',
    type: Warp,
    isArray: true,
  })
  @Get('library/:address/warps')
  async getContractWarps(
    @Param('address', ParseAddressPipe) address: string,
    @Query('creator') creator?: string,
  ): Promise<Warp[]> {
    return this.abiService.generateWarpsForContract(address, creator);
  }

  @Version('beta')
  @ApiOperation({ summary: 'Generate warp based on the custom provided ABI' })
  @ApiResponse({
    status: 201,
    description: 'Warp generated successfully',
    type: Warp,
  })
  @ApiBody({ type: GenerateWarpRequestDto })
  @UsePipes(new RequestBodyValidationPipe(GenerateWarpRequestDto))
  @Post('generateWarps')
  generateWarps(@Body() jsonBody: GenerateWarpRequestDto) {
    return this.abiService.generateWarps(jsonBody);
  }
}
