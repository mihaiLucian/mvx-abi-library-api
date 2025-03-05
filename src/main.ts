import { NestFactory } from '@nestjs/core';
import { VersioningType } from '@nestjs/common';
import { NestExpressApplication } from '@nestjs/platform-express';
import { join } from 'path';
import { config } from 'dotenv';
import { SwaggerDocumentBuilder } from './swagger/swagger-document-builder';
import { PublicAppModule } from './public.app.module';
import { ValidationPipe } from '@nestjs/common';
import { AzureKeyVaultService } from './common/azure-keyvault/azure-key-vault.service';

async function bootstrap() {
  config(); // Initialize dotenv

  if (process.env.NODE_ENV === 'production') {
    const keyVaultService = new AzureKeyVaultService();
    await keyVaultService.loadAndSetRequiredSecrets();
  }

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
