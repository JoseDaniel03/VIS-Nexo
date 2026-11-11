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
// Publish a Fabric project with a bounded declarative Modrinth content list.
const fabric={...project,id:"fabric-world",engine:"java",loader:"fabric",mc_version:"1.21.4",
  required_mods:["fabric-api","sodium"],required_resourcepacks:["faithful"],required_shaders:[]};
const headers={Authorization:"Bearer "+env.VIS_PUBLISH_TOKEN};
response=await worker.fetch(new Request(base+"/publish",{method:"POST",headers,
  body:JSON.stringify({format_version:1,projects:[fabric]})}),env);
assert.equal(response.status,200);
response=await worker.fetch(new Request(base+"/catalog.json"),env);
assert.deepEqual((await response.json()).projects[0].project.required_mods,["fabric-api","sodium"]);
// Reject incompatible, duplicate and excessive manifests before any R2 write.
for(const bad of [
  {...fabric,loader:"vanilla"},
  {...fabric,required_mods:["sodium","SODIUM"]},
  {...fabric,required_mods:["../evil"]},
  {...fabric,required_mods:Array.from({length:33},(_,i)=>"mod"+i)},
  {...fabric,engine:"horizon",loader:"horizon",mc_version:"26.3"}
]){
  response=await worker.fetch(new Request(base+"/publish",{method:"POST",headers,
    body:JSON.stringify({format_version:1,projects:[bad]})}),env);
  assert.equal(response.status,400);
}
response=await worker.fetch(new Request(base+"/catalog.json"),env);
assert.equal((await response.json()).projects[0].project.engine,"java");
console.log("VIS Universe Worker tests passed");
