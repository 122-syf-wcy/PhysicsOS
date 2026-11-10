#!/usr/bin/env node
// Public, read-only capture. Run from the repository root with the existing proxy:
// node promo-video/xiaoyunque-90s-v1/tools/capture-website.mjs
// Existing target files are never overwritten. No server/tunnel/install commands.
import { chromium } from '@playwright/test';
import { access, mkdir, open, writeFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const URL = 'https://physicsos.dongsiwei.com/';
const PROXY = 'socks5://127.0.0.1:18963';
const VIEWPORT = { width: 1920, height: 1080 };
const DPR = 2;
const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const OUT = resolve(ROOT, '01-real-ui');
const NAMES = [
  'W01-official-hero.png',
  'W02-official-exploration.png',
  'W03-official-ai-workflow.png',
  'W04-official-closing.png',
  'W00-official-fullpage.png',
  'website-capture.json',
  'website-findings.md',
];

async function ensureNewOutputs() {
  for (const name of NAMES) {
    try {
      await access(resolve(OUT, name));
    } catch (error) {
      if (error.code === 'ENOENT') continue;
      throw error;
    }
    throw new Error(`Refusing to overwrite existing output: ${resolve(OUT, name)}`);
  }
  await mkdir(OUT, { recursive: true });
}

const startedAt = new Date().toISOString();
const metadata = {
  requestedUrl: URL,
  startedAt,
  viewportCssPixels: VIEWPORT,
  deviceScaleFactor: DPR,
  colorScheme: 'light',
  locale: 'zh-CN',
  serviceWorkers: 'block',
  proxy: PROXY,
  networkPolicy: {
    allowedMethods: ['GET', 'HEAD', 'OPTIONS'],
    blockedMethods: {},
    blockedWebSockets: 0,
    noFormSubmission: true,
    noControlClicks: true,
  },
  authenticity: {
    source: 'Live public website rendered by Chromium',
    domOrStyleOverrides: false,
    masks: false,
    imageGeneration: false,
    compositing: false,
    rescaling: false,
    screenshotAnimations: 'allow; transient reveals settled; native continuous motion retained',
  },
  shots: [],
  gaps: [],
};

let browser;
try {
  await ensureNewOutputs();
  const executable = chromium.executablePath();
  if (!executable.includes('chromium-1234')) {
    throw new Error('This capture requires the already-installed Chromium revision 1234.');
  }
  await access(executable);
  metadata.chromium = { revision: 1234, executable };
  browser = await chromium.launch({ headless: true, proxy: { server: PROXY } });
  metadata.chromium.version = browser.version();
  const context = await browser.newContext({
    viewport: VIEWPORT,
    deviceScaleFactor: DPR,
    colorScheme: 'light',
    locale: 'zh-CN',
    serviceWorkers: 'block',
  });
  await context.route('**/*', async route => {
    const method = route.request().method();
    if (!metadata.networkPolicy.allowedMethods.includes(method)) {
      metadata.networkPolicy.blockedMethods[method] =
        (metadata.networkPolicy.blockedMethods[method] || 0) + 1;
      await route.abort('blockedbyclient');
      return;
    }
    await route.continue();
  });
  await context.routeWebSocket('**/*', socket => {
    metadata.networkPolicy.blockedWebSockets += 1;
    socket.close();
  });

  const page = await context.newPage();
  page.setDefaultTimeout(30000);
  const response = await page.goto(URL, { waitUntil: 'domcontentloaded', timeout: 90000 });
  metadata.httpStatus = response?.status();
  metadata.actualUrl = page.url();
  metadata.title = await page.title();
  if (metadata.httpStatus !== 200 || metadata.title !== 'PhysicsOS · 让好奇心，有处发生') {
    throw new Error(`Unexpected public website response/title (${metadata.httpStatus}).`);
  }
  await page.locator('.hero h1').waitFor({ state: 'visible' });

  async function settle(waitMs = 1800) {
    await page.evaluate(async () => {
      await document.fonts.ready;
      const visibleImages = [...document.images].filter(image => {
        const r = image.getBoundingClientRect();
        return r.width > 0 && r.height > 0 && r.bottom > 0 && r.top < innerHeight;
      });
      await Promise.all(visibleImages.map(async image => {
        if (!image.complete) {
          await Promise.race([
            new Promise(resolve => {
              image.addEventListener('load', resolve, { once: true });
              image.addEventListener('error', resolve, { once: true });
            }),
            new Promise(resolve => setTimeout(resolve, 20000)),
          ]);
        }
        if (image.complete && image.naturalWidth > 0) await image.decode().catch(() => {});
      }));
    });
    await page.waitForTimeout(waitMs);
    await page.evaluate(async () => {
      const finite = document.getAnimations().filter(animation => {
        const timing = animation.effect?.getComputedTiming();
        return animation.playState === 'running' && timing && Number.isFinite(timing.endTime);
      });
      await Promise.race([
        Promise.allSettled(finite.map(animation => animation.finished)),
        new Promise(resolve => setTimeout(resolve, 5000)),
      ]);
      await new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)));
    });
  }

  async function scrollTo(y) {
    // Scroll the real document only. Do not click controls or modify its DOM/styles.
    await page.evaluate(top => window.scrollTo({ top, left: 0, behavior: 'instant' }), y);
    await settle();
  }

  async function rect(selector) {
    return page.locator(selector).evaluate(element => {
      const r = element.getBoundingClientRect();
      return { x: r.x + scrollX, y: r.y + scrollY, width: r.width, height: r.height, bottom: r.bottom + scrollY };
    });
  }

  async function assertRevealed(selector) {
    await page.locator(selector).evaluate(element => {
      for (let node = element; node; node = node.parentElement) {
        const css = getComputedStyle(node);
        if (Number(css.opacity) < 0.99 || css.visibility === 'hidden' || css.display === 'none') {
          throw new Error(`Unsettled or hidden website content: ${element.className}`);
        }
      }
    });
  }

  async function assertNoLoading() {
    const pending = await page.evaluate(() => [...document.querySelectorAll('[aria-busy="true"], .loading, .is-loading, .skeleton')]
      .filter(element => {
        const r = element.getBoundingClientRect();
        const css = getComputedStyle(element);
        return r.width > 0 && r.height > 0 && r.bottom > 0 && r.top < innerHeight && css.visibility !== 'hidden' && Number(css.opacity) > 0;
      }).length);
    if (pending) throw new Error('Visible website loading indicators remain; capture aborted.');
    const broken = await page.evaluate(() => [...document.images].filter(image => {
      const r = image.getBoundingClientRect();
      return r.width > 0 && r.height > 0 && r.bottom > 0 && r.top < innerHeight && (!image.complete || image.naturalWidth === 0);
    }).length);
    if (broken) throw new Error('Visible website images are not ready; capture aborted.');
  }

  async function capture(name, subject, crop, cropReason) {
    await settle(600);
    await assertNoLoading();
    const state = await page.evaluate(() => ({
      url: location.href,
      scrollCssPixels: { x: scrollX, y: scrollY },
      documentCssPixels: { width: document.documentElement.scrollWidth, height: document.documentElement.scrollHeight },
      fontsStatus: document.fonts.status,
    }));
    const fullPage = !crop;
    const clip = crop ? {
      x: Math.max(0, Math.floor(crop.x)),
      y: Math.max(0, Math.floor(crop.y)),
      width: Math.floor(crop.width),
      height: Math.floor(crop.height),
    } : undefined;
    if (clip && (clip.x + clip.width > state.documentCssPixels.width || clip.y + clip.height > state.documentCssPixels.height)) {
      throw new Error(`Capture crop extends beyond the live document: ${name}`);
    }
    if (clip && (clip.y < state.scrollCssPixels.y || clip.y + clip.height > state.scrollCssPixels.y + VIEWPORT.height)) {
      throw new Error(`Capture crop must fit in the actual scrolled viewport: ${name}`);
    }
    // Playwright's non-fullPage clip is viewport-relative, not document-relative.
    const viewportClip = clip ? {
      ...clip,
      x: clip.x - state.scrollCssPixels.x,
      y: clip.y - state.scrollCssPixels.y,
    } : undefined;
    const capturedAt = new Date().toISOString();
    const png = await page.screenshot({ type: 'png', fullPage, clip: viewportClip, animations: 'allow', caret: 'hide', scale: 'device', timeout: 60000 });
    if (clip && (png.readUInt32BE(16) !== clip.width * DPR || png.readUInt32BE(20) !== clip.height * DPR)) {
      throw new Error(`Unexpected screenshot pixel dimensions; refusing to save an incomplete crop: ${name}`);
    }
    const path = resolve(OUT, name);
    const handle = await open(path, 'wx');
    try { await handle.writeFile(png); } finally { await handle.close(); }
    const entry = {
      file: path,
      subject,
      capturedAt,
      ...state,
      viewportCssPixels: VIEWPORT,
      deviceScaleFactor: DPR,
      fullPage,
      cropped: Boolean(clip),
      cropCoordinates: clip ? 'absolute document CSS pixels; native browser screenshot, not post-processed' : null,
      clipCssPixels: clip || null,
      viewportClipCssPixels: viewportClip || null,
      croppingStatus: cropReason,
      outputPixels: { width: png.readUInt32BE(16), height: png.readUInt32BE(20) },
      bytes: png.length,
    };
    metadata.shots.push(entry);
    console.log(JSON.stringify({ file: path, capturedAt, outputPixels: entry.outputPixels, clipCssPixels: entry.clipCssPixels }));
  }

  // Trigger genuine scroll-entry reveals and lazy image loading across this one page.
  await settle(6000);
  const height = await page.evaluate(() => document.documentElement.scrollHeight);
  for (let y = 0; y < height; y += 600) await scrollTo(y);
  await scrollTo(0);
  await assertRevealed('.hero');

  const exploreHeading = await rect('#explore .section-heading');
  const heroHeight = Math.min(1000, Math.floor(exploreHeading.y - 30));
  await capture('W01-official-hero.png', 'Official hero, navigation, mascot, tagline, and native value strip',
    { x: 0, y: 0, width: VIEWPORT.width, height: heroHeight },
    'Bottom of the 1080px viewport cropped before the next section heading; no content removal or compositing.');

  await scrollTo(880);
  await assertRevealed('#explore .section-heading');
  await assertRevealed('#explore .experience-shell');
  const heading = await rect('#explore .section-heading');
  const shell = await rect('#explore .experience-shell');
  await capture('W02-official-exploration.png', 'Interactive exploration feature: heading, live wave demo, tabs, and frequency control; not testimonials',
    { x: shell.x - 40, y: heading.y - 30, width: shell.width + 80, height: shell.bottom - heading.y + 54 },
    'Native document crop around exploration heading and complete interactive wave demo; excludes testimonial/feedback section.');

  await scrollTo(1050);
  await assertRevealed('#explore .experience-shell');
  for (const card of await page.locator('#explore .feature-card').all()) {
    await card.evaluate(element => {
      if (Number(getComputedStyle(element).opacity) < 0.99) throw new Error('Feature card entry animation not settled.');
    });
  }
  const workflowShell = await rect('#explore .experience-shell');
  const grid = await rect('#explore .feature-grid');
  const featureText = await page.locator('#explore .feature-grid').innerText();
  if (!featureText.includes('一个问题，接住你的好奇') || !featureText.includes('从题目，走进实验里')) {
    throw new Error('Expected public AI/question-to-experiment feature text is missing.');
  }
  metadata.aiWorkflowText = featureText;
  await capture('W03-official-ai-workflow.png', 'Live experiment context plus native AI tutor, question-to-experiment, and learning-record feature text',
    { x: grid.x - 40, y: workflowShell.y - 24, width: grid.width + 80, height: grid.bottom - workflowShell.y + 56 },
    'Native crop emphasizes the experiment and three feature cards. This is public marketing text, not a fabricated AI chat or app workflow.');

  await scrollTo(await page.evaluate(() => document.documentElement.scrollHeight));
  await assertRevealed('.cta');
  const closing = await rect('.cta');
  const footer = await rect('footer');
  metadata.closingText = await page.locator('.cta').innerText();
  await capture('W04-official-closing.png', 'Final discovery call-to-action, native mascot, and footer',
    { x: closing.x - 40, y: closing.y - 32, width: closing.width + 80, height: footer.bottom - closing.y + 32 },
    'Native document crop around the closing CTA and footer; excludes the preceding community empty state and sticky navigation.');

  await scrollTo(0);
  const finalHeight = await page.evaluate(() => document.documentElement.scrollHeight);
  if (finalHeight <= 8000) {
    await capture('W00-official-fullpage.png', 'Complete public homepage, including genuine loaded empty states', null,
      'Uncropped full-page browser screenshot; 1920px CSS width, actual page height, DPR2.');
  } else {
    metadata.gaps.push(`Full-page image omitted: actual document height ${finalHeight}px exceeds the 8000px CSS sanity limit.`);
  }

  const publicState = await page.evaluate(() => {
    const css = getComputedStyle(document.documentElement);
    return {
      tagline: document.querySelector('.hero h1').textContent.trim(),
      palette: Object.fromEntries(['--paper', '--ink', '--muted', '--green', '--lime'].map(key => [key, css.getPropertyValue(key).trim()])),
      imageReadiness: [...document.images].map(image => ({
        assetPath: new globalThis.URL(image.currentSrc || image.src, location.href).pathname,
        complete: image.complete,
        naturalWidth: image.naturalWidth,
        naturalHeight: image.naturalHeight,
      })),
      feedback: document.querySelector('#voices').innerText,
      community: document.querySelector('#community').innerText,
    };
  });
  metadata.tagline = publicState.tagline;
  metadata.palette = publicState.palette;
  metadata.imageReadiness = publicState.imageReadiness;
  metadata.feedbackStatus = publicState.feedback.includes('这里还没有公开的反馈') ? 'Loaded genuine empty state; not loading and not invented testimonials.' : 'Live public feedback as served.';
  metadata.communityStatus = publicState.community.includes('这里还没有公开的共创项目') ? 'Loaded genuine empty state; not invented contributors/projects.' : 'Live public community as served.';
  metadata.completedAt = new Date().toISOString();
  metadata.visualVerification = { status: 'pending independent Read-tool image inspection', files: metadata.shots.map(shot => shot.file) };
  metadata.reproduction = 'Run node promo-video/xiaoyunque-90s-v1/tools/capture-website.mjs from the repository root with the existing SOCKS proxy available and these target filenames absent. The script refuses to overwrite existing assets.';
  await writeFile(resolve(OUT, 'website-capture.json'), `${JSON.stringify(metadata, null, 2)}\n`, { flag: 'wx' });

  const lines = [
    '# 官网真实截图',
    '',
    `- 实际地址：${metadata.actualUrl}（HTTP ${metadata.httpStatus}）`,
    `- 页面标题：${metadata.title}`,
    `- 实际捕获时间（UTC）：${startedAt} 至 ${metadata.completedAt}；每张的时间见 website-capture.json。`,
    '- 环境：Chromium revision 1234；1920×1080 CSS px；DPR 2；light；zh-CN；现有 SOCKS 代理。',
    '- 安全边界：仅允许 GET/HEAD/OPTIONS；Service Worker 与 WebSocket 均拦截。只滚动，不点击、不提交，不操作服务器或隧道。',
    `- 标语：${publicState.tagline}；首屏说明为「把抽象的公式，变成看得见的世界」。`,
    `- 真实页面配色：薄荷绿／奶油白；纸色 ${publicState.palette['--paper']}、墨绿 ${publicState.palette['--ink']}、主绿 ${publicState.palette['--green']}、浅青柠 ${publicState.palette['--lime']}、次级文字 ${publicState.palette['--muted']}（读取网站 CSS 变量）。`,
    '- 字体及可见图片解码完成；逐段滚动触发网站原生入场动画并等待稳定。保留原生持续动画，不改 DOM、样式、文字或指标，不遮罩、不拼贴、不生成 UI。',
    '',
    '## 文件与裁切',
    '',
    ...metadata.shots.map(shot => `- ${shot.file.split('/').pop()}：${shot.outputPixels.width}×${shot.outputPixels.height} px；${shot.fullPage ? '完整长页、无裁切' : `原生裁切 CSS x=${shot.clipCssPixels.x}, y=${shot.clipCssPixels.y}, w=${shot.clipCssPixels.width}, h=${shot.clipCssPixels.height}`}；${shot.subject}。`),
    '',
    '## 真实内容与边界',
    '',
    '- W02 是「波的旅行」互动小样：波形、公式 v = λf、频率滑块与物理解释，不是用户证言。未更改默认频率或操作控件。',
    '- W03 包含真实文案「一个问题，接住你的好奇」「从题目，走进实验里」与 AI 讲题／引擎验证；不是登录后的实际 AI 对话演示。',
    '- 反馈与共创区已加载，当前为「这里还没有公开的反馈／共创项目」真实空状态。重点四张避开这些区域；完整长页如实保留，不制造证言、贡献者或指标。',
    '- 视觉验收：待在本次任务中用 Read 逐张检查 PNG 后更新。',
    ...(metadata.gaps.length ? metadata.gaps.map(gap => `- 缺口：${gap}`) : ['- 缺口：无缺图；部分镜头为保持完整分区而裁切，并非全部为 16:9。']),
    '',
    '## 复现',
    '',
    '在仓库根目录运行 `node promo-video/xiaoyunque-90s-v1/tools/capture-website.mjs`。需保留现有 127.0.0.1:18963 SOCKS 代理、已安装的 @playwright/test 与 Chromium 1234。目标文件存在时会拒绝覆盖；无需安装、启动本地服务或部署。',
    '',
  ];
  await writeFile(resolve(OUT, 'website-findings.md'), lines.join('\n'), { flag: 'wx' });
  console.log(JSON.stringify({ completed: true, shotCount: metadata.shots.length, metadata: resolve(OUT, 'website-capture.json'), findings: resolve(OUT, 'website-findings.md'), blockedMethods: metadata.networkPolicy.blockedMethods, blockedWebSockets: metadata.networkPolicy.blockedWebSockets }));
} catch (error) {
  console.error(`Website capture failed: ${error.message}`);
  process.exitCode = 1;
} finally {
  await browser?.close();
}
