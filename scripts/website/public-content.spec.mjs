import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

const source = await readFile(new URL('../../overlays/harness/files/apps/web/public/physicsos/website/content.js', import.meta.url), 'utf8');
const { normalizeContent, loadContent, prepareFeedback, sendFeedback } = await import(`data:text/javascript;base64,${Buffer.from(source).toString('base64')}`);
const testimonial = (id, extra = {}) => ({ id, name: '真实用户', role: '学生', quote: '让物理规律变得更容易理解。', topic: '实验体验', color: '#e3efbd', order: 0, enabled: true, ...extra });
const contributor = (id, extra = {}) => ({ id, name: '共建者', role: '贡献者', project: '实验笔记', description: '公开分享实验发现。', url: 'https://example.com/project', avatar: '', color: '#dfe7f6', order: 0, enabled: true, ...extra });
const response = (body, status = 200) => new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });

test('empty published configuration renders no fabricated cards', () => {
  assert.deepEqual(normalizeContent({ testimonials: [], contributors: [] }), { testimonials: [], contributors: [] });
});

test('public normalization hides disabled entries, sorts, and removes private fields', () => {
  const result = normalizeContent({
    testimonials: [testimonial('late', { order: 2, sourceFeedbackId: 'private-id', contact: 'private@example.com' }), testimonial('hidden', { enabled: false }), testimonial('first', { order: 1 })],
    contributors: [contributor('one')],
  });
  assert.deepEqual(result.testimonials.map(item => item.id), ['first', 'late']);
  assert.equal('sourceFeedbackId' in result.testimonials[1], false);
  assert.equal('contact' in result.testimonials[1], false);
});

test('zero, one, two and twelve public cards are supported', () => {
  for (const count of [0, 1, 2, 12]) {
    const result = normalizeContent({ testimonials: Array.from({ length: count }, (_, i) => testimonial(`t-${i}`)), contributors: Array.from({ length: count }, (_, i) => contributor(`c-${i}`)) });
    assert.equal(result.testimonials.length, count);
    assert.equal(result.contributors.length, count);
  }
});

test('optional display fields and a project without a link remain publishable', () => {
  const result = normalizeContent({ testimonials: [testimonial('one', { role: '', topic: '' })], contributors: [contributor('one', { role: '', description: '', url: '', avatar: '' })] });
  assert.equal(result.testimonials[0].role, '');
  assert.equal(result.testimonials[0].topic, '');
  assert.equal(result.contributors[0].url, '');
  assert.equal(result.contributors[0].description, '');
});

test('public content accepts the server ID boundary of 100 characters and rejects 101', () => {
  const valid = 'a'.repeat(100);
  const result = normalizeContent({ testimonials: [testimonial(valid)], contributors: [contributor(valid)] });
  assert.equal(result.testimonials[0].id, valid);
  assert.equal(result.contributors[0].id, valid);
  assert.throws(() => normalizeContent({ testimonials: [testimonial('a'.repeat(101))], contributors: [] }));
  assert.throws(() => normalizeContent({ testimonials: [], contributors: [contributor('a'.repeat(101))] }));
});

test('malformed or unsafe public content is rejected instead of becoming an executable link', () => {
  for (const url of ['javascript:alert(1)', 'data:text/html,hello', 'https://user:pass@example.com/', '/relative']) {
    assert.throws(() => normalizeContent({ testimonials: [], contributors: [contributor('one', { url })] }));
  }
  assert.throws(() => normalizeContent({ testimonials: [], contributors: [contributor('one', { avatar: 'javascript:alert(1)' })] }));
  assert.throws(() => normalizeContent({ testimonials: [testimonial('x'), testimonial('x')], contributors: [] }));
  assert.throws(() => normalizeContent({ testimonials: [testimonial('x', { color: 'url(evil)' })], contributors: [] }));
  assert.throws(() => normalizeContent({ testimonials: null, contributors: [] }));
});

test('public reads use the same-origin endpoint and do not reuse cached content', async () => {
  let request;
  const result = await loadContent(async (url, options) => { request = { url, options }; return response({ testimonials: [], contributors: [] }); });
  assert.equal(request.url, '/physicsos/notice/public/website');
  assert.equal(request.options.cache, 'no-store');
  assert.equal(request.options.credentials, 'same-origin');
  assert.deepEqual(result, { testimonials: [], contributors: [] });
  await assert.rejects(loadContent(async () => response({ error: { code: 'unavailable', message: '暂不可用' } }, 503)));
});

test('feedback includes the actual image bytes as pure base64', async () => {
  const image = new Blob([new Uint8Array([137, 80, 78, 71, 13, 10, 26, 10])], { type: 'image/png' });
  Object.defineProperty(image, 'name', { value: '截图.png' });
  const payload = await prepareFeedback({ kind: 'bug', body: '  这里的波形显示有问题。  ', contact: ' user@example.com ', context: '/', images: [image] });
  assert.deepEqual(payload, { kind: 'bug', body: '这里的波形显示有问题。', contact: 'user@example.com', context: '/', images: [{ data: 'iVBORw0KGgo=', mediaType: 'image/png', name: '截图.png' }] });
});

test('invalid feedback and oversized or unsupported images never become request payloads', async () => {
  const normal = { kind: 'idea', body: '希望增加更多实验。', images: [] };
  const png = new Blob(['png'], { type: 'image/png' });
  for (const overrides of [{ body: '短' }, { body: '字'.repeat(2001) }, { kind: 'unknown' }, { contact: 'a'.repeat(101) }, { context: 'a'.repeat(401) }, { images: [png, png, png, png] }, { images: [new Blob(['<svg/>'], { type: 'image/svg+xml' })] }, { images: [new Blob([new Uint8Array(5 * 1024 * 1024 + 1)], { type: 'image/png' })] }]) {
    await assert.rejects(prepareFeedback({ ...normal, ...overrides }));
  }
});

test('only a confirmed server receipt is treated as a submitted feedback', async () => {
  const payload = { kind: 'content', body: '这段说明可以再补充。', images: [] };
  let request;
  const result = await sendFeedback(payload, async (url, options) => { request = { url, options }; return response({ id: 'feedback-123', createdAt: '2026-11-08T00:00:00.000Z' }, 201); });
  assert.deepEqual(result, { id: 'feedback-123', createdAt: '2026-11-08T00:00:00.000Z' });
  assert.equal(request.url, '/physicsos/notice/public/website-feedback');
  assert.equal(request.options.method, 'POST');
  assert.equal(request.options.credentials, 'same-origin');
  assert.deepEqual(JSON.parse(request.options.body), payload);
  for (const reply of [response({}), response({ id: 'x' }), response({ error: { code: 'rate_limited', message: '请稍后再试' } }, 429)]) {
    await assert.rejects(sendFeedback(payload, async () => reply));
  }
  await assert.rejects(sendFeedback(payload, async () => { throw new TypeError('offline'); }));
});
