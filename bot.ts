import pkg from 'whatsapp-web.js';
const { Client, LocalAuth } = pkg;
import qrcode from 'qrcode';
import nodemailer from 'nodemailer';
import fs from 'fs';
import path from 'path';
import crypto from 'crypto';
import cron from 'node-cron';
import { createRequire } from 'module';
import * as db from './db.js';

const require = createRequire(import.meta.url);
const pdf = require('pdf-parse');

const DATA_DIR = path.join(process.cwd(), 'bot_data');

// Run migration
db.migrateData();

function getLocalDateStr() {
  const formatter = new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Mexico_City', year: 'numeric', month: '2-digit', day: '2-digit' });
  return formatter.format(new Date());
}

function getLocalTimestamp() {
  return new Date().toLocaleString('es-MX', { timeZone: 'America/Mexico_City' });
}

export function logAudit(phoneNumber: string, actionType: string, nss: string, curp: string, message: string = '', error: string = '') {
  if (actionType === 'SUCCESS_TEXT') return; // Ignorar SUCCESS_TEXT en el CSV

  const timestamp = getLocalTimestamp();
  
  db.addAuditLog({
    timestamp,
    phoneNumber,
    actionType,
    nss,
    curp,
    message,
    error
  });
}

// Default configuration
const DEFAULT_CONFIG = {
  emailUser: '',
  emailPass: '',
  smtpServer: 'smtp.gmail.com',
  smtpPort: 465,
  // Audit Actions
  auditActionEmailEnabled: true,
  auditEmailTargets: '',
  auditActionWaEnabled: false,
  auditWaTargets: '',
  
  // Chat configs
  chatConfigs: []
};

let config: any = db.getConfig() || DEFAULT_CONFIG;

// Ensure DB has config if it was empty
if (!db.getConfig()) {
  db.setConfig(config);
}

export function saveConfig(newConfig: any) {
  config = { ...config, ...newConfig };
  db.setConfig(config);
}

export function getConfig() {
  return config;
}

export function getStats() {
  return db.getStats();
}

// Logger
export const logs: { time: string, level: string, message: string }[] = [];
function log(level: string, message: string) {
  const entry = { time: new Date().toISOString(), level, message };
  logs.push(entry);
  if (logs.length > 200) logs.shift(); // Keep last 200 logs
  console.log(`[${level}] ${message}`);
}

let client: any = null;
export let botStatus = 'stopped'; // 'stopped', 'starting', 'awaiting_qr', 'running', 'error'
export let currentQrCode: string | null = null;

export async function startBot() {
  if (client) {
    log('WARN', 'El bot ya está en ejecución o iniciando.');
    return;
  }

  log('INFO', 'Iniciando motor de WhatsApp Web (Modo Invisible)...');
  botStatus = 'starting';
  currentQrCode = null;

  client = new Client({
    authStrategy: new LocalAuth({ dataPath: path.join(DATA_DIR, 'session') }),
    puppeteer: {
      args: ['--no-sandbox', '--disable-setuid-sandbox', '--disable-dev-shm-usage', '--disable-gpu'],
      timeout: 60000,
      protocolTimeout: 300000
    }
  });

  client.on('qr', async (qr: string) => {
    log('INFO', 'Código QR generado. Esperando escaneo...');
    botStatus = 'awaiting_qr';
    try {
      currentQrCode = await qrcode.toDataURL(qr);
    } catch (err) {
      log('ERROR', 'Error generando imagen QR.');
    }
  });

  client.on('ready', async () => {
    log('INFO', '✅ WhatsApp Web conectado y listo.');
    botStatus = 'running';
    currentQrCode = null;
    log('INFO', `Escuchando mensajes de ${config.chatConfigs?.length || 0} chats configurados.`);

    try {
      log('INFO', `Buscando chats para recuperar mensajes pendientes...`);
      const chats = await client.getChats();
      let totalProcessed = 0;

      for (const chatConf of (config.chatConfigs || [])) {
        if (!chatConf || !chatConf.targetContact) continue;
        
        const targetChat = chats.find((c: any) => c.name === chatConf.targetContact || c.name === chatConf.targetContact.trim());

        if (targetChat) {
          log('INFO', `Chat "${chatConf.targetContact}" encontrado. Revisando los últimos 50 mensajes...`);
          const messages = await targetChat.fetchMessages({ limit: 50 });
          
          let processedCount = 0;
          for (const msg of messages) {
            const processed = await processMessage(msg);
            if (processed) processedCount++;
          }
          
          if (processedCount > 0) {
            log('INFO', `✅ Se recuperaron y procesaron ${processedCount} mensajes/archivos pendientes en "${chatConf.targetContact}".`);
            totalProcessed += processedCount;
          }
        } else {
          log('WARN', `No se encontró el chat "${chatConf.targetContact}" en el historial reciente.`);
        }
      }
      
      if (totalProcessed === 0) {
        log('INFO', `No hay mensajes pendientes por procesar en ningún chat.`);
      }
    } catch (err: any) {
      log('ERROR', `Error al revisar historial: ${err.message}`);
    }
  });

  client.on('authenticated', () => {
    log('INFO', 'Autenticación exitosa.');
  });

  client.on('auth_failure', (msg: string) => {
    log('ERROR', `Fallo de autenticación: ${msg}`);
    botStatus = 'error';
  });

  client.on('disconnected', (reason: string) => {
    log('WARN', `WhatsApp desconectado: ${reason}`);
    botStatus = 'stopped';
    client = null;
    
    // Auto-reconnect after 10 seconds
    log('INFO', 'Intentando reconexión automática en 10 segundos...');
    setTimeout(() => {
      if (botStatus === 'stopped') {
        startBot();
      }
    }, 10000);
  });

  client.on('message_create', async (msg: any) => {
    await processMessage(msg);
  });

  try {
    await client.initialize();
  } catch (err: any) {
    log('ERROR', `Error al inicializar el cliente: ${err.message}`);
    botStatus = 'error';
    client = null;
  }
}

async function processMessage(msg: any): Promise<boolean> {
  try {
    const chat = await msg.getChat();
    const chatConfig = config.chatConfigs?.find((c: any) => c && c.targetContact && (chat.name === c.targetContact || chat.name === c.targetContact.trim()));
    
    if (!chatConfig) return false;

    const direction = chatConfig.messageDirection || 'both';
    if (direction === 'received' && msg.fromMe) return false;
    if (direction === 'sent' && !msg.fromMe) return false;

    if (db.isMessageProcessed(msg.id._serialized)) return false;

    log('DEBUG', `Mensaje en "${chat.name}": tipo=${msg.type}, body="${msg.body.substring(0, 50)}${msg.body.length > 50 ? '...' : ''}"`);

    const rules = chatConfig.rules || [];
    if (rules.length === 0) {
      db.markMessageProcessed(msg.id._serialized);
      return false;
    }

    let didProcessSomething = false;
    let media: any = null;
    let textContent = msg.body || '';

    if (msg.hasMedia) {
      media = await msg.downloadMedia();
      if (media && media.mimetype === 'application/pdf') {
        try {
          const pdfBuffer = Buffer.from(media.data, 'base64');
          const pdfData = await pdf(pdfBuffer);
          textContent = pdfData.text;
        } catch (e) {
          log('ERROR', `Error al extraer texto de PDF: ${e instanceof Error ? e.message : String(e)}`);
        }
      }
    }

    // Extract NSS and CURP for placeholders if possible
    const nssMatch = textContent.match(/\b\d{11}\b/);
    const curpMatch = textContent.match(/[A-Z][AEIOUX][A-Z]{2}\d{2}(?:0[1-9]|1[0-2])(?:0[1-9]|[12]\d|3[01])[HM](?:AS|B[CS]|C[CLMSH]|D[FG]|G[TR]|HG|JC|M[CNS]|N[ETL]|OC|PL|Q[TR]|S[PLR]|T[CSL]|VZ|YN|ZS)[B-DF-HJ-NP-TV-Z]{3}[A-Z\d]\d/i);
    const nss = nssMatch ? nssMatch[0] : "NO_ENCONTRADO";
    const curp = curpMatch ? curpMatch[0].toUpperCase() : "NO_ENCONTRADO";

    for (const rule of rules) {
      let isMatch = false;

      if (rule.type === 'text') {
        const text = textContent.trim();
        const trigger = (rule.triggerValue || '').trim();
        
        if (rule.subtype === 'exact') {
          isMatch = text.toLowerCase() === trigger.toLowerCase();
        } else if (rule.subtype === 'contains') {
          isMatch = text.toLowerCase().includes(trigger.toLowerCase());
        } else if (rule.subtype === 'regex') {
          try {
            const re = new RegExp(trigger, 'i');
            isMatch = re.test(text);
          } catch (e) {
            log('ERROR', `Regex inválido en regla "${rule.name}": ${trigger}`);
          }
        }
      } else if (rule.type === 'file') {
        if (msg.hasMedia && media) {
          const mime = media.mimetype.toLowerCase();
          const subtype = rule.subtype;
          const trigger = (rule.triggerValue || '').trim().toLowerCase();

          let typeMatch = false;
          if (subtype === 'pdf') typeMatch = mime.includes('pdf');
          else if (subtype === 'image') typeMatch = mime.includes('image');
          else if (subtype === 'video') typeMatch = mime.includes('video');
          else if (subtype === 'doc') typeMatch = mime.includes('word') || mime.includes('officedocument') || mime.includes('msword');
          else if (subtype === 'any') typeMatch = true;

          if (typeMatch) {
            if (trigger === '') {
              isMatch = true;
            } else {
              // If there's a trigger value, check if it's in the text content (for PDFs) or filename
              const filename = (media.filename || '').toLowerCase();
              isMatch = textContent.toLowerCase().includes(trigger) || filename.includes(trigger);
            }
          }
        }
      }

      if (isMatch) {
        log('INFO', `🎯 Regla disparada: "${rule.name}" en chat "${chat.name}"`);
        
        let emailSent = false;
        let waSent = false;

        // Process Email Action
        if (rule.emailEnabled) {
          const subject = replacePlaceholders(rule.emailSubject || 'Alerta de Regla: {rule_name}', textContent, nss, curp, rule.name);
          const body = replacePlaceholders(rule.emailBody || 'Se ha detectado una coincidencia con la regla {rule_name}.', textContent, nss, curp, rule.name);
          
          const attachment = (msg.hasMedia && media) ? {
            filename: media.filename || `archivo_${Date.now()}.${media.mimetype.split('/')[1] || 'bin'}`,
            content: Buffer.from(media.data, 'base64')
          } : null;

          const sent = await queueOrSendEmail(subject, body, attachment, rule.emailTargets, chatConfig.emailBcc, chatConfig.emailCc, rule.name);
          if (sent) emailSent = true;
        }

        // Process WhatsApp Action
        if (rule.waEnabled) {
          const waMsg = replacePlaceholders(rule.waMessage || 'Regla disparada: {rule_name}', textContent, nss, curp, rule.name);
          const sent = await sendToWhatsAppChats(rule.waTargets, waMsg, (msg.hasMedia && media) ? media : null);
          if (sent) waSent = true;
        }

        if (emailSent || waSent) {
          didProcessSomething = true;
          if (emailSent) db.incrementStat('emailsSent');
          if (rule.type === 'file' && rule.subtype === 'pdf') db.incrementStat('processedPdfs');
          else db.incrementStat('errorsDetected'); // Generic "event detected"

          logAudit(chat.name, rule.name, nss, curp, textContent.substring(0, 200), rule.emailEnabled ? 'Email' : '' + (rule.waEnabled ? ' WA' : ''));
        }

        if (chatConfig.processingMode === 'simple') {
          break; // Stop after first match
        }
      }
    }

    db.markMessageProcessed(msg.id._serialized);
    return didProcessSomething;

  } catch (err: any) {
    log('ERROR', `Error procesando mensaje: ${err.message}`);
    return false;
  }
}

function replacePlaceholders(template: string, originalText: string, nss: string, curp: string, ruleName: string) {
  return template
    .replace(/{original_message}/g, originalText)
    .replace(/{nss}/g, nss)
    .replace(/{curp}/g, curp)
    .replace(/{rule_name}/g, ruleName);
}


export async function stopBot() {
  if (!client) {
    log('WARN', 'El bot ya está detenido.');
    return;
  }
  log('INFO', 'Deteniendo el bot de WhatsApp...');
  try {
    await client.destroy();
    client = null;
    botStatus = 'stopped';
    currentQrCode = null;
    log('INFO', 'Bot detenido correctamente.');
  } catch (err: any) {
    log('ERROR', `Error al detener el bot: ${err.message}`);
  }
}

async function queueOrSendEmail(
  subject: string, 
  text: string, 
  attachment: { filename: string, content: Buffer } | null, 
  customTargets: string | undefined, 
  bcc: string | undefined,
  cc: string | undefined,
  caseType: string
) {
  if (config.emailBatchingEnabled) {
    // Save attachment to disk temporarily if exists
    let attachmentInfo = null;
    if (attachment) {
      const tempDir = path.join(DATA_DIR, 'temp_attachments');
      if (!fs.existsSync(tempDir)) fs.mkdirSync(tempDir, { recursive: true });
      const tempPath = path.join(tempDir, `${Date.now()}_${attachment.filename}`);
      fs.writeFileSync(tempPath, attachment.content);
      attachmentInfo = { filename: attachment.filename, path: tempPath };
    }

    db.addToEmailQueue({
      id: Date.now().toString(),
      timestamp: Date.now(),
      caseType,
      subject,
      body: text,
      to: customTargets || config.emailDestino,
      cc: cc || '',
      bcc: bcc || '',
      attachment: attachmentInfo
    });
    log('INFO', `Correo encolado para agrupación (Caso: ${caseType}).`);
    return true; // Assume success for queueing
  } else {
    // Send immediately
    return await sendEmail(subject, text, attachment ? [attachment] : null, customTargets, bcc, cc);
  }
}

async function processEmailQueue() {
  const emailQueue = db.getEmailQueue();
  if (emailQueue.length === 0) return;
  log('INFO', `Procesando cola de correos (${emailQueue.length} elementos)...`);

  // Group by destination, cc, bcc, and case type
  const groups: Record<string, any[]> = {};
  for (const item of emailQueue) {
    const key = `${item.to}_${item.cc}_${item.bcc}_${item.caseType}`;
    if (!groups[key]) groups[key] = [];
    groups[key].push(item);
  }

  for (const key in groups) {
    const items = groups[key];
    const first = items[0];
    
    const subject = `[Sendify PRO Lote] ${items.length} reportes de ${first.caseType}`;
    let combinedBody = `Se han procesado ${items.length} elementos en este lote:\n\n`;
    const attachments: { filename: string, content: Buffer }[] = [];

    items.forEach((item, index) => {
       combinedBody += `--- Elemento ${index + 1} ---\n`;
       combinedBody += `Asunto original: ${item.subject}\n`;
       combinedBody += `${item.body}\n\n`;
       if (item.attachment && fs.existsSync(item.attachment.path)) {
         attachments.push({
           filename: item.attachment.filename,
           content: fs.readFileSync(item.attachment.path)
         });
       }
    });

    const sent = await sendEmail(subject, combinedBody, attachments.length > 0 ? attachments : null, first.to, first.bcc, first.cc);
    if (sent) {
      log('INFO', `✅ Lote de ${items.length} correos enviado a ${first.to}`);
    } else {
      log('ERROR', `❌ Error enviando lote a ${first.to}`);
    }
  }

  // Clear queue and delete temp files
  emailQueue.forEach(item => {
     if (item.attachment && item.attachment.path && fs.existsSync(item.attachment.path)) {
        try { fs.unlinkSync(item.attachment.path); } catch (e) {}
     }
  });
  db.clearEmailQueue();
}

let lastScheduleRun = '';
setInterval(() => {
  if (!config.emailBatchingEnabled) return;
  
  const now = new Date();
  const timeStr = `${now.getHours().toString().padStart(2, '0')}:${now.getMinutes().toString().padStart(2, '0')}`;
  
  const schedules = config.emailSchedules || [];
  const limit = config.emailBatchLimit || 20;

  let shouldRun = false;
  const queueLength = db.getEmailQueue().length;

  if (queueLength >= limit) {
    log('INFO', `Límite de agrupación alcanzado (${queueLength}/${limit}). Enviando lote...`);
    shouldRun = true;
  } else if (schedules.includes(timeStr) && lastScheduleRun !== timeStr) {
    log('INFO', `Horario de agrupación alcanzado (${timeStr}). Enviando lote...`);
    shouldRun = true;
    lastScheduleRun = timeStr;
  }

  if (shouldRun) {
    processEmailQueue();
  }
}, 30000); // Check every 30 seconds

async function sendEmail(subject: string, text: string, attachments: { filename: string, content: Buffer }[] | null, customTargets?: string, bcc?: string, cc?: string) {
  if (!config.emailUser || !config.emailPass) {
    log('ERROR', 'Faltan credenciales de correo en la configuración.');
    return false;
  }

  // Check email limits
  const today = new Date().toISOString().split('T')[0];
  if (config.lastEmailDate !== today) {
    config.emailsSentToday = 0;
    config.lastEmailDate = today;
    saveConfig(config);
  }

  const limit = config.emailDailyLimit || 100;
  if (config.emailsSentToday >= limit) {
    log('ERROR', `LÍMITE ALCANZADO: Se ha superado el límite de ${limit} correos diarios. El servicio estará disponible nuevamente mañana.`);
    return false;
  }

  const targetString = customTargets || config.emailDestino;
  if (!targetString) {
    log('ERROR', 'No hay destinatarios configurados.');
    return false;
  }

  const targets = targetString.split(',').map(e => e.trim()).filter(e => e);
  if (targets.length === 0) {
    log('ERROR', 'No hay destinatarios válidos.');
    return false;
  }

  try {
    const transporter = nodemailer.createTransport({
      host: config.smtpServer,
      port: config.smtpPort,
      secure: config.smtpPort === 465,
      auth: {
        user: config.emailUser,
        pass: config.emailPass
      }
    });

    const mailOptions: any = {
      from: config.emailUser,
      to: targets.join(', '),
      subject: subject,
      text: text
    };

    if (bcc) {
      const bccTargets = bcc.split(',').map(e => e.trim()).filter(e => e);
      if (bccTargets.length > 0) {
        mailOptions.bcc = bccTargets.join(', ');
      }
    }

    if (cc) {
      const ccTargets = cc.split(',').map(e => e.trim()).filter(e => e);
      if (ccTargets.length > 0) {
        mailOptions.cc = ccTargets.join(', ');
      }
    }

    if (attachments && attachments.length > 0) {
      mailOptions.attachments = attachments.map(att => ({
        filename: att.filename,
        content: att.content
      }));
    }

    await transporter.sendMail(mailOptions);
    
    // Increment counter
    config.emailsSentToday = (config.emailsSentToday || 0) + 1;
    saveConfig(config);
    log('INFO', `Correo enviado exitosamente. (${config.emailsSentToday}/${limit} hoy)`);
    
    return true;
  } catch (err: any) {
    log('ERROR', `Error SMTP: ${err.message}`);
    return false;
  }
}

async function sendToWhatsAppChats(targetNamesStr: string, message: string, media: any = null) {
  if (!client || !targetNamesStr) return false;
  
  const targetNames = targetNamesStr.split(',').map(n => n.trim()).filter(n => n);
  if (targetNames.length === 0) {
    log('ERROR', 'No hay chats destino válidos configurados para reenvío.');
    return false;
  }

  try {
    const chats = await client.getChats();
    let sentCount = 0;
    
    for (const name of targetNames) {
      const chat = chats.find((c: any) => c.name === name || c.name === name.trim());
      if (chat) {
        if (media) {
          await chat.sendMessage(media, { caption: message });
        } else {
          await chat.sendMessage(message);
        }
        sentCount++;
        log('INFO', `Mensaje reenviado a chat: "${name}"`);
      } else {
        log('WARN', `Chat destino no encontrado para reenvío: "${name}"`);
      }
    }
    
    return sentCount > 0;
  } catch (err: any) {
    log('ERROR', `Error al reenviar mensaje por WhatsApp: ${err.message}`);
    return false;
  }
}

// Función para generar un CSV personalizado basado en una plantilla desde SQLite
function generateCustomCsvFromDb(columns: string[]): string | null {
  const logs = db.getAuditLogs(10000); // Get last 10k logs for the report
  if (logs.length === 0) return null;

  const header = columns.join(',');
  const rows = logs.map((log: any) => {
    return columns.map(col => {
      let val = '';
      const colLower = col.toLowerCase();
      
      if (colLower === 'date') val = (log.timestamp || '').split(' ')[0] || '';
      else if (colLower === 'time') val = (log.timestamp || '').split(' ')[1] || '';
      else if (colLower === 'contact') val = log.phone_number || '';
      else if (colLower === 'status') val = log.action_type || '';
      else if (colLower === 'nss') val = log.nss || '';
      else if (colLower === 'curp') val = log.curp || '';
      else if (colLower === 'message') val = log.message || '';
      else if (colLower === 'error') val = log.error || '';
      
      return `"${val.replace(/"/g, '""')}"`;
    }).join(',');
  });

  return header + '\n' + rows.join('\n');
}

// Programar tarea diaria a las 23:59 para enviar el reporte CSV (Global)
cron.schedule('59 23 * * *', async () => {
  log('INFO', 'Iniciando tarea programada: Envío de reporte de auditoría diario (Global)...');
  
  const dateStr = getLocalDateStr();
  const columns = ['date', 'time', 'contact', 'status', 'nss', 'curp', 'message', 'error'];
  const csvContent = generateCustomCsvFromDb(columns);

  if (!csvContent) {
    log('INFO', 'No hay registros de auditoría para hoy. No se enviará reporte global.');
    return;
  }

  try {
    const csvBuffer = Buffer.from(csvContent);
    const subject = `Reporte de Auditoría WhatsApp Bot - ${dateStr}`;
    const text = `Adjunto el reporte de auditoría de los eventos procesados el día de hoy (${dateStr}).`;
    
    if (config.auditActionEmailEnabled && config.auditEmailTargets) {
      await sendEmail(subject, text, [{ filename: `audit_${dateStr}.csv`, content: csvBuffer }], config.auditEmailTargets);
    }
    
    if (config.auditActionWaEnabled && config.auditWaTargets) {
      const { MessageMedia } = pkg;
      const media = new MessageMedia('text/csv', csvBuffer.toString('base64'), `audit_${dateStr}.csv`);
      await sendToWhatsAppChats(config.auditWaTargets, subject, media);
    }
  } catch (err: any) {
    log('ERROR', `Error en reporte diario global: ${err.message}`);
  }
}, {
  timezone: "America/Mexico_City"
});

// Programar tareas para plantillas personalizadas
setInterval(() => {
  const now = new Date();
  const timeStr = `${now.getHours().toString().padStart(2, '0')}:${now.getMinutes().toString().padStart(2, '0')}`;
  
  if (!config.auditTemplates) return;

  const dateStr = getLocalDateStr();

  config.auditTemplates.forEach(async (template: any) => {
    if (template.schedule === timeStr && (global as any).lastAuditRun !== `${template.id}_${dateStr}_${timeStr}`) {
      (global as any).lastAuditRun = `${template.id}_${dateStr}_${timeStr}`;
      
      log('INFO', `Iniciando tarea programada para plantilla: "${template.name}"`);
      
      const customCsv = generateCustomCsvFromDb(template.columns);
      if (!customCsv) {
        log('INFO', `No hay datos para la plantilla "${template.name}" hoy.`);
        return;
      }

      const csvBuffer = Buffer.from(customCsv);
      const subject = `Reporte: ${template.name} - ${dateStr}`;
      const text = `Adjunto el reporte personalizado "${template.name}" generado automáticamente.`;

      if (template.emailEnabled && template.emailTargets) {
        await sendEmail(subject, text, [{ filename: `reporte_${template.name.replace(/\s+/g, '_')}_${dateStr}.csv`, content: csvBuffer }], template.emailTargets);
      }

      if (template.waEnabled && template.waTargets) {
        const { MessageMedia } = pkg;
        const media = new MessageMedia('text/csv', csvBuffer.toString('base64'), `reporte_${template.name.replace(/\s+/g, '_')}_${dateStr}.csv`);
        await sendToWhatsAppChats(template.waTargets, subject, media);
      }
    }
  });
}, 60000); // Revisar cada minuto
