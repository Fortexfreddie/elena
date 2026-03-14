import { Injectable, Logger } from '@nestjs/common';
import { Type } from '@google/genai';
import type { FunctionDeclaration } from '@google/genai';
import { AgentTool } from './base.tool';
import { ToolResult, AgentContext } from '@app/common/types/agent.types';

@Injectable()
export class DraftMessageTool implements AgentTool {
    private readonly logger = new Logger(DraftMessageTool.name);

    name = 'draft_message';
    description = 'Draft a complex message or announcement based on context. This tool does not send the message, it only returns the draft for the agent to use in its final response.';
    requiresConfirmation = false;

    getDeclaration(): FunctionDeclaration {
        return {
            name: this.name,
            description: this.description,
            parameters: {
                type: Type.OBJECT,
                properties: {
                    draftFor: {
                        type: Type.STRING,
                        description: 'What the draft is for (e.g., "announcement", "reply to founder", "code summary").',
                    },
                    keyPoints: {
                        type: Type.ARRAY,
                        items: { type: Type.STRING },
                        description: 'List of specific points to include in the draft.',
                    }
                },
                required: ['draftFor'],
            },
        };
    }

    async execute(args: Record<string, unknown>, context: AgentContext): Promise<ToolResult> {
        const draftFor = args['draftFor'] as string;
        const keyPoints = args['keyPoints'] as string[] | undefined;

        this.logger.log(`Drafting message for: ${draftFor}`);

        // Simple drafting logic — in reality, the agent uses the tool output to refine its own generation.
        // We provide a structured template back to the agent.
        const resultTemplate = `
DRAFT FOR: ${draftFor}
POINTS TO COVER:
${keyPoints?.map(p => `- ${p}`).join('\n') || 'None provided.'}

[DRAFTING IN PROGRESS... AGENT SHOULD SYNTHESIZE FINAL TEXT BASED ON THIS TEMPLATE]
`;

        return {
            success: true,
            data: { draft: resultTemplate.trim() }
        };
    }
}
