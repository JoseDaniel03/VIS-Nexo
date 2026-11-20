import assert from 'node:assert/strict';
import {redactDiagnostic as mobile,buildDiagnostic as buildMobile} from '../mobile/web/error-dialog.js';
const sample='Bearer abcdef0123456789 password=SuperSecret! access_token: myUltraSecretToken12345 email example@domain.com /home/privateuser/Documents/saves token=abc123';
for(const redact of [mobile]){
  const output=redact(sample);
  for(const secret of ['abcdef0123456789','SuperSecret','myUltraSecretToken12345','example@domain.com','privateuser']) {
    assert(!output.includes(secret),'Sensitive text leaked: '+secret);
  }
  assert(output.includes('OCULTO'),'Missing secret redaction');
  assert(redact('test: wrong directory').includes('test: wrong directory'));
  assert(redact('x'.repeat(10000)).length<=2400,'Unbounded diagnostics');
}
const info={platform:'Android ARM64',system:'VIS McRust',stage:'FileProvider',error:'Java FileProvider exception',code:1};
assert(buildMobile(info).includes('FileProvider'));
assert(buildMobile({...info,error:'Bearer abcdef0123456789'}).includes('Bearer [OCULTO]'));
assert(!buildMobile({...info,error:'password=Hidden123'}).includes('Hidden123'));
console.log('VIS diagnostics: Android redaction/report contracts passed');
