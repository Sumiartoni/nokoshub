(function () {
    const formatIdr = (value) => new Intl.NumberFormat('id-ID', {
        style: 'currency',
        currency: 'IDR',
        maximumFractionDigits: 0,
    }).format(Number(value || 0));

    const escapeHtml = (value) => String(value ?? '').replace(/[&<>"']/g, (char) => ({
        '&': '&amp;',
        '<': '&lt;',
        '>': '&gt;',
        '"': '&quot;',
        "'": '&#39;',
    }[char]));

    async function api(path, options = {}) {
        const response = await fetch(path, {
            credentials: 'same-origin',
            headers: {
                'Content-Type': 'application/json',
                ...(options.headers || {}),
            },
            ...options,
        });
        const data = await response.json().catch(() => ({ success: false, error: 'Invalid response' }));
        if (!response.ok || data.success === false) {
            const error = new Error(data.error || 'Request failed');
            error.status = response.status;
            throw error;
        }
        return data;
    }

    function initLogin() {
        const form = document.getElementById('loginForm');
        if (!form) return;

        const errorBox = document.getElementById('loginError');
        const button = form.querySelector('button[type="submit"]');

        form.addEventListener('submit', async (event) => {
            event.preventDefault();
            errorBox.textContent = '';
            button.disabled = true;
            button.textContent = 'Memproses...';

            try {
                await api('/api/backoffice/login', {
                    method: 'POST',
                    body: JSON.stringify({
                        username: form.username.value.trim(),
                        password: form.password.value,
                    }),
                });
                window.location.href = '/backoffice';
            } catch (error) {
                errorBox.textContent = error.message || 'Login gagal';
            } finally {
                button.disabled = false;
                button.textContent = 'Masuk';
            }
        });
    }

    function initDashboard() {
        const content = document.getElementById('content');
        if (!content) return;

        const state = {
            active: 'orders',
            orders: [],
            invoices: [],
            transactions: [],
        };

        const elements = {
            adminName: document.getElementById('adminName'),
            providerBalance: document.getElementById('providerBalance'),
            ordersCount: document.getElementById('ordersCount'),
            invoicesCount: document.getElementById('invoicesCount'),
            transactionsCount: document.getElementById('transactionsCount'),
            panelTitle: document.getElementById('panelTitle'),
            message: document.getElementById('message'),
            balanceForm: document.getElementById('balanceForm'),
        };

        const setMessage = (text) => {
            elements.message.textContent = text || '';
        };

        const authRedirect = (error) => {
            if (error && (error.status === 401 || error.status === 403)) {
                window.location.href = '/backoffice/login';
                return true;
            }
            return false;
        };

        async function loadMe() {
            const data = await api('/api/backoffice/me');
            if (!data.authenticated) {
                window.location.href = '/backoffice/login';
                return;
            }
            elements.adminName.textContent = data.user?.username || 'admin';
        }

        async function loadBalance() {
            const data = await api('/api/admin/balance');
            elements.providerBalance.textContent = formatIdr(data.data.providerBalance);
        }

        async function loadOrders() {
            const data = await api('/api/admin/orders?limit=50');
            state.orders = data.data || [];
            elements.ordersCount.textContent = state.orders.length;
        }

        async function loadInvoices() {
            const data = await api('/api/admin/invoices?limit=50');
            state.invoices = data.data || [];
            elements.invoicesCount.textContent = state.invoices.length;
        }

        async function loadTransactions() {
            const data = await api('/api/admin/transactions?limit=50');
            state.transactions = data.data || [];
            elements.transactionsCount.textContent = state.transactions.length;
        }

        async function loadAll() {
            setMessage('Loading...');
            try {
                await loadMe();
                await Promise.all([loadBalance(), loadOrders(), loadInvoices(), loadTransactions()]);
                render();
                setMessage('Updated');
            } catch (error) {
                if (!authRedirect(error)) setMessage(error.message);
            }
        }

        function buildTable(headers, rows) {
            if (!rows.length) {
                content.innerHTML = '<div class="empty-state">Belum ada data.</div>';
                return;
            }

            content.innerHTML = `
                <table>
                    <thead><tr>${headers.map((header) => `<th>${header}</th>`).join('')}</tr></thead>
                    <tbody>${rows.join('')}</tbody>
                </table>
            `;
        }

        function renderOrders() {
            buildTable(['ID', 'User', 'Service', 'Number', 'Status', 'OTP', 'Created'], state.orders.map((order) => `
                <tr>
                    <td><code>${escapeHtml(order.id)}</code></td>
                    <td>${escapeHtml(order.user?.telegramId)}</td>
                    <td>${escapeHtml(order.price?.service?.name)}<br><span class="muted">${escapeHtml(order.price?.country?.name)}</span></td>
                    <td>${escapeHtml(order.phoneNumber || '-')}</td>
                    <td><span class="status">${escapeHtml(order.status)}</span></td>
                    <td>${escapeHtml(order.otpCode || '-')}</td>
                    <td>${escapeHtml(new Date(order.createdAt).toLocaleString('id-ID'))}</td>
                </tr>
            `));
        }

        function renderInvoices() {
            buildTable(['ID', 'User', 'Amount', 'Base', 'Status', 'Created'], state.invoices.map((invoice) => `
                <tr>
                    <td><code>${escapeHtml(invoice.id)}</code></td>
                    <td>${escapeHtml(invoice.user?.telegramId)}</td>
                    <td>${formatIdr(invoice.amount)}</td>
                    <td>${formatIdr(invoice.baseAmount || invoice.amount)}</td>
                    <td><span class="status">${escapeHtml(invoice.status)}</span></td>
                    <td>${escapeHtml(new Date(invoice.createdAt).toLocaleString('id-ID'))}</td>
                </tr>
            `));
        }

        function renderTransactions() {
            buildTable(['ID', 'User', 'Type', 'Amount', 'Description', 'Created'], state.transactions.map((transaction) => `
                <tr>
                    <td><code>${escapeHtml(transaction.id)}</code></td>
                    <td>${escapeHtml(transaction.user?.telegramId)}</td>
                    <td><span class="status">${escapeHtml(transaction.type)}</span></td>
                    <td>${formatIdr(transaction.amount)}</td>
                    <td>${escapeHtml(transaction.description || '-')}</td>
                    <td>${escapeHtml(new Date(transaction.createdAt).toLocaleString('id-ID'))}</td>
                </tr>
            `));
        }

        function render() {
            if (state.active === 'orders') return renderOrders();
            if (state.active === 'invoices') return renderInvoices();
            if (state.active === 'transactions') return renderTransactions();
            content.innerHTML = '<div class="empty-state">Masukkan Telegram ID dan nominal untuk menambah saldo manual.</div>';
        }

        function showTab(tabName) {
            state.active = tabName;
            document.querySelectorAll('.tab').forEach((button) => {
                button.classList.toggle('active', button.dataset.tab === tabName);
            });
            elements.balanceForm.hidden = tabName !== 'balance';
            elements.panelTitle.textContent = {
                orders: 'Orders',
                invoices: 'Invoices',
                transactions: 'Transactions',
                balance: 'User Balance',
            }[tabName];
            render();
        }

        async function syncProvider() {
            setMessage('Sync started...');
            try {
                const data = await api('/api/admin/sync', { method: 'POST', body: '{}' });
                setMessage(data.message || 'Sync started');
            } catch (error) {
                if (!authRedirect(error)) setMessage(error.message);
            }
        }

        async function logout() {
            await api('/api/backoffice/logout', { method: 'POST', body: '{}' }).catch(() => {});
            window.location.href = '/backoffice/login';
        }

        elements.balanceForm.addEventListener('submit', async (event) => {
            event.preventDefault();
            const form = event.currentTarget;
            const body = {
                telegramId: form.telegramId.value.trim(),
                amount: Number(form.amount.value),
                type: form.balanceType.value,
                description: form.description.value.trim(),
            };

            try {
                await api('/api/admin/user-balance', { method: 'PATCH', body: JSON.stringify(body) });
                setMessage('Balance updated');
                form.reset();
                await loadTransactions();
                showTab('transactions');
            } catch (error) {
                if (!authRedirect(error)) setMessage(error.message);
            }
        });

        document.querySelectorAll('.tab').forEach((button) => {
            button.addEventListener('click', () => showTab(button.dataset.tab));
        });

        document.querySelector('[data-action="sync"]').addEventListener('click', syncProvider);
        document.querySelector('[data-action="refresh"]').addEventListener('click', loadAll);
        document.querySelector('[data-action="logout"]').addEventListener('click', logout);

        loadAll();
    }

    initLogin();
    initDashboard();
}());
