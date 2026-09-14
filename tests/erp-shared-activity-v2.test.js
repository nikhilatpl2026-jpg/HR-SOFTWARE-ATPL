'use strict';
const assert=require('assert');
const s=require('../erp-shared-activity-v2.js');
const d=s.sharedDoc({id:'SYNTH-DOC',assigned_user_id:'SYNTH-USER-2',visibility:'assigned',document_name:'Synthetic'});
assert.strictEqual(d.assigned_user_id,'');
assert.strictEqual(d.visibility,'all');
assert.strictEqual(d._original_assigned_user_id,'SYNTH-USER-2');
assert.strictEqual(s.hasFeature({admin:true},'hrdocs'),true);
assert.strictEqual(s.hasFeature({admin:false,access:['hrdocs']},'hrdocs'),true);
const events=[
 {ts:1000,user_id:'SYNTH-U1',page:'sync',type:'click',action:'Save'},
 {ts:1100,user_id:'SYNTH-U1',page:'sync',type:'click',action:'Save'},
 {ts:2000,user_id:'SYNTH-U2',page:'hrdocs',type:'open',action:'Open'}
];
assert.strictEqual(s.dedupeEvents(events).length,2);
console.log('erp-shared-activity-v2.test.js: all assertions passed');
