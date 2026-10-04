import type {FormModel} from './form-engine.ts';
import {isSweepShape,shapeBounds,SWEEP_LIMITS,MAX_SHAPES} from './shapes.ts';
import type {FormShape} from './shapes.ts';

export const ATTACHMENT_ANCHORS=['center','x-','x+','y-','y+','z-','z+'] as const;
export type AttachmentAnchor=typeof ATTACHMENT_ANCHORS[number];
export type SweepEndpoint='start'|'end';
export type AttachmentOffset={x:number;y:number;z:number};
export type SweepAttachment={sweepId:string;endpoint:SweepEndpoint;targetShapeId:string;anchor:AttachmentAnchor;offset:AttachmentOffset};
export type AttachmentSelection=Omit<SweepAttachment,'offset'>;
export const ATTACHMENT_LIMITS={offset:[-240,240],count:MAX_SHAPES*2} as const;
const endpointIndex=(shape:FormShape,endpoint:SweepEndpoint)=>endpoint==='start'?0:shape.path!.length-1;
const key=(link:Pick<SweepAttachment,'sweepId'|'endpoint'>)=>link.sweepId+':'+link.endpoint;
const xyz=(a:AttachmentOffset,b:AttachmentOffset)=>Math.abs(a.x-b.x)<1e-9&&Math.abs(a.y-b.y)<1e-9&&Math.abs(a.z-b.z)<1e-9;
function sameLink(a:SweepAttachment,b:SweepAttachment){return a.sweepId===b.sweepId&&a.endpoint===b.endpoint&&a.targetShapeId===b.targetShapeId&&a.anchor===b.anchor&&xyz(a.offset,b.offset);}
function rotation(shape:FormShape){
 const a=shape.rx*Math.PI/180,b=shape.ry*Math.PI/180,c=shape.rz*Math.PI/180,cx=Math.cos(a),sx=Math.sin(a),cy=Math.cos(b),sy=Math.sin(b),cz=Math.cos(c),sz=Math.sin(c);
 return [cy*cz,-cy*sz,sy,cx*sz+sx*sy*cz,cx*cz-sx*sy*sz,-sx*cy,sx*sz-cx*sy*cz,sx*cz+cx*sy*sz,cx*cy];
}
export function attachmentLocalToWorld(shape:FormShape,p:AttachmentOffset):AttachmentOffset {
 const r=rotation(shape);return {x:shape.x+r[0]*p.x+r[1]*p.y+r[2]*p.z,y:shape.y+r[3]*p.x+r[4]*p.y+r[5]*p.z,z:shape.z+r[6]*p.x+r[7]*p.y+r[8]*p.z};
}
export function attachmentWorldToLocal(shape:FormShape,p:AttachmentOffset):AttachmentOffset {
 const r=rotation(shape),x=p.x-shape.x,y=p.y-shape.y,z=p.z-shape.z;return {x:r[0]*x+r[3]*y+r[6]*z,y:r[1]*x+r[4]*y+r[7]*z,z:r[2]*x+r[5]*y+r[8]*z};
}
/** Center is the local origin. Face anchors are local bounding-face centers;
 * sweep bounds come from its actual path, including curve/radius overshoot.
 * These are stable modelling references, not validated contact surfaces. */
export function attachmentAnchor(shape:FormShape,anchor:AttachmentAnchor):AttachmentOffset {
 if(!ATTACHMENT_ANCHORS.includes(anchor))throw Error('Invalid attachment anchor.');
 if(anchor==='center')return {x:0,y:0,z:0};
 const bounds=shape.kind==='sweep'?shapeBounds({...shape,x:0,y:0,z:0,rx:0,ry:0,rz:0}):[-shape.width/2,-shape.height/2,-shape.depth/2,shape.width/2,shape.height/2,shape.depth/2];
 const center={x:(bounds[0]+bounds[3])/2,y:(bounds[1]+bounds[4])/2,z:(bounds[2]+bounds[5])/2},axis=anchor[0] as 'x'|'y'|'z',index=['x','y','z'].indexOf(axis);
 center[axis]=bounds[index+(anchor[1]==='+'?3:0)];return center;
}

/** Strict graph validation. Disabled targets keep their references and still
 * define anchor transforms: visibility is not deletion or a broken link. */
export function validateAttachments(model:FormModel):void {
 if(model.attachments===undefined)return;
 if(!Array.isArray(model.attachments)||model.attachments.length>ATTACHMENT_LIMITS.count)throw Error('Invalid sweep attachment list.');
 const shapes=new Map((model.shapes??[]).map(shape=>[shape.id,shape])),occupied=new Set<string>(),dependencies=new Map<string,string[]>();
 for(const link of model.attachments){
  if(!link||typeof link!=='object'||Array.isArray(link)||typeof link.sweepId!=='string'||!link.sweepId.length||typeof link.targetShapeId!=='string'||!link.targetShapeId.length||!['start','end'].includes(link.endpoint)||!ATTACHMENT_ANCHORS.includes(link.anchor)||!link.offset||typeof link.offset!=='object'||Array.isArray(link.offset))throw Error('Invalid sweep attachment.');
  const sweep=shapes.get(link.sweepId),target=shapes.get(link.targetShapeId);
  if(!sweep||!isSweepShape(sweep)||!target)throw Error('Attachment references a missing sweep or target.');
  if(link.sweepId===link.targetShapeId)throw Error('A sweep cannot attach to itself.');
  if(occupied.has(key(link)))throw Error('A sweep endpoint can have only one attachment.');occupied.add(key(link));
  for(const axis of ['x','y','z'] as const){const value=link.offset[axis];if(typeof value!=='number'||!Number.isFinite(value)||value<ATTACHMENT_LIMITS.offset[0]||value>ATTACHMENT_LIMITS.offset[1])throw Error('Invalid attachment offset.');}
  const edges=dependencies.get(link.sweepId)??[];edges.push(link.targetShapeId);dependencies.set(link.sweepId,edges);
 }
 const visited=new Set<string>(),active=new Set<string>();
 function visit(id:string){if(active.has(id))throw Error('Sweep attachments cannot contain a cycle.');if(visited.has(id))return;active.add(id);for(const target of dependencies.get(id)??[])visit(target);active.delete(id);visited.add(id);}
 for(const id of dependencies.keys())visit(id);
}

/** Chooser guard, including indirect sweep dependencies. Sweep-to-sweep links
 * are supported as long as their design-intent graph remains acyclic. */
export function canAttachTo(model:FormModel,sweepId:string,targetShapeId:string){
 const shapes=model.shapes??[],source=shapes.find(shape=>shape.id===sweepId);
 if(!source||!isSweepShape(source)||sweepId===targetShapeId||!shapes.some(shape=>shape.id===targetShapeId))return false;
 const seen=new Set<string>();function reaches(id:string):boolean{if(id===sweepId)return true;if(seen.has(id))return false;seen.add(id);return (model.attachments??[]).filter(link=>link.sweepId===id).some(link=>reaches(link.targetShapeId));}
 return !reaches(targetShapeId);
}

/** Pure deterministic topological resolution. Only rewritten sweep paths are
 * copied. Unchanged documents retain their identity and cached geometry. */
export function resolveAttachments(model:FormModel):FormModel {
 validateAttachments(model);if(!model.attachments?.length)return model;
 const shapes=new Map((model.shapes??[]).map(shape=>[shape.id,shape])),links=new Map<string,SweepAttachment[]>(),resolved=new Set<string>();let changed=false;
 for(const link of model.attachments){const list=links.get(link.sweepId)??[];list.push(link);links.set(link.sweepId,list);}
 function resolve(id:string){
  if(resolved.has(id))return;
  const attachments=links.get(id)??[];for(const link of attachments)resolve(link.targetShapeId);
  let sweep=shapes.get(id)!;
  for(const link of attachments){
   const target=shapes.get(link.targetShapeId)!,anchor=attachmentAnchor(target,link.anchor),world=attachmentLocalToWorld(target,{x:anchor.x+link.offset.x,y:anchor.y+link.offset.y,z:anchor.z+link.offset.z}),local=attachmentWorldToLocal(sweep,world),index=endpointIndex(sweep,link.endpoint),point=sweep.path![index];
   for(const axis of ['x','y','z'] as const){if(local[axis]<SWEEP_LIMITS.coordinate[0]-1e-7||local[axis]>SWEEP_LIMITS.coordinate[1]+1e-7)throw Error('Attachment moves a sweep endpoint outside the supported path range.');local[axis]=Math.max(SWEEP_LIMITS.coordinate[0],Math.min(SWEEP_LIMITS.coordinate[1],local[axis]));}
   if(!xyz(local,point)){const path=[...sweep.path!];path[index]={...point,...local};sweep={...sweep,path};shapes.set(id,sweep);changed=true;}
  }
  resolved.add(id);
 }
 for(const id of links.keys())resolve(id);
 return changed?{...model,shapes:(model.shapes??[]).map(shape=>shapes.get(shape.id)!)}:model;
}

/** Capture a target-local offset without moving the current endpoint. */
export function attachmentForEndpoint(model:FormModel,selection:AttachmentSelection):SweepAttachment {
 const resolved=resolveAttachments(model),sweep=resolved.shapes?.find(shape=>shape.id===selection.sweepId),target=resolved.shapes?.find(shape=>shape.id===selection.targetShapeId);
 if(!sweep||!isSweepShape(sweep)||!target||!canAttachTo(resolved,selection.sweepId,selection.targetShapeId))throw Error('Choose an acyclic sweep attachment target.');
 if(!['start','end'].includes(selection.endpoint))throw Error('Invalid sweep endpoint.');
 const endpoint=sweep.path[endpointIndex(sweep,selection.endpoint)],world=attachmentLocalToWorld(sweep,endpoint),local=attachmentWorldToLocal(target,world),anchor=attachmentAnchor(target,selection.anchor);
 const link={...selection,offset:{x:local.x-anchor.x,y:local.y-anchor.y,z:local.z-anchor.z}};
 const candidate={...resolved,attachments:[...(resolved.attachments??[]).filter(existing=>key(existing)!==key(link)),link]};validateAttachments(candidate);return link;
}

/** Normalize a RAW edit. Direct endpoint coordinate changes detach that point;
 * radius/interior/section edits retain its link. Removing a target freezes the
 * previously resolved endpoint before dropping its link. Mirrored copies have
 * no copied links, so they freeze their reflected construction unless explicitly
 * reattached. Already-resolved command output should use resolveAttachments. */
export function reconcileAttachments(previous:FormModel,next:FormModel):FormModel {
 const before=resolveAttachments(previous),beforeShapes=new Map((before.shapes??[]).map(shape=>[shape.id,shape])),nextShapes=new Map((next.shapes??[]).map(shape=>[shape.id,shape])),beforeLinks=new Map((before.attachments??[]).map(link=>[key(link),link]));
 if(next.attachments===undefined)return next;
 if(!Array.isArray(next.attachments))throw Error('Invalid sweep attachment list.');
 const kept:SweepAttachment[]=[];let changed=false;
 for(const link of next.attachments){
  const sweep=nextShapes.get(link.sweepId),oldSweep=beforeShapes.get(link.sweepId),oldLink=beforeLinks.get(key(link));
  if(!sweep){changed=true;continue;}
  if(!isSweepShape(sweep))throw Error('Only curved sweep endpoints can be attached.');
  const index=endpointIndex(sweep,link.endpoint),point=sweep.path[index],oldPoint=oldSweep&&isSweepShape(oldSweep)?oldSweep.path[endpointIndex(oldSweep,link.endpoint)]:undefined;
  if(!nextShapes.has(link.targetShapeId)){
   if(!oldLink||!oldPoint)throw Error('Attachment references a missing target.');
   const frozen=attachmentWorldToLocal(sweep,attachmentLocalToWorld(oldSweep!,oldPoint));
   if(!xyz(point,frozen)){const path=[...sweep.path];path[index]={...point,...frozen};nextShapes.set(sweep.id,{...sweep,path});}changed=true;continue;
  }
  if(oldLink&&sameLink(oldLink,link)&&oldPoint&&!xyz(point,oldPoint)){changed=true;continue;}
  kept.push(link);
 }
 const reconciled=changed?{...next,shapes:(next.shapes??[]).map(shape=>nextShapes.get(shape.id)!),attachments:kept}:next;
 return resolveAttachments(reconciled);
}
