import React, { useState, useEffect, useCallback } from 'react';
import { 
  Play, 
  Square, 
  Settings, 
  FileText, 
  Activity, 
  RefreshCw, 
  Download, 
  AlertTriangle, 
  CheckCircle2, 
  LogOut, 
  Plus, 
  Trash2, 
  ChevronDown, 
  ChevronUp,
  Mail,
  MessageSquare,
  Github,
  Info,
  Clock,
  Database,
  Search,
  LayoutDashboard,
  Cpu,
  HardDrive,
  Hash,
  User,
  ChevronRight,
  ExternalLink,
  HelpCircle,
  BookOpen,
  ShieldCheck,
  Zap
} from 'lucide-react';
import { motion, AnimatePresence } from 'motion/react';
import { Toaster, toast } from 'sonner';

// --- Types ---
interface Stats {
  processedPdfs: number;
  emailsSent: number;
  errorsDetected: number;
}

interface BotStatus {
  status: 'stopped' | 'starting' | 'awaiting_qr' | 'running' | 'error';
  qrCode: string | null;
  stats: Stats;
  version: string;
  system?: {
    cpuLoad: number[];
    totalMem: number;
    freeMem: number;
    uptime: number;
    platform: string;
    arch: string;
  };
}

interface LogEntry {
  time: string;
  level: string;
  message: string;
}

interface ChatConfig {
  id: string;
  targetContact: string;
  emailDestino: string;
  emailBcc?: string;
  sourceApp: string;
  fileType: string;
  triggerError: string;
  triggerNssWord: string;
  triggerCurpWord: string;
  messageDirection?: 'received' | 'sent' | 'both';
  pdfActionEmailEnabled: boolean;
  pdfActionWaEnabled: boolean;
  pdfWaTargets: string;
  pdfWaMessage: string;
  actionPdfSubject: string;
  actionPdfBody: string;
  nssActionEmailEnabled: boolean;
  nssActionWaEnabled: boolean;
  nssWaTargets: string;
  nssWaMessage: string;
  actionNssSubject: string;
  actionNssBody: string;
  curpActionEmailEnabled: boolean;
  curpActionWaEnabled: boolean;
  curpWaTargets: string;
  curpWaMessage: string;
  actionCurpSubject: string;
  actionCurpBody: string;
}

interface AuditTemplate {
  id: string;
  name: string;
  columns: string[];
  emailEnabled: boolean;
  emailTargets: string;
  waEnabled: boolean;
  waTargets: string;
  schedule: string;
}

interface Config {
  emailUser: string;
  emailPass: string;
  smtpServer: string;
  smtpPort: number;
  emailDailyLimit?: number;
  emailsSentToday?: number;
  lastEmailDate?: string;
  emailBatchingEnabled?: boolean;
  emailBatchLimit?: number;
  emailSchedules?: string[];
  auditActionEmailEnabled: boolean;
  auditEmailTargets: string;
  auditActionWaEnabled: boolean;
  auditWaTargets: string;
  githubRepo?: string;
  githubBranch?: string;
  githubToken?: string;
  currentCommitSha?: string;
  autoUpdateCheckEnabled?: boolean;
  autoUpdateHour?: string;
  autoUpdateFrequency?: 'daily' | 'weekly' | 'custom';
  autoUpdateCustomDays?: number;
  chatConfigs: ChatConfig[];
  auditTemplates?: AuditTemplate[];
}

interface UpdateInfo {
  latestCommitSha: string;
  commitMessage: string;
  commitDate: string;
  currentCommitSha: string | null;
}

// --- Components ---

const Card = ({ children, title, icon: Icon, className = "" }: { children: React.ReactNode, title: string, icon?: any, className?: string }) => (
  <div className={`bg-zinc-900 border border-zinc-800 rounded-xl overflow-hidden ${className}`}>
    <div className="px-4 py-3 border-b border-zinc-800 flex items-center justify-between bg-zinc-900/50">
      <div className="flex items-center gap-2">
        {Icon && <Icon size={18} className="text-zinc-400" />}
        <h3 className="text-sm font-medium text-zinc-200 uppercase tracking-wider">{title}</h3>
      </div>
    </div>
    <div className="p-4">
      {children}
    </div>
  </div>
);

const StatCard = ({ label, value, icon: Icon, colorClass }: { label: string, value: number | string, icon: any, colorClass: string }) => (
  <div className="bg-zinc-900 border border-zinc-800 p-4 rounded-xl flex items-center gap-4">
    <div className={`p-3 rounded-lg ${colorClass} bg-opacity-10`}>
      <Icon size={24} className={colorClass.replace('bg-', 'text-')} />
    </div>
    <div>
      <p className="text-xs text-zinc-500 uppercase tracking-widest font-medium">{label}</p>
      <p className="text-2xl font-mono font-bold text-zinc-100">{value}</p>
    </div>
  </div>
);

export default function App() {
  const [status, setStatus] = useState<BotStatus | null>(null);
  const [logs, setLogs] = useState<LogEntry[]>([]);
  const [config, setConfig] = useState<Config | null>(null);
  const [auditLogs, setAuditLogs] = useState<any[]>([]);
  const [updateInfo, setUpdateInfo] = useState<UpdateInfo | null>(null);
  const [activeTab, setActiveTab] = useState<'dashboard' | 'settings' | 'audit' | 'update' | 'help'>('dashboard');
  const [isSaving, setIsSaving] = useState(false);
  const [expandedChat, setExpandedChat] = useState<string | null>(null);

  const [error, setError] = useState<string | null>(null);

  const fetchStatus = useCallback(async () => {
    try {
      const res = await fetch('/api/status');
      if (!res.ok) throw new Error(`Status API: ${res.status}`);
      const data = await res.json();
      setStatus(data);
    } catch (e: any) {
      console.error("Error fetching status", e);
      setError(prev => prev ? `${prev} | ${e.message}` : e.message);
    }
  }, []);

  const fetchLogs = useCallback(async () => {
    try {
      const res = await fetch('/api/logs');
      if (!res.ok) throw new Error(`Logs API: ${res.status}`);
      const data = await res.json();
      setLogs(data);
    } catch (e) {
      console.error("Error fetching logs", e);
    }
  }, []);

  const fetchConfig = useCallback(async (force = false) => {
    // Si estamos en la pestaña de configuración o actualización, no sobrescribimos a menos que se fuerce (ej. al entrar a la pestaña)
    if ((activeTab === 'settings' || activeTab === 'update') && !force) return;
    
    try {
      const res = await fetch('/api/settings');
      if (!res.ok) throw new Error(`Settings API: ${res.status}`);
      const data = await res.json();
      if (!data) throw new Error("Configuración vacía");
      setConfig(data);
    } catch (e: any) {
      console.error("Error fetching config", e);
      setError(prev => prev ? `${prev} | ${e.message}` : e.message);
    }
  }, [activeTab]);

  const fetchAuditLogs = useCallback(async () => {
    try {
      const res = await fetch('/api/audit/list');
      const data = await res.json();
      if (Array.isArray(data)) {
        setAuditLogs(data);
      } else {
        console.error("Audit logs API returned non-array data", data);
        setAuditLogs([]);
      }
    } catch (e) {
      console.error("Error fetching audit logs", e);
      setAuditLogs([]);
    }
  }, []);

  const checkUpdates = async () => {
    try {
      const res = await fetch('/api/update/check');
      const data = await res.json();
      setUpdateInfo(data);
    } catch (e) {
      console.error("Error checking updates", e);
    }
  };

  useEffect(() => {
    fetchStatus();
    fetchLogs();
    fetchConfig(true); // Forzamos la carga inicial al entrar a cualquier pestaña
    fetchAuditLogs();

    const interval = setInterval(() => {
      fetchStatus();
      fetchLogs();
      fetchConfig(); // El callback ya maneja la lógica de no sobrescribir en settings
      fetchAuditLogs();
    }, 3000);

    return () => clearInterval(interval);
  }, [fetchStatus, fetchLogs, fetchConfig, fetchAuditLogs, activeTab]);

  const handleStartBot = async () => {
    try {
      await fetch('/api/bot/start', { method: 'POST' });
      toast.success("Iniciando bot...");
      fetchStatus();
    } catch (e) {
      toast.error("Error al iniciar el bot");
    }
  };

  const handleStopBot = async () => {
    try {
      await fetch('/api/bot/stop', { method: 'POST' });
      toast.success("Deteniendo bot...");
      fetchStatus();
    } catch (e) {
      toast.error("Error al detener el bot");
    }
  };

  const handleSaveConfig = async () => {
    if (!config) return;
    setIsSaving(true);
    try {
      const res = await fetch('/api/settings', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(config)
      });
      if (res.ok) {
        toast.success("Configuración guardada correctamente.");
      } else {
        toast.error("Error al guardar configuración.");
      }
    } catch (e) {
      toast.error("Error de conexión al guardar.");
    } finally {
      setIsSaving(false);
    }
  };

  const handleApplyUpdate = async () => {
    if (!window.confirm("¿Estás seguro de aplicar la actualización? El bot se reiniciará.")) return;
    try {
      const res = await fetch('/api/update/apply', { method: 'POST' });
      if (res.ok) {
        toast.success("Actualización iniciada. El servidor se reiniciará.");
      } else {
        toast.error("Error al aplicar actualización.");
      }
    } catch (e) {
      toast.error("Error de conexión durante la actualización.");
    }
  };

  const addChatConfig = () => {
    if (!config) return;
    const newChat: ChatConfig = {
      id: Math.random().toString(36).substr(2, 9),
      targetContact: 'Nuevo Chat',
      emailDestino: '',
      sourceApp: 'whatsapp',
      fileType: 'application/pdf',
      triggerError: '//404//',
      triggerNssWord: 'nss',
      triggerCurpWord: 'curp',
      pdfActionEmailEnabled: true,
      pdfActionWaEnabled: false,
      pdfWaTargets: '',
      pdfWaMessage: 'Adjunto PDF procesado: {nss} - {curp}',
      actionPdfSubject: 'NSS: {nss} - CURP: {curp}',
      actionPdfBody: 'Adjunto PDF procesado automáticamente.',
      nssActionEmailEnabled: true,
      nssActionWaEnabled: false,
      nssWaTargets: '',
      nssWaMessage: 'Error NSS detectado: {original_message}',
      actionNssSubject: '{original_message}',
      actionNssBody: 'El NSS no se encontró o no está asociado al CURP',
      curpActionEmailEnabled: true,
      curpActionWaEnabled: false,
      curpWaTargets: '',
      curpWaMessage: 'Error CURP detectado: {original_message}',
      actionCurpSubject: '{original_message}',
      actionCurpBody: 'La CURP no tiene el formato correcto.'
    };
    setConfig({ ...config, chatConfigs: [...config.chatConfigs, newChat] });
    setExpandedChat(newChat.id);
  };

  const removeChatConfig = (id: string) => {
    if (!config) return;
    if (!confirm("¿Eliminar esta configuración de chat?")) return;
    setConfig({ ...config, chatConfigs: config.chatConfigs.filter(c => c.id !== id) });
  };

  const updateChatConfig = (id: string, field: keyof ChatConfig, value: any) => {
    if (!config) return;
    setConfig({
      ...config,
      chatConfigs: config.chatConfigs.map(c => c.id === id ? { ...c, [field]: value } : c)
    });
  };

  const getStatusBadge = (status: string) => {
    switch (status) {
      case 'running': return <span className="flex items-center gap-1.5 px-2.5 py-1 rounded-full bg-emerald-500/10 text-emerald-500 text-xs font-bold uppercase tracking-wider border border-emerald-500/20"><CheckCircle2 size={14} /> En Ejecución</span>;
      case 'awaiting_qr': return <span className="flex items-center gap-1.5 px-2.5 py-1 rounded-full bg-amber-500/10 text-amber-500 text-xs font-bold uppercase tracking-wider border border-amber-500/20"><RefreshCw size={14} className="animate-spin" /> Esperando QR</span>;
      case 'starting': return <span className="flex items-center gap-1.5 px-2.5 py-1 rounded-full bg-blue-500/10 text-blue-500 text-xs font-bold uppercase tracking-wider border border-blue-500/20"><RefreshCw size={14} className="animate-spin" /> Iniciando</span>;
      case 'stopped': return <span className="flex items-center gap-1.5 px-2.5 py-1 rounded-full bg-zinc-500/10 text-zinc-500 text-xs font-bold uppercase tracking-wider border border-zinc-500/20"><Square size={14} /> Detenido</span>;
      case 'error': return <span className="flex items-center gap-1.5 px-2.5 py-1 rounded-full bg-rose-500/10 text-rose-500 text-xs font-bold uppercase tracking-wider border border-rose-500/20"><AlertTriangle size={14} /> Error</span>;
      default: return null;
    }
  };

  return (
    <div className="min-h-screen bg-black text-zinc-300 font-sans selection:bg-zinc-700 selection:text-white">
      <Toaster position="top-right" theme="dark" richColors closeButton />
      
      {/* Sidebar */}
      <div className="fixed left-0 top-0 bottom-0 w-64 bg-zinc-950 border-r border-zinc-900 flex flex-col z-50">
        <div className="p-6 border-b border-zinc-900">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 bg-zinc-100 rounded-lg flex items-center justify-center text-black font-bold text-xl">S</div>
            <div>
              <h1 className="text-lg font-bold text-zinc-100 tracking-tight">Sendify PRO</h1>
              <p className="text-[10px] text-zinc-500 uppercase tracking-[0.2em] font-bold">WhatsApp Bot PRO</p>
            </div>
          </div>
        </div>

        <nav className="flex-1 p-4 space-y-2">
          <button 
            onClick={() => setActiveTab('dashboard')}
            className={`w-full flex items-center gap-3 px-4 py-3 rounded-lg text-sm font-medium transition-all ${activeTab === 'dashboard' ? 'bg-zinc-100 text-black' : 'text-zinc-500 hover:bg-zinc-900 hover:text-zinc-200'}`}
          >
            <Activity size={18} /> Dashboard
          </button>
          <button 
            onClick={() => setActiveTab('settings')}
            className={`w-full flex items-center gap-3 px-4 py-3 rounded-lg text-sm font-medium transition-all ${activeTab === 'settings' ? 'bg-zinc-100 text-black' : 'text-zinc-500 hover:bg-zinc-900 hover:text-zinc-200'}`}
          >
            <Settings size={18} /> Configuración
          </button>
          <button 
            onClick={() => setActiveTab('audit')}
            className={`w-full flex items-center gap-3 px-4 py-3 rounded-lg text-sm font-medium transition-all ${activeTab === 'audit' ? 'bg-zinc-100 text-black' : 'text-zinc-500 hover:bg-zinc-900 hover:text-zinc-200'}`}
          >
            <FileText size={18} /> Auditoría
          </button>
          <button 
            onClick={() => setActiveTab('update')}
            className={`w-full flex items-center gap-3 px-4 py-3 rounded-lg text-sm font-medium transition-all ${activeTab === 'update' ? 'bg-zinc-100 text-black' : 'text-zinc-500 hover:bg-zinc-900 hover:text-zinc-200'}`}
          >
            <Github size={18} /> Actualización
          </button>
          <button 
            onClick={() => setActiveTab('help')}
            className={`w-full flex items-center gap-3 px-4 py-3 rounded-lg text-sm font-medium transition-all ${activeTab === 'help' ? 'bg-zinc-100 text-black' : 'text-zinc-500 hover:bg-zinc-900 hover:text-zinc-200'}`}
          >
            <HelpCircle size={18} /> Ayuda y Guía
          </button>
        </nav>

        <div className="p-6 border-t border-zinc-900">
          <div className="flex items-center justify-between mb-4">
            <span className="text-[10px] text-zinc-500 uppercase font-bold tracking-widest">Estado</span>
            {status && getStatusBadge(status.status)}
          </div>
          <div className="space-y-2">
            {status?.status === 'stopped' || status?.status === 'error' ? (
              <button 
                onClick={handleStartBot}
                className="w-full flex items-center justify-center gap-2 py-2.5 rounded-lg bg-emerald-600 text-white text-sm font-bold hover:bg-emerald-500 transition-colors"
              >
                <Play size={16} fill="currentColor" /> Iniciar Bot
              </button>
            ) : (
              <button 
                onClick={handleStopBot}
                className="w-full flex items-center justify-center gap-2 py-2.5 rounded-lg bg-rose-600 text-white text-sm font-bold hover:bg-rose-500 transition-colors"
              >
                <Square size={16} fill="currentColor" /> Detener Bot
              </button>
            )}
          </div>
        </div>
      </div>

      {/* Main Content */}
      <div className="pl-64 min-h-screen">
        <header className="h-20 border-b border-zinc-900 flex items-center justify-between px-8 bg-black/50 backdrop-blur-md sticky top-0 z-40">
          <div>
            <h2 className="text-xl font-bold text-zinc-100 capitalize">{activeTab}</h2>
            <p className="text-xs text-zinc-500">{status?.version || 'v8.0.0'}</p>
          </div>
          <div className="flex items-center gap-4">
            <div className="flex items-center gap-2 mr-4">
              {status?.status === 'stopped' || status?.status === 'error' ? (
                <button 
                  onClick={handleStartBot}
                  className="flex items-center gap-2 px-4 py-1.5 rounded-lg bg-emerald-600/20 text-emerald-500 text-xs font-bold hover:bg-emerald-600/30 transition-all border border-emerald-500/20"
                >
                  <Play size={14} fill="currentColor" /> INICIAR
                </button>
              ) : (
                <button 
                  onClick={handleStopBot}
                  className="flex items-center gap-2 px-4 py-1.5 rounded-lg bg-rose-600/20 text-rose-500 text-xs font-bold hover:bg-rose-600/30 transition-all border border-rose-500/20"
                >
                  <Square size={14} fill="currentColor" /> DETENER
                </button>
              )}
            </div>
            <div className="flex flex-col items-end">
              <span className="text-[10px] text-zinc-500 uppercase font-bold tracking-widest">Correos Hoy</span>
              <span className="text-sm font-mono font-bold text-zinc-200">{config?.emailsSentToday || 0} / {config?.emailDailyLimit || 100}</span>
            </div>
            <div className="w-px h-8 bg-zinc-800 mx-2" />
            <button className="p-2 text-zinc-500 hover:text-zinc-100 transition-colors">
              <RefreshCw size={20} onClick={() => window.location.reload()} />
            </button>
          </div>
        </header>

        <main className="p-8 max-w-7xl mx-auto">
          {!config || !status ? (
            <div className="flex flex-col items-center justify-center py-40 space-y-4">
              <RefreshCw size={48} className={`text-zinc-800 ${error ? '' : 'animate-spin'}`} />
              <div className="text-center">
                <p className="text-zinc-500 font-medium animate-pulse">Cargando sistema...</p>
                {error && (
                  <div className="mt-4 p-4 bg-rose-900/20 border border-rose-500/30 rounded-lg max-w-md">
                    <p className="text-rose-500 text-xs font-mono break-all">{error}</p>
                  </div>
                )}
                <div className="mt-4 flex flex-col items-center gap-1">
                  <p className="text-[10px] uppercase tracking-widest font-bold text-zinc-600">Sincronización</p>
                  <div className="flex gap-4 text-[10px] font-mono">
                    <span className={status ? "text-emerald-500" : "text-zinc-700"}>
                      ESTADO: {status ? "OK" : "WAIT"}
                    </span>
                    <span className={config ? "text-emerald-500" : "text-zinc-700"}>
                      CONFIG: {config ? "OK" : "WAIT"}
                    </span>
                  </div>
                </div>
              </div>
              <button 
                onClick={() => { setError(null); fetchStatus(); fetchConfig(); }}
                className="mt-4 px-4 py-2 bg-zinc-900 border border-zinc-800 rounded-lg text-xs text-zinc-400 hover:text-zinc-200 transition-all"
              >
                Reintentar Conexión
              </button>
            </div>
          ) : (
            <AnimatePresence mode="wait">
            {activeTab === 'dashboard' && (
              <motion.div 
                key="dashboard"
                initial={{ opacity: 0, y: 10 }}
                animate={{ opacity: 1, y: 0 }}
                exit={{ opacity: 0, y: -10 }}
                className="space-y-8"
              >
                {/* Prominent Start Bot Button if stopped */}
                {status?.status === 'stopped' && (
                  <motion.div 
                    initial={{ opacity: 0, scale: 0.95 }}
                    animate={{ opacity: 1, scale: 1 }}
                    className="p-8 bg-emerald-600/10 border border-emerald-500/20 rounded-2xl flex flex-col items-center justify-center text-center space-y-4"
                  >
                    <div className="w-16 h-16 bg-emerald-600 rounded-full flex items-center justify-center text-white shadow-lg shadow-emerald-600/20">
                      <Play size={32} fill="currentColor" />
                    </div>
                    <div>
                      <h3 className="text-xl font-bold text-zinc-100">El Bot está Detenido</h3>
                      <p className="text-sm text-zinc-400 max-w-md mx-auto">Inicia el bot para comenzar a procesar mensajes y generar reportes automáticos.</p>
                    </div>
                    <button 
                      onClick={handleStartBot}
                      className="px-8 py-3 bg-emerald-600 text-white rounded-xl font-bold text-lg hover:bg-emerald-500 transition-all shadow-xl shadow-emerald-600/30 active:scale-95"
                    >
                      Iniciar Bot Ahora
                    </button>
                  </motion.div>
                )}

                {/* Stats Grid */}
                <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
                  <StatCard label="PDFs Procesados" value={status?.stats.processedPdfs || 0} icon={FileText} colorClass="bg-blue-500" />
                  <StatCard label="Correos Enviados" value={status?.stats.emailsSent || 0} icon={Mail} colorClass="bg-emerald-500" />
                  <StatCard label="Errores Detectados" value={status?.stats.errorsDetected || 0} icon={AlertTriangle} colorClass="bg-rose-500" />
                </div>

                <div className="grid grid-cols-1 lg:grid-cols-3 gap-8">
                  {/* Left Column: QR or Info */}
                  <div className="lg:col-span-1 space-y-8">
                    {status?.status === 'awaiting_qr' && status.qrCode ? (
                      <Card title="Escanear QR" icon={RefreshCw}>
                        <div className="flex flex-col items-center justify-center p-4 bg-white rounded-lg">
                          <img src={status.qrCode} alt="WhatsApp QR" className="w-full max-w-[250px]" />
                          <p className="mt-4 text-xs text-zinc-900 font-bold text-center">Escanea este código con tu WhatsApp para conectar el bot.</p>
                        </div>
                      </Card>
                    ) : (
                      <Card title="Información del Sistema" icon={Info}>
                        <div className="space-y-4">
                          <div className="flex justify-between items-center py-2 border-b border-zinc-800/50">
                            <span className="text-xs text-zinc-500 uppercase font-bold">Plataforma</span>
                            <span className="text-sm font-medium text-zinc-200">{status?.system?.platform || 'WhatsApp Web JS'} ({status?.system?.arch || 'x64'})</span>
                          </div>
                          <div className="flex justify-between items-center py-2 border-b border-zinc-800/50">
                            <span className="text-xs text-zinc-500 uppercase font-bold">Memoria</span>
                            <span className="text-sm font-medium text-zinc-200">
                              {status?.system ? `${Math.round((status.system.totalMem - status.system.freeMem) / 1024 / 1024)}MB / ${Math.round(status.system.totalMem / 1024 / 1024)}MB` : 'LocalAuth (Persistente)'}
                            </span>
                          </div>
                          <div className="flex justify-between items-center py-2 border-b border-zinc-800/50">
                            <span className="text-xs text-zinc-500 uppercase font-bold">Uptime</span>
                            <span className="text-sm font-medium text-zinc-200">
                              {status?.system ? `${Math.floor(status.system.uptime / 3600)}h ${Math.floor((status.system.uptime % 3600) / 60)}m` : 'America/Mexico_City'}
                            </span>
                          </div>
                          <div className="flex justify-between items-center py-2">
                            <span className="text-xs text-zinc-500 uppercase font-bold">Carga CPU</span>
                            <span className="text-sm font-medium text-zinc-200">
                              {status?.system?.cpuLoad ? status.system.cpuLoad[0].toFixed(2) : 'Invisible (Headless)'}
                            </span>
                          </div>
                        </div>
                      </Card>
                    )}

                    <Card title="Agrupación de Correos" icon={Clock}>
                      <div className="space-y-4">
                        <div className="flex items-center justify-between">
                          <span className="text-xs text-zinc-500 uppercase font-bold">Estado</span>
                          <span className={`text-xs font-bold px-2 py-0.5 rounded ${config?.emailBatchingEnabled ? 'bg-emerald-500/10 text-emerald-500' : 'bg-zinc-500/10 text-zinc-500'}`}>
                            {config?.emailBatchingEnabled ? 'ACTIVO' : 'INACTIVO'}
                          </span>
                        </div>
                        {config?.emailBatchingEnabled && (
                          <div className="space-y-2">
                            <p className="text-xs text-zinc-400">Próximos envíos programados:</p>
                            <div className="flex flex-wrap gap-2">
                              {(config.emailSchedules || []).filter(Boolean).map((t, i) => (
                                <span key={i} className="px-2 py-1 bg-zinc-800 rounded text-xs font-mono text-zinc-200">{t}</span>
                              ))}
                              {(config.emailSchedules || []).filter(Boolean).length === 0 && (
                                <span className="text-[10px] text-zinc-600 italic">No programado</span>
                              )}
                            </div>
                            <p className="text-[10px] text-zinc-500 italic mt-2">O al alcanzar {config.emailBatchLimit || 20} correos en cola.</p>
                          </div>
                        )}
                      </div>
                    </Card>
                  </div>

                  {/* Right Column: Logs */}
                  <div className="lg:col-span-2">
                    <Card title="Consola de Eventos" icon={Database} className="h-full flex flex-col">
                      <div className="flex-1 overflow-y-auto min-h-[600px] max-h-[1000px] font-mono text-[11px] space-y-1 pr-2 custom-scrollbar">
                        {logs.length === 0 ? (
                          <p className="text-zinc-600 italic">Esperando eventos...</p>
                        ) : (
                          logs.slice().reverse().map((log, i) => (
                            <div key={i} className="flex gap-3 py-1 border-b border-zinc-800/30 last:border-0">
                              <span className="text-zinc-600 shrink-0">[{new Date(log.time).toLocaleTimeString()}]</span>
                              <span className={`font-bold shrink-0 w-12 ${
                                log.level === 'ERROR' ? 'text-rose-500' : 
                                log.level === 'WARN' ? 'text-amber-500' : 
                                log.level === 'INFO' ? 'text-blue-400' : 'text-zinc-500'
                              }`}>{log.level}</span>
                              <span className="text-zinc-300 break-words">{log.message}</span>
                            </div>
                          ))
                        )}
                      </div>
                    </Card>
                  </div>
                </div>
              </motion.div>
            )}

            {activeTab === 'settings' && config && (
              <motion.div 
                key="settings"
                initial={{ opacity: 0, y: 10 }}
                animate={{ opacity: 1, y: 0 }}
                exit={{ opacity: 0, y: -10 }}
                className="space-y-8 pb-20"
              >
                <div className="flex items-center justify-between">
                  <h3 className="text-lg font-bold text-zinc-100">Configuración Global</h3>
                  <button 
                    onClick={handleSaveConfig}
                    disabled={isSaving}
                    className="flex items-center gap-2 px-6 py-2.5 bg-zinc-100 text-black rounded-lg font-bold text-sm hover:bg-white transition-all disabled:opacity-50"
                  >
                    {isSaving ? <RefreshCw size={16} className="animate-spin" /> : <CheckCircle2 size={16} />}
                    Guardar Cambios
                  </button>
                </div>

                <div className="grid grid-cols-1 md:grid-cols-2 gap-8">
                  <Card title="Servidor SMTP (Envío)" icon={Mail}>
                    <div className="space-y-4">
                      <div className="grid grid-cols-2 gap-4">
                        <div className="space-y-1.5">
                          <label className="text-[10px] text-zinc-500 uppercase font-bold tracking-widest">Servidor</label>
                          <input 
                            type="text" 
                            value={config.smtpServer} 
                            onChange={e => setConfig({...config, smtpServer: e.target.value})}
                            className="w-full bg-zinc-950 border border-zinc-800 rounded-lg px-3 py-2 text-sm focus:border-zinc-500 outline-none transition-all"
                          />
                        </div>
                        <div className="space-y-1.5">
                          <label className="text-[10px] text-zinc-500 uppercase font-bold tracking-widest">Puerto</label>
                          <input 
                            type="number" 
                            value={config.smtpPort === undefined ? '' : config.smtpPort} 
                            onChange={e => {
                              const val = e.target.value === '' ? undefined : parseInt(e.target.value);
                              setConfig({...config, smtpPort: val});
                            }}
                            className="w-full bg-zinc-950 border border-zinc-800 rounded-lg px-3 py-2 text-sm focus:border-zinc-500 outline-none transition-all"
                          />
                        </div>
                      </div>
                      <div className="space-y-1.5">
                        <label className="text-[10px] text-zinc-500 uppercase font-bold tracking-widest">Usuario / Email</label>
                        <input 
                          type="email" 
                          value={config.emailUser} 
                          onChange={e => setConfig({...config, emailUser: e.target.value})}
                          autoComplete="off"
                          className="w-full bg-zinc-950 border border-zinc-800 rounded-lg px-3 py-2 text-sm focus:border-zinc-500 outline-none transition-all"
                        />
                      </div>
                      <div className="space-y-1.5">
                        <label className="text-[10px] text-zinc-500 uppercase font-bold tracking-widest">Contraseña (App Password)</label>
                        <input 
                          type="password" 
                          value={config.emailPass} 
                          onChange={e => setConfig({...config, emailPass: e.target.value})}
                          autoComplete="new-password"
                          className="w-full bg-zinc-950 border border-zinc-800 rounded-lg px-3 py-2 text-sm focus:border-zinc-500 outline-none transition-all"
                        />
                      </div>
                      <div className="space-y-1.5">
                        <label className="text-[10px] text-zinc-500 uppercase font-bold tracking-widest">Límite Diario</label>
                        <input 
                          type="number" 
                          value={config.emailDailyLimit === undefined ? 100 : config.emailDailyLimit} 
                          onChange={e => {
                            const val = e.target.value === '' ? undefined : parseInt(e.target.value);
                            setConfig({...config, emailDailyLimit: val});
                          }}
                          className="w-full bg-zinc-950 border border-zinc-800 rounded-lg px-3 py-2 text-sm focus:border-zinc-500 outline-none transition-all"
                        />
                      </div>
                    </div>
                  </Card>

                  <Card title="Agrupación (Batching)" icon={Clock}>
                    <div className="space-y-4">
                      <div className="flex items-center justify-between p-3 bg-zinc-950 border border-zinc-800 rounded-lg">
                        <div className="flex items-center gap-3">
                          <div className={`w-2 h-2 rounded-full ${config.emailBatchingEnabled ? 'bg-emerald-500 animate-pulse' : 'bg-zinc-700'}`} />
                          <span className="text-sm font-medium">Habilitar Agrupación</span>
                        </div>
                        <input 
                          type="checkbox" 
                          checked={config.emailBatchingEnabled} 
                          onChange={e => setConfig({...config, emailBatchingEnabled: e.target.checked})}
                          className="w-5 h-5 accent-zinc-100"
                        />
                      </div>
                      
                      <div className="space-y-1.5">
                        <label className="text-[10px] text-zinc-500 uppercase font-bold tracking-widest">Límite de elementos por lote</label>
                        <input 
                          type="number" 
                          value={config.emailBatchLimit === undefined ? 20 : config.emailBatchLimit} 
                          onChange={e => {
                            const val = e.target.value === '' ? undefined : parseInt(e.target.value);
                            setConfig({...config, emailBatchLimit: val});
                          }}
                          className="w-full bg-zinc-950 border border-zinc-800 rounded-lg px-3 py-2 text-sm focus:border-zinc-500 outline-none transition-all disabled:opacity-50"
                          disabled={!config.emailBatchingEnabled}
                        />
                      </div>

                      <div className="space-y-1.5">
                        <div className="flex items-center justify-between">
                          <label className="text-[10px] text-zinc-500 uppercase font-bold tracking-widest">Horarios de envío (HH:MM)</label>
                          {(config.emailSchedules?.length || 0) < 5 && (
                            <button 
                              onClick={() => {
                                const current = config.emailSchedules || [];
                                setConfig({...config, emailSchedules: [...current, '']});
                              }}
                              disabled={!config.emailBatchingEnabled}
                              className="text-[10px] text-zinc-400 hover:text-zinc-100 flex items-center gap-1 transition-colors disabled:opacity-50"
                            >
                              <Plus size={10} /> Añadir Horario
                            </button>
                          )}
                        </div>
                        <div className="grid grid-cols-1 gap-2">
                          {(config.emailSchedules || []).map((schedule, idx) => (
                            <div key={idx} className="flex items-center gap-2">
                              <input 
                                type="text" 
                                placeholder="09:00"
                                value={schedule} 
                                onChange={e => {
                                  const newSchedules = [...(config.emailSchedules || [])];
                                  newSchedules[idx] = e.target.value;
                                  setConfig({...config, emailSchedules: newSchedules});
                                }}
                                className="flex-1 bg-zinc-950 border border-zinc-800 rounded-lg px-3 py-2 text-sm focus:border-zinc-500 outline-none transition-all disabled:opacity-50"
                                disabled={!config.emailBatchingEnabled}
                              />
                              <button 
                                onClick={() => {
                                  const newSchedules = (config.emailSchedules || []).filter((_, i) => i !== idx);
                                  setConfig({...config, emailSchedules: newSchedules});
                                }}
                                disabled={!config.emailBatchingEnabled}
                                className="p-2 text-zinc-600 hover:text-rose-500 transition-colors disabled:opacity-50"
                              >
                                <Trash2 size={14} />
                              </button>
                            </div>
                          ))}
                          {(config.emailSchedules?.length || 0) === 0 && (
                            <p className="text-[10px] text-zinc-600 italic">No hay horarios configurados. Se enviará solo por límite de lote.</p>
                          )}
                        </div>
                      </div>

                      <div className="mt-4 p-3 bg-blue-500/5 border border-blue-500/10 rounded-lg space-y-2">
                        <div className="flex items-center gap-2 text-blue-400">
                          <Info size={14} />
                          <span className="text-[10px] font-bold uppercase tracking-wider">Información de Agrupación</span>
                        </div>
                        <p className="text-[11px] text-zinc-400 leading-relaxed">
                          El sistema realiza un <strong>"corte"</strong> automático al alcanzar cualquiera de los horarios programados, enviando todos los elementos acumulados hasta ese momento (aunque no se haya llegado al límite del lote). 
                        </p>
                        <p className="text-[11px] text-zinc-400 leading-relaxed">
                          Los envíos se agrupan de forma inteligente por <strong>Caso y Destinatario</strong>, asegurando que cada chat configurado reciba su propio resumen organizado.
                        </p>
                      </div>
                    </div>
                  </Card>
                </div>

                <div className="space-y-4">
                  <div className="flex items-center justify-between">
                    <h3 className="text-lg font-bold text-zinc-100">Configuración de Chats ({config.chatConfigs.length})</h3>
                    <button 
                      onClick={addChatConfig}
                      className="flex items-center gap-2 px-4 py-2 bg-zinc-800 text-zinc-200 rounded-lg font-bold text-xs hover:bg-zinc-700 transition-all"
                    >
                      <Plus size={14} /> Añadir Chat
                    </button>
                  </div>

                  <div className="space-y-4">
                    {config.chatConfigs.map((chat) => (
                      <div key={chat.id} className="bg-zinc-900 border border-zinc-800 rounded-xl overflow-hidden">
                        <div 
                          className="px-6 py-4 flex items-center justify-between cursor-pointer hover:bg-zinc-800/50 transition-colors"
                          onClick={() => setExpandedChat(expandedChat === chat.id ? null : chat.id)}
                        >
                          <div className="flex items-center gap-4">
                            <div className="w-10 h-10 rounded-full bg-zinc-800 flex items-center justify-center text-zinc-400">
                              <MessageSquare size={20} />
                            </div>
                            <div>
                              <h4 className="font-bold text-zinc-100">{chat.targetContact}</h4>
                              <p className="text-xs text-zinc-500">{chat.emailDestino || 'Sin email destino'}</p>
                            </div>
                          </div>
                          <div className="flex items-center gap-3">
                            <button 
                              onClick={(e) => { e.stopPropagation(); removeChatConfig(chat.id); }}
                              className="p-2 text-zinc-600 hover:text-rose-500 transition-colors"
                            >
                              <Trash2 size={18} />
                            </button>
                            {expandedChat === chat.id ? <ChevronUp size={20} /> : <ChevronDown size={20} />}
                          </div>
                        </div>

                        <AnimatePresence>
                          {expandedChat === chat.id && (
                            <motion.div 
                              initial={{ height: 0, opacity: 0 }}
                              animate={{ height: 'auto', opacity: 1 }}
                              exit={{ height: 0, opacity: 0 }}
                              className="overflow-hidden"
                            >
                              <div className="px-6 pb-6 pt-2 border-t border-zinc-800 grid grid-cols-1 md:grid-cols-2 gap-6">
                                <div className="space-y-4">
                                  <div className="space-y-1.5">
                                    <label className="text-[10px] text-zinc-500 uppercase font-bold tracking-widest">Nombre del Chat / Grupo</label>
                                    <input 
                                      type="text" 
                                      value={chat.targetContact} 
                                      onChange={e => updateChatConfig(chat.id, 'targetContact', e.target.value)}
                                      className="w-full bg-zinc-950 border border-zinc-800 rounded-lg px-3 py-2 text-sm focus:border-zinc-500 outline-none transition-all"
                                    />
                                  </div>
                                  <div className="space-y-1.5">
                                    <label className="text-[10px] text-zinc-500 uppercase font-bold tracking-widest">Email Destino (Principal)</label>
                                    <input 
                                      type="text" 
                                      value={chat.emailDestino} 
                                      onChange={e => updateChatConfig(chat.id, 'emailDestino', e.target.value)}
                                      className="w-full bg-zinc-950 border border-zinc-800 rounded-lg px-3 py-2 text-sm focus:border-zinc-500 outline-none transition-all"
                                    />
                                  </div>
                                  <div className="space-y-1.5">
                                    <label className="text-[10px] text-zinc-500 uppercase font-bold tracking-widest">Email BCC (Oculto)</label>
                                    <input 
                                      type="text" 
                                      value={chat.emailBcc || ''} 
                                      onChange={e => updateChatConfig(chat.id, 'emailBcc', e.target.value)}
                                      className="w-full bg-zinc-950 border border-zinc-800 rounded-lg px-3 py-2 text-sm focus:border-zinc-500 outline-none transition-all"
                                    />
                                  </div>
                                  <div className="grid grid-cols-2 gap-4">
                                    <div className="space-y-1.5">
                                      <label className="text-[10px] text-zinc-500 uppercase font-bold tracking-widest">Trigger Error</label>
                                      <input 
                                        type="text" 
                                        value={chat.triggerError} 
                                        onChange={e => updateChatConfig(chat.id, 'triggerError', e.target.value)}
                                        className="w-full bg-zinc-950 border border-zinc-800 rounded-lg px-3 py-2 text-sm focus:border-zinc-500 outline-none transition-all font-mono"
                                      />
                                    </div>
                                    <div className="space-y-1.5">
                                      <label className="text-[10px] text-zinc-500 uppercase font-bold tracking-widest">Dirección Mensajes</label>
                                      <select 
                                        value={chat.messageDirection || 'both'} 
                                        onChange={e => updateChatConfig(chat.id, 'messageDirection', e.target.value)}
                                        className="w-full bg-zinc-950 border border-zinc-800 rounded-lg px-3 py-2 text-sm focus:border-zinc-500 outline-none transition-all"
                                      >
                                        <option value="both">Ambos</option>
                                        <option value="received">Solo Recibidos</option>
                                        <option value="sent">Solo Enviados</option>
                                      </select>
                                    </div>
                                  </div>
                                </div>

                                <div className="space-y-6">
                                  {/* PDF Actions */}
                                  <div className="p-4 bg-zinc-950 border border-zinc-800 rounded-xl space-y-3">
                                    <div className="flex items-center justify-between border-b border-zinc-800 pb-2">
                                      <span className="text-xs font-bold text-zinc-100 uppercase tracking-wider">Acciones PDF / Éxito</span>
                                      <div className="flex gap-4">
                                        <label className="flex items-center gap-2 text-[10px] font-bold text-zinc-500">
                                          EMAIL
                                          <input type="checkbox" checked={chat.pdfActionEmailEnabled} onChange={e => updateChatConfig(chat.id, 'pdfActionEmailEnabled', e.target.checked)} />
                                        </label>
                                        <label className="flex items-center gap-2 text-[10px] font-bold text-zinc-500">
                                          WA
                                          <input type="checkbox" checked={chat.pdfActionWaEnabled} onChange={e => updateChatConfig(chat.id, 'pdfActionWaEnabled', e.target.checked)} />
                                        </label>
                                      </div>
                                    </div>
                                    <div className="space-y-2">
                                      <input 
                                        type="text" 
                                        placeholder="Asunto Email"
                                        value={chat.actionPdfSubject} 
                                        onChange={e => updateChatConfig(chat.id, 'actionPdfSubject', e.target.value)}
                                        className="w-full bg-zinc-900 border border-zinc-800 rounded px-2 py-1.5 text-xs outline-none"
                                      />
                                      <textarea 
                                        placeholder="Cuerpo Email"
                                        value={chat.actionPdfBody} 
                                        onChange={e => updateChatConfig(chat.id, 'actionPdfBody', e.target.value)}
                                        className="w-full bg-zinc-900 border border-zinc-800 rounded px-2 py-1.5 text-xs outline-none h-16 resize-none"
                                      />
                                    </div>
                                  </div>

                                  {/* Error Actions */}
                                  <div className="p-4 bg-zinc-950 border border-zinc-800 rounded-xl space-y-3">
                                    <div className="flex items-center justify-between border-b border-zinc-800 pb-2">
                                      <span className="text-xs font-bold text-zinc-100 uppercase tracking-wider">Acciones Errores (NSS/CURP)</span>
                                      <div className="flex gap-4">
                                        <label className="flex items-center gap-2 text-[10px] font-bold text-zinc-500">
                                          EMAIL
                                          <input type="checkbox" checked={chat.nssActionEmailEnabled} onChange={e => updateChatConfig(chat.id, 'nssActionEmailEnabled', e.target.checked)} />
                                        </label>
                                        <label className="flex items-center gap-2 text-[10px] font-bold text-zinc-500">
                                          WA
                                          <input type="checkbox" checked={chat.nssActionWaEnabled} onChange={e => updateChatConfig(chat.id, 'nssActionWaEnabled', e.target.checked)} />
                                        </label>
                                      </div>
                                    </div>
                                    <div className="space-y-2">
                                      <div className="grid grid-cols-2 gap-2">
                                        <input 
                                          type="text" 
                                          placeholder="Palabras NSS (coma)"
                                          value={chat.triggerNssWord} 
                                          onChange={e => updateChatConfig(chat.id, 'triggerNssWord', e.target.value)}
                                          className="w-full bg-zinc-900 border border-zinc-800 rounded px-2 py-1.5 text-xs outline-none"
                                        />
                                        <input 
                                          type="text" 
                                          placeholder="Palabras CURP (coma)"
                                          value={chat.triggerCurpWord} 
                                          onChange={e => updateChatConfig(chat.id, 'triggerCurpWord', e.target.value)}
                                          className="w-full bg-zinc-900 border border-zinc-800 rounded px-2 py-1.5 text-xs outline-none"
                                        />
                                      </div>
                                      <input 
                                        type="text" 
                                        placeholder="Asunto Alerta"
                                        value={chat.actionNssSubject} 
                                        onChange={e => updateChatConfig(chat.id, 'actionNssSubject', e.target.value)}
                                        className="w-full bg-zinc-900 border border-zinc-800 rounded px-2 py-1.5 text-xs outline-none"
                                      />
                                      <textarea 
                                        placeholder="Cuerpo Alerta"
                                        value={chat.actionNssBody} 
                                        onChange={e => updateChatConfig(chat.id, 'actionNssBody', e.target.value)}
                                        className="w-full bg-zinc-900 border border-zinc-800 rounded px-2 py-1.5 text-xs outline-none h-16 resize-none"
                                      />
                                    </div>
                                  </div>
                                </div>
                              </div>
                            </motion.div>
                          )}
                        </AnimatePresence>
                      </div>
                    ))}
                  </div>
                </div>
              </motion.div>
            )}

            {activeTab === 'audit' && (
              <motion.div 
                key="audit"
                initial={{ opacity: 0, y: 10 }}
                animate={{ opacity: 1, y: 0 }}
                exit={{ opacity: 0, y: -10 }}
                className="space-y-8"
              >
                <Card title="Plantillas de Reportes Automáticos" icon={Plus} className="border-emerald-500/20">
                  <div className="space-y-6">
                    <div className="flex flex-col md:flex-row md:items-center justify-between gap-4 p-4 bg-emerald-500/5 border border-emerald-500/10 rounded-xl">
                      <div>
                        <h4 className="text-sm font-bold text-emerald-500">Generador de Reportes Personalizados</h4>
                        <p className="text-xs text-zinc-400">Crea variaciones del reporte con diferentes columnas, horarios y destinatarios (Email/WhatsApp).</p>
                      </div>
                      <button 
                        onClick={() => {
                          if (!config) return;
                          const newTemplate: AuditTemplate = {
                            id: Math.random().toString(36).substr(2, 9),
                            name: 'Nueva Plantilla de Reporte',
                            columns: ['date', 'time', 'contact', 'nss', 'curp', 'status'],
                            emailEnabled: false,
                            emailTargets: '',
                            waEnabled: false,
                            waTargets: '',
                            schedule: '23:59'
                          };
                          setConfig({ ...config, auditTemplates: [...(config.auditTemplates || []), newTemplate] });
                        }}
                        className="flex items-center justify-center gap-2 px-6 py-2.5 bg-emerald-600 text-white rounded-lg font-bold text-sm hover:bg-emerald-500 transition-all shadow-lg shadow-emerald-600/20"
                      >
                        <Plus size={18} /> Crear Nueva Plantilla
                      </button>
                    </div>

                    <div className="grid grid-cols-1 gap-4">
                      {(config?.auditTemplates || []).map((template) => (
                        <div key={template.id} className="bg-zinc-950 border border-zinc-800 rounded-xl p-6 space-y-6">
                          <div className="flex items-center justify-between">
                            <div className="flex items-center gap-4">
                              <div className="w-10 h-10 rounded-lg bg-zinc-900 flex items-center justify-center text-zinc-400">
                                <FileText size={20} />
                              </div>
                              <input 
                                type="text" 
                                value={template.name} 
                                onChange={e => {
                                  if (!config) return;
                                  setConfig({
                                    ...config,
                                    auditTemplates: config.auditTemplates?.map(t => t.id === template.id ? { ...t, name: e.target.value } : t)
                                  });
                                }}
                                className="bg-transparent border-b border-transparent hover:border-zinc-700 focus:border-zinc-500 outline-none text-lg font-bold text-zinc-100 transition-all"
                              />
                            </div>
                            <button 
                              onClick={() => {
                                if (!config) return;
                                setConfig({ ...config, auditTemplates: config.auditTemplates?.filter(t => t.id !== template.id) });
                              }}
                              className="p-2 text-zinc-600 hover:text-rose-500 transition-colors"
                            >
                              <Trash2 size={18} />
                            </button>
                          </div>

                          <div className="grid grid-cols-1 md:grid-cols-2 gap-8">
                            <div className="space-y-4">
                              <div className="space-y-2">
                                <label className="text-[10px] text-zinc-500 uppercase font-bold tracking-widest">Columnas a incluir</label>
                                <div className="flex flex-wrap gap-2">
                                  {['date', 'time', 'contact', 'nss', 'curp', 'status', 'error', 'message'].map(col => (
                                    <button 
                                      key={col}
                                      onClick={() => {
                                        if (!config) return;
                                        const newCols = template.columns.includes(col) 
                                          ? template.columns.filter(c => c !== col)
                                          : [...template.columns, col];
                                        setConfig({
                                          ...config,
                                          auditTemplates: config.auditTemplates?.map(t => t.id === template.id ? { ...t, columns: newCols } : t)
                                        });
                                      }}
                                      className={`px-3 py-1 rounded-full text-[10px] font-bold uppercase transition-all ${template.columns.includes(col) ? 'bg-zinc-100 text-black' : 'bg-zinc-900 text-zinc-500 border border-zinc-800'}`}
                                    >
                                      {col}
                                    </button>
                                  ))}
                                </div>
                              </div>
                              <div className="space-y-1.5">
                                <label className="text-[10px] text-zinc-500 uppercase font-bold tracking-widest">Horario de Envío (HH:MM)</label>
                                <input 
                                  type="text" 
                                  value={template.schedule} 
                                  onChange={e => {
                                    if (!config) return;
                                    setConfig({
                                      ...config,
                                      auditTemplates: config.auditTemplates?.map(t => t.id === template.id ? { ...t, schedule: e.target.value } : t)
                                    });
                                  }}
                                  className="w-full bg-zinc-900 border border-zinc-800 rounded-lg px-3 py-2 text-sm focus:border-zinc-500 outline-none transition-all"
                                />
                              </div>
                            </div>

                            <div className="space-y-4">
                              <div className="p-4 bg-zinc-900 border border-zinc-800 rounded-xl space-y-4">
                                <div className="flex items-center justify-between">
                                  <div className="flex items-center gap-2">
                                    <Mail size={16} className="text-zinc-400" />
                                    <span className="text-xs font-bold text-zinc-200">Envío por Email</span>
                                  </div>
                                  <input 
                                    type="checkbox" 
                                    checked={template.emailEnabled} 
                                    onChange={e => {
                                      if (!config) return;
                                      setConfig({
                                        ...config,
                                        auditTemplates: config.auditTemplates?.map(t => t.id === template.id ? { ...t, emailEnabled: e.target.checked } : t)
                                      });
                                    }}
                                    className="w-4 h-4 accent-zinc-100"
                                  />
                                </div>
                                <input 
                                  type="text" 
                                  placeholder="Destinatarios (coma)"
                                  value={template.emailTargets} 
                                  onChange={e => {
                                    if (!config) return;
                                    setConfig({
                                      ...config,
                                      auditTemplates: config.auditTemplates?.map(t => t.id === template.id ? { ...t, emailTargets: e.target.value } : t)
                                    });
                                  }}
                                  className="w-full bg-zinc-950 border border-zinc-800 rounded-lg px-3 py-2 text-xs focus:border-zinc-500 outline-none transition-all"
                                  disabled={!template.emailEnabled}
                                />
                              </div>

                              <div className="p-4 bg-zinc-900 border border-zinc-800 rounded-xl space-y-4">
                                <div className="flex items-center justify-between">
                                  <div className="flex items-center gap-2">
                                    <MessageSquare size={16} className="text-zinc-400" />
                                    <span className="text-xs font-bold text-zinc-200">Envío por WhatsApp</span>
                                  </div>
                                  <input 
                                    type="checkbox" 
                                    checked={template.waEnabled} 
                                    onChange={e => {
                                      if (!config) return;
                                      setConfig({
                                        ...config,
                                        auditTemplates: config.auditTemplates?.map(t => t.id === template.id ? { ...t, waEnabled: e.target.checked } : t)
                                      });
                                    }}
                                    className="w-4 h-4 accent-zinc-100"
                                  />
                                </div>
                                <input 
                                  type="text" 
                                  placeholder="Nombres de Chats (coma)"
                                  value={template.waTargets} 
                                  onChange={e => {
                                    if (!config) return;
                                    setConfig({
                                      ...config,
                                      auditTemplates: config.auditTemplates?.map(t => t.id === template.id ? { ...t, waTargets: e.target.value } : t)
                                    });
                                  }}
                                  className="w-full bg-zinc-950 border border-zinc-800 rounded-lg px-3 py-2 text-xs focus:border-zinc-500 outline-none transition-all"
                                  disabled={!template.waEnabled}
                                />
                              </div>
                            </div>
                          </div>
                        </div>
                      ))}
                    </div>
                  </div>
                  <div className="mt-6 flex justify-end">
                    <button 
                      onClick={handleSaveConfig}
                      className="px-6 py-2 bg-zinc-100 text-black rounded-lg font-bold text-sm hover:bg-white transition-all shadow-lg shadow-white/10"
                    >
                      Guardar Todas las Plantillas
                    </button>
                  </div>
                </Card>

                <Card title="Registros de Auditoría (Recientes)" icon={FileText}>
                  <div className="flex justify-end mb-4">
                    <a 
                      href="/api/audit/export" 
                      className="flex items-center gap-2 px-4 py-2 bg-blue-600 text-white rounded-lg font-bold text-xs hover:bg-blue-500 transition-all shadow-lg shadow-blue-600/20"
                      download
                    >
                      <Download size={14} /> Exportar Todo (CSV)
                    </a>
                  </div>
                  <div className="overflow-hidden rounded-lg border border-zinc-800">
                    <div className="overflow-x-auto">
                      <table className="w-full text-left text-xs">
                        <thead className="bg-zinc-900 text-zinc-500 uppercase text-[10px] font-bold tracking-widest">
                          <tr>
                            <th className="px-4 py-3">Fecha/Hora</th>
                            <th className="px-4 py-3">Teléfono</th>
                            <th className="px-4 py-3">Acción</th>
                            <th className="px-4 py-3">NSS/CURP</th>
                            <th className="px-4 py-3">Mensaje/Error</th>
                          </tr>
                        </thead>
                        <tbody className="divide-y divide-zinc-800">
                          {auditLogs.length === 0 ? (
                            <tr>
                              <td colSpan={5} className="px-4 py-12 text-center text-zinc-600 italic">No se han generado registros de auditoría aún en la base de datos.</td>
                            </tr>
                          ) : (
                            auditLogs.map((log) => (
                              <tr key={log.id} className="hover:bg-zinc-900/50 transition-colors">
                                <td className="px-4 py-3 font-mono text-zinc-400 whitespace-nowrap">{log.timestamp}</td>
                                <td className="px-4 py-3 text-zinc-300">{log.phone_number}</td>
                                <td className="px-4 py-3">
                                  <span className={`px-2 py-0.5 rounded text-[10px] font-bold ${
                                    log.action_type === 'SUCCESS' ? 'bg-emerald-500/10 text-emerald-500' :
                                    log.action_type === 'ERROR' ? 'bg-rose-500/10 text-rose-500' :
                                    'bg-blue-500/10 text-blue-500'
                                  }`}>
                                    {log.action_type}
                                  </span>
                                </td>
                                <td className="px-4 py-3 font-mono text-zinc-400">
                                  {log.nss && <div>NSS: {log.nss}</div>}
                                  {log.curp && <div>CURP: {log.curp}</div>}
                                </td>
                                <td className="px-4 py-3 max-w-xs truncate text-zinc-500" title={log.message || log.error}>
                                  {log.message || log.error}
                                </td>
                              </tr>
                            ))
                          )}
                        </tbody>
                      </table>
                    </div>
                  </div>
                </Card>

                <Card title="Configuración de Reportes Automáticos" icon={Clock}>
                  <div className="grid grid-cols-1 md:grid-cols-2 gap-8">
                    <div className="space-y-4">
                      <div className="flex items-center justify-between p-3 bg-zinc-950 border border-zinc-800 rounded-lg">
                        <span className="text-sm font-medium">Envío Diario por Email (23:59)</span>
                        <input 
                          type="checkbox" 
                          checked={config?.auditActionEmailEnabled} 
                          onChange={e => config && setConfig({...config, auditActionEmailEnabled: e.target.checked})}
                          className="w-5 h-5 accent-zinc-100"
                        />
                      </div>
                      <div className="space-y-1.5">
                        <label className="text-[10px] text-zinc-500 uppercase font-bold tracking-widest">Destinatarios Email (coma)</label>
                        <input 
                          type="text" 
                          placeholder="email1@example.com, email2@example.com"
                          value={config?.auditEmailTargets || ''} 
                          onChange={e => config && setConfig({...config, auditEmailTargets: e.target.value})}
                          className="w-full bg-zinc-950 border border-zinc-800 rounded-lg px-3 py-2 text-sm focus:border-zinc-500 outline-none transition-all"
                        />
                      </div>
                    </div>
                    <div className="space-y-4">
                      <div className="flex items-center justify-between p-3 bg-zinc-950 border border-zinc-800 rounded-lg">
                        <span className="text-sm font-medium">Envío Diario por WhatsApp (23:59)</span>
                        <input 
                          type="checkbox" 
                          checked={config?.auditActionWaEnabled} 
                          onChange={e => config && setConfig({...config, auditActionWaEnabled: e.target.checked})}
                          className="w-5 h-5 accent-zinc-100"
                        />
                      </div>
                      <div className="space-y-1.5">
                        <label className="text-[10px] text-zinc-500 uppercase font-bold tracking-widest">Nombres de Chats WA (coma)</label>
                        <input 
                          type="text" 
                          placeholder="Grupo Auditoría, Jefe Sistemas"
                          value={config?.auditWaTargets || ''} 
                          onChange={e => config && setConfig({...config, auditWaTargets: e.target.value})}
                          className="w-full bg-zinc-950 border border-zinc-800 rounded-lg px-3 py-2 text-sm focus:border-zinc-500 outline-none transition-all"
                        />
                      </div>
                    </div>
                  </div>
                  <div className="mt-6 flex justify-end">
                    <button 
                      onClick={handleSaveConfig}
                      className="px-6 py-2 bg-zinc-100 text-black rounded-lg font-bold text-sm hover:bg-white transition-all"
                    >
                      Guardar Configuración de Auditoría
                    </button>
                  </div>
                </Card>
              </motion.div>
            )}

            {activeTab === 'update' && (
              <motion.div 
                key="update"
                initial={{ opacity: 0, y: 10 }}
                animate={{ opacity: 1, y: 0 }}
                exit={{ opacity: 0, y: -10 }}
                className="space-y-8"
              >
                <div className="grid grid-cols-1 lg:grid-cols-2 gap-8">
                  <Card title="Repositorio de Origen" icon={Github}>
                    <div className="space-y-4">
                      <div className="space-y-1.5">
                        <label className="text-[10px] text-zinc-500 uppercase font-bold tracking-widest">GitHub Repo (user/repo)</label>
                        <input 
                          type="text" 
                          placeholder="alan-aguilar/whatsapp-bot"
                          value={config?.githubRepo || ''} 
                          onChange={e => config && setConfig({...config, githubRepo: e.target.value})}
                          className="w-full bg-zinc-950 border border-zinc-800 rounded-lg px-3 py-2 text-sm focus:border-zinc-500 outline-none transition-all"
                        />
                      </div>
                      <div className="grid grid-cols-2 gap-4">
                        <div className="space-y-1.5">
                          <label className="text-[10px] text-zinc-500 uppercase font-bold tracking-widest">Rama (Branch)</label>
                          <input 
                            type="text" 
                            placeholder="main"
                            value={config?.githubBranch || ''} 
                            onChange={e => config && setConfig({...config, githubBranch: e.target.value})}
                            className="w-full bg-zinc-950 border border-zinc-800 rounded-lg px-3 py-2 text-sm focus:border-zinc-500 outline-none transition-all"
                          />
                        </div>
                        <div className="space-y-1.5">
                          <label className="text-[10px] text-zinc-500 uppercase font-bold tracking-widest">Token (Opcional)</label>
                          <input 
                            type="password" 
                            placeholder="ghp_..."
                            value={config?.githubToken || ''} 
                            onChange={e => config && setConfig({...config, githubToken: e.target.value})}
                            className="w-full bg-zinc-950 border border-zinc-800 rounded-lg px-3 py-2 text-sm focus:border-zinc-500 outline-none transition-all"
                          />
                        </div>
                      </div>
                      <div className="pt-4 flex gap-4">
                        <button 
                          onClick={checkUpdates}
                          className="flex-1 py-2.5 bg-zinc-800 text-zinc-200 rounded-lg font-bold text-sm hover:bg-zinc-700 transition-all"
                        >
                          Verificar Actualización
                        </button>
                        <button 
                          onClick={handleSaveConfig}
                          className="flex-1 py-2.5 bg-zinc-100 text-black rounded-lg font-bold text-sm hover:bg-white transition-all"
                        >
                          Guardar Configuración
                        </button>
                      </div>
                    </div>
                  </Card>

                  <Card title="Estado de la Versión" icon={Activity}>
                    {updateInfo ? (
                      <div className="space-y-6">
                        <div className="p-4 bg-zinc-950 border border-zinc-800 rounded-xl space-y-4">
                          <div className="flex items-center justify-between">
                            <span className="text-xs text-zinc-500 uppercase font-bold">Último Commit</span>
                            <span className="text-xs font-mono text-zinc-400">{updateInfo.latestCommitSha.substring(0, 7)}</span>
                          </div>
                          <p className="text-sm font-medium text-zinc-100 leading-relaxed">"{updateInfo.commitMessage}"</p>
                          <div className="flex items-center gap-2 text-xs text-zinc-500">
                            <Clock size={12} />
                            {new Date(updateInfo.commitDate).toLocaleString()}
                          </div>
                        </div>

                        {updateInfo.latestCommitSha === updateInfo.currentCommitSha ? (
                          <div className="flex items-center gap-3 p-4 bg-emerald-500/10 border border-emerald-500/20 rounded-xl text-emerald-500">
                            <CheckCircle2 size={20} />
                            <span className="text-sm font-bold">El sistema ya está actualizado a la última versión.</span>
                          </div>
                        ) : (
                          <div className="space-y-4">
                            <div className="flex items-center gap-3 p-4 bg-amber-500/10 border border-amber-500/20 rounded-xl text-amber-500">
                              <AlertTriangle size={20} />
                              <span className="text-sm font-bold">Hay una nueva versión disponible.</span>
                            </div>
                            <button 
                              onClick={handleApplyUpdate}
                              className="w-full py-3 bg-blue-600 text-white rounded-lg font-bold text-sm hover:bg-blue-500 transition-all shadow-lg shadow-blue-600/20"
                            >
                              Descargar y Aplicar Actualización
                            </button>
                          </div>
                        )}
                      </div>
                    ) : (
                      <div className="flex flex-col items-center justify-center py-12 text-zinc-600 space-y-4">
                        <Github size={48} strokeWidth={1} />
                        <p className="text-sm italic">Verifica actualizaciones para ver el estado.</p>
                      </div>
                    )}
                  </Card>
                </div>

                <Card title="Actualización Automática" icon={Clock}>
                  <div className="grid grid-cols-1 md:grid-cols-3 gap-8">
                    <div className="space-y-4">
                      <div className="flex items-center justify-between p-3 bg-zinc-950 border border-zinc-800 rounded-lg">
                        <span className="text-sm font-medium">Habilitar Auto-Update</span>
                        <input 
                          type="checkbox" 
                          checked={config?.autoUpdateCheckEnabled} 
                          onChange={e => config && setConfig({...config, autoUpdateCheckEnabled: e.target.checked})}
                          className="w-5 h-5 accent-zinc-100"
                        />
                      </div>
                    </div>
                    <div className="space-y-1.5">
                      <label className="text-[10px] text-zinc-500 uppercase font-bold tracking-widest">Frecuencia</label>
                      <select 
                        value={config?.autoUpdateFrequency || 'daily'} 
                        onChange={e => config && setConfig({...config, autoUpdateFrequency: e.target.value as any})}
                        className="w-full bg-zinc-950 border border-zinc-800 rounded-lg px-3 py-2 text-sm focus:border-zinc-500 outline-none transition-all"
                      >
                        <option value="daily">Diario</option>
                        <option value="weekly">Semanal</option>
                        <option value="custom">Cada X días</option>
                      </select>
                    </div>
                    <div className="space-y-1.5">
                      <label className="text-[10px] text-zinc-500 uppercase font-bold tracking-widest">Hora de Ejecución (HH:MM)</label>
                      <input 
                        type="text" 
                        placeholder="03:00"
                        value={config?.autoUpdateHour || ''} 
                        onChange={e => config && setConfig({...config, autoUpdateHour: e.target.value})}
                        className="w-full bg-zinc-950 border border-zinc-800 rounded-lg px-3 py-2 text-sm focus:border-zinc-500 outline-none transition-all"
                      />
                    </div>
                  </div>
                  <div className="mt-6 flex justify-end">
                    <button 
                      onClick={handleSaveConfig}
                      className="px-6 py-2 bg-zinc-100 text-black rounded-lg font-bold text-sm hover:bg-white transition-all"
                    >
                      Guardar Configuración de Auto-Update
                    </button>
                  </div>
                </Card>
              </motion.div>
            )}

            {activeTab === 'help' && (
              <motion.div
                key="help"
                initial={{ opacity: 0, y: 20 }}
                animate={{ opacity: 1, y: 0 }}
                exit={{ opacity: 0, y: -20 }}
                className="space-y-8"
              >
                <div className="grid grid-cols-1 md:grid-cols-2 gap-8">
                  <Card title="Guía de Configuración" icon={BookOpen}>
                    <div className="space-y-6">
                      <div className="space-y-2">
                        <h3 className="text-sm font-bold text-zinc-100 flex items-center gap-2">
                          <Zap size={16} className="text-amber-500" /> Disparadores (Triggers)
                        </h3>
                        <p className="text-xs text-zinc-500 leading-relaxed">
                          Configura palabras clave que activen el bot. Por ejemplo, "NSS" o "CURP". El bot buscará estos patrones en el texto del mensaje o en archivos PDF adjuntos.
                        </p>
                      </div>
                      <div className="space-y-2">
                        <h3 className="text-sm font-bold text-zinc-100 flex items-center gap-2">
                          <ShieldCheck size={16} className="text-emerald-500" /> Seguridad y Auditoría
                        </h3>
                        <p className="text-xs text-zinc-500 leading-relaxed">
                          Cada acción exitosa o fallida se registra en la pestaña de Auditoría. Puedes configurar reportes diarios automáticos que se envían por correo o WhatsApp.
                        </p>
                      </div>
                      <div className="space-y-2">
                        <h3 className="text-sm font-bold text-zinc-100 flex items-center gap-2">
                          <Database size={16} className="text-blue-500" /> Límites de Envío
                        </h3>
                        <p className="text-xs text-zinc-500 leading-relaxed">
                          Para evitar bloqueos de Gmail o WhatsApp, el sistema tiene límites diarios configurables. Se recomienda no exceder los 500 correos diarios en cuentas gratuitas.
                        </p>
                      </div>
                    </div>
                  </Card>

                  <Card title="Preguntas Frecuentes" icon={HelpCircle}>
                    <div className="space-y-4">
                      <details className="group bg-zinc-950 border border-zinc-900 rounded-lg p-3 cursor-pointer">
                        <summary className="text-xs font-bold text-zinc-300 list-none flex justify-between items-center">
                          ¿Cómo conecto mi WhatsApp?
                          <ChevronRight size={14} className="group-open:rotate-90 transition-transform" />
                        </summary>
                        <p className="text-[11px] text-zinc-500 mt-2">
                          Haz clic en "Iniciar Bot" en el panel lateral. Se mostrará un código QR que debes escanear desde la app de WhatsApp en tu teléfono (Dispositivos vinculados).
                        </p>
                      </details>
                      <details className="group bg-zinc-950 border border-zinc-900 rounded-lg p-3 cursor-pointer">
                        <summary className="text-xs font-bold text-zinc-300 list-none flex justify-between items-center">
                          ¿Qué archivos PDF soporta?
                          <ChevronRight size={14} className="group-open:rotate-90 transition-transform" />
                        </summary>
                        <p className="text-[11px] text-zinc-500 mt-2">
                          Soporta cualquier PDF que contenga texto legible. Si el PDF es una imagen (escaneado), el bot no podrá extraer los datos a menos que se use OCR (no incluido en esta versión).
                        </p>
                      </details>
                      <details className="group bg-zinc-950 border border-zinc-900 rounded-lg p-3 cursor-pointer">
                        <summary className="text-xs font-bold text-zinc-300 list-none flex justify-between items-center">
                          ¿El bot funciona si cierro la pestaña?
                          <ChevronRight size={14} className="group-open:rotate-90 transition-transform" />
                        </summary>
                        <p className="text-[11px] text-zinc-500 mt-2">
                          Sí. El bot corre en el servidor. Una vez iniciado, seguirá procesando mensajes aunque cierres el navegador.
                        </p>
                      </details>
                    </div>
                  </Card>
                  <Card title="Historial de Versiones" icon={Clock}>
                    <div className="space-y-3 max-h-[200px] overflow-y-auto pr-2 custom-scrollbar">
                      <div className="p-2 bg-zinc-950 border border-zinc-900 rounded-lg">
                        <div className="flex justify-between items-center mb-1">
                          <span className="text-[10px] font-bold text-zinc-100">v8.5.0</span>
                          <span className="text-[9px] text-zinc-600 uppercase">Actual</span>
                        </div>
                        <p className="text-[10px] text-zinc-500">Fase 5: Guía de Ayuda, Documentación y Versionado Inteligente.</p>
                      </div>
                      <div className="p-2 bg-zinc-950/50 border border-zinc-900/50 rounded-lg">
                        <div className="flex justify-between items-center mb-1">
                          <span className="text-[10px] font-bold text-zinc-400">v8.4.0</span>
                        </div>
                        <p className="text-[10px] text-zinc-600">Fase 4: Estabilidad, Reconexión y Notificaciones (Sonner).</p>
                      </div>
                      <div className="p-2 bg-zinc-950/50 border border-zinc-900/50 rounded-lg">
                        <div className="flex justify-between items-center mb-1">
                          <span className="text-[10px] font-bold text-zinc-400">v8.3.0</span>
                        </div>
                        <p className="text-[10px] text-zinc-600">Fase 3: Dashboard Moderno y Gráficas de Rendimiento.</p>
                      </div>
                      <div className="p-2 bg-zinc-950/50 border border-zinc-900/50 rounded-lg">
                        <div className="flex justify-between items-center mb-1">
                          <span className="text-[10px] font-bold text-zinc-400">v8.2.0</span>
                        </div>
                        <p className="text-[10px] text-zinc-600">Fase 2: Extracción NSS/CURP y Notificaciones Email/WA.</p>
                      </div>
                      <div className="p-2 bg-zinc-950/50 border border-zinc-900/50 rounded-lg">
                        <div className="flex justify-between items-center mb-1">
                          <span className="text-[10px] font-bold text-zinc-400">v8.1.0</span>
                        </div>
                        <p className="text-[10px] text-zinc-600">Fase 1: Migración a SQLite y Estructura Base.</p>
                      </div>
                      <div className="p-2 bg-zinc-950/50 border border-zinc-900/50 rounded-lg">
                        <div className="flex justify-between items-center mb-1">
                          <span className="text-[10px] font-bold text-zinc-400">v8.0.0</span>
                        </div>
                        <p className="text-[10px] text-zinc-600">Versión Base de GitHub.</p>
                      </div>
                    </div>
                  </Card>
                </div>

                <div className="p-6 bg-zinc-950 border border-zinc-900 rounded-2xl flex items-center justify-between">
                  <div className="flex items-center gap-4">
                    <div className="w-12 h-12 rounded-full bg-zinc-900 flex items-center justify-center text-zinc-400">
                      <Cpu size={24} />
                    </div>
                    <div>
                      <h4 className="text-sm font-bold text-zinc-100">Soporte Técnico</h4>
                      <p className="text-xs text-zinc-500">Versión {status?.version || 'v8.0.0'} - Sendify PRO Enterprise</p>
                    </div>
                  </div>
                  <button className="px-4 py-2 bg-zinc-900 text-zinc-300 rounded-lg text-xs font-bold hover:bg-zinc-800 transition-all border border-zinc-800">
                    Contactar Desarrollador
                  </button>
                </div>
              </motion.div>
            )}
          </AnimatePresence>
        )}
        </main>
      </div>

      <style>{`
        .custom-scrollbar::-webkit-scrollbar {
          width: 4px;
        }
        .custom-scrollbar::-webkit-scrollbar-track {
          background: transparent;
        }
        .custom-scrollbar::-webkit-scrollbar-thumb {
          background: #27272a;
          border-radius: 10px;
        }
        .custom-scrollbar::-webkit-scrollbar-thumb:hover {
          background: #3f3f46;
        }
      `}</style>
    </div>
  );
}
