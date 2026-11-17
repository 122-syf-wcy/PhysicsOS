import { describe, expect, it, vi } from 'vitest'
import { createCoursewarePortSession, readCoursewarePlayerState, validCoursewareReady } from '../src/client/courseware/protocol.ts'
import { cwPresentation, cwRecord } from './courseware-fixture.client.ts'
const presentation = cwRecord.versions[0]!
describe('courseware one-port nonce protocol', () => {
  it('refuses wrong origin/source/nonce even when all payload words match', () => {
    const source = {} as Window; const data = { type: 'courseware/ready', protocol: 1, nonce: 'n'.repeat(32) }
    expect(validCoursewareReady({ source, origin: 'https://physics.test', data }, source, 'https://physics.test', data.nonce)).toBe(true)
    expect(validCoursewareReady({ source: {} as Window, origin: 'https://physics.test', data }, source, 'https://physics.test', data.nonce)).toBe(false)
    expect(validCoursewareReady({ source, origin: 'null', data }, source, 'https://physics.test', data.nonce)).toBe(false)
    expect(validCoursewareReady({ source, origin: 'https://physics.test', data: { ...data, nonce: 'wrong' } }, source, 'https://physics.test', data.nonce)).toBe(false)
  })
  it('requires stable imported IDs, exact page indices and actual measured 1920x1080 stage', () => {
    const state = { ...cwPresentation(), type: 'courseware/state', protocol: 1, seq: 1 }
    expect(readCoursewarePlayerState(state, presentation)).toEqual(cwPresentation())
    expect(() => readCoursewarePlayerState({ ...state, slideId: 'guessed' }, presentation)).toThrow()
    expect(() => readCoursewarePlayerState({ ...state, total: 31 }, presentation)).toThrow()
    expect(() => readCoursewarePlayerState({ ...state, stage: { ...state.stage, scale: 2 } }, presentation)).toThrow()
  })
  it('requires ack by requestId, handles negatives, and bounds pending commands', async () => {
    const sent: Record<string, unknown>[] = []; const close = vi.fn()
    const session = createCoursewarePortSession({ presentation, post: value => sent.push(value as Record<string, unknown>), onState: () => {}, onError: () => {}, onFullscreen: () => {}, onClose: close })
    const command = session.command('goto', 'pitch'); expect(sent[0]).toMatchObject({ type: 'courseware/command', protocol: 1, seq: 1, slideId: 'pitch' })
    session.receive({ type: 'courseware/ack', protocol: 1, seq: 1, requestId: sent[0]!.requestId, ok: true }); await expect(command).resolves.toBeUndefined()
    const bad = session.command('notes'); session.receive({ type: 'courseware/ack', protocol: 1, seq: 2, requestId: sent[1]!.requestId, ok: false, error: 'UNSUPPORTED' }); await expect(bad).rejects.toThrow('UNSUPPORTED')
    await expect(session.command('goto', 'not_imported')).rejects.toThrow(); session.close(); expect(close).toHaveBeenCalledTimes(1)
  })
  it('does not release old page state while a command waits for its ack and closes on a missing ack', async () => {
    vi.useFakeTimers()
    try {
      const sent: Record<string, unknown>[] = []; const state = vi.fn(); const close = vi.fn(); const error = vi.fn()
      const session = createCoursewarePortSession({ presentation, post: packet => sent.push(packet as Record<string, unknown>), onState: state, onError: error, onFullscreen: () => {}, onClose: close, timeoutMs: 50 })
      const command = session.command('next')
      session.receive({ ...cwPresentation(), type: 'courseware/state', protocol: 1, seq: 1 }); expect(state).not.toHaveBeenCalled()
      session.receive({ type: 'courseware/ack', protocol: 1, seq: 2, requestId: sent[0]!.requestId, ok: true }); await command
      session.receive({ ...cwPresentation('pitch'), type: 'courseware/state', protocol: 1, seq: 3 }); expect(state).toHaveBeenCalledWith(cwPresentation('pitch'))
      const timeout = session.command('prev'); const rejected = expect(timeout).rejects.toThrow('批注已暂停'); await vi.advanceTimersByTimeAsync(51); await rejected
      expect(close).toHaveBeenCalledOnce(); expect(error).toHaveBeenCalledOnce()
    } finally { vi.useRealTimers() }
  })
  it('closes on duplicate/out-of-order seq, >16KiB packets and rolling rate bursts', () => {
    let time = 0
    const setup = () => { const close = vi.fn(); const error = vi.fn(); const session = createCoursewarePortSession({ presentation, post: () => {}, onState: () => {}, onError: error, onFullscreen: () => {}, onClose: close, now: () => time }); return { session, close, error } }
    const packet = { ...cwPresentation(), type: 'courseware/state', protocol: 1, seq: 1 }
    const duplicate = setup(); duplicate.session.receive(packet); duplicate.session.receive(packet); expect(duplicate.close).toHaveBeenCalledOnce()
    const size = setup(); size.session.receive({ ...packet, padding: 'x'.repeat(16385) }); expect(size.close).toHaveBeenCalledOnce()
    const rate = setup(); for (let seq = 1; seq <= 90; seq++) rate.session.receive({ ...packet, seq }); time = 999; rate.session.receive({ ...packet, seq: 91 }); expect(rate.close).toHaveBeenCalledOnce()
    const rolling = setup(); time = 1000; for (let seq = 1; seq <= 89; seq++) rolling.session.receive({ ...packet, seq }); time = 1001; rolling.session.receive({ ...packet, seq: 90 }); time = 1999; rolling.session.receive({ ...packet, seq: 91 }); expect(rolling.close).toHaveBeenCalledOnce()
  })
})
