export const STORAGE_KEY = 'physicsos-website-content-v1';

export const defaultContent = {
  testimonials: [
    {
      id: 'feedback-lin', name: '小林', role: '高二学生',
      quote: '把课本里的实验亲手搭出来，原本抽象的物理规律，突然就有了画面。',
      topic: '看见物理', color: '#e3efbd',
    },
    {
      id: 'feedback-chen', name: '陈老师', role: '物理教师',
      quote: '从实验现象到引擎验证，让每一步推导都能回到可观察、可检验的物理过程。',
      topic: '验证想法', color: '#dfe7f6',
    },
    {
      id: 'feedback-yao', name: '阿遥', role: '开源爱好者',
      quote: '一个有意思的实验，也可以成为一次开源贡献。很期待和大家一起把它做得更好。',
      topic: '一起创造', color: '#f4e5c5',
    },
  ],
  contributors: [
    {
      id: 'contributor-lin', name: 'Lin', role: '示例贡献者', project: '光学实验拓展',
      description: '示例项目：探索透镜、光线与成像，让光学规律更直观。',
      url: 'https://github.com/122-syf-wcy/PhysicsOS', avatar: '', color: '#e3efbd',
    },
    {
      id: 'contributor-chen', name: 'Chen', role: '示例贡献者', project: '物理图标共创',
      description: '示例项目：为实验工具绘制清晰、亲切的物理图标。',
      url: 'https://github.com/122-syf-wcy/PhysicsOS', avatar: '', color: '#dfe7f6',
    },
    {
      id: 'contributor-yao', name: 'Yao', role: '示例贡献者', project: '实验教学笔记',
      description: '示例项目：整理实验过程与教学思路，把发现分享给更多人。',
      url: 'https://github.com/122-syf-wcy/PhysicsOS', avatar: '', color: '#f4e5c5',
    },
  ],
};

export const fieldLimits = {
  name: 40, role: 60, quote: 280, topic: 32, project: 70,
  description: 220, url: 2048, avatar: 2048,
};

const labels = {
  id: '内容标识', name: '姓名', role: '身份', quote: '反馈内容',
  topic: '主题标签', project: '项目名称', description: '项目介绍',
  url: '项目链接', avatar: '头像链接', color: '卡片颜色',
};

function stringField(item, field, maxLength, optional = false) {
  if (typeof item[field] !== 'string') throw new Error(`${labels[field]}需要填写文字。`);
  const value = item[field].trim();
  if (!optional && !value) throw new Error(`请填写${labels[field]}。`);
  if (value.length > maxLength) throw new Error(`${labels[field]}请控制在 ${maxLength} 个字符以内。`);
  return value;
}

function urlField(item, field, optional = false) {
  const value = stringField(item, field, fieldLimits[field], optional);
  if (optional && value === '') return '';
  let url;
  try { url = new URL(value); } catch { throw new Error(`${labels[field]}需要完整的 http:// 或 https:// 地址。`); }
  if (!['http:', 'https:'].includes(url.protocol) || !url.hostname || url.username || url.password) {
    throw new Error(`${labels[field]}仅支持不含登录信息的 http:// 或 https:// 地址。`);
  }
  return value;
}

export function validateContent(content) {
  if (!content || typeof content !== 'object' || Array.isArray(content)) {
    throw new Error('内容格式无效，请恢复示例内容后重试。');
  }
  const output = {};
  for (const section of ['testimonials', 'contributors']) {
    const items = content[section];
    const sectionName = section === 'testimonials' ? '示例反馈' : '贡献者项目';
    if (!Array.isArray(items) || items.length < 1 || items.length > 12) {
      throw new Error(`${sectionName}需要保留 1–12 张卡片。`);
    }
    const ids = new Set();
    output[section] = items.map((item, index) => {
      try {
        if (!item || typeof item !== 'object' || Array.isArray(item)) throw new Error('卡片格式无效。');
        const id = stringField(item, 'id', 80);
        if (!/^[a-zA-Z0-9_-]+$/.test(id) || ids.has(id)) throw new Error('卡片标识无效或重复。');
        ids.add(id);
        const color = stringField(item, 'color', 7);
        if (!/^#[0-9a-f]{6}$/i.test(color)) throw new Error('请选择有效的卡片颜色。');
        const base = { id, name: stringField(item, 'name', fieldLimits.name), role: stringField(item, 'role', fieldLimits.role) };
        return section === 'testimonials'
          ? { ...base, quote: stringField(item, 'quote', fieldLimits.quote), topic: stringField(item, 'topic', fieldLimits.topic), color }
          : { ...base, project: stringField(item, 'project', fieldLimits.project), description: stringField(item, 'description', fieldLimits.description), url: urlField(item, 'url'), avatar: urlField(item, 'avatar', true), color };
      } catch (error) {
        throw new Error(`${sectionName} · 第 ${index + 1} 张：${error.message}`);
      }
    });
  }
  return output;
}

export function loadContent() {
  try {
    const stored = globalThis.localStorage?.getItem(STORAGE_KEY);
    if (stored) return validateContent(JSON.parse(stored));
  } catch { /* Missing, blocked, or malformed storage uses the preview's safe defaults. */ }
  return JSON.parse(JSON.stringify(defaultContent));
}

export function saveContent(content) {
  const validated = validateContent(content);
  try { globalThis.localStorage.setItem(STORAGE_KEY, JSON.stringify(validated)); }
  catch { throw new Error('浏览器暂时无法保存本地内容，请检查浏览器的存储权限后重试。'); }
  return validated;
}
