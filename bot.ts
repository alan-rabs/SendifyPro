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
    // Get chat to check the name
    const chat = await msg.getChat();
    
    // Find matching chat config
    const chatConfig = config.chatConfigs?.find((c: any) => c && c.targetContact && (chat.name === c.targetContact || chat.name === c.targetContact.trim()));
    
    if (!chatConfig) {
      return false;
    }

    const direction = chatConfig.messageDirection || 'both';
    if (direction === 'received' && msg.fromMe) {
      return false;
    }
    if (direction === 'sent' && !msg.fromMe) {
      return false;
    }

    log('DEBUG', `Mensaje recibido de ${chat.name}: tipo=${msg.type}, body="${msg.body}"`);

    // Check if message was already processed
    if (db.isMessageProcessed(msg.id._serialized)) {
      log('DEBUG', `Mensaje ya procesado: ${msg.id._serialized}`);
      return false;
    }

    let didProcessSomething = false;

    // 1. Check for text errors or text success
    if (msg.type === 'chat') {
      const text = msg.body.trim();
      log('DEBUG', `Evaluando texto: "${text}" contra triggerError: "${chatConfig.triggerError}"`);
      
      if (chatConfig.triggerError && text.includes(chatConfig.triggerError)) {
        const trigger = chatConfig.triggerError;
        const parts = text.split(trigger);
        
        for (let i = 1; i < parts.length; i++) {
          const errorBlock = parts[i];
          const errorBlockLower = errorBlock.toLowerCase();
          
          const nssWords = chatConfig.triggerNssWord.split(',').map((w: string) => w.trim().toLowerCase());
          const curpWords = chatConfig.triggerCurpWord.split(',').map((w: string) => w.trim().toLowerCase());

          const isNssError = nssWords.some(w => errorBlockLower.includes(w));
          const isCurpError = curpWords.some(w => errorBlockLower.includes(w));
          
          if (isNssError || isCurpError) {
            const flagType = isNssError ? 'NSS' : 'CURP';
            const signature = crypto.createHash('md5').update(errorBlockLower + '_' + msg.id._serialized).digest('hex');
            
            if (!db.isTextSignatureProcessed(signature)) {
              log('WARN', `Detectado error de ${flagType} en el mensaje. Enviando alerta...`);
              
              const nssMatch = errorBlock.match(/\b\d{11}\b/);
              const curpMatch = errorBlock.match(/[A-Z][AEIOUX][A-Z]{2}\d{2}(?:0[1-9]|1[0-2])(?:0[1-9]|[12]\d|3[01])[HM](?:AS|B[CS]|C[CLMSH]|D[FG]|G[TR]|HG|JC|M[CNS]|N[ETL]|OC|PL|Q[TR]|S[PLR]|T[CSL]|VZ|YN|ZS)[B-DF-HJ-NP-TV-Z]{3}[A-Z\d]\d/i);
              
              const nss = nssMatch ? nssMatch[0] : "NO_ENCONTRADO";
              const curp = curpMatch ? curpMatch[0].toUpperCase() : "NO_ENCONTRADO";
              
              let subject = isNssError ? (chatConfig.actionNssSubject || '{original_message}') : (chatConfig.actionCurpSubject || '{original_message}');
              let body = isNssError ? (chatConfig.actionNssBody || 'El NSS no se encontró o no está asociado al CURP') : (chatConfig.actionCurpBody || 'La CURP no tiene el formato correcto.');
              
              const originalMsgPart = trigger + errorBlock;
              subject = subject.replace(/{original_message}/g, originalMsgPart).replace(/{nss}/g, nss).replace(/{curp}/g, curp);
              body = body.replace(/{original_message}/g, originalMsgPart).replace(/{nss}/g, nss).replace(/{curp}/g, curp);
              
              let emailSent = false;
              let waSent = false;
              
              if ((isNssError && chatConfig.nssActionEmailEnabled !== false) || (isCurpError && chatConfig.curpActionEmailEnabled !== false)) {
                const caseType = isNssError ? 'ERROR_NSS' : 'ERROR_CURP';
                const sent = await queueOrSendEmail(subject, body, null, chatConfig.emailDestino, chatConfig.emailBcc, caseType);
                if (sent) emailSent = true;
              }

              if (isNssError && chatConfig.nssActionWaEnabled) {
                const waMsg = (chatConfig.nssWaMessage || 'Error NSS detectado: {original_message}').replace(/{original_message}/g, originalMsgPart).replace(/{nss}/g, nss).replace(/{curp}/g, curp);
                const sent = await sendToWhatsAppChats(chatConfig.nssWaTargets, waMsg);
                if (sent) waSent = true;
              } else if (isCurpError && chatConfig.curpActionWaEnabled) {
                const waMsg = (chatConfig.curpWaMessage || 'Error CURP detectado: {original_message}').replace(/{original_message}/g, originalMsgPart).replace(/{nss}/g, nss).replace(/{curp}/g, curp);
                const sent = await sendToWhatsAppChats(chatConfig.curpWaTargets, waMsg);
                if (sent) waSent = true;
              }

              if (emailSent || waSent) {
                db.markTextSignatureProcessed(signature);
                db.incrementStat('errorsDetected');
                if (emailSent) db.incrementStat('emailsSent');
                
                log('INFO', `✅ Alerta de error ${flagType} procesada.`);
                logAudit(chat.name, `ERROR_${flagType}`, nss, curp, originalMsgPart, body);
                didProcessSomething = true;
              }
            }
          }
        }
      } else {
        // SUCCESS_TEXT logic (multiple matches)
        const nssMatches = text.match(/\b\d{11}\b/g) || [];
        const curpMatches = text.match(/[A-Z][AEIOUX][A-Z]{2}\d{2}(?:0[1-9]|1[0-2])(?:0[1-9]|[12]\d|3[01])[HM](?:AS|B[CS]|C[CLMSH]|D[FG]|G[TR]|HG|JC|M[CNS]|N[ETL]|OC|PL|Q[TR]|S[PLR]|T[CSL]|VZ|YN|ZS)[B-DF-HJ-NP-TV-Z]{3}[A-Z\d]\d/gi) || [];
        
        const maxMatches = Math.max(nssMatches.length, curpMatches.length);
        
        if (maxMatches > 0) {
          for (let i = 0; i < maxMatches; i++) {
            const nss = nssMatches[i] || "NO_ENCONTRADO";
            const curp = curpMatches[i] ? curpMatches[i].toUpperCase() : "NO_ENCONTRADO";
            
            const signature = crypto.createHash('md5').update(`${nss}_${curp}_${msg.id._serialized}`).digest('hex');
            
            if (!db.isTextSignatureProcessed(signature)) {
              let subject = (chatConfig.actionPdfSubject || 'NSS: {nss} - CURP: {curp}')
                .replace(/{nss}/g, nss)
                .replace(/{curp}/g, curp)
                .replace(/{original_message}/g, text);
                
              let body = (chatConfig.actionPdfBody || 'Datos procesados automáticamente.')
                .replace(/{nss}/g, nss)
                .replace(/{curp}/g, curp)
                .replace(/{original_message}/g, text);
                
              let emailSent = false;
              let waSent = false;

              if (chatConfig.pdfActionEmailEnabled !== false) {
                const sent = await queueOrSendEmail(subject, body, null, chatConfig.emailDestino, chatConfig.emailBcc, 'SUCCESS_TEXT');
                if (sent) emailSent = true;
              }

              if (chatConfig.pdfActionWaEnabled) {
                const waMsg = (chatConfig.pdfWaMessage || 'Datos procesados: {nss} - {curp}')
                  .replace(/{nss}/g, nss)
                  .replace(/{curp}/g, curp)
                  .replace(/{original_message}/g, text);
                const sent = await sendToWhatsAppChats(chatConfig.pdfWaTargets, waMsg);
                if (sent) waSent = true;
              }

              if (emailSent || waSent) {
                db.markTextSignatureProcessed(signature);
                db.incrementStat('processedPdfs'); 
                if (emailSent) db.incrementStat('emailsSent');
                
                log('INFO', `✅ Texto con datos procesado con éxito.`);
                // No logueamos SUCCESS_TEXT en el CSV
                didProcessSomething = true;
              }
            }
          }
        }
      }
    }

    // 2. Check for files
    if (msg.hasMedia) {
      const media = await msg.downloadMedia();
      if (media && media.mimetype === chatConfig.fileType) {
        log('INFO', `📄 Archivo ${chatConfig.fileType} detectado. Descargando y procesando en memoria...`);
        
        const pdfBuffer = Buffer.from(media.data, 'base64');
        const fileHash = crypto.createHash('md5').update(pdfBuffer).digest('hex');

        if (db.isPdfProcessed(fileHash)) {
          log('WARN', '♻️ Este PDF ya fue procesado anteriormente (detectado por contenido). Ignorando.');
        } else {
          // Parse PDF
          try {
            const pdfData = await pdf(pdfBuffer);
            const textContent = pdfData.text;
            
            const nssMatches = textContent.match(/\b\d{11}\b/g) || [];
            const curpMatches = textContent.match(/[A-Z][AEIOUX][A-Z]{2}\d{2}(?:0[1-9]|1[0-2])(?:0[1-9]|[12]\d|3[01])[HM](?:AS|B[CS]|C[CLMSH]|D[FG]|G[TR]|HG|JC|M[CNS]|N[ETL]|OC|PL|Q[TR]|S[PLR]|T[CSL]|VZ|YN|ZS)[B-DF-HJ-NP-TV-Z]{3}[A-Z\d]\d/gi) || [];
            
            const maxMatches = Math.max(nssMatches.length, curpMatches.length);
            
            if (maxMatches > 0) {
              let anySent = false;
              for (let i = 0; i < maxMatches; i++) {
                const nss = nssMatches[i] || "NO_ENCONTRADO";
                const curp = curpMatches[i] ? curpMatches[i].toUpperCase() : "NO_ENCONTRADO";
                
                let subject = (chatConfig.actionPdfSubject || 'NSS: {nss} - CURP: {curp}').replace(/{nss}/g, nss).replace(/{curp}/g, curp);
                let body = (chatConfig.actionPdfBody || 'Adjunto PDF procesado automáticamente.').replace(/{nss}/g, nss).replace(/{curp}/g, curp);
                
                log('INFO', `Datos extraídos del PDF -> ${subject}`);
  
                let emailSent = false;
                let waSent = false;
  
                if (chatConfig.pdfActionEmailEnabled !== false) {
                  const sent = await queueOrSendEmail(subject, body, {
                    filename: media.filename || `documento_${Date.now()}.pdf`,
                    content: pdfBuffer
                  }, chatConfig.emailDestino, chatConfig.emailBcc, 'SUCCESS_PDF');
                  if (sent) emailSent = true;
                }
  
                if (chatConfig.pdfActionWaEnabled) {
                  const waMsg = (chatConfig.pdfWaMessage || 'Adjunto PDF procesado: {nss} - {curp}').replace(/{nss}/g, nss).replace(/{curp}/g, curp);
                  const sent = await sendToWhatsAppChats(chatConfig.pdfWaTargets, waMsg, media);
                  if (sent) waSent = true;
                }
  
                if (emailSent || waSent) {
                  anySent = true;
                  db.incrementStat('processedPdfs');
                  if (emailSent) db.incrementStat('emailsSent');
                  log('INFO', `✅ Registro de PDF procesado con éxito (${nss} / ${curp}).`);
                  logAudit(chat.name, 'SUCCESS_PDF', nss, curp, media.filename || 'documento.pdf');
                }
              }
              
              if (anySent) {
                db.markPdfProcessed(fileHash);
                didProcessSomething = true;
              } else if (chatConfig.pdfActionEmailEnabled || chatConfig.pdfActionWaEnabled) {
                log('ERROR', '❌ Fallaron las acciones configuradas para el PDF.');
              } else {
                log('WARN', '⚠️ Se procesó un PDF pero no hay acciones habilitadas.');
              }
            } else {
              log('WARN', '⚠️ No se encontraron NSS ni CURP en el PDF.');
            }
          } catch (pdfErr: any) {
            log('ERROR', `Error al parsear PDF: ${pdfErr.message}`);
          }
        }
      }
    }

    // Mark message as processed so we don't evaluate it again on restart
    db.markMessageProcessed(msg.id._serialized);

    return didProcessSomething;

  } catch (err: any) {
    log('ERROR', `Error procesando mensaje: ${err.message}`);
    return false;
  }
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
      bcc: bcc || '',
      attachment: attachmentInfo
    });
    log('INFO', `Correo encolado para agrupación (Caso: ${caseType}).`);
    return true; // Assume success for queueing
  } else {
    // Send immediately
    return await sendEmail(subject, text, attachment ? [attachment] : null, customTargets, bcc);
  }
}

async function processEmailQueue() {
  const emailQueue = db.getEmailQueue();
  if (emailQueue.length === 0) return;
  log('INFO', `Procesando cola de correos (${emailQueue.length} elementos)...`);

  // Group by destination, bcc, and case type
  const groups: Record<string, any[]> = {};
  for (const item of emailQueue) {
    const key = `${item.to}_${item.bcc}_${item.caseType}`;
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

    const sent = await sendEmail(subject, combinedBody, attachments.length > 0 ? attachments : null, first.to, first.bcc);
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
  
  const schedules = [config.emailSchedule1, config.emailSchedule2, config.emailSchedule3].filter(Boolean);
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

async function sendEmail(subject: string, text: string, attachments: { filename: string, content: Buffer }[] | null, customTargets?: string, bcc?: string) {
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
