const sqlite3 = require('sqlite3');
const db = new sqlite3.Database('./database.sqlite');

db.serialize(() => {
    db.run("ALTER TABLE expenses ADD COLUMN category TEXT", (err) => {
        if (err) {
            console.error("Error adding column:", err.message);
        } else {
            console.log("Success: Column 'category' added or already exists.");
        }
    });
});

db.close();
