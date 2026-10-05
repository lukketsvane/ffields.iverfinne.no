import {binarySTLAsync,generateMeshAsync,validateModel} from './form-engine.ts';
import type {FormModel} from './form-engine.ts';
import {auditExportMeshAsync} from './component-fit.ts';
import type {ExportMeshAudit} from './component-fit.ts';
import type {MeshRefinementStats} from './mesh-refinement.ts';
import type {MeshSamplingStats} from './mesh-sampling.ts';
import {throwIfAborted} from './cooperative-task.ts';
import type {CooperativeTaskOptions} from './cooperative-task.ts';

export type ExportMeshTask='audit'|'stl';
export type ExportMeshCheck=ExportMeshAudit&{refinement?:MeshRefinementStats;sampling?:MeshSamplingStats;milliseconds:number};
export type ExportMeshResult={stl?:ArrayBuffer;check:ExportMeshCheck};
type MeshWorker=Pick<Worker,'postMessage'|'terminate'|'onmessage'|'onerror'>;
/** Worker injection is for platform adapters/tests; it adds no user setting. */
export type ExportMeshJobOptions=CooperativeTaskOptions&{createWorker?:(()=>MeshWorker)|null};

/** Authoritative 220-cell export check. A blocked or failed worker falls back
 * through the same full-resolution mesher, refinement and captured-mesh audit;
 * input remains deliverable and cancellation remains live in every phase. */
export function runExportMeshJob(model:FormModel,refined:boolean,task:ExportMeshTask,holdAbort:(abort:(()=>void)|null)=>void,options:ExportMeshJobOptions={}):Promise<ExportMeshResult>{
 const controller=new AbortController(),started=performance.now(),refinement=refined?{tolerance:.12,maxPasses:2,maxTriangles:900000}:undefined;
 let worker:MeshWorker|undefined,settled=false,fallbackStarted=false;
 const forwardAbort=()=>controller.abort();options.signal?.addEventListener('abort',forwardAbort,{once:true});
 return new Promise((resolve,reject)=>{
  const cleanup=()=>{worker?.terminate();worker=undefined;options.signal?.removeEventListener('abort',forwardAbort);controller.signal.removeEventListener('abort',cancel);holdAbort(null);};
  const complete=(result?:ExportMeshResult,error?:unknown)=>{
   if(settled)return;settled=true;cleanup();if(error!==undefined)reject(error);else resolve(result!);
  };
  const cancel=()=>complete(undefined,new DOMException('Mesh check cancelled.','AbortError'));
  controller.signal.addEventListener('abort',cancel,{once:true});holdAbort(()=>controller.abort());
  if(options.signal?.aborted)controller.abort();if(settled)return;
  // A stable captured document is shared by worker and fallback. Preview
  // shortcuts and draft edge roots are never passed into this path.
  let snapshot:FormModel;
  try{snapshot=validateModel(model)}catch(error){complete(undefined,error);return;}
  const fallback=()=>{
   if(settled||fallbackStarted)return;fallbackStarted=true;worker?.terminate();worker=undefined;
   const work={...options,signal:controller.signal,draft:false};
   void (async()=>{
    const mesh=await generateMeshAsync(snapshot,220,refinement,undefined,work);
    const {audit,componentFit}=await auditExportMeshAsync(snapshot,mesh,work);
    const stl=task==='stl'?await binarySTLAsync(mesh,work):undefined;
    throwIfAborted(controller.signal);
    return {check:{audit,componentFit,refinement:mesh.refinement,sampling:mesh.sampling,milliseconds:performance.now()-started},...(stl?{stl}:{})};
   })().then(result=>complete(result),error=>complete(undefined,error));
  };
  try{
   if(options.createWorker===null){fallback();return;}
   worker=options.createWorker?options.createWorker():new Worker(new URL('./form-worker.ts',import.meta.url),{type:'module'});
   const active=worker;
   active.onmessage=event=>{
    if(settled||worker!==active)return;
    // An explicit mesh/validation error is an authoritative rejection, not a
    // reason to retry a malformed document on the main thread.
    if(event.data.error){complete(undefined,Error(event.data.error));return;}
    complete({stl:event.data.stl,check:event.data.check});
   };
   active.onerror=()=>{if(worker===active)fallback();};
   active.postMessage({id:1,task,model:snapshot,resolution:220,refinement});
  }catch{fallback();}
 });
}
