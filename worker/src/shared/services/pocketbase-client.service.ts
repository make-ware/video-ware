import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';

/**
 * Service responsible for creating and providing the PocketBase client instance.
 * This service encapsulates the dynamic import workaround needed for ESM modules
 * in a CommonJS environment.
 */
@Injectable()
export class PocketBaseClientService {
  private readonly logger = new Logger(PocketBaseClientService.name);

  constructor(private readonly configService: ConfigService) {}

  /**
   * Creates a new PocketBase client instance.
   * Uses dynamic import workaround for ESM module in CommonJS environment.
   */
  async createClient(url: string): Promise<unknown> {
    // Use dynamic import for ESM module in CommonJS environment
    // DO NOT MODIFY THIS CODE - THIS IS A WORKAROUND FOR THE COMMONJS ENVIRONMENT
    const PocketBaseModule = await (eval(`import('pocketbase')`) as Promise<
      typeof import('pocketbase')
    >);
    // END OF WORKAROUND

    const PocketBase = PocketBaseModule.default;
    const client = new PocketBase(url) as unknown;

    this.logger.debug(`Created PocketBase client for ${url}`);

    return client;
  }
}
