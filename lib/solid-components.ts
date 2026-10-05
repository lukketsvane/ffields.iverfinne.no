import type {FormModel,MeshData} from './form-engine.ts';
import {resolveAttachments} from './attachments.ts';

export type SolidComponent={id:string;name:string;model:FormModel;shapeIds:string[]};
export function hasSolidComponents(model:FormModel){return model.shapes?.some(shape=>shape.componentId!==undefined)??false;}
/** Ownership scopes Boolean operations. Component models deliberately contain no
 * ownership tags; meshing and refinement run against each solid's own field. */
export function solidComponents(input:FormModel):SolidComponent[]{
 const model=resolveAttachments(input),shapes=model.shapes??[],ids=[...new Set(shapes.flatMap(shape=>shape.componentId?[shape.componentId]:[]))];
 const parts:SolidComponent[]=[];
 for(const id of ['body',...ids]){
  const members=shapes.filter(shape=>id==='body'?!shape.componentId:shape.componentId===id);
  if(id==='body'&&model.baseEnabled===false&&!members.some(shape=>shape.enabled&&shape.operation==='union'))continue;
  const name=id==='body'?'Body':members.find(shape=>shape.id===id)?.name??'Component';
  const {assets,attachments,componentClearances,...geometry}=model;void assets;void attachments;void componentClearances;
  const part:FormModel={...geometry,name,shapes:members.map(shape=>{const {componentId,...rest}=shape;void componentId;return rest;})};
  if(id!=='body')Object.assign(part,{baseEnabled:false,lenses:false,protect:false,shell:false,usb:false,buttons:false,fingerGrooves:false,lattice:undefined});
  parts.push({id,name,model:part,shapeIds:members.map(shape=>shape.id)});
 }
 return parts;
}
/** Concatenate buffers without welding vertices, including touching/overlapping
 * solids. Triangle ranges keep component identity through worker transfers. */
export function combineComponentMeshes(parts:SolidComponent[],meshes:MeshData[]):MeshData{
 const positions=new Float32Array(meshes.reduce((n,m)=>n+m.positions.length,0)),normals=new Float32Array(positions.length),indices=new Uint32Array(meshes.reduce((n,m)=>n+m.indices.length,0));
 const bounds=[Infinity,Infinity,Infinity,-Infinity,-Infinity,-Infinity],components:NonNullable<MeshData['components']>=[];let vertexOffset=0,indexOffset=0,volume=0;
 meshes.forEach((mesh,i)=>{positions.set(mesh.positions,vertexOffset*3);normals.set(mesh.normals,vertexOffset*3);for(let j=0;j<mesh.indices.length;j++)indices[indexOffset+j]=mesh.indices[j]+vertexOffset;
  components.push({id:parts[i].id,name:parts[i].name,startTriangle:indexOffset/3,triangleCount:mesh.indices.length/3,sampling:mesh.sampling,refinement:mesh.refinement});
  if(mesh.positions.length)for(let axis=0;axis<3;axis++){bounds[axis]=Math.min(bounds[axis],mesh.bounds[axis]);bounds[axis+3]=Math.max(bounds[axis+3],mesh.bounds[axis+3]);}
  vertexOffset+=mesh.positions.length/3;indexOffset+=mesh.indices.length;volume+=mesh.volume;
 });
 return {positions,normals,indices,volume,bounds:positions.length?bounds:[0,0,0,0,0,0],components};
}
