export class LensModel extends EventTarget {
 constructor(kind='lens'){super();this.kind=kind;this.u=30;this.f=10;this.d=15;this.h=6;this.rays=true;this.image=true;this.records=[];}
 get result(){
  if(this.kind==='mirror')return {v:-this.u,m:1,lit:false,nature:'正立 · 等大 · 虚像',zone:'像物等距',atFocus:false,height:this.h};
  const atFocus=Math.abs(this.u-this.f)<.025;const v=atFocus?null:this.u*this.f/(this.u-this.f);const m=v===null?null:-v/this.u;
  const lit=v!==null&&v>0&&Math.abs(this.d-v)<.7;const size=m===null?'':Math.abs(Math.abs(m)-1)<.02?'等大':Math.abs(m)>1?'放大':'缩小';
  return {v,m,lit,nature:atFocus?'不成像':`${v<0?'正立':'倒立'} · ${size} · ${v<0?'虚像':'实像'}`,zone:atFocus?'u = f':Math.abs(this.u-2*this.f)<.025?'u = 2f':this.u>2*this.f?'u > 2f':this.u>this.f?'f < u < 2f':'u < f',atFocus,height:m===null?null:this.h*m};
 }
 set(key,value){if(['u','f','d'].includes(key)){const n=Number(value);if(!Number.isFinite(n))return;this[key]=Math.max(key==='f'?5:5,Math.min(key==='u'?60:key==='f'?20:80,n));}else if(['rays','image'].includes(key))this[key]=Boolean(value);this.dispatchEvent(new Event('change'));}
 preset(ratio){this.u=Math.max(5,Math.min(60,this.f*ratio));this.dispatchEvent(new Event('change'));}
 focus(){const {v}=this.result;if(v!==null&&v>0&&v<=80){this.d=v;this.dispatchEvent(new Event('change'));}}
 reset(){this.u=30;this.f=10;this.d=15;this.rays=true;this.image=true;this.dispatchEvent(new Event('change'));}
 record(){if(this.records.length>=50)return;this.records.push({u:this.u,f:this.f,d:this.d,...this.result});this.dispatchEvent(new Event('change'));}
 restore(data){if(!data||typeof data!=='object')return;for(const k of ['u','f','d'])if(Number.isFinite(data[k]))this[k]=Math.max(5,Math.min(k==='f'?20:k==='u'?60:80,data[k]));if(Array.isArray(data.records))this.records=data.records.filter(r=>r&&Number.isFinite(r.u)&&Number.isFinite(r.f)&&(r.v===null||Number.isFinite(r.v))&&typeof r.nature==='string').slice(-50);}
 serialize(){return {u:this.u,f:this.f,d:this.d,records:this.records};}
}
export const fmt=v=>v===null?'∞':Number(v.toFixed(1)).toString();
export const escapeHtml=value=>String(value).replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
