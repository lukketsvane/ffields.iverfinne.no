"use client";

import {useId,useState} from 'react';
import type {KeyboardEvent} from 'react';
import {Box,Link2} from 'lucide-react';
import {assetDefinition} from '@/lib/assets';
import type {PlacedAsset} from '@/lib/assets';
import {COMPONENT_CLEARANCE_LIMITS} from '@/lib/component-clearance';
import type {ComponentClearance,ComponentClearanceCommand,ComponentOpening} from '@/lib/component-clearance';
import type {FormModel} from '@/lib/form-engine';
import styles from './component-clearance-editor.module.css';

type Axis='x'|'y'|'z';
type VectorDraft=Record<Axis,string>;
type OpeningDirection='none'|'x-'|'x+'|'y-'|'y+'|'z-'|'z+';
type FieldError={message:string;field?:string};
export type ComponentClearanceEditorProps={model:FormModel;asset:PlacedAsset;onCommand:(command:unknown)=>unknown;onSelect:(id:string)=>void};
const AXES:readonly Axis[]=['x','y','z'];
const DIRECTIONS:readonly {value:OpeningDirection;label:string}[]=[{value:'none',label:'Closed'},{value:'x-',label:'−X'},{value:'x+',label:'+X'},{value:'y-',label:'−Y'},{value:'y+',label:'+Y'},{value:'z-',label:'−Z'},{value:'z+',label:'+Z'}];
const DEFAULT_CLEARANCE={x:.5,y:.5,z:.5};
const format=(value:number)=>String(Math.round(value*1e6)/1e6);
const sameNumber=(draft:string,value:number)=>!!draft.trim()&&Number(draft.trim().replace(',','.'))===value;
const vectorDraft=(values:readonly number[]):VectorDraft=>({x:format(values[0]),y:format(values[1]),z:format(values[2])});
const clearanceDraft=(link?:ComponentClearance):VectorDraft=>{const values=link?.clearance??DEFAULT_CLEARANCE;return vectorDraft(AXES.map(axis=>values[axis]))};
const openingDirection=(opening?:ComponentOpening):OpeningDirection=>opening?`${opening.axis}${opening.direction===1?'+':'-'}`:'none';
const message=(cause:unknown)=>cause instanceof Error?cause.message:'The component clearance could not be updated.';
function availableClearanceId(model:FormModel,assetId:string){
 const used=new Set([...(model.shapes??[]).map(shape=>shape.id),...(model.assets??[]).map(asset=>asset.id),...model.influences.map(influence=>influence.id)]);
 const base=`clearance-${assetId}`.slice(0,100);
 let id=base,index=1;
 while(used.has(id)){const suffix=`-${++index}`;id=base.slice(0,100-suffix.length)+suffix}
 return id;
}

/** Measured fit envelopes and insertion paths remain in the component's dock. */
export function ComponentClearanceEditor(props:ComponentClearanceEditorProps){
 const link=props.model.componentClearances?.find(candidate=>candidate.assetId===props.asset.id);
 const cut=props.model.shapes?.find(candidate=>candidate.id===link?.shapeId);
 const definition=assetDefinition(props.asset.sourceId);
 if(!definition)return null;
 // Reset numeric drafts after undo/import or a committed measurement change.
 const fingerprint=JSON.stringify([props.asset.id,props.asset.envelope,props.asset.scale,link,cut?.enabled]);
 return <ComponentClearanceEditorContent key={fingerprint} {...props} link={link} referenceDimensions={definition.dimensions}/>;
}

function ComponentClearanceEditorContent({model,asset,onCommand,onSelect,link,referenceDimensions}:ComponentClearanceEditorProps&{link?:ComponentClearance;referenceDimensions:readonly [number,number,number]}){
 const dimensions=asset.envelope??referenceDimensions;
 const [envelope,setEnvelope]=useState<VectorDraft>(()=>vectorDraft(dimensions));
 const [clearance,setClearance]=useState<VectorDraft>(()=>clearanceDraft(link));
 const [direction,setDirection]=useState<OpeningDirection>(()=>openingDirection(link?.opening));
 const [travel,setTravel]=useState(()=>format(link?.opening?.travel??30));
 const [error,setError]=useState<FieldError|null>(null);
 const helpId=useId(),errorId=useId();
 const shape=model.shapes?.find(candidate=>candidate.id===link?.shapeId);
 const currentEnvelope=vectorDraft(dimensions),currentClearance=clearanceDraft(link);
 const envelopeChanged=AXES.some((axis,index)=>!sameNumber(envelope[axis],dimensions[index]));
 const clearanceChanged=!link||AXES.some(axis=>!sameNumber(clearance[axis],link.clearance[axis]))||direction!==openingDirection(link.opening)||(direction!=='none'&&!sameNumber(travel,link.opening?.travel??30));

 function parseVector(draft:VectorDraft,group:'envelope'|'clearance'):number[]|null{
  const range=COMPONENT_CLEARANCE_LIMITS[group],values=[];
  for(const axis of AXES){
   const raw=draft[axis].trim(),value=Number(raw.replace(',','.'));
   if(!raw||!Number.isFinite(value)||value<range[0]||value>range[1]){
    setError({field:`${group}-${axis}`,message:`${group==='envelope'?'Measured envelope':'Clearance'} ${axis.toUpperCase()} must be between ${range[0]} and ${range[1]} mm.`});return null;
   }
   values.push(value);
  }
  return values;
 }

 function applyEnvelope(){
  if(!envelopeChanged)return;
  const values=parseVector(envelope,'envelope');if(!values)return;
  try{onCommand({action:'update-component',id:asset.id,patch:{envelope:values as [number,number,number]}});setEnvelope(vectorDraft(values));setError(null)}catch(cause){setError({message:message(cause)})}
 }

 function restoreReferenceEnvelope(){
  try{onCommand({action:'update-component',id:asset.id,patch:{envelope:null}});setEnvelope(vectorDraft(referenceDimensions));setError(null)}catch(cause){setError({message:message(cause)})}
 }

 function applyClearance(){
  if(envelopeChanged){setError({message:'Apply the measured envelope before updating its cavity.'});return}
  if(!clearanceChanged)return;
  const values=parseVector(clearance,'clearance');if(!values)return;
  let opening:ComponentOpening|undefined;
  if(direction!=='none'){
   const raw=travel.trim(),value=Number(raw.replace(',','.')),[min,max]=COMPONENT_CLEARANCE_LIMITS.travel;
   if(!raw||!Number.isFinite(value)||value<min||value>max){setError({field:'travel',message:`Insertion travel must be between ${min} and ${max} mm.`});return}
   opening={axis:direction[0] as Axis,direction:direction[1]==='+'?1:-1,travel:value};
  }
  const command:ComponentClearanceCommand={action:'component-clearance',assetId:asset.id,shapeId:link?.shapeId??availableClearanceId(model,asset.id),clearance:{x:values[0],y:values[1],z:values[2]},...(opening?{opening}:{})};
  try{onCommand(command);setClearance(vectorDraft(values));if(opening)setTravel(format(opening.travel));setError(null)}catch(cause){setError({message:message(cause)})}
 }

 function handleKey(event:KeyboardEvent<HTMLInputElement>,group:'envelope'|'clearance'){
  if(event.key==='Enter'){event.preventDefault();event.stopPropagation();if(group==='envelope')applyEnvelope();else applyClearance()}
  else if(event.key==='Escape'){
   event.preventDefault();event.stopPropagation();
   if(group==='envelope')setEnvelope(currentEnvelope);
   else{setClearance(currentClearance);setDirection(openingDirection(link?.opening));setTravel(format(link?.opening?.travel??30))}
   setError(null);event.currentTarget.blur();
  }
 }

 function fields(group:'envelope'|'clearance',draft:VectorDraft,setDraft:(value:VectorDraft)=>void){
  return <div className={styles.fields} role="group" aria-label={group==='envelope'?'Measured component envelope dimensions':'Component clearance per side'}>
   {AXES.map(axis=>{const invalid=error?.field===`${group}-${axis}`;return <label key={axis}><span>{axis.toUpperCase()}</span><input type="text" inputMode="decimal" autoComplete="off" spellCheck={false} aria-label={`${group==='envelope'?'Measured component envelope':'Component clearance per side'} ${axis.toUpperCase()} in millimetres`} aria-invalid={invalid||undefined} aria-describedby={invalid?`${helpId} ${errorId}`:helpId} value={draft[axis]} onChange={event=>{setDraft({...draft,[axis]:event.currentTarget.value});setError(null)}} onKeyDown={event=>handleKey(event,group)}/></label>})}
  </div>;
 }

 return <section className={styles.section} aria-label="Component fit and clearance" aria-describedby={helpId}>
  <div className={styles.heading}><span>Component fit</span><Box size={14} aria-hidden="true"/></div>
  <div className={styles.fieldGroup}>
   <div className={styles.fieldHeading}><span>Measured envelope</span><small>Local · mm</small></div>
   {fields('envelope',envelope,setEnvelope)}
   <button type="button" className={styles.applyButton} disabled={!envelopeChanged} onClick={applyEnvelope}>Apply measured envelope</button>
   {asset.envelope&&<button type="button" className={styles.restoreButton} onClick={restoreReferenceEnvelope}>Use reference CAD envelope</button>}
   <p className={styles.reference}>Reference CAD: {referenceDimensions.map(format).join(' × ')} mm.<span>Measurements change the fit envelope; reference CAD keeps its proportions.{asset.scale!==1?` Current scale ×${format(asset.scale)}.`:''}</span></p>
  </div>
  <div className={styles.fieldGroup}>
   <div className={styles.fieldHeading}><span>Clearance per side</span><small>mm</small></div>
   {fields('clearance',clearance,setClearance)}
   <label className={styles.openingField}><span>Insertion direction</span><select aria-label="Component insertion direction in local axes" value={direction} onChange={event=>{setDirection(event.currentTarget.value as OpeningDirection);setError(null)}}><option value="none">Closed</option>{DIRECTIONS.filter(option=>option.value!=='none').map(option=><option key={option.value} value={option.value}>{option.label}</option>)}</select></label>
   <label className={styles.travelField}><span>Insertion travel</span><div><input type="text" inputMode="decimal" autoComplete="off" spellCheck={false} aria-label="Component insertion travel in millimetres" aria-invalid={error?.field==='travel'||undefined} aria-describedby={error?.field==='travel'?`${helpId} ${errorId}`:helpId} disabled={direction==='none'} value={travel} onChange={event=>{setTravel(event.currentTarget.value);setError(null)}} onKeyDown={event=>handleKey(event,'clearance')}/><span>mm</span></div></label>
   <button type="button" className={styles.applyButton} disabled={!clearanceChanged||envelopeChanged} onClick={applyClearance}>{link?'Update linked cavity':'Make linked cavity'}</button>
   {envelopeChanged&&<p className={styles.help}>Apply the measured envelope to use these dimensions in the cavity.</p>}
  </div>
  {link&&shape&&<div className={styles.linkStatus}><Link2 size={14} aria-hidden="true"/><span>{shape.name}<small>{shape.enabled?'Follows component position and rotation':'Cut hidden · link retained'}</small></span><button type="button" aria-label={`Inspect linked cavity ${shape.name}`} onClick={()=>onSelect(shape.id)}>Inspect cut</button></div>}
  {error&&<p className={styles.error} id={errorId} role="alert">{error.message}</p>}
  <p className={styles.help} id={helpId}>Bounding envelope, not a factory fit. Clearance stays in millimetres at any component scale. Insertion extends the cut along one local axis. Each Apply records one undo step.</p>
 </section>;
}
