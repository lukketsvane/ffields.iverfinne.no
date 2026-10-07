"use client";
import {useEffect,useImperativeHandle,useRef,useState,forwardRef} from 'react';
import * as THREE from 'three';
import {OrbitControls} from 'three/addons/controls/OrbitControls.js';
import {GLTFLoader} from 'three/addons/loaders/GLTFLoader.js';
import {assetDefinition} from '@/lib/assets';
import {toast} from 'sonner';
import {RoomEnvironment} from 'three/addons/environments/RoomEnvironment.js';
import {FormModel,MeshData,SectionContours,generateMeshAsync,sectionContoursAsync,fieldStrength,clamp,withoutRipples,modelBounds} from '@/lib/form-engine';
import {previewResolution,LatestPreviewScheduler,previewRefinement,previewUpdateStage} from '@/lib/preview-scheduler';
import {previewCacheKey,getCachedPreview,putCachedPreview} from '@/lib/preview-cache';
import type {ScheduledPreview} from '@/lib/preview-scheduler';
import {axisDragDistance,selectedHandle,projectedHandleHit,directGripOffset,directScaleFactor,directRotationDelta,directTransformPatch,composeDirectPatch,selectionFrame} from '@/lib/direct-manipulation';
import {pickCurrentSurface} from '@/lib/implicit-picking';
import type {DirectTransformMode,DirectTransformPatch} from '@/lib/direct-manipulation';
import {Appearance,PALETTES} from '@/lib/appearance';
import {GestureRecognizer,nearHull} from '@/lib/touch-gestures';
import type {PairGesture,PairOwner} from '@/lib/touch-gestures';
import {createRippleMaterial} from '@/lib/ripple-material';
import {cameraParts} from './camera-parts';
import {resizeWorkspaceProjection,syncOrthographicCamera} from '@/lib/workspace-camera';
import {SoftwareViewport} from './software-viewport';
export type ViewMode='solid'|'field'|'section'|'silhouette';
/** Where a placed part lands: the surface at the middle of the view, or the orbit target, with the visible height there. */
export type ViewportFocus={x:number;y:number;z:number;surface:boolean;span:number;view:{x:number;y:number;z:number}};
export type CameraView='front'|'back'|'left'|'right'|'top'|'bottom'|'perspective';
export type ViewportRef={capture:()=>string|undefined;reset:()=>void;setView:(v:CameraView)=>void;phase:()=>number;focus?:()=>ViewportFocus|undefined};
type Props={viewLocked?:boolean;moveAxis?:'x'|'y'|'z';model:FormModel;view:ViewMode;selected:string;handles:boolean;transformMode?:DirectTransformMode;transformAxis?:'x'|'y'|'z';section:number;components:boolean;wireframe:boolean;appearance:Appearance;editing:boolean;playing:boolean;canvasColor:string|null;onSelect:(id:string,inspect?:boolean)=>void;onDrag:(id:string,x:number,y:number,z:number)=>void;onTransform?:(id:string,patch:DirectTransformPatch)=>void;onStart:()=>void;onEnd:()=>void;onUndo:()=>void;onRedo?:()=>void;onDeselect?:()=>void;onSurfaceReady?:()=>void;onMetrics:(mesh:MeshData)=>void};
type Job={id:number;model:FormModel;resolution:number;shading?:boolean;draft?:boolean;streamSurface?:boolean;pixelsPerUnit?:number;previewDetail?:boolean};
type SectionJob={id:number;model:FormModel;resolution:number;z:number};
type Runtime={renderer:THREE.WebGLRenderer;scene:THREE.Scene;camera:THREE.PerspectiveCamera;ortho:THREE.OrthographicCamera;controls:OrbitControls;body:THREE.Mesh;actors:THREE.Group;fields:THREE.Group;selection:THREE.Group;focus:()=>ViewportFocus|undefined;sectionGroup:THREE.Group;ground:THREE.Group;imports:THREE.Group;instances:Map<string,THREE.Group>;worker?:Worker;data?:MeshData;request:number;queue:LatestPreviewScheduler<Job>;scheduled?:ScheduledPreview;tolerance?:number;pixelScale:()=>number;previous?:{resolution:number;milliseconds:number};touching:boolean;dragging:boolean;apply:(data:MeshData,ao?:Float32Array,settled?:boolean,draft?:boolean)=>void;invalidate:()=>void;invalidateJob:(id:number)=>void;fit:(view?:CameraView)=>void;submit:(job:Job)=>void;quality:(active:boolean)=>void;phase:()=>number;syncRipple:()=>void;syncCamera:()=>void;syncSection:()=>void;validateInteraction:()=>void};
const isFlat=(view:ViewMode)=>view==='section'||view==='silhouette';
export const Viewport=forwardRef<ViewportRef,Props>(function Viewport(props,ref){
 const mount=useRef<HTMLDivElement>(null),latest=useRef(props),runtime=useRef<Runtime|null>(null),software=useRef<ViewportRef>(null);latest.current=props;
 const [error,setError]=useState(''),[busy,setBusy]=useState(true),[assetRetry,setAssetRetry]=useState(0),[softwarePreview,setSoftwarePreview]=useState(false);
 useEffect(()=>{const retry=()=>setAssetRetry(n=>n+1);window.addEventListener('online',retry);return()=>window.removeEventListener('online',retry)},[]);
 useImperativeHandle(ref,()=>({capture:()=>{const r=runtime.current;if(!r)return software.current?.capture();r.syncRipple();r.syncCamera();r.renderer.render(r.scene,isFlat(latest.current.view)?r.ortho:r.camera);return r.renderer.domElement.toDataURL('image/png')},reset:()=>{if(runtime.current)runtime.current.fit();else software.current?.reset()},setView:v=>{if(runtime.current)runtime.current.fit(v);else software.current?.setView(v)},phase:()=>runtime.current?.phase()??software.current?.phase()??latest.current.model.influences.find(f=>f.kind==='wave')?.phase??0,focus:()=>runtime.current?runtime.current.focus():software.current?.focus?.()}),[]);
 useEffect(()=>{
  const el=mount.current;if(!el)return;let renderer:THREE.WebGLRenderer;
  try{renderer=new THREE.WebGLRenderer({antialias:true,alpha:false,preserveDrawingBuffer:false})}catch{setSoftwarePreview(true);setBusy(false);return}
  const mobile=matchMedia('(pointer: coarse)').matches;
  const mobileLayout=matchMedia('(max-width:760px), (max-width:960px) and (max-height:520px) and (pointer:coarse)');
  renderer.setPixelRatio(Math.min(window.devicePixelRatio,3));renderer.setClearColor(latest.current.canvasColor??PALETTES[latest.current.appearance].canvas);renderer.shadowMap.enabled=true;renderer.shadowMap.type=THREE.PCFSoftShadowMap;renderer.toneMapping=THREE.ACESFilmicToneMapping;renderer.toneMappingExposure=.9;el.appendChild(renderer.domElement);
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
  const actors=new THREE.Group(),fields=new THREE.Group(),selection=new THREE.Group(),sectionGroup=new THREE.Group(),ground=new THREE.Group(),imports=new THREE.Group();scene.add(actors,fields,selection,sectionGroup,ground,imports);
  let sectionLines:THREE.LineSegments<THREE.BufferGeometry,THREE.LineBasicMaterial>|undefined,sectionAppearance:Appearance|undefined,lastSectionFrame=-Infinity,sectionRequest=0,sectionKey='';
  let sectionWorker:Worker|undefined,sectionFallback:AbortController|undefined;
  const sectionQueue=new LatestPreviewScheduler<SectionJob>();
  const completeSection=(job:SectionJob,contours?:SectionContours)=>{const result=sectionQueue.finish(job.id);if(result.accept&&contours&&!disposed&&latest.current.view==='section'&&sectionLines){const points:number[]=[];for(const s of contours.segments)points.push(s[0],s[1],0,s[2],s[3],0);sectionLines.geometry.dispose();sectionLines.geometry=new THREE.BufferGeometry().setAttribute('position',new THREE.Float32BufferAttribute(points,3));invalidate()}if(result.next)dispatchSection(result.next)};
  const dispatchSection=(job:SectionJob)=>{if(disposed)return;if(sectionWorker){sectionWorker.postMessage(job);return}const controller=new AbortController();sectionFallback=controller;sectionContoursAsync(job.model,job.z,job.resolution,{signal:controller.signal,budgetMs:8}).then(contours=>completeSection(job,contours),()=>completeSection(job)).finally(()=>{if(sectionFallback===controller)sectionFallback=undefined})};
  const syncSection=()=>{
   const p=latest.current;
   if(p.view!=='section'){sectionKey='';if(sectionQueue.current)sectionWorker?.postMessage({cancel:sectionQueue.current.id});sectionQueue.invalidate(++sectionRequest);sectionFallback?.abort();if(sectionLines){clearGroup(sectionGroup);sectionLines=undefined}return}
   if(!sectionLines||sectionAppearance!==p.appearance){
    clearGroup(sectionGroup);sectionAppearance=p.appearance;lastSectionFrame=-Infinity;
    sectionLines=new THREE.LineSegments(new THREE.BufferGeometry(),new THREE.LineBasicMaterial({color:PALETTES[p.appearance].handle}));sectionGroup.add(sectionLines);
    const grid=new THREE.GridHelper(600,30,PALETTES[p.appearance].grid,PALETTES[p.appearance].grid);grid.rotation.x=Math.PI/2;grid.position.z=-1;(grid.material as THREE.Material).transparent=true;(grid.material as THREE.Material).opacity=.14;sectionGroup.add(grid)
   }
   const now=performance.now();if(p.playing&&now-lastSectionFrame<100)return;lastSectionFrame=now;
   const wave=p.model.influences.find(f=>f.kind==='wave'),model=p.playing&&wave?{...p.model,influences:p.model.influences.map(f=>f===wave?{...f,phase:phase()}:f)}:p.model;
   const resolution=p.playing?(mobileLayout.matches?36:56):p.editing?48:mobileLayout.matches?100:160;
   const key=JSON.stringify([model,p.section,resolution]);if(key===sectionKey)return;sectionKey=key;
   const id=++sectionRequest;if(sectionQueue.current)sectionWorker?.postMessage({cancel:sectionQueue.current.id});sectionQueue.invalidate(id);sectionFallback?.abort();if(document.hidden)sectionQueue.pause();const next=sectionQueue.enqueue({id,model,z:p.section,resolution});if(next)dispatchSection(next)
  };
  const plane=new THREE.Mesh(new THREE.PlaneGeometry(800,800),new THREE.ShadowMaterial({opacity:.19}));plane.rotation.x=-Math.PI/2;plane.position.y=-57;plane.receiveShadow=true;ground.add(plane);
  let frame=0,disposed=false,fitted=false,qualityTimer:ReturnType<typeof setTimeout>|undefined,renderRatio=Math.min(window.devicePixelRatio,3);
  const activeCamera=()=>isFlat(latest.current.view)?ortho:camera;
  const draw=()=>{frame=0;if(disposed||document.hidden)return;syncRipple();if(latest.current.view==='section'&&latest.current.playing)syncSection();const moving=controls.enabled&&controls.update(),cam=activeCamera();for(const grip of fields.children.filter(g=>g.userData.grip)){const scale=isFlat(latest.current.view)?(ortho.top-ortho.bottom)/el.clientHeight:2*Math.max(camera.near,-grip.position.clone().applyMatrix4(camera.matrixWorldInverse).z)*Math.tan(THREE.MathUtils.degToRad(camera.fov/2))/el.clientHeight;grip.scale.setScalar(scale);grip.quaternion.copy(cam.quaternion)}const cube=document.getElementById('view-cube-orientation');if(cube){const rotation=new THREE.Matrix4().makeRotationFromQuaternion(cam.quaternion.clone().invert()),flip=new THREE.Matrix4().makeScale(1,-1,1);rotation.premultiply(flip).multiply(flip);cube.style.transform=`matrix3d(${rotation.elements.join(',')})`}renderer.render(scene,cam);if(moving||latest.current.playing)invalidate()};
  const invalidate=()=>{if(!frame&&!disposed&&!document.hidden)frame=requestAnimationFrame(draw)};
  const quality=(active:boolean)=>{if(qualityTimer)clearTimeout(qualityTimer);const set=(ratio:number)=>{const nextRatio=Math.min(window.devicePixelRatio,ratio);if(disposed||nextRatio===renderRatio)return;renderRatio=nextRatio;renderer.setPixelRatio(nextRatio);renderer.setSize(el.clientWidth,el.clientHeight);invalidate()};if(active||latest.current.playing)set(mobile?1.25:1.5);else qualityTimer=setTimeout(()=>{set(3);requestDetail()},160)};const navigationStart=()=>quality(true),navigationEnd=()=>quality(false);controls.addEventListener('change',invalidate);controls.addEventListener('start',navigationStart);controls.addEventListener('end',navigationEnd);
  const dimensions=()=>{const b=rt.data?.bounds,box=b&&rt.data?.indices.length?new THREE.Box3(new THREE.Vector3(b[0],b[1],b[2]),new THREE.Vector3(b[3],b[4],b[5])):new THREE.Box3(new THREE.Vector3(-latest.current.model.width/2,-latest.current.model.height/2,-latest.current.model.depth/2),new THREE.Vector3(latest.current.model.width/2,latest.current.model.height/2,latest.current.model.depth/2));for(const object of rt.imports.children){if(object.visible&&object.children.length)box.union(new THREE.Box3().setFromObject(object))}return {half:box.getSize(new THREE.Vector3()).multiplyScalar(.5),center:box.getCenter(new THREE.Vector3())}};
  const fitDistance=(direction=camera.position.clone().sub(controls.target),aspect=camera.aspect)=>{const half=dimensions().half,forward=direction.clone().normalize(),right=new THREE.Vector3().crossVectors(Math.abs(forward.y)>.99999?new THREE.Vector3(0,0,1):new THREE.Vector3(0,1,0),forward).normalize(),up=new THREE.Vector3().crossVectors(forward,right);const projected=(axis:THREE.Vector3)=>Math.abs(axis.x)*half.x+Math.abs(axis.y)*half.y+Math.abs(axis.z)*half.z;const tan=Math.tan(THREE.MathUtils.degToRad(camera.fov/2));return (Math.max(projected(right)/(tan*aspect),projected(up)/tan)+projected(forward))*1.2};
  const syncCamera=()=>syncOrthographicCamera(camera,ortho,controls.target);
  const fit=(view?:CameraView)=>{
   if(latest.current.viewLocked)return;
   // Drain outstanding damping before applying a deliberate camera pose.
   const damping=controls.enableDamping;controls.enableDamping=false;controls.update();
   const directions:Record<CameraView,[number,number,number]>={front:[0,0,1],back:[0,0,-1],left:[-1,0,0],right:[1,0,0],top:[0,1,.0001],bottom:[0,-1,.0001],perspective:[.34,.22,1]};
   const direction=view?new THREE.Vector3(...directions[view]):camera.position.clone().sub(controls.target),d=dimensions();
   controls.target.copy(d.center);camera.position.copy(d.center).add(direction.normalize().multiplyScalar(fitDistance(direction)));
   controls.update();controls.enableDamping=damping;fitted=true;syncCamera();invalidate();
  };
  const resize=()=>{
   const w=el.clientWidth,h=el.clientHeight;if(!w||!h)return;
   renderer.setSize(w,h);
   resizeWorkspaceProjection(camera,ortho,controls.target,w,h,mobileLayout.matches);
   invalidate()
  };
  const apply=(data:MeshData,ao?:Float32Array,settled=true,draft=false)=>{if(disposed)return;el.dataset.previewRasterRatio=String(renderRatio);el.dataset.previewStage=settled?'ready':draft?'editing':'refining';el.dataset.previewResolution=String(data.sampling?.resolution??Math.max(0,...(data.components??[]).map(c=>c.sampling?.resolution??0)));el.dataset.previewTriangles=String(data.indices.length/3);plane.position.y=data.bounds[1]-.8;const geometry=new THREE.BufferGeometry();geometry.setAttribute('position',new THREE.BufferAttribute(data.positions,3));geometry.setAttribute('normal',new THREE.BufferAttribute(data.normals,3));geometry.setIndex(new THREE.BufferAttribute(data.indices,1));if(ao)geometry.userData.ao=ao;geometry.computeBoundingSphere();body.geometry.dispose();body.geometry=geometry;rt.data=data;styleBody(rt,latest.current);setBusy(!settled);setError(data.indices.length||(latest.current.model.baseEnabled===false&&!latest.current.model.shapes?.some(s=>s.enabled&&s.operation==='union'))?'':'These fields leave no solid. Reduce the pinch or restore a variant.');latest.current.onSurfaceReady?.();if(settled)latest.current.onMetrics(data);if(!fitted&&data.indices.length){fitted=true;resize();fit()}invalidate()};
  const queue=new LatestPreviewScheduler<Job>();let fallback:AbortController|undefined;
  const complete=(job:Job,mesh?:MeshData,error?:unknown,milliseconds?:number,ao?:Float32Array)=>{const result=queue.finish(job.id);if(result.accept&&!disposed){if(mesh){el.dataset.previewMilliseconds=String(milliseconds??0);el.dataset.previewStage=job.draft?'draft':'settled';el.dataset.previewResolution=String(job.resolution);rt.previous={resolution:job.resolution,milliseconds:milliseconds??0};apply(mesh,ao,job.draft!==true,job.draft===true);if(job.draft){const revision=job.id;setTimeout(()=>{if(disposed||rt.request!==revision||rt.scheduled?.stage!=='draft')return;const id=++rt.request;rt.scheduled={geometry:JSON.stringify(job.model),stage:'settled'};submit({...job,id,draft:false,resolution:previewResolution(job.model,{mobile:mobileLayout.matches,editing:false}),shading:true,streamSurface:true,previewDetail:true})},latest.current.editing?160:0)}if(!job.draft)void putCachedPreview(cacheKey(job),{mesh,...(ao?{ao}:{})})}else if(error){setError('The form could not be evaluated. Reduce an influence.');setBusy(false)}}if(result.next)dispatch(result.next)};
  const cacheKey=(job:Job)=>previewCacheKey(JSON.stringify(job.model),job.resolution,previewRefinement(false,job.pixelsPerUnit)!.tolerance);
  const dispatch=(job:Job)=>{if(disposed)return;el.dataset.previewCached='false';if(!job.draft)void getCachedPreview(cacheKey(job)).then(cached=>{if(!cached||disposed||queue.current?.id!==job.id||queue.latestId!==job.id||JSON.stringify(withoutRipples(latest.current.model))!==JSON.stringify(job.model))return;el.dataset.previewCached='true';rt.worker?.postMessage({cancel:job.id});fallback?.abort();complete(job,cached.mesh,undefined,0,cached.ao)});if(rt.worker){rt.worker.postMessage(job);return}const controller=new AbortController();fallback=controller;const started=performance.now();generateMeshAsync(job.model,job.resolution,previewRefinement(job.draft===true,job.pixelsPerUnit),undefined,{signal:controller.signal,budgetMs:8,draft:job.draft,previewDetail:job.previewDetail,creases:true,...(job.streamSurface?{onSurface:(mesh:MeshData)=>{if(queue.current?.id===job.id&&queue.latestId===job.id)apply(mesh,undefined,false)}}:{})}).then(mesh=>complete(job,mesh,undefined,performance.now()-started),error=>complete(job,undefined,controller.signal.aborted?undefined:error)).finally(()=>{if(fallback===controller)fallback=undefined})};
  const submit=(job:Job)=>{if(!job.draft)rt.tolerance=previewRefinement(false,job.pixelsPerUnit)!.tolerance;if(document.hidden)queue.pause();const next=queue.enqueue(job);if(next)dispatch(next)};
  const invalidateJob=(id:number)=>{const activeId=queue.current?.id;queue.invalidate(id);fallback?.abort();if(rt.worker&&activeId!==undefined)rt.worker.postMessage({cancel:activeId})};
  const rt:Runtime={renderer,scene,camera,ortho,controls,body,actors,fields,selection,focus:()=>undefined,sectionGroup,ground,imports,instances:new Map(),request:0,queue,pixelScale:()=>{if(!rt.data){const b=modelBounds(latest.current.model,false),longest=Math.max(b[3]-b[0],b[4]-b[1],b[5]-b[2]);return el.clientHeight/(longest*1.2)*renderRatio}return (isFlat(latest.current.view)?el.clientHeight/(ortho.top-ortho.bottom):el.clientHeight/(2*camera.position.distanceTo(controls.target)*Math.tan(THREE.MathUtils.degToRad(camera.fov/2))))*renderRatio},touching:false,dragging:false,apply,invalidate,invalidateJob,fit,submit,quality,phase,syncRipple,syncCamera,syncSection,validateInteraction:()=>validateInteraction()};runtime.current=rt;
  const requestDetail=()=>{
   if(disposed||!rt.data||latest.current.editing||rt.scheduled?.stage!=='settled')return;
   const pixelsPerUnit=rt.pixelScale(),tolerance=previewRefinement(false,pixelsPerUnit)!.tolerance;
   if(tolerance>=(rt.tolerance??.04))return;
   const model=withoutRipples(latest.current.model),id=++rt.request;invalidateJob(id);setBusy(true);
   submit({id,model,resolution:previewResolution(model,{mobile:mobileLayout.matches,editing:false}),draft:false,shading:true,streamSurface:true,previewDetail:true,pixelsPerUnit});
  };
  const observer=new ResizeObserver(resize);observer.observe(el);resize();
  // Touch has one owner, the gesture recognizer. OrbitControls keeps the mouse.
  const raycaster=new THREE.Raycaster(),pointer=new THREE.Vector2(),dragPlane=new THREE.Plane(),world=new THREE.Vector3(),dragOffset=new THREE.Vector3();
  let mouseMoved=false,gripPointer:number|undefined,gripAt:{x:number;y:number}|null=null;
  let drag:{id:string;pointerId:number;started:boolean;grab?:boolean;settled?:boolean;ranges:{x:readonly [number,number];y:readonly [number,number];z:readonly [number,number]};mode:DirectTransformMode;axis:'x'|'y'|'z';model:FormModel;start:{x:number;y:number};anchor:{x:number;y:number};previous:{x:number;y:number};rotation:number}|null=null,mouseFlat:{x:number;y:number}|null=null,origin:{x:number;y:number}|null=null;
  let pairing:{owner:PairOwner;id?:string;model?:FormModel;started?:boolean;plane?:THREE.Plane;axis?:THREE.Vector3}|undefined;
  const readout=document.createElement('div');readout.className='gesture-readout';readout.hidden=true;el.appendChild(readout);
  const say=(text:string)=>{readout.hidden=!text;readout.textContent=text};
  const ray=(x:number,y:number)=>{const rect=renderer.domElement.getBoundingClientRect();pointer.set((x-rect.left)/rect.width*2-1,-(y-rect.top)/rect.height*2+1);raycaster.setFromCamera(pointer,activeCamera())};
  const hitHandle=(x:number,y:number)=>{
   const p=latest.current;if(!p.handles||p.view==='silhouette')return;
   const rect=renderer.domElement.getBoundingClientRect(),ids=[p.selected,...(p.view==='field'?p.model.influences.map(f=>f.id):[])];
   for(const id of ids){
    const handle=selectedHandle(p.model,id);if(!handle)continue;
    const projected=new THREE.Vector3(handle.x,handle.y,handle.z).project(activeCamera());
    const mode:DirectTransformMode=id===p.selected&&handle.kind!=='influence'&&p.onTransform?p.transformMode??'move':'move';
    if(mode!=='move'&&!directTransformPatch(p.model,id,mode,mode==='size'?1:0,p.transformAxis))continue;
    const offset=directGripOffset(mode),anchor={x:(projected.x+1)*rect.width/2+rect.left,y:(-projected.y+1)*rect.height/2+rect.top};
    if(projectedHandleHit({x,y},{x:anchor.x+offset.x,y:anchor.y+offset.y,z:projected.z}))return {...handle,mode,anchor};
   }
  };
  const prepareDrag=(e:PointerEvent)=>{
   const f=hitHandle(e.clientX,e.clientY);if(!f)return false;
   ray(e.clientX,e.clientY);dragPlane.setFromNormalAndCoplanarPoint(activeCamera().getWorldDirection(new THREE.Vector3()),new THREE.Vector3(f.x,f.y,f.z));
   if(!raycaster.ray.intersectPlane(dragPlane,world))return false;
   dragOffset.set(f.x,f.y,f.z).sub(world);
   drag={id:f.id,pointerId:e.pointerId,started:false,ranges:f.ranges,mode:f.mode,axis:latest.current.transformAxis??'z',model:latest.current.model,start:{x:e.clientX,y:e.clientY},anchor:f.anchor,previous:{x:e.clientX,y:e.clientY},rotation:0};rt.dragging=true;return true;
  };
  const finishDrag=()=>{if(drag?.started)latest.current.onEnd();drag=null;rt.dragging=false;gripPointer=undefined;gripAt=null;controls.enabled=!latest.current.viewLocked&&!isFlat(latest.current.view)&&!rt.touching;if(!pairing)say('');invalidate()};
  const moveDrag=(x:number,y:number)=>{
   validateInteraction();if(!drag)return;
   if(drag.mode==='move'){ray(x,y);if(!raycaster.ray.intersectPlane(dragPlane,world))return}
   if(!drag.started){drag.started=true;latest.current.onSelect(drag.id,false);latest.current.onStart();recognizer.consume()}
   if(drag.mode==='move'){
    world.add(dragOffset);const locked=latest.current.moveAxis,from=selectedHandle(drag.model,drag.id);if(locked&&from){const unit=new THREE.Vector3(locked==='x'?1:0,locked==='y'?1:0,locked==='z'?1:0),a=new THREE.Vector3(from.x,from.y,from.z).project(activeCamera()),b=new THREE.Vector3(from.x,from.y,from.z).add(unit).project(activeCamera()),sx=(b.x-a.x)*el.clientWidth/2,sy=-(b.y-a.y)*el.clientHeight/2,delta=axisDragDistance(x-drag.start.x,y-drag.start.y,sx,sy);world.set(from.x,from.y,from.z);world[locked]+=delta}const next={x:clamp(world.x,...drag.ranges.x),y:clamp(world.y,...drag.ranges.y),z:clamp(world.z,...drag.ranges.z)};latest.current.onDrag(drag.id,next.x,next.y,next.z);
    if(drag.grab){const from=selectedHandle(drag.model,drag.id);if(from)say(Math.hypot(next.x-from.x,next.y-from.y,next.z-from.z).toFixed(1)+' mm')}
   }else{
    if(drag.mode==='rotate'){drag.rotation+=directRotationDelta(drag.previous,{x,y},drag.anchor);drag.previous={x,y}}
    const amount=drag.mode==='size'?directScaleFactor(x-drag.start.x,y-drag.start.y):drag.rotation;
    const patch=directTransformPatch(drag.model,drag.id,drag.mode,amount,drag.axis);if(patch)latest.current.onTransform?.(drag.id,patch);
   }
   invalidate();
  };
  const validateInteraction=()=>{
   if(!drag)return;const p=latest.current,h=selectedHandle(p.model,drag.id);
   // A grab selects its own object. Until that selection arrives, it is not a stale drag.
   if(drag.grab&&!drag.settled){if(p.selected===drag.id&&(!drag.started||p.editing))drag.settled=true;else if(h)return}
   const mode:DirectTransformMode=drag.grab?'move':h?.kind!=='influence'&&p.onTransform?p.transformMode??'move':'move';
   if(!h||(!drag.grab&&!p.handles)||(drag.started&&p.selected!==drag.id)||mode!==drag.mode||(drag.mode==='rotate'&&(p.transformAxis??'z')!==drag.axis)||(drag.started&&!p.editing)){
    recognizer.consume();
    // A tray may already have ended the transaction. Do not end it twice.
    if(drag.started&&!p.editing)drag.started=false;
    finishDrag();mouseMoved=true;origin=null;mouseFlat=null;
   }
  };
  const pan=(dx:number,dy:number)=>{if(latest.current.viewLocked)return;const c=activeCamera(),scale=isFlat(latest.current.view)?(ortho.top-ortho.bottom)/el.clientHeight:2*camera.position.distanceTo(controls.target)*Math.tan(THREE.MathUtils.degToRad(camera.fov/2))/el.clientHeight;const delta=new THREE.Vector3().setFromMatrixColumn(c.matrix,0).multiplyScalar(-dx*scale).add(new THREE.Vector3().setFromMatrixColumn(c.matrix,1).multiplyScalar(dy*scale));camera.position.add(delta);controls.target.add(delta);controls.update();syncCamera();invalidate()};
  const zoom=(factor:number)=>{if(latest.current.viewLocked)return;if(!Number.isFinite(factor)||factor<=0)return;const offset=camera.position.clone().sub(controls.target),distance=clamp(offset.length()/factor,controls.minDistance,controls.maxDistance);camera.position.copy(controls.target).add(offset.setLength(distance));controls.update();syncCamera();invalidate()};
  const orbit=(dx:number,dy:number)=>{if(latest.current.viewLocked)return;const offset=camera.position.clone().sub(controls.target),spherical=new THREE.Spherical().setFromVector3(offset);spherical.theta-=dx/el.clientHeight*Math.PI*2;spherical.phi-=dy/el.clientHeight*Math.PI*2;spherical.makeSafe();camera.position.copy(controls.target).add(new THREE.Vector3().setFromSpherical(spherical));controls.update();invalidate()};
  // A twist turns the view about the vertical, like turning a map: the form follows the fingers.
  const turn=(radians:number)=>{if(latest.current.viewLocked)return;if(!Number.isFinite(radians))return;const offset=camera.position.clone().sub(controls.target),spherical=new THREE.Spherical().setFromVector3(offset);spherical.theta-=radians;spherical.makeSafe();camera.position.copy(controls.target).add(new THREE.Vector3().setFromSpherical(spherical));controls.update();syncCamera();invalidate()};
  const pickAt=(x:number,y:number):string|undefined=>{ray(x,y);const assetHit=raycaster.intersectObjects(imports.children.filter(o=>o.visible),true).find(h=>h.object.userData.assetId),hit=pickCurrentSurface(latest.current.model,raycaster.ray);if(assetHit&&(!hit||assetHit.distance<hit.distance))return assetHit.object.userData.assetId;if(hit)return hit.shapeId??(latest.current.model.lattice?.enabled?'lattice':'body')};
  const inspect=(x:number,y:number,touch=false)=>{if(document.activeElement instanceof HTMLInputElement)document.activeElement.blur();const f=hitHandle(x,y);if(f){latest.current.onSelect(f.id,true);return}if(latest.current.view==='section')return;const id=pickAt(x,y);if(id)latest.current.onSelect(id,true);else if(touch)latest.current.onDeselect?.()};
  const tap=(e:PointerEvent)=>inspect(e.clientX,e.clientY);
  // The selection's frame on screen is where two fingers, or a held one, take the object.
  const frameOutline=(id:string)=>{const frame=selectionFrame(latest.current.model,id);if(!frame)return;const rect=renderer.domElement.getBoundingClientRect(),cam=activeCamera(),v=new THREE.Vector3(),points:{x:number;y:number}[]=[];for(const c of frame.corners){v.set(c.x,c.y,c.z).project(cam);if(v.z>1||v.z< -1)return;points.push({x:(v.x+1)*rect.width/2+rect.left,y:(-v.y+1)*rect.height/2+rect.top})}return points};
  const inFrame=(id:string,x:number,y:number,slop=12)=>{const outline=frameOutline(id);return !!outline&&nearHull(outline,{x,y},slop)};
  const grab=(x:number,y:number)=>{
   const p=latest.current;if(p.view==='section'||p.view==='silhouette'||!p.onTransform)return false;
   const picked=pickAt(x,y),pickedHandle=picked?selectedHandle(p.model,picked):undefined,own=p.selected?selectedHandle(p.model,p.selected):undefined;
   const id=pickedHandle&&pickedHandle.kind!=='influence'?picked!:own&&own.kind!=='influence'&&inFrame(p.selected,x,y,0)?p.selected:undefined;
   if(!id){if(picked)p.onSelect(picked,false);return false}
   const handle=selectedHandle(p.model,id)!;
   ray(x,y);dragPlane.setFromNormalAndCoplanarPoint(activeCamera().getWorldDirection(new THREE.Vector3()),new THREE.Vector3(handle.x,handle.y,handle.z));
   if(!raycaster.ray.intersectPlane(dragPlane,world))return false;
   dragOffset.set(handle.x,handle.y,handle.z).sub(world);
   drag={id,pointerId:-1,started:false,grab:true,settled:false,ranges:handle.ranges,mode:'move',axis:'z',model:p.model,start:{x,y},anchor:{x,y},previous:{x,y},rotation:0};rt.dragging=true;
   p.onSelect(id,false);say('Move');invalidate();return true;
  };
  const pairStart=(c:{x:number;y:number}):PairOwner=>{
   if(drag)finishDrag();
   const p=latest.current,id=p.selected;
   if(p.view!=='section'&&p.onTransform&&id&&composeDirectPatch(p.model,id,{scale:1.01})&&inFrame(id,c.x,c.y)){
    const frame=selectionFrame(p.model,id)!,center=new THREE.Vector3(frame.center.x,frame.center.y,frame.center.z),cam=activeCamera(),facing=cam.getWorldDirection(new THREE.Vector3());
    pairing={owner:{kind:'object'},id,model:p.model,started:false,plane:new THREE.Plane().setFromNormalAndCoplanarPoint(facing,center),axis:isFlat(p.view)?facing.clone().negate():cam.position.clone().sub(center).normalize()};
   }else pairing={owner:{kind:'camera'}};
   return pairing.owner;
  };
  const planeAt=(x:number,y:number,plane:THREE.Plane)=>{ray(x,y);return raycaster.ray.intersectPlane(plane,new THREE.Vector3())};
  const pairMove=(g:PairGesture)=>{
   const p=latest.current;
   if(g.owner.kind==='camera'){if(g.active.pan)pan(g.step.pan.x,g.step.pan.y);if(g.active.scale)zoom(g.step.scale);if(g.active.rotate&&!isFlat(p.view))turn(g.step.rotation);return}
   const s=pairing;if(!s?.id||!s.model||!s.plane||!s.axis)return;
   let move:{x:number;y:number;z:number}|undefined;
   if(g.active.pan){const from=planeAt(g.centroid.x-g.pan.x,g.centroid.y-g.pan.y,s.plane),to=planeAt(g.centroid.x,g.centroid.y,s.plane);if(from&&to)move={x:to.x-from.x,y:to.y-from.y,z:to.z-from.z}}
   if(g.active.pan&&p.moveAxis){const frame=selectionFrame(s.model,s.id);if(frame){const axis=p.moveAxis,a=new THREE.Vector3(frame.center.x,frame.center.y,frame.center.z),b=a.clone();b[axis]+=1;a.project(activeCamera());b.project(activeCamera());const distance=axisDragDistance(g.pan.x,g.pan.y,(b.x-a.x)*el.clientWidth/2,-(b.y-a.y)*el.clientHeight/2);move={x:0,y:0,z:0};move[axis]=distance}}
   const patch=composeDirectPatch(s.model,s.id,{move,scale:!p.moveAxis&&g.active.scale?g.scale:undefined,turn:!p.moveAxis&&g.active.rotate?{axis:{x:s.axis.x,y:s.axis.y,z:s.axis.z},radians:g.rotation}:undefined});
   if(!patch)return;
   if(!s.started){s.started=true;p.onStart()}
   p.onTransform?.(s.id,patch);
   const parts:string[]=[];if(g.active.scale)parts.push('× '+g.scale.toFixed(2));if(g.active.rotate)parts.push(Math.round(g.rotation*180/Math.PI)+'°');if(move)parts.push(Math.hypot(move.x,move.y,move.z).toFixed(1)+' mm');say(parts.join('  ·  '));
   invalidate();
  };
  const pairEnd=()=>{const s=pairing;pairing=undefined;if(s?.started)latest.current.onEnd();say('')};
  const recognizer=new GestureRecognizer({
   orbit:(dx,dy)=>{if(isFlat(latest.current.view))pan(dx,dy);else orbit(dx,dy)},
   tap:(x,y)=>inspect(x,y,true),
   doubleTap:()=>fit(),
   hold:grab,
   grabMove:(x,y)=>moveDrag(x,y),
   grabEnd:()=>finishDrag(),
   pairStart,pair:pairMove,pairEnd,
   twoFingerTap:()=>latest.current.onUndo(),
   threeFingerTap:()=>latest.current.onRedo?.(),
  });
  const down=(e:PointerEvent)=>{
   if(e.pointerType==='touch'){
    e.stopImmediatePropagation();e.preventDefault();rt.touching=true;quality(true);controls.enabled=false;
    try{renderer.domElement.setPointerCapture(e.pointerId)}catch{}
    const now=e.timeStamp;
    if(!recognizer.active){origin={x:e.clientX,y:e.clientY};if(prepareDrag(e)){gripPointer=e.pointerId;gripAt={x:e.clientX,y:e.clientY};recognizer.down(e.pointerId,e.clientX,e.clientY,now);recognizer.consume();return}}
    else if(gripPointer!==undefined){const id=gripPointer,at=gripAt;finishDrag();if(at)recognizer.move(id,at.x,at.y)}
    recognizer.down(e.pointerId,e.clientX,e.clientY,now);
    return;
   }
   if(e.button!==0)return;mouseMoved=false;origin={x:e.clientX,y:e.clientY};if(prepareDrag(e)||isFlat(latest.current.view)){controls.enabled=false;mouseFlat=isFlat(latest.current.view)?{x:e.clientX,y:e.clientY}:null;renderer.domElement.setPointerCapture(e.pointerId);e.stopImmediatePropagation();e.preventDefault()}
  };
  const move=(e:PointerEvent)=>{
   if(e.pointerType==='touch'){
    if(!rt.touching)return;e.stopImmediatePropagation();e.preventDefault();
    if(e.pointerId===gripPointer){gripAt={x:e.clientX,y:e.clientY};if(drag&&origin&&Math.hypot(e.clientX-origin.x,e.clientY-origin.y)>6)moveDrag(e.clientX,e.clientY);return}
    recognizer.move(e.pointerId,e.clientX,e.clientY);return;
   }
   if(origin&&Math.hypot(e.clientX-origin.x,e.clientY-origin.y)>4)mouseMoved=true;if(drag&&drag.pointerId===e.pointerId&&origin&&Math.hypot(e.clientX-origin.x,e.clientY-origin.y)>3){moveDrag(e.clientX,e.clientY);e.preventDefault()}else if(mouseFlat){pan(e.clientX-mouseFlat.x,e.clientY-mouseFlat.y);mouseFlat={x:e.clientX,y:e.clientY}}
  };
  const up=(e:PointerEvent)=>{
   validateInteraction();
   if(e.pointerType==='touch'){
    if(!rt.touching)return;e.stopImmediatePropagation();e.preventDefault();
    if(e.pointerId===gripPointer)finishDrag();
    recognizer.up(e.pointerId,e.timeStamp,e.type==='pointercancel'||e.type==='lostpointercapture');
    if(!recognizer.active){quality(false);rt.touching=false;controls.enabled=!latest.current.viewLocked&&!isFlat(latest.current.view);origin=null}
    if(renderer.domElement.hasPointerCapture(e.pointerId))renderer.domElement.releasePointerCapture(e.pointerId);
    invalidate();return;
   }
   const moved=origin?Math.hypot(e.clientX-origin.x,e.clientY-origin.y):Infinity;finishDrag();mouseFlat=null;if(!mouseMoved&&moved<4&&e.type==='pointerup'&&e.button===0)tap(e);origin=null
  };
  const cancel=()=>{recognizer.reset();finishDrag();pairEnd();quality(false);rt.touching=false;mouseFlat=null;origin=null;controls.enabled=!latest.current.viewLocked&&!isFlat(latest.current.view)};
  rt.focus=()=>{const rect=renderer.domElement.getBoundingClientRect();if(!rect.width||!rect.height)return;ray(rect.left+rect.width/2,rect.top+rect.height*.45);const flat=isFlat(latest.current.view),hit=latest.current.view==='section'?undefined:pickCurrentSurface(latest.current.model,raycaster.ray),point=hit?.point??{x:controls.target.x,y:controls.target.y,z:controls.target.z},cam=activeCamera(),facing=cam.getWorldDirection(new THREE.Vector3()),distance=camera.position.distanceTo(new THREE.Vector3(point.x,point.y,point.z));return {x:point.x,y:point.y,z:point.z,surface:!!hit,span:flat?ortho.top-ortho.bottom:2*distance*Math.tan(THREE.MathUtils.degToRad(camera.fov/2)),view:{x:facing.x,y:facing.y,z:facing.z}}};
  const visibility=()=>{if(document.hidden){cancel();queue.pause();sectionQueue.pause();cancelAnimationFrame(frame);frame=0}else{const job=queue.resume();if(job)dispatch(job);const slice=sectionQueue.resume();if(slice)dispatchSection(slice);invalidate()}};
  const wheel=(e:WheelEvent)=>{if(latest.current.viewLocked){e.stopImmediatePropagation();e.preventDefault();return}if(!isFlat(latest.current.view))return;e.stopImmediatePropagation();e.preventDefault();zoom(Math.exp(-e.deltaY*.001))};
  const context=(e:Event)=>e.preventDefault();
  renderer.domElement.addEventListener('pointerdown',down,true);renderer.domElement.addEventListener('pointermove',move,true);renderer.domElement.addEventListener('pointerup',up,true);renderer.domElement.addEventListener('pointercancel',up,true);renderer.domElement.addEventListener('lostpointercapture',up,true);renderer.domElement.addEventListener('wheel',wheel,{capture:true,passive:false});renderer.domElement.addEventListener('contextmenu',context);document.addEventListener('visibilitychange',visibility);window.addEventListener('blur',cancel);
  try{rt.worker=new Worker(new URL('../../lib/form-worker.ts',import.meta.url),{type:'module'});rt.worker.onmessage=e=>{const job=queue.current;if(job&&job.id===e.data.id){if(e.data.stage==='surface'){if(!job.draft&&queue.latestId===job.id)apply(e.data.mesh,undefined,false)}else complete(job,e.data.mesh,e.data.error,e.data.milliseconds,e.data.ao)}};rt.worker.onerror=()=>{rt.worker?.terminate();rt.worker=undefined;const job=queue.restart();if(job)dispatch(job)}}catch{rt.worker=undefined}
  try{sectionWorker=new Worker(new URL('../../lib/section-worker.ts',import.meta.url),{type:'module'});sectionWorker.onmessage=e=>{const job=sectionQueue.current;if(job&&job.id===e.data.id)completeSection(job,e.data.contours)};sectionWorker.onerror=()=>{sectionWorker?.terminate();sectionWorker=undefined;const job=sectionQueue.restart();if(job)dispatchSection(job)}}catch{sectionWorker=undefined}
  return()=>{disposed=true;queue.dispose();sectionQueue.dispose();fallback?.abort();sectionFallback?.abort();sectionWorker?.terminate();cancel();if(qualityTimer)clearTimeout(qualityTimer);cancelAnimationFrame(frame);observer.disconnect();rt.worker?.terminate();document.removeEventListener('visibilitychange',visibility);window.removeEventListener('blur',cancel);renderer.domElement.removeEventListener('pointerdown',down,true);renderer.domElement.removeEventListener('pointermove',move,true);renderer.domElement.removeEventListener('pointerup',up,true);renderer.domElement.removeEventListener('pointercancel',up,true);renderer.domElement.removeEventListener('lostpointercapture',up,true);renderer.domElement.removeEventListener('wheel',wheel,true);renderer.domElement.removeEventListener('contextmenu',context);controls.dispose();scene.traverse(obj=>{const o=obj as THREE.Mesh;o.geometry?.dispose();if(o.material){if(Array.isArray(o.material))o.material.forEach(m=>m.dispose());else o.material.dispose()}});depthMaterial.dispose();env.dispose();renderer.dispose();renderer.domElement.remove();runtime.current=null};
 },[]);
 useEffect(()=>{runtime.current?.validateInteraction()},[props.editing,props.handles,props.selected,props.transformMode,props.transformAxis,props.viewLocked,props.moveAxis]);
 const geometryKey=JSON.stringify(withoutRipples(props.model));
 useEffect(()=>{runtime.current?.quality(props.editing||props.playing)},[props.editing,props.playing]);
 useEffect(()=>{
  const r=runtime.current;if(!r)return;r.quality(props.editing);
  const model=JSON.parse(geometryKey) as FormModel,mobile=matchMedia('(max-width:760px), (max-width:960px) and (max-height:520px) and (pointer:coarse)').matches;
  const submit=(draft:boolean)=>{
   const id=++r.request;r.invalidateJob(id);
   r.scheduled={geometry:geometryKey,stage:draft?'draft':'settled'};setBusy(true);
   r.submit({id,model,resolution:previewResolution(model,{mobile,editing:draft,previous:r.previous}),draft,shading:!draft,streamSurface:!draft,previewDetail:!draft,pixelsPerUnit:r.pixelScale()});
  };
  const stage=previewUpdateStage(r.scheduled,geometryKey,props.editing);
  if(stage&&r.scheduled?.geometry!==geometryKey)submit(true);

 },[geometryKey,props.editing]);
 useEffect(()=>{const r=runtime.current;if(!r)return;styleBody(r,props);r.syncRipple();r.syncCamera();r.controls.enabled=!props.viewLocked&&!isFlat(props.view)&&!r.touching&&!r.dragging;r.ground.visible=!isFlat(props.view);r.body.visible=props.view!=='section';r.actors.visible=props.components&&!isFlat(props.view);r.fields.visible=props.handles&&props.view!=='silhouette';r.selection.visible=props.view!=='silhouette'&&props.view!=='section';r.sectionGroup.visible=props.view==='section';r.imports.visible=!isFlat(props.view);r.renderer.setClearColor(props.canvasColor??PALETTES[props.appearance].canvas);r.invalidate()},[props.view,props.components,props.handles,props.wireframe,props.appearance,props.model,props.playing,props.canvasColor,props.transformMode,props.transformAxis,props.viewLocked,props.moveAxis]);
 useEffect(()=>{const r=runtime.current;if(!r)return;clearGroup(r.actors);r.actors.add(cameraParts(props.model));r.invalidate()},[props.model.lenses,props.model.lensRadius,props.model.lensSpacing,props.model.width,props.model.height,props.model.depth,props.model.buttons,props.model.usb]);
 useEffect(()=>{const r=runtime.current;if(!r)return;const assets=props.model.assets??[],ids=new Set(assets.map(a=>a.id));
  for(const [id,group] of r.instances)if(!ids.has(id)||assets.find(a=>a.id===id)?.sourceId!==group.userData.sourceId){clearGroup(group);r.imports.remove(group);r.instances.delete(id)}
  for(const asset of assets){let group=r.instances.get(asset.id);if(!group){const definition=assetDefinition(asset.sourceId);if(!definition)continue;group=new THREE.Group();group.name=asset.name;group.userData.sourceId=asset.sourceId;r.instances.set(asset.id,group);r.imports.add(group);const target=group;
   new GLTFLoader().load(definition.url,gltf=>{if(runtime.current!==r||r.instances.get(asset.id)!==target){clearGroup(gltf.scene);return}const content=gltf.scene;content.scale.multiplyScalar(1000);content.updateMatrixWorld(true);const center=new THREE.Box3().setFromObject(content).getCenter(new THREE.Vector3());content.position.sub(center);content.traverse(obj=>{obj.userData.assetId=asset.id;const mesh=obj as THREE.Mesh;if(mesh.isMesh){mesh.castShadow=true;mesh.receiveShadow=true}});target.add(content);r.invalidate()},undefined,()=>{if(runtime.current===r&&r.instances.get(asset.id)===target){clearGroup(target);r.imports.remove(target);r.instances.delete(asset.id);toast.error('Could not load '+asset.name,{action:{label:'Retry',onClick:()=>setAssetRetry(n=>n+1)}});r.invalidate()}});
  }const envelopeKey=JSON.stringify(asset.envelope??null);if(group.userData.envelopeKey!==envelopeKey){const old=group.getObjectByName('measured-envelope') as THREE.LineSegments|undefined;if(old){group.remove(old);old.geometry.dispose();(old.material as THREE.Material).dispose()}if(asset.envelope){const box=new THREE.BoxGeometry(...asset.envelope),lines=new THREE.LineSegments(new THREE.EdgesGeometry(box),new THREE.LineBasicMaterial({color:0x5cb8aa,transparent:true,opacity:.65}));box.dispose();lines.name='measured-envelope';lines.userData.assetId=asset.id;group.add(lines)}group.userData.envelopeKey=envelopeKey}group.visible=asset.visible;group.position.set(asset.x,asset.y,asset.z);group.rotation.set(...[asset.rx,asset.ry,asset.rz].map(THREE.MathUtils.degToRad) as [number,number,number]);group.scale.setScalar(asset.scale);group.updateMatrixWorld(true);
  }r.invalidate();
 },[props.model.assets,assetRetry]);
 useEffect(()=>{const r=runtime.current;if(!r)return;clearGroup(r.fields);for(const f of props.model.influences){if(!f.enabled)continue;const selected=f.id===props.selected;if(!selected&&props.view!=='field')continue;const color=selected?PALETTES[props.appearance].handle:PALETTES[props.appearance].grid,g=new THREE.Group();g.position.set(f.x,f.y,f.z);const points:THREE.Vector3[]=[];for(let i=0;i<=72;i++){const a=i/72*Math.PI*2;points.push(new THREE.Vector3(Math.cos(a)*f.radius,Math.sin(a)*f.radius,0))}const circle=new THREE.Line(new THREE.BufferGeometry().setFromPoints(points),new THREE.LineDashedMaterial({color,transparent:true,opacity:.5,dashSize:3,gapSize:3,depthTest:false}));circle.computeLineDistances();circle.renderOrder=9;g.add(circle);const dot=new THREE.Mesh(new THREE.SphereGeometry(2.5,12,10),new THREE.MeshBasicMaterial({color,depthTest:false}));dot.renderOrder=10;g.add(dot);r.fields.add(g)}const handle=selectedHandle(props.model,props.selected);if(handle){const color=PALETTES[props.appearance].handle,mode:DirectTransformMode=handle.kind!=='influence'&&props.onTransform?props.transformMode??'move':'move';if(mode==='move'||directTransformPatch(props.model,handle.id,mode,mode==='size'?1:0,props.transformAxis)){const grip=makeGrip(color,mode);grip.position.set(handle.x,handle.y,handle.z);r.fields.add(grip);}}r.invalidate()},[props.model.influences,props.model.shapes,props.model.assets,props.selected,props.view,props.appearance,props.editing,props.transformMode,props.transformAxis,props.onTransform]);
 // The selection is always drawn as its own box, with or without a grip: it is also where two fingers take it.
 useEffect(()=>{const r=runtime.current;if(!r)return;clearGroup(r.selection);const frame=selectionFrame(props.model,props.selected);if(frame){const points:number[]=[];for(let i=0;i<8;i++)for(const bit of [1,2,4])if(!(i&bit)){const a=frame.corners[i],b=frame.corners[i|bit];points.push(a.x,a.y,a.z,b.x,b.y,b.z)}const lines=new THREE.LineSegments(new THREE.BufferGeometry().setAttribute('position',new THREE.Float32BufferAttribute(points,3)),new THREE.LineBasicMaterial({color:PALETTES[props.appearance].handle,transparent:true,opacity:props.editing?.8:.5,depthTest:false}));lines.renderOrder=8;r.selection.add(lines)}r.invalidate()},[props.model,props.selected,props.appearance,props.editing]);
 useEffect(()=>{const r=runtime.current;if(!r)return;r.syncSection();r.invalidate()},[props.view,props.model,props.section,props.appearance,props.editing,props.playing]);
 if(softwarePreview)return <SoftwareViewport {...props} ref={software}/>;
 return <div className="viewport-mount" ref={mount} aria-label="Interactive form viewport">{busy&&<span className="evaluating" aria-label="Evaluating"/>}{error&&<div className="viewport-error" role="alert">{error}</div>}{!error&&props.model.baseEnabled===false&&!props.model.shapes?.some(s=>s.enabled&&s.operation==='union')&&<div className="viewport-empty"><strong>Start a construction</strong><span>Insert a sweep or a shape to begin.</span></div>}</div>
});
function clearGroup(group:THREE.Group){for(const obj of [...group.children]){obj.traverse(o=>{const m=o as THREE.Mesh;m.geometry?.dispose();if(m.material){if(Array.isArray(m.material))m.material.forEach(x=>x.dispose());else m.material.dispose()}});group.remove(obj)}}
/** A constant screen-size grip: visible feedback updates with authored intent,
 * before the background surface finishes. The larger hit area is CSS pixels. */
function makeGrip(color:string,mode:DirectTransformMode='move'){
 const group=new THREE.Group();group.userData.grip=true;group.renderOrder=12;
 const offset=directGripOffset(mode),cx=offset.x,cy=-offset.y,points:number[]=[];
 const segment=(ax:number,ay:number,bx:number,by:number)=>points.push(ax,ay,0,bx,by,0);
 if(mode==='size'){
  for(const [ax,ay,bx,by] of [[-11,-11,11,-11],[11,-11,11,11],[11,11,-11,11],[-11,11,-11,-11],[-5,-5,5,5],[0,5,5,5],[5,0,5,5],[-5,0,-5,-5],[0,-5,-5,-5]])segment(cx+ax,cy+ay,cx+bx,cy+by);
 }else{
  for(let i=0;i<32;i++){const a=i/32*Math.PI*2,b=(i+1)/32*Math.PI*2;segment(cx+Math.cos(a)*12,cy+Math.sin(a)*12,cx+Math.cos(b)*12,cy+Math.sin(b)*12)}
  if(mode==='move'){segment(-5,0,5,0);segment(0,-5,0,5)}
  else {segment(cx-4,cy-3,cx-4,cy+4);segment(cx-4,cy+4,cx+3,cy+4);segment(cx+3,cy+4,cx,cy+7)}
 }
 if(mode!=='move'){
  const guide:number[]=[];
  if(mode==='rotate')for(let i=0;i<48;i+=2){const a=i/48*Math.PI*2,b=(i+1)/48*Math.PI*2;guide.push(Math.cos(a)*72,Math.sin(a)*72,0,Math.cos(b)*72,Math.sin(b)*72,0)}
  else guide.push(0,0,0,cx,cy,0);
  const line=new THREE.LineSegments(new THREE.BufferGeometry().setAttribute('position',new THREE.Float32BufferAttribute(guide,3)),new THREE.LineBasicMaterial({color,depthTest:false,transparent:true,opacity:.35}));line.renderOrder=10;group.add(line);
 }
 const ring=new THREE.LineSegments(new THREE.BufferGeometry().setAttribute('position',new THREE.Float32BufferAttribute(points,3)),new THREE.LineBasicMaterial({color,depthTest:false,transparent:true,opacity:.95}));ring.renderOrder=12;group.add(ring);
 const backdrop=new THREE.Mesh(mode==='size'?new THREE.PlaneGeometry(29,29):new THREE.CircleGeometry(14,32),new THREE.MeshBasicMaterial({color:0x151b20,depthTest:false,transparent:true,opacity:.8}));backdrop.position.set(cx,cy,-.05);backdrop.renderOrder=11;group.add(backdrop);return group
}
function styleBody(r:{body:THREE.Mesh},p:Props){
 const mat=r.body.material as THREE.MeshStandardMaterial,palette=PALETTES[p.appearance];
 mat.wireframe=p.wireframe&&p.view!=='silhouette';mat.side=THREE.DoubleSide;mat.vertexColors=p.view==='field'||(p.view==='solid'&&!p.editing&&!!r.body.geometry.userData.ao);
 mat.color.set(p.view==='field'?0xffffff:p.view==='silhouette'?palette.silhouette:palette.clay);
 mat.emissive.set(p.view==='silhouette'?palette.silhouette:0x000000);mat.emissiveIntensity=p.view==='silhouette'?1:0;
 mat.roughness=p.view==='field'?.65:.58;mat.metalness=.06;
 const pos=r.body.geometry.getAttribute('position');
 const styleKey=JSON.stringify([p.view,p.appearance,p.editing]);
 if(pos&&mat.vertexColors&&r.body.geometry.userData.styleKey!==styleKey){
  const ao=r.body.geometry.userData.ao as Float32Array|undefined;
  const colors=new Float32Array(pos.count*3),c=new THREE.Color(),lo=new THREE.Color(0x777980),hi=new THREE.Color(palette.handle);
  for(let i=0;i<pos.count;i++){
   const x=pos.getX(i),y=pos.getY(i),z=pos.getZ(i);
   if(p.view==='field')c.copy(lo).lerp(hi,clamp(fieldStrength(p.model,x,y,z)/22,0,1));
   else {const shade=ao?.[i]??1;c.setRGB(shade,shade,shade);}
   colors.set([c.r,c.g,c.b],i*3);
  }
  r.body.geometry.setAttribute('color',new THREE.BufferAttribute(colors,3));
  r.body.geometry.userData.styleKey=styleKey;
 }
 mat.needsUpdate=true;
}
