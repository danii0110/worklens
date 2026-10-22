import { ipcMain, type BrowserWindow } from 'electron'
import { randomUUID } from 'crypto'
import {
  query,
  type SDKUserMessage,
  type CanUseTool,
  type PermissionResult
} from '@anthropic-ai/claude-agent-sdk'
import { resolveSessionCwd, getChatHistory } from './claudeSessions'
import { loadConfig } from './store'
import { resolveSubdirPath } from './projectDirs'
import type { ChatEvent } from '../shared/types'

function emit(mainWindow: BrowserWindow, chatId: string, event: ChatEvent): void {
  mainWindow.webContents.send('chat:event', chatId, event)
}

interface InputChannel {
  iterable: AsyncIterable<SDKUserMessage>
  push: (text: string) => void
  close: () => void
}

function createInputChannel(): InputChannel {
  const queue: SDKUserMessage[] = []
  let wake: (() => void) | null = null
  let closed = false

  function push(text: string): void {
    queue.push({ type: 'user', message: { role: 'user', content: text }, parent_tool_use_id: null })
    wake?.()
    wake = null
  }

  function close(): void {
    closed = true
    wake?.()
    wake = null
  }

  async function* generate(): AsyncGenerator<SDKUserMessage> {
    while (!closed) {
      if (queue.length > 0) {
        yield queue.shift() as SDKUserMessage
      } else {
        await new Promise<void>((resolve) => {
          wake = resolve
        })
      }
    }
  }

  return { iterable: generate(), push, close }
}

interface PendingPermission {
  resolve: (result: PermissionResult) => void
  input: Record<string, unknown>
}

interface ChatSession {
  channel: InputChannel
  pending: Map<string, PendingPermission>
  close: () => void
}

const chats = new Map<string, ChatSession>()

function startQuery(mainWindow: BrowserWindow, cwd: string, resume?: string): string {
  const chatId = randomUUID()
  const channel = createInputChannel()
  const pending = new Map<string, PendingPermission>()

  const canUseTool: CanUseTool = (toolName, input) => {
    return new Promise<PermissionResult>((resolve) => {
      const requestId = randomUUID()
      pending.set(requestId, { resolve, input })
      emit(mainWindow, chatId, { type: 'permission-request', id: requestId, toolName, input })
    })
  }

  const activeQuery = query({
    prompt: channel.iterable,
    options: { resume, cwd, canUseTool, permissionMode: 'default' }
  })

  chats.set(chatId, { channel, pending, close: () => activeQuery.close() })
  ;(async () => {
    try {
      for await (const message of activeQuery) {
        if ('session_id' in message && message.session_id) {
          emit(mainWindow, chatId, { type: 'session-id', sessionId: message.session_id })
        }
        if (message.type === 'assistant') {
          for (const block of message.message.content) {
            if (block.type === 'text') {
              emit(mainWindow, chatId, { type: 'assistant-text', text: block.text })
            } else if (block.type === 'tool_use') {
              emit(mainWindow, chatId, { type: 'tool-use', id: block.id, name: block.name })
            }
          }
        } else if (message.type === 'result') {
          emit(mainWindow, chatId, { type: 'turn-complete' })
        }
      }
    } catch (error) {
      emit(mainWindow, chatId, {
        type: 'error',
        message: error instanceof Error ? error.message : String(error)
      })
    }
  })()

  return chatId
}

export function registerChatHandlers(mainWindow: BrowserWindow): void {
  ipcMain.handle('chat:getHistory', (_event, sessionId: string) => getChatHistory(sessionId))

  ipcMain.handle('chat:start', async (_event, sessionId: string) => {
    const cwd = await resolveSessionCwd(sessionId)
    if (!cwd) {
      throw new Error('세션을 찾을 수 없습니다.')
    }
    return startQuery(mainWindow, cwd, sessionId)
  })

  ipcMain.handle('chat:startNew', (_event, subdir?: string) => {
    const basePath = loadConfig().defaultProjectPath
    if (!basePath) {
      throw new Error('기본 프로젝트 경로가 설정되지 않았습니다.')
    }
    if (!subdir) {
      return startQuery(mainWindow, basePath)
    }
    const cwd = resolveSubdirPath(basePath, subdir)
    if (!cwd) {
      throw new Error('하위 프로젝트 폴더를 찾을 수 없습니다.')
    }
    return startQuery(mainWindow, cwd)
  })

  ipcMain.on('chat:send', (_event, chatId: string, text: string) => {
    chats.get(chatId)?.channel.push(text)
  })

  ipcMain.on(
    'chat:respondPermission',
    (_event, chatId: string, requestId: string, approve: boolean) => {
      const chat = chats.get(chatId)
      const request = chat?.pending.get(requestId)
      if (!request) return
      chat?.pending.delete(requestId)
      request.resolve(
        approve
          ? { behavior: 'allow', updatedInput: request.input }
          : { behavior: 'deny', message: '사용자가 거부했습니다.' }
      )
    }
  )

  ipcMain.on('chat:dispose', (_event, chatId: string) => {
    const chat = chats.get(chatId)
    chat?.channel.close()
    chat?.close()
    chats.delete(chatId)
  })
}
