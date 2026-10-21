import { contextBridge, ipcRenderer } from 'electron'

export interface JiraConfig {
  siteUrl: string
  email: string
  apiToken: string
}

export interface JiraIssue {
  key: string
  summary: string
  status: string
  dueDate: string | null
  url: string
}

const api = {
  getConfig: (): Promise<Partial<JiraConfig>> => ipcRenderer.invoke('config:get'),
  saveConfig: (config: JiraConfig): Promise<void> => ipcRenderer.invoke('config:save', config),
  fetchMyIssues: (): Promise<JiraIssue[]> => ipcRenderer.invoke('jira:fetchMyIssues')
}

contextBridge.exposeInMainWorld('api', api)

export type Api = typeof api
