// @vitest-environment jsdom
import { describe, expect, it } from 'vitest'

import {
  NOTICE_CACHE_KEY,
  NOTICE_CACHE_LIMIT,
  readCachedAnnouncements,
  writeCachedAnnouncements,
} from '../src/client/notice-cache.ts'
import type { AnnouncementRow } from '../src/client/notice-api.ts'

const row = (over: Partial<AnnouncementRow> = {}): AnnouncementRow => ({
  id: 'an-1',
  schoolId: null,
  title: '版本更新',
  body: '实验中心新增四台装置',
  authorKey: 'PHYSICSOS-OPEN:admin',
  publishedAt: '2026-09-24T02:00:00Z',
  createdAt: '2026-09-24T02:00:00Z',
  ...over,
})

/** A minimal in-memory Storage; the jsdom localStorage is shared across tests. */
const store = () => {
  const map = new Map<string, string>()
  return {
    getItem: (key: string) => map.get(key) ?? null,
    setItem: (key: string, value: string) => { map.set(key, value) },
  }
}

describe('notice offline cache', () => {
  it('round-trips the announcements the server actually sent', () => {
    const storage = store()
    writeCachedAnnouncements(storage, [row(), row({ id: 'an-2', title: '开学通知' })])
    const back = readCachedAnnouncements(storage)
    expect(back.map(item => item.id)).toEqual(['an-1', 'an-2'])
    expect(back[1]!.title).toBe('开学通知')
  })

  it('answers an empty list when nothing was ever cached', () => {
    expect(readCachedAnnouncements(store())).toEqual([])
  })

  it('answers an empty list when there is no storage at all', () => {
    /* A stripped composition has no storage — the board must still render. */
    expect(readCachedAnnouncements(undefined)).toEqual([])
    expect(() => { writeCachedAnnouncements(undefined, [row()]) }).not.toThrow()
  })

  it('degrades to empty rather than throwing on a corrupt payload', () => {
    const storage = store()
    storage.setItem(NOTICE_CACHE_KEY, '{not json')
    expect(readCachedAnnouncements(storage)).toEqual([])
  })

  it('degrades to empty when the payload is the wrong shape', () => {
    const storage = store()
    storage.setItem(NOTICE_CACHE_KEY, JSON.stringify({ items: [row()] }))
    expect(readCachedAnnouncements(storage)).toEqual([])
  })

  it('drops rows missing the fields the pane renders', () => {
    const storage = store()
    storage.setItem(NOTICE_CACHE_KEY, JSON.stringify([
      row({ id: 'good' }),
      { id: 'no-body' },
      { id: 'bad-title', body: 'x', title: 7, authorKey: 'a', createdAt: 'c', schoolId: null },
    ]))
    /* A row without `body` would render an empty <p> that reads like a notice
       saying nothing, so it is dropped here rather than drawn. */
    expect(readCachedAnnouncements(storage).map(item => item.id)).toEqual(['good'])
  })

  it('caps the cache so it stays a last screen, not an archive', () => {
    const storage = store()
    const many = Array.from({ length: NOTICE_CACHE_LIMIT + 15 }, (_, i) => row({ id: `an-${i}` }))
    writeCachedAnnouncements(storage, many)
    expect(readCachedAnnouncements(storage)).toHaveLength(NOTICE_CACHE_LIMIT)
  })

  it('swallows a quota error instead of failing the render path', () => {
    const storage = {
      getItem: () => null,
      setItem: () => { throw new Error('QuotaExceededError') },
    }
    expect(() => { writeCachedAnnouncements(storage, [row()]) }).not.toThrow()
  })
})
