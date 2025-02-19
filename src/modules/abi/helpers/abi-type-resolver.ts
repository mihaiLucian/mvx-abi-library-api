import { AbiResolvedType } from '../types/abi.types';

export class AbiTypeResolver {
  private readonly basicTypes: Record<string, AbiResolvedType>;
  private readonly abiTypes: { [key: string]: { [key: string]: any } };

  constructor(types?: { [key: string]: { [key: string]: any } }) {
    this.basicTypes = {
      i8: { type: 'number', example: 1 },
      i16: { type: 'number', example: 12 },
      i32: { type: 'number', example: 1234 },
      i64: { type: 'number', example: 12345678 },
      u8: { type: 'number', example: 1 },
      u16: { type: 'number', example: 12 },
      u32: { type: 'number', example: 1234 },
      u64: { type: 'number', example: 12345678 },
      isize: { type: 'number', example: 1 },
      usize: { type: 'number', example: 1 },
      bytes: {
        type: 'string',
        example: 'Tech is great!',
      },
      bool: { type: 'boolean', example: false },
      BigUint: { type: 'string', example: '69000000000000000000' },
      BigInt: { type: 'string', example: '69000000000000000000' },
      EgldOrEsdtTokenIdentifier: { type: 'string', example: 'EGLD' },
      TokenIdentifier: { type: 'string', example: 'TECH-abcd69' },
      Address: {
        type: 'string',
        example:
          'erd1j8pxthqzwmadxcnq3a0z9965ygjq7dfqq3q2mk2cwc7gupqkukqsl0l3c5',
      },
    };
    this.abiTypes = types || {};
  }

  public resolveType(type: any): AbiResolvedType {
    // Define handlers for different complex type patterns
    const conditions: { [key: string]: (subtype: any) => AbiResolvedType } = {
      variadic: (subtype) => ({
        type: 'array',
        items: this.resolveType(subtype),
        example: [this.resolveType(subtype).example],
      }),
      List: (subtype) => ({
        type: 'array',
        items: this.resolveType(subtype),
        example: [this.resolveType(subtype).example],
      }),
      vec: (subtype) => ({
        type: 'array',
        items: this.resolveType(subtype),
        example: [this.resolveType(subtype).example],
      }),
      Option: (subtype) => ({
        type: this.resolveType(subtype).type,
        nullable: true,
        example: this.resolveType(subtype).example,
      }),
      optional: (subtype) => this.resolveType(subtype),
      tuple: (subtype) => ({
        type: 'array',
        items: Array.isArray(subtype)
          ? subtype.map((st) => this.resolveType(st))
          : [],
        example: Array.isArray(subtype)
          ? subtype.map((st) => this.resolveType(st).example)
          : [],
      }),
      enum: () => ({
        type: 'string',
        example: 'enum_value',
      }),
      multi: (subtype) => ({
        type: 'array',
        items: this.resolveType(subtype),
        example: [this.resolveType(subtype).example],
      }),
    };

    if (Array.isArray(type)) {
      type = type[0];
    }

    if (typeof type === 'string') {
      if (type in this.basicTypes) {
        return this.basicTypes[type];
      }

      for (const [prefix, handler] of Object.entries(conditions)) {
        const pattern = new RegExp(`^${prefix}<(.+)>$`);
        const match = type.match(pattern);
        if (match) {
          return handler(match[1]);
        }
      }

      if (this.abiTypes) {
        const customType = this.abiTypes[type];
        if (customType) {
          if (customType.type === 'enum') {
            const enumValues = customType.variants.map((v: any) => v.name);
            return {
              type: 'string',
              enum: enumValues,
              example: enumValues[0],
            };
          } else {
            const resolvedFields = Object.fromEntries(
              customType.fields.map((field: any) => [
                field.name,
                this.resolveType(field.type),
              ]),
            );
            return {
              type: 'object',
              properties: resolvedFields,
              example: Object.fromEntries(
                customType.fields.map((field: any) => [
                  field.name,
                  this.resolveType(field.type).example,
                ]),
              ),
            };
          }
        }
      }

      if (type.includes(',') && !type.includes('<') && !type.includes('>')) {
        const subtypes = type.split(',').map((t) => t.trim());
        return {
          type: 'array',
          items: subtypes.map((st) => this.resolveType(st)),
          example: subtypes.map((st) => this.resolveType(st).example),
        };
      }

      return {
        type: `Unknown Type: ${type}`,
        example: 'unknown',
      };
    }

    return type as AbiResolvedType;
  }
}
