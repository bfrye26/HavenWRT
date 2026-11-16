import assert from 'node:assert/strict';
import {readFileSync,readdirSync} from 'node:fs';
import {join} from 'node:path';
const roots=['moci','integrations/docker-manager/moci-app-docker/files'];
for(const root of roots){
  for(const entry of readdirSync(root,{recursive:true,withFileTypes:true})){
    if(!entry.isFile() || !/\.(js|css|html|json)$/.test(entry.name))continue;
    const path=join(entry.parentPath || entry.path,entry.name);
    const text=readFileSync(path,'utf8');
    assert(!/[\u0000-\u0008\u000b\u000c\u000e-\u001f\ufffd]/.test(text),
      `Invalid control or replacement character in ${path}`);
  }
}
const html=readFileSync('moci/index.html','utf8');
// Redesigned dashboard uses an em-dash placeholder, ellipsis loading text, and
// HTML entities for the check / menu / arrow icons (SVG replaces the old glyphs).
for(const symbol of ['\u2014','\u2026']){
  assert(html.includes(symbol),`Dashboard symbol U+${symbol.codePointAt(0).toString(16)} was lost`);
}
for(const entity of ['&#10003;','&#8943;','&rarr;']){
  assert(html.includes(entity),`Dashboard entity ${entity} was lost`);
}
console.log('UI text encoding passed: UTF-8 symbols retained and control characters absent.');
