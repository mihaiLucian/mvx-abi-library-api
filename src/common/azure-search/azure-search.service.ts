import {
  AzureKeyCredential,
  SearchClient,
  SearchIndex,
  SearchIndexClient,
  VectorizedQuery,
  SearchOptions,
} from '@azure/search-documents';
import { Injectable, Logger } from '@nestjs/common';
import {
  defaultHighlightConfig,
  escapeSearchSpecialChars,
} from './constants/azure-search.constants';
import {
  SearchDocument,
  SearchParameters,
  SearchResult,
} from './types/search.types';

/**
 * Service responsible for interacting with Azure Cognitive Search
 *
 * Provides functionality for:
 * - Performing hybrid (text + vector) searches
 * - Managing search indexes and documents
 * - Processing and optimizing search queries
 */
@Injectable()
export class AzureSearchService {
  private readonly logger = new Logger(AzureSearchService.name);
  private readonly apiKey: string;
  private readonly endpoint: string;
  private readonly indexName = 'abi-data';
  private readonly searchClient: SearchClient<SearchDocument>;

  /**
   * Creates an instance of AzureSearchService
   *
   * @throws Error when required environment variables are missing
   */
  constructor() {
    // Validate environment configuration
    this.apiKey = this.getRequiredEnvVar('AZURE_SEARCH_KEY');
    this.endpoint = this.getRequiredEnvVar('AZURE_SEARCH_ENDPOINT');

    // Initialize search client
    this.searchClient = this.createSearchClient(this.indexName);
  }

  /**
   * Searches documents using configurable parameters
   *
   * @param params - Search configuration (text, filters, pagination, etc.)
   * @returns Promise with matching documents and metadata
   */
  async search(
    params: SearchParameters = {},
  ): Promise<SearchResult<SearchDocument>[]> {
    return this.hybridSearch({
      searchText: params.searchText || '*',
      top: params.top || 1000,
      skip: params.skip || 0,
      filters: params.filters,
      orderBy: params.orderBy,
      select: params.select,
      useFuzzySearch: params.useFuzzySearch,
      wildcardSearch: params.wildcardSearch,
      vector: params.vector,
    });
  }

  /**
   * Performs a hybrid search combining text and vector search capabilities
   *
   * @param params - Search parameters for both text and vector search
   * @returns Promise with search results and relevance metadata
   * @throws Error if search operation fails
   */
  async hybridSearch(
    params: SearchParameters,
  ): Promise<SearchResult<SearchDocument>[]> {
    try {
      // Extract and prepare parameters
      const {
        searchText = '',
        vector,
        filters,
        top = 10,
        skip = 0,
        orderBy,
        select,
        useFuzzySearch = false,
        wildcardSearch = false,
      } = params;

      // Process the search query with appropriate text handling
      const processedQuery = this.prepareSearchQuery(
        searchText,
        useFuzzySearch,
        wildcardSearch,
      );

      // Configure base search options
      const searchOptions = this.buildSearchOptions({
        top,
        skip,
        filters,
        orderBy,
        select,
        vector,
      });

      // Execute search and collect results
      const searchResults = await this.executeSearch(
        processedQuery,
        searchOptions,
      );

      this.logger.debug(
        `Found ${searchResults.length} results for query: "${processedQuery}" (original: "${searchText}")`,
      );

      return searchResults;
    } catch (error) {
      this.logger.error(`Hybrid search failed: ${error.message}`, error.stack);
      throw error;
    }
  }

  /**
   * Uploads or merges documents into the search index
   *
   * @param documents - Array of documents to upload or merge
   * @returns Promise with operation result
   * @throws Error if upload operation fails
   */
  async mergeOrUploadDocuments(documents: SearchDocument[]) {
    try {
      const result = await this.searchClient.mergeOrUploadDocuments(documents);
      this.logger.debug(`Successfully uploaded ${documents.length} documents`);
      return result;
    } catch (error) {
      this.logger.error(
        `Document upload failed: ${error.message}`,
        error.stack,
      );
      throw error;
    }
  }

  /**
   * Deletes documents from the search index
   *
   * @param documents - Array of documents to delete
   * @returns Promise indicating completion
   * @throws Error if delete operation fails
   */
  async deleteAllDocuments(documents: SearchDocument[]) {
    try {
      await this.searchClient.deleteDocuments(documents);
      this.logger.debug(`Successfully deleted ${documents.length} documents`);
    } catch (error) {
      this.logger.error(
        `Document deletion failed: ${error.message}`,
        error.stack,
      );
      throw error;
    }
  }

  /**
   * Creates a new search index with vector search capabilities
   *
   * @returns Promise indicating completion
   * @throws Error if index creation fails
   */
  async createIndex() {
    try {
      const adminClient = this.getAdminIndexClient();
      const index = this.buildSearchIndexDefinition();

      await adminClient.createIndex(index);
      this.logger.log(`Successfully created index: ${this.indexName}`);
    } catch (error) {
      this.logger.error(`Index creation failed: ${error.message}`, error.stack);
      throw error;
    }
  }

  /**
   * Builds the complete search index definition
   * Without vector search
   */
  private buildSearchIndexDefinition(): SearchIndex {
    return {
      name: this.indexName,
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
          searchable: true,
          filterable: true,
          sortable: true,
          facetable: true,
          hidden: false,
        },
        {
          name: 'embeddings',
          type: 'Collection(Edm.Single)',
          hidden: true,
          searchable: true,
          filterable: false,
          stored: true,
          sortable: false,
          facetable: false,
          key: false,
          vectorSearchDimensions: 1536,
          vectorSearchProfileName: 'vectorConfig-profile',
        },
      ],
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
    };
  }

  /**
   * Builds search options for a query
   *
   * @param options - Configuration options for search
   * @returns Complete search options object
   */
  private buildSearchOptions({
    top,
    skip,
    filters,
    orderBy,
    select,
    vector,
  }: {
    top: number;
    skip: number;
    filters?: string;
    orderBy?: string[];
    select?: string[];
    vector?: number[];
  }): SearchOptions<SearchDocument> {
    // Build base search options
    const searchOptions: SearchOptions<SearchDocument> = {
      top,
      skip,
      includeTotalCount: true,
      filter: filters,
      orderBy,
      select,
      scoringProfile: 'boostNameAndType',
      // highlightFields: defaultHighlightConfig.fields,
      // highlightPreTag: defaultHighlightConfig.preTag,
      // highlightPostTag: defaultHighlightConfig.postTag,
    };

    // Add vector search options if vector is provided
    if (vector?.length) {
      const vectorQuery: VectorizedQuery<SearchDocument> = {
        kind: 'vector',
        vector,
        fields: ['embeddings'],
        kNearestNeighborsCount: 10,
        weight: 3,
        exhaustive: true,
      };

      searchOptions.vectorSearchOptions = {
        queries: [vectorQuery],
      };
    }

    return searchOptions;
  }

  /**
   * Executes a search query and processes the results
   *
   * @param searchText - Processed search query text
   * @param options - Search options
   * @returns Promise with search results
   */
  private async executeSearch(
    searchText: string,
    options: SearchOptions<SearchDocument>,
  ): Promise<SearchResult<SearchDocument>[]> {
    const searchResults = await this.searchClient.search(
      searchText || '*',
      options,
    );

    const results: SearchResult<SearchDocument>[] = [];

    for await (const result of searchResults.results) {
      results.push({
        document: result.document,
        score: result.score,
        highlights: result.highlights,
      });
    }

    return results;
  }

  /**
   * Prepares search text based on search parameters
   *
   * @param searchText - The original search text
   * @param useFuzzySearch - Whether to enable fuzzy search
   * @param wildcardSearch - Whether to apply wildcards for partial matching
   * @returns Processed search text with appropriate syntax
   */
  private prepareSearchQuery(
    searchText: string,
    useFuzzySearch = false,
    wildcardSearch = false,
  ): string {
    if (!searchText || searchText === '*') return '*';

    // Escape special characters first
    let processedText = escapeSearchSpecialChars(searchText);

    // Apply fuzzy search to each term
    if (useFuzzySearch) {
      processedText = processedText
        .split(' ')
        .map((term) => (term.length > 3 ? `${term}~1` : term))
        .join(' ');
    }

    // Apply wildcards for partial matching
    if (wildcardSearch) {
      processedText = processedText
        .split(' ')
        .map((term) => (term.length > 3 ? `*${term}*` : term))
        .join(' ');
    }

    return processedText;
  }

  /**
   * Gets a required environment variable
   *
   * @param name - Environment variable name
   * @returns The environment variable value
   * @throws Error when environment variable is not defined
   */
  private getRequiredEnvVar(name: string): string {
    const value = process.env[name];
    if (!value) {
      throw new Error(`Environment variable ${name} is not defined`);
    }
    return value;
  }

  /**
   * Creates a search client for a specific index
   *
   * @param indexName - Name of the search index
   * @returns Configured search client
   */
  private createSearchClient(indexName: string): SearchClient<SearchDocument> {
    return new SearchClient<SearchDocument>(
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

  /**
   * Gets admin client for index management operations
   */
  private getAdminIndexClient() {
    return new SearchIndexClient(this.endpoint, this.getAzureKeyCredential());
  }

  /**
   * Creates an Azure credential object from the API key
   */
  private getAzureKeyCredential() {
    return new AzureKeyCredential(this.apiKey);
  }
}
