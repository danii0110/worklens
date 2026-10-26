import type { PinnedKeys } from '../shared/types'
import { createJsonStore } from './jsonStore'

export type { PinnedKeys }

const store = createJsonStore<PinnedKeys>('pinned.json', [], Array.isArray)

export const loadPinnedKeys = store.load
export const savePinnedKeys = store.save
