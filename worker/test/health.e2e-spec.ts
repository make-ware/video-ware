import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { Test, TestingModule } from '@nestjs/testing';
import { INestApplication } from '@nestjs/common';
import { HealthModule } from '../src/health/health.module';
import { PocketBaseService } from '../src/shared/services/pocketbase.service';
import { QueueService } from '../src/queue/queue.service';
import { GoogleCloudService } from '../src/shared/services/google-cloud.service';
import { TerminusModule } from '@nestjs/terminus';
import request from 'supertest';

describe('Health Endpoints (e2e)', () => {
  let app: INestApplication;
  let pocketbaseService: PocketBaseService;
  let queueService: QueueService;
  let googleCloudService: GoogleCloudService;

  beforeEach(async () => {
    // Create mocks for the services
    const mockPocketBaseService = {
      isHealthy: vi.fn(),
    };

    const mockQueueService = {
      getQueueMetrics: vi.fn(),
    };

    const mockGoogleCloudService = {
      isVideoIntelligenceHealthy: vi.fn(),
      isSpeechHealthy: vi.fn(),
      isTranscoderHealthy: vi.fn(),
    };

    const moduleFixture: TestingModule = await Test.createTestingModule({
      imports: [TerminusModule, HealthModule],
    })
      .overrideProvider(PocketBaseService)
      .useValue(mockPocketBaseService)
      .overrideProvider(QueueService)
      .useValue(mockQueueService)
      .overrideProvider(GoogleCloudService)
      .useValue(mockGoogleCloudService)
      .compile();

    app = moduleFixture.createNestApplication();
    await app.init();

    pocketbaseService = moduleFixture.get<PocketBaseService>(PocketBaseService);
    queueService = moduleFixture.get<QueueService>(QueueService);
    googleCloudService =
      moduleFixture.get<GoogleCloudService>(GoogleCloudService);
  });

  afterEach(async () => {
    await app.close();
  });

  describe('/health (GET)', () => {
    it('should return healthy status when all services are healthy', async () => {
      // Arrange - mock all services as healthy
      vi.mocked(pocketbaseService.isHealthy).mockResolvedValue(true);
      vi.mocked(queueService.getQueueMetrics).mockResolvedValue({
        transcode: {
          waiting: 0,
          active: 0,
          completed: 5,
          failed: 0,
          delayed: 0,
        },
        intelligence: {
          waiting: 0,
          active: 0,
          completed: 3,
          failed: 0,
          delayed: 0,
        },
        render: { waiting: 0, active: 0, completed: 1, failed: 0, delayed: 0 },
      });
      vi.mocked(
        googleCloudService.isVideoIntelligenceHealthy
      ).mockResolvedValue(true);
      vi.mocked(googleCloudService.isSpeechHealthy).mockResolvedValue(true);
      vi.mocked(googleCloudService.isTranscoderHealthy).mockResolvedValue(true);

      // Act & Assert
      const response = await request(app.getHttpServer())
        .get('/health')
        .expect(200);

      expect(response.body).toEqual({
        status: 'ok',
        info: {
          pocketbase: {
            status: 'up',
            connected: true,
          },
          queue: {
            status: 'up',
            metrics: expect.any(Object),
            connected: true,
          },
          googleCloud: {
            status: 'up',
            videoIntelligence: true,
            speech: true,
            transcoder: true,
            connected: true,
          },
        },
        error: {},
        details: expect.any(Object),
      });
    });

    it('should return unhealthy status when PocketBase is down', async () => {
      // Arrange - mock PocketBase as unhealthy
      vi.mocked(pocketbaseService.isHealthy).mockResolvedValue(false);
      vi.mocked(queueService.getQueueMetrics).mockResolvedValue({
        transcode: {
          waiting: 0,
          active: 0,
          completed: 5,
          failed: 0,
          delayed: 0,
        },
        intelligence: {
          waiting: 0,
          active: 0,
          completed: 3,
          failed: 0,
          delayed: 0,
        },
        render: { waiting: 0, active: 0, completed: 1, failed: 0, delayed: 0 },
      });
      vi.mocked(
        googleCloudService.isVideoIntelligenceHealthy
      ).mockResolvedValue(true);
      vi.mocked(googleCloudService.isSpeechHealthy).mockResolvedValue(true);
      vi.mocked(googleCloudService.isTranscoderHealthy).mockResolvedValue(true);

      // Act & Assert
      const response = await request(app.getHttpServer())
        .get('/health')
        .expect(503);

      expect(response.body.status).toBe('error');
      expect(response.body.error.pocketbase).toEqual({
        status: 'down',
        connected: false,
      });
    });

    it('should return unhealthy status when queues are down', async () => {
      // Arrange - mock queues as unhealthy
      vi.mocked(pocketbaseService.isHealthy).mockResolvedValue(true);
      vi.mocked(queueService.getQueueMetrics).mockRejectedValue(
        new Error('Redis connection failed')
      );
      vi.mocked(
        googleCloudService.isVideoIntelligenceHealthy
      ).mockResolvedValue(true);
      vi.mocked(googleCloudService.isSpeechHealthy).mockResolvedValue(true);
      vi.mocked(googleCloudService.isTranscoderHealthy).mockResolvedValue(true);

      // Act & Assert
      const response = await request(app.getHttpServer())
        .get('/health')
        .expect(503);

      expect(response.body.status).toBe('error');
      expect(response.body.error.queue).toEqual({
        status: 'down',
        connected: false,
        error: 'Redis connection failed',
      });
    });

    it('should return unhealthy status when all Google Cloud services are down', async () => {
      // Arrange - mock Google Cloud services as unhealthy
      vi.mocked(pocketbaseService.isHealthy).mockResolvedValue(true);
      vi.mocked(queueService.getQueueMetrics).mockResolvedValue({
        transcode: {
          waiting: 0,
          active: 0,
          completed: 5,
          failed: 0,
          delayed: 0,
        },
        intelligence: {
          waiting: 0,
          active: 0,
          completed: 3,
          failed: 0,
          delayed: 0,
        },
        render: { waiting: 0, active: 0, completed: 1, failed: 0, delayed: 0 },
      });
      vi.mocked(
        googleCloudService.isVideoIntelligenceHealthy
      ).mockResolvedValue(false);
      vi.mocked(googleCloudService.isSpeechHealthy).mockResolvedValue(false);
      vi.mocked(googleCloudService.isTranscoderHealthy).mockResolvedValue(
        false
      );

      // Act & Assert
      const response = await request(app.getHttpServer())
        .get('/health')
        .expect(503);

      expect(response.body.status).toBe('error');
      expect(response.body.error.googleCloud).toEqual({
        status: 'down',
        videoIntelligence: false,
        speech: false,
        transcoder: false,
        connected: false,
      });
    });

    it('should return healthy status when at least one Google Cloud service is available', async () => {
      // Arrange - mock only one Google Cloud service as healthy
      vi.mocked(pocketbaseService.isHealthy).mockResolvedValue(true);
      vi.mocked(queueService.getQueueMetrics).mockResolvedValue({
        transcode: {
          waiting: 0,
          active: 0,
          completed: 5,
          failed: 0,
          delayed: 0,
        },
        intelligence: {
          waiting: 0,
          active: 0,
          completed: 3,
          failed: 0,
          delayed: 0,
        },
        render: { waiting: 0, active: 0, completed: 1, failed: 0, delayed: 0 },
      });
      vi.mocked(
        googleCloudService.isVideoIntelligenceHealthy
      ).mockResolvedValue(true);
      vi.mocked(googleCloudService.isSpeechHealthy).mockResolvedValue(false);
      vi.mocked(googleCloudService.isTranscoderHealthy).mockResolvedValue(
        false
      );

      // Act & Assert
      const response = await request(app.getHttpServer())
        .get('/health')
        .expect(200);

      expect(response.body.status).toBe('ok');
      expect(response.body.info.googleCloud).toEqual({
        status: 'up',
        videoIntelligence: true,
        speech: false,
        transcoder: false,
        connected: true,
      });
    });
  });
});
