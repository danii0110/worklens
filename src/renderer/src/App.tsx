import { useEffect, useState } from 'react'

function App() {
  const [siteUrl, setSiteUrl] = useState(import.meta.env.VITE_JIRA_SITE_URL ?? '')
  const [email, setEmail] = useState(import.meta.env.VITE_JIRA_EMAIL ?? '')
  const [apiToken, setApiToken] = useState('')
  const [configured, setConfigured] = useState(false)
  const [issues, setIssues] = useState<Awaited<ReturnType<typeof window.api.fetchMyIssues>>>([])
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    window.api.getConfig().then((config) => {
      if (config.siteUrl) setSiteUrl(config.siteUrl)
      if (config.email) setEmail(config.email)
      if (config.apiToken) setApiToken(config.apiToken)
      setConfigured(Boolean(config.siteUrl && config.email && config.apiToken))
    })
  }, [])

  async function handleFetch(): Promise<void> {
    setLoading(true)
    setError(null)
    try {
      const result = await window.api.fetchMyIssues()
      setIssues(result)
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e))
    } finally {
      setLoading(false)
    }
  }

  async function handleSaveConfig(): Promise<void> {
    await window.api.saveConfig({ siteUrl, email, apiToken })
    setConfigured(true)
  }

  useEffect(() => {
    if (configured) handleFetch()
  }, [configured])

  function openExternal(url: string): void {
    window.open(url, '_blank')
  }

  return (
    <div style={{ fontFamily: 'sans-serif', padding: 24, maxWidth: 720, margin: '0 auto' }}>
      <h1>WorkLens</h1>

      <section style={{ marginBottom: 24, padding: 16, border: '1px solid #ddd', borderRadius: 8 }}>
        <h2 style={{ fontSize: 16, marginTop: 0 }}>Jira 설정</h2>
        <div style={{ display: 'grid', gap: 8 }}>
          <input
            placeholder="Jira 사이트 URL (예: https://yourcompany.atlassian.net)"
            value={siteUrl}
            onChange={(e) => setSiteUrl(e.target.value)}
          />
          <input placeholder="이메일" value={email} onChange={(e) => setEmail(e.target.value)} />
          <input
            placeholder="API 토큰"
            type="password"
            value={apiToken}
            onChange={(e) => setApiToken(e.target.value)}
          />
          <button onClick={handleSaveConfig}>저장하고 불러오기</button>
        </div>
      </section>

      <section>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
          <h2 style={{ fontSize: 16 }}>내 담당 티켓</h2>
          <button onClick={handleFetch} disabled={!configured || loading}>
            {loading ? '불러오는 중...' : '새로고침'}
          </button>
        </div>

        {error && <p style={{ color: 'crimson' }}>{error}</p>}

        {!loading && !error && configured && issues.length === 0 && <p>표시할 티켓이 없습니다.</p>}

        <ul style={{ listStyle: 'none', padding: 0 }}>
          {issues.map((issue) => (
            <li key={issue.key} style={{ padding: '8px 0', borderBottom: '1px solid #eee' }}>
              <a
                href={issue.url}
                onClick={(e) => {
                  e.preventDefault()
                  openExternal(issue.url)
                }}
              >
                <strong>{issue.key}</strong>
              </a>{' '}
              {issue.summary} — <em>{issue.status}</em>
              {issue.dueDate && <span> (마감 {issue.dueDate})</span>}
            </li>
          ))}
        </ul>
      </section>
    </div>
  )
}

export default App
