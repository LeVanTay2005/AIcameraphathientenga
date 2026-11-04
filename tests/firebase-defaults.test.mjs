import {test} from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {loadFirebaseDefaults} from '../public/firebase-defaults.js';

test('bundled Firebase config targets the user project and contains no server key',async()=>{
  const config=JSON.parse(await readFile('public/firebase-config.json','utf8'));
  assert.equal(config.projectId,'fall-detection-iot-1be15');
  const allowed=['apiKey','authDomain','projectId','storageBucket','messagingSenderId','appId','measurementId','databaseURL'];
  assert.ok(Object.keys(config).every(key=>allowed.includes(key)));
  assert.equal(config.private_key,undefined);assert.equal(config.client_email,undefined);
  assert.ok(config.apiKey&&config.appId&&config.messagingSenderId);
});
test('loads public defaults and rejects unavailable or privileged configuration',async()=>{
  const config=JSON.parse(await readFile('public/firebase-config.json','utf8'));
  let requested;
  const loaded=await loadFirebaseDefaults(async path=>{requested=path;return {ok:true,json:async()=>config};});
  assert.equal(requested,'/firebase-config.json');assert.equal(loaded.projectId,config.projectId);
  await assert.rejects(loadFirebaseDefaults(async()=>({ok:false})),/Firebase/);
  await assert.rejects(loadFirebaseDefaults(async()=>({ok:true,json:async()=>({type:'service_account',private_key:'secret'})})),/service-account/);
});
