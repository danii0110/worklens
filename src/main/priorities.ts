import type { PriorityMap } from '../shared/types'
import { createJsonStore } from './jsonStore'

export type { PriorityMap }

function isPriorityMap(value: unknown): value is PriorityMap {
  return Boolean(value) && typeof value === 'object'
}

const store = createJsonStore<PriorityMap>('priorities.json', {}, isPriorityMap)

export const loadPriorityOrder = store.load
export const savePriorityOrder = store.save
