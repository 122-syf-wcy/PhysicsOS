export class LensModel extends EventTarget {
  constructor(){ super();this.u=30;this.f=10;this.d=15;this.h=6;this.rays=true;this.image=true;this.records=[]; }
  get result(){
    const {u,f,d,h}=this;const atFocus=Math.abs(u-f)<0.025;
    const v=atFocus?null:u*f/(u-f);const m=v===null?null:-v/u;
    const lit=v!==null&&v>0&&Math.abs(d-v)<.7;
    const size=m===null?'':Math.abs(Math.abs(m)-1)<.02?'等大':Math.abs(m)>1?'放大':'缩小';
    const nature=atFocus?'不成像':v<0?`正立 · ${size} · 虚像`:`倒立 · ${size} · 实像`;
    const zone=atFocus?'u = f':Math.abs(u-2*f)<.025?'u = 2f':u>2*f?'u > 2f':u>f?'f < u < 2f':'u < f';
    return {v,m,lit,nature,zone,atFocus,height:m===null?null:h*m};
  }
  set(key,value){if(['u','f','d'].includes(key))this[key]=Number(value);else this[key]=value;this.dispatchEvent(new Event('change'));}
  preset(ratio){this.u=this.f*ratio;this.dispatchEvent(new Event('change'));}
  focus(){const {v}=this.result;if(v!==null&&v>0&&v<=100){this.d=v;this.dispatchEvent(new Event('change'));}}
  reset(){this.u=30;this.f=10;this.d=15;this.rays=true;this.image=true;this.dispatchEvent(new Event('change'));}
  record(){this.records.push({u:this.u,f:this.f,d:this.d,...this.result});this.dispatchEvent(new Event('change'));}
}
export const fmt=value=>value===null?'∞':Number(value.toFixed(1)).toString();
export const icons={arrow:'<path d="M5 12h14m-5-5 5 5-5 5"/>',back:'<path d="M19 12H5m5-5-5 5 5 5"/>',reset:'<path d="M3 11a9 9 0 1 1 2 7M3 4v7h7"/>',expand:'<path d="M8 3H3v5m13-5h5v5M3 16v5h5m13-5v5h-5"/>',check:'<path d="m5 12 4 4L19 6"/>',rays:'<path d="m3 5 9 7 9-7M3 12h18M3 19l9-7 9 7"/>',cube:'<path d="m12 3 9 5v8l-9 5-9-5V8zm0 10v8M3 8l9 5 9-5M12 3v10"/>',book:'<path d="M4 4h7l1 2 1-2h7v15h-7l-1 2-1-2H4zM12 6v15"/>',plus:'<path d="M12 5v14M5 12h14"/>',eye:'<path d="M2 12s4-7 10-7 10 7 10 7-4 7-10 7S2 12 2 12Z"/><circle cx="12" cy="12" r="3"/>',sun:'<circle cx="12" cy="12" r="4"/><path d="M12 2v2m0 16v2M2 12h2m16 0h2M5 5l1 1m12 12 1 1M5 19l1-1M18 6l1-1"/>'};
export const icon=name=>`<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${icons[name]??icons.arrow}</svg>`;
