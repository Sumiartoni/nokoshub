import { FastifyPluginAsync } from 'fastify';
import { z } from 'zod';
import { config } from '../../app/config';
import {
    clearBackofficeSessionCookie,
    createBackofficeSession,
    getBackofficeSession,
    setBackofficeSessionCookie,
    verifyBackofficePassword,
} from '../../utils/backoffice-auth';

const loginSchema = z.object({
    username: z.string().min(1),
    password: z.string().min(1),
});

export const backofficeRoutes: FastifyPluginAsync = async (fastify) => {
    fastify.get('/backoffice/login', async (req, reply) => {
        if (getBackofficeSession(req)) {
            return reply.redirect('/backoffice');
        }

        return reply.type('text/html').send(loginHtml());
    });

    fastify.get('/backoffice', async (req, reply) => {
        const session = getBackofficeSession(req);
        if (!session) {
            return reply.redirect('/backoffice/login');
        }

        return reply.type('text/html').send(backofficeHtml(session.username));
    });

    fastify.get('/api/backoffice/me', async (req) => {
        const session = getBackofficeSession(req);
        return { success: true, authenticated: Boolean(session), user: session };
    });

    fastify.post(
        '/api/backoffice/login',
        { config: { rateLimit: { max: 5, timeWindow: '1 minute' } } },
        async (req, reply) => {
            const parsed = loginSchema.safeParse(req.body);
            if (!parsed.success) {
                return reply.status(400).send({ success: false, error: 'Username dan password wajib diisi' });
            }

            if (!config.BACKOFFICE_PASSWORD_HASH) {
                return reply.status(503).send({ success: false, error: 'Backoffice login belum dikonfigurasi' });
            }

            const usernameOk = parsed.data.username === config.BACKOFFICE_USERNAME;
            const passwordOk = verifyBackofficePassword(parsed.data.password, config.BACKOFFICE_PASSWORD_HASH);

            if (!usernameOk || !passwordOk) {
                return reply.status(401).send({ success: false, error: 'Login tidak valid' });
            }

            const token = createBackofficeSession(parsed.data.username);
            setBackofficeSessionCookie(reply, token);

            return { success: true };
        }
    );

    fastify.post('/api/backoffice/logout', async (_req, reply) => {
        clearBackofficeSessionCookie(reply);
        return { success: true };
    });
};

function loginHtml(): string {
    return `<!doctype html>
<html lang="id">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>NokosHUB Backoffice Login</title>
<style>
*{box-sizing:border-box}body{margin:0;min-height:100vh;display:grid;place-items:center;background:#101418;color:#e8edf2;font-family:Inter,Segoe UI,Arial,sans-serif}.panel{width:min(420px,calc(100vw - 32px));border:1px solid #29323b;background:#161c22;padding:24px;border-radius:8px;box-shadow:0 16px 48px rgba(0,0,0,.28)}h1{margin:0 0 6px;font-size:24px}.sub{margin:0 0 22px;color:#94a3b8;font-size:14px}label{display:block;margin:14px 0 7px;color:#cbd5e1;font-size:13px}input{width:100%;height:44px;background:#0f1419;border:1px solid #303a45;border-radius:6px;color:#f8fafc;padding:0 12px;font-size:15px}button{width:100%;height:44px;margin-top:20px;border:0;border-radius:6px;background:#2f81f7;color:white;font-weight:700;cursor:pointer}.err{display:none;margin-top:14px;color:#fca5a5;font-size:13px}.hint{margin-top:18px;color:#64748b;font-size:12px;line-height:1.5}
</style>
</head>
<body>
<main class="panel">
<h1>NokosHUB Backoffice</h1>
<p class="sub">Masuk sebagai super admin.</p>
<form id="loginForm">
<label for="username">Username</label>
<input id="username" autocomplete="username" required>
<label for="password">Password</label>
<input id="password" type="password" autocomplete="current-password" required>
<button type="submit">Masuk</button>
<div id="err" class="err"></div>
</form>
<p class="hint">Gunakan HTTPS dan jangan bagikan akses ini. Session disimpan sebagai cookie HttpOnly.</p>
</main>
<script>
const form=document.getElementById('loginForm'),err=document.getElementById('err');
form.addEventListener('submit',async(e)=>{
 e.preventDefault(); err.style.display='none';
 const res=await fetch('/api/backoffice/login',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({username:username.value,password:password.value})});
 const data=await res.json().catch(()=>({success:false,error:'Login gagal'}));
 if(!res.ok||!data.success){err.textContent=data.error||'Login gagal';err.style.display='block';return}
 location.href='/backoffice';
});
</script>
</body>
</html>`;
}

function backofficeHtml(username: string): string {
    return `<!doctype html>
<html lang="id">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>NokosHUB Super Admin</title>
<style>
*{box-sizing:border-box}body{margin:0;background:#0f1419;color:#e8edf2;font-family:Inter,Segoe UI,Arial,sans-serif}.shell{max-width:1180px;margin:0 auto;padding:24px}header{display:flex;justify-content:space-between;align-items:center;gap:16px;margin-bottom:22px}.title h1{margin:0;font-size:26px}.title p{margin:5px 0 0;color:#94a3b8}.actions{display:flex;gap:10px;flex-wrap:wrap}button{height:38px;border:1px solid #344150;border-radius:6px;background:#17202a;color:#e8edf2;padding:0 13px;cursor:pointer}.primary{background:#2f81f7;border-color:#2f81f7;color:#fff}.danger{background:#301b22;border-color:#6b2635;color:#fecdd3}.grid{display:grid;grid-template-columns:repeat(auto-fit,minmax(220px,1fr));gap:14px}.card{background:#151b22;border:1px solid #29323b;border-radius:8px;padding:16px}.label{color:#94a3b8;font-size:12px;text-transform:uppercase}.value{font-size:24px;font-weight:800;margin-top:8px}.tabs{display:flex;gap:8px;margin:18px 0 12px;flex-wrap:wrap}.tab.active{background:#253244;border-color:#4b6076}.panel{background:#151b22;border:1px solid #29323b;border-radius:8px;overflow:hidden}.toolbar{display:flex;justify-content:space-between;align-items:center;padding:12px;border-bottom:1px solid #29323b}.content{padding:0;overflow:auto}table{width:100%;border-collapse:collapse;min-width:760px}th,td{text-align:left;padding:11px 12px;border-bottom:1px solid #24303a;font-size:13px;vertical-align:top}th{color:#94a3b8;font-weight:600}code{color:#93c5fd}.muted{color:#94a3b8}.status{padding:3px 8px;border-radius:999px;background:#223044;display:inline-block}.msg{padding:14px;color:#cbd5e1}.form{display:grid;grid-template-columns:1fr 140px 140px 1fr auto;gap:10px;padding:12px;border-bottom:1px solid #29323b}input,select{height:38px;background:#0f1419;border:1px solid #303a45;border-radius:6px;color:#f8fafc;padding:0 10px}@media(max-width:820px){header{align-items:flex-start;flex-direction:column}.form{grid-template-columns:1fr}.shell{padding:16px}}
</style>
</head>
<body>
<main class="shell">
<header>
<div class="title"><h1>NokosHUB Super Admin</h1><p>Login sebagai ${escapeHtml(username)}</p></div>
<div class="actions"><button class="primary" onclick="syncProvider()">Sync Provider</button><button onclick="loadAll()">Refresh</button><button class="danger" onclick="logout()">Logout</button></div>
</header>
<section class="grid">
<div class="card"><div class="label">Provider Balance</div><div id="providerBalance" class="value">-</div></div>
<div class="card"><div class="label">Orders Loaded</div><div id="ordersCount" class="value">-</div></div>
<div class="card"><div class="label">Invoices Loaded</div><div id="invoicesCount" class="value">-</div></div>
<div class="card"><div class="label">Transactions Loaded</div><div id="transactionsCount" class="value">-</div></div>
</section>
<nav class="tabs">
<button class="tab active" data-tab="orders" onclick="showTab('orders')">Orders</button>
<button class="tab" data-tab="invoices" onclick="showTab('invoices')">Invoices</button>
<button class="tab" data-tab="transactions" onclick="showTab('transactions')">Transactions</button>
<button class="tab" data-tab="balance" onclick="showTab('balance')">User Balance</button>
</nav>
<section class="panel">
<div class="toolbar"><strong id="panelTitle">Orders</strong><span id="message" class="muted"></span></div>
<div id="balanceForm" class="form" style="display:none">
<input id="telegramId" placeholder="Telegram ID">
<input id="amount" type="number" placeholder="Amount">
<select id="balanceType"><option value="DEPOSIT">DEPOSIT</option><option value="REFUND">REFUND</option></select>
<input id="description" placeholder="Description">
<button class="primary" onclick="adjustBalance()">Apply</button>
</div>
<div id="content" class="content"><div class="msg">Loading...</div></div>
</section>
</main>
<script>
let state={orders:[],invoices:[],transactions:[]},active='orders';
const fmt=(n)=>new Intl.NumberFormat('id-ID',{style:'currency',currency:'IDR',maximumFractionDigits:0}).format(Number(n||0));
const esc=(v)=>String(v??'').replace(/[&<>"']/g,m=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[m]));
async function api(path,opt={}){const r=await fetch(path,{credentials:'same-origin',headers:{'Content-Type':'application/json',...(opt.headers||{})},...opt});const d=await r.json().catch(()=>({success:false,error:'Invalid response'}));if(!r.ok||d.success===false)throw new Error(d.error||'Request failed');return d}
function msg(text){message.textContent=text||''}
async function loadAll(){msg('Loading...');try{await Promise.all([loadBalance(),loadOrders(),loadInvoices(),loadTransactions()]);render();msg('Updated')}catch(e){msg(e.message)}}
async function loadBalance(){const d=await api('/api/admin/balance');providerBalance.textContent=fmt(d.data.providerBalance)}
async function loadOrders(){const d=await api('/api/admin/orders?limit=50');state.orders=d.data||[];ordersCount.textContent=state.orders.length}
async function loadInvoices(){const d=await api('/api/admin/invoices?limit=50');state.invoices=d.data||[];invoicesCount.textContent=state.invoices.length}
async function loadTransactions(){const d=await api('/api/admin/transactions?limit=50');state.transactions=d.data||[];transactionsCount.textContent=state.transactions.length}
function showTab(tab){active=tab;document.querySelectorAll('.tab').forEach(b=>b.classList.toggle('active',b.dataset.tab===tab));balanceForm.style.display=tab==='balance'?'grid':'none';panelTitle.textContent={orders:'Orders',invoices:'Invoices',transactions:'Transactions',balance:'User Balance'}[tab];render()}
function render(){if(active==='orders')return renderOrders();if(active==='invoices')return renderInvoices();if(active==='transactions')return renderTransactions();content.innerHTML='<div class="msg">Masukkan Telegram ID dan nominal untuk menambah saldo manual.</div>'}
function table(headers,rows){content.innerHTML='<table><thead><tr>'+headers.map(h=>'<th>'+h+'</th>').join('')+'</tr></thead><tbody>'+rows.join('')+'</tbody></table>'}
function renderOrders(){table(['ID','User','Service','Number','Status','OTP','Created'],state.orders.map(o=>'<tr><td><code>'+esc(o.id)+'</code></td><td>'+esc(o.user?.telegramId)+'</td><td>'+esc(o.price?.service?.name)+'<br><span class="muted">'+esc(o.price?.country?.name)+'</span></td><td>'+esc(o.phoneNumber||'-')+'</td><td><span class="status">'+esc(o.status)+'</span></td><td>'+esc(o.otpCode||'-')+'</td><td>'+esc(new Date(o.createdAt).toLocaleString('id-ID'))+'</td></tr>'))}
function renderInvoices(){table(['ID','User','Amount','Base','Status','Created'],state.invoices.map(i=>'<tr><td><code>'+esc(i.id)+'</code></td><td>'+esc(i.user?.telegramId)+'</td><td>'+fmt(i.amount)+'</td><td>'+fmt(i.baseAmount||i.amount)+'</td><td><span class="status">'+esc(i.status)+'</span></td><td>'+esc(new Date(i.createdAt).toLocaleString('id-ID'))+'</td></tr>'))}
function renderTransactions(){table(['ID','User','Type','Amount','Description','Created'],state.transactions.map(t=>'<tr><td><code>'+esc(t.id)+'</code></td><td>'+esc(t.user?.telegramId)+'</td><td><span class="status">'+esc(t.type)+'</span></td><td>'+fmt(t.amount)+'</td><td>'+esc(t.description||'-')+'</td><td>'+esc(new Date(t.createdAt).toLocaleString('id-ID'))+'</td></tr>'))}
async function syncProvider(){try{msg('Sync started...');const d=await api('/api/admin/sync',{method:'POST',body:'{}'});msg(d.message||'Sync started')}catch(e){msg(e.message)}}
async function adjustBalance(){try{const body={telegramId:telegramId.value,amount:Number(amount.value),type:balanceType.value,description:description.value};await api('/api/admin/user-balance',{method:'PATCH',body:JSON.stringify(body)});msg('Balance updated');telegramId.value='';amount.value='';description.value='';await loadTransactions();showTab('transactions')}catch(e){msg(e.message)}}
async function logout(){await api('/api/backoffice/logout',{method:'POST',body:'{}'}).catch(()=>{});location.href='/backoffice/login'}
loadAll();
</script>
</body>
</html>`;
}

function escapeHtml(value: string): string {
    return value.replace(/[&<>"']/g, (char) => ({
        '&': '&amp;',
        '<': '&lt;',
        '>': '&gt;',
        '"': '&quot;',
        "'": '&#39;',
    }[char] ?? char));
}
