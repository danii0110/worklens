import { createReadStream, readdirSync, statSync } from 'fs'
import { createInterface } from 'readline'
import { homedir } from 'os'
import { join } from 'path'

export interface ClaudeSession {
  sessionId: string
  projectPath: string
  lastActive: string
  preview: string
}

interface SessionFile {
  sessionId: string
  fallbackProjectPath: string
  lastActive: string
  filePath: string
}

function decodeProjectDir(dirName: string): string {
  return dirName.replace(/^-/, '/').replace(/-/g, '/')
}

function extractContentText(content: unknown): string | null {
  if (typeof content === 'string') return content
  if (Array.isArray(content)) {
    for (const block of content) {
      if (
        block &&
        typeof block === 'object' &&
        typeof (block as { text?: unknown }).text === 'string'
      ) {
        return (block as { text: string }).text
      }
    }
  }
  return null
}

function collectSessionFiles(root: string): SessionFile[] {
  let projectDirs: string[]
  try {
    projectDirs = readdirSync(root, { withFileTypes: true })
      .filter((entry) => entry.isDirectory())
      .map((entry) => entry.name)
  } catch {
    return []
  }

  const sessions: SessionFile[] = []
  for (const dir of projectDirs) {
    const dirPath = join(root, dir)
    let files: string[]
    try {
      files = readdirSync(dirPath).filter((name) => name.endsWith('.jsonl'))
    } catch {
      continue
    }
    for (const file of files) {
      const filePath = join(dirPath, file)
      const stats = statSync(filePath)
      sessions.push({
        sessionId: file.replace(/\.jsonl$/, ''),
        fallbackProjectPath: decodeProjectDir(dir),
        lastActive: stats.mtime.toISOString(),
        filePath
      })
    }
  }
  return sessions
}

async function readSessionMeta(filePath: string): Promise<{ preview: string; cwd: string | null }> {
  const rl = createInterface({ input: createReadStream(filePath, { encoding: 'utf-8' }) })
  let cwd: string | null = null
  try {
    for await (const line of rl) {
      if (!line.trim()) continue
      let entry: Record<string, unknown>
      try {
        entry = JSON.parse(line)
      } catch {
        continue
      }
      if (!cwd && typeof entry.cwd === 'string') cwd = entry.cwd
      if (entry.type === 'user') {
        const message = entry.message as { content?: unknown } | undefined
        const text = extractContentText(message?.content)
        if (text) {
          return { preview: text.replace(/\s+/g, ' ').trim().slice(0, 140), cwd }
        }
      }
    }
    return { preview: '(미리보기 없음)', cwd }
  } finally {
    rl.close()
  }
}

export async function resolveSessionCwd(sessionId: string): Promise<string | null> {
  if (!/^[a-f0-9-]{36}$/i.test(sessionId)) return null

  const root = join(homedir(), '.claude', 'projects')
  const match = collectSessionFiles(root).find((session) => session.sessionId === sessionId)
  if (!match) return null

  const { cwd } = await readSessionMeta(match.filePath)
  return cwd ?? match.fallbackProjectPath
}

export async function listClaudeSessions(limit = 30): Promise<ClaudeSession[]> {
  const root = join(homedir(), '.claude', 'projects')
  const sessions = collectSessionFiles(root)
  sessions.sort((a, b) => new Date(b.lastActive).getTime() - new Date(a.lastActive).getTime())
  const top = sessions.slice(0, limit)

  return Promise.all(
    top.map(async (session) => {
      const { preview, cwd } = await readSessionMeta(session.filePath)
      return {
        sessionId: session.sessionId,
        projectPath: cwd ?? session.fallbackProjectPath,
        lastActive: session.lastActive,
        preview
      }
    })
  )
}
