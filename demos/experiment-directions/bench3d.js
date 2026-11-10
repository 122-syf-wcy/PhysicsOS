import * as T from 'three';
import {OrbitControls} from './vendor/OrbitControls.js';
import {fmt} from './model.js';

export function mountBench(host,model,{dark=false,fixed=false}={}){
  const renderer=new T.WebGLRenderer({antialias:true,alpha:true,powerPreference:'high-performance'});
  renderer.setPixelRatio(Math.min(devicePixelRatio,1.6));renderer.setSize(host.clientWidth,host.clientHeight);
  renderer.shadowMap.enabled=true;renderer.shadowMap.type=T.PCFSoftShadowMap;
  renderer.outputColorSpace=T.SRGBColorSpace;renderer.toneMapping=T.ACESFilmicToneMapping;renderer.toneMappingExposure=dark?1.4:1.15;
  renderer.domElement.setAttribute('aria-label','可交互的凸透镜光具座');host.prepend(renderer.domElement);
  const scene=new T.Scene();scene.fog=new T.Fog(dark?0x0c1520:0xf0ece4,200,500);
  const camera=new T.PerspectiveCamera(34,host.clientWidth/host.clientHeight,.1,600);
  const controls=new OrbitControls(camera,renderer.domElement);controls.enableDamping=true;controls.dampingFactor=.08;controls.enablePan=false;
  controls.minDistance=65;controls.maxDistance=240;controls.minPolarAngle=.55;controls.maxPolarAngle=1.5;
  controls.minAzimuthAngle=-.85;controls.maxAzimuthAngle=.85;controls.enableRotate=!fixed;controls.enableZoom=!fixed;
  function home(){const width=host.clientWidth;const narrow=width<550;controls.target.set(-4,-3,0);camera.position.set(narrow?-105:fixed?-78:-68,fixed?42:46,narrow?220:fixed?115:125);controls.update();}
  home();
  scene.add(new T.HemisphereLight(dark?0x799fd3:0xffffff,dark?0x080b13:0x9d8e7c,dark?1.2:2.2));
  const key=new T.DirectionalLight(dark?0xb5d8ff:0xffefda,dark?4.5:4);key.position.set(-40,75,60);key.castShadow=true;
  key.shadow.mapSize.set(2048,2048);Object.assign(key.shadow.camera,{left:-80,right:80,top:60,bottom:-70,near:1,far:220});key.shadow.bias=-.0002;key.shadow.normalBias=.05;scene.add(key);
  const rim=new T.DirectionalLight(dark?0x36d9dd:0xffffff,dark?4:1.6);rim.position.set(50,35,-40);scene.add(rim);
  const warm=new T.PointLight(0xff963f,dark?100:25,60,1.5);warm.position.set(-30,8,3);scene.add(warm);
  const ground=new T.Mesh(new T.PlaneGeometry(650,650),new T.MeshStandardMaterial({color:dark?0x0b1520:0xd9cbb5,roughness:.86,metalness:dark?.18:0}));ground.rotation.x=-Math.PI/2;ground.position.y=-13;ground.receiveShadow=true;scene.add(ground);
  if(!dark){
    ground.material.dispose(); ground.material=new T.ShadowMaterial({opacity:.18});
    const canvas=document.createElement('canvas');canvas.width=1024;canvas.height=1024;const ctx=canvas.getContext('2d');
    ctx.fillStyle='#ded0b7';ctx.fillRect(0,0,1024,1024);let seed=12;const random=()=>{seed=(seed*16807)%2147483647;return (seed-1)/2147483646};
    for(let i=0;i<2100;i++){const y=random()*1024;ctx.strokeStyle=`rgba(126,96,58,${random()*.075})`;ctx.lineWidth=random()*1.6+.1;ctx.beginPath();ctx.moveTo(0,y);ctx.bezierCurveTo(350,y+random()*10,650,y-random()*10,1024,y+random()*8);ctx.stroke();}
    const tex=new T.CanvasTexture(canvas);tex.colorSpace=T.SRGBColorSpace;tex.wrapS=tex.wrapT=T.RepeatWrapping;tex.repeat.set(5,5);tex.dispose();
  }
  const assembly=new T.Group();scene.add(assembly);
  const mat=(color,metal=.0,rough=.45)=>new T.MeshStandardMaterial({color,metalness:metal,roughness:rough});
  const metal=mat(dark?0x43566a:0x88949e,.85,.23),black=mat(dark?0x1d2a38:0x303c46,.45,.32),cream=mat(0xf7f0dd,0,.66),blue=mat(dark?0x3c8193:0x517d8a,.45,.35);
  const geometries=new Set(),materials=new Set();
  function mesh(parent,g,m,x=0,y=0,z=0){geometries.add(g);materials.add(m);const a=new T.Mesh(g,m);a.position.set(x,y,z);a.castShadow=true;a.receiveShadow=true;parent.add(a);return a;}
  function box(parent,w,h,d,m,x,y,z){return mesh(parent,new T.BoxGeometry(w,h,d),m,x,y,z);}
  function cyl(parent,r,h,m,x,y,z){return mesh(parent,new T.CylinderGeometry(r,r,h,32),m,x,y,z);}
  function stand(parent,color){box(parent,7,1.7,9,color,0,-10.7,0);box(parent,5,.4,7,metal,0,-9.7,0);cyl(parent,.42,10,metal,0,-4.5,0);const knob=cyl(parent,.8,1,black,2,-8,0);knob.rotation.z=Math.PI/2;}
  box(assembly,112,1.5,14,black,0,-12,0);for(const z of [-3.8,3.8])box(assembly,110,.9,1.1,metal,0,-10.8,z);
  for(const x of [-45,45])for(const z of [-4,4])cyl(assembly,1.8,1.2,black,x,-12.8,z);
  const rulerCanvas=document.createElement('canvas');rulerCanvas.width=2048;rulerCanvas.height=128;const rc=rulerCanvas.getContext('2d');rc.fillStyle=dark?'#a7b5c3':'#e5e8e8';rc.fillRect(0,0,2048,128);rc.fillStyle='#34434d';
  for(let i=0;i<=110;i++){let x=i/110*2048;rc.fillRect(x,0,i%10===0?3:1.5,i%10===0?53:i%5===0?38:21);if(i%10===0){rc.font='30px monospace';rc.textAlign='center';rc.fillText(String(i-55),x,100);}}
  const rulerTexture=new T.CanvasTexture(rulerCanvas);rulerTexture.colorSpace=T.SRGBColorSpace;
  const ruler=mesh(assembly,new T.PlaneGeometry(110,3),new T.MeshStandardMaterial({map:rulerTexture,roughness:.7}),0,-10.7,7);ruler.rotation.x=-Math.PI/2;
  const object=new T.Group();object.userData.id='u';scene.add(object);stand(object,blue);
  box(object,2,1,2,black,0,-.2,0);cyl(object,.72,5.6,cream,0,2.8,0);cyl(object,.07,.5,black,0,5.7,0);
  const flame=mesh(object,new T.SphereGeometry(.65,24,16),new T.MeshBasicMaterial({color:0xffbd5a}),0,6.15,0);flame.scale.set(.62,1.5,.62);
  const inner=mesh(object,new T.SphereGeometry(.32,16,12),new T.MeshBasicMaterial({color:0xfff0b7}),0,6.0,.28);inner.scale.set(.7,1.5,.7);
  const lens=new T.Group();scene.add(lens);stand(lens,black);
  const ring=mesh(lens,new T.TorusGeometry(9,.42,20,96),metal);ring.rotation.y=Math.PI/2;
  const glassmat=new T.MeshPhysicalMaterial({color:dark?0x8acadd:0xb6d9e0,metalness:0,roughness:.035,transmission:.72,thickness:1.3,ior:1.5,transparent:true,opacity:.58,side:T.DoubleSide,clearcoat:1,depthWrite:false});
  const glass=mesh(lens,new T.SphereGeometry(9,64,40),glassmat);glass.scale.set(.13,1,1);glass.castShadow=false;
  const trim=mesh(lens,new T.TorusGeometry(8.65,.055,8,96),new T.MeshBasicMaterial({color:dark?0x9bf4ec:0xd4eef2,transparent:true,opacity:.8}));trim.rotation.y=Math.PI/2;
  const screen=new T.Group();screen.userData.id='d';scene.add(screen);stand(screen,black);
  box(screen,.7,20,17,metal,0,0,0);const paper=box(screen,.76,19.2,16.2,mat(0xf9f7f0,0,.9),-.05,0,0);paper.receiveShadow=false;
  const screenCanvas=document.createElement('canvas');screenCanvas.width=512;screenCanvas.height=640;const sc=screenCanvas.getContext('2d');const screenTexture=new T.CanvasTexture(screenCanvas);screenTexture.colorSpace=T.SRGBColorSpace;
  const projectionPlane=mesh(screen,new T.PlaneGeometry(16.2,19.2),new T.MeshBasicMaterial({map:screenTexture,side:T.DoubleSide}),-.45,0,0);projectionPlane.rotation.y=-Math.PI/2;
  let raysGroup=new T.Group();scene.add(raysGroup);let imageGroup=new T.Group();scene.add(imageGroup);
  const liveResources=[];
  function clearDynamic(group){group.traverse(a=>{a.geometry?.dispose();if(a.material){for(const m of Array.isArray(a.material)?a.material:[a.material])m.dispose();}});group.clear();}
  const colors=dark?[0xffbd68,0x6ee5ed,0xc9a0ff]:[0xd19032,0x478b9b,0x8b73b1];
  function segment(a,b,color,dashed=false){
    const va=new T.Vector3(...a),vb=new T.Vector3(...b);const distance=va.distanceTo(vb);if(distance<.001)return;
    if(dashed){const line=new T.Line(new T.BufferGeometry().setFromPoints([va,vb]),new T.LineDashedMaterial({color,dashSize:1.1,gapSize:.7,transparent:true,opacity:.48}));line.computeLineDistances();raysGroup.add(line);return;}
    const m=new T.MeshBasicMaterial({color,transparent:true,opacity:dark?.9:.82,depthTest:false});const ray=new T.Mesh(new T.CylinderGeometry(dark?.075:.06,dark?.075:.06,distance,8),m);ray.position.copy(va).add(vb).multiplyScalar(.5);ray.quaternion.setFromUnitVectors(new T.Vector3(0,1,0),vb.sub(va).normalize());ray.renderOrder=2;raysGroup.add(ray);
  }
  function update(){
    const {u,d,h,f}=model;const r=model.result;object.position.x=-u;screen.position.x=d;warm.position.x=-u;
    clearDynamic(raysGroup);clearDynamic(imageGroup);
    if(model.rays){
      const end=Math.min(d,75);const ys=[h,0,-h*f/(u-f || .001)];
      const lensYs=[h,0,u>f+1? -h*f/(u-f):h*.45];
      lensYs.forEach((ly,i)=>{const slope=i===0?-h/f:i===1?-h/u:((ly-h)/u-ly/f);
        segment([-u,h,0],[0,ly,0],colors[i]);const endY=ly+slope*end;segment([0,ly,0],[end,endY,0],colors[i]);
        if(r.v!==null&&r.v<0&&r.v>-120)segment([0,ly,0],[r.v,r.height,0],colors[i],true);
      });
    }
    if(model.image&&r.v!==null&&Math.abs(r.v)<120&&Math.abs(r.height)<55){
      const points=[new T.Vector3(r.v,0,1),new T.Vector3(r.v,r.height,1)];const line=new T.Line(new T.BufferGeometry().setFromPoints(points),new T.LineDashedMaterial({color:dark?0x9cdcc9:0x369086,dashSize:r.v<0?.6:100,gapSize:.5,depthTest:false,transparent:true,opacity:.8}));line.computeLineDistances();imageGroup.add(line);
      const head=new T.Mesh(new T.ConeGeometry(.5,1.2,16),new T.MeshBasicMaterial({color:dark?0x9cdcc9:0x369086,depthTest:false}));head.position.set(r.v,r.height,1);if(r.height<0)head.rotation.z=Math.PI;imageGroup.add(head);
    }
    sc.fillStyle=dark?'#e5e8df':'#faf8f0';sc.fillRect(0,0,512,640);
    if(r.v!==null&&r.v>0){const offset=Math.abs(d-r.v);const blur=Math.min(45,offset*3);sc.save();sc.filter=`blur(${blur}px)`;sc.globalAlpha=Math.max(.08,1-offset/35);
      const ph=Math.min(280,Math.abs(r.height)*28);sc.translate(256,320);sc.rotate(Math.PI);sc.fillStyle='#bb8c51';sc.fillRect(-12,0,24,-ph*.85);sc.beginPath();sc.ellipse(0,-ph*.94,11,ph*.1,0,0,Math.PI*2);sc.fillStyle='#ed9d3b';sc.fill();sc.restore();}
    screenTexture.needsUpdate=true;
    host.querySelectorAll('[data-part]').forEach(el=>{const key=el.dataset.part;el.innerHTML=key==='object'?`物体 <b>${fmt(u)} cm</b>`:key==='lens'?`凸透镜 <b>f = ${fmt(f)} cm</b>`:`光屏 <b>${fmt(d)} cm</b>`;});
  }
  for(const part of ['object','lens','screen']){const el=document.createElement('div');el.className='part-label';el.dataset.part=part;host.append(el);}
  const labelPosition=(name,obj,y)=>{const el=host.querySelector(`[data-part="${name}"]`);const v=new T.Vector3(obj.position.x,y,0).project(camera);el.style.left=`${(v.x*.5+.5)*host.clientWidth}px`;el.style.top=`${(-v.y*.5+.5)*host.clientHeight}px`;};
  const raycaster=new T.Raycaster();const point=new T.Vector2();const plane=new T.Plane(new T.Vector3(0,0,1),0);let drag=null;
  function hit(e){const b=renderer.domElement.getBoundingClientRect();point.set((e.clientX-b.left)/b.width*2-1,-(e.clientY-b.top)/b.height*2+1);raycaster.setFromCamera(point,camera);}
  const down=e=>{if(e.button!==0)return;hit(e);let hitObject=raycaster.intersectObjects([object,screen],true)[0]?.object;while(hitObject&&!hitObject.userData.id)hitObject=hitObject.parent;if(!hitObject)return;
    const p=new T.Vector3();if(!raycaster.ray.intersectPlane(plane,p))return;drag={id:hitObject.userData.id,offset:p.x-hitObject.position.x};controls.enabled=false;renderer.domElement.setPointerCapture(e.pointerId);e.stopImmediatePropagation();host.classList.add('dragging');};
  renderer.domElement.addEventListener('pointerdown',down,true);
  renderer.domElement.addEventListener('pointermove',e=>{hit(e);if(drag){const p=new T.Vector3();if(raycaster.ray.intersectPlane(plane,p)){const x=p.x-drag.offset;model.set(drag.id,Math.round(Math.max(5,Math.min(drag.id==='u'?60:80,drag.id==='u'?-x:x))*2)/2);}}else{renderer.domElement.style.cursor=raycaster.intersectObjects([object,screen],true).length?'ew-resize':fixed?'default':'grab';}});
  const release=()=>{drag=null;controls.enabled=true;host.classList.remove('dragging');};for(const event of ['pointerup','pointercancel','lostpointercapture'])renderer.domElement.addEventListener(event,release);
  const observer=new ResizeObserver(()=>{camera.aspect=host.clientWidth/host.clientHeight;camera.updateProjectionMatrix();renderer.setSize(host.clientWidth,host.clientHeight);home();});observer.observe(host);
  update();model.addEventListener('change',update);let active=true,last=0;
  function frame(time){if(!active)return;requestAnimationFrame(frame);if(document.hidden||time-last<28)return;last=time;controls.update();flame.scale.y=1.5+Math.sin(time*.007)*.06;renderer.render(scene,camera);labelPosition('object',object,13);labelPosition('lens',lens,15);labelPosition('screen',screen,15);const lensLabel=host.querySelector('[data-part="lens"]'),screenLabel=host.querySelector('[data-part="screen"]');if(Math.abs(parseFloat(lensLabel.style.left)-parseFloat(screenLabel.style.left))<95){screenLabel.style.top=(parseFloat(screenLabel.style.top)-42)+'px';}}
  requestAnimationFrame(frame);
  return {home,dispose(){active=false;observer.disconnect();model.removeEventListener('change',update);controls.dispose();clearDynamic(raysGroup);clearDynamic(imageGroup);for(const g of geometries)g.dispose();for(const m of materials)m.dispose();rulerTexture.dispose();screenTexture.dispose();renderer.dispose();renderer.forceContextLoss();host.replaceChildren();}};
}
