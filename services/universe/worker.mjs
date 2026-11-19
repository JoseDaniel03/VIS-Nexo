// VIS Universe distribution. Publishing requires a long secret set via Cloudflare Secrets.
// Never include VIS_PUBLISH_TOKEN in VIS Nexo or in GitHub.
export default { fetch: async function universeServe(request, env) {
  const reply=(data,status=200)=>new Response(JSON.stringify(data),{status,headers:{"Content-Type":"application/json; charset=utf-8","Cache-Control":"no-store"}});
  const url=new URL(request.url);
  const extTypes={png:"image/png",jpg:"image/jpeg",webp:"image/webp"};
  const assetPattern=/^\/assets\/([a-f0-9]{64})\.(png|jpg|webp)$/;
  const packagePattern=/^\/packs\/([a-z0-9][a-z0-9_-]{0,99})\/([a-f0-9]{64})\.zip$/;
  const packageMatch=packagePattern.exec(url.pathname);
  const releasesPath=/^\/releases\/([a-z0-9][a-z0-9_-]{0,99})\.json$/.exec(url.pathname);
  const validRelease=value=>typeof value==="string" && value.length>0 && value.length<=40 &&
    value!=="." && value!==".." && /^[a-zA-Z0-9._-]+$/.test(value);
  if(request.method==="GET" && url.pathname==="/catalog.json"){
    const object=await env.UNIVERSE.get("catalog.json");
    return object?new Response(object.body,{headers:{"Content-Type":"application/json; charset=utf-8","Cache-Control":"no-cache, max-age=0"}}):reply({format_version:1,projects:[]});
  }
  // Historial público: solo releases con paquetes comprobados SHA-256.
  if(request.method==="GET" && releasesPath){
    const projectId=releasesPath[1];
    const object=await env.UNIVERSE.get("releases-index/"+projectId+".json");
    return object?new Response(object.body,{headers:{"Content-Type":"application/json; charset=utf-8","Cache-Control":"no-cache, max-age=0","X-Content-Type-Options":"nosniff"}}):
      reply({project_id:projectId,releases:[]});
  }
  if(request.method==="GET" && assetPattern.test(url.pathname)){
    const object=await env.UNIVERSE.get(url.pathname.slice(1));
    const ext=assetPattern.exec(url.pathname)[2];
    return object?new Response(object.body,{headers:{"Content-Type":extTypes[ext],"Cache-Control":"public, max-age=31536000, immutable","X-Content-Type-Options":"nosniff"}}):reply({error:"Not found"},404);
  }
  if(request.method==="GET"&&packageMatch){
    const object=await env.UNIVERSE.get(url.pathname.slice(1));
    return object?new Response(object.body,{headers:{
      "Content-Type":"application/zip",
      "Content-Disposition":"attachment",
      "Cache-Control":"public, max-age=31536000, immutable",
      "X-Content-Type-Options":"nosniff"
    }}):reply({error:"Not found"},404);
  }
  if(!(request.method==="POST"&&url.pathname==="/publish")
      &&!(request.method==="PUT"&&packageMatch))
    return reply({error:"Not found"},404);
  const secret=env.VIS_PUBLISH_TOKEN;
  const supplied=request.headers.get("Authorization")||"";
  const expected=typeof secret==="string"&&secret.length>=32?`Bearer ${secret}`:"";
  if(!expected||supplied.length!==expected.length)return reply({error:"Unauthorized"},401);
  const a=new Uint8Array(await crypto.subtle.digest("SHA-256",new TextEncoder().encode(supplied)));
  const b=new Uint8Array(await crypto.subtle.digest("SHA-256",new TextEncoder().encode(expected)));
  let diff=0;for(let i=0;i<a.length;i++)diff|=a[i]^b[i];
  if(diff!==0)return reply({error:"Unauthorized"},401);
  if(request.method==="PUT"){
    const release={
      engine:request.headers.get("x-vis-engine"),
      minecraft_version:request.headers.get("x-vis-minecraft-version"),
      loader:request.headers.get("x-vis-loader"),
      loader_version:request.headers.get("x-vis-loader-version")||"",
      release_version:request.headers.get("x-vis-release-version")||""
    };
    if(!["java","horizon"].includes(release.engine)
      ||!["vanilla","fabric","horizon"].includes(release.loader)
      ||!(/^[a-zA-Z0-9._+-]{1,40}$/.test(release.minecraft_version||""))
      ||!(/^[a-zA-Z0-9._+-]{0,50}$/.test(release.loader_version))
      ||(release.engine==="horizon"&&(release.loader!=="horizon"||release.minecraft_version!=="26.3"))
      ||(release.engine==="java"&&release.loader==="horizon")
      ||(release.release_version!==""&&!validRelease(release.release_version)))
      return reply({error:"Invalid project version or loader"},400);
    const limit=32*1024*1024,header=Number(request.headers.get("Content-Length")||0);
    if(header>limit)return reply({error:"Pack exceeds 32 MiB"},413);
    let bytes;
    try{
      const reader=request.body?.getReader();
      if(!reader)return reply({error:"Archive required"},400);
      let total=0;const parts=[];
      while(true){
        const {done,value}=await reader.read();if(done)break;
        total+=value.byteLength;
        if(total>limit){await reader.cancel();return reply({error:"Pack exceeds 32 MiB"},413);}
        parts.push(value);
      }
      bytes=new Uint8Array(total);let offset=0;
      for(const part of parts){bytes.set(part,offset);offset+=part.byteLength;}
    }catch{return reply({error:"Invalid upload stream"},400);}
    // Deep ZIP/path validation happens during construction in VIS Nexo and at
    // import, before any file can be installed. R2 remains a byte store.
    if(bytes.length<22||bytes[0]!==80||bytes[1]!==75||bytes[2]!==3||bytes[3]!==4)
      return reply({error:"Expected VIS ZIP project package"},400);
    const hash=[...new Uint8Array(await crypto.subtle.digest("SHA-256",bytes))]
      .map(x=>x.toString(16).padStart(2,"0")).join("");
    if(hash!==packageMatch[2])return reply({error:"Package digest mismatch"},422);
    const key=url.pathname.slice(1);
    await env.UNIVERSE.put(key,bytes,{httpMetadata:{contentType:"application/zip"}});
    const pointer={url:url.origin+url.pathname,sha256:hash,size_bytes:bytes.length,...release};
    await env.UNIVERSE.put("team-packages/"+packageMatch[1]+".json",JSON.stringify(pointer),{
      httpMetadata:{contentType:"application/json; charset=utf-8"}});
    return reply({ok:true,project_id:packageMatch[1],...pointer});
  }
  const MAX_SIZE=18*1024*1024;
  let value;
  try{
    if(Number(request.headers.get("Content-Length")||0)>MAX_SIZE)return reply({error:"Too large"},413);
    const reader=request.body.getReader(),chunks=[];let size=0;
    while(true){const {done,value:part}=await reader.read();if(done)break;size+=part.byteLength;if(size>MAX_SIZE)return reply({error:"Too large"},413);chunks.push(part);}
    const bytes=new Uint8Array(size);let pos=0;for(const p of chunks){bytes.set(p,pos);pos+=p.length;}
    value=JSON.parse(new TextDecoder("utf-8",{fatal:true}).decode(bytes));
  }catch{return reply({error:"Invalid JSON"},400);}
  if(value?.format_version!==1||!Array.isArray(value.projects)||value.projects.length>100)return reply({error:"Invalid publication"},400);
  const ids=new Set(),out=[],releaseWrites=[];
  const lockedRoots=p=>p && (p.lock_mods||p.lock_resourcepacks||p.lock_shaderpacks||p.lock_datapacks||p.lock_config);
  const safeProtection=p=>{
    if(p==null)return true;
    if(typeof p!=="object"||Array.isArray(p))return false;
    const version=p.release_version||"";
    if(version!==""&&!validRelease(version))return false;
    const hashes=p.file_hashes||{};
    if(!hashes||typeof hashes!=="object"||Array.isArray(hashes)||Object.keys(hashes).length>1500)return false;
    const locked=new Set([...Object.entries({
      mods:p.lock_mods,resourcepacks:p.lock_resourcepacks,shaderpacks:p.lock_shaderpacks,
      datapacks:p.lock_datapacks,config:p.lock_config,defaultconfigs:p.lock_config
    })].filter(([,value])=>value).map(([key])=>key));
    for(const [path,digest] of Object.entries(hashes)){
      const pieces=path.split("/");
      if(pieces.length<2||!locked.has(pieces[0])||pieces.some(x=>!x||x==="."||x===".."||x.length>255)||path.includes("\\")||
        typeof digest!=="string"||!/^[a-fA-F0-9]{64}$/.test(digest))return false;
    }
    if(p.verify_on_launch&&lockedRoots(p)&&!p.sealed)return false;
    return true;
  };
  async function publishImage(path){
    if(typeof path!=="string"||!path)return "";
    const existing=/^\/assets\/([a-f0-9]{64})\.(png|jpg|webp)$/.exec(new URL(path,url.origin).pathname);
    if(existing&&path.startsWith(url.origin+"/assets/"))return path;
    const m=/^data:image\/(png|jpeg|webp);base64,([A-Za-z0-9+/=]+)$/.exec(path);
    if(!m||m[2].length>5600000)return "";
    const ext=m[1]==="jpeg"?"jpg":m[1];
    let bytes;try{bytes=Uint8Array.from(atob(m[2]),ch=>ch.charCodeAt(0));}catch{throw Error("invalid base64");}
    if(bytes.length>4*1024*1024||bytes.length<12)throw Error("image too large");
    const magic=ext==="png"?(bytes[0]===137&&bytes[1]===80&&bytes[2]===78&&bytes[3]===71):ext==="jpg"?(bytes[0]===255&&bytes[1]===216&&bytes[2]===255):(String.fromCharCode(...bytes.slice(0,4))==="RIFF"&&String.fromCharCode(...bytes.slice(8,12))==="WEBP");
    if(!magic)throw Error("invalid image");
    const hash=[...new Uint8Array(await crypto.subtle.digest("SHA-256",bytes))].map(v=>v.toString(16).padStart(2,"0")).join("");
    await env.UNIVERSE.put(`assets/${hash}.${ext}`,bytes,{httpMetadata:{contentType:extTypes[ext]}});
    return `${url.origin}/assets/${hash}.${ext}`;
  }
  for(const input of value.projects){
    if(!input||typeof input!=="object"||typeof input.id!=="string"||!/^[a-z0-9][a-z0-9_-]{0,99}$/i.test(input.id)||ids.has(input.id)||
      typeof input.title!=="string"||input.title.length<1||input.title.length>100||
      typeof input.description!=="string"||input.description.length>2000||
      typeof input.mc_version!=="string"||input.mc_version.length>40||
      !["java","horizon"].includes(input.engine)||!["vanilla","fabric","horizon"].includes(input.loader)||
      (input.engine==="horizon"&&(input.loader!=="horizon"||input.mc_version!=="26.3"))||
      !Array.isArray(input.posts)||input.posts.length>100||!Array.isArray(input.calendar)||input.calendar.length>100||
      input.posts.some(x=>!x||typeof x.title!=="string"||x.title.length>120||typeof x.body!=="string"||x.body.length>4000)||
      input.calendar.some(x=>!x||typeof x.title!=="string"||x.title.length>120||typeof x.description!=="string"||x.description.length>4000)||
      !safeProtection(input.protection))
      return reply({error:"Invalid project"},400);
    ids.add(input.id);
    const project=structuredClone(input);
    try{for(const field of ["banner_path","logo_path","icon_path"])project[field]=await publishImage(project[field]);}
    catch{return reply({error:"Invalid project image"},400);}
    const version=new Date().toISOString().replace(/[-:.TZ]/g,"").slice(0,14);
    const releaseVersion=project.protection?.release_version||"";
    let packageInfo={url:"",sha256:"",size_bytes:0};
    const pointer=await env.UNIVERSE.get("team-packages/"+project.id+".json");
    if(pointer){
      try{
        const candidate=JSON.parse(await pointer.text());
        if(candidate&&typeof candidate.url==="string"
            &&candidate.url.startsWith(url.origin+"/packs/"+project.id+"/")
            &&/^[a-f0-9]{64}$/.test(candidate.sha256)
            &&Number.isSafeInteger(candidate.size_bytes)&&candidate.size_bytes>0
            &&candidate.size_bytes<=32*1024*1024
            &&candidate.engine===project.engine
            &&candidate.minecraft_version===project.mc_version
            &&candidate.loader===project.loader
            &&candidate.loader_version===(project.loader_version||"")
            &&(candidate.release_version||"")===releaseVersion){
          packageInfo=candidate;
        }
      }catch{return reply({error:"Invalid team package metadata"},500);}
    }
    out.push({id:project.id,name:project.title,description:project.description,version,
      release_version:releaseVersion,minecraft_version:project.mc_version,loader:project.loader,
      bundle_url:packageInfo.url,sha256:packageInfo.sha256,size_bytes:packageInfo.size_bytes,project});
    if(releaseVersion && packageInfo.sha256){
      const indexKey="releases-index/"+project.id+".json";
      const saved=await env.UNIVERSE.get(indexKey);
      let history;
      try{history=saved?JSON.parse(await saved.text()):{project_id:project.id,releases:[]};}
      catch{return reply({error:"Release history corrupted"},500);}
      if(history?.project_id!==project.id||!Array.isArray(history.releases)||history.releases.length>50)
        return reply({error:"Invalid release history"},500);
      const existing=history.releases.find(x=>x.version===releaseVersion);
      if(existing && existing.sha256!==packageInfo.sha256)
        return reply({error:"This release version is immutable. Choose a new release_version"},409);
      if(!existing){
        if(history.releases.length>=50)return reply({error:"Release history limit reached"},409);
        history.releases.unshift({
          version:releaseVersion,sha256:packageInfo.sha256,size_bytes:packageInfo.size_bytes,
          bundle_url:packageInfo.url,engine:project.engine,minecraft_version:project.mc_version,
          loader:project.loader,loader_version:project.loader_version||"",published_at:version
        });
        releaseWrites.push([indexKey,JSON.stringify(history)]);
      }
    }
  }
  const doc=JSON.stringify({format_version:1,projects:out});
  if(new TextEncoder().encode(doc).length>2*1024*1024)return reply({error:"Catalog too large"},413);
  for(const [key,history] of releaseWrites){
    await env.UNIVERSE.put(key,history,{httpMetadata:{contentType:"application/json; charset=utf-8"}});
  }
  await env.UNIVERSE.put("catalog.json",doc,{httpMetadata:{contentType:"application/json; charset=utf-8"}});
  return reply({ok:true,projects:out.length});
} };
