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
import { AzureSearchService } from 'src/common/azure-search/azure-search.service';
import { AzureOpenaiService } from 'src/common/azure-openai/azure-openai.service';
import { AbiParser } from './helpers/abi-parser';

@Injectable()
export class AbiService {
  constructor(
    private readonly httpService: HttpService,
    private readonly azureOpenAiService: AzureOpenaiService,
    private readonly googleAiService: GoogleAiService,
    private readonly cosmosDbService: CosmosDbService,
    private readonly azureSearchService: AzureSearchService,
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

  async enrichAbiDefinition(
    requestBody: GenerateWarpRequestDto,
    description: string,
    name: string,
  ) {
    const simplifiedAbi: AbiDefinition = {
      name: requestBody.abiJson.name,
      endpoints: requestBody.abiJson.endpoints,
    };

    const prompt = PromptGenerator.renderTemplate(
      AIPromptTemplateName.ABI_DOC_ENRICHER,
      {
        ABI_JSON: JSON.stringify(simplifiedAbi),
        CONTRACT_DESCRIPTION: description,
        CONTRACT_NAME: name,
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

    // know template contracts:
    // - xExchange: Pool
    // - xExchange: Farm
    // - xExchange: name contains MetaStaked
    // - xLaunchpad: name starts with xLaunchpad
    // erd1qqqqqqqqqqqqqpgqpa3pdmemt5l2ex80g7pksr2ettt955d66avsz76hyt
    //

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

  async addContractManually(
    abiJson: AbiDefinition,
    name: string,
    description: string,
    address: string,
  ) {
    if (abiJson) {
      const simplifiedAbi: AbiDefinition = {
        name: name,
        endpoints: abiJson.endpoints,
      };

      const prompt = PromptGenerator.renderTemplate(
        AIPromptTemplateName.ABI_DOC_ENRICHER,
        {
          ABI_JSON: JSON.stringify(simplifiedAbi),
          CONTRACT_DESCRIPTION: description,
          CONTRACT_NAME: name,
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
        address: address,
        name,
        description,
        abiJson,
        codeHash: '',
        id: `sc_${address}`,
        // tags: contract?.assets?.tags,
        pk: address,
      };

      await this.cosmosDbService.upsertItem(dbDocument);

      return dbDocument as any;
    } else {
      throw new Error('Failed to fetch ABI JSON');
    }
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

  async generateAndIngestEmbeddings(
    contractDoc: SmartContractDoc,
    endpointsToKeep: string[] = [],
  ) {
    const parsedData: any[] = [];
    for (const endpoint of contractDoc.abiJson.endpoints) {
      if (endpointsToKeep.length && !endpointsToKeep.includes(endpoint.name)) {
        continue;
      }
      if (endpoint.docs.length) {
        const embeddingResponse =
          await this.azureOpenAiService.generateEmbedding(endpoint.docs[0]);

        parsedData.push({
          name: endpoint.name,
          description: endpoint.docs[0],
          type: 'endpoint',
          id: `${contractDoc.address}_${endpoint.name}`,
          embeddings: embeddingResponse[0].embedding,
        });
      }
    }

    await this.azureSearchService.mergeOrUploadDocuments(parsedData);

    return parsedData;
  }

  async test() {
    const abi = new AbiParser({
      buildInfo: {
        rustc: {
          version: '1.85.0-nightly',
          commitHash: '7442931d49b199ad0a1cc0f8ca54e327b5139b66',
          commitDate: '2024-11-30',
          channel: 'Nightly',
          short: 'rustc 1.85.0-nightly (7442931d4 2024-11-30)',
        },
        contractCrate: {
          name: 'controller',
          version: '0.0.0',
          gitVersion: 'rv-audit-2-223-g6977c00',
        },
        framework: {
          name: 'multiversx-sc',
          version: '0.53.2',
        },
      },
      docs: [
        'Controller Smart Contract',
        '',
        'Handles the control (i.e. checks) for virtually all interactions with the protocol.',
        '',
      ],
      name: 'Controller',
      constructor: {
        docs: [
          'Initializes the contract with an optional admin address.',
          '',
          '# Arguments:',
          '',
          '- `opt_admin` - An optional admin address for the contract.',
          '',
          'Notes:',
          '',
          '- If the contract is being deployed for the first time, the admin address will be set.',
          '- If the admin address is not provided, the admin will be set as the deployer.',
          '- If the contract is being upgraded, the admin address will not be overwritten.',
          '',
        ],
        inputs: [
          {
            name: 'opt_admin',
            type: 'optional<Address>',
            multi_arg: true,
          },
        ],
        outputs: [],
      },
      upgradeConstructor: {
        inputs: [],
        outputs: [],
      },
      endpoints: [
        {
          docs: ['Returns the current admin address.', ''],
          name: 'getAdmin',
          mutability: 'readonly',
          inputs: [],
          outputs: [
            {
              type: 'Address',
            },
          ],
        },
        {
          docs: [
            'Returns the current pending admin address, if there is one.',
            '',
          ],
          name: 'getPendingAdmin',
          mutability: 'readonly',
          inputs: [],
          outputs: [
            {
              type: 'Option<Address>',
            },
          ],
        },
        {
          docs: [
            'Sets the pending admin address to the given address.',
            '',
            '# Arguments:',
            '',
            '- `new_pending_admin` - The new pending admin address.',
            '',
          ],
          name: 'setPendingAdmin',
          mutability: 'mutable',
          inputs: [
            {
              name: 'pending_admin',
              type: 'Address',
            },
          ],
          outputs: [],
        },
        {
          docs: [
            'Attempts to accept the pending admin, which must be set first using the `set_pending_admin` endpoint.',
          ],
          name: 'acceptAdmin',
          mutability: 'mutable',
          inputs: [],
          outputs: [],
        },
        {
          docs: [
            'Incorporates a money market in a list of accepted money markets (a whitelist). This action will add support for the',
            'provided money market.',
            '',
            '# Arguments:',
            '',
            '- `money_market` - The address of the money market smart contract.',
            '',
            '# Notes:',
            '',
            '- Can only be called by the admin.',
            '- The provided address must be a valid money market smart contract.',
            '- The money market should not has already been supported in the past.',
            '',
          ],
          name: 'supportMarket',
          mutability: 'mutable',
          inputs: [
            {
              name: 'money_market',
              type: 'Address',
            },
          ],
          outputs: [],
        },
        {
          docs: [
            'Sets the maximum number of money markets that can be entered per account.',
            '',
            '# Arguments:',
            '',
            '- `new_max_markets_per_account` - The new maximum number of money markets that can be entered per account.',
            '',
            '# Notes:',
            '',
            '- Can only be called by the admin.',
            '- Must be higher than the current maximum.',
            '',
          ],
          name: 'setMaxMarketsPerAccount',
          mutability: 'mutable',
          inputs: [
            {
              name: 'new_max_markets_per_account',
              type: 'u32',
            },
          ],
          outputs: [],
        },
        {
          docs: [
            'Sets the collateral factors or loan to values for a given money market.',
            '',
            '# Arguments:',
            '',
            '- `money_market` - The address of the money market smart contract.',
            '- `new_cf` - The new collateral factor in wad.',
            '- `new_uf` - The new USH borrower collateral factor in wad.',
            '',
            '# Notes:',
            '',
            '- Can only be called by the admin.',
            '- The provided market must be a whitelisted money market.',
            '- The new collateral factors must not exceed their maximum allowed.',
            '- The new collateral factor cannot be lower than the previous one by more than the maximum allowed decrease.',
            '- The USH borrower collateral factor cannot exceed the collateral factor at any time.',
            '- A collateral factor of zero should be configured when a market is deprecated.',
            '',
          ],
          name: 'setCollateralFactors',
          mutability: 'mutable',
          inputs: [
            {
              name: 'money_market',
              type: 'Address',
            },
            {
              name: 'new_cf',
              type: 'BigUint',
            },
            {
              name: 'new_uf',
              type: 'BigUint',
            },
          ],
          outputs: [],
        },
        {
          docs: [
            'Sets the pricing Oracle smart contract address.',
            '',
            '# Arguments:',
            '',
            '- `new_price_oracle` - The address of the pricing oracle smart contract.',
            '',
            '# Notes:',
            '',
            '- Can only be called by the admin.',
            '- The provided address must be a valid oracle smart contract.',
            '',
          ],
          name: 'setPriceOracle',
          mutability: 'mutable',
          inputs: [
            {
              name: 'new_price_oracle',
              type: 'Address',
            },
          ],
          outputs: [],
        },
        {
          docs: [
            'Sets a liquidity cap for a given money market.',
            '',
            '# Arguments:',
            '',
            '- `money_market` - The address of the money market smart contract.',
            '- `new_liquidity_cap` - The new liquidity cap in wad.',
            '',
            '# Notes:',
            '',
            '- Can only be called by the admin.',
            '- The provided address must be a whitelisted money market.',
            '',
          ],
          name: 'setLiquidityCap',
          mutability: 'mutable',
          inputs: [
            {
              name: 'money_market',
              type: 'Address',
            },
            {
              name: 'new_liquidity_cap',
              type: 'BigUint',
            },
          ],
          outputs: [],
        },
        {
          docs: [
            'Sets a borrow cap for a given money market.',
            '',
            '# Arguments:',
            '',
            '- `money_market` - The address of the money market smart contract.',
            '- `new_borrow_cap` - The new borrow cap in wad.',
            '',
            '# Notes:',
            '',
            '- Can only be called by the admin.',
            '- The provided address must be a whitelisted money market.',
            '',
          ],
          name: 'setBorrowCap',
          mutability: 'mutable',
          inputs: [
            {
              name: 'money_market',
              type: 'Address',
            },
            {
              name: 'new_borrow_cap',
              type: 'BigUint',
            },
          ],
          outputs: [],
        },
        {
          docs: [
            'Sets the maximum amount of rewards batches per money market.',
            '',
            '# Arguments:',
            '',
            '- `money_market` - The address of the money market smart contract.',
            '- `new_max_rewards_batches` - The new maximum amount of rewards batches.',
            '',
            '# Notes:',
            '',
            '- Can only be called by the admin.',
            '- The provided address must be a whitelisted money market.',
            '',
          ],
          name: 'setMaxRewardsBatches',
          mutability: 'mutable',
          inputs: [
            {
              name: 'money_market',
              type: 'Address',
            },
            {
              name: 'new_max_rewards_batches',
              type: 'u32',
            },
          ],
          outputs: [],
        },
        {
          docs: [
            'Sets the maximum slippage allowed for configuration swaps.',
            '',
            '# Arguments:',
            '',
            '- `new_max_slippage` - The new maximum slippage allowed.',
            '',
            '# Notes:',
            '',
            '- Can only be called by the admin.',
            '',
          ],
          name: 'setMaxSlippage',
          mutability: 'mutable',
          inputs: [
            {
              name: 'new_max_slippage',
              type: 'BigUint',
            },
          ],
          outputs: [],
        },
        {
          docs: [
            'Adds a rewards batch to the specified money market. EGLD or ESDT tokens are supported.',
            '',
            '# Arguments:',
            '',
            '- `money_market` - The address of the money market smart contract.',
            '- `market_type` - Distribute rewards for suppliers (`Supply`) or lenders (`Borrows`).',
            '- `period` - The period of time in seconds in which rewards are distributed.',
            '',
            '# Notes:',
            '',
            '- Can only be called by the admin or rewards manager.',
            '- The provided address must be whitelisted money market.',
            '- Should be paid with the rewards token.',
            '',
          ],
          name: 'setRewardsBatch',
          mutability: 'mutable',
          payableInTokens: ['*'],
          inputs: [
            {
              name: 'money_market',
              type: 'Address',
            },
            {
              name: 'market_type',
              type: 'MarketType',
            },
            {
              name: 'period',
              type: 'u64',
            },
          ],
          outputs: [
            {
              type: 'u32',
            },
          ],
        },
        {
          docs: [
            'Adds an amount of reward token to an existing rewards batch maintaining the same speed.',
            '',
            '# Arguments:',
            '',
            '- `money_market` - The address of the money market smart contract.',
            '- `batch_id` - the rewards batch identifier',
            '',
            '# Notes:',
            '',
            '- Can only be called by the admin or rewards manager.',
            '',
          ],
          name: 'addRewardsBatch',
          mutability: 'mutable',
          payableInTokens: ['*'],
          inputs: [
            {
              name: 'money_market',
              type: 'Address',
            },
            {
              name: 'batch_id',
              type: 'u32',
            },
          ],
          outputs: [],
        },
        {
          docs: [
            'Cancel a specified rewards batch. Remaining tokens are sent back to a beneficiary.',
            '',
            '# Arguments:',
            '',
            '- `money_market` - the address of the money market smart contract.',
            '- `batch_id` - the rewards batch identifier',
            '- `opt_to` - the beneficiary address for the remaining tokens (optional)',
            '',
            '# Notes:',
            '',
            '- Can only be called by the admin or rewards manager.',
            '- The caller is selected if no beneficiary is given.',
            '',
          ],
          name: 'cancelRewardsBatch',
          mutability: 'mutable',
          inputs: [
            {
              name: 'money_market',
              type: 'Address',
            },
            {
              name: 'batch_id',
              type: 'u32',
            },
            {
              name: 'opt_to',
              type: 'optional<Address>',
              multi_arg: true,
            },
          ],
          outputs: [],
        },
        {
          docs: [
            'Removes a specified rewards batch from the array of rewards batches iff it has been fully distributed.',
            '',
            '# Arguments',
            '',
            '- `money_market` - the address of the money market smart contract.',
            '- `batch_id` - the rewards batch identifier',
            '',
            '# Notes',
            '',
            '- can be called by anyone',
            '- takes into consideration possible rounding errors but it is conservative',
            '',
          ],
          name: 'removeRewardsBatch',
          mutability: 'mutable',
          inputs: [
            {
              name: 'money_market',
              type: 'Address',
            },
            {
              name: 'batch_id',
              type: 'u32',
            },
          ],
          outputs: [],
        },
        {
          docs: [
            'Removes a specified rewards batch from the array of rewards batches iff it has been fully distributed within a given',
            'tolerance amount.',
            '',
            '# Arguments',
            '',
            '- `money_market` - the address of the money market smart contract.',
            '- `batch_id` - the rewards batch identifier',
            '- `tolerance` - the tolerance in wad, such that 1 wad = 100%.',
            '',
            '# Notes',
            '',
            '- can only be called by the admin or rewards manager.',
            '',
          ],
          name: 'adminRemoveRewardsBatch',
          mutability: 'mutable',
          inputs: [
            {
              name: 'money_market',
              type: 'Address',
            },
            {
              name: 'batch_id',
              type: 'u32',
            },
            {
              name: 'tolerance',
              type: 'BigUint',
            },
          ],
          outputs: [],
        },
        {
          docs: [
            'Updates a given rewards batch based on a new speed. The new speed of rewards also changes the remaining distribution',
            'time period.',
            '',
            '',
            '# Arguments:',
            '',
            '- `money_market` - the address of the money market smart contract.',
            '- `batch_id` - The rewards batch identifier.',
            '- `new_speed` - The new speed of rewards in wad.',
            '',
            '# Notes:',
            '',
            '- Can only be called by the admin or rewards manager.',
            '',
          ],
          name: 'updateRewardsBatchSpeed',
          mutability: 'mutable',
          inputs: [
            {
              name: 'money_market',
              type: 'Address',
            },
            {
              name: 'batch_id',
              type: 'u32',
            },
            {
              name: 'new_speed',
              type: 'BigUint',
            },
          ],
          outputs: [],
        },
        {
          docs: [
            'Updates a given rewards batch based on a new period. The new period also changes the speed of rewards.',
            '',
            '',
            '# Arguments:',
            '',
            '- `money_market` - the address of the money market smart contract.',
            '- `batch_id` - The rewards batch identifier.',
            '- `new_dt` - The new period.',
            '',
            '# Notes:',
            '',
            '- Can only be called by the admin or rewards manager.',
            '',
          ],
          name: 'updateRewardsBatchRemainingPeriod',
          mutability: 'mutable',
          inputs: [
            {
              name: 'money_market',
              type: 'Address',
            },
            {
              name: 'batch_id',
              type: 'u32',
            },
            {
              name: 'new_dt',
              type: 'u64',
            },
          ],
          outputs: [],
        },
        {
          docs: [
            'Claims the undistributed rewards for a given rewards token.',
            '',
            '# Arguments:',
            '',
            '- `rewards_token_id` - the rewards token identifier',
            '',
            '# Notes:',
            '',
            '- Can only be called by the admin.',
            '- The rewards token must have undistributed rewards.',
            '- Undistributed rewards might originate at markets without collateral or borrows, or because of truncation errors.',
            '',
          ],
          name: 'claimUndistributedRewards',
          mutability: 'mutable',
          inputs: [
            {
              name: 'rewards_token_id',
              type: 'EgldOrEsdtTokenIdentifier',
            },
          ],
          outputs: [],
        },
        {
          docs: [
            "Adds support for boosting rewards batches by converting the rewards batch tokens into Hatom's governance tokens with",
            'a premium.',
            '',
            '# Arguments:',
            '',
            '- `governance_token_id` - the governance token identifier',
            '- `egld_wrapper` - the address of the EGLD wrapper smart contract',
            '- `router` - the address of the router smart contract',
            '',
            '# Notes:',
            '',
            '- Can only be called by the admin.',
            '',
          ],
          name: 'supportRewardsBatchBoosting',
          mutability: 'mutable',
          inputs: [
            {
              name: 'governance_token_id',
              type: 'TokenIdentifier',
            },
            {
              name: 'egld_wrapper',
              type: 'Address',
            },
            {
              name: 'router',
              type: 'Address',
            },
          ],
          outputs: [],
        },
        {
          docs: [
            'Enables support for boosting rewards batches.',
            '',
            '# Notes:',
            '',
            '- Can only be called by the admin.',
            '',
          ],
          name: 'enableRewardsBatchBoosting',
          mutability: 'mutable',
          inputs: [],
          outputs: [],
        },
        {
          docs: [
            'Disables support for boosting rewards batches.',
            '',
            '# Notes:',
            '',
            '- Can only be called by the admin.',
            '',
          ],
          name: 'disableRewardsBatchBoosting',
          mutability: 'mutable',
          inputs: [],
          outputs: [],
        },
        {
          docs: [
            "Boosts the rewards of a given rewards token by converting the rewards tokens into Hatom's governance token with a",
            'premium.',
            '',
            '# Arguments:',
            '',
            '- `premium` - the premium in wad, such that 1 wad = 100%.',
            '- `fwd_swap_amount` - the amount of tokens to swap.',
            "- `fwd_swap_path` - the swap path to convert the rewards batch tokens into Hatom's governance tokens.",
            '',
            '# Notes:',
            '',
            '- Can only be called by the admin or rewards manager.',
            '- If rewards token is EGLD, swaps will add a EGLD => WEGLD step first. Also, the swap path needs to use the WEGLD',
            '  token identifier.',
            '',
          ],
          name: 'boostRewards',
          mutability: 'mutable',
          payableInTokens: ['*'],
          inputs: [
            {
              name: 'premium',
              type: 'BigUint',
            },
            {
              name: 'fwd_swap_amount',
              type: 'BigUint',
            },
            {
              name: 'fwd_swap_path',
              type: 'List<SwapStep>',
            },
          ],
          outputs: [],
        },
        {
          docs: [
            "Updates the premium of a given booster and, if a payment is provided, adds it to the booster's amount.",
            '',
            '# Arguments:',
            '',
            '- `rewards_token_id` - the rewards token identifier for which we wish to update its booster.',
            '- `premium` - the premium in wad, such that 1 wad = 100%.',
            '',
            '# Notes:',
            '',
            '- Can only be called by the admin or rewards manager.',
            '- Cannot change the swap path. That requires canceling the booster and creating a new one.',
            '',
          ],
          name: 'updateBooster',
          mutability: 'mutable',
          payableInTokens: ['*'],
          inputs: [
            {
              name: 'rewards_token_id',
              type: 'EgldOrEsdtTokenIdentifier',
            },
            {
              name: 'premium',
              type: 'BigUint',
            },
          ],
          outputs: [],
        },
        {
          docs: [
            'Cancels a given booster and sends the remaining tokens back to the caller.',
            '',
            '# Arguments:',
            '',
            '- `rewards_token_id` - the rewards token identifier for which we wish to cancel its booster.',
            '- `opt_to` - the beneficiary address for the remaining tokens (optional).',
            '',
            '# Notes:',
            '',
            '- Can only be called by the admin or rewards manager.',
            '',
          ],
          name: 'cancelBooster',
          mutability: 'mutable',
          inputs: [
            {
              name: 'rewards_token_id',
              type: 'EgldOrEsdtTokenIdentifier',
            },
            {
              name: 'opt_to',
              type: 'optional<Address>',
              multi_arg: true,
            },
          ],
          outputs: [],
        },
        {
          docs: [
            'Updates the collateral or account tokens of a given account in a given money market, which is useful at liquidations.',
            'The general idea is that the account is removing collateral, which should update the total collateral tokens and the',
            "account's collateral tokens.",
            '',
            '# Arguments:',
            '',
            '- `money_market` - The address of the money market smart contract.',
            '- `account` - The address of the account we wish to update.',
            "- `tokens` - The number of Hatom's tokens to set as collateral.",
            '',
            '# Notes:',
            '',
            '- Can only be called by a whitelisted money market.',
            '- The provided address must be a whitelisted money market.',
            '- Makes sure the mappers `account_markets` and `market_members` remain updated.',
            '',
          ],
          name: 'setAccountTokens',
          mutability: 'mutable',
          inputs: [
            {
              name: 'money_market',
              type: 'Address',
            },
            {
              name: 'account',
              type: 'Address',
            },
            {
              name: 'new_tokens',
              type: 'BigUint',
            },
          ],
          outputs: [],
        },
        {
          docs: [
            'Sets the Rewards Manager of the protocol.',
            '',
            '# Arguments:',
            '',
            '- `new_rewards_manager` - The address of the new Rewards Manager.',
            '',
            '# Notes:',
            '',
            '- Can only be called by the admin.',
            '',
          ],
          name: 'setRewardsManager',
          mutability: 'mutable',
          inputs: [
            {
              name: 'new_rewards_manager',
              type: 'Address',
            },
          ],
          outputs: [],
        },
        {
          docs: [
            'Sets the Guardian of the protocol.',
            '',
            '# Arguments:',
            '',
            '- `new_pause_guardian` - The address of the new Guardian.',
            '',
            '# Notes:',
            '',
            '- Can only be called by the admin.',
            '',
          ],
          name: 'setPauseGuardian',
          mutability: 'mutable',
          inputs: [
            {
              name: 'new_pause_guardian',
              type: 'Address',
            },
          ],
          outputs: [],
        },
        {
          docs: [
            'Sets a Rewards Booster smart contract as an observer, i.e. as a contract that is notified when accounts deposit or',
            'withdraw collateral from markets. The name Booster Observer is used to reference the Rewards Booster smart contract.',
            '',
            '# Arguments:',
            '',
            '- `new_booster_observer` - the rewards booster smart contract address.',
            '',
            '# Notes',
            '',
            '- can only be called by the admin',
            '- `new_booster_observer` must be a rewards booster smart contract',
            '- `new_booster_observer` must not have been already used as a rewards booster',
            '',
          ],
          name: 'setBoosterObserver',
          mutability: 'mutable',
          inputs: [
            {
              name: 'new_booster_observer',
              type: 'Address',
            },
          ],
          outputs: [],
        },
        {
          docs: [
            'Removes Rewards Booster smart contract from being an observer. From this point onwards, this smart contract will not',
            'be notified of any market change.',
            '',
          ],
          name: 'clearBoosterObserver',
          mutability: 'mutable',
          inputs: [],
          outputs: [],
        },
        {
          docs: [
            'Sets a USH Money Market smart contract as an observer, i.e. as a contract that is notified when accounts deposit or',
            'withdraw collateral from markets. The name USH Market Observer is used to reference the USH Money Market smart',
            'contract.',
            '',
            '# Arguments:',
            '',
            '- `new_ush_market_observer` - The USH Money Market smart contract address.',
            '',
            '# Notes',
            '',
            '- can only be called by the admin',
            '- `new_ush_market_observer` must have been already whitelisted as a money market',
            '- `new_ush_market_observer` must not have been already used as a USH market observer',
            '',
          ],
          name: 'setUshMarketObserver',
          mutability: 'mutable',
          inputs: [
            {
              name: 'new_ush_market_observer',
              type: 'Address',
            },
          ],
          outputs: [],
        },
        {
          docs: [
            'Clears the USH Market smart contract from being an observer. From this point onwards, this smart contract will not be',
            'notified of any market change.',
            '',
          ],
          name: 'clearUshMarketObserver',
          mutability: 'mutable',
          inputs: [],
          outputs: [],
        },
        {
          docs: [
            'Changes the minting status for a specific money market.',
            '',
            '# Arguments:',
            '',
            '- `money_market` - The address of the money market smart contract.',
            '- `pause` - A boolean that indicates whether the protocol must be or not paused.',
            '',
            '# Notes:',
            '',
            '- Can only be called by the admin or the Guardian.',
            '',
          ],
          name: 'pauseMint',
          mutability: 'mutable',
          inputs: [
            {
              name: 'money_market',
              type: 'Address',
            },
            {
              name: 'pause',
              type: 'bool',
            },
          ],
          outputs: [],
        },
        {
          docs: [
            'Changes the borrowing status for a specific money market.',
            '',
            '# Arguments:',
            '',
            '- `money_market` - The address of the money market smart contract.',
            '- `pause` - A boolean that indicates whether the protocol must be or not paused.',
            '',
            '# Notes:',
            '',
            '- Can only be called by the admin or the Guardian.',
            '',
          ],
          name: 'pauseBorrow',
          mutability: 'mutable',
          inputs: [
            {
              name: 'money_market',
              type: 'Address',
            },
            {
              name: 'pause',
              type: 'bool',
            },
          ],
          outputs: [],
        },
        {
          docs: [
            'Changes the seizing status for a specific money market.',
            '',
            '# Arguments:',
            '',
            '- `money_market` - The address of the money market smart contract.',
            '- `pause` - A boolean that indicates whether the protocol must be or not paused.',
            '',
            '# Notes:',
            '',
            '- Can only be called by the admin or the Guardian.',
            '',
          ],
          name: 'pauseSeize',
          mutability: 'mutable',
          inputs: [
            {
              name: 'money_market',
              type: 'Address',
            },
            {
              name: 'pause',
              type: 'bool',
            },
          ],
          outputs: [],
        },
        {
          docs: [
            'Changes the seizing status (required for liquidations) for all money markets.',
            '',
            '# Arguments:',
            '',
            '- `pause` - A boolean that indicates whether the protocol must be or not paused.',
            '',
            '# Notes:',
            '',
            '- Can only be called by the admin or the Guardian.',
            '',
          ],
          name: 'pauseGlobalSeize',
          mutability: 'mutable',
          inputs: [
            {
              name: 'pause',
              type: 'bool',
            },
          ],
          outputs: [],
        },
        {
          docs: [
            'Payable endpoint used to enter to a one or many markets, i.e. provide collateral for sender liquidity calculations.',
            'The sender can perform multiple calls to keep adding more collateral.',
            '',
            '# Arguments:',
            '',
            '- `opt_account` - If given, the collateral will be deposited on the name of this account. Can only be performed by a',
            '  whitelisted money market.',
            '',
            '# Notes:',
            '',
            '- Must be paid with one or many valid ESDT Hatom tokens',
            '',
          ],
          name: 'enterMarkets',
          mutability: 'mutable',
          payableInTokens: ['HEGLD-ae8054', 'HUSDC-7c1ef2'],
          inputs: [
            {
              name: 'opt_account',
              type: 'optional<Address>',
              multi_arg: true,
            },
          ],
          outputs: [],
        },
        {
          docs: [
            "Exits a given amount of tokens from a given money market, i.e. removes the caller's deposited collateral for",
            'liquidity computations. If the amount of tokens is not specified, all the position is removed.',
            '',
            '# Arguments:',
            '',
            '- `money_market` - The address of the money market smart contract.',
            '- `opt_tokens` - If given, the amount of collateral tokens to remove.',
            '',
            '# Notes:',
            '',
            '- The provided address must be a whitelisted money market.',
            '- The caller must have collateral in the corresponding money market.',
            '- The amount of tokens to withdraw should not exceed the current deposited amount.',
            '- The caller must be providing the necessary collateral for any outstanding borrows.',
            '',
          ],
          name: 'exitMarket',
          mutability: 'mutable',
          inputs: [
            {
              name: 'money_market',
              type: 'Address',
            },
            {
              name: 'opt_tokens',
              type: 'optional<BigUint>',
              multi_arg: true,
            },
          ],
          outputs: [
            {
              type: 'EsdtTokenPayment',
            },
          ],
        },
        {
          docs: [
            "Exits a given amount of tokens from a given money market, i.e. removes the caller's deposited collateral for liquidity",
            'computations and redeems the corresponding amount of tokens.',
            '',
            '# Arguments:',
            '',
            '- `money_market` - The address of the money market smart contract.',
            '- `opt_tokens` - If given, the amount of collateral tokens to remove.',
            "- `opt_underlying_amount` - An optional amount of underlying asset to receive back in exchange for the paid Hatom's",
            '  tokens.',
            '',
            '# Notes:',
            '',
            '- The provided address must be a whitelisted money market.',
            '- The caller must have collateral in the corresponding money market.',
            '- The amount of tokens to withdraw should not exceed the current deposited amount.',
            '',
          ],
          name: 'exitMarketAndRedeem',
          mutability: 'mutable',
          inputs: [
            {
              name: 'money_market',
              type: 'Address',
            },
            {
              name: 'opt_tokens',
              type: 'Option<BigUint>',
            },
            {
              name: 'opt_underlying_amount',
              type: 'Option<BigUint>',
            },
          ],
          outputs: [
            {
              type: 'EgldOrEsdtTokenPayment',
            },
            {
              type: 'EsdtTokenPayment',
            },
            {
              type: 'EsdtTokenPayment',
            },
          ],
        },
        {
          docs: [
            'Removes an account from the given money market when the account has no collateral and no outstanding borrow in the',
            'given money market.',
            '',
            '# Arguments:',
            '',
            '- `money_market` - The address of the money market smart contract.',
            "- `opt_account` - If given, the address of the account to remove. If not given, the caller's address is used.",
            '',
          ],
          name: 'removeAccountMarket',
          mutability: 'mutable',
          inputs: [
            {
              name: 'money_market',
              type: 'Address',
            },
            {
              name: 'opt_account',
              type: 'optional<Address>',
            },
          ],
          outputs: [],
        },
        {
          docs: [
            'Checks whether minting is allowed at a specified money market.',
            '',
            '# Arguments:',
            '',
            '- `money_market` - The address of the money market smart contract.',
            '',
            '# Notes:',
            '',
            '- It does not depend on the account that intends to mint.',
            '- Fails with panic and a clear error message or returns true.',
            '',
          ],
          name: 'mintAllowed',
          mutability: 'readonly',
          inputs: [
            {
              name: 'money_market',
              type: 'Address',
            },
            {
              name: 'amount',
              type: 'BigUint',
            },
          ],
          outputs: [
            {
              type: 'bool',
            },
          ],
        },
        {
          docs: [
            'Checks whether an account (redeemer) should be allowed to withdraw a given amount of Hatom tokens from a given',
            'market, i.e. withdraw collateral.',
            '',
            '# Arguments:',
            '',
            '- `money_market` - The address of the money market smart contract.',
            '- `redeemer` - The account that intends to withdraw the tokens.',
            '- `tokens` - The amount of Hatom tokens to withdraw.',
            '',
            '# Notes:',
            '',
            '- This function is not used when redeeming at a money market, it is only used when redeeming (exiting the market) at',
            '  the controller.',
            '- A simulation of the resulting risk profile is performed.',
            '- Fails with panic and a clear error message, returns false if redeemer would become risky or true if she remains',
            '  solvent.',
            '',
          ],
          name: 'redeemAllowed',
          mutability: 'mutable',
          inputs: [
            {
              name: 'money_market',
              type: 'Address',
            },
            {
              name: 'redeemer',
              type: 'Address',
            },
            {
              name: 'tokens',
              type: 'BigUint',
            },
          ],
          outputs: [
            {
              type: 'bool',
            },
          ],
        },
        {
          docs: [
            'Checks whether an account (borrower) should be allowed to take a borrow of a given amount on a given money market.',
            '',
            '# Arguments:',
            '',
            '- `money_market` - The address of the money market smart contract.',
            '- `borrower` - The account that intends to take a borrow.',
            '- `amount` - The amount of underlying to borrow.',
            '',
            '# Notes:',
            '',
            '- Fails with panic and a clear error message, returns false if borrower would become risky or true if she remains',
            '  solvent.',
            '',
          ],
          name: 'borrowAllowed',
          mutability: 'mutable',
          inputs: [
            {
              name: 'money_market',
              type: 'Address',
            },
            {
              name: 'borrower',
              type: 'Address',
            },
            {
              name: 'amount',
              type: 'BigUint',
            },
          ],
          outputs: [
            {
              type: 'bool',
            },
          ],
        },
        {
          docs: [
            'Checks whether repaying a borrow is allowed at a specified money market.',
            '',
            '# Arguments:',
            '',
            '- `money_market` - The address of the money market smart contract.',
            '- `borrower` - The address of the borrower.',
            '',
            '# Notes:',
            '',
            '- It does not depend on the account that intends to repay the borrow.',
            '',
          ],
          name: 'repayBorrowAllowed',
          mutability: 'mutable',
          inputs: [
            {
              name: 'money_market',
              type: 'Address',
            },
            {
              name: 'borrower',
              type: 'Address',
            },
          ],
          outputs: [
            {
              type: 'bool',
            },
          ],
        },
        {
          docs: [
            'Checks whether a liquidation is allowed or not to happen, repaying a borrow at a given money market and seizing',
            'collateral at the same or another specified money market.',
            '',
            '# Arguments:',
            '',
            '- `borrow_market` - The money market where the borrower has borrow its underlying.',
            '- `collateral_market` - The money market where the borrower has collateral which is intended to be seized.',
            '- `borrower` - The address of the borrower.',
            '- `amount` - The amount of underlying being repaid by the liquidator.',
            '',
            '# Notes:',
            '',
            '- Borrows at deprecated markets can be fully repaid (the close factor does not play any role).',
            '- Fails with panic and a clear error message, returns false if the borrower cannot be liquidated (i.e. the borrower',
            '  is solvent) or true if the liquidation can be performed (i.e. the borrower is risky and repayment amount does not',
            '  exceeds its maximum allowed).',
            '',
          ],
          name: 'liquidateBorrowAllowed',
          mutability: 'mutable',
          inputs: [
            {
              name: 'borrow_market',
              type: 'Address',
            },
            {
              name: 'collateral_market',
              type: 'Address',
            },
            {
              name: 'borrower',
              type: 'Address',
            },
            {
              name: 'amount',
              type: 'BigUint',
            },
          ],
          outputs: [
            {
              type: 'bool',
            },
          ],
        },
        {
          docs: [
            'Checks whether seizing is or not allowed.',
            '',
            '# Arguments:',
            '',
            '- `collateral_market` - The money market where the borrower has collateral which is intended to be seized.',
            '- `borrow_market` - The money market where the borrower has borrow its underlying.',
            '- `borrower` - The address of the borrower.',
            '- `_liquidator` - The address of the liquidator (legacy).',
            '',
            '# Notes:',
            '',
            '- Money markets should be whitelisted and share the same Controller.',
            '',
          ],
          name: 'seizeAllowed',
          mutability: 'mutable',
          inputs: [
            {
              name: 'collateral_market',
              type: 'Address',
            },
            {
              name: 'borrow_market',
              type: 'Address',
            },
            {
              name: 'borrower',
              type: 'Address',
            },
            {
              name: '_liquidator',
              type: 'Address',
            },
          ],
          outputs: [
            {
              type: 'bool',
            },
          ],
        },
        {
          docs: [
            'Updates rewards batches states.',
            '',
            '# Arguments:',
            '',
            '- `supply` - Whether or not to update supply rewards.',
            '- `borrow` - Whether or not to update borrow rewards..',
            '- `money_markets` - The money market addresses to update rewards in. If empty, all whitelisted markets will be used.',
            '',
          ],
          name: 'updateRewardsBatchesState',
          mutability: 'mutable',
          inputs: [
            {
              name: 'supply',
              type: 'bool',
            },
            {
              name: 'borrow',
              type: 'bool',
            },
            {
              name: 'money_markets',
              type: 'List<Address>',
            },
          ],
          outputs: [],
        },
        {
          docs: [
            'Distributes caller or specified accounts rewards from supply and/or borrow markets, at specific money markets.',
            '',
            '# Arguments:',
            '',
            '- `supply` - Whether or not to distribute supply rewards.',
            '- `borrow` - Whether or not to distribute borrow rewards.',
            '- `money_markets` - The money market addresses to distribute rewards in. If empty, all whitelisted markets will be',
            '  used.',
            '- `accounts` - The addresses to distribute rewards for. If empty, the caller will be used.',
            '',
          ],
          name: 'distributeRewards',
          mutability: 'mutable',
          inputs: [
            {
              name: 'supply',
              type: 'bool',
            },
            {
              name: 'borrow',
              type: 'bool',
            },
            {
              name: 'money_markets',
              type: 'List<Address>',
            },
            {
              name: 'accounts',
              type: 'List<Address>',
            },
          ],
          outputs: [],
        },
        {
          docs: [
            'Claims caller or specified accounts rewards from supply and/or borrow markets, at specific money markets.',
            '',
            '# Arguments:',
            '',
            '- `boost` - Whether or not to boost rewards whenever possible.',
            '- `supply` - Whether or not to claim supply rewards.',
            '- `borrow` - Whether or not to claim borrow rewards.',
            '- `money_markets` - The money market addresses to claim rewards in. If empty, all whitelisted markets will be used.',
            '- `accounts` - The addresses to claim rewards for. If empty, the caller will be used.',
            '- `opt_min_boosted_rewards_out`: An optional minimum amount of boosted rewards out.',
            '',
          ],
          name: 'claimRewards',
          mutability: 'mutable',
          inputs: [
            {
              name: 'boost',
              type: 'bool',
            },
            {
              name: 'supply',
              type: 'bool',
            },
            {
              name: 'borrow',
              type: 'bool',
            },
            {
              name: 'money_markets',
              type: 'List<Address>',
            },
            {
              name: 'accounts',
              type: 'List<Address>',
            },
            {
              name: 'opt_min_boosted_rewards_out',
              type: 'optional<BigUint>',
              multi_arg: true,
            },
          ],
          outputs: [
            {
              type: 'variadic<multi<Address,EgldOrEsdtTokenPayment>>',
              multi_result: true,
            },
          ],
        },
        {
          docs: [
            'Sends all rewards from all rewards batches for the given money markets to the given account.',
            '',
            '# Arguments:',
            '',
            '- `boost`: Whether to boost the rewards or not.',
            '- `supply` - Whether or not to claim supply rewards.',
            '- `borrow` - Whether or not to claim borrow rewards.',
            '- `tokens`: An array of rewards tokens.',
            '- `money_markets`: An array of money market addresses in which the rewards distribution will be done.',
            '- `accounts`: An array of account addresses.',
            '- `opt_min_boosted_rewards_out`: An optional minimum amount of boosted rewards out.',
            '',
            '# Notes:',
            '',
            '- If `boost` is enabled, then the rewards will be boosted using the rewards booster.',
            '- If no money markets are specified, then all whitelisted money markets will be used.',
            '- If a provided money market does not have any batch for the rewards tokens, then it will be ignored.',
            '- If no accounts are provided, then only the caller will claim his rewards.',
            '',
          ],
          name: 'claimRewardsTokens',
          mutability: 'mutable',
          inputs: [
            {
              name: 'boost',
              type: 'bool',
            },
            {
              name: 'supply',
              type: 'bool',
            },
            {
              name: 'borrow',
              type: 'bool',
            },
            {
              name: 'tokens',
              type: 'List<EgldOrEsdtTokenIdentifier>',
            },
            {
              name: 'money_markets',
              type: 'List<Address>',
            },
            {
              name: 'accounts',
              type: 'List<Address>',
            },
            {
              name: 'opt_min_boosted_rewards_out',
              type: 'optional<BigUint>',
              multi_arg: true,
            },
          ],
          outputs: [
            {
              type: 'variadic<multi<Address,EgldOrEsdtTokenPayment>>',
              multi_result: true,
            },
          ],
        },
        {
          docs: [
            'Checks whether an account is risky or not by computing its current risk profile.',
            '',
            '# Arguments:',
            '',
            '- `account` - The account we wish to analyze.',
            '',
          ],
          name: 'isRisky',
          mutability: 'mutable',
          inputs: [
            {
              name: 'account',
              type: 'Address',
            },
          ],
          outputs: [
            {
              type: 'bool',
            },
          ],
        },
        {
          docs: [
            'Performs a risk profile simulation for a given account, considering its current opened positions and simulating',
            'either redeeming or borrowing (or both) in a given money market. The money market for the simulation must be already',
            'included as an account market. Otherwise, the simulation will not be performed.',
            '',
            '# Arguments:',
            '',
            '- `account` - The account we wish to analyze.',
            '- `this_money_market` - The money market address used for the borrow or redeem simulation (or both).',
            '- `redeem_tokens` - The amount of Hatom tokens to be redeemed for underlying at `this_money_market`.',
            '- `borrow_amount` - The amount of underlying to be borrowed at `this_money_market`.',
            '- `lazy` - If true, the simulation will return a solvent risk profile with a dummy liquidity if the account is not a',
            '  borrower. If false, the simulation will be fully performed, even if it is not a borrower (i.e. Solvent by',
            '  definition).',
            '',
          ],
          name: 'simulateRiskProfile',
          mutability: 'mutable',
          inputs: [
            {
              name: 'account',
              type: 'Address',
            },
            {
              name: 'this_money_market',
              type: 'Address',
            },
            {
              name: 'redeem_tokens',
              type: 'BigUint',
            },
            {
              name: 'borrow_amount',
              type: 'BigUint',
            },
            {
              name: 'lazy',
              type: 'bool',
            },
          ],
          outputs: [
            {
              type: 'RiskProfile',
            },
          ],
        },
        {
          docs: [
            'A utility function to highlight that this smart contract is a Controller.',
            '',
          ],
          name: 'isController',
          mutability: 'readonly',
          inputs: [],
          outputs: [
            {
              type: 'bool',
            },
          ],
        },
        {
          docs: [
            'Checks whether the specified money market address has already been whitelisted.',
            '',
            '# Arguments:',
            '',
            '- `sc_address` - The address of the money market to check.',
            '',
          ],
          name: 'isWhitelistedMoneyMarket',
          mutability: 'readonly',
          inputs: [
            {
              name: 'sc_address',
              type: 'Address',
            },
          ],
          outputs: [
            {
              type: 'bool',
            },
          ],
        },
        {
          docs: [
            'Checks whether the specified token identifier has already been whitelisted.',
            '',
            '# Arguments:',
            '',
            '- `token_id` - The token identifier to check.',
            '',
          ],
          name: 'isWhitelistedTokenId',
          mutability: 'readonly',
          inputs: [
            {
              name: 'token_id',
              type: 'TokenIdentifier',
            },
          ],
          outputs: [
            {
              type: 'bool',
            },
          ],
        },
        {
          docs: [
            'Checks whether the specified address is a Rewards Booster observer.',
            '',
            '# Arguments:',
            '',
            '- `sc_address` - The address of the market observer to check.',
            '',
          ],
          name: 'isBoosterObserver',
          mutability: 'readonly',
          inputs: [
            {
              name: 'sc_address',
              type: 'Address',
            },
          ],
          outputs: [
            {
              type: 'bool',
            },
          ],
        },
        {
          docs: [
            'Checks whether the specified address is a USH Market observer.',
            '',
            '# Arguments:',
            '',
            '- `sc_address` - The address of the market observer to check.',
            '',
          ],
          name: 'isUshMarketObserver',
          mutability: 'readonly',
          inputs: [
            {
              name: 'sc_address',
              type: 'Address',
            },
          ],
          outputs: [
            {
              type: 'bool',
            },
          ],
        },
        {
          docs: [
            'Checks whether the specified money market is deprecated.',
            '',
            '# Arguments:',
            '',
            '- `money_market` - The address of the money market to check.',
            '',
          ],
          name: 'isDeprecated',
          mutability: 'mutable',
          inputs: [
            {
              name: 'money_market',
              type: 'Address',
            },
          ],
          outputs: [
            {
              type: 'bool',
            },
          ],
        },
        {
          docs: [
            'Gets a whitelist or set of supported money market addresses as an array.',
            '',
          ],
          name: 'getWhitelistedMarkets',
          mutability: 'readonly',
          inputs: [],
          outputs: [
            {
              type: 'List<Address>',
            },
          ],
        },
        {
          docs: [
            'Gets the the set of money markets addresses in which the account has entered as an array. An account is considered to',
            'be in the market if it has deposited collateral or took a borrow. Currently, after a borrow is fully repaid, the',
            'account is still considered to be in the market.',
            '',
          ],
          name: 'getAccountMarkets',
          mutability: 'readonly',
          inputs: [
            {
              name: 'account',
              type: 'Address',
            },
          ],
          outputs: [
            {
              type: 'List<Address>',
            },
          ],
        },
        {
          docs: ['Gets the maximum collateral factor allowed', ''],
          name: 'getMaxCollateralFactor',
          mutability: 'readonly',
          inputs: [],
          outputs: [
            {
              type: 'BigUint',
            },
          ],
        },
        {
          docs: [
            'Gets the amount of Hatom tokens deposited as collateral for a given money market and account.',
            '',
            '# Arguments:',
            '',
            '- `money_market` - The address of the money market smart contract.',
            '- `account` - The account we wish to analyze.',
            '',
          ],
          name: 'getAccountTokens',
          mutability: 'readonly',
          inputs: [
            {
              name: 'money_market',
              type: 'Address',
            },
            {
              name: 'account',
              type: 'Address',
            },
          ],
          outputs: [
            {
              type: 'BigUint',
            },
          ],
        },
        {
          docs: [
            'Gets the total amount of collateral tokens deposited into the controller for a specific money market.',
            '',
            '# Arguments:',
            '',
            '- `money_market` - The address of the money market for which to retrieve the total collateral tokens.',
            '',
            '# Notes:',
            '',
            '- If the market has no collateral, returns 0.',
            '',
          ],
          name: 'getTotalCollateralTokens',
          mutability: 'readonly',
          inputs: [
            {
              name: 'money_market',
              type: 'Address',
            },
          ],
          outputs: [
            {
              type: 'BigUint',
            },
          ],
        },
        {
          docs: [
            'Gets the up to date collateral factor for a specified money market.',
            '',
            '# Arguments:',
            '',
            '- `money_market` - The address of the money market smart contract.',
            '',
          ],
          name: 'updateAndGetCollateralFactor',
          mutability: 'mutable',
          inputs: [
            {
              name: 'money_market',
              type: 'Address',
            },
          ],
          outputs: [
            {
              type: 'BigUint',
            },
          ],
        },
        {
          docs: [
            'Gets the up to date USH borrower collateral factor for a specified money market.',
            '',
            '# Arguments:',
            '',
            '- `money_market` - The address of the money market smart contract.',
            '',
          ],
          name: 'updateAndGetUshBorrowerCollateralFactor',
          mutability: 'mutable',
          inputs: [
            {
              name: 'money_market',
              type: 'Address',
            },
          ],
          outputs: [
            {
              type: 'BigUint',
            },
          ],
        },
        {
          docs: [
            'Updates the collateral factors if possible and returns their updated values.',
            '',
            '# Arguments:',
            '',
            '- `money_market` - The address of the money market smart contract.',
            '',
          ],
          name: 'updateAndGetCollateralFactors',
          mutability: 'mutable',
          inputs: [
            {
              name: 'money_market',
              type: 'Address',
            },
          ],
          outputs: [
            {
              type: 'tuple<BigUint,BigUint>',
            },
          ],
        },
        {
          docs: [
            'Gets the current minting status at a given money market.',
            '',
            '# Arguments:',
            '',
            '- `money_market` - The address of the money market smart contract.',
            '',
            '# Notes:',
            '',
            '- By default, mint is active (returns the first enum value).',
            '',
          ],
          name: 'getMintStatus',
          mutability: 'readonly',
          inputs: [
            {
              name: 'money_market',
              type: 'Address',
            },
          ],
          outputs: [
            {
              type: 'Status',
            },
          ],
        },
        {
          docs: [
            'Gets the current borrowing status at a given money market.',
            '',
            '# Arguments:',
            '',
            '- `money_market` - The address of the money market smart contract.',
            '',
            '# Notes:',
            '',
            '- By default, borrow is active (returns the first enum value).',
            '',
          ],
          name: 'getBorrowStatus',
          mutability: 'readonly',
          inputs: [
            {
              name: 'money_market',
              type: 'Address',
            },
          ],
          outputs: [
            {
              type: 'Status',
            },
          ],
        },
        {
          docs: [
            'Gets the current seizing status at a given money market.',
            '',
            '# Arguments:',
            '',
            '- `money_market` - The address of the money market smart contract.',
            '',
            '# Notes:',
            '',
            '- By default, seize is active (returns the first enum value).',
            '',
          ],
          name: 'getSeizeStatus',
          mutability: 'readonly',
          inputs: [
            {
              name: 'money_market',
              type: 'Address',
            },
          ],
          outputs: [
            {
              type: 'Status',
            },
          ],
        },
        {
          docs: [
            'Gets the current global seizing status at a given money market.',
            '',
            '# Notes:',
            '',
            '- By default, global seize is active (returns the first enum value).',
            '',
          ],
          name: 'getGlobalSeizeStatus',
          mutability: 'readonly',
          inputs: [],
          outputs: [
            {
              type: 'Status',
            },
          ],
        },
        {
          docs: [
            "Gets the accrued rewards for a given account's address and rewards token ID.",
            '',
            '# Arguments:',
            '',
            "- `supplier` - A reference to a `ManagedAddress` representing the supplier's address.",
            "- `rewards_token_id` - A reference to an `EgldOrEsdtTokenIdentifier` representing the rewards token's ID.",
            '',
          ],
          name: 'getAccountAccruedRewards',
          mutability: 'readonly',
          inputs: [
            {
              name: 'supplier',
              type: 'Address',
            },
            {
              name: 'rewards_token_id',
              type: 'EgldOrEsdtTokenIdentifier',
            },
          ],
          outputs: [
            {
              type: 'BigUint',
            },
          ],
        },
        {
          docs: [
            'Whitelisted money markets can burn their own tokens deposited at the controller.',
            '',
            '# Arguments:',
            '',
            '- `token_id` - The token identifier for the Hatom token.',
            '- `tokens` - The amount of tokens to be burnt.',
            '',
            '# Notes:',
            '',
            '- Can only be called by a whitelisted money market.',
            '- A money market can only burn Hatom tokens corresponding to their own token type.',
            '- There is no need to update the total collateral tokens for the money market because it is assumed that they have',
            '  already exited the market and are being redeemed.',
            '',
          ],
          name: 'burnTokens',
          mutability: 'mutable',
          inputs: [
            {
              name: 'token_id',
              type: 'TokenIdentifier',
            },
            {
              name: 'tokens',
              type: 'BigUint',
            },
          ],
          outputs: [],
        },
        {
          docs: [
            'Whitelisted money markets can transfer their own tokens to a given account.',
            '',
            '# Arguments:',
            '',
            '- `to` - The address of the account to which the tokens will be transferred.',
            '- `token_payment` - The token payment to be transferred.',
            '',
            '# Notes:',
            '',
            '- Can only be called by a whitelisted money market.',
            '- A money market can only transfer Hatom tokens corresponding to their own token type.',
            '- There is no need to update the total collateral tokens for the money market because it is assumed that they have',
            '  already exited the market and are being transferred.',
            '',
          ],
          name: 'transferTokens',
          mutability: 'mutable',
          inputs: [
            {
              name: 'to',
              type: 'Address',
            },
            {
              name: 'token_payment',
              type: 'EsdtTokenPayment',
            },
          ],
          outputs: [],
        },
        {
          docs: [
            'Computes the amount of Hatom tokens to be seized given an underlying repayment amount performed by the liquidator.',
            'Takes into consideration the liquidation incentive, such that the liquidator gets tokens at a discount.',
            '',
            '# Arguments:',
            '',
            '- `borrow_market` - The money market where the borrower has borrow its underlying.',
            '- `collateral_market` - The money market where the borrower has collateral which is intended to be seized.',
            '- `amount` - The amount of underlying being repaid by the liquidator.',
            '',
          ],
          name: 'tokensToSeize',
          mutability: 'mutable',
          inputs: [
            {
              name: 'borrow_market',
              type: 'Address',
            },
            {
              name: 'collateral_market',
              type: 'Address',
            },
            {
              name: 'amount',
              type: 'BigUint',
            },
          ],
          outputs: [
            {
              type: 'BigUint',
            },
          ],
        },
        {
          docs: ['Stores the guardian address.'],
          name: 'getPauseGuardian',
          mutability: 'readonly',
          inputs: [],
          outputs: [
            {
              type: 'Address',
            },
          ],
        },
        {
          docs: ['Stores the rewards manager address.'],
          name: 'getRewardsManager',
          mutability: 'readonly',
          inputs: [],
          outputs: [
            {
              type: 'Address',
            },
          ],
        },
        {
          docs: [
            'Stores a whitelisted market address given a token identifier.',
          ],
          name: 'getMoneyMarketByTokenId',
          mutability: 'readonly',
          inputs: [
            {
              name: 'token_id',
              type: 'TokenIdentifier',
            },
          ],
          outputs: [
            {
              type: 'Address',
            },
          ],
        },
        {
          docs: [
            'Stores both the underlying identifier and the token identifier associated to a whitelisted money market.',
          ],
          name: 'getIdentifiersByMoneyMarket',
          mutability: 'readonly',
          inputs: [
            {
              name: 'money_market',
              type: 'Address',
            },
          ],
          outputs: [
            {
              type: 'tuple<EgldOrEsdtTokenIdentifier,TokenIdentifier>',
            },
          ],
        },
        {
          docs: [
            'Stores the set of addresses that belong to a given money market.',
          ],
          name: 'getMarketMembers',
          mutability: 'readonly',
          inputs: [
            {
              name: 'money_market',
              type: 'Address',
            },
          ],
          outputs: [
            {
              type: 'variadic<Address>',
              multi_result: true,
            },
          ],
        },
        {
          docs: [
            'Stores the maximum amount of markets an account can enter at any given point in time.',
          ],
          name: 'getMaxMarketsPerAccount',
          mutability: 'readonly',
          inputs: [],
          outputs: [
            {
              type: 'u32',
            },
          ],
        },
        {
          docs: ['Stores the price oracle smart contract address.'],
          name: 'getPriceOracle',
          mutability: 'readonly',
          inputs: [],
          outputs: [
            {
              type: 'Address',
            },
          ],
        },
        {
          docs: ['Stores the collateral factor for each money market.'],
          name: 'getCollateralFactor',
          mutability: 'readonly',
          inputs: [
            {
              name: 'money_market',
              type: 'Address',
            },
          ],
          outputs: [
            {
              type: 'BigUint',
            },
          ],
        },
        {
          docs: [
            'Stores the collateral factor for each money market taken into consideration if the account has borrowed USH.',
          ],
          name: 'getUshBorrowerCollateralFactor',
          mutability: 'readonly',
          inputs: [
            {
              name: 'money_market',
              type: 'Address',
            },
          ],
          outputs: [
            {
              type: 'BigUint',
            },
          ],
        },
        {
          docs: ['Stores the next collateral factors for each money market.'],
          name: 'getNextCollateralFactor',
          mutability: 'readonly',
          inputs: [
            {
              name: 'money_market',
              type: 'Address',
            },
          ],
          outputs: [
            {
              type: 'tuple<u64,BigUint,BigUint>',
            },
          ],
        },
        {
          docs: [
            'A supported money market might have a liquidity cap, which is stored here.',
          ],
          name: 'getLiquidityCap',
          mutability: 'readonly',
          inputs: [
            {
              name: 'money_market',
              type: 'Address',
            },
          ],
          outputs: [
            {
              type: 'BigUint',
            },
          ],
        },
        {
          docs: [
            'A supported money market might have a borrowing cap, which is stored here.',
          ],
          name: 'getBorrowCap',
          mutability: 'readonly',
          inputs: [
            {
              name: 'money_market',
              type: 'Address',
            },
          ],
          outputs: [
            {
              type: 'BigUint',
            },
          ],
        },
        {
          docs: [
            'Stores the rewards index for a given account and rewards token in the specified money market.',
          ],
          name: 'getAccountRewardsIndex',
          mutability: 'readonly',
          inputs: [
            {
              name: 'money_market',
              type: 'Address',
            },
            {
              name: 'batch_id',
              type: 'u32',
            },
            {
              name: 'account',
              type: 'Address',
            },
          ],
          outputs: [
            {
              type: 'BigUint',
            },
          ],
        },
        {
          docs: [
            'Stores the ID of the next rewards batch in the specified money market.',
          ],
          name: 'getNextRewardsBatchId',
          mutability: 'readonly',
          inputs: [
            {
              name: 'money_market',
              type: 'Address',
            },
          ],
          outputs: [
            {
              type: 'u32',
            },
          ],
        },
        {
          docs: ['Stores the maximum amount of batches allowed per market.'],
          name: 'getMaxRewardsBatchesPerMarket',
          mutability: 'readonly',
          inputs: [
            {
              name: 'money_market',
              type: 'Address',
            },
          ],
          outputs: [
            {
              type: 'u32',
            },
          ],
        },
        {
          docs: ['Stores the maximum allowed slippage.'],
          name: 'getMaxSlippage',
          mutability: 'readonly',
          inputs: [],
          outputs: [
            {
              type: 'BigUint',
            },
          ],
        },
        {
          docs: [
            'Stores the list of rewards batches in the specified money market.',
          ],
          name: 'getRewardsBatches',
          mutability: 'readonly',
          inputs: [
            {
              name: 'money_market',
              type: 'Address',
            },
          ],
          outputs: [
            {
              type: 'variadic<RewardsBatch>',
              multi_result: true,
            },
          ],
        },
        {
          docs: [
            'Stores the undistributed rewards for a given rewards token identifier.',
          ],
          name: 'getUndistributedRewards',
          mutability: 'readonly',
          inputs: [
            {
              name: 'token_id',
              type: 'EgldOrEsdtTokenIdentifier',
            },
          ],
          outputs: [
            {
              type: 'BigUint',
            },
          ],
        },
        {
          docs: [
            'Stores the current position of a rewards batch in the specified money market at the corresponding VecMapper.',
          ],
          name: 'getRewardsBatchPosition',
          mutability: 'readonly',
          inputs: [
            {
              name: 'money_market',
              type: 'Address',
            },
            {
              name: 'batch_id',
              type: 'u32',
            },
          ],
          outputs: [
            {
              type: 'u32',
            },
          ],
        },
        {
          docs: [
            'Stores the rewards batch booster for a given rewards token identifier.',
          ],
          name: 'getRewardsBooster',
          mutability: 'readonly',
          inputs: [
            {
              name: 'token_id',
              type: 'EgldOrEsdtTokenIdentifier',
            },
          ],
          outputs: [
            {
              type: 'RewardsBooster',
            },
          ],
        },
        {
          docs: ['Stores wrapped EGLD smart contract address.'],
          name: 'getEgldWrapper',
          mutability: 'readonly',
          inputs: [],
          outputs: [
            {
              type: 'Address',
            },
          ],
        },
        {
          docs: ['Stores the token identifier of the wrapped EGLD token.'],
          name: 'getWegldId',
          mutability: 'readonly',
          inputs: [],
          outputs: [
            {
              type: 'TokenIdentifier',
            },
          ],
        },
        {
          docs: ['Stores the governance token identifier.'],
          name: 'getGovernanceTokenId',
          mutability: 'readonly',
          inputs: [],
          outputs: [
            {
              type: 'TokenIdentifier',
            },
          ],
        },
        {
          docs: ['Stores the xExchange Router address.'],
          name: 'getRouter',
          mutability: 'readonly',
          inputs: [],
          outputs: [
            {
              type: 'Address',
            },
          ],
        },
        {
          docs: ['Stores the boosting state.'],
          name: 'getBoostingState',
          mutability: 'readonly',
          inputs: [],
          outputs: [
            {
              type: 'State',
            },
          ],
        },
        {
          docs: ['Stores whether boosting is or not supported.'],
          name: 'isRewardsBatchBoostingSupported',
          mutability: 'readonly',
          inputs: [],
          outputs: [
            {
              type: 'bool',
            },
          ],
        },
        {
          docs: ['Stores the Rewards Booster smart contract address.'],
          name: 'getBoosterObserver',
          mutability: 'readonly',
          inputs: [],
          outputs: [
            {
              type: 'Address',
            },
          ],
        },
        {
          docs: ['Stores the USH Money Market observer.'],
          name: 'getUshMarketObserver',
          mutability: 'readonly',
          inputs: [],
          outputs: [
            {
              type: 'Address',
            },
          ],
        },
      ],
      events: [
        {
          docs: ['Event emitted when the pending admin is updated.'],
          identifier: 'new_pending_admin_event',
          inputs: [
            {
              name: 'pending_admin',
              type: 'Address',
              indexed: true,
            },
          ],
        },
        {
          docs: ['Event emitted when the admin is updated.'],
          identifier: 'new_admin_event',
          inputs: [
            {
              name: 'admin',
              type: 'Address',
              indexed: true,
            },
          ],
        },
        {
          docs: ['Emitted when a new market is supported.'],
          identifier: 'support_money_market_event',
          inputs: [
            {
              name: 'money_market',
              type: 'Address',
              indexed: true,
            },
          ],
        },
        {
          docs: [
            'Emitted when an account enters a market, i.e. deposits tokens as collateral.',
          ],
          identifier: 'enter_market_event',
          inputs: [
            {
              name: 'money_market',
              type: 'Address',
              indexed: true,
            },
            {
              name: 'borrower',
              type: 'Address',
              indexed: true,
            },
            {
              name: 'tokens',
              type: 'BigUint',
              indexed: true,
            },
          ],
        },
        {
          docs: [
            'Emitted when an account exits a market, i.e. removes tokens from collateral.',
          ],
          identifier: 'exit_market_event',
          inputs: [
            {
              name: 'money_market',
              type: 'Address',
              indexed: true,
            },
            {
              name: 'borrower',
              type: 'Address',
              indexed: true,
            },
            {
              name: 'tokens',
              type: 'BigUint',
              indexed: true,
            },
          ],
        },
        {
          docs: [
            'Emitted when an account exits a market and redeems in one shot.',
          ],
          identifier: 'exit_market_and_redeem_event',
          inputs: [
            {
              name: 'money_market',
              type: 'Address',
              indexed: true,
            },
            {
              name: 'redeemer',
              type: 'Address',
              indexed: true,
            },
            {
              name: 'underlying_payment',
              type: 'EgldOrEsdtTokenPayment',
              indexed: true,
            },
            {
              name: 'token_payment',
              type: 'EsdtTokenPayment',
              indexed: true,
            },
          ],
        },
        {
          docs: [
            'Emitted when a new maximum number of markets that can be entered per account is set.',
          ],
          identifier: 'new_max_markets_per_account_event',
          inputs: [
            {
              name: 'old_max_markets_per_account',
              type: 'u32',
              indexed: true,
            },
            {
              name: 'new_max_markets_per_account',
              type: 'u32',
              indexed: true,
            },
          ],
        },
        {
          docs: ['Emitted when a booster observer is set.'],
          identifier: 'set_booster_observer_event',
          inputs: [
            {
              name: 'rewards_booster',
              type: 'Address',
              indexed: true,
            },
          ],
        },
        {
          docs: ['Emitted when the booster observer is cleared.'],
          identifier: 'clear_booster_observer_event',
          inputs: [
            {
              name: 'rewards_booster',
              type: 'Address',
              indexed: true,
            },
          ],
        },
        {
          docs: ['Emitted when a USH Market observer is set.'],
          identifier: 'set_ush_market_observer_event',
          inputs: [
            {
              name: 'ush_market',
              type: 'Address',
              indexed: true,
            },
          ],
        },
        {
          docs: ['Emitted when the USH market observer is cleared.'],
          identifier: 'clear_ush_market_observer_event',
          inputs: [
            {
              name: 'ush_market',
              type: 'Address',
              indexed: true,
            },
          ],
        },
        {
          docs: [
            'Emitted when a new collateral factor is defined for a given money market.',
          ],
          identifier: 'new_collateral_factor_event',
          inputs: [
            {
              name: 'money_market',
              type: 'Address',
              indexed: true,
            },
            {
              name: 'old',
              type: 'BigUint',
              indexed: true,
            },
            {
              name: 'new',
              type: 'BigUint',
              indexed: true,
            },
          ],
        },
        {
          docs: [
            'Emitted when a new USH borrower collateral factor is defined for a given money market.',
          ],
          identifier: 'new_ush_borrower_collateral_factor_event',
          inputs: [
            {
              name: 'money_market',
              type: 'Address',
              indexed: true,
            },
            {
              name: 'old',
              type: 'BigUint',
              indexed: true,
            },
            {
              name: 'new',
              type: 'BigUint',
              indexed: true,
            },
          ],
        },
        {
          docs: ['Emitted when next collateral factors are set.'],
          identifier: 'new_next_collateral_factors_event',
          inputs: [
            {
              name: 'timestamp',
              type: 'u64',
              indexed: true,
            },
            {
              name: 'next_collateral_factor',
              type: 'BigUint',
              indexed: true,
            },
            {
              name: 'next_ush_borrower_collateral_factor',
              type: 'BigUint',
              indexed: true,
            },
          ],
        },
        {
          docs: ['Emitted when next collateral factors are cleared.'],
          identifier: 'clear_next_collateral_factors_event',
          inputs: [],
        },
        {
          docs: ['Emitted when the price oracle is modified.'],
          identifier: 'new_price_oracle_event',
          inputs: [
            {
              name: 'old',
              type: 'Option<Address>',
              indexed: true,
            },
            {
              name: 'new',
              type: 'Address',
              indexed: true,
            },
          ],
        },
        {
          docs: [
            'Emitted when a new liquidity cap is defined for a given money market.',
          ],
          identifier: 'new_liquidity_cap_event',
          inputs: [
            {
              name: 'money_market',
              type: 'Address',
              indexed: true,
            },
            {
              name: 'old',
              type: 'Option<BigUint>',
              indexed: true,
            },
            {
              name: 'new',
              type: 'BigUint',
              indexed: true,
            },
          ],
        },
        {
          docs: [
            'Emitted when a new borrow cap is defined for a given money market.',
          ],
          identifier: 'new_borrow_cap_event',
          inputs: [
            {
              name: 'money_market',
              type: 'Address',
              indexed: true,
            },
            {
              name: 'old',
              type: 'Option<BigUint>',
              indexed: true,
            },
            {
              name: 'new',
              type: 'BigUint',
              indexed: true,
            },
          ],
        },
        {
          docs: [
            'Emitted when a new maximum amount of rewards batches is defined for a given money market.',
          ],
          identifier: 'new_max_rewards_batches_event',
          inputs: [
            {
              name: 'money_market',
              type: 'Address',
              indexed: true,
            },
            {
              name: 'old',
              type: 'u32',
              indexed: true,
            },
            {
              name: 'new',
              type: 'u32',
              indexed: true,
            },
          ],
        },
        {
          docs: ['Emitted when a new maximum slippage is defined.'],
          identifier: 'new_max_slippage_event',
          inputs: [
            {
              name: 'old',
              type: 'BigUint',
              indexed: true,
            },
            {
              name: 'new',
              type: 'BigUint',
              indexed: true,
            },
          ],
        },
        {
          docs: ['Emitted when a new guardian is set.'],
          identifier: 'new_pause_guardian_event',
          inputs: [
            {
              name: 'old',
              type: 'Option<Address>',
              indexed: true,
            },
            {
              name: 'new',
              type: 'Address',
              indexed: true,
            },
          ],
        },
        {
          docs: ['Emitted when a new rewards manager is set.'],
          identifier: 'new_rewards_manager_event',
          inputs: [
            {
              name: 'old',
              type: 'Option<Address>',
              indexed: true,
            },
            {
              name: 'new',
              type: 'Address',
              indexed: true,
            },
          ],
        },
        {
          docs: ['Event emitted when mint is paused or unpaused.'],
          identifier: 'mint_paused_event',
          inputs: [
            {
              name: 'money_market',
              type: 'Address',
              indexed: true,
            },
            {
              name: 'paused',
              type: 'bool',
              indexed: true,
            },
          ],
        },
        {
          docs: ['Event emitted when borrow is paused or unpaused.'],
          identifier: 'borrow_paused_event',
          inputs: [
            {
              name: 'money_market',
              type: 'Address',
              indexed: true,
            },
            {
              name: 'paused',
              type: 'bool',
              indexed: true,
            },
          ],
        },
        {
          docs: ['Event emitted when seize is paused or unpaused.'],
          identifier: 'seize_paused_event',
          inputs: [
            {
              name: 'money_market',
              type: 'Address',
              indexed: true,
            },
            {
              name: 'paused',
              type: 'bool',
              indexed: true,
            },
          ],
        },
        {
          docs: ['Event emitted when global seize is paused or unpaused.'],
          identifier: 'global_seize_paused_event',
          inputs: [
            {
              name: 'paused',
              type: 'bool',
              indexed: true,
            },
          ],
        },
        {
          docs: ['Event emitted when supplier rewards are distributed.'],
          identifier: 'supplier_rewards_distributed_event',
          inputs: [
            {
              name: 'supplier',
              type: 'Address',
              indexed: true,
            },
            {
              name: 'rewards_batch',
              type: 'RewardsBatch',
              indexed: true,
            },
            {
              name: 'delta_rewards',
              type: 'BigUint',
              indexed: true,
            },
          ],
        },
        {
          docs: ['Event emitted when borrower rewards are distributed.'],
          identifier: 'borrower_rewards_distributed_event',
          inputs: [
            {
              name: 'borrower',
              type: 'Address',
              indexed: true,
            },
            {
              name: 'rewards_batch',
              type: 'RewardsBatch',
              indexed: true,
            },
            {
              name: 'delta_rewards',
              type: 'BigUint',
              indexed: true,
            },
          ],
        },
        {
          docs: ['Event emitted when rewards are claimed by a user.'],
          identifier: 'rewards_claimed_event',
          inputs: [
            {
              name: 'claimer',
              type: 'Address',
              indexed: true,
            },
            {
              name: 'rewards_batch',
              type: 'RewardsBatch',
              indexed: true,
            },
            {
              name: 'claimed_amount',
              type: 'BigUint',
              indexed: true,
            },
          ],
        },
        {
          docs: ['Event emitted when user rewards are claimed.'],
          identifier: 'rewards_token_claimed_event',
          inputs: [
            {
              name: 'claimer',
              type: 'Address',
              indexed: true,
            },
            {
              name: 'rewards_token_id',
              type: 'EgldOrEsdtTokenIdentifier',
              indexed: true,
            },
            {
              name: 'claimed_amount',
              type: 'BigUint',
              indexed: true,
            },
          ],
        },
        {
          docs: ['Event emitted when a rewards batch is set.'],
          identifier: 'set_rewards_batch_event',
          inputs: [
            {
              name: 'caller',
              type: 'Address',
              indexed: true,
            },
            {
              name: 'rewards_batch',
              type: 'RewardsBatch',
              indexed: true,
            },
          ],
        },
        {
          docs: ['Event emitted when a rewards batch adds more rewards.'],
          identifier: 'add_rewards_batch_event',
          inputs: [
            {
              name: 'caller',
              type: 'Address',
              indexed: true,
            },
            {
              name: 'rewards_batch',
              type: 'RewardsBatch',
              indexed: true,
            },
          ],
        },
        {
          docs: ['Event emitted when a rewards batch is cancelled.'],
          identifier: 'cancel_rewards_batch_event',
          inputs: [
            {
              name: 'caller',
              type: 'Address',
              indexed: true,
            },
            {
              name: 'rewards_batch',
              type: 'RewardsBatch',
              indexed: true,
            },
          ],
        },
        {
          docs: ['Event emitted when a rewards batch is removed.'],
          identifier: 'remove_rewards_batch_event',
          inputs: [
            {
              name: 'money_market',
              type: 'Address',
              indexed: true,
            },
            {
              name: 'batch_id',
              type: 'u32',
              indexed: true,
            },
          ],
        },
        {
          docs: ['Event emitted when the rewards batch speed is updated.'],
          identifier: 'update_rewards_batch_speed_event',
          inputs: [
            {
              name: 'caller',
              type: 'Address',
              indexed: true,
            },
            {
              name: 'rewards_batch',
              type: 'RewardsBatch',
              indexed: true,
            },
          ],
        },
        {
          docs: [
            'Event emitted when the remaining period of a rewards batch is updated.',
          ],
          identifier: 'update_rewards_batch_remaining_period_event',
          inputs: [
            {
              name: 'caller',
              type: 'Address',
              indexed: true,
            },
            {
              name: 'rewards_batch',
              type: 'RewardsBatch',
              indexed: true,
            },
          ],
        },
        {
          docs: ['Event emitted when the undistributed rewards are claimed.'],
          identifier: 'claim_undistributed_rewards_event',
          inputs: [
            {
              name: 'caller',
              type: 'Address',
              indexed: true,
            },
            {
              name: 'rewards_token_id',
              type: 'EgldOrEsdtTokenIdentifier',
              indexed: true,
            },
            {
              name: 'claimed_amount',
              type: 'BigUint',
              indexed: true,
            },
          ],
        },
        {
          docs: [
            'Event emitted when the supply rewards batch index is updated.',
          ],
          identifier: 'supply_rewards_batches_updated_event',
          inputs: [
            {
              name: 'rewards_batch',
              type: 'RewardsBatch',
              indexed: true,
            },
          ],
        },
        {
          docs: [
            'Event emitted when the borrow rewards batch index is updated.',
          ],
          identifier: 'borrow_rewards_batches_updated_event',
          inputs: [
            {
              name: 'rewards_batch',
              type: 'RewardsBatch',
              indexed: true,
            },
          ],
        },
        {
          docs: ['Event emitted when rewards batch boosting is supported.'],
          identifier: 'support_rewards_batch_boosting_event',
          inputs: [],
        },
        {
          docs: ['Event emitted when rewards batch boosting is enabled.'],
          identifier: 'enable_rewards_batch_boosting_event',
          inputs: [],
        },
        {
          docs: ['Event emitted when rewards batch boosting is disabled.'],
          identifier: 'disable_rewards_batch_boosting_event',
          inputs: [],
        },
        {
          docs: [
            'Event emitted when rewards are boosted for a specific rewards token.',
          ],
          identifier: 'boost_rewards_event',
          inputs: [
            {
              name: 'caller',
              type: 'Address',
              indexed: true,
            },
            {
              name: 'rewards_batch_booster',
              type: 'RewardsBooster',
              indexed: true,
            },
          ],
        },
        {
          docs: [
            'Event emitted when a booster is updated for a specific rewards token.',
          ],
          identifier: 'update_booster_event',
          inputs: [
            {
              name: 'caller',
              type: 'Address',
              indexed: true,
            },
            {
              name: 'rewards_batch_booster',
              type: 'RewardsBooster',
              indexed: true,
            },
          ],
        },
        {
          docs: [
            'Event emitted when a booster is cancelled for a specific rewards token.',
          ],
          identifier: 'cancel_booster_event',
          inputs: [
            {
              name: 'caller',
              type: 'Address',
              indexed: true,
            },
            {
              name: 'token_id',
              type: 'EgldOrEsdtTokenIdentifier',
              indexed: true,
            },
          ],
        },
        {
          docs: ['Event emitted when boosted rewards are claimed.'],
          identifier: 'boosted_rewards_claimed_event',
          inputs: [
            {
              name: 'claimer',
              type: 'Address',
              indexed: true,
            },
            {
              name: 'rewards_batch_booster',
              type: 'RewardsBooster',
              indexed: true,
            },
            {
              name: 'claimed_amount',
              type: 'BigUint',
              indexed: true,
            },
          ],
        },
      ],
      esdtAttributes: [],
      hasCallback: false,
      types: {
        EgldOrEsdtTokenPayment: {
          type: 'struct',
          fields: [
            {
              name: 'token_identifier',
              type: 'EgldOrEsdtTokenIdentifier',
            },
            {
              name: 'token_nonce',
              type: 'u64',
            },
            {
              name: 'amount',
              type: 'BigUint',
            },
          ],
        },
        EsdtTokenPayment: {
          type: 'struct',
          fields: [
            {
              name: 'token_identifier',
              type: 'TokenIdentifier',
            },
            {
              name: 'token_nonce',
              type: 'u64',
            },
            {
              name: 'amount',
              type: 'BigUint',
            },
          ],
        },
        MarketType: {
          type: 'enum',
          variants: [
            {
              name: 'Supply',
              discriminant: 0,
            },
            {
              name: 'Borrow',
              discriminant: 1,
            },
          ],
        },
        RewardsBatch: {
          type: 'struct',
          fields: [
            {
              name: 'id',
              type: 'u32',
            },
            {
              name: 'money_market',
              type: 'Address',
            },
            {
              name: 'market_type',
              type: 'MarketType',
            },
            {
              name: 'token_id',
              type: 'EgldOrEsdtTokenIdentifier',
            },
            {
              name: 'amount',
              type: 'BigUint',
            },
            {
              name: 'distributed_amount',
              type: 'BigUint',
            },
            {
              name: 'speed',
              type: 'BigUint',
            },
            {
              name: 'index',
              type: 'BigUint',
            },
            {
              name: 'last_time',
              type: 'u64',
            },
            {
              name: 'end_time',
              type: 'u64',
            },
          ],
        },
        RewardsBooster: {
          type: 'struct',
          fields: [
            {
              name: 'token_id',
              type: 'EgldOrEsdtTokenIdentifier',
            },
            {
              name: 'premium',
              type: 'BigUint',
            },
            {
              name: 'amount_left',
              type: 'BigUint',
            },
            {
              name: 'distributed_amount',
              type: 'BigUint',
            },
            {
              name: 'swap_path',
              type: 'List<SwapStep>',
            },
          ],
        },
        RiskProfile: {
          type: 'enum',
          variants: [
            {
              name: 'Solvent',
              discriminant: 0,
              fields: [
                {
                  name: '0',
                  type: 'BigUint',
                },
              ],
            },
            {
              name: 'RiskyOrInsolvent',
              discriminant: 1,
              fields: [
                {
                  name: '0',
                  type: 'BigUint',
                },
              ],
            },
          ],
        },
        State: {
          type: 'enum',
          variants: [
            {
              name: 'Inactive',
              discriminant: 0,
            },
            {
              name: 'Active',
              discriminant: 1,
            },
          ],
        },
        Status: {
          type: 'enum',
          variants: [
            {
              name: 'Active',
              discriminant: 0,
            },
            {
              name: 'Paused',
              discriminant: 1,
            },
          ],
        },
        SwapStep: {
          type: 'struct',
          fields: [
            {
              name: 'pair_address',
              type: 'Address',
            },
            {
              name: 'input_token_id',
              type: 'TokenIdentifier',
            },
            {
              name: 'output_token_id',
              type: 'TokenIdentifier',
            },
          ],
        },
      },
    } as any);

    return abi.cleanAbiDocs();
  }

  async generateAndIngestEmbeddingsForAllContracts() {
    const querySpec = new CosmosDbQueryBuilder()
      .where('dataType', 'sc-info', QueryConditionOperator.EQUAL)
      .buildSqlQuery();

    const resources =
      await this.cosmosDbService.queryWithFetchAll<SmartContractDoc[]>(
        querySpec,
      );

    for (const contractDoc of resources) {
      await this.generateAndIngestEmbeddings(contractDoc);
    }

    return resources;
  }

  async searchEndpoints(query: string, isWarp = false, creator?: string) {
    return this.test();
    const embeddingResponse =
      await this.azureOpenAiService.generateEmbedding(query);

    const searchResults = await this.azureSearchService.hybridSearch({
      searchText: query,
      vector: embeddingResponse[0].embedding,
      top: 10,
    });

    const contractCaches = new Map<string, SmartContractDoc>();

    const results = [];
    for (let index = 0; index < searchResults.length; index++) {
      const result = searchResults[index];

      const [address, endpoint] = result.document.id.split('_');
      let contract = contractCaches.get(address);
      if (!contract) {
        contract = await this.getContractByAddress(address);
        contractCaches.set(address, contract);
      }
      const endpointDetails = contract.abiJson.endpoints.find(
        (e) => e.name === endpoint,
      );
      if (endpointDetails) {
        const warpGenerator = new AbiWarpGenerator(creator, contract.abiJson);
        if (isWarp) {
          results.push(
            warpGenerator.endpointToWarp(
              contract.address,
              contract.name,
              endpointDetails,
            ),
          );
        } else {
          results.push({
            contractName: contract.name,
            contractDescription: contract.description,
            contractAddress: address,
            endpointDetails,
          });
        }
      }
    }

    return results;
  }
}
