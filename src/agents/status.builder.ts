import { AgentStatusUpdate } from '@app/common/types/agent.types';

const agentEmoji: Record<string, string> = {
  coder: '👨‍💻',
  researcher: '🔍',
  reviewer: '🔎',
  brainstorm: '🧠',
  task: '📋',
  manager: '🤔',
};

const toolEmoji: Record<string, string> = {
  web_search: '🌐',
  doc_scraper: '📄',
  github_fetch: '📁',
  memory_search: '🧠',
  bounty_update: '📋',
  send_reminder: '⏰',
  send_dm: '💬',
  run_code: '⚙️',
  log_monitor: '📊',
  delegate_task: '🔀',
};

const modelNames: Record<string, string> = {
  'gemini-3.1-pro-preview': 'Gemini Pro',
  'gemini-3-flash-preview': 'Gemini Flash',
  'gemini-3.1-flash-lite-preview': 'Gemini Lite',
};

/**
 * Builds the status text for Telegram.
 */
export function buildStatusText(update: AgentStatusUpdate): string {
  const emoji = agentEmoji[update.agentName.toLowerCase()] ?? '⚡';
  const name = update.agentName.charAt(0).toUpperCase() + update.agentName.slice(1);
  const modelShort = modelNames[update.modelUsed] ?? update.modelUsed;
  const fallbackFlag = update.modelFallback ? ' ⚠️ rate limited' : '';

  let text = `${emoji} ${name} Agent  •  ${modelShort}${fallbackFlag}\n`;
  text += '\n';

  for (const tool of update.toolsDone) {
    text += `✅ ${tool}\n`;
  }

  if (update.suspended) {
    text += '⏸ Waiting for your confirmation...';
  } else if (update.currentTool) {
    const tEmoji = toolEmoji[update.currentTool] ?? '⚙️';
    text += `${tEmoji} ${update.currentToolDetail}\n`;
    text += `step ${update.stepNumber} of ${update.maxSteps}`;
  }

  return text.trim();
}

/**
 * Gets a human-readable detail for a tool call.
 */
export function getToolDetail(toolName: string, args: Record<string, any>): string {
  switch (toolName) {
    case 'web_search':
      return `Searching: ${String(args['query']).slice(0, 50)}...`;
    case 'doc_scraper':
      return `Reading: ${String(args['url']).replace(/^https?:\/\//, '').slice(0, 50)}...`;
    case 'github_fetch':
      return `Fetching: ${args['owner']}/${args['repo']}`;
    case 'memory_search':
      return `Checking memory: ${String(args['query']).slice(0, 40)}...`;
    case 'log_monitor':
      return 'Checking system logs...';
    case 'bounty_update':
      return 'Updating bounties...';
    case 'send_reminder':
      return 'Scheduling reminder...';
    case 'send_dm':
      return 'Preparing DM...';
    case 'run_code':
      return `Running ${args['language']} code...`;
    case 'delegate_task':
      return `Delegating to ${args['agent']}...`;
    default:
      return `${toolName}...`;
  }
}
