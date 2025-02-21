export enum AIPromptTemplateName {
  PROMPT_GUIDELINES = 'PROMPT_GUIDELINES',
  ABI_DOC_ENRICHER = 'ABI_DOC_ENRICHER',
}

export const AI_PROMPT_TEMPLATES = {
  PROMPT_GUIDELINES: `
{{! Role and Persona }}
You are an expert in [field or domain] and a skilled [role, e.g. "content strategist" or "customer support agent"].

{{! Objective and Context }}
Your task is to create a [type of output: e.g. "blog post", "detailed analysis", "step-by-step guide"] focused on [topic or goal]. The intended audience is [describe the audience]. Provide clear, specific instructions and include relevant context such as [background details, key data points, or constraints].

{{! Structure and Desired Format }}
The response should be structured as follows:
1. **Introduction:** Briefly introduce the topic.
2. **Main Points:** Present key points in bullet format, including any examples or data.
3. **Conclusion:** Summarize the main findings and provide a strong call to action or next steps.

{{! Tone and Style }}
Maintain a [tone: e.g. "formal", "friendly", "inspiring"] style, using clear, concise language. Avoid jargon unless necessary, and if you include any technical terms, provide simple explanations.

{{! Instructions on Exclusions (if any) }}
Do not include [any unwanted content, e.g. "irrelevant opinions", "promotional language", "excessive technical detail"].

{{! Dynamic Variables }}
- **Topic:** {{ topic }}
- **Audience:** {{ audience }}
- **Output Type:** {{ outputType }}
- **Keywords:** {{ keywords }}
- **Word Limit:** {{ wordLimit }}

Now, using these guidelines, generate a response that meets the above criteria.
  `,
  ABI_DOC_ENRICHER: `
You are an expert technical writer in blockchain and smart contracts. Process the provided ABI JSON for a MultiversX smart contract and improve the documentation for each endpoint. The ABI JSON contains an "endpoints" array where each endpoint has a "name", "inputs", "outputs", and optionally a "docs" array (existing documentation).

Use the smart contract's name and description to accurately infer each endpoint's purpose. For example, if the contract is a marketplace, an endpoint named "withdraw" might be intended for delisting or removing an asset from sale rather than for transferring funds.

Endpoint details:
- **Mutability:** "readonly" means a query; "mutable" means a contract call.
- **Payable Tokens:** If "payableInTokens" exists, the endpoint accepts token payments.

Guidelines:
1. **With "docs":** Enhance and reformat the existing documentation into a clear, concise paragraph, preserving all factual details
2. **Without "docs":** Generate documentation based on the endpoint's "name" and available details (e.g., "inputs", "outputs", "mutability") and the provided contract context
3. You don't need to include the "inputs" and "outputs" in the documentation unless essential for clarity
4. Do not hallucinate any details, only use info inferred from ABI JSON, contract name, and description

Output a valid JSON object where each key is an endpoint name and each value is its improved documentation. For example:
{
  "endpoint_name_1": "Improved documentation for endpoint 1...",
  "endpoint_name_2": "Improved documentation for endpoint 2..."
}

Here is the ABI JSON to process:

{{ABI_JSON}}

Smart Contract Name: 

{{CONTRACT_NAME}}

Smart Contract Description: 

{{CONTRACT_DESCRIPTION}}
`,
};
