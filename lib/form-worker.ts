import {generateMeshAsync,binarySTL,validateModel} from './form-engine';
import {auditExportMesh} from './component-fit';
import {previewAmbientOcclusion} from './preview-shading';
import {generateExportMesh} from './export-progress';
import {previewRefinement} from './preview-scheduler';
import type {ExportMeshProgress} from './export-progress';

const previews=new Map<number,AbortController>();
self.onmessage=async(event)=>{
 const data=event.data;
 // Preview work actually yields so newer messages can stop both evaluation
 // and display shading. Authoritative export/audit is its separate path.
 if(typeof data.cancel==='number'){previews.get(data.cancel)?.abort();return}
 const id=data.id,started=performance.now();let controller:AbortController|undefined;
 try{
  const model=validateModel(data.model);
  if(data.task==='stl'||data.task==='audit'){
   const progress=(value:ExportMeshProgress)=>self.postMessage({id,progress:value});
   const mesh=generateExportMesh(model,data.resolution,data.refinement,progress);
   progress({stage:'checking'});
   const {audit,componentFit}=auditExportMesh(model,mesh);
   const check={audit,componentFit,refinement:mesh.refinement,sampling:mesh.sampling,components:mesh.components,milliseconds:performance.now()-started};
   if(data.task==='audit'){self.postMessage({id,check});return}
   progress({stage:'writing'});
   const stl=binarySTL(mesh);self.postMessage({id,stl,check},{transfer:[stl]});return;
  }
  controller=new AbortController();previews.get(id)?.abort();previews.set(id,controller);
  // Previews resolve hard CSG seams; exports above keep their welded meshes.
  const options={signal:controller.signal,budgetMs:8,draft:data.draft===true,previewDetail:data.previewDetail===true,creases:true,...(data.streamSurface&&!data.draft?{onSurface:(mesh:import('./form-engine').MeshData)=>{
   // Clone this intermediate frame: refinement still owns these buffers.
   // The final result alone transfers ownership and releases the queue.
   if(!controller?.signal.aborted)self.postMessage({id,mesh,stage:'surface'});
  }}:{})};
  const mesh=await generateMeshAsync(model,data.resolution,previewRefinement(options.draft,data.pixelsPerUnit),undefined,options);
  const ao=data.shading&&!data.draft?await previewAmbientOcclusion(model,mesh,options):undefined;
  if(controller.signal.aborted){self.postMessage({id,aborted:true});return}
  self.postMessage({id,mesh,...(ao?{ao}:{}),milliseconds:performance.now()-started},{transfer:[mesh.positions.buffer,mesh.normals.buffer,mesh.indices.buffer,...(ao?[ao.buffer]:[])]});
 }catch(error){
  if(controller?.signal.aborted||(error instanceof DOMException&&error.name==='AbortError'))self.postMessage({id,aborted:true});
  else self.postMessage({id,error:String(error)});
 }finally{if(controller&&previews.get(id)===controller)previews.delete(id);}
};
