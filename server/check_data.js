const db = require('./database');

db.all('SELECT * FROM expenses', (err, rows) => {
    if (err) {
        console.error("Error al consultar la base de datos:", err);
    } else {
        console.log(`Total de registros encontrados: ${rows.length}`);
        console.log(rows);
    }
});