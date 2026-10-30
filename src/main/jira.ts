import type { JiraConfig, JiraIssue, RecentComment } from '../shared/types'

export type { JiraIssue, RecentComment }

interface JiraApiIssue {
  key: string
  fields: {
    summary: string
    status?: { name: string; statusCategory?: { key: string } }
    duedate?: string | null
  }
}

interface JiraSearchResponse {
  issues: JiraApiIssue[]
}

interface AdfNode {
  type?: string
  text?: string
  content?: AdfNode[]
}

interface JiraCommentApiResponse {
  comments: Array<{
    author?: { displayName?: string }
    body?: AdfNode
    created: string
  }>
}

function getAuthContext(config: JiraConfig): { baseUrl: string; headers: HeadersInit } {
  const baseUrl = config.siteUrl.replace(/\/$/, '')
  const auth = Buffer.from(`${config.email}:${config.apiToken}`).toString('base64')
  return { baseUrl, headers: { Authorization: `Basic ${auth}`, Accept: 'application/json' } }
}

function extractPlainText(node: AdfNode | undefined): string {
  if (!node) return ''
  let result = ''
  for (const child of node.content ?? []) {
    if (child.text) result += child.text
    result += extractPlainText(child)
    if (child.type === 'paragraph') result += ' '
  }
  return result.trim()
}

export async function fetchMyIssues(config: JiraConfig): Promise<JiraIssue[]> {
  const { baseUrl, headers } = getAuthContext(config)
  const jql = encodeURIComponent(
    'assignee = currentUser() AND statusCategory != Done ORDER BY duedate ASC'
  )

  const res = await fetch(
    `${baseUrl}/rest/api/3/search/jql?jql=${jql}&fields=summary,status,duedate&maxResults=50`,
    { headers }
  )

  if (!res.ok) {
    throw new Error(`Jira API 오류 (${res.status}): ${await res.text()}`)
  }

  const data: JiraSearchResponse = await res.json()

  return data.issues.map((issue) => ({
    key: issue.key,
    summary: issue.fields.summary,
    status: issue.fields.status?.name ?? '',
    statusCategory: issue.fields.status?.statusCategory?.key ?? '',
    dueDate: issue.fields.duedate ?? null,
    url: `${baseUrl}/browse/${issue.key}`
  }))
}

async function fetchIssueComments(
  config: JiraConfig,
  issue: JiraIssue
): Promise<RecentComment | null> {
  const { baseUrl, headers } = getAuthContext(config)
  const res = await fetch(
    `${baseUrl}/rest/api/3/issue/${issue.key}/comment?orderBy=-created&maxResults=50`,
    { headers }
  )
  if (!res.ok) return null

  const data: JiraCommentApiResponse = await res.json()
  const allComments = data.comments.map((comment) => ({
    author: comment.author?.displayName ?? '알 수 없음',
    body: extractPlainText(comment.body).slice(0, 140),
    created: comment.created
  }))
  const latest = allComments[0]
  if (!latest) return null

  return {
    issueKey: issue.key,
    issueSummary: issue.summary,
    url: issue.url,
    allComments,
    ...latest
  }
}

export async function fetchRecentComments(
  config: JiraConfig,
  issues: JiraIssue[]
): Promise<RecentComment[]> {
  const results = await Promise.all(issues.map((issue) => fetchIssueComments(config, issue)))
  return results.filter((comment): comment is RecentComment => comment !== null)
}
