/**
 * Compat 层统一导出
 */
export { onEvent, onEventOnce, onEventFirst, getEventTypes, EVENT_CHAT_CHANGED, EVENT_MESSAGE_DELETED, EVENT_STREAM_TOKEN, EVENT_GENERATION_STARTED, EVENT_MESSAGE_RECEIVED, EVENT_MESSAGE_SENT } from './events';
export { getWorldbook, replaceWorldbook, createWorldbook, getCharWorldbookNames, rebindCharWorldbooks, getLorebookEntries } from './worldbook';
export { getCurrentCharacterName, getCurrentCharacter, getChatMessages, setChatMessages, getLastMessageId, getChatId } from './character';
export { resolveGenerateRaw, stopGeneration, stopSpecificGeneration, getStRequestHeaders, getSillyTavernContext } from './generation';
export { injectReplyInstruction, clearReplyInstruction } from './injection';
export { errorCatched } from './errors';
export { substituteParams, checkMinimumVersion } from './tools';
//# sourceMappingURL=index.js.map