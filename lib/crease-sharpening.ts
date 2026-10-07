import {drainSteps} from './cooperative-task.ts';
import type {CooperativeTaskOptions} from './cooperative-task.ts';
import type {MeshData} from './form-engine.ts';
import type {SurfaceField} from './mesh-refinement.ts';

export type CreaseOptions={
 /** Endpoint normals closer than this (degrees) are treated as one smooth patch. */
 minAngle?:number;
 /** Tested edge ceiling. Beyond it the remaining edges keep their sampled chords. */
 maxEdges?:number;
};
export type CreaseStats={candidates:number;smooth:number;creases:number;snapped:number;fieldEvaluations:number;limited:boolean};
/** Seam vertices lie on a hard crease and carry one normal per side. */
export type CreaseSeams={vertices:Uint32Array;normals:Float32Array};
export type CreaseMeshData=MeshData&{creases?:CreaseStats;seams?:CreaseSeams};

const SPLITS:readonly (readonly (readonly number[])[])[]=[
 [[0,1,2]],
 [[0,3,2],[3,1,2]],
 [[0,1,4],[0,4,2]],
 [[3,1,4],[0,3,2],[3,4,2]],
 [[0,1,5],[1,2,5]],
 [[0,3,5],[3,1,2],[3,2,5]],
 [[5,4,2],[0,1,5],[1,4,5]],
 [[0,3,5],[3,1,4],[5,4,2],[3,4,5]],
];

/** A hard CSG seam crosses grid cells diagonally, so marching tetrahedra cut
 * its corners and the rim reads as a saw blade. Each edge whose endpoint
 * normals disagree is bisected along the surface until the field's gradient
 * flips; the seam point is where the two one-sided tangent planes meet. Both
 * faces of that edge are split there, so the surface stays watertight. A seam
 * just past an endpoint moves that vertex onto it instead. Smooth, merely
 * curved patches keep one gradient across the bracket and are left alone. */
function* creaseSteps(mesh:MeshData,field:SurfaceField,options:CreaseOptions={}):Generator<void,CreaseMeshData,void>{
 const minAngle=options.minAngle??24,maxEdges=options.maxEdges??60000,cosMin=Math.cos(minAngle*Math.PI/180);
 const P=mesh.positions,N=mesh.normals,I=mesh.indices,count=P.length/3;
 const stats:CreaseStats={candidates:0,smooth:0,creases:0,snapped:0,fieldEvaluations:0,limited:false};
 const F=(x:number,y:number,z:number)=>{stats.fieldEvaluations++;return field(x,y,z);};
 const dotN=(a:number,b:number)=>N[a*3]*N[b*3]+N[a*3+1]*N[b*3+1]+N[a*3+2]*N[b*3+2];
 // Only edges across a normal jump are keyed; every other face passes through.
 const candidates=new Map<number,number>(),edgeA:number[]=[],edgeB:number[]=[],touched=new Uint8Array(count);
 for(let f=0;f<I.length;f+=3){
  if(f%6144===0)yield;
  for(let k=0;k<3;k++){
   const a=I[f+k],b=I[f+(k+1)%3],cosine=dotN(a,b);
   if(cosine>cosMin||cosine< -.5)continue;
   const lo=a<b?a:b,hi=a<b?b:a,key=lo*count+hi;
   if(!candidates.has(key)){candidates.set(key,edgeA.length);edgeA.push(lo);edgeB.push(hi);touched[lo]=1;touched[hi]=1;}
  }
 }
 // Over budget, the sharpest jumps go first; the rest keep their sampled chords.
 const order=Array.from(edgeA.keys());
 if(order.length>maxEdges){const jump=order.map(e=>dotN(edgeA[e],edgeB[e]));order.sort((p,q)=>jump[p]-jump[q]);order.length=maxEdges;stats.limited=true;}
 const split=new Int32Array(edgeA.length).fill(-1);
 const outP:number[]=Array.from(P),outN:number[]=Array.from(N),seamVertices:number[]=[],seamNormals:number[]=[],seamOf=new Map<number,number>();
 const unit=(v:number[])=>{const l=Math.hypot(v[0],v[1],v[2]);return l>1e-12?[v[0]/l,v[1]/l,v[2]/l]:undefined;};
 // Forward differences from a projected point whose own value is already known.
 const gradient=(q:number[],e:number)=>{const [x,y,z,f]=q;return unit([F(x+e,y,z)-f,F(x,y+e,z)-f,F(x,y,z+e)-f]);};
 const seam=(vertex:number,point:number[],ga:number[],gb:number[])=>{
  outP[vertex*3]=point[0];outP[vertex*3+1]=point[1];outP[vertex*3+2]=point[2];
  outN[vertex*3]=ga[0];outN[vertex*3+1]=ga[1];outN[vertex*3+2]=ga[2];
  seamOf.set(vertex,seamVertices.length);seamVertices.push(vertex);seamNormals.push(...ga,...gb);
 };
 for(let o=0;o<order.length;o++){
  if(o%32===0)yield;
  const e=order[o];
  stats.candidates++;
  const a=edgeA[e],b=edgeB[e],na=unit([N[a*3],N[a*3+1],N[a*3+2]]),nb=unit([N[b*3],N[b*3+1],N[b*3+2]]);
  if(!na||!nb)continue;
  const cosine=Math.max(-1,Math.min(1,na[0]*nb[0]+na[1]*nb[1]+na[2]*nb[2]));
  const ax=P[a*3],ay=P[a*3+1],az=P[a*3+2],ux=P[b*3]-ax,uy=P[b*3+1]-ay,uz=P[b*3+2]-az,length=Math.hypot(ux,uy,uz);
  const bisector=unit([na[0]+nb[0],na[1]+nb[1],na[2]+nb[2]]);
  if(!bisector||length<1e-6)continue;
  const tolerance=Math.max(1e-6,length*1e-4),limit=length*.6,step=Math.max(1e-4,Math.min(.02,length*.01)),slope=Math.max(.3,Math.sqrt((1+cosine)/2));
  // Root of the field along the bisector, through a point of the chord.
  const project=(t:number):number[]|undefined=>{
   const px=ax+ux*t,py=ay+uy*t,pz=az+uz*t,at=(s:number)=>F(px+bisector[0]*s,py+bisector[1]*s,pz+bisector[2]*s);
   let s0=0,f0=at(0);if(!Number.isFinite(f0))return;if(Math.abs(f0)<=tolerance)return [px,py,pz,f0];
   let s1=Math.max(-limit,Math.min(limit,-f0/slope)),f1=at(s1);
   for(let grow=0;grow<4&&Number.isFinite(f1)&&(f1<0)===(f0<0)&&Math.abs(s1)<limit;grow++){s0=s1;f0=f1;s1=Math.max(-limit,Math.min(limit,s1*2.2));f1=at(s1);}
   if(!Number.isFinite(f1)||(f1<0)===(f0<0))return;
   let s=s1,last=f1;
   for(let i=0;i<10;i++){
    const candidate=s0+(s1-s0)*f0/(f0-f1);s=i%2===1||!Number.isFinite(candidate)?(s0+s1)/2:candidate;
    const value=at(s);if(!Number.isFinite(value))return;last=value;if(Math.abs(value)<=tolerance)break;
    if((value<0)===(f0<0)){s0=s;f0=value;}else{s1=s;f1=value;}
   }
   return [px+bisector[0]*s,py+bisector[1]*s,pz+bisector[2]*s,last];
  };
  const sideA=(g:number[])=>g[0]*na[0]+g[1]*na[1]+g[2]*na[2]>=g[0]*nb[0]+g[1]*nb[1]+g[2]*nb[2];
  // Smooth curvature turns the gradient steadily along the edge, a crease
  // flips it. Two cheap probes reject the steady turn before the bisection.
  const fine=Math.min(step,.005),turn=Math.acos(cosine);
  const probe=(t:number)=>{const q=project(t);return q?gradient(q,fine):undefined;};
  const angle=(u:number[],v:number[])=>Math.acos(Math.max(-1,Math.min(1,u[0]*v[0]+u[1]*v[1]+u[2]*v[2])));
  const early=probe(.3),late=probe(.7);
  if(early&&late){
   const a=angle(early,na)/turn,b=angle(late,na)/turn;
   const flipped=Math.min(a,1-a)<=.25&&Math.min(b,1-b)<=.25,abrupt=angle(early,late)>=.55*turn;
   if(!flipped&&!abrupt){stats.smooth++;continue;}
  }
  let lo=0,hi=1,failed=false;
  // The seam point comes from the tangent planes, so the bracket only has to
  // shrink below the one-sided read offset: seven halvings are enough.
  for(let iteration=0;iteration<7;iteration++){
   const t=(lo+hi)/2,q=project(t);
   if(!q){failed=true;break;}
   const g=gradient(q,Math.min(step,length*(hi-lo)*.25));
   if(!g){failed=true;break;}
   if(sideA(g))lo=t;else hi=t;
  }
  if(failed)continue;
  // Read each side a few stencils away, where its gradient is unmixed. Near
  // an endpoint the sample continues past it along the same patch.
  const offset=Math.min(.2,Math.max(.02,fine*8/length)),qa=project((lo+hi)/2-offset),qb=project((lo+hi)/2+offset);
  if(!qa||!qb)continue;
  const ga=gradient(qa,fine),gb=gradient(qb,fine);
  if(!ga||!gb||!sideA(ga)||sideA(gb))continue;
  // A real seam keeps most of the endpoint angle across a hair's width.
  const across=ga[0]*gb[0]+ga[1]*gb[1]+ga[2]*gb[2];
  if(across>Math.cos(Math.max(minAngle*Math.PI/360,Math.acos(cosine)*.5)))continue;
  const mx=(qa[0]+qb[0])/2,my=(qa[1]+qb[1])/2,mz=(qa[2]+qb[2])/2;
  const ra=ga[0]*(qa[0]-mx)+ga[1]*(qa[1]-my)+ga[2]*(qa[2]-mz),rb=gb[0]*(qb[0]-mx)+gb[1]*(qb[1]-my)+gb[2]*(qb[2]-mz),det=1-across*across;
  if(det<1e-6)continue;
  const ka=(ra-across*rb)/det,kb=(rb-across*ra)/det,point=[mx+ka*ga[0]+kb*gb[0],my+ka*ga[1]+kb*gb[1],mz+ka*ga[2]+kb*gb[2]];
  if(Math.hypot(point[0]-mx,point[1]-my,point[2]-mz)>Math.max(length*.25,fine*20))continue;
  const along=((point[0]-ax)*ux+(point[1]-ay)*uy+(point[2]-az)*uz)/(length*length);
  if(along>.03&&along<.97){
   split[e]=outP.length/3;stats.creases++;
   outP.push(point[0],point[1],point[2]);outN.push(ga[0],ga[1],ga[2]);
   seamOf.set(split[e],seamVertices.length);seamVertices.push(split[e]);seamNormals.push(...ga,...gb);
  }else if(along>-.25&&along<1.25){
   const vertex=along<=.03?a:b;
   if(!seamOf.has(vertex)){seam(vertex,point,ga,gb);stats.snapped++;}
  }
 }
 // No seam found: the sampled mesh is returned untouched, byte for byte.
 if(!seamVertices.length)return mesh;
 const outI:number[]=[],corner=[0,0,0,0,0,0];
 const crease=(a:number,b:number)=>{if(!touched[a]||!touched[b])return -1;const index=candidates.get(a<b?a*count+b:b*count+a);return index===undefined?-1:split[index];};
 for(let f=0;f<I.length;f+=3){
  if(f%3072===0)yield;
  const a=I[f],b=I[f+1],c=I[f+2];
  if(!touched[a]&&!touched[b]&&!touched[c]){outI.push(a,b,c);continue;}
  const ab=crease(a,b),bc=crease(b,c),ca=crease(c,a),mask=(ab<0?0:1)+(bc<0?0:2)+(ca<0?0:4);
  corner[0]=a;corner[1]=b;corner[2]=c;corner[3]=ab;corner[4]=bc;corner[5]=ca;
  for(const triangle of SPLITS[mask])outI.push(corner[triangle[0]],corner[triangle[1]],corner[triangle[2]]);
 }
 const positions=new Float32Array(outP),bounds=positions.length?[Infinity,Infinity,Infinity,-Infinity,-Infinity,-Infinity]:[0,0,0,0,0,0];
 for(let i=0;i<positions.length;i+=3){if(i%3072===0)yield;for(let axis=0;axis<3;axis++){bounds[axis]=Math.min(bounds[axis],positions[i+axis]);bounds[axis+3]=Math.max(bounds[axis+3],positions[i+axis]);}}
 let volume=0;for(let i=0;i<outI.length;i+=3){if(i%3072===0)yield;const p=positions,a=outI[i]*3,b=outI[i+1]*3,c=outI[i+2]*3;volume+=(p[a]*(p[b+1]*p[c+2]-p[b+2]*p[c+1])+p[a+1]*(p[b+2]*p[c]-p[b]*p[c+2])+p[a+2]*(p[b]*p[c+1]-p[b+1]*p[c]))/6;}
 return {...mesh,positions,normals:new Float32Array(outN),indices:new Uint32Array(outI),volume:Math.abs(volume),bounds,creases:stats,seams:{vertices:new Uint32Array(seamVertices),normals:new Float32Array(seamNormals)}};
}

/** Give every seam vertex a second copy, so each face around it shades with
 * the gradient of its own side. Positions are shared, so nothing opens; the
 * index graph is no longer welded along the seam, so this is display only. */
function* seamNormalSteps(mesh:CreaseMeshData):Generator<void,MeshData,void>{
 const {seams,...rest}=mesh;
 if(!seams?.vertices.length)return rest;
 const P=mesh.positions,I=mesh.indices,count=P.length/3,slot=new Int32Array(count).fill(-1);
 for(let i=0;i<seams.vertices.length;i++)slot[seams.vertices[i]]=i;
 const extraP:number[]=[],extraN:number[]=[],copy=new Int32Array(seams.vertices.length).fill(-1),indices=new Uint32Array(I);
 for(let f=0;f<I.length;f+=3){
  if(f%6144===0)yield;
  const a=I[f],b=I[f+1],c=I[f+2];
  if(slot[a]<0&&slot[b]<0&&slot[c]<0)continue;
  const ex=P[b*3]-P[a*3],ey=P[b*3+1]-P[a*3+1],ez=P[b*3+2]-P[a*3+2],fx=P[c*3]-P[a*3],fy=P[c*3+1]-P[a*3+1],fz=P[c*3+2]-P[a*3+2];
  const nx=ey*fz-ez*fy,ny=ez*fx-ex*fz,nz=ex*fy-ey*fx;
  for(let k=0;k<3;k++){
   const vertex=I[f+k],s=slot[vertex];if(s<0)continue;
   const n=seams.normals,dotA=nx*n[s*6]+ny*n[s*6+1]+nz*n[s*6+2],dotB=nx*n[s*6+3]+ny*n[s*6+4]+nz*n[s*6+5];
   if(dotA>=dotB)continue;
   if(copy[s]<0){copy[s]=count+extraP.length/3;extraP.push(P[vertex*3],P[vertex*3+1],P[vertex*3+2]);extraN.push(n[s*6+3],n[s*6+4],n[s*6+5]);}
   indices[f+k]=copy[s];
  }
 }
 if(!extraP.length)return rest;
 const positions=new Float32Array(P.length+extraP.length),normals=new Float32Array(P.length+extraP.length);
 positions.set(P);positions.set(extraP,P.length);normals.set(mesh.normals);normals.set(extraN,P.length);
 for(let i=0;i<seams.vertices.length;i++){const v=seams.vertices[i];normals[v*3]=seams.normals[i*6];normals[v*3+1]=seams.normals[i*6+1];normals[v*3+2]=seams.normals[i*6+2];}
 return {...rest,positions,normals,indices};
}

export function sharpenCreases(mesh:MeshData,field:SurfaceField,options:CreaseOptions={}):CreaseMeshData{
 const steps=creaseSteps(mesh,field,options);let step=steps.next();while(!step.done)step=steps.next();return step.value;
}
export function sharpenCreasesAsync(mesh:MeshData,field:SurfaceField,options:CreaseOptions={},taskOptions:CooperativeTaskOptions={}):Promise<CreaseMeshData>{
 return drainSteps(creaseSteps(mesh,field,options),taskOptions);
}
export function splitSeamNormals(mesh:CreaseMeshData):MeshData{
 const steps=seamNormalSteps(mesh);let step=steps.next();while(!step.done)step=steps.next();return step.value;
}
export function splitSeamNormalsAsync(mesh:CreaseMeshData,taskOptions:CooperativeTaskOptions={}):Promise<MeshData>{
 return drainSteps(seamNormalSteps(mesh),taskOptions);
}
/** Seam vertices refinement must not move: their edges keep the exact seam. */
export function seamLock(mesh:CreaseMeshData):Uint8Array|undefined{
 if(!mesh.seams?.vertices.length)return;
 const lock=new Uint8Array(mesh.positions.length/3);for(const v of mesh.seams.vertices)lock[v]=1;return lock;
}
