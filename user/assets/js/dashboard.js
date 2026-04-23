/* ================================================
   NOKOSHUB DASHBOARD - BACKEND CONNECTED
   ================================================ */

const STORE_KEYS = {
  session: 'nokoshub.user.session',
  token: 'nokoshub.auth.token',
  apiBase: 'nokoshub.api.base',
};

const API_BASE = detectApiBase();
const OTP_WAIT_SECONDS = 120;
const POLL_MS = 5000;

const S = {
  user: {
    name: 'User NokosHUB',
    email: '',
    telegramId: '',
    username: '',
    firstName: 'User',
    lastName: 'NokosHUB',
    balance: 0,
  },
  summary: {
    ordersCount: 0,
    successOrders: 0,
    successRate: 0,
    activeOrders: 0,
    depositTotal: 0,
    spentTotal: 0,
    refundTotal: 0,
    invoicesCount: 0,
  },
  referral: {
    code: '',
    settings: { enabled: false, rewardAmount: 0 },
    stats: {
      totalInvited: 0,
      qualifiedInvites: 0,
      rewardedInvites: 0,
      totalRewardEarned: 0,
      pendingRewardAmount: 0,
    },
    invites: [],
  },
  topup: { amount: 0, method: 'QRIS Pakasir', fee: 0, invoice: null },
  buy: {
    step: 1,
    svc: null,
    country: null,
    price: null,
    order: null,
    countries: [],
    busy: false,
  },
  api: { visible: false, key: 'nk_live_a8f2c3d9e1b7634512098765fedcba43' },
  orders: [],
  transactions: [],
  invoices: [],
  category: 'all',
  timer: null,
  poller: null,
  backendOnline: false,
};

const TTLS = {
  home: 'Beranda',
  buy: 'Beli Nomor OTP',
  topup: 'Top Up',
  orders: 'Pesanan',
  transactions: 'Transaksi',
  referral: 'Referral',
  profile: 'Profil',
  api: 'API Key',
};

const ROUTES = Object.keys(TTLS);
const ROUTE_ALIASES = {
  dashboard: 'home',
  beranda: 'home',
  beli: 'buy',
  order: 'buy',
  deposit: 'topup',
  saldo: 'topup',
  pesanan: 'orders',
  transaksi: 'transactions',
  referral: 'referral',
  refferal: 'referral',
  referal: 'referral',
  akun: 'profile',
  profil: 'profile',
  settings: 'profile',
  setelan: 'profile',
};

let topupCountdownTimer = null;
let topupStatusPoller = null;

let SVC = [
  { id: 'wa', e: '📱', n: 'WhatsApp', cat: 'social', bg: '#FFF3D4', p: 1200, priceCount: 1 },
  { id: 'tg', e: '💬', n: 'Telegram', cat: 'social', bg: '#DBF4FF', p: 800, priceCount: 1 },
  { id: 'ig', e: '📸', n: 'Instagram', cat: 'social', bg: '#D4FFF0', p: 1500, priceCount: 1 },
  { id: 'fb', e: '📘', n: 'Facebook', cat: 'social', bg: '#DBF4FF', p: 1000, priceCount: 1 },
  { id: 'tt', e: '🎵', n: 'TikTok', cat: 'social', bg: '#FFF3D4', p: 1800, priceCount: 1 },
  { id: 'gg', e: '☁️', n: 'Google', cat: 'social', bg: '#FFF3D4', p: 1300, priceCount: 1 },
  { id: 'sp', e: '🛒', n: 'Shopee', cat: 'ecommerce', bg: '#FFF3D4', p: 900, priceCount: 1 },
  { id: 'tk', e: '🛍️', n: 'Tokopedia', cat: 'ecommerce', bg: '#D4FFF0', p: 900, priceCount: 1 },
  { id: 'pp', e: '💙', n: 'PayPal', cat: 'financial', bg: '#DBF4FF', p: 3500, priceCount: 1 },
  { id: 'gp', e: '🟢', n: 'GoPay', cat: 'financial', bg: '#D4FFF0', p: 700, priceCount: 1 },
  { id: 'dc', e: '🎮', n: 'Discord', cat: 'gaming', bg: '#F3D4FF', p: 2200, priceCount: 1 },
  { id: 'nf', e: '🎬', n: 'Netflix', cat: 'streaming', bg: '#ffe0e0', p: 4000, priceCount: 1 },
];

const FALLBACK_COUNTRIES = [
  { id: 'id', f: '🇮🇩', n: 'Indonesia', code: '+62' },
  { id: 'global', f: '🌍', n: 'Semua Negara', code: '+' },
  { id: 'us', f: '🇺🇸', n: 'Amerika Serikat', code: '+1' },
  { id: 'gb', f: '🇬🇧', n: 'Inggris', code: '+44' },
  { id: 'sg', f: '🇸🇬', n: 'Singapura', code: '+65' },
  { id: 'my', f: '🇲🇾', n: 'Malaysia', code: '+60' },
];

const CAT_LABEL = {
  social: 'Sosial',
  ecommerce: 'E-Commerce',
  financial: 'Finansial',
  gaming: 'Gaming',
  streaming: 'Streaming',
};

const FMT = n => 'Rp ' + Number(n || 0).toLocaleString('id-ID');

function detectApiBase() {
  const configured = window.NOKOS_API_BASE || localStorage.getItem(STORE_KEYS.apiBase);
  if (configured) return normalizeApiBase(configured);
  if (location.protocol === 'file:') return 'http://localhost:3000/api';
  const isLocalHost = ['localhost', '127.0.0.1', '::1'].includes(location.hostname);
  if (isLocalHost && location.protocol === 'http:' && location.port && location.port !== '3000') {
    return `${location.protocol}//${location.hostname}:3000/api`;
  }
  return `${location.origin}/api`;
}

function normalizeApiBase(base) {
  const trimmed = String(base).replace(/\/+$/, '');
  return trimmed.endsWith('/api') ? trimmed : `${trimmed}/api`;
}

function apiUrl(path, params = {}) {
  const url = new URL(`${API_BASE}${path.startsWith('/') ? path : `/${path}`}`);
  Object.entries(params).forEach(([key, val]) => {
    if (val !== undefined && val !== null && val !== '') url.searchParams.set(key, val);
  });
  return url.toString();
}

async function apiFetch(path, options = {}) {
  const { params, body, ...fetchOptions } = options;
  const token = localStorage.getItem(STORE_KEYS.token);
  const response = await fetch(apiUrl(path, params), {
    method: body ? 'POST' : 'GET',
    headers: {
      'Content-Type': 'application/json',
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
      ...(fetchOptions.headers || {}),
    },
    body: body ? JSON.stringify(body) : undefined,
    ...fetchOptions,
  });
  const text = await response.text();
  const payload = text ? JSON.parse(text) : {};
  if (!response.ok || payload.success === false) {
    const err = payload.error || payload.message || `HTTP ${response.status}`;
    throw new Error(typeof err === 'string' ? err : JSON.stringify(err));
  }
  return payload.data ?? payload;
}

function readSession() {
  try {
    return JSON.parse(localStorage.getItem(STORE_KEYS.session) || '{}');
  } catch {
    return {};
  }
}

function saveSession(partial) {
  const next = { ...readSession(), ...partial };
  localStorage.setItem(STORE_KEYS.session, JSON.stringify(next));
  applySession(next);
  return next;
}

function hydrateSessionFromUrl() {
  const params = new URLSearchParams(location.search);
  const telegramId = params.get('telegramId') || params.get('tg') || params.get('tid');
  if (telegramId) saveSession({ telegramId: telegramId.trim() });
}

function applySession(session = readSession()) {
  S.user.telegramId = String(session.telegramId || '').trim();
  S.user.email = String(session.email || S.user.email || '').trim();
  S.user.firstName = String(session.firstName || S.user.firstName || 'User').trim();
  S.user.lastName = String(session.lastName || S.user.lastName || '').trim();
  S.user.username = String(session.username || S.user.username || '').trim();
  S.user.name = buildDisplayName(S.user);
  updateProfileFields();
  updateUI();
}

function getTelegramId({ promptUser = false } = {}) {
  if (S.user.telegramId) return S.user.telegramId;
  const session = readSession();
  if (session.telegramId) {
    applySession(session);
    return S.user.telegramId;
  }
  if (!promptUser) return '';
  showToast('Tautkan Telegram dari menu Profil bila ingin menyinkronkan akun bot dan web.', 'warning');
  nav('profile');
  return '';
}

async function syncUserSession() {
  const telegramId = getTelegramId();
  if (!telegramId) return null;
  const user = await apiFetch('/user/session', {
    body: {
      telegramId,
      username: S.user.username || undefined,
      firstName: S.user.firstName || undefined,
      lastName: S.user.lastName || undefined,
    },
  });
  applyBackendUser(user);
  return user;
}

function buildDisplayName(user) {
  const full = [user.firstName, user.lastName].filter(Boolean).join(' ').trim();
  if (full) return full;
  if (user.username) return user.username;
  if (user.email) return user.email.split('@')[0];
  return 'User NokosHUB';
}

function applyBackendUser(user) {
  if (!user) return;
  S.user.telegramId = user.telegramId || S.user.telegramId;
  S.user.username = user.username || S.user.username;
  S.user.firstName = user.firstName || S.user.firstName;
  S.user.lastName = user.lastName || S.user.lastName;
  S.user.balance = Number(user.balance || 0);
  S.user.name = buildDisplayName(S.user);
  saveSession({
    telegramId: S.user.telegramId,
    username: S.user.username,
    firstName: S.user.firstName,
    lastName: S.user.lastName,
    email: S.user.email,
  });
}

function applyWebUser(user) {
  if (!user) return;
  S.user.email = user.email || S.user.email;
  S.user.telegramId = user.telegramId || '';
  S.user.firstName = user.firstName || S.user.firstName;
  S.user.lastName = user.lastName || S.user.lastName;
  S.user.name = buildDisplayName(S.user);
  saveSession({
    email: S.user.email,
    telegramId: S.user.telegramId,
    firstName: S.user.firstName,
    lastName: S.user.lastName,
  });
}

function nav(page, options = {}) {
  const requestedRoute = normalizeRoute(page);
  const route = isMobileViewport() && requestedRoute === 'referral' ? 'profile' : requestedRoute;
  const shouldUpdateHash = options.updateHash !== false;
  const shouldReplace = options.replace === true;

  if (shouldUpdateHash) syncHash(route, shouldReplace);

  document.querySelectorAll('.page').forEach(p => p.classList.remove('active'));
  document.getElementById('page-' + route)?.classList.add('active');

  document.querySelectorAll('.sidebar-nav-item').forEach(i => i.classList.remove('active'));
  document.getElementById('n-' + route)?.classList.add('active');

  document.querySelectorAll('.nav-item').forEach(i => i.classList.remove('active'));
  const mnMap = { home: 'mn-home', buy: 'mn-buy', topup: 'mn-topup', orders: 'mn-orders', transactions: 'mn-orders', referral: 'mn-profile', profile: 'mn-profile', api: 'mn-profile' };
  document.getElementById(mnMap[route] || '')?.classList.add('active');

  set('topbarTitle', TTLS[route] || route);
  document.title = `${TTLS[route] || 'Dashboard'} | NokosHUB`;

  closeSidebar();
  document.querySelector('.page-wrap')?.scrollTo(0, 0);
  window.scrollTo(0, 0);

  if (route === 'buy') {
    renderSvcs();
    resetBuySteps();
  }

  updateUI();
  return route;
}

function normalizeRoute(page) {
  const raw = String(page || 'home')
    .replace(/^#\/?/, '')
    .replace(/^\/+/, '')
    .split(/[?#]/)[0]
    .trim()
    .toLowerCase();
  const route = ROUTE_ALIASES[raw] || raw || 'home';
  return ROUTES.includes(route) ? route : 'home';
}

function isMobileViewport() {
  return window.innerWidth <= 768;
}

function getHashRoute() {
  return normalizeRoute(window.location.hash || 'home');
}

function syncHash(route, replace = false) {
  const nextHash = `#/${route}`;
  if (window.location.hash === nextHash) return;
  if (replace) history.replaceState(null, '', nextHash);
  else history.pushState(null, '', nextHash);
}

function initRouter() {
  const initialRoute = getHashRoute();
  nav(initialRoute, { updateHash: false });
  syncHash(initialRoute, true);

  window.addEventListener('hashchange', () => {
    const route = getHashRoute();
    nav(route, { updateHash: false });
    syncHash(route, true);
  });

  window.addEventListener('resize', () => {
    if (isMobileViewport() && getHashRoute() === 'referral') {
      nav('profile', { replace: true });
    }
  });
}

async function loadDashboardData({ silent = false } = {}) {
  try {
    const [me, profile, services] = await Promise.all([
      apiFetch('/auth/me'),
      apiFetch('/user/profile'),
      apiFetch('/services'),
    ]);

    S.backendOnline = true;
    applyWebUser(me.user);
    if (profile.webUser) applyWebUser(profile.webUser);
    if (profile.user) applyBackendUser(profile.user);
    S.summary = { ...S.summary, ...(profile.summary || {}) };
    S.referral = {
      code: profile.referral?.code || me.user?.referralCode || S.referral.code || '',
      settings: {
        enabled: Boolean(profile.referral?.settings?.enabled),
        rewardAmount: Number(profile.referral?.settings?.rewardAmount || 0),
      },
      stats: {
        totalInvited: Number(profile.referral?.stats?.totalInvited || 0),
        qualifiedInvites: Number(profile.referral?.stats?.qualifiedInvites || 0),
        rewardedInvites: Number(profile.referral?.stats?.rewardedInvites || 0),
        totalRewardEarned: Number(profile.referral?.stats?.totalRewardEarned || 0),
        pendingRewardAmount: Number(profile.referral?.stats?.pendingRewardAmount || 0),
      },
      invites: Array.isArray(profile.referral?.invites) ? profile.referral.invites : [],
    };
    S.orders = profile.recentOrders || [];
    S.transactions = profile.recentTransactions || [];
    S.invoices = profile.recentInvoices || [];
    SVC = mapServices(Array.isArray(services) ? services : []);

    updateUI();
    renderSvcs();
    renderDashboardData();
    if (!silent) showToast('Dashboard tersambung ke backend.', 'success');
  } catch (err) {
    S.backendOnline = false;
    console.error(err);
    if (String(err.message).toLowerCase().includes('unauthorized')) {
      localStorage.removeItem(STORE_KEYS.token);
      window.location.href = '/login/';
      return;
    }
    if (!silent) showToast(`Gagal konek backend: ${err.message}`, 'error');
    renderSvcs();
  }
}

function renderDashboardData() {
  renderHomeOrders();
  renderActivity();
  renderOrders();
  renderTransactions();
  renderReferralPage();
  updateDashboardStats();
  updateProfileFields();
  refreshIcons();
}

function mapServices(services) {
  const mapped = services
    .filter(service => service && service.isActive !== false)
    .map(service => {
      const name = service.name || service.serviceCode || 'Layanan OTP';
      const cat = inferCategory(name);
      return {
        id: service.id,
        serviceCode: service.serviceCode,
        e: iconForService(name),
        n: name,
        cat,
        bg: colorForCategory(cat),
        p: Number(service.minSellPrice || 0),
        priceCount: Number(service.priceCount || 0),
      };
    })
    .sort((a, b) => a.n.localeCompare(b.n));
  return mapped.length ? mapped : SVC;
}

function updateUI() {
  const b = S.user.balance;
  const fmtBal = FMT(b);

  ['sb-balance', 'tb-balance', 'hero-balance', 'stat-balance', 'tx-bal', 'prof-bal'].forEach(id => {
    const el = document.getElementById(id);
    if (el) el.textContent = fmtBal;
  });

  set('sb-name', S.user.name);
  set('sb-email', S.user.email || (S.user.telegramId ? `Telegram ID: ${S.user.telegramId}` : 'Dashboard NokosHUB'));
  set('hero-name', `${S.user.name}!`);
  set('prof-name', S.user.name);
  set('tb-name', (S.user.firstName || S.user.name).split(' ')[0] || 'User');
  set('prof-email', S.user.email || (S.user.telegramId ? `Telegram ID: ${S.user.telegramId}` : 'Belum terhubung'));

  const amt = S.topup.amount;
  const fee = S.topup.fee;
  const tot = amt + fee;
  const aft = b + amt;
  const feeLabel = S.topup.method === 'QRIS Pakasir' && !fee ? 'Dihitung otomatis' : fee ? FMT(fee) : 'Gratis';
  set('sum-cur', fmtBal);
  set('sum-amt', amt ? FMT(amt) : 'Rp 0');
  set('sum-met', S.topup.method);
  set('sum-fee', feeLabel);
  set('sum-tot', tot ? FMT(tot) : 'Rp 0');
  set('sum-aft', FMT(aft));
}

function updateDashboardStats() {
  const totalOrders = S.summary.ordersCount || S.orders.length;
  const successOrders = S.summary.successOrders || S.orders.filter(order => order.status === 'SUCCESS').length;
  const successRate = totalOrders ? (S.summary.successRate || Math.round((successOrders / totalOrders) * 1000) / 10) : 0;
  const activeOrders = S.summary.activeOrders || S.orders.filter(order => ['ACTIVE', 'PENDING'].includes(order.status)).length;
  const refundCount = S.transactions.filter(tx => tx.type === 'REFUND').length;
  const depositCount = S.transactions.filter(tx => tx.type === 'DEPOSIT').length;

  set('stat-orders', String(totalOrders));
  set('stat-orders-note', activeOrders ? `${activeOrders} menunggu` : 'Data backend');
  set('stat-success-rate', `${successRate.toLocaleString('id-ID')}%`);
  set('stat-success-note', `${successOrders} berhasil`);
  set('stat-refund', FMT(S.summary.refundTotal));
  set('stat-refund-note', `${refundCount} transaksi`);
  set('quick-service-count', `${SVC.length.toLocaleString('id-ID')} layanan`);
  set('tx-total-deposit', FMT(S.summary.depositTotal));
  set('tx-total-deposit-note', `${depositCount} transaksi`);
  set('tx-total-spent', FMT(S.summary.spentTotal));
  set('tx-total-spent-note', `${totalOrders} pesanan`);
  set('prof-orders', String(totalOrders));
  set('prof-success-rate', `${Math.round(successRate)}%`);

  const orderDot = document.querySelector('#n-orders .n-dot');
  if (orderDot) orderDot.textContent = String(activeOrders || totalOrders || 0);
  const mobileDot = document.querySelector('#mn-orders .nav-dot');
  if (mobileDot) mobileDot.style.display = activeOrders ? '' : 'none';
}

function updateProfileFields() {
  setInput('pFirst', S.user.firstName || '');
  setInput('pLast', S.user.lastName || '');
  setInput('pEmail', S.user.email || '');
  setInput('pTelegramId', S.user.telegramId || '');
  updateReferralFields();
}

function updateReferralFields() {
  setAll('[data-referral-code]', S.referral.code || 'Belum tersedia');
  setAll('[data-referral-total]', String(S.referral.stats.totalInvited || 0));
  setAll('[data-referral-qualified]', String(S.referral.stats.qualifiedInvites || 0));
  setAll('[data-referral-pending]', FMT(S.referral.stats.pendingRewardAmount || 0));
  setAll('[data-referral-earned]', FMT(S.referral.stats.totalRewardEarned || 0));
  setAll(
    '[data-referral-hint]',
    S.referral.settings.enabled
      ? `Bonus aktif ${FMT(S.referral.settings.rewardAmount)} per referral yang lolos syarat deposit pertama.`
      : 'Program referral sedang nonaktif. Anda tetap bisa membagikan kode referral.'
  );
  const statusEl = document.getElementById('referralProgramStatus');
  if (statusEl) {
    statusEl.textContent = S.referral.settings.enabled
      ? `Aktif • Bonus ${FMT(S.referral.settings.rewardAmount)}`
      : 'Program belum aktif';
    statusEl.classList.toggle('active', S.referral.settings.enabled);
  }
}

function set(id, val) {
  const el = document.getElementById(id);
  if (el) el.textContent = val;
}

function setAll(selector, val) {
  document.querySelectorAll(selector).forEach((el) => {
    el.textContent = val;
  });
}

function setInput(id, val) {
  const el = document.getElementById(id);
  if (el && document.activeElement !== el) el.value = val;
}

let selectedCat = 'all';

function renderSvcs() {
  const list = document.getElementById('svcList');
  if (!list) return;
  const q = (document.getElementById('svcSearch')?.value || '').toLowerCase().trim();
  const filtered = SVC.filter(s =>
    (selectedCat === 'all' || s.cat === selectedCat) &&
    (!q || s.n.toLowerCase().includes(q))
  );

  if (!filtered.length) {
    list.innerHTML = emptyBlock('🔍', 'Tidak ditemukan', 'Coba kata kunci lain atau sync provider dari backoffice.');
    return;
  }

  list.innerHTML = filtered.map(s => `
    <div class="svc-row" onclick="selectSvc(${jsArg(s.id)})">
      <div class="svc-row-icon" style="background:${s.bg};">${s.e}</div>
      <div class="svc-row-info">
        <div class="svc-row-name">${esc(s.n)}</div>
        <div class="svc-row-cat">${CAT_LABEL[s.cat] || 'OTP'} ${s.priceCount ? `• ${s.priceCount} harga` : ''}</div>
      </div>
      <div class="svc-row-right">
        <div class="svc-row-price">${s.p ? `Mulai ${FMT(s.p)}` : 'Cek harga'}</div>
        <span class="badge badge-success" style="margin-top:3px;"><span class="badge-dot"></span>Tersedia</span>
      </div>
    </div>
  `).join('');
  refreshIcons();
}

function filterSvc() { renderSvcs(); }

function setCat(el, cat) {
  document.querySelectorAll('.fc').forEach(c => c.classList.remove('active'));
  el.classList.add('active');
  selectedCat = cat;
  renderSvcs();
}

function resetBuySteps() {
  goStep(1);
  stopOtpWatch();
  S.buy.country = null;
  S.buy.price = null;
  S.buy.order = null;
  const waiting = document.getElementById('otpStateWaiting');
  const received = document.getElementById('otpStateReceived');
  const expired = document.getElementById('otpStateExpired');
  if (waiting) waiting.style.display = '';
  if (received) received.style.display = 'none';
  if (expired) expired.style.display = 'none';
  set('timerCount', '2:00');
}

function goStep(n) {
  S.buy.step = n;
  document.querySelectorAll('.buy-sub').forEach(s => s.classList.remove('active'));
  document.getElementById('buyStep' + n)?.classList.add('active');

  [1, 2, 3].forEach(i => {
    const el = document.getElementById('bStep' + i);
    const line = document.getElementById('bLine' + i);
    if (!el) return;
    el.classList.remove('active', 'done');
    if (i < n) el.classList.add('done');
    if (i === n) el.classList.add('active');
    if (line) line.classList.toggle('done', i < n);
  });
}

async function selectSvc(id) {
  const s = SVC.find(x => x.id === id);
  if (!s) return;
  S.buy.svc = s;
  S.buy.countries = [];
  S.buy.country = null;
  S.buy.price = null;

  set('selSvcIcon', s.e);
  set('selSvcName', s.n);
  set('selSvcPrice', s.p ? `Mulai ${FMT(s.p)}` : 'Cek harga');
  const countrySearch = document.getElementById('countrySearch');
  if (countrySearch) countrySearch.value = '';

  const grid = document.getElementById('countryGrid');
  if (grid) grid.innerHTML = loadingBlock('Mengambil negara dari backend...');
  goStep(2);

  try {
    const countries = S.backendOnline
      ? await apiFetch('/countries', { params: { serviceId: s.id } })
      : FALLBACK_COUNTRIES;
    S.buy.countries = mapCountries(Array.isArray(countries) ? countries : []);
    renderCountries();
  } catch (err) {
    console.error(err);
    showToast(`Gagal ambil negara: ${err.message}`, 'error');
    S.buy.countries = FALLBACK_COUNTRIES;
    renderCountries();
  }
}

function renderCountries() {
  const grid = document.getElementById('countryGrid');
  if (!grid) return;
  const q = (document.getElementById('countrySearch')?.value || '').trim().toLowerCase();
  const countries = S.buy.countries.filter(c => {
    if (!q) return true;
    return [c.n, c.code, c.countryCode, c.minSellPrice ? String(c.minSellPrice) : '']
      .filter(Boolean)
      .some(value => String(value).toLowerCase().includes(q));
  });

  if (!countries.length) {
    grid.innerHTML = emptyBlock('🌍', 'Negara belum tersedia', 'Coba sync provider dari backoffice lalu refresh dashboard.');
    return;
  }
  grid.innerHTML = countries.map(c => `
    <div class="country-card ${S.buy.country?.id === c.id ? 'selected' : ''}" onclick="selectCountry(${jsArg(c.id)}, this)">
      <div class="country-flag">${c.f}</div>
      <div class="country-meta">
        <div class="country-name">${esc(c.n)}</div>
        <div class="country-qty">${esc(c.code || c.countryCode || '-')}</div>
        <div class="country-price">${c.minSellPrice ? FMT(c.minSellPrice) : 'Cek harga'}</div>
      </div>
    </div>
  `).join('');
}

function filterCountries() {
  renderCountries();
}

async function selectCountry(countryId, el) {
  if (S.buy.busy) return;

  document.querySelectorAll('.country-card').forEach(c => c.classList.remove('selected'));
  el?.classList.add('selected');

  const country = S.buy.countries.find(c => c.id === countryId);
  const svc = S.buy.svc;
  if (!country || !svc) return;

  S.buy.country = country;
  S.buy.busy = true;
  el?.classList.add('loading');

  try {
    let price = country.priceId && country.minSellPrice
      ? { id: country.priceId, sellPrice: country.minSellPrice, isActive: true }
      : null;

    if (!price) {
      const prices = await apiFetch('/prices', { params: { serviceId: svc.id, countryId: country.id } });
      price = (Array.isArray(prices) ? prices : [])
        .filter(p => p.isActive !== false)
        .sort((a, b) => Number(a.sellPrice) - Number(b.sellPrice))[0];
    }

    if (!price) throw new Error('Harga untuk negara ini belum tersedia');
    S.buy.price = { id: price.id, sellPrice: Number(price.sellPrice || 0) };

    if (S.user.balance < S.buy.price.sellPrice) {
      showToast('Saldo tidak cukup. Silakan top up dulu.', 'error');
      setTimeout(() => nav('topup'), 900);
      return;
    }

    set('selSvcPrice', FMT(S.buy.price.sellPrice));
    await createOrder();
  } catch (err) {
    console.error(err);
    showToast(`Gagal order: ${err.message}`, 'error');
  } finally {
    S.buy.busy = false;
    el?.classList.remove('loading');
  }
}

async function createOrder() {
  if (!S.buy.price) return;

  const order = await apiFetch('/order', {
    body: { priceId: S.buy.price.id },
  });

  const svc = S.buy.svc;
  const country = S.buy.country;
  S.buy.order = {
    id: order.orderId,
    phoneNumber: order.phoneNumber,
    status: order.status,
    price: {
      sellPrice: S.buy.price.sellPrice,
      service: { name: svc?.n },
      country: { name: country?.n },
    },
  };

  S.user.balance = Math.max(0, S.user.balance - S.buy.price.sellPrice);
  updateUI();

  const phone = order.phoneNumber || '-';
  set('waitIcon', svc?.e || '📱');
  set('waitSvc', svc?.n || 'OTP');
  set('waitCountry', `${country?.f || '🌍'} ${country?.n || ''}`.trim());
  set('waitPhone', phone);
  set('refundAmount', FMT(S.buy.price.sellPrice));
  set('receivedPhone', phone);
  set('receivedSvc', `${svc?.n || 'OTP'} — ${country?.f || '🌍'} ${country?.n || ''}`.trim());

  goStep(3);
  showToast('Nomor berhasil dibuat. Menunggu OTP dari backend.', 'success');
  startOtpWatch(order.orderId);
  await loadDashboardData({ silent: true });
}

function startOtpWatch(orderId) {
  stopOtpWatch();
  const ring = document.getElementById('timerRing');
  const circumference = 2 * Math.PI * 65;
  let remaining = OTP_WAIT_SECONDS;

  if (ring) {
    ring.style.strokeDasharray = circumference;
    ring.style.strokeDashoffset = 0;
  }
  set('timerCount', '2:00');

  S.timer = setInterval(() => {
    remaining = Math.max(0, remaining - 1);
    const m = String(Math.floor(remaining / 60));
    const sec = String(remaining % 60).padStart(2, '0');
    set('timerCount', `${m}:${sec}`);
    if (ring) ring.style.strokeDashoffset = circumference * ((OTP_WAIT_SECONDS - remaining) / OTP_WAIT_SECONDS);
    if (remaining <= 0) stopOtpWatch(false);
  }, 1000);

  S.poller = setInterval(() => refreshOrderStatus(orderId), POLL_MS);
  refreshOrderStatus(orderId);
}

function stopOtpWatch(clearOrder = true) {
  if (S.timer) clearInterval(S.timer);
  if (S.poller) clearInterval(S.poller);
  S.timer = null;
  S.poller = null;
  if (clearOrder) S.buy.order = null;
}

async function refreshOrderStatus(orderId) {
  if (!orderId) return;
  try {
    const orders = await apiFetch('/orders');
    const order = (Array.isArray(orders) ? orders : []).find(item => item.id === orderId);
    if (!order) return;

    S.buy.order = order;
    if (order.status === 'SUCCESS' && order.otpCode) {
      stopOtpWatch(false);
      showOtpReceived(order.otpCode);
      await loadDashboardData({ silent: true });
    } else if (['FAILED', 'CANCELLED'].includes(order.status)) {
      stopOtpWatch(false);
      showOtpExpired(order.failReason || 'OTP tidak diterima. Saldo dikembalikan otomatis.');
      await loadDashboardData({ silent: true });
    }
  } catch (err) {
    console.error(err);
  }
}

function showOtpReceived(code) {
  set('receivedCode', code);
  document.getElementById('otpStateWaiting').style.display = 'none';
  document.getElementById('otpStateReceived').style.display = '';
  document.getElementById('otpStateExpired').style.display = 'none';
  showToast(`OTP diterima: ${code}`, 'success');
}

function showOtpExpired(message = 'OTP tidak diterima. Saldo dikembalikan otomatis.') {
  document.getElementById('otpStateWaiting').style.display = 'none';
  document.getElementById('otpStateReceived').style.display = 'none';
  document.getElementById('otpStateExpired').style.display = '';
  showToast(message, 'warning');
}

async function cancelOrder() {
  const orderId = S.buy.order?.id;
  if (!orderId) {
    resetBuySteps();
    return;
  }
  await cancelExistingOrder(orderId);
  goStep(1);
}

async function cancelExistingOrder(orderId) {
  if (!confirm('Yakin batalkan pesanan? Saldo akan direfund jika order masih aktif.')) return;
  try {
    await apiFetch('/order/cancel', { body: { orderId } });
    stopOtpWatch(false);
    showToast('Pesanan dibatalkan. Refund diproses otomatis.', 'success');
    await loadDashboardData({ silent: true });
  } catch (err) {
    showToast(`Gagal batalkan: ${err.message}`, 'error');
  }
}

function newOrder() {
  resetBuySteps();
  renderSvcs();
}

function copyOtpCode() {
  const code = document.getElementById('receivedCode').textContent;
  copyText(code);
}

function setPreset(amount, el) {
  document.getElementById('topupAmt').value = amount;
  document.querySelectorAll('.preset').forEach(b => b.classList.remove('sel'));
  el.classList.add('sel');
  S.topup.amount = amount;
  updateUI();
}

function onTopupChange() {
  document.querySelectorAll('.preset').forEach(b => b.classList.remove('sel'));
  S.topup.amount = parseInt(document.getElementById('topupAmt').value, 10) || 0;
  updateUI();
}

function selectPay(el, method, fee) {
  document.querySelectorAll('.pay-item').forEach(p => p.classList.remove('sel'));
  el.classList.add('sel');
  S.topup.method = method;
  S.topup.fee = parseInt(fee, 10) || 0;
  updateUI();
}

async function doTopup() {
  if (!S.topup.amount || S.topup.amount < 10000) {
    showToast('Minimal top up Rp 10.000', 'warning');
    return;
  }

  try {
    const invoice = await apiFetch('/deposit', {
      body: { amount: S.topup.amount },
    });
    S.topup.invoice = invoice;
    S.invoices.unshift(invoice);

    updateTopupInvoiceUi(invoice);
    const qrisImage = document.getElementById('topupQrisImage');
    if (qrisImage) {
      qrisImage.src = invoice.qrisImageDataUrl || '';
    }
    startTopupCountdown(invoice.expiredAt);
    startTopupStatusPolling();
    openModal('modalTopupOk');

    document.getElementById('topupAmt').value = '';
    document.querySelectorAll('.preset').forEach(b => b.classList.remove('sel'));
    S.topup.amount = 0;
    updateUI();
    await loadDashboardData({ silent: true });
  } catch (err) {
    showToast(`Gagal buat invoice: ${err.message}`, 'error');
  }
}

function copyInvoicePayload() {
  const payload = S.topup.invoice?.qrisPayload || '';
  if (!payload) {
    showToast('Kode QRIS belum tersedia.', 'warning');
    return;
  }
  copyText(payload);
}

function handleTopupProofChange(event) {
  const file = event.target.files?.[0] || null;
  S.topup.proofFile = file;

  if (!file) {
    set('topupProofName', 'Belum ada file dipilih');
    return;
  }

  if (!['image/jpeg', 'image/png', 'image/webp'].includes(file.type)) {
    S.topup.proofFile = null;
    event.target.value = '';
    set('topupProofName', 'Format harus JPG, PNG, atau WEBP');
    showToast('Format bukti harus gambar JPG, PNG, atau WEBP', 'warning');
    return;
  }

  if (file.size > 5 * 1024 * 1024) {
    S.topup.proofFile = null;
    event.target.value = '';
    set('topupProofName', 'Ukuran file maksimal 5MB');
    showToast('Ukuran bukti maksimal 5MB', 'warning');
    return;
  }

  set('topupProofName', `${file.name} (${Math.ceil(file.size / 1024)} KB)`);
}

async function submitTopupProof() {
  const invoice = S.topup.invoice;
  const file = S.topup.proofFile;
  const telegramId = getTelegramId({ promptUser: true });

  if (!invoice?.invoiceId) {
    showToast('Invoice belum dibuat atau sudah tidak tersedia', 'warning');
    return;
  }
  if (!telegramId) return;
  if (!file) {
    showToast('Upload bukti pembayaran terlebih dahulu', 'warning');
    return;
  }

  const btn = document.getElementById('topupProofSubmitBtn');
  const original = btn?.innerHTML;
  if (btn) {
    btn.disabled = true;
    btn.innerHTML = 'Mengirim bukti...';
  }

  try {
    const dataBase64 = await fileToBase64(file);
    await apiFetch('/deposit/proof', {
      body: {
        invoiceId: invoice.invoiceId,
        telegramId,
        fileName: file.name,
        mimeType: file.type,
        dataBase64,
      },
    });

    showToast('Bukti pembayaran terkirim ke admin. Saldo akan masuk setelah dikonfirmasi.', 'success');
    closeModal('modalTopupOk');
    nav('transactions');
    await loadDashboardData({ silent: true });
  } catch (err) {
    showToast(`Gagal kirim bukti: ${err.message}`, 'error');
  } finally {
    if (btn) {
      btn.disabled = false;
      btn.innerHTML = original || '📤 Kirim Bukti ke Admin';
    }
  }
}

function fileToBase64(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result || '').split(',')[1] || '');
    reader.onerror = () => reject(new Error('Gagal membaca file bukti'));
    reader.readAsDataURL(file);
  });
}

async function refreshTopupInvoiceStatus({ silent = false } = {}) {
  const invoice = S.topup.invoice;

  if (!invoice?.invoiceId) {
    if (!silent) showToast('Invoice belum dibuat atau sudah tidak tersedia', 'warning');
    return null;
  }

  try {
    const latest = await apiFetch(`/deposit/${invoice.invoiceId}/status`);
    S.topup.invoice = {
      ...invoice,
      ...latest,
      invoiceId: latest.id || invoice.invoiceId,
    };
    const qrisImage = document.getElementById('topupQrisImage');
    if (qrisImage && S.topup.invoice.qrisImageDataUrl) {
      qrisImage.src = S.topup.invoice.qrisImageDataUrl;
    }
    updateTopupInvoiceUi(S.topup.invoice);

    if (latest.status === 'PAID') {
      stopTopupCountdown();
      stopTopupStatusPolling();
      if (!silent) showToast('Pembayaran berhasil terdeteksi. Saldo sudah ditambahkan otomatis.', 'success');
      await loadDashboardData({ silent: true });
    } else if (latest.status === 'EXPIRED') {
      stopTopupCountdown();
      stopTopupStatusPolling();
      if (!silent) showToast('Invoice sudah expired. Buat invoice top up baru untuk melanjutkan.', 'warning');
      await loadDashboardData({ silent: true });
    }

    return latest;
  } catch (err) {
    if (!silent) showToast(`Gagal cek status pembayaran: ${err.message}`, 'error');
    return null;
  }
}

function updateTopupInvoiceUi(invoice) {
  const status = String(invoice?.status || 'PENDING').toUpperCase();
  set('topupOkMsg', `Invoice #${shortId(invoice.invoiceId)} dibuat melalui payment gateway Pakasir dan berlaku sampai ${formatDate(invoice.expiredAt)}.`);
  set('topupOkBal', FMT(invoice.amount));
  set('topupCreditAmount', FMT(invoice.baseAmount || 0));
  set('topupGatewayFee', FMT(invoice.fee || 0));
  set('topupPaymentMethod', String(invoice.paymentMethod || 'qris').toUpperCase());
  set('topupPaymentStatus', status === 'PAID' ? 'Sudah dibayar' : status === 'EXPIRED' ? 'Expired' : 'Menunggu pembayaran');

  const linkBtn = document.getElementById('topupOpenGatewayBtn');
  if (linkBtn) linkBtn.disabled = !invoice.paymentUrl || status !== 'PENDING';

  const statusEl = document.getElementById('topupPaymentStatus');
  if (statusEl) {
    statusEl.classList.toggle('success', status === 'PAID');
    statusEl.classList.toggle('expired', status === 'EXPIRED');
  }
}

function openGatewayPaymentPage() {
  const url = S.topup.invoice?.paymentUrl;
  if (!url) {
    showToast('Link pembayaran belum tersedia.', 'warning');
    return;
  }
  window.open(url, '_blank', 'noopener,noreferrer');
}

function startTopupStatusPolling() {
  stopTopupStatusPolling();
  topupStatusPoller = setInterval(() => {
    if (!document.getElementById('modalTopupOk')?.classList.contains('open')) return;
    if (S.topup.invoice?.status && S.topup.invoice.status !== 'PENDING') return;
    refreshTopupInvoiceStatus({ silent: true });
  }, 5000);
}

function startTopupCountdown(expiredAt) {
  stopTopupCountdown();
  const el = document.getElementById('topupInvoiceCountdown');
  if (!el) return;

  const tick = () => {
    const remainingMs = new Date(expiredAt).getTime() - Date.now();
    if (!Number.isFinite(remainingMs)) {
      el.textContent = 'Batas waktu: -';
      el.classList.remove('expired');
      return;
    }

    if (remainingMs <= 0) {
      el.textContent = 'Invoice sudah expired';
      el.classList.add('expired');
      stopTopupCountdown();
      stopTopupStatusPolling();
      loadDashboardData({ silent: true });
      return;
    }

    const minutes = Math.floor(remainingMs / 60000);
    const seconds = Math.floor((remainingMs % 60000) / 1000);
    el.textContent = `Batas waktu: ${minutes}m ${String(seconds).padStart(2, '0')}s`;
    el.classList.remove('expired');
  };

  tick();
  topupCountdownTimer = setInterval(tick, 1000);
}

function stopTopupCountdown() {
  if (!topupCountdownTimer) return;
  clearInterval(topupCountdownTimer);
  topupCountdownTimer = null;
}

function stopTopupStatusPolling() {
  if (!topupStatusPoller) return;
  clearInterval(topupStatusPoller);
  topupStatusPoller = null;
}

function renderHomeOrders() {
  const body = document.getElementById('homeRecentOrdersBody');
  if (!body) return;
  const orders = S.orders.slice(0, 5);
  if (!orders.length) {
    body.innerHTML = `<tr><td colspan="5">${emptyInline('Belum ada pesanan. Mulai beli nomor OTP pertama kamu.')}</td></tr>`;
    return;
  }

  body.innerHTML = orders.map(order => {
    const meta = orderMeta(order);
    return `
      <tr>
        <td>
          <div class="svc-cell">
            <div class="svc-icon-sm" style="background:${meta.bg};">${meta.icon}</div>
            <div><div class="svc-n">${esc(meta.service)}</div><div class="svc-c">${esc(meta.country)}</div></div>
          </div>
        </td>
        <td style="font-family:monospace;font-size:0.78rem;color:var(--muted);">${esc(maskPhone(order.phoneNumber))}</td>
        <td>${order.otpCode ? `<span class="otp-chip" onclick="openOtpModal(${jsArg(order.otpCode)}, ${jsArg(meta.service)})">${esc(order.otpCode)} 📋</span>` : '<span class="anim-pulse" style="color:var(--muted);font-size:0.78rem;font-weight:700;">Menunggu</span>'}</td>
        <td>${statusBadge(order.status)}</td>
        <td style="color:${order.status === 'CANCELLED' ? 'var(--success)' : 'var(--danger)'};font-weight:800;">${order.status === 'CANCELLED' ? '+' : '-'}${FMT(meta.price)}</td>
      </tr>
    `;
  }).join('');
}

function renderActivity() {
  const list = document.getElementById('homeActivityList');
  if (!list) return;
  const txs = S.transactions.slice(0, 5);
  if (!txs.length) {
    list.innerHTML = emptyBlock('⚡', 'Belum ada aktivitas', 'Transaksi akan muncul setelah top up atau order.');
    return;
  }

  list.innerHTML = txs.map(tx => {
    const isIn = Number(tx.amount) > 0;
    const icon = tx.type === 'DEPOSIT' ? '💰' : tx.type === 'REFUND' ? '🔄' : '📱';
    const cls = isIn ? (tx.type === 'REFUND' ? 'act-ref' : 'act-in') : 'act-out';
    return `
      <div class="act-item">
        <div class="act-icon" style="background:${isIn ? '#D4FFF0' : '#FFF3D4'};">${icon}</div>
        <div class="act-body"><div class="act-t">${esc(typeLabel(tx.type))}</div><div class="act-s">${esc(tx.description || '-')}</div></div>
        <div class="act-r"><div class="act-amt ${cls}">${isIn ? '+' : ''}${FMT(tx.amount)}</div><div class="act-time">${esc(formatDate(tx.createdAt))}</div></div>
      </div>
    `;
  }).join('');
}

function renderOrders() {
  const list = document.getElementById('ordersList');
  if (!list) return;
  if (!S.orders.length) {
    list.innerHTML = emptyBlock('📋', 'Belum ada pesanan', 'Pesanan OTP akan tampil di sini setelah kamu membeli nomor.');
    return;
  }

  list.innerHTML = S.orders.map(order => {
    const meta = orderMeta(order);
    const canCancel = ['ACTIVE', 'PENDING'].includes(order.status);
    return `
      <div class="order-card-big" ${order.otpCode ? `onclick="openOtpModal(${jsArg(order.otpCode)}, ${jsArg(meta.service)})"` : ''}>
        <div class="oc-top">
          <div class="oc-icon" style="background:${meta.bg};">${meta.icon}</div>
          <div><div class="oc-svc">${esc(meta.service)}</div><div class="oc-id">#${shortId(order.id)} · ${esc(order.phoneNumber || '-')} · ${esc(meta.country)}</div></div>
          <div style="margin-left:auto;flex-shrink:0;">${statusBadge(order.status)}</div>
        </div>
        <div class="oc-mid">
          ${order.otpCode
            ? `<div class="oc-otp">${esc(order.otpCode)}</div><button class="btn btn-primary btn-xs" onclick="event.stopPropagation();copyText(${jsArg(order.otpCode)})">📋 Salin</button>`
            : `<div style="color:var(--muted);font-size:0.84rem;font-weight:700;">${esc(order.failReason || 'Menunggu SMS masuk...')}</div>${canCancel ? `<button class="btn btn-danger btn-xs" onclick="event.stopPropagation();cancelExistingOrder(${jsArg(order.id)})">❌ Batalkan</button>` : ''}`}
        </div>
        <div class="oc-foot">
          <div class="oc-time">📅 ${esc(formatDate(order.createdAt))}</div>
          <div class="oc-price ${order.status === 'CANCELLED' ? 'act-ref' : 'act-out'}">${order.status === 'CANCELLED' ? '+' : '-'}${FMT(meta.price)}</div>
        </div>
      </div>
    `;
  }).join('');
}

function renderTransactions() {
  const body = document.getElementById('transactionsBody');
  if (!body) return;
  if (!S.transactions.length) {
    body.innerHTML = `<tr><td colspan="8">${emptyInline('Belum ada riwayat saldo.')}</td></tr>`;
    return;
  }

  let runningBalance = S.user.balance;
  body.innerHTML = S.transactions.map(tx => {
    const amount = Number(tx.amount || 0);
    const isIn = amount > 0;
    const balanceAfter = runningBalance;
    runningBalance -= amount;
    return `
      <tr>
        <td style="font-family:monospace;font-size:0.72rem;color:var(--muted);">#${shortId(tx.id)}</td>
        <td>${transactionBadge(tx.type)}</td>
        <td>${esc(tx.description || '-')}</td>
        <td>${tx.type === 'DEPOSIT' ? '💰 Deposit' : tx.type === 'REFUND' ? '🔄 Sistem' : '📱 Saldo'}</td>
        <td style="color:${isIn ? 'var(--success)' : 'var(--danger)'};font-weight:800;">${isIn ? '+' : ''}${FMT(amount)}</td>
        <td style="font-family:var(--font-h);">${FMT(balanceAfter)}</td>
        <td><span class="badge badge-success"><span class="badge-dot"></span>OK</span></td>
        <td style="font-size:0.72rem;color:var(--muted);">${esc(formatDate(tx.createdAt))}</td>
      </tr>
    `;
  }).join('');
}

function openOtpModal(code, svc) {
  set('otp-modal-code', code);
  set('otp-modal-sub', `${svc || 'OTP'} — Kode berhasil diterima`);
  const fill = document.getElementById('otp-modal-fill');
  fill.style.animation = 'none';
  fill.offsetHeight;
  fill.style.animation = 'timerFill 300s linear forwards';
  openModal('modalOtp');
}

function copyModalOtp() {
  copyText(document.getElementById('otp-modal-code').textContent);
}

async function saveProfile() {
  const firstName = document.getElementById('pFirst')?.value.trim() || '';
  const lastName = document.getElementById('pLast')?.value.trim() || '';
  const email = document.getElementById('pEmail')?.value.trim() || '';

  saveSession({ firstName, lastName, email });
  showToast('Profil lokal tersimpan. Data akun utama mengikuti login backend.', 'success');
}

async function createTelegramLinkCode() {
  try {
    const result = await apiFetch('/auth/telegram-link/code', { body: {} });
    set('telegramLinkCode', result.code);
    set('telegramLinkHint', `Ketik /linked di bot Telegram, lalu kirim kode ${result.code}. Berlaku sampai ${formatDate(result.expiresAt)}.`);
    showToast('Kode link Telegram berhasil dibuat.', 'success');
  } catch (err) {
    showToast(`Gagal buat kode link: ${err.message}`, 'error');
  }
}

function buildReferralLink() {
  if (!S.referral.code) return '';
  return `${window.location.origin}/register/?ref=${encodeURIComponent(S.referral.code)}`;
}

function copyReferralCode() {
  if (!S.referral.code) {
    showToast('Kode referral belum tersedia.', 'warning');
    return;
  }
  copyText(S.referral.code);
}

function copyReferralLink() {
  const link = buildReferralLink();
  if (!link) {
    showToast('Link referral belum tersedia.', 'warning');
    return;
  }
  copyText(link);
}

function renderReferralPage() {
  const list = document.getElementById('referralInviteList');
  if (!list) return;

  const invites = Array.isArray(S.referral.invites) ? S.referral.invites : [];
  if (!invites.length) {
    list.innerHTML = `<div class="empty"><div class="empty-emoji">🎁</div><div class="empty-title">Belum ada referral</div><div class="empty-desc">Bagikan kode referral Anda untuk mulai mengundang user baru.</div></div>`;
    return;
  }

  list.innerHTML = invites.map((invite) => {
    const status = getReferralInviteStatus(invite);
    const fullName = [invite.firstName, invite.lastName].filter(Boolean).join(' ').trim() || 'User Baru';
    const reward = Number(invite.rewardAmount || 0);
    const qualifiedLabel = invite.qualifiedAt ? `Lolos syarat: ${formatDate(invite.qualifiedAt)}` : 'Belum deposit pertama';
    const rewardLabel = invite.rewardedAt ? `Bonus cair: ${formatDate(invite.rewardedAt)}` : `Bonus: ${FMT(reward)}`;

    return `
      <div class="referral-invite-row">
        <div class="referral-invite-main">
          <div class="referral-invite-name">${esc(fullName)}</div>
          <div class="referral-invite-email">${esc(invite.email || '-')}</div>
          <div class="referral-invite-meta">
            <span>Terdaftar: ${formatDate(invite.createdAt)}</span>
            <span>${qualifiedLabel}</span>
            <span>${rewardLabel}</span>
          </div>
        </div>
        <div class="referral-status-badge ${status.className}">${status.label}</div>
      </div>
    `;
  }).join('');
}

function getReferralInviteStatus(invite) {
  if (invite.rewardedAt) {
    return { label: 'Bonus Masuk', className: 'rewarded' };
  }
  if (invite.qualifiedAt) {
    return { label: 'Menunggu Bonus', className: 'qualified' };
  }
  return { label: 'Belum Deposit', className: 'pending' };
}

function toggleApi() {
  S.api.visible = !S.api.visible;
  set('apiKeyTxt', S.api.visible ? S.api.key : 'nk_live_••••••••••••••••••••••••••••••••');
  set('btnToggleApi', S.api.visible ? '🙈 Sembunyikan' : '👁 Tampil');
}

function copyApiKey() { copyText(S.api.key); }

function doLogout() {
  if (confirm('Yakin mau keluar?')) {
    localStorage.removeItem(STORE_KEYS.session);
    showToast('Sampai jumpa!', 'info');
    setTimeout(() => { window.location.href = '/'; }, 800);
  }
}

document.getElementById('hamburger').addEventListener('click', () => {
  document.getElementById('sidebar').classList.toggle('open');
  document.getElementById('sidebarOv').classList.toggle('open');
});

function closeSidebar() {
  document.getElementById('sidebar').classList.remove('open');
  document.getElementById('sidebarOv').classList.remove('open');
}

function openModal(id) { document.getElementById(id)?.classList.add('open'); }
function closeModal(id) {
  document.getElementById(id)?.classList.remove('open');
  if (id === 'modalTopupOk') {
    stopTopupCountdown();
    stopTopupStatusPolling();
  }
}

document.querySelectorAll('.modal-ov').forEach(o => {
  o.addEventListener('click', e => { if (e.target === o) o.classList.remove('open'); });
});

const ICONS = { success: '✅', error: '❌', warning: '⚠️', info: 'ℹ️' };
function showToast(msg, type = 'info') {
  const wrap = document.getElementById('toastWrap');
  const el = document.createElement('div');
  el.className = `toast ${type}`;
  el.innerHTML = `<span style="font-size:1.15rem;">${ICONS[type]}</span><span>${esc(msg)}</span>`;
  wrap.appendChild(el);
  setTimeout(() => { el.classList.add('hide'); setTimeout(() => el.remove(), 300); }, 3200);
}

function copyText(t) {
  navigator.clipboard.writeText(t)
    .then(() => showToast('Berhasil disalin.', 'success'))
    .catch(() => showToast('Gagal salin. Salin manual.', 'error'));
}

function mapCountries(countries) {
  return countries
    .filter(country => country && country.isActive !== false)
    .map(country => ({
      id: country.id,
      f: flagForCountry(country.name, country.countryCode),
      n: country.name || country.countryCode || 'Negara',
      code: country.countryCode || '-',
      minSellPrice: Number(country.minSellPrice || 0),
      priceId: country.priceId || '',
      priceCount: Number(country.priceCount || 0),
    }))
    .sort((a, b) => a.n.localeCompare(b.n));
}

function orderMeta(order) {
  const service = order.price?.service?.name || 'OTP';
  const cat = inferCategory(service);
  return {
    service,
    country: order.price?.country?.name || 'Global',
    price: Number(order.price?.sellPrice || 0),
    icon: iconForService(service),
    bg: colorForCategory(cat),
  };
}

function inferCategory(name = '') {
  const n = name.toLowerCase();
  if (/(shopee|tokopedia|lazada|bukalapak|amazon|ebay|commerce|market)/.test(n)) return 'ecommerce';
  if (/(gopay|ovo|dana|paypal|bank|finance|wallet|apple|pay|crypto|wise)/.test(n)) return 'financial';
  if (/(steam|discord|game|roblox|garena|pubg|mobile legends|valorant)/.test(n)) return 'gaming';
  if (/(netflix|spotify|youtube|stream|video|music)/.test(n)) return 'streaming';
  return 'social';
}

function iconForService(name = '') {
  const n = name.toLowerCase();
  if (n.includes('whatsapp')) return '📱';
  if (n.includes('telegram')) return '💬';
  if (n.includes('instagram')) return '📸';
  if (n.includes('facebook')) return '📘';
  if (n.includes('tiktok')) return '🎵';
  if (n.includes('google')) return '☁️';
  if (n.includes('shopee')) return '🛒';
  if (n.includes('tokopedia')) return '🛍️';
  if (n.includes('paypal')) return '💙';
  if (n.includes('netflix')) return '🎬';
  if (n.includes('spotify')) return '🎧';
  if (n.includes('discord')) return '🎮';
  return '📲';
}

function colorForCategory(cat) {
  return {
    social: '#DBF4FF',
    ecommerce: '#FFF3D4',
    financial: '#D4FFF0',
    gaming: '#F3D4FF',
    streaming: '#ffe0e0',
  }[cat] || '#DBF4FF';
}

function flagForCountry(name = '', code = '') {
  const n = `${name} ${code}`.toLowerCase();
  if (n.includes('indonesia') || code === '6') return '🇮🇩';
  if (n.includes('united states') || n.includes('amerika')) return '🇺🇸';
  if (n.includes('united kingdom') || n.includes('inggris')) return '🇬🇧';
  if (n.includes('singapore')) return '🇸🇬';
  if (n.includes('malaysia')) return '🇲🇾';
  if (n.includes('philippines')) return '🇵🇭';
  if (n.includes('thailand')) return '🇹🇭';
  if (n.includes('vietnam')) return '🇻🇳';
  if (n.includes('india')) return '🇮🇳';
  if (n.includes('australia')) return '🇦🇺';
  return '🌍';
}

function statusBadge(status = '') {
  const s = status.toUpperCase();
  const map = {
    SUCCESS: ['badge-success', 'Berhasil'],
    ACTIVE: ['badge-waiting anim-pulse', 'Menunggu'],
    PENDING: ['badge-waiting anim-pulse', 'Menunggu'],
    CANCELLED: ['badge-info', 'Refund'],
    FAILED: ['badge-danger', 'Gagal'],
  };
  const [cls, label] = map[s] || ['badge-info', s || 'Status'];
  return `<span class="badge ${cls}"><span class="badge-dot"></span>${label}</span>`;
}

function transactionBadge(type = '') {
  const map = {
    DEPOSIT: ['badge-success', 'Deposit'],
    DEDUCT: ['badge-danger', 'Pembelian'],
    REFUND: ['badge-info', 'Refund'],
    REFERRAL: ['badge-success', 'Referral'],
  };
  const [cls, label] = map[type] || ['badge-info', type || 'Transaksi'];
  return `<span class="badge ${cls}">${label}</span>`;
}

function typeLabel(type = '') {
  return { DEPOSIT: 'Top Up', DEDUCT: 'Pembelian OTP', REFUND: 'Refund', REFERRAL: 'Bonus Referral' }[type] || type;
}

function formatDate(date) {
  if (!date) return '-';
  return new Intl.DateTimeFormat('id-ID', {
    day: '2-digit',
    month: 'short',
    hour: '2-digit',
    minute: '2-digit',
  }).format(new Date(date));
}

function maskPhone(phone = '') {
  if (!phone) return '-';
  return phone.length > 8 ? `${phone.slice(0, 7)}***` : phone;
}

function shortId(id = '') {
  return String(id).slice(-6).toUpperCase() || '-';
}

function emptyBlock(icon, title, desc) {
  return `<div class="empty"><div class="empty-emoji">${icon}</div><div class="empty-title">${esc(title)}</div><div class="empty-desc">${esc(desc)}</div></div>`;
}

function loadingBlock(text) {
  return `<div class="empty"><div class="empty-emoji anim-pulse">⏳</div><div class="empty-title">Memuat</div><div class="empty-desc">${esc(text)}</div></div>`;
}

function emptyInline(text) {
  return `<div style="padding:20px;text-align:center;color:var(--muted);font-weight:800;">${esc(text)}</div>`;
}

function esc(value) {
  return String(value ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#039;');
}

function escAttr(value) {
  return esc(value).replace(/`/g, '&#096;');
}

function jsArg(value) {
  return JSON.stringify(String(value ?? ''))
    .replace(/&/g, '\\u0026')
    .replace(/</g, '\\u003C')
    .replace(/>/g, '\\u003E')
    .replace(/"/g, '&quot;');
}

document.addEventListener('keydown', e => {
  if (e.key === 'Escape') {
    document.querySelectorAll('.modal-ov.open').forEach(m => m.classList.remove('open'));
    closeSidebar();
  }
});

(function init() {
  if (!localStorage.getItem(STORE_KEYS.token)) {
    window.location.href = '/login/';
    return;
  }

  hydrateSessionFromUrl();
  applySession(readSession());
  if (typeof lucide !== 'undefined') lucide.createIcons();
  updateUI();
  renderSvcs();
  initRouter();
  loadDashboardData({ silent: true });
  setTimeout(() => {
    if (!S.user.telegramId) showToast(`Halo ${S.user.name.split(' ')[0]}! Akun web aktif. Tautkan Telegram hanya jika ingin sinkronisasi opsional.`, 'success');
    else showToast(`Halo ${S.user.name.split(' ')[0]}! Akun web dan Telegram sudah tertaut.`, 'success');
  }, 600);
})();

function refreshIcons() {
  if (typeof lucide !== 'undefined') lucide.createIcons();
}
