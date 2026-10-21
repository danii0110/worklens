import { useCallback, useEffect, useState } from 'react'

const POLL_INTERVAL_MS = 5 * 60 * 1000

type JiraIssue = Awaited<ReturnType<typeof window.api.fetchMyIssues>>[number]
type RecentComment = Awaited<ReturnType<typeof window.api.fetchRecentComments>>[number]

function groupByStatus(issues: JiraIssue[]): Array<[string, JiraIssue[]]> {
  const groups = new Map<string, JiraIssue[]>()
  for (const issue of issues) {
    const group = groups.get(issue.status) ?? []
    group.push(issue)
    groups.set(issue.status, group)
  }
  return Array.from(groups.entries())
}

function getDueDateClass(dueDate: string | null): 'overdue' | 'soon' | 'normal' {
  if (!dueDate) return 'normal'
  const diffDays = Math.ceil((new Date(dueDate).getTime() - Date.now()) / 86_400_000)
  if (diffDays < 0) return 'overdue'
  if (diffDays <= 3) return 'soon'
  return 'normal'
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

  const handleFetch = useCallback(async (): Promise<void> => {
    setLoading(true)
    setError(null)
    try {
      const [issueResult, commentResult] = await Promise.all([
        window.api.fetchMyIssues(),
        window.api.fetchRecentComments()
      ])
      setIssues(issueResult)
      setComments(commentResult)
      setLastUpdated(new Date())
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e))
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    window.api.getConfig().then((config) => {
      if (config.siteUrl) setSiteUrl(config.siteUrl)
      if (config.email) setEmail(config.email)
      if (config.apiToken) setApiToken(config.apiToken)
      const isConfigured = Boolean(config.siteUrl && config.email && config.apiToken)
      setConfigured(isConfigured)
      setShowSettings(!isConfigured)
      if (isConfigured) handleFetch()
    })
  }, [handleFetch])

  useEffect(() => {
    if (!configured) return
    const interval = setInterval(handleFetch, POLL_INTERVAL_MS)
    return () => clearInterval(interval)
  }, [configured, handleFetch])

  async function handleSaveConfig(): Promise<void> {
    await window.api.saveConfig({ siteUrl, email, apiToken })
    setConfigured(true)
    setShowSettings(false)
    handleFetch()
  }

  function openExternal(url: string): void {
    window.open(url, '_blank')
  }

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
            <button className="btn-ghost" onClick={handleFetch} disabled={!configured || loading}>
              {loading ? '불러오는 중...' : '새로고침'}
            </button>
          </div>
        </div>

        {error && <div className="error-banner">{error}</div>}

        {!loading && !error && configured && issues.length === 0 && (
          <div className="empty-state">표시할 티켓이 없습니다.</div>
        )}

        {groupByStatus(issues).map(([status, items]) => (
          <div key={status} className="status-group">
            <span className="status-badge">
              {status} {items.length}
            </span>
            <ul className="issue-list">
              {items.map((issue) => (
                <li key={issue.key} className="issue-item">
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
                </li>
              ))}
            </ul>
          </div>
        ))}
      </section>

      <section className="card">
        <div className="section-header">
          <h2>최근 댓글</h2>
        </div>

        {!loading && !error && configured && comments.length === 0 && (
          <div className="empty-state">최근 댓글이 없습니다.</div>
        )}

        <ul className="issue-list">
          {comments.map((comment) => (
            <li key={`${comment.issueKey}-${comment.created}`} className="issue-item">
              <div>
                <a
                  className="issue-key"
                  href={comment.url}
                  onClick={(e) => {
                    e.preventDefault()
                    openExternal(comment.url)
                  }}
                >
                  {comment.issueKey}
                </a>{' '}
                <span className="issue-summary">
                  <strong>{comment.author}</strong> {comment.body}
                </span>
              </div>
              <span className="due-date normal">{formatRelativeTime(comment.created)}</span>
            </li>
          ))}
        </ul>
      </section>
    </div>
  )
}

export default App
