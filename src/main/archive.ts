import type { ArchivedKeys } from '../shared/types'
import { createJsonStore } from './jsonStore'

export type { ArchivedKeys }

const store = createJsonStore<ArchivedKeys>('archive.json', [], Array.isArray)

export const loadArchivedKeys = store.load
export const saveArchivedKeys = store.save
