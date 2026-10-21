import { app } from 'electron'
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'fs'
import { join } from 'path'

export interface JiraConfig {
  siteUrl: string
  email: string
  apiToken: string
}

function getConfigPath(): string {
  const dir = app.getPath('userData')
  if (!existsSync(dir)) mkdirSync(dir, { recursive: true })
  return join(dir, 'config.json')
}

export function loadConfig(): Partial<JiraConfig> {
  const path = getConfigPath()
  if (!existsSync(path)) return {}
  try {
    return JSON.parse(readFileSync(path, 'utf-8'))
  } catch {
    return {}
  }
}

export function saveConfig(config: JiraConfig): void {
  writeFileSync(getConfigPath(), JSON.stringify(config, null, 2), 'utf-8')
}
