import { INestApplication } from '@nestjs/common';
import {
  DocumentBuilder,
  SwaggerCustomOptions,
  SwaggerModule,
} from '@nestjs/swagger';

export class SwaggerDocumentBuilder {
  constructor(private readonly app: INestApplication) {}

  private buildConfig() {
    const docBuilder = new DocumentBuilder()
      .setTitle('MultiversX ABI Library')
      .setVersion('beta')
      // .addBearerAuth({ type: 'http', scheme: 'bearer', bearerFormat: 'JWT' })
      .setDescription(
        'A set of APIs to discover, explore and interact with MultiversX smart contracts',
      );

    return docBuilder.build();
  }
  private createDocument() {
    const config = this.buildConfig();
    return SwaggerModule.createDocument(this.app, config);
  }

  public setupSwagger() {
    const document = this.createDocument();
    const options: SwaggerCustomOptions = {
      customSiteTitle: 'MVX ABI Library',
      // customfavIcon: '/favicon.png',
      swaggerOptions: {
        displayRequestDuration: true,
        defaultModelsExpandDepth: -1,
      },
      jsonDocumentUrl: '/swagger.json',
      yamlDocumentUrl: '/swagger.yaml',
    };

    SwaggerModule.setup('/', this.app, document, options);
  }
}
