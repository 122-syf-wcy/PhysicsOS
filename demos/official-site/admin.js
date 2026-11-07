import { defaultContent, fieldLimits, loadContent, saveContent, validateContent } from './content.js';

const colors = ['#e3efbd', '#dfe7f6', '#f4e5c5', '#f0ded9', '#dceee4'];
const form = document.querySelector('#content-form');
const editors = document.querySelector('#editors');
const preview = document.querySelector('#card-preview');
const errorBox = document.querySelector('#form-error');
let content = loadContent();
let activeSection = 'testimonials';
let dirty = false;
let toastTimer;

const escapeHtml = (value) => String(value).replace(/[&<>"']/g, (character) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[character]));
const initials = (name) => Array.from(name.trim()).slice(0, 1).join('').toUpperCase() || 'P';

function showToast(message) {
  clearTimeout(toastTimer);
  document.querySelector('#toast-message').textContent = message;
  document.querySelector('#toast').hidden = false;
  toastTimer = setTimeout(() => { document.querySelector('#toast').hidden = true; }, 3600);
}

function updateDirty(isDirty) {
  dirty = isDirty;
  document.querySelector('#save-dot').classList.toggle('is-dirty', isDirty);
  document.querySelector('#save-label').textContent = isDirty ? '有尚未保存的修改' : '所有内容已保存';
  document.querySelector('#save-hint').textContent = isDirty ? '保存后，首页将展示你的最新内容' : '内容仅保存在当前浏览器';
  errorBox.hidden = true;
}

function fieldMarkup(item, field, label, options = {}) {
  const { wide = false, textarea = false, optional = false, placeholder = '', help = '' } = options;
  const id = `${item.id}-${field}`;
  const value = item[field];
  const inputAttributes = `id="${id}" data-field="${field}" maxlength="${fieldLimits[field]}" ${optional ? '' : 'required'} placeholder="${escapeHtml(placeholder)}"${help ? ` aria-describedby="${id}-help"` : ''}`;
  const counter = textarea ? `<span class="field-counter" data-counter="${field}">${value.length} / ${fieldLimits[field]}</span>` : optional ? '<span class="field-optional">选填</span>' : '';
  return `<div class="field${wide ? ' field-wide' : ''}"><div class="field-heading"><label for="${id}">${label}</label>${counter}</div>${textarea ? `<textarea ${inputAttributes} rows="3">${escapeHtml(value)}</textarea>` : `<input ${inputAttributes} type="${field === 'url' || field === 'avatar' ? 'url' : 'text'}" value="${escapeHtml(value)}"${field === 'url' || field === 'avatar' ? ' inputmode="url" spellcheck="false"' : ''}>`}${help ? `<p class="field-help" id="${id}-help">${help}</p>` : ''}<p class="field-error" data-error-for="${field}" hidden></p></div>`;
}

function colorMarkup(item) {
  const itemColors = colors.includes(item.color) ? colors : [...colors, item.color];
  return `<fieldset class="color-field"><legend>卡片配色</legend>${itemColors.map((color, index) => `<label class="swatch" style="--swatch:${color}"><input type="radio" name="${item.id}-color" data-field="color" value="${color}"${item.color === color ? ' checked' : ''} aria-label="${['嫩叶绿', '雾蓝', '麦芽黄', '浅玫瑰', '薄荷绿', '自定义颜色'][index]}"><span></span></label>`).join('')}</fieldset>`;
}

function renderEditors(openId) {
  const feedback = activeSection === 'testimonials';
  const items = content[activeSection];
  document.querySelector('#section-title').textContent = feedback ? '反馈卡片' : '贡献者与项目卡片';
  document.querySelector('#section-description').textContent = feedback ? '一段真实的感受，让物理探索更有温度。' : '介绍共同创造的人，也分享他们正在做的事。';
  document.querySelector('#example-note').textContent = feedback ? '当前文字为设计占位示例，不代表真实用户评价。对外使用时，请替换为已获授权的真实反馈。' : '当前人物与项目为设计占位示例。头像可留空；项目链接支持完整的 http:// 或 https:// 地址。';
  document.querySelector('#editor-panel').setAttribute('aria-labelledby', `${activeSection}-tab`);
  editors.innerHTML = items.map((item, index) => `<details class="editor-card" data-id="${item.id}" style="--card-color:${item.color}"${(openId ? openId === item.id : index === 0) ? ' open' : ''}>
    <summary><span class="card-number">${String(index + 1).padStart(2, '0')}</span><span class="summary-text"><span class="summary-title">${escapeHtml(feedback ? item.name : item.project) || (feedback ? '新的反馈' : '新的项目')}</span><span class="summary-subtitle">${escapeHtml(feedback ? item.role : `${item.name} · ${item.role}`)}</span></span><span class="summary-chevron" aria-hidden="true">⌄</span></summary>
    <div class="editor-content"><div class="fields-grid">
      ${fieldMarkup(item, 'name', feedback ? '反馈者姓名' : '贡献者姓名', { placeholder: feedback ? '例如：小林' : '例如：Lin' })}
      ${fieldMarkup(item, 'role', '身份 / 角色', { placeholder: feedback ? '例如：高二学生' : '例如：示例贡献者' })}
      ${feedback
        ? `${fieldMarkup(item, 'quote', '反馈内容', { wide: true, textarea: true, placeholder: '分享一段使用感受…' })}${fieldMarkup(item, 'topic', '主题标签', { placeholder: '例如：看见物理' })}<div>${colorMarkup(item)}</div>`
        : `${fieldMarkup(item, 'project', '项目名称', { wide: true, placeholder: '给这个项目起一个名字' })}${fieldMarkup(item, 'description', '项目介绍', { wide: true, textarea: true, placeholder: '介绍项目在探索什么…' })}${fieldMarkup(item, 'url', '项目链接', { wide: true, placeholder: 'https://github.com/…' })}${fieldMarkup(item, 'avatar', '头像链接', { wide: true, optional: true, placeholder: 'https://example.com/avatar.png', help: '留空时会用姓名首字母代替头像。支持 http:// 和 https://。' })}<div class="field-wide">${colorMarkup(item)}</div>`}
    </div><div class="card-tools"><div class="move-controls"><button type="button" class="move-button" data-action="up" aria-label="向上移动第 ${index + 1} 张卡片" title="向上移动"${index === 0 ? ' disabled' : ''}>↑</button><button type="button" class="move-button" data-action="down" aria-label="向下移动第 ${index + 1} 张卡片" title="向下移动"${index === items.length - 1 ? ' disabled' : ''}>↓</button></div><button class="delete-card" type="button" data-action="remove"${items.length <= 1 ? ' disabled title="每个板块至少保留一张卡片"' : ''}>移除这张卡片</button></div></div>
  </details>`).join('');
  updateCounts();
  renderPreview();
}

function updateCounts() {
  for (const section of ['testimonials', 'contributors']) document.querySelector(`#${section}-count`).textContent = content[section].length;
  const remaining = 12 - content[activeSection].length;
  document.querySelector('#add-card').disabled = remaining === 0;
  document.querySelector('#add-label').textContent = activeSection === 'testimonials' ? '添加一条反馈' : '添加一个贡献者项目';
  document.querySelector('#remaining-count').textContent = remaining ? `还可添加 ${remaining} 条` : '已达到 12 张上限';
}

function safeAvatar(url) {
  try { const parsed = new URL(url); return ['http:', 'https:'].includes(parsed.protocol) && !parsed.username && !parsed.password ? parsed.href : ''; } catch { return ''; }
}

function renderPreview() {
  const item = content[activeSection][0];
  const avatarUrl = activeSection === 'contributors' ? safeAvatar(item.avatar) : '';
  const avatar = `<span class="person-avatar" style="--avatar-color:${item.color}">${avatarUrl ? `<img src="${escapeHtml(avatarUrl)}" alt="" referrerpolicy="no-referrer" loading="lazy">` : escapeHtml(initials(item.name))}</span>`;
  const person = `<div class="preview-person">${avatar}<span class="person-details"><span class="person-name">${escapeHtml(item.name) || '姓名'}</span><span class="person-role">${escapeHtml(item.role) || '身份 / 角色'}</span></span></div>`;
  preview.classList.toggle('project-preview', activeSection === 'contributors');
  preview.innerHTML = activeSection === 'testimonials'
    ? `<span class="preview-topic">${escapeHtml(item.topic) || '主题标签'}</span><div class="quote-mark" aria-hidden="true">“</div><p class="preview-quote">${escapeHtml(item.quote) || '在这里写下你想分享的使用感受。'}</p>${person}`
    : `${person}<h3 class="project-title">${escapeHtml(item.project) || '项目名称'}</h3><p class="project-description">${escapeHtml(item.description) || '在这里介绍你的项目，让更多人了解你的探索。'}</p><div class="project-link"><span>探索项目</span><span aria-hidden="true">↗</span></div>`;
  preview.querySelector('img')?.addEventListener('error', (event) => { event.target.parentElement.textContent = initials(item.name); }, { once: true });
}

function selectSection(section) {
  activeSection = section;
  document.querySelectorAll('.tab').forEach((tab) => {
    const active = tab.dataset.section === section;
    tab.classList.toggle('is-active', active);
    tab.setAttribute('aria-selected', String(active));
    tab.tabIndex = active ? 0 : -1;
  });
  renderEditors();
}

document.querySelectorAll('.tab').forEach((tab) => {
  tab.addEventListener('click', () => selectSection(tab.dataset.section));
  tab.addEventListener('keydown', (event) => {
    if (!['ArrowLeft', 'ArrowRight', 'Home', 'End'].includes(event.key)) return;
    event.preventDefault();
    const section = event.key === 'Home' ? 'testimonials' : event.key === 'End' ? 'contributors' : activeSection === 'testimonials' ? 'contributors' : 'testimonials';
    selectSection(section);
    document.querySelector(`#${section}-tab`).focus();
  });
});

editors.addEventListener('input', (event) => {
  const field = event.target.dataset.field;
  if (!field) return;
  const card = event.target.closest('.editor-card');
  const item = content[activeSection].find((entry) => entry.id === card.dataset.id);
  item[field] = event.target.value;
  event.target.removeAttribute('aria-invalid');
  const fieldError = card.querySelector(`[data-error-for="${field}"]`);
  if (fieldError) fieldError.hidden = true;
  const counter = card.querySelector(`[data-counter="${field}"]`);
  if (counter) counter.textContent = `${event.target.value.length} / ${fieldLimits[field]}`;
  card.querySelector('.summary-title').textContent = (activeSection === 'testimonials' ? item.name : item.project) || '尚未命名';
  card.querySelector('.summary-subtitle').textContent = activeSection === 'testimonials' ? item.role : `${item.name} · ${item.role}`;
  if (field === 'color') card.style.setProperty('--card-color', item.color);
  updateDirty(true);
  renderPreview();
});

editors.addEventListener('click', (event) => {
  const button = event.target.closest('button[data-action]');
  if (!button) return;
  const id = button.closest('.editor-card').dataset.id;
  const items = content[activeSection];
  const index = items.findIndex((item) => item.id === id);
  if (button.dataset.action === 'remove') {
    if (items.length <= 1) return;
    if (!window.confirm(`移除「${items[index].name || '未命名'}」这张卡片？保存后才会更新首页。`)) return;
    items.splice(index, 1);
    renderEditors(items[Math.min(index, items.length - 1)].id);
  } else {
    const destination = index + (button.dataset.action === 'up' ? -1 : 1);
    if (destination < 0 || destination >= items.length) return;
    [items[index], items[destination]] = [items[destination], items[index]];
    renderEditors(id);
  }
  updateDirty(true);
  editors.querySelector('details[open] summary')?.focus();
});

document.querySelector('#add-card').addEventListener('click', () => {
  const items = content[activeSection];
  if (items.length >= 12) return;
  const id = `card-${globalThis.crypto?.randomUUID?.() || `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`}`;
  const base = { id, name: '', role: activeSection === 'testimonials' ? '' : '示例贡献者', color: colors[items.length % colors.length] };
  items.push(activeSection === 'testimonials' ? { ...base, quote: '', topic: '' } : { ...base, project: '', description: '', url: '', avatar: '' });
  renderEditors(id);
  updateDirty(true);
  const input = editors.querySelector(`details[data-id="${id}"] input`);
  input.focus();
  input.scrollIntoView({ behavior: 'smooth', block: 'center' });
});

function validateAllFields() {
  for (const section of ['testimonials', 'contributors']) {
    for (const item of content[section]) {
      const fields = section === 'testimonials' ? ['name', 'role', 'quote', 'topic'] : ['name', 'role', 'project', 'description', 'url', 'avatar'];
      for (const field of fields) {
        const value = item[field].trim();
        let error = !value && field !== 'avatar' ? '请填写此项。' : '';
        if (value.length > fieldLimits[field]) error = `请控制在 ${fieldLimits[field]} 个字符以内。`;
        if ((field === 'url' || field === 'avatar') && value && !safeAvatar(value)) error = '请输入不含登录信息的完整 http:// 或 https:// 地址。';
        if (!error) continue;
        selectSection(section);
        const card = editors.querySelector(`details[data-id="${item.id}"]`);
        card.open = true;
        const input = card.querySelector(`[data-field="${field}"]`);
        input.setAttribute('aria-invalid', 'true');
        const fieldError = card.querySelector(`[data-error-for="${field}"]`);
        fieldError.textContent = error;
        fieldError.hidden = false;
        input.setAttribute('aria-describedby', `${item.id}-${field}-error`);
        fieldError.id = `${item.id}-${field}-error`;
        input.focus();
        input.scrollIntoView({ behavior: 'smooth', block: 'center' });
        throw new Error('还有一项内容需要完善，请查看标出的字段。');
      }
    }
  }
  return validateContent(content);
}

form.addEventListener('submit', (event) => {
  event.preventDefault();
  try {
    content = saveContent(validateAllFields());
    updateDirty(false);
    if (event.submitter?.value === 'return') {
      window.location.href = './index.html';
      return;
    }
    showToast('已保存。回到首页即可查看最新内容。');
  } catch (error) {
    errorBox.textContent = error.message;
    errorBox.hidden = false;
  }
});

document.querySelector('#reset-content').addEventListener('click', () => {
  if (!window.confirm('恢复全部示例反馈和贡献者项目？这会覆盖当前浏览器已保存的配置。')) return;
  try {
    content = saveContent(JSON.parse(JSON.stringify(defaultContent)));
    updateDirty(false);
    renderEditors();
    showToast('已恢复示例内容。');
  } catch (error) {
    errorBox.textContent = error.message;
    errorBox.hidden = false;
  }
});

window.addEventListener('beforeunload', (event) => {
  if (!dirty) return;
  event.preventDefault();
  event.returnValue = '';
});

renderEditors();
