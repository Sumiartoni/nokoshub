// ─── NokosHUB Super Admin Auth ──────────────────────────────────────────────
(function () {
    'use strict';

    const SESSION_KEY = 'nokoshub_backoffice_active';

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
        const res = await fetch(path, {
            credentials: 'same-origin',
            ...options,
            headers: {
                'Content-Type': 'application/json',
                ...(options.headers || {}),
            },
        });
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
            const error = new Error(data.error || 'Request failed');
            error.status = res.status;
            throw error;
        }
        return data;
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
