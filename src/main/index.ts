import { app, shell, BrowserWindow, ipcMain, nativeImage, Notification } from 'electron'
import { join } from 'path'
import { loadConfig, saveConfig, type JiraConfig } from './store'
import { fetchMyIssues, fetchRecentComments, type JiraIssue } from './jira'
import { listClaudeSessions, renameClaudeSession } from './claudeSessions'
import { loadPriorityOrder, savePriorityOrder, type PriorityMap } from './priorities'
import { loadArchivedKeys, saveArchivedKeys, type ArchivedKeys } from './archive'
import { loadPinnedKeys, savePinnedKeys, type PinnedKeys } from './pinned'
import {
  loadDeployPendingKeys,
  saveDeployPendingKeys,
  type DeployPendingKeys
} from './deployPending'
import { loadQaRequestedKeys, saveQaRequestedKeys, type QaRequestedKeys } from './qaRequested'
import { loadTicketSessions, saveTicketSessions, type TicketSessionMap } from './ticketSessions'
import { listProjectSubdirs } from './projectDirs'
import { loadNotes, saveNotes } from './notes'
import { registerChatHandlers } from './chat'

const iconPath = join(__dirname, '../../resources/icon.png')

function requireConfig(): JiraConfig {
  const config = loadConfig()
  if (!config.siteUrl || !config.email || !config.apiToken) {
    throw new Error('Jira 설정이 없습니다. 설정을 먼저 입력해주세요.')
  }
  return config as JiraConfig
}

function createWindow(): BrowserWindow {
  const mainWindow = new BrowserWindow({
    width: 1440,
    height: 750,
    show: false,
    icon: iconPath,
    webPreferences: {
      preload: join(__dirname, '../preload/index.js'),
      sandbox: false
    }
  })

  mainWindow.on('ready-to-show', () => {
    mainWindow.show()
  })

  mainWindow.webContents.setWindowOpenHandler((details) => {
    shell.openExternal(details.url)
    return { action: 'deny' }
  })

  if (process.env.ELECTRON_RENDERER_URL) {
    mainWindow.loadURL(process.env.ELECTRON_RENDERER_URL)
  } else {
    mainWindow.loadFile(join(__dirname, '../renderer/index.html'))
  }

  return mainWindow
}

app.whenReady().then(() => {
  if (process.platform === 'darwin') {
    app.dock?.setIcon(nativeImage.createFromPath(iconPath))
  }

  ipcMain.handle('config:get', () => loadConfig())

  ipcMain.handle('config:save', (_event, config: JiraConfig) => {
    saveConfig(config)
  })

  ipcMain.handle('jira:fetchMyIssues', async () => {
    return fetchMyIssues(requireConfig())
  })

  ipcMain.handle('jira:fetchRecentComments', async (_event, issues: JiraIssue[]) => {
    return fetchRecentComments(requireConfig(), issues)
  })

  ipcMain.handle('claude:listSessions', () => listClaudeSessions())

  ipcMain.handle('claude:renameSession', (_event, sessionId: string, title: string) =>
    renameClaudeSession(sessionId, title)
  )

  ipcMain.handle('priority:get', () => loadPriorityOrder())

  ipcMain.handle('priority:save', (_event, order: PriorityMap) => {
    savePriorityOrder(order)
  })

  ipcMain.handle('archive:get', () => loadArchivedKeys())

  ipcMain.handle('archive:save', (_event, keys: ArchivedKeys) => {
    saveArchivedKeys(keys)
  })

  ipcMain.handle('pinned:get', () => loadPinnedKeys())

  ipcMain.handle('pinned:save', (_event, keys: PinnedKeys) => {
    savePinnedKeys(keys)
  })

  ipcMain.handle('deployPending:get', () => loadDeployPendingKeys())

  ipcMain.handle('deployPending:save', (_event, keys: DeployPendingKeys) => {
    saveDeployPendingKeys(keys)
  })

  ipcMain.handle('qaRequested:get', () => loadQaRequestedKeys())

  ipcMain.handle('qaRequested:save', (_event, keys: QaRequestedKeys) => {
    saveQaRequestedKeys(keys)
  })

  ipcMain.handle('ticketSession:get', () => loadTicketSessions())

  ipcMain.handle('ticketSession:save', (_event, map: TicketSessionMap) => {
    saveTicketSessions(map)
  })

  ipcMain.handle('project:listSubdirs', () => {
    const basePath = loadConfig().defaultProjectPath
    return basePath ? listProjectSubdirs(basePath) : []
  })

  ipcMain.handle('notes:get', () => loadNotes())

  ipcMain.handle('notes:save', (_event, text: string) => {
    saveNotes(text)
  })

  const mainWindow = createWindow()
  registerChatHandlers(mainWindow)

  ipcMain.on('app:notify', (_event, title: string, body: string) => {
    const notification = new Notification({ title, body })
    notification.on('click', () => {
      mainWindow.show()
      mainWindow.focus()
    })
    notification.show()
  })

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow()
  })
})

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') {
    app.quit()
  }
})
