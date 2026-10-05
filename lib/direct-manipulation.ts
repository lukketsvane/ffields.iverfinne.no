import type {FormModel} from './form-engine.ts';
import {evaluateBase,withoutRipples} from './form-engine.ts';
import {resolveAttachments} from './attachments.ts';
import {compileShape,SHAPE_LIMITS} from './shapes.ts';

export type Point3={x:number;y:number;z:number};
export type ScreenPoint={x:number;y:number;z?:number};
export type DirectHandle=Point3&{
 id:string;
 kind:'shape'|'asset'|'influence';
 ranges:{x:readonly [number,number];y:readonly [number,number];z:readonly [number,number]};
};

/** The authored origin remains the drag anchor, including for rotated sweeps.
 * Hidden or disabled objects must not leave a draggable handle behind.
 * A component-linked clearance moves with its component, never independently. */
export function selectedHandle(model:FormModel,selected:string):DirectHandle|undefined {
 const shape=model.shapes?.find(s=>s.id===selected&&s.enabled);
 if(shape){
  if(model.componentClearances?.some(link=>link.shapeId===shape.id))return undefined;
  return {id:shape.id,kind:'shape',x:shape.x,y:shape.y,z:shape.z,ranges:{x:SHAPE_LIMITS.x,y:SHAPE_LIMITS.y,z:SHAPE_LIMITS.z}};
 }
 const asset=model.assets?.find(a=>a.id===selected&&a.visible);
 if(asset)return {id:asset.id,kind:'asset',x:asset.x,y:asset.y,z:asset.z,ranges:{x:[-1000,1000],y:[-1000,1000],z:[-1000,1000]}};
 const influence=model.influences.find(f=>f.id===selected&&f.enabled);
 if(influence)return {id:influence.id,kind:'influence',x:influence.x,y:influence.y,z:influence.z,ranges:{x:[-120,120],y:[-65,65],z:[-70,70]}};
 return undefined;
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
 * Ripples are display displacement; the mesh hit is in the static mesh frame. */
export function pickShapeAtPoint(model:FormModel,point:Point3,tolerance=2):string|undefined {
 if(!Number.isFinite(point.x)||!Number.isFinite(point.y)||!Number.isFinite(point.z)||!Number.isFinite(tolerance)||tolerance<0)return undefined;
 const authored=new Set((model.shapes??[]).filter(s=>s.enabled).map(s=>s.id));
 if(!authored.size)return undefined;
 const geometry=resolveAttachments(withoutRipples(model)),shapes=geometry.shapes??[];
 const compiled=shapes.map(s=>s.enabled?compileShape(s):()=>Infinity);
 const field=()=>evaluateBase(geometry,point.x,point.y,point.z,compiled);
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
  compiled[i]=shifted(-step);const minus=field();
  compiled[i]=exact;
  const sensitivity=Math.max(Math.abs(plus-surface),Math.abs(minus-surface))/step;
  if(!Number.isFinite(sensitivity)||sensitivity<.035)continue;
  const distance=Math.abs(rawDistance);
  if(sensitivity>bestSensitivity+.025||(Math.abs(sensitivity-bestSensitivity)<=.025&&distance<=bestDistance)){
   picked=shape.id;bestSensitivity=sensitivity;bestDistance=distance;
  }
 }
 return picked;
}
