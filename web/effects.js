/** VSLauncher Motion Engine 2.2
 * Native Web Animations API: no new runtime dependencies.
 * Only opacity / transform are animated; no perpetual timers, canvas loops or filters.
 * Respects operating-system reduced motion, app preference and tab visibility.
 */
const reducedQuery = window.matchMedia('(prefers-reduced-motion: reduce)');
const coarseQuery = window.matchMedia('(pointer: coarse)');
const running = new Set();
let routeTicket = 0;
const ease = 'cubic-bezier(.22,.72,.18,1)';
const spring = 'cubic-bezier(.18,.89,.32,1.08)';
const enabled = (reduced=false) => !reduced && !reducedQuery.matches && !document.hidden;

function tween(node, frames, options, reduced=false) {
  if (!node || !enabled(reduced) || typeof node.animate !== 'function') return null;
  const anim = node.animate(frames, {duration: 230, easing: ease, fill:'both', ...options});
  running.add(anim);
  // An animation can be canceled when navigation destroys its element.
  anim.finished.catch(()=>{}).finally(()=>{running.delete(anim);anim.cancel();});
  return anim;
}
export function cancelAnimations() {
  for (const anim of running) anim.cancel();
  running.clear();
}
export function beginSectionChange(root, complete, {reducedMotion=false}={}) {
  const ticket = ++routeTicket;
  if (!enabled(reducedMotion)) {complete();return;}
  const current = root.querySelector('.main-scroll > .content-inner') || root.querySelector('.auth-glass');
  const exit = tween(current,
    [{opacity:1,transform:'translate3d(0,0,0)'},{opacity:.30,transform:'translate3d(0,-9px,0)'}],
    {duration:125,easing:'ease-in',fill:'none'},reducedMotion);
  if (!exit) {complete();return;}
  exit.finished.catch(()=>{}).then(()=>{if(ticket===routeTicket)complete();});
}
export function cancelPendingSectionChange(){routeTicket++;}

export function animateEntrance(root,{reducedMotion=false,kind='home'}={}) {
  cancelAnimations();
  if (!enabled(reducedMotion)) return;
  const content = root.querySelector('.main-scroll > .content-inner') || root.querySelector('.auth-glass');
  tween(content,[{opacity:.2,transform:'translate3d(0,12px,0)'},{opacity:1,transform:'translate3d(0,0,0)'}],
    {duration:kind==='auth'?330:305,easing:ease},reducedMotion);
  const hero = root.querySelector('.portal-feature,.portal-project-hero,.profile-banner');
  tween(hero,[{opacity:.65,transform:'translate3d(0,9px,0) scale(.995)'},{opacity:1,transform:'translate3d(0,0,0) scale(1)'}],
    {duration:360,delay:40,easing:ease},reducedMotion);
  // Staggered reveals apply only on actual page changes, not every render.
  const items = [...root.querySelectorAll('.portal-game-card,.news-item,.instance-card,.assets-grid > *, .profile-stat-row > div, .settings-grid > section')].slice(0,14);
  items.forEach((node,index)=>tween(node,
    [{opacity:0,transform:'translate3d(0,13px,0)'},{opacity:1,transform:'translate3d(0,0,0)'}],
    {duration:260,delay:75+Math.min(index*34,300),easing:ease},reducedMotion));
}
export function animateAuthSwap(root,{reducedMotion=false}={}){
  tween(root.querySelector('.auth-intro'),
    [{opacity:.3,transform:'translateY(9px)'},{opacity:1,transform:'translateY(0)'}],
    {duration:230,easing:ease},reducedMotion);
  tween(root.querySelector('.auth-form'),
    [{opacity:.15,transform:'translateY(8px)'},{opacity:1,transform:'translateY(0)'}],
    {duration:275,delay:45,easing:ease},reducedMotion);
}
export function animateModal(root,{reducedMotion=false}={}) {
  const back = root.querySelector('.modal-backdrop');
  const modal = root.querySelector('.dialog');
  tween(back,[{opacity:0},{opacity:1}],{duration:170,easing:'ease-out'},reducedMotion);
  tween(modal,[{opacity:.55,transform:'translate3d(0,18px,0) scale(.975)'},{opacity:1,transform:'translate3d(0,0,0) scale(1)'}],
    {duration:245,easing:spring},reducedMotion);
}
export function animateModalStep(root,{reducedMotion=false}={}) {
  tween(root.querySelector('.wizard-layout, .modal-body'),
    [{opacity:.35,transform:'translate3d(12px,0,0)'},{opacity:1,transform:'translate3d(0,0,0)'}],
    {duration:210,easing:ease},reducedMotion);
  tween(root.querySelector('.wizard-live-preview'),
    [{opacity:.75,transform:'scale(.985)'},{opacity:1,transform:'scale(1)'}],
    {duration:230,easing:ease},reducedMotion);
}
export function animateSocial(root,{reducedMotion=false}={}) {
  const side = root.querySelector('.social-pane:not(.is-hidden)');
  tween(side,[{opacity:.6,transform:'translate3d(18px,0,0)'},{opacity:1,transform:'translate3d(0,0,0)'}],
    {duration:250,easing:ease},reducedMotion);
}
export function animateSocialTab(root,{reducedMotion=false}={}) {
  tween(root.querySelector('.friend-scroll'),
    [{opacity:.30,transform:'translate3d(0,7px,0)'},{opacity:1,transform:'translate3d(0,0,0)'}],
    {duration:210,easing:ease},reducedMotion);
}
export function animateChat(root,{reducedMotion=false, freshMessage=false}={}) {
  if (!root.querySelector('.chat-drawer'))return;
  if (freshMessage) {
    tween(root.querySelector('.chat-messages .bubble:last-of-type'),
      [{opacity:.1,transform:'translate3d(0,8px,0) scale(.975)'},{opacity:1,transform:'translate3d(0,0,0) scale(1)'}],
      {duration:205,easing:ease},reducedMotion);
  } else {
    tween(root.querySelector('.chat-drawer'),
      [{opacity:.35,transform:'translate3d(20px,0,0)'},{opacity:1,transform:'translate3d(0,0,0)'}],
      {duration:255,easing:ease},reducedMotion);
    root.querySelectorAll('.chat-messages .bubble').forEach((node,i)=>{
      if(i<16)tween(node,[{opacity:.35,transform:'translateY(5px)'},{opacity:1,transform:'translateY(0)'}],
        {duration:180,delay:30+i*13,easing:ease},reducedMotion);
    });
  }
  const list=root.querySelector('.chat-messages');
  if(list)list.scrollTop=list.scrollHeight;
}
export function animateFeed(root,{reducedMotion=false}={}) {
  tween(root.querySelector('.feed-content,.news-grid,.project-feed,.news-list,.project-lower'),
    [{opacity:.25,transform:'translate3d(0,6px,0)'},{opacity:1,transform:'translate3d(0,0,0)'}],
    {duration:230,easing:ease},reducedMotion);
}
export function animateAvatar(root,{reducedMotion=false}={}) {
  tween(root.querySelector('.avatar-stage-ring .avatar,.profile-portrait .avatar,.side-avatar .avatar'),
    [{opacity:.5,transform:'scale(.85) rotate(-7deg)'},{opacity:1,transform:'scale(1) rotate(0deg)'}],
    {duration:275,easing:spring},reducedMotion);
}
export function animateControl(root,{reducedMotion=false}={}){
  tween(root.querySelector('.presence-picker,.toggle-line:focus-within'),
    [{transform:'scale(.98)'},{transform:'scale(1)'}],
    {duration:180,easing:spring},reducedMotion);
}
export function animateProjectMotion(root,{reducedMotion=false}={}){
  const hero=root.querySelector('[data-motion="hero"]');
  if(!hero || !enabled(reducedMotion) || coarseQuery.matches)return;
  let frame=0, x=0, y=0;
  hero.addEventListener('pointermove',event=>{
    const bounds=hero.getBoundingClientRect();
    x=((event.clientX-bounds.left)/bounds.width-.5)*2;
    y=((event.clientY-bounds.top)/bounds.height-.5)*2;
    if(frame)return;
    frame=requestAnimationFrame(()=>{
      frame=0;
      if(!hero.isConnected || document.hidden)return;
      hero.style.setProperty('--mx',x.toFixed(3));
      hero.style.setProperty('--my',y.toFixed(3));
    });
  },{passive:true});
  hero.addEventListener('pointerleave',()=>{
    if(frame)cancelAnimationFrame(frame);
    frame=0;
    hero.style.removeProperty('--mx');hero.style.removeProperty('--my');
  });
}

export function beginSurfaceDismiss(root, selector, complete, {reducedMotion=false,axis='x'}={}) {
  const node=root.querySelector(selector);
  if(!node || !enabled(reducedMotion)) {complete();return;}
  const displacement=axis==='x'?'translate3d(18px,0,0)':'translate3d(0,12px,0)';
  const exit=tween(node,[{opacity:1,transform:'translate3d(0,0,0)'},{opacity:0,transform:displacement}],
    {duration:150,easing:'ease-in',fill:'none'},reducedMotion);
  if(!exit){complete();return;}
  exit.finished.catch(()=>{}).finally(complete);
}
export function animateSetting(root,{reducedMotion=false}={}){
  tween(root.querySelector('.settings-grid > section:first-child'),
    [{opacity:.7,transform:'translate3d(0,3px,0)'},{opacity:1,transform:'translate3d(0,0,0)'}],
    {duration:170,easing:ease},reducedMotion);
}
export function enableButtonFeedback(root,getReducedMotion){
  root.addEventListener('pointerdown',event=>{
    const node=event.target instanceof Element?event.target.closest('button'):null;
    if(!node || node.disabled || !enabled(getReducedMotion()))return;
    // Scale/opacity feedback without layout calculation or a DOM re-render.
    tween(node,[{opacity:1},{opacity:.83},{opacity:1}],
      {duration:175,easing:'ease-out',fill:'none'},getReducedMotion());
  },{passive:true});
}
document.addEventListener('visibilitychange',()=>{if(document.hidden){cancelAnimations();cancelPendingSectionChange();}});
reducedQuery.addEventListener?.('change',()=>{if(reducedQuery.matches)cancelAnimations();});
