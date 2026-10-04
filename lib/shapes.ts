export type ShapeKind = 'sphere'|'box'|'capsule'|'cylinder'|'torus'|'sweep';
export type ShapeOperation = 'union'|'subtract'|'intersect';
export type SweepPoint={x:number;y:number;z:number;radius:number};
/** Millimetres; rotations use XYZ Euler degrees. Box/capsule rounding is mm;
 * torus rounding is the fraction of each XZ outer radius occupied by its tube
 * (the height independently sets vertical tube thickness). Sweep control points
 * are local mm; width/height/depth/roundness remain serialized but do not scale
 * the sweep. Its path and radii determine the actual dimensions. depthRatio
 * defaults to 1 and flattens sections along local Z without moving the path;
 * its affine implicit field is not an exact signed distance. */
export type FormShape = {id:string;name:string;kind:ShapeKind;enabled:boolean;operation:ShapeOperation;blend:number;x:number;y:number;z:number;rx:number;ry:number;rz:number;width:number;height:number;depth:number;roundness:number;path?:SweepPoint[];depthRatio?:number};
export const MAX_SHAPES=32;
export const SHAPE_LIMITS = {blend:[0,40],x:[-300,300],y:[-300,300],z:[-300,300],rx:[-360,360],ry:[-360,360],rz:[-360,360],width:[4,240],height:[4,240],depth:[4,240],roundness:[0,60]} as const;
export const SWEEP_LIMITS={pathPoints:[2,12],coordinate:[-240,240],radius:[1.5,40],depthRatio:[.25,1]} as const;
export const SHAPE_NAMES:Record<ShapeKind,string> = {sphere:'Ellipsoid',box:'Rounded box',capsule:'Capsule',cylinder:'Cylinder',torus:'Torus',sweep:'Curved sweep'};
export function makeShape(kind:ShapeKind):FormShape {
 const dimensions=kind==='sweep'?[118,70,40]:kind==='capsule'?[42,92,42]:kind==='cylinder'?[54,70,54]:kind==='torus'?[80,24,80]:kind==='box'?[64,54,48]:[68,62,58];
 return {id:'shape-'+Math.random().toString(36).slice(2,10),name:SHAPE_NAMES[kind],kind,enabled:true,operation:'union',blend:12,x:kind==='sweep'?0:45,y:0,z:0,rx:0,ry:0,rz:0,width:dimensions[0],height:dimensions[1],depth:dimensions[2],roundness:kind==='torus'?.3:kind==='box'?8:kind==='capsule'?21:0,...(kind==='sweep'?{depthRatio:1,path:[{x:-50,y:-23,z:0,radius:8},{x:-23,y:18,z:0,radius:11},{x:22,y:24,z:10,radius:10},{x:50,y:-16,z:0,radius:8}]}:{})};
}
export function isSweepShape(s:FormShape):s is FormShape&{kind:'sweep';path:SweepPoint[]}{return s.kind==='sweep'&&Array.isArray(s.path);}
export function isValidSweepPath(path:unknown):path is SweepPoint[]{
 return Array.isArray(path)&&path.length>=SWEEP_LIMITS.pathPoints[0]&&path.length<=SWEEP_LIMITS.pathPoints[1]&&path.every(point=>point&&typeof point==='object'&&!Array.isArray(point)&&['x','y','z','radius'].every(key=>{const value=point[key],range=key==='radius'?SWEEP_LIMITS.radius:SWEEP_LIMITS.coordinate;return typeof value==='number'&&Number.isFinite(value)&&value>=range[0]&&value<=range[1]}));
}
/** Reflect a new, independently editable shape across the world origin. XYZ
 * rotation conjugation negates the angles orthogonal to the reflection axis;
 * mirroring a sweep's local path accounts for its asymmetric geometry. */
export function mirrorShape(s:FormShape,axis:'x'|'y'|'z'):FormShape {
 const copy:FormShape=JSON.parse(JSON.stringify(s));copy.id='shape-'+Math.random().toString(36).slice(2,10);copy.name=(s.name+' · mirror '+axis.toUpperCase()).slice(0,100);copy[axis]=-copy[axis];
 if(axis!=='x')copy.rx=-copy.rx;if(axis!=='y')copy.ry=-copy.ry;if(axis!=='z')copy.rz=-copy.rz;
 if(copy.path)for(const point of copy.path)point[axis]=-point[axis];return copy;
}
type SweepSegment={a:SweepPoint;b:SweepPoint;ux:number;uy:number;uz:number;length:number;slope:number;beta:number;bounds:number[]};
type SweepNode={bounds:number[];left?:SweepNode;right?:SweepNode;segments?:SweepSegment[]};
type SweepCache={path:SweepPoint[];depthRatio:number;values:number[];samples:readonly SweepPoint[];bounds:number[];root:SweepNode};
const sweeps=new WeakMap<FormShape,SweepCache>();
const blankBounds=()=>[Infinity,Infinity,Infinity,-Infinity,-Infinity,-Infinity];
function expandBounds(bounds:number[],x:number,y:number,z:number,radius=0,zRadius=radius){bounds[0]=Math.min(bounds[0],x-radius);bounds[1]=Math.min(bounds[1],y-radius);bounds[2]=Math.min(bounds[2],z-zRadius);bounds[3]=Math.max(bounds[3],x+radius);bounds[4]=Math.max(bounds[4],y+radius);bounds[5]=Math.max(bounds[5],z+zRadius);}
function sweepTree(segments:SweepSegment[]):SweepNode {
 const bounds=blankBounds();for(const segment of segments){const b=segment.bounds;expandBounds(bounds,b[0],b[1],b[2]);expandBounds(bounds,b[3],b[4],b[5]);}
 if(segments.length<=4)return {bounds,segments};
 let axis=0;for(let i=1;i<3;i++)if(bounds[i+3]-bounds[i]>bounds[axis+3]-bounds[axis])axis=i;
 segments.sort((a,b)=>(a.bounds[axis]+a.bounds[axis+3])-(b.bounds[axis]+b.bounds[axis+3]));const middle=Math.floor(segments.length/2);
 return {bounds,left:sweepTree(segments.slice(0,middle)),right:sweepTree(segments.slice(middle))};
}
function sweepCache(s:FormShape):SweepCache {
 if(!isSweepShape(s))throw Error('A curved sweep needs a control-point path.');
 const path=s.path,depthRatio=s.depthRatio??1,previous=sweeps.get(s);let unchanged=previous?.path===path&&previous.depthRatio===depthRatio&&previous.values.length===path.length*4;
 if(unchanged)for(let i=0;i<path.length;i++){const p=path[i],offset=i*4;if(p.x!==previous!.values[offset]||p.y!==previous!.values[offset+1]||p.z!==previous!.values[offset+2]||p.radius!==previous!.values[offset+3]){unchanged=false;break}}
 if(unchanged)return previous!;
 if(!isValidSweepPath(path))throw Error('Invalid curved-sweep path.');
 if(!Number.isFinite(depthRatio)||depthRatio<SWEEP_LIMITS.depthRatio[0]||depthRatio>SWEEP_LIMITS.depthRatio[1])throw Error('Invalid curved-sweep section depth.');
 const samples:SweepPoint[]=[],bounds=blankBounds(),values=path.flatMap(p=>[p.x,p.y,p.z,p.radius]);
 for(let i=0;i<path.length-1;i++){
  const a=path[i],b=path[i+1],before=path[Math.max(0,i-1)],after=path[Math.min(path.length-1,i+2)],radius=Math.max(a.radius,b.radius);
  const ax=i===0?b.x-a.x:(b.x-before.x)/2,ay=i===0?b.y-a.y:(b.y-before.y)/2,az=i===0?b.z-a.z:(b.z-before.z)/2;
  const bx=i===path.length-2?b.x-a.x:(after.x-a.x)/2,by=i===path.length-2?b.y-a.y:(after.y-a.y)/2,bz=i===path.length-2?b.z-a.z:(after.z-a.z)/2;
  // A cubic Hermite curve lies in the convex hull of these Bezier controls;
  // their bounds include overshoot between samples and monotone radius changes.
  expandBounds(bounds,a.x,a.y,a.z,radius,radius*depthRatio);expandBounds(bounds,a.x+ax/3,a.y+ay/3,a.z+az/3,radius,radius*depthRatio);expandBounds(bounds,b.x-bx/3,b.y-by/3,b.z-bz/3,radius,radius*depthRatio);expandBounds(bounds,b.x,b.y,b.z,radius,radius*depthRatio);
  for(let j=i===0?0:1;j<=8;j++){const t=j/8,t2=t*t,t3=t2*t,h00=2*t3-3*t2+1,h10=t3-2*t2+t,h01=-2*t3+3*t2,h11=t3-t2,smooth=t2*(3-2*t);samples.push(Object.freeze({x:h00*a.x+h10*ax+h01*b.x+h11*bx,y:h00*a.y+h10*ay+h01*b.y+h11*by,z:h00*a.z+h10*az+h01*b.z+h11*bz,radius:a.radius+(b.radius-a.radius)*smooth}));}
 }
 const metric=depthRatio===1?samples:samples.map(p=>({...p,z:p.z/depthRatio})),segments:SweepSegment[]=[];for(let i=0;i<metric.length-1;i++){const a=metric[i],b=metric[i+1],dx=b.x-a.x,dy=b.y-a.y,dz=b.z-a.z,length=Math.hypot(dx,dy,dz),radius=Math.max(a.radius,b.radius),segmentBounds=blankBounds(),slope=length?(b.radius-a.radius)/length:0;expandBounds(segmentBounds,a.x,a.y,a.z,radius);expandBounds(segmentBounds,b.x,b.y,b.z,radius);segments.push({a,b,ux:length?dx/length:0,uy:length?dy/length:0,uz:length?dz/length:0,length,slope,beta:Math.sqrt(Math.max(0,1-slope*slope)),bounds:segmentBounds});}
 const cache={path,depthRatio,values,samples:Object.freeze(samples),bounds,root:sweepTree(segments)};sweeps.set(s,cache);return cache;
}
/** Shared local centerline and radius approximation for editing, bounds and
 * every mesh quality. Export refines the spatial grid, not the sweep surface. */
export function sweepSamples(s:FormShape):readonly SweepPoint[]{return sweepCache(s).samples;}
// Chebyshev distance outside / signed face distance inside is a conservative
// lower bound for any solid inside this box, without a square root per BVH node.
function boxLowerBound(bounds:number[],x:number,y:number,z:number){return Math.max(bounds[0]-x,x-bounds[3],bounds[1]-y,y-bounds[4],bounds[2]-z,z-bounds[5]);}
function sweepSegmentField(segment:SweepSegment,x:number,y:number,z:number){
 const {a,b,length,slope}=segment;
 if(length<1e-9||Math.abs(slope)>=1){const larger=a.radius>=b.radius?a:b,dx=x-larger.x,dy=y-larger.y,dz=z-larger.z;return Math.sqrt(dx*dx+dy*dy+dz*dz)-larger.radius;}
 const dx=x-a.x,dy=y-a.y,dz=z-a.z,axial=dx*segment.ux+dy*segment.uy+dz*segment.uz,radialSquared=Math.max(0,dx*dx+dy*dy+dz*dz-axial*axial),radial=Math.sqrt(radialSquared);
 // Minimize the distance to spheres whose centers and radii vary linearly.
 // Unlike radius-at-nearest-center approximations, this remains correct for
 // steep tapers and reduces to the containing endpoint ball when |dr| >= L.
 const t=axial+slope*radial/segment.beta;
 if(t<=0)return Math.sqrt(radialSquared+axial*axial)-a.radius;
 if(t>=length){const end=axial-length;return Math.sqrt(radialSquared+end*end)-b.radius;}
 return radial*segment.beta-a.radius-slope*axial;
}
function sweepNodeField(node:SweepNode,x:number,y:number,z:number,best:number):number {
 if(boxLowerBound(node.bounds,x,y,z)>=best)return best;
 if(node.segments){for(const segment of node.segments)if(boxLowerBound(segment.bounds,x,y,z)<best)best=Math.min(best,sweepSegmentField(segment,x,y,z));return best;}
 const left=node.left!,right=node.right!,leftFirst=boxLowerBound(left.bounds,x,y,z)<boxLowerBound(right.bounds,x,y,z);
 best=sweepNodeField(leftFirst?left:right,x,y,z,best);return sweepNodeField(leftFirst?right:left,x,y,z,best);
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
export type ShapeEvaluator=(x:number,y:number,z:number,limit?:number)=>number;
/** Compile an immutable geometry snapshot once for bulk field sampling. Public
 * evaluateShape retains in-place mutation detection; a mesh snapshot avoids
 * rescanning control points at every grid sample and normal evaluation. */
export function compileShape(s:FormShape):ShapeEvaluator {
 const shape={...s},r=transform(s),originX=s.x,originY=s.y,originZ=s.z,cache=s.kind==='sweep'?sweepCache(s):undefined;
 const exact=s.kind==='box'||(s.kind==='cylinder'&&s.width===s.depth)||(s.kind==='sphere'&&s.width===s.height&&s.width===s.depth)||(s.kind==='capsule'&&s.width===s.depth&&s.width<=s.height&&(s.roundness===s.width/2||s.roundness===0));
 const bounds=cache||exact?shapeBounds(s):undefined;
 return (x,y,z,limit=Infinity)=>{
  // Flattened sweeps evaluate distance in a stretched metric. Their positive
  // outside-box lower bound remains safe; for negative limits multiply it by
  // the maximum metric stretch before pruning interior candidates.
  if(bounds){const bound=boxLowerBound(bounds,x,y,z),safeBound=cache&&bound<0?bound/cache.depthRatio:bound;if(safeBound>=limit)return limit;}
  const dx=x-originX,dy=y-originY,dz=z-originZ,px=r[0]*dx+r[3]*dy+r[6]*dz,py=r[1]*dx+r[4]*dy+r[7]*dz,pz=r[2]*dx+r[5]*dy+r[8]*dz;
  return evaluateLocalShape(shape,px,py,pz,limit,cache);
 };
}
/** With a finite limit, a sweep may return that limit when its actual value is
 * larger. The caller must only use this for a CSG branch already known to be
 * inactive there. Infinity preserves ordinary pointwise evaluation. */
export function evaluateShape(s:FormShape,x:number,y:number,z:number,limit=Infinity){
 const r=transform(s),dx=x-s.x,dy=y-s.y,dz=z-s.z;
 const px=r[0]*dx+r[3]*dy+r[6]*dz,py=r[1]*dx+r[4]*dy+r[7]*dz,pz=r[2]*dx+r[5]*dy+r[8]*dz;
 return evaluateLocalShape(s,px,py,pz,limit);
}
function evaluateLocalShape(s:FormShape,px:number,py:number,pz:number,limit:number,compiledSweep?:SweepCache){
 const hx=s.width/2,hy=s.height/2,hz=s.depth/2;
 switch(s.kind){
  case 'sphere':return ellipsoid(px,py,pz,hx,hy,hz);
  case 'box':{const radius=Math.min(s.roundness,hx,hy,hz),a=Math.abs(px)-hx+radius,b=Math.abs(py)-hy+radius,c=Math.abs(pz)-hz+radius;return Math.hypot(Math.max(a,0),Math.max(b,0),Math.max(c,0))+Math.min(Math.max(a,b,c),0)-radius;}
  case 'capsule':{const cap=Math.min(s.roundness>0?s.roundness:Math.min(hx,hy,hz),hx,hy,hz),end=hy-cap;return ellipsoid(px,py-Math.max(-end,Math.min(end,py)),pz,hx,cap,hz);}
  case 'cylinder':{const radial=ellipse(px,pz,hx,hz),axial=Math.abs(py)-hy;return Math.min(Math.max(radial,axial),0)+Math.hypot(Math.max(radial,0),Math.max(axial,0));}
  case 'torus':{const scale=Math.min(hx,hz),tube=scale*s.roundness,radial=(Math.hypot(px/hx,pz/hz)-(1-s.roundness))*scale;return ellipse(radial,py,tube,hy);}
  case 'sweep':{const cache=compiledSweep??sweepCache(s);return sweepNodeField(cache.root,px,py,pz/cache.depthRatio,limit);}
 }
}
/** Conservative world-space AABB, including every rotated primitive surface. */
export function shapeBounds(s:FormShape):number[]{const r=transform(s);if(s.kind==='sweep'){const local=sweepCache(s).bounds,bounds=blankBounds();for(const x of [local[0],local[3]])for(const y of [local[1],local[4]])for(const z of [local[2],local[5]])expandBounds(bounds,s.x+r[0]*x+r[1]*y+r[2]*z,s.y+r[3]*x+r[4]*y+r[5]*z,s.z+r[6]*x+r[7]*y+r[8]*z);return bounds;}const hx=s.width/2,hy=s.height/2,hz=s.depth/2,ex=Math.abs(r[0])*hx+Math.abs(r[1])*hy+Math.abs(r[2])*hz,ey=Math.abs(r[3])*hx+Math.abs(r[4])*hy+Math.abs(r[5])*hz,ez=Math.abs(r[6])*hx+Math.abs(r[7])*hy+Math.abs(r[8])*hz;return [s.x-ex,s.y-ey,s.z-ez,s.x+ex,s.y+ey,s.z+ez];}
