import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync,readFileSync,rmSync,writeFileSync} from 'node:fs';
import {dirname,join,resolve} from 'node:path';
import {fileURLToPath,pathToFileURL} from 'node:url';
import ts from 'typescript';
import {createElement} from 'react';
import {renderToStaticMarkup} from 'react-dom/server';
import {blankConstruction} from '../lib/construction.ts';
import {makeShape} from '../lib/shapes.ts';
import {createCameraPodStudy} from '../lib/camera-pod-study.ts';

// Render the actual JSX rather than approximating its DOM from source strings.
const root=resolve(dirname(fileURLToPath(import.meta.url)),'..');
const directory=mkdtempSync(join(root,'.mobile-ui-test-'));
let MobileQuickWorkspace;
try {
 const source=readFileSync(join(root,'components/form/mobile-quick-workspace.tsx'),'utf8');
 const code=ts.transpileModule(source,{compilerOptions:{module:ts.ModuleKind.ESNext,jsx:ts.JsxEmit.ReactJSX,target:ts.ScriptTarget.ES2022}}).outputText
  .replace(/from ['"](@\/[^'"]+)['"]/g,(_,value)=>`from ${JSON.stringify(pathToFileURL(join(root,value.slice(2)+'.ts')).href)}`);
 const target=join(directory,'mobile-quick-workspace.mjs');writeFileSync(target,code);
 ({MobileQuickWorkspace}=await import(pathToFileURL(target).href));
} finally {rmSync(directory,{recursive:true,force:true});}
const noop=()=>{};
function render(overrides={}){
 const props={panel:'edit',model:blankConstruction(),selected:'body',view:'solid',handles:true,playing:false,transformMode:'size',onTransformMode:noop,begin:noop,end:noop,onShape:noop,onBase:noop,onInfluence:noop,onAsset:noop,onLattice:noop,onRipple:noop,onInsert:noop,onAdvanced:noop,onClose:noop,onLibrary:noop,onProjects:noop,onDuplicate:noop,onRemove:noop,onSelect:noop,onView:noop,onCamera:noop,onFit:noop,onHandles:noop,more:[],...overrides};
 return renderToStaticMarkup(createElement(MobileQuickWorkspace,props));
}
const contains=(markup,text)=>assert.ok(markup.includes(text),text);

test('normal component editing opens only the active value, leaving secondary solid tools collapsed',()=>{
 const model=createCameraPodStudy(),shape=model.shapes.find(shape=>shape.componentId===shape.id);
 assert.ok(shape,'camera plate is a component root');
 const markup=render({model,shape,selected:shape.id,solidControls:createElement('section',{'data-test':'secondary-component-tools'},'Component membership and STL export')});
 for(const label of ['Quick editing mode','Quick parameter','Quick Width value','Decrease Width','Increase Width','Minimize quick tools','Tool details','Close quick tools'])contains(markup,`aria-label="${label}"`);
 assert.equal(markup.includes('secondary-component-tools'),false);
 assert.equal(markup.includes('Quick shape operation'),false);
 assert.equal(markup.includes('class="quick-range"'),false);
 assert.equal(markup.includes('quick-control-tabs'),false);
 assert.equal(markup.includes('quick-transform-cue'),false);
});

test('Move and Rotate start with their active coordinate, without another parameter row',()=>{
 const shape=makeShape('box'),model={...blankConstruction(),shapes:[shape]};
 const moving=render({model,shape,selected:shape.id,transformMode:'move'});
 contains(moving,'<option value="position" selected="">Move</option>');
 contains(moving,'aria-label="Quick X value"');
 const rotating=render({model,shape,selected:shape.id,transformMode:'rotate',transformAxis:'y'});
 contains(rotating,'<option value="rotation" selected="">Rotate</option>');
 contains(rotating,'aria-label="Quick Y value"');
 assert.equal((rotating.match(/aria-label="Quick parameter"/g)??[]).length,1);
});

test('opening a numeric control retains fine authored values instead of rounding them to two places',()=>{
 const shape={...makeShape('box'),width:40.000125},model={...blankConstruction(),shapes:[shape]};
 const markup=render({model,shape,selected:shape.id});
 contains(markup,'value="40.000125"');
});

test('blank workspaces show all six insertion choices without an empty inspector or secondary links',()=>{
 const markup=render({panel:'add'});
 for(const label of ['Box','Ball','Cylinder','Capsule','Ring','Curve'])contains(markup,`<span>${label}</span>`);
 assert.equal(markup.includes('Quick editing mode'),false);
 assert.equal(markup.includes('quick-links'),false);
 assert.equal(markup.includes('Components &amp; fields'),false);
});

test('material uses one mode picker and one parameter while preserving all pattern options for details',()=>{
 const model={...blankConstruction(),shapes:[makeShape('box')],shell:true,wall:2};
 const markup=render({model,panel:'material'});
 contains(markup,'aria-label="Material structure"');
 contains(markup,'aria-label="Quick Wall value"');
 assert.equal(markup.includes('quick-edit-tabs'),false);
 assert.equal(markup.includes('class="quick-range"'),false);
});

test('one view tray retains all display and framing commands and an explicit ripple control',()=>{
 const markup=render({panel:'view'});
 for(const label of ['Studio','Field','Section','Silhouette','Front','Top','Perspective','Fit'])contains(markup,`>${label}</button>`);
 contains(markup,'Ripple off');contains(markup,'Close quick tools');
});
