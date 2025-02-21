import { ApiProperty } from '@nestjs/swagger';

export class RangeFilter {
  @ApiProperty({ required: false, type: 'number' })
  min?: number;

  @ApiProperty({ required: false, type: 'number' })
  max?: number;

  @ApiProperty({ required: false, type: 'string' })
  field?: string;
}

export class CosmosDbQueryFilter {
  filters: Record<
    string,
    object | boolean | string | string[] | number | number[] | RangeFilter[]
  > = {};
  @ApiProperty({
    type: 'array',
    items: { type: 'string' },
    required: false,
    default: [],
  })
  select?: string[] = [];
  @ApiProperty({
    type: 'array',
    items: { type: 'string' },
    required: false,
    default: [],
  })
  orderBy?: string[] = [];

  @ApiProperty({ required: false, type: 'boolean' })
  includeCount?: boolean;

  @ApiProperty({ required: false, type: 'boolean', default: false })
  strictSelect?: boolean = false;

  @ApiProperty({ required: false, type: 'number', default: 25 })
  top?: number = 25;
  @ApiProperty({ required: false, type: 'number', default: 0 })
  skip?: number = 0;

  constructor(props?: Partial<CosmosDbQueryFilter>) {
    Object.assign(this, props);
  }
}
