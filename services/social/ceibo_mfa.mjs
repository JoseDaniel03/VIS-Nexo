// VIS Ceibo: RFC 6238 TOTP step-up (AES-GCM encrypted at rest) and
// disposable 100-bit backup codes. The AES key stays in Cloudflare Secrets.
export function createCeiboMfa({reply,bad,now,hash,parseBody,rateLimit}){
  const TTL=10*60;
  const enc=new TextEncoder();
  const alphabet="ABCDEFGHIJKLMNOPQRSTUVWXYZ234567";
  const pattern=/^[A-Z2-7]{4}(?:-[A-Z2-7]{4}){4}$/;
  const b64=value=>btoa(String.fromCharCode(...value));
  function decode64(value){
    if(typeof value!=="string"||!/^[A-Za-z0-9+/]*={0,2}$/.test(value)||value.length>300)
      bad(503,"Clave de cifrado MFA inválida");
    try{return Uint8Array.from(atob(value),c=>c.charCodeAt(0));}
    catch{bad(503,"Clave de cifrado MFA inválida");}
  }
  async function encryptionKey(env){
    const bytes=decode64(env?.CEIBO_MFA_ENCRYPTION_KEY);
    if(bytes.length!==32)bad(503,"Configurá CEIBO_MFA_ENCRYPTION_KEY de 32 bytes");
    return crypto.subtle.importKey("raw",bytes,"AES-GCM",false,["encrypt","decrypt"]);
  }
  async function seal(env,userId,bytes){
    const key=await encryptionKey(env);
    const iv=crypto.getRandomValues(new Uint8Array(12));
    const ct=new Uint8Array(await crypto.subtle.encrypt({
      name:"AES-GCM",iv,additionalData:enc.encode(userId)
    },key,bytes));
    return b64(iv)+"."+b64(ct);
  }
  async function open(env,userId,encoded){
    try{
      const [iv,cipher,...extras]=encoded.split(".");
      if(!iv||!cipher||extras.length)bad(503,"MFA dañado");
      const key=await encryptionKey(env);
      return new Uint8Array(await crypto.subtle.decrypt({
        name:"AES-GCM",iv:decode64(iv),additionalData:enc.encode(userId)
      },key,decode64(cipher)));
    }catch{bad(503,"No se pudo descifrar MFA; revisá la clave de Cloudflare");}
  }
  function base32(bytes){
    let n=0,bits=0,out="";
    for(const byte of bytes){
      n=(n<<8)|byte;bits+=8;
      while(bits>=5){bits-=5;out+=alphabet[(n>>>bits)&31];}
    }
    if(bits)out+=alphabet[(n<<(5-bits))&31];
    return out;
  }
  async function totp(secret,counter){
    const key=await crypto.subtle.importKey("raw",secret,
      {name:"HMAC",hash:"SHA-1"},false,["sign"]);
    const msg=new Uint8Array(8);let n=counter;
    for(let i=7;i>=0;i--){msg[i]=n%256;n=Math.floor(n/256);}
    const digest=new Uint8Array(await crypto.subtle.sign("HMAC",key,msg));
    const i=digest[19]&15;
    const value=((digest[i]&127)<<24)|(digest[i+1]<<16)|(digest[i+2]<<8)|digest[i+3];
    return String(value%1000000).padStart(6,"0");
  }
  async function matchCode(secret,code,lastCounter=-1){
    if(typeof code!=="string"||!/^\d{6}$/.test(code))return -1;
    const counter=Math.floor(now()/30);
    for(const t of [counter,counter-1,counter+1]){
      if(t>lastCounter&&await totp(secret,t)===code)return t;
    }
    return -1;
  }
  async function enrolled(db,userId){
    return !!(await db.prepare("SELECT 1 AS yes FROM account_totp WHERE user_id=?")
      .bind(userId).first());
  }
  async function requireStepup(db,user,mandatory=false){
    const enabled=await enrolled(db,user.id);
    if(mandatory&&!enabled)bad(403,"Para administrar VIS Ceibo primero tenés que configurar MFA");
    if(enabled&&(!user.mfa_verified_at||now()-user.mfa_verified_at>TTL))
      bad(403,"Verificá un código MFA desde Seguridad de cuenta antes de esta operación");
  }
  async function status(db,user){
    const enabled=await enrolled(db,user.id);
    return reply({enrolled:enabled,verified_for_seconds:user.mfa_verified_at?
      Math.max(0,TTL-(now()-user.mfa_verified_at)):0});
  }
  async function setup(request,db,user,env){
    await rateLimit(db,request,"ceibo-totp-setup:"+user.id,4);
    if(await enrolled(db,user.id))bad(409,"El segundo factor ya está registrado");
    const bytes=crypto.getRandomValues(new Uint8Array(20));
    const encrypted=await seal(env,user.id,bytes);
    await db.prepare("INSERT INTO account_totp_pending(user_id,secret_ciphertext,expires_at) "+
      "VALUES (?,?,?) ON CONFLICT(user_id) DO UPDATE SET "+
      "secret_ciphertext=excluded.secret_ciphertext,expires_at=excluded.expires_at")
      .bind(user.id,encrypted,now()+10*60).run();
    const secret=base32(bytes);
    return reply({ok:true,secret,uri:"otpauth://totp/VIS%20Ceibo:"+
      encodeURIComponent(user.username)+"?secret="+secret+
      "&issuer=VIS%20Ceibo&algorithm=SHA1&digits=6&period=30",
      expires_in:600});
  }
  async function confirm(request,db,user,env){
    await rateLimit(db,request,"ceibo-totp-confirm:"+user.id,8);
    if(await enrolled(db,user.id))bad(409,"Segundo factor ya habilitado");
    const data=await parseBody(request,140);
    const pending=await db.prepare("SELECT secret_ciphertext FROM account_totp_pending "+
      "WHERE user_id=? AND expires_at>?").bind(user.id,now()).first();
    if(!pending)bad(400,"La configuración MFA venció; volvé a comenzar");
    const secret=await open(env,user.id,pending.secret_ciphertext);
    const counter=await matchCode(secret,data.code);
    if(counter<0)bad(401,"Código TOTP inválido");
    const rows=[],display=[];
    for(let i=0;i<8;i++){
      const bytes=crypto.getRandomValues(new Uint8Array(13));
      const token=base32(bytes).slice(0,20).match(/.{4}/g).join("-");
      display.push(token);
      rows.push(db.prepare("INSERT INTO account_recovery_codes(code_hash,user_id) VALUES (?,?)")
        .bind(await hash("VIS-CEIBO-RECOVERY-V1\n"+user.id+"\n"+token),user.id));
    }
    await db.batch([
      db.prepare("INSERT INTO account_totp(user_id,secret_ciphertext,last_counter) "+
        "VALUES (?,?,?)").bind(user.id,pending.secret_ciphertext,counter),
      db.prepare("DELETE FROM account_totp_pending WHERE user_id=?").bind(user.id),
      db.prepare("DELETE FROM account_recovery_codes WHERE user_id=?").bind(user.id),
      ...rows,
      db.prepare("DELETE FROM auth_sessions WHERE user_id=? AND token_hash!=?").bind(user.id,user.tokenHash),
      db.prepare("DELETE FROM realtime_tickets WHERE user_id=?").bind(user.id),
      db.prepare("UPDATE auth_sessions SET mfa_verified_at=? "+
        "WHERE token_hash=? AND user_id=?").bind(now(),user.tokenHash,user.id)
    ]);
    return reply({ok:true,recovery_codes:display,
      warning:"Guardá estos códigos fuera del launcher. No volverán a mostrarse."});
  }
  async function consumeRecoveryCode(db,userId,raw){
    const code=typeof raw==="string"?raw.trim().toUpperCase():"";
    if(!pattern.test(code))return false;
    const digest=await hash("VIS-CEIBO-RECOVERY-V1\n"+userId+"\n"+code);
    const result=await db.prepare("DELETE FROM account_recovery_codes "+
      "WHERE code_hash=? AND user_id=?").bind(digest,userId).run();
    return result.meta?.changes===1;
  }
  // Used ONLY after the first-factor login proof has been validated.
  // This does not create a bearer; the caller atomically consumes the ticket.
  async function verifyLoginFactor(db,userId,data,env){
    const saved=await db.prepare(
      "SELECT secret_ciphertext,last_counter FROM account_totp WHERE user_id=?"
    ).bind(userId).first();
    if(!saved)bad(401,"El código MFA es inválido");
    if(typeof data.code==="string"&&/^\d{6}$/.test(data.code)){
      const secret=await open(env,userId,saved.secret_ciphertext);
      const counter=await matchCode(secret,data.code,saved.last_counter);
      if(counter<0)bad(401,"El código MFA es inválido");
      const claimed=await db.prepare(
        "UPDATE account_totp SET last_counter=? WHERE user_id=? AND last_counter<?"
      ).bind(counter,userId,counter).run();
      if(claimed.meta?.changes!==1)bad(401,"El código MFA ya fue utilizado");
    }else if(typeof data.recovery_code==="string"){
      if(!await consumeRecoveryCode(db,userId,data.recovery_code))
        bad(401,"El código MFA es inválido");
    }else bad(401,"Ingresá tu código MFA o un código de emergencia");
    return true;
  }
  async function verify(request,db,user,env){
    await rateLimit(db,request,"ceibo-totp-verify:"+user.id,9);
    const data=await parseBody(request,240);
    const saved=await db.prepare("SELECT secret_ciphertext,last_counter FROM account_totp "+
      "WHERE user_id=?").bind(user.id).first();
    if(!saved)bad(409,"Configurá primero el segundo factor");
    let good=false;
    if(typeof data.code==="string"&&/^\d{6}$/.test(data.code)){
      const key=await open(env,user.id,saved.secret_ciphertext);
      const counter=await matchCode(key,data.code,saved.last_counter);
      if(counter>=0){
        const result=await db.prepare("UPDATE account_totp SET last_counter=? "+
          "WHERE user_id=? AND last_counter<?").bind(counter,user.id,counter).run();
        good=result.meta?.changes===1;
      }
    }else{
      good=await consumeRecoveryCode(db,user.id,data.recovery_code);
    }
    if(!good)bad(401,"Código MFA inválido, repetido o vencido");
    await db.prepare("UPDATE auth_sessions SET mfa_verified_at=? "+
      "WHERE token_hash=? AND user_id=?").bind(now(),user.tokenHash,user.id).run();
    return reply({ok:true,verified_for_seconds:TTL});
  }
  async function rotateCodes(request,db,user){
    await rateLimit(db,request,"ceibo-totp-rotate:"+user.id,4);
    await requireStepup(db,user,true);
    const rows=[],codes=[];
    for(let i=0;i<8;i++){
      const code=base32(crypto.getRandomValues(new Uint8Array(13)))
        .slice(0,20).match(/.{4}/g).join("-");
      codes.push(code);
      rows.push(db.prepare("INSERT INTO account_recovery_codes(code_hash,user_id) VALUES (?,?)")
        .bind(await hash("VIS-CEIBO-RECOVERY-V1\n"+user.id+"\n"+code),user.id));
    }
    await db.batch([
      db.prepare("DELETE FROM account_recovery_codes WHERE user_id=?").bind(user.id),
      ...rows
    ]);
    return reply({ok:true,recovery_codes:codes,
      warning:"Los códigos anteriores dejan de funcionar inmediatamente."});
  }
  async function privateRoute(path,method,request,db,user,env){
    if(path==="/v1/account/mfa/status"&&method==="GET")return status(db,user);
    if(method!=="POST")return null;
    if(path==="/v1/account/mfa/setup")return setup(request,db,user,env);
    if(path==="/v1/account/mfa/confirm")return confirm(request,db,user,env);
    if(path==="/v1/account/mfa/verify")return verify(request,db,user,env);
    if(path==="/v1/account/mfa/rotate-codes")return rotateCodes(request,db,user);
    return null;
  }
  return {privateRoute,requireStepup,consumeRecoveryCode,verifyLoginFactor,enrolled};
}
