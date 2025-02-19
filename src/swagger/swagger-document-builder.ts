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
      .setTitle('MultiversX Smart Contract Explorer APIs')
      .setVersion('beta')
      // .addBearerAuth({ type: 'http', scheme: 'bearer', bearerFormat: 'JWT' })
      .setDescription('APIs to explore MultiversX Smart Contracts');

    return docBuilder.build();
  }
  private createDocument() {
    const config = this.buildConfig();
    return SwaggerModule.createDocument(this.app, config);
  }

  public setupSwagger() {
    const document = this.createDocument();
    const options: SwaggerCustomOptions = {
      customSiteTitle: 'MVX SC Explorer',
      // customfavIcon: '/favicon.png',
      swaggerOptions: {
        displayRequestDuration: true,
      },
      jsonDocumentUrl: '/swagger.json',
      yamlDocumentUrl: '/swagger.yaml',
    };

    SwaggerModule.setup('/', this.app, document, options);
  }
}
