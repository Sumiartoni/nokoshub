// ─── NokosHUB Super Admin Dashboard v2.0 ────────────────────────────────────
(function () {
    'use strict';

    // ─── Auth Guard ─────────────────────────────────────────────────────────────
    const session = window.NokosAuth?.requireAuth();
    if (!session) return;

    // ─── Show server in header & sidebar ────────────────────────────────────────
    try {
        const u = new URL(session.apiBaseUrl);
        const host = u.hostname;
        document.getElementById('serverUrl').textContent = host;
        document.getElementById('sidebarServerUrl').textContent = session.apiBaseUrl;
    } catch {
        document.getElementById('serverUrl').textContent = session.apiBaseUrl;
        document.getElementById('sidebarServerUrl').textContent = session.apiBaseUrl;
    }

    // ─── Clock ──────────────────────────────────────────────────────────────────
    (function clock() {
        const el = document.getElementById('headerTime');
        if (!el) return;
        const tick = () => {
            el.textContent = new Date().toLocaleTimeString('id-ID', {
                hour: '2-digit', minute: '2-digit', second: '2-digit',
            });
        };
        tick();
        setInterval(tick, 1000);
    })();

    // ─── Logout ─────────────────────────────────────────────────────────────────
    document.getElementById('logoutBtn').addEventListener('click', () => {
        openConfirm({
            title: 'Keluar dari Dashboard',
            message: 'Anda yakin ingin keluar? Sesi login akan dihapus dan Anda perlu memasukkan Admin Key kembali.',
            okText: 'Ya, Keluar',
            color: 'rose',
            onOk: () => window.NokosAuth.logout(),
        });
    });

    // ─── Mobile Menu ────────────────────────────────────────────────────────────
    const sidebar = document.getElementById('sidebar');
    const overlay = document.getElementById('mobileOverlay');
    document.getElementById('menuToggle').addEventListener('click', () => {
        sidebar.classList.toggle('open');
        overlay.classList.toggle('show');
    });
    overlay.addEventListener('click', () => {
        sidebar.classList.remove('open');
        overlay.classList.remove('show');
    });

    // ─── Header Refresh Button ───────────────────────────────────────────────────
    document.getElementById('headerRefreshBtn').addEventListener('click', () => {
        reloadCurrentPage(true);
    });

    function reloadCurrentPage(animate = false) {
        if (animate) {
            const btn = document.getElementById('headerRefreshBtn');
            btn.classList.add('spinning');
            setTimeout(() => btn.classList.remove('spinning'), 800);
        }
        const activePage = document.querySelector('.page-section.active');
        const pageId = activePage?.id?.replace('page-', '');
        if (pageId === 'overview') loadOverview();
        else if (pageId === 'orders') loadOrders();
        else if (pageId === 'invoices') loadInvoices();
        else if (pageId === 'transactions') loadTransactions();
        else if (pageId === 'services') loadServices();
        else if (pageId === 'users') loadUsers();
    }

    // ─── Navigation ─────────────────────────────────────────────────────────────
    const pageMeta = {
        overview:     { title: 'Overview',    sub: 'Ringkasan sistem NokosHUB' },
        orders:       { title: 'Orders',      sub: 'Riwayat pembelian nomor virtual' },
        invoices:     { title: 'Invoices',    sub: 'Riwayat deposit & pembayaran QRIS' },
        transactions: { title: 'Transaksi',   sub: 'Semua aliran transaksi keuangan' },
        services:     { title: 'Layanan',     sub: 'Sync & kelola layanan dari HeroSMS' },
        users:        { title: 'Users',       sub: 'Manajemen pengguna & penyesuaian saldo' },
    };

    window.navigateTo = function (page) {
        document.querySelectorAll('.nav-item[data-page]').forEach(n => n.classList.remove('active'));
        document.querySelectorAll('.page-section').forEach(p => p.classList.remove('active'));

        const navEl = document.getElementById(`nav-${page}`);
        const pageEl = document.getElementById(`page-${page}`);
        if (navEl) navEl.classList.add('active');
        if (pageEl) pageEl.classList.add('active');

        const meta = pageMeta[page] || { title: page, sub: '' };
        document.getElementById('pageTitle').textContent = meta.title;
        document.getElementById('pageSubtitle').textContent = meta.sub;

        sidebar.classList.remove('open');
        overlay.classList.remove('show');

        if (page === 'orders') loadOrders();
        else if (page === 'invoices') loadInvoices();
        else if (page === 'transactions') loadTransactions();
        else if (page === 'services') loadServices();
        else if (page === 'users') loadUsers();
    };

    document.querySelectorAll('.nav-item[data-page]').forEach(item => {
        item.addEventListener('click', () => navigateTo(item.dataset.page));
    });

    // ─── API shorthand ──────────────────────────────────────────────────────────
    const api = window.NokosAuth.apiFetch;

    // ═══════════════════════════════════════════════════════════════════════════
    //  FORMATTERS & UTILS
    // ═══════════════════════════════════════════════════════════════════════════
    function formatRupiah(n) {
        if (n == null) return 'Rp0';
        const abs = Math.abs(n);
        if (abs >= 1_000_000) return `Rp${(abs / 1_000_000).toFixed(1)}jt`;
        if (abs >= 1_000) return `Rp${(abs / 1_000).toFixed(0)}rb`;
        return 'Rp' + abs.toLocaleString('id-ID');
    }
    function formatRupiahFull(n) {
        if (n == null) return 'Rp 0';
        return 'Rp ' + Math.abs(n).toLocaleString('id-ID');
    }
    function formatDate(d) {
        if (!d) return '—';
        return new Date(d).toLocaleString('id-ID', {
            day: '2-digit', month: 'short', year: 'numeric',
            hour: '2-digit', minute: '2-digit',
        });
    }
    function formatDateShort(d) {
        if (!d) return '—';
        return new Date(d).toLocaleString('id-ID', {
            day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit',
        });
    }

    function statusBadge(status) {
        const map = {
            ACTIVE: 'info', SUCCESS: 'success', PAID: 'success',
            PENDING: 'warning', FAILED: 'danger', CANCELLED: 'neutral',
            EXPIRED: 'neutral', DEPOSIT: 'success', DEDUCT: 'danger',
            REFUND: 'warning', DISABLED: 'danger',
        };
        const cls = map[status] || 'neutral';
        return `<span class="badge ${cls}">${status}</span>`;
    }

    function idChip(id, len = 8) {
        if (!id) return '—';
        const short = id.slice(0, len);
        return `<span class="id-chip mono" onclick="copyToClipboard('${id}', this)" title="${id}">${short}…</span>`;
    }

    function copyToClipboard(text, el) {
        navigator.clipboard.writeText(text).then(() => {
            const orig = el.innerHTML;
            el.innerHTML = `<svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="#10b981" stroke-width="3"><polyline points="20 6 9 17 4 12"/></svg> Copied`;
            setTimeout(() => { el.innerHTML = orig; }, 1500);
        }).catch(() => showToast('Gagal menyalin', 'error'));
    }
    window.copyToClipboard = copyToClipboard;

    // ═══════════════════════════════════════════════════════════════════════════
    //  TOAST
    // ═══════════════════════════════════════════════════════════════════════════
    window.showToast = function (message, type = 'success') {
        const container = document.getElementById('toastContainer');
        const toast = document.createElement('div');
        toast.className = `toast ${type}`;
        const icons = {
            success: '<path d="M22 11.08V12a10 10 0 1 1-5.93-9.14"/><polyline points="22 4 12 14.01 9 11.01"/>',
            error: '<circle cx="12" cy="12" r="10"/><line x1="12" y1="8" x2="12" y2="12"/><line x1="12" y1="16" x2="12.01" y2="16"/>',
            warning: '<path d="M10.29 3.86L1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z"/><line x1="12" y1="9" x2="12" y2="13"/><line x1="12" y1="17" x2="12.01" y2="17"/>',
        };
        toast.innerHTML = `
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">${icons[type] || icons.success}</svg>
            <span>${message}</span>
            <button class="toast-dismiss" onclick="this.parentElement.remove()">✕</button>`;
        container.appendChild(toast);
        setTimeout(() => toast.classList.add('hiding'), 4500);
        setTimeout(() => toast.remove(), 5000);
    };

    // ═══════════════════════════════════════════════════════════════════════════
    //  MODAL UTILS
    // ═══════════════════════════════════════════════════════════════════════════
    window.closeModal = function (id) {
        const el = document.getElementById(id);
        if (el) el.style.display = 'none';
    };

    window.handleModalOverlayClick = function (ev, modalId) {
        if (ev.target.classList.contains('modal-overlay')) closeModal(modalId);
    };

    let _confirmResolve = null;
    window.openConfirm = function ({ title, message, okText = 'Konfirmasi', color = 'rose', onOk }) {
        document.getElementById('confirmTitle').textContent = title;
        document.getElementById('confirmMessage').textContent = message;
        const okBtn = document.getElementById('confirmOkBtn');
        okBtn.textContent = okText;
        okBtn.className = `btn btn-${color}`;
        document.getElementById('confirmModal').style.display = 'flex';
        if (_confirmResolve) _confirmResolve(false);
        okBtn.onclick = () => {
            closeModal('confirmModal');
            if (onOk) onOk();
        };
    };

    // ═══════════════════════════════════════════════════════════════════════════
    //  OVERVIEW / STATS
    // ═══════════════════════════════════════════════════════════════════════════
    async function loadOverview() {
        renderStatSkeleton();

        const [ordersRes, invoicesRes, balanceRes, servicesRes] = await Promise.allSettled([
            api('/api/admin/orders?limit=100'),
            api('/api/admin/invoices?limit=100'),
            api('/api/admin/balance'),
            api('/api/services'),
        ]);

        let ordersData = [], invoicesData = [];

        // Orders
        let totalOrders = '—', activeOrders = '—';
        if (ordersRes.status === 'fulfilled' && ordersRes.value.success) {
            ordersData = ordersRes.value.data;
            totalOrders = ordersData.length;
            activeOrders = ordersData.filter(o => o.status === 'ACTIVE').length;
            document.getElementById('ordersBadge').textContent = activeOrders || '0';
            renderRecentOrders(ordersData.slice(0, 7));
        } else {
            document.getElementById('recentOrdersBody').innerHTML = emptyHTML('Gagal memuat order');
        }

        // Invoices
        let invoiceRevenue = '—';
        if (invoicesRes.status === 'fulfilled' && invoicesRes.value.success) {
            invoicesData = invoicesRes.value.data;
            const totalPaid = invoicesData
                .filter(i => i.status === 'PAID')
                .reduce((s, i) => s + (i.baseAmount || i.amount), 0);
            invoiceRevenue = formatRupiah(totalPaid);
            renderRecentInvoices(invoicesData.slice(0, 7));
        } else {
            document.getElementById('recentInvoicesBody').innerHTML = emptyHTML('Gagal memuat invoice');
        }

        // Provider balance
        let providerBal = '—';
        let providerMeta = '';
        let providerStatus = 'warning';
        if (balanceRes.status === 'fulfilled' && balanceRes.value.success) {
            const balance = balanceRes.value.data;
            const providerUsd = Number(balance.providerBalanceUsd ?? balance.providerBalance);
            const exchangeRate = Number(balance.exchangeRate || 0);
            const providerIdr = Number(balance.providerBalanceIdr ?? (providerUsd * exchangeRate));

            providerBal = Number.isFinite(providerIdr) ? formatRupiahFull(providerIdr) : '—';
            providerMeta = Number.isFinite(providerUsd) && Number.isFinite(exchangeRate) && exchangeRate > 0
                ? `$${providerUsd.toFixed(2)} x ${formatRupiahFull(exchangeRate)}`
                : '';
            providerStatus = (Number.isFinite(providerUsd) && providerUsd > 0) ? 'online' : 'offline';
        }

        // Services
        let totalServices = '—';
        if (servicesRes.status === 'fulfilled' && servicesRes.value.success) {
            totalServices = servicesRes.value.data.length;
        }

        // Render stat cards
        const grid = document.getElementById('statsGrid');
        grid.innerHTML = `
            ${statCard('indigo', 'orders', 'Total Orders', totalOrders)}
            ${statCard('info', 'active', 'Order Aktif', activeOrders)}
            ${statCard('emerald', 'revenue', 'Total Revenue', invoiceRevenue)}
            ${statCard('amber', 'provider', 'Saldo Provider', providerBal, providerMeta)}
            ${statCard('rose', 'services', 'Layanan Aktif', totalServices)}
        `;

        // System status panel
        const sysRow = document.getElementById('systemStatusRow');
        const apiStatus = ordersRes.status === 'fulfilled' && ordersRes.value.success;
        sysRow.innerHTML = `
            <div class="status-pill ${apiStatus ? 'online' : 'offline'}">
                <div class="status-pill-dot"></div> API ${apiStatus ? 'Online' : 'Offline'}
            </div>
            <div class="status-pill ${providerStatus}">
                <div class="status-pill-dot"></div> Provider ${providerStatus === 'online' ? 'Balance OK' : providerStatus === 'warning' ? 'Balance Rendah' : 'Error'}
            </div>
            <span style="font-size:0.75rem;color:var(--text-muted)">
                Saldo: <strong style="color:var(--amber)">${providerBal}</strong>
                ${providerMeta ? `<span style="margin-left:6px">(${providerMeta})</span>` : ''}
            </span>
            <span style="font-size:0.75rem;color:var(--text-muted)">
                Diperbarui: ${new Date().toLocaleTimeString('id-ID')}
            </span>
        `;
    }

    const svgIcons = {
        orders:   '<path d="M9 5H7a2 2 0 0 0-2 2v12a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2V7a2 2 0 0 0-2-2h-2"/><rect x="9" y="3" width="6" height="4" rx="2"/><path d="M9 12h6M9 16h4"/>',
        active:   '<polyline points="22 12 18 12 15 21 9 3 6 12 2 12"/>',
        revenue:  '<rect x="2" y="5" width="20" height="14" rx="2"/><line x1="2" y1="10" x2="22" y2="10"/>',
        provider: '<circle cx="12" cy="12" r="10"/><line x1="12" y1="8" x2="12" y2="12"/><line x1="12" y1="16" x2="12.01" y2="16"/>',
        services: '<circle cx="12" cy="12" r="3"/><path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 1 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 1 1-4 0v-.09A1.65 1.65 0 0 0 9 19.4"/>',
        info:     '<polyline points="22 12 18 12 15 21 9 3 6 12 2 12"/>',
    };

    const colorMap = {
        indigo: 'indigo', emerald: 'emerald', amber: 'amber', rose: 'rose', sky: 'sky', info: 'sky',
    };

    function statCard(color, icon, label, value, meta = '') {
        const c = colorMap[color] || color;
        return `
            <div class="stat-card ${c}">
                <div class="stat-icon ${c}">
                    <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                        ${svgIcons[icon] || svgIcons.orders}
                    </svg>
                </div>
                <div class="stat-label">${label}</div>
                <div class="stat-value">${value}</div>
                ${meta ? `<div class="stat-meta">${meta}</div>` : ''}
            </div>`;
    }

    function renderStatSkeleton() {
        const grid = document.getElementById('statsGrid');
        const labels = ['Total Orders', 'Order Aktif', 'Total Revenue', 'Saldo Provider', 'Layanan Aktif'];
        const colors = ['indigo', 'sky', 'emerald', 'amber', 'rose'];
        const icons = ['orders', 'active', 'revenue', 'provider', 'services'];
        grid.innerHTML = labels.map((l, i) => statCard(colors[i], icons[i], l, '…')).join('');
    }

    // ─── Recent Orders (Overview) ────────────────────────────────────────────────
    function renderRecentOrders(orders) {
        const body = document.getElementById('recentOrdersBody');
        if (!orders.length) { body.innerHTML = emptyHTML('Belum ada order'); return; }
        body.innerHTML = `
            <table class="data-table">
                <thead><tr>
                    <th>User</th><th>Layanan</th><th>Negara</th><th>Status</th><th>Tanggal</th>
                </tr></thead>
                <tbody>
                    ${orders.map(o => `<tr onclick="showOrderDetail(${JSON.stringify(JSON.stringify(o))})">
                        <td class="mono text-indigo">${o.user?.telegramId || '—'}</td>
                        <td class="fw-600">${o.price?.service?.name || '—'}</td>
                        <td>${o.price?.country?.name || '—'}</td>
                        <td>${statusBadge(o.status)}</td>
                        <td class="text-muted text-sm">${formatDateShort(o.createdAt)}</td>
                    </tr>`).join('')}
                </tbody>
            </table>`;
    }

    // ─── Recent Invoices (Overview) ──────────────────────────────────────────────
    function renderRecentInvoices(invoices) {
        const body = document.getElementById('recentInvoicesBody');
        if (!invoices.length) { body.innerHTML = emptyHTML('Belum ada invoice'); return; }
        body.innerHTML = `
            <table class="data-table">
                <thead><tr>
                    <th>User</th><th>Jumlah</th><th>Status</th><th>Tanggal</th>
                </tr></thead>
                <tbody>
                    ${invoices.map(i => `<tr>
                        <td class="mono text-indigo">${i.user?.telegramId || '—'}</td>
                        <td class="mono ${i.status === 'PAID' ? 'text-emerald fw-600' : ''}">${formatRupiahFull(i.baseAmount || i.amount)}</td>
                        <td>${statusBadge(i.status)}</td>
                        <td class="text-muted text-sm">${formatDateShort(i.createdAt)}</td>
                    </tr>`).join('')}
                </tbody>
            </table>`;
    }

    // ═══════════════════════════════════════════════════════════════════════════
    //  ORDER DETAIL
    // ═══════════════════════════════════════════════════════════════════════════
    let _allOrders = [];

    window.showOrderDetail = function (jsonStr) {
        const order = JSON.parse(jsonStr);
        const body = document.getElementById('orderDetailBody');
        body.innerHTML = `
            <div class="detail-grid">
                <div class="detail-item">
                    <div class="detail-item-label">Order ID</div>
                    <div class="detail-item-value mono">${idChip(order.id, 12)}</div>
                </div>
                <div class="detail-item">
                    <div class="detail-item-label">Status</div>
                    <div class="detail-item-value">${statusBadge(order.status)}</div>
                </div>
                <div class="detail-item">
                    <div class="detail-item-label">User (Telegram ID)</div>
                    <div class="detail-item-value mono text-indigo">${order.user?.telegramId || '—'}</div>
                </div>
                <div class="detail-item">
                    <div class="detail-item-label">Username</div>
                    <div class="detail-item-value">${order.user?.username || '—'}</div>
                </div>
                <div class="detail-item">
                    <div class="detail-item-label">Layanan</div>
                    <div class="detail-item-value fw-600">${order.price?.service?.name || '—'}</div>
                </div>
                <div class="detail-item">
                    <div class="detail-item-label">Negara</div>
                    <div class="detail-item-value">${order.price?.country?.name || '—'}</div>
                </div>
                <div class="detail-item">
                    <div class="detail-item-label">Nomor HP</div>
                    <div class="detail-item-value mono">${order.phoneNumber || '—'}</div>
                </div>
                <div class="detail-item">
                    <div class="detail-item-label">Harga</div>
                    <div class="detail-item-value mono text-amber fw-600">${formatRupiahFull(order.price?.sellPrice)}</div>
                </div>
                <div class="detail-item">
                    <div class="detail-item-label">Provider Order ID</div>
                    <div class="detail-item-value mono text-sm">${order.providerOrderId || '—'}</div>
                </div>
                <div class="detail-item">
                    <div class="detail-item-label">Dibuat</div>
                    <div class="detail-item-value text-sm">${formatDate(order.createdAt)}</div>
                </div>
            </div>`;
        document.getElementById('orderDetailModal').style.display = 'flex';
    };

    // ═══════════════════════════════════════════════════════════════════════════
    //  ORDERS PAGE
    // ═══════════════════════════════════════════════════════════════════════════
    let _ordersData = [];

    window.loadOrders = async function () {
        const body = document.getElementById('ordersTableBody');
        body.innerHTML = loadingHTML();

        const status = document.getElementById('orderStatusFilter').value;
        const limit = document.getElementById('orderLimitFilter').value;
        let url = `/api/admin/orders?limit=${limit}`;
        if (status) url += `&status=${status}`;

        try {
            const res = await api(url);
            if (!res.success) throw new Error(res.error || 'Gagal memuat data');
            _ordersData = res.data || [];
            renderOrdersTable(_ordersData);
        } catch (err) {
            body.innerHTML = errorHTML(err.message);
        }
    };

    window.filterOrdersTable = function () {
        const q = document.getElementById('orderSearchInput').value.toLowerCase();
        const filtered = _ordersData.filter(o =>
            (o.user?.telegramId || '').includes(q) ||
            (o.phoneNumber || '').includes(q) ||
            (o.price?.service?.name || '').toLowerCase().includes(q) ||
            (o.price?.country?.name || '').toLowerCase().includes(q) ||
            (o.id || '').toLowerCase().includes(q)
        );
        renderOrdersTable(filtered);
    };

    function renderOrdersTable(data) {
        const body = document.getElementById('ordersTableBody');
        const footer = document.getElementById('ordersFooter');
        const countEl = document.getElementById('ordersCount');

        if (!data.length) {
            body.innerHTML = emptyHTML('Tidak ada data order yang sesuai');
            footer.style.display = 'none';
            return;
        }

        footer.style.display = 'block';
        countEl.textContent = `Menampilkan ${data.length} order`;

        body.innerHTML = `
            <table class="data-table">
                <thead><tr>
                    <th>ID</th><th>User</th><th>Layanan</th><th>Negara</th>
                    <th>No. HP</th><th>Harga</th><th>Status</th><th>Tanggal</th>
                </tr></thead>
                <tbody>
                    ${data.map(o => `
                    <tr onclick="showOrderDetail(${escAttr(JSON.stringify(o))})">
                        <td>${idChip(o.id)}</td>
                        <td class="mono text-indigo">${o.user?.telegramId || '—'}</td>
                        <td class="fw-600">${o.price?.service?.name || '—'}</td>
                        <td>${o.price?.country?.name || '—'}</td>
                        <td class="mono">${o.phoneNumber || '—'}</td>
                        <td class="mono text-amber fw-600">${formatRupiahFull(o.price?.sellPrice)}</td>
                        <td>${statusBadge(o.status)}</td>
                        <td class="text-muted text-sm">${formatDateShort(o.createdAt)}</td>
                    </tr>`).join('')}
                </tbody>
            </table>`;
    }

    // ═══════════════════════════════════════════════════════════════════════════
    //  INVOICES PAGE
    // ═══════════════════════════════════════════════════════════════════════════
    let _invoicesData = [];

    window.loadInvoices = async function () {
        const body = document.getElementById('invoicesTableBody');
        body.innerHTML = loadingHTML();
        document.getElementById('invoiceStats').style.display = 'none';

        try {
            const res = await api('/api/admin/invoices');
            if (!res.success) throw new Error(res.error || 'Gagal memuat invoice');
            _invoicesData = res.data || [];
            renderInvoiceStats(_invoicesData);
            renderInvoicesTable(applyInvoiceFilter(_invoicesData));
        } catch (err) {
            body.innerHTML = errorHTML(err.message);
        }
    };

    function applyInvoiceFilter(data) {
        const statusFilter = document.getElementById('invoiceStatusFilter').value;
        const q = document.getElementById('invoiceSearchInput').value.toLowerCase();
        return data.filter(i => {
            const matchStatus = !statusFilter || i.status === statusFilter;
            const matchSearch = !q ||
                (i.user?.telegramId || '').includes(q) ||
                (i.id || '').toLowerCase().includes(q);
            return matchStatus && matchSearch;
        });
    }

    window.filterInvoicesTable = function () {
        renderInvoicesTable(applyInvoiceFilter(_invoicesData));
    };

    function renderInvoiceStats(data) {
        const stats = document.getElementById('invoiceStats');
        const paid = data.filter(i => i.status === 'PAID');
        const revenue = paid.reduce((s, i) => s + (i.baseAmount || i.amount), 0);
        document.getElementById('inv-total').textContent = data.length;
        document.getElementById('inv-paid').textContent = paid.length;
        document.getElementById('inv-pending').textContent = data.filter(i => i.status === 'PENDING').length;
        document.getElementById('inv-expired').textContent = data.filter(i => i.status === 'EXPIRED').length;
        document.getElementById('inv-revenue').textContent = formatRupiah(revenue);
        stats.style.display = 'flex';
    }

    function renderInvoicesTable(data) {
        const body = document.getElementById('invoicesTableBody');
        if (!data.length) { body.innerHTML = emptyHTML('Tidak ada invoice yang sesuai'); return; }

        body.innerHTML = `
            <table class="data-table">
                <thead><tr>
                    <th>ID</th><th>User</th><th>Jumlah Asli</th><th>Jumlah Final</th>
                    <th>Status</th><th>Dibuat</th><th>Dibayar</th>
                </tr></thead>
                <tbody>
                    ${data.map(i => `<tr>
                        <td>${idChip(i.id)}</td>
                        <td class="mono text-indigo">${i.user?.telegramId || '—'}</td>
                        <td class="mono">${formatRupiahFull(i.baseAmount)}</td>
                        <td class="mono ${i.status === 'PAID' ? 'text-emerald fw-600' : 'text-amber'}">${formatRupiahFull(i.amount)}</td>
                        <td>${statusBadge(i.status)}</td>
                        <td class="text-muted text-sm">${formatDateShort(i.createdAt)}</td>
                        <td class="${i.paidAt ? 'text-emerald' : 'text-muted'} text-sm">${i.paidAt ? formatDateShort(i.paidAt) : '—'}</td>
                    </tr>`).join('')}
                </tbody>
            </table>`;
    }

    // ═══════════════════════════════════════════════════════════════════════════
    //  TRANSACTIONS PAGE
    // ═══════════════════════════════════════════════════════════════════════════
    let _txData = [];

    window.loadTransactions = async function () {
        const body = document.getElementById('transactionsTableBody');
        body.innerHTML = loadingHTML();

        const limit = document.getElementById('txLimitFilter').value;

        try {
            const res = await api(`/api/admin/transactions?limit=${limit}`);
            if (!res.success) throw new Error(res.error || 'Gagal memuat transaksi');
            _txData = res.data || [];
            renderTxTable(applyTxFilter(_txData));
        } catch (err) {
            body.innerHTML = errorHTML(err.message);
        }
    };

    function applyTxFilter(data) {
        const typeFilter = document.getElementById('txTypeFilter').value;
        const q = document.getElementById('txSearchInput').value.toLowerCase();
        return data.filter(t => {
            const matchType = !typeFilter || t.type === typeFilter;
            const matchSearch = !q ||
                (t.user?.telegramId || '').includes(q) ||
                (t.description || '').toLowerCase().includes(q) ||
                (t.id || '').toLowerCase().includes(q);
            return matchType && matchSearch;
        });
    }

    window.filterTxTable = function () {
        renderTxTable(applyTxFilter(_txData));
    };

    function renderTxTable(data) {
        const body = document.getElementById('transactionsTableBody');
        if (!data.length) { body.innerHTML = emptyHTML('Tidak ada transaksi yang sesuai'); return; }

        body.innerHTML = `
            <table class="data-table">
                <thead><tr>
                    <th>ID</th><th>User</th><th>Tipe</th><th>Jumlah</th><th>Keterangan</th><th>Tanggal</th>
                </tr></thead>
                <tbody>
                    ${data.map(t => `<tr>
                        <td>${idChip(t.id)}</td>
                        <td class="mono text-indigo">${t.user?.telegramId || '—'}</td>
                        <td>${statusBadge(t.type)}</td>
                        <td class="mono fw-600 ${t.amount > 0 ? 'text-emerald' : 'text-rose'}">
                            ${t.amount > 0 ? '+' : ''}${formatRupiahFull(t.amount)}
                        </td>
                        <td class="text-sm" style="max-width:200px;overflow:hidden;text-overflow:ellipsis">${t.description || '—'}</td>
                        <td class="text-muted text-sm">${formatDateShort(t.createdAt)}</td>
                    </tr>`).join('')}
                </tbody>
            </table>`;
    }

    // ═══════════════════════════════════════════════════════════════════════════
    //  SERVICES PAGE
    // ═══════════════════════════════════════════════════════════════════════════
    let _servicesData = [];

    window.loadServices = async function () {
        const body = document.getElementById('servicesTableBody');
        body.innerHTML = loadingHTML();
        document.getElementById('serviceStats').style.display = 'none';

        try {
            const res = await api('/api/services');
            if (!res.success) throw new Error(res.error || 'Gagal memuat layanan');
            _servicesData = res.data || [];
            renderServiceStats(_servicesData);
            renderServicesTable(applyServiceFilter(_servicesData));
        } catch (err) {
            body.innerHTML = errorHTML(err.message);
        }
    };

    function applyServiceFilter(data) {
        const statusFilter = document.getElementById('serviceStatusFilter').value;
        const q = document.getElementById('serviceSearchInput').value.toLowerCase();
        return data.filter(s => {
            const matchStatus = !statusFilter ||
                (statusFilter === 'active' && s.isActive) ||
                (statusFilter === 'inactive' && !s.isActive);
            const matchSearch = !q ||
                (s.serviceCode || '').toLowerCase().includes(q) ||
                (s.name || '').toLowerCase().includes(q);
            return matchStatus && matchSearch;
        });
    }

    window.filterServicesTable = function () {
        renderServicesTable(applyServiceFilter(_servicesData));
    };

    function renderServiceStats(data) {
        const statsEl = document.getElementById('serviceStats');
        const active = data.filter(s => s.isActive).length;
        document.getElementById('svc-total').textContent = data.length;
        document.getElementById('svc-active').textContent = active;
        document.getElementById('svc-inactive').textContent = data.length - active;
        statsEl.style.display = 'flex';
    }

    function renderServicesTable(data) {
        const body = document.getElementById('servicesTableBody');
        if (!data.length) { body.innerHTML = emptyHTML('Tidak ada layanan. Coba sync dari provider.'); return; }

        body.innerHTML = `
            <table class="data-table">
                <thead><tr><th>Kode</th><th>Nama Layanan</th><th>Status</th><th>Aksi</th></tr></thead>
                <tbody>
                    ${data.map(s => `<tr>
                        <td>${idChip(s.serviceCode, s.serviceCode.length)}</td>
                        <td class="fw-600">${s.name}</td>
                        <td>${s.isActive ? statusBadge('ACTIVE') : statusBadge('DISABLED')}</td>
                        <td class="actions-cell">
                            <button class="btn btn-sm ${s.isActive ? 'btn-danger' : 'btn-success'}"
                                onclick="confirmToggleService('${s.serviceCode}', ${!s.isActive}, '${s.name}')">
                                ${s.isActive ? 'Nonaktifkan' : 'Aktifkan'}
                            </button>
                        </td>
                    </tr>`).join('')}
                </tbody>
            </table>`;
    }

    window.confirmToggleService = function (serviceCode, isActive, name) {
        openConfirm({
            title: isActive ? `Aktifkan Layanan` : `Nonaktifkan Layanan`,
            message: `Anda yakin ingin ${isActive ? 'mengaktifkan' : 'menonaktifkan'} layanan "${name}" (${serviceCode})?${!isActive ? ' Pengguna tidak dapat memesan layanan ini.' : ''}`,
            okText: isActive ? 'Aktifkan' : 'Nonaktifkan',
            color: isActive ? 'success' : 'danger',
            onOk: () => toggleService(serviceCode, isActive),
        });
    };

    window.toggleService = async function (serviceCode, isActive) {
        try {
            const res = await api('/api/admin/service', {
                method: 'PATCH',
                body: JSON.stringify({ serviceCode, isActive }),
            });
            if (res.success) {
                showToast(`Layanan ${serviceCode} berhasil ${isActive ? 'diaktifkan' : 'dinonaktifkan'}`);
                loadServices();
            } else {
                showToast(res.error || 'Gagal update layanan', 'error');
            }
        } catch (err) {
            showToast(err.message, 'error');
        }
    };

    window.triggerSync = async function () {
        openConfirm({
            title: 'Sync dari Provider',
            message: 'Proses sync akan berjalan di background dan bisa memakan waktu 2–4 menit. Data layanan & harga akan diperbarui dari HeroSMS.',
            okText: 'Mulai Sync',
            color: 'primary',
            onOk: async () => {
                const btn = document.getElementById('syncBtn');
                btn.disabled = true;
                btn.innerHTML = '<span class="spinner-inline"></span> Syncing…';

                try {
                    const res = await api('/api/admin/sync');
                    if (res.success) {
                        showToast(res.message || 'Sync berhasil dimulai!', 'success');
                    } else {
                        showToast(res.error || 'Sync gagal', 'error');
                    }
                } catch (err) {
                    showToast(err.message, 'error');
                } finally {
                    btn.disabled = false;
                    btn.innerHTML = `
                        <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5">
                            <polyline points="23 4 23 10 17 10"/><path d="M20.49 15a9 9 0 1 1-2.12-9.36L23 10"/>
                        </svg>
                        Sync Provider`;
                }
            },
        });
    };

    // ═══════════════════════════════════════════════════════════════════════════
    //  USERS PAGE
    // ═══════════════════════════════════════════════════════════════════════════
    let _usersMap = new Map();

    window.loadUsers = async function () {
        const body = document.getElementById('usersTableBody');
        body.innerHTML = loadingHTML();
        _usersMap = new Map();

        try {
            const res = await api('/api/admin/transactions?limit=200');
            if (!res.success) throw new Error(res.error || 'Gagal memuat data user');
            const txData = res.data || [];

            // Build user map from transactions
            for (const t of txData) {
                if (!t.userId) continue;
                if (!_usersMap.has(t.userId)) {
                    _usersMap.set(t.userId, {
                        id: t.userId,
                        telegramId: t.user?.telegramId || '—',
                        username: t.user?.username || '—',
                        txCount: 0, totalDeposit: 0, totalDeduct: 0,
                        lastActivity: t.createdAt,
                    });
                }
                const u = _usersMap.get(t.userId);
                u.txCount++;
                if (t.amount > 0) u.totalDeposit += t.amount;
                else u.totalDeduct += Math.abs(t.amount);
                if (new Date(t.createdAt) > new Date(u.lastActivity)) u.lastActivity = t.createdAt;
            }

            renderUsersTable([..._usersMap.values()]);
        } catch (err) {
            body.innerHTML = errorHTML(err.message);
        }
    };

    window.filterUsersTable = function () {
        const q = document.getElementById('userSearchInput').value.toLowerCase();
        const data = [..._usersMap.values()].filter(u =>
            u.telegramId.includes(q) ||
            u.username.toLowerCase().includes(q)
        );
        renderUsersTable(data);
    };

    function renderUsersTable(users) {
        const body = document.getElementById('usersTableBody');
        if (!users.length) { body.innerHTML = emptyHTML('Tidak ada user yang sesuai'); return; }

        body.innerHTML = `
            <table class="data-table">
                <thead><tr>
                    <th>Telegram ID</th><th>Username</th><th>Total TX</th>
                    <th>Total Deposit</th><th>Total Deduct</th><th>Aktivitas Terakhir</th><th>Aksi</th>
                </tr></thead>
                <tbody>
                    ${users.map(u => `<tr>
                        <td class="mono text-indigo fw-600">${u.telegramId}</td>
                        <td>${u.username !== '—' ? '@' + u.username : '—'}</td>
                        <td class="mono">${u.txCount}</td>
                        <td class="mono text-emerald fw-600">${formatRupiahFull(u.totalDeposit)}</td>
                        <td class="mono text-rose fw-600">${formatRupiahFull(u.totalDeduct)}</td>
                        <td class="text-muted text-sm">${formatDateShort(u.lastActivity)}</td>
                        <td class="actions-cell">
                            <button class="btn btn-sm btn-outline" onclick="prefillAdjust('${u.telegramId}')">
                                <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5">
                                    <line x1="12" y1="5" x2="12" y2="19"/><line x1="5" y1="12" x2="19" y2="12"/>
                                </svg>
                                Adjust
                            </button>
                        </td>
                    </tr>`).join('')}
                </tbody>
            </table>`;
    }

    // ─── Balance Adjustment Modal ─────────────────────────────────────────────────
    window.showAdjustBalanceModal = function () {
        document.getElementById('adjTelegramId').value = '';
        document.getElementById('adjAmount').value = '';
        document.getElementById('adjType').value = 'DEPOSIT';
        document.getElementById('adjDescription').value = 'Admin adjustment';
        document.getElementById('balanceModal').style.display = 'flex';
    };

    window.prefillAdjust = function (telegramId) {
        showAdjustBalanceModal();
        document.getElementById('adjTelegramId').value = telegramId;
    };

    window.submitAdjustBalance = async function () {
        const telegramId = document.getElementById('adjTelegramId').value.trim();
        const amount = parseInt(document.getElementById('adjAmount').value);
        const type = document.getElementById('adjType').value;
        const description = document.getElementById('adjDescription').value.trim() || 'Admin adjustment';

        if (!telegramId) { showToast('Harap masukkan Telegram ID', 'warning'); return; }
        if (!amount || amount <= 0) { showToast('Harap masukkan jumlah yang valid', 'warning'); return; }

        const btn = document.getElementById('adjSubmitBtn');
        btn.disabled = true;
        btn.innerHTML = '<span class="spinner-inline"></span> Memproses…';

        try {
            const res = await api('/api/admin/user-balance', {
                method: 'PATCH',
                body: JSON.stringify({ telegramId, amount, type, description }),
            });
            if (res.success) {
                showToast(`✓ Saldo user ${telegramId} berhasil di-update (+${formatRupiahFull(amount)})`);
                closeModal('balanceModal');
                if (document.getElementById('page-users').classList.contains('active')) loadUsers();
            } else {
                showToast(res.error || 'Gagal update saldo', 'error');
            }
        } catch (err) {
            showToast(err.message, 'error');
        } finally {
            btn.disabled = false;
            btn.innerHTML = `
                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5">
                    <polyline points="20 6 9 17 4 12"/>
                </svg> Simpan`;
        }
    };

    // ═══════════════════════════════════════════════════════════════════════════
    //  HELPERS
    // ═══════════════════════════════════════════════════════════════════════════
    function emptyHTML(msg = 'Tidak ada data') {
        return `<div class="empty-state">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5">
                <path d="M20 7H4a2 2 0 0 0-2 2v6a2 2 0 0 0 2 2h16a2 2 0 0 0 2-2V9a2 2 0 0 0-2-2z"/>
                <circle cx="12" cy="12" r="2"/>
            </svg>
            <p>${msg}</p>
        </div>`;
    }

    function errorHTML(msg) {
        return `<div class="empty-state">
            <svg viewBox="0 0 24 24" fill="none" stroke="var(--rose)" stroke-width="1.5">
                <circle cx="12" cy="12" r="10"/>
                <line x1="12" y1="8" x2="12" y2="12"/><line x1="12" y1="16" x2="12.01" y2="16"/>
            </svg>
            <p style="color:var(--rose)">${msg}</p>
        </div>`;
    }

    function loadingHTML() {
        return `<div class="loading-overlay"><div class="loading-spinner"></div></div>`;
    }

    function escAttr(str) {
        return JSON.stringify(str).replace(/</g, '\\u003c').replace(/>/g, '\\u003e').replace(/&/g, '\\u0026');
    }

    // ═══════════════════════════════════════════════════════════════════════════
    //  BOOT
    // ═══════════════════════════════════════════════════════════════════════════
    loadOverview();

})();
