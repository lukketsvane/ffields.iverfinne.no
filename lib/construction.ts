import {cloneModel, DEFAULT_MODEL, validateModel} from './form-engine.ts';
import type {FormModel} from './form-engine.ts';
import {makeShape, mirrorShape, MAX_SHAPES} from './shapes.ts';
import type {FormShape, ShapeKind} from './shapes.ts';
import {attachmentForEndpoint,reconcileAttachments} from './attachments.ts';
import type {AttachmentAnchor,AttachmentOffset,SweepEndpoint} from './attachments.ts';
import {orientShapeToward,shapeAxisDirection} from './orientation.ts';
import {transformShapeGroup} from './group-transform.ts';
import type {GroupTransform} from './group-transform.ts';
import {deriveComponentClearance,reconcileComponentClearances} from './component-clearance.ts';
import type {ComponentClearanceCommand} from './component-clearance.ts';
import type {PlacedAsset} from './assets.ts';

export type ComponentPatch=Omit<Partial<Omit<PlacedAsset,'id'|'sourceId'>>,'envelope'>&{envelope?:[number,number,number]|null};

/** The same small, undoable actions are available to people and browser agents. */
export type ConstructionCommand =
 | {action:'start';name?:string}
 | {action:'add';shape:Partial<FormShape>&{kind:ShapeKind}}
 | {action:'update';id:string;patch:Partial<Omit<FormShape,'id'|'kind'>>}
 | {action:'mirror';id:string;axis:'x'|'y'|'z';newId?:string;name?:string}
 | {action:'attach';sweepId:string;endpoint:SweepEndpoint;targetShapeId:string;anchor:AttachmentAnchor;offset?:AttachmentOffset}
 | {action:'detach';sweepId:string;endpoint:SweepEndpoint}
 | {action:'duplicate-solid';id:string;newId:string}
 | {action:'separate-solid';ids:string[]}
 | {action:'assign-solid';ids:string[];componentId:string}
 | {action:'remove';id:string}
 | {action:'move';id:string;index:number}
 | {action:'add-component';asset:PlacedAsset}
 | {action:'update-component';id:string;patch:ComponentPatch}
 | {action:'remove-component';id:string}
 | ComponentClearanceCommand
 | ({action:'transform'}&GroupTransform);

export function blankConstruction(name='Untitled construction'):FormModel {
 return {...cloneModel(DEFAULT_MODEL),name,baseEnabled:false,asymmetry:0,influences:[],shapes:[]};
}

const fields=new Set(['id','name','kind','enabled','operation','blend','x','y','z','rx','ry','rz','width','height','depth','roundness','path','depthRatio','sectionMode','sectionRoll','closed','componentId']);
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
 const c=record(input,'a construction command');
 if(c.action==='start'){
  keys(c,['action','name']);
  if(c.name!==undefined&&(typeof c.name!=='string'||!c.name.trim()))throw Error('Provide a construction name.');
  return validateModel(blankConstruction(c.name as string|undefined));
 }
 const previous=validateModel(model),next=cloneModel(previous);
 const shapes=next.shapes??[];
 if(c.action==='separate-solid'||c.action==='assign-solid'){
  keys(c,c.action==='separate-solid'?['action','ids']:['action','ids','componentId']);
  if(!Array.isArray(c.ids)||!c.ids.length||c.ids.some(id=>typeof id!=='string'||!shapes.some(shape=>shape.id===id))||new Set(c.ids).size!==c.ids.length)throw Error('Select existing shapes for the component.');
  const selectedIds=c.ids as string[],members=shapes.filter(shape=>selectedIds.includes(shape.id));
  const root=members[0];
  if(c.action==='separate-solid'&&root.operation!=='union')throw Error('A separate component starts with a Merge shape.');
  const target=c.action==='separate-solid'?root.id:c.componentId;
  if(typeof target!=='string'||(c.action==='assign-solid'&&target!=='body'&&!shapes.some(shape=>shape.id===target&&shape.componentId===target&&shape.operation==='union')))throw Error('Choose an existing solid component.');
  if(shapes.some(shape=>shape.componentId&&members.some(root=>root.id===shape.componentId)&&!selectedIds.includes(shape.id)))throw Error('Include every shape of the existing component.');
  for(const shape of members){if(target==='body')delete shape.componentId;else shape.componentId=target;}
  next.shapes=shapes;
 }else if(c.action==='add-component'){
  keys(c,['action','asset']);const asset=record(c.asset,'component parameters');keys(asset,['id','sourceId','name','visible','x','y','z','rx','ry','rz','scale','envelope']);
  next.assets=[...(next.assets??[]),asset as unknown as PlacedAsset];
 }else if(c.action==='update-component'||c.action==='remove-component'){
  keys(c,c.action==='update-component'?['action','id','patch']:['action','id']);if(typeof c.id!=='string')throw Error('Provide a component id.');
  const index=next.assets?.findIndex(asset=>asset.id===c.id)??-1;if(index<0)throw Error('Component not found: '+c.id+'.');
  if(c.action==='remove-component')next.assets!.splice(index,1);
  else {const patch=record(c.patch,'component parameters');keys(patch,['name','visible','x','y','z','rx','ry','rz','scale','envelope']);const {envelope,...rest}=patch;const asset={...next.assets![index],...rest} as PlacedAsset;if(Object.hasOwn(patch,'envelope')){if(envelope===null||envelope===undefined)delete asset.envelope;else asset.envelope=envelope as [number,number,number];}next.assets![index]=asset;}
 }else if(c.action==='component-clearance'){
  keys(c,['action','assetId','shapeId','clearance','opening']);const asset=next.assets?.find(asset=>asset.id===c.assetId);if(!asset)throw Error('Choose an existing component.');
  const {action,...linkInput}=c;void action;const link=linkInput as unknown as Omit<ComponentClearanceCommand,'action'>;
  const shape=shapes.find(shape=>shape.id===link.shapeId),oldLink=next.componentClearances?.find(existing=>existing.shapeId===link.shapeId);
  if(shape&&!oldLink)throw Error('Choose a new clearance shape id.');
  if(!shape){if(shapes.length>=MAX_SHAPES)throw Error('This study can contain up to '+MAX_SHAPES+' shapes.');next.shapes=[...shapes,deriveComponentClearance(asset,link)];}
  next.componentClearances=[...(next.componentClearances??[]).filter(existing=>existing.shapeId!==link.shapeId),link];
 }else if(c.action==='attach'){
  keys(c,['action','sweepId','endpoint','targetShapeId','anchor','offset']);
  const selection={sweepId:c.sweepId,endpoint:c.endpoint,targetShapeId:c.targetShapeId,anchor:c.anchor} as {sweepId:string;endpoint:SweepEndpoint;targetShapeId:string;anchor:AttachmentAnchor};
  const link=c.offset===undefined?attachmentForEndpoint(previous,selection):{...selection,offset:c.offset as AttachmentOffset};
  next.attachments=[...(next.attachments??[]).filter(existing=>existing.sweepId!==link.sweepId||existing.endpoint!==link.endpoint),link];
 }else if(c.action==='detach'){
  keys(c,['action','sweepId','endpoint']);
  if(typeof c.sweepId!=='string'||!['start','end'].includes(c.endpoint as string)||!shapes.some(shape=>shape.id===c.sweepId&&shape.kind==='sweep'&&!shape.closed))throw Error('Choose an existing open sweep endpoint.');
  next.attachments=(next.attachments??[]).filter(link=>link.sweepId!==c.sweepId||link.endpoint!==c.endpoint);
 }else if(c.action==='transform'){
  keys(c,['action','ids','translation','rotation','pivot']);
  const {action,...transform}=c;void action;
  next.shapes=transformShapeGroup(previous,transform).shapes;
 }else if(c.action==='add'){
  keys(c,['action','shape']);const p=shapePatch(c.shape,true);
  if(!['sphere','box','capsule','cylinder','torus','sweep'].includes(p.kind as string))throw Error('Choose a valid shape kind.');
  if(shapes.length>=MAX_SHAPES)throw Error('This study can contain up to '+MAX_SHAPES+' shapes.');
  const added={...makeShape(p.kind as ShapeKind),...p} as FormShape;next.shapes=[...shapes,added];
 }else{
  if(typeof c.id!=='string')throw Error('Provide a shape id.');
  const index=shapes.findIndex(s=>s.id===c.id);if(index<0)throw Error('Shape not found: '+c.id+'.');
  switch(c.action){
   case 'update':{
    keys(c,['action','id','patch']);const original=shapes[index],patch=shapePatch(c.patch,false),updated={...original,...patch} as FormShape;
    // Moving/rotating a component root is a rigid edit of its complete CSG tree.
    if(original.componentId===original.id){
     const oldAxes=(['x','y','z'] as const).map(axis=>shapeAxisDirection(original,axis)),newAxes=(['x','y','z'] as const).map(axis=>shapeAxisDirection(updated,axis));
     const turn=(v:{x:number;y:number;z:number})=>{const local=oldAxes.map(a=>a.x*v.x+a.y*v.y+a.z*v.z);return {x:newAxes.reduce((sum,a,i)=>sum+a.x*local[i],0),y:newAxes.reduce((sum,a,i)=>sum+a.y*local[i],0),z:newAxes.reduce((sum,a,i)=>sum+a.z*local[i],0)};};
     const rotates=original.rx!==updated.rx||original.ry!==updated.ry||original.rz!==updated.rz;
     for(let i=0;i<shapes.length;i++){const member=shapes[i];if(i===index||member.componentId!==original.id)continue;const position=turn({x:member.x-original.x,y:member.y-original.y,z:member.z-original.z});shapes[i]={...member,...(rotates?orientShapeToward(member,turn(shapeAxisDirection(member,'y')),'y',turn(shapeAxisDirection(member,'z'))):{}),x:updated.x+position.x,y:updated.y+position.y,z:updated.z+position.z};}
    }
    shapes[index]=updated;break;
   }
   case 'duplicate-solid':{
    keys(c,['action','id','newId']);const root=shapes[index];if(root.componentId!==root.id||typeof c.newId!=='string'||!c.newId.length)throw Error('Choose a solid component root and new id.');
    const members=shapes.filter(shape=>shape.componentId===root.id);if(shapes.length+members.length>MAX_SHAPES)throw Error('This study can contain up to '+MAX_SHAPES+' shapes.');
    const copies=members.map(member=>({...member,id:member.id===root.id?c.newId as string:makeShape(member.kind).id,componentId:c.newId as string,name:(member.name+' copy').slice(0,100),x:member.x+18}));
    shapes.splice(index+1,0,...copies);break;
   }
   case 'mirror':{
    keys(c,['action','id','axis','newId','name']);
    if(!['x','y','z'].includes(c.axis as string))throw Error('Choose a mirror axis.');
    if(shapes.length>=MAX_SHAPES)throw Error('This study can contain up to '+MAX_SHAPES+' shapes.');
    const copy=mirrorShape(shapes[index],c.axis as 'x'|'y'|'z');
    if(c.newId!==undefined)copy.id=c.newId as string;
    if(c.name!==undefined)copy.name=c.name as string;
    if(shapes[index].componentId===shapes[index].id){
     const members=shapes.filter(shape=>shape.componentId===shapes[index].id);if(shapes.length+members.length>MAX_SHAPES)throw Error('This study can contain up to '+MAX_SHAPES+' shapes.');
     copy.componentId=copy.id;const copies=members.map(member=>member.id===shapes[index].id?copy:{...mirrorShape(member,c.axis as 'x'|'y'|'z'),componentId:copy.id});shapes.splice(index+1,0,...copies);
    }else shapes.splice(index+1,0,copy);break;
   }
   case 'remove':keys(c,['action','id']);if(shapes[index].componentId===shapes[index].id){next.shapes=shapes.filter(shape=>shape.componentId!==c.id);shapes.splice(0,shapes.length,...next.shapes);}else shapes.splice(index,1);break;
   case 'move':{
    keys(c,['action','id','index']);
    if(!Number.isInteger(c.index)||(c.index as number)<0||(c.index as number)>=shapes.length)throw Error('Choose an existing construction position.');
    const [shape]=shapes.splice(index,1);shapes.splice(c.index as number,0,shape);break;
   }
   default:throw Error('Unknown construction action.');
  }
  next.shapes=shapes;
 }
 return validateModel(reconcileAttachments(previous,reconcileComponentClearances(previous,next)));
}
