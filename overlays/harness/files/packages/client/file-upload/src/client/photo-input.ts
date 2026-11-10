/** Normalize browser camera formats without sending a readable photo as an opaque file. */
const TYPES: Record<string,string>={png:'image/png',jpg:'image/jpeg',jpeg:'image/jpeg',webp:'image/webp',gif:'image/gif',heic:'image/heic',heif:'image/heif'}
export function browserPhotoType(file: Pick<File,'type'|'name'>): string | undefined {
 const type=file.type.toLowerCase()
 if(Object.values(TYPES).includes(type))return type
 if(type!==''&&type!=='application/octet-stream')return undefined
 return TYPES[file.name.split('.').at(-1)?.toLowerCase()??'']
}
export const isBrowserPhoto=(file:Pick<File,'type'|'name'>):boolean=>browserPhotoType(file)!==undefined
export async function normalizePhoto(file:File):Promise<File>{
 const type=browserPhotoType(file)
 if(type===undefined)return file
 if(type!=='image/heic'&&type!=='image/heif')return file.type===type?file:new File([file],file.name,{type,lastModified:file.lastModified})
 const url=URL.createObjectURL(file)
 const image=new Image()
 const canvas=document.createElement('canvas')
 try{
  image.src=url
  await image.decode()
  const width=image.naturalWidth,height=image.naturalHeight
  if(width<=0||height<=0||width*height>32_000_000)throw new Error('PHOTO_SIZE')
  canvas.width=width;canvas.height=height
  const context=canvas.getContext('2d')
  if(context===null)throw new Error('PHOTO_CANVAS')
  context.drawImage(image,0,0)
  const blob=await new Promise<Blob>((resolve,reject)=>canvas.toBlob(value=>value===null?reject(new Error('PHOTO_ENCODING')):resolve(value),'image/jpeg',.94))
  return new File([blob],file.name.replace(/\.(heic|heif)$/i,'.jpg'),{type:'image/jpeg',lastModified:file.lastModified})
 }catch{
  throw new Error(document.documentElement.lang.startsWith('zh')?'这张相册照片无法读取，请在相册中导出 JPEG 或 PNG 后重试。':'This camera photo could not be read. Export it as JPEG or PNG and try again.')
 }finally{image.src='';canvas.width=0;canvas.height=0;URL.revokeObjectURL(url)}
}
