import { NestFactory } from '@nestjs/core';
import { ValidationPipe, VersioningType } from '@nestjs/common';
import { NestExpressApplication } from '@nestjs/platform-express';
import { join } from 'path';
import { SwaggerDocumentBuilder } from './swagger/swagger-document-builder';
import { PublicAppModule } from './public.app.module';

async function bootstrap() {
  require('dotenv').config();
  const app = await NestFactory.create<NestExpressApplication>(
    PublicAppModule,
    {
      bufferLogs: false,
    },
  );
  app.enableVersioning({
    type: VersioningType.URI,
    prefix: '',
  });
  app.enableCors();
  app.disable('x-powered-by');
  app.disable('etag');
  app.useStaticAssets(join(__dirname, '..', 'public'));

  // set swagger
  const swaggerDocumentBuilder = new SwaggerDocumentBuilder(app);
  swaggerDocumentBuilder.setupSwagger();

  await app.listen(process.env.PORT ?? 8080);
}
bootstrap();
