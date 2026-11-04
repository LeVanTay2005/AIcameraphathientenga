import {test} from 'node:test';
import assert from 'node:assert/strict';
import {setupRemote} from '../public/remote.js';
function fixture(cloud,stream=null){
  const elements=new Map();globalThis.document={getElementById:id=>{if(!elements.has(id))elements.set(id,{value:id==='room'?'camera-nha':'',textContent:'',disabled:false,srcObject:null});return elements.get(id);}};
  const messages=[];const remote=setupRemote({getCloud:()=>cloud,getStream:()=>stream,notice:(text)=>messages.push(text),refresh:()=>{}});
  return {elements,messages,remote};
}
test('remote viewing requires a configured, permanent account',async()=>{
  const a=fixture(null);await a.elements.get('watch').onclick();assert.match(a.messages[0],/Firebase/);
  const b=fixture({user:{isAnonymous:true}});await b.elements.get('watch').onclick();assert.match(b.messages[0],/email/);
});
test('broadcast requires a running local camera',async()=>{
  const f=fixture({user:{uid:'u',isAnonymous:false}});await f.elements.get('broadcast').onclick();assert.match(f.messages[0],/Bật camera/);
});
test('viewer negotiates receive-only video and stop closes its connection',async()=>{
  const writes=[],connections=[];let deleted=false;
  globalThis.RTCPeerConnection=class{
    constructor(){this.connectionState='new';this.signalingState='stable';connections.push(this);}
    addTransceiver(kind,opts){this.transceiver={kind,...opts};}
    async createOffer(){return {type:'offer',sdp:'test-sdp'};}
    async setLocalDescription(desc){this.localDescription=desc;}
    close(){this.signalingState='closed';}
  };
  const c={user:{uid:'u',isAnonymous:false},store:{},f:{collection:(_,...parts)=>({path:parts.join('/')}),doc:ref=>({path:ref.path+'/viewer1',id:'viewer1'}),onSnapshot:()=>()=>{},setDoc:async(ref,data)=>writes.push({ref,data}),deleteDoc:async()=>{deleted=true;}}};
  const f=fixture(c);await f.elements.get('watch').onclick();assert.equal(writes[0].data.offer.type,'offer');assert.equal(connections[0].transceiver.direction,'recvonly');assert.equal(f.elements.get('watch').disabled,true);f.remote.stop();assert.equal(connections[0].signalingState,'closed');assert.equal(deleted,true);assert.equal(f.elements.get('watch').disabled,false);
});
