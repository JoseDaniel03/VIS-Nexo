import assert from 'node:assert/strict';
import {createWorldsPortals} from '../web/worlds-portals.js';
let sharing=false,canJoin=false,accepted=0,owner='alice';
const events=[];
const command=async(name,args)=>{
 if(name==='portals_games')return [{pid:10,name:'Survival'}];
 assert.equal(name,'portals_command');
 if(args.action==='host'){sharing=true;return {ok:true};}
 if(args.action==='status')return {sharing,can_join:canJoin,code:'ABCDE-FGHIJ'};
 if(args.action==='stop'){sharing=false;return {ok:true};}
 if(args.action==='join'){events.push(['join',args.code]);return {ok:true};}
 throw Error('unexpected command');
};
const social={connected:()=>true,hostWorld:async id=>events.push(['host',id]),closeWorld:async id=>events.push(['close',id]),inviteWorld:async(...args)=>events.push(['invite',...args]),acceptWorld:async()=>{accepted++;return 'ABCDE-FGHIJ';}};
const portals=createWorldsPortals(command,social,()=>owner,()=>{throw Error('should not select');},error=>{throw error;});
await portals.invite('bob');
assert.equal(sharing,true);
assert.equal(events.find(e=>e[0]==='invite')[1],'bob');
assert.equal(events.find(e=>e[0]==='invite')[3],'ABCDE-FGHIJ');
await assert.rejects(()=>portals.join('invitation'),/cerrá tu mundo/);
assert.equal(accepted,0,'never consume an invite while a world is open');
canJoin=true;await portals.join('invitation');
assert.equal(accepted,1);assert.deepEqual(events.at(-1),['join','ABCDE-FGHIJ']);
await portals.stop();
assert.equal(sharing,false);assert.equal(events.at(-1)[0],'close');
console.log('VIS Portals UI flow: host, invite, safe acceptance, native join and stop passed');

