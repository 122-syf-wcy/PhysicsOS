import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import vm from 'node:vm';

const page = await readFile(new URL('../../overlays/harness/files/apps/web/public/physicsos/website/index.html', import.meta.url), 'utf8');
// Exercise the real early bootstrap before styles and module scripts can render the landing page.
const earlyHead = page.split('</head>')[0].split(/<link\b[^>]*\brel=["']stylesheet["']/i)[0];
const scripts = [];
for (const match of earlyHead.matchAll(/<script\b([^>]*)>([\s\S]*?)<\/script>/gi)) {
  if (/\btype=["']module["']/i.test(match[1])) continue;
  const source = match[1].match(/\bsrc=["']\/physicsos\/website\/([^"']+)["']/i);
  scripts.push(source ? await readFile(new URL(`../../overlays/harness/files/apps/web/public/physicsos/website/${source[1]}`, import.meta.url), 'utf8') : match[2]);
}

function redirects(pathname, hash, search = '') {
  const targets = [];
  const location = { pathname, hash, search, replace: target => targets.push(target) };
  for (const source of scripts) vm.runInNewContext(source, { location, window: { location } });
  return targets;
}

test('legacy root experiment links enter the system domain with their query and hash intact', () => {
  for (const hash of ['#/experiments', '#/experiments/', '#/experiments/optics/convex-lens', '#/experiments?domain=optics']) {
    assert.deepEqual(redirects('/', hash, '?source=shared'), [`https://physics.dongsiwei.com/?source=shared${hash}`]);
  }
});

test('legacy contribution and password-reset hashes enter the system root', () => {
  for (const hash of ['#/contribute', '#/contribute?tab=uploads', '#reset_token=example']) {
    assert.deepEqual(redirects('/', hash), [`https://physics.dongsiwei.com/${hash}`]);
  }
});

test('website anchors, lookalike prefixes and arbitrary hashes stay on the website', () => {
  for (const hash of ['', '#main', '#explore', '#voices', '#community', '#/experiments-other', '#/experimentsAnything', '#/contributeworthy', '#reset_token_extra=example', '#/unknown', '#https://example.com']) {
    assert.deepEqual(redirects('/', hash), [], hash);
  }
  assert.deepEqual(redirects('/', '', '?reset_token=example'), []);
});

test('the compatibility redirect runs only at the root pathname', () => {
  for (const pathname of ['/app', '/app/', '/physicsos/website/index.html', '/physicsos/website/']) {
    assert.deepEqual(redirects(pathname, '#/experiments'), []);
    assert.deepEqual(redirects(pathname, '#reset_token=example'), []);
  }
});

const links = [...page.matchAll(/<a\b[^>]*\bhref=["']([^"']+)["'][^>]*>([\s\S]*?)<\/a>/gi)]
  .map(([, href, content]) => ({ href, label: content.replace(/<[^>]+>/g, '').trim() }));

test('all product and administrator links navigate from the website to the system root', () => {
  for (const label of ['开始探索', '进入 PhysicsOS', '进入我的物理世界', '去完整实验室看看', '开启我的探索', '管理员后台']) {
    const link = links.find(item => item.label === label);
    assert.ok(link, `missing ${label} link`);
    assert.equal(new URL(link.href, 'https://physicsos.dongsiwei.com/').href, 'https://physics.dongsiwei.com/', label);
  }
});

test('developer documentation remains on the system domain', () => {
  const link = links.find(item => item.label === '开发文档 ↗');
  assert.ok(link, 'missing developer documentation link');
  assert.equal(new URL(link.href, 'https://physicsos.dongsiwei.com/').href, 'https://physics.dongsiwei.com/physicsos/developers/index.html');
});
