import { readFileSync, statSync } from 'node:fs';
export function readPrivateToken(path) {
 if(!path || !path.startsWith('/run/secrets/')) throw new Error('secret must be mounted privately');
 const st=statSync(path);
 if(!st.isFile() || (st.mode & 0o077)!==0 || st.size>4096 || st.size<20) throw new Error('invalid secret file permissions');
 const value=readFileSync(path,'utf8').trim();
 if(value.length<20 || /[\r\n]/.test(value)) throw new Error('invalid secret file');
 return value;
}
export function runtimeConfig(env=process.env) {
 if(env.NODE_ENV!=='production') throw new Error('production configuration required');
 if(!env.GSERVER_BASE_URL || !/^http:\/\/[a-z0-9-]+:[0-9]{2,5}\/$/.test(env.GSERVER_BASE_URL)) throw new Error('private Gserver service URL required');
 return Object.freeze({gserverBaseUrl:env.GSERVER_BASE_URL, botTokenFile:env.GSERVER_BOT_TOKEN_FILE||'/run/secrets/gserver_bot_token'});
}
