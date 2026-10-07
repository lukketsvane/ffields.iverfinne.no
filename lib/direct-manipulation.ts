import type {FormModel} from './form-engine.ts';
import {evaluateBase,withoutRipples,LIMITS} from './form-engine.ts';
import {resolveAttachments} from './attachments.ts';
import {compileShape,isValidSweepPath,shapeBounds,SHAPE_LIMITS} from './shapes.ts';
import type {FormShape,ShapeEvaluator} from './shapes.ts';
import type {PlacedAsset} from './assets.ts';
import {scaleSweep,sweepScaleLimits} from './quick-modelling.ts';
import {resolveComponentClearances} from './component-clearance.ts';

export type Point3={x:number;y:number;z:number};
export type ScreenPoint={x:number;y:number;z?:number};
export type DirectTransformMode='move'|'size'|'rotate';
export type DirectTransformPatch={shape?:Partial<FormShape>;asset?:Partial<PlacedAsset>;base?:Partial<Pick<FormModel,'width'|'height'|'depth'>>};
type Axis='x'|'y'|'z';
const axes:readonly Axis[]=['x','y','z'];
const bounded=(value:number,min:number,max:number)=>Math.max(min,Math.min(max,value));
const wrappedDegrees=(value:number)=>((value+180)%360+360)%360-180;
const protectedShape=(model:FormModel,id:string)=>model.componentClearances?.some(link=>link.shapeId===id)||model.attachments?.some(link=>link.sweepId===id);
export type DirectHandle=Point3&{
 id:string;
 kind:'shape'|'asset'|'influence';
 ranges:{x:readonly [number,number];y:readonly [number,number];z:readonly [number,number]};
};

/** The authored origin remains the drag anchor, including for rotated sweeps.
 * Hidden or disabled objects must not leave a draggable handle behind.
 * Linked clearances move with their components; attached curves retain their
 * endpoint anchors instead of offering an independent transform handle. */
export function selectedHandle(model:FormModel,selected:string):DirectHandle|undefined {
 const shape=model.shapes?.find(s=>s.id===selected&&s.enabled);
 if(shape){
  if(protectedShape(model,shape.id))return undefined;
  return {id:shape.id,kind:'shape',x:shape.x,y:shape.y,z:shape.z,ranges:{x:SHAPE_LIMITS.x,y:SHAPE_LIMITS.y,z:SHAPE_LIMITS.z}};
 }
 const asset=model.assets?.find(a=>a.id===selected&&a.visible);
 if(asset)return {id:asset.id,kind:'asset',x:asset.x,y:asset.y,z:asset.z,ranges:{x:[-1000,1000],y:[-1000,1000],z:[-1000,1000]}};
 const influence=model.influences.find(f=>f.id===selected&&f.enabled);
 if(influence)return {id:influence.id,kind:'influence',x:influence.x,y:influence.y,z:influence.z,ranges:{x:[-120,120],y:[-65,65],z:[-70,70]}};
 return undefined;
}

/** Return an absolute patch computed from the immutable pointer-down model.
 * Move uses a millimetre delta along an axis; size uses a positive uniform
 * factor; rotate uses a degree delta normalized to an equivalent ±180° angle.
 * Repeated drag frames never compound.
 * Components retain their linked cuts. Attached curve sources are protected;
 * transforming their target is allowed only while every anchor remains valid. */
export function directTransformPatch(model:FormModel,id:string,mode:DirectTransformMode,amount:number,axis:Axis='z'):DirectTransformPatch|undefined {
 if(!Number.isFinite(amount)||!axes.includes(axis)||!['move','size','rotate'].includes(mode)||(mode==='size'&&amount<=0))return undefined;
 const shape=model.shapes?.find(s=>s.id===id&&s.enabled);
 let result:DirectTransformPatch;
 if(shape){
  if(protectedShape(model,id)||!['sphere','box','capsule','cylinder','torus','sweep'].includes(shape.kind))return undefined;
  if(['x','y','z','rx','ry','rz','width','height','depth','roundness','blend'].some(key=>!Number.isFinite(shape[key as keyof typeof SHAPE_LIMITS])))return undefined;
  let patch:Partial<FormShape>;
  if(mode==='move')patch={[axis]:bounded(shape[axis]+amount,...SHAPE_LIMITS[axis])};
  else if(mode==='rotate'){
   const rotation=`r${axis}` as 'rx'|'ry'|'rz';
   patch={[rotation]:wrappedDegrees(wrappedDegrees(shape[rotation])+wrappedDegrees(amount))};
  }else{
   if(shape.width<=0||shape.height<=0||shape.depth<=0||shape.roundness<0||shape.blend<0)return undefined;
   let min=0,max=Infinity;
   for(const dimension of ['width','height','depth'] as const){min=Math.max(min,SHAPE_LIMITS[dimension][0]/shape[dimension]);max=Math.min(max,SHAPE_LIMITS[dimension][1]/shape[dimension]);}
   if(shape.kind==='sweep'){
    if(!isValidSweepPath(shape.path,shape.closed??false))return undefined;
    const limits=sweepScaleLimits(shape);min=Math.max(min,limits[0]);max=Math.min(max,limits[1]);
   }
   // Box/capsule rounding is a length. Their evaluator already limits it to
   // the smallest half-size; retain that actual radius under uniform scaling.
   if((shape.kind==='box'||shape.kind==='capsule')&&shape.roundness>0){const radius=Math.min(shape.roundness,shape.width/2,shape.height/2,shape.depth/2);max=Math.min(max,SHAPE_LIMITS.roundness[1]/radius);}
   if(!Number.isFinite(min)||!Number.isFinite(max)||min>max)return undefined;
   const factor=bounded(amount,min,max);
   patch=shape.kind==='sweep'?scaleSweep(shape,factor):{width:bounded(shape.width*factor,...SHAPE_LIMITS.width),height:bounded(shape.height*factor,...SHAPE_LIMITS.height),depth:bounded(shape.depth*factor,...SHAPE_LIMITS.depth)};
   patch.roundness=shape.kind==='torus'?shape.roundness:bounded(shape.roundness*factor,...SHAPE_LIMITS.roundness);
   patch.blend=bounded(shape.blend*factor,...SHAPE_LIMITS.blend);
  }
  result={shape:patch};
 }else{
  const asset=model.assets?.find(a=>a.id===id&&a.visible);
  if(!asset||['x','y','z','rx','ry','rz','scale'].some(key=>!Number.isFinite(asset[key as 'x'|'y'|'z'|'rx'|'ry'|'rz'|'scale']))||asset.scale<=0)return undefined;
  const rotation=`r${axis}` as 'rx'|'ry'|'rz';
  result={asset:mode==='size'?{scale:bounded(asset.scale*amount,.05,10)}:mode==='rotate'?{[rotation]:wrappedDegrees(wrappedDegrees(asset[rotation])+wrappedDegrees(amount))}:{[axis]:bounded(asset[axis]+amount,-1000,1000)}};
 }
 // Check linked geometry without changing or reconciling away any link.
 // Unsupported anchor motion returns no patch instead of silently detaching.
 if(model.attachments?.length||model.componentClearances?.length){
  const candidate={...model,shapes:model.shapes?.map(s=>s.id===id&&result.shape?{...s,...result.shape}:s),assets:model.assets?.map(a=>a.id===id&&result.asset?{...a,...result.asset}:a)};
  try{resolveAttachments(resolveComponentClearances(candidate));}catch{return undefined;}
 }
 return result;
}

/** Grip positions are CSS pixels relative to the projected authored origin. */
export function directGripOffset(mode:DirectTransformMode):{x:number;y:number} {
 return mode==='size'?{x:56,y:-40}:mode==='rotate'?{x:0,y:-72}:{x:0,y:0};
}

/** Drag right/up to grow, left/down to shrink; clamp before exponentiation. */
export function directScaleFactor(dx:number,dy:number):number {
 if(!Number.isFinite(dx)||!Number.isFinite(dy))return 1;
 return Math.exp(bounded((dx-dy)/180,-Math.log(4),Math.log(4)));
}

/** Screen Y points down, so flip it for ordinary positive rotation degrees.
 * Crossing the angular seam takes the shorter turn, without a 360° jump. */
export function directRotationDelta(start:ScreenPoint,current:ScreenPoint,anchor:ScreenPoint):number {
 if([start.x,start.y,current.x,current.y,anchor.x,anchor.y].some(value=>!Number.isFinite(value)))return 0;
 const sx=start.x-anchor.x,sy=anchor.y-start.y,cx=current.x-anchor.x,cy=anchor.y-current.y;
 if(Math.hypot(sx,sy)<1e-6||Math.hypot(cx,cy)<1e-6)return 0;
 const delta=Math.atan2(cy,cx)-Math.atan2(sy,sx);
 return Math.atan2(Math.sin(delta),Math.cos(delta))*180/Math.PI;
}

/** Compare CSS pixels so a finger target stays the same size at every zoom.
 * Optional z is normalized device depth: a handle behind/outside the camera
 * cannot intercept a touch even if its projected x/y overlap the screen. */
export function projectedHandleHit(pointer:ScreenPoint,projected:ScreenPoint,radius=24):boolean {
 if(!Number.isFinite(pointer.x)||!Number.isFinite(pointer.y)||!Number.isFinite(projected.x)||!Number.isFinite(projected.y)||!Number.isFinite(radius)||radius<0)return false;
 if(projected.z!==undefined&&(!Number.isFinite(projected.z)||projected.z< -1||projected.z>1))return false;
 return Math.hypot(pointer.x-projected.x,pointer.y-projected.y)<=radius;
}

/** Pick provenance at a mesh intersection, not merely the closest centre.
 * A small two-sided perturbation measures which authored field contributes
 * to the displayed CSG surface. It rejects buried unions and inactive cuts,
 * handles smooth blends and coincident primitives, and follows the same
 * transforms, attachment resolution, shell and lattice as preview meshing.
 * This is a local selection heuristic, not an exact distance/analysis query.
 * Ripples are display displacement; the mesh hit is in the static mesh frame.
 * An optional budget guard can stop before each compilation or composed field
 * evaluation. Without that guard existing unbudgeted callers are unchanged. */
export type ShapePickOptions={withinBudget?:(stage:'compile'|'evaluate')=>boolean};
export function pickShapeAtPoint(model:FormModel,point:Point3,tolerance=2,options:ShapePickOptions={}):string|undefined {
 if(!Number.isFinite(point.x)||!Number.isFinite(point.y)||!Number.isFinite(point.z)||!Number.isFinite(tolerance)||tolerance<0)return undefined;
 const authored=new Set((model.shapes??[]).filter(s=>s.enabled).map(s=>s.id));
 if(!authored.size)return undefined;
 if(options.withinBudget&&!options.withinBudget('compile'))return undefined;
 const geometry=resolveAttachments(withoutRipples(model)),shapes=geometry.shapes??[];
 const compiled:ShapeEvaluator[]=[];
 for(const shape of shapes){if(options.withinBudget&&!options.withinBudget('compile'))return undefined;compiled.push(shape.enabled?compileShape(shape):()=>Infinity);}
 let aborted=false;
 const field=()=>{if(options.withinBudget&&!options.withinBudget('evaluate')){aborted=true;return NaN;}return evaluateBase(geometry,point.x,point.y,point.z,compiled);};
 const surface=field();
 if(!Number.isFinite(surface)||Math.abs(surface)>tolerance)return undefined;
 const step=.25;
 let picked:string|undefined,bestSensitivity=0,bestDistance=Infinity;
 for(let i=0;i<shapes.length;i++){
  const shape=shapes[i];
  if(!authored.has(shape.id)||!shape.enabled)continue;
  const exact=compiled[i];let rawDistance=Infinity;
  // Respect finite CSG early-out limits when adding a bias. The adjusted
  // evaluator must see the correspondingly adjusted limit, too.
  const shifted=(bias:number)=>(x:number,y:number,z:number,limit=Infinity)=>{
   const value=exact(x,y,z,limit-bias);
   rawDistance=value;
   return value+bias;
  };
  compiled[i]=shifted(step);const plus=field();
  if(aborted){compiled[i]=exact;return undefined;}
  compiled[i]=shifted(-step);const minus=field();
  compiled[i]=exact;
  if(aborted)return undefined;
  const sensitivity=Math.max(Math.abs(plus-surface),Math.abs(minus-surface))/step;
  if(!Number.isFinite(sensitivity)||sensitivity<.035)continue;
  const distance=Math.abs(rawDistance);
  if(sensitivity>bestSensitivity+.025||(Math.abs(sensitivity-bestSensitivity)<=.025&&distance<=bestDistance)){
   picked=shape.id;bestSensitivity=sensitivity;bestDistance=distance;
  }
 }
 return picked;
}

type Euler={rx:number;ry:number;rz:number};
/** Row-major rotation for degrees in the Three.js 'XYZ' order used by shapes and asset groups. */
export function eulerMatrix(rx:number,ry:number,rz:number):number[] {
 const ax=rx*Math.PI/180,ay=ry*Math.PI/180,az=rz*Math.PI/180,cx=Math.cos(ax),sx=Math.sin(ax),cy=Math.cos(ay),sy=Math.sin(ay),cz=Math.cos(az),sz=Math.sin(az);
 return [cy*cz,-cy*sz,sy,cx*sz+sx*sy*cz,cx*cz-sx*sy*sz,-sx*cy,sx*sz-cx*sy*cz,sx*cz+cx*sy*sz,cx*cy];
}
function eulerFromMatrix(r:number[]):Euler {
 const y=Math.asin(bounded(r[2],-1,1));
 const [x,z]=Math.abs(r[2])<.9999999?[Math.atan2(-r[5],r[8]),Math.atan2(-r[1],r[0])]:[Math.atan2(r[7],r[4]),0];
 const degrees=(value:number)=>Math.round(wrappedDegrees(value*180/Math.PI)*1e6)/1e6;
 return {rx:degrees(x),ry:degrees(y),rz:degrees(z)};
}
/** Turn an authored orientation about a world axis through its own centre.
 * The twist follows what the person sees, whatever the object's current Euler angles. */
export function rotateAboutWorldAxis(rotation:Euler,axis:Point3,radians:number):Euler {
 const length=Math.hypot(axis.x,axis.y,axis.z);
 if(!Number.isFinite(radians)||!Number.isFinite(length)||length<1e-12||!radians)return {...rotation};
 const x=axis.x/length,y=axis.y/length,z=axis.z/length,c=Math.cos(radians),s=Math.sin(radians),k=1-c;
 const q=[c+x*x*k,x*y*k-z*s,x*z*k+y*s,y*x*k+z*s,c+y*y*k,y*z*k-x*s,z*x*k-y*s,z*y*k+x*s,c+z*z*k];
 const r=eulerMatrix(rotation.rx,rotation.ry,rotation.rz),m=new Array<number>(9);
 for(let i=0;i<3;i++)for(let j=0;j<3;j++)m[i*3+j]=q[i*3]*r[j]+q[i*3+1]*r[3+j]+q[i*3+2]*r[6+j];
 return eulerFromMatrix(m);
}

export type DirectComposite={move?:Point3;scale?:number;turn?:{axis:Point3;radians:number}};
/** One absolute patch for a whole two-finger or grab gesture, computed from the
 * immutable model at gesture start: pan moves, pinch scales about the centre,
 * twist turns about the view axis. The base mass only scales. */
export function composeDirectPatch(model:FormModel,id:string,change:DirectComposite):DirectTransformPatch|undefined {
 const scale=change.scale!==undefined&&Number.isFinite(change.scale)&&change.scale>0&&change.scale!==1?change.scale:undefined;
 const turn=change.turn&&Number.isFinite(change.turn.radians)&&change.turn.radians!==0?change.turn:undefined;
 const move=change.move&&[change.move.x,change.move.y,change.move.z].every(Number.isFinite)&&(change.move.x||change.move.y||change.move.z)?change.move:undefined;
 if(id==='body'){
  if(model.baseEnabled===false||!scale)return undefined;
  let min=0,max=Infinity;
  for(const key of ['width','height','depth'] as const){min=Math.max(min,LIMITS[key][0]/model[key]);max=Math.min(max,LIMITS[key][1]/model[key]);}
  if(!(min<=max))return undefined;
  const factor=bounded(scale,min,max);
  return {base:{width:bounded(model.width*factor,...LIMITS.width),height:bounded(model.height*factor,...LIMITS.height),depth:bounded(model.depth*factor,...LIMITS.depth)}};
 }
 const handle=selectedHandle(model,id);
 if(!handle||handle.kind==='influence'||(!scale&&!turn&&!move))return undefined;
 const shape=handle.kind==='shape'?model.shapes!.find(s=>s.id===id)!:undefined,asset=handle.kind==='asset'?model.assets!.find(a=>a.id===id)!:undefined;
 const patch:Record<string,unknown>={};
 if(scale){const sized=directTransformPatch(model,id,'size',scale);Object.assign(patch,sized?.shape??sized?.asset??{});}
 if(turn){const object=(shape??asset)!;Object.assign(patch,rotateAboutWorldAxis({rx:object.rx,ry:object.ry,rz:object.rz},turn.axis,turn.radians));}
 if(move)for(const axis of axes)patch[axis]=bounded(handle[axis]+move[axis],...handle.ranges[axis]);
 if(!Object.keys(patch).length)return undefined;
 const result:DirectTransformPatch=shape?{shape:patch as Partial<FormShape>}:{asset:patch as Partial<PlacedAsset>};
 if(model.attachments?.length||model.componentClearances?.length){
  const candidate={...model,shapes:model.shapes?.map(s=>s.id===id&&result.shape?{...s,...result.shape}:s),assets:model.assets?.map(a=>a.id===id&&result.asset?{...a,...result.asset}:a)};
  try{resolveAttachments(resolveComponentClearances(candidate));}catch{return undefined;}
 }
 return result;
}

/** The box a selection is drawn and touched by: oriented for primitives and
 * measured components, axis-aligned for sweeps and the base mass. */
export function selectionFrame(model:FormModel,id:string):{center:Point3;corners:Point3[];size:[number,number,number];rotation:Euler}|undefined {
 const box=(center:Point3,size:[number,number,number],rotation:Euler)=>{
  const r=eulerMatrix(rotation.rx,rotation.ry,rotation.rz),corners:Point3[]=[];
  for(const sx of [-1,1])for(const sy of [-1,1])for(const sz of [-1,1]){
   const lx=sx*size[0]/2,ly=sy*size[1]/2,lz=sz*size[2]/2;
   corners.push({x:center.x+r[0]*lx+r[1]*ly+r[2]*lz,y:center.y+r[3]*lx+r[4]*ly+r[5]*lz,z:center.z+r[6]*lx+r[7]*ly+r[8]*lz});
  }
  return {center,corners,size,rotation};
 };
 const shape=model.shapes?.find(s=>s.id===id&&s.enabled);
 if(shape){
  if(shape.kind!=='sweep')return box({x:shape.x,y:shape.y,z:shape.z},[shape.width,shape.height,shape.depth],{rx:shape.rx,ry:shape.ry,rz:shape.rz});
  const b=shapeBounds(shape);
  return box({x:(b[0]+b[3])/2,y:(b[1]+b[4])/2,z:(b[2]+b[5])/2},[b[3]-b[0],b[4]-b[1],b[5]-b[2]],{rx:0,ry:0,rz:0});
 }
 const asset=model.assets?.find(a=>a.id===id&&a.visible);
 if(asset?.envelope)return box({x:asset.x,y:asset.y,z:asset.z},asset.envelope.map(v=>v*asset.scale) as [number,number,number],{rx:asset.rx,ry:asset.ry,rz:asset.rz});
 if(id==='body'&&model.baseEnabled!==false)return box({x:0,y:0,z:0},[model.width,model.height,model.depth],{rx:0,ry:0,rz:0});
 return undefined;
}
