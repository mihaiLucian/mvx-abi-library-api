import { AxiosError, AxiosRequestConfig } from 'axios';

export interface HttpServiceConfig {
  baseURL?: string;
  timeout?: number;
  retries?: number;
  retryDelay?: number;
}

export class HttpError extends Error {
  constructor(
    message: string,
    public readonly status?: number,
    public readonly code?: string,
    public readonly original?: AxiosError,
  ) {
    super(message);
    this.name = 'HttpError';
  }
}

export interface RetryConfig extends AxiosRequestConfig {
  retry?: number;
  retryDelay?: number;
}
