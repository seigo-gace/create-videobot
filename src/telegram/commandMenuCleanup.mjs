/**
 * Remove legacy user-visible command registrations for CreateVdobot.
 * The /start deep-link handler remains available internally.
 * Never modify another bot, messages, stickers, products or payments.
 */
const LANGUAGES=['','ja','en'];
const SCOPES=[
 {type:'default'},
 {type:'all_private_chats'},
 {type:'all_group_chats'},
 {type:'all_chat_administrators'}
];

export async function clearCreatorCommandMenu(api){
 if(typeof api!=='function')throw Error('CREATOR_COMMAND_API_REQUIRED');
 const operations=[];
 for(const scope of SCOPES){
  for(const language_code of LANGUAGES){
   const params={scope,language_code};
   await api('deleteMyCommands',params);
   const remaining=await api('getMyCommands',params);
   if(!Array.isArray(remaining)||remaining.length!==0)
    throw Error('CREATOR_COMMANDS_STILL_REGISTERED');
   operations.push(scope.type+':'+(language_code||'default'));
  }
 }
 // This resets any explicitly configured web-app/commands menu to the
 // Telegram default. The Telegram client may still display its own Menu UI.
 await api('setChatMenuButton',{menu_button:{type:'default'}});
 const button=await api('getChatMenuButton',{});
 if(!button||!['default','commands'].includes(button.type))
  throw Error('CREATOR_MENU_BUTTON_RESET_NOT_VERIFIED');
 return {commandsEmpty:true,scopesVerified:operations.length,menuButtonType:button.type};
}
