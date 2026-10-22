export interface JiraConfig {
  siteUrl: string
  email: string
  apiToken: string
}

export interface JiraIssue {
  key: string
  summary: string
  status: string
  statusCategory: string
  dueDate: string | null
  url: string
}

export interface RecentComment {
  issueKey: string
  issueSummary: string
  author: string
  body: string
  created: string
  url: string
}

export interface ClaudeSession {
  sessionId: string
  projectPath: string
  title: string
  lastActive: string
  preview: string
}

export type ChatEvent =
  | { type: 'assistant-text'; text: string }
  | { type: 'tool-use'; id: string; name: string }
  | { type: 'permission-request'; id: string; toolName: string; input: Record<string, unknown> }
  | { type: 'turn-complete' }
  | { type: 'error'; message: string }
