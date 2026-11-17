/** Internal catalog seam test source only; NOT run. */
import { Context } from '@deepseek-ai/cordis'
import { describe, expect, it } from 'vitest'
import { createExperimentCatalogService, EXPERIMENT_CATALOG_SERVICE } from '../src/catalog-service.ts'
import { experimentCatalog } from '../src/contract-v3.ts'
describe('published catalog internal resolver', () => {
  it('resolves precisely the existing server-published template identity closure, never client slugs or arbitrary package UUIDs', async () => {
    const ctx = new Context()
    const catalog = createExperimentCatalogService()
    ctx.provide(EXPERIMENT_CATALOG_SERVICE, catalog)
    expect(ctx.get(EXPERIMENT_CATALOG_SERVICE)).toBe(catalog)
    expect(catalog.schemaVersion).toBe(1)
    expect(experimentCatalog.length).toBeGreaterThan(0)
    for (const profile of experimentCatalog) expect(catalog.has(profile.id)).toBe(true)
    for (const invalid of ['', 'arbitrary-valid-slug', '__proto__', 'Incline', 'incline ', '00000000-0000-4000-8000-000000000001']) expect(catalog.has(invalid)).toBe(false)
    expect(catalog.has('incline')).toBe(true); expect(catalog.has('uniform-linear')).toBe(true)
    await ctx.fiber.dispose()
  })
})
