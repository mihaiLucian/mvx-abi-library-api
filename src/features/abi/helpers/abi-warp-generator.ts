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
import { Config } from '@vleap/warps';

/**
 * AbiWarpGenerator class handles the transformation of MultiversX ABI definitions
 * into Warp-compatible format for smart contract interaction.
 */
export class AbiWarpGenerator {
  private readonly abi?: AbiDefinition;
  private readonly meta?: WarpMeta;

  /**
   * Creates a new instance of AbiWarpGenerator
   * @param creator - The creator identifier for the Warp definitions
   * @param abi - The ABI definition to be transformed
   */
  constructor(creator = 'system', abi?: AbiDefinition) {
    this.abi = abi;
    this.meta = {
      hash: '',
      creator,
      createdAt: new Date().toISOString(),
    };
  }

  /**
   * Generates Warp definitions for all public endpoints in the contract
   *
   * This function filters out owner-only endpoints and transforms each public endpoint
   * into a Warp definition that can be used for interaction with the smart contract.
   *
   * @param contractAddress - The address of the smart contract (must start with 'erd1')
   * @returns Array of Warp definitions for all public endpoints
   * @throws {InvalidInputError} If the contract address is invalid or ABI is not provided
   */
  public generateWarps(contractAddress: string): Warp[] {
    if (!contractAddress?.startsWith('erd1')) {
      throw new InvalidInputError('Invalid contract address format');
    }
    if (!this.abi) {
      throw new InvalidInputError('ABI is required');
    }

    const publicEndpoints = this.abi.endpoints.filter(
      (endpoint) => !endpoint.onlyOwner,
    );
    return publicEndpoints.map((endpoint) =>
      this.endpointToWarp(contractAddress, this.abi.name, endpoint),
    );
  }

  /**
   * Transforms a contract endpoint into a Warp definition
   *
   * This method creates a complete Warp definition for a single contract endpoint,
   * including payment handling, input transformation, and action configuration.
   *
   * @param contractAddress - The address of the smart contract
   * @param contractName - The name of the smart contract
   * @param endpoint - The ABI endpoint definition to transform
   * @returns A fully configured Warp definition for the endpoint
   * @throws {Error} If the endpoint name is missing
   */
  public endpointToWarp(
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
    const action = {
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
      protocol: Config.LatestProtocolVersion,
      name: `${GenericUtils.capitalizeFirstLetter(endpoint.name)} on ${contractName}`,
      title: `${GenericUtils.capitalizeFirstLetter(endpoint.name)} operation`,
      description,
      preview: this.generateDefaultIconUrl(endpoint.name),
      actions: [action],
      // TODO: Review if meta is needed for such cases
      meta: this.meta,
    };
  }

  /**
   * Generates a default icon URL for contracts without a custom icon
   *
   * @param name - The contract address to use for generation
   * @returns A URL to a generic or generated icon
   */
  private generateDefaultIconUrl(name: string): string {
    // You could use services like robohash.org or boringavatars to generate
    // deterministic icons based on the contract address
    return `https://api.dicebear.com/7.x/icons/svg?seed=${name}`;
  }

  /**
   * Transforms ABI inputs into Warp action inputs
   *
   * Converts each ABI input to the appropriate Warp input format with proper
   * typing, validation, and user-friendly descriptions.
   *
   * @param inputs - Array of ABI inputs to transform
   * @returns Array of Warp action inputs with appropriate configuration
   * @throws {Error} If any input is missing a name or type
   */
  private transformInputs(inputs: AbiInput[] = []): WarpActionInput[] {
    if (!Array.isArray(inputs)) {
      return [];
    }

    return inputs.map((input, index) => {
      if (!input?.name || !input?.type) {
        throw new Error(`Invalid input at index ${index}`);
      }

      const position = `arg:${index + 1}` as WarpInputPosition;
      const type = this.convertType(input.type);

      return {
        name: input.name,
        type,
        position,
        source: 'field',
        required: !input.type.startsWith('optional<'),
        description: `Input parameter for ${input.name}`,
        bot: this.createBotDescription(input.name, input.type),
        ...this.getInputValidations(input),
      };
    });
  }

  // TODO: Needs to be reviewed to determine if more type handling is needed
  /**
   * Creates a detailed, AI-friendly description for input parameters
   *
   * This generates natural language descriptions that help AI assistants understand
   * both the purpose and expected format of each parameter.
   *
   * @param inputName - The name of the input parameter
   * @param inputType - The original ABI type of the parameter
   * @returns A detailed, conversational description for AI assistants
   */
  private createBotDescription(inputName: string, inputType: string): string {
    const humanizedName = GenericUtils.humanizeString(inputName);
    const convertedType = this.convertType(inputType);
    const baseType = this.extractBaseType(convertedType);
    const friendlyType = this.getFriendlyTypeName(baseType);

    // Add validation hints based on type
    let constraints = '';

    if (baseType === 'address') {
      constraints =
        ' (must be a valid MultiversX address starting with "erd1")';
    } else if (friendlyType === 'number' || baseType.match(/^u\d+$/)) {
      constraints = ' (must be a positive number)';
    } else if (baseType === 'tokenidentifier') {
      constraints =
        ' (e.g., "EGLD" or a valid token identifier like "TOKEN-123456")';
    }

    // Handle different type patterns with more natural language
    if (
      convertedType.startsWith('optional:') ||
      convertedType.startsWith('option:')
    ) {
      return `An optional ${friendlyType} for ${humanizedName}${constraints}. This parameter can be omitted.`;
    }

    if (convertedType.startsWith('list:')) {
      const innerType = convertedType.substring(5);

      // Check if inner type is a composite - handle more dynamically
      if (innerType.startsWith('composite(')) {
        // Check first if it's a field-structured composite
        const structuredComposite = this.describeStructuredComposite(innerType);
        if (structuredComposite) {
          return `A list of structured entries for ${humanizedName}, where each entry contains: ${structuredComposite}.`;
        }

        // If not field-structured, try pattern recognition
        const pattern = this.identifyCompositePattern(innerType);
        if (pattern) {
          return `A list of ${pattern.description} for ${humanizedName}. ${pattern.usage}`;
        }
      }

      const itemType = this.getFriendlyTypeName(
        this.extractBaseType(innerType),
      );
      return `A list of ${itemType} values for ${humanizedName}${constraints}. Provide multiple items separated by commas.`;
    }

    if (convertedType.startsWith('variadic:')) {
      const innerType = convertedType.substring(9);

      // Check if inner type is a composite - handle more dynamically
      if (innerType.startsWith('composite(')) {
        // Check first if it's a field-structured composite
        const structuredComposite = this.describeStructuredComposite(innerType);
        if (structuredComposite) {
          return `Multiple structured entries for ${humanizedName}. Each entry should contain: ${structuredComposite}. You can provide multiple entries.`;
        }

        // If not field-structured, try pattern recognition
        const pattern = this.identifyCompositePattern(innerType);
        if (pattern) {
          return `Multiple ${pattern.description} for ${humanizedName}. ${pattern.usage} You can specify multiple entries.`;
        }
      }

      const itemType = this.getFriendlyTypeName(
        this.extractBaseType(innerType),
      );
      return `One or more ${itemType} values for ${humanizedName}${constraints}. You can provide multiple items.`;
    }

    if (convertedType.startsWith('composite(')) {
      // First check if it's a field-structured composite
      const structuredComposite =
        this.describeStructuredComposite(convertedType);
      if (structuredComposite) {
        return `A structured entry for ${humanizedName} containing: ${structuredComposite}.`;
      }

      // If not field-structured, try pattern recognition
      const pattern = this.identifyCompositePattern(convertedType);
      if (pattern) {
        return `A ${pattern.description} for ${humanizedName}. ${pattern.usage}`;
      }

      // Generic composite fallback
      const compositeMatch = convertedType.match(/composite\((.+)\)/);
      if (compositeMatch && compositeMatch[1]) {
        const parts = compositeMatch[1].split('|');
        const types = parts.map((p) => this.getFriendlyTypeName(p));
        return `A combined value for ${humanizedName} containing: ${types.join(' and ')}.`;
      }
    }

    // For standard types, give a more detailed description
    return `The ${friendlyType} value for ${humanizedName}${constraints}.`;
  }

  /**
   * Identifies common patterns in composite types and provides appropriate descriptions
   *
   * This method analyzes composite types dynamically to generate helpful descriptions
   * regardless of the specific types or their order.
   *
   * @param compositeType - The composite type string to analyze
   * @returns A pattern description object or null if extraction fails
   */
  private identifyCompositePattern(
    compositeType: string,
  ): { description: string; usage: string } | null {
    // Extract the component types from composite(type1|type2|...)
    const match = compositeType.match(/composite\((.+)\)/);
    if (!match || !match[1]) {
      return null;
    }

    const parts = match[1].split('|');

    // Skip field:value patterns, we handle those separately
    if (parts.some((p) => p.includes(':'))) {
      return null;
    }

    // Build a dynamic description of the composite based on its components
    const typeDescriptions = parts.map((type) =>
      this.getFriendlyTypeName(type),
    );

    // Generate a description that lists all component types
    const description =
      typeDescriptions.length > 1
        ? `${typeDescriptions.slice(0, -1).join(', ')} and ${typeDescriptions.slice(-1)[0]} combination`
        : `${typeDescriptions[0]} value`;

    // Generate usage instructions based on the types present
    const typeInstructions = parts.map((type, index) => {
      const ordinal = this.getOrdinal(index + 1);
      const friendlyType = this.getFriendlyTypeName(type);
      let instruction = `${ordinal}, provide a ${friendlyType}`;

      // Add specific guidance based on type
      if (type === 'address') {
        instruction += ' (starting with "erd1")';
      } else if (type === 'biguint') {
        instruction += ' (a positive number)';
      } else if (
        type === 'tokenidentifier' ||
        type === 'egldoresdttokenidentifier'
      ) {
        instruction += ' (like "EGLD" or "TOKEN-123456")';
      }

      return instruction;
    });

    const usage = `For each entry: ${typeInstructions.join('; ')}.`;

    return { description, usage };
  }

  /**
   * Generates a human-readable description of a structured composite type with named fields
   *
   * @param compositeType - A composite type with field:type patterns
   * @returns A human-readable description of the fields or null if not applicable
   */
  private describeStructuredComposite(compositeType: string): string | null {
    const match = compositeType.match(/composite\((.+)\)/);
    if (!match || !match[1]) {
      return null;
    }

    const parts = match[1].split('|');

    // Only process if this is a field:type pattern composite
    if (!parts.some((p) => p.includes(':'))) {
      return null;
    }

    // Extract field names and types
    const fieldDescriptions = parts.map((part) => {
      const [fieldName, fieldType] = part.split(':');
      const friendlyType = this.getFriendlyTypeName(fieldType);

      let constraints = '';
      if (fieldType === 'address') {
        constraints = ' (a wallet address starting with "erd1")';
      } else if (fieldType === 'biguint' || fieldType.match(/^u\d+$/)) {
        constraints = ' (a positive number)';
      } else if (fieldType === 'tokenidentifier' || fieldType === 'token') {
        constraints = ' (a token identifier)';
      } else if (fieldType === 'bool') {
        constraints = ' (true or false)';
      }

      return `${GenericUtils.humanizeString(fieldName)} ${constraints ? constraints : `(${friendlyType})`}`;
    });

    // Format the field descriptions in a natural language way
    if (fieldDescriptions.length === 1) {
      return fieldDescriptions[0];
    }

    if (fieldDescriptions.length === 2) {
      return `${fieldDescriptions[0]} and ${fieldDescriptions[1]}`;
    }

    const lastField = fieldDescriptions.pop();
    return `${fieldDescriptions.join(', ')}, and ${lastField}`;
  }

  /**
   * Creates payment input fields based on the token types accepted by the endpoint
   *
   * This function handles the creation of EGLD and ESDT payment input fields
   * based on which token types the contract endpoint accepts.
   *
   * @param payableTokens - Array of token identifiers that the endpoint accepts as payment
   * @returns Array of payment input fields configured for the accepted tokens
   */
  private createPaymentInputs(payableTokens?: string[]): WarpActionInput[] {
    if (!payableTokens?.length) {
      return [];
    }

    // Special case: '*' means any token is accepted
    if (payableTokens.includes('*')) {
      return [this.createEsdtInput(), this.createEgldInput(false)];
    }

    const inputs: WarpActionInput[] = [];
    const acceptedTokens = payableTokens.filter((token) => token !== 'EGLD');

    // Add EGLD input if EGLD is accepted
    if (payableTokens.includes('EGLD')) {
      inputs.push(this.createEgldInput(true));
    }

    // Add ESDT input if any tokens are accepted
    if (acceptedTokens.length > 0) {
      inputs.push(this.createEsdtInput(acceptedTokens));
    }

    return inputs;
  }

  /**
   * Creates an input field for EGLD payment
   *
   * @param required - Whether the EGLD payment is required or optional
   * @returns A configured Warp input for EGLD amount
   */
  private createEgldInput(required: boolean): WarpActionInput {
    return {
      name: 'egldAmount',
      type: 'biguint',
      position: 'value',
      source: 'field',
      required,
      bot: 'Amount of EGLD to send',
      description: `Amount of EGLD to send${required ? '' : ' (optional)'}`,
      min: 0,
      modifier: 'scale:18',
    };
  }

  /**
   * Creates an input field for ESDT token payment
   *
   * @param acceptedTokens - Optional array of specific token identifiers that are accepted
   * @returns A configured Warp input for token selection and amount
   */
  private createEsdtInput(acceptedTokens?: string[]): WarpActionInput {
    return {
      name: 'tokenAmount',
      type: 'esdt',
      position: 'transfer',
      source: 'field',
      required: false,
      description: acceptedTokens
        ? `Amount of tokens to send (${acceptedTokens.join(' or ')})`
        : 'Amount and type of tokens to send (optional)',
      options: acceptedTokens,
      bot: 'Amount and token to send',
    };
  }

  /**
   * Converts technical type names to user-friendly descriptions
   *
   * This helps create more readable prompts and descriptions for end users
   * who may not be familiar with blockchain type names.
   *
   * @param type - The technical type name to convert
   * @returns A user-friendly description of the type
   */
  private getFriendlyTypeName(type: string): string {
    // Remove generics and get base type
    const baseType = type.replace(/<.*>/g, '').toLowerCase();

    // Handle composite types nested in the type name
    if (baseType.includes('composite')) {
      return 'structured data';
    }

    const typeMap: Record<string, string> = {
      address: 'wallet address',
      biguint: 'number',
      u64: 'number',
      u32: 'number',
      i64: 'number',
      i32: 'number',
      string: 'text',
      bool: 'true/false value',
      tokenidentifier: 'token identifier',
      egldoresdttokenidentifier: 'token identifier',
      esdt: 'token amount',
      nft: 'NFT',
    };

    return typeMap[baseType] || type;
  }

  /**
   * Converts ABI types to Warp-compatible types
   *
   * This is the main type conversion function that handles both simple and complex types,
   * including nested generics, optional values, and custom defined types.
   *
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

      // Handle multi<T1,T2,...> type
      if (abiType.startsWith('multi<')) {
        return this.convertMultiType(abiType);
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

          // Handle multi<...> nested inside another type (e.g., variadic<multi<T1,T2>>)
          const convertedInner = innerType.startsWith('multi<')
            ? this.convertMultiType(innerType)
            : this.convertType(innerType);

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

  /**
   * Converts multi<T1,T2,...> type to composite(t1|t2|...)
   *
   * This function handles the conversion of MultiversX ABI multi-value types to Warp's composite type format.
   * Multi-types allow for packaging multiple values of potentially different types together.
   *
   * The function properly handles nested generic types by tracking bracket depth during parsing.
   *
   * @example
   * // Returns "composite(address|biguint)"
   * convertMultiType("multi<Address,BigUint>")
   *
   * @example
   * // Returns "composite(address|composite(tokenidentifier|biguint))"
   * convertMultiType("multi<Address,multi<TokenIdentifier,BigUint>>")
   *
   * @param multiType - The multi type string to convert (format: multi<Type1,Type2,...>)
   * @returns The corresponding composite type in Warp format (format: composite(type1|type2|...))
   * @throws {Error} If the input string doesn't match the expected multi<...> format
   */
  private convertMultiType(multiType: string): string {
    if (!multiType.startsWith('multi<')) {
      throw new Error(`Invalid multi type format: ${multiType}`);
    }

    // Extract types between the brackets
    const typesMatch = multiType.match(/multi<(.+)>/);
    if (!typesMatch || !typesMatch[1]) {
      throw new Error(`Invalid multi type format: ${multiType}`);
    }

    // Parse comma-separated types, handling nested angle brackets
    const innerContent = typesMatch[1];
    const types: string[] = [];
    let currentType = '';
    let bracketCount = 0;

    // Bracket-aware parsing to handle nested generic types
    for (let i = 0; i < innerContent.length; i++) {
      const char = innerContent[i];

      if (char === '<') bracketCount++;
      else if (char === '>') bracketCount--;

      // Only split on commas at the top level (bracket count is 0)
      if (char === ',' && bracketCount === 0) {
        types.push(currentType.trim());
        currentType = '';
        continue;
      }

      currentType += char;
    }

    // Add the last type if it exists
    if (currentType.trim()) {
      types.push(currentType.trim());
    }

    // Convert each type in the multi-type using the main convertType method
    const convertedTypes = types.map((type) => this.convertType(type));

    // Return as composite type with pipe-separated values
    return `composite(${convertedTypes.join('|')})`;
  }

  /**
   * Converts custom defined types from the ABI to Warp-compatible types
   *
   * Handles both enum types (converted to u64) and struct types (converted to composite types).
   *
   * @param typeName - The name of the custom type defined in the ABI
   * @returns The corresponding Warp type
   * @throws {Error} If the type is not found or is an unsupported custom type
   */
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

  /**
   * Extracts the base type from a potentially complex type string
   *
   * For example, extracts "biguint" from "optional:biguint" or "list:address".
   * This helps with applying proper validations based on the underlying type.
   *
   * @param type - The type string to process
   * @returns The extracted base type
   */
  private extractBaseType(type: string): string {
    // Handle nested types like option:, list:, etc.
    const typeSegments = type.split(':');
    return typeSegments[typeSegments.length - 1];
  }

  /**
   * Generates appropriate validation rules for an input based on its type
   *
   * Different types require different validation rules:
   * - Number types have minimum values
   * - Address types have format validation
   * - Token identifiers have pattern requirements
   * - Optional types are marked as not required
   *
   * @param input - The ABI input to generate validations for
   * @returns An object with validation rules applicable to the input type
   */
  private getInputValidations(input: AbiInput): Partial<WarpActionInput> {
    const validations: Partial<WarpActionInput> = {};

    if (!input?.type) {
      return validations;
    }

    // Extract the base type for validation
    const baseType = this.extractBaseType(input.type);

    switch (true) {
      case baseType.includes(AbiBaseType.BigUint):
        Object.assign(validations, {
          min: 0,
          modifier: baseType === AbiBaseType.BigUint ? 'scale:18' : undefined,
        });
        break;

      case baseType.includes(AbiBaseType.Address):
        Object.assign(validations, {
          pattern: WARP_CONSTANTS.REGEX_PATTERNS.MULTIVERSX_ADDRESS,
          patternDescription: 'Must be a valid MultiversX address',
        });
        break;

      case baseType.includes(AbiBaseType.TokenIdentifier):
      case baseType.includes(AbiBaseType.EgldOrEsdtTokenIdentifier):
        Object.assign(validations, {
          pattern: WARP_CONSTANTS.REGEX_PATTERNS.TOKEN_IDENTIFIER,
          patternDescription: 'Must be EGLD or a valid token identifier',
        });
        break;

      case baseType.includes(AbiBaseType.Bool):
        Object.assign(validations, {
          type: 'boolean',
        });
        break;
    }

    // If the type is optional (starts with option: or optional:), mark as not required
    if (
      input.type.startsWith('option:') ||
      input.type.startsWith('optional:')
    ) {
      validations.required = false;
    }

    return validations;
  }

  /**
   * Gets the ordinal form of a number (1st, 2nd, 3rd, etc.)
   *
   * @param n - The number to convert to an ordinal string
   * @returns The ordinal form of the number
   */
  private getOrdinal(n: number): string {
    const suffixes = ['th', 'st', 'nd', 'rd'];
    const v = n % 100;
    return n + (suffixes[(v - 20) % 10] || suffixes[v] || suffixes[0]);
  }
}
