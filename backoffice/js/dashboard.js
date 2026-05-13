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
        else if (pageId === 'reports') loadReports();
        else if (pageId === 'orders') loadOrders();
        else if (pageId === 'invoices') loadInvoices();
        else if (pageId === 'transactions') loadTransactions();
        else if (pageId === 'services') {
            loadPricingSettings();
            loadServices();
        }
        else if (pageId === 'referral') loadReferralSettings();
        else if (pageId === 'smtp') loadSmtpSettings();
        else if (pageId === 'cs-bot') loadCsBotSettings();
        else if (pageId === 'promo') loadPromoSettings();
        else if (pageId === 'announcement') loadAnnouncementSettings();
        else if (pageId === 'newsletter') loadNewsletterPage();
        else if (pageId === 'seo-pages') loadSeoPagesPage();
        else if (pageId === 'deposit-settings') loadPaymentSettings();
        else if (pageId === 'maintenance') loadMaintenanceDashboard();
        else if (pageId === 'users') loadUsers();
    }

    // ─── Navigation ─────────────────────────────────────────────────────────────
    const pageMeta = {
        overview:     { title: 'Overview',    sub: 'Ringkasan sistem NokosHUB' },
        orders:       { title: 'Orders',      sub: 'Riwayat pembelian nomor virtual' },
        invoices:     { title: 'Invoices',    sub: 'Riwayat deposit & pembayaran payment gateway' },
        reports:      { title: 'Laporan',     sub: 'Ringkasan HPP, omzet, margin kotor, dan arus payment gateway' },
        transactions: { title: 'Transaksi',   sub: 'Semua aliran transaksi keuangan' },
        services:     { title: 'Layanan',     sub: 'Sync & kelola layanan dari seluruh provider OTP' },
        referral:     { title: 'Referral',    sub: 'Atur program referral dan nominal bonus pengguna' },
        smtp:         { title: 'SMTP / Email', sub: 'Kelola pengiriman OTP dan koneksi email outbound' },
        'cs-bot':     { title: 'CS BOT',      sub: 'Atur OpenRouter, API key, dan prompt knowledge untuk bot Customer Service' },
        promo:        { title: 'Promo',       sub: 'Kelola promo aktif, bonus deposit, dan alur klaim di bot CS' },
        announcement: { title: 'Pengumuman', sub: 'Kelola popup pengumuman yang tampil ke user saat dashboard direload' },
        newsletter:   { title: 'Newsletter',  sub: 'Broadcast email dan Telegram ke pengguna terpilih' },
        'seo-pages':  { title: 'SEO Pages',   sub: 'Kelola slug, meta, dan artikel SEO yang dipublish ke landing page' },
        'deposit-settings': { title: 'Minimum Deposit', sub: 'Atur nominal minimal top up saldo user' },
        maintenance:  { title: 'Maintenance', sub: 'Kontrol stabilitas, housekeeping, dan operasional sistem' },
        users:        { title: 'Users',       sub: 'Manajemen pengguna & penyesuaian saldo' },
    };

    const overviewRangeState = {
        preset: '7d',
        customStart: '',
        customEnd: '',
    };

    const reportRangeState = {
        preset: '1d',
        customStart: '',
        customEnd: '',
        bucket: 'day',
    };

    window.setOverviewRangePreset = function (preset) {
        overviewRangeState.preset = preset;
        syncOverviewRangeUi();
        if (preset !== 'custom') {
            loadOverview();
        }
    };

    window.applyOverviewCustomRange = function () {
        const startInput = document.getElementById('overviewDateFrom');
        const endInput = document.getElementById('overviewDateTo');
        const startValue = startInput?.value || '';
        const endValue = endInput?.value || '';

        if (!startValue || !endValue) {
            showToast('Tanggal awal dan akhir wajib diisi untuk custom laporan', 'warning');
            return;
        }

        if (new Date(`${startValue}T00:00:00`).getTime() > new Date(`${endValue}T23:59:59.999`).getTime()) {
            showToast('Tanggal awal tidak boleh lebih besar dari tanggal akhir', 'warning');
            return;
        }

        overviewRangeState.preset = 'custom';
        overviewRangeState.customStart = startValue;
        overviewRangeState.customEnd = endValue;
        syncOverviewRangeUi();
        loadOverview();
    };

    function syncOverviewRangeUi() {
        document.querySelectorAll('[data-range-preset]').forEach((button) => {
            button.classList.toggle('active', button.dataset.rangePreset === overviewRangeState.preset);
        });

        const customGroup = document.getElementById('overviewCustomRangeGroup');
        if (customGroup) {
            customGroup.classList.toggle('active', overviewRangeState.preset === 'custom');
        }

        const startInput = document.getElementById('overviewDateFrom');
        const endInput = document.getElementById('overviewDateTo');
        if (startInput) startInput.value = overviewRangeState.customStart;
        if (endInput) endInput.value = overviewRangeState.customEnd;
    }

    function getOverviewQueryString() {
        const params = new URLSearchParams();
        const now = new Date();
        let start = null;
        let end = null;

        if (overviewRangeState.preset === '1d') {
            start = new Date(now.getFullYear(), now.getMonth(), now.getDate(), 0, 0, 0, 0);
            end = new Date(now.getFullYear(), now.getMonth(), now.getDate(), 23, 59, 59, 999);
        } else if (overviewRangeState.preset === '7d') {
            start = new Date(now.getFullYear(), now.getMonth(), now.getDate() - 6, 0, 0, 0, 0);
            end = new Date(now.getFullYear(), now.getMonth(), now.getDate(), 23, 59, 59, 999);
        } else if (overviewRangeState.preset === '30d') {
            start = new Date(now.getFullYear(), now.getMonth(), now.getDate() - 29, 0, 0, 0, 0);
            end = new Date(now.getFullYear(), now.getMonth(), now.getDate(), 23, 59, 59, 999);
        } else if (overviewRangeState.preset === 'custom' && overviewRangeState.customStart && overviewRangeState.customEnd) {
            start = new Date(`${overviewRangeState.customStart}T00:00:00`);
            end = new Date(`${overviewRangeState.customEnd}T23:59:59.999`);
        }

        if (start && Number.isFinite(start.getTime())) {
            params.set('dateFrom', start.toISOString());
        }
        if (end && Number.isFinite(end.getTime())) {
            params.set('dateTo', end.toISOString());
        }

        const query = params.toString();
        return query ? `?${query}` : '';
    }

    window.setReportRangePreset = function (preset) {
        reportRangeState.preset = preset;
        syncReportRangeUi();
        if (preset !== 'custom') {
            loadReports();
        }
    };

    window.setReportBucket = function (bucket) {
        reportRangeState.bucket = bucket;
        syncReportRangeUi();
        loadReports();
    };

    window.applyReportCustomRange = function () {
        const startInput = document.getElementById('reportDateFrom');
        const endInput = document.getElementById('reportDateTo');
        const startValue = startInput?.value || '';
        const endValue = endInput?.value || '';

        if (!startValue || !endValue) {
            showToast('Tanggal awal dan akhir wajib diisi untuk custom laporan', 'warning');
            return;
        }

        if (new Date(`${startValue}T00:00:00`).getTime() > new Date(`${endValue}T23:59:59.999`).getTime()) {
            showToast('Tanggal awal tidak boleh lebih besar dari tanggal akhir', 'warning');
            return;
        }

        reportRangeState.preset = 'custom';
        reportRangeState.customStart = startValue;
        reportRangeState.customEnd = endValue;
        syncReportRangeUi();
        loadReports();
    };

    function syncReportRangeUi() {
        document.querySelectorAll('[data-report-range-preset]').forEach((button) => {
            button.classList.toggle('active', button.dataset.reportRangePreset === reportRangeState.preset);
        });
        document.querySelectorAll('[data-report-bucket]').forEach((button) => {
            button.classList.toggle('active', button.dataset.reportBucket === reportRangeState.bucket);
        });

        const customGroup = document.getElementById('reportCustomRangeGroup');
        if (customGroup) {
            customGroup.classList.toggle('active', reportRangeState.preset === 'custom');
        }

        const startInput = document.getElementById('reportDateFrom');
        const endInput = document.getElementById('reportDateTo');
        if (startInput) startInput.value = reportRangeState.customStart;
        if (endInput) endInput.value = reportRangeState.customEnd;
    }

    function getReportQueryString() {
        const params = new URLSearchParams();
        const now = new Date();
        let start = null;
        let end = null;

        if (reportRangeState.preset === '1d') {
            start = new Date(now.getFullYear(), now.getMonth(), now.getDate(), 0, 0, 0, 0);
            end = new Date(now.getFullYear(), now.getMonth(), now.getDate(), 23, 59, 59, 999);
        } else if (reportRangeState.preset === '7d') {
            start = new Date(now.getFullYear(), now.getMonth(), now.getDate() - 6, 0, 0, 0, 0);
            end = new Date(now.getFullYear(), now.getMonth(), now.getDate(), 23, 59, 59, 999);
        } else if (reportRangeState.preset === '30d') {
            start = new Date(now.getFullYear(), now.getMonth(), now.getDate() - 29, 0, 0, 0, 0);
            end = new Date(now.getFullYear(), now.getMonth(), now.getDate(), 23, 59, 59, 999);
        } else if (reportRangeState.preset === 'custom' && reportRangeState.customStart && reportRangeState.customEnd) {
            start = new Date(`${reportRangeState.customStart}T00:00:00`);
            end = new Date(`${reportRangeState.customEnd}T23:59:59.999`);
        }

        if (start && Number.isFinite(start.getTime())) {
            params.set('dateFrom', start.toISOString());
        }
        if (end && Number.isFinite(end.getTime())) {
            params.set('dateTo', end.toISOString());
        }
        params.set('bucket', reportRangeState.bucket);

        const query = params.toString();
        return query ? `?${query}` : '';
    }

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
        else if (page === 'reports') loadReports();
        else if (page === 'invoices') loadInvoices();
        else if (page === 'transactions') loadTransactions();
        else if (page === 'services') {
            loadPricingSettings();
            loadServices();
        }
        else if (page === 'referral') loadReferralSettings();
        else if (page === 'smtp') loadSmtpSettings();
        else if (page === 'cs-bot') loadCsBotSettings();
        else if (page === 'promo') loadPromoSettings();
        else if (page === 'announcement') loadAnnouncementSettings();
        else if (page === 'newsletter') loadNewsletterPage();
        else if (page === 'seo-pages') loadSeoPagesPage();
        else if (page === 'deposit-settings') loadPaymentSettings();
        else if (page === 'maintenance') loadMaintenanceDashboard();
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
            REFUND: 'warning', REFERRAL: 'success', DISABLED: 'danger',
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
        syncOverviewRangeUi();
        const query = getOverviewQueryString();

        const [overviewRes, ordersRes, invoicesRes, pingRes] = await Promise.allSettled([
            api(`/api/admin/overview${query}`),
            api(`/api/admin/orders${query ? `${query}&limit=12` : '?limit=12'}`),
            api(`/api/admin/invoices${query ? `${query}&limit=12` : '?limit=12'}`),
            measureApiPing(),
        ]);

        let ordersData = [], invoicesData = [];

        // Orders
        let totalOrders = '—', activeOrders = '—';
        if (ordersRes.status === 'fulfilled' && ordersRes.value.success) {
            ordersData = ordersRes.value.data;
            renderRecentOrders(ordersData.slice(0, 7));
        } else {
            document.getElementById('recentOrdersBody').innerHTML = emptyHTML('Gagal memuat order');
        }

        // Invoices
        if (invoicesRes.status === 'fulfilled' && invoicesRes.value.success) {
            invoicesData = invoicesRes.value.data;
            renderRecentInvoices(invoicesData.slice(0, 7));
        } else {
            document.getElementById('recentInvoicesBody').innerHTML = emptyHTML('Gagal memuat invoice');
        }

        // Services
        let totalServices = '—';

        let providerBal = '—';
        let providerMeta = '';
        let providerStatus = 'warning';
        let totalOrderRevenue = '—';
        let totalUserBalance = '—';
        let netProfit = '—';
        let successfulOrders = '—';

        if (overviewRes.status === 'fulfilled' && overviewRes.value.success) {
            const summary = overviewRes.value.data || {};
            totalOrderRevenue = formatRupiahFull(summary.totalOrderRevenue ?? 0);
            totalUserBalance = formatRupiahFull(summary.totalUserBalance ?? 0);
            netProfit = formatRupiahFull(summary.netProfit ?? 0);
            totalServices = Number(summary.totalServices ?? 0);
            successfulOrders = String(summary.successOrders ?? 0);
            totalOrders = successfulOrders;
            activeOrders = String(summary.activeOrders ?? 0);
            document.getElementById('ordersBadge').textContent = activeOrders || '0';

            const providerUsd = Number(summary.providerBalanceUsd ?? 0);
            const exchangeRate = Number(summary.providerRate || 0);
            const providerIdr = Number(summary.providerBalanceIdr ?? (providerUsd * exchangeRate));
            const providerBalances = Array.isArray(summary.providerBalances) ? summary.providerBalances : [];

            providerBal = Number.isFinite(providerIdr) ? formatRupiahFull(providerIdr) : '—';
            providerMeta = providerBalances.length
                ? providerBalances.map((item) => `${item.serverLabel}: $${Number(item.balanceUsd || 0).toFixed(2)}`).join(' • ')
                : (
                    Number.isFinite(providerUsd) && Number.isFinite(exchangeRate) && exchangeRate > 0
                        ? `$${providerUsd.toFixed(2)} x ${formatRupiahFull(exchangeRate)}`
                        : ''
                );
            providerStatus = (Number.isFinite(providerUsd) && providerUsd > 0) ? 'online' : 'offline';
        }

        // Render stat cards
        const grid = document.getElementById('statsGrid');
        grid.innerHTML = `
            ${statCard('sky', 'revenue', 'Saldo Deposit User', totalUserBalance)}
            ${statCard('emerald', 'revenue', 'Net Profit', netProfit)}
            ${statCard('indigo', 'orders', 'Omzet Order', totalOrderRevenue, successfulOrders !== '—' ? `${successfulOrders} order sukses` : '')}
            ${statCard('amber', 'provider', 'Saldo Provider', providerBal, providerMeta)}
            ${statCard('rose', 'services', 'Layanan Aktif', totalServices)}
        `;

        // System status panel
        const sysRow = document.getElementById('systemStatusRow');
        const apiStatus = [overviewRes, ordersRes, invoicesRes].some(
            (result) => result.status === 'fulfilled' && result.value?.success
        );
        const pingData = pingRes.status === 'fulfilled' ? pingRes.value : null;
        const pingLabel = pingData?.latencyMs != null ? `${pingData.latencyMs} ms` : '—';
        const pingTone = pingData?.latencyMs == null
            ? 'offline'
            : pingData.latencyMs >= 1200
                ? 'offline'
                : pingData.latencyMs >= 600
                    ? 'warning'
                    : 'online';
        sysRow.innerHTML = `
            <div class="status-pill ${apiStatus ? 'online' : 'offline'}">
                <div class="status-pill-dot"></div> API ${apiStatus ? 'Online' : 'Offline'}
            </div>
            <div class="status-pill ${pingTone}">
                <div class="status-pill-dot"></div> Ping VPS ${pingLabel}
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

    async function measureApiPing() {
        const start = performance.now();
        await api('/api/health', { timeoutMs: 45000, retries: 1 });
        return { latencyMs: Math.max(1, Math.round(performance.now() - start)) };
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
    //  REPORTS PAGE
    // ═══════════════════════════════════════════════════════════════════════════
    async function loadReports() {
        syncReportRangeUi();

        const statsGrid = document.getElementById('reportStatsGrid');
        const providerBody = document.getElementById('reportProviderBreakdownBody');
        const periodBody = document.getElementById('reportPeriodBreakdownBody');
        const gatewayBody = document.getElementById('reportGatewaySummaryBody');
        const fundingBody = document.getElementById('reportProviderFundingBody');
        const caption = document.getElementById('reportCaption');

        if (statsGrid) statsGrid.innerHTML = Array.from({ length: 6 }).map((_, index) => {
            const labels = ['Order Sukses', 'Omzet Total', 'HPP Provider', 'Margin Kotor', 'Saldo Provider', 'Gateway Masuk'];
            const icons = ['orders', 'revenue', 'provider', 'revenue', 'provider', 'revenue'];
            const colors = ['sky', 'indigo', 'amber', 'emerald', 'rose', 'sky'];
            return statCard(colors[index], icons[index], labels[index], '…');
        }).join('');
        if (providerBody) providerBody.innerHTML = loadingHTML();
        if (periodBody) periodBody.innerHTML = loadingHTML();
        if (gatewayBody) gatewayBody.innerHTML = loadingHTML();
        if (fundingBody) fundingBody.innerHTML = loadingHTML();

        try {
            const res = await api(`/api/admin/reports${getReportQueryString()}`);
            if (!res.success) throw new Error(res.error || 'Gagal memuat laporan');

            const data = res.data || {};
            const summary = data.summary || {};
            const providerBreakdown = Array.isArray(data.providerBreakdown) ? data.providerBreakdown : [];
            const periodBreakdown = Array.isArray(data.periodBreakdown) ? data.periodBreakdown : [];

            if (caption) {
                caption.textContent = buildReportCaption(summary);
            }

            if (statsGrid) {
                statsGrid.innerHTML = `
                    ${statCard('sky', 'orders', 'Order Sukses', String(summary.successfulOrders ?? 0))}
                    ${statCard('indigo', 'revenue', 'Omzet Total', formatRupiahFull(summary.totalOrderRevenue ?? 0))}
                    ${statCard('amber', 'provider', 'HPP Provider', formatRupiahFull(summary.totalProviderHpp ?? 0), 'Akumulasi harga real provider')}
                    ${statCard('emerald', 'revenue', 'Margin Kotor', formatRupiahFull(summary.grossMargin ?? 0), `${formatPercent(summary.grossMarginPercent ?? 0)} dari omzet`)}
                    ${statCard('rose', 'provider', 'Saldo Provider', formatRupiahFull(summary.providerBalanceIdr ?? 0), Array.isArray(summary.providerBalances) ? summary.providerBalances.map((item) => `${item.serverLabel}: $${Number(item.balanceUsd || 0).toFixed(2)}`).join(' • ') : '')}
                    ${statCard('sky', 'revenue', 'Gateway Masuk', formatRupiahFull(summary.totalGatewayPaid ?? 0), `${Number(summary.paidInvoiceCount ?? 0)} invoice PAID`)}
                `;
            }

            if (periodBody) {
                periodBody.innerHTML = renderReportPeriodTable(periodBreakdown, reportRangeState.bucket);
            }

            if (providerBody) {
                providerBody.innerHTML = renderReportProviderTable(providerBreakdown);
            }

            if (gatewayBody) {
                gatewayBody.innerHTML = renderGatewaySummary(summary);
            }

            if (fundingBody) {
                fundingBody.innerHTML = renderProviderFundingSummary(summary, providerBreakdown);
            }
        } catch (err) {
            const message = err?.message || 'Gagal memuat laporan';
            if (statsGrid) statsGrid.innerHTML = statCard('rose', 'provider', 'Laporan', 'Error', message);
            if (providerBody) providerBody.innerHTML = errorHTML(message);
            if (periodBody) periodBody.innerHTML = errorHTML(message);
            if (gatewayBody) gatewayBody.innerHTML = errorHTML(message);
            if (fundingBody) fundingBody.innerHTML = errorHTML(message);
        }
    }

    function buildReportCaption(summary) {
        const parts = [];
        if (summary.reportDateFrom) {
            parts.push(`Mulai ${formatReportDate(summary.reportDateFrom)}`);
        }
        if (summary.reportDateTo) {
            parts.push(`sampai ${formatReportDate(summary.reportDateTo)}`);
        }
        parts.push(`kelompok ${formatReportBucketLabel(summary.bucket || reportRangeState.bucket)}`);
        parts.push('preset harian dihitung dari jam 00.00 WIB');
        return parts.join(' • ');
    }

    function renderReportPeriodTable(rows, bucket) {
        if (!rows.length) {
            return emptyHTML('Belum ada order sukses pada rentang laporan ini');
        }

        return `
            <table class="data-table">
                <thead><tr>
                    <th>Periode</th><th>Order Sukses</th><th>Omzet</th><th>HPP</th><th>Margin Kotor</th>
                </tr></thead>
                <tbody>
                    ${rows.map((row) => `
                        <tr>
                            <td class="fw-600">${escText(formatReportBucketValue(row.bucketStart, bucket))}</td>
                            <td class="mono">${Number(row.successfulOrders ?? 0)}</td>
                            <td class="mono text-indigo fw-600">${formatRupiahFull(row.totalOrderRevenue ?? 0)}</td>
                            <td class="mono text-amber fw-600">${formatRupiahFull(row.totalProviderHpp ?? 0)}</td>
                            <td class="mono text-emerald fw-600">${formatRupiahFull(row.grossMargin ?? 0)}</td>
                        </tr>
                    `).join('')}
                </tbody>
            </table>
            <div class="report-table-note">Rekap periode mengikuti zona waktu WIB untuk pelaporan harian dari jam 00.00.</div>
        `;
    }

    function renderReportProviderTable(rows) {
        if (!rows.length) {
            return emptyHTML('Belum ada order sukses pada rentang laporan ini');
        }

        return `
            <table class="data-table">
                <thead><tr>
                    <th>Server</th><th>Provider</th><th>Order Sukses</th><th>Omzet</th><th>HPP</th><th>Margin Kotor</th>
                </tr></thead>
                <tbody>
                    ${rows.map((row) => `
                        <tr>
                            <td><span class="badge info">${escText(row.serverLabel || row.providerKey || 'Server')}</span></td>
                            <td class="fw-600">${escText(row.providerLabel || row.providerKey || 'Provider')}</td>
                            <td class="mono">${Number(row.successfulOrders ?? 0)}</td>
                            <td class="mono text-indigo fw-600">${formatRupiahFull(row.totalOrderRevenue ?? 0)}</td>
                            <td class="mono text-amber fw-600">${formatRupiahFull(row.totalProviderHpp ?? 0)}</td>
                            <td class="mono text-emerald fw-600">${formatRupiahFull(row.grossMargin ?? 0)}</td>
                        </tr>
                    `).join('')}
                </tbody>
            </table>
            <div class="report-table-note">HPP per server ini bisa dipakai sebagai patokan pengisian saldo provider.</div>
        `;
    }

    function renderGatewaySummary(summary) {
        return `
            <div class="report-kpi-list">
                <div class="report-kpi-item">
                    <div class="report-kpi-label">Gateway Terkonfigurasi</div>
                    <div class="report-kpi-value">${summary.gatewayConfig?.configured ? 'Aktif' : 'Belum Aktif'}</div>
                    <div class="report-kpi-meta">Metode: ${escText((summary.gatewayConfig?.paymentMethod || '-').toUpperCase())}</div>
                </div>
                <div class="report-kpi-item">
                    <div class="report-kpi-label">Total Deposit Berhasil</div>
                    <div class="report-kpi-value">${formatRupiahFull(summary.totalPaidDeposits ?? 0)}</div>
                    <div class="report-kpi-meta">Dana bersih yang masuk ke saldo user pada periode ini.</div>
                </div>
                <div class="report-kpi-item">
                    <div class="report-kpi-label">Total Fee Gateway</div>
                    <div class="report-kpi-value">${formatRupiahFull(summary.totalGatewayFees ?? 0)}</div>
                    <div class="report-kpi-meta">Akumulasi biaya payment gateway yang tercatat dari invoice PAID.</div>
                </div>
                <div class="report-kpi-item">
                    <div class="report-kpi-label">Total Nominal Dibayar</div>
                    <div class="report-kpi-value">${formatRupiahFull(summary.totalGatewayPaid ?? 0)}</div>
                    <div class="report-kpi-meta">Termasuk base amount dan gateway fee.</div>
                </div>
            </div>
            <div class="report-note">${escText(summary.paymentGatewayBalanceNote || 'Saldo payment gateway belum tersedia via API saat ini.')}</div>
        `;
    }

    function renderProviderFundingSummary(summary, rows) {
        const rowsHtml = rows.length
            ? rows.map((row) => `
                <div class="report-kpi-item">
                    <div class="report-kpi-label">${escText(row.serverLabel || row.providerLabel || row.providerKey)}</div>
                    <div class="report-kpi-value">${formatRupiahFull(row.totalProviderHpp ?? 0)}</div>
                    <div class="report-kpi-meta">HPP sukses ${Number(row.successfulOrders ?? 0)} order • Omzet ${formatRupiahFull(row.totalOrderRevenue ?? 0)}</div>
                </div>
            `).join('')
            : `
                <div class="report-kpi-item">
                    <div class="report-kpi-label">Belum ada data HPP</div>
                    <div class="report-kpi-value">Rp 0</div>
                    <div class="report-kpi-meta">Belum ada order sukses pada rentang ini.</div>
                </div>
            `;

        return `
            <div class="report-kpi-list">
                <div class="report-kpi-item">
                    <div class="report-kpi-label">Total HPP Provider</div>
                    <div class="report-kpi-value">${formatRupiahFull(summary.totalProviderHpp ?? 0)}</div>
                    <div class="report-kpi-meta">Gunakan angka ini sebagai acuan total biaya real provider pada periode laporan.</div>
                </div>
                ${rowsHtml}
            </div>
        `;
    }

    function formatPercent(value) {
        const number = Number(value || 0);
        if (!Number.isFinite(number)) return '0%';
        return `${number.toLocaleString('id-ID', { minimumFractionDigits: number % 1 ? 2 : 0, maximumFractionDigits: 2 })}%`;
    }

    function formatReportBucketLabel(bucket) {
        if (bucket === 'week') return 'mingguan';
        if (bucket === 'month') return 'bulanan';
        return 'harian';
    }

    function formatReportDate(value) {
        return new Date(value).toLocaleString('id-ID', {
            day: '2-digit',
            month: 'short',
            year: 'numeric',
            hour: '2-digit',
            minute: '2-digit',
        });
    }

    function parseReportLocalDate(value) {
        if (typeof value !== 'string') return new Date(value);
        if (/^\d{4}-\d{2}$/.test(value)) {
            const [year, month] = value.split('-').map(Number);
            return new Date(year, month - 1, 1);
        }
        if (/^\d{4}-\d{2}-\d{2}$/.test(value)) {
            const [year, month, day] = value.split('-').map(Number);
            return new Date(year, month - 1, day);
        }
        return new Date(value);
    }

    function formatReportBucketValue(value, bucket) {
        const date = parseReportLocalDate(value);
        if (bucket === 'month') {
            return date.toLocaleDateString('id-ID', { month: 'long', year: 'numeric' });
        }
        if (bucket === 'week') {
            const end = new Date(date);
            end.setDate(end.getDate() + 6);
            return `${date.toLocaleDateString('id-ID', { day: '2-digit', month: 'short', year: 'numeric' })} - ${end.toLocaleDateString('id-ID', { day: '2-digit', month: 'short', year: 'numeric' })}`;
        }
        return date.toLocaleDateString('id-ID', { day: '2-digit', month: 'short', year: 'numeric' });
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
    let invoiceCountdownTimer = null;

    window.loadInvoices = async function () {
        const body = document.getElementById('invoicesTableBody');
        body.innerHTML = loadingHTML();
        document.getElementById('invoiceStats').style.display = 'none';

        try {
            const limit = document.getElementById('invoiceLimitFilter')?.value || '50';
            const res = await api(`/api/admin/invoices?limit=${encodeURIComponent(limit)}`);
            if (!res.success) throw new Error(res.error || 'Gagal memuat invoice');
            _invoicesData = res.data || [];
            renderInvoiceStats(_invoicesData);
            renderInvoicesTable(applyInvoiceFilter(_invoicesData));
            startInvoiceCountdownTimer();
        } catch (err) {
            body.innerHTML = errorHTML(err.message);
        }
    };

    function getInvoiceStatus(invoice) {
        if (
            invoice.status === 'PENDING' &&
            invoice.expiredAt &&
            new Date(invoice.expiredAt).getTime() <= Date.now()
        ) {
            return 'EXPIRED';
        }
        return invoice.status;
    }

    function applyInvoiceFilter(data) {
        const statusFilter = document.getElementById('invoiceStatusFilter').value;
        const q = document.getElementById('invoiceSearchInput').value.toLowerCase();
        return data.filter(i => {
            const matchStatus = !statusFilter || getInvoiceStatus(i) === statusFilter;
            const matchSearch = !q ||
                (i.user?.telegramId || '').includes(q) ||
                (i.id || '').toLowerCase().includes(q);
            return matchStatus && matchSearch;
        });
    }

    window.filterInvoicesTable = function () {
        renderInvoiceStats(_invoicesData);
        renderInvoicesTable(applyInvoiceFilter(_invoicesData));
    };

    function renderInvoiceStats(data) {
        const stats = document.getElementById('invoiceStats');
        const paid = data.filter(i => getInvoiceStatus(i) === 'PAID');
        const revenue = paid.reduce((s, i) => s + (i.baseAmount || i.amount), 0);
        document.getElementById('inv-total').textContent = data.length;
        document.getElementById('inv-paid').textContent = paid.length;
        document.getElementById('inv-pending').textContent = data.filter(i => getInvoiceStatus(i) === 'PENDING').length;
        document.getElementById('inv-expired').textContent = data.filter(i => getInvoiceStatus(i) === 'EXPIRED').length;
        document.getElementById('inv-revenue').textContent = formatRupiah(revenue);
        stats.style.display = 'flex';
    }

    function invoiceExpiryText(invoice) {
        if (!invoice.expiredAt) return '—';
        const status = getInvoiceStatus(invoice);
        if (status === 'PAID') return 'Paid';
        if (status === 'EXPIRED') return 'Expired';

        const remainingMs = new Date(invoice.expiredAt).getTime() - Date.now();
        if (remainingMs <= 0) return 'Expired';

        const minutes = Math.floor(remainingMs / 60000);
        const seconds = Math.floor((remainingMs % 60000) / 1000);
        return `${minutes}m ${String(seconds).padStart(2, '0')}s`;
    }

    function renderInvoicesTable(data) {
        const body = document.getElementById('invoicesTableBody');
        if (!data.length) { body.innerHTML = emptyHTML('Tidak ada invoice yang sesuai'); return; }

        body.innerHTML = `
            <table class="data-table">
                <thead><tr>
                    <th>ID</th><th>User</th><th>Jumlah Asli</th><th>Jumlah Final</th>
                    <th>Gateway</th><th>Status</th><th>Expired</th><th>Dibuat</th><th>Dibayar</th>
                </tr></thead>
                <tbody>
                    ${data.map(i => {
                        const status = getInvoiceStatus(i);
                        return `<tr>
                        <td>${idChip(i.id)}</td>
                        <td class="mono text-indigo">${i.user?.telegramId || '—'}</td>
                        <td class="mono">${formatRupiahFull(i.baseAmount)}</td>
                        <td class="mono ${status === 'PAID' ? 'text-emerald fw-600' : 'text-amber'}">${formatRupiahFull(i.amount)}</td>
                        <td class="text-sm">${escText(i.provider || 'â€”')}<br><span class="text-muted">${escText((i.paymentMethod || '').toUpperCase() || 'â€”')}</span></td>
                        <td>${statusBadge(status)}</td>
                        <td class="text-sm ${status === 'PENDING' ? 'text-amber' : status === 'EXPIRED' ? 'text-muted' : 'text-emerald'}">${invoiceExpiryText(i)}</td>
                        <td class="text-muted text-sm">${formatDateShort(i.createdAt)}</td>
                        <td class="${i.paidAt ? 'text-emerald' : 'text-muted'} text-sm">${i.paidAt ? formatDateShort(i.paidAt) : '—'}</td>
                    </tr>`;
                    }).join('')}
                </tbody>
            </table>`;
    }

    function startInvoiceCountdownTimer() {
        if (invoiceCountdownTimer) return;
        invoiceCountdownTimer = setInterval(() => {
            const invoicePageActive = document.getElementById('page-invoices')?.classList.contains('active');
            if (!invoicePageActive || !_invoicesData.some(i => i.status === 'PENDING' && i.expiredAt)) return;
            renderInvoiceStats(_invoicesData);
            renderInvoicesTable(applyInvoiceFilter(_invoicesData));
        }, 1000);
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
                (t.displayUser || '').toLowerCase().includes(q) ||
                (t.displaySubtext || '').toLowerCase().includes(q) ||
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
                        <td>
                            <div class="mono text-indigo fw-600">${escText(t.displayUser || t.user?.telegramId || '—')}</div>
                            <div class="text-sm text-muted">${escText(t.displaySubtext || '—')}</div>
                        </td>
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
    let _serviceProviderFilter = 'all';

    window.loadPricingSettings = async function (forceRefresh = false) {
        const multiplierInput = document.getElementById('sellMultiplierInput');
        const protectionInput = document.getElementById('pricingProtectionPercentInput');
        const effectiveRateEl = document.getElementById('pricingEffectiveRate');
        const rateMetaEl = document.getElementById('pricingRateMeta');
        const bufferEl = document.getElementById('pricingBuffer');
        const sourceEl = document.getElementById('pricingRateSource');

        if (!multiplierInput || !protectionInput || !effectiveRateEl || !rateMetaEl || !bufferEl || !sourceEl) return;

        effectiveRateEl.textContent = '...';
        rateMetaEl.textContent = 'Memuat kurs...';

        try {
            const res = forceRefresh
                ? await api('/api/admin/settings/pricing/refresh-rate', { method: 'POST', body: '{}' })
                : await api('/api/admin/settings/pricing');
            if (!res.success) throw new Error(res.error || 'Gagal memuat pricing');

            const settings = res.data;
            const rate = settings.usdIdrRate || {};
            multiplierInput.value = settings.sellPriceMultiplier;
            protectionInput.value = Number(settings.pricingProtectionPercent || 0);
            effectiveRateEl.textContent = formatRupiahFull(rate.effectiveRate);
            rateMetaEl.textContent = `Kurs referensi ${formatRupiahFull(rate.baseRate)} dari ${rate.autoEnabled ? 'otomatis' : 'fallback .env'}`;
            bufferEl.textContent = `${Number(settings.pricingProtectionPercent || 0).toFixed(1).replace(/\.0$/, '')}%`;
            sourceEl.textContent = rate.error
                ? `Fallback aktif: ${rate.error}`
                : `Sumber: ${rate.source} • Hanya memengaruhi harga jual provider USD`;
        } catch (err) {
            effectiveRateEl.textContent = '—';
            rateMetaEl.textContent = err.message;
            sourceEl.textContent = 'Gagal memuat kurs';
        }
    };

    window.savePricingSettings = async function () {
        const input = document.getElementById('sellMultiplierInput');
        const protectionInput = document.getElementById('pricingProtectionPercentInput');
        const btn = document.getElementById('savePricingBtn');
        const sellPriceMultiplier = Number(input.value);
        const pricingProtectionPercent = Number(protectionInput.value);

        if (!Number.isFinite(sellPriceMultiplier) || sellPriceMultiplier < 1 || sellPriceMultiplier > 20) {
            showToast('Margin multiplier harus di antara 1 sampai 20', 'warning');
            return;
        }
        if (!Number.isFinite(pricingProtectionPercent) || pricingProtectionPercent < 0 || pricingProtectionPercent > 100) {
            showToast('Proteksi pricing harus di antara 0 sampai 100%', 'warning');
            return;
        }

        btn.disabled = true;
        btn.textContent = 'Menyimpan...';

        try {
            const res = await api('/api/admin/settings/pricing', {
                method: 'PATCH',
                body: JSON.stringify({ sellPriceMultiplier, pricingProtectionPercent }),
            });
            if (!res.success) throw new Error(res.error || 'Gagal menyimpan margin');

            showToast(res.message || 'Margin berhasil disimpan');
            await loadPricingSettings();
            await loadServices();
        } catch (err) {
            showToast(err.message, 'error');
        } finally {
            btn.disabled = false;
            btn.textContent = 'Simpan';
        }
    };

    window.loadReferralSettings = async function () {
        const enabledInput = document.getElementById('referralEnabledInput');
        const rewardInput = document.getElementById('referralRewardAmountInput');
        if (!enabledInput || !rewardInput) return;

        try {
            const res = await api('/api/admin/settings/referral');
            if (!res.success) throw new Error(res.error || 'Gagal memuat referral');

            enabledInput.value = String(Boolean(res.data?.enabled));
            rewardInput.value = Number(res.data?.rewardAmount || 0);
        } catch (err) {
            showToast(err.message || 'Gagal memuat referral', 'error');
        }
    };

    window.saveReferralSettings = async function () {
        const btn = document.getElementById('saveReferralBtn');
        const payload = {
            enabled: document.getElementById('referralEnabledInput')?.value === 'true',
            rewardAmount: Number(document.getElementById('referralRewardAmountInput')?.value || 0),
        };

        if (!Number.isFinite(payload.rewardAmount) || payload.rewardAmount < 0) {
            showToast('Bonus referral harus berupa angka 0 atau lebih', 'warning');
            return;
        }

        btn.disabled = true;
        btn.textContent = 'Menyimpan...';

        try {
            const res = await api('/api/admin/settings/referral', {
                method: 'PATCH',
                body: JSON.stringify(payload),
            });
            if (!res.success) throw new Error(res.error || 'Gagal menyimpan referral');
            showToast(res.message || 'Pengaturan referral berhasil disimpan');
            await loadReferralSettings();
        } catch (err) {
            showToast(err.message || 'Gagal menyimpan referral', 'error');
        } finally {
            btn.disabled = false;
            btn.textContent = 'Simpan Referral';
        }
    };

    window.loadPaymentSettings = async function () {
        const minimumInput = document.getElementById('minimumDepositInput');
        const maximumInfo = document.getElementById('maximumDepositInfo');

        try {
            const res = await api('/api/admin/settings/payment');
            if (!res.success) throw new Error(res.error || 'Gagal memuat pengaturan deposit');
            minimumInput.value = String(res.data?.minimumDeposit ?? 10000);
            maximumInfo.value = formatRupiahFull(res.data?.maximumDeposit ?? 10000000);
        } catch (err) {
            showToast(err.message || 'Gagal memuat pengaturan deposit', 'error');
        }
    };

    window.savePaymentSettings = async function () {
        const btn = document.getElementById('savePaymentSettingsBtn');
        const minimumDeposit = Number(document.getElementById('minimumDepositInput')?.value || 0);

        if (!Number.isInteger(minimumDeposit) || minimumDeposit < 1000) {
            showToast('Minimum deposit harus minimal Rp 1.000', 'warning');
            return;
        }

        btn.disabled = true;
        btn.textContent = 'Menyimpan...';

        try {
            const res = await api('/api/admin/settings/payment', {
                method: 'PATCH',
                body: JSON.stringify({ minimumDeposit }),
            });
            if (!res.success) throw new Error(res.error || 'Gagal menyimpan minimum deposit');
            showToast(res.message || 'Minimum deposit berhasil disimpan');
            await loadPaymentSettings();
        } catch (err) {
            showToast(err.message || 'Gagal menyimpan minimum deposit', 'error');
        } finally {
            btn.disabled = false;
            btn.textContent = 'Simpan Minimum';
        }
    };

    window.loadSmtpSettings = async function () {
        const transportInput = document.getElementById('emailTransportInput');
        const hostInput = document.getElementById('smtpHostInput');
        const portInput = document.getElementById('smtpPortInput');
        const secureInput = document.getElementById('smtpSecureInput');
        const usernameInput = document.getElementById('smtpUsernameInput');
        const passwordInput = document.getElementById('smtpPasswordInput');
        const apiKeyInput = document.getElementById('brevoApiKeyInput');
        const resendApiKeyInput = document.getElementById('resendApiKeyInput');
        const fromNameInput = document.getElementById('smtpFromNameInput');
        const fromEmailInput = document.getElementById('smtpFromEmailInput');

        if (!transportInput || !hostInput || !portInput || !secureInput || !usernameInput || !passwordInput || !apiKeyInput || !resendApiKeyInput || !fromNameInput || !fromEmailInput) return;

        try {
            const res = await api('/api/admin/settings/smtp');
            if (!res.success) throw new Error(res.error || 'Gagal memuat SMTP');

            const settings = res.data || {};
            transportInput.value = settings.transport || 'smtp';
            hostInput.value = settings.host || '';
            portInput.value = settings.port || 587;
            secureInput.value = String(Boolean(settings.secure));
            usernameInput.value = settings.username || '';
            passwordInput.value = settings.password || '';
            apiKeyInput.value = settings.apiKey || '';
            resendApiKeyInput.value = settings.resendApiKey || '';
            fromNameInput.value = settings.fromName || 'NokosHUB';
            fromEmailInput.value = settings.fromEmail || '';
            syncEmailTransportFields();
        } catch (err) {
            showToast(err.message || 'Gagal memuat SMTP', 'error');
        }
    };

    window.syncEmailTransportFields = function () {
        const transport = document.getElementById('emailTransportInput')?.value || 'smtp';
        const smtpConnectionRow = document.getElementById('smtpConnectionRow');
        const smtpCredentialsRow = document.getElementById('smtpCredentialsRow');
        const brevoApiRow = document.getElementById('brevoApiRow');
        const resendApiRow = document.getElementById('resendApiRow');
        const resendApiLabel = document.querySelector('label[for="resendApiKeyInput"]');

        const useSmtp = transport === 'smtp';
        const useBrevoApi = transport === 'brevo_api';
        const useResendApi = transport === 'resend_api';
        if (smtpConnectionRow) smtpConnectionRow.hidden = !useSmtp;
        if (smtpCredentialsRow) smtpCredentialsRow.hidden = !useSmtp;
        if (brevoApiRow) brevoApiRow.hidden = !useBrevoApi;
        if (resendApiRow) resendApiRow.hidden = false;
        if (resendApiLabel) {
            resendApiLabel.textContent = useResendApi
                ? 'Resend API Key'
                : 'Resend API Key (Backup Opsional)';
        }
    };

    window.saveSmtpSettings = async function () {
        const btn = document.getElementById('saveSmtpBtn');
        const payload = {
            transport: document.getElementById('emailTransportInput')?.value || 'smtp',
            host: document.getElementById('smtpHostInput')?.value.trim() || '',
            port: Number(document.getElementById('smtpPortInput')?.value || 587),
            secure: document.getElementById('smtpSecureInput')?.value === 'true',
            username: document.getElementById('smtpUsernameInput')?.value.trim() || '',
            password: document.getElementById('smtpPasswordInput')?.value || '',
            apiKey: document.getElementById('brevoApiKeyInput')?.value.trim() || '',
            resendApiKey: document.getElementById('resendApiKeyInput')?.value.trim() || '',
            fromName: document.getElementById('smtpFromNameInput')?.value.trim() || 'NokosHUB',
            fromEmail: document.getElementById('smtpFromEmailInput')?.value.trim() || '',
        };

        if (!payload.fromEmail) {
            showToast('Lengkapi email pengirim terlebih dahulu', 'warning');
            return;
        }

        if (payload.transport === 'brevo_api') {
            if (!payload.apiKey) {
                showToast('Isi Brevo API key terlebih dahulu', 'warning');
                return;
            }
        } else if (payload.transport === 'resend_api') {
            if (!payload.resendApiKey) {
                showToast('Isi Resend API key terlebih dahulu', 'warning');
                return;
            }
        } else if (!payload.host || !payload.username || !payload.password) {
            showToast('Lengkapi host, username, password, dan email pengirim SMTP', 'warning');
            return;
        }

        btn.disabled = true;
        btn.textContent = 'Menyimpan...';

        try {
            const res = await api('/api/admin/settings/smtp', {
                method: 'PATCH',
                body: JSON.stringify(payload),
            });
            if (!res.success) throw new Error(res.error || 'Gagal menyimpan SMTP');
            showToast(res.message || 'Konfigurasi email berhasil disimpan');
            await loadSmtpSettings();
        } catch (err) {
            showToast(err.message || 'Gagal menyimpan SMTP', 'error');
        } finally {
            btn.disabled = false;
            btn.textContent = 'Simpan SMTP';
        }
    };

    window.sendSmtpTestEmail = async function () {
        const btn = document.getElementById('testSmtpBtn');
        const to = document.getElementById('smtpTestEmailInput')?.value.trim() || '';

        if (!to) {
            showToast('Isi email tujuan test terlebih dahulu', 'warning');
            return;
        }

        btn.disabled = true;
        btn.textContent = 'Mengirim...';

        try {
            const res = await api('/api/admin/settings/smtp/test', {
                method: 'POST',
                body: JSON.stringify({ to }),
            });
            if (!res.success) throw new Error(res.error || 'Gagal mengirim email test');
            showToast(res.message || 'Email test berhasil dikirim');
        } catch (err) {
            showToast(err.message || 'Gagal mengirim email test', 'error');
        } finally {
            btn.disabled = false;
            btn.textContent = 'Kirim Email Test';
        }
    };

    window.loadCsBotSettings = async function () {
        const modelInput = document.getElementById('csBotModelInput');
        const apiKeyInput = document.getElementById('csBotApiKeyInput');
        const siteUrlInput = document.getElementById('csBotSiteUrlInput');
        const siteNameInput = document.getElementById('csBotSiteNameInput');
        const knowledgePromptInput = document.getElementById('csBotKnowledgePromptInput');
        if (!modelInput || !apiKeyInput || !siteUrlInput || !siteNameInput || !knowledgePromptInput) return;

        try {
            const res = await api('/api/admin/settings/cs-bot');
            if (!res.success) throw new Error(res.error || 'Gagal memuat pengaturan AI Customer Service');

            const settings = res.data || {};
            modelInput.value = settings.model || 'openai/gpt-oss-20b:free';
            apiKeyInput.value = settings.apiKey || '';
            siteUrlInput.value = settings.siteUrl || '';
            siteNameInput.value = settings.siteName || 'NokosHUB CS Bot';
            knowledgePromptInput.value = settings.knowledgePrompt || '';
        } catch (err) {
            showToast(err.message || 'Gagal memuat pengaturan AI Customer Service', 'error');
        }
    };

    window.saveCsBotSettings = async function () {
        const btn = document.getElementById('saveCsBotBtn');
        const payload = {
            model: document.getElementById('csBotModelInput')?.value.trim() || 'openai/gpt-oss-20b:free',
            apiKey: document.getElementById('csBotApiKeyInput')?.value.trim() || '',
            siteUrl: document.getElementById('csBotSiteUrlInput')?.value.trim() || '',
            siteName: document.getElementById('csBotSiteNameInput')?.value.trim() || '',
            knowledgePrompt: document.getElementById('csBotKnowledgePromptInput')?.value.trim() || '',
        };

        if (!payload.model) {
            showToast('Model OpenRouter wajib diisi', 'warning');
            return;
        }

        btn.disabled = true;
        btn.textContent = 'Menyimpan...';

        try {
            const res = await api('/api/admin/settings/cs-bot', {
                method: 'PATCH',
                body: JSON.stringify(payload),
            });
            if (!res.success) throw new Error(res.error || 'Gagal menyimpan pengaturan AI Customer Service');
            showToast(res.message || 'Pengaturan AI Customer Service berhasil disimpan');
            await loadCsBotSettings();
        } catch (err) {
            showToast(err.message || 'Gagal menyimpan pengaturan AI Customer Service', 'error');
        } finally {
            btn.disabled = false;
            btn.textContent = 'Simpan Pengaturan AI';
        }
    };

    window.loadPromoSettings = async function () {
        const enabledInput = document.getElementById('promoEnabledInput');
        const titleInput = document.getElementById('promoTitleInput');
        const descriptionInput = document.getElementById('promoDescriptionInput');
        const minimumDepositInput = document.getElementById('promoMinimumDepositInput');
        const bonusAmountInput = document.getElementById('promoBonusAmountInput');
        const topupUrlInput = document.getElementById('promoTopupUrlInput');
        const claimInstructionsInput = document.getElementById('promoClaimInstructionsInput');
        if (!enabledInput || !titleInput || !descriptionInput || !minimumDepositInput || !bonusAmountInput || !topupUrlInput || !claimInstructionsInput) return;

        try {
            const res = await api('/api/admin/settings/promo');
            if (!res.success) throw new Error(res.error || 'Gagal memuat pengaturan promo');

            const settings = res.data || {};
            enabledInput.value = String(Boolean(settings.enabled));
            titleInput.value = settings.title || 'Promo Deposit NokosHUB';
            descriptionInput.value = settings.description || '';
            minimumDepositInput.value = String(settings.minimumDeposit || 20000);
            bonusAmountInput.value = String(settings.bonusAmount || 2000);
            topupUrlInput.value = settings.topupUrl || 'https://nokoshub.store/user/#topup';
            claimInstructionsInput.value = settings.claimInstructions || '';
        } catch (err) {
            showToast(err.message || 'Gagal memuat pengaturan promo', 'error');
        }
    };

    window.savePromoSettings = async function () {
        const btn = document.getElementById('savePromoBtn');
        const payload = {
            enabled: document.getElementById('promoEnabledInput')?.value === 'true',
            title: document.getElementById('promoTitleInput')?.value.trim() || '',
            description: document.getElementById('promoDescriptionInput')?.value.trim() || '',
            minimumDeposit: Number(document.getElementById('promoMinimumDepositInput')?.value || 0),
            bonusAmount: Number(document.getElementById('promoBonusAmountInput')?.value || 0),
            topupUrl: document.getElementById('promoTopupUrlInput')?.value.trim() || '',
            claimInstructions: document.getElementById('promoClaimInstructionsInput')?.value.trim() || '',
        };

        if (!payload.title || !payload.description || !payload.topupUrl || !payload.claimInstructions) {
            showToast('Semua field promo wajib diisi', 'warning');
            return;
        }

        if (!payload.minimumDeposit || payload.minimumDeposit < 1000) {
            showToast('Minimal deposit promo harus di atas Rp1.000', 'warning');
            return;
        }

        if (payload.bonusAmount < 0) {
            showToast('Bonus promo tidak boleh negatif', 'warning');
            return;
        }

        btn.disabled = true;
        btn.textContent = 'Menyimpan...';

        try {
            const res = await api('/api/admin/settings/promo', {
                method: 'PATCH',
                body: JSON.stringify(payload),
            });
            if (!res.success) throw new Error(res.error || 'Gagal menyimpan pengaturan promo');
            showToast(res.message || 'Pengaturan promo berhasil disimpan');
            await loadPromoSettings();
        } catch (err) {
            showToast(err.message || 'Gagal menyimpan pengaturan promo', 'error');
        } finally {
            btn.disabled = false;
            btn.textContent = 'Simpan Promo';
        }
    };

    // ═══════════════════════════════════════════════════════════════════════════
    //  ANNOUNCEMENT PAGE
    // ═══════════════════════════════════════════════════════════════════════════
    window.loadAnnouncementSettings = async function () {
        const enabledInput = document.getElementById('announcementEnabledInput');
        const titleInput = document.getElementById('announcementTitleInput');
        const messageInput = document.getElementById('announcementMessageInput');
        if (!enabledInput || !titleInput || !messageInput) return;

        try {
            const res = await api('/api/admin/settings/announcement');
            if (!res.success) throw new Error(res.error || 'Gagal memuat pengaturan pengumuman');

            const settings = res.data || {};
            enabledInput.value = String(Boolean(settings.enabled));
            titleInput.value = settings.title || 'Pengumuman NokosHUB';
            messageInput.value = settings.message || '';
        } catch (err) {
            showToast(err.message || 'Gagal memuat pengaturan pengumuman', 'error');
        }
    };

    window.saveAnnouncementSettings = async function () {
        const btn = document.getElementById('saveAnnouncementBtn');
        const payload = {
            enabled: document.getElementById('announcementEnabledInput')?.value === 'true',
            title: document.getElementById('announcementTitleInput')?.value.trim() || '',
            message: document.getElementById('announcementMessageInput')?.value.trim() || '',
        };

        if (!payload.title || !payload.message) {
            showToast('Judul dan isi pengumuman wajib diisi', 'warning');
            return;
        }

        btn.disabled = true;
        btn.textContent = 'Menyimpan...';

        try {
            const res = await api('/api/admin/settings/announcement', {
                method: 'PATCH',
                body: JSON.stringify(payload),
            });
            if (!res.success) throw new Error(res.error || 'Gagal menyimpan pengumuman');
            showToast(res.message || 'Pengaturan pengumuman berhasil disimpan');
            await loadAnnouncementSettings();
        } catch (err) {
            showToast(err.message || 'Gagal menyimpan pengumuman', 'error');
        } finally {
            btn.disabled = false;
            btn.textContent = 'Simpan Pengumuman';
        }
    };

    // ═══════════════════════════════════════════════════════════════════════════
    //  NEWSLETTER PAGE
    // ═══════════════════════════════════════════════════════════════════════════
    let _newsletterTemplates = [];

    window.loadNewsletterPage = async function () {
        const templateInput = document.getElementById('newsletterTemplateInput');
        const recipientInput = document.getElementById('newsletterRecipientInput');
        const subjectInput = document.getElementById('newsletterSubjectInput');
        const bodyInput = document.getElementById('newsletterBodyInput');
        if (!templateInput || !recipientInput || !subjectInput || !bodyInput) return;

        recipientInput.value = '';
        subjectInput.value = '';
        bodyInput.value = '';

        try {
            const res = await api('/api/admin/newsletter/templates');
            if (!res.success) throw new Error(res.error || 'Gagal memuat template newsletter');
            _newsletterTemplates = res.data || [];

            templateInput.innerHTML = _newsletterTemplates.map((tpl) => (
                `<option value="${escText(tpl.key)}">${escText(tpl.label)} — ${escText(tpl.description)}</option>`
            )).join('');

            syncNewsletterFields();
            applyNewsletterTemplate();
        } catch (err) {
            showToast(err.message || 'Gagal memuat template newsletter', 'error');
        }
    };

    window.syncNewsletterFields = function () {
        const channel = document.getElementById('newsletterChannelInput')?.value || 'email';
        const audienceInput = document.getElementById('newsletterAudienceInput');
        if (!audienceInput) return;
        const currentAudience = audienceInput.value || 'all_web';
        const recipientGroup = document.getElementById('newsletterRecipientGroup');
        const recipientLabel = document.getElementById('newsletterRecipientLabel');
        const recipientInput = document.getElementById('newsletterRecipientInput');
        const subjectGroup = document.getElementById('newsletterSubjectGroup');

        const options = channel === 'email'
            ? [
                ['all_web', 'Semua User Web'],
                ['single_email', 'Satu Email'],
            ]
            : [
                ['all_bot', 'Semua User Bot Telegram'],
                ['single_telegram', 'Satu Telegram ID'],
            ];

        audienceInput.innerHTML = options.map(([value, label]) => (
            `<option value="${value}">${label}</option>`
        )).join('');

        audienceInput.value = options.some(([value]) => value === currentAudience)
            ? currentAudience
            : options[0][0];

        const audience = audienceInput.value;

        const isSingleEmail = audience === 'single_email';
        const isSingleTelegram = audience === 'single_telegram';
        const needsRecipient = isSingleEmail || isSingleTelegram;

        if (recipientGroup) recipientGroup.hidden = !needsRecipient;
        if (recipientLabel) {
            recipientLabel.textContent = isSingleTelegram ? 'Telegram ID Tujuan' : 'Email Tujuan';
        }
        if (recipientInput) {
            recipientInput.placeholder = isSingleTelegram ? 'Contoh: 123456789' : 'user@example.com';
        }
        if (subjectGroup) subjectGroup.hidden = channel !== 'email';
    };

    window.applyNewsletterTemplate = function () {
        const templateKey = document.getElementById('newsletterTemplateInput')?.value || '';
        const subjectInput = document.getElementById('newsletterSubjectInput');
        const bodyInput = document.getElementById('newsletterBodyInput');
        const template = _newsletterTemplates.find((item) => item.key === templateKey) || _newsletterTemplates[0];
        if (!template || !subjectInput || !bodyInput) return;

        subjectInput.value = template.subject || '';
        bodyInput.value = template.body || '';
    };

    window.sendNewsletter = async function () {
        const btn = document.getElementById('sendNewsletterBtn');
        const channel = document.getElementById('newsletterChannelInput')?.value || 'email';
        const audience = document.getElementById('newsletterAudienceInput')?.value || 'all_web';
        const recipient = document.getElementById('newsletterRecipientInput')?.value.trim() || '';
        const subject = document.getElementById('newsletterSubjectInput')?.value.trim() || '';
        const body = document.getElementById('newsletterBodyInput')?.value.trim() || '';
        const templateKey = document.getElementById('newsletterTemplateInput')?.value || '';

        if (!body || body.length < 8) {
            showToast('Isi pesan minimal 8 karakter', 'warning');
            return;
        }
        if (channel === 'email' && !subject) {
            showToast('Subject email wajib diisi', 'warning');
            return;
        }
        if ((audience === 'single_email' || audience === 'single_telegram') && !recipient) {
            showToast('Isi tujuan terlebih dahulu', 'warning');
            return;
        }

        btn.disabled = true;
        btn.innerHTML = '<span class="spinner-inline"></span> Mengirim...';

        try {
            const res = await api('/api/admin/newsletter/send', {
                method: 'POST',
                body: JSON.stringify({
                    channel,
                    audience,
                    recipient,
                    subject,
                    body,
                    templateKey,
                }),
            });
            if (!res.success) throw new Error(res.error || 'Gagal mengirim newsletter');

            const summary = res.data
                ? ` Berhasil ${res.data.sent}/${res.data.total}${res.data.failed ? `, gagal ${res.data.failed}` : ''}.`
                : '';
            showToast((res.message || 'Newsletter berhasil dikirim') + summary, 'success');
        } catch (err) {
            showToast(err.message || 'Gagal mengirim newsletter', 'error');
        } finally {
            btn.disabled = false;
            btn.innerHTML = `
                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                    <line x1="22" y1="2" x2="11" y2="13"/>
                    <polygon points="22 2 15 22 11 13 2 9 22 2"/>
                </svg>
                Kirim Broadcast`;
        }
    };

    let _seoPagesData = [];

    window.loadSeoPagesPage = async function () {
        const body = document.getElementById('seoPagesListBody');
        if (!body) return;
        body.innerHTML = loadingHTML();

        try {
            const res = await api('/api/admin/seo-pages');
            if (!res.success) throw new Error(res.error || 'Gagal memuat halaman SEO');
            _seoPagesData = res.data || [];
            renderSeoPagesList(_seoPagesData);

            const currentId = document.getElementById('seoPageIdInput')?.value;
            const current = _seoPagesData.find((page) => page.id === currentId);
            if (current) {
                fillSeoPageForm(current);
            } else if (_seoPagesData.length) {
                fillSeoPageForm(_seoPagesData[0]);
            } else {
                createSeoPageDraft();
            }
        } catch (err) {
            body.innerHTML = errorHTML(err.message || 'Gagal memuat halaman SEO');
        }
    };

    window.filterSeoPagesList = function () {
        const q = (document.getElementById('seoPageSearchInput')?.value || '').trim().toLowerCase();
        const filtered = !q
            ? _seoPagesData
            : _seoPagesData.filter((page) => (
                (page.slug || '').toLowerCase().includes(q) ||
                (page.title || '').toLowerCase().includes(q) ||
                (page.heroTitle || '').toLowerCase().includes(q)
            ));
        renderSeoPagesList(filtered);
    };

    window.createSeoPageDraft = function () {
        fillSeoPageForm({
            id: '',
            slug: '',
            title: '',
            metaDescription: '',
            heroBadge: '',
            heroTitle: '',
            intro: '',
            content: '',
            primaryCtaLabel: 'Daftar Gratis',
            primaryCtaHref: '/register/',
            secondaryCtaLabel: 'Lihat FAQ',
            secondaryCtaHref: '/#faq',
            isPublished: true,
        });
    };

    window.previewSeoPage = function () {
        const slug = (document.getElementById('seoPageSlugInput')?.value || '').trim().toLowerCase().replace(/^\/+|\/+$/g, '');
        if (!slug) {
            showToast('Isi slug terlebih dahulu', 'warning');
            return;
        }
        window.open(buildPublicSeoUrl(slug), '_blank', 'noopener');
    };

    window.saveSeoPage = async function () {
        const btn = document.getElementById('saveSeoPageBtn');
        const payload = {
            id: document.getElementById('seoPageIdInput')?.value || undefined,
            slug: document.getElementById('seoPageSlugInput')?.value.trim() || '',
            title: document.getElementById('seoPageTitleInput')?.value.trim() || '',
            metaDescription: document.getElementById('seoPageMetaInput')?.value.trim() || '',
            heroBadge: document.getElementById('seoPageBadgeInput')?.value.trim() || '',
            heroTitle: document.getElementById('seoPageHeroTitleInput')?.value.trim() || '',
            intro: document.getElementById('seoPageIntroInput')?.value.trim() || '',
            content: document.getElementById('seoPageContentInput')?.value.trim() || '',
            primaryCtaLabel: document.getElementById('seoPagePrimaryLabelInput')?.value.trim() || '',
            primaryCtaHref: document.getElementById('seoPagePrimaryHrefInput')?.value.trim() || '',
            secondaryCtaLabel: document.getElementById('seoPageSecondaryLabelInput')?.value.trim() || '',
            secondaryCtaHref: document.getElementById('seoPageSecondaryHrefInput')?.value.trim() || '',
            isPublished: (document.getElementById('seoPagePublishedInput')?.value || 'true') === 'true',
        };

        if (!payload.slug || !payload.title || !payload.metaDescription || !payload.content) {
            showToast('Slug, title, meta description, dan isi artikel wajib diisi', 'warning');
            return;
        }

        btn.disabled = true;
        btn.innerHTML = '<span class="spinner-inline"></span> Menyimpan...';

        try {
            const res = await api('/api/admin/seo-pages', {
                method: 'POST',
                body: JSON.stringify(payload),
            });
            if (!res.success) throw new Error(res.error || 'Gagal menyimpan halaman SEO');
            showToast(res.message || 'Halaman SEO berhasil disimpan', 'success');
            await loadSeoPagesPage();
            fillSeoPageForm(res.data);
        } catch (err) {
            showToast(err.message || 'Gagal menyimpan halaman SEO', 'error');
        } finally {
            btn.disabled = false;
            btn.textContent = 'Simpan Halaman';
        }
    };

    window.deleteSeoPage = async function () {
        const id = document.getElementById('seoPageIdInput')?.value || '';
        if (!id) {
            showToast('Pilih halaman yang ingin dihapus terlebih dahulu', 'warning');
            return;
        }

        openConfirm({
            title: 'Hapus Halaman SEO',
            message: 'Halaman SEO ini akan dihapus dari registry dan URL terkait tidak akan dipublish lagi. Lanjutkan?',
            okText: 'Hapus',
            color: 'danger',
            onOk: async () => {
                try {
                    const res = await api(`/api/admin/seo-pages/${encodeURIComponent(id)}`, { method: 'DELETE' });
                    if (!res.success) throw new Error(res.error || 'Gagal menghapus halaman SEO');
                    showToast(res.message || 'Halaman SEO berhasil dihapus', 'success');
                    createSeoPageDraft();
                    await loadSeoPagesPage();
                } catch (err) {
                    showToast(err.message || 'Gagal menghapus halaman SEO', 'error');
                }
            },
        });
    };

    function renderSeoPagesList(data) {
        const body = document.getElementById('seoPagesListBody');
        if (!body) return;
        if (!data.length) {
            body.innerHTML = emptyHTML('Belum ada halaman SEO. Klik "Halaman Baru" untuk membuat satu.');
            return;
        }

        body.innerHTML = `
            <div style="display:grid;gap:12px">
                ${data.map((page) => `
                    <button class="btn btn-outline" style="justify-content:flex-start;text-align:left;padding:14px 16px;display:block" onclick="selectSeoPage(${escAttr(page.id)})">
                        <div style="display:flex;align-items:center;justify-content:space-between;gap:12px">
                            <strong style="color:var(--text-primary)">${escText(page.heroBadge || page.title)}</strong>
                            <span class="badge ${page.isPublished ? 'success' : 'warning'}">${page.isPublished ? 'Published' : 'Draft'}</span>
                        </div>
                        <div class="mono text-muted" style="margin-top:6px">/${escText(page.slug)}/</div>
                        <div class="text-sm text-muted" style="margin-top:6px">${escText(page.title)}</div>
                    </button>
                `).join('')}
            </div>`;
    }

    window.selectSeoPage = function (id) {
        const page = _seoPagesData.find((item) => item.id === id);
        if (!page) return;
        fillSeoPageForm(page);
    };

    function fillSeoPageForm(page) {
        document.getElementById('seoPageIdInput').value = page.id || '';
        document.getElementById('seoPageSlugInput').value = page.slug || '';
        document.getElementById('seoPageTitleInput').value = page.title || '';
        document.getElementById('seoPageMetaInput').value = page.metaDescription || '';
        document.getElementById('seoPageBadgeInput').value = page.heroBadge || '';
        document.getElementById('seoPageHeroTitleInput').value = page.heroTitle || '';
        document.getElementById('seoPageIntroInput').value = page.intro || '';
        document.getElementById('seoPageContentInput').value = page.content || '';
        document.getElementById('seoPagePrimaryLabelInput').value = page.primaryCtaLabel || 'Daftar Gratis';
        document.getElementById('seoPagePrimaryHrefInput').value = page.primaryCtaHref || '/register/';
        document.getElementById('seoPageSecondaryLabelInput').value = page.secondaryCtaLabel || 'Lihat FAQ';
        document.getElementById('seoPageSecondaryHrefInput').value = page.secondaryCtaHref || '/#faq';
        document.getElementById('seoPagePublishedInput').value = page.isPublished === false ? 'false' : 'true';
    }

    function buildPublicSeoUrl(slug) {
        const host = window.location.host || '';
        const publicHost = host.startsWith('admin.') ? host.slice(6) : host;
        return `${window.location.protocol}//${publicHost}/${slug}/`;
    }

    window.loadServices = async function () {
        const body = document.getElementById('servicesTableBody');
        body.innerHTML = loadingHTML();
        document.getElementById('serviceStats').style.display = 'none';

        try {
            const res = await api('/api/admin/services');
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
            const matchProvider = _serviceProviderFilter === 'all' || (s.providerKey || '') === _serviceProviderFilter;
            return matchStatus && matchSearch && matchProvider;
        });
    }

    window.filterServicesTable = function () {
        renderServicesTable(applyServiceFilter(_servicesData));
    };

    window.setServiceProviderFilter = function (providerKey) {
        _serviceProviderFilter = ['server1', 'herosms'].includes(providerKey) ? providerKey : 'all';
        document.querySelectorAll('[data-service-provider]').forEach((btn) => {
            btn.classList.toggle('active', btn.dataset.serviceProvider === _serviceProviderFilter);
        });
        renderServicesTable(applyServiceFilter(_servicesData));
    };

    function renderServiceStats(data) {
        const statsEl = document.getElementById('serviceStats');
        const active = data.filter(s => s.isActive).length;
        const server1 = data.filter(s => s.providerKey === 'server1').length;
        const server2 = data.filter(s => s.providerKey === 'herosms').length;
        document.getElementById('svc-total').textContent = data.length;
        document.getElementById('svc-active').textContent = `${active} • S1 ${server1}`;
        document.getElementById('svc-inactive').textContent = `${data.length - active} • S2 ${server2}`;
        statsEl.style.display = 'flex';
    }

    function renderServicesTable(data) {
        const body = document.getElementById('servicesTableBody');
        if (!data.length) { body.innerHTML = emptyHTML('Tidak ada layanan. Coba sync dari provider.'); return; }

        const groups = [
            { key: 'server1', title: 'Server 1', fallbackProvider: 'Provider Baru' },
            { key: 'herosms', title: 'Server 2', fallbackProvider: 'HeroSMS' },
        ];

        const visibleGroups = _serviceProviderFilter === 'all'
            ? groups
            : groups.filter((group) => group.key === _serviceProviderFilter);

        body.innerHTML = visibleGroups.map((group) => {
            const items = data.filter((service) => (service.providerKey || '') === group.key);
            if (!items.length) {
                return `
                    <div class="service-group">
                        <div class="service-group-head">
                            <div class="service-group-title">
                                <span class="badge info">${group.title}</span>
                                <span>${group.fallbackProvider}</span>
                            </div>
                            <div class="service-group-count">0 layanan</div>
                        </div>
                        ${emptyHTML(`Belum ada layanan untuk ${group.title}. Jalankan sync provider.`)}
                    </div>
                `;
            }

            return `
                <div class="service-group">
                    <div class="service-group-head">
                        <div class="service-group-title">
                            <span class="badge info">${items[0].serverLabel || group.title}</span>
                            <span>${items[0].providerLabel || group.fallbackProvider}</span>
                        </div>
                        <div class="service-group-count">${items.length} layanan</div>
                    </div>
                    <table class="data-table">
                        <thead><tr><th>Kode</th><th>Nama Layanan</th><th>Status</th><th>Aksi</th></tr></thead>
                        <tbody>
                            ${items.map(s => `<tr>
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
                    </table>
                </div>
            `;
        }).join('');
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
            message: 'Proses sync akan berjalan di background dan bisa memakan waktu 2–4 menit. Data layanan & harga akan diperbarui dari seluruh provider OTP yang aktif.',
            okText: 'Mulai Sync',
            color: 'primary',
            onOk: async () => {
                const btn = document.getElementById('syncBtn');
                btn.disabled = true;
                btn.innerHTML = '<span class="spinner-inline"></span> Syncing…';

                try {
                    const res = await api('/api/admin/maintenance/action', {
                        method: 'POST',
                        body: JSON.stringify({ action: 'sync_provider' }),
                    });
                    if (!res.success) throw new Error(res.error || 'Sync gagal');
                    await Promise.all([
                        loadPricingSettings(true),
                        loadServices(),
                    ]);
                    showToast(res.message || 'Sync provider selesai dijalankan', 'success');
                } catch (err) {
                    showToast(err.message || 'Sync gagal', 'error');
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
    let _userAccountFilter = 'ALL';

    window.loadUsers = async function () {
        const body = document.getElementById('usersTableBody');
        const stats = document.getElementById('userStats');
        body.innerHTML = loadingHTML();
        if (stats) stats.style.display = 'none';
        _usersMap = new Map();

        try {
            const res = await api('/api/admin/users?limit=500');
            if (!res.success) throw new Error(res.error || 'Gagal memuat data user');
            for (const user of res.data || []) {
                _usersMap.set(user.id, user);
            }
            renderUserStats([..._usersMap.values()]);
            renderUsersTable(applyUsersFilter());
        } catch (err) {
            body.innerHTML = errorHTML(err.message);
        }
    };

    window.setUserAccountFilter = function (filter) {
        _userAccountFilter = filter;
        document.querySelectorAll('[data-user-filter]').forEach((btn) => {
            btn.classList.toggle('active', btn.dataset.userFilter === filter);
        });
        renderUsersTable(applyUsersFilter());
    };

    function applyUsersFilter() {
        const q = document.getElementById('userSearchInput').value.toLowerCase();
        return [..._usersMap.values()].filter(u => {
            const matchesQuery =
                (u.email || '').toLowerCase().includes(q) ||
                (u.telegramId || '').includes(q) ||
                (u.username || '').toLowerCase().includes(q) ||
                (`${u.firstName || ''} ${u.lastName || ''}`).toLowerCase().includes(q);
            const matchesType = _userAccountFilter === 'ALL' || u.accountType === _userAccountFilter;
            return matchesQuery && matchesType;
        });
    }

    window.filterUsersTable = function () {
        renderUsersTable(applyUsersFilter());
    };

    function userTypeBadge(type) {
        const labels = {
            WEB_LINKED: ['success', 'Web + Telegram'],
            WEB_ONLY: ['warning', 'Web only'],
            TELEGRAM_ONLY: ['info', 'Telegram only'],
        };
        const [cls, label] = labels[type] || ['neutral', type || 'Unknown'];
        return `<span class="badge ${cls}">${label}</span>`;
    }

    function renderUserStats(users) {
        const stats = document.getElementById('userStats');
        if (!stats) return;

        const total = users.length;
        const telegramOnly = users.filter((u) => u.accountType === 'TELEGRAM_ONLY').length;
        const webOnly = users.filter((u) => u.accountType === 'WEB_ONLY').length;
        const linked = users.filter((u) => u.accountType === 'WEB_LINKED').length;
        const totalBalance = users.reduce((sum, u) => sum + Number(u.balance || 0), 0);
        const totalPurchase = users.reduce((sum, u) => sum + Number(u.totalPurchase || 0), 0);
        const totalDeposit = users.reduce((sum, u) => sum + Number(u.totalDeposit || 0), 0);

        document.getElementById('user-total').textContent = String(total);
        document.getElementById('user-bot-only').textContent = String(telegramOnly);
        document.getElementById('user-web-only').textContent = String(webOnly);
        document.getElementById('user-linked').textContent = String(linked);
        document.getElementById('user-balance-total').textContent = formatRupiah(totalBalance);
        document.getElementById('user-purchase-total').textContent = formatRupiah(totalPurchase);
        document.getElementById('user-deposit-total').textContent = formatRupiah(totalDeposit);
        stats.style.display = 'flex';
    }

    function renderUsersTable(users) {
        const body = document.getElementById('usersTableBody');
        if (!users.length) { body.innerHTML = emptyHTML('Tidak ada user yang sesuai'); return; }

        body.innerHTML = `
            <table class="data-table">
                <thead><tr>
                    <th>Akun</th><th>Email Web</th><th>Telegram</th><th>Saldo</th>
                    <th>Total Pembelian</th><th>Total Deposit</th><th>Order</th><th>Aktivitas</th><th>Aksi</th>
                </tr></thead>
                <tbody>
                    ${users.map(u => {
                        const displayName = [u.firstName, u.lastName].filter(Boolean).join(' ') || u.username || '—';
                        const canAdjust = Boolean((u.telegramId && /^\d+$/.test(String(u.telegramId).trim())) || u.webUserId);
                        return `<tr>
                        <td>
                            ${userTypeBadge(u.accountType)}
                            <div class="text-sm text-muted" style="margin-top:4px">${escText(displayName)}</div>
                        </td>
                        <td>${u.email ? `<span class="fw-600">${escText(u.email)}</span>` : '<span class="text-muted">—</span>'}</td>
                        <td>
                            <div class="mono text-indigo fw-600">${u.telegramId ? escText(u.telegramId) : '—'}</div>
                            <div class="text-sm text-muted">${u.username ? '@' + escText(u.username) : (u.telegramId ? 'Belum ada username' : 'Belum linked')}</div>
                        </td>
                        <td class="mono fw-600">${formatRupiahFull(u.balance || 0)}</td>
                        <td class="mono text-rose fw-600">${formatRupiahFull(u.totalPurchase || 0)}</td>
                        <td class="mono text-emerald fw-600">${formatRupiahFull(u.totalDeposit)}</td>
                        <td class="mono">${u.successOrderCount || 0} / ${u.orderCount || 0}</td>
                        <td class="text-muted text-sm">${formatDateShort(u.lastActivity)}</td>
                        <td class="actions-cell">
                            <button class="btn btn-sm btn-outline" ${canAdjust ? `onclick="prefillAdjustForUser(${escAttr(u.accountType)}, ${escAttr(u.telegramId || '')}, ${escAttr(u.webUserId || '')}, ${escAttr(u.email || displayName)})"` : 'disabled title="Target user tidak valid"'} >
                                <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5">
                                    <line x1="12" y1="5" x2="12" y2="19"/><line x1="5" y1="12" x2="19" y2="12"/>
                                </svg>
                                Adjust
                            </button>
                        </td>
                    </tr>`;
                    }).join('')}
                </tbody>
            </table>`;
    }

    // ─── Balance Adjustment Modal ─────────────────────────────────────────────────
    window.syncAdjustTargetFields = function () {
        const targetType = document.getElementById('adjTargetType')?.value || 'telegram';
        const telegramGroup = document.getElementById('adjTelegramGroup');
        const webGroup = document.getElementById('adjWebUserGroup');
        if (telegramGroup) telegramGroup.hidden = targetType !== 'telegram';
        if (webGroup) webGroup.hidden = targetType !== 'web';
    };

    window.showAdjustBalanceModal = function (targetType = 'telegram') {
        document.getElementById('adjTargetType').value = targetType;
        document.getElementById('adjTelegramId').value = '';
        document.getElementById('adjWebUserId').value = '';
        document.getElementById('adjTargetLabel').value = '';
        document.getElementById('adjAmount').value = '';
        document.getElementById('adjType').value = 'DEPOSIT';
        document.getElementById('adjDescription').value = 'Admin adjustment';
        syncAdjustTargetFields();
        document.getElementById('balanceModal').style.display = 'flex';
    };

    window.prefillAdjustForUser = function (accountType, telegramId, webUserId, label) {
        const targetType = webUserId && (!telegramId || accountType === 'WEB_ONLY') ? 'web' : 'telegram';
        showAdjustBalanceModal(targetType);
        document.getElementById('adjTelegramId').value = telegramId || '';
        document.getElementById('adjWebUserId').value = webUserId || '';
        document.getElementById('adjTargetLabel').value = label || telegramId || webUserId || '';
    };

    window.submitAdjustBalance = async function () {
        const targetType = document.getElementById('adjTargetType').value;
        const telegramId = document.getElementById('adjTelegramId').value.trim();
        const webUserId = document.getElementById('adjWebUserId').value.trim();
        const amount = parseInt(document.getElementById('adjAmount').value);
        const type = document.getElementById('adjType').value;
        const description = document.getElementById('adjDescription').value.trim() || 'Admin adjustment';

        if (targetType === 'telegram' && !telegramId) { showToast('Harap masukkan Telegram ID', 'warning'); return; }
        if (targetType === 'web' && !webUserId) { showToast('Harap masukkan Web User ID', 'warning'); return; }
        if (!amount || amount <= 0) { showToast('Harap masukkan jumlah yang valid', 'warning'); return; }

        const btn = document.getElementById('adjSubmitBtn');
        btn.disabled = true;
        btn.innerHTML = '<span class="spinner-inline"></span> Memproses…';

        try {
            const res = await api('/api/admin/user-balance', {
                method: 'PATCH',
                body: JSON.stringify({
                    telegramId: targetType === 'telegram' ? telegramId : undefined,
                    webUserId: targetType === 'web' ? webUserId : undefined,
                    amount,
                    type,
                    description,
                }),
            });
            if (res.success) {
                const targetLabel = targetType === 'telegram' ? telegramId : (document.getElementById('adjTargetLabel').value || webUserId);
                const actionLabel = type === 'DEDUCT' ? `-${formatRupiahFull(amount)}` : `+${formatRupiahFull(amount)}`;
                showToast(`✓ Saldo user ${targetLabel} berhasil di-update (${actionLabel})`);
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

    function escText(value) {
        return String(value ?? '')
            .replace(/&/g, '&amp;')
            .replace(/</g, '&lt;')
            .replace(/>/g, '&gt;')
            .replace(/"/g, '&quot;')
            .replace(/'/g, '&#39;');
    }

    // ═══════════════════════════════════════════════════════════════════════════
    //  BOOT
    // ═══════════════════════════════════════════════════════════════════════════
    window.loadMaintenanceDashboard = async function () {
        const stats = document.getElementById('maintenanceSummaryStats');
        const checksGrid = document.getElementById('maintenanceChecksGrid');
        const alertsBody = document.getElementById('maintenanceAlertsBody');
        if (!stats || !checksGrid || !alertsBody) return;

        stats.style.display = 'none';
        checksGrid.innerHTML = loadingHTML();
        alertsBody.innerHTML = loadingHTML();

        try {
            const res = await api('/api/admin/maintenance');
            if (!res.success) throw new Error(res.error || 'Gagal memuat maintenance');
            renderMaintenanceDashboard(res.data);
        } catch (err) {
            checksGrid.innerHTML = errorHTML(err.message);
            alertsBody.innerHTML = errorHTML(err.message);
        }
    };

    window.saveMaintenanceSettings = async function () {
        const btn = document.getElementById('saveMaintenanceBtn');
        const payload = {
            enabled: document.getElementById('maintenanceEnabledInput')?.value === 'true',
            title: document.getElementById('maintenanceTitleInput')?.value.trim() || '',
            message: document.getElementById('maintenanceMessageInput')?.value.trim() || '',
            expectedEndAt: maintenanceDateTimeToIso(document.getElementById('maintenanceExpectedEndInput')?.value || ''),
            blockOrders: document.getElementById('maintenanceBlockOrdersInput')?.value === 'true',
            blockDeposits: document.getElementById('maintenanceBlockDepositsInput')?.value === 'true',
            blockRegistrations: document.getElementById('maintenanceBlockRegistrationsInput')?.value === 'true',
        };

        try {
            if (btn) {
                btn.disabled = true;
                btn.innerHTML = '<span class="spinner-inline"></span> Menyimpan...';
            }

            const res = await api('/api/admin/maintenance/settings', {
                method: 'PATCH',
                body: JSON.stringify(payload),
            });
            if (!res.success) throw new Error(res.error || 'Gagal menyimpan maintenance');
            showToast(res.message || 'Pengaturan maintenance berhasil disimpan');
            await loadMaintenanceDashboard();
        } catch (err) {
            showToast(err.message || 'Gagal menyimpan maintenance', 'error');
        } finally {
            if (btn) {
                btn.disabled = false;
                btn.innerHTML = 'Simpan Maintenance';
            }
        }
    };

    window.runMaintenanceAction = async function (action) {
        openConfirm({
            title: 'Jalankan Maintenance Action',
            message: `Anda yakin ingin menjalankan aksi ${String(action).replace(/_/g, ' ')}?`,
            okText: 'Jalankan',
            color: action === 'run_full_routine' ? 'primary' : 'rose',
            onOk: async () => {
                try {
                    const res = await api('/api/admin/maintenance/action', {
                        method: 'POST',
                        body: JSON.stringify({
                            action,
                            limit: action === 'reconcile_payments' ? 50 : undefined,
                        }),
                    });
                    if (!res.success) throw new Error(res.error || 'Aksi maintenance gagal');
                    showToast(res.message || 'Aksi maintenance berhasil dijalankan');
                    await loadMaintenanceDashboard();
                    if (action === 'expire_invoices' || action === 'reconcile_payments') loadInvoices();
                    if (action === 'sync_provider' || action === 'run_full_routine') loadServices();
                } catch (err) {
                    showToast(err.message || 'Aksi maintenance gagal', 'error');
                }
            },
        });
    };

    function renderMaintenanceDashboard(data) {
        const stats = document.getElementById('maintenanceSummaryStats');
        if (stats) stats.style.display = 'grid';

        document.getElementById('mt-pending-invoices').textContent = String(data.summary.invoicePending ?? 0);
        document.getElementById('mt-overdue-invoices').textContent = String(data.summary.invoiceOverdue ?? 0);
        document.getElementById('mt-paid-today').textContent = String(data.summary.invoicePaidToday ?? 0);
        document.getElementById('mt-expired-registers').textContent = String(data.summary.pendingRegistrationsExpired ?? 0);
        document.getElementById('mt-active-links').textContent = String(data.summary.linkCodesActive ?? 0);
        document.getElementById('mt-pending-referrals').textContent = String(data.summary.pendingReferralRewards ?? 0);
        document.getElementById('mt-active-services').textContent = String(data.summary.activeServiceCount ?? 0);
        document.getElementById('mt-active-prices').textContent = String(data.summary.activePriceCount ?? 0);
        document.getElementById('mt-web-users').textContent = String(data.summary.webUserCount ?? 0);

        document.getElementById('maintenanceEnabledInput').value = String(Boolean(data.settings.enabled));
        document.getElementById('maintenanceTitleInput').value = data.settings.title || '';
        document.getElementById('maintenanceMessageInput').value = data.settings.message || '';
        document.getElementById('maintenanceExpectedEndInput').value = isoToDateTimeLocal(data.settings.expectedEndAt);
        document.getElementById('maintenanceBlockOrdersInput').value = String(Boolean(data.settings.blockOrders));
        document.getElementById('maintenanceBlockDepositsInput').value = String(Boolean(data.settings.blockDeposits));
        document.getElementById('maintenanceBlockRegistrationsInput').value = String(Boolean(data.settings.blockRegistrations));

        const checks = [
            {
                label: 'Database',
                state: data.checks.database?.ok ? 'ok' : 'fail',
                value: data.checks.database?.ok ? 'Online' : 'Error',
                meta: data.checks.database?.message || 'Koneksi query Prisma tersedia.',
            },
            {
                label: 'Redis',
                state: data.checks.redis?.ok ? 'ok' : 'warn',
                value: String(data.checks.redis?.status || 'unknown'),
                meta: 'Dipakai untuk rate limit dan queue.',
            },
            {
                label: 'BAYAR GG',
                state: data.checks.paymentGateway?.configured ? 'ok' : 'fail',
                value: data.checks.paymentGateway?.configured ? 'Configured' : 'Belum lengkap',
                meta: [
                    data.checks.paymentGateway?.paymentMethod ? `Method: ${data.checks.paymentGateway.paymentMethod}` : '',
                    data.checks.paymentGateway?.publicApiBaseUrl ? `Public API: ${data.checks.paymentGateway.publicApiBaseUrl}` : '',
                    data.checks.paymentGateway?.webhookUrl ? `Webhook: ${data.checks.paymentGateway.webhookUrl}` : '',
                ].filter(Boolean).join('<br>'),
            },
            {
                label: 'Email OTP',
                state: data.checks.email?.configured ? 'ok' : 'warn',
                value: data.checks.email?.transport || 'Belum set',
                meta: [
                    data.checks.email?.fromEmail ? `From: ${data.checks.email.fromEmail}` : '',
                    data.checks.email?.envOverride ? 'Sumber config: .env VPS' : 'Sumber config: panel admin',
                ].filter(Boolean).join('<br>'),
            },
            {
                label: 'Auth & Protection',
                state: data.checks.auth?.googleEnabled && data.checks.auth?.turnstileEnabled ? 'ok' : 'warn',
                value: data.checks.auth?.googleEnabled ? 'Google aktif' : 'Google nonaktif',
                meta: `Turnstile: ${data.checks.auth?.turnstileEnabled ? 'aktif' : 'nonaktif'}`,
            },
            {
                label: 'Provider HeroSMS',
                state: data.checks.provider?.ok ? 'ok' : 'warn',
                value: data.checks.provider?.ok ? formatRupiahFull((Number(data.checks.provider.balanceUsd || 0) * Number(data.checks.provider.effectiveRate || 0))) : 'Tidak tersedia',
                meta: data.checks.provider?.ok
                    ? `$${Number(data.checks.provider.balanceUsd || 0).toFixed(2)} • Rate ${formatRupiahFull(data.checks.provider.effectiveRate || 0)}`
                    : (data.checks.provider?.message || 'Gagal mengambil saldo provider'),
            },
        ];

        document.getElementById('maintenanceChecksGrid').innerHTML = checks.map((item) => `
            <div class="maintenance-check-card">
                <div class="maintenance-check-label">${item.label}</div>
                <div class="maintenance-check-value ${item.state}">${item.value}</div>
                <div class="maintenance-check-meta">${item.meta || '—'}</div>
            </div>
        `).join('');

        const alerts = Array.isArray(data.alerts) ? data.alerts : [];
        document.getElementById('maintenanceAlertsBody').innerHTML = alerts.length
            ? `<div class="maintenance-alert-list">${alerts.map((item) => `<div class="maintenance-alert-item">${item}</div>`).join('')}</div>`
            : `<div class="maintenance-alert-item ok">Tidak ada alert kritis. Sistem terlihat sehat untuk saat ini.</div>`;

        const operations = [
            {
                label: 'Invoice BAYAR GG pending > 15 menit',
                value: String(data.summary.staleBayarGg ?? 0),
                tone: Number(data.summary.staleBayarGg ?? 0) > 0 ? 'warn' : 'ok',
                hint: 'Gunakan aksi Reconcile BAYAR GG untuk sinkron ulang status pembayaran.',
            },
            {
                label: 'OTP register kadaluarsa',
                value: String(data.summary.pendingRegistrationsExpired ?? 0),
                tone: Number(data.summary.pendingRegistrationsExpired ?? 0) > 0 ? 'warn' : 'ok',
                hint: 'Cleanup OTP Register akan menghapus request registrasi yang sudah lewat masa berlaku.',
            },
            {
                label: 'Link Telegram usang/terpakai',
                value: String(data.summary.linkCodesExpired ?? 0),
                tone: Number(data.summary.linkCodesExpired ?? 0) > 0 ? 'warn' : 'ok',
                hint: 'Cleanup Link Telegram membantu menjaga tabel pairing tetap ringan dan bersih.',
            },
            {
                label: 'Referral menunggu bonus',
                value: String(data.summary.pendingReferralRewards ?? 0),
                tone: Number(data.summary.pendingReferralRewards ?? 0) > 0 ? 'warn' : 'ok',
                hint: 'Naik jika user referral sudah lolos syarat deposit pertama tetapi bonus belum sempat diproses.',
            },
        ];

        document.getElementById('maintenanceOperationsBody').innerHTML = `
            <div class="maintenance-alert-list">
                ${operations.map((item) => `
                    <div class="maintenance-alert-item ${item.tone === 'ok' ? 'ok' : ''}">
                        <strong>${item.label}:</strong> ${item.value}<br>
                        <span style="opacity:.82">${item.hint}</span>
                    </div>
                `).join('')}
            </div>
        `;

        const playbook = [
            data.settings.enabled
                ? 'Maintenance mode sedang aktif. Pastikan pesan ke user jelas, durasi terisi, dan blokir hanya area yang memang terdampak.'
                : 'Maintenance mode masih nonaktif. Anda bisa menyalakannya sebelum migrasi besar, sinkron provider massal, atau perubahan gateway.',
            data.checks.paymentGateway?.configured
                ? `Webhook BAYAR GG aktif di ${escText(data.checks.paymentGateway.webhookUrl || '-')}. Simpan URL ini agar tidak berubah saat deploy.`
                : 'Lengkapi konfigurasi BAYAR GG di .env VPS sebelum membuka kembali deposit otomatis.',
            'Urutan aman saat maintenance: aktifkan notice, blok deposit/pesanan bila perlu, jalankan full routine, cek alerts, lalu buka layanan bertahap.',
            'Sesudah deploy, refresh halaman ini lalu pastikan Database, Redis, BAYAR GG, Email OTP, dan Auth Protection semuanya kembali sehat.',
        ];

        document.getElementById('maintenanceNotesBody').innerHTML = `
            <div class="maintenance-alert-list">
                ${playbook.map((item) => `<div class="maintenance-alert-item ok">${item}</div>`).join('')}
            </div>
        `;
    }

    function maintenanceDateTimeToIso(value) {
        if (!value) return '';
        const date = new Date(value);
        return Number.isFinite(date.getTime()) ? date.toISOString() : '';
    }

    function isoToDateTimeLocal(value) {
        if (!value) return '';
        const date = new Date(value);
        if (!Number.isFinite(date.getTime())) return '';
        const pad = (n) => String(n).padStart(2, '0');
        return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}T${pad(date.getHours())}:${pad(date.getMinutes())}`;
    }

    loadOverview();

})();
