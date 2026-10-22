import { contextBridge, ipcRenderer } from 'electron'
import type {
  JiraConfig,
  JiraIssue,
  RecentComment,
  ClaudeSession,
  ChatEvent,
  ChatHistoryEntry,
  PriorityMap,
  ArchivedKeys,
  TicketSessionMap
} from '../shared/types'

export type {
  JiraConfig,
  JiraIssue,
  RecentComment,
  ClaudeSession,
  ChatEvent,
  ChatHistoryEntry,
  PriorityMap,
  ArchivedKeys,
  TicketSessionMap
}

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
  renameClaudeSession: (sessionId: string, title: string): Promise<void> =>
    ipcRenderer.invoke('claude:renameSession', sessionId, title),
  notify: (title: string, body: string): void => {
    ipcRenderer.send('app:notify', title, body)
  },
  getPriorityOrder: (): Promise<PriorityMap> => ipcRenderer.invoke('priority:get'),
  savePriorityOrder: (order: PriorityMap): Promise<void> =>
    ipcRenderer.invoke('priority:save', order),
  getArchivedKeys: (): Promise<ArchivedKeys> => ipcRenderer.invoke('archive:get'),
  saveArchivedKeys: (keys: ArchivedKeys): Promise<void> => ipcRenderer.invoke('archive:save', keys),
  getTicketSessions: (): Promise<TicketSessionMap> => ipcRenderer.invoke('ticketSession:get'),
  saveTicketSessions: (map: TicketSessionMap): Promise<void> =>
    ipcRenderer.invoke('ticketSession:save', map),
  chat: {
    getHistory: (sessionId: string): Promise<ChatHistoryEntry[]> =>
      ipcRenderer.invoke('chat:getHistory', sessionId),
    start: (sessionId: string): Promise<string> => ipcRenderer.invoke('chat:start', sessionId),
    startNew: (): Promise<string> => ipcRenderer.invoke('chat:startNew'),
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
