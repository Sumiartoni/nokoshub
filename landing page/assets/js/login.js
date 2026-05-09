const REGISTER_PENDING_KEY = 'nokoshub.register.pending';
const REGISTER_VERIFY_PATH = '/register/verify/';
const AUTH_TIMEOUT_MS = 45000;
const RETRYABLE_STATUS = new Set([408, 425, 429, 500, 502, 503, 504]);

document.addEventListener('DOMContentLoaded', async () => {
  if (typeof lucide !== 'undefined') {
    lucide.createIcons();
  }

  const loginForm = document.getElementById('loginForm');
  const registerForm = document.getElementById('registerForm');
  const loginSubmit = document.getElementById('loginSubmit');
  const registerSubmit = document.getElementById('registerSubmit');
  const googleLoginBtn = document.getElementById('googleLoginBtn');
  const googleLoginHint = document.getElementById('googleLoginHint');
  const googleRegisterBtn = document.getElementById('googleRegisterBtn');
  const googleRegisterHint = document.getElementById('googleRegisterHint');

  const registerSecurity = {
    turnstileEnabled: false,
    turnstileSiteKey: '',
    turnstileWidgetId: null,
    turnstileToken: '',
  };

  bindPasswordToggle(document.getElementById('passwordToggle'), document.getElementById('password'));
  bindPasswordToggle(document.getElementById('registerPasswordToggle'), document.getElementById('registerPassword'));
  bindPasswordToggle(document.getElementById('confirmPasswordToggle'), document.getElementById('confirmPassword'));

  if (registerForm) {
    hydrateRegisterFormFromUrl();
    await initRegisterSecurity(registerSecurity);
  }

  initGoogleAuth({
    buttonSlot: googleLoginBtn || googleRegisterBtn,
    hint: googleLoginHint || googleRegisterHint,
    submit: loginSubmit,
    registerSubmit,
    mode: registerForm ? 'register' : 'login',
    getRegisterPayload: () => getRegisterAuxPayload(registerSecurity),
    onRegisterPending: handleRegisterPending,
    onRegisterFailure: () => resetTurnstileWidget(registerSecurity),
  });

  document.getElementById('forgotPasswordBtn')?.addEventListener('click', () => {
    showToast('Reset password akan tersedia saat auth web aktif.', 'info');
  });

  loginForm?.addEventListener('submit', async (event) => {
    event.preventDefault();
    clearError('emailError');
    clearError('passwordError');

    const emailValue = document.getElementById('email')?.value.trim() || '';
    const passwordValue = document.getElementById('password')?.value.trim() || '';
    let valid = true;

    if (!emailValue || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(emailValue)) {
      setError('emailError', 'Masukkan email yang valid.');
      valid = false;
    }

    if (!passwordValue || passwordValue.length < 6) {
      setError('passwordError', 'Password minimal 6 karakter.');
      valid = false;
    }

    if (!valid) return;

    setAuthSubmitState(loginSubmit, true, 'Memproses...');

    try {
      const result = await apiFetch('/auth/login', {
        email: emailValue,
        password: passwordValue,
      });
      persistAuth(result);
      showToast('Login berhasil. Membuka dashboard...', 'success');
      setTimeout(() => {
        window.location.href = '/user/#/home';
      }, 500);
    } catch (err) {
      setError('passwordError', err.message || 'Login gagal.');
      showToast(err.message || 'Login gagal.', 'error');
      setAuthSubmitState(loginSubmit, false);
    }
  });

  registerForm?.addEventListener('submit', async (event) => {
    event.preventDefault();

    const registerData = collectRegisterFormData(registerSecurity);
    if (!registerData) return;

    setAuthSubmitState(registerSubmit, true, 'Mengirim OTP...');

    try {
      const result = await apiFetch('/auth/register', registerData);
      handleRegisterPending(result, registerData.email);
      showToast('OTP sudah dikirim ke email Anda.', 'success');
    } catch (err) {
      handleRegisterError(err, registerSecurity);
      setAuthSubmitState(registerSubmit, false);
    }
  });
});

function bindPasswordToggle(button, input) {
  button?.addEventListener('click', () => {
    if (!input) return;
    const visible = input.type === 'text';
    input.type = visible ? 'password' : 'text';
    button.setAttribute('aria-label', visible ? 'Tampilkan password' : 'Sembunyikan password');
    button.innerHTML = visible ? '<i data-lucide="eye"></i>' : '<i data-lucide="eye-off"></i>';
    if (typeof lucide !== 'undefined') lucide.createIcons();
  });
}

function hydrateRegisterFormFromUrl() {
  const params = new URLSearchParams(window.location.search);
  const referralCode = normalizeReferralCode(params.get('ref') || params.get('referral') || '');
  const email = String(params.get('email') || '').trim().toLowerCase();

  const referralInput = document.getElementById('referralCode');
  if (referralInput && referralCode && !referralInput.value.trim()) {
    referralInput.value = referralCode;
  }

  const emailInput = document.getElementById('registerEmail');
  if (emailInput && email && !emailInput.value.trim()) {
    emailInput.value = email;
  }
}

async function initRegisterSecurity(state) {
  const wrap = document.getElementById('registerTurnstileWrap');
  const box = document.getElementById('registerTurnstileBox');

  if (!wrap || !box) return;

  try {
    const config = await apiGet('/auth/register/config');
    const turnstile = config?.turnstile || {};
    if (!turnstile.enabled || !turnstile.siteKey) {
      wrap.hidden = true;
      return;
    }

    state.turnstileEnabled = true;
    state.turnstileSiteKey = turnstile.siteKey;
    wrap.hidden = false;

    await loadTurnstileScript();
    if (!window.turnstile?.render) {
      throw new Error('Widget keamanan gagal dimuat.');
    }

    state.turnstileWidgetId = window.turnstile.render(box, {
      sitekey: state.turnstileSiteKey,
      callback(token) {
        state.turnstileToken = token || '';
        clearError('registerTurnstileError');
      },
      'expired-callback'() {
        state.turnstileToken = '';
        setError('registerTurnstileError', 'Captcha kedaluwarsa. Silakan verifikasi ulang.');
      },
      'error-callback'() {
        state.turnstileToken = '';
        setError('registerTurnstileError', 'Captcha gagal dimuat. Muat ulang halaman lalu coba lagi.');
      },
    });
  } catch (err) {
    wrap.hidden = false;
    setError('registerTurnstileError', err.message || 'Verifikasi keamanan belum siap.');
  }
}

function collectRegisterFormData(state) {
  ['fullNameError', 'registerEmailError', 'registerPasswordError', 'confirmPasswordError', 'referralCodeError', 'termsError', 'registerTurnstileError'].forEach(clearError);

  const fullNameValue = document.getElementById('fullName')?.value.trim() || '';
  const emailValue = document.getElementById('registerEmail')?.value.trim() || '';
  const passwordValue = document.getElementById('registerPassword')?.value.trim() || '';
  const confirmValue = document.getElementById('confirmPassword')?.value.trim() || '';
  const referralCodeValue = normalizeReferralCode(document.getElementById('referralCode')?.value || '');
  const termsChecked = Boolean(document.getElementById('terms')?.checked);
  const turnstileToken = getTurnstileTokenOrShowError(state);
  let valid = true;

  if (fullNameValue.length < 3) {
    setError('fullNameError', 'Nama minimal 3 karakter.');
    valid = false;
  }

  if (!emailValue || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(emailValue)) {
    setError('registerEmailError', 'Masukkan email yang valid.');
    valid = false;
  }

  if (!isStrongEnoughPassword(passwordValue)) {
    setError('registerPasswordError', 'Gunakan minimal 8 karakter dengan huruf dan angka.');
    valid = false;
  }

  if (confirmValue !== passwordValue) {
    setError('confirmPasswordError', 'Konfirmasi password belum sama.');
    valid = false;
  }

  if (!termsChecked) {
    setError('termsError', 'Centang persetujuan untuk melanjutkan.');
    valid = false;
  }

  if (referralCodeValue && referralCodeValue.length < 4) {
    setError('referralCodeError', 'Kode referral terlihat terlalu pendek.');
    valid = false;
  }

  if (state.turnstileEnabled && !turnstileToken) {
    valid = false;
  }

  if (!valid) return null;

  const name = splitName(fullNameValue);
  return {
    email: emailValue.toLowerCase(),
    password: passwordValue,
    firstName: name.firstName,
    lastName: name.lastName,
    referralCode: referralCodeValue || undefined,
    turnstileToken: turnstileToken || undefined,
  };
}

function getRegisterAuxPayload(state) {
  clearError('termsError');
  clearError('referralCodeError');
  clearError('registerTurnstileError');

  if (!document.getElementById('terms')?.checked) {
    setError('termsError', 'Centang persetujuan untuk melanjutkan.');
    throw new Error('Setujui syarat layanan terlebih dahulu.');
  }

  const referralCode = normalizeReferralCode(document.getElementById('referralCode')?.value || '');
  if (referralCode && referralCode.length < 4) {
    setError('referralCodeError', 'Kode referral terlihat terlalu pendek.');
    throw new Error('Kode referral belum valid.');
  }

  const turnstileToken = getTurnstileTokenOrShowError(state);
  if (state.turnstileEnabled && !turnstileToken) {
    throw new Error('Selesaikan verifikasi keamanan terlebih dahulu.');
  }

  return {
    referralCode: referralCode || undefined,
    turnstileToken: turnstileToken || undefined,
  };
}

function getTurnstileTokenOrShowError(state) {
  if (!state.turnstileEnabled) return '';
  if (state.turnstileToken) return state.turnstileToken;
  setError('registerTurnstileError', 'Selesaikan verifikasi keamanan terlebih dahulu.');
  return '';
}

function handleRegisterPending(result, fallbackEmail) {
  const email = String(result?.email || fallbackEmail || '').trim().toLowerCase();
  const maskedEmail = result?.maskedEmail || maskEmail(email);

  localStorage.setItem(REGISTER_PENDING_KEY, JSON.stringify({
    email,
    maskedEmail,
    expiresAt: result?.expiresAt || null,
    updatedAt: new Date().toISOString(),
  }));

  const target = `${REGISTER_VERIFY_PATH}?email=${encodeURIComponent(email)}`;
  setTimeout(() => {
    window.location.href = target;
  }, 350);
}

function handleRegisterError(err, state) {
  const message = err.message || 'Daftar gagal.';
  applyRegisterErrorMessage(message);
  showToast(message, 'error');
  resetTurnstileWidget(state);
}

function applyRegisterErrorMessage(message) {
  if (/referral/i.test(message)) {
    setError('referralCodeError', message);
  } else if (/captcha|verifikasi keamanan/i.test(message)) {
    setError('registerTurnstileError', message);
  } else {
    setError('registerEmailError', message);
  }
}

function setError(id, message) {
  const el = document.getElementById(id);
  if (el) el.textContent = message;
}

function clearError(id) {
  const el = document.getElementById(id);
  if (el) el.textContent = '';
}

function isStrongEnoughPassword(value) {
  return value.length >= 8 && /[A-Za-z]/.test(value) && /\d/.test(value);
}

function saveUserSession(partial) {
  const key = 'nokoshub.user.session';
  let current = {};
  try {
    current = JSON.parse(localStorage.getItem(key) || '{}');
  } catch {
    current = {};
  }
  localStorage.setItem(key, JSON.stringify({ ...current, ...partial }));
}

function splitName(value) {
  const parts = value.trim().split(/\s+/).filter(Boolean);
  return {
    firstName: parts.shift() || 'User',
    lastName: parts.join(' '),
  };
}

function persistAuth(result) {
  const token = result?.token;
  const user = result?.user;
  if (!token || !user) throw new Error('Response auth tidak valid.');

  localStorage.setItem('nokoshub.auth.token', token);
  saveUserSession({
    email: user.email,
    firstName: user.firstName || '',
    lastName: user.lastName || '',
    telegramId: user.telegramId || '',
  });
}

async function apiFetch(path, body) {
  const response = await fetchWithRetry(apiUrl(path), {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  }, AUTH_TIMEOUT_MS);
  return unwrapApiResponse(response);
}

async function apiGet(path) {
  const response = await fetchWithRetry(apiUrl(path), {
    method: 'GET',
    headers: { Accept: 'application/json' },
  }, AUTH_TIMEOUT_MS);
  return unwrapApiResponse(response);
}

async function fetchWithRetry(url, options, timeoutMs) {
  let lastError;

  for (let attempt = 1; attempt <= 3; attempt += 1) {
    const controller = new AbortController();
    const timer = window.setTimeout(() => controller.abort(), timeoutMs);

    try {
      const response = await fetch(url, {
        ...options,
        signal: controller.signal,
      });
      window.clearTimeout(timer);

      if (RETRYABLE_STATUS.has(response.status) && attempt < 3) {
        await sleep(attempt * 1200);
        continue;
      }

      return response;
    } catch (err) {
      window.clearTimeout(timer);
      lastError = err;
      if (!isRetryableError(err) || attempt >= 3) {
        throw new Error(humanizeAuthError(err?.message || 'Gagal terhubung ke server'));
      }
      await sleep(attempt * 1200);
    }
  }

  throw new Error(humanizeAuthError(lastError?.message || 'Gagal terhubung ke server'));
}

async function unwrapApiResponse(response) {
  const text = await response.text();
  let payload;
  try {
    payload = text ? JSON.parse(text) : {};
  } catch {
    const compact = String(text || '')
      .replace(/\s+/g, ' ')
      .trim()
      .slice(0, 180);
    payload = {
      success: false,
      error: compact
        ? `Invalid response (${response.status}): ${compact}`
        : `Invalid response (${response.status})`,
    };
  }
  if (!response.ok || payload.success === false) {
    const err = payload.error || payload.message || `HTTP ${response.status}`;
    throw new Error(humanizeAuthError(typeof err === 'string' ? err : JSON.stringify(err)));
  }
  return payload.data ?? payload;
}

async function initGoogleAuth({ buttonSlot, hint, submit, registerSubmit, mode, getRegisterPayload, onRegisterPending, onRegisterFailure }) {
  if (!buttonSlot || !hint) return;

  try {
    const config = await apiGet('/auth/google/config');
    if (!config?.enabled || !config?.clientId) {
      hint.textContent = 'Login Google belum tersedia saat ini.';
      hint.classList.add('is-error');
      buttonSlot.replaceChildren();
      return;
    }

    await loadGoogleIdentityScript();
    if (!window.google?.accounts?.id) {
      throw new Error('Google Identity Services gagal dimuat.');
    }

    window.google.accounts.id.initialize({
      client_id: config.clientId,
      callback: async (response) => {
        const currentSubmit = mode === 'register' ? registerSubmit : submit;
        hint.classList.remove('is-error');
        hint.textContent = hint.dataset.defaultText || hint.textContent;
        setAuthSubmitState(currentSubmit, true, mode === 'register' ? 'Menyiapkan OTP Google...' : 'Memproses Google...');
        setGoogleBusy(buttonSlot, hint, true);

        try {
          if (mode === 'register') {
            const registerPayload = typeof getRegisterPayload === 'function'
              ? getRegisterPayload()
              : {};
            const result = await apiFetch('/auth/google/register', {
              credential: response.credential,
              referralCode: registerPayload.referralCode,
              turnstileToken: registerPayload.turnstileToken,
            });
            onRegisterPending?.(result, result?.email);
            showToast('OTP Google sudah dikirim ke email Anda.', 'success');
            return;
          }

          const result = await apiFetch('/auth/google', {
            credential: response.credential,
          });
          persistAuth(result);
          showToast('Login Google berhasil.', 'success');
          setTimeout(() => {
            window.location.href = '/user/#/home';
          }, 500);
        } catch (err) {
          if (mode === 'register') {
            applyRegisterErrorMessage(err.message || 'Daftar Google gagal.');
          }
          hint.textContent = err.message || 'Login Google gagal.';
          hint.classList.add('is-error');
          showToast(err.message || (mode === 'register' ? 'Daftar Google gagal.' : 'Login Google gagal.'), 'error');
          setAuthSubmitState(currentSubmit, false);
          setGoogleBusy(buttonSlot, hint, false);
          onRegisterFailure?.();
        }
      },
      auto_select: false,
      cancel_on_tap_outside: true,
    });

    window.google.accounts.id.renderButton(buttonSlot, {
      type: 'standard',
      theme: 'outline',
      size: 'large',
      shape: 'pill',
      text: mode === 'register' ? 'signup_with' : 'signin_with',
      width: Math.max(buttonSlot.clientWidth || 320, 280),
      logo_alignment: 'left',
    });

    hint.textContent = mode === 'register'
      ? 'Daftar cepat dengan akun Google Anda.'
      : 'Masuk cepat dengan akun Google Anda.';
    hint.dataset.defaultText = hint.textContent;
    hint.classList.remove('is-error');
  } catch (err) {
    buttonSlot.replaceChildren();
    hint.textContent = err.message || 'Google login belum bisa dipakai.';
    hint.classList.add('is-error');
  }
}

function setGoogleBusy(buttonSlot, hint, busy) {
  buttonSlot.style.opacity = busy ? '0.7' : '1';
  buttonSlot.style.pointerEvents = busy ? 'none' : 'auto';
  if (!busy && hint && !hint.classList.contains('is-error')) {
    hint.textContent = hint.dataset.defaultText || 'Masuk cepat dengan akun Google Anda.';
  }
}

function setAuthSubmitState(button, busy, label) {
  if (!button) return;

  button.disabled = busy;
  if (busy) {
    button.innerHTML = `<i data-lucide="loader-circle"></i> ${label}`;
  } else if (button.id === 'registerSubmit') {
    button.innerHTML = '<i data-lucide="rocket"></i> Buat Akun';
  } else {
    button.innerHTML = '<i data-lucide="arrow-right"></i> Masuk Dashboard';
  }

  if (typeof lucide !== 'undefined') lucide.createIcons();
}

function resetTurnstileWidget(state) {
  if (!state.turnstileEnabled) return;
  state.turnstileToken = '';
  if (window.turnstile?.reset && state.turnstileWidgetId !== null && state.turnstileWidgetId !== undefined) {
    window.turnstile.reset(state.turnstileWidgetId);
  }
}

function loadGoogleIdentityScript() {
  if (window.google?.accounts?.id) {
    return Promise.resolve();
  }

  if (window.__nokosGoogleScriptPromise) {
    return window.__nokosGoogleScriptPromise;
  }

  window.__nokosGoogleScriptPromise = new Promise((resolve, reject) => {
    const script = document.createElement('script');
    script.src = 'https://accounts.google.com/gsi/client';
    script.async = true;
    script.defer = true;
    script.onload = () => resolve();
    script.onerror = () => reject(new Error('Script Google gagal dimuat.'));
    document.head.appendChild(script);
  });

  return window.__nokosGoogleScriptPromise;
}

function loadTurnstileScript() {
  if (window.turnstile?.render) {
    return Promise.resolve();
  }

  if (window.__nokosTurnstileScriptPromise) {
    return window.__nokosTurnstileScriptPromise;
  }

  window.__nokosTurnstileScriptPromise = new Promise((resolve, reject) => {
    const script = document.createElement('script');
    script.src = 'https://challenges.cloudflare.com/turnstile/v0/api.js?render=explicit';
    script.async = true;
    script.defer = true;
    script.onload = () => resolve();
    script.onerror = () => reject(new Error('Script keamanan Cloudflare gagal dimuat.'));
    document.head.appendChild(script);
  });

  return window.__nokosTurnstileScriptPromise;
}

function apiUrl(path) {
  const base = detectApiBase();
  return `${base}${path.startsWith('/') ? path : `/${path}`}`;
}

function detectApiBase() {
  const configured = window.NOKOS_API_BASE || localStorage.getItem('nokoshub.api.base');
  if (configured) {
    const trimmed = String(configured).replace(/\/+$/, '');
    return trimmed.endsWith('/api') ? trimmed : `${trimmed}/api`;
  }
  if (location.protocol === 'file:') return 'http://localhost:3000/api';
  const isLocalHost = ['localhost', '127.0.0.1', '::1'].includes(location.hostname);
  if (isLocalHost && location.protocol === 'http:' && location.port && location.port !== '3000') {
    return `${location.protocol}//${location.hostname}:3000/api`;
  }
  return `${location.origin}/api`;
}

function showToast(message, type = 'info') {
  const toast = document.getElementById('loginToast');
  if (!toast) return;

  toast.className = `login-toast show ${type}`;
  toast.textContent = message;

  clearTimeout(showToast.timer);
  showToast.timer = setTimeout(() => {
    toast.classList.remove('show');
  }, 2600);
}

function normalizeReferralCode(value) {
  return String(value || '')
    .trim()
    .toUpperCase()
    .replace(/[^A-Z0-9]/g, '');
}

function humanizeAuthError(message) {
  const text = String(message || '');
  const upper = text.toUpperCase();
  if (
    upper.includes('EAI_AGAIN') ||
    upper.includes('ECONNREFUSED') ||
    upper.includes('ETIMEDOUT') ||
    upper.includes('NETWORKERROR') ||
    upper.includes('ABORTERROR') ||
    upper.includes('SELF-SIGNED CERTIFICATE') ||
    upper.includes('KONEKSI DATABASE SEDANG GANGGUAN')
  ) {
    return 'Koneksi server sedang gangguan. Silakan coba lagi beberapa saat.';
  }
  return text;
}

function isRetryableError(err) {
  const name = String(err?.name || '');
  const message = String(err?.message || '').toUpperCase();
  return name === 'AbortError' || message.includes('NETWORK') || message.includes('FAILED TO FETCH') || message.includes('LOAD FAILED');
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function maskEmail(email) {
  const normalized = String(email || '').trim().toLowerCase();
  const [localPart, domain] = normalized.split('@');
  if (!localPart || !domain) return normalized;
  const prefix = localPart.slice(0, Math.min(2, localPart.length));
  return `${prefix}${'*'.repeat(Math.max(2, localPart.length - prefix.length))}@${domain}`;
}
