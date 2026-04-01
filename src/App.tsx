import React, { useState, useEffect, useCallback, useRef } from 'react';
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
  ChevronLeft,
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
  Zap,
  Layers
} from 'lucide-react';
import { motion, AnimatePresence } from 'motion/react';
import { Toaster, toast } from 'sonner';

// --- Types ---
interface Stats {
  processedPdfs: number;
  emailsSent: number;
  errorsDetected: number;
  lastProcessedFile?: string;
  lastEmailError?: string;
  recentFiles?: string[];
  recentEvents?: any[];
  recentEmails?: any[];
  emailQueue?: any[];
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
  emailQueue?: any[];
}

interface LogEntry {
  time: string;
  level: string;
  message: string;
}

interface AutomationRule {
  id: string;
  name: string;
  type: 'text' | 'file';
  subtype: string; // 'exact', 'contains', 'regex' for text; 'pdf', 'image', 'video', 'doc', 'any' for file
  triggerValue: string;
  emailEnabled: boolean;
  emailTargets: string;
  emailSubject: string;
  emailBody: string;
  emailSubjectGrouped?: string;
  emailBodyGrouped?: string;
  emailAttachmentName?: string;
  waEnabled: boolean;
  waTargets: string;
  waMessage: string;
  waAttachmentName?: string;
}

interface ChatConfig {
  id: string;
  targetContact: string;
  messageDirection: 'received' | 'sent' | 'both';
  processingMode: 'simple' | 'exhaustive';
  rules: AutomationRule[];
  emailBcc?: string;
  emailCc?: string;
  enabled?: boolean;
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
  initialFetchLimit?: number;
  initialFetchMode?: 'limit' | 'date';
  initialFetchDate?: string;
  auditActionEmailEnabled: boolean;
  auditEmailTargets: string;
  auditEmailSchedule?: string;
  auditActionWaEnabled: boolean;
  auditWaTargets: string;
  auditWaSchedule?: string;
  githubRepo?: string;
  githubBranch?: string;
  githubToken?: string;
  currentCommitSha?: string;
  autoUpdateCheckEnabled?: boolean;
  autoUpdateHour?: string;
  autoUpdateFrequency?: 'daily' | 'weekly' | 'custom';
  autoUpdateCustomDays?: number;
  validationSweepEnabled?: boolean;
  validationSweepFrequency?: 'daily' | 'weekly' | 'monthly';
  validationSweepTime?: string;
  validationSweepEmailTargets?: string;
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

const Card = ({ children, title, icon: Icon, className = "", action }: { children: React.ReactNode, title: string, icon?: any, className?: string, action?: React.ReactNode }) => (
  <div className={`bg-zinc-900 border border-zinc-800 rounded-xl overflow-hidden ${className}`}>
    <div className="px-4 py-3 border-b border-zinc-800 flex items-center justify-between bg-zinc-900/50">
      <div className="flex items-center gap-2">
        {Icon && <Icon size={18} className="text-zinc-400" />}
        <h3 className="text-sm font-medium text-zinc-200 uppercase tracking-wider">{title}</h3>
      </div>
      {action && <div>{action}</div>}
    </div>
    <div className="p-4">
      {children}
    </div>
  </div>
);

const StatCard = ({ label, value, icon: Icon, colorClass, children, isExpanded }: { label: string, value: number | string, icon: any, colorClass: string, children?: React.ReactNode, isExpanded?: boolean }) => (
  <div className="bg-zinc-900 border border-zinc-800 rounded-xl overflow-hidden flex flex-col">
    <div className="p-4 flex items-center justify-between">
      <div className="flex items-center gap-4">
        <div className={`p-3 rounded-lg ${colorClass} bg-opacity-10`}>
          <Icon size={24} className={colorClass.replace('bg-', 'text-')} />
        </div>
        <div>
          <p className="text-xs text-zinc-500 uppercase tracking-widest font-medium">{label}</p>
          <p className="text-2xl font-mono font-bold text-zinc-100">{value}</p>
        </div>
      </div>
    </div>
    <AnimatePresence>
      {isExpanded && children && (
        <motion.div
          initial={{ height: 0, opacity: 0 }}
          animate={{ height: 'auto', opacity: 1 }}
          exit={{ height: 0, opacity: 0 }}
          transition={{ duration: 0.2 }}
          className="border-t border-zinc-800/50 bg-zinc-900/50"
        >
          <div className="p-4">
            {children}
          </div>
        </motion.div>
      )}
    </AnimatePresence>
  </div>
);

export default function App() {
  const [status, setStatus] = useState<BotStatus | null>(null);
  const [logs, setLogs] = useState<LogEntry[]>([]);
  const logsEndRef = useRef<HTMLDivElement>(null);
  const [config, setConfig] = useState<Config | null>(null);
  const [auditLogs, setAuditLogs] = useState<any[]>([]);
  const [updateInfo, setUpdateInfo] = useState<UpdateInfo | null>(null);
  const [activeTab, setActiveTab] = useState<'dashboard' | 'settings' | 'audit' | 'update' | 'help'>('dashboard');
  const [isSaving, setIsSaving] = useState(false);
  const [expandedChat, setExpandedChat] = useState<string | null>(null);
  const [isSidebarCollapsed, setIsSidebarCollapsed] = useState(false);
  const hasInitializedSidebar = useRef(false);

  const [statsStartDate, setStatsStartDate] = useState(new Date().toISOString().split('T')[0]);
  const [statsEndDate, setStatsEndDate] = useState(new Date().toISOString().split('T')[0]);
  const [auditStats, setAuditStats] = useState<{total: number, email: number, whatsapp: number} | null>(null);

  const fetchStats = useCallback(async () => {
    try {
      const response = await fetch(`/api/audit/stats?startDate=${statsStartDate}&endDate=${statsEndDate}`);
      if (response.ok) {
        const data = await response.json();
        setAuditStats(data);
      }
    } catch (error) {
      console.error('Error fetching stats:', error);
    }
  }, [statsStartDate, statsEndDate]);

  useEffect(() => {
    if (activeTab === 'audit') {
      fetchStats();
    }
  }, [activeTab, fetchStats]);

  useEffect(() => {
    if (status && !hasInitializedSidebar.current) {
      if (status.status === 'running' || status.status === 'starting') {
        setIsSidebarCollapsed(true);
      }
      hasInitializedSidebar.current = true;
    }
  }, [status]);
  const [areStatCardsExpanded, setAreStatCardsExpanded] = useState(false);
  const [autoScroll, setAutoScroll] = useState(true);
  const [isUpdating, setIsUpdating] = useState(false);
  const [updateProgress, setUpdateProgress] = useState("");

  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const channel = new BroadcastChannel('sendify_pro_session');
    channel.postMessage({ type: 'NEW_TAB_OPENED' });
    
    channel.onmessage = (event) => {
      if (event.data.type === 'NEW_TAB_OPENED' && isUpdating) {
        setUpdateProgress("Se ha abierto una nueva ventana con la versión actualizada. Puedes cerrar esta.");
        setTimeout(() => {
          window.close();
        }, 3000);
      }
    };
    
    return () => channel.close();
  }, [isUpdating]);

  const fetchStatus = useCallback(async () => {
    try {
      const res = await fetch('/api/status');
      if (!res.ok) throw new Error(`Status API: ${res.status}`);
      const data = await res.json();
      setStatus(data);
      setError(null);
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

  const logsContainerRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (autoScroll && logsContainerRef.current) {
      logsContainerRef.current.scrollTop = logsContainerRef.current.scrollHeight;
    }
  }, [logs, autoScroll]);

  const fetchConfig = useCallback(async (force = false) => {
    // Si estamos en la pestaña de configuración, auditoría o actualización, no sobrescribimos a menos que se fuerce (ej. al entrar a la pestaña)
    if ((activeTab === 'settings' || activeTab === 'audit' || activeTab === 'update') && !force) return;
    
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
      setIsSidebarCollapsed(true);
      fetchStatus();
    } catch (e) {
      toast.error("Error al iniciar el bot");
    }
  };

  const handleStopBot = async () => {
    try {
      await fetch('/api/bot/stop', { method: 'POST' });
      toast.success("Deteniendo bot...");
      setIsSidebarCollapsed(false);
      fetchStatus();
    } catch (e) {
      toast.error("Error al detener el bot");
    }
  };

  const handleLogoutBot = async () => {
    try {
      const res = await fetch('/api/bot/logout', { method: 'POST' });
      const data = await res.json();
      toast.success(data.message || "Sesión eliminada.");
      fetchStatus();
    } catch (e) {
      toast.error("Error al cerrar sesión");
    }
  };

  const handleClearCache = async () => {
    try {
      const res = await fetch('/api/bot/clear-cache', { method: 'POST' });
      const data = await res.json();
      if (res.ok) {
        toast.success(data.message || "Caché de mensajes borrada.");
      } else {
        throw new Error(data.message || "Error al borrar caché.");
      }
    } catch (e: any) {
      toast.error(e.message || "Error al conectar con el servidor.");
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
    if (!window.confirm("¿Estás seguro de aplicar la actualización? El bot descargará los archivos, compilará y se reiniciará. Este proceso puede tardar un minuto.")) return;
    
    setIsUpdating(true);
    setUpdateProgress("Descargando archivos y preparando actualización...");
    
    try {
      const res = await fetch('/api/update/apply', { method: 'POST' });
      if (res.ok) {
        setUpdateProgress("Actualización en curso. El servidor se está reiniciando. Por favor, espera...");
        
        // Start polling the server to see when it's back
        const pollInterval = setInterval(async () => {
          try {
            const statusRes = await fetch('/api/status');
            if (statusRes.ok) {
              clearInterval(pollInterval);
              setUpdateProgress("¡Actualización completada! Recargando esta ventana...");
              setTimeout(() => {
                window.location.reload();
              }, 2000);
            }
          } catch (e) {
            // Server is down, keep polling
          }
        }, 5000);
      } else {
        const data = await res.json();
        toast.error(data.error || "Error al aplicar actualización.");
        setIsUpdating(false);
      }
    } catch (e) {
      toast.error("Error de conexión durante la actualización.");
      setIsUpdating(false);
    }
  };

  const addChatConfig = () => {
    if (!config) return;
    const newChat: ChatConfig = {
      id: Math.random().toString(36).substr(2, 9),
      targetContact: 'Nuevo Chat / Grupo',
      messageDirection: 'both',
      processingMode: 'simple',
      rules: [],
      emailCc: '',
      emailBcc: '',
      enabled: true
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

  const addRule = (chatId: string) => {
    if (!config) return;
    const newRule: AutomationRule = {
      id: Math.random().toString(36).substr(2, 9),
      name: 'Nueva Regla',
      type: 'text',
      subtype: 'contains',
      triggerValue: '',
      emailEnabled: false,
      emailTargets: '',
      emailSubject: 'Alerta: Coincidencia detectada',
      emailBody: 'Se ha detectado una coincidencia en el mensaje: {original_message}',
      emailSubjectGrouped: '[Sendify PRO Lote] {count} reportes de {rule_name}',
      emailBodyGrouped: 'Se han procesado {count} coincidencias para la regla {rule_name}:\n\n{grouped_content}',
      waEnabled: false,
      waTargets: '',
      waMessage: 'Alerta: Coincidencia detectada en el mensaje: {original_message}'
    };
    setConfig({
      ...config,
      chatConfigs: config.chatConfigs.map(c => c.id === chatId ? { ...c, rules: [...(c.rules || []), newRule] } : c)
    });
  };

  const removeRule = (chatId: string, ruleId: string) => {
    if (!config) return;
    setConfig({
      ...config,
      chatConfigs: config.chatConfigs.map(c => c.id === chatId ? { ...c, rules: c.rules.filter(r => r.id !== ruleId) } : c)
    });
  };

  const updateRule = (chatId: string, ruleId: string, field: keyof AutomationRule, value: any) => {
    if (!config) return;
    setConfig({
      ...config,
      chatConfigs: config.chatConfigs.map(c => c.id === chatId ? {
        ...c,
        rules: c.rules.map(r => {
          if (r.id === ruleId) {
            const updatedRule = { ...r, [field]: value };
            // Reset subtype if type changes to prevent inconsistent states
            if (field === 'type') {
              updatedRule.subtype = value === 'text' ? 'contains' : 'pdf';
              updatedRule.triggerValue = ''; // Clear trigger value when type changes
            }
            return updatedRule;
          }
          return r;
        })
      } : c)
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
      
      {isUpdating && (
        <div className="fixed inset-0 z-[9999] bg-black/90 backdrop-blur-md flex flex-col items-center justify-center p-6 text-center">
          <div className="w-20 h-20 border-4 border-zinc-700 border-t-zinc-100 rounded-full animate-spin mb-8" />
          <h2 className="text-2xl font-bold text-white mb-4">Actualizando Sendify PRO</h2>
          <p className="text-zinc-400 leading-relaxed">{updateProgress}</p>
          <p className="mt-8 text-xs text-zinc-500 uppercase tracking-widest animate-pulse">No cierres esta ventana</p>
          <button 
            onClick={() => window.close()}
            className="mt-12 text-zinc-500 hover:text-zinc-300 text-sm underline underline-offset-4"
          >
            Cerrar esta pestaña manualmente
          </button>
        </div>
      )}
      
      {/* Sidebar */}
      <motion.div 
        animate={{ width: isSidebarCollapsed ? '80px' : '256px' }}
        transition={{ duration: 0.3, ease: "easeInOut" }}
        className="fixed left-0 top-0 bottom-0 bg-zinc-950 border-r border-zinc-900 flex flex-col z-50 overflow-hidden"
      >
        <div className="p-6 border-b border-zinc-900 flex items-center justify-between shrink-0 h-20">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 bg-zinc-100 rounded-lg flex items-center justify-center text-black font-bold text-xl shrink-0">S</div>
            <AnimatePresence>
              {!isSidebarCollapsed && (
                <motion.div
                  initial={{ opacity: 0, width: 0 }}
                  animate={{ opacity: 1, width: 'auto' }}
                  exit={{ opacity: 0, width: 0 }}
                  className="whitespace-nowrap overflow-hidden"
                >
                  <h1 className="text-lg font-bold text-zinc-100 tracking-tight leading-none">Sendify PRO</h1>
                  <p className="text-[10px] text-zinc-500 uppercase tracking-[0.2em] font-bold mt-1">WhatsApp Bot PRO</p>
                </motion.div>
              )}
            </AnimatePresence>
          </div>
          <button 
            onClick={() => setIsSidebarCollapsed(!isSidebarCollapsed)}
            className="text-zinc-500 hover:text-zinc-300 transition-colors shrink-0"
          >
            <ChevronLeft size={20} className={`transform transition-transform duration-300 ${isSidebarCollapsed ? 'rotate-180' : ''}`} />
          </button>
        </div>

        <nav className="flex-1 p-4 space-y-2 overflow-y-auto custom-scrollbar">
          {[
            { id: 'dashboard', icon: Activity, label: 'Dashboard' },
            { id: 'settings', icon: Settings, label: 'Configuración' },
            { id: 'audit', icon: FileText, label: 'Auditoría' },
            { id: 'update', icon: Github, label: 'Actualización' },
            { id: 'help', icon: HelpCircle, label: 'Ayuda y Guía' }
          ].map((item) => (
            <button 
              key={item.id}
              onClick={() => setActiveTab(item.id as any)}
              className={`w-full flex items-center gap-3 px-4 py-3 rounded-lg text-sm font-medium transition-all ${activeTab === item.id ? 'bg-zinc-100 text-black' : 'text-zinc-500 hover:bg-zinc-900 hover:text-zinc-200'} ${isSidebarCollapsed ? 'justify-center px-0' : ''}`}
              title={isSidebarCollapsed ? item.label : undefined}
            >
              <item.icon size={18} className="shrink-0" /> 
              <AnimatePresence>
                {!isSidebarCollapsed && (
                  <motion.span
                    initial={{ opacity: 0, width: 0 }}
                    animate={{ opacity: 1, width: 'auto' }}
                    exit={{ opacity: 0, width: 0 }}
                    className="whitespace-nowrap overflow-hidden"
                  >
                    {item.label}
                  </motion.span>
                )}
              </AnimatePresence>
            </button>
          ))}
        </nav>

        <div className="p-6 border-t border-zinc-900 shrink-0">
          <div className={`flex items-center justify-between mb-4 ${isSidebarCollapsed ? 'flex-col gap-2' : ''}`}>
            <AnimatePresence>
              {!isSidebarCollapsed && (
                <motion.span 
                  initial={{ opacity: 0, width: 0 }}
                  animate={{ opacity: 1, width: 'auto' }}
                  exit={{ opacity: 0, width: 0 }}
                  className="text-[10px] text-zinc-500 uppercase font-bold tracking-widest whitespace-nowrap overflow-hidden"
                >
                  Estado
                </motion.span>
              )}
            </AnimatePresence>
            <div className={`flex items-center gap-1.5 px-2 py-1 rounded-md border ${
              status?.status === 'running' ? 'bg-emerald-500/10 border-emerald-500/20 text-emerald-500' :
              status?.status === 'error' ? 'bg-rose-500/10 border-rose-500/20 text-rose-500' :
              'bg-zinc-800/50 border-zinc-700 text-zinc-400'
            }`}>
              <div className={`w-1.5 h-1.5 rounded-full ${
                status?.status === 'running' ? 'bg-emerald-500 animate-pulse' :
                status?.status === 'error' ? 'bg-rose-500' :
                'bg-zinc-500'
              }`} />
              <AnimatePresence>
                {!isSidebarCollapsed && (
                  <motion.span 
                    initial={{ opacity: 0, width: 0 }}
                    animate={{ opacity: 1, width: 'auto' }}
                    exit={{ opacity: 0, width: 0 }}
                    className="text-[10px] uppercase font-bold tracking-wider whitespace-nowrap overflow-hidden"
                  >
                    {status?.status || 'Desconocido'}
                  </motion.span>
                )}
              </AnimatePresence>
            </div>
          </div>
          <div className="space-y-2">
            {status?.status === 'stopped' || status?.status === 'error' ? (
              <button 
                onClick={handleStartBot}
                className={`w-full flex items-center justify-center gap-2 py-2.5 rounded-lg bg-emerald-600 text-white text-sm font-bold hover:bg-emerald-500 transition-colors ${isSidebarCollapsed ? 'px-0' : ''}`}
                title={isSidebarCollapsed ? "Iniciar Bot" : undefined}
              >
                <Play size={16} fill="currentColor" className="shrink-0" /> 
                <AnimatePresence>
                  {!isSidebarCollapsed && (
                    <motion.span
                      initial={{ opacity: 0, width: 0 }}
                      animate={{ opacity: 1, width: 'auto' }}
                      exit={{ opacity: 0, width: 0 }}
                      className="whitespace-nowrap overflow-hidden"
                    >
                      Iniciar Bot
                    </motion.span>
                  )}
                </AnimatePresence>
              </button>
            ) : (
              <button 
                onClick={handleStopBot}
                className={`w-full flex items-center justify-center gap-2 py-2.5 rounded-lg bg-rose-600 text-white text-sm font-bold hover:bg-rose-500 transition-colors ${isSidebarCollapsed ? 'px-0' : ''}`}
                title={isSidebarCollapsed ? "Detener Bot" : undefined}
              >
                <Square size={16} fill="currentColor" className="shrink-0" /> 
                <AnimatePresence>
                  {!isSidebarCollapsed && (
                    <motion.span
                      initial={{ opacity: 0, width: 0 }}
                      animate={{ opacity: 1, width: 'auto' }}
                      exit={{ opacity: 0, width: 0 }}
                      className="whitespace-nowrap overflow-hidden"
                    >
                      Detener Bot
                    </motion.span>
                  )}
                </AnimatePresence>
              </button>
            )}
          </div>
        </div>
      </motion.div>

      {/* Main Content */}
      <motion.div 
        animate={{ paddingLeft: isSidebarCollapsed ? '80px' : '256px' }}
        transition={{ duration: 0.3, ease: "easeInOut" }}
        className="min-h-screen"
      >
        <header className="h-20 border-b border-zinc-900 flex items-center justify-between px-4 bg-black/50 backdrop-blur-md sticky top-0 z-40">
          <div>
            <h2 className="text-xl font-bold text-zinc-100 capitalize">{activeTab}</h2>
            <p className="text-xs text-zinc-500">{status?.version || 'v8.0.0'}</p>
          </div>
          <div className="flex items-center gap-4">
            <div className="flex flex-col items-end">
              <span className="text-[10px] text-zinc-500 uppercase font-bold tracking-widest">CORREOS ENVIADOS HOY</span>
              <span className="text-sm font-mono font-bold text-zinc-200">{status?.stats.emailsSent || 0}</span>
            </div>
          </div>
        </header>

        <main className="p-4 w-full">
          {!config || !status ? (
            <div className="flex flex-col items-center justify-center py-40 space-y-4">
              <RefreshCw size={48} className={`text-zinc-800 ${error ? '' : 'animate-spin'}`} />
              <div className="text-center">
                <p className="text-zinc-500 font-medium animate-pulse">Cargando sistema...</p>
                {error && (
                  <div className="mt-4 p-4 bg-rose-900/20 border border-rose-500/30 rounded-lg">
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
                {/* Stats Grid */}
                <div className="space-y-4">
                  <div className="flex justify-end">
                    <button
                      onClick={() => setAreStatCardsExpanded(!areStatCardsExpanded)}
                      className="flex items-center gap-2 px-3 py-1.5 text-xs font-medium text-zinc-400 hover:text-zinc-200 bg-zinc-900 border border-zinc-800 rounded-lg transition-colors"
                    >
                      {areStatCardsExpanded ? 'Ocultar Detalles' : 'Ver Detalles'}
                      <motion.div animate={{ rotate: areStatCardsExpanded ? 180 : 0 }} transition={{ duration: 0.2 }}>
                        <ChevronDown size={14} />
                      </motion.div>
                    </button>
                  </div>
                  <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
                    <StatCard 
                      label="Archivos Procesados" 
                      value={status?.stats.processedPdfs || 0} 
                      icon={FileText} 
                      colorClass="bg-blue-500"
                      isExpanded={areStatCardsExpanded}
                    >
                    <div className="space-y-4">
                      <div className="flex flex-col py-2 border-b border-zinc-800/50">
                        <span className="text-[10px] text-zinc-500 uppercase font-bold tracking-wider mb-1">Último Archivo</span>
                        <span className="text-sm font-medium text-blue-400 truncate" title={status?.stats.lastProcessedFile}>
                          {status?.stats.lastProcessedFile || 'Ninguno'}
                        </span>
                      </div>
                      <div className="flex justify-between items-center py-2 border-b border-zinc-800/50">
                        <span className="text-xs text-zinc-500 uppercase font-bold">Sesión</span>
                        <span className="text-sm font-medium text-zinc-200">Activa</span>
                      </div>
                      
                      {status?.stats.recentFiles && status.stats.recentFiles.length > 0 && (
                        <div className="flex flex-col py-2 border-b border-zinc-800/50">
                          <span className="text-[10px] text-zinc-500 uppercase font-bold tracking-wider mb-2">Archivos Recientes</span>
                          <div className="space-y-1.5 max-h-32 overflow-y-auto pr-1 custom-scrollbar">
                            {status.stats.recentFiles.map((file: string, idx: number) => (
                              <div key={idx} className="flex items-center gap-2 text-[11px] text-zinc-400 truncate">
                                <FileText size={10} className="shrink-0 text-zinc-600" />
                                <span className="truncate">{file}</span>
                              </div>
                            ))}
                          </div>
                        </div>
                      )}
                      <div className="flex justify-between items-center py-2">
                        <span className="text-xs text-zinc-500 uppercase font-bold">Estado</span>
                        <span className="text-sm font-medium text-emerald-400 flex items-center gap-1.5">
                          <div className="w-1.5 h-1.5 rounded-full bg-emerald-500 animate-pulse" />
                          En línea
                        </span>
                      </div>
                    </div>
                  </StatCard>
                  <StatCard 
                    label="Correos Enviados" 
                    value={status?.stats.emailsSent || 0} 
                    icon={Mail} 
                    colorClass="bg-emerald-500"
                    isExpanded={areStatCardsExpanded}
                  >
                    <div className="space-y-4">
                      {status?.stats.lastEmailError && (
                        <div className="p-2 bg-rose-500/10 border border-rose-500/20 rounded text-[10px] text-rose-400 font-mono break-words">
                          <div className="flex items-center gap-1.5 mb-1 font-bold">
                            <AlertTriangle size={10} />
                            ÚLTIMO ERROR SMTP
                          </div>
                          {status.stats.lastEmailError}
                        </div>
                      )}

                      <div className="flex items-center justify-between">
                        <span className="text-xs text-zinc-500 uppercase font-bold">Estado Agrupación</span>
                        <span className={`text-[10px] font-bold px-2 py-0.5 rounded ${config?.emailBatchingEnabled ? 'bg-emerald-500/10 text-emerald-500' : 'bg-zinc-500/10 text-zinc-500'}`}>
                          {config?.emailBatchingEnabled ? 'ACTIVO' : 'INACTIVO'}
                        </span>
                      </div>

                      {config?.emailBatchingEnabled && (
                        <div className="space-y-3">
                          <div className="flex flex-col py-2 border-b border-zinc-800/50">
                            <span className="text-[10px] text-zinc-500 uppercase font-bold tracking-wider mb-2">Cola de Envío</span>
                            <div className="space-y-1.5 max-h-32 overflow-y-auto pr-1 custom-scrollbar">
                              {Object.entries((status?.stats?.emailQueue || []).reduce((acc: any, item: any) => {
                                acc[item.caseType] = (acc[item.caseType] || 0) + 1;
                                return acc;
                              }, {})).map(([rule, count]: [string, any], idx: number) => (
                                <div key={idx} className="flex justify-between items-center text-[11px]">
                                  <span className="text-zinc-400 truncate pr-2">{rule}</span>
                                  <span className="text-zinc-300 font-mono font-bold bg-zinc-800 px-1.5 py-0.5 rounded">{count} / {config.emailBatchLimit || 20}</span>
                                </div>
                              ))}
                              {(status?.stats?.emailQueue || []).length === 0 && (
                                <div className="text-[10px] text-zinc-600 italic">
                                  Cola vacía
                                </div>
                              )}
                            </div>
                          </div>

                          <div className="pt-2 border-b border-zinc-800/50 pb-3">
                            <p className="text-[9px] text-zinc-500 mb-1">Horarios programados:</p>
                            <div className="flex flex-wrap gap-1.5">
                              {(config.emailSchedules || []).filter(Boolean).map((t, i) => (
                                <span key={i} className="px-1.5 py-0.5 bg-zinc-800 rounded text-[9px] font-mono text-zinc-300 border border-zinc-700">{t}</span>
                              ))}
                              {(config.emailSchedules || []).filter(Boolean).length === 0 && (
                                <span className="text-[9px] text-zinc-600 italic">No programado</span>
                              )}
                            </div>
                          </div>
                        </div>
                      )}

                      {status?.stats?.recentEmails && status.stats.recentEmails.length > 0 && (
                        <div className="flex flex-col py-2">
                          <span className="text-[10px] text-zinc-500 uppercase font-bold tracking-wider mb-2">Últimos Correos</span>
                          <div className="space-y-2 max-h-40 overflow-y-auto pr-1 custom-scrollbar">
                            {status.stats.recentEmails.map((email: any, idx: number) => (
                              <div key={idx} className="p-2 bg-zinc-950 border border-zinc-800/50 rounded-lg text-[10px]">
                                <div className="flex justify-between items-start mb-1">
                                  <span className="font-bold text-emerald-400 truncate pr-2">{email.rule}</span>
                                  <span className="text-zinc-500 shrink-0">{new Date(email.time).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}</span>
                                </div>
                                <div className="text-zinc-300 truncate mb-1" title={email.subject}>{email.subject}</div>
                                <div className="flex items-center gap-1 text-zinc-500">
                                  <FileText size={10} />
                                  <span>{email.attachments} adjunto(s)</span>
                                </div>
                              </div>
                            ))}
                          </div>
                        </div>
                      )}
                    </div>
                  </StatCard>
                  <StatCard 
                    label="Errores Detectados" 
                    value={status?.stats.errorsDetected || 0} 
                    icon={AlertTriangle} 
                    colorClass="bg-rose-500"
                    isExpanded={areStatCardsExpanded}
                  >
                    <div className="space-y-4">
                      <p className="text-xs text-zinc-400">Total de errores detectados durante el procesamiento de mensajes y envío de correos.</p>
                      
                      {status?.stats.recentEvents && status.stats.recentEvents.length > 0 && (
                        <div className="flex flex-col py-2 border-t border-zinc-800/50">
                          <span className="text-[10px] text-zinc-500 uppercase font-bold tracking-wider mb-2">Errores Recientes</span>
                          <div className="space-y-1.5 max-h-32 overflow-y-auto pr-1 custom-scrollbar">
                            {status.stats.recentEvents.map((event: any, idx: number) => (
                              <div key={idx} className="flex flex-col gap-1 p-2 bg-zinc-950 border border-zinc-800/50 rounded-lg text-[10px]">
                                <div className="flex items-center justify-between">
                                  <span className="font-bold text-rose-400">{event.action_type || 'Error'}</span>
                                  <span className="text-zinc-500">{event.timestamp}</span>
                                </div>
                                <span className="text-zinc-300 truncate" title={event.error}>{event.error}</span>
                              </div>
                            ))}
                          </div>
                        </div>
                      )}

                      <button 
                        onClick={() => setActiveTab('audit')}
                        className="text-xs text-rose-400 hover:text-rose-300 underline"
                      >
                        Ver registro de auditoría
                      </button>
                    </div>
                  </StatCard>
                  </div>
                </div>

                <div className="grid grid-cols-1 lg:grid-cols-3 gap-8">
                  {/* Left Column: QR or Info */}
                  <div className="lg:col-span-1 space-y-8">
                    {status?.status === 'awaiting_qr' && status.qrCode && (
                      <Card title="Escanear QR" icon={RefreshCw}>
                        <div className="flex flex-col items-center justify-center p-4 bg-white rounded-lg">
                          <img src={status.qrCode} alt="WhatsApp QR" className="w-full max-w-[250px]" />
                          <p className="mt-4 text-xs text-zinc-900 font-bold text-center">Escanea este código con tu WhatsApp para conectar el bot.</p>
                        </div>
                      </Card>
                    )}
                  </div>

                  {/* Right Column: Logs */}
                  <div className={status?.status === 'awaiting_qr' && status.qrCode ? "lg:col-span-2" : "lg:col-span-3"}>
                    <Card 
                      title="Consola de Eventos" 
                      icon={Database} 
                      className="h-full flex flex-col"
                      action={
                        <button 
                          onClick={() => setAutoScroll(!autoScroll)}
                          className={`flex items-center gap-1.5 px-2 py-1 rounded border text-[10px] font-bold uppercase tracking-wider transition-all ${
                            autoScroll 
                            ? 'bg-blue-500/10 text-blue-500 border-blue-500/20' 
                            : 'bg-zinc-800 text-zinc-500 border-zinc-700'
                          }`}
                        >
                          {autoScroll ? <CheckCircle2 size={12} /> : <Hash size={12} />}
                          Auto-Scroll: {autoScroll ? 'ON' : 'OFF'}
                        </button>
                      }
                    >
                      <div 
                        ref={logsContainerRef}
                        className="flex-1 overflow-y-auto h-[500px] font-mono text-[11px] space-y-1 p-2 bg-[#828385] text-black custom-scrollbar rounded-lg shadow-inner"
                      >
                        {logs.length === 0 ? (
                          <p className="text-zinc-600 italic">Esperando eventos...</p>
                        ) : (
                          logs.map((log, i) => (
                            <div key={i} className="flex gap-3 py-1 border-b border-zinc-400/30 last:border-0">
                              <span className="text-zinc-600 shrink-0">[{new Date(log.time).toLocaleTimeString()}]</span>
                              <span className={`font-bold shrink-0 w-12 ${
                                log.level === 'ERROR' ? 'text-rose-600' : 
                                log.level === 'WARN' ? 'text-amber-600' : 
                                log.level === 'INFO' ? 'text-blue-600' : 'text-zinc-600'
                              }`}>{log.level}</span>
                              <span className="text-black break-words">{log.message}</span>
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
                  <div className="flex items-center gap-4">
                    <button 
                      onClick={() => {
                        if (confirm("¿Estás seguro de borrar el caché de mensajes? El bot volverá a revisar los últimos mensajes configurados como si fueran nuevos.")) {
                          handleClearCache();
                        }
                      }}
                      className="flex items-center gap-2 px-6 py-2.5 bg-amber-600/20 text-amber-500 border border-amber-600/50 rounded-lg font-bold text-sm hover:bg-amber-600 hover:text-white transition-all"
                    >
                      <RefreshCw size={16} />
                      Borrar Caché de Mensajes
                    </button>
                    <button 
                      onClick={handleLogoutBot}
                      className="flex items-center gap-2 px-6 py-2.5 bg-rose-600/20 text-rose-500 border border-rose-600/50 rounded-lg font-bold text-sm hover:bg-rose-600 hover:text-white transition-all"
                    >
                      <LogOut size={16} />
                      Cerrar Sesión WA
                    </button>
                    <button 
                      onClick={handleSaveConfig}
                      disabled={isSaving}
                      className="flex items-center gap-2 px-6 py-2.5 bg-zinc-100 text-black rounded-lg font-bold text-sm hover:bg-white transition-all disabled:opacity-50"
                    >
                      {isSaving ? <RefreshCw size={16} className="animate-spin" /> : <CheckCircle2 size={16} />}
                      Guardar Cambios
                    </button>
                  </div>
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
                        <label className="text-[10px] text-zinc-500 uppercase font-bold tracking-widest">Correo Remitente (El que envía)</label>
                        <input 
                          type="email" 
                          value={config.emailUser} 
                          onChange={e => setConfig({...config, emailUser: e.target.value})}
                          autoComplete="off"
                          placeholder="bot@tuempresa.com"
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
                          placeholder="••••••••••••••••"
                          className="w-full bg-zinc-950 border border-zinc-800 rounded-lg px-3 py-2 text-sm focus:border-zinc-500 outline-none transition-all"
                        />
                        <p className="text-[10px] text-zinc-500 mt-1">Usa una contraseña de aplicación si usas Gmail o Microsoft 365.</p>
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
                  <Card title="Configuración General del Bot" icon={Settings}>
                    <div className="space-y-4">
                      <div className="flex flex-col gap-4 p-4 bg-zinc-950 border border-zinc-800 rounded-lg">
                        <div className="flex items-center justify-between">
                          <div className="flex flex-col">
                            <span className="text-sm font-medium">Modo de recuperación inicial</span>
                            <span className="text-xs text-zinc-500">Cómo buscar mensajes pendientes al iniciar el bot</span>
                          </div>
                          <div className="flex bg-zinc-900 p-1 rounded-lg border border-zinc-800">
                            <button 
                              onClick={() => config && setConfig({...config, initialFetchMode: 'limit'})}
                              className={`px-3 py-1.5 text-[10px] font-bold rounded-md transition-all ${config?.initialFetchMode === 'limit' || !config?.initialFetchMode ? 'bg-zinc-100 text-black' : 'text-zinc-500 hover:text-zinc-300'}`}
                            >
                              POR CANTIDAD
                            </button>
                            <button 
                              onClick={() => config && setConfig({...config, initialFetchMode: 'date'})}
                              className={`px-3 py-1.5 text-[10px] font-bold rounded-md transition-all ${config?.initialFetchMode === 'date' ? 'bg-zinc-100 text-black' : 'text-zinc-500 hover:text-zinc-300'}`}
                            >
                              POR FECHA
                            </button>
                          </div>
                        </div>

                        {config?.initialFetchMode === 'date' ? (
                          <div className="flex items-center justify-between pt-2 border-t border-zinc-900">
                            <div className="flex flex-col">
                              <span className="text-sm font-medium">Fecha de inicio</span>
                              <span className="text-xs text-zinc-500">Buscar mensajes desde esta fecha en adelante</span>
                            </div>
                            <input 
                              type="date" 
                              value={config?.initialFetchDate || new Date().toISOString().split('T')[0]} 
                              onChange={e => config && setConfig({...config, initialFetchDate: e.target.value})}
                              className="bg-zinc-900 border border-zinc-700 rounded-lg px-3 py-1.5 text-sm focus:border-zinc-500 outline-none transition-all text-right"
                            />
                          </div>
                        ) : (
                          <div className="flex items-center justify-between pt-2 border-t border-zinc-900">
                            <div className="flex flex-col">
                              <span className="text-sm font-medium">Límite de mensajes</span>
                              <span className="text-xs text-zinc-500">Cantidad de mensajes a revisar (máx. 500)</span>
                            </div>
                            <input 
                              type="number" 
                              min="1"
                              max="500"
                              value={config?.initialFetchLimit || 50} 
                              onChange={e => config && setConfig({...config, initialFetchLimit: parseInt(e.target.value) || 50})}
                              className="w-24 bg-zinc-900 border border-zinc-700 rounded-lg px-3 py-1.5 text-sm focus:border-zinc-500 outline-none transition-all text-right"
                            />
                          </div>
                        )}
                      </div>
                    </div>
                  </Card>
                </div>

                <div className="space-y-4">
                  <Card title="Barrido de Validación (Sweep)" icon={Search}>
                    <div className="space-y-4">
                      <div className="flex flex-col gap-4 p-4 bg-zinc-950 border border-zinc-800 rounded-lg">
                        <div className="flex items-center justify-between">
                          <div className="flex flex-col">
                            <span className="text-sm font-medium">Habilitar Barrido Automático</span>
                            <span className="text-xs text-zinc-500">Busca y reintenta mensajes no procesados</span>
                          </div>
                          <label className="relative inline-flex items-center cursor-pointer">
                            <input 
                              type="checkbox" 
                              className="sr-only peer"
                              checked={config?.validationSweepEnabled || false}
                              onChange={e => config && setConfig({...config, validationSweepEnabled: e.target.checked})}
                            />
                            <div className="w-9 h-5 bg-zinc-800 peer-focus:outline-none rounded-full peer peer-checked:after:translate-x-full peer-checked:after:border-white after:content-[''] after:absolute after:top-[2px] after:left-[2px] after:bg-white after:border-gray-300 after:border after:rounded-full after:h-4 after:w-4 after:transition-all peer-checked:bg-emerald-500"></div>
                          </label>
                        </div>

                        {config?.validationSweepEnabled && (
                          <>
                            <div className="flex items-center justify-between pt-2 border-t border-zinc-900">
                              <div className="flex flex-col">
                                <span className="text-sm font-medium">Frecuencia</span>
                                <span className="text-xs text-zinc-500">Cada cuánto tiempo ejecutar el barrido</span>
                              </div>
                              <select 
                                value={config?.validationSweepFrequency || 'daily'}
                                onChange={e => config && setConfig({...config, validationSweepFrequency: e.target.value as any})}
                                className="bg-zinc-900 border border-zinc-700 rounded-lg px-3 py-1.5 text-sm focus:border-zinc-500 outline-none transition-all"
                              >
                                <option value="daily">Diario</option>
                                <option value="weekly">Semanal</option>
                                <option value="monthly">Mensual</option>
                              </select>
                            </div>

                            <div className="flex items-center justify-between pt-2 border-t border-zinc-900">
                              <div className="flex flex-col">
                                <span className="text-sm font-medium">Hora de Ejecución</span>
                                <span className="text-xs text-zinc-500">Hora del día para realizar el barrido</span>
                              </div>
                              <input 
                                type="time" 
                                value={config?.validationSweepTime || '02:00'} 
                                onChange={e => config && setConfig({...config, validationSweepTime: e.target.value})}
                                className="bg-zinc-900 border border-zinc-700 rounded-lg px-3 py-1.5 text-sm focus:border-zinc-500 outline-none transition-all"
                              />
                            </div>

                            <div className="flex flex-col gap-2 pt-2 border-t border-zinc-900">
                              <div className="flex flex-col">
                                <span className="text-sm font-medium">Correos para Reporte de Barrido</span>
                                <span className="text-xs text-zinc-500">Separados por comas (ej. admin@empresa.com, jefe@empresa.com)</span>
                              </div>
                              <input 
                                type="text" 
                                placeholder="Destinatarios del reporte..."
                                value={config?.validationSweepEmailTargets || ''} 
                                onChange={e => config && setConfig({...config, validationSweepEmailTargets: e.target.value})}
                                className="w-full bg-zinc-900 border border-zinc-700 rounded-lg px-3 py-2 text-sm focus:border-zinc-500 outline-none transition-all"
                              />
                            </div>
                          </>
                        )}

                        <div className="flex flex-col gap-4 pt-4 border-t border-zinc-900 mt-2">
                          <div className="flex flex-col">
                            <span className="text-sm font-medium text-purple-400">Ejecutar Barrido Manual</span>
                            <span className="text-xs text-zinc-500">Ejecuta el barrido de validación inmediatamente para un rango de fechas.</span>
                          </div>
                          <div className="flex gap-2 items-center">
                            <div className="flex flex-col flex-1 gap-1">
                              <span className="text-[10px] text-zinc-500 uppercase tracking-wider">Desde</span>
                              <input 
                                type="date" 
                                id="manualSweepDate"
                                defaultValue={new Date().toISOString().split('T')[0]}
                                className="w-full bg-zinc-900 border border-zinc-700 rounded-lg px-3 py-2 text-sm focus:border-purple-500 outline-none transition-all"
                              />
                            </div>
                            <div className="flex flex-col flex-1 gap-1">
                              <span className="text-[10px] text-zinc-500 uppercase tracking-wider">Hasta (Opcional)</span>
                              <input 
                                type="date" 
                                id="manualSweepEndDate"
                                className="w-full bg-zinc-900 border border-zinc-700 rounded-lg px-3 py-2 text-sm focus:border-purple-500 outline-none transition-all"
                              />
                            </div>
                            <div className="flex flex-col gap-1 justify-end h-full pt-[18px]">
                              <button 
                                onClick={async () => {
                                  const dateInput = document.getElementById('manualSweepDate') as HTMLInputElement;
                                  const endDateInput = document.getElementById('manualSweepEndDate') as HTMLInputElement;
                                  if (!dateInput.value) {
                                    toast.error('Selecciona una fecha de inicio');
                                    return;
                                  }
                                  
                                  const toastId = toast.loading('Ejecutando barrido de validación...');
                                  try {
                                    const res = await fetch('/api/bot/sweep', {
                                      method: 'POST',
                                      headers: { 'Content-Type': 'application/json' },
                                      body: JSON.stringify({ 
                                        targetDate: dateInput.value,
                                        endDate: endDateInput.value || undefined
                                      })
                                    });
                                    const data = await res.json();
                                    if (data.success) {
                                      toast.success(data.message, { id: toastId });
                                    } else {
                                      toast.error(data.message || 'Error al ejecutar el barrido', { id: toastId });
                                    }
                                  } catch (err: any) {
                                    toast.error(`Error: ${err.message}`, { id: toastId });
                                  }
                                }}
                                className="flex items-center gap-2 px-4 py-2 bg-purple-600 hover:bg-purple-700 text-white rounded-lg font-bold text-sm transition-all h-[38px]"
                              >
                                <Search size={16} /> Ejecutar
                              </button>
                            </div>
                          </div>
                        </div>
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
                              <p className="text-xs text-zinc-500">{chat.rules?.length || 0} Reglas configuradas</p>
                            </div>
                          </div>
                          <div className="flex items-center gap-3">
                            <button
                              onClick={(e) => {
                                e.stopPropagation();
                                updateChatConfig(chat.id, 'enabled', chat.enabled === false ? true : false);
                              }}
                              className={`relative inline-flex h-5 w-9 items-center rounded-full transition-colors ${chat.enabled !== false ? 'bg-emerald-500' : 'bg-zinc-700'}`}
                              title={chat.enabled !== false ? "Chat activado" : "Chat desactivado"}
                            >
                              <span className={`inline-block h-3 w-3 transform rounded-full bg-white transition-transform ${chat.enabled !== false ? 'translate-x-5' : 'translate-x-1'}`} />
                            </button>
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
                              <div className="px-6 pb-6 pt-2 border-t border-zinc-800 space-y-6">
                                {/* Chat Global Settings */}
                                <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4 pt-4">
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
                                    <label className="text-[10px] text-zinc-500 uppercase font-bold tracking-widest">Dirección Mensajes</label>
                                    <select 
                                      value={chat.messageDirection} 
                                      onChange={e => updateChatConfig(chat.id, 'messageDirection', e.target.value as any)}
                                      className="w-full bg-zinc-950 border border-zinc-800 rounded-lg px-3 py-2 text-sm focus:border-zinc-500 outline-none transition-all"
                                    >
                                      <option value="both">Ambos (Entrantes y Salientes)</option>
                                      <option value="received">Solo Recibidos</option>
                                      <option value="sent">Solo Enviados</option>
                                    </select>
                                  </div>
                                  <div className="space-y-1.5">
                                    <label className="text-[10px] text-zinc-500 uppercase font-bold tracking-widest">Modo de Procesamiento</label>
                                    <select 
                                      value={chat.processingMode} 
                                      onChange={e => updateChatConfig(chat.id, 'processingMode', e.target.value as any)}
                                      className="w-full bg-zinc-950 border border-zinc-800 rounded-lg px-3 py-2 text-sm focus:border-zinc-500 outline-none transition-all"
                                    >
                                      <option value="simple">Simple (Una regla por mensaje)</option>
                                      <option value="exhaustive">Exhaustivo (Múltiples reglas por mensaje)</option>
                                    </select>
                                  </div>
                                  <div className="space-y-1.5">
                                    <label className="text-[10px] text-zinc-500 uppercase font-bold tracking-widest">Email CC (Copia Global)</label>
                                    <input 
                                      type="text" 
                                      placeholder="Ej: equipo@empresa.com"
                                      value={chat.emailCc || ''} 
                                      onChange={e => updateChatConfig(chat.id, 'emailCc', e.target.value)}
                                      className="w-full bg-zinc-950 border border-zinc-800 rounded-lg px-3 py-2 text-sm focus:border-zinc-500 outline-none transition-all"
                                    />
                                  </div>
                                  <div className="space-y-1.5">
                                    <label className="text-[10px] text-zinc-500 uppercase font-bold tracking-widest">Email BCC (Copia Oculta Global)</label>
                                    <input 
                                      type="text" 
                                      placeholder="Ej: admin@empresa.com"
                                      value={chat.emailBcc || ''} 
                                      onChange={e => updateChatConfig(chat.id, 'emailBcc', e.target.value)}
                                      className="w-full bg-zinc-950 border border-zinc-800 rounded-lg px-3 py-2 text-sm focus:border-zinc-500 outline-none transition-all"
                                    />
                                  </div>
                                </div>

                                {/* Rules List */}
                                <div className="space-y-4">
                                  <div className="flex items-center justify-between">
                                    <h5 className="text-xs font-bold text-zinc-400 uppercase tracking-widest">Reglas de Automatización</h5>
                                    <button 
                                      onClick={() => addRule(chat.id)}
                                      className="flex items-center gap-1.5 px-3 py-1.5 bg-zinc-800 text-zinc-300 rounded-lg text-[10px] font-bold hover:bg-zinc-700 transition-all"
                                    >
                                      <Plus size={12} /> Añadir Regla
                                    </button>
                                  </div>

                                  <div className="space-y-3">
                                    {(chat.rules || []).map((rule) => (
                                      <div key={rule.id} className="bg-zinc-950 border border-zinc-800 rounded-xl p-4 space-y-4">
                                        <div className="flex items-center justify-between border-b border-zinc-800 pb-3">
                                          <div className="flex items-center gap-3">
                                            <Zap size={16} className="text-amber-500" />
                                            <input 
                                              type="text" 
                                              value={rule.name} 
                                              onChange={e => updateRule(chat.id, rule.id, 'name', e.target.value)}
                                              className="bg-transparent border-none outline-none text-sm font-bold text-zinc-100 focus:ring-0 p-0 w-48"
                                            />
                                          </div>
                                          <button 
                                            onClick={() => removeRule(chat.id, rule.id)}
                                            className="p-1.5 text-zinc-600 hover:text-rose-500 transition-colors"
                                          >
                                            <Trash2 size={14} />
                                          </button>
                                        </div>

                                        <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
                                          {/* Trigger Section */}
                                          <div className="space-y-4">
                                            <div className="flex items-center gap-2 mb-2">
                                              <Search size={14} className="text-zinc-500" />
                                              <span className="text-[10px] font-bold text-zinc-500 uppercase tracking-widest">Disparador (Trigger)</span>
                                            </div>
                                            <div className="grid grid-cols-2 gap-3">
                                              <div className="space-y-1">
                                                <label className="text-[9px] text-zinc-600 uppercase font-bold">Tipo</label>
                                                <select 
                                                  value={rule.type} 
                                                  onChange={e => updateRule(chat.id, rule.id, 'type', e.target.value as any)}
                                                  className="w-full bg-zinc-900 border border-zinc-800 rounded px-2 py-1.5 text-xs outline-none"
                                                >
                                                  <option value="text">Texto</option>
                                                  <option value="file">Archivo / Adjunto</option>
                                                </select>
                                              </div>
                                              <div className="space-y-1">
                                                <label className="text-[9px] text-zinc-600 uppercase font-bold">Subtipo</label>
                                                <select 
                                                  value={rule.subtype} 
                                                  onChange={e => updateRule(chat.id, rule.id, 'subtype', e.target.value)}
                                                  className="w-full bg-zinc-900 border border-zinc-800 rounded px-2 py-1.5 text-xs outline-none"
                                                >
                                                  {rule.type === 'text' ? (
                                                    <>
                                                      <option value="contains">Contiene</option>
                                                      <option value="exact">Palabra Exacta</option>
                                                      <option value="regex">Regex (Avanzado)</option>
                                                    </>
                                                  ) : (
                                                    <>
                                                      <option value="pdf">PDF</option>
                                                      <option value="image">Imagen</option>
                                                      <option value="video">Video</option>
                                                      <option value="doc">Documento (Word/Excel)</option>
                                                      <option value="any">Cualquier Archivo</option>
                                                    </>
                                                  )}
                                                </select>
                                              </div>
                                            </div>
                                            <div className="space-y-1">
                                              <label className="text-[9px] text-zinc-600 uppercase font-bold">Valor a buscar</label>
                                              <input 
                                                type="text" 
                                                placeholder={rule.type === 'text' ? "Ej: ERROR, NSS, etc." : "Ej: .pdf, factura, etc."}
                                                value={rule.triggerValue} 
                                                onChange={e => updateRule(chat.id, rule.id, 'triggerValue', e.target.value)}
                                                className="w-full bg-zinc-900 border border-zinc-800 rounded px-2 py-1.5 text-xs outline-none font-mono"
                                              />
                                            </div>
                                          </div>

                                          {/* Actions Section */}
                                          <div className="space-y-4">
                                            <div className="flex items-center gap-2 mb-2">
                                              <Cpu size={14} className="text-zinc-500" />
                                              <span className="text-[10px] font-bold text-zinc-500 uppercase tracking-widest">Acciones</span>
                                            </div>
                                            
                                            {/* Email Action */}
                                            <div className={`p-3 rounded-lg border transition-all ${rule.emailEnabled ? 'bg-zinc-900/50 border-zinc-700' : 'bg-zinc-900/20 border-zinc-800/50 opacity-60'}`}>
                                              <div className="flex items-center justify-between mb-2">
                                                <div className="flex items-center gap-2">
                                                  <Mail size={14} className={rule.emailEnabled ? 'text-blue-400' : 'text-zinc-600'} />
                                                  <span className="text-[10px] font-bold text-zinc-300">EMAIL</span>
                                                </div>
                                                <input 
                                                  type="checkbox" 
                                                  checked={rule.emailEnabled} 
                                                  onChange={e => updateRule(chat.id, rule.id, 'emailEnabled', e.target.checked)}
                                                  className="w-3.5 h-3.5 accent-blue-500"
                                                />
                                              </div>
                                              {rule.emailEnabled && (
                                                <div className="space-y-2 mt-3 animate-in fade-in slide-in-from-top-1">
                                                  <input 
                                                    type="text" 
                                                    placeholder="Destinatarios a notificar (ej. ventas@empresa.com)"
                                                    value={rule.emailTargets} 
                                                    onChange={e => updateRule(chat.id, rule.id, 'emailTargets', e.target.value)}
                                                    className="w-full bg-zinc-950 border border-zinc-800 rounded px-2 py-1.5 text-[10px] outline-none"
                                                  />
                                                  <input 
                                                    type="text" 
                                                    placeholder="Asunto (Individual)"
                                                    value={rule.emailSubject} 
                                                    onChange={e => updateRule(chat.id, rule.id, 'emailSubject', e.target.value)}
                                                    className="w-full bg-zinc-950 border border-zinc-800 rounded px-2 py-1.5 text-[10px] outline-none"
                                                  />
                                                  <textarea 
                                                    placeholder="Cuerpo del mensaje (Individual)"
                                                    value={rule.emailBody} 
                                                    onChange={e => updateRule(chat.id, rule.id, 'emailBody', e.target.value)}
                                                    className="w-full bg-zinc-950 border border-zinc-800 rounded px-2 py-1.5 text-[10px] outline-none h-12 resize-none"
                                                  />
                                                  
                                                  {config.emailBatchingEnabled && (
                                                    <div className="pt-2 border-t border-zinc-800/50 space-y-2">
                                                      <label className="text-[9px] text-zinc-500 font-bold uppercase flex items-center gap-1">
                                                        <Layers className="w-3 h-3" /> Configuración para Lotes (Agrupados)
                                                      </label>
                                                      <input 
                                                        type="text" 
                                                        placeholder="Asunto (Agrupado)"
                                                        value={rule.emailSubjectGrouped || ''} 
                                                        onChange={e => updateRule(chat.id, rule.id, 'emailSubjectGrouped', e.target.value)}
                                                        className="w-full bg-zinc-950 border border-zinc-800 rounded px-2 py-1.5 text-[10px] outline-none"
                                                      />
                                                      <textarea 
                                                        placeholder="Cuerpo del mensaje (Agrupado) - Usa {grouped_content} para insertar los mensajes"
                                                        value={rule.emailBodyGrouped || ''} 
                                                        onChange={e => updateRule(chat.id, rule.id, 'emailBodyGrouped', e.target.value)}
                                                        className="w-full bg-zinc-950 border border-zinc-800 rounded px-2 py-1.5 text-[10px] outline-none h-12 resize-none"
                                                      />
                                                    </div>
                                                  )}
                                                  <div className="space-y-1">
                                                    <label className="text-[9px] text-zinc-500 font-bold uppercase">Nombre del PDF (Opcional)</label>
                                                    <input 
                                                      type="text" 
                                                      placeholder="Ej: NSS_{nss}_CURP_{curp}"
                                                      value={rule.emailAttachmentName || ''} 
                                                      onChange={e => updateRule(chat.id, rule.id, 'emailAttachmentName', e.target.value)}
                                                      className="w-full bg-zinc-950 border border-zinc-800 rounded px-2 py-1.5 text-[10px] outline-none"
                                                    />
                                                    <p className="text-[8px] text-zinc-600 italic">Usa {`{nss}`} y {`{curp}`} para personalizar.</p>
                                                  </div>
                                                </div>
                                              )}
                                            </div>

                                            {/* WhatsApp Action */}
                                            <div className={`p-3 rounded-lg border transition-all ${rule.waEnabled ? 'bg-zinc-900/50 border-zinc-700' : 'bg-zinc-900/20 border-zinc-800/50 opacity-60'}`}>
                                              <div className="flex items-center justify-between mb-2">
                                                <div className="flex items-center gap-2">
                                                  <MessageSquare size={14} className={rule.waEnabled ? 'text-emerald-400' : 'text-zinc-600'} />
                                                  <span className="text-[10px] font-bold text-zinc-300">WHATSAPP</span>
                                                </div>
                                                <input 
                                                  type="checkbox" 
                                                  checked={rule.waEnabled} 
                                                  onChange={e => updateRule(chat.id, rule.id, 'waEnabled', e.target.checked)}
                                                  className="w-3.5 h-3.5 accent-emerald-500"
                                                />
                                              </div>
                                              {rule.waEnabled && (
                                                <div className="space-y-2 mt-3 animate-in fade-in slide-in-from-top-1">
                                                  <input 
                                                    type="text" 
                                                    placeholder="Números de destino (separados por coma)"
                                                    value={rule.waTargets} 
                                                    onChange={e => updateRule(chat.id, rule.id, 'waTargets', e.target.value)}
                                                    className="w-full bg-zinc-950 border border-zinc-800 rounded px-2 py-1.5 text-[10px] outline-none"
                                                  />
                                                  <textarea 
                                                    placeholder="Mensaje de WhatsApp"
                                                    value={rule.waMessage} 
                                                    onChange={e => updateRule(chat.id, rule.id, 'waMessage', e.target.value)}
                                                    className="w-full bg-zinc-950 border border-zinc-800 rounded px-2 py-1.5 text-[10px] outline-none h-12 resize-none"
                                                  />
                                                  <div className="space-y-1">
                                                    <label className="text-[9px] text-zinc-500 font-bold uppercase">Nombre del PDF (Opcional)</label>
                                                    <input 
                                                      type="text" 
                                                      placeholder="Ej: NSS_{nss}_CURP_{curp}"
                                                      value={rule.waAttachmentName || ''} 
                                                      onChange={e => updateRule(chat.id, rule.id, 'waAttachmentName', e.target.value)}
                                                      className="w-full bg-zinc-950 border border-zinc-800 rounded px-2 py-1.5 text-[10px] outline-none"
                                                    />
                                                    <p className="text-[8px] text-zinc-600 italic">Usa {`{nss}`} y {`{curp}`} para personalizar.</p>
                                                  </div>
                                                </div>
                                              )}
                                            </div>
                                          </div>
                                        </div>
                                      </div>
                                    ))}
                                    {(!chat.rules || chat.rules.length === 0) && (
                                      <div className="py-8 text-center border-2 border-dashed border-zinc-800 rounded-xl">
                                        <p className="text-xs text-zinc-600 italic">No hay reglas configuradas para este chat.</p>
                                        <button 
                                          onClick={() => addRule(chat.id)}
                                          className="mt-2 text-[10px] font-bold text-zinc-400 hover:text-zinc-200 transition-colors"
                                        >
                                          + Añadir primera regla
                                        </button>
                                      </div>
                                    )}
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
                <Card title="Estadísticas de Auditoría" icon={Activity} className="border-emerald-500/20">
                  <div className="space-y-6">
                    <div className="flex flex-wrap items-end gap-4 p-4 bg-zinc-900 border border-zinc-800 rounded-xl">
                      <div className="flex-1 min-w-[150px]">
                        <label className="block text-xs font-bold text-zinc-400 mb-1">Fecha Inicio</label>
                        <input type="date" value={statsStartDate} onChange={(e) => setStatsStartDate(e.target.value)} className="w-full bg-zinc-950 border border-zinc-700 rounded-lg p-2 text-sm text-white" />
                      </div>
                      <div className="flex-1 min-w-[150px]">
                        <label className="block text-xs font-bold text-zinc-400 mb-1">Fecha Fin</label>
                        <input type="date" value={statsEndDate} onChange={(e) => setStatsEndDate(e.target.value)} className="w-full bg-zinc-950 border border-zinc-700 rounded-lg p-2 text-sm text-white" />
                      </div>
                      <button onClick={fetchStats} className="px-4 py-2 bg-emerald-600 text-white rounded-lg font-bold text-sm hover:bg-emerald-500 transition-all">Consultar</button>
                    </div>

                    {auditStats && (
                      <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                        <div className="bg-zinc-950 border border-zinc-800 p-4 rounded-xl">
                          <h5 className="text-xs font-bold text-zinc-400">Total Envíos</h5>
                          <p className="text-2xl font-bold text-white">{auditStats.total}</p>
                        </div>
                        <div className="bg-zinc-950 border border-zinc-800 p-4 rounded-xl">
                          <h5 className="text-xs font-bold text-zinc-400">Envíos Email</h5>
                          <p className="text-2xl font-bold text-emerald-400">{auditStats.email}</p>
                        </div>
                        <div className="bg-zinc-950 border border-zinc-800 p-4 rounded-xl">
                          <h5 className="text-xs font-bold text-zinc-400">Envíos WhatsApp</h5>
                          <p className="text-2xl font-bold text-emerald-400">{auditStats.whatsapp}</p>
                        </div>
                      </div>
                    )}
                    
                    <button 
                      onClick={() => window.open('/api/audit/export', '_blank')}
                      className="flex items-center justify-center gap-2 w-full px-4 py-2.5 bg-zinc-800 text-white rounded-lg font-bold text-sm hover:bg-zinc-700 transition-all"
                    >
                      <Download size={18} /> Descargar Reporte Completo (CSV)
                    </button>
                  </div>
                </Card>

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
                                  placeholder="Destinatarios a notificar (ej. ventas@empresa.com)"
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
                            <th className="px-4 py-3">Ejecución</th>
                            <th className="px-4 py-3">Mensaje/Error</th>
                          </tr>
                        </thead>
                        <tbody className="divide-y divide-zinc-800">
                          {auditLogs.length === 0 ? (
                            <tr>
                              <td colSpan={6} className="px-4 py-12 text-center text-zinc-600 italic">No se han generado registros de auditoría aún en la base de datos.</td>
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
                                <td className="px-4 py-3 text-zinc-300">
                                  <span className={`px-2 py-0.5 rounded text-[10px] font-bold ${
                                    log.execution_type === 'Barrido' ? 'bg-purple-500/10 text-purple-500' : 'bg-zinc-500/10 text-zinc-400'
                                  }`}>
                                    {log.execution_type || 'Tiempo real'}
                                  </span>
                                </td>
                                <td className="px-4 py-3 text-zinc-500" title={log.message || log.error}>
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
                        <div className="flex flex-col">
                          <span className="text-sm font-medium">Envío Diario por Email ({config?.auditEmailSchedule || '23:59'})</span>
                          <span className="text-[10px] text-zinc-500 italic">Reporte global de auditoría</span>
                        </div>
                        <input 
                          type="checkbox" 
                          checked={config?.auditActionEmailEnabled} 
                          onChange={e => config && setConfig({...config, auditActionEmailEnabled: e.target.checked})}
                          className="w-5 h-5 accent-zinc-100"
                        />
                      </div>
                      <div className="grid grid-cols-2 gap-4">
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
                        <div className="space-y-1.5">
                          <label className="text-[10px] text-zinc-500 uppercase font-bold tracking-widest">Horario (HH:MM)</label>
                          <input 
                            type="text" 
                            placeholder="23:59"
                            value={config?.auditEmailSchedule || '23:59'} 
                            onChange={e => config && setConfig({...config, auditEmailSchedule: e.target.value})}
                            className="w-full bg-zinc-950 border border-zinc-800 rounded-lg px-3 py-2 text-sm focus:border-zinc-500 outline-none transition-all"
                          />
                        </div>
                      </div>
                    </div>
                    <div className="space-y-4">
                      <div className="flex items-center justify-between p-3 bg-zinc-950 border border-zinc-800 rounded-lg">
                        <div className="flex flex-col">
                          <span className="text-sm font-medium">Envío Diario por WhatsApp ({config?.auditWaSchedule || '23:59'})</span>
                          <span className="text-[10px] text-zinc-500 italic">Reporte global de auditoría</span>
                        </div>
                        <input 
                          type="checkbox" 
                          checked={config?.auditActionWaEnabled} 
                          onChange={e => config && setConfig({...config, auditActionWaEnabled: e.target.checked})}
                          className="w-5 h-5 accent-zinc-100"
                        />
                      </div>
                      <div className="grid grid-cols-2 gap-4">
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
                        <div className="space-y-1.5">
                          <label className="text-[10px] text-zinc-500 uppercase font-bold tracking-widest">Horario (HH:MM)</label>
                          <input 
                            type="text" 
                            placeholder="23:59"
                            value={config?.auditWaSchedule || '23:59'} 
                            onChange={e => config && setConfig({...config, auditWaSchedule: e.target.value})}
                            className="w-full bg-zinc-950 border border-zinc-800 rounded-lg px-3 py-2 text-sm focus:border-zinc-500 outline-none transition-all"
                          />
                        </div>
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
                            <div className="p-3 bg-blue-500/5 border border-blue-500/10 rounded-lg">
                              <p className="text-[10px] text-zinc-500 leading-relaxed">
                                <span className="font-bold text-blue-400 uppercase tracking-wider block mb-1">Nota para Localhost:</span>
                                Al aplicar la actualización, la aplicación se cerrará para recompilar. Si no usas un gestor de procesos (como PM2) o el script <strong>run.bat</strong>, deberás ejecutar <code>npm run dev</code> manualmente después de que la terminal se cierre.
                              </p>
                            </div>
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
                          <span className="text-[10px] font-bold text-zinc-100">v8.7.0</span>
                          <span className="text-[9px] text-zinc-600 uppercase">Actual</span>
                        </div>
                        <p className="text-[10px] text-zinc-500">Fase 7: Soporte para campo CC (Copia Global) en configuración de correos.</p>
                      </div>
                      <div className="p-2 bg-zinc-950/50 border border-zinc-900/50 rounded-lg">
                        <div className="flex justify-between items-center mb-1">
                          <span className="text-[10px] font-bold text-zinc-400">v8.6.0</span>
                        </div>
                        <p className="text-[10px] text-zinc-600">Fase 6: Rediseño de Dashboard, Sidebar Colapsable y Tarjetas Expandibles.</p>
                      </div>
                      <div className="p-2 bg-zinc-950/50 border border-zinc-900/50 rounded-lg">
                        <div className="flex justify-between items-center mb-1">
                          <span className="text-[10px] font-bold text-zinc-400">v8.5.0</span>
                        </div>
                        <p className="text-[10px] text-zinc-600">Fase 5: Guía de Ayuda, Documentación y Versionado Inteligente.</p>
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
      </motion.div>

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
