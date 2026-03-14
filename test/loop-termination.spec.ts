import { Test, TestingModule } from '@nestjs/testing';
import { BaseAgent } from '../src/agents/base.agent';
import { GeminiService } from '@app/common/gemini/gemini.service';
import { ExecutorService } from '../src/tools/executor.service';
import { PersonasInjector } from '../src/agents/personas.injector';
import { GEMINI_MODELS } from '@app/common/gemini/gemini.constants';
import { AgentContext } from '@app/common/types/agent.types';

// Concrete implementation for testing
class TestAgent extends BaseAgent {
    protected getRoleInstruction(): string { return 'test'; }
    protected getTools() {
        return [{
            name: 'test_tool',
            description: 'test',
            parameters: { type: 'object', properties: {} }
        }] as any;
    }
}

describe('Loop Termination Logic (Unit)', () => {
    let agent: TestAgent;
    let geminiService: GeminiService;
    let executorService: ExecutorService;

    const mockGeminiService = { generateContent: jest.fn() };
    const mockExecutorService = { executeCall: jest.fn() };
    const mockPersonasInjector = { inject: jest.fn().mockReturnValue('test prompt') };

    beforeEach(async () => {
        const module: TestingModule = await Test.createTestingModule({
            providers: [
                { provide: GeminiService, useValue: mockGeminiService },
                { provide: ExecutorService, useValue: mockExecutorService },
                { provide: PersonasInjector, useValue: mockPersonasInjector },
            ],
        }).compile();

        geminiService = module.get<GeminiService>(GeminiService);
        executorService = module.get<ExecutorService>(ExecutorService);
        agent = new TestAgent('test-agent', GEMINI_MODELS.FLASH, geminiService, executorService, mockPersonasInjector as any);
    });

    it('should terminate the loop immediately if a tool returns terminateLoop: true', async () => {
        const context: AgentContext = {
            parsedMessage: { text: 'hello', rawUpdate: { update_id: 1, message: { message_id: 1 } } } as any,
            assembledContext: { hotMessages: [] } as any,
            systemBlock: '',
            decryptedSecretsSet: new Set(),
        };

        // Turn 1: Model calls the terminal tool
        mockGeminiService.generateContent.mockResolvedValueOnce({
            model: 'test-model',
            rawContent: { role: 'model', parts: [{ functionCall: { name: 'test_tool', args: {} } }] },
            functionCalls: [{ name: 'test_tool', args: {} }],
            text: 'I will call the tool.'
        });

        // Tool execution returns terminateLoop: true
        mockExecutorService.executeCall.mockResolvedValueOnce({
            success: true,
            data: 'terminal result',
            terminateLoop: true
        });

        const response = await agent.run(context);

        // Verify only ONE model call was made
        expect(mockGeminiService.generateContent).toHaveBeenCalledTimes(1);
        expect(response.confidence).toBe(100);
        expect(response.toolsCalled).toContain('test_tool');
    });
});
