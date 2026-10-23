import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import ChatPanel from './ChatPanel'
import { usePolling } from './usePolling'

const POLL_INTERVAL_MS = 5 * 60 * 1000
const RECENTLY_ACTIVE_THRESHOLD_MS = 2 * 60 * 1000
const TICKETS_TAB = 'tickets'

type JiraIssue = Awaited<ReturnType<typeof window.api.fetchMyIssues>>[number]
type RecentComment = Awaited<ReturnType<typeof window.api.fetchRecentComments>>[number]
type ClaudeSession = Awaited<ReturnType<typeof window.api.listClaudeSessions>>[number]
type PriorityMap = Awaited<ReturnType<typeof window.api.getPriorityOrder>>
type ArchivedKeys = Awaited<ReturnType<typeof window.api.getArchivedKeys>>
type TicketSessionMap = Awaited<ReturnType<typeof window.api.getTicketSessions>>

interface OpenTab {
  tabId: string
  session: ClaudeSession
  kind: 'new' | 'resume'
  ticketKey?: string
  subdir?: string
  status?: 'busy' | 'done'
}

const DONE_PHRASES = ['완료했어요!', '다 했어요~', '짜잔, 끝!', '작업 끝났어요!']

function pickDonePhrase(): string {
  return DONE_PHRASES[Math.floor(Math.random() * DONE_PHRASES.length)]
}

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

// Issues with a saved position come first in that order; anything new or
// not yet manually prioritized keeps its existing (due-date) relative order
// appended at the end.
function applyPriorityOrder(
  status: string,
  items: JiraIssue[],
  priorityMap: PriorityMap
): JiraIssue[] {
  const order = priorityMap[status]
  if (!order || order.length === 0) return items

  const remaining = new Map(items.map((issue) => [issue.key, issue]))
  const ordered: JiraIssue[] = []
  for (const key of order) {
    const issue = remaining.get(key)
    if (issue) {
      ordered.push(issue)
      remaining.delete(key)
    }
  }
  for (const issue of items) {
    if (remaining.has(issue.key)) ordered.push(issue)
  }
  return ordered
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
  const [defaultProjectPath, setDefaultProjectPath] = useState('')
  const [configured, setConfigured] = useState(false)
  const [issues, setIssues] = useState<JiraIssue[]>([])
  const [comments, setComments] = useState<RecentComment[]>([])
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [lastUpdated, setLastUpdated] = useState<Date | null>(null)
  const [showSettings, setShowSettings] = useState(false)
  const [claudeSessions, setClaudeSessions] = useState<ClaudeSession[]>([])
  const [openTabs, setOpenTabs] = useState<OpenTab[]>([])
  const [activeTabId, setActiveTabId] = useState<string>(TICKETS_TAB)
  const [renamingSessionId, setRenamingSessionId] = useState<string | null>(null)
  const [renameDraft, setRenameDraft] = useState('')
  const [searchQuery, setSearchQuery] = useState('')
  const [priorityMap, setPriorityMap] = useState<PriorityMap>({})
  const [draggedKey, setDraggedKey] = useState<string | null>(null)
  const [dragOverKey, setDragOverKey] = useState<string | null>(null)
  const [archivedKeys, setArchivedKeys] = useState<ArchivedKeys>([])
  const [viewMode, setViewMode] = useState<'active' | 'archived'>('active')
  const [statusFilter, setStatusFilter] = useState<string | null>(null)
  const [ticketSessions, setTicketSessions] = useState<TicketSessionMap>({})
  const [projectSubdirs, setProjectSubdirs] = useState<string[]>([])
  const [toasts, setToasts] = useState<{ id: string; text: string }[]>([])
  const seenCommentKeysRef = useRef<Set<string> | null>(null)

  useEffect(() => {
    window.api.getPriorityOrder().then(setPriorityMap)
    window.api.getArchivedKeys().then(setArchivedKeys)
    window.api.getTicketSessions().then(setTicketSessions)
    window.api.listProjectSubdirs().then(setProjectSubdirs)
  }, [])

  function selectViewMode(mode: 'active' | 'archived'): void {
    setViewMode(mode)
    setStatusFilter(null)
  }

  function emptyStateMessage(): string {
    if (searchQuery.trim()) return '검색 결과가 없습니다.'
    if (statusFilter) return '해당 상태의 티켓이 없습니다.'
    if (viewMode === 'archived') return '보관한 티켓이 없습니다.'
    return '표시할 티켓이 없습니다.'
  }

  function toggleArchive(issueKey: string): void {
    const next = archivedKeys.includes(issueKey)
      ? archivedKeys.filter((key) => key !== issueKey)
      : [...archivedKeys, issueKey]
    setArchivedKeys(next)
    window.api.saveArchivedKeys(next)
  }

  function reorderIssue(
    status: string,
    displayOrder: string[],
    draggedIssueKey: string,
    targetIssueKey: string
  ): void {
    if (draggedIssueKey === targetIssueKey) return
    const fromIndex = displayOrder.indexOf(draggedIssueKey)
    if (fromIndex === -1 || displayOrder.indexOf(targetIssueKey) === -1) return

    const nextOrder = [...displayOrder]
    nextOrder.splice(fromIndex, 1)
    nextOrder.splice(nextOrder.indexOf(targetIssueKey), 0, draggedIssueKey)

    const nextPriorityMap = { ...priorityMap, [status]: nextOrder }
    setPriorityMap(nextPriorityMap)
    window.api.savePriorityOrder(nextPriorityMap)
  }

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

  const handleFetch = useCallback(async (): Promise<void> => {
    setLoading(true)
    setError(null)
    try {
      const issueResult = await window.api.fetchMyIssues()
      const commentResult = await window.api.fetchRecentComments(issueResult)
      notifyNewComments(commentResult)
      setIssues(issueResult)
      setComments(commentResult)
      setLastUpdated(new Date())
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e))
    } finally {
      setLoading(false)
    }
  }, [notifyNewComments])

  useEffect(() => {
    window.api.getConfig().then((config) => {
      if (config.siteUrl) setSiteUrl(config.siteUrl)
      if (config.email) setEmail(config.email)
      if (config.apiToken) setApiToken(config.apiToken)
      if (config.defaultProjectPath) setDefaultProjectPath(config.defaultProjectPath)
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
    await window.api.saveConfig({ siteUrl, email, apiToken, defaultProjectPath })
    setConfigured(true)
    setShowSettings(false)
    handleFetch()
    window.api.listProjectSubdirs().then(setProjectSubdirs)
  }

  function openExternal(url: string): void {
    window.open(url, '_blank')
  }

  function updateTab(tabId: string, updater: (tab: OpenTab) => OpenTab): void {
    setOpenTabs((prev) => prev.map((t) => (t.tabId === tabId ? updater(t) : t)))
  }

  function selectTab(tabId: string): void {
    setActiveTabId(tabId)
    updateTab(tabId, (t) => ({ ...t, status: undefined }))
  }

  function pushToast(text: string): void {
    const id = crypto.randomUUID()
    setToasts((prev) => [...prev, { id, text }])
    setTimeout(() => setToasts((prev) => prev.filter((t) => t.id !== id)), 4000)
  }

  function handleTabStatusChange(tabId: string, status: 'busy' | 'done'): void {
    updateTab(tabId, (t) => ({ ...t, status }))
    if (status === 'done' && tabId !== activeTabId) {
      const tab = openTabs.find((t) => t.tabId === tabId)
      if (tab) pushToast(`🐣 ${tab.session.title} ${pickDonePhrase()}`)
    }
  }

  function handleOpenSession(session: ClaudeSession): void {
    const alreadyOpen = openTabs.some((t) => t.tabId === session.sessionId)
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
      setOpenTabs((prev) => [...prev, { tabId: session.sessionId, session, kind: 'resume' }])
    }
    selectTab(session.sessionId)
  }

  function handleCloseTab(tabId: string): void {
    setOpenTabs((prev) => prev.filter((t) => t.tabId !== tabId))
    if (activeTabId === tabId) {
      setActiveTabId(TICKETS_TAB)
    }
  }

  function makeSessionStub(sessionId: string, title: string, lastActive?: string): ClaudeSession {
    return {
      sessionId,
      projectPath: defaultProjectPath,
      title,
      lastActive: lastActive ?? new Date().toISOString(),
      preview: ''
    }
  }

  function resolveSessionObject(sessionId: string): ClaudeSession {
    return (
      claudeSessions.find((s) => s.sessionId === sessionId) ??
      openTabs.find((t) => t.tabId === sessionId)?.session ??
      makeSessionStub(sessionId, sessionId, new Date(0).toISOString())
    )
  }

  function handleStartNewSessionForTicket(
    issueKey: string,
    issueSummary: string,
    subdir?: string
  ): void {
    if (!defaultProjectPath) {
      window.alert('설정에서 "기본 프로젝트 경로"를 먼저 지정해주세요.')
      setShowSettings(true)
      return
    }
    const tabId = `new-${crypto.randomUUID()}`
    const title = subdir ? `${issueKey} (${subdir})` : `${issueKey} ${issueSummary}`
    const stub = makeSessionStub(tabId, title)
    setOpenTabs((prev) => [
      ...prev,
      { tabId, session: stub, kind: 'new', ticketKey: issueKey, subdir }
    ])
    selectTab(tabId)
  }

  function handleNewSessionCreated(
    tabId: string,
    ticketKey: string | undefined,
    sessionId: string
  ): void {
    updateTab(tabId, (t) => ({ ...t, session: { ...t.session, sessionId } }))
    const tab = openTabs.find((t) => t.tabId === tabId)
    if (tab) {
      setClaudeSessions((prev) => [{ ...tab.session, sessionId }, ...prev])
    }
    if (ticketKey) {
      const next = { ...ticketSessions, [ticketKey]: sessionId }
      setTicketSessions(next)
      window.api.saveTicketSessions(next)
    }
  }

  function startRename(session: ClaudeSession): void {
    setRenamingSessionId(session.sessionId)
    setRenameDraft(session.title)
  }

  async function commitRename(session: ClaudeSession): Promise<void> {
    setRenamingSessionId(null)
    const nextTitle = renameDraft.trim()
    if (!nextTitle || nextTitle === session.title || session.sessionId.startsWith('new-')) return
    await window.api.renameClaudeSession(session.sessionId, nextTitle)
    const applyRename = (s: ClaudeSession): ClaudeSession =>
      s.sessionId === session.sessionId ? { ...s, title: nextTitle } : s
    setClaudeSessions((prev) => prev.map(applyRename))
    updateTab(session.sessionId, (t) => ({ ...t, session: applyRename(t.session) }))
  }

  const commentsByIssueKey = useMemo(
    () => new Map(comments.map((comment) => [comment.issueKey, comment])),
    [comments]
  )
  const archivedKeySet = useMemo(() => new Set(archivedKeys), [archivedKeys])
  const { activeIssues, archivedIssues } = useMemo(() => {
    const active: JiraIssue[] = []
    const archived: JiraIssue[] = []
    for (const issue of issues) {
      ;(archivedKeySet.has(issue.key) ? archived : active).push(issue)
    }
    return { activeIssues: active, archivedIssues: archived }
  }, [issues, archivedKeySet])
  const visibleIssues = viewMode === 'archived' ? archivedIssues : activeIssues
  const filteredIssues = useMemo(() => {
    const query = searchQuery.trim().toLowerCase()
    let result = visibleIssues
    if (query) {
      result = result.filter(
        (issue) =>
          issue.key.toLowerCase().includes(query) || issue.summary.toLowerCase().includes(query)
      )
    }
    if (statusFilter) {
      result = result.filter((issue) => issue.status === statusFilter)
    }
    return result
  }, [visibleIssues, searchQuery, statusFilter])
  const groupedIssues = useMemo(() => {
    return groupByStatus(filteredIssues).map(
      ([status, items]) => [status, applyPriorityOrder(status, items, priorityMap)] as const
    )
  }, [filteredIssues, priorityMap])
  const statusSummary = useMemo(() => groupByStatus(visibleIssues), [visibleIssues])

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
                        if (e.key === 'Enter' && !e.nativeEvent.isComposing) commitRename(session)
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
            {openTabs.map(({ tabId, session, status }) => (
              <div
                key={tabId}
                className={`main-tab ${tabId === activeTabId ? 'main-tab-active' : ''}`}
                onClick={() => selectTab(tabId)}
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
                      if (e.key === 'Enter' && !e.nativeEvent.isComposing) commitRename(session)
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
                    {status === 'busy' ? '💭 ' : status === 'done' ? '🐣 ' : ''}
                    {session.title}
                  </span>
                )}
                <button
                  className="chat-tab-close"
                  onClick={(e) => {
                    e.stopPropagation()
                    handleCloseTab(tabId)
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
                  <input
                    className="field"
                    placeholder="기본 프로젝트 경로 (예: /Users/me/dev/my-repo) — 티켓 '새로하기'에 사용"
                    value={defaultProjectPath}
                    onChange={(e) => setDefaultProjectPath(e.target.value)}
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
                  <input
                    className="field search-field"
                    placeholder="티켓 검색"
                    value={searchQuery}
                    onChange={(e) => setSearchQuery(e.target.value)}
                  />
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

              <div className="view-toggle">
                <button
                  className={`view-toggle-btn ${viewMode === 'active' ? 'view-toggle-active' : ''}`}
                  onClick={() => selectViewMode('active')}
                >
                  볼 티켓 {activeIssues.length}
                </button>
                <button
                  className={`view-toggle-btn ${viewMode === 'archived' ? 'view-toggle-active' : ''}`}
                  onClick={() => selectViewMode('archived')}
                >
                  보관함 {archivedIssues.length}
                </button>
              </div>

              {statusSummary.length > 0 && (
                <div className="status-summary">
                  {statusSummary.map(([status, items]) => (
                    <button
                      key={status}
                      className={`status-summary-chip ${statusFilter === status ? 'status-summary-chip-active' : ''}`}
                      onClick={() => setStatusFilter((prev) => (prev === status ? null : status))}
                    >
                      {status} {items.length}
                    </button>
                  ))}
                </div>
              )}

              {error && <div className="error-banner">{error}</div>}

              {!loading && !error && configured && filteredIssues.length === 0 && (
                <div className="empty-state">{emptyStateMessage()}</div>
              )}

              {groupedIssues.map(([status, items]) => (
                <div key={status} className="status-group">
                  <ul className="issue-list">
                    {items.map((issue) => {
                      const comment = commentsByIssueKey.get(issue.key)
                      const displayOrder = items.map((i) => i.key)
                      const dueDateClass = getDueDateClass(issue.dueDate)
                      return (
                        <li
                          key={issue.key}
                          className={`issue-item issue-item-${dueDateClass} ${dragOverKey === issue.key ? 'issue-item-drag-over' : ''}`}
                          onDragOver={(e) => {
                            e.preventDefault()
                            setDragOverKey(issue.key)
                          }}
                          onDragLeave={() => setDragOverKey(null)}
                          onDrop={(e) => {
                            e.preventDefault()
                            if (draggedKey)
                              reorderIssue(status, displayOrder, draggedKey, issue.key)
                            setDraggedKey(null)
                            setDragOverKey(null)
                          }}
                        >
                          <div className="issue-row">
                            <span
                              className="drag-handle"
                              draggable
                              onDragStart={() => setDraggedKey(issue.key)}
                              onDragEnd={() => {
                                setDraggedKey(null)
                                setDragOverKey(null)
                              }}
                              title="드래그해서 순서 변경"
                            >
                              ⠿
                            </span>
                            <div className="issue-title-group">
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
                          </div>
                          {comment && (
                            <div className="issue-comment">
                              💬 <strong>{comment.author}</strong> {comment.body}
                              <span className="meta"> · {formatRelativeTime(comment.created)}</span>
                            </div>
                          )}
                          <div className="issue-actions">
                            {ticketSessions[issue.key] ? (
                              <button
                                className="btn-ghost issue-action-btn"
                                onClick={() =>
                                  handleOpenSession(resolveSessionObject(ticketSessions[issue.key]))
                                }
                              >
                                이어하기
                              </button>
                            ) : (
                              <button
                                className="btn-ghost issue-action-btn"
                                onClick={() =>
                                  handleStartNewSessionForTicket(issue.key, issue.summary)
                                }
                                disabled={!defaultProjectPath}
                                title={
                                  defaultProjectPath
                                    ? undefined
                                    : '설정에서 기본 프로젝트 경로를 먼저 지정하세요'
                                }
                              >
                                새로하기
                              </button>
                            )}
                            {!ticketSessions[issue.key] && projectSubdirs.length > 0 && (
                              <select
                                className="field subdir-select"
                                value=""
                                onChange={(e) => {
                                  const subdir = e.target.value
                                  if (subdir) {
                                    handleStartNewSessionForTicket(issue.key, issue.summary, subdir)
                                  }
                                }}
                              >
                                <option value="" disabled>
                                  하위 폴더 선택
                                </option>
                                {projectSubdirs.map((dir) => (
                                  <option key={dir} value={dir}>
                                    {dir}
                                  </option>
                                ))}
                              </select>
                            )}
                            <button
                              className="archive-btn"
                              onClick={() => toggleArchive(issue.key)}
                            >
                              {viewMode === 'archived' ? '꺼내기' : '보관'}
                            </button>
                            {issue.dueDate && (
                              <span className={`due-date due-date-${dueDateClass}`}>
                                {issue.dueDate}
                              </span>
                            )}
                          </div>
                        </li>
                      )
                    })}
                  </ul>
                </div>
              ))}
            </section>
          </div>

          {openTabs.map((tab) => (
            <div
              key={tab.tabId}
              className="chat-tab-panel"
              style={{ display: tab.tabId === activeTabId ? 'flex' : 'none' }}
            >
              <ChatPanel
                tabId={tab.tabId}
                mode={
                  tab.kind === 'new'
                    ? {
                        type: 'new',
                        subdir: tab.subdir,
                        onSessionCreated: (sessionId) =>
                          handleNewSessionCreated(tab.tabId, tab.ticketKey, sessionId)
                      }
                    : { type: 'resume', sessionId: tab.session.sessionId }
                }
                onStatusChange={(status) => handleTabStatusChange(tab.tabId, status)}
              />
            </div>
          ))}

          <div className="toast-container">
            {toasts.map((toast) => (
              <div key={toast.id} className="toast">
                {toast.text}
              </div>
            ))}
          </div>
        </main>
      </div>
    </div>
  )
}

export default App
