/* ==========================================
   Centro de Copiado - App Logic
   ========================================== */

let config = null;

// Icon mapping for Font Awesome
const ICON_MAP = {
  'id-card': 'fas fa-id-card',
  'file-invoice-dollar': 'fas fa-file-invoice-dollar',
  'object-group': 'fas fa-object-group',
  'scissors': 'fas fa-scissors',
  'compress': 'fas fa-compress',
  'hospital': 'fas fa-hospital',
  'notes-medical': 'fas fa-notes-medical',
  'file-pdf': 'fas fa-file-pdf',
  'globe': 'fas fa-globe',
  'link': 'fas fa-link',
  'print': 'fas fa-print',
  'envelope': 'fas fa-envelope',
  'phone': 'fas fa-phone',
  'user': 'fas fa-user',
  'building': 'fas fa-building',
  'landmark': 'fas fa-landmark',
  'passport': 'fas fa-passport',
  'clipboard': 'fas fa-clipboard',
  'file-alt': 'fas fa-file-alt',
  'search': 'fas fa-search',
  'credit-card': 'fas fa-credit-card',
  'book': 'fas fa-book',
  'certificate': 'fas fa-certificate',
  'stamp': 'fas fa-stamp',
};

// Available icons list for the select dropdown
const AVAILABLE_ICONS = Object.keys(ICON_MAP);

// Field label mapping
const FIELD_LABELS = {
  nombre: 'Nombre completo',
  curp: 'CURP',
  telefono: 'Teléfono',
  correo: 'Correo electrónico',
  nss: 'Número de Seguro Social',
  rfc: 'RFC',
  direccion: 'Dirección',
};

// ==========================================
// INIT
// ==========================================
const firebaseConfig = {
  apiKey: "AIzaSyDJjPwtkLnh4i8sUjqy3QQGPmrUwpO7qQg",
  authDomain: "tramites-centro-de-copiado.firebaseapp.com",
  projectId: "tramites-centro-de-copiado",
  storageBucket: "tramites-centro-de-copiado.firebasestorage.app",
  messagingSenderId: "337454560294",
  appId: "1:337454560294:web:7762cb109ea766fb42e2e7",
  measurementId: "G-89204HV51Z"
};
firebase.initializeApp(firebaseConfig);
const db = firebase.firestore();

const DEFAULT_CONFIG = {
  shortcuts: [
    {
      id: "curp",
      name: "CURP",
      url: "https://www.gob.mx/curp/",
      icon: "id-card",
      color: "#1a73e8"
    }
  ],
  tramites: [
    {
      id: "tramite-curp",
      name: "Acta de Nacimiento",
      whatsappProfileId: "perfil-general",
      useEngine: true,
      gender: "f",
      dataTemplate: "*CURP:* {curp}",
      messageTemplate: "Buen día, solicitamos el trámite de *Acta de Nacimiento* para el siguiente CURP, por favor:\n\n*CURP:* {curp}\n\nMuchas gracias.",
      fields: ["curp"]
    }
  ],
  whatsappProfiles: [
    {
      id: "perfil-general",
      name: "Grupo General",
      phoneNumber: "",
      members: []
    }
  ]
};

document.addEventListener('DOMContentLoaded', loadConfig);

async function loadConfig() {
  try {
    const docRef = db.collection("settings").doc("config");
    const docSnap = await docRef.get();
    
    if (docSnap.exists) {
      config = docSnap.data();
    } else {
      config = DEFAULT_CONFIG;
      await docRef.set(config);
    }
    
    // Migrate old config format if needed
    migrateConfig();
    renderShortcuts();
    populateTramiteSelect();
  } catch (err) {
    console.error('Error cargando configuración:', err);
    showToast('Error al cargar la configuración');
  }
}

// Migrate old single whatsapp config to profiles
function migrateConfig() {
  sanitizeConfig();
  if (config.whatsapp && !config.whatsappProfiles) {
    config.whatsappProfiles = [{
      id: 'perfil-general',
      name: 'Grupo General',
      phoneNumber: config.whatsapp.phoneNumber || '',
      members: config.whatsapp.members || [],
    }];
    delete config.whatsapp;
    // Assign default profile to tramites that don't have one
    config.tramites.forEach(t => {
      if (!t.whatsappProfileId) {
        t.whatsappProfileId = 'perfil-general';
      }
    });
  }
  // Ensure whatsappProfiles exists
  if (!config.whatsappProfiles) {
    config.whatsappProfiles = [];
  }
  // Ensure all tramites have whatsappProfileId
  config.tramites.forEach(t => {
    if (!t.whatsappProfileId) {
      t.whatsappProfileId = config.whatsappProfiles.length > 0
        ? config.whatsappProfiles[0].id
        : '';
    }
  });

  // Conversation engine settings (fill in anything missing)
  const defaults = JSON.parse(JSON.stringify(DEFAULT_CONVERSATION));
  config.conversation = Object.assign(defaults, config.conversation || {});
  config.conversation.phrases = Object.assign(
    JSON.parse(JSON.stringify(DEFAULT_CONVERSATION.phrases)),
    config.conversation.phrases || {}
  );
  config.tramites.forEach(t => {
    if (t.useEngine === undefined) t.useEngine = true;
    if (!t.gender) t.gender = guessGender(t.name);
    if (t.dataTemplate === undefined) t.dataTemplate = buildDefaultDataTemplate(t.fields);
    if (t.messageTemplate === undefined) t.messageTemplate = '';
  });
}

// Helper to get a profile by ID
function getProfile(profileId) {
  return (config.whatsappProfiles || []).find(p => p.id === profileId);
}

// ==========================================
// CONVERSATION ENGINE
// ==========================================
// Arma cada mensaje en 4 partes: apertura + solicitud + datos + cierre.
// Qué frases se usan depende del tiempo desde el último envío al mismo
// perfil de WhatsApp (guardado en el navegador):
//   - ráfaga  (< burstMinutes):  sin saludo, "te pido otra ..."
//   - reciente (< recentMinutes): apertura corta
//   - fría    (>= recentMinutes): saludo (una vez por mañana / tarde)

const CONVERSATION_STATE_KEY = 'cc-conversation-state-v1';

const DEFAULT_CONVERSATION = {
  burstMinutes: 15,
  recentMinutes: 30,
  afternoonHour: 12,
  phrases: {
    greetingMorning: [
      'Buenos días',
      'Buen día',
      '¡Buenos días!',
      'Buenos días, ¿cómo están?',
    ],
    greetingAfternoon: [
      'Buenas tardes',
      '¡Buenas tardes!',
      'Buenas tardes, ¿qué tal?',
      'Buenas tardes, ¿cómo están?',
    ],
    openingReturn: [
      'Hola de nuevo',
      '¡Hola otra vez!',
      'Hola, ¿qué tal?',
      'Qué tal, de nuevo por aquí.',
    ],
    openingRecent: [
      'Hola de nuevo',
      'Oye',
      'Disculpa',
      '-',
    ],
    openingBurst: [
      '-',
    ],
    requestNew: [
      'te solicito el trámite de *{tramite}*, por favor:',
      '¿me apoyas con el trámite de *{tramite}*? Estos son los datos:',
      'te encargo el trámite de *{tramite}* con los siguientes datos:',
      'solicito el trámite de *{tramite}* para los siguientes datos, por favor:',
    ],
    requestSame: [
      'te pido {otro} *{tramite}*, por favor:',
      '¿me apoyas con {otro} *{tramite}*?',
      '{otro} *{tramite}*, por favor:',
      'te encargo {otro} *{tramite}*:',
    ],
    requestOther: [
      'ahora te pido el trámite de *{tramite}*:',
      'también te encargo el trámite de *{tramite}*, por favor:',
      '¿me apoyas ahora con el trámite de *{tramite}*?',
      'te paso uno de *{tramite}*:',
    ],
    closingFull: [
      'Muchas gracias.',
      '¡Gracias!',
      'Gracias, quedo al pendiente.',
      'Mil gracias 🙏',
    ],
    closingShort: [
      'Gracias.',
      '¡Gracias!',
      'Gracias 🙏',
      '-',
    ],
    closingBurst: [
      '-',
      'Gracias',
      '🙏',
    ],
  },
};

// Etiquetas y ayuda para el panel de configuración
const PHRASE_GROUPS = [
  { key: 'greetingMorning', label: 'Saludo de la mañana', help: 'Primer mensaje antes de la hora de corte. Se usa una sola vez por mañana.' },
  { key: 'greetingAfternoon', label: 'Saludo de la tarde', help: 'Primer mensaje después de la hora de corte. Se usa una sola vez por tarde.' },
  { key: 'openingReturn', label: 'Apertura tras una pausa larga', help: 'Pasó más del tiempo "reciente" y ya se saludó en este turno.' },
  { key: 'openingRecent', label: 'Apertura reciente', help: 'El último mensaje fue hace poco (entre la ráfaga y el tiempo reciente).' },
  { key: 'openingBurst', label: 'Apertura en ráfaga', help: 'El último mensaje fue hace muy poco. Normalmente sin apertura.' },
  { key: 'requestNew', label: 'Solicitud (inicio de conversación)', help: 'Primer trámite tras saludar o tras una pausa larga.' },
  { key: 'requestSame', label: 'Solicitud del mismo trámite', help: 'Se repite el mismo trámite que el mensaje anterior. Ej: "te pido otra Acta de Nacimiento".' },
  { key: 'requestOther', label: 'Solicitud de un trámite distinto', help: 'El mensaje anterior fue de otro trámite.' },
  { key: 'closingFull', label: 'Cierre (inicio de conversación)', help: 'Despedida del primer mensaje.' },
  { key: 'closingShort', label: 'Cierre (reciente)', help: 'Despedida cuando la conversación sigue activa.' },
  { key: 'closingBurst', label: 'Cierre (ráfaga)', help: 'Despedida en mensajes seguidos. Normalmente nada o algo muy breve.' },
];

const STAGE_INFO = {
  burst: { icon: 'fas fa-bolt', label: 'Ráfaga' },
  recent: { icon: 'fas fa-comments', label: 'Conversación reciente' },
  cold: { icon: 'fas fa-sun', label: 'Conversación nueva' },
};

// Plan de frases elegido para el mensaje actual (para que la vista previa
// y lo que se envía sean idénticos)
let currentPlan = null;
let previewTimer = null;

function getConversation() {
  return config.conversation;
}

// ==========================================
// SANITIZING (todo lo que viene de Firestore o de un JSON importado)
// ==========================================
function escapeHtml(str) {
  return String(str ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

// Solo enlaces http/https (bloquea "javascript:" y similares)
function safeUrl(url) {
  try {
    const u = new URL(String(url || '').trim());
    return u.protocol === 'http:' || u.protocol === 'https:' ? u.href : '';
  } catch (e) {
    return '';
  }
}

function safeColor(color) {
  return /^#[0-9a-f]{3,8}$/i.test(color || '') ? color : '#5B9BD5';
}

// Los nombres de campo se usan como id y dentro de onclick: solo letras, números, _ y -
function safeFieldName(field) {
  return String(field || '').trim().toLowerCase().replace(/[^a-z0-9_-]/g, '');
}

function sanitizeConfig() {
  config.shortcuts = Array.isArray(config.shortcuts) ? config.shortcuts : [];
  config.tramites = Array.isArray(config.tramites) ? config.tramites : [];
  config.tramites.forEach(t => {
    t.fields = (Array.isArray(t.fields) ? t.fields : []).map(safeFieldName).filter(f => f);
  });
}

function guessGender(name) {
  const first = (name || '').trim().split(/\s+/)[0].toLowerCase();
  return first.endsWith('a') || first === 'curp' ? 'f' : 'm';
}

function buildDefaultDataTemplate(fields) {
  return (fields || []).map(f => `*${FIELD_LABELS[f] || f}:* {${f}}`).join('\n');
}

// --- Estado local (localStorage) ---
function loadConversationState() {
  try {
    return JSON.parse(localStorage.getItem(CONVERSATION_STATE_KEY)) || {};
  } catch (e) {
    return {};
  }
}

function saveConversationState(state) {
  try {
    localStorage.setItem(CONVERSATION_STATE_KEY, JSON.stringify(state));
  } catch (e) {
    console.warn('No se pudo guardar el historial de conversación:', e);
  }
}

function profileKey(profile) {
  return profile ? profile.id : '_sin_perfil';
}

function todayKey(now) {
  return `${now.getFullYear()}-${now.getMonth() + 1}-${now.getDate()}`;
}

function formatAgo(minutes) {
  if (minutes < 1) return 'menos de 1 min';
  if (minutes < 60) return `${Math.floor(minutes)} min`;
  if (minutes < 24 * 60) {
    const h = Math.floor(minutes / 60);
    const m = Math.floor(minutes % 60);
    return m ? `${h} h ${m} min` : `${h} h`;
  }
  return 'más de un día';
}

// Decide qué tipo de apertura/solicitud/cierre corresponde ahora
function getConversationContext(tramite, profile, now = new Date()) {
  const conv = getConversation();
  const st = loadConversationState()[profileKey(profile)] || {};
  const minutes = st.lastSentAt ? (now.getTime() - st.lastSentAt) / 60000 : Infinity;
  const period = now.getHours() < conv.afternoonHour ? 'morning' : 'afternoon';
  const greeted = !!(st.greeted && st.greeted.date === todayKey(now) && st.greeted[period]);
  const sameTramite = st.lastTramiteId === tramite.id;

  let stage, opening, request, closing;
  if (minutes < conv.burstMinutes) {
    stage = 'burst';
    opening = 'openingBurst';
    closing = 'closingBurst';
  } else if (minutes < conv.recentMinutes) {
    stage = 'recent';
    opening = 'openingRecent';
    closing = 'closingShort';
  } else {
    stage = 'cold';
    opening = greeted ? 'openingReturn' : (period === 'morning' ? 'greetingMorning' : 'greetingAfternoon');
    closing = 'closingFull';
  }
  if (stage === 'cold') {
    request = 'requestNew';
  } else {
    request = sameTramite ? 'requestSame' : 'requestOther';
  }

  return { stage, period, minutes, greeted, sameTramite, opening, request, closing };
}

// Elige una frase al azar, evitando repetir la última usada en esa categoría
function pickVariant(category, avoidIdx) {
  const list = getConversation().phrases[category] || [];
  if (list.length === 0) return -1;
  if (list.length === 1) return 0;
  let idx;
  do {
    idx = Math.floor(Math.random() * list.length);
  } while (idx === avoidIdx);
  return idx;
}

function buildPlan(tramite, profile, avoidCurrent = false) {
  const ctx = getConversationContext(tramite, profile);
  const st = loadConversationState()[profileKey(profile)] || {};
  const lastVariants = st.lastVariants || {};
  const plan = { tramiteId: tramite.id, profileKey: profileKey(profile), ctx };
  ['opening', 'request', 'closing'].forEach(part => {
    const cat = ctx[part];
    // Al pedir "otra variante" evitamos la que se muestra; si no, la última enviada
    const avoid = avoidCurrent && currentPlan && currentPlan[part].cat === cat
      ? currentPlan[part].idx
      : lastVariants[cat];
    plan[part] = { cat, idx: pickVariant(cat, avoid) };
  });
  return plan;
}

function planIsStale(plan, tramite, profile) {
  if (!plan || plan.tramiteId !== tramite.id || plan.profileKey !== profileKey(profile)) return true;
  const ctx = getConversationContext(tramite, profile);
  return ['opening', 'request', 'closing'].some(part => plan[part].cat !== ctx[part]);
}

function getPhrase(sel, tramite) {
  const list = getConversation().phrases[sel.cat] || [];
  let text = (list[sel.idx] ?? '').trim();
  if (text === '-') return '';
  const otro = tramite.gender === 'm' ? 'otro' : 'otra';
  return text.split('{tramite}').join(tramite.name).split('{otro}').join(otro);
}

// Cambia mayúscula/minúscula de la primera letra, saltando ¿ ¡ * _
function setFirstLetterCase(str, upper) {
  const m = str.match(/^([¿¡*_\s]*)(.)([\s\S]*)$/);
  if (!m) return str;
  return m[1] + (upper ? m[2].toUpperCase() : m[2].toLowerCase()) + m[3];
}

function fillFields(template, tramite, usePlaceholders) {
  let msg = template || '';
  tramite.fields.forEach(field => {
    const input = document.getElementById(`field-${field}`);
    const val = input ? input.value.trim() : '';
    const fallback = usePlaceholders ? `[${FIELD_LABELS[field] || field}]` : '';
    msg = msg.split(`{${field}}`).join(val || fallback);
  });
  return msg;
}

function composeMessage(tramite, profile, usePlaceholders) {
  let msg;
  if (tramite.useEngine === false) {
    msg = fillFields(tramite.messageTemplate, tramite, usePlaceholders);
  } else {
    const opening = getPhrase(currentPlan.opening, tramite);
    const request = getPhrase(currentPlan.request, tramite);
    const closing = getPhrase(currentPlan.closing, tramite);

    let firstLine;
    if (opening && request) {
      firstLine = /[.!?…]$/.test(opening)
        ? `${opening} ${setFirstLetterCase(request, true)}`
        : `${opening}, ${setFirstLetterCase(request, false)}`;
    } else {
      firstLine = setFirstLetterCase(opening || request, true);
    }

    const data = fillFields(tramite.dataTemplate, tramite, usePlaceholders).trim();
    msg = [firstLine, data, closing].filter(Boolean).join('\n\n');
  }

  // Add member tags from the assigned profile
  if (profile && profile.members && profile.members.length > 0) {
    const tags = profile.members
      .filter(m => m.trim())
      .map(m => `@${m.trim()}`)
      .join(' ');
    if (tags) {
      msg = tags + '\n\n' + msg;
    }
  }
  return msg;
}

function recordMessageSent(tramite, profile) {
  const now = new Date();
  const state = loadConversationState();
  const key = profileKey(profile);
  const st = state[key] || {};
  const ctx = currentPlan.ctx;

  st.lastSentAt = now.getTime();
  st.lastTramiteId = tramite.id;
  st.lastVariants = st.lastVariants || {};
  ['opening', 'request', 'closing'].forEach(part => {
    st.lastVariants[currentPlan[part].cat] = currentPlan[part].idx;
  });
  // El "buenos días / buenas tardes" se usa una sola vez por turno
  if (currentPlan.opening.cat.startsWith('greeting')) {
    const today = todayKey(now);
    if (!st.greeted || st.greeted.date !== today) st.greeted = { date: today };
    st.greeted[ctx.period] = true;
  }

  state[key] = st;
  saveConversationState(state);
}

function renderConversationBadge(tramite, profile) {
  const badge = document.getElementById('conversation-badge');
  if (tramite.useEngine === false) {
    badge.style.display = 'none';
    return;
  }
  const ctx = currentPlan.ctx;
  const info = STAGE_INFO[ctx.stage];
  let detail;
  if (ctx.minutes === Infinity) {
    detail = 'Primer mensaje a este perfil · con saludo';
  } else if (ctx.stage === 'cold') {
    detail = `Último envío hace ${formatAgo(ctx.minutes)} · `
      + (ctx.greeted ? 'ya se saludó en este turno' : 'con saludo');
  } else {
    detail = `Último envío hace ${formatAgo(ctx.minutes)} · `
      + (ctx.sameTramite ? 'mismo trámite' : 'trámite distinto');
  }
  document.getElementById('conversation-stage-icon').className = info.icon;
  document.getElementById('conversation-stage-label').textContent = info.label;
  document.getElementById('conversation-stage-detail').textContent = detail;
  badge.style.display = 'flex';
}

function getSelectedTramite() {
  const tramiteId = document.getElementById('tramite-select').value;
  return config.tramites.find(t => t.id === tramiteId);
}

function shufflePlan() {
  const tramite = getSelectedTramite();
  if (!tramite) return;
  currentPlan = buildPlan(tramite, getProfile(tramite.whatsappProfileId), true);
  updatePreview();
}

function resetConversation() {
  const tramite = getSelectedTramite();
  if (!tramite) return;
  const profile = getProfile(tramite.whatsappProfileId);
  const state = loadConversationState();
  delete state[profileKey(profile)];
  saveConversationState(state);
  currentPlan = null;
  updatePreview();
  showToast(`Conversación reiniciada para ${profile ? profile.name : 'sin perfil'}`);
}

// ==========================================
// NAVIGATION
// ==========================================
function showSection(section) {
  document.querySelectorAll('.section').forEach(s => s.classList.remove('active'));
  document.querySelectorAll('.nav-btn').forEach(b => b.classList.remove('active'));

  if (section === 'shortcuts') {
    document.getElementById('section-shortcuts').classList.add('active');
    document.getElementById('btn-nav-shortcuts').classList.add('active');
  } else {
    document.getElementById('section-tramites').classList.add('active');
    document.getElementById('btn-nav-tramites').classList.add('active');
  }
}

// ==========================================
// SHORTCUTS RENDERING
// ==========================================
function renderShortcuts() {
  const grid = document.getElementById('shortcuts-grid');
  grid.innerHTML = '';

  config.shortcuts.forEach((s, i) => {
    const iconClass = ICON_MAP[s.icon] || 'fas fa-link';
    const color = safeColor(s.color);
    const url = safeUrl(s.url);
    const card = document.createElement('a');
    card.href = url || '#';
    card.target = '_blank';
    card.rel = 'noopener noreferrer';
    card.className = 'shortcut-card';
    card.style.setProperty('--card-accent', color);
    card.setAttribute('id', `shortcut-${s.id}`);
    card.innerHTML = `
      <div class="shortcut-icon" style="background: ${color}">
        <i class="${iconClass}"></i>
      </div>
      <span class="shortcut-label">${escapeHtml(s.name)}</span>
      <span class="shortcut-url">${url ? escapeHtml(new URL(url).hostname) : '⚠️ URL inválida'}</span>
    `;
    // Staggered entry animation
    card.style.animationDelay = `${i * 0.06}s`;
    card.style.animation = 'fadeInUp 0.4s ease both';
    grid.appendChild(card);
  });
}

// ==========================================
// TRAMITES
// ==========================================
function populateTramiteSelect() {
  const sel = document.getElementById('tramite-select');
  // Clear existing dynamic options
  while (sel.options.length > 1) sel.remove(1);

  config.tramites.forEach(t => {
    const opt = document.createElement('option');
    opt.value = t.id;
    opt.textContent = t.name;
    sel.appendChild(opt);
  });
}

function onTramiteSelected() {
  const sel = document.getElementById('tramite-select');
  const tramiteId = sel.value;
  const fieldsContainer = document.getElementById('tramite-fields');
  const previewContainer = document.getElementById('tramite-preview');
  const sendBtn = document.getElementById('btn-send-whatsapp');
  const profileBadge = document.getElementById('tramite-profile-badge');

  currentPlan = null;
  clearInterval(previewTimer);

  if (!tramiteId) {
    fieldsContainer.style.display = 'none';
    previewContainer.style.display = 'none';
    sendBtn.style.display = 'none';
    profileBadge.style.display = 'none';
    document.getElementById('conversation-badge').style.display = 'none';
    return;
  }

  const tramite = config.tramites.find(t => t.id === tramiteId);
  if (!tramite) return;

  // Show profile badge
  const profile = getProfile(tramite.whatsappProfileId);
  if (profile) {
    document.getElementById('profile-badge-name').textContent = profile.name;
    profileBadge.style.display = 'flex';
  } else {
    document.getElementById('profile-badge-name').textContent = '⚠️ Sin perfil asignado';
    profileBadge.style.display = 'flex';
  }

  // Render fields
  fieldsContainer.style.display = 'flex';
  fieldsContainer.innerHTML = `<label>Datos del Cliente</label>`;

  tramite.fields.forEach(field => {
    const div = document.createElement('div');
    div.className = 'field-group';

    let extraAttrs = field === 'curp' ? 'maxlength="18" autocomplete="off" spellcheck="false" style="text-transform: uppercase;"' : '';
    const label = escapeHtml(FIELD_LABELS[field] || field);

    div.innerHTML = `
      <label for="field-${field}">${label}</label>
      <input type="text" id="field-${field}" ${extraAttrs} placeholder="Ingresa ${label}" oninput="handleFieldInput(this, '${field}')">
      <small class="field-hint" id="hint-${field}"></small>
    `;
    fieldsContainer.appendChild(div);
  });

  previewContainer.style.display = 'block';
  sendBtn.style.display = 'flex';
  updatePreview();
  // Mantiene al día el "hace X min" y la etapa mientras la pantalla está abierta
  previewTimer = setInterval(updatePreview, 30000);
}

// ==========================================
// VALIDACIÓN DE CAMPOS
// ==========================================
const CURP_STATES = ['AS', 'BC', 'BS', 'CC', 'CL', 'CM', 'CS', 'CH', 'DF', 'DG', 'GT', 'GR', 'HG', 'JC', 'MC',
  'MN', 'MS', 'NT', 'NL', 'OC', 'PL', 'QT', 'QR', 'SP', 'SL', 'SR', 'TC', 'TS', 'TL', 'VZ', 'YN', 'ZS', 'NE'];

// status: empty | partial | invalid | warning | valid
function validateCurp(curp) {
  if (!curp) return { status: 'empty', message: '' };
  if (curp.length < 18) {
    const left = 18 - curp.length;
    return { status: 'partial', message: left === 1 ? 'Falta 1 carácter' : `Faltan ${left} caracteres` };
  }
  if (!/^[A-Z]{4}$/.test(curp.slice(0, 4))) {
    return { status: 'invalid', message: 'Los primeros 4 caracteres deben ser letras' };
  }
  if (!/^\d{6}$/.test(curp.slice(4, 10))) {
    return { status: 'invalid', message: 'Los caracteres 5 al 10 deben ser la fecha de nacimiento (AAMMDD)' };
  }
  const yy = +curp.slice(4, 6), mm = +curp.slice(6, 8), dd = +curp.slice(8, 10);
  // El carácter 17 es dígito para nacidos antes del 2000 y letra a partir del 2000
  const year = (/\d/.test(curp[16]) ? 1900 : 2000) + yy;
  const date = new Date(year, mm - 1, dd);
  if (date.getFullYear() !== year || date.getMonth() !== mm - 1 || date.getDate() !== dd) {
    return { status: 'invalid', message: `La fecha de nacimiento no existe (${curp.slice(8, 10)}/${curp.slice(6, 8)}/${year})` };
  }
  if (date > new Date()) {
    return { status: 'invalid', message: 'La fecha de nacimiento está en el futuro' };
  }
  if (!/^[HMX]$/.test(curp[10])) {
    return { status: 'invalid', message: 'El carácter 11 debe ser H, M o X (sexo)' };
  }
  if (!CURP_STATES.includes(curp.slice(11, 13))) {
    return { status: 'invalid', message: `"${curp.slice(11, 13)}" no es un estado válido (caracteres 12 y 13)` };
  }
  if (!/^[B-DF-HJ-NP-TV-Z]{3}$/.test(curp.slice(13, 16))) {
    return { status: 'invalid', message: 'Los caracteres 14 al 16 deben ser consonantes' };
  }
  if (!/^[A-Z\d]$/.test(curp[16]) || !/^\d$/.test(curp[17])) {
    return { status: 'invalid', message: 'Los últimos 2 caracteres no son válidos' };
  }
  // Dígito verificador (RENAPO)
  const dict = '0123456789ABCDEFGHIJKLMNÑOPQRSTUVWXYZ';
  let sum = 0;
  for (let i = 0; i < 17; i++) sum += dict.indexOf(curp[i]) * (18 - i);
  const check = (10 - (sum % 10)) % 10;
  if (check !== +curp[17]) {
    return { status: 'warning', message: 'El dígito verificador no coincide: revisa que esté bien escrita' };
  }
  const sexo = { H: 'Hombre', M: 'Mujer', X: 'No binario' }[curp[10]];
  return { status: 'valid', message: `Válida · ${sexo} · ${curp.slice(8, 10)}/${curp.slice(6, 8)}/${year}` };
}

function validateField(field, value) {
  if (field === 'curp') return validateCurp(value);
  return value ? { status: 'valid', message: '' } : { status: 'empty', message: '' };
}

function setFieldState(field, result) {
  const input = document.getElementById(`field-${field}`);
  const hint = document.getElementById(`hint-${field}`);
  if (!input) return;
  input.classList.remove('is-valid', 'is-partial', 'is-warning', 'is-invalid');
  if (result.status !== 'empty') input.classList.add(`is-${result.status}`);
  if (hint) {
    hint.textContent = result.message;
    hint.className = `field-hint${result.status !== 'empty' ? ' hint-' + result.status : ''}`;
  }
}

function handleFieldInput(input, fieldName) {
  if (fieldName === 'curp') {
    // Mayúsculas y sin espacios ni guiones (por si se pega de otro lado)
    input.value = input.value.toUpperCase().replace(/[^A-Z0-9Ñ]/g, '').slice(0, 18);
  }
  setFieldState(fieldName, validateField(fieldName, input.value.trim()));
  updatePreview();
}

// Revisa todos los campos antes de enviar. Devuelve true si se puede enviar.
function checkFieldsBeforeSend(tramite) {
  const warnings = [];
  for (const field of tramite.fields) {
    const input = document.getElementById(`field-${field}`);
    const result = validateField(field, input ? input.value.trim() : '');
    const label = FIELD_LABELS[field] || field;
    if (result.status === 'empty') {
      setFieldState(field, { status: 'invalid', message: 'Este dato es obligatorio' });
      input?.focus();
      showToast(`⚠️ Falta llenar: ${label}`);
      return false;
    }
    if (result.status === 'partial' || result.status === 'invalid') {
      setFieldState(field, { status: 'invalid', message: result.message });
      input?.focus();
      showToast(`⚠️ ${label}: ${result.message}`);
      return false;
    }
    if (result.status === 'warning') warnings.push(`${label}: ${result.message}`);
  }
  if (warnings.length) {
    return confirm(`${warnings.join('\n')}\n\n¿Enviar de todos modos?`);
  }
  return true;
}

function clearTramiteFields(tramite) {
  tramite.fields.forEach(field => {
    const input = document.getElementById(`field-${field}`);
    if (input) input.value = '';
    setFieldState(field, { status: 'empty', message: '' });
  });
  document.getElementById(`field-${tramite.fields[0]}`)?.focus();
}

function updatePreview() {
  const tramite = getSelectedTramite();
  if (!tramite) return;
  const profile = getProfile(tramite.whatsappProfileId);

  // Si cambió la etapa (p. ej. pasó la ráfaga), elegimos frases nuevas
  if (planIsStale(currentPlan, tramite, profile)) {
    currentPlan = buildPlan(tramite, profile);
  }
  renderConversationBadge(tramite, profile);
  document.getElementById('preview-content').textContent = composeMessage(tramite, profile, true);
}

function sendWhatsApp() {
  const tramite = getSelectedTramite();
  if (!tramite) return;

  if (!checkFieldsBeforeSend(tramite)) return;

  // Get the assigned profile
  const profile = getProfile(tramite.whatsappProfileId);

  if (planIsStale(currentPlan, tramite, profile)) {
    currentPlan = buildPlan(tramite, profile);
  }
  const msg = composeMessage(tramite, profile, false);

  const encoded = encodeURIComponent(msg);
  const phone = profile ? (profile.phoneNumber || '') : '';

  let waUrl;
  if (phone) {
    waUrl = `https://wa.me/${phone}?text=${encoded}`;
  } else {
    waUrl = `https://wa.me/?text=${encoded}`;
  }

  window.open(waUrl, '_blank');
  if (tramite.useEngine !== false) {
    recordMessageSent(tramite, profile);
  }
  // Listo para el siguiente cliente
  clearTramiteFields(tramite);
  currentPlan = null;
  updatePreview();
  showToast(`Abriendo WhatsApp → ${profile ? profile.name : 'sin perfil'}...`);
}

// ==========================================
// SETTINGS MODAL
// ==========================================
function openSettings() {
  try {
    renderSettingsShortcuts();
    renderSettingsTramites();
    renderSettingsWhatsAppProfiles();
    renderSettingsConversation();
  } catch (err) {
    console.error('Error rendering settings:', err);
  } finally {
    document.getElementById('settings-overlay').classList.add('visible');
  }
}

function closeSettings() {
  document.getElementById('settings-overlay').classList.remove('visible');
}

function switchSettingsTab(tabId, btn) {
  document.querySelectorAll('.tab-content').forEach(t => t.classList.remove('active'));
  document.querySelectorAll('.tab-btn').forEach(b => b.classList.remove('active'));
  document.getElementById(tabId).classList.add('active');
  btn.classList.add('active');
}

// --- Shortcuts Config ---
function renderSettingsShortcuts() {
  const list = document.getElementById('shortcuts-config-list');
  list.innerHTML = '';

  config.shortcuts.forEach((s, i) => {
    const card = document.createElement('div');
    card.className = 'config-card';
    card.innerHTML = `
      <div class="config-card-header">
        <span class="config-card-title">
          <i class="${ICON_MAP[s.icon] || 'fas fa-link'}" style="color:${safeColor(s.color)}; margin-right:6px;"></i>
          ${escapeHtml(s.name)}
        </span>
        <button class="config-card-delete" onclick="deleteShortcut(${i})" title="Eliminar">
          <i class="fas fa-trash-alt"></i>
        </button>
      </div>
      <div class="form-row">
        <div class="form-group">
          <label>Nombre</label>
          <input type="text" id="sc-name-${i}" value="${escapeHtml(s.name)}">
        </div>
        <div class="form-group">
          <label>Icono</label>
          <select id="sc-icon-${i}">
            ${AVAILABLE_ICONS.map(ic => `<option value="${ic}" ${ic === s.icon ? 'selected' : ''}>${ic}</option>`).join('')}
          </select>
        </div>
      </div>
      <div class="form-group">
        <label>URL</label>
        <input type="text" id="sc-url-${i}" value="${escapeHtml(s.url)}">
      </div>
      <div class="form-group">
        <label>Color</label>
        <input type="color" id="sc-color-${i}" value="${safeColor(s.color)}" style="height:38px;cursor:pointer;">
      </div>
    `;
    list.appendChild(card);
  });
}

function addShortcut() {
  config.shortcuts.push({
    id: 'nuevo-' + Date.now(),
    name: 'Nuevo Acceso',
    url: 'https://example.com',
    icon: 'link',
    color: '#5B9BD5',
  });
  renderSettingsShortcuts();
}

function deleteShortcut(i) {
  config.shortcuts.splice(i, 1);
  renderSettingsShortcuts();
}

// --- Tramites Config ---
function renderSettingsTramites() {
  const list = document.getElementById('tramites-config-list');
  list.innerHTML = '';

  // Build profile options for the select
  const profileOptions = (config.whatsappProfiles || [])
    .map(p => `<option value="${escapeHtml(p.id)}">${escapeHtml(p.name)}</option>`)
    .join('');

  config.tramites.forEach((t, i) => {
    const card = document.createElement('div');
    card.className = 'config-card';
    card.innerHTML = `
      <div class="config-card-header">
        <span class="config-card-title">
          <i class="fas fa-file-alt" style="color:var(--blue-500); margin-right:6px;"></i>
          ${escapeHtml(t.name)}
        </span>
        <button class="config-card-delete" onclick="deleteTramite(${i})" title="Eliminar">
          <i class="fas fa-trash-alt"></i>
        </button>
      </div>
      <div class="form-row">
        <div class="form-group">
          <label>Nombre del Trámite</label>
          <input type="text" id="tr-name-${i}" value="${escapeHtml(t.name)}">
        </div>
        <div class="form-group">
          <label><i class="fab fa-whatsapp" style="color:#25D366;"></i> Perfil WhatsApp</label>
          <select id="tr-profile-${i}">
            <option value="">— Sin perfil —</option>
            ${profileOptions}
          </select>
        </div>
      </div>
      <div class="form-group">
        <label>Campos (separados por coma)</label>
        <input type="text" id="tr-fields-${i}" value="${escapeHtml(t.fields.join(', '))}">
        <small>Campos disponibles: nombre, curp, telefono, correo, nss, rfc, direccion</small>
      </div>
      <div class="form-row">
        <div class="form-group">
          <label class="checkbox-label">
            <input type="checkbox" id="tr-engine-${i}" ${t.useEngine !== false ? 'checked' : ''} onchange="toggleTramiteEngine(${i})">
            Usar motor de conversación
          </label>
          <small>Varía saludo, solicitud y cierre según el tiempo desde el último mensaje</small>
        </div>
        <div class="form-group">
          <label>Género del trámite</label>
          <select id="tr-gender-${i}">
            <option value="f" ${t.gender !== 'm' ? 'selected' : ''}>Femenino (otra acta, otra CURP)</option>
            <option value="m" ${t.gender === 'm' ? 'selected' : ''}>Masculino (otro RFC, otro certificado)</option>
          </select>
        </div>
      </div>
      <div class="form-group" id="tr-data-group-${i}" style="${t.useEngine === false ? 'display:none;' : ''}">
        <label>Bloque de datos</label>
        <textarea id="tr-data-${i}" rows="3">${escapeHtml(t.dataTemplate)}</textarea>
        <small>Solo los datos del cliente. El saludo, la solicitud y el cierre los arma el motor (pestaña Conversaciones). Usa {nombre}, {curp}, etc.</small>
      </div>
      <div class="form-group" id="tr-msg-group-${i}" style="${t.useEngine !== false ? 'display:none;' : ''}">
        <label>Plantilla fija del mensaje</label>
        <textarea id="tr-msg-${i}" rows="6">${escapeHtml(t.messageTemplate)}</textarea>
        <small>Mensaje completo, siempre igual. Usa {nombre}, {curp}, {telefono}, etc. como variables</small>
      </div>
    `;
    list.appendChild(card);

    // Set selected profile
    const profileSelect = document.getElementById(`tr-profile-${i}`);
    if (profileSelect && t.whatsappProfileId) {
      profileSelect.value = t.whatsappProfileId;
    }
  });
}

function toggleTramiteEngine(i) {
  const on = document.getElementById(`tr-engine-${i}`).checked;
  document.getElementById(`tr-data-group-${i}`).style.display = on ? '' : 'none';
  document.getElementById(`tr-msg-group-${i}`).style.display = on ? 'none' : '';
}

// --- Conversation Engine Config ---
function renderSettingsConversation() {
  const conv = getConversation();
  const container = document.getElementById('conversation-config');

  const groups = PHRASE_GROUPS.map(g => `
    <div class="form-group">
      <label for="cv-${g.key}">${g.label}</label>
      <textarea id="cv-${g.key}" rows="4">${escapeHtml((conv.phrases[g.key] || []).join('\n'))}</textarea>
      <small>${g.help}</small>
    </div>
  `).join('');

  container.innerHTML = `
    <div class="config-card">
      <div class="config-card-header">
        <span class="config-card-title"><i class="fas fa-clock" style="color:var(--blue-500); margin-right:6px;"></i> Tiempos</span>
      </div>
      <div class="form-row form-row-3">
        <div class="form-group">
          <label for="cv-burst">Ráfaga (min)</label>
          <input type="number" id="cv-burst" min="1" value="${conv.burstMinutes}">
          <small>Menos de esto: sin saludo, "te pido otra…"</small>
        </div>
        <div class="form-group">
          <label for="cv-recent">Reciente (min)</label>
          <input type="number" id="cv-recent" min="1" value="${conv.recentMinutes}">
          <small>Más de esto: se inicia de nuevo la conversación</small>
        </div>
        <div class="form-group">
          <label for="cv-afternoon">Hora de "buenas tardes"</label>
          <input type="number" id="cv-afternoon" min="0" max="23" value="${conv.afternoonHour}">
          <small>Antes: buenos días · Después: buenas tardes</small>
        </div>
      </div>
    </div>
    <div class="config-card">
      <div class="config-card-header">
        <span class="config-card-title"><i class="fas fa-comment-dots" style="color:var(--whatsapp); margin-right:6px;"></i> Frases</span>
      </div>
      <p class="tab-description">
        Una frase por línea; se elige una al azar sin repetir la anterior.
        Escribe <strong>-</strong> en una línea para "sin texto".
        Variables: <strong>{tramite}</strong> (nombre del trámite) y <strong>{otro}</strong> ("otra" u "otro" según el género del trámite).
        Si la apertura termina en coma o sin signo, la solicitud continúa en la misma oración; si termina en . ! ?, empieza una nueva.
      </p>
      ${groups}
    </div>
    <div class="conversation-config-actions">
      <button class="btn-cancel" onclick="restoreDefaultPhrases()"><i class="fas fa-undo"></i> Restaurar frases predeterminadas</button>
      <button class="btn-cancel" onclick="clearConversationHistory()"><i class="fas fa-eraser"></i> Borrar historial de envíos de este navegador</button>
    </div>
  `;
}

function restoreDefaultPhrases() {
  if (!confirm('¿Reemplazar todas las frases y tiempos por los predeterminados? (Se aplica al guardar)')) return;
  config.conversation = JSON.parse(JSON.stringify(DEFAULT_CONVERSATION));
  renderSettingsConversation();
}

function clearConversationHistory() {
  saveConversationState({});
  currentPlan = null;
  updatePreview();
  showToast('Historial de envíos borrado: el próximo mensaje empezará con saludo');
}

function collectConversationSettings() {
  const conv = getConversation();
  const num = (id, fallback) => {
    const v = parseInt(document.getElementById(id)?.value, 10);
    return Number.isFinite(v) && v >= 0 ? v : fallback;
  };
  conv.burstMinutes = num('cv-burst', conv.burstMinutes);
  conv.recentMinutes = Math.max(num('cv-recent', conv.recentMinutes), conv.burstMinutes);
  conv.afternoonHour = Math.min(num('cv-afternoon', conv.afternoonHour), 23);
  PHRASE_GROUPS.forEach(g => {
    const el = document.getElementById(`cv-${g.key}`);
    if (!el) return;
    const lines = el.value.split('\n').map(l => l.trim()).filter(l => l);
    conv.phrases[g.key] = lines.length ? lines : ['-'];
  });
}

function addTramite() {
  const defaultProfileId = config.whatsappProfiles.length > 0
    ? config.whatsappProfiles[0].id
    : '';
  config.tramites.push({
    id: 'tramite-' + Date.now(),
    name: 'Nuevo Trámite',
    whatsappProfileId: defaultProfileId,
    useEngine: true,
    gender: 'm',
    dataTemplate: '*Nombre:* {nombre}\n*CURP:* {curp}',
    messageTemplate: 'Buen día, solicito el trámite de *Nuevo Trámite* para:\n\n*Nombre:* {nombre}\n*CURP:* {curp}\n\nGracias.',
    fields: ['nombre', 'curp'],
  });
  renderSettingsTramites();
}

function deleteTramite(i) {
  config.tramites.splice(i, 1);
  renderSettingsTramites();
}

// --- WhatsApp Profiles Config ---
function renderSettingsWhatsAppProfiles() {
  const list = document.getElementById('wa-profiles-list');
  list.innerHTML = '';

  config.whatsappProfiles.forEach((p, i) => {
    const card = document.createElement('div');
    card.className = 'config-card profile-card';

    // Count how many tramites use this profile
    const usageCount = config.tramites.filter(t => t.whatsappProfileId === p.id).length;

    card.innerHTML = `
      <div class="config-card-header">
        <span class="config-card-title">
          <i class="fab fa-whatsapp" style="color:#25D366; margin-right:6px;"></i>
          ${escapeHtml(p.name)}
          <span style="font-size:0.72rem; color:var(--text-muted); font-weight:400; margin-left:8px;">
            (${usageCount} trámite${usageCount !== 1 ? 's' : ''})
          </span>
        </span>
        <button class="config-card-delete" onclick="deleteWhatsAppProfile(${i})" title="Eliminar">
          <i class="fas fa-trash-alt"></i>
        </button>
      </div>
      <div class="form-group">
        <label>Nombre del Perfil</label>
        <input type="text" id="wp-name-${i}" value="${escapeHtml(p.name)}">
      </div>
      <div class="form-group">
        <label>Número de teléfono o ID del grupo</label>
        <input type="text" id="wp-phone-${i}" value="${escapeHtml(p.phoneNumber)}" placeholder="Ej: 5215512345678">
        <small>Incluir código de país sin +. Ej: 521 para México celular</small>
      </div>
      <div class="form-group">
        <label>Miembros del grupo (para etiquetar)</label>
        <textarea id="wp-members-${i}" rows="3" placeholder="Un número por línea:&#10;5215512345678&#10;5215598765432">${escapeHtml((p.members || []).join('\n'))}</textarea>
        <small>Estos números serán etiquetados al enviar el mensaje</small>
      </div>
    `;
    list.appendChild(card);
  });
}

function addWhatsAppProfile() {
  config.whatsappProfiles.push({
    id: 'perfil-' + Date.now(),
    name: 'Nuevo Perfil',
    phoneNumber: '',
    members: [],
  });
  renderSettingsWhatsAppProfiles();
}

function deleteWhatsAppProfile(i) {
  const profileId = config.whatsappProfiles[i].id;
  // Warn if tramites are using this profile
  const usageCount = config.tramites.filter(t => t.whatsappProfileId === profileId).length;
  if (usageCount > 0) {
    if (!confirm(`Este perfil está asignado a ${usageCount} trámite(s). Si lo eliminas, esos trámites quedarán sin perfil. ¿Continuar?`)) {
      return;
    }
    // Clear the profile from those tramites
    config.tramites.forEach(t => {
      if (t.whatsappProfileId === profileId) {
        t.whatsappProfileId = '';
      }
    });
  }
  config.whatsappProfiles.splice(i, 1);
  renderSettingsWhatsAppProfiles();
  renderSettingsTramites();
}

// --- Save ---
async function saveSettings() {
  // Collect shortcuts
  config.shortcuts = config.shortcuts.map((s, i) => ({
    id: s.id,
    name: document.getElementById(`sc-name-${i}`)?.value || s.name,
    url: document.getElementById(`sc-url-${i}`)?.value || s.url,
    icon: document.getElementById(`sc-icon-${i}`)?.value || s.icon,
    color: document.getElementById(`sc-color-${i}`)?.value || s.color,
  }));

  // Collect WhatsApp profiles (before tramites, so IDs are up to date)
  config.whatsappProfiles = config.whatsappProfiles.map((p, i) => ({
    id: p.id,
    name: document.getElementById(`wp-name-${i}`)?.value || p.name,
    phoneNumber: (document.getElementById(`wp-phone-${i}`)?.value || '').trim(),
    members: (document.getElementById(`wp-members-${i}`)?.value || '')
      .split('\n')
      .map(m => m.trim())
      .filter(m => m),
  }));

  // Collect tramites
  config.tramites = config.tramites.map((t, i) => ({
    id: t.id,
    name: document.getElementById(`tr-name-${i}`)?.value || t.name,
    whatsappProfileId: document.getElementById(`tr-profile-${i}`)?.value || '',
    useEngine: document.getElementById(`tr-engine-${i}`)?.checked ?? t.useEngine,
    gender: document.getElementById(`tr-gender-${i}`)?.value || t.gender,
    dataTemplate: document.getElementById(`tr-data-${i}`)?.value ?? t.dataTemplate,
    messageTemplate: document.getElementById(`tr-msg-${i}`)?.value || t.messageTemplate,
    fields: (document.getElementById(`tr-fields-${i}`)?.value || '')
      .split(',')
      .map(safeFieldName)
      .filter(f => f),
  }));

  collectConversationSettings();

  try {
    await db.collection("settings").doc("config").set(config);
    showToast('✅ Configuración guardada correctamente');
    renderShortcuts();
    const selectedId = document.getElementById('tramite-select').value;
    populateTramiteSelect();
    if (config.tramites.some(t => t.id === selectedId)) {
      document.getElementById('tramite-select').value = selectedId;
    }
    onTramiteSelected();
    closeSettings();
  } catch (err) {
    console.error(err);
    showToast('Error al guardar la configuración');
  }
}

// ==========================================
// EXPORT / IMPORT
// ==========================================
function exportConfig() {
  const dataStr = JSON.stringify(config, null, 2);
  const blob = new Blob([dataStr], { type: 'application/json' });
  const url = URL.createObjectURL(blob);

  const a = document.createElement('a');
  a.href = url;
  const date = new Date().toISOString().slice(0, 10);
  a.download = `centro-copiado-config_${date}.json`;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);

  showToast('📦 Configuración exportada correctamente');
}

async function importConfig(event) {
  const file = event.target.files[0];
  if (!file) return;

  // Reset the input so the same file can be re-imported if needed
  event.target.value = '';

  try {
    const text = await file.text();
    const imported = JSON.parse(text);

    // Basic validation
    if (!imported.shortcuts || !Array.isArray(imported.shortcuts)) {
      showToast('⚠️ Archivo inválido: falta la sección "shortcuts"');
      return;
    }
    if (!imported.tramites || !Array.isArray(imported.tramites)) {
      showToast('⚠️ Archivo inválido: falta la sección "tramites"');
      return;
    }
    // Accept both old and new format
    if (!imported.whatsappProfiles && !imported.whatsapp) {
      showToast('⚠️ Archivo inválido: falta la sección "whatsappProfiles"');
      return;
    }

    // Save to server
    await db.collection("settings").doc("config").set(imported);

    config = imported;
    migrateConfig(); // Ensure new format
    renderShortcuts();
    populateTramiteSelect();
    renderSettingsShortcuts();
    renderSettingsTramites();
    renderSettingsWhatsAppProfiles();
    renderSettingsConversation();
    showToast('✅ Configuración importada correctamente');
  } catch (err) {
    console.error('Error al importar:', err);
    showToast('⚠️ Error: el archivo no es un JSON válido o falló el guardado en la nube');
  }
}

// ==========================================
// TOAST
// ==========================================
function showToast(msg) {
  const toast = document.getElementById('toast');
  toast.textContent = msg;
  toast.classList.add('visible');
  setTimeout(() => toast.classList.remove('visible'), 2800);
}
