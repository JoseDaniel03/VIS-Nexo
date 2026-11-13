import assert from 'node:assert/strict';
import { validatePinnedPeerKey, socialPollDelay } from '../web/social-remote.js';

const first='A'.repeat(88), second='B'.repeat(88);
assert.equal(validatePinnedPeerKey(null, first),first);
assert.equal(validatePinnedPeerKey(first, first),first);
assert.throws(()=>validatePinnedPeerKey(first,second),/ALERTA/);
assert.throws(()=>validatePinnedPeerKey(first,''),/Clave pública/);
assert.throws(()=>validatePinnedPeerKey(first,12),/Clave pública/);
assert.throws(()=>validatePinnedPeerKey(null,'bad'),/Clave pública/);
console.log('VIS Social key pinning: first use, repeat, unexpected rotation and malformed key passed');

assert.equal(socialPollDelay(true,0),2200,'active chats should poll promptly');
assert.equal(socialPollDelay(false,0),8500,'idle app must reduce network traffic');
assert.equal(socialPollDelay(true,1),4400,'first network failure backs off');
assert.equal(socialPollDelay(true,5),35200,'capped exponential backoff');
assert.equal(socialPollDelay(false,9),45000,'idle backoff cannot exceed 45s');
assert.equal(socialPollDelay(true,-1),2200,'negative retry counters ignored');
console.log('VIS Social adaptive polling: active, idle, exponential backoff and limits passed');
