import type {FormModel} from './form-engine.ts';
import {evaluateBase,modelBounds,withoutRipples} from './form-engine.ts';
import {resolveAttachments} from './attachments.ts';
import {compileShape} from './shapes.ts';
import type {ShapeEvaluator} from './shapes.ts';
import {pickShapeAtPoint} from './direct-manipulation.ts';
import type {Point3} from './direct-manipulation.ts';

export type PickRay={origin:Point3;direction:Point3};
export type CurrentSurfacePick={point:Point3;shapeId?:string;distance:number};
export type CurrentSurfacePickOptions={maxEvaluations?:number;budgetMs?:number;now?:()=>number};

const axes=['x','y','z'] as const;
const FIELD_EPSILON=1e-5;
const DISTANCE_EPSILON=1e-5;
const DEFAULT_EVALUATIONS=2048;
const DEFAULT_BUDGET_MS=8;
type Sample={distance:number;value:number};

function rayInterval(bounds:readonly number[],ray:PickRay):[number,number]|undefined {
 let entry=0,exit=Infinity;
 for(let index=0;index<3;index++){
  const axis=axes[index],origin=ray.origin[axis],direction=ray.direction[axis];
  if(direction===0){if(origin<bounds[index]||origin>bounds[index+3])return undefined;continue;}
  const a=(bounds[index]-origin)/direction,b=(bounds[index+3]-origin)/direction;
  entry=Math.max(entry,Math.min(a,b));exit=Math.min(exit,Math.max(a,b));
  if(exit<entry)return undefined;
 }
 return Number.isFinite(entry)&&Number.isFinite(exit)?[entry,exit]:undefined;
}

function sampleSpacing(model:FormModel):number {
 let spacing=.5;
 if(model.shell&&!model.lattice?.enabled)spacing=Math.min(spacing,model.wall/4);
 if(model.lattice?.enabled){
  const lattice=model.lattice;
  spacing=Math.min(spacing,lattice.thickness*(1-Math.abs(lattice.gradient))/4);
  if(lattice.skin>0)spacing=Math.min(spacing,lattice.skin/4);
 }
 // Very thin authored skins may exceed a synchronous picking budget. This is
 // a sampling floor, not a guarantee that every sub-step feature is resolved.
 return Math.max(.025,spacing);
}

/** Pick the current static implicit model, independently of any preview mesh.
 * Fixed front-to-back samples do not assume the composed field is an exact or
 * normalized SDF. The first sampled sign bracket is refined with a bounded
 * secant/bisection solve; near positive minima get a bounded grazing search.
 * This is an interaction approximation: sub-step features, multiple crossings
 * inside one sample interval and pathological grazing rays can be missed.
 * Ripples use the same static frame as preview provenance. Starting inside
 * material finds the nearest sampled forward exit, rather than selecting the
 * camera origin. Exhausted budgets return no hit, never an old-mesh fallback.
 * Both compilation and provenance count toward elapsed time; provenance field
 * evaluations are reserved in the total ceiling. A single synchronous field
 * evaluation/compilation cannot be preempted halfway through its execution. */
export function pickCurrentSurface(model:FormModel,ray:PickRay,options:CurrentSurfacePickOptions={}):CurrentSurfacePick|undefined {
 try{
  if(!ray?.origin||!ray?.direction||axes.some(axis=>!Number.isFinite(ray.origin[axis])||!Number.isFinite(ray.direction[axis])))return undefined;
  const length=Math.hypot(ray.direction.x,ray.direction.y,ray.direction.z);
  if(!Number.isFinite(length)||length===0)return undefined;
  const normalized:PickRay={origin:ray.origin,direction:{x:ray.direction.x/length,y:ray.direction.y/length,z:ray.direction.z/length}};
  const requestedEvaluations=options.maxEvaluations??DEFAULT_EVALUATIONS,requestedBudget=options.budgetMs??DEFAULT_BUDGET_MS;
  if(!Number.isFinite(requestedEvaluations)||requestedEvaluations<1||!Number.isFinite(requestedBudget)||requestedBudget<=0)return undefined;
  const maxEvaluations=Math.min(8192,Math.floor(requestedEvaluations)),budgetMs=Math.min(32,requestedBudget),now=options.now??(()=>performance.now()),start=now();
  if(!Number.isFinite(start))return undefined;
  let evaluations=0;
  const withinTime=()=>{const current=now();return Number.isFinite(current)&&current>=start&&current-start<budgetMs;};
  if(!withinTime())return undefined;
  const geometry=resolveAttachments(withoutRipples(model)),bounds=modelBounds(geometry,false);
  if(bounds.length!==6||bounds.some(value=>!Number.isFinite(value)))return undefined;
  const interval=rayInterval(bounds,normalized);
  if(!interval||!withinTime())return undefined;
  const authoredShapes=(model.shapes??[]).filter(shape=>shape.enabled);
  // pickShapeAtPoint uses at most one composed field sample plus two per
  // enabled authored shape. Generated linked cuts may be compiled too but are
  // not provenance candidates unless authored in the input document.
  const provenanceEvaluations=authoredShapes.length?1+2*authoredShapes.length:0;
  if(maxEvaluations<=provenanceEvaluations)return undefined;
  const compiled:ShapeEvaluator[]=[];
  for(const shape of geometry.shapes??[]){if(!withinTime())return undefined;compiled.push(shape.enabled?compileShape(shape):()=>Infinity);}
  const pointAt=(distance:number):Point3=>({x:normalized.origin.x+normalized.direction.x*distance,y:normalized.origin.y+normalized.direction.y*distance,z:normalized.origin.z+normalized.direction.z*distance});
  const sample=(distance:number):Sample|undefined=>{
   if(evaluations+1+provenanceEvaluations>maxEvaluations||!withinTime())return undefined;
   const point=pointAt(distance);evaluations++;
   const value=evaluateBase(geometry,point.x,point.y,point.z,compiled);
   return Number.isFinite(value)?{distance,value}:undefined;
  };
  const finish=(hit:Sample):CurrentSurfacePick|undefined=>{
   if(Math.abs(hit.value)>FIELD_EPSILON||evaluations+provenanceEvaluations>maxEvaluations||!withinTime())return undefined;
   const point=pointAt(hit.distance);
   let attributionAborted=false;
   const shapeId=pickShapeAtPoint(model,point,FIELD_EPSILON*2,{withinBudget(stage){
    if(!withinTime()||(stage==='evaluate'&&evaluations>=maxEvaluations)){attributionAborted=true;return false;}
    if(stage==='evaluate')evaluations++;
    return true;
   }});
   if(attributionAborted||!withinTime())return undefined;
   return {point,distance:hit.distance,...(shapeId?{shapeId}:{})};
  };
  const bracket=(first:Sample,last:Sample):Sample|undefined=>{
   let left=first,right=last,best=Math.abs(left.value)<Math.abs(right.value)?left:right;
   for(let iteration=0;iteration<32;iteration++){
    if(Math.abs(best.value)<=FIELD_EPSILON)return best;
    const span=right.distance-left.distance;
    if(span<=DISTANCE_EPSILON)break;
    const secant=left.distance+span*left.value/(left.value-right.value);
    const distance=iteration%2===1||secant<=left.distance+span*.1||secant>=right.distance-span*.1?(left.distance+right.distance)/2:secant;
    const current=sample(distance);if(!current)return undefined;
    if(Math.abs(current.value)<Math.abs(best.value))best=current;
    if((current.value<0)===(left.value<0))left=current;else right=current;
   }
   return Math.abs(best.value)<=FIELD_EPSILON?best:undefined;
  };
  const grazing=(left:Sample,middle:Sample,right:Sample):Sample|undefined=>{
   let a=left.distance,b=right.distance,best=middle;
   // Only searched after a positive local minimum. Finding material during
   // this search supplies a real sign bracket rather than a near-miss hit.
   for(let iteration=0;iteration<24;iteration++){
    const first=sample(a+(b-a)/3),last=sample(b-(b-a)/3);
    if(!first||!last)return undefined;
    if(first.value<0)return bracket(left,first);
    if(last.value<0)return bracket(left,last);
    if(Math.abs(first.value)<Math.abs(best.value))best=first;
    if(Math.abs(last.value)<Math.abs(best.value))best=last;
    if(first.value<last.value)b=last.distance;else a=first.distance;
   }
   return Math.abs(best.value)<=FIELD_EPSILON?best:undefined;
  };
  let previous=sample(interval[0]);if(!previous)return undefined;
  if(Math.abs(previous.value)<=FIELD_EPSILON)return finish(previous);
  let before:Sample|undefined;
  const spacing=sampleSpacing(geometry);
  for(let distance=interval[0];distance<interval[1];){
   const nextDistance=Math.min(interval[1],distance+spacing);
   if(nextDistance<=distance)return undefined;
   const current=sample(nextDistance);if(!current)return undefined;
   if(Math.abs(current.value)<=FIELD_EPSILON)return finish(current);
   if((previous.value<0)!==(current.value<0)){
    const hit=bracket(previous,current);return hit?finish(hit):undefined;
   }
   if(before&&before.value>0&&previous.value>0&&current.value>0&&previous.value<before.value&&previous.value<current.value&&previous.value<spacing*.25){
    const hit=grazing(before,previous,current);
    if(hit)return finish(hit);
    if(!withinTime()||evaluations+1+provenanceEvaluations>maxEvaluations)return undefined;
   }
   before=previous;previous=current;distance=nextDistance;
  }
  return undefined;
 }catch{return undefined;}
}
