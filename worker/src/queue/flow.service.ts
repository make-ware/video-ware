import { Injectable, Logger } from '@nestjs/common';
import { FlowProducer } from 'bullmq';
import { ConfigService } from '@nestjs/config';
import type { FlowDefinition } from './flows';

/**
 * Service for creating BullMQ job flows with parent-child relationships
 * Uses FlowProducer to orchestrate multi-step task processing
 *
 * Flow definitions are created by flow builders based on task type
 */
@Injectable()
export class FlowService {
  private readonly logger = new Logger(FlowService.name);
  private flowProducer: FlowProducer;

  constructor(private readonly configService: ConfigService) {
    const redisConfig = {
      host: this.configService.get('redis.host', 'localhost'),
      port: this.configService.get('redis.port', 6379),
      password: this.configService.get('redis.password'),
    };

    this.flowProducer = new FlowProducer({ connection: redisConfig });
    this.logger.log('FlowService initialized with Redis connection');
  }

  /**
   * Add a pre-built flow to BullMQ
   * Generic method that accepts any flow definition
   *
   * @param flowDefinition - Flow definition with parent and child jobs
   * @returns Parent job ID
   */
  async addFlow(flowDefinition: FlowDefinition): Promise<string> {
    this.logger.log(`Adding flow to BullMQ: ${flowDefinition.name}`);

    const result = await this.flowProducer.add(flowDefinition);

    if (!result.job.id) {
      throw new Error('Flow job was created but has no ID');
    }

    this.logger.log(`Flow added, parent job: ${result.job.id}`);

    return result.job.id;
  }

  /**
   * Clean up resources on module destroy
   */
  async onModuleDestroy() {
    await this.flowProducer.close();
    this.logger.log('FlowService closed');
  }
}
