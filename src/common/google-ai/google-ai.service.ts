import { GoogleGenerativeAI } from '@google/generative-ai';
import { Injectable } from '@nestjs/common';

export interface GoogleAiResponse {
  text?: string;
  error?: {
    message: string;
    code?: string;
  };
}

export interface GoogleAiError {
  error: {
    message: string;
    code?: string;
  };
}

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

  async chatCompletion(prompt: string): Promise<GoogleAiResponse> {
    try {
      const model = this.client.getGenerativeModel({
        model: 'gemini-2.0-flash', //'gemini-1.5-flash',
      });
      const result = await model.generateContent(prompt);

      if (!result.response.candidates?.[0]?.content?.parts?.[0]) {
        return this.createErrorResponse('Invalid response format');
      }

      return {
        text: result.response.candidates[0].content.parts[0].text || '',
      };
    } catch (error) {
      return this.createErrorResponse(
        error instanceof Error ? error.message : 'Unknown error occurred',
      );
    }
  }

  private createErrorResponse(message: string): GoogleAiError {
    return {
      error: {
        message,
        code: 'GOOGLE_AI_ERROR',
      },
    };
  }

  async generateEmbedding(text: string) {
    const model = this.client.getGenerativeModel({
      model: 'text-embedding-004',
    });

    const result = await model.embedContent(text);

    return result;
  }
}
