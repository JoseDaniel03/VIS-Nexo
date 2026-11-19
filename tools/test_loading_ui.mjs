import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
const read=path=>readFileSync(new URL('../'+path,import.meta.url),'utf8');
const html=read('web/index.html'),app=read('web/app.js');
const loading=read('web/loading.js'),css=read('web/loading.css');
for(const asset of ['splash-atmosphere.webp','splash-forest.webp','vis-nexo-mark.svg'])
 assert.ok(readFileSync(new URL('../web/assets/'+asset,import.meta.url)).length>0);
assert.match(html,/href="\.\/loading\.css"/);
assert.match(app,/withOperationLoading\(name,/);
assert.match(app,/reportMinecraftProgress\(e\.payload\)/);
assert.match(loading,/social_cloud_login/);
assert.match(loading,/launch_horizon/);
assert.match(loading,/finally\s*\{\s*finish\(item\);\s*\}/);
assert.match(loading,/payload\.total/);
assert.match(css,/prefers-reduced-motion/);
assert.match(css,/vis-operation-overlay\[hidden\]/);
assert.match(read('web/splash.css'),/grid-template-rows:minmax\(0,1fr\) auto/);
assert.match(read('web/effects.js'),/auth-brand/);
console.log('Pantallas de carga VIS Nexo verificadas.');
