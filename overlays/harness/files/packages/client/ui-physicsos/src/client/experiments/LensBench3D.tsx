import { useEffect, useRef, useState } from 'react'
import * as THREE from 'three'
import { OrbitControls } from 'three/addons/controls/OrbitControls.js'
import { createLensThreeScene } from './lens-three-scene.ts'
import { lensBounds, lensParameter, type LensBenchProps } from './lens-bench.ts'
import css from './ExperimentPage.module.css'

export function LensBench3D(props: LensBenchProps & {onFallback:()=>void}) {
  const host=useRef<HTMLDivElement>(null)
  const latest=useRef(props);latest.current=props
  const refresh=useRef<(()=>void)|undefined>(undefined)
  const resetView=useRef<(()=>void)|undefined>(undefined)
  const [failed,setFailed]=useState(false)
  useEffect(()=>{
    const element=host.current
    if(element===null)return
    let renderer:THREE.WebGLRenderer
    try {renderer=new THREE.WebGLRenderer({antialias:true,alpha:true,powerPreference:'low-power'})}
    catch {setFailed(true);return}
    renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1,1.5));renderer.outputColorSpace=THREE.SRGBColorSpace
    renderer.toneMapping=THREE.ACESFilmicToneMapping;renderer.toneMappingExposure=1.35
    renderer.domElement.setAttribute('aria-label','可旋转的三维光具座');renderer.domElement.setAttribute('role','img')
    element.appendChild(renderer.domElement)
    const world=new THREE.Scene()
    world.add(new THREE.HemisphereLight(0xffffff,0xb2bdcf,2.6))
    const key=new THREE.DirectionalLight(0xfff9eb,3);key.position.set(-25,65,45);world.add(key)
    const fill=new THREE.DirectionalLight(0xd3e7ff,1.2);fill.position.set(35,20,-40);world.add(fill)
    const camera=new THREE.PerspectiveCamera(35,1,.1,2000)
    const bench=createLensThreeScene(latest.current.snapshot.view);world.add(bench.group)
    const controls=new OrbitControls(camera,renderer.domElement)
    controls.enableDamping=false;controls.enablePan=false;controls.minPolarAngle=.35;controls.maxPolarAngle=Math.PI*.48
    controls.minAzimuthAngle=-Math.PI*.38;controls.maxAzimuthAngle=Math.PI*.38;controls.minDistance=50;controls.maxDistance=550
    controls.touches.ONE=THREE.TOUCH.ROTATE;controls.touches.TWO=THREE.TOUCH.DOLLY_PAN
    let disposed=false;let frame:number|undefined
    const render=():void=>{
      if(disposed || document.hidden || frame!==undefined)return
      frame=requestAnimationFrame(()=>{frame=undefined;if(!disposed)renderer.render(world,camera)})
    }
    const home=():void=>{
      const bounds=lensBounds(latest.current.snapshot);const middle=(bounds.min+bounds.max)/2
      const distance=Math.max(115,(bounds.max-bounds.min+25)/(2*Math.tan(THREE.MathUtils.degToRad(17.5))*camera.aspect))
      controls.target.set(middle,-3,0);camera.position.set(middle+distance*.2,distance*.42,distance*.88);controls.update();render()
    }
    const resize=():void=>{
      const width=Math.max(1,element.clientWidth);const height=Math.max(1,element.clientHeight)
      camera.aspect=width/height;camera.updateProjectionMatrix();renderer.setSize(width,height,false);render()
    }
    resize();home();resetView.current=home
    const observer=new ResizeObserver(resize);observer.observe(element)
    controls.addEventListener('change',render)
    const visibility=():void=>{if(document.hidden && frame!==undefined){cancelAnimationFrame(frame);frame=undefined}else render()}
    document.addEventListener('visibilitychange',visibility)
    const raycaster=new THREE.Raycaster();const pointer=new THREE.Vector2();const plane=new THREE.Plane(new THREE.Vector3(0,0,1),0)
    let drag:{id:string;value:number;offset:number;pointerId:number}|undefined
    const hit=(event:PointerEvent):void=>{const rect=renderer.domElement.getBoundingClientRect();pointer.set((event.clientX-rect.left)/rect.width*2-1,-(event.clientY-rect.top)/rect.height*2+1);raycaster.setFromCamera(pointer,camera)}
    const down=(event:PointerEvent):void=>{
      if(event.button!==0 || drag!==undefined)return
      hit(event)
      let picked=raycaster.intersectObjects(bench.pickables,true)[0]?.object
      while(picked && typeof picked.userData.parameter!=='string')picked=picked.parent ?? undefined
      if(!picked)return
      const point=new THREE.Vector3();if(!raycaster.ray.intersectPlane(plane,point))return
      const id=String(picked.userData.parameter)
      drag={id,value:lensParameter(latest.current.snapshot,id),offset:point.x-picked.position.x,pointerId:event.pointerId}
      controls.enabled=false;event.stopImmediatePropagation();renderer.domElement.setPointerCapture(event.pointerId)
    }
    const move=(event:PointerEvent):void=>{
      if(!drag || event.pointerId!==drag.pointerId)return
      hit(event);const point=new THREE.Vector3();if(!raycaster.ray.intersectPlane(plane,point))return
      const x=point.x-drag.offset
      drag.value=Math.round(Math.max(1,Math.min(200,drag.id==='object-distance'?-x:x))*2)/2
      latest.current.preview(drag.id,drag.value)
    }
    const end=(event:PointerEvent):void=>{
      if(!drag || event.pointerId!==drag.pointerId)return
      const current=drag;drag=undefined;controls.enabled=true
      latest.current.commit(current.id,current.value)
    }
    const cancel=():void=>{if(!drag)return;drag=undefined;controls.enabled=true;latest.current.cancel()}
    const lost=(event:Event):void=>{event.preventDefault();cancel();setFailed(true)}
    renderer.domElement.addEventListener('pointerdown',down,true)
    renderer.domElement.addEventListener('pointermove',move)
    renderer.domElement.addEventListener('pointerup',end)
    renderer.domElement.addEventListener('pointercancel',cancel)
    renderer.domElement.addEventListener('lostpointercapture',cancel)
    renderer.domElement.addEventListener('webglcontextlost',lost)
    const escape=(event:KeyboardEvent):void=>{if(event.key==='Escape')cancel()}
    window.addEventListener('keydown',escape)
    refresh.current=()=>{bench.update(latest.current.snapshot.view);render()}
    render()
    return()=>{
      disposed=true;refresh.current=undefined;resetView.current=undefined
      if(frame!==undefined)cancelAnimationFrame(frame)
      if(drag)latest.current.cancel()
      observer.disconnect();document.removeEventListener('visibilitychange',visibility);window.removeEventListener('keydown',escape)
      renderer.domElement.removeEventListener('pointerdown',down,true);renderer.domElement.removeEventListener('pointermove',move);renderer.domElement.removeEventListener('pointerup',end)
      renderer.domElement.removeEventListener('pointercancel',cancel);renderer.domElement.removeEventListener('lostpointercapture',cancel);renderer.domElement.removeEventListener('webglcontextlost',lost)
      controls.removeEventListener('change',render);controls.dispose();bench.dispose();renderer.dispose();renderer.forceContextLoss();renderer.domElement.remove()
    }
  },[])
  useEffect(()=>{refresh.current?.()},[props.snapshot])
  return <div className={css.threeHost}>
    <div ref={host} style={{width:'100%',height:'100%',display:failed?'none':undefined}} />
    {failed?<div role="alert" className={css.threeStatus} style={{position:'absolute',inset:0}}><strong>当前设备暂时无法显示三维装置</strong><span>实验条件和记录已保留，可以继续用二维光路完成实验。</span><button type="button" className={css.subtleButton} onClick={props.onFallback}>返回二维光路</button></div>
      :<div className={css.threeControls}><button type="button" onClick={()=>{resetView.current?.()}}>视角回正</button></div>}
  </div>
}
