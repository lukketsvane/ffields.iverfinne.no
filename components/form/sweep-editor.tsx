"use client";

import {useCallback,useEffect,useId,useMemo,useRef,useState} from 'react';
import type {KeyboardEvent,PointerEvent} from 'react';
import {Focus,Plus,Trash2} from 'lucide-react';
import {makeShape,sweepFrames,sweepSamples,SWEEP_LIMITS} from '@/lib/shapes';
import type {FormShape,SweepPoint} from '@/lib/shapes';
import {fitSweepProjection,projectedSectionJoin,projectSweepSection,SKETCH_PLANES} from './sweep-projection';
import type {SketchBounds,SketchPlane} from './sweep-projection';
import {insertSweepControl,removeSweepControl,setSweepClosure,validateEditedSweepPath} from './sweep-path-edit';

type Plane=SketchPlane;
type Bounds=SketchBounds;
type SweepEditorProps={shape:FormShape;begin:()=>void;end:()=>void;change:(patch:Partial<FormShape>,liveEdit?:boolean)=>void};
type Drag={kind:'pointer';pointerId:number;index:number;points:SweepPoint[];plane:Plane;offsetX:number;offsetY:number};
type Nudge={kind:'keyboard';index:number;points:SweepPoint[];keys:Set<string>};
const PLANES=SKETCH_PLANES;
const DEFAULT_PATH=makeShape('sweep').path!;
const clamp=(value:number,min:number,max:number)=>Math.max(min,Math.min(max,value));
const format=(value:number)=>String(Math.round(value*10)/10);
const clonePoints=(points:readonly SweepPoint[])=>points.map(point=>({...point}));
const project=(point:SweepPoint,plane:Plane)=>{const [horizontal,vertical]=PLANES[plane];return {x:point[horizontal],y:-point[vertical],radius:point.radius}};

/** Coordinates stay local to the sweep; changing this sketch never fits the 3D camera. */
export function SweepEditor(props:SweepEditorProps){
 return <SweepEditorContent key={props.shape.id} {...props}/>;
}

function SweepEditorContent({shape,begin,end,change}:SweepEditorProps){
 const points=shape.path?.length?shape.path:DEFAULT_PATH;
 const closed=shape.closed===true,minimumPoints=closed?3:SWEEP_LIMITS.pathPoints[0];
 const samples=useMemo(()=>shape.path?.length?sweepSamples(shape):points,[shape,points]);
 const frames=useMemo(()=>shape.path?.length?sweepFrames(shape):[],[shape]);
 const [plane,setPlane]=useState<Plane>('xy');
 const depthRatio=shape.depthRatio??1,verticalScale=plane==='xy'?1:depthRatio,transported=shape.sectionMode==='transported';
 const [selected,setSelected]=useState(0);
 const [error,setError]=useState<{message:string;location:'topology'|'path'}|null>(null);
 const [bounds,setBounds]=useState<Bounds>(()=>fitSweepProjection(samples.map((sample,index)=>projectSweepSection(sample,'xy',depthRatio,frames[index]))));
 const gesture=useRef<Drag|Nudge|null>(null);
 const svgRef=useRef<SVGSVGElement>(null);
 const helpId=useId(),topologyHelpId=useId(),errorId=useId();
 const pointIndex=Math.min(selected,points.length-1),point=points[pointIndex];
 const [horizontal,vertical]=PLANES[plane];
 const projected=samples.map(sample=>project(sample,plane));
 const sections=samples.map((sample,index)=>projectSweepSection(sample,plane,depthRatio,frames[index]));
 const selectedFrame=frames[Math.round(pointIndex*(samples.length-1)/(closed?points.length:points.length-1))];
 const selectedSection=projectSweepSection(point,plane,depthRatio,selectedFrame);
 const pointRadius=bounds.size*.022;
 const gridStep=bounds.size>400?50:bounds.size>250?25:20;
 const gridX=Array.from({length:Math.ceil(bounds.size/gridStep)+1},(_,index)=>Math.ceil(bounds.x/gridStep)*gridStep+index*gridStep).filter(x=>x<=bounds.x+bounds.size);
 const gridY=Array.from({length:Math.ceil(bounds.size/gridStep)+1},(_,index)=>Math.ceil(bounds.y/gridStep)*gridStep+index*gridStep).filter(y=>y<=bounds.y+bounds.size);
 const centerline=projected.map((sample,index)=>`${index?'L':'M'}${sample.x},${sample.y}`).join(' ')+(closed?' Z':'');

 const finishGesture=useCallback(()=>{if(!gesture.current)return;gesture.current=null;end()},[end]);
 useEffect(()=>()=>finishGesture(),[finishGesture]);

 function pathError(cause:unknown,location:'topology'|'path'){
  setError({message:cause instanceof Error?cause.message:'The curve could not be changed.',location});
 }

 function applyPath(path:SweepPoint[],liveEdit=false){
  try{validateEditedSweepPath(path,closed);change({path},liveEdit);setError(null);return true}catch(cause){pathError(cause,'path');return false}
 }

 function changeTopology(next:boolean){
  if(next===closed)return;
  finishGesture();
  try{
   const patch=setSweepClosure({...shape,path:points},next);
   change(patch);setError(null);
   if(patch.path!.length<points.length)setSelected(index=>index>=patch.path!.length?0:index);
  }catch(cause){pathError(cause,'topology')}
 }

 function localPointer(event:PointerEvent<SVGCircleElement>){
  const svg=svgRef.current,matrix=svg?.getScreenCTM();
  if(!svg||!matrix)return null;
  const position=svg.createSVGPoint();position.x=event.clientX;position.y=event.clientY;
  return position.matrixTransform(matrix.inverse());
 }

 function startDrag(event:PointerEvent<SVGCircleElement>,index:number){
  if(gesture.current||!event.isPrimary||event.button!==0)return;
  const position=localPointer(event);if(!position)return;
  event.preventDefault();event.stopPropagation();
  const projectedPoint=project(points[index],plane);
  event.currentTarget.focus();event.currentTarget.setPointerCapture(event.pointerId);
  setSelected(index);begin();
  gesture.current={kind:'pointer',pointerId:event.pointerId,index,points:clonePoints(points),plane,offsetX:projectedPoint.x-position.x,offsetY:projectedPoint.y-position.y};
 }

 function moveDrag(event:PointerEvent<SVGCircleElement>){
  const drag=gesture.current;if(drag?.kind!=='pointer'||drag.pointerId!==event.pointerId)return;
  const position=localPointer(event);if(!position)return;
  event.preventDefault();event.stopPropagation();
  const [h,v]=PLANES[drag.plane],path=clonePoints(drag.points);
  path[drag.index][h]=Math.round(clamp(position.x+drag.offsetX,...SWEEP_LIMITS.coordinate)*10)/10;
  path[drag.index][v]=Math.round(clamp(-position.y-drag.offsetY,...SWEEP_LIMITS.coordinate)*10)/10;
  applyPath(path,true);
 }

 function stopDrag(event:PointerEvent<SVGCircleElement>){
  const drag=gesture.current;if(drag?.kind!=='pointer'||drag.pointerId!==event.pointerId)return;
  event.preventDefault();event.stopPropagation();finishGesture();
  if(event.currentTarget.hasPointerCapture(event.pointerId))event.currentTarget.releasePointerCapture(event.pointerId);
 }

 function nudgePoint(event:KeyboardEvent<SVGCircleElement>,index:number){
  if(event.key==='Enter'||event.key===' '){event.preventDefault();event.stopPropagation();setSelected(index);return}
  if(!['ArrowLeft','ArrowRight','ArrowUp','ArrowDown'].includes(event.key)||event.ctrlKey||event.metaKey||event.altKey)return;
  event.preventDefault();event.stopPropagation();
  if(gesture.current?.kind==='pointer')return;
  if(gesture.current?.kind==='keyboard'&&gesture.current.index!==index)finishGesture();
  if(!gesture.current){begin();gesture.current={kind:'keyboard',index,points:clonePoints(points),keys:new Set()}}
  const keyboard=gesture.current;if(keyboard.kind!=='keyboard')return;
  keyboard.keys.add(event.key);setSelected(index);
  const axis=event.key==='ArrowLeft'||event.key==='ArrowRight'?horizontal:vertical;
  const direction=event.key==='ArrowLeft'||event.key==='ArrowDown'?-1:1;
  const path=clonePoints(keyboard.points);
  path[index][axis]=clamp(path[index][axis]+direction*(event.shiftKey?10:1),...SWEEP_LIMITS.coordinate);
  if(applyPath(path,true))keyboard.points=path;
 }

 function stopNudge(event:KeyboardEvent<SVGCircleElement>){
  const keyboard=gesture.current;if(keyboard?.kind!=='keyboard')return;
  keyboard.keys.delete(event.key);if(!keyboard.keys.size)finishGesture();
 }

 function insertPoint(){
  if(points.length>=SWEEP_LIMITS.pathPoints[1])return;
  finishGesture();
  try{const edit=insertSweepControl({...shape,path:points},pointIndex);if(applyPath(edit.path))setSelected(edit.selected)}catch(cause){pathError(cause,'path')}
 }

 function removePoint(){
  if(points.length<=minimumPoints)return;
  finishGesture();
  try{const edit=removeSweepControl({...shape,path:points},pointIndex);if(applyPath(edit.path))setSelected(edit.selected)}catch(cause){pathError(cause,'path')}
 }

 return <section className="sweep-editor" aria-label="Sweep path editor">
  <div className="sweep-editor-heading"><span>Curve path</span><small>Local · mm</small></div>
  <div className="sweep-topology-controls" role="group" aria-label="Curve topology" aria-describedby={topologyHelpId}>
   <button type="button" aria-pressed={!closed} onClick={()=>changeTopology(false)}>Open</button>
   <button type="button" aria-pressed={closed} onClick={()=>changeTopology(true)}>Closed</button>
  </div>
  <p className="sweep-topology-help" id={topologyHelpId}>{closed?'The last point joins the first. This loop has no endpoint attachments.':'Closed joins the last point to the first and removes endpoint links.'}</p>
  {error?.location==='topology'&&<p className="sweep-path-error" role="alert" id={errorId}>{error.message}</p>}
  <div className="sweep-plane-controls">
   <div className="sweep-plane-tabs" role="group" aria-label="Sketch plane">{(['xy','xz','yz'] as const).map(next=><button type="button" key={next} aria-pressed={plane===next} className={plane===next?'active':''} onClick={()=>{finishGesture();setPlane(next)}}>{next.toUpperCase()}</button>)}</div>
   <button type="button" className="sweep-fit" onClick={()=>{finishGesture();setBounds(fitSweepProjection(sections))}}><Focus size={14}/>Fit sketch</button>
  </div>
  <svg ref={svgRef} className="sweep-sketch" viewBox={`${bounds.x} ${bounds.y} ${bounds.size} ${bounds.size}`} role="group" aria-label={`${plane.toUpperCase()} sweep sketch, local millimetres`} aria-describedby={helpId}>
   <g className="sweep-grid" pointerEvents="none">{gridX.map(x=><path key={'x'+x} d={`M${x},${bounds.y} V${bounds.y+bounds.size}`} vectorEffect="non-scaling-stroke"/>)}{gridY.map(y=><path key={'y'+y} d={`M${bounds.x},${y} H${bounds.x+bounds.size}`} vectorEffect="non-scaling-stroke"/>)}</g>
   <g className="sweep-axes" pointerEvents="none"><path d={`M0,${bounds.y} V${bounds.y+bounds.size} M${bounds.x},0 H${bounds.x+bounds.size}`} vectorEffect="non-scaling-stroke"/></g>
   {transported?<g className="sweep-radius-preview" opacity=".16" fill="currentColor" pointerEvents="none">{sections.map((section,index)=>{const join=index?projectedSectionJoin(sections[index-1],section):null;return <g key={index}>{join&&<polygon points={join}/>}<ellipse cx={section.x} cy={section.y} rx={section.rx} ry={section.ry} transform={`rotate(${section.angle} ${section.x} ${section.y})`}/></g>})}</g>:<g className="sweep-radius-preview" transform={`scale(1 ${verticalScale})`} opacity=".16" fill="currentColor" pointerEvents="none">{projected.map((sample,index)=>{const previous=projected[index-1];return <g key={index}>{previous&&<path d={`M${previous.x},${previous.y/verticalScale} L${sample.x},${sample.y/verticalScale}`} stroke="currentColor" strokeWidth={previous.radius+sample.radius}/>}<circle cx={sample.x} cy={sample.y/verticalScale} r={sample.radius}/></g>})}</g>}
   <path className="sweep-control-polygon" d={points.map((control,index)=>{const projectedPoint=project(control,plane);return `${index?'L':'M'}${projectedPoint.x},${projectedPoint.y}`}).join(' ')+(closed?' Z':'')} fill="none" vectorEffect="non-scaling-stroke" pointerEvents="none"/>
   <path className="sweep-centerline" d={centerline} fill="none" vectorEffect="non-scaling-stroke" pointerEvents="none"/>
   {points.map((control,index)=>{const projectedPoint=project(control,plane),isSelected=index===pointIndex;return <g key={index} className={'sweep-point '+(isSelected?'selected':'')}>
    {isSelected&&<ellipse className="sweep-selected-radius" cx={projectedPoint.x} cy={projectedPoint.y} rx={selectedSection.rx} ry={selectedSection.ry} transform={`rotate(${selectedSection.angle} ${projectedPoint.x} ${projectedPoint.y})`} fill="none" vectorEffect="non-scaling-stroke" pointerEvents="none"/>}
    <circle className="sweep-point-handle" cx={projectedPoint.x} cy={projectedPoint.y} r={pointRadius} vectorEffect="non-scaling-stroke" pointerEvents="none"/>
    <text className="sweep-point-label" x={projectedPoint.x} y={projectedPoint.y} textAnchor="middle" dominantBaseline="central" fontSize={bounds.size*.032} pointerEvents="none">{index+1}</text>
    <circle className="sweep-point-hit" cx={projectedPoint.x} cy={projectedPoint.y} r={bounds.size*.09} fill="transparent" role="button" tabIndex={0} aria-pressed={isSelected} aria-label={`Point ${index+1}: ${horizontal.toUpperCase()} ${format(control[horizontal])}, ${vertical.toUpperCase()} ${format(control[vertical])} millimetres. Arrow keys move; shift moves 10 millimetres.`} onFocus={()=>setSelected(index)} onPointerDown={event=>startDrag(event,index)} onPointerMove={moveDrag} onPointerUp={stopDrag} onPointerCancel={stopDrag} onLostPointerCapture={event=>{if(gesture.current?.kind==='pointer'&&gesture.current.pointerId===event.pointerId)finishGesture()}} onKeyDown={event=>nudgePoint(event,index)} onKeyUp={stopNudge} onBlur={()=>{if(gesture.current?.kind==='keyboard')finishGesture()}}/>
   </g>})}
  </svg>
  <div className="sweep-sketch-caption"><span>{horizontal.toUpperCase()} → {format(bounds.x)}…{format(bounds.x+bounds.size)} mm</span><span>{vertical.toUpperCase()} ↑ {format(-bounds.y-bounds.size)}…{format(-bounds.y)} mm</span></div>
  <div className="sweep-point-list" role="group" aria-label="Select path point">{points.map((_,index)=><button type="button" key={index} className={index===pointIndex?'active':''} aria-pressed={index===pointIndex} aria-label={`Select point ${index+1}`} onClick={()=>{finishGesture();setSelected(index)}}>{index+1}</button>)}</div>
  <div className="sweep-point-fields" role="group" aria-label={`Point ${pointIndex+1} local coordinates and radius`}>
   {(['x','y','z','radius'] as const).map(field=><PointNumber key={`${pointIndex}-${field}-${point[field]}`} label={field==='radius'?'Radius':field.toUpperCase()} value={point[field]} min={field==='radius'?SWEEP_LIMITS.radius[0]:SWEEP_LIMITS.coordinate[0]} max={field==='radius'?SWEEP_LIMITS.radius[1]:SWEEP_LIMITS.coordinate[1]} begin={()=>{finishGesture();begin()}} end={end} apply={value=>{const path=clonePoints(points);path[pointIndex][field]=value;return applyPath(path,true)}}/>) }
  </div>
  <div className="sweep-actions"><button type="button" onClick={insertPoint} disabled={points.length>=SWEEP_LIMITS.pathPoints[1]}><Plus size={14}/>Insert point</button><button type="button" onClick={removePoint} disabled={points.length<=minimumPoints} aria-label={`Remove point ${pointIndex+1}`}><Trash2 size={14}/>Remove</button><small>{points.length}/{SWEEP_LIMITS.pathPoints[1]}</small></div>
  {error?.location==='path'&&<p className="sweep-path-error" role="alert" id={errorId}>{error.message}</p>}
  <p className="sweep-help" id={helpId}>{transported?'Section preview follows the curve. ':'Section preview uses local Z depth. '}Drag a point in this plane; its other axis stays fixed. Coordinates ±240 mm; radius 1.5–40 mm.</p>
 </section>;
}

function PointNumber({label,value,min,max,begin,end,apply}:{label:string;value:number;min:number;max:number;begin:()=>void;end:()=>void;apply:(value:number)=>boolean}){
 const dirty=useRef(false),cancelled=useRef(false);
 return <label className="sweep-point-field"><span>{label}</span><div><input type="number" aria-label={`Point ${label} in millimetres`} inputMode={min<0?undefined:'decimal'} min={min} max={max} step={.1} defaultValue={format(value)} onFocus={()=>{dirty.current=false;cancelled.current=false;begin()}} onChange={()=>{dirty.current=true}} onBlur={event=>{const draft=event.currentTarget.value,parsed=Number(draft);if(dirty.current&&!cancelled.current&&draft.trim()&&Number.isFinite(parsed)){if(!apply(Math.round(clamp(parsed,min,max)*10)/10))event.currentTarget.value=format(value)}else event.currentTarget.value=format(value);end()}} onKeyDown={event=>{if(event.key==='Escape'){event.preventDefault();event.stopPropagation();cancelled.current=true;event.currentTarget.value=format(value)}if(event.key==='Enter'||event.key==='Escape'){event.preventDefault();event.stopPropagation();event.currentTarget.blur()}}}/><span>mm</span></div></label>;
}
