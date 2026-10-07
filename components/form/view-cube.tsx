"use client";
import {LockKeyhole,LockKeyholeOpen,Focus} from 'lucide-react';
import type {CameraView} from './viewport';
export function ViewCube({locked,onLock,onView,onFit}:{locked:boolean;onLock:()=>void;onView:(view:CameraView)=>void;onFit:()=>void}){
 return <div className="view-cube-control"><div className="view-cube-stage" aria-label="View cube"><div id="view-cube-orientation" className="view-cube">{(['front','back','left','right','top','bottom'] as const).map(face=><button key={face} className={'cube-face cube-'+face} disabled={locked} aria-label={'View '+face} onClick={()=>onView(face)}>{face}</button>)}</div></div><div className="view-cube-actions"><button onClick={()=>onView('perspective')} disabled={locked} aria-label="Perspective view">3D</button><button onClick={onFit} disabled={locked} aria-label="Fit model"><Focus size={16}/></button><button aria-label={locked?'Unlock view':'Lock view'} aria-pressed={locked} onClick={onLock}>{locked?<LockKeyhole size={16}/>:<LockKeyholeOpen size={16}/>}</button></div></div>
}
