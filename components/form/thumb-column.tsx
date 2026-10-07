"use client";
import {useEffect,useRef,useState} from 'react';
import type {PointerEvent as ReactPointerEvent} from 'react';
import {Box,Circle,Cylinder,Pill,Donut,Spline,Plus,Minus,Undo2,Redo2,SlidersHorizontal,Copy,Trash2,Eye,Ellipsis} from 'lucide-react';
import type {LucideIcon} from 'lucide-react';
import type {ShapeKind,ShapeOperation} from '@/lib/shapes';

type Primitive={kind:ShapeKind;label:string;icon:LucideIcon};
export const PRIMITIVES:readonly Primitive[]=[{kind:'box',label:'Box',icon:Box},{kind:'sphere',label:'Ellipsoid',icon:Circle},{kind:'cylinder',label:'Cylinder',icon:Cylinder},{kind:'capsule',label:'Capsule',icon:Pill},{kind:'torus',label:'Ring',icon:Donut},{kind:'sweep',label:'Curve',icon:Spline}];
const CUTS=PRIMITIVES.filter(item=>item.kind!=='sweep');
const HOLD_MS=240,ITEM=48,SLIDE_OPEN=14,DOZE_MS=2000;
const stored=(key:string,fallback:ShapeKind):ShapeKind=>{try{const value=localStorage.getItem(key);return PRIMITIVES.some(p=>p.kind===value)?value as ShapeKind:fallback}catch{return fallback}};

/** Tap places the current primitive. Hold, or slide left, opens the strip:
 * the finger chooses on its way and the release places that one. Releasing
 * back over the button, or far from the strip, places nothing. */
function ShapeButton({operation,disabled,onPlace}:{operation:ShapeOperation;disabled:boolean;onPlace:(kind:ShapeKind,operation:ShapeOperation)=>void}){
 const items=operation==='subtract'?CUTS:PRIMITIVES,storeKey='ffields-'+operation+'-kind';
 const [kind,setKind]=useState<ShapeKind>(operation==='subtract'?'sphere':'box'),[open,setOpen]=useState(false),[hot,setHot]=useState<number|null>(null);
 const press=useRef<{id:number;x:number;y:number;timer:number;open:boolean}|null>(null),strip=useRef<HTMLDivElement>(null);
 useEffect(()=>{const saved=stored(storeKey,kind);if(saved!==kind)queueMicrotask(()=>setKind(saved))},[storeKey,kind]);
 const current=items.find(item=>item.kind===kind)??items[0],Icon=current.icon;
 const pick=(x:number,y:number)=>{const box=strip.current?.getBoundingClientRect();if(!box||y<box.top-56||y>box.bottom+56||x>box.right)return null;const index=Math.floor((box.right-x)/ITEM);return index>=0&&index<items.length?index:null};
 const close=()=>{const p=press.current;if(p)clearTimeout(p.timer);press.current=null;setOpen(false);setHot(null)};
 const down=(e:ReactPointerEvent<HTMLButtonElement>)=>{if(disabled||press.current)return;e.currentTarget.setPointerCapture(e.pointerId);const p={id:e.pointerId,x:e.clientX,y:e.clientY,open:false,timer:0};p.timer=window.setTimeout(()=>{p.open=true;setOpen(true)},HOLD_MS);press.current=p};
 const move=(e:ReactPointerEvent<HTMLButtonElement>)=>{const p=press.current;if(!p||p.id!==e.pointerId)return;if(!p.open&&p.x-e.clientX>SLIDE_OPEN){clearTimeout(p.timer);p.open=true;setOpen(true)}if(p.open)setHot(pick(e.clientX,e.clientY))};
 const up=(e:ReactPointerEvent<HTMLButtonElement>)=>{
  const p=press.current;if(!p||p.id!==e.pointerId)return;
  const opened=p.open,index=opened?pick(e.clientX,e.clientY):null,still=Math.hypot(e.clientX-p.x,e.clientY-p.y)<12;close();
  if(!opened){if(still)onPlace(kind,operation);return}
  if(index===null)return;
  const chosen=items[index].kind;setKind(chosen);try{localStorage.setItem(storeKey,chosen)}catch{}onPlace(chosen,operation);
 };
 return <div className="shape-slot">
  {open&&<div className="shape-flyout" ref={strip} role="listbox" aria-label={operation==='subtract'?'Cut shapes':'Add shapes'}>
   {items.map((item,index)=><span key={item.kind} role="option" aria-selected={hot===index} aria-label={item.label} data-hot={hot===index?'':undefined}><item.icon size={21}/></span>)}
   {hot!==null&&<b className="flyout-label">{(operation==='subtract'?'Cut ':'Add ')+items[hot].label.toLowerCase()}</b>}
  </div>}
  <button type="button" className={'thumb'+(operation==='union'?' primary':'')} disabled={disabled} aria-label={(operation==='subtract'?'Cut with ':'Add ')+current.label.toLowerCase()+'. Hold and slide left for other shapes.'} onPointerDown={down} onPointerMove={move} onPointerUp={up} onPointerCancel={close} onContextMenu={e=>e.preventDefault()}>
   <Icon size={operation==='union'?24:21}/><i className="badge">{operation==='subtract'?<Minus size={10} strokeWidth={3}/>:<Plus size={10} strokeWidth={3}/>}</i>
  </button>
 </div>;
}

/** Two seconds without a finger and the column fades, while nothing is selected or open. */
function useDoze(enabled:boolean){
 const [asleep,setAsleep]=useState(false);
 useEffect(()=>{
  if(!enabled)return;
  let timer=window.setTimeout(()=>setAsleep(true),DOZE_MS);
  const wake=()=>{setAsleep(false);clearTimeout(timer);timer=window.setTimeout(()=>setAsleep(true),DOZE_MS)};
  const names=['pointerdown','pointermove','wheel','keydown'] as const;
  for(const name of names)window.addEventListener(name,wake,{capture:true,passive:true});
  return()=>{clearTimeout(timer);for(const name of names)window.removeEventListener(name,wake,true);queueMicrotask(()=>setAsleep(false))};
 },[enabled]);
 return enabled&&asleep;
}

function Tool({icon:Icon,label,onClick,disabled=false,danger=false}:{icon:LucideIcon;label:string;onClick:()=>void;disabled?:boolean;danger?:boolean}){
 return <button type="button" className={'thumb'+(danger?' danger':'')} aria-label={label} title={label} disabled={disabled} onClick={onClick}><Icon size={20}/></button>;
}

type Props={
 selection:'shape'|'asset'|'field'|'base'|null;canCut:boolean;full:boolean;canUndo:boolean;canRedo:boolean;rest:boolean;
 onPlace:(kind:ShapeKind,operation:ShapeOperation)=>void;onUndo:()=>void;onRedo:()=>void;onEdit:()=>void;onDuplicate:()=>void;onDelete:()=>void;onView:()=>void;onMore:()=>void;
};
export function ThumbColumn(props:Props){
 const asleep=useDoze(props.rest),{selection}=props;
 return <nav className="thumb-column" aria-label="Modelling tools" data-asleep={asleep?'':undefined}>
  <Tool icon={Ellipsis} label="More" onClick={props.onMore}/>
  <Tool icon={Eye} label="View" onClick={props.onView}/>
  {selection&&<i className="thumb-gap"/>}
  {selection&&<Tool icon={SlidersHorizontal} label="Edit selection" onClick={props.onEdit}/>}
  {selection==='shape'&&<Tool icon={Copy} label="Duplicate selection" disabled={props.full} onClick={props.onDuplicate}/>}
  {(selection==='shape'||selection==='asset'||selection==='field')&&<Tool icon={Trash2} label="Delete selection" danger onClick={props.onDelete}/>}
  <i className="thumb-gap"/>
  {props.canRedo&&<Tool icon={Redo2} label="Redo" onClick={props.onRedo}/>}
  <Tool icon={Undo2} label="Undo" disabled={!props.canUndo} onClick={props.onUndo}/>
  <ShapeButton operation="subtract" disabled={!props.canCut||props.full} onPlace={props.onPlace}/>
  <ShapeButton operation="union" disabled={props.full} onPlace={props.onPlace}/>
 </nav>;
}
