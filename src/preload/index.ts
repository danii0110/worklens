import { contextBridge, ipcRenderer } from 'electron'
import type { JiraConfig, JiraIssue, RecentComment, ClaudeSession } from '../shared/types'

export type { JiraConfig, JiraIssue, RecentComment, ClaudeSession }

function subscribe<Args extends unknown[]>(
  channel: string,
  terminalId: string,
  callback: (...args: Args) => void
): () => void {
  const listener = (_event: Electron.IpcRendererEvent, id: string, ...args: Args): void => {
    if (id === terminalId) callback(...args)
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
  terminal: {
    create: (sessionId: string): Promise<string> =>
      ipcRenderer.invoke('terminal:create', sessionId),
    write: (terminalId: string, data: string): void => {
      ipcRenderer.send('terminal:write', terminalId, data)
    },
    resize: (terminalId: string, cols: number, rows: number): void => {
      ipcRenderer.send('terminal:resize', terminalId, cols, rows)
    },
    dispose: (terminalId: string): void => {
      ipcRenderer.send('terminal:dispose', terminalId)
    },
    onData: (terminalId: string, callback: (data: string) => void): (() => void) =>
      subscribe('terminal:data', terminalId, callback),
    onExit: (terminalId: string, callback: () => void): (() => void) =>
      subscribe('terminal:exit', terminalId, callback)
  }
}

contextBridge.exposeInMainWorld('api', api)

export type Api = typeof api
