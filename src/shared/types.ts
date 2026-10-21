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
  lastActive: string
  preview: string
}
