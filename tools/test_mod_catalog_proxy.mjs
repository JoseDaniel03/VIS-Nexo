import assert from 'node:assert/strict';
import {curseforgeSearch} from '../services/social/mod-catalog.mjs';
const input={provider:'curseforge',query:'map',version:'26.3',engine:'horizon'};
assert.equal((await curseforgeSearch(input,{})).status,503);
let calls=0;
const result=await curseforgeSearch(input,{CURSEFORGE_API_KEY:'test-key'},async(url,options)=>{calls++;assert.equal(new URL(url).hostname,'api.curseforge.com');assert.equal(options.headers['x-api-key'],'test-key');assert.equal(options.redirect,'error');return Response.json({data:[{id:7,name:'Map',slug:'map',allowModDistribution:false}]});});
assert.equal(calls,1);assert.equal(result.body.items[0].compatibility,'requires_port');assert.equal(result.body.items[0].installable,false);assert.equal(result.body.items[0].distribution_allowed,false);assert(!JSON.stringify(result).includes('test-key'));
assert.equal((await curseforgeSearch({...input,version:'../bad'},{CURSEFORGE_API_KEY:'test-key'},()=>{throw Error('must not fetch');})).status,400);
console.log('Catalog proxy: fixed host, server-only secret, distribution flag and compatibility passed');
