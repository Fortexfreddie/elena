import { Test, TestingModule } from '@nestjs/testing';
import { MessageProcessor } from '../src/queue/message.processor';
import { WebhookController } from '../src/telegram/webhook.controller';
import { FilterAgent } from '../src/agents/filter.agent';
import { ManagerAgent } from '../src/agents/manager.agent';
import { ReplySenderService } from '../src/telegram/reply.sender';
import { AssemblerService, HotMemoryService } from '../src/memory/index';
import { OnboardingDetector } from '../src/onboarding/detector.service';
import { InterviewerService } from '../src/onboarding/interviewer.service';
import { UpstashRedisService } from '@app/common';
import { QueueService } from '../src/queue/queue.service';
import { ProfileBuilder } from '../src/personas/profile-builder.service';
import { PrismaService } from '@app/database';
import { ClaimAdminCommand } from '../src/onboarding/claim-admin.command';
import { ReactionSenderService } from '../src/telegram/reaction.sender';

describe('Hallucination Fixes (Unit)', () => {
  let processor: MessageProcessor;
  let managerAgent: ManagerAgent;
  let controller: WebhookController;
  let redisService: UpstashRedisService;
  let replySender: ReplySenderService;

  const mockFilterAgent = { route: jest.fn() };
  const mockManagerAgent = { execute: jest.fn() };
  const mockReplySender = { sendTypingAction: jest.fn(), sendReply: jest.fn(), getBotId: jest.fn() };
  const mockAssembler = { assemble: jest.fn() };
  const mockHotMemory = { addMessage: jest.fn() };
  const mockOnboardingDetector = { check: jest.fn() };
  const mockInterviewer = { handleMessage: jest.fn() };
  const mockRedisService = { client: { set: jest.fn(), del: jest.fn() } };
  const mockQueueService = { addMessageJob: jest.fn() };
  const mockProfileBuilder = { finalize: jest.fn(), reject: jest.fn() };
  const mockPrisma = { user: { count: jest.fn(), findUnique: jest.fn() } };
  const mockClaimAdmin = { execute: jest.fn() };
  const mockReactionSender = { sendThinkingReaction: jest.fn() };

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        MessageProcessor,
        WebhookController,
        { provide: FilterAgent, useValue: mockFilterAgent },
        { provide: ManagerAgent, useValue: mockManagerAgent },
        { provide: ReplySenderService, useValue: mockReplySender },
        { provide: AssemblerService, useValue: mockAssembler },
        { provide: HotMemoryService, useValue: mockHotMemory },
        { provide: OnboardingDetector, useValue: mockOnboardingDetector },
        { provide: InterviewerService, useValue: mockInterviewer },
        { provide: UpstashRedisService, useValue: mockRedisService },
        { provide: QueueService, useValue: mockQueueService },
        { provide: ProfileBuilder, useValue: mockProfileBuilder },
        { provide: PrismaService, useValue: mockPrisma },
        { provide: ClaimAdminCommand, useValue: mockClaimAdmin },
        { provide: ReactionSenderService, useValue: mockReactionSender },
      ],
    }).compile();

    processor = module.get<MessageProcessor>(MessageProcessor);
    managerAgent = module.get<ManagerAgent>(ManagerAgent);
    controller = module.get<WebhookController>(WebhookController);
    redisService = module.get<UpstashRedisService>(UpstashRedisService);
    replySender = module.get<ReplySenderService>(ReplySenderService);
  });

  describe('MessageProcessor - Visual Grounding', () => {
    it('should inject Visual Grounding Rule when hasMedia is true', async () => {
      const parsedMessage = {
        chatId: '123',
        userId: 'user1',
        hasMedia: true,
        text: 'What is this?',
        telegramDate: 123456789,
        rawUpdate: { update_id: 1, message: { message_id: 1 } },
      } as any;

      mockOnboardingDetector.check.mockResolvedValue('known');
      mockAssembler.assemble.mockResolvedValue({ userProfile: { displayName: 'Fred' } });
      mockFilterAgent.route.mockResolvedValue({ action: 'route', routeTo: 'manager', reason: 'test' });
      mockManagerAgent.execute.mockResolvedValue({ text: 'Response', agentName: 'manager' });

      await processor.process({ id: 'job1', data: { parsedMessage } } as any);

      expect(mockManagerAgent.execute).toHaveBeenCalledWith(
        'manager',
        expect.objectContaining({
          systemBlock: expect.stringContaining('VISUAL GROUNDING (ACTIVE — image detected)')
        })
      );
    });

    it('should NOT inject Visual Grounding Rule when hasMedia is false', async () => {
      const parsedMessage = {
        chatId: '123',
        userId: 'user1',
        hasMedia: false,
        text: 'Hello',
        telegramDate: 123456789,
        rawUpdate: { update_id: 1, message: { message_id: 1 } },
      } as any;

      mockOnboardingDetector.check.mockResolvedValue('known');
      mockAssembler.assemble.mockResolvedValue({ userProfile: { displayName: 'Fred' } });
      mockFilterAgent.route.mockResolvedValue({ action: 'route', routeTo: 'manager', reason: 'test' });
      mockManagerAgent.execute.mockResolvedValue({ text: 'Response', agentName: 'manager' });

      await processor.process({ id: 'job1', data: { parsedMessage } } as any);

      expect(mockManagerAgent.execute).toHaveBeenCalledWith(
        'manager',
        expect.objectContaining({
          systemBlock: expect.not.stringContaining('VISUAL GROUNDING')
        })
      );
    });

    it('should STOP the pipeline and NOT call manager when filter handles reply', async () => {
      const parsedMessage = {
        chatId: '123',
        userId: 'user1',
        hasMedia: false,
        text: 'Hello',
        telegramDate: 123456789,
        rawUpdate: { update_id: 1, message: { message_id: 1 } },
      } as any;

      mockOnboardingDetector.check.mockResolvedValue('known');
      mockAssembler.assemble.mockResolvedValue({ userProfile: { displayName: 'Fred' } });
      mockFilterAgent.route.mockResolvedValue({ action: 'reply', reply: 'Direct Filter Reply' });

      // Reset manager mock to track calls in this test
      mockManagerAgent.execute.mockClear();

      await processor.process({ id: 'job1', data: { parsedMessage } } as any);

      // Verify filter reply was saved/sent
      expect(mockReplySender.sendReply).toHaveBeenCalledWith('123', 'Direct Filter Reply', 1);

      // CRITICAL: Verify manager was NEVER called
      expect(mockManagerAgent.execute).not.toHaveBeenCalled();
    });
  });

  describe('WebhookController - /clear command', () => {
    it('should call redis.del when /clear is sent', async () => {
      const update = {
        update_id: 1,
        message: {
          chat: { id: 123 },
          text: '/clear',
          from: { id: 456 }
        }
      } as any;

      mockRedisService.client.set.mockResolvedValue('OK'); // Idempotency gate passes

      await controller.handleWebhook(update);

      expect(mockRedisService.client.del).toHaveBeenCalledWith('hot:123');
      expect(mockReplySender.sendReply).toHaveBeenCalledWith('123', expect.stringContaining('hot memory cleared'));
    });
  });
});
