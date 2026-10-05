import type {MeshData} from './form-engine.ts';
import type {Point3} from './direct-manipulation.ts';
import type {FormModel} from './form-engine.ts';
import {previewResolution} from './preview-scheduler.ts';

/** A small orthographic camera shared by software rendering and finger drags.
 * Scale is CSS pixels per model unit; changing model intent never resets it. */
export type SoftwareCamera={center:Point3;yaw:number;pitch:number;scale:number};
export type SoftwareFrame={width:number;height:number};
export type ProjectedPoint={x:number;y:number;depth:number};
export type ProjectedTriangle={a:number;b:number;c:number;depth:number;shade:number};
export type SoftwareShadeGradient={from:{x:number;y:number};to:{x:number;y:number};low:number;high:number};
type InteractionMode='move'|'size'|'rotate';
/** The canvas must stop owning a gesture when a docked control has changed
 * its target/tool or ended the shared editing transaction. An untouched grip
 * can still be tapped while editing is false. Pass the effective grip mode
 * (influences always move), rather than the requested toolbar group. */
export function softwareInteractionShouldCancel(interaction:{id:string;started:boolean;mode:InteractionMode;axis:'x'|'y'|'z'},state:{selected:string;editing:boolean;handles:boolean;mode?:InteractionMode;axis:'x'|'y'|'z'}):boolean{
 return (interaction.started&&!state.editing)||!state.handles||state.selected!==interaction.id||state.mode!==interaction.mode||(interaction.mode==='rotate'&&state.axis!==interaction.axis);
}

/** Idle surface detail is independent from interaction drafts. A measured
 * expensive preview bounds later idle effort without changing export quality. */
export function softwarePreviewResolution(model:FormModel,quality:{mobile:boolean;editing:boolean;previous?:{resolution:number;milliseconds:number}}):number{
 const requested=previewResolution(model,quality);
 if(quality.editing)return Math.min(40,requested);
 const previous=quality.previous;
 let resolution=Math.min(96,requested);
 if(previous&&Number.isFinite(previous.resolution)&&previous.resolution>0&&Number.isFinite(previous.milliseconds)&&previous.milliseconds>0){
  const target=quality.mobile?1400:1800;
  resolution=Math.min(resolution,previous.resolution*Math.cbrt(target/previous.milliseconds));
 }
 return Math.max(64,Math.min(96,Math.round(resolution/4)*4));
}

export function softwareBasis(camera:SoftwareCamera){
 const sy=Math.sin(camera.yaw),cy=Math.cos(camera.yaw),sp=Math.sin(camera.pitch),cp=Math.cos(camera.pitch);
 return {right:{x:cy,y:0,z:-sy},up:{x:-sy*sp,y:cp,z:-cy*sp},forward:{x:sy*cp,y:sp,z:cy*cp}};
}
export function projectSoftwarePoint(point:Point3,camera:SoftwareCamera,frame:SoftwareFrame):ProjectedPoint{
 const {right,up,forward}=softwareBasis(camera),x=point.x-camera.center.x,y=point.y-camera.center.y,z=point.z-camera.center.z;
 return {x:frame.width/2+(x*right.x+y*right.y+z*right.z)*camera.scale,y:frame.height/2-(x*up.x+y*up.y+z*up.z)*camera.scale,depth:x*forward.x+y*forward.y+z*forward.z};
}
/** Move on the camera plane, retaining the original pointer-to-grip offset. */
export function softwarePlaneDelta(camera:SoftwareCamera,dx:number,dy:number):Point3{
 const {right,up}=softwareBasis(camera),x=dx/camera.scale,y=-dy/camera.scale;
 return {x:right.x*x+up.x*y,y:right.y*x+up.y*y,z:right.z*x+up.z*y};
}
export function fitSoftwareCamera(camera:SoftwareCamera,bounds:readonly number[],frame:SoftwareFrame):SoftwareCamera{
 if(bounds.length!==6||bounds.some(v=>!Number.isFinite(v)))return camera;
 const center={x:(bounds[0]+bounds[3])/2,y:(bounds[1]+bounds[4])/2,z:(bounds[2]+bounds[5])/2},at={...camera,center,scale:1};
 let minX=Infinity,maxX=-Infinity,minY=Infinity,maxY=-Infinity;
 for(let bits=0;bits<8;bits++){
  const point=projectSoftwarePoint({x:bounds[bits&1?3:0],y:bounds[bits&2?4:1],z:bounds[bits&4?5:2]},at,frame);
  minX=Math.min(minX,point.x);maxX=Math.max(maxX,point.x);minY=Math.min(minY,point.y);maxY=Math.max(maxY,point.y);
 }
 const scale=Math.min(Math.max(1,frame.width)*.78/Math.max(1,maxX-minX),Math.max(1,frame.height)*.78/Math.max(1,maxY-minY));
 return {...camera,center,scale:Math.max(.025,Math.min(80,scale))};
}
export function softwareView(camera:SoftwareCamera,view:'front'|'top'|'perspective'):SoftwareCamera{
 return {...camera,yaw:view==='perspective'?.62:0,pitch:view==='top'?Math.PI/2:view==='perspective'?.34:0};
}
export function projectSoftwareMesh(mesh:MeshData,camera:SoftwareCamera,frame:SoftwareFrame){
 const points:ProjectedPoint[]=[],triangles:ProjectedTriangle[]=[],shades=new Float32Array(mesh.positions.length/3);
 // World-space lighting makes orbiting readable without implying simulation.
 const {right,up,forward}=softwareBasis(camera),lightLength=Math.hypot(-.36,.68,.64),light={x:-.36/lightLength,y:.68/lightLength,z:.64/lightLength};
 for(let i=0;i<mesh.positions.length;i+=3){
  const x=mesh.positions[i]-camera.center.x,y=mesh.positions[i+1]-camera.center.y,z=mesh.positions[i+2]-camera.center.z;
  points.push({x:frame.width/2+(x*right.x+y*right.y+z*right.z)*camera.scale,y:frame.height/2-(x*up.x+y*up.y+z*up.z)*camera.scale,depth:x*forward.x+y*forward.y+z*forward.z});
  const length=Math.hypot(mesh.normals[i],mesh.normals[i+1],mesh.normals[i+2])||1,nx=mesh.normals[i]/length,ny=mesh.normals[i+1]/length,nz=mesh.normals[i+2]/length;
  shades[i/3]=.28+.52*Math.max(0,nx*light.x+ny*light.y+nz*light.z)+.2*(ny*.5+.5);
 }
 for(let i=0;i<mesh.indices.length;i+=3){
  const a=mesh.indices[i],b=mesh.indices[i+1],c=mesh.indices[i+2];
  const nx=(mesh.normals[a*3]+mesh.normals[b*3]+mesh.normals[c*3])/3,ny=(mesh.normals[a*3+1]+mesh.normals[b*3+1]+mesh.normals[c*3+1])/3,nz=(mesh.normals[a*3+2]+mesh.normals[b*3+2]+mesh.normals[c*3+2])/3;
  const facing=nx*forward.x+ny*forward.y+nz*forward.z;
  if(facing<-.025)continue;
  triangles.push({a,b,c,depth:(points[a].depth+points[b].depth+points[c].depth)/3,shade:(shades[a]+shades[b]+shades[c])/3});
 }
 triangles.sort((a,b)=>a.depth-b.depth);
 return {points,triangles,shades};
}
/** A linear Canvas2D gradient reproduces barycentric interpolation of the
 * shared vertex light values. Neighbouring triangles agree along their edge,
 * unlike one quantized flat colour per marching tetrahedron. */
export function softwareTriangleGradient(points:readonly ProjectedPoint[],shades:Float32Array,triangle:ProjectedTriangle):SoftwareShadeGradient|undefined{
 const a=points[triangle.a],b=points[triangle.b],c=points[triangle.c],sa=shades[triangle.a],sb=shades[triangle.b],sc=shades[triangle.c];
 const low=Math.min(sa,sb,sc),high=Math.max(sa,sb,sc),det=(b.x-a.x)*(c.y-a.y)-(c.x-a.x)*(b.y-a.y);
 if(high-low<.0001||Math.abs(det)<1e-8)return;
 const gx=((sb-sa)*(c.y-a.y)-(sc-sa)*(b.y-a.y))/det,gy=((b.x-a.x)*(sc-sa)-(c.x-a.x)*(sb-sa))/det,length=gx*gx+gy*gy;
 if(!Number.isFinite(length)||length<1e-16)return;
 return {from:{x:a.x+(low-sa)*gx/length,y:a.y+(low-sa)*gy/length},to:{x:a.x+(high-sa)*gx/length,y:a.y+(high-sa)*gy/length},low,high};
}
/** Resolve a tap to a displayed triangle and its interpolated model point.
 * Painter depth order is shared with rendering; taps never use nearest centres. */
export function pickSoftwareSurface(mesh:MeshData,points:readonly ProjectedPoint[],triangles:readonly ProjectedTriangle[],x:number,y:number):Point3|undefined{
 for(let i=triangles.length-1;i>=0;i--){
  const t=triangles[i],a=points[t.a],b=points[t.b],c=points[t.c],den=(b.y-c.y)*(a.x-c.x)+(c.x-b.x)*(a.y-c.y);
  if(Math.abs(den)<1e-9)continue;
  const u=((b.y-c.y)*(x-c.x)+(c.x-b.x)*(y-c.y))/den,v=((c.y-a.y)*(x-c.x)+(a.x-c.x)*(y-c.y))/den,w=1-u-v;
  if(u<0||v<0||w<0)continue;
  const p=mesh.positions;
  return {x:p[t.a*3]*u+p[t.b*3]*v+p[t.c*3]*w,y:p[t.a*3+1]*u+p[t.b*3+1]*v+p[t.c*3+1]*w,z:p[t.a*3+2]*u+p[t.b*3+2]*v+p[t.c*3+2]*w};
 }
 return undefined;
}
