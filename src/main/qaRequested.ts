import type { QaRequestedKeys } from '../shared/types'
import { createJsonStore } from './jsonStore'

export type { QaRequestedKeys }

const store = createJsonStore<QaRequestedKeys>('qaRequested.json', [], Array.isArray)

export const loadQaRequestedKeys = store.load
export const saveQaRequestedKeys = store.save
