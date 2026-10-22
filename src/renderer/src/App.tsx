import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import ChatPanel from './ChatPanel'
import { usePolling } from './usePolling'

const POLL_INTERVAL_MS = 5 * 60 * 1000
const RECENTLY_ACTIVE_THRESHOLD_MS = 2 * 60 * 1000
const TICKETS_TAB = 'tickets'

type JiraIssue = Awaited<ReturnType<typeof window.api.fetchMyIssues>>[number]
type RecentComment = Awaited<ReturnType<typeof window.api.fetchRecentComments>>[number]
type ClaudeSession = Awaited<ReturnType<typeof window.api.listClaudeSessions>>[number]

// Explicit order for known statuses; anything else falls back to its Jira
// status category (in-progress-like, then new, then done) instead of an
// arbitrary position.
const STATUS_ORDER = ['진행 중', '개발완료', '미해결']
const CATEGORY_RANK: Record<string, number> = { indeterminate: 0, new: 1, done: 2 }

function statusRank(status: string, items: JiraIssue[]): number {
  const explicitRank = STATUS_ORDER.indexOf(status)
  if (explicitRank !== -1) return explicitRank
  const category = items[0]?.statusCategory ?? ''
  return STATUS_ORDER.length + (CATEGORY_RANK[category] ?? Object.keys(CATEGORY_RANK).length)
}

function groupByStatus(issues: JiraIssue[]): Array<[string, JiraIssue[]]> {
  const groups = new Map<string, JiraIssue[]>()
  for (const issue of issues) {
    const group = groups.get(issue.status) ?? []
    group.push(issue)
    groups.set(issue.status, group)
  }
  return Array.from(groups.entries()).sort(
    ([a, itemsA], [b, itemsB]) => statusRank(a, itemsA) - statusRank(b, itemsB)
  )
}

function getDueDateClass(dueDate: string | null): 'overdue' | 'soon' | 'normal' {
  if (!dueDate) return 'normal'
  const diffDays = Math.ceil((new Date(dueDate).getTime() - Date.now()) / 86_400_000)
  if (diffDays < 0) return 'overdue'
  if (diffDays <= 3) return 'soon'
  return 'normal'
}

function isRecentlyActive(lastActive: string): boolean {
  return Date.now() - new Date(lastActive).getTime() < RECENTLY_ACTIVE_THRESHOLD_MS
}

function formatRelativeTime(iso: string): string {
  const diffMinutes = Math.floor((Date.now() - new Date(iso).getTime()) / 60_000)
  if (diffMinutes < 1) return '방금 전'
  if (diffMinutes < 60) return `${diffMinutes}분 전`
  const diffHours = Math.floor(diffMinutes / 60)
  if (diffHours < 24) return `${diffHours}시간 전`
  return `${Math.floor(diffHours / 24)}일 전`
}

function App() {
  const [siteUrl, setSiteUrl] = useState(import.meta.env.VITE_JIRA_SITE_URL ?? '')
  const [email, setEmail] = useState(import.meta.env.VITE_JIRA_EMAIL ?? '')
  const [apiToken, setApiToken] = useState('')
  const [configured, setConfigured] = useState(false)
  const [issues, setIssues] = useState<JiraIssue[]>([])
  const [comments, setComments] = useState<RecentComment[]>([])
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [lastUpdated, setLastUpdated] = useState<Date | null>(null)
  const [showSettings, setShowSettings] = useState(false)
  const [claudeSessions, setClaudeSessions] = useState<ClaudeSession[]>([])
  const [openSessions, setOpenSessions] = useState<ClaudeSession[]>([])
  const [activeTabId, setActiveTabId] = useState<string>(TICKETS_TAB)
  const [renamingSessionId, setRenamingSessionId] = useState<string | null>(null)
  const [renameDraft, setRenameDraft] = useState('')
  const [searchQuery, setSearchQuery] = useState('')
  const seenCommentKeysRef = useRef<Set<string> | null>(null)
  const notifiedDeadlineKeysRef = useRef<Set<string>>(new Set())

  const notifyNewComments = useCallback((commentResult: RecentComment[]) => {
    const seen = seenCommentKeysRef.current
    const nextKeys = new Set(commentResult.map((c) => `${c.issueKey}:${c.created}`))
    if (seen) {
      for (const comment of commentResult) {
        const key = `${comment.issueKey}:${comment.created}`
        if (!seen.has(key)) {
          window.api.notify(`${comment.issueKey} 새 댓글`, `${comment.author}: ${comment.body}`)
        }
      }
    }
    seenCommentKeysRef.current = nextKeys
  }, [])

  const notifyApproachingDeadlines = useCallback((issueResult: JiraIssue[]) => {
    for (const issue of issueResult) {
      const urgency = getDueDateClass(issue.dueDate)
      if (urgency === 'normal' || notifiedDeadlineKeysRef.current.has(issue.key)) continue
      notifiedDeadlineKeysRef.current.add(issue.key)
      const label = urgency === 'overdue' ? '마감 지남' : '마감 임박'
      window.api.notify(`${issue.key} ${label}`, issue.summary)
    }
  }, [])

  const handleFetch = useCallback(async (): Promise<void> => {
    setLoading(true)
    setError(null)
    try {
      const issueResult = await window.api.fetchMyIssues()
      const commentResult = await window.api.fetchRecentComments(issueResult)
      notifyNewComments(commentResult)
      notifyApproachingDeadlines(issueResult)
      setIssues(issueResult)
      setComments(commentResult)
      setLastUpdated(new Date())
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e))
    } finally {
      setLoading(false)
    }
  }, [notifyNewComments, notifyApproachingDeadlines])

  useEffect(() => {
    window.api.getConfig().then((config) => {
      if (config.siteUrl) setSiteUrl(config.siteUrl)
      if (config.email) setEmail(config.email)
      if (config.apiToken) setApiToken(config.apiToken)
      const isConfigured = Boolean(config.siteUrl && config.email && config.apiToken)
      setConfigured(isConfigured)
      setShowSettings(!isConfigured)
    })
  }, [])

  usePolling(handleFetch, POLL_INTERVAL_MS, configured)

  const handleFetchSessions = useCallback(async (): Promise<void> => {
    setClaudeSessions(await window.api.listClaudeSessions())
  }, [])

  usePolling(handleFetchSessions, POLL_INTERVAL_MS)

  async function handleSaveConfig(): Promise<void> {
    await window.api.saveConfig({ siteUrl, email, apiToken })
    setConfigured(true)
    setShowSettings(false)
    handleFetch()
  }

  function openExternal(url: string): void {
    window.open(url, '_blank')
  }

  function handleOpenSession(session: ClaudeSession): void {
    const alreadyOpen = openSessions.some((s) => s.sessionId === session.sessionId)
    if (!alreadyOpen) {
      if (
        isRecentlyActive(session.lastActive) &&
        !window.confirm(
          '이 세션은 방금까지 활동이 있었어요. 다른 창에서 지금 진행 중인 세션일 수 있습니다.\n' +
            '같은 세션을 동시에 두 군데서 열면 대화 기록이 꼬일 수 있어요. 그래도 이어서 대화하시겠어요?'
        )
      ) {
        return
      }
      setOpenSessions((prev) => [...prev, session])
    }
    setActiveTabId(session.sessionId)
  }

  function handleCloseTab(sessionId: string): void {
    setOpenSessions((prev) => prev.filter((s) => s.sessionId !== sessionId))
    if (activeTabId === sessionId) {
      setActiveTabId(TICKETS_TAB)
    }
  }

  function startRename(session: ClaudeSession): void {
    setRenamingSessionId(session.sessionId)
    setRenameDraft(session.title)
  }

  async function commitRename(session: ClaudeSession): Promise<void> {
    setRenamingSessionId(null)
    const nextTitle = renameDraft.trim()
    if (!nextTitle || nextTitle === session.title) return
    await window.api.renameClaudeSession(session.sessionId, nextTitle)
    const applyRename = (s: ClaudeSession): ClaudeSession =>
      s.sessionId === session.sessionId ? { ...s, title: nextTitle } : s
    setClaudeSessions((prev) => prev.map(applyRename))
    setOpenSessions((prev) => prev.map(applyRename))
  }

  const commentsByIssueKey = useMemo(
    () => new Map(comments.map((comment) => [comment.issueKey, comment])),
    [comments]
  )
  const filteredIssues = useMemo(() => {
    const query = searchQuery.trim().toLowerCase()
    if (!query) return issues
    return issues.filter(
      (issue) =>
        issue.key.toLowerCase().includes(query) || issue.summary.toLowerCase().includes(query)
    )
  }, [issues, searchQuery])
  const groupedIssues = useMemo(() => groupByStatus(filteredIssues), [filteredIssues])
  const statusSummary = useMemo(() => groupByStatus(issues), [issues])

  return (
    <div className="app">
      <div className="header">
        <h1>WorkLens</h1>
        <button
          className="icon-button"
          onClick={() => setShowSettings((prev) => !prev)}
          title="Jira 설정"
        >
          ⚙️
        </button>
      </div>

      <div className="layout">
        <aside className="sidebar">
          <section className="card">
            <div className="section-header">
              <h2>Claude 세션</h2>
            </div>

            {claudeSessions.length === 0 && <div className="empty-state">세션이 없습니다.</div>}

            <ul className="session-list">
              {claudeSessions.map((session) => (
                <li key={session.sessionId} className="session-item">
                  {renamingSessionId === session.sessionId ? (
                    <input
                      className="field rename-input"
                      autoFocus
                      value={renameDraft}
                      onChange={(e) => setRenameDraft(e.target.value)}
                      onBlur={() => commitRename(session)}
                      onKeyDown={(e) => {
                        if (e.key === 'Enter') commitRename(session)
                        if (e.key === 'Escape') setRenamingSessionId(null)
                      }}
                    />
                  ) : (
                    <div
                      className="session-title"
                      title={`${session.projectPath}\n더블클릭하면 제목 변경`}
                      onDoubleClick={() => startRename(session)}
                    >
                      {session.title}
                    </div>
                  )}
                  <div className="session-preview">{session.preview}</div>
                  <div className="session-footer">
                    <span className="meta">{formatRelativeTime(session.lastActive)}</span>
                    <button
                      className="btn-ghost"
                      onClick={() => handleOpenSession(session)}
                      title="이 세션 이어서 대화하기"
                    >
                      이어하기
                    </button>
                  </div>
                </li>
              ))}
            </ul>
          </section>
        </aside>

        <main className="main">
          <div className="main-tabs">
            <div
              className={`main-tab ${activeTabId === TICKETS_TAB ? 'main-tab-active' : ''}`}
              onClick={() => setActiveTabId(TICKETS_TAB)}
            >
              내 담당 티켓
            </div>
            {openSessions.map((session) => (
              <div
                key={session.sessionId}
                className={`main-tab ${session.sessionId === activeTabId ? 'main-tab-active' : ''}`}
                onClick={() => setActiveTabId(session.sessionId)}
                title="더블클릭하면 제목 변경"
              >
                {renamingSessionId === session.sessionId ? (
                  <input
                    className="rename-input rename-input-tab"
                    autoFocus
                    value={renameDraft}
                    onClick={(e) => e.stopPropagation()}
                    onChange={(e) => setRenameDraft(e.target.value)}
                    onBlur={() => commitRename(session)}
                    onKeyDown={(e) => {
                      if (e.key === 'Enter') commitRename(session)
                      if (e.key === 'Escape') setRenamingSessionId(null)
                    }}
                  />
                ) : (
                  <span
                    className="chat-tab-title"
                    onDoubleClick={(e) => {
                      e.stopPropagation()
                      startRename(session)
                    }}
                  >
                    {session.title}
                  </span>
                )}
                <button
                  className="chat-tab-close"
                  onClick={(e) => {
                    e.stopPropagation()
                    handleCloseTab(session.sessionId)
                  }}
                >
                  ✕
                </button>
              </div>
            ))}
          </div>

          <div
            className="main-view"
            style={{ display: activeTabId === TICKETS_TAB ? 'block' : 'none' }}
          >
            {showSettings && (
              <section className="card">
                <h2>Jira 설정</h2>
                <div style={{ display: 'grid', gap: 10 }}>
                  <input
                    className="field"
                    placeholder="Jira 사이트 URL (예: https://yourcompany.atlassian.net)"
                    value={siteUrl}
                    onChange={(e) => setSiteUrl(e.target.value)}
                  />
                  <input
                    className="field"
                    placeholder="이메일"
                    value={email}
                    onChange={(e) => setEmail(e.target.value)}
                  />
                  <input
                    className="field"
                    placeholder="API 토큰"
                    type="password"
                    value={apiToken}
                    onChange={(e) => setApiToken(e.target.value)}
                  />
                  <button className="btn-primary" onClick={handleSaveConfig}>
                    저장하고 불러오기
                  </button>
                </div>
              </section>
            )}

            <section className="card">
              <div className="section-header">
                <h2>내 담당 티켓</h2>
                <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                  {lastUpdated && (
                    <span className="meta">
                      마지막 업데이트 {lastUpdated.toLocaleTimeString('ko-KR')}
                    </span>
                  )}
                  <button
                    className="btn-ghost"
                    onClick={handleFetch}
                    disabled={!configured || loading}
                  >
                    {loading ? '불러오는 중...' : '새로고침'}
                  </button>
                </div>
              </div>

              {statusSummary.length > 0 && (
                <div className="status-summary">
                  {statusSummary.map(([status, items]) => (
                    <span key={status} className="status-summary-chip">
                      {status} {items.length}
                    </span>
                  ))}
                </div>
              )}

              <input
                className="field"
                style={{ marginBottom: 14 }}
                placeholder="티켓 검색 (키 또는 제목)"
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
              />

              {error && <div className="error-banner">{error}</div>}

              {!loading && !error && configured && filteredIssues.length === 0 && (
                <div className="empty-state">
                  {searchQuery.trim() ? '검색 결과가 없습니다.' : '표시할 티켓이 없습니다.'}
                </div>
              )}

              {groupedIssues.map(([status, items]) => (
                <div key={status} className="status-group">
                  <span className="status-badge">
                    {status} {items.length}
                  </span>
                  <ul className="issue-list">
                    {items.map((issue) => {
                      const comment = commentsByIssueKey.get(issue.key)
                      return (
                        <li key={issue.key} className="issue-item">
                          <div className="issue-row">
                            <div>
                              <a
                                className="issue-key"
                                href={issue.url}
                                onClick={(e) => {
                                  e.preventDefault()
                                  openExternal(issue.url)
                                }}
                              >
                                {issue.key}
                              </a>{' '}
                              <span className="issue-summary">{issue.summary}</span>
                            </div>
                            {issue.dueDate && (
                              <span className={`due-date ${getDueDateClass(issue.dueDate)}`}>
                                {issue.dueDate}
                              </span>
                            )}
                          </div>
                          {comment && (
                            <div className="issue-comment">
                              💬 <strong>{comment.author}</strong> {comment.body}
                              <span className="meta"> · {formatRelativeTime(comment.created)}</span>
                            </div>
                          )}
                        </li>
                      )
                    })}
                  </ul>
                </div>
              ))}
            </section>
          </div>

          {openSessions.map((session) => (
            <div
              key={session.sessionId}
              className="chat-tab-panel"
              style={{ display: session.sessionId === activeTabId ? 'flex' : 'none' }}
            >
              <ChatPanel sessionId={session.sessionId} />
            </div>
          ))}
        </main>
      </div>
    </div>
  )
}

export default App
