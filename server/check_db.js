const sqlite3 = require('sqlite3');
const db = new sqlite3.Database('H:\\Samsung 850 EVO - SSD\\Reloj\\server\\database.sqlite');

db.serialize(() => {
    // Asegurarse de que la tabla existe
    db.run(`CREATE TABLE IF NOT EXISTS expenses (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        date TEXT,
        description TEXT,
        amount REAL,
        payer TEXT
    )`);

    console.log("Consultando base de datos...");
    db.all('SELECT * FROM expenses', (err, rows) => {
        if (err) {
            console.error("Error al consultar la tabla:", err);
        } else {
            console.log("Registros encontrados:");
            console.table(rows);
        }
    });
});

db.close();
