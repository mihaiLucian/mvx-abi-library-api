import { Body, Controller, Post, UsePipes, Version } from '@nestjs/common';
import { AbiService } from './abi.service';
import { ApiBody, ApiOperation, ApiResponse, ApiTags } from '@nestjs/swagger';
import { Warp } from './dtos/warp.dto';
import { GenerateWarpRequestDto } from './dtos/generate-warp-request.dto';
import { RequestBodyValidationPipe } from 'src/common/pipes/parse-request-body.pipe';

@ApiTags('ABI Utilities')
@Controller('abi')
export class AbiController {
  constructor(private readonly abiService: AbiService) {}

  @Version('beta')
  @ApiOperation({ summary: 'Generate warp based on the provided ABI' })
  @ApiResponse({
    status: 201,
    description: 'Warp generated successfully',
    type: Warp,
  })
  @ApiBody({ type: GenerateWarpRequestDto })
  @UsePipes(new RequestBodyValidationPipe(GenerateWarpRequestDto))
  @Post('generateWarps')
  async generateWarps(
    @Body() jsonBody: GenerateWarpRequestDto,
  ): Promise<Warp[]> {
    return await this.abiService.generateWarps(jsonBody);
  }
}
