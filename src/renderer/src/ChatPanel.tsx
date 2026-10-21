import { useEffect, useRef, useState } from 'react'
import type { ChatEvent } from '../../shared/types'

interface ChatMessage {
  id: string
  role: 'user' | 'assistant' | 'tool' | 'system'
  text: string
}

interface PendingPermission {
  id: string
  toolName: string
  input: Record<string, unknown>
}

interface ChatPanelProps {
  title: string
  sessionId: string
  onClose: () => void
}

function ChatPanel({ title, sessionId, onClose }: ChatPanelProps) {
  const [messages, setMessages] = useState<ChatMessage[]>([])
  const [input, setInput] = useState('')
  const [pendingPermission, setPendingPermission] = useState<PendingPermission | null>(null)
  const [busy, setBusy] = useState(false)
  const chatIdRef = useRef<string | null>(null)
  const scrollRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    let disposed = false
    let cleanup = (): void => {}

    window.api.chat.start(sessionId).then((chatId) => {
      if (disposed) {
        window.api.chat.dispose(chatId)
        return
      }
      chatIdRef.current = chatId
      cleanup = window.api.chat.onEvent(chatId, (event: ChatEvent) => {
        if (event.type === 'assistant-text') {
          setMessages((prev) => [
            ...prev,
            { id: crypto.randomUUID(), role: 'assistant', text: event.text }
          ])
        } else if (event.type === 'tool-use') {
          setMessages((prev) => [...prev, { id: event.id, role: 'tool', text: `🔧 ${event.name}` }])
        } else if (event.type === 'permission-request') {
          setPendingPermission({ id: event.id, toolName: event.toolName, input: event.input })
        } else if (event.type === 'turn-complete') {
          setBusy(false)
        } else if (event.type === 'error') {
          setMessages((prev) => [
            ...prev,
            { id: crypto.randomUUID(), role: 'system', text: `오류: ${event.message}` }
          ])
          setBusy(false)
        }
      })
    })

    return () => {
      disposed = true
      cleanup()
      if (chatIdRef.current) window.api.chat.dispose(chatIdRef.current)
    }
  }, [sessionId])

  useEffect(() => {
    scrollRef.current?.scrollTo({ top: scrollRef.current.scrollHeight })
  }, [messages, pendingPermission])

  function handleSend(): void {
    const text = input.trim()
    if (!text || !chatIdRef.current || pendingPermission) return
    setMessages((prev) => [...prev, { id: crypto.randomUUID(), role: 'user', text }])
    window.api.chat.send(chatIdRef.current, text)
    setInput('')
    setBusy(true)
  }

  function respondPermission(approve: boolean): void {
    if (!pendingPermission || !chatIdRef.current) return
    window.api.chat.respondPermission(chatIdRef.current, pendingPermission.id, approve)
    setPendingPermission(null)
  }

  return (
    <div className="chat-panel">
      <div className="terminal-header">
        <span>{title}</span>
        <button className="terminal-close-btn" onClick={onClose}>
          ✕
        </button>
      </div>

      <div ref={scrollRef} className="chat-messages">
        {messages.map((message) => (
          <div key={message.id} className={`chat-bubble chat-bubble-${message.role}`}>
            {message.text}
          </div>
        ))}
        {busy && !pendingPermission && (
          <div className="chat-bubble chat-bubble-system">생각 중...</div>
        )}
      </div>

      {pendingPermission && (
        <div className="chat-permission">
          <div>
            <strong>{pendingPermission.toolName}</strong> 실행 승인이 필요해요.
            <div className="meta">{JSON.stringify(pendingPermission.input)}</div>
          </div>
          <div className="chat-permission-actions">
            <button className="btn-primary" onClick={() => respondPermission(true)}>
              승인
            </button>
            <button className="btn-ghost" onClick={() => respondPermission(false)}>
              거부
            </button>
          </div>
        </div>
      )}

      <div className="chat-input-row">
        <input
          className="field"
          placeholder="메시지를 입력하세요"
          value={input}
          onChange={(e) => setInput(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter') handleSend()
          }}
          disabled={Boolean(pendingPermission)}
        />
        <button className="btn-primary" onClick={handleSend} disabled={Boolean(pendingPermission)}>
          전송
        </button>
      </div>
    </div>
  )
}

export default ChatPanel
