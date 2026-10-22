import { readdirSync } from 'fs'
import { join } from 'path'

const IGNORED = new Set(['node_modules', '.git'])

export function listProjectSubdirs(basePath: string): string[] {
  try {
    return readdirSync(basePath, { withFileTypes: true })
      .filter(
        (entry) => entry.isDirectory() && !entry.name.startsWith('.') && !IGNORED.has(entry.name)
      )
      .map((entry) => entry.name)
      .sort()
  } catch {
    return []
  }
}

// Re-validates subdir against the real directory listing (not just string
// shape) before joining, so a renderer can only ever pick a cwd that
// genuinely exists under basePath — never traverse outside it.
export function resolveSubdirPath(basePath: string, subdir: string): string | null {
  if (!listProjectSubdirs(basePath).includes(subdir)) return null
  return join(basePath, subdir)
}
