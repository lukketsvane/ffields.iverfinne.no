import {cloneModel, validateModel} from './form-engine.ts';
import type {FormModel} from './form-engine.ts';

/** Keep the mass document and copy fields without colliding with any object ID. */
export function mixModelFields(mass:FormModel,fields:FormModel):FormModel {
 const mixed=cloneModel(mass),copied=cloneModel(fields).influences;
 const used=new Set(['body','regions','enclosure','canvas','lattice',...(mixed.shapes??[]).map(s=>s.id),...(mixed.assets??[]).map(a=>a.id),...(mixed.lattice?.region?[mixed.lattice.region.id]:[])]);
 // A renamed field must not take the original ID of another copied field.
 const reserved=new Set([...used,...copied.map(f=>f.id)]);
 mixed.influences=copied.map(field=>{
  let id=field.id;
  if(used.has(id)){
   let suffix=1;
   do{const tail='-mix-'+suffix++;id=field.id.slice(0,100-tail.length)+tail}while(reserved.has(id));
  }
  used.add(id);reserved.add(id);
  return {...field,id};
 });
 return validateModel(mixed);
}
