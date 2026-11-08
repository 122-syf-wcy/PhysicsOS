/** SUPER_ADMIN website content and inbox client. Public projection is server-owned. */
import type { FeedbackKind, FeedbackStatus } from './notice-api.ts'

const BASE = '/physicsos/notice'

export interface WebsiteTestimonial {
  id: string
  name: string
  role: string
  quote: string
  topic: string
  color: string
  order: number
  enabled: boolean
  sourceFeedbackId?: string
}

export interface WebsiteContributor {
  id: string
  name: string
  role: string
  project: string
  description: string
  url: string
  avatar: string
  color: string
  order: number
  enabled: boolean
}

export interface WebsiteContent {
  version: number
  testimonials: WebsiteTestimonial[]
  contributors: WebsiteContributor[]
  updatedAt: string
  updatedBy: string
}

export interface WebsiteFeedback {
  id: string
  kind: FeedbackKind
  body: string
  contact?: string
  context?: string
  status: FeedbackStatus
  reply?: string
  createdAt: string
  repliedBy?: string
  repliedAt?: string
  images: { id: string; name: string; mediaType: string; url: string }[]
}

export interface WebsiteContentInput {
  expectedVersion: number
  testimonials: WebsiteTestimonial[]
  contributors: WebsiteContributor[]
}

export interface WebsiteApi {
  getContent: () => Promise<{ content: WebsiteContent }>
  saveContent: (input: WebsiteContentInput) => Promise<{ content: WebsiteContent }>
  listFeedback: (filter: { status: FeedbackStatus; offset: number; limit: number }) => Promise<{ feedback: WebsiteFeedback[]; total: number }>
  replyFeedback: (id: string, input: { reply: string; status: 'answered' | 'closed' }) => Promise<{ feedback: WebsiteFeedback }>
}

export class WebsiteApiError extends Error {
  constructor(readonly status: number, readonly code: string, message: string) {
    super(message)
    this.name = 'WebsiteApiError'
  }
}

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  const response = await fetch(`${BASE}${path}`, {
    credentials: 'include',
    cache: 'no-store',
    headers: { 'content-type': 'application/json' },
    ...init,
  })
  const body = await response.json().catch(() => ({})) as {
    error?: { code?: string; message?: string }
  }
  if (!response.ok) {
    throw new WebsiteApiError(response.status, body.error?.code ?? `HTTP_${response.status}`, body.error?.message ?? `${response.status}`)
  }
  return body as T
}

export function createWebsiteApi(): WebsiteApi {
  return {
    getContent: () => request('/website'),
    saveContent: input => request('/website', { method: 'PUT', body: JSON.stringify(input) }),
    listFeedback: ({ status, offset, limit }) => request(`/website-feedback?${new URLSearchParams({ status, offset: String(offset), limit: String(limit) })}`),
    replyFeedback: (id, input) => request(`/website-feedback/${encodeURIComponent(id)}/reply`, { method: 'POST', body: JSON.stringify(input) }),
  }
}
