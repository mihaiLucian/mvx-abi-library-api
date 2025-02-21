import { Address } from '@multiversx/sdk-core';

import {
  AbiBaseType,
  AbiDefinition,
  AbiTypePattern,
} from 'src/features/abi/types/abi.types';

const NUMERIC_TYPES = [
  AbiBaseType.U8,
  AbiBaseType.I8,
  AbiBaseType.U16,
  AbiBaseType.I16,
  AbiBaseType.U32,
  AbiBaseType.I32,
  AbiBaseType.U64,
  AbiBaseType.I64,
  AbiBaseType.BigUint,
  AbiBaseType.Isize,
  AbiBaseType.Usize,
];

export interface ParseOptions {
  parseJson?: boolean;
  decodeBase64?: boolean;
}

/**
 * Parser for MultiversX ABI hex responses
 * @class AbiTypeParser
 * @description Handles parsing of smart contract response data according to ABI types
 */
export class AbiTypeConverter {
  private abi: AbiDefinition;
  private options: Required<ParseOptions>;

  /**
   * Creates an instance of AbiTypeParser
   * @param {Record<string, any>} abiJson - The ABI definition JSON
   * @param {ParseOptions} [options] - Parsing options
   */
  constructor(abiJson: AbiDefinition, options: ParseOptions = {}) {
    this.abi = abiJson;
    this.options = {
      parseJson: options.parseJson ?? true,
      decodeBase64: options.decodeBase64 ?? true,
    };
  }

  /**
   * Splits an array into chunks of specified size
   * @private
   * @template T - Type of array elements
   * @param {T[]} items - Array to split
   * @param {number} size - Size of each chunk
   * @returns {T[][]} Array of chunks
   * @example
   * chunks([1,2,3,4,5], 2) // returns [[1,2], [3,4], [5]]
   */
  private chunks<T>(items: T[], size: number): T[][] {
    return Array.from({ length: Math.ceil(items.length / size) }, (_, i) =>
      items.slice(i * size, i * size + size),
    );
  }

  /**
   * Validates if a string is base64 encoded
   * @private
   * @param {string | Buffer} str - String or buffer to validate
   * @returns {boolean} True if string is valid base64
   * @description Attempts to decode and re-encode the input to verify base64 format
   */
  private isBase64(str: string | Buffer): boolean {
    try {
      // Convert to string and trim whitespace
      const s = (Buffer.isBuffer(str) ? str.toString('ascii') : str).trim();
      // Attempt to decode from base64
      const decoded = Buffer.from(s, 'base64');
      // Re-encode the decoded value and compare
      const reEncoded = decoded.toString('base64');
      return reEncoded === s;
    } catch {
      return false;
    }
  }

  /**
   * Parses hex responses according to the specified response type
   * @template T - The expected return type
   * @param {Buffer[]} hexResponses - Array of hex response buffers
   * @param {string} responseType - The ABI type to parse as
   * @returns {T} Parsed response data
   * @throws {AbiParserError} When parsing fails
   */
  public parseHexResponse<T extends unknown>(
    hexResponses: Buffer[],
    responseType: string,
  ): T {
    const result: unknown[] = [];
    const originalIsPrimitive = this.isPrimitiveType(
      responseType.replace(/^variadic<(.+)>$/, '$1'),
    );

    // Handle variadic multi type with commas
    if (
      responseType.startsWith('variadic<multi<') &&
      responseType.includes(',')
    ) {
      const objectTypes = responseType
        .replace('variadic<multi<', '')
        .slice(0, -2)
        .split(',');
      const outputChunksSize = objectTypes.length;
      const reorganized = this.chunks(hexResponses, outputChunksSize);

      const parsedResults = reorganized.map((chunk) => {
        return chunk.map((item, i) => {
          const [parsedData] = this.readHex(
            item,
            objectTypes[i].trim(), // trim each type for safety
            this.isPrimitiveType(objectTypes[i]),
          );
          return parsedData;
        });
      });

      return parsedResults as T;
    }

    // Handle regular responses
    for (const hexResponse of hexResponses) {
      const [parsedData] = this.readHex(
        hexResponse,
        responseType,
        originalIsPrimitive,
      );
      result.push(parsedData);
    }

    return (result.length === 1 ? result[0] : result) as T;
  }

  /**
   * Checks if a type is a primitive type
   * @private
   * @param {string} type - Type to check
   * @returns {boolean} True if primitive
   */
  private isPrimitiveType(type: string): boolean {
    const primitiveTypes = Object.values(AbiBaseType);
    return primitiveTypes.includes(type as AbiBaseType);
  }

  /**
   * Reads hex data according to the specified type
   * @private
   * @param {Buffer} data - Buffer containing hex data
   * @param {string} objectType - Type to parse as
   * @param {boolean} [originalTypeIsPrimitive=false] - Whether the original type was primitive
   * @returns {[any, number]} Tuple of [parsed value, bytes consumed]
   * @throws {AbiParserError} When parsing fails
   */
  private readHex(
    data: Buffer,
    objectType: string,
    originalTypeIsPrimitive = false,
  ): [any, number] {
    try {
      // Handle empty data
      if (data.length === 0) {
        if (
          originalTypeIsPrimitive &&
          NUMERIC_TYPES.includes(objectType as (typeof NUMERIC_TYPES)[number])
        ) {
          return [objectType.includes('Big') ? '0' : 0, 0];
        }
        return [null, 0];
      }

      // Handle type patterns
      if (objectType.startsWith(AbiTypePattern.Optional)) {
        const subtype = this.extractGenericType(
          objectType,
          AbiTypePattern.Optional,
        );
        return this.readHex(data, subtype);
      }

      if (this.isPrimitiveType(objectType)) {
        return this.readPrimitiveType(
          data,
          objectType,
          originalTypeIsPrimitive,
        );
      }

      if (objectType === AbiBaseType.Address) {
        return this.readAddressType(data);
      }

      if (objectType.startsWith(AbiTypePattern.List)) {
        const subtype = this.extractGenericType(
          objectType,
          AbiTypePattern.List,
        );
        return this.readListType(data, subtype);
      }

      // Handle other complex types using a mapping for readability
      const typeHandlers: Record<
        string,
        (data: Buffer, subtype: string) => [any, number]
      > = {
        array: this.readArrayType.bind(this),
        vec: this.readListType.bind(this),
        Vec: this.readListType.bind(this),
        variadic: (data, subtype) =>
          this.readHex(data, subtype, originalTypeIsPrimitive),
        Option: this.readOptionType.bind(this),
        multi: (data, subtypes) =>
          this.readMultiType(data, subtypes.split(',')),
        tuple: (data, subtypes) =>
          this.readMultiType(data, subtypes.split(',')),
      };

      for (const [prefix, handler] of Object.entries(typeHandlers)) {
        if (objectType.startsWith(`${prefix}<`)) {
          const subtype = objectType.slice(prefix.length + 1, -1).trim();
          return handler(data, subtype);
        }
      }

      // Handle custom types from ABI
      if (this.abi && this.abi.types && this.abi.types[objectType]) {
        const typeData = this.abi.types[objectType];

        if (typeof typeData === 'object' && 'type' in typeData) {
          if (typeData.type === 'enum') {
            return this.readEnumType(data, typeData as any);
          }
          if (typeData.type === 'struct') {
            return this.readStructType(data, typeData as any);
          }
        }

        if (Array.isArray(typeData)) {
          return this.readTupleType(data, typeData);
        }
      }

      // If nothing matches, throw an error with explicit details
      throw new Error(`Unsupported type provided: ${objectType}`);
    } catch (error) {
      throw new Error(`Failed to parse type ${objectType}: ${error.message}`);
    }
  }

  /**
   * Safely attempts to parse a JSON string
   * @private
   * @param {string} value - String to parse
   * @returns {any} Parsed object or original string
   */
  private safeJsonParse(value: string): any {
    if (!this.options.parseJson) return value;
    try {
      return JSON.parse(value);
    } catch {
      return value;
    }
  }

  // Implementation of specific type readers

  /**
   * Reads and parses a primitive type from buffer
   * @private
   * @param {Buffer} data - Buffer containing the data
   * @param {string} objectType - Primitive type to parse as
   * @param {boolean} originalIsPrimitive - Whether the original type was primitive
   * @returns {[any, number]} Tuple of [parsed value, bytes consumed]
   * @throws {Error} If primitive type is not supported
   * @description Handles all primitive types including numbers, booleans, and special types
   */
  private readPrimitiveType(
    data: Buffer,
    objectType: string,
    originalIsPrimitive: boolean,
  ): [any, number] {
    switch (objectType) {
      case AbiBaseType.Bytes: {
        if (originalIsPrimitive) {
          return [data.toString('ascii'), data.length];
        }
        const objLen = data.readUInt32BE(0);
        const value = data.subarray(4, objLen + 4).toString('ascii');
        if (this.isBase64(value)) {
          const decoded = Buffer.from(value, 'base64').toString();
          try {
            if (decoded.startsWith('{') || decoded.startsWith('[')) {
              return [this.safeJsonParse(decoded), objLen + 4];
            }
          } catch {
            console.warn('Failed to parse JSON from base64 string');
          }
          return [decoded, objLen + 4];
        }
        return [value, objLen + 4];
      }

      case AbiBaseType.Address:
        return this.readAddressType(data);

      case AbiBaseType.U8:
      case AbiBaseType.I8:
      case AbiBaseType.Usize:
      case AbiBaseType.Isize:
        return [data.readUInt8(0), 1];

      case AbiBaseType.U16:
      case AbiBaseType.I16:
        return [data.readUInt16BE(0), 2];

      case AbiBaseType.U32:
      case AbiBaseType.I32:
        return [data.readUInt32BE(0), 4];

      case AbiBaseType.U64:
      case AbiBaseType.I64:
        return [data.readBigUInt64BE(0).toString(), 8];

      case AbiBaseType.Bool:
        return [Boolean(data.readUInt8(0)), 1];

      case AbiBaseType.TokenIdentifier:
      case AbiBaseType.EgldOrEsdtTokenIdentifier:
        return this.readTokenIdentifier(data, originalIsPrimitive);

      case AbiBaseType.BigUint:
        if (originalIsPrimitive) {
          // Full buffer conversion into a BigInt then into a base10 string.
          const fullValue = BigInt('0x' + data.toString('hex'));
          return [fullValue.toString(), data.length];
        }
        const len = data.readUInt32BE(0);
        const valueBig = data.subarray(4, len + 4).toString('hex');
        return [valueBig, len + 4];

      default:
        throw new Error(`Unsupported primitive type: ${objectType}`);
    }
  }

  /**
   * Reads and parses a MultiversX address
   * @private
   * @param {Buffer} data - Buffer containing address data
   * @returns {[string, number]} Tuple of [bech32 address, bytes consumed]
   * @description Converts a hex address to bech32 format with 'erd' prefix
   */
  private readAddressType(data: Buffer): [string, number] {
    const hexAddress = data.subarray(0, 32).toString('hex');
    return [Address.fromHex(hexAddress, 'erd').bech32(), 32];
  }

  /**
   * Reads a variable-length list of items
   * @private
   * @param {Buffer} data - Buffer containing list data
   * @param {string} subtype - Type of list elements
   * @returns {[any[], number]} Tuple of [array of items, bytes consumed]
   * @description Continuously reads items until buffer is exhausted
   */
  private readListType(data: Buffer, subtype: string): [any[], number] {
    const result: any[] = [];
    let offset = 0;
    while (offset < data.length) {
      const [item, length] = this.readHex(data.subarray(offset), subtype);
      result.push(item);
      offset += length;
    }
    return [result, offset];
  }

  /**
   * Reads multiple values of different types
   * @private
   * @param {Buffer} data - Buffer containing data
   * @param {string[]} subtypes - Array of types to parse
   * @returns {[any[], number]} Tuple of [array of parsed values, bytes consumed]
   * @description Used for tuples and multi-value returns
   */
  private readMultiType(data: Buffer, subtypes: string[]): [any[], number] {
    const result: any[] = [];
    let offset = 0;
    for (const subtype of subtypes) {
      const [item, length] = this.readHex(
        data.subarray(offset),
        subtype.trim(),
      );
      result.push(item);
      offset += length;
    }
    return [result, offset];
  }

  /**
   * Reads an enum value from buffer
   * @private
   * @param {Buffer} data - Buffer containing enum data
   * @param {AbiEnum} enumType - Enum type definition from ABI
   * @returns {[any, number]} Tuple of [enum value or object, bytes consumed]
   * @description Handles both simple enums and enums with fields
   */
  private readEnumType(data: Buffer, enumType: any): [any, number] {
    const discriminant = data.readUInt8(0);
    const variant = enumType.variants[discriminant];
    let offset = 1;
    if (!variant.fields) {
      return [variant.name, offset];
    }
    const result: Record<string, any> = {};
    for (const field of variant.fields) {
      const [value, length] = this.readHex(data.subarray(offset), field.type);
      result[field.name] = value;
      offset += length;
    }
    return [{ [variant.name]: result }, offset];
  }

  /**
   * Reads a struct from buffer
   * @private
   * @param {Buffer} data - Buffer containing struct data
   * @param {AbiStruct} structType - Struct definition from ABI
   * @returns {[Record<string, any>, number]} Tuple of [struct object, bytes consumed]
   * @description Reads each field according to its type definition
   */
  private readStructType(
    data: Buffer,
    structType: any,
  ): [Record<string, any>, number] {
    const result: Record<string, any> = {};
    let offset = 0;
    for (const field of structType.fields) {
      const [value, length] = this.readHex(data.subarray(offset), field.type);
      result[field.name] = value;
      offset += length;
    }
    return [result, offset];
  }

  private readTupleType(data: Buffer, types: string[]): [any[], number] {
    return this.readMultiType(data, types);
  }

  /**
   * Reads a token identifier
   * @private
   * @param {Buffer} data - Buffer containing token identifier
   * @param {boolean} originalIsPrimitive - Whether the original type was primitive
   * @returns {[string, number]} Tuple of [token identifier, bytes consumed]
   * @description Handles both ESDT and EGLD token identifiers
   */
  private readTokenIdentifier(
    data: Buffer,
    originalIsPrimitive: boolean,
  ): [string, number] {
    if (originalIsPrimitive) {
      return [data.toString('ascii'), data.length];
    }
    const length = data.readUInt32BE(0);
    const value = data.subarray(4, length + 4).toString('ascii');
    return [value, length + 4];
  }

  /**
   * Reads an optional value
   * @private
   * @param {Buffer} data - Buffer containing optional data
   * @param {string} subtype - Type of the optional value
   * @returns {[any | null, number]} Tuple of [value or null, bytes consumed]
   * @description Handles Option/optional types with null checking
   */
  private readOptionType(data: Buffer, subtype: string): [any | null, number] {
    if (data.length === 0) {
      return [null, 0];
    }
    const flag = data.readUInt8(0);
    if (flag === 0) {
      return [null, 1];
    }
    const [value, length] = this.readHex(data.subarray(1), subtype);
    return [value, length + 1];
  }

  /**
   * Reads a fixed-size array
   * @private
   * @param {Buffer} data - Buffer containing array data
   * @param {string} type - Array type definition (e.g., 'array5<u8>')
   * @returns {[any[], number]} Tuple of [array of values, bytes consumed]
   * @throws {Error} If array type format is invalid
   * @description Handles fixed-size arrays with specified length in type
   */
  private readArrayType(data: Buffer, type: string): [any[], number] {
    if (!type.startsWith('array') || !type.includes('<')) {
      throw new Error('Invalid array type format');
    }
    const match = type.match(/array(\d+)<(.+)>/);
    if (!match) {
      throw new Error('Invalid array type format');
    }
    const [_, lengthStr, subtype] = match;
    const arrLength = parseInt(lengthStr, 10);
    const result: any[] = [];
    let offset = 0;
    for (let i = 0; i < arrLength; i++) {
      const [item, itemLength] = this.readHex(data.subarray(offset), subtype);
      result.push(item);
      offset += itemLength;
    }
    return [result, offset];
  }

  /**
   * Extracts the inner type from a generic type
   * @private
   * @param {string} type - Full type string
   * @param {string} wrapper - Wrapper type to remove
   * @returns {string} Inner type
   */
  private extractGenericType(type: string, wrapper: string): string {
    return type.slice(wrapper.length, -1).trim();
  }
}
