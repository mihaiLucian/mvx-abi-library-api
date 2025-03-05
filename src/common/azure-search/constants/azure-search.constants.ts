/**
 * Special characters that need escaping in Azure Search queries
 * These characters have special meaning in Azure Cognitive Search query syntax
 */
export const AZURE_SEARCH_SPECIAL_CHARS = [
  '+',
  '-',
  '&',
  '|',
  '!',
  '(',
  ')',
  '{',
  '}',
  '[',
  ']',
  '^',
  '"',
  '~',
  '*',
  '?',
  ':',
  '\\',
  '/',
];

/**
 * Default highlighting configuration for search results
 */
export const defaultHighlightConfig = {
  fields: 'name,description',
  preTag: '<b>',
  postTag: '</b>',
};

/**
 * Escapes special characters in search text to ensure proper query handling
 * @param searchText The raw search text input
 * @returns Escaped search text safe for Azure Search
 */
export function escapeSearchSpecialChars(searchText: string): string {
  if (!searchText) return searchText;

  let escaped = searchText;
  for (const char of AZURE_SEARCH_SPECIAL_CHARS) {
    // Escape each special character with a backslash
    escaped = escaped.replace(new RegExp(`\\${char}`, 'g'), `\\${char}`);
  }
  return escaped;
}
