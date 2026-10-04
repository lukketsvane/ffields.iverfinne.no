"use client";

import {useId,useRef,useState} from 'react';
import {ChevronDown,Link2,Unlink} from 'lucide-react';
import {canAttachTo} from '@/lib/attachments';
import type {ConstructionCommand} from '@/lib/construction';
import type {FormModel} from '@/lib/form-engine';
import type {FormShape} from '@/lib/shapes';

type Endpoint='start'|'end';
type Anchor='center'|'x-'|'x+'|'y-'|'y+'|'z-'|'z+';
type Offset={x:number;y:number;z:number};
export type SweepAttachmentEditorProps={model:FormModel;shape:FormShape;onCommand:(command:ConstructionCommand)=>unknown};
const ENDPOINTS=['start','end'] as const;
const AXES=['x','y','z'] as const;
const ANCHORS:readonly {value:Anchor;label:string;description:string}[]=[
 {value:'center',label:'Center',description:'center'},
 {value:'x-',label:'−X',description:'negative X'},
 {value:'x+',label:'+X',description:'positive X'},
 {value:'y-',label:'−Y',description:'negative Y'},
 {value:'y+',label:'+Y',description:'positive Y'},
 {value:'z-',label:'−Z',description:'negative Z'},
 {value:'z+',label:'+Z',description:'positive Z'},
];
const ZERO_OFFSET:Offset={x:0,y:0,z:0};
const format=(value:number)=>String(Math.round(value*100)/100);
const capitalize=(value:string)=>value.charAt(0).toUpperCase()+value.slice(1);

/** Endpoint relationships stay in the docked inspector; target selection does not move the path. */
export function SweepAttachmentEditor(props:SweepAttachmentEditorProps){
 if(props.shape.kind!=='sweep')return null;
 return <AttachmentEditorContent key={props.shape.id} {...props}/>;
}

function AttachmentEditorContent({model,shape,onCommand}:SweepAttachmentEditorProps){
 const [endpoint,setEndpoint]=useState<Endpoint>('start');
 const [choosingTarget,setChoosingTarget]=useState(false);
 const [error,setError]=useState('');
 const targetListId=useId(),helpId=useId();
 const attachment=model.attachments?.find(link=>link.sweepId===shape.id&&link.endpoint===endpoint);
 const target=model.shapes?.find(candidate=>candidate.id===attachment?.targetShapeId);
 const targets=model.shapes?.filter(candidate=>candidate.id!==shape.id)??[];
 const title=capitalize(endpoint);

 function send(command:ConstructionCommand){
  try{onCommand(command);setError('');return true}catch(cause){setError(cause instanceof Error?cause.message:'Could not update the endpoint attachment.');return false}
 }

 function chooseTarget(targetShapeId:string){
  if(send({action:'attach',sweepId:shape.id,endpoint,targetShapeId,anchor:attachment?.anchor??'center'}))setChoosingTarget(false);
 }

 function changeAnchor(anchor:Anchor){
  if(!attachment||anchor===attachment.anchor)return;
  send({action:'attach',sweepId:shape.id,endpoint,targetShapeId:attachment.targetShapeId,anchor});
 }

 function changeOffset(axis:keyof Offset,value:number){
  if(!attachment)return false;
  return send({action:'attach',sweepId:shape.id,endpoint,targetShapeId:attachment.targetShapeId,anchor:attachment.anchor,offset:{...attachment.offset,[axis]:value}});
 }

 return <section className="sweep-attachments" aria-label="Sweep endpoint attachments" aria-describedby={helpId}>
  <div className="attachment-heading"><span>Endpoint attachments</span><Link2 size={14} aria-hidden="true"/></div>
  <div className="attachment-endpoints" role="group" aria-label="Choose sweep endpoint">
   {ENDPOINTS.map(next=>{const link=model.attachments?.find(item=>item.sweepId===shape.id&&item.endpoint===next),linkedTarget=model.shapes?.find(item=>item.id===link?.targetShapeId);return <button type="button" key={next} aria-pressed={endpoint===next} onClick={()=>{setEndpoint(next);setChoosingTarget(false);setError('')}}>
    <span>{capitalize(next)}{link?<Link2 size={12} aria-hidden="true"/>:<span className="attachment-free-dot" aria-hidden="true"/>}</span>
    <small>{link?linkedTarget?.name??'Missing target':'Free endpoint'}</small>
   </button>})}
  </div>
  <div className="attachment-target-label"><span>Attach {endpoint} to</span>{attachment&&<small>{target?.enabled===false?'Target hidden · link retained':'Follows target'}</small>}</div>
  <button type="button" className="attachment-target-toggle" aria-label={`Choose ${endpoint} attachment target`} aria-expanded={choosingTarget} aria-controls={targetListId} onClick={()=>setChoosingTarget(!choosingTarget)}>
   <Link2 size={14} aria-hidden="true"/><span>{attachment?target?.name??'Missing target':'Choose a target shape'}</span><ChevronDown size={14} aria-hidden="true"/>
  </button>
  {choosingTarget&&<div className="attachment-target-list" id={targetListId} role="group" aria-label={`${title} endpoint target shapes`}>
   {targets.length?targets.map(candidate=>{const cycle=!canAttachTo(model,shape.id,candidate.id),hidden=!candidate.enabled,selected=attachment?.targetShapeId===candidate.id;return <button type="button" key={candidate.id} aria-pressed={selected} disabled={cycle||hidden} title={cycle?'Would create a circular attachment':hidden?'Show this shape before attaching':''} onClick={()=>chooseTarget(candidate.id)}>
    <span>{candidate.name}</span><small>{cycle?'Circular link':hidden?'Hidden':selected?'Attached':candidate.kind==='sweep'?'Sweep':'Shape'}</small>
   </button>}):<p>Add another shape to attach this endpoint.</p>}
  </div>}
  {attachment?<>
   <div className="attachment-target-label"><span>Target anchor</span><small>Local axes</small></div>
   <div className="attachment-anchors" role="group" aria-label={`${title} target anchor`}>
    {ANCHORS.map(anchor=><button type="button" key={anchor.value} aria-pressed={attachment.anchor===anchor.value} aria-label={`${title} endpoint ${anchor.description} anchor`} onClick={()=>changeAnchor(anchor.value)}>{anchor.label}</button>)}
   </div>
   <div className="attachment-target-label"><span>Offset from anchor</span><small>Target local · mm</small></div>
   <div className="attachment-offsets" role="group" aria-label={`${title} endpoint target-local offsets`}>
    {AXES.map(axis=><OffsetNumber key={`${endpoint}-${attachment.targetShapeId}-${attachment.anchor}-${axis}`} axis={axis} endpoint={endpoint} value={attachment.offset[axis]} apply={value=>changeOffset(axis,value)}/>)}
   </div>
   <div className="attachment-actions">
    <button type="button" disabled={AXES.every(axis=>attachment.offset[axis]===0)} onClick={()=>send({action:'attach',sweepId:shape.id,endpoint,targetShapeId:attachment.targetShapeId,anchor:attachment.anchor,offset:ZERO_OFFSET})}>Align to anchor</button>
    <button type="button" aria-label={`Detach ${endpoint} endpoint and keep its position`} onClick={()=>{if(send({action:'detach',sweepId:shape.id,endpoint}))setChoosingTarget(false)}}><Unlink size={13} aria-hidden="true"/>Detach</button>
   </div>
  </>:null}
  {error&&<p className="attachment-error" role="alert">{error}</p>}
  <p className="attachment-help" id={helpId}>{attachment?'Offsets rotate with the target. Detach keeps the current position; moving this endpoint in the sketch detaches it.':'Choose a target to link this endpoint without moving it. Align to anchor moves it onto the chosen anchor.'}</p>
 </section>;
}

function OffsetNumber({axis,endpoint,value,apply}:{axis:keyof Offset;endpoint:Endpoint;value:number;apply:(value:number)=>boolean}){
 const [draft,setDraft]=useState<string|null>(null);
 const [invalid,setInvalid]=useState(false);
 const cancelled=useRef(false),dirty=useRef(false),errorId=useId();
 function finish(raw:string){
  if(cancelled.current){cancelled.current=false;setDraft(null);setInvalid(false);return}
  if(!dirty.current){setDraft(null);setInvalid(false);return}
  const parsed=Number(raw);
  if(!raw.trim()||!Number.isFinite(parsed)){setInvalid(true);return}
  const next=Math.round(Math.max(-240,Math.min(240,parsed))*100)/100;
  if(next===value||apply(next)){setDraft(null);setInvalid(false)}
 }
 return <label className="attachment-offset-field"><span>{axis.toUpperCase()}</span><div><input type="number" aria-label={`${capitalize(endpoint)} attachment ${axis.toUpperCase()} offset in target-local millimetres`} aria-invalid={invalid||undefined} aria-describedby={invalid?errorId:undefined} min={-240} max={240} step={.1} value={draft??format(value)} onFocus={()=>{cancelled.current=false;dirty.current=false;if(!invalid)setDraft(format(value))}} onChange={event=>{dirty.current=true;setInvalid(false);setDraft(event.currentTarget.value)}} onBlur={event=>finish(event.currentTarget.value)} onKeyDown={event=>{if(event.key==='Escape'){event.preventDefault();event.stopPropagation();cancelled.current=true;event.currentTarget.blur()}else if(event.key==='Enter'){event.preventDefault();event.stopPropagation();event.currentTarget.blur()}}}/><span>mm</span></div>{invalid&&<small id={errorId}>Enter a number.</small>}</label>;
}
