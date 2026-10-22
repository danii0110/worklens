import { app } from 'electron'
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'fs'
import { join } from 'path'

export function createJsonStore<T>(
  filename: string,
  fallback: T,
  isValid: (value: unknown) => value is T
) {
  function getPath(): string {
    const dir = app.getPath('userData')
    if (!existsSync(dir)) mkdirSync(dir, { recursive: true })
    return join(dir, filename)
  }

  function load(): T {
    const path = getPath()
    if (!existsSync(path)) return fallback
    try {
      const data = JSON.parse(readFileSync(path, 'utf-8'))
      return isValid(data) ? data : fallback
    } catch {
      return fallback
    }
  }

  function save(value: T): void {
    writeFileSync(getPath(), JSON.stringify(value, null, 2), 'utf-8')
  }

  return { load, save }
}
