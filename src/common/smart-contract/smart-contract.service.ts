export interface SmartContractArg {
  type: string;
  value: string;
}

export interface AbiEndpoint {
  name: string;
  outputs: Array<{
    type: string;
  }>;
}

export interface QueryBody {
  scAddress: string;
  funcName: string;
  value: string;
  args: string[];
}

export interface QueryResponse {
  data: {
    data: {
      returnCode: string;
      returnMessage: string;
      returnData: string[];
    };
  };
  error?: string;
}

import { Injectable, HttpException, HttpStatus } from '@nestjs/common';
import { HttpService } from '@nestjs/axios';
import { firstValueFrom } from 'rxjs';
import { Address } from '@multiversx/sdk-core';
import { AbiTypeConverter } from 'src/features/abi/helpers/abi-type-converter';

@Injectable()
export class SmartContractService {
  private readonly proxyUrl: string;
  private readonly sizePerType: Record<string, number>;

  constructor(private readonly httpService: HttpService) {
    this.proxyUrl = 'https://gateway.multiversx.com';
    this.sizePerType = {
      i8: 1,
      i16: 2,
      i32: 4,
      i64: 8,
      i128: 16,
      u8: 1,
      u16: 2,
      u32: 4,
      u64: 8,
      u128: 16,
    };
  }

  /**
   * Convert an integer to a hexadecimal string
   */
  private intToHex(number: number | string): string {
    const hexValue = Number(number).toString(16);
    return hexValue.length % 2 ? '0' + hexValue : hexValue;
  }

  /**
   * Convert arguments to their hexadecimal representation
   */
  private convertArgs(args: SmartContractArg[]): string[] {
    const argsOutput: string[] = [];

    for (const arg of args) {
      try {
        let type = arg.type.replace(/^variadic<(.+)>$/, '$1');
        type = type.includes('<') ? (type.match(/<(.+)>/)?.[1] ?? type) : type;

        const values = arg.value.split(',');

        for (const value of values) {
          if (Object.keys(this.sizePerType).includes(type)) {
            argsOutput.push(this.intToHex(value));
          } else if (type === 'Address') {
            argsOutput.push(Address.fromBech32(value).hex());
          } else {
            argsOutput.push(Buffer.from(value, 'ascii').toString('hex'));
          }
        }
      } catch (error) {
        console.error('Error converting argument:', error);
      }
    }

    return argsOutput;
  }

  /**
   * Decode return data from base64 to bytes
   */
  private decodeReturnData(data: string[] | null): Buffer[] | null {
    if (!data) return null;

    return data.map((item) =>
      Buffer.from(Buffer.from(item, 'base64').toString('hex'), 'hex'),
    );
  }

  /**
   * Query a smart contract
   */
  async querySC(
    endpoint: string,
    scAddress: string,
    args: SmartContractArg[] = [],
  ): Promise<[number, string | string[]]> {
    const convertedArgs = this.convertArgs(args);

    const body: QueryBody = {
      scAddress,
      funcName: endpoint,
      value: '0',
      args: convertedArgs,
    };

    try {
      const response = await firstValueFrom(
        this.httpService.post<QueryResponse>(
          `${this.proxyUrl}/vm-values/query`,
          body,
        ),
      );

      const responseData = response.data;

      if (response.status !== HttpStatus.OK) {
        throw new HttpException(
          responseData.error ?? 'Unknown error',
          response.status,
        );
      }

      const returnData = responseData.data.data;

      if (returnData.returnCode !== 'ok') {
        throw new HttpException(
          returnData.returnMessage,
          HttpStatus.BAD_REQUEST,
        );
      }

      // Handle timeout case
      if (
        responseData.error ===
        "'executeQuery: executeQuery: execution failed with timeout'"
      ) {
        console.log('Retrying due to timeout...');
        return this.querySC(endpoint, scAddress, args);
      }

      return [HttpStatus.OK, returnData.returnData];
    } catch (error) {
      if (error instanceof HttpException) {
        throw error;
      }
      throw new HttpException(
        'Request timed out',
        HttpStatus.INTERNAL_SERVER_ERROR,
      );
    }
  }

  /**
   * Parse ABI and query a smart contract
   */
  async parseAbi(
    scAddress: string,
    func: string,
    endpoints: AbiEndpoint[],
    abiJson: any,
    args: SmartContractArg[] = [],
  ): Promise<[number, any]> {
    const endpointData = endpoints.find((d) => d.name === func);

    if (!endpointData) {
      return [HttpStatus.NOT_FOUND, null];
    }

    const [status, answer] = await this.querySC(func, scAddress, args);

    if (status !== HttpStatus.OK) {
      return [status, answer];
    }

    const decodedAnswer = this.decodeReturnData(answer as string[]);

    if (!decodedAnswer) {
      return [HttpStatus.OK, null];
    }

    try {
      const abiTypeParser = new AbiTypeConverter(abiJson);
      const responseType = endpointData.outputs[0].type;
      const parsedData = abiTypeParser.parseHexResponse(
        decodedAnswer,
        responseType,
      );

      if (!parsedData) {
        throw new Error('Parsed data is null or undefined.');
      }

      return [HttpStatus.OK, parsedData];
    } catch (error) {
      console.error('Error parsing ABI:', error);
      return [
        HttpStatus.INTERNAL_SERVER_ERROR,
        error instanceof Error ? error.message : 'Unknown error',
      ];
    }
  }
}
