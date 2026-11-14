// VIS Ceibo: verified email, one-time account recovery and session management.
// No email-provider secret, token or plaintext password is exposed to the WebView.
export function createCeiboRecovery({reply,bad,now,hash,randomToken,parseBody,rateLimit,
  cloudVerifier,verifySignature,revokeRealtime,requireStepup,consumeRecoveryCode,mfaEnrolled}) {
  const tokenRegex=/^[A-Za-z0-9_-]{43}$/;
  const generic=()=>reply({ok:true,message:"Si existe una cuenta con un correo verificado, recibirás instrucciones."});
  function emailOf(raw){
    if(typeof raw!=="string")bad(400,"Correo inválido");
    const email=raw.trim().toLowerCase();
    if(email.length<6||email.length>254||email.includes("..")||
      !/^[a-z0-9.!#$%&'*+/=?^_{|}~-]+@[a-z0-9-]+(?:\.[a-z0-9-]+)+$/.test(email))
      bad(400,"Correo inválido");
    return email;
  }
  function configured(env){
    return typeof env?.RESEND_API_KEY==="string"&&env.RESEND_API_KEY.length>=15 &&
      typeof env?.CEIBO_FROM_EMAIL==="string"&&
      /^[a-z0-9._%+-]+@[a-z0-9.-]+\.[a-z]{2,}$/i.test(env.CEIBO_FROM_EMAIL);
  }
  async function sendMail(env,to,subject,plain){
    if(!configured(env))bad(503,"VIS Ceibo todavía no tiene configurado el servicio de correo");
    const response=await fetch("https://api.resend.com/emails",{
      method:"POST",headers:{"Authorization":"Bearer "+env.RESEND_API_KEY,"Content-Type":"application/json"},
      body:JSON.stringify({from:env.CEIBO_FROM_EMAIL,to:[to],subject,text:plain})
    }).catch(()=>null);
    if(!response?.ok)bad(503,"No se pudo enviar el correo de verificación");
  }
  async function mailbox(db,userId){
    return db.prepare("SELECT email_lower FROM account_emails WHERE user_id=?").bind(userId).first();
  }
  async function cooldown(db,userId,purpose,seconds){
    const found=await db.prepare("SELECT sent_at FROM account_recovery_notice_limits WHERE user_id=? AND purpose=?")
      .bind(userId,purpose).first();
    if(found&&found.sent_at>now()-seconds)return false;
    await db.prepare("INSERT INTO account_recovery_notice_limits(user_id,purpose,sent_at) VALUES (?,?,?) "+
      "ON CONFLICT(user_id,purpose) DO UPDATE SET sent_at=excluded.sent_at")
      .bind(userId,purpose,now()).run();
    return true;
  }
  async function issue(db,userId,purpose,changeId,ttl){
    const token=randomToken();
    await db.prepare("INSERT INTO account_recovery_tokens(token_hash,user_id,purpose,change_id,expires_at) "+
      "VALUES (?,?,?,?,?)").bind(await hash(token),userId,purpose,changeId,now()+ttl).run();
    return token;
  }
  async function emailRequest(request,db,user,env){
    await rateLimit(db,request,"ceibo-email:"+user.id,4);
    const data=await parseBody(request,400),next=emailOf(data.email);
    if(!configured(env))bad(503,"El correo de recuperación todavía no está habilitado");
    // A stolen or hours-old device bearer cannot attach an attacker's email
    // and later use the email reset flow to take ownership of a VIS account.
    if(user.auth_method!=="password"||!user.auth_created_at||
       now()-user.auth_created_at>5*60)
      bad(403,"Confirmá tu contraseña VIS mediante un inicio de sesión reciente para vincular el correo");
    await requireStepup(db,user);
    const current=await mailbox(db,user.id);
    if(current?.email_lower===next)return reply({ok:true,already_verified:true});
    const taken=await db.prepare("SELECT user_id FROM account_emails WHERE email_lower=?")
      .bind(next).first();
    if(taken&&taken.user_id!==user.id)bad(409,"Correo ya vinculado a otra cuenta");
    if(!await cooldown(db,user.id,"email",90))bad(429,"Esperá antes de pedir otro código");
    const changeId=crypto.randomUUID();
    await db.prepare("DELETE FROM account_recovery_tokens WHERE user_id=? AND purpose IN ('email_new','email_old')")
      .bind(user.id).run();
    await db.prepare("INSERT INTO account_email_pending(user_id,change_id,email_lower,old_approved,new_approved,expires_at) "+
      "VALUES (?,?,?,?,0,?) ON CONFLICT(user_id) DO UPDATE SET change_id=excluded.change_id,"+
      "email_lower=excluded.email_lower,old_approved=excluded.old_approved,new_approved=0,"+
      "created_at=unixepoch(),expires_at=excluded.expires_at")
      .bind(user.id,changeId,next,current?0:1,now()+20*60).run();
    const newToken=await issue(db,user.id,"email_new",changeId,20*60);
    const oldToken=current?await issue(db,user.id,"email_old",changeId,20*60):null;
    if(current)await sendMail(env,current.email_lower,"VIS Ceibo — Autorizar cambio de correo",
      "Para aprobar el cambio de correo de tu cuenta VIS ingresá este código en Nexo:\n\n"+
      oldToken+"\n\nVence en 20 minutos. Si no lo solicitaste, no lo compartas.");
    await sendMail(env,next,"VIS Ceibo — Verificar correo",
      "Ingresá este código en VIS Nexo para verificar tu correo:\n\n"+
      newToken+"\n\nVence en 20 minutos y funciona una sola vez.");
    return reply({ok:true,verification_required:true,dual_approval:!!current});
  }
  async function verifyEmail(request,db){
    await rateLimit(db,request,"ceibo-verify-email",15);
    const data=await parseBody(request,300),code=data.code;
    if(!tokenRegex.test(code||""))bad(400,"Código inválido");
    const digest=await hash(code);
    const token=await db.prepare("SELECT user_id,purpose,change_id FROM account_recovery_tokens "+
      "WHERE token_hash=? AND purpose IN ('email_old','email_new') AND expires_at>?")
      .bind(digest,now()).first();
    if(!token)bad(400,"Código inválido o vencido");
    const pending=await db.prepare("SELECT * FROM account_email_pending "+
      "WHERE user_id=? AND change_id=? AND expires_at>?")
      .bind(token.user_id,token.change_id,now()).first();
    if(!pending)bad(400,"Se reemplazó o venció esta solicitud");
    const claimed=await db.prepare("DELETE FROM account_recovery_tokens WHERE token_hash=? AND expires_at>?")
      .bind(digest,now()).run();
    if(claimed.meta?.changes!==1)bad(409,"Código ya utilizado");
    const column=token.purpose==="email_old"?"old_approved":"new_approved";
    await db.prepare("UPDATE account_email_pending SET "+column+"=1 WHERE user_id=? AND change_id=?")
      .bind(token.user_id,token.change_id).run();
    const state=await db.prepare("SELECT * FROM account_email_pending WHERE user_id=? AND change_id=?")
      .bind(token.user_id,token.change_id).first();
    if(state?.old_approved===1&&state?.new_approved===1){
      await db.prepare("INSERT INTO account_emails(user_id,email_lower,verified_at) VALUES (?,?,?) "+
        "ON CONFLICT(user_id) DO UPDATE SET email_lower=excluded.email_lower,"+
        "verified_at=excluded.verified_at,updated_at=unixepoch()")
        .bind(token.user_id,state.email_lower,now()).run();
      await db.prepare("DELETE FROM account_email_pending WHERE user_id=?").bind(token.user_id).run();
      await db.prepare("DELETE FROM account_recovery_tokens WHERE user_id=? AND purpose IN ('email_new','email_old')")
        .bind(token.user_id).run();
      return reply({ok:true,verified:true});
    }
    return reply({ok:true,verified:false,waiting_for_other_approval:true});
  }
  async function start(request,db,env){
    await rateLimit(db,request,"ceibo-forgot-ip",5);
    const data=await parseBody(request,400),kind=data.kind;
    if(kind!=="password"&&kind!=="username")bad(400,"Tipo de recuperación inválido");
    const input=typeof data.identity==="string"?data.identity.trim().replace(/^@/,""):"";
    if(input.length<3||input.length>254)return generic();
    await rateLimit(db,request,"ceibo-forgot-id:"+(await hash(input.toLowerCase())),3);
    if(!configured(env))bad(503,"El envío de correos de recuperación no está configurado");
    let row=null;
    if(input.includes("@")){
      let address;try{address=emailOf(input);}catch{return generic();}
      row=await db.prepare("SELECT u.id,u.username,e.email_lower FROM account_emails e "+
        "JOIN social_users u ON u.id=e.user_id WHERE e.email_lower=? AND "+
        "u.disabled_at IS NULL AND u.password_hash!=''").bind(address).first();
    }else if(kind==="password"&&/^[A-Za-z0-9_-]{3,24}$/.test(input)){
      row=await db.prepare("SELECT u.id,u.username,e.email_lower FROM social_users u "+
        "JOIN account_emails e ON e.user_id=u.id WHERE "+
        "(u.username=? OR u.public_handle=? OR u.public_id=?) "+
        "AND u.disabled_at IS NULL AND u.password_hash!=''")
        .bind(input.toLowerCase(),input.toLowerCase(),input).first();
    }
    if(!row||!await cooldown(db,row.id,"forgot-"+kind,120))return generic();
    // Resend outages must not reveal the existence of a verified email:
    // a known account and an unknown account always receive the same reply.
    try{
      if(kind==="username"){
        await sendMail(env,row.email_lower,"VIS Ceibo — Recordatorio de usuario",
          "Tu nombre técnico de cuenta VIS es: "+row.username+
          "\n\nSi no solicitaste este recordatorio, ignorá el correo.");
      }else{
        const code=await issue(db,row.id,"reset","",15*60);
        await sendMail(env,row.email_lower,"VIS Ceibo — Recuperar contraseña",
          "Copiá este código en VIS Nexo:\n\n"+code+
          "\n\nVence en 15 minutos. Es de un solo uso. Las cuentas administradoras "+
          "también requieren un código de recuperación MFA.");
      }
    }catch{
      // No error details, mailbox identity or token are logged or exposed.
    }
    return generic();
  }
  async function isAdmin(db,row){
    if(row.role==="super_admin")return true;
    return !!(await db.prepare("SELECT 1 AS yes FROM global_admin_grants WHERE user_id=?")
      .bind(row.user_id).first());
  }
  async function introspect(request,db){
    await rateLimit(db,request,"ceibo-reset-introspect",8);
    const data=await parseBody(request,180),code=data.code;
    if(!tokenRegex.test(code||""))bad(400,"Código inválido o vencido");
    const row=await db.prepare(
      "SELECT u.username FROM account_recovery_tokens t "+
      "JOIN social_users u ON u.id=t.user_id WHERE t.token_hash=? "+
      "AND t.purpose='reset' AND t.expires_at>? AND u.disabled_at IS NULL"
    ).bind(await hash(code),now()).first();
    if(!row)bad(400,"Código inválido o vencido");
    return reply({username:row.username});
  }
  async function reset(request,db,env){
    await rateLimit(db,request,"ceibo-reset-ip",8);
    const data=await parseBody(request,1400),code=data.code;
    if(!tokenRegex.test(code||""))bad(400,"Código inválido o vencido");
    const tokenHash=await hash(code);
    const row=await db.prepare("SELECT t.user_id,u.username,u.role FROM account_recovery_tokens t "+
      "JOIN social_users u ON u.id=t.user_id WHERE t.token_hash=? AND t.purpose='reset' "+
      "AND t.expires_at>? AND u.disabled_at IS NULL").bind(tokenHash,now()).first();
    if(!row)bad(400,"Código inválido o vencido");
    const {salt,pub,text}=cloudVerifier(data,row.username);
    if(!await verifySignature(pub,data.registration_signature,text))
      bad(401,"La nueva contraseña no pasó la prueba criptográfica");
    if(await isAdmin(db,row)||await mfaEnrolled(db,row.user_id)){
      if(!await consumeRecoveryCode(db,row.user_id,data.recovery_code))
        bad(403,"La recuperación de esta cuenta requiere un código de emergencia MFA válido");
    }
    const claimed=await db.prepare("DELETE FROM account_recovery_tokens WHERE token_hash=? AND purpose='reset' AND expires_at>?")
      .bind(tokenHash,now()).run();
    if(claimed.meta?.changes!==1)bad(409,"Código ya utilizado");
    await db.batch([
      db.prepare("UPDATE social_users SET password_hash=?,password_salt=?,password_iterations=2,"+
        "device_credential_epoch=device_credential_epoch+1,updated_at=unixepoch() WHERE id=?")
        .bind("ed25519:"+pub,salt,row.user_id),
      db.prepare("DELETE FROM auth_sessions WHERE user_id=?").bind(row.user_id),
      db.prepare("DELETE FROM auth_challenges WHERE user_id=?").bind(row.user_id),
      db.prepare("DELETE FROM account_mfa_login_tickets WHERE user_id=?").bind(row.user_id),
      db.prepare("DELETE FROM realtime_tickets WHERE user_id=?").bind(row.user_id),
      db.prepare("DELETE FROM account_recovery_tokens WHERE user_id=?").bind(row.user_id)
    ]);
    await revokeRealtime(env,row.user_id);
    const email=await mailbox(db,row.user_id);
    if(email)try{await sendMail(env,email.email_lower,"VIS Ceibo — Contraseña modificada",
      "Tu contraseña de VIS Ceibo fue modificada. Se revocaron las sesiones y credenciales de dispositivos anteriores. "+
      "Si no fuiste vos, solicitá ayuda de seguridad.");}catch{}
    return reply({ok:true,logged_out:true});
  }
  async function passwordChange(request,db,user,env){
    await rateLimit(db,request,"ceibo-password-change:"+user.id,5);
    if(user.auth_method!=="password"||!user.auth_created_at||
       now()-user.auth_created_at>5*60)
      bad(403,"Para cambiar la contraseña confirmá primero tu contraseña actual");
    await requireStepup(db,user);
    const data=await parseBody(request,1100),{salt,pub,text}=cloudVerifier(data,user.username);
    if(!await verifySignature(pub,data.registration_signature,text))bad(401,"Credencial inválida");
    await db.batch([
      db.prepare("UPDATE social_users SET password_hash=?,password_salt=?,password_iterations=2,"+
        "device_credential_epoch=device_credential_epoch+1,updated_at=unixepoch() WHERE id=?")
        .bind("ed25519:"+pub,salt,user.id),
      db.prepare("DELETE FROM auth_sessions WHERE user_id=?").bind(user.id),
      db.prepare("DELETE FROM auth_challenges WHERE user_id=?").bind(user.id),
      db.prepare("DELETE FROM account_mfa_login_tickets WHERE user_id=?").bind(user.id),
      db.prepare("DELETE FROM realtime_tickets WHERE user_id=?").bind(user.id)
    ]);
    await revokeRealtime(env,user.id);
    return reply({ok:true,logged_out:true});
  }
  async function rebindDevice(request,db,user){
    await rateLimit(db,request,"ceibo-device:"+user.id,4);
    if(user.auth_method!=="password"||!user.auth_created_at||
       now()-user.auth_created_at>5*60)
      bad(403,"Confirmá tu contraseña VIS mediante un nuevo inicio de sesión para vincular dispositivos");
    await requireStepup(db,user);
    const data=await parseBody(request,500);
    if(typeof data.public_key!=="string"||typeof data.signature!=="string")
      bad(400,"Identidad del dispositivo inválida");
    const text="VIS-CEIBO-DEVICE-REBIND-V1\n"+user.username+"\n"+data.public_key;
    if(!await verifySignature(data.public_key,data.signature,text))bad(401,"Firma de dispositivo inválida");
    await db.prepare("UPDATE social_users SET signing_public_key=?,"+
      "legacy_device_key_epoch=device_credential_epoch,updated_at=unixepoch() WHERE id=?")
      .bind(data.public_key,user.id).run();
    return reply({ok:true});
  }
  async function sessions(db,user){
    const rows=await db.prepare("SELECT session_id,created_at,expires_at,auth_method "+
      "FROM auth_sessions WHERE user_id=? AND expires_at>? ORDER BY created_at DESC LIMIT 40")
      .bind(user.id,now()).all();
    const current=await db.prepare("SELECT session_id FROM auth_sessions WHERE token_hash=?")
      .bind(user.tokenHash).first();
    return reply({sessions:(rows.results||[]).map(row=>({...row,current:row.session_id===current?.session_id}))});
  }
  async function revokeSessions(request,db,user,env){
    await rateLimit(db,request,"ceibo-sessions:"+user.id,12);
    await requireStepup(db,user);
    const data=await parseBody(request,250);
    if(data.all===true){
      await db.prepare("DELETE FROM auth_sessions WHERE user_id=?").bind(user.id).run();
      await revokeRealtime(env,user.id);
      return reply({ok:true,logged_out:true});
    }
    if(typeof data.session_id!=="string"||!/^[a-f0-9-]{32,36}$/.test(data.session_id))
      bad(400,"Sesión inválida");
    const deleted=await db.prepare("DELETE FROM auth_sessions WHERE session_id=? AND user_id=?")
      .bind(data.session_id,user.id).run();
    if(deleted.meta?.changes!==1)bad(404,"Sesión no encontrada");
    await revokeRealtime(env,user.id);
    return reply({ok:true});
  }
  async function publicRoute(path,request,db,env){
    if(path==="/v1/recovery/start")return start(request,db,env);
    if(path==="/v1/recovery/introspect")return introspect(request,db);
    if(path==="/v1/recovery/reset")return reset(request,db,env);
    if(path==="/v1/recovery/email/verify")return verifyEmail(request,db);
    return null;
  }
  async function privateRoute(path,method,request,db,user,env){
    if(path==="/v1/account/sessions"&&method==="GET")return sessions(db,user);
    if(method!=="POST")return null;
    if(path==="/v1/account/email/request")return emailRequest(request,db,user,env);
    if(path==="/v1/account/password/change")return passwordChange(request,db,user,env);
    if(path==="/v1/account/devices/rebind")return rebindDevice(request,db,user);
    if(path==="/v1/account/sessions/revoke")return revokeSessions(request,db,user,env);
    return null;
  }
  return {publicRoute,privateRoute,mailbox,configured};
}
