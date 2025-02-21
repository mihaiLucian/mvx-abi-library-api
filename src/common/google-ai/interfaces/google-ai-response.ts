interface GoogleGenerateFunctionCall {
  name: string;
  args: Record<string, any>;
}

interface GoogleResponseCandidate {
  content: {
    parts: {
      text?: string;
      thought?: string; // for models like gemini-2.0-flash-thinking-exp refer: https://ai.google.dev/gemini-api/docs/thinking-mode#streaming_model_thinking
      functionCall?: GoogleGenerateFunctionCall;
    }[];
  };
  logprobsResult?: {
    topCandidates: [
      {
        candidates: [
          {
            token: string;
            logProbability: number;
          },
        ];
      },
    ];
    chosenCandidates: [
      {
        token: string;
        logProbability: number;
      },
    ];
  };
  finishReason: string;
  index: 0;
  safetyRatings: {
    category: string;
    probability: string;
  }[];
  groundingMetadata?: {
    webSearchQueries?: string[];
    searchEntryPoint?: {
      renderedContent: string;
    };
    groundingSupports?: Array<{
      segment: {
        startIndex: number;
        endIndex: number;
        text: string;
      };
      groundingChunkIndices: number[];
      confidenceScores: number[];
    }>;
    retrievalMetadata?: {
      webDynamicRetrievalScore: number;
    };
  };
}

export interface GoogleGenerateContentResponse {
  modelVersion: string;
  candidates: GoogleResponseCandidate[];
  promptFeedback: {
    safetyRatings: {
      category: string;
      probability: string;
    }[];
  };
  usageMetadata: {
    promptTokenCount: number;
    candidatesTokenCount: number;
    totalTokenCount: number;
  };
}
