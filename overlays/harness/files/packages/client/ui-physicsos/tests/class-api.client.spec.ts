// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest'

import { ClassApiError, createClassApi } from '../src/client/class-api.ts'

const ok = (body: unknown, status = 200): Response =>
  new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json' },
  })

afterEach(() => {
  vi.unstubAllGlobals()
  vi.restoreAllMocks()
})

describe('class API client', () => {
  it('maps the workflow onto encoded same-origin class routes', async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(ok({ items: [] }))
      .mockResolvedValueOnce(ok({ item: { id: 'cls_1' } }, 201))
      .mockResolvedValueOnce(ok({ item: { userKey: 'GZU:s1' } }, 201))
      .mockResolvedValueOnce(ok({ item: { userKey: 'GZU:s1' } }))
      .mockResolvedValueOnce(ok({ item: { id: 'asg_1' } }, 201))
      .mockResolvedValueOnce(ok({ item: { id: 'sub_1' }, receipt: { status: 'submitted' } }, 201))
      .mockResolvedValueOnce(ok({ item: { review: { status: 'accepted' } } }))
      .mockResolvedValueOnce(ok({ totals: { submitted: 1 } }))
    vi.stubGlobal('fetch', fetchMock)
    const api = createClassApi()

    await api.listClasses({ limit: 25 })
    await api.createClass({ name: '2026 级物理 1 班' })
    await api.addMember('cls_1', 'GZU:s1')
    await api.removeMember('cls_1', 'GZU:s1')
    await api.createAssignment('cls_1', {
      title: '力学练习',
      target: { kind: 'paper', id: 'paper-1' },
      dueAt: '2026-10-01T12:00:00.000Z',
    })
    await api.submitAssignment('cls_1', 'asg_1', '作业内容')
    await api.reviewSubmission('cls_1', 'asg_1', 'GZU:s1', {
      status: 'accepted',
      score: 95,
    })
    await api.dashboard('cls_1')

    expect(fetchMock.mock.calls.map(call => String(call[0]))).toEqual([
      '/physicsos/class/classes?limit=25',
      '/physicsos/class/classes',
      '/physicsos/class/classes/cls_1/members',
      '/physicsos/class/classes/cls_1/members/GZU%3As1',
      '/physicsos/class/classes/cls_1/assignments',
      '/physicsos/class/classes/cls_1/assignments/asg_1/submission',
      '/physicsos/class/classes/cls_1/assignments/asg_1/submissions/GZU%3As1/review',
      '/physicsos/class/classes/cls_1/dashboard',
    ])
    expect(fetchMock.mock.calls[0]![1]).toMatchObject({
      headers: { 'content-type': 'application/json' },
    })
    expect(fetchMock.mock.calls[5]![1]).toMatchObject({
      method: 'PUT',
      body: JSON.stringify({ content: '作业内容' }),
    })
    expect(fetchMock.mock.calls[6]![1]).toMatchObject({
      method: 'POST',
      body: JSON.stringify({ status: 'accepted', score: 95 }),
    })
  })

  it('carries the host status and error code on a refusal', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue(
        ok(
          {
            error: { code: 'FORBIDDEN', message: '只有教师及以上角色可以创建班级' },
          },
          403,
        ),
      ),
    )

    const error = await createClassApi()
      .createClass({ name: '越权班级' })
      .catch((cause: unknown) => cause)
    expect(error).toBeInstanceOf(ClassApiError)
    expect(error).toMatchObject({
      status: 403,
      code: 'FORBIDDEN',
      message: '只有教师及以上角色可以创建班级',
    })
  })
})
