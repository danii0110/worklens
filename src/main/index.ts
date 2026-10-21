import { app, shell, BrowserWindow, ipcMain, nativeImage } from 'electron'
import { join } from 'path'
import { loadConfig, saveConfig, type JiraConfig } from './store'
import { fetchMyIssues, fetchRecentComments } from './jira'
import { listClaudeSessions } from './claudeSessions'

const iconPath = join(__dirname, '../../resources/icon.png')

function requireConfig(): JiraConfig {
  const config = loadConfig()
  if (!config.siteUrl || !config.email || !config.apiToken) {
    throw new Error('Jira 설정이 없습니다. 설정을 먼저 입력해주세요.')
  }
  return config as JiraConfig
}

function createWindow(): void {
  const mainWindow = new BrowserWindow({
    width: 1100,
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

  ipcMain.handle('jira:fetchRecentComments', async () => {
    const config = requireConfig()
    const issues = await fetchMyIssues(config)
    return fetchRecentComments(config, issues)
  })

  ipcMain.handle('claude:listSessions', () => listClaudeSessions())

  createWindow()

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow()
  })
})

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') {
    app.quit()
  }
})
