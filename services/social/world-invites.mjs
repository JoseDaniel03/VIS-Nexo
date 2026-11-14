// Social authorization and short-lived delivery only. Game traffic stays in
// Horizon's encrypted direct/relay transport; D1 never receives plaintext codes.
export async function worldInvites(path, request, db, user, api) {
  const {parseBody, bad, reply, now, areFriends, lookupUser, wakeRealtime, rateLimit, env, ctx}=api;
  if(request.method==='POST'&&rateLimit)await rateLimit(db,request,'worlds:'+user.id,60);
  const uuid=v=>typeof v==='string'&&/^[a-f0-9]{32}$/.test(v);
  if(path==='/v1/worlds/inbox'){
    const rows=await db.prepare('SELECT i.id,i.room_id,i.payload,i.expires_at,r.host_id,u.username AS sender FROM world_invites i JOIN world_rooms r ON r.id=i.room_id JOIN social_users u ON u.id=r.host_id WHERE i.recipient_id=? AND i.status=\'pending\' AND i.expires_at>? AND r.lease_until>? AND u.disabled_at IS NULL ORDER BY i.expires_at DESC LIMIT 50').bind(user.id,now(),now()).all();
    const invitations=[];
    for(const row of rows.results||[])if(await areFriends(db,user.id,row.host_id))invitations.push(row);
    return reply({invitations});
  }
  const body=await parseBody(request);
  if(path==='/v1/worlds/host'){
    if(!uuid(body.room_id))bad(400,'Invalid room ID');
    // Reusing a room ID cannot resurrect an expired or explicitly closed room.
    const room=await db.prepare('SELECT host_id,lease_until FROM world_rooms WHERE id=?').bind(body.room_id).first();
    if(room&&(room.host_id!==user.id||room.lease_until<=now()))bad(409,'World session ended');
    const count=await db.prepare('SELECT count(*) AS n FROM world_rooms WHERE host_id=? AND lease_until>?').bind(user.id,now()).first();
    if(!room&&count.n>=8)bad(429,'Too many shared worlds');
    await db.prepare('INSERT INTO world_rooms(id,host_id,lease_until) VALUES(?,?,?) ON CONFLICT(id) DO UPDATE SET lease_until=excluded.lease_until WHERE host_id=excluded.host_id AND lease_until>?').bind(body.room_id,user.id,now()+90,now()).run();
    return reply({ok:true});
  }
  if(path==='/v1/worlds/close'){
    if(!uuid(body.room_id))bad(400,'Invalid room ID');
    await db.prepare('UPDATE world_rooms SET lease_until=0 WHERE id=? AND host_id=?').bind(body.room_id,user.id).run();
    return reply({ok:true});
  }
  if(path==='/v1/worlds/invite'){
    if(!uuid(body.id)||!uuid(body.room_id)||typeof body.payload!=='string'||new TextEncoder().encode(body.payload).length>2048)bad(400,'Invalid invitation');
    let envelope;try{envelope=JSON.parse(body.payload);}catch{bad(400,'Encrypted envelope required');}
    if(envelope?.v!==1||typeof envelope.iv!=='string'||!/^[A-Za-z0-9+/]{16}$/.test(envelope.iv)||typeof envelope.ct!=='string'||envelope.ct.length<24||!/^[A-Za-z0-9+/]*={0,2}$/.test(envelope.ct))bad(400,'Invalid encrypted envelope');
    const room=await db.prepare('SELECT host_id,lease_until FROM world_rooms WHERE id=?').bind(body.room_id).first();
    if(!room||room.host_id!==user.id||room.lease_until<=now())bad(409,'World session ended');
    const peer=await lookupUser(db,body.to);
    if(!await areFriends(db,user.id,peer.id))bad(403,'Invitations require friendship');
    const count=await db.prepare('SELECT count(*) AS n FROM world_invites i JOIN world_rooms r ON r.id=i.room_id WHERE r.host_id=? AND i.expires_at>?').bind(user.id,now()).first();
    if(count.n>=100)bad(429,'Too many invitations');
    await db.prepare('INSERT OR IGNORE INTO world_invites(id,room_id,recipient_id,payload,expires_at,status) VALUES(?,?,?,?,?,\'pending\')').bind(body.id,body.room_id,peer.id,body.payload,now()+600).run();
    wakeRealtime(env,peer.id,ctx);
    return reply({ok:true});
  }
  if(path==='/v1/worlds/accept'||path==='/v1/worlds/decline'){
    if(!uuid(body.id))bad(400,'Invalid invitation ID');
    const row=await db.prepare('SELECT i.*,r.host_id,r.lease_until FROM world_invites i JOIN world_rooms r ON r.id=i.room_id JOIN social_users u ON u.id=r.host_id WHERE i.id=? AND i.recipient_id=? AND u.disabled_at IS NULL').bind(body.id,user.id).first();
    if(!row||row.status!=='pending'||row.expires_at<=now()||row.lease_until<=now())bad(410,'Invitation expired or world closed');
    if(!await areFriends(db,user.id,row.host_id))bad(403,'Invitation requires friendship');
    const status=path.endsWith('/accept')?'accepted':'declined';
    const result=await db.prepare('UPDATE world_invites SET status=? WHERE id=? AND recipient_id=? AND status=\'pending\' AND expires_at>? AND EXISTS (SELECT 1 FROM world_rooms WHERE id=world_invites.room_id AND lease_until>?)').bind(status,body.id,user.id,now(),now()).run();
    if(!result.meta.changes)bad(410,'Invitation already handled or world closed');
    return reply({ok:true});
  }
  bad(404,'Not found');
}

