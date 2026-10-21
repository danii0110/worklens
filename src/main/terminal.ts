import { ipcMain, type BrowserWindow } from 'electron'
import { randomUUID } from 'crypto'
import * as pty from 'node-pty'
import { resolveSessionCwd } from './claudeSessions'

const terminals = new Map<string, pty.IPty>()

export function registerTerminalHandlers(mainWindow: BrowserWindow): void {
  ipcMain.handle('terminal:create', async (_event, sessionId: string) => {
    const cwd = await resolveSessionCwd(sessionId)
    if (!cwd) {
      throw new Error('세션을 찾을 수 없습니다.')
    }

    const shell = process.env.SHELL || '/bin/zsh'
    const terminalId = randomUUID()

    // sessionId is passed as a positional shell parameter ($1), never concatenated
    // into the command string, so it cannot be used for shell injection.
    const ptyProcess = pty.spawn(shell, ['-lc', 'claude --resume "$1"', shell, sessionId], {
      name: 'xterm-color',
      cols: 80,
      rows: 30,
      cwd,
      env: process.env as Record<string, string>
    })

    ptyProcess.onData((data) => {
      mainWindow.webContents.send('terminal:data', terminalId, data)
    })

    ptyProcess.onExit(() => {
      mainWindow.webContents.send('terminal:exit', terminalId)
      terminals.delete(terminalId)
    })

    terminals.set(terminalId, ptyProcess)
    return terminalId
  })

  ipcMain.on('terminal:write', (_event, terminalId: string, data: string) => {
    terminals.get(terminalId)?.write(data)
  })

  ipcMain.on('terminal:resize', (_event, terminalId: string, cols: number, rows: number) => {
    terminals.get(terminalId)?.resize(cols, rows)
  })

  ipcMain.on('terminal:dispose', (_event, terminalId: string) => {
    terminals.get(terminalId)?.kill()
    terminals.delete(terminalId)
  })
}
