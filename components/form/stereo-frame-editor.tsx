"use client";

import {useId,useState} from 'react';
import type {KeyboardEvent} from 'react';
import {STEREO_CAMERA_PARAMETER_LIMITS} from '@/lib/stereo-camera-study';
import type {StereoCameraStudyParameters} from '@/lib/stereo-camera-study';
import styles from './stereo-frame-editor.module.css';

const fields = [
 ['cameraWidth','Camera width'],['cameraHeight','Camera height'],['cameraDepth','Camera depth'],
 ['baseline','Centre spacing'],['clearance','Clearance per side'],['wall','Wall scale'],
] as const;
type Props={parameters:StereoCameraStudyParameters;onRebuild:(parameters:StereoCameraStudyParameters)=>void;onSave:()=>void};
type FieldKey=typeof fields[number][0];
type FieldError={message:string;field?:FieldKey};

export function StereoFrameEditor(props:Props){
 return <Editor key={JSON.stringify(props.parameters)} {...props}/>;
}
function Editor({parameters,onRebuild,onSave}:Props){
 const initial=Object.fromEntries(fields.map(([key])=>[key,String(Math.round(parameters[key]*1e6)/1e6)])) as Record<typeof fields[number][0],string>;
 const [draft,setDraft]=useState(initial),[error,setError]=useState<FieldError|null>(null);
 const errorId=useId(),helpId=useId();
 function rebuild(){
  const next={...parameters};
  for(const [key,label] of fields){
   const raw=draft[key].trim(),value=Number(raw.replace(',','.')),[min,max]=STEREO_CAMERA_PARAMETER_LIMITS[key];
   if(!raw||!Number.isFinite(value)||value<min||value>max){setError({field:key,message:`${label} must be between ${min} and ${max} mm.`});return}
   next[key]=value;
  }
  const minimum=next.cameraWidth+2*next.clearance+2*next.wall+2;
  if(next.baseline<minimum){setError({field:'baseline',message:`Centre spacing must be at least ${minimum.toFixed(1)} mm for separate camera shoulders.`});return}
  try{
   onRebuild(next);setError(null);
  }catch(cause){setError({message:cause instanceof Error?cause.message:'The frame could not be rebuilt.'})}
 }
 function keyDown(event:KeyboardEvent<HTMLInputElement>){
  if(event.key==='Enter'){event.preventDefault();event.stopPropagation();rebuild()}
  if(event.key==='Escape'){event.preventDefault();event.stopPropagation();setDraft(initial);setError(null);event.currentTarget.blur()}
 }
 return <section className={styles.panel} aria-label="Stereo frame dimensions">
  <h2>Stereo frame</h2>
  <p>Two camera envelopes, open front and rear, curved bridges and a central mount.</p>
  <div className={styles.fields}>{fields.map(([key,label])=>{const invalid=error?.field===key;return <label key={key}>{label}<span><input type="text" aria-label={label} aria-invalid={invalid||undefined} aria-describedby={invalid?`${helpId} ${errorId}`:helpId} inputMode="decimal" autoComplete="off" spellCheck={false} value={draft[key]} onChange={event=>{setDraft(previous=>({...previous,[key]:event.target.value}));setError(null)}} onKeyDown={keyDown}/><small>mm</small></span></label>})}</div>
  <button type="button" onClick={rebuild}>Rebuild stereo frame</button>
  {error&&<p className={styles.error} id={errorId} role="alert">{error.message}</p>}
  <p>Rebuild replaces the named construction. Undo restores your edits; save an alternative to keep them.</p>
  <button type="button" onClick={onSave}>Save current alternative</button>
  <p id={helpId}>Centre spacing measures camera envelopes, not optical axes. Measure your cameras before checking fit.</p>
 </section>;
}
