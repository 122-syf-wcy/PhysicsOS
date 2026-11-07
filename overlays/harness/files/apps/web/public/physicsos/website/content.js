const API = '/physicsos/notice/public';
const allowedImages = new Set(['image/png', 'image/jpeg', 'image/webp', 'image/gif']);
const kinds = new Set(['bug', 'content', 'idea', 'other']);

function textField(item, field, limit, optional = false) {
  const value = item[field];
  if (typeof value !== 'string') throw new Error('公开内容格式暂时无法读取。');
  const text = value.trim();
  if ((!optional && !text) || text.length > limit) throw new Error('公开内容格式暂时无法读取。');
  return text;
}

function safeUrl(item, field) {
  const value = textField(item, field, 2048, true);
  if (!value) return '';
  let url;
  try { url = new URL(value); } catch { throw new Error('公开内容中的链接格式无效。'); }
  if (!['https:', 'http:'].includes(url.protocol) || !url.hostname || url.username || url.password) {
    throw new Error('公开内容中的链接格式无效。');
  }
  return url.href;
}

// Only a bounded, public projection can reach the text-node renderer.
export function normalizeContent(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('公开内容格式暂时无法读取。');
  const output = {};
  for (const section of ['testimonials', 'contributors']) {
    const entries = value[section];
    if (!Array.isArray(entries) || entries.length > 12) throw new Error('公开内容格式暂时无法读取。');
    const ids = new Set();
    output[section] = entries.filter(item => item?.enabled !== false).map(item => {
      if (!item || typeof item !== 'object' || Array.isArray(item)) throw new Error('公开内容格式暂时无法读取。');
      const id = textField(item, 'id', 80);
      if (!/^[a-zA-Z0-9_-]+$/.test(id) || ids.has(id)) throw new Error('公开内容标识无效。');
      ids.add(id);
      const color = textField(item, 'color', 7);
      if (!/^#[0-9a-f]{6}$/i.test(color)) throw new Error('公开内容颜色无效。');
      if (!Number.isInteger(item.order) || item.order < 0) throw new Error('公开内容排序无效。');
      const base = { id, name: textField(item, 'name', 40), role: textField(item, 'role', 60, true), color, order: item.order };
      return section === 'testimonials'
        ? { ...base, quote: textField(item, 'quote', 280), topic: textField(item, 'topic', 32, true) }
        : { ...base, project: textField(item, 'project', 70), description: textField(item, 'description', 220, true), url: safeUrl(item, 'url'), avatar: safeUrl(item, 'avatar') };
    }).sort((a, b) => a.order - b.order);
  }
  return output;
}

async function requestJson(path, options, fetchImpl, timeout) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeout);
  try {
    const response = await fetchImpl(`${API}/${path}`, {
      ...options, credentials: 'same-origin', mode: 'same-origin', cache: 'no-store', signal: controller.signal,
    });
    let body;
    try { body = await response.json(); } catch { throw new Error('暂时无法确认服务器响应，请稍后重试。'); }
    if (!response.ok) {
      if (response.status === 429) throw new Error('提交较频繁，请稍后再试。');
      if (response.status === 413) throw new Error('截图大小超出限制，请减少图片后重试。');
      if (response.status === 400 || response.status === 422) throw new Error('内容或图片未通过校验，请检查后重试。');
      throw new Error('服务暂时不可用，请稍后重试。');
    }
    return body;
  } catch (error) {
    if (error?.name === 'AbortError') throw new Error('暂未收到服务器确认，请稍后重试。');
    if (error instanceof TypeError) throw new Error('连接暂时中断，请检查网络后重试。');
    throw error;
  } finally { clearTimeout(timer); }
}

export async function loadContent(fetchImpl = globalThis.fetch) {
  return normalizeContent(await requestJson('website', { headers: { Accept: 'application/json' } }, fetchImpl, 15000));
}

function feedbackText(value, label, maximum, minimum = 0) {
  if (typeof value !== 'string') throw new Error(`请填写${label}。`);
  const text = value.trim();
  if (text.length < minimum || text.length > maximum) throw new Error(`${label}需要 ${minimum || 0}–${maximum} 个字符。`);
  return text;
}

export async function prepareFeedback({ kind, body, contact = '', context = '', images = [] }) {
  if (!kinds.has(kind)) throw new Error('请选择反馈分类。');
  const payload = { kind, body: feedbackText(body, '反馈内容', 2000, 5) };
  const contactText = feedbackText(contact, '联系方式', 100);
  const contextText = feedbackText(context, '反馈来源', 400);
  if (contactText) payload.contact = contactText;
  if (contextText) payload.context = contextText;
  if (!Array.isArray(images) || images.length > 3) throw new Error('最多添加 3 张图片。');
  payload.images = [];
  for (const file of images) {
    if (!file || !allowedImages.has(file.type)) throw new Error('请使用 PNG、JPG、WebP 或 GIF 图片。');
    if (!Number.isFinite(file.size) || file.size < 1 || file.size > 5 * 1024 * 1024) throw new Error('每张图片需要大于 0 且不超过 5 MB。');
    const bytes = new Uint8Array(await file.arrayBuffer());
    let binary = '';
    for (let start = 0; start < bytes.length; start += 0x8000) binary += String.fromCharCode(...bytes.subarray(start, start + 0x8000));
    const image = { data: btoa(binary), mediaType: file.type };
    if (typeof file.name === 'string' && file.name.trim()) image.name = file.name.trim().slice(0, 200);
    payload.images.push(image);
  }
  return payload;
}

export async function sendFeedback(payload, fetchImpl = globalThis.fetch) {
  const receipt = await requestJson('website-feedback', {
    method: 'POST', headers: { Accept: 'application/json', 'Content-Type': 'application/json' }, body: JSON.stringify(payload),
  }, fetchImpl, 90000);
  if (!receipt || typeof receipt.id !== 'string' || !receipt.id.trim() || typeof receipt.createdAt !== 'string' || !Number.isFinite(Date.parse(receipt.createdAt))) {
    throw new Error('暂时无法确认反馈已送达，请稍后重试。');
  }
  return { id: receipt.id, createdAt: receipt.createdAt };
}
