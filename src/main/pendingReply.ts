import type { PendingReplyKeys } from '../shared/types'
import { createJsonStore } from './jsonStore'

export type { PendingReplyKeys }

const store = createJsonStore<PendingReplyKeys>('pendingReply.json', [], Array.isArray)

export const loadPendingReplyKeys = store.load
export const savePendingReplyKeys = store.save
