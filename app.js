const themeKey = 'seg_theme';
const defaultTheme = 'github';
let categoryChartInstance = null;
let allExpenses = [];
let isSubmittingExpense = false;
let historyFilters = { search: '', category: '', payer: '', month: '' };
let currentUser = null;
let currentGroupId = null;
let currentGroupName = null;
let currentSplitMode = 'equal';

document.documentElement.setAttribute('data-bs-theme', localStorage.getItem(themeKey) || defaultTheme);

function changeTheme(theme) {
    document.documentElement.setAttribute('data-bs-theme', theme);
    localStorage.setItem(themeKey, theme);
}

function formatCurrency(value) {
    return new Intl.NumberFormat('es-UY', { style: 'currency', currency: 'UYU', maximumFractionDigits: 0 }).format(Number(value || 0));
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
        currentUser = { username: data.user, payer: data.payer, role: data.role };

        if (data.groups && data.groups.length > 0) {
            currentGroupId = data.defaultGroup ? data.defaultGroup.id : data.groups[0].id;
            currentGroupName = data.defaultGroup ? data.defaultGroup.name : data.groups[0].name;
        }

        document.getElementById('login-screen').hidden = true;
        document.getElementById('app-screen').hidden = false;
        renderHeader();
        renderGroupSelector();
        loadExpenses();
    } catch (err) {
        document.getElementById('login-screen').hidden = false;
        document.getElementById('app-screen').hidden = true;
        const errEl = document.getElementById('login-error');
        if (errEl) errEl.textContent = err.message;
    }
}

async function logout() {
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
        el.textContent = currentUser.username.charAt(0).toUpperCase() + currentUser.username.slice(1);
    }
}

function renderGroupSelector() {
    fetch('/api/auth/check')
        .then(r => r.json())
        .then(data => {
            if (!data.groups || data.groups.length === 0) return;
            const selector = document.getElementById('group-selector');
            if (!selector) return;
            const current = data.groups.find(g => g.id == currentGroupId) || data.groups[0];
            currentGroupId = current.id;
            currentGroupName = current.name;
            selector.innerHTML = data.groups.map(g =>
                `<option value="${g.id}" ${g.id == currentGroupId ? 'selected' : ''}>${g.name}</option>`
            ).join('');
            selector.onchange = () => {
                currentGroupId = parseInt(selector.value);
                const selected = data.groups.find(g => g.id == currentGroupId);
                currentGroupName = selected ? selected.name : null;
                loadExpenses();
                updateDeleteButton(data.groups);
            };
            // Show delete button only if admin of current group
            updateDeleteButton(data.groups);
        })
        .catch(e => console.error('[APP] Group selector error:', e));
}

function updateDeleteButton(groups) {
    const btn = document.getElementById('delete-group-btn');
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
        currentGroupName = name;
        const modal = bootstrap.Modal.getInstance(document.getElementById('createGroupModal'));
        modal.hide();
        await loadAuth();
    } catch (err) {
        Swal.fire({ icon: 'error', title: 'Error', text: err.message });
    }
}

function openDeleteGroupModal() {
    const selector = document.getElementById('group-selector');
    const selectedOption = selector ? selector.options[selector.selectedIndex] : null;
    const name = selectedOption ? selectedOption.text : (currentGroupName || 'este grupo');
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
        renderBalance();
        renderBalances();
        updateChart();
        populateMonthFilter();
        renderMembers();
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
                        <div class="fw-semibold">${b.username}</div>
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
        if (members.length === 0) {
            container.innerHTML = '<p class="text-muted">No hay miembros.</p>';
            return;
        }
        container.innerHTML = members.map(m => `
            <div class="member-row d-flex justify-content-between align-items-center py-2 border-bottom">
                <div>
                    <span class="fw-semibold">${m.username}</span>
                    <span class="badge bg-secondary ms-2">${m.member_role}</span>
                </div>
                ${m.member_role !== 'admin' || members.filter(x => x.member_role === 'admin').length > 1
                    ? `<button class="btn btn-sm btn-outline-danger" onclick="removeMember(${m.user_id})">Eliminar</button>`
                    : ''}
            </div>`).join('');
    } catch (err) {
        console.error('[APP] Failed to load members:', err);
        container.innerHTML = '<p class="text-danger">Error al cargar miembros.</p>';
    }
}

async function addMember() {
    const username = document.getElementById('new-member-username')?.value?.trim();
    const role = document.getElementById('new-member-role')?.value || 'member';
    if (!username) { Swal.fire({ icon: 'warning', title: 'Username requerido', text: 'Ingresá un username para el miembro.' }); return; }
    try {
        await apiPost(`/api/groups/${currentGroupId}/members`, { username, role });
        document.getElementById('new-member-username').value = '';
        await renderMembers();
    } catch (err) {
        Swal.fire({ icon: 'error', title: 'Error', text: err.message });
    }
}

async function removeMember(userId) {
    const result = await Swal.fire({
        title: '¿Eliminar este miembro?',
        icon: 'warning',
        showCancelButton: true,
        confirmButtonText: 'Eliminar',
        cancelButtonText: 'Cancelar'
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
    const months = [...new Set(allExpenses.map(e => e.date?.substring(0, 7)))].filter(Boolean).sort().reverse();
    monthFilter.innerHTML = '<option value="">Todos los meses</option>' +
        months.map(m => `<option value="${m}">${m}</option>`).join('');
}

async function addExpense(formData) {
    if (isSubmittingExpense) return;
    isSubmittingExpense = true;
    try {
        let splits = [];
        const amount = parseFloat(formData.amount);
        const otherUser = currentUser.username === 'tin' ? 'noe' : 'tin';

        if (currentSplitMode === 'equal') {
            splits = [
                { user_id: currentUser.username, amount: amount / 2 },
                { user_id: otherUser, amount: amount / 2 }
            ];
        } else if (currentSplitMode === 'solo') {
            splits = [{ user_id: formData.payer, amount }];
        } else if (formData.customSplits) {
            splits = JSON.parse(formData.customSplits);
        }

        await apiPost(`/api/groups/${currentGroupId}/expenses`, {
            date: formData.date,
            description: formData.description,
            amount: amount,
            payer: formData.payer,
            category: formData.category,
            currency: 'UYU',
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
        return true;
    });

    if (filtered.length === 0) {
        container.innerHTML = '<div class="text-center py-5 text-muted"><p>No hay gastos registrados</p></div>';
        return;
    }

    container.innerHTML = filtered.map(expense => {
        const isMe = expense.payer === currentUser.username;
        const meSplit = expense.splits && expense.splits.length > 0
            ? expense.splits.find(s => s.user_id === currentUser.username)?.amount || expense.amount / 2
            : expense.amount / 2;

        return `
            <div class="expense-card mb-2 p-3">
                <div class="d-flex justify-content-between align-items-start">
                    <div>
                        <div class="text-muted small">${expense.category || 'Sin categoría'}</div>
                        <div>${expense.description || 'Sin descripción'}</div>
                    </div>
                    <div class="text-end">
                        <div class="fw-bold">${formatCurrency(expense.amount)}</div>
                        <button class="btn btn-sm btn-outline-danger px-2 py-0" onclick="deleteExpense(${expense.id})">Eliminar</button>
                    </div>
                </div>
                <div class="d-flex justify-content-between small text-muted mt-2">
                    <span>${formatDate(expense.date)} — ${isMe ? 'Pagaste' : 'Pagó ' + (expense.payer === 'tin' ? 'Tin' : 'Noe')}</span>
                    <span>Tu parte: ${formatCurrency(meSplit)}</span>
                </div>
            </div>`;
    }).join('');
}

function renderBalance() {
    const container = document.getElementById('balance-display');
    if (!container) return;

    let totalPaid = 0, totalOwed = 0;
    allExpenses.forEach(expense => {
        const meSplit = expense.splits && expense.splits.length > 0
            ? expense.splits.find(s => s.user_id === currentUser.username)?.amount || 0
            : expense.amount / 2;
        if (expense.payer === currentUser.username) {
            totalPaid += expense.amount - meSplit;
        } else {
            totalOwed += expense.amount - meSplit;
        }
    });

    const balance = totalPaid - totalOwed;
    container.innerHTML = `
        <div class="row text-center">
            <div class="col-4">
                <div class="balance-label">Pagaste</div>
                <div class="balance-amount">${formatCurrency(totalPaid)}</div>
            </div>
            <div class="col-4">
                <div class="balance-label">Deben</div>
                <div class="balance-amount ${balance > 0 ? 'text-success' : 'text-danger'}">${formatCurrency(Math.abs(balance))}</div>
            </div>
            <div class="col-4">
                <div class="balance-label">${balance >= 0 ? 'Te deben' : 'Debes'}</div>
                <div class="balance-amount ${balance >= 0 ? 'text-success' : 'text-danger'}">${balance >= 0 ? '→' : '←'}</div>
            </div>
        </div>`;
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
function updateSplitDisplay() {
    const display = document.getElementById('split-display');
    if (!display) return;
    const amount = parseFloat(document.getElementById('expense-amount')?.value || 0);

    if (currentSplitMode === 'equal') {
        display.innerHTML = `<p class="text-muted">División: cada uno paga <strong>${formatCurrency(amount / 2)}</strong></p>`;
    } else if (currentSplitMode === 'solo') {
        const payerLabel = document.getElementById('expense-payer')?.value === 'me' ? 'Tú' : 'Tu pareja';
        display.innerHTML = `<p class="text-muted"><strong>${payerLabel}</strong> paga todo: <strong>${formatCurrency(amount)}</strong></p>`;
    } else {
        display.innerHTML = `
            <div class="row">
                <div class="col-6"><label class="small">Tu parte (UR$)</label><input type="number" id="split-me" class="form-control" placeholder="0" step="100"></div>
                <div class="col-6"><label class="small">Parte pareja (UR$)</label><input type="number" id="split-partner" class="form-control" placeholder="0" step="100"></div>
            </div>`;
    }
}

function submitExpense() {
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
        payer: payer.value,
        currency: 'UYU'
    };

    if (currentSplitMode === 'custom') {
        formData.customSplits = JSON.stringify([
            { user_id: currentUser.username, amount: parseFloat(document.getElementById('split-me')?.value || 0) },
            { user_id: currentUser.username === 'tin' ? 'noe' : 'tin', amount: parseFloat(document.getElementById('split-partner')?.value || 0) }
        ]);
    }

    addExpense(formData);
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
            try {
                await fetch('/api/login', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({
                        username: document.getElementById('login-username').value,
                        password: document.getElementById('login-password').value
                    })
                });
                window.location.reload();
            } catch (err) {
                document.getElementById('login-error').textContent = err.message;
            }
        });
    }

    // Google login
    const googleBtn = document.getElementById('google-login-btn');
    if (googleBtn) {
        googleBtn.addEventListener('click', async () => {
            try {
                const res = await fetch('/api/google/init');
                const data = await res.json();
                if (data.authUrl) window.location.href = data.authUrl;
            } catch (e) {
                document.getElementById('login-error').textContent = e.message;
            }
        });
    }

    // Split mode change
    document.querySelectorAll('input[name="split_mode"]').forEach(radio => {
        radio.addEventListener('change', () => {
            currentSplitMode = radio.value;
            updateSplitDisplay();
        });
    });

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
    // Delete group button
    document.getElementById('delete-group-btn')?.addEventListener('click', openDeleteGroupModal);
    document.getElementById('confirm-delete-group')?.addEventListener('click', confirmDeleteGroup);

    // Profile button
    document.getElementById('profile-btn')?.addEventListener('click', () => {
        const modal = new bootstrap.Modal(document.getElementById('profileModal'));
        document.getElementById('profile-email').value = '';
        document.getElementById('profile-password').value = '';
        modal.show();
    });
    document.getElementById('confirm-profile')?.addEventListener('click', async () => {
        const email = document.getElementById('profile-email').value.trim();
        const password = document.getElementById('profile-password').value;
        const body = {};
        if (email) body.email = email;
        if (password) body.password = password;
        if (Object.keys(body).length === 0) {
            Swal.fire({ icon: 'info', title: 'Sin cambios', text: 'No se modificó ningún campo.' });
            return;
        }
        try {
            await apiPut('/api/profile', body);
            const modal = bootstrap.Modal.getInstance(document.getElementById('profileModal'));
            modal.hide();
            Swal.fire({ icon: 'success', title: 'Perfil actualizado', text: 'Los cambios se guardaron correctamente.' });
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
            if (target === '#pane-expenses') { renderExpenses(); renderBalance(); }
        });
    });

    // Show register modal
    document.getElementById('show-register-btn')?.addEventListener('click', () => {
        const modal = new bootstrap.Modal(document.getElementById('registerModal'));
        document.getElementById('reg-username').value = '';
        document.getElementById('reg-password').value = '';
        document.getElementById('reg-email').value = '';
        modal.show();
    });

    // Confirm register
    document.getElementById('confirm-register')?.addEventListener('click', async () => {
        const username = document.getElementById('reg-username').value.trim();
        const password = document.getElementById('reg-password').value;
        const email = document.getElementById('reg-email').value.trim();
        if (!username || !password || !email) {
            Swal.fire({ icon: 'warning', title: 'Campos requeridos', text: 'Username, contraseña y email son obligatorios.' });
            return;
        }
        if (!email.includes('@')) {
            Swal.fire({ icon: 'warning', title: 'Email inválido', text: 'Ingresá un email válido.' });
            return;
        }
        try {
            await apiPost('/api/register', { username, password, email: email || undefined });
            const modal = bootstrap.Modal.getInstance(document.getElementById('registerModal'));
            modal.hide();
            Swal.fire({ icon: 'success', title: 'Cuenta creada', text: 'Ahora podés iniciar sesión.' });
            document.getElementById('login-username').value = username;
        } catch (err) {
            Swal.fire({ icon: 'error', title: 'Error', text: err.message });
        }
    });

    // Load
    loadAuth();
});
