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
}

// Helper to get a profile by ID
function getProfile(profileId) {
  return (config.whatsappProfiles || []).find(p => p.id === profileId);
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
    const card = document.createElement('a');
    card.href = s.url;
    card.target = '_blank';
    card.rel = 'noopener noreferrer';
    card.className = 'shortcut-card';
    card.style.setProperty('--card-accent', s.color || '#5B9BD5');
    card.setAttribute('id', `shortcut-${s.id}`);
    card.innerHTML = `
      <div class="shortcut-icon" style="background: ${s.color || '#5B9BD5'}">
        <i class="${iconClass}"></i>
      </div>
      <span class="shortcut-label">${s.name}</span>
      <span class="shortcut-url">${new URL(s.url).hostname}</span>
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

  if (!tramiteId) {
    fieldsContainer.style.display = 'none';
    previewContainer.style.display = 'none';
    sendBtn.style.display = 'none';
    profileBadge.style.display = 'none';
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
    div.innerHTML = `
      <label for="field-${field}">${FIELD_LABELS[field] || field}</label>
      <input type="text" id="field-${field}" placeholder="Ingresa ${FIELD_LABELS[field] || field}" oninput="updatePreview()">
    `;
    fieldsContainer.appendChild(div);
  });

  previewContainer.style.display = 'block';
  sendBtn.style.display = 'flex';
  updatePreview();
}

function updatePreview() {
  const sel = document.getElementById('tramite-select');
  const tramiteId = sel.value;
  const tramite = config.tramites.find(t => t.id === tramiteId);
  if (!tramite) return;

  let msg = tramite.messageTemplate;

  tramite.fields.forEach(field => {
    const input = document.getElementById(`field-${field}`);
    const val = input ? input.value : '';
    msg = msg.replace(`{${field}}`, val || `[${FIELD_LABELS[field] || field}]`);
  });

  // Add member tags from the assigned profile
  const profile = getProfile(tramite.whatsappProfileId);
  if (profile && profile.members && profile.members.length > 0) {
    const tags = profile.members
      .filter(m => m.trim())
      .map(m => `@${m.trim()}`)
      .join(' ');
    if (tags) {
      msg = tags + '\n\n' + msg;
    }
  }

  document.getElementById('preview-content').textContent = msg;
}

function sendWhatsApp() {
  const sel = document.getElementById('tramite-select');
  const tramiteId = sel.value;
  const tramite = config.tramites.find(t => t.id === tramiteId);
  if (!tramite) return;

  // Get the assigned profile
  const profile = getProfile(tramite.whatsappProfileId);

  let msg = tramite.messageTemplate;

  tramite.fields.forEach(field => {
    const input = document.getElementById(`field-${field}`);
    const val = input ? input.value : '';
    msg = msg.replace(`{${field}}`, val || '');
  });

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

  const encoded = encodeURIComponent(msg);
  const phone = profile ? (profile.phoneNumber || '') : '';

  let waUrl;
  if (phone) {
    waUrl = `https://wa.me/${phone}?text=${encoded}`;
  } else {
    waUrl = `https://wa.me/?text=${encoded}`;
  }

  window.open(waUrl, '_blank');
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
          <i class="${ICON_MAP[s.icon] || 'fas fa-link'}" style="color:${s.color || '#5B9BD5'}; margin-right:6px;"></i>
          ${s.name}
        </span>
        <button class="config-card-delete" onclick="deleteShortcut(${i})" title="Eliminar">
          <i class="fas fa-trash-alt"></i>
        </button>
      </div>
      <div class="form-row">
        <div class="form-group">
          <label>Nombre</label>
          <input type="text" id="sc-name-${i}" value="${s.name}">
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
        <input type="text" id="sc-url-${i}" value="${s.url}">
      </div>
      <div class="form-group">
        <label>Color</label>
        <input type="color" id="sc-color-${i}" value="${s.color || '#5B9BD5'}" style="height:38px;cursor:pointer;">
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
    .map(p => `<option value="${p.id}">${p.name}</option>`)
    .join('');

  config.tramites.forEach((t, i) => {
    const card = document.createElement('div');
    card.className = 'config-card';
    card.innerHTML = `
      <div class="config-card-header">
        <span class="config-card-title">
          <i class="fas fa-file-alt" style="color:var(--blue-500); margin-right:6px;"></i>
          ${t.name}
        </span>
        <button class="config-card-delete" onclick="deleteTramite(${i})" title="Eliminar">
          <i class="fas fa-trash-alt"></i>
        </button>
      </div>
      <div class="form-row">
        <div class="form-group">
          <label>Nombre del Trámite</label>
          <input type="text" id="tr-name-${i}" value="${t.name}">
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
        <input type="text" id="tr-fields-${i}" value="${t.fields.join(', ')}">
        <small>Campos disponibles: nombre, curp, telefono, correo, nss, rfc, direccion</small>
      </div>
      <div class="form-group">
        <label>Plantilla del Mensaje</label>
        <textarea id="tr-msg-${i}" rows="6">${t.messageTemplate}</textarea>
        <small>Usa {nombre}, {curp}, {telefono}, etc. como variables</small>
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

function addTramite() {
  const defaultProfileId = config.whatsappProfiles.length > 0
    ? config.whatsappProfiles[0].id
    : '';
  config.tramites.push({
    id: 'tramite-' + Date.now(),
    name: 'Nuevo Trámite',
    whatsappProfileId: defaultProfileId,
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
          ${p.name}
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
        <input type="text" id="wp-name-${i}" value="${p.name}">
      </div>
      <div class="form-group">
        <label>Número de teléfono o ID del grupo</label>
        <input type="text" id="wp-phone-${i}" value="${p.phoneNumber || ''}" placeholder="Ej: 5215512345678">
        <small>Incluir código de país sin +. Ej: 521 para México celular</small>
      </div>
      <div class="form-group">
        <label>Miembros del grupo (para etiquetar)</label>
        <textarea id="wp-members-${i}" rows="3" placeholder="Un número por línea:&#10;5215512345678&#10;5215598765432">${(p.members || []).join('\n')}</textarea>
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
    messageTemplate: document.getElementById(`tr-msg-${i}`)?.value || t.messageTemplate,
    fields: (document.getElementById(`tr-fields-${i}`)?.value || '')
      .split(',')
      .map(f => f.trim())
      .filter(f => f),
  }));

  try {
    await db.collection("settings").doc("config").set(config);
    showToast('✅ Configuración guardada correctamente');
    renderShortcuts();
    populateTramiteSelect();
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
