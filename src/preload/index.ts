import { contextBridge, ipcRenderer } from 'electron'
import type {
  JiraConfig,
  JiraIssue,
  RecentComment,
  ClaudeSession,
  ChatEvent
} from '../shared/types'

export type { JiraConfig, JiraIssue, RecentComment, ClaudeSession, ChatEvent }

function subscribe<Args extends unknown[]>(
  channel: string,
  id: string,
  callback: (...args: Args) => void
): () => void {
  const listener = (_event: Electron.IpcRendererEvent, eventId: string, ...args: Args): void => {
    if (eventId === id) callback(...args)
  }
  ipcRenderer.on(channel, listener)
  return () => ipcRenderer.removeListener(channel, listener)
}

const api = {
  getConfig: (): Promise<Partial<JiraConfig>> => ipcRenderer.invoke('config:get'),
  saveConfig: (config: JiraConfig): Promise<void> => ipcRenderer.invoke('config:save', config),
  fetchMyIssues: (): Promise<JiraIssue[]> => ipcRenderer.invoke('jira:fetchMyIssues'),
  fetchRecentComments: (issues: JiraIssue[]): Promise<RecentComment[]> =>
    ipcRenderer.invoke('jira:fetchRecentComments', issues),
  listClaudeSessions: (): Promise<ClaudeSession[]> => ipcRenderer.invoke('claude:listSessions'),
  chat: {
    start: (sessionId: string): Promise<string> => ipcRenderer.invoke('chat:start', sessionId),
    send: (chatId: string, text: string): void => {
      ipcRenderer.send('chat:send', chatId, text)
    },
    respondPermission: (chatId: string, requestId: string, approve: boolean): void => {
      ipcRenderer.send('chat:respondPermission', chatId, requestId, approve)
    },
    dispose: (chatId: string): void => {
      ipcRenderer.send('chat:dispose', chatId)
    },
    onEvent: (chatId: string, callback: (event: ChatEvent) => void): (() => void) =>
      subscribe('chat:event', chatId, callback)
  }
}

contextBridge.exposeInMainWorld('api', api)

export type Api = typeof api
