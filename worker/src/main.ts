import { NestFactory } from '@nestjs/core';
import { AppModule } from './app.module';
import { Logger, ValidationPipe } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { ProcessorsConfigService } from './config/processors.config';

async function bootstrap() {
  const app = await NestFactory.create(AppModule, {
    logger: ['error', 'warn', 'log', 'debug', 'verbose'],
  });

  const configService = app.get(ConfigService);
  const port = configService.get<number>('port', 3001);

  // Validate processor configuration at startup
  try {
    const processorsConfig = app.get(ProcessorsConfigService);
    processorsConfig.validateConfiguration();
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : String(error);
    Logger.error(
      `Processor configuration validation failed: ${errorMessage}`,
      'Bootstrap'
    );
    // Don't fail startup - just log the error
    // This allows the service to start even if GCVI is not configured
  }

  // Global pipes
  app.useGlobalPipes(
    new ValidationPipe({
      transform: true,
      whitelist: true,
      forbidNonWhitelisted: true,
    })
  );

  // Graceful shutdown
  app.enableShutdownHooks();

  await app.listen(port);
  Logger.log(`Worker service listening on port ${port}`, 'Bootstrap');
}

bootstrap();
