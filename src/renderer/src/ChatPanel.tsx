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

type ChatPanelMode =
  | { type: 'resume'; sessionId: string }
  | { type: 'new'; onSessionCreated: (sessionId: string) => void }

interface ChatPanelProps {
  tabId: string
  mode: ChatPanelMode
}

function ChatPanel({ tabId, mode }: ChatPanelProps) {
  const [messages, setMessages] = useState<ChatMessage[]>([])
  const [loadingHistory, setLoadingHistory] = useState(mode.type === 'resume')
  const [input, setInput] = useState('')
  const [pendingPermission, setPendingPermission] = useState<PendingPermission | null>(null)
  const [busy, setBusy] = useState(false)
  const chatIdRef = useRef<string | null>(null)
  const scrollRef = useRef<HTMLDivElement>(null)
  const initialModeRef = useRef(mode)

  useEffect(() => {
    const initialMode = initialModeRef.current
    let disposed = false
    let cleanup = (): void => {}

    function attach(chatId: string): void {
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
        } else if (event.type === 'session-id' && initialMode.type === 'new') {
          initialMode.onSessionCreated(event.sessionId)
        }
      })
    }

    if (initialMode.type === 'resume') {
      window.api.chat.getHistory(initialMode.sessionId).then((history) => {
        if (disposed) return
        const historyMessages: ChatMessage[] = history.map((entry) => ({
          id: crypto.randomUUID(),
          role: entry.role,
          text: entry.text
        }))
        if (historyMessages.length > 0) {
          historyMessages.push({
            id: crypto.randomUUID(),
            role: 'system',
            text: '— 여기까지 이전 대화 —'
          })
        }
        setMessages(historyMessages)
        setLoadingHistory(false)
      })

      window.api.chat.start(initialMode.sessionId).then(attach)
    } else {
      window.api.chat.startNew().then(attach)
    }

    return () => {
      disposed = true
      cleanup()
      if (chatIdRef.current) window.api.chat.dispose(chatIdRef.current)
    }
  }, [tabId])

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
      <div ref={scrollRef} className="chat-messages">
        {loadingHistory && (
          <div className="chat-bubble chat-bubble-system">이전 대화 불러오는 중...</div>
        )}
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
