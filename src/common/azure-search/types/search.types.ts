/**
 * Represents a document stored in Azure Search
 */
export interface SearchDocument {
  id: string;
  name: string;
  description?: string;
  type: string;
  [key: string]: any; // For any additional fields
}

/**
 * Parameters for configuring search operations
 */
export interface SearchParameters {
  searchText?: string;
  vector?: number[];
  filters?: string;
  top?: number;
  skip?: number;
  orderBy?: string[];
  select?: string[];
  semanticConfiguration?: string;
  useSemanticSearch?: boolean;
  useFuzzySearch?: boolean;
  wildcardSearch?: boolean;
}

/**
 * Search result containing the document and metadata
 */
export interface SearchResult<T> {
  document: T;
  score?: number;
  highlights?: Record<string, string[]>;
  semanticScore?: number;
}
