import { Logger, ValidationPipe } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import { AppModule } from './app/app.module';

const ALLOWED_ORIGINS = (process.env.CORS_ORIGINS ?? 'http://localhost:4200')
  .split(',')
  .map((o) => o.trim());

async function bootstrap() {
  const app = await NestFactory.create(AppModule);
  app.setGlobalPrefix('api');
  app.useGlobalPipes(new ValidationPipe({ whitelist: true, transform: true }));
  app.enableCors({ origin: ALLOWED_ORIGINS, credentials: true });
  const port = process.env.PORT || 3000;
  await app.listen(port);
  Logger.log(`Application running on: http://localhost:${port}/api`);
}

bootstrap();
