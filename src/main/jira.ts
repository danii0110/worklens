import type { JiraConfig } from './store'

export interface JiraIssue {
  key: string
  summary: string
  status: string
  dueDate: string | null
  url: string
}

export async function fetchMyIssues(config: JiraConfig): Promise<JiraIssue[]> {
  const baseUrl = config.siteUrl.replace(/\/$/, '')
  const auth = Buffer.from(`${config.email}:${config.apiToken}`).toString('base64')
  const jql = encodeURIComponent('assignee = currentUser() AND resolution = Unresolved ORDER BY duedate ASC')

  const res = await fetch(
    `${baseUrl}/rest/api/3/search?jql=${jql}&fields=summary,status,duedate&maxResults=50`,
    {
      headers: {
        Authorization: `Basic ${auth}`,
        Accept: 'application/json'
      }
    }
  )

  if (!res.ok) {
    throw new Error(`Jira API 오류 (${res.status}): ${await res.text()}`)
  }

  const data = await res.json()

  return data.issues.map((issue: any) => ({
    key: issue.key,
    summary: issue.fields.summary,
    status: issue.fields.status?.name ?? '',
    dueDate: issue.fields.duedate ?? null,
    url: `${baseUrl}/browse/${issue.key}`
  }))
}
