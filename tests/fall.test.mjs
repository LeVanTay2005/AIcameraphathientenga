import {test} from 'node:test';
import assert from 'node:assert/strict';
import {FallDetector} from '../public/fall.js';
const pose=(horizontal=false)=>{const p=Array.from({length:33},()=>({x:.5,y:.5,visibility:1}));p[11]=p[12]={x:horizontal?.2:.5,y:.3,visibility:1};p[23]=p[24]={x:.5,y:horizontal?.32:.6,visibility:1};return p;};
test('requires upright then sustained horizontal posture and suppresses repeats',()=>{const d=new FallDetector();assert.equal(d.update(pose(true),0),false);d.update(pose(),100);assert.equal(d.update(pose(true),500),false);assert.equal(d.update(pose(true),1400),true);d.update(pose(),1500);d.update(pose(true),1600);assert.equal(d.update(pose(true),2500),false);});
test('ignores occluded poses and stale upright observations',()=>{const d=new FallDetector();d.update(pose(),0);d.update(pose(true),5000);assert.equal(d.update(pose(true),6000),false);const p=pose(true);p[11]={...p[11],visibility:.2};d.update(pose(),7000);assert.equal(d.update(p,7500),false);assert.equal(d.update(p,9000),false);});
