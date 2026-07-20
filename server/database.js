const sqlite3 = require('sqlite3').verbose();
const path = require('path');

// Conectar a la base de datos (creará el archivo si no existe)
const dbPath = path.resolve(__dirname, 'database.sqlite');
const db = new sqlite3.Database(dbPath);

// Inicializar la tabla de gastos
db.serialize(() => {
    db.run(`CREATE TABLE IF NOT EXISTS expenses (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        date TEXT NOT NULL,
        description TEXT,
        amount REAL NOT NULL,
        payer TEXT NOT NULL, -- 'me' o 'partner'
        category TEXT
    )`, (err) => {
        if (err) {
            console.error("Error creando la tabla de gastos:", err);
        }
    });
});

module.exports = db;
