import type { DeployPendingKeys } from '../shared/types'
import { createJsonStore } from './jsonStore'

export type { DeployPendingKeys }

const store = createJsonStore<DeployPendingKeys>('deployPending.json', [], Array.isArray)

export const loadDeployPendingKeys = store.load
export const saveDeployPendingKeys = store.save
