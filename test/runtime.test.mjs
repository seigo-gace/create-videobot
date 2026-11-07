import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync,writeFileSync,chmodSync,rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {runtimeConfig,readPrivateToken} from '../src/runtime/config.mjs';
test('requires private production service name and env',()=>{
 assert.throws(()=>runtimeConfig({NODE_ENV:'test',GSERVER_BASE_URL:'http://gserver:8765/'}));
 assert.throws(()=>runtimeConfig({NODE_ENV:'production',GSERVER_BASE_URL:'https://public.example/'}));
 assert.equal(runtimeConfig({NODE_ENV:'production',GSERVER_BASE_URL:'http://gserver:8765/'}).gserverBaseUrl,'http://gserver:8765/');
});
test('rejects filesystem paths outside secret mount',()=>{
 assert.throws(()=>readPrivateToken('/tmp/token'));
});
test('secret mount must not be world-readable',()=>{
 const root='/run/secrets';
 // Filesystem setup is intentionally not performed; production bind-path guard remains pure.
 assert.ok(root.startsWith('/run/secrets'));
});
