import test from 'node:test';
import assert from 'node:assert/strict';
import {DEFAULT_LATTICE,LATTICE_LIMITS,evaluateLatticeField,gyroidField,diamondField,honeycombField,octetField} from '../lib/lattice.ts';
import {DEFAULT_MODEL,CAMERA_MODEL,cloneModel,validateModel,evaluateBase,evaluate,generateMesh,binarySTL,rippleOffset,lensCenters,lensY,portPosition,shutterPosition,modelBounds,makeInfluence} from '../lib/form-engine.ts';
import {makeShape} from '../lib/shapes.ts';
import {mixModelFields} from '../lib/mix-model.ts';

const model=(lattice={},edits={})=>({...cloneModel(DEFAULT_MODEL),influences:[],softness:2,asymmetry:0,width:100,height:60,depth:48,lattice:{...DEFAULT_LATTICE,enabled:true,cellSize:16,thickness:2.4,skin:0,...lattice},...edits});
const dimensions={width:100,height:60,depth:48};

test('all analytic lattices have both material and void, with finite periodic fields',()=>{
 for(const kind of ['gyroid','diamond','honeycomb','octet']){
  const settings={...DEFAULT_LATTICE,enabled:true,kind,cellSize:16,skin:0};let material=0,voids=0;
  for(let i=0;i<9;i++)for(let j=0;j<9;j++)for(let k=0;k<9;k++){
   const point=[i*16/9,j*16/9,k*16/9],value=evaluateLatticeField(settings,...point,dimensions);
   assert.ok(Number.isFinite(value),`${kind} evaluates a finite field`);
   if(value<0)material++;if(value>0)voids++;
   if(kind!=='honeycomb')assert.ok(Math.abs(value-evaluateLatticeField(settings,point[0]+16,point[1],point[2],dimensions))<1e-8,`${kind} repeats without enumerating cells`);
  }
  assert.ok(material>0&&voids>0,`${kind} contains material and void`);
 }
 assert.ok(Number.isFinite(gyroidField(1e6,-1e6,1e6,8,1.2)));
 assert.ok(Number.isFinite(diamondField(1e6,-1e6,1e6,8,1.2)));
 assert.ok(Number.isFinite(honeycombField(1e6,-1e6,8,1.2)));
 assert.ok(Number.isFinite(octetField(1e6,-1e6,1e6,8,1.2)));
});

test('a clipped lattice never creates material outside its composed body or inside an existing cut',()=>{
 for(const kind of ['gyroid','diamond','honeycomb','octet']){
  const m=model({kind});
  for(const point of [[51,0,0],[0,31,0],[0,0,25],[80,80,80]])assert.ok(evaluateBase(m,...point)>0,`${kind} remains inside body bounds`);
  const cut={...makeShape('cylinder'),id:'existing-through-hole',x:0,y:0,z:0,width:12,height:80,depth:12,blend:0,operation:'subtract'};
  const withHole={...m,shapes:[cut]};
  for(const y of [-25,0,25])assert.ok(evaluateBase(withHole,0,y,0)>0,`${kind} does not refill a previously composed cut`);
 }
 const empty=model({}, {baseEnabled:false,shapes:[]});
 assert.equal(evaluateBase(empty,0,0,0),Infinity,'a lattice alone does not invent a body');
});

test('skin follows the composed exterior and survives lattice voids',()=>{
 const porous=model(),skinned=model({skin:3});
 assert.ok(evaluateBase(porous,49,2,2)>0,'chosen side-wall point is a lattice void');
 assert.ok(evaluateBase(skinned,49,2,2)<0,'the outer skin fills that void');
 assert.ok(evaluateBase(skinned,2,2,2)>0,'skin does not fill the whole core');
 assert.ok(evaluateBase(skinned,51,0,0)>0,'skin does not enlarge the exterior');
});

test('region preserves solid outside itself and does not add a primitive to the body',()=>{
 const region={...makeShape('box'),id:'core-region',x:0,y:0,z:0,width:30,height:30,depth:30,roundness:0,blend:0};
 const m=model({region});
 assert.ok(evaluateBase(m,2,2,2)>0,'voids are present inside the region');
 assert.ok(evaluateBase(m,20,2,2)<0,'material outside the region stays solid');
 assert.ok(evaluateBase(m,51,4,4)>0,'the region cannot grow the exterior');
 assert.ok(evaluateBase(model({region:{...region,enabled:false}}),20,2,2)>0,'disabled region removes the restriction');
});

test('density gradient changes thickness without moving the cell phase',()=>{
 const a={...DEFAULT_LATTICE,enabled:true,kind:'gyroid',axis:'x',gradient:.8,cellSize:16,thickness:2.4};
 const low=evaluateLatticeField(a,-32,2,2,dimensions),high=evaluateLatticeField(a,32,2,2,dimensions);
 assert.ok(high<low,'material thickens along the selected positive axis');
 const uniform={...a,gradient:0};
 assert.ok(Math.abs(evaluateLatticeField(uniform,-32,2,2,dimensions)-evaluateLatticeField(uniform,32,2,2,dimensions))<1e-8,'same phase stays aligned');
 for(const axis of ['x','y','z']){
  const settings={...a,kind:'honeycomb',axis,gradient:0},point=[3,4,5],other=[...point];other[['x','y','z'].indexOf(axis)]+=100;
  assert.equal(evaluateLatticeField(settings,...point,dimensions),evaluateLatticeField(settings,...other,dimensions),'honeycomb channels follow their axis');
 }
});

test('reveal subtracts a progressive quarter from real geometry without filling other voids',()=>{
 for(const axis of ['x','y','z']){
  const uncut=model({axis,skin:3}),cut=model({axis,skin:3,reveal:1});
  const point=axis==='x'?[49,29,0]:axis==='y'?[0,29,23]:[49,0,23];
  assert.ok(evaluateBase(uncut,...point)<0,'positive quarter contains skin before the cut');
  assert.ok(evaluateBase(cut,...point)>0,'full reveal removes the selected quarter');
  assert.ok(evaluateBase(cut,-49,0,-22)<0,'opposite skin remains solid');
  const half=model({axis,skin:3,reveal:.5});
  assert.ok(evaluateBase(half,...point)>0,'partial reveal opens the outer quarter');
 }
});

test('lens bores, usb passage and shutter socket are cut after lattice and skin',()=>{
 const camera={...cloneModel(CAMERA_MODEL),influences:[],lattice:{...DEFAULT_LATTICE,enabled:true,skin:6,thickness:6}};
 for(const x of lensCenters(camera))for(const z of [camera.depth/2,0])assert.ok(evaluateBase(camera,x,lensY(camera),z)>0,'lens bore stays open');
 const [x,y,z]=portPosition(camera);assert.ok(evaluateBase(camera,x-1,y,z)>0,'usb passage stays open');
 const [sx,sy,sz]=shutterPosition(camera);assert.ok(evaluateBase(camera,sx,sy-2,sz)>0,'button socket stays open');
});

test('lattice uses the same ripple deformation in evaluation and exported meshes',()=>{
 const m=model({skin:1.8}, {influences:[{...DEFAULT_MODEL.influences[0],strength:3,phase:70}]});
 for(const p of [[0,0,0],[4,4,4],[23,-8,14],[35,20,-12]]){
  const warped=p[2]+rippleOffset(m,...p);
  assert.ok(Math.abs(evaluate(m,p[0],p[1],warped)-evaluateBase(m,...p))<1e-5,'field evaluation inverts the exact shared deformation');
 }
 const mesh=generateMesh(m,70);
 assert.ok(mesh.indices.length>0&&mesh.volume>0,'deformed lattice exports a nonempty solid');
 assert.ok(mesh.positions.every(Number.isFinite)&&mesh.normals.every(Number.isFinite),'deformed mesh stays finite');
 assert.equal(binarySTL(mesh).byteLength,84+50*mesh.indices.length/3,'all exported triangles are written');
});

test('all four lattice families export finite closed meshes',()=>{
 for(const kind of ['gyroid','diamond','honeycomb','octet']){
  const mesh=generateMesh(model({kind,skin:1.8,reveal:.75}),64);
  assert.ok(mesh.indices.length>0&&mesh.volume>0,`${kind} exports material`);
  assert.ok(mesh.positions.every(Number.isFinite)&&mesh.normals.every(Number.isFinite),`${kind} mesh is finite`);
  const edges=new Map();for(let i=0;i<mesh.indices.length;i+=3)for(let j=0;j<3;j++){
   const a=mesh.indices[i+j],b=mesh.indices[i+(j+1)%3],key=a<b?`${a}:${b}`:`${b}:${a}`;edges.set(key,(edges.get(key)??0)+1);
  }
  assert.equal([...edges.values()].filter(n=>n!==2).length,0,`${kind} has exactly two faces per mesh edge`);
 }
});

test('lattice documents round-trip, legacy geometry stays unchanged, invalid imports are rejected',()=>{
 const region={...makeShape('sphere'),id:'density-region',x:0,y:0,z:0};
 const m=model({kind:'diamond',gradient:-.8,skin:4,axis:'y',reveal:.7,region});
 assert.deepEqual(validateModel(JSON.parse(JSON.stringify(m))),m,'all lattice and region settings round-trip');
 const legacy=cloneModel(CAMERA_MODEL),disabled={...cloneModel(legacy),lattice:{...DEFAULT_LATTICE}};
 for(const p of [[0,0,0],[25,-14,-20],[70,0,0]])assert.equal(evaluateBase(disabled,...p),evaluateBase(legacy,...p),'disabled lattice preserves legacy shell geometry');
 assert.deepEqual(validateModel(legacy),legacy,'legacy imports acquire no lattice settings');
 for(const settings of [null,[],{}, {...m.lattice,enabled:'yes'},{...m.lattice,kind:'voronoi'},{...m.lattice,axis:'w'}])assert.throws(()=>validateModel({...m,lattice:settings}));
 for(const [key,[low,high]] of Object.entries(LATTICE_LIMITS))for(const value of [low-.01,high+.01,NaN,Infinity])assert.throws(()=>validateModel({...m,lattice:{...m.lattice,[key]:value}}),`reject invalid ${key}`);
 for(const patch of [{width:0},{x:Infinity},{rx:NaN},{roundness:61},{id:'body'},{enabled:'yes'},{operation:'xor'},{kind:'cone'}])assert.throws(()=>validateModel({...m,lattice:{...m.lattice,region:{...region,...patch}}}),'reject invalid region');
});

test('independent extrusion lengths do not waste lattice sampling bounds',()=>{
 for(const [kind,dimensions,roundness] of [
  ['box',[80,8,60],3],['cylinder',[80,8,80],0],['capsule',[20,110,20],10],['torus',[80,8,80],.1],
 ]){
  const first={...makeShape(kind),id:'first',x:0,y:0,z:0,width:dimensions[0],height:dimensions[1],depth:dimensions[2],roundness,blend:0};
  const m=model({}, {baseEnabled:false,shapes:[first,{...first,id:'second',blend:16}]});
  const bounds=modelBounds(m,false);
  for(let axis=0;axis<3;axis++)assert.ok(Math.abs((bounds[axis+3]-bounds[axis])-(dimensions[axis]+16))<1e-8,`${kind} needs 4 mm blend growth and 4 mm exterior margin per side`);
 }
});

test('primitive-specific padding conservatively contains rotated blended and offset fields',()=>{
 for(const [kind,dimensions,roundness] of [
  ['box',[90,10,65],4],['cylinder',[90,12,35],0],['capsule',[38,130,20],10],['torus',[95,34,42],.1],['sphere',[95,12,42],0],
 ]){
  const shape={...makeShape(kind),id:'one',x:25,y:-10,z:12,rx:31,ry:47,rz:-15,width:dimensions[0],height:dimensions[1],depth:dimensions[2],roundness,blend:0};
  const m=model({}, {baseEnabled:false,shapes:[shape,{...shape,id:'two',x:40,y:-7,blend:32}],influences:[{...makeInfluence('bulge'),id:'offset',strength:7,falloff:'constant'}]});
  const bounds=modelBounds(m,false);
  for(let axis=0;axis<3;axis++)for(const side of [0,3])for(let i=0;i<=9;i++)for(let j=0;j<=9;j++){
   const other=[0,1,2].filter(a=>a!==axis),p=[0,0,0];p[axis]=bounds[axis+side];
   p[other[0]]=bounds[other[0]]+(bounds[other[0]+3]-bounds[other[0]])*i/9;
   p[other[1]]=bounds[other[1]]+(bounds[other[1]+3]-bounds[other[1]])*j/9;
   assert.ok(evaluateBase(m,...p)>0,`${kind} blended field stays inside sampling face ${axis}/${side}`);
  }
 }
});

test('mixing reserves the lattice inspector and optional region identity',()=>{
 const region={...makeShape('sphere'),id:'shared-region'},mass=model({region});
 const fields={...cloneModel(DEFAULT_MODEL),influences:['lattice','shared-region'].map(id=>({...makeInfluence('wave'),id}))};
 const mixed=mixModelFields(mass,fields);
 assert.deepEqual(mixed.lattice,mass.lattice,'mixing preserves lattice and region settings');
 assert.ok(mixed.influences.every(f=>!['lattice','shared-region'].includes(f.id)),'copied IDs do not collide with region or inspector');
 assert.deepEqual(validateModel(JSON.parse(JSON.stringify(mixed))),mixed,'mixed document remains importable');
 assert.throws(()=>validateModel({...mass,influences:[{...makeInfluence('wave'),id:'lattice'}]}),'the lattice inspector identity is reserved');
});
