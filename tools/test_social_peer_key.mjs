import assert from 'node:assert/strict';
import { validatePinnedPeerKey } from '../web/social-remote.js';

const first='A'.repeat(88), second='B'.repeat(88);
assert.equal(validatePinnedPeerKey(null, first),first);
assert.equal(validatePinnedPeerKey(first, first),first);
assert.throws(()=>validatePinnedPeerKey(first,second),/ALERTA/);
assert.throws(()=>validatePinnedPeerKey(first,''),/Clave pública/);
assert.throws(()=>validatePinnedPeerKey(first,12),/Clave pública/);
assert.throws(()=>validatePinnedPeerKey(null,'bad'),/Clave pública/);
console.log('VIS Social key pinning: first use, repeat, unexpected rotation and malformed key passed');
