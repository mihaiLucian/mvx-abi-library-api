import { Injectable, NotFoundException } from '@nestjs/common';
import { AbiWarpGenerator } from './helpers/abi-warp-generator';
import { GenerateWarpRequestDto } from './dtos/generate-warp-request.dto';
import { Warp } from './dtos/warp.dto';
import { CosmosDbService } from 'src/common/cosmos-db/cosmos-db.service';
import { GoogleAiService } from 'src/common/google-ai/google-ai.service';
import { AbiDefinition } from './types/abi.types';
import { PromptGenerator } from 'src/common/ai-prompt/prompt-generator';
import { AIPromptTemplateName } from 'src/common/ai-prompt/prompt-templates';
import { HttpService } from 'src/common/http/http.service';
import { GenericUtils } from 'src/utils/generic.utils';
import {
  CosmosDbQueryBuilder,
  QueryConditionOperator,
} from 'src/common/cosmos-db/cosmos-db-query';
import {
  SmartContractDoc,
  SmartContractLibraryDto,
} from './dtos/contract-details.dto';

@Injectable()
export class AbiService {
  constructor(
    private readonly cosmosDbService: CosmosDbService,
    private readonly googleAiService: GoogleAiService,
    private readonly httpService: HttpService,
  ) {}

  generateWarps(requestBody: GenerateWarpRequestDto): Warp[] {
    const warpGenerator = new AbiWarpGenerator(
      requestBody.creator,
      requestBody.abiJson,
    );

    return warpGenerator.generateWarps(requestBody.contractAddress);
  }

  async generateWarpsForContract(
    address: string,
    creator?: string,
  ): Promise<Warp[]> {
    const id = `sc_${address}`;
    const resources = await this.cosmosDbService.readItem<SmartContractDoc>(
      id,
      address,
    );

    if (!resources) {
      throw new NotFoundException(
        `Smart contract with address ${address} not found`,
      );
    }

    const abiJson = resources.abiJson;
    const warpGenerator = new AbiWarpGenerator(creator, abiJson);

    return warpGenerator.generateWarps(address);
  }

  async enrichAbiDefinition(requestBody: GenerateWarpRequestDto) {
    const simplifiedAbi: AbiDefinition = {
      name: requestBody.abiJson.name,
      endpoints: requestBody.abiJson.endpoints,
    };

    const prompt = PromptGenerator.renderTemplate(
      AIPromptTemplateName.ABI_DOC_ENRICHER,
      {
        ABI_JSON: JSON.stringify(simplifiedAbi),
        CONTRACT_DESCRIPTION:
          'NFT Staking allows users to stake their NFTs and earn rewards. Creators are able to create and manage their own staking pools',
        CONTRACT_NAME: 'XOXNO: NFT Staking',
      },
    );

    const aiResponse = await this.googleAiService.chatCompletion(prompt);
    const aiResponseParsed = this.extractMarkdownJson(aiResponse.text);

    requestBody.abiJson.endpoints.forEach((endpoint) => {
      if (aiResponseParsed[endpoint.name]) {
        endpoint.docs = [aiResponseParsed[endpoint.name]];
      }
      if (endpoint.docs?.length) {
        endpoint.docs = endpoint.docs.map((doc) => doc.trim());
      }
    });

    return requestBody;
  }

  extractMarkdownJson(content: string): any {
    try {
      // Check if content is wrapped in markdown JSON code block
      if (content.startsWith('```json\n') && content.endsWith('```\n')) {
        // Extract content between markers
        // 8 = length of "```json\n", 4 = length of "\n```"
        const cleanResponse = content.slice(8, -4).trim();

        // Parse and return the JSON
        return JSON.parse(cleanResponse);
      }

      // Return null if content doesn't match expected format
      return null;
    } catch (error) {
      throw new Error('Failed to parse JSON from content');
    }
  }

  async getAllVerifiedContracts() {
    const allContracts = await this.httpService.get<any[]>(
      'https://api.multiversx.com/accounts?from=0&size=10000&isSmartContract=true&withOwnerAssets=true&sort=transfersLast24h&order=desc',
    );

    console.log(allContracts.length);

    const allVerified = allContracts.filter(
      (contract) =>
        // contract.isVerified &&
        !(
          contract?.assets?.name.includes('xExchange') &&
          contract?.assets?.name.includes('Pool')
        ) &&
        !(
          contract?.assets?.name.includes('xExchange') &&
          contract?.assets?.name.includes('Farm')
        ),
    );

    const allVerifiedWithAbi: any[] = [];
    for (let i = 0; i < allVerified.length; i++) {
      const contract = allVerified[i];
      console.log(
        `Fetching ABI for contract ${i + 1} of ${allVerified.length}: ${contract.address}`,
      );
      try {
        const abiResponse = await this.httpService.get<any>(
          `https://play-api.multiversx.com/verifier/${contract.address}`,
          {
            retry: 0,
            retryDelay: 1000,
          },
        );
        const abiJson = abiResponse.source.abi;

        if (abiJson) {
          const simplifiedAbi: AbiDefinition = {
            name: contract?.assets?.name ?? abiJson.name,
            endpoints: abiJson.endpoints,
          };

          const prompt = PromptGenerator.renderTemplate(
            AIPromptTemplateName.ABI_DOC_ENRICHER,
            {
              ABI_JSON: JSON.stringify(simplifiedAbi),
              CONTRACT_DESCRIPTION: contract?.assets?.description,
              CONTRACT_NAME: contract?.assets?.name,
            },
          );

          const aiResponse = await this.googleAiService.chatCompletion(prompt);
          const aiResponseParsed = this.extractMarkdownJson(aiResponse.text);

          abiJson.endpoints.forEach((endpoint) => {
            if (aiResponseParsed[endpoint.name]) {
              endpoint.docs = [aiResponseParsed[endpoint.name]];
            }
            if (endpoint.docs?.length) {
              endpoint.docs = endpoint.docs.map((doc) => doc.trim());
            }
          });

          const dbDocument = {
            dataType: 'sc-info',
            address: contract.address,
            name: contract?.assets?.name ?? abiJson.name,
            description: contract?.assets?.description,
            ownerAddress: contract?.ownerAddress,
            abiJson,
            codeHash: abiResponse.codeHash,
            id: `sc_${contract.address}`,
            tags: contract?.assets?.tags,
            pk: contract.address,
          };

          await this.cosmosDbService.upsertItem(dbDocument);

          allVerifiedWithAbi.push(dbDocument);
        }

        await GenericUtils.sleep(1000);
      } catch (error) {
        console.error(
          `Failed to fetch ABI for contract ${i + 1} of ${allVerified.length}: ${contract.address}`,
          error,
        );
        continue;
      }
    }

    return allVerifiedWithAbi;
  }

  async getContractByAddress(address: string) {
    const id = `sc_${address}`;
    const resources = await this.cosmosDbService.readItem<any>(id, address);

    if (!resources) {
      throw new Error(`No resources found for contract address: ${address}`);
    }

    return resources as SmartContractDoc;
  }

  async getContracts() {
    const querySpec = new CosmosDbQueryBuilder()
      .where('dataType', 'sc-info', QueryConditionOperator.EQUAL)
      .selectFields(['name', 'description', 'address', 'ownerAddress'])
      .buildSqlQuery();

    const resources =
      await this.cosmosDbService.queryWithFetchAll<any>(querySpec);

    return resources as SmartContractLibraryDto[];
  }
}
