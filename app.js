const themeKey = 'seg_theme';
const defaultTheme = 'github';
let categoryChartInstance = null;
let allExpenses = [];
let isSubmittingExpense = false;
let historyFilters = {
    search: '',
    category: '',
    payer: ''
};

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
        const response = await fetch('http://localhost:3000/api/expense', {
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
        historyBody.innerHTML = '<tr><td colspan="5" class="empty-state">No hay gastos que coincidan con esos filtros.</td></tr>';
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
        const response = await fetch('http://localhost:3000/api/expenses');
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
        historyBody.innerHTML = '<tr><td colspan="5" class="text-center text-danger py-4">Error al cargar historial.</td></tr>';
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

        return matchesSearch && matchesCategory && matchesPayer;
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

function hydrateHistoryFilterOptions() {
    const categoryFilter = document.getElementById('category-filter');
    if (!categoryFilter) return;

    const categories = Array.from(new Set(allExpenses.map(item => categoryName(item.category)))).sort();
    const selectedCategory = categoryFilter.value;

    categoryFilter.innerHTML = '<option value="">Todas las categorías</option>' + categories.map(category => {
        return `<option value="${escapeHtml(category)}">${escapeHtml(category)}</option>`;
    }).join('');

    categoryFilter.value = categories.includes(selectedCategory) ? selectedCategory : '';
    historyFilters.category = categoryFilter.value;
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

    fetchHistory();
});

window.changeTheme = changeTheme;
window.submitExpense = submitExpense;
