import type {FormModel} from './form-engine.ts';
import {orientShapeToward,shapeAxisDirection} from './orientation.ts';

export type TransformVector={x:number;y:number;z:number};
export type GroupTransform={ids:string[];translation:TransformVector;rotation:TransformVector;pivot:TransformVector};
function vector(input:unknown,label:string,limit:number):TransformVector{
 if(!input||typeof input!=='object'||Array.isArray(input))throw Error('Provide '+label+' X, Y and Z.');
 const value=input as TransformVector;
 if(Object.keys(value).some(k=>!['x','y','z'].includes(k))||['x','y','z'].some(k=>typeof value[k as keyof TransformVector]!=='number'||!Number.isFinite(value[k as keyof TransformVector])||Math.abs(value[k as keyof TransformVector])>limit))throw Error('Invalid '+label+' vector.');
 return value;
}

/** Rigid group edit. Local sweep paths and endpoint relationships stay intact;
 * the caller resolves relationships and validates final document limits. */
export function transformShapeGroup(model:FormModel,input:unknown):FormModel{
 if(!input||typeof input!=='object'||Array.isArray(input))throw Error('Provide a group transform.');
 const p=input as GroupTransform;
 if(Object.keys(p).some(k=>!['ids','translation','rotation','pivot'].includes(k))||!Array.isArray(p.ids)||!p.ids.length||p.ids.some(id=>typeof id!=='string')||new Set(p.ids).size!==p.ids.length)throw Error('Select distinct shapes to move together.');
 const shapes=model.shapes??[],ids=new Set(p.ids);
 if(p.ids.some(id=>!shapes.some(s=>s.id===id)))throw Error('A selected shape no longer exists.');
 const translation=vector(p.translation,'translation',600),rotation=vector(p.rotation,'rotation',360),pivot=vector(p.pivot,'pivot',1000);
 if(Object.values(translation).every(v=>v===0)&&Object.values(rotation).every(v=>v===0))return model;
 const turn={rx:rotation.x,ry:rotation.y,rz:rotation.z},axes=['x','y','z'].map(axis=>shapeAxisDirection(turn,axis as 'x'|'y'|'z'));
 const rotate=(v:TransformVector):TransformVector=>({x:axes[0].x*v.x+axes[1].x*v.y+axes[2].x*v.z,y:axes[0].y*v.x+axes[1].y*v.y+axes[2].y*v.z,z:axes[0].z*v.x+axes[1].z*v.y+axes[2].z*v.z});
 const rotates=Object.values(rotation).some(v=>v!==0);
 return {...model,shapes:shapes.map(shape=>{
  if(!ids.has(shape.id))return shape;
  const origin=rotate({x:shape.x-pivot.x,y:shape.y-pivot.y,z:shape.z-pivot.z});
  const angles=rotates?orientShapeToward(shape,rotate(shapeAxisDirection(shape,'y')),'y',rotate(shapeAxisDirection(shape,'z'))):{};
  return {...shape,...angles,x:origin.x+pivot.x+translation.x,y:origin.y+pivot.y+translation.y,z:origin.z+pivot.z+translation.z};
 })};
}
