import {
  AzureKeyCredential,
  SearchClient,
  SearchIndex,
  SearchIndexClient,
} from '@azure/search-documents';
import { Injectable } from '@nestjs/common';

@Injectable()
export class AzureSearchService {
  private readonly apiKey: string;
  private readonly endpoint: string;
  private readonly userDataClient: SearchClient<any>;

  constructor() {
    if (!process.env.AZURE_SEARCH_KEY) {
      throw new Error('AZURE_SEARCH_KEY is not defined');
    }
    this.apiKey = process.env.AZURE_SEARCH_KEY;

    if (!process.env.AZURE_SEARCH_ENDPOINT) {
      throw new Error('AZURE_SEARCH_ENDPOINT is not defined');
    }
    this.endpoint = process.env.AZURE_SEARCH_ENDPOINT;
    this.userDataClient = this.getSearchClient('abi-data');
  }

  // TODO: Allow custom top and other options
  async hybridSearch(text: string, vector: number[]) {
    const searchResults = await this.userDataClient.search(text, {
      vectorSearchOptions: {
        queries: [
          {
            kind: 'vector',
            exhaustive: true,
            vector: vector,
            fields: ['embeddings'],
            kNearestNeighborsCount: 10,
          },
        ],
      },
      top: 10,
    });

    const results: any[] = [];

    for await (const result of searchResults.results) {
      results.push({
        ...result.document,
      });
    }

    return results;
  }

  async deleteAllDocuments(docs: any[]) {
    await this.userDataClient.deleteDocuments(docs);
  }

  // TODO: review this
  async search(text: string) {
    const searchResults = await this.userDataClient.search('*', {
      top: 1000,
    });

    const results: any[] = [];

    for await (const result of searchResults.results) {
      results.push({
        ...result.document,
      });
    }

    return results;
  }

  async mergeOrUploadDocuments(data: any) {
    await this.userDataClient.mergeOrUploadDocuments(data);
  }

  async createIndex() {
    const indexName = 'abi-data';
    const client = this.getAdminIndexClient();
    const index: SearchIndex = {
      name: indexName,
      vectorSearch: {
        algorithms: [
          {
            name: 'vectorConfig',
            kind: 'hnsw',
            parameters: {
              metric: 'cosine',
              m: 4,
              efConstruction: 400,
              efSearch: 500,
            },
          },
        ],
        profiles: [
          {
            name: 'vectorConfig-profile',
            algorithmConfigurationName: 'vectorConfig',
          },
        ],
      },
      fields: [
        {
          name: 'id',
          type: 'Edm.String',
          key: true,
          searchable: false,
          hidden: false,
        },
        {
          name: 'name',
          type: 'Edm.String',
          searchable: true,
          filterable: true,
          sortable: true,
          facetable: true,
          hidden: false,
        },
        {
          name: 'description',
          type: 'Edm.String',
          searchable: true,
          filterable: false,
          sortable: false,
          hidden: false,
        },
        {
          name: 'type',
          type: 'Edm.String',
          searchable: false,
          filterable: true,
          sortable: false,
          hidden: false,
        },
      ],
    };

    await client.createIndex(index);
  }

  private getAdminIndexClient() {
    return new SearchIndexClient(this.endpoint, this.getAzureKeyCredential());
  }

  private getSearchClient(indexName: string) {
    return new SearchClient(
      this.endpoint,
      indexName,
      this.getAzureKeyCredential(),
      {
        retryOptions: {
          maxRetries: 2,
          maxRetryDelayInMs: 5000,
        },
      },
    );
  }

  private getAzureKeyCredential() {
    return new AzureKeyCredential(this.apiKey);
  }
}
