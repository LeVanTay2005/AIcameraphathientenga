import {test} from 'node:test';
import assert from 'node:assert/strict';
import {readFile,access} from 'node:fs/promises';
import vm from 'node:vm';

test('Pi app DOM references and offline shell assets exist',async()=>{
  const html=await readFile('public/camera.html','utf8'),script=await readFile('public/camera.js','utf8');
  const ids=[...html.matchAll(/\bid="([^"]+)"/g)].map(match=>match[1]);
  assert.equal(new Set(ids).size,ids.length,'no duplicate DOM IDs');
  const dynamic=['eventDialog','eventTitle','eventMedia'];
  for(const [,id] of script.matchAll(/\$\('([^']+)'\)/g))assert.ok(ids.includes(id)||dynamic.includes(id),id);
  const manifest=JSON.parse(await readFile('public/manifest.webmanifest','utf8'));
  assert.equal(manifest.start_url,'/camera.html');
  for(const asset of manifest.icons)await access('public'+asset.src);
  const sw=await readFile('public/sw.js','utf8');
  const shell=JSON.parse(sw.match(/const SHELL=(\[[^;]+\]);/)[1].replaceAll("'",'"'));
  for(const path of shell)await access(path==='/'?'public/index.html':'public'+path);
});

test('background push displays one notification and keeps navigation on the app origin',async()=>{
  const handlers={},notifications=[];let receive;
  const context={URL,encodeURIComponent,importScripts:()=>{},firebase:{initializeApp:()=>{},messaging:()=>({onBackgroundMessage:handler=>{receive=handler;}})},
    self:{location:{href:'https://app.example/push-sw.js?config=%7B%7D',origin:'https://app.example'},addEventListener:(name,fn)=>{handlers[name]=fn;},registration:{showNotification:async(title,options)=>notifications.push({title,options})}},clients:{}};
  vm.runInNewContext(await readFile('public/push-sw.js','utf8'),context);
  await receive({data:{title:'Nghi ngờ té ngã',eventId:'event1',body:'Có video'}});
  assert.equal(notifications.length,1);assert.equal(notifications[0].options.tag,'event1');
  let waited=false;
  handlers.notificationclick({notification:{close:()=>{},data:{url:'https://attacker.example'}},waitUntil:()=>{waited=true;}});
  assert.equal(waited,false,'external URLs cannot be opened by notification payloads');
});
