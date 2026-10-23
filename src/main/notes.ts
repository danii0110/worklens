import { createJsonStore } from './jsonStore'

function isString(value: unknown): value is string {
  return typeof value === 'string'
}

const store = createJsonStore<string>('notes.json', '', isString)

export const loadNotes = store.load
export const saveNotes = store.save
