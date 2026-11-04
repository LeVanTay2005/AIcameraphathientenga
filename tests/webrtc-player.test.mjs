import {test} from 'node:test';
import assert from 'node:assert/strict';
import {createWebRTCPlayer} from '../public/webrtc-player.js';

test('WebRTC forwards Firebase bearer token, attaches remote stream, and closes once',()=>{
  let conf,closes=0;class Reader{constructor(options){conf=options;}close(){closes++;}}
  const video={srcObject:null,play:()=>Promise.resolve()},stream={id:'remote'};
  const player=createWebRTCPlayer({video,url:'https://rtc.example/camera/whep',token:'firebase-token',Reader});
  assert.equal(conf.token,'firebase-token');assert.equal(conf.pass,undefined);
  conf.onTrack({streams:[stream]});assert.equal(video.srcObject,stream);
  player.close();player.close();assert.equal(closes,1);assert.equal(video.srcObject,null);
  conf.onTrack({streams:[stream]});assert.equal(video.srcObject,null,'late track cannot reopen closed player');
});
test('rejects raw RTSP, HTTP and camera credentials in WebRTC URL',()=>{
  for(const url of ['rtsp://camera/live','http://rtc.example/camera/whep','https://user:password@rtc.example/camera/whep','https://rtc.example/camera'])
    assert.throws(()=>createWebRTCPlayer({video:{},url,token:'x',Reader:class{}}));
});
