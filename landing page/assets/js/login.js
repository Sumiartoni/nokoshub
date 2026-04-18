document.addEventListener('DOMContentLoaded', () => {
  if (typeof lucide !== 'undefined') {
    lucide.createIcons();
  }

  const form = document.getElementById('loginForm');
  const email = document.getElementById('email');
  const password = document.getElementById('password');
  const passwordToggle = document.getElementById('passwordToggle');
  const submit = document.getElementById('loginSubmit');
  const googleLoginBtn = document.getElementById('googleLoginBtn');
  const forgotPasswordBtn = document.getElementById('forgotPasswordBtn');
  const registerForm = document.getElementById('registerForm');
  const registerSubmit = document.getElementById('registerSubmit');
  const googleRegisterBtn = document.getElementById('googleRegisterBtn');

  bindPasswordToggle(passwordToggle, password);
  bindPasswordToggle(document.getElementById('registerPasswordToggle'), document.getElementById('registerPassword'));
  bindPasswordToggle(document.getElementById('confirmPasswordToggle'), document.getElementById('confirmPassword'));

  googleLoginBtn?.addEventListener('click', () => {
    showToast('Login Google akan aktif setelah auth web disambungkan.', 'info');
  });

  googleRegisterBtn?.addEventListener('click', () => {
    showToast('Daftar Google akan aktif setelah auth web disambungkan.', 'info');
  });

  forgotPasswordBtn?.addEventListener('click', () => {
    showToast('Reset password akan tersedia saat auth web aktif.', 'info');
  });

  form?.addEventListener('submit', async (event) => {
    event.preventDefault();

    const emailValue = email.value.trim();
    const passwordValue = password.value.trim();
    let valid = true;

    clearError('emailError');
    clearError('passwordError');

    if (!emailValue || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(emailValue)) {
      setError('emailError', 'Masukkan email yang valid.');
      valid = false;
    }

    if (!passwordValue || passwordValue.length < 6) {
      setError('passwordError', 'Password minimal 6 karakter.');
      valid = false;
    }

    if (!valid) return;

    submit.disabled = true;
    submit.innerHTML = '<i data-lucide="loader-circle"></i> Memproses...';
    if (typeof lucide !== 'undefined') lucide.createIcons();

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
      submit.disabled = false;
      submit.innerHTML = '<i data-lucide="arrow-right"></i> Masuk Dashboard';
      if (typeof lucide !== 'undefined') lucide.createIcons();
    }
  });

  registerForm?.addEventListener('submit', async (event) => {
    event.preventDefault();

    const fullName = document.getElementById('fullName');
    const registerEmail = document.getElementById('registerEmail');
    const registerPassword = document.getElementById('registerPassword');
    const confirmPassword = document.getElementById('confirmPassword');
    const terms = document.getElementById('terms');

    const fullNameValue = fullName.value.trim();
    const emailValue = registerEmail.value.trim();
    const passwordValue = registerPassword.value.trim();
    const confirmValue = confirmPassword.value.trim();
    let valid = true;

    ['fullNameError', 'registerEmailError', 'registerPasswordError', 'confirmPasswordError', 'termsError'].forEach(clearError);

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

    if (!terms.checked) {
      setError('termsError', 'Centang persetujuan untuk melanjutkan.');
      valid = false;
    }

    if (!valid) return;

    registerSubmit.disabled = true;
    registerSubmit.innerHTML = '<i data-lucide="loader-circle"></i> Membuat akun...';
    if (typeof lucide !== 'undefined') lucide.createIcons();

    const name = splitName(fullNameValue);

    try {
      const result = await apiFetch('/auth/register', {
        email: emailValue,
        password: passwordValue,
        firstName: name.firstName,
        lastName: name.lastName,
      });
      persistAuth(result);
      showToast('Akun berhasil dibuat. Membuka dashboard...', 'success');
      setTimeout(() => {
        window.location.href = '/user/#/home';
      }, 500);
    } catch (err) {
      setError('registerEmailError', err.message || 'Daftar gagal.');
      showToast(err.message || 'Daftar gagal.', 'error');
      registerSubmit.disabled = false;
      registerSubmit.innerHTML = '<i data-lucide="rocket"></i> Buat Akun';
      if (typeof lucide !== 'undefined') lucide.createIcons();
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
  const response = await fetch(apiUrl(path), {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  const text = await response.text();
  const payload = text ? JSON.parse(text) : {};
  if (!response.ok || payload.success === false) {
    const err = payload.error || payload.message || `HTTP ${response.status}`;
    throw new Error(typeof err === 'string' ? err : JSON.stringify(err));
  }
  return payload.data ?? payload;
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
