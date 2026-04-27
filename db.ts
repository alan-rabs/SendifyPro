import Database from 'better-sqlite3';
import path from 'path';
import fs from 'fs';
// Importar helper centralizado para fecha local de México (no UTC).
// Antes db.ts usaba new Date().toISOString().split('T')[0] que devuelve fecha UTC,
// causando que el reset de stats diarias se hiciera con la fecha equivocada.
import { getLocalDateStr, parseLocalDate } from './timezone.js';

const DATA_DIR = path.join(process.cwd(), 'bot_data');
const DB_FILE = path.join(DATA_DIR, 'sendify.db');

// Ensure data directory exists
if (!fs.existsSync(DATA_DIR)) {
  fs.mkdirSync(DATA_DIR, { recursive: true });
}

// Convierte un timestamp con formato español de México a segundos UNIX.
// Acepta formatos tipo "27/04/2026, 1:18:00 p.m." o "27/04/2026, 13:18:00".
// Devuelve null si no se puede parsear.
//
// Esta función se usa para:
//   1. Migrar registros viejos de audit_logs que no tienen timestamp_unix.
//   2. Calcular timestamp_unix al insertar nuevos registros.
//
// IMPORTANTE: el formato de origen siempre se interpretó como TZ México,
// así que el unix resultante también lo refleja correctamente.
export function parseSpanishTimestampToUnix(ts: string): number | null {
  if (!ts || typeof ts !== 'string') return null;
  try {
    // Separar fecha y hora: "27/04/2026, 1:18:00 p.m." → ["27/04/2026", "1:18:00", "p.m."]
    const parts = ts.split(/[, ]+/).filter(p => p.length > 0);
    if (parts.length < 1) return null;

    const dateParts = parts[0].split('/');
    if (dateParts.length !== 3) return null;
    const day = parseInt(dateParts[0], 10);
    const month = parseInt(dateParts[1], 10);
    const year = parseInt(dateParts[2], 10);
    if (isNaN(day) || isNaN(month) || isNaN(year)) return null;

    let hour = 0, minute = 0, second = 0;
    if (parts[1]) {
      const timeBits = parts[1].split(':');
      hour = parseInt(timeBits[0], 10) || 0;
      minute = parseInt(timeBits[1], 10) || 0;
      second = parseInt(timeBits[2], 10) || 0;

      // Manejo AM/PM si existe parts[2]
      if (parts[2]) {
        const ampm = parts[2].toLowerCase();
        const isPM = ampm.includes('p');
        const isAM = ampm.includes('a');
        if (isPM && hour < 12) hour += 12;
        if (isAM && hour === 12) hour = 0;
      }
    }

    // Construir como medianoche local + offset horario, usando parseLocalDate
    // que ya garantiza la TZ correcta sin depender del SO.
    const dayStr = `${year}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
    const dayStart = parseLocalDate(dayStr);
    if (!dayStart) return null;
    const totalSeconds = hour * 3600 + minute * 60 + second;
    return Math.floor(dayStart.getTime() / 1000) + totalSeconds;
  } catch (e) {
    return null;
  }
}

let db: any;
try {
  db = new Database(DB_FILE);
  // Initialize tables
  db.exec(`
    CREATE TABLE IF NOT EXISTS config (
      key TEXT PRIMARY KEY,
      value TEXT
    );
    -- ... other tables ...
  `);
} catch (e) {
  console.error("CRITICAL: Failed to initialize SQLite database. Using memory fallback.", e);
  db = new Database(':memory:');
}

// Initialize tables (re-run in case of memory fallback or partial failure)
try {
  db.exec(`
    CREATE TABLE IF NOT EXISTS config (
      key TEXT PRIMARY KEY,
      value TEXT
    );
    CREATE TABLE IF NOT EXISTS stats (
      key TEXT PRIMARY KEY,
      value INTEGER DEFAULT 0
    );
    CREATE TABLE IF NOT EXISTS processed_messages (
      id TEXT PRIMARY KEY,
      timestamp DATETIME DEFAULT CURRENT_TIMESTAMP
    );
    CREATE TABLE IF NOT EXISTS processed_pdfs (
      hash TEXT PRIMARY KEY,
      timestamp DATETIME DEFAULT CURRENT_TIMESTAMP
    );
    CREATE TABLE IF NOT EXISTS processed_text_signatures (
      signature TEXT PRIMARY KEY,
      timestamp DATETIME DEFAULT CURRENT_TIMESTAMP
    );
    CREATE TABLE IF NOT EXISTS audit_logs (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      timestamp TEXT,
      phone_number TEXT,
      action_type TEXT,
      nss TEXT,
      curp TEXT,
      message TEXT,
      error TEXT,
      message_id TEXT,
      execution_type TEXT DEFAULT 'Tiempo real'
    );
    CREATE TABLE IF NOT EXISTS metadata (
      key TEXT PRIMARY KEY,
      value TEXT
    );
    CREATE INDEX IF NOT EXISTS idx_audit_timestamp ON audit_logs(timestamp);
    CREATE INDEX IF NOT EXISTS idx_audit_phone ON audit_logs(phone_number);
    CREATE TABLE IF NOT EXISTS email_queue (
      id TEXT PRIMARY KEY,
      timestamp INTEGER,
      case_type TEXT,
      subject TEXT,
      body TEXT,
      target_to TEXT,
      cc TEXT,
      bcc TEXT,
      attachment_filename TEXT,
      attachment_path TEXT
    );
  `);
  
  // Add cc column to email_queue if it doesn't exist
  try {
    db.exec(`ALTER TABLE email_queue ADD COLUMN cc TEXT;`);
  } catch (e) {
    // Column already exists
  }
  try {
    db.exec(`ALTER TABLE audit_logs ADD COLUMN message_id TEXT;`);
  } catch (e) {
    // Column already exists
  }
  try {
    db.exec(`ALTER TABLE audit_logs ADD COLUMN execution_type TEXT DEFAULT 'Tiempo real';`);
  } catch (e) {
    // Column already exists
  }
  try {
    db.exec(`ALTER TABLE audit_logs ADD COLUMN processing_timestamp TEXT;`);
  } catch (e) {
    // Column already exists
  }

  // FASE 1: Nueva columna timestamp_unix (INTEGER, segundos UNIX) para
  // permitir filtrado eficiente en SQL por rangos de fecha. La columna
  // 'timestamp' guarda strings tipo "27/04/2026, 13:18:00 p.m." que SQLite
  // no puede comparar cronológicamente. Mantenemos ambas para compatibilidad
  // visual (el frontend muestra el string formateado tal cual).
  try {
    db.exec(`ALTER TABLE audit_logs ADD COLUMN timestamp_unix INTEGER;`);
  } catch (e) {
    // Column already exists
  }

  // Back-fill de timestamp_unix para registros viejos que no la tienen.
  // Parsea el string "DD/MM/YYYY, HH:MM:SS [a.m./p.m.]" y calcula el unix.
  // Esto corre una sola vez por instalación; en sucesivos arranques los
  // registros nuevos ya vienen con timestamp_unix poblado desde addAuditLog.
  try {
    const oldRows = db.prepare(`
      SELECT id, timestamp FROM audit_logs
      WHERE timestamp_unix IS NULL OR timestamp_unix = 0
    `).all() as any[];

    if (oldRows.length > 0) {
      console.log(`[Migration] Calculando timestamp_unix para ${oldRows.length} registros existentes...`);
      const updateStmt = db.prepare(`UPDATE audit_logs SET timestamp_unix = ? WHERE id = ?`);
      const tx = db.transaction((rows: any[]) => {
        for (const row of rows) {
          const unix = parseSpanishTimestampToUnix(row.timestamp);
          if (unix !== null) {
            updateStmt.run(unix, row.id);
          }
        }
      });
      tx(oldRows);
      console.log(`[Migration] Back-fill de timestamp_unix completado.`);
    }
  } catch (e) {
    console.error('[Migration] Error en back-fill de timestamp_unix:', e);
  }

  // Índice para acelerar filtros por rango de fecha
  try {
    db.exec(`CREATE INDEX IF NOT EXISTS idx_audit_timestamp_unix ON audit_logs(timestamp_unix);`);
  } catch (e) {}
} catch (e) {
  console.error("Error initializing tables:", e);
}

// Migration logic
export function migrateData() {
  const CONFIG_FILE = path.join(DATA_DIR, 'config.json');
  const HISTORY_FILE = path.join(DATA_DIR, 'history.json');
  const QUEUE_FILE = path.join(DATA_DIR, 'email_queue.json');

  // Migrate Config
  if (fs.existsSync(CONFIG_FILE)) {
    try {
      const config = JSON.parse(fs.readFileSync(CONFIG_FILE, 'utf-8'));
      const stmt = db.prepare('INSERT OR REPLACE INTO config (key, value) VALUES (?, ?)');
      stmt.run('main_config', JSON.stringify(config));
      // Rename old file to avoid re-migration
      fs.renameSync(CONFIG_FILE, CONFIG_FILE + '.bak');
      console.log('Config migrated to SQLite');
    } catch (e) {
      console.error('Error migrating config:', e);
    }
  }

  // Migrate History & Stats
  if (fs.existsSync(HISTORY_FILE)) {
    try {
      const history = JSON.parse(fs.readFileSync(HISTORY_FILE, 'utf-8'));
      
      // Stats
      if (history.stats) {
        const stmt = db.prepare('INSERT OR REPLACE INTO stats (key, value) VALUES (?, ?)');
        stmt.run('processedPdfs', history.stats.processedPdfs || 0);
        stmt.run('emailsSent', history.stats.emailsSent || 0);
        stmt.run('errorsDetected', history.stats.errorsDetected || 0);
      }

      // Processed IDs
      if (Array.isArray(history.processedMessageIds)) {
        const stmt = db.prepare('INSERT OR IGNORE INTO processed_messages (id) VALUES (?)');
        history.processedMessageIds.forEach((id: string) => stmt.run(id));
      }

      if (Array.isArray(history.processedPdfHashes)) {
        const stmt = db.prepare('INSERT OR IGNORE INTO processed_pdfs (hash) VALUES (?)');
        history.processedPdfHashes.forEach((hash: string) => stmt.run(hash));
      }

      if (Array.isArray(history.processedTextSignatures)) {
        const stmt = db.prepare('INSERT OR IGNORE INTO processed_text_signatures (signature) VALUES (?)');
        history.processedTextSignatures.forEach((sig: string) => stmt.run(sig));
      }

      fs.renameSync(HISTORY_FILE, HISTORY_FILE + '.bak');
      console.log('History migrated to SQLite');
    } catch (e) {
      console.error('Error migrating history:', e);
    }
  }

  // Migrate Email Queue
  if (fs.existsSync(QUEUE_FILE)) {
    try {
      const queue = JSON.parse(fs.readFileSync(QUEUE_FILE, 'utf-8'));
      const stmt = db.prepare(`
        INSERT OR REPLACE INTO email_queue 
        (id, timestamp, case_type, subject, body, target_to, bcc, attachment_filename, attachment_path) 
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
      `);
      queue.forEach((item: any) => {
        stmt.run(
          item.id,
          item.timestamp,
          item.caseType,
          item.subject,
          item.body,
          item.to,
          item.bcc,
          item.attachment?.filename || null,
          item.attachment?.path || null
        );
      });
      fs.renameSync(QUEUE_FILE, QUEUE_FILE + '.bak');
      console.log('Email queue migrated to SQLite');
    } catch (e) {
      console.error('Error migrating email queue:', e);
    }
  }

  // Migrate Audit CSVs
  const files = fs.readdirSync(DATA_DIR).filter(f => f.startsWith('audit_') && f.endsWith('.csv'));
  for (const file of files) {
    try {
      const content = fs.readFileSync(path.join(DATA_DIR, file), 'utf-8');
      const lines = content.split('\n').slice(1); // Skip header
      const stmt = db.prepare(`
        INSERT INTO audit_logs (timestamp, phone_number, action_type, nss, curp, message, error)
        VALUES (?, ?, ?, ?, ?, ?, ?)
      `);
      
      lines.forEach(line => {
        if (!line.trim()) return;
        // Simple CSV parser for this specific format
        const parts = line.match(/(".*?"|[^,]+)(?=\s*,|\s*$)/g);
        if (parts && parts.length >= 7) {
          const clean = (s: string) => s.replace(/^"|"$/g, '').replace(/""/g, '"');
          stmt.run(
            clean(parts[0]),
            clean(parts[1]),
            clean(parts[2]),
            clean(parts[3]),
            clean(parts[4]),
            clean(parts[5]),
            clean(parts[6])
          );
        }
      });
      fs.renameSync(path.join(DATA_DIR, file), path.join(DATA_DIR, file + '.bak'));
      console.log(`Audit file ${file} migrated to SQLite`);
    } catch (e) {
      console.error(`Error migrating audit file ${file}:`, e);
    }
  }
}

// Config Helpers
export function getConfig() {
  try {
    const row = db.prepare('SELECT value FROM config WHERE key = ?').get('main_config') as any;
    return row ? JSON.parse(row.value) : null;
  } catch (e) {
    console.error("Error getting config from DB:", e);
    return null;
  }
}

export function setConfig(config: any) {
  try {
    db.prepare('INSERT OR REPLACE INTO config (key, value) VALUES (?, ?)').run('main_config', JSON.stringify(config));
  } catch (e) {
    console.error("Error setting config in DB:", e);
  }
}

// Stats Helpers
export function getStats() {
  if (!db) {
    console.error("db is not initialized");
    throw new Error("Database not initialized");
  }
  try {
    const rows = db.prepare('SELECT key, value FROM stats').all() as any[];
    const stats: any = { processedPdfs: 0, emailsSent: 0, errorsDetected: 0 };
    rows.forEach(row => {
      stats[row.key] = row.value;
    });
    
    // Add last processed file to stats
    const lastFile = db.prepare('SELECT value FROM metadata WHERE key = ?').get('last_processed_file') as any;
    stats.lastProcessedFile = lastFile ? lastFile.value : 'Ninguno';
    
    const recentFiles = db.prepare('SELECT value FROM metadata WHERE key = ?').get('recent_processed_files') as any;
    try {
      stats.recentFiles = recentFiles ? JSON.parse(recentFiles.value) : [];
    } catch (e) {
      stats.recentFiles = [];
    }
    
    const lastError = db.prepare('SELECT value FROM metadata WHERE key = ?').get('last_email_error') as any;
    stats.lastEmailError = lastError ? lastError.value : '';
    
    const recentEmails = db.prepare('SELECT value FROM metadata WHERE key = ?').get('recent_emails') as any;
    try {
      stats.recentEmails = recentEmails ? JSON.parse(recentEmails.value) : [];
    } catch (e) {
      stats.recentEmails = [];
    }
    
    const recentErrors = db.prepare('SELECT value FROM metadata WHERE key = ?').get('recent_errors') as any;
    try {
      stats.recentEvents = recentErrors ? JSON.parse(recentErrors.value) : [];
    } catch (e) {
      stats.recentEvents = [];
    }
    
    stats.emailQueue = getEmailQueue();
    
    return stats;
  } catch (e) {
    console.error("Error in db.getStats:", e);
    throw e;
  }
}

export function addRecentError(errorData: any) {
  try {
    const row = db.prepare('SELECT value FROM metadata WHERE key = ?').get('recent_errors') as any;
    let recent = [];
    if (row && row.value) {
      recent = JSON.parse(row.value);
    }
    recent.unshift(errorData);
    if (recent.length > 5) recent = recent.slice(0, 5);
    setMetadata('recent_errors', JSON.stringify(recent));
  } catch (e) {
    console.error("Error adding recent error:", e);
  }
}

export function addRecentEmail(emailData: any) {
  try {
    const row = db.prepare('SELECT value FROM metadata WHERE key = ?').get('recent_emails') as any;
    let recent = [];
    if (row && row.value) {
      recent = JSON.parse(row.value);
    }
    recent.unshift(emailData);
    if (recent.length > 5) recent = recent.slice(0, 5);
    setMetadata('recent_emails', JSON.stringify(recent));
  } catch (e) {
    console.error("Error adding recent email:", e);
  }
}

export function incrementStat(key: string) {
  db.prepare('INSERT OR REPLACE INTO stats (key, value) VALUES (?, COALESCE((SELECT value FROM stats WHERE key = ?), 0) + 1)').run(key, key);
}

export function incrementEmailSentToday() {
  try {
    const config = getConfig();
    if (config) {
      config.emailsSentToday = (config.emailsSentToday || 0) + 1;
      setConfig(config);
    }
  } catch (e) {
    console.error("Error incrementing emailsSentToday:", e);
  }
}

// Processed IDs Helpers
export function isMessageProcessed(id: string) {
  return !!db.prepare('SELECT 1 FROM processed_messages WHERE id = ?').get(id);
}

export function markMessageProcessed(id: string) {
  db.prepare('INSERT OR IGNORE INTO processed_messages (id) VALUES (?)').run(id);
}

export function resetDailyStats() {
  // We should NOT delete all stats (processedPdfs, emailsSent, errorsDetected)
  // Those are lifetime stats. We only need to reset the daily counter in config.
  const config = getConfig();
  if (config) {
    config.emailsSentToday = 0;
    // FIX TZ: fecha de hoy en México (no UTC). Antes usaba toISOString().split('T')[0].
    config.lastEmailDate = getLocalDateStr();
    setConfig(config);
  }
}

export function resetAllMetrics() {
  try {
    // Reset stats to 0
    db.prepare("UPDATE stats SET value = 0 WHERE key IN ('processedPdfs', 'emailsSent', 'errorsDetected')").run();
    // Clear recent errors (stored in metadata)
    db.prepare("DELETE FROM metadata WHERE key = 'recent_errors'").run();
    // Clear email queue
    db.prepare("DELETE FROM email_queue").run();
    // Clear last processed file metadata
    db.prepare("DELETE FROM metadata WHERE key = 'last_processed_file'").run();
  } catch (e) {
    console.error("Error in resetAllMetrics:", e);
    throw e;
  }
}

export function clearProcessedMessagesCache() {
  db.prepare('DELETE FROM processed_messages').run();
  db.prepare('DELETE FROM processed_pdfs').run();
  db.prepare('DELETE FROM processed_text_signatures').run();
  db.prepare('DELETE FROM stats').run();
  db.prepare('DELETE FROM metadata WHERE key = ?').run('last_processed_file');
  db.prepare('DELETE FROM metadata WHERE key = ?').run('recent_processed_files');
  
  // Reset emailsSentToday in config
  const config = getConfig();
  if (config) {
    config.emailsSentToday = 0;
    setConfig(config);
  }
}

export function isPdfProcessed(hash: string) {
  return !!db.prepare('SELECT 1 FROM processed_pdfs WHERE hash = ?').get(hash);
}

export function markPdfProcessed(hash: string) {
  db.prepare('INSERT OR IGNORE INTO processed_pdfs (hash) VALUES (?)').run(hash);
}

export function isTextSignatureProcessed(sig: string) {
  return !!db.prepare('SELECT 1 FROM processed_text_signatures WHERE signature = ?').get(sig);
}

export function markTextSignatureProcessed(sig: string) {
  db.prepare('INSERT OR IGNORE INTO processed_text_signatures (signature) VALUES (?)').run(sig);
}

// Audit Logs Helpers
export function addAuditLog(log: any) {
  // FASE 1: calcular timestamp_unix al insertar para que las consultas por
  // rango de fecha sean eficientes (índice SQL) sin tener que parsear strings
  // en JavaScript en cada query.
  const tsUnix = parseSpanishTimestampToUnix(log.timestamp);

  db.prepare(`
    INSERT INTO audit_logs (timestamp, phone_number, action_type, nss, curp, message, error, message_id, execution_type, processing_timestamp, timestamp_unix)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).run(
    log.timestamp,
    log.phoneNumber,
    log.actionType,
    log.nss,
    log.curp,
    log.message,
    log.error,
    log.message_id || null,
    log.execution_type || 'Tiempo real',
    log.processing_timestamp || null,
    tsUnix
  );
}

export function getErrorLogs(limit = 10) {
  try {
    return db.prepare("SELECT * FROM audit_logs WHERE error != '' AND error IS NOT NULL ORDER BY id DESC LIMIT ?").all(limit);
  } catch (e) {
    console.error("Error in getErrorLogs:", e);
    return [];
  }
}

export function getAuditLogs(limit = 1000) {
  try {
    return db.prepare('SELECT * FROM audit_logs ORDER BY id DESC LIMIT ?').all(limit);
  } catch (e) {
    console.error("Error in getAuditLogs:", e);
    return [];
  }
}

// FASE 1: filtrado por rango de fechas EN SQL (no en memoria).
// Antes el código cargaba los últimos 10,000 logs y filtraba en JS, lo que
// significaba que si tenías más de 10k logs, los registros más antiguos
// jamás aparecían en el filtro aunque cayeran en el rango solicitado.
//
// startUnix, endUnix son timestamps UNIX en segundos (ya en TZ correcta).
// Si limit=0 no aplica límite (devuelve todos los del rango).
export function getAuditLogsByDateRange(startUnix: number, endUnix: number, limit = 0): any[] {
  try {
    let sql = `
      SELECT * FROM audit_logs
      WHERE timestamp_unix >= ? AND timestamp_unix <= ?
      ORDER BY id DESC
    `;
    const params: any[] = [startUnix, endUnix];

    if (limit > 0) {
      sql += ` LIMIT ?`;
      params.push(limit);
    }

    return db.prepare(sql).all(...params);
  } catch (e) {
    console.error("Error in getAuditLogsByDateRange:", e);
    return [];
  }
}

export function clearAuditLogs() {
  try {
    db.prepare('DELETE FROM audit_logs').run();
  } catch (e) {
    console.error("Error in clearAuditLogs:", e);
    throw e;
  }
}

// Email Queue Helpers
export function getEmailQueue() {
  try {
    const rows = db.prepare('SELECT * FROM email_queue').all() as any[];
    return rows.map(row => ({
      id: row.id,
      timestamp: row.timestamp,
      caseType: row.case_type,
      subject: row.subject,
      body: row.body,
      to: row.target_to,
      cc: row.cc,
      bcc: row.bcc,
      attachment: row.attachment_path ? { filename: row.attachment_filename, path: row.attachment_path } : null
    }));
  } catch (e) {
    console.error("Error in getEmailQueue:", e);
    return [];
  }
}

export function addToEmailQueue(item: any) {
  db.prepare(`
    INSERT OR REPLACE INTO email_queue 
    (id, timestamp, case_type, subject, body, target_to, cc, bcc, attachment_filename, attachment_path) 
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).run(
    item.id,
    item.timestamp,
    item.caseType,
    item.subject,
    item.body,
    item.to,
    item.cc,
    item.bcc,
    item.attachment?.filename || null,
    item.attachment?.path || null
  );
}

export function clearEmailQueue() {
  db.prepare('DELETE FROM email_queue').run();
}

export function removeFromEmailQueue(id: string) {
  db.prepare('DELETE FROM email_queue WHERE id = ?').run(id);
}

export function setMetadata(key: string, value: string) {
  try {
    db.prepare('INSERT OR REPLACE INTO metadata (key, value) VALUES (?, ?)').run(key, value);
  } catch (e) {
    console.error(`Error setting metadata ${key}:`, e);
  }
}

export function getMetadata(key: string) {
  try {
    const row = db.prepare('SELECT value FROM metadata WHERE key = ?').get(key) as any;
    return row ? row.value : null;
  } catch (e) {
    console.error(`Error getting metadata ${key}:`, e);
    return null;
  }
}

// Cerrar la base de datos correctamente. Llamar al apagar la app para
// que SQLite haga flush de WAL y libere el lock del archivo. Sin esto, en
// reinicios rápidos la siguiente instancia podía encontrar el .db bloqueado.
export function closeDatabase(): void {
  try {
    if (db && typeof db.close === 'function' && db.open) {
      db.close();
      console.log('[DB] Base de datos cerrada correctamente.');
    }
  } catch (e) {
    console.error('[DB] Error al cerrar base de datos:', e);
  }
}
