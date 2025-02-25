const jsonBlockPattern = /```json\n([\s\S]*?)\n```/;

/**
 * Parses a JSON array from a given text. The function looks for a JSON block wrapped in triple backticks
 * with `json` language identifier, and if not found, it searches for an array pattern within the text.
 * It then attempts to parse the JSON string into a JavaScript object. If parsing is successful and the result
 * is an array, it returns the array; otherwise, it returns null.
 *
 * @param text - The input text from which to extract and parse the JSON array.
 * @returns An array parsed from the JSON string if successful; otherwise, null.
 */
export function parseJsonArrayFromText(text: string) {
  let jsonData = null;

  // First try to parse with the original JSON format
  const jsonBlockMatch = text.match(jsonBlockPattern);

  if (jsonBlockMatch) {
    try {
      // Only replace quotes that are actually being used for string delimitation
      const normalizedJson = jsonBlockMatch[1].replace(
        /(?<!\\)'([^']*)'(?=\s*[,}\]])/g,
        '"$1"',
      );
      jsonData = JSON.parse(normalizedJson);
    } catch (e) {
      console.error('Error parsing JSON:', e);
      console.error('Failed parsing text:', jsonBlockMatch[1]);
    }
  }

  // If that fails, try to find an array pattern
  if (!jsonData) {
    const arrayPattern = /\[\s*(['"])(.*?)\1\s*\]/;
    const arrayMatch = text.match(arrayPattern);

    if (arrayMatch) {
      try {
        // Only replace quotes that are actually being used for string delimitation
        const normalizedJson = arrayMatch[0].replace(
          /(?<!\\)'([^']*)'(?=\s*[,}\]])/g,
          '"$1"',
        );
        jsonData = JSON.parse(normalizedJson);
      } catch (e) {
        console.error('Error parsing JSON:', e);
        console.error('Failed parsing text:', arrayMatch[0]);
      }
    }
  }

  if (Array.isArray(jsonData)) {
    return jsonData;
  }

  return null;
}

/**
 * Parses a JSON object from a given text. The function looks for a JSON block wrapped in triple backticks
 * with `json` language identifier, and if not found, it searches for an object pattern within the text.
 * It then attempts to parse the JSON string into a JavaScript object. If parsing is successful and the result
 * is an object (but not an array), it returns the object; otherwise, it tries to parse an array if the result
 * is an array, or returns null if parsing is unsuccessful or the result is neither an object nor an array.
 *
 * @param text - The input text from which to extract and parse the JSON object.
 * @returns An object parsed from the JSON string if successful; otherwise, null or the result of parsing an array.
 */
export function parseJSONObjectFromText(
  text: string,
): Record<string, any> | null {
  let jsonData = null;
  const jsonBlockMatch = text.match(jsonBlockPattern);

  if (jsonBlockMatch) {
    text = cleanJsonResponse(text);
    const parsingText = normalizeJsonString(text);
    try {
      jsonData = JSON.parse(parsingText);
    } catch (e) {
      console.error('Error parsing JSON:', e);
      console.error('Text is not JSON', text);
      return extractAttributes(text);
    }
  } else {
    const objectPattern = /{[\s\S]*?}?/;
    const objectMatch = text.match(objectPattern);

    if (objectMatch) {
      text = cleanJsonResponse(text);
      const parsingText = normalizeJsonString(text);
      try {
        jsonData = JSON.parse(parsingText);
      } catch (e) {
        console.error('Error parsing JSON:', e);
        console.error('Text is not JSON', text);
        return extractAttributes(text);
      }
    }
  }

  if (
    typeof jsonData === 'object' &&
    jsonData !== null &&
    !Array.isArray(jsonData)
  ) {
    return jsonData;
  } else if (typeof jsonData === 'object' && Array.isArray(jsonData)) {
    return parseJsonArrayFromText(text);
  } else {
    return null;
  }
}

/**
 * Normalizes a JSON-like string by correcting formatting issues:
 * - Removes extra spaces after '{' and before '}'.
 * - Wraps unquoted values in double quotes.
 * - Converts single-quoted values to double-quoted.
 * - Ensures consistency in key-value formatting.
 * - Normalizes mixed adjacent quote pairs.
 *
 * This is useful for cleaning up improperly formatted JSON strings
 * before parsing them into valid JSON.
 *
 * @param str - The JSON-like string to normalize.
 * @returns A properly formatted JSON string.
 */

export const normalizeJsonString = (str: string) => {
  // Remove extra spaces after '{' and before '}'
  str = str.replace(/\{\s+/, '{').replace(/\s+\}/, '}').trim();

  // "key": unquotedValue → "key": "unquotedValue"
  str = str.replace(
    /("[\w\d_-]+")\s*: \s*(?!"|\[)([\s\S]+?)(?=(,\s*"|\}$))/g,
    '$1: "$2"',
  );

  // "key": 'value' → "key": "value"
  str = str.replace(
    /"([^"]+)"\s*:\s*'([^']*)'/g,
    (_, key, value) => `"${key}": "${value}"`,
  );

  // "key": someWord → "key": "someWord"
  str = str.replace(/("[\w\d_-]+")\s*:\s*([A-Za-z_]+)(?!["\w])/g, '$1: "$2"');

  // Replace adjacent quote pairs with a single double quote
  str = str.replace(/(?:"')|(?:'")/g, '"');
  return str;
};

/**
 * Cleans a JSON-like response string by removing unnecessary markers, line breaks, and extra whitespace.
 * This is useful for handling improperly formatted JSON responses from external sources.
 *
 * @param response - The raw JSON-like string response to clean.
 * @returns The cleaned string, ready for parsing or further processing.
 */

export function cleanJsonResponse(response: string): string {
  return response
    .replace(/```json\s*/g, '') // Remove ```json
    .replace(/```\s*/g, '') // Remove any remaining ```
    .replace(/(\r\n|\n|\r)/g, '') // Remove line breaks
    .trim();
}

/**
 * Extracts specific attributes (e.g., user, text, action) from a JSON-like string using regex.
 * @param response - The cleaned string response to extract attributes from.
 * @param attributesToExtract - An array of attribute names to extract.
 * @returns An object containing the extracted attributes.
 */
export function extractAttributes(
  response: string,
  attributesToExtract?: string[],
): { [key: string]: string | undefined } {
  response = response.trim();
  const attributes: { [key: string]: string | undefined } = {};

  if (!attributesToExtract || attributesToExtract.length === 0) {
    // Extract all attributes if no specific attributes are provided
    const matches = response.matchAll(/"([^"]+)"\s*:\s*"([^"]*)"?/g);
    for (const match of matches) {
      attributes[match[1]] = match[2];
    }
  } else {
    // Extract only specified attributes
    attributesToExtract.forEach((attribute) => {
      const match = response.match(
        new RegExp(`"${attribute}"\\s*:\\s*"([^"]*)"?`, 'i'),
      );
      if (match) {
        attributes[attribute] = match[1];
      }
    });
  }

  return Object.entries(attributes).length > 0 ? attributes : null;
}
