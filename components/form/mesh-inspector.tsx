"use client";
import type {MeshAudit} from '@/lib/mesh-audit';
import type {MeshRefinementStats} from '@/lib/mesh-refinement';
import styles from './mesh-inspector.module.css';

export type MeshCheckResult={audit:MeshAudit;refinement?:MeshRefinementStats;milliseconds:number};
type Props={fileURL?:string;refine:boolean;onRefine:(value:boolean)=>void;result:MeshCheckResult|null;busy:boolean;exporting:boolean;onCheck:()=>void;onCancel:()=>void;onExport:()=>void;error:string};
export function MeshInspector({fileURL,refine,onRefine,result,busy,exporting,onCheck,onCancel,onExport,error}:Props){
 const audit=result?.audit,stats=result?.refinement;
 const clean=audit&&audit.triangles>0&&audit.finite&&audit.invalidIndices===0&&audit.degenerateTriangles===0&&audit.boundaryEdges===0&&audit.nonManifoldEdges===0&&audit.inconsistentWindingEdges===0;
 return <section className={styles.panel} aria-label="Mesh quality and connectivity">
  <div className={styles.heading}>Export detail</div>
  <div className={styles.modes} role="group" aria-label="Export surface detail">
   <button type="button" disabled={busy||exporting} aria-pressed={!refine} onClick={()=>onRefine(false)}>Standard</button>
   <button type="button" disabled={busy||exporting} aria-pressed={refine} onClick={()=>onRefine(true)}>Refined</button>
  </div>
  <p className={styles.help}>{refine?'Adds triangles where curved surfaces need more detail. Small corners may still need finer sampling.':'Uses the full export grid. Refined adds local surface detail.'}</p>
  <div className={styles.actions}><button type="button" disabled={busy||exporting} onClick={onCheck}>{busy?'Checking…':'Check export mesh'}</button><button type="button" disabled={busy||exporting} onClick={onExport}>{exporting?'Exporting…':'Export STL'}</button></div>
  {fileURL&&<a className={styles.download} href={fileURL} download="form-study-mm.stl">Download prepared STL</a>}
  {busy&&<button type="button" className={styles.cancel} onClick={onCancel}>Cancel check</button>}
  {error&&<p className={styles.error} role="alert">{error}</p>}
  {audit&&<div className={styles.report} aria-live="polite">
   <div className={styles.result}>{clean?'Closed, consistent edges':audit.triangles?'Mesh needs review':'No solid in this mesh'}</div>
   <dl>
    <dt>Dimensions</dt><dd>{audit.dimensions.map(value=>value.toFixed(1)).join(' × ')} mm</dd>
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
   {stats&&<p className={styles.help}>{stats.passes} refinement {stats.passes===1?'pass':'passes'} · {stats.inputTriangles.toLocaleString('en-US')} → {stats.outputTriangles.toLocaleString('en-US')} triangles{stats.budgetLimited?' · detail budget reached':''}{stats.qualityLimited?' · sharper corners need finer sampling':''}.</p>}
   <p className={styles.help}>Measurements describe the captured export frame. Checks triangle connections; intersections and material strength need separate checks.</p>
  </div>}
  {!audit&&!busy&&!error&&<p className={styles.help}>Check the current construction before exporting. Editing the model clears this result.</p>}
 </section>;
}
