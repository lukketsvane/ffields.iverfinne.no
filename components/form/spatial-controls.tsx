"use client";

import {useId,useRef,useState} from 'react';
import type {KeyboardEvent} from 'react';
import {orientShapeToward,shapeAxisDirection} from '@/lib/orientation';
import type {FormShape} from '@/lib/shapes';
import styles from './spatial-controls.module.css';

type Axis='x'|'y'|'z';
type SpatialControlsProps={shape:FormShape;onPatch:(patch:Partial<FormShape>)=>void};
type DirectionDraft=Record<Axis,string>;
const AXES:readonly Axis[]=['x','y','z'];
const format=(value:number)=>String(Math.round(value*1e6)/1e6);
const errorMessage=(error:unknown)=>error instanceof Error?error.message:'This change could not be applied.';

/** Both modes use the same saved sweep. Switching only changes its section frame. */
export function SweepProfileControls({shape,onPatch}:SpatialControlsProps){
 if(shape.kind!=='sweep')return null;
 return <SweepProfileControlsContent key={`${shape.id}:${shape.sectionMode??'fixed'}:${shape.sectionRoll??0}`} shape={shape} onPatch={onPatch}/>;
}

function SweepProfileControlsContent({shape,onPatch}:SpatialControlsProps){
 const helpId=useId(),errorId=useId();
 const mode=shape.sectionMode??'fixed',roll=shape.sectionRoll??0;
 const [draft,setDraft]=useState<string|null>(null);
 const [error,setError]=useState<string|null>(null);
 const cancelled=useRef(false);

 function changeMode(next:'fixed'|'transported'){
  if(next===mode)return;
  try{onPatch({sectionMode:next});setDraft(null);setError(null)}catch(cause){setError(errorMessage(cause))}
 }

 function commitRoll(){
  if(cancelled.current){cancelled.current=false;setDraft(null);setError(null);return}
  if(draft===null)return;
  const next=Number(draft);
  if(!draft.trim()||!Number.isFinite(next)||next< -360||next>360){setError('Enter a section roll from −360 to 360 degrees.');return}
  try{if(next!==roll)onPatch({sectionRoll:next});setDraft(null);setError(null)}catch(cause){setError(errorMessage(cause))}
 }

 return <section className={styles.section} aria-label="Sweep section orientation">
  <div className={styles.heading}>Section orientation</div>
  <div className={styles.modeButtons} role="group" aria-label="Sweep section frame" aria-describedby={helpId}>
   <button type="button" aria-pressed={mode==='fixed'} onClick={()=>changeMode('fixed')}>Fixed</button>
   <button type="button" aria-pressed={mode==='transported'} onClick={()=>changeMode('transported')}>Follow curve</button>
  </div>
  <label className={styles.rollField}>
   <span>Section roll</span>
   <div><input type="number" step={1} min={-360} max={360} disabled={mode==='fixed'} aria-label="Section roll in degrees" aria-invalid={error?true:undefined} aria-describedby={error?`${helpId} ${errorId}`:helpId} value={draft??format(roll)} onFocus={()=>{cancelled.current=false;setDraft(previous=>previous??format(roll))}} onChange={event=>{setDraft(event.target.value);setError(null)}} onBlur={commitRoll} onKeyDown={event=>{if(event.key==='Escape'){event.preventDefault();event.stopPropagation();cancelled.current=true;event.currentTarget.blur()}else if(event.key==='Enter'){event.preventDefault();event.stopPropagation();event.currentTarget.blur()}}}/><span>°</span></div>
  </label>
  <p className={styles.help} id={helpId}>{mode==='fixed'?'Depth stays along local Z. Follow curve carries the section along each bend and enables roll.':(shape.depthRatio??1)===1?'The section follows each bend. Reduce section depth below 100% to make roll visible.':'Depth follows the curve’s section frame. Roll turns that section around the curve.'}</p>
  {error&&<p className={styles.error} id={errorId} role="alert">{error}</p>}
 </section>;
}

/** Direction remains a draft until Apply, so all Euler angles share one undo step. */
export function ShapeDirectionEditor({shape,onPatch}:SpatialControlsProps){
 return <ShapeDirectionEditorContent key={`${shape.id}:${shape.rx}:${shape.ry}:${shape.rz}`} shape={shape} onPatch={onPatch}/>;
}

function ShapeDirectionEditorContent({shape,onPatch}:SpatialControlsProps){
 const helpId=useId(),errorId=useId();
 const initialAxis:Axis=shape.kind==='cylinder'||shape.kind==='capsule'||shape.kind==='torus'?'y':shape.kind==='sweep'?'x':'z';
 const [axis,setAxis]=useState<Axis>(initialAxis);
 const [draft,setDraft]=useState<DirectionDraft>(()=>directionDraft(shape,initialAxis));
 const [error,setError]=useState<string|null>(null);
 const currentDraft=directionDraft(shape,axis),changed=AXES.some(component=>draft[component]!==currentDraft[component]);

 function selectAxis(next:Axis){
  if(next===axis)return;
  setAxis(next);setDraft(directionDraft(shape,next));setError(null);
 }

 function applyDirection(){
  if(!changed)return;
  const direction={x:Number(draft.x),y:Number(draft.y),z:Number(draft.z)};
  if(AXES.some(component=>!draft[component].trim()||!Number.isFinite(direction[component]))){setError('Enter three finite direction values.');return}
  if(Math.hypot(direction.x,direction.y,direction.z)<=1e-8){setError('A direction needs at least one non-zero value.');return}
  try{
   const patch=orientShapeToward(shape,direction,axis);
   if(patch.rx!==shape.rx||patch.ry!==shape.ry||patch.rz!==shape.rz)onPatch(patch);
   setDraft(directionDraft({...shape,...patch},axis));setError(null);
  }catch(cause){setError(errorMessage(cause))}
 }

 function handleDirectionKey(event:KeyboardEvent<HTMLInputElement>){
  if(event.key==='Enter'){event.preventDefault();event.stopPropagation();applyDirection()}
  else if(event.key==='Escape'){event.preventDefault();event.stopPropagation();setDraft(directionDraft(shape,axis));setError(null);event.currentTarget.blur()}
 }

 return <section className={styles.section} aria-label="Orient shape by direction">
  <div className={styles.heading}>Orient by direction</div>
  <div className={styles.axisRow}><span>Local axis</span><div className={styles.axisButtons} role="group" aria-label="Local axis to orient">{AXES.map(component=><button type="button" key={component} aria-pressed={component===axis} aria-label={`Orient local ${component.toUpperCase()} axis`} onClick={()=>selectAxis(component)}>{component.toUpperCase()}</button>)}</div></div>
  <div className={styles.directionFields} role="group" aria-label="World direction components" aria-describedby={helpId}>
   {AXES.map(component=><label key={component}><span>{component.toUpperCase()}</span><input type="number" step="any" aria-label={`World direction ${component.toUpperCase()}`} aria-invalid={error?true:undefined} aria-describedby={error?`${helpId} ${errorId}`:helpId} value={draft[component]} onChange={event=>{const value=event.target.value;setDraft(previous=>({...previous,[component]:value}));setError(null)}} onKeyDown={handleDirectionKey}/></label>)}
  </div>
  <button type="button" className={styles.applyButton} disabled={!changed} onClick={applyDirection}>Apply direction</button>
  <p className={styles.help} id={helpId}>Aim local {axis.toUpperCase()} along this world vector. Only rotation changes; vector length does not matter.</p>
  {error&&<p className={styles.error} id={errorId} role="alert">{error}</p>}
 </section>;
}

function directionDraft(shape:FormShape,axis:Axis):DirectionDraft{
 const direction=shapeAxisDirection(shape,axis);
 return {x:format(direction.x),y:format(direction.y),z:format(direction.z)};
}
