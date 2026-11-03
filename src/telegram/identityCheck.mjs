import {plannedProfile} from './profileSetup.mjs';
export async function verifyCreateVdoBot({api,checkProfile=true}){
 if(typeof api!=='function') throw new Error('Telegram API unavailable');
 const me=await api('getMe',{});
 if(me?.is_bot!==true || String(me?.username||'').toLowerCase()!=='createvdobot') throw new Error('unexpected Telegram bot identity');
 if(checkProfile!==true)return {identityVerified:true,profileVerified:false};
 const desired=plannedProfile();
 const actual={
  name:(await api('getMyName',{language_code:'ja'}))?.name,
  description:(await api('getMyDescription',{language_code:'ja'}))?.description,
  short_description:(await api('getMyShortDescription',{language_code:'ja'}))?.short_description,
  commands:await api('getMyCommands',{language_code:'ja'})
 };
 if(JSON.stringify(actual)!==JSON.stringify(desired)) throw new Error('Telegram bot profile drift detected');
 return {identityVerified:true,profileVerified:true};
}
