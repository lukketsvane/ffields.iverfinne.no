import {makeShape,SHAPE_LIMITS} from './shapes.ts';
import type {FormShape,ShapeKind,ShapeOperation} from './shapes.ts';
import type {FormModel} from './form-engine.ts';
import {DEFAULT_LATTICE} from './lattice.ts';

const bounded=(value:number,min:number,max:number)=>Math.min(max,Math.max(min,value));

/** Mode changes retain authored cell/skin/region settings for the next visit. */
export function materialModePatch(model:FormModel,mode:'solid'|'hollow'|'cellular'):Partial<FormModel> {
 return {shell:mode==='hollow',lattice:{...(model.lattice??DEFAULT_LATTICE),enabled:mode==='cellular',...(!model.lattice&&mode==='cellular'?{reveal:.6}:{})}};
}

/** A touch insertion begins where the person is working, with a useful cut
 * depth and an explicit Boolean operation. It never fits or changes the view. */
export function quickShape(model:FormModel,kind:ShapeKind,operation:ShapeOperation,selected:string):FormShape {
 const result=makeShape(kind),anchor=model.shapes?.find(shape=>shape.id===selected),component=model.assets?.find(asset=>asset.id===selected),hasSolid=model.baseEnabled!==false||model.shapes?.some(shape=>shape.enabled&&shape.operation==='union');
 const envelope=component?.envelope?.map(dimension=>dimension*component.scale),width=anchor?.width??envelope?.[0]??model.width,height=anchor?.height??envelope?.[1]??model.height,depth=anchor?.depth??envelope?.[2]??model.depth;
 result.operation=operation;result.blend=operation==='union'?result.blend:0;
 result.x=anchor?.x??component?.x??0;result.y=anchor?.y??component?.y??0;result.z=anchor?.z??component?.z??0;
 if(operation==='subtract'){
  result.width=bounded(width*.38,8,96);result.height=bounded(height*.38,8,96);result.depth=bounded(depth+12,16,240);
  if(kind==='cylinder'){
   // The cylinder's native axis is Y; a front-to-back hole runs along Z.
   result.rx=90;result.height=result.depth;result.depth=result.width;
  }
  result.roundness=kind==='box'?Math.min(4,result.width/4,result.height/4):result.roundness;
 }else if(hasSolid){
  // New solid overlaps the selected primitive/base instead of appearing as an
  // unexplained disconnected object far outside the working area.
  result.x=bounded(result.x+(width+result.width)*.22,...SHAPE_LIMITS.x);
 }
 const peers=model.shapes?.filter(shape=>shape.kind===kind).length??0;
 result.name=(operation==='subtract'?'Cut · ':'')+result.name+(peers?' '+(peers+1):'');
 return result;
}

/** Exact, uniform size edits for authored sweep geometry. Width/height/depth
 * alone do not resize a sweep. Bounds include every control and radius so the
 * quick editor cannot produce a path rejected by the construction validator. */
export function sweepScaleLimits(shape:FormShape):readonly [number,number] {
 if(shape.kind!=='sweep'||!shape.path?.length)return [1,1];
 let min=0,max=Infinity;
 for(const key of ['width','height','depth'] as const){min=Math.max(min,4/shape[key]);max=Math.min(max,240/shape[key]);}
 for(const point of shape.path){
  min=Math.max(min,1.5/point.radius);max=Math.min(max,40/point.radius);
  for(const axis of ['x','y','z'] as const)if(point[axis])max=Math.min(max,240/Math.abs(point[axis]));
 }
 return [min,max];
}

export function scaleSweep(shape:FormShape,factor:number):Partial<FormShape> {
 if(shape.kind!=='sweep'||!shape.path?.length)throw Error('Choose a curve to resize.');
 const [min,max]=sweepScaleLimits(shape);
 if(!Number.isFinite(factor)||factor<min-1e-10||factor>max+1e-10)throw Error('Curve size exceeds its editable limits.');
 factor=bounded(factor,min,max);
 return {width:bounded(shape.width*factor,4,240),height:bounded(shape.height*factor,4,240),depth:bounded(shape.depth*factor,4,240),path:shape.path.map(point=>({x:bounded(point.x*factor,-240,240),y:bounded(point.y*factor,-240,240),z:bounded(point.z*factor,-240,240),radius:bounded(point.radius*factor,1.5,40)}))};
}
