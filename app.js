
const themeKey = 'seg_theme';
const defaultTheme = 'github';

if (localStorage.getItem(themeKey)) {
    document.documentElement.setAttribute('data-theme', localStorage.getItem(themeKey));
}

function changeTheme(theme) {
    document.documentElement.setAttribute('data-theme', theme);
    localStorage.setItem(themeKey, theme);
}

// --- RELOJ Y FECHA ---
function updateClock() {
    try {
        const now = new Date();
        const hours = String(now.getHours()).padStart(2, '0');
        const minutes = String(now.getMinutes()).padStart(2, '0');
        const seconds = String(now.getSeconds()).padStart(2, '0');
        const clockEl = document.getElementById('clockDisplay');
        if (clockEl) clockEl.textContent = `${hours}:${minutes}:${seconds}`;

        const options = {
            weekday: 'long',
            year: 'numeric',
            month: 'long',
            day: 'numeric'
        };
        const dateEl = document.getElementById('dateDisplay');
        if (dateEl) dateEl.textContent = now.toLocaleDateString('es-ES', options);
    } catch (e) {
        console.error("Error en reloj:", e);
    }
}

// --- CLIMA ---
function get_weather(latitude, longitude) {
    const url = `https://api.open-meteo.com/v1/forecast?latitude=${latitude}&longitude=${longitude}&current_weather=true&temperature_unit=celsius&wind_unit=ms&precipitation_unit=mm&timezone=auto&forecast_days=1`;

    fetch(url)
        .then(response => response.json())
        .then(data => {
            let city = "Montevideo";
            const temperature = Math.round(data.current_weather.temperature);
            const description = data.current_weather.description;

            document.getElementById('city').textContent = city;
            document.getElementById('temperature').textContent = temperature + 'C';
            document.getElementById('description').textContent = description;
        })
        .catch(error => {
            console.error('Error en clima:', error);
        });
}

// --- GASTOS Y LISTA (HISTORIAL) ---
async function submitExpense(amount, description) {
    const parsedAmount = parseFloat(amount);
    if (isNaN(parsedAmount) || parsedAmount <= 0) {
        alert("El monto debe ser un número válido mayor a cero.");
        return;
    }

    if (!description || description.trim() === "") {
        alert("La descripción no puede estar vacía.");
        return;
    }

    try {
        const response = await fetch('http://localhost:3000/api/expense', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                amount: parsedAmount,
                description: description,
                payer: document.getElementById('expensePayer').value,
                date: new Date().toISOString().split('T')[0]
            })
        });

        if (response.ok) {
            alert('Gasto registrado con éxito');
            fetchHistory();
        } else {
            console.error('Error en el servidor:', response.statusText);
            alert('Error en el servidor al guardar el gasto.');
        }
    } catch (err) {
        console.error('Error de conexión:', err);
        alert('No se pudo conectar con el servidor local.');
    }
}

let categoryChartInstance = null;

function updateChart(data) {
    const ctx = document.getElementById('categoryChart').getContext('2d');
    const processedData = processCategoryData(data);

    if (categoryChartInstance) {
        categoryChartInstance.destroy();
    }

    categoryChartInstance = new Chart(ctx, {
        type: 'doughnut',
        data: {
            labels: processedData.labels,
            datasets: [{
                data: processedData.values,
                backgroundColor: [
                    '#ff6384', '#36a2bd', '#ffcd56', '#c95b82', '#9966ff'
                ],
                borderWidth: 1
            }]
        },
        options: {
            responsive: true,
            plugins: {
                legend: {
                    position: 'bottom',
                }
            }
        }
    });
}
function processCategoryData(data) {
    const categoryTotals = {};
    data.forEach(item => {
        const cat = item.category || 'Otros';
        categoryTotals[cat] = (categoryTotals[cat] || 0) + parseFloat(item.amount || 0);
    });

    const defaultCategories = ['Alimentación', 'Transporte', 'Ocio', 'Servicios', 'Otros'];
    const labels = [];
    const values = [];

    defaultCategories.forEach(cat => {
        labels.push(cat);
        values.push(categoryTotals[cat] || 0);
    });

    return {
        labels,
        values
    };
}

function fetchHistory() {
    const listElement = document.getElementById('history-body');
    fetch('http://localhost:3000/api/expenses')
        .then(response => {
            if (!response.ok) throw new Error('Error en la red: ' + response.status);
            return response.json();
        })
        .then(data => {
            console.log("Datos recibidos:", data);
            if (!Array.isArray(data.expenses) || data.expenses.length === 0) {
                listElement.innerHTML = '<tr style="padding: 20px; text-align: center;">No hay gastos registrados.</tr>';
            } else {
                listElement.innerHTML = data.expenses.map(function(item) {
                    var payerName = item.payer === 'me' ? 'Tin' : (item.payer === 'partner' ? 'Noe' : item.payer);
                    var row = '<tr style="border-bottom: 1px solid var(--border-color);">';
                    row += '<td style="padding: 10px; text-align: left;">' + (item.date || 'Sin fecha') + '</td>';
                    row += '<td style="padding: 10px; text-align: left;">' + (item.description || 'Sin descripción') + '</td>';
                    row += '<td style="padding: 10px; text-align: left;">' + (item.category || 'Sin categoría') + '</td>';
                    row += '<td style="padding: 10px; text-align: center;">$' + item.amount + '</td>';
                    row += '<td style="padding: 10px; text-align: left;">' + payerName + '</td>';
                    row += '</tr>';
                    return row;
                }).join('');
                updateChart(data.expenses);
                if (document.getElementById('debt-status')) {
                    document.getElementById('debt-status').innerText = 'Saldo: ' + data.summary.status + ' $' + data.summary.balance;
                }
            }
        })
        .catch(error => {
            console.error('Error en fetchHistory:', error);
            listElement.innerHTML = '<tr style="padding: 20px; text-align: center; color: var(--text-danger);">Error al cargar historial.</tr>';
        });
}

// --- DRAG & DROP (SORTABLE) ---
function initDragAndDrop() {
    const container = document.querySelector('.dashboard');
    if (!container) {
        console.error("Error: No se encontró el contenedor .dashboard");
        return;
    }

    if (typeof Sortable !== 'undefined') {
        Sortable.create(container, {
            animation: 150,
            ghostClass: 'sortable-ghost',
            onEnd: function() {
                const order = Array.from(container.children).map(el => el.id);
                localStorage.setItem('dashboard_order', JSON.stringify(order));
                console.log("Nuevo orden guardado:", order);
            }
        });
        console.log("Sortable inicializado correctamente");
    } else {
        console.error("Error: Sortable no está definido. Revisa si la librería se cargó correctamente.");
    }
}

function loadLayout() {
    const container = document.querySelector('.dashboard');
    const savedOrder = JSON.parse(localStorage.getItem('dashboard_order'));
    if (savedOrder && savedOrder.length > 0) {
        const items = Array.from(container.children);
        const newOrder = [];
        const seenIds = new Set();

        savedOrder.forEach(id => {
            const item = items.find(el => el.id === id);
            if (item) {
                newOrder.push(item);
                seenIds.add(id);
            }
        });

        items.forEach(item => {
            if (!seenIds.has(item.id)) newOrder.push(item);
        });

        newOrder.forEach(item => container.appendChild(item));
    }
}

// --- INICIALIZACIÓN ---
document.addEventListener('DOMContentLoaded', () => {
    fetchHistory();
    updateClock();
    setInterval(updateClock, 1000);
    loadLayout();
    initDragAndDrop();
});

window.changeTheme = changeTheme;
window.submitExpense = submitExpense;
window.update_clock = updateClock;
window.get_weather = get_weather;