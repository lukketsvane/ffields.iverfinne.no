"use client";
import {useEffect,useImperativeHandle,useRef,useState,forwardRef} from 'react';
import * as THREE from 'three';
import {OrbitControls} from 'three/addons/controls/OrbitControls.js';
import {GLTFLoader} from 'three/addons/loaders/GLTFLoader.js';
import {assetDefinition} from '@/lib/assets';
import {toast} from 'sonner';
import {RoomEnvironment} from 'three/addons/environments/RoomEnvironment.js';
import {FormModel,MeshData,generateMesh,evaluateBase,fieldStrength,sectionContours,clamp,withoutRipples} from '@/lib/form-engine';
import {Appearance,PALETTES} from '@/lib/appearance';
import {TouchSession} from '@/lib/touch-session';
import {createRippleMaterial} from '@/lib/ripple-material';
import {cameraParts} from './camera-parts';
import {resizeWorkspaceProjection,syncOrthographicCamera} from '@/lib/workspace-camera';
export type ViewMode='solid'|'field'|'section'|'silhouette';
export type ViewportRef={capture:()=>string|undefined;reset:()=>void;setView:(v:'front'|'top'|'perspective')=>void;phase:()=>number};
type Props={model:FormModel;view:ViewMode;selected:string;handles:boolean;section:number;components:boolean;wireframe:boolean;appearance:Appearance;editing:boolean;playing:boolean;canvasColor:string|null;onSelect:(id:string,inspect?:boolean)=>void;onDrag:(id:string,x:number,y:number,z:number)=>void;onStart:()=>void;onEnd:()=>void;onUndo:()=>void;onMetrics:(mesh:MeshData)=>void};
type Job={id:number;model:FormModel;resolution:number};
type Runtime={renderer:THREE.WebGLRenderer;scene:THREE.Scene;camera:THREE.PerspectiveCamera;ortho:THREE.OrthographicCamera;controls:OrbitControls;body:THREE.Mesh;actors:THREE.Group;fields:THREE.Group;sectionGroup:THREE.Group;ground:THREE.Group;imports:THREE.Group;instances:Map<string,THREE.Group>;worker?:Worker;data?:MeshData;request:number;inFlight:boolean;touching:boolean;pending?:Job;apply:(data:MeshData)=>void;invalidate:()=>void;fit:(view?:'front'|'top'|'perspective')=>void;submit:(job:Job)=>void;quality:(active:boolean)=>void;phase:()=>number;syncRipple:()=>void;syncCamera:()=>void;syncSection:()=>void};
const isFlat=(view:ViewMode)=>view==='section'||view==='silhouette';
export const Viewport=forwardRef<ViewportRef,Props>(function Viewport(props,ref){
 const mount=useRef<HTMLDivElement>(null),latest=useRef(props),runtime=useRef<Runtime|null>(null);latest.current=props;
 const [error,setError]=useState(''),[busy,setBusy]=useState(true),[assetRetry,setAssetRetry]=useState(0);
 useEffect(()=>{const retry=()=>setAssetRetry(n=>n+1);window.addEventListener('online',retry);return()=>window.removeEventListener('online',retry)},[]);
 useImperativeHandle(ref,()=>({capture:()=>{const r=runtime.current;if(!r)return;r.syncRipple();r.syncCamera();r.renderer.render(r.scene,isFlat(latest.current.view)?r.ortho:r.camera);return r.renderer.domElement.toDataURL('image/png')},reset:()=>runtime.current?.fit(),setView:v=>runtime.current?.fit(v),phase:()=>runtime.current?.phase()??latest.current.model.influences.find(f=>f.kind==='wave')?.phase??0}),[]);
 useEffect(()=>{
  const el=mount.current;if(!el)return;let renderer:THREE.WebGLRenderer;
  try{renderer=new THREE.WebGLRenderer({antialias:true,alpha:false,preserveDrawingBuffer:true})}catch{setError('3D is unavailable. Parameters and mesh export still work.');setBusy(false);return}
  const mobile=matchMedia('(pointer: coarse)').matches;
  const mobileLayout=matchMedia('(max-width:760px), (max-width:960px) and (max-height:520px) and (pointer:coarse)');
  renderer.setPixelRatio(Math.min(window.devicePixelRatio,2));renderer.setClearColor(latest.current.canvasColor??PALETTES[latest.current.appearance].canvas);renderer.shadowMap.enabled=true;renderer.shadowMap.type=THREE.PCFSoftShadowMap;renderer.toneMapping=THREE.ACESFilmicToneMapping;renderer.toneMappingExposure=.9;el.appendChild(renderer.domElement);
  const scene=new THREE.Scene(),camera=new THREE.PerspectiveCamera(30,1,.5,6000),ortho=new THREE.OrthographicCamera(-130,130,95,-95,.1,2000);
  camera.position.set(198,108,255);ortho.position.set(0,0,500);ortho.lookAt(0,0,0);
  const controls=new OrbitControls(camera,renderer.domElement);controls.enableDamping=true;controls.dampingFactor=.12;controls.minDistance=45;controls.maxDistance=3000;controls.enablePan=true;
  const pmrem=new THREE.PMREMGenerator(renderer),room=new RoomEnvironment(),env=pmrem.fromScene(room).texture;scene.environment=env;scene.environmentIntensity=.4;room.dispose();pmrem.dispose();
  scene.add(new THREE.HemisphereLight(0xffffff,0x35353b,.5));const key=new THREE.DirectionalLight(0xffffff,1.8);key.position.set(-160,240,190);key.castShadow=true;key.shadow.mapSize.set(mobile?1024:2048,mobile?1024:2048);key.shadow.camera.left=-250;key.shadow.camera.right=250;key.shadow.camera.top=200;key.shadow.camera.bottom=-200;key.shadow.normalBias=.25;key.shadow.bias=-.00015;key.shadow.radius=4;scene.add(key);
  const rim=new THREE.DirectionalLight(0xe5ebff,1);rim.position.set(130,90,-160);scene.add(rim);
  const body=new THREE.Mesh(new THREE.BufferGeometry(),new THREE.MeshStandardMaterial({color:PALETTES[latest.current.appearance].clay,roughness:.58,metalness:.06}));body.castShadow=true;body.receiveShadow=false;body.frustumCulled=false;scene.add(body);
  const depthMaterial=new THREE.MeshDepthMaterial({depthPacking:THREE.RGBADepthPacking});body.customDepthMaterial=depthMaterial;const updateRipple=createRippleMaterial(body.material as THREE.MeshStandardMaterial,depthMaterial);
  let playing=false,phaseStarted=0;
  // Stored Phase remains an editable offset; other model edits never reset elapsed playback.
  const phase=()=>((latest.current.model.influences.find(f=>f.kind==='wave')?.phase??0)+(playing?(performance.now()-phaseStarted)*.045:0))%360;
  const syncRipple=()=>{if(latest.current.playing&&!playing)phaseStarted=performance.now();playing=latest.current.playing;updateRipple(latest.current.model,phase())};
  const actors=new THREE.Group(),fields=new THREE.Group(),sectionGroup=new THREE.Group(),ground=new THREE.Group(),imports=new THREE.Group();scene.add(actors,fields,sectionGroup,ground,imports);
  let sectionLines:THREE.LineSegments<THREE.BufferGeometry,THREE.LineBasicMaterial>|undefined,sectionAppearance:Appearance|undefined,lastSectionFrame=-Infinity;
  const syncSection=()=>{
   const p=latest.current;
   if(p.view!=='section'){if(sectionLines){clearGroup(sectionGroup);sectionLines=undefined}return}
   if(!sectionLines||sectionAppearance!==p.appearance){
    clearGroup(sectionGroup);sectionAppearance=p.appearance;lastSectionFrame=-Infinity;
    sectionLines=new THREE.LineSegments(new THREE.BufferGeometry(),new THREE.LineBasicMaterial({color:PALETTES[p.appearance].handle}));sectionGroup.add(sectionLines);
    const grid=new THREE.GridHelper(600,30,PALETTES[p.appearance].grid,PALETTES[p.appearance].grid);grid.rotation.x=Math.PI/2;grid.position.z=-1;(grid.material as THREE.Material).transparent=true;(grid.material as THREE.Material).opacity=.14;sectionGroup.add(grid)
   }
   const now=performance.now();if(p.playing&&now-lastSectionFrame<100)return;lastSectionFrame=now;
   const wave=p.model.influences.find(f=>f.kind==='wave'),model=p.playing&&wave?{...p.model,influences:p.model.influences.map(f=>f===wave?{...f,phase:phase()}:f)}:p.model;
   const resolution=p.playing?(mobileLayout.matches?56:80):p.editing?80:mobileLayout.matches?100:160;
   const contours=sectionContours(model,p.section,resolution),points:number[]=[];
   for(const s of contours.segments)points.push(s[0],s[1],0,s[2],s[3],0);
   sectionLines.geometry.dispose();sectionLines.geometry=new THREE.BufferGeometry().setAttribute('position',new THREE.Float32BufferAttribute(points,3))
  };
  const plane=new THREE.Mesh(new THREE.PlaneGeometry(800,800),new THREE.ShadowMaterial({opacity:.19}));plane.rotation.x=-Math.PI/2;plane.position.y=-57;plane.receiveShadow=true;ground.add(plane);
  let frame=0,disposed=false,fitted=false,qualityTimer:ReturnType<typeof setTimeout>|undefined,renderRatio=Math.min(window.devicePixelRatio,2);
  const activeCamera=()=>isFlat(latest.current.view)?ortho:camera;
  const draw=()=>{frame=0;if(disposed||document.hidden)return;syncRipple();if(latest.current.view==='section'&&latest.current.playing)syncSection();const moving=controls.enabled&&controls.update();renderer.render(scene,activeCamera());if(moving||latest.current.playing)invalidate()};
  const invalidate=()=>{if(!frame&&!disposed&&!document.hidden)frame=requestAnimationFrame(draw)};
  const quality=(active:boolean)=>{if(qualityTimer)clearTimeout(qualityTimer);const set=(ratio:number)=>{const nextRatio=Math.min(window.devicePixelRatio,ratio);if(disposed||nextRatio===renderRatio)return;renderRatio=nextRatio;renderer.setPixelRatio(nextRatio);renderer.setSize(el.clientWidth,el.clientHeight);invalidate()};if(active||latest.current.playing)set(mobile?1.25:1.5);else qualityTimer=setTimeout(()=>set(2),160)};const navigationStart=()=>quality(true),navigationEnd=()=>quality(false);controls.addEventListener('change',invalidate);controls.addEventListener('start',navigationStart);controls.addEventListener('end',navigationEnd);
  const dimensions=()=>{const b=rt.data?.bounds,box=b&&rt.data?.indices.length?new THREE.Box3(new THREE.Vector3(b[0],b[1],b[2]),new THREE.Vector3(b[3],b[4],b[5])):new THREE.Box3(new THREE.Vector3(-latest.current.model.width/2,-latest.current.model.height/2,-latest.current.model.depth/2),new THREE.Vector3(latest.current.model.width/2,latest.current.model.height/2,latest.current.model.depth/2));for(const object of rt.imports.children){if(object.visible&&object.children.length)box.union(new THREE.Box3().setFromObject(object))}return {half:box.getSize(new THREE.Vector3()).multiplyScalar(.5),center:box.getCenter(new THREE.Vector3())}};
  const fitDistance=(direction=camera.position.clone().sub(controls.target),aspect=camera.aspect)=>{const half=dimensions().half,forward=direction.clone().normalize(),right=new THREE.Vector3().crossVectors(Math.abs(forward.y)>.99999?new THREE.Vector3(0,0,1):new THREE.Vector3(0,1,0),forward).normalize(),up=new THREE.Vector3().crossVectors(forward,right);const projected=(axis:THREE.Vector3)=>Math.abs(axis.x)*half.x+Math.abs(axis.y)*half.y+Math.abs(axis.z)*half.z;const tan=Math.tan(THREE.MathUtils.degToRad(camera.fov/2));return (Math.max(projected(right)/(tan*aspect),projected(up)/tan)+projected(forward))*1.2};
  const syncCamera=()=>syncOrthographicCamera(camera,ortho,controls.target);
  const fit=(view?:'front'|'top'|'perspective')=>{const d=dimensions(),direction=new THREE.Vector3(...(view==='front'?[0,0,1]:view==='top'?[0,1,.0001]:[.34,.22,1])as [number,number,number]);controls.target.copy(d.center);camera.position.copy(d.center).add(direction.normalize().multiplyScalar(fitDistance(direction)));controls.update();syncCamera();invalidate()};
  const resize=()=>{
   const w=el.clientWidth,h=el.clientHeight;if(!w||!h)return;
   renderer.setSize(w,h);
   resizeWorkspaceProjection(camera,ortho,controls.target,w,h,mobileLayout.matches);
   invalidate()
  };
  const apply=(data:MeshData)=>{if(disposed)return;plane.position.y=data.bounds[1]-.8;const geometry=new THREE.BufferGeometry();geometry.setAttribute('position',new THREE.BufferAttribute(data.positions,3));geometry.setAttribute('normal',new THREE.BufferAttribute(data.normals,3));geometry.setIndex(new THREE.BufferAttribute(data.indices,1));geometry.computeBoundingSphere();body.geometry.dispose();body.geometry=geometry;rt.data=data;styleBody(rt,latest.current);setBusy(false);setError(data.indices.length?'':'These fields leave no solid. Reduce the pinch or restore a variant.');latest.current.onMetrics(data);if(!fitted&&data.indices.length){fitted=true;resize();fit()}invalidate()};
  const submit=(job:Job)=>{if(document.hidden){rt.pending=job;return}if(rt.worker){if(rt.inFlight)rt.pending=job;else{rt.inFlight=true;rt.worker.postMessage(job)}}else apply(generateMesh(job.model,Math.min(job.resolution,112)))};
  const rt:Runtime={renderer,scene,camera,ortho,controls,body,actors,fields,sectionGroup,ground,imports,instances:new Map(),request:0,inFlight:false,touching:false,apply,invalidate,fit,submit,quality,phase,syncRipple,syncCamera,syncSection};runtime.current=rt;
  const observer=new ResizeObserver(resize);observer.observe(el);resize();
  // Touch has one owner. OrbitControls continues to own mouse navigation only.
  const session=new TouchSession(),raycaster=new THREE.Raycaster(),pointer=new THREE.Vector2(),dragPlane=new THREE.Plane(),world=new THREE.Vector3(),dragOffset=new THREE.Vector3();
  let held=false,mouseMoved=false;let drag:{id:string;pointerId:number;started:boolean}|null=null,mouseFlat:{x:number;y:number}|null=null,origin:{x:number;y:number}|null=null,hold:ReturnType<typeof setTimeout>|undefined;
  const ray=(x:number,y:number)=>{const rect=renderer.domElement.getBoundingClientRect();pointer.set((x-rect.left)/rect.width*2-1,-(y-rect.top)/rect.height*2+1);raycaster.setFromCamera(pointer,activeCamera())};
  const hitField=(x:number,y:number)=>{if(!latest.current.handles||isFlat(latest.current.view))return;const rect=renderer.domElement.getBoundingClientRect();let nearest:FormModel['influences'][number]|undefined,distance=24;for(const f of latest.current.model.influences){if(!f.enabled||(f.id!==latest.current.selected&&latest.current.view!=='field'))continue;const p=new THREE.Vector3(f.x,f.y,f.z+2).project(camera),dx=(p.x+1)*rect.width/2+rect.left-x,dy=(-p.y+1)*rect.height/2+rect.top-y,d=Math.hypot(dx,dy);if(p.z<1&&d<distance){distance=d;nearest=f}}return nearest};
  const prepareDrag=(e:PointerEvent)=>{const f=hitField(e.clientX,e.clientY);if(!f)return false;ray(e.clientX,e.clientY);dragPlane.setFromNormalAndCoplanarPoint(camera.getWorldDirection(new THREE.Vector3()),new THREE.Vector3(f.x,f.y,f.z));if(!raycaster.ray.intersectPlane(dragPlane,world))return false;dragOffset.set(f.x,f.y,f.z).sub(world);drag={id:f.id,pointerId:e.pointerId,started:false};return true};
  const finishDrag=()=>{if(drag?.started)latest.current.onEnd();drag=null;controls.enabled=!isFlat(latest.current.view)&&!rt.touching;invalidate()};
  const moveDrag=(e:PointerEvent)=>{if(!drag||drag.pointerId!==e.pointerId)return;ray(e.clientX,e.clientY);if(!raycaster.ray.intersectPlane(dragPlane,world))return;if(!drag.started){drag.started=true;latest.current.onSelect(drag.id,false);latest.current.onStart();session.consume()}world.add(dragOffset);latest.current.onDrag(drag.id,clamp(world.x,-120,120),clamp(world.y,-65,65),clamp(world.z,-70,70))};
  const clearHold=()=>{if(hold)clearTimeout(hold);hold=undefined};
  const pan=(dx:number,dy:number)=>{const c=activeCamera(),scale=isFlat(latest.current.view)?(ortho.top-ortho.bottom)/el.clientHeight:2*camera.position.distanceTo(controls.target)*Math.tan(THREE.MathUtils.degToRad(camera.fov/2))/el.clientHeight;const delta=new THREE.Vector3().setFromMatrixColumn(c.matrix,0).multiplyScalar(-dx*scale).add(new THREE.Vector3().setFromMatrixColumn(c.matrix,1).multiplyScalar(dy*scale));camera.position.add(delta);controls.target.add(delta);controls.update();syncCamera();invalidate()};
  const zoom=(factor:number)=>{if(!Number.isFinite(factor)||factor<=0)return;const offset=camera.position.clone().sub(controls.target),distance=clamp(offset.length()/factor,controls.minDistance,controls.maxDistance);camera.position.copy(controls.target).add(offset.setLength(distance));controls.update();syncCamera();invalidate()};
  const orbit=(dx:number,dy:number)=>{const offset=camera.position.clone().sub(controls.target),spherical=new THREE.Spherical().setFromVector3(offset);spherical.theta-=dx/el.clientHeight*Math.PI*2;spherical.phi-=dy/el.clientHeight*Math.PI*2;spherical.makeSafe();camera.position.copy(controls.target).add(new THREE.Vector3().setFromSpherical(spherical));controls.update();invalidate()};
  const inspect=(x:number,y:number)=>{if(document.activeElement instanceof HTMLInputElement)document.activeElement.blur();const f=hitField(x,y);if(f){latest.current.onSelect(f.id,true);return}ray(x,y);const assetHit=raycaster.intersectObjects(imports.children.filter(o=>o.visible),true).find(h=>h.object.userData.assetId);if(assetHit){latest.current.onSelect(assetHit.object.userData.assetId,true);return}if(raycaster.intersectObject(body).length)latest.current.onSelect('body',true)};
  const tap=(e:PointerEvent)=>inspect(e.clientX,e.clientY);
  const down=(e:PointerEvent)=>{if(e.pointerType==='touch'){e.stopImmediatePropagation();e.preventDefault();rt.touching=true;quality(true);controls.enabled=false;session.down({id:e.pointerId,x:e.clientX,y:e.clientY},performance.now());renderer.domElement.setPointerCapture(e.pointerId);if(session.points.size===1){held=false;origin={x:e.clientX,y:e.clientY};prepareDrag(e);clearHold();hold=setTimeout(()=>{if(session.points.size===1){held=true;session.consume();finishDrag();inspect(e.clientX,e.clientY)}},520)}else{held=false;clearHold();finishDrag()}return}if(e.button!==0)return;mouseMoved=false;origin={x:e.clientX,y:e.clientY};if(prepareDrag(e)||isFlat(latest.current.view)){controls.enabled=false;mouseFlat=isFlat(latest.current.view)?{x:e.clientX,y:e.clientY}:null;renderer.domElement.setPointerCapture(e.pointerId);e.stopImmediatePropagation();e.preventDefault()}};
  const move=(e:PointerEvent)=>{if(e.pointerType==='touch'){if(!session.points.has(e.pointerId))return;e.stopImmediatePropagation();e.preventDefault();if(held)return;const previous=session.snapshot();session.move({id:e.pointerId,x:e.clientX,y:e.clientY});const next=session.snapshot(),moved=origin&&Math.hypot(e.clientX-origin.x,e.clientY-origin.y)>6;if(moved)clearHold();if(next.count===2){const dx=next.x-previous.x,dy=next.y-previous.y;pan(dx,dy);if(previous.distance>0)zoom(next.distance/previous.distance)}else if(next.count===1&&previous.count===1&&!session.multiple){if(drag){if(moved)moveDrag(e)}else if(moved){session.consume();isFlat(latest.current.view)?pan(next.x-previous.x,next.y-previous.y):orbit(next.x-previous.x,next.y-previous.y)}}return}if(origin&&Math.hypot(e.clientX-origin.x,e.clientY-origin.y)>4)mouseMoved=true;if(drag&&drag.pointerId===e.pointerId&&origin&&Math.hypot(e.clientX-origin.x,e.clientY-origin.y)>3){moveDrag(e);e.preventDefault()}else if(mouseFlat){pan(e.clientX-mouseFlat.x,e.clientY-mouseFlat.y);mouseFlat={x:e.clientX,y:e.clientY}}};
  const up=(e:PointerEvent)=>{if(e.pointerType==='touch'){if(!session.points.has(e.pointerId))return;e.stopImmediatePropagation();e.preventDefault();clearHold();session.move({id:e.pointerId,x:e.clientX,y:e.clientY});if(drag?.pointerId===e.pointerId)finishDrag();const action=session.up(e.pointerId,performance.now(),e.type==='pointercancel'||e.type==='lostpointercapture');if(action==='undo')latest.current.onUndo();else if(action==='tap')tap(e);if(!session.points.size){quality(false);rt.touching=false;controls.enabled=!isFlat(latest.current.view);origin=null}if(renderer.domElement.hasPointerCapture(e.pointerId))renderer.domElement.releasePointerCapture(e.pointerId);invalidate();return}const moved=origin?Math.hypot(e.clientX-origin.x,e.clientY-origin.y):Infinity;finishDrag();mouseFlat=null;if(!mouseMoved&&moved<4&&e.type==='pointerup'&&e.button===0)tap(e);origin=null};
  const cancel=()=>{clearHold();finishDrag();session.reset();quality(false);rt.touching=false;mouseFlat=null;origin=null;controls.enabled=!isFlat(latest.current.view)};
  const visibility=()=>{if(document.hidden){cancel();cancelAnimationFrame(frame);frame=0}else{if(rt.pending&&!rt.inFlight){const job=rt.pending;rt.pending=undefined;submit(job)}invalidate()}};
  const wheel=(e:WheelEvent)=>{if(!isFlat(latest.current.view))return;e.stopImmediatePropagation();e.preventDefault();zoom(Math.exp(-e.deltaY*.001))};
  const context=(e:Event)=>e.preventDefault();
  renderer.domElement.addEventListener('pointerdown',down,true);renderer.domElement.addEventListener('pointermove',move,true);renderer.domElement.addEventListener('pointerup',up,true);renderer.domElement.addEventListener('pointercancel',up,true);renderer.domElement.addEventListener('lostpointercapture',up,true);renderer.domElement.addEventListener('wheel',wheel,{capture:true,passive:false});renderer.domElement.addEventListener('contextmenu',context);document.addEventListener('visibilitychange',visibility);window.addEventListener('blur',cancel);
  try{rt.worker=new Worker(new URL('../../lib/form-worker.ts',import.meta.url),{type:'module'});rt.worker.onmessage=e=>{rt.inFlight=false;if(e.data.id===rt.request||latest.current.editing){if(e.data.error){setError('The form could not be evaluated. Reduce an influence.');setBusy(false)}else apply(e.data.mesh)}if(rt.pending&&!document.hidden){const next=rt.pending;rt.pending=undefined;submit(next)}};rt.worker.onerror=()=>{rt.worker?.terminate();rt.worker=undefined;rt.inFlight=false;const job=rt.pending;rt.pending=undefined;submit(job??{id:rt.request,model:withoutRipples(latest.current.model),resolution:96})}}catch{rt.worker=undefined}
  return()=>{disposed=true;cancel();if(qualityTimer)clearTimeout(qualityTimer);cancelAnimationFrame(frame);observer.disconnect();rt.worker?.terminate();document.removeEventListener('visibilitychange',visibility);window.removeEventListener('blur',cancel);renderer.domElement.removeEventListener('pointerdown',down,true);renderer.domElement.removeEventListener('pointermove',move,true);renderer.domElement.removeEventListener('pointerup',up,true);renderer.domElement.removeEventListener('pointercancel',up,true);renderer.domElement.removeEventListener('lostpointercapture',up,true);renderer.domElement.removeEventListener('wheel',wheel,true);renderer.domElement.removeEventListener('contextmenu',context);controls.dispose();scene.traverse(obj=>{const o=obj as THREE.Mesh;o.geometry?.dispose();if(o.material){if(Array.isArray(o.material))o.material.forEach(m=>m.dispose());else o.material.dispose()}});depthMaterial.dispose();env.dispose();renderer.dispose();renderer.domElement.remove();runtime.current=null};
 },[]);
 const geometryKey=JSON.stringify(withoutRipples(props.model));
 useEffect(()=>{runtime.current?.quality(props.editing||props.playing)},[props.editing,props.playing]);
 useEffect(()=>{const r=runtime.current;if(!r)return;setBusy(true);r.quality(props.editing);const id=++r.request,model=JSON.parse(geometryKey) as FormModel;if(props.editing){r.submit({id,model,resolution:96});return}const timer=setTimeout(()=>r.submit({id,model,resolution:matchMedia('(max-width:760px), (max-width:960px) and (max-height:520px) and (pointer:coarse)').matches?136:164}),100);return()=>clearTimeout(timer)},[geometryKey,props.editing]);
 useEffect(()=>{const r=runtime.current;if(!r)return;styleBody(r,props);r.syncRipple();r.syncCamera();r.controls.enabled=!isFlat(props.view)&&!r.touching;r.ground.visible=!isFlat(props.view);r.body.visible=props.view!=='section';r.actors.visible=props.components&&!isFlat(props.view);r.fields.visible=props.handles&&!isFlat(props.view);r.sectionGroup.visible=props.view==='section';r.imports.visible=!isFlat(props.view);r.renderer.setClearColor(props.canvasColor??PALETTES[props.appearance].canvas);r.invalidate()},[props.view,props.components,props.handles,props.wireframe,props.appearance,props.model,props.playing,props.canvasColor]);
 useEffect(()=>{const r=runtime.current;if(!r)return;clearGroup(r.actors);r.actors.add(cameraParts(props.model));r.invalidate()},[props.model.lenses,props.model.lensRadius,props.model.lensSpacing,props.model.width,props.model.height,props.model.depth,props.model.buttons,props.model.usb]);
 useEffect(()=>{const r=runtime.current;if(!r)return;const assets=props.model.assets??[],ids=new Set(assets.map(a=>a.id));
  for(const [id,group] of r.instances)if(!ids.has(id)||assets.find(a=>a.id===id)?.sourceId!==group.userData.sourceId){clearGroup(group);r.imports.remove(group);r.instances.delete(id)}
  for(const asset of assets){let group=r.instances.get(asset.id);if(!group){const definition=assetDefinition(asset.sourceId);if(!definition)continue;group=new THREE.Group();group.name=asset.name;group.userData.sourceId=asset.sourceId;r.instances.set(asset.id,group);r.imports.add(group);const target=group;
   new GLTFLoader().load(definition.url,gltf=>{if(runtime.current!==r||r.instances.get(asset.id)!==target){clearGroup(gltf.scene);return}const content=gltf.scene;content.scale.multiplyScalar(1000);content.updateMatrixWorld(true);const center=new THREE.Box3().setFromObject(content).getCenter(new THREE.Vector3());content.position.sub(center);content.traverse(obj=>{obj.userData.assetId=asset.id;const mesh=obj as THREE.Mesh;if(mesh.isMesh){mesh.castShadow=true;mesh.receiveShadow=true}});target.add(content);r.invalidate()},undefined,()=>{if(runtime.current===r&&r.instances.get(asset.id)===target){clearGroup(target);r.imports.remove(target);r.instances.delete(asset.id);toast.error('Could not load '+asset.name,{action:{label:'Retry',onClick:()=>setAssetRetry(n=>n+1)}});r.invalidate()}});
  }group.visible=asset.visible;group.position.set(asset.x,asset.y,asset.z);group.rotation.set(...[asset.rx,asset.ry,asset.rz].map(THREE.MathUtils.degToRad) as [number,number,number]);group.scale.setScalar(asset.scale);group.updateMatrixWorld(true);
  }r.invalidate();
 },[props.model.assets,assetRetry]);
 useEffect(()=>{const r=runtime.current;if(!r)return;clearGroup(r.fields);for(const f of props.model.influences){if(!f.enabled)continue;const selected=f.id===props.selected;if(!selected&&props.view!=='field')continue;const color=selected?PALETTES[props.appearance].handle:PALETTES[props.appearance].grid,g=new THREE.Group();g.position.set(f.x,f.y,f.z+2);const points:THREE.Vector3[]=[];for(let i=0;i<=72;i++){const a=i/72*Math.PI*2;points.push(new THREE.Vector3(Math.cos(a)*f.radius,Math.sin(a)*f.radius,0))}const circle=new THREE.Line(new THREE.BufferGeometry().setFromPoints(points),new THREE.LineDashedMaterial({color,transparent:true,opacity:.5,dashSize:3,gapSize:3,depthTest:false}));circle.computeLineDistances();circle.renderOrder=9;g.add(circle);const dot=new THREE.Mesh(new THREE.SphereGeometry(2.5,12,10),new THREE.MeshBasicMaterial({color,depthTest:false}));dot.renderOrder=10;g.add(dot);r.fields.add(g)}r.invalidate()},[props.model.influences,props.selected,props.view,props.appearance]);
 useEffect(()=>{const r=runtime.current;if(!r)return;r.syncSection();r.invalidate()},[props.view,props.model,props.section,props.appearance,props.editing,props.playing]);
 return <div className="viewport-mount" ref={mount} aria-label="Interactive form viewport">{busy&&<span className="evaluating" aria-label="Evaluating"/>}{error&&<div className="viewport-error" role="alert">{error}</div>}</div>
});
function clearGroup(group:THREE.Group){for(const obj of [...group.children]){obj.traverse(o=>{const m=o as THREE.Mesh;m.geometry?.dispose();if(m.material){if(Array.isArray(m.material))m.material.forEach(x=>x.dispose());else m.material.dispose()}});group.remove(obj)}}
function styleBody(r:{body:THREE.Mesh},p:Props){
 const mat=r.body.material as THREE.MeshStandardMaterial,palette=PALETTES[p.appearance];
 mat.wireframe=p.wireframe&&p.view!=='silhouette';mat.side=THREE.DoubleSide;mat.vertexColors=p.view!=='silhouette';
 mat.color.set(p.view==='field'?0xffffff:p.view==='silhouette'?palette.silhouette:palette.clay);
 mat.emissive.set(p.view==='silhouette'?palette.silhouette:0x000000);mat.emissiveIntensity=p.view==='silhouette'?1:0;
 mat.roughness=p.view==='field'?.65:.58;mat.metalness=.06;
 const pos=r.body.geometry.getAttribute('position'),norm=r.body.geometry.getAttribute('normal');
 if(pos&&p.view!=='silhouette'){
  const ao=(r.body.geometry.userData.ao??new Float32Array(pos.count)) as Float32Array,aoReady=!!r.body.geometry.userData.ao;
  const colors=new Float32Array(pos.count*3),c=new THREE.Color(),lo=new THREE.Color(0x777980),hi=new THREE.Color(palette.handle);
  for(let i=0;i<pos.count;i++){
   const x=pos.getX(i),y=pos.getY(i),z=pos.getZ(i);
   if(p.view==='field')c.copy(lo).lerp(hi,clamp(fieldStrength(p.model,x,y,z)/22,0,1));
   else {let occ=0;if(!aoReady){for(const d of [2,5,10]){const distance=evaluateBase(p.model,x+norm.getX(i)*d,y+norm.getY(i)*d,z+norm.getZ(i)*d);occ+=Math.max(0,1-distance/d);}
    ao[i]=1-clamp(occ*.1,0,.2);}
    const shade=ao[i];c.setRGB(shade,shade,shade);}
   colors.set([c.r,c.g,c.b],i*3);
  }
  if(p.view!=='field')r.body.geometry.userData.ao=ao;
  r.body.geometry.setAttribute('color',new THREE.BufferAttribute(colors,3));
 }
 mat.needsUpdate=true;
}
