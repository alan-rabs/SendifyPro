import pkg from 'whatsapp-web.js';
const { Client, LocalAuth, Message } = pkg;
import qrcode from 'qrcode';
import nodemailer from 'nodemailer';
import fs from 'fs';
import path from 'path';
import cron from 'node-cron';
import * as db from './db.js';
import * as XLSX from 'xlsx';

import { PDFParse } from 'pdf-parse';

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

export function logAudit(phoneNumber: string, actionType: string, nss: string, curp: string, message: string = '', error: string = '', originalTimestamp?: number) {
    if (actionType === 'SUCCESS_TEXT') return; // Ignorar SUCCESS_TEXT en el CSV

    const processingTimestamp = getLocalTimestamp();
    const timestamp = originalTimestamp ? new Date(originalTimestamp * 1000).toLocaleString('es-MX', { timeZone: 'America/Mexico_City' }) : processingTimestamp;

    const isSweep = (global as any).isValidationSweep;
    const messageId = (global as any).sweepMessageId || '';
    const executionType = isSweep ? 'Barrido' : 'Tiempo real';

    if (isSweep) {
        if (!(global as any).sweepRecoveredItems) {
            (global as any).sweepRecoveredItems = [];
        }
        (global as any).sweepRecoveredItems.push({
            nss: nss !== 'NO_ENCONTRADO' ? nss : '',
            curp: curp !== 'NO_ENCONTRADO' ? curp : '',
            rule: actionType
        });
    }

    db.addAuditLog({
        timestamp,
        phoneNumber,
        actionType,
        nss,
        curp,
        message,
        error,
        message_id: messageId,
        execution_type: executionType,
        processing_timestamp: processingTimestamp
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
    auditEmailSchedule: '23:59',
    auditActionWaEnabled: false,
    auditWaTargets: '',
    auditWaSchedule: '23:59',
    // Auto Power Settings
    autoPowerEnabled: true,
    autoPowerOffTime: '00:00',
    autoPowerOnTime: '07:00',

    // Chat configs
    chatConfigs: [],
    initialFetchLimit: 50,
    initialFetchMode: 'limit', // 'limit' or 'date'
    initialFetchDate: new Date().toISOString().split('T')[0] // Default to today
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
    try {
        return db.getStats();
    } catch (e) {
        console.error("Error in getStats (bot.ts):", e);
        return { processedPdfs: 0, emailsSent: 0, errorsDetected: 0, recentFiles: [], recentEvents: [], recentEmails: [], emailQueue: [], lastEmailError: '', lastProcessedFile: 'Ninguno' };
    }
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

function cleanupOrphanedTempFiles() {
    try {
        const tempDir = path.join(process.cwd(), 'bot_data', 'temp_attachments');
        if (!fs.existsSync(tempDir)) return;

        const files = fs.readdirSync(tempDir);
        if (files.length === 0) return;

        const emailQueue = db.getEmailQueue();
        const activePaths = new Set(emailQueue.map(item => item.attachment?.path).filter(Boolean));

        let deletedCount = 0;
        for (const file of files) {
            const filePath = path.join(tempDir, file);
            if (!activePaths.has(filePath)) {
                try {
                    fs.unlinkSync(filePath);
                    deletedCount++;
                } catch (e) {}
            }
        }

        if (deletedCount > 0) {
            log('INFO', `🧹 Limpieza: Se eliminaron ${deletedCount} archivos temporales huérfanos para liberar espacio.`);
        }
    } catch (err) {
        log('ERROR', `Error durante la limpieza de archivos temporales: ${err}`);
    }
}

export async function startBot() {
    if (client) {
        log('WARN', 'El bot ya está en ejecución o iniciando.');
        return;
    }

    // Limpiar archivos temporales que no estén en la cola antes de iniciar
    cleanupOrphanedTempFiles();

    log('INFO', 'Iniciando motor de WhatsApp Web (Modo Offscreen)...');
    botStatus = 'starting';
    currentQrCode = null;

    client = new Client({
        authStrategy: new LocalAuth({ dataPath: path.join(DATA_DIR, 'session') }),
        puppeteer: {
            // CAMBIO CRÍTICO: modo visible para que WA Web inicialice todos sus contextos
            // (webcBrowserNetworkType, UI observers, etc.). La ventana se posiciona fuera
            // de la pantalla para que no estorbe visualmente.
            headless: false,
            args: [
                '--no-sandbox',
                '--disable-setuid-sandbox',
                '--disable-dev-shm-usage',
                '--window-position=-2000,-2000',  // fuera de pantalla visible
                '--window-size=400,600',           // ventana pequeña
                '--disable-blink-features=AutomationControlled',
                '--disable-infobars'
            ],
            timeout: 60000,
            protocolTimeout: 7200000 // 2 horas para evitar timeouts en barridos largos
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

        // Aplicar parche de carga histórica antes de cualquier recuperación de mensajes
        await patchWAWebMessageLoader();

        // Cerrar popups que WA Web pueda mostrar al conectarse (ej: "Usar aquí" si hay
        // otras pestañas abiertas, o avisos de inicio). Esto previene que la UI quede
        // bloqueada y el bot no pueda interactuar con los chats.
        await dismissWAPopups();

        // Vigilancia periódica: cada 30s cerrar popups que puedan aparecer mientras corre.
        // Esto es clave porque WA Web puede mostrar "Usar aquí" en cualquier momento si
        // detecta que la sesión está activa en otra ventana (p.ej. el usuario abre WA
        // Web en su navegador normal mientras el bot corre).
        const popupWatcher = setInterval(() => {
            dismissWAPopups().catch(() => {});
        }, 30000);
        (client as any).__popupWatcher = popupWatcher;

        try {
            log('INFO', 'Esperando 30 segundos para permitir la sincronización inicial de chats...');
            await new Promise(resolve => setTimeout(resolve, 30000));

            log('INFO', `Obteniendo lista de chats para recuperar mensajes pendientes (esto puede demorar)...`);
            let chats = await client.getChats();

            // Si la lista está vacía o muy chica, reintentar con espera adicional
            for (let retry = 0; retry < 3 && chats.length < 5; retry++) {
                log('INFO', `Lista de chats incompleta (${chats.length}). Esperando 20s adicionales y reintentando...`);
                await new Promise(resolve => setTimeout(resolve, 20000));
                chats = await client.getChats();
            }
            log('INFO', `Total de chats detectados: ${chats.length}`);
            let totalProcessed = 0;

            for (const chatConf of (config.chatConfigs || [])) {
                if (!chatConf || !chatConf.targetContact) continue;
                if (chatConf.enabled === false) {
                    log('INFO', `Saltando chat "${chatConf.targetContact}" porque está desactivado.`);
                    continue;
                }

                const targetChat = chats.find((c: any) => c.name === chatConf.targetContact || c.name === chatConf.targetContact.trim());

                if (targetChat) {
                    try {
                        let messages = [];
                        if (config.initialFetchMode === 'date') {
                            // FIX zona horaria: parsear la fecha como LOCAL, no UTC.
                            // new Date("2026-04-23") se parsea como UTC midnight, que en México (UTC-6)
                            // se convierte en el día anterior 18:00 local. Luego setHours(0,0,0,0) retrocede
                            // un día más y terminamos filtrando desde el día anterior al solicitado.
                            // Solución: construir la fecha con los componentes year/month/day en hora local.
                            const dateStr = config.initialFetchDate || new Date().toISOString().split('T')[0];
                            const parts = String(dateStr).split('-');
                            const targetDate = parts.length === 3
                                ? new Date(Number(parts[0]), Number(parts[1]) - 1, Number(parts[2]), 0, 0, 0, 0)
                                : new Date(dateStr);
                            targetDate.setHours(0, 0, 0, 0);
                            const targetTimestamp = Math.floor(targetDate.getTime() / 1000);

                            log('INFO', `Chat "${chatConf.targetContact}" encontrado. Buscando mensajes desde ${targetDate.toLocaleString('es-MX', { timeZone: 'America/Mexico_City' })} (timestamp ${targetTimestamp})...`);

                            let currentLimit = 100;
                            let reachedTargetDate = false;
                            let consecutiveErrors = 0;
                            let lastMessageCount = 0;

                            while (!reachedTargetDate && currentLimit <= 4000) {
                                try {
                                    const batch = await safeFetchMessages(targetChat, { limit: currentLimit });
                                    messages = batch;

                                    if (batch.length === 0 || batch.length === lastMessageCount) {
                                        break;
                                    }
                                    lastMessageCount = batch.length;

                                    const oldestMsg = batch[0];
                                    if (oldestMsg.timestamp <= targetTimestamp) {
                                        reachedTargetDate = true;
                                    } else {
                                        const oldestDate = new Date(oldestMsg.timestamp * 1000).toLocaleDateString();
                                        log('INFO', `Mensaje más antiguo hasta ahora: ${oldestDate}. Aumentando búsqueda a ${currentLimit + 200} mensajes...`);
                                        currentLimit += 200;
                                        await new Promise(resolve => setTimeout(resolve, 1000));
                                    }
                                    consecutiveErrors = 0;
                                } catch (fetchErr: any) {
                                    consecutiveErrors++;
                                    log('WARN', `Intento fallido de recuperación en "${targetChat.name}" (${consecutiveErrors}/12): ${fetchErr.message || String(fetchErr)}`);
                                    if (consecutiveErrors > 12) {
                                        log('ERROR', `Demasiados errores al recuperar mensajes en "${targetChat.name}". Abortando recuperación.`);
                                        break;
                                    }
                                    await new Promise(r => setTimeout(r, 5000));
                                }
                            }

                            messages = messages.filter((m: any) => m.timestamp >= targetTimestamp);
                            if (messages.length > 0) {
                                const oldest = new Date(messages[0].timestamp * 1000).toLocaleString('es-MX', { timeZone: 'America/Mexico_City' });
                                const newest = new Date(messages[messages.length - 1].timestamp * 1000).toLocaleString('es-MX', { timeZone: 'America/Mexico_City' });
                                log('INFO', `Se encontraron ${messages.length} mensajes desde la fecha especificada (rango: ${oldest} → ${newest}).`);
                            } else {
                                log('INFO', `Se encontraron 0 mensajes desde la fecha especificada.`);
                            }
                        } else {
                            const targetLimit = config.initialFetchLimit || 50;
                            log('INFO', `Chat "${chatConf.targetContact}" encontrado. Revisando los últimos ${targetLimit} mensajes...`);

                            let currentLimit = Math.min(50, targetLimit);
                            let consecutiveErrors = 0;
                            let lastMessageCount = 0;

                            while (currentLimit <= targetLimit) {
                                try {
                                    const batch = await safeFetchMessages(targetChat, { limit: currentLimit });
                                    messages = batch;

                                    if (batch.length === 0 || batch.length === lastMessageCount || batch.length >= targetLimit) {
                                        break;
                                    }
                                    lastMessageCount = batch.length;

                                    if (currentLimit < targetLimit) {
                                        log('INFO', `Recuperados ${batch.length} de ${targetLimit} mensajes. Continuando...`);
                                    }

                                    currentLimit = Math.min(currentLimit + 100, targetLimit);
                                    await new Promise(resolve => setTimeout(resolve, 1000));
                                    consecutiveErrors = 0;
                                } catch (fetchErr: any) {
                                    consecutiveErrors++;
                                    log('WARN', `Intento fallido de recuperación en "${targetChat.name}" (${consecutiveErrors}/12): ${fetchErr.message || String(fetchErr)}`);
                                    if (consecutiveErrors > 12) {
                                        log('ERROR', `Demasiados errores al recuperar mensajes en "${targetChat.name}". Abortando recuperación.`);
                                        break;
                                    }
                                    await new Promise(r => setTimeout(r, 5000));
                                }
                            }
                        }

                        let processedCount = 0;
                        for (let i = 0; i < messages.length; i++) {
                            const msg = messages[i];
                            const processed = await processMessage(msg);
                            if (processed) processedCount++;

                            if (i > 0 && i % 500 === 0) {
                                log('INFO', `Progreso de recuperación en "${chatConf.targetContact}": ${i}/${messages.length} mensajes revisados...`);
                            }
                        }

                        if (processedCount > 0) {
                            log('INFO', `✅ Se recuperaron y procesaron ${processedCount} mensajes/archivos pendientes en "${chatConf.targetContact}".`);
                            totalProcessed += processedCount;
                        }
                    } catch (chatErr: any) {
                        log('ERROR', `Error al procesar el historial del chat "${chatConf.targetContact}": ${chatErr.message}`);
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

// ─── CARGA DE MENSAJES HISTÓRICOS ────────────────────────────────────────────
//
// DIAGNÓSTICO: wwebjs v1.34 llama a:
//   window.Store.ConversationMsgs.loadEarlierMsgs(chat, chat.msgs)
// Internamente, ese módulo de WA Web accede a una propiedad del objeto chat
// (p.ej. chat.conversationLoadingState) que solo existe cuando el chat está
// abierto en la UI de React. En modo headless esa propiedad es undefined →
// crash "Cannot read properties of undefined (reading 'waitForChatLoading')".
//
// SOLUCIÓN: Parchear window.Store.ConversationMsgs.loadEarlierMsgs una sola
// vez al conectarse para envolver los argumentos en un Proxy que devuelve un
// mock (con waitForChatLoading como no-op) para cualquier propiedad undefined
// cuyo nombre indique un "estado de carga". Con eso el módulo sigue adelante
// y carga mensajes reales desde el servidor/caché local de WA Web.
// ─────────────────────────────────────────────────────────────────────────────

let waWebPatchApplied = false;
let waWebPatchWarnLogged = false;

async function patchWAWebMessageLoader(): Promise<void> {
    if (!client || waWebPatchApplied) return;
    try {
        const patched = await client.pupPage.evaluate((): boolean => {
            try {
                // Usar window.Store.ConversationMsgs (ya configurado por wwebjs al conectar).
                // window.require('WAWebChatLoadMessages') no está disponible post-inicialización
                // en versiones recientes de WA Web.
                const mod = (window as any).Store?.ConversationMsgs;
                if (!mod?.loadEarlierMsgs) return false;
                if ((mod as any).__wwjsPatch) return true;

                const origFn = mod.loadEarlierMsgs;

                const mockResult: any = { noEarlierMsgs: false };
                const mockState: any = new Proxy(
                    { waitForChatLoading: () => Promise.resolve(mockResult), isChatLoaded: true, isLoaded: true, noEarlierMsgs: false },
                    { get(t: any, p: any, r: any) {
                            if (typeof p === 'symbol') return Reflect.get(t, p, r);
                            if (p === 'then' || p === 'catch' || p === 'finally') return undefined;
                            if (p in t) return t[p];
                            return () => mockResult;
                        }}
                );

                // Palabras clave que identifican propiedades de estado de carga en WA Web Comet
                const STATE_KW = [
                    'loadingstate', 'convstate', 'chatstate', 'loadstate',
                    'chatloading', 'convloading', 'conversationstate', 'panelstate', 'viewstate',
                ];

                const makeProxy = (obj: any): any => {
                    if (!obj || typeof obj !== 'object') return obj;
                    return new Proxy(obj, {
                        get(target: any, prop: any, recv: any) {
                            if (typeof prop === 'symbol') return Reflect.get(target, prop, recv);
                            // No interceptar propiedades de Promise/async (rompería await)
                            if (prop === 'then' || prop === 'catch' || prop === 'finally') {
                                return Reflect.get(target, prop, recv);
                            }
                            const val = Reflect.get(target, prop, recv);
                            if (val === undefined && typeof prop === 'string') {
                                const lc = prop.toLowerCase();
                                if (STATE_KW.some((k: string) => lc.includes(k))) return mockState;
                            }
                            return val;
                        },
                    });
                };

                // Proxy amplio: intercepta CUALQUIER propiedad undefined (no solo las que
                // coinciden con palabras clave). Es el fallback cuando el proxy de keywords no basta.
                // Se excluyen propiedades de Promise y otras especiales para no romper async/await.
                const BROAD_SKIP = new Set(['then', 'catch', 'finally', 'length', 'constructor',
                    'prototype', '__proto__', 'toString', 'valueOf',
                    'hasOwnProperty', 'isPrototypeOf']);
                const makeBroadProxy = (obj: any): any => {
                    if (!obj || typeof obj !== 'object') return obj;
                    return new Proxy(obj, {
                        get(target: any, prop: any, recv: any) {
                            if (typeof prop === 'symbol') return Reflect.get(target, prop, recv);
                            if (BROAD_SKIP.has(prop as string)) return Reflect.get(target, prop, recv);
                            const val = Reflect.get(target, prop, recv);
                            if (val === undefined && typeof prop === 'string' && isNaN(Number(prop))) {
                                return mockState;
                            }
                            return val;
                        },
                    });
                };

                mod.loadEarlierMsgs = async function (chat: any, msgs: any) {
                    // Intento 1: proxy selectivo (palabras clave de estado)
                    try {
                        return await origFn.call(this, makeProxy(chat), makeProxy(msgs));
                    } catch (e1: any) {
                        if (!(e1?.message || '').includes('waitForChatLoading')) {
                            if ((e1?.message || '').length > 0) throw e1;
                            return [];
                        }
                    }
                    // Intento 2: proxy amplio (intercepta todas las propiedades undefined)
                    try {
                        return await origFn.call(this, makeBroadProxy(chat), makeBroadProxy(msgs));
                    } catch (e2: any) {
                        if ((e2?.message || '').includes('waitForChatLoading')) return [];
                        throw e2;
                    }
                };
                (mod as any).__wwjsPatch = true;
                return true;
            } catch (_) {
                return false;
            }
        });

        if (patched) {
            waWebPatchApplied = true;
            log('INFO', 'Parche WAWebChatLoadMessages aplicado — carga de mensajes históricos habilitada.');
        } else if (!waWebPatchWarnLogged) {
            log('WARN', 'No se pudo aplicar el parche de carga histórica (módulo aún no disponible). Se reintentará automáticamente en la primera carga de mensajes.');
            waWebPatchWarnLogged = true;
        }
    } catch (e: any) {
        if (!waWebPatchWarnLogged) {
            log('WARN', `Error al aplicar parche WAWeb: ${e.message}`);
            waWebPatchWarnLogged = true;
        }
    }
}

// Detecta y cierra popups comunes de WhatsApp Web que bloquean la interacción:
//  - "Usar aquí / Use Here" (cuando WA detecta la sesión en otra ventana)
//  - "Tu teléfono no está conectado" con botón para reconectar
//  - Otros dialogs que aparecen encima del chat y bloquean clicks
// Se llama antes de cada click crítico para asegurar que la UI es usable.
//
// IMPORTANTE: el código del evaluate se pasa como STRING (no callback) para
// evitar que tsx/esbuild inyecte helpers como __name() que no existen en el browser.
async function dismissWAPopups(): Promise<boolean> {
    if (!client || !client.pupPage) return false;
    const page: any = client.pupPage;

    try {
        // Buscar dialogs/popups visibles y marcar el botón principal (si existe)
        const findButtonCode = `(function() {
      var targetTexts = [
        'usar aquí', 'use here', 'usar aqui',
        'click to use whatsapp here', 'use whatsapp here',
        'open here', 'abrir aquí', 'reconnect', 'reconectar',
        'continuar', 'continue', 'ok', 'entendido', 'got it'
      ];
      var candidates = document.querySelectorAll('button, [role="button"], div[role="button"]');
      for (var i = 0; i < candidates.length; i++) {
        var el = candidates[i];
        var text = (el.textContent || '').trim().toLowerCase();
        if (!text) continue;
        for (var j = 0; j < targetTexts.length; j++) {
          if (text === targetTexts[j] || text.indexOf(targetTexts[j]) === 0) {
            var rect = el.getBoundingClientRect();
            if (rect.width > 0 && rect.height > 0) {
              var marker = '__wwjs_popup_btn_' + Date.now();
              el.setAttribute('data-wwjs-popup-btn', marker);
              return marker;
            }
          }
        }
      }
      return null;
    })()`;

        const buttonMarker: string | null = await page.evaluate(findButtonCode);

        if (!buttonMarker) return false; // No había popup que cerrar

        // Hacer click REAL en el botón
        const selector = `[data-wwjs-popup-btn="${buttonMarker}"]`;
        const btn: any = await page.$(selector);
        if (!btn) return false;

        try {
            await btn.click();
            log('INFO', '🧹 Popup de WhatsApp Web cerrado automáticamente (probable "Usar aquí").');
            await new Promise(r => setTimeout(r, 1500));
            return true;
        } finally {
            try { await btn.dispose(); } catch(_) {}
        }
    } catch (e: any) {
        log('DEBUG', `dismissWAPopups: ${e.message}`);
        return false;
    }
}

// Hace click REAL en el chat usando Puppeteer (isTrusted=true).
// Esto es crítico: los eventos MouseEvent sintéticos creados dentro del browser
// son ignorados por React/WA Web. Solo los clicks de Puppeteer nativo (o un
// humano real) disparan los handlers que inicializan los contextos de carga.
// Parámetros:
//  - chatName: nombre del chat a abrir
//  - scrollCount: cuántos scrolls hacer para cargar mensajes (default 20)
// Retorna true si la operación fue exitosa.
async function clickChatInUI(chatName: string, scrollCount: number = 20): Promise<boolean> {
    if (!client || !client.pupPage) return false;
    const page: any = client.pupPage;
    try {
        // Cerrar cualquier popup que pueda estar bloqueando la UI antes del click
        await dismissWAPopups();

        const normalized = (chatName || '').toUpperCase();

        // Check 1: ¿El chat ya está activo? (skip click si sí)
        // IMPORTANTE: código como STRING para evitar inyección de __name por tsx/esbuild.
        const checkActiveCode = `(function() {
      var nameUpper = ${JSON.stringify(normalized)};
      var headerEl = document.querySelector('#main header span[title], #main header span[dir="auto"]');
      if (!headerEl) return false;
      var headerText = (headerEl.textContent || headerEl.getAttribute('title') || '').toUpperCase().trim();
      return headerText === nameUpper;
    })()`;

        const alreadyActive: boolean = await page.evaluate(checkActiveCode);

        if (!alreadyActive) {
            // Paso 1: Localizar el chat en el DOM (con scroll en la lista si no está visible)
            const findChatCode = `(async function() {
        var nameUpper = ${JSON.stringify(normalized)};

        function findChatElement() {
          var titled = document.querySelectorAll('span[title], div[title]');
          for (var i = 0; i < titled.length; i++) {
            var el = titled[i];
            var t = el.getAttribute('title') || '';
            if (t.toUpperCase() === nameUpper) {
              var node = el;
              for (var up = 0; up < 15 && node; up++) {
                var role = node.getAttribute ? node.getAttribute('role') : null;
                var testid = node.getAttribute ? node.getAttribute('data-testid') : null;
                if (role === 'listitem' || role === 'row' || role === 'gridcell' ||
                    testid === 'cell-frame-container' || testid === 'chat') {
                  return node;
                }
                node = node.parentElement;
              }
              return el;
            }
          }
          return null;
        }

        var chatEl = findChatElement();
        if (!chatEl) {
          var chatList = document.querySelector('[role="grid"]') ||
                         document.querySelector('#pane-side') ||
                         document.querySelector('[data-tab="3"]');
          if (chatList) {
            for (var sc = 0; sc < 20 && !chatEl; sc++) {
              chatList.scrollTop = chatList.scrollTop + 500;
              await new Promise(function(r) { setTimeout(r, 300); });
              chatEl = findChatElement();
            }
          }
        }

        if (!chatEl) return null;

        var marker = '__wwjs_click_target_' + Date.now();
        chatEl.setAttribute('data-wwjs-click-target', marker);
        return marker;
      })()`;

            const foundChat: string | null = await page.evaluate(findChatCode);

            if (!foundChat) {
                log('WARN', `clickChatInUI: no se encontró el chat "${chatName}" en el DOM.`);
                return false;
            }

            // Paso 2: Click REAL con Puppeteer (isTrusted=true)
            const selector = `[data-wwjs-click-target="${foundChat}"]`;
            const elementHandle: any = await page.$(selector);
            if (!elementHandle) return false;

            try {
                // Scroll into view usando STRING (no callback TS)
                await page.evaluate(`(function() {
          var el = document.querySelector('[data-wwjs-click-target="${foundChat}"]');
          if (el) el.scrollIntoView({ block: 'center', behavior: 'instant' });
        })()`);
                await new Promise(r => setTimeout(r, 300));

                // CLICK REAL: isTrusted=true, dispara handlers de React/WA Web
                await elementHandle.click();
                log('INFO', `✅ clickChatInUI: click real en "${chatName}" ejecutado.`);
            } catch (clickErr: any) {
                log('WARN', `clickChatInUI: error en click real: ${clickErr.message}`);
                return false;
            } finally {
                try { await elementHandle.dispose(); } catch(_) {}
            }

            // Paso 3: Esperar a que el chat se abra e inicialice contextos
            await new Promise(r => setTimeout(r, 3500));
        }

        // Paso 4: Scroll al tope del panel de mensajes para cargar históricos.
        // Número proporcional al limit solicitado.
        const scrollCode = `(async function() {
      var numScrolls = ${JSON.stringify(scrollCount)};
      var msgPane = document.querySelector('[data-testid="conversation-panel-messages"]') ||
                    document.querySelector('#main [role="application"]') ||
                    document.querySelector('#main .copyable-area');
      if (!msgPane) return false;
      for (var i = 0; i < numScrolls; i++) {
        msgPane.scrollTop = 0;
        msgPane.dispatchEvent(new Event('scroll', { bubbles: true }));
        await new Promise(function(r) { setTimeout(r, 500); });
      }
      return true;
    })()`;

        await page.evaluate(scrollCode);

        return true;
    } catch (e: any) {
        log('WARN', `clickChatInUI: error general: ${e.message}`);
        return false;
    }
}


// Carga mensajes históricos usando click real en UI + scroll + loadEarlierMsgs.
// El click real en la UI (clickChatInUI) abre el chat naturalmente, inicializa
// todos los contextos de WA Web y hace scroll para cargar mensajes. Luego aquí
// recolectamos los mensajes de la colección y, si falta, usamos loadEarlierMsgs
// (que ya funciona porque el chat está activo).
async function fetchMessagesFromMemory(chat: any, limit: number): Promise<any[]> {
    if (!client) return [];
    const chatId = chat.id._serialized;
    const chatName = chat.name || chat.formattedTitle || '';

    // Calcular cuántos scrolls hacer en la UI según el límite pedido.
    // WA Web carga ~20-30 mensajes por scroll. Mínimo 15, máximo 60.
    const scrollCount = Math.min(60, Math.max(15, Math.ceil(limit / 20)));

    // Click REAL en el chat: abre el chat en UI, inicializa contextos, hace scroll
    // para cargar históricos. Este es el paso clave que hace funcionar todo.
    await clickChatInUI(chatName, scrollCount);

    // Recolectar mensajes de la colección. Si aún no hay suficientes, usar
    // loadEarlierMsgs como fallback (ahora sí funciona con el chat activo).
    const code = `(async function() {
    try {
      var chatObj = await window.WWebJS.getChat(${JSON.stringify(chatId)}, { getAsModel: false });
      if (!chatObj || !chatObj.msgs) return { msgs: [], diag: 'no_chat' };

      var lim = ${JSON.stringify(limit)};
      var msgs = chatObj.msgs.getModelsArray().filter(function(m) { return !m.isNotification; });

      // Fallback: si aún no tenemos suficientes mensajes después del scroll UI,
      // usar loadEarlierMsgs (que ya funciona porque el chat está activo).
      var convMsgs = (window.Store && window.Store.ConversationMsgs) || null;
      if (msgs.length < lim && convMsgs && typeof convMsgs.loadEarlierMsgs === 'function') {
        var emptyStreak = 0;
        for (var i = 0; i < 40 && msgs.length < lim; i++) {
          try {
            chatObj.msgs.noEarlierMsgs = false;
            await convMsgs.loadEarlierMsgs(chatObj, chatObj.msgs);
          } catch(_) { break; }
          await new Promise(function(r) { setTimeout(r, 400); });
          var newMsgs = chatObj.msgs.getModelsArray().filter(function(m) { return !m.isNotification; });
          if (newMsgs.length === msgs.length) {
            emptyStreak++;
            if (emptyStreak >= 3) break;
          } else {
            emptyStreak = 0;
          }
          msgs = newMsgs;
        }
      }

      msgs.sort(function(a, b) { return a.t - b.t; });
      if (lim > 0 && msgs.length > lim) msgs = msgs.slice(msgs.length - lim);

      var serialized = msgs.map(function(m) {
        try { return window.WWebJS.getMessageModel(m); } catch(e) { return null; }
      }).filter(Boolean);

      return { msgs: serialized, diag: 'ok', count: serialized.length };
    } catch(e) {
      return { msgs: [], diag: 'error:' + (e && e.message ? e.message : '?') };
    }
  })()`;

    try {
        const result: any = await (client.pupPage as any).evaluate(code);

        if (result.diag === 'ok') {
            log('INFO', `fetchMessagesFromMemory "${chat.name}": ${result.count} mensajes cargados.`);
        } else {
            log('WARN', `fetchMessagesFromMemory "${chat.name}": ${result.diag}`);
        }

        return (result.msgs as any[]).filter(Boolean).map((m: any) => {
            const msg = new Message(client, m);
            if ((msg as any).acceptGroupV4Invite === undefined) {
                (msg as any).acceptGroupV4Invite = async () => false;
            }
            return msg;
        });
    } catch (e: any) {
        log('ERROR', `fetchMessagesFromMemory error para ${chat.name}: ${e.message}`);
        return [];
    }
}


async function safeFetchMessages(chat: any, searchOptions: any) {
    // chat.fetchMessages({limit:1}) sirve como warm-up para inicializar el módulo
    // WAWebChatLoadMessages (lazy-load de WA Web Comet). El resultado se descarta;
    // fetchMessagesFromMemory hace la carga real con reset de noEarlierMsgs.
    await patchWAWebMessageLoader();
    try { await chat.fetchMessages({ limit: 1 }); } catch (_) { /* warm-up */ }
    return await fetchMessagesFromMemory(chat, searchOptions?.limit || 100);
}

async function processMessage(msg: any): Promise<boolean> {
    try {
        const chat = await msg.getChat();
        const chatConfig = config.chatConfigs?.find((c: any) => c && c.targetContact && (chat.name === c.targetContact || chat.name === c.targetContact.trim()));

        if (!chatConfig) return false;
        if (chatConfig.enabled === false) return false;

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
        const originalMessageBody = msg.body || '';
        let textContent = msg.body || '';
        let processingError = false;

        if (msg.hasMedia) {
            log('INFO', `📄 Archivo detectado en "${chat.name}". Iniciando descarga...`);
            try {
                media = await msg.downloadMedia();
                if (!media) {
                    log('ERROR', `❌ No se pudo descargar el archivo del mensaje.`);
                    processingError = true;
                } else {
                    log('INFO', `✅ Archivo descargado: ${media.filename || 'sin_nombre'} (${media.mimetype})`);
                }
            } catch (e) {
                log('ERROR', `❌ Error descargando media: ${e instanceof Error ? e.message : String(e)}`);
                processingError = true;
            }

            if (media && media.mimetype === 'application/pdf' && !processingError) {
                log('INFO', `🔍 Extrayendo texto del PDF...`);
                try {
                    const pdfBuffer = Buffer.from(media.data, 'base64');

                    // Intentar obtener la clase PDFParse de diferentes formas según el entorno
                    let ParserClass = PDFParse;
                    if (typeof ParserClass !== 'function' && (ParserClass as any)?.PDFParse) {
                        ParserClass = (ParserClass as any).PDFParse;
                    }

                    if (typeof ParserClass === 'function') {
                        const parser = new (ParserClass as any)({ data: pdfBuffer });
                        const pdfData = await parser.getText();
                        textContent = pdfData.text || '';
                        log('INFO', `✅ Texto extraído correctamente (${textContent.length} caracteres).`);
                        db.incrementStat('processedPdfs');
                        const fileName = media.filename || 'PDF sin nombre';
                        db.setMetadata('last_processed_file', fileName);

                        // Update recent files list
                        const stats = db.getStats();
                        const recent = stats.recentFiles || [];
                        const updatedRecent = [fileName, ...recent.filter((f: string) => f !== fileName)].slice(0, 5);
                        db.setMetadata('recent_processed_files', JSON.stringify(updatedRecent));
                    } else {
                        log('ERROR', `❌ No se pudo encontrar la clase PDFParse (tipo: ${typeof ParserClass}).`);
                        processingError = true;
                    }
                } catch (e) {
                    log('ERROR', `❌ Error al extraer texto de PDF: ${e instanceof Error ? e.message : String(e)}`);
                    processingError = true;
                }
            }
        }

        // Extract NSS and CURP for placeholders if possible (Global fallback)
        const globalNssMatch = textContent.match(/\b\d{11}\b/);
        const globalCurpMatch = textContent.match(/[A-Z][AEIOUX][A-Z]{2}\d{2}(?:0[1-9]|1[0-2])(?:0[1-9]|[12]\d|3[01])[HM](?:AS|B[CS]|C[CLMSH]|D[FG]|G[TR]|HG|JC|M[CNS]|N[ETL]|OC|PL|Q[TR]|S[PLR]|T[CSL]|VZ|YN|ZS)[B-DF-HJ-NP-TV-Z]{3}[A-Z\d]\d/i);
        const globalNss = globalNssMatch ? globalNssMatch[0] : "NO_ENCONTRADO";
        const globalCurp = globalCurpMatch ? globalCurpMatch[0].toUpperCase() : "NO_ENCONTRADO";

        if (globalNss !== "NO_ENCONTRADO" || globalCurp !== "NO_ENCONTRADO") {
            log('INFO', `🔎 Datos identificados (Global) -> NSS: ${globalNss}, CURP: ${globalCurp}`);
        }

        const lines = textContent.split('\n').filter(l => l.trim() !== '');

        for (const rule of rules) {
            if (rule.enabled === false) {
                log('DEBUG', `Regla "${rule.name}" está deshabilitada. Saltando...`);
                continue;
            }
            log('DEBUG', `Probando regla "${rule.name}" (Tipo: ${rule.type}, Subtipo: ${rule.subtype})`);

            let matchesToProcess: { text: string, nss: string, curp: string, originalMsg: string }[] = [];

            if (rule.type === 'text') {
                const trigger = (rule.triggerValue || '').trim();
                const fullText = textContent.trim();

                // 1. Intentar coincidencia GLOBAL primero (mensaje completo)
                let isGlobalMatch = false;
                if (rule.subtype === 'exact') {
                    isGlobalMatch = fullText.toLowerCase() === trigger.toLowerCase();
                } else if (rule.subtype === 'contains') {
                    isGlobalMatch = fullText.toLowerCase().includes(trigger.toLowerCase());
                } else if (rule.subtype === 'regex') {
                    try {
                        const re = new RegExp(trigger, 'i');
                        isGlobalMatch = re.test(fullText);
                    } catch (e) {
                        log('ERROR', `Regex inválido en regla "${rule.name}": ${trigger}`);
                    }
                }

                if (isGlobalMatch) {
                    log('DEBUG', `✅ Regla de texto "${rule.name}" coincide globalmente.`);
                    matchesToProcess.push({ text: textContent, nss: globalNss, curp: globalCurp, originalMsg: originalMessageBody });
                } else {
                    // 2. Si no coincide globalmente, intentar POR LÍNEA
                    for (const line of lines) {
                        const text = line.trim();
                        let isLineMatch = false;

                        if (rule.subtype === 'exact') {
                            isLineMatch = text.toLowerCase() === trigger.toLowerCase();
                        } else if (rule.subtype === 'contains') {
                            isLineMatch = text.toLowerCase().includes(trigger.toLowerCase());
                        } else if (rule.subtype === 'regex') {
                            try {
                                const re = new RegExp(trigger, 'i');
                                isLineMatch = re.test(text);
                            } catch (e) {
                                // Ya logueado arriba
                            }
                        }

                        if (isLineMatch) {
                            const lineNssMatch = text.match(/\b\d{11}\b/);
                            const lineCurpMatch = text.match(/[A-Z][AEIOUX][A-Z]{2}\d{2}(?:0[1-9]|1[0-2])(?:0[1-9]|[12]\d|3[01])[HM](?:AS|B[CS]|C[CLMSH]|D[FG]|G[TR]|HG|JC|M[CNS]|N[ETL]|OC|PL|Q[TR]|S[PLR]|T[CSL]|VZ|YN|ZS)[B-DF-HJ-NP-TV-Z]{3}[A-Z\d]\d/i);
                            matchesToProcess.push({
                                text: text,
                                nss: lineNssMatch ? lineNssMatch[0] : globalNss,
                                curp: lineCurpMatch ? lineCurpMatch[0].toUpperCase() : globalCurp,
                                originalMsg: originalMessageBody
                            });
                        }
                    }

                    if (matchesToProcess.length > 0) {
                        log('DEBUG', `✅ Regla de texto "${rule.name}" coincide en ${matchesToProcess.length} líneas.`);
                    }
                }

            } else if (rule.type === 'file') {
                let isMatch = false;
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
                    else {
                        log('WARN', `Subtipo de archivo desconocido "${subtype}" en regla "${rule.name}". Intentando coincidencia por defecto.`);
                        typeMatch = mime.includes('pdf');
                    }

                    log('DEBUG', `Regla de archivo "${rule.name}": Subtipo=${subtype}, Mime=${mime}, MatchTipo=${typeMatch}`);

                    if (typeMatch) {
                        if (trigger === '') {
                            isMatch = true;
                            log('DEBUG', `✅ Regla de archivo "${rule.name}" coincide (disparador vacío).`);
                        } else {
                            const filename = (media.filename || '').toLowerCase();
                            const contentMatch = textContent.toLowerCase().includes(trigger);
                            const nameMatch = filename.includes(trigger);
                            isMatch = contentMatch || nameMatch;
                            log('DEBUG', `Regla de archivo "${rule.name}": Trigger=${trigger}, MatchContenido=${contentMatch}, MatchNombre=${nameMatch}`);
                            if (isMatch) log('DEBUG', `✅ Regla de archivo "${rule.name}" coincide.`);
                        }
                    }
                } else {
                    log('DEBUG', `Regla de archivo "${rule.name}" ignorada: El mensaje no tiene media.`);
                }

                if (isMatch) {
                    matchesToProcess.push({ text: textContent, nss: globalNss, curp: globalCurp, originalMsg: originalMessageBody });
                }
            }

            if (matchesToProcess.length > 0) {
                log('INFO', `🎯 Regla disparada: "${rule.name}" en chat "${chat.name}" (${matchesToProcess.length} coincidencias)`);

                let emailSent = false;
                let waSent = false;
                let processingError = false;

                const uniqueEmailBodies = new Set<string>();
                const uniqueWaBodies = new Set<string>();
                let emailSubject = '';

                // Recopilar todos los cuerpos de mensaje únicos para esta regla
                for (const match of matchesToProcess) {
                    if (rule.emailEnabled) {
                        emailSubject = replacePlaceholders(rule.emailSubject || 'Alerta de Regla: {rule_name}', match.originalMsg, match.nss, match.curp, rule.name);
                        const body = replacePlaceholders(rule.emailBody || 'Se ha detectado una coincidencia con la regla {rule_name}.', match.originalMsg, match.nss, match.curp, rule.name);
                        uniqueEmailBodies.add(body.trim());
                    }
                    if (rule.waEnabled) {
                        const waMsg = replacePlaceholders(rule.waMessage || 'Regla disparada: {rule_name}', match.originalMsg, match.nss, match.curp, rule.name);
                        uniqueWaBodies.add(waMsg.trim());
                    }
                }

                // Process Email Action (Una sola vez por regla)
                if (rule.emailEnabled && uniqueEmailBodies.size > 0) {
                    const combinedBody = Array.from(uniqueEmailBodies).join('\n\n');

                    let attachment = null;
                    if (msg.hasMedia && media) {
                        // Usamos el primer match para el nombre del archivo si tiene placeholders
                        const firstMatch = matchesToProcess[0];
                        let filename = media.filename || `archivo_${Date.now()}.${media.mimetype.split('/')[1] || 'bin'}`;
                        if (rule.emailAttachmentName) {
                            const customName = replacePlaceholders(rule.emailAttachmentName, firstMatch.text, firstMatch.nss, firstMatch.curp, rule.name);
                            const ext = filename.split('.').pop() || 'bin';
                            filename = customName.endsWith(`.${ext}`) ? customName : `${customName}.${ext}`;
                        }
                        attachment = {
                            filename,
                            content: Buffer.from(media.data, 'base64')
                        };
                    }

                    const targets = rule.emailTargets || config.emailDestino;
                    const sent = await queueOrSendEmail(emailSubject, combinedBody, attachment, rule.emailTargets, chatConfig.emailBcc, chatConfig.emailCc, rule.name);
                    if (sent) {
                        emailSent = true;
                        log('INFO', `📧 Acción de correo ejecutada para regla "${rule.name}". Destinatario(s): ${targets}`);
                    } else {
                        processingError = true;
                        log('ERROR', `❌ Falló la acción de correo para regla "${rule.name}".`);
                    }
                }

                // Process WhatsApp Action (Una sola vez por regla)
                if (rule.waEnabled && uniqueWaBodies.size > 0) {
                    const combinedWaMsg = Array.from(uniqueWaBodies).join('\n\n');

                    let waMedia = null;
                    if (msg.hasMedia && media) {
                        const firstMatch = matchesToProcess[0];
                        let customFilename = media.filename;
                        if (rule.waAttachmentName) {
                            const customName = replacePlaceholders(rule.waAttachmentName, firstMatch.text, firstMatch.nss, firstMatch.curp, rule.name);
                            const ext = (media.filename || '').split('.').pop() || 'bin';
                            customFilename = customName.endsWith(`.${ext}`) ? customName : `${customName}.${ext}`;
                        }
                        waMedia = new pkg.MessageMedia(media.mimetype, media.data, customFilename, media.filesize);
                    }

                    const sent = await sendToWhatsAppChats(rule.waTargets, combinedWaMsg, waMedia);
                    if (sent) {
                        waSent = true;
                        log('INFO', `📱 Mensaje de WhatsApp enviado para regla "${rule.name}" a: ${rule.waTargets}`);
                    } else {
                        processingError = true;
                        log('ERROR', `❌ Falló el envío de WhatsApp para regla "${rule.name}".`);
                    }
                }

                if (emailSent || waSent) {
                    didProcessSomething = true;
                    // Registrar en auditoría (usando el primer match como representativo)
                    const firstMatch = matchesToProcess[0];
                    logAudit(chat.name, rule.name, firstMatch.nss, firstMatch.curp, firstMatch.text.substring(0, 200), (emailSent ? 'Email' : '') + (waSent ? ' WA' : ''), msg.timestamp);
                }

                if (processingError) {
                    db.incrementStat('errorsDetected');
                    db.addRecentError({
                        timestamp: new Date().toLocaleString('es-MX', { timeZone: 'America/Mexico_City' }),
                        action_type: rule.name,
                        error: `Fallo en acción de regla: ${rule.name}`
                    });
                }

                if (chatConfig.processingMode === 'simple') {
                    break; // Stop after first rule match
                }
            }
        }

        if (!didProcessSomething && !processingError) {
            log('DEBUG', `Fin de procesamiento: El mensaje no coincidió con ninguna regla en "${chat.name}".`);
        }

        if (!processingError) {
            db.markMessageProcessed(msg.id._serialized);
        } else {
            log('WARN', `Mensaje ${msg.id._serialized} no marcado como procesado debido a errores. Se reintentará en el próximo inicio.`);
        }
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


export async function runValidationSweep(targetDate: string, targetContact?: string, endDate?: string) {
    if (!client || botStatus !== 'running') {
        log('ERROR', 'El bot debe estar en ejecución para realizar un barrido de validación.');
        return { success: false, message: 'El bot no está en ejecución.' };
    }

    const dateMsg = endDate ? `desde ${targetDate} hasta ${endDate}` : `para la fecha: ${targetDate}`;
    log('INFO', `Iniciando barrido de validación ${dateMsg}${targetContact ? ` en el chat: ${targetContact}` : ''}...`);

    // Garantizar que el parche de carga histórica esté activo
    await patchWAWebMessageLoader();

    try {
        log('INFO', 'Obteniendo lista de chats (esto puede demorar unos minutos si hay muchos chats)...');
        const chats = await client.getChats();
        let totalMessagesChecked = 0;
        let totalMissingFound = 0;
        let totalFalsePositives = 0;
        (global as any).sweepRecoveredItems = [];

        const [tYear, tMonth, tDay] = targetDate.split('-').map(Number);
        // Start of the target day
        const startOfDay = new Date(tYear, tMonth - 1, tDay, 0, 0, 0).getTime() / 1000;

        // End of the target day (or end date)
        let endOfDay = startOfDay + 86400;
        if (endDate) {
            const [eYear, eMonth, eDay] = endDate.split('-').map(Number);
            endOfDay = new Date(eYear, eMonth - 1, eDay, 23, 59, 59).getTime() / 1000;
        }

        for (const chat of chats) {
            // Filter by target contact if provided
            if (targetContact && chat.name !== targetContact && chat.name !== targetContact.trim()) {
                continue;
            }

            // Check if this chat is configured for processing
            const chatConfig = config.chatConfigs?.find((c: any) => c && c.targetContact && (chat.name === c.targetContact || chat.name === c.targetContact.trim()));
            if (!chatConfig) continue;
            if (chatConfig.enabled === false) {
                log('INFO', `Saltando chat "${chat.name}" en el barrido porque está desactivado.`);
                continue;
            }

            log('INFO', `Revisando historial del chat "${chat.name}" para validación...`);

            let messages = [];
            let currentLimit = 100;
            let reachedTargetDate = false;
            let consecutiveErrors = 0;
            let lastMessageCount = 0;
            const maxLimit = endDate ? 10000 : 5000;

            while (!reachedTargetDate && currentLimit <= maxLimit) {
                try {
                    const batch = await safeFetchMessages(chat, { limit: currentLimit });
                    messages = batch;

                    if (batch.length === 0 || batch.length === lastMessageCount) {
                        break;
                    }
                    lastMessageCount = batch.length;

                    const oldestMsg = batch[0];
                    if (oldestMsg.timestamp <= startOfDay) {
                        reachedTargetDate = true;
                    } else {
                        const oldestDate = new Date(oldestMsg.timestamp * 1000).toLocaleDateString();
                        log('INFO', `Barrido: Mensaje más antiguo: ${oldestDate}. Aumentando límite a ${currentLimit + 200}...`);
                        currentLimit += 200;
                        await new Promise(resolve => setTimeout(resolve, 1000));
                    }
                    consecutiveErrors = 0;
                } catch (fetchErr: any) {
                    consecutiveErrors++;
                    log('WARN', `Intento fallido de barrido en "${chat.name}" (${consecutiveErrors}/12): ${fetchErr.message || String(fetchErr)}`);
                    if (consecutiveErrors > 12) {
                        log('ERROR', `Demasiados errores al validar chat "${chat.name}". Abortando validación.`);
                        break;
                    }
                    await new Promise(r => setTimeout(r, 5000));
                }
            }

            for (let i = 0; i < messages.length; i++) {
                const msg = messages[i];

                if (i > 0 && i % 500 === 0) {
                    log('INFO', `Barrido en "${chat.name}": Analizados ${i}/${messages.length} mensajes...`);
                }

                // Only process messages within the target date
                if (msg.timestamp >= startOfDay && msg.timestamp <= endOfDay) {
                    totalMessagesChecked++;

                    // Check direction rules
                    const direction = chatConfig.messageDirection || 'both';
                    if (direction === 'received' && msg.fromMe) continue;
                    if (direction === 'sent' && !msg.fromMe) continue;

                    const isMarkedProcessed = db.isMessageProcessed(msg.id._serialized);

                    // We need to re-evaluate the message to see if it SHOULD have been processed
                    let shouldBeProcessed = false;

                    const rules = chatConfig.rules || [];
                    if (rules.length > 0) {
                        if (msg.hasMedia) {
                            shouldBeProcessed = true; // Simplified: assume all media in configured chats should be processed
                        } else if (msg.body) {
                            // Check text rules
                            const fullText = msg.body.trim().toLowerCase();
                            const lines = msg.body.split('\n').map(l => l.trim().toLowerCase());

                            for (const rule of rules) {
                                if (rule.enabled === false) continue;
                                if (rule.type === 'text') {
                                    const trigger = (rule.triggerValue || '').trim().toLowerCase();
                                    if (!trigger) continue;

                                    if (rule.subtype === 'exact' && fullText === trigger) { shouldBeProcessed = true; break; }
                                    if (rule.subtype === 'contains' && fullText.includes(trigger)) { shouldBeProcessed = true; break; }
                                    if (rule.subtype === 'regex') {
                                        try { const re = new RegExp(trigger, 'i'); if (re.test(fullText)) { shouldBeProcessed = true; break; } } catch(e) {}
                                    }

                                    if (!shouldBeProcessed) {
                                        for (const line of lines) {
                                            if (rule.subtype === 'exact' && line === trigger) { shouldBeProcessed = true; break; }
                                            if (rule.subtype === 'contains' && line.includes(trigger)) { shouldBeProcessed = true; break; }
                                            if (rule.subtype === 'regex') {
                                                try { const re = new RegExp(trigger, 'i'); if (re.test(line)) { shouldBeProcessed = true; break; } } catch(e) {}
                                            }
                                        }
                                    }
                                    if (shouldBeProcessed) break;
                                }
                            }
                        }
                    }

                    if (shouldBeProcessed && !isMarkedProcessed) {
                        // Found a missing message!
                        log('WARN', `Barrido: Se encontró un mensaje no procesado en ${chat.name} del ${new Date(msg.timestamp * 1000).toLocaleString('es-MX', { timeZone: 'America/Mexico_City' })}`);
                        totalMissingFound++;

                        // Process it now, marking it as a sweep execution
                        // We temporarily set a flag to indicate this is a sweep execution
                        (global as any).isValidationSweep = true;
                        (global as any).sweepMessageId = msg.id._serialized;
                        await processMessage(msg);
                        (global as any).isValidationSweep = false;
                        (global as any).sweepMessageId = null;

                    } else if (!shouldBeProcessed && isMarkedProcessed) {
                        // False positive (marked as processed but shouldn't have been)
                        // This is harder to definitively prove without full context, but we log it
                        log('DEBUG', `Barrido: Posible falso positivo detectado en ${chat.name} (marcado como procesado pero no coincide con reglas actuales).`);
                        totalFalsePositives++;
                    }
                }
            }
        }

        const emailQueue = db.getEmailQueue();
        const pendingEmails = emailQueue.length;
        const recoveredItems = (global as any).sweepRecoveredItems || [];
        (global as any).sweepRecoveredItems = null;

        log('INFO', `Barrido de validación completado. Mensajes revisados: ${totalMessagesChecked}, Faltantes procesados: ${totalMissingFound}, Posibles falsos positivos: ${totalFalsePositives}, Correos en cola sin enviar: ${pendingEmails}`);

        // Trigger email queue processing immediately
        processEmailQueue();

        return {
            success: true,
            message: `Barrido completado. Revisados: ${totalMessagesChecked}, Recuperados: ${totalMissingFound}, En cola: ${pendingEmails}`,
            stats: {
                checked: totalMessagesChecked,
                recovered: totalMissingFound,
                falsePositives: totalFalsePositives,
                pendingEmails: pendingEmails,
                recoveredItems: recoveredItems
            }
        };

    } catch (err: any) {
        log('ERROR', `Error durante el barrido de validación: ${err.message}`);
        return { success: false, message: `Error: ${err.message}` };
    }
}

export async function stopBot() {
    if (!client) {
        botStatus = 'stopped';
        currentQrCode = null;
        log('WARN', 'El bot ya está detenido.');
        return;
    }
    log('INFO', 'Deteniendo el bot de WhatsApp...');
    try {
        const oldClient = client;
        // Limpiar el watcher de popups si está activo
        if ((oldClient as any).__popupWatcher) {
            clearInterval((oldClient as any).__popupWatcher);
        }
        client = null;
        botStatus = 'stopped';
        currentQrCode = null;
        oldClient.destroy().catch((err: any) => {
            log('ERROR', `Error al destruir el cliente: ${err.message}`);
        });
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
            const tempPath = path.join(tempDir, `${Date.now()}_${attachment.filename.replace(/[:\\/*?"<>|]/g, '_')}`);
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
        return await sendEmail(subject, text, attachment ? [attachment] : null, customTargets, bcc, cc, false, caseType);
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

    const successfullySentKeys: string[] = [];

    for (const key in groups) {
        const items = groups[key];
        const first = items[0];

        // Buscar la configuración de la regla
        let ruleConfig: any = null;
        for (const chat of config.chatConfigs || []) {
            const rule = chat.rules?.find((r: any) => r.name === first.caseType);
            if (rule) {
                ruleConfig = rule;
                break;
            }
        }

        let subjectTemplate = ruleConfig?.emailSubjectGrouped || '[Sendify PRO Lote] {count} reportes de {rule_name}';
        let bodyTemplate = ruleConfig?.emailBodyGrouped || 'Se han procesado {count} coincidencias para la regla {rule_name}:\n\n{grouped_content}';

        const subject = subjectTemplate
            .replace(/{count}/g, items.length.toString())
            .replace(/{rule_name}/g, first.caseType);

        const uniqueBodies = new Set<string>();
        const attachments: { filename: string, content: Buffer }[] = [];
        const addedAttachmentPaths = new Set<string>();

        items.forEach((item) => {
            if (item.body) {
                uniqueBodies.add(item.body.trim());
            }

            if (item.attachment && fs.existsSync(item.attachment.path)) {
                if (!addedAttachmentPaths.has(item.attachment.path)) {
                    attachments.push({
                        filename: item.attachment.filename,
                        content: fs.readFileSync(item.attachment.path)
                    });
                    addedAttachmentPaths.add(item.attachment.path);
                }
            }
        });

        const combinedBody = Array.from(uniqueBodies).join('\n\n');
        const finalBody = bodyTemplate
            .replace(/{count}/g, items.length.toString())
            .replace(/{rule_name}/g, first.caseType)
            .replace(/{grouped_content}/g, combinedBody);

        const sent = await sendEmail(subject, finalBody, attachments.length > 0 ? attachments : null, first.to, first.bcc, first.cc, true, first.caseType);
        if (sent) {
            log('INFO', `✅ Lote de ${items.length} correos enviado a ${first.to}`);
            successfullySentKeys.push(key);
        } else {
            log('ERROR', `❌ Error enviando lote a ${first.to}`);
            db.incrementStat('errorsDetected');
            db.addRecentError({
                timestamp: new Date().toLocaleString('es-MX', { timeZone: 'America/Mexico_City' }),
                action_type: 'Envío de Lote',
                error: `Fallo al enviar lote de ${items.length} correos a ${first.to}`
            });
        }
    }

    // Clear queue and delete temp files ONLY for successfully sent items
    emailQueue.forEach(item => {
        const key = `${item.to}_${item.cc}_${item.bcc}_${item.caseType}`;
        if (successfullySentKeys.includes(key)) {
            if (item.attachment && item.attachment.path && fs.existsSync(item.attachment.path)) {
                try { fs.unlinkSync(item.attachment.path); } catch (e) {}
            }
            db.removeFromEmailQueue(item.id);
        }
    });
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

async function sendEmail(subject: string, text: string, attachments: { filename: string, content: Buffer }[] | null, customTargets?: string, bcc?: string, cc?: string, isBatch: boolean = false, ruleName: string = 'General') {
    if (!config.emailUser || !config.emailPass) {
        log('ERROR', 'Faltan credenciales de correo en la configuración.');
        return false;
    }

    // Check email limits
    const today = new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Mexico_City' }).format(new Date());
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
            requireTLS: config.smtpPort !== 465,
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

        // Clear last error if successful
        db.setMetadata('last_email_error', '');

        // Increment total emails sent
        db.incrementStat('emailsSent');

        // Increment daily counter for ALL emails sent (batch or individual)
        db.incrementEmailSentToday();
        // Re-fetch config to get the updated value
        config = db.getConfig() || config;

        // Add to recent emails
        db.addRecentEmail({
            time: new Date().toISOString(),
            subject: subject,
            attachments: attachments ? attachments.length : 0,
            rule: ruleName
        });

        log('INFO', `✅ Correo enviado exitosamente a ${targets.join(', ')}. (${config.emailsSentToday}/${limit} hoy)`);

        return true;
    } catch (err: any) {
        const errorMsg = `Error SMTP: ${err.message}`;
        log('ERROR', errorMsg);
        db.setMetadata('last_email_error', errorMsg);
        db.addRecentError({
            timestamp: new Date().toLocaleString('es-MX', { timeZone: 'America/Mexico_City' }),
            action_type: 'SMTP Error',
            error: errorMsg
        });
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
                log('INFO', `📱 Reenviando mensaje a: "${name}"...`);
                log('DEBUG', `Contenido del mensaje a enviar a "${name}": "${message}"`);
                if (media) {
                    await chat.sendMessage(media, { caption: message, sendMediaAsDocument: true });
                } else {
                    await chat.sendMessage(message);
                }
                sentCount++;
                log('INFO', `✅ Mensaje reenviado exitosamente a: "${name}"`);
            } else {
                log('WARN', `❌ Chat destino no encontrado para reenvío: "${name}"`);
            }
        }

        return sentCount > 0;
    } catch (err: any) {
        log('ERROR', `Error al reenviar mensaje por WhatsApp: ${err.message}`);
        return false;
    }
}

// Función para generar un CSV personalizado basado en una plantilla desde SQLite
export function generateCustomCsvFromDb(columns: string[], timeRange: string | {start: string, end: string} = 'today', rules?: string[], splitByRule?: boolean): { content: string | Buffer, count: number, isXlsx: boolean } | null {
    const logs = db.getAuditLogs(10000); // Get last 10k logs for the report
    if (logs.length === 0) return null;

    let start = new Date();
    let end = new Date();

    if (typeof timeRange === 'object' && timeRange !== null) {
        // Parse custom dates (assuming YYYY-MM-DD)
        const [startYear, startMonth, startDay] = timeRange.start.split('-').map(Number);
        const [endYear, endMonth, endDay] = timeRange.end.split('-').map(Number);
        start = new Date(startYear, startMonth - 1, startDay, 0, 0, 0, 0);
        end = new Date(endYear, endMonth - 1, endDay, 23, 59, 59, 999);
    } else {
        switch (timeRange) {
            case 'today':
                start.setHours(0, 0, 0, 0);
                end.setHours(23, 59, 59, 999);
                break;
            case 'yesterday':
                start.setDate(start.getDate() - 1);
                start.setHours(0, 0, 0, 0);
                end.setDate(end.getDate() - 1);
                end.setHours(23, 59, 59, 999);
                break;
            case 'this_week':
                const day = start.getDay();
                const diff = start.getDate() - day + (day === 0 ? -6 : 1); // adjust when day is sunday
                start.setDate(diff);
                start.setHours(0, 0, 0, 0);
                end.setHours(23, 59, 59, 999);
                break;
            case 'last_week':
                const lastWeekDay = start.getDay();
                const lastWeekDiff = start.getDate() - lastWeekDay + (lastWeekDay === 0 ? -6 : 1) - 7;
                start.setDate(lastWeekDiff);
                start.setHours(0, 0, 0, 0);
                end = new Date(start);
                end.setDate(end.getDate() + 6);
                end.setHours(23, 59, 59, 999);
                break;
            case 'this_month':
                start.setDate(1);
                start.setHours(0, 0, 0, 0);
                end.setHours(23, 59, 59, 999);
                break;
            case 'last_month':
                start.setMonth(start.getMonth() - 1);
                start.setDate(1);
                start.setHours(0, 0, 0, 0);
                end = new Date(start);
                end.setMonth(end.getMonth() + 1);
                end.setDate(0);
                end.setHours(23, 59, 59, 999);
                break;
            default:
                start.setHours(0, 0, 0, 0);
                end.setHours(23, 59, 59, 999);
        }
    }

    const filteredLogs = logs.filter((log: any) => {
        if (rules && rules.length > 0 && !rules.includes(log.action_type)) {
            return false;
        }

        let logDate;
        try {
            // log.timestamp is usually "DD/MM/YYYY, HH:mm:ss" or "DD/MM/YYYY, HH:mm:ss a.m."
            const parts = log.timestamp.split(/[, ]+/);
            const dateParts = parts[0].split('/');
            if (dateParts.length === 3) {
                let hours = parts[1] ? parseInt(parts[1].split(':')[0]) : 0;
                const isPM = parts[2] && parts[2].toLowerCase().includes('p');
                const isAM = parts[2] && parts[2].toLowerCase().includes('a');
                if (isPM && hours < 12) hours += 12;
                if (isAM && hours === 12) hours = 0;

                // Parse as local time, not UTC
                logDate = new Date(
                    parseInt(dateParts[2]),
                    parseInt(dateParts[1]) - 1,
                    parseInt(dateParts[0]),
                    hours,
                    parts[1] ? parseInt(parts[1].split(':')[1]) : 0,
                    parts[1] ? parseInt(parts[1].split(':')[2]) : 0
                );
            } else {
                logDate = new Date(log.timestamp);
            }
        } catch (e) {
            logDate = new Date(log.timestamp);
        }

        if (isNaN(logDate.getTime())) return false;
        return logDate >= start && logDate <= end;
    });

    if (filteredLogs.length === 0) return null;

    const mapLogToRow = (log: any) => {
        return columns.map(col => {
            let val = '';
            const colLower = col.toLowerCase();

            const timestampParts = (log.timestamp || '').split(', ');

            if (colLower === 'date' || colLower === 'timestamp' || colLower === 'fecha') val = timestampParts[0] || '';
            else if (colLower === 'time' || colLower === 'hora') val = timestampParts[1] || '';
            else if (colLower === 'contact' || colLower === 'conversacion' || colLower === 'conversación') val = log.phone_number || '';
            else if (colLower === 'status' && !columns.some(c => c.toLowerCase() === 'regla')) val = log.action_type || ''; // Fallback for old templates
            else if (colLower === 'regla' || colLower === 'accion' || colLower === 'acción') val = log.action_type || '';
            else if (colLower === 'nss') val = log.nss || '';
            else if (colLower === 'curp') val = log.curp || '';
            else if (colLower === 'message' || colLower === 'mensaje') val = log.message || '';
            else if (colLower === 'error' || (colLower === 'status' && columns.some(c => c.toLowerCase() === 'regla'))) {
                val = log.error || '';
                if (val.toLowerCase() === 'email') {
                    val = 'enviado por Email';
                }
            }
            else if (colLower === 'execution_type' || colLower === 'ejecucion' || colLower === 'ejecución') val = log.execution_type || 'Tiempo real';

            return val;
        });
    };

    if (splitByRule) {
        const wb = XLSX.utils.book_new();
        const rulesPresent = Array.from(new Set(filteredLogs.map((l: any) => l.action_type)));

        rulesPresent.forEach((ruleName: string) => {
            const ruleLogs = filteredLogs.filter((l: any) => l.action_type === ruleName);
            const rows = ruleLogs.map(mapLogToRow);
            // Add header row
            rows.unshift(columns);
            const ws = XLSX.utils.aoa_to_sheet(rows);

            let safeSheetName = ruleName.replace(/[\\/?*\[\]]/g, '').substring(0, 31);
            if (!safeSheetName) safeSheetName = 'Sheet';

            XLSX.utils.book_append_sheet(wb, ws, safeSheetName);
        });

        const buffer = XLSX.write(wb, { type: 'buffer', bookType: 'xlsx' });
        return {
            content: buffer,
            count: filteredLogs.length,
            isXlsx: true
        };
    } else {
        const header = columns.join(',');
        const rows = filteredLogs.map((log: any) => {
            return mapLogToRow(log).map(val => `"${val.replace(/"/g, '""')}"`).join(',');
        });

        return {
            content: '\uFEFF' + header + '\n' + rows.join('\n'),
            count: filteredLogs.length,
            isXlsx: false
        };
    }
}

// Programar tareas para reportes y plantillas personalizadas
setInterval(async () => {
    const nowStr = new Date().toLocaleString('en-US', { timeZone: 'America/Mexico_City', hour12: false, hour: '2-digit', minute: '2-digit' });
    // nowStr might be "24:00" instead of "00:00" in some environments, so let's parse it safely
    const timeStr = nowStr.replace('24:', '00:');
    const now = new Date(new Date().toLocaleString('en-US', { timeZone: 'America/Mexico_City' }));
    const dateStr = getLocalDateStr();

    // 1. Reporte Global (Email)
    const emailSchedule = config.auditEmailSchedule || '23:59';
    if (config.auditActionEmailEnabled && config.auditEmailTargets && emailSchedule === timeStr && (global as any).lastAuditRunGlobalEmail !== `${dateStr}_${timeStr}`) {
        (global as any).lastAuditRunGlobalEmail = `${dateStr}_${timeStr}`;
        log('INFO', 'Iniciando tarea programada: Envío de reporte de auditoría diario (Global Email)...');

        const columns = ['Timestamp', 'Hora', 'Conversacion', 'Regla', 'NSS', 'CURP', 'Mensaje', 'Status', 'Ejecución'];
        const csvResult = generateCustomCsvFromDb(columns);

        if (csvResult) {
            try {
                const csvBuffer = Buffer.from(csvResult.content);
                const subject = `Reporte de Auditoría WhatsApp Bot (Email) - ${dateStr}`;
                const text = `Adjunto el reporte de auditoría global de los eventos procesados el día de hoy (${dateStr}). Total de registros: ${csvResult.count}`;
                await sendEmail(subject, text, [{ filename: `audit_global_${dateStr}.csv`, content: csvBuffer }], config.auditEmailTargets);
            } catch (err: any) {
                log('ERROR', `Error en reporte diario global Email: ${err.message}`);
            }
        }
    }

    // 2. Reporte Global (WhatsApp)
    const waSchedule = config.auditWaSchedule || '23:59';
    if (config.auditActionWaEnabled && config.auditWaTargets && waSchedule === timeStr && (global as any).lastAuditRunGlobalWa !== `${dateStr}_${timeStr}`) {
        (global as any).lastAuditRunGlobalWa = `${dateStr}_${timeStr}`;
        log('INFO', 'Iniciando tarea programada: Envío de reporte de auditoría diario (Global WhatsApp)...');

        const columns = ['Timestamp', 'Hora', 'Conversacion', 'Regla', 'NSS', 'CURP', 'Mensaje', 'Status', 'Ejecución'];
        const csvResult = generateCustomCsvFromDb(columns);

        if (csvResult) {
            try {
                const csvBuffer = Buffer.from(csvResult.content);
                const subject = `Reporte de Auditoría WhatsApp Bot (WhatsApp) - ${dateStr}\nTotal de registros: ${csvResult.count}`;
                const { MessageMedia } = pkg;
                const media = new MessageMedia('text/csv', csvBuffer.toString('base64'), `audit_global_${dateStr}.csv`);
                await sendToWhatsAppChats(config.auditWaTargets, subject, media);
            } catch (err: any) {
                log('ERROR', `Error en reporte diario global WhatsApp: ${err.message}`);
            }
        }
    }

    // 3. Plantillas Personalizadas
    if (config.auditTemplates) {
        config.auditTemplates.forEach(async (template: any) => {
            if (template.schedule === timeStr && (global as any).lastAuditRun !== `${template.id}_${dateStr}_${timeStr}`) {

                const freq = template.frequency || 'daily';
                let shouldRun = false;
                const dayOfWeek = now.getDay();
                const dayOfMonth = now.getDate();

                if (freq === 'daily') {
                    shouldRun = true;
                } else if (freq === 'weekly' && dayOfWeek === 1) { // Lunes
                    shouldRun = true;
                } else if (freq === 'monthly' && dayOfMonth === 1) { // Día 1 del mes
                    shouldRun = true;
                }

                if (!shouldRun) return;

                (global as any).lastAuditRun = `${template.id}_${dateStr}_${timeStr}`;

                log('INFO', `Iniciando tarea programada para plantilla: "${template.name}"`);

                const csvResult = generateCustomCsvFromDb(template.columns, template.timeRange || 'today', template.rules, template.splitByRule);
                if (!csvResult) {
                    log('INFO', `No hay datos para la plantilla "${template.name}" en el rango de tiempo especificado.`);
                    return;
                }

                const fileBuffer = Buffer.isBuffer(csvResult.content) ? csvResult.content : Buffer.from(csvResult.content);
                const fileExtension = csvResult.isXlsx ? 'xlsx' : 'csv';
                const mimeType = csvResult.isXlsx ? 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' : 'text/csv';

                const replaceVars = (str: string) => {
                    return str
                        .replace(/{count}/g, csvResult.count.toString())
                        .replace(/{date}/g, dateStr)
                        .replace(/{template_name}/g, template.name);
                };

                const emailSubject = template.emailSubject ? replaceVars(template.emailSubject) : `Reporte: ${template.name} - ${dateStr}`;
                const emailBody = template.emailBody ? replaceVars(template.emailBody) : `Adjunto el reporte personalizado "${template.name}" generado automáticamente.\nTotal de registros: ${csvResult.count}`;
                const waMessage = template.waMessage ? replaceVars(template.waMessage) : `Reporte: ${template.name} - ${dateStr}\nTotal de registros: ${csvResult.count}`;

                if (template.emailEnabled && template.emailTargets) {
                    await sendEmail(emailSubject, emailBody, [{ filename: `reporte_${template.name.replace(/\s+/g, '_')}_${dateStr}.${fileExtension}`, content: fileBuffer }], template.emailTargets);
                }

                if (template.waEnabled && template.waTargets) {
                    const { MessageMedia } = pkg;
                    const media = new MessageMedia(mimeType, fileBuffer.toString('base64'), `reporte_${template.name.replace(/\s+/g, '_')}_${dateStr}.${fileExtension}`);
                    await sendToWhatsAppChats(template.waTargets, waMessage, media);
                }
            }
        });
    }

    // 4. Barrido de Validación (Sweep)
    if (config.validationSweepEnabled && config.validationSweepTime === timeStr) {
        const sweepKey = `${dateStr}_${timeStr}_sweep`;
        if ((global as any).lastValidationSweep !== sweepKey) {
            // Check frequency
            const freq = config.validationSweepFrequency || 'daily';
            let shouldRunSweep = false;
            const dayOfWeek = now.getDay(); // 0 = Sunday, 1 = Monday
            const dayOfMonth = now.getDate();

            if (freq === 'daily') {
                shouldRunSweep = true;
            } else if (freq === 'weekly' && dayOfWeek === 1) { // Run on Mondays
                shouldRunSweep = true;
            } else if (freq === 'monthly' && dayOfMonth === 1) { // Run on 1st of month
                shouldRunSweep = true;
            }

            if (shouldRunSweep) {
                (global as any).lastValidationSweep = sweepKey;
                log('INFO', `Iniciando tarea programada: Barrido de Validación (${freq})...`);

                let targetDate = new Date().toISOString().split('T')[0];
                let endDate: string | undefined = undefined;

                if (freq === 'weekly') {
                    const lastWeek = new Date();
                    lastWeek.setDate(lastWeek.getDate() - 7);
                    targetDate = lastWeek.toISOString().split('T')[0];
                    endDate = new Date().toISOString().split('T')[0];
                } else if (freq === 'monthly') {
                    const lastMonth = new Date();
                    lastMonth.setMonth(lastMonth.getMonth() - 1);
                    targetDate = lastMonth.toISOString().split('T')[0];
                    endDate = new Date().toISOString().split('T')[0];
                }

                try {
                    const result = await runValidationSweep(targetDate, undefined, endDate);

                    if (config.validationSweepEmailTargets) {
                        const subject = `Reporte de Barrido de Validación - ${dateStr}`;
                        let text = `El barrido de validación automático (${freq}) ha finalizado.\n\n`;
                        text += `Resultados:\n`;
                        text += `- Mensajes revisados: ${result.stats?.checked || 0}\n`;
                        text += `- Faltantes recuperados y procesados: ${result.stats?.recovered || 0}\n`;
                        text += `- Posibles falsos positivos: ${result.stats?.falsePositives || 0}\n`;
                        text += `- Correos en cola sin enviar: ${result.stats?.pendingEmails || 0}\n\n`;

                        if (result.stats?.recoveredItems && result.stats.recoveredItems.length > 0) {
                            text += `Detalle de elementos recuperados:\n`;
                            result.stats.recoveredItems.forEach((item: any, i: number) => {
                                text += `  ${i + 1}. Regla: ${item.rule} | NSS: ${item.nss || 'N/A'} | CURP: ${item.curp || 'N/A'}\n`;
                            });
                            text += `\n`;
                        }

                        text += `Los elementos recuperados han sido procesados y registrados en la auditoría con el tipo de ejecución "Barrido".`;

                        await sendEmail(subject, text, null, config.validationSweepEmailTargets);
                    }
                } catch (err: any) {
                    log('ERROR', `Error en barrido de validación programado: ${err.message}`);
                }
            }
        }
    }

    // 5. Encendido/Apagado Automático
    if (config.autoPowerEnabled) {
        if (config.autoPowerOffTime === timeStr && (global as any).lastPowerAction !== `off_${dateStr}_${timeStr}`) {
            (global as any).lastPowerAction = `off_${dateStr}_${timeStr}`;
            log('INFO', 'Hora de apagado automático alcanzada. Deteniendo el bot...');
            stopBot();
        }

        if (config.autoPowerOnTime === timeStr && (global as any).lastPowerAction !== `on_${dateStr}_${timeStr}`) {
            (global as any).lastPowerAction = `on_${dateStr}_${timeStr}`;
            log('INFO', 'Hora de encendido automático alcanzada. Iniciando el bot...');
            startBot();
        }
    }

}, 60000); // Revisar cada minuto

// Reiniciar estadísticas diarias a medianoche
cron.schedule('0 0 * * *', () => {
    log('INFO', 'Ejecutando reinicio de estadísticas diarias...');
    db.resetDailyStats();
}, {
    timezone: "America/Mexico_City"
});