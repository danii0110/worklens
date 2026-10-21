import { createReadStream } from 'fs'
import { readdir, stat } from 'fs/promises'
import { createInterface } from 'readline'
import { homedir } from 'os'
import { join } from 'path'
import type { ClaudeSession } from '../shared/types'

export type { ClaudeSession }

const CLAUDE_PROJECTS_ROOT = join(homedir(), '.claude', 'projects')

interface SessionFile {
  sessionId: string
  fallbackProjectPath: string
  lastActive: string
  mtimeMs: number
  filePath: string
}

interface SessionMeta {
  preview: string
  cwd: string | null
}

const metaCache = new Map<string, { mtimeMs: number; meta: SessionMeta }>()

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

async function collectSessionFiles(root: string): Promise<SessionFile[]> {
  let projectDirs: string[]
  try {
    projectDirs = (await readdir(root, { withFileTypes: true }))
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
      files = (await readdir(dirPath)).filter((name) => name.endsWith('.jsonl'))
    } catch {
      continue
    }
    for (const file of files) {
      const filePath = join(dirPath, file)
      const stats = await stat(filePath)
      sessions.push({
        sessionId: file.replace(/\.jsonl$/, ''),
        fallbackProjectPath: decodeProjectDir(dir),
        lastActive: stats.mtime.toISOString(),
        mtimeMs: stats.mtimeMs,
        filePath
      })
    }
  }
  return sessions
}

async function readSessionMeta(filePath: string): Promise<SessionMeta> {
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

// Session files are append-only, so content for a given mtime never changes —
// safe to cache keyed by (filePath, mtimeMs) and skip re-parsing unchanged files.
async function getCachedSessionMeta(filePath: string, mtimeMs: number): Promise<SessionMeta> {
  const cached = metaCache.get(filePath)
  if (cached && cached.mtimeMs === mtimeMs) return cached.meta

  const meta = await readSessionMeta(filePath)
  metaCache.set(filePath, { mtimeMs, meta })
  return meta
}

export async function resolveSessionCwd(sessionId: string): Promise<string | null> {
  if (!/^[a-f0-9-]{36}$/i.test(sessionId)) return null

  const sessions = await collectSessionFiles(CLAUDE_PROJECTS_ROOT)
  const match = sessions.find((session) => session.sessionId === sessionId)
  if (!match) return null

  const { cwd } = await getCachedSessionMeta(match.filePath, match.mtimeMs)
  return cwd ?? match.fallbackProjectPath
}

export async function listClaudeSessions(limit = 30): Promise<ClaudeSession[]> {
  const sessions = await collectSessionFiles(CLAUDE_PROJECTS_ROOT)
  sessions.sort((a, b) => new Date(b.lastActive).getTime() - new Date(a.lastActive).getTime())
  const top = sessions.slice(0, limit)

  return Promise.all(
    top.map(async (session) => {
      const { preview, cwd } = await getCachedSessionMeta(session.filePath, session.mtimeMs)
      return {
        sessionId: session.sessionId,
        projectPath: cwd ?? session.fallbackProjectPath,
        lastActive: session.lastActive,
        preview
      }
    })
  )
}
