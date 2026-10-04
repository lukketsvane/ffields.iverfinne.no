"use client";
import {useEffect,useState} from 'react';
import {Pause,Play,Waves,SlidersHorizontal} from 'lucide-react';
export function CanvasControls({playing,onToggle,color,onSettings}:{playing:boolean;onToggle:()=>void;color:string;onSettings:()=>void}){
 return <div className="canvas-controls"><button className={'ripple-toggle '+(playing?'playing':'')} aria-label={playing?'Pause ripple':'Animate ripple'} aria-pressed={playing} onClick={onToggle}><Waves size={15}/><span>Ripple</span>{playing?<Pause size={12} fill="currentColor"/>:<Play size={12} fill="currentColor"/>}</button><button className="canvas-color-button" aria-label="Canvas settings" onClick={onSettings}><i style={{background:color}}/><SlidersHorizontal size={12}/></button></div>
}
export function CanvasSettings({color,onColor}:{color:string;onColor:(color:string|null)=>void}){
 const [draft,setDraft]=useState(color);useEffect(()=>setDraft(color),[color]);
 return <div className="canvas-settings"><div className="settings-label">Background</div><div className="background-swatches">{['#252528','#f2f1ed','#ffffff','#171a20','#d8dfe2'].map(c=><button key={c} title={c} aria-label={'Background '+c} aria-pressed={color===c} style={{background:c}} onClick={()=>onColor(c)}/>)}</div><div className="custom-background"><label className="color-input" title="Choose a custom colour"><input type="color" aria-label="Custom canvas color" value={color} onChange={e=>onColor(e.target.value)}/></label><input aria-label="Canvas color hex" value={draft} maxLength={7} spellCheck={false} onChange={e=>{setDraft(e.target.value);if(/^#[0-9a-f]{6}$/i.test(e.target.value))onColor(e.target.value)}} onBlur={()=>setDraft(color)}/></div><button className="reset-background" onClick={()=>onColor(null)}>Reset background</button></div>
}
