import type { TicketSessionMap } from '../shared/types'
import { createJsonStore } from './jsonStore'

export type { TicketSessionMap }

function isTicketSessionMap(value: unknown): value is TicketSessionMap {
  return Boolean(value) && typeof value === 'object'
}

const store = createJsonStore<TicketSessionMap>('ticketSessions.json', {}, isTicketSessionMap)

export const loadTicketSessions = store.load
export const saveTicketSessions = store.save
