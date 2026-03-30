import { Injectable, Logger } from '@nestjs/common';
import { z } from 'zod';
import { AgentTool } from './base.tool';
import { ToolResult, AgentContext } from '@app/common/types/agent.types';
import { FunctionDeclaration, Type } from '@google/genai';
import * as vm from 'vm';
import * as ts from 'typescript';

@Injectable()
export class RunCodeTool implements AgentTool {
  private readonly logger = new Logger(RunCodeTool.name);

  // M-9: Security Requirement — Any arbitrary code execution or command running requires explicit HITL approval
  requiresConfirmation = true;

  name = 'run_code';
  description =
    'Executes arbitrary code in a sandboxed environment. Use this to run calculations, validate logic, test data transformations, or execute provided scripts based on a user prompt.';

  argsSchema = z.object({
    language: z.enum(['javascript', 'typescript']).describe('The programming language of the code'),
    code: z.string().describe('The code to execute'),
  });

  getDeclaration(): FunctionDeclaration {
    return {
      name: this.name,
      description: this.description,
      parameters: {
        type: Type.OBJECT,
        properties: {
          language: {
            type: Type.STRING,
            description: 'The programming language of the code',
            enum: ['javascript', 'typescript'],
          },
          code: {
            type: Type.STRING,
            description: 'The code to execute',
          },
        },
        required: ['language', 'code'],
      },
    };
  }

  async execute(
    args: Record<string, unknown>,
    context: AgentContext,
  ): Promise<ToolResult> {
    const language = args['language'] as string;
    const code = args['code'] as string;

    if (language !== 'javascript' && language !== 'typescript') {
      return {
        success: false,
        error: `Sandbox currently only supports JavaScript and TypeScript. Execution of ${language} requires a separate runtime that is not yet configured.`,
      };
    }

    try {
      let runCode = code;

      // Extremely naive TS strip if they pass TS.
      // Usually the `vm` module just runs JS. 
      // We strip basic type annotations if present to avoid syntax errors,
      // but ideally the LLM writes valid JS.
      if (language === 'typescript') {
        try {
          runCode = ts.transpileModule(code, {
            compilerOptions: {
              module: ts.ModuleKind.CommonJS,
              target: ts.ScriptTarget.ESNext,
              noImplicitAny: false,
            },
          }).outputText;
        } catch (transpileError) {
          return {
            success: false,
            error: `TypeScript transpilation failed: ${transpileError instanceof Error ? transpileError.message : String(transpileError)}`,
          };
        }
      }

      const outputLogs: string[] = [];
      const sandbox = {
        console: {
          log: (...args: any[]) => {
            outputLogs.push(args.map(a => typeof a === 'object' ? JSON.stringify(a) : String(a)).join(' '));
          },
          error: (...args: any[]) => {
            outputLogs.push('[ERROR] ' + args.map(a => typeof a === 'object' ? JSON.stringify(a) : String(a)).join(' '));
          },
          warn: (...args: any[]) => {
            outputLogs.push('[WARN] ' + args.map(a => typeof a === 'object' ? JSON.stringify(a) : String(a)).join(' '));
          },
          info: (...args: any[]) => {
            outputLogs.push('[INFO] ' + args.map(a => typeof a === 'object' ? JSON.stringify(a) : String(a)).join(' '));
          },
        },
        // Remove setTimeout/Buffer to prevent async leaks and unsafe access
      };

      const context = vm.createContext(sandbox);
      const script = new vm.Script(runCode);

      // 5-second hard timeout
      const result = script.runInContext(context, { timeout: 5000 });

      let parsedResult = String(result);
      if (typeof result === 'object') {
        try {
          parsedResult = JSON.stringify(result, null, 2);
        } catch {
          parsedResult = '[Unserializable Object]';
        }
      }

      this.logger.log(`[SANDBOX] Code executed successfully.`);

      return {
        success: true,
        data: {
          output: outputLogs.join('\n'),
          returnValue: result !== undefined ? parsedResult : null,
        },
      };

    } catch (error: unknown) {
      const msg = error instanceof Error ? error.message : String(error);

      if (msg.includes('Script execution timed out')) {
        return {
          success: false,
          error: 'Code execution timed out after 5 seconds.',
        };
      }

      this.logger.warn(`[SANDBOX] Execution failed: ${msg}`);
      return {
        success: false,
        error: `Runtime Error: ${msg}`,
      };
    }
  }
}
