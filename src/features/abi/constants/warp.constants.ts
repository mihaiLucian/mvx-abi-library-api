/**
 * Constants used in the Warp generator module
 */
export const WARP_CONSTANTS = {
  PROTOCOL_VERSION: 'warp:0.4.0',
  DEFAULT_GAS_LIMIT: 60000000,
  TYPE_MAPPINGS: {
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
  } as const,
  REGEX_PATTERNS: {
    MULTIVERSX_ADDRESS: '^erd1[a-zA-Z0-9]{58}$',
    TOKEN_IDENTIFIER: '^(EGLD|[A-Z0-9]{3,10}(-[a-fA-F0-9]{6})?)$',
  } as const,
} as const;
