import assert from 'node:assert/strict'
import { readFile, mkdtemp, writeFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { spawnSync } from 'node:child_process'
import test from 'node:test'

test('nginx installer idempotently isolates experiment assets and accepts actual ZIP upload sizes', async () => {
  const source = await readFile(new URL('./install-nginx-security-headers.sh', import.meta.url), 'utf8')
  const scripts = [...source.matchAll(/python3 - <<'PY'\n([\s\S]*?)\nPY/g)].map(match => match[1])
  const root = await mkdtemp(join(tmpdir(), 'experiment-proxy-'))
  const site = join(root, 'site.conf')
  try {
    await writeFile(site, 'server {\n    listen 443 ssl;\n    server_name physics.dongsiwei.com;\n    location / { proxy_pass http://127.0.0.1:3080; }\n}\n')
    for (let run = 0; run < 2; run += 1) for (const script of scripts) {
      const result = spawnSync('python3', ['-c', script], {
        encoding: 'utf8', env: { ...process.env, SITE: site, SERVER_NAME: 'physics.dongsiwei.com', HSTS_MAX_AGE: '300' },
      })
      assert.equal(result.status, 0, result.stderr)
    }
    const config = await readFile(site, 'utf8')
    assert.equal(config.match(/location \^~ \/physicsos\/experiment-assets\//g)?.length, 1)
    assert.equal(config.match(/location \^~ \/physicsos\/experiments\//g)?.length, 1)
    const assets = config.match(/location \^~ \/physicsos\/experiment-assets\/ \{([^}]+)\}/)?.[1]
    assert.match(assets ?? '', /proxy_set_header Cookie "";/)
    assert.match(assets ?? '', /proxy_hide_header Set-Cookie;/)
    assert.doesNotMatch(assets ?? '', /add_header X-Frame-Options|proxy_hide_header Content-Security-Policy/)
    assert.match(config, /client_max_body_size 32m;/)
    assert.match(config, /X-Frame-Options "DENY"/)
    assert.match(config, /paper\/jobs/)
  } finally { await rm(root, { recursive: true, force: true }) }
})
