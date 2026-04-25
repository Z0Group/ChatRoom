// Client logic — uses textContent everywhere to prevent XSS
(() => {
  'use strict';

  const $ = (id) => document.getElementById(id);

  // ----- Element refs -----
  const joinScreen = $('join-screen');
  const chatScreen = $('chat-screen');
  const nicknameInput = $('nickname');
  const interestInput = $('interest-input');
  const interestTags = $('interest-tags');
  const joinBtn = $('join-btn');
  const joinError = $('join-error');
  const roomFilters = $('room-filters');
  const roomListEl = $('room-list');
  const refreshRoomsBtn = $('refresh-rooms');
  const trendingTagsEl = $('trending-tags');
  const onlineCountEl = $('online-count');
  const avatarPreview = $('avatar-preview');

  const roomTitle = $('room-title');
  const roomMeta = $('room-meta');
  const messagesEl = $('messages');
  const userListEl = $('user-list');
  const userCountBadge = $('user-count-badge');
  const sendForm = $('send-form');
  const messageInput = $('message-input');
  const chatError = $('chat-error');
  const backBtn = $('back-btn');
  const usersToggle = $('users-toggle');
  const usersPanel = $('users-panel');
  const typingIndicator = $('typing-indicator');
  const typingText = $('typing-text');
  const themeToggle = $('theme-toggle');
  const soundToggle = $('sound-toggle');
  const soundOnIcon = $('sound-on-icon');
  const soundOffIcon = $('sound-off-icon');
  const filterToggle = $('filter-toggle');
  const filterOnIcon = $('filter-on-icon');
  const filterOffIcon = $('filter-off-icon');

  // ----- State -----
  const interests = [];
  let nickname = null;
  let socket = null;
  let soundEnabled = localStorage.getItem('chat:sound') !== 'off';
  let filterEnabled = localStorage.getItem('chat:filter') !== 'off'; // Default: ON
  let currentTheme = localStorage.getItem('chat:theme') || 'dark';
  // Private-room state
  let pendingInviteRoomId = null; // when joining via ?room=CODE
  let pendingInviteCode = null;
  let createdPrivateRoomId = null; // when we just created one
  // Reply state
  let replyingTo = null; // { id, from, text }
  // Map of messageId -> message element, so we can update reactions in-place
  const messageElements = new Map();
  // Encryption state
  let encryptionKey = null; // CryptoKey object
  const encryptedBadge = $('encrypted-badge');

  const EMOJI_LIST = [
    // Smiles & People
    '😀', '😃', '😄', '😁', '😆', '😅', '😂', '🤣', '😊', '😇', '🙂', '🙃', '😉', '😌', '😍', '🥰', '😘', '😗', '😙', '😚', '😋', '😛', '😝', '😜', '🤪', '🤨', '🧐', '🤓', '😎', '🤩', '🥳', '😏', '😒', '😞', '😔', '😟', '😕', '🙁', '☹️', '😣', '😖', '😫', '😩', '🥺', '😢', '😭', '😤', '😠', '😡', '🤬', '🤯', '😳', '🥵', '🥶', '😱', '😨', '😰', '😥', '😓', '🤗', '🤔', '🤭', '🤫', '🤥', '😶', '😐', '😑', '😬', '🙄', '😯', '😦', '😧', '😮', '😲', '🥱', '😴', '🤤', '😪', '😵', '🤐', '🥴', '🤢', '🤮', '🤧', '😷', '🤒', '🤕', '🤑', '🤠', '😈', '👿', '👹', '👺', '🤡', '👻', '💀', '☠️', '👽', '👾', '🤖', '💩', '😺', '😸', '😹', '😻', '😼', '😽', '🙀', '😿', '😾',
    // Hands & Body
    '👋', '🤚', '🖐️', '✋', '🖖', '👌', '🤏', '✌️', '🤞', '🤟', '🤘', '🤙', '👈', '👉', '👆', '🖕', '👇', '☝️', '👍', '👎', '✊', '👊', '🤛', '🤜', '👏', '🙌', '👐', '🤲', '🤝', '🙏', '✍️', '💅', '🤳', '💪', '🦾', '🦿', '🦵', '🦶', '👂', '🦻', '👃', '🧠', '🦷', '🦴', '👀', '👁️', '👅', '👄', '💋', '🩸',
    // Hearts & Symbols
    '❤️', '🧡', '💛', '💚', '💙', '💜', '🖤', '🤍', '🤎', '💔', '❣️', '💕', '💞', '💓', '💗', '💖', '💘', '💝', '💟', '☮️', '✝️', '☪️', '🕉️', '☸️', '✡️', '🔯', '🕎', '☯️', '☦️', '🛐', '⛎', '♈', '♉', '♊', '♋', '♌', '♍', '♎', '♏', '♐', '♑', '♒', '♓', '🆔', '⚛️', '🉑', '☢️', '☣️', '📴', '📳', '🈶', '🈚', '🈸', '🈺', '🈷️', '✴️', '🆚', '💮', '🉐', '㊙️', '㊗️', '🈴', '🈵', '🈹', '🈲', '🅰️', '🅱️', '🆎', '🆑', '🅾️', '🆘', '❌', '⭕', '🛑', '⛔', '📛', '🚫', '💯', '💢', '♨️', '🚷', '🚯', '🚳', '🚱', '🔞', '📵', '🚭', '❗', '❕', '❓', '❔', '‼️', '⁉️', '🔅', '🌐', '🕙', '🔥', '✨', '🎉', '⭐', '💡', '🌈', '☀️', '⛈️', '🌙', '🌊'
  ];

  let latestRoomsData = [];
  let activeRoomFilter = 'all';
  applyTheme(currentTheme);
  applySoundIcon();
  applyFilterIcon();

  // ----- Helpers -----
  function setError(el, msg) { el.textContent = msg || ''; }

  function colorFromString(str) {
    let h = 0;
    for (let i = 0; i < str.length; i++) h = (h * 31 + str.charCodeAt(i)) >>> 0;
    const hue = h % 360;
    return `linear-gradient(135deg, hsl(${hue}, 70%, 55%), hsl(${(hue + 40) % 360}, 70%, 50%))`;
  }
  function initialFromName(name) {
    if (!name) return '?';
    const parts = name.trim().split(/[\s_\-]+/);
    return (parts[0][0] + (parts[1] ? parts[1][0] : '')).toUpperCase();
  }
  function makeAvatar(name, size) {
    const div = document.createElement('div');
    div.className = 'avatar' + (size === 'sm' ? ' avatar-sm' : '');
    div.style.background = colorFromString(name || '?');
    div.textContent = initialFromName(name);
    return div;
  }

  function formatTime(ts) {
    const d = new Date(ts);
    const h = d.getHours().toString().padStart(2, '0');
    const m = d.getMinutes().toString().padStart(2, '0');
    return `${h}:${m}`;
  }

  // ----- Theme & sound -----
  function applyTheme(theme) {
    if (theme === 'light') document.documentElement.setAttribute('data-theme', 'light');
    else document.documentElement.removeAttribute('data-theme');
    currentTheme = theme;
  }
  themeToggle.addEventListener('click', () => {
    const next = currentTheme === 'light' ? 'dark' : 'light';
    applyTheme(next);
    localStorage.setItem('chat:theme', next);
  });

  function applySoundIcon() {
    soundOnIcon.classList.toggle('hidden', !soundEnabled);
    soundOffIcon.classList.toggle('hidden', soundEnabled);
  }
  soundToggle.addEventListener('click', () => {
    soundEnabled = !soundEnabled;
    localStorage.setItem('chat:sound', soundEnabled ? 'on' : 'off');
    applySoundIcon();
    initAudio(); // Force audio ctx to initialize if they unmute
  });

  // ----- Profanity filter toggle -----
  function applyFilterIcon() {
    filterOnIcon.classList.toggle('hidden', !filterEnabled);
    filterOffIcon.classList.toggle('hidden', filterEnabled);
    filterToggle.title = filterEnabled ? 'Profanity filter: ON (click to show unfiltered)' : 'Profanity filter: OFF (click to enable)';
  }
  filterToggle.addEventListener('click', () => {
    filterEnabled = !filterEnabled;
    localStorage.setItem('chat:filter', filterEnabled ? 'on' : 'off');
    applyFilterIcon();
    // Re-render all visible messages with the new filter state
    messagesEl.querySelectorAll('.msg-text').forEach(el => {
      const raw = el.dataset.raw;
      if (raw) renderMessageBodySecurely(el, raw);
    });
  });

  function sanitizeClientSide(s) {
    if (!s || typeof s !== 'string') return '';
    return s
      .replace(/[\u200B-\u200F\u202A-\u202E\uFEFF]/g, '')
      .replace(/\s+/g, ' ')
      .trim();
  }

  function renderMessageBodySecurely(bodyEl, rawText) {
      if (!rawText) return;
      const mod = clientModerate(rawText);
      bodyEl.replaceChildren();
      
      const pingRegex = /(@[\w\-\.]+)/gi;
      const parts = mod.split(pingRegex);
      parts.forEach(part => {
           if (part.startsWith('@')) {
               const span = document.createElement('span');
               span.className = 'ping-highlight';
               // If it's my nickname (case-insensitive), add my-ping class for beep/color
               if (nickname && part.toLowerCase() === `@${nickname.toLowerCase()}`) {
                   span.classList.add('my-ping');
               }
               span.textContent = part;
               bodyEl.appendChild(span);
           } else if (part) {
               bodyEl.appendChild(document.createTextNode(part));
           }
      });
  }

  // Web Audio API beep — no external assets needed
  let audioCtx = null;

  function initAudio() {
    if (!audioCtx) {
      try {
        audioCtx = new (window.AudioContext || window.webkitAudioContext)();
      } catch (e) { /* no-op */ }
    }
    if (audioCtx && audioCtx.state === 'suspended') {
      audioCtx.resume().catch(() => { });
    }
  }

  function playBeep() {
    if (!soundEnabled || !audioCtx) return;
    try {
      const o = audioCtx.createOscillator();
      const g = audioCtx.createGain();
      o.connect(g); g.connect(audioCtx.destination);
      o.type = 'sine';
      const now = audioCtx.currentTime + 0.01;
      o.frequency.setValueAtTime(880, now);
      o.frequency.exponentialRampToValueAtTime(440, now + 0.12);
      g.gain.setValueAtTime(0.25, now);
      g.gain.exponentialRampToValueAtTime(0.001, now + 0.15);
      o.start(now);
      o.stop(now + 0.16);
      console.log('[Audio] Beep played successfully!');
    } catch (e) {
      console.error('[Audio] Failed to play beep:', e);
    }
  }

  // ----- Encryption Helpers -----
  // HKDF-based key derivation with salt for proper E2EE (#5)
  async function deriveKey(str, salt) {
    const encoder = new TextEncoder();
    const keyMaterial = await crypto.subtle.importKey(
      'raw', encoder.encode(str), { name: 'HKDF' }, false, ['deriveKey']
    );
    const saltBytes = encoder.encode(salt || '2z0-chatroom-v1');
    return crypto.subtle.deriveKey(
      { name: 'HKDF', hash: 'SHA-256', salt: saltBytes, info: encoder.encode('e2ee-msg') },
      keyMaterial,
      { name: 'AES-GCM', length: 256 },
      false,
      ['encrypt', 'decrypt']
    );
  }
  async function encrypt(text, key) {
    try {
      const iv = crypto.getRandomValues(new Uint8Array(12));
      const encoded = new TextEncoder().encode(text);
      const cipher = await crypto.subtle.encrypt({ name: 'AES-GCM', iv }, key, encoded);
      const combined = new Uint8Array(iv.length + cipher.byteLength);
      combined.set(iv);
      combined.set(new Uint8Array(cipher), iv.length);
      return btoa(String.fromCharCode(...combined));
    } catch (e) { return text; }
  }
  async function decrypt(base64, key) {
    try {
      const combined = new Uint8Array(atob(base64).split('').map(c => c.charCodeAt(0)));
      const iv = combined.slice(0, 12);
      const cipher = combined.slice(12);
      const decrypted = await crypto.subtle.decrypt({ name: 'AES-GCM', iv }, key, cipher);
      return new TextDecoder().decode(decrypted);
    } catch (e) { return '[Encrypted Message]'; }
  }

  async function sha256(message) {
    const msgBuffer = new TextEncoder().encode(message);
    const hashBuffer = await crypto.subtle.digest('SHA-256', msgBuffer);
    const hashArray = Array.from(new Uint8Array(hashBuffer));
    return hashArray.map(b => b.toString(16).padStart(2, '0')).join('');
  }

  // ----- Avatar live preview -----
  function updateAvatarPreview() {
    const v = nicknameInput.value.trim();
    avatarPreview.textContent = initialFromName(v);
    avatarPreview.style.background = v ? colorFromString(v) : 'var(--card)';
  }
  nicknameInput.addEventListener('input', updateAvatarPreview);
  
  // ----- Custom Popups (Toast & Dialog) -----
  const toastContainer = $('toast-container');
  const dialogModal = $('dialog-modal');
  const dialogMsg = $('dialog-msg');
  const dialogConfirmBtn = $('dialog-confirm');
  const dialogCancelBtn = $('dialog-cancel');

  function showToast(message, type = 'info', duration = 4000) {
    const toast = document.createElement('div');
    toast.className = `toast ${type}`;
    toast.textContent = message;
    toast.addEventListener('click', () => {
      toast.classList.add('hiding');
      setTimeout(() => toast.remove(), 300);
    });
    toastContainer.appendChild(toast);
    setTimeout(() => {
      if (toast.parentElement) {
        toast.classList.add('hiding');
        setTimeout(() => toast.remove(), 300);
      }
    }, duration);
  }

  function showDialog(message, onConfirm, onCancel) {
    dialogMsg.textContent = message;
    dialogModal.classList.remove('hidden');
    
    if (onCancel) dialogCancelBtn.classList.remove('hidden');
    else dialogCancelBtn.classList.add('hidden');

    const cleanup = () => {
      dialogModal.classList.add('hidden');
      dialogConfirmBtn.removeEventListener('click', handleConfirm);
      dialogCancelBtn.removeEventListener('click', handleCancel);
    };

    const handleConfirm = () => {
      cleanup();
      if (onConfirm) onConfirm();
    };
    const handleCancel = () => {
      cleanup();
      if (onCancel) onCancel();
    };

    dialogConfirmBtn.addEventListener('click', handleConfirm);
    dialogCancelBtn.addEventListener('click', handleCancel);
  }

  if (usersToggle && usersPanel) {
    usersToggle.addEventListener('click', () => {
      usersPanel.classList.toggle('show');
    });
  }
  const PROFANITY_LIST = [
    // English
    'fuck', 'shit', 'ass', 'bitch', 'cunt', 'dick', 'pussy', 'faggot', 'nigger', 'nigga', 'whore', 'slut',
    'child-abuse', 'terrorist', 'porn', 'stfu', 'gtfo', 'kys', 'retard',
    // English evasions
    'b1tch', 'sh1t', 'f u c k', 'fck', 'fuk', 'phuck', 'a$$', 'azz',
    // Spanish
    'puta', 'mierda', 'pendejo', 'cabron', 'cabrón', 'chingada', 'verga', 'coño', 'marica', 'joder',
    // French
    'merde', 'putain', 'connard', 'connasse', 'enculé', 'salaud', 'salope', 'nique', 'bordel',
    // German
    'scheiße', 'scheisse', 'arschloch', 'hurensohn', 'wichser', 'fotze', 'schwuchtel',
    // Italian
    'cazzo', 'vaffanculo', 'stronzo', 'minchia', 'puttana', 'coglione',
    // Portuguese
    'caralho', 'porra', 'merda', 'foda', 'viado', 'arrombado',
    // Russian (transliterated)
    'suka', 'blyat', 'blyad', 'pidar', 'nahui', 'ebat', 'huy',
    // Polish
    'kurwa', 'cholera', 'pierdol',
  ];

  function clientModerate(text) {
    if (!text) return text;
    if (!filterEnabled) return text; // Bypass when filter is disabled
    let out = text;
    PROFANITY_LIST.forEach(word => {
      const escaped = word.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
      const reg = new RegExp(`\\b${escaped}\\b`, 'gi');
      out = out.replace(reg, '*'.repeat(word.length));
    });
    return out;
  }

  function renderTags() {
    interestTags.replaceChildren();
    interests.forEach((t, idx) => {
      const tag = document.createElement('span');
      tag.className = 'tag';
      tag.textContent = t;
      const remove = document.createElement('button');
      remove.type = 'button';
      remove.textContent = '×';
      remove.setAttribute('aria-label', `Remove ${t}`);
      remove.addEventListener('click', () => {
        interests.splice(idx, 1);
        renderTags();
      });
      tag.appendChild(remove);
      interestTags.appendChild(tag);
    });
  }

  function addInterestFromInput() {
    const val = interestInput.value.trim().toLowerCase().replace(/^#/, '');
    if (!val) return;
    if (interests.length >= 8) return setError(joinError, 'Max 8 tags.');
    if (!/^[a-z0-9\-]+$/.test(val)) return setError(joinError, 'Tags can only contain letters, numbers, and hyphens.');
    if (interests.includes(val)) {
      interestInput.value = '';
      return;
    }
    interests.push(val);
    renderTags();
    interestInput.value = '';
  }

  interestInput.addEventListener('keydown', (e) => {
    if (e.key === 'Enter' || e.key === ' ' || e.key === ',') {
      e.preventDefault();
      addInterestFromInput();
    } else if (e.key === 'Backspace' && !interestInput.value && interests.length) {
      interests.pop();
      renderTags();
    }
  });

  document.querySelectorAll('.chip[data-suggest]').forEach((btn) => {
    btn.addEventListener('click', () => {
      interestInput.value = btn.dataset.suggest;
      addInterestFromInput();
    });
  });

  // ----- Messages -----
  let lastMessageFrom = null;

  // Helper: create an SVG element safely from a definition (#4)
  function createSvgIcon(width, height, paths) {
    const ns = 'http://www.w3.org/2000/svg';
    const svg = document.createElementNS(ns, 'svg');
    svg.setAttribute('width', width);
    svg.setAttribute('height', height);
    svg.setAttribute('viewBox', '0 0 24 24');
    svg.setAttribute('fill', 'none');
    svg.setAttribute('stroke', 'currentColor');
    svg.setAttribute('stroke-width', '2');
    svg.setAttribute('stroke-linecap', 'round');
    svg.setAttribute('stroke-linejoin', 'round');
    paths.forEach(def => {
      let el;
      if (def.tag === 'polyline') {
        el = document.createElementNS(ns, 'polyline');
        el.setAttribute('points', def.points);
      } else if (def.tag === 'path') {
        el = document.createElementNS(ns, 'path');
        el.setAttribute('d', def.d);
      } else if (def.tag === 'line') {
        el = document.createElementNS(ns, 'line');
        el.setAttribute('x1', def.x1); el.setAttribute('y1', def.y1);
        el.setAttribute('x2', def.x2); el.setAttribute('y2', def.y2);
      } else if (def.tag === 'circle') {
        el = document.createElementNS(ns, 'circle');
        el.setAttribute('cx', def.cx); el.setAttribute('cy', def.cy); el.setAttribute('r', def.r);
      }
      if (el) svg.appendChild(el);
    });
    return svg;
  }

  // Pre-defined SVG icon descriptors (#4)
  const ICONS = {
    reply: [ { tag: 'polyline', points: '9 17 4 12 9 7' }, { tag: 'path', d: 'M20 18v-2a4 4 0 0 0-4-4H4' } ],
    report: [ { tag: 'path', d: 'M10.29 3.86L1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z' }, { tag: 'line', x1:'12', y1:'9', x2:'12', y2:'13' }, { tag: 'line', x1:'12', y1:'17', x2:'12.01', y2:'17' } ],
    chevronDown: [ { tag: 'polyline', points: '6 9 12 15 18 9' } ],
    chat: [ { tag: 'path', d: "M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z" } ],
  };

  function appendMessage({ id, from, text, ts, mine, replyTo, system }) {
    if (system) {
      lastMessageFrom = null;
      const sysLi = document.createElement('li');
      sysLi.className = 'system-msg';
      sysLi.textContent = text;
      messagesEl.appendChild(sysLi);
      return;
    }

    const isGrouped = lastMessageFrom === from;
    lastMessageFrom = from;

    const li = document.createElement('li');
    li.className = 'msg' + (mine ? ' me' : '') + (isGrouped ? ' grouped' : '');
    if (id) li.dataset.msgId = id;

    if (!isGrouped) {
      const avatar = makeAvatar(from, 'sm');
      li.appendChild(avatar);
    }

    const wrap = document.createElement('div');
    wrap.className = 'msg-wrap';
    if (!isGrouped) {
      const meta = document.createElement('div');
      meta.className = 'msg-meta';
      const author = document.createElement('span');
      author.className = 'msg-author';
      author.textContent = from;
      const time = document.createElement('span');
      time.className = 'msg-time';
      time.textContent = formatTime(ts || Date.now());
      meta.appendChild(author);
      meta.appendChild(time);
      wrap.appendChild(meta);
    }

    const bubble = document.createElement('div');
    bubble.className = 'msg-bubble';
    wrap.appendChild(bubble);

    // Reply quote preview
    if (replyTo) {
      const rp = document.createElement('div');
      rp.className = 'reply-preview';
      const replyAuthor = document.createElement('span');
      replyAuthor.className = 'reply-preview-author';
      replyAuthor.textContent = replyTo.from;
      const sep = document.createTextNode(' ');
      const replyTxt = document.createElement('span');
      replyTxt.className = 'reply-preview-text';
      replyTxt.textContent = replyTo.preview;
      rp.appendChild(replyAuthor);
      rp.appendChild(sep);
      rp.appendChild(replyTxt);

      // Navigate to original message on click
      rp.addEventListener('click', (e) => {
        e.stopPropagation();
        const original = messageElements.get(replyTo.id);
        if (original && original.li) {
          original.li.scrollIntoView({ behavior: 'smooth', block: 'center' });
          original.li.classList.remove('highlight-flash');
          void original.li.offsetWidth; // Trigger reflow
          original.li.classList.add('highlight-flash');
        }
      });

      bubble.appendChild(rp);
    }

    // Smart scroll logic: check if user is at the bottom BEFORE appending
    const threshold = 50; // px
    const isAtBottom = messagesEl.scrollHeight - messagesEl.scrollTop - messagesEl.clientHeight <= threshold;

    const body = document.createElement('div');
    body.className = 'msg-text';
    bubble.appendChild(body);

    // Text is already decrypted by the socket listener — just moderate and render
    // Store raw text so the filter toggle can re-render without losing original
    body.dataset.raw = text;
    renderMessageBodySecurely(body, text);

    // Reaction row (filled later on reaction events)
    const reactionsRow = document.createElement('div');
    reactionsRow.className = 'reactions';
    bubble.appendChild(reactionsRow);

    // Hover actions: reply + react — using safe DOM APIs (#4)
    if (id) {
      const actions = document.createElement('div');
      actions.className = 'msg-actions';

      const replyBtn = document.createElement('button');
      replyBtn.className = 'msg-action-btn';
      replyBtn.type = 'button';
      replyBtn.title = 'Reply';
      replyBtn.appendChild(createSvgIcon('14', '14', ICONS.reply));
      replyBtn.addEventListener('click', (e) => { e.stopPropagation(); startReply({ id, from, text }); });

      const reactBtn = document.createElement('button');
      reactBtn.className = 'msg-action-btn';
      reactBtn.type = 'button';
      reactBtn.title = 'React';
      reactBtn.textContent = '😊';

      // --- Reaction Picker Layout ---
      const picker = document.createElement('div');
      picker.className = 'reaction-picker';

      const search = document.createElement('input');
      search.type = 'text';
      search.className = 'reaction-picker-search';
      search.placeholder = 'Search emojis...';
      search.addEventListener('click', (e) => e.stopPropagation());

      const grid = document.createElement('div');
      grid.className = 'reaction-picker-grid';

      const renderPickerGrid = (filter = '') => {
        grid.replaceChildren();
        const list = filter
          ? EMOJI_LIST.filter(e => e.includes(filter) || filter.length < 2)
          : EMOJI_LIST;

        list.forEach((emoji) => {
          const b = document.createElement('button');
          b.type = 'button';
          b.textContent = emoji;
          b.addEventListener('click', (e) => {
            e.stopPropagation();
            sendReaction(id, emoji);
            picker.classList.remove('show');
          });
          grid.appendChild(b);
        });
      };

      search.addEventListener('input', () => {
        const val = search.value.trim().toLowerCase();
        renderPickerGrid(val);
      });

      renderPickerGrid();
      picker.appendChild(search);
      picker.appendChild(grid);
      // ----------------------------

      actions.appendChild(replyBtn);

      if (!mine && !system) {
        const reportBtn = document.createElement('button');
        reportBtn.className = 'msg-action-btn';
        reportBtn.type = 'button';
        reportBtn.title = 'Report';
        reportBtn.appendChild(createSvgIcon('14', '14', ICONS.report));
        reportBtn.addEventListener('click', (e) => {
          e.stopPropagation();
          showDialog('Report this message for serious violations like threats, hate speech, or doxxing? Reports are reviewed to maintain community safety.', () => {
            // Send messageId and reported text so server can verify against stored hash
            const reportedText = body.dataset.raw || text;
            socket.emit('message:report', { messageId: id, reportedText }, (res) => {
              if (res && res.ok) {
                showToast('Report submitted. If a violation is confirmed, the user will be muted.', 'success');
              } else {
                const err = (res && res.error) || 'Unknown error occurred.';
                showToast(`Report failed: ${err}`, 'error');
              }
            });
          }, () => {}); // No-op on cancel
        });
        actions.appendChild(reportBtn);
      }

      actions.appendChild(reactBtn);
      bubble.appendChild(actions);
      bubble.appendChild(picker);

      reactBtn.addEventListener('click', (e) => {
        e.stopPropagation();
        document.querySelectorAll('.reaction-picker.show').forEach(p => { if (p !== picker) p.classList.remove('show'); });
        picker.classList.remove('drop-down');
        picker.classList.toggle('show');
        if (picker.classList.contains('show')) {
          const rect = picker.getBoundingClientRect();
          const containerRect = messagesEl.getBoundingClientRect();
          if (rect.top < containerRect.top + 10) picker.classList.add('drop-down');
          setTimeout(() => search.focus(), 50);
        }
      });
    }

    li.appendChild(wrap);
    messagesEl.appendChild(li);
    if (id) messageElements.set(id, { li, reactionsRow });

    if (isAtBottom) {
      messagesEl.scrollTop = messagesEl.scrollHeight;
      hideScrollBtn();
    } else if (!mine) {
      showScrollBtn();
    }

    while (messagesEl.childElementCount > 200) {
      const removed = messagesEl.firstChild;
      if (removed && removed.dataset && removed.dataset.msgId) {
        messageElements.delete(removed.dataset.msgId);
      }
      messagesEl.removeChild(removed);
    }
    if (!mine) {
       const isMyPing = li.querySelector('.ping-highlight.my-ping') !== null;
       if (isMyPing || !document.hasFocus()) {
           playBeep();
       }
    }
  }

  function updateReactions(messageId, reactions) {
    const entry = messageElements.get(messageId);
    if (!entry) return;
    const row = entry.reactionsRow;
    row.replaceChildren();
    reactions.forEach((r) => {
      const chip = document.createElement('button');
      chip.type = 'button';
      chip.className = 'reaction' + (r.users.includes(nickname) ? ' mine' : '');
      chip.title = r.users.join(', ');
      const em = document.createElement('span');
      em.textContent = r.emoji;
      const cnt = document.createElement('span');
      cnt.className = 'count';
      cnt.textContent = r.count;
      chip.appendChild(em);
      chip.appendChild(cnt);
      chip.addEventListener('click', () => sendReaction(messageId, r.emoji));
      row.appendChild(chip);
    });
  }

  function sendReaction(messageId, emoji) {
    if (!socket) return;
    socket.emit('react', { messageId, emoji }, () => { });
  }

  // Click outside to close any open reaction pickers
  document.addEventListener('click', () => {
    document.querySelectorAll('.reaction-picker.show').forEach(p => p.classList.remove('show'));
  });

  function appendSystem(text) {
    const li = document.createElement('li');
    li.className = 'system-msg';
    li.textContent = text;
    messagesEl.appendChild(li);
    messagesEl.scrollTop = messagesEl.scrollHeight;
  }

  // ----- Scroll to bottom button (#4 — safe DOM) -----
  const scrollBtn = document.createElement('button');
  scrollBtn.className = 'scroll-bottom-btn hidden';
  const scrollLabel = document.createElement('span');
  scrollLabel.textContent = 'New messages';
  scrollBtn.appendChild(scrollLabel);
  const scrollChevron = createSvgIcon('16', '16', ICONS.chevronDown);
  scrollChevron.setAttribute('stroke-width', '2.5');
  scrollBtn.appendChild(scrollChevron);
  document.querySelector('.chat-main').appendChild(scrollBtn);

  function showScrollBtn() {
    scrollBtn.classList.remove('hidden');
  }
  function hideScrollBtn() {
    scrollBtn.classList.add('hidden');
  }
  scrollBtn.addEventListener('click', () => {
    messagesEl.scrollTo({ top: messagesEl.scrollHeight, behavior: 'smooth' });
    hideScrollBtn();
  });

  messagesEl.addEventListener('scroll', () => {
    const threshold = 100;
    const isAtBottom = messagesEl.scrollHeight - messagesEl.scrollTop - messagesEl.clientHeight <= threshold;
    if (isAtBottom) hideScrollBtn();
  });

  // ----- Users -----
  let currentRoomUsers = [];
  function renderUsers(users) {
    currentRoomUsers = users || [];
    userListEl.replaceChildren();
    users.forEach((u) => {
      const li = document.createElement('li');
      li.appendChild(makeAvatar(u, 'sm'));
      const span = document.createElement('span');
      span.textContent = u;
      li.appendChild(span);
      userListEl.appendChild(li);
    });
    userCountBadge.textContent = users.length;
  }

  // ----- Rooms -----
  function renderRooms() {
    let list = latestRoomsData;
    if (activeRoomFilter === 'default') {
      list = list.filter(r => r.persistent && !r.private);
    } else if (activeRoomFilter === 'private') {
      list = list.filter(r => r.private);
    }

    roomListEl.replaceChildren();
    if (!list || list.length === 0) {
      const empty = document.createElement('li');
      empty.className = 'room-empty';
      const icon = document.createElement('div');
      icon.className = 'empty-icon';
      const emptyIcon = createSvgIcon('32', '32', ICONS.chat);
      emptyIcon.setAttribute('stroke-width', '1.5');
      icon.appendChild(emptyIcon);
      const p = document.createElement('p');
      p.textContent = 'No open rooms yet — be the first!';
      empty.appendChild(icon);
      empty.appendChild(p);
      roomListEl.appendChild(empty);
      return;
    }
    list.forEach((r) => {
      const li = document.createElement('li');
      li.className = 'room' + (r.full ? ' full' : '');
      li.dataset.roomId = r.roomId;

      const info = document.createElement('div');
      info.className = 'room-info';

      const icon = document.createElement('div');
      icon.className = 'room-icon';
      icon.style.background = colorFromString(r.interest);
      icon.textContent = '#';

      const text = document.createElement('div');
      const name = document.createElement('div');
      name.className = 'room-name';
      if (r.private && r.listed) {
        const isActually1on1 = r.capacity <= 2;
        const prefix = isActually1on1 ? '1-on-1' : 'Private Group';

        if (r.interests && r.interests.length > 0) {
          const tagsWrap = document.createElement('div');
          tagsWrap.className = 'room-tags';
          r.interests.slice(0, 3).forEach(tag => {
            const span = document.createElement('span');
            span.className = 'room-tag';
            span.textContent = tag;
            tagsWrap.appendChild(span);
          });
          if (r.interests.length > 3) {
            const more = document.createElement('span');
            more.className = 'room-tag-more';
            more.textContent = `+${r.interests.length - 3}`;
            tagsWrap.appendChild(more);
          }
          name.appendChild(tagsWrap);
          const badge = document.createElement('span');
          badge.className = 'listed-badge';
          badge.textContent = prefix;
          name.appendChild(badge);
        } else {
          name.textContent = prefix + ' ' + (r.code || '');
          const badge = document.createElement('span');
          badge.className = 'listed-badge';
          badge.textContent = 'Private';
          name.appendChild(badge);
        }
      } else {
        name.textContent = r.interest;
      }
      if (r.persistent) {
        const badge = document.createElement('span');
        badge.className = 'room-badge';
        badge.textContent = 'default';
        name.appendChild(badge);
      }
      const sub = document.createElement('div');
      sub.className = 'room-sub';
      if (r.full) sub.textContent = 'Full · try another';
      else if (r.persistent) sub.textContent = 'Always open · click to join';
      else if (r.private && r.listed) {
        const is1on1 = r.capacity <= 2;
        sub.textContent = `Open ${is1on1 ? '1-on-1' : 'room'} · click to join`;
      }
      else sub.textContent = 'Click to join';
      text.appendChild(name);
      text.appendChild(sub);

      info.appendChild(icon);
      info.appendChild(text);

      const count = document.createElement('span');
      count.className = 'room-count';
      const dot = document.createElement('span');
      dot.style.cssText = 'width:6px;height:6px;border-radius:50%;background:currentColor;';
      count.appendChild(dot);
      const txt = document.createElement('span');
      txt.textContent = `${r.count}/${r.capacity}`;
      count.appendChild(txt);

      li.appendChild(info);
      li.appendChild(count);

      if (!r.full) li.addEventListener('click', () => { initAudio(); joinSpecificRoom(r.roomId); });
      roomListEl.appendChild(li);
    });
  }

  function renderTrending(tags) {
    trendingTagsEl.replaceChildren();
    if (!tags || tags.length === 0) return;
    tags.forEach((t) => {
      const span = document.createElement('span');
      span.className = 'trending-tag';
      span.textContent = t;
      span.title = `Join a ${t} room`;
      span.addEventListener('click', (e) => {
        e.stopPropagation();
        initAudio();
        // Validate nickname before joining via trending tag
        const nick = nicknameInput.value.trim();
        if (!/^[\w \-\.]{1,24}$/.test(nick)) {
          return setError(joinError, 'Enter a valid nickname first (1-24 chars).');
        }
        nickname = nick;
        if (!interests.includes(t) && interests.length < 8) {
          interests.push(t);
          renderTags();
        }
        connect();
        performJoin({ nickname, interests: [t] }, (err) => setError(joinError, err));
      });
      trendingTagsEl.appendChild(span);
    });
  }

  // ----- Typing -----
  let typingTimer = null;
  let isTypingState = false;
  function emitTyping(state) {
    if (!socket || !nickname) return;
    if (isTypingState === state) return;
    isTypingState = state;
    socket.emit('typing', state);
  }
  const mentionPicker = document.createElement('div');
  mentionPicker.className = 'mention-picker hidden';
  messageInput.parentElement.style.position = 'relative';
  messageInput.parentElement.appendChild(mentionPicker);

  let mentionStartIndex = -1;
  let mentionSelectedIndex = 0;

  function renderMentionPicker(query) {
    const matched = currentRoomUsers.filter(u => u !== nickname && (query === '' || u.toLowerCase().startsWith(query.toLowerCase())));
    mentionPicker.replaceChildren();
    if (matched.length === 0) {
      mentionPicker.classList.add('hidden');
      return;
    }
    
    const canvas = document.createElement('canvas');
    const ctx = canvas.getContext('2d');
    const style = window.getComputedStyle(messageInput);
    ctx.font = `${style.fontWeight} ${style.fontSize} ${style.fontFamily}`;
    const textBefore = messageInput.value.substring(0, mentionStartIndex);
    let xOffset = ctx.measureText(textBefore).width - messageInput.scrollLeft;
    // Keep within input bounds
    const maxLeft = messageInput.clientWidth - 150; 
    xOffset = Math.max(0, Math.min(xOffset, maxLeft));
    mentionPicker.style.left = (xOffset + 40) + 'px'; // +40 for emoji btn offset
    
    mentionPicker.classList.remove('hidden');
    mentionSelectedIndex = 0;
    
    matched.slice(0, 8).forEach((u, i) => {
      const btn = document.createElement('button');
      btn.type = 'button';
      btn.className = 'mention-btn';
      if (i === 0) btn.classList.add('selected');
      btn.textContent = '@' + u;
      btn.addEventListener('click', () => {
        const text = messageInput.value;
        const currentCursor = messageInput.selectionEnd || text.length;
        messageInput.value = text.slice(0, mentionStartIndex) + '@' + u + ' ' + text.slice(currentCursor);
        mentionPicker.classList.add('hidden');
        messageInput.focus();
        messageInput.dispatchEvent(new Event('input'));
      });
      mentionPicker.appendChild(btn);
    });
  }

  messageInput.addEventListener('input', () => {
    if (messageInput.value.trim()) {
      emitTyping(true);
      clearTimeout(typingTimer);
      typingTimer = setTimeout(() => emitTyping(false), 2500);
    } else {
      emitTyping(false);
    }
    
    // Check for mentions
    const text = messageInput.value;
    const cursor = messageInput.selectionStart;
    const beforeCursor = text.slice(0, cursor);
    const match = beforeCursor.match(/(?:^|\s)@([a-zA-Z0-9\-\.]*)$/);
    if (match) {
      mentionStartIndex = cursor - match[1].length - 1; // start of the @ symbol
      renderMentionPicker(match[1]);
    } else {
      mentionPicker.classList.add('hidden');
    }
  });

  document.addEventListener('click', (e) => {
    if (!mentionPicker.contains(e.target) && e.target !== messageInput) {
      mentionPicker.classList.add('hidden');
    }
  });
  messageInput.addEventListener('keydown', (e) => {
     if (!mentionPicker.classList.contains('hidden')) {
         const btns = mentionPicker.querySelectorAll('.mention-btn');
         if (e.key === 'Escape') {
             mentionPicker.classList.add('hidden');
             e.preventDefault();
         } else if (e.key === 'ArrowDown') {
             if (btns[mentionSelectedIndex]) btns[mentionSelectedIndex].classList.remove('selected');
             mentionSelectedIndex = (mentionSelectedIndex + 1) % btns.length;
             if (btns[mentionSelectedIndex]) btns[mentionSelectedIndex].classList.add('selected');
             e.preventDefault();
         } else if (e.key === 'ArrowUp') {
             if (btns[mentionSelectedIndex]) btns[mentionSelectedIndex].classList.remove('selected');
             mentionSelectedIndex = (mentionSelectedIndex - 1 + btns.length) % btns.length;
             if (btns[mentionSelectedIndex]) btns[mentionSelectedIndex].classList.add('selected');
             e.preventDefault();
         } else if (e.key === 'Enter' || e.key === 'Tab') {
             if (btns[mentionSelectedIndex]) btns[mentionSelectedIndex].click();
             e.preventDefault();
         }
     }
  });

  function renderTyping(names) {
    const others = names.filter((n) => n !== nickname);
    if (others.length === 0) {
      typingIndicator.classList.add('hidden');
      return;
    }
    typingIndicator.classList.remove('hidden');
    if (others.length === 1) typingText.textContent = `${others[0]} is typing`;
    else if (others.length === 2) typingText.textContent = `${others[0]} and ${others[1]} are typing`;
    else typingText.textContent = `${others.length} people are typing`;
  }

  // ----- Socket -----
  function connect() {
    if (socket && socket.connected) return;
    if (socket) { try { socket.connect(); } catch (e) { } return; }

    socket = io({
      transports: ['websocket', 'polling'],
      reconnection: true,
      reconnectionAttempts: 10,
      reconnectionDelay: 800,
    });

    socket.on('connect_error', () => setError(chatError, 'Connection error.'));
    socket.on('connect', () => {
      setError(chatError, '');
      socket.emit('rooms:list', {}, (res) => {
        if (res && res.ok) {
           latestRoomsData = res.rooms;
           renderRooms();
           renderTrending(res.trending);
        }
      });
    });
    socket.on('fatal', ({ reason }) => {
      showDialog(reason || 'Disconnected.', () => {
         window.location.reload();
      });
    });

    socket.on('message', async (msg) => {
      let text = msg.text;
      const isMine = msg.from === nickname;

      if (encryptionKey && !msg.system) {
        text = await decrypt(msg.text, encryptionKey);
      }

      // Assert report hash integrity to prevent E2EE sender-immunity exploits
      // Skip if decryption failed so we can gracefully show the [Encrypted Message] placeholder
      if (!msg.system && msg.reportHash && text !== '[Encrypted Message]') {
         const expectedHash = await sha256(text);
         if (expectedHash !== msg.reportHash) {
             console.warn('Message dropped: cryptographically invalidated reportHash (evasion attempt)');
             return;
         }
      }

      if (msg.replyTo && msg.replyTo.preview) {
        let preview = msg.replyTo.preview;
        if (encryptionKey && !msg.system) {
           preview = await decrypt(preview, encryptionKey);
        }
        msg.replyTo.preview = preview.length > 140 ? preview.slice(0, 140) + '…' : preview;
      }

      // playBeep is handled inside appendMessage — no duplicate call here

      appendMessage({
        id: msg.id,
        from: msg.from,
        text,
        ts: msg.ts,
        replyTo: msg.replyTo || null,
        mine: isMine,
      });
    });
    socket.on('reaction', (data) => {
      updateReactions(data.messageId, data.reactions);
    });
    socket.on('system', (msg) => appendSystem(msg.text));
    socket.on('users', renderUsers);
    socket.on('typing', renderTyping);
    socket.on('rooms:update', (data) => {
      latestRoomsData = data.rooms;
      // Only re-render rooms/trending if we are actually looking at the lobby
      if (!joinScreen.classList.contains('hidden')) {
          renderRooms();
          renderTrending(data.trending);
      }
      onlineCountEl.textContent = data.totalOnline;
    });
    // Global online counter — reaches users inside chat rooms too
    socket.on('stats:online', (count) => {
      onlineCountEl.textContent = count;
    });
  }

  // ----- Join Room -----
  function performJoin(payload, onError) {
    socket.emit('join', payload, (res) => {
      if (!res || !res.ok) {
        return onError((res && res.error) || 'Join failed.');
      }
      joinScreen.classList.add('hidden');
      chatScreen.classList.remove('hidden');

      roomTitle.replaceChildren();
      if (res.private) {
        const wrap = document.createElement('div');
        wrap.className = 'room-title-wrap';

        if (res.interests && res.interests.length > 0) {
          res.interests.forEach(tag => {
            const span = document.createElement('span');
            span.className = 'room-tag-header';
            span.textContent = tag;
            wrap.appendChild(span);
          });
        } else if (res.interest && !res.interest.startsWith('1-on-1')) {
          const span = document.createElement('span');
          span.className = 'room-tag-header';
          span.textContent = res.interest;
          wrap.appendChild(span);
        } else {
          const t = document.createElement('span');
          t.textContent = 'Private room';
          wrap.appendChild(t);
        }

        const badge = document.createElement('span');
        badge.className = 'private-badge';
        badge.textContent = res.code || 'PRIVATE';
        wrap.appendChild(badge);

        roomTitle.appendChild(wrap);
        roomMeta.textContent = `${res.users.length}/${res.capacity} · 1-on-1`;
      } else {
        roomTitle.textContent = '#' + res.interest;
        roomMeta.textContent = `${res.users.length} member${res.users.length !== 1 ? 's' : ''}`;
      }

      // End-to-End Encryption (E2EE) Setup — only for private rooms with out-of-band keys (#5/#12)
      const hash = window.location.hash;
      let keyToDerive = null;
      let isE2EE = false;

      if (res.private && hash.includes('key=')) {
        const keyMatch = hash.match(/key=([^&]+)/);
        if (keyMatch) {
          keyToDerive = keyMatch[1];
          isE2EE = true;
        }
      }

      if (isE2EE && keyToDerive) {
        // Use HKDF with roomId as salt for proper key derivation (#5)
        deriveKey(keyToDerive, res.roomId).then(k => {
          encryptionKey = k;
          encryptedBadge.classList.remove('hidden');
          const badgeLabel = encryptedBadge.querySelector('span');
          badgeLabel.textContent = 'Zero-Knowledge E2EE';
          encryptedBadge.style.color = '#fbbf24'; // Gold
          encryptedBadge.title = 'Truly private: The server cannot read these messages.';
        });
      } else {
        // Public rooms or private rooms without a key — no E2EE (#12)
        encryptionKey = null;
        encryptedBadge.classList.add('hidden');
      }

      messagesEl.replaceChildren();
      messageElements.clear(); // Clear tracking map for the new session

      // Enforce ONLY messages after join
      if (res.history && res.history.length > 0) {
        // history is currently disabled on server, but we double-enforce here
        console.log('[Privacy] Skipping server history history buffer.');
      }

      typingIndicator.classList.add('hidden');
      renderUsers(res.users);
      messageInput.focus();

      // Clear invite state now that we're in
      pendingInviteRoomId = null;
      pendingInviteCode = null;
      createdPrivateRoomId = null;
    });
  }

  function joinSpecificRoom(roomId) {
    setError(joinError, '');
    const nick = nicknameInput.value.trim();
    if (!/^[\w \-\.]{1,24}$/.test(nick)) {
      return setError(joinError, 'Invalid nickname (1-24 chars, letters/numbers).');
    }
    nickname = nick;
    connect();
    performJoin({ nickname, interests, roomId }, (err) => setError(joinError, err));
  }

  joinBtn.addEventListener('click', () => {
    initAudio();
    setError(joinError, '');
    addInterestFromInput();
    const nick = nicknameInput.value.trim();
    if (!/^[\w \-\.]{1,24}$/.test(nick)) {
      return setError(joinError, 'Invalid nickname (1-24 chars, letters/numbers).');
    }
    nickname = nick;
    connect();

    // If we're joining via an invite link, use that room directly
    if (pendingInviteRoomId) {
      performJoin(
        { nickname, interests, roomId: pendingInviteRoomId },
        (err) => setError(joinError, err)
      );
      return;
    }

    if (interests.length === 0) {
      return setError(joinError, 'Add at least one interest.');
    }
    performJoin({ nickname, interests }, (err) => setError(joinError, err));
  });

  refreshRoomsBtn.addEventListener('click', () => {
    connect();
    if (!socket) return;
    socket.emit('rooms:list', null, (res) => {
      if (res && res.ok) {
        latestRoomsData = res.rooms;
        renderRooms();
        renderTrending(res.trending);
        onlineCountEl.textContent = res.totalOnline;
      }
    });
  });

  roomFilters.addEventListener('click', (e) => {
    const btn = e.target.closest('.filter-btn');
    if (!btn) return;

    // Update UI
    roomFilters.querySelectorAll('.filter-btn').forEach(b => b.classList.remove('active'));
    btn.classList.add('active');

    // Update state & re-render
    activeRoomFilter = btn.dataset.filter;
    renderRooms();
  });

  // ----- Reply bar -----
  const replyBar = $('reply-bar');
  const replyBarName = $('reply-bar-name');
  const replyBarPreview = $('reply-bar-preview');
  const replyCancelBtn = $('reply-cancel');

  function startReply(msg) {
    replyingTo = msg;
    replyBarName.textContent = msg.from;
    replyBarPreview.textContent = msg.text;
    replyBar.classList.remove('hidden');
    messageInput.focus();
  }
  function cancelReply() {
    replyingTo = null;
    replyBar.classList.add('hidden');
  }
  replyCancelBtn.addEventListener('click', cancelReply);
  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape' && replyingTo) cancelReply();
  });

  // ----- Emoji picker (input) -----
  const emojiBtn = $('emoji-btn');
  const emojiPicker = $('emoji-picker');
  const emojiGrid = $('emoji-picker-grid');
  EMOJI_LIST.slice(0, 48).forEach((emoji) => {
    const b = document.createElement('button');
    b.type = 'button';
    b.textContent = emoji;
    b.addEventListener('click', (e) => {
      e.stopPropagation();
      const start = messageInput.selectionStart || messageInput.value.length;
      const end = messageInput.selectionEnd || messageInput.value.length;
      const before = messageInput.value.slice(0, start);
      const after = messageInput.value.slice(end);
      messageInput.value = before + emoji + after;
      const pos = start + emoji.length;
      messageInput.setSelectionRange(pos, pos);
      messageInput.focus();
    });
    emojiGrid.appendChild(b);
  });
  emojiBtn.addEventListener('click', (e) => {
    e.stopPropagation();
    emojiPicker.classList.toggle('hidden');
  });
  document.addEventListener('click', (e) => {
    if (!emojiPicker.classList.contains('hidden') && !emojiPicker.contains(e.target) && e.target !== emojiBtn && !emojiBtn.contains(e.target)) {
      emojiPicker.classList.add('hidden');
    }
  });

  sendForm.addEventListener('submit', (e) => {
    e.preventDefault();
    setError(chatError, '');
    let text = messageInput.value;
    if (!text.trim()) return;

    (async () => {
      const sanitized = sanitizeClientSide(text);
      if (!sanitized) return;
      
      const originalText = sanitized;
      const reportHash = await sha256(originalText);
      let textToSend = originalText;
      
      if (encryptionKey) {
        textToSend = await encrypt(textToSend, encryptionKey);
      }
      const payload = { text: textToSend, reportHash };
      if (replyingTo) payload.replyToId = replyingTo.id;

      socket.emit('message', payload, (res) => {
        if (!res || !res.ok) return setError(chatError, (res && res.error) || 'Blocked.');
        messageInput.value = '';
        emojiPicker.classList.add('hidden');
        cancelReply();
        emitTyping(false);
      });
    })();
  });

  backBtn.addEventListener('click', () => {
    if (socket) socket.emit('leave');
    chatScreen.classList.add('hidden');
    joinScreen.classList.remove('hidden');
    messagesEl.replaceChildren();
    userListEl.replaceChildren();
    typingIndicator.classList.add('hidden');
    lastMessageFrom = null; // Reset message grouping for next room
    // Clear E2EE state when leaving to prevent stale key leaking to next room
    encryptionKey = null;
    encryptedBadge.classList.add('hidden');
    if (window.location.hash.includes('key=')) {
      try { window.history.replaceState({}, '', window.location.pathname + window.location.search); } catch (e) { }
    }
  });

  usersToggle.addEventListener('click', () => {
    document.getElementById('users-panel').classList.toggle('show');
  });

  // ----- Private rooms -----
  const createPrivateBtn = $('create-private-btn');
  const createListedBtn = $('create-listed-btn');
  const shareModal = $('share-modal');
  const shareCodeEl = $('share-code');
  const shareLinkInput = $('share-link-input');
  const copyLinkBtn = $('copy-link-btn');
  const copyBtnLabel = $('copy-btn-label');
  const enterPrivateBtn = $('enter-private-btn');
  const inviteBanner = $('invite-banner');
  const inviteCodeDisplay = $('invite-code-display');
  const inviteCancel = $('invite-cancel');
  const joinBtnLabel = $('join-btn-label');

  function openShareModal(code, roomId) {
    createdPrivateRoomId = roomId;
    shareCodeEl.textContent = code;

    // Include the E2EE key in the link hash if we have it
    const hash = window.location.hash || '';
    const link = `${window.location.origin}/?room=${encodeURIComponent(code)}${hash}`;

    shareLinkInput.value = link;
    shareModal.classList.remove('hidden');
  }
  function closeShareModal() { shareModal.classList.add('hidden'); }

  function createPrivate(listed) {
    initAudio();
    setError(joinError, '');
    const nick = nicknameInput.value.trim();
    if (!/^[\w \-\.]{1,24}$/.test(nick)) {
      return setError(joinError, 'Invalid nickname (1-24 chars, letters/numbers).');
    }
    nickname = nick;
    connect();

    // Ensure current input is converted to a tag
    addInterestFromInput();

    const capacity = parseInt($('room-capacity').value, 10) || 2;
    let keyStr = null;

    // Only use E2EE for unlisted private rooms to avoid locking out lobby users
    if (!listed) {
      // Use cryptographically secure random for key generation (#12)
      const keyBytes = new Uint8Array(24);
      crypto.getRandomValues(keyBytes);
      keyStr = Array.from(keyBytes, b => b.toString(36).padStart(2, '0')).join('').slice(0, 32);
      window.location.hash = `key=${keyStr}`;
    } else {
      window.location.hash = ''; // Clear any old keys
    }

    socket.emit('createPrivate', { listed: !!listed, interests, capacity }, (res) => {
      if (!res || !res.ok) {
        return setError(joinError, (res && res.error) || 'Could not create private room.');
      }

      if (listed) {
        // Jump straight into the room
        createdPrivateRoomId = res.roomId;
        performJoin({ nickname, interests, roomId: res.roomId }, (err) => setError(joinError, err));
      } else {
        openShareModal(res.code, res.roomId);
      }
    });
  }

  createPrivateBtn.addEventListener('click', () => createPrivate(false));
  createListedBtn.addEventListener('click', () => createPrivate(true));

  copyLinkBtn.addEventListener('click', async () => {
    try {
      await navigator.clipboard.writeText(shareLinkInput.value);
      copyBtnLabel.textContent = 'Copied!';
      setTimeout(() => { copyBtnLabel.textContent = 'Copy'; }, 1500);
    } catch (e) {
      // Fallback: select the text
      shareLinkInput.select();
      shareLinkInput.setSelectionRange(0, shareLinkInput.value.length);
      copyBtnLabel.textContent = 'Select + copy';
      setTimeout(() => { copyBtnLabel.textContent = 'Copy'; }, 2000);
    }
  });

  enterPrivateBtn.addEventListener('click', () => {
    initAudio();
    if (!createdPrivateRoomId || !nickname) return closeShareModal();
    closeShareModal();
    performJoin(
      { nickname, interests: [], roomId: createdPrivateRoomId },
      (err) => setError(joinError, err)
    );
  });

  shareModal.querySelectorAll('.modal-close').forEach((el) => {
    el.addEventListener('click', closeShareModal);
  });
  shareModal.querySelector('.modal-backdrop').addEventListener('click', closeShareModal);

  // Handle ?room=CODE invite links
  function handleInviteParam() {
    const params = new URLSearchParams(window.location.search);
    const code = params.get('room');
    if (!code) return;
    if (!/^[A-Z2-9]{4,8}$/i.test(code)) return;
    pendingInviteCode = code.toUpperCase();
    pendingInviteRoomId = `private:${pendingInviteCode}`;
    inviteCodeDisplay.textContent = pendingInviteCode;
    inviteBanner.classList.remove('hidden');
    joinBtnLabel.textContent = 'Join private room';
  }
  inviteCancel.addEventListener('click', () => {
    pendingInviteRoomId = null;
    pendingInviteCode = null;
    inviteBanner.classList.add('hidden');
    joinBtnLabel.textContent = 'Find me a room';
    // Clean the URL
    try { window.history.replaceState({}, '', '/'); } catch (e) { }
  });
  handleInviteParam();

  // ----- Rules modal -----
  const rulesModal = $('rules-modal');
  const rulesBtn = $('rules-btn');
  const rulesLink = $('rules-link');
  function openRules() { rulesModal.classList.remove('hidden'); }
  function closeRules() { rulesModal.classList.add('hidden'); }
  rulesBtn.addEventListener('click', openRules);
  rulesLink.addEventListener('click', openRules);
  rulesModal.querySelectorAll('.modal-close').forEach((el) => {
    el.addEventListener('click', closeRules);
  });
  rulesModal.querySelector('.modal-backdrop').addEventListener('click', closeRules);
  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape' && !rulesModal.classList.contains('hidden')) closeRules();
  });

  // Connect on load so we get live room updates
  connect();
  
  // Global interaction fallback for audio context
  document.addEventListener('click', () => initAudio(), { once: true });
})();
