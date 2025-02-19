import { AbiDefinition, AbiResolvedType } from '../types/abi.types';
import {
  SwaggerParameter,
  SwaggerPath,
  SwaggerSchemaObject,
} from '../types/swagger.types';
import { AbiTypeResolver } from './abi-type-resolver';

export class AbiSwaggerGenerator {
  private readonly abi: AbiDefinition;
  private readonly typeResolver: AbiTypeResolver;

  constructor(abiJson: AbiDefinition) {
    this.abi = abiJson;
    this.typeResolver = new AbiTypeResolver(abiJson.types);
  }

  public generateSwaggerJson() {
    const displayName = this.abi.name.replace('/', '');

    const swaggerJson = {
      swagger: '2.0',
      info: {
        title: `ABI2API - API for Smart Contract: ${displayName}`,
        description: this.generateDescription(),
        version: '1.0',
      },
      paths: {},
      definitions: {},
      tags: [
        {
          name: displayName,
          description: `Endpoints with 'readonly' mutability for smart contract: ${displayName}`,
        },
      ],
    };

    // Filter and process readonly endpoints
    const endpoints = this.abi.endpoints.filter(
      (endpoint) => endpoint.mutability === 'readonly',
    );

    for (const endpoint of endpoints) {
      const swaggerPath = `/${endpoint.name}`;
      const parameters = this.generateParameters(endpoint.inputs || []);
      const responseSchema = this.generateResponseSchema(
        endpoint.outputs || [],
      );

      const pathDefinition: SwaggerPath = {
        get: {
          summary: endpoint.name,
          description: endpoint.docs
            ? endpoint.docs.join('\n')
            : `No documentation available for ${endpoint.name}.`,
          parameters,
          responses: {
            '200': {
              description: 'Success',
              schema: responseSchema,
            },
          },
          tags: [displayName],
        },
      };

      swaggerJson.paths[swaggerPath] = pathDefinition;
      swaggerJson.definitions[`${endpoint.name}_response`] = responseSchema;
    }

    return swaggerJson;
  }

  private generateDescription(): string {
    return `## Description
Swagger API documentation for ABI JSON on the MultiversX Blockchain.
## Credits
Special thanks to SkullElf, creator of Bobbet (https://x.com/BobbetBot), for his foundational work.
## Details
This API instance provides data from a smart contract in the address: 
<a href="https://explorer.multiversx.com/accounts/${this.abi.name}">${this.abi.name}</a>`;
  }

  private generateParameters(inputs: any[]): SwaggerParameter[] {
    return inputs.map((input) => {
      const isOptional = input.type.startsWith('optional');
      const isMultiArg = input.multi_arg || false;

      const parameter: SwaggerParameter = {
        name: input.name,
        in: 'query',
        required: !isOptional,
      };

      if (isMultiArg) {
        parameter.type = 'array';
        const resolvedType = this.typeResolver.resolveType(input.type);
        let subType = 'any';

        if (resolvedType && !Array.isArray(resolvedType)) {
          if (resolvedType.items) {
            const itemType = Array.isArray(resolvedType.items)
              ? resolvedType.items[0]?.type
              : resolvedType.items.type;
            subType = itemType || 'any';
          }
        }

        parameter.items = {
          type: subType,
        };
      } else {
        const resolvedType = this.typeResolver.resolveType(input.type);
        parameter.type = !Array.isArray(resolvedType)
          ? resolvedType.type
          : 'any';
      }

      return parameter;
    });
  }

  private processPropertiesRecursively(properties: {
    [key: string]: AbiResolvedType;
  }): SwaggerSchemaObject {
    const processedProperties: { [key: string]: any } = {};
    const required: string[] = [];

    Object.entries(properties).forEach(([key, value]) => {
      if (!value.nullable) {
        required.push(key);
      }

      // Remove nullable flag as it's not part of Swagger spec
      delete value.nullable;

      if (value.properties) {
        // Recursively process nested object
        const nestedResult = this.processPropertiesRecursively(
          value.properties,
        );
        processedProperties[key] = {
          type: 'object',
          properties: nestedResult.properties,
          ...(nestedResult.required && { required: nestedResult.required }),
          ...(value.example && { example: value.example }),
        };
      } else if (
        value.items &&
        !Array.isArray(value.items) &&
        value.items.properties
      ) {
        // Handle array items with nested objects
        const nestedResult = this.processPropertiesRecursively(
          value.items.properties,
        );
        processedProperties[key] = {
          type: 'array',
          items: {
            type: 'object',
            properties: nestedResult.properties,
            ...(nestedResult.required && { required: nestedResult.required }),
          },
          ...(value.example && { example: value.example }),
        };
      } else {
        // Handle primitive types
        processedProperties[key] = {
          type: value.type,
          ...(value.example && { example: value.example }),
        };
      }
    });

    return {
      type: 'object',
      properties: processedProperties,
      ...(required.length > 0 && { required }),
    };
  }

  private generateResponseSchema(outputs: any[]) {
    const properties: { [key: string]: AbiResolvedType } = {};
    const required: string[] = [];

    outputs.forEach((output) => {
      const outputName = output.name || 'output';
      properties[outputName] = this.typeResolver.resolveType(
        output.type || 'output',
      );

      if (!output.type.startsWith('optional')) {
        required.push(outputName);
      }
    });

    const processedSchema = this.processPropertiesRecursively(properties);

    return {
      type: 'object',
      properties: processedSchema.properties,
      required: required.length > 0 ? required : undefined,
    };
  }
}
