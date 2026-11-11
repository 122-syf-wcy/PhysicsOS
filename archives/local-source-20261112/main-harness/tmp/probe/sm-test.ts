import z from '../../vendor/schemastery/src/index.ts'

/* Nested object whose inner fields are plain (not .required()). */
const D = z.object({
  req: z.string().required(),
  nested: z.object({ b: z.string(), c: z.number() }),
})
try { console.log('D {req} ->', JSON.stringify(D({ req: 'x' }))) } catch (e) { console.log('D {req} threw:', (e as Error).message) }

/* Same, but nested inner field IS required. */
const E = z.object({
  req: z.string().required(),
  nested: z.object({ b: z.string().required() }),
})
try { console.log('E {req} ->', JSON.stringify(E({ req: 'x' }))) } catch (e) { console.log('E {req} threw:', (e as Error).message) }

/* required(false) on the nested object. */
const F = z.object({
  req: z.string().required(),
  nested: z.object({ b: z.string().required() }).required(false),
})
try { console.log('F {req} ->', JSON.stringify(F({ req: 'x' }))) } catch (e) { console.log('F {req} threw:', (e as Error).message) }
