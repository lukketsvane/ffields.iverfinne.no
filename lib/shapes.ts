export type ShapeKind = 'sphere'|'box'|'capsule'|'cylinder'|'torus'|'sweep';
export type ShapeOperation = 'union'|'subtract'|'intersect';
export type SweepPoint={x:number;y:number;z:number;radius:number};
/** Millimetres; rotations use XYZ Euler degrees. Box/capsule rounding is mm;
 * torus rounding is the fraction of each XZ outer radius occupied by its tube
 * (the height independently sets vertical tube thickness). Sweep control points
 * are local mm; width/height/depth/roundness remain serialized but do not scale
 * the sweep. Its path and radii determine the actual dimensions. depthRatio
 * defaults to 1. Fixed mode (the default) flattens sections along local Z;
 * its affine implicit field is not an exact signed distance. Transported mode
 * follows the curve with an elliptical section and optional tangent-axis roll;
 * it returns a conservative signed distance bound, not an exact distance.
 * Closed sweeps join unique authored controls cyclically, without endpoints. */
export type FormShape = {id:string;name:string;kind:ShapeKind;enabled:boolean;operation:ShapeOperation;blend:number;x:number;y:number;z:number;rx:number;ry:number;rz:number;width:number;height:number;depth:number;roundness:number;path?:SweepPoint[];depthRatio?:number;sectionMode?:'fixed'|'transported';sectionRoll?:number;closed?:boolean};
export const MAX_SHAPES=32;
export const SHAPE_LIMITS = {blend:[0,40],x:[-300,300],y:[-300,300],z:[-300,300],rx:[-360,360],ry:[-360,360],rz:[-360,360],width:[4,240],height:[4,240],depth:[4,240],roundness:[0,60]} as const;
export const SWEEP_LIMITS={pathPoints:[2,12],coordinate:[-240,240],radius:[1.5,40],depthRatio:[.25,1]} as const;
export const SHAPE_NAMES:Record<ShapeKind,string> = {sphere:'Ellipsoid',box:'Rounded box',capsule:'Capsule',cylinder:'Cylinder',torus:'Torus',sweep:'Curved sweep'};
export function makeShape(kind:ShapeKind):FormShape {
 const dimensions=kind==='sweep'?[118,70,40]:kind==='capsule'?[42,92,42]:kind==='cylinder'?[54,70,54]:kind==='torus'?[80,24,80]:kind==='box'?[64,54,48]:[68,62,58];
 return {id:'shape-'+Math.random().toString(36).slice(2,10),name:SHAPE_NAMES[kind],kind,enabled:true,operation:'union',blend:12,x:kind==='sweep'?0:45,y:0,z:0,rx:0,ry:0,rz:0,width:dimensions[0],height:dimensions[1],depth:dimensions[2],roundness:kind==='torus'?.3:kind==='box'?8:kind==='capsule'?21:0,...(kind==='sweep'?{depthRatio:1,path:[{x:-50,y:-23,z:0,radius:8},{x:-23,y:18,z:0,radius:11},{x:22,y:24,z:10,radius:10},{x:50,y:-16,z:0,radius:8}]}:{})};
}
export function isSweepShape(s:FormShape):s is FormShape&{kind:'sweep';path:SweepPoint[]}{return s.kind==='sweep'&&Array.isArray(s.path);}
export function isValidSweepPath(path:unknown,closed=false):path is SweepPoint[]{
 if(typeof closed!=='boolean'||!Array.isArray(path)||path.length<(closed?3:SWEEP_LIMITS.pathPoints[0])||path.length>SWEEP_LIMITS.pathPoints[1]||!path.every(point=>point&&typeof point==='object'&&!Array.isArray(point)&&['x','y','z','radius'].every(key=>{const value=point[key],range=key==='radius'?SWEEP_LIMITS.radius:SWEEP_LIMITS.coordinate;return typeof value==='number'&&Number.isFinite(value)&&value>=range[0]&&value<=range[1]})))return false;
 return !closed||new Set(path.map(point=>JSON.stringify([point.x,point.y,point.z]))).size===path.length;
}
/** Reflect a new, independently editable shape across the world origin. XYZ
 * rotation conjugation negates the angles orthogonal to the reflection axis;
 * mirroring a sweep's local path accounts for its asymmetric geometry. */
export function mirrorShape(s:FormShape,axis:'x'|'y'|'z'):FormShape {
 const copy:FormShape=JSON.parse(JSON.stringify(s));copy.id='shape-'+Math.random().toString(36).slice(2,10);copy.name=(s.name+' · mirror '+axis.toUpperCase()).slice(0,100);copy[axis]=-copy[axis];
 if(axis!=='x')copy.rx=-copy.rx;if(axis!=='y')copy.ry=-copy.ry;if(axis!=='z')copy.rz=-copy.rz;
 if(copy.path)for(const point of copy.path)point[axis]=-point[axis];if(copy.sectionMode==='transported')copy.sectionRoll=-(copy.sectionRoll??0);return copy;
}
type Vector=[number,number,number];
export type SweepFrame={tangent:readonly [number,number,number];minor:readonly [number,number,number];major:readonly [number,number,number]};
type SweepSegment={a:SweepPoint;b:SweepPoint;ux:number;uy:number;uz:number;length:number;slope:number;beta:number;bounds:number[];frame?:SweepFrame};
type SweepNode={bounds:number[];left?:SweepNode;right?:SweepNode;segments?:SweepSegment[]};
type SweepCache={path:SweepPoint[];closed:boolean;depthRatio:number;sectionMode:'fixed'|'transported';sectionRoll:number;values:number[];samples:readonly SweepPoint[];frames:readonly SweepFrame[];bounds:number[];root:SweepNode};
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
const vectorDot=(a:readonly number[],b:readonly number[])=>a[0]*b[0]+a[1]*b[1]+a[2]*b[2];
const vectorCross=(a:readonly number[],b:readonly number[]):Vector=>[a[1]*b[2]-a[2]*b[1],a[2]*b[0]-a[0]*b[2],a[0]*b[1]-a[1]*b[0]];
function vectorUnit(a:Vector,fallback:Vector=[0,1,0]):Vector{const length=Math.hypot(...a);return length>1e-10?a.map(v=>v/length) as Vector:[...fallback];}
function frameMinor(tangent:Vector):Vector{
 const reference:Vector=Math.abs(tangent[2])<.999?[0,0,1]:(Math.abs(tangent[0])<Math.abs(tangent[1])?[1,0,0]:[0,1,0]),projection=vectorDot(reference,tangent);
 return vectorUnit(reference.map((v,i)=>v-projection*tangent[i]) as Vector);
}
function transportMinor(minor:readonly number[],from:readonly number[],to:Vector):Vector{
 const cosine=Math.max(-1,Math.min(1,vectorDot(from,to))),axis=vectorCross(from,to),sine=Math.hypot(...axis);let rotated:Vector;
 if(sine<1e-8){
  // At a reversal use the section's minor axis as the half-turn axis. The
  // ellipse is unchanged by sign flips and never loses its transverse frame.
  rotated=[...minor] as Vector;
 }else{
  const k=axis.map(v=>v/sine) as Vector,cross=vectorCross(k,minor),along=vectorDot(k,minor);
  rotated=minor.map((v,i)=>v*cosine+cross[i]*sine+k[i]*along*(1-cosine)) as Vector;
 }
 const projection=vectorDot(rotated,to);return vectorUnit(rotated.map((v,i)=>v-projection*to[i]) as Vector,frameMinor(to));
}
function transportedFrames(samples:readonly SweepPoint[],roll:number):readonly SweepFrame[]{
 const frames:SweepFrame[]=[],angle=roll*Math.PI/180,cosine=Math.cos(angle),sine=Math.sin(angle);let previousTangent:Vector=[0,1,0],minor:Vector=[0,0,1];
 for(let i=0;i<samples.length;i++){
  const before=samples[Math.max(0,i-1)],after=samples[Math.min(samples.length-1,i+1)],tangent=vectorUnit([after.x-before.x,after.y-before.y,after.z-before.z],previousTangent);
  minor=i===0?frameMinor(tangent):transportMinor(minor,previousTangent,tangent);const major=vectorCross(tangent,minor),rolled=minor.map((v,j)=>v*cosine+major[j]*sine) as Vector;
  frames.push(Object.freeze({tangent:Object.freeze(tangent),minor:Object.freeze(rolled),major:Object.freeze(vectorCross(tangent,rolled))}));previousTangent=tangent;
 }
 return Object.freeze(frames);
}
function closedTransportedFrames(samples:readonly SweepPoint[],roll:number,seamDirection:Vector):readonly SweepFrame[]{
 // The sampled seam is duplicated only for traversal. Central differences use
 // periodic neighbours at both copies, including non-planar authored loops.
 // Unique neighbouring authored controls guarantee a nonzero seam derivative.
 // If sampled neighbours coincide, this geometric fallback also reflects and
 // rotates with the curve; a fixed coordinate axis would change its ellipse.
 const count=samples.length-1,tangents:Vector[]=[],minors:Vector[]=[],lengths=[0],seamScale=Math.max(...seamDirection.map(Math.abs));let previousTangent=vectorUnit(seamDirection.map(v=>v/seamScale) as Vector),minor:Vector=[0,0,1];
 for(let i=0;i<=count;i++){
  const index=i%count,before=samples[(index+count-1)%count],after=samples[(index+1)%count],tangent=i===count?tangents[0]:vectorUnit([after.x-before.x,after.y-before.y,after.z-before.z],previousTangent);
  minor=i===0?frameMinor(tangent):transportMinor(minor,previousTangent,tangent);tangents.push(tangent);minors.push(minor);previousTangent=tangent;
  if(i){const a=samples[i-1],b=samples[i];lengths.push(lengths[i-1]+Math.hypot(b.x-a.x,b.y-a.y,b.z-a.z));}
 }
 // Parallel transport around a spatial loop can accumulate holonomy. Spread
 // its inverse rotation by arc length, rather than leaving an elliptical seam.
 const twist=Math.atan2(vectorDot(tangents[0],vectorCross(minors[count],minors[0])),Math.max(-1,Math.min(1,vectorDot(minors[count],minors[0])))),total=lengths[count],angle=roll*Math.PI/180,frames:SweepFrame[]=[];
 for(let i=0;i<count;i++){
  const tangent=tangents[i],base=minors[i],major=vectorCross(tangent,base),phase=angle+(total?twist*lengths[i]/total:0),cosine=Math.cos(phase),sine=Math.sin(phase),rolled=base.map((v,j)=>v*cosine+major[j]*sine) as Vector;
  frames.push(Object.freeze({tangent:Object.freeze(tangent),minor:Object.freeze(rolled),major:Object.freeze(vectorCross(tangent,rolled))}));
 }
 // Exact equality avoids tiny numerical jumps between the two seam samples.
 frames.push(frames[0]);return Object.freeze(frames);
}
function sweepCache(s:FormShape):SweepCache {
 if(!isSweepShape(s))throw Error('A curved sweep needs a control-point path.');
 const path=s.path,closed=s.closed===undefined?false:s.closed,depthRatio=s.depthRatio??1,sectionMode=s.sectionMode??'fixed',sectionRoll=s.sectionRoll??0,previous=sweeps.get(s);let unchanged=previous?.path===path&&previous.closed===closed&&previous.depthRatio===depthRatio&&previous.sectionMode===sectionMode&&previous.sectionRoll===sectionRoll&&previous.values.length===path.length*4;
 if(unchanged)for(let i=0;i<path.length;i++){const p=path[i],offset=i*4;if(p.x!==previous!.values[offset]||p.y!==previous!.values[offset+1]||p.z!==previous!.values[offset+2]||p.radius!==previous!.values[offset+3]){unchanged=false;break}}
 if(unchanged)return previous!;
 if(!isValidSweepPath(path,closed))throw Error('Invalid curved-sweep path.');
 if(!Number.isFinite(depthRatio)||depthRatio<SWEEP_LIMITS.depthRatio[0]||depthRatio>SWEEP_LIMITS.depthRatio[1])throw Error('Invalid curved-sweep section depth.');
 if(sectionMode!=='fixed'&&sectionMode!=='transported')throw Error('Invalid curved-sweep section mode.');
 if(!Number.isFinite(sectionRoll)||sectionRoll< -360||sectionRoll>360)throw Error('Invalid curved-sweep section roll.');
 const transported=sectionMode==='transported'&&depthRatio!==1,boundRatio=transported?1:depthRatio;
 const samples:SweepPoint[]=[],bounds=blankBounds(),values=path.flatMap(p=>[p.x,p.y,p.z,p.radius]);
 for(let i=0;i<path.length-(closed?0:1);i++){
  const a=path[i],b=path[closed?(i+1)%path.length:i+1],before=path[closed?(i+path.length-1)%path.length:Math.max(0,i-1)],after=path[closed?(i+2)%path.length:Math.min(path.length-1,i+2)],radius=Math.max(a.radius,b.radius);
  const ax=!closed&&i===0?b.x-a.x:(b.x-before.x)/2,ay=!closed&&i===0?b.y-a.y:(b.y-before.y)/2,az=!closed&&i===0?b.z-a.z:(b.z-before.z)/2;
  const bx=!closed&&i===path.length-2?b.x-a.x:(after.x-a.x)/2,by=!closed&&i===path.length-2?b.y-a.y:(after.y-a.y)/2,bz=!closed&&i===path.length-2?b.z-a.z:(after.z-a.z)/2;
  // A cubic Hermite curve lies in the convex hull of these Bezier controls;
  // their bounds include overshoot between samples and monotone radius changes.
  expandBounds(bounds,a.x,a.y,a.z,radius,radius*boundRatio);expandBounds(bounds,a.x+ax/3,a.y+ay/3,a.z+az/3,radius,radius*boundRatio);expandBounds(bounds,b.x-bx/3,b.y-by/3,b.z-bz/3,radius,radius*boundRatio);expandBounds(bounds,b.x,b.y,b.z,radius,radius*boundRatio);
  for(let j=i===0?0:1;j<=8;j++){if(closed&&(j===0||j===8)){const endpoint=j===0?a:b;samples.push(Object.freeze({x:endpoint.x,y:endpoint.y,z:endpoint.z,radius:endpoint.radius}));continue;}const t=j/8,t2=t*t,t3=t2*t,h00=2*t3-3*t2+1,h10=t3-2*t2+t,h01=-2*t3+3*t2,h11=t3-t2,smooth=t2*(3-2*t);samples.push(Object.freeze({x:h00*a.x+h10*ax+h01*b.x+h11*bx,y:h00*a.y+h10*ay+h01*b.y+h11*by,z:h00*a.z+h10*az+h01*b.z+h11*bz,radius:a.radius+(b.radius-a.radius)*smooth}));}
 }
 const frames=sectionMode==='transported'?(closed?closedTransportedFrames(samples,sectionRoll,[path[1].x-path[path.length-1].x,path[1].y-path[path.length-1].y,path[1].z-path[path.length-1].z]):transportedFrames(samples,sectionRoll)):Object.freeze([]),metric=depthRatio===1||transported?samples:samples.map(p=>({...p,z:p.z/depthRatio})),segments:SweepSegment[]=[];for(let i=0;i<metric.length-1;i++){const a=metric[i],b=metric[i+1],dx=b.x-a.x,dy=b.y-a.y,dz=b.z-a.z,length=Math.hypot(dx,dy,dz),radius=Math.max(a.radius,b.radius),segmentBounds=blankBounds(),slope=length?(b.radius-a.radius)/length:0;expandBounds(segmentBounds,a.x,a.y,a.z,radius);expandBounds(segmentBounds,b.x,b.y,b.z,radius);let frame:SweepFrame|undefined;if(transported){const tangent=vectorUnit([dx,dy,dz],frames[i].tangent as Vector),minor=transportMinor(frames[i].minor,frames[i].tangent,tangent);frame={tangent,minor,major:vectorCross(tangent,minor)};}segments.push({a,b,ux:length?dx/length:0,uy:length?dy/length:0,uz:length?dz/length:0,length,slope,beta:Math.sqrt(Math.max(0,1-slope*slope)),bounds:segmentBounds,frame});}
 const cache={path,closed,depthRatio,sectionMode,sectionRoll,values,samples:Object.freeze(samples),frames,bounds,root:sweepTree(segments)};sweeps.set(s,cache);return cache;
}
/** Shared local centerline and radius approximation for editing, bounds and
 * every mesh quality. Closed controls occur at i * 8, with a duplicate sampled
 * seam at the end. Export refines the spatial grid, not the sweep surface. */
export function sweepSamples(s:FormShape):readonly SweepPoint[]{return sweepCache(s).samples;}
/** Transported sample frames in shape-local coordinates; fixed sweeps return
 * no frames. Sampling, caps and frame transport are independent of mesh grid. */
export function sweepFrames(s:FormShape):readonly SweepFrame[]{return sweepCache(s).frames;}
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
function transportedSegmentField(segment:SweepSegment,x:number,y:number,z:number,ratio:number){
 const {a,b,length,slope,frame}=segment,dx=x-a.x,dy=y-a.y,dz=z-a.z,t=frame!.tangent,major=frame!.major,minor=frame!.minor;
 const axial=dx*t[0]+dy*t[1]+dz*t[2],wide=dx*major[0]+dy*major[1]+dz*major[2],thin=(dx*minor[0]+dy*minor[1]+dz*minor[2])/ratio,radialSquared=wide*wide+thin*thin;
 let field:number;
 if(length<1e-9||Math.abs(slope)>=1){const larger=a.radius>=b.radius?a:b,end=larger===a?axial:axial-length;field=Math.sqrt(radialSquared+end*end)-larger.radius;}
 else {const radial=Math.sqrt(radialSquared),at=axial+slope*radial/segment.beta;if(at<=0)field=Math.sqrt(radialSquared+axial*axial)-a.radius;else if(at>=length){const end=axial-length;field=Math.sqrt(radialSquared+end*end)-b.radius;}else field=radial*segment.beta-a.radius-slope*axial;}
 // The metric stretches by at most 1/ratio. Normalization makes each segment
 // field 1-Lipschitz in world units, and min retains a safe distance bound.
 return field*ratio;
}
function transportedNodeField(node:SweepNode,x:number,y:number,z:number,ratio:number,best:number):number{
 // The affine metric stretches by [1,1/ratio] and its field is multiplied by
 // ratio. Outside an enclosing box, ratio*box distance is a lower bound;
 // ordinary positive box distance would over-prune this normalized field.
 // Inside the box the negative bound stays unscaled: the normalized field's
 // magnitude cannot exceed distance to its own surface, which the box encloses.
 const bound=boxLowerBound(node.bounds,x,y,z),safeBound=bound<0?bound:bound*ratio;
 if(safeBound>=best)return best;
 if(node.segments){for(const segment of node.segments){const bound=boxLowerBound(segment.bounds,x,y,z),safeBound=bound<0?bound:bound*ratio;if(safeBound<best)best=Math.min(best,transportedSegmentField(segment,x,y,z,ratio));}return best;}
 const left=node.left!,right=node.right!,leftFirst=boxLowerBound(left.bounds,x,y,z)<boxLowerBound(right.bounds,x,y,z);
 best=transportedNodeField(leftFirst?left:right,x,y,z,ratio,best);return transportedNodeField(leftFirst?right:left,x,y,z,ratio,best);
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
 const transported=cache?.sectionMode==='transported'&&cache.depthRatio!==1,bounds=(cache||exact)?shapeBounds(s):undefined;
 return (x,y,z,limit=Infinity)=>{
  // Fixed flattened sweeps use the unnormalized stretched metric. Transported
  // sections normalize it; their positive world-box bound needs the ratio.
  if(bounds){const bound=boxLowerBound(bounds,x,y,z),safeBound=transported?(bound<0?bound:bound*cache!.depthRatio):cache&&bound<0?bound/cache.depthRatio:bound;if(safeBound>=limit)return limit;}
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
  case 'sweep':{const cache=compiledSweep??sweepCache(s);return cache.sectionMode==='transported'&&cache.depthRatio!==1?transportedNodeField(cache.root,px,py,pz,cache.depthRatio,limit):sweepNodeField(cache.root,px,py,pz/cache.depthRatio,limit);}
 }
}
/** Conservative world-space AABB, including every rotated primitive surface. */
export function shapeBounds(s:FormShape):number[]{const r=transform(s);if(s.kind==='sweep'){const local=sweepCache(s).bounds,bounds=blankBounds();for(const x of [local[0],local[3]])for(const y of [local[1],local[4]])for(const z of [local[2],local[5]])expandBounds(bounds,s.x+r[0]*x+r[1]*y+r[2]*z,s.y+r[3]*x+r[4]*y+r[5]*z,s.z+r[6]*x+r[7]*y+r[8]*z);return bounds;}const hx=s.width/2,hy=s.height/2,hz=s.depth/2,ex=Math.abs(r[0])*hx+Math.abs(r[1])*hy+Math.abs(r[2])*hz,ey=Math.abs(r[3])*hx+Math.abs(r[4])*hy+Math.abs(r[5])*hz,ez=Math.abs(r[6])*hx+Math.abs(r[7])*hy+Math.abs(r[8])*hz;return [s.x-ex,s.y-ey,s.z-ez,s.x+ex,s.y+ey,s.z+ez];}
