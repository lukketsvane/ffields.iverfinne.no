import test from 'node:test';
import assert from 'node:assert/strict';
import {attachmentAnchor,attachmentForEndpoint,attachmentLocalToWorld as toWorld,attachmentWorldToLocal as toLocal,canAttachTo,reconcileAttachments,resolveAttachments} from '../lib/attachments.ts';
import {applyConstructionCommand as apply,blankConstruction} from '../lib/construction.ts';
import {CAMERA_MODEL,cloneModel,evaluateBase,generateMesh,validateModel} from '../lib/form-engine.ts';
import {makeShape} from '../lib/shapes.ts';
import {createTrussStudy} from '../lib/truss-study.ts';

const point=(x,y,z,radius=5)=>({x,y,z,radius});
const shape=(kind,id,patch={})=>({...makeShape(kind),id,x:0,y:0,z:0,blend:0,...patch});
const fixture=()=>({...blankConstruction(),lenses:false,shell:false,usb:false,buttons:false,fingerGrooves:false,shapes:[shape('box','socket',{x:30,y:10,z:5,width:30,height:24,depth:18,roundness:0}),shape('sweep','rib',{path:[point(-20,0,0),point(0,10,0,7),point(20,0,0)]})]});
const get=(model,id)=>model.shapes.find(s=>s.id===id);
const endpoint=(model,id,end='start')=>{const s=get(model,id);return s.path[end==='start'?0:s.path.length-1];};
const worldEndpoint=(model,id,end='start')=>toWorld(get(model,id),endpoint(model,id,end));
const near=(a,b,message='points agree')=>{for(const axis of ['x','y','z'])assert.ok(Math.abs(a[axis]-b[axis])<1e-7,message+' '+axis+': '+a[axis]+' / '+b[axis]);};
const attach=(model,end='start',patch={})=>apply(model,{action:'attach',sweepId:'rib',endpoint:end,targetShapeId:'socket',anchor:'center',...patch});
const desired=(model,link)=>{const target=get(model,link.targetShapeId),anchor=attachmentAnchor(target,link.anchor);return toWorld(target,{x:anchor.x+link.offset.x,y:anchor.y+link.offset.y,z:anchor.z+link.offset.z});};

test('target-local anchor and offsets follow size, rotation and translation in another sweep frame',()=>{
 let model=fixture();get(model,'rib').x=-25;get(model,'rib').rx=13;get(model,'rib').ry=-21;get(model,'rib').rz=17;
 model=attach(model,'start',{anchor:'x+',offset:{x:2,y:-3,z:4}});
 near(worldEndpoint(model,'rib'),{x:47,y:7,z:9});assert.equal(endpoint(model,'rib').radius,5);
 model=apply(model,{action:'update',id:'socket',patch:{x:61,y:-15,z:12,width:44,rx:19,ry:37,rz:63}});
 near(worldEndpoint(model,'rib'),desired(model,model.attachments[0]));
 near(toLocal(get(model,'socket'),worldEndpoint(model,'rib')),{x:24,y:-3,z:4});
 assert.equal(endpoint(model,'rib').radius,5);assert.equal(model.attachments.length,1);
 const hidden=apply(model,{action:'update',id:'socket',patch:{enabled:false,y:8}});
 near(worldEndpoint(hidden,'rib'),desired(hidden,hidden.attachments[0]));assert.equal(hidden.attachments.length,1);
});

test('capturing an offset and resolving a document preserve shape and stable object identity',()=>{
 const raw=fixture();get(raw,'socket').rx=27;get(raw,'socket').ry=-44;get(raw,'socket').rz=8;
 const original=cloneModel(raw),link=attachmentForEndpoint(raw,{sweepId:'rib',endpoint:'end',targetShapeId:'socket',anchor:'z-'});
 const model=attach(raw,'end',{anchor:'z-'});
 near(worldEndpoint(raw,'rib','end'),worldEndpoint(model,'rib','end'));assert.deepEqual(raw,original);assert.deepEqual(model.attachments[0],link);
 assert.equal(resolveAttachments(model),model);assert.equal(resolveAttachments(raw),raw);
 assert.equal(resolveAttachments({...raw,attachments:[]}).attachments.length,0);
 const moved={...model,shapes:model.shapes.map(s=>s.id==='socket'?{...s,x:s.x+5}:s)};
 const resolved=resolveAttachments(moved);assert.notEqual(resolved,moved);assert.equal(get(resolved,'socket'),get(moved,'socket'));assert.notEqual(get(resolved,'rib'),get(moved,'rib'));
 near(worldEndpoint(resolved,'rib','end'),desired(resolved,link));assert.equal(resolveAttachments(resolved),resolved);
});

test('chained sweep anchors resolve target first regardless of link and shape ordering',()=>{
 let model=fixture();model.shapes.push(shape('sweep','branch',{path:[point(-10,-10,0),point(0,-4,0),point(10,-10,0)]}));
 model=attach(model,'end',{anchor:'y+',offset:{x:0,y:0,z:0}});
 model=apply(model,{action:'attach',sweepId:'branch',endpoint:'start',targetShapeId:'rib',anchor:'x+',offset:{x:-2,y:1,z:0}});
 assert.equal(canAttachTo(model,'rib','branch'),false);assert.equal(canAttachTo(model,'branch','socket'),true);
 const reversed={...model,shapes:[...model.shapes].reverse(),attachments:[...model.attachments].reverse()};
 const changed={...reversed,shapes:reversed.shapes.map(s=>s.id==='socket'?{...s,x:80,y:32}:s)};
 const result=resolveAttachments(changed),branch=result.attachments.find(l=>l.sweepId==='branch');
 near(worldEndpoint(result,'rib','end'),desired(result,result.attachments.find(l=>l.sweepId==='rib')));
 near(worldEndpoint(result,'branch'),desired(result,branch));assert.equal(resolveAttachments(result),result);
 const canonical=resolveAttachments({...changed,shapes:[...changed.shapes].reverse(),attachments:[...changed.attachments].reverse()});
 near(worldEndpoint(result,'branch'),worldEndpoint(canonical,'branch'));
});

test('direct endpoint edits detach only that endpoint; radius, interior and section edits retain links',()=>{
 let model=attach(attach(fixture()),'end'),path=get(model,'rib').path.map(p=>({...p}));
 path[0].radius=9;path[1].y+=5;
 model=apply(model,{action:'update',id:'rib',patch:{path,depthRatio:.5,sectionMode:'transported',sectionRoll:42}});
 assert.equal(model.attachments.length,2);assert.equal(endpoint(model,'rib').radius,9);
 path=get(model,'rib').path.map(p=>({...p}));path[0].x+=3;
 const edited=apply(model,{action:'update',id:'rib',patch:{path}});
 assert.equal(edited.attachments.length,1);assert.equal(edited.attachments[0].endpoint,'end');assert.equal(endpoint(edited,'rib').x,path[0].x);
 const moved=apply(edited,{action:'update',id:'socket',patch:{x:60}});
 near(worldEndpoint(moved,'rib'),worldEndpoint(edited,'rib'));near(worldEndpoint(moved,'rib','end'),desired(moved,moved.attachments[0]));
});

test('detach, deletion and mirror preserve resolved endpoints with independent copied geometry',()=>{
 let model=attach(attach(fixture()),'end');model=apply(model,{action:'update',id:'socket',patch:{x:47,rz:22}});
 const first=worldEndpoint(model,'rib'),last=worldEndpoint(model,'rib','end');
 const detached=apply(model,{action:'detach',sweepId:'rib',endpoint:'start'});near(worldEndpoint(detached,'rib'),first);assert.equal(detached.attachments.length,1);
 const removed=apply(model,{action:'remove',id:'socket'});near(worldEndpoint(removed,'rib'),first);near(worldEndpoint(removed,'rib','end'),last);assert.deepEqual(removed.attachments,[]);
 assert.deepEqual(apply(model,{action:'remove',id:'rib'}).attachments,[]);
 const copy=apply(model,{action:'mirror',id:'rib',axis:'x',newId:'mirror'});assert.equal(copy.attachments.length,2);
 const reflected=worldEndpoint(copy,'mirror');near(reflected,{x:-first.x,y:first.y,z:first.z});
 const moved=apply(copy,{action:'update',id:'socket',patch:{x:65}});near(worldEndpoint(moved,'mirror'),reflected);near(worldEndpoint(moved,'rib'),desired(moved,moved.attachments[0]));
 const raw=cloneModel(model);raw.shapes=raw.shapes.filter(s=>s.id!=='socket').map(s=>({...s,x:s.x+20,ry:30}));
 const reconciled=reconcileAttachments(model,raw);near(worldEndpoint(reconciled,'rib'),first);near(worldEndpoint(reconciled,'rib','end'),last);
});

test('invalid graph imports and construction mutations fail atomically',()=>{
 const source=attach(fixture()),saved=cloneModel(source),good=source.attachments[0];
 for(const attachment of [null,{...good,endpoint:'middle'},{...good,anchor:'normal'},{...good,offset:{x:Infinity,y:0,z:0}},{...good,offset:{x:241,y:0,z:0}},{...good,offset:null},{...good,targetShapeId:'missing'},{...good,targetShapeId:'rib'},{...good,sweepId:'socket'}]){
  assert.throws(()=>validateModel({...source,attachments:[attachment]}));assert.deepEqual(source,saved);
 }
 assert.throws(()=>validateModel({...source,attachments:[good,good]}),/only one/);
 assert.throws(()=>validateModel({...source,attachments:'bad'}));
 const cyclic=cloneModel(source);cyclic.shapes.push(shape('sweep','branch'));cyclic.attachments=[{...good,targetShapeId:'branch'},{...good,sweepId:'branch',targetShapeId:'rib'}];
 assert.throws(()=>validateModel(cyclic),/cycle/);
 for(const command of [{action:'attach',sweepId:'rib',endpoint:'start',targetShapeId:'rib',anchor:'center'},{action:'attach',sweepId:'rib',endpoint:'end',targetShapeId:'socket',anchor:'center',offset:{x:240,y:240,z:240}},{action:'update',id:'socket',patch:{x:300}},{action:'detach',sweepId:'socket',endpoint:'end'}]){
  assert.throws(()=>apply(source,command));assert.deepEqual(source,saved);
 }
});

test('imports resolve stale endpoint data and legacy documents retain absent attachment metadata',()=>{
 const model=attach(fixture(),'end'),stale=cloneModel(model);get(stale,'socket').y+=24;
 const imported=validateModel(JSON.parse(JSON.stringify(stale)));near(worldEndpoint(imported,'rib','end'),desired(imported,imported.attachments[0]));
 assert.deepEqual(validateModel(JSON.parse(JSON.stringify(imported))),imported);
 const legacy=validateModel(JSON.parse(JSON.stringify(CAMERA_MODEL)));assert.equal(Object.hasOwn(legacy,'attachments'),false);assert.deepEqual(legacy,validateModel(CAMERA_MODEL));
});

test('worked bracket endpoints preserve authored offsets then follow rotated socket construction',()=>{
 let bracket=createTrussStudy();const initialStart=worldEndpoint(bracket,'upper-front'),initialEnd=worldEndpoint(bracket,'upper-front','end');
 for(const [endpoint,targetShapeId] of [['start','a-sleeve'],['end','c-sleeve']])bracket=apply(bracket,{action:'attach',sweepId:'upper-front',endpoint,targetShapeId,anchor:'center'});
 near(worldEndpoint(bracket,'upper-front'),initialStart);near(worldEndpoint(bracket,'upper-front','end'),initialEnd);
 bracket=apply(bracket,{action:'update',id:'a-sleeve',patch:{x:-83,y:-8,z:-24,ry:-73,rz:11}});
 const startLink=bracket.attachments.find(link=>link.sweepId==='upper-front'&&link.endpoint==='start');
 near(worldEndpoint(bracket,'upper-front'),desired(bracket,startLink));near(worldEndpoint(bracket,'upper-front','end'),initialEnd);
 const expected=desired(bracket,startLink);assert.ok(Math.hypot(expected.x-initialStart.x,expected.y-initialStart.y,expected.z-initialStart.z)>10);
 assert.deepEqual(validateModel(JSON.parse(JSON.stringify(bracket))),bracket);
});

test('resolved attached construction uses identical implicit/export geometry',()=>{
 let model=attach(fixture(),'end',{anchor:'center',offset:{x:0,y:0,z:0}});model=apply(model,{action:'update',id:'socket',patch:{x:42,y:15,rz:15}});
 const mesh=generateMesh(model,38);assert.ok(mesh.indices.length>0);assert.ok(mesh.volume>0);
 let residual=0;for(let i=0;i<mesh.positions.length;i+=3){const [x,y,z]=mesh.positions.slice(i,i+3);residual=Math.max(residual,Math.abs(evaluateBase(model,x,y,z)));}
 assert.ok(residual<2e-5,'export vertices remain on resolved attachment surface: '+residual);
 const edges=new Map();for(let i=0;i<mesh.indices.length;i+=3)for(let j=0;j<3;j++){const a=mesh.indices[i+j],b=mesh.indices[i+(j+1)%3],key=a<b?a+':'+b:b+':'+a;edges.set(key,(edges.get(key)??0)+1);}
 assert.ok([...edges.values()].every(n=>n===2),'attachment-driven mesh stays closed');
});
