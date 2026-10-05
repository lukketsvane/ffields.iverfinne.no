import {generateMesh,binarySTL,validateModel} from './form-engine';
import {auditExportMesh} from './component-fit';

self.onmessage=(event)=>{
 try{
  const started=performance.now();
  const model=validateModel(event.data.model),mesh=generateMesh(model,event.data.resolution,event.data.refinement);
  if(event.data.task==='stl'||event.data.task==='audit'){
   const {audit,componentFit}=auditExportMesh(model,mesh);
   const check={audit,componentFit,refinement:mesh.refinement,sampling:mesh.sampling,milliseconds:performance.now()-started};
   if(event.data.task==='audit'){self.postMessage({id:event.data.id,check});return}
   const stl=binarySTL(mesh);self.postMessage({id:event.data.id,stl,check},{transfer:[stl]});return;
  }
  self.postMessage({id:event.data.id,mesh},{transfer:[mesh.positions.buffer,mesh.normals.buffer,mesh.indices.buffer]});
 }catch(error){self.postMessage({id:event.data.id,error:String(error)})}
};
