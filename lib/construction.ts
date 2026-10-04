import {cloneModel, DEFAULT_MODEL, validateModel} from './form-engine.ts';
import type {FormModel} from './form-engine.ts';
import {makeShape, mirrorShape, MAX_SHAPES} from './shapes.ts';
import type {FormShape, ShapeKind} from './shapes.ts';

/** The same small, undoable actions are available to people and browser agents. */
export type ConstructionCommand =
 | {action:'start';name?:string}
 | {action:'add';shape:Partial<FormShape>&{kind:ShapeKind}}
 | {action:'update';id:string;patch:Partial<Omit<FormShape,'id'|'kind'>>}
 | {action:'mirror';id:string;axis:'x'|'y'|'z';newId?:string;name?:string}
 | {action:'remove';id:string}
 | {action:'move';id:string;index:number};

export function blankConstruction(name='Untitled construction'):FormModel {
 return {...cloneModel(DEFAULT_MODEL),name,baseEnabled:false,asymmetry:0,influences:[],shapes:[]};
}

const fields=new Set(['id','name','kind','enabled','operation','blend','x','y','z','rx','ry','rz','width','height','depth','roundness','path','depthRatio']);
function record(input:unknown,label:string):Record<string,unknown>{
 if(!input||typeof input!=='object'||Array.isArray(input))throw Error('Expected '+label+'.');
 return input as Record<string,unknown>;
}
function keys(input:Record<string,unknown>,allowed:string[]){
 if(Object.keys(input).some(key=>!allowed.includes(key)))throw Error('Unknown construction parameter.');
}
function shapePatch(input:unknown,allowIdentity:boolean){
 const p=record(input,'shape parameters');
 if(Object.keys(p).some(key=>!fields.has(key)||(!allowIdentity&&(key==='id'||key==='kind'))))throw Error('Unknown or immutable shape parameter.');
 return p;
}

/** Pure and atomic: malformed commands never change the document or its IDs. */
export function applyConstructionCommand(model:FormModel,input:unknown):FormModel {
 const c=record(input,'a construction command'),next=cloneModel(model);
 if(c.action==='start'){
  keys(c,['action','name']);
  if(c.name!==undefined&&(typeof c.name!=='string'||!c.name.trim()))throw Error('Provide a construction name.');
  return validateModel(blankConstruction(c.name as string|undefined));
 }
 const shapes=next.shapes??[];
 if(c.action==='add'){
  keys(c,['action','shape']);const p=shapePatch(c.shape,true);
  if(!['sphere','box','capsule','cylinder','torus','sweep'].includes(p.kind as string))throw Error('Choose a valid shape kind.');
  if(shapes.length>=MAX_SHAPES)throw Error('This study can contain up to '+MAX_SHAPES+' shapes.');
  next.shapes=[...shapes,{...makeShape(p.kind as ShapeKind),...p} as FormShape];
 }else{
  if(typeof c.id!=='string')throw Error('Provide a shape id.');
  const index=shapes.findIndex(s=>s.id===c.id);if(index<0)throw Error('Shape not found: '+c.id+'.');
  switch(c.action){
   case 'update':keys(c,['action','id','patch']);shapes[index]={...shapes[index],...shapePatch(c.patch,false)} as FormShape;break;
   case 'mirror':{
    keys(c,['action','id','axis','newId','name']);
    if(!['x','y','z'].includes(c.axis as string))throw Error('Choose a mirror axis.');
    if(shapes.length>=MAX_SHAPES)throw Error('This study can contain up to '+MAX_SHAPES+' shapes.');
    const copy=mirrorShape(shapes[index],c.axis as 'x'|'y'|'z');
    if(c.newId!==undefined)copy.id=c.newId as string;
    if(c.name!==undefined)copy.name=c.name as string;
    shapes.splice(index+1,0,copy);break;
   }
   case 'remove':keys(c,['action','id']);shapes.splice(index,1);break;
   case 'move':{
    keys(c,['action','id','index']);
    if(!Number.isInteger(c.index)||(c.index as number)<0||(c.index as number)>=shapes.length)throw Error('Choose an existing construction position.');
    const [shape]=shapes.splice(index,1);shapes.splice(c.index as number,0,shape);break;
   }
   default:throw Error('Unknown construction action.');
  }
  next.shapes=shapes;
 }
 return validateModel(next);
}
