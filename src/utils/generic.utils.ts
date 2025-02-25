export class GenericUtils {
  /**
   * Converts a camelCase or snake_case string to human readable format
   * @param str - The string to humanize
   * @returns A human readable string with spaces and proper capitalization
   */
  static humanizeString(str: string): string {
    if (!str) return '';

    // First handle snake_case
    let humanized = str.replace(/_/g, ' ');

    // Then handle camelCase
    humanized = humanized.replace(/([A-Z])/g, ' $1');

    // Clean up multiple spaces and trim
    humanized = humanized.replace(/\s+/g, ' ').trim();

    // Capitalize first letter, rest lowercase
    return humanized.charAt(0).toUpperCase() + humanized.slice(1).toLowerCase();
  }

  static capitalizeFirstLetter(str: string): string {
    return str.charAt(0).toUpperCase() + str.slice(1);
  }

  static async sleep(milliseconds: number) {
    return await new Promise((resolve) => setTimeout(resolve, milliseconds));
  }
}
