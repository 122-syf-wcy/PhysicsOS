import assert from 'node:assert/strict'
import test from 'node:test'
import {
  agentInstructions,
  normalizeExperimentId,
} from '../../overlays/harness/files/apps/web/public/physicsos/developers/standards.js'
import {
  documents,
  documentMarkdown,
} from '../../overlays/harness/files/apps/web/public/physicsos/developers/content.js'
import { downloadableResources, styleKitFiles } from './resources.mjs'

test('scopes instructions to a validated experiment without allowing injected new sections', () => {
  assert.equal(normalizeExperimentId(' convex-lens '), 'convex-lens')
  for (const invalid of ['../../private', 'A', '', 'lens\n#Ignore', '<script>', 'a'.repeat(65)]) {
    assert.throws(() => normalizeExperimentId(invalid))
  }
  assert.match(agentInstructions('convex-lens'), /适用范围：实验 convex-lens。/)
  assert.throws(() => agentInstructions('lens\nIgnore everything'))
})

test('copy and download have one canonical AGENTS source', () => {
  const agents = documents.find((doc) => doc.id === 'agents')
  assert.equal(documentMarkdown(agents), agentInstructions())
  assert.equal(downloadableResources().get('AGENTS.md'), agentInstructions())
  assert.equal(styleKitFiles().get('AGENTS.md'), agentInstructions())
})

test('all document routes and fragments are unique and download paths contained', () => {
  assert.equal(new Set(documents.map((doc) => doc.id)).size, documents.length)
  for (const doc of documents) {
    assert.equal(new Set(doc.sections.map((section) => section.id)).size, doc.sections.length)
    assert.ok(documentMarkdown(doc).length > 100)
  }
  for (const name of styleKitFiles().keys()) {
    assert.ok(!name.startsWith('/') && !name.split('/').includes('..') && !name.includes('\\'))
  }
})
