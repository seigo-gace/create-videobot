const PROFILE=Object.freeze({
 name:'動画販売・出品サポート',
 description:'動画の出品準備と販売管理をサポートします。出品前に作品の権利や利用条件を確認し、公開・販売は承認されたものに限ります。購入や公開機能は準備状況に応じて順次ご案内します。',
 short_description:'動画の出品準備と販売をサポートするBotです。',
 commands:[]
});
export function plannedProfile(){return PROFILE}
export async function applyProfile({api,expectedUsername,confirmChange=false}){
 if(typeof api!=='function')throw new Error('Telegram API unavailable');
 if(typeof expectedUsername!=='string'||!/^@[A-Za-z0-9_]{5,32}$/.test(expectedUsername))throw new Error('exact existing bot username required');
 const bot=await api('getMe',{});
 if(bot?.username?.toLowerCase()!==expectedUsername.slice(1).toLowerCase()||bot?.is_bot!==true)throw new Error('bot identity mismatch');
 const current={
  name:(await api('getMyName',{language_code:'ja'})).name,
  description:(await api('getMyDescription',{language_code:'ja'})).description,
  short_description:(await api('getMyShortDescription',{language_code:'ja'})).short_description,
  commands:await api('getMyCommands',{language_code:'ja'})
 };
 if(confirmChange!==true)return {username:expectedUsername,current,desired:PROFILE,applied:false};
 const changes=[
  ['name','setMyName',{name:PROFILE.name,language_code:'ja'}],
  ['description','setMyDescription',{description:PROFILE.description,language_code:'ja'}],
  ['short_description','setMyShortDescription',{short_description:PROFILE.short_description,language_code:'ja'}],
  ['commands','setMyCommands',{commands:PROFILE.commands,language_code:'ja'}]
 ];
 for(const [key,method,body] of changes){
  if(JSON.stringify(current[key])!==JSON.stringify(PROFILE[key])){
   const result=await api(method,body);
   if(result!==true)throw new Error('Bot profile update not acknowledged');
  }
 }
 const verified={
  name:(await api('getMyName',{language_code:'ja'})).name,
  description:(await api('getMyDescription',{language_code:'ja'})).description,
  short_description:(await api('getMyShortDescription',{language_code:'ja'})).short_description,
  commands:await api('getMyCommands',{language_code:'ja'})
 };
 if(JSON.stringify(verified)!==JSON.stringify(PROFILE))throw new Error('Bot profile readback mismatch');
 return {username:expectedUsername,applied:true,verified};
}
