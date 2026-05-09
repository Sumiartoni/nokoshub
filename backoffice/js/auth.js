// ─── NokosHUB Super Admin Auth ──────────────────────────────────────────────
(function () {
    'use strict';

    const SESSION_KEY = 'nokoshub_backoffice_active';
    const API_TIMEOUT_MS = 45000;
    const RETRYABLE_STATUS = new Set([408, 425, 429, 500, 502, 503, 504]);

    const isLoginPage = window.location.pathname.endsWith('index.html')
        || window.location.pathname === '/'
        || window.location.pathname.endsWith('/');

    if (isLoginPage) {
        checkExistingSession();
    }

    const form = document.getElementById('loginForm');
    if (form) {
        form.addEventListener('submit', handleLogin);
    }

    async function checkExistingSession() {
        try {
            const data = await rawApi('/api/backoffice/me');
            if (data.authenticated) {
                markSession(data.user);
                window.location.href = 'dashboard.html';
            }
        } catch {
            clearSession();
        }
    }

    async function handleLogin(e) {
        e.preventDefault();

        const username = document.getElementById('username').value.trim();
        const password = document.getElementById('password').value;

        if (!username || !password) {
            showError('Harap isi username dan password');
            return;
        }

        setLoading(true);

        try {
            const data = await rawApi('/api/backoffice/login', {
                method: 'POST',
                body: JSON.stringify({ username, password }),
            });

            if (!data.success) {
                throw new Error(data.error || 'Login tidak valid');
            }

            markSession({ username });
            window.location.href = 'dashboard.html';
        } catch (err) {
            showError(err.message || 'Gagal terhubung ke server');
        } finally {
            setLoading(false);
        }
    }

    async function rawApi(path, options = {}) {
        const { timeoutMs = API_TIMEOUT_MS, ...restOptions } = options;
        const res = await fetchWithRetry(path, {
            credentials: 'same-origin',
            ...restOptions,
            headers: {
                'Content-Type': 'application/json',
                ...(restOptions.headers || {}),
            },
        }, timeoutMs);
        const text = await res.text();
        let data;
        try {
            data = text ? JSON.parse(text) : {};
        } catch {
            const compact = String(text || '')
                .replace(/\s+/g, ' ')
                .trim()
                .slice(0, 160);
            data = {
                success: false,
                error: compact
                    ? `Invalid response (${res.status}): ${compact}`
                    : `Invalid response (${res.status})`,
            };
        }
        if (!res.ok || data.success === false) {
            const error = new Error(humanizeAuthError(data.error || 'Request failed'));
            error.status = res.status;
            throw error;
        }
        return data;
    }

    async function fetchWithRetry(path, options, timeoutMs) {
        let lastError;

        for (let attempt = 1; attempt <= 3; attempt += 1) {
            const controller = new AbortController();
            const timer = window.setTimeout(() => controller.abort(), timeoutMs);

            try {
                const response = await fetch(path, {
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

    function showError(msg) {
        const box = document.getElementById('errorBox');
        const msgEl = document.getElementById('errorMsg');
        if (box && msgEl) {
            msgEl.textContent = msg;
            box.style.display = 'flex';
            box.style.animation = 'none';
            void box.offsetHeight;
            box.style.animation = 'shake 0.4s ease';
        }
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
            return 'Koneksi server sedang sibuk atau lambat. Coba lagi beberapa saat.';
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

    function setLoading(loading) {
        const btn = document.getElementById('loginBtn');
        const text = btn?.querySelector('.btn-text');
        const loader = document.getElementById('btnLoader');
        const arrow = btn?.querySelector('.btn-arrow');

        if (loading) {
            btn.disabled = true;
            if (text) text.style.display = 'none';
            if (loader) loader.style.display = 'inline-flex';
            if (arrow) arrow.style.display = 'none';
        } else {
            btn.disabled = false;
            if (text) text.style.display = 'inline';
            if (loader) loader.style.display = 'none';
            if (arrow) arrow.style.display = 'block';
        }
    }

    function markSession(user) {
        localStorage.setItem(SESSION_KEY, JSON.stringify({
            apiBaseUrl: window.location.origin,
            username: user?.username || 'admin',
            loginAt: Date.now(),
        }));
    }

    function clearSession() {
        localStorage.removeItem(SESSION_KEY);
    }

    function getSession() {
        try {
            const raw = localStorage.getItem(SESSION_KEY);
            if (!raw) {
                return {
                    apiBaseUrl: window.location.origin,
                    username: 'admin',
                    loginAt: 0,
                };
            }
            return JSON.parse(raw);
        } catch {
            return {
                apiBaseUrl: window.location.origin,
                username: 'admin',
                loginAt: 0,
            };
        }
    }

    window.NokosAuth = {
        getSession,
        async logout() {
            await rawApi('/api/backoffice/logout', { method: 'POST', body: '{}' }).catch(() => {});
            clearSession();
            window.location.href = 'index.html';
        },
        requireAuth() {
            return getSession();
        },
        async apiFetch(path, options = {}) {
            try {
                return await rawApi(path, options);
            } catch (err) {
                if (err.status === 401 || err.status === 403) {
                    clearSession();
                    window.location.href = 'index.html';
                }
                throw err;
            }
        },
    };
})();
