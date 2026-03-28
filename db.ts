import Database from 'better-sqlite3';
import path from 'path';
import fs from 'fs';

const DATA_DIR = path.join(process.cwd(), 'bot_data');
const DB_FILE = path.join(DATA_DIR, 'sendify.db');

// Ensure data directory exists
if (!fs.existsSync(DATA_DIR)) {
  fs.mkdirSync(DATA_DIR, { recursive: true });
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
      error TEXT
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
  db.prepare('DELETE FROM stats').run();
  const config = getConfig();
  if (config) {
    config.emailsSentToday = 0;
    setConfig(config);
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
  db.prepare(`
    INSERT INTO audit_logs (timestamp, phone_number, action_type, nss, curp, message, error)
    VALUES (?, ?, ?, ?, ?, ?, ?)
  `).run(log.timestamp, log.phoneNumber, log.actionType, log.nss, log.curp, log.message, log.error);
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
