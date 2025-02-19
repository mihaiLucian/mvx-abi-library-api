import { AbiDefinition } from '../types/abi.types';
import { AbiSwaggerGenerator } from './abi-swagger-generator';
import { AbiWarpGenerator } from './abi-warp-generator';

export class AbiParser {
  private readonly abi: AbiDefinition;
  private readonly swaggerGenerator: AbiSwaggerGenerator;
  private readonly warpGenerator: AbiWarpGenerator;
  constructor(abiJson: AbiDefinition) {
    this.abi = abiJson;
    this.swaggerGenerator = new AbiSwaggerGenerator(this.abi);
    this.warpGenerator = new AbiWarpGenerator(undefined, this.abi);
  }

  public generateSwaggerJson() {
    return this.swaggerGenerator.generateSwaggerJson();
  }

  public generateWarps(contractAddress: string) {
    return this.warpGenerator.generateWarps(contractAddress);
  }
}
