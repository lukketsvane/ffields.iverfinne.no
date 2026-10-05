import test from 'node:test';
import assert from 'node:assert/strict';
import {makeShape} from '../lib/shapes.ts';
import {insertSweepControl,removeSweepControl,setSweepClosure,validateEditedSweepPath} from '../components/form/sweep-path-edit.ts';

const loop=[{x:-40,y:0,z:0,radius:5},{x:0,y:30,z:7,radius:8},{x:40,y:0,z:0,radius:6},{x:0,y:-30,z:-9,radius:10}];
const shape=(path=loop,closed=false)=>({...makeShape('sweep'),path:structuredClone(path),closed});

test('closing legacy seams removes only an exact duplicate and never mutates source controls',()=>{
 const source=shape([...loop,{...loop[0]}]),before=structuredClone(source);
 const patch=setSweepClosure(source,true);
 assert.equal(patch.closed,true);assert.deepEqual(patch.path,loop);assert.deepEqual(source,before);
 patch.path[0].radius=19;assert.equal(source.path[0].radius,5,'the authored controls remain independently editable');
 const ambiguous=shape([...loop,{...loop[0],radius:11}]),saved=structuredClone(ambiguous);
 assert.throws(()=>setSweepClosure(ambiguous,true),/different radii/);assert.deepEqual(ambiguous,saved);
});

test('closing joins arbitrary distinct controls and opening retains those controls exactly',()=>{
 const source=shape(),closed={...source,...setSweepClosure(source,true)};
 assert.deepEqual(closed.path,source.path);assert.equal(closed.path.length,4);
 const opened=setSweepClosure(closed,false);assert.equal(opened.closed,false);assert.deepEqual(opened.path,loop);
 assert.throws(()=>setSweepClosure(shape(loop.slice(0,2)),true),/third point/);
 assert.throws(()=>setSweepClosure(shape([loop[0],loop[1],{...loop[0],radius:12},loop[3]]),true),/distinct/);
});

test('inserting after the last closed control wraps toward the first without a duplicate endpoint',()=>{
 const source=shape(loop,true),before=structuredClone(source),edit=insertSweepControl(source,3);
 assert.equal(edit.selected,4);assert.equal(edit.path.length,5);
 assert.deepEqual(edit.path[4],{x:-20,y:-15,z:-4.5,radius:7.5});
 assert.deepEqual(edit.path.slice(0,4),loop);validateEditedSweepPath(edit.path,true);assert.deepEqual(source,before);
 const open=insertSweepControl(shape(),3);assert.deepEqual(open.path[4],{x:-20,y:-45,z:-13.5,radius:10});
});

test('closed removal retains three controls and invalid midpoint edits fail atomically',()=>{
 const source=shape(loop,true),edit=removeSweepControl(source,3);
 assert.equal(edit.path.length,3);assert.equal(edit.selected,2);assert.deepEqual(source.path,loop);
 assert.throws(()=>removeSweepControl({...source,path:edit.path},1),/at least 3/);
 const collinear=shape([{x:0,y:0,z:0,radius:5},{x:10,y:0,z:0,radius:5},{x:20,y:0,z:0,radius:5}],true),before=structuredClone(collinear);
 assert.throws(()=>insertSweepControl(collinear,2),/distinct/);assert.deepEqual(collinear,before);
});
