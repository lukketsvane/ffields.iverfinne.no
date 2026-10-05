import catalog from './asset-catalog.json' with {type:'json'};
import type {PlacedAsset} from './assets.ts';
import type {FormModel} from './form-engine.ts';
import {makeShape,MAX_SHAPES,SHAPE_LIMITS} from './shapes.ts';
import type {FormShape} from './shapes.ts';

export type ComponentClearanceVector={x:number;y:number;z:number};
export type ComponentOpening={axis:'x'|'y'|'z';direction:-1|1;travel:number};
export type ComponentClearance={assetId:string;shapeId:string;clearance:ComponentClearanceVector;opening?:ComponentOpening};
export type ComponentClearanceCommand={action:'component-clearance'}&ComponentClearance;
export const COMPONENT_CLEARANCE_LIMITS={clearance:[0,30],travel:[0,240],envelope:[4,200],count:MAX_SHAPES} as const;
const axes=['x','y','z'] as const;
const geometryKeys=['kind','operation','blend','x','y','z','rx','ry','rz','width','height','depth','roundness'] as const;
const normalizeRotation=(value:number)=>((value+180)%360+360)%360-180;
const record=(value:unknown)=>!!value&&typeof value==='object'&&!Array.isArray(value);
const exactKeys=(value:object,allowed:string[])=>Object.keys(value).every(key=>allowed.includes(key));
const sameLink=(a:ComponentClearance,b:ComponentClearance)=>a.assetId===b.assetId&&a.shapeId===b.shapeId&&axes.every(axis=>a.clearance[axis]===b.clearance[axis])&&a.opening?.axis===b.opening?.axis&&a.opening?.direction===b.opening?.direction&&a.opening?.travel===b.opening?.travel;
const sameGeometry=(a:FormShape,b:FormShape)=>geometryKeys.every(key=>a[key]===b[key]);

function validateLink(link:ComponentClearance):void {
 if(!record(link)||!exactKeys(link,['assetId','shapeId','clearance','opening'])||typeof link.assetId!=='string'||!link.assetId.length||link.assetId.length>100||typeof link.shapeId!=='string'||!link.shapeId.length||link.shapeId.length>100||!record(link.clearance)||!exactKeys(link.clearance,axes as unknown as string[]))throw Error('Invalid component clearance.');
 for(const axis of axes){const value=link.clearance[axis];if(typeof value!=='number'||!Number.isFinite(value)||value<COMPONENT_CLEARANCE_LIMITS.clearance[0]||value>COMPONENT_CLEARANCE_LIMITS.clearance[1])throw Error('Component clearance must be between 0 and 30 mm per side.');}
 if(link.opening!==undefined){const opening=link.opening;if(!record(opening)||!exactKeys(opening,['axis','direction','travel'])||!axes.includes(opening.axis)||![-1,1].includes(opening.direction)||typeof opening.travel!=='number'||!Number.isFinite(opening.travel)||opening.travel<COMPONENT_CLEARANCE_LIMITS.travel[0]||opening.travel>COMPONENT_CLEARANCE_LIMITS.travel[1])throw Error('Invalid component insertion opening.');}
}

/** Local unscaled dimensions: an explicit measurement overrides reference CAD.
 * Both describe a centred envelope, not lens axes or individual mounting faces. */
export function componentEnvelopeDimensions(asset:PlacedAsset):readonly [number,number,number] {
 const definition=catalog.find(source=>source.id===asset.sourceId);if(!definition)throw Error('Choose a known component.');
 if(asset.envelope!==undefined&&(!Array.isArray(asset.envelope)||asset.envelope.length!==3||asset.envelope.some(value=>typeof value!=='number'||!Number.isFinite(value)||value<COMPONENT_CLEARANCE_LIMITS.envelope[0]||value>COMPONENT_CLEARANCE_LIMITS.envelope[1])))throw Error('Measured component dimensions must be between 4 and 200 mm.');
 return (asset.envelope??definition.dimensions) as [number,number,number];
}

/** Exact box envelope plus symmetric per-axis clearance. The optional opening
 * sweeps that box in one component-local direction, retaining the opposite face.
 * Sharp corners are conservative for every object contained by the envelope.
 * Existing shape limits are rejected rather than silently clipping fit geometry. */
export function deriveComponentClearance(asset:PlacedAsset,link:ComponentClearance,existingShape?:FormShape):FormShape {
 validateLink(link);if(link.assetId!==asset.id)throw Error('Clearance references another component.');
 if(!Number.isFinite(asset.scale)||asset.scale<.05||asset.scale>10||axes.some(axis=>!Number.isFinite(asset[axis]))||['rx','ry','rz'].some(axis=>!Number.isFinite(asset[axis as 'rx'|'ry'|'rz'])))throw Error('Invalid component transform.');
 const dimensions=componentEnvelopeDimensions(asset).map((dimension,index)=>dimension*asset.scale+2*link.clearance[axes[index]]),offset={x:0,y:0,z:0};
 if(link.opening){const index=axes.indexOf(link.opening.axis);dimensions[index]+=link.opening.travel;offset[link.opening.axis]=link.opening.direction*link.opening.travel/2;}
 const rx=normalizeRotation(asset.rx),ry=normalizeRotation(asset.ry),rz=normalizeRotation(asset.rz),a=rx*Math.PI/180,b=ry*Math.PI/180,c=rz*Math.PI/180,cx=Math.cos(a),sx=Math.sin(a),cy=Math.cos(b),sy=Math.sin(b),cz=Math.cos(c),sz=Math.sin(c);
 const x=asset.x+cy*cz*offset.x-cy*sz*offset.y+sy*offset.z,y=asset.y+(cx*sz+sx*sy*cz)*offset.x+(cx*cz-sx*sy*sz)*offset.y-sx*cy*offset.z,z=asset.z+(sx*sz-cx*sy*cz)*offset.x+(sx*cz+cx*sy*sz)*offset.y+cx*cy*offset.z;
 const shape:FormShape={...(existingShape??makeShape('box')),id:link.shapeId,name:existingShape?.name??(asset.name+' clearance').slice(0,100),kind:'box',operation:'subtract',blend:0,x,y,z,rx,ry,rz,width:dimensions[0],height:dimensions[1],depth:dimensions[2],roundness:0};
 for(const [key,range] of Object.entries(SHAPE_LIMITS)){const value=shape[key as keyof typeof SHAPE_LIMITS];if(typeof value!=='number'||!Number.isFinite(value)||value<range[0]||value>range[1])throw Error('Component clearance exceeds supported '+key+' range ('+range[0]+'–'+range[1]+').');}
 // Primitive metadata from a previously authored box cannot alter this envelope.
 delete shape.path;delete shape.depthRatio;delete shape.sectionMode;delete shape.sectionRoll;return shape;
}

export function validateComponentClearances(model:FormModel):void {
 if(model.componentClearances===undefined)return;
 if(!Array.isArray(model.componentClearances)||model.componentClearances.length>COMPONENT_CLEARANCE_LIMITS.count)throw Error('Invalid component clearance list.');
 const assets=new Map((model.assets??[]).map(asset=>[asset.id,asset])),shapes=new Map((model.shapes??[]).map(shape=>[shape.id,shape])),usedAssets=new Set<string>(),usedShapes=new Set<string>();
 for(const link of model.componentClearances){
  validateLink(link);const asset=assets.get(link.assetId),shape=shapes.get(link.shapeId);
  if(!asset||!shape)throw Error('Component clearance references a missing component or shape.');
  if(shape.kind!=='box'||shape.operation!=='subtract'||shape.blend!==0||shape.roundness!==0)throw Error('A linked component clearance must be a sharp subtract box.');
  if(usedAssets.has(link.assetId)||usedShapes.has(link.shapeId))throw Error('A component and clearance shape can each have only one link.');usedAssets.add(link.assetId);usedShapes.add(link.shapeId);
  deriveComponentClearance(asset,link,shape);
 }
}

/** Pure deterministic resolution; hidden CAD retains its fit envelope. */
export function resolveComponentClearances(model:FormModel):FormModel {
 validateComponentClearances(model);if(!model.componentClearances?.length)return model;
 const assets=new Map((model.assets??[]).map(asset=>[asset.id,asset])),links=new Map(model.componentClearances.map(link=>[link.shapeId,link]));let changed=false;
 const shapes=(model.shapes??[]).map(shape=>{const link=links.get(shape.id);if(!link)return shape;const derived=deriveComponentClearance(assets.get(link.assetId)!,link,shape);if(sameGeometry(shape,derived))return shape;changed=true;return derived;});
 return changed?{...model,shapes}:model;
}

/** Reconcile RAW edits before resolution. Editing a cut's geometry detaches it.
 * Name/order/enabled changes retain links. Deleting a component freezes its last resolved
 * cavity; deleting the cavity drops its link. New/changed links are intentional. */
export function reconcileComponentClearances(previous:FormModel,next:FormModel):FormModel {
 const before=resolveComponentClearances(previous),beforeShapes=new Map((before.shapes??[]).map(shape=>[shape.id,shape])),nextShapes=new Map((next.shapes??[]).map(shape=>[shape.id,shape])),nextAssets=new Set((next.assets??[]).map(asset=>asset.id)),beforeLinks=new Map((before.componentClearances??[]).map(link=>[link.shapeId,link]));
 if(next.componentClearances===undefined)return next;if(!Array.isArray(next.componentClearances))throw Error('Invalid component clearance list.');
 const links:ComponentClearance[]=[];let changed=false;
 for(const link of next.componentClearances){
  validateLink(link);const shape=nextShapes.get(link.shapeId),oldShape=beforeShapes.get(link.shapeId),oldLink=beforeLinks.get(link.shapeId);
  if(!shape){changed=true;continue;}
  if(!nextAssets.has(link.assetId)){
   if(!oldLink||!oldShape)throw Error('Component clearance references a missing component.');
   nextShapes.set(shape.id,{...oldShape,name:shape.name});changed=true;continue;
  }
  if(oldLink&&oldShape&&sameLink(oldLink,link)&&!sameGeometry(oldShape,shape)){changed=true;continue;}
  links.push(link);
 }
 const reconciled=changed?{...next,shapes:(next.shapes??[]).map(shape=>nextShapes.get(shape.id)!),componentClearances:links}:next;
 return resolveComponentClearances(reconciled);
}
