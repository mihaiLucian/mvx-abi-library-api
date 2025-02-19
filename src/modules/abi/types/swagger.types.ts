export interface SwaggerParameter {
  name: string;
  in: 'query';
  required: boolean;
  type?: string;
  items?: {
    type: string;
  };
}

export interface SwaggerPath {
  get: {
    summary: string;
    description: string;
    parameters: SwaggerParameter[];
    responses: {
      '200': {
        description: string;
        schema: {
          type: string;
          properties: { [key: string]: any };
        };
      };
    };
    tags: string[];
  };
}

export interface SwaggerSchemaObject {
  type: string;
  properties: { [key: string]: any };
  required?: string[];
  example?: any;
}
