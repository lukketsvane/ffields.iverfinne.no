// Real UI regression against a served production build:
// node scripts/entropy-workspace-check.mjs http://localhost:3001
// To check orientation-specific behavior after the full portrait pass:
// node scripts/entropy-workspace-check.mjs http://localhost:3001 --landscape-only --focused
// Requires agent-browser and Chromium; screenshots go to FFIELDS_SCREENSHOTS.
import assert from 'node:assert/strict';
import {execFileSync} from 'node:child_process';
import {mkdirSync} from 'node:fs';
import {join} from 'node:path';

const url=process.argv[2]??'http://localhost:3001';
const output=process.env.FFIELDS_SCREENSHOTS??'/tmp/ffields-entropy-workspace';
const session='ffields-entropy-workspace';
const landscapeOnly=process.argv.includes('--landscape-only');
const focused=process.argv.includes('--focused');
mkdirSync(output,{recursive:true});
function run(...args){
  const text=execFileSync('agent-browser',['--session',session,'--json',...args],{
    encoding:'utf8',timeout:60000,
    env:{...process.env,AGENT_BROWSER_EXECUTABLE_PATH:process.env.AGENT_BROWSER_EXECUTABLE_PATH??'/usr/bin/chromium'},
  });
  const result=text.split('\n').filter(line=>line.startsWith('{"success":')).map(line=>JSON.parse(line)).at(-1);
  assert.ok(result?.success,text);
  return result.data;
}
const evaluate=code=>run('eval',code).result;
const frames=(count=3)=>evaluate(`new Promise(resolve=>{let remaining=${count};function frame(){if(--remaining>0)requestAnimationFrame(frame);else resolve(true)}requestAnimationFrame(frame)})`);
const click=selector=>{run('click',selector);frames()};
const mobileButton=label=>`.mobile-dock button[aria-label="${label}"]`;
const readModel=()=>run('webmcp','invoke','read_form_model','--params','{}').output.model;
const sceneBounds=()=>evaluate(`(()=>{const r=document.querySelector('.scene').getBoundingClientRect();return [r.x,r.y,r.width,r.height]})()`);
const camera=()=>evaluate(`new Promise(resolve=>{window.__ffieldsCapture=true;function sample(){if(!window.__ffieldsCapture)resolve(window.__ffieldsCamera);else requestAnimationFrame(sample)}requestAnimationFrame(sample)})`);
function stableCamera(expected,label){
  const actual=camera();
  assert.ok(actual?.view&&actual?.projection,'observed perspective camera uniforms');
  for(const key of ['view','projection'])assert.ok(actual[key].every((value,i)=>Math.abs(value-expected[key][i])<.0001),`${label}: ${key} matrix remains unchanged`);
}
function playing(label){
  assert.equal(evaluate(`document.querySelector('.ripple-toggle').getAttribute('aria-pressed')`),'true',`${label}: ripple keeps playing`);
  assert.equal(evaluate(`document.querySelector('.view-modes button[aria-pressed="true"]').textContent`),'Studio',`${label}: display mode stays Studio`);
}
function settled(){run('wait','--fn',`!document.querySelector('.evaluating')`);frames()}

let cdpSocket,cdpRequest=0;
async function cdp(method,params={}){
  if(!cdpSocket){
    const endpoint=new URL(run('get','cdp-url').cdpUrl);
    endpoint.protocol='http:';endpoint.pathname='/json/list';
    const targets=await (await fetch(endpoint)).json();
    const activeUrl=run('get','url').url;
    const target=targets.find(item=>item.type==='page'&&item.url===activeUrl)??targets.find(item=>item.type==='page');
    assert.ok(target?.webSocketDebuggerUrl,'page CDP endpoint');
    cdpSocket=new WebSocket(target.webSocketDebuggerUrl);
    await new Promise((resolve,reject)=>{cdpSocket.addEventListener('open',resolve,{once:true});cdpSocket.addEventListener('error',reject,{once:true})});
  }
  // Chromium clears this session's emulation overrides on detach, so keep it connected.
  const id=++cdpRequest;
  return await new Promise((resolve,reject)=>{
    const receive=event=>{const response=JSON.parse(event.data);if(response.id!==id)return;cdpSocket.removeEventListener('message',receive);if(response.error)reject(Error(response.error.message));else resolve(response.result)};
    cdpSocket.addEventListener('message',receive);
    cdpSocket.send(JSON.stringify({id,method,params}));
  });
}

// Observe actual body camera uniforms without adding a test API to the application.
// ModelView equals View for the body mesh, which uses an identity world transform.
// Sampling each draw also works when Three.js caches unchanged matrix uploads.
const observeWorkspace=`(()=>{
  window.__ffieldsCapture=true;
  for(const Constructor of [window.WebGLRenderingContext,window.WebGL2RenderingContext]){
    if(!Constructor)continue;
    const prototype=Constructor.prototype,programs=new WeakMap(),getLocation=prototype.getUniformLocation;
    for(const method of ['drawElements','drawArrays']){
      const draw=prototype[method];
      prototype[method]=function(...args){
        const result=draw.apply(this,args);
        if(!window.__ffieldsCapture)return result;
        const program=this.getParameter(this.CURRENT_PROGRAM);
        if(!program)return result;
        let uniforms=programs.get(program);
        if(uniforms===undefined){
          uniforms=getLocation.call(this,program,'rippleCount')?{
            view:getLocation.call(this,program,'modelViewMatrix')??getLocation.call(this,program,'viewMatrix'),
            projection:getLocation.call(this,program,'projectionMatrix'),
          }:null;
          programs.set(program,uniforms);
        }
        if(uniforms?.view&&uniforms.projection){
          const view=this.getUniform(program,uniforms.view),projection=this.getUniform(program,uniforms.projection);
          if(view&&projection&&Math.abs(projection[11]+1)<.00001&&projection[15]===0){window.__ffieldsCamera={view:Array.from(view),projection:Array.from(projection)};window.__ffieldsCapture=false}
        }
        return result;
      }
    }
  }
})()`;

try{
  run('set','device','iPhone 15');
  for(const [width,height] of landscapeOnly?[[844,390]]:[[390,703],[844,390]]){
    const fullCheck=!focused||width<600;
    run('set','viewport',String(width),String(height));
    run('open',url);
    run('wait','.viewport-mount canvas');
    settled();
    run('wait','[aria-label="Saved on this device"]');
    evaluate(`localStorage.removeItem('form-sketchbook-v1')`);
    run('reload');
    // CLI resizing/navigation resets touch; landscape layout depends on pointer:coarse.
    await cdp('Emulation.setTouchEmulationEnabled',{enabled:true,maxTouchPoints:5});
    assert.equal(evaluate(`matchMedia('(pointer:coarse)').matches`),true,'mobile pointer media query');
    run('wait','.viewport-mount canvas');
    evaluate(observeWorkspace);
    run('wait','--fn',`!!window.__ffieldsCamera`);
    settled();
    const initial=readModel();
    assert.equal(initial.name,'Entropy study');
    for(const key of ['lenses','shell','usb','buttons','fingerGrooves'])assert.equal(initial[key],false,`fresh study has no camera ${key}`);
    assert.deepEqual(initial.shapes,[]);
    playing('fresh study');
    run('screenshot',join(output,`fresh-grey-${width}x${height}.png`));

    const beforeOrbit=camera();
    await cdp('Input.dispatchTouchEvent',{type:'touchStart',touchPoints:[{x:140,y:235,id:1}]});
    await cdp('Input.dispatchTouchEvent',{type:'touchMove',touchPoints:[{x:180,y:255,id:1}]});
    await cdp('Input.dispatchTouchEvent',{type:'touchEnd',touchPoints:[]});
    frames();
    const composed=camera(),bounds=sceneBounds();
    assert.ok(composed.view.some((value,i)=>Math.abs(value-beforeOrbit.view[i])>.01),'manual orbit changes rendered camera');
    console.log(`PASS ${width}x${height}: fresh grey study, no camera apertures, active ripple and real touch orbit`);
    for(const label of ['Parameters','Model','Insert shape, asset or field']){
      click(mobileButton(label));settled();
      stableCamera(composed,`open ${label}`);playing(`open ${label}`);
      assert.deepEqual(sceneBounds(),bounds,`open ${label}: viewport bounds stay fixed`);
    }

    // Use visible insert controls and persisted model values, not a synthetic update API.
    click('button[aria-label="Add Sphere"]');settled();
    assert.equal(readModel().shapes.at(-1).kind,'sphere');
    stableCamera(composed,'add Sphere');playing('add Sphere');
    click(mobileButton('Insert shape, asset or field'));
    click('button[aria-label="Add Box"]');settled();
    const shape=readModel().shapes.at(-1);
    assert.equal(shape.kind,'box');assert.equal(readModel().shapes.length,2);
    stableCamera(composed,'add Box');playing('add Box');

    for(const [label,operation] of fullCheck?[['Merge','union'],['Cut','subtract'],['Intersect','intersect']]:[['Cut','subtract']]){
      click('[aria-label="Shape operation"]');
      run('find','role','option','click','--name',label);
      run('wait','--fn',`!document.querySelector('[role="listbox"]')`);settled();
      assert.equal(readModel().shapes.find(item=>item.id===shape.id).operation,operation);
      stableCamera(composed,`${label} Box`);playing(`${label} Box`);
    }
    run('fill','input[aria-label="Blend radius value"]','9');run('press','Enter');settled();
    assert.equal(readModel().shapes.find(item=>item.id===shape.id).blend,9);
    stableCamera(composed,'edit Blend');playing('edit Blend');
    if(fullCheck){
      click(mobileButton('Undo'));settled();
      assert.notEqual(readModel().shapes.find(item=>item.id===shape.id).blend,9);
      stableCamera(composed,'undo Blend');playing('undo Blend');
    }

    // Sample frames after editing and undo: an active button alone cannot prove animation.
    evaluate(`window.__ffieldsFrame=document.querySelector('.viewport-mount canvas').toDataURL()`);
    run('wait','--fn',`window.__ffieldsFrame!==document.querySelector('.viewport-mount canvas').toDataURL()`);
    click('.view-modes button:nth-child(3)');settled();
    assert.equal(evaluate(`document.querySelector('.view-modes button[aria-pressed="true"]').textContent`),'Section');
    evaluate(`window.__ffieldsFrame=document.querySelector('.viewport-mount canvas').toDataURL()`);
    run('wait','--fn',`window.__ffieldsFrame!==document.querySelector('.viewport-mount canvas').toDataURL()`);
    assert.equal(evaluate(`document.querySelector('.ripple-toggle').getAttribute('aria-pressed')`),'true','Section ripple keeps playing');
    click('.view-modes button:first-child');settled();
    stableCamera(composed,'Section to Studio roundtrip');playing('Section to Studio roundtrip');

    click(mobileButton('More'));
    run('find','role','menuitem','click','--name','Entropy');
    run('wait','--fn',`!document.querySelector('[role="menu"]')`);settled();
    assert.equal(readModel().baseEnabled,false,'Entropy starts a composition of shapes');
    assert.ok(readModel().shapes.length>=3,'Entropy generates several shapes');
    stableCamera(composed,'generate Entropy');playing('generate Entropy');
    run('screenshot',join(output,`generated-entropy-${width}x${height}.png`));
    if(fullCheck){
      click(mobileButton('Undo'));settled();
      assert.equal(readModel().shapes.length,2,'undo restores the edited Sphere and Box');
      assert.equal(readModel().shapes.at(-1).id,shape.id);
      stableCamera(composed,'undo Entropy');playing('undo Entropy');
    }
    run('screenshot',join(output,`entropy-${width}x${height}.png`));
    assert.deepEqual(run('errors').errors,[]);
    if(fullCheck){
      run('wait','--fn',`JSON.parse(localStorage.getItem('form-sketchbook-v1'))?.model?.shapes?.at(-1)?.id===${JSON.stringify(shape.id)}`);
      run('reload');
      await cdp('Emulation.setTouchEmulationEnabled',{enabled:true,maxTouchPoints:5});
      assert.equal(evaluate(`matchMedia('(pointer:coarse)').matches`),true,'restored mobile pointer media query');
      run('wait','.viewport-mount canvas');settled();
      assert.equal(readModel().shapes.length,2,'shapes survive reload');
      assert.equal(readModel().shapes.at(-1).id,shape.id);
      playing('restore saved shapes');
      console.log(`PASS ${width}x${height}: shapes, Merge/Cut/Intersect, blend, Entropy, undo, persistence, continuous ripple and camera composition`);
    }else console.log(`PASS ${width}x${height}: sheets, shape insert, operation/blend reachability, Section animation, Entropy and camera roundtrip`);
  }
}finally{cdpSocket?.close();run('close')}
