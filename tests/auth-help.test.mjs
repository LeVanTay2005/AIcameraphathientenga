import {test} from 'node:test';
import assert from 'node:assert/strict';
import {parseFirebaseConfig,loginError} from '../public/auth-help.js';
const config={apiKey:'test-api-key',projectId:'group-project',storageBucket:'group-project.firebasestorage.app',appId:'test-app'};
test('accepts JSON and Firebase Console object without evaluating code',()=>{
  assert.deepEqual(parseFirebaseConfig(JSON.stringify(config)),config);
  const object='const firebaseConfig = { apiKey: "test-api-key", projectId: "group-project", storageBucket: "group-project.firebasestorage.app", appId: "test-app", };';
  assert.deepEqual(parseFirebaseConfig(object),config);
  assert.throws(()=>parseFirebaseConfig('(()=>{throw Error("execute");})()'));
});
test('rejects server credentials and missing placeholder values',()=>{
  assert.throws(()=>parseFirebaseConfig('{"type":"service_account","private_key":"secret"}'),/service-account/);
  assert.throws(()=>parseFirebaseConfig(JSON.stringify({...config,apiKey:'…'})),/apiKey/);
  assert.throws(()=>parseFirebaseConfig('[]'),/đối tượng/);
});
test('login explains provider, configuration, credentials and network errors',()=>{
  assert.match(loginError({code:'auth/operation-not-allowed'}),/Email\/Password/);
  assert.match(loginError({code:'auth/invalid-credential'}),/Email hoặc mật khẩu/);
  assert.match(loginError({code:'auth/network-request-failed'}),/Internet/);
  assert.match(loginError({message:'Chưa cấu hình Firebase'}),/Chưa cấu hình/);
});
