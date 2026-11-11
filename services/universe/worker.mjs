// VIS Universe distribution. Publishing requires a long secret set via Cloudflare Secrets.
// Never include VIS_PUBLISH_TOKEN in VIS Nexo or in GitHub.
export default { fetch: async function universeServe(request, env) {
  const reply=(data,status=200)=>new Response(JSON.stringify(data),{status,headers:{"Content-Type":"application/json; charset=utf-8","Cache-Control":"no-store"}});
  const url=new URL(request.url);
  const extTypes={png:"image/png",jpg:"image/jpeg",webp:"image/webp"};
  const assetPattern=/^\/assets\/([a-f0-9]{64})\.(png|jpg|webp)$/;
  if(request.method==="GET" && url.pathname==="/catalog.json"){
    const object=await env.UNIVERSE.get("catalog.json");
    return object?new Response(object.body,{headers:{"Content-Type":"application/json; charset=utf-8","Cache-Control":"no-cache, max-age=0"}}):reply({format_version:1,projects:[]});
  }
  if(request.method==="GET" && assetPattern.test(url.pathname)){
    const object=await env.UNIVERSE.get(url.pathname.slice(1));
    const ext=assetPattern.exec(url.pathname)[2];
    return object?new Response(object.body,{headers:{"Content-Type":extTypes[ext],"Cache-Control":"public, max-age=31536000, immutable","X-Content-Type-Options":"nosniff"}}):reply({error:"Not found"},404);
  }
  if(request.method!=="POST"||url.pathname!=="/publish")return reply({error:"Not found"},404);
  const secret=env.VIS_PUBLISH_TOKEN;
  const supplied=request.headers.get("Authorization")||"";
  const expected=typeof secret==="string"&&secret.length>=32?`Bearer ${secret}`:"";
  if(!expected||supplied.length!==expected.length)return reply({error:"Unauthorized"},401);
  const a=new Uint8Array(await crypto.subtle.digest("SHA-256",new TextEncoder().encode(supplied)));
  const b=new Uint8Array(await crypto.subtle.digest("SHA-256",new TextEncoder().encode(expected)));
  let diff=0;for(let i=0;i<a.length;i++)diff|=a[i]^b[i];
  if(diff!==0)return reply({error:"Unauthorized"},401);
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
  const ids=new Set(),out=[];
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
      input.calendar.some(x=>!x||typeof x.title!=="string"||x.title.length>120||typeof x.description!=="string"||x.description.length>4000))
      return reply({error:"Invalid project"},400);
    ids.add(input.id);
    const project=structuredClone(input);
    try{for(const field of ["banner_path","logo_path","icon_path"])project[field]=await publishImage(project[field]);}
    catch{return reply({error:"Invalid project image"},400);}
    const version=new Date().toISOString().replace(/[-:.TZ]/g,"").slice(0,14);
    out.push({id:project.id,name:project.title,description:project.description,version,minecraft_version:project.mc_version,loader:project.loader,bundle_url:"",sha256:"",size_bytes:0,project});
  }
  const doc=JSON.stringify({format_version:1,projects:out});
  if(new TextEncoder().encode(doc).length>2*1024*1024)return reply({error:"Catalog too large"},413);
  await env.UNIVERSE.put("catalog.json",doc,{httpMetadata:{contentType:"application/json; charset=utf-8"}});
  return reply({ok:true,projects:out.length});
} };
