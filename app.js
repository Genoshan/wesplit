const APP_VERSION = '1.0.0';
const themeKey = 'seg_theme';
const groupKey = 'seg_group';
const defaultTheme = 'splitwise';
let categoryChartInstance = null;
let allExpenses = [];
let isSubmittingExpense = false;
let historyFilters = { search: '', category: '', payer: '', month: '', from: '', to: '' };
let inviteSearchTimer = null;
let isSubmittingPayment = false;
let allPayments = [];
let currentUser = null;
let currentGroupId = null;
let currentGroupName = null;
let currentGroupCurrency = 'UYU';
let currentGroupMembers = [];
let selectorGroups = [];
let currentSplitMode = 'equal';
let editingExpenseId = null;
let editingSplitMode = 'equal';

function escapeHtml(value) {
    return String(value ?? '').replace(/[&<>"']/g, c => ({
        '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'
    }[c]));
}

// Misma política que server/password.js. El servidor vuelve a validar; esto
// solo da feedback inmediato y evita un viaje innecesario.
function passwordValidationError(value) {
    const pwd = String(value || '');
    if (pwd.length < 8) return 'La contraseña debe tener al menos 8 caracteres';
    if (!/\p{L}/u.test(pwd) || !/\p{N}/u.test(pwd) || !/[^\p{L}\p{N}\s]/u.test(pwd)) {
        return 'La contraseña debe incluir al menos una letra, un número y un símbolo';
    }
    return null;
}

function rememberGroup(groupId) {
    if (groupId == null) localStorage.removeItem(groupKey);
    else localStorage.setItem(groupKey, String(groupId));
}

// Marcador de versión: se ve solo en la consola de DevTools, nunca en la UI.
async function logBuildInfo() {
    try {
        const info = await fetch('/api/version', { cache: 'no-store' }).then(r => r.json());
        const suffix = info.branch && info.branch !== 'local' ? ` · ${info.branch}` : '';
        console.info(`%cWeSplit v${info.version} · ${info.commit}${suffix}`, 'color:#1e5e4e;font-weight:bold');
    } catch (_) {
        console.info(`%cWeSplit v${APP_VERSION}`, 'color:#1e5e4e;font-weight:bold');
    }
}

const initialTheme = localStorage.getItem(themeKey) || defaultTheme;
document.documentElement.setAttribute('data-bs-theme', initialTheme);
// Update toggle button after DOM loads
document.addEventListener('DOMContentLoaded', () => {
    logBuildInfo();
    updateThemeToggle(initialTheme);

    // Handlers antes inline (necesario para poder usar CSP sin 'unsafe-inline').
    document.getElementById('toggle-theme-btn')?.addEventListener('click', toggleTheme);
    document.getElementById('logout-btn')?.addEventListener('click', logout);
    document.getElementById('delete-group-menu-btn')?.addEventListener('click', openDeleteGroupModal);
    document.getElementById('add-expense-btn')?.addEventListener('click', submitExpense);
    document.getElementById('expense-form')?.addEventListener('submit', (e) => {
        e.preventDefault();
        submitExpense();
    });

    // Delegación: estas listas se regeneran con innerHTML.
    document.getElementById('members-list')?.addEventListener('click', (e) => {
        const btn = e.target.closest('button[data-member-action]');
        if (!btn) return;
        const id = Number(btn.dataset.memberId);
        if (btn.dataset.memberAction === 'deactivate') removeMember(id);
        if (btn.dataset.memberAction === 'reactivate') reactivateMember(id);
        if (btn.dataset.memberAction === 'cancel-invite') cancelInvitation(id);
    });
    document.getElementById('expense-list')?.addEventListener('click', (e) => {
        const btn = e.target.closest('button[data-expense-action]');
        if (!btn) return;
        const id = Number(btn.dataset.expenseId);
        if (btn.dataset.expenseAction === 'delete') deleteExpense(id);
        if (btn.dataset.expenseAction === 'edit') openEditExpenseModal(id);
    });
    document.getElementById('invitations-list')?.addEventListener('click', (e) => {
        const btn = e.target.closest('button[data-invite-action]');
        if (!btn) return;
        const id = Number(btn.dataset.inviteId);
        if (btn.dataset.inviteAction === 'accept') acceptInvitation(id);
        if (btn.dataset.inviteAction === 'reject') rejectInvitation(id);
    });
});

function changeTheme(theme) {
    document.documentElement.setAttribute('data-bs-theme', theme);
    localStorage.setItem(themeKey, theme);
    updateThemeToggle(theme);
}

function toggleTheme() {
    const current = localStorage.getItem(themeKey) || defaultTheme;
    const next = current === 'splitwise' ? 'splitwise-dark' : 'splitwise';
    changeTheme(next);
}

function updateThemeToggle(theme) {
    const btn = document.getElementById('toggle-theme-btn');
    if (!btn) return;
    const isDark = theme === 'splitwise-dark';
    const label = isDark ? 'Cambiar a modo claro' : 'Cambiar a modo oscuro';
    btn.textContent = isDark ? '☀️' : '🌙';
    btn.title = label;
    btn.setAttribute('aria-label', label);
}

function currencyDecimals(code) {
    return ['UYU', 'ARS', 'CLP', 'COP', 'MXN', 'PEN'].includes(code) ? 0 : 2;
}

function formatCurrency(value) {
    const code = currentGroupCurrency || 'UYU';
    const decimals = currencyDecimals(code);
    try {
        return new Intl.NumberFormat('es-UY', {
            style: 'currency',
            currency: code,
            minimumFractionDigits: decimals,
            maximumFractionDigits: decimals
        }).format(Number(value || 0));
    } catch {
        return `${escapeHtml(code)} ${Number(value || 0).toFixed(decimals)}`;
    }
}

function currencySymbol() {
    try {
        const parts = new Intl.NumberFormat('es-UY', {
            style: 'currency', currency: currentGroupCurrency || 'UYU'
        }).formatToParts(0);
        return parts.find(p => p.type === 'currency')?.value || '$';
    } catch {
        return '$';
    }
}

function formatDate(dateStr) {
    const d = new Date(dateStr + 'T00:00:00');
    return d.toLocaleDateString('es-ES', { day: 'numeric', month: 'short' });
}

// ── API ──
async function apiGet(url) {
    const res = await fetch(url);
    if (!res.ok) throw new Error(`API ${url}: ${res.status}`);
    return res.json();
}
async function apiPost(url, body) {
    const res = await fetch(url, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
    const data = await res.json();
    if (!res.ok) throw new Error(data.error || 'Request failed');
    return data;
}
async function apiDelete(url) {
    const res = await fetch(url, { method: 'DELETE' });
    const data = await res.json();
    if (!res.ok) throw new Error(data.error || 'Request failed');
    return data;
}
async function apiDeleteWithBody(url, body) {
    const res = await fetch(url, { method: 'DELETE', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
    const data = await res.json();
    if (!res.ok) throw new Error(data.error || 'Request failed');
    return data;
}
async function apiPut(url, body) {
    const res = await fetch(url, { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
    const data = await res.json();
    if (!res.ok) throw new Error(data.error || 'Request failed');
    return data;
}

// ── Auth ──
async function loadAuth() {
    try {
        const data = await apiGet('/api/auth/check');
        currentUser = { username: data.user, name: data.name || data.user, global_role: data.global_role };

        if (data.groups && data.groups.length > 0) {
            // Conservar el grupo activo si sigue disponible (en memoria, recién
            // creado/aceptado, o guardado en localStorage tras un reload).
            const storedGroupId = localStorage.getItem(groupKey);
            const kept = data.groups.find(g => g.id == currentGroupId)
                || data.groups.find(g => g.id == storedGroupId);
            const chosen = kept || data.defaultGroup || data.groups[0];
            currentGroupId = chosen.id;
            currentGroupName = chosen.name;
            currentGroupCurrency = chosen.base_currency || chosen.currency || 'UYU';
            rememberGroup(currentGroupId);
        }

        const hasGroups = Boolean(data.groups && data.groups.length > 0);
        const noGroupsAlert = document.getElementById('no-groups-alert');
        if (noGroupsAlert) noGroupsAlert.hidden = hasGroups;
        const appTabs = document.getElementById('app-tabs');
        if (appTabs) appTabs.hidden = !hasGroups;
        const tabContent = document.getElementById('app-tab-content');
        if (tabContent) tabContent.hidden = !hasGroups;

        document.getElementById('login-screen').hidden = true;
        document.getElementById('app-screen').hidden = false;
        renderHeader();
        renderGroupSelector(data.groups);
        loadExpenses();
        renderInvitations();
    } catch (err) {
        document.getElementById('login-screen').hidden = false;
        document.getElementById('app-screen').hidden = true;
        const errEl = document.getElementById('login-error');
        if (errEl) errEl.textContent = ''; // Don't show 401 error on login screen
    }
}

async function logout() {
    rememberGroup(null);
    try {
        await fetch('/api/logout', { method: 'POST' });
    } catch (e) {
        console.error('[APP] Logout error:', e);
    }
    window.location.reload();
}

function renderHeader() {
    const el = document.getElementById('user-display-name');
    if (el && currentUser) {
        el.textContent = currentUser.name || (currentUser.username.charAt(0).toUpperCase() + currentUser.username.slice(1));
    }
    const groupBadge = document.getElementById('current-group-name');
    if (groupBadge && currentGroupName) {
        groupBadge.textContent = currentGroupName;
    }
}

// "Vos" primero para reconocer el grupo propio de un vistazo. El resto de
// miembros activos viene en /api/auth/check (member_names), sin pedir un
// /api/groups/:id por cada grupo.
function groupMemberLine(group) {
    const names = String(group?.member_names || '')
        .split(',')
        .map(n => n.trim())
        .filter(Boolean);
    const me = currentUser?.username?.toLowerCase();
    if (me) {
        const own = names.findIndex(n => n.toLowerCase() === me);
        if (own >= 0) {
            names.splice(own, 1);
            names.unshift('Vos');
        }
    }
    if (names.length === 0) return 'Sin miembros activos';
    return names.join(', ');
}

function renderGroupSelector(groups) {
    const render = data => {
        if (!data.groups || data.groups.length === 0) return;
        const menu = document.getElementById('group-selector-menu');
        const toggleName = document.getElementById('group-selector-name');
        if (!menu || !toggleName) return;
        const current = data.groups.find(g => g.id == currentGroupId) || data.groups[0];
        currentGroupId = current.id;
        currentGroupName = current.name;
        currentGroupCurrency = current.base_currency || current.currency || 'UYU';
        currentGroupMembers = [];
        selectorGroups = data.groups;

        // Si dos grupos se llaman igual, agregamos el id para que no haya duda.
        const counts = {};
        data.groups.forEach(g => {
            const key = String(g.name).toLowerCase();
            counts[key] = (counts[key] || 0) + 1;
        });
        menu.innerHTML = data.groups.map(g => {
            const repeated = counts[String(g.name).toLowerCase()] > 1;
            const isCurrent = g.id == currentGroupId;
            const label = `${isCurrent ? '✓ ' : ''}${escapeHtml(g.name)}${repeated ? ` <span class="group-option-id">#${escapeHtml(g.id)}</span>` : ''}`;
            return `<li>
                <button type="button" class="dropdown-item group-option${isCurrent ? ' is-current' : ''}" data-group-id="${escapeHtml(g.id)}" ${isCurrent ? 'aria-current="true"' : ''}>
                    <span class="group-option-name d-block">${label}</span>
                    <span class="group-option-members d-block small text-secondary">${escapeHtml(groupMemberLine(g))}</span>
                </button>
            </li>`;
        }).join('');
        toggleName.textContent = currentGroupName;
        const groupBadge = document.getElementById('current-group-name');
        if (groupBadge) groupBadge.textContent = currentGroupName;

        if (!menu._groupClickHandler) {
            menu._groupClickHandler = event => {
                const option = event.target.closest('[data-group-id]');
                if (!option) return;
                const group = selectorGroups.find(g => g.id === Number(option.dataset.groupId));
                if (!group) return;
                currentGroupId = group.id;
                rememberGroup(currentGroupId);
                render({ groups: selectorGroups });
                loadExpenses();
                updateDeleteButton(selectorGroups);
            };
            menu.addEventListener('click', menu._groupClickHandler);
        }
        // Show delete button only if admin of current group
        updateDeleteButton(data.groups);
    };

    if (groups) render({ groups });
    else fetch('/api/auth/check').then(r => r.json()).then(render).catch(e => console.error('[APP] Group selector error:', e));
}

function updateDeleteButton(groups) {
    const btn = document.getElementById('delete-group-menu-btn');
    if (!btn) return;
    if (!groups) {
        fetch('/api/auth/check').then(r => r.json()).then(d => updateDeleteButton(d.groups)).catch(() => {});
        return;
    }
    const current = groups.find(g => g.id == currentGroupId);
    const isAdmin = current && current.member_role === 'admin';
    btn.hidden = !isAdmin;
}

function openCreateGroupModal() {
    const modal = new bootstrap.Modal(document.getElementById('createGroupModal'));
    document.getElementById('new-group-name').value = '';
    document.getElementById('new-group-currency').value = 'UYU';
    modal.show();
}

async function confirmCreateGroup() {
    const name = document.getElementById('new-group-name').value.trim();
    const currency = document.getElementById('new-group-currency').value;
    if (!name) {
        Swal.fire({ icon: 'warning', title: 'Nombre requerido', text: 'Ingresá un nombre para el grupo.' });
        return;
    }
    try {
        const result = await apiPost('/api/groups', { name, base_currency: currency });
        currentGroupId = result.id;
        rememberGroup(result.id);
        currentGroupName = name;
        const modal = bootstrap.Modal.getInstance(document.getElementById('createGroupModal'));
        modal.hide();
        await loadAuth();
    } catch (err) {
        Swal.fire({ icon: 'error', title: 'Error', text: err.message });
    }
}

function openDeleteGroupModal() {
    const name = currentGroupName || 'este grupo';
    document.getElementById('delete-group-name').textContent = name;
    const modal = new bootstrap.Modal(document.getElementById('deleteGroupModal'));
    modal.show();
}

async function confirmDeleteGroup() {
    if (!currentGroupId) return;
    try {
        await apiDelete(`/api/groups/${currentGroupId}`);
        const modal = bootstrap.Modal.getInstance(document.getElementById('deleteGroupModal'));
        modal.hide();
        // Switch to first available group
        const data = await apiGet('/api/auth/check');
        if (data.groups && data.groups.length > 0) {
            currentGroupId = data.defaultGroup ? data.defaultGroup.id : data.groups[0].id;
            currentGroupName = data.defaultGroup ? data.defaultGroup.name : data.groups[0].name;
        } else {
            currentGroupId = null;
            currentGroupName = null;
        }
        rememberGroup(currentGroupId);
        await loadAuth();
    } catch (err) {
        Swal.fire({ icon: 'error', title: 'Error', text: err.message });
    }
}

// ── Expenses ──
async function loadExpenses() {
    if (!currentGroupId) return;
    try {
        const data = await apiGet(`/api/groups/${currentGroupId}/expenses`);
        allExpenses = data;
        renderExpenses();
        renderBalances();
        updateChart();
        populateMonthFilter();
        renderMembers();
        await loadPayments();
    } catch (err) {
        console.error('[APP] Failed to load expenses:', err);
    }
}

async function renderBalances() {
    const container = document.getElementById('balance-detail');
    if (!container || !currentGroupId) return;
    try {
        const data = await apiGet(`/api/groups/${currentGroupId}/balance`);
        const balances = data.balances || [];
        if (balances.length === 0) {
            container.innerHTML = '<p class="text-muted">No hay datos de balance.</p>';
            return;
        }
        container.innerHTML = balances.map(b => {
            const balance = b.balance || 0;
            const isPositive = balance > 0;
            const isNegative = balance < 0;
            const colorClass = isPositive ? 'text-success' : (isNegative ? 'text-danger' : 'text-muted');
            const label = isPositive ? 'le deben' : (isNegative ? 'debe' : 'al día');
            return `
                <div class="balance-row d-flex justify-content-between align-items-center py-3 border-bottom">
                    <div>
                        <div class="fw-semibold">${escapeHtml(b.username)}</div>
                        <div class="small text-muted">Pagó: ${formatCurrency(b.total_paid)} | Gastó: ${formatCurrency(b.total_spent)}</div>
                    </div>
                    <div class="text-end">
                        <div class="fw-bold ${colorClass}">${formatCurrency(Math.abs(balance))}</div>
                        <div class="small ${colorClass}">${label}</div>
                    </div>
                </div>`;
        }).join('');
    } catch (err) {
        console.error('[APP] Failed to load balances:', err);
        container.innerHTML = '<p class="text-danger">Error al cargar balances.</p>';
    }
}

async function renderMembers() {
    const container = document.getElementById('members-list');
    if (!container || !currentGroupId) return;
    try {
        const data = await apiGet(`/api/groups/${currentGroupId}`);
        const members = data.members || [];
        currentGroupMembers = members;
        currentGroupCurrency = data.base_currency || currentGroupCurrency;
        renderPayerOptions();
        renderPaymentOptions();
        updateSplitDisplay();
        if (members.length === 0) {
            container.innerHTML = '<p class="text-muted">No hay miembros.</p>';
            return;
        }
        const activeAdmins = members.filter(x => x.member_role === 'admin' && x.status === 'active').length;
        container.innerHTML = members.map(m => {
            const status = m.status || 'active';
            const statusBadge = status === 'pending'
                ? '<span class="badge bg-warning text-dark ms-2">Invitación pendiente</span>'
                : (status === 'inactive'
                    ? '<span class="badge bg-secondary ms-2">Inactivo</span>'
                    : '');
            let action = '';
            if (status === 'pending') {
                action = `<button class="btn btn-sm btn-outline-secondary" data-member-action="cancel-invite" data-member-id="${escapeHtml(m.user_id)}">Cancelar invitación</button>`;
            } else if (status === 'inactive') {
                action = `<button class="btn btn-sm btn-outline-success" data-member-action="reactivate" data-member-id="${escapeHtml(m.user_id)}">Reactivar</button>`;
            } else if (m.member_role !== 'admin' || activeAdmins > 1) {
                action = `<button class="btn btn-sm btn-outline-danger" data-member-action="deactivate" data-member-id="${escapeHtml(m.user_id)}">Dar de baja</button>`;
            }
            return `
            <div class="member-row d-flex justify-content-between align-items-center py-2 border-bottom">
                <div>
                    <span class="fw-semibold">${escapeHtml(m.username)}</span>
                    <span class="badge bg-secondary ms-2">${m.member_role === 'admin' ? 'Admin' : 'Miembro'}</span>
                    ${statusBadge}
                </div>
                ${action}
            </div>`;
        }).join('');
        updateDeleteButtonFromMembers(members);
    } catch (err) {
        console.error('[APP] Failed to load members:', err);
        container.innerHTML = '<p class="text-danger">Error al cargar miembros.</p>';
    }
}

function updateDeleteButtonFromMembers(members) {
    const btn = document.getElementById('delete-group-menu-btn');
    if (!btn) return;
    const mine = (members || []).find(m => m.username === currentUser?.username);
    btn.hidden = !(mine && mine.member_role === 'admin' && mine.status === 'active');
}

// ── Invitaciones recibidas ──
async function renderInvitations() {
    const container = document.getElementById('invitations-list');
    const panel = document.getElementById('invitations-panel');
    const countBadge = document.getElementById('invitations-count');
    const headerBtn = document.getElementById('invitations-btn');
    try {
        const invitations = await apiGet('/api/groups/invitations');
        if (countBadge) countBadge.textContent = invitations.length;
        if (headerBtn) headerBtn.hidden = invitations.length === 0;
        if (!container || !panel) return;
        panel.hidden = invitations.length === 0;
        container.innerHTML = invitations.map(i => `
            <div class="invitation-row d-flex justify-content-between align-items-center py-2 border-bottom">
                <div>
                    <div class="fw-semibold">${escapeHtml(i.group_name)}</div>
                    <div class="small text-muted">Te invitó ${escapeHtml(i.owner_username)}</div>
                </div>
                <div class="d-flex gap-1">
                    <button class="btn btn-sm btn-outline-success" data-invite-action="accept" data-invite-id="${escapeHtml(i.id)}">Aceptar</button>
                    <button class="btn btn-sm btn-outline-secondary" data-invite-action="reject" data-invite-id="${escapeHtml(i.id)}">Rechazar</button>
                </div>
            </div>`).join('');
    } catch (err) {
        console.error('[APP] Error cargando invitaciones:', err);
    }
}

async function acceptInvitation(id) {
    try {
        const pending = await apiGet('/api/groups/invitations');
        const accepted = pending.find(i => i.id === id);
        await apiPost(`/api/groups/invitations/${id}/accept`, {});
        if (accepted) {
            currentGroupId = accepted.group_id;
            rememberGroup(currentGroupId);
        }
        await loadAuth();
        await renderInvitations();
        Swal.fire({ icon: 'success', title: 'Invitación aceptada', text: 'Ya podés ver el grupo.' });
    } catch (err) {
        Swal.fire({ icon: 'error', title: 'Error', text: err.message });
    }
}

async function rejectInvitation(id) {
    try {
        await apiDelete(`/api/groups/invitations/${id}`);
        await renderInvitations();
    } catch (err) {
        Swal.fire({ icon: 'error', title: 'Error', text: err.message });
    }
}

async function cancelInvitation(id) {
    try {
        await apiDelete(`/api/groups/${currentGroupId}/members/${id}`);
        await renderMembers();
        await renderInvitations();
    } catch (err) {
        Swal.fire({ icon: 'error', title: 'Error', text: err.message });
    }
}

async function reactivateMember(id) {
    try {
        await apiPost(`/api/groups/${currentGroupId}/members/${id}/reactivate`, {});
        await renderMembers();
    } catch (err) {
        Swal.fire({ icon: 'error', title: 'Error', text: err.message });
    }
}

function openInviteModal() {
    const modal = new bootstrap.Modal(document.getElementById('inviteModal'));
    document.getElementById('invite-username').value = '';
    document.getElementById('invite-suggestions').innerHTML = '';
    document.getElementById('invite-result').innerHTML = '';
    modal.show();
}

async function searchUsersForInvite(value) {
    const list = document.getElementById('invite-suggestions');
    if (!list) return;
    const q = value.trim().toLowerCase();
    if (q.length < 2) { list.innerHTML = ''; return; }
    try {
        const users = await apiGet(`/api/users/search?q=${encodeURIComponent(q)}`);
        list.innerHTML = (users || []).map(u =>
            `<option value="${escapeHtml(u.username)}">${escapeHtml(u.name || u.username)}</option>`
        ).join('');
    } catch (err) {
        console.error('[APP] Error buscando usuarios:', err);
        list.innerHTML = '';
    }
}

async function confirmInvite() {
    const username = document.getElementById('invite-username').value.trim().toLowerCase();
    const resultEl = document.getElementById('invite-result');
    if (!username) {
        Swal.fire({ icon: 'warning', title: 'Username requerido', text: 'Ingresá un username.' });
        return;
    }
    try {
        const result = await apiPost(`/api/groups/${currentGroupId}/members`, { username, role: 'member' });
        resultEl.innerHTML = result.status === 'pending'
            ? '<p class="text-success small">📨 Invitación enviada. El usuario debe aceptarla desde la pestaña Miembros.</p>'
            : '<p class="text-success small">✅ Usuario agregado al grupo.</p>';
        document.getElementById('invite-username').value = '';
        await renderMembers();
    } catch (err) {
        resultEl.innerHTML = `<p class="text-danger small">❌ ${escapeHtml(err.message)}. El usuario debe registrarse primero.</p>`;
    }
}

async function removeMember(userId) {
    const result = await Swal.fire({
        title: '¿Dar de baja este miembro?',
        icon: 'warning',
        showCancelButton: true,
        confirmButtonText: 'Dar de baja',
        cancelButtonText: 'Cancelar',
        text: 'Su historial y balances se conservan. Podés reactivarlo después.'
    });
    if (!result.isConfirmed) return;
    try {
        await apiDelete(`/api/groups/${currentGroupId}/members/${userId}`);
        await renderMembers();
    } catch (err) {
        Swal.fire({ icon: 'error', title: 'Error', text: err.message });
    }
}

function populateMonthFilter() {
    const monthFilter = document.getElementById('month-filter');
    if (!monthFilter) return;
    const selected = monthFilter.value;
    const months = [...new Set(allExpenses.map(e => e.date?.substring(0, 7)))].filter(Boolean).sort().reverse();
    monthFilter.innerHTML = '<option value="">Todos los meses</option>' +
        months.map(m => `<option value="${escapeHtml(m)}">${escapeHtml(m)}</option>`).join('');
    if (selected && months.includes(selected)) monthFilter.value = selected;
}

async function ensureGroupMembers() {
    if (!currentGroupId) return [];
    if (currentGroupMembers.length > 0) return currentGroupMembers;
    const group = await apiGet(`/api/groups/${currentGroupId}`);
    currentGroupMembers = group.members || [];
    currentGroupCurrency = group.base_currency || currentGroupCurrency;
    renderPayerOptions();
    renderPaymentOptions();
    return currentGroupMembers;
}

function otherMemberUsername() {
    const other = currentGroupMembers.find(m => m.username !== currentUser?.username);
    return other ? other.username : null;
}

// El selector de pagador y su filtro se arman con los miembros reales del
// grupo. Antes el HTML traía "Tin"/"Noe" escritos, lo cual era falso para
// cualquier otro usuario.
function renderPayerOptions() {
    const options = (currentGroupMembers || []).filter(m => m.status !== 'inactive' && m.status !== 'pending').map(m => {
        const label = escapeHtml(String(m.name || m.username || 'Miembro').trim());
        const mine = m.username === currentUser?.username;
        const suffix = mine ? '' : ` (${escapeHtml(m.username)})`;
        return `<option value="${escapeHtml(m.username)}">${mine ? 'Vos · ' : ''}${label}${suffix}</option>`;
    }).join('');

    const payer = document.getElementById('expense-payer');
    if (payer) {
        payer.innerHTML = options || '<option value="me">Vos</option>';
        const mine = (currentGroupMembers || []).find(m => m.username === currentUser?.username && m.status === 'active');
        if (mine) payer.value = mine.username;
    }

    const filter = document.getElementById('payer-filter');
    if (filter) {
        filter.innerHTML = '<option value="">Todos los pagadores</option>' + options;
    }
}

async function addExpense(formData) {
    if (isSubmittingExpense) return;
    isSubmittingExpense = true;
    try {
        await ensureGroupMembers();
        const amount = parseFloat(formData.amount);

        // equal/solo los calcula el servidor con los miembros reales del grupo.
        let splits = [];
        if (currentSplitMode === 'custom' && formData.customSplits) {
            splits = JSON.parse(formData.customSplits);
        }

        await apiPost(`/api/groups/${currentGroupId}/expenses`, {
            date: formData.date,
            description: formData.description,
            amount: amount,
            payer: formData.payer,
            category: formData.category,
            split_mode: currentSplitMode,
            splits: splits
        });
        await loadExpenses();
        // Reset form
        document.getElementById('expense-description').value = '';
        document.getElementById('expense-amount').value = '';
    } catch (err) {
        console.error('[APP] Failed to add expense:', err);
        Swal.fire({ icon: 'error', title: 'Error', text: err.message });
    } finally {
        isSubmittingExpense = false;
    }
}

async function deleteExpense(expenseId) {
    const result = await Swal.fire({
        title: '¿Eliminar este gasto?',
        icon: 'warning',
        showCancelButton: true,
        confirmButtonText: 'Eliminar',
        cancelButtonText: 'Cancelar'
    });
    if (!result.isConfirmed) return;
    try {
        await apiDelete(`/api/groups/${currentGroupId}/expenses/${expenseId}`);
        await loadExpenses();
    } catch (err) {
        console.error('[APP] Failed to delete expense:', err);
        Swal.fire({ icon: 'error', title: 'Error', text: err.message });
    }
}

// ── Pagos entre miembros (settle up) ──
async function loadPayments() {
    if (!currentGroupId) return;
    try {
        allPayments = await apiGet(`/api/groups/${currentGroupId}/payments`);
        renderPayments();
    } catch (err) {
        console.error('[APP] Failed to load payments:', err);
    }
}

function memberDisplayName(username) {
    const member = (currentGroupMembers || []).find(m => m.username === username);
    return member ? (String(member.name || '').trim() || member.username) : username;
}

function renderPaymentOptions() {
    const active = (currentGroupMembers || []).filter(m => m.status === 'active');
    const options = active.map(m => {
        const label = escapeHtml(String(m.name || m.username).trim());
        const mine = m.username === currentUser?.username;
        return `<option value="${escapeHtml(m.username)}">${mine ? 'Vos · ' : ''}${label}${mine ? '' : ` (${escapeHtml(m.username)})`}</option>`;
    }).join('');

    const from = document.getElementById('payment-from');
    const to = document.getElementById('payment-to');
    if (!from || !to) return;
    from.innerHTML = options;
    to.innerHTML = options;
    const mine = active.find(m => m.username === currentUser?.username);
    if (mine) from.value = mine.username;
    const other = active.find(m => m.username !== currentUser?.username);
    if (other) to.value = other.username;
    const submit = document.getElementById('add-payment-btn');
    if (submit) submit.disabled = active.length < 2;
}

async function submitPayment() {
    if (isSubmittingPayment) return;
    const amount = parseFloat(document.getElementById('payment-amount')?.value);
    const date = document.getElementById('payment-date')?.value;
    const from = document.getElementById('payment-from')?.value;
    const to = document.getElementById('payment-to')?.value;
    const description = String(document.getElementById('payment-description')?.value || '').trim();

    if (!Number.isFinite(amount) || amount <= 0) {
        Swal.fire('Atención', 'El monto debe ser un número mayor a cero.', 'warning');
        return;
    }
    if (!/^\d{4}-\d{2}-\d{2}$/.test(date || '')) {
        Swal.fire('Atención', 'La fecha es obligatoria.', 'warning');
        return;
    }
    if (!from || !to || from === to) {
        Swal.fire('Atención', 'Elegí dos miembros distintos.', 'warning');
        return;
    }

    isSubmittingPayment = true;
    try {
        await apiPost(`/api/groups/${currentGroupId}/payments`, {
            from_user: from,
            to_user: to,
            amount,
            currency: currentGroupCurrency,
            date,
            description
        });
        document.getElementById('payment-form')?.reset();
        renderPaymentOptions();
        await Promise.all([loadPayments(), renderBalances()]);
        Swal.fire({ icon: 'success', title: 'Pago registrado', toast: true, position: 'top-end', showConfirmButton: false, timer: 1500 });
    } catch (err) {
        Swal.fire({ icon: 'error', title: 'Error', text: err.message });
    } finally {
        isSubmittingPayment = false;
    }
}

async function deletePayment(paymentId) {
    try {
        await apiDelete(`/api/groups/${currentGroupId}/payments/${paymentId}`);
        await Promise.all([loadPayments(), renderBalances()]);
        Swal.fire({ icon: 'success', title: 'Pago eliminado', toast: true, position: 'top-end', showConfirmButton: false, timer: 1500 });
    } catch (err) {
        Swal.fire({ icon: 'error', title: 'Error', text: err.message });
    }
}

function renderPayments() {
    const body = document.getElementById('payments-body');
    const count = document.getElementById('payments-count');
    if (!body) return;
    if (count) count.textContent = `${allPayments.length} pago${allPayments.length === 1 ? '' : 's'}`;
    if (allPayments.length === 0) {
        body.innerHTML = '<tr><td colspan="5" class="text-center text-muted py-4">No hay pagos registrados</td></tr>';
        return;
    }
    body.innerHTML = allPayments.map(payment => `
        <tr>
            <td>${formatDate(payment.date)}</td>
            <td>${escapeHtml(payment.description || 'Sin descripción')}</td>
            <td class="text-end">${formatCurrency(payment.amount)}</td>
            <td>${escapeHtml(memberDisplayName(payment.from_user))} → ${escapeHtml(memberDisplayName(payment.to_user))}</td>
            <td class="text-end"><button type="button" class="btn btn-sm btn-outline-danger" data-payment-delete="${payment.id}" title="Eliminar pago">Eliminar</button></td>
        </tr>
    `).join('');
    body.querySelectorAll('[data-payment-delete]').forEach(btn => {
        btn.addEventListener('click', async () => {
            const result = await Swal.fire({
                title: '¿Eliminar este pago?',
                icon: 'warning',
                showCancelButton: true,
                confirmButtonText: 'Eliminar',
                cancelButtonText: 'Cancelar'
            });
            if (result.isConfirmed) await deletePayment(btn.dataset.paymentDelete);
        });
    });
}

async function exportToCsv() {
    if (!currentGroupId) return;
    try {
        const response = await fetch(`/api/groups/${currentGroupId}/export/csv`);
        if (!response.ok) throw new Error('Error en la red: ' + response.status);
        const blob = await response.blob();
        const url = window.URL.createObjectURL(blob);
        const link = document.createElement('a');
        link.href = url;
        link.download = `wesplit-${currentGroupId}-${new Date().toISOString().slice(0, 10)}.csv`;
        document.body.appendChild(link);
        link.click();
        window.URL.revokeObjectURL(url);
        link.remove();
    } catch (err) {
        console.error('[APP] Failed to export CSV:', err);
        Swal.fire({ icon: 'error', title: 'Error', text: 'No se pudo exportar el CSV.' });
    }
}

function renderExpenses() {
    const container = document.getElementById('expense-list');
    if (!container) return;

    let filtered = allExpenses.filter(e => {
        if (historyFilters.search && !e.description.toLowerCase().includes(historyFilters.search.toLowerCase())) return false;
        if (historyFilters.category && e.category !== historyFilters.category) return false;
        if (historyFilters.payer && e.payer !== historyFilters.payer) return false;
        if (historyFilters.month) {
            const m = e.date.substring(0, 7);
            if (m !== historyFilters.month) return false;
        }
        if (historyFilters.from && e.date < historyFilters.from) return false;
        if (historyFilters.to && e.date > historyFilters.to) return false;
        return true;
    });

    if (filtered.length === 0) {
        container.innerHTML = allExpenses.length === 0
            ? '<div class="text-center py-5 text-muted"><p>No hay gastos registrados</p></div>'
            : '<div class="text-center py-5 text-muted"><p>No hay gastos que coincidan con los filtros</p></div>';
        return;
    }

    const myId = currentGroupMembers.find(m => m.username === currentUser?.username)?.user_id;
    container.innerHTML = filtered.map(expense => {
        const isMe = expense.payer === currentUser.username;
        const payerLabel = currentGroupMembers.find(m => m.username === expense.payer)?.username || expense.payer;
        const mySplit = expense.splits?.find(s =>
            s.split_username === currentUser?.username ||
            (myId != null && String(s.user_id) === String(myId))
        );
        const meSplit = mySplit ? Number(mySplit.amount) : 0;

        return `
            <div class="expense-card mb-2 p-3">
                <div class="d-flex justify-content-between align-items-start">
                    <div>
                        <div class="text-muted small">${escapeHtml(expense.category || 'Sin categoría')}</div>
                        <div>${escapeHtml(expense.description || 'Sin descripción')}</div>
                    </div>
                    <div class="text-end">
                        <div class="fw-bold">${formatCurrency(expense.amount)}</div>
                        <div class="d-flex gap-1 justify-content-end">
                            <button class="btn btn-sm btn-outline-primary px-2 py-0" data-expense-action="edit" data-expense-id="${escapeHtml(expense.id)}">Editar</button>
                            <button class="btn btn-sm btn-outline-danger px-2 py-0" data-expense-action="delete" data-expense-id="${escapeHtml(expense.id)}">Eliminar</button>
                        </div>
                    </div>
                </div>
                <div class="d-flex justify-content-between small text-muted mt-2">
                    <span>${formatDate(expense.date)} — ${isMe ? 'Pagaste' : 'Pagó ' + escapeHtml(payerLabel)}</span>
                    <span>Tu parte: ${formatCurrency(meSplit)}</span>
                </div>
                ${expense.splits && expense.splits.length > 0 ? `
                <details class="split-breakdown mt-2">
                    <summary class="small">Ver desglose (${expense.splits.length} partes)</summary>
                    <ul class="small text-muted mb-0 mt-1">
                        ${expense.splits.map(sp => `<li>${escapeHtml(sp.split_username || sp.user_id)}: ${formatCurrency(sp.amount)}</li>`).join('')}
                    </ul>
                </details>` : ''}
            </div>`;
    }).join('');
}

// ── Chart ──
function updateChart() {
    const chartEl = document.getElementById('category-chart');
    if (!chartEl) return;

    const categoryTotals = {};
    allExpenses.forEach(e => {
        const cat = e.category || 'Otros';
        categoryTotals[cat] = (categoryTotals[cat] || 0) + e.amount;
    });

    const labels = Object.keys(categoryTotals);
    const data = Object.values(categoryTotals);
    const colors = ['#6990B7', '#FF6384', '#36A2EB', '#FFCE56', '#4BC0C0', '#9966FF', '#FF9F40', '#C9CBCF'];

    if (categoryChartInstance) categoryChartInstance.destroy();

    categoryChartInstance = new Chart(chartEl.getContext('2d'), {
        type: 'doughnut',
        data: {
            labels,
            datasets: [{ data, backgroundColor: colors.slice(0, labels.length) }]
        },
        options: { responsive: true, plugins: { legend: { position: 'bottom', labels: { padding: 10 } } } }
    });
}

// ── Form ──
// Editor reutilizable de montos exactos para todos los miembros del grupo.
function memberLabel(m) {
    const name = String(m.name || m.username || 'Miembro').trim();
    return m.username === currentUser?.username ? `Vos (${name})` : `${name} (${m.username})`;
}

function renderCustomSplitInputs(container, members, prefix, values = {}) {
    if (!container) return;
    container.innerHTML = `
        <div class="small text-muted mb-1">Montos exactos por miembro (la suma debe igualar el monto)</div>
        <div class="row g-2">
            ${(members || []).map(m => `
                <div class="col-6">
                    <label class="small" for="${prefix}-${escapeHtml(m.user_id)}">${escapeHtml(memberLabel(m))}</label>
                    <input type="number" class="form-control custom-split-input" min="0" step="0.01"
                        id="${prefix}-${escapeHtml(m.user_id)}" data-user-id="${escapeHtml(m.user_id)}"
                        value="${values[m.user_id] !== undefined ? escapeHtml(values[m.user_id]) : ''}">
                </div>`).join('')}
        </div>
        <div class="small mt-1" id="${prefix}-sum" aria-live="polite"></div>`;
    container.querySelectorAll('.custom-split-input').forEach(input => {
        input.addEventListener('input', () => updateSplitSum(container, prefix));
    });
    updateSplitSum(container, prefix);
}

function updateSplitSum(container, prefix) {
    const sumEl = document.getElementById(`${prefix}-sum`);
    if (!sumEl) return;
    const inputs = container?.querySelectorAll('.custom-split-input') || [];
    const sum = [...inputs].reduce((acc, i) => acc + (parseFloat(i.value) || 0), 0);
    const amountEl = document.getElementById(prefix === 'edit-custom' ? 'edit-amount' : 'expense-amount');
    const amount = parseFloat(amountEl?.value || 0);
    const ok = Math.abs(Math.round(sum * 100) - Math.round(amount * 100)) <= 1;
    sumEl.className = 'small mt-1 ' + (ok ? 'text-success' : 'text-danger');
    sumEl.textContent = `Suma de partes: ${formatCurrency(sum)} / ${formatCurrency(amount)}`;
}

function getCustomSplits(container) {
    return [...(container?.querySelectorAll('.custom-split-input') || [])].map(input => ({
        user_id: input.dataset.userId,
        amount: parseFloat(input.value || 0) || 0
    }));
}

function customSplitsValid(container, amount) {
    const splits = getCustomSplits(container);
    const sum = splits.reduce((acc, s) => acc + s.amount, 0);
    return splits.length > 0 && Math.abs(Math.round(sum * 100) - Math.round(Number(amount) * 100)) <= 1;
}

function updateSplitDisplay() {
    const display = document.getElementById('split-display');
    if (!display) return;
    const amount = parseFloat(document.getElementById('expense-amount')?.value || 0);
    const count = (currentGroupMembers || []).filter(m => m.status !== 'pending').length || 1;

    if (currentSplitMode === 'equal') {
        if (count === 1) {
            display.innerHTML = `<p class="text-muted">Sos el único miembro: lo pagás todo vos (${formatCurrency(amount)})</p>`;
        } else {
            display.innerHTML = `<p class="text-muted">División: cada uno paga <strong>${formatCurrency(amount / count)}</strong> (${count} miembros)</p>`;
        }
    } else if (currentSplitMode === 'solo') {
        const payerLabel = document.getElementById('expense-payer')?.selectedOptions[0]?.textContent || 'El pagador';
        display.innerHTML = `<p class="text-muted"><strong>${escapeHtml(payerLabel)}</strong> paga todo: <strong>${formatCurrency(amount)}</strong></p>`;
    } else {
        renderCustomSplitInputs(display, currentGroupMembers.filter(m => m.status !== 'pending'), 'add-custom');
    }
}

async function submitExpense() {
    const description = document.getElementById('expense-description');
    const amount = document.getElementById('expense-amount');
    const date = document.getElementById('expense-date');
    const category = document.getElementById('expense-category');
    const payer = document.getElementById('expense-payer');

    if (!description || !amount || !date || !category || !payer) return;

    const formData = {
        description: description.value,
        amount: amount.value,
        date: date.value,
        category: category.value,
        payer: payer.value
    };

    if (currentSplitMode === 'custom') {
        await ensureGroupMembers();
        const container = document.getElementById('split-display');
        if (!customSplitsValid(container, formData.amount)) {
            Swal.fire({ icon: 'warning', title: 'Reparto incompleto', text: 'La suma de las partes debe igualar el monto del gasto.' });
            return;
        }
        formData.customSplits = JSON.stringify(getCustomSplits(container).filter(x => x.amount > 0));
    }

    addExpense(formData);
}

// ── Edición de gastos ──
async function openEditExpenseModal(expenseId) {
    const expense = allExpenses.find(e => e.id === expenseId);
    if (!expense) return;
    try { await ensureGroupMembers(); } catch (e) { console.error(e); }
    editingExpenseId = expenseId;
    editingSplitMode = expense.split_mode || 'equal';
    document.getElementById('edit-date').value = expense.date || '';
    document.getElementById('edit-description').value = expense.description || '';
    document.getElementById('edit-amount').value = expense.amount || '';
    document.getElementById('edit-category').value = expense.category || 'Otros';
    renderPayerOptionsFor('edit-payer');
    document.getElementById('edit-payer').value = expense.payer || '';
    document.querySelectorAll('input[name="edit_split_mode"]').forEach(radio => {
        radio.checked = radio.value === editingSplitMode;
    });
    const modal = new bootstrap.Modal(document.getElementById('editExpenseModal'));
    modal.show();
    updateEditSplitDisplay(expense.splits || []);
}

function renderPayerOptionsFor(selectId) {
    const select = document.getElementById(selectId);
    if (!select) return;
    select.innerHTML = (currentGroupMembers || []).map(m => {
        const label = escapeHtml(String(m.name || m.username || 'Miembro').trim());
        const suffix = m.username === currentUser?.username ? '' : ` (${escapeHtml(m.username)})`;
        return `<option value="${escapeHtml(m.username)}">${m.username === currentUser?.username ? 'Vos · ' : ''}${label}${suffix}</option>`;
    }).join('') || '<option value="me">Vos</option>';
}

async function updateEditSplitDisplay(existingSplits = []) {
    const display = document.getElementById('edit-split-display');
    if (!display) return;
    const amount = parseFloat(document.getElementById('edit-amount')?.value || 0);
    if (editingSplitMode === 'equal') {
        const count = (currentGroupMembers || []).filter(m => m.status !== 'pending').length || 1;
        display.innerHTML = `<p class="text-muted">Cada uno paga <strong>${formatCurrency(amount / count)}</strong> (${count} miembros)</p>`;
    } else if (editingSplitMode === 'solo') {
        display.innerHTML = '<p class="text-muted">El pagador cubre el monto completo.</p>';
    } else {
        if (currentGroupMembers.length === 0) {
            await ensureGroupMembers();
        }
        renderPayerOptionsFor('edit-payer');
        const values = {};
        (existingSplits || []).forEach(sp => {
            const m = (currentGroupMembers || []).find(x =>
                String(x.user_id) === String(sp.user_id) || x.username === sp.split_username);
            if (m) values[m.user_id] = sp.amount;
        });
        renderCustomSplitInputs(display, currentGroupMembers.filter(m => m.status !== 'pending'), 'edit-custom', values);
        if (Object.keys(values).length === 0) {
            // Gasto guardado con miembros hoy inactivos: se muestran igual.
            const extra = (existingSplits || []).filter(sp => !currentGroupMembers.some(m =>
                String(m.user_id) === String(sp.user_id) || m.username === sp.split_username));
            if (extra.length) {
                display.insertAdjacentHTML('beforeend', '<p class="small text-muted mt-1">Algunas partes originales pertenecen a miembros inactivos; se conservarán al guardar.</p>');
            }
        }
    }
}

async function submitEditExpense() {
    if (!editingExpenseId) return;
    const amount = parseFloat(document.getElementById('edit-amount').value);
    const payload = {
        date: document.getElementById('edit-date').value,
        description: document.getElementById('edit-description').value,
        amount,
        category: document.getElementById('edit-category').value,
        payer: document.getElementById('edit-payer').value,
        split_mode: editingSplitMode,
        splits: []
    };
    if (editingSplitMode === 'custom') {
        const container = document.getElementById('edit-split-display');
        if (!customSplitsValid(container, amount)) {
            Swal.fire({ icon: 'warning', title: 'Reparto incompleto', text: 'La suma de las partes debe igualar el monto del gasto.' });
            return;
        }
        payload.splits = getCustomSplits(container).filter(x => x.amount > 0);
    }
    try {
        await apiPut(`/api/groups/${currentGroupId}/expenses/${editingExpenseId}`, payload);
        const modal = bootstrap.Modal.getInstance(document.getElementById('editExpenseModal'));
        modal.hide();
        editingExpenseId = null;
        await loadExpenses();
        Swal.fire({ icon: 'success', title: 'Gasto actualizado', toast: true, position: 'top-end', showConfirmButton: false, timer: 1500 });
    } catch (err) {
        Swal.fire({ icon: 'error', title: 'Error', text: err.message });
    }
}

// ── Init ──
document.addEventListener('DOMContentLoaded', () => {
    const dateInput = document.getElementById('expense-date');
    if (dateInput) dateInput.value = new Date().toISOString().split('T')[0];

    // Login form
    const loginForm = document.getElementById('login-form');
    if (loginForm) {
        loginForm.addEventListener('submit', async (e) => {
            e.preventDefault();
            const errorEl = document.getElementById('login-error');
            if (errorEl) errorEl.textContent = '';
            try {
                const res = await fetch('/api/login', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({
                        username: document.getElementById('login-username').value,
                        password: document.getElementById('login-password').value
                    })
                });
                const data = await res.json().catch(() => ({}));
                if (!res.ok) {
                    if (errorEl) errorEl.textContent = data.error || 'No se pudo iniciar sesión';
                    return;
                }
                window.location.reload();
            } catch (err) {
                if (errorEl) errorEl.textContent = err.message;
            }
        });
    }

    // Google login
    const googleBtn = document.getElementById('google-login-btn');
    if (googleBtn) {
        const googleSection = document.getElementById('google-login-section');
        fetch('/api/google/config')
            .then(res => res.json())
            .then(data => {
                if (data.enabled && googleSection) googleSection.hidden = false;
            })
            .catch(() => {});

        googleBtn.addEventListener('click', async () => {
            try {
                const res = await fetch('/api/google/init', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ origin: window.location.origin })
                });
                const data = await res.json();
                if (!res.ok) throw new Error(data.error || 'No se pudo iniciar Google');
                const authUrl = data.redirectUrl || data.authUrl;
                if (authUrl) window.location.href = authUrl;
            } catch (e) {
                document.getElementById('login-error').textContent = e.message;
            }
        });
    }

    // Split mode change
    document.querySelectorAll('input[name="split_mode"]').forEach(radio => {
        radio.addEventListener('change', async () => {
            currentSplitMode = radio.value;
            if (currentSplitMode === 'custom') {
                try { await ensureGroupMembers(); } catch (e) { console.error(e); }
            }
            updateSplitDisplay();
        });
    });

    // La preview se actualiza mientras se completa el formulario
    document.getElementById('expense-amount')?.addEventListener('input', () => {
        updateSplitDisplay();
        if (editingExpenseId) updateEditSplitDisplay();
    });
    document.getElementById('expense-payer')?.addEventListener('change', updateSplitDisplay);
    updateSplitDisplay();

    // Filter inputs
    document.getElementById('search-input')?.addEventListener('input', (e) => {
        historyFilters.search = e.target.value;
        renderExpenses();
    });
    document.getElementById('category-filter')?.addEventListener('change', (e) => {
        historyFilters.category = e.target.value;
        renderExpenses();
    });
    document.getElementById('payer-filter')?.addEventListener('change', (e) => {
        historyFilters.payer = e.target.value;
        renderExpenses();
    });
    document.getElementById('month-filter')?.addEventListener('change', (e) => {
        historyFilters.month = e.target.value;
        renderExpenses();
    });

    // New group button
    document.getElementById('new-group-btn')?.addEventListener('click', openCreateGroupModal);
    document.getElementById('confirm-create-group')?.addEventListener('click', confirmCreateGroup);
    // Delete group (in dropdown)
    document.getElementById('delete-group-menu-btn')?.addEventListener('click', openDeleteGroupModal);
    document.getElementById('confirm-delete-group')?.addEventListener('click', confirmDeleteGroup);

    // Invitaciones recibidas
    document.getElementById('invitations-btn')?.addEventListener('click', () => {
        const tabBtn = document.querySelector('#app-tabs button[data-bs-target="#pane-members"]');
        if (tabBtn) new bootstrap.Tab(tabBtn).show();
        document.getElementById('invitations-panel')?.scrollIntoView({ behavior: 'smooth', block: 'center' });
    });

    // Edición de gasto
    document.getElementById('confirm-edit-expense')?.addEventListener('click', submitEditExpense);
    document.querySelectorAll('input[name="edit_split_mode"]').forEach(radio => {
        radio.addEventListener('change', async () => {
            editingSplitMode = radio.value;
            if (editingSplitMode === 'custom') {
                try { await ensureGroupMembers(); } catch (e) { console.error(e); }
            }
            updateEditSplitDisplay();
        });
    });

    // Invite member button
    document.getElementById('invite-member-btn')?.addEventListener('click', openInviteModal);
    document.getElementById('confirm-invite')?.addEventListener('click', confirmInvite);
    document.getElementById('invite-username')?.addEventListener('input', (e) => {
        clearTimeout(inviteSearchTimer);
        inviteSearchTimer = setTimeout(() => searchUsersForInvite(e.target.value), 250);
    });

    // Profile button
    document.getElementById('profile-btn')?.addEventListener('click', () => {
        const modal = new bootstrap.Modal(document.getElementById('profileModal'));
        document.getElementById('profile-name').value = currentUser?.name || '';
        document.getElementById('profile-current-password').value = '';
        document.getElementById('profile-email').value = '';
        document.getElementById('profile-password').value = '';
        modal.show();
    });
    document.getElementById('confirm-profile')?.addEventListener('click', async () => {
        const currentPassword = document.getElementById('profile-current-password').value;
        const name = document.getElementById('profile-name').value.trim();
        const email = document.getElementById('profile-email').value.trim();
        const password = document.getElementById('profile-password').value;
        const body = { current_password: currentPassword };
        if (name) body.name = name;
        if (email) body.email = email;
        if (password) body.password = password;
        if (password) {
            const pwdError = passwordValidationError(password);
            if (pwdError) {
                Swal.fire({ icon: 'warning', title: 'Contraseña inválida', text: pwdError });
                return;
            }
        }
        if (!name && !email && !password) {
            Swal.fire({ icon: 'info', title: 'Sin cambios', text: 'No se modificó ningún campo.' });
            return;
        }
        try {
            const result = await apiPut('/api/profile', body);
            const modal = bootstrap.Modal.getInstance(document.getElementById('profileModal'));
            modal.hide();
            if (result.name) {
                currentUser.name = result.name;
                renderHeader();
            }
            Swal.fire({ icon: 'success', title: 'Perfil actualizado', text: 'Los cambios se guardaron correctamente.' });
        } catch (err) {
            Swal.fire({ icon: 'error', title: 'Error', text: err.message });
        }
    });

    // Delete account button
    document.getElementById('delete-account-btn')?.addEventListener('click', async () => {
        const currentPassword = document.getElementById('profile-current-password').value;
        if (!currentPassword) {
            Swal.fire({ icon: 'warning', title: 'Contraseña requerida', text: 'Ingresá tu contraseña actual para eliminar la cuenta.' });
            return;
        }
        const result = await Swal.fire({
            title: '¿Eliminar tu cuenta?',
            text: 'Se eliminarán todos tus datos, grupos y gastos. Esta acción no se puede deshacer.',
            icon: 'warning',
            showCancelButton: true,
            confirmButtonText: 'Eliminar',
            cancelButtonText: 'Cancelar',
            confirmButtonColor: '#d33'
        });
        if (!result.isConfirmed) return;
        try {
            await apiDeleteWithBody('/api/profile', { current_password: currentPassword });
            const modal = bootstrap.Modal.getInstance(document.getElementById('profileModal'));
            modal.hide();
            Swal.fire({ icon: 'success', title: 'Cuenta eliminada', text: 'Tu cuenta fue eliminada.' }).then(() => {
                window.location.reload();
            });
        } catch (err) {
            Swal.fire({ icon: 'error', title: 'Error', text: err.message });
        }
    });

    // Tab change: refresh data
    document.querySelectorAll('#app-tabs button[data-bs-toggle="tab"]').forEach(btn => {
        btn.addEventListener('shown.bs.tab', (e) => {
            const target = e.target.getAttribute('data-bs-target');
            if (target === '#pane-balances') renderBalances();
            if (target === '#pane-stats') updateChart();
            if (target === '#pane-members') renderMembers();
            if (target === '#pane-expenses') renderExpenses();
        });
    });

    // Show register modal
    document.getElementById('show-register-btn')?.addEventListener('click', () => {
        const modal = new bootstrap.Modal(document.getElementById('registerModal'));
        document.getElementById('reg-name').value = '';
        document.getElementById('reg-username').value = '';
        document.getElementById('reg-password').value = '';
        document.getElementById('reg-email').value = '';
        modal.show();
    });

    // Confirm register
    document.getElementById('confirm-register')?.addEventListener('click', async () => {
        const name = document.getElementById('reg-name').value.trim();
        const username = document.getElementById('reg-username').value.trim();
        const password = document.getElementById('reg-password').value;
        const email = document.getElementById('reg-email').value.trim();
        if (!name || !username || !password || !email) {
            Swal.fire({ icon: 'warning', title: 'Campos requeridos', text: 'Nombre, username, contraseña y email son obligatorios.' });
            return;
        }
        if (!email.includes('@')) {
            Swal.fire({ icon: 'warning', title: 'Email inválido', text: 'Ingresá un email válido.' });
            return;
        }
        const pwdError = passwordValidationError(password);
        if (pwdError) {
            Swal.fire({ icon: 'warning', title: 'Contraseña inválida', text: pwdError });
            return;
        }
        try {
            await apiPost('/api/register', { username, password, email, name });
            const modal = bootstrap.Modal.getInstance(document.getElementById('registerModal'));
            modal.hide();
            Swal.fire({ icon: 'success', title: 'Cuenta creada', text: 'Ahora podés iniciar sesión.' });
            document.getElementById('login-username').value = username;
        } catch (err) {
            Swal.fire({ icon: 'error', title: 'Error', text: err.message });
        }
    });

    // Filtro por rango de fechas y exportación (solo afectan al historial)
    const dateFromInput = document.getElementById('date-from');
    const dateToInput = document.getElementById('date-to');
    dateFromInput?.addEventListener('change', () => {
        historyFilters.from = dateFromInput.value;
        renderExpenses();
    });
    dateToInput?.addEventListener('change', () => {
        historyFilters.to = dateToInput.value;
        renderExpenses();
    });
    document.getElementById('export-csv-btn')?.addEventListener('click', exportToCsv);

    // Pagos entre miembros (settle up)
    document.getElementById('payment-form')?.addEventListener('submit', (event) => {
        event.preventDefault();
        submitPayment();
    });
    const toggleModeBtn = document.getElementById('toggle-mode-btn');
    let paymentMode = false;
    toggleModeBtn?.addEventListener('click', () => {
        paymentMode = !paymentMode;
        const expenseForm = document.getElementById('expense-form');
        const paymentForm = document.getElementById('payment-form');
        const title = document.getElementById('form-title');
        toggleModeBtn.textContent = paymentMode ? 'Cambiar a Gasto' : 'Cambiar a Pago';
        if (expenseForm) expenseForm.style.display = paymentMode ? 'none' : '';
        if (paymentForm) {
            paymentForm.style.display = paymentMode ? '' : 'none';
            if (paymentMode) {
                const paymentDate = document.getElementById('payment-date');
                if (paymentDate) paymentDate.value = new Date().toISOString().split('T')[0];
                renderPaymentOptions();
            }
        }
        if (title) title.textContent = paymentMode ? 'Registrar pago' : 'Agregar gasto';
    });

    // Load
    loadAuth();
});

window.submitPayment = submitPayment;

// Enlace al backoffice: solo se crea si el servidor confirma rol superadmin.
// Va acá aparte para no mezclarse con el init principal de la app.
document.addEventListener('DOMContentLoaded', () => {
    fetch('/api/admin/me', { credentials: 'same-origin' })
        .then(r => r.ok ? r.json() : null)
        .then(info => {
            if (!info?.superadmin) return;
            const menu = document.querySelector('.app-header .dropdown-menu-end');
            if (!menu || document.getElementById('admin-link')) return;
            const item = document.createElement('li');
            item.innerHTML = '<a class="dropdown-item" id="admin-link" href="/admin">📊 Backoffice</a>';
            menu.prepend(item);
        })
        .catch(() => { /* sin backoffice visible es un estado válido */ });
});
window.deletePayment = deletePayment;
window.exportToCsv = exportToCsv;
