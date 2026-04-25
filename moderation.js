const fs = require('fs');
const path = require('path');
const profanity = require('leo-profanity');

// Load & MERGE multi-language profanity dictionaries.
// leo-profanity.loadDictionary() replaces the word list, so we must
// collect all words first, then add them to the base English dictionary.
const PROFANITY_LANGS = ['en', 'fr', 'es', 'de', 'it', 'pt', 'ru', 'nl', 'ar', 'ja', 'zh', 'ko', 'hi', 'th'];
const mergedWords = [];
PROFANITY_LANGS.forEach(lang => {
  try {
    profanity.loadDictionary(lang);
    mergedWords.push(...profanity.list());
  } catch (e) { /* skip unavailable */ }
});
// Reset to English base, then merge everything in
profanity.loadDictionary('en');
profanity.add(mergedWords);

const LOCAL_MODERATION_FILE = path.join(__dirname, 'moderation.local.js');
let localModerationConfig = {
  extraProfanityWords: [],
  seriousViolations: [],
};

if (fs.existsSync(LOCAL_MODERATION_FILE)) {
  try {
    const loaded = require(LOCAL_MODERATION_FILE);
    if (loaded && typeof loaded === 'object') {
      localModerationConfig = {
        ...localModerationConfig,
        ...loaded,
      };
    }
  } catch (e) {
    // Keep server running if local moderation file has issues.
  }
}

if (Array.isArray(localModerationConfig.extraProfanityWords) && localModerationConfig.extraProfanityWords.length > 0) {
  profanity.add(localModerationConfig.extraProfanityWords);
}

const CONFIG = {
  MAX_NICK_LENGTH: 24,
  MAX_TAG_LENGTH: 30,
  MAX_TAGS: 8,
  MAX_MSG_LENGTH: 500,
  MSG_RATE_LIMIT_MS: 300,
};

const userStates = new Map();

function clearState(socketId) {
  userStates.delete(socketId);
}

function sanitizeText(s, maxLen) {
  if (!s || typeof s !== 'string') return '';
  s = s
    .replace(/[\u200B-\u200F\u202A-\u202E\uFEFF]/g, '')
    .replace(/\s+/g, ' ')
    .trim();
  if (s.length > maxLen) s = s.slice(0, maxLen);
  return s;
}

function sanitizeNickname(nick) {
  const cleaned = sanitizeText(nick, CONFIG.MAX_NICK_LENGTH);
  if (!/^[\w \-\.]{1,24}$/.test(cleaned)) return null;
  if (profanity.check(cleaned)) return null;
  return cleaned;
}

function sanitizeInterests(tags) {
  if (!Array.isArray(tags)) return [];
  const out = [];
  for (const tag of tags) {
    const cleaned = sanitizeText(tag, CONFIG.MAX_TAG_LENGTH).toLowerCase();
    if (!cleaned) continue;
    if (!/^[a-z0-9\-]+$/.test(cleaned)) continue;
    if (profanity.check(cleaned)) continue;
    if (!out.includes(cleaned)) out.push(cleaned);
    if (out.length >= CONFIG.MAX_TAGS) break;
  }
  return out;
}

function moderateMessage(socketId, text) {
  const now = Date.now();
  const state = userStates.get(socketId) || {
    lastMsgTs: 0,
    msgsInWindow: 0,
    windowStartTs: now,
    lastMsgHash: null
  };

  if (now - state.lastMsgTs < CONFIG.MSG_RATE_LIMIT_MS) {
    return { ok: false, reason: 'Sending too fast.' };
  }

  // Flood control: max 8 messages / 10 seconds
  if (now - state.windowStartTs > 10_000) {
    state.windowStartTs = now;
    state.msgsInWindow = 0;
  }

  if (state.msgsInWindow >= 12) {
    return { ok: false, reason: 'Stop flooding the chat.', mute: true };
  }
  if (state.msgsInWindow >= 8) {
    state.msgsInWindow++; // Still count the block so they can eventually hit mute
    userStates.set(socketId, state);
    return { ok: false, reason: 'Flood control: max 8 messages per 10 seconds.' };
  }

  const cleaned = sanitizeText(text, 8000); // Allow longer encrypted blobs
  if (!cleaned) return { ok: false, reason: 'Message is empty or invalid.' };

  // Duplicate-message blocking
  const crypto = require('crypto');
  const currentHash = crypto.createHash('sha256').update(cleaned).digest('hex');
  if (state.lastMsgHash === currentHash) {
    return { ok: false, reason: 'Please do not repeat the exact same message.' };
  }

  // Repeated-character spam blocking (safe for Base64 E2EE as probability of 10 consecutive same chars is infinitesimal)
  if (/(.)\1{12,}/.test(cleaned)) {
    return { ok: false, reason: 'Message contains excessive repeated characters.' };
  }

  // Skip profanity check for the message body since it's E2EE
  // Client-side moderation will handle filtering for the user.

  state.lastMsgTs = now;
  state.msgsInWindow++;
  state.lastMsgHash = currentHash;
  userStates.set(socketId, state);

  return { ok: true, text: cleaned };
}

const EMOJI_WHITELIST = new Set([
  '😀', '😃', '😄', '😁', '😆', '😅', '😂', '🤣', '😊', '😇', '🙂', '🙃', '😉', '😌', '😍', '🥰', '😘', '😗', '😙', '😚', '😋', '😛', '😝', '😜', '🤪', '🤨', '🧐', '🤓', '😎', '🤩', '🥳', '😏', '😒', '😞', '😔', '😟', '😕', '🙁', '☹️', '😣', '😖', '😫', '😩', '🥺', '😢', '😭', '😤', '😠', '😡', '🤬', '🤯', '😳', '🥵', '🥶', '😱', '😨', '😰', '😥', '😓', '🤗', '🤔', '🤭', '🤫', '🤥', '😶', '😐', '😑', '😬', '🙄', '😯', '😦', '😧', '😮', '😲', '🥱', '😴', '🤤', '😪', '😵', '🤐', '🥴', '🤢', '🤮', '🤧', '😷', '🤒', '🤕', '🤑', '🤠', '😈', '👿', '👹', '👺', '🤡', '👻', '💀', '☠️', '👽', '👾', '🤖', '💩', '😺', '😸', '😹', '😻', '😼', '😽', '🙀', '😿', '😾',
  '👋', '🤚', '🖐️', '✋', '🖖', '👌', '🤏', '✌️', '🤞', '🤟', '🤘', '🤙', '👈', '👉', '👆', '🖕', '👇', '☝️', '👍', '👎', '✊', '👊', '🤛', '🤜', '👏', '🙌', '👐', '🤲', '🤝', '🙏', '✍️', '💅', '🤳', '💪', '🦾', '🦿', '腿', '🦵', '🦶', '👂', '🦻', '👃', '🧠', '🦷', '🦴', '👀', '👁️', '👅', '👄', '💋', '🩸',
  '❤️', '🧡', '💛', '💚', '💙', '💜', '🖤', '🤍', '🤎', '💔', '❣️', '💕', '💞', '💓', '💗', '💖', '💘', '💝', '💟', '☮️', '✝️', '☪️', '🕉️', '☸️', '✡️', '🔯', '🕎', '☯️', '☦️', '🛐', '⛎', '♈', '♉', '♊', '♋', '♌', '♍', '♎', '♏', '♐', '♑', '♒', '♓', '🆔', '⚛️', '🉑', '☢️', '☣️', '📴', '📳', '🈶', '🈚', '🈸', '🈺', '🈷️', '✴️', '🆚', '💮', '🉐', '㊙️', '㊗️', '🈴', '🈵', '🈹', '🈲', '🅰️', '🅱️', '🆎', '🆑', '🅾️', '🆘', '❌', '⭕', '🛑', '⛔', '📛', '🚫', '💯', '💢', '♨️', '🚷', '🚯', '🚳', '🚱', '🔞', '📵', '🚭', '❗', '❕', '❓', '❔', '‼️', '⁉️', '🔅', '🌐', '🕙', '🔥', '✨', '🎉', '⭐', '💡', '🌈', '☀️', '⛈️', '🌙', '🌊'
]);

const SERIOUS_VIOLATIONS = Array.isArray(localModerationConfig.seriousViolations)
  ? localModerationConfig.seriousViolations
  : [];

function validateEmoji(e) {
  return EMOJI_WHITELIST.has(e);
}

function isSeriousViolation(text) {
  if (!text) return false;
  const cleaned = text.toLowerCase().replace(/[^\w\s]/gi, '');

  // 1. Check against specific severe phrases/threats
  for (const v of SERIOUS_VIOLATIONS) {
    if (cleaned.includes(v)) return true;
  }

  // 2. Fallback to general profanity check for other toxic behavior
  return profanity.check(text);
}

module.exports = {
  CONFIG,
  profanity,
  moderateMessage,
  sanitizeNickname,
  sanitizeInterests,
  clearState,
  validateEmoji,
  isSeriousViolation,
};
