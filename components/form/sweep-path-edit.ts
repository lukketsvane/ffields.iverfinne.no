import {isValidSweepPath,SWEEP_LIMITS} from '../../lib/shapes.ts';
import type {FormShape,SweepPoint} from '../../lib/shapes.ts';

type SweepPathEdit={path:SweepPoint[];selected:number};
const clone=(path:readonly SweepPoint[])=>path.map(point=>({...point}));
const samePosition=(a:SweepPoint,b:SweepPoint)=>a.x===b.x&&a.y===b.y&&a.z===b.z;
const clamp=(value:number,min:number,max:number)=>Math.max(min,Math.min(max,value));

/** Every authored closed control is distinct; the sampled seam is not a control. */
export function validateEditedSweepPath(path:unknown,closed=false):asserts path is SweepPoint[]{
 if(!isValidSweepPath(path))throw Error('A curve needs 2–12 valid points, with coordinates ±240 mm and radius 1.5–40 mm.');
 if(closed&&path.length<3)throw Error('Add a third point before closing this curve.');
 if(closed){
  const positions=new Set<string>();
  for(const point of path){const key=`${point.x},${point.y},${point.z}`;if(positions.has(key))throw Error('Closed curves need distinct point positions. Move coincident points apart.');positions.add(key)}
 }
 if(!isValidSweepPath(path,closed))throw Error('This path cannot form a closed curve.');
}

/** A legacy repeated seam can be removed only when its radius is identical too. */
export function setSweepClosure(shape:FormShape,closed:boolean):Pick<FormShape,'path'|'closed'>{
 validateEditedSweepPath(shape.path);
 const path=clone(shape.path);
 if(closed&&samePosition(path[0],path[path.length-1])){
  if(path[0].radius!==path[path.length-1].radius)throw Error('The first and last points share a position but have different radii. Move one point before closing.');
  path.pop();
 }
 validateEditedSweepPath(path,closed);
 return {path,closed};
}

export function insertSweepControl(shape:FormShape,index:number):SweepPathEdit{
 validateEditedSweepPath(shape.path,shape.closed===true);
 const points=shape.path;
 if(!Number.isInteger(index)||index<0||index>=points.length)throw Error('Choose an existing curve point.');
 if(points.length>=SWEEP_LIMITS.pathPoints[1])throw Error('This curve already has 12 points.');
 const closed=shape.closed===true,after=index<points.length-1||closed;
 const point=points[index],neighbor=points[closed?(index+1)%points.length:after?index+1:index-1];
 const inserted:SweepPoint={x:0,y:0,z:0,radius:after?(point.radius+neighbor.radius)/2:point.radius};
 for(const axis of ['x','y','z'] as const)inserted[axis]=clamp(after?(point[axis]+neighbor[axis])/2:point[axis]+(point[axis]-neighbor[axis])/2,...SWEEP_LIMITS.coordinate);
 const selected=index+1,path=clone(points);path.splice(selected,0,inserted);
 validateEditedSweepPath(path,closed);
 return {path,selected};
}

export function removeSweepControl(shape:FormShape,index:number):SweepPathEdit{
 validateEditedSweepPath(shape.path,shape.closed===true);
 const closed=shape.closed===true,minimum=closed?3:SWEEP_LIMITS.pathPoints[0];
 if(shape.path.length<=minimum)throw Error(`Keep at least ${minimum} points in ${closed?'a closed':'an open'} curve.`);
 if(!Number.isInteger(index)||index<0||index>=shape.path.length)throw Error('Choose an existing curve point.');
 const path=clone(shape.path);path.splice(index,1);validateEditedSweepPath(path,closed);
 return {path,selected:Math.min(index,path.length-1)};
}
