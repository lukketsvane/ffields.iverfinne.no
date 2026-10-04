// Run against a served production build: node scripts/mobile-layout-check.mjs http://localhost:3001
// Requires agent-browser and Chromium (AGENT_BROWSER_EXECUTABLE_PATH can select the binary).
import assert from 'node:assert/strict';
import {execFileSync} from 'node:child_process';
import {mkdirSync} from 'node:fs';
import {join} from 'node:path';

const url = process.argv[2] ?? 'http://localhost:3001';
const output = process.env.FFIELDS_SCREENSHOTS ?? '/tmp/ffields-mobile-layout';
const mobileSizes = process.env.FFIELDS_MOBILE_SIZES ? process.env.FFIELDS_MOBILE_SIZES.split(',').map(size => size.split('x').map(Number)) : [[390,703], [320,568], [844,390], [932,430]];
mkdirSync(output, {recursive:true});
let session = 'ffields-layout-mobile';
let touchSocket;
function run(...args) {
  const text = execFileSync('agent-browser', ['--session', session, '--json', ...args], {encoding:'utf8', timeout:60000});
  const response = text.split('\n').filter(line => line.startsWith('{"success":')).map(line => JSON.parse(line)).at(-1);
  assert.ok(response?.success, text);
  return response.data;
}
const evaluate = code => run('eval', code).result;
const settle = () => evaluate('new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(() => resolve(true))))');
const click = selector => {run('click', selector); settle()};
const bounds = () => evaluate(`(() => {
  const rect = selector => {const r=document.querySelector(selector).getBoundingClientRect();return [r.x,r.y,r.width,r.height].map(n=>Math.round(n*100)/100)};
  return {scene:rect('.scene'), modes:rect('.viewport-viewbar'), header:rect('.toolbar'), scroll:[scrollX,scrollY]};
})()`);
function stable(expected, action) {
  assert.deepEqual(bounds(), expected, action);
  assert.equal(evaluate(`['.floating-panel','.asset-browser','.alternatives','.relationship-graph'].filter(s=>{const e=document.querySelector(s);return e&&e.getBoundingClientRect().height>0}).length`), 1, 'one active sheet');
}
const mobileButton = label => `.mobile-dock button[aria-label="${label}"]`;
async function touchInput(enabled) {
  // Resizing through the CLI resets touch emulation; restore it for landscape media queries.
  const endpoint = new URL(run('get', 'cdp-url').cdpUrl);
  endpoint.protocol = 'http:'; endpoint.pathname = '/json/list';
  const targets = await (await fetch(endpoint)).json();
  const page = targets.find(target => target.type === 'page');
  if (touchSocket && touchSocket.readyState !== WebSocket.CLOSED) await new Promise(resolve => {touchSocket.addEventListener('close', resolve, {once:true});touchSocket.close()});
  const socket = new WebSocket(page.webSocketDebuggerUrl);
  touchSocket = socket;
  await new Promise((resolve, reject) => {socket.addEventListener('open', resolve, {once:true}); socket.addEventListener('error', reject, {once:true})});
  await new Promise((resolve, reject) => {
    socket.addEventListener('message', event => {const message=JSON.parse(event.data);if(message.id===1){if(message.error)reject(Error(message.error.message));else resolve()}}, {once:true});
    socket.send(JSON.stringify({id:1,method:'Emulation.setTouchEmulationEnabled',params:{enabled,maxTouchPoints:enabled?5:1}}));
  });
  // Emulation ends when its CDP session detaches. Keep the socket until the next viewport/session.
}
function menu(name) {
  click(mobileButton('More'));
  run('wait', '[role="menuitem"]');
  run('find', 'role', 'menuitem', 'click', '--name', name);
  run('wait', '--fn', `!document.querySelector('[role="menu"]')`);
  settle();
}

try {
  run('set', 'device', 'iPhone 15');
  for (const [width, height] of mobileSizes) {
    run('set', 'viewport', String(width), String(height));
    run('open', url);
    await touchInput(true);
    assert.equal(evaluate('matchMedia("(pointer:coarse)").matches'), true);
    run('wait', '.viewport-mount canvas, .viewport-error');
    run('wait', '--fn', `!document.querySelector('.evaluating')`);
    settle();
    // Layout-only checks can pause explicitly on slow software-rendered CI machines.
    // Continuous playback is covered separately by entropy-workspace-check.mjs.
    if (process.env.FFIELDS_LAYOUT_PAUSE === '1') click('.ripple-toggle');
    assert.equal(evaluate('getComputedStyle(document.querySelector(".mobile-dock")).display'), 'flex');
    const initial = bounds();
    click(mobileButton('Parameters'));
    stable(initial, 'open Parameters');
    if (width === 390) {
      click('.panel-grip');
      stable(initial, 'resize inspector');
      click('.panel-grip');
      run('fill', 'input[aria-label="Amplitude value"]', '6');
      run('press', 'Enter');
      settle();
      stable(initial, 'edit numeric value');
      assert.equal(evaluate(`document.querySelector(${JSON.stringify('input[aria-label="Amplitude value"]')}).value`), '6');
      // Headless browsers have no software keyboard. Simulate its visual viewport while retaining layout dimensions.
      run('focus', 'input[aria-label="Position Y"]');
      evaluate(`Object.defineProperty(visualViewport,'height',{configurable:true,value:400});visualViewport.dispatchEvent(new Event('resize'))`);
      settle(); settle();
      stable(initial, 'keyboard opens without resizing canvas');
      assert.equal(evaluate('document.querySelector(".form-app").style.getPropertyValue("--keyboard-inset")'), '303px');
      assert.ok(evaluate(`document.querySelector(${JSON.stringify('input[aria-label="Position Y"]')}).getBoundingClientRect().bottom <= 400`), 'focused value stays above keyboard');
      evaluate(`Object.defineProperty(visualViewport,'scale',{configurable:true,value:1.5});visualViewport.dispatchEvent(new Event('resize'))`);
      settle(); settle();
      assert.equal(evaluate('document.querySelector(".form-app").style.getPropertyValue("--keyboard-inset")'), '0px', 'pinch zoom is not a keyboard');
      evaluate(`delete visualViewport.height;delete visualViewport.scale;document.activeElement.blur();visualViewport.dispatchEvent(new Event('resize'))`);
      settle(); settle();
    }
    run('wait', '--fn', `!document.querySelector('.evaluating')`);
    run('screenshot', join(output, `parameters-${width}x${height}.png`));
    click(mobileButton('Model'));
    stable(initial, 'switch to Model');
    click(mobileButton('Insert shape, asset or field'));
    stable(initial, 'open Insert');
    click('.view-modes button:nth-child(3)');
    stable(initial, 'Section with Insert open');
    assert.ok(evaluate('document.querySelector(".section-control").getBoundingClientRect().width > 0'));
    click('.view-modes button:first-child');
    run('fill', 'input[aria-label="Search assets and fields"]', 'camera');
    settle();
    stable(initial, 'search Insert');
    click(mobileButton('Parameters'));
    stable(initial, 'Parameters closes Insert');
    menu('Variants');
    stable(initial, 'open Variants');
    menu('Relationships');
    stable(initial, 'open Relationships');
    click('button[aria-label="Close relationships"]');
    assert.deepEqual(bounds(), initial, 'close sheet');
    click('button[aria-label="File"]');
    assert.deepEqual(bounds(), initial, 'open File menu');
    run('press', 'Escape');
    settle();
    assert.deepEqual(bounds(), initial, 'close File menu');
    assert.deepEqual(run('errors').errors, []);
    console.log(`PASS ${width}x${height}: stable canvas, controls, sheets, editing and menus`);
  }
  run('close');
  session = 'ffields-layout-desktop';
  for (const [width,height] of [[1280,800],[960,500]]) {
    run('set', 'viewport', String(width), String(height));
    run('open', url);
    await touchInput(false);
    run('wait', '.viewport-mount canvas, .viewport-error');
    settle();
    assert.equal(evaluate('matchMedia("(pointer:fine)").matches'), true);
    assert.equal(evaluate('getComputedStyle(document.querySelector(".mobile-dock")).display'), 'none');
    assert.ok(evaluate('document.querySelector(".outline-panel").getBoundingClientRect().width > 0'));
    assert.ok(evaluate('document.querySelector(".floating-panel").getBoundingClientRect().width > 0'));
    assert.deepEqual(run('errors').errors, []);
    run('screenshot', join(output, `desktop-${width}x${height}.png`));
    console.log(`PASS ${width}x${height}: desktop side panels preserved`);
  }
} finally {
  touchSocket?.close();
  run('close');
}
