import express from "express";
import { createServer as createViteServer } from "vite";
import path from "path";
import fs from "fs";
import { exec, execSync } from "child_process";
import axios from "axios";
import AdmZip from "adm-zip";
import os from "os";
import { startBot, stopBot, botStatus, currentQrCode, logs, getStats, getConfig, saveConfig, generateCustomCsvFromDb } from "./bot.js";
import * as db from "./db.js";

// Global error handlers to prevent server crashes
process.on('uncaughtException', (err) => {
  console.error('[CRITICAL] Uncaught Exception:', err);
  // We don't exit the process to keep the server running
});

process.on('unhandledRejection', (reason, promise) => {
  console.error('[CRITICAL] Unhandled Rejection at:', promise, 'reason:', reason);
  // We don't exit the process to keep the server running
});

async function startServer() {
  const app = express();
  const PORT = 3000;

  app.use(express.json());

  // Logging middleware
  app.use((req, res, next) => {
    console.log(`[${new Date().toISOString()}] ${req.method} ${req.url}`);
    next();
  });

  // Health Check
  app.get("/api/health", (req, res) => {
    res.json({ status: "ok", time: new Date().toISOString() });
  });

  // API Routes
  app.get("/api/status", (req, res) => {
    let version = "8.7.0";
    try {
      const packageJson = JSON.parse(fs.readFileSync(path.join(process.cwd(), 'package.json'), 'utf-8'));
      if (packageJson.version) version = packageJson.version;
      
      // Auto-versioning based on processed messages to show activity
      const stats = getStats();
      const buildNumber = (stats.processedPdfs || 0) + (stats.emailsSent || 0);
      version = `${version} (Build ${buildNumber})`;
    } catch (e) {}

    try {
      res.json({
        status: botStatus, // 'stopped', 'starting', 'awaiting_qr', 'running', 'error'
        qrCode: currentQrCode,
        stats: (() => {
          try {
            return getStats();
          } catch (e) {
            console.error("Error in getStats:", e);
            return { processedPdfs: 0, emailsSent: 0, errorsDetected: 0, recentFiles: [], recentEvents: [], lastEmailError: '', lastProcessedFile: 'Ninguno' };
          }
        })(),
        version: version,
        system: {
          cpuLoad: os.loadavg(),
          totalMem: os.totalmem(),
          freeMem: os.freemem(),
          uptime: os.uptime(),
          platform: os.platform(),
          arch: os.arch()
        },
        emailQueue: db.getEmailQueue()
      });
    } catch (e: any) {
      console.error("Error in res.json:", e);
      res.status(500).json({ error: "Internal Server Error", details: e.message });
    }
  });

  app.get("/api/logs", (req, res) => {
    res.json(logs);
  });

  app.get("/api/settings", (req, res) => {
    res.json(getConfig());
  });

  app.post("/api/settings", (req, res) => {
    saveConfig(req.body);
    res.json({ success: true, message: "Configuración guardada." });
  });

  app.post("/api/bot/start", async (req, res) => {
    startBot();
    res.json({ success: true, message: "Iniciando bot..." });
  });

  app.post("/api/bot/stop", async (req, res) => {
    await stopBot();
    res.json({ success: true, message: "Deteniendo bot..." });
  });

  app.post("/api/bot/sweep", async (req, res) => {
    const { targetDate, targetContact, endDate } = req.body;
    if (!targetDate) {
      return res.status(400).json({ success: false, message: "La fecha objetivo es requerida." });
    }
    
    // We import runValidationSweep dynamically to avoid circular dependencies if any
    const { runValidationSweep } = await import('./bot.js');
    const result = await runValidationSweep(targetDate, targetContact, endDate);
    res.json(result);
  });

  app.post("/api/bot/clear-cache", (req, res) => {
    db.clearProcessedMessagesCache();
    res.json({ success: true, message: "Caché de mensajes procesados borrada." });
  });

  app.post("/api/bot/logout", async (req, res) => {
    await stopBot();
    const sessionPath = path.join(process.cwd(), 'bot_data', 'session');
    if (fs.existsSync(sessionPath)) {
      try {
        fs.rmSync(sessionPath, { recursive: true, force: true });
        console.log("Sesión eliminada correctamente.");
      } catch (e) {
        console.error("Error al eliminar la sesión:", e);
      }
    }
    res.json({ success: true, message: "Sesión eliminada. Escanea el QR nuevamente." });
  });

  // Audit API Routes
  app.get("/api/audit/list", (req, res) => {
    try {
      const logs = db.getAuditLogs(500);
      res.json(logs);
    } catch (e) {
      res.status(500).json({ error: "Error al obtener logs de auditoría" });
    }
  });

  app.delete("/api/audit/clear", (req, res) => {
    try {
      db.clearAuditLogs();
      res.json({ success: true, message: "Historial de auditoría limpiado correctamente" });
    } catch (e) {
      res.status(500).json({ error: "Error al limpiar el historial de auditoría" });
    }
  });

  app.delete("/api/stats/reset", (req, res) => {
    try {
      db.resetAllMetrics();
      res.json({ success: true, message: "Métricas reiniciadas y cola vaciada correctamente" });
    } catch (e) {
      res.status(500).json({ error: "Error al reiniciar las métricas" });
    }
  });

  app.get("/api/audit/stats", (req, res) => {
    try {
      const { startDate, endDate } = req.query;
      const logs = db.getAuditLogs(10000); // Obtener todos los logs para filtrar
      
      let filteredLogs = logs;
      if (startDate && endDate) {
        filteredLogs = logs.filter((log: any) => {
          let logDateStr = '';
          try {
            const parts = log.timestamp.split(/[, ]+/);
            const dateParts = parts[0].split('/');
            if (dateParts.length === 3) {
              const year = dateParts[2];
              const month = dateParts[1].padStart(2, '0');
              const day = dateParts[0].padStart(2, '0');
              logDateStr = `${year}-${month}-${day}`;
            } else {
              logDateStr = log.timestamp.split('T')[0];
            }
          } catch (e) {
            logDateStr = log.timestamp;
          }
          
          return logDateStr >= startDate && logDateStr <= endDate;
        });
      }

      const stats = {
        total: filteredLogs.length,
        email: filteredLogs.filter((l: any) => l.error && l.error.includes('Email')).length,
        whatsapp: filteredLogs.filter((l: any) => l.error && l.error.includes('WA')).length,
      };
      
      res.json(stats);
    } catch (e) {
      res.status(500).json({ error: "Error al calcular estadísticas" });
    }
  });

  app.get("/api/audit/export", (req, res) => {
    try {
      const { startDate, endDate } = req.query;
      let logs = db.getAuditLogs(10000);
      
      if (startDate && endDate) {
        // Parse dates assuming they are in Mexico City timezone
        const startStr = `${startDate}T00:00:00`;
        const endStr = `${endDate}T23:59:59`;
        
        // We will do string comparison on the date part of the timestamp to avoid timezone shifts
        logs = logs.filter((log: any) => {
          let logDateStr = '';
          try {
            const parts = log.timestamp.split(/[, ]+/);
            const dateParts = parts[0].split('/');
            if (dateParts.length === 3) {
              const year = dateParts[2];
              const month = dateParts[1].padStart(2, '0');
              const day = dateParts[0].padStart(2, '0');
              logDateStr = `${year}-${month}-${day}`;
            } else {
              logDateStr = log.timestamp.split('T')[0];
            }
          } catch (e) {
            logDateStr = log.timestamp;
          }
          
          return logDateStr >= startDate && logDateStr <= endDate;
        });
      }

      // Add UTF-8 BOM to fix encoding issues in Excel
      let csv = "\uFEFFID,Timestamp,Hora,Conversacion,Regla,NSS,CURP,Mensaje,Status,Ejecución,Fecha/Hora Procesamiento\n";
      
      logs.forEach((log: any) => {
        const timestampParts = (log.timestamp || '').split(', ');
        const datePart = timestampParts[0] || '';
        const timePart = timestampParts[1] || '';
        
        let status = log.error || '';
        if (status.toLowerCase() === 'email') {
          status = 'enviado por Email';
        }

        const row = [
          log.id,
          `"${datePart}"`,
          `"${timePart}"`,
          `"${(log.phone_number || '').replace(/"/g, '""')}"`,
          `"${(log.action_type || '').replace(/"/g, '""')}"`,
          `"${(log.nss || '').replace(/"/g, '""')}"`,
          `"${(log.curp || '').replace(/"/g, '""')}"`,
          `"${(log.message || '').replace(/"/g, '""')}"`,
          `"${status.replace(/"/g, '""')}"`,
          `"${(log.execution_type || 'Tiempo real').replace(/"/g, '""')}"`,
          `"${(log.processing_timestamp || log.timestamp || '').replace(/"/g, '""')}"`
        ].join(',');
        csv += row + "\n";
      });

      res.setHeader('Content-Type', 'text/csv; charset=utf-8');
      res.setHeader('Content-Disposition', 'attachment; filename=audit_export.csv');
      res.send(csv);
    } catch (e) {
      res.status(500).send("Error al exportar auditoría");
    }
  });

  app.post("/api/audit/export-template", (req, res) => {
    try {
      const { template, startDate, endDate } = req.body;
      if (!template || !template.columns) {
        return res.status(400).json({ error: "Plantilla inválida" });
      }

      const timeRange = (startDate && endDate) ? { start: startDate, end: endDate } : (template.timeRange || 'today');
      
      const csvResult = generateCustomCsvFromDb(
        template.columns,
        timeRange,
        template.rules,
        template.splitByRule
      );

      if (!csvResult) {
        return res.status(404).json({ error: "No hay datos para el rango seleccionado" });
      }

      const fileExtension = csvResult.isXlsx ? 'xlsx' : 'csv';
      const mimeType = csvResult.isXlsx ? 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' : 'text/csv; charset=utf-8';
      const filename = `reporte_${template.name.replace(/[^a-z0-9]/gi, '_').toLowerCase()}_${startDate || 'export'}.${fileExtension}`;

      res.setHeader('Content-Type', mimeType);
      res.setHeader('Content-Disposition', `attachment; filename=${filename}`);
      res.send(csvResult.content);
    } catch (e) {
      console.error("Error exporting template:", e);
      res.status(500).json({ error: "Error al exportar plantilla" });
    }
  });

  app.get("/api/audit/download/:filename", (req, res) => {
    const filename = req.params.filename;
    
    // Basic security check
    if (!filename.startsWith('audit_') || !filename.endsWith('.csv') || filename.includes('..')) {
      return res.status(400).send("Archivo inválido");
    }

    const filepath = path.join(process.cwd(), 'bot_data', filename);
    
    if (!fs.existsSync(filepath)) {
      return res.status(404).send("Archivo no encontrado");
    }

    res.download(filepath);
  });

  // GitHub Update API Routes
  app.get("/api/update/check", async (req, res) => {
    try {
      const config = getConfig();
      let repo = config.githubRepo;
      
      // Clean up repo string if user pasted full URL
      if (repo && repo.includes('github.com/')) {
        repo = repo.split('github.com/')[1].replace('.git', '');
      }
      
      const branch = config.githubBranch || "main";
      const token = config.githubToken;

      if (!repo) {
        return res.status(400).json({ error: "Repositorio no configurado." });
      }

      const headers: any = {
        "Accept": "application/vnd.github.v3+json"
      };
      if (token) {
        headers["Authorization"] = `token ${token}`;
      }

      const response = await axios.get(`https://api.github.com/repos/${repo}/commits/${branch}`, { headers });
      const latestCommitSha = response.data.sha;
      const commitMessage = response.data.commit.message;
      const commitDate = response.data.commit.author.date;

      res.json({
        latestCommitSha,
        commitMessage,
        commitDate,
        currentCommitSha: config.currentCommitSha || null
      });
    } catch (err: any) {
      res.status(500).json({ error: err.message || "Error al verificar actualizaciones" });
    }
  });

  app.post("/api/update/apply", async (req, res) => {
    try {
      const config = getConfig();
      let repo = config.githubRepo;
      
      // Clean up repo string if user pasted full URL
      if (repo && repo.includes('github.com/')) {
        repo = repo.split('github.com/')[1].replace('.git', '');
      }
      
      const branch = config.githubBranch || "main";
      const token = config.githubToken;

      if (!repo) {
        return res.status(400).json({ error: "Repositorio no configurado." });
      }

      const headers: any = {
        "Accept": "application/vnd.github.v3.raw"
      };
      if (token) {
        headers["Authorization"] = `token ${token}`;
      }

      const zipUrl = `https://api.github.com/repos/${repo}/zipball/${branch}`;
      
      const response = await axios.get(zipUrl, { headers, responseType: 'arraybuffer' });
      const zipBuffer = Buffer.from(response.data, 'binary');
      
      const zip = new AdmZip(zipBuffer);
      const zipEntries = zip.getEntries();
      
      if (zipEntries.length === 0) {
        return res.status(500).json({ error: "El archivo zip está vacío." });
      }

      const rootFolder = zipEntries[0].entryName.split('/')[0] + '/';
      const extractPath = process.cwd();
      
      for (const entry of zipEntries) {
        if (!entry.isDirectory) {
          const relativePath = entry.entryName.substring(rootFolder.length);
          if (!relativePath) continue;
          
          // Skip modifying bot_data to preserve state
          if (relativePath.startsWith('bot_data/')) continue;
          
          const targetPath = path.join(extractPath, relativePath);
          const targetDir = path.dirname(targetPath);
          
          if (!fs.existsSync(targetDir)) {
            fs.mkdirSync(targetDir, { recursive: true });
          }
          
          fs.writeFileSync(targetPath, entry.getData());
        }
      }

      // Update current commit SHA in config
      const commitResponse = await axios.get(`https://api.github.com/repos/${repo}/commits/${branch}`, { 
        headers: { "Accept": "application/vnd.github.v3+json", ...(token ? {"Authorization": `token ${token}`} : {}) } 
      });
      config.currentCommitSha = commitResponse.data.sha;
      saveConfig(config);

      res.json({ success: true, message: "Actualización descargada. Instalando dependencias y reiniciando..." });
      
      exec('npm install && npm run build', { cwd: extractPath }, (error: any, stdout: string, stderr: string) => {
        if (error) {
          console.error(`Error during npm install/build: ${error}`);
          // Don't exit if build failed, so the user can still access the app to fix it
          return;
        }
        console.log(`npm install/build output: ${stdout}`);
        
        console.log("Update applied successfully. Restarting server...");
        
        // Restart the process
        setTimeout(() => {
          process.exit(0);
        }, 2000);
      });

    } catch (err: any) {
      console.error("Update error:", err);
      res.status(500).json({ error: err.message || "Error al aplicar actualización" });
    }
  });

  // Vite middleware for development
  if (process.env.NODE_ENV !== "production") {
    const vite = await createViteServer({
      server: { middlewareMode: true },
      appType: "spa",
    });
    app.use(vite.middlewares);
  } else {
    const distPath = path.join(process.cwd(), 'dist');
    app.use(express.static(distPath));
    app.get('*', (req, res) => {
      res.sendFile(path.join(distPath, 'index.html'));
    });
  }

  app.listen(PORT, "0.0.0.0", () => {
    console.log(`Server running on http://localhost:${PORT}`);
    
    if (process.env.AUTOSTART_BOT === 'true') {
      console.log("[AutoStart] Starting bot automatically...");
      startBot();
    }
    
    // Auto-update checker
    setInterval(async () => {
      const config = getConfig();
      if (!config.autoUpdateCheckEnabled || !config.githubRepo) return;

      const now = new Date();
      // Adjust for Mexico City timezone if needed, or use local server time
      const currentHour = `${now.getHours().toString().padStart(2, '0')}:${now.getMinutes().toString().padStart(2, '0')}`;
      const targetHour = config.autoUpdateHour || '03:00';

      // Only check at the specific hour and minute
      if (currentHour !== targetHour) return;

      // Check frequency
      const lastCheck = config.lastAutoUpdateCheck ? new Date(config.lastAutoUpdateCheck) : new Date(0);
      const daysSinceLastCheck = Math.floor((now.getTime() - lastCheck.getTime()) / (1000 * 60 * 60 * 24));
      
      // If it already ran today, don't run again
      if (now.getDate() === lastCheck.getDate() && now.getMonth() === lastCheck.getMonth() && now.getFullYear() === lastCheck.getFullYear()) {
         return;
      }

      let shouldCheck = false;
      if (!config.autoUpdateFrequency) shouldCheck = true; // Default to daily if not set
      if (config.autoUpdateFrequency === 'daily') shouldCheck = true;
      if (config.autoUpdateFrequency === 'weekly' && daysSinceLastCheck >= 7) shouldCheck = true;
      if (config.autoUpdateFrequency === 'custom' && daysSinceLastCheck >= (config.autoUpdateCustomDays || 3)) shouldCheck = true;

      if (!shouldCheck && config.lastAutoUpdateCheck) return;

      console.log("[AutoUpdate] Checking for updates...");
      config.lastAutoUpdateCheck = now.toISOString();
      saveConfig(config);

      try {
        let repo = config.githubRepo;
        if (repo && repo.includes('github.com/')) {
          repo = repo.split('github.com/')[1].replace('.git', '');
        }
        const branch = config.githubBranch || "main";
        const token = config.githubToken;

        const headers: any = { "Accept": "application/vnd.github.v3+json" };
        if (token) headers["Authorization"] = `token ${token}`;

        const response = await axios.get(`https://api.github.com/repos/${repo}/commits/${branch}`, { headers });
        const latestCommitSha = response.data.sha;

        if (latestCommitSha !== config.currentCommitSha) {
          console.log(`[AutoUpdate] New update found (${latestCommitSha}). Downloading...`);
          
          const zipUrl = `https://api.github.com/repos/${repo}/zipball/${branch}`;
          const zipResponse = await axios.get(zipUrl, { headers: { "Accept": "application/vnd.github.v3.raw", ...(token ? {"Authorization": `token ${token}`} : {}) }, responseType: 'arraybuffer' });
          
          const zipBuffer = Buffer.from(zipResponse.data, 'binary');
          const zip = new AdmZip(zipBuffer);
          const zipEntries = zip.getEntries();
          const rootFolder = zipEntries[0].entryName;
          const extractPath = process.cwd();

          zipEntries.forEach((entry: any) => {
            if (entry.isDirectory) return;
            const relativePath = entry.entryName.substring(rootFolder.length);
            if (!relativePath || relativePath.startsWith('bot_data/')) return;
            
            const fullPath = path.join(extractPath, relativePath);
            const dirName = path.dirname(fullPath);
            if (!fs.existsSync(dirName)) fs.mkdirSync(dirName, { recursive: true });
            fs.writeFileSync(fullPath, entry.getData());
          });

          config.currentCommitSha = latestCommitSha;
          saveConfig(config);

          console.log("[AutoUpdate] Update extracted. Running npm install and build...");
          exec('npm install && npm run build', { cwd: extractPath }, (error: any, stdout: string, stderr: string) => {
            if (error) {
              console.error(`[AutoUpdate] Error during build: ${error}`);
              return;
            }
            console.log(`[AutoUpdate] Build output: ${stdout}`);
            console.log("[AutoUpdate] Update applied successfully. Restarting server...");
            setTimeout(() => process.exit(0), 2000);
          });
        } else {
          console.log("[AutoUpdate] System is up to date.");
        }
      } catch (err: any) {
        console.error("[AutoUpdate] Error checking/applying update:", err.message);
      }
    }, 60000); // Check every minute
  });
}

startServer();
