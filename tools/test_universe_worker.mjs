import assert from "node:assert/strict";
import worker from "../services/universe/worker.mjs";
const data=new Map();
const env={VIS_PUBLISH_TOKEN:"a".repeat(40),UNIVERSE:{
  async put(key,value){data.set(key,value instanceof Uint8Array?value:new TextEncoder().encode(String(value)))},
  async get(key){return data.has(key)?{body:data.get(key)}:null}
}};
const base="https://vis-jose.workers.dev";
let response=await worker.fetch(new Request(base+"/catalog.json"),env);
assert.equal((await response.json()).projects.length,0);
const project={id:"virgoland",title:"Virgoland",subtitle:"",description:"Un proyecto",
  mc_version:"26.3",engine:"horizon",loader:"horizon",loader_version:"",installable:true,
  versions:[],page_scene_id:null,banner_path:"",logo_path:"",icon_path:"",
  visible_sections:{},notes:"",community_url:"",posts:[],calendar:[]};
const body=JSON.stringify({format_version:1,projects:[project]});
response=await worker.fetch(new Request(base+"/publish",{method:"POST",body,headers:{Authorization:"Bearer invalid"}}),env);
assert.equal(response.status,401);
response=await worker.fetch(new Request(base+"/publish",{method:"POST",body,
  headers:{Authorization:"Bearer "+env.VIS_PUBLISH_TOKEN}}),env);
assert.equal(response.status,200);
assert.equal((await response.json()).projects,1);
response=await worker.fetch(new Request(base+"/catalog.json"),env);
assert.equal((await response.json()).projects[0].project.engine,"horizon");
response=await worker.fetch(new Request(base+"/publish",{method:"POST",
  body:JSON.stringify({format_version:1,projects:[{...project,id:"../../etc"}]}),
  headers:{Authorization:"Bearer "+env.VIS_PUBLISH_TOKEN}}),env);
assert.equal(response.status,400);
response=await worker.fetch(new Request(base+"/catalog.json"),env);
assert.equal((await response.json()).projects.length,1);
console.log("VIS Universe Worker tests passed");
