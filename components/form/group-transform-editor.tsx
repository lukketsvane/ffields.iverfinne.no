"use client";

import {useId,useRef,useState} from 'react';
import type {KeyboardEvent} from 'react';
import {Check,ChevronDown} from 'lucide-react';
import type {FormModel} from '@/lib/form-engine';
import type {FormShape} from '@/lib/shapes';
import styles from './group-transform-editor.module.css';

type Axis='x'|'y'|'z';
type Vector={x:number;y:number;z:number};
type VectorDraft=Record<Axis,string>;
type FieldGroup='translation'|'rotation'|'pivot';
export type GroupTransformCommand={action:'transform';ids:string[];translation:Vector;rotation:Vector;pivot:Vector};
export type GroupTransformEditorProps={model:FormModel;shapeId:string;onCommand:(command:GroupTransformCommand)=>unknown};
type FieldError={message:string;field?:string};
type FocusedField={group:FieldGroup;axis:Axis;value:string;defaultPivot:boolean};
const AXES:readonly Axis[]=['x','y','z'];
const ZERO_DRAFT:VectorDraft={x:'0',y:'0',z:'0'};
const GROUPS:readonly FieldGroup[]=['translation','rotation','pivot'];
const LABELS:Record<FieldGroup,string>={translation:'Translation',rotation:'Rotation',pivot:'Pivot'};
const RANGES:Record<FieldGroup,readonly [number,number]>={translation:[-600,600],rotation:[-360,360],pivot:[-1000,1000]};
const OPERATIONS={union:'Merge',subtract:'Cut',intersect:'Intersect'};
const originDraft=(shape:FormShape):VectorDraft=>({x:String(shape.x),y:String(shape.y),z:String(shape.z)});

/** Membership and all numeric values are drafts; Apply records one construction action. */
export function GroupTransformEditor(props:GroupTransformEditorProps){
 const shape=props.model.shapes?.find(candidate=>candidate.id===props.shapeId);
 if(!shape)return null;
 return <GroupTransformEditorContent key={shape.id} {...props} shape={shape}/>;
}

function GroupTransformEditorContent({model,shape,onCommand}:GroupTransformEditorProps&{shape:FormShape}){
 const [expanded,setExpanded]=useState(false);
 const [members,setMembers]=useState(()=>new Set([shape.id]));
 const [translation,setTranslation]=useState<VectorDraft>(ZERO_DRAFT);
 const [rotation,setRotation]=useState<VectorDraft>(ZERO_DRAFT);
 const [pivot,setPivot]=useState<VectorDraft|null>(null);
 const [error,setError]=useState<FieldError|null>(null);
 const focus=useRef<FocusedField|null>(null);
 const contentId=useId(),helpId=useId(),errorId=useId();
 const shapes=model.shapes??[];
 const ids=shapes.filter(candidate=>members.has(candidate.id)).map(candidate=>candidate.id);
 const fields:Record<FieldGroup,VectorDraft>={translation,rotation,pivot:pivot??originDraft(shape)};

 function updateField(group:FieldGroup,axis:Axis,value:string){
  if(group==='translation')setTranslation(previous=>({...previous,[axis]:value}));
  else if(group==='rotation')setRotation(previous=>({...previous,[axis]:value}));
  else setPivot(previous=>({...previous??originDraft(shape),[axis]:value}));
  setError(null);
 }

 function handleKey(event:KeyboardEvent<HTMLInputElement>,group:FieldGroup,axis:Axis){
  if(event.key==='Escape'){
   event.preventDefault();event.stopPropagation();
   const previous=focus.current;
   if(previous?.group===group&&previous.axis===axis){
    if(group==='pivot'&&previous.defaultPivot){setPivot(null);setError(null)}
    else updateField(group,axis,previous.value);
   }
   event.currentTarget.blur();
  }else if(event.key==='Enter'){event.preventDefault();event.stopPropagation();event.currentTarget.blur()}
 }

 function apply(){
  if(!ids.length){setError({message:'Select at least one shape to move together.'});return}
  const values:Record<FieldGroup,Vector>={translation:{x:0,y:0,z:0},rotation:{x:0,y:0,z:0},pivot:{x:0,y:0,z:0}};
  for(const group of GROUPS)for(const axis of AXES){
   const raw=fields[group][axis],value=Number(raw),[min,max]=RANGES[group],unit=group==='rotation'?'degrees':'mm';
   if(!raw.trim()||!Number.isFinite(value)||value<min||value>max){setError({field:`${group}-${axis}`,message:`${LABELS[group]} ${axis.toUpperCase()} must be between ${min} and ${max} ${unit}.`});return}
   values[group][axis]=value;
  }
  if(AXES.every(axis=>values.translation[axis]===0&&values.rotation[axis]===0)){setError({message:'Enter a translation or rotation before applying.'});return}
  try{
   onCommand({action:'transform',ids,...values});
   setTranslation(ZERO_DRAFT);setRotation(ZERO_DRAFT);setError(null);focus.current=null;
  }catch(cause){setError({message:cause instanceof Error?cause.message:'These shapes could not be transformed.'})}
 }

 return <section className={styles.section} aria-label="Move shapes together">
  <button type="button" className={styles.toggle} aria-expanded={expanded} aria-controls={contentId} onClick={()=>setExpanded(previous=>!previous)}><span>Move together</span>{expanded&&<small>{ids.length} selected</small>}<ChevronDown size={14} aria-hidden="true"/></button>
  {expanded&&<div className={styles.content} id={contentId}>
   <div className={styles.selectionActions}><button type="button" onClick={()=>{setMembers(new Set(shapes.map(candidate=>candidate.id)));setError(null)}} disabled={ids.length===shapes.length}>Select all</button><button type="button" onClick={()=>{setMembers(new Set());setError(null)}} disabled={!ids.length}>Clear</button></div>
   <div className={styles.shapeList} role="group" aria-label="Shapes to transform together">
    {shapes.map(candidate=><button type="button" role="checkbox" aria-checked={members.has(candidate.id)} aria-label={`Include ${candidate.name} in group transform`} key={candidate.id} title={candidate.name} onClick={()=>{setMembers(previous=>{const next=new Set(previous);if(next.has(candidate.id))next.delete(candidate.id);else next.add(candidate.id);return next});setError(null)}}>
     <span className={styles.checkbox} aria-hidden="true">{members.has(candidate.id)&&<Check size={13}/>}</span><span className={styles.shapeName}>{candidate.name}</span><small>{candidate.enabled?OPERATIONS[candidate.operation]:'Hidden'}</small>
    </button>)}
   </div>
   {GROUPS.map(group=><div className={styles.fieldGroup} key={group}>
    <div className={styles.fieldHeading}><span>{LABELS[group]}</span>{group==='pivot'?<button type="button" disabled={pivot===null} onClick={()=>{setPivot(null);setError(null)}} aria-label="Use selected shape origin as group pivot">Selected origin</button>:<small>{group==='rotation'?'World · degrees':'World · mm'}</small>}</div>
    <div className={styles.fields} role="group" aria-label={`Group ${LABELS[group].toLowerCase()}`}>
     {AXES.map(axis=>{const invalid=error?.field===`${group}-${axis}`;return <label key={axis}><span>{axis.toUpperCase()}</span><input type="number" step={group==='rotation'?1:.1} min={RANGES[group][0]} max={RANGES[group][1]} aria-label={`Group ${group} ${axis.toUpperCase()} in ${group==='rotation'?'degrees':'world millimetres'}`} aria-invalid={invalid||undefined} aria-describedby={invalid?errorId:helpId} value={fields[group][axis]} onFocus={event=>{focus.current={group,axis,value:event.currentTarget.value,defaultPivot:group==='pivot'&&pivot===null}}} onChange={event=>updateField(group,axis,event.currentTarget.value)} onBlur={()=>{focus.current=null}} onKeyDown={event=>handleKey(event,group,axis)}/></label>})}
    </div>
   </div>)}
   <button type="button" className={styles.applyButton} onClick={apply}>Apply to {ids.length===1?'1 shape':`${ids.length} shapes`}</button>
   {error&&<p className={styles.error} role="alert" id={errorId}>{error.message}</p>}
   <p className={styles.help} id={helpId}>Rotate around the world pivot, then translate. Include sockets and their cuts to keep them together. Apply records one undo step.</p>
  </div>}
 </section>;
}
