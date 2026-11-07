/**
 * VideoBot's Telegram Bot API adapter for the existing shared
 * GateApp-Bot PR#11 showWizardScreen contract: show(owner,previous,panel)
 * -> {messageId,replaced}. It does not implement a new DM state machine.
 *
 * Unknown edit response can mean Telegram DID edit the screen; never send
 * a second message on a timeout. Fallback is limited to explicit, known
 * "not editable" responses. Only positive private-chat IDs are accepted.
 */
function positive(value,name) {
  if(!Number.isSafeInteger(value)||value<=0)
    throw new Error('PRIVATE_WIZARD_'+name+'_REQUIRED');
  return value;
}
function editOutcome(error){
  const message=error instanceof Error?error.message:'';
  if(/message is not modified/i.test(message))return 'already';
  if(/message (?:to edit|to be edited) not found|message can't be edited|message cannot be edited|MESSAGE_ID_INVALID/i.test(message))
    return 'cannot_edit';
  return 'unknown';
}
export function createVideoBotScreenTransport(telegramApi) {
 if(typeof telegramApi!=='function')throw new Error('verified Telegram Bot API required');
 return {
  async show(chatId,previousMessageId,panel) {
    positive(chatId,'CHAT');
    if(!panel||typeof panel.text!=='string'||panel.text.length===0||
       !panel.reply_markup||!Array.isArray(panel.reply_markup.inline_keyboard))
      throw new Error('invalid shared DM screen panel');
    const id=previousMessageId==null?null:positive(previousMessageId,'MESSAGE');
    if(id!==null) {
      try {
        await telegramApi('editMessageText',{
          chat_id:chatId,message_id:id,text:panel.text,
          reply_markup:panel.reply_markup
        });
        return {messageId:id,replaced:true};
      } catch(error) {
        const result=editOutcome(error);
        if(result==='already')return {messageId:id,replaced:true};
        if(result!=='cannot_edit')throw new Error('WIZARD_EDIT_RESULT_UNKNOWN');
      }
    }
    const sent=await telegramApi('sendMessage',{
      chat_id:chatId,text:panel.text,reply_markup:panel.reply_markup
    });
    if(!Number.isSafeInteger(sent?.message_id)||sent.message_id<=0)
      throw new Error('WIZARD_NEW_SCREEN_UNKNOWN');
    if(id!==null&&id!==sent.message_id) {
      try{await telegramApi('deleteMessage',{chat_id:chatId,message_id:id});}
      catch{/* Non-fatal: old screen's revision is rejected by the state machine. */}
    }
    return {messageId:sent.message_id,replaced:false};
  }
 };
}
