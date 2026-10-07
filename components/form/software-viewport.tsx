"use client";
import {forwardRef,useEffect,useImperativeHandle,useRef,useState} from 'react';
import {clamp,cloneModel,generateMeshAsync,modelBounds,sectionContoursAsync,withoutRipples} from '@/lib/form-engine';
import type {FormModel,MeshData,SectionContours} from '@/lib/form-engine';
import {LatestPreviewScheduler,previewRefinement,previewUpdateStage} from '@/lib/preview-scheduler';
import {previewCacheKey,getCachedPreview,putCachedPreview} from '@/lib/preview-cache';
import type {ScheduledPreview} from '@/lib/preview-scheduler';
import {axisDragDistance,selectedHandle,projectedHandleHit,directTransformPatch,directGripOffset,directScaleFactor,directRotationDelta} from '@/lib/direct-manipulation';
import {pickCurrentSurface} from '@/lib/implicit-picking';
import type {DirectHandle,DirectTransformMode,DirectTransformPatch} from '@/lib/direct-manipulation';
import {TouchSession} from '@/lib/touch-session';
import {PALETTES} from '@/lib/appearance';
import type {Appearance} from '@/lib/appearance';
import {fitSoftwareCamera,softwareCameraRay,projectSoftwareMesh,projectSoftwarePoint,softwarePlaneDelta,softwareView,softwarePreviewResolution,softwareInteractionShouldCancel} from '@/lib/software-projection';
import {softwareRasterSteps} from '@/lib/software-raster';
import type {SoftwareCamera,SoftwareFrame} from '@/lib/software-projection';
import type {ViewportRef,ViewMode} from './viewport';

export type SoftwareViewportProps={viewLocked?:boolean;moveAxis?:'x'|'y'|'z';model:FormModel;view:ViewMode;selected:string;handles:boolean;section:number;components:boolean;wireframe:boolean;appearance:Appearance;editing:boolean;playing:boolean;canvasColor:string|null;transformMode?:DirectTransformMode;transformAxis?:'x'|'y'|'z';onTransform?:(id:string,patch:DirectTransformPatch)=>void;onSelect:(id:string,inspect?:boolean)=>void;onDrag:(id:string,x:number,y:number,z:number)=>void;onStart:()=>void;onEnd:()=>void;onUndo:()=>void;onSurfaceReady?:()=>void;onMetrics:(mesh:MeshData)=>void};
type Job={id:number;model:FormModel;resolution:number;draft:boolean;streamSurface:boolean;pixelsPerUnit:number;previewDetail:boolean};
type Projection=ReturnType<typeof projectSoftwareMesh>;
type Runtime={submit:(model:FormModel,draft:boolean)=>void;scheduled?:ScheduledPreview;invalidate:()=>void;fit:(view?:import('./viewport').CameraView)=>void;capture:()=>string;section:()=>void;validateInteraction:()=>void};

/** A real evaluated surface for browsers without WebGL. This bounded software
 * path keeps modelling available; it does not pretend to render imported GLTF
 * parts, GPU field colours, ambient occlusion or animated ripple displacement. */
export const SoftwareViewport=forwardRef<ViewportRef,SoftwareViewportProps>(function SoftwareViewport(props,ref){
 const mount=useRef<HTMLDivElement>(null),canvas=useRef<HTMLCanvasElement>(null),latest=useRef(props),runtime=useRef<Runtime|null>(null);
 latest.current=props;
 const [busy,setBusy]=useState(true),[error,setError]=useState('');
 useImperativeHandle(ref,()=>({capture:()=>runtime.current?.capture(),reset:()=>runtime.current?.fit(),setView:view=>runtime.current?.fit(view),phase:()=>latest.current.model.influences.find(f=>f.kind==='wave')?.phase??0}),[]);
 useEffect(()=>{
  const el=mount.current,surface=canvas.current;if(!el||!surface)return;
  const context2D=surface.getContext('2d');if(!context2D){setError('Surface preview is unavailable in this browser.');setBusy(false);return}const ctx:CanvasRenderingContext2D=context2D;
  const back=document.createElement('canvas'),front=document.createElement('canvas'),paintContext=back.getContext('2d'),frontContext=front.getContext('2d');if(!paintContext||!frontContext)return;
  const paintCtx:CanvasRenderingContext2D=paintContext,frontCtx:CanvasRenderingContext2D=frontContext;
  let disposed=false,frameId=0,continuation=0,revision=0,needsDraw=false,paintingDraft=false,interactionEditing=false,blockedTouchSequence=false,fitted=false,worker:Worker|undefined,fallback:AbortController|undefined,sectionTask:AbortController|undefined;
  let displayStage='loading',data:MeshData|undefined,dataIsDraft=false,projection:Projection|undefined,projectionMesh:MeshData|undefined,contours:SectionContours|undefined,previous:{resolution:number;milliseconds:number}|undefined,tolerance:number|undefined;
  let camera:SoftwareCamera={center:{x:0,y:0,z:0},yaw:.62,pitch:.34,scale:2},size:SoftwareFrame={width:Math.max(1,el.clientWidth),height:Math.max(1,el.clientHeight)};
  let request=0,sectionRequest=0,sectionKey='',projectKey='';
  const queue=new LatestPreviewScheduler<Job>(),session=new TouchSession();
  let drag:{handle:DirectHandle;model:FormModel;mode:DirectTransformMode;axis:'x'|'y'|'z';camera:SoftwareCamera;anchor:{x:number;y:number};previous:{x:number;y:number};rotation:number;x:number;y:number;started:boolean}|undefined,mouse:{x:number;y:number;moved:boolean;pan:boolean}|undefined,touchOrigin:{x:number;y:number}|undefined,hold:ReturnType<typeof setTimeout>|undefined;
  const clearHold=()=>{if(hold)clearTimeout(hold);hold=undefined};
  const activeCamera=()=>latest.current.view==='section'||latest.current.view==='silhouette'?{...camera,yaw:0,pitch:0}:camera;
  const point=(event:PointerEvent)=>{const bounds=surface.getBoundingClientRect();return {x:event.clientX-bounds.left,y:event.clientY-bounds.top}};
  const gripMode=(handle:DirectHandle):DirectTransformMode|undefined=>{const p=latest.current,mode=handle.kind==='influence'||!p.onTransform?'move':p.transformMode??'move';return mode==='move'||directTransformPatch(p.model,handle.id,mode,mode==='size'?1:0,p.transformAxis??'z')?mode:undefined};
  const gripPoint=(handle:DirectHandle,mode:DirectTransformMode)=>{const anchor=projectSoftwarePoint(handle,activeCamera(),size),offset=directGripOffset(mode);return {anchor,at:{x:anchor.x+offset.x,y:anchor.y+offset.y}}};
  const invalidate=()=>{if(disposed||document.hidden)return;const cube=document.getElementById('view-cube-orientation');if(cube)cube.style.transform=`rotateX(${camera.pitch}rad) rotateY(${-camera.yaw}rad)`;if(continuation){needsDraw=true;refreshOverlay();return}revision++;if(!frameId)frameId=requestAnimationFrame(draw)};
  // New geometry or a camera preset must discard an obsolete partial frame.
  // Selection-only changes can still refresh the existing complete overlay.
  const preemptSurface=()=>{if(continuation){window.clearTimeout(continuation);continuation=0}needsDraw=false;revision++;invalidate()};
  const preemptDetail=()=>{if(continuation&&!paintingDraft){window.clearTimeout(continuation);continuation=0;needsDraw=false;revision++}invalidate()};
  const drawGrip=()=>{
   const p=latest.current;if(!p.handles||p.view==='silhouette')return;
   const handle=selectedHandle(p.model,p.selected);if(!handle)return;const mode=gripMode(handle);if(!mode)return;
   const {anchor,at}=gripPoint(handle,mode);
   ctx.save();ctx.strokeStyle=PALETTES[p.appearance].handle;ctx.fillStyle='#151b20d9';ctx.lineWidth=1.5;
   if(mode!=='move'){ctx.globalAlpha=.5;ctx.beginPath();ctx.moveTo(anchor.x,anchor.y);ctx.lineTo(at.x,at.y);ctx.stroke();ctx.globalAlpha=1}
   if(mode==='rotate'){
    ctx.setLineDash([4,5]);ctx.globalAlpha=.5;ctx.beginPath();ctx.arc(anchor.x,anchor.y,72,0,Math.PI*2);ctx.stroke();ctx.setLineDash([]);ctx.globalAlpha=1;
    ctx.beginPath();ctx.arc(at.x,at.y,13,0,Math.PI*2);ctx.fill();ctx.stroke();ctx.fillStyle=PALETTES[p.appearance].handle;ctx.font='11px system-ui';ctx.textAlign='center';ctx.textBaseline='middle';ctx.fillText((p.transformAxis??'z').toUpperCase(),at.x,at.y);
   }else if(mode==='size'){
    ctx.beginPath();ctx.rect(at.x-11,at.y-11,22,22);ctx.fill();ctx.stroke();ctx.beginPath();ctx.moveTo(at.x-6,at.y+6);ctx.lineTo(at.x+6,at.y-6);ctx.moveTo(at.x+1,at.y-6);ctx.lineTo(at.x+6,at.y-6);ctx.lineTo(at.x+6,at.y-1);ctx.moveTo(at.x-1,at.y+6);ctx.lineTo(at.x-6,at.y+6);ctx.lineTo(at.x-6,at.y+1);ctx.stroke();
   }else{ctx.beginPath();ctx.arc(at.x,at.y,13,0,Math.PI*2);ctx.fill();ctx.stroke();ctx.beginPath();ctx.moveTo(at.x-5,at.y);ctx.lineTo(at.x+5,at.y);ctx.moveTo(at.x,at.y-5);ctx.lineTo(at.x,at.y+5);ctx.stroke()}
   ctx.restore();
  };
  const refreshOverlay=()=>{const ratio=Math.min(window.devicePixelRatio||1,2);ctx.setTransform(1,0,0,1,0,0);ctx.clearRect(0,0,surface.width,surface.height);ctx.drawImage(front,0,0);ctx.setTransform(ratio,0,0,ratio,0,0);drawGrip()};
  const publish=()=>{el.dataset.previewStage=displayStage;el.dataset.previewRasterRatio=String(Math.min(window.devicePixelRatio||1,2));setBusy(displayStage!=='ready');frontCtx.setTransform(1,0,0,1,0,0);frontCtx.clearRect(0,0,front.width,front.height);frontCtx.drawImage(back,0,0);refreshOverlay()};
  function draw(){
   frameId=0;if(disposed||document.hidden)return;
   const p=latest.current,ratio=Math.min(window.devicePixelRatio||1,2),cam=activeCamera(),token=revision;
   paintCtx.setTransform(ratio,0,0,ratio,0,0);paintCtx.fillStyle=p.canvasColor??PALETTES[p.appearance].canvas;paintCtx.fillRect(0,0,size.width,size.height);
   if(p.view==='section'){
    if(contours){paintCtx.strokeStyle=PALETTES[p.appearance].handle;paintCtx.lineWidth=1.4;paintCtx.beginPath();for(const line of contours.segments){const a=projectSoftwarePoint({x:line[0],y:line[1],z:p.section},cam,size),b=projectSoftwarePoint({x:line[2],y:line[3],z:p.section},cam,size);paintCtx.moveTo(a.x,a.y);paintCtx.lineTo(b.x,b.y)}paintCtx.stroke()}
    publish();return;
   }
   const mesh=data;if(!mesh){publish();return}paintingDraft=dataIsDraft;
   const key=JSON.stringify([cam,size]);if(mesh!==projectionMesh||key!==projectKey){projection=projectSoftwareMesh(mesh,cam,size,{sortDepth:false});projectionMesh=mesh;projectKey=key}
   const current=projection!;
   const color=p.view==='silhouette'?PALETTES[p.appearance].silhouette:PALETTES[p.appearance].clay,base=[1,3,5].map(i=>parseInt(color.slice(i,i+2),16));
   const rgb=(value:string)=>[1,3,5].map(i=>parseInt(value.slice(i,i+2),16)) as [number,number,number];
   const raster=softwareRasterSteps(current,size.width,size.height,{ratio,background:rgb(p.canvasColor??PALETTES[p.appearance].canvas),color:p.wireframe?rgb(PALETTES[p.appearance].grid):base as [number,number,number],silhouette:p.view==='silhouette',wireframe:p.wireframe});
   // Compute bounded CPU chunks as tasks. RAF pacing belongs to presentation,
   // not hundreds of chunks of geometric work in an embedded/background tab.
   const paint=()=>{
    if(disposed||revision!==token){raster.return(undefined as never);return}
    const started=performance.now();let step=raster.next();
    while(!step.done&&performance.now()-started<8)step=raster.next();
    if(!step.done){continuation=window.setTimeout(paint,0);return}
    continuation=0;paintCtx.setTransform(1,0,0,1,0,0);
    paintCtx.putImageData(new ImageData(step.value.pixels,step.value.width,step.value.height),0,0);
    el!.dataset.previewRenderedTriangles=String(step.value.testedTriangles);
    publish();if(needsDraw){needsDraw=false;invalidate()}
   };
   paint();
  }
  const fit=(view?:import('./viewport').CameraView)=>{if(latest.current.viewLocked)return;if(view)camera=softwareView(camera,view);camera=fitSoftwareCamera(camera,data?.indices.length?data.bounds:modelBounds(latest.current.model,false),size);fitted=true;preemptSurface()};
  const resize=()=>{
   const previous=document.createElement('canvas');previous.width=front.width;previous.height=front.height;previous.getContext('2d')?.drawImage(front,0,0);
   size={width:Math.max(1,el.clientWidth),height:Math.max(1,el.clientHeight)};const ratio=Math.min(window.devicePixelRatio||1,2);
   if(continuation)window.clearTimeout(continuation);continuation=0;needsDraw=false;
   for(const target of [surface,back,front]){target.width=Math.round(size.width*ratio);target.height=Math.round(size.height*ratio)}
   // A keyboard/tray resize keeps the last complete fine frame while the new
   // camera projection is rasterized. Never clear the usable surface to blank.
   if(previous.width&&previous.height)frontCtx.drawImage(previous,0,0,front.width,front.height);
   refreshOverlay();invalidate();
  };
  const complete=(job:Job,mesh?:MeshData,message?:string,milliseconds?:number)=>{
   const result=queue.finish(job.id);
   if(result.accept&&!disposed){
    if(mesh){displayStage=job.draft?'editing':'ready';el.dataset.previewStage='painting';el.dataset.previewResolution=String(mesh.sampling?.resolution??Math.max(0,...(mesh.components??[]).map(c=>c.sampling?.resolution??0)));el.dataset.previewTriangles=String(mesh.indices.length/3);data=mesh;dataIsDraft=job.draft;previous={resolution:job.resolution,milliseconds:milliseconds??0};if(!fitted)fit();latest.current.onSurfaceReady?.();if(!job.draft){latest.current.onMetrics(mesh);void putCachedPreview(cacheKey(job),{mesh})}setError('');preemptSurface();if(job.draft){const revision=job.id;setTimeout(()=>{const r=runtime.current;if(disposed||request!==revision||r?.scheduled?.stage!=='draft')return;r.scheduled={geometry:JSON.stringify(job.model),stage:'settled'};submit(job.model,false)},latest.current.editing?160:0)}}
    else if(message)setError('The surface could not be evaluated. Try a smaller influence.');
    setBusy(!!mesh||job.draft);
   }
   if(result.next)dispatch(result.next);
  };
  const showSurface=(job:Job,mesh:MeshData)=>{
   if(disposed||job.draft||queue.current?.id!==job.id||queue.latestId!==job.id)return;
   displayStage='refining';el.dataset.previewStage='painting';el.dataset.previewResolution=String(mesh.sampling?.resolution??Math.max(0,...(mesh.components??[]).map(c=>c.sampling?.resolution??0)));el.dataset.previewTriangles=String(mesh.indices.length/3);data=mesh;dataIsDraft=false;if(!fitted)fit();latest.current.onSurfaceReady?.();setError('');setBusy(true);preemptSurface();
  };
  const cacheKey=(job:Job)=>previewCacheKey(JSON.stringify(job.model),job.resolution,previewRefinement(false,job.pixelsPerUnit)!.tolerance);
  const dispatch=(job:Job)=>{
   if(disposed)return;
   el.dataset.previewCached='false';if(!job.draft)void getCachedPreview(cacheKey(job)).then(cached=>{if(!cached||disposed||queue.current?.id!==job.id||queue.latestId!==job.id||JSON.stringify(withoutRipples(latest.current.model))!==JSON.stringify(job.model))return;el.dataset.previewCached='true';worker?.postMessage({cancel:job.id});fallback?.abort();complete(job,cached.mesh,undefined,0)});
   if(worker){worker.postMessage(job);return}
   const controller=new AbortController();fallback=controller;const started=performance.now();
   generateMeshAsync(job.model,job.resolution,previewRefinement(job.draft,job.pixelsPerUnit),undefined,{signal:controller.signal,budgetMs:6,draft:job.draft,previewDetail:job.previewDetail,creases:true,...(job.streamSurface?{onSurface:(mesh:MeshData)=>showSurface(job,mesh)}:{})}).then(mesh=>complete(job,mesh,undefined,performance.now()-started),error=>complete(job,undefined,controller.signal.aborted?undefined:String(error))).finally(()=>{if(fallback===controller)fallback=undefined});
  };
  const submit=(model:FormModel,draft:boolean)=>{
   const id=++request;if(queue.current&&queue.current.id!==id){worker?.postMessage({cancel:queue.current.id});fallback?.abort()}queue.invalidate(id);if(document.hidden)queue.pause();
   const mobile=matchMedia('(max-width:760px), (max-width:960px) and (max-height:520px) and (pointer:coarse)').matches,resolution=softwarePreviewResolution(model,{mobile,editing:draft,previous});
   const pixelsPerUnit=camera.scale*Math.min(window.devicePixelRatio||1,2);if(!draft)tolerance=previewRefinement(false,pixelsPerUnit)!.tolerance;setBusy(true);const job=queue.enqueue({id,model,resolution,draft,streamSurface:!draft,pixelsPerUnit,previewDetail:!draft});if(job)dispatch(job);
  };
  let detailTimer:ReturnType<typeof setTimeout>|undefined;
  const requestDetail=()=>{
   if(disposed||!data||latest.current.editing||runtime.current?.scheduled?.stage!=='settled')return;
   const next=previewRefinement(false,camera.scale*Math.min(window.devicePixelRatio||1,2))!.tolerance;
   if(next>=(tolerance??.04))return;
   submit(withoutRipples(latest.current.model),false);
  };
  const scheduleDetail=()=>{if(detailTimer)clearTimeout(detailTimer);detailTimer=setTimeout(requestDetail,160)};
  const section=()=>{
   const p=latest.current;if(p.view!=='section'){sectionTask?.abort();sectionKey='';return}
   const model=withoutRipples(p.model),key=JSON.stringify([model,p.section,p.editing]);if(sectionKey===key)return;sectionKey=key;sectionTask?.abort();
   const id=++sectionRequest,controller=new AbortController();sectionTask=controller;
   sectionContoursAsync(model,p.section,p.editing?48:96,{signal:controller.signal,budgetMs:6}).then(lines=>{if(!disposed&&!controller.signal.aborted&&id===sectionRequest){contours=lines;invalidate()}},()=>{}).finally(()=>{if(sectionTask===controller)sectionTask=undefined});
  };
  const finishDrag=()=>{if(drag?.started)latest.current.onEnd();drag=undefined};
  const validateInteraction=()=>{
   const p=latest.current;
   if(p.editing&&!interactionEditing)preemptDetail();interactionEditing=p.editing;
   if(!drag)return;
   const handle=selectedHandle(p.model,p.selected),mode=handle?gripMode(handle):undefined;
   if(!softwareInteractionShouldCancel({id:drag.handle.id,started:drag.started,mode:drag.mode,axis:drag.axis},{selected:p.selected,editing:p.editing,handles:p.handles&&!!handle,mode,axis:p.transformAxis??'z'}))return;
   clearHold();if(drag.started&&!p.editing)drag=undefined;else finishDrag();
   session.consume();blockedTouchSequence=session.points.size>0;mouse=undefined;invalidate();
  };
  const prepareDrag=(x:number,y:number)=>{const p=latest.current;if(!p.handles||p.view==='silhouette')return;const handle=selectedHandle(p.model,p.selected);if(!handle)return;const mode=gripMode(handle);if(!mode)return;const {anchor,at}=gripPoint(handle,mode);if(projectedHandleHit({x,y},at,24))drag={handle,model:cloneModel(p.model),mode,axis:p.transformAxis??'z',camera:activeCamera(),anchor,previous:{x,y},rotation:0,x,y,started:false}};
  const moveDrag=(x:number,y:number)=>{
   if(!drag)return;const h=drag.handle;
   if(drag.mode==='rotate'){drag.rotation+=directRotationDelta(drag.previous,{x,y},drag.anchor);drag.previous={x,y}}
   const patch=drag.mode==='move'?undefined:directTransformPatch(drag.model,h.id,drag.mode,drag.mode==='size'?directScaleFactor(x-drag.x,y-drag.y):drag.rotation,drag.axis);
   if(drag.mode!=='move'&&!patch)return;clearHold();if(!drag.started){drag.started=true;latest.current.onStart();session.consume()}
   if(drag.mode==='move'){const delta=softwarePlaneDelta(drag.camera,x-drag.x,y-drag.y);if(latest.current.moveAxis){const axis=latest.current.moveAxis,from=projectSoftwarePoint(h,drag.camera,size),point={x:h.x,y:h.y,z:h.z};point[axis]+=1;const to=projectSoftwarePoint(point,drag.camera,size),distance=axisDragDistance(x-drag.x,y-drag.y,to.x-from.x,to.y-from.y,1/drag.camera.scale);delta.x=delta.y=delta.z=0;delta[axis]=distance}latest.current.onDrag(h.id,clamp(h.x+delta.x,...h.ranges.x),clamp(h.y+delta.y,...h.ranges.y),clamp(h.z+delta.z,...h.ranges.z))}
   else if(patch)latest.current.onTransform?.(h.id,patch);
   invalidate();
  };
  const tap=(x:number,y:number,inspect=true)=>{
   if(inspect&&(document.activeElement instanceof HTMLInputElement||document.activeElement instanceof HTMLTextAreaElement))document.activeElement.blur();
   const p=latest.current,h=selectedHandle(p.model,p.selected);
   const mode=h?gripMode(h):undefined;if(h&&mode&&p.handles&&p.view!=='silhouette'&&projectedHandleHit({x,y},gripPoint(h,mode).at,24)){p.onSelect(h.id,inspect);return}
   if(p.view==='section')return;
   const ray=softwareCameraRay(activeCamera(),size,x,y,modelBounds(p.model,false));
   const hit=ray?pickCurrentSurface(p.model,ray):undefined;
   if(hit)p.onSelect(hit.shapeId??(p.model.lattice?.enabled?'lattice':'body'),inspect);
  };
  const pan=(dx:number,dy:number)=>{if(latest.current.viewLocked)return;const delta=softwarePlaneDelta(activeCamera(),dx,dy);camera={...camera,center:{x:camera.center.x-delta.x,y:camera.center.y-delta.y,z:camera.center.z-delta.z}};invalidate()};
  const orbit=(dx:number,dy:number)=>{if(latest.current.viewLocked)return;if(latest.current.view==='section'||latest.current.view==='silhouette'){pan(dx,dy);return}camera={...camera,yaw:camera.yaw-dx*.006,pitch:clamp(camera.pitch+dy*.006,-1.48,1.48)};invalidate()};
  const zoom=(factor:number)=>{if(latest.current.viewLocked)return;camera={...camera,scale:clamp(camera.scale*factor,.025,80)};invalidate()};
  const down=(event:PointerEvent)=>{
   if(event.pointerType!=='touch'&&event.button!==0)return;event.preventDefault();const at=point(event);surface.setPointerCapture(event.pointerId);
   if(event.pointerType==='touch'){
    session.down({id:event.pointerId,...at},performance.now());if(blockedTouchSequence){session.consume();return}if(session.points.size===1){touchOrigin=at;prepareDrag(at.x,at.y);hold=setTimeout(()=>{if(!session.multiple){session.consume();tap(at.x,at.y,true)}},520)}else{clearHold();finishDrag()}
   }else{mouse={...at,moved:false,pan:event.shiftKey};prepareDrag(at.x,at.y)}preemptDetail();
  };
  const move=(event:PointerEvent)=>{
   const at=point(event);
   if(event.pointerType==='touch'){
    if(!session.points.has(event.pointerId))return;event.preventDefault();validateInteraction();const before=session.snapshot();session.move({id:event.pointerId,...at});if(blockedTouchSequence)return;const after=session.snapshot();
    if(after.count===2){clearHold();pan(after.x-before.x,after.y-before.y);if(before.distance>5)zoom(after.distance/before.distance)}
    else if(!session.multiple&&after.count===1){const distance=touchOrigin?Math.hypot(at.x-touchOrigin.x,at.y-touchOrigin.y):0;if(distance>6)clearHold();if(drag){if(drag.started||distance>6)moveDrag(at.x,at.y)}else if(distance>6){session.consume();orbit(after.x-before.x,after.y-before.y)}}
   }else if(mouse){event.preventDefault();validateInteraction();if(!mouse)return;const dx=at.x-mouse.x,dy=at.y-mouse.y;if(Math.hypot(dx,dy)>0)mouse.moved=true;if(drag)moveDrag(at.x,at.y);else if(mouse.pan)pan(dx,dy);else orbit(dx,dy);mouse.x=at.x;mouse.y=at.y}
  };
  const up=(event:PointerEvent)=>{
   const at=point(event);clearHold();validateInteraction();if(event.pointerType==='touch'){
    if(!session.points.has(event.pointerId))return;finishDrag();const action=session.up(event.pointerId,performance.now(),event.type!=='pointerup'||blockedTouchSequence);if(action==='tap')tap(at.x,at.y);else if(action==='undo')latest.current.onUndo();if(!session.points.size){touchOrigin=undefined;blockedTouchSequence=false}
   }else if(mouse){const clicked=!mouse.moved;finishDrag();mouse=undefined;if(clicked&&event.type==='pointerup')tap(at.x,at.y)}
   if(surface.hasPointerCapture(event.pointerId))surface.releasePointerCapture(event.pointerId);invalidate();scheduleDetail();
  };
  const cancel=()=>{clearHold();finishDrag();session.reset();mouse=undefined;touchOrigin=undefined;blockedTouchSequence=false;invalidate()};
  const visibility=()=>{if(document.hidden){cancel();queue.pause();cancelAnimationFrame(frameId);window.clearTimeout(continuation);frameId=0;continuation=0;needsDraw=false}else{const job=queue.resume();if(job)dispatch(job);invalidate()}};
  const wheel=(event:WheelEvent)=>{event.preventDefault();zoom(Math.exp(-event.deltaY*.001));scheduleDetail()};
  const context=(event:Event)=>event.preventDefault();
  surface.addEventListener('pointerdown',down);surface.addEventListener('pointermove',move);surface.addEventListener('pointerup',up);surface.addEventListener('pointercancel',up);surface.addEventListener('lostpointercapture',up);surface.addEventListener('wheel',wheel,{passive:false});surface.addEventListener('contextmenu',context);document.addEventListener('visibilitychange',visibility);window.addEventListener('blur',cancel);
  const observer=new ResizeObserver(resize);observer.observe(el);resize();
  try{worker=new Worker(new URL('../../lib/form-worker.ts',import.meta.url),{type:'module'});worker.onmessage=event=>{const job=queue.current;if(job&&job.id===event.data.id){if(event.data.stage==='surface')showSurface(job,event.data.mesh);else complete(job,event.data.mesh,event.data.error,event.data.milliseconds)}};worker.onerror=()=>{worker?.terminate();worker=undefined;const job=queue.restart();if(job)dispatch(job)}}catch{worker=undefined}
  runtime.current={submit,invalidate,fit,capture:()=>surface.toDataURL('image/png'),section,validateInteraction};
  return()=>{disposed=true;runtime.current=null;if(detailTimer)clearTimeout(detailTimer);queue.dispose();fallback?.abort();sectionTask?.abort();worker?.terminate();cancel();observer.disconnect();cancelAnimationFrame(frameId);window.clearTimeout(continuation);surface.removeEventListener('pointerdown',down);surface.removeEventListener('pointermove',move);surface.removeEventListener('pointerup',up);surface.removeEventListener('pointercancel',up);surface.removeEventListener('lostpointercapture',up);surface.removeEventListener('wheel',wheel);surface.removeEventListener('contextmenu',context);document.removeEventListener('visibilitychange',visibility);window.removeEventListener('blur',cancel)};
 },[]);
 const geometryKey=JSON.stringify(withoutRipples(props.model));
 useEffect(()=>{
  const r=runtime.current;if(!r)return;const model=JSON.parse(geometryKey) as FormModel;
  const submit=(draft:boolean)=>{r.scheduled={geometry:geometryKey,stage:draft?'draft':'settled'};r.submit(model,draft)};
  const stage=previewUpdateStage(r.scheduled,geometryKey,props.editing);
  if(stage&&r.scheduled?.geometry!==geometryKey)submit(true);

 },[geometryKey,props.editing]);
 useEffect(()=>{runtime.current?.section();runtime.current?.invalidate()},[props.view,props.model,props.section,props.handles,props.selected,props.appearance,props.wireframe,props.canvasColor,props.editing,props.transformMode,props.transformAxis]);
 useEffect(()=>{runtime.current?.validateInteraction()},[props.editing,props.handles,props.selected,props.transformMode,props.transformAxis]);
 return <div ref={mount} className="viewport-mount" aria-label="Interactive software form viewport"><canvas ref={canvas} style={{display:'block',width:'100%',height:'100%',touchAction:'none'}} aria-label="Software surface preview"/><span style={{position:'absolute',bottom:8,left:10,fontSize:10,color:'var(--muted-foreground)',pointerEvents:'none'}} title="Real surface and section geometry. Imported component meshes and animated ripples require WebGL.">Software preview</span>{busy&&<span className="evaluating" aria-label="Evaluating"/>}{error&&<div className="viewport-error" role="alert">{error}</div>}{props.model.baseEnabled===false&&!props.model.shapes?.some(shape=>shape.enabled&&shape.operation==='union')&&<div className="viewport-empty"><strong>Start a construction</strong><span>Insert a shape to begin.</span></div>}</div>;
});
