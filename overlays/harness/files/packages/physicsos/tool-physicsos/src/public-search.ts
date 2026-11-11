import { isIP } from 'node:net'
export interface PublicSource { url:string; title:string; snippet:string }
const plain=(value:string)=>value.replace(/^<!\[CDATA\[([\s\S]*)\]\]>$/,'$1').replace(/<[^>]*>/g,'').replace(/&#(x[0-9a-f]+|[0-9]+);/gi,(_all,n)=>{const v=n[0].toLowerCase()==='x'?parseInt(n.slice(1),16):Number(n);return v>0&&v<=0x10ffff?String.fromCodePoint(v):''}).replace(/&(amp|lt|gt|quot|apos|nbsp);/g,(_all,n)=>({amp:'&',lt:'<',gt:'>',quot:'"',apos:"'",nbsp:' '})[n]??'').replace(/\s+/g,' ').trim()
function source(url:string,title:string,snippet:string):PublicSource|undefined {
 try{
  const parsed=new URL(plain(url))
  if(parsed.protocol!=='http:'&&parsed.protocol!=='https:')return undefined
  const host=parsed.hostname.toLowerCase()
  if(parsed.username||parsed.password||isIP(host.replace(/^\[|\]$/g,''))||host==='localhost'||host.endsWith('.localhost')||host.endsWith('.local'))return undefined
  return {url:parsed.toString(),title:plain(title).slice(0,240),snippet:plain(snippet).slice(0,1600)}
 }catch{return undefined}
}
export function publicSearchSources(text:string):PublicSource[]{
 const result:PublicSource[]=[]
 for(const match of text.matchAll(/<item\b[^>]*>([\s\S]*?)<\/item>/gi)){
  const part=match[1]!,read=(tag:string)=>new RegExp(`<${tag}\\b[^>]*>([\\s\\S]*?)<\\/${tag}>`,'i').exec(part)?.[1]??''
  const item=source(read('link'),read('title'),read('description'))
  if(item&&!result.some(s=>s.url===item.url))result.push(item)
 }
 if(result.length===0){
  for(const match of text.matchAll(/<a\b([^>]*class=["'][^"']*result__a[^"']*["'][^>]*)>([\s\S]*?)<\/a>/gi)){
   const raw=/href=["']([^"']*)/i.exec(match[1]!)?.[1]??''
   let link=plain(raw)
   try{const u=new URL(link.startsWith('//')?'https:'+link:link,'https://duckduckgo.com');link=u.searchParams.get('uddg')??u.toString()}catch{}
   const item=source(link,match[2]!,'')
   if(item&&!result.some(s=>s.url===item.url))result.push(item)
  }
 }
 return result.filter(s=>s.title!=='').slice(0,5)
}
async function boundedText(response:Response):Promise<string>{
 if(!response.ok)throw new Error('SEARCH_HTTP')
 const reader=response.body?.getReader();if(reader===undefined)return ''
 const chunks:Uint8Array[]=[];let size=0
 try{for(;;){const next=await reader.read();if(next.done)break;size+=next.value.byteLength;if(size>1_048_576){await reader.cancel();throw new Error('SEARCH_RESPONSE_SIZE')}chunks.push(next.value)}}finally{reader.releaseLock()}
 const bytes=new Uint8Array(size);let at=0;for(const chunk of chunks){bytes.set(chunk,at);at+=chunk.length}return new TextDecoder().decode(bytes)
}
/** Public keyword retrieval; it never uploads images or follows a model-supplied destination. */
export async function searchPublicPhysics(query:string,fetcher:typeof fetch=globalThis.fetch):Promise<{query:string;provider:string;sources:PublicSource[]}>{
 query=query.trim();if(query===''||query.length>240)throw new Error('请用简短的物理概念关键词检索。')
 const targets=[['Bing','https://www.bing.com/search?format=rss&q='],['DuckDuckGo','https://html.duckduckgo.com/html/?q=']]
 for(const [provider,base] of targets){
  try{const response=await fetcher(base+encodeURIComponent(query),{signal:AbortSignal.timeout(8000),headers:{'user-agent':'PhysicsOS study search'},redirect:'error'});const sources=publicSearchSources(await boundedText(response));if(sources.length)return {query,provider:provider!,sources}}catch{}
 }
 throw new Error('暂时没有检索到可以核对的公开网页，请稍后重试。')
}
