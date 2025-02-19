import { ApiProperty } from '@nestjs/swagger';

export enum WarpActionType {
  Contract = 'contract',
  Query = 'query',
  Collect = 'collect',
  Link = 'link',
}

export type WarpInputPosition = 'value' | 'transfer' | `arg:${number}`;
export type WarpInputSource = 'field' | 'query';
export type WarpActionInputType = string;

export class WarpContractActionTransfer {
  @ApiProperty({
    description: 'Token identifier',
    example: 'EGLD',
  })
  token: string;

  @ApiProperty({
    description: 'Amount to transfer',
    example: '1000000000000000000',
    required: false,
  })
  amount?: string;

  @ApiProperty({
    description: 'Nonce for the token transfer',
    example: 1,
    required: false,
  })
  nonce?: number;
}

export class WarpActionInput {
  @ApiProperty({
    description: 'Display text for fields or URL query parameter name',
    example: 'Amount',
  })
  name: string;

  @ApiProperty({
    description: 'Input type (e.g., string, uint64, address)',
    example: 'biguint',
  })
  type: WarpActionInputType;

  @ApiProperty({
    description: 'Input position (value, transfer, or arg position)',
    example: 'value',
  })
  position: WarpInputPosition;

  @ApiProperty({
    description: 'Input source (field or query)',
    example: 'field',
  })
  source: WarpInputSource;

  @ApiProperty({
    description: 'Alternative name for the input',
    example: 'transferAmount',
    required: false,
  })
  as?: string;

  @ApiProperty({
    description: 'AI-specific instructions for handling input',
    example: 'Amount in EGLD to transfer',
    required: false,
  })
  bot?: string;

  @ApiProperty({
    description: 'Whether the input is mandatory',
    example: true,
    required: false,
  })
  required?: boolean;

  @ApiProperty({
    description: 'Description displayed to the user',
    example: 'Enter the amount to transfer',
    nullable: true,
    required: false,
  })
  description?: string | null;

  @ApiProperty({
    description: 'Minimum value or length',
    example: '0.1',
    required: false,
  })
  min?: number | string;

  @ApiProperty({
    description: 'Maximum value or length',
    example: '100',
    required: false,
  })
  max?: number | string;

  @ApiProperty({
    description: 'Regular expression pattern for validation',
    example: '^[0-9]+$',
    required: false,
  })
  pattern?: string;

  @ApiProperty({
    description: 'Description of the pattern requirement',
    example: 'Must contain only numbers',
    required: false,
  })
  patternDescription?: string;

  @ApiProperty({
    description: 'Predefined options for the input',
    example: ['option1', 'option2'],
    isArray: true,
    required: false,
  })
  options?: string[];

  @ApiProperty({
    description: 'Input modifier (e.g., scale:18)',
    example: 'scale:18',
    required: false,
  })
  modifier?: string;
}

export class WarpContractAction {
  @ApiProperty({
    description: 'Type of action',
    enum: WarpActionType,
    example: WarpActionType.Contract,
  })
  type: WarpActionType.Contract;

  @ApiProperty({
    description: 'Text displayed on the action button',
    example: 'Execute Contract',
  })
  label: string;

  @ApiProperty({
    description: 'Smart contract address',
    example: 'erd1qqqqqqqqqqqqqqqpqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqplllst77y4l',
  })
  address: string;

  @ApiProperty({
    description: 'Function to call in the smart contract',
    example: 'myFunction',
    nullable: true,
  })
  func: string | null;

  @ApiProperty({
    description: 'Fixed set of typed arguments for the contract',
    example: ['string:arg1', 'uint64:123'],
    isArray: true,
  })
  args: string[];

  @ApiProperty({
    description: 'Gas limit for the transaction',
    example: 60000000,
  })
  gasLimit: number | undefined;

  @ApiProperty({
    description: 'Amount of native tokens to transfer',
    example: '1000000000000000000',
    required: false,
  })
  value?: string;

  @ApiProperty({
    description: 'Token transfers to be performed',
    type: [WarpContractActionTransfer],
    isArray: true,
    required: false,
  })
  transfers?: WarpContractActionTransfer[];

  @ApiProperty({
    description: 'User-defined inputs for value or positional args',
    type: [WarpActionInput],
    isArray: true,
    required: false,
  })
  inputs?: WarpActionInput[];

  @ApiProperty({
    description: 'Description of the action',
    example: 'This action calls the smart contract',
    nullable: true,
    required: false,
  })
  description?: string | null;

  @ApiProperty({
    description: 'Next action or URL for redirect',
    example: 'https://next.warp',
    required: false,
  })
  next?: string;
}

export class WarpQueryAction {
  @ApiProperty({
    description: 'Type of action',
    enum: WarpActionType,
    example: WarpActionType.Query,
  })
  type: WarpActionType.Query;

  @ApiProperty({
    description: 'Text displayed on the action button',
    example: 'Query Data',
  })
  label: string;

  @ApiProperty({
    description: 'Smart contract address',
    example: 'erd1qqqqqqqqqqqqqqqpqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqplllst77y4l',
  })
  address: string;

  @ApiProperty({
    description: 'Function to call in the smart contract',
    example: 'getBalance',
  })
  func: string;

  @ApiProperty({
    description: 'Fixed set of typed arguments for the query',
    example: ['string:arg1'],
    isArray: true,
  })
  args: string[];

  @ApiProperty({
    description: 'ABI for the query',
    example: '{"name": "getBalance"}',
    required: false,
  })
  abi?: string;

  @ApiProperty({
    description: 'User-defined inputs for positional args',
    type: [WarpActionInput],
    isArray: true,
    required: false,
  })
  inputs?: WarpActionInput[];

  @ApiProperty({
    description: 'Description of the query',
    example: 'Query the balance of an address',
    nullable: true,
    required: false,
  })
  description?: string | null;
}

export class WarpCollectAction {
  @ApiProperty({
    description: 'Type of action',
    enum: WarpActionType,
    example: WarpActionType.Collect,
  })
  type: WarpActionType.Collect;

  @ApiProperty({
    description: 'Text displayed on the action button',
    example: 'Collect Data',
  })
  label: string;

  @ApiProperty({
    description: 'Destination details for data collection',
    example: {
      url: 'https://api.example.com/collect',
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
    },
  })
  destination: {
    url: string;
    method: 'GET' | 'POST';
    headers: Record<string, string>;
  };

  @ApiProperty({
    description: 'User-defined inputs to be collected',
    type: [WarpActionInput],
    isArray: true,
    required: false,
  })
  inputs?: WarpActionInput[];

  @ApiProperty({
    description: 'Description of the collection action',
    example: 'Collect user information',
    nullable: true,
    required: false,
  })
  description?: string | null;

  @ApiProperty({
    description: 'Next action or URL for redirect',
    example: 'https://next.warp',
    required: false,
  })
  next?: string;
}

export class WarpLinkAction {
  @ApiProperty({
    description: 'Type of action',
    enum: WarpActionType,
    example: WarpActionType.Link,
  })
  type: WarpActionType.Link;

  @ApiProperty({
    description: 'Text displayed on the action button',
    example: 'Visit Website',
  })
  label: string;

  @ApiProperty({
    description: 'URL to link to',
    example: 'https://example.com',
  })
  url: string;

  @ApiProperty({
    description: 'User-defined inputs',
    type: [WarpActionInput],
    isArray: true,
    required: false,
  })
  inputs?: WarpActionInput[];

  @ApiProperty({
    description: 'Description of the link',
    example: 'Go to the documentation',
    nullable: true,
    required: false,
  })
  description?: string | null;
}

export interface WarpMeta {
  hash: string;
  creator: string;
  createdAt: string;
}

export type WarpAction =
  | WarpContractAction
  | WarpQueryAction
  | WarpCollectAction
  | WarpLinkAction;

export class Warp {
  @ApiProperty({
    description: 'Specifies the protocol and version of the warp',
    example: 'warp:0.4.0',
  })
  protocol: string;

  @ApiProperty({
    description: 'Identifies the Warp, used in public galleries',
    example: 'my-warp',
  })
  name: string;

  @ApiProperty({
    description: 'The title of the warp, displayed to the user',
    example: 'My Warp Title',
  })
  title: string;

  @ApiProperty({
    description:
      'A brief description of the warp, providing context to the user',
    example: 'This warp performs various actions using specified protocols.',
  })
  description: string | null;

  @ApiProperty({
    description: 'URL to a preview image',
    example: 'https://picsum.photos/200',
  })
  preview: string;

  @ApiProperty({
    description: 'An array of actions that can be performed by the warp',
    example: '[{ type: "Collect", label: "Collect Data", ... }]',
    isArray: true,
  })
  actions: WarpAction[];

  @ApiProperty({
    description: 'Metadata related to the warp',
    example: '{ hash: "abc123", creator: "user123", createdAt: "2023-01-01" }',
  })
  meta?: WarpMeta;

  @ApiProperty({
    description:
      'Describes the overall purpose of the Warp in a way that AI systems can interpret',
    example: 'This Warp performs various actions using specified protocols.',
  })
  bot?: string;
  @ApiProperty({
    description:
      'Specifies a follow-up action that can be another warp or URL for the redirect',
    example: 'https://warp.example.com/warp',
  })
  next?: string;

  @ApiProperty({
    description: 'A dictionary of variables that can be used within the warp',
    example: '{ "variable1": "value1", "variable2": "value2" }',
  })
  vars?: Record<string, string>;
}

export const WARP_PROTOCOL_VERSION = 'warp:0.4.0';
export const DEFAULT_GAS_LIMIT = 60000000;
export const WARP_TYPE_MAPPINGS: Record<string, string> = {
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
