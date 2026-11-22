// Backoffice: métricas agregadas + administración acotada de usuarios y sesiones.
const themeKey = 'seg_theme';
document.documentElement.setAttribute('data-bs-theme', localStorage.getItem(themeKey) || 'splitwise');

const gate = document.getElementById('admin-gate');
const gateMsg = document.getElementById('admin-gate-msg');
const content = document.getElementById('admin-content');
const errorBox = document.getElementById('admin-error');

function escapeHtml(value) {
    return String(value ?? '').replace(/[&<>"']/g, c => ({
        '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'
    }[c]));
}

const fmt = new Intl.NumberFormat('es-UY');
const number = value => fmt.format(Number(value || 0));
const money = (value, currency) => `${currency} ${fmt.format(Math.round(Number(value || 0) * 100) / 100)}`;
const fmtDate = value => value ? new Date(value).toLocaleString('es-UY') : '—';

function table(headers, rows) {
    if (!rows.length) return '<p class="text-muted small mb-0">Sin datos todavía.</p>';
    return `<table class="table table-sm table-striped align-middle mb-0">
        <thead><tr>${headers.map(h => `<th scope="col">${escapeHtml(h)}</th>`).join('')}</tr></thead>
        <tbody>${rows.map(r => `<tr>${r.map(c => `<td>${escapeHtml(c)}</td>`).join('')}</tr>`).join('')}</tbody>
    </table>`;
}

function renderTotals(totals) {
    const labels = [
        ['Usuarios', totals.users],
        ['Grupos', totals.groups],
        ['Gastos', totals.expenses],
        ['Pagos', totals.payments],
        ['Usuarios con sesión vigente', totals.activeSessions]
    ];
    document.getElementById('admin-totals').innerHTML = labels.map(([label, value]) => `
        <div class="col-6 col-lg-4 col-xl-2">
            <div class="card h-100">
                <div class="card-body py-3">
                    <div class="small text-muted">${escapeHtml(label)}</div>
                    <div class="fs-4 fw-semibold">${number(value)}</div>
                </div>
            </div>
        </div>`).join('');
}

function render(data) {
    renderTotals(data.totals);

    document.getElementById('admin-signups').innerHTML = table(
        ['Día', 'Altas'],
        data.signupsByDay.map(r => [r.day, number(r.count)])
    );
    document.getElementById('admin-providers').innerHTML = table(
        ['Origen', 'Cuentas'],
        data.authProviders.map(r => [r.provider, number(r.count)])
    );
    document.getElementById('admin-groups').innerHTML = table(
        ['Día', 'Grupos'],
        data.groupsByDay.map(r => [r.day, number(r.count)])
    );
    document.getElementById('admin-activity').innerHTML = table(
        ['Día', 'Gastos', 'Pagos'],
        data.activityByDay.map(r => [r.day, number(r.expenses), number(r.payments)])
    );
    document.getElementById('admin-currencies').innerHTML = table(
        ['Moneda', 'Gastos', 'Pagos', 'Monto gastos', 'Monto pagos'],
        data.byCurrency.map(r => [r.currency, number(r.expenses), number(r.payments),
            money(r.expenseAmount, r.currency), money(r.paymentAmount, r.currency)])
    );

    const f = data.firstExpense;
    const rt = data.retention;
    document.getElementById('admin-conversion').innerHTML = `
        <ul class="list-group list-group-flush">
            <li class="list-group-item d-flex justify-content-between px-0">
                <span>Usuarios con al menos un gasto</span><strong>${number(f.usersWithExpense)} / ${number(f.totalUsers)} (${number(f.percent)}%)</strong>
            </li>
            <li class="list-group-item d-flex justify-content-between px-0">
                <span>Retención D7</span><strong>${number(rt.d7)}</strong>
            </li>
            <li class="list-group-item d-flex justify-content-between px-0">
                <span>Retención D30</span><strong>${number(rt.d30)}</strong>
            </li>
        </ul>`;

    document.getElementById('admin-note').textContent = data.note || '';
    document.getElementById('admin-generated').textContent = `Generado: ${new Date(data.generatedAt).toLocaleString('es-UY')}`;
}

const actionMsg = document.getElementById('admin-action-msg');
let msgTimer = null;

function showAction(message, ok = true) {
    actionMsg.hidden = false;
    actionMsg.className = `alert alert-${ok ? 'success' : 'danger'}`;
    actionMsg.textContent = message;
    clearTimeout(msgTimer);
    msgTimer = setTimeout(() => { actionMsg.hidden = true; }, 5000);
}

function statusBadge(status) {
    const cls = status === 'disabled' ? 'text-bg-secondary' : 'text-bg-success';
    return `<span class="badge ${cls}">${status === 'disabled' ? 'Desactivado' : 'Activo'}</span>`;
}

function renderUsers(users) {
    const host = document.getElementById('admin-users');
    if (!users.length) {
        host.innerHTML = '<p class="text-muted small mb-0">No hay usuarios que coincidan con la búsqueda.</p>';
        return;
    }
    host.innerHTML = `<table class="table table-sm table-striped align-middle mb-0">
        <thead><tr>
            <th scope="col">ID</th><th scope="col">Usuario</th><th scope="col">Estado</th>
            <th scope="col">Rol</th><th scope="col">Origen</th><th scope="col">Grupos</th>
            <th scope="col">Alta</th><th scope="col">Último acceso</th><th scope="col">Acciones</th>
        </tr></thead>
        <tbody>${users.map(u => {
            const disabled = u.status === 'disabled';
            const actions = [
                `<button type="button" class="btn btn-sm btn-outline-danger" data-action="disable" data-id="${u.id}" data-username="${escapeHtml(u.username)}" ${disabled || u.isSuperadmin ? 'disabled' : ''} title="${u.isSuperadmin ? 'No se puede desactivar a un superadmin' : 'Dar de baja'}">Dar de baja</button>`,
                `<button type="button" class="btn btn-sm btn-outline-success" data-action="enable" data-id="${u.id}" data-username="${escapeHtml(u.username)}" ${disabled ? '' : 'disabled'}>Reactivar</button>`,
                `<button type="button" class="btn btn-sm btn-outline-secondary" data-action="revoke" data-id="${u.id}" data-username="${escapeHtml(u.username)}">Revocar sesiones</button>`
            ].join(' ');
            return `<tr>
                <td>${u.id}</td>
                <td>${escapeHtml(u.username)}${u.isSuperadmin ? ' <span class="badge text-bg-dark">Superadmin</span>' : ''}</td>
                <td>${statusBadge(u.status)}</td>
                <td>${escapeHtml(u.role)}</td>
                <td>${escapeHtml(u.authProvider)}</td>
                <td>${number(u.groupCount)}</td>
                <td>${escapeHtml(fmtDate(u.createdAt))}</td>
                <td>${escapeHtml(fmtDate(u.lastSeen))}</td>
                <td class="text-nowrap">${actions}</td>
            </tr>`;
        }).join('')}</tbody>
    </table>`;
}

function renderAudit(events) {
    document.getElementById('admin-audit').innerHTML = table(
        ['Fecha', 'Acción', 'Actor', 'Objetivo', 'Motivo'],
        events.map(e => [fmtDate(e.createdAt), e.action, e.actor,
            `${e.targetType} #${e.targetId ?? '—'}`, e.reason])
    );
}

async function loadUsers() {
    const search = document.getElementById('admin-user-search').value.trim();
    const status = document.getElementById('admin-user-status').value;
    const params = new URLSearchParams({ limit: '100' });
    if (search) params.set('search', search);
    if (status) params.set('status', status);
    const response = await fetch(`/api/admin/users?${params}`, { credentials: 'same-origin' });
    if (!response.ok) {
        const body = await response.json().catch(() => ({}));
        throw new Error(body.error || `HTTP ${response.status}`);
    }
    renderUsers((await response.json()).users);
}

async function loadAudit() {
    const response = await fetch('/api/admin/audit?limit=50', { credentials: 'same-origin' });
    if (!response.ok) return;
    renderAudit((await response.json()).events);
}

const ACTIONS = {
    disable: {
        title: 'Dar de baja a un usuario',
        desc: name => `Se bloqueará el ingreso de ${name} y se cerrarán sus sesiones. Sus datos no se borran.`,
        url: id => `/api/admin/users/${id}/disable`,
        method: 'POST'
    },
    enable: {
        title: 'Reactivar a un usuario',
        desc: name => `${name} volverá a poder ingresar. No se restauran sesiones anteriores.`,
        url: id => `/api/admin/users/${id}/enable`,
        method: 'POST'
    },
    revoke: {
        title: 'Revocar sesiones',
        desc: name => `Se cerrarán todas las sesiones abiertas de ${name}. La cuenta sigue activa.`,
        url: id => `/api/admin/users/${id}/sessions`,
        method: 'DELETE'
    }
};

let pendingAction = null;

async function runAction(action, id, reason) {
    try {
        const response = await fetch(ACTIONS[action].url(id), {
            method: ACTIONS[action].method,
            credentials: 'same-origin',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ reason })
        });
        const body = await response.json().catch(() => ({}));
        if (!response.ok) throw new Error(body.error || `HTTP ${response.status}`);
        showAction(body.message || 'Acción aplicada');
        await Promise.all([loadUsers(), loadAudit(), loadOverview()]);
    } catch (err) {
        showAction(`No se pudo aplicar la acción: ${err.message}`, false);
    }
}

function askReason(action, id, username) {
    const config = ACTIONS[action];
    if (!config) return;
    pendingAction = { action, id };
    document.getElementById('admin-modal-title').textContent = config.title;
    document.getElementById('admin-modal-desc').textContent = config.desc(username);
    const reasonInput = document.getElementById('admin-modal-reason');
    reasonInput.value = '';

    const modalEl = document.getElementById('admin-reason-modal');
    if (window.bootstrap?.Modal) {
        const modal = bootstrap.Modal.getOrCreateInstance(modalEl);
        modal.show();
    } else {
        const reason = window.prompt(`${config.title}\n${config.desc(username)}\n\nMotivo:`);
        if (reason !== null) runAction(action, id, reason.trim());
    }
}

document.getElementById('admin-modal-confirm').addEventListener('click', () => {
    const reason = document.getElementById('admin-modal-reason').value.trim();
    if (!reason) {
        document.getElementById('admin-modal-reason').focus();
        return;
    }
    if (!pendingAction) return;
    const { action, id } = pendingAction;
    pendingAction = null;
    window.bootstrap?.Modal?.getOrCreateInstance(document.getElementById('admin-reason-modal')).hide();
    runAction(action, id, reason);
});

document.getElementById('admin-users').addEventListener('click', event => {
    const button = event.target.closest('button[data-action]');
    if (!button || button.disabled) return;
    askReason(button.dataset.action, Number(button.dataset.id), button.dataset.username);
});

document.getElementById('admin-user-filters').addEventListener('submit', event => {
    event.preventDefault();
    loadUsers().catch(err => showAction(`No se pudo buscar: ${err.message}`, false));
});

async function loadOverview() {
    const response = await fetch('/api/admin/overview', { credentials: 'same-origin' });
    if (!response.ok) {
        const body = await response.json().catch(() => ({}));
        throw new Error(body.error || `HTTP ${response.status}`);
    }
    render(await response.json());
}

async function load() {
    let access;
    try {
        const response = await fetch('/api/admin/me', { credentials: 'same-origin' });
        if (response.status === 401) {
            gateMsg.textContent = 'Ingresá a la app con tu cuenta para continuar.';
            return;
        }
        if (!response.ok) throw new Error('No se pudo verificar el acceso');
        access = await response.json();
    } catch (err) {
        gateMsg.textContent = `No se pudo verificar el acceso: ${err.message}`;
        return;
    }

    if (!access.superadmin) {
        gateMsg.textContent = 'Esta sección está restringida a superadmins.';
        return;
    }

    gate.hidden = true;
    content.hidden = false;

    try {
        await Promise.all([loadOverview(), loadUsers(), loadAudit()]);
    } catch (err) {
        errorBox.hidden = false;
        errorBox.textContent = `No se pudo cargar el panel: ${err.message}`;
    }
}

load();
