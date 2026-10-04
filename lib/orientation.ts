import type {FormShape} from './shapes.ts';

export type ShapeAxis='x'|'y'|'z';
export type Direction={x:number;y:number;z:number}|readonly [number,number,number];
type Vector=[number,number,number];
const dot=(a:Vector,b:Vector)=>a[0]*b[0]+a[1]*b[1]+a[2]*b[2];
const cross=(a:Vector,b:Vector):Vector=>[a[1]*b[2]-a[2]*b[1],a[2]*b[0]-a[0]*b[2],a[0]*b[1]-a[1]*b[0]];
const unit=(a:Vector):Vector=>{const length=Math.hypot(...a);if(!Number.isFinite(length)||length<1e-10)throw new RangeError('A direction needs three finite components and a nonzero length.');return a.map(v=>v/length) as Vector;};
function rotation(s:Pick<FormShape,'rx'|'ry'|'rz'>){
 const x=s.rx*Math.PI/180,y=s.ry*Math.PI/180,z=s.rz*Math.PI/180,cx=Math.cos(x),sx=Math.sin(x),cy=Math.cos(y),sy=Math.sin(y),cz=Math.cos(z),sz=Math.sin(z);
 return [cy*cz,-cy*sz,sy,cx*sz+sx*sy*cz,cx*cz-sx*sy*sz,-sx*cy,sx*sz-cx*sy*cz,sx*cz+cx*sy*sz,cx*cy];
}
/** The chosen local axis after the shape's XYZ Euler rotation, in world space. */
export function shapeAxisDirection(shape:Pick<FormShape,'rx'|'ry'|'rz'>,axis:ShapeAxis):{x:number;y:number;z:number}{
 const r=rotation(shape),column=axis==='x'?0:axis==='y'?1:2;return {x:r[column],y:r[column+3],z:r[column+6]};
}
function vector(direction:Direction):Vector{return Array.isArray(direction)?[direction[0],direction[1],direction[2]]:[(direction as {x:number}).x,(direction as {y:number}).y,(direction as {z:number}).z];}
function perpendicular(reference:Vector,axis:Vector):Vector{
 const projection=dot(reference,axis),p=reference.map((v,i)=>v-projection*axis[i]) as Vector;
 if(Math.hypot(...p)>1e-8)return unit(p);
 // The least-aligned coordinate basis is stable even for parallel up vectors.
 let least=0;for(let i=1;i<3;i++)if(Math.abs(axis[i])<Math.abs(axis[least]))least=i;
 const fallback:Vector=[0,0,0];fallback[least]=1;const amount=dot(fallback,axis);return unit(fallback.map((v,i)=>v-amount*axis[i]) as Vector);
}
function minimalRotation(value:Vector,from:Vector,to:Vector):Vector{
 const cosine=Math.max(-1,Math.min(1,dot(from,to))),axis=cross(from,to),sine=Math.hypot(...axis);
 if(sine<1e-10)return [...value]; // At 180 degrees rotate about this transverse axis.
 const k=axis.map(v=>v/sine) as Vector,c=cross(k,value),along=dot(k,value);
 return value.map((v,i)=>v*cosine+c[i]*sine+k[i]*along*(1-cosine)) as Vector;
}
/** Aim a local axis at a world direction. Returns only the Euler patch, leaving
 * translation and dimensions unchanged. Without up, use minimal rotation to
 * preserve current roll; up controls local Z for axis Y, otherwise
 * local Y. Parallel up vectors fall back to a stable orthogonal basis. */
export function orientShapeToward(shape:Pick<FormShape,'rx'|'ry'|'rz'>,direction:Direction,axis:ShapeAxis='y',up?:Direction):Pick<FormShape,'rx'|'ry'|'rz'>{
 const target=unit(vector(direction)),secondary=axis==='y'?'z':'y',existing=shapeAxisDirection(shape,secondary),current=shapeAxisDirection(shape,axis),from:Vector=[current.x,current.y,current.z];
 if(!up&&Math.hypot(target[0]-from[0],target[1]-from[1],target[2]-from[2])<1e-12)return {rx:shape.rx,ry:shape.ry,rz:shape.rz};
 const reference=up?unit(vector(up)):minimalRotation([existing.x,existing.y,existing.z],from,target);
 let x:Vector,y:Vector,z:Vector;
 if(axis==='x'){x=target;y=perpendicular(reference,x);z=unit(cross(x,y));y=unit(cross(z,x));}
 else if(axis==='y'){y=target;z=perpendicular(reference,y);x=unit(cross(y,z));z=unit(cross(x,y));}
 else {z=target;y=perpendicular(reference,z);x=unit(cross(y,z));y=unit(cross(z,x));}
 const m=[x[0],y[0],z[0],x[1],y[1],z[1],x[2],y[2],z[2]],ry=Math.asin(Math.max(-1,Math.min(1,m[2])));
 const rx=Math.abs(m[2])<.9999999?Math.atan2(-m[5],m[8]):Math.atan2(m[7],m[4]),rz=Math.abs(m[2])<.9999999?Math.atan2(-m[1],m[0]):0,degrees=180/Math.PI;
 return {rx:rx*degrees,ry:ry*degrees,rz:rz*degrees};
}
