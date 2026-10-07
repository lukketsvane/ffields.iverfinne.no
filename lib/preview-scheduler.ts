import type {FormModel,MeshData} from './form-engine.ts';
import type {MeshRefinementOptions} from './mesh-refinement.ts';

export type PreviewQuality={mobile:boolean;editing:boolean;previous?:{resolution:number;milliseconds:number}};
export type PreviewStage='draft'|'settled';
export type ScheduledPreview={geometry:string;stage:PreviewStage};

/** Focus/gesture state is not geometry. Opening a tool or releasing an
 * unchanged grip must never replace an already fine surface with a draft.
 * Every new geometry snapshot starts with a bounded draft. The displayed
 * draft completes before its expensive refinement starts. */
export function previewUpdateStage(previous:ScheduledPreview|undefined,geometry:string,editing:boolean):PreviewStage|undefined{
 if(previous?.geometry===geometry)return previous.stage==='draft'&&!editing?'settled':undefined;
 return 'draft';
}

/** Numeric focus can remain active indefinitely. Silence between geometry
 * changes still promotes the latest draft without waiting for blur/release. */
export function previewNeedsSettle(previous:ScheduledPreview|undefined,geometry:string):boolean{
 return previous?.geometry===geometry&&previous.stage==='draft';
}

/** Automatically resolve curved display patches after interaction. Drafts
 * remain cheap; this changes neither the document nor export settings. Shared
 * worker/fallback policy keeps cancellation and topology guards identical. */
export function previewRefinement(draft:boolean,pixelsPerUnit?:number):MeshRefinementOptions|undefined{
 // Display refinement follows magnification in bounded buckets. Zooming out
 // retains finer geometry; authored fields are never quantized to this grid.
 const tolerance=Number.isFinite(pixelsPerUnit)&&pixelsPerUnit! >17.5 ? .01 : Number.isFinite(pixelsPerUnit)&&pixelsPerUnit! >8.75 ? .02 : .04;
 return draft?undefined:{tolerance,maxPasses:3,maxTriangles:350000};
}

/** A single bounded retry for a severely unresolved complex patch. Merely
 * reaching a pass limit or having a tiny crease residual cannot trigger it.
 * Each independent solid is checked separately, so a body retry cannot spend
 * another dense grid on an already accurate lens plate. */
export function previewDetailResolution(mesh:MeshData,resolution:number):number|undefined{
 const r=mesh.refinement;
 return resolution<164&&r?.qualityLimited&&r.maxFaceResidualAfter>.15&&r.meanFaceResidualAfter>.004?164:undefined;
}

/** Bound preview sampling effort by the active evaluator complexity. This is
 * a display policy, not export accuracy, geometry simplification or a promise
 * that fine shell/lattice features will be represented by the draft grid. */
export function previewResolution(model:FormModel,quality:PreviewQuality):number{
 let cost=model.baseEnabled===false?1:2;
 for(const shape of model.shapes??[]){if(!shape.enabled)continue;cost+=shape.kind==='sweep'?4+Math.log2(Math.max(2,(shape.path?.length??2)*8)):1;}
 for(const field of model.influences)if(field.enabled&&field.kind!=='wave'&&field.strength!==0)cost+=2;
 if(model.lattice?.enabled)cost+=6;
 const ceiling=quality.editing?(quality.mobile?32:40):(quality.mobile?96:128),floor=quality.editing?(quality.mobile?20:24):(quality.mobile?64:80);
 let resolution=ceiling/Math.cbrt(Math.max(1,cost/(quality.editing?8:12)));
 // A real completed preview may lower later draft effort. Settled previews
 // retain their independent floor; an expensive draft cannot poison export.
 const previous=quality.previous;
 if(quality.editing&&previous&&Number.isFinite(previous.milliseconds)&&previous.milliseconds>0&&Number.isFinite(previous.resolution)&&previous.resolution>0){
  const target=quality.mobile?70:50;
  resolution=Math.min(resolution,previous.resolution*Math.cbrt(target/previous.milliseconds));
 }
 return Math.max(floor,Math.min(ceiling,Math.round(resolution/4)*4));
}

/** One active task plus one replacement. Invalidating immediately (before a
 * debounce dispatch) prevents an older settled mesh overwriting current input.
 * A worker already executing is not cancelled by this queue: only its result
 * is rejected. The cooperative fallback can additionally abort its task. */
export class LatestPreviewScheduler<Job extends {id:number}>{
 private latest=0;
 private active:Job|undefined;
 private pending:Job|undefined;
 private paused=false;
 private disposed=false;

 get current(){return this.active;}
 get waiting(){return this.pending;}
 get latestId(){return this.latest;}

 invalidate(id:number):void{
  if(this.disposed||id<this.latest)return;
  this.latest=id;
  if(this.pending&&this.pending.id!==id)this.pending=undefined;
 }
 enqueue(job:Job):Job|undefined{
  if(this.disposed||job.id<this.latest)return;
  this.invalidate(job.id);
  this.pending=job;
  return this.take();
 }
 finish(id:number):{accept:boolean;next?:Job}{
  // A duplicate/wrong response cannot release a different active task.
  if(this.disposed||this.active?.id!==id)return {accept:false};
  this.active=undefined;
  const accept=id===this.latest,next=this.take();
  return {accept,...(next?{next}:{})};
 }
 pause():void{this.paused=true;}
 resume():Job|undefined{this.paused=false;return this.take();}
 /** Worker failure: rerun only the newest queued/current snapshot. */
 restart():Job|undefined{
  if(this.disposed)return;
  const job=this.pending??(this.active?.id===this.latest?this.active:undefined);
  this.active=undefined;this.pending=job;return this.take();
 }
 dispose():void{this.disposed=true;this.active=undefined;this.pending=undefined;}
 private take():Job|undefined{
  if(this.disposed||this.paused||this.active||!this.pending)return;
  const job=this.pending;this.pending=undefined;
  if(job.id!==this.latest)return;
  this.active=job;return job;
 }
}
