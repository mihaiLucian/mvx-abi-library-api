import { Injectable, Logger } from '@nestjs/common';
import { HttpService as NestHttpService } from '@nestjs/axios';
import { AxiosError } from 'axios';
import { catchError, firstValueFrom, throwError, timer } from 'rxjs';
import { retry } from 'rxjs/operators';
import { HttpError, HttpServiceConfig, RetryConfig } from './http.types';

@Injectable()
export class HttpService {
  private readonly logger = new Logger(HttpService.name);
  private readonly defaultConfig: HttpServiceConfig = {
    timeout: 10000, // 10 seconds
    retries: 0,
    retryDelay: 1000, // 1 second
  };

  constructor(
    private readonly httpService: NestHttpService,
    private readonly config: HttpServiceConfig = {},
  ) {
    this.config = { ...this.defaultConfig, ...config };
    this.setupInterceptors();
  }

  private setupInterceptors(): void {
    this.httpService.axiosRef.interceptors.request.use((config) => {
      //   this.logger.debug(`Making request to ${config.url}`);
      return config;
    });

    this.httpService.axiosRef.interceptors.response.use(
      (response) => {
        this.logger.debug(`Received response from ${response.config.url}`);
        return response;
      },
      (error) => {
        this.logger.error(`Request failed: ${error.message}`);
        return Promise.reject(error);
      },
    );
  }

  async get<T>(url: string, config?: RetryConfig): Promise<T> {
    return this.request<T>('GET', url, undefined, config);
  }

  async post<T>(url: string, data?: any, config?: RetryConfig): Promise<T> {
    return this.request<T>('POST', url, data, config);
  }

  async put<T>(url: string, data?: any, config?: RetryConfig): Promise<T> {
    return this.request<T>('PUT', url, data, config);
  }

  async delete<T>(url: string, config?: RetryConfig): Promise<T> {
    return this.request<T>('DELETE', url, undefined, config);
  }

  private async request<T>(
    method: string,
    url: string,
    data?: any,
    config?: RetryConfig,
  ): Promise<T> {
    const maxRetries = config?.retry ?? this.config.retries;
    const retryDelay = config?.retryDelay ?? this.config.retryDelay;

    const axiosConfig: RetryConfig = {
      ...config,
      method,
      url,
      data,
      timeout: config?.timeout ?? this.config.timeout,
    };

    try {
      const response = await firstValueFrom(
        this.httpService.request<T>(axiosConfig).pipe(
          retry({
            count: maxRetries,
            delay: (_error, attemptIndex) => {
              const currentAttempt = attemptIndex + 1;
              const totalAttempts = maxRetries + 1; // Include initial attempt

              this.logger.warn(
                `Request failed, making attempt ${currentAttempt} of ${totalAttempts}`,
              );
              return timer(retryDelay);
            },
          }),
          catchError((error) => throwError(() => this.handleError(error))),
        ),
      );

      return response.data;
    } catch (error) {
      throw this.handleError(error);
    }
  }

  private handleError(error: any): never {
    if (error instanceof HttpError) {
      throw error;
    }

    const axiosError = error as AxiosError;
    if (axiosError.response) {
      throw new HttpError(
        this.getErrorMessage(axiosError),
        axiosError.response.status,
        axiosError.code,
        axiosError,
      );
    }

    if (axiosError.request) {
      throw new HttpError(
        'No response received from server',
        0,
        'NO_RESPONSE',
        axiosError,
      );
    }

    throw new HttpError(
      `Request failed: ${error.message}`,
      0,
      'REQUEST_SETUP_ERROR',
      axiosError,
    );
  }

  private getErrorMessage(error: AxiosError): string {
    const response = error.response?.data;
    if (typeof response === 'string') {
      return response;
    }
    if (response && typeof response === 'object') {
      return (response as any).message || JSON.stringify(response);
    }
    return error.message;
  }
}
