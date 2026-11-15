// The official player page keeps touch gestures for the game. With the browser's default
// touch-action, a touch drag on the game reaches it as one pointermove and then pointercancel
// (the browser takes the gesture to pan or zoom), and a horizontal swipe can take the tab back a
// page: measured with DevTools touch input in headless Edge on the memory fixture's map.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

const page=fs.readFileSync(new URL('../player/index.html',import.meta.url),'utf8');
const css=page.slice(page.indexOf('<style>')+7,page.indexOf('</style>'));
const rule=selector=>{const at=css.indexOf(selector+'{');assert.ok(at>=0,`index.html has a ${selector} rule`);return css.slice(at+selector.length+1,css.indexOf('}',at));};

test('the game canvas and its UI layer take every touch gesture themselves',()=>{
 assert.match(rule('#game,#ui-layer'),/(^|;)touch-action:none(;|$)/);
});

test('the page never overscrolls into back navigation or pull-to-refresh',()=>{
 assert.match(rule('html,body'),/(^|;)overscroll-behavior:none(;|$)/);
});
