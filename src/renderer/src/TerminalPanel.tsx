import { useEffect, useRef } from 'react'
import { Terminal as XTerm } from '@xterm/xterm'
import { FitAddon } from '@xterm/addon-fit'
import '@xterm/xterm/css/xterm.css'

interface TerminalPanelProps {
  title: string
  sessionId: string
  onClose: () => void
}

function TerminalPanel({ title, sessionId, onClose }: TerminalPanelProps) {
  const containerRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    if (!containerRef.current) return

    const term = new XTerm({
      convertEol: true,
      fontSize: 13,
      theme: { background: '#1e2129', foreground: '#e5e7eb' }
    })
    const fitAddon = new FitAddon()
    term.loadAddon(fitAddon)
    term.open(containerRef.current)
    fitAddon.fit()

    let terminalId: string | null = null
    let disposed = false
    const cleanups: Array<() => void> = []

    window.api.terminal.create(sessionId).then((id) => {
      if (disposed) {
        window.api.terminal.dispose(id)
        return
      }
      terminalId = id
      cleanups.push(window.api.terminal.onData(id, (data) => term.write(data)))
      cleanups.push(
        window.api.terminal.onExit(id, () => {
          term.write('\r\n\r\n[세션 종료됨]\r\n')
        })
      )
      window.api.terminal.resize(id, term.cols, term.rows)
    })

    const dataDisposable = term.onData((data) => {
      if (terminalId) window.api.terminal.write(terminalId, data)
    })

    let resizeTimeout: ReturnType<typeof setTimeout> | undefined
    function handleResize(): void {
      clearTimeout(resizeTimeout)
      resizeTimeout = setTimeout(() => {
        fitAddon.fit()
        if (terminalId) window.api.terminal.resize(terminalId, term.cols, term.rows)
      }, 100)
    }
    window.addEventListener('resize', handleResize)

    return () => {
      disposed = true
      clearTimeout(resizeTimeout)
      window.removeEventListener('resize', handleResize)
      dataDisposable.dispose()
      cleanups.forEach((cleanup) => cleanup())
      if (terminalId) window.api.terminal.dispose(terminalId)
      term.dispose()
    }
  }, [sessionId])

  return (
    <div className="terminal-overlay">
      <div className="terminal-panel">
        <div className="terminal-header">
          <span>{title}</span>
          <button className="terminal-close-btn" onClick={onClose}>
            ✕
          </button>
        </div>
        <div ref={containerRef} className="terminal-body" />
      </div>
    </div>
  )
}

export default TerminalPanel
