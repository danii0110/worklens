import { app } from 'electron'
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'fs'
import { join } from 'path'
import type { PriorityMap } from '../shared/types'

export type { PriorityMap }

function getPrioritiesPath(): string {
  const dir = app.getPath('userData')
  if (!existsSync(dir)) mkdirSync(dir, { recursive: true })
  return join(dir, 'priorities.json')
}

export function loadPriorityOrder(): PriorityMap {
  const path = getPrioritiesPath()
  if (!existsSync(path)) return {}
  try {
    const data = JSON.parse(readFileSync(path, 'utf-8'))
    return data && typeof data === 'object' ? data : {}
  } catch {
    return {}
  }
}

export function savePriorityOrder(order: PriorityMap): void {
  writeFileSync(getPrioritiesPath(), JSON.stringify(order, null, 2), 'utf-8')
}
