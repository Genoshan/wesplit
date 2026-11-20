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

function logout() {
    document.cookie = 'session_token=; expires=Thu, 01 Jan 1970 00:00:00 GMT; path=/';
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
                loadExpenses();
            };
        })
        .catch(e => console.error('[APP] Group selector error:', e));
}

// ── Expenses ──
async function loadExpenses() {
    if (!currentGroupId) return;
    try {
        const data = await apiGet(`/api/groups/${currentGroupId}/expenses`);
        allExpenses = data;
        renderExpenses();
        renderBalance();
        updateChart();
        populateMonthFilter();
    } catch (err) {
        console.error('[APP] Failed to load expenses:', err);
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
        alert(err.message);
    } finally {
        isSubmittingExpense = false;
    }
}

async function deleteExpense(expenseId) {
    if (!confirm('¿Eliminar este gasto?')) return;
    try {
        await apiDelete(`/api/groups/${currentGroupId}/expenses/${expenseId}`);
        await loadExpenses();
    } catch (err) {
        console.error('[APP] Failed to delete expense:', err);
        alert(err.message);
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

    // Load
    loadAuth();
});
