const REGISTER_PENDING_KEY = 'nokoshub.register.pending';

document.addEventListener('DOMContentLoaded', () => {
  if (typeof lucide !== 'undefined') {
    lucide.createIcons();
  }

  const form = document.getElementById('verifyOtpForm');
  const otpInput = document.getElementById('verifyOtpCode');
  const submitBtn = document.getElementById('verifyOtpSubmit');
  const resendBtn = document.getElementById('verifyOtpResendBtn');
  const backBtn = document.getElementById('verifyOtpBackBtn');

  const context = getPendingRegistrationContext();
  hydrateVerifyPage(context);

  form?.addEventListener('submit', async (event) => {
    event.preventDefault();
    clearError('verifyOtpCodeError');

    if (!context.email) {
      setError('verifyOtpCodeError', 'Data pendaftaran tidak ditemukan. Silakan ulangi dari halaman daftar.');
      showToast('Data pendaftaran tidak ditemukan.', 'error');
      return;
    }

    const otpCode = String(otpInput?.value || '').replace(/[^\d]/g, '').slice(0, 6);
    if (otpInput) otpInput.value = otpCode;

    if (otpCode.length < 4) {
      setError('verifyOtpCodeError', 'Masukkan kode OTP yang valid.');
      return;
    }

    setButtonBusy(submitBtn, true, '<i data-lucide="loader-circle"></i> Memverifikasi...');

    try {
      const result = await apiFetch('/auth/register/verify', {
        email: context.email,
        otpCode,
      });
      persistAuth(result);
      clearPendingRegistrationContext();
      showToast('Email berhasil diverifikasi. Membuka dashboard...', 'success');
      setTimeout(() => {
        window.location.href = '/user/#/home';
      }, 500);
    } catch (err) {
      setError('verifyOtpCodeError', err.message || 'Verifikasi OTP gagal.');
      showToast(err.message || 'Verifikasi OTP gagal.', 'error');
      setButtonBusy(submitBtn, false, '<i data-lucide="shield-check"></i> Verifikasi & Buat Akun');
    }
  });

  resendBtn?.addEventListener('click', async () => {
    clearError('verifyOtpCodeError');

    if (!context.email) {
      setError('verifyOtpCodeError', 'Email pendaftaran tidak ditemukan. Silakan daftar ulang.');
      return;
    }

    resendBtn.disabled = true;
    resendBtn.textContent = 'Mengirim...';

    try {
      const result = await apiFetch('/auth/register/resend', {
        email: context.email,
      });
      context.maskedEmail = result?.maskedEmail || maskEmail(context.email);
      context.expiresAt = result?.expiresAt || context.expiresAt || null;
      savePendingRegistrationContext(context);
      hydrateVerifyPage(context);
      if (otpInput) otpInput.value = '';
      showToast('OTP baru berhasil dikirim.', 'success');
    } catch (err) {
      setError('verifyOtpCodeError', err.message || 'Gagal mengirim ulang OTP.');
      showToast(err.message || 'Gagal mengirim ulang OTP.', 'error');
    } finally {
      resendBtn.disabled = false;
      resendBtn.textContent = 'Kirim Ulang OTP';
    }
  });

  backBtn?.addEventListener('click', () => {
    window.location.href = context.email
      ? `/register/?email=${encodeURIComponent(context.email)}`
      : '/register/';
  });
});

function hydrateVerifyPage(context) {
  const intro = document.getElementById('verifyOtpIntro');
  const emailLabel = document.getElementById('verifyOtpEmailLabel');
  const footer = document.getElementById('verifyOtpFooter');
  const otpInput = document.getElementById('verifyOtpCode');
  const submitBtn = document.getElementById('verifyOtpSubmit');
  const resendBtn = document.getElementById('verifyOtpResendBtn');

  if (!context.email) {
    if (intro) {
      intro.textContent = 'Data pendaftaran tidak ditemukan di browser ini. Silakan kembali ke halaman daftar dan kirim OTP ulang.';
    }
    if (emailLabel) {
      emailLabel.textContent = 'Data email belum tersedia.';
    }
    if (footer) {
      footer.innerHTML = 'Silakan kembali ke <a href="/register/">halaman daftar</a> untuk mengirim OTP baru.';
    }
    if (otpInput) otpInput.disabled = true;
    if (submitBtn) submitBtn.disabled = true;
    if (resendBtn) resendBtn.disabled = true;
    return;
  }

  const maskedEmail = context.maskedEmail || maskEmail(context.email);
  if (intro) {
    intro.textContent = `Kami sudah mengirim kode OTP ke ${maskedEmail}. Masukkan 6 digit kode untuk mengaktifkan akun NokosHUB.`;
  }
  if (emailLabel) {
    emailLabel.textContent = `Verifikasi email ${maskedEmail}`;
  }
  if (footer) {
    footer.innerHTML = `Jika email salah, kembali ke <a href="/register/?email=${encodeURIComponent(context.email)}">form daftar</a>.`;
  }
}

function getPendingRegistrationContext() {
  const params = new URLSearchParams(window.location.search);
  const emailFromUrl = normalizeEmail(params.get('email') || '');

  try {
    const stored = JSON.parse(localStorage.getItem(REGISTER_PENDING_KEY) || '{}');
    const storedEmail = normalizeEmail(stored.email || '');
    if (storedEmail) {
      return {
        email: storedEmail,
        maskedEmail: stored.maskedEmail || maskEmail(storedEmail),
        expiresAt: stored.expiresAt || null,
      };
    }
  } catch {
    // Ignore invalid storage.
  }

  if (!emailFromUrl) {
    return { email: '', maskedEmail: '', expiresAt: null };
  }

  const context = {
    email: emailFromUrl,
    maskedEmail: maskEmail(emailFromUrl),
    expiresAt: null,
  };
  savePendingRegistrationContext(context);
  return context;
}

function savePendingRegistrationContext(context) {
  localStorage.setItem(REGISTER_PENDING_KEY, JSON.stringify({
    email: normalizeEmail(context.email || ''),
    maskedEmail: context.maskedEmail || '',
    expiresAt: context.expiresAt || null,
    updatedAt: new Date().toISOString(),
  }));
}

function clearPendingRegistrationContext() {
  localStorage.removeItem(REGISTER_PENDING_KEY);
}

function setButtonBusy(button, busy, html) {
  if (!button) return;
  button.disabled = busy;
  if (html) {
    button.innerHTML = html;
  }
  if (typeof lucide !== 'undefined') {
    lucide.createIcons();
  }
}

function persistAuth(result) {
  const token = result?.token;
  const user = result?.user;
  if (!token || !user) throw new Error('Response auth tidak valid.');

  localStorage.removeItem('nokoshub.auth.token');
  saveUserSession({
    email: user.email,
    firstName: user.firstName || '',
    lastName: user.lastName || '',
    telegramId: user.telegramId || '',
  });
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

async function apiFetch(path, body) {
  const response = await fetch(apiUrl(path), {
    method: 'POST',
    credentials: 'include',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  return unwrapApiResponse(response);
}

async function unwrapApiResponse(response) {
  const text = await response.text();
  const payload = text ? JSON.parse(text) : {};
  if (!response.ok || payload.success === false) {
    const err = payload.error || payload.message || `HTTP ${response.status}`;
    throw new Error(typeof err === 'string' ? err : JSON.stringify(err));
  }
  return payload.data ?? payload;
}

function apiUrl(path) {
  const configured = window.NOKOS_API_BASE || localStorage.getItem('nokoshub.api.base');
  if (configured) {
    const trimmed = String(configured).replace(/\/+$/, '');
    const base = trimmed.endsWith('/api') ? trimmed : `${trimmed}/api`;
    return `${base}${path.startsWith('/') ? path : `/${path}`}`;
  }
  if (location.protocol === 'file:') return `http://localhost:3000/api${path}`;
  return `${location.origin}/api${path.startsWith('/') ? path : `/${path}`}`;
}

function normalizeEmail(email) {
  return String(email || '').trim().toLowerCase();
}

function maskEmail(email) {
  const normalized = normalizeEmail(email);
  const [localPart, domain] = normalized.split('@');
  if (!localPart || !domain) return normalized;
  const prefix = localPart.slice(0, Math.min(2, localPart.length));
  return `${prefix}${'*'.repeat(Math.max(2, localPart.length - prefix.length))}@${domain}`;
}

function setError(id, message) {
  const el = document.getElementById(id);
  if (el) el.textContent = message;
}

function clearError(id) {
  const el = document.getElementById(id);
  if (el) el.textContent = '';
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
