import {
  DefaultAzureCredential,
  getBearerTokenProvider,
} from '@azure/identity';
import { Injectable } from '@nestjs/common';
import OpenAI, { AzureOpenAI } from 'openai';

@Injectable()
export class AzureOpenaiService {
  private readonly apiKey: string;
  private readonly endpoint: string;
  constructor() {
    if (!process.env.AZURE_OPEN_AI_KEY) {
      throw new Error('AZURE_OPEN_AI_KEY is not defined');
    }
    this.apiKey = process.env.AZURE_OPEN_AI_KEY;
    if (!process.env.AZURE_OPEN_AI_ENDPOINT) {
      throw new Error('AZURE_OPEN_AI_ENDPOINT is not defined');
    }
    this.endpoint = process.env.AZURE_OPEN_AI_ENDPOINT;
  }

  async generateEmbedding(text: string) {
    const client = this.getClient();
    const response = await client.embeddings.create({
      model: 'text-embedding-3-large',
      input: text,
    });

    return response.data;
  }

  private getClient() {
    const deployment = 'text-embedding-3-large';
    const apiVersion = '2024-10-21';
    const client = new AzureOpenAI({
      apiKey: this.apiKey,
      endpoint: this.endpoint,
      apiVersion: apiVersion,
      deployment: deployment,
    });

    return client;
  }
}
