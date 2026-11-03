import assert from 'node:assert/strict'
import test from 'node:test'
import { mkdtemp, mkdir, writeFile, rm, cp, readFile, readdir } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { spawnSync } from 'node:child_process'
import { createHash } from 'node:crypto'

async function releaseFixture(run) {
  const root = await mkdtemp(join(tmpdir(), 'physicsos-release-'))
  try {
    await cp(new URL('../tools/', import.meta.url), join(root, 'tools'), { recursive: true })
    await mkdir(join(root, 'dist'), { recursive: true })
    await writeFile(join(root, 'dist/stale-secret.txt'), 'stale output')
    await writeFile(join(root, 'dist/index.html'), 'old')
    await writeFile(join(root, 'build.mjs'), "import {writeFile} from 'node:fs/promises'; await writeFile('dist/index.html','fresh')")
    await writeFile(join(root, 'validate.mjs'), "import {readFile} from 'node:fs/promises'; if((await readFile('dist/index.html','utf8'))!=='fresh')process.exit(1)")
    await writeFile(join(root, 'tools/validate.mjs'), "import {readFile} from 'node:fs/promises'; export async function validatePackage(){return {manifest:{schemaVersion:2,experimentId:'convex-lens',version:'1.0.1'},files:new Map([['dist/index.html',await readFile('dist/index.html')]])}}")
    const pkg = {type:'module',scripts:{check:'node -e "process.exit(0)"',build:'node tools/clean-build.mjs && node -e "require(\'node:fs\').mkdirSync(\'dist\')" && node build.mjs','validate:package':'node validate.mjs'}}
    await writeFile(join(root,'package.json'),JSON.stringify(pkg))
    await run(root, pkg)
  } finally { await rm(root, {recursive:true,force:true}) }
}
function release(root, script = 'release.mjs') { return spawnSync(process.execPath, ['tools/'+script], {cwd:root,encoding:'utf8'}) }
test('release cleans old dist, checks/builds/validates then reports actual ZIP hash and bytes', async () => {
  await releaseFixture(async root => {
    const result=release(root)
    assert.equal(result.status,0,result.stderr)
    assert.deepEqual(await readdir(join(root,'dist')),['index.html'])
    const bytes=await readFile(join(root,'release/convex-lens-1.0.1.zip'))
    const report=JSON.parse(await readFile(join(root,'release/convex-lens-1.0.1.json'),'utf8'))
    assert.deepEqual(report,{schemaVersion:2,experimentId:'convex-lens',version:'1.0.1',sha256:createHash('sha256').update(bytes).digest('hex'),bytes:bytes.length,checks:['check','build','validate:package','pack']})
  })
})
test('failed checks stop release before build and pack including public pack alias', async () => {
  await releaseFixture(async (root,pkg) => {
    pkg.scripts.check='node -e "process.exit(7)"'
    await writeFile(join(root,'package.json'),JSON.stringify(pkg))
    for(const script of ['release.mjs','pack.mjs']) {
      assert.notEqual(release(root,script).status,0)
      assert.deepEqual(await readdir(join(root,'dist')),['index.html','stale-secret.txt'])
      await assert.rejects(readFile(join(root,'release/convex-lens-1.0.1.zip')))
    }
  })
})

test('pack refuses a ZIP whose serialized bytes exceed the host 20 MiB intake limit', async () => {
  const { packRelease } = await import('../tools/pack-release.mjs')
  const root = await mkdtemp(join(tmpdir(), 'physicsos-oversized-release-'))
  try {
    const validated = { manifest: { experimentId: 'convex-lens', version: '1.0.0' }, files: new Map([['dist/large.bin', Buffer.alloc(20 * 1024 * 1024)]]) }
    await assert.rejects(packRelease(root, validated, ['check', 'build', 'validate:package']), /20 MiB/)
    await assert.rejects(readFile(join(root, 'release/convex-lens-1.0.0.zip')))
  } finally { await rm(root, { recursive: true, force: true }) }
})
