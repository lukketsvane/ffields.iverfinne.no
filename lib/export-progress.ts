import {generateMesh,generateMeshAsync,evaluate,evaluateBase} from './form-engine.ts';
import type {FormModel,MeshData} from './form-engine.ts';
import {resolveAttachments} from './attachments.ts';
import {compileShape} from './shapes.ts';
import {refineMeshSurface,refineMeshSurfaceAsync} from './mesh-refinement.ts';
import type {MeshRefinementOptions} from './mesh-refinement.ts';
import {throwIfAborted} from './cooperative-task.ts';
import type {CooperativeTaskOptions} from './cooperative-task.ts';

export type ExportMeshStage='generating'|'refining'|'checking'|'writing';
/** Stage changes describe real work boundaries. Counters are optional and must
 * only be supplied by a phase that measures its own completed work. */
export type ExportMeshProgress={stage:ExportMeshStage;completed?:number;total?:number};
export type ExportProgressOptions=CooperativeTaskOptions&{onProgress?:(progress:ExportMeshProgress)=>void};

const STAGE_LABELS:Record<ExportMeshStage,string>={generating:'Generating surface',refining:'Refining surface',checking:'Checking mesh and component fit',writing:'Preparing STL'};
export const exportMeshStageLabel=(stage:ExportMeshStage):string=>STAGE_LABELS[stage];

/** Worker messages are independent of final mesh results; reject malformed
 * progress instead of accidentally treating it as a completed export. */
export function isExportMeshProgress(value:unknown):value is ExportMeshProgress{
 if(!value||typeof value!=='object')return false;
 const {stage,completed,total}=value as Partial<ExportMeshProgress>;
 if(typeof stage!=='string'||!Object.hasOwn(STAGE_LABELS,stage))return false;
 if(completed!==undefined&&(!Number.isInteger(completed)||completed<0))return false;
 if(total!==undefined&&(!Number.isInteger(total)||total<=0))return false;
 return completed===undefined||total===undefined||completed<=total;
}

function refinementField(model:FormModel){
 const resolved=resolveAttachments(model),compiled=(resolved.shapes??[]).map(shape=>shape.enabled?compileShape(shape):()=>Infinity);
 return resolved.influences.some(influence=>influence.kind==='wave'&&influence.enabled)?(x:number,y:number,z:number)=>evaluate(resolved,x,y,z):(x:number,y:number,z:number)=>evaluateBase(resolved,x,y,z,compiled);
}

/** Export-only boundary reporting leaves the viewport meshing API unchanged.
 * Sampling, root solving and refinement use the authoritative algorithms. */
export function generateExportMesh(model:FormModel,resolution:number,refinement:MeshRefinementOptions|undefined,onProgress?:(progress:ExportMeshProgress)=>void):MeshData{
 onProgress?.({stage:'generating'});
 const mesh=generateMesh(model,resolution);
 if(!refinement)return mesh;
 onProgress?.({stage:'refining'});
 return {...refineMeshSurface(mesh,refinementField(model),refinement),sampling:mesh.sampling};
}

export async function generateExportMeshAsync(model:FormModel,resolution:number,refinement:MeshRefinementOptions|undefined,options:ExportProgressOptions={}):Promise<MeshData>{
 throwIfAborted(options.signal);options.onProgress?.({stage:'generating'});
 const mesh=await generateMeshAsync(model,resolution,undefined,undefined,{...options,draft:false});
 if(!refinement)return mesh;
 throwIfAborted(options.signal);options.onProgress?.({stage:'refining'});
 return {...await refineMeshSurfaceAsync(mesh,refinementField(model),refinement,options),sampling:mesh.sampling};
}
