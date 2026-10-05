import type {FormModel} from './form-engine.ts';
import {evaluateBase,withoutRipples} from './form-engine.ts';
import {resolveAttachments} from './attachments.ts';
import {compileShape,isValidSweepPath,SHAPE_LIMITS} from './shapes.ts';
import type {FormShape,ShapeEvaluator} from './shapes.ts';
import type {PlacedAsset} from './assets.ts';
import {scaleSweep,sweepScaleLimits} from './quick-modelling.ts';
import {resolveComponentClearances} from './component-clearance.ts';

export type Point3={x:number;y:number;z:number};
export type ScreenPoint={x:number;y:number;z?:number};
export type DirectTransformMode='move'|'size'|'rotate';
export type DirectTransformPatch={shape?:Partial<FormShape>;asset?:Partial<PlacedAsset>};
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
