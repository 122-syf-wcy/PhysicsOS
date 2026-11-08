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

test('legacy root experiment links enter the app with their query and hash intact', () => {
  for (const hash of ['#/experiments', '#/experiments/', '#/experiments/optics/convex-lens', '#/experiments?domain=optics']) {
    assert.deepEqual(redirects('/', hash, '?source=shared'), [`/app?source=shared${hash}`]);
  }
});

test('legacy contribution and password-reset hashes enter the app', () => {
  for (const hash of ['#/contribute', '#/contribute?tab=uploads', '#reset_token=example']) {
    assert.deepEqual(redirects('/', hash), [`/app${hash}`]);
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
