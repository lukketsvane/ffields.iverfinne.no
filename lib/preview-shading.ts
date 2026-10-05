import {compileModelField,clamp} from './form-engine.ts';
import type {FormModel,MeshData,AsyncMeshOptions} from './form-engine.ts';

/** Display shading follows the existing three field probes per vertex. It
 * changes no geometry, fitted envelope, volume or export vertex buffer. */
export async function previewAmbientOcclusion(model:FormModel,mesh:Pick<MeshData,'positions'|'normals'>,options:AsyncMeshOptions={}):Promise<Float32Array>{
 // Probe the same undeformed base field as before. Ripples are displaced in
 // the viewport shader; compiling their inverse here would change the shade.
 const field=compileModelField({...model,influences:model.influences.filter(influence=>influence.kind!=='wave')}),ao=new Float32Array(mesh.positions.length/3),positions=mesh.positions,normals=mesh.normals;
 const now=options.now??(()=>performance.now()),yieldControl=options.yieldControl??(()=>new Promise<void>(resolve=>setTimeout(resolve,0))),budget=options.budgetMs??8;
 if(!Number.isFinite(budget)||budget<=0)throw Error('Shading work budget must be positive and finite.');
 const check=()=>{if(options.signal?.aborted)throw new DOMException('Preview shading was superseded.','AbortError');};
 check();let started=now();
 for(let i=0;i<ao.length;i++){
  if(i%64===0){check();if(now()-started>=budget){await yieldControl();check();started=now();}}
  const p=i*3,x=positions[p],y=positions[p+1],z=positions[p+2];let occlusion=0;
  for(const distance of [2,5,10])occlusion+=Math.max(0,1-field(x+normals[p]*distance,y+normals[p+1]*distance,z+normals[p+2]*distance)/distance);
  ao[i]=1-clamp(occlusion*.1,0,.2);
 }
 check();return ao;
}
