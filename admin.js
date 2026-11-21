// Backoffice Fase 1: solo lectura de métricas agregadas.
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
        const response = await fetch('/api/admin/overview', { credentials: 'same-origin' });
        if (!response.ok) {
            const body = await response.json().catch(() => ({}));
            throw new Error(body.error || `HTTP ${response.status}`);
        }
        render(await response.json());
    } catch (err) {
        errorBox.hidden = false;
        errorBox.textContent = `No se pudieron cargar las métricas: ${err.message}`;
    }
}

load();
