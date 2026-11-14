import assert from 'node:assert/strict';
import { createMobileFeatures } from '../mobile/web/features.js';

// DOM-free mobile contract tests: user input does not become authority.
// This test runs as part of the APK CI, without Cloudflare network calls.
const calls=[];
const state={
  auth:{signed_in:true,mfa_required:false,username:'alicia'},
  view:'account',
  account:{account:{username:'alicia',display_name:'Alicia',public_handle:'alicia',
    role:'super_admin',developer:true}},
  social:{friends:[{username:'bruno',display_name:'Bruno',presence:'online'}],
    incoming_requests:['carla'],outgoing_requests:[],presence:'online',
    custom_status:'Hola',developer:true},
  projects:{projects:[{id:'vis',title:'VIS',subscribed:false}]},
  communityId:'virgoland',
  instances:[{id:'a'.repeat(32),name:'Rust Survival',engine:'horizon',version:'26.3',
    loader:'vanilla',project_id:'virgoland'}],
  community:{can_manage:true,can_play:false,admission:'request',play_access:'members',
    members:[{username:'bruno',member_role:'participant'}],
    media:[{title:'Bad link',url:'javascript:alert(1)'}],pending:[]}
};
const htmlEscape=v=>String(v??'').replace(/[&<>"']/g,c=>({
  '&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'
}[c]));
let drawn=0, refreshed=0;
const notifications=[];
const command=async(name,args={})=>{
  calls.push({name,args});
  if(name==='mobile_action'){
    if(args.action==='account.mfa.status')return {enrolled:true,verified_for_seconds:300};
    if(args.action==='account.sessions')return {sessions:[
      {session_id:'opaque',auth_method:'password',current:true}
    ]};
    return {ok:true};
  }
  if(name==='mobile_instances')return state.instances;
  if(name==='mobile_instance_create')return {id:'b'.repeat(32),name:args.name,engine:args.engine};
  if(name==='mobile_instance_remove')return 0;
  if(name==='mobile_community')return state.community;
  if(name==='mobile_email_verify')return {verified:true};
  return {ok:true};
};
globalThis.FormData=class {
  constructor(form){this.fields=form.fields||{}}
  get(k){return Object.hasOwn(this.fields,k)?this.fields[k]:null}
  has(k){return Object.hasOwn(this.fields,k)}
};
globalThis.window={
  confirm:()=>true,prompt:()=>null,alert:()=>{}
};
const features=createMobileFeatures({
  state,command,escape:htmlEscape,
  toast:(text,error)=>notifications.push({text,error}),
  screen:()=>drawn++,
  refreshAll:async()=>refreshed++
});
function form(name,fields){return {dataset:{feature:name},fields};}
const friend=features.friendsPanel();
assert(friend.includes('Solicitudes recibidas'));
assert(friend.includes('Conectado'));
assert(features.friendControls(state.social.friends[0]).includes('Apodo'));
assert(features.accountPanel().includes('Cerrar sesiones'));
assert(features.adminPanel().includes('Superadministración'));
assert(features.communityPanel().includes('Miembros'));
assert(features.instancePanel().includes('Rust Survival'));
assert(features.instancePanel().includes('Carpetas de mundos, mods'));


await features.refreshSecurity();
assert.deepEqual(calls.filter(x=>['account.mfa.status','account.sessions'].includes(x.args.action))
 .map(x=>({action:x.args.action,body:x.args.body})),[
  {action:'account.mfa.status',body:undefined},
  {action:'account.sessions',body:undefined}
],'GET requests must not send a JSON body');

await features.handleForm(form('presence',{presence:'away',custom_status:'Desde Android'}));
assert(calls.some(x=>x.args.action==='presence.set'&&x.args.body.presence==='away'&&
 x.args.body.custom_status==='Desde Android'&&!x.args.body.current_game),
 'presence does not falsely claim Minecraft is running on Android');

await features.handleForm(form('friend-request',{username:'@bruno'}));
assert(calls.some(x=>x.args.action==='friends.request'&&x.args.body.username==='bruno'));
await features.handleForm(form('project-manage',{id:'virgoland',title:'Virgoland',
 summary:'Nueva temporada',visibility:'draft'}));
assert(calls.some(x=>x.args.action==='projects.manage'&&x.args.body.visibility==='draft'));

await features.handleForm(form('instance-create',{
  name:'Survival móvil',engine:'horizon',loader:'fabric',
  version:'26.3',project_id:'virgoland'
}));
assert(calls.some(x=>x.name==='mobile_instance_create'&&
  x.args.engine==='horizon'&&x.args.loader==='vanilla'&&
  x.args.projectId==='virgoland'), 'Horizon metadata must not inherit Java loader');
await features.handleAction({dataset:{action:'remove-instance',id:'a'.repeat(32)}});
assert(calls.some(x=>x.name==='mobile_instance_remove'), 'unlinked instance action is native');
await features.handleForm(form('project-staff',{
  project_id:'virgoland',username:'bruno',staff_role:'editor'
}));
assert(calls.some(x=>x.args.action==='projects.staff'&&x.args.body.staff_role==='editor'));

await features.handleForm(form('admin-role',{username:'bruno',role:'moderator'}));
assert(calls.some(x=>x.args.action==='accounts.role'&&x.args.body.role==='moderator'));

await features.handleForm(form('project-policy',{project_id:'virgoland',
 admission:'invite_only',play_access:'members'}));
assert(calls.some(x=>x.args.action==='community.policy'&&x.args.body.admission==='invite_only'));

await features.handleForm(form('request-email',{email:'alicia@example.org'}));
assert(calls.some(x=>x.args.action==='account.email.request'));
await features.handleForm(form('verify-email',{code:'a'.repeat(43)}));
assert(calls.some(x=>x.name==='mobile_email_verify'));

const attack=features.projectControls({id:'" onmouseover="alert(1)',subscribed:false});
assert(!attack.includes('data-id="" onmouseover'));
assert(attack.includes('&quot; onmouseover='));
const badLink=features.communityPanel();
assert(!badLink.includes('href="javascript:'),
 'Untrusted media URL must not become a clickable javascript: link');

await features.handleAction({dataset:{action:'play-mcrust',id:'a'.repeat(32)}});
assert(calls.some(x=>x.name==='mobile_mcrust_launch'&&x.args.id==='a'.repeat(32)), 'game handoff uses only an owned instance id');

features.clear();
assert(refreshed>0,'mutations must refresh Social/Universe');
assert(drawn>0,'security response must re-render the profile');
console.log('VIS Nexo Android: social, profile, community and auth UI contracts passed');
