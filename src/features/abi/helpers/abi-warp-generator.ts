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
import { GenericUtils } from 'src/utils/generic.utils';
import { WARP_CONSTANTS } from '../constants/warp.constants';
import { InvalidInputError, InvalidTypeError } from '../types/errors.types';

/**
 * AbiWarpGenerator class handles the transformation of MultiversX ABI definitions
 * into Warp-compatible format for smart contract interaction.
 */
export class AbiWarpGenerator {
  private readonly abi: AbiDefinition;
  private readonly meta: WarpMeta;

  /**
   * Creates a new instance of AbiWarpGenerator
   * @param creator - The creator identifier for the Warp definitions
   * @param abi - The ABI definition to be transformed
   */
  constructor(creator = 'system', abi: AbiDefinition) {
    this.abi = abi;
    this.meta = {
      hash: '',
      creator,
      createdAt: new Date().toISOString(),
    };
  }

  /**
   * Generates Warp definitions for all public endpoints in the contract
   * @param contractAddress - The address of the smart contract
   * @returns Array of Warp definitions
   */
  public generateWarps(contractAddress: string): Warp[] {
    if (!contractAddress?.startsWith('erd1')) {
      throw new InvalidInputError('Invalid contract address format');
    }

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
        actionType === WarpActionType.Contract
          ? WARP_CONSTANTS.DEFAULT_GAS_LIMIT
          : undefined,
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
      protocol: WARP_CONSTANTS.PROTOCOL_VERSION,
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

  /**
   * Converts ABI types to Warp-compatible types
   * @param abiType - The ABI type to convert
   * @returns The corresponding Warp type
   * @throws {InvalidTypeError} If the type is invalid or cannot be converted
   */
  public convertType(abiType: string): string {
    if (!abiType) {
      throw new InvalidTypeError('ABI type is required');
    }

    try {
      // First check if it's a custom type defined in abi.types
      if (this.abi.types && this.abi.types[abiType]) {
        return this.convertCustomType(abiType);
      }

      const nestedTypesMapping = {
        'Option<': 'option:',
        'optional<': 'optional:',
        'List<': 'list:',
        'variadic<': 'variadic:',
      };

      // Handle nested types recursively
      for (const [pattern, replacement] of Object.entries(nestedTypesMapping)) {
        if (abiType.startsWith(pattern)) {
          // Find matching closing bracket by counting brackets
          let bracketCount = 1;
          let closingIndex = pattern.length;

          while (bracketCount > 0 && closingIndex < abiType.length) {
            if (abiType[closingIndex] === '<') bracketCount++;
            if (abiType[closingIndex] === '>') bracketCount--;
            closingIndex++;
          }

          if (bracketCount !== 0) {
            throw new Error(`Invalid format: unmatched brackets in ${abiType}`);
          }

          // Extract and convert inner type
          const innerType = abiType
            .slice(pattern.length, closingIndex - 1)
            .trim();
          const convertedInner = this.convertType(innerType);

          // Handle any remaining type information after the closing bracket
          const remainder = abiType.slice(closingIndex).trim();

          return `${replacement}${convertedInner}${remainder}`;
        }
      }

      // Handle base types
      return WARP_CONSTANTS.TYPE_MAPPINGS[abiType] || abiType;
    } catch (error) {
      throw new InvalidTypeError(`Type conversion failed: ${error.message}`);
    }
  }

  private convertCustomType(typeName: string): string {
    const customType = this.abi.types[typeName];

    if (!customType) {
      throw new Error(`Type ${typeName} not found in ABI definitions`);
    }

    if (customType.type === 'enum') {
      // For enums, we'll use a simple u64 type with options
      return WARP_CONSTANTS.TYPE_MAPPINGS.u64;
    }

    if (customType.type === 'struct') {
      // For structs, create a composite type
      const fieldTypes = customType.fields.map(
        (field: { type: string; name: any }) => {
          // Recursively convert field types
          const convertedType = this.convertType(field.type);
          return `${field.name}:${convertedType}`;
        },
      );

      return `composite(${fieldTypes.join('|')})`;
    }

    throw new Error(`Unsupported custom type: ${customType.type}`);
  }

  private getInputValidations(input: AbiInput): Partial<WarpActionInput> {
    const validations: Partial<WarpActionInput> = {};

    if (!input?.type) {
      return validations;
    }

    switch (true) {
      case input.type.includes(AbiBaseType.BigUint):
        // TODO: Think of a smarter way to get token decimals for ESDTs
        Object.assign(validations, {
          min: 0,
          modifier: input.type === AbiBaseType.BigUint ? 'scale:18' : undefined,
        });
        break;

      case input.type.includes(AbiBaseType.Address):
        Object.assign(validations, {
          pattern: WARP_CONSTANTS.REGEX_PATTERNS.MULTIVERSX_ADDRESS,
          patternDescription: 'Must be a valid MultiversX address',
        });
        break;

      case input.type.includes(AbiBaseType.TokenIdentifier):
      case input.type.includes(AbiBaseType.EgldOrEsdtTokenIdentifier):
        Object.assign(validations, {
          pattern: WARP_CONSTANTS.REGEX_PATTERNS.TOKEN_IDENTIFIER,
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
