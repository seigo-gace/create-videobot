/**
 * Telegram InputSticker and sticker-set parameter contract.
 * Does not call the network; runtime must upload the transcoded bytes and
 * verify the set with getStickerSet before it reports registration complete.
 */
const asciiSegment = /^[A-Za-z][A-Za-z0-9_]*$/;
function ownerId(value) {
  if (!Number.isSafeInteger(value) || value <= 0) throw new RangeError('Telegram user_id required');
  return value;
}
function checkName(value) {
  if (typeof value !== 'string' || !asciiSegment.test(value) || value.includes('__') ||
      value.length > 64) throw new RangeError('invalid Telegram sticker set name');
  return value;
}
export function stickerSetName(prefix, botUsername, uniqueSuffix) {
  if (typeof botUsername !== 'string' || !/^[_A-Za-z0-9]{5,32}$/.test(botUsername))
    throw new RangeError('verified getMe username required');
  // CreateVdobot's verified username is provided by the caller, never guessed.
  const bot = botUsername.replace(/^@/, '');
  if (!/^[A-Za-z][A-Za-z0-9_]*$/.test(bot)) throw new RangeError('invalid bot username');
  if (!/^[A-Za-z][A-Za-z0-9_]{0,31}$/.test(prefix) ||
      !/^[A-Za-z0-9]{6,20}$/.test(uniqueSuffix)) throw new RangeError('invalid name components');
  const result = prefix + '_' + uniqueSuffix + '_by_' + bot;
  return checkName(result);
}
export function inputSticker({fileId, format, emoji = '🙂'} = {}) {
  if (typeof fileId !== 'string' || !/^[A-Za-z0-9_-]{3,256}$/.test(fileId))
    throw new RangeError('uploaded Telegram sticker file_id required');
  if (format !== 'static' && format !== 'video') throw new RangeError('unsupported sticker format');
  if (typeof emoji !== 'string' || !emoji.trim() || emoji.length > 16)
    throw new RangeError('associated Unicode emoji required');
  return Object.freeze({sticker:fileId,format,emoji_list:[emoji]});
}
export function createStickerSetParams({userId,name,title,sticker,type='regular'}={}) {
  ownerId(userId);checkName(name);
  if (typeof title !== 'string' || !title.trim() || [...title].length > 64)
    throw new RangeError('sticker set title must be 1-64 characters');
  if (type !== 'regular' && type !== 'custom_emoji') throw new RangeError('unknown sticker set type');
  if (!sticker || !['static','video'].includes(sticker.format) ||
      !Array.isArray(sticker.emoji_list) || sticker.emoji_list.length < 1 ||
      sticker.emoji_list.length > 20) throw new RangeError('invalid InputSticker');
  return Object.freeze({user_id:userId,name,title,stickers:[sticker],sticker_type:type});
}
