import { writeBatch, doc, getDoc } from 'firebase/firestore';
import { db, auth } from '../firebase';
import React, { useState, useEffect, useRef, useCallback } from 'react';
import { useStore, Category, Product, Order, User, AiTrainingExample, DEFAULT_AI_TRAINING_EXAMPLES } from '../store/useStore';
import { printReceipt, resolveItemCode, resolveAddonCode } from '../utils/printer';
import { getOrderPaymentBreakdown, requiresOperatorPaymentConfirmation, formatBRL } from '../utils/paymentStatusHelper';
import { formatCurrency, formatDateBR, formatAllDatesBR } from '../lib/utils';
import { shouldExcludeProduct, isExcludedCategory, isAddonCategory, isStoreOnlyCategory, EXCLUDED_CATEGORIES, normalizeText, isAuthorizedAdminEmail, MASTER_ADMIN_EMAILS, cleanProductDescription, formatProductDescriptionWithCode, isCategoryFrozenModality } from '../constants';
import { getCollectionPath, getDocPath } from '../lib/tenants';
import { getSmartProductImage } from '../utils/imageHelper';
import { ProductImage } from '../components/ProductImage';
import { ReceiptModal } from '../components/ReceiptModal';
import TvManagerTab from '../components/TvManagerTab';
import CustomersTab from '../components/CustomersTab';
import { TableManagerTab } from '../components/TableManagerTab';
import { TotemBackupModal } from '../components/TotemBackupModal';
import { SmsRemindersTab } from '../components/SmsRemindersTab';
import { safeStorage } from '../utils/storage';
import { Link } from 'react-router-dom';
import { 
  LayoutDashboard, 
  Tags, 
  Package, 
  ShoppingBag, 
  Settings, 
  MonitorSmartphone,
  AlertCircle,
  Plus,
  Droplets,
  Edit2,
  Trash2,
  CheckCircle2,
  CheckCircle,
  Save,
  Clock,
  ChefHat,
  X,
  Volume2,
  VolumeX,
  Users,
  UserCheck,
  Eye,
  EyeOff,
  TrendingUp,
  DollarSign,
  Printer,
  XCircle,
  RefreshCw,
  Search,
  History,
  Paperclip,
  AlertTriangle,
  FileText,
  HardDrive,
  Filter,
  CheckSquare,
  Bell,
  Tv,
  Megaphone,
  BellRing,
  Wrench,
  Menu as MenuIcon,
  Smartphone,
  Download,
  Bot,
  Calendar,
  CalendarDays,
  CreditCard,
  UtensilsCrossed,
  QrCode,
  MessageCircle,
  Sparkles,
  Copy,
  BarChart3,
  ChevronDown,
  ChevronUp,
  ChevronLeft,
  ChevronRight,
  Palette,
  Store,
  SlidersHorizontal,
  MapPin,
  KeyRound,
  ShieldCheck,
  Lock,
  LocateFixed,
  Upload
} from 'lucide-react';
import { getCurrentPosition } from '../utils/geolocation';
import { sendNtfyNotification } from '../utils/ntfy';
import { parseWeeklySchedule, DaySchedule, formatWeeklyScheduleSummary, getStoreCurrentStatus, DEFAULT_WEEKLY_SCHEDULE, getEffectivePickupTimestamp, getOrderDateInfo, DayTheme, getDayTheme, ALL_DAYS_THEME, generateScheduleTimeSlots, parseSlotCapacities, parseScheduleSlots } from '../utils/scheduleHelper';
import { AiAssistantModal } from '../components/AiAssistantModal';
import { AdminSettingsCollapsible } from '../components/AdminSettingsCollapsible';
import { CaixaPrinterStationCard } from '../components/CaixaPrinterStationCard';
import {
  resolveFullBlueFocusConfig,
  parseServerBlueFocusConfig,
  serializeBlueFocusConfigForDb,
  mirrorBlueFocusConfigToLocalStorage,
  hasLegacyLocalStorageBlueFocusConfig,
  BlueFocusIntegrationConfig,
} from '../utils/blueFocusConfig';

export interface SyncLog {
  id: string;
  timestamp: string;
  type: string;
  status: 'success' | 'warning' | 'error';
  productsUpdated: number;
  productsCreated: number;
  categoriesCreated: number;
  ignoredCount: number;
  totalRead: number;
  details: string;
  user?: string;
}

export default function Admin() {
  const { 
    categories, products, orders: rawOrders, tables, users, customers, storeInfo, ordersError, isOnline, isInitialized,
    appInstallsCount, appInstallsList, fetchAppInstalls,
    addCategory, updateCategory, deleteCategory,
    addProduct, updateProduct, deleteProduct,
    addUser, updateUser, deleteUser,
    updateOrderStatus, confirmOrderPayment, markOrderPrinted, deleteOrder, clearAllOrders, updateStoreInfo, exportOrderToBlueFocus,
    fetchData, fetchCustomers, auditLogs, clearAuditLogs
  } = useStore();

  const [activeTab, setActiveTab] = useState('dashboard');
  const [auditSearch, setAuditSearch] = useState('');
  const [showInstallsModal, setShowInstallsModal] = useState(false);
  const [isMobileNavOpen, setIsMobileNavOpen] = useState(false);
  const [currentUser, setCurrentUser] = useState<User | null>(null);
  const [isAuthenticated, setIsAuthenticated] = useState(false);
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [loginError, setLoginError] = useState('');
  const [deployInfo, setDeployInfo] = useState<{
    version?: string;
    railwayDeploymentId?: string | null;
    railwaySnapshotId?: string | null;
    railwayCommitSha?: string | null;
    railwayCommitMessage?: string | null;
    railwayEnvironment?: string | null;
    serverStartTime?: string | null;
  }>({
    version: '2.5.0',
    railwayDeploymentId: null,
    railwayCommitSha: null,
    serverStartTime: null
  });

  useEffect(() => {
    const fetchDeployInfo = async () => {
      try {
        const res = await fetch('/api/version', { cache: 'no-store' });
        if (res.ok) {
          const data = await res.json();
          setDeployInfo(data);
        }
      } catch (err) {
        console.warn('Erro ao carregar dados de versão/deploy:', err);
      }
    };
    fetchDeployInfo();
    const interval = setInterval(fetchDeployInfo, 30000);
    return () => clearInterval(interval);
  }, []);

  const [isSyncingOrdersNow, setIsSyncingOrdersNow] = useState(false);

  useEffect(() => {
    fetchData().catch(() => {});
    fetchCustomers().catch(() => {});
  }, []);

  // Ticker dinâmico em tempo real a cada 10s para ordenar e identificar pedidos a vencer
  const [nowTime, setNowTime] = useState<number>(Date.now());
  useEffect(() => {
    const interval = setInterval(() => {
      setNowTime(Date.now());
    }, 10000);
    return () => clearInterval(interval);
  }, []);

  // Role permissions helpers
  const userEmail = (currentUser?.email || '').trim().toLowerCase();
  const userName = (currentUser?.name || '').trim().toLowerCase();
  
  // Usuário Vanderluce faz parte do grupo administrador
  const isVanderluce = userEmail.includes('vanderluce') || userName.includes('vanderluce');

  // Apenas usuário MASTER tem acesso a todas as funcionalidades do menu
  const isMaster = !isVanderluce && (currentUser?.role === 'master' || userEmail === 'camillasites@gmail.com' || userEmail === 'admin@balbec.com.br');

  // Grupo Administrador: role === 'admin', ou Vanderluce, ou e-mails autorizados que não sejam master
  const isAdmin = !isMaster && (isVanderluce || currentUser?.role === 'admin' || isAuthorizedAdminEmail(currentUser?.email));

  // Administrador ou Master
  const isAdminOrMaster = isMaster || isAdmin;

  // Usuário Padrão: não é Master nem Administrador
  const isPadrao = !isMaster && !isAdmin;

  // Usuário específico do Caixa
  const isCaixaUser = userEmail === 'caixa@balbec.com.br';

  const orders = isCaixaUser ? rawOrders.filter(o => o.type !== 'kiosk') : rawOrders;

  // Guard activeTab de acordo com os níveis de permissão (Master, Administrador, Padrão e Caixa)
  useEffect(() => {
    if (isAuthenticated && currentUser) {
      if (isCaixaUser) {
        if (!['orders', 'customers', 'tables', 'tv'].includes(activeTab)) {
          setActiveTab('orders');
        }
      } else if (isPadrao) {
        // Usuário Padrão NÃO tem acesso a: pedidos, mesas, motoboys, bairros, logs, configurações, usuários
        const allowedPadraoTabs = ['dashboard', 'categories', 'products', 'flavors', 'tv'];
        if (!allowedPadraoTabs.includes(activeTab)) {
          setActiveTab('dashboard');
        }
      } else if (!isMaster) {
        // Grupo Administrador (incluindo Vanderluce) NÃO tem acesso a configurações e usuários
        if (activeTab === 'settings' || activeTab === 'users') {
          setActiveTab('dashboard');
        }
      }
    }
  }, [isAuthenticated, currentUser, isPadrao, isMaster, isAdmin, isCaixaUser, activeTab]);

  const [isModalOpen, setIsModalOpen] = useState(false);
  const [selectedOrderForReceipt, setSelectedOrderForReceipt] = useState<Order | null>(null);
  const [paymentConfirmModal, setPaymentConfirmModal] = useState<{
    order: Order;
    confirmerName: string;
    password: string;
    receiptUrl: string | null;
    showPassword: boolean;
    error: string | null;
    isSubmitting: boolean;
  } | null>(null);
  const [masterAuthModal, setMasterAuthModal] = useState<{
    action: 'delete_order' | 'clear_all_orders' | 'view_payment_audit' | 'view_single_order_confirmer' | 'revert_order_status';
    title: string;
    description: string;
    orderId?: string;
    currentStatus?: Order['status'];
    targetStatus?: Order['status'];
    password: string;
    showPassword: boolean;
    error: string | null;
    isSubmitting: boolean;
  } | null>(null);
  const [paymentAuditModal, setPaymentAuditModal] = useState<{
    isOpen: boolean;
    focusOrderId: string | null;
    search: string;
  }>({ isOpen: false, focusOrderId: null, search: '' });
  const [modalType, setModalType] = useState<'category' | 'product' | 'user' | null>(null);
  const [categorySaleMode, setCategorySaleMode] = useState<'pack' | 'unit'>('pack');
  const [editingItem, setEditingItem] = useState<any>(null);
  const [selectedCategoryId, setSelectedCategoryId] = useState<string>('');
  const [selectedFrozenCategoryId, setSelectedFrozenCategoryId] = useState<string>('');
  const [isFlavorInModal, setIsFlavorInModal] = useState(false);
  const [showPrintConfig, setShowPrintConfig] = useState(false);

  // Totem Backups State & Actions
  const [totemBackups, setTotemBackups] = useState<any[]>([]);
  const [isTotemBackupModalOpen, setIsTotemBackupModalOpen] = useState(false);
  const [isCreatingBackup, setIsCreatingBackup] = useState(false);
  const [isRestoringBackup, setIsRestoringBackup] = useState(false);

  const fetchTotemBackups = useCallback(async () => {
    try {
      const res = await fetch('/api/db/totem-backups');
      if (res.ok) {
        const data = await res.json();
        setTotemBackups(Array.isArray(data) ? data : []);
      }
    } catch (e) {
      console.warn('Erro ao buscar backups do totem:', e);
    }
  }, []);

  useEffect(() => {
    fetchTotemBackups();
  }, [fetchTotemBackups]);

  const handleCreateTotemBackup = async (customName?: string) => {
    setIsCreatingBackup(true);
    try {
      const res = await fetch('/api/db/totem-backups', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name: customName || undefined })
      });
      const data = await res.json();
      if (res.ok && data.success) {
        await fetchTotemBackups();
        setConfirmModal({
          isOpen: true,
          title: 'Backup do Totem Criado!',
          message: `O backup "${data.backup.name}" foi salvo com sucesso!\n\nForam armazenados os status do Totem para ${data.backup.activeCategoriesCount} categorias e ${data.backup.activeProductsCount} produtos ativados.`,
          onConfirm: () => setConfirmModal(null)
        });
      } else {
        showInfoModal('Erro no Backup', data.error || 'Erro ao criar backup do totem');
      }
    } catch (e: any) {
      showInfoModal('Erro no Backup', 'Erro ao criar backup: ' + e.message);
    } finally {
      setIsCreatingBackup(false);
    }
  };

  const handleRestoreTotemBackup = async (backupId?: string, customBackup?: any) => {
    setIsRestoringBackup(true);
    try {
      const res = await fetch('/api/db/totem-backups/restore', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ backupId, customBackup })
      });
      const data = await res.json();
      if (res.ok && data.success) {
        await fetchData();
        setIsTotemBackupModalOpen(false);
        setConfirmModal({
          isOpen: true,
          title: 'Totem Restaurado com Sucesso!',
          message: `O cardápio do Totem foi restaurado a partir de "${data.backupName}".\n\nForam redefinidas as configurações de ${data.restoredCatCount} categorias e ${data.restoredProdCount} produtos.`,
          cancelText: null,
          onConfirm: () => setConfirmModal(null)
        });
      } else {
        showInfoModal('Erro na Restauração', data.error || 'Erro ao restaurar backup');
      }
    } catch (e: any) {
      showInfoModal('Erro na Restauração', 'Erro ao restaurar backup: ' + e.message);
    } finally {
      setIsRestoringBackup(false);
    }
  };

  const handleDownloadTotemBackup = (backup: any) => {
    const jsonStr = JSON.stringify(backup, null, 2);
    const blob = new Blob([jsonStr], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    const safeName = (backup.name || 'backup_totem').toLowerCase().replace(/[^a-z0-9]/g, '_');
    a.href = url;
    a.download = `${safeName}.json`;
    a.click();
    URL.revokeObjectURL(url);
  };

  const handleUploadTotemBackupFile = (event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = async (e) => {
      try {
        const content = e.target?.result as string;
        const parsed = JSON.parse(content);
        if (parsed && (Array.isArray(parsed.categories) || Array.isArray(parsed.products))) {
          await handleRestoreTotemBackup(undefined, parsed);
        } else {
          showInfoModal('Arquivo Inválido', 'Arquivo de backup inválido. Certifique-se de selecionar um arquivo JSON de backup do Totem.');
        }
      } catch (err) {
        showInfoModal('Erro de Leitura', 'Erro ao ler arquivo JSON de backup.');
      }
    };
    reader.readAsText(file);
    event.target.value = '';
  };

  const handleDeleteTotemBackup = async (backupId: string) => {
    setConfirmModal({
      isOpen: true,
      title: 'Excluir Backup',
      message: 'Deseja excluir este registro de backup do sistema?',
      confirmText: 'Excluir',
      onConfirm: async () => {
        try {
          const res = await fetch(`/api/db/totem-backups/${backupId}`, { method: 'DELETE' });
          if (res.ok) {
            await fetchTotemBackups();
          }
        } catch (e) {
          console.error('Erro ao excluir backup:', e);
        }
      }
    });
  };

  const handleDownloadFullSystemBackup = async () => {
    try {
      const res = await fetch('/api/db/backup');
      if (res.ok) {
        const data = await res.json();
        const jsonStr = JSON.stringify(data, null, 2);
        const blob = new Blob([jsonStr], { type: 'application/json' });
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        const dateStr = new Date().toISOString().slice(0, 10);
        a.href = url;
        a.download = `balbec_backup_completo_${dateStr}.json`;
        a.click();
        URL.revokeObjectURL(url);
      } else {
        showInfoModal('Erro no Backup', 'Erro ao gerar backup completo do sistema.');
      }
    } catch (err: any) {
      showInfoModal('Erro no Backup', 'Erro ao baixar backup completo: ' + err.message);
    }
  };

  const handleUploadFullSystemBackupFile = (event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = async (e) => {
      try {
        const content = e.target?.result as string;
        const parsed = JSON.parse(content);
        if (parsed && (parsed.storeInfo || parsed.products || parsed.orders || parsed.categories)) {
          setConfirmModal({
            isOpen: true,
            title: 'Restaurar Backup Completo',
            message: 'Deseja restaurar este backup COMPLETO do sistema? Todos os dados atuais (vendas, cardápio, clientes e configurações) serão atualizados.',
            confirmText: 'Restaurar Agora',
            onConfirm: async () => {
              try {
                const res = await fetch('/api/db/restore', {
                  method: 'POST',
                  headers: { 'Content-Type': 'application/json' },
                  body: JSON.stringify(parsed)
                });
                const data = await res.json();
                if (res.ok && data.success) {
                  await fetchData();
                  setIsTotemBackupModalOpen(false);
                  const cloudNotice = data.cloudSyncOk === false
                    ? `\n\n⚠️ ATENÇÃO (Nuvem / Deploy):\n${data.cloudWarning || 'Não foi possível gravar na nuvem agora.'}`
                    : '\n\n☁️ Sincronizado com a nuvem com sucesso (seguro para próximos deploys).';
                  setConfirmModal({
                    isOpen: true,
                    title: data.cloudSyncOk === false ? 'Backup Restaurado (Apenas Local Hoje)' : 'Backup Completo Restaurado!',
                    message: `O sistema foi restaurado com sucesso!\n\n• Categorias: ${data.restoredCategories || 0}\n• Produtos: ${data.restoredProducts || 0}\n• Mesas: ${data.restoredTables || 0}\n• Vendas e Configurações atualizadas.${cloudNotice}`,
                    cancelText: null,
                    onConfirm: () => setConfirmModal(null)
                  });
                } else {
                  showInfoModal('Erro na Restauração', data.error || 'Erro ao restaurar backup completo.');
                }
              } catch (restoreErr: any) {
                showInfoModal('Erro na Restauração', 'Erro ao restaurar backup completo: ' + (restoreErr?.message || restoreErr));
              }
            }
          });
        } else {
          showInfoModal('Arquivo Inválido', 'Arquivo de backup inválido. Certifique-se de selecionar um arquivo JSON de backup completo do sistema BALBEC.');
        }
      } catch (err) {
        showInfoModal('Erro de Leitura', 'Erro ao ler arquivo JSON de backup.');
      }
      event.target.value = '';
    };
    reader.readAsText(file);
  };
  
  // Product search & filter state
  const [productSearchInput, setProductSearchInput] = useState('');
  const [productSearch, setProductSearch] = useState('');
  const [productCategoryFilter, setProductCategoryFilter] = useState('all');
  const [productStatusFilter, setProductStatusFilter] = useState('all');
  const [productFrozenFilter, setProductFrozenFilter] = useState<'all' | 'frozen' | 'not_frozen'>('all');

  // Batch selection state for product transfer
  const [selectedProductIds, setSelectedProductIds] = useState<string[]>([]);
  const [targetBatchCategoryId, setTargetBatchCategoryId] = useState<string>('');
  const [targetBatchFrozenCategoryId, setTargetBatchFrozenCategoryId] = useState<string>('');
  const [batchMinFrozenQty, setBatchMinFrozenQty] = useState<string>('');
  const [isTransferringBatch, setIsTransferringBatch] = useState<boolean>(false);

  // Inline per-product minimum frozen quantity state
  const [minFrozenDrafts, setMinFrozenDrafts] = useState<Record<string, string>>({});
  const [expandedMinFrozenIds, setExpandedMinFrozenIds] = useState<Record<string, boolean>>({});
  const [savedMinFrozenId, setSavedMinFrozenId] = useState<string | null>(null);

  const focusMinFrozenInput = (productId: string) => {
    setExpandedMinFrozenIds(prev => ({ ...prev, [productId]: true }));
    setTimeout(() => {
      const el = document.getElementById(`min-frozen-qty-${productId}`) as HTMLInputElement | null;
      if (el) {
        el.focus();
        el.select();
      }
    }, 60);
  };

  const saveInlineMinFrozenQuantity = async (productId: string, rawVal: string | number, currentSaved?: number) => {
    const parsed = parseInt(String(rawVal).replace(/\D/g, ''), 10);
    const safeQty = isNaN(parsed) || parsed < 1 ? 1 : parsed;
    setMinFrozenDrafts(prev => ({ ...prev, [productId]: String(safeQty) }));
    if (currentSaved !== undefined && safeQty === currentSaved) return;
    try {
      await updateProduct(productId, { minFrozenQuantity: safeQty, allowFrozen: true });
      setSavedMinFrozenId(productId);
      setTimeout(() => {
        setSavedMinFrozenId(prev => (prev === productId ? null : prev));
      }, 1800);
    } catch (err) {
      console.error('Error updating minFrozenQuantity:', err);
    }
  };

  const handleBatchCategoryTransfer = async () => {
    if (!targetBatchCategoryId || selectedProductIds.length === 0 || isTransferringBatch) return;
    setIsTransferringBatch(true);
    try {
      await Promise.all(
        selectedProductIds.map(id => updateProduct(id, { categoryId: targetBatchCategoryId }))
      );
      setSelectedProductIds([]);
      setTargetBatchCategoryId('');
    } catch (err) {
      console.error('Error batch updating product category:', err);
      setConfirmModal({
        isOpen: true,
        title: 'Erro',
        message: 'Erro ao transferir produtos. Tente novamente.',
        onConfirm: () => setConfirmModal(null)
      });
    } finally {
      setIsTransferringBatch(false);
    }
  };

  const handleBatchFrozenCategoryTransfer = async () => {
    if (!targetBatchFrozenCategoryId || selectedProductIds.length === 0 || isTransferringBatch) return;
    setIsTransferringBatch(true);
    try {
      const finalFrozenCatId = targetBatchFrozenCategoryId === 'none' ? '' : targetBatchFrozenCategoryId;
      const parsedBatchMin = parseInt(batchMinFrozenQty.replace(/\D/g, ''), 10);
      const hasCustomBatchMin = !isNaN(parsedBatchMin) && parsedBatchMin >= 1;
      await Promise.all(
        selectedProductIds.map(id => updateProduct(id, { 
          frozenCategoryId: finalFrozenCatId,
          ...(finalFrozenCatId ? { allowFrozen: true } : {}),
          ...(finalFrozenCatId && hasCustomBatchMin ? { minFrozenQuantity: parsedBatchMin } : {})
        }))
      );
      setSelectedProductIds([]);
      setTargetBatchFrozenCategoryId('');
      setBatchMinFrozenQty('');
    } catch (err) {
      console.error('Error batch updating product frozen category:', err);
      setConfirmModal({
        isOpen: true,
        title: 'Erro',
        message: 'Erro ao vincular categoria de congelados. Tente novamente.',
        onConfirm: () => setConfirmModal(null)
      });
    } finally {
      setIsTransferringBatch(false);
    }
  };

  const handleBatchToggleFrozen = async (enable: boolean) => {
    if (selectedProductIds.length === 0 || isTransferringBatch) return;
    setIsTransferringBatch(true);
    try {
      await Promise.all(
        selectedProductIds.map(id => updateProduct(id, { allowFrozen: enable }))
      );
      setConfirmModal({
        isOpen: true,
        title: enable ? 'Opção Congelados Ativada' : 'Opção Congelados Desativada',
        message: `${selectedProductIds.length} produto(s) atualizado(s) com sucesso!\n\n${enable ? 'A opção de Salgado Congelado (+R$ 0,30) foi HABILITADA.' : 'A opção de Salgado Congelado foi DESABILITADA.'}`,
        onConfirm: () => setConfirmModal(null)
      });
      setSelectedProductIds([]);
    } catch (err) {
      console.error('Error batch updating allowFrozen:', err);
      setConfirmModal({
        isOpen: true,
        title: 'Erro',
        message: 'Erro ao atualizar congelados dos produtos selecionados.',
        onConfirm: () => setConfirmModal(null)
      });
    } finally {
      setIsTransferringBatch(false);
    }
  };

  // Vendas por dia & Calendário na Visão Geral
  const getTodayDateString = () => {
    const d = new Date();
    const year = d.getFullYear();
    const month = String(d.getMonth() + 1).padStart(2, '0');
    const day = String(d.getDate()).padStart(2, '0');
    return `${year}-${month}-${day}`;
  };

  const getCurrentMonthString = () => {
    const d = new Date();
    const year = d.getFullYear();
    const month = String(d.getMonth() + 1).padStart(2, '0');
    return `${year}-${month}`;
  };

  const [selectedDashboardDate, setSelectedDashboardDate] = useState<string>(getTodayDateString());
  const [selectedDashboardMonth, setSelectedDashboardMonth] = useState<string>(getCurrentMonthString());
  const [mobileDaysChunkIndex, setMobileDaysChunkIndex] = useState<number>(2); // 0: dias mais antigos, 1: intermediários, 2: mais recentes (Hoje)
  const touchStartXRef = useRef<number | null>(null);

  const handleMobileTouchStart = (e: React.TouchEvent) => {
    touchStartXRef.current = e.touches[0].clientX;
  };

  const handleMobileTouchEnd = (e: React.TouchEvent) => {
    if (touchStartXRef.current === null) return;
    const diff = touchStartXRef.current - e.changedTouches[0].clientX;
    if (diff > 40) {
      // Swipe para esquerda -> avança para período mais recente
      setMobileDaysChunkIndex(prev => Math.min(prev + 1, 2));
    } else if (diff < -40) {
      // Swipe para direita -> volta para período anterior
      setMobileDaysChunkIndex(prev => Math.max(prev - 1, 0));
    }
    touchStartXRef.current = null;
  };

  // Sincroniza o mês exibido e o bloco móvel quando o usuário navega por dias específicos
  useEffect(() => {
    if (selectedDashboardDate && selectedDashboardDate.length >= 7) {
      const dateMonth = selectedDashboardDate.substring(0, 7);
      if (dateMonth !== selectedDashboardMonth) {
        setSelectedDashboardMonth(dateMonth);
      }

      // Sincroniza o bloco móvel de 3 dias caso a data selecionada pertença a algum bloco
      const getDateKeyWithOffset = (offset: number) => {
        const d = new Date();
        d.setDate(d.getDate() - offset);
        return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
      };

      const chunk0 = [getDateKeyWithOffset(8), getDateKeyWithOffset(7), getDateKeyWithOffset(6)];
      const chunk1 = [getDateKeyWithOffset(5), getDateKeyWithOffset(4), getDateKeyWithOffset(3)];
      const chunk2 = [getDateKeyWithOffset(2), getDateKeyWithOffset(1), getDateKeyWithOffset(0)];

      if (chunk0.includes(selectedDashboardDate)) {
        setMobileDaysChunkIndex(0);
      } else if (chunk1.includes(selectedDashboardDate)) {
        setMobileDaysChunkIndex(1);
      } else if (chunk2.includes(selectedDashboardDate)) {
        setMobileDaysChunkIndex(2);
      }
    }
  }, [selectedDashboardDate]);

  const handleMonthChange = (newMonth: string) => {
    if (!newMonth) return;
    setSelectedDashboardMonth(newMonth);
    // Se a data diária atualmente selecionada não pertencer a este mês, ajusta para o dia correspondente ou dia 1
    if (!selectedDashboardDate.startsWith(newMonth)) {
      const todayStr = getTodayDateString();
      if (todayStr.startsWith(newMonth)) {
        setSelectedDashboardDate(todayStr);
      } else {
        setSelectedDashboardDate(`${newMonth}-01`);
      }
    }
  };

  // Sync logs state (Histórico de Atualizações)
  const [syncLogs, setSyncLogs] = useState<SyncLog[]>(() => {
    const saved = safeStorage.getItem('balbec_sync_logs');
    if (saved) {
      try {
        return JSON.parse(saved);
      } catch (e) {
        console.error('Error parsing sync logs', e);
      }
    }
    const defaultLogs: SyncLog[] = [
      {
        id: 'log-1',
        timestamp: new Date().toLocaleDateString('pt-BR') + ' ' + '10:30:15',
        type: 'Sincronização ERP (BlueFocus)',
        status: 'success',
        productsUpdated: 42,
        productsCreated: 5,
        categoriesCreated: 1,
        ignoredCount: 8,
        totalRead: 55,
        details: 'Sincronização incremental de produtos concluída com sucesso via API ERP BlueFocus.',
        user: 'Camilla (Master)'
      },
      {
        id: 'log-2',
        timestamp: new Date(Date.now() - 3600000 * 24).toLocaleDateString('pt-BR') + ' ' + '08:00:00',
        type: 'Auto Sync (2h)',
        status: 'success',
        productsUpdated: 0,
        productsCreated: 0,
        categoriesCreated: 0,
        ignoredCount: 12,
        totalRead: 48,
        details: 'Auto-sync de rotina executado. Nenhuma alteração pendente no ERP.',
        user: 'Sistema'
      }
    ];
    try {
      safeStorage.setItem('balbec_sync_logs', JSON.stringify(defaultLogs));
    } catch {}
    return defaultLogs;
  });

  const [logSearchTerm, setLogSearchTerm] = useState('');
  const [logStatusFilter, setLogStatusFilter] = useState<'all' | 'success' | 'warning' | 'error'>('all');
  const [selectedLogForModal, setSelectedLogForModal] = useState<SyncLog | null>(null);

  const addSyncLog = (logData: Omit<SyncLog, 'id' | 'timestamp'>) => {
    const now = new Date();
    const formattedTimestamp = now.toLocaleDateString('pt-BR') + ' ' + now.toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit', second: '2-digit' });
    const sanitizedDetails = typeof logData.details === 'string' && logData.details.length > 500
      ? logData.details.substring(0, 500) + '...'
      : (logData.details || '');
    const newLog: SyncLog = {
      id: Math.random().toString(36).substring(2, 9),
      timestamp: formattedTimestamp,
      ...logData,
      details: sanitizedDetails
    };
    setSyncLogs(prev => {
      // Keep only last 20 logs to save localStorage quota
      const updated = [newLog, ...prev].slice(0, 20);
      try {
        safeStorage.setItem('balbec_sync_logs', JSON.stringify(updated));
      } catch {
        try {
          safeStorage.removeItem('balbec_sync_logs');
          safeStorage.setItem('balbec_sync_logs', JSON.stringify([newLog]));
        } catch {}
      }
      return updated;
    });
  };

  // Confirm modal state
  const [confirmModal, setConfirmModal] = useState<{ 
    isOpen: boolean, 
    title: string, 
    message: string, 
    onConfirm: () => void | Promise<void>, 
    debugXml?: string,
    confirmText?: string,
    cancelText?: string | null,
    isPaymentAlert?: boolean,
    highlightAmount?: string
  } | null>(null);

  const showInfoModal = (title: string, message: string) => {
    setConfirmModal({
      isOpen: true,
      title,
      message,
      confirmText: 'OK',
      cancelText: null,
      onConfirm: () => setConfirmModal(null)
    });
  };

  // Settings state
  const [logoPreview, setLogoPreview] = useState(() => storeInfo.logoUrl || localStorage.getItem('balbec_custom_logo_url') || '/logo.svg');
  const [isSavingLogo, setIsSavingLogo] = useState(false);
  const [logoSavedSuccess, setLogoSavedSuccess] = useState(false);
  const [themeColor, setThemeColor] = useState(storeInfo.themeColor || '#ff5500');
  const [addButtonColor, setAddButtonColor] = useState(storeInfo.addButtonColor || '#ff0000');
  const [iconColor, setIconColor] = useState(storeInfo.iconColor || '#ff5500');
  const [categoryTitleColor, setCategoryTitleColor] = useState(storeInfo.categoryTitleColor || '#1c1917');
  
  // Controlled switches for store channels & status
  const [isOpenState, setIsOpenState] = useState<boolean>(storeInfo.isOpen !== false);
  const [forceOpenState, setForceOpenState] = useState<boolean>(!!storeInfo.forceOpen);
  const [inStoreEnabledState, setInStoreEnabledState] = useState<boolean>(storeInfo.inStoreEnabled !== false);
  const [deliveryEnabledState, setDeliveryEnabledState] = useState<boolean>(storeInfo.deliveryEnabled !== false);
  const [deliveryScheduleEnabledState, setDeliveryScheduleEnabledState] = useState<boolean>(!!storeInfo.deliveryScheduleEnabled);
  const [deliveryScheduleSlotsState, setDeliveryScheduleSlotsState] = useState<string[]>(() => parseScheduleSlots(storeInfo.deliveryScheduleSlots));
  const [scheduleIntervalMinutesState, setScheduleIntervalMinutesState] = useState<number>(Number(storeInfo.scheduleIntervalMinutes) === 60 ? 60 : 30);
  const [scheduleStartTimeState, setScheduleStartTimeState] = useState<string>(storeInfo.scheduleStartTime || '08:00');
  const [scheduleEndTimeState, setScheduleEndTimeState] = useState<string>(storeInfo.scheduleEndTime || '19:30');
  const [scheduleSlotCapacitiesState, setScheduleSlotCapacitiesState] = useState<Record<string, number>>(() => parseSlotCapacities(storeInfo.scheduleSlotCapacities));
  const [scheduleSlotItemCapacityState, setScheduleSlotItemCapacityState] = useState<number>(storeInfo.scheduleSlotItemCapacity ?? 100);
  const [schedulePrepTimeNormalMinutesState, setSchedulePrepTimeNormalMinutesState] = useState<number>(storeInfo.schedulePrepTimeNormalMinutes ?? 40);
  const [schedulePrepTimeFrozenMinutesState, setSchedulePrepTimeFrozenMinutesState] = useState<number>(storeInfo.schedulePrepTimeFrozenMinutes ?? 90);
  const [salgadoPrepFritoEnabledState, setSalgadoPrepFritoEnabledState] = useState<boolean>(storeInfo.salgadoPrepFritoEnabled !== false);
  const [salgadoPrepAssadoEnabledState, setSalgadoPrepAssadoEnabledState] = useState<boolean>(storeInfo.salgadoPrepAssadoEnabled !== false);
  const [salgadoPrepFritoCongeladoEnabledState, setSalgadoPrepFritoCongeladoEnabledState] = useState<boolean>(storeInfo.salgadoPrepFritoCongeladoEnabled !== false);
  const [salgadoPrepAssadoCongeladoEnabledState, setSalgadoPrepAssadoCongeladoEnabledState] = useState<boolean>(storeInfo.salgadoPrepAssadoCongeladoEnabled !== false);
  const [kioskEnabledState, setKioskEnabledState] = useState<boolean>(storeInfo.kioskEnabled !== false);
  const [requireQrCodeForOrderingState, setRequireQrCodeForOrderingState] = useState<boolean>(storeInfo.requireQrCodeForOrdering !== false);
  const [isMaintenanceState, setIsMaintenanceState] = useState<boolean>(storeInfo.isMaintenance || false);
  const [showSystemIntroButtonState, setShowSystemIntroButtonState] = useState<boolean>(storeInfo.showSystemIntroButton !== false);

  // Weekly Schedule & Auto Open/Close State
  const [weeklyScheduleState, setWeeklyScheduleState] = useState<DaySchedule[]>(() => parseWeeklySchedule(storeInfo.weeklySchedule));
  const [autoOpenCloseState, setAutoOpenCloseState] = useState<boolean>(storeInfo.autoOpenClose !== false);
  const [closedMessageState, setClosedMessageState] = useState<string>(storeInfo.closedMessage || 'Estamos fechados no momento. Confira nossos horários de atendimento!');

  // AI Virtual Agent & WhatsApp State
  const parseInitialTrainingExamples = (raw: any): AiTrainingExample[] => {
    try {
      if (Array.isArray(raw)) return raw;
      if (typeof raw === 'string' && raw.trim()) {
        const parsed = JSON.parse(raw);
        if (Array.isArray(parsed) && parsed.length > 0) return parsed;
      }
    } catch (e) {}
    return DEFAULT_AI_TRAINING_EXAMPLES;
  };

  const [aiAgentEnabledState, setAiAgentEnabledState] = useState<boolean>(storeInfo.aiAgentEnabled !== false);
  const [aiAgentNameState, setAiAgentNameState] = useState<string>(storeInfo.aiAgentName || 'Balbec IA');
  const [aiAgentToneState, setAiAgentToneState] = useState<string>(storeInfo.aiAgentTone || 'amigavel');
  const [aiAgentCustomPromptState, setAiAgentCustomPromptState] = useState<string>(storeInfo.aiAgentCustomPrompt || '');
  const [aiAgentWhatsAppPhoneState, setAiAgentWhatsAppPhoneState] = useState<string>(storeInfo.aiAgentWhatsAppPhone || '');
  const [aiAgentWhatsAppDefaultMessageState, setAiAgentWhatsAppDefaultMessageState] = useState<string>(storeInfo.aiAgentWhatsAppDefaultMessage || 'Olá! Vim pelo site da Balbec e gostaria de fazer um pedido.');
  const [aiAgentTrainingExamplesState, setAiAgentTrainingExamplesState] = useState<AiTrainingExample[]>(() => parseInitialTrainingExamples(storeInfo.aiAgentTrainingExamples));
  const [aiAgentKnowledgeBaseState, setAiAgentKnowledgeBaseState] = useState<string>(storeInfo.aiAgentKnowledgeBase || '');
  const [aiAgentForbiddenPhrasesState, setAiAgentForbiddenPhrasesState] = useState<string>(storeInfo.aiAgentForbiddenPhrases || '');
  const [aiAgentCreativityState, setAiAgentCreativityState] = useState<number>(storeInfo.aiAgentCreativity ?? 0.65);
  const [aiAgentAntiRepeatState, setAiAgentAntiRepeatState] = useState<boolean>(storeInfo.aiAgentAntiRepeat !== false);
  const [isAiTestModalOpen, setIsAiTestModalOpen] = useState(false);

  // In-Store Presence Security (GPS Geolocation & Desk PIN Code)
  const [inStoreGpsValidationState, setInStoreGpsValidationState] = useState<boolean>(storeInfo.inStoreGpsValidation || false);
  const [inStoreLatitudeState, setInStoreLatitudeState] = useState<number>(storeInfo.inStoreLatitude ?? -19.7478);
  const [inStoreLongitudeState, setInStoreLongitudeState] = useState<number>(storeInfo.inStoreLongitude ?? -47.9392);
  const [inStoreMaxRadiusMetersState, setInStoreMaxRadiusMetersState] = useState<number>(storeInfo.inStoreMaxRadiusMeters || 150);
  const [inStorePinValidationState, setInStorePinValidationState] = useState<boolean>(storeInfo.inStorePinValidation || false);
  const [inStorePinCodeState, setInStorePinCodeState] = useState<string>(storeInfo.inStorePinCode || '1234');
  const [preferredPrinterNameState, setPreferredPrinterNameState] = useState<string>(storeInfo.preferredPrinterName || 'EPSON TM-T20X (Rede 192.168.0.90)');
  const [caixaPrinterNameState, setCaixaPrinterNameState] = useState<string>(storeInfo.caixaPrinterName || 'EPSON TM-T20X (Rede 192.168.0.90)');
  const [autoPrintOrdersOnCaixaState, setAutoPrintOrdersOnCaixaState] = useState<boolean>(storeInfo.autoPrintOrdersOnCaixa ?? true);
  const [printerConnectionTypeState, setPrinterConnectionTypeState] = useState<'network' | 'windows' | 'usb'>(storeInfo.printerConnectionType || 'network');
  const [networkPrinterIpState, setNetworkPrinterIpState] = useState<string>(storeInfo.networkPrinterIp || '192.168.0.90');
  const [networkPrinterPortState, setNetworkPrinterPortState] = useState<number>(storeInfo.networkPrinterPort || 9100);
  const [mercadoPagoEnabledState, setMercadoPagoEnabledState] = useState<boolean>(storeInfo.mercadoPagoEnabled !== false);
  const [mercadoPagoAccessTokenState, setMercadoPagoAccessTokenState] = useState<string>(storeInfo.mercadoPagoAccessToken || '');
  const [mercadoPagoPublicKeyState, setMercadoPagoPublicKeyState] = useState<string>(storeInfo.mercadoPagoPublicKey || '');
  const [mercadoPagoPixKeyState, setMercadoPagoPixKeyState] = useState<string>(storeInfo.mercadoPagoPixKey || '3433383795');
  const [onlinePaymentEnabledState, setOnlinePaymentEnabledState] = useState<boolean>(!!storeInfo.onlinePaymentEnabled);
  const [onlinePaymentOperatorState, setOnlinePaymentOperatorState] = useState<'mercadopago' | 'stripe' | 'pagseguro'>(storeInfo.onlinePaymentOperator || 'mercadopago');
  const [onlinePaymentPublicKeyState, setOnlinePaymentPublicKeyState] = useState<string>(storeInfo.onlinePaymentPublicKey || '');
  const [onlinePaymentSecretKeyState, setOnlinePaymentSecretKeyState] = useState<string>(storeInfo.onlinePaymentSecretKey || '');
  const [deliveryEstimatedTimeMinState, setDeliveryEstimatedTimeMinState] = useState<number>(storeInfo.deliveryEstimatedTimeMin || 35);
  const [deliveryEstimatedTimeMaxState, setDeliveryEstimatedTimeMaxState] = useState<number>(storeInfo.deliveryEstimatedTimeMax || 50);
  const [printerCutModeState, setPrinterCutModeState] = useState<'partial' | 'full' | 'none'>(storeInfo.printerCutMode || 'partial');
  const [printerCopiesState, setPrinterCopiesState] = useState<number>(storeInfo.printerCopies ?? 2);
  const [configuredPrintersState, setConfiguredPrintersState] = useState<any[]>(() => {
    try {
      if (storeInfo.configuredPrinters) {
        const parsed = typeof storeInfo.configuredPrinters === 'string'
          ? JSON.parse(storeInfo.configuredPrinters)
          : storeInfo.configuredPrinters;
        if (Array.isArray(parsed) && parsed.length > 0) {
          return parsed.map((p: any) => {
            if (/elgin/i.test(p.name || '')) {
              return { ...p, isOrderPrinter: false, name: 'Elgin i9 (Ignorada para Pedidos)' };
            }
            if (/epson/i.test(p.name || '')) {
              return { ...p, isOrderPrinter: true, ip: '192.168.0.90' };
            }
            return p;
          });
        }
      }
    } catch (e) {}
    return [
      { id: 'p1', name: 'EPSON TM-T20X (Rede 192.168.0.90)', model: 'Epson Térmica 80mm (IP: 192.168.0.90)', isOrderPrinter: true, ip: '192.168.0.90' },
      { id: 'p2', name: 'Elgin i9 (Ignorada para Pedidos)', model: 'Térmica 80mm (Ignorada)', isOrderPrinter: false }
    ];
  });
  const [isCapturingStoreGps, setIsCapturingStoreGps] = useState(false);

  const handleAddPrinter = (name: string, model: string = 'Térmica 80mm') => {
    const trimmedName = name.trim();
    if (!trimmedName) return;
    const newPrinter = {
      id: 'p_' + Date.now(),
      name: trimmedName,
      model: model.trim() || 'Térmica 80mm',
      isOrderPrinter: configuredPrintersState.length === 0
    };
    setConfiguredPrintersState(prev => {
      const exists = prev.some(p => p.name.toLowerCase() === trimmedName.toLowerCase());
      if (exists) return prev;
      return [...prev, newPrinter];
    });
    if (configuredPrintersState.length === 0) {
      setPreferredPrinterNameState(trimmedName);
    }
  };

  const handleToggleOrderPrinter = (id: string) => {
    setConfiguredPrintersState(prev => 
      prev.map(p => ({
        ...p,
        isOrderPrinter: p.id === id
      }))
    );
    const selected = configuredPrintersState.find(p => p.id === id);
    if (selected) {
      setPreferredPrinterNameState(selected.name);
    }
  };

  const handleDeletePrinter = (id: string) => {
    setConfiguredPrintersState(prev => {
      const filtered = prev.filter(p => p.id !== id);
      if (filtered.length > 0 && !filtered.some(p => p.isOrderPrinter)) {
        filtered[0].isOrderPrinter = true;
        setPreferredPrinterNameState(filtered[0].name);
      }
      return filtered;
    });
  };

  const handleDirectSavePrinters = async () => {
    try {
      const orderPrinter = configuredPrintersState.find((p: any) => p.isOrderPrinter);
      const orderPrinterName = orderPrinter ? orderPrinter.name : preferredPrinterNameState;
      await updateStoreInfo({ 
        configuredPrinters: JSON.stringify(configuredPrintersState),
        preferredPrinterName: orderPrinterName,
        printerCutMode: printerCutModeState,
        printerCopies: printerCopiesState,
        caixaPrinterName: caixaPrinterNameState,
        autoPrintOrdersOnCaixa: autoPrintOrdersOnCaixaState,
        printerConnectionType: printerConnectionTypeState,
        networkPrinterIp: (networkPrinterIpState || '192.168.0.90').trim(),
        networkPrinterPort: Number(networkPrinterPortState) || 9100
      });
      const isNet = printerConnectionTypeState === 'network';
      setConfirmModal({
        isOpen: true,
        title: 'Impressoras Salvas',
        message: isNet 
          ? `Configuração de impressoras salva com sucesso! Impressora padrão do site definida por REDE TCP/IP: ${networkPrinterIpState}:${networkPrinterPortState}.`
          : `Configuração de impressoras salva com sucesso! Impressora padrão: "${orderPrinterName}", corte: ${printerCutModeState === 'partial' ? '1 Picote Parcial' : printerCutModeState === 'full' ? '1 Corte Total' : 'Sem corte no código'}, vias: ${printerCopiesState === 1 ? '1 Via Única' : '2 Vias (Cliente + Balcão)'}.`,
        onConfirm: () => setConfirmModal(null)
      });
    } catch (err) {
      console.error(err);
    }
  };

  const handleCaptureStoreGps = async () => {
    setIsCapturingStoreGps(true);
    try {
      const pos = await getCurrentPosition({ enableHighAccuracy: true });
      setInStoreLatitudeState(pos.coords.latitude);
      setInStoreLongitudeState(pos.coords.longitude);
      setConfirmModal({
        isOpen: true,
        title: 'Localização da Loja Capturada!',
        message: `Coordenadas capturadas via GPS com sucesso:\nLatitude: ${pos.coords.latitude.toFixed(6)}\nLongitude: ${pos.coords.longitude.toFixed(6)}\n\nLembre-se de clicar em "Salvar Configurações" para persistir as alterações.`,
        onConfirm: () => setConfirmModal(null)
      });
    } catch (err: any) {
      console.error('Erro ao capturar GPS:', err);
      setConfirmModal({
        isOpen: true,
        title: 'Permissão de GPS Necessária',
        message: 'Não foi possível capturar a localização atual. Verifique se você permitiu o acesso à localização nas configurações do seu navegador.',
        onConfirm: () => setConfirmModal(null)
      });
    } finally {
      setIsCapturingStoreGps(false);
    }
  };

  // Collapsible sections for Control Panel / Store Settings (default collapsed)
  const [openSettingsSections, setOpenSettingsSections] = useState<Record<string, boolean>>({
    general: false,
    notifications: false,
    printer: false,
    visual: false,
    channels: false,
    maintenance: false,
    schedule: false,
    ai_agent: false,
    bluefocus: false,
    database: false,
  });

  const toggleSettingsSection = (key: string) => {
    setOpenSettingsSections(prev => ({
      ...prev,
      [key]: !prev[key]
    }));
  };

  const handleExpandAllSettings = () => {
    setOpenSettingsSections({
      general: true,
      notifications: true,
      printer: true,
      visual: true,
      channels: true,
      maintenance: true,
      schedule: true,
      ai_agent: true,
      bluefocus: true,
      database: true,
    });
  };

  const handleCollapseAllSettings = () => {
    setOpenSettingsSections({
      general: false,
      notifications: false,
      printer: false,
      visual: false,
      channels: false,
      maintenance: false,
      schedule: false,
      ai_agent: false,
      bluefocus: false,
      database: false,
    });
  };

  useEffect(() => {
    if (storeInfo.logoUrl && storeInfo.logoUrl !== '/logo.svg') {
      setLogoPreview(storeInfo.logoUrl);
    } else {
      const savedLogo = localStorage.getItem('balbec_custom_logo_url');
      if (savedLogo) setLogoPreview(savedLogo);
    }
    if (storeInfo.themeColor) setThemeColor(storeInfo.themeColor);
    if (storeInfo.addButtonColor) setAddButtonColor(storeInfo.addButtonColor);
    if (storeInfo.iconColor) setIconColor(storeInfo.iconColor);
    if (storeInfo.categoryTitleColor) setCategoryTitleColor(storeInfo.categoryTitleColor);
    setIsOpenState(storeInfo.isOpen !== false);
    setForceOpenState(!!storeInfo.forceOpen);
    setInStoreEnabledState(storeInfo.inStoreEnabled !== false);
    setDeliveryEnabledState(storeInfo.deliveryEnabled !== false);
    if (storeInfo.deliveryScheduleEnabled !== undefined) setDeliveryScheduleEnabledState(!!storeInfo.deliveryScheduleEnabled);
    if (storeInfo.deliveryScheduleSlots !== undefined) setDeliveryScheduleSlotsState(parseScheduleSlots(storeInfo.deliveryScheduleSlots));
    if (storeInfo.scheduleIntervalMinutes !== undefined) setScheduleIntervalMinutesState(Number(storeInfo.scheduleIntervalMinutes) === 60 ? 60 : 30);
    if (storeInfo.scheduleStartTime !== undefined) setScheduleStartTimeState(storeInfo.scheduleStartTime || '08:00');
    if (storeInfo.scheduleEndTime !== undefined) setScheduleEndTimeState(storeInfo.scheduleEndTime || '19:30');
    if (storeInfo.scheduleSlotCapacities !== undefined) setScheduleSlotCapacitiesState(parseSlotCapacities(storeInfo.scheduleSlotCapacities));
    if (storeInfo.scheduleSlotItemCapacity !== undefined) setScheduleSlotItemCapacityState(Number(storeInfo.scheduleSlotItemCapacity) || 100);
    if (storeInfo.schedulePrepTimeNormalMinutes !== undefined) setSchedulePrepTimeNormalMinutesState(Number(storeInfo.schedulePrepTimeNormalMinutes) || 40);
    if (storeInfo.schedulePrepTimeFrozenMinutes !== undefined) setSchedulePrepTimeFrozenMinutesState(Number(storeInfo.schedulePrepTimeFrozenMinutes) || 90);
    if (storeInfo.salgadoPrepFritoEnabled !== undefined) setSalgadoPrepFritoEnabledState(storeInfo.salgadoPrepFritoEnabled !== false);
    if (storeInfo.salgadoPrepAssadoEnabled !== undefined) setSalgadoPrepAssadoEnabledState(storeInfo.salgadoPrepAssadoEnabled !== false);
    if (storeInfo.salgadoPrepFritoCongeladoEnabled !== undefined) setSalgadoPrepFritoCongeladoEnabledState(storeInfo.salgadoPrepFritoCongeladoEnabled !== false);
    if (storeInfo.salgadoPrepAssadoCongeladoEnabled !== undefined) setSalgadoPrepAssadoCongeladoEnabledState(storeInfo.salgadoPrepAssadoCongeladoEnabled !== false);
    setKioskEnabledState(storeInfo.kioskEnabled !== false);
    setRequireQrCodeForOrderingState(storeInfo.requireQrCodeForOrdering !== false);
    setIsMaintenanceState(storeInfo.isMaintenance || false);
    if (storeInfo.weeklySchedule) setWeeklyScheduleState(parseWeeklySchedule(storeInfo.weeklySchedule));
    if (storeInfo.autoOpenClose !== undefined) setAutoOpenCloseState(storeInfo.autoOpenClose !== false);
    if (storeInfo.closedMessage !== undefined) setClosedMessageState(storeInfo.closedMessage);
    if (storeInfo.aiAgentEnabled !== undefined) setAiAgentEnabledState(storeInfo.aiAgentEnabled);
    if (storeInfo.aiAgentName) setAiAgentNameState(storeInfo.aiAgentName);
    if (storeInfo.aiAgentTone) setAiAgentToneState(storeInfo.aiAgentTone);
    if (storeInfo.aiAgentCustomPrompt !== undefined) setAiAgentCustomPromptState(storeInfo.aiAgentCustomPrompt);
    if (storeInfo.aiAgentWhatsAppPhone !== undefined) setAiAgentWhatsAppPhoneState(storeInfo.aiAgentWhatsAppPhone);
    if (storeInfo.aiAgentWhatsAppDefaultMessage !== undefined) setAiAgentWhatsAppDefaultMessageState(storeInfo.aiAgentWhatsAppDefaultMessage);
    if (storeInfo.aiAgentTrainingExamples !== undefined) setAiAgentTrainingExamplesState(parseInitialTrainingExamples(storeInfo.aiAgentTrainingExamples));
    if (storeInfo.aiAgentKnowledgeBase !== undefined) setAiAgentKnowledgeBaseState(storeInfo.aiAgentKnowledgeBase);
    if (storeInfo.aiAgentForbiddenPhrases !== undefined) setAiAgentForbiddenPhrasesState(storeInfo.aiAgentForbiddenPhrases);
    if (storeInfo.aiAgentCreativity !== undefined) setAiAgentCreativityState(Number(storeInfo.aiAgentCreativity) || 0.65);
    if (storeInfo.aiAgentAntiRepeat !== undefined) setAiAgentAntiRepeatState(storeInfo.aiAgentAntiRepeat !== false);
    if (storeInfo.inStoreGpsValidation !== undefined) setInStoreGpsValidationState(storeInfo.inStoreGpsValidation);
    if (storeInfo.inStoreLatitude !== undefined) setInStoreLatitudeState(storeInfo.inStoreLatitude);
    if (storeInfo.inStoreLongitude !== undefined) setInStoreLongitudeState(storeInfo.inStoreLongitude);
    if (storeInfo.inStoreMaxRadiusMeters !== undefined) setInStoreMaxRadiusMetersState(storeInfo.inStoreMaxRadiusMeters);
    if (storeInfo.inStorePinValidation !== undefined) setInStorePinValidationState(storeInfo.inStorePinValidation);
    if (storeInfo.inStorePinCode !== undefined) setInStorePinCodeState(storeInfo.inStorePinCode);
    if (storeInfo.preferredPrinterName !== undefined) setPreferredPrinterNameState(storeInfo.preferredPrinterName);
    if (storeInfo.printerCutMode !== undefined) setPrinterCutModeState(storeInfo.printerCutMode as any);
    if (storeInfo.printerCopies !== undefined) setPrinterCopiesState(Number(storeInfo.printerCopies) || 2);
    if (storeInfo.mercadoPagoEnabled !== undefined) setMercadoPagoEnabledState(storeInfo.mercadoPagoEnabled !== false);
    if (storeInfo.mercadoPagoAccessToken !== undefined) setMercadoPagoAccessTokenState(storeInfo.mercadoPagoAccessToken);
    if (storeInfo.mercadoPagoPublicKey !== undefined) setMercadoPagoPublicKeyState(storeInfo.mercadoPagoPublicKey);
    if (storeInfo.mercadoPagoPixKey !== undefined) setMercadoPagoPixKeyState(storeInfo.mercadoPagoPixKey);
    if (storeInfo.deliveryEstimatedTimeMin !== undefined) setDeliveryEstimatedTimeMinState(Number(storeInfo.deliveryEstimatedTimeMin) || 35);
    if (storeInfo.deliveryEstimatedTimeMax !== undefined) setDeliveryEstimatedTimeMaxState(Number(storeInfo.deliveryEstimatedTimeMax) || 50);
    if (storeInfo.showSystemIntroButton !== undefined) setShowSystemIntroButtonState(storeInfo.showSystemIntroButton !== false);
  }, [
    storeInfo.logoUrl,
    storeInfo.showSystemIntroButton,
    storeInfo.themeColor,
    storeInfo.addButtonColor,
    storeInfo.iconColor,
    storeInfo.categoryTitleColor,
    storeInfo.isOpen,
    storeInfo.forceOpen,
    storeInfo.inStoreEnabled,
    storeInfo.deliveryEnabled,
    storeInfo.kioskEnabled,
    storeInfo.requireQrCodeForOrdering,
    storeInfo.isMaintenance,
    storeInfo.weeklySchedule,
    storeInfo.autoOpenClose,
    storeInfo.closedMessage,
    storeInfo.aiAgentEnabled,
    storeInfo.aiAgentName,
    storeInfo.aiAgentTone,
    storeInfo.aiAgentCustomPrompt,
    storeInfo.aiAgentWhatsAppPhone,
    storeInfo.aiAgentWhatsAppDefaultMessage,
    storeInfo.inStoreGpsValidation,
    storeInfo.inStoreLatitude,
    storeInfo.inStoreLongitude,
    storeInfo.inStoreMaxRadiusMeters,
    storeInfo.inStorePinValidation,
    storeInfo.inStorePinCode,
    storeInfo.preferredPrinterName,
    storeInfo.printerCutMode,
    storeInfo.printerCopies,
    storeInfo.mercadoPagoEnabled,
    storeInfo.mercadoPagoAccessToken,
    storeInfo.mercadoPagoPublicKey,
    storeInfo.mercadoPagoPixKey,
    storeInfo.deliveryEstimatedTimeMin,
    storeInfo.deliveryEstimatedTimeMax,
    storeInfo.deliveryScheduleEnabled,
    storeInfo.deliveryScheduleSlots,
    storeInfo.scheduleIntervalMinutes,
    storeInfo.scheduleStartTime,
    storeInfo.scheduleEndTime,
    storeInfo.scheduleSlotCapacities,
    storeInfo.scheduleSlotItemCapacity,
    storeInfo.schedulePrepTimeNormalMinutes,
    storeInfo.schedulePrepTimeFrozenMinutes,
    storeInfo.salgadoPrepFritoEnabled,
    storeInfo.salgadoPrepAssadoEnabled,
    storeInfo.salgadoPrepFritoCongeladoEnabled,
    storeInfo.salgadoPrepAssadoCongeladoEnabled
  ]);
  const [productImagePreview, setProductImagePreview] = useState('');
  
  const [isSoundEnabled, setIsSoundEnabled] = useState(() => {
    const saved = safeStorage.getItem('balbec_sound_enabled') || (typeof localStorage !== 'undefined' ? localStorage.getItem('balbec_sound_enabled') : null);
    return saved !== null ? saved === 'true' : true;
  });
  const [isSaving, setIsSaving] = useState(false);
  const [isSyncing, setIsSyncing] = useState(false);
  const [syncProgress, setSyncProgress] = useState<{ 
    current: number, 
    total: number, 
    status: string,
    ignored: number,
    ignoredBreakdown?: Record<string, number>,
    lastProcessedName?: string,
    lastProductName?: string,
    lastProductId?: string
  } | null>(null);
  const [isTestingBlueFocus, setIsTestingBlueFocus] = useState(false);
  const [exportingOrderId, setExportingOrderId] = useState<string | null>(null);
  
  // BlueFocus Config State (fonte autoritativa no PostgreSQL com cache local)
  const [blueFocusConfig, setBlueFocusConfig] = useState<BlueFocusIntegrationConfig>(() => {
    return resolveFullBlueFocusConfig(storeInfo);
  });

  // Auto Sync State (Sincronização Automática a cada 2h: Seg a Sex das 08h às 18h | Sábados das 08h às 12h | Domingos pausado)
  const [isAutoSyncEnabled, setIsAutoSyncEnabled] = useState<boolean>(() => {
    return resolveFullBlueFocusConfig(storeInfo).autoSyncEnabled;
  });
  const [lastAutoSyncTime, setLastAutoSyncTime] = useState<string | null>(() => {
    return localStorage.getItem('bluefocus_last_auto_sync_time');
  });

  const migratedLegacyBfRef = useRef(false);

  useEffect(() => {
    const serverCfg = parseServerBlueFocusConfig(storeInfo);
    const hasServerData = Object.keys(serverCfg).filter(k => k !== '_fullSyncedAt').length > 0;

    if (hasServerData) {
      const merged = resolveFullBlueFocusConfig(storeInfo);
      setBlueFocusConfig(merged);
      if (serverCfg.autoSyncEnabled !== undefined) {
        setIsAutoSyncEnabled(Boolean(serverCfg.autoSyncEnabled));
      }
      mirrorBlueFocusConfigToLocalStorage(merged);
    }

    // Migração automática única: se o servidor ainda não tem os campos completos (syncUrl/_fullSyncedAt)
    // mas este computador principal possui a configuração antiga no localStorage, sobe tudo para o banco de dados.
    if (
      isInitialized &&
      !migratedLegacyBfRef.current &&
      !serverCfg._fullSyncedAt &&
      !serverCfg.syncUrl &&
      hasLegacyLocalStorageBlueFocusConfig()
    ) {
      migratedLegacyBfRef.current = true;
      const fullConfigToMigrate = resolveFullBlueFocusConfig(storeInfo);
      mirrorBlueFocusConfigToLocalStorage(fullConfigToMigrate);
      setBlueFocusConfig(fullConfigToMigrate);
      setIsAutoSyncEnabled(Boolean(fullConfigToMigrate.autoSyncEnabled));
      updateStoreInfo({
        blueFocusExportConfig: serializeBlueFocusConfigForDb(
          fullConfigToMigrate,
          fullConfigToMigrate.autoSyncEnabled
        ),
      }).catch(() => {});
    }
  }, [storeInfo?.blueFocusExportConfig, isInitialized]);

  const isSyncingRef = useRef(isSyncing);
  useEffect(() => {
    isSyncingRef.current = isSyncing;
  }, [isSyncing]);

  useEffect(() => {
    if (!isAutoSyncEnabled) return;

    // Horários fixos programados de 2 em 2 horas: 08:00 às 20:00 (Segunda a Sábado)
    const SCHEDULED_HOURS = [8, 10, 12, 14, 16, 18, 20];

    // Helper: verifica se deve rodar no horário programado
    const shouldRunSync = (date: Date): boolean => {
      const day = date.getDay(); // 0 = Domingo, 1 = Segunda ... 6 = Sábado
      const currentHour = date.getHours();

      // Domingo: não sincroniza
      if (day === 0) return false;

      // Segunda a Sábado: nos horários programados de 2 em 2 horas
      return SCHEDULED_HOURS.includes(currentHour);
    };

    // Verificar a cada 30 segundos
    const checkTimer = setInterval(async () => {
      if (isSyncingRef.current) return;

      const now = new Date();
      if (!shouldRunSync(now)) return;

      const todayKey = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}_H${now.getHours()}`;
      const lastRunSlot = localStorage.getItem('bluefocus_last_auto_sync_slot');

      // Se já rodou nesta mesma hora/slot hoje, não repete
      if (lastRunSlot === todayKey) return;

      const dayNames = ['Domingo', 'Segunda', 'Terça', 'Quarta', 'Quinta', 'Sexta', 'Sábado'];
      const currentDayName = dayNames[now.getDay()];
      console.log(`[Auto-Sync] Iniciando sincronização programada das ${String(now.getHours()).padStart(2, '0')}:00 (${currentDayName})...`);

      try {
        // Tenta sincronizar primeiro, apenas marca como concluído SE não der erro
        await handleSyncBlueFocus({ tipoAtualizacao: 'A' }, true);
        await handleSyncCustomersBlueFocus({ tipoAtualizacao: 'A' }, true);
        
        localStorage.setItem('bluefocus_last_auto_sync_slot', todayKey);
        localStorage.setItem('bluefocus_last_auto_sync_timestamp', String(now.getTime()));
        const nowIso = now.toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' });
        localStorage.setItem('bluefocus_last_auto_sync_time', nowIso);
        setLastAutoSyncTime(nowIso);
      } catch (err) {
        console.error('[Auto-Sync] Falha na sincronização programada. Tentará novamente no próximo ciclo se dentro da janela.', err);
      }
    }, 30000);

    return () => clearInterval(checkTimer);
  }, [isAutoSyncEnabled]);

  
  // Connection test state
  const [connectionStatus, setConnectionStatus] = useState<'idle' | 'testing' | 'success' | 'error'>('idle');
  const [connectionErrorMessage, setConnectionErrorMessage] = useState('');
  
  const prevPendingIds = useRef<string[]>([]);
  const autoPrintedOrderIds = useRef<Set<string>>(new Set());
  const allKnownOrderIds = useRef<Set<string>>(new Set());
  const isInitialOrderLoad = useRef<boolean>(true);
  const audioRef = useRef<HTMLAudioElement | null>(null);
  const intervalRef = useRef<number | null>(null);

  useEffect(() => {
    // Initialize audio element
    audioRef.current = new Audio('https://actions.google.com/sounds/v1/alarms/alarm_clock.ogg');
    audioRef.current.loop = false;
    audioRef.current.volume = 1.0;

    return () => {
      if (audioRef.current) {
        audioRef.current.pause();
        audioRef.current = null;
      }
    };
  }, []);

  const playBeep = () => {
    if (!isSoundEnabled) return;
    if (audioRef.current) {
      audioRef.current.currentTime = 0;
      audioRef.current.play().catch(e => console.log('Audio play blocked by browser:', e));
    }
  };

  const handleSyncBlueFocus = async (overrideConfig?: Partial<typeof blueFocusConfig>, isAutoSync = false) => {
    if (isSyncing) return;
    setIsSyncing(true);

    // Auto-salvar um backup preventivo do Totem antes de sincronizar com ERP
    try {
      const timeStr = new Date().toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' });
      await fetch('/api/db/totem-backups', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name: `Auto-Backup Pré-Sync ERP (${timeStr})` })
      });
      fetchTotemBackups().catch(() => {});
    } catch (_) {}
    
    const activeConfig = { ...blueFocusConfig, ...overrideConfig };
    
    // Use values from config as starting point if available
    let currentCargaNumero = parseInt(activeConfig.startCargaNumero) || 0;
    let currentCargaSequencia = parseInt(activeConfig.startCargaSequencia) || 0;
    let currentProdutoId = parseInt((activeConfig as any).startProdutoId) || 0;
    
    setSyncProgress({ 
      current: 0, 
      total: 0, 
      ignored: 0, 
      status: `Iniciando... (Início: ${currentCargaNumero}/${currentCargaSequencia}, Produto: ${currentProdutoId})` 
    });
    
    console.log(`Iniciando sincronização. Carga inicial: ${currentCargaNumero}/${currentCargaSequencia}`);
    
    let allBlueFocusProducts: any[] = [];
    let hasMore = true;
    let totalIterations = 0;
    let lastDebugXml = "";

    try {
      console.log("Iniciando sincronização em lotes...");
      
      // Cria snapshot de segurança automático antes de iniciar qualquer sincronização
      try {
        await fetch('/api/db/backup-snapshot', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ 
            reason: activeConfig.tipoAtualizacao === 'C' ? 'Carga Total ERP (Antes de Sincronizar)' : 'Sincronização de Preços ERP' 
          })
        });
        console.log("[Sync] Snapshot de segurança pré-sincronização salvo com sucesso.");
      } catch (snapErr) {
        console.warn("[Sync] Aviso ao criar snapshot de segurança:", snapErr);
      }
      
      let totalIgnored = 0;
      let cumulativeIgnoredBreakdown: Record<string, number> = { suspended: 0, filtered: 0 };
      
      let lastProgressUpdate = Date.now();
      
      while (hasMore && totalIterations < 50000) { // Increased safety limit to 50k
        // Throttle UI updates to every 1000ms for even better performance on mobile
        if (Date.now() - lastProgressUpdate > 1000) {
          setSyncProgress(prev => ({ 
            ...prev,
            current: totalIterations, 
            total: allBlueFocusProducts.length, 
            ignored: totalIgnored,
            status: `Sincronizando... (Lote ${totalIterations / 200 + 1})` 
          }));
          lastProgressUpdate = Date.now();
        }

        let retryCount = 0;
        const maxRetries = 3;
        let response;
        
        while (retryCount < maxRetries) {
          try {
            response = await fetch('/api/bluefocus/sync-products', {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({
                ...activeConfig,
                startCargaNumero: currentCargaNumero,
                startCargaSequencia: currentCargaSequencia,
                startProdutoId: currentProdutoId,
                batchSize: Number(activeConfig.batchSize) || 4, // Iterações por requisição HTTP
                excludeKeywords: EXCLUDED_CATEGORIES
              })
            });
            if (response.ok) break;
            
            let serverErrMsg = `Erro no servidor (Status ${response.status})`;
            try {
              const text = await response.text();
              try {
                const errPayload = JSON.parse(text);
                if (errPayload?.error) {
                  serverErrMsg = errPayload.error + (errPayload.details ? `\n• Detalhe: ${typeof errPayload.details === 'object' ? JSON.stringify(errPayload.details) : errPayload.details}` : '');
                } else {
                  serverErrMsg = text.substring(0, 250);
                }
              } catch {
                serverErrMsg = text.substring(0, 250) || `Erro no servidor (Status ${response.status})`;
              }
            } catch (_) {}
            
            throw new Error(serverErrMsg);
          } catch (e: any) {
            retryCount++;
            if (retryCount >= maxRetries) throw e;
            console.log(`Erro no lote (${e?.message || e}), tentando novamente (${retryCount}/${maxRetries})...`);
            await new Promise(r => setTimeout(r, 2000)); // Wait before retry
          }
        }
        
        if (!response) throw new Error("Falha na comunicação com o servidor.");
        
        const contentType = response.headers.get("content-type");
        if (!contentType || !contentType.includes("application/json")) {
          const text = await response.text();
          const status = response.status;
          throw new Error(`O servidor retornou um formato inesperado (Status ${status}). Resposta: ${text.substring(0, 100)}...`);
        }

        const data = await response.json();
        if (!response.ok) {
          const err: any = new Error(data.error || 'Erro na API');
          err.debugXml = data.debugXml;
          throw err;
        }

        const batchProducts = data.products || [];
        const batchIgnored = data.ignoredCount || 0;
        const batchBreakdown = data.ignoredBreakdown || {};

        // Merge breakdown
        Object.entries(batchBreakdown).forEach(([key, val]) => {
          cumulativeIgnoredBreakdown[key] = (cumulativeIgnoredBreakdown[key] || 0) + (val as number);
        });

        allBlueFocusProducts = [...allBlueFocusProducts, ...batchProducts];
        currentCargaNumero = data.nextCargaNumero;
        currentCargaSequencia = data.nextCargaSequencia;
        currentProdutoId = data.lastProductId ? parseInt(data.lastProductId) : currentProdutoId;
        hasMore = data.snFim === 'N';
        totalIterations += data.iterations || 1;
        totalIgnored += batchIgnored;
        lastDebugXml = data.debugXml;

        // Only update these fields if we are throttled to save renders
        if (Date.now() - lastProgressUpdate > 500 || !hasMore) {
          setSyncProgress(prev => ({
            ...prev!,
            current: totalIterations,
            total: allBlueFocusProducts.length,
            ignored: totalIgnored,
            ignoredBreakdown: { ...cumulativeIgnoredBreakdown },
            lastProcessedName: data.lastProcessedName,
            lastProductName: data.lastProductName,
            lastProductId: data.lastProductId
          }));
        }

        console.log(`Lote concluído: ${allBlueFocusProducts.length} válidos, ${totalIgnored} ignorados`);
        
        // Very small delay to keep UI responsive without excessive waiting
        // Aumentado o delay entre lotes para evitar erros de "Rate Exceeded" do ERP
        // BlueFocus costuma ter limites de requisições por segundo.
        await new Promise(resolve => setTimeout(resolve, 1000));


        if (!hasMore) break;
      }

      // Deduplicate products (keep latest)
      const productsMap = new Map();
      allBlueFocusProducts.forEach(p => productsMap.set(p.externalId, p));
      const blueFocusProducts = Array.from(productsMap.values());

      console.log("Total de produtos únicos encontrados:", blueFocusProducts.length);
      
      if (blueFocusProducts.length === 0) {
        console.log("Debug: Nenhum produto encontrado. Último XML recebido:", lastDebugXml.substring(0, 1000));
        
        const isIncremental = activeConfig.tipoAtualizacao === 'A';

        addSyncLog({
          type: isIncremental ? 'Sincronização Incremental (BlueFocus)' : 'Carga Total (BlueFocus)',
          status: 'warning',
          productsUpdated: 0,
          productsCreated: 0,
          categoriesCreated: 0,
          ignoredCount: totalIgnored,
          totalRead: totalIterations,
          details: isIncremental 
            ? `Sincronização concluída. Nenhuma nova alteração no ERP desde o marcador ${activeConfig.startCargaNumero}/${activeConfig.startCargaSequencia}.`
            : 'Nenhum produto foi retornado em modo Carga Total.',
          user: currentUser?.name || 'Sistema'
        });
        
        if (isIncremental) {
          setConfirmModal({
            isOpen: true,
            title: 'Sincronização de Alterações',
            message: `Sincronização concluída.\n\nNão foram encontradas novas alterações ou novos produtos no ERP desde a última carga (${activeConfig.startCargaNumero}/${activeConfig.startCargaSequencia}).\n\nSeus produtos já estão atualizados. Se desejar recarregar todos os produtos do catálogo do zero, clique em "Zerar e Importar Tudo".`,
            confirmText: 'Zerar e Importar Tudo (Carga Total)',
            cancelText: 'Fechar',
            onConfirm: () => {
              setConfirmModal(null);
              const freshConfig = {
                ...blueFocusConfig,
                tipo: '4',
                tipoAtualizacao: 'C',
                startCargaNumero: '0',
                startCargaSequencia: '0',
                startProdutoId: '0'
              };
              setBlueFocusConfig(freshConfig);
              localStorage.setItem('bluefocus_tipo', '4');
              localStorage.setItem('bluefocus_tipo_atualizacao', 'C');
              localStorage.setItem('bluefocus_start_carga_numero', '0');
              localStorage.setItem('bluefocus_start_carga_sequencia', '0');
              localStorage.setItem('bluefocus_start_produto_id', '0');
              handleSyncBlueFocus(freshConfig);
            }
          });
        } else {
          setConfirmModal({
            isOpen: true,
            title: 'Carga Total BlueFocus',
            message: 'Nenhum produto foi retornado pelo sistema BlueFocus em modo Carga Total.\n\nVerifique se o código da Empresa, PDV e Usuário estão corretos nas Configurações da BlueFocus.',
            onConfirm: () => setConfirmModal(null)
          });
        }
        return;
      }

      setSyncProgress({ 
        current: totalIterations, 
        total: blueFocusProducts.length, 
        ignored: totalIgnored,
        status: 'Salvando no banco de dados...' 
      });

      let categoriesCreated = 0;
      let productsCreated = 0;
      let productsUpdated = 0;

      // Process categories first - group by category name / externalId cleanly
      const categoryMap = new Map<string, { id: string; name: string }>();

      for (const p of blueFocusProducts) {
        const catName = (p.categoryName || 'Geral').trim();
        const catExtId = String(p.categoryExternalId || '0').trim();
        // Use normalized category name as key to merge categories with slight case/accent variations
        const key = normalizeText(catName) || catExtId;

        if (!categoryMap.has(key)) {
          categoryMap.set(key, { id: catExtId !== '0' ? catExtId : key, name: catName });
        }
      }

      const uniqueCategories = Array.from(categoryMap.values());

      // Fetch latest categories from Cloud SQL
      const resCat = await fetch('/api/db/categories');
      let currentCategories: any[] = resCat.ok ? await resCat.json() : categories;

      for (const cat of uniqueCategories) {
        let existingCat = currentCategories.find(c => 
          (c.externalId && String(c.externalId) !== '0' && String(c.externalId) === String(cat.id)) || 
          normalizeText(c.name) === normalizeText(cat.name)
        );
        if (!existingCat) {
          const newCatId = Math.random().toString(36).substring(2, 9);
          const isExcl = isExcludedCategory(cat.name) || isAddonCategory(cat.name);
          const newCat = {
            id: newCatId,
            name: cat.name,
            order: currentCategories.length + 1,
            externalId: String(cat.id),
            isVisible: true,
            availableInStore: !isExcl,
            availableForDelivery: false,
            availableForKiosk: false, // Default NEW ERP-synced categories to false for Totem to avoid clutter
          };
          const saveRes = await fetch('/api/db/categories', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(newCat)
          });
          if (saveRes.ok) {
            const savedCat = await saveRes.json();
            currentCategories.push(savedCat);
            categoriesCreated++;
          }
        }
        // NOTA DE SEGURANÇA: Se a categoria já existe no sistema, NUNCA alteramos sua visibilidade
        // ou disponibilidade (evita reativar categorias excluídas/desativadas ou resetar o totem).
      }

      // Fetch latest products from database
      const resProd = await fetch('/api/db/products');
      let currentProducts: any[] = resProd.ok ? await resProd.json() : products;
      if (!Array.isArray(currentProducts) || currentProducts.length === 0) {
        currentProducts = products;
      }

      // Mapas de busca para matching preciso e à prova de falhas:
      const prodByExternalId = new Map<string, any>();
      const prodByCleanExternalId = new Map<string, any>();
      const prodByName = new Map<string, any>();
      const prodById = new Map<string, any>();
      const prodByCleanTitle = new Map<string, any>();

      const cleanTitleKey = (str: string) => 
        normalizeText(str)
          .replace(/\b(kg|g|un|und|unid|unidade|unidades|litro|litros|lt|l|ml|fatia|fatias|duplo|simples|especial|tradicional|confira|adicionais)\b/gi, '')
          .replace(/\s+/g, ' ')
          .trim();

      currentProducts.forEach(p => {
        if (p.id) {
          prodById.set(String(p.id).trim(), p);
        }
        if (p.externalId && String(p.externalId).trim() !== '' && String(p.externalId) !== '0') {
          const ext = String(p.externalId).trim();
          prodByExternalId.set(ext, p);
          prodByCleanExternalId.set(ext.replace(/^0+/, ''), p);
        }
        if (p.name) {
          const norm = normalizeText(p.name);
          if (norm) {
            prodByName.set(norm, p);
            const clKey = cleanTitleKey(p.name);
            if (clKey && !prodByCleanTitle.has(clKey)) {
              prodByCleanTitle.set(clKey, p);
            }
          }
        }
      });

      const productsToSave: any[] = [];
      for (const bp of blueFocusProducts) {
        const bpExt = String(bp.externalId || '').trim();
        const bpCleanExt = bpExt.replace(/^0+/, '');
        const bpNormName = normalizeText(bp.name);

        let existingProduct = null;
        // Helper: nunca casar por nome se o produto local já tiver outro externalId diferente definido
        const hasDifferentExternalId = (p: any) => {
          const pExt = String(p?.externalId || '').trim();
          const pCleanExt = pExt.replace(/^0+/, '');
          return Boolean(pExt && pExt !== '0' && bpExt && bpExt !== '0' && pExt !== bpExt && pCleanExt !== bpCleanExt);
        };

        // 1. Match exato ou sem zeros à esquerda por externalId ou ID interno
        if (bpExt && bpExt !== '0') {
          existingProduct = prodByExternalId.get(bpExt) || prodByCleanExternalId.get(bpCleanExt) || prodById.get(bpExt);
        }
        // 2. Match exato por nome normalizado (apenas se não houver conflito de código externo)
        if (!existingProduct && bpNormName) {
          const candidate = prodByName.get(bpNormName);
          if (candidate && !hasDifferentExternalId(candidate)) {
            existingProduct = candidate;
          }
        }
        // 3. Match sem sufixos de medidas/peso (ex: "PÃO FRANCÊS" vs "Pão Francês (kg)")
        if (!existingProduct && bpNormName) {
          const bpClKey = cleanTitleKey(bp.name);
          if (bpClKey) {
            const candidate = prodByCleanTitle.get(bpClKey);
            if (candidate && !hasDifferentExternalId(candidate)) {
              existingProduct = candidate;
            }
          }
        }
        // 4. Match por prefixo quando o nome tem pelo menos 7 caracteres
        if (!existingProduct && bpNormName && bpNormName.length >= 7) {
          existingProduct = currentProducts.find(p => {
            if (hasDifferentExternalId(p)) return false;
            const pNorm = normalizeText(p.name || '');
            return pNorm.length >= 7 && (pNorm.startsWith(bpNormName) || bpNormName.startsWith(pNorm));
          });
        }

        if (existingProduct) {
          const manualFields: string[] = Array.isArray(existingProduct.manualFields) ? existingProduct.manualFields : [];
          const isPriceProtected = manualFields.includes('price') || (activeConfig as any).preserveManualPrices !== false;
          const newPrice = Number(bp.price);
          const nextPrice = isPriceProtected
            ? existingProduct.price
            : ((!isNaN(newPrice) && newPrice >= 0) ? newPrice : existingProduct.price);

          const hasCustomImage =
            manualFields.includes('imageUrl') ||
            Boolean(existingProduct.imageUrl && String(existingProduct.imageUrl).trim() !== '');
          const updatedImageUrl = hasCustomImage
            ? (existingProduct.imageUrl || '')
            : (bp.imageUrl || existingProduct.imageUrl || '');

          const nextExternalId = (bpExt && bpExt !== '0') ? bpExt : existingProduct.externalId;

          const hasRealChange =
            Number(nextPrice) !== Number(existingProduct.price) ||
            String(updatedImageUrl || '') !== String(existingProduct.imageUrl || '') ||
            String(nextExternalId || '') !== String(existingProduct.externalId || '');

          if (hasRealChange) {
            productsUpdated++;
            productsToSave.push({
              ...existingProduct,
              price: nextPrice,
              imageUrl: updatedImageUrl,
              externalId: nextExternalId
            });
          }
        } else {
          // PRODUTO NOVO (NUNCA VISTO ANTES NO SISTEMA):
          productsCreated++;
          const defaultCategory = currentCategories.find(c => 
            (c.externalId && String(c.externalId) !== '0' && String(c.externalId) === String(bp.categoryExternalId)) ||
            normalizeText(c.name) === normalizeText(bp.categoryName)
          );
          const defaultCategoryId = defaultCategory?.id || currentCategories[0]?.id || 'cat-paes';
          const prodId = Math.random().toString(36).substring(2, 9);

          productsToSave.push({
            id: prodId,
            name: bp.name,
            description: cleanProductDescription(bp.description, true),
            price: Number(bp.price) || 0,
            categoryId: defaultCategoryId,
            isActive: true,
            isAddon: false,
            isFlavor: false,
            imageUrl: bp.imageUrl || '',
            externalId: bpExt,
            availableForDelivery: false,
            availableInStore: true,
            availableForKiosk: false // Novo produto entra desativado no Totem até revisão do gestor
          });
        }
      }

      // Save products in manageable batches for performance and memory safety
      for (let i = 0; i < productsToSave.length; i += 50) {
        const chunk = productsToSave.slice(i, i + 50);
        setSyncProgress(prev => ({ 
          ...prev!, 
          status: `Salvando no Banco de Dados... (${Math.min(i + chunk.length, productsToSave.length)}/${productsToSave.length})` 
        }));
        await fetch('/api/db/products/batch', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(chunk)
        });
      }

      // Refresh store state from Cloud SQL PostgreSQL
      await fetchData();

      const breakdownLines = Object.entries(cumulativeIgnoredBreakdown)
        .filter(([_, val]) => val > 0)
        .map(([key, val]) => {
          let label = key;
          if (key === 'suspended') label = '📦 Suspensos no ERP';
          if (key === 'filtered') label = '🔍 Filtros Ativos (Total)';
          return `   • ${label}: ${val}`;
        }).join('\n');

      addSyncLog({
        type: activeConfig.tipoAtualizacao === 'C' ? 'Carga Total (BlueFocus)' : 'Sincronização ERP (BlueFocus)',
        status: 'success',
        productsUpdated,
        productsCreated,
        categoriesCreated,
        ignoredCount: totalIgnored,
        totalRead: totalIterations,
        details: `Sincronização realizada com sucesso! Lidos: ${totalIterations} | Válidos: ${blueFocusProducts.length} | Criados: ${productsCreated} | Alterados: ${productsUpdated} | Categorias novas: ${categoriesCreated} | Marcador final: ${currentCargaNumero}/${currentCargaSequencia}`,
        user: currentUser?.name || 'Sistema'
      });

      const nextSyncedCfg: BlueFocusIntegrationConfig = {
        ...activeConfig,
        startCargaNumero: String(currentCargaNumero),
        startCargaSequencia: String(currentCargaSequencia),
        startProdutoId: String(currentProdutoId),
        autoSyncEnabled: isAutoSyncEnabled,
      };
      mirrorBlueFocusConfigToLocalStorage(nextSyncedCfg);

      if (isAutoSync) {
        // Na sincronização automática, atualizamos o config, localStorage e banco de dados para o próximo ciclo
        setBlueFocusConfig(nextSyncedCfg);
        updateStoreInfo({
          blueFocusExportConfig: serializeBlueFocusConfigForDb(nextSyncedCfg, isAutoSyncEnabled),
        }).catch(() => {});
        console.log(`[Auto-Sync] Sincronização concluída com sucesso! Marcador: ${currentCargaNumero}/${currentCargaSequencia}`);
      } else {
        setBlueFocusConfig(nextSyncedCfg);
        updateStoreInfo({
          blueFocusExportConfig: serializeBlueFocusConfigForDb(nextSyncedCfg, isAutoSyncEnabled),
        }).catch(() => {});
        setConfirmModal({
          isOpen: true,
          title: 'Sincronização Concluída',
          message: `Sincronização finalizada com sucesso!\n\n🔹 Estatísticas:\nRegistros brutos lidos: ${totalIterations}\nProdutos válidos: ${blueFocusProducts.length}\nItens ignorados: ${totalIgnored}\n\n📋 Detalhamento dos Ignorados:\n${breakdownLines || 'Nenhum item ignorado.'}\n\n🏠 Mudanças no Banco:\nCategorias novas: ${categoriesCreated}\nProdutos novos: ${productsCreated}\nProdutos atualizados: ${productsUpdated}\n\nO ponto de início foi atualizado para: ${currentCargaNumero}/${currentCargaSequencia}`,
          onConfirm: () => {
            setConfirmModal(null);
          },
          debugXml: lastDebugXml
        });
      }

    } catch (error: any) {
      console.error('Sync Error:', error);
      
      // Try to extract more details if available
      let detailedError = error.message || 'Ocorreu um erro ao tentar sincronizar.';

      addSyncLog({
        type: activeConfig.tipoAtualizacao === 'C' ? 'Carga Total (BlueFocus)' : 'Sincronização ERP (BlueFocus)',
        status: 'error',
        productsUpdated: 0,
        productsCreated: 0,
        categoriesCreated: 0,
        ignoredCount: 0,
        totalRead: 0,
        details: detailedError,
        user: currentUser?.name || 'Sistema'
      });
      
      setConfirmModal({
        isOpen: true,
        title: 'Erro na Sincronização',
        message: detailedError,
        onConfirm: () => setConfirmModal(null),
        debugXml: lastDebugXml || error.debugXml
      });
    } finally {
      setIsSyncing(false);
      setSyncProgress(null);
    }
  };

  const handleSyncCustomersBlueFocus = async (overrideConfig?: any, isAutoSync = false) => {
    if (isSyncing) return;
    setIsSyncing(true);

    const activeConfig = { ...blueFocusConfig, ...overrideConfig };
    let currentCargaNumero = overrideConfig?.cargaNumero !== undefined
      ? Number(overrideConfig.cargaNumero)
      : (parseInt(localStorage.getItem('bluefocus_cliente_carga_numero') || '0', 10) || 0);
    let currentCargaSequencia = overrideConfig?.cargaSequencia !== undefined
      ? Number(overrideConfig.cargaSequencia)
      : (parseInt(localStorage.getItem('bluefocus_cliente_carga_sequencia') || '0', 10) || 0);
    let currentPessoaId = overrideConfig?.startPessoaId !== undefined
      ? Number(overrideConfig.startPessoaId)
      : (parseInt(localStorage.getItem('bluefocus_start_pessoa_id') || '0', 10) || 0);
    const tipoCliente = overrideConfig?.tipoCliente || localStorage.getItem('bluefocus_tipo_cliente') || '2';
    const tipoAtualizacao = overrideConfig?.tipoAtualizacao || localStorage.getItem('bluefocus_tipo_atualizacao_cliente') || activeConfig.tipoAtualizacao || 'A';

    setSyncProgress({
      current: 0,
      total: 0,
      ignored: 0,
      status: `Sincronizando Clientes ERP... (Início: ${currentCargaNumero}/${currentCargaSequencia}, Pessoa: ${currentPessoaId})`
    });

    let allErpCustomers: any[] = [];
    let hasMore = true;
    let totalIterations = 0;
    let totalIgnored = 0;
    let lastDebugXml = '';

    try {
      let lastProgressUpdate = Date.now();

      while (hasMore && totalIterations < 50000) {
        if (Date.now() - lastProgressUpdate > 800) {
          setSyncProgress(prev => ({
            ...prev!,
            current: totalIterations,
            total: allErpCustomers.length,
            ignored: totalIgnored,
            status: `Sincronizando Clientes ERP... (Lote ${Math.floor(totalIterations / 4) + 1})`
          }));
          lastProgressUpdate = Date.now();
        }

        let retryCount = 0;
        const maxRetries = 3;
        let response: Response | null = null;

        while (retryCount < maxRetries) {
          try {
            response = await fetch('/api/bluefocus/sync-customers', {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({
                ...activeConfig,
                tipo: tipoCliente,
                tipoCliente,
                tipoAtualizacao,
                startCargaNumero: currentCargaNumero,
                startCargaSequencia: currentCargaSequencia,
                startPessoaId: currentPessoaId,
                batchSize: Number(activeConfig.batchSize) || 4
              })
            });
            if (response.ok) break;

            let serverErrMsg = `Erro no servidor (Status ${response.status})`;
            try {
              const text = await response.text();
              const errPayload = JSON.parse(text);
              if (errPayload?.error) serverErrMsg = errPayload.error;
            } catch (_) {}
            throw new Error(serverErrMsg);
          } catch (e: any) {
            retryCount++;
            if (retryCount >= maxRetries) throw e;
            await new Promise(r => setTimeout(r, 2000));
          }
        }

        if (!response) throw new Error('Falha na comunicação com o servidor ao sincronizar clientes.');
        const data = await response.json();
        if (!response.ok) {
          const err: any = new Error(data.error || 'Erro na API de Clientes BlueFocus');
          err.debugXml = data.debugXml;
          throw err;
        }

        const batchCustomers = data.customers || [];
        const batchIgnored = data.ignoredCount || 0;

        allErpCustomers = [...allErpCustomers, ...batchCustomers];
        currentCargaNumero = data.nextCargaNumero ?? currentCargaNumero;
        currentCargaSequencia = data.nextCargaSequencia ?? currentCargaSequencia;
        currentPessoaId = data.nextPessoaId ? parseInt(String(data.nextPessoaId), 10) : currentPessoaId;
        hasMore = data.snFim === 'N';
        totalIterations += data.iterations || 1;
        totalIgnored += batchIgnored;
        lastDebugXml = data.debugXml || lastDebugXml;

        setSyncProgress(prev => ({
          ...prev!,
          current: totalIterations,
          total: allErpCustomers.length,
          ignored: totalIgnored,
          lastProcessedName: data.lastProcessedName,
          lastProductName: data.lastCustomerName,
          lastProductId: data.lastCustomerId
        }));

        await new Promise(resolve => setTimeout(resolve, 800));
        if (!hasMore) break;
      }

      const uniqueMap = new Map<string, any>();
      allErpCustomers.forEach(c => {
        const key = String(c.externalId || c.cpf || c.phone || c.id || Math.random());
        uniqueMap.set(key, c);
      });
      const deduplicatedCustomers = Array.from(uniqueMap.values());

      if (deduplicatedCustomers.length === 0) {
        const isIncremental = tipoAtualizacao === 'A';
        addSyncLog({
          type: isIncremental ? 'Sincronização Clientes Incremental (BlueFocus)' : 'Carga Total Clientes (BlueFocus)',
          status: 'warning',
          productsUpdated: 0,
          productsCreated: 0,
          categoriesCreated: 0,
          ignoredCount: totalIgnored,
          totalRead: totalIterations,
          details: isIncremental
            ? `Nenhuma nova alteração de clientes no ERP desde o marcador ${currentCargaNumero}/${currentCargaSequencia}.`
            : 'Nenhum cliente retornado em modo Carga Total.',
          user: currentUser?.name || 'Sistema'
        });

        if (!isAutoSync) {
          if (isIncremental) {
            setConfirmModal({
              isOpen: true,
              title: 'Sincronização de Clientes ERP',
              message: `Sincronização concluída.\n\nNão foram encontradas novas alterações de clientes no ERP desde a última carga (${currentCargaNumero}/${currentCargaSequencia}).\n\nSe desejar recarregar todos os clientes do zero, clique em "Zerar e Importar Tudo".`,
              confirmText: 'Zerar e Importar Tudo (Carga Total)',
              cancelText: 'Fechar',
              onConfirm: () => {
                setConfirmModal(null);
                localStorage.setItem('bluefocus_cliente_carga_numero', '0');
                localStorage.setItem('bluefocus_cliente_carga_sequencia', '0');
                localStorage.setItem('bluefocus_start_pessoa_id', '0');
                localStorage.setItem('bluefocus_tipo_atualizacao_cliente', 'C');
                handleSyncCustomersBlueFocus({
                  cargaNumero: 0,
                  cargaSequencia: 0,
                  startPessoaId: 0,
                  tipoAtualizacao: 'C'
                });
              }
            });
          } else {
            setConfirmModal({
              isOpen: true,
              title: 'Carga Total de Clientes BlueFocus',
              message: 'Nenhum registro de cliente foi retornado pelo ERP BlueFocus.\n\nVerifique se há clientes exportáveis para o SAT/PDV configurado.',
              onConfirm: () => setConfirmModal(null),
              debugXml: lastDebugXml
            });
          }
        }
        return;
      }

      let totalCreated = 0;
      let totalUpdated = 0;

      for (let i = 0; i < deduplicatedCustomers.length; i += 50) {
        const chunk = deduplicatedCustomers.slice(i, i + 50);
        setSyncProgress(prev => ({
          ...prev!,
          status: `Salvando Clientes no PostgreSQL... (${Math.min(i + chunk.length, deduplicatedCustomers.length)}/${deduplicatedCustomers.length})`
        }));
        const batchRes = await fetch('/api/db/customers/batch', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(chunk)
        });
        if (batchRes.ok) {
          const batchStats = await batchRes.json();
          totalCreated += Number(batchStats.created || 0);
          totalUpdated += Number(batchStats.updated || 0);
        }
      }

      await fetchCustomers();

      localStorage.setItem('bluefocus_cliente_carga_numero', String(currentCargaNumero));
      localStorage.setItem('bluefocus_cliente_carga_sequencia', String(currentCargaSequencia));
      localStorage.setItem('bluefocus_start_pessoa_id', String(currentPessoaId));
      localStorage.setItem('bluefocus_tipo_atualizacao_cliente', 'A');

      addSyncLog({
        type: tipoAtualizacao === 'C' ? 'Carga Total Clientes (BlueFocus)' : 'Sincronização Clientes (BlueFocus)',
        status: 'success',
        productsUpdated: totalUpdated,
        productsCreated: totalCreated,
        categoriesCreated: 0,
        ignoredCount: totalIgnored,
        totalRead: totalIterations,
        details: `Clientes sincronizados com sucesso! Lotes lidos: ${totalIterations} | Clientes válidos: ${deduplicatedCustomers.length} | Novos: ${totalCreated} | Atualizados: ${totalUpdated} | Marcador final: ${currentCargaNumero}/${currentCargaSequencia}`,
        user: currentUser?.name || 'Sistema'
      });

      if (!isAutoSync) {
        setConfirmModal({
          isOpen: true,
          title: 'Sincronização de Clientes Concluída',
          message: `Sincronização de clientes finalizada com sucesso!\n\n🔹 Estatísticas:\nLotes lidos no ERP: ${totalIterations}\nClientes válidos encontrados: ${deduplicatedCustomers.length}\nRegistros ignorados (inativos): ${totalIgnored}\n\n🏠 Mudanças no Banco PostgreSQL:\nClientes novos: ${totalCreated}\nClientes atualizados: ${totalUpdated}\n\nMarcador atualizado para: ${currentCargaNumero}/${currentCargaSequencia}`,
          onConfirm: () => setConfirmModal(null),
          debugXml: lastDebugXml
        });
      }
    } catch (error: any) {
      console.error('Customer Sync Error:', error);
      const detailedError = error.message || 'Ocorreu um erro ao tentar sincronizar os clientes.';

      addSyncLog({
        type: 'Sincronização Clientes (BlueFocus)',
        status: 'error',
        productsUpdated: 0,
        productsCreated: 0,
        categoriesCreated: 0,
        ignoredCount: 0,
        totalRead: 0,
        details: detailedError,
        user: currentUser?.name || 'Sistema'
      });

      if (!isAutoSync) {
        setConfirmModal({
          isOpen: true,
          title: 'Erro na Sincronização de Clientes',
          message: detailedError,
          onConfirm: () => setConfirmModal(null),
          debugXml: lastDebugXml || error.debugXml
        });
      }
    } finally {
      setIsSyncing(false);
      setSyncProgress(null);
    }
  };

  const handleRestorePreSync = async () => {
    setConfirmModal({
      isOpen: true,
      title: 'Restaurar Pré-Sincronização',
      message: 'Deseja restaurar as categorias, visibilidade e configurações para o estado exato de antes da última sincronização?',
      confirmText: 'Restaurar',
      onConfirm: async () => {
        try {
          const res = await fetch('/api/db/restore-pre-sync', { method: 'POST' });
          const data = await res.json();
          if (res.ok && data.success) {
            await fetchData();
            setConfirmModal({
              isOpen: true,
              title: 'Snapshot Restaurado!',
              message: `O sistema foi restaurado com sucesso para o estado anterior à sincronização!\n\n• Categorias: ${data.categoriesCount}\n• Produtos: ${data.productsCount}`,
              cancelText: null,
              onConfirm: () => setConfirmModal(null)
            });
          } else {
            showInfoModal('Aviso', data.error || 'Nenhum snapshot pré-sincronização encontrado.');
          }
        } catch (e: any) {
          showInfoModal('Erro', 'Erro ao restaurar snapshot: ' + (e?.message || e));
        }
      }
    });
  };

  const handleTestBlueFocus = async () => {
    if (isTestingBlueFocus) return;
    setIsTestingBlueFocus(true);
    try {
      const response = await fetch('/api/bluefocus/sync-products', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(blueFocusConfig)
      });
      
      const contentType = response.headers.get("content-type");
      if (!contentType || !contentType.includes("application/json")) {
        const text = await response.text();
        throw new Error(`Resposta inválida do servidor (Status ${response.status}). Certifique-se de que o servidor está rodando. Detalhes: ${text.substring(0, 100)}...`);
      }

      const data = await response.json();
      
      if (response.ok) {
        setConfirmModal({
          isOpen: true,
          title: 'Conexão OK',
          message: 'Conexão estabelecida com sucesso! O sistema BlueFocus respondeu corretamente.',
          onConfirm: () => setConfirmModal(null)
        });
      } else {
        throw new Error(data.error || 'Erro na resposta do servidor');
      }
    } catch (error: any) {
      setConfirmModal({
        isOpen: true,
        title: 'Erro de Conexão',
        message: `Falha ao conectar: ${error.message}`,
        onConfirm: () => setConfirmModal(null),
        debugXml: error.debugXml
      });
    } finally {
      setIsTestingBlueFocus(false);
    }
  };

  const handleExportOrder = async (order: Order, forceReexport = false) => {
    if (exportingOrderId) return;

    if (order.blueFocusExported && !forceReexport) {
      const exportedDateStr = order.blueFocusExportedAt
        ? new Date(order.blueFocusExportedAt).toLocaleString('pt-BR')
        : '';
      setConfirmModal({
        isOpen: true,
        title: 'Pedido já exportado para o BlueFocus',
        message: `O pedido #${String(order.id).slice(-4)} já foi enviado para o BlueFocus${exportedDateStr ? ` em ${exportedDateStr}` : ''}.\n\nDeseja realmente reenviar este pedido? (Reenviar pode gerar duplicidade no ERP se a venda anterior não tiver sido cancelada).`,
        confirmText: 'Sim, Reenviar',
        cancelText: 'Cancelar',
        onConfirm: async () => {
          setConfirmModal(null);
          await handleExportOrder(order, true);
        }
      });
      return;
    }

    setExportingOrderId(order.id);
    try {
      const res = await exportOrderToBlueFocus(order, { ...blueFocusConfig, forceReexport });
      setConfirmModal({
        isOpen: true,
        title: 'Exportado para o BlueFocus',
        message: `Pedido #${String(order.id).slice(-4)} exportado com sucesso como Pré-Venda para o BlueFocus!${res?.saleNumber ? `\nNúmero da Venda FCX: ${res.saleNumber}` : ''}`,
        confirmText: 'OK',
        cancelText: null,
        onConfirm: () => setConfirmModal(null)
      });
    } catch (error: any) {
      console.error('Export Error:', error);
      setConfirmModal({
        isOpen: true,
        title: 'Erro na Exportação BlueFocus',
        message: error.message || 'Não foi possível exportar o pedido para o sistema local.',
        confirmText: 'OK',
        cancelText: null,
        onConfirm: () => setConfirmModal(null)
      });
    } finally {
      setExportingOrderId(null);
    }
  };
  const startAlarm = () => {
    if (!isSoundEnabled) return;
    if (!intervalRef.current) {
      playBeep();
      intervalRef.current = window.setInterval(() => {
        playBeep();
      }, 3000);
    }
  };

  const stopAlarm = () => {
    if (intervalRef.current) {
      clearInterval(intervalRef.current);
      intervalRef.current = null;
    }
    if (audioRef.current) {
      audioRef.current.pause();
      audioRef.current.currentTime = 0;
    }
  };

  const handleToggleSound = (forcedState?: boolean) => {
    const newState = typeof forcedState === 'boolean' ? forcedState : !isSoundEnabled;
    setIsSoundEnabled(newState);
    safeStorage.setItem('balbec_sound_enabled', String(newState));
    if (typeof localStorage !== 'undefined') {
      localStorage.setItem('balbec_sound_enabled', String(newState));
    }
    if (newState) {
      if (audioRef.current) {
        audioRef.current.currentTime = 0;
        audioRef.current.play().catch(e => console.log('Audio play unlock:', e));
      }
    } else {
      stopAlarm();
    }
  };

  useEffect(() => {
    const handleInteraction = () => {
      if (audioRef.current) {
        // Silent play to unlock audio context in browsers
        audioRef.current.play().then(() => {
          audioRef.current?.pause();
          if (audioRef.current) audioRef.current.currentTime = 0;
        }).catch(() => {});
      }
      document.removeEventListener('click', handleInteraction);
      document.removeEventListener('keydown', handleInteraction);
    };
    document.addEventListener('click', handleInteraction);
    document.addEventListener('keydown', handleInteraction);
    return () => {
      document.removeEventListener('click', handleInteraction);
      document.removeEventListener('keydown', handleInteraction);
    };
  }, []);

  useEffect(() => {
    // Check custom session from PostgreSQL
    const savedUser = localStorage.getItem('balbec_admin_session');
    if (savedUser) {
      try {
        const userData = JSON.parse(savedUser);
        setIsAuthenticated(true);
        setCurrentUser(userData);
        return;
      } catch (e) {
        localStorage.removeItem('balbec_admin_session');
      }
    }

    // Check Firebase auth state for compatibility during transition
    const unsubscribe = auth.onAuthStateChanged(async (user) => {
      if (!user) {
        // Only reset if not authenticated via custom session
        if (!localStorage.getItem('balbec_admin_session')) {
          setIsAuthenticated(false);
          setCurrentUser(null);
        }
        return;
      }

      const emailClean = (user.email || '').trim().toLowerCase();
      const isMasterEmail = emailClean === 'camillasites@gmail.com' || emailClean === 'admin@balbec.com.br';
      const isAuthorizedAdmin = isAuthorizedAdminEmail(user.email);

      let activeUser = users.find(u => (u.email || '').trim().toLowerCase() === emailClean);
      
      if (!activeUser && !isAuthorizedAdmin) {
        // If not in local state, check database
        try {
          const res = await fetch('/api/db/users');
          if (res.ok) {
            const allUsers: User[] = await res.json();
            activeUser = allUsers.find(u => (u.email || '').trim().toLowerCase() === emailClean);
          }
        } catch (e) {
          console.error('Error checking user in DB:', e);
        }
      }

      if (activeUser || isAuthorizedAdmin) {
        setIsAuthenticated(true);
        const defaultRole = isMasterEmail ? 'master' : isAuthorizedAdmin ? 'admin' : 'padrao';
        const currentUserObj: User = activeUser || {
          id: user.uid || 'default-admin',
          uid: user.uid,
          name: user.displayName || (user.email ? user.email.split('@')[0] : 'Admin'),
          email: user.email || '',
          role: defaultRole
        };
        setCurrentUser(currentUserObj);
        localStorage.setItem('balbec_admin_session', JSON.stringify(currentUserObj));
      } else {
        setIsAuthenticated(false);
        setCurrentUser(null);
        auth.signOut();
      }
    });

    return unsubscribe;
  }, [users, addUser]);

  // Fila de impressão para pedidos recebidos enquanto a janela do navegador estava minimizada/oculta
  const unprintedQueue = useRef<Order[]>([]);
  const isFlushingQueue = useRef<boolean>(false);

  const flushUnprintedQueue = useCallback(async () => {
    if (isFlushingQueue.current || unprintedQueue.current.length === 0) return;

    isFlushingQueue.current = true;
    try {
      const queueToPrint = [...unprintedQueue.current];
      unprintedQueue.current = [];

      for (const newOrder of queueToPrint) {
        if (!autoPrintedOrderIds.current.has(newOrder.id)) {
          autoPrintedOrderIds.current.add(newOrder.id);
          try {
            console.log(`[Caixa Auto-Print Queue] Imprimindo pedido acumulado da fila #${newOrder.id} (Canal: ${newOrder.type || 'loja'})...`);
            const printResult = await printReceipt(newOrder, storeInfo, true);
            if (printResult && printResult !== 'kiosk-silent-skip') {
              markOrderPrinted(newOrder.id).catch(() => {});
            }
            await new Promise(res => setTimeout(res, 400));
          } catch (err) {
            console.error('[Caixa Auto-Print Queue] Erro ao imprimir da fila:', err);
          }
        }
      }
    } finally {
      isFlushingQueue.current = false;
    }
  }, [storeInfo, markOrderPrinted]);

  useEffect(() => {
    const handleVis = () => {
      flushUnprintedQueue();
    };
    const handleFocus = () => {
      flushUnprintedQueue();
    };

    document.addEventListener('visibilitychange', handleVis);
    window.addEventListener('focus', handleFocus);

    const interval = setInterval(() => {
      if (unprintedQueue.current.length > 0) {
        flushUnprintedQueue();
      }
    }, 1500);

    // Web Worker dedicado para garantir disparo contínuo mesmo com Chrome minimizado/oculto
    let printQueueWorker: Worker | null = null;
    try {
      const blob = new Blob([
        `setInterval(function() { postMessage('queue_tick'); }, 1500);`
      ], { type: 'application/javascript' });
      printQueueWorker = new Worker(URL.createObjectURL(blob));
      printQueueWorker.onmessage = () => {
        if (unprintedQueue.current.length > 0) {
          flushUnprintedQueue();
        }
      };
    } catch {}

    return () => {
      document.removeEventListener('visibilitychange', handleVis);
      window.removeEventListener('focus', handleFocus);
      clearInterval(interval);
      printQueueWorker?.terminate();
    };
  }, [flushUnprintedQueue]);

  useEffect(() => {
    if (orders.length === 0) return;

    // Se for a primeira inicialização da tela, registra os pedidos existentes para não disparar impressão de pedidos antigos
    if (isInitialOrderLoad.current) {
      isInitialOrderLoad.current = false;
      orders.forEach(o => allKnownOrderIds.current.add(o.id));
      prevPendingIds.current = orders.filter(o => o.status === 'pending').map(o => o.id);
      return;
    }

    // Identifica novos pedidos recém-chegados (qualquer status, inclusive 'completed' de totem ou smartphone)
    const brandNewOrders = orders.filter(o => !allKnownOrderIds.current.has(o.id));
    brandNewOrders.forEach(o => allKnownOrderIds.current.add(o.id));

    // Alarme sonoro para pedidos pendentes que não sejam do totem
    const currentPendingOrders = orders.filter(o => o.status === 'pending');
    const currentPendingIds = currentPendingOrders.map(o => o.id);
    const newPendingOrders = currentPendingOrders.filter(o => !prevPendingIds.current.includes(o.id));
    const hasNonKioskNewOrders = newPendingOrders.some(o => o.type !== 'kiosk');
    
    if (hasNonKioskNewOrders && isSoundEnabled) {
      startAlarm();
    } else if (currentPendingOrders.length === 0) {
      stopAlarm();
    }
    prevPendingIds.current = currentPendingIds;

    // Auto-impressão no Caixa: imprime pedidos assim que chegam (exceto congelados 50% aguardando confirmação de pagamento).
    const isCaixaAutoPrintEnabled = storeInfo?.autoPrintOrdersOnCaixa !== false;
    if (isCaixaAutoPrintEnabled && brandNewOrders.length > 0) {
      brandNewOrders.forEach(async (newOrder) => {
        if (requiresOperatorPaymentConfirmation(newOrder)) {
          // Pedido 50% de congelados fica aguardando confirmação com senha antes de ir para produção/impressão
          allKnownOrderIds.current.delete(newOrder.id);
          return;
        }
        if (!autoPrintedOrderIds.current.has(newOrder.id)) {
          // Dispara a impressão automática no Caixa imediatamente para os novos pedidos
          autoPrintedOrderIds.current.add(newOrder.id);
          try {
            console.log(`[Caixa Auto-Print] Disparando impressão automática no Caixa para pedido #${newOrder.id} (Canal: ${newOrder.type || 'loja'})...`);
            const printResult = await printReceipt(newOrder, storeInfo, true);
            if (printResult && printResult !== 'kiosk-silent-skip') {
              markOrderPrinted(newOrder.id).catch(() => {});
            }
          } catch (err) {
            console.error('[Caixa Auto-Print] Erro ao auto-imprimir pedido no Caixa:', err);
            // Se falhou, adiciona à fila de garantia para tentar novamente
            if (!unprintedQueue.current.some(o => o.id === newOrder.id)) {
              unprintedQueue.current.push(newOrder);
            }
          }
        }
      });
    }
  }, [orders, isSoundEnabled, storeInfo, markOrderPrinted]);

  // Auto-atualização: Apenas pedidos recém-chegados ('pending') do Totem e Consumo na Loja (Mesa) são auto-concluídos.
  // Nunca sobrescreve pedidos que o administrador já moveu manualmente para 'preparing' ou 'ready'.
  const processedOrderIds = useRef<Set<string>>(new Set());
  useEffect(() => {
    const uncompletedPresential = orders.filter(
      o => o.status === 'pending' && 
           !processedOrderIds.current.has(o.id) && 
           (o.type === 'kiosk' || o.type === 'dine_in' || o.deliveryType === 'dine_in' || Boolean(o.tableNumber))
    );
    if (uncompletedPresential.length > 0) {
      uncompletedPresential.forEach(async (ord) => {
        processedOrderIds.current.add(ord.id);
        try {
          await updateOrderStatus(ord.id, 'completed');
        } catch (e) {
          console.warn(`[Auto-Entregue] Falha ao marcar pedido #${ord.id} como entregue:`, e);
          processedOrderIds.current.delete(ord.id);
        }
      });
    }
  }, [orders, updateOrderStatus]);

  useEffect(() => {
    return () => {
      stopAlarm();
      if (audioRef.current) {
        audioRef.current.pause();
        audioRef.current = null;
      }
    };
  }, []);

  const handleDeleteCategory = (id: string) => {
    setConfirmModal({
      isOpen: true,
      title: 'Excluir Categoria',
      message: 'Tem certeza que deseja excluir esta categoria? Todos os produtos nela também serão excluídos.',
      onConfirm: async () => {
        try {
          await deleteCategory(id);
          setConfirmModal(null);
        } catch (error) {
          console.error('Error deleting category:', error);
          showInfoModal('Erro', 'Erro ao excluir categoria.');
        }
      }
    });
  };

  const handleDeleteProduct = (id: string) => {
    setConfirmModal({
      isOpen: true,
      title: 'Excluir Produto',
      message: 'Tem certeza que deseja excluir este produto?',
      onConfirm: async () => {
        try {
          await deleteProduct(id);
          setConfirmModal(null);
        } catch (error) {
          console.error('Error deleting product:', error);
          showInfoModal('Erro', 'Erro ao excluir produto.');
        }
      }
    });
  };

  const handleDeleteUser = (id: string | number) => {
    setConfirmModal({
      isOpen: true,
      title: 'Excluir Usuário',
      message: 'Tem certeza que deseja excluir este usuário?',
      onConfirm: async () => {
        try {
          await deleteUser(id);
          setConfirmModal(null);
        } catch (error) {
          console.error('Error deleting user:', error);
          showInfoModal('Erro', 'Erro ao excluir usuário.');
        }
      }
    });
  };

  const handleSaveUser = async (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    if (isSaving) return;

    const formData = new FormData(e.currentTarget);
    const data: any = {
      name: formData.get('name') as string,
      email: (formData.get('email') as string || '').trim().toLowerCase(),
      role: (formData.get('role') as string) || 'padrao',
    };
    const password = formData.get('password') as string;
    if (password) {
      data.password = password;
    }

    setIsSaving(true);
    try {
      if (editingItem) {
        await updateUser(editingItem.id, data);
        setConfirmModal({
          isOpen: true,
          title: 'Sucesso',
          message: 'Usuário atualizado com sucesso!',
          onConfirm: () => setConfirmModal(null)
        });
      } else {
        if (!password) {
          throw new Error('A senha é obrigatória para novos usuários.');
        }
        await addUser(data);
        setConfirmModal({
          isOpen: true,
          title: 'Sucesso',
          message: 'Usuário cadastrado com sucesso!',
          onConfirm: () => setConfirmModal(null)
        });
      }
      closeModal();
    } catch (error: any) {
      console.error('Error saving user:', error);
      setConfirmModal({
        isOpen: true,
        title: 'Erro',
        message: error.message || 'Erro ao salvar usuário. Verifique os dados e sua conexão.',
        onConfirm: () => setConfirmModal(null)
      });
    } finally {
      setIsSaving(false);
    }
  };

  const openModal = (type: 'category' | 'product' | 'user', item?: any) => {
    setModalType(type);
    setEditingItem(item || null);
    if (type === 'product') {
      setProductImagePreview(item?.imageUrl || '');
      setSelectedCategoryId(item?.categoryId || '');
      setSelectedFrozenCategoryId(item?.frozenCategoryId || '');
      setIsFlavorInModal(item?.isFlavor || false);
    } else if (type === 'category') {
      setCategorySaleMode(item?.saleMode || 'pack');
    }
    setIsModalOpen(true);
  };

  const closeModal = () => {
    setIsModalOpen(false);
    setModalType(null);
    setEditingItem(null);
    setProductImagePreview('');
    setSelectedCategoryId('');
    setSelectedFrozenCategoryId('');
    setIsFlavorInModal(false);
  };

  const handleSaveCategory = async (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    if (isSaving) return;
    const formData = new FormData(e.currentTarget);
    const catName = (formData.get('name') as string || '').trim();
    const rawModality = formData.get('modality') as string;
    const finalModality = catName.toLowerCase().includes('congelad')
      ? 'congelado'
      : (rawModality === 'congelado' || rawModality === 'pronto' ? rawModality : 'pronto');
    const saleMode = ((formData.get('saleMode') as string) || 'pack') as 'pack' | 'unit';
    const defaultPackSize = Number(formData.get('defaultPackSize')) || 1;
    const store = formData.get('availableInStore') === 'on';
    const kiosk = formData.get('availableForKiosk') === 'on';
    const isVisibleChecked = formData.get('isVisible') === 'on';

    const data = {
      name: catName,
      order: Number(formData.get('order')),
      modality: finalModality,
      saleMode,
      defaultPackSize,
      availableForDelivery: false,
      availableInStore: store,
      availableForKiosk: kiosk,
      isVisible: isVisibleChecked,
    };

    setIsSaving(true);
    try {
      if (editingItem) {
        await updateCategory(editingItem.id, data);
      } else {
        await addCategory(data);
      }
      closeModal();
    } catch (error) {
      console.error('Error saving category:', error);
      setConfirmModal({
        isOpen: true,
        title: 'Erro',
        message: 'Erro ao salvar categoria. Verifique sua conexão.',
        onConfirm: () => setConfirmModal(null)
      });
    } finally {
      setIsSaving(false);
    }
  };

  const handleSaveProduct = async (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    if (isSaving) return;
    const formData = new FormData(e.currentTarget);
    const externalIdInput = (formData.get('externalId') as string || '').trim();
    const rawFrozenCat = (formData.get('frozenCategoryId') as string || '').trim();
    const finalFrozenCat = rawFrozenCat === 'none' ? '' : rawFrozenCat;
    const data = {
      categoryId: (formData.get('categoryId') as string) || 'none',
      frozenCategoryId: finalFrozenCat || null,
      name: formData.get('name') as string,
      externalId: externalIdInput || editingItem?.externalId || undefined,
      description: cleanProductDescription(formData.get('description') as string, true),
      price: formData.get('isFlavor') === 'on' ? 0 : Number(formData.get('price')),
      imageUrl: productImagePreview,
      isActive: formData.get('isActive') === 'on',
      isAddon: formData.get('isAddon') === 'on',
      isFlavor: formData.get('isFlavor') === 'on',
      addonIds: formData.getAll('addonIds') as string[],
      flavorIds: formData.getAll('flavorIds') as string[],
      maxAddons: Number(formData.get('maxAddons')) || 2,
      order: Number(formData.get('order') || 0),
      allowFrozen: finalFrozenCat ? true : (formData.get('allowFrozen') === 'on'),
      minFrozenQuantity: Number(formData.get('minFrozenQuantity')) || 1,
      availableForDelivery: false,
      availableInStore: formData.get('availableInStore') === 'on',
      availableForKiosk: formData.get('availableForKiosk') === 'on',
    };

    // Ensure they are mutually exclusive
    if (data.isAddon) data.isFlavor = false;
    if (data.isFlavor) data.isAddon = false;

    setIsSaving(true);
    try {
      if (editingItem?.id) {
        await updateProduct(editingItem.id, data);
        addSyncLog({
          type: 'Edição Manual de Produto',
          status: 'success',
          productsUpdated: 1,
          productsCreated: 0,
          categoriesCreated: 0,
          ignoredCount: 0,
          totalRead: 1,
          details: `Produto "${data.name}" alterado manualmente (R$ ${data.price.toFixed(2)}).`,
          user: currentUser?.name || 'Administrador'
        });
      } else {
        await addProduct(data);
        addSyncLog({
          type: 'Criação Manual de Produto',
          status: 'success',
          productsUpdated: 0,
          productsCreated: 1,
          categoriesCreated: 0,
          ignoredCount: 0,
          totalRead: 1,
          details: `Novo produto "${data.name}" criado manualmente (R$ ${data.price.toFixed(2)}).`,
          user: currentUser?.name || 'Administrador'
        });
      }

      if (data.isActive) {
        const assignedCatIds = [data.categoryId, data.frozenCategoryId].filter(cid => cid && cid !== 'none') as string[];
        for (const cid of assignedCatIds) {
          const targetCat = categories.find(c => c.id === cid);
          if (targetCat && !targetCat.externalId && targetCat.isVisible === false) {
            await updateCategory(targetCat.id, { isVisible: true });
          }
        }
      }

      closeModal();
    } catch (error) {
      console.error('Error saving product:', error);
      setConfirmModal({
        isOpen: true,
        title: 'Erro',
        message: 'Erro ao salvar produto. Verifique se a imagem não é muito grande (limite de ~1MB). Detalhes: ' + (error as Error).message,
        onConfirm: () => setConfirmModal(null)
      });
    } finally {
      setIsSaving(false);
    }
  };

  const handleImageUpload = (e: React.ChangeEvent<HTMLInputElement>, setPreview: (val: string) => void) => {
    const file = e.target.files?.[0];
    if (!file) return;

    // For SVG files or small images (< 400KB), read directly to maintain crisp vector/alpha transparency
    if (file.type === 'image/svg+xml' || file.name.toLowerCase().endsWith('.svg') || file.size < 400 * 1024) {
      const reader = new FileReader();
      reader.onload = (event) => {
        const result = event.target?.result as string;
        if (result) setPreview(result);
      };
      reader.readAsDataURL(file);
      return;
    }

    // For larger images, resize via Canvas to keep it under 600px without losing quality
    const reader = new FileReader();
    reader.onload = (event) => {
      const img = new Image();
      img.onload = () => {
        try {
          const canvas = document.createElement('canvas');
          const MAX_WIDTH = 600;
          const MAX_HEIGHT = 600;
          let width = img.width || 500;
          let height = img.height || 500;

          if (width > height) {
            if (width > MAX_WIDTH) {
              height = Math.round(height * (MAX_WIDTH / width));
              width = MAX_WIDTH;
            }
          } else {
            if (height > MAX_HEIGHT) {
              width = Math.round(width * (MAX_HEIGHT / height));
              height = MAX_HEIGHT;
            }
          }

          canvas.width = width;
          canvas.height = height;
          const ctx = canvas.getContext('2d');
          if (ctx) {
            ctx.clearRect(0, 0, width, height);
            ctx.drawImage(img, 0, 0, width, height);
            // Use PNG to preserve transparency
            const dataUrl = canvas.toDataURL('image/png');
            setPreview(dataUrl);
          } else {
            setPreview(event.target?.result as string);
          }
        } catch (err) {
          console.warn('Canvas resize fallback:', err);
          setPreview(event.target?.result as string);
        }
      };
      img.onerror = () => {
        setPreview(event.target?.result as string);
      };
      img.src = event.target?.result as string;
    };
    reader.readAsDataURL(file);
  };

  const handleDirectSaveLogo = async () => {
    setIsSavingLogo(true);
    try {
      if (logoPreview && logoPreview !== '/logo.svg') {
        localStorage.setItem('balbec_custom_logo_url', logoPreview);
      }
      await updateStoreInfo({ logoUrl: logoPreview });
      setLogoSavedSuccess(true);
      setTimeout(() => setLogoSavedSuccess(false), 3000);
    } catch (error) {
      console.error('Error saving logo:', error);
      showInfoModal('Erro', 'Erro ao salvar a logomarca. Tente novamente.');
    } finally {
      setIsSavingLogo(false);
    }
  };

  const handleSaveSettings = async (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    const formData = new FormData(e.currentTarget);
    
    const effectiveLogo = (logoPreview && logoPreview !== '/logo.svg')
      ? logoPreview
      : (storeInfo.logoUrl && storeInfo.logoUrl !== '/logo.svg')
        ? storeInfo.logoUrl
        : localStorage.getItem('balbec_custom_logo_url') || logoPreview || '/logo.svg';

    if (effectiveLogo && effectiveLogo !== '/logo.svg') {
      localStorage.setItem('balbec_custom_logo_url', effectiveLogo);
    }

    const data = {
      name: (formData.get('name') as string)?.trim() || storeInfo.name || 'BALBEC - REVENDA',
      themeColor: themeColor || storeInfo.themeColor || '#ff5500',
      addButtonColor: addButtonColor || storeInfo.addButtonColor || '#ff0000',
      iconColor: iconColor || storeInfo.iconColor || '#ff5500',
      categoryTitleColor: categoryTitleColor || storeInfo.categoryTitleColor || '#1c1917',
      headerPhrase: (formData.get('headerPhrase') as string)?.trim() || storeInfo.headerPhrase || 'Salgados Especiais e Revenda',
      logoUrl: effectiveLogo,
      address: (formData.get('address') as string)?.trim() || storeInfo.address || '',
      hours: formatWeeklyScheduleSummary(weeklyScheduleState) || (formData.get('hours') as string)?.trim() || storeInfo.hours || '',
      instagram: (formData.get('instagram') as string)?.trim() || storeInfo.instagram || '',
      whatsapp: (formData.get('whatsapp') as string)?.trim() || storeInfo.whatsapp || '',
      ntfyTopic: (formData.get('ntfyTopic') as string)?.trim() || storeInfo.ntfyTopic || 'balbecrevenda_pedidos',
      ntfyEnabled: formData.get('ntfyEnabled') === 'on',
      deliveryEnabled: deliveryEnabledState,
      deliveryScheduleEnabled: deliveryScheduleEnabledState,
      deliveryScheduleSlots: JSON.stringify(deliveryScheduleSlotsState),
      scheduleIntervalMinutes: scheduleIntervalMinutesState,
      scheduleStartTime: scheduleStartTimeState,
      scheduleEndTime: scheduleEndTimeState,
      scheduleSlotCapacities: JSON.stringify(scheduleSlotCapacitiesState),
      scheduleSlotItemCapacity: scheduleSlotItemCapacityState,
      schedulePrepTimeNormalMinutes: schedulePrepTimeNormalMinutesState,
      schedulePrepTimeFrozenMinutes: schedulePrepTimeFrozenMinutesState,
      salgadoPrepFritoEnabled: salgadoPrepFritoEnabledState,
      salgadoPrepAssadoEnabled: salgadoPrepAssadoEnabledState,
      salgadoPrepFritoCongeladoEnabled: salgadoPrepFritoCongeladoEnabledState,
      salgadoPrepAssadoCongeladoEnabled: salgadoPrepAssadoCongeladoEnabledState,
      inStoreEnabled: inStoreEnabledState,
      kioskEnabled: kioskEnabledState,
      requireQrCodeForOrdering: requireQrCodeForOrderingState,
      isOpen: isOpenState,
      forceOpen: forceOpenState,
      isMaintenance: isMaintenanceState,
      maintenanceMessage: (formData.get('maintenanceMessage') as string)?.trim() || storeInfo.maintenanceMessage || 'Estamos atualizando nosso cardápio e sistemas para melhor atendê-lo. Voltaremos em breve!',
      weeklySchedule: JSON.stringify(weeklyScheduleState),
      autoOpenClose: autoOpenCloseState,
      closedMessage: closedMessageState || storeInfo.closedMessage || 'Estamos fechados no momento. Confira nossos horários de atendimento!',
      aiAgentEnabled: aiAgentEnabledState,
      aiAgentName: aiAgentNameState.trim() || storeInfo.aiAgentName || 'Balbec IA',
      aiAgentTone: aiAgentToneState || storeInfo.aiAgentTone || 'amigavel',
      aiAgentCustomPrompt: aiAgentCustomPromptState ?? storeInfo.aiAgentCustomPrompt ?? '',
      aiAgentWhatsAppPhone: aiAgentWhatsAppPhoneState.trim() || storeInfo.aiAgentWhatsAppPhone || '',
      aiAgentWhatsAppDefaultMessage: aiAgentWhatsAppDefaultMessageState.trim() || storeInfo.aiAgentWhatsAppDefaultMessage || 'Olá! Vim pelo site da Balbec e gostaria de fazer um pedido.',
      aiAgentTrainingExamples: JSON.stringify(aiAgentTrainingExamplesState),
      aiAgentKnowledgeBase: aiAgentKnowledgeBaseState ?? storeInfo.aiAgentKnowledgeBase ?? '',
      aiAgentForbiddenPhrases: aiAgentForbiddenPhrasesState ?? storeInfo.aiAgentForbiddenPhrases ?? '',
      aiAgentCreativity: Number(aiAgentCreativityState) || 0.65,
      aiAgentAntiRepeat: aiAgentAntiRepeatState,
      inStoreGpsValidation: inStoreGpsValidationState,
      inStoreLatitude: Number(inStoreLatitudeState) || -19.7478,
      inStoreLongitude: Number(inStoreLongitudeState) || -47.9392,
      inStoreMaxRadiusMeters: Number(inStoreMaxRadiusMetersState) || 150,
      inStorePinValidation: inStorePinValidationState,
      inStorePinCode: (inStorePinCodeState || '1234').trim(),
      preferredPrinterName: configuredPrintersState.find((p: any) => p.isOrderPrinter)?.name || preferredPrinterNameState.trim() || 'Elgin i9 / Térmica Padrão',
      caixaPrinterName: (caixaPrinterNameState || 'Elgin i9 (Balcão / Caixa)').trim(),
      autoPrintOrdersOnCaixa: autoPrintOrdersOnCaixaState,
      printerConnectionType: printerConnectionTypeState,
      networkPrinterIp: networkPrinterIpState.trim() || '192.168.0.90',
      networkPrinterPort: Number(networkPrinterPortState) || 9100,
      mercadoPagoEnabled: mercadoPagoEnabledState,
      mercadoPagoAccessToken: mercadoPagoAccessTokenState.trim(),
      mercadoPagoPublicKey: mercadoPagoPublicKeyState.trim(),
      mercadoPagoPixKey: mercadoPagoPixKeyState.trim() || '3433383795',
      deliveryEstimatedTimeMin: Number(deliveryEstimatedTimeMinState) || 35,
      deliveryEstimatedTimeMax: Number(deliveryEstimatedTimeMaxState) || 50,
      printerCutMode: printerCutModeState,
      printerCopies: printerCopiesState,
      configuredPrinters: JSON.stringify(configuredPrintersState),
      onlinePaymentEnabled: onlinePaymentEnabledState,
      onlinePaymentOperator: onlinePaymentOperatorState,
      onlinePaymentPublicKey: onlinePaymentPublicKeyState.trim(),
      onlinePaymentSecretKey: onlinePaymentSecretKeyState.trim(),
      // Preserve TV settings so saving general settings never resets TV configuration
      tvSelectedCategories: storeInfo.tvSelectedCategories || localStorage.getItem('balbec_tv_selected_categories') || '[]',
      tvMode: storeInfo.tvMode || 'split_menu',
      tvTickerText: storeInfo.tvTickerText || '',
      tvSoundEnabled: storeInfo.tvSoundEnabled ?? false,
      tvShowClock: storeInfo.tvShowClock ?? true,
      tvShowCaptions: storeInfo.tvShowCaptions ?? false,
      showSystemIntroButton: showSystemIntroButtonState,
      blueFocusExportConfig: serializeBlueFocusConfigForDb(blueFocusConfig, isAutoSyncEnabled),
    };
    try {
      await updateStoreInfo(data);
      setConfirmModal({
        isOpen: true,
        title: 'Sucesso',
        message: 'Configurações salvas com sucesso!',
        onConfirm: () => setConfirmModal(null)
      });
    } catch (error) {
      console.error('Error saving settings:', error);
      setConfirmModal({
        isOpen: true,
        title: 'Erro',
        message: 'Não foi possível salvar as configurações. Verifique sua conexão.',
        onConfirm: () => setConfirmModal(null)
      });
    }
  };

  const handleDirectSavePrinter = async () => {
    try {
      await updateStoreInfo({ preferredPrinterName: preferredPrinterNameState.trim() || 'Elgin i9 / Térmica Padrão' });
      setConfirmModal({
        isOpen: true,
        title: 'Impressora Padrão Salva',
        message: `Impressora padrão "${preferredPrinterNameState}" salva com sucesso!`,
        onConfirm: () => setConfirmModal(null)
      });
    } catch (err) {
      console.error(err);
    }
  };

  const handleDayScheduleChange = (dayOfWeek: number, field: keyof DaySchedule, value: any) => {
    setWeeklyScheduleState(prev => 
      prev.map(day => day.dayOfWeek === dayOfWeek ? { ...day, [field]: value } : day)
    );
  };

  const handleCopyWeekdayHours = (sourceDayOfWeek: number = 1) => {
    const sourceDay = weeklyScheduleState.find(d => d.dayOfWeek === sourceDayOfWeek);
    if (!sourceDay) return;

    setWeeklyScheduleState(prev =>
      prev.map(day => {
        // Copy to Mon-Fri (1 to 5)
        if (day.dayOfWeek >= 1 && day.dayOfWeek <= 5) {
          return {
            ...day,
            isOpen: sourceDay.isOpen,
            openTime: sourceDay.openTime,
            closeTime: sourceDay.closeTime,
            hasBreak: sourceDay.hasBreak,
            breakStart: sourceDay.breakStart,
            breakEnd: sourceDay.breakEnd,
          };
        }
        return day;
      })
    );
  };

  const handleResetScheduleHours = () => {
    setWeeklyScheduleState(DEFAULT_WEEKLY_SCHEDULE);
  };

  const handleDirectSaveSchedule = async () => {
    setIsSaving(true);
    try {
      await updateStoreInfo({
        weeklySchedule: JSON.stringify(weeklyScheduleState),
        autoOpenClose: autoOpenCloseState,
        closedMessage: closedMessageState || storeInfo.closedMessage,
        hours: formatWeeklyScheduleSummary(weeklyScheduleState) || storeInfo.hours
      });
      setConfirmModal({
        isOpen: true,
        title: 'Horários Salvos com Sucesso!',
        message: 'A escala semanal de horários foi gravada no banco de dados e sincronizada em tempo real com todos os computadores, celulares e totens.',
        onConfirm: () => setConfirmModal(null)
      });
    } catch (err) {
      console.error('Erro ao salvar horários:', err);
      setConfirmModal({
        isOpen: true,
        title: 'Erro ao Salvar',
        message: 'Não foi possível salvar os horários. Verifique sua conexão.',
        onConfirm: () => setConfirmModal(null)
      });
    } finally {
      setIsSaving(false);
    }
  };

  const playStatusChangeAudio = () => {
    try {
      const AudioContextClass = window.AudioContext || (window as any).webkitAudioContext;
      if (AudioContextClass) {
        const ctx = new AudioContextClass();
        if (ctx.state === 'suspended') ctx.resume();
        const now = ctx.currentTime;
        const osc = ctx.createOscillator();
        const gain = ctx.createGain();
        osc.type = 'sine';
        osc.frequency.setValueAtTime(587.33, now); // D5
        osc.frequency.setValueAtTime(880, now + 0.1); // A5
        gain.gain.setValueAtTime(0.35, now);
        gain.gain.exponentialRampToValueAtTime(0.001, now + 0.35);
        osc.connect(gain);
        gain.connect(ctx.destination);
        osc.start(now);
        osc.stop(now + 0.35);
      }
    } catch (e) {
      console.warn('Audio status update error:', e);
    }
  };

  const openPaymentConfirmModal = (order: Order, prefillError: string | null = null) => {
    stopAlarm();
    setPaymentConfirmModal({
      order,
      confirmerName: '',
      password: '',
      receiptUrl: null,
      showPassword: false,
      error: prefillError,
      isSubmitting: false
    });
  };

  const openPaymentAuditWithMaster = (focusOrderId: string | null = null) => {
    stopAlarm();
    const shortOrd = focusOrderId ? `#${String(focusOrderId).slice(-4).padStart(4, '0')}` : null;
    setMasterAuthModal({
      action: focusOrderId ? 'view_single_order_confirmer' : 'view_payment_audit',
      title: shortOrd
        ? `Consultar Responsável • Pedido ${shortOrd}`
        : 'Auditoria de Pagamentos Online (Master)',
      description: shortOrd
        ? `Informe a senha Master para consultar quem confirmou/liberou o pagamento online do Pedido ${shortOrd}.`
        : 'Informe a senha Master para acessar o histórico completo de quem confirmou e liberou pagamentos online.',
      orderId: focusOrderId || undefined,
      password: '',
      showPassword: false,
      error: null,
      isSubmitting: false
    });
  };

  const handleSubmitMasterAuth = async (e?: React.FormEvent) => {
    if (e) e.preventDefault();
    if (!masterAuthModal || masterAuthModal.isSubmitting) return;

    const pwd = masterAuthModal.password.trim();
    if (!pwd) {
      setMasterAuthModal(prev => prev ? { ...prev, error: 'Digite a senha Master para continuar.' } : null);
      return;
    }

    setMasterAuthModal(prev => prev ? { ...prev, isSubmitting: true, error: null } : null);

    try {
      if (masterAuthModal.action === 'delete_order' && masterAuthModal.orderId) {
        const deletedNum = String(masterAuthModal.orderId).slice(-4).padStart(4, '0');
        await deleteOrder(masterAuthModal.orderId, pwd);
        setMasterAuthModal(null);
        showInfoModal('Pedido Excluído', `O Pedido #${deletedNum} foi excluído permanentemente com autorização Master.`);
        return;
      }

      if (masterAuthModal.action === 'clear_all_orders') {
        await clearAllOrders(pwd);
        setMasterAuthModal(null);
        showInfoModal('Sucesso', 'Todos os pedidos foram zerados com sucesso com autorização Master!');
        return;
      }

      if (masterAuthModal.action === 'revert_order_status' && masterAuthModal.orderId && masterAuthModal.targetStatus) {
        const orderNum = String(masterAuthModal.orderId).slice(-4).padStart(4, '0');
        const nextLabel = getOrderStatusDisplayName(masterAuthModal.targetStatus);
        processedOrderIds.current.add(masterAuthModal.orderId);
        await updateOrderStatus(masterAuthModal.orderId, masterAuthModal.targetStatus, pwd);
        stopAlarm();
        playStatusChangeAudio();
        setMasterAuthModal(null);
        showInfoModal(
          'Status Alterado (Master)',
          `O status do Pedido #${orderNum} foi alterado para "${nextLabel}" com autorização Master.`
        );
        return;
      }

      const verifyRes = await fetch('/api/db/master/verify', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ masterPassword: pwd })
      });
      const verifyData = await verifyRes.json().catch(() => null);
      if (!verifyRes.ok || !verifyData?.success) {
        setMasterAuthModal(prev => prev ? {
          ...prev,
          isSubmitting: false,
          error: verifyData?.error || 'Senha Master incorreta! Verifique e tente novamente.'
        } : null);
        return;
      }

      const focusId = masterAuthModal.orderId || null;
      setMasterAuthModal(null);
      setPaymentAuditModal({
        isOpen: true,
        focusOrderId: focusId,
        search: ''
      });
    } catch (err: any) {
      setMasterAuthModal(prev => prev ? {
        ...prev,
        isSubmitting: false,
        error: err?.message || 'Senha Master incorreta ou erro ao executar ação.'
      } : null);
    }
  };

  const handleSubmitPaymentConfirmation = async (e?: React.FormEvent) => {
    if (e) e.preventDefault();
    if (!paymentConfirmModal || paymentConfirmModal.isSubmitting) return;

    const confirmer = paymentConfirmModal.confirmerName.trim();
    if (confirmer.length < 2) {
      setPaymentConfirmModal(prev => prev ? { ...prev, error: 'Informe o nome completo de quem está fazendo a confirmação do pagamento.' } : null);
      return;
    }

    const pwd = paymentConfirmModal.password.trim();
    if (!pwd) {
      setPaymentConfirmModal(prev => prev ? { ...prev, error: 'Digite a senha de confirmação para liberar o pagamento.' } : null);
      return;
    }

    const receiptUrl = paymentConfirmModal.receiptUrl;
    if (!receiptUrl) {
      setPaymentConfirmModal(prev => prev ? { ...prev, error: 'É obrigatório anexar o comprovante do pagamento para prosseguir.' } : null);
      return;
    }

    setPaymentConfirmModal(prev => prev ? { ...prev, isSubmitting: true, error: null } : null);
    const result = await confirmOrderPayment(paymentConfirmModal.order.id, pwd, confirmer, receiptUrl);

    if (result.success) {
      playStatusChangeAudio();
      const pbConfirmed = getOrderPaymentBreakdown(paymentConfirmModal.order);
      const isPartial50Confirmed = pbConfirmed.kind === 'partial_50';
      const confirmedOrderNum = String(paymentConfirmModal.order.id).slice(-4).padStart(4, '0');
      setPaymentConfirmModal(null);
      showInfoModal(
        isPartial50Confirmed ? 'Pagamento 50% Confirmado!' : 'Pagamento Integral Confirmado!',
        isPartial50Confirmed
          ? `O recebimento da entrada de 50% (${formatBRL(pbConfirmed.paidAmount)}) do Pedido #${confirmedOrderNum} foi validado com sucesso.\n\nResponsável registrado: ${confirmer}\nO pedido agora está liberado para ser enviado para produção!`
          : `O recebimento do pagamento integral (${formatBRL(pbConfirmed.totalAmount)}) do Pedido #${confirmedOrderNum} foi validado com sucesso.\n\nResponsável registrado: ${confirmer}\nO pedido agora está liberado para ser enviado para produção!`
      );
    } else {
      setPaymentConfirmModal(prev => prev ? {
        ...prev,
        isSubmitting: false,
        error: result.error || 'Senha incorreta! Verifique a senha e tente novamente.'
      } : null);
    }
  };

  const getOrderStatusStageRank = (status?: Order['status'] | string): number => {
    switch (String(status || '').trim()) {
      case 'pending':
        return 0;
      case 'preparing':
        return 1;
      case 'ready':
      case 'ready_for_pickup':
      case 'ready_for_delivery':
      case 'out_for_delivery':
        return 2;
      case 'completed':
        return 3;
      case 'cancelled':
        return -1;
      default:
        return 0;
    }
  };

  const getOrderStatusDisplayName = (status?: Order['status'] | string): string => {
    switch (String(status || '').trim()) {
      case 'pending':
        return 'Pendente';
      case 'preparing':
        return 'Preparando';
      case 'ready':
      case 'ready_for_pickup':
      case 'ready_for_delivery':
      case 'out_for_delivery':
        return 'Pedido Pronto';
      case 'completed':
        return 'Entregue';
      case 'cancelled':
        return 'Cancelado';
      default:
        return String(status || 'Desconhecido');
    }
  };

  const isOrderStatusRollback = (currentStatus?: Order['status'], nextStatus?: Order['status']): boolean => {
    if (!currentStatus || !nextStatus) return false;
    if (currentStatus === nextStatus) return false;
    // Reabrir um pedido já cancelado exige senha Master
    if (currentStatus === 'cancelled' && nextStatus !== 'cancelled') return true;
    // Cancelar um pedido que já está como Entregue exige senha Master
    if (currentStatus === 'completed' && nextStatus === 'cancelled') return true;
    const currentRank = getOrderStatusStageRank(currentStatus);
    const nextRank = getOrderStatusStageRank(nextStatus);
    return currentRank > 0 && nextRank >= 0 && nextRank < currentRank;
  };

  const handleUpdateOrderStatus = async (id: string, status: Order['status']) => {
    const targetOrder = orders.find(o => o.id === id) || rawOrders.find(o => o.id === id);
    if (targetOrder) {
      const normalizedCurrent =
        targetOrder.status === 'ready_for_pickup' ||
        targetOrder.status === 'ready_for_delivery' ||
        targetOrder.status === 'out_for_delivery'
          ? 'ready'
          : targetOrder.status;
      const normalizedNext =
        status === 'ready_for_pickup' ||
        status === 'ready_for_delivery' ||
        status === 'out_for_delivery'
          ? 'ready'
          : status;
      if (normalizedCurrent === normalizedNext) {
        return;
      }
    }

    if (
      targetOrder &&
      status !== 'pending' &&
      status !== 'cancelled' &&
      requiresOperatorPaymentConfirmation(targetOrder)
    ) {
      const targetPb = getOrderPaymentBreakdown(targetOrder);
      const isPartial50Target = targetPb.kind === 'partial_50';
      openPaymentConfirmModal(
        targetOrder,
        isPartial50Target
          ? 'Pagamento 50% de congelados pendente! Confirme o recebimento com a senha antes de passar o pedido para produção.'
          : 'Pagamento online integral pendente! Confirme o recebimento com a senha antes de passar o pedido para produção.'
      );
      return;
    }

    const shortId = String(id).slice(-4).padStart(4, '0');
    const currentLabel = getOrderStatusDisplayName(targetOrder?.status);
    const nextLabel = getOrderStatusDisplayName(status);
    const customerLabel = targetOrder?.customerName ? ` (${targetOrder.customerName})` : '';

    // Regra de segurança: voltar atrás no status exige senha Master
    if (targetOrder && isOrderStatusRollback(targetOrder.status, status)) {
      stopAlarm();
      setMasterAuthModal({
        action: 'revert_order_status',
        title: `Voltar Status • Pedido #${shortId}`,
        description: `Você está tentando voltar o status do Pedido #${shortId}${customerLabel} de "${currentLabel}" para "${nextLabel}".\n\nPor medida de segurança, informe a senha Master para autorizar esta reversão.`,
        orderId: id,
        currentStatus: targetOrder.status,
        targetStatus: status,
        password: '',
        showPassword: false,
        error: null,
        isSubmitting: false
      });
      return;
    }

    // Fluxo normal (avanço de status): se for alterar para ENTREGUE e houver valor a receber (integral ou parcial), perguntar se já recebeu o valor devido
    const paymentBreakdown = targetOrder ? getOrderPaymentBreakdown(targetOrder) : null;
    const hasPendingCollectionOnDelivery = Boolean(
      status === 'completed' &&
      paymentBreakdown &&
      (paymentBreakdown.kind === 'pay_on_pickup' || paymentBreakdown.kind === 'partial_50') &&
      paymentBreakdown.remainingAmount > 0
    );

    stopAlarm();
    if (hasPendingCollectionOnDelivery && paymentBreakdown) {
      const dueFormatted = formatBRL(paymentBreakdown.remainingAmount);
      const isPartial = paymentBreakdown.kind === 'partial_50';
      setConfirmModal({
        isOpen: true,
        isPaymentAlert: true,
        highlightAmount: dueFormatted,
        title: isPartial
          ? `⚠️ Recebimento Restante • Pedido #${shortId}`
          : `⚠️ Recebimento Pendente • Pedido #${shortId}`,
        message: isPartial
          ? `Este pedido teve 50% pago antecipadamente e ainda possui saldo RESTANTE de ${dueFormatted} a receber na retirada.\n\nVocê já recebeu o valor devido do cliente${customerLabel} antes de alterar o status para "Entregue"?`
          : `Este pedido possui valor INTEGRAL de ${dueFormatted} (${paymentBreakdown.methodLabel}) a receber na retirada.\n\nVocê já recebeu o valor devido do cliente${customerLabel} antes de alterar o status para "Entregue"?`,
        confirmText: 'Sim, Já Recebi e Entregar',
        cancelText: 'Não Recebi (Voltar)',
        onConfirm: async () => {
          setConfirmModal(null);
          try {
            stopAlarm();
            playStatusChangeAudio();
            await updateOrderStatus(id, status);
          } catch (error: any) {
            console.error('Error updating order status:', error);
            showInfoModal('Erro ao Atualizar Status', error?.message || 'Não foi possível salvar o novo status do pedido no servidor. Tente novamente.');
          }
        }
      });
      return;
    }

    setConfirmModal({
      isOpen: true,
      title: `Confirmar Alteração • Pedido #${shortId}`,
      message: `Deseja realmente alterar o status do Pedido #${shortId}${customerLabel} de "${currentLabel}" para "${nextLabel}"?`,
      confirmText: 'Sim, Alterar Status',
      cancelText: 'Cancelar',
      onConfirm: async () => {
        setConfirmModal(null);
        try {
          stopAlarm();
          playStatusChangeAudio();
          await updateOrderStatus(id, status);
        } catch (error: any) {
          console.error('Error updating order status:', error);
          showInfoModal('Erro ao Atualizar Status', error?.message || 'Não foi possível salvar o novo status do pedido no servidor. Tente novamente.');
        }
      }
    });
  };

  const handleCallOnTv = async (order: Order) => {
    try {
      await fetch('/api/db/tv-call-order', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          orderId: order.id,
          orderNumber: order.id.slice(-4).toUpperCase(),
          customerName: order.customerName || 'Cliente',
          type: order.type || 'balcao',
          isManual: true
        })
      });
    } catch (err) {
      console.error('Error broadcasting call to TV:', err);
    }
  };

  const handleCancelOrder = async (id: string) => {
    stopAlarm();
    const targetOrder = orders.find(o => o.id === id) || rawOrders.find(o => o.id === id);
    if (targetOrder && targetOrder.status === 'completed') {
      const shortId = String(id).slice(-4).padStart(4, '0');
      setMasterAuthModal({
        action: 'revert_order_status',
        title: `Cancelar Pedido Entregue • #${shortId}`,
        description: `O Pedido #${shortId} já está marcado como "Entregue". Por medida de segurança, informe a senha Master para alterar o status para "Cancelado".`,
        orderId: id,
        currentStatus: targetOrder.status,
        targetStatus: 'cancelled',
        password: '',
        showPassword: false,
        error: null,
        isSubmitting: false
      });
      return;
    }

    setConfirmModal({
      isOpen: true,
      title: 'Cancelar Pedido',
      message: 'Deseja realmente alterar o status deste pedido para "Cancelado"?',
      confirmText: 'Sim, Cancelar Pedido',
      cancelText: 'Voltar',
      onConfirm: async () => {
        try {
          await updateOrderStatus(id, 'cancelled');
          setConfirmModal(null);
        } catch (error) {
          console.error('Error cancelling order:', error);
          showInfoModal('Erro', 'Erro ao cancelar pedido.');
        }
      }
    });
  };

  const handleDeleteOrder = (id: string | number) => {
    if (!id) return;
    stopAlarm();
    const strId = String(id).trim();
    const shortId = strId.slice(-4).padStart(4, '0');
    console.log(`[Admin] Requesting master-authorized deletion of order: "${strId}"`);

    setMasterAuthModal({
      action: 'delete_order',
      title: `Excluir Pedido #${shortId} (Master)`,
      description: `Tem certeza que deseja excluir o Pedido #${shortId} permanentemente? Esta ação não pode ser desfeita e exige a confirmação com a senha Master.`,
      orderId: strId,
      password: '',
      showPassword: false,
      error: null,
      isSubmitting: false
    });
  };

  const printOrder = (order: Order) => {
    setSelectedOrderForReceipt(order);
    markOrderPrinted(order.id).catch(() => {});
    try {
      printReceipt(order, storeInfo);
    } catch (e) {
      console.warn('Erro ao acionar impressão direta no Windows:', e);
    }
  };

  const renderDashboard = () => {
    const completedOrders = orders.filter(o => o.status === 'completed' || o.status === 'ready' || o.status === 'out_for_delivery' || o.status === 'ready_for_delivery');
    const totalRevenue = completedOrders.reduce((sum, o) => sum + (Number(o.total) || 0), 0);
    const totalOrdersCount = completedOrders.length;
    const ticketMedio = totalOrdersCount > 0 ? totalRevenue / totalOrdersCount : 0;
    const pendingCount = orders.filter(o => o.status === 'pending').length;
    const totalProductsCount = products.filter(p => {
      const category = categories.find(c => c.id === p.categoryId);
      return !category || !isExcludedCategory(category.name);
    }).length;
    const activeProductsCount = products.filter(p => {
      const category = categories.find(c => c.id === p.categoryId);
      return p.isActive && (!category || !isExcludedCategory(category.name));
    }).length;

    const productSales: Record<string, { name: string, quantity: number, revenue: number }> = {};
    completedOrders.forEach(order => {
      const safeItems = Array.isArray(order.items) ? order.items : [];
      safeItems.forEach(item => {
        if (!item) return;
        if (!productSales[item.productId]) {
          productSales[item.productId] = { name: item.name, quantity: 0, revenue: 0 };
        }
        productSales[item.productId].quantity += Number(item.quantity) || 0;
        productSales[item.productId].revenue += ((Number(item.price) || 0) * (Number(item.quantity) || 0));
      });
    });

    const topProducts = Object.values(productSales)
      .sort((a, b) => b.quantity - a.quantity)
      .slice(0, 5);

    // Cálculos de Vendas por Dia & Calendário
    const todayStr = getTodayDateString();
    const isViewingToday = selectedDashboardDate === todayStr;

    const isOrderOnDate = (orderCreatedAt: any, dateStr: string) => {
      if (!orderCreatedAt) return false;
      const d = new Date(orderCreatedAt);
      if (isNaN(d.getTime())) return false;
      const year = d.getFullYear();
      const month = String(d.getMonth() + 1).padStart(2, '0');
      const day = String(d.getDate()).padStart(2, '0');
      return `${year}-${month}-${day}` === dateStr;
    };

    // Pedidos do dia selecionado
    const dayOrders = orders.filter(o => isOrderOnDate(o.createdAt, selectedDashboardDate));
    const dayCompletedOrders = dayOrders.filter(o => o.status === 'completed' || o.status === 'ready' || o.status === 'out_for_delivery' || o.status === 'ready_for_delivery');
    const dayRevenue = dayCompletedOrders.reduce((sum, o) => sum + (Number(o.total) || 0), 0);
    const dayOrdersCount = dayOrders.length;
    const dayCompletedCount = dayCompletedOrders.length;
    const dayTicketMedio = dayCompletedCount > 0 ? dayRevenue / dayCompletedCount : 0;
    const dayItemsSold = dayCompletedOrders.reduce((sum, o) => {
      return sum + (o.items || []).reduce((iSum, item) => iSum + (Number(item.quantity) || 0), 0);
    }, 0);

    // Métricas do dia atual (sempre disponíveis)
    const todayOrders = orders.filter(o => isOrderOnDate(o.createdAt, todayStr));
    const todayCompletedOrders = todayOrders.filter(o => o.status === 'completed' || o.status === 'ready' || o.status === 'out_for_delivery' || o.status === 'ready_for_delivery');
    const todayRevenue = todayCompletedOrders.reduce((sum, o) => sum + (Number(o.total) || 0), 0);
    const todayOrdersCount = todayOrders.length;

    // Canais de Venda do Dia Selecionado
    const dayPickupOrders = dayOrders.filter(o => o.type !== 'kiosk' && !o.tableNumber && o.type !== 'dine_in' && o.deliveryType !== 'dine_in');
    const dayPickupRevenue = dayPickupOrders.filter(o => o.status === 'completed' || o.status === 'ready').reduce((sum, o) => sum + (Number(o.total) || 0), 0);

    const dayDineInOrders = dayOrders.filter(o => o.type === 'dine_in' || o.deliveryType === 'dine_in' || o.tableNumber);
    const dayDineInRevenue = dayDineInOrders.filter(o => o.status === 'completed' || o.status === 'ready').reduce((sum, o) => sum + (Number(o.total) || 0), 0);

    const dayKioskOrders = dayOrders.filter(o => o.type === 'kiosk');
    const dayKioskRevenue = dayKioskOrders.filter(o => o.status === 'completed' || o.status === 'ready').reduce((sum, o) => sum + (Number(o.total) || 0), 0);

    // Formas de pagamento do dia
    const dayPaymentMethods: Record<string, { count: number; total: number }> = {};
    dayCompletedOrders.forEach(o => {
      const method = o.paymentMethod || 'Outro';
      if (!dayPaymentMethods[method]) {
        dayPaymentMethods[method] = { count: 0, total: 0 };
      }
      dayPaymentMethods[method].count += 1;
      dayPaymentMethods[method].total += (Number(o.total) || 0);
    });

    // Lista de 9 dias para suportar desktop (7 dias) e mobile (3 grupos de 3 dias = 9 dias)
    const recent9Days = Array.from({ length: 9 }, (_, i) => {
      const d = new Date();
      d.setDate(d.getDate() - (8 - i));
      const year = d.getFullYear();
      const month = String(d.getMonth() + 1).padStart(2, '0');
      const day = String(d.getDate()).padStart(2, '0');
      const dateKey = `${year}-${month}-${day}`;
      
      const dayRev = orders
        .filter(o => isOrderOnDate(o.createdAt, dateKey) && (o.status === 'completed' || o.status === 'ready' || o.status === 'out_for_delivery' || o.status === 'ready_for_delivery'))
        .reduce((sum, o) => sum + (Number(o.total) || 0), 0);
        
      const dayCount = orders
        .filter(o => isOrderOnDate(o.createdAt, dateKey))
        .length;

      return {
        dateKey,
        dayLabel: d.toLocaleDateString('pt-BR', { weekday: 'short' }).replace('.', '').toUpperCase(),
        dateFormatted: `${day}/${month}`,
        revenue: dayRev,
        ordersCount: dayCount,
        isToday: dateKey === todayStr,
        isSelected: dateKey === selectedDashboardDate
      };
    });

    // Últimos 7 dias mantidos para desktop
    const last7Days = recent9Days.slice(2);
    const maxRevenue7Days = Math.max(...recent9Days.map(d => d.revenue), 1);

    // Chunks de 3 em 3 dias para mobile
    const mobileChunks = [
      recent9Days.slice(0, 3), // Chunk 0: dias mais antigos (8, 7 e 6 dias atrás)
      recent9Days.slice(3, 6), // Chunk 1: meio do período (5, 4 e 3 dias atrás)
      recent9Days.slice(6, 9)  // Chunk 2: mais recentes (2 dias atrás, Ontem e Hoje)
    ];

    const isSelectedInRecent9 = recent9Days.some(d => d.dateKey === selectedDashboardDate);
    
    // Se a data selecionada for histórica e estiver fora dos 9 dias recentes, gera um trio centrado nela
    let activeMobileDays = mobileChunks[mobileDaysChunkIndex] || mobileChunks[2];
    if (!isSelectedInRecent9 && selectedDashboardDate) {
      const parts = selectedDashboardDate.split('-').map(Number);
      if (parts.length === 3) {
        activeMobileDays = [-1, 0, 1].map(offset => {
          const d = new Date(parts[0], parts[1] - 1, parts[2] + offset);
          const year = d.getFullYear();
          const month = String(d.getMonth() + 1).padStart(2, '0');
          const day = String(d.getDate()).padStart(2, '0');
          const dateKey = `${year}-${month}-${day}`;
          const dayRev = orders
            .filter(o => isOrderOnDate(o.createdAt, dateKey) && (o.status === 'completed' || o.status === 'ready'))
            .reduce((sum, o) => sum + (Number(o.total) || 0), 0);
          const dayCount = orders
            .filter(o => isOrderOnDate(o.createdAt, dateKey))
            .length;
          return {
            dateKey,
            dayLabel: d.toLocaleDateString('pt-BR', { weekday: 'short' }).replace('.', '').toUpperCase(),
            dateFormatted: `${day}/${month}`,
            revenue: dayRev,
            ordersCount: dayCount,
            isToday: dateKey === todayStr,
            isSelected: dateKey === selectedDashboardDate
          };
        });
      }
    }

    const formatDashboardDateLabel = (dateStr: string) => {
      if (!dateStr) return '';
      const parts = dateStr.split('-');
      if (parts.length !== 3) return dateStr;
      const [y, m, d] = parts.map(Number);
      const dateObj = new Date(y, m - 1, d);
      if (isNaN(dateObj.getTime())) return dateStr;
      return dateObj.toLocaleDateString('pt-BR', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' });
    };

    const handlePrevDashboardDay = () => {
      const parts = selectedDashboardDate.split('-').map(Number);
      const cur = new Date(parts[0], parts[1] - 1, parts[2]);
      cur.setDate(cur.getDate() - 1);
      const year = cur.getFullYear();
      const month = String(cur.getMonth() + 1).padStart(2, '0');
      const day = String(cur.getDate()).padStart(2, '0');
      setSelectedDashboardDate(`${year}-${month}-${day}`);
    };

    const handleNextDashboardDay = () => {
      const parts = selectedDashboardDate.split('-').map(Number);
      const cur = new Date(parts[0], parts[1] - 1, parts[2]);
      cur.setDate(cur.getDate() + 1);
      const year = cur.getFullYear();
      const month = String(cur.getMonth() + 1).padStart(2, '0');
      const day = String(cur.getDate()).padStart(2, '0');
      setSelectedDashboardDate(`${year}-${month}-${day}`);
    };

    const handleResetToToday = () => {
      setSelectedDashboardDate(todayStr);
    };

    // =========================================================================
    // CÁLCULOS DO ACUMULADO DE VENDAS DO MÊS
    // =========================================================================
    const now = new Date();
    const currentYear = now.getFullYear();
    const currentMonth = now.getMonth();
    const currentMonthKey = `${currentYear}-${String(currentMonth + 1).padStart(2, '0')}`;

    const [monthYearStr, monthNumStr] = (selectedDashboardMonth || currentMonthKey).split('-');
    const monthYear = parseInt(monthYearStr, 10) || currentYear;
    const monthIndex = (parseInt(monthNumStr, 10) || (currentMonth + 1)) - 1;

    const isViewingCurrentMonth = (selectedDashboardMonth || currentMonthKey) === currentMonthKey;

    const monthDateObj = new Date(monthYear, monthIndex, 1);
    const rawMonthName = monthDateObj.toLocaleDateString('pt-BR', { month: 'long', year: 'numeric' });
    const formattedMonthName = rawMonthName.charAt(0).toUpperCase() + rawMonthName.slice(1);

    const isOrderInMonth = (orderCreatedAt: any, targetYear: number, targetMonthIdx: number) => {
      if (!orderCreatedAt) return false;
      const d = new Date(orderCreatedAt);
      if (isNaN(d.getTime())) return false;
      return d.getFullYear() === targetYear && d.getMonth() === targetMonthIdx;
    };

    const monthOrders = orders.filter(o => isOrderInMonth(o.createdAt, monthYear, monthIndex));
    const monthCompletedOrders = monthOrders.filter(o => o.status === 'completed' || o.status === 'ready' || o.status === 'out_for_delivery' || o.status === 'ready_for_delivery');
    const monthRevenue = monthCompletedOrders.reduce((sum, o) => sum + (Number(o.total) || 0), 0);
    const monthOrdersCount = monthOrders.length;
    const monthCompletedCount = monthCompletedOrders.length;
    const monthTicketMedio = monthCompletedCount > 0 ? monthRevenue / monthCompletedCount : 0;
    const monthItemsSold = monthCompletedOrders.reduce((sum, o) => {
      return sum + (o.items || []).reduce((iSum, item) => iSum + (Number(item.quantity) || 0), 0);
    }, 0);

    const daysInMonth = new Date(monthYear, monthIndex + 1, 0).getDate();
    const elapsedDays = isViewingCurrentMonth ? Math.min(now.getDate(), daysInMonth) : daysInMonth;
    const monthDailyAverage = elapsedDays > 0 ? monthRevenue / elapsedDays : 0;
    const projectedMonthEndRevenue = monthDailyAverage * daysInMonth;
    const monthProgressPercent = Math.min(Math.round((elapsedDays / daysInMonth) * 100), 100);

    const monthPickupOrders = monthCompletedOrders.filter(o => o.type !== 'kiosk' && !o.tableNumber && o.type !== 'dine_in' && o.deliveryType !== 'dine_in');
    const monthPickupRevenue = monthPickupOrders.reduce((sum, o) => sum + (Number(o.total) || 0), 0);

    const monthDineInOrders = monthCompletedOrders.filter(o => o.type === 'dine_in' || o.deliveryType === 'dine_in' || o.tableNumber);
    const monthDineInRevenue = monthDineInOrders.reduce((sum, o) => sum + (Number(o.total) || 0), 0);

    const monthKioskOrders = monthCompletedOrders.filter(o => o.type === 'kiosk');
    const monthKioskRevenue = monthKioskOrders.reduce((sum, o) => sum + (Number(o.total) || 0), 0);

    const handlePrevDashboardMonth = () => {
      let y = monthYear;
      let m = monthIndex - 1;
      if (m < 0) {
        m = 11;
        y -= 1;
      }
      const newMonthStr = `${y}-${String(m + 1).padStart(2, '0')}`;
      handleMonthChange(newMonthStr);
    };

    const handleNextDashboardMonth = () => {
      let y = monthYear;
      let m = monthIndex + 1;
      if (m > 11) {
        m = 0;
        y += 1;
      }
      const newMonthStr = `${y}-${String(m + 1).padStart(2, '0')}`;
      handleMonthChange(newMonthStr);
    };

    const handleResetToCurrentMonth = () => {
      handleMonthChange(currentMonthKey);
    };

    return (
      <div className="space-y-6">
        <div className="flex flex-col md:flex-row md:items-center justify-between gap-4">
          <div>
            <h2 className="text-2xl font-bold text-stone-800">Visão Geral</h2>
            <p className="text-stone-500">Bem-vindo de volta, <span className="font-semibold text-stone-700">{currentUser?.name}</span>!</p>
          </div>
          <div className="flex items-center gap-2 text-sm text-stone-500 bg-white px-4 py-2 rounded-xl border border-stone-100 shadow-sm">
            <Clock className="w-4 h-4 text-orange-500" />
            {new Date().toLocaleDateString('pt-BR', { weekday: 'long', day: 'numeric', month: 'long' })}
          </div>
        </div>

        {/* ========================================================================= */}
        {/* SEÇÃO ACUMULADO DE VENDAS DO MÊS (ACIMA DAS VENDAS DO DIA) */}
        {/* ========================================================================= */}
        <div id="monthly-sales-card" className="bg-white rounded-2xl shadow-sm border border-stone-200 overflow-hidden">
          {/* Header Superior com Seletor de Mês */}
          <div className="p-5 sm:p-6 bg-gradient-to-r from-stone-900 via-stone-850 to-stone-900 text-white flex flex-col lg:flex-row lg:items-center justify-between gap-4">
            <div>
              <div className="flex items-center gap-2 mb-1">
                <div className="p-2 bg-emerald-600 text-white rounded-xl shadow-xs">
                  <BarChart3 className="w-5 h-5" />
                </div>
                <h3 className="text-xl font-bold text-white tracking-tight">Acumulado de Vendas do Mês</h3>
                {isViewingCurrentMonth ? (
                  <span className="px-2.5 py-0.5 bg-emerald-500/20 text-emerald-300 border border-emerald-500/40 text-xs font-bold rounded-full flex items-center gap-1.5">
                    <span className="w-2 h-2 rounded-full bg-emerald-400 animate-pulse"></span>
                    Mês Atual (Em Andamento)
                  </span>
                ) : (
                  <span className="px-2.5 py-0.5 bg-amber-500/20 text-amber-300 border border-amber-500/40 text-xs font-bold rounded-full">
                    Mês Histórico
                  </span>
                )}
              </div>
              <p className="text-stone-300 text-xs sm:text-sm capitalize">
                {formattedMonthName} • Visão consolidada do período mensal
              </p>
            </div>

            {/* Controles de Navegação Mensal */}
            <div className="flex flex-wrap items-center gap-2">
              <button
                id="btn-prev-month"
                type="button"
                onClick={handlePrevDashboardMonth}
                title="Mês anterior"
                className="p-2.5 bg-stone-800 hover:bg-stone-700 text-white rounded-xl border border-stone-700 transition-colors cursor-pointer flex items-center justify-center"
              >
                <ChevronLeft className="w-4 h-4" />
              </button>

              {/* Input Nativo de Mês */}
              <div className="relative flex items-center">
                <input
                  id="input-dashboard-month"
                  type="month"
                  value={selectedDashboardMonth}
                  onChange={(e) => {
                    if (e.target.value) {
                      handleMonthChange(e.target.value);
                    }
                  }}
                  className="bg-stone-800 hover:bg-stone-700/80 text-white text-xs font-semibold px-3 py-2.5 rounded-xl border border-stone-700 focus:outline-none focus:ring-2 focus:ring-emerald-500 cursor-pointer"
                />
              </div>

              <button
                id="btn-next-month"
                type="button"
                onClick={handleNextDashboardMonth}
                title="Próximo mês"
                className="p-2.5 bg-stone-800 hover:bg-stone-700 text-white rounded-xl border border-stone-700 transition-colors cursor-pointer flex items-center justify-center"
              >
                <ChevronRight className="w-4 h-4" />
              </button>

              <button
                id="btn-current-month"
                type="button"
                onClick={handleResetToCurrentMonth}
                className={`px-3.5 py-2.5 text-xs font-bold rounded-xl transition-all cursor-pointer flex items-center gap-1.5 ${
                  isViewingCurrentMonth
                    ? 'bg-emerald-600 text-white shadow-xs'
                    : 'bg-stone-800 hover:bg-stone-700 text-stone-200 hover:text-white border border-stone-700'
                }`}
              >
                <Calendar className="w-3.5 h-3.5" />
                Mês Atual
              </button>
            </div>
          </div>

          {/* Faixa Informativa e Barra de Progresso do Mês */}
          <div className="bg-stone-100/90 px-5 sm:px-6 py-2.5 border-b border-stone-200 flex flex-wrap items-center justify-between gap-3 text-xs text-stone-600">
            <div className="flex flex-wrap items-center gap-2">
              <span className="font-bold text-stone-800 flex items-center gap-1">
                <Calendar className="w-3.5 h-3.5 text-emerald-600" />
                Período:
              </span>
              <span className="bg-white px-2 py-0.5 rounded-md border border-stone-200 text-stone-800 font-semibold capitalize">
                {formattedMonthName}
              </span>
              <span className="text-stone-300">•</span>
              <span>
                Progresso: <strong>Dia {elapsedDays} de {daysInMonth}</strong> ({monthProgressPercent}% do mês)
              </span>
              <span className="text-stone-300">•</span>
              <span>
                Média Diária: <strong className="text-emerald-700 font-bold">{formatCurrency(monthDailyAverage)}</strong>/dia
              </span>
              {isViewingCurrentMonth && monthDailyAverage > 0 && (
                <>
                  <span className="text-stone-300 hidden sm:inline">•</span>
                  <span className="hidden sm:inline">
                    Ritmo Projetado: <strong className="text-stone-800 font-bold">{formatCurrency(projectedMonthEndRevenue)}</strong>
                  </span>
                </>
              )}
            </div>

            {/* Barra de Progresso Visual do Mês */}
            <div className="w-full sm:w-48 flex items-center gap-2">
              <div className="flex-1 bg-stone-200 rounded-full h-2 overflow-hidden">
                <div 
                  className="bg-emerald-600 h-full rounded-full transition-all duration-500"
                  style={{ width: `${monthProgressPercent}%` }}
                />
              </div>
              <span className="text-[11px] font-bold text-stone-700 whitespace-nowrap">{monthProgressPercent}%</span>
            </div>
          </div>

          {/* Conteúdo: 5 Cards de Métricas do Mês e Detalhamento de Canais */}
          <div className="p-5 sm:p-6 space-y-6">
            {/* 5 Cards de Métricas Mensais */}
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-5 gap-4">
              {/* Card 1: Faturamento Mensal */}
              <div id="monthly-revenue-metric" className="bg-emerald-50/60 p-4 rounded-xl border border-emerald-200/80 hover:border-emerald-300 transition-colors">
                <div className="flex items-center justify-between mb-2">
                  <span className="text-xs font-bold text-emerald-800 uppercase tracking-wider">Faturamento do Mês</span>
                  <div className="p-1.5 bg-emerald-100 text-emerald-700 rounded-lg"><DollarSign className="w-4 h-4" /></div>
                </div>
                <p className="text-2xl font-black text-emerald-950">{formatCurrency(monthRevenue)}</p>
                <p className="text-[11px] text-emerald-700 font-medium mt-1">
                  {monthCompletedCount} pedido(s) concluído(s)
                </p>
              </div>

              {/* Card 2: Total de Pedidos do Mês */}
              <div id="monthly-orders-metric" className="bg-stone-50/80 p-4 rounded-xl border border-stone-200/80 hover:border-blue-200 transition-colors">
                <div className="flex items-center justify-between mb-2">
                  <span className="text-xs font-bold text-stone-500 uppercase tracking-wider">Pedidos no Mês</span>
                  <div className="p-1.5 bg-blue-100 text-blue-700 rounded-lg"><ShoppingBag className="w-4 h-4" /></div>
                </div>
                <p className="text-2xl font-black text-stone-900">{monthOrdersCount}</p>
                <p className="text-[11px] text-stone-500 mt-1">
                  {monthCompletedCount} finalizados no período
                </p>
              </div>

              {/* Card 3: Ticket Médio Mensal */}
              <div id="monthly-ticket-metric" className="bg-stone-50/80 p-4 rounded-xl border border-stone-200/80 hover:border-purple-200 transition-colors">
                <div className="flex items-center justify-between mb-2">
                  <span className="text-xs font-bold text-stone-500 uppercase tracking-wider">Ticket Médio Mensal</span>
                  <div className="p-1.5 bg-purple-100 text-purple-700 rounded-lg"><TrendingUp className="w-4 h-4" /></div>
                </div>
                <p className="text-2xl font-black text-stone-900">{formatCurrency(monthTicketMedio)}</p>
                <p className="text-[11px] text-stone-500 mt-1">
                  Média por pedido finalizado
                </p>
              </div>

              {/* Card 4: Média Diária no Mês */}
              <div id="monthly-daily-avg-metric" className="bg-stone-50/80 p-4 rounded-xl border border-stone-200/80 hover:border-amber-200 transition-colors">
                <div className="flex items-center justify-between mb-2">
                  <span className="text-xs font-bold text-stone-500 uppercase tracking-wider">Média Diária</span>
                  <div className="p-1.5 bg-amber-100 text-amber-700 rounded-lg"><Clock className="w-4 h-4" /></div>
                </div>
                <p className="text-2xl font-black text-stone-900">{formatCurrency(monthDailyAverage)}</p>
                <p className="text-[11px] text-stone-500 mt-1">
                  Por dia em {elapsedDays} dia(s)
                </p>
              </div>

              {/* Card 5: Itens Vendidos no Mês */}
              <div id="monthly-items-metric" className="bg-stone-50/80 p-4 rounded-xl border border-stone-200/80 hover:border-orange-200 transition-colors">
                <div className="flex items-center justify-between mb-2">
                  <span className="text-xs font-bold text-stone-500 uppercase tracking-wider">Itens no Mês</span>
                  <div className="p-1.5 bg-orange-100 text-orange-700 rounded-lg"><Package className="w-4 h-4" /></div>
                </div>
                <p className="text-2xl font-black text-stone-900">{monthItemsSold}</p>
                <p className="text-[11px] text-stone-500 mt-1">
                  Unidades comercializadas
                </p>
              </div>
            </div>

            {/* Faixa de Canais de Venda no Mês */}
            <div className="bg-stone-50/80 p-4 rounded-xl border border-stone-200 flex flex-col md:flex-row md:items-center justify-between gap-4">
              <div className="flex items-center gap-2">
                <span className="text-xs font-bold uppercase tracking-wider text-stone-700 flex items-center gap-1.5">
                  <UtensilsCrossed className="w-3.5 h-3.5 text-stone-500" />
                  Divisão de Faturamento por Canal no Mês:
                </span>
              </div>

              <div className="flex flex-wrap items-center gap-3 sm:gap-6 text-xs">
                {/* Retirada no Balcão */}
                <div className="flex items-center gap-2">
                  <span className="w-2.5 h-2.5 rounded-full bg-blue-500"></span>
                  <span className="text-stone-600 font-medium">Retirada no Balcão:</span>
                  <strong className="text-stone-900 font-bold">{formatCurrency(monthPickupRevenue)}</strong>
                  <span className="text-[10px] text-stone-500 bg-stone-200/70 px-1.5 py-0.5 rounded font-mono">
                    {monthRevenue > 0 ? Math.round((monthPickupRevenue / monthRevenue) * 100) : 0}%
                  </span>
                </div>

                {/* Loja Física / Mesa */}
                <div className="flex items-center gap-2">
                  <span className="w-2.5 h-2.5 rounded-full bg-emerald-500"></span>
                  <span className="text-stone-600 font-medium">Consumo na Loja / Mesas:</span>
                  <strong className="text-stone-900 font-bold">{formatCurrency(monthDineInRevenue)}</strong>
                  <span className="text-[10px] text-stone-500 bg-stone-200/70 px-1.5 py-0.5 rounded font-mono">
                    {monthRevenue > 0 ? Math.round((monthDineInRevenue / monthRevenue) * 100) : 0}%
                  </span>
                </div>

                {/* Totem */}
                <div className="flex items-center gap-2">
                  <span className="w-2.5 h-2.5 rounded-full bg-amber-500"></span>
                  <span className="text-stone-600 font-medium">Totem:</span>
                  <strong className="text-stone-900 font-bold">{formatCurrency(monthKioskRevenue)}</strong>
                  <span className="text-[10px] text-stone-500 bg-stone-200/70 px-1.5 py-0.5 rounded font-mono">
                    {monthRevenue > 0 ? Math.round((monthKioskRevenue / monthRevenue) * 100) : 0}%
                  </span>
                </div>
              </div>
            </div>
          </div>
        </div>

        {/* ========================================================================= */}
        {/* SEÇÃO PRINCIPAL: VENDAS POR DIA COM CALENDÁRIO INTERATIVO */}
        {/* ========================================================================= */}
        <div className="bg-white rounded-2xl shadow-sm border border-stone-200 overflow-hidden">
          {/* Header Superior com Seletor de Data / Calendário */}
          <div className="p-5 sm:p-6 bg-gradient-to-r from-stone-900 via-stone-850 to-stone-900 text-white flex flex-col lg:flex-row lg:items-center justify-between gap-4">
            <div>
              <div className="flex items-center gap-2 mb-1">
                <div className="p-2 bg-orange-500 text-white rounded-xl shadow-xs">
                  <CalendarDays className="w-5 h-5" />
                </div>
                <h3 className="text-xl font-bold text-white tracking-tight">Vendas por Dia</h3>
                {isViewingToday ? (
                  <span className="px-2.5 py-0.5 bg-emerald-500/20 text-emerald-300 border border-emerald-500/40 text-xs font-bold rounded-full flex items-center gap-1.5">
                    <span className="w-2 h-2 rounded-full bg-emerald-400 animate-pulse"></span>
                    Dia Atual (Hoje)
                  </span>
                ) : (
                  <span className="px-2.5 py-0.5 bg-amber-500/20 text-amber-300 border border-amber-500/40 text-xs font-bold rounded-full">
                    Data Histórica
                  </span>
                )}
              </div>
              <p className="text-stone-300 text-xs sm:text-sm capitalize">
                {formatDashboardDateLabel(selectedDashboardDate)}
              </p>
            </div>

            {/* Controles de Calendário e Navegação */}
            <div className="flex flex-wrap items-center gap-2">
              <button
                type="button"
                onClick={handlePrevDashboardDay}
                title="Dia anterior"
                className="p-2.5 bg-stone-800 hover:bg-stone-700 text-white rounded-xl border border-stone-700 transition-colors cursor-pointer flex items-center justify-center"
              >
                <ChevronLeft className="w-4 h-4" />
              </button>

              {/* Input Nativo de Data / Calendário */}
              <div className="relative flex items-center">
                <input
                  type="date"
                  value={selectedDashboardDate}
                  onChange={(e) => {
                    if (e.target.value) {
                      setSelectedDashboardDate(e.target.value);
                    }
                  }}
                  className="bg-stone-800 hover:bg-stone-700/80 text-white text-xs font-semibold px-3 py-2.5 rounded-xl border border-stone-700 focus:outline-none focus:ring-2 focus:ring-orange-500 cursor-pointer"
                />
              </div>

              <button
                type="button"
                onClick={handleNextDashboardDay}
                title="Próximo dia"
                className="p-2.5 bg-stone-800 hover:bg-stone-700 text-white rounded-xl border border-stone-700 transition-colors cursor-pointer flex items-center justify-center"
              >
                <ChevronRight className="w-4 h-4" />
              </button>

              <button
                type="button"
                onClick={handleResetToToday}
                className={`px-3.5 py-2.5 text-xs font-bold rounded-xl transition-all cursor-pointer flex items-center gap-1.5 ${
                  isViewingToday
                    ? 'bg-orange-600 text-white shadow-xs'
                    : 'bg-stone-800 hover:bg-stone-700 text-stone-200 hover:text-white border border-stone-700'
                }`}
              >
                <Clock className="w-3.5 h-3.5" />
                Hoje
              </button>
            </div>
          </div>

          {/* Faixa Informativa: Mostrando sempre o Dia Atual mesmo que o usuário esteja navegando em datas passadas */}
          <div className="bg-stone-100/90 px-5 sm:px-6 py-2.5 border-b border-stone-200 flex flex-wrap items-center justify-between gap-2 text-xs text-stone-600">
            <div className="flex flex-wrap items-center gap-2">
              <span className="font-bold text-stone-800 flex items-center gap-1">
                <Calendar className="w-3.5 h-3.5 text-orange-600" />
                Dia Atual:
              </span>
              <span className="bg-white px-2 py-0.5 rounded-md border border-stone-200 text-stone-800 font-semibold">
                {formatDashboardDateLabel(todayStr)}
              </span>
              <span className="text-stone-300">•</span>
              <span>
                Faturamento Hoje: <strong className="text-emerald-700 font-bold">{formatCurrency(todayRevenue)}</strong> ({todayOrdersCount} pedido{todayOrdersCount !== 1 ? 's' : ''})
              </span>
            </div>

            {!isViewingToday && (
              <button
                type="button"
                onClick={handleResetToToday}
                className="text-xs font-bold text-orange-600 hover:text-orange-700 hover:underline flex items-center gap-1 cursor-pointer"
              >
                Voltar para o Dia Atual &rarr;
              </button>
            )}
          </div>

          <div className="p-5 sm:p-6 space-y-6">
            {/* 4 Cards de Métricas do Dia Selecionado */}
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
              <div className="bg-stone-50/80 p-4 rounded-xl border border-stone-200/80 hover:border-emerald-200 transition-colors">
                <div className="flex items-center justify-between mb-2">
                  <span className="text-xs font-bold text-stone-500 uppercase tracking-wider">Faturamento do Dia</span>
                  <div className="p-1.5 bg-green-100 text-green-700 rounded-lg"><DollarSign className="w-4 h-4" /></div>
                </div>
                <p className="text-2xl font-black text-stone-900">{formatCurrency(dayRevenue)}</p>
                <p className="text-[11px] text-stone-500 mt-1">
                  {dayCompletedCount} pedido(s) concluído(s)
                </p>
              </div>

              <div className="bg-stone-50/80 p-4 rounded-xl border border-stone-200/80 hover:border-blue-200 transition-colors">
                <div className="flex items-center justify-between mb-2">
                  <span className="text-xs font-bold text-stone-500 uppercase tracking-wider">Total de Pedidos</span>
                  <div className="p-1.5 bg-blue-100 text-blue-700 rounded-lg"><ShoppingBag className="w-4 h-4" /></div>
                </div>
                <p className="text-2xl font-black text-stone-900">{dayOrdersCount}</p>
                <p className="text-[11px] text-stone-500 mt-1">
                  {dayOrders.filter(o => o.status === 'pending' || o.status === 'preparing').length} em andamento
                </p>
              </div>

              <div className="bg-stone-50/80 p-4 rounded-xl border border-stone-200/80 hover:border-purple-200 transition-colors">
                <div className="flex items-center justify-between mb-2">
                  <span className="text-xs font-bold text-stone-500 uppercase tracking-wider">Ticket Médio do Dia</span>
                  <div className="p-1.5 bg-purple-100 text-purple-700 rounded-lg"><TrendingUp className="w-4 h-4" /></div>
                </div>
                <p className="text-2xl font-black text-stone-900">{formatCurrency(dayTicketMedio)}</p>
                <p className="text-[11px] text-stone-500 mt-1">
                  Média por pedido concluído
                </p>
              </div>

              <div className="bg-stone-50/80 p-4 rounded-xl border border-stone-200/80 hover:border-amber-200 transition-colors">
                <div className="flex items-center justify-between mb-2">
                  <span className="text-xs font-bold text-stone-500 uppercase tracking-wider">Itens Vendidos</span>
                  <div className="p-1.5 bg-amber-100 text-amber-700 rounded-lg"><Package className="w-4 h-4" /></div>
                </div>
                <p className="text-2xl font-black text-stone-900">{dayItemsSold}</p>
                <p className="text-[11px] text-stone-500 mt-1">
                  Unidades em pedidos do dia
                </p>
              </div>
            </div>

            {/* Barra Interativa: Desktop (7 Dias) e Mobile (Apresentação de 3 em 3 Dias) */}
            <div className="bg-stone-50/70 p-3.5 sm:p-4 rounded-xl border border-stone-200">
              
              {/* === VERSÃO MOBILE: 3 EM 3 DIAS COM NAVEGAÇÃO E SWIPE === */}
              <div className="block sm:hidden">
                <div className="flex items-center justify-between gap-2 mb-2">
                  <div className="flex items-center gap-1.5 min-w-0">
                    <Calendar className="w-3.5 h-3.5 text-orange-600 shrink-0" />
                    <span className="text-[11px] font-bold uppercase tracking-wider text-stone-700 truncate">
                      Vendas (3 em 3 dias)
                    </span>
                  </div>
                  
                  {isSelectedInRecent9 ? (
                    <div className="flex items-center gap-1 shrink-0">
                      <button
                        type="button"
                        onClick={() => setMobileDaysChunkIndex(prev => Math.max(prev - 1, 0))}
                        disabled={mobileDaysChunkIndex === 0}
                        className={`p-1.5 rounded-lg border text-xs transition-all ${
                          mobileDaysChunkIndex === 0
                            ? 'bg-stone-100 text-stone-300 border-stone-200 cursor-not-allowed opacity-50'
                            : 'bg-white text-stone-700 border-stone-300 hover:bg-stone-100 shadow-2xs cursor-pointer'
                        }`}
                        title="3 dias anteriores"
                        aria-label="3 dias anteriores"
                      >
                        <ChevronLeft className="w-3.5 h-3.5" />
                      </button>
                      
                      <span className="text-[10px] font-bold text-stone-600 bg-white border border-stone-200 px-1.5 py-0.5 rounded-md min-w-[32px] text-center">
                        {mobileDaysChunkIndex + 1}/3
                      </span>

                      <button
                        type="button"
                        onClick={() => setMobileDaysChunkIndex(prev => Math.min(prev + 1, 2))}
                        disabled={mobileDaysChunkIndex === 2}
                        className={`p-1.5 rounded-lg border text-xs transition-all ${
                          mobileDaysChunkIndex === 2
                            ? 'bg-stone-100 text-stone-300 border-stone-200 cursor-not-allowed opacity-50'
                            : 'bg-white text-stone-700 border-stone-300 hover:bg-stone-100 shadow-2xs cursor-pointer'
                        }`}
                        title="Próximos 3 dias"
                        aria-label="Próximos 3 dias"
                      >
                        <ChevronRight className="w-3.5 h-3.5" />
                      </button>
                    </div>
                  ) : (
                    <span className="text-[10px] font-bold text-amber-700 bg-amber-50 border border-amber-200 px-2 py-0.5 rounded-md">
                      Data Histórica (±1 dia)
                    </span>
                  )}
                </div>

                {/* Seletores Rápidos de Período (Pills) no Mobile */}
                {isSelectedInRecent9 && (
                  <div className="grid grid-cols-3 gap-1 mb-2.5">
                    <button
                      type="button"
                      onClick={() => setMobileDaysChunkIndex(0)}
                      className={`py-1 px-1 text-[10px] font-bold rounded-lg border transition-all text-center truncate cursor-pointer ${
                        mobileDaysChunkIndex === 0
                          ? 'bg-orange-600 text-white border-orange-600 shadow-2xs'
                          : 'bg-white text-stone-600 border-stone-200 hover:bg-stone-100'
                      }`}
                    >
                      {recent9Days[0].dateFormatted} - {recent9Days[2].dateFormatted}
                    </button>
                    <button
                      type="button"
                      onClick={() => setMobileDaysChunkIndex(1)}
                      className={`py-1 px-1 text-[10px] font-bold rounded-lg border transition-all text-center truncate cursor-pointer ${
                        mobileDaysChunkIndex === 1
                          ? 'bg-orange-600 text-white border-orange-600 shadow-2xs'
                          : 'bg-white text-stone-600 border-stone-200 hover:bg-stone-100'
                      }`}
                    >
                      {recent9Days[3].dateFormatted} - {recent9Days[5].dateFormatted}
                    </button>
                    <button
                      type="button"
                      onClick={() => setMobileDaysChunkIndex(2)}
                      className={`py-1 px-1 text-[10px] font-bold rounded-lg border transition-all text-center truncate cursor-pointer ${
                        mobileDaysChunkIndex === 2
                          ? 'bg-orange-600 text-white border-orange-600 shadow-2xs'
                          : 'bg-white text-stone-600 border-stone-200 hover:bg-stone-100'
                      }`}
                    >
                      {recent9Days[6].dateFormatted} - {recent9Days[8].dateFormatted}
                    </button>
                  </div>
                )}

                {/* Grid Exclusivo de 3 Dias por Vez no Mobile */}
                <div 
                  className="grid grid-cols-3 gap-2 pt-1 touch-pan-y"
                  onTouchStart={handleMobileTouchStart}
                  onTouchEnd={handleMobileTouchEnd}
                >
                  {activeMobileDays.map(item => (
                    <button
                      key={item.dateKey}
                      type="button"
                      onClick={() => setSelectedDashboardDate(item.dateKey)}
                      className={`flex flex-col items-center justify-between p-2 sm:p-2.5 rounded-xl border transition-all cursor-pointer text-center relative ${
                        item.isSelected
                          ? 'bg-orange-50 border-orange-400 ring-2 ring-orange-400/30 shadow-xs'
                          : item.isToday
                          ? 'bg-white border-emerald-400 shadow-xs'
                          : 'bg-white border-stone-200 hover:bg-stone-100/80'
                      }`}
                    >
                      {item.isToday && (
                        <span className="absolute -top-2 left-1/2 -translate-x-1/2 bg-emerald-600 text-white text-[8px] font-bold px-1.5 py-0.2 rounded-full shadow-xs whitespace-nowrap">
                          HOJE
                        </span>
                      )}
                      <span className="text-[10px] font-bold text-stone-500 mt-0.5">{item.dayLabel}</span>
                      <span className="text-xs font-black text-stone-800">{item.dateFormatted}</span>

                      {/* Barra proporcional de vendas */}
                      <div className="w-full bg-stone-100 rounded-full h-1.5 my-1.5 overflow-hidden">
                        <div
                          className={`h-full rounded-full transition-all duration-300 ${
                            item.isSelected ? 'bg-orange-500' : item.isToday ? 'bg-emerald-500' : 'bg-stone-400'
                          }`}
                          style={{ width: `${Math.max((item.revenue / maxRevenue7Days) * 100, item.revenue > 0 ? 8 : 0)}%` }}
                        />
                      </div>

                      <span className="text-[11px] font-extrabold text-stone-900 leading-tight truncate w-full">
                        {formatCurrency(item.revenue)}
                      </span>
                      <span className="text-[9px] text-stone-400 mt-0.5">{item.ordersCount} ped.</span>
                    </button>
                  ))}
                </div>

                <div className="flex items-center justify-between text-[10px] text-stone-400 mt-2.5 px-1">
                  <span>Deslize para ver outros dias</span>
                  {selectedDashboardDate !== todayStr && (
                    <button
                      type="button"
                      onClick={() => {
                        handleResetToToday();
                        setMobileDaysChunkIndex(2);
                      }}
                      className="text-orange-600 font-bold hover:underline cursor-pointer"
                    >
                      Ir para Hoje
                    </button>
                  )}
                </div>
              </div>

              {/* === VERSÃO DESKTOP: TODOS OS 7 DIAS COMPLETOS === */}
              <div className="hidden sm:block">
                <div className="flex flex-wrap items-center justify-between mb-3 gap-2">
                  <span className="text-xs font-bold uppercase tracking-wider text-stone-700 flex items-center gap-1.5">
                    <Calendar className="w-3.5 h-3.5 text-orange-600" />
                    Vendas dos Últimos 7 Dias (Clique para ver qualquer dia)
                  </span>
                  <span className="text-[11px] text-stone-400">
                    O dia atual está sempre destacado
                  </span>
                </div>

                <div className="grid grid-cols-7 gap-1.5 sm:gap-2 pt-2">
                  {last7Days.map(item => (
                    <button
                      key={item.dateKey}
                      type="button"
                      onClick={() => setSelectedDashboardDate(item.dateKey)}
                      className={`flex flex-col items-center justify-between p-2 sm:p-2.5 rounded-xl border transition-all cursor-pointer text-center relative ${
                        item.isSelected
                          ? 'bg-orange-50 border-orange-400 ring-2 ring-orange-400/30 shadow-xs'
                          : item.isToday
                          ? 'bg-white border-emerald-400 shadow-xs'
                          : 'bg-white border-stone-200 hover:bg-stone-100/80'
                      }`}
                    >
                      {item.isToday && (
                        <span className="absolute -top-2 left-1/2 -translate-x-1/2 bg-emerald-600 text-white text-[9px] font-bold px-1.5 py-0.2 rounded-full shadow-xs whitespace-nowrap">
                          HOJE
                        </span>
                      )}
                      <span className="text-[10px] font-bold text-stone-500 mt-0.5">{item.dayLabel}</span>
                      <span className="text-xs font-black text-stone-800">{item.dateFormatted}</span>

                      {/* Barra proporcional de vendas */}
                      <div className="w-full bg-stone-100 rounded-full h-1.5 my-1.5 overflow-hidden">
                        <div
                          className={`h-full rounded-full transition-all duration-300 ${
                            item.isSelected ? 'bg-orange-500' : item.isToday ? 'bg-emerald-500' : 'bg-stone-400'
                          }`}
                          style={{ width: `${Math.max((item.revenue / maxRevenue7Days) * 100, item.revenue > 0 ? 8 : 0)}%` }}
                        />
                      </div>

                      <span className="text-[11px] font-extrabold text-stone-900 leading-tight">{formatCurrency(item.revenue)}</span>
                      <span className="text-[9px] text-stone-400">{item.ordersCount} ped.</span>
                    </button>
                  ))}
                </div>
              </div>

            </div>

            {/* Detalhamento: Canais de Venda e Formas de Pagamento do Dia */}
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              {/* Canais de Venda */}
              <div className="p-4 bg-stone-50/70 rounded-xl border border-stone-200/80">
                <h4 className="text-xs font-bold uppercase tracking-wider text-stone-700 mb-3 flex items-center justify-between">
                  <span>Vendas por Canal no Dia</span>
                  <span className="text-stone-400 font-medium">({dayCompletedCount} concluídos)</span>
                </h4>
                <div className="space-y-2">
                  <div className="flex items-center justify-between p-2.5 bg-white rounded-lg border border-stone-200">
                    <div className="flex items-center gap-2">
                      <span className="w-2.5 h-2.5 rounded-full bg-blue-500"></span>
                      <span className="text-xs font-semibold text-stone-800">Retirada no Balcão</span>
                      <span className="text-[11px] text-stone-400 font-mono">({dayPickupOrders.length})</span>
                    </div>
                    <span className="text-xs font-bold text-stone-900">{formatCurrency(dayPickupRevenue)}</span>
                  </div>

                  <div className="flex items-center justify-between p-2.5 bg-white rounded-lg border border-stone-200">
                    <div className="flex items-center gap-2">
                      <span className="w-2.5 h-2.5 rounded-full bg-emerald-500"></span>
                      <span className="text-xs font-semibold text-stone-800">Consumo na Loja / Mesas</span>
                      <span className="text-[11px] text-stone-400 font-mono">({dayDineInOrders.length})</span>
                    </div>
                    <span className="text-xs font-bold text-stone-900">{formatCurrency(dayDineInRevenue)}</span>
                  </div>

                  <div className="flex items-center justify-between p-2.5 bg-white rounded-lg border border-stone-200">
                    <div className="flex items-center gap-2">
                      <span className="w-2.5 h-2.5 rounded-full bg-amber-500"></span>
                      <span className="text-xs font-semibold text-stone-800">Totem de Autoatendimento</span>
                      <span className="text-[11px] text-stone-400 font-mono">({dayKioskOrders.length})</span>
                    </div>
                    <span className="text-xs font-bold text-stone-900">{formatCurrency(dayKioskRevenue)}</span>
                  </div>
                </div>
              </div>

              {/* Formas de Pagamento */}
              <div className="p-4 bg-stone-50/70 rounded-xl border border-stone-200/80">
                <h4 className="text-xs font-bold uppercase tracking-wider text-stone-700 mb-3 flex items-center justify-between">
                  <span>Formas de Pagamento no Dia</span>
                  <span className="text-stone-400 font-medium">({Object.keys(dayPaymentMethods).length} métodos)</span>
                </h4>
                {Object.keys(dayPaymentMethods).length > 0 ? (
                  <div className="space-y-2">
                    {Object.entries(dayPaymentMethods).map(([method, data]) => (
                      <div key={method} className="flex items-center justify-between p-2.5 bg-white rounded-lg border border-stone-200">
                        <div className="flex items-center gap-2">
                          <CreditCard className="w-3.5 h-3.5 text-stone-500" />
                          <span className="text-xs font-semibold text-stone-800 capitalize">{method}</span>
                          <span className="text-[11px] text-stone-400">({data.count}x)</span>
                        </div>
                        <span className="text-xs font-bold text-stone-900">{formatCurrency(data.total)}</span>
                      </div>
                    ))}
                  </div>
                ) : (
                  <div className="py-6 text-center text-xs text-stone-400">
                    Nenhum pagamento registrado nesta data.
                  </div>
                )}
              </div>
            </div>

            {/* Lista Detalhada de Pedidos do Dia Selecionado */}
            <div className="border border-stone-200 rounded-xl overflow-hidden bg-white">
              <div className="p-3.5 sm:p-4 bg-stone-50 border-b border-stone-200 flex flex-wrap items-center justify-between gap-2">
                <div className="flex items-center gap-2">
                  <Clock className="w-4 h-4 text-stone-600" />
                  <h4 className="text-xs font-bold uppercase tracking-wider text-stone-800">
                    Pedidos Registrados no Dia ({dayOrders.length})
                  </h4>
                </div>
                <span className="text-xs text-stone-500 font-medium capitalize">
                  {formatDashboardDateLabel(selectedDashboardDate)}
                </span>
              </div>

              {dayOrders.length > 0 ? (
                <div className="divide-y divide-stone-100 max-h-96 overflow-y-auto">
                  {dayOrders.map(ord => (
                    <div key={ord.id} className="p-3.5 hover:bg-stone-50/80 flex flex-col sm:flex-row sm:items-center justify-between gap-2 text-xs transition-colors">
                      <div className="flex items-center gap-3">
                        <span className="font-mono font-bold text-stone-800 bg-stone-100 px-2 py-1 rounded-md">
                          #{String(ord.id).slice(-4).padStart(4, '0')}
                        </span>
                        <div>
                          <div className="flex items-center gap-2">
                            <span className="font-bold text-stone-800">
                              {ord.customerName || (ord.type === 'kiosk' ? 'Totem Autoatendimento' : 'Cliente')}
                            </span>
                            {ord.tableNumber && (
                              <span className="px-1.5 py-0.5 bg-amber-100 text-amber-800 rounded font-semibold text-[10px]">
                                Mesa {ord.tableNumber}
                              </span>
                            )}
                            {(!ord.tableNumber && ord.type !== 'kiosk' && ord.type !== 'dine_in') && (
                              <span className="px-1.5 py-0.5 bg-blue-100 text-blue-800 rounded font-semibold text-[10px]">
                                Retirada
                              </span>
                            )}
                            {ord.type === 'kiosk' && (
                              <span className="px-1.5 py-0.5 bg-purple-100 text-purple-800 rounded font-semibold text-[10px]">
                                Totem
                              </span>
                            )}
                            <span className="text-stone-400 text-[11px]">
                              {new Date(ord.createdAt).toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' })}
                            </span>
                          </div>
                          <p className="text-stone-500 text-[11px] line-clamp-1 mt-0.5">
                            {(ord.items || []).map(i => `${i.quantity}x ${i.name}`).join(', ')}
                          </p>
                        </div>
                      </div>

                      <div className="flex items-center gap-2.5 flex-wrap self-end sm:self-auto">
                        {(() => {
                          const pb = getOrderPaymentBreakdown(ord);
                          const needsPayConfirm = requiresOperatorPaymentConfirmation(ord);
                          const shouldPulseRed = (pb.kind === 'pay_on_pickup' || pb.kind === 'partial_50') && ord.status !== 'completed' && ord.status !== 'cancelled';
                          return (
                            <>
                              <span className={`px-2 py-0.5 rounded-full text-[10px] font-black border ${
                                shouldPulseRed
                                  ? 'bg-red-600 text-white border-red-700 animate-pulse shadow-sm shadow-red-600/40 ring-2 ring-red-400/60'
                                  : pb.kind === 'partial_50'
                                  ? 'bg-amber-100 text-amber-900 border-amber-300'
                                  : pb.kind === 'paid_full'
                                  ? 'bg-emerald-100 text-emerald-800 border-emerald-300'
                                  : 'bg-orange-100 text-orange-900 border-orange-300'
                              }`}>
                                {pb.operatorBadge}
                              </span>
                              {needsPayConfirm && (
                                <button
                                  type="button"
                                  onClick={() => openPaymentConfirmModal(ord)}
                                  className="px-2.5 py-1 rounded-md text-[10px] font-black bg-rose-600 hover:bg-rose-700 text-white flex items-center gap-1 shadow-xs transition-colors cursor-pointer"
                                  title={
                                    pb.kind === 'partial_50'
                                      ? 'Confirmar pagamento 50% recebido com senha antes de produzir'
                                      : 'Confirmar pagamento integral online recebido com senha antes de produzir'
                                  }
                                >
                                  <Lock className="w-3 h-3" />
                                  CONFIRMAR PAGAMENTO
                                </button>
                              )}
                            </>
                          );
                        })()}
                        <span className="text-stone-500 text-[11px] capitalize bg-stone-100 px-2 py-0.5 rounded max-w-[200px] truncate" title={ord.paymentMethod || 'Não informado'}>
                          {ord.paymentMethod || 'Não informado'}
                        </span>
                        <span className={`px-2 py-0.5 rounded-full text-[10px] font-bold ${
                          ord.status === 'completed'
                            ? 'bg-emerald-100 text-emerald-800'
                            : (ord.status === 'ready' || ord.status === 'ready_for_pickup' || ord.status === 'ready_for_delivery' || ord.status === 'out_for_delivery')
                            ? 'bg-blue-100 text-blue-700'
                            : ord.status === 'preparing'
                            ? 'bg-orange-100 text-orange-700'
                            : ord.status === 'cancelled'
                            ? 'bg-red-100 text-red-700'
                            : 'bg-amber-100 text-amber-800'
                        }`}>
                          {ord.status === 'completed' ? 'Finalizado' :
                           (ord.status === 'ready' || ord.status === 'ready_for_pickup' || ord.status === 'ready_for_delivery' || ord.status === 'out_for_delivery') ? 'Pronto p/ Retirada' :
                           ord.status === 'preparing' ? 'Preparando' :
                           ord.status === 'cancelled' ? 'Cancelado' : 'Pendente'}
                        </span>
                        <span className="font-bold text-stone-900 min-w-[70px] text-right">
                          {formatCurrency(ord.total)}
                        </span>
                        <button
                          type="button"
                          onClick={() => printOrder(ord)}
                          title="Imprimir comprovante"
                          className="p-1 hover:bg-stone-200 rounded text-stone-500 hover:text-stone-800 transition-colors cursor-pointer"
                        >
                          <Printer className="w-3.5 h-3.5" />
                        </button>
                        {isAdminOrMaster && (
                          <button
                            type="button"
                            onClick={() => handleExportOrder(ord)}
                            disabled={exportingOrderId === ord.id}
                            title={
                              ord.blueFocusExported
                                ? `Exportado para BlueFocus${ord.blueFocusExportedAt ? ` em ${new Date(ord.blueFocusExportedAt).toLocaleString('pt-BR')}` : ''} (Clique para reenviar)`
                                : ord.blueFocusExportError
                                ? `Erro ao exportar: ${ord.blueFocusExportError} (Clique para tentar novamente)`
                                : 'Exportar pedido para o BlueFocus'
                            }
                            className={`px-2 py-1 rounded text-[10px] font-bold flex items-center gap-1 transition-colors cursor-pointer disabled:opacity-50 ${
                              ord.blueFocusExported
                                ? 'bg-emerald-100 text-emerald-800 hover:bg-emerald-200 border border-emerald-300'
                                : ord.blueFocusExportError
                                ? 'bg-red-100 text-red-800 hover:bg-red-200 border border-red-300'
                                : 'bg-blue-100 text-blue-700 hover:bg-blue-200 border border-blue-200'
                            }`}
                          >
                            {exportingOrderId === ord.id ? (
                              <RefreshCw className="w-3 h-3 animate-spin" />
                            ) : ord.blueFocusExported ? (
                              <CheckCircle2 className="w-3 h-3" />
                            ) : ord.blueFocusExportError ? (
                              <AlertTriangle className="w-3 h-3" />
                            ) : (
                              <Upload className="w-3 h-3" />
                            )}
                            <span>
                              {exportingOrderId === ord.id
                                ? 'Enviando...'
                                : ord.blueFocusExported
                                ? 'BlueFocus ✓'
                                : ord.blueFocusExportError
                                ? 'Erro ERP'
                                : 'BlueFocus'}
                            </span>
                          </button>
                        )}
                      </div>
                    </div>
                  ))}
                </div>
              ) : (
                <div className="py-8 text-center space-y-2">
                  <ShoppingBag className="w-8 h-8 text-stone-300 mx-auto" />
                  <p className="text-xs font-bold text-stone-600">Nenhum pedido registrado nesta data.</p>
                  <p className="text-[11px] text-stone-400">
                    Use as setas para navegar ou clique em "Hoje" para voltar ao dia atual.
                  </p>
                </div>
              )}
            </div>
          </div>
        </div>

        {/* Subtítulo para Métricas Gerais */}
        <div className="pt-2">
          <h3 className="text-base font-bold text-stone-700 mb-1">Métricas Gerais da Loja (Histórico Acumulado)</h3>
          <p className="text-xs text-stone-400">Visão global consolidada de todo o histórico da loja</p>
        </div>
        
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
          <div className="bg-white p-6 rounded-2xl shadow-sm border border-stone-100">
            <div className="flex items-center justify-between mb-4">
              <h3 className="text-stone-500 font-medium">Receita Total</h3>
              <div className="p-2 bg-green-100 text-green-600 rounded-lg"><DollarSign className="w-5 h-5" /></div>
            </div>
            <p className="text-3xl font-bold text-stone-800">{formatCurrency(totalRevenue)}</p>
          </div>
          
          <div className="bg-white p-6 rounded-2xl shadow-sm border border-stone-100">
            <div className="flex items-center justify-between mb-4">
              <h3 className="text-stone-500 font-medium">Pedidos Finalizados</h3>
              <div className="p-2 bg-blue-100 text-blue-600 rounded-lg"><ShoppingBag className="w-5 h-5" /></div>
            </div>
            <p className="text-3xl font-bold text-stone-800">{totalOrdersCount}</p>
          </div>

          <div className="bg-white p-6 rounded-2xl shadow-sm border border-stone-100">
            <div className="flex items-center justify-between mb-4">
              <h3 className="text-stone-500 font-medium">Ticket Médio</h3>
              <div className="p-2 bg-purple-100 text-purple-600 rounded-lg"><TrendingUp className="w-5 h-5" /></div>
            </div>
            <p className="text-3xl font-bold text-stone-800">{formatCurrency(ticketMedio)}</p>
          </div>

          <div className="bg-white p-6 rounded-2xl shadow-sm border border-stone-100">
            <div className="flex items-center justify-between mb-4">
              <h3 className="text-stone-500 font-medium">Pedidos Pendentes</h3>
              <div className="p-2 bg-orange-100 text-orange-600 rounded-lg"><Clock className="w-5 h-5" /></div>
            </div>
            <p className="text-3xl font-bold text-stone-800">{pendingCount}</p>
          </div>

          <div className="bg-white p-6 rounded-2xl shadow-sm border border-stone-100">
            <div className="flex items-center justify-between mb-4">
              <h3 className="text-stone-500 font-medium">Total de Produtos</h3>
              <div className="p-2 bg-indigo-100 text-indigo-600 rounded-lg"><Package className="w-5 h-5" /></div>
            </div>
            <p className="text-3xl font-bold text-stone-800">{totalProductsCount}</p>
          </div>

          <div className="bg-white p-6 rounded-2xl shadow-sm border border-stone-100">
            <div className="flex items-center justify-between mb-4">
              <h3 className="text-stone-500 font-medium">Produtos Ativos</h3>
              <div className="p-2 bg-emerald-100 text-emerald-600 rounded-lg"><CheckCircle2 className="w-5 h-5" /></div>
            </div>
            <p className="text-3xl font-bold text-stone-800">{activeProductsCount}</p>
          </div>

          <div 
            onClick={() => {
              fetchAppInstalls?.();
              setShowInstallsModal(true);
            }}
            className="bg-white p-6 rounded-2xl shadow-sm border border-stone-100 cursor-pointer hover:border-amber-400 hover:shadow-md transition-all group"
          >
            <div className="flex items-center justify-between mb-4">
              <h3 className="text-stone-500 font-medium group-hover:text-amber-700 transition-colors">Apps Instalados</h3>
              <div className="p-2 bg-amber-100 text-amber-700 rounded-lg group-hover:bg-amber-500 group-hover:text-white transition-colors">
                <Smartphone className="w-5 h-5" />
              </div>
            </div>
            <div className="flex items-baseline justify-between">
              <p className="text-3xl font-bold text-stone-800">{appInstallsCount}</p>
              <span className="text-xs text-amber-700 font-bold flex items-center gap-1 group-hover:underline">
                Ver lista &rarr;
              </span>
            </div>
            <p className="text-xs text-stone-400 mt-1">Total de clientes que baixaram o app</p>
          </div>
        </div>

        {/* Modal de Detalhes dos Aplicativos Instalados */}
        {showInstallsModal && (
          <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/60 backdrop-blur-xs">
            <div className="bg-white w-full max-w-2xl rounded-3xl shadow-2xl border border-stone-200 overflow-hidden flex flex-col max-h-[90vh]">
              <div className="p-6 bg-gradient-to-r from-stone-900 to-stone-800 text-white flex items-center justify-between">
                <div className="flex items-center gap-3">
                  <div className="p-3 bg-amber-500/20 text-amber-400 rounded-2xl border border-amber-500/30">
                    <Smartphone className="w-6 h-6" />
                  </div>
                  <div>
                    <h3 className="font-bold text-lg text-white">Relatório de Instalações do App</h3>
                    <p className="text-xs text-stone-300">Total de {appInstallsCount} instalação(ões) registradas</p>
                  </div>
                </div>
                <button
                  type="button"
                  onClick={() => setShowInstallsModal(false)}
                  className="p-2 hover:bg-white/10 rounded-full transition-colors text-white/80 hover:text-white cursor-pointer"
                >
                  <X className="w-5 h-5" />
                </button>
              </div>

              <div className="p-6 overflow-y-auto space-y-4 flex-1">
                <div className="flex items-center justify-between pb-2 border-b border-stone-100">
                  <span className="text-xs font-bold uppercase tracking-wider text-stone-400">Histórico de Dispositivos</span>
                  <button
                    type="button"
                    onClick={() => fetchAppInstalls?.()}
                    className="text-xs text-amber-700 font-bold hover:underline flex items-center gap-1 cursor-pointer"
                  >
                    <RefreshCw className="w-3.5 h-3.5" />
                    Atualizar dados
                  </button>
                </div>

                {appInstallsList && appInstallsList.length > 0 ? (
                  <div className="divide-y divide-stone-100 border border-stone-100 rounded-2xl overflow-hidden">
                    {appInstallsList.map((inst, index) => (
                      <div key={inst.id || index} className="p-4 hover:bg-stone-50 flex items-center justify-between transition-colors">
                        <div className="flex items-center gap-3">
                          <div className="w-10 h-10 rounded-xl bg-amber-50 text-amber-700 flex items-center justify-center font-bold text-sm shrink-0 border border-amber-100">
                            <Download className="w-5 h-5" />
                          </div>
                          <div>
                            <p className="font-bold text-stone-800 text-sm">
                              {inst.platform || 'Dispositivo'} • {inst.browser || 'Navegador'}
                            </p>
                            <p className="text-xs text-stone-400">
                              Tipo: <span className="text-stone-600 font-medium">{inst.deviceType || 'Celular'}</span>
                            </p>
                          </div>
                        </div>
                        <div className="text-right">
                          <span className="inline-block px-2.5 py-1 bg-emerald-50 text-emerald-700 border border-emerald-200 text-[11px] font-bold rounded-lg mb-0.5">
                            Instalado
                          </span>
                          <p className="text-[11px] text-stone-400">
                            {inst.installedAt ? new Date(inst.installedAt).toLocaleString('pt-BR') : 'Recentemente'}
                          </p>
                        </div>
                      </div>
                    ))}
                  </div>
                ) : (
                  <div className="text-center py-12 bg-stone-50 rounded-2xl border border-stone-100">
                    <Smartphone className="w-12 h-12 text-stone-300 mx-auto mb-3" />
                    <p className="font-bold text-stone-700">Nenhuma instalação registrada ainda</p>
                    <p className="text-xs text-stone-500 mt-1 max-w-sm mx-auto">
                      Assim que seus clientes aceitarem o aviso de instalação ou adicionarem à tela inicial, as métricas aparecerão aqui em tempo real.
                    </p>
                  </div>
                )}
              </div>

              <div className="p-4 bg-stone-50 border-t border-stone-100 flex justify-end">
                <button
                  type="button"
                  onClick={() => setShowInstallsModal(false)}
                  className="px-5 py-2.5 bg-stone-900 hover:bg-stone-800 text-white text-xs font-bold rounded-xl transition-colors cursor-pointer"
                >
                  Fechar
                </button>
              </div>
            </div>
          </div>
        )}

        <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
          <div className="bg-white p-6 rounded-2xl shadow-sm border border-stone-100">
            <h3 className="text-lg font-bold text-stone-800 mb-4 flex items-center gap-2">
              <Package className="w-5 h-5 text-stone-400" />
              Produtos Mais Vendidos
            </h3>
            {topProducts.length > 0 ? (
              <div className="space-y-4">
                {topProducts.map((p, i) => (
                  <div key={i} className="flex items-center justify-between p-3 hover:bg-stone-50 rounded-xl transition-colors border border-stone-100">
                    <div className="flex items-center gap-3">
                      <div className="w-8 h-8 rounded-full bg-stone-100 flex items-center justify-center text-stone-500 font-bold text-sm">
                        {i + 1}
                      </div>
                      <span className="font-medium text-stone-800">{p.name}</span>
                    </div>
                    <div className="text-right">
                      <p className="font-bold text-stone-800">{p.quantity} un</p>
                      <p className="text-xs text-stone-500">{formatCurrency(p.revenue)}</p>
                    </div>
                  </div>
                ))}
              </div>
            ) : (
              <p className="text-stone-500 text-center py-8">Nenhum dado de venda ainda.</p>
            )}
          </div>

          <div className="bg-white p-6 rounded-2xl shadow-sm border border-stone-100">
            <h3 className="text-lg font-bold text-stone-800 mb-4 flex items-center gap-2">
              <Clock className="w-5 h-5 text-stone-400" />
              Últimos Pedidos
            </h3>
            <div className="space-y-3">
              {orders.slice(0, 5).map(order => (
                <div key={order.id} className={`flex items-center justify-between p-3 border rounded-xl ${order.type === 'kiosk' ? 'border-blue-200 bg-blue-50/40' : 'border-stone-100'}`}>
                  <div>
                    <p className="font-bold text-stone-800">Pedido #{String(order.id).slice(-4).padStart(4, '0')}</p>
                    <p className="text-xs text-stone-500">{new Date(order.createdAt).toLocaleTimeString()}</p>
                  </div>
                  <div className="text-right">
                    <p className="font-bold text-stone-800">{formatCurrency(order.total)}</p>
                    <span className={`text-xs px-2 py-1 rounded-full font-bold ${
                      order.status === 'completed' ? 'bg-emerald-100 text-emerald-800' :
                      (order.status === 'ready' || order.status === 'ready_for_pickup' || order.status === 'ready_for_delivery' || order.status === 'out_for_delivery') ? 'bg-blue-100 text-blue-700' :
                      order.status === 'preparing' ? 'bg-orange-100 text-orange-700' :
                      order.status === 'cancelled' ? 'bg-red-100 text-red-700' :
                      'bg-amber-100 text-amber-800'
                    }`}>
                      {order.status === 'completed' ? 'Finalizado' :
                       (order.status === 'ready' || order.status === 'ready_for_pickup' || order.status === 'ready_for_delivery' || order.status === 'out_for_delivery') ? 'Pronto p/ Retirada' :
                       order.status === 'preparing' ? 'Preparando' :
                       order.status === 'cancelled' ? 'Cancelado' : 'Pendente'}
                    </span>
                  </div>
                </div>
              ))}
              {orders.length === 0 && (
                <p className="text-stone-500 text-center py-8">Nenhum pedido recente.</p>
              )}
            </div>
          </div>
        </div>
      </div>
    );
  };

  // Order pagination and filtering state
  const [pendingOrderPage, setPendingOrderPage] = useState(1);
  const [completedOrderPage, setCompletedOrderPage] = useState(1);
  const [orderSearchQuery, setOrderSearchQuery] = useState('');
  const [orderChannelFilter, setOrderChannelFilter] = useState<'all' | 'pickup' | 'instore' | 'kiosk'>('all');
  const todayKey = new Date().toISOString().slice(0, 10);
  const [selectedOrderDateTab, setSelectedOrderDateTab] = useState<string>('all');

    // Mantém 'all' (Todos os Dias) como posição inicial padrão conforme solicitado
    useEffect(() => {}, []);

  const renderOrders = () => {
    // Filter orders according to channel and search query
    const filteredOrders = orders.filter(o => {
      // Channel filter
      if (orderChannelFilter === 'kiosk' && o.type !== 'kiosk') return false;
      if (orderChannelFilter === 'instore' && (o.type === 'kiosk' || !o.tableNumber)) return false;
      if (orderChannelFilter === 'pickup' && (o.type === 'kiosk' || !!o.tableNumber)) return false;

      // Search query
      if (orderSearchQuery.trim()) {
        const q = normalizeText(orderSearchQuery.trim());
        const rawQ = orderSearchQuery.toLowerCase().trim();
        const idStr = String(o.id).toLowerCase();
        const customerName = normalizeText(o.customerName || '');
        const phone = (o.customerPhone || '').toLowerCase();
        const table = o.tableNumber ? String(o.tableNumber).toLowerCase() : '';
        const items = Array.isArray(o.items) ? o.items.map(i => normalizeText(i?.name || '')).join(' ') : '';

        return idStr.includes(rawQ) ||
               customerName.includes(q) ||
               phone.includes(rawQ) ||
               (table && table.includes(rawQ)) ||
               items.includes(q);
      }
      return true;
    });

    // Ordenação por Horário de Retirada:
    // Pedidos mais recentes/próximos de retirada ficam sempre primeiro; agendamentos mais distantes ficam no final.
    const allPendingOrders = filteredOrders
      .filter(o => 
        o.status === 'pending' || 
        o.status === 'preparing' || 
        o.status === 'ready_for_delivery' || 
        o.status === 'ready' || 
        o.status === 'ready_for_pickup' || 
        o.status === 'out_for_delivery'
      )
      .sort((a, b) => getEffectivePickupTimestamp(a) - getEffectivePickupTimestamp(b));

    // Construção dinâmica das Abas por Dia com Tema de Cores
    interface DateTabItem {
      key: string;
      label: string;
      count: number;
      theme: DayTheme;
      dayOfWeek: number;
      dayShortName: string;
    }
    const dateMap = new Map<string, DateTabItem>();
    const todayKey = new Date().toISOString().slice(0, 10);

    allPendingOrders.forEach(o => {
      const info = getOrderDateInfo(o);
      if (!dateMap.has(info.dateKey)) {
        dateMap.set(info.dateKey, { 
          key: info.dateKey, 
          label: info.formattedLabel, 
          count: 0,
          theme: info.theme,
          dayOfWeek: info.dayOfWeek,
          dayShortName: info.dayShortName
        });
      }
      const item = dateMap.get(info.dateKey)!;
      item.count += 1;
    });

    const sortedDates = Array.from(dateMap.values()).sort((a, b) => a.key.localeCompare(b.key));
    
    // Prioriza 'Hoje' se houver pedidos para hoje
    const todayTab = sortedDates.find(t => t.key === todayKey);
    const otherTabs = sortedDates.filter(t => t.key !== todayKey);

    const dateTabs: DateTabItem[] = [
      { 
        key: 'all', 
        label: 'Todos os Dias', 
        count: allPendingOrders.length, 
        theme: ALL_DAYS_THEME,
        dayOfWeek: -1,
        dayShortName: 'Todos'
      },
      ...(todayTab ? [todayTab] : []),
      ...otherTabs
    ];

    // Filtragem por Aba de Dia selecionada
    const pendingOrders = selectedOrderDateTab === 'all'
      ? allPendingOrders
      : allPendingOrders.filter(o => getOrderDateInfo(o).dateKey === selectedOrderDateTab);

    const completedOrders = filteredOrders
      .filter(o => 
        o.status === 'completed' || 
        o.status === 'cancelled'
      )
      .sort((a, b) => {
        const timeA = a.createdAt ? (typeof a.createdAt === 'number' ? a.createdAt : new Date(a.createdAt).getTime()) : 0;
        const timeB = b.createdAt ? (typeof b.createdAt === 'number' ? b.createdAt : new Date(b.createdAt).getTime()) : 0;
        return timeB - timeA;
      });

    const ordersPerPage = 10;

    // Pending orders pagination
    const totalPendingPages = Math.max(1, Math.ceil(pendingOrders.length / ordersPerPage));
    const safePendingPage = Math.min(Math.max(1, pendingOrderPage), totalPendingPages);
    const paginatedPendingOrders = pendingOrders.slice((safePendingPage - 1) * ordersPerPage, safePendingPage * ordersPerPage);

    // Completed orders pagination
    const totalCompletedPages = Math.max(1, Math.ceil(completedOrders.length / ordersPerPage));
    const safeCompletedPage = Math.min(Math.max(1, completedOrderPage), totalCompletedPages);
    const paginatedCompletedOrders = completedOrders.slice((safeCompletedPage - 1) * ordersPerPage, safeCompletedPage * ordersPerPage);

    const renderPaginationBar = (
      currentPage: number,
      totalPages: number,
      totalItems: number,
      itemsLabel: string,
      onPageChange: (page: number) => void
    ) => {
      if (totalPages <= 1) return null;

      const startItem = (currentPage - 1) * ordersPerPage + 1;
      const endItem = Math.min(currentPage * ordersPerPage, totalItems);

      const pages: (number | string)[] = [];
      if (totalPages <= 7) {
        for (let i = 1; i <= totalPages; i++) pages.push(i);
      } else {
        pages.push(1);
        if (currentPage > 3) pages.push('...');
        const start = Math.max(2, currentPage - 1);
        const end = Math.min(totalPages - 1, currentPage + 1);
        for (let i = start; i <= end; i++) pages.push(i);
        if (currentPage < totalPages - 2) pages.push('...');
        pages.push(totalPages);
      }

      return (
        <div className="p-4 border-t bg-stone-50/80 flex flex-col sm:flex-row items-center justify-between gap-3 select-none">
          <div className="text-xs text-stone-500 font-medium">
            Exibindo <span className="font-bold text-stone-800">{startItem}</span> a <span className="font-bold text-stone-800">{endItem}</span> de <span className="font-bold text-stone-800">{totalItems}</span> {itemsLabel} (10 por página)
          </div>
          <div className="flex items-center gap-1.5 flex-wrap justify-center">
            <button
              type="button"
              disabled={currentPage <= 1}
              onClick={() => onPageChange(Math.max(1, currentPage - 1))}
              className="px-3 py-1.5 bg-white border border-stone-200 rounded-lg text-xs font-bold text-stone-700 hover:bg-stone-50 disabled:opacity-40 disabled:cursor-not-allowed transition-colors shadow-xs flex items-center gap-1 cursor-pointer"
              title="Página anterior"
            >
              <ChevronLeft className="w-3.5 h-3.5" /> Anterior
            </button>

            {pages.map((p, idx) => {
              if (p === '...') {
                return <span key={`gap-${idx}`} className="px-1 text-xs text-stone-400 font-bold">...</span>;
              }
              const pageNum = p as number;
              const isActive = pageNum === currentPage;
              return (
                <button
                  key={pageNum}
                  type="button"
                  onClick={() => onPageChange(pageNum)}
                  className={`w-8 h-8 rounded-lg text-xs font-bold transition-all cursor-pointer ${
                    isActive
                      ? 'bg-orange-600 text-white shadow-xs'
                      : 'bg-white border border-stone-200 text-stone-700 hover:bg-stone-50'
                  }`}
                >
                  {pageNum}
                </button>
              );
            })}

            <button
              type="button"
              disabled={currentPage >= totalPages}
              onClick={() => onPageChange(Math.min(totalPages, currentPage + 1))}
              className="px-3 py-1.5 bg-white border border-stone-200 rounded-lg text-xs font-bold text-stone-700 hover:bg-stone-50 disabled:opacity-40 disabled:cursor-not-allowed transition-colors shadow-xs flex items-center gap-1 cursor-pointer"
              title="Próxima página"
            >
              Próxima <ChevronRight className="w-3.5 h-3.5" />
            </button>
          </div>
        </div>
      );
    };

    return (
      <div className="space-y-8">
        <div className="flex flex-col md:flex-row md:items-center justify-between gap-4">
          <div>
            <h2 className="text-3xl font-bold text-stone-800">Gerenciamento de Pedidos</h2>
            <p className="text-stone-500">Acompanhe e atualize o status dos pedidos em tempo real.</p>
          </div>
          <div className="flex items-center gap-3 flex-wrap">
            <button
              type="button"
              onClick={() => handleToggleSound()}
              className={`flex items-center gap-2 px-4 py-2.5 rounded-xl text-sm font-bold border transition-all shadow-xs cursor-pointer ${
                isSoundEnabled 
                  ? 'bg-emerald-50 text-emerald-700 border-emerald-300 hover:bg-emerald-100 ring-1 ring-emerald-400/30' 
                  : 'bg-stone-100 text-stone-600 border-stone-300 hover:bg-stone-200'
              }`}
              title="Clique para ativar/desativar o alarme sonoro de novos pedidos"
            >
              {isSoundEnabled ? <Volume2 className="w-4 h-4 text-emerald-600 shrink-0" /> : <VolumeX className="w-4 h-4 text-stone-500 shrink-0" />}
              <span>Alarme de Pedidos: <strong className={isSoundEnabled ? 'text-emerald-700' : 'text-stone-600'}>{isSoundEnabled ? 'ON (Ativado)' : 'OFF (Mudo)'}</strong></span>
            </button>

            {!isOnline && (
              <div className="flex items-center gap-2 px-4 py-2 rounded-full text-sm font-bold bg-red-100 text-red-700 border border-red-200">
                <AlertCircle className="w-4 h-4" />
                Sistema Offline (Verifique sua conexão)
              </div>
            )}
            <div className={`flex items-center gap-2 px-4 py-2 rounded-full text-sm font-bold ${isOnline && orders.length > 0 ? 'bg-green-100 text-green-700' : 'bg-stone-100 text-stone-500'}`}>
              <div className={`w-2 h-2 rounded-full ${isOnline && orders.length > 0 ? 'bg-green-500 animate-pulse' : 'bg-stone-400'}`}></div>
              {isOnline ? (orders.length > 0 ? 'Conectado: Recebendo Pedidos' : 'Aguardando Pedidos...') : 'Desconectado'}
            </div>
          </div>
        </div>

        {/* Search & Channel Filters */}
        <div className="bg-white p-4 rounded-xl border border-stone-200 shadow-xs flex flex-col md:flex-row items-center justify-between gap-4">
          <div className="relative w-full md:w-80">
            <Search className="w-4 h-4 text-stone-400 absolute left-3 top-1/2 -translate-y-1/2" />
            <input
              type="text"
              placeholder="Buscar por nº, cliente, telefone ou item..."
              value={orderSearchQuery}
              onChange={(e) => {
                setOrderSearchQuery(e.target.value);
                setPendingOrderPage(1);
                setCompletedOrderPage(1);
              }}
              className="w-full pl-9 pr-8 py-2 bg-stone-50 border border-stone-200 rounded-xl text-xs font-medium text-stone-800 placeholder:text-stone-400 focus:bg-white focus:ring-2 focus:ring-orange-500 focus:border-transparent outline-none transition-all"
            />
            {orderSearchQuery && (
              <button
                type="button"
                onClick={() => {
                  setOrderSearchQuery('');
                  setPendingOrderPage(1);
                  setCompletedOrderPage(1);
                }}
                className="absolute right-2.5 top-1/2 -translate-y-1/2 text-stone-400 hover:text-stone-600 p-1 cursor-pointer"
                title="Limpar busca"
              >
                <X className="w-3.5 h-3.5" />
              </button>
            )}
          </div>

          <div className="flex items-center gap-2 w-full md:w-auto overflow-x-auto pb-1 md:pb-0">
            <span className="text-xs text-stone-500 font-bold shrink-0">Canal:</span>
            {[
              { id: 'all', label: 'Todos os Canais' },
              { id: 'pickup', label: '🏬 Retirada Balcão' },
              { id: 'instore', label: '🍽️ Consumo Mesa' },
              { id: 'kiosk', label: '📱 Totem' },
            ].map(channel => (
              <button
                key={channel.id}
                type="button"
                onClick={() => {
                  setOrderChannelFilter(channel.id as any);
                  setPendingOrderPage(1);
                  setCompletedOrderPage(1);
                }}
                className={`px-3 py-1.5 rounded-lg text-xs font-bold transition-all whitespace-nowrap cursor-pointer ${
                  orderChannelFilter === channel.id
                    ? 'bg-orange-600 text-white shadow-xs'
                    : 'bg-stone-100 text-stone-600 hover:bg-stone-200'
                }`}
              >
                {channel.label}
              </button>
            ))}
          </div>
        </div>

        {/* CONFIGURAÇÃO DE IMPRESSÃO (Colapsável) */}
        <div className="bg-white rounded-2xl shadow-xs border border-stone-200 overflow-hidden transition-all">
          <button
            type="button"
            onClick={() => setShowPrintConfig(!showPrintConfig)}
            className="w-full p-4 sm:p-5 flex items-center justify-between text-left hover:bg-stone-50/80 transition-colors cursor-pointer"
          >
            <div className="flex items-center gap-3.5">
              <div className="p-2.5 rounded-xl bg-orange-50 text-orange-600">
                <Printer className="w-5 h-5" />
              </div>
              <div>
                <h3 className="text-base font-bold text-stone-800">CONFIGURAÇÃO DE IMPRESSÃO</h3>
                <p className="text-xs text-stone-500 mt-0.5">
                  Gerencie as impressoras do caixa e do balcão para os pedidos
                </p>
              </div>
            </div>

            <div className="flex items-center gap-2 shrink-0 ml-3">
              <span className="hidden sm:inline-block text-xs font-medium text-stone-400">
                {showPrintConfig ? 'Recolher' : 'Expandir'}
              </span>
              <div className={`w-8 h-8 rounded-lg flex items-center justify-center transition-transform duration-200 ${showPrintConfig ? 'bg-orange-100 text-orange-700 rotate-180' : 'bg-stone-100 text-stone-600'}`}>
                <ChevronDown className="w-4 h-4" />
              </div>
            </div>
          </button>

          <div className={`${showPrintConfig ? 'block' : 'hidden'} border-t border-stone-100`}>
            <div className="p-4 sm:p-5">
              <CaixaPrinterStationCard 
                storeInfo={storeInfo} 
                onUpdateStoreInfo={updateStoreInfo} 
                currentUserEmail={currentUser?.email} 
                isCaixaUser={isCaixaUser} 
              />
            </div>
          </div>
        </div>

        {ordersError && (
          <div className="bg-red-50 border border-red-200 p-6 rounded-2xl text-center mb-8">
            <AlertCircle className="w-12 h-12 text-red-500 mx-auto mb-4" />
            <h3 className="text-lg font-bold text-red-800 mb-2">Erro de Permissão</h3>
            <p className="text-red-600 max-w-md mx-auto">
              O Google recusou o acesso aos pedidos: <strong>{ordersError}</strong>. 
              Isso confirma que o seu e-mail não está sendo reconhecido como administrador pelas regras de segurança.
            </p>
            <button type="button" 
              onClick={() => window.location.reload()}
              className="mt-4 px-6 py-2 bg-red-600 text-white rounded-xl font-bold hover:bg-red-700 transition-all"
            >
              Tentar Novamente
            </button>
          </div>
        )}

        {orders.length === 0 && !ordersError && (
          <div className="bg-orange-50 border border-orange-200 p-6 rounded-2xl text-center mb-6">
            <AlertCircle className="w-12 h-12 text-orange-500 mx-auto mb-4" />
            <h3 className="text-lg font-bold text-stone-800 mb-2">Nenhum pedido encontrado na lista atual</h3>
            <p className="text-stone-600 max-w-md mx-auto text-sm leading-relaxed mb-4">
              Se você acabou de fazer um pedido de teste ou acabou de realizar um deploy, clique no botão abaixo para buscar os pedidos diretamente do servidor e do banco de dados.
            </p>
            <div className="flex items-center justify-center gap-3 flex-wrap">
              <button 
                type="button" 
                onClick={async () => {
                  setIsSyncingOrdersNow(true);
                  try {
                    await fetch('/api/db/force-hydrate', { method: 'POST' }).catch(() => {});
                    await fetchData();
                  } finally {
                    setIsSyncingOrdersNow(false);
                  }
                }}
                disabled={isSyncingOrdersNow}
                className="px-6 py-2.5 bg-orange-600 hover:bg-orange-700 active:scale-95 text-white rounded-xl font-bold transition-all shadow-sm flex items-center gap-2 cursor-pointer disabled:opacity-50"
              >
                <RefreshCw className={`w-4 h-4 ${isSyncingOrdersNow ? 'animate-spin' : ''}`} />
                <span>{isSyncingOrdersNow ? 'Buscando Pedidos...' : 'Buscar Pedidos do Servidor Agora'}</span>
              </button>
              <button 
                type="button" 
                onClick={() => window.location.reload()}
                className="px-5 py-2.5 bg-stone-800 hover:bg-stone-900 active:scale-95 text-white rounded-xl font-bold transition-all cursor-pointer"
              >
                Recarregar Página
              </button>
            </div>
          </div>
        )}
        <div>
          <div className="flex flex-col sm:flex-row justify-between items-start sm:items-center gap-3 mb-6 bg-white p-4 rounded-2xl shadow-sm border border-stone-100">
            <div>
              <h2 className="text-xl font-bold text-stone-800">Gerenciamento de Pedidos</h2>
              <p className="text-xs text-stone-500 mt-0.5">Visualize e controle os pedidos recebidos de todos os canais.</p>
            </div>
            <div className="flex flex-wrap items-center gap-2">
              <button
                type="button"
                onClick={() => openPaymentAuditWithMaster(null)}
                className="bg-stone-900 hover:bg-stone-800 text-amber-300 border border-amber-400/40 px-4 py-2.5 rounded-xl text-xs font-black transition-all shadow-sm flex items-center gap-1.5 cursor-pointer"
                title="Consultar quem confirmou/liberou pagamentos online (exige senha Master)"
              >
                <ShieldCheck className="w-4 h-4 text-amber-400" />
                <span>Auditoria de Liberações (Master)</span>
              </button>
              <button
                type="button"
                onClick={() => {
                  setMasterAuthModal({
                    action: 'clear_all_orders',
                    title: 'Zerar Todos os Pedidos (Master)',
                    description: 'Esta ação apagará TODOS os pedidos do sistema permanentemente para começar um novo dia. Informe a senha Master para autorizar.',
                    password: '',
                    showPassword: false,
                    error: null,
                    isSubmitting: false
                  });
                }}
                className="bg-red-600 hover:bg-red-700 text-white px-4 py-2.5 rounded-xl text-xs font-bold transition-all shadow-sm flex items-center gap-1.5 cursor-pointer"
              >
                <Trash2 className="w-4 h-4" /> Zerar Todos os Pedidos
              </button>
            </div>
          </div>
          {/* ABAS SEPARADAS POR DIA COM CORES ESPECÍFICAS */}
          <div className="mb-6 bg-stone-50/80 p-3.5 rounded-2xl border border-stone-200/90 shadow-xs">
            <div className="flex items-center justify-between gap-2 mb-2.5 px-1 flex-wrap">
              <span className="text-xs font-black uppercase tracking-wider text-stone-900 flex items-center gap-1.5">
                <CalendarDays className="w-4 h-4 text-orange-600" />
                <span>Filtrar Pedidos por Dia de Retirada ({allPendingOrders.length}):</span>
              </span>
              <div className="flex items-center gap-2 text-[11px] font-medium text-stone-500">
                <span className="hidden md:inline">Cores por dia:</span>
                <span className="inline-flex items-center gap-1.5 bg-white px-2 py-0.5 rounded-full border border-stone-200 text-[10px] font-bold text-stone-600">
                  <span className="w-2 h-2 rounded-full bg-sky-500 inline-block"></span> Seg
                  <span className="w-2 h-2 rounded-full bg-emerald-500 inline-block ml-1"></span> Ter
                  <span className="w-2 h-2 rounded-full bg-amber-500 inline-block ml-1"></span> Qua
                  <span className="w-2 h-2 rounded-full bg-purple-500 inline-block ml-1"></span> Qui
                  <span className="w-2 h-2 rounded-full bg-indigo-500 inline-block ml-1"></span> Sex
                  <span className="w-2 h-2 rounded-full bg-fuchsia-500 inline-block ml-1"></span> Sáb
                  <span className="w-2 h-2 rounded-full bg-rose-500 inline-block ml-1"></span> Dom
                </span>
              </div>
            </div>
            <div className="flex items-center gap-2 overflow-x-auto pb-1 scrollbar-none">
              {dateTabs.map(tab => {
                const isActive = selectedOrderDateTab === tab.key;
                const theme = tab.theme;
                return (
                  <button
                    key={tab.key}
                    type="button"
                    onClick={() => {
                      setSelectedOrderDateTab(tab.key);
                      setPendingOrderPage(1);
                    }}
                    className={`flex items-center gap-2 px-4 py-2.5 rounded-xl text-xs font-bold transition-all whitespace-nowrap cursor-pointer shrink-0 border select-none ${
                      isActive
                        ? `${theme.tabActive} scale-102`
                        : `${theme.tabInactive}`
                    }`}
                  >
                    <span className="flex items-center gap-1.5">
                      <span>{theme.emoji}</span>
                      <span>{tab.label}</span>
                    </span>
                    <span className={`px-2 py-0.5 rounded-full text-[11px] font-black ${
                      isActive ? theme.badgeActive : theme.badgeInactive
                    }`}>
                      {tab.count}
                    </span>
                  </button>
                );
              })}
            </div>
          </div>

          <div className="flex items-center justify-between mb-4">
            <h2 className="text-2xl font-bold text-stone-800 flex items-center gap-2">
              <Clock className="w-6 h-6 text-orange-600" /> Pedidos em Andamento
              <span className="text-xs bg-orange-100 text-orange-800 font-extrabold px-2.5 py-0.5 rounded-full">
                {pendingOrders.length}
              </span>
            </h2>
            {totalPendingPages > 1 && (
              <span className="text-xs text-stone-500 font-medium">
                Página {safePendingPage} de {totalPendingPages}
              </span>
            )}
          </div>
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
            {pendingOrders.length === 0 ? (
              <p className="text-stone-500 col-span-full py-6 text-center bg-stone-50 rounded-xl border border-dashed border-stone-200">
                {orderSearchQuery || orderChannelFilter !== 'all' ? 'Nenhum pedido em andamento com estes filtros.' : 'Nenhum pedido em andamento.'}
              </p>
            ) : (
              paginatedPendingOrders.map(order => {
                const pickupTs = getEffectivePickupTimestamp(order);
                const diffMinutes = Math.round((pickupTs - nowTime) / (60 * 1000));
                // Faltando 30 minutos ou menos para a retirada (ou já no horário/atrasado)
                const isDueWithin30Mins = diffMinutes <= 30 && order.status !== 'completed' && order.status !== 'cancelled';

                const dayInfo = getOrderDateInfo(order);
                const dayTheme = dayInfo.theme;

                return (
                  <div 
                    key={order.id} 
                    className={`bg-white rounded-xl shadow-sm border-2 overflow-hidden flex flex-col transition-all ${
                      isDueWithin30Mins 
                        ? 'border-4 border-red-600 ring-4 ring-red-500/50 bg-red-50 shadow-2xl scale-[1.02] z-10 animate-pulse' 
                        : (order.type === 'kiosk' ? 'border-blue-400 ring-2 ring-blue-100' : `${dayTheme.cardBorder}`)
                    }`}
                    style={isDueWithin30Mins ? { animationDuration: '1s' } : {}}
                  >
                    {/* BANNER PULSANTE: FALTANDO 30 MINUTOS PARA RETIRADA */}
                    {isDueWithin30Mins && (
                      <div className="bg-gradient-to-r from-red-600 via-amber-600 to-red-600 text-white font-black text-xs px-3 py-2 flex items-center justify-between gap-2 border-b border-red-700 animate-pulse">
                        <div className="flex items-center gap-1.5">
                          <Clock className="w-4 h-4 text-amber-300 animate-spin" />
                          <span className="uppercase tracking-wider">⏰ PRÓXIMO PEDIDO A ENTREGAR</span>
                        </div>
                        <span className="bg-white text-red-700 px-2.5 py-0.5 rounded-full font-black text-[11px] shadow-sm uppercase tracking-wide">
                          {diffMinutes > 0 ? `FALTAM ${diffMinutes} MIN` : 'RETIRADA AGORA / ATRASADO'}
                        </span>
                      </div>
                    )}
                  <div className={`p-4 text-white font-bold flex justify-between items-center ${
                    order.type === 'kiosk' 
                      ? 'bg-blue-600' 
                      : dayTheme.cardHeaderBg
                  }`}>
                    <div>
                      <div className="flex items-center gap-2 flex-wrap">
                        <span className="text-base font-extrabold tracking-wide">Pedido #{String(order.id).slice(-4).padStart(4, '0')}</span>
                        <span className="text-[10px] font-black uppercase px-2 py-0.5 rounded-full bg-white/20 backdrop-blur-xs text-white border border-white/30 flex items-center gap-1 shadow-xs">
                          <span>{dayTheme.emoji}</span>
                          <span>{dayInfo.isToday ? `Hoje (${dayInfo.formattedDate})` : dayInfo.isTomorrow ? `Amanhã (${dayInfo.formattedDate})` : `${dayInfo.dayShortName}, ${dayInfo.formattedDate}`}</span>
                        </span>
                        {order.tableNumber && (
                          <span className="text-xs bg-amber-400 text-stone-900 font-black px-2 py-0.5 rounded-full shadow-xs flex items-center gap-1">
                            🍽️ Mesa {order.tableNumber}
                          </span>
                        )}
                      </div>
                      <div className="text-xs opacity-95 font-medium mt-1">Cliente: {order.customerName}</div>
                    </div>
                    <span className="text-xs bg-white/25 backdrop-blur-xs px-2.5 py-1 rounded-full font-bold shadow-xs">
                      {order.status === 'pending' ? '🟡 Pendente' :
                       order.status === 'preparing' ? '🟠 Preparando' :
                       (order.status === 'ready' || order.status === 'ready_for_pickup' || order.status === 'ready_for_delivery' || order.status === 'out_for_delivery') ? '🟢 Pedido Pronto' :
                       order.status === 'completed' ? '✅ Entregue' :
                       order.status === 'cancelled' ? '🔴 Cancelado' :
                       order.type === 'kiosk' ? '📱 Totem' : order.tableNumber ? '🍽️ Mesa' : '🏬 Retirada'}
                    </span>
                  </div>
                  <div className="p-4 flex-1">
                    <div className="text-sm text-stone-500 mb-2 flex items-center justify-between gap-2 flex-wrap">
                      <span>{(order.createdAt && !isNaN(new Date(order.createdAt).getTime())) ? new Date(order.createdAt).toLocaleTimeString() : '--:--'} • {order.paymentMethod}</span>
                      {(order.isPrinted || order.printedAt || order.autoPrinted90Min) && (
                        <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-md bg-stone-100 border border-stone-300 text-stone-700 text-[10px] font-black uppercase tracking-wide">
                          <Printer className="w-3 h-3 text-emerald-700" /> Impresso • Acréscimo Bloqueado
                        </span>
                      )}
                    </div>
                    {(() => {
                      const pb = getOrderPaymentBreakdown(order);
                      const needsPayConfirm = requiresOperatorPaymentConfirmation(order);
                      const shouldPulseRed = (pb.kind === 'pay_on_pickup' || pb.kind === 'partial_50') && order.status !== 'completed' && order.status !== 'cancelled';
                      return (
                        <div className="space-y-2.5 mb-3">
                          <div className={`px-3 py-2.5 rounded-xl border-2 text-xs shadow-2xs space-y-1 transition-all ${
                            shouldPulseRed
                              ? 'bg-red-600 border-red-800 text-white animate-pulse shadow-lg shadow-red-600/35 ring-2 ring-red-400/80'
                              : pb.kind === 'partial_50'
                              ? 'bg-amber-50 border-amber-400 text-amber-950'
                              : pb.kind === 'paid_full'
                              ? 'bg-emerald-50 border-emerald-400 text-emerald-950'
                              : 'bg-orange-50 border-orange-300 text-orange-950'
                          }`}>
                            <div className="font-black uppercase tracking-tight flex items-center justify-between gap-2 flex-wrap">
                              <span className="inline-flex items-center gap-2">
                                {shouldPulseRed && (
                                  <span className="relative flex h-2.5 w-2.5 shrink-0">
                                    <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-white opacity-80" />
                                    <span className="relative inline-flex rounded-full h-2.5 w-2.5 bg-white" />
                                  </span>
                                )}
                                <span>{pb.operatorTitle}</span>
                              </span>
                              {order.paymentConfirmedByOperator === true && (
                                <span className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] font-black shadow-2xs ${
                                  shouldPulseRed
                                    ? 'bg-emerald-500 text-white border border-white/30'
                                    : 'bg-emerald-600 text-white'
                                }`}>
                                  <ShieldCheck className="w-3 h-3" />
                                  {pb.kind === 'partial_50' ? '50% CONFIRMADO' : 'PAGAMENTO CONFIRMADO'}
                                </span>
                              )}
                            </div>
                            <p className={`text-[11px] font-semibold leading-snug ${shouldPulseRed ? 'text-red-50' : 'opacity-95'}`}>
                              {pb.operatorMessage}
                            </p>
                            {order.paymentConfirmedByOperator === true && (
                              <div className="flex items-center justify-between gap-2 flex-wrap pt-1">
                                <p className={`text-[10px] font-bold ${shouldPulseRed ? 'text-red-100' : 'text-emerald-800'}`}>
                                  ✓ Recebimento validado{order.paymentConfirmedAt ? ` em ${new Date(order.paymentConfirmedAt).toLocaleString('pt-BR', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' })}` : ''} • Liberado para produção.
                                </p>
                                <button
                                  type="button"
                                  onClick={() => openPaymentAuditWithMaster(order.id)}
                                  className="inline-flex items-center gap-1 px-2 py-0.5 rounded-md bg-stone-900 hover:bg-stone-800 text-amber-300 text-[10px] font-black uppercase tracking-wide transition-colors cursor-pointer shadow-2xs"
                                  title="Exige senha Master para consultar quem confirmou este pagamento"
                                >
                                  <Lock className="w-2.5 h-2.5" />
                                  Ver Responsável (Master)
                                </button>
                              </div>
                            )}
                          </div>

                          {needsPayConfirm && (
                            <div className="bg-rose-50 border-2 border-rose-400 rounded-xl p-3 space-y-2 shadow-xs">
                              <div className="flex items-start gap-2 text-rose-950">
                                <Lock className="w-4 h-4 text-rose-600 shrink-0 mt-0.5" />
                                <div className="text-xs leading-snug">
                                  <p className="font-black uppercase tracking-wide text-rose-800">
                                    {pb.kind === 'partial_50'
                                      ? 'AGUARDANDO CONFIRMAÇÃO DO PAGAMENTO (50%)'
                                      : 'AGUARDANDO CONFIRMAÇÃO DO PAGAMENTO INTEGRAL'}
                                  </p>
                                  <p className="text-[11px] font-semibold text-rose-900 mt-0.5">
                                    {pb.kind === 'partial_50'
                                      ? `Verifique se o valor de entrada (${formatBRL(pb.paidAmount)}) entrou no Pix/Débito antes de liberar este pedido para produção.`
                                      : `Verifique se o valor integral (${formatBRL(pb.totalAmount)}) entrou no Pix/Cartão antes de liberar este pedido para produção.`}
                                  </p>
                                </div>
                              </div>
                              <button
                                type="button"
                                onClick={() => openPaymentConfirmModal(order)}
                                className="w-full py-2.5 px-3 bg-emerald-600 hover:bg-emerald-700 text-white rounded-lg font-black text-xs uppercase tracking-wider flex items-center justify-center gap-2 shadow-sm transition-colors cursor-pointer"
                              >
                                <ShieldCheck className="w-4 h-4" />
                                CONFIRMAR PAGAMENTO
                              </button>
                            </div>
                          )}
                        </div>
                      );
                    })()}
                    {(order.scheduledTime || (order as any).scheduled_time) && (
                      <div className={`mb-3 px-3 py-2 rounded-xl flex items-center justify-between gap-2 text-xs font-bold border ${dayTheme.cardScheduleBg}`}>
                        <div className="flex items-center gap-2">
                          <Clock className={`w-4 h-4 shrink-0 ${dayTheme.cardScheduleIcon}`} />
                          <span>Agendamento: <strong className="font-mono font-black">{formatDateBR(order.scheduledDay || order.scheduledDate) || 'Hoje'} às {order.scheduledTime || (order as any).scheduled_time}</strong></span>
                        </div>
                        <span className={`text-[10px] font-black uppercase px-2 py-0.5 rounded-md border shadow-xs ${dayTheme.accentBadge}`}>
                          {dayTheme.shortName}
                        </span>
                      </div>
                    )}
                    <ul className="space-y-2 mb-4">
                      {(Array.isArray(order.items) ? order.items : []).map((item, idx) => {
                        const itemCode = resolveItemCode(item);
                        return (
                          <li key={idx} className="flex justify-between text-sm items-start">
                            <div>
                              <span>
                                <span className="font-bold">{item.quantity}x</span> {item.name}
                              </span>
                              {item.prepLabel && (
                                <div className={`text-[10px] font-black pl-2 py-0.5 rounded-sm my-0.5 flex items-center gap-1 ${
                                  item.isFrozen || item.prepType?.startsWith('congelado')
                                    ? 'text-blue-700 bg-blue-50 border-l-2 border-blue-500'
                                    : 'text-amber-800 bg-amber-50 border-l-2 border-amber-500'
                                }`}>
                                  <span>{item.isFrozen || item.prepType?.startsWith('congelado') ? '❄️' : '🔥'}</span>
                                  <span>{item.prepLabel}</span>
                                </div>
                              )}
                              {itemCode && (
                                <span className="ml-1.5 inline-block px-1.5 py-0.2 bg-stone-100 border border-stone-300 rounded text-[10px] font-mono font-bold text-stone-700">
                                  CÓD: {itemCode}
                                </span>
                              )}
                              {item.flavor && (
                                <div className={`text-[11px] italic pl-3 py-0.5 rounded-sm my-0.5 ${
                                  (item.flavor.name || '').toLowerCase().includes('congelado') || (item.flavor.name || '').toLowerCase().includes('normal')
                                    ? 'text-red-700 font-black bg-red-50 border-l-2 border-red-500'
                                    : 'text-stone-500 font-medium'
                                }`}>
                                  + Sabor: {item.flavor.name}
                                  {resolveAddonCode(item.flavor) && (
                                    <span className="ml-1.5 inline-block px-1 py-0.1 bg-stone-100 border border-stone-200 rounded text-[9px] font-mono font-bold text-stone-700">
                                      CÓD: {resolveAddonCode(item.flavor)}
                                    </span>
                                  )}
                                </div>
                              )}
                              {item.addons && item.addons.length > 0 && (
                                <div className="text-[11px] italic pl-3 space-y-0.5 mt-0.5">
                                  {item.addons.map((a, aIdx) => {
                                    const aCode = resolveAddonCode(a);
                                    const isHighlight = (a.name || '').toLowerCase().includes('congelado') || (a.name || '').toLowerCase().includes('normal');
                                    return (
                                      <div key={aIdx} className={`flex items-center gap-1 py-0.5 rounded-sm px-1 ${isHighlight ? 'text-red-700 font-black bg-red-50 border-l-2 border-red-500' : 'text-stone-500 font-medium'}`}>
                                        <span>+ {a.name}</span>
                                        {aCode && (
                                          <span className="px-1 py-0.1 bg-stone-100 border border-stone-200 rounded text-[9px] font-mono font-bold text-stone-700">
                                            CÓD: {aCode}
                                          </span>
                                        )}
                                      </div>
                                    );
                                  })}
                                </div>
                              )}
                            </div>
                          </li>
                        );
                      })}
                    </ul>
                    <div className="border-t pt-2 font-black text-right text-lg text-stone-900 flex justify-between items-center">
                      <span className="text-xs font-bold text-stone-500 uppercase tracking-wider">TOTAL DO PEDIDO:</span>
                      <span>{formatCurrency(order.total)}</span>
                    </div>
                  </div>
                  <div className="p-4 bg-stone-50 border-t flex flex-col gap-2.5">
                    {(() => {
                      const needsPayConfirm = requiresOperatorPaymentConfirmation(order);
                      const isPartial50Action = getOrderPaymentBreakdown(order).kind === 'partial_50';
                      return (
                        <>
                    {/* Seletor Rápido de Todas as Etapas Solicitadas */}
                    <div className="bg-white p-2.5 rounded-xl border border-stone-200 shadow-xs flex flex-col sm:flex-row items-start sm:items-center justify-between gap-2">
                      <label className="text-[11px] font-black uppercase text-stone-600 tracking-wider flex items-center gap-1.5 shrink-0">
                        <span>Etapa do Pedido:</span>
                      </label>
                      <select
                        value={(order.status === 'ready_for_pickup' || order.status === 'ready_for_delivery' || order.status === 'out_for_delivery') ? 'ready' : order.status}
                        onChange={(e) => handleUpdateOrderStatus(order.id, e.target.value as Order['status'])}
                        className="w-full sm:w-auto px-2.5 py-1.5 rounded-lg text-xs font-black bg-stone-50 border border-stone-300 text-stone-900 shadow-xs focus:bg-white focus:ring-2 focus:ring-orange-500 cursor-pointer"
                        title={
                          needsPayConfirm
                            ? (isPartial50Action
                                ? 'Confirme o pagamento de 50% antes de liberar para produção'
                                : 'Confirme o pagamento integral online antes de liberar para produção')
                            : 'Alterar etapa do pedido'
                        }
                      >
                        <option value="pending">🟡 PENDENTE</option>
                        <option value="preparing" disabled={needsPayConfirm}>
                          {needsPayConfirm ? '🔒 PREPARANDO (Confirme o pagamento)' : '🟠 PREPARANDO'}
                        </option>
                        <option value="ready" disabled={needsPayConfirm}>
                          {needsPayConfirm ? '🔒 PEDIDO PRONTO (Confirme o pagamento)' : '🟢 PEDIDO PRONTO'}
                        </option>
                        <option value="completed" disabled={needsPayConfirm}>
                          {needsPayConfirm ? '🔒 ENTREGUE (Confirme o pagamento)' : '✅ ENTREGUE'}
                        </option>
                        <option value="cancelled">🔴 CANCELADO</option>
                      </select>
                    </div>

                    <div className="flex flex-wrap items-center gap-2">
                      <button type="button" 
                        onClick={() => printOrder(order)}
                        className={`p-2 rounded-lg flex items-center justify-center transition-colors ${
                          (order.isPrinted || order.printedAt || order.autoPrinted90Min)
                            ? 'bg-emerald-100 text-emerald-800 hover:bg-emerald-200 border border-emerald-300'
                            : 'bg-stone-200 text-stone-700 hover:bg-stone-300'
                        }`}
                        title={(order.isPrinted || order.printedAt || order.autoPrinted90Min) ? 'Cupom já impresso (Reimprimir)' : 'Imprimir Cupom'}
                      >
                        <Printer className="w-5 h-5" />
                      </button>
                      <button type="button" 
                        onClick={() => handleCallOnTv(order)}
                        className="bg-amber-100 text-amber-900 px-3 py-2 rounded-lg hover:bg-amber-200 flex items-center justify-center gap-1.5 transition-colors font-bold text-xs shadow-xs"
                        title="Chamar Senha na TV com som e voz"
                      >
                        <Megaphone className="w-4 h-4 text-amber-700" />
                        <span>Chamar na TV</span>
                      </button>
                      {isAdminOrMaster && (
                        <button type="button" 
                          onClick={() => handleExportOrder(order)}
                          disabled={exportingOrderId === order.id}
                          className={`px-3 py-2 rounded-lg flex items-center justify-center gap-1.5 transition-colors disabled:opacity-50 font-bold text-xs shadow-xs ${
                            order.blueFocusExported
                              ? 'bg-emerald-100 text-emerald-800 hover:bg-emerald-200 border border-emerald-300'
                              : order.blueFocusExportError
                              ? 'bg-red-100 text-red-800 hover:bg-red-200 border border-red-300'
                              : 'bg-blue-600 text-white hover:bg-blue-700'
                          }`}
                          title={
                            order.blueFocusExported
                              ? `Já exportado para o BlueFocus${order.blueFocusExportedAt ? ` em ${new Date(order.blueFocusExportedAt).toLocaleString('pt-BR')}` : ''}. Clique se precisar reenviar.`
                              : order.blueFocusExportError
                              ? `Erro na última tentativa: ${order.blueFocusExportError}. Clique para tentar novamente.`
                              : 'Exportar este pedido como Pré-Venda para o BlueFocus'
                          }
                        >
                          {exportingOrderId === order.id ? (
                            <RefreshCw className="w-4 h-4 animate-spin" />
                          ) : order.blueFocusExported ? (
                            <CheckCircle2 className="w-4 h-4" />
                          ) : order.blueFocusExportError ? (
                            <AlertTriangle className="w-4 h-4" />
                          ) : (
                            <Upload className="w-4 h-4" />
                          )}
                          <span>
                            {exportingOrderId === order.id
                              ? 'Exportando...'
                              : order.blueFocusExported
                              ? 'Exportado ✓'
                              : order.blueFocusExportError
                              ? 'Tentar BlueFocus'
                              : 'Exportar BlueFocus'}
                          </span>
                        </button>
                      )}
                      {order.status === 'pending' && (
                        needsPayConfirm ? (
                          <button
                            type="button"
                            onClick={() => openPaymentConfirmModal(order)}
                            className="flex-1 bg-rose-100 text-rose-900 border border-rose-300 py-2 px-2.5 rounded-lg font-black text-xs hover:bg-rose-200 flex items-center justify-center gap-1.5 shadow-xs transition-colors cursor-pointer"
                            title={
                              isPartial50Action
                                ? 'Clique para confirmar o recebimento do pagamento (50%) com senha e liberar a produção'
                                : 'Clique para confirmar o recebimento do pagamento online integral com senha e liberar a produção'
                            }
                          >
                            <Lock className="w-3.5 h-3.5 text-rose-700" /> Produção Bloqueada
                          </button>
                        ) : (
                          <button type="button" 
                            onClick={() => handleUpdateOrderStatus(order.id, 'preparing')}
                            className="flex-1 bg-orange-600 text-white py-2 rounded-lg font-bold text-xs hover:bg-orange-700 flex items-center justify-center gap-1.5 shadow-xs transition-colors"
                          >
                            <ChefHat className="w-4 h-4" /> Preparando
                          </button>
                        )
                      )}
                      {order.status === 'preparing' && (
                        <div className="flex-1 flex gap-1.5">
                          <button type="button" 
                            onClick={() => handleUpdateOrderStatus(order.id, 'ready')}
                            className="flex-1 bg-emerald-600 text-white py-2 rounded-lg font-bold text-xs hover:bg-emerald-700 flex items-center justify-center gap-1.5 shadow-xs transition-colors"
                          >
                            <CheckCircle2 className="w-4 h-4" /> Pedido Pronto
                          </button>
                        </div>
                      )}
                      {(order.status === 'ready' || order.status === 'ready_for_pickup' || order.status === 'ready_for_delivery' || order.status === 'out_for_delivery') && (
                        <button type="button" 
                          onClick={() => handleUpdateOrderStatus(order.id, 'completed')}
                          className="flex-1 bg-emerald-600 text-white py-2 rounded-lg font-bold text-xs hover:bg-emerald-700 flex items-center justify-center gap-1.5 shadow-xs transition-colors"
                        >
                          <CheckCircle2 className="w-4 h-4" /> Marcar Entregue
                        </button>
                      )}
                      <button
                        onClick={() => handleCancelOrder(order.id)}
                        className="bg-red-100 text-red-600 p-2 rounded-lg hover:bg-red-200 flex items-center justify-center transition-colors"
                        title="Cancelar Pedido"
                      >
                        <XCircle className="w-5 h-5" />
                      </button>
                      {isAdminOrMaster && (
                        <button
                          onClick={() => handleDeleteOrder(order.id)}
                          className="bg-stone-200 text-stone-600 p-2 rounded-lg hover:bg-stone-300 flex items-center justify-center transition-colors"
                          title="Excluir Pedido"
                        >
                          <Trash2 className="w-5 h-5" />
                        </button>
                      )}
                    </div>
                        </>
                      );
                    })()}
                  </div>
                </div>
              ); })
            )}
          </div>
          {totalPendingPages > 1 && (
            <div className="mt-4 bg-white rounded-xl shadow-xs border border-stone-200 overflow-hidden">
              {renderPaginationBar(safePendingPage, totalPendingPages, pendingOrders.length, 'pedidos em andamento', setPendingOrderPage)}
            </div>
          )}
        </div>

        <div>
          <div className="flex items-center justify-between mb-4">
            <h2 className="text-2xl font-bold text-stone-800 flex items-center gap-2">
              <CheckCircle2 className="w-6 h-6 text-green-600" /> Pedidos Prontos / Concluídos
              <span className="text-xs bg-stone-100 text-stone-800 font-extrabold px-2.5 py-0.5 rounded-full">
                {completedOrders.length}
              </span>
            </h2>
            {totalCompletedPages > 1 && (
              <span className="text-xs text-stone-500 font-medium">
                Página {safeCompletedPage} de {totalCompletedPages}
              </span>
            )}
          </div>
          <div className="bg-white rounded-xl shadow-sm border border-stone-200 overflow-hidden">
            <div className="overflow-x-auto">
              <table className="w-full text-left text-sm">
                <thead className="bg-stone-50 text-stone-600 font-medium border-b">
                  <tr>
                    <th className="p-4">ID</th>
                    <th className="p-4">Cliente</th>
                    <th className="p-4">Horário</th>
                    <th className="p-4">Itens</th>
                    <th className="p-4">Tipo</th>
                    <th className="p-4">Total</th>
                    <th className="p-4">Status</th>
                    <th className="p-4">Ação</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-stone-100">
                  {paginatedCompletedOrders.map(order => (
                  <tr key={order.id} className="hover:bg-stone-50">
                    <td className="p-4 font-medium">#{String(order.id).slice(-4).padStart(4, '0')}</td>
                    <td className="p-4">{order.customerName}</td>
                    <td className="p-4">
                      <div>{(order.createdAt && !isNaN(new Date(order.createdAt).getTime())) ? new Date(order.createdAt).toLocaleTimeString() : '--:--'}</div>
                      {(order.scheduledTime || (order as any).scheduled_time) && (
                        <div className="text-[10px] font-bold text-amber-800 bg-amber-50 px-2 py-0.5 rounded border border-amber-300 mt-1 inline-flex items-center gap-1 shadow-2xs">
                          <span>⏰ {formatDateBR(order.scheduledDay || order.scheduledDate) || 'Hoje'} às {order.scheduledTime || (order as any).scheduled_time}</span>
                        </div>
                      )}
                    </td>
                    <td className="p-4 text-xs text-stone-500 max-w-[240px] truncate" title={(Array.isArray(order.items) ? order.items : []).map(item => {
                      const code = resolveItemCode(item);
                      const flavorStr = item.flavor ? ` (Sabor: ${item.flavor.name}${resolveAddonCode(item.flavor) ? ` [CÓD: ${resolveAddonCode(item.flavor)}]` : ''})` : '';
                      const addonsStr = item.addons && item.addons.length > 0 ? ` (+ ${item.addons.map(a => `${a.name}${resolveAddonCode(a) ? ` [CÓD: ${resolveAddonCode(a)}]` : ''}`).join(', ')})` : '';
                      return `${item.quantity}x ${item.name}${item.prepLabel ? ` [${item.prepLabel}]` : ''}${code ? ` [CÓD: ${code}]` : ''}${flavorStr}${addonsStr}`;
                    }).join(', ')}>
                      {(Array.isArray(order.items) ? order.items : []).map(item => {
                        const code = resolveItemCode(item);
                        const prepStr = item.prepLabel ? ` [${item.prepLabel}]` : '';
                        const flavorStr = item.flavor ? ` (Sabor: ${item.flavor.name}${resolveAddonCode(item.flavor) ? ` [CÓD: ${resolveAddonCode(item.flavor)}]` : ''})` : '';
                        const addonsStr = item.addons && item.addons.length > 0 ? ` (+ ${item.addons.map(a => `${a.name}${resolveAddonCode(a) ? ` [CÓD: ${resolveAddonCode(a)}]` : ''}`).join(', ')})` : '';
                        return `${item.quantity}x ${item.name}${prepStr}${code ? ` [CÓD: ${code}]` : ''}${flavorStr}${addonsStr}`;
                      }).join(', ')}
                    </td>
                    <td className="p-4 capitalize">
                      {order.type === 'kiosk' ? (
                        <span className="text-xs bg-blue-50 text-blue-700 px-2 py-0.5 rounded font-bold">Totem</span>
                      ) : order.tableNumber ? (
                        <span className="text-xs bg-amber-50 text-amber-800 px-2 py-0.5 rounded font-bold">Mesa {order.tableNumber}</span>
                      ) : (
                        <span className="text-xs bg-stone-100 text-stone-700 px-2 py-0.5 rounded font-bold">Retirada</span>
                      )}
                    </td>
                    <td className="p-4 font-medium">
                      <div className="font-bold text-stone-900">{formatCurrency(order.total)}</div>
                      {(() => {
                        const pb = getOrderPaymentBreakdown(order);
                        const shouldPulseRed = (pb.kind === 'pay_on_pickup' || pb.kind === 'partial_50') && order.status !== 'completed' && order.status !== 'cancelled';
                        return (
                          <div className="space-y-1 mt-1">
                            <div className={`inline-block px-2 py-0.5 rounded text-[10px] font-black border ${
                              shouldPulseRed
                                ? 'bg-red-600 text-white border-red-700 animate-pulse shadow-sm shadow-red-600/40 ring-2 ring-red-400/60'
                                : pb.kind === 'partial_50'
                                ? 'bg-amber-100 text-amber-900 border-amber-300'
                                : pb.kind === 'paid_full'
                                ? 'bg-emerald-100 text-emerald-800 border-emerald-300'
                                : 'bg-orange-100 text-orange-900 border-orange-300'
                            }`}>
                              {pb.operatorBadge}
                            </div>
                            {(order.paymentConfirmedByOperator === true || Boolean(order.paymentConfirmedAt)) && (
                              <div>
                                <button
                                  type="button"
                                  onClick={() => openPaymentAuditWithMaster(order.id)}
                                  className="inline-flex items-center gap-1 px-2 py-0.5 rounded bg-stone-900 hover:bg-stone-800 text-amber-300 text-[9px] font-black uppercase tracking-wide cursor-pointer"
                                  title="Consultar quem liberou o pagamento (exige senha Master)"
                                >
                                  <Lock className="w-2.5 h-2.5" />
                                  Ver Responsável (Master)
                                </button>
                              </div>
                            )}
                          </div>
                        );
                      })()}
                    </td>
                    <td className="p-4">
                      {(() => {
                        const needsPayConfirm = requiresOperatorPaymentConfirmation(order);
                        return (
                          <div className="space-y-1">
                            <select
                              value={(order.status === 'ready_for_pickup' || order.status === 'ready_for_delivery' || order.status === 'out_for_delivery') ? 'ready' : order.status}
                              onChange={(e) => handleUpdateOrderStatus(order.id, e.target.value as Order['status'])}
                              className={`px-2.5 py-1.5 rounded-lg text-xs font-black border cursor-pointer shadow-xs focus:ring-2 focus:ring-orange-500 ${
                                order.status === 'completed' ? 'bg-emerald-50 text-emerald-800 border-emerald-300' :
                                (order.status === 'ready' || order.status === 'ready_for_pickup' || order.status === 'ready_for_delivery' || order.status === 'out_for_delivery') ? 'bg-blue-50 text-blue-800 border-blue-300' :
                                order.status === 'preparing' ? 'bg-orange-50 text-orange-800 border-orange-300' :
                                order.status === 'pending' ? 'bg-amber-50 text-amber-800 border-amber-300' :
                                'bg-red-50 text-red-800 border-red-300'
                              }`}
                              title="Alterar etapa do pedido"
                            >
                              <option value="pending">🟡 Pendente</option>
                              <option value="preparing" disabled={needsPayConfirm}>{needsPayConfirm ? '🔒 Preparando' : '🟠 Preparando'}</option>
                              <option value="ready" disabled={needsPayConfirm}>{needsPayConfirm ? '🔒 Pedido Pronto' : '🟢 Pedido Pronto'}</option>
                              <option value="completed" disabled={needsPayConfirm}>{needsPayConfirm ? '🔒 Entregue' : '✅ Entregue'}</option>
                              <option value="cancelled">🔴 Cancelado</option>
                            </select>
                            {needsPayConfirm && (
                              <button
                                type="button"
                                onClick={() => openPaymentConfirmModal(order)}
                                className="px-2 py-1 rounded text-[10px] font-black bg-emerald-600 hover:bg-emerald-700 text-white flex items-center gap-1 cursor-pointer"
                              >
                                <ShieldCheck className="w-3 h-3" /> CONFIRMAR PAGAMENTO
                              </button>
                            )}
                          </div>
                        );
                      })()}
                    </td>
                    <td className="p-4 flex flex-wrap gap-2 items-center">
                      <button type="button" 
                        onClick={() => handleCallOnTv(order)}
                        className="text-amber-700 bg-amber-100 hover:bg-amber-200 px-2 py-1 rounded-md text-xs font-bold flex items-center gap-1 transition-colors"
                        title="Chamar Senha na TV"
                      >
                        <Megaphone className="w-3.5 h-3.5 text-amber-700" />
                        <span>Chamar TV</span>
                      </button>
                      <button type="button" 
                        onClick={() => printOrder(order)}
                        className="text-stone-500 hover:text-stone-700 p-1"
                        title="Imprimir Cupom"
                      >
                        <Printer className="w-4 h-4" />
                      </button>
                      {isAdminOrMaster && (
                        <button type="button" 
                          onClick={() => handleExportOrder(order)}
                          disabled={exportingOrderId === order.id}
                          className={`px-2.5 py-1 rounded-md text-xs font-bold flex items-center gap-1 transition-colors disabled:opacity-50 ${
                            order.blueFocusExported
                              ? 'bg-emerald-100 text-emerald-800 hover:bg-emerald-200 border border-emerald-300'
                              : order.blueFocusExportError
                              ? 'bg-red-100 text-red-800 hover:bg-red-200 border border-red-300'
                              : 'bg-blue-600 text-white hover:bg-blue-700'
                          }`}
                          title={
                            order.blueFocusExported
                              ? `Exportado para BlueFocus${order.blueFocusExportedAt ? ` em ${new Date(order.blueFocusExportedAt).toLocaleString('pt-BR')}` : ''} (Clique para reenviar)`
                              : order.blueFocusExportError
                              ? `Erro: ${order.blueFocusExportError} (Clique para tentar novamente)`
                              : 'Exportar para BlueFocus'
                          }
                        >
                          {exportingOrderId === order.id ? (
                            <RefreshCw className="w-3.5 h-3.5 animate-spin" />
                          ) : order.blueFocusExported ? (
                            <CheckCircle2 className="w-3.5 h-3.5" />
                          ) : order.blueFocusExportError ? (
                            <AlertTriangle className="w-3.5 h-3.5" />
                          ) : (
                            <Upload className="w-3.5 h-3.5" />
                          )}
                          <span>
                            {exportingOrderId === order.id
                              ? 'Enviando...'
                              : order.blueFocusExported
                              ? 'Exportado ✓'
                              : order.blueFocusExportError
                              ? 'Tentar ERP'
                              : 'Exportar BlueFocus'}
                          </span>
                        </button>
                      )}
                      {order.status !== 'cancelled' && (
                        <button
                          onClick={() => handleCancelOrder(order.id)}
                          className="text-red-500 hover:text-red-700 p-1"
                          title="Cancelar Pedido"
                        >
                          <XCircle className="w-4 h-4" />
                        </button>
                      )}
                      {isAdminOrMaster && (
                        <button
                          onClick={() => handleDeleteOrder(order.id)}
                          className="text-stone-400 hover:text-stone-600 p-1"
                          title="Excluir Pedido"
                        >
                          <Trash2 className="w-4 h-4" />
                        </button>
                      )}
                      {(order.status === 'ready' || order.status === 'ready_for_pickup' || order.status === 'ready_for_delivery' || order.status === 'out_for_delivery') && (
                        <button type="button" 
                          onClick={() => handleUpdateOrderStatus(order.id, 'completed')}
                          className="text-green-600 hover:text-green-800 font-medium ml-2"
                        >
                          Entregar
                        </button>
                      )}
                    </td>
                  </tr>
                ))}
                {completedOrders.length === 0 && (
                  <tr>
                    <td colSpan={8} className="p-8 text-center text-stone-500">
                      {orderSearchQuery || orderChannelFilter !== 'all' ? 'Nenhum pedido concluído com estes filtros.' : 'Nenhum pedido concluído.'}
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>

          {renderPaginationBar(safeCompletedPage, totalCompletedPages, completedOrders.length, 'pedidos concluídos', setCompletedOrderPage)}
        </div>
      </div>
    </div>
  );
};

  const handleToggleProductStatus = async (product: Product) => {
    console.log('Toggling product status for:', product.id, 'Current status:', product.isActive);
    try {
      console.log('Calling updateProduct...');
      await updateProduct(product.id, { isActive: !product.isActive });
      console.log('updateProduct succeeded!');
    } catch (error) {
      console.error('Error toggling product status:', error);
      setConfirmModal({
        isOpen: true,
        title: 'Erro',
        message: 'Não foi possível alterar o status do produto. Detalhes: ' + (error as Error).message,
        onConfirm: () => setConfirmModal(null)
      });
    }
  };

  const toggleCategoryVisibility = async (category: Category) => {
    try {
      await updateCategory(category.id, { isVisible: category.isVisible === false });
    } catch (error) {
      console.error('Error toggling category visibility:', error);
      showInfoModal('Erro', 'Erro ao alterar visibilidade da categoria.');
    }
  };

  const handleRestoreTotemCategories = async () => {
    const kioskAllowedKeywords = [
      'pães', 'salgados', 'doces & confeitaria', 'cafés & matinais', 'bebidas',
      'matinais', 'sucos', 'refeições', 'lanches especiais', 'lanches tradicionais',
      'producao propria', 'mercearia', 'sorvete', 'bombonier', 'petit four',
      'frios para fatiar', 'laticinios', 'elma chips', 'leite saquinho'
    ];

    const isKioskTarget = (catName: string) => {
      const norm = normalizeText(catName || '');
      if (isExcludedCategory(catName) || isAddonCategory(catName)) return false;
      return kioskAllowedKeywords.some(k => norm.includes(normalizeText(k)) || normalizeText(k).includes(norm));
    };

    try {
      for (const cat of categories) {
        const shouldBeOnTotem = isKioskTarget(cat.name);
        if (cat.availableForKiosk !== shouldBeOnTotem) {
          await updateCategory(cat.id, { availableForKiosk: shouldBeOnTotem });
        }
      }
      setConfirmModal({
        isOpen: true,
        title: 'Categorias do Totem Restauradas!',
        message: `As categorias do Totem foram redefinidas e travadas com sucesso!\n\nApenas as categorias do cardápio principal (Pães, Salgados, Doces, Cafés, Bebidas, Lanches, etc.) estão ativas no Totem. Suas configurações estão protegidas contra alterações do ERP.`,
        onConfirm: () => setConfirmModal(null)
      });
    } catch (e: any) {
      console.error('Error restoring totem categories:', e);
    }
  };

  const renderCategories = () => {
    const totemActiveCatsCount = categories.filter(c => !isExcludedCategory(c.name) && c.availableForKiosk !== false).length;

    return (
      <div>
        <div className="flex flex-col sm:flex-row justify-between items-start sm:items-center gap-4 mb-6">
          <div>
            <h2 className="text-2xl font-bold text-stone-800">Categorias</h2>
            <p className="text-xs text-stone-500 mt-0.5">
              Defina a ordem e a exibição das categorias por canal ({totemActiveCatsCount} ativas no Totem).
            </p>
          </div>
          <button type="button" 
            onClick={() => openModal('category')}
            className="bg-stone-800 text-white px-4 py-2 rounded-lg font-medium hover:bg-stone-900 flex items-center gap-2 cursor-pointer"
          >
            <Plus className="w-4 h-4" /> Nova Categoria
          </button>
        </div>

        {/* Card do Gerenciador / Bloqueador do Totem */}
        <div className="bg-blue-50/90 border border-blue-200/90 rounded-2xl p-4 mb-6 space-y-3 shadow-xs">
          <div className="flex flex-col md:flex-row md:items-center justify-between gap-4">
            <div className="flex items-center gap-3">
              <div className="w-10 h-10 rounded-xl bg-blue-600 text-white flex items-center justify-center font-bold text-xl shrink-0 shadow-xs">
                📱
              </div>
              <div>
                <h3 className="font-extrabold text-stone-900 text-sm flex items-center gap-2">
                  <span>Gerenciamento &amp; Trava de Categorias do Totem</span>
                  <span className="bg-blue-200 text-blue-900 text-[10px] font-black px-2 py-0.5 rounded-full uppercase">
                    {totemActiveCatsCount} Ativas
                  </span>
                </h3>
                <p className="text-xs text-stone-600 mt-0.5 max-w-2xl leading-relaxed">
                  Defina exatamente quais categorias aparecem no Totem de Autoatendimento. Para ativar ou desativar uma categoria no Totem, basta clicar no botão <strong>📱 Autoatendimento</strong> na tabela abaixo. Suas escolhas ficam <strong>salvas e protegidas</strong> contra redefinições de atualizações do ERP.
                </p>
              </div>
            </div>
            <div className="flex flex-wrap items-center gap-2 shrink-0">
              <button
                type="button"
                onClick={handleRestoreTotemCategories}
                className="px-3.5 py-2.5 bg-blue-600 hover:bg-blue-700 active:bg-blue-800 text-white text-xs font-extrabold rounded-xl transition-all shadow-xs flex items-center justify-center gap-2 cursor-pointer"
                title="Aplica e trava o padrão do Totem apenas para as categorias do cardápio principal"
              >
                <ShieldCheck className="w-4 h-4 text-blue-200" />
                <span>Restaurar &amp; Travar Padrão</span>
              </button>

              <button
                type="button"
                onClick={() => setIsTotemBackupModalOpen(true)}
                className="px-3.5 py-2.5 bg-stone-900 hover:bg-black text-white text-xs font-extrabold rounded-xl transition-all shadow-xs flex items-center justify-center gap-2 cursor-pointer"
                title="Acessar histórico de backups do Totem, criar novo backup ou restaurar de arquivo"
              >
                <span>📦</span>
                <span>Backups do Totem ({totemBackups.length})</span>
              </button>
            </div>
          </div>
        </div>

        <div className="bg-white rounded-xl shadow-sm border border-stone-200 overflow-hidden">
        <table className="w-full text-left text-sm">
          <thead className="bg-stone-50 text-stone-600 font-medium border-b">
            <tr>
              <th className="p-4">Ordem</th>
              <th className="p-4">Nome</th>
              <th className="p-4 text-right">Ações</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-stone-100">
            {categories
              .filter(c => !isExcludedCategory(c.name))
              .sort((a, b) => (a.name || '').localeCompare(b.name || '', 'pt-BR', { sensitivity: 'base' }))
              .map(category => (
              <tr key={category.id} className={`hover:bg-stone-50 ${category.isVisible === false ? 'bg-orange-50/40' : ''}`}>
                <td className="p-4 w-20 text-center">{category.order}</td>
                <td className="p-4 font-medium">
                  <div className="flex flex-col">
                    <div className="flex flex-wrap items-center gap-2">
                      <span className={category.isVisible === false ? 'text-stone-400 line-through' : 'text-stone-900'}>{category.name}</span>
                      {category.isVisible === false && (
                        <button
                          type="button"
                          onClick={() => toggleCategoryVisibility(category)}
                          className="text-[10px] font-black px-2 py-0.5 rounded-md bg-orange-100 text-orange-800 border border-orange-300 hover:bg-orange-200 cursor-pointer"
                          title="Clique para ativar e exibir esta categoria na tela de vendas"
                        >
                          🚫 OCULTA NA TELA DE VENDAS (Clique p/ ativar)
                        </button>
                      )}
                    </div>
                    <div className="flex flex-wrap gap-1 mt-1.5 items-center">
                      <button
                        type="button"
                        title={category.availableInStore !== false ? "Clique para desativar esta categoria na Loja" : "Clique para ativar esta categoria na Loja"}
                        onClick={async (e) => {
                          e.stopPropagation();
                          const newValue = category.availableInStore === false;
                          await updateCategory(category.id, { 
                            availableInStore: newValue,
                            ...(newValue ? { isVisible: true } : {})
                          });
                        }}
                        className={`text-[10px] px-2 py-0.5 rounded-md border transition-all cursor-pointer font-bold flex items-center gap-1 active:scale-95 ${
                          category.availableInStore !== false
                            ? 'bg-amber-100 text-amber-800 border-amber-300 shadow-xs hover:bg-amber-200'
                            : 'bg-stone-100 text-stone-400 border-stone-200 line-through opacity-50 hover:opacity-100 hover:bg-amber-50 hover:text-amber-700 hover:no-underline'
                        }`}
                      >
                        🍽️ Loja
                      </button>

                       <button
                        type="button"
                        title={category.availableForKiosk !== false ? "Clique para desativar esta categoria no Autoatendimento" : "Clique para ativar esta categoria no Autoatendimento"}
                        onClick={async (e) => {
                          e.stopPropagation();
                          const newValue = category.availableForKiosk === false;
                          await updateCategory(category.id, { 
                            availableForKiosk: newValue,
                            ...(newValue ? { isVisible: true } : {})
                          });
                        }}
                        className={`text-[10px] px-2 py-0.5 rounded-md border transition-all cursor-pointer font-bold flex items-center gap-1 active:scale-95 ${
                          category.availableForKiosk !== false
                            ? 'bg-blue-100 text-blue-800 border-blue-300 shadow-xs hover:bg-blue-200'
                            : 'bg-stone-100 text-stone-400 border-stone-200 line-through opacity-50 hover:opacity-100 hover:bg-blue-50 hover:text-blue-700 hover:no-underline'
                        }`}
                      >
                        📱 Autoatendimento
                      </button>

                      <button
                        type="button"
                        title="Clique para alternar a modalidade desta categoria entre Salgados Prontos (Normais) e Salgados Congelados (Até 48h)"
                        onClick={async (e) => {
                          e.stopPropagation();
                          const currentlyFrozen = isCategoryFrozenModality(category);
                          await updateCategory(category.id, {
                            modality: currentlyFrozen ? 'pronto' : 'congelado'
                          });
                        }}
                        className={`text-[10px] px-2.5 py-0.5 rounded-md border transition-all cursor-pointer font-extrabold flex items-center gap-1 active:scale-95 ${
                          isCategoryFrozenModality(category)
                            ? 'bg-cyan-100 text-cyan-900 border-cyan-300 shadow-xs hover:bg-cyan-200'
                            : 'bg-orange-100 text-orange-900 border-orange-300 shadow-xs hover:bg-orange-200'
                        }`}
                      >
                        {isCategoryFrozenModality(category) ? '❄️ Modalidade: Congelados (+R$ 0,30 • 48h)' : '🔥 Modalidade: Prontos (Normais)'}
                      </button>

                      <button
                        type="button"
                        title={category.saleMode === 'unit' ? "Modo de Venda: Unitário (1 por 1). Clique para mudar para Por Quantidade/Lote" : "Modo de Venda: Por Quantidade/Lote. Clique para mudar para Unitário (1 por 1)"}
                        onClick={async (e) => {
                          e.stopPropagation();
                          const newMode = category.saleMode === 'unit' ? 'pack' : 'unit';
                          await updateCategory(category.id, { saleMode: newMode });
                        }}
                        className={`text-[10px] px-2.5 py-0.5 rounded-md border transition-all cursor-pointer font-extrabold flex items-center gap-1 active:scale-95 ${
                          category.saleMode === 'unit'
                            ? 'bg-purple-100 text-purple-900 border-purple-300 shadow-xs hover:bg-purple-200'
                            : 'bg-emerald-100 text-emerald-900 border-emerald-300 shadow-xs hover:bg-emerald-200'
                        }`}
                      >
                        {category.saleMode === 'unit' ? '📦 Venda: Unitária (1 por 1)' : '🔢 Venda: Por Quantidade/Lote'}
                      </button>
                    </div>
                  </div>
                </td>
                <td className="p-4 flex justify-end gap-2">
                  <button type="button" onClick={() => toggleCategoryVisibility(category)} className={`p-2 rounded-lg ${category.isVisible !== false ? 'text-stone-500 hover:bg-stone-100' : 'text-orange-600 hover:bg-orange-50'}`}>
                    {category.isVisible !== false ? <Eye className="w-4 h-4" /> : <EyeOff className="w-4 h-4" />}
                  </button>
                  <button type="button" onClick={() => openModal('category', category)} className="p-2 text-blue-600 hover:bg-blue-50 rounded-lg">
                    <Edit2 className="w-4 h-4" />
                  </button>
                  <button type="button" onClick={() => handleDeleteCategory(category.id)} className="p-2 text-red-600 hover:bg-red-50 rounded-lg">
                    <Trash2 className="w-4 h-4" />
                  </button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
    );
  };

  const [productPage, setProductPage] = useState(1);
  const productsPerPage = 20;

  const renderProducts = () => {
    const allValidProducts = products.filter(p => !shouldExcludeProduct(p, categories));
    
    const filteredProducts = allValidProducts.filter(p => {
      if (productCategoryFilter !== 'all' && p.categoryId !== productCategoryFilter && p.frozenCategoryId !== productCategoryFilter) {
        return false;
      }
      if (productStatusFilter === 'active' && !p.isActive) return false;
      if (productStatusFilter === 'inactive' && p.isActive) return false;
      if (productFrozenFilter === 'frozen' && p.allowFrozen === false) return false;
      if (productFrozenFilter === 'not_frozen' && p.allowFrozen !== false) return false;
      
      const activeSearch = (productSearch || productSearchInput).trim();
      if (activeSearch) {
        const normQuery = normalizeText(activeSearch);
        const normName = normalizeText(p.name || '');
        const normDesc = normalizeText(p.description || '');
        const rawCode = (p.externalId || '').toString().toLowerCase();

        const nameMatch = normQuery ? normName.includes(normQuery) : false;
        const descMatch = normQuery ? normDesc.includes(normQuery) : false;
        const codeMatch = rawCode.includes(activeSearch.toLowerCase());

        return nameMatch || descMatch || codeMatch;
      }
      return true;
    }).sort((a, b) => {
      const orderA = a.order ?? 0;
      const orderB = b.order ?? 0;
      if (orderA !== orderB) return orderA - orderB;
      return (a.name || '').localeCompare(b.name || '', 'pt-BR', { sensitivity: 'base' });
    });

    const totalPages = Math.max(1, Math.ceil(filteredProducts.length / productsPerPage));
    const paginatedProducts = filteredProducts.slice((productPage - 1) * productsPerPage, productPage * productsPerPage);

    return (
      <div>
        <div className="flex flex-col md:flex-row justify-between items-start md:items-center gap-4 mb-6">
          <div>
            <h2 className="text-2xl font-bold text-stone-800">Produtos</h2>
            <p className="text-sm text-stone-500">
              {filteredProducts.length} {filteredProducts.length === 1 ? 'item exibido' : 'itens exibidos'} {allValidProducts.length !== filteredProducts.length && `(de ${allValidProducts.length} no total)`} | <span className="text-green-600 font-bold">{
                filteredProducts.filter(p => p.isActive).length
              } ativos</span>
            </p>
          </div>
          <div className="flex flex-wrap gap-2 items-center">
            {/* Opção de Sincronização Automática (Das 08:00 às 18:00, a cada 2h) */}
            {isAdminOrMaster && (
              <>
                <div className="flex items-center gap-2 bg-stone-100 p-1.5 rounded-lg border border-stone-200 text-xs font-medium text-stone-700">
                  <span className="flex items-center gap-1 font-bold pl-1 text-stone-800">
                    <Clock className="w-3.5 h-3.5 text-orange-600" />
                    Sync Auto (2h / 08h-18h):
                  </span>
                  <div className="flex items-center bg-stone-200 p-0.5 rounded-md">
                    <button
                      type="button"
                      onClick={() => {
                        setIsAutoSyncEnabled(true);
                        localStorage.setItem('bluefocus_auto_sync', 'true');
                        if (!localStorage.getItem('bluefocus_last_auto_sync_timestamp')) {
                          localStorage.setItem('bluefocus_last_auto_sync_timestamp', String(Date.now()));
                        }
                        updateStoreInfo({
                          blueFocusExportConfig: serializeBlueFocusConfigForDb(blueFocusConfig, true),
                        }).catch(() => {});
                      }}
                      className={`px-2.5 py-1 rounded text-xs font-black transition-all cursor-pointer ${
                        isAutoSyncEnabled 
                          ? 'bg-green-600 text-white shadow-sm' 
                          : 'text-stone-600 hover:text-stone-900'
                      }`}
                    >
                      SIM
                    </button>
                    <button
                      type="button"
                      onClick={() => {
                        setIsAutoSyncEnabled(false);
                        localStorage.setItem('bluefocus_auto_sync', 'false');
                        updateStoreInfo({
                          blueFocusExportConfig: serializeBlueFocusConfigForDb(blueFocusConfig, false),
                        }).catch(() => {});
                      }}
                      className={`px-2.5 py-1 rounded text-xs font-black transition-all cursor-pointer ${
                        !isAutoSyncEnabled 
                          ? 'bg-stone-600 text-white shadow-sm' 
                          : 'text-stone-600 hover:text-stone-900'
                      }`}
                    >
                      NÃO
                    </button>
                  </div>
                  {isAutoSyncEnabled && lastAutoSyncTime && (
                    <span className="text-[10px] font-bold text-green-700 bg-green-100 px-2 py-0.5 rounded-full border border-green-200 hidden sm:inline-block">
                      Último: {lastAutoSyncTime}
                    </span>
                  )}
                </div>

                <button type="button" 
                  onClick={() => handleSyncBlueFocus({ tipoAtualizacao: 'A' })}
                  disabled={isSyncing}
                  className="bg-blue-600 text-white px-4 py-2 rounded-lg font-medium hover:bg-blue-700 flex items-center gap-2 disabled:opacity-50 cursor-pointer text-sm"
                >
                  <RefreshCw className={`w-4 h-4 ${isSyncing ? 'animate-spin' : ''}`} />
                  {isSyncing ? 'Sincronizando...' : 'Sincronizar Alterações'}
                </button>
                <button type="button" 
                  onClick={() => {
                    setConfirmModal({
                      isOpen: true,
                      title: 'Sincronização Completa',
                      message: 'Deseja zerar os marcadores de carga e realizar a sincronização completa de TODOS os produtos?',
                      confirmText: 'Sincronizar Tudo',
                      onConfirm: () => {
                        const freshConfig = {
                          ...blueFocusConfig,
                          tipo: '4',
                          tipoAtualizacao: 'C',
                          startCargaNumero: '0',
                          startCargaSequencia: '0',
                          startProdutoId: '0'
                        };
                        setBlueFocusConfig(freshConfig);
                        mirrorBlueFocusConfigToLocalStorage({ ...freshConfig, autoSyncEnabled: isAutoSyncEnabled });
                        updateStoreInfo({
                          blueFocusExportConfig: serializeBlueFocusConfigForDb(freshConfig, isAutoSyncEnabled),
                        }).catch(() => {});
                        handleSyncBlueFocus(freshConfig);
                      }
                    });
                  }}
                  disabled={isSyncing}
                  className="bg-emerald-600 text-white px-4 py-2 rounded-lg font-medium hover:bg-emerald-700 flex items-center gap-2 disabled:opacity-50 cursor-pointer text-sm"
                >
                  <RefreshCw className={`w-4 h-4 ${isSyncing ? 'animate-spin' : ''}`} />
                  {isSyncing ? 'Sincronizando...' : 'Zerar & Sincronizar Tudo (Carga Total)'}
                </button>
              </>
            )}
            <button
              type="button"
              onClick={() => setIsTotemBackupModalOpen(true)}
              className="bg-blue-700 text-white px-3.5 py-2 rounded-lg font-bold hover:bg-blue-800 flex items-center gap-1.5 cursor-pointer text-sm shadow-xs"
              title="Criar backup ou restaurar exibição do Totem"
            >
              <span>📦</span>
              <span>Backup do Totem</span>
            </button>
            <button
              type="button"
              onClick={handleRestorePreSync}
              className="bg-amber-600 text-white px-3.5 py-2 rounded-lg font-bold hover:bg-amber-700 flex items-center gap-1.5 cursor-pointer text-sm shadow-xs"
              title="Restaurar estado do cardápio e categorias antes da última sincronização"
            >
              <span>↩️</span>
              <span>Desfazer Sincronização</span>
            </button>
            <button type="button" 
              onClick={() => {
                openModal('product');
              }}
              className="bg-stone-800 text-white px-4 py-2 rounded-lg font-medium hover:bg-stone-900 flex items-center gap-2 text-sm"
            >
              <Plus className="w-4 h-4" /> Novo Produto
            </button>
          </div>
        </div>

        {/* Barra de Pesquisa e Filtros */}
        <div className="bg-white p-4 rounded-xl shadow-sm border border-stone-200 mb-6 flex flex-col md:flex-row gap-3 items-center justify-between">
          <form
            onSubmit={(e) => {
              e.preventDefault();
              setProductSearch(productSearchInput);
              setProductPage(1);
            }}
            className="flex-1 w-full flex flex-col sm:flex-row gap-2"
          >
            <div className="relative flex-1">
              <Search className="w-5 h-5 absolute left-3.5 top-1/2 -translate-y-1/2 text-stone-400 pointer-events-none" />
              <input
                type="text"
                placeholder="Pesquisar produto por nome, código ERP ou descrição..."
                value={productSearchInput}
                onChange={(e) => {
                  const val = e.target.value;
                  setProductSearchInput(val);
                  setProductSearch(val);
                  setProductPage(1);
                }}
                className="w-full pl-10 pr-10 py-2.5 bg-stone-50 border border-stone-200 rounded-xl focus:ring-2 focus:ring-orange-500 focus:bg-white outline-none text-sm font-medium transition-all"
              />
              {productSearchInput && (
                <button
                  type="button"
                  onClick={() => {
                    setProductSearchInput('');
                    setProductSearch('');
                    setProductPage(1);
                  }}
                  className="absolute right-3 top-1/2 -translate-y-1/2 text-stone-400 hover:text-stone-600 p-1 rounded-full hover:bg-stone-200 transition-colors"
                  title="Limpar pesquisa"
                >
                  <X className="w-4 h-4" />
                </button>
              )}
            </div>
            <button
              type="submit"
              className="px-4 py-2.5 bg-orange-600 hover:bg-orange-700 text-white font-bold text-sm rounded-xl transition-colors flex items-center justify-center gap-2 shrink-0 shadow-sm cursor-pointer"
            >
              <Search className="w-4 h-4" />
              Pesquisar
            </button>
          </form>

          <div className="flex flex-wrap sm:flex-nowrap gap-2 w-full md:w-auto shrink-0">
            <select
              value={productCategoryFilter}
              onChange={(e) => {
                setProductCategoryFilter(e.target.value);
                setProductPage(1);
              }}
              className="px-3 py-2.5 bg-stone-50 border border-stone-200 rounded-xl text-sm font-medium text-stone-700 focus:ring-2 focus:ring-orange-500 outline-none w-full sm:w-auto"
            >
              <option value="all">Todas as Categorias ({categories.filter(c => !isExcludedCategory(c.name)).length})</option>
              {categories
                .filter(c => !isExcludedCategory(c.name))
                .sort((a, b) => (a.name || '').localeCompare(b.name || '', 'pt-BR', { sensitivity: 'base' }))
                .map(c => (
                  <option key={c.id} value={c.id}>{c.name} {!c.externalId ? '✏️ (Manual)' : ''}</option>
                ))
              }
            </select>

            <select
              value={productStatusFilter}
              onChange={(e) => {
                setProductStatusFilter(e.target.value);
                setProductPage(1);
              }}
              className="px-3 py-2.5 bg-stone-50 border border-stone-200 rounded-xl text-sm font-medium text-stone-700 focus:ring-2 focus:ring-orange-500 outline-none w-full sm:w-auto"
            >
              <option value="all">Todos os Status</option>
              <option value="active">Somente Ativos</option>
              <option value="inactive">Somente Inativos</option>
            </select>

            <select
              value={productFrozenFilter}
              onChange={(e) => {
                setProductFrozenFilter(e.target.value as any);
                setProductPage(1);
              }}
              className="px-3 py-2.5 bg-stone-50 border border-stone-200 rounded-xl text-sm font-medium text-stone-700 focus:ring-2 focus:ring-orange-500 outline-none w-full sm:w-auto font-bold"
            >
              <option value="all">❄️ Congelados (Todos)</option>
              <option value="frozen">❄️ Com Congelado (+R$ 0,30)</option>
              <option value="not_frozen">🚫 Sem Congelado</option>
            </select>

            {(productSearch || productSearchInput || productCategoryFilter !== 'all' || productStatusFilter !== 'all' || productFrozenFilter !== 'all') && (
              <button
                type="button"
                onClick={() => {
                  setProductSearchInput('');
                  setProductSearch('');
                  setProductCategoryFilter('all');
                  setProductStatusFilter('all');
                  setProductFrozenFilter('all');
                  setProductPage(1);
                }}
                className="px-3 py-2.5 text-xs font-bold text-stone-600 bg-stone-100 hover:bg-stone-200 rounded-xl transition-colors whitespace-nowrap cursor-pointer"
              >
                Limpar Filtros
              </button>
            )}
          </div>
        </div>

        {syncProgress && (
          <div className="fixed inset-0 z-[100] flex items-center justify-center bg-stone-900/60 backdrop-blur-sm p-4 animate-in fade-in duration-200">
            <div className="bg-white rounded-2xl shadow-2xl border border-stone-200 max-w-lg w-full p-6 space-y-5 relative overflow-hidden">
              {/* Header */}
              <div className="flex items-center gap-4 border-b border-stone-100 pb-4">
                <div className="w-12 h-12 rounded-xl bg-orange-100 text-orange-600 flex items-center justify-center shrink-0 shadow-inner">
                  <RefreshCw className="w-6 h-6 animate-spin" />
                </div>
                <div>
                  <h3 className="text-lg font-bold text-stone-900 flex items-center gap-2">
                    Sincronização ERP BlueFocus
                  </h3>
                  <p className="text-xs text-stone-500">
                    Evolução da importação e atualização do cardápio em tempo real
                  </p>
                </div>
              </div>

              {/* Progress Status Bar */}
              <div className="space-y-2">
                <div className="flex justify-between items-center text-xs font-semibold">
                  <span className="text-orange-600 flex items-center gap-1.5 truncate max-w-[280px]">
                    <span className="w-2 h-2 rounded-full bg-orange-500 animate-ping shrink-0"></span>
                    <span className="truncate">{syncProgress.status}</span>
                  </span>
                  <span className="text-stone-500 font-mono text-[11px] shrink-0">
                    {syncProgress.total > 0 ? `${syncProgress.total} válidos` : `${syncProgress.current} lidos`}
                  </span>
                </div>
                <div className="w-full bg-stone-100 h-3 rounded-full overflow-hidden p-0.5 border border-stone-200">
                  <div 
                    className="bg-gradient-to-r from-orange-500 via-amber-500 to-emerald-500 h-full rounded-full transition-all duration-300 relative overflow-hidden" 
                    style={{ width: '100%' }}
                  >
                    <div className="absolute inset-0 bg-white/25 animate-pulse"></div>
                  </div>
                </div>
              </div>

              {/* Stat Cards - Real Time Counters */}
              <div className="grid grid-cols-3 gap-3">
                <div className="bg-stone-50 p-3 rounded-xl border border-stone-200/80 text-center">
                  <div className="text-[10px] uppercase font-bold text-stone-400 tracking-wider">Registros Lidos</div>
                  <div className="text-xl font-extrabold text-stone-800 mt-0.5 font-mono">
                    {syncProgress.current}
                  </div>
                </div>

                <div className="bg-emerald-50 p-3 rounded-xl border border-emerald-200/80 text-center">
                  <div className="text-[10px] uppercase font-bold text-emerald-600 tracking-wider">Produtos Válidos</div>
                  <div className="text-xl font-extrabold text-emerald-700 mt-0.5 font-mono">
                    {syncProgress.total}
                  </div>
                </div>

                <div className="bg-amber-50 p-3 rounded-xl border border-amber-200/80 text-center">
                  <div className="text-[10px] uppercase font-bold text-amber-600 tracking-wider">Itens Ignorados</div>
                  <div className="text-xl font-extrabold text-amber-700 mt-0.5 font-mono">
                    {syncProgress.ignored}
                  </div>
                </div>
              </div>

              {/* Item Being Processed Live Stream */}
              {syncProgress.lastProcessedName && (
                <div className="bg-stone-50 rounded-xl p-3.5 border border-stone-200/80 space-y-2">
                  <div className="text-[10px] font-bold uppercase tracking-wider text-stone-400 flex items-center justify-between">
                    <span>Evolução da Leitura</span>
                    <span className="text-orange-500 font-normal italic">Processando...</span>
                  </div>

                  <div className="space-y-1.5">
                    <div className="text-xs font-semibold text-stone-700 truncate flex items-center gap-1.5">
                      <span className="w-1.5 h-1.5 rounded-full bg-stone-400 shrink-0"></span>
                      <span className="text-stone-400 text-[10px] shrink-0">Último Lido:</span> 
                      <span className="truncate italic font-normal text-stone-600">{syncProgress.lastProcessedName}</span>
                    </div>

                    {syncProgress.lastProductName && (
                      <div className="text-xs font-bold text-emerald-800 truncate flex items-center gap-1.5 bg-emerald-100/70 p-2 rounded-lg border border-emerald-200">
                        <CheckCircle2 className="w-4 h-4 text-emerald-600 shrink-0" />
                        <span className="text-[10px] text-emerald-700 uppercase tracking-wide shrink-0">Último Válido:</span>
                        <span className="truncate">{syncProgress.lastProductName}</span>
                      </div>
                    )}
                  </div>
                </div>
              )}

              {/* Info Notice */}
              {syncProgress.status.includes('Carga: 0/0') || syncProgress.status.includes('Iniciando') ? (
                <div className="bg-orange-50/80 p-3 rounded-xl border border-orange-100 text-xs text-orange-800 space-y-1">
                  <p className="font-semibold flex items-center gap-1">
                    <Clock className="w-3.5 h-3.5 text-orange-600 shrink-0" />
                    Sincronização Total em Execução
                  </p>
                  <p className="text-[11px] text-orange-700 leading-relaxed">
                    O catálogo completo está sendo processado do servidor BlueFocus. Por favor, <strong>mantenha esta tela aberta</strong> enquanto as informações e fotos são atualizadas.
                  </p>
                </div>
              ) : (
                <div className="text-center text-xs text-stone-400 flex items-center justify-center gap-1.5 pt-1">
                  <Clock className="w-3.5 h-3.5 text-orange-500 animate-pulse shrink-0" />
                  <span>Processando e salvando registros no banco de dados...</span>
                </div>
              )}
            </div>
          </div>
        )}

        {selectedProductIds.length > 0 && (
          <div className="bg-orange-50 border border-orange-200 rounded-xl p-3 mb-4 flex flex-col gap-3 animate-in fade-in duration-150 shadow-sm">
            <div className="flex flex-wrap items-center justify-between gap-3">
              <div className="flex items-center gap-2 text-stone-800 font-bold text-sm">
                <CheckSquare className="w-5 h-5 text-orange-600" />
                <span>{selectedProductIds.length} produto(s) selecionado(s)</span>
              </div>
              <button
                type="button"
                onClick={() => setSelectedProductIds([])}
                className="px-3 py-1.5 text-xs font-bold text-stone-500 hover:bg-stone-200/60 rounded-lg transition-colors cursor-pointer"
              >
                Limpar Seleção
              </button>
            </div>

            <div className="flex flex-wrap items-center gap-3 pt-2 border-t border-orange-200/70">
              {/* Vincular em massa à Categoria de Prontos */}
              <div className="flex flex-wrap items-center gap-2 bg-white/80 p-2 rounded-lg border border-orange-200">
                <span className="text-xs font-extrabold text-amber-900">🔥 Categoria Prontos:</span>
                <select
                  value={targetBatchCategoryId}
                  onChange={(e) => setTargetBatchCategoryId(e.target.value)}
                  className="p-1.5 border border-stone-300 rounded-lg text-xs font-bold text-stone-800 bg-white focus:ring-2 focus:ring-orange-500 outline-none max-w-[220px]"
                >
                  <option value="">Selecionar categoria Prontos...</option>
                  <option value="none">🚫 Não exibir em Prontos</option>
                  {categories
                    .filter(c => !isExcludedCategory(c.name))
                    .sort((a, b) => (a.name || '').localeCompare(b.name || '', 'pt-BR', { sensitivity: 'base' }))
                    .map(c => (
                      <option key={c.id} value={c.id}>
                        {c.name} {!c.externalId ? '✏️ (Manual)' : ''}
                      </option>
                    ))
                  }
                </select>
                <button
                  type="button"
                  disabled={!targetBatchCategoryId || isTransferringBatch}
                  onClick={handleBatchCategoryTransfer}
                  className="px-3 py-1.5 bg-orange-600 hover:bg-orange-700 text-white font-bold text-xs rounded-lg transition-colors shadow-xs disabled:opacity-50 cursor-pointer"
                >
                  {isTransferringBatch ? 'Salvando...' : 'Vincular Prontos'}
                </button>
              </div>

              {/* Vincular em massa à Categoria de Congelados */}
              <div className="flex flex-wrap items-center gap-2 bg-cyan-50/80 p-2 rounded-lg border border-cyan-200">
                <span className="text-xs font-extrabold text-cyan-900">❄️ Categoria Congelados:</span>
                <select
                  value={targetBatchFrozenCategoryId}
                  onChange={(e) => setTargetBatchFrozenCategoryId(e.target.value)}
                  className="p-1.5 border border-cyan-300 rounded-lg text-xs font-bold text-cyan-950 bg-white focus:ring-2 focus:ring-cyan-500 outline-none max-w-[220px]"
                >
                  <option value="">Selecionar categoria Congelados...</option>
                  <option value="none">🚫 Remover vínculo de Congelados</option>
                  {categories
                    .filter(c => !isExcludedCategory(c.name))
                    .sort((a, b) => (a.name || '').localeCompare(b.name || '', 'pt-BR', { sensitivity: 'base' }))
                    .map(c => (
                      <option key={c.id} value={c.id}>
                        {c.name} {!c.externalId ? '✏️ (Manual)' : ''}
                      </option>
                    ))
                  }
                </select>
                {targetBatchFrozenCategoryId && targetBatchFrozenCategoryId !== 'none' && (
                  <div className="flex items-center gap-1 bg-white px-2 py-1 rounded-lg border border-cyan-300">
                    <span className="text-[11px] font-extrabold text-cyan-900 whitespace-nowrap">Qtd. Mín:</span>
                    <input
                      type="number"
                      min={1}
                      value={batchMinFrozenQty}
                      onChange={(e) => setBatchMinFrozenQty(e.target.value)}
                      placeholder="Ex: 20"
                      className="w-16 text-xs font-black text-center text-cyan-950 outline-none"
                      title="Opcional: defina uma quantidade mínima de congelados para os produtos selecionados"
                    />
                    <span className="text-[10px] font-bold text-cyan-700">un</span>
                  </div>
                )}
                <button
                  type="button"
                  disabled={!targetBatchFrozenCategoryId || isTransferringBatch}
                  onClick={handleBatchFrozenCategoryTransfer}
                  className="px-3 py-1.5 bg-cyan-600 hover:bg-cyan-700 text-white font-bold text-xs rounded-lg transition-colors shadow-xs disabled:opacity-50 cursor-pointer"
                >
                  {isTransferringBatch ? 'Salvando...' : 'Vincular Congelados'}
                </button>
              </div>

              <div className="flex items-center gap-1.5">
                <button
                  type="button"
                  disabled={isTransferringBatch}
                  onClick={() => handleBatchToggleFrozen(true)}
                  className="px-3 py-2 bg-cyan-600 hover:bg-cyan-700 text-white font-bold text-xs rounded-lg transition-colors shadow-xs disabled:opacity-50 cursor-pointer flex items-center gap-1"
                  title="Amarrar opção de Congelados (+R$ 0,30) a todos os produtos selecionados"
                >
                  <span>❄️ Habilitar Congelados (+R$ 0,30)</span>
                </button>
                <button
                  type="button"
                  disabled={isTransferringBatch}
                  onClick={() => handleBatchToggleFrozen(false)}
                  className="px-3 py-2 bg-stone-200 hover:bg-stone-300 text-stone-700 font-bold text-xs rounded-lg transition-colors disabled:opacity-50 cursor-pointer flex items-center gap-1"
                  title="Desabilitar opção de Congelados para todos os selecionados"
                >
                  <span>🚫 Sem Congelados</span>
                </button>
              </div>
            </div>
          </div>
        )}

        <div className="bg-white rounded-xl shadow-sm border border-stone-200 overflow-hidden">
          <div className="overflow-x-auto">
            <table className="w-full text-left text-sm">
              <thead className="bg-stone-50 text-stone-600 font-medium border-b text-[11px] uppercase tracking-wider">
                <tr>
                  <th className="p-4 w-10 text-center">
                    <input
                      type="checkbox"
                      checked={paginatedProducts.length > 0 && paginatedProducts.every(p => selectedProductIds.includes(p.id))}
                      onChange={(e) => {
                        if (e.target.checked) {
                          const pageIds = paginatedProducts.map(p => p.id);
                          setSelectedProductIds(prev => Array.from(new Set([...prev, ...pageIds])));
                        } else {
                          const pageIds = new Set(paginatedProducts.map(p => p.id));
                          setSelectedProductIds(prev => prev.filter(id => !pageIds.has(id)));
                        }
                      }}
                      className="w-4 h-4 text-orange-600 rounded border-stone-300 focus:ring-orange-500 cursor-pointer"
                      title="Selecionar todos os produtos desta página"
                    />
                  </th>
                  <th className="p-4 w-16">Imagem</th>
                  <th className="p-4">Nome</th>
                  <th className="p-4">Categoria</th>
                  <th className="p-4">Preço</th>
                  <th className="p-4 text-center">Status</th>
                  <th className="p-4 text-right">Ações</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-stone-100">
                {paginatedProducts.length === 0 ? (
                  <tr>
                    <td colSpan={7} className="p-12 text-center text-stone-500">
                      <Search className="w-10 h-10 mx-auto mb-3 text-stone-300" />
                      <p className="font-bold text-stone-700 text-base">Nenhum produto encontrado</p>
                      <p className="text-xs text-stone-400 mt-1 max-w-sm mx-auto">
                        Tente pesquisar por outros termos (nome, código ERP ou descrição) ou alterar os filtros de categoria e status.
                      </p>
                      {(productSearch || productSearchInput || productCategoryFilter !== 'all' || productStatusFilter !== 'all' || productFrozenFilter !== 'all') && (
                        <button
                          type="button"
                          onClick={() => {
                            setProductSearchInput('');
                            setProductSearch('');
                            setProductCategoryFilter('all');
                            setProductStatusFilter('all');
                            setProductFrozenFilter('all');
                            setProductPage(1);
                          }}
                          className="mt-4 px-4 py-2 bg-stone-100 hover:bg-stone-200 text-stone-700 font-bold text-xs rounded-xl transition-colors cursor-pointer"
                        >
                          Limpar Filtros e Pesquisa
                        </button>
                      )}
                    </td>
                  </tr>
                ) : (
                  paginatedProducts.map(product => {
                  const category = categories.find(c => c.id === product.categoryId);
                  return (
                    <tr key={product.id} className={`hover:bg-stone-50 transition-colors ${selectedProductIds.includes(product.id) ? 'bg-orange-50/40' : ''}`}>
                      <td className="p-4 text-center">
                        <input
                          type="checkbox"
                          checked={selectedProductIds.includes(product.id)}
                          onChange={(e) => {
                            e.stopPropagation();
                            setSelectedProductIds(prev =>
                              prev.includes(product.id) ? prev.filter(id => id !== product.id) : [...prev, product.id]
                            );
                          }}
                          className="w-4 h-4 text-orange-600 rounded border-stone-300 focus:ring-orange-500 cursor-pointer"
                        />
                      </td>
                      <td className="p-4">
                        <div className="w-10 h-10 rounded overflow-hidden shadow-inner border border-stone-100">
                          <ProductImage 
                            src={product.imageUrl} 
                            alt={product.name} 
                            className="w-full h-full object-cover" 
                          />
                        </div>
                      </td>
                      <td className="p-4 font-medium">
                        <div className="flex flex-col">
                          <span className="text-stone-900 font-bold">{product.name}</span>
                          {(product.externalId || product.description) && (
                            <span className="text-xs text-red-600 italic font-medium line-clamp-1 mt-0.5">
                              {formatProductDescriptionWithCode(product.description, product.externalId)}
                            </span>
                          )}
                          <div className="flex flex-wrap gap-1 mt-1.5 items-center">
                            {product.isAddon && <span className="text-[9px] bg-blue-100 text-blue-600 px-1.5 py-0.5 rounded uppercase font-bold">Opcional</span>}
                            {product.isFlavor && <span className="text-[9px] bg-purple-100 text-purple-600 px-1.5 py-0.5 rounded uppercase font-bold">Sabor</span>}
                            
                            <button
                              type="button"
                              title={product.availableInStore !== false ? "Clique para desativar na Loja" : "Clique para ativar na Loja"}
                              onClick={async (e) => {
                                e.stopPropagation();
                                const newValue = product.availableInStore === false;
                                await updateProduct(product.id, { availableInStore: newValue });
                              }}
                              className={`text-[10px] px-2 py-0.5 rounded-md border transition-all cursor-pointer font-bold flex items-center gap-1 active:scale-95 ${
                                product.availableInStore !== false
                                  ? 'bg-amber-100 text-amber-800 border-amber-300 shadow-xs hover:bg-amber-200'
                                  : 'bg-stone-100 text-stone-400 border-stone-200 line-through opacity-50 hover:opacity-100 hover:bg-amber-50 hover:text-amber-700 hover:no-underline'
                              }`}
                            >
                              🍽️ Loja
                            </button>

                            <button
                              type="button"
                              title={product.availableForKiosk !== false ? "Clique para desativar no Autoatendimento" : "Clique para ativar no Autoatendimento"}
                              onClick={async (e) => {
                                e.stopPropagation();
                                const newValue = product.availableForKiosk === false;
                                await updateProduct(product.id, { availableForKiosk: newValue });
                              }}
                              className={`text-[10px] px-2 py-0.5 rounded-md border transition-all cursor-pointer font-bold flex items-center gap-1 active:scale-95 ${
                                product.availableForKiosk !== false
                                  ? 'bg-blue-100 text-blue-800 border-blue-300 shadow-xs hover:bg-blue-200'
                                  : 'bg-stone-100 text-stone-400 border-stone-200 line-through opacity-50 hover:opacity-100 hover:bg-blue-50 hover:text-blue-700 hover:no-underline'
                              }`}
                            >
                              📱 Autoatendimento
                            </button>

                            <button
                              type="button"
                              title={product.allowFrozen !== false ? "Clique para configurar a quantidade mínima ou alternar opção de Congelado (+R$ 0,30)" : "Clique para ativar opção de Congelado (+R$ 0,30) e definir quantidade mínima"}
                              onClick={async (e) => {
                                e.stopPropagation();
                                const newValue = product.allowFrozen === false;
                                await updateProduct(product.id, { allowFrozen: newValue });
                                if (newValue) {
                                  focusMinFrozenInput(product.id);
                                }
                              }}
                              className={`text-[10px] px-2 py-0.5 rounded-md border transition-all cursor-pointer font-bold flex items-center gap-1 active:scale-95 ${
                                product.allowFrozen !== false
                                  ? 'bg-cyan-100 text-cyan-800 border-cyan-300 shadow-xs hover:bg-cyan-200'
                                  : 'bg-stone-100 text-stone-400 border-stone-200 line-through opacity-50 hover:opacity-100 hover:bg-cyan-50 hover:text-cyan-700 hover:no-underline'
                              }`}
                            >
                              ❄️ {product.allowFrozen !== false
                                ? `Congelado (+R$ 0,30${Number(product.minFrozenQuantity) > 1 ? ` • Mín: ${product.minFrozenQuantity} un` : ''})`
                                : 'Congelado (Desativado)'}
                            </button>

                            {product.externalId && <span className="text-[10px] bg-stone-100 text-stone-700 border border-stone-200 px-1.5 py-0.5 rounded font-mono uppercase font-bold">CÓD: {product.externalId}</span>}
                          </div>
                        </div>
                      </td>
                      <td className="p-4">
                        <div className="flex flex-col gap-1.5">
                          {(() => {
                            const selectedPrimaryCat = categories.find(c => c.id === product.categoryId);
                            const selectedFrozenCat = categories.find(c => c.id === product.frozenCategoryId);
                            const hasFrozenCatLinked = Boolean(product.frozenCategoryId && product.frozenCategoryId !== 'none');
                            const isPrimaryCatFrozen = Boolean(selectedPrimaryCat && isCategoryFrozenModality(selectedPrimaryCat));
                            const showMinFrozenField = Boolean(
                              hasFrozenCatLinked ||
                              isPrimaryCatFrozen ||
                              expandedMinFrozenIds[product.id] ||
                              Number(product.minFrozenQuantity) > 1
                            );
                            const currentMinVal = Number(product.minFrozenQuantity) >= 1 ? Number(product.minFrozenQuantity) : 1;
                            const draftVal = minFrozenDrafts[product.id] !== undefined
                              ? minFrozenDrafts[product.id]
                              : String(currentMinVal);

                            return (
                              <>
                                <div className="flex flex-col gap-0.5">
                                  <div className="flex items-center gap-1.5">
                                    <span className="text-[10px] font-extrabold text-amber-800 bg-amber-100 border border-amber-200 px-1.5 py-0.5 rounded w-[84px] shrink-0 text-center" title="Categoria onde este produto aparece na modalidade Prontos (Normais)">
                                      🔥 Prontos
                                    </span>
                                    <select
                                      value={product.categoryId || 'none'}
                                      onChange={async (e) => {
                                        const newCatId = e.target.value;
                                        try {
                                          const targetCat = categories.find(c => c.id === newCatId);
                                          const targetIsFrozen = Boolean(targetCat && isCategoryFrozenModality(targetCat));
                                          await updateProduct(product.id, {
                                            categoryId: newCatId,
                                            ...(targetIsFrozen ? { allowFrozen: true } : {})
                                          });
                                          if (newCatId && newCatId !== 'none' && product.isActive !== false) {
                                            if (targetCat && !targetCat.externalId && targetCat.isVisible === false) {
                                              await updateCategory(targetCat.id, { isVisible: true });
                                            }
                                          }
                                          if (targetIsFrozen) {
                                            focusMinFrozenInput(product.id);
                                          }
                                        } catch (err) {
                                          console.error('Error updating product category:', err);
                                        }
                                      }}
                                      className="bg-stone-50 border border-stone-200 text-stone-700 text-[11px] rounded-lg p-1.5 focus:ring-2 focus:ring-orange-500 outline-none cursor-pointer font-bold w-full max-w-[210px]"
                                    >
                                      <option value="none">-- Não exibir em Prontos --</option>
                                      {categories
                                        .filter(c => !isExcludedCategory(c.name))
                                        .sort((a, b) => (a.name || '').localeCompare(b.name || '', 'pt-BR', { sensitivity: 'base' }))
                                        .map(c => (
                                          <option key={c.id} value={c.id}>
                                            {c.name} {!c.externalId ? '✏️ (Manual)' : ''} {c.isVisible === false ? '🚫 (Oculta)' : ''}
                                          </option>
                                        ))}
                                    </select>
                                  </div>
                                  {selectedPrimaryCat && selectedPrimaryCat.isVisible === false && (
                                    <button
                                      type="button"
                                      onClick={() => updateCategory(selectedPrimaryCat.id, { isVisible: true })}
                                      className="self-end text-[10px] font-bold text-orange-800 bg-orange-50 border border-orange-300 hover:bg-orange-100 px-2 py-0.5 rounded cursor-pointer"
                                      title="Esta categoria está oculta na tela de vendas. Clique para torná-la visível."
                                    >
                                      ⚠️ Categoria &quot;{selectedPrimaryCat.name}&quot; oculta (Ativar)
                                    </button>
                                  )}
                                </div>

                                <div className="flex flex-col gap-1">
                                  <div className="flex items-center gap-1.5">
                                    <button
                                      type="button"
                                      onClick={() => focusMinFrozenInput(product.id)}
                                      className="text-[10px] font-extrabold text-cyan-900 bg-cyan-100 hover:bg-cyan-200 border border-cyan-200 px-1.5 py-0.5 rounded w-[84px] shrink-0 text-center cursor-pointer transition-colors"
                                      title="Clique para definir a quantidade mínima deste produto quando vendido congelado"
                                    >
                                      ❄️ Congelados
                                    </button>
                                    <select
                                      value={product.frozenCategoryId || 'none'}
                                      onChange={async (e) => {
                                        const rawVal = e.target.value;
                                        const newFrozenCatId = rawVal === 'none' ? '' : rawVal;
                                        try {
                                          await updateProduct(product.id, { 
                                            frozenCategoryId: newFrozenCatId,
                                            ...(newFrozenCatId ? { allowFrozen: true } : {})
                                          });
                                          if (newFrozenCatId && product.isActive !== false) {
                                            const targetCat = categories.find(c => c.id === newFrozenCatId);
                                            if (targetCat && !targetCat.externalId && targetCat.isVisible === false) {
                                              await updateCategory(targetCat.id, { isVisible: true });
                                            }
                                          }
                                          if (newFrozenCatId) {
                                            focusMinFrozenInput(product.id);
                                          } else {
                                            setExpandedMinFrozenIds(prev => ({ ...prev, [product.id]: false }));
                                          }
                                        } catch (err) {
                                          console.error('Error updating product frozenCategoryId:', err);
                                        }
                                      }}
                                      className={`border text-[11px] rounded-lg p-1.5 focus:ring-2 focus:ring-cyan-500 outline-none cursor-pointer font-bold w-full max-w-[210px] ${
                                        hasFrozenCatLinked
                                          ? 'bg-cyan-50 border-cyan-300 text-cyan-950'
                                          : 'bg-stone-50 border-stone-200 text-stone-400'
                                      }`}
                                    >
                                      <option value="none">-- Sem Categoria Congelados --</option>
                                      {categories
                                        .filter(c => !isExcludedCategory(c.name))
                                        .sort((a, b) => (a.name || '').localeCompare(b.name || '', 'pt-BR', { sensitivity: 'base' }))
                                        .map(c => (
                                          <option key={c.id} value={c.id}>
                                            {c.name} {!c.externalId ? '✏️ (Manual)' : ''} {c.isVisible === false ? '🚫 (Oculta)' : ''}
                                          </option>
                                        ))}
                                    </select>
                                  </div>
                                  {selectedFrozenCat && selectedFrozenCat.isVisible === false && (
                                    <button
                                      type="button"
                                      onClick={() => updateCategory(selectedFrozenCat.id, { isVisible: true })}
                                      className="self-end text-[10px] font-bold text-orange-800 bg-orange-50 border border-orange-300 hover:bg-orange-100 px-2 py-0.5 rounded cursor-pointer"
                                      title="Esta categoria está oculta na tela de vendas. Clique para torná-la visível."
                                    >
                                      ⚠️ Categoria &quot;{selectedFrozenCat.name}&quot; oculta (Ativar)
                                    </button>
                                  )}

                                  {showMinFrozenField && (
                                    <div className="flex items-center justify-between gap-1.5 bg-cyan-50/90 border border-cyan-300/90 rounded-lg px-2 py-1 shadow-2xs max-w-[300px]">
                                      <label
                                        htmlFor={`min-frozen-qty-${product.id}`}
                                        className="text-[10px] font-extrabold text-cyan-950 whitespace-nowrap flex items-center gap-1 cursor-pointer"
                                        title="Quantidade mínima obrigatória quando este produto for comprado na modalidade Congelado"
                                      >
                                        <span>❄️ Qtd. Mínima:</span>
                                      </label>
                                      <div className="flex items-center gap-1">
                                        <input
                                          id={`min-frozen-qty-${product.id}`}
                                          type="number"
                                          min={1}
                                          inputMode="numeric"
                                          value={draftVal}
                                          placeholder="1"
                                          onFocus={(e) => e.target.select()}
                                          onChange={(e) => {
                                            const clean = e.target.value.replace(/\D/g, '');
                                            setMinFrozenDrafts(prev => ({ ...prev, [product.id]: clean }));
                                          }}
                                          onBlur={(e) => {
                                            saveInlineMinFrozenQuantity(product.id, e.target.value, currentMinVal);
                                          }}
                                          onKeyDown={(e) => {
                                            if (e.key === 'Enter') {
                                              e.preventDefault();
                                              (e.target as HTMLInputElement).blur();
                                            }
                                          }}
                                          className="w-16 px-1.5 py-0.5 text-xs font-black text-center bg-white border border-cyan-400 rounded-md focus:ring-2 focus:ring-cyan-500 outline-none text-cyan-950 font-mono"
                                        />
                                        <span className="text-[10px] font-extrabold text-cyan-800">un</span>
                                        {savedMinFrozenId === product.id ? (
                                          <span className="text-[10px] font-black text-emerald-700 bg-emerald-100 border border-emerald-300 px-1.5 py-0.5 rounded">
                                            ✓ Salvo
                                          </span>
                                        ) : (
                                          <button
                                            type="button"
                                            onClick={() => saveInlineMinFrozenQuantity(product.id, draftVal)}
                                            className="text-[10px] font-extrabold text-white bg-cyan-600 hover:bg-cyan-700 px-1.5 py-0.5 rounded cursor-pointer transition-colors"
                                            title="Salvar quantidade mínima deste produto"
                                          >
                                            OK
                                          </button>
                                        )}
                                      </div>
                                    </div>
                                  )}
                                </div>
                              </>
                            );
                          })()}
                        </div>
                      </td>
                      <td className="p-4 font-bold text-orange-600">
                        {product.isFlavor ? '-' : (product.price === 0 ? 'Grátis' : formatCurrency(product.price))}
                      </td>
                      <td className="p-4 text-center">
                        <button type="button" 
                          onClick={() => handleToggleProductStatus(product)}
                          className={`px-3 py-1 rounded-full text-[10px] font-bold uppercase transition-colors ${product.isActive ? 'bg-green-100 text-green-700 hover:bg-green-200' : 'bg-red-100 text-red-700 hover:bg-red-200'}`}
                        >
                          {product.isActive ? 'Ativo' : 'Inativo'}
                        </button>
                      </td>
                      <td className="p-4 flex justify-end gap-1">
                        <button type="button" onClick={() => openModal('product', product)} className="p-2 text-blue-600 hover:bg-blue-50 rounded-lg transition-colors">
                          <Edit2 className="w-4 h-4" />
                        </button>
                        <button type="button" onClick={() => handleDeleteProduct(product.id)} className="p-2 text-red-600 hover:bg-red-50 rounded-lg transition-colors">
                          <Trash2 className="w-4 h-4" />
                        </button>
                      </td>
                    </tr>
                  );
                }))}
              </tbody>
            </table>
          </div>

          {totalPages > 1 && (
            <div className="p-4 border-t bg-stone-50 flex items-center justify-between gap-4">
              <div className="text-xs text-stone-500 font-medium">
                Página {productPage} de {totalPages}
              </div>
              <div className="flex gap-2">
                <button
                  disabled={productPage === 1}
                  onClick={() => setProductPage(p => Math.max(1, p - 1))}
                  className="px-3 py-1 bg-white border rounded-lg text-xs font-bold hover:bg-stone-50 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
                >
                  Anterior
                </button>
                <button
                  disabled={productPage === totalPages}
                  onClick={() => setProductPage(p => Math.min(totalPages, p + 1))}
                  className="px-3 py-1 bg-white border rounded-lg text-xs font-bold hover:bg-stone-50 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
                >
                  Próxima
                </button>
              </div>
            </div>
          )}
        </div>
      </div>
    );
  };

  const renderFlavors = () => (
    <div>
      <div className="flex justify-between items-center mb-6">
        <h2 className="text-2xl font-bold text-stone-800">Sabores de Polpa</h2>
        <button type="button" 
          onClick={() => openModal('product', { isFlavor: true })}
          className="bg-purple-600 text-white px-4 py-2 rounded-lg font-medium hover:bg-purple-700 flex items-center gap-2"
        >
          <Droplets className="w-4 h-4" /> Novo Sabor
        </button>
      </div>
      <div className="bg-white rounded-xl shadow-sm border border-stone-200 overflow-hidden">
        <table className="w-full text-left text-sm">
          <thead className="bg-stone-50 text-stone-600 font-medium border-b">
            <tr>
              <th className="p-4 w-16">Imagem</th>
              <th className="p-4">Nome</th>
              <th className="p-4">Categoria</th>
              <th className="p-4 text-center">Status</th>
              <th className="p-4 text-right">Ações</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-stone-100">
            {products.filter(p => {
              const category = categories.find(c => c.id === p.categoryId);
              const notExcluded = !category || !isExcludedCategory(category.name);
              return p.isFlavor && notExcluded;
            }).map(product => {
              const category = categories.find(c => c.id === product.categoryId);
              const displayImage = (product.imageUrl && !product.imageUrl.includes('unsplash')) ? product.imageUrl : '';
              return (
                <tr key={product.id} className="hover:bg-stone-50">
                  <td className="p-4">
                    <div className="w-10 h-10 rounded overflow-hidden">
                      <ProductImage 
                        src={product.imageUrl} 
                        alt={product.name} 
                        className="w-full h-full object-cover" 
                      />
                    </div>
                  </td>
                  <td className="p-4 font-medium">
                    <div className="flex flex-col">
                      <span>{product.name}</span>
                      <span className="text-[10px] bg-purple-100 text-purple-600 px-1.5 py-0.5 rounded uppercase font-bold w-fit mt-1">Sabor</span>
                    </div>
                  </td>
                  <td className="p-4 text-stone-500">
                    <select
                      value={product.categoryId}
                      onChange={async (e) => {
                        const newCatId = e.target.value;
                        if (newCatId) {
                          try {
                            await updateProduct(product.id, { categoryId: newCatId });
                          } catch (err) {
                            console.error('Error updating product category:', err);
                          }
                        }
                      }}
                      className="bg-stone-50 border border-stone-200 text-stone-700 text-xs rounded-lg p-1.5 focus:ring-2 focus:ring-orange-500 outline-none cursor-pointer font-medium max-w-[220px]"
                    >
                      {categories
                        .filter(c => !isExcludedCategory(c.name))
                        .sort((a, b) => (a.name || '').localeCompare(b.name || '', 'pt-BR', { sensitivity: 'base' }))
                        .map(c => (
                          <option key={c.id} value={c.id}>
                            {c.name} {!c.externalId ? '✏️ (Manual)' : ''}
                          </option>
                        ))}
                    </select>
                  </td>
                  <td className="p-4 text-center">
                    <button type="button" 
                      onClick={() => handleToggleProductStatus(product)}
                      className={`px-2 py-1 rounded-full text-xs font-medium transition-colors ${product.isActive ? 'bg-green-100 text-green-700 hover:bg-green-200' : 'bg-red-100 text-red-700 hover:bg-red-200'}`}
                      title={product.isActive ? "Clique para desativar" : "Clique para ativar"}
                    >
                      {product.isActive ? 'Ativo' : 'Inativo'}
                    </button>
                  </td>
                  <td className="p-4 flex justify-end gap-2">
                    <button type="button" 
                      onClick={() => handleToggleProductStatus(product)} 
                      className={`p-2 rounded-lg ${product.isActive ? 'text-stone-500 hover:bg-stone-100' : 'text-green-600 hover:bg-green-50'}`}
                      title={product.isActive ? "Desativar produto" : "Ativar produto"}
                    >
                      {product.isActive ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
                    </button>
                    <button type="button" onClick={() => openModal('product', product)} className="p-2 text-blue-600 hover:bg-blue-50 rounded-lg">
                      <Edit2 className="w-4 h-4" />
                    </button>
                    <button type="button" onClick={() => handleDeleteProduct(product.id)} className="p-2 text-red-600 hover:bg-red-50 rounded-lg">
                      <Trash2 className="w-4 h-4" />
                    </button>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </div>
  );

  const renderUsers = () => (
    <div>
      <div className="flex justify-between items-center mb-6">
        <h2 className="text-2xl font-bold text-stone-800">Usuários</h2>
        <button type="button" 
          onClick={() => openModal('user')}
          className="bg-stone-800 text-white px-4 py-2 rounded-lg font-medium hover:bg-stone-900 flex items-center gap-2"
        >
          <Plus className="w-4 h-4" /> Novo Usuário
        </button>
      </div>
      <div className="bg-white rounded-xl shadow-sm border border-stone-200 overflow-hidden">
        <table className="w-full text-left text-sm">
          <thead className="bg-stone-50 text-stone-600 font-medium border-b">
            <tr>
              <th className="p-4">Nome</th>
              <th className="p-4">Email</th>
              <th className="p-4">Cargo</th>
              <th className="p-4 text-right">Ações</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-stone-100">
            {users.map(user => (
              <tr key={user.id} className="hover:bg-stone-50">
                <td className="p-4 font-medium">{user.name}</td>
                <td className="p-4 text-stone-500">{user.email}</td>
                <td className="p-4">
                  <span className={`px-2.5 py-1 rounded-full text-xs font-bold inline-block ${
                    user.role === 'master' 
                      ? 'bg-purple-100 text-purple-700 border border-purple-200' 
                      : user.role === 'admin'
                      ? 'bg-blue-100 text-blue-700 border border-blue-200'
                      : 'bg-stone-100 text-stone-700 border border-stone-200'
                  }`}>
                    {user.role === 'master' ? 'Master (Acesso Total)' : user.role === 'admin' ? 'Administrador' : 'Padrão (Operacional)'}
                  </span>
                </td>
                <td className="p-4 flex justify-end gap-2">
                  <button type="button" onClick={() => openModal('user', user)} className="p-2 text-blue-600 hover:bg-blue-50 rounded-lg">
                    <Edit2 className="w-4 h-4" />
                  </button>
                  <button type="button" onClick={() => handleDeleteUser(user.id)} className="p-2 text-red-600 hover:bg-red-50 rounded-lg">
                    <Trash2 className="w-4 h-4" />
                  </button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );

  const handleToggleIsOpen = (val: boolean) => {
    setIsOpenState(val);
    if (!val) {
      setForceOpenState(false);
      updateStoreInfo({ isOpen: false, forceOpen: false });
    } else {
      const status = getStoreCurrentStatus(weeklyScheduleState, true, autoOpenCloseState, false);
      const shouldForce = !status.isWithinSchedule && autoOpenCloseState;
      setForceOpenState(shouldForce);
      updateStoreInfo({ isOpen: true, forceOpen: shouldForce });
    }
  };

  const handleToggleForceOpen = (val: boolean) => {
    setForceOpenState(val);
    if (val) {
      setIsOpenState(true);
      updateStoreInfo({ isOpen: true, forceOpen: true });
    } else {
      updateStoreInfo({ forceOpen: false });
    }
  };

  const handleToggleShowSystemIntroButton = async (val: boolean) => {
    setShowSystemIntroButtonState(val);
    try {
      await updateStoreInfo({ showSystemIntroButton: val });
    } catch (err) {
      console.error('Erro ao atualizar exibição do botão flutuante:', err);
    }
  };

  const handleSetOperationMode = (mode: 'auto' | 'open' | 'closed') => {
    if (mode === 'auto') {
      setIsOpenState(true);
      setAutoOpenCloseState(true);
      setForceOpenState(false);
      updateStoreInfo({ isOpen: true, autoOpenClose: true, forceOpen: false });
    } else if (mode === 'open') {
      setIsOpenState(true);
      setForceOpenState(true);
      updateStoreInfo({ isOpen: true, forceOpen: true });
    } else if (mode === 'closed') {
      setIsOpenState(false);
      setForceOpenState(false);
      updateStoreInfo({ isOpen: false, forceOpen: false });
    }
  };

  const handleToggleInStore = (val: boolean) => {
    setInStoreEnabledState(val);
    updateStoreInfo({ inStoreEnabled: val });
  };

  const handleToggleDelivery = (val: boolean) => {
    setDeliveryEnabledState(val);
    updateStoreInfo({ deliveryEnabled: val });
  };

  const handleToggleDeliverySchedule = (val: boolean) => {
    setDeliveryScheduleEnabledState(val);
    updateStoreInfo({ deliveryScheduleEnabled: val });
  };

  const handleUpdateScheduleSlots = (slots: string[] | ((prev: string[]) => string[])) => {
    const next = typeof slots === 'function' ? slots(deliveryScheduleSlotsState) : slots;
    const sorted = Array.from(new Set(next)).sort();
    setDeliveryScheduleSlotsState(sorted);
    updateStoreInfo({ deliveryScheduleSlots: JSON.stringify(sorted) });
  };

  const handleUpdateScheduleInterval = (interval: number) => {
    const safeInterval = interval === 60 ? 60 : 30;
    const generated = generateScheduleTimeSlots(safeInterval, scheduleStartTimeState, scheduleEndTimeState);
    const updatedSlots = safeInterval === 60
      ? generated.filter(s => deliveryScheduleSlotsState.includes(s))
      : generated;
    const finalSlots = updatedSlots.length > 0 ? updatedSlots : generated;
    setScheduleIntervalMinutesState(safeInterval);
    setDeliveryScheduleSlotsState(finalSlots);
    updateStoreInfo({
      scheduleIntervalMinutes: safeInterval,
      deliveryScheduleSlots: JSON.stringify(finalSlots),
    });
  };

  const handleUpdateScheduleTimeBounds = (start: string, end: string) => {
    const oldGenerated = new Set(generateScheduleTimeSlots(scheduleIntervalMinutesState, scheduleStartTimeState, scheduleEndTimeState));
    setScheduleStartTimeState(start);
    setScheduleEndTimeState(end);
    const generated = generateScheduleTimeSlots(scheduleIntervalMinutesState, start, end);
    const prevSet = new Set(deliveryScheduleSlotsState);
    const nextSlots = generated.filter(s => prevSet.has(s) || !oldGenerated.has(s));
    setDeliveryScheduleSlotsState(nextSlots);
    updateStoreInfo({
      scheduleStartTime: start,
      scheduleEndTime: end,
      deliveryScheduleSlots: JSON.stringify(nextSlots),
    });
  };

  const handleUpdateScheduleSlotCapacities = (caps: Record<string, number>) => {
    setScheduleSlotCapacitiesState(caps);
    updateStoreInfo({ scheduleSlotCapacities: JSON.stringify(caps) });
  };

  const handleUpdateScheduleSlotCapacity = (cap: number) => {
    setScheduleSlotItemCapacityState(cap);
    updateStoreInfo({ scheduleSlotItemCapacity: cap });
  };

  const handleUpdateSchedulePrepTimeNormal = (min: number) => {
    setSchedulePrepTimeNormalMinutesState(min);
    updateStoreInfo({ schedulePrepTimeNormalMinutes: min });
  };

  const handleUpdateSchedulePrepTimeFrozen = (min: number) => {
    setSchedulePrepTimeFrozenMinutesState(min);
    updateStoreInfo({ schedulePrepTimeFrozenMinutes: min });
  };

  const handleToggleSalgadoPrepFrito = (val: boolean) => {
    setSalgadoPrepFritoEnabledState(val);
    updateStoreInfo({ salgadoPrepFritoEnabled: val });
  };

  const handleToggleSalgadoPrepAssado = (val: boolean) => {
    setSalgadoPrepAssadoEnabledState(val);
    updateStoreInfo({ salgadoPrepAssadoEnabled: val });
  };

  const handleToggleSalgadoPrepFritoCongelado = (val: boolean) => {
    setSalgadoPrepFritoCongeladoEnabledState(val);
    updateStoreInfo({ salgadoPrepFritoCongeladoEnabled: val });
  };

  const handleToggleSalgadoPrepAssadoCongelado = (val: boolean) => {
    setSalgadoPrepAssadoCongeladoEnabledState(val);
    updateStoreInfo({ salgadoPrepAssadoCongeladoEnabled: val });
  };

  const handleToggleKiosk = (val: boolean) => {
    setKioskEnabledState(val);
    updateStoreInfo({ kioskEnabled: val });
  };

  const handleToggleRequireQrCodeForOrdering = (val: boolean) => {
    setRequireQrCodeForOrderingState(val);
    updateStoreInfo({ requireQrCodeForOrdering: val });
  };

  const handleToggleMaintenance = (val: boolean) => {
    setIsMaintenanceState(val);
    updateStoreInfo({ isMaintenance: val });
  };

  const handleToggleAutoOpenClose = (val: boolean) => {
    setAutoOpenCloseState(val);
    updateStoreInfo({ autoOpenClose: val });
  };

  const handleToggleAiAgent = (val: boolean) => {
    setAiAgentEnabledState(val);
    updateStoreInfo({ aiAgentEnabled: val });
  };

  const handleToggleMercadoPago = (val: boolean) => {
    setMercadoPagoEnabledState(val);
    updateStoreInfo({ mercadoPagoEnabled: val });
  };

  const renderSettings = () => (
    <AdminSettingsCollapsible
      storeInfo={storeInfo}
      isMaster={isMaster}
      logoPreview={logoPreview}
      setLogoPreview={setLogoPreview}
      isSavingLogo={isSavingLogo}
      logoSavedSuccess={logoSavedSuccess}
      handleImageUpload={handleImageUpload}
      handleDirectSaveLogo={handleDirectSaveLogo}
      themeColor={themeColor}
      setThemeColor={setThemeColor}
      addButtonColor={addButtonColor}
      setAddButtonColor={setAddButtonColor}
      showSystemIntroButtonState={showSystemIntroButtonState}
      setShowSystemIntroButtonState={setShowSystemIntroButtonState}
      handleToggleShowSystemIntroButton={handleToggleShowSystemIntroButton}
      isOpenState={isOpenState}
      setIsOpenState={handleToggleIsOpen}
      forceOpenState={forceOpenState}
      setForceOpenState={handleToggleForceOpen}
      handleSetOperationMode={handleSetOperationMode}
      inStoreEnabledState={inStoreEnabledState}
      setInStoreEnabledState={handleToggleInStore}
      deliveryEnabledState={deliveryEnabledState}
      deliveryScheduleEnabledState={deliveryScheduleEnabledState}
      setDeliveryScheduleEnabledState={handleToggleDeliverySchedule}
      deliveryScheduleSlotsState={deliveryScheduleSlotsState}
      setDeliveryScheduleSlotsState={handleUpdateScheduleSlots}
      scheduleIntervalMinutesState={scheduleIntervalMinutesState}
      setScheduleIntervalMinutesState={handleUpdateScheduleInterval}
      scheduleStartTimeState={scheduleStartTimeState}
      scheduleEndTimeState={scheduleEndTimeState}
      onUpdateScheduleTimeBounds={handleUpdateScheduleTimeBounds}
      scheduleSlotCapacitiesState={scheduleSlotCapacitiesState}
      setScheduleSlotCapacitiesState={handleUpdateScheduleSlotCapacities}
      scheduleSlotItemCapacityState={scheduleSlotItemCapacityState}
      setScheduleSlotItemCapacityState={handleUpdateScheduleSlotCapacity}
      schedulePrepTimeNormalMinutesState={schedulePrepTimeNormalMinutesState}
      setSchedulePrepTimeNormalMinutesState={handleUpdateSchedulePrepTimeNormal}
      schedulePrepTimeFrozenMinutesState={schedulePrepTimeFrozenMinutesState}
      setSchedulePrepTimeFrozenMinutesState={handleUpdateSchedulePrepTimeFrozen}
      salgadoPrepFritoEnabledState={salgadoPrepFritoEnabledState}
      setSalgadoPrepFritoEnabledState={handleToggleSalgadoPrepFrito}
      salgadoPrepAssadoEnabledState={salgadoPrepAssadoEnabledState}
      setSalgadoPrepAssadoEnabledState={handleToggleSalgadoPrepAssado}
      salgadoPrepFritoCongeladoEnabledState={salgadoPrepFritoCongeladoEnabledState}
      setSalgadoPrepFritoCongeladoEnabledState={handleToggleSalgadoPrepFritoCongelado}
      salgadoPrepAssadoCongeladoEnabledState={salgadoPrepAssadoCongeladoEnabledState}
      setSalgadoPrepAssadoCongeladoEnabledState={handleToggleSalgadoPrepAssadoCongelado}
      setDeliveryEnabledState={handleToggleDelivery}
      kioskEnabledState={kioskEnabledState}
      setKioskEnabledState={handleToggleKiosk}
      requireQrCodeForOrderingState={requireQrCodeForOrderingState}
      setRequireQrCodeForOrderingState={handleToggleRequireQrCodeForOrdering}
      isMaintenanceState={isMaintenanceState}
      setIsMaintenanceState={handleToggleMaintenance}
      weeklyScheduleState={weeklyScheduleState}
      setWeeklyScheduleState={setWeeklyScheduleState}
      handleDayScheduleChange={handleDayScheduleChange}
      handleCopyWeekdayHours={handleCopyWeekdayHours}
      handleResetScheduleHours={handleResetScheduleHours}
      autoOpenCloseState={autoOpenCloseState}
      setAutoOpenCloseState={handleToggleAutoOpenClose}
      closedMessageState={closedMessageState}
      setClosedMessageState={setClosedMessageState}
      aiAgentEnabledState={aiAgentEnabledState}
      setAiAgentEnabledState={handleToggleAiAgent}
      aiAgentNameState={aiAgentNameState}
      setAiAgentNameState={setAiAgentNameState}
      aiAgentToneState={aiAgentToneState}
      setAiAgentToneState={setAiAgentToneState}
      aiAgentCustomPromptState={aiAgentCustomPromptState}
      setAiAgentCustomPromptState={setAiAgentCustomPromptState}
      aiAgentWhatsAppPhoneState={aiAgentWhatsAppPhoneState}
      setAiAgentWhatsAppPhoneState={setAiAgentWhatsAppPhoneState}
      aiAgentWhatsAppDefaultMessageState={aiAgentWhatsAppDefaultMessageState}
      setAiAgentWhatsAppDefaultMessageState={setAiAgentWhatsAppDefaultMessageState}
      aiAgentTrainingExamplesState={aiAgentTrainingExamplesState}
      setAiAgentTrainingExamplesState={setAiAgentTrainingExamplesState}
      aiAgentKnowledgeBaseState={aiAgentKnowledgeBaseState}
      setAiAgentKnowledgeBaseState={setAiAgentKnowledgeBaseState}
      aiAgentForbiddenPhrasesState={aiAgentForbiddenPhrasesState}
      setAiAgentForbiddenPhrasesState={setAiAgentForbiddenPhrasesState}
      aiAgentCreativityState={aiAgentCreativityState}
      setAiAgentCreativityState={setAiAgentCreativityState}
      aiAgentAntiRepeatState={aiAgentAntiRepeatState}
      setAiAgentAntiRepeatState={setAiAgentAntiRepeatState}
      isAiTestModalOpen={isAiTestModalOpen}
      setIsAiTestModalOpen={setIsAiTestModalOpen}
      blueFocusConfig={blueFocusConfig}
      setBlueFocusConfig={setBlueFocusConfig}
      onSaveBlueFocusStoreConfig={async (cfg) => {
        const res = await fetch('/api/db/store-info', {
          method: 'PUT',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            blueFocusExportConfig: serializeBlueFocusConfigForDb(
              cfg,
              cfg.autoSyncEnabled !== undefined ? Boolean(cfg.autoSyncEnabled) : isAutoSyncEnabled
            ),
          }),
        });
        if (!res.ok) {
          throw new Error(`Servidor retornou status ${res.status}`);
        }
        const updated = await res.json().catch(() => null);
        await updateStoreInfo({
          blueFocusExportConfig: updated?.blueFocusExportConfig || serializeBlueFocusConfigForDb(
            cfg,
            cfg.autoSyncEnabled !== undefined ? Boolean(cfg.autoSyncEnabled) : isAutoSyncEnabled
          ),
        });
      }}
      handleSyncBlueFocus={handleSyncBlueFocus}
      handleSyncCustomersBlueFocus={handleSyncCustomersBlueFocus}
      handleTestBlueFocus={handleTestBlueFocus}
      isTestingBlueFocus={isTestingBlueFocus}
      isSyncing={isSyncing}
      isAutoSyncEnabled={isAutoSyncEnabled}
      setIsAutoSyncEnabled={setIsAutoSyncEnabled}
      connectionStatus={connectionStatus}
      setConnectionStatus={setConnectionStatus}
      connectionErrorMessage={connectionErrorMessage}
      setConnectionErrorMessage={setConnectionErrorMessage}
      configuredPrintersState={configuredPrintersState}
      printerCutModeState={printerCutModeState}
      setPrinterCutModeState={setPrinterCutModeState}
      printerCopiesState={printerCopiesState}
      setPrinterCopiesState={setPrinterCopiesState}
      handleAddPrinter={handleAddPrinter}
      handleToggleOrderPrinter={handleToggleOrderPrinter}
      handleDeletePrinter={handleDeletePrinter}
      handleDirectSavePrinters={handleDirectSavePrinters}
      preferredPrinterNameState={preferredPrinterNameState}
      setPreferredPrinterNameState={setPreferredPrinterNameState}
      caixaPrinterNameState={caixaPrinterNameState}
      setCaixaPrinterNameState={setCaixaPrinterNameState}
      autoPrintOrdersOnCaixaState={autoPrintOrdersOnCaixaState}
      setAutoPrintOrdersOnCaixaState={setAutoPrintOrdersOnCaixaState}
      printerConnectionTypeState={printerConnectionTypeState}
      setPrinterConnectionTypeState={setPrinterConnectionTypeState}
      networkPrinterIpState={networkPrinterIpState}
      setNetworkPrinterIpState={setNetworkPrinterIpState}
      networkPrinterPortState={networkPrinterPortState}
      setNetworkPrinterPortState={setNetworkPrinterPortState}
      mercadoPagoEnabledState={mercadoPagoEnabledState}
      setMercadoPagoEnabledState={handleToggleMercadoPago}
      mercadoPagoAccessTokenState={mercadoPagoAccessTokenState}
      setMercadoPagoAccessTokenState={setMercadoPagoAccessTokenState}
      mercadoPagoPublicKeyState={mercadoPagoPublicKeyState}
      setMercadoPagoPublicKeyState={setMercadoPagoPublicKeyState}
      mercadoPagoPixKeyState={mercadoPagoPixKeyState}
      setMercadoPagoPixKeyState={setMercadoPagoPixKeyState}
      deliveryEstimatedTimeMinState={deliveryEstimatedTimeMinState}
      setDeliveryEstimatedTimeMinState={setDeliveryEstimatedTimeMinState}
      deliveryEstimatedTimeMaxState={deliveryEstimatedTimeMaxState}
      setDeliveryEstimatedTimeMaxState={setDeliveryEstimatedTimeMaxState}
      onlinePaymentEnabledState={onlinePaymentEnabledState}
      setOnlinePaymentEnabledState={setOnlinePaymentEnabledState}
      onlinePaymentOperatorState={onlinePaymentOperatorState}
      setOnlinePaymentOperatorState={setOnlinePaymentOperatorState}
      onlinePaymentPublicKeyState={onlinePaymentPublicKeyState}
      setOnlinePaymentPublicKeyState={setOnlinePaymentPublicKeyState}
      onlinePaymentSecretKeyState={onlinePaymentSecretKeyState}
      setOnlinePaymentSecretKeyState={setOnlinePaymentSecretKeyState}
      handleSaveSettings={handleSaveSettings}
    />
  );

  const _renderLegacySettings = () => (
    <div className="hidden max-w-4xl mx-auto space-y-8">
      <div className="flex items-center justify-between">
        <h2 className="text-3xl font-bold text-stone-800">Configurações da Loja</h2>
      </div>

      <div className="bg-white rounded-2xl shadow-sm p-8 border border-stone-100">
        <h3 className="text-lg font-bold text-stone-800 mb-6 flex items-center gap-2">
          <Settings className="w-5 h-5 text-orange-600" /> Informações Gerais
        </h3>
        <form onSubmit={handleSaveSettings} className="space-y-6">
          <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
            <div>
              <label className="block text-sm font-medium text-stone-700 mb-1">Nome da Loja</label>
              <input type="text" name="name" defaultValue={storeInfo.name} className="w-full p-3 border rounded-xl focus:ring-2 focus:ring-orange-500 outline-none" />
            </div>
            <div>
              <label className="block text-sm font-medium text-stone-700 mb-1">Frase de Destaque (Hero)</label>
              <input type="text" name="headerPhrase" defaultValue={storeInfo.headerPhrase} required className="w-full p-3 border rounded-xl focus:ring-2 focus:ring-orange-500 outline-none" />
            </div>
            <div>
              <label className="block text-sm font-medium text-stone-700 mb-1">WhatsApp</label>
              <input type="text" name="whatsapp" defaultValue={storeInfo.whatsapp} required className="w-full p-3 border rounded-xl focus:ring-2 focus:ring-orange-500 outline-none" />
            </div>
            <div>
              <label className="block text-sm font-medium text-stone-700 mb-1">Instagram</label>
              <input type="text" name="instagram" defaultValue={storeInfo.instagram} required className="w-full p-3 border rounded-xl focus:ring-2 focus:ring-orange-500 outline-none" />
            </div>
            <div className="md:col-span-2">
              <label className="block text-sm font-medium text-stone-700 mb-1">Endereço Completo</label>
              <input type="text" name="address" defaultValue={storeInfo.address} required className="w-full p-3 border rounded-xl focus:ring-2 focus:ring-orange-500 outline-none" />
            </div>
            <div className="md:col-span-2">
              <label className="block text-sm font-medium text-stone-700 mb-1">Horário de Funcionamento</label>
              <textarea name="hours" defaultValue={storeInfo.hours} required rows={3} className="w-full p-3 border rounded-xl focus:ring-2 focus:ring-orange-500 outline-none" />
            </div>
          </div>

          {isMaster && (
            <div className="pt-6 border-t">
              <h3 className="text-lg font-bold text-stone-800 mb-2 flex items-center gap-2">
                <Bell className="w-5 h-5 text-orange-600" /> Notificações Push (NTFY)
              </h3>
              <p className="text-xs text-stone-500 mb-4 leading-relaxed">
                Receba alertas instantâneos no seu celular (App NTFY no Android/iOS ou pelo navegador) quando novos clientes fizerem o cadastro de entrada e quando novos pedidos forem realizados.
              </p>
              
              <div className="bg-stone-50 p-4 rounded-xl border border-stone-200 space-y-4">
                <div className="flex items-center justify-between bg-white p-3.5 rounded-xl border border-stone-200">
                  <div className="pr-3">
                    <span className="text-sm font-bold text-stone-800 block">Status das Notificações PUSH</span>
                    <span className="text-xs text-stone-500">Ative para receber alertas no celular ou desative temporariamente para fazer testes sem notificações.</span>
                  </div>
                  <label className="relative inline-flex items-center cursor-pointer shrink-0">
                    <input 
                      type="checkbox" 
                      name="ntfyEnabled" 
                      defaultChecked={storeInfo.ntfyEnabled !== false} 
                      className="sr-only peer"
                    />
                    <div className="w-11 h-6 bg-stone-200 peer-focus:outline-none rounded-full peer peer-checked:after:translate-x-full peer-checked:after:border-white after:content-[''] after:absolute after:top-[2px] after:left-[2px] after:bg-white after:border-stone-300 after:border after:rounded-full after:h-5 after:w-5 after:transition-all peer-checked:bg-orange-600"></div>
                  </label>
                </div>

                <div>
                  <label className="block text-sm font-bold text-stone-700 mb-1">Tópico / Canal do NTFY</label>
                  <div className="flex flex-col sm:flex-row gap-2">
                    <div className="relative flex-1">
                      <span className="absolute left-3 top-3 text-stone-400 font-mono text-sm">ntfy.sh/</span>
                      <input 
                        type="text" 
                        name="ntfyTopic" 
                        id="ntfyTopicInput"
                        defaultValue={storeInfo.ntfyTopic || 'balbecrevenda_pedidos'} 
                        required 
                        className="w-full p-3 pl-20 border rounded-xl font-mono text-sm bg-white focus:ring-2 focus:ring-orange-500 outline-none" 
                        placeholder="balbecrevenda_pedidos"
                      />
                    </div>
                    <button
                      type="button"
                      onClick={async () => {
                        const input = document.getElementById('ntfyTopicInput') as HTMLInputElement;
                        const topic = input?.value?.trim() || storeInfo.ntfyTopic || 'balbecrevenda_pedidos';
                        const ok = await sendNtfyNotification({
                          topic,
                          title: '🥟 Teste de Notificação BALBEC',
                          message: 'Seu canal do NTFY está funcionando perfeitamente!',
                          priority: 4,
                          tags: ['tada', 'dumpling', 'white_check_mark']
                        });
                        if (ok) {
                          showInfoModal('Teste NTFY', `✅ Notificação de teste enviada com sucesso para https://ntfy.sh/${topic}!`);
                        } else {
                          showInfoModal('Falha no NTFY', `⚠️ Falha ao enviar notificação de teste para https://ntfy.sh/${topic}. Verifique sua conexão.`);
                        }
                      }}
                      className="px-4 py-3 bg-orange-600 hover:bg-orange-700 text-white rounded-xl font-bold text-xs flex items-center justify-center gap-2 transition-colors cursor-pointer shrink-0"
                    >
                      <Bell className="w-4 h-4" />
                      Enviar Notificação Teste
                    </button>
                  </div>
                  <p className="text-[11px] text-stone-500 mt-2">
                    💡 <strong>Como receber no celular:</strong> Instale o app <strong>ntfy</strong> (grátis na Play Store / App Store), clique em <strong>+ (Inscrever-se)</strong> e digite exatamente o nome do tópico acima (ex: <code>{storeInfo.ntfyTopic || 'balbecrevenda_pedidos'}</code>). Ou acesse direto pelo navegador em <a href={`https://ntfy.sh/${storeInfo.ntfyTopic || 'balbecrevenda_pedidos'}`} target="_blank" rel="noreferrer" className="text-orange-600 underline font-semibold">ntfy.sh/{storeInfo.ntfyTopic || 'balbecrevenda_pedidos'}</a>.
                  </p>
                </div>
              </div>
            </div>
          )}

            <div className="pt-6 border-t">
              <h3 className="text-lg font-bold text-stone-800 mb-2 flex items-center gap-2">
                <Printer className="w-5 h-5 text-orange-600" /> Lista e Seleção de Impressora Exclusiva de Pedidos
              </h3>
              <p className="text-xs text-stone-500 mb-4 leading-relaxed">
                Cadastre suas impressoras e marque com um <strong>checkbox</strong> qual delas será a responsável exclusiva por imprimir os pedidos. Assim, sua outra impressora padrão (usada para documentos, boletos e relatórios) não será misturada com as comandas.
              </p>

              <div className="bg-stone-50 p-4 rounded-2xl border border-stone-200 space-y-4">
                {/* Printers List */}
                <div className="space-y-2.5">
                  <label className="block text-xs font-bold text-stone-700">Impressoras Cadastradas:</label>
                  {configuredPrintersState.map((printer) => (
                    <div 
                      key={printer.id}
                      className={`p-3 rounded-xl border flex items-center justify-between gap-3 transition-colors ${
                        printer.isOrderPrinter 
                          ? 'bg-orange-50 border-orange-300 shadow-xs' 
                          : 'bg-white border-stone-200 hover:bg-stone-50'
                      }`}
                    >
                      <div className="flex items-center gap-3 flex-1 min-w-0">
                        <input
                          type="checkbox"
                          checked={printer.isOrderPrinter}
                          onChange={() => handleToggleOrderPrinter(printer.id)}
                          className="w-4 h-4 text-orange-600 rounded border-stone-300 focus:ring-orange-500 cursor-pointer"
                        />
                        <div className="min-w-0 flex-1">
                          <div className="text-xs font-bold text-stone-900 truncate flex items-center gap-2">
                            {printer.name}
                            {printer.isOrderPrinter && (
                              <span className="bg-orange-600 text-white text-[10px] px-2 py-0.5 rounded-full font-bold uppercase tracking-wider">
                                Exclusiva para Pedidos
                              </span>
                            )}
                          </div>
                          <div className="text-[11px] text-stone-500 font-mono">{printer.model}</div>
                        </div>
                      </div>

                      <div className="flex items-center gap-2 shrink-0">
                        <button
                          type="button"
                          onClick={() => handleDeletePrinter(printer.id)}
                          className="text-stone-400 hover:text-red-600 p-1.5 rounded-lg hover:bg-red-50 transition-colors text-xs font-bold cursor-pointer"
                          title="Remover Impressora"
                        >
                          Remover
                        </button>
                      </div>
                    </div>
                  ))}
                </div>

                <div className="pt-2 flex justify-end">
                  <button
                    type="button"
                    onClick={handleDirectSavePrinters}
                    className="bg-orange-600 hover:bg-orange-700 text-white px-5 py-2.5 rounded-xl text-xs font-bold transition-colors shadow-xs cursor-pointer flex items-center gap-1.5"
                  >
                    <Save className="w-3.5 h-3.5" /> Salvar Configuração de Impressoras
                  </button>
                </div>

                <p className="text-[11px] text-amber-800 bg-amber-50 p-3 rounded-xl border border-amber-200">
                  💡 <strong>Como funciona:</strong> Ao marcar o checkbox em uma impressora, ela passa a ser recomendada automaticamente sempre que você clicar em "Imprimir Cupom", mantendo sua outra impressora livre para documentos e outros serviços.
                </p>
              </div>
            </div>

          <div className="pt-6 border-t">
            <h3 className="text-lg font-bold text-stone-800 mb-6 flex items-center justify-between">
              <span>Identidade Visual</span>
              {logoSavedSuccess && (
                <span className="text-xs font-bold text-emerald-700 bg-emerald-100 border border-emerald-300 px-3 py-1 rounded-full animate-fade-in flex items-center gap-1.5">
                  <CheckCircle className="w-4 h-4 text-emerald-600" />
                  Logomarca salva com sucesso!
                </span>
              )}
            </h3>
            <div className="grid grid-cols-1 md:grid-cols-2 gap-8">
              <div className="space-y-4">
                <label className="block text-sm font-bold text-stone-700">Logo da Loja</label>
                
                <div className="flex flex-col sm:flex-row items-start sm:items-center gap-4 bg-stone-50 p-4 rounded-2xl border border-stone-200">
                  <div className="w-24 h-24 bg-stone-200/60 rounded-full border-2 border-dashed border-stone-300 flex items-center justify-center overflow-hidden shadow-inner group relative shrink-0">
                    {logoPreview ? (
                      <>
                        <img src={logoPreview} alt="Logo" className="w-full h-full object-cover rounded-full" />
                        <button 
                          type="button"
                          onClick={() => setLogoPreview('')}
                          className="absolute inset-0 bg-red-600/85 text-white opacity-0 group-hover:opacity-100 flex items-center justify-center transition-opacity text-[10px] font-bold uppercase cursor-pointer rounded-full"
                        >
                          Limpar
                        </button>
                      </>
                    ) : (
                      <Settings className="w-8 h-8 text-stone-300" />
                    )}
                  </div>
                  <div className="flex-1 space-y-2.5 w-full">
                    <div className="flex flex-wrap gap-2">
                      <input 
                        type="file" 
                        id="logo-upload"
                        accept="image/png,image/jpeg,image/svg+xml,image/webp,image/gif" 
                        onChange={(e) => handleImageUpload(e, setLogoPreview)}
                        className="hidden"
                      />
                      <label 
                        htmlFor="logo-upload"
                        className="inline-flex items-center gap-2 bg-orange-600 text-white px-4 py-2 rounded-xl text-xs font-bold hover:bg-orange-700 cursor-pointer transition-colors shadow-xs"
                      >
                        <RefreshCw className="w-3.5 h-3.5" />
                        Escolher Arquivo
                      </label>
                      
                      <button
                        type="button"
                        onClick={handleDirectSaveLogo}
                        disabled={isSavingLogo}
                        className="inline-flex items-center gap-1.5 bg-stone-900 text-white px-4 py-2 rounded-xl text-xs font-bold hover:bg-stone-800 disabled:opacity-50 cursor-pointer transition-all shadow-xs"
                      >
                        <Save className="w-3.5 h-3.5 text-amber-400" />
                        {isSavingLogo ? 'Salvando...' : 'Salvar Logomarca'}
                      </button>

                      {logoPreview !== '/logo.svg' && (
                        <button
                          type="button"
                          onClick={() => setLogoPreview('/logo.svg')}
                          className="text-[11px] font-semibold text-stone-600 hover:text-stone-900 px-2 py-1 underline cursor-pointer"
                        >
                          Usar Logo Padrão
                        </button>
                      )}
                    </div>

                    <div>
                      <input
                        type="text"
                        value={logoPreview || ''}
                        onChange={(e) => setLogoPreview(e.target.value)}
                        placeholder="Ou cole a URL da imagem aqui (https://...)"
                        className="w-full text-xs p-2.5 bg-white border border-stone-300 rounded-lg text-stone-700 outline-none focus:ring-2 focus:ring-orange-500 font-mono"
                      />
                    </div>
                    
                    <p className="text-[10px] text-stone-400 font-medium">PNG transparente, SVG ou JPG • Atualiza em tempo real em todas as telas</p>
                  </div>
                </div>
              </div>
              <div className="space-y-4">
                <div>
                  <label className="block text-sm font-medium text-stone-700 mb-1">Cor do Tema</label>
                  <div className="flex gap-3">
                    <input type="color" value={themeColor} onChange={(e) => setThemeColor(e.target.value)} className="h-10 w-20 rounded-lg cursor-pointer" />
                    <input type="text" value={themeColor} onChange={(e) => setThemeColor(e.target.value)} className="flex-1 p-2 border rounded-lg text-sm font-mono" />
                  </div>
                </div>
                <div>
                  <label className="block text-sm font-medium text-stone-700 mb-1">Cor do Botão "Adicionar"</label>
                  <div className="flex gap-3">
                    <input type="color" value={addButtonColor} onChange={(e) => setAddButtonColor(e.target.value)} className="h-10 w-20 rounded-lg cursor-pointer" />
                    <input type="text" value={addButtonColor} onChange={(e) => setAddButtonColor(e.target.value)} className="flex-1 p-2 border rounded-lg text-sm font-mono" />
                  </div>
                </div>
              </div>
            </div>
          </div>

          {/* Botão Flutuante: Conhecer o Sistema */}
          <div className="pt-6 border-t">
            <h3 className="text-lg font-bold text-stone-800 mb-2 flex items-center gap-2">
              <Sparkles className="w-5 h-5 text-amber-500" />
              Botão Flutuante "Conhecer o Sistema"
            </h3>
            <p className="text-xs text-stone-500 mb-4">
              Ative ou desative o botão flutuante que aparece no canto inferior do cardápio convidando clientes a conhecerem as funcionalidades e entrar em contato pelo WhatsApp.
            </p>

            <label className="flex items-center justify-between p-4 bg-gradient-to-r from-amber-50/70 to-orange-50/50 hover:bg-amber-100/60 rounded-2xl border border-amber-200 cursor-pointer transition-colors shadow-xs">
              <div className="space-y-1 pr-3">
                <div className="flex items-center gap-2 flex-wrap">
                  <span className="text-sm font-bold text-stone-900">
                    Exibir Botão Flutuante (CLIQUE PARA CONHECER ESSE SISTEMA)
                  </span>
                  <span className={`text-[10px] font-bold px-2 py-0.5 rounded-full ${
                    showSystemIntroButtonState 
                      ? 'bg-emerald-100 text-emerald-800 border border-emerald-300' 
                      : 'bg-stone-200 text-stone-600 border border-stone-300'
                  }`}>
                    {showSystemIntroButtonState ? 'Ativado (Visível no Cardápio)' : 'Desativado (Oculto)'}
                  </span>
                </div>
                <p className="text-xs text-stone-600">
                  Ao desativar, o botão flutuante e a janela de apresentação não serão exibidos no cardápio público dos clientes.
                </p>
              </div>
              <div className="relative shrink-0">
                <input 
                  type="checkbox" 
                  name="showSystemIntroButton" 
                  checked={showSystemIntroButtonState}
                  onChange={(e) => handleToggleShowSystemIntroButton(e.target.checked)}
                  className="sr-only peer"
                />
                <div className="w-12 h-7 bg-stone-300 peer-focus:outline-none rounded-full peer peer-checked:after:translate-x-full peer-checked:after:border-white after:content-[''] after:absolute after:top-[2px] after:left-[2px] after:bg-white after:border-stone-300 after:border after:rounded-full after:h-6 after:w-6 after:transition-all peer-checked:bg-green-600"></div>
              </div>
            </label>
          </div>

          <div className="pt-6 border-t">
            <h3 className="text-lg font-bold text-stone-800 mb-4">Status e Canais de Venda da Loja</h3>
            <p className="text-xs text-stone-500 mb-4">
              Defina de forma independente quais canais estão liberados para receber pedidos. Se um canal estiver desligado, ele funcionará apenas em modo de visualização.
            </p>
            {/* Explicação da Regra de Abertura Automática vs Manual */}
            <div className="mb-3 p-3 bg-amber-50/80 rounded-xl border border-amber-200 text-xs text-amber-900 space-y-1">
              <p className="font-bold flex items-center gap-1.5 text-amber-950">
                <Clock className="w-3.5 h-3.5 text-amber-700" />
                Regra de Atendimento dos Canais:
              </p>
              <ul className="text-[11px] list-disc list-inside space-y-0.5 text-amber-900">
                <li><strong>Consumo na Loja e Totem:</strong> Abrem e fecham <u>automaticamente</u> de acordo com a escala de horários da loja física ({getStoreCurrentStatus(weeklyScheduleState, isOpenState, true).isWithinSchedule ? '🟢 Aberto Agora' : '🔴 Fechado Fora do Horário'}).</li>
                <li><strong>Loja Geral:</strong> Abertura e fechamento <u>manual</u> pelo botão abaixo.</li>
              </ul>
            </div>

            <div className="flex flex-col gap-3.5">
              {/* Loja Aberta */}
              <label className="flex items-center justify-between p-3.5 bg-stone-50 hover:bg-stone-100/80 rounded-2xl border border-stone-200 cursor-pointer transition-colors">
                <div>
                  <div className="flex items-center gap-2">
                    <span className="text-sm font-bold text-stone-800">Loja Aberta (Geral)</span>
                    <span className={`text-[10px] font-bold px-2 py-0.5 rounded-full ${isOpenState ? 'bg-emerald-100 text-emerald-800' : 'bg-rose-100 text-rose-800'}`}>
                      {isOpenState ? 'Aberto (Manual)' : 'Fechado (Manual)'}
                    </span>
                  </div>
                  <span className="text-xs text-stone-500">Interruptor mestre manual. Se desativado, o cardápio inteiro entra em modo fechado.</span>
                </div>
                <div className="relative">
                  <input 
                    type="checkbox" 
                    name="isOpen" 
                    checked={isOpenState}
                    onChange={(e) => handleToggleIsOpen(e.target.checked)}
                    className="sr-only peer"
                  />
                  <div className="w-12 h-7 bg-stone-300 peer-focus:outline-none rounded-full peer peer-checked:after:translate-x-full peer-checked:after:border-white after:content-[''] after:absolute after:top-[2px] after:left-[2px] after:bg-white after:border-stone-300 after:border after:rounded-full after:h-6 after:w-6 after:transition-all peer-checked:bg-green-500"></div>
                </div>
              </label>

              {/* Consumo no Local */}
              <label className="flex items-center justify-between p-3.5 bg-stone-50 hover:bg-stone-100/80 rounded-2xl border border-stone-200 cursor-pointer transition-colors">
                <div>
                  <div className="flex items-center gap-2">
                    <span className="text-sm font-bold text-stone-800">Consumo na Loja (Mesa / Balcão)</span>
                    <span className={`text-[10px] font-bold px-2 py-0.5 rounded-full ${
                      !inStoreEnabledState 
                        ? 'bg-stone-200 text-stone-600'
                        : getStoreCurrentStatus(weeklyScheduleState, isOpenState, true).isWithinSchedule
                          ? 'bg-emerald-100 text-emerald-800'
                          : 'bg-amber-100 text-amber-800'
                    }`}>
                      {!inStoreEnabledState 
                        ? 'Desativado' 
                        : getStoreCurrentStatus(weeklyScheduleState, isOpenState, true).isWithinSchedule
                          ? 'Aberto Automático'
                          : 'Fechado Fora do Horário'}
                    </span>
                  </div>
                  <span className="text-xs text-stone-500">Abre e fecha automaticamente de acordo com o horário de atendimento da loja física.</span>
                </div>
                <div className="relative">
                  <input 
                    type="checkbox" 
                    name="inStoreEnabled" 
                    checked={inStoreEnabledState}
                    onChange={(e) => setInStoreEnabledState(e.target.checked)}
                    className="sr-only peer"
                  />
                  <div className="w-12 h-7 bg-stone-300 peer-focus:outline-none rounded-full peer peer-checked:after:translate-x-full peer-checked:after:border-white after:content-[''] after:absolute after:top-[2px] after:left-[2px] after:bg-white after:border-stone-300 after:border after:rounded-full after:h-6 after:w-6 after:transition-all peer-checked:bg-amber-600"></div>
                </div>
              </label>

              {/* Totem */}
              <label className="flex items-center justify-between p-3.5 bg-stone-50 rounded-2xl border border-stone-200 opacity-60">
                <div>
                  <div className="flex items-center gap-2">
                    <span className="text-sm font-bold text-stone-800">Totem de Autoatendimento (Desativado)</span>
                  </div>
                  <span className="text-xs text-stone-500">Função de totem desativada.</span>
                </div>
                <div className="relative">
                  <input 
                    type="checkbox" 
                    checked={false}
                    disabled={true}
                    className="sr-only"
                  />
                  <div className="w-12 h-7 bg-stone-200 rounded-full"></div>
                </div>
              </label>

              <div className="pt-3 flex flex-wrap items-center justify-between gap-3 bg-blue-50/50 p-4 rounded-2xl border border-blue-100">
                <div>
                  <p className="text-xs font-bold text-blue-900 mb-0.5">
                    Link direto do Totem: <span className="font-mono text-blue-700 font-normal">/totem</span>
                  </p>
                  <p className="text-[11px] text-stone-500">
                    Abra este link em tela cheia no tablet ou monitor touch do seu totem.
                  </p>
                </div>
                <div className="flex items-center gap-2">
                  <a
                    href="/totem"
                    target="_blank"
                    rel="noreferrer"
                    className="bg-blue-600 text-white px-4 py-2 rounded-xl font-bold text-xs hover:bg-blue-700 transition-all flex items-center gap-1.5 shadow-xs"
                  >
                    <span>📱</span>
                    Abrir Totem
                  </a>
                  <button
                    type="button"
                    onClick={() => {
                      navigator.clipboard.writeText(`${window.location.origin}/totem`);
                      showInfoModal('Link Copiado', 'Link do Totem copiado com sucesso!');
                    }}
                    className="bg-white text-stone-700 border border-stone-300 px-3 py-2 rounded-xl font-bold text-xs hover:bg-stone-50 transition-all cursor-pointer"
                  >
                    Copiar Link
                  </button>
                </div>
              </div>
            </div>

            {/* Subseção de Segurança: Validação de Presença para Consumo na Loja */}
            <div className="mt-6 p-4 sm:p-5 bg-amber-50/40 rounded-3xl border border-amber-200/80 space-y-5">
              <div className="flex items-start sm:items-center justify-between gap-3">
                <div className="flex items-center gap-2.5">
                  <div className="w-10 h-10 rounded-2xl bg-amber-100 border border-amber-300 flex items-center justify-center text-amber-900 shadow-xs">
                    <ShieldCheck className="w-5 h-5 text-amber-700" />
                  </div>
                  <div>
                    <h4 className="text-base font-extrabold text-stone-900">
                      Validação de Presença na Loja
                    </h4>
                    <p className="text-xs text-stone-600">
                      Restrinja pedidos de consumo na loja para garantir que o cliente está presencialmente no local.
                    </p>
                  </div>
                </div>
              </div>

              {/* OPÇÃO 1: Validação por Geolocalização / GPS */}
              <div className="bg-white p-4 rounded-2xl border border-amber-200 shadow-xs space-y-4">
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-2">
                    <MapPin className="w-5 h-5 text-amber-600" />
                    <div>
                      <span className="text-sm font-bold text-stone-800 block">
                        Opção 1: Validação por Geolocalização (GPS da Loja)
                      </span>
                      <span className="text-xs text-stone-500">
                        Bloqueia pedidos de consumo na loja se o cliente estiver fora do raio configurado.
                      </span>
                    </div>
                  </div>
                  <label className="relative cursor-pointer">
                    <input 
                      type="checkbox" 
                      name="inStoreGpsValidation" 
                      checked={inStoreGpsValidationState}
                      onChange={(e) => setInStoreGpsValidationState(e.target.checked)}
                      className="sr-only peer"
                    />
                    <div className="w-12 h-7 bg-stone-300 peer-focus:outline-none rounded-full peer peer-checked:after:translate-x-full peer-checked:after:border-white after:content-[''] after:absolute after:top-[2px] after:left-[2px] after:bg-white after:border-stone-300 after:border after:rounded-full after:h-6 after:w-6 after:transition-all peer-checked:bg-amber-600"></div>
                  </label>
                </div>

                {inStoreGpsValidationState && (
                  <div className="pt-3 border-t border-stone-100 space-y-4">
                    <div className="flex flex-wrap items-center justify-between gap-2 p-3 bg-amber-50 rounded-xl text-xs text-amber-900 border border-amber-200/70">
                      <span>
                        📍 Quando o cliente pedir para <strong>Consumo no Local</strong>, o sistema checará o GPS do celular dele.
                      </span>
                      <button
                        type="button"
                        onClick={handleCaptureStoreGps}
                        disabled={isCapturingStoreGps}
                        className="bg-amber-600 hover:bg-amber-700 active:bg-amber-800 text-white font-bold px-3 py-1.5 rounded-lg flex items-center gap-1.5 transition-all shadow-xs cursor-pointer disabled:opacity-50"
                      >
                        <LocateFixed className={`w-3.5 h-3.5 ${isCapturingStoreGps ? 'animate-spin' : ''}`} />
                        <span>{isCapturingStoreGps ? 'Capturando GPS...' : '📍 Capturar GPS Atual da Loja'}</span>
                      </button>
                    </div>

                    <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
                      <div>
                        <label className="block text-xs font-bold text-stone-700 mb-1">
                          Latitude da Loja
                        </label>
                        <input
                          type="number"
                          step="0.000001"
                          value={inStoreLatitudeState}
                          onChange={(e) => setInStoreLatitudeState(parseFloat(e.target.value) || 0)}
                          className="w-full p-2.5 bg-stone-50 border border-stone-300 rounded-xl text-xs font-mono text-stone-800 focus:bg-white focus:ring-2 focus:ring-amber-500"
                          placeholder="-19.7478"
                        />
                      </div>
                      <div>
                        <label className="block text-xs font-bold text-stone-700 mb-1">
                          Longitude da Loja
                        </label>
                        <input
                          type="number"
                          step="0.000001"
                          value={inStoreLongitudeState}
                          onChange={(e) => setInStoreLongitudeState(parseFloat(e.target.value) || 0)}
                          className="w-full p-2.5 bg-stone-50 border border-stone-300 rounded-xl text-xs font-mono text-stone-800 focus:bg-white focus:ring-2 focus:ring-amber-500"
                          placeholder="-47.9392"
                        />
                      </div>
                      <div>
                        <label className="block text-xs font-bold text-stone-700 mb-1">
                          Raio Máximo Permitido (Metros)
                        </label>
                        <div className="flex items-center gap-2">
                          <input
                            type="number"
                            min="20"
                            max="2000"
                            step="10"
                            value={inStoreMaxRadiusMetersState}
                            onChange={(e) => setInStoreMaxRadiusMetersState(parseInt(e.target.value, 10) || 150)}
                            className="w-full p-2.5 bg-stone-50 border border-stone-300 rounded-xl text-xs font-mono text-stone-800 focus:bg-white focus:ring-2 focus:ring-amber-500"
                            placeholder="150"
                          />
                          <span className="text-xs text-stone-500 font-bold">metros</span>
                        </div>
                      </div>
                    </div>

                    <div className="flex items-center gap-1.5 flex-wrap text-[11px] text-stone-500">
                      <span>Sugestões de raio:</span>
                      {[50, 100, 150, 250, 500].map(r => (
                        <button
                          key={r}
                          type="button"
                          onClick={() => setInStoreMaxRadiusMetersState(r)}
                          className={`px-2 py-0.5 rounded-md border text-[10px] font-bold cursor-pointer transition-colors ${
                            inStoreMaxRadiusMetersState === r
                              ? 'bg-amber-600 text-white border-amber-600'
                              : 'bg-stone-100 hover:bg-stone-200 text-stone-700 border-stone-300'
                          }`}
                        >
                          {r}m
                        </button>
                      ))}
                    </div>
                  </div>
                )}
              </div>

              {/* OPÇÃO 3: Validação por Código / PIN do Balcão */}
              <div className="bg-white p-4 rounded-2xl border border-amber-200 shadow-xs space-y-4">
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-2">
                    <KeyRound className="w-5 h-5 text-amber-600" />
                    <div>
                      <div className="flex items-center gap-2">
                        <span className="text-sm font-bold text-stone-800 block">
                          Opção 3: Validação por Código / PIN do Balcão
                        </span>
                        <span className={`text-[10px] font-bold px-2 py-0.5 rounded-full ${inStorePinValidationState ? 'bg-emerald-100 text-emerald-800' : 'bg-stone-200 text-stone-600'}`}>
                          {inStorePinValidationState ? 'Habilitado' : 'Desabilitado'}
                        </span>
                      </div>
                      <span className="text-xs text-stone-500">
                        Exige que o cliente digite uma senha/código diário informado no balcão ou nas mesas para finalizar o pedido.
                      </span>
                    </div>
                  </div>
                  <label className="relative cursor-pointer">
                    <input 
                      type="checkbox" 
                      name="inStorePinValidation" 
                      checked={inStorePinValidationState}
                      onChange={(e) => setInStorePinValidationState(e.target.checked)}
                      className="sr-only peer"
                    />
                    <div className="w-12 h-7 bg-stone-300 peer-focus:outline-none rounded-full peer peer-checked:after:translate-x-full peer-checked:after:border-white after:content-[''] after:absolute after:top-[2px] after:left-[2px] after:bg-white after:border-stone-300 after:border after:rounded-full after:h-6 after:w-6 after:transition-all peer-checked:bg-emerald-600"></div>
                  </label>
                </div>

                {inStorePinValidationState && (
                  <div className="pt-3 border-t border-stone-100 space-y-3">
                    <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
                      <div className="flex-1">
                        <label className="block text-xs font-bold text-stone-700 mb-1">
                          Código / PIN de Validação na Loja
                        </label>
                        <div className="flex items-center gap-2">
                          <input
                            type="text"
                            maxLength={10}
                            value={inStorePinCodeState}
                            onChange={(e) => setInStorePinCodeState(e.target.value.toUpperCase())}
                            className="w-48 p-2.5 bg-stone-50 border border-stone-300 rounded-xl text-center font-mono font-black text-lg tracking-widest text-stone-900 focus:bg-white focus:ring-2 focus:ring-emerald-500 uppercase"
                            placeholder="1234"
                          />
                          <button
                            type="button"
                            onClick={() => {
                              const randomPin = String(Math.floor(1000 + Math.random() * 9000));
                              setInStorePinCodeState(randomPin);
                            }}
                            className="text-xs bg-stone-100 hover:bg-stone-200 text-stone-700 px-3 py-2 rounded-xl font-bold border border-stone-300 cursor-pointer transition-colors"
                          >
                            Gerar Novo PIN Aleatório
                          </button>
                        </div>
                      </div>
                      <div className="text-xs text-stone-500 bg-stone-50 p-3 rounded-xl border border-stone-200 sm:max-w-xs">
                        💡 Coloque esse código em uma plaquinha no balcão ou nas mesas. Apenas quem está no local saberá o código.
                      </div>
                    </div>
                  </div>
                )}
              </div>
            </div>
          </div>

          {/* Seção de Manutenção do Sistema / Cardápio */}
          <div className="pt-6 border-t">
            <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2 mb-3">
              <h3 className="text-lg font-bold text-stone-800 flex items-center gap-2">
                <Wrench className="w-5 h-5 text-amber-600" />
                Página em Manutenção
              </h3>
              <span className={`text-xs font-bold px-3 py-1 rounded-full inline-flex items-center gap-1.5 w-fit ${
                isMaintenanceState 
                  ? 'bg-amber-100 text-amber-900 border border-amber-300 animate-pulse' 
                  : 'bg-stone-100 text-stone-600'
              }`}>
                <span className={`w-2 h-2 rounded-full ${isMaintenanceState ? 'bg-amber-500' : 'bg-stone-400'}`}></span>
                {isMaintenanceState ? 'Manutenção ATIVADA' : 'Cardápio Normal / Online'}
              </span>
            </div>
            
            <p className="text-xs text-stone-500 mb-4">
              Ative esta opção quando precisar corrigir preços, atualizar o cardápio ou fazer ajustes antes de liberar o acesso ao público. Os clientes verão uma tela amigável de manutenção com seus contatos (WhatsApp, horário e endereço).
            </p>

            <div className="p-5 rounded-2xl bg-amber-500/5 border border-amber-500/20 space-y-4">
              <label className="flex items-center gap-3 cursor-pointer">
                <div className="relative">
                  <input 
                    type="checkbox" 
                    name="isMaintenance" 
                    checked={isMaintenanceState}
                    onChange={(e) => setIsMaintenanceState(e.target.checked)}
                    className="sr-only peer"
                  />
                  <div className="w-12 h-7 bg-stone-300 peer-focus:outline-none rounded-full peer peer-checked:after:translate-x-full peer-checked:after:border-white after:content-[''] after:absolute after:top-[2px] after:left-[2px] after:bg-white after:border-stone-300 after:border after:rounded-full after:h-6 after:w-6 after:transition-all peer-checked:bg-amber-600"></div>
                </div>
                <div>
                  <span className="text-sm font-bold text-stone-800">Ativar Página de Manutenção</span>
                  <p className="text-xs text-stone-500">Bloqueia o cardápio digital temporariamente para o público geral.</p>
                </div>
              </label>

              <div>
                <label className="block text-xs font-bold uppercase tracking-wider text-stone-700 mb-1.5">
                  Mensagem exibida aos clientes na tela de manutenção
                </label>
                <textarea
                  name="maintenanceMessage"
                  defaultValue={storeInfo.maintenanceMessage || 'Estamos atualizando nosso cardápio e sistemas para melhor atendê-lo. Voltaremos em breve!'}
                  rows={3}
                  className="w-full p-3 border border-stone-300 rounded-xl focus:ring-2 focus:ring-amber-500 outline-none text-sm text-stone-800 bg-white"
                  placeholder="Ex: Estamos atualizando nossos produtos e preços. Para dúvidas ou pedidos urgentes, entre em contato pelo nosso WhatsApp!"
                />
              </div>

              <div className="flex flex-wrap items-center gap-3 pt-1">
                <a
                  href="/?bypass_maintenance=1"
                  target="_blank"
                  rel="noopener noreferrer"
                  className="text-xs font-bold text-stone-700 bg-white hover:bg-stone-100 border border-stone-300 px-3.5 py-2 rounded-xl transition-all flex items-center gap-1.5 shadow-xs"
                >
                  <Eye className="w-4 h-4 text-stone-500" />
                  <span>Testar Cardápio (Modo Bypass Admin)</span>
                </a>
                <a
                  href="/"
                  target="_blank"
                  rel="noopener noreferrer"
                  className="text-xs font-bold text-amber-800 bg-amber-100 hover:bg-amber-200 border border-amber-300 px-3.5 py-2 rounded-xl transition-all flex items-center gap-1.5 shadow-xs"
                >
                  <Wrench className="w-4 h-4 text-amber-700" />
                  <span>Ver Página de Manutenção Pública</span>
                </a>
              </div>
            </div>
          </div>

          {/* Seção de Horários por Dia da Semana */}
          <div className="pt-6 border-t">
            <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 mb-3">
              <div>
                <h3 className="text-lg font-bold text-stone-800 flex items-center gap-2">
                  <Calendar className="w-5 h-5 text-orange-600" />
                  Horários de Funcionamento por Dia da Semana
                </h3>
                <p className="text-xs text-stone-500 mt-0.5">
                  Configure a escala semanal completa de abertura, fechamento e intervalos de almoço.
                </p>
              </div>

              {/* Status ao vivo hoje */}
              {(() => {
                const currentStatus = getStoreCurrentStatus(weeklyScheduleState, isOpenState, autoOpenCloseState);
                return (
                  <div className="flex items-center gap-2">
                    <span className={`text-xs font-bold px-3 py-1 rounded-full flex items-center gap-1.5 ${
                      currentStatus.isOpenNow 
                        ? 'bg-emerald-100 text-emerald-800 border border-emerald-300' 
                        : 'bg-stone-100 text-stone-700 border border-stone-300'
                    }`}>
                      <span className={`w-2 h-2 rounded-full ${currentStatus.isOpenNow ? 'bg-emerald-500 animate-pulse' : 'bg-stone-400'}`}></span>
                      Hoje: {currentStatus.statusBadge}
                    </span>
                  </div>
                );
              })()}
            </div>

            {/* Controle de Abertura/Fechamento Automático */}
            <div className="bg-orange-50/60 p-4 rounded-2xl border border-orange-200/80 mb-4 space-y-3">
              <label className="flex items-center justify-between cursor-pointer">
                <div>
                  <div className="flex items-center gap-2">
                    <Clock className="w-4 h-4 text-orange-600" />
                    <span className="text-sm font-bold text-stone-800">Abertura e Fechamento Automático</span>
                    <span className={`text-[10px] font-bold px-2 py-0.5 rounded-full ${autoOpenCloseState ? 'bg-emerald-100 text-emerald-800' : 'bg-stone-200 text-stone-600'}`}>
                      {autoOpenCloseState ? 'Ativo (Relógio Automático)' : 'Desativado (Controle Manual)'}
                    </span>
                  </div>
                  <p className="text-xs text-stone-600 mt-0.5">
                    Quando ativo, o cardápio e os pedidos abrem e fecham automaticamente nos horários definidos abaixo, sem você precisar alternar manualmente.
                  </p>
                </div>
                <div className="relative shrink-0 ml-4">
                  <input 
                    type="checkbox" 
                    checked={autoOpenCloseState}
                    onChange={(e) => setAutoOpenCloseState(e.target.checked)}
                    className="sr-only peer"
                  />
                  <div className="w-12 h-7 bg-stone-300 peer-focus:outline-none rounded-full peer peer-checked:after:translate-x-full peer-checked:after:border-white after:content-[''] after:absolute after:top-[2px] after:left-[2px] after:bg-white after:border-stone-300 after:border after:rounded-full after:h-6 after:w-6 after:transition-all peer-checked:bg-orange-600"></div>
                </div>
              </label>

              <div>
                <label className="block text-xs font-bold uppercase tracking-wider text-stone-700 mb-1">
                  Mensagem exibida aos clientes quando a loja estiver fechada
                </label>
                <input
                  type="text"
                  value={closedMessageState}
                  onChange={(e) => setClosedMessageState(e.target.value)}
                  className="w-full p-2.5 border border-stone-300 rounded-xl bg-white text-xs text-stone-800 focus:ring-2 focus:ring-orange-500 outline-none"
                  placeholder="Ex: Estamos fechados no momento. Abrimos novamente amanhã às 06:00!"
                />
              </div>
            </div>

            {/* Ações Rápidas de Horário */}
            <div className="flex flex-wrap items-center justify-between gap-2 mb-3">
              <span className="text-xs font-bold text-stone-600 uppercase tracking-wider">Escala dos Dias</span>
              <div className="flex flex-wrap items-center gap-2">
                <button
                  type="button"
                  onClick={() => handleCopyWeekdayHours(1)}
                  className="text-xs bg-stone-100 hover:bg-orange-100 hover:text-orange-800 text-stone-700 px-3 py-1.5 rounded-lg border border-stone-200 font-semibold transition-all flex items-center gap-1.5 cursor-pointer"
                  title="Copia o horário de Segunda-feira para Terça, Quarta, Quinta e Sexta"
                >
                  <Copy className="w-3.5 h-3.5" />
                  Copiar Seg para Ter-Sex
                </button>
                <button
                  type="button"
                  onClick={handleResetScheduleHours}
                  className="text-xs bg-stone-100 hover:bg-stone-200 text-stone-600 px-3 py-1.5 rounded-lg border border-stone-200 font-semibold transition-all flex items-center gap-1.5 cursor-pointer"
                  title="Restaura horários padrões (Seg-Sáb 06h às 20h / Dom 07h às 13h)"
                >
                  <RefreshCw className="w-3.5 h-3.5" />
                  Padrão da Loja
                </button>
                <button
                  type="button"
                  disabled={isSaving}
                  onClick={handleDirectSaveSchedule}
                  className="text-xs bg-emerald-600 hover:bg-emerald-700 active:scale-98 text-white px-3.5 py-1.5 rounded-lg font-bold transition-all flex items-center gap-1.5 shadow-sm cursor-pointer disabled:opacity-50"
                  title="Gravar horários no banco de dados e sincronizar com todos os celulares e computadores"
                >
                  <CheckCircle2 className="w-3.5 h-3.5" />
                  Salvar Horários
                </button>
              </div>
            </div>

            {/* Tabela Interativa de Dias da Semana */}
            <div className="space-y-2">
              {weeklyScheduleState.map((day) => (
                <div 
                  key={day.dayOfWeek}
                  className={`p-3.5 rounded-xl border transition-all ${
                    day.isOpen 
                      ? 'bg-white border-stone-200 shadow-2xs' 
                      : 'bg-stone-50/70 border-stone-200/60 opacity-80'
                  }`}
                >
                  <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
                    {/* Dia & Toggle */}
                    <div className="flex items-center gap-3 min-w-[160px]">
                      <label className="relative inline-flex items-center cursor-pointer">
                        <input
                          type="checkbox"
                          checked={day.isOpen}
                          onChange={(e) => handleDayScheduleChange(day.dayOfWeek, 'isOpen', e.target.checked)}
                          className="sr-only peer"
                        />
                        <div className="w-9 h-5 bg-stone-300 peer-focus:outline-none rounded-full peer peer-checked:after:translate-x-full peer-checked:after:border-white after:content-[''] after:absolute after:top-[2px] after:left-[2px] after:bg-white after:border-stone-300 after:border after:rounded-full after:h-4 after:w-4 after:transition-all peer-checked:bg-emerald-600"></div>
                      </label>
                      <div>
                        <span className={`text-sm font-bold ${day.isOpen ? 'text-stone-800' : 'text-stone-400 line-through'}`}>
                          {day.dayName}
                        </span>
                        <span className={`ml-2 text-[10px] font-bold px-2 py-0.5 rounded-full ${
                          day.isOpen ? 'bg-emerald-50 text-emerald-700' : 'bg-stone-200 text-stone-600'
                        }`}>
                          {day.isOpen ? 'Aberto' : 'Fechado'}
                        </span>
                      </div>
                    </div>

                    {/* Inputs de Horário */}
                    {day.isOpen ? (
                      <div className="flex flex-wrap items-center gap-2 sm:gap-3 text-xs">
                        <div className="flex items-center gap-1.5">
                          <span className="text-stone-500 font-medium">Abre:</span>
                          <input
                            type="time"
                            value={day.openTime}
                            onChange={(e) => handleDayScheduleChange(day.dayOfWeek, 'openTime', e.target.value)}
                            className="p-1.5 px-2 bg-stone-50 border border-stone-300 rounded-lg font-mono font-bold text-stone-800 focus:bg-white focus:ring-2 focus:ring-orange-500 outline-none"
                          />
                        </div>
                        <span className="text-stone-400 font-bold">às</span>
                        <div className="flex items-center gap-1.5">
                          <span className="text-stone-500 font-medium">Fecha:</span>
                          <input
                            type="time"
                            value={day.closeTime}
                            onChange={(e) => handleDayScheduleChange(day.dayOfWeek, 'closeTime', e.target.value)}
                            className="p-1.5 px-2 bg-stone-50 border border-stone-300 rounded-lg font-mono font-bold text-stone-800 focus:bg-white focus:ring-2 focus:ring-orange-500 outline-none"
                          />
                        </div>

                        {/* Intervalo de Almoço Opcional */}
                        <div className="flex items-center gap-2 pl-2 border-l border-stone-200">
                          <label className="flex items-center gap-1 cursor-pointer text-stone-500 hover:text-stone-800">
                            <input
                              type="checkbox"
                              checked={!!day.hasBreak}
                              onChange={(e) => handleDayScheduleChange(day.dayOfWeek, 'hasBreak', e.target.checked)}
                              className="rounded text-orange-600 focus:ring-orange-500 w-3.5 h-3.5"
                            />
                            <span className="text-[11px]">Intervalo</span>
                          </label>

                          {day.hasBreak && (
                            <div className="flex items-center gap-1">
                              <input
                                type="time"
                                value={day.breakStart || '12:00'}
                                onChange={(e) => handleDayScheduleChange(day.dayOfWeek, 'breakStart', e.target.value)}
                                className="p-1 px-1.5 bg-stone-50 border border-stone-300 rounded text-[11px] font-mono text-stone-800"
                              />
                              <span className="text-stone-400">-</span>
                              <input
                                type="time"
                                value={day.breakEnd || '13:30'}
                                onChange={(e) => handleDayScheduleChange(day.dayOfWeek, 'breakEnd', e.target.value)}
                                className="p-1 px-1.5 bg-stone-50 border border-stone-300 rounded text-[11px] font-mono text-stone-800"
                              />
                            </div>
                          )}
                        </div>
                      </div>
                    ) : (
                      <span className="text-xs text-stone-400 italic">Sem atendimento neste dia</span>
                    )}
                  </div>
                </div>
              ))}
            </div>

            {/* Resumo formatado do Horário */}
            <div className="mt-3 p-3 bg-stone-50 rounded-xl border border-stone-200 text-xs text-stone-600 flex items-center justify-between">
              <span className="font-semibold text-stone-700">Resumo Gerado para o Site:</span>
              <span className="font-mono font-medium text-stone-800">{formatWeeklyScheduleSummary(weeklyScheduleState)}</span>
            </div>
          </div>

          {/* Seção de Agente Virtual Inteligente (I.A. Atendente) & WhatsApp */}
          <div className="pt-6 border-t">
            <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 mb-3">
              <div>
                <h3 className="text-lg font-bold text-stone-800 flex items-center gap-2">
                  <Bot className="w-5 h-5 text-purple-600" />
                  Agente Virtual Inteligente (Atendente I.A.) & WhatsApp
                </h3>
                <p className="text-xs text-stone-500 mt-0.5">
                  Atende clientes em tempo real, tira dúvidas do cardápio, sugere produtos quentinhos e encaminha para o WhatsApp da loja.
                </p>
              </div>

              <div className="flex items-center gap-2">
                <button
                  type="button"
                  onClick={() => setIsAiTestModalOpen(true)}
                  className="bg-purple-600 hover:bg-purple-700 text-white px-3.5 py-1.5 rounded-xl text-xs font-bold flex items-center gap-1.5 shadow-xs transition-all cursor-pointer"
                >
                  <Sparkles className="w-3.5 h-3.5" />
                  Testar Agente I.A.
                </button>
              </div>
            </div>

            <div className="bg-purple-50/50 p-5 rounded-2xl border border-purple-200/80 space-y-4">
              {/* Toggle Habilitar Agente */}
              <label className="flex items-center justify-between cursor-pointer">
                <div>
                  <div className="flex items-center gap-2">
                    <span className="text-sm font-bold text-stone-800">Ativar Atendente I.A. no Cardápio</span>
                    <span className={`text-[10px] font-bold px-2 py-0.5 rounded-full ${aiAgentEnabledState ? 'bg-purple-100 text-purple-800' : 'bg-stone-200 text-stone-600'}`}>
                      {aiAgentEnabledState ? 'Atendente I.A. Ativo' : 'Desativado'}
                    </span>
                  </div>
                  <p className="text-xs text-stone-500">Exibe o botão flutuante e o assistente interativo para todos os visitantes do cardápio.</p>
                </div>
                <div className="relative shrink-0 ml-4">
                  <input 
                    type="checkbox" 
                    checked={aiAgentEnabledState}
                    onChange={(e) => setAiAgentEnabledState(e.target.checked)}
                    className="sr-only peer"
                  />
                  <div className="w-12 h-7 bg-stone-300 peer-focus:outline-none rounded-full peer peer-checked:after:translate-x-full peer-checked:after:border-white after:content-[''] after:absolute after:top-[2px] after:left-[2px] after:bg-white after:border-stone-300 after:border after:rounded-full after:h-6 after:w-6 after:transition-all peer-checked:bg-purple-600"></div>
                </div>
              </label>

              <div className="grid grid-cols-1 md:grid-cols-2 gap-4 pt-2">
                {/* Nome do Agente */}
                <div>
                  <label className="block text-xs font-bold uppercase tracking-wider text-stone-700 mb-1">
                    Nome do Assistente Virtual
                  </label>
                  <input
                    type="text"
                    value={aiAgentNameState}
                    onChange={(e) => setAiAgentNameState(e.target.value)}
                    className="w-full p-2.5 border border-stone-300 rounded-xl bg-white text-sm text-stone-800 focus:ring-2 focus:ring-purple-500 outline-none font-medium"
                    placeholder="Ex: Balbec IA"
                  />
                </div>

                {/* WhatsApp de Contato / Transbordo */}
                <div>
                  <label className="block text-xs font-bold uppercase tracking-wider text-stone-700 mb-1 flex items-center gap-1.5">
                    <MessageCircle className="w-3.5 h-3.5 text-emerald-600" />
                    WhatsApp de Atendimento da Loja
                  </label>
                  <input
                    type="text"
                    value={aiAgentWhatsAppPhoneState}
                    onChange={(e) => setAiAgentWhatsAppPhoneState(e.target.value)}
                    className="w-full p-2.5 border border-stone-300 rounded-xl bg-white text-sm text-stone-800 focus:ring-2 focus:ring-purple-500 outline-none font-mono"
                    placeholder="Ex: (84) 99999-9999 ou 5584999999999"
                  />
                  <p className="text-[10px] text-stone-400 mt-1">Usado quando o cliente clica para conversar com um atendente humano no WhatsApp.</p>
                </div>
              </div>

              {/* Tom de Voz do Agente */}
              <div>
                <label className="block text-xs font-bold uppercase tracking-wider text-stone-700 mb-2">
                  Personalidade e Tom de Resposta
                </label>
                <div className="grid grid-cols-1 sm:grid-cols-3 gap-2.5">
                  <button
                    type="button"
                    onClick={() => setAiAgentToneState('amigavel')}
                    className={`p-3 rounded-xl border text-left transition-all cursor-pointer ${
                      aiAgentToneState === 'amigavel' 
                        ? 'bg-purple-100/70 border-purple-400 ring-2 ring-purple-500/20' 
                        : 'bg-white border-stone-200 hover:bg-stone-50'
                    }`}
                  >
                    <div className="font-bold text-xs text-stone-800 flex items-center gap-1.5 mb-1">
                      <span>🥟</span> Amigável & Acolhedor
                    </div>
                    <p className="text-[11px] text-stone-500 leading-snug">
                      Atendimento atencioso, caloroso e receptivo.
                    </p>
                  </button>

                  <button
                    type="button"
                    onClick={() => setAiAgentToneState('direto')}
                    className={`p-3 rounded-xl border text-left transition-all cursor-pointer ${
                      aiAgentToneState === 'direto' 
                        ? 'bg-purple-100/70 border-purple-400 ring-2 ring-purple-500/20' 
                        : 'bg-white border-stone-200 hover:bg-stone-50'
                    }`}
                  >
                    <div className="font-bold text-xs text-stone-800 flex items-center gap-1.5 mb-1">
                      <span>⚡</span> Rápido & Direto
                    </div>
                    <p className="text-[11px] text-stone-500 leading-snug">
                      Respostas curtas, objetivas, práticas e focadas em fechar o pedido rápido.
                    </p>
                  </button>

                  <button
                    type="button"
                    onClick={() => setAiAgentToneState('especialista')}
                    className={`p-3 rounded-xl border text-left transition-all cursor-pointer ${
                      aiAgentToneState === 'especialista' 
                        ? 'bg-purple-100/70 border-purple-400 ring-2 ring-purple-500/20' 
                        : 'bg-white border-stone-200 hover:bg-stone-50'
                    }`}
                  >
                    <div className="font-bold text-xs text-stone-800 flex items-center gap-1.5 mb-1">
                      <span>👨‍🍳</span> Especialista & Chef
                    </div>
                    <p className="text-[11px] text-stone-500 leading-snug">
                      Conhece receitas, harmonizações de cafés, ingredientes e sugestões gourmet.
                    </p>
                  </button>
                </div>
              </div>

              {/* Prompt / Avisos Customizados para a I.A. */}
              <div>
                <label className="block text-xs font-bold uppercase tracking-wider text-stone-700 mb-1">
                  Instruções Especiais, Fornadas e Avisos para a I.A.
                </label>
                <textarea
                  value={aiAgentCustomPromptState}
                  onChange={(e) => setAiAgentCustomPromptState(e.target.value)}
                  rows={3}
                  className="w-full p-2.5 border border-stone-300 rounded-xl bg-white text-xs text-stone-800 focus:ring-2 focus:ring-purple-500 outline-none leading-relaxed"
                  placeholder="Ex: Pães quentinhos saem às 06:30 e 16:30. Bolos confeitados por encomenda precisam de 24h de aviso. Aceitamos PIX, cartões de crédito/débito e dinheiro."
                />
                <p className="text-[10px] text-stone-400 mt-1">
                  A I.A. utilizará essas orientações adicionais junto ao catálogo de produtos e horários para responder qualquer pergunta aos clientes.
                </p>
              </div>

              {/* Mensagem Padrão do WhatsApp */}
              <div>
                <label className="block text-xs font-bold uppercase tracking-wider text-stone-700 mb-1">
                  Mensagem pré-preenchida ao clicar para falar no WhatsApp
                </label>
                <input
                  type="text"
                  value={aiAgentWhatsAppDefaultMessageState}
                  onChange={(e) => setAiAgentWhatsAppDefaultMessageState(e.target.value)}
                  className="w-full p-2.5 border border-stone-300 rounded-xl bg-white text-xs text-stone-800 focus:ring-2 focus:ring-purple-500 outline-none"
                  placeholder="Olá! Vim pelo site da Balbec e gostaria de fazer um pedido."
                />
              </div>
            </div>
          </div>

          {isMaster && (
            <div className="pt-6 border-t">
              <div className="flex flex-col sm:flex-row justify-between items-start sm:items-center gap-4 mb-4">
                <h3 className="text-lg font-bold text-stone-800">Integração BlueFocus</h3>
                <div className="flex flex-wrap gap-2 items-center">
                  {/* Opção de Sincronização Automática */}
                  <div className="flex items-center gap-2 bg-stone-100 p-1.5 rounded-lg border border-stone-200 text-xs font-medium text-stone-700" title="Seg a Sex: 08:00 às 18:00 | Sábado: 08:00 às 12:00 | Domingo: Pausado">
                    <span className="flex items-center gap-1 font-bold pl-1 text-stone-800">
                      <Clock className="w-3.5 h-3.5 text-orange-600" />
                      Auto Sync (2h | Seg-Sex 08-18h / Sáb 08-12h):
                    </span>
                    <div className="flex items-center bg-stone-200 p-0.5 rounded-md">
                      <button
                        type="button"
                        onClick={() => {
                          setIsAutoSyncEnabled(true);
                          localStorage.setItem('bluefocus_auto_sync', 'true');
                          if (!localStorage.getItem('bluefocus_last_auto_sync_timestamp')) {
                            localStorage.setItem('bluefocus_last_auto_sync_timestamp', String(Date.now()));
                          }
                          updateStoreInfo({
                            blueFocusExportConfig: serializeBlueFocusConfigForDb(blueFocusConfig, true),
                          }).catch(() => {});
                        }}
                        className={`px-2.5 py-1 rounded text-xs font-black transition-all cursor-pointer ${
                          isAutoSyncEnabled 
                            ? 'bg-green-600 text-white shadow-sm' 
                            : 'text-stone-600 hover:text-stone-900'
                        }`}
                      >
                        SIM
                      </button>
                      <button
                        type="button"
                        onClick={() => {
                          setIsAutoSyncEnabled(false);
                          localStorage.setItem('bluefocus_auto_sync', 'false');
                          updateStoreInfo({
                            blueFocusExportConfig: serializeBlueFocusConfigForDb(blueFocusConfig, false),
                          }).catch(() => {});
                        }}
                        className={`px-2.5 py-1 rounded text-xs font-black transition-all cursor-pointer ${
                          !isAutoSyncEnabled 
                            ? 'bg-stone-600 text-white shadow-sm' 
                            : 'text-stone-600 hover:text-stone-900'
                        }`}
                      >
                        NÃO
                      </button>
                    </div>
                  </div>

                  <button type="button" 
                    onClick={() => {
                      setConfirmModal({
                        isOpen: true,
                        title: 'Resetar Marcadores',
                        message: 'Deseja resetar os marcadores para zero e iniciar a sincronização completa agora?',
                        confirmText: 'Resetar e Sincronizar',
                        onConfirm: () => {
                          const resetConfig = { 
                            ...blueFocusConfig, 
                            tipo: '4',
                            startCargaNumero: '0', 
                            startCargaSequencia: '0',
                            startProdutoId: '0' 
                          };
                          setBlueFocusConfig(resetConfig);
                          mirrorBlueFocusConfigToLocalStorage({ ...resetConfig, autoSyncEnabled: isAutoSyncEnabled });
                          updateStoreInfo({
                            blueFocusExportConfig: serializeBlueFocusConfigForDb(resetConfig, isAutoSyncEnabled),
                          }).catch(() => {});
                          handleSyncBlueFocus(resetConfig);
                        }
                      });
                    }}
                    className="text-xs bg-stone-100 text-red-600 px-3 py-1 rounded-lg hover:bg-stone-200 transition-all flex items-center gap-2 cursor-pointer font-bold"
                  >
                    <RefreshCw className="w-3 h-3" />
                    Resetar p/ Início (Zero)
                  </button>
                  <button 
                    type="button" 
                    onClick={handleTestBlueFocus}
                    disabled={isTestingBlueFocus}
                    className="text-xs bg-stone-100 text-stone-600 px-3 py-1 rounded-lg hover:bg-stone-200 transition-all flex items-center gap-2 cursor-pointer"
                  >
                    {isTestingBlueFocus ? (
                      <RefreshCw className="w-3 h-3 animate-spin" />
                    ) : (
                      <RefreshCw className="w-3 h-3" />
                    )}
                    Testar Conexão
                  </button>
                </div>
              </div>
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4 mb-6">
                <div>
                  <label className="block text-sm font-medium text-stone-700 mb-1">Chave de Autenticação (autentica)</label>
                  <input 
                    type="password" 
                    value={blueFocusConfig.authToken} 
                    onChange={(e) => {
                      const val = e.target.value;
                      setBlueFocusConfig(prev => ({ ...prev, authToken: val }));
                      localStorage.setItem('bluefocus_auth_token', val);
                    }}
                    placeholder="Opcional (deixe em branco se não usar)"
                    className="w-full p-3 border rounded-xl focus:ring-2 focus:ring-orange-500 outline-none font-mono" 
                  />
                  <p className="text-[10px] text-stone-500 mt-1 font-medium">Deixe em branco caso o servidor local não utilize token de autenticação.</p>
                </div>
                <div>
                  <label className="block text-sm font-medium text-stone-700 mb-1">Empresa ID (Exato como no sistema)</label>
                  <input 
                    type="text" 
                    value={blueFocusConfig.empresaId || 'BALBEC'} 
                    onChange={(e) => {
                      const val = e.target.value;
                      setBlueFocusConfig(prev => ({ ...prev, empresaId: val }));
                      localStorage.setItem('bluefocus_empresa_id', val);
                    }}
                    className="w-full p-3 border rounded-xl bg-white text-stone-900 font-semibold focus:ring-2 focus:ring-orange-500 outline-none" 
                    placeholder="BALBEC"
                  />
                  <p className="text-[10px] text-stone-400 mt-1">Identificador da empresa no BlueFocus (padrão: BALBEC).</p>
                </div>
                <div>
                  <label className="block text-sm font-medium text-stone-700 mb-1">Usuário ID</label>
                  <input 
                    type="text" 
                    value={blueFocusConfig.usuarioId} 
                    onChange={(e) => {
                      const val = e.target.value;
                      setBlueFocusConfig(prev => ({ ...prev, usuarioId: val }));
                      localStorage.setItem('bluefocus_usuario_id', val);
                    }}
                    className="w-full p-3 border rounded-xl focus:ring-2 focus:ring-orange-500 outline-none" 
                  />
                </div>
                <div>
                  <label className="block text-sm font-medium text-stone-700 mb-1">PDV Código</label>
                  <input 
                    type="text" 
                    value={blueFocusConfig.pdvCodigo} 
                    onChange={(e) => {
                      const val = e.target.value;
                      setBlueFocusConfig(prev => ({ ...prev, pdvCodigo: val }));
                      localStorage.setItem('bluefocus_pdv_codigo', val);
                    }}
                    className="w-full p-3 border rounded-xl focus:ring-2 focus:ring-orange-500 outline-none" 
                  />
                </div>
                <div>
                  <label className="block text-sm font-medium text-stone-700 mb-1">URL de Sincronização</label>
                  <input 
                    type="text" 
                    value={blueFocusConfig.syncUrl} 
                    onChange={(e) => {
                      const val = e.target.value;
                      setBlueFocusConfig(prev => ({ ...prev, syncUrl: val }));
                      localStorage.setItem('bluefocus_sync_url', val);
                    }}
                    className="w-full p-3 border rounded-xl focus:ring-2 focus:ring-orange-500 outline-none font-mono text-xs" 
                  />
                </div>
                <div>
                  <label className="block text-sm font-medium text-stone-700 mb-1">Tipo de Sincronização</label>
                  <select 
                    value={blueFocusConfig.tipoAtualizacao} 
                    onChange={(e) => {
                      const val = e.target.value;
                      setBlueFocusConfig(prev => ({ ...prev, tipoAtualizacao: val }));
                      localStorage.setItem('bluefocus_tipo_atualizacao', val);
                    }}
                    className="w-full p-3 border rounded-xl focus:ring-2 focus:ring-orange-500 outline-none" 
                  >
                    <option value="A">Apenas Alterações (Incremental)</option>
                    <option value="C">Carga Total (Completa)</option>
                  </select>
                  <p className="text-[10px] text-stone-400 mt-1 uppercase">Use "Carga Total" apenas para a primeira importação ou se os produtos não estiverem aparecendo.</p>
                </div>
                <div>
                  <label className="block text-sm font-medium text-stone-700 mb-1">Tipo de Dado (Padrão: 4 - Produtos)</label>
                  <input 
                    type="text" 
                    value={blueFocusConfig.tipo} 
                    onChange={(e) => {
                      const val = e.target.value;
                      setBlueFocusConfig(prev => ({ ...prev, tipo: val }));
                      localStorage.setItem('bluefocus_tipo', val);
                    }}
                    className="w-full p-3 border rounded-xl focus:ring-2 focus:ring-orange-500 outline-none" 
                  />
                </div>
                <div>
                  <label className="block text-sm font-medium text-stone-700 mb-1">Data Inicial (Padrão: 30/12/1899)</label>
                  <input 
                    type="text" 
                    value={blueFocusConfig.dataInicial} 
                    onChange={(e) => {
                      const val = e.target.value;
                      setBlueFocusConfig(prev => ({ ...prev, dataInicial: val }));
                      localStorage.setItem('bluefocus_data_inicial', val);
                    }}
                    className="w-full p-3 border rounded-xl focus:ring-2 focus:ring-orange-500 outline-none" 
                  />
                  <p className="text-[10px] text-stone-400 mt-1 uppercase">Use este campo para filtrar produtos a partir de uma data específica.</p>
                </div>
                <div>
                  <label className="block text-sm font-medium text-stone-700 mb-1">Carga Inicial (Número)</label>
                  <input 
                    type="text" 
                    value={blueFocusConfig.startCargaNumero} 
                    onChange={(e) => {
                      const val = e.target.value;
                      setBlueFocusConfig(prev => ({ ...prev, startCargaNumero: val }));
                      localStorage.setItem('bluefocus_start_carga_numero', val);
                    }}
                    className="w-full p-3 border rounded-xl focus:ring-2 focus:ring-orange-500 outline-none" 
                  />
                </div>
                <div>
                  <label className="block text-sm font-medium text-stone-700 mb-1">Carga Inicial (Sequência)</label>
                  <input 
                    type="text" 
                    value={blueFocusConfig.startCargaSequencia} 
                    onChange={(e) => {
                      const val = e.target.value;
                      setBlueFocusConfig(prev => ({ ...prev, startCargaSequencia: val }));
                      localStorage.setItem('bluefocus_start_carga_sequencia', val);
                    }}
                    className="w-full p-3 border rounded-xl focus:ring-2 focus:ring-orange-500 outline-none" 
                  />
                </div>
                <div>
                  <label className="block text-sm font-medium text-stone-700 mb-1">ID do Produto Inicial</label>
                  <input 
                    type="text" 
                    value={(blueFocusConfig as any).startProdutoId || '0'} 
                    onChange={(e) => {
                      const val = e.target.value;
                      setBlueFocusConfig(prev => ({ ...prev, startProdutoId: val }));
                      localStorage.setItem('bluefocus_start_produto_id', val);
                    }}
                    className="w-full p-3 border rounded-xl focus:ring-2 focus:ring-orange-500 outline-none" 
                  />
                  <p className="text-[10px] text-stone-400 mt-1 uppercase font-bold text-stone-500">Pule produtos até um ID específico.</p>
                </div>
                <div className="md:col-span-2 p-4 bg-emerald-50 border border-emerald-200 rounded-xl flex items-start gap-3">
                  <input
                    id="preserveManualPrices"
                    type="checkbox"
                    checked={(blueFocusConfig as any).preserveManualPrices !== false}
                    onChange={(e) => {
                      const checked = e.target.checked;
                      setBlueFocusConfig(prev => ({ ...prev, preserveManualPrices: checked }));
                      localStorage.setItem('bluefocus_preserve_manual_prices', String(checked));
                    }}
                    className="mt-1 w-4 h-4 text-emerald-600 rounded focus:ring-emerald-500 cursor-pointer"
                  />
                  <label htmlFor="preserveManualPrices" className="text-xs text-emerald-950 cursor-pointer leading-relaxed">
                    <strong className="block text-sm font-extrabold text-emerald-900">
                      🔒 Proteger Todas as Alterações Manuais na Sincronização (Recomendado)
                    </strong>
                    Quando ativado, a sincronização automática ou manual apenas importa <strong>novos produtos/categorias</strong> e nunca sobrescreve preços, nomes, descrições, categorias trocadas, imagens ou canais já ajustados manualmente no sistema. Mesmo se desmarcado, produtos editados manualmente pelo painel continuam com suas alterações travadas contra sobrescrita.
                  </label>
                </div>
              </div>
            </div>
          )}

          <div className="pt-6 border-t flex justify-between items-center">
            <div className="flex gap-4">
              <button type="submit" className="bg-stone-800 text-white px-8 py-3 rounded-xl font-bold hover:bg-stone-900 transition-all shadow-md cursor-pointer">
                Salvar Configurações
              </button>
              {isMaster && (
                <button 
                  type="button"
                  onClick={() => {
                    setConfirmModal({
                      isOpen: true,
                      title: 'Resetar Marcadores',
                      message: 'Deseja realmente resetar os marcadores de sincronização para zero e iniciar a re-importação completa agora?',
                      confirmText: 'Resetar Agora',
                      onConfirm: () => {
                        const resetConfig = {
                          ...blueFocusConfig,
                          tipo: '4',
                          startCargaNumero: '0',
                          startCargaSequencia: '0',
                          startProdutoId: '0'
                        };
                        setBlueFocusConfig(resetConfig);
                        mirrorBlueFocusConfigToLocalStorage({ ...resetConfig, autoSyncEnabled: isAutoSyncEnabled });
                        updateStoreInfo({
                          blueFocusExportConfig: serializeBlueFocusConfigForDb(resetConfig, isAutoSyncEnabled),
                        }).catch(() => {});
                        handleSyncBlueFocus(resetConfig);
                      }
                    });
                  }}
                  className="bg-stone-100 text-stone-600 px-6 py-3 rounded-xl font-medium hover:bg-stone-200 transition-all cursor-pointer"
                >
                  Resetar Marcadores e Sincronizar Tudo
                </button>
              )}
            </div>
          </div>
        </form>
      </div>

      {/* Debug Section */}
      {isMaster && (
        <div className="bg-white rounded-2xl shadow-sm p-8 border border-stone-100">
          <h3 className="text-lg font-bold text-stone-800 mb-4 flex items-center gap-2">
            <MonitorSmartphone className="w-5 h-5 text-blue-600" /> Status da Conexão com o Banco de Dados (Cloud SQL PostgreSQL)
          </h3>
          <div className="space-y-4">
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              <div className="p-4 bg-stone-50 rounded-xl border">
                <p className="text-xs text-stone-500 uppercase font-bold mb-1">Banco de Dados Ativo</p>
                <p className="font-mono text-sm font-semibold text-emerald-700">Cloud SQL (PostgreSQL)</p>
              </div>
              <div className="p-4 bg-stone-50 rounded-xl border">
                <p className="text-xs text-stone-500 uppercase font-bold mb-1">ID da Instância SQL</p>
                <p className="font-mono text-sm break-all">ai-studio-00ea1247</p>
              </div>
            </div>
            <div className="flex flex-col gap-4">
              <div className="flex items-center gap-4 flex-wrap">
                <button type="button" 
                  onClick={async () => {
                    setConnectionStatus('testing');
                    setConnectionErrorMessage('');
                    try {
                      const testRes = await fetch('/api/db/test-connection', { cache: 'no-store' });
                      let data: any = {};
                      try {
                        data = await testRes.json();
                      } catch (_) {}

                      if (testRes.ok && data.success) {
                        setConnectionStatus('success');
                        setConnectionErrorMessage(
                          `✅ ${data.message} | Host: ${data.host || 'PostgreSQL'} | Pedidos Salvos no BD: ${data.ordersCount ?? data.stats?.orders ?? 0} | Clientes: ${data.customersCount ?? data.stats?.customers ?? 0} | Produtos: ${data.productCount ?? 0} (${data.responseTimeMs}ms)`
                        );
                      } else {
                        setConnectionStatus('error');
                        const msg = data.message || `Erro HTTP ${testRes.status} no servidor de API.`;
                        const det = data.details ? `\n• Detalhe: ${data.details}` : '';
                        const env = data.envDetected ? `\n• DATABASE_URL detectada: ${data.envDetected.DATABASE_URL ? 'Sim' : 'Não'}` : '';
                        setConnectionErrorMessage(`⚠️ ${msg}${det}${env}`);
                      }
                    } catch (error: any) {
                      console.error('Test connection error:', error);
                      setConnectionStatus('error');
                      setConnectionErrorMessage(error.message || 'Erro desconhecido na conexão com o servidor.');
                    }
                  }}
                  disabled={connectionStatus === 'testing'}
                  className={`px-6 py-2 text-white rounded-lg font-medium transition-colors ${
                    connectionStatus === 'testing' ? 'bg-stone-400 cursor-not-allowed' : 'bg-blue-600 hover:bg-blue-700'
                  }`}
                >
                  {connectionStatus === 'testing' ? 'Testando...' : 'Testar Conexão Agora'}
                </button>

                <button type="button" 
                  onClick={() => {
                    setConfirmModal({
                      isOpen: true,
                      title: 'Sincronizar com PostgreSQL',
                      message: 'Deseja realmente FORÇAR a restauração de todos os pedidos e cadastros a partir do PostgreSQL?\n\nIsso sincronizará o estado em memória com o banco de dados agora.',
                      confirmText: 'Sincronizar Agora',
                      onConfirm: async () => {
                        setIsSyncing(true);
                        try {
                          const res = await fetch('/api/db/force-hydrate', { method: 'POST' });
                          const data = await res.json();
                          if (res.ok && data.success) {
                            await fetchData();
                            showInfoModal('Hidratação Concluída', `${data.message}\nTotal de Pedidos agora: ${data.ordersCount}`);
                          } else {
                            showInfoModal('Erro na Hidratação', data.error || 'Erro desconhecido');
                          }
                        } catch (e: any) {
                          showInfoModal('Falha na Requisição', e.message || 'Erro de conexão');
                        } finally {
                          setIsSyncing(false);
                        }
                      }
                    });
                  }}
                  disabled={isSyncing}
                  className={`px-6 py-2 text-white rounded-lg font-medium transition-all shadow-md active:scale-95 flex items-center gap-2 ${
                    isSyncing ? 'bg-stone-400 cursor-not-allowed' : 'bg-emerald-600 hover:bg-emerald-700'
                  }`}
                >
                  <RefreshCw className={`w-4 h-4 ${isSyncing ? 'animate-spin' : ''}`} />
                  {isSyncing ? 'Sincronizando...' : 'Sincronizar Tudo com PostgreSQL'}
                </button>
              </div>
              <p className="text-xs text-stone-500 italic">
                Este teste e sincronização garantem que todos os pedidos persistidos no PostgreSQL sejam carregados para o sistema atual. Use caso perceba que algum pedido não está aparecendo após um deploy.
              </p>
            </div>

              {connectionStatus === 'success' && (
                <div className="p-4 bg-green-50 border border-green-200 rounded-xl flex items-center gap-3 text-green-700">
                  <div className="w-2 h-2 bg-green-500 rounded-full animate-pulse"></div>
                  <div>
                    <p className="text-sm font-bold">Conexão com Banco de Dados Cloud SQL PostgreSQL e API estabelecida com sucesso!</p>
                    <p className="text-xs font-mono mt-1 text-green-800">{connectionErrorMessage}</p>
                  </div>
                </div>
              )}

              {connectionStatus === 'error' && (
                <div className="p-4 bg-red-50 border border-red-200 rounded-xl space-y-2">
                  <div className="flex items-center gap-3 text-red-700">
                    <div className="w-2 h-2 bg-red-500 rounded-full"></div>
                    <p className="text-sm font-bold">Falha na Conexão</p>
                  </div>
                  <p className="text-xs text-red-600 font-mono bg-white/50 p-2 rounded border border-red-100">
                    {connectionErrorMessage}
                  </p>
                </div>
              )}
            </div>
          </div>
      )}

      {/* Modal de Teste do Agente I.A. */}
      {isAiTestModalOpen && (
        <AiAssistantModal 
          isOpen={isAiTestModalOpen} 
          onClose={() => setIsAiTestModalOpen(false)} 
        />
      )}
    </div>
  );

  const renderSyncLogs = () => {
    const totalLogs = syncLogs.length;
    const successLogs = syncLogs.filter(l => l.status === 'success').length;
    const warningLogs = syncLogs.filter(l => l.status === 'warning').length;
    const errorLogs = syncLogs.filter(l => l.status === 'error').length;
    const totalProcessedProducts = syncLogs.reduce((acc, l) => acc + (l.productsCreated || 0) + (l.productsUpdated || 0), 0);

    const filteredLogs = syncLogs.filter(log => {
      const search = logSearchTerm.toLowerCase();
      const matchesSearch = 
        log.type.toLowerCase().includes(search) ||
        log.details.toLowerCase().includes(search) ||
        (log.user && log.user.toLowerCase().includes(search)) ||
        log.timestamp.includes(search);
      const matchesStatus = logStatusFilter === 'all' || log.status === logStatusFilter;
      return matchesSearch && matchesStatus;
    });

    return (
      <div className="space-y-6">
        <div className="flex flex-col sm:flex-row justify-between items-start sm:items-center gap-4">
          <div>
            <h2 className="text-2xl font-bold text-stone-800 flex items-center gap-2">
              <History className="w-7 h-7 text-orange-600" />
              Histórico de Atualizações do Catálogo
            </h2>
            <p className="text-sm text-stone-500 mt-1">
              Acompanhe as sincronizações com o ERP BlueFocus, atualizações manuais e execuções automáticas.
            </p>
          </div>
          
          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={() => handleSyncBlueFocus({ tipoAtualizacao: 'A' })}
              disabled={isSyncing}
              className="bg-orange-600 text-white px-4 py-2.5 rounded-xl font-bold text-sm hover:bg-orange-700 transition-all flex items-center gap-2 shadow-sm disabled:opacity-50 cursor-pointer"
            >
              <RefreshCw className={`w-4 h-4 ${isSyncing ? 'animate-spin' : ''}`} />
              {isSyncing ? 'Sincronizando...' : 'Sincronizar ERP Agora'}
            </button>
            <button
              type="button"
              onClick={() => {
                setConfirmModal({
                  isOpen: true,
                  title: 'Limpar Histórico',
                  message: 'Deseja realmente limpar todo o histórico de atualizações?',
                  confirmText: 'Limpar',
                  onConfirm: () => {
                    setSyncLogs([]);
                    safeStorage.removeItem('balbec_sync_logs');
                  }
                });
              }}
              className="bg-stone-100 text-stone-600 px-3 py-2.5 rounded-xl font-medium text-sm hover:bg-stone-200 transition-all flex items-center gap-2 cursor-pointer"
              title="Limpar histórico"
            >
              <Trash2 className="w-4 h-4 text-stone-500" />
              <span className="hidden md:inline">Limpar Histórico</span>
            </button>
          </div>
        </div>

        {/* Top Metric Cards */}
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
          <div className="bg-white p-5 rounded-2xl border border-stone-100 shadow-sm flex items-center gap-4">
            <div className="p-3 bg-blue-50 text-blue-600 rounded-xl">
              <History className="w-6 h-6" />
            </div>
            <div>
              <p className="text-xs font-bold text-stone-500 uppercase tracking-wider">Total de Atualizações</p>
              <h3 className="text-2xl font-black text-stone-800 mt-0.5">{totalLogs}</h3>
            </div>
          </div>

          <div className="bg-white p-5 rounded-2xl border border-stone-100 shadow-sm flex items-center gap-4">
            <div className="p-3 bg-green-50 text-green-600 rounded-xl">
              <CheckCircle2 className="w-6 h-6" />
            </div>
            <div>
              <p className="text-xs font-bold text-stone-500 uppercase tracking-wider">Sincronizações OK</p>
              <h3 className="text-2xl font-black text-stone-800 mt-0.5">{successLogs}</h3>
            </div>
          </div>

          <div className="bg-white p-5 rounded-2xl border border-stone-100 shadow-sm flex items-center gap-4">
            <div className="p-3 bg-orange-50 text-orange-600 rounded-xl">
              <Package className="w-6 h-6" />
            </div>
            <div>
              <p className="text-xs font-bold text-stone-500 uppercase tracking-wider">Produtos Afetados</p>
              <h3 className="text-2xl font-black text-stone-800 mt-0.5">{totalProcessedProducts}</h3>
            </div>
          </div>

          <div className="bg-white p-5 rounded-2xl border border-stone-100 shadow-sm flex items-center gap-4">
            <div className="p-3 bg-red-50 text-red-600 rounded-xl">
              <AlertTriangle className="w-6 h-6" />
            </div>
            <div>
              <p className="text-xs font-bold text-stone-500 uppercase tracking-wider">Alertas / Erros</p>
              <h3 className="text-2xl font-black text-stone-800 mt-0.5">{warningLogs + errorLogs}</h3>
            </div>
          </div>
        </div>

        {/* Filter Bar */}
        <div className="bg-white p-4 rounded-2xl border border-stone-100 shadow-sm flex flex-col md:flex-row gap-4 items-center justify-between">
          <div className="relative w-full md:w-96">
            <Search className="w-4 h-4 text-stone-400 absolute left-3 top-1/2 -translate-y-1/2" />
            <input
              type="text"
              placeholder="Buscar por tipo, usuário, hora ou detalhe..."
              value={logSearchTerm}
              onChange={(e) => setLogSearchTerm(e.target.value)}
              className="w-full pl-9 pr-4 py-2 border rounded-xl text-sm focus:ring-2 focus:ring-orange-500 outline-none"
            />
          </div>

          <div className="flex items-center gap-2 w-full md:w-auto overflow-x-auto pb-1 md:pb-0">
            <span className="text-xs font-bold text-stone-500 flex items-center gap-1 mr-1">
              <Filter className="w-3.5 h-3.5" /> Filtrar:
            </span>
            <button
              type="button"
              onClick={() => setLogStatusFilter('all')}
              className={`px-3 py-1.5 rounded-lg text-xs font-bold transition-all cursor-pointer ${
                logStatusFilter === 'all' 
                  ? 'bg-stone-800 text-white' 
                  : 'bg-stone-100 text-stone-600 hover:bg-stone-200'
              }`}
            >
              Todos ({totalLogs})
            </button>
            <button
              type="button"
              onClick={() => setLogStatusFilter('success')}
              className={`px-3 py-1.5 rounded-lg text-xs font-bold transition-all cursor-pointer ${
                logStatusFilter === 'success' 
                  ? 'bg-green-600 text-white' 
                  : 'bg-stone-100 text-stone-600 hover:bg-stone-200'
              }`}
            >
              Sucesso ({successLogs})
            </button>
            <button
              type="button"
              onClick={() => setLogStatusFilter('warning')}
              className={`px-3 py-1.5 rounded-lg text-xs font-bold transition-all cursor-pointer ${
                logStatusFilter === 'warning' 
                  ? 'bg-amber-600 text-white' 
                  : 'bg-stone-100 text-stone-600 hover:bg-stone-200'
              }`}
            >
              Sem Alterações ({warningLogs})
            </button>
            <button
              type="button"
              onClick={() => setLogStatusFilter('error')}
              className={`px-3 py-1.5 rounded-lg text-xs font-bold transition-all cursor-pointer ${
                logStatusFilter === 'error' 
                  ? 'bg-red-600 text-white' 
                  : 'bg-stone-100 text-stone-600 hover:bg-stone-200'
              }`}
            >
              Erros ({errorLogs})
            </button>
          </div>
        </div>

        {/* Logs Table / List */}
        <div className="bg-white rounded-2xl border border-stone-100 shadow-sm overflow-hidden">
          {filteredLogs.length === 0 ? (
            <div className="p-12 text-center">
              <History className="w-12 h-12 text-stone-300 mx-auto mb-3" />
              <p className="text-base font-bold text-stone-700">Nenhum registro de atualização encontrado</p>
              <p className="text-xs text-stone-400 mt-1">Tente ajustar o termo de pesquisa ou disparar uma nova sincronização.</p>
            </div>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-left border-collapse">
                <thead>
                  <tr className="bg-stone-50 border-b border-stone-100 text-xs font-bold text-stone-500 uppercase tracking-wider">
                    <th className="p-4">Horário</th>
                    <th className="p-4">Tipo de Operação</th>
                    <th className="p-4">Status</th>
                    <th className="p-4">Produtos / Resultados</th>
                    <th className="p-4">Usuário</th>
                    <th className="p-4 text-right">Ação</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-stone-100 text-sm">
                  {filteredLogs.map(log => (
                    <tr key={log.id} className="hover:bg-stone-50/80 transition-colors">
                      <td className="p-4 whitespace-nowrap font-medium text-stone-800">
                        <span className="flex items-center gap-1.5 font-mono text-xs">
                          <Clock className="w-3.5 h-3.5 text-stone-400" />
                          {log.timestamp}
                        </span>
                      </td>

                      <td className="p-4">
                        <span className="font-semibold text-stone-800 block">{log.type}</span>
                        <span className="text-[11px] text-stone-400 truncate max-w-xs block mt-0.5">
                          {log.details}
                        </span>
                      </td>

                      <td className="p-4 whitespace-nowrap">
                        {log.status === 'success' && (
                          <span className="inline-flex items-center gap-1 px-2.5 py-1 rounded-full text-xs font-bold bg-green-100 text-green-700 border border-green-200">
                            <CheckCircle2 className="w-3.5 h-3.5" /> Sucesso
                          </span>
                        )}
                        {log.status === 'warning' && (
                          <span className="inline-flex items-center gap-1 px-2.5 py-1 rounded-full text-xs font-bold bg-amber-100 text-amber-700 border border-amber-200">
                            <AlertTriangle className="w-3.5 h-3.5" /> Sem Novos
                          </span>
                        )}
                        {log.status === 'error' && (
                          <span className="inline-flex items-center gap-1 px-2.5 py-1 rounded-full text-xs font-bold bg-red-100 text-red-700 border border-red-200">
                            <XCircle className="w-3.5 h-3.5" /> Erro
                          </span>
                        )}
                      </td>

                      <td className="p-4 whitespace-nowrap">
                        <div className="flex flex-wrap gap-1">
                          {log.productsCreated > 0 && (
                            <span className="bg-emerald-50 text-emerald-700 px-2 py-0.5 rounded text-xs font-bold border border-emerald-200">
                              +{log.productsCreated} novos
                            </span>
                          )}
                          {log.productsUpdated > 0 && (
                            <span className="bg-blue-50 text-blue-700 px-2 py-0.5 rounded text-xs font-bold border border-blue-200">
                              ~{log.productsUpdated} alterados
                            </span>
                          )}
                          {log.ignoredCount > 0 && (
                            <span className="bg-stone-100 text-stone-600 px-2 py-0.5 rounded text-xs font-medium">
                              {log.ignoredCount} ignorados
                            </span>
                          )}
                          {log.productsCreated === 0 && log.productsUpdated === 0 && log.ignoredCount === 0 && (
                            <span className="text-xs text-stone-400 italic">Nenhum item alterado</span>
                          )}
                        </div>
                      </td>

                      <td className="p-4 whitespace-nowrap text-xs text-stone-600 font-medium">
                        {log.user || 'Sistema'}
                      </td>

                      <td className="p-4 whitespace-nowrap text-right">
                        <button
                          type="button"
                          onClick={() => setSelectedLogForModal(log)}
                          className="px-3 py-1.5 bg-stone-100 hover:bg-stone-200 text-stone-700 rounded-lg text-xs font-bold transition-all cursor-pointer"
                        >
                          Detalhes
                        </button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>

        {/* Detail Modal */}
        {selectedLogForModal && (
          <div className="fixed inset-0 bg-black/50 backdrop-blur-sm z-50 flex items-center justify-center p-4">
            <div className="bg-white rounded-2xl max-w-lg w-full p-6 shadow-xl space-y-4 border border-stone-200">
              <div className="flex items-center justify-between border-b pb-3">
                <div className="flex items-center gap-2">
                  <FileText className="w-5 h-5 text-orange-600" />
                  <h3 className="font-bold text-stone-800 text-lg">Detalhes da Atualização</h3>
                </div>
                <button
                  type="button"
                  onClick={() => setSelectedLogForModal(null)}
                  className="p-1 hover:bg-stone-100 rounded-lg text-stone-400 hover:text-stone-700"
                >
                  <X className="w-5 h-5" />
                </button>
              </div>

              <div className="space-y-3 text-sm">
                <div className="flex justify-between items-center bg-stone-50 p-3 rounded-xl">
                  <div>
                    <span className="text-xs text-stone-400 uppercase font-bold block">Horário da Operação</span>
                    <span className="font-mono text-stone-800 font-bold">{selectedLogForModal.timestamp}</span>
                  </div>
                  <div>
                    {selectedLogForModal.status === 'success' && (
                      <span className="px-3 py-1 rounded-full text-xs font-bold bg-green-100 text-green-700">Sucesso</span>
                    )}
                    {selectedLogForModal.status === 'warning' && (
                      <span className="px-3 py-1 rounded-full text-xs font-bold bg-amber-100 text-amber-700">Sem Novos</span>
                    )}
                    {selectedLogForModal.status === 'error' && (
                      <span className="px-3 py-1 rounded-full text-xs font-bold bg-red-100 text-red-700">Erro</span>
                    )}
                  </div>
                </div>

                <div className="grid grid-cols-2 gap-3">
                  <div className="p-3 border rounded-xl">
                    <span className="text-xs text-stone-400 uppercase font-bold block">Tipo</span>
                    <span className="font-semibold text-stone-800">{selectedLogForModal.type}</span>
                  </div>
                  <div className="p-3 border rounded-xl">
                    <span className="text-xs text-stone-400 uppercase font-bold block">Usuário</span>
                    <span className="font-semibold text-stone-800">{selectedLogForModal.user || 'Sistema'}</span>
                  </div>
                </div>

                <div className="p-3 border rounded-xl bg-stone-50/50">
                  <span className="text-xs text-stone-400 uppercase font-bold block mb-2">Estatísticas de Itens</span>
                  <div className="grid grid-cols-3 gap-2 text-center text-xs">
                    <div className="bg-white p-2 rounded-lg border">
                      <span className="text-emerald-600 font-bold block text-base">+{selectedLogForModal.productsCreated}</span>
                      <span className="text-stone-500">Novos</span>
                    </div>
                    <div className="bg-white p-2 rounded-lg border">
                      <span className="text-blue-600 font-bold block text-base">~{selectedLogForModal.productsUpdated}</span>
                      <span className="text-stone-500">Alterados</span>
                    </div>
                    <div className="bg-white p-2 rounded-lg border">
                      <span className="text-stone-600 font-bold block text-base">{selectedLogForModal.ignoredCount}</span>
                      <span className="text-stone-500">Ignorados</span>
                    </div>
                  </div>
                </div>

                <div>
                  <span className="text-xs text-stone-500 font-bold block mb-1">Relatório / Mensagem Detalhada:</span>
                  <div className={`p-3 rounded-xl text-xs font-mono break-words leading-relaxed max-h-48 overflow-y-auto ${
                    selectedLogForModal.status === 'error' 
                      ? 'bg-red-50 text-red-800 border border-red-200' 
                      : 'bg-stone-900 text-stone-200'
                  }`}>
                    {selectedLogForModal.details}
                  </div>
                </div>
              </div>

              <div className="pt-2 flex justify-end">
                <button
                  type="button"
                  onClick={() => setSelectedLogForModal(null)}
                  className="px-5 py-2 bg-stone-800 text-white rounded-xl text-xs font-bold hover:bg-stone-900 transition-all cursor-pointer"
                >
                  Fechar
                </button>
              </div>
            </div>
          </div>
        )}
      </div>
    );
  };

  const renderAuditTab = () => {
    const auditLogsList = (auditLogs || []).filter(log => {
      const q = auditSearch.toLowerCase();
      return !q || log.title.toLowerCase().includes(q) || log.description.toLowerCase().includes(q) || log.userName.toLowerCase().includes(q) || log.userEmail.toLowerCase().includes(q);
    });

    return (
      <div className="space-y-6 animate-fadeIn">
        <div className="flex flex-col sm:flex-row justify-between items-start sm:items-center gap-4 bg-white p-6 rounded-2xl shadow-xs border border-stone-200">
          <div>
            <h2 className="text-xl font-extrabold text-stone-900 flex items-center gap-2">
              <ShieldCheck className="w-6 h-6 text-orange-600" /> Auditoria Crítica do Sistema
            </h2>
            <p className="text-sm text-stone-500 mt-0.5">
              Registro completo de ações críticas realizadas por administradores e operadores (ex: exclusão de pedidos, confirmação de pagamentos pendentes, cadastros e aprovações).
            </p>
          </div>
          {isMaster && auditLogsList.length > 0 && (
            <button
              type="button"
              onClick={() => {
                if (window.confirm('Tem certeza que deseja limpar todos os registros de auditoria?')) {
                  clearAuditLogs();
                }
              }}
              className="px-4 py-2 bg-red-50 text-red-700 hover:bg-red-100 font-bold text-xs rounded-xl border border-red-200 transition-all cursor-pointer"
            >
              🗑️ Limpar Auditoria (Master)
            </button>
          )}
        </div>

        <div className="bg-white rounded-2xl shadow-xs border border-stone-200 overflow-hidden">
          <div className="p-4 border-b border-stone-200 bg-stone-50 flex items-center gap-3">
            <Search className="w-5 h-5 text-stone-400" />
            <input
              type="text"
              placeholder="Pesquisar por ação, usuário, email ou descrição..."
              value={auditSearch}
              onChange={(e) => setAuditSearch(e.target.value)}
              className="w-full bg-transparent border-none outline-none text-sm text-stone-800 placeholder-stone-400 font-medium"
            />
            {auditSearch && (
              <button onClick={() => setAuditSearch('')} className="text-xs text-stone-500 hover:text-stone-800 font-bold px-2 py-1 bg-stone-200 rounded-lg">Limpar</button>
            )}
          </div>

          <div className="overflow-x-auto">
            <table className="w-full text-left border-collapse">
              <thead className="bg-stone-100 text-stone-700 font-bold text-xs uppercase tracking-wider border-b">
                <tr>
                  <th className="p-4">Data e Hora</th>
                  <th className="p-4">Ação / Evento</th>
                  <th className="p-4">Descrição</th>
                  <th className="p-4">Usuário Responsável</th>
                  <th className="p-4">Papel</th>
                  <th className="p-4">Detalhes</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-stone-100 text-sm">
                {auditLogsList.length === 0 ? (
                  <tr>
                    <td colSpan={6} className="p-12 text-center text-stone-400 font-medium">
                      Nenhum registro de auditoria encontrado. As ações críticas (exclusão de pedidos, recebimentos, aprovações) serão registradas automaticamente aqui.
                    </td>
                  </tr>
                ) : (
                  auditLogsList.map((log) => {
                    const dateStr = new Date(log.timestamp).toLocaleString('pt-BR');
                    return (
                      <tr key={log.id} className="hover:bg-stone-50/80 transition-colors">
                        <td className="p-4 text-xs font-mono text-stone-600 whitespace-nowrap">{dateStr}</td>
                        <td className="p-4 font-extrabold text-stone-900 whitespace-nowrap">
                          <span className={`px-2.5 py-1 rounded-lg text-xs border ${
                            log.type === 'delete_order' ? 'bg-red-50 text-red-700 border-red-200' :
                            log.type === 'confirm_payment' ? 'bg-emerald-50 text-emerald-700 border-emerald-200' :
                            'bg-blue-50 text-blue-700 border-blue-200'
                          }`}>
                            {log.title}
                          </span>
                        </td>
                        <td className="p-4 text-stone-700 font-medium max-w-xs truncate" title={log.description}>{log.description}</td>
                        <td className="p-4">
                          <div className="font-bold text-stone-900">{log.userName || 'Sistema'}</div>
                          <div className="text-xs text-stone-400">{log.userEmail || ''}</div>
                        </td>
                        <td className="p-4">
                          <span className={`text-[10px] font-black uppercase px-2 py-0.5 rounded ${
                            log.role === 'master' ? 'bg-purple-100 text-purple-800 border border-purple-200' :
                            log.role === 'admin' ? 'bg-amber-100 text-amber-800 border border-amber-200' :
                            'bg-stone-100 text-stone-700'
                          }`}>
                            {log.role}
                          </span>
                        </td>
                        <td className="p-4 text-xs font-mono text-stone-500 max-w-xs truncate" title={log.details || '-'}>{log.details || '-'}</td>
                      </tr>
                    );
                  })
                )}
              </tbody>
            </table>
          </div>
        </div>
      </div>
    );
  };

  const handleGoogleLogin = async () => {
    try {
      const { signInWithPopup, GoogleAuthProvider } = await import('firebase/auth');
      const { doc, getDoc } = await import('firebase/firestore');
      const provider = new GoogleAuthProvider();
      const result = await signInWithPopup(auth, provider);
      
      const emailClean = (result.user.email || '').trim().toLowerCase();
      let isAuthorized = isAuthorizedAdminEmail(result.user.email) || users.some(u => (u.email || '').trim().toLowerCase() === emailClean);

      if (!isAuthorized) {
        try {
          const res = await fetch('/api/db/users');
          if (res.ok) {
            const dbUsers = await res.json();
            if (Array.isArray(dbUsers) && dbUsers.some(u => (u.email || '').trim().toLowerCase() === emailClean)) {
              isAuthorized = true;
            }
          }
        } catch (dbErr) {
          console.warn('Erro ao checar usuários na API:', dbErr);
        }
      }

      if (!isAuthorized) {
        try {
          const userDoc = await getDoc(doc(db, 'users', result.user.uid));
          isAuthorized = userDoc.exists();
        } catch (permError) {
          console.error('Permission check error:', permError);
          isAuthorized = false;
        }
      }

      if (isAuthorized) {
        setIsAuthenticated(true);
        setLoginError('');
      } else {
        setLoginError(`Acesso negado. O usuário ${result.user.email} está autenticado, mas não possui um registro de permissão no painel (UID: ${result.user.uid}). Você pode cadastrar este e-mail na aba Usuários ou utilizar o login direto por Email e Senha (ex: admin@balbec.com.br).`);
        auth.signOut();
      }
    } catch (error: any) {
      console.error('Login error:', error);
      if (error.code === 'auth/popup-closed-by-user') {
        setLoginError('Login cancelado pelo usuário.');
      } else if (error.code === 'auth/unauthorized-domain') {
        setLoginError('Este domínio precisa ser adicionado aos Domínios Autorizados no console do Firebase. Utilize o login por Email e Senha abaixo.');
      } else {
        setLoginError(`Erro ao autenticar com Google (${error.message || error.code || 'Falha'}). Tente entrar com Email e Senha abaixo.`);
      }
    }
  };

  const handleEmailLogin = async (e: React.FormEvent) => {
    e.preventDefault();
    setLoginError('');
    const emailClean = username.trim().toLowerCase();
    const passClean = password.trim();

    try {
      // 1. Try server direct login
      const res = await fetch('/api/auth/login', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email: emailClean, password: passClean })
      });

      if (res.ok) {
        const data = await res.json();
        if (data.user) {
          setIsAuthenticated(true);
          setCurrentUser(data.user);
          localStorage.setItem('balbec_admin_session', JSON.stringify(data.user));
          setLoginError('');
          return;
        }
      }

      // 2. Check local/store users list or hardcoded master account as secondary direct fallback
      if (emailClean === 'admin@balbec.com.br' && passClean === 'admin123') {
        setIsAuthenticated(true);
        const userObj: User = {
          id: 'master-4',
          uid: 'master-4',
          name: 'Admin Master',
          email: 'admin@balbec.com.br',
          role: 'master'
        };
        setCurrentUser(userObj);
        localStorage.setItem('balbec_admin_session', JSON.stringify(userObj));
        setLoginError('');
        return;
      }

      const matchingUser = users.find(u => (u.email || '').trim().toLowerCase() === emailClean);
      if (matchingUser && (!matchingUser.password || matchingUser.password === passClean)) {
        setIsAuthenticated(true);
        const userObj: User = {
          id: matchingUser.id || matchingUser.uid || 'user-id',
          uid: matchingUser.uid || String(matchingUser.id),
          name: matchingUser.name || emailClean.split('@')[0],
          email: emailClean,
          role: (emailClean === 'admin@balbec.com.br' || emailClean === 'camillasites@gmail.com') ? 'master' : (matchingUser.role || 'padrao')
        };
        setCurrentUser(userObj);
        localStorage.setItem('balbec_admin_session', JSON.stringify(userObj));
        setLoginError('');
        return;
      }

      // 3. Fallback to Firebase for existing master accounts
      try {
        const { signInWithEmailAndPassword } = await import('firebase/auth');
        const result = await signInWithEmailAndPassword(auth, emailClean, passClean);
        const fbEmail = (result.user.email || '').trim().toLowerCase();
        const isAuthorized = isAuthorizedAdminEmail(result.user.email) || users.some(u => (u.email || '').trim().toLowerCase() === fbEmail);

        if (isAuthorized) {
          setIsAuthenticated(true);
          const found = users.find(u => (u.email || '').trim().toLowerCase() === fbEmail);
          const userObj: User = {
            id: result.user.uid,
            uid: result.user.uid,
            name: result.user.displayName || found?.name || result.user.email?.split('@')[0] || 'Admin',
            email: result.user.email || '',
            role: (fbEmail === 'camillasites@gmail.com' || fbEmail === 'admin@balbec.com.br') ? 'master' : (found?.role || 'admin')
          };
          setCurrentUser(userObj);
          localStorage.setItem('balbec_admin_session', JSON.stringify(userObj));
          setLoginError('');
          return;
        }
      } catch (_) {}

      setLoginError('Email ou senha incorretos. Verifique suas credenciais de acesso.');
    } catch (error: any) {
      console.error('Login error:', error);
      setLoginError('Erro de conexão ao autenticar. Tente novamente.');
    }
  };

  if (!isAuthenticated) {
    return (
      <div className="min-h-screen bg-stone-100 flex items-center justify-center p-4">
        <div className="bg-white p-8 rounded-2xl shadow-xl w-full max-w-md">
          <div className="flex justify-center mb-6">
            <div className="w-16 h-16 bg-orange-100 text-orange-600 rounded-full flex items-center justify-center">
              <LayoutDashboard className="w-8 h-8" />
            </div>
          </div>
          <h1 className="text-2xl font-bold text-center text-stone-800 mb-6">Acesso Restrito</h1>
          <form onSubmit={handleEmailLogin} className="space-y-4 mb-4">
            {loginError && <p className="text-red-500 text-sm text-center">{loginError}</p>}
            <div>
              <label className="block text-sm font-medium text-stone-700 mb-1">Email</label>
              <input 
                type="email" 
                value={username} 
                onChange={e => setUsername(e.target.value)} 
                required 
                className="w-full p-3 border rounded-xl focus:ring-2 focus:ring-orange-500 outline-none" 
              />
            </div>
            <div>
              <label className="block text-sm font-medium text-stone-700 mb-1">Senha</label>
              <input 
                type="password" 
                value={password} 
                onChange={e => setPassword(e.target.value)} 
                required 
                className="w-full p-3 border rounded-xl focus:ring-2 focus:ring-orange-500 outline-none" 
              />
            </div>
            <button type="submit" className="w-full py-3 bg-stone-800 text-white rounded-xl font-bold hover:bg-stone-900 transition-colors">
              Entrar
            </button>
          </form>
          
          <div className="relative flex items-center py-2 mb-4">
            <div className="flex-grow border-t border-stone-200"></div>
            <span className="flex-shrink-0 mx-4 text-stone-400 text-sm">Ou</span>
            <div className="flex-grow border-t border-stone-200"></div>
          </div>

          <button type="button" onClick={handleGoogleLogin} className="w-full py-3 bg-white border border-stone-200 text-stone-700 rounded-xl font-bold hover:bg-stone-50 transition-colors flex items-center justify-center gap-2">
            <svg className="w-5 h-5" viewBox="0 0 24 24">
              <path fill="currentColor" d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92c-.26 1.37-1.04 2.53-2.21 3.31v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.09z" />
              <path fill="#34A853" d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z" />
              <path fill="#FBBC05" d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.07H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.93l2.85-2.22.81-.62z" />
              <path fill="#EA4335" d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.07l3.66 2.84c.87-2.6 3.3-4.53 6.16-4.53z" />
            </svg>
            Entrar com Google
          </button>

          <div className="mt-4 p-3 bg-stone-50 border border-stone-200 rounded-xl text-center text-xs text-stone-600">
            <span className="font-semibold text-stone-800">Acesso Administrativo:</span> Utilize <code className="bg-stone-200/70 px-1.5 py-0.5 rounded font-mono text-stone-900">admin@balbec.com.br</code> com senha <code className="bg-stone-200/70 px-1.5 py-0.5 rounded font-mono text-stone-900">admin123</code> ou seu e-mail cadastrado.
          </div>

          <div className="mt-5 text-center">
            <Link to="/" className="text-stone-500 hover:text-stone-700 text-sm">Voltar para o Cardápio</Link>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-stone-100 flex flex-col md:flex-row">
      {/* Mobile Top Navigation Bar (Shown only on smartphones & small screens) */}
      <header className="md:hidden bg-stone-900 text-white p-3.5 px-4 flex items-center justify-between sticky top-0 z-30 shadow-md">
        <div className="flex items-center gap-3">
          <button
            type="button"
            onClick={() => setIsMobileNavOpen(true)}
            className="p-2 rounded-xl bg-stone-800 hover:bg-stone-700 text-stone-200 cursor-pointer"
            title="Abrir Menu Admin"
          >
            <MenuIcon className="w-6 h-6" />
          </button>
          <div>
            <h1 className="text-base font-black text-white flex items-center gap-1.5 leading-none">
              <span>Painel Admin</span>
            </h1>
            <p className="text-[11px] text-orange-400 font-bold mt-0.5 capitalize">
              {activeTab === 'dashboard' ? 'Visão Geral' :
               activeTab === 'orders' ? 'Pedidos' :
               activeTab === 'customers' ? 'Clientes & Leads' :
               activeTab === 'sms' ? 'Lembretes SMS (3x/dia)' :
               activeTab === 'tables' ? 'Mesas & QR Codes' :
               activeTab === 'categories' ? 'Categorias' :
               activeTab === 'products' ? 'Produtos' :
               activeTab === 'flavors' ? 'Sabores' :
               activeTab === 'tv' ? 'Smart TV / Mídia' :
               activeTab === 'settings' ? 'Configurações' :
               activeTab === 'users' ? 'Usuários' :
               activeTab === 'documentation' ? 'Documentação & SaaS' :
               activeTab === 'sync_logs' ? 'Histórico' : activeTab}
            </p>
          </div>
        </div>

        <div className="flex items-center gap-2">
          {orders.filter(o => o.status === 'pending').length > 0 && (
            <button
              onClick={() => {
                setActiveTab('orders');
                setIsMobileNavOpen(false);
              }}
              className="bg-red-500 hover:bg-red-600 text-white text-xs font-black px-2.5 py-1.5 rounded-xl flex items-center gap-1 shadow-sm"
            >
              <ShoppingBag className="w-3.5 h-3.5" />
              <span>{orders.filter(o => o.status === 'pending').length}</span>
            </button>
          )}

          {/* Botão de Ativar / Desativar Aviso Sonoro de Pedidos */}
          <button
            type="button"
            onClick={() => handleToggleSound()}
            className={`flex items-center gap-1.5 px-3 py-1.5 rounded-xl text-xs font-bold transition-all cursor-pointer border shadow-xs ${
              isSoundEnabled 
                ? 'bg-emerald-600/20 text-emerald-300 border-emerald-500/40 hover:bg-emerald-600/30 ring-1 ring-emerald-500/30' 
                : 'bg-stone-800 text-stone-400 border-stone-700 hover:text-stone-200'
            }`}
            title={isSoundEnabled ? 'Aviso sonoro ATIVADO. Clique para desativar o som quando chegam pedidos.' : 'Aviso sonoro DESATIVADO. Clique para ativar o som de novos pedidos.'}
          >
            {isSoundEnabled ? (
              <Volume2 className="w-4 h-4 text-emerald-400 animate-pulse shrink-0" />
            ) : (
              <VolumeX className="w-4 h-4 text-stone-400 shrink-0" />
            )}
            <span className="hidden sm:inline">Aviso Sonoro:</span>
            <span className={`text-[11px] font-black uppercase tracking-wider ${isSoundEnabled ? 'text-emerald-300' : 'text-stone-400'}`}>
              {isSoundEnabled ? 'ON' : 'OFF'}
            </span>
          </button>

          <button
            type="button"
            onClick={() => handleToggleShowSystemIntroButton(!showSystemIntroButtonState)}
            className={`hidden sm:flex items-center gap-1.5 px-3 py-1.5 rounded-xl text-xs font-bold transition-all cursor-pointer border ${
              showSystemIntroButtonState 
                ? 'bg-amber-500/15 text-amber-300 border-amber-500/30 hover:bg-amber-500/25' 
                : 'bg-stone-800 text-stone-400 border-stone-700 hover:text-stone-300'
            }`}
            title="Ativar ou desativar o botão flutuante 'Conhecer o Sistema' no cardápio"
          >
            <Sparkles className="w-3.5 h-3.5 text-amber-400" />
            <span>Botão Conhecer: {showSystemIntroButtonState ? 'ON' : 'OFF'}</span>
          </button>
          <Link
            to="/"
            className="text-xs bg-stone-800 hover:bg-stone-700 text-stone-200 px-3 py-2 rounded-xl font-bold transition-colors"
          >
            Cardápio
          </Link>
        </div>
      </header>

      {/* Mobile Drawer Backdrop */}
      {isMobileNavOpen && (
        <div 
          className="fixed inset-0 bg-black/60 backdrop-blur-xs z-40 md:hidden transition-opacity"
          onClick={() => setIsMobileNavOpen(false)}
        />
      )}

      {/* Sidebar (Desktop Fixed / Mobile Sliding Drawer) */}
      <aside className={`
        fixed inset-y-0 left-0 z-50 w-72 bg-stone-900 text-stone-300 flex flex-col shadow-2xl transition-transform duration-300 ease-out md:static md:w-64 md:translate-x-0 md:shadow-none
        ${isMobileNavOpen ? 'translate-x-0' : '-translate-x-full'}
      `}>
        <div className="p-5 border-b border-stone-800 flex items-center justify-between">
          <h1 className="text-xl font-bold text-white flex items-center gap-2">
            <LayoutDashboard className="w-6 h-6 text-orange-500" /> Painel Admin
          </h1>
          <button
            type="button"
            onClick={() => setIsMobileNavOpen(false)}
            className="p-1.5 rounded-lg bg-stone-800 text-stone-400 hover:text-white md:hidden cursor-pointer"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        {currentUser && (
          <div className="p-4 pb-2">
            <div className="p-3 bg-stone-800/50 rounded-xl border border-stone-700/50">
              <div className="flex items-center justify-between mb-1">
                <p className="text-[10px] uppercase tracking-wider text-stone-500 font-bold">Usuário Logado</p>
                <span className={`text-[10px] font-bold px-2 py-0.5 rounded-full ${
                  isMaster 
                    ? 'bg-purple-500/20 text-purple-300 border border-purple-500/30' 
                    : isAdminOrMaster 
                    ? 'bg-blue-500/20 text-blue-300 border border-blue-500/30' 
                    : 'bg-stone-700 text-stone-300'
                }`}>
                  {isMaster ? 'Master' : isAdminOrMaster ? 'Admin' : 'Padrão'}
                </span>
              </div>
              <p className="text-sm font-medium text-white truncate">{currentUser.name}</p>
              <p className="text-[10px] text-stone-400 truncate">{currentUser.email}</p>

              {/* Deploy Railway em Vigor */}
              <div className="mt-2.5 pt-2 border-t border-stone-700/60 space-y-1">
                <div className="flex items-center justify-between gap-1">
                  <span className="flex items-center gap-1.5 text-[10px] uppercase tracking-wider text-stone-400 font-bold">
                    <span className="w-2 h-2 rounded-full bg-emerald-500 animate-pulse inline-block"></span>
                    Deploy Railway
                  </span>
                  <span 
                    className="font-mono text-[10px] font-bold px-1.5 py-0.5 rounded bg-emerald-950/70 text-emerald-400 border border-emerald-800/80 truncate max-w-[130px]" 
                    title={deployInfo.railwayDeploymentId || deployInfo.railwayCommitSha || deployInfo.version || 'Ativo'}
                  >
                    {deployInfo.railwayDeploymentId 
                      ? deployInfo.railwayDeploymentId.slice(0, 8) 
                      : deployInfo.railwayCommitSha 
                      ? deployInfo.railwayCommitSha.slice(0, 7) 
                      : (deployInfo.version || 'Ativo')}
                  </span>
                </div>
                {deployInfo.railwayCommitSha && (
                  <div className="flex items-center justify-between text-[10px] text-stone-400 font-medium">
                    <span className="text-stone-500 text-[9px] uppercase tracking-wider">Commit:</span>
                    <span className="font-mono text-stone-300 font-bold">{deployInfo.railwayCommitSha.slice(0, 7)}</span>
                  </div>
                )}
                {deployInfo.serverStartTime && (
                  <div className="flex items-center justify-between text-[9px] text-stone-500">
                    <span className="text-[9px] uppercase tracking-wider">Iniciado:</span>
                    <span className="text-stone-400 font-medium">
                      {new Date(deployInfo.serverStartTime).toLocaleString('pt-BR', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' })}
                    </span>
                  </div>
                )}
              </div>
            </div>
          </div>
        )}

        <nav className="flex-1 p-4 space-y-1.5 overflow-y-auto">
          {!isCaixaUser && (
            <button type="button" 
              onClick={() => {
                setActiveTab('dashboard');
                setIsMobileNavOpen(false);
              }}
              className={`w-full flex items-center gap-3 px-4 py-3 rounded-xl transition-colors cursor-pointer font-medium text-sm ${activeTab === 'dashboard' ? 'bg-orange-600 text-white' : 'hover:bg-stone-800'}`}
            >
              <LayoutDashboard className="w-5 h-5" /> Visão Geral
            </button>
          )}
          {/* Pedidos: Removido do Usuário Padrão */}
          {!isPadrao && (
            <button type="button" 
              onClick={() => {
                setActiveTab('orders');
                setIsMobileNavOpen(false);
              }}
              className={`w-full flex items-center gap-3 px-4 py-3 rounded-xl transition-colors cursor-pointer font-medium text-sm ${activeTab === 'orders' ? 'bg-orange-600 text-white' : 'hover:bg-stone-800'}`}
            >
              <ShoppingBag className="w-5 h-5" /> Pedidos
              {orders.filter(o => o.status === 'pending').length > 0 && (
                <span className="ml-auto bg-red-500 text-white text-xs font-bold px-2 py-1 rounded-full">
                  {orders.filter(o => o.status === 'pending').length}
                </span>
              )}
            </button>
          )}
          {(isAdminOrMaster || isCaixaUser) && (
            <button type="button" 
              onClick={() => {
                setActiveTab('customers');
                setIsMobileNavOpen(false);
              }}
              className={`w-full flex items-center gap-3 px-4 py-3 rounded-xl transition-colors cursor-pointer font-medium text-sm ${activeTab === 'customers' ? 'bg-orange-600 text-white' : 'hover:bg-stone-800'}`}
            >
              <UserCheck className="w-5 h-5" /> Clientes & Leads
            </button>
          )}
          {/* {(isAdminOrMaster || isCaixaUser) && (
            <button type="button" 
              onClick={() => {
                setActiveTab('tables');
                setIsMobileNavOpen(false);
              }}
              className={`w-full flex items-center gap-3 px-4 py-3 rounded-xl transition-colors cursor-pointer font-medium text-sm ${activeTab === 'tables' ? 'bg-orange-600 text-white' : 'hover:bg-stone-800'}`}
            >
              <UtensilsCrossed className="w-5 h-5" /> Mesas & QR Codes
            </button>
          )} */}
          {!isCaixaUser && (
            <button type="button" 
              onClick={() => {
                setActiveTab('categories');
                setIsMobileNavOpen(false);
              }}
              className={`w-full flex items-center gap-3 px-4 py-3 rounded-xl transition-colors cursor-pointer font-medium text-sm ${activeTab === 'categories' ? 'bg-orange-600 text-white' : 'hover:bg-stone-800'}`}
            >
              <Tags className="w-5 h-5" /> Categorias
            </button>
          )}
          {!isCaixaUser && (
            <button type="button" 
              onClick={() => {
                setActiveTab('products');
                setIsMobileNavOpen(false);
              }}
              className={`w-full flex items-center gap-3 px-4 py-3 rounded-xl transition-colors cursor-pointer font-medium text-sm ${activeTab === 'products' ? 'bg-orange-600 text-white' : 'hover:bg-stone-800'}`}
            >
              <Package className="w-5 h-5" /> Produtos
              <span className="ml-auto bg-red-600 text-white text-[10px] font-bold px-2 py-0.5 rounded-full">
                {products.filter(p => {
                  const category = categories.find(c => c.id === p.categoryId);
                  return !category || !isExcludedCategory(category.name);
                }).length}
              </span>
            </button>
          )}
          {!isCaixaUser && (
            <button type="button" 
              onClick={() => {
                setActiveTab('flavors');
                setIsMobileNavOpen(false);
              }}
              className={`w-full flex items-center gap-3 px-4 py-3 rounded-xl transition-colors cursor-pointer font-medium text-sm ${activeTab === 'flavors' ? 'bg-orange-600 text-white' : 'hover:bg-stone-800'}`}
            >
              <Droplets className="w-5 h-5" /> Sabores
              <span className="ml-auto bg-red-600 text-white text-[10px] font-bold px-2 py-0.5 rounded-full">
                {products.filter(p => {
                  const category = categories.find(c => c.id === p.categoryId);
                  return p.isFlavor && (!category || !isExcludedCategory(category.name));
                }).length}
              </span>
            </button>
          )}
          {!isCaixaUser && isAdminOrMaster && (
            <button type="button" 
              onClick={() => {
                setActiveTab('sync_logs');
                setIsMobileNavOpen(false);
              }}
              className={`w-full flex items-center gap-3 px-4 py-3 rounded-xl transition-colors cursor-pointer font-medium text-sm ${activeTab === 'sync_logs' ? 'bg-orange-600 text-white' : 'hover:bg-stone-800'}`}
            >
              <History className="w-5 h-5" /> Histórico de Atualizações
            </button>
          )}
          {!isCaixaUser && (
            <button type="button" 
              onClick={() => {
                setActiveTab('sms');
                setIsMobileNavOpen(false);
              }}
              className={`w-full flex items-center gap-3 px-4 py-3 rounded-xl transition-colors cursor-pointer font-medium text-sm ${activeTab === 'sms' ? 'bg-orange-600 text-white' : 'hover:bg-stone-800'}`}
            >
              <MessageCircle className="w-5 h-5" /> Lembretes SMS (3x/dia)
            </button>
          )}
          {!isCaixaUser && (
            <button type="button" 
              onClick={() => {
                setActiveTab('tv');
                setIsMobileNavOpen(false);
              }}
              className={`w-full flex items-center gap-3 px-4 py-3 rounded-xl transition-colors cursor-pointer font-medium text-sm ${activeTab === 'tv' ? 'bg-orange-600 text-white' : 'hover:bg-stone-800'}`}
            >
              <Tv className="w-5 h-5" /> Smart TV / Mídia
            </button>
          )}
          {/* Configurações: APENAS USUÁRIO MASTER! Removido para Administradores (inclusive Vanderluce) e Padrão */}
          {!isCaixaUser && isMaster && (
            <button type="button" 
              onClick={() => {
                setActiveTab('settings');
                setIsMobileNavOpen(false);
              }}
              className={`w-full flex items-center gap-3 px-4 py-3 rounded-xl transition-colors cursor-pointer font-medium text-sm ${activeTab === 'settings' ? 'bg-orange-600 text-white' : 'hover:bg-stone-800'}`}
            >
              <Settings className="w-5 h-5" /> Configurações
            </button>
          )}
          {/* Usuários: APENAS USUÁRIO MASTER! Removido para Administradores (inclusive Vanderluce) e Padrão */}
          {!isCaixaUser && isMaster && (
            <button type="button" 
              onClick={() => {
                setActiveTab('users');
                setIsMobileNavOpen(false);
              }}
              className={`w-full flex items-center gap-3 px-4 py-3 rounded-xl transition-colors cursor-pointer font-medium text-sm ${activeTab === 'users' ? 'bg-orange-600 text-white' : 'hover:bg-stone-800'}`}
            >
              <Users className="w-5 h-5" /> Usuários
            </button>
          )}

          {!isCaixaUser && isAdminOrMaster && (
            <button type="button" 
              onClick={() => {
                setActiveTab('audit');
                setIsMobileNavOpen(false);
              }}
              className={`w-full flex items-center gap-3 px-4 py-3 rounded-xl transition-colors cursor-pointer font-medium text-sm ${activeTab === 'audit' ? 'bg-orange-600 text-white' : 'hover:bg-stone-800'}`}
            >
              <ShieldCheck className="w-5 h-5" /> Auditoria Crítica
            </button>
          )}

          <Link
            to="/documentacao"
            target="_blank"
            className="w-full flex items-center justify-between px-4 py-3 rounded-xl transition-colors cursor-pointer font-medium text-sm text-stone-300 hover:text-white hover:bg-stone-800"
            title="Abrir a documentação completa e roteiro funcional para visualização e impressão em PDF"
          >
            <span className="flex items-center gap-3">
              <FileText className="w-5 h-5 text-orange-400" />
              <span>Documentação PDF</span>
            </span>
            <span className="text-[10px] bg-orange-600/20 text-orange-400 border border-orange-500/30 px-1.5 py-0.5 rounded font-black uppercase">
              Manual
            </span>
          </Link>
        </nav>
        <div className="p-4 border-t border-stone-800 space-y-2 shrink-0">
          <button type="button" 
            onClick={() => handleToggleSound()}
            className={`w-full flex items-center justify-between px-4 py-3 rounded-xl transition-all cursor-pointer border ${
              isSoundEnabled 
                ? 'bg-emerald-950/40 text-emerald-200 border-emerald-800/60 hover:bg-emerald-900/40' 
                : 'bg-stone-900/60 text-stone-400 border-stone-800 hover:bg-stone-800 hover:text-stone-200'
            }`}
            title="Ativar ou desativar o alarme sonoro de novos pedidos"
          >
            <span className="flex items-center gap-3 text-sm font-bold">
              {isSoundEnabled ? <Volume2 className="w-5 h-5 text-emerald-400" /> : <VolumeX className="w-5 h-5 text-stone-400" />}
              Som de Pedido
            </span>
            <span className={`text-xs px-2.5 py-1 rounded-full font-black ${isSoundEnabled ? 'bg-emerald-500 text-stone-950 shadow-xs' : 'bg-stone-800 text-stone-400'}`}>
              {isSoundEnabled ? 'ON' : 'OFF'}
            </span>
          </button>

          {/* Quick Toggle: Botão Flutuante (Conhecer o Sistema) */}
          <button 
            type="button" 
            onClick={() => handleToggleShowSystemIntroButton(!showSystemIntroButtonState)}
            className="w-full flex items-center justify-between px-4 py-2.5 rounded-xl transition-all text-stone-300 hover:bg-stone-800 hover:text-white border border-stone-800 hover:border-amber-500/40 cursor-pointer group"
            title="Clique para ativar ou desativar o botão flutuante 'Conhecer o Sistema' no cardápio"
          >
            <span className="flex items-center gap-2.5 text-xs font-bold text-left">
              <Sparkles className="w-4 h-4 text-amber-400 shrink-0 group-hover:scale-110 transition-transform" />
              <span>Botão "Conhecer"</span>
            </span>
            <span className={`text-[10px] font-black px-2 py-0.5 rounded-full transition-colors ${
              showSystemIntroButtonState 
                ? 'bg-amber-500/20 text-amber-300 border border-amber-500/40' 
                : 'bg-stone-800 text-stone-500 border border-stone-700'
            }`}>
              {showSystemIntroButtonState ? 'LIGADO' : 'DESLIGADO'}
            </span>
          </button>
          <Link 
            to="/" 
            onClick={() => setIsMobileNavOpen(false)}
            className="w-full flex items-center justify-center gap-2 text-stone-300 hover:text-white bg-stone-800/80 hover:bg-stone-800 px-4 py-2.5 rounded-xl transition-colors text-sm font-bold"
          >
            Ver Cardápio Digital
          </Link>
          <button type="button" 
            onClick={() => {
              localStorage.removeItem('balbec_admin_session');
              setIsAuthenticated(false);
              setCurrentUser(null);
              auth.signOut();
            }}
            className="w-full flex items-center justify-center gap-2 mt-2 text-red-400 hover:text-red-300 hover:bg-red-400/10 px-4 py-2 rounded-xl transition-colors text-sm font-semibold cursor-pointer"
          >
            Sair
          </button>
        </div>
      </aside>

      {/* Main Content */}
      <main className="flex-1 p-4 sm:p-6 md:p-8 overflow-y-auto">
        {/* Global Maintenance Alert Banner */}
        {storeInfo.isMaintenance && (
          <div className="mb-6 bg-gradient-to-r from-amber-500/15 via-amber-500/10 to-amber-500/5 border-2 border-amber-500 rounded-2xl p-4 sm:p-5 flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4 shadow-md">
            <div className="flex items-start sm:items-center gap-3.5">
              <div className="p-3 bg-amber-500 text-stone-950 rounded-2xl font-black shrink-0 shadow-sm">
                <Wrench className="w-6 h-6 animate-bounce duration-1000" />
              </div>
              <div>
                <h4 className="text-amber-950 font-black text-base flex items-center gap-2 flex-wrap">
                  <span>Modo de Manutenção está ATIVADO</span>
                  <span className="text-[10px] bg-amber-500 text-stone-950 px-2 py-0.5 rounded-full font-black uppercase tracking-wider">
                    Público Bloqueado
                  </span>
                </h4>
                <p className="text-amber-900/80 text-xs mt-0.5 font-medium leading-relaxed">
                  O cardápio digital está exibindo a tela de manutenção com seus contatos. Somente administradores logados continuam com acesso.
                </p>
              </div>
            </div>
            <div className="flex items-center gap-2 shrink-0 w-full sm:w-auto">
              <button
                type="button"
                onClick={async () => {
                  try {
                    await updateStoreInfo({ isMaintenance: false });
                    setConfirmModal({
                      isOpen: true,
                      title: 'Manutenção Desativada',
                      message: 'O cardápio digital voltou a ficar 100% disponível ao público!',
                      onConfirm: () => setConfirmModal(null)
                    });
                  } catch (e) {
                    showInfoModal('Erro', 'Erro ao desativar manutenção.');
                  }
                }}
                className="w-full sm:w-auto bg-amber-600 hover:bg-amber-700 active:scale-95 text-white text-xs font-bold px-4 py-2.5 rounded-xl transition-all shadow-sm flex items-center justify-center gap-1.5 cursor-pointer"
              >
                <CheckCircle2 className="w-4 h-4" />
                <span>Desativar Manutenção Agora</span>
              </button>
            </div>
          </div>
        )}

        {activeTab === 'dashboard' && !isCaixaUser && renderDashboard()}
        {activeTab === 'orders' && !isPadrao && renderOrders()}
        {activeTab === 'customers' && (isAdminOrMaster || isCaixaUser) && (
          <CustomersTab
            onSyncBlueFocusCustomers={handleSyncCustomersBlueFocus}
            isSyncingERP={isSyncing}
          />
        )}
        {activeTab === 'tables' && (isAdminOrMaster || isCaixaUser) && <TableManagerTab orders={orders} />}
        {activeTab === 'categories' && !isCaixaUser && renderCategories()}
        {activeTab === 'products' && !isCaixaUser && renderProducts()}
        {activeTab === 'flavors' && !isCaixaUser && renderFlavors()}
        {activeTab === 'sync_logs' && !isCaixaUser && isAdminOrMaster && renderSyncLogs()}
        {activeTab === 'tv' && !isCaixaUser && <TvManagerTab />}
        {activeTab === 'settings' && !isCaixaUser && isMaster && renderSettings()}
        {activeTab === 'users' && !isCaixaUser && isMaster && renderUsers()}
        {activeTab === 'sms' && (isAdminOrMaster || isCaixaUser) && <SmsRemindersTab />}
        {activeTab === 'audit' && !isCaixaUser && isAdminOrMaster && renderAuditTab()}
      </main>

      {/* Global ERP Sync Progress Modal when not on products tab */}
      {syncProgress && activeTab !== 'products' && (
        <div className="fixed inset-0 z-[100] flex items-center justify-center bg-stone-900/60 backdrop-blur-sm p-4 animate-in fade-in duration-200">
          <div className="bg-white rounded-2xl shadow-2xl border border-stone-200 max-w-lg w-full p-6 space-y-5 relative overflow-hidden">
            <div className="flex items-center gap-4 border-b border-stone-100 pb-4">
              <div className="w-12 h-12 rounded-xl bg-blue-100 text-blue-600 flex items-center justify-center shrink-0 shadow-inner">
                <RefreshCw className="w-6 h-6 animate-spin" />
              </div>
              <div>
                <h3 className="text-lg font-bold text-stone-900 flex items-center gap-2">
                  Sincronização ERP BlueFocus
                </h3>
                <p className="text-xs text-stone-500">
                  Evolução da importação e atualização no banco de dados PostgreSQL em tempo real
                </p>
              </div>
            </div>

            <div className="space-y-2">
              <div className="flex justify-between items-center text-xs font-semibold">
                <span className="text-blue-600 flex items-center gap-1.5 truncate max-w-[280px]">
                  <span className="w-2 h-2 rounded-full bg-blue-500 animate-ping shrink-0"></span>
                  <span className="truncate">{syncProgress.status}</span>
                </span>
                <span className="text-stone-500 font-mono text-[11px] shrink-0">
                  {syncProgress.total > 0 ? `${syncProgress.total} válidos` : `${syncProgress.current} lidos`}
                </span>
              </div>
              <div className="w-full bg-stone-100 h-3 rounded-full overflow-hidden p-0.5 border border-stone-200">
                <div
                  className="bg-gradient-to-r from-blue-500 via-indigo-500 to-emerald-500 h-full rounded-full transition-all duration-300 relative overflow-hidden"
                  style={{ width: '100%' }}
                >
                  <div className="absolute inset-0 bg-white/25 animate-pulse"></div>
                </div>
              </div>
            </div>

            <div className="grid grid-cols-3 gap-3">
              <div className="bg-stone-50 p-3 rounded-xl border border-stone-200/80 text-center">
                <div className="text-[10px] uppercase font-bold text-stone-400 tracking-wider">Lotes Lidos</div>
                <div className="text-xl font-extrabold text-stone-800 mt-0.5 font-mono">
                  {syncProgress.current}
                </div>
              </div>

              <div className="bg-emerald-50 p-3 rounded-xl border border-emerald-200/80 text-center">
                <div className="text-[10px] uppercase font-bold text-emerald-600 tracking-wider">Registros Válidos</div>
                <div className="text-xl font-extrabold text-emerald-700 mt-0.5 font-mono">
                  {syncProgress.total}
                </div>
              </div>

              <div className="bg-amber-50 p-3 rounded-xl border border-amber-200/80 text-center">
                <div className="text-[10px] uppercase font-bold text-amber-600 tracking-wider">Itens Ignorados</div>
                <div className="text-xl font-extrabold text-amber-700 mt-0.5 font-mono">
                  {syncProgress.ignored}
                </div>
              </div>
            </div>

            {syncProgress.lastProcessedName && (
              <div className="bg-stone-50 rounded-xl p-3.5 border border-stone-200/80 space-y-2">
                <div className="text-[10px] font-bold uppercase tracking-wider text-stone-400 flex items-center justify-between">
                  <span>Evolução da Leitura</span>
                  <span className="text-blue-500 font-normal italic">Processando...</span>
                </div>
                <div className="space-y-1.5">
                  <div className="text-xs font-semibold text-stone-700 truncate flex items-center gap-1.5">
                    <span className="w-1.5 h-1.5 rounded-full bg-stone-400 shrink-0"></span>
                    <span className="text-stone-400 text-[10px] shrink-0">Último Lido:</span>
                    <span className="truncate italic font-normal text-stone-600">{syncProgress.lastProcessedName}</span>
                  </div>
                  {syncProgress.lastProductName && (
                    <div className="text-xs font-bold text-emerald-800 truncate flex items-center gap-1.5 bg-emerald-100/70 p-2 rounded-lg border border-emerald-200">
                      <CheckCircle2 className="w-4 h-4 text-emerald-600 shrink-0" />
                      <span className="text-[10px] text-emerald-700 uppercase tracking-wide shrink-0">Último Válido:</span>
                      <span className="truncate">{syncProgress.lastProductName}</span>
                    </div>
                  )}
                </div>
              </div>
            )}
          </div>
        </div>
      )}

      {/* Modals */}
      {paymentConfirmModal && (() => {
        const pb = getOrderPaymentBreakdown(paymentConfirmModal.order);
        const isPartial50 = pb.kind === 'partial_50';
        const amountToConfirm = isPartial50 ? pb.paidAmount : pb.totalAmount;
        const ordNum = String(paymentConfirmModal.order.id).slice(-4).padStart(4, '0');
        return (
          <div className="fixed inset-0 bg-black/60 backdrop-blur-xs flex items-center justify-center z-[70] p-4">
            <div className="bg-white rounded-2xl shadow-2xl w-full max-w-md overflow-hidden border border-stone-200">
              <div className="bg-emerald-700 text-white px-5 py-4 flex items-center justify-between">
                <div className="flex items-center gap-2.5">
                  <ShieldCheck className="w-6 h-6 text-emerald-200" />
                  <div>
                    <h3 className="text-base font-black tracking-wide uppercase">Confirmar Pagamento</h3>
                    <p className="text-xs text-emerald-100 font-medium">Pedido #{ordNum} • {paymentConfirmModal.order.customerName}</p>
                  </div>
                </div>
                <button
                  type="button"
                  onClick={() => setPaymentConfirmModal(null)}
                  disabled={paymentConfirmModal.isSubmitting}
                  className="p-1.5 rounded-full hover:bg-white/15 transition-colors cursor-pointer"
                >
                  <X className="w-5 h-5" />
                </button>
              </div>

              <form onSubmit={handleSubmitPaymentConfirmation} className="p-5 space-y-4">
                <div className={`border rounded-xl p-3.5 text-xs space-y-1.5 ${isPartial50 ? 'bg-amber-50 border-amber-300' : 'bg-emerald-50 border-emerald-300'}`}>
                  <div className={`font-black uppercase tracking-tight ${isPartial50 ? 'text-amber-950' : 'text-emerald-950'}`}>
                    {isPartial50 ? 'Entrada de 50% (Salgados Congelados)' : 'Pagamento Online Integral (100%)'}
                  </div>
                  <div className="flex justify-between text-stone-700 font-medium">
                    <span>{isPartial50 ? 'Valor Entrada (50%):' : 'Valor Integral (100%):'}</span>
                    <strong className="text-emerald-800 font-black">{formatBRL(amountToConfirm)}</strong>
                  </div>
                  {isPartial50 ? (
                    <div className="flex justify-between text-stone-700 font-medium">
                      <span>Restante na Retirada:</span>
                      <strong className="text-amber-900 font-black">{formatBRL(pb.remainingAmount)}</strong>
                    </div>
                  ) : (
                    <div className="flex justify-between text-stone-700 font-medium">
                      <span>Restante na Retirada:</span>
                      <strong className="text-emerald-800 font-black">R$ 0,00 (Quitado)</strong>
                    </div>
                  )}
                  <div className={`flex justify-between text-stone-700 font-medium pt-1 border-t ${isPartial50 ? 'border-amber-200' : 'border-emerald-200'}`}>
                    <span>Forma informada:</span>
                    <strong className="text-stone-900">{pb.methodLabel}</strong>
                  </div>
                </div>

                <p className="text-xs text-stone-600 leading-relaxed">
                  Confirme abaixo que o pagamento {isPartial50 ? 'de entrada (50%)' : 'integral'} de <strong>{formatBRL(amountToConfirm)}</strong> foi realmente recebido na conta ou maquininha. Após confirmar, o pedido será liberado para entrar em produção.
                </p>

                <div>
                  <label className="block text-xs font-black uppercase tracking-wider text-stone-700 mb-1.5">
                    Nome de Quem Está Confirmando *
                  </label>
                  <div className="relative">
                    <UserCheck className="w-4 h-4 text-stone-400 absolute left-3 top-1/2 -translate-y-1/2" />
                    <input
                      type="text"
                      autoFocus
                      value={paymentConfirmModal.confirmerName}
                      onChange={(e) => setPaymentConfirmModal(prev => prev ? { ...prev, confirmerName: e.target.value, error: null } : null)}
                      placeholder="Digite seu nome completo"
                      disabled={paymentConfirmModal.isSubmitting}
                      className="w-full pl-9 pr-4 py-2.5 border-2 border-stone-300 rounded-xl text-sm font-bold text-stone-900 focus:border-emerald-600 focus:ring-2 focus:ring-emerald-500/20 outline-none"
                    />
                  </div>
                </div>

                <div>
                  <label className="block text-xs font-black uppercase tracking-wider text-stone-700 mb-1.5">
                    Senha de Confirmação do Operador *
                  </label>
                  <div className="relative">
                    <KeyRound className="w-4 h-4 text-stone-400 absolute left-3 top-1/2 -translate-y-1/2" />
                    <input
                      type={paymentConfirmModal.showPassword ? 'text' : 'password'}
                      value={paymentConfirmModal.password}
                      onChange={(e) => setPaymentConfirmModal(prev => prev ? { ...prev, password: e.target.value, error: null } : null)}
                      placeholder="Digite a senha para liberar"
                      disabled={paymentConfirmModal.isSubmitting}
                      className="w-full pl-9 pr-10 py-2.5 border-2 border-stone-300 rounded-xl text-sm font-bold text-stone-900 focus:border-emerald-600 focus:ring-2 focus:ring-emerald-500/20 outline-none"
                    />
                    <button
                      type="button"
                      onClick={() => setPaymentConfirmModal(prev => prev ? { ...prev, showPassword: !prev.showPassword } : null)}
                      className="absolute right-2.5 top-1/2 -translate-y-1/2 p-1 text-stone-500 hover:text-stone-800 cursor-pointer"
                      tabIndex={-1}
                    >
                      {paymentConfirmModal.showPassword ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
                    </button>
                  </div>
                </div>

                {/* Anexar Comprovante do Pagamento / Pix */}
                <div>
                  <label className="block text-xs font-black uppercase tracking-wider text-stone-700 mb-1.5 flex items-center gap-1.5">
                    <Paperclip className="w-4 h-4 text-emerald-600 shrink-0" />
                    <span>Anexar Comprovante do Pix / Pagamento *</span>
                  </label>
                  <div className="flex items-center gap-2">
                    <input 
                      type="file" 
                      accept="image/*,application/pdf"
                      onChange={(e) => {
                        const file = e.target.files?.[0];
                        if (file) {
                          if (file.size > 5 * 1024 * 1024) {
                            alert('O arquivo é muito grande (máximo 5MB).');
                            return;
                          }
                          const reader = new FileReader();
                          reader.onload = (uploadEvent) => {
                            setPaymentConfirmModal(prev => prev ? { ...prev, receiptUrl: uploadEvent.target?.result as string, error: null } : null);
                          };
                          reader.readAsDataURL(file);
                        }
                      }}
                      className="w-full text-xs text-stone-600 file:mr-2 file:py-2 file:px-3 file:rounded-xl file:border-0 file:text-xs file:font-black file:bg-emerald-600 file:text-white hover:file:bg-emerald-700 cursor-pointer border-2 border-dashed border-stone-300 rounded-xl p-2 bg-stone-50"
                    />
                  </div>
                  {paymentConfirmModal.receiptUrl ? (
                    <div className="mt-2 flex items-center justify-between bg-emerald-50 border border-emerald-200 p-2 rounded-xl text-xs text-emerald-900 font-bold">
                      <span className="truncate">Comprovante anexado com sucesso!</span>
                      <button 
                        type="button" 
                        onClick={() => setPaymentConfirmModal(prev => prev ? { ...prev, receiptUrl: null } : null)}
                        className="text-red-600 hover:text-red-800 text-[11px] font-black px-2 py-0.5 cursor-pointer"
                      >
                        Remover
                      </button>
                    </div>
                  ) : (
                    <p className="text-[11px] text-amber-700 font-bold mt-1">
                      ⚠️ É obrigatório anexar o comprovante do pagamento para habilitar a confirmação.
                    </p>
                  )}
                </div>

                {paymentConfirmModal.error && (
                  <div className="bg-red-50 border border-red-300 text-red-800 rounded-xl px-3.5 py-2.5 text-xs font-bold flex items-start gap-2">
                    <AlertTriangle className="w-4 h-4 text-red-600 shrink-0 mt-0.5" />
                    <span>{paymentConfirmModal.error}</span>
                  </div>
                )}

                <div className="flex justify-end gap-2.5 pt-2">
                  <button
                    type="button"
                    onClick={() => setPaymentConfirmModal(null)}
                    disabled={paymentConfirmModal.isSubmitting}
                    className="px-4 py-2.5 text-stone-600 hover:bg-stone-100 rounded-xl text-xs font-bold cursor-pointer disabled:opacity-50"
                  >
                    Cancelar
                  </button>
                  <button
                    type="submit"
                    disabled={paymentConfirmModal.isSubmitting || !paymentConfirmModal.receiptUrl}
                    className="px-5 py-2.5 bg-emerald-600 hover:bg-emerald-700 text-white rounded-xl text-xs font-black uppercase tracking-wider flex items-center gap-2 shadow-sm transition-all cursor-pointer disabled:opacity-50"
                  >
                    {paymentConfirmModal.isSubmitting ? (
                      <>
                        <RefreshCw className="w-4 h-4 animate-spin" />
                        Validando...
                      </>
                    ) : (
                      <>
                        <ShieldCheck className="w-4 h-4" />
                        Confirmar Recebimento
                      </>
                    )}
                  </button>
                </div>
              </form>
            </div>
          </div>
        );
      })()}

      {/* Modal de Senha Master (Exclusão de Pedidos e Auditoria de Liberações) */}
      {masterAuthModal && (
        <div className="fixed inset-0 bg-black/70 backdrop-blur-xs flex items-center justify-center z-[75] p-4">
          <div className="bg-white rounded-2xl shadow-2xl w-full max-w-md overflow-hidden border border-stone-200">
            <div className={`px-5 py-4 flex items-center justify-between text-white ${
              masterAuthModal.action === 'delete_order' || masterAuthModal.action === 'clear_all_orders'
                ? 'bg-red-700'
                : masterAuthModal.action === 'revert_order_status'
                ? 'bg-amber-700'
                : 'bg-stone-900'
            }`}>
              <div className="flex items-center gap-2.5">
                <Lock className={`w-5 h-5 ${
                  masterAuthModal.action === 'delete_order' || masterAuthModal.action === 'clear_all_orders'
                    ? 'text-red-200'
                    : masterAuthModal.action === 'revert_order_status'
                    ? 'text-amber-200'
                    : 'text-amber-400'
                }`} />
                <div>
                  <h3 className="text-sm sm:text-base font-black tracking-wide uppercase">
                    {masterAuthModal.title}
                  </h3>
                  <p className="text-[11px] opacity-85 font-medium">
                    Acesso restrito ao Usuário Master
                  </p>
                </div>
              </div>
              <button
                type="button"
                onClick={() => setMasterAuthModal(null)}
                disabled={masterAuthModal.isSubmitting}
                className="p-1.5 rounded-full hover:bg-white/15 transition-colors cursor-pointer"
              >
                <X className="w-5 h-5" />
              </button>
            </div>

            <form onSubmit={handleSubmitMasterAuth} className="p-5 space-y-4">
              <p className="text-xs sm:text-sm text-stone-700 font-medium leading-relaxed whitespace-pre-line">
                {masterAuthModal.description}
              </p>

              <div>
                <label className="block text-xs font-black uppercase tracking-wider text-stone-700 mb-1.5">
                  Senha Master *
                </label>
                <div className="relative">
                  <KeyRound className="w-4 h-4 text-stone-400 absolute left-3 top-1/2 -translate-y-1/2" />
                  <input
                    type={masterAuthModal.showPassword ? 'text' : 'password'}
                    autoFocus
                    value={masterAuthModal.password}
                    onChange={(e) => setMasterAuthModal(prev => prev ? { ...prev, password: e.target.value, error: null } : null)}
                    placeholder="Digite a senha Master"
                    disabled={masterAuthModal.isSubmitting}
                    className="w-full pl-9 pr-10 py-2.5 border-2 border-stone-300 rounded-xl text-sm font-bold text-stone-900 focus:border-stone-900 focus:ring-2 focus:ring-stone-500/20 outline-none"
                  />
                  <button
                    type="button"
                    onClick={() => setMasterAuthModal(prev => prev ? { ...prev, showPassword: !prev.showPassword } : null)}
                    className="absolute right-2.5 top-1/2 -translate-y-1/2 p-1 text-stone-500 hover:text-stone-800 cursor-pointer"
                    tabIndex={-1}
                  >
                    {masterAuthModal.showPassword ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
                  </button>
                </div>
              </div>

              {masterAuthModal.error && (
                <div className="bg-red-50 border border-red-300 text-red-800 rounded-xl px-3.5 py-2.5 text-xs font-bold flex items-start gap-2">
                  <AlertTriangle className="w-4 h-4 text-red-600 shrink-0 mt-0.5" />
                  <span>{masterAuthModal.error}</span>
                </div>
              )}

              <div className="flex justify-end gap-2.5 pt-2">
                <button
                  type="button"
                  onClick={() => setMasterAuthModal(null)}
                  disabled={masterAuthModal.isSubmitting}
                  className="px-4 py-2.5 text-stone-600 hover:bg-stone-100 rounded-xl text-xs font-bold cursor-pointer disabled:opacity-50"
                >
                  Cancelar
                </button>
                <button
                  type="submit"
                  disabled={masterAuthModal.isSubmitting}
                  className={`px-5 py-2.5 text-white rounded-xl text-xs font-black uppercase tracking-wider flex items-center gap-2 shadow-sm transition-all cursor-pointer disabled:opacity-50 ${
                    masterAuthModal.action === 'delete_order' || masterAuthModal.action === 'clear_all_orders'
                      ? 'bg-red-600 hover:bg-red-700'
                      : masterAuthModal.action === 'revert_order_status'
                      ? 'bg-amber-600 hover:bg-amber-700'
                      : 'bg-stone-900 hover:bg-stone-800 text-amber-300'
                  }`}
                >
                  {masterAuthModal.isSubmitting ? (
                    <>
                      <RefreshCw className="w-4 h-4 animate-spin" />
                      Validando...
                    </>
                  ) : masterAuthModal.action === 'delete_order' || masterAuthModal.action === 'clear_all_orders' ? (
                    <>
                      <Trash2 className="w-4 h-4" />
                      Autorizar Exclusão
                    </>
                  ) : masterAuthModal.action === 'revert_order_status' ? (
                    <>
                      <ShieldCheck className="w-4 h-4" />
                      Autorizar Alteração
                    </>
                  ) : (
                    <>
                      <ShieldCheck className="w-4 h-4" />
                      Desbloquear Consulta
                    </>
                  )}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* Modal Master de Auditoria: Quem Confirmou / Liberou Pagamentos Online */}
      {paymentAuditModal.isOpen && (() => {
        const allOrdersMap = new Map<string, Order>();
        [...orders, ...rawOrders].forEach((o) => {
          if (o && o.id) allOrdersMap.set(String(o.id).trim(), o);
        });
        const allConfirmedOrders = Array.from(allOrdersMap.values())
          .filter((o) => o.paymentConfirmedByOperator === true || Boolean(o.paymentConfirmedAt))
          .sort((a, b) => (Number(b.paymentConfirmedAt) || Number(b.updatedAt) || Number(b.createdAt) || 0) - (Number(a.paymentConfirmedAt) || Number(a.updatedAt) || Number(a.createdAt) || 0));

        const focusedOrder = paymentAuditModal.focusOrderId
          ? allOrdersMap.get(String(paymentAuditModal.focusOrderId).trim()) || null
          : null;

        const q = paymentAuditModal.search.trim().toLowerCase();
        const filteredAuditOrders = allConfirmedOrders.filter((o) => {
          if (!q) return true;
          const shortId = String(o.id).slice(-4).padStart(4, '0').toLowerCase();
          return (
            shortId.includes(q) ||
            String(o.id).toLowerCase().includes(q) ||
            String(o.customerName || '').toLowerCase().includes(q) ||
            String(o.paymentConfirmedBy || '').toLowerCase().includes(q) ||
            String(o.paymentMethod || '').toLowerCase().includes(q)
          );
        });

        const renderAuditCard = (ord: Order, highlight = false) => {
          const pb = getOrderPaymentBreakdown(ord);
          const isPartial50 = pb.kind === 'partial_50';
          const confirmedAmount = isPartial50 ? pb.paidAmount : pb.totalAmount;
          const shortId = String(ord.id).slice(-4).padStart(4, '0');
          const confirmedDateStr = ord.paymentConfirmedAt
            ? new Date(ord.paymentConfirmedAt).toLocaleString('pt-BR', {
                day: '2-digit',
                month: '2-digit',
                year: 'numeric',
                hour: '2-digit',
                minute: '2-digit',
                second: '2-digit'
              })
            : 'Data não registrada';
          const orderDateStr = ord.createdAt
            ? new Date(ord.createdAt).toLocaleString('pt-BR', {
                day: '2-digit',
                month: '2-digit',
                year: 'numeric',
                hour: '2-digit',
                minute: '2-digit'
              })
            : '--';

          return (
            <div
              key={`${highlight ? 'focus-' : ''}${ord.id}`}
              className={`rounded-2xl border-2 p-4 space-y-2.5 ${
                highlight
                  ? 'bg-amber-50/70 border-amber-400 shadow-md'
                  : 'bg-white border-stone-200 shadow-xs'
              }`}
            >
              <div className="flex items-start justify-between gap-2 flex-wrap">
                <div>
                  <div className="flex items-center gap-2 flex-wrap">
                    <span className="font-mono font-black text-base text-stone-900">
                      Pedido #{shortId}
                    </span>
                    <span className={`px-2 py-0.5 rounded-full text-[10px] font-black uppercase ${
                      isPartial50
                        ? 'bg-amber-100 text-amber-900 border border-amber-300'
                        : 'bg-emerald-100 text-emerald-800 border border-emerald-300'
                    }`}>
                      {isPartial50 ? '50% Congelados' : 'Integral 100% Online'}
                    </span>
                    {highlight && (
                      <span className="px-2 py-0.5 rounded-full text-[10px] font-black uppercase bg-stone-900 text-amber-300">
                        Pedido Selecionado
                      </span>
                    )}
                  </div>
                  <p className="text-xs font-bold text-stone-700 mt-0.5">
                    Cliente: <span className="text-stone-900">{ord.customerName || 'Cliente'}</span> • Feito em {orderDateStr}
                  </p>
                </div>
                <div className="text-right">
                  <div className="text-xs font-bold text-stone-500">Valor Confirmado</div>
                  <div className="text-base font-black text-emerald-700">{formatBRL(confirmedAmount)}</div>
                  <div className="text-[10px] font-semibold text-stone-500">{pb.methodLabel}</div>
                </div>
              </div>

              <div className="bg-emerald-50 border border-emerald-300 rounded-xl px-3.5 py-2.5 flex flex-col sm:flex-row sm:items-center sm:justify-between gap-1.5">
                <div className="flex items-center gap-2">
                  <UserCheck className="w-4 h-4 text-emerald-700 shrink-0" />
                  <div className="text-xs">
                    <span className="text-emerald-900 font-semibold">Liberado / Confirmado por: </span>
                    <strong className="text-emerald-950 font-black uppercase">
                      {ord.paymentConfirmedBy || 'Não informado (registro antigo)'}
                    </strong>
                  </div>
                </div>
                <div className="text-[11px] font-bold text-emerald-800 flex items-center gap-1 shrink-0">
                  <Clock className="w-3.5 h-3.5" />
                  <span>{confirmedDateStr}</span>
                </div>
              </div>
            </div>
          );
        };

        return (
          <div className="fixed inset-0 bg-black/70 backdrop-blur-xs flex items-center justify-center z-[75] p-3 sm:p-5">
            <div className="bg-stone-50 rounded-2xl shadow-2xl w-full max-w-3xl max-h-[90vh] flex flex-col overflow-hidden border border-stone-200">
              <div className="bg-stone-900 text-white px-5 py-4 flex items-center justify-between shrink-0">
                <div className="flex items-center gap-3">
                  <div className="w-10 h-10 rounded-xl bg-amber-400/20 border border-amber-400/40 flex items-center justify-center">
                    <ShieldCheck className="w-5 h-5 text-amber-400" />
                  </div>
                  <div>
                    <h3 className="text-base font-black uppercase tracking-wide">
                      Auditoria de Liberações (Master)
                    </h3>
                    <p className="text-xs text-stone-300 font-medium">
                      Registro de responsáveis pelas confirmações de pagamento online ({allConfirmedOrders.length} {allConfirmedOrders.length === 1 ? 'pedido' : 'pedidos'})
                    </p>
                  </div>
                </div>
                <button
                  type="button"
                  onClick={() => setPaymentAuditModal({ isOpen: false, focusOrderId: null, search: '' })}
                  className="p-1.5 rounded-full hover:bg-white/15 transition-colors cursor-pointer"
                >
                  <X className="w-5 h-5" />
                </button>
              </div>

              <div className="p-4 bg-white border-b border-stone-200 flex flex-col sm:flex-row items-stretch sm:items-center gap-2.5 shrink-0">
                <div className="relative flex-1">
                  <Search className="w-4 h-4 text-stone-400 absolute left-3 top-1/2 -translate-y-1/2" />
                  <input
                    type="text"
                    value={paymentAuditModal.search}
                    onChange={(e) => setPaymentAuditModal(prev => ({ ...prev, search: e.target.value }))}
                    placeholder="Filtrar por nº do pedido, cliente ou nome de quem confirmou..."
                    className="w-full pl-9 pr-4 py-2 border border-stone-300 rounded-xl text-xs font-semibold text-stone-900 focus:border-stone-900 outline-none"
                  />
                </div>
                {focusedOrder && (
                  <button
                    type="button"
                    onClick={() => setPaymentAuditModal(prev => ({ ...prev, focusOrderId: null }))}
                    className="px-3 py-2 bg-stone-100 hover:bg-stone-200 text-stone-800 rounded-xl text-xs font-bold cursor-pointer shrink-0"
                  >
                    Mostrar Todos ({allConfirmedOrders.length})
                  </button>
                )}
              </div>

              <div className="p-4 overflow-y-auto space-y-3 flex-1">
                {focusedOrder && renderAuditCard(focusedOrder, true)}

                {filteredAuditOrders.length === 0 ? (
                  <div className="bg-white border border-stone-200 rounded-2xl p-8 text-center text-stone-500">
                    <History className="w-10 h-10 mx-auto mb-2 text-stone-300" />
                    <p className="text-sm font-bold text-stone-700">
                      Nenhuma liberação de pagamento online encontrada.
                    </p>
                    <p className="text-xs text-stone-500 mt-1">
                      Assim que um pagamento online for confirmado com nome e senha, o registro aparecerá aqui.
                    </p>
                  </div>
                ) : (
                  filteredAuditOrders
                    .filter((o) => !focusedOrder || String(o.id) !== String(focusedOrder.id))
                    .map((ord) => renderAuditCard(ord, false))
                )}
              </div>

              <div className="px-5 py-3 bg-white border-t border-stone-200 flex justify-end shrink-0">
                <button
                  type="button"
                  onClick={() => setPaymentAuditModal({ isOpen: false, focusOrderId: null, search: '' })}
                  className="px-5 py-2 bg-stone-900 hover:bg-stone-800 text-white rounded-xl text-xs font-black uppercase tracking-wider cursor-pointer"
                >
                  Fechar Auditoria
                </button>
              </div>
            </div>
          </div>
        );
      })()}

      {confirmModal && (
        <div className="fixed inset-0 bg-black/60 backdrop-blur-xs flex items-center justify-center z-[60] p-4">
          <div className={`bg-white rounded-2xl shadow-2xl w-full ${confirmModal.debugXml ? 'max-w-lg' : confirmModal.isPaymentAlert ? 'max-w-md border-2 border-red-500' : 'max-w-sm'} overflow-hidden`}>
            {confirmModal.isPaymentAlert && (
              <div className="bg-red-600 text-white px-6 py-4 flex items-center justify-between gap-3">
                <div className="flex items-center gap-2.5">
                  <span className="relative flex h-3 w-3 shrink-0">
                    <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-white opacity-80" />
                    <span className="relative inline-flex rounded-full h-3 w-3 bg-white" />
                  </span>
                  <h3 className="text-base sm:text-lg font-black uppercase tracking-tight">{confirmModal.title}</h3>
                </div>
              </div>
            )}

            <div className="p-6">
              {!confirmModal.isPaymentAlert && (
                <h3 className="text-xl font-bold text-stone-800 mb-2">{confirmModal.title}</h3>
              )}

              {confirmModal.isPaymentAlert && confirmModal.highlightAmount && (
                <div className="mb-4 px-4 py-3 rounded-xl bg-red-50 border-2 border-red-300 text-center">
                  <span className="block text-[11px] font-black uppercase tracking-wider text-red-700">
                    Valor a Receber na Retirada
                  </span>
                  <span className="block text-2xl sm:text-3xl font-black font-mono text-red-700 mt-0.5">
                    {confirmModal.highlightAmount}
                  </span>
                </div>
              )}

              <p className={`mb-6 whitespace-pre-wrap ${confirmModal.isPaymentAlert ? 'text-stone-800 font-semibold text-sm leading-relaxed' : 'text-stone-600'}`}>
                {confirmModal.message}
              </p>
              
              {confirmModal.debugXml && (
                <div className="mb-6">
                  <label className="block text-[10px] font-bold text-stone-400 uppercase mb-1">Resposta XML (Debug)</label>
                  <textarea 
                    readOnly 
                    value={confirmModal.debugXml} 
                    className="w-full h-32 p-2 bg-stone-50 border rounded text-[10px] font-mono outline-none"
                  />
                  <p className="text-[10px] text-stone-400 mt-1">Copie este conteúdo e envie para o suporte se o problema persistir.</p>
                </div>
              )}

              <div className="flex justify-end gap-3 flex-wrap">
                {confirmModal.cancelText !== null && (
                  <button type="button" onClick={() => setConfirmModal(null)} className="px-4 py-2.5 text-stone-600 hover:bg-stone-100 rounded-lg font-bold text-sm cursor-pointer">
                    {confirmModal.cancelText || 'Cancelar'}
                  </button>
                )}
                <button 
                  type="button" 
                  onClick={async (e) => {
                    e.preventDefault();
                    e.stopPropagation();
                    const fn = confirmModal?.onConfirm;
                    setConfirmModal(null); // Ensure it closes immediately on click
                    if (fn) {
                      await fn();
                    }
                  }} 
                  className={`px-4 py-2.5 text-white rounded-lg font-bold text-sm cursor-pointer shadow-sm active:scale-95 transition-all ${
                    confirmModal.isPaymentAlert
                      ? 'bg-emerald-600 hover:bg-emerald-700'
                      : 'bg-orange-600 hover:bg-orange-700'
                  }`}
                >
                  {confirmModal.confirmText || 'OK'}
                </button>
              </div>
            </div>
          </div>
        </div>
      )}

      {isModalOpen && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4">
          <div className="bg-white rounded-2xl shadow-xl w-full max-w-md overflow-hidden">
            <div className="flex justify-between items-center p-4 border-b">
              <h3 className="text-lg font-bold text-stone-800">
                {editingItem ? 'Editar' : 'Nova'} {modalType === 'category' ? 'Categoria' : modalType === 'product' ? 'Produto' : 'Usuário'}
              </h3>
              <button type="button" onClick={closeModal} className="p-2 hover:bg-stone-100 rounded-full">
                <X className="w-5 h-5" />
              </button>
            </div>
            
            {modalType === 'category' && (
              <form onSubmit={handleSaveCategory} className="p-6 space-y-4">
                <div>
                  <label className="block text-sm font-medium text-stone-700 mb-1">Nome da Categoria</label>
                  <input type="text" name="name" defaultValue={editingItem?.name} required className="w-full p-2 border rounded-lg focus:ring-2 focus:ring-orange-500 outline-none" />
                </div>
                <div>
                  <label className="block text-sm font-medium text-stone-700 mb-1">Ordem de Exibição</label>
                  <input type="number" name="order" defaultValue={editingItem?.order || categories.length + 1} required className="w-full p-2 border rounded-lg focus:ring-2 focus:ring-orange-500 outline-none" />
                </div>
                <div>
                  <label className="block text-sm font-bold text-stone-700 mb-1">Modalidade dos Produtos nesta Categoria</label>
                  <select
                    name="modality"
                    defaultValue={editingItem ? (isCategoryFrozenModality(editingItem) ? 'congelado' : 'pronto') : 'pronto'}
                    className="w-full p-2.5 border border-stone-300 rounded-lg focus:ring-2 focus:ring-orange-500 outline-none font-bold text-sm bg-stone-50"
                  >
                    <option value="pronto">🔥 Salgados / Produtos Prontos (Normais - Consumo Imediato)</option>
                    <option value="congelado">❄️ Salgados Congelados (+R$ 0,30 un • Prazo até 48h)</option>
                  </select>
                  <p className="text-[11px] text-stone-500 mt-1">
                    Define se ao clicar em um produto dentro desta categoria o cliente verá as variações de <strong>Prontos</strong> ou de <strong>Congelados</strong>.
                  </p>
                </div>

                <div>
                  <label className="block text-sm font-bold text-stone-700 mb-1">Modo de Venda (Preço e Quantidade)</label>
                  <select
                    name="saleMode"
                    value={categorySaleMode}
                    onChange={(e) => setCategorySaleMode(e.target.value as 'pack' | 'unit')}
                    className="w-full p-2.5 border border-stone-300 rounded-lg focus:ring-2 focus:ring-orange-500 outline-none font-bold text-sm bg-stone-50"
                  >
                    <option value="pack">🔢 Por Quantidade / Lote (Mínimo / Pacote - Ex: 20 ou 25 un)</option>
                    <option value="unit">📦 Unitário (1 por 1 - Usuário define quantidade livre)</option>
                  </select>
                  <p className="text-[11px] text-stone-500 mt-1">
                    Escolha se os produtos desta categoria serão vendidos por quantidade/lote ou de forma unitária (1 por 1).
                  </p>
                </div>

                {categorySaleMode === 'pack' && (
                  <div className="bg-orange-50/60 border border-orange-200 rounded-xl p-3.5 space-y-1.5 animate-fadeIn">
                    <label className="block text-sm font-extrabold text-orange-950 mb-1">
                      📦 Digite a Quantidade por Lote / Pacote
                    </label>
                    <input
                      type="number"
                      name="defaultPackSize"
                      min={1}
                      defaultValue={editingItem?.defaultPackSize || 25}
                      className="w-full p-2.5 border border-orange-300 rounded-lg focus:ring-2 focus:ring-orange-500 outline-none font-bold text-sm bg-white"
                    />
                    <p className="text-[11px] text-orange-800">
                      Ex: 25 unidades. Ao escolher venda por lote, o sistema usará esta quantidade como base e multiplicador automático para o cliente.
                    </p>
                  </div>
                )}
                
                <div className="pt-2 border-t border-stone-100">
                  <label className="flex items-center gap-2 cursor-pointer p-2.5 rounded-lg bg-emerald-50/70 border border-emerald-200 mb-3">
                    <input
                      type="checkbox"
                      name="isVisible"
                      defaultChecked={editingItem ? editingItem.isVisible !== false : true}
                      className="w-4 h-4 text-emerald-600 rounded focus:ring-emerald-500"
                    />
                    <span className="text-sm font-extrabold text-emerald-950">👁️ Exibir Categoria na Tela de Vendas (Visível)</span>
                  </label>
                  <label className="block text-xs font-bold text-stone-500 uppercase tracking-wider mb-2">Canais de Venda Disponíveis</label>
                  <div className="space-y-2 text-sm text-stone-700">
                    <label className="flex items-center gap-2 cursor-pointer">
                      <input 
                        type="checkbox" 
                        name="availableInStore" 
                        defaultChecked={editingItem ? editingItem.availableInStore !== false : true} 
                        className="w-4 h-4 text-amber-600 rounded focus:ring-amber-500"
                      />
                      <span>🍽️ Loja (Mesa / Presencial)</span>
                    </label>
                    <label className="flex items-center gap-2 cursor-pointer">
                      <input 
                        type="checkbox" 
                        name="availableForKiosk" 
                        defaultChecked={editingItem ? editingItem.availableForKiosk !== false : true} 
                        className="w-4 h-4 text-blue-600 rounded focus:ring-blue-500"
                      />
                      <span>📱 Autoatendimento (Totem / Quiosque)</span>
                    </label>
                  </div>
                </div>
                <div className="pt-4 flex justify-end gap-2">
                  <button type="button" onClick={closeModal} disabled={isSaving} className="px-4 py-2 text-stone-600 hover:bg-stone-100 rounded-lg font-medium disabled:opacity-50">Cancelar</button>
                  <button type="submit" disabled={isSaving} className="px-4 py-2 bg-orange-600 text-white rounded-lg font-medium hover:bg-orange-700 flex items-center gap-2 disabled:opacity-50">
                    {isSaving ? (
                      <>
                        <Clock className="w-4 h-4 animate-spin" /> Salvando...
                      </>
                    ) : 'Salvar'}
                  </button>
                </div>
              </form>
            )}

            {modalType === 'user' && (
              <form onSubmit={handleSaveUser} className="p-6 space-y-4">
                <div className="bg-amber-50 border border-amber-200 rounded-xl p-3 text-xs text-amber-800">
                  <p className="font-bold">⚡ Ativação Imediata sem Validação de Email</p>
                  <p className="mt-0.5 text-stone-600">O usuário poderá acessar o painel imediatamente após o cadastro com o email e a senha definidos aqui.</p>
                </div>
                <div>
                  <label className="block text-sm font-medium text-stone-700 mb-1">Nome</label>
                  <input type="text" name="name" defaultValue={editingItem?.name} required className="w-full p-2 border rounded-lg focus:ring-2 focus:ring-orange-500 outline-none" placeholder="Ex: Operador Caixa" />
                </div>
                <div>
                  <label className="block text-sm font-medium text-stone-700 mb-1">Email / Usuário</label>
                  <input type="email" name="email" defaultValue={editingItem?.email} required className="w-full p-2 border rounded-lg focus:ring-2 focus:ring-orange-500 outline-none" placeholder="usuario@balbec.com.br" />
                </div>
                <div>
                  <label className="block text-sm font-medium text-stone-700 mb-1">
                    {editingItem ? 'Nova Senha (opcional)' : 'Senha de Acesso'}
                  </label>
                  <input 
                    type="password" 
                    name="password" 
                    required={!editingItem} 
                    minLength={3} 
                    className="w-full p-2 border rounded-lg focus:ring-2 focus:ring-orange-500 outline-none" 
                    placeholder={editingItem ? 'Deixe em branco para manter a atual' : 'Digite a senha'}
                  />
                  <p className="text-xs text-stone-500 mt-1">
                    {editingItem ? 'Deixe em branco para manter a senha atual.' : 'Senha direta para login no sistema.'}
                  </p>
                </div>
                <div>
                  <label className="block text-sm font-medium text-stone-700 mb-1">Cargo</label>
                  <select name="role" defaultValue={editingItem?.role || 'padrao'} required className="w-full p-2 border rounded-lg focus:ring-2 focus:ring-orange-500 outline-none">
                    <option value="master">Master (Acesso Completo a Todas as Funcionalidades e Configurações)</option>
                    <option value="admin">Administrador (Pedidos, Clientes, Mesas, Catálogo e TV)</option>
                    <option value="padrao">Padrão (Dashboard, Produtos, Categorias, Sabores e TV)</option>
                  </select>
                </div>
                <div className="pt-4 flex justify-end gap-2">
                  <button type="button" onClick={closeModal} disabled={isSaving} className="px-4 py-2 text-stone-600 hover:bg-stone-100 rounded-lg font-medium disabled:opacity-50">Cancelar</button>
                  <button type="submit" disabled={isSaving} className="px-4 py-2 bg-orange-600 text-white rounded-lg font-medium hover:bg-orange-700 flex items-center gap-2 disabled:opacity-50">
                    {isSaving ? (
                      <>
                        <Clock className="w-4 h-4 animate-spin" /> Salvando...
                      </>
                    ) : 'Salvar'}
                  </button>
                </div>
              </form>
            )}

            {modalType === 'product' && (
              <form onSubmit={handleSaveProduct} className="p-6 space-y-4 max-h-[80vh] overflow-y-auto custom-scrollbar">
                <div className="p-3 bg-amber-50/70 border border-amber-200 rounded-xl space-y-2">
                  <label className="block text-xs font-extrabold text-amber-950 uppercase tracking-wide">
                    🔥 Categoria para Modalidade PRONTOS (Normais)
                  </label>
                  <select 
                    name="categoryId" 
                    value={selectedCategoryId || 'none'} 
                    onChange={(e) => setSelectedCategoryId(e.target.value)}
                    className="w-full p-2 bg-white border border-amber-300 rounded-lg focus:ring-2 focus:ring-orange-500 outline-none font-bold text-sm"
                  >
                    <option value="none">-- Não exibir em categorias de Prontos --</option>
                    {categories
                      .filter(c => !isExcludedCategory(c.name))
                      .sort((a, b) => (a.name || '').localeCompare(b.name || '', 'pt-BR', { sensitivity: 'base' }))
                      .map(c => <option key={c.id} value={c.id}>{c.name} {!c.externalId ? '✏️ (Manual)' : ''}</option>)}
                  </select>
                </div>

                <div className="p-3 bg-cyan-50/70 border border-cyan-200 rounded-xl space-y-2.5">
                  <label className="block text-xs font-extrabold text-cyan-950 uppercase tracking-wide">
                    ❄️ Categoria para Modalidade CONGELADOS (+R$ 0,30 • Até 48h)
                  </label>
                  <select 
                    name="frozenCategoryId" 
                    value={selectedFrozenCategoryId || 'none'} 
                    onChange={(e) => {
                      const val = e.target.value === 'none' ? '' : e.target.value;
                      setSelectedFrozenCategoryId(val);
                      if (val) {
                        setTimeout(() => {
                          const el = document.getElementById('minFrozenQuantity') as HTMLInputElement | null;
                          el?.focus();
                          el?.select();
                        }, 60);
                      }
                    }}
                    className="w-full p-2 bg-white border border-cyan-300 rounded-lg focus:ring-2 focus:ring-cyan-500 outline-none font-bold text-sm"
                  >
                    <option value="none">-- Não vincular a categoria de Congelados --</option>
                    {categories
                      .filter(c => !isExcludedCategory(c.name))
                      .sort((a, b) => (a.name || '').localeCompare(b.name || '', 'pt-BR', { sensitivity: 'base' }))
                      .map(c => <option key={c.id} value={c.id}>{c.name} {!c.externalId ? '✏️ (Manual)' : ''}</option>)}
                  </select>

                  <div className="p-2.5 bg-white/90 border border-cyan-300 rounded-lg space-y-1">
                    <label htmlFor="minFrozenQuantity" className="block text-xs font-extrabold uppercase tracking-wider text-cyan-950">
                      ❄️ Quantidade Mínima deste Produto Congelado (unidades)
                    </label>
                    <input
                      type="number"
                      name="minFrozenQuantity"
                      id="minFrozenQuantity"
                      defaultValue={editingItem?.minFrozenQuantity || 1}
                      min="1"
                      className="w-full p-2 border border-cyan-300 rounded-lg focus:ring-2 focus:ring-cyan-500 outline-none text-cyan-950 font-black bg-white"
                      placeholder="Ex: 10, 20, 50..."
                    />
                    <p className="text-[11px] text-cyan-800">
                      Na tela de vendas (modalidade Congelado), o pedido deste produto iniciará e exigirá no mínimo esta quantidade.
                    </p>
                  </div>

                  <p className="text-[11px] text-cyan-800 leading-snug">
                    Vincule o mesmo produto a uma categoria de Prontos e a uma categoria de Congelados para que ele apareça nas duas categorias com suas respectivas variações.
                  </p>
                </div>
                <div>
                  <label className="block text-sm font-medium text-stone-700 mb-1">Nome do Produto</label>
                  <input type="text" name="name" defaultValue={editingItem?.name} required className="w-full p-2 border rounded-lg focus:ring-2 focus:ring-orange-500 outline-none" />
                </div>
                <div>
                  <label className="block text-sm font-medium text-stone-700 mb-1">Ordem de Exibição</label>
                  <input type="number" name="order" defaultValue={editingItem?.order || 0} className="w-full p-2 border rounded-lg focus:ring-2 focus:ring-orange-500 outline-none" />
                </div>
                <div>
                  <label className="block text-sm font-medium text-stone-700 mb-1">Código do Produto (Cód / EAN / Referência)</label>
                  <input 
                    type="text" 
                    name="externalId" 
                    defaultValue={editingItem?.externalId || ''} 
                    placeholder="Ex: 1001 ou 7891234567890" 
                    className="w-full p-2 border rounded-lg focus:ring-2 focus:ring-orange-500 outline-none font-mono text-sm" 
                  />
                  <p className="text-[11px] text-stone-500 mt-1">Este código aparece na descrição dos itens no cardápio e no cupom impresso.</p>
                </div>
                <div>
                  <label className="block text-sm font-medium text-stone-700 mb-1">Descrição</label>
                  <textarea name="description" defaultValue={cleanProductDescription(editingItem?.description, true)} rows={2} className="w-full p-2 border rounded-lg focus:ring-2 focus:ring-orange-500 outline-none" />
                </div>
                {!isFlavorInModal && (
                  <div>
                    <label className="block text-sm font-medium text-stone-700 mb-1">Preço (R$)</label>
                    <input 
                      type="number" 
                      step="0.01" 
                      name="price" 
                      defaultValue={editingItem?.price || 0} 
                      required={!isFlavorInModal}
                      className="w-full p-2 border rounded-lg focus:ring-2 focus:ring-orange-500 outline-none" 
                    />
                  </div>
                )}
                <div>
                  <label className="block text-sm font-medium text-stone-700 mb-1">Imagem do Produto</label>
                  <div className="flex items-center gap-4">
                    {productImagePreview && (
                      <img src={productImagePreview} alt="Preview" className="w-16 h-16 rounded-lg object-cover border" />
                    )}
                    <input type="file" accept="image/*" onChange={(e) => handleImageUpload(e, setProductImagePreview)} className="w-full p-2 border rounded-lg focus:ring-2 focus:ring-orange-500 outline-none" required={!productImagePreview} />
                  </div>
                </div>
                <div>
                  <label className="block text-sm font-medium text-stone-700 mb-1">Opcionais Disponíveis</label>
                  <div className="space-y-4 max-h-60 overflow-y-auto p-3 border rounded-lg bg-stone-50">
                    {categories.map(cat => {
                      const catAddons = products.filter(p => p.isAddon && p.categoryId === cat.id && p.isActive);
                      if (catAddons.length === 0) return null;
                      return (
                        <div key={cat.id}>
                          <h4 className="text-[10px] font-bold text-stone-500 uppercase mb-2 border-b pb-1">{cat.name}</h4>
                          <div className="grid grid-cols-2 gap-2">
                            {catAddons.map(addon => (
                              <label key={addon.id} className="flex items-center gap-2 text-sm cursor-pointer hover:text-orange-600">
                                <input 
                                  type="checkbox" 
                                  name="addonIds" 
                                  value={addon.id} 
                                  defaultChecked={editingItem?.addonIds?.includes(addon.id)}
                                  className="rounded text-orange-600 focus:ring-orange-500"
                                />
                                {addon.name}
                              </label>
                            ))}
                          </div>
                        </div>
                      );
                    })}
                    {products.filter(p => p.isAddon && p.isActive).length === 0 && (
                      <span className="text-sm text-stone-500">Nenhum opcional cadastrado.</span>
                    )}
                  </div>
                  <p className="text-[10px] text-stone-400 mt-1 uppercase">Selecione os opcionais que podem ser adicionados a este produto.</p>
                </div>
                <div>
                  <label className="block text-sm font-medium text-stone-700 mb-1">Sabores Disponíveis</label>
                  <div className="grid grid-cols-2 gap-2 max-h-40 overflow-y-auto p-2 border rounded-lg bg-stone-50">
                    {products.filter(p => p.isFlavor).map(flavor => (
                      <label key={flavor.id} className="flex items-center gap-2 text-sm cursor-pointer hover:text-orange-600">
                        <input 
                          type="checkbox" 
                          name="flavorIds" 
                          value={flavor.id} 
                          defaultChecked={editingItem?.flavorIds?.includes(flavor.id)}
                          className="rounded text-orange-600 focus:ring-orange-500"
                        />
                        {flavor.name}
                      </label>
                    ))}
                    {products.filter(p => p.isFlavor).length === 0 && (
                      <span className="text-sm text-stone-500 col-span-2">Nenhum sabor cadastrado.</span>
                    )}
                  </div>
                  <p className="text-[10px] text-stone-400 mt-1 uppercase">Selecione os sabores que este produto pode ter.</p>
                </div>
                <div>
                  <label className="block text-sm font-medium text-stone-700 mb-1">Máximo de Opcionais Permitidos</label>
                  <input type="number" name="maxAddons" defaultValue={editingItem?.maxAddons || 2} min="1" className="w-full p-2 border rounded-lg focus:ring-2 focus:ring-orange-500 outline-none" />
                </div>
                <div className="flex items-center gap-2">
                  <input type="checkbox" name="isActive" id="isActive" defaultChecked={editingItem ? editingItem.isActive : true} className="w-4 h-4 text-orange-600 focus:ring-orange-500 rounded" />
                  <label htmlFor="isActive" className="text-sm font-medium text-stone-700">Produto Ativo (Visível no cardápio)</label>
                </div>
                <div className="flex items-center gap-2">
                  <input type="checkbox" name="allowFrozen" id="allowFrozen" defaultChecked={editingItem ? editingItem.allowFrozen !== false : true} className="w-4 h-4 text-orange-600 focus:ring-orange-500 rounded" />
                  <label htmlFor="allowFrozen" className="text-sm font-medium text-stone-700">Permitir opção de Salgado Congelado (+R$ 0,30 / un)</label>
                </div>

                {/* Sales Channels / Exibição por Local */}
                <div className="p-3 bg-orange-50/60 border border-orange-200/80 rounded-xl space-y-2">
                  <label className="block text-xs font-bold uppercase tracking-wider text-stone-700">Disponibilidade por Canal de Venda</label>
                  <div className="flex flex-col sm:flex-row sm:items-center flex-wrap gap-3 pt-1">
                    <label className="flex items-center gap-2 text-xs font-bold text-stone-800 cursor-pointer">
                      <input
                        type="checkbox"
                        name="availableInStore"
                        id="availableInStore"
                        defaultChecked={editingItem ? editingItem.availableInStore !== false : true}
                        className="w-4 h-4 text-orange-600 focus:ring-orange-500 rounded"
                      />
                      <span>🍽️ Mesas / Retirada</span>
                    </label>
                    <label className="flex items-center gap-2 text-xs font-bold text-stone-800 cursor-pointer">
                      <input
                        type="checkbox"
                        name="availableForKiosk"
                        id="availableForKiosk"
                        defaultChecked={editingItem ? editingItem.availableForKiosk !== false : true}
                        className="w-4 h-4 text-orange-600 focus:ring-orange-500 rounded"
                      />
                      <span>📱 Autoatendimento (Tablet/Totem)</span>
                    </label>
                  </div>
                  <p className="text-[10px] text-stone-500 italic">
                    Escolha onde este produto será exibido para os clientes.
                  </p>
                </div>
                <div className="flex items-center gap-2">
                  <input 
                    type="checkbox" 
                    name="isAddon" 
                    id="isAddon" 
                    defaultChecked={editingItem ? editingItem.isAddon : false} 
                    onChange={(e) => {
                      if (e.target.checked) {
                        const isFlavorCheckbox = document.getElementById('isFlavor') as HTMLInputElement;
                        if (isFlavorCheckbox) isFlavorCheckbox.checked = false;
                        setIsFlavorInModal(false);
                      }
                    }}
                    className="w-4 h-4 text-orange-600 focus:ring-orange-500 rounded" 
                  />
                  <label htmlFor="isAddon" className="text-sm font-medium text-stone-700">É um opcional?</label>
                </div>
                <div className="flex items-center gap-2">
                  <input 
                    type="checkbox" 
                    name="isFlavor" 
                    id="isFlavor" 
                    defaultChecked={editingItem ? editingItem.isFlavor : false} 
                    onChange={(e) => {
                      setIsFlavorInModal(e.target.checked);
                      if (e.target.checked) {
                        const isAddonCheckbox = document.getElementById('isAddon') as HTMLInputElement;
                        if (isAddonCheckbox) isAddonCheckbox.checked = false;
                        const priceInput = document.getElementsByName('price')[0] as HTMLInputElement;
                        if (priceInput) priceInput.value = '0';
                      }
                    }}
                    className="w-4 h-4 text-orange-600 focus:ring-orange-500 rounded" 
                  />
                  <label htmlFor="isFlavor" className="text-sm font-medium text-stone-700">É um sabor?</label>
                </div>
                <div className="pt-4 flex justify-end gap-2">
                  <button type="button" onClick={closeModal} disabled={isSaving} className="px-4 py-2 text-stone-600 hover:bg-stone-100 rounded-lg font-medium disabled:opacity-50">Cancelar</button>
                  <button type="submit" disabled={isSaving} className="px-4 py-2 bg-orange-600 text-white rounded-lg font-medium hover:bg-orange-700 flex items-center gap-2 disabled:opacity-50">
                    {isSaving ? (
                      <>
                        <Clock className="w-4 h-4 animate-spin" /> Salvando...
                      </>
                    ) : 'Salvar'}
                  </button>
                </div>
              </form>
            )}
          </div>
        </div>
      )}
      {selectedOrderForReceipt && (
        <ReceiptModal
          order={selectedOrderForReceipt}
          storeInfo={storeInfo}
          onPrinted={(orderId) => markOrderPrinted(orderId).catch(() => {})}
          onClose={() => setSelectedOrderForReceipt(null)}
        />
      )}
      <TotemBackupModal
        isOpen={isTotemBackupModalOpen}
        onClose={() => setIsTotemBackupModalOpen(false)}
        backups={totemBackups}
        onRefreshBackups={fetchTotemBackups}
        onCreateBackup={handleCreateTotemBackup}
        onRestoreBackup={handleRestoreTotemBackup}
        onDownloadBackup={handleDownloadTotemBackup}
        onUploadBackupFile={handleUploadTotemBackupFile}
        onDeleteBackup={handleDeleteTotemBackup}
        onDownloadFullBackup={handleDownloadFullSystemBackup}
        onUploadFullBackupFile={handleUploadFullSystemBackupFile}
        isCreating={isCreatingBackup}
        isRestoring={isRestoringBackup}
        activeCategoriesCount={categories.filter(c => !isExcludedCategory(c.name) && c.availableForKiosk !== false).length}
        activeProductsCount={products.filter(p => p.isActive && p.availableForKiosk !== false).length}
        ordersCount={orders.length}
        customersCount={customers.length}
        tablesCount={tables.length}
      />
    </div>
  );
}
