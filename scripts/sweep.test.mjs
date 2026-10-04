import test from 'node:test';
import assert from 'node:assert/strict';
import {makeShape,evaluateShape,compileShape,shapeBounds,sweepSamples,isSweepShape,isValidSweepPath,mirrorShape} from '../lib/shapes.ts';
import {DEFAULT_MODEL,CAMERA_MODEL,cloneModel,validateModel,evaluateBase,evaluate,generateMesh,modelBounds,binarySTL,rippleOffset} from '../lib/form-engine.ts';
import {mixModelFields} from '../lib/mix-model.ts';

const solid=(shape,edits={})=>({...cloneModel(DEFAULT_MODEL),baseEnabled:false,shapes:[shape],influences:[],asymmetry:0,...edits});
const sweep=(path,edits={})=>({...makeShape('sweep'),path,blend:0,...edits});
const point=(x,y,z=0,radius=6)=>({x,y,z,radius});
const near=(a,b,message)=>assert.ok(Math.abs(a-b)<1e-7,`${message}: ${a} != ${b}`);
const world=(shape,p)=>{
 const ax=shape.rx*Math.PI/180,ay=shape.ry*Math.PI/180,az=shape.rz*Math.PI/180,cx=Math.cos(ax),sx=Math.sin(ax),cy=Math.cos(ay),sy=Math.sin(ay),cz=Math.cos(az),sz=Math.sin(az);
 return [shape.x+cy*cz*p.x-cy*sz*p.y+sy*p.z,shape.y+(cx*sz+sx*sy*cz)*p.x+(cx*cz-sx*sy*sz)*p.y-sx*cy*p.z,shape.z+(sx*sz-cx*sy*cz)*p.x+(sx*cz+cx*sy*sz)*p.y+cx*cy*p.z];
};

test('default sweep is a valid editable centered curved path, including every control point',()=>{
 const shape=makeShape('sweep'),samples=sweepSamples(shape);
 assert.equal(shape.x,0);assert.equal(shape.y,0);assert.equal(shape.z,0);
 assert.ok(isSweepShape(shape)&&isValidSweepPath(shape.path));assert.equal(shape.path.length,4);assert.equal(samples.length,25);
 for(let i=0;i<shape.path.length;i++)assert.deepEqual(samples[i*8],shape.path[i],'the spline interpolates its control points');
 for(const p of shape.path)assert.ok(evaluateShape(shape,p.x,p.y,p.z)<0,'control centers are solid');
 assert.deepEqual(validateModel(JSON.parse(JSON.stringify(solid(shape)))),solid(shape));
});

test('curved sweep follows its spline through space and does not fill the straight endpoint chord',()=>{
 const shape=sweep([point(-36,0),point(-18,32),point(18,32),point(36,0)]);
 assert.ok(evaluateShape(shape,0,0,0)>10,'the empty chord midpoint stays empty');
 const samples=sweepSamples(shape),middle=samples[12];
 assert.ok(middle.y>32,'interpolation includes its curved overshoot');
 assert.ok(evaluateShape(shape,middle.x,middle.y,middle.z)<0,'curved middle is material');
 assert.ok(evaluateShape(shape,middle.x,middle.y,middle.z+8)>0,'circular section does not become a solid bounding box');
 const tinyDimensions={...shape,width:4,height:4,depth:4,roundness:0};
 near(evaluateShape(tinyDimensions,middle.x,middle.y,middle.z),evaluateShape(shape,middle.x,middle.y,middle.z),'dimensions are metadata for sweeps');
});

test('tapered circular sections use positive monotone radii and contain their endpoints',()=>{
 const shape=sweep([point(-30,0,0,4),point(0,0,0,12),point(30,0,0,3)]),samples=sweepSamples(shape);
 for(let i=0;i<8;i++)assert.ok(samples[i].radius<=samples[i+1].radius,'first span radius increases monotonically');
 for(let i=8;i<16;i++)assert.ok(samples[i].radius>=samples[i+1].radius,'second span radius decreases monotonically');
 assert.ok(samples.every(p=>p.radius>=3&&p.radius<=12),'radius interpolation never overshoots its positive controls');
 assert.ok(evaluateShape(shape,0,0,11)<0,'large center radius is real geometry');
 assert.ok(evaluateShape(shape,-30,0,6)>0,'thin endpoint remains thin');
 assert.ok(evaluateShape(shape,-30,0,3)<0,'thin endpoint has a spherical cap');
 for(const path of [
  [point(0,0,0,40),point(1,0,0,1.5)],
  [point(0,0,0,6),point(0,0,0,9)],
 ]){const extreme=sweep(path);for(const p of [[0,0,0],[.5,8,3],[100,20,-10]])assert.ok(Number.isFinite(evaluateShape(extreme,...p)),'coincident points or abrupt taper have a finite field');}
});

test('path cache invalidates on replacement and in-place control edits',()=>{
 const shape=sweep([point(-20,0),point(20,0)]),initial=sweepSamples(shape);
 assert.equal(sweepSamples(shape),initial,'an unchanged path reuses its cached samples');
 shape.path[1].y=30;
 const bent=sweepSamples(shape);assert.notEqual(bent,initial);assert.equal(bent.at(-1).y,30,'an in-place edit rebuilds the curve');
 shape.path[0].radius=11;
 assert.equal(sweepSamples(shape)[0].radius,11,'an in-place radius edit rebuilds the curve');
 shape.path=[point(-30,-20),point(30,-20)];assert.notEqual(sweepSamples(shape),bent);assert.ok(evaluateShape(shape,0,-20,0)<0,'a replaced path changes the evaluated solid');
});

test('elliptical sweep depth changes its section while preserving its authored centerline',()=>{
 const shape=sweep([point(-30,0,5,10),point(30,0,5,10)],{depthRatio:.35});
 assert.ok(evaluateShape(shape,0,8,5)<0,'wide local Y section remains material');
 assert.ok(evaluateShape(shape,0,0,8)<0,'flattened local Z section remains material');
 assert.ok(evaluateShape(shape,0,0,9)>0,'local Z section is flattened');
 near(evaluateShape(shape,0,0,8.5),0,'local Z semiaxis is radius times depth ratio');
 assert.equal(sweepSamples(shape)[0].z,5,'physical control centers are not scaled');
 const bounds=shapeBounds(shape);near(bounds[2],1.5,'flattened lower bound');near(bounds[5],8.5,'flattened upper bound');
 shape.depthRatio=.5;near(shapeBounds(shape)[5],10,'in-place section edits invalidate cached geometry');
 const transformed={...shape,x:27,y:-19,z:31,rx:39,ry:-28,rz:61};
 for(const axis of ['x','y','z']){const mirrored=mirrorShape(transformed,axis);for(let i=0;i<24;i++){const p=[(i%6-2)*17,(Math.floor(i/6)-2)*13,(i%5-2)*11],q=[...p];q[['x','y','z'].indexOf(axis)]*=-1;near(evaluateShape(transformed,...p),evaluateShape(mirrored,...q),'flattened world mirror');}}
 assert.deepEqual(validateModel(JSON.parse(JSON.stringify(solid(shape)))).shapes[0],shape,'elliptical section settings round-trip');
 for(const depthRatio of [0,.24,1.01,NaN,Infinity,'0.5'])assert.throws(()=>validateModel(solid({...shape,depthRatio})),'invalid section depth is rejected');
});

test('compiled snapshots and CSG branch limits preserve the exact evaluated field',()=>{
 for(const kind of ['sphere','box','capsule','cylinder','torus','sweep']){
  const shape={...makeShape(kind),x:8,y:-12,z:4,rx:27,ry:19,rz:-38};if(kind==='sweep')shape.depthRatio=.4;
  const compiled=compileShape(shape);
  for(let i=0;i<64;i++){
   const p=[(i%8-3)*13,(Math.floor(i/8)-3)*11,(i%7-3)*9],exact=evaluateShape(shape,...p);
   near(compiled(...p),exact,`${kind} compiled field`);
   for(const limit of [-15,-1,0,8,60])near(Math.min(compiled(...p,limit),limit),Math.min(exact,limit),`${kind} inactive CSG branch limit`);
  }
  const before=compiled(20,9,1);shape.x+=40;if(shape.path)shape.path[0].radius=30;near(compiled(20,9,1),before,'compiled geometry retains its immutable snapshot');
 }
});

test('sweep transforms and conservative bounds include rotation, radius and spline overshoot',()=>{
 const shape=sweep([point(-50,-8,0,5),point(-15,33,7,12),point(22,33,-9,7),point(56,-11,5,4)],{x:190,y:-87,z:42,rx:31,ry:-48,rz:77}),samples=sweepSamples(shape),bounds=shapeBounds(shape),m=solid(shape),modelBox=modelBounds(m,false);
 for(const p of samples){const w=world(shape,p);assert.ok(evaluateShape(shape,...w)<0,'transformed centerline remains material');for(let axis=0;axis<3;axis++){assert.ok(w[axis]-p.radius>=bounds[axis]-1e-8&&w[axis]+p.radius<=bounds[axis+3]+1e-8,'world bounds contain the rotated circular sections');assert.ok(modelBox[axis]<=bounds[axis]&&modelBox[axis+3]>=bounds[axis+3],'model sampling box contains the sweep');}}
 for(let axis=0;axis<3;axis++)for(const side of [0,3])for(let i=0;i<=8;i++)for(let j=0;j<=8;j++){
  const other=[0,1,2].filter(value=>value!==axis),p=[0,0,0];p[axis]=bounds[axis+side]+(side?.01:-.01);p[other[0]]=bounds[other[0]]+(bounds[other[0]+3]-bounds[other[0]])*i/8;p[other[1]]=bounds[other[1]]+(bounds[other[1]+3]-bounds[other[1]])*j/8;
  assert.ok(evaluateShape(shape,...p)>0,'no sweep geometry lies outside a bounding face');
 }
});

test('world mirrors preserve transformed fields for every primitive and asymmetric sweep',()=>{
 for(const kind of ['sphere','box','capsule','cylinder','torus','sweep']){
  const original={...makeShape(kind),x:27,y:-19,z:31,rx:39,ry:-28,rz:61};
  if(kind==='sweep')original.path=[point(-35,-12,0,5),point(-9,26,11,13),point(31,7,-9,4)];
  const before=JSON.parse(JSON.stringify(original));
  for(const axis of ['x','y','z']){
   const reflected=mirrorShape(original,axis);assert.notEqual(reflected.id,original.id);assert.ok(reflected.name.length<=100);
   for(let i=0;i<36;i++){const p=[(i%6-2)*17,(Math.floor(i/6)-2)*13,(i%5-2)*11],q=[...p];q[['x','y','z'].indexOf(axis)]*=-1;near(evaluateShape(original,...p),evaluateShape(reflected,...q),`${kind} mirror ${axis}`);}
   if(kind==='sweep'){reflected.path[0].radius=2;assert.equal(original.path[0].radius,5,'mirrored paths do not share controls');}
  }
  assert.deepEqual(original,before,'mirror never changes its source');
 }
});

test('sweeps participate in ordered cuts, smooth unions, ripple geometry and closed STL exports',()=>{
 const strut=sweep([point(-38,-12),point(-13,20,4,9),point(24,15,-4,5),point(40,-10)]),cut={...makeShape('box'),id:'window',width:12,height:80,depth:80,x:0,y:0,z:0,roundness:0,operation:'subtract',blend:0};
 const m=solid(strut,{shapes:[strut,cut]});assert.ok(evaluateBase(m,0,20,0)>0,'ordered subtraction removes an actual spline section');assert.ok(evaluateBase(m,-20,12,2)<0,'remaining curved section survives');
 const wave={...DEFAULT_MODEL.influences[0],strength:2,phase:50},warped={...m,influences:[wave]};
 for(const p of [[-30,0,0],[-12,20,4],[10,18,-2]]){const z=p[2]+rippleOffset(warped,...p);assert.ok(Math.abs(evaluate(warped,p[0],p[1],z)-evaluateBase(warped,...p))<1e-5,'sweep uses the shared deformation');}
 const mesh=generateMesh(warped,78);assert.ok(mesh.positions.every(Number.isFinite)&&mesh.normals.every(Number.isFinite));assert.ok(mesh.indices.length>0&&mesh.volume>0);assert.equal(binarySTL(mesh).byteLength,84+mesh.indices.length/3*50);
 const edges=new Map();for(let i=0;i<mesh.indices.length;i+=3)for(let j=0;j<3;j++){const a=mesh.indices[i+j],b=mesh.indices[i+(j+1)%3],key=a<b?`${a}:${b}`:`${b}:${a}`;edges.set(key,(edges.get(key)??0)+1);}assert.equal([...edges.values()].filter(count=>count!==2).length,0,'every mesh edge has two faces');
});

test('sweep import rejects malformed paths while legacy and mixed documents remain unchanged',()=>{
 const original=makeShape('sweep');
 for(const path of [undefined,null,[],[point(0,0)],Array.from({length:13},()=>point(0,0)),[point(0,0),point(Infinity,0)],[point(0,0),point(0,0,0,-1)],[point(0,0),point(241,0)],[point(0,0),{x:0,y:0,z:0,radius:'6'}]])assert.throws(()=>validateModel(solid({...original,path})),'malformed path is rejected');
 const legacy=cloneModel(CAMERA_MODEL);assert.deepEqual(validateModel(legacy),legacy);
 const fields={...cloneModel(DEFAULT_MODEL),influences:[{...DEFAULT_MODEL.influences[0],id:original.id}]},mixed=mixModelFields(solid(original),fields);assert.notEqual(mixed.influences[0].id,original.id);assert.deepEqual(mixed.shapes[0].path,original.path,'mixing retains editable sweep controls');
});
