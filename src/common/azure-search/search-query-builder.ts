import { escapeSearchSpecialChars } from './constants/azure-search.constants';

export class SearchQueryBuilder {
  private queryParts: string[] = [];
  private fuzzyEnabled = false;
  private wildcardEnabled = false;

  /**
   * Add a term to search for
   * @param term The search term to add
   */
  addTerm(term: string): SearchQueryBuilder {
    if (term && term.trim()) {
      this.queryParts.push(this.processSearchTerm(term.trim()));
    }
    return this;
  }

  /**
   * Enable fuzzy search for better matching with typos
   */
  enableFuzzySearch(): SearchQueryBuilder {
    this.fuzzyEnabled = true;
    return this;
  }

  /**
   * Enable wildcard search for partial matching
   */
  enableWildcardSearch(): SearchQueryBuilder {
    this.wildcardEnabled = true;
    return this;
  }

  /**
   * Process a search term based on current settings
   */
  private processSearchTerm(term: string): string {
    // Skip processing for very short terms
    if (term.length <= 2) return term;

    let processed = escapeSearchSpecialChars(term);

    if (this.fuzzyEnabled && term.length > 3) {
      processed = `${processed}~1`;
    }

    if (this.wildcardEnabled && term.length > 3) {
      processed = `*${processed}*`;
    }

    return processed;
  }

  /**
   * Build the final search query string
   */
  build(): string {
    if (this.queryParts.length === 0) return '*';
    return this.queryParts.join(' ');
  }
}
