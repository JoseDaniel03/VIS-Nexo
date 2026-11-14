// CurseForge credentials belong in Worker secrets, never in a launcher binary.
export async function curseforgeSearch(input,env,fetcher=fetch){
 if(input?.provider!=='curseforge'||typeof input.query!=='string'||input.query.length>120||typeof input.version!=='string'||!/^[a-zA-Z0-9._-]{1,40}$/.test(input.version))return {status:400,body:{error:'Invalid catalog search'}};
 if(!env.CURSEFORGE_API_KEY)return {status:503,body:{provider:'curseforge',configured:false,error:'CurseForge API key is not configured on VIS'}};
 const url=new URL('https://api.curseforge.com/v1/mods/search');
 for(const [k,v]of Object.entries({gameId:432,classId:6,searchFilter:input.query,gameVersion:input.version,modLoaderType:4,pageSize:30}))url.searchParams.set(k,String(v));
 let response;
 try{response=await fetcher(url.toString(),{headers:{'x-api-key':env.CURSEFORGE_API_KEY,Accept:'application/json'},redirect:'error',signal:AbortSignal.timeout(15000)});}catch{return {status:502,body:{error:'CurseForge is unavailable'}};}
 if(!response.ok)return {status:502,body:{error:'CurseForge rejected the catalog request'}};
 const reader=response.body?.getReader();if(!reader)return {status:502,body:{error:'Empty provider response'}};
 let size=0,chunks=[];
 try{for(;;){const {done,value}=await reader.read();if(done)break;size+=value.length;if(size>1024*1024){await reader.cancel();throw Error('large');}chunks.push(value);}}catch{return {status:502,body:{error:'Invalid provider response'}};}
 let data;try{const all=new Uint8Array(size);let at=0;for(const c of chunks){all.set(c,at);at+=c.length;}data=JSON.parse(new TextDecoder().decode(all));}catch{return {status:502,body:{error:'Invalid provider JSON'}};}
 if(!Array.isArray(data.data))return {status:502,body:{error:'Invalid provider projects'}};
 const items=data.data.slice(0,30).map(p=>({provider:'curseforge',id:String(p.id),title:String(p.name||'').slice(0,160),summary:String(p.summary||'').slice(0,500),project_url:`https://www.curseforge.com/minecraft/mc-mods/${encodeURIComponent(String(p.slug||'').slice(0,100))}`,distribution_allowed:p.allowModDistribution===true,compatibility:input.engine==='horizon'?'requires_port':'requires_file_check',installable:false}));
 return {status:200,body:{schema:1,provider:'curseforge',configured:true,checked:'metadata_only',items}};
}
