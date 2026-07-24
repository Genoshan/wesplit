const express = require('express');
const bodyParser = require('body-parser');
const cors = require('cors');
const path = require('path');
const db = require('./database');

const app = express();
const PORT = process.env.PORT || 4000;

// Middleware
app.use(cors());
app.use( bodyParser.json());
app.use( bodyParser.urlencoded({ extended: true }));

// Servir archivos estáticos desde la raíz (donde están index.html, style.css, app.js)
app.use(express.static(path.join(__dirname, '..')));

app.get('/', (req, res) => {
    res.sendFile(path.join(__dirname, '../index.html'));
});

app.get('/api/expenses', (req, res) => {
    db.all('SELECT * FROM expenses ORDER BY date DESC', [], (err, rows) => {
        if (err) {
            console.error(`[ERROR_QUERY] Fallo al obtener gastos: ${err}`);
            res.status(500).json({ error: 'Error interno en la base de datos' });
        } else {
            let totalMe = 0;
            let totalPartner = 0;
            rows.forEach(row => {
                if (row.payer === 'me') totalMe += row.amount;
                else if (row.payer === 'partner') totalPartner += row.amount;
            });
            const difference = totalMe - totalPartner;
            // If balance is positive, the partner owes me (difference / 2)
            // Since it's a two-person app, we calculate how much one person must pay the other to equalize.
            
            res.json({
                expenses: rows,
                summary: {
                    totalMe: totalMe,
                    totalPartner: totalPartner,
                    balance: difference > 0 ? (difference / 2).toFixed(2) : (Math.abs(difference) / 2).toFixed(2),
                    status: difference > 0 ? "Te deben" : "Le debes"
                }
            });
        }
    });
});

// Ruta para añadir un nuevo gasto
app.post('/api/expense', (req, res) => {
    const { date, description, amount, payer, category } = req.body;
    const cleanDescription = description ? description.trim() : '';
    const parsedAmount = parseFloat(amount);

    if (isNaN(parsedAmount) || parsedAmount <= 0) {
        console.warn(`[VALIDACIÓN] Intento de ingreso con monto inválido: ${amount}`);
        return res.status(400).json({ error: 'El monto debe ser un número positivo' });
    }

    const query = `INSERT INTO expenses (date, description, amount, payer, category) VALUES (?, ?, ?, ?, ?)`;
    db.run(query, [date, cleanDescription, parsedAmount, payer, category], function(err) {
        if (err) {
            console.error(`[ERROR_DB] Fallo al insertar en la base de datos: ${err}`);
            res.status(500).json({ error: 'Error interno en la base de datos' });
        } else {
            console.log(`[ÉXITO] Gasto registrado: ${cleanDescription} - $${parsedAmount}`);
            res.json({ id: this.lastID, message: 'Gasto registrado con éxito' });
        }
    });
});

app.listen(PORT, () => {
    console.log(`Servidor corriendo en http://localhost:${PORT}`);
});
