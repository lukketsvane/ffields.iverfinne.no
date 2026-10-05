"use client";
import type {MeshAudit} from '@/lib/mesh-audit';
import type {MeshRefinementStats} from '@/lib/mesh-refinement';
import type {MeshSamplingStats} from '@/lib/mesh-sampling';
import type {ComponentFitAudit} from '@/lib/component-fit';
import styles from './mesh-inspector.module.css';

export type MeshCheckResult={audit:MeshAudit;refinement?:MeshRefinementStats;sampling?:MeshSamplingStats;componentFit?:ComponentFitAudit;milliseconds:number};
type Props={fileURL?:string;refine:boolean;onRefine:(value:boolean)=>void;result:MeshCheckResult|null;busy:boolean;exporting:boolean;onCheck:()=>void;onCancel:()=>void;onExport:()=>void;error:string;onInspectComponent?:(id:string)=>void};
export function MeshInspector({fileURL,refine,onRefine,result,busy,exporting,onCheck,onCancel,onExport,error,onInspectComponent}:Props){
 const audit=result?.audit,stats=result?.refinement,sampling=result?.sampling,componentFit=result?.componentFit;
 const hasComponentChecks=!!componentFit?.components.length;
 const clean=audit&&audit.triangles>0&&audit.finite&&audit.invalidIndices===0&&audit.degenerateTriangles===0&&audit.boundaryEdges===0&&audit.nonManifoldEdges===0&&audit.inconsistentWindingEdges===0;
 return <section className={styles.panel} aria-label="Mesh quality and connectivity">
  <div className={styles.heading}>Export detail</div>
  <div className={styles.modes} role="group" aria-label="Export surface detail">
   <button type="button" disabled={busy||exporting} aria-pressed={!refine} onClick={()=>onRefine(false)}>Standard</button>
   <button type="button" disabled={busy||exporting} aria-pressed={refine} onClick={()=>onRefine(true)}>Refined</button>
  </div>
  <p className={styles.help}>{refine?'Adds triangles where curved surfaces need more detail. Small corners may still need finer sampling.':'Uses the full export grid and aligns sampling to eligible flat box faces. Refined adds local surface detail.'}</p>
  <div className={styles.actions}><button type="button" disabled={busy||exporting} onClick={onCheck}>{busy?'Checking…':'Check export mesh'}</button><button type="button" disabled={busy||exporting} onClick={onExport}>{exporting?'Exporting…':'Export STL'}</button></div>
  {fileURL&&<a className={styles.download} href={fileURL} download="form-study-mm.stl">Download prepared STL</a>}
  {busy&&<button type="button" className={styles.cancel} onClick={onCancel}>Cancel check</button>}
  {error&&<p className={styles.error} role="alert">{error}</p>}
  {audit&&<div className={styles.report} aria-live="polite">
   <div className={styles.result}>{clean?'Closed, consistent edges':audit.triangles?'Mesh needs review':'No solid in this mesh'}</div>
   {hasComponentChecks&&<ComponentFitReport audit={componentFit!} onInspectComponent={onInspectComponent}/>}
   {hasComponentChecks&&<div className={styles.measurementsHeading}>Mesh measurements</div>}
   <dl>
    <dt>Dimensions</dt><dd>{audit.dimensions.map(value=>value.toFixed(1)).join(' × ')} mm</dd>
    {sampling&&<><dt>Largest grid step</dt><dd>{Math.max(...sampling.maxSpacing).toFixed(3)} mm</dd><dt>Aligned face planes</dt><dd>{sampling.addedPlanes.reduce((sum,n)=>sum+n,0)}{sampling.budgetLimited?' · budget reached':''}</dd></>}
    <dt>Triangles</dt><dd>{audit.triangles.toLocaleString('en-US')}</dd>
    <dt>Connected pieces</dt><dd>{audit.components}</dd>
    <dt>Open edges</dt><dd>{audit.boundaryEdges}</dd>
    <dt>Nonmanifold edges</dt><dd>{audit.nonManifoldEdges}</dd>
    <dt>Winding conflicts</dt><dd>{audit.inconsistentWindingEdges}</dd>
    {!!audit.degenerateTriangles&&<><dt>Collapsed triangles</dt><dd>{audit.degenerateTriangles}</dd></>}
    {(!audit.finite||!!audit.invalidIndices)&&<><dt>Invalid geometry</dt><dd>{!audit.finite?'Nonfinite values':`${audit.invalidIndices} indices`}</dd></>}
    <dt>Volume</dt><dd>{(audit.volume/1000).toFixed(1)} cm³</dd>
    <dt>Generation time</dt><dd>{(result!.milliseconds/1000).toFixed(1)} s</dd>
   </dl>
   {sampling?.quantizationLimited&&<p className={styles.help}>{sampling.featureAligned?'Sampling adjusted to avoid collapsed tiny faces; flat interface alignment retained.':'Sampling adjusted to avoid collapsed tiny faces. Ordinary sampling used; inspect small openings.'}</p>}
   {stats&&<p className={styles.help}>{stats.passes} refinement {stats.passes===1?'pass':'passes'} · {stats.inputTriangles.toLocaleString('en-US')} → {stats.outputTriangles.toLocaleString('en-US')} triangles{stats.budgetLimited?' · detail budget reached':''}{stats.qualityLimited?' · sharper corners need finer sampling':''}.</p>}
   {sampling&&<p className={styles.help}>Grid spacing describes sampling, not fit tolerance. Thin walls and small openings need geometry checks.</p>}
   <p className={styles.help}>{hasComponentChecks?'Triangle connections and component interference are checked separately. Surface self-intersections and material strength need further checks.':'Measurements describe the captured export frame. Checks triangle connections; intersections and material strength need separate checks.'}</p>
  </div>}
  {!audit&&!busy&&!error&&<p className={styles.help}>Check the current construction before exporting. Editing the model clears this result.</p>}
 </section>;
}

type FitStatus=ComponentFitAudit['components'][number]['status'];
const FIT_LABELS:Record<FitStatus,string>={clear:'Clear',interference:'Interference',unverified:'Unverified'};
const fitValue=(value:number)=>String(Math.round(value*1e6)/1e6);
const fitDimensions=(values:readonly number[])=>values.map(fitValue).join(' × ')+' mm';
const fitStatusClass=(status:FitStatus)=>status==='clear'?styles.fitClear:status==='interference'?styles.fitInterference:styles.fitUnverified;

function ComponentFitReport({audit,onInspectComponent}:{audit:ComponentFitAudit;onInspectComponent?:Props['onInspectComponent']}){
 const interference=audit.components.some(component=>component.status==='interference'),unverified=audit.components.some(component=>component.status==='unverified');
 const summary=interference?'Component interference found':unverified?'Component checks need review':'Component envelopes clear';
 const order:Record<FitStatus,number>={interference:0,unverified:1,clear:2};
 const components=[...audit.components].sort((a,b)=>order[a.status]-order[b.status]);
 return <section className={styles.fitReport} aria-label="Component checks in captured export mesh">
  <div className={styles.fitHeading}>Captured component checks</div>
  <div className={`${styles.fitSummary} ${interference?styles.fitInterference:unverified?styles.fitUnverified:styles.fitClear}`}>{summary}</div>
  {!audit.meshVerified&&<p className={styles.fitNotice}>Mesh connections need review; component results are unverified.</p>}
  <p className={styles.help}>Sampling allowance: {fitValue(audit.samplingAllowance)} mm, subtracted from linked clearance. Values below are the envelope and clearance tested in this export mesh. Physical fit is unverified.</p>
  <div className={styles.fitComponents}>
   {components.map(component=><article className={`${styles.fitComponent} ${component.status==='clear'?'':styles.fitComponentIssue}`} key={component.assetId} aria-label={`${component.name} component check`}>
    <div className={styles.fitComponentHeading}><span>{component.name}{!component.visible&&<small>Hidden reference · included in check</small>}</span>{onInspectComponent&&<button type="button" aria-label={`Inspect component ${component.name}`} onClick={()=>onInspectComponent(component.assetId)}>Inspect</button>}</div>
    <dl className={styles.fitDetails}>
     <dt>Envelope X/Y/Z</dt><dd>{fitDimensions(component.envelope)}</dd>
     <dt>Tested per side X/Y/Z</dt><dd>{fitDimensions(component.testedClearance)}</dd>
     <dt>Seat</dt><dd><span className={fitStatusClass(component.seat.status)}>{FIT_LABELS[component.seat.status]}</span></dd>
     {component.insertion&&<><dt>Local insertion</dt><dd>{component.insertion.direction===1?'+':'−'}{component.insertion.axis.toUpperCase()} · {fitValue(component.insertion.travel)} mm travel<span className={`${styles.fitInsertionStatus} ${fitStatusClass(component.insertion.status)}`}>{FIT_LABELS[component.insertion.status]}</span></dd></>}
    </dl>
   </article>)}
  </div>
 </section>;
}
