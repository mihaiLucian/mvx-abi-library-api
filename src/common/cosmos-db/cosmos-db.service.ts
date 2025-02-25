import {
  BulkOptions,
  CosmosClient,
  ErrorResponse,
  FeedOptions,
  OperationInput,
  PatchOperation,
  RequestOptions,
  RestError,
  SqlQuerySpec,
} from '@azure/cosmos';

import { Injectable, Logger } from '@nestjs/common';
import { BatchUtils } from 'src/utils/batch.utils';
import { GenericUtils } from 'src/utils/generic.utils';

@Injectable()
export class CosmosDbService {
  private readonly logger = new Logger(CosmosDbService.name);
  constructor(
    private client: CosmosClient,
    private databaseId: string,
    private containerId: string,
  ) {}

  async callStoredProcedure<T>(
    storedProcedureId: string,
    partitionKey: string,
    params: any[],
  ): Promise<T> {
    try {
      const { resource } = await this.client
        .database(this.databaseId)
        .container(this.containerId)
        .scripts.storedProcedure(storedProcedureId)
        .execute(partitionKey, params);

      return this.deleteSystemProps(resource);
    } catch (error) {
      this.logger.error(error.message, {
        props: {
          databaseId: this.databaseId,
          containerId: this.containerId,
          storedProcedureId,
          params,
        },
      });

      throw new Error(error.message);
    }
  }

  async queryWithFetchNext<T>(
    querySpec: SqlQuerySpec,
    options?: FeedOptions,
  ): Promise<{
    resources: T;
    hasMoreResults: boolean;
    continuationToken: string;
  }> {
    try {
      const { resources, continuationToken, hasMoreResults } = await this.client
        .database(this.databaseId)
        .container(this.containerId)
        .items.query(querySpec, options)
        .fetchNext();

      return {
        resources: this.deleteSystemProps<T>(resources as T),
        hasMoreResults,
        continuationToken,
      };
    } catch (error) {
      this.logger.error(error.message, {
        props: {
          databaseId: this.databaseId,
          containerId: this.containerId,
          querySpec,
        },
      });

      throw new Error(error.message);
    }
  }

  async queryWithFetchAll<T>(
    querySpec: SqlQuerySpec,
    options?: FeedOptions,
    skipSystemProps = true,
  ): Promise<T> {
    try {
      const { resources, requestCharge } = await this.client
        .database(this.databaseId)
        .container(this.containerId)
        .items.query(querySpec, options)
        .fetchAll();

      return skipSystemProps
        ? this.deleteSystemProps<T>(resources as T)
        : (resources as T);
    } catch (error) {
      this.logger.error(error.message, {
        props: {
          databaseId: this.databaseId,
          containerId: this.containerId,
          querySpec,
        },
      });

      throw new Error(error.message);
    }
  }

  async upsertItem<T>(item: any, options?: RequestOptions): Promise<T> {
    try {
      const { resource, statusCode } = await this.client
        .database(this.databaseId)
        .container(this.containerId)
        .items.upsert(item, options);

      return this.deleteSystemProps<T>(resource as T);
    } catch (error) {
      const errorMessage = error?.message?.split(',')[0];
      this.logger.error(errorMessage, {
        props: {
          databaseId: this.databaseId,
          containerId: this.containerId,
          item,
        },
      });

      throw new Error(errorMessage);
    }
  }

  async patchItem<T>(
    docId: string,
    patchRequestBody: PatchOperation[],
    partitionKey?: string,
    options?: RequestOptions,
  ): Promise<T> {
    try {
      const documentChunks = BatchUtils.splitArrayIntoChunks(
        patchRequestBody,
        10,
      );
      let cosmosDbResult: { resource: T; statusCode: number };
      for (const chunk of documentChunks) {
        cosmosDbResult = await this.client
          .database(this.databaseId)
          .container(this.containerId)
          .item(docId, partitionKey)
          .patch(chunk, options);
      }
      return this.deleteSystemProps<T>(cosmosDbResult.resource);
    } catch (error) {
      const errorMessage = error?.message?.split(',')[0];
      this.logger.error(errorMessage, {
        props: {
          databaseId: this.databaseId,
          containerId: this.containerId,
          docId,
          partitionKey,
          patchRequestBody,
        },
      });

      throw new Error(errorMessage);
    }
  }

  async deleteItem<T>(
    docId: string,
    partitionKey?: string,
    options?: RequestOptions,
  ): Promise<T> {
    try {
      const { resource, statusCode } = await this.client
        .database(this.databaseId)
        .container(this.containerId)
        .item(docId, partitionKey)
        .delete(options);

      return this.deleteSystemProps(resource);
    } catch (error) {
      if (error instanceof ErrorResponse) {
        if (error.code === 404) {
          this.logger.warn(`CosmosDb delete error: NOT FOUND`, {
            props: {
              databaseId: this.databaseId,
              containerId: this.containerId,
              docId,
              partitionKey,
            },
          });
        } else {
          const errorMessage = error?.message?.split(',')[0];
          throw new Error(errorMessage);
        }
      } else if (error instanceof RestError) {
        if (error.code === '404') {
          this.logger.warn(`CosmosDb delete error: NOT FOUND`, {
            props: {
              databaseId: this.databaseId,
              containerId: this.containerId,
              docId,
              partitionKey,
            },
          });
        } else {
          const errorMessage = error?.message?.split(',')[0];
          throw new Error(errorMessage);
        }
      } else {
        const errorMessage = error?.message?.split(',')[0];
        this.logger.error(errorMessage, {
          props: {
            databaseId: this.databaseId,
            containerId: this.containerId,
            docId,
            partitionKey,
          },
        });

        throw new Error(errorMessage);
      }
    }
  }

  async readItem<T>(
    docId: string,
    partitionKey?: string,
    options?: RequestOptions,
  ): Promise<T> {
    try {
      const { resource, statusCode, requestCharge } = await this.client
        .database(this.databaseId)
        .container(this.containerId)
        .item(docId, partitionKey)
        .read(options);

      return this.deleteSystemProps(resource);
    } catch (error) {
      this.logger.error(error.message, {
        props: {
          databaseId: this.databaseId,
          containerId: this.containerId,
          docId,
          partitionKey,
        },
      });

      throw new Error(error.message);
    }
  }

  async performBulkOperation(
    bulkOperations: OperationInput[],
    bulkOptions?: BulkOptions,
    options?: RequestOptions,
  ) {
    try {
      const operationsResults = await this.client
        .database(this.databaseId)
        .container(this.containerId)
        .items.bulk(bulkOperations, bulkOptions, options);

      return operationsResults;
    } catch (error) {
      const errorMessage = error?.message?.split(',')[0];
      this.logger.error(errorMessage, {
        props: {
          databaseId: this.databaseId,
          containerId: this.containerId,
          bulkOperations,
        },
      });

      throw new Error(errorMessage);
    }
  }

  async performBulkOperationWithRetry<T>(
    operations: OperationInput[],
    maxRetries = 3,
    continueOnError = true,
  ): Promise<{ resourceBody: T }[]> {
    const allResults: any[] = [];
    const documentChunks = BatchUtils.splitArrayIntoChunks(operations, 100);

    for (const chunk of documentChunks) {
      let retries = 0;
      let currentChunk = chunk;

      while (retries < maxRetries) {
        const bulkResults = await this.performBulkOperation(
          currentChunk,
          { continueOnError },
          {
            disableRUPerMinuteUsage: true,
          },
        );
        const failedOperations: OperationInput[] = [];

        bulkResults.forEach((result, index) => {
          if (result.statusCode === 429) {
            // throttled, retry
            failedOperations.push(currentChunk[index]);
          } else if (result.statusCode >= 400) {
            // this.logger.error('Bulk operation failed', {
            //   props: { result, operation: currentChunk[index] },
            // });
            throw new Error('Bulk operation failed');
          }
        });

        allResults.push(...bulkResults);

        if (failedOperations.length === 0) {
          break; // No failed operations, exit the loop
        }

        // Retry only the failed operations with exponential backoff
        const initialSleep = 100;
        retries++;
        const backoffTime = Math.pow(2, retries) * initialSleep; // Exponential backoff

        await GenericUtils.sleep(backoffTime);
        // Retry only failed operations
        currentChunk = failedOperations;
      }

      if (retries === maxRetries) {
        throw new Error(
          `Max retries reached. Unable to complete bulk operation for chunk.`,
        );
      }
    }

    return this.deleteSystemProps(
      allResults.filter((result) => result.statusCode !== 404),
    );
  }

  private deleteSystemProps<T>(documents: T): T {
    if (!documents) {
      return documents;
    }

    const keysToDelete = new Set(['_rid', '_self', '_etag', '_attachments']);
    const cache = new Map();

    const deletePropsInner = (doc: T): T => {
      if (cache.has(doc)) {
        return cache.get(doc)!;
      }

      Object.keys(doc).forEach((key) => {
        const value = doc[key];
        if (value && typeof value === 'object' && !Array.isArray(value)) {
          doc[key] = deletePropsInner(value as T);
        }
        if (keysToDelete.has(key)) {
          delete doc[key];
        }
      });

      cache.set(doc, doc);
      return doc;
    };

    try {
      if (Array.isArray(documents)) {
        return documents.map((doc) => deletePropsInner(doc)) as T;
      }
      return deletePropsInner(documents);
    } catch (error) {
      // this.logger.error(error);
      return documents;
    }
  }
}
