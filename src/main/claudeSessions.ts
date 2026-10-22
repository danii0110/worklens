import {
  listSessions,
  getSessionInfo,
  renameSession,
  getSessionMessages
} from '@anthropic-ai/claude-agent-sdk'
import type { ClaudeSession, ChatHistoryEntry } from '../shared/types'

export type { ClaudeSession }

interface ContentBlock {
  type?: string
  text?: string
  name?: string
}

function extractHistoryEntries(message: { role?: string; content?: unknown }): ChatHistoryEntry[] {
  const role = message.role
  if (role !== 'user' && role !== 'assistant') return []

  if (typeof message.content === 'string') {
    return message.content.trim() ? [{ role, text: message.content }] : []
  }

  if (!Array.isArray(message.content)) return []

  const entries: ChatHistoryEntry[] = []
  for (const block of message.content as ContentBlock[]) {
    if (block.type === 'text' && block.text) {
      entries.push({ role, text: block.text })
    } else if (role === 'assistant' && block.type === 'tool_use' && block.name) {
      entries.push({ role: 'tool', text: `🔧 ${block.name}` })
    }
  }
  return entries
}

export async function listClaudeSessions(limit = 30): Promise<ClaudeSession[]> {
  const sessions = await listSessions({ limit, includeProgrammatic: false })

  return sessions
    .filter((session) => Boolean(session.cwd))
    .map((session) => ({
      sessionId: session.sessionId,
      projectPath: session.cwd as string,
      title: session.summary,
      preview: session.firstPrompt ?? '',
      lastActive: new Date(session.lastModified).toISOString()
    }))
}

export async function resolveSessionCwd(sessionId: string): Promise<string | null> {
  if (!/^[a-f0-9-]{36}$/i.test(sessionId)) return null
  const info = await getSessionInfo(sessionId)
  return info?.cwd ?? null
}

export async function renameClaudeSession(sessionId: string, title: string): Promise<void> {
  if (!/^[a-f0-9-]{36}$/i.test(sessionId)) {
    throw new Error('잘못된 세션 ID입니다.')
  }
  await renameSession(sessionId, title)
}

export async function getChatHistory(sessionId: string): Promise<ChatHistoryEntry[]> {
  if (!/^[a-f0-9-]{36}$/i.test(sessionId)) return []

  const sessionMessages = await getSessionMessages(sessionId)
  const entries: ChatHistoryEntry[] = []
  for (const sessionMessage of sessionMessages) {
    const message = sessionMessage.message as { role?: string; content?: unknown }
    entries.push(...extractHistoryEntries(message))
  }
  return entries
}
