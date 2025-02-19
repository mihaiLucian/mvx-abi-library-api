import {
  Warp,
  WarpActionInput,
  WarpActionType,
  WarpInputPosition,
  WarpMeta,
} from '../dtos/warp.dto';
import {
  AbiBaseType,
  AbiDefinition,
  AbiEndpoint,
  AbiInput,
} from '../types/abi.types';
import { GenericUtils } from 'src/common/utils/generic.utils';

const WARP_PROTOCOL_VERSION = 'warp:0.4.0';
const DEFAULT_GAS_LIMIT = 60000000;
const WARP_TYPE_MAPPINGS: Record<string, string> = {
  Address: 'address',
  BigUint: 'biguint',
  u8: 'uint8',
  i8: 'int8',
  u16: 'uint16',
  u32: 'uint32',
  u64: 'uint64',
  bool: 'bool',
  bytes: 'string',
  TokenIdentifier: 'token',
  EgldOrEsdtTokenIdentifier: 'token',
};

export class AbiWarpGenerator {
  private abi: AbiDefinition;
  private readonly meta: WarpMeta;

  constructor(creator: string = 'system', abi: AbiDefinition) {
    this.abi = abi;
    this.meta = {
      hash: '',
      creator,
      createdAt: new Date().toISOString(),
    };
  }

  public generateWarps(contractAddress: string): Warp[] {
    const publicEndpoints = this.abi.endpoints.filter(
      (endpoint) => !endpoint.onlyOwner,
    );
    return publicEndpoints.map((endpoint) =>
      this.transformEndpoint(contractAddress, this.abi.name, endpoint),
    );
  }

  private transformEndpoint(
    contractAddress: string,
    contractName: string,
    endpoint: AbiEndpoint,
  ): Warp {
    if (!endpoint?.name) {
      throw new Error('Endpoint name is required');
    }

    const actionType: WarpActionType =
      endpoint.mutability === 'readonly'
        ? WarpActionType.Query
        : WarpActionType.Contract;

    // Separate payment inputs from regular inputs
    const paymentInputs = this.createPaymentInputs(endpoint.payableInTokens);
    const regularInputs = this.transformInputs(endpoint.inputs);

    // Prepare the action object
    const action: any = {
      type: actionType,
      label: endpoint.name,
      address: contractAddress,
      func: endpoint.name,
      args: [],
      description: endpoint.docs?.join('\n') ?? null,
      inputs: [...paymentInputs, ...regularInputs],
      gasLimit:
        actionType === WarpActionType.Contract ? DEFAULT_GAS_LIMIT : undefined,
    };

    let description: string;
    if (endpoint?.docs?.length) {
      description = endpoint.docs.join('\n');
    } else {
      if (actionType === WarpActionType.Query) {
        description = `Query ${endpoint.name} operation`;
      } else {
        description = `Executes ${endpoint.name} operation`;
      }
    }

    return {
      protocol: WARP_PROTOCOL_VERSION,
      name: `${contractName}:${endpoint.name}`,
      title: `${GenericUtils.capitalizeFirstLetter(endpoint.name)} operation`,
      description,
      preview: `Execute ${endpoint.name} on ${contractName}`,
      actions: [action],
      meta: this.meta,
    };
  }

  private transformInputs(inputs: AbiInput[] = []): WarpActionInput[] {
    if (!Array.isArray(inputs)) {
      return [];
    }

    return inputs.map((input, index) => {
      if (!input?.name || !input?.type) {
        throw new Error(`Invalid input at index ${index}`);
      }

      const position = `arg:${index + 1}` as WarpInputPosition;

      return {
        name: input.name,
        type: this.convertType(input.type),
        position,
        source: 'field',
        required: !input.type.startsWith('optional<'),
        description: `Input parameter for ${input.name}`,
        bot: `Smart contract ${input.name} parameter of type ${input.type}`,
        ...this.getInputValidations(input),
      };
    });
  }

  private createPaymentInputs(payableTokens?: string[]): WarpActionInput[] {
    if (!payableTokens?.length) {
      return [];
    }

    if (payableTokens.includes('*')) {
      return [this.createEsdtInput(), this.createEgldInput(false)];
    }

    const inputs: WarpActionInput[] = [];
    const acceptedTokens = payableTokens.filter((token) => token !== 'EGLD');

    if (payableTokens.includes('EGLD')) {
      inputs.push(this.createEgldInput(true));
    }

    if (acceptedTokens.length > 0) {
      inputs.push(this.createEsdtInput(acceptedTokens));
    }

    return inputs;
  }

  private createEgldInput(required: boolean): WarpActionInput {
    return {
      name: 'EGLD Amount',
      type: 'biguint',
      position: 'value',
      source: 'field',
      required,
      description: `Amount of EGLD to send${required ? '' : ' (optional)'}`,
      min: 0,
      modifier: 'scale:18',
    };
  }

  private createEsdtInput(acceptedTokens?: string[]): WarpActionInput {
    return {
      name: 'Token Amount',
      type: 'esdt',
      position: 'transfer',
      source: 'field',
      required: false,
      description: acceptedTokens
        ? `Amount of tokens to send (${acceptedTokens.join(' or ')})`
        : 'Amount and type of tokens to send (optional)',
      options: acceptedTokens,
    };
  }

  convertType(abiType: string): string {
    if (!abiType) {
      throw new Error('ABI type is required');
    }

    const nestedTypesMapping = {
      'Option<': 'option:',
      'optional<': 'optional:',
      'List<': 'list:',
      'variadic<': 'variadic:',
    };

    // Check for nested types using defined patterns
    for (const pattern in nestedTypesMapping) {
      if (abiType.startsWith(pattern)) {
        const endBracket = abiType.indexOf('>');
        if (endBracket === -1) {
          throw new Error(`Invalid format: missing closing ">" in ${abiType}`);
        }
        // Extract inner type between the pattern and the closing ">"
        const innerType = abiType.slice(pattern.length, endBracket).trim();
        // Recursively convert the inner type
        const convertedInner = this.convertType(innerType);
        // Append any default or additional suffix if available (if your format supports it)
        const suffix = abiType.slice(endBracket + 1);
        return `${nestedTypesMapping[pattern]}${convertedInner}${suffix}`;
      }
    }

    // Fallback: a base type (using TYPE_MAPPINGS)
    const mapped = WARP_TYPE_MAPPINGS[abiType];

    // if (!mapped) {
    //   throw new Error(`Type mapping not found for ABI type: ${abiType}`);
    // }

    return mapped;
    // throw new Error(`Type mapping not found for ABI type: ${abiType}`);
  }

  private getInputValidations(input: AbiInput): Partial<WarpActionInput> {
    const validations: Partial<WarpActionInput> = {};

    if (!input?.type) {
      return validations;
    }

    switch (true) {
      case input.type.includes(AbiBaseType.BigUint):
        Object.assign(validations, {
          min: 0,
          modifier: input.type === AbiBaseType.BigUint ? 'scale:18' : undefined,
        });
        break;

      case input.type.includes(AbiBaseType.Address):
        Object.assign(validations, {
          pattern: '^erd1[a-zA-Z0-9]{58}$',
          patternDescription: 'Must be a valid MultiversX address',
        });
        break;

      case input.type.includes(AbiBaseType.TokenIdentifier):
      case input.type.includes(AbiBaseType.EgldOrEsdtTokenIdentifier):
        Object.assign(validations, {
          pattern: '^(EGLD|[A-Z0-9]{3,10}(-[a-fA-F0-9]{6})?)$',
          patternDescription: 'Must be EGLD or a valid token identifier',
        });
        break;

      case input.type.includes(AbiBaseType.Bool):
        Object.assign(validations, {
          type: 'boolean',
        });
        break;
    }

    return validations;
  }
}
