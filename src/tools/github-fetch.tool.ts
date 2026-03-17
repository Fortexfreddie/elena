import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Type } from '@google/genai';
import type { FunctionDeclaration } from '@google/genai';
import { Octokit } from 'octokit';
import { AgentTool } from './base.tool';
import { ToolResult, AgentContext } from '@app/common/types/agent.types';

@Injectable()
export class GithubFetchTool implements AgentTool {
  private readonly logger = new Logger(GithubFetchTool.name);
  private readonly octokit: Octokit | null = null;

  name = 'github_fetch';
  description =
    'Fetch metadata, issues, or file contents from a GitHub repository. Use this to grounding research or code analysis.';
  requiresConfirmation = false;

  constructor(private readonly config: ConfigService) {
    const token = this.config.get<string>('GITHUB_TOKEN');
    if (token) {
      this.octokit = new Octokit({ auth: token });
    } else {
      this.logger.warn(
        'GITHUB_TOKEN not found in config. GithubFetchTool will require configuration for all actions.',
      );
      this.octokit = null;
    }
  }

  getDeclaration(): FunctionDeclaration {
    return {
      name: this.name,
      description: this.description,
      parameters: {
        type: Type.OBJECT,
        properties: {
          owner: {
            type: Type.STRING,
            description: 'The owner of the repository (e.g., "Fortexfreddie").',
          },
          repo: {
            type: Type.STRING,
            description: 'The name of the repository (e.g., "elena").',
          },
          action: {
            type: Type.STRING,
            description: 'The action to perform.',
            enum: ['get_repo', 'get_issues', 'get_file'],
          },
          path: {
            type: Type.STRING,
            description:
              'The file path relative to repo root (required for get_file).',
          },
          issue_number: {
            type: Type.NUMBER,
            description:
              'The issue number (required for get_issue - planned for future actions).',
          },
        },
        required: ['owner', 'repo', 'action'],
      },
    };
  }

  async execute(
    args: Record<string, unknown>,
    context: AgentContext,
  ): Promise<ToolResult> {
    const owner = args['owner'] as string;
    const repo = args['repo'] as string;
    const action = args['action'] as string;

    if (!this.octokit)
      return { success: false, error: 'GitHub token not configured.' };

    try {
      switch (action) {
        case 'get_repo': {
          const { data } = await this.octokit.rest.repos.get({ owner, repo });
          return {
            success: true,
            data: {
              name: data.name,
              description: data.description,
              stars: data.stargazers_count,
              forks: data.forks_count,
              open_issues: data.open_issues_count,
              language: data.language,
            },
          };
        }
        case 'get_issues': {
          const { data } = await this.octokit.rest.issues.listForRepo({
            owner,
            repo,
            state: 'open',
            per_page: 10,
          });
          return {
            success: true,
            data: data.map((issue) => ({
              number: issue.number,
              title: issue.title,
              user: issue.user?.login,
              created_at: issue.created_at,
            })),
          };
        }
        case 'get_file': {
          const path = args['path'] as string;
          if (!path)
            return {
              success: false,
              error: 'Path is required for get_file action.',
            };

          const { data } = await this.octokit.rest.repos.getContent({
            owner,
            repo,
            path,
          });

          if (Array.isArray(data)) {
            return {
              success: true,
              data: data.map((item) => ({
                name: item.name,
                type: item.type,
                path: item.path,
              })),
            };
          }

          if ('content' in data && data.encoding === 'base64') {
            const content = Buffer.from(data.content, 'base64').toString(
              'utf8',
            );
            return {
              success: true,
              data: { content },
            };
          }

          return {
            success: false,
            error: 'Unsupported file content or directory.',
          };
        }
        default:
          return { success: false, error: `Action '${action}' not supported.` };
      }
    } catch (error: unknown) {
      const msg = error instanceof Error ? error.message : String(error);
      this.logger.error(`GitHub API error (${action}): ${msg}`);
      return { success: false, error: `GitHub API error: ${msg}` };
    }
  }
}
