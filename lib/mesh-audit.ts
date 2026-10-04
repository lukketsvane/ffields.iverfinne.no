import type {MeshData} from './form-engine.ts';

export type MeshAudit={
 dimensions:[number,number,number];triangles:number;vertices:number;components:number;
 boundaryEdges:number;nonManifoldEdges:number;inconsistentWindingEdges:number;
 degenerateTriangles:number;invalidIndices:number;finite:boolean;volume:number;
};

/** Inspect indexed mesh connectivity. This does not test intersections or loads. */
export function auditMesh(mesh:MeshData):MeshAudit{
 const {positions:p,normals,indices}=mesh,vertices=p.length/3;
 const finite=Number.isInteger(vertices)&&p.every(Number.isFinite)&&normals.every(Number.isFinite);
 const count=Math.floor(vertices),parents=new Int32Array(count),used=new Uint8Array(count);
 for(let i=0;i<count;i++)parents[i]=i;
 const find=(start:number)=>{let i=start;while(parents[i]!==i){parents[i]=parents[parents[i]];i=parents[i]}return i};
 const join=(a:number,b:number)=>{const aa=find(a),bb=find(b);if(aa!==bb)parents[bb]=aa};
 const edges=new Map<string,{count:number;direction:number}>();
 let invalidIndices=indices.length%3,degenerateTriangles=0,signedVolume=0;
 const bounds=[Infinity,Infinity,Infinity,-Infinity,-Infinity,-Infinity];
 for(let i=0;i<p.length;i+=3)for(let axis=0;axis<3;axis++){bounds[axis]=Math.min(bounds[axis],p[i+axis]);bounds[axis+3]=Math.max(bounds[axis+3],p[i+axis])}
 for(let i=0;i+2<indices.length;i+=3){
  const a=indices[i],b=indices[i+1],c=indices[i+2];
  if([a,b,c].some(v=>!Number.isInteger(v)||v<0||v>=count)){invalidIndices++;continue}
  used[a]=used[b]=used[c]=1;join(a,b);join(a,c);
  for(const [u,v] of [[a,b],[b,c],[c,a]]){
   const key=u<v?u+':'+v:v+':'+u,edge=edges.get(key)??{count:0,direction:0};
   edge.count++;edge.direction+=u<v?1:-1;edges.set(key,edge);
  }
  const ai=a*3,bi=b*3,ci=c*3,ux=p[bi]-p[ai],uy=p[bi+1]-p[ai+1],uz=p[bi+2]-p[ai+2],vx=p[ci]-p[ai],vy=p[ci+1]-p[ai+1],vz=p[ci+2]-p[ai+2];
  const area2=Math.hypot(uy*vz-uz*vy,uz*vx-ux*vz,ux*vy-uy*vx);
  if(!Number.isFinite(area2)||area2<=1e-12)degenerateTriangles++;
  signedVolume+=(p[ai]*(p[bi+1]*p[ci+2]-p[bi+2]*p[ci+1])+p[ai+1]*(p[bi+2]*p[ci]-p[bi]*p[ci+2])+p[ai+2]*(p[bi]*p[ci+1]-p[bi+1]*p[ci]))/6;
 }
 let boundaryEdges=0,nonManifoldEdges=0,inconsistentWindingEdges=0;
 for(const edge of edges.values()){
  if(edge.count===1)boundaryEdges++;
  if(edge.count>2)nonManifoldEdges++;
  if(edge.count===2&&edge.direction!==0)inconsistentWindingEdges++;
 }
 const roots=new Set<number>();for(let i=0;i<count;i++)if(used[i])roots.add(find(i));
 const dimensions=(finite&&count?[0,1,2].map(a=>bounds[a+3]-bounds[a]):[0,0,0]) as [number,number,number];
 return {dimensions,triangles:Math.floor(indices.length/3),vertices:count,components:roots.size,boundaryEdges,nonManifoldEdges,inconsistentWindingEdges,degenerateTriangles,invalidIndices,finite,volume:Number.isFinite(signedVolume)?Math.abs(signedVolume):0};
}
