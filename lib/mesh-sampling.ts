import type {FormModel} from './form-engine.ts';
import {shapeBounds} from './shapes.ts';

export type MeshSamplingOptions={featurePlanes?:boolean;gridPhase?:[number,number,number];facePlaneOffset?:.002|.02};
export type MeshSamplingStats={
 resolution:number;cells:[number,number,number];nominalSpacing:[number,number,number];
 /** Largest interval on each sampling axis; this is not a surface tolerance. */
 maxSpacing:[number,number,number];addedPlanes:[number,number,number];
 featureAligned:boolean;budgetLimited:boolean;
 /** Separation from an authored face for each paired sampling plane. */
 facePlaneOffset?:number;
 quantizationLimited?:boolean;
 /** Deterministic fractions of an ordinary interval used on a guarded retry. */
 gridPhase?:[number,number,number];
 skippedReason?:'disabled'|'deformed'|'shell'|'lattice'|'no eligible faces'|'quantization';
};
export type MeshSamplingGrid={coordinates:[number[],number[],number[]];sampling:MeshSamplingStats};

const MIN_PLANE_GAP=.00025,MAX_ADDED_PLANES=24,MAX_SAMPLE_GROWTH=1.75;

/** A bounded nonuniform sampling grid around eligible authored box faces.
 * Paired planes straddle a face rather than putting it on a grid node: an exact
 * zero there can collapse distinct edge roots onto one Float32 coordinate.
 * The planes improve detected sharp rims; they cannot certify fit, detect every
 * small feature or make the largest ordinary grid interval a surface tolerance.
 */
export function createMeshSamplingGrid(model:FormModel,bounds:readonly number[],resolution=52,options:MeshSamplingOptions={}):MeshSamplingGrid{
 if(bounds.length!==6||bounds.some(v=>!Number.isFinite(v))||[0,1,2].some(a=>bounds[a+3]<=bounds[a]))throw Error('Mesh sampling needs finite, increasing bounds.');
 if(!Number.isFinite(resolution))throw Error('Mesh sampling needs a finite resolution.');
 if(options.featurePlanes!==undefined&&typeof options.featurePlanes!=='boolean')throw Error('Feature planes must be enabled or disabled.');
 if(options.facePlaneOffset!==undefined&&options.facePlaneOffset!==.002&&options.facePlaneOffset!==.02)throw Error('Face-plane offset must be 0.002 or 0.02 mm.');
 if(options.gridPhase!==undefined&&(!Array.isArray(options.gridPhase)||options.gridPhase.length!==3||options.gridPhase.some(v=>!Number.isFinite(v)||v<0||v>.45)))throw Error('Mesh grid phase must contain three fractions between 0 and 0.45.');
 // The wider bracket is reserved for a bounded quantization retry. It changes
 // sampling cells, not the authored surface or tested component clearance.
 const FACE_OFFSET=options.facePlaneOffset??.002;
 const extent=[0,1,2].map(a=>bounds[a+3]-bounds[a]),longest=Math.max(...extent),cells=Math.max(12,Math.min(220,Math.round(resolution)));
 const baseline=extent.map(v=>Math.max(20,Math.round(cells*v/longest))),nominalSpacing=extent.map((v,a)=>v/baseline[a]) as [number,number,number];
 const coordinates=baseline.map((n,a)=>Array.from({length:n+1},(_,i)=>bounds[a]+(i+(i>0&&i<n?(options.gridPhase?.[a]??0):0))*nominalSpacing[a])) as [number[],number[],number[]];
 const baselineSamples=coordinates.reduce((product,axis)=>product*axis.length,1),sampleBudget=Math.floor(baselineSamples*MAX_SAMPLE_GROWTH);
 let skippedReason:MeshSamplingStats['skippedReason'];
 if(options.featurePlanes===false)skippedReason='disabled';
 else if(model.asymmetry!==0||model.influences.some(f=>f.enabled&&f.strength!==0))skippedReason='deformed';
 else if(model.shell)skippedReason='shell';
 else if(model.lattice?.enabled)skippedReason='lattice';
 const faceLevels:[number[],number[],number[]]=[[],[],[]];
 if(!skippedReason){
  const unions=(model.shapes??[]).filter(s=>s.enabled&&s.operation==='union');
  // A through-cut's distant caps do not intersect an unblended mass. Avoid
  // spending the finite grid budget on those empty planes. Blending or lens
  // seats can grow beyond primitive boxes, so keep all planes in those cases.
  let massBounds:number[]|undefined;
  if(!model.lenses&&unions.every(s=>s.blend===0)){
   massBounds=model.baseEnabled===false?[Infinity,Infinity,Infinity,-Infinity,-Infinity,-Infinity]:[-model.width/2,-model.height/2,-model.depth/2,model.width/2,model.height/2,model.depth/2];
   for(const shape of unions){const b=shapeBounds(shape);for(let a=0;a<3;a++){massBounds[a]=Math.min(massBounds[a],b[a]);massBounds[a+3]=Math.max(massBounds[a+3],b[a+3]);}}
  }
  // Cut faces define component seats, so reserve the finite plane budget for
  // those before outside masses. Blended or rotated boxes keep ordinary grid
  // sampling; their stored bounding faces need not be their actual surfaces.
  const eligible=(model.shapes??[]).filter(s=>s.enabled&&s.kind==='box'&&s.blend===0&&s.roundness===0&&s.rx===0&&s.ry===0&&s.rz===0).sort((a,b)=>Number(b.operation==='subtract')-Number(a.operation==='subtract'));
  const shapes=model.shapes??[],firstCut=shapes.findIndex(s=>s.enabled&&s.operation==='subtract'),cutsRemainFinal=firstCut>=0&&!shapes.slice(firstCut).some(s=>s.enabled&&s.operation==='union');
  const unionBounds=unions.map(shape=>({shape,index:shapes.indexOf(shape),bounds:shapeBounds(shape)}));
  for(const shape of eligible)for(let a=0;a<3;a++){
   const centre=[shape.x,shape.y,shape.z][a],half=[shape.width,shape.height,shape.depth][a]/2;
   for(const face of [centre-half,centre+half]){
    if(shape.operation==='subtract'&&massBounds&&(face<massBounds[a]-FACE_OFFSET||face>massBounds[a+3]+FACE_OFFSET))continue;
    // An overlapping insertion/front corridor can cover a pocket's complete
    // end face. That internal cap is not a remaining CSG boundary. Avoid its
    // unnecessary tiny cells near curved ribs. A later hard union can restore
    // a covered cap only where its conservative world bounds reach that cap;
    // blends and post-CSG lens seats retain the original conservative guard.
    if(shape.operation==='subtract'&&eligible.some(other=>{
     if(other===shape||other.operation!=='subtract')return false;
     const otherCentre=[other.x,other.y,other.z],otherHalf=[other.width,other.height,other.depth].map(v=>v/2),ownCentre=[shape.x,shape.y,shape.z],ownHalf=[shape.width,shape.height,shape.depth].map(v=>v/2);
     const covered=face>otherCentre[a]-otherHalf[a]+FACE_OFFSET&&face<otherCentre[a]+otherHalf[a]-FACE_OFFSET&&[0,1,2].every(axis=>axis===a||(otherCentre[axis]-otherHalf[axis]<=ownCentre[axis]-ownHalf[axis]+1e-9&&otherCentre[axis]+otherHalf[axis]>=ownCentre[axis]+ownHalf[axis]-1e-9));
     if(!covered||model.lenses)return false;if(cutsRemainFinal)return true;
     const coveringIndex=shapes.indexOf(other),capBounds=[...ownCentre.map((v,axis)=>(axis===a?face:v-ownHalf[axis])-FACE_OFFSET),...ownCentre.map((v,axis)=>(axis===a?face:v+ownHalf[axis])+FACE_OFFSET)];
     // Check every union AFTER the covering cut, including unions between the
     // two cuts. Otherwise an intermediate union could recreate a real cap.
     return unionBounds.every(({shape:union,index,bounds})=>index<=coveringIndex||(union.blend===0&&[0,1,2].some(axis=>bounds[axis+3]<capBounds[axis]||bounds[axis]>capBounds[axis+3])));
    }))continue;
    if(face-FACE_OFFSET>bounds[a]&&face+FACE_OFFSET<bounds[a+3]&&!faceLevels[a].some(v=>Math.abs(v-face)<MIN_PLANE_GAP))faceLevels[a].push(face);
   }
  }
  if(faceLevels.every(axis=>!axis.length))skippedReason='no eligible faces';
 }
 let acceptedFaces=0,budgetLimited=false;
 // Round-robin axes prevent one direction consuming the entire sample budget.
 const groups=Math.max(...faceLevels.map(axis=>axis.length));
 for(let group=0;group<groups;group++)for(let a=0;a<3;a++){
  const face=faceLevels[a][group];if(face===undefined)continue;
  const proposed=coordinates[a].filter(v=>Math.abs(v-face)>FACE_OFFSET*.9);
  for(const value of [face-FACE_OFFSET,face+FACE_OFFSET])if(!proposed.some(v=>Math.abs(v-value)<MIN_PLANE_GAP))proposed.push(value);
  proposed.sort((x,y)=>x-y);
  const added=proposed.length-(baseline[a]+1),samples=coordinates.reduce((product,axis,i)=>product*(i===a?proposed.length:axis.length),1);
  if(added>MAX_ADDED_PLANES||samples>sampleBudget){budgetLimited=true;continue;}
  coordinates[a]=proposed;acceptedFaces++;
 }
 const sampling:MeshSamplingStats={resolution:cells,cells:coordinates.map(axis=>axis.length-1) as [number,number,number],nominalSpacing,
  maxSpacing:coordinates.map(axis=>axis.slice(1).reduce((largest,value,i)=>Math.max(largest,value-axis[i]),0)) as [number,number,number],
  addedPlanes:coordinates.map((axis,a)=>Math.max(0,axis.length-baseline[a]-1)) as [number,number,number],featureAligned:acceptedFaces>0,budgetLimited,...(acceptedFaces?{facePlaneOffset:FACE_OFFSET}:{}),...(skippedReason?{skippedReason}:{}),...(options.gridPhase?{gridPhase:[...options.gridPhase]}:{})};
 return {coordinates,sampling};
}
