import assert from "node:assert/strict";
import worker from "../services/universe/worker.mjs";
const data=new Map();
const env={VIS_PUBLISH_TOKEN:"a".repeat(40),UNIVERSE:{
  async put(key,value){data.set(key,value instanceof Uint8Array?value:new TextEncoder().encode(String(value)))},
  async get(key){return data.has(key)?{body:data.get(key),text:async()=>new TextDecoder().decode(data.get(key))}:null}
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
const sample=Uint8Array.from([80,75,3,4,...new Array(32).fill(0)]);
const sha=[...new Uint8Array(await crypto.subtle.digest('SHA-256',sample))]
  .map(x=>x.toString(16).padStart(2,'0')).join('');
let packUrl=base+'/packs/virgoland/'+sha+'.zip';
const releaseHeaders={
  'Authorization':'Bearer '+env.VIS_PUBLISH_TOKEN,
  'X-VIS-Engine':'horizon',
  'X-VIS-Minecraft-Version':'26.3',
  'X-VIS-Loader':'horizon',
  'X-VIS-Loader-Version':''
};
response=await worker.fetch(new Request(packUrl,{method:'PUT',body:sample}),env);
assert.equal(response.status,401,'team packs require publisher token');
response=await worker.fetch(new Request(base+'/packs/virgoland/'+'a'.repeat(64)+'.zip',{
  method:'PUT',body:sample,headers:releaseHeaders
}),env);
assert.equal(response.status,422,'team uploads must match SHA-256');
response=await worker.fetch(new Request(base+'/packs/../etc/'+sha+'.zip',{
  method:'PUT',body:sample,headers:releaseHeaders
}),env);
assert.equal(response.status,404,'no path traversal in object keys');
response=await worker.fetch(new Request(packUrl,{
  method:'PUT',body:sample,headers:releaseHeaders
}),env);
assert.equal(response.status,200,'valid SHA-verified pack accepted');
const uploaded=await response.json();
assert.equal(uploaded.sha256,sha);
assert.equal(uploaded.size_bytes,sample.length);
response=await worker.fetch(new Request(packUrl),env);
assert.equal(response.status,200,'immutable pack downloadable');
assert.equal(new Uint8Array(await response.arrayBuffer()).length,sample.length);
response=await worker.fetch(new Request(base+'/publish',{method:'POST',body,
  headers:{Authorization:'Bearer '+env.VIS_PUBLISH_TOKEN}}),env);
assert.equal(response.status,200,'catalog updates after pack upload');
response=await worker.fetch(new Request(base+'/catalog.json'),env);
const published=(await response.json()).projects[0];
assert.equal(published.sha256,sha);
assert.equal(published.size_bytes,sample.length);
assert.equal(published.bundle_url,packUrl);
const different={...project,engine:'java',loader:'fabric',loader_version:'0.17.1',
  mc_version:'1.21.1'};
response=await worker.fetch(new Request(base+'/publish',{method:'POST',
  body:JSON.stringify({format_version:1,projects:[different]}),
  headers:{Authorization:'Bearer '+env.VIS_PUBLISH_TOKEN}}),env);
assert.equal(response.status,200);
const afterChange=(await (await worker.fetch(new Request(base+'/catalog.json'),env)).json()).projects[0];
assert.equal(afterChange.bundle_url,'','stale team package cannot cross versions/loaders');

// Las versiones propias son inmutables y se descargan sin sobrescribir otras.
const protectedProject={...project,protection:{
  release_version:"1.0.0",lock_mods:true,verify_on_launch:true,sealed:true,
  file_hashes:{"mods/example.jar":"a".repeat(64)}
}};
const unsealed={...protectedProject,protection:{...protectedProject.protection,sealed:false}};
const secretHeader={Authorization:"Bearer "+env.VIS_PUBLISH_TOKEN};
response=await worker.fetch(new Request(base+"/publish",{method:"POST",
  body:JSON.stringify({format_version:1,projects:[unsealed]}),headers:secretHeader
}),env);
assert.equal(response.status,400,"a protected release must be sealed before publishing");
response=await worker.fetch(new Request(packUrl,{method:"PUT",body:sample,headers:{
 ...releaseHeaders,"X-VIS-Release-Version":"1.0.0"
}}),env);
assert.equal(response.status,200);
response=await worker.fetch(new Request(base+"/publish",{method:"POST",
  body:JSON.stringify({format_version:1,projects:[protectedProject]}),headers:secretHeader
}),env);
assert.equal(response.status,200,"published release with sealed manifest");
response=await worker.fetch(new Request(base+"/releases/virgoland.json"),env);
const history=(await response.json()).releases;
assert.equal(history.length,1);
assert.equal(history[0].version,"1.0.0");
assert.equal(history[0].sha256,sha);
assert.equal(history[0].bundle_url,packUrl);
assert.equal(history[0].minecraft_version,"26.3");
const secondVersion={...protectedProject,protection:{...protectedProject.protection,release_version:"2.0.0"}};
response=await worker.fetch(new Request(base+"/publish",{method:"POST",
 body:JSON.stringify({format_version:1,projects:[secondVersion]}),headers:secretHeader
}),env);
assert.equal(response.status,200);
const newer=(await (await worker.fetch(new Request(base+"/catalog.json"),env)).json()).projects[0];
assert.equal(newer.bundle_url,"","a package for release 1.0.0 cannot attach to release 2.0.0");
const mutated=Uint8Array.from(sample);mutated[6]=3;
const newSha=[...new Uint8Array(await crypto.subtle.digest("SHA-256",mutated))]
 .map(x=>x.toString(16).padStart(2,"0")).join("");
response=await worker.fetch(new Request(base+"/packs/virgoland/"+newSha+".zip",{
 method:"PUT",body:mutated,headers:{...releaseHeaders,"X-VIS-Release-Version":"1.0.0"}
}),env);
assert.equal(response.status,200,"new content-addressed ZIP uploaded");
response=await worker.fetch(new Request(base+"/publish",{method:"POST",
 body:JSON.stringify({format_version:1,projects:[protectedProject]}),headers:secretHeader
}),env);
assert.equal(response.status,409,"existing release name cannot change its ZIP SHA-256");
const finalHistory=(await (await worker.fetch(new Request(base+"/releases/virgoland.json"),env)).json()).releases;
assert.equal(finalHistory.length,1);
assert.equal(finalHistory[0].sha256,sha,"historic release hash never replaced");

console.log("VIS Universe Worker tests passed");
