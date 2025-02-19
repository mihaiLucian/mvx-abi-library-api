import { GoogleGenerativeAI } from '@google/generative-ai';
import { Injectable } from '@nestjs/common';

@Injectable()
export class GoogleAiService {
  private readonly apiKey: string;
  private readonly client: GoogleGenerativeAI;
  constructor() {
    if (!process.env.GOOGLE_AI_KEY) {
      throw new Error('GOOGLE_AI_KEY is not defined');
    }
    this.apiKey = process.env.GOOGLE_AI_KEY;
    this.client = new GoogleGenerativeAI(this.apiKey);
  }
  
  async chatCompletion(prompt: string) {
    const model = this.client.getGenerativeModel({ model: 'gemini-1.5-flash' });

    const result = await model.generateContent(prompt);

    return result;
  }

  async generateEmbedding(text: string) {
    const model = this.client.getGenerativeModel({
      model: 'text-embedding-004',
    });

    const result = await model.embedContent(text);

    return result;
  }
}
