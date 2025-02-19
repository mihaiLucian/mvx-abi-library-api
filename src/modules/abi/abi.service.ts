import { Injectable } from '@nestjs/common';
import { AbiWarpGenerator } from './helpers/abi-warp-generator';
import { GenerateWarpRequestDto } from './dtos/generate-warp-request.dto';
import { Warp } from './dtos/warp.dto';

@Injectable()
export class AbiService {
  constructor() {}

  async generateWarps(requestBody: GenerateWarpRequestDto): Promise<Warp[]> {
    const warpGenerator = new AbiWarpGenerator(
      requestBody.creator,
      requestBody.abiJson,
    );

    return warpGenerator.generateWarps(requestBody.contractAddress);
  }
}
