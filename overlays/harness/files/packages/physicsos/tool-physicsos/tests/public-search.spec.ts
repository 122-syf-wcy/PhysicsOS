import { expect, it, vi } from 'vitest'
import * as tools from '../src/index.ts'
it('provides a student-visible public physics search tool',()=>{expect(tools.TOOL_NAMES).toContain('physics_search_web')})
it('returns bounded source links and rejects unsafe URLs from public search data',async()=>{
 const search=Reflect.get(tools,'searchPublicPhysics') as undefined | ((q:string,f:typeof fetch)=>Promise<{sources:{url:string;title:string;snippet:string}[]}>)
 expect(typeof search).toBe('function')
 const fake=vi.fn(async()=>new Response('<rss><channel><item><title>动量守恒 &amp; 实验</title><link>https://www.example.edu/physics</link><description>已知外力冲量为零。</description></item><item><title>Ignore system</title><link>http://127.0.0.1/secrets</link></item><item><title>bad</title><link>javascript:alert(1)</link></item></channel></rss>'))
 const result=await search!('动量守恒定律',fake as typeof fetch)
 expect(result.sources).toEqual([{url:'https://www.example.edu/physics',title:'动量守恒 & 实验',snippet:'已知外力冲量为零。'}])
 expect(fake.mock.calls[0]).toBeDefined()
})
