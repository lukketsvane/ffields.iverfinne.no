import test from 'node:test';
import assert from 'node:assert/strict';
import {CAMERA_MODEL,cloneModel,validateModel,evaluate,evaluateBase,generateMesh,lensCenters,lensY,portPosition,shutterPosition,rippleOffset,binarySTL} from '../lib/form-engine.ts';
const m=cloneModel(CAMERA_MODEL);
test('camera is hollow and each aperture actually opens into its cavity',()=>{
 assert.ok(evaluateBase(m,0,0,0)>0);
 assert.ok(evaluateBase(m,0,0,-m.depth/2+1)<0,'rear wall is material');
 for(const x of lensCenters(m))for(const z of [m.depth/2+2,m.depth/2-1,0])assert.ok(evaluateBase(m,x,lensY(m),z)>0,'front bore reaches cavity');
 const [x,y,z]=portPosition(m);for(const xx of [x+1,x-1,x-m.wall-2])assert.ok(evaluateBase(m,xx,y,z)>0,'USB-C passage');
 const [sx,sy,sz]=shutterPosition(m);for(const yy of [sy,sy-2,sy-6])assert.ok(evaluateBase(m,sx,yy,sz)>0,'shutter socket');
 const solid={...m,shell:false};assert.ok(evaluateBase(solid,25,-14,-5)<0);
 assert.ok(evaluateBase({...m,usb:false},x-1,y,z)<0,'USB toggle restores side wall');
});
test('ripple moves the actual surface while lens and port seats stay stationary',()=>{
 assert.notEqual(rippleOffset(m,32,-12,21,0),rippleOffset(m,32,-12,21,90));
 for(const x of lensCenters(m))assert.ok(rippleOffset(m,x,lensY(m),m.depth/2,90)===0);
 const port=portPosition(m);assert.ok(rippleOffset(m,...port,90)===0);
 for(let i=0;i<100;i++){const x=(i%10-5)*12,y=(Math.floor(i/10)-5)*7,z=(i%3-1)*21,warped=z+rippleOffset(m,x,y,z);assert.ok(Math.abs(evaluate(m,x,y,warped)-evaluateBase(m,x,y,z))<1e-5)}
});
test('maximum supported wave stack keeps its deformation invertible',()=>{
 const wave={...m.influences[0],strength:22,phase:270,falloff:'constant'};
 const stack={...m,protect:false,buttons:false,usb:false,influences:Array.from({length:20},(_,i)=>({...wave,id:'w'+i}))};
 for(const z of [-80,-20,0,20,80]){const slope=1+(rippleOffset(stack,0,0,z+.01)-rippleOffset(stack,0,0,z-.01))/.02;assert.ok(slope>=.49)}
});
test('enclosure mesh is finite and closed, including at narrow body / wide seat settings',()=>{
 for(const model of [m,{...m,width:90,lensRadius:18}]){
  const mesh=generateMesh(model,90),edges=new Map();assert.ok(mesh.indices.length>0);assert.ok(mesh.positions.every(Number.isFinite));assert.ok(mesh.normals.every(Number.isFinite));
  for(let i=0;i<mesh.indices.length;i+=3)for(let j=0;j<3;j++){const a=mesh.indices[i+j],b=mesh.indices[i+(j+1)%3],key=a<b?a+':'+b:b+':'+a;edges.set(key,(edges.get(key)??0)+1)}
  assert.equal([...edges.values()].filter(n=>n!==2).length,0);assert.equal(binarySTL(mesh).byteLength,84+50*mesh.indices.length/3);
 }
});
test('legacy documents acquire camera features without losing custom edits',()=>{
 const legacy=cloneModel(m);for(const key of ['shell','wall','usb','buttons','fingerGrooves'])delete legacy[key];legacy.width=172;legacy.influences[0].strength=3.2;
 const restored=validateModel(legacy);assert.equal(restored.width,172);assert.equal(restored.influences[0].strength,3.2);assert.equal(restored.wall,2.6);assert.equal(restored.usb,true);
 assert.throws(()=>validateModel({...m,wall:-1}));
});

test('component placements round-trip and reject missing sources or ambiguous selections',()=>{
 const asset={id:'asset-test',sourceId:'pololu-usb-c',name:'USB-C',visible:true,x:32,y:-12,z:5,rx:0,ry:90,rz:0,scale:1};
 const restored=validateModel(JSON.parse(JSON.stringify({...m,assets:[asset]})));
 assert.deepEqual(restored.assets,[asset]);
 for(const invalid of [{...asset,sourceId:'missing-model'},{...asset,id:'wave-1'},{...asset,id:'body'},{...asset,scale:0},{...asset,x:Infinity}])assert.throws(()=>validateModel({...m,assets:[invalid]}));
});
