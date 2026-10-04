import type {MeshData} from './form-engine.ts';

export type SurfaceField=(x:number,y:number,z:number)=>number;
export type MeshRefinementOptions={
 /** A residual in the field's own units, not a manufacturing tolerance. */
 tolerance:number;
 maxPasses?:number;
 maxTriangles?:number;
 /** Maximum displacement as a fraction of the edge being split. */
 maxEdgeDisplacement?:number;
 /** An additional world-coordinate limit on midpoint projection. */
 maxProjectionDistance?:number;
 projectionIterations?:number;
};
export type MeshRefinementStats={
 passes:number;inputTriangles:number;outputTriangles:number;markedEdges:number;
 projectedVertices:number;rejectedProjections:number;fieldEvaluations:number;
 maxMidpointResidualBefore:number;maxMidpointResidualAfter:number;
 maxFaceResidualBefore:number;maxFaceResidualAfter:number;maxDisplacement:number;
 meanMidpointResidualBefore:number;meanMidpointResidualAfter:number;
 meanFaceResidualBefore:number;meanFaceResidualAfter:number;
 budgetLimited:boolean;qualityLimited:boolean;degenerateInputTriangles:number;degenerateOutputTriangles:number;
 nonfiniteFieldValues:number;
};
export type RefinedMeshData=MeshData&{refinement:MeshRefinementStats};
type Edge={a:number;b:number;length:number;residual:number;priority:number;faces:number[];midpoint?:number};
type WorkingMesh={positions:number[];normals:number[];indices:number[]};
type Analysis={edges:Map<number,Edge>;faceResiduals:number[];maxMidpointResidual:number;maxFaceResidual:number;meanMidpointResidual:number;meanFaceResidual:number};
const edgeKey=(a:number,b:number,count:number)=>Math.min(a,b)*count+Math.max(a,b);
const length3=(x:number,y:number,z:number)=>Math.hypot(x,y,z);

/** Refine an existing surface against its actual implicit field. Shared edge
 * splits are conforming, so adjacent triangles never acquire a T junction.
 * The original vertices and topology are retained. Refinement cannot recover
 * a hole or component that the original grid did not sample. */
export function refineMeshSurface(mesh:MeshData,field:SurfaceField,options:MeshRefinementOptions):RefinedMeshData {
 const tolerance=options.tolerance,maxPasses=options.maxPasses??2,maxTriangles=options.maxTriangles??900000;
 const displacementFraction=options.maxEdgeDisplacement??.55,maxDistance=options.maxProjectionDistance??Infinity,iterations=options.projectionIterations??8;
 if(!Number.isFinite(tolerance)||tolerance<=0)throw Error('Surface refinement needs a positive finite field tolerance.');
 if(!Number.isInteger(maxPasses)||maxPasses<0||maxPasses>6)throw Error('Surface refinement supports zero to six passes.');
 if(!Number.isInteger(maxTriangles)||maxTriangles<1)throw Error('Surface refinement needs a positive triangle budget.');
 if(!Number.isFinite(displacementFraction)||displacementFraction<=0||displacementFraction>.75)throw Error('Edge displacement must be greater than zero and at most 0.75.');
 if(!(maxDistance>0)||Number.isNaN(maxDistance))throw Error('Projection distance must be positive.');
 if(!Number.isInteger(iterations)||iterations<1||iterations>20)throw Error('Projection iterations must be from one to twenty.');
 if(mesh.positions.length%3||mesh.normals.length!==mesh.positions.length||mesh.indices.length%3)throw Error('Surface refinement received inconsistent mesh arrays.');
 const vertexCount=mesh.positions.length/3;
 for(const value of mesh.positions)if(!Number.isFinite(value))throw Error('Surface refinement needs finite vertex positions.');
 for(const value of mesh.normals)if(!Number.isFinite(value))throw Error('Surface refinement needs finite vertex normals.');
 for(const index of mesh.indices)if(index<0||index>=vertexCount)throw Error('Surface refinement received an invalid vertex index.');
 const stats:MeshRefinementStats={passes:0,inputTriangles:mesh.indices.length/3,outputTriangles:mesh.indices.length/3,markedEdges:0,projectedVertices:0,rejectedProjections:0,fieldEvaluations:0,maxMidpointResidualBefore:0,maxMidpointResidualAfter:0,maxFaceResidualBefore:0,maxFaceResidualAfter:0,meanMidpointResidualBefore:0,meanMidpointResidualAfter:0,meanFaceResidualBefore:0,meanFaceResidualAfter:0,maxDisplacement:0,budgetLimited:false,qualityLimited:false,degenerateInputTriangles:0,degenerateOutputTriangles:0,nonfiniteFieldValues:0};
 const sample:SurfaceField=(x,y,z)=>{stats.fieldEvaluations++;const value=field(x,y,z);if(!Number.isFinite(value))stats.nonfiniteFieldValues++;return value;};
 let current:WorkingMesh={positions:Array.from(mesh.positions),normals:Array.from(mesh.normals),indices:Array.from(mesh.indices)};
 const cross=(p:number[],a:number,b:number,c:number)=>{
  const ax=p[b*3]-p[a*3],ay=p[b*3+1]-p[a*3+1],az=p[b*3+2]-p[a*3+2],bx=p[c*3]-p[a*3],by=p[c*3+1]-p[a*3+1],bz=p[c*3+2]-p[a*3+2];
  return [ay*bz-az*by,az*bx-ax*bz,ax*by-ay*bx];
 };
 const degenerateCount=(working:WorkingMesh)=>{let count=0;for(let i=0;i<working.indices.length;i+=3){const n=cross(working.positions,working.indices[i],working.indices[i+1],working.indices[i+2]);if(n[0]*n[0]+n[1]*n[1]+n[2]*n[2]<1e-24)count++;}return count;};
 stats.degenerateInputTriangles=degenerateCount(current);
 const analyze=(working:WorkingMesh):Analysis=>{
  const count=working.positions.length/3,edges=new Map<number,Edge>(),faceResiduals:number[]=[],p=working.positions,index=working.indices;let maxMidpointResidual=0,maxFaceResidual=0,midpointSum=0,faceSum=0;
  for(let face=0;face<index.length/3;face++){
   const a=index[face*3],b=index[face*3+1],c=index[face*3+2];
   const centerValue=sample((p[a*3]+p[b*3]+p[c*3])/3,(p[a*3+1]+p[b*3+1]+p[c*3+1])/3,(p[a*3+2]+p[b*3+2]+p[c*3+2])/3);
   const centerResidual=Number.isFinite(centerValue)?Math.abs(centerValue):0;faceResiduals.push(centerResidual);maxFaceResidual=Math.max(maxFaceResidual,centerResidual);faceSum+=centerResidual;
   for(const [first,second] of [[a,b],[b,c],[c,a]]){
    const key=edgeKey(first,second,count);let edge=edges.get(key);
    if(!edge){const aa=Math.min(first,second),bb=Math.max(first,second),value=sample((p[aa*3]+p[bb*3])/2,(p[aa*3+1]+p[bb*3+1])/2,(p[aa*3+2]+p[bb*3+2])/2),residual=Number.isFinite(value)?Math.abs(value):0;
     edge={a:aa,b:bb,length:length3(p[aa*3]-p[bb*3],p[aa*3+1]-p[bb*3+1],p[aa*3+2]-p[bb*3+2]),residual,priority:residual,faces:[]};edges.set(key,edge);maxMidpointResidual=Math.max(maxMidpointResidual,residual);midpointSum+=residual;
    }
    edge.faces.push(face);
    // A triangle may contain a curved patch even when its edge midpoints
    // happen to lie on a zero. Splitting its edges samples that interior.
    edge.priority=Math.max(edge.priority,centerResidual);
   }
  }
  return {edges,faceResiduals,maxMidpointResidual,maxFaceResidual,meanMidpointResidual:midpointSum/Math.max(edges.size,1),meanFaceResidual:faceSum/Math.max(index.length/3,1)};
 };
 const gradient=(x:number,y:number,z:number,epsilon:number)=>[
  (sample(x+epsilon,y,z)-sample(x-epsilon,y,z))/(2*epsilon),
  (sample(x,y+epsilon,z)-sample(x,y-epsilon,z))/(2*epsilon),
  (sample(x,y,z+epsilon)-sample(x,y,z-epsilon))/(2*epsilon),
 ];
 const project=(origin:number[],edge:Edge,allowCrease=true)=>{
  const limit=Math.min(maxDistance,edge.length*displacementFraction),epsilon=Math.max(1e-5,Math.min(.04,edge.length*.01));let point=origin.slice(),value=sample(...point as [number,number,number]);
  // Across a sharp feature, nearest-surface Newton alone can choose either
  // face and flatten the rim into its neighbour. The two endpoint tangent
  // planes give a bounded crease-aware initial guess. It is only a guess:
  // acceptance still requires a root of the actual field and unfolded faces.
  const na=current.normals.slice(edge.a*3,edge.a*3+3),nb=current.normals.slice(edge.b*3,edge.b*3+3),la=length3(na[0],na[1],na[2]),lb=length3(nb[0],nb[1],nb[2]);
  if(allowCrease&&la>1e-8&&lb>1e-8){
   for(let axis=0;axis<3;axis++){na[axis]/=la;nb[axis]/=lb;}
   const cosine=na[0]*nb[0]+na[1]*nb[1]+na[2]*nb[2];
   if(cosine<.8&&cosine>-.2){
    let ra=0,rb=0;for(let axis=0;axis<3;axis++){ra+=na[axis]*(current.positions[edge.a*3+axis]-origin[axis]);rb+=nb[axis]*(current.positions[edge.b*3+axis]-origin[axis]);}
    const denominator=1-cosine*cosine,a=(ra-cosine*rb)/denominator,b=(rb-cosine*ra)/denominator,candidate=origin.map((coordinate,axis)=>coordinate+a*na[axis]+b*nb[axis]);
    if(length3(candidate[0]-origin[0],candidate[1]-origin[1],candidate[2]-origin[2])<=limit){const candidateValue=sample(...candidate as [number,number,number]);if(Number.isFinite(candidateValue)&&Math.abs(candidateValue)<Math.abs(value)){point=candidate;value=candidateValue;}}
   }
  }
  const target=Math.max(tolerance*.02,1e-7);let success=Number.isFinite(value);
  for(let step=0;success&&Math.abs(value)>target&&step<iterations;step++){
   const g=gradient(point[0],point[1],point[2],epsilon),squared=g[0]*g[0]+g[1]*g[1]+g[2]*g[2];
   if(!Number.isFinite(squared)||squared<1e-12){success=false;break;}
   let accepted=false;
   for(let line=0;line<6;line++){
    const amount=-value/squared*Math.pow(.5,line),candidate=point.map((coordinate,axis)=>coordinate+g[axis]*amount),distance=length3(candidate[0]-origin[0],candidate[1]-origin[1],candidate[2]-origin[2]);
    if(distance>limit){const ratio=limit/distance;for(let axis=0;axis<3;axis++)candidate[axis]=origin[axis]+(candidate[axis]-origin[axis])*ratio;}
    const candidateValue=sample(...candidate as [number,number,number]);
    if(Number.isFinite(candidateValue)&&Math.abs(candidateValue)<Math.abs(value)-1e-12){point=candidate;value=candidateValue;accepted=true;break;}
   }
   if(!accepted){success=false;break;}
  }
  // Failed roots remain ordinary linear subdivisions; they do not invent a
  // nearby feature or snap across an unsampled narrow wall.
  if(!success||Math.abs(value)>target)return {point:origin,epsilon,projected:false};
  return {point,epsilon,projected:length3(point[0]-origin[0],point[1]-origin[1],point[2]-origin[2])>1e-10};
 };
 let analysis=analyze(current);
 const blockedEdges=new Set<string>();
 stats.maxMidpointResidualBefore=analysis.maxMidpointResidual;stats.maxFaceResidualBefore=analysis.maxFaceResidual;stats.meanMidpointResidualBefore=analysis.meanMidpointResidual;stats.meanFaceResidualBefore=analysis.meanFaceResidual;
 for(let pass=0;pass<maxPasses;pass++){
  if(stats.nonfiniteFieldValues){stats.qualityLimited=true;break;}
  const candidates=Array.from(analysis.edges.values()).filter(edge=>edge.priority>tolerance&&edge.length>1e-8&&!blockedEdges.has(edge.a+':'+edge.b)).sort((a,b)=>b.priority-a.priority);
  if(!candidates.length)break;
  let triangleCount=current.indices.length/3;let selected:Edge[]=[];
  for(const edge of candidates){if(triangleCount+edge.faces.length>maxTriangles){stats.budgetLimited=true;continue;}selected.push(edge);triangleCount+=edge.faces.length;}
  if(!selected.length)break;
  let accepted=false;
  // Rebuild conformingly after freezing only the parent patches that cannot
  // meet the sampled quality checks. Shared original edges are blocked on
  // both sides, so removing a proposal never leaves a T junction behind.
  for(let rebuild=0;rebuild<4&&selected.length;rebuild++){
  for(const edge of analysis.edges.values())delete edge.midpoint;
  const previous=current,next:WorkingMesh={positions:previous.positions.slice(),normals:previous.normals.slice(),indices:[]},count=previous.positions.length/3;
  const origins=new Map<number,number[]>(),epsilonByVertex=new Map<number,number>(),edgeByVertex=new Map<number,Edge>(),projected=new Set<number>(),fallbackTried=new Set<number>();
  for(const edge of selected){const origin=[0,1,2].map(axis=>Math.fround((previous.positions[edge.a*3+axis]+previous.positions[edge.b*3+axis])/2)),result=project(origin,edge),index=next.positions.length/3;edge.midpoint=index;
   origins.set(index,origin);epsilonByVertex.set(index,result.epsilon);edgeByVertex.set(index,edge);next.positions.push(...result.point.map(Math.fround));
   const normal=[0,1,2].map(axis=>previous.normals[edge.a*3+axis]+previous.normals[edge.b*3+axis]),length=length3(normal[0],normal[1],normal[2])||1;next.normals.push(normal[0]/length,normal[1]/length,normal[2]/length);
   if(result.projected)projected.add(index);else if(edge.residual>tolerance*.02)stats.rejectedProjections++;
  }
  const parentFace:number[]=[];
  const emit=(face:number,...triangles:number[][])=>{for(const triangle of triangles){next.indices.push(...triangle);parentFace.push(face);}};
  for(let face=0;face<previous.indices.length/3;face++){
   const a=previous.indices[face*3],b=previous.indices[face*3+1],c=previous.indices[face*3+2],ab=analysis.edges.get(edgeKey(a,b,count))?.midpoint,bc=analysis.edges.get(edgeKey(b,c,count))?.midpoint,ca=analysis.edges.get(edgeKey(c,a,count))?.midpoint;
   const mask=(ab===undefined?0:1)+(bc===undefined?0:2)+(ca===undefined?0:4);
   switch(mask){
    case 0:emit(face,[a,b,c]);break;
    case 1:emit(face,[a,ab!,c],[ab!,b,c]);break;
    case 2:emit(face,[a,b,bc!],[a,bc!,c]);break;
    case 4:emit(face,[a,b,ca!],[b,c,ca!]);break;
    case 3:emit(face,[ab!,b,bc!],[a,ab!,c],[ab!,bc!,c]);break;
    case 5:emit(face,[a,ab!,ca!],[ab!,b,c],[ab!,c,ca!]);break;
    case 6:emit(face,[ca!,bc!,c],[a,b,ca!],[b,bc!,ca!]);break;
    case 7:emit(face,[a,ab!,ca!],[ab!,b,bc!],[ca!,bc!,c],[ab!,bc!,ca!]);break;
   }
  }
  // A projection can be a correct field root but still fold a very thin
  // neighbouring triangle. Downgrade the involved shared midpoint globally,
  // never just one side of that edge. Linear subdivision is always retained.
  for(let attempt=0;attempt<8;attempt++){
   const rejected=new Set<number>();
   for(let triangle=0;triangle<next.indices.length/3;triangle++){
    const parent=parentFace[triangle]*3,old=cross(previous.positions,previous.indices[parent],previous.indices[parent+1],previous.indices[parent+2]),a=next.indices[triangle*3],b=next.indices[triangle*3+1],c=next.indices[triangle*3+2],n=cross(next.positions,a,b,c),squared=old[0]*old[0]+old[1]*old[1]+old[2]*old[2];
    if(squared>1e-24&&n[0]*old[0]+n[1]*old[1]+n[2]*old[2]<=squared*1e-7)for(const index of [a,b,c])if(projected.has(index))rejected.add(index);
   }
   if(!rejected.size)break;
   for(const index of rejected){const origin=origins.get(index)!;
    if(attempt<7&&!fallbackTried.has(index)){fallbackTried.add(index);const fallback=project(origin,edgeByVertex.get(index)!,false);if(fallback.projected&&length3(fallback.point[0]-next.positions[index*3],fallback.point[1]-next.positions[index*3+1],fallback.point[2]-next.positions[index*3+2])>1e-7){for(let axis=0;axis<3;axis++)next.positions[index*3+axis]=Math.fround(fallback.point[axis]);continue;}}
    for(let axis=0;axis<3;axis++)next.positions[index*3+axis]=origin[axis];projected.delete(index);stats.rejectedProjections++;
   }
  }
  let passMaxDisplacement=0;
  for(const index of projected){const point=next.positions.slice(index*3,index*3+3),g=gradient(point[0],point[1],point[2],epsilonByVertex.get(index)!),length=length3(g[0],g[1],g[2]);if(Number.isFinite(length)&&length>1e-8)for(let axis=0;axis<3;axis++)next.normals[index*3+axis]=g[axis]/length;const origin=origins.get(index)!;passMaxDisplacement=Math.max(passMaxDisplacement,length3(point[0]-origin[0],point[1]-origin[1],point[2]-origin[2]));}
  const nextAnalysis=analyze(next),allowedNoise=Math.max(1e-6,tolerance*.001);
  const badParents=new Set<number>();
  for(const edge of nextAnalysis.edges.values())if(edge.residual>analysis.maxMidpointResidual+allowedNoise)for(const child of edge.faces)badParents.add(parentFace[child]);
  const moreDegenerate=degenerateCount(next)>degenerateCount(previous);
  for(let triangle=0;triangle<next.indices.length/3;triangle++){
   const parent=parentFace[triangle],offset=parent*3,old=cross(previous.positions,previous.indices[offset],previous.indices[offset+1],previous.indices[offset+2]),n=cross(next.positions,next.indices[triangle*3],next.indices[triangle*3+1],next.indices[triangle*3+2]),oldSquared=old[0]*old[0]+old[1]*old[1]+old[2]*old[2],newSquared=n[0]*n[0]+n[1]*n[1]+n[2]*n[2];
   if(nextAnalysis.faceResiduals[triangle]>analysis.maxFaceResidual+allowedNoise||(oldSquared>1e-24&&n[0]*old[0]+n[1]*old[1]+n[2]*old[2]<=oldSquared*1e-7)||(moreDegenerate&&newSquared<1e-24))badParents.add(parent);
  }
  if(badParents.size&&rebuild<3&&!stats.nonfiniteFieldValues){
   // Include one original-face ring: changing a shared edge's split mask can
   // otherwise move the same sharp-feature failure into its immediate
   // neighbour on each retry. The rest of the mesh remains independently
   // refinable; this halo is finite and uses the original conforming graph.
   for(const parent of [...badParents]){const offset=parent*3,a=previous.indices[offset],b=previous.indices[offset+1],c=previous.indices[offset+2];for(const [first,second] of [[a,b],[b,c],[c,a]])for(const neighbour of analysis.edges.get(edgeKey(first,second,count))!.faces)badParents.add(neighbour);}
   const before=selected.length;
   for(const parent of badParents){const offset=parent*3,a=previous.indices[offset],b=previous.indices[offset+1],c=previous.indices[offset+2];for(const [first,second] of [[a,b],[b,c],[c,a]])blockedEdges.add(Math.min(first,second)+':'+Math.max(first,second));}
   selected=selected.filter(edge=>!blockedEdges.has(edge.a+':'+edge.b));
   if(before>selected.length){stats.qualityLimited=true;continue;}
  }
  // Sampled error is an honest acceptance condition, not a claim of a global
  // Hausdorff bound. Rare unresolved sharp corners must not get worse merely
  // because average smooth-surface error falls.
  if(stats.nonfiniteFieldValues||badParents.size||nextAnalysis.maxMidpointResidual>analysis.maxMidpointResidual+allowedNoise||nextAnalysis.maxFaceResidual>analysis.maxFaceResidual+allowedNoise||moreDegenerate){stats.qualityLimited=true;break;}
  stats.projectedVertices+=projected.size;stats.markedEdges+=selected.length;stats.maxDisplacement=Math.max(stats.maxDisplacement,passMaxDisplacement);stats.passes++;current=next;analysis=nextAnalysis;accepted=true;break;
  }
  if(!accepted)break;
 }
 stats.maxMidpointResidualAfter=analysis.maxMidpointResidual;stats.maxFaceResidualAfter=analysis.maxFaceResidual;stats.meanMidpointResidualAfter=analysis.meanMidpointResidual;stats.meanFaceResidualAfter=analysis.meanFaceResidual;stats.outputTriangles=current.indices.length/3;stats.degenerateOutputTriangles=degenerateCount(current);
 const bounds=current.positions.length?[Infinity,Infinity,Infinity,-Infinity,-Infinity,-Infinity]:[0,0,0,0,0,0];
 for(let i=0;i<current.positions.length;i+=3)for(let axis=0;axis<3;axis++){bounds[axis]=Math.min(bounds[axis],current.positions[i+axis]);bounds[axis+3]=Math.max(bounds[axis+3],current.positions[i+axis]);}
 let volume=0;for(let i=0;i<current.indices.length;i+=3){const a=current.indices[i]*3,b=current.indices[i+1]*3,c=current.indices[i+2]*3,p=current.positions;volume+=(p[a]*(p[b+1]*p[c+2]-p[b+2]*p[c+1])+p[a+1]*(p[b+2]*p[c]-p[b]*p[c+2])+p[a+2]*(p[b]*p[c+1]-p[b+1]*p[c]))/6;}
 return {positions:new Float32Array(current.positions),normals:new Float32Array(current.normals),indices:new Uint32Array(current.indices),volume:Math.abs(volume),bounds,refinement:stats};
}
