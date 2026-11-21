const STORAGE_KEY = 'umkm_kuliner_permanent_data_v1';
const STORE_PREFIX_KEY = 'umkm_kuliner_store_v1_';
const SYNC_CHANNEL_NAME = 'umkm_kuliner_sync_channel_v1';
const UNREAD_ORDERS_KEY = 'umkm_kuliner_unread_orders_v1';
const BLOB_ID_STORAGE_PREFIX = 'umkm_kuliner_blob_id_v1_';
const STORE_REGISTRY_BLOB_KEY = 'umkm_kuliner_store_registry_blob_v1';
const DEFAULT_STORE_ID = 'KEDAI-KULINER-01';
const JSONBLOB_API_BASE = 'https://jsonblob.com/api/jsonBlob';
const SIGMAWIRE_CONVERTER_URL = 'https://sigmawire.net/image-to-url-converter';
const ADMIN_ACCESS_PASSWORD = 'Kernaden02';

const DEFAULT_ADMIN_CATEGORIES = [
  'Kopi',
  'Non-Kopi',
  'Makanan Berat',
  'Camilan',
  'Bakaran',
  'Kue & Dessert'
];

let appState = {
  settings: {
    storeName: 'Kedai Kuliner UMKM',
    storeId: DEFAULT_STORE_ID,
    whatsapp: '087877611218',
    paymentInfo: 'Transfer Bank / Scan QRIS di bawah ini untuk pembayaran non-tunai.',
    qrisUrl: '',
    cloudBlobId: ''
  },
  menus: [],
  orders: []
};

let cart = [];
let currentCategory = 'Semua';
let selectedProduct = null;
let modalQty = 1;
let selectedOrderType = 'Dine In';
let selectedPaymentMethod = 'Tunai';
let uploadedProofDataUrl = '';
let uploadedProofName = '';
let uploadedProofBlob = null;
let _chosenVar1 = '';
let _chosenVar2 = '';
let _syncChannel = null;
let activeAdminPageTab = 'menu';
let unreadOrderIds = [];
let _cloudPollTimer = null;
let _isCloudSyncing = false;
let _isAdminAuthenticated = false;
let _pendingAdminAction = 'panel';

function getAvailableAdminCategories() {
  const selectEl = document.getElementById('menu-category');
  const fromSelect = selectEl
    ? Array.from(selectEl.options).map((opt) => String(opt.value || opt.textContent || '').trim()).filter(Boolean)
    : [];

  const fromMenus = (appState.menus || [])
    .map((m) => String(m?.category || '').trim())
    .filter(Boolean);

  const merged = [];
  const seen = new Set();
  [...DEFAULT_ADMIN_CATEGORIES, ...fromSelect, ...fromMenus].forEach((cat) => {
    const clean = String(cat || '').trim();
    if (!clean) return;
    const key = clean.toLowerCase();
    if (!seen.has(key)) {
      seen.add(key);
      merged.push(clean);
    }
  });
  return merged;
}

function escapeHtmlAttr(str) {
  return String(str || '')
    .replace(/&/g, '&amp;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');
}

function escapeJsArg(str) {
  return String(str || '')
    .replace(/\\/g, '\\\\')
    .replace(/'/g, "\\'");
}

function sanitizeStoreId(rawId) {
  const cleaned = String(rawId || '')
    .trim()
    .toUpperCase()
    .replace(/[^A-Z0-9_-]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 40);
  return cleaned || DEFAULT_STORE_ID;
}

function isAdminViewActive() {
  const adminView = document.getElementById('admin-view');
  return Boolean(adminView && !adminView.classList.contains('hidden'));
}

function isCustomerViewActive() {
  const custView = document.getElementById('customer-view');
  return Boolean(custView && !custView.classList.contains('hidden'));
}

function getActiveStoreId() {
  const activeId = sanitizeStoreId(appState?.settings?.storeId || DEFAULT_STORE_ID);
  if (appState && appState.settings) {
    appState.settings.storeId = activeId;
  }
  return activeId;
}

function getStoreStorageKey(storeId) {
  const cleanId = sanitizeStoreId(storeId || getActiveStoreId());
  return `${STORE_PREFIX_KEY}${cleanId}`;
}

function getBlobIdStorageKey(storeId) {
  const cleanId = sanitizeStoreId(storeId || getActiveStoreId());
  return `${BLOB_ID_STORAGE_PREFIX}${cleanId}`;
}

function getSavedBlobId(storeId) {
  const cleanId = sanitizeStoreId(storeId || getActiveStoreId());
  const fromState = String(appState?.settings?.cloudBlobId || '').trim();
  if (fromState) return fromState;
  try {
    const fromLocal = String(localStorage.getItem(getBlobIdStorageKey(cleanId)) || '').trim();
    if (fromLocal) {
      appState.settings.cloudBlobId = fromLocal;
      return fromLocal;
    }
  } catch (e) {}
  return '';
}

function saveBlobId(storeId, blobId) {
  const cleanId = sanitizeStoreId(storeId || getActiveStoreId());
  const cleanBlobId = String(blobId || '').trim();
  if (!cleanBlobId) return;
  if (cleanId === getActiveStoreId()) {
    appState.settings.cloudBlobId = cleanBlobId;
  }
  try {
    localStorage.setItem(getBlobIdStorageKey(cleanId), cleanBlobId);
  } catch (e) {}
}

function getRegistryBlobId() {
  try {
    return String(localStorage.getItem(STORE_REGISTRY_BLOB_KEY) || '').trim();
  } catch (e) {
    return '';
  }
}

function saveRegistryBlobId(regBlobId) {
  const clean = String(regBlobId || '').trim();
  if (!clean) return;
  try {
    localStorage.setItem(STORE_REGISTRY_BLOB_KEY, clean);
  } catch (e) {}
}

function normalizeImageUrl(rawUrl) {
  const str = String(rawUrl || '').trim();
  if (!str) return '';
  if (str.startsWith('data:image/')) return str;

  const driveMatch = str.match(/\/d\/([a-zA-Z0-9_-]{10,})/) || str.match(/[?&]id=([a-zA-Z0-9_-]{10,})/);
  if (str.includes('drive.google.com') && driveMatch && driveMatch[1]) {
    return `https://lh3.googleusercontent.com/d/${driveMatch[1]}`;
  }

  try {
    const parsed = new URL(str);
    if (parsed.hostname.includes('sigmawire.net')) {
      const paramUrl = parsed.searchParams.get('url') || parsed.searchParams.get('image') || parsed.searchParams.get('src');
      if (paramUrl && /^https?:\/\//i.test(paramUrl)) {
        return paramUrl.trim();
      }
    }
  } catch (e) {}

  return str;
}

function getMenuPhotoFallback(name) {
  const safeText = encodeURIComponent(String(name || 'Menu').slice(0, 22));
  return `data:image/svg+xml;utf8,%3Csvg xmlns=%27http://www.w3.org/2000/svg%27 width=%27400%27 height=%27300%27 viewBox=%270 0 400 300%27%3E%3Crect width=%27400%27 height=%27300%27 fill=%27%231f2937%27/%3E%3Ctext x=%27200%27 y=%27158%27 fill=%27%23fbbf24%27 font-size=%2722%27 font-weight=%27bold%27 font-family=%27sans-serif%27 text-anchor=%27middle%27%3E${safeText}%3C/text%3E%3C/svg%3E`;
}

function compressImageFileToDataUrl(file, maxWidth = 640, quality = 0.72) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onerror = reject;
    reader.onload = (ev) => {
      const img = new Image();
      img.onerror = reject;
      img.onload = () => {
        let width = img.naturalWidth || img.width || maxWidth;
        let height = img.naturalHeight || img.height || Math.round(maxWidth * 0.75);
        if (width > maxWidth) {
          height = Math.round((height * maxWidth) / width);
          width = maxWidth;
        }
        const canvas = document.createElement('canvas');
        canvas.width = width;
        canvas.height = height;
        const ctx = canvas.getContext('2d');
        ctx.drawImage(img, 0, 0, width, height);
        resolve(canvas.toDataURL('image/jpeg', quality));
      };
      img.src = ev.target.result;
    };
    reader.readAsDataURL(file);
  });
}

async function uploadImageToSigmawire(file) {
  const formData = new FormData();
  formData.append('image', file);
  formData.append('file', file);

  const endpoints = [
    'https://sigmawire.net/api/upload',
    'https://sigmawire.net/api/image-to-url',
    SIGMAWIRE_CONVERTER_URL
  ];

  for (const endpoint of endpoints) {
    try {
      const res = await fetch(endpoint, {
        method: 'POST',
        body: formData
      });
      if (!res.ok) continue;

      const contentType = res.headers.get('content-type') || '';
      if (contentType.includes('application/json')) {
        const data = await res.json();
        const foundUrl = data?.url || data?.imageUrl || data?.data?.url || data?.link || '';
        if (foundUrl && /^https?:\/\//i.test(foundUrl)) {
          return { url: normalizeImageUrl(foundUrl), source: 'Sigmawire' };
        }
      } else {
        const text = (await res.text()).trim();
        const urlMatch = text.match(/https?:\/\/[^\s"'<>]+/i);
        if (urlMatch && !urlMatch[0].includes('sigmawire.net/image-to-url-converter')) {
          return { url: normalizeImageUrl(urlMatch[0]), source: 'Sigmawire' };
        }
      }
    } catch (e) {}
  }

  const compressedDataUrl = await compressImageFileToDataUrl(file, 640, 0.72);
  return { url: compressedDataUrl, source: 'Lokal Tersinkron' };
}

function updateMenuPhotoPreview() {
  const input = document.getElementById('menu-photo');
  const preview = document.getElementById('menu-photo-preview');
  const nameInput = document.getElementById('menu-name');
  if (!input || !preview) return;

  const normalized = normalizeImageUrl(input.value);
  preview.src = normalized || getMenuPhotoFallback(nameInput?.value || 'Preview');
}

async function handleSigmawirePhotoUpload(event) {
  const file = event?.target?.files?.[0];
  if (!file) return;

  const statusEl = document.getElementById('sigmawire-upload-status');
  const photoInput = document.getElementById('menu-photo');
  if (statusEl) {
    statusEl.textContent = `Memproses "${file.name}" melalui Sigmawire...`;
  }

  try {
    const result = await uploadImageToSigmawire(file);
    if (photoInput) {
      photoInput.value = result.url;
      updateMenuPhotoPreview();
    }
    if (statusEl) {
      statusEl.textContent = result.source === 'Sigmawire'
        ? `Berhasil dikonversi ke URL Sigmawire: ${result.url}`
        : `Foto "${file.name}" siap disinkronkan (gunakan tab Sigmawire jika butuh URL eksternal).`;
    }
    showToast('Foto menu berhasil diproses!');
  } catch (err) {
    if (statusEl) {
      statusEl.textContent = 'Gagal memproses foto. Silakan buka Sigmawire secara manual atau periksa URL foto.';
    }
    alert('Gagal memproses foto.');
  } finally {
    event.target.value = '';
  }
}

function loadUnreadOrderIds() {
  try {
    const raw = localStorage.getItem(UNREAD_ORDERS_KEY);
    const parsed = raw ? JSON.parse(raw) : [];
    unreadOrderIds = Array.isArray(parsed) ? parsed.map(String) : [];
  } catch (e) {
    unreadOrderIds = [];
  }
}

function saveUnreadOrderIds() {
  try {
    localStorage.setItem(UNREAD_ORDERS_KEY, JSON.stringify(unreadOrderIds));
  } catch (e) {}
}

function markOrdersAsRead() {
  if (unreadOrderIds.length > 0) {
    unreadOrderIds = [];
    saveUnreadOrderIds();
  }
  updateHeaderOrderBadge();
}

function syncUnreadOrdersWithCurrentOrders(previousOrderIds = [], options = {}) {
  const { markNewlyArrivedAsUnread = false } = options;
  const currentIdSet = new Set((appState.orders || []).map((o) => String(o.id)));
  unreadOrderIds = unreadOrderIds.filter((id) => currentIdSet.has(String(id)));

  if (markNewlyArrivedAsUnread) {
    const prevSet = new Set(previousOrderIds.map(String));
    (appState.orders || []).forEach((o) => {
      const idStr = String(o.id);
      if (!prevSet.has(idStr) && !unreadOrderIds.includes(idStr)) {
        unreadOrderIds.push(idStr);
      }
    });
  }

  saveUnreadOrderIds();
}

function parseVariantList(rawOptions, fallbackLabel = '') {
  if (Array.isArray(rawOptions)) {
    return rawOptions.map((s) => String(s).trim()).filter(Boolean);
  }
  if (typeof rawOptions === 'string' && rawOptions.trim()) {
    return rawOptions.split(',').map((s) => s.trim()).filter(Boolean);
  }
  return fallbackLabel ? [String(fallbackLabel).trim()] : [];
}

function normalizeVariantObject(varObj, legacyLabel = '', legacyOptions = '') {
  if (varObj && typeof varObj === 'object') {
    const label = String(varObj.label || varObj.name || varObj.title || '').trim();
    const options = parseVariantList(varObj.options ?? varObj.values ?? varObj.choices ?? varObj.items);
    if (label && options.length) {
      return { label, options };
    }
    if (!label && options.length) {
      return { label: 'Varian', options };
    }
  }

  const labelFallback = String(legacyLabel || '').trim();
  const optionsFallback = parseVariantList(legacyOptions);
  if (labelFallback && optionsFallback.length) {
    return { label: labelFallback, options: optionsFallback };
  }
  if (!labelFallback && optionsFallback.length) {
    return { label: 'Varian', options: optionsFallback };
  }
  return null;
}

function normalizeMenuItem(raw) {
  if (!raw || typeof raw !== 'object') return null;

  let v1 = normalizeVariantObject(
    raw.variant1 || raw.var1,
    raw.var1Label || raw.variant1Label,
    raw.var1Options || raw.variant1Options
  );
  let v2 = normalizeVariantObject(
    raw.variant2 || raw.var2,
    raw.var2Label || raw.variant2Label,
    raw.var2Options || raw.variant2Options
  );

  if (!v1 && Array.isArray(raw.variants) && raw.variants.length > 0) {
    v1 = normalizeVariantObject(raw.variants[0]);
    if (raw.variants.length > 1) {
      v2 = normalizeVariantObject(raw.variants[1]);
    }
  }

  if (v1 && v2 && v1.label.toLowerCase() === v2.label.toLowerCase()) {
    const mergedSet = new Set([...v1.options, ...v2.options]);
    v1 = { label: v1.label, options: Array.from(mergedSet) };
    v2 = null;
  }

  const priceNum = Number(raw.price);
  return {
    id: String(raw.id || ('MENU-' + Date.now() + '-' + Math.random().toString(36).substring(2, 6))),
    name: String(raw.name || 'Menu Tanpa Nama').trim(),
    category: String(raw.category || 'Kopi').trim(),
    price: Number.isFinite(priceNum) && priceNum >= 0 ? priceNum : 0,
    photo: normalizeImageUrl(raw.photo || raw.image || ''),
    variant1: v1,
    variant2: v2
  };
}

function normalizeMenusArray(rawMenus) {
  if (!Array.isArray(rawMenus)) return [];
  return rawMenus.map(normalizeMenuItem).filter(Boolean);
}

function buildSyncPayload(storeId, sourceState = appState) {
  const cleanId = sanitizeStoreId(storeId || getActiveStoreId());
  const normalizedMenus = normalizeMenusArray(sourceState.menus);
  return {
    settings: {
      storeName: sourceState.settings?.storeName || 'Kedai Kuliner UMKM',
      storeId: cleanId,
      whatsapp: sourceState.settings?.whatsapp || '087877611218',
      paymentInfo: sourceState.settings?.paymentInfo || '',
      qrisUrl: normalizeImageUrl(sourceState.settings?.qrisUrl || ''),
      cloudBlobId: getSavedBlobId(cleanId)
    },
    menus: normalizedMenus,
    orders: Array.isArray(sourceState.orders) ? sourceState.orders : [],
    updatedAt: Date.now()
  };
}

async function ensureCloudBlobId(storeId, payload) {
  const cleanId = sanitizeStoreId(storeId || getActiveStoreId());
  const existingBlobId = getSavedBlobId(cleanId);
  if (existingBlobId) return existingBlobId;

  try {
    const res = await fetch(JSONBLOB_API_BASE, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Accept': 'application/json'
      },
      body: JSON.stringify(payload)
    });
    if (!res.ok) return '';
    const locationHeader = res.headers.get('X-JsonBlob-Id') || res.headers.get('Location') || '';
    const match = String(locationHeader).match(/([a-zA-Z0-9_-]{10,})$/);
    const createdId = match ? match[1] : '';
    if (createdId) {
      saveBlobId(cleanId, createdId);
      payload.settings.cloudBlobId = createdId;
      await registerStoreBlobInCloud(cleanId, createdId);
    }
    return createdId;
  } catch (err) {
    return '';
  }
}

async function registerStoreBlobInCloud(storeId, blobId) {
  const cleanStoreId = sanitizeStoreId(storeId);
  const cleanBlobId = String(blobId || '').trim();
  if (!cleanStoreId || !cleanBlobId) return;

  try {
    let regBlobId = getRegistryBlobId();
    let registryMap = {};

    if (regBlobId) {
      const getRes = await fetch(`${JSONBLOB_API_BASE}/${regBlobId}`, {
        method: 'GET',
        headers: { 'Accept': 'application/json' },
        cache: 'no-store'
      });
      if (getRes.ok) {
        const currentReg = await getRes.json();
        if (currentReg && typeof currentReg === 'object') {
          registryMap = { ...currentReg };
        }
      }
    }

    registryMap[cleanStoreId] = cleanBlobId;

    if (!regBlobId) {
      const postRes = await fetch(JSONBLOB_API_BASE, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Accept': 'application/json'
        },
        body: JSON.stringify(registryMap)
      });
      if (postRes.ok) {
        const loc = postRes.headers.get('X-JsonBlob-Id') || postRes.headers.get('Location') || '';
        const match = String(loc).match(/([a-zA-Z0-9_-]{10,})$/);
        if (match && match[1]) {
          regBlobId = match[1];
          saveRegistryBlobId(regBlobId);
        }
      }
    } else {
      await fetch(`${JSONBLOB_API_BASE}/${regBlobId}`, {
        method: 'PUT',
        headers: {
          'Content-Type': 'application/json',
          'Accept': 'application/json'
        },
        body: JSON.stringify(registryMap)
      });
    }
  } catch (e) {}
}

async function pushStoreToCloud(storeId, sourceState = appState) {
  if (_isCloudSyncing) return;
  _isCloudSyncing = true;
  const cleanId = sanitizeStoreId(storeId || getActiveStoreId());
  try {
    const payload = buildSyncPayload(cleanId, sourceState);
    const blobId = await ensureCloudBlobId(cleanId, payload);
    if (!blobId) return;

    await fetch(`${JSONBLOB_API_BASE}/${blobId}`, {
      method: 'PUT',
      headers: {
        'Content-Type': 'application/json',
        'Accept': 'application/json'
      },
      body: JSON.stringify(payload)
    });
    await registerStoreBlobInCloud(cleanId, blobId);
  } catch (err) {
    console.warn('Sinkron cloud tertunda:', err);
  } finally {
    _isCloudSyncing = false;
  }
}

async function pullStoreFromCloud(storeId) {
  const cleanId = sanitizeStoreId(storeId || getActiveStoreId());
  let blobId = getSavedBlobId(cleanId);

  if (!blobId) {
    const regBlobId = getRegistryBlobId();
    if (regBlobId) {
      try {
        const regRes = await fetch(`${JSONBLOB_API_BASE}/${regBlobId}`, {
          method: 'GET',
          headers: { 'Accept': 'application/json' },
          cache: 'no-store'
        });
        if (regRes.ok) {
          const regData = await regRes.json();
          if (regData && regData[cleanId]) {
            blobId = String(regData[cleanId]).trim();
            saveBlobId(cleanId, blobId);
          }
        }
      } catch (e) {}
    }
  }

  if (!blobId) return null;

  try {
    const res = await fetch(`${JSONBLOB_API_BASE}/${blobId}`, {
      method: 'GET',
      headers: { 'Accept': 'application/json' },
      cache: 'no-store'
    });
    if (!res.ok) return null;
    const data = await res.json();
    if (!data || typeof data !== 'object') return null;
    if (data.settings?.cloudBlobId) {
      saveBlobId(cleanId, data.settings.cloudBlobId);
    }
    return data;
  } catch (err) {
    return null;
  }
}

function applyIncomingData(parsed, { persist = true, refreshView = true, isLiveUpdate = false } = {}) {
  if (!parsed || typeof parsed !== 'object') return;
  const previousOrderIds = (appState.orders || []).map((o) => String(o.id));

  if (parsed.settings && typeof parsed.settings === 'object') {
    appState.settings = { ...appState.settings, ...parsed.settings };
  }
  appState.settings.storeId = sanitizeStoreId(appState.settings.storeId || DEFAULT_STORE_ID);
  appState.settings.qrisUrl = normalizeImageUrl(appState.settings.qrisUrl || '');

  const activeId = getActiveStoreId();
  if (parsed.settings?.cloudBlobId) {
    saveBlobId(activeId, parsed.settings.cloudBlobId);
  }

  if (Array.isArray(parsed.menus)) {
    appState.menus = normalizeMenusArray(parsed.menus);
  }
  if (Array.isArray(parsed.orders)) {
    appState.orders = parsed.orders;
  }

  syncUnreadOrdersWithCurrentOrders(previousOrderIds, { markNewlyArrivedAsUnread: isLiveUpdate });

  if (persist) {
    const serialized = JSON.stringify(appState);
    try {
      localStorage.setItem(STORAGE_KEY, serialized);
      localStorage.setItem(getStoreStorageKey(activeId), serialized);
    } catch (e) {}
  }

  if (refreshView) {
    if (isAdminViewActive() && _isAdminAuthenticated) {
      const ordersSectionVisible = !document.getElementById('admin-page-orders')?.classList.contains('hidden');
      const settingsPanelOpen = !document.getElementById('admin-settings-panel')?.classList.contains('hidden');
      if (activeAdminPageTab === 'orders' && ordersSectionVisible && !settingsPanelOpen) {
        markOrdersAsRead();
      } else {
        updateHeaderOrderBadge();
      }
      syncAdminInputsFromState();
      renderAdminMenuList();
      renderAdminOrdersList();
      generateAdminQRCode({ syncCloud: false });
    }
    if (isCustomerViewActive()) {
      initCustomerPage();
    }
  }
}

function setupCrossTabSync() {
  window.addEventListener('storage', (event) => {
    if (event.key === UNREAD_ORDERS_KEY) {
      loadUnreadOrderIds();
      if (isAdminViewActive() && _isAdminAuthenticated) updateHeaderOrderBadge();
      return;
    }

    const activeStoreKey = getStoreStorageKey(getActiveStoreId());
    if ((event.key === STORAGE_KEY || event.key === activeStoreKey) && event.newValue) {
      try {
        const parsed = JSON.parse(event.newValue);
        applyIncomingData(parsed, { persist: false, refreshView: true, isLiveUpdate: true });
      } catch (e) {
        console.warn('Gagal menyinkronkan perubahan storage:', e);
      }
    }
  });

  if (typeof BroadcastChannel !== 'undefined') {
    _syncChannel = new BroadcastChannel(SYNC_CHANNEL_NAME);
    _syncChannel.onmessage = (event) => {
      if (event.data && event.data.type === 'STATE_UPDATED' && event.data.payload) {
        applyIncomingData(event.data.payload, { persist: true, refreshView: true, isLiveUpdate: true });
      }
    };
  }

  document.addEventListener('click', (event) => {
    const dropdown = document.getElementById('cust-cat-dropdown');
    const btn = document.getElementById('cust-cat-dropdown-btn');
    if (dropdown && !dropdown.classList.contains('hidden')) {
      const clickedInsideDropdown = dropdown.contains(event.target);
      const clickedBtn = btn && btn.contains(event.target);
      if (!clickedInsideDropdown && !clickedBtn) {
        dropdown.classList.add('hidden');
      }
    }
  });

  document.addEventListener('visibilitychange', async () => {
    if (document.visibilityState === 'visible') {
      const cloudData = await pullStoreFromCloud(getActiveStoreId());
      if (cloudData) {
        applyIncomingData(cloudData, { persist: true, refreshView: true, isLiveUpdate: true });
      }
    }
  });

  window.addEventListener('focus', async () => {
    const cloudData = await pullStoreFromCloud(getActiveStoreId());
    if (cloudData) {
      applyIncomingData(cloudData, { persist: true, refreshView: true, isLiveUpdate: true });
    }
  });

  if (_cloudPollTimer) clearInterval(_cloudPollTimer);
  _cloudPollTimer = setInterval(async () => {
    const cloudData = await pullStoreFromCloud(getActiveStoreId());
    if (!cloudData) return;
    const incomingMenusJson = JSON.stringify(normalizeMenusArray(cloudData.menus || []));
    const currentMenusJson = JSON.stringify(normalizeMenusArray(appState.menus || []));
    const incomingOrdersJson = JSON.stringify(cloudData.orders || []);
    const currentOrdersJson = JSON.stringify(appState.orders || []);
    const incomingName = cloudData.settings?.storeName || '';
    const currentName = appState.settings?.storeName || '';

    if (
      incomingMenusJson !== currentMenusJson ||
      incomingOrdersJson !== currentOrdersJson ||
      incomingName !== currentName
    ) {
      applyIncomingData(cloudData, { persist: true, refreshView: true, isLiveUpdate: true });
    }
  }, 5000);
}

async function initApp() {
  loadUnreadOrderIds();

  const urlParams = new URLSearchParams(window.location.search);
  const queryStoreId = String(urlParams.get('store') || '').trim();
  const queryBlobId = String(urlParams.get('blob') || '').trim();
  const queryRegBlobId = String(urlParams.get('reg') || '').trim();
  const encodedData = String(urlParams.get('d') || '').trim();

  const initialStoreId = queryStoreId ? sanitizeStoreId(queryStoreId) : DEFAULT_STORE_ID;
  appState.settings.storeId = initialStoreId;

  if (queryBlobId) {
    saveBlobId(initialStoreId, queryBlobId);
  }
  if (queryRegBlobId) {
    saveRegistryBlobId(queryRegBlobId);
  }

  let hasLocalSavedState = false;
  try {
    const byStoreRaw = localStorage.getItem(getStoreStorageKey(initialStoreId));
    const savedRaw = byStoreRaw || (!queryStoreId ? localStorage.getItem(STORAGE_KEY) : null);
    if (savedRaw) {
      const parsed = JSON.parse(savedRaw);
      applyIncomingData(parsed, { persist: false, refreshView: false, isLiveUpdate: false });
      hasLocalSavedState = true;
    } else {
      appState.menus = [];
      saveStateToStorage({ broadcast: false, syncCloud: false });
    }
  } catch (e) {
    console.error('Gagal membaca data tersimpan:', e);
    appState.menus = [];
  }

  if (encodedData) {
    try {
      const decodedJson = decodeURIComponent(escape(atob(encodedData)));
      const sharedPayload = JSON.parse(decodedJson);
      if (queryStoreId) {
        sharedPayload.settings = { ...(sharedPayload.settings || {}), storeId: initialStoreId };
      }
      applyIncomingData(sharedPayload, { persist: true, refreshView: false, isLiveUpdate: false });
      hasLocalSavedState = true;
    } catch (err) {
      console.warn('Payload URL tidak valid, memakai data tersimpan.');
    }
  }

  setupCrossTabSync();

  switchToCustomerView();
  initCustomerPage();

  const activeId = getActiveStoreId();
  const cloudData = await pullStoreFromCloud(activeId);
  if (cloudData) {
    applyIncomingData(cloudData, { persist: true, refreshView: true, isLiveUpdate: false });
  } else if (!hasLocalSavedState) {
    await pushStoreToCloud(activeId, appState);
  }
}

function setAdminPasswordVisibility(isVisible) {
  const input = document.getElementById('admin-password-input');
  const eyeOpen = document.getElementById('eye-icon-open');
  const eyeClosed = document.getElementById('eye-icon-closed');
  if (!input) return;

  input.type = isVisible ? 'text' : 'password';
  if (eyeOpen) eyeOpen.classList.toggle('hidden', isVisible);
  if (eyeClosed) eyeClosed.classList.toggle('hidden', !isVisible);
}

function toggleAdminPasswordVisibility() {
  const input = document.getElementById('admin-password-input');
  if (!input) return;
  const nextVisible = input.type === 'password';
  setAdminPasswordVisibility(nextVisible);
  input.focus();
}

function openAdminPasswordModal(action = 'panel') {
  _pendingAdminAction = action;
  const modal = document.getElementById('admin-password-modal');
  const input = document.getElementById('admin-password-input');
  const errEl = document.getElementById('admin-password-error');
  if (!modal || !input) return;

  if (errEl) errEl.classList.add('hidden');
  input.value = '';
  setAdminPasswordVisibility(false);
  modal.classList.remove('hidden');
  modal.classList.add('flex');
  setTimeout(() => input.focus(), 50);
}

function closeAdminPasswordModal() {
  const modal = document.getElementById('admin-password-modal');
  const input = document.getElementById('admin-password-input');
  const errEl = document.getElementById('admin-password-error');
  setAdminPasswordVisibility(false);
  if (modal) {
    modal.classList.add('hidden');
    modal.classList.remove('flex');
  }
  if (input) input.value = '';
  if (errEl) errEl.classList.add('hidden');
}

function submitAdminPassword(event) {
  if (event) event.preventDefault();
  const input = document.getElementById('admin-password-input');
  const errEl = document.getElementById('admin-password-error');
  const entered = input ? input.value : '';

  if (entered !== ADMIN_ACCESS_PASSWORD) {
    if (errEl) errEl.classList.remove('hidden');
    if (input) input.focus();
    return;
  }

  _isAdminAuthenticated = true;
  closeAdminPasswordModal();
  switchToAdminView(_pendingAdminAction);
  showToast('Akses admin berhasil dibuka');
}

function switchToCustomerView() {
  _isAdminAuthenticated = false;
  document.getElementById('customer-view')?.classList.remove('hidden');
  document.getElementById('admin-view')?.classList.add('hidden');
  initCustomerPage();
}

function switchToAdminView(targetAction = 'panel') {
  if (!_isAdminAuthenticated) {
    openAdminPasswordModal(targetAction);
    return;
  }

  document.getElementById('customer-view')?.classList.add('hidden');
  document.getElementById('admin-view')?.classList.remove('hidden');
  initAdminPage();

  if (targetAction === 'add-menu') {
    openAddMenuQuick();
  }
}

function saveStateToStorage({ broadcast = true, syncCloud = true } = {}) {
  appState.menus = normalizeMenusArray(appState.menus);
  const activeId = getActiveStoreId();
  appState.settings.storeId = activeId;
  appState.settings.qrisUrl = normalizeImageUrl(appState.settings.qrisUrl || '');
  const serialized = JSON.stringify(appState);

  try {
    localStorage.setItem(STORAGE_KEY, serialized);
    localStorage.setItem(getStoreStorageKey(activeId), serialized);
  } catch (e) {}

  if (isAdminViewActive() && _isAdminAuthenticated) {
    updateHeaderOrderBadge();
  }

  if (syncCloud) {
    pushStoreToCloud(activeId, appState);
  }

  if (broadcast && _syncChannel) {
    _syncChannel.postMessage({
      type: 'STATE_UPDATED',
      payload: {
        settings: appState.settings,
        menus: appState.menus,
        orders: appState.orders
      }
    });
  }

  const badge = document.getElementById('sync-badge');
  if (badge) {
    badge.textContent = 'Tersimpan ✓';
    setTimeout(() => {
      badge.textContent = 'Tersimpan Permanen';
    }, 1500);
  }
}

function showToast(msg) {
  const toast = document.getElementById('toast');
  if (!toast) return;
  document.getElementById('toast-text').textContent = msg;
  toast.classList.remove('hidden');
  toast.classList.add('flex');
  clearTimeout(window._toastTimer);
  window._toastTimer = setTimeout(() => {
    toast.classList.add('hidden');
    toast.classList.remove('flex');
  }, 2400);
}

function formatRupiah(num) {
  return 'Rp ' + (Number(num) || 0).toLocaleString('id-ID');
}

function getFormattedIndonesianDate() {
  const hariList = ['Minggu', 'Senin', 'Selasa', 'Rabu', 'Kamis', 'Jumat', 'Sabtu'];
  const bulanList = [
    'Januari', 'Februari', 'Maret', 'April', 'Mei', 'Juni',
    'Juli', 'Agustus', 'September', 'Oktober', 'November', 'Desember'
  ];
  const now = new Date();
  return `${hariList[now.getDay()]}, ${now.getDate()} ${bulanList[now.getMonth()]} ${now.getFullYear()}`;
}

function findMenuByIdOrName(id, name) {
  if (id) {
    const byId = appState.menus.find((m) => m.id === id);
    if (byId) return byId;
  }
  if (name) {
    const byName = appState.menus.find((m) => m.name.toLowerCase() === String(name).toLowerCase());
    if (byName) return byName;
  }
  return null;
}

function getMenuVariantsList(item) {
  const normalized = normalizeMenuItem(item);
  if (!normalized) return [];
  const list = [];
  if (normalized.variant1 && Array.isArray(normalized.variant1.options) && normalized.variant1.options.length) {
    list.push(normalized.variant1);
  }
  if (normalized.variant2 && Array.isArray(normalized.variant2.options) && normalized.variant2.options.length) {
    list.push(normalized.variant2);
  }
  return list;
}

/* =========================================================================
   HALAMAN ADMIN
   ========================================================================= */
function syncAdminInputsFromState() {
  const activeId = getActiveStoreId();
  document.getElementById('header-store-id').textContent = activeId;
  document.getElementById('set-store-name').value = appState.settings.storeName;
  document.getElementById('set-store-id').value = activeId;
  document.getElementById('set-wa-number').value = appState.settings.whatsapp || '087877611218';
  document.getElementById('set-payment-info').value = appState.settings.paymentInfo || '';
  document.getElementById('set-qris-url').value = appState.settings.qrisUrl || '';
}

function updateHeaderOrderBadge() {
  const badge = document.getElementById('header-order-badge');
  const bell = document.getElementById('header-order-bell');
  const btnOrders = document.getElementById('btn-nav-orders');

  if (badge) {
    badge.textContent = appState.orders.length;
  }

  const hasUnread = unreadOrderIds.length > 0;
  if (bell) {
    bell.classList.toggle('hidden', !hasUnread);
  }
  if (btnOrders) {
    btnOrders.classList.toggle('ring-2', hasUnread);
    btnOrders.classList.toggle('ring-amber-400', hasUnread);
  }
}

function initAdminPage() {
  syncUnreadOrdersWithCurrentOrders([], { markNewlyArrivedAsUnread: false });
  syncAdminInputsFromState();
  updateHeaderOrderBadge();
  switchAdminPageTab(activeAdminPageTab);
  renderAdminMenuList();
  renderAdminOrdersList();
  generateAdminQRCode({ syncCloud: false });
}

function switchAdminPageTab(tabName) {
  activeAdminPageTab = tabName === 'orders' ? 'orders' : 'menu';

  const panel = document.getElementById('admin-settings-panel');
  const mainEl = document.getElementById('admin-main-content');
  if (panel) panel.classList.add('hidden');
  if (mainEl) mainEl.classList.remove('hidden');

  const menuSection = document.getElementById('admin-page-menu');
  const ordersSection = document.getElementById('admin-page-orders');
  const btnMenu = document.getElementById('btn-nav-menu');
  const btnOrders = document.getElementById('btn-nav-orders');

  if (activeAdminPageTab === 'menu') {
    menuSection?.classList.remove('hidden');
    ordersSection?.classList.add('hidden');

    btnMenu?.classList.remove('bg-gray-800', 'hover:bg-gray-700', 'text-amber-300', 'border-gray-700', 'font-semibold');
    btnMenu?.classList.add('bg-amber-500', 'text-gray-950', 'border-amber-400', 'font-bold');

    btnOrders?.classList.remove('bg-amber-500', 'text-gray-950', 'border-amber-400', 'font-bold');
    btnOrders?.classList.add('bg-gray-800', 'hover:bg-gray-700', 'text-amber-300', 'border-gray-700', 'font-semibold');

    renderAdminMenuList();
  } else {
    ordersSection?.classList.remove('hidden');
    menuSection?.classList.add('hidden');

    btnOrders?.classList.remove('bg-gray-800', 'hover:bg-gray-700', 'text-amber-300', 'border-gray-700', 'font-semibold');
    btnOrders?.classList.add('bg-amber-500', 'text-gray-950', 'border-amber-400', 'font-bold');

    btnMenu?.classList.remove('bg-amber-500', 'text-gray-950', 'border-amber-400', 'font-bold');
    btnMenu?.classList.add('bg-gray-800', 'hover:bg-gray-700', 'text-amber-300', 'border-gray-700', 'font-semibold');

    markOrdersAsRead();
    renderAdminOrdersList();
  }

  window.scrollTo({ top: 0, behavior: 'smooth' });
}

function toggleAdminDrawer() {
  const panel = document.getElementById('admin-settings-panel');
  const mainEl = document.getElementById('admin-main-content');
  if (!panel) return;
  const willOpen = panel.classList.contains('hidden');
  if (willOpen) {
    panel.classList.remove('hidden');
    if (mainEl) mainEl.classList.add('hidden');
    syncAdminInputsFromState();
    generateAdminQRCode({ syncCloud: true });
  } else {
    panel.classList.add('hidden');
    if (mainEl) mainEl.classList.remove('hidden');
    if (activeAdminPageTab === 'orders') {
      markOrdersAsRead();
    }
  }
}

function switchAdminSection(num) {
  document.querySelectorAll('.admin-section').forEach((el) => el.classList.add('hidden'));
  document.getElementById('sec-' + num).classList.remove('hidden');

  document.querySelectorAll('.admin-tab-btn').forEach((btn) => {
    btn.classList.remove('bg-amber-500', 'text-gray-950', 'border-amber-400');
    btn.classList.add('bg-gray-800', 'text-gray-300', 'border-gray-700');
  });

  const activeBtn = document.getElementById('tab-sec-' + num);
  activeBtn.classList.remove('bg-gray-800', 'text-gray-300', 'border-gray-700');
  activeBtn.classList.add('bg-amber-500', 'text-gray-950', 'border-amber-400');

  if (num === 1) syncAdminInputsFromState();
  if (num === 2) updateMenuPhotoPreview();
  if (num === 3) generateAdminQRCode({ syncCloud: true });
}

function openAddMenuQuick() {
  const mainEl = document.getElementById('admin-main-content');
  if (mainEl) mainEl.classList.add('hidden');
  document.getElementById('admin-settings-panel').classList.remove('hidden');
  resetMenuForm();
  switchAdminSection(2);
}

function saveStoreSettings() {
  const prevId = getActiveStoreId();
  const nextId = sanitizeStoreId(document.getElementById('set-store-id').value);

  appState.settings.storeName = document.getElementById('set-store-name').value.trim() || 'Kedai Kuliner UMKM';
  appState.settings.storeId = nextId;
  appState.settings.whatsapp = document.getElementById('set-wa-number').value.trim() || '087877611218';
  appState.settings.paymentInfo = document.getElementById('set-payment-info').value.trim();
  appState.settings.qrisUrl = normalizeImageUrl(document.getElementById('set-qris-url').value.trim());

  if (prevId !== nextId && !appState.settings.cloudBlobId) {
    const prevBlob = getSavedBlobId(prevId);
    if (prevBlob) {
      saveBlobId(nextId, prevBlob);
    }
  }

  syncAdminInputsFromState();
  saveStateToStorage({ broadcast: true, syncCloud: true });
  generateAdminQRCode({ syncCloud: false });
  showToast(`Pengaturan & ID Toko (${nextId}) berhasil disimpan!`);
}

function enableVariantInput() {
  const wrapper = document.getElementById('variant-fields-wrapper');
  const btn = document.getElementById('btn-add-variant');
  if (wrapper) wrapper.classList.remove('hidden');
  if (btn) btn.classList.add('hidden');
  const v1Input = document.getElementById('var1-label');
  if (v1Input) v1Input.focus();
  renderVariantPreview();
}

function setVariantSectionVisible(show) {
  const wrapper = document.getElementById('variant-fields-wrapper');
  const btn = document.getElementById('btn-add-variant');
  if (!wrapper || !btn) return;
  if (show) {
    wrapper.classList.remove('hidden');
    btn.classList.add('hidden');
  } else {
    wrapper.classList.add('hidden');
    btn.classList.remove('hidden');
  }
}

function renderVariantPreview() {
  const v1Label = document.getElementById('var1-label').value.trim();
  const v1Opts = parseVariantList(document.getElementById('var1-options').value);
  const v2Label = document.getElementById('var2-label').value.trim();
  const v2Opts = parseVariantList(document.getElementById('var2-options').value);

  const box = document.getElementById('variant-preview-box');
  if (!v1Label && !v1Opts.length && !v2Label && !v2Opts.length) {
    box.innerHTML = '<span class="text-xs text-gray-400 italic">Belum ada varian diisi.</span>';
    return;
  }

  let html = '<div class="space-y-2.5 not-italic">';
  if (v1Label || v1Opts.length) {
    const label1 = v1Label || 'Varian 1';
    const opts1 = v1Opts.length ? v1Opts : ['Contoh Pilihan'];
    html += `<div><p class="text-xs font-bold text-gray-200 mb-1">${label1}:</p><div class="flex flex-wrap gap-1.5">`;
    opts1.forEach((opt, idx) => {
      html += `<span class="px-2.5 py-1 rounded-lg text-xs font-semibold ${idx === 0 ? 'bg-amber-500 text-gray-950' : 'bg-gray-800 text-gray-300 border border-gray-700'}">${opt}</span>`;
    });
    html += '</div></div>';
  }
  if (v2Label || v2Opts.length) {
    const label2 = v2Label || 'Varian 2';
    const opts2 = v2Opts.length ? v2Opts : ['Contoh Pilihan'];
    html += `<div><p class="text-xs font-bold text-gray-200 mb-1">${label2}:</p><div class="flex flex-wrap gap-1.5">`;
    opts2.forEach((opt, idx) => {
      html += `<span class="px-2.5 py-1 rounded-lg text-xs font-semibold ${idx === 0 ? 'bg-amber-500 text-gray-950' : 'bg-gray-800 text-gray-300 border border-gray-700'}">${opt}</span>`;
    });
    html += '</div></div>';
  }
  html += '</div>';
  box.innerHTML = html;
}

function saveMenuItem() {
  const editId = document.getElementById('menu-edit-id').value;
  const name = document.getElementById('menu-name').value.trim();
  const category = document.getElementById('menu-category').value;
  const price = parseInt(document.getElementById('menu-price').value, 10);
  const photo = normalizeImageUrl(document.getElementById('menu-photo').value.trim());

  if (!name || isNaN(price) || price < 0) {
    alert('Harap isi Nama Menu dan Harga dengan benar.');
    return;
  }

  const v1Label = document.getElementById('var1-label').value.trim();
  const v1Opts = parseVariantList(document.getElementById('var1-options').value);
  const v2Label = document.getElementById('var2-label').value.trim();
  const v2Opts = parseVariantList(document.getElementById('var2-options').value);

  const menuPayload = normalizeMenuItem({
    id: editId || ('MENU-' + Date.now()),
    name,
    category,
    price,
    photo,
    variant1: normalizeVariantObject(null, v1Label, v1Opts),
    variant2: normalizeVariantObject(null, v2Label, v2Opts)
  });

  if (editId) {
    const idx = appState.menus.findIndex((m) => m.id === editId);
    if (idx !== -1) appState.menus[idx] = menuPayload;
    showToast('Menu & varian berhasil diperbarui dan disinkronkan!');
  } else {
    appState.menus.push(menuPayload);
    showToast('Menu baru & varian berhasil ditambahkan dan disinkronkan!');
  }

  saveStateToStorage({ broadcast: true, syncCloud: true });
  resetMenuForm();
  renderAdminMenuList();
  renderAdminOrdersList();
  generateAdminQRCode({ syncCloud: false });
}

function editMenuItem(id) {
  const item = appState.menus.find((m) => m.id === id);
  if (!item) return;

  const normalized = normalizeMenuItem(item);
  const mainEl = document.getElementById('admin-main-content');
  if (mainEl) mainEl.classList.add('hidden');
  document.getElementById('admin-settings-panel').classList.remove('hidden');
  switchAdminSection(2);

  document.getElementById('menu-form-title').textContent = 'Bagian 2 - Edit Data Menu';
  document.getElementById('save-menu-btn').textContent = 'Simpan Perubahan Menu';
  document.getElementById('cancel-edit-btn').classList.remove('hidden');

  document.getElementById('menu-edit-id').value = normalized.id;
  document.getElementById('menu-name').value = normalized.name;

  const catSelect = document.getElementById('menu-category');
  if (catSelect) {
    const hasOpt = Array.from(catSelect.options).some((o) => o.value === normalized.category);
    if (!hasOpt && normalized.category) {
      const customOpt = document.createElement('option');
      customOpt.value = normalized.category;
      customOpt.textContent = normalized.category;
      catSelect.appendChild(customOpt);
    }
    catSelect.value = normalized.category;
  }

  document.getElementById('menu-price').value = normalized.price;
  document.getElementById('menu-photo').value = normalized.photo || '';
  updateMenuPhotoPreview();

  document.getElementById('var1-label').value = normalized.variant1 ? normalized.variant1.label : '';
  document.getElementById('var1-options').value = normalized.variant1 ? normalized.variant1.options.join(', ') : '';
  document.getElementById('var2-label').value = normalized.variant2 ? normalized.variant2.label : '';
  document.getElementById('var2-options').value = normalized.variant2 ? normalized.variant2.options.join(', ') : '';

  setVariantSectionVisible(Boolean(normalized.variant1 || normalized.variant2));
  renderVariantPreview();
}

function deleteMenuItem(id) {
  if (!confirm('Hapus menu ini dari daftar?')) return;
  appState.menus = appState.menus.filter((m) => m.id !== id);
  saveStateToStorage({ broadcast: true, syncCloud: true });
  renderAdminMenuList();
  generateAdminQRCode({ syncCloud: false });
  showToast('Menu dihapus');
}

function resetMenuForm() {
  document.getElementById('menu-form-title').textContent = 'Bagian 2 - Kelola Menu (Tambah Menu Baru)';
  document.getElementById('save-menu-btn').textContent = 'Simpan Menu Baru';
  document.getElementById('cancel-edit-btn').classList.add('hidden');
  document.getElementById('menu-edit-id').value = '';
  document.getElementById('menu-name').value = '';
  document.getElementById('menu-category').value = 'Kopi';
  document.getElementById('menu-price').value = '';
  document.getElementById('menu-photo').value = '';
  const statusEl = document.getElementById('sigmawire-upload-status');
  if (statusEl) {
    statusEl.textContent = 'Pilih foto untuk diunggah ke Sigmawire atau tempel link hasil konversi di kolom URL Foto Produk.';
  }
  updateMenuPhotoPreview();
  document.getElementById('var1-label').value = '';
  document.getElementById('var1-options').value = '';
  document.getElementById('var2-label').value = '';
  document.getElementById('var2-options').value = '';
  setVariantSectionVisible(false);
  renderVariantPreview();
}

function renderAdminMenuList() {
  const container = document.getElementById('admin-menu-list');
  const searchEl = document.getElementById('admin-search-input');
  const keyword = searchEl ? searchEl.value.trim().toLowerCase() : '';
  const filtered = appState.menus.filter((m) =>
    m.name.toLowerCase().includes(keyword) || m.category.toLowerCase().includes(keyword)
  );

  document.getElementById('admin-menu-count').textContent = filtered.length;

  if (filtered.length === 0) {
    container.innerHTML = `
      <div class="p-8 rounded-2xl border border-dashed border-gray-800 text-center text-gray-500 text-sm">
        ${appState.menus.length === 0
          ? 'Belum ada menu dibuat. Klik tombol garis 3 (Menu Pengaturan) > Bagian 2 - Kelola Menu untuk menambah menu.'
          : 'Menu tidak ditemukan.'}
      </div>
    `;
    return;
  }

  container.innerHTML = filtered.map((rawItem) => {
    const item = normalizeMenuItem(rawItem);
    const variants = getMenuVariantsList(item);
    const varBadges = variants.map((v) =>
      `<span class="inline-block mt-1 mr-1.5 px-2 py-0.5 rounded-md bg-amber-500/10 text-amber-300 border border-amber-500/20 text-[11px] font-medium">${v.label}: ${v.options.join(', ')}</span>`
    ).join('');

    return `
      <div class="p-4 rounded-2xl bg-gray-900 border border-gray-800 flex flex-col sm:flex-row sm:items-center justify-between gap-3 hover:border-gray-700 transition">
        <div class="flex items-center gap-3.5 min-w-0">
          <img src="${item.photo || getMenuPhotoFallback(item.name)}" onerror="this.onerror=null;this.src='${getMenuPhotoFallback(item.name)}'" alt="${item.name}" class="w-14 h-14 rounded-xl object-cover bg-gray-800 shrink-0">
          <div class="min-w-0">
            <h3 class="font-bold text-white text-sm sm:text-base break-words">${item.name}</h3>
            <p class="text-xs sm:text-sm text-gray-400 mt-0.5">
              <span class="text-amber-400 font-medium">${item.category}</span> - <span class="text-gray-200 font-semibold">${formatRupiah(item.price)}</span>
            </p>
            ${varBadges ? `<div class="flex flex-wrap">${varBadges}</div>` : ''}
          </div>
        </div>
        <div class="flex items-center gap-2 shrink-0 justify-end">
          <button type="button" onclick="editMenuItem('${item.id}')" class="px-3.5 py-2 rounded-xl bg-blue-600/20 hover:bg-blue-600/30 text-blue-400 border border-blue-500/30 text-xs font-bold transition">
            Edit
          </button>
          <button type="button" onclick="deleteMenuItem('${item.id}')" class="px-3.5 py-2 rounded-xl bg-rose-600/20 hover:bg-rose-600/30 text-rose-400 border border-rose-500/30 text-xs font-bold transition">
            Hapus
          </button>
        </div>
      </div>
    `;
  }).join('');
}

function openAdminProofModal(orderId) {
  const ord = appState.orders.find((o) => String(o.id) === String(orderId));
  if (!ord || !ord.proofUrl) return;
  const modal = document.getElementById('admin-proof-modal');
  const titleEl = document.getElementById('admin-proof-title');
  const subEl = document.getElementById('admin-proof-subtitle');
  const imgEl = document.getElementById('admin-proof-modal-img');
  const dlEl = document.getElementById('admin-proof-download-link');
  if (!modal || !imgEl) return;

  if (titleEl) titleEl.textContent = `Bukti Transfer - ${ord.customerName || 'Pembeli'}`;
  if (subEl) subEl.textContent = `${ord.paymentMethod || 'QRIS / Transfer'} • ${ord.timestamp || ''}`;
  imgEl.src = ord.proofUrl;
  if (dlEl) {
    dlEl.href = ord.proofUrl;
    dlEl.download = ord.proofName || `Bukti-${ord.customerName || 'Pembeli'}.png`;
  }
  modal.classList.remove('hidden');
  modal.classList.add('flex');
}

function closeAdminProofModal() {
  const modal = document.getElementById('admin-proof-modal');
  const imgEl = document.getElementById('admin-proof-modal-img');
  if (modal) {
    modal.classList.add('hidden');
    modal.classList.remove('flex');
  }
  if (imgEl) imgEl.src = '';
}

function matchesOrderSearch(ord, keyword) {
  if (!keyword) return true;
  const itemsText = (ord.items || [])
    .map((i) => `${i.name || ''} ${i.variantText || ''} ${i.note || ''}`)
    .join(' ');
  const haystack = [
    ord.customerName || '',
    ord.orderType || '',
    ord.locationDetail || '',
    ord.paymentMethod || '',
    ord.timestamp || '',
    itemsText
  ].join(' ').toLowerCase();
  return haystack.includes(keyword);
}

function renderAdminOrdersList() {
  const container = document.getElementById('admin-orders-list');
  const countEl = document.getElementById('admin-order-count');
  const clearBtn = document.getElementById('clear-orders-btn');
  const searchEl = document.getElementById('admin-order-search-input');
  const keyword = searchEl ? searchEl.value.trim().toLowerCase() : '';

  updateHeaderOrderBadge();

  if (appState.orders.length === 0) {
    clearBtn.classList.add('hidden');
    countEl.textContent = 0;
    container.innerHTML = '<div class="p-8 rounded-2xl border border-dashed border-gray-800 text-center text-xs text-gray-500 italic">Belum ada pesanan masuk dari halaman Pembeli.</div>';
    return;
  }

  clearBtn.classList.remove('hidden');
  const filteredOrders = appState.orders
    .slice()
    .reverse()
    .filter((ord) => matchesOrderSearch(ord, keyword));

  countEl.textContent = filteredOrders.length;

  if (filteredOrders.length === 0) {
    container.innerHTML = '<div class="p-8 rounded-2xl border border-dashed border-gray-800 text-center text-xs text-gray-500 italic">Pesanan yang cocok dengan pencarian tidak ditemukan.</div>';
    return;
  }

  container.innerHTML = filteredOrders.map((ord) => {
    const itemsHtml = (ord.items || []).map((i) => {
      const matchedMenu = findMenuByIdOrName(i.id, i.name);
      const thumb = normalizeImageUrl(i.photo || (matchedMenu && matchedMenu.photo) || '') || getMenuPhotoFallback(i.name);
      return `
        <div class="flex items-center gap-3 p-2.5 rounded-xl bg-gray-900/90 border border-gray-800/80">
          <img src="${thumb}" onerror="this.onerror=null;this.src='${getMenuPhotoFallback(i.name)}'" alt="${i.name}" class="w-11 h-11 rounded-lg object-cover bg-gray-800 shrink-0">
          <div class="min-w-0 flex-1">
            <div class="text-xs font-bold text-gray-100 truncate">${i.qty}x ${i.name}</div>
            ${i.variantText ? `<div class="text-[11px] text-amber-400 truncate">${i.variantText}</div>` : ''}
            ${i.note ? `<div class="text-[11px] text-sky-300 truncate">Catatan: ${i.note}</div>` : ''}
          </div>
          <div class="text-xs font-bold text-gray-200 shrink-0">${formatRupiah(i.price * i.qty)}</div>
        </div>
      `;
    }).join('');

    const proofBlockHtml = ord.proofUrl
      ? `
        <div class="mt-2.5 p-3 rounded-2xl bg-emerald-950/25 border border-emerald-500/30 flex flex-col sm:flex-row sm:items-center justify-between gap-3">
          <div class="flex items-center gap-3 min-w-0">
            <img src="${ord.proofUrl}" onclick="openAdminProofModal('${ord.id}')" alt="Bukti Pembayaran ${ord.customerName}" title="Klik untuk memperbesar" class="w-20 h-20 rounded-xl object-cover border border-emerald-400/40 bg-gray-950 cursor-pointer hover:opacity-90 transition shrink-0">
            <div class="min-w-0">
              <div class="text-xs font-extrabold text-emerald-300">Bukti Pembayaran Terlampir</div>
              <div class="text-[11px] text-gray-300 truncate">${ord.proofName || 'bukti-transfer.png'}</div>
              <div class="text-[11px] text-gray-400 mt-0.5">Klik gambar atau tombol untuk memperbesar</div>
            </div>
          </div>
          <button type="button" onclick="openAdminProofModal('${ord.id}')" class="px-3.5 py-2 rounded-xl bg-emerald-600/20 hover:bg-emerald-600/30 text-emerald-300 border border-emerald-500/30 text-xs font-bold shrink-0 self-start sm:self-center transition">
            🔍 Lihat Bukti Bayar
          </button>
        </div>
      `
      : '';

    return `
      <div class="p-4 rounded-2xl bg-gray-900 border border-gray-800 space-y-3 text-xs sm:text-sm">
        <div class="flex flex-wrap items-center justify-between gap-2">
          <div class="flex items-center gap-2 min-w-0">
            <span class="font-bold text-white truncate">${ord.customerName}</span>
            <span class="px-2.5 py-0.5 rounded-md bg-amber-500/15 text-amber-400 text-xs font-semibold shrink-0">${ord.orderType}</span>
          </div>
          <div class="flex items-center gap-2.5 shrink-0">
            <span class="text-xs text-gray-400">${ord.timestamp}</span>
            <button type="button" onclick="deleteSingleOrder('${ord.id}')" class="px-2.5 py-1 rounded-lg bg-rose-600/20 hover:bg-rose-600/30 text-rose-400 border border-rose-500/30 text-xs font-bold transition">
              Hapus
            </button>
          </div>
        </div>
        <p class="text-xs text-gray-400 leading-relaxed">Detail: <span class="text-gray-200">${ord.locationDetail}</span> • Metode: <strong class="text-gray-200">${ord.paymentMethod}</strong></p>
        <div class="p-2.5 rounded-xl bg-gray-950 text-xs text-gray-300 space-y-2">
          ${itemsHtml}
        </div>
        ${proofBlockHtml}
        <div class="flex items-center justify-between pt-2 border-t border-gray-800/80">
          <span class="font-extrabold text-amber-400 text-sm">Total: ${formatRupiah(ord.total)}</span>
          <span class="text-xs text-gray-400">${ord.proofUrl ? 'Bukti tampil di atas' : 'Status: Terkirim ke WA'}</span>
        </div>
      </div>
    `;
  }).join('');
}

function deleteSingleOrder(orderId) {
  if (!confirm('Hapus riwayat pesanan ini?')) return;
  appState.orders = appState.orders.filter((o) => o.id !== orderId);
  unreadOrderIds = unreadOrderIds.filter((id) => String(id) !== String(orderId));
  saveUnreadOrderIds();
  saveStateToStorage({ broadcast: true, syncCloud: true });
  renderAdminOrdersList();
  showToast('Riwayat pesanan dihapus');
}

function clearAllOrders() {
  if (!confirm('Hapus semua riwayat pesanan di panel admin?')) return;
  appState.orders = [];
  markOrdersAsRead();
  saveStateToStorage({ broadcast: true, syncCloud: true });
  renderAdminOrdersList();
  showToast('Semua riwayat pesanan dibersihkan');
}

function buildCustomerShareUrl() {
  const storeId = getActiveStoreId();
  const isHttp = /^https?:$/i.test(window.location.protocol);
  const baseFolder = window.location.pathname.substring(0, window.location.pathname.lastIndexOf('/') + 1);
  const rootUrl = isHttp ? `${window.location.origin}${baseFolder}` : 'https://aplikasi-dompet-usaha-umkm.vercel.app/';
  const blobId = getSavedBlobId(storeId);
  const regBlobId = getRegistryBlobId();

  const query = new URLSearchParams({ store: storeId });
  if (blobId) query.set('blob', blobId);
  if (regBlobId) query.set('reg', regBlobId);

  return `${rootUrl}?${query.toString()}`;
}

function generateAdminQRCode({ syncCloud = true } = {}) {
  const qrContainer = document.getElementById('admin-qrcode-container');
  const urlDisplay = document.getElementById('qr-target-url-display');
  const storeId = getActiveStoreId();
  const targetUrl = buildCustomerShareUrl();

  if (urlDisplay) {
    urlDisplay.textContent = targetUrl;
  }

  if (qrContainer && typeof QRCode !== 'undefined') {
    qrContainer.innerHTML = '';
    new QRCode(qrContainer, {
      text: targetUrl,
      width: 220,
      height: 220,
      colorDark: '#000000',
      colorLight: '#ffffff',
      correctLevel: QRCode.CorrectLevel.M
    });
  }

  if (syncCloud) {
    pushStoreToCloud(storeId, appState);
  }
}

function downloadQRCodeCard() {
  const qrCanvas = document.querySelector('#admin-qrcode-container canvas');
  const qrImg = document.querySelector('#admin-qrcode-container img');
  const qrSource = qrCanvas || qrImg;
  if (!qrSource) {
    alert('QR Code belum siap, silakan coba lagi.');
    return;
  }

  const storeId = getActiveStoreId();
  const card = document.createElement('canvas');
  card.width = 600;
  card.height = 760;
  const ctx = card.getContext('2d');

  ctx.fillStyle = '#ffffff';
  ctx.fillRect(0, 0, card.width, card.height);

  ctx.fillStyle = '#111827';
  ctx.fillRect(0, 0, card.width, 130);

  ctx.fillStyle = '#fbbf24';
  ctx.font = 'bold 30px sans-serif';
  ctx.textAlign = 'center';
  ctx.fillText(appState.settings.storeName.toUpperCase(), card.width / 2, 62);

  ctx.fillStyle = '#e5e7eb';
  ctx.font = '18px sans-serif';
  ctx.fillText('SCAN MENU DIGITAL & PESAN LANGSUNG', card.width / 2, 98);

  ctx.drawImage(qrSource, 125, 175, 350, 350);

  ctx.fillStyle = '#111827';
  ctx.font = 'bold 24px sans-serif';
  ctx.fillText('Pindai dengan Google Lens / Kamera HP', card.width / 2, 585);

  ctx.fillStyle = '#4b5563';
  ctx.font = '18px sans-serif';
  ctx.fillText('ID Toko: ' + storeId, card.width / 2, 625);
  ctx.fillText('Menu selalu update otomatis tanpa ganti barcode', card.width / 2, 660);

  const link = document.createElement('a');
  link.download = `Barcode-Menu-${storeId}.png`;
  link.href = card.toDataURL('image/png');
  link.click();
  showToast('Kartu Barcode berhasil diunduh!');
}

function copyCustomerLink() {
  const url = buildCustomerShareUrl();
  navigator.clipboard.writeText(url).then(() => {
    showToast('Link Halaman Pembeli berhasil disalin!');
  });
}

function exportAllData() {
  const box = document.getElementById('export-import-box');
  box.value = JSON.stringify(appState, null, 2);
  showToast('Data berhasil diekspor ke kotak teks!');
}

function copyExportedData() {
  const box = document.getElementById('export-import-box');
  if (!box.value.trim()) exportAllData();
  navigator.clipboard.writeText(box.value).then(() => {
    showToast('Teks data cadangan disalin!');
  });
}

function importAllData() {
  const raw = document.getElementById('export-import-box').value.trim();
  if (!raw) {
    alert('Silakan tempel kode data hasil ekspor terlebih dahulu.');
    return;
  }
  try {
    const parsed = JSON.parse(raw);
    if (!parsed.settings || !Array.isArray(parsed.menus)) {
      throw new Error('Format tidak sesuai');
    }
    applyIncomingData(parsed, { persist: true, refreshView: true, isLiveUpdate: false });
    saveStateToStorage({ broadcast: true, syncCloud: true });
    showToast('Semua data berhasil diimpor dan dimuat ulang!');
  } catch (e) {
    alert('Gagal mengimpor data. Pastikan kode JSON valid.');
  }
}

/* =========================================================================
   HALAMAN PEMBELI
   ========================================================================= */
function renderCustomerCategoryOptions() {
  const categories = getAvailableAdminCategories();
  const dropdown = document.getElementById('cust-cat-dropdown');
  const pillsContainer = document.getElementById('cust-category-pills');

  const validSet = new Set(['Semua', ...categories]);
  if (!validSet.has(currentCategory)) {
    currentCategory = 'Semua';
  }

  const labelEl = document.getElementById('cust-selected-cat-label');
  if (labelEl) {
    labelEl.textContent = currentCategory === 'Semua' ? 'Kategori: Semua' : currentCategory;
  }

  if (dropdown) {
    const allCount = appState.menus.length;
    const allItemHtml = `
      <button type="button" data-cat="Semua" onclick="selectCustomerCategory('Semua')" class="cat-option-item w-full px-4 py-2.5 text-left text-xs sm:text-sm flex items-center justify-between transition">
        <span>Semua Kategori</span>
        <span id="cat-count-Semua" class="text-xs opacity-90 font-bold">${allCount}</span>
      </button>
    `;

    const catItemsHtml = categories.map((cat) => {
      const count = appState.menus.filter((m) => m.category === cat).length;
      const safeAttrCat = escapeHtmlAttr(cat);
      const safeJsCat = escapeJsArg(cat);
      return `
        <button type="button" data-cat="${safeAttrCat}" onclick="selectCustomerCategory('${safeJsCat}')" class="cat-option-item w-full px-4 py-2.5 text-left text-xs sm:text-sm flex items-center justify-between transition">
          <span class="truncate pr-2">${escapeHtmlAttr(cat)}</span>
          <span class="cat-item-count text-xs opacity-75 font-bold shrink-0">${count}</span>
        </button>
      `;
    }).join('');

    dropdown.innerHTML = allItemHtml + catItemsHtml;
  }

  if (pillsContainer) {
    const allPillHtml = `
      <button type="button" data-pill="Semua" onclick="selectCustomerCategory('Semua')" class="cat-pill px-3.5 py-1.5 rounded-full text-xs font-bold shrink-0 transition">Semua</button>
    `;
    const catPillsHtml = categories.map((cat) => {
      const safeAttrCat = escapeHtmlAttr(cat);
      const safeJsCat = escapeJsArg(cat);
      return `
        <button type="button" data-pill="${safeAttrCat}" onclick="selectCustomerCategory('${safeJsCat}')" class="cat-pill px-3.5 py-1.5 rounded-full text-xs font-bold shrink-0 transition">${escapeHtmlAttr(cat)}</button>
      `;
    }).join('');

    pillsContainer.innerHTML = allPillHtml + catPillsHtml;
  }
}

function initCustomerPage() {
  document.getElementById('cust-store-name').textContent = appState.settings.storeName || 'Toko Kuliner';
  document.getElementById('cust-current-date').textContent = getFormattedIndonesianDate();
  renderCustomerCategoryOptions();
  updateCategoryCounts();
  updateCategoryVisualActive(currentCategory);
  renderCustomerMenuGrid();
  updateCartBadge();
}

function toggleCategoryDropdown() {
  const dropdown = document.getElementById('cust-cat-dropdown');
  if (!dropdown) return;
  const willOpen = dropdown.classList.contains('hidden');
  if (willOpen) {
    renderCustomerCategoryOptions();
    updateCategoryVisualActive(currentCategory);
    dropdown.classList.remove('hidden');
  } else {
    dropdown.classList.add('hidden');
  }
}

function updateCategoryCounts() {
  const categories = getAvailableAdminCategories();
  const allEl = document.getElementById('cat-count-Semua');
  if (allEl) allEl.textContent = appState.menus.length;

  document.querySelectorAll('.cat-option-item').forEach((btn) => {
    const cat = btn.dataset.cat;
    if (!cat || cat === 'Semua') return;
    const countSpan = btn.querySelector('.cat-item-count');
    if (countSpan) {
      countSpan.textContent = appState.menus.filter((m) => m.category === cat).length;
    }
  });

  categories.forEach((c) => {
    const el = document.getElementById('cat-count-' + c);
    if (el) el.textContent = appState.menus.filter((m) => m.category === c).length;
  });

  const heroTotal = document.getElementById('hero-menu-total');
  if (heroTotal) heroTotal.textContent = `${appState.menus.length} Item`;
}

function updateCategoryVisualActive(cat) {
  document.querySelectorAll('.cat-option-item').forEach((btn) => {
    if (btn.dataset.cat === cat) {
      btn.classList.add('bg-blue-600', 'text-white', 'font-semibold');
      btn.classList.remove('hover:bg-gray-100');
    } else {
      btn.classList.remove('bg-blue-600', 'text-white', 'font-semibold');
      btn.classList.add('hover:bg-gray-100');
    }
  });

  document.querySelectorAll('.cat-pill').forEach((pill) => {
    if (pill.dataset.pill === cat) {
      pill.className = 'cat-pill px-3.5 py-1.5 rounded-full text-xs font-bold shrink-0 transition bg-amber-500 text-gray-950 shadow-md shadow-amber-500/20';
    } else {
      pill.className = 'cat-pill px-3.5 py-1.5 rounded-full text-xs font-bold shrink-0 transition bg-gray-950/80 text-gray-300 border border-white/10 hover:border-amber-400/40';
    }
  });
}

function selectCustomerCategory(cat) {
  currentCategory = cat || 'Semua';
  document.getElementById('cust-selected-cat-label').textContent = currentCategory === 'Semua' ? 'Kategori: Semua' : currentCategory;
  document.getElementById('cust-cat-dropdown').classList.add('hidden');
  updateCategoryVisualActive(currentCategory);
  renderCustomerMenuGrid();
}

function renderCustomerMenuGrid() {
  const grid = document.getElementById('cust-menu-grid');
  const items = currentCategory === 'Semua'
    ? appState.menus
    : appState.menus.filter((m) => m.category === currentCategory);

  if (items.length === 0) {
    grid.innerHTML = `
      <div class="col-span-full py-16 text-center rounded-3xl bg-gray-900/60 border border-gray-800 px-4">
        <p class="text-gray-300 font-bold text-base">Belum ada produk menu di kategori ini</p>
        <p class="text-gray-500 text-xs mt-1">Silakan pilih kategori lain atau hubungi kasir/admin toko.</p>
      </div>
    `;
    return;
  }

  grid.innerHTML = items.map((rawItem) => {
    const item = normalizeMenuItem(rawItem);
    const variants = getMenuVariantsList(item);
    const hasVar = variants.length > 0;
    const imgSrc = item.photo || getMenuPhotoFallback(item.name);
    return `
      <div onclick="openProductModal('${item.id}')" class="group cursor-pointer rounded-2xl bg-gray-900/90 border border-white/10 hover:border-amber-400/60 overflow-hidden shadow-xl flex flex-col transition duration-200 transform hover:-translate-y-1">
        <div class="relative aspect-[4/3] bg-gray-800 overflow-hidden">
          <img src="${imgSrc}" onerror="this.onerror=null;this.src='${getMenuPhotoFallback(item.name)}'" alt="${item.name}" class="w-full h-full object-cover group-hover:scale-105 transition duration-300">
          <div class="absolute inset-0 bg-gradient-to-t from-gray-950/75 via-transparent to-transparent"></div>
          <span class="absolute top-2 left-2 px-2.5 py-0.5 rounded-full bg-gray-950/85 backdrop-blur text-[10px] font-bold text-amber-300 border border-white/10">${item.category}</span>
          ${hasVar ? '<span class="absolute bottom-2 left-2 px-2 py-0.5 rounded-md bg-amber-500/20 backdrop-blur text-[10px] font-bold text-amber-300 border border-amber-400/30">Ada Varian</span>' : ''}
        </div>
        <div class="p-3.5 flex-1 flex flex-col justify-between gap-2.5">
          <h3 class="font-bold text-white text-sm sm:text-base leading-snug line-clamp-2 group-hover:text-amber-300 transition">${item.name}</h3>
          <div class="flex items-center justify-between pt-1.5 border-t border-white/5">
            <span class="font-extrabold text-amber-400 text-sm sm:text-base">${formatRupiah(item.price)}</span>
            <span class="px-3 py-1 rounded-xl bg-amber-500 group-hover:bg-amber-400 text-gray-950 font-extrabold text-xs transition">+ Pesan</span>
          </div>
        </div>
      </div>
    `;
  }).join('');
}

function openProductModal(id) {
  const rawItem = appState.menus.find((m) => m.id === id);
  if (!rawItem) return;

  const item = normalizeMenuItem(rawItem);
  selectedProduct = item;
  modalQty = 1;

  const imgEl = document.getElementById('modal-prod-img');
  imgEl.onerror = () => {
    imgEl.onerror = null;
    imgEl.src = getMenuPhotoFallback(item.name);
  };
  imgEl.src = item.photo || getMenuPhotoFallback(item.name);
  document.getElementById('modal-prod-cat').textContent = item.category;
  document.getElementById('modal-prod-name').textContent = item.name;
  document.getElementById('modal-prod-price').textContent = formatRupiah(item.price);
  document.getElementById('modal-prod-qty').textContent = modalQty;

  const noteInput = document.getElementById('modal-prod-note');
  if (noteInput) noteInput.value = '';

  const varContainer = document.getElementById('modal-variants-container');
  const variants = getMenuVariantsList(item);
  let varHtml = '';

  if (variants[0]) {
    const v1 = variants[0];
    varHtml += `
      <div class="p-3 rounded-2xl bg-gray-950/70 border border-gray-800">
        <label class="block text-xs font-bold text-amber-400 mb-2">${v1.label}</label>
        <div class="flex flex-wrap gap-2">
          ${v1.options.map((opt, i) => `
            <button type="button" onclick="selectModalVariant(1, this, '${escapeJsArg(opt)}')" class="var1-btn px-3 py-1.5 rounded-xl text-xs font-bold border transition ${i === 0 ? 'bg-amber-500 text-gray-950 border-amber-400' : 'bg-gray-900 text-gray-300 border-gray-700 hover:border-gray-500'}">${escapeHtmlAttr(opt)}</button>
          `).join('')}
        </div>
      </div>
    `;
    _chosenVar1 = `${v1.label}: ${v1.options[0]}`;
  } else {
    _chosenVar1 = '';
  }

  if (variants[1]) {
    const v2 = variants[1];
    varHtml += `
      <div class="p-3 rounded-2xl bg-gray-950/70 border border-gray-800">
        <label class="block text-xs font-bold text-amber-400 mb-2">${v2.label}</label>
        <div class="flex flex-wrap gap-2">
          ${v2.options.map((opt, i) => `
            <button type="button" onclick="selectModalVariant(2, this, '${escapeJsArg(opt)}')" class="var2-btn px-3 py-1.5 rounded-xl text-xs font-bold border transition ${i === 0 ? 'bg-amber-500 text-gray-950 border-amber-400' : 'bg-gray-900 text-gray-300 border-gray-700 hover:border-gray-500'}">${escapeHtmlAttr(opt)}</button>
          `).join('')}
        </div>
      </div>
    `;
    _chosenVar2 = `${v2.label}: ${v2.options[0]}`;
  } else {
    _chosenVar2 = '';
  }

  varContainer.innerHTML = varHtml;

  const modal = document.getElementById('product-modal');
  modal.classList.remove('hidden');
  modal.classList.add('flex');
}

function selectModalVariant(level, btnEl, optVal) {
  const cls = level === 1 ? '.var1-btn' : '.var2-btn';
  document.querySelectorAll(cls).forEach((b) => {
    b.classList.remove('bg-amber-500', 'text-gray-950', 'border-amber-400');
    b.classList.add('bg-gray-900', 'text-gray-300', 'border-gray-700');
  });
  btnEl.classList.remove('bg-gray-900', 'text-gray-300', 'border-gray-700');
  btnEl.classList.add('bg-amber-500', 'text-gray-950', 'border-amber-400');

  const variants = getMenuVariantsList(selectedProduct);
  if (level === 1 && variants[0]) _chosenVar1 = `${variants[0].label}: ${optVal}`;
  if (level === 2 && variants[1]) _chosenVar2 = `${variants[1].label}: ${optVal}`;
}

function changeModalQty(delta) {
  modalQty = Math.max(1, modalQty + delta);
  document.getElementById('modal-prod-qty').textContent = modalQty;
}

function closeProductModal() {
  const modal = document.getElementById('product-modal');
  modal.classList.add('hidden');
  modal.classList.remove('flex');
  const noteInput = document.getElementById('modal-prod-note');
  if (noteInput) noteInput.value = '';
}

function addSelectedToCart() {
  if (!selectedProduct) return;
  const variantText = [_chosenVar1, _chosenVar2].filter(Boolean).join(', ');
  const noteInput = document.getElementById('modal-prod-note');
  const note = noteInput ? noteInput.value.trim() : '';
  const cartKey = `${selectedProduct.id}__${variantText}__${note}`;

  const existing = cart.find((c) => c.cartKey === cartKey);
  if (existing) {
    existing.qty += modalQty;
  } else {
    cart.push({
      cartKey,
      id: selectedProduct.id,
      name: selectedProduct.name,
      price: selectedProduct.price,
      photo: selectedProduct.photo || '',
      variantText,
      note,
      qty: modalQty
    });
  }

  updateCartBadge();
  closeProductModal();
  showToast('Berhasil ditambahkan');
}

function updateCartBadge() {
  const badge = document.getElementById('cart-badge-count');
  if (!badge) return;
  badge.textContent = cart.reduce((sum, item) => sum + item.qty, 0);
}

function openCartModal() {
  renderCartItems();
  selectOrderType(selectedOrderType);
  selectPaymentMethod(selectedPaymentMethod);

  const modal = document.getElementById('cart-modal');
  modal.classList.remove('hidden');
  modal.classList.add('flex');
}

function closeCartModal() {
  resetUploadedProofState({ showMessage: false });
  const modal = document.getElementById('cart-modal');
  modal.classList.add('hidden');
  modal.classList.remove('flex');
}

function getCartTotal() {
  return cart.reduce((sum, item) => sum + (item.price * item.qty), 0);
}

function renderCartItems() {
  const listEl = document.getElementById('cart-items-list');
  const total = getCartTotal();

  document.getElementById('cart-grand-total').textContent = formatRupiah(total);
  document.getElementById('tunai-total-display').textContent = formatRupiah(total);
  document.getElementById('qris-total-display').textContent = formatRupiah(total);
  calculateCashChange();

  if (cart.length === 0) {
    listEl.innerHTML = '<div class="p-6 rounded-2xl bg-gray-950 border border-gray-800 text-center text-xs text-gray-400">Keranjang pesanan masih kosong. Pilih menu terlebih dahulu.</div>';
    return;
  }

  listEl.innerHTML = cart.map((item, idx) => `
    <div class="p-3 rounded-2xl bg-gray-950 border border-gray-800 flex items-center justify-between gap-3">
      <div class="min-w-0">
        <h4 class="font-bold text-white text-sm truncate">${item.name}</h4>
        ${item.variantText ? `<p class="text-[11px] text-amber-400 mt-0.5">${item.variantText}</p>` : ''}
        ${item.note ? `<p class="text-[11px] text-sky-300 mt-0.5">Catatan: ${item.note}</p>` : ''}
        <p class="text-xs text-gray-400 mt-0.5">${formatRupiah(item.price)} x ${item.qty} = <strong class="text-gray-200">${formatRupiah(item.price * item.qty)}</strong></p>
      </div>
      <div class="flex items-center gap-1.5 shrink-0">
        <button type="button" onclick="updateCartItemQty(${idx}, -1)" class="w-7 h-7 rounded-lg bg-gray-800 hover:bg-gray-700 text-white font-bold text-sm">-</button>
        <span class="w-6 text-center text-xs font-bold">${item.qty}</span>
        <button type="button" onclick="updateCartItemQty(${idx}, 1)" class="w-7 h-7 rounded-lg bg-amber-500 text-gray-950 font-bold text-sm">+</button>
        <button type="button" onclick="removeCartItem(${idx})" title="Hapus item" aria-label="Hapus item" class="w-7 h-7 rounded-lg bg-rose-600/20 hover:bg-rose-600/30 text-rose-400 border border-rose-500/30 font-bold text-xs flex items-center justify-center transition">✕</button>
      </div>
    </div>
  `).join('');
}

function removeCartItem(index) {
  if (index < 0 || index >= cart.length) return;
  cart.splice(index, 1);
  updateCartBadge();
  renderCartItems();
  showToast('Item dihapus dari keranjang');
}

function updateCartItemQty(index, delta) {
  cart[index].qty += delta;
  if (cart[index].qty <= 0) cart.splice(index, 1);
  updateCartBadge();
  renderCartItems();
}

function selectOrderType(type) {
  selectedOrderType = type;
  const btnMap = {
    'Dine In': document.getElementById('btn-type-dinein'),
    'Take Away': document.getElementById('btn-type-takeaway'),
    'Delivery': document.getElementById('btn-type-delivery')
  };

  Object.entries(btnMap).forEach(([key, btn]) => {
    if (key === type) {
      btn.classList.remove('bg-gray-950', 'text-gray-300', 'border-gray-700');
      btn.classList.add('bg-amber-500', 'text-gray-950', 'border-amber-400');
    } else {
      btn.classList.remove('bg-amber-500', 'text-gray-950', 'border-amber-400');
      btn.classList.add('bg-gray-950', 'text-gray-300', 'border-gray-700');
    }
  });

  const tableInput = document.getElementById('order-table-number');
  const addrInput = document.getElementById('order-address');

  addrInput.classList.remove('input-pink-disabled', 'bg-gray-950', 'text-white', 'placeholder-gray-500');
  addrInput.classList.add('bg-white', 'text-gray-950', 'placeholder-gray-600', 'border-gray-300');

  if (type === 'Dine In') {
    tableInput.disabled = false;
    tableInput.classList.remove('input-pink-disabled');
    tableInput.placeholder = 'Contoh: 04 atau Meja No.04';

    addrInput.disabled = true;
    addrInput.value = '';
    addrInput.placeholder = 'Tidak perlu diisi (Dine In)';
  } else {
    tableInput.disabled = true;
    tableInput.value = '';
    tableInput.classList.add('input-pink-disabled');
    tableInput.placeholder = 'Tidak perlu nomor meja';

    addrInput.disabled = false;
    addrInput.placeholder = type === 'Delivery'
      ? 'Ketik keterangan alamat...'
      : 'Ketik keterangan / jam ambil...';
  }
}

function selectPaymentMethod(method) {
  selectedPaymentMethod = method;
  const btnTunai = document.getElementById('btn-pay-tunai');
  const btnQris = document.getElementById('btn-pay-qris');
  const panelTunai = document.getElementById('panel-pay-tunai');
  const panelQris = document.getElementById('panel-pay-qris');

  if (method === 'Tunai') {
    btnTunai.classList.add('bg-amber-500', 'text-gray-950', 'border-amber-400');
    btnTunai.classList.remove('bg-gray-950', 'text-gray-300', 'border-gray-700');
    btnQris.classList.remove('bg-amber-500', 'text-gray-950', 'border-amber-400');
    btnQris.classList.add('bg-gray-950', 'text-gray-300', 'border-gray-700');

    panelTunai.classList.remove('hidden');
    panelQris.classList.add('hidden');
    calculateCashChange();
  } else {
    btnQris.classList.add('bg-amber-500', 'text-gray-950', 'border-amber-400');
    btnQris.classList.remove('bg-gray-950', 'text-gray-300', 'border-gray-700');
    btnTunai.classList.remove('bg-amber-500', 'text-gray-950', 'border-amber-400');
    btnTunai.classList.add('bg-gray-950', 'text-gray-300', 'border-gray-700');

    panelQris.classList.remove('hidden');
    panelTunai.classList.add('hidden');

    document.getElementById('qris-payment-text').textContent =
      appState.settings.paymentInfo || 'Silakan lakukan pembayaran sesuai nominal total di bawah.';
    const qrisWrapper = document.getElementById('qris-image-wrapper');
    const qrisImg = document.getElementById('qris-image-display');
    const normalizedQris = normalizeImageUrl(appState.settings.qrisUrl);
    if (normalizedQris) {
      qrisImg.src = normalizedQris;
      qrisWrapper.classList.remove('hidden');
    } else {
      qrisWrapper.classList.add('hidden');
    }
  }
}

function calculateCashChange() {
  const total = getCartTotal();
  const paid = parseInt(document.getElementById('cash-paid-input').value, 10) || 0;
  const change = paid - total;
  const changeEl = document.getElementById('tunai-change-display');

  if (paid === 0) {
    changeEl.textContent = 'Rp 0';
    changeEl.className = 'font-extrabold text-gray-400';
  } else if (change < 0) {
    changeEl.textContent = `Kurang ${formatRupiah(Math.abs(change))}`;
    changeEl.className = 'font-extrabold text-rose-400';
  } else {
    changeEl.textContent = formatRupiah(change);
    changeEl.className = 'font-extrabold text-emerald-400';
  }
}

function updateWaButtonLabel() {
  const labelEl = document.getElementById('btn-submit-wa-text');
  if (!labelEl) return;
  labelEl.textContent = uploadedProofDataUrl
    ? '4. Kirim Pesan WA & Siapkan Gambar Bukti'
    : '4. Kirim ke WhatsApp';
}

function renderProofPreviewUI() {
  const card = document.getElementById('proof-preview-card');
  const nameEl = document.getElementById('proof-file-name');
  const metaEl = document.getElementById('proof-file-meta');
  const imgEl = document.getElementById('proof-preview-img');
  if (!card || !nameEl || !metaEl || !imgEl) return;

  if (!uploadedProofDataUrl) {
    card.classList.add('hidden');
    imgEl.src = '';
    updateWaButtonLabel();
    return;
  }

  const sizeKb = uploadedProofBlob ? Math.max(1, Math.round(uploadedProofBlob.size / 1024)) : 0;
  nameEl.textContent = uploadedProofName || 'bukti-pembayaran.png';
  metaEl.textContent = sizeKb ? `Ukuran: ${sizeKb} KB • Terlampir` : 'Terlampir';
  imgEl.src = uploadedProofDataUrl;
  card.classList.remove('hidden');
  updateWaButtonLabel();
}

function resetUploadedProofState({ showMessage = false } = {}) {
  const hadProof = Boolean(uploadedProofDataUrl || uploadedProofName || uploadedProofBlob);
  uploadedProofDataUrl = '';
  uploadedProofName = '';
  uploadedProofBlob = null;
  const inputEl = document.getElementById('payment-proof-input');
  if (inputEl) inputEl.value = '';
  renderProofPreviewUI();
  if (showMessage && hadProof) {
    showToast('Bukti pembayaran dihapus');
  }
}

function clearUploadedProof() {
  resetUploadedProofState({ showMessage: true });
}

function dataUrlToPngBlob(dataUrl) {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => {
      const canvas = document.createElement('canvas');
      canvas.width = img.naturalWidth || img.width;
      canvas.height = img.naturalHeight || img.height;
      const ctx = canvas.getContext('2d');
      ctx.drawImage(img, 0, 0);
      canvas.toBlob((blob) => {
        if (blob) resolve(blob);
        else reject(new Error('Gagal membuat blob gambar'));
      }, 'image/png');
    };
    img.onerror = reject;
    img.src = dataUrl;
  });
}

async function copyProofImageToClipboard({ silent = false } = {}) {
  if (!uploadedProofDataUrl) {
    if (!silent) alert('Belum ada gambar bukti pembayaran yang diunggah.');
    return false;
  }
  try {
    if (navigator.clipboard && typeof ClipboardItem !== 'undefined') {
      const pngBlob = uploadedProofBlob && uploadedProofBlob.type === 'image/png'
        ? uploadedProofBlob
        : await dataUrlToPngBlob(uploadedProofDataUrl);
      await navigator.clipboard.write([new ClipboardItem({ 'image/png': pngBlob })]);
      if (!silent) showToast('Gambar bukti disalin! Tempel (Ctrl+V) di chat WA');
      return true;
    }
  } catch (err) {
    if (!silent) {
      alert('Browser membatasi salin gambar otomatis. Silakan klik "Simpan Gambar Bukti" lalu lampirkan file di WhatsApp.');
    }
  }
  return false;
}

function downloadProofImage() {
  if (!uploadedProofDataUrl) return;
  const link = document.createElement('a');
  link.href = uploadedProofDataUrl;
  link.download = uploadedProofName || ('Bukti-Transfer-' + Date.now() + '.png');
  link.click();
  showToast('Gambar bukti pembayaran diunduh!');
}

function handleProofUpload(event) {
  const file = event.target.files[0];
  if (!file) return;
  uploadedProofName = file.name || 'bukti-pembayaran.png';
  uploadedProofBlob = file;
  const reader = new FileReader();
  reader.onload = async function (e) {
    uploadedProofDataUrl = e.target.result;
    renderProofPreviewUI();
    const copied = await copyProofImageToClipboard({ silent: true });
    showToast(
      copied
        ? 'Bukti dilampirkan & disalin ke clipboard (siap Ctrl+V di WA)'
        : 'Bukti pembayaran dilampirkan'
    );
  };
  reader.readAsDataURL(file);
}

function submitOrderToWhatsApp() {
  if (cart.length === 0) {
    alert('Keranjang pesanan masih kosong.');
    return;
  }

  const customerName = document.getElementById('order-customer-name').value.trim();
  if (!customerName) {
    alert('Harap isi Nama Lengkap Pemesan terlebih dahulu.');
    document.getElementById('order-customer-name').focus();
    return;
  }

  const tableNumber = document.getElementById('order-table-number').value.trim();
  const address = document.getElementById('order-address').value.trim();
  const total = getCartTotal();

  if (selectedOrderType === 'Dine In' && !tableNumber) {
    alert('Harap isi Nomor Meja untuk pesanan Makan di Tempat (Dine In).');
    document.getElementById('order-table-number').focus();
    return;
  }
  if (selectedOrderType === 'Delivery' && !address) {
    alert('Harap isi Keterangan alamat pengantaran untuk pesanan Delivery.');
    document.getElementById('order-address').focus();
    return;
  }

  const locationDetail = selectedOrderType === 'Dine In'
    ? `Nomor Meja: ${tableNumber}`
    : `Keterangan: ${address || '-'}`;

  const proofNameSnapshot = uploadedProofName || 'bukti-pembayaran.png';
  const proofUrlSnapshot = uploadedProofDataUrl;

  let paymentDetailText = selectedPaymentMethod;
  if (selectedPaymentMethod === 'Tunai') {
    const paid = parseInt(document.getElementById('cash-paid-input').value, 10) || total;
    const change = Math.max(0, paid - total);
    paymentDetailText = `Bayar Tunai (Uang: ${formatRupiah(paid)}, Kembalian: ${formatRupiah(change)})`;
  } else {
    paymentDetailText = `QRIS / Transfer${proofUrlSnapshot ? ` (Bukti Pembayaran Terlampir: ${proofNameSnapshot})` : ''}`;
  }

  const newOrder = {
    id: 'ORD-' + Date.now(),
    customerName,
    orderType: selectedOrderType,
    locationDetail,
    items: JSON.parse(JSON.stringify(cart)),
    total,
    paymentMethod: paymentDetailText,
    proofUrl: proofUrlSnapshot,
    proofName: proofNameSnapshot,
    timestamp: getFormattedIndonesianDate() + ' ' + new Date().toLocaleTimeString('id-ID', { hour: '2-digit', minute: '2-digit' })
  };

  appState.orders.push(newOrder);
  if (!unreadOrderIds.includes(String(newOrder.id))) {
    unreadOrderIds.push(String(newOrder.id));
    saveUnreadOrderIds();
  }
  saveStateToStorage({ broadcast: true, syncCloud: true });

  let waNumber = (appState.settings.whatsapp || '087877611218').replace(/[^0-9]/g, '');
  if (waNumber.startsWith('0')) waNumber = '62' + waNumber.substring(1);

  const itemsLines = cart.map((item, idx) => {
    const details = [item.variantText, item.note ? `Catatan: ${item.note}` : ''].filter(Boolean).join(' | ');
    return `${idx + 1}. ${item.name}${details ? ` [${details}]` : ''} (${item.qty}x) = ${formatRupiah(item.price * item.qty)}`;
  }).join('\n');

  const proofNoteLine = proofUrlSnapshot
    ? `\n*Bukti Transfer:* ${proofNameSnapshot} (Gambar disalin ke clipboard — silakan Tempel/Paste di chat WA)`
    : '';

  const message =
`*PESANAN BARU - ${appState.settings.storeName.toUpperCase()}*
Tanggal: ${getFormattedIndonesianDate()}

*Nama Pemesan:* ${customerName}
*Jenis Pesanan:* ${selectedOrderType}
*${locationDetail}*

*Daftar Pesanan:*
${itemsLines}

*Total Pembayaran:* ${formatRupiah(total)}
*Metode Pembayaran:* ${paymentDetailText}${proofNoteLine}

Terima kasih!`;

  const waUrl = `https://wa.me/${waNumber}?text=${encodeURIComponent(message)}`;

  if (proofUrlSnapshot) {
    copyProofImageToClipboard({ silent: true });
  }

  cart = [];
  updateCartBadge();
  closeCartModal();
  showToast(
    proofUrlSnapshot
      ? 'Pesanan tersimpan, gambar bukti disalin & membuka WA...'
      : 'Pesanan tersimpan & membuka WhatsApp...'
  );

  window.open(waUrl, '_blank');
}

window.addEventListener('DOMContentLoaded', initApp);
