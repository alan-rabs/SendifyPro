import Database from 'better-sqlite3';
import path from 'path';
import fs from 'fs';

const DATA_DIR = path.join(process.cwd(), 'bot_data');
const DB_FILE = path.join(DATA_DIR, 'sendify.db');

if (!fs.existsSync(DB_FILE)) {
  console.error("No se encontró la base de datos en", DB_FILE);
  process.exit(1);
}

const db = new Database(DB_FILE);

console.log("Iniciando migración de archivos de auditoría antiguos...");

const files = fs.readdirSync(DATA_DIR).filter(f => f.startsWith('audit_') && f.endsWith('.csv'));

if (files.length === 0) {
  console.log("No se encontraron archivos de auditoría antiguos (audit_*.csv) en bot_data.");
  process.exit(0);
}

const stmt = db.prepare(`
  INSERT OR IGNORE INTO audit_logs (timestamp, phone_number, action_type, nss, curp, message, error, execution_type)
  VALUES (?, ?, ?, ?, ?, ?, ?, ?)
`);

let totalImported = 0;

for (const file of files) {
  try {
    console.log(`Procesando archivo: ${file}`);
    const content = fs.readFileSync(path.join(DATA_DIR, file), 'utf-8');
    const lines = content.split('\n').slice(1); // Saltar encabezado

    let fileImported = 0;
    lines.forEach(line => {
      if (!line.trim()) return;
      // Simple CSV parser
      const parts = line.match(/(".*?"|[^,]+)(?=\s*,|\s*$)/g);
      if (parts && parts.length >= 7) {
        const clean = (s) => s ? s.replace(/^"|"$/g, '').replace(/""/g, '"') : '';
        stmt.run(
          clean(parts[0]),
          clean(parts[1]),
          clean(parts[2]),
          clean(parts[3]),
          clean(parts[4]),
          clean(parts[5]),
          clean(parts[6]),
          'Tiempo real' // Default para logs antiguos
        );
        fileImported++;
      }
    });
    
    console.log(`Importados ${fileImported} registros de ${file}`);
    totalImported += fileImported;
    
    // Renombrar a .bak para evitar re-importar
    fs.renameSync(path.join(DATA_DIR, file), path.join(DATA_DIR, file + '.bak'));
  } catch (e) {
    console.error(`Error procesando ${file}:`, e);
  }
}

console.log(`Migración finalizada. Total de registros importados: ${totalImported}`);
