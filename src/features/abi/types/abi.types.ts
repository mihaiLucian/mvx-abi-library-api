export enum AbiBaseType {
  U8 = 'u8',
  I8 = 'i8',
  U16 = 'u16',
  I16 = 'i16',
  U32 = 'u32',
  I32 = 'i32',
  U64 = 'u64',
  I64 = 'i64',
  Isize = 'isize',
  Usize = 'usize',
  BigUint = 'BigUint',
  Bool = 'bool',
  Bytes = 'bytes',
  Address = 'Address',
  TokenIdentifier = 'TokenIdentifier',
  EgldOrEsdtTokenIdentifier = 'EgldOrEsdtTokenIdentifier',
}

export type ComplexAbiType =
  | `Option<${AbiBaseType}>`
  | `optional<${AbiBaseType}>`
  | `List<${AbiBaseType}>`
  | `variadic<${AbiBaseType}>`
  | `multi<${AbiBaseType}>`;

export enum AbiTypePattern {
  Optional = 'optional<',
  List = 'List<',
  Variadic = 'variadic<',
  Option = 'Option<',
  Multi = 'multi<',
}

export class AbiInput {
  name: string;
  type: string;
  multi_arg?: boolean;
  /**
   * Additional information for input processing and validation
   * Can contain dynamic parameters like:
   * - scale: A value for token decimal scaling
   * - min/max: Value constraints
   * - pattern: Custom validation pattern
   * - Any future properties needed for advanced validation
   */
  additionalInfo?: Record<string, unknown>;
}

export class AbiOutput {
  type: string;
  multi_result?: boolean;
}

export class AbiEndpoint {
  name: string;
  mutability: 'mutable' | 'readonly';
  docs?: string[];
  payableInTokens?: string[];
  inputs?: AbiInput[];
  outputs?: AbiOutput[];
  onlyOwner?: boolean;
  additionalInfo?: Record<string, unknown>;
}

export class AbiDefinition {
  name: string;
  docs?: string[];
  endpoints: AbiEndpoint[];
  types?: { [key: string]: { [key: string]: any } };
}

export interface AbiResolvedType {
  type: string;
  example: any;
  items?: AbiResolvedType | AbiResolvedType[];
  nullable?: boolean;
  properties?: { [key: string]: AbiResolvedType };
  enum?: string[];
}
