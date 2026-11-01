import type { TicketMemoMap } from '../shared/types'
import { createJsonStore } from './jsonStore'

export type { TicketMemoMap }

function isTicketMemoMap(value: unknown): value is TicketMemoMap {
  return Boolean(value) && typeof value === 'object'
}

const store = createJsonStore<TicketMemoMap>('ticketMemos.json', {}, isTicketMemoMap)

export const loadTicketMemos = store.load
export const saveTicketMemos = store.save
