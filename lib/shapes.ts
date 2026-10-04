export type ShapeKind = 'sphere'|'box'|'capsule'|'cylinder'|'torus';
export type ShapeOperation = 'union'|'subtract'|'intersect';
/** Millimetres; rotations use XYZ Euler degrees. Box/capsule rounding is mm;
 * torus rounding is the fraction of each XZ outer radius occupied by its tube
 * (the height independently sets vertical tube thickness). */
export type FormShape = {id:string;name:string;kind:ShapeKind;enabled:boolean;operation:ShapeOperation;blend:number;x:number;y:number;z:number;rx:number;ry:number;rz:number;width:number;height:number;depth:number;roundness:number};
export const MAX_SHAPES=32;
export const SHAPE_LIMITS = {blend:[0,40],x:[-300,300],y:[-300,300],z:[-300,300],rx:[-360,360],ry:[-360,360],rz:[-360,360],width:[4,240],height:[4,240],depth:[4,240],roundness:[0,60]} as const;
export const SHAPE_NAMES:Record<ShapeKind,string> = {sphere:'Ellipsoid',box:'Rounded box',capsule:'Capsule',cylinder:'Cylinder',torus:'Torus'};
export function makeShape(kind:ShapeKind):FormShape {
 const dimensions=kind==='capsule'?[42,92,42]:kind==='cylinder'?[54,70,54]:kind==='torus'?[80,24,80]:kind==='box'?[64,54,48]:[68,62,58];
 return {id:'shape-'+Math.random().toString(36).slice(2,10),name:SHAPE_NAMES[kind],kind,enabled:true,operation:'union',blend:12,x:45,y:0,z:0,rx:0,ry:0,rz:0,width:dimensions[0],height:dimensions[1],depth:dimensions[2],roundness:kind==='torus'?.3:kind==='box'?8:kind==='capsule'?21:0};
}
type Transform={rx:number;ry:number;rz:number;r:number[]};
const transforms=new WeakMap<FormShape,Transform>();
function transform(s:FormShape){
 let t=transforms.get(s);if(t&&t.rx===s.rx&&t.ry===s.ry&&t.rz===s.rz)return t.r;
 const ax=s.rx*Math.PI/180,ay=s.ry*Math.PI/180,az=s.rz*Math.PI/180,cx=Math.cos(ax),sx=Math.sin(ax),cy=Math.cos(ay),sy=Math.sin(ay),cz=Math.cos(az),sz=Math.sin(az);
 // Same XYZ convention as Three.js Euler; transpose maps world to local.
 const r=[cy*cz,-cy*sz,sy,cx*sz+sx*sy*cz,cx*cz-sx*sy*sz,-sx*cy,sx*sz-cx*sy*cz,sx*cz+cx*sy*sz,cx*cy];
 t={rx:s.rx,ry:s.ry,rz:s.rz,r};transforms.set(s,t);return r;
}
function ellipsoid(x:number,y:number,z:number,a:number,b:number,c:number){
 const k0=Math.hypot(x/a,y/b,z/c);if(k0<1e-12)return -Math.min(a,b,c);
 const k1=Math.hypot(x/(a*a),y/(b*b),z/(c*c));return k0*(k0-1)/k1;
}
function ellipse(x:number,y:number,a:number,b:number){const k0=Math.hypot(x/a,y/b);return k0<1e-12?-Math.min(a,b):k0*(k0-1)/Math.hypot(x/(a*a),y/(b*b));}
export function evaluateShape(s:FormShape,x:number,y:number,z:number){
 const r=transform(s),dx=x-s.x,dy=y-s.y,dz=z-s.z;
 const px=r[0]*dx+r[3]*dy+r[6]*dz,py=r[1]*dx+r[4]*dy+r[7]*dz,pz=r[2]*dx+r[5]*dy+r[8]*dz,hx=s.width/2,hy=s.height/2,hz=s.depth/2;
 switch(s.kind){
  case 'sphere':return ellipsoid(px,py,pz,hx,hy,hz);
  case 'box':{const radius=Math.min(s.roundness,hx,hy,hz),a=Math.abs(px)-hx+radius,b=Math.abs(py)-hy+radius,c=Math.abs(pz)-hz+radius;return Math.hypot(Math.max(a,0),Math.max(b,0),Math.max(c,0))+Math.min(Math.max(a,b,c),0)-radius;}
  case 'capsule':{const cap=Math.min(s.roundness>0?s.roundness:Math.min(hx,hy,hz),hx,hy,hz),end=hy-cap;return ellipsoid(px,py-Math.max(-end,Math.min(end,py)),pz,hx,cap,hz);}
  case 'cylinder':{const radial=ellipse(px,pz,hx,hz),axial=Math.abs(py)-hy;return Math.min(Math.max(radial,axial),0)+Math.hypot(Math.max(radial,0),Math.max(axial,0));}
  case 'torus':{const scale=Math.min(hx,hz),tube=scale*s.roundness,radial=(Math.hypot(px/hx,pz/hz)-(1-s.roundness))*scale;return ellipse(radial,py,tube,hy);}
 }
}
/** Conservative world-space AABB, including every rotated primitive surface. */
export function shapeBounds(s:FormShape):number[]{const r=transform(s),hx=s.width/2,hy=s.height/2,hz=s.depth/2,ex=Math.abs(r[0])*hx+Math.abs(r[1])*hy+Math.abs(r[2])*hz,ey=Math.abs(r[3])*hx+Math.abs(r[4])*hy+Math.abs(r[5])*hz,ez=Math.abs(r[6])*hx+Math.abs(r[7])*hy+Math.abs(r[8])*hz;return [s.x-ex,s.y-ey,s.z-ez,s.x+ex,s.y+ey,s.z+ez];}
