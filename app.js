const themeKey = 'seg_theme';
const defaultTheme = 'github';
let categoryChartInstance = null;
let allExpenses = [];
let isSubmittingExpense = false;
let historyFilters = {
    search: '',
    category: '',
    payer: '',
    month: ''
};

let currentUser = null;

document.documentElement.setAttribute('data-bs-theme', localStorage.getItem(themeKey) || defaultTheme);

function changeTheme(theme) {
    document.documentElement.setAttribute('data-bs-theme', theme);
    localStorage.setItem(themeKey, theme);
}

function formatCurrency(value) {
    return new Intl.NumberFormat('es-UY', {
        style: 'currency',
        currency: 'UYU',
        maximumFractionDigits: 0
    }).format(Number(value || 0));
}

function formatDate(value) {
    if (!value) return 'Sin fecha';

    const date = new Date(`${value}T00:00:00`);
    if (Number.isNaN(date.getTime())) return value;

    return new Intl.DateTimeFormat('es-UY', {
        day: '2-digit',
        month: 'short',
        year: 'numeric'
    }).format(date);
}

function parseExpenseDate(value) {
    if (!value) return null;

    const date = new Date(`${value}T00:00:00`);
    return Number.isNaN(date.getTime()) ? null : date;
}

function payerName(payer) {
    if (payer === 'me') return 'Tin';
    if (payer === 'partner') return 'Noe';
    return payer || 'Sin pagador';
}

function categoryName(category) {
    return category || 'Otros';
}

function setSubmitState(isSaving) {
    const button = document.getElementById('submit-expense');
    if (!button) return;

    isSubmittingExpense = isSaving;
    button.disabled = isSaving;
    button.textContent = isSaving ? 'Guardando...' : 'Agregar gasto';
}

async function submitExpense(amount, description) {
    if (isSubmittingExpense) return;

    const parsedAmount = parseFloat(amount);
    const cleanDescription = description ? description.trim() : '';

    if (isNaN(parsedAmount) || parsedAmount <= 0) {
        Swal.fire('Atención', 'El monto debe ser un número válido mayor a cero.', 'warning');
        return;
    }

    if (!cleanDescription) {
        Swal.fire('Atención', 'La descripción no puede estar vacía.', 'warning');
        return;
    }

    setSubmitState(true);

    try {
        const response = await fetch('/api/expense', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                amount: parsedAmount,
                description: cleanDescription,
                category: document.getElementById('expenseCategory').value,
                payer: document.getElementById('expensePayer').value,
                date: new Date().toISOString().split('T')[0]
            })
        });

        if (!response.ok) {
            console.error('Error en el servidor:', response.statusText);
            Swal.fire('Error', 'Error en el servidor al guardar el gasto.', 'error');
            return;
        }

        document.getElementById('expense-form').reset();
        Swal.fire('¡Éxito!', 'Gasto registrado con éxito', 'success');
        await fetchHistory();
        document.getElementById('expenseAmount').focus();
    } catch (err) {
        console.error('Error de conexión:', err);
        Swal.fire('Fallo de conexión', 'No se pudo conectar con el servidor local.', 'error');
    } finally {
        setSubmitState(false);
    }
}

function processCategoryData(data) {
    const categoryTotals = {};

    data.forEach(item => {
        const category = categoryName(item.category);
        categoryTotals[category] = (categoryTotals[category] || 0) + parseFloat(item.amount || 0);
    });

    const defaultCategories = ['Alimentación', 'Transporte', 'Ocio', 'Servicios', 'Otros'];
    const labels = defaultCategories;
    const values = labels.map(category => categoryTotals[category] || 0);

    return {
        labels,
        values,
        total: values.reduce((sum, value) => sum + value, 0),
        topCategory: getTopCategoryFromTotals(categoryTotals)
    };
}

function getTopCategoryFromTotals(categoryTotals) {
    const entries = Object.entries(categoryTotals).filter(([, total]) => total > 0);
    if (entries.length === 0) return null;

    return entries.sort((a, b) => b[1] - a[1])[0];
}

function updateChart(data) {
    const canvas = document.getElementById('categoryChart');
    const emptyState = document.getElementById('chart-empty');
    const chartSummary = document.getElementById('chart-summary');
    if (!canvas || typeof Chart === 'undefined') return;

    const processedData = processCategoryData(data);

    if (categoryChartInstance) {
        categoryChartInstance.destroy();
        categoryChartInstance = null;
    }

    if (processedData.total <= 0) {
        canvas.hidden = true;
        if (emptyState) emptyState.hidden = false;
        if (chartSummary) chartSummary.textContent = 'Sin datos para comparar todavía.';
        return;
    }

    canvas.hidden = false;
    if (emptyState) emptyState.hidden = true;

    if (chartSummary && processedData.topCategory) {
        const [category, total] = processedData.topCategory;
        chartSummary.textContent = `${category} concentra ${formatCurrency(total)}.`;
    }

    categoryChartInstance = new Chart(canvas.getContext('2d'), {
        type: 'doughnut',
        data: {
            labels: processedData.labels,
            datasets: [{
                data: processedData.values,
                backgroundColor: ['#2f80ed', '#27ae60', '#f2c94c', '#9b51e0', '#eb5757'],
                borderWidth: 0
            }]
        },
        options: {
            responsive: true,
            maintainAspectRatio: false,
            plugins: {
                legend: {
                    position: 'bottom'
                },
                tooltip: {
                    callbacks: {
                        label: context => {
                            const label = context.label || 'Categoría';
                            return `${label}: ${formatCurrency(context.parsed)}`;
                        }
                    }
                }
            }
        }
    });
}

function escapeHtml(value) {
    return String(value)
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;')
        .replace(/'/g, '&#039;');
}

function renderHistory(items) {
    const historyBody = document.getElementById('history-body');
    updateHistoryCount(items.length);

    if (items.length === 0) {
        historyBody.innerHTML = '<tr><td colspan="6" class="empty-state">No hay gastos que coincidan con esos filtros.</td></tr>';
        return;
    }

    historyBody.innerHTML = items.map(item => {
        const paidBy = payerName(item.payer);

        return `
            <tr>
                <td>${escapeHtml(formatDate(item.date))}</td>
                <td class="fw-medium">${escapeHtml(item.description || 'Sin descripción')}</td>
                <td><span class="category-pill">${escapeHtml(categoryName(item.category))}</span></td>
                <td class="text-end fw-semibold">${escapeHtml(formatCurrency(item.amount))}</td>
                <td><span class="payer-pill payer-${escapeHtml(item.payer || 'unknown')}">${escapeHtml(paidBy)}</span></td>
                <td class="text-end">
                    <button class="btn btn-sm btn-outline-primary me-1" onclick="editExpense(${item.id})" title="Editar">Editar</button>
                    <button class="btn btn-sm btn-outline-danger" onclick="deleteExpense(${item.id})" title="Eliminar">Eliminar</button>
                </td>
            </tr>
        `;
    }).join('');
}

function updateHistoryCount(count) {
    const countElement = document.getElementById('history-count');
    if (!countElement) return;

    countElement.textContent = count === 1 ? '1 gasto' : `${count} gastos`;
}

function buildBalanceMessage(summary) {
    if (!summary) return 'Sin información de saldo.';

    const balance = Number(summary.balance || 0);
    if (balance === 0) return 'Están a mano.';

    if (summary.status === 'Te deben') {
        return `Noe le debe ${formatCurrency(balance)} a Tin.`;
    }

    return `Tin le debe ${formatCurrency(balance)} a Noe.`;
}

function updateSummary(summary, items) {
    document.getElementById('expense-count').textContent = items.length;
    updateComputedMetrics(items);

    if (!summary) {
        document.getElementById('debt-status').textContent = 'Sin información de saldo.';
        document.getElementById('balance-text').textContent = formatCurrency(0);
        document.getElementById('total-me').textContent = formatCurrency(0);
        document.getElementById('total-partner').textContent = formatCurrency(0);
        return;
    }

    document.getElementById('debt-status').textContent = buildBalanceMessage(summary);
    document.getElementById('balance-text').textContent = formatCurrency(summary.balance);
    document.getElementById('total-me').textContent = formatCurrency(summary.totalMe);
    document.getElementById('total-partner').textContent = formatCurrency(summary.totalPartner);
}

function updateComputedMetrics(items) {
    const now = new Date();
    const currentMonth = now.getMonth();
    const currentYear = now.getFullYear();
    const categoryTotals = {};

    let totalSpent = 0;
    let monthTotal = 0;

    items.forEach(item => {
        const amount = Number(item.amount || 0);
        const expenseDate = parseExpenseDate(item.date);

        totalSpent += amount;
        categoryTotals[categoryName(item.category)] = (categoryTotals[categoryName(item.category)] || 0) + amount;

        if (expenseDate && expenseDate.getMonth() === currentMonth && expenseDate.getFullYear() === currentYear) {
            monthTotal += amount;
        }
    });

    const topCategory = getTopCategoryFromTotals(categoryTotals);

    document.getElementById('total-spent').textContent = formatCurrency(totalSpent);
    document.getElementById('month-total').textContent = formatCurrency(monthTotal);
    document.getElementById('top-category').textContent = topCategory ? topCategory[0] : '-';
}

async function fetchHistory() {
    const historyBody = document.getElementById('history-body');

    try {
        const response = await fetch('/api/expenses');
        if (!response.ok) throw new Error('Error en la red: ' + response.status);

        const data = await response.json();
        allExpenses = data.expenses || [];
        hydrateHistoryFilterOptions();
        applyHistoryFilters();
        updateChart(allExpenses);
        updateSummary(data.summary, allExpenses);
    } catch (error) {
        console.error('Error en fetchHistory:', error);
        Swal.fire('Error', 'No se pudo cargar el historial de gastos.', 'error');
        historyBody.innerHTML = '<tr><td colspan="6" class="text-center text-danger py-4">Error al cargar historial.</td></tr>';
    }
}

function applyHistoryFilters() {
    const query = historyFilters.search.trim().toLowerCase();

    const filteredExpenses = allExpenses.filter(item => {
        const matchesSearch = !query || [
            item.description,
            categoryName(item.category),
            payerName(item.payer),
            item.date,
            item.amount
        ].some(value => String(value || '').toLowerCase().includes(query));

        const matchesCategory = !historyFilters.category || categoryName(item.category) === historyFilters.category;
        const matchesPayer = !historyFilters.payer || item.payer === historyFilters.payer;
        const matchesMonth = !historyFilters.month || (item.date && item.date.startsWith(historyFilters.month));

        return matchesSearch && matchesCategory && matchesPayer && matchesMonth;
    });

    renderHistory(filteredExpenses);
}

function filterHistory(searchValue) {
    historyFilters.search = searchValue;
    applyHistoryFilters();
}

function setCategoryFilter(category) {
    historyFilters.category = category;
    applyHistoryFilters();
}

function setPayerFilter(payer) {
    historyFilters.payer = payer;
    applyHistoryFilters();
}

function setMonthFilter(month) {
    historyFilters.month = month;
    applyHistoryFilters();
}

function hydrateHistoryFilterOptions() {
    const categoryFilter = document.getElementById('category-filter');
    const monthFilter = document.getElementById('month-filter');

    if (categoryFilter) {
        const categories = Array.from(new Set(allExpenses.map(item => categoryName(item.category)))).sort();
        const selectedCategory = categoryFilter.value;

        categoryFilter.innerHTML = '<option value="">Todas las categorías</option>' + categories.map(category => {
            return `<option value="${escapeHtml(category)}">${escapeHtml(category)}</option>`;
        }).join('');

        categoryFilter.value = categories.includes(selectedCategory) ? selectedCategory : '';
        historyFilters.category = categoryFilter.value;
    }

    if (monthFilter) {
        const months = Array.from(new Set(allExpenses
            .filter(item => item.date)
            .map(item => item.date.substring(0, 7))
        )).sort().reverse();

        const selectedMonth = monthFilter.value;

        monthFilter.innerHTML = '<option value="">Todos los meses</option>' + months.map(month => {
            const [year, m] = month.split('-');
            const label = new Date(year, parseInt(m) - 1).toLocaleDateString('es-UY', { year: 'numeric', month: 'long' });
            return `<option value="${month}">${label}</option>`;
        }).join('');

        monthFilter.value = months.includes(selectedMonth) ? selectedMonth : '';
        historyFilters.month = monthFilter.value;
    }
}

async function checkAuth() {
    try {
        const res = await fetch('/api/auth/check');
        if (!res.ok) {
            throw new Error();
        }
        const data = await res.json();
        currentUser = data;
        document.getElementById('login-screen').hidden = true;
        document.getElementById('app-main').hidden = false;
        document.getElementById('user-label').textContent = data.user === 'tin' ? 'Tin' : 'Noe';
        const payerSelect = document.getElementById('expensePayer');
        if (payerSelect) payerSelect.value = data.payer;
        initApp();
    } catch (err) {
        currentUser = null;
        document.getElementById('login-screen').hidden = false;
        document.getElementById('app-main').hidden = true;
        checkGoogleAuthAvailability();
    }
}

async function checkGoogleAuthAvailability() {
    try {
        const res = await fetch('/api/google/init', { method: 'POST' });
        const googleSection = document.getElementById('google-login-section');
        if (res.ok && googleSection) {
            googleSection.hidden = false;
        } else if (googleSection) {
            googleSection.hidden = true;
        }
    } catch (err) {
        const googleSection = document.getElementById('google-login-section');
        if (googleSection) {
            googleSection.hidden = true;
        }
    }
}

async function loginUser(username, password, feedbackEl) {
    feedbackEl.textContent = 'Conectando...';
    feedbackEl.classList.add('text-info');
    try {
        const res = await fetch('/api/login', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            credentials: 'include',
            body: JSON.stringify({ username, password })
        });

        if (!res.ok) {
            const data = await res.json().catch(() => ({}));
            feedbackEl.textContent = data.error || 'Credenciales inválidas';
            feedbackEl.classList.add('text-danger');
            return;
        }

        feedbackEl.textContent = '';
        feedbackEl.classList.remove('text-danger');
        await checkAuth();
    } catch (err) {
        console.error('[LOGIN] Error:', err);
        feedbackEl.textContent = 'Error de conexión con el servidor';
        feedbackEl.classList.add('text-danger');
    }
}

async function logoutUser() {
    await fetch('/api/logout', { method: 'POST' });
    currentUser = null;
    document.getElementById('login-screen').hidden = true;
    document.getElementById('app-main').hidden = true;
}

async function handleGoogleCallbackRedirect(code, state) {
    try {
        const res = await fetch(`/api/google/callback?code=${encodeURIComponent(code)}&state=${encodeURIComponent(state)}`);
        if (!res.ok) {
            const errorData = await res.json().catch(() => ({}));
            throw new Error(errorData.error || 'Error en el callback de Google');
        }
        const data = await res.json();
        currentUser = data;
        document.getElementById('login-screen').hidden = true;
        document.getElementById('app-main').hidden = false;
        document.getElementById('user-label').textContent = data.user === 'tin' ? 'Tin' : 'Noe';
        const payerSelect = document.getElementById('expensePayer');
        if (payerSelect) payerSelect.value = data.payer;
        
        // Limpiar URL de params
        const url = new URL(window.location);
        url.searchParams.delete('code');
        url.searchParams.delete('state');
        window.history.replaceState({}, document.title, url.pathname + url.search);
        
        initApp();
    } catch (err) {
        console.error('[GOOGLE CALLBACK] Error:', err);
        currentUser = null;
        document.getElementById('login-screen').hidden = false;
        document.getElementById('app-main').hidden = true;
        Swal.fire('Error', err.message || 'No se pudo completar el login con Google.', 'error');
    }
}

async function loginWithGoogle() {
    try {
        const res = await fetch('/api/google/init', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ origin: window.location.origin })
        });
        if (!res.ok) {
            throw new Error('No se pudo iniciar sesion con Google');
        }
        const data = await res.json();
        window.location.href = data.redirectUrl;
    } catch (err) {
        console.error('[GOOGLE LOGIN] Error:', err);
        Swal.fire('Error', 'No se pudo iniciar sesion con Google. Verifica la configuracion.', 'error');
    }
}

let editModalInstance = null;

function openEditModal() {
    if (editModalInstance) {
        editModalInstance.show();
    }
}

function closeEditModal() {
    if (editModalInstance) {
        editModalInstance.hide();
    }
    document.getElementById('edit-form').reset();
}

async function editExpense(id) {
    try {
        const expense = allExpenses.find(item => Number(item.id) === Number(id));
        if (!expense) {
            Swal.fire('Error', 'Gasto no encontrado.', 'error');
            return;
        }

        document.getElementById('edit-id').value = expense.id;
        document.getElementById('editDate').value = expense.date;
        document.getElementById('editDescription').value = expense.description;
        document.getElementById('editAmount').value = expense.amount;
        document.getElementById('editCategory').value = expense.category || 'Otros';
        document.getElementById('editPayer').value = expense.payer || 'me';

        if (editModalInstance) {
            editModalInstance.show();
        }
    } catch (err) {
        console.error('Error al abrir modal de edici\u00f3n:', err);
        Swal.fire('Error', 'No se pudo cargar el gasto para editar.', 'error');
    }
}

async function saveExpenseUpdate() {
    const id = document.getElementById('edit-id').value;
    const date = document.getElementById('editDate').value;
    const description = document.getElementById('editDescription').value;
    const amount = document.getElementById('editAmount').value;
    const category = document.getElementById('editCategory').value;
    const payer = document.getElementById('editPayer').value;

    if (!date) {
        Swal.fire('Atenci\u00f3n', 'La fecha es obligatoria.', 'warning');
        return;
    }

    const cleanDescription = description.trim();
    if (!cleanDescription) {
        Swal.fire('Atenci\u00f3n', 'La descripci\u00f3n no puede estar vac\u00eda.', 'warning');
        return;
    }

    const parsedAmount = parseFloat(amount);
    if (isNaN(parsedAmount) || parsedAmount <= 0) {
        Swal.fire('Atenci\u00f3n', 'El monto debe ser un n\u00famero v\u00e1lido mayor a cero.', 'warning');
        return;
    }

    try {
        const response = await fetch(`/api/expense/${id}`, {
            method: 'PUT',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                date,
                description: cleanDescription,
                amount: parsedAmount,
                category,
                payer
            })
        });

        if (!response.ok) {
            const errorData = await response.json();
            throw new Error(errorData.error || 'Error en el servidor');
        }

        Swal.fire('\u00a1Actualizado!', 'Gasto actualizado con \u00e9xito', 'success');
        closeEditModal();
        await fetchHistory();
    } catch (err) {
        console.error('Error al actualizar gasto:', err);
        Swal.fire('Error', err.message || 'No se pudo actualizar el gasto.', 'error');
    }
}

async function deleteExpense(id) {
    const result = await Swal.fire({
        title: '\u00bfEliminar gasto?',
        text: 'Esta acci\u00f3no no se puede deshacer.',
        icon: 'warning',
        showCancelButton: true,
        confirmButtonText: 'S\u00ed, eliminar',
        cancelButtonText: 'Cancelar'
    });

    if (!result.isConfirmed) {
        return;
    }

    try {
        const response = await fetch(`/api/expense/${id}`, {
            method: 'DELETE'
        });

        if (!response.ok) {
            const errorData = await response.json();
            throw new Error(errorData.error || 'Error en el servidor');
        }

        Swal.fire('\u00a1Eliminado!', 'Gasto eliminado correctamente.', 'success');
        await fetchHistory();
    } catch (err) {
        console.error('Error al eliminar gasto:', err);
        Swal.fire('Error', err.message || 'No se pudo eliminar el gasto.', 'error');
    }
}

async function handleDeleteFromEditModal() {
    const id = document.getElementById('edit-id').value;
    if (!id) {
        Swal.fire('Error', 'No hay gasto seleccionado.', 'error');
        return;
    }
    closeEditModal();
    await deleteExpense(id);
}

function initApp() {
    const editModal = document.getElementById('editModal');
    if (editModal) {
        editModalInstance = new bootstrap.Modal(editModal);
    }
    fetchHistory();
    loadRecurring();
}

document.addEventListener('DOMContentLoaded', () => {
    const form = document.getElementById('expense-form');
    const searchInput = document.getElementById('search-input');
    const categoryFilter = document.getElementById('category-filter');
    const payerFilter = document.getElementById('payer-filter');

    if (form) {
        form.addEventListener('submit', event => {
            event.preventDefault();
            submitExpense(
                document.getElementById('expenseAmount').value,
                document.getElementById('expenseDesc').value
            );
        });
    }

    if (searchInput) {
        searchInput.addEventListener('input', event => {
            filterHistory(event.target.value);
        });
    }

    if (categoryFilter) {
        categoryFilter.addEventListener('change', event => {
            setCategoryFilter(event.target.value);
        });
    }

    if (payerFilter) {
        payerFilter.addEventListener('change', event => {
            setPayerFilter(event.target.value);
        });
    }

    const monthFilter = document.getElementById('month-filter');
    if (monthFilter) {
        monthFilter.addEventListener('change', event => {
            setMonthFilter(event.target.value);
        });
    }

    const loginForm = document.getElementById('login-form');
    if (loginForm) {
        loginForm.addEventListener('submit', event => {
            event.preventDefault();
            const username = document.getElementById('login-username').value;
            const password = document.getElementById('login-password').value;
            const feedback = document.getElementById('login-feedback');
            loginUser(username, password, feedback);
        });
    }

    const googleLoginBtn = document.getElementById('google-login-btn');
    if (googleLoginBtn) {
        googleLoginBtn.addEventListener('click', loginWithGoogle);
    }

    // Check if we're coming from Google OAuth callback
    const urlParams = new URLSearchParams(window.location.search);
    if (urlParams.get('code') && urlParams.get('state')) {
        handleGoogleCallbackRedirect(urlParams.get('code'), urlParams.get('state'));
        return;
    }

    const editForm = document.getElementById('edit-form');
    if (editForm) {
        editForm.addEventListener('submit', event => {
            event.preventDefault();
            saveExpenseUpdate();
        });
    }

    const editDeleteBtn = document.getElementById('delete-edit-btn');
    if (editDeleteBtn) {
        editDeleteBtn.addEventListener('click', handleDeleteFromEditModal);
    }

    const editModal = document.getElementById('editModal');
    if (editModal) {
        editModal.addEventListener('hidden.bs.modal', () => {
            document.getElementById('edit-form').reset();
        });
    }

    checkAuth();
});

window.changeTheme = changeTheme;
window.submitExpense = submitExpense;
window.logoutUser = logoutUser;
window.editExpense = editExpense;
window.deleteExpense = deleteExpense;
window.loginWithGoogle = loginWithGoogle;

/* Recurring Expenses */
let recurringCache = [];

function getFreqLabel(freq) {
    const map = {
        'diario': 'Diario',
        'semanal': 'Semanal',
        'quincenal': 'Quincenal',
        'mensual': 'Mensual',
        'trimestral': 'Trimestral',
        'anual': 'Anual'
    };
    return map[freq] || freq;
}

function renderRecurring(list) {
    const container = document.getElementById('recurring-list');
    if (!container) return;
    recurringCache = list || [];

    if (list.length === 0) {
        container.innerHTML = '<p class="text-center text-muted empty-state">No hay gastos recurrentes configurados</p>';
        return;
    }

    container.innerHTML = list.map(item => `
        <div class="recurring-item" data-id="${item.id}">
            <div class="recurring-info">
                <p class="recurring-description">${escapeHtml(item.description)}</p>
                <div class="recurring-meta">
                    <span class="recurring-freq-badge">${getFreqLabel(item.frequency)}</span>
                    <span>${escapeHtml(formatDate(item.next_due_date))}</span>
                    <span>${escapeHtml(categoryName(item.category))}</span>
                </div>
            </div>
            <div class="recurring-actions">
                <span class="recurring-amount">${formatCurrency(item.amount)}</span>
                <button class="btn btn-primary btn-recurring-add" title="Agregar este gasto al historial">
                    Agregar
                </button>
                <button class="btn btn-recurring-delete" title="Eliminar">
                    Eliminar
                </button>
            </div>
        </div>
    `).join('');

    container.querySelectorAll('.recurring-item').forEach(row => {
        const id = parseInt(row.dataset.id, 10);
        row.querySelector('.btn-recurring-add').addEventListener('click', () => addRecurringExpense(id));
        row.querySelector('.btn-recurring-delete').addEventListener('click', () => deleteRecurringExpense(id));
    });
}

async function loadRecurring() {
    try {
        const res = await fetch('/api/recurring');
        if (!res.ok) throw new Error('Error en la red');
        const data = await res.json();
        renderRecurring(data);
    } catch (err) {
        console.error('[RECURRING] Error al cargar:', err);
    }
}

async function addRecurringExpense(id) {
    const item = recurringCache.find(i => Number(i.id) === Number(id));
    if (!item) {
        Swal.fire('Error', 'Gasto recurrente no encontrado.', 'error');
        return;
    }

    try {
        await fetch('/api/expense', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                amount: item.amount,
                description: item.description,
                category: item.category,
                payer: item.payer,
                date: new Date().toISOString().split('T')[0]
            })
        });

        await fetch(`/api/recurring/${item.id}`, {
            method: 'DELETE'
        });

        Swal.fire('¡Listo!', `Se agregó "${item.description}" al historial.`, 'success');
        await fetchHistory();
        await loadRecurring();
    } catch (err) {
        console.error('[RECURRING] Error:', err);
        Swal.fire('Error', 'No se pudo agregar el gasto recurrente.', 'error');
    }
}

async function deleteRecurringExpense(id) {
    const result = await Swal.fire({
        title: '¿Eliminar gasto recurrente?',
        text: 'Se eliminará de la lista de recurrentes.',
        icon: 'warning',
        showCancelButton: true,
        confirmButtonText: 'Sí, eliminar',
        cancelButtonText: 'Cancelar'
    });

    if (!result.isConfirmed) return;

    try {
        const res = await fetch(`/api/recurring/${id}`, {
            method: 'DELETE'
        });

        if (!res.ok) throw new Error('Error al eliminar');

        Swal.fire('¡Eliminado!', 'Gasto recurrente eliminado.', 'success');
        await loadRecurring();
    } catch (err) {
        console.error('[RECURRING] Error al eliminar:', err);
        Swal.fire('Error', 'No se pudo eliminar el gasto recurrente.', 'error');
    }
}

document.addEventListener('DOMContentLoaded', () => {
    const recurringForm = document.getElementById('recurring-form');
    if (recurringForm) {
        recurringForm.addEventListener('submit', async (e) => {
            e.preventDefault();

            const description = document.getElementById('recurringDescription').value;
            const amount = document.getElementById('recurringAmount').value;
            const category = document.getElementById('recurringCategory').value;
            const payer = document.getElementById('recurringPayer').value;
            const frequency = document.getElementById('recurringFrequency').value;
            const nextDueDate = document.getElementById('recurringDueDate').value;

            if (!description || !amount || !nextDueDate) {
                Swal.fire('Atención', 'Completa todos los campos obligatorios.', 'warning');
                return;
            }

            try {
                const res = await fetch('/api/recurring', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({
                        description,
                        amount: parseFloat(amount),
                        payer,
                        category,
                        frequency,
                        next_due_date: nextDueDate
                    })
                });

                if (!res.ok) {
                    const error = await res.json().catch(() => ({}));
                    throw new Error(error.error || 'Error en el servidor');
                }

                Swal.fire('¡Listo!', 'Gasto recurrente creado.', 'success');
                recurringForm.reset();
                bootstrap.Modal.getInstance(document.getElementById('recurringModal')).hide();
                await loadRecurring();
            } catch (err) {
                console.error('[RECURRING] Error al crear:', err);
                Swal.fire('Error', err.message || 'No se pudo crear el gasto recurrente.', 'error');
            }
        });
    }
});
