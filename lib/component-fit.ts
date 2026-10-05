import {componentEnvelopeDimensions,validateComponentClearances} from './component-clearance.ts';
import type {ComponentOpening} from './component-clearance.ts';
import type {PlacedAsset} from './assets.ts';
import type {FormModel,MeshData} from './form-engine.ts';
import {auditMesh,auditMeshAsync} from './mesh-audit.ts';
import type {MeshAudit} from './mesh-audit.ts';
import {drainSteps} from './cooperative-task.ts';
import type {CooperativeTaskOptions} from './cooperative-task.ts';

export type ComponentFitStatus='clear'|'interference'|'unverified';
export type ComponentFitBoxResult={status:ComponentFitStatus;surfaceTriangleCount:number;firstTriangle:number|null;centreInside:boolean|null};
export type ComponentFitRow={assetId:string;name:string;visible:boolean;envelope:[number,number,number];testedClearance:[number,number,number];samplingAllowance:number;seat:ComponentFitBoxResult;insertion?:ComponentFitBoxResult&ComponentOpening;status:ComponentFitStatus};
export type ComponentFitAudit={components:ComponentFitRow[];samplingAllowance:number;meshVerified:boolean;reasons:string[]};
export type ExportMeshAudit={audit:MeshAudit;componentFit:ComponentFitAudit};
/** Explicit inward allowance applied only to authored per-side clearance.
 * It is not inferred from field residuals or a bound on export approximation. */
export const COMPONENT_FIT_SAMPLING_ALLOWANCE=.05;
type Vector=[number,number,number];
type Box={center:Vector;half:Vector;rotation:number[];bounds:number[]};
const axes=['x','y','z'] as const;
const unverified=():ComponentFitBoxResult=>({status:'unverified',surfaceTriangleCount:0,firstTriangle:null,centreInside:null});

function rotation(asset:PlacedAsset){
 const a=asset.rx*Math.PI/180,b=asset.ry*Math.PI/180,c=asset.rz*Math.PI/180,cx=Math.cos(a),sx=Math.sin(a),cy=Math.cos(b),sy=Math.sin(b),cz=Math.cos(c),sz=Math.sin(c);
 // XYZ Euler: the same local-to-world basis used for linked component cuts.
 return [cy*cz,-cy*sz,sy,cx*sz+sx*sy*cz,cx*cz-sx*sy*sz,-sx*cy,sx*sz-cx*sy*cz,sx*cz+cx*sy*sz,cx*cy];
}
function box(asset:PlacedAsset,envelope:Vector,clearance:Vector,opening?:ComponentOpening):Box {
 const half=envelope.map((dimension,index)=>dimension/2+clearance[index]) as Vector,offset:Vector=[0,0,0],r=rotation(asset);
 if(opening){const index=axes.indexOf(opening.axis);half[index]+=opening.travel/2;offset[index]=opening.direction*opening.travel/2;}
 const center:Vector=[asset.x+r[0]*offset[0]+r[1]*offset[1]+r[2]*offset[2],asset.y+r[3]*offset[0]+r[4]*offset[1]+r[5]*offset[2],asset.z+r[6]*offset[0]+r[7]*offset[1]+r[8]*offset[2]];
 const extent=[0,1,2].map(axis=>Math.abs(r[axis*3])*half[0]+Math.abs(r[axis*3+1])*half[1]+Math.abs(r[axis*3+2])*half[2]);
 return {center,half,rotation:r,bounds:[...center.map((value,index)=>value-extent[index]),...center.map((value,index)=>value+extent[index])]};
}
function local(x:number,y:number,z:number,box:Box):Vector {
 const r=box.rotation,dx=x-box.center[0],dy=y-box.center[1],dz=z-box.center[2];
 return [r[0]*dx+r[3]*dy+r[6]*dz,r[1]*dx+r[4]*dy+r[7]*dz,r[2]*dx+r[5]*dy+r[8]*dz];
}

/** Complete triangle/box separating-axis test. Vertex-only tests miss a triangle
 * crossing a box with all three vertices outside. AABB-only tests can report
 * overlap for disjoint oblique triangles. Inclusive contact is interference. */
function triangleBox(a:Vector,b:Vector,c:Vector,half:Vector):boolean {
 for(let axis=0;axis<3;axis++)if(Math.min(a[axis],b[axis],c[axis])>half[axis]+1e-9||Math.max(a[axis],b[axis],c[axis])< -half[axis]-1e-9)return false;
 const separates=(x:number,y:number,z:number)=>{
  const length=Math.hypot(x,y,z);if(length<1e-15)return false;
  const pa=a[0]*x+a[1]*y+a[2]*z,pb=b[0]*x+b[1]*y+b[2]*z,pc=c[0]*x+c[1]*y+c[2]*z,radius=half[0]*Math.abs(x)+half[1]*Math.abs(y)+half[2]*Math.abs(z),epsilon=1e-9*length;
  return Math.min(pa,pb,pc)>radius+epsilon||Math.max(pa,pb,pc)< -radius-epsilon;
 };
 const ab:Vector=[b[0]-a[0],b[1]-a[1],b[2]-a[2]],ac:Vector=[c[0]-a[0],c[1]-a[1],c[2]-a[2]];
 if(separates(ab[1]*ac[2]-ab[2]*ac[1],ab[2]*ac[0]-ab[0]*ac[2],ab[0]*ac[1]-ab[1]*ac[0]))return false;
 for(const edge of [ab,[c[0]-b[0],c[1]-b[1],c[2]-b[2]],[-ac[0],-ac[1],-ac[2]]])if(separates(0,edge[2],-edge[1])||separates(-edge[2],0,edge[0])||separates(edge[1],-edge[0],0))return false;
 return true;
}

/** Signed solid angle of one captured triangle about the query centre. For a
 * closed consistently oriented boundary, winding catches a box wholly inside
 * solid even when no triangle intersects the box. No field samples are used. */
function solidAngle(ax:number,ay:number,az:number,bx:number,by:number,bz:number,cx:number,cy:number,cz:number,center:Vector):number {
 ax-=center[0];ay-=center[1];az-=center[2];bx-=center[0];by-=center[1];bz-=center[2];cx-=center[0];cy-=center[1];cz-=center[2];
 const la=Math.hypot(ax,ay,az),lb=Math.hypot(bx,by,bz),lc=Math.hypot(cx,cy,cz);
 if(Math.min(la,lb,lc)<1e-12)return 4*Math.PI;
 const determinant=ax*(by*cz-bz*cy)+ay*(bz*cx-bx*cz)+az*(bx*cy-by*cx),denominator=la*lb*lc+(ax*bx+ay*by+az*bz)*lc+(bx*cx+by*cy+bz*cz)*la+(cx*ax+cy*ay+cz*az)*lb;
 return 2*Math.atan2(determinant,denominator);
}

function* inspectBoxSteps(mesh:MeshData,probe:Box):Generator<void,ComponentFitBoxResult,void> {
 const {positions:p,indices}=mesh,bounds=probe.bounds;let surfaceTriangleCount=0,firstTriangle:number|null=null,winding=0,correction=0;
 for(let offset=0;offset<indices.length;offset+=3){
  if(offset&&offset%384===0)yield;
  const ai=indices[offset]*3,bi=indices[offset+1]*3,ci=indices[offset+2]*3,ax=p[ai],ay=p[ai+1],az=p[ai+2],bx=p[bi],by=p[bi+1],bz=p[bi+2],cx=p[ci],cy=p[ci+1],cz=p[ci+2];
  const angle=solidAngle(ax,ay,az,bx,by,bz,cx,cy,cz,probe.center)-correction,next=winding+angle;correction=(next-winding)-angle;winding=next;
  // World AABB rejects most faces before rotation and the complete SAT. No
  // per-face acceleration arrays or copies of the mesh are retained.
  if(Math.max(ax,bx,cx)<bounds[0]-1e-9||Math.min(ax,bx,cx)>bounds[3]+1e-9||Math.max(ay,by,cy)<bounds[1]-1e-9||Math.min(ay,by,cy)>bounds[4]+1e-9||Math.max(az,bz,cz)<bounds[2]-1e-9||Math.min(az,bz,cz)>bounds[5]+1e-9)continue;
  if(triangleBox(local(ax,ay,az,probe),local(bx,by,bz,probe),local(cx,cy,cz,probe),probe.half)){surfaceTriangleCount++;if(firstTriangle===null)firstTriangle=offset/3;}
 }
 const centreInside=Math.abs(winding)>2*Math.PI;
 return {status:surfaceTriangleCount>0||centreInside?'interference':'clear',surfaceTriangleCount,firstTriangle,centreInside};
}

function* finiteCoordinates(values:Float32Array):Generator<void,boolean,void> {
 for(let i=0;i<values.length;i++){if(!Number.isFinite(values[i]))return false;if((i+1)%512===0)yield;}
 return true;
}
function* invalidTriangleIndex(indices:Uint32Array,vertices:number):Generator<void,boolean,void> {
 for(let i=0;i<indices.length;i++){
  const index=indices[i];if(!Number.isInteger(index)||index<0||index>=vertices)return true;
  if((i+1)%512===0)yield;
 }
 return false;
}

/** Private to the combined audit: an external/stale report cannot establish
 * closure of different arrays, including same-size open or collapsed meshes. */
function* fitAgainstAuditSteps(model:FormModel,mesh:MeshData,meshAudit:MeshAudit):Generator<void,ComponentFitAudit,void> {
 validateComponentClearances(model);
 yield;
 const reasons:string[]=[];
 const vertices=mesh.positions.length/3,triangles=mesh.indices.length/3;
 if(!triangles||!vertices||!meshAudit.triangles||!meshAudit.components)reasons.push('Empty mesh');
 if(meshAudit.vertices!==vertices||meshAudit.triangles!==triangles)reasons.push('Mesh audit does not match captured arrays');
 if(!meshAudit.finite||!Number.isInteger(vertices)||!(yield* finiteCoordinates(mesh.positions))||!(yield* finiteCoordinates(mesh.normals)))reasons.push('Non-finite mesh coordinates or normals');
 if(meshAudit.invalidIndices||!Number.isInteger(triangles)||(yield* invalidTriangleIndex(mesh.indices,vertices)))reasons.push('Invalid triangle indices');
 if(meshAudit.boundaryEdges)reasons.push('Open mesh edges');
 if(meshAudit.nonManifoldEdges)reasons.push('Non-manifold mesh edges');
 if(meshAudit.inconsistentWindingEdges)reasons.push('Inconsistent triangle winding');
 if(meshAudit.degenerateTriangles)reasons.push('Degenerate triangles');
 const meshVerified=reasons.length===0,links=new Map((model.componentClearances??[]).map(link=>[link.assetId,link]));
 const components:ComponentFitRow[]=[];
 for(const asset of model.assets??[]){
  const link=links.get(asset.id),samplingAllowance=link?COMPONENT_FIT_SAMPLING_ALLOWANCE:0,envelope=componentEnvelopeDimensions(asset).map(dimension=>dimension*asset.scale) as Vector,testedClearance=axes.map(axis=>Math.max(0,(link?.clearance[axis]??0)-samplingAllowance)) as Vector;
  const transformValid=[asset.x,asset.y,asset.z,asset.rx,asset.ry,asset.rz,asset.scale,...envelope,...testedClearance].every(Number.isFinite)&&asset.scale>0&&envelope.every(value=>value>0),seat=meshVerified&&transformValid?(yield* inspectBoxSteps(mesh,box(asset,envelope,testedClearance))):unverified();
  const insertion=link?.opening&&link.opening.travel>0?{...link.opening,...(meshVerified&&transformValid?(yield* inspectBoxSteps(mesh,box(asset,envelope,testedClearance,link.opening))):unverified())}:undefined;
  const status:ComponentFitStatus=seat.status==='unverified'||insertion?.status==='unverified'?'unverified':seat.status==='interference'||insertion?.status==='interference'?'interference':'clear';
  components.push({assetId:asset.id,name:asset.name,visible:asset.visible,envelope,testedClearance,samplingAllowance,seat,...(insertion?{insertion}:{}),status});
  yield;
 }
 return {components,samplingAllowance:COMPONENT_FIT_SAMPLING_ALLOWANCE,meshVerified,reasons};
}

/** Audit topology once, then analyse the same captured triangles against all
 * hardware envelopes and complete authored straight insertion boxes. Clear
 * describes those boxes and this mesh, not device identity or physical fit.
 * Open/invalid/non-manifold/degenerate boundaries require further review. */
export function auditExportMesh(model:FormModel,mesh:MeshData):ExportMeshAudit {
 const audit=auditMesh(mesh),steps=fitAgainstAuditSteps(model,mesh,audit);
 for(;;){const step=steps.next();if(step.done)return {audit,componentFit:step.value};}
}

/** Cooperatively audit topology once and check every seat/insertion triangle in
 * the original order. No external report can establish captured-mesh closure. */
export async function auditExportMeshAsync(model:FormModel,mesh:MeshData,options:CooperativeTaskOptions={}):Promise<ExportMeshAudit> {
 const audit=await auditMeshAsync(mesh,options),componentFit=await drainSteps(fitAgainstAuditSteps(model,mesh,audit),options);
 return {audit,componentFit};
}

/** Standalone fit check always audits the captured mesh itself. */
export function auditComponentFit(model:FormModel,mesh:MeshData):ComponentFitAudit {
 return auditExportMesh(model,mesh).componentFit;
}
