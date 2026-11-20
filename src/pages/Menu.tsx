import { useState, useEffect, useRef, useMemo, useCallback } from 'react';
import { useStore, OrderItem, Order, CustomerAddress, Product, Category } from '../store/useStore';
import { formatCurrency, formatCapitalized, expandAbbreviations, formatDateBR, formatAllDatesBR } from '../lib/utils';
import { ShoppingCart, ShoppingBag, Plus, Minus, Trash2, Pencil, ArrowLeft, ArrowRight, CheckCircle2, ChevronLeft, ChevronRight, Settings, Droplets, Search, X, Printer, User as UserIcon, RefreshCw, Store, Tv, BellRing, Clock, MapPin, KeyRound, ShieldAlert, ShieldCheck, LocateFixed, AlertTriangle, UtensilsCrossed, QrCode, Scissors, UserCheck, CreditCard, Copy, Lock, UserPlus, LogIn, Sparkles, Monitor, Calendar, PackageCheck, Eye, EyeOff, Share2, MessageCircle } from 'lucide-react';
import { getCurrentPosition, calculateDistanceMeters, formatDistance } from '../utils/geolocation';
import { ProductImage } from '../components/ProductImage';
import { Link } from 'react-router-dom';
import { BakeryLoader } from '../components/BakeryLoader';
import { MaintenancePage } from '../components/MaintenancePage';
import { shouldExcludeProduct, isExcludedCategory, isAddonCategory, isAddonItem, EXCLUDED_CATEGORIES, normalizeText, cleanProductDescription, formatProductDescriptionWithCode, isSalgadoProduct, isCategoryFrozenModality } from '../constants';
import { getSmartProductImage } from '../utils/imageHelper';
import { printReceipt, printViaNetworkIp, getNetworkPrinterConfig, resolveItemCode, resolveAddonCode } from '../utils/printer';
import { getOrderPaymentBreakdown, requiresOperatorPaymentConfirmation, sharePixReceipt, buildPixReceiptShareText } from '../utils/paymentStatusHelper';
import { sendNtfyNotification } from '../utils/ntfy';
import { safeStorage } from '../utils/storage';
import { AiAssistantFloatingButton } from '../components/AiAssistantFloatingButton';
import { getStoreCurrentStatus, parseWeeklySchedule, formatWeeklyScheduleSummary, calculatePickupTime, parseSlotCapacities, getScheduleSlotsForDay, isSlotAllowedForDate, getBrazilNowDate, getMinFrozenScheduleDateKey, isDateAllowedForFrozenOrder, getAvailableScheduleDays } from '../utils/scheduleHelper';
import { CustomerOrderTrackerModal } from '../components/CustomerOrderTrackerModal';
import { BestSellersCarousel, BestSellerEntry } from '../components/BestSellersCarousel';

// Detecção de bandeiras de cartões de crédito e débito
function detectCardBrand(num: string): string {
  const clean = (num || '').replace(/\D/g, '');
  if (/^4/.test(clean)) return 'Visa';
  if (/^(5[1-5]|222[1-9]|22[3-9]|2[3-6]|27[0-1]|2720)/.test(clean)) return 'Mastercard';
  if (/^(4011|438935|451416|4576|504175|5067|5090|627780|636297|636368|650031)/.test(clean)) return 'Elo';
  if (/^(34|37)/.test(clean)) return 'American Express';
  if (/^(606282|3841)/.test(clean)) return 'Hipercard';
  return clean.length > 0 ? 'Cartão' : 'Detectando...';
}

export default function Menu() {
  const { categories, products, tables, orders, customers, storeInfo, placeOrder, saveCustomer, isInitialized, fetchData, fetchOrdersOnly, appendItemsToOrder } = useStore();
  const [activeCategory, setActiveCategory] = useState<string>('');
  const [searchTerm, setSearchTerm] = useState('');
  const [isRefreshing, setIsRefreshing] = useState(false);
  const [productQuantities, setProductQuantities] = useState<Record<string, number | string>>({});
  type PrepChoiceType = 'congelado_cru' | 'congelado_frito' | 'congelado_pre_assado' | 'congelado_assado_pronto' | 'pronto_pre_assado' | 'pronto_assado_pronto' | 'pronto_cru' | 'pronto_frito';
  const [frozenPrepChoices, setFrozenPrepChoices] = useState<Record<string, PrepChoiceType>>({});
  const [frozenPrepErrors, setFrozenPrepErrors] = useState<Record<string, boolean>>({});
  const [cartItemInputMap, setCartItemInputMap] = useState<Record<string, string>>({});
  const [cartToastMessage, setCartToastMessage] = useState<string | null>(null);

  useEffect(() => {
    if (!cartToastMessage) return;
    const timer = setTimeout(() => {
      setCartToastMessage(null);
    }, 4000);
    return () => clearTimeout(timer);
  }, [cartToastMessage]);

  const getPrepChoiceLabel = (prepType?: string): string => {
    switch (prepType) {
      case 'congelado_cru': return 'CRU CONGELADO';
      case 'congelado_frito': return 'FRITO CONGELADO';
      case 'congelado_pre_assado':
      case 'pronto_pre_assado':
        return 'PRÉ-ASSADO';
      case 'congelado_assado_pronto':
      case 'pronto_assado_pronto':
        return 'ASSADO PRONTO';
      case 'pronto_cru': return 'CRU';
      case 'pronto_frito': return 'FRITO';
      default:
        return '';
    }
  };

  // Estados para Modo Acréscimo no Pedido (Status 'pending' e Pagamento na Retirada)
  const [appendOrderTarget, setAppendOrderTarget] = useState<Order | null>(null);
  const [appendCart, setAppendCart] = useState<OrderItem[]>([]);
  const [isAppendReviewModalOpen, setIsAppendReviewModalOpen] = useState(false);
  const [isSubmittingAppend, setIsSubmittingAppend] = useState(false);
  const [appendErrorMessage, setAppendErrorMessage] = useState<string | null>(null);

  // Modal para avisar sobre incompatibilidade de modalidade (congelados vs normais/prontos)
  const [modalidadeConflictModal, setModalidadeConflictModal] = useState<{
    isOpen: boolean;
    productName?: string;
    targetOrderIsFrozen: boolean;
    attemptedIsFrozen: boolean;
  }>({
    isOpen: false,
    targetOrderIsFrozen: false,
    attemptedIsFrozen: false
  });

  useEffect(() => {
    fetchData();
    // Polling em background a cada 5s para smartphones capturarem categorias/produtos novos criados no PC imediatamente
    const interval = setInterval(() => {
      if (document.visibilityState === 'visible' && navigator.onLine) {
        fetchData().catch(() => {});
      }
    }, 5000);
    return () => clearInterval(interval);
  }, []);

  // Controle de Mesas / Consumo na Loja
  const [selectedTableNumber, setSelectedTableNumber] = useState<number | null>(() => {
    try {
      const params = new URLSearchParams(window.location.search);
      const urlTable = params.get('mesa') || params.get('table') || params.get('mesa_num');
      if (urlTable && !isNaN(parseInt(urlTable, 10))) {
        return parseInt(urlTable, 10);
      }
      const saved = safeStorage.getSession('balbec_selected_table');
      if (saved && !isNaN(parseInt(saved, 10))) {
        return parseInt(saved, 10);
      }
    } catch {}
    return null;
  });
  const [showTableSelectModal, setShowTableSelectModal] = useState(false);

  const handleManualSync = async () => {
    if (isRefreshing) return;
    setIsRefreshing(true);
    try {
      await fetchData();
    } catch (e) {
      console.error('Error refreshing data:', e);
    } finally {
      setIsRefreshing(false);
    }
  };
  const [customerName, setCustomerName] = useState('');
  const [customerPhone, setCustomerPhone] = useState('');
  // Etapa de acesso ao cardápio digital (Nome/WhatsApp -> Consulta de CEP da rota de entrega)
  const [deliveryAccessStep, setDeliveryAccessStep] = useState<'info' | 'cep'>('info');
  const [isCheckingDeliveryCep, setIsCheckingDeliveryCep] = useState<boolean>(false);
  const isTotemPath = typeof window !== 'undefined' && (
    window.location.pathname.toLowerCase().startsWith('/totem') || 
    window.location.pathname.toLowerCase().startsWith('/kiosk') ||
    window.location.search.toLowerCase().includes('totem') ||
    window.location.search.toLowerCase().includes('kiosk') ||
    window.location.search.toLowerCase().includes('autoatendimento')
  );

  const [hasName, setHasName] = useState<boolean>(() => {
    try {
      const pathname = window.location.pathname.toLowerCase();
      if (pathname.startsWith('/totem') || pathname.startsWith('/kiosk')) return true;
      const params = new URLSearchParams(window.location.search);
      const mode = params.get('mode') || params.get('channel') || params.get('tipo');
      if (mode === 'kiosk' || mode === 'totem' || mode === 'autoatendimento') return true;
      
      const saved = safeStorage.getItem('balbec_logged_customer');
      const savedLead = safeStorage.getItem('balbec_customer_name');
      return !!saved || !!savedLead;
    } catch {}
    return false;
  });
  const [salesChannel, setSalesChannel] = useState<'delivery' | 'instore' | 'kiosk'>(() => {
    try {
      const pathname = window.location.pathname.toLowerCase();
      if (pathname.startsWith('/totem') || pathname.startsWith('/kiosk')) return 'kiosk';
      const params = new URLSearchParams(window.location.search);
      const mode = params.get('mode') || params.get('channel') || params.get('tipo');
      if (mode === 'kiosk' || mode === 'totem' || mode === 'autoatendimento') return 'kiosk';
      if (mode === 'instore' || mode === 'loja' || mode === 'presencial') return 'instore';
    } catch {}
    return 'instore';
  });
  const [initialEntryChoice, setInitialEntryChoice] = useState<'view' | 'delivery' | null>('view');
  const [lastPlacedOrder, setLastPlacedOrder] = useState<Order | null>(null);
  const [isSuccess, setIsSuccess] = useState(false);
  const [checkoutStep, setCheckoutStep] = useState<number>(1);
  const [isCheckout, setIsCheckout] = useState(false);
  const [successCountdown, setSuccessCountdown] = useState(0);

  const [paymentMode, setPaymentMode] = useState<'online' | 'delivery' | null>(null);
  const [paymentMethod, setPaymentMethod] = useState('');
  const [frozenPaymentPlan, setFrozenPaymentPlan] = useState<'integral' | 'parcial' | null>(null);
  const [deliveryType, setDeliveryType] = useState<'pickup' | 'delivery'>('pickup');
  const [deliveryAddress, setDeliveryAddress] = useState('');
  const [selectedScheduleTime, setSelectedScheduleTime] = useState<string>(() => safeStorage.getItem('balbec_selected_schedule_time') || '');
  const [selectedScheduleDate, setSelectedScheduleDate] = useState<string>(() => safeStorage.getItem('balbec_selected_schedule_date') || '');
  const [selectedScheduleDay, setSelectedScheduleDay] = useState<string>(() => safeStorage.getItem('balbec_selected_schedule_day') || '');
  const [showScheduleSelectionStep, setShowScheduleSelectionStep] = useState<boolean>(false);
  const [scheduleStepMode, setScheduleStepMode] = useState<'delivery' | 'pickup'>('pickup');
  const [orderModalityPreference, setOrderModalityPreference] = useState<'frozen' | 'normal' | null>(() => {
    const saved = safeStorage.getSession('balbec_order_modality_preference');
    return saved === 'frozen' || saved === 'normal' ? saved : null;
  });
  const [showOrderTypeChoiceModal, setShowOrderTypeChoiceModal] = useState<boolean>(false);
  const [queuedImpulseProducts, setQueuedImpulseProducts] = useState<Product[]>(() => {
    try {
      const saved = safeStorage.getSession('balbec_queued_impulse_products');
      if (saved) {
        const parsed = JSON.parse(saved);
        if (Array.isArray(parsed)) return parsed;
      }
    } catch {}
    return [];
  });
  const updateQueuedImpulseProducts = useCallback((updater: Product[] | ((prev: Product[]) => Product[])) => {
    setQueuedImpulseProducts(prev => {
      const next = typeof updater === 'function' ? updater(prev) : updater;
      if (next.length > 0) {
        safeStorage.setSession('balbec_queued_impulse_products', JSON.stringify(next));
      } else {
        safeStorage.removeSession('balbec_queued_impulse_products');
      }
      return next;
    });
  }, []);
  const [impulseFrozenModal, setImpulseFrozenModal] = useState<{
    isOpen: boolean;
    entry: BestSellerEntry | null;
  }>({ isOpen: false, entry: null });
  const [pendingImpulseProducts, setPendingImpulseProducts] = useState<Product[]>([]);

  const updateOrderModalityPreference = useCallback((pref: 'frozen' | 'normal' | null) => {
    setOrderModalityPreference(pref);
    if (pref) {
      safeStorage.setSession('balbec_order_modality_preference', pref);
    } else {
      safeStorage.removeSession('balbec_order_modality_preference');
    }
  }, []);

  const clearScheduleSelection = useCallback(() => {
    setSelectedScheduleTime('');
    setSelectedScheduleDate('');
    setSelectedScheduleDay('');
    safeStorage.removeItem('balbec_selected_schedule_time');
    safeStorage.removeItem('balbec_selected_schedule_date');
    safeStorage.removeItem('balbec_selected_schedule_day');
  }, []);

  // Invalida automaticamente horários salvos que ficaram fora do expediente do dia selecionado (ex.: alteração no painel)
  useEffect(() => {
    if (!isInitialized || !storeInfo.deliveryScheduleEnabled) return;
    if (selectedScheduleDate && selectedScheduleTime) {
      if (!isSlotAllowedForDate(storeInfo, selectedScheduleDate, selectedScheduleTime)) {
        setSelectedScheduleTime('');
        safeStorage.removeItem('balbec_selected_schedule_time');
      }
    }
  }, [
    isInitialized,
    storeInfo.deliveryScheduleEnabled,
    storeInfo.deliveryScheduleSlots,
    storeInfo.weeklySchedule,
    storeInfo.scheduleStartTime,
    storeInfo.scheduleEndTime,
    selectedScheduleDate,
    selectedScheduleTime,
  ]);

  const checkoutScheduleRef = useRef<HTMLDivElement>(null);
  const checkoutCustomerRef = useRef<HTMLHeadingElement>(null);
  const checkoutPaymentRef = useRef<HTMLHeadingElement>(null);
  const checkoutFinalizeRef = useRef<HTMLButtonElement>(null);

  const scheduleDaysSectionRef = useRef<HTMLDivElement>(null);
  const scheduleSlotsSectionRef = useRef<HTMLDivElement>(null);
  const scheduleConfirmBtnRef = useRef<HTMLButtonElement>(null);

  // Auto-scroll para cada etapa do checkout conforme o preenchimento
  useEffect(() => {
    if (isCheckout) {
      // 1. Rolagem para horário se agendamento estiver habilitado e ainda não escolhido
      if (storeInfo.deliveryScheduleEnabled && !selectedScheduleTime) {
        setTimeout(() => {
          checkoutScheduleRef.current?.scrollIntoView({ behavior: 'smooth', block: 'center' });
        }, 300);
      }
      // 2. Rolagem para identificação se horário escolhido mas nome/celular pendentes
      else if (selectedScheduleTime && (!customerName || customerPhone.length < 14)) {
        setTimeout(() => {
          checkoutCustomerRef.current?.scrollIntoView({ behavior: 'smooth', block: 'start' });
        }, 300);
      }
      // 3. Rolagem para pagamento se identificação concluída mas método não escolhido
      else if (customerName.length > 3 && customerPhone.length >= 14 && !paymentMethod) {
        setTimeout(() => {
          checkoutPaymentRef.current?.scrollIntoView({ behavior: 'smooth', block: 'start' });
        }, 300);
      }
      // 4. Rolagem final para o botão de finalizar
      else if (paymentMethod) {
        setTimeout(() => {
          checkoutFinalizeRef.current?.scrollIntoView({ behavior: 'smooth', block: 'center' });
        }, 300);
      }
    }
  }, [isCheckout, selectedScheduleTime, customerName, customerPhone, paymentMethod, storeInfo.deliveryScheduleEnabled]);

  // Auto-scroll suave para as etapas de agendamento de data e horário (início do pedido / checkout)
  useEffect(() => {
    if (showScheduleSelectionStep) {
      if (!selectedScheduleDate) {
        setTimeout(() => {
          scheduleDaysSectionRef.current?.scrollIntoView({ behavior: 'smooth', block: 'start' });
        }, 200);
      } else if (!selectedScheduleTime) {
        setTimeout(() => {
          scheduleSlotsSectionRef.current?.scrollIntoView({ behavior: 'smooth', block: 'start' });
        }, 200);
      } else {
        setTimeout(() => {
          scheduleConfirmBtnRef.current?.scrollIntoView({ behavior: 'smooth', block: 'center' });
        }, 200);
      }
    }
  }, [showScheduleSelectionStep]);
  const [pendingAddToCart, setPendingAddToCart] = useState<any>(null);
  const [showChannelSelection, setShowChannelSelection] = useState(false);

  const channelCategoryCounts = useMemo(() => {
    const allCats = Array.isArray(categories) ? categories : [];
    const allProds = Array.isArray(products) ? products : [];

    if (allProds.length === 0) {
      return {
        delivery: allCats.filter(c => c && c.isVisible !== false && c.availableForDelivery !== false).length,
        instore: allCats.filter(c => c && c.isVisible !== false && c.availableInStore !== false).length,
        kiosk: allCats.filter(c => c && c.isVisible !== false && c.availableForKiosk !== false).length,
      };
    }

    const deliveryCatIds = new Set<string>();
    const instoreCatIds = new Set<string>();
    const kioskCatIds = new Set<string>();

    for (let i = 0; i < allProds.length; i++) {
      const p = allProds[i];
      if (!p || !p.categoryId || !p.isActive || p.isFlavor || p.isAddon || isAddonItem(p, allCats) || shouldExcludeProduct(p, allCats)) continue;
      if (p.availableForDelivery !== false) deliveryCatIds.add(p.categoryId);
      if (p.availableInStore !== false) instoreCatIds.add(p.categoryId);
      if (p.availableForKiosk !== false) kioskCatIds.add(p.categoryId);
    }

    const getCount = (catSet: Set<string>, channel: 'delivery' | 'instore' | 'kiosk') => {
      return allCats.filter(c => {
        if (!c || !c.id || typeof c.name !== 'string' || c.isVisible === false) return false;
        if (isExcludedCategory(c.name) || isAddonCategory(c.name)) return false;
        const catMatches = 
          channel === 'delivery' ? c.availableForDelivery !== false :
          channel === 'kiosk' ? c.availableForKiosk !== false :
          c.availableInStore !== false;
        return catMatches && catSet.has(c.id);
      }).length;
    };

    return {
      delivery: getCount(deliveryCatIds, 'delivery'),
      instore: getCount(instoreCatIds, 'instore'),
      kiosk: getCount(kioskCatIds, 'kiosk'),
    };
  }, [categories, products]);

  const slotBookedItemsMap = useMemo(() => {
    const map: Record<string, number> = {};
    const todayStr = new Date().toISOString().slice(0, 10);
    for (const o of (orders || [])) {
      if (!o || !o.scheduledTime || o.status === 'cancelled') continue;
      const orderDate = o.scheduledDate || (o.createdAt ? new Date(o.createdAt).toISOString().slice(0, 10) : todayStr);
      const key = `${orderDate}_${o.scheduledTime}`;
      let items: any[] = [];
      if (Array.isArray(o.items)) {
        items = o.items;
      } else if (typeof (o as any).items === 'string' && (o as any).items.trim() !== '') {
        try {
          const parsed = JSON.parse((o as any).items);
          if (Array.isArray(parsed)) items = parsed;
        } catch {
          items = [];
        }
      }
      const totalUnits = items.reduce((sum: number, it: any) => sum + (Number(it.quantity) || 1), 0);
      map[key] = (map[key] || 0) + totalUnits;
    }
    return map;
  }, [orders]);

  const slotOrderCounts = useMemo(() => {
    const counts: Record<string, number> = {};
    for (const o of (orders || [])) {
      if (o && o.scheduledTime && o.status !== 'cancelled') {
        counts[o.scheduledTime] = (counts[o.scheduledTime] || 0) + 1;
      }
    }
    return counts;
  }, [orders]);

  const hasDeliveryCategories = channelCategoryCounts.delivery > 0;
  const hasInStoreCategories = channelCategoryCounts.instore > 0;
  const hasKioskCategories = channelCategoryCounts.kiosk > 0;

  const currentStatus = getStoreCurrentStatus(
    storeInfo.weeklySchedule,
    storeInfo.isOpen !== false,
    storeInfo.autoOpenClose !== false,
    !!storeInfo.forceOpen
  );

  // Consumo na Loja e Atendimento Totem ficam abertos conforme horário automático ou abertura manual do lojista
  const isPhysicalStoreOpen = currentStatus.isOpenNow;
  const isInStoreActive = isPhysicalStoreOpen && storeInfo.inStoreEnabled !== false;
  const isKioskActive = isPhysicalStoreOpen && storeInfo.kioskEnabled !== false;

  // Delivery desativado neste projeto (apenas Retirada)
  const isDeliveryActive = false;

  // Carregar dados do localStorage apenas para pedidos online normais (no Totem, não pede identificação prévia)
  useEffect(() => {
    if (isTotemPath) {
      setCustomerName('');
      setCustomerPhone('');
      setHasName(true);
      return;
    }
    const savedName = safeStorage.getItem('balbec_customer_name');
    const savedPhone = safeStorage.getItem('balbec_customer_phone');
    if (savedName) setCustomerName(savedName);
    if (savedPhone) setCustomerPhone(savedPhone);

    const savedCep = safeStorage.getItem('balbec_customer_cep');
    const savedNeighborhood = safeStorage.getItem('balbec_customer_neighborhood');
    const savedFee = safeStorage.getItem('balbec_delivery_fee');
    if (savedCep) {
      setDeliveryCep(savedCep);
      if (savedNeighborhood) {
        setDeliveryNeighborhood(savedNeighborhood);
        setDeliveryFee(Number(savedFee) || 0);
        setCepValidStatus('valid');
      }
    }

    const savedEmail = safeStorage.getItem('balbec_customer_email');
    const savedCpf = safeStorage.getItem('balbec_customer_cpf');
    const savedStreet = safeStorage.getItem('balbec_customer_street');
    const savedNumber = safeStorage.getItem('balbec_customer_number');
    const savedComplement = safeStorage.getItem('balbec_customer_complement');
    const savedReference = safeStorage.getItem('balbec_customer_reference');

    if (savedEmail) setCustomerEmail(savedEmail);
    if (savedCpf) setCustomerCpf(savedCpf);
    if (savedStreet) setDeliveryStreet(savedStreet);
    if (savedNumber) setDeliveryNumber(savedNumber);
    if (savedComplement) setDeliveryComplement(savedComplement);
    if (savedReference) setDeliveryReference(savedReference);

    // Se já estiver em uma sessão ativa com CEP verificado, mantém liberado
    const isSessionVerified = safeStorage.getSession('balbec_delivery_cep_verified') === 'true';
    if (savedName && savedPhone && isSessionVerified && savedCep && savedNeighborhood) {
      setHasName(true);
    }
  }, [isTotemPath]);


  const [activeCustomer, setActiveCustomer] = useState<any>(() => {
    try {
      const saved = safeStorage.getItem('balbec_logged_customer');
      return saved ? JSON.parse(saved) : null;
    } catch {
      return null;
    }
  });

  // Função central de logout para desconectar o cliente com segurança
  const handleCustomerLogout = useCallback(() => {
    setActiveCustomer(null);
    safeStorage.removeItem('balbec_logged_customer');
    safeStorage.removeItem('balbec_customer_name');
    safeStorage.removeItem('balbec_customer_phone');
    safeStorage.removeItem('balbec_customer_email');
    safeStorage.removeItem('balbec_customer_cpf');
    safeStorage.removeItem('balbec_customer_cep');
    safeStorage.removeItem('balbec_customer_street');
    safeStorage.removeItem('balbec_customer_number');
    safeStorage.removeItem('balbec_customer_complement');
    safeStorage.removeItem('balbec_customer_reference');
    safeStorage.removeItem('balbec_customer_neighborhood');
    safeStorage.removeItem('balbec_delivery_cep_verified');
    safeStorage.removeSession('balbec_delivery_cep_verified');
    safeStorage.removeSession('selected_sales_channel');
    setCustomerName('');
    setCustomerPhone('');
    setCustomerEmail('');
    setCustomerCpf('');
    setDeliveryStreet('');
    setDeliveryNumber('');
    setDeliveryComplement('');
    setDeliveryReference('');
    setDeliveryCep('');
    setDeliveryNeighborhood('');
    setHasName(false);
    setHasChosenChannel(true);
    setInitialEntryChoice('view');
    setSalesChannel('instore');
    setDeliveryType('pickup');
    setIsProfileModalOpen(false);
    setIsAuthModalOpen(false);
    setShowOrderTypeChoiceModal(false);
    setShowScheduleSelectionStep(false);
    updateOrderModalityPreference(null);
    clearScheduleSelection();
    updateQueuedImpulseProducts([]);
    setImpulseFrozenModal({ isOpen: false, entry: null });
    setPendingImpulseProducts([]);
  }, [clearScheduleSelection, updateOrderModalityPreference, updateQueuedImpulseProducts]);

  // Função central para resetar o totem/aplicativo para o próximo pedido
  const handleResetForNewCustomer = useCallback(() => {
    setIsSuccess(false);
    setIsCheckout(false);
    if (isTotemPath) {
      setHasName(true);
    } else {
      // Regra: estando logado com um usuário, permanece logado após a impressão!
      // Só pode logar com outro usuário se desconectar explicitamente.
      const savedCustomerRaw = safeStorage.getItem('balbec_logged_customer');
      let currentLoggedIn = activeCustomer;
      if (!currentLoggedIn && savedCustomerRaw) {
        try {
          currentLoggedIn = JSON.parse(savedCustomerRaw);
        } catch {}
      }

      if (currentLoggedIn && currentLoggedIn.name) {
        setActiveCustomer(currentLoggedIn);
        setHasName(true);
        setCustomerName(currentLoggedIn.name);
        setCustomerPhone(currentLoggedIn.phone || '');
        setDeliveryAccessStep('cep');
        setCepValidStatus('valid');
      } else {
        setHasName(false);
        setDeliveryAccessStep('info');
        setCepValidStatus('idle');
        safeStorage.removeSession('balbec_delivery_cep_verified');
        setCustomerName('');
        setCustomerPhone('');
      }
    }
    setOnlinePaymentData(null);
    setLastPlacedOrder(null);
    setFrozenPaymentPlan(null);
    setPaymentMode(null);
    setPaymentMethod('');
    setCart([]);
    setIsCartOpen(false);
    updateOrderModalityPreference(null);
    clearScheduleSelection();
    updateQueuedImpulseProducts([]);
    setImpulseFrozenModal({ isOpen: false, entry: null });
    setPendingImpulseProducts([]);
  }, [isTotemPath, activeCustomer, clearScheduleSelection, updateOrderModalityPreference, updateQueuedImpulseProducts]);

  // Timer na tela de conclusão / impressão do pedido (5s no totem, 45s no celular para dar tempo do cliente ir ao balcão)
  useEffect(() => {
    if (!isSuccess) return;

    const lastOrderHasFrozen = Boolean(
      lastPlacedOrder &&
      Array.isArray(lastPlacedOrder.items) &&
      lastPlacedOrder.items.some((it: any) =>
        Boolean(it?.isFrozen) ||
        (it?.prepType && String(it.prepType).startsWith('congelado')) ||
        (it?.prepLabel && String(it.prepLabel).toLowerCase().includes('congelad')) ||
        (Array.isArray(it?.addons) && it.addons.some((a: any) => a?.isFrozen || a?.productId === 'prod_congelado'))
      )
    );

    // Se acabou de finalizar pedido de congelados ou reservou itens sugeridos no web/mobile,
    // mantém a tela aberta para permitir iniciar o 2º pedido pelos mais vendidos sem interromper.
    if (!(salesChannel === 'kiosk' || isTotemPath) && (queuedImpulseProducts.length > 0 || lastOrderHasFrozen)) {
      setSuccessCountdown(0);
      return;
    }

    const initialTime = (salesChannel === 'kiosk' || isTotemPath) ? 5 : 45;
    setSuccessCountdown(initialTime);
    const interval = setInterval(() => {
      setSuccessCountdown((prev) => {
        if (prev <= 1) {
          clearInterval(interval);
          handleResetForNewCustomer();
          return 0;
        }
        return prev - 1;
      });
    }, 1000);

    return () => clearInterval(interval);
  }, [isSuccess, salesChannel, isTotemPath, handleResetForNewCustomer, lastPlacedOrder, queuedImpulseProducts.length]);


  const formatPhone = (value: string) => {
    const numbers = value.replace(/\D/g, '');
    if (numbers.length <= 11) {
      return numbers
        .replace(/^(\d{2})(\d)/g, '($1) $2')
        .replace(/(\d{5})(\d)/, '$1-$2');
    }
    return value;
  };

  const handlePhoneChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const formatted = formatPhone(e.target.value);
    if (formatted.length <= 15) {
      setCustomerPhone(formatted);
    }
  };

  // Opções de canais visíveis na seleção pública ao iniciar (neste projeto, apenas Retirada / instore)
  type ChannelOption = 'delivery' | 'kiosk' | 'instore';
  const visibleChannels: ChannelOption[] = useMemo(() => {
    return ['instore'];
  }, []);

  const activeAvailableChannels: ChannelOption[] = [];
  if (isInStoreActive) activeAvailableChannels.push('instore');

  const [hasChosenChannel, setHasChosenChannel] = useState<boolean>(() => {
    try {
      const pathname = window.location.pathname.toLowerCase();
      if (pathname.startsWith('/totem') || pathname.startsWith('/kiosk')) return true;
      const params = new URLSearchParams(window.location.search);
      const mode = params.get('mode') || params.get('channel') || params.get('tipo');
      if (mode === 'instore' || mode === 'loja' || mode === 'presencial' || mode === 'delivery' || mode === 'entrega') {
        return true;
      }
      if (mode === 'kiosk' || mode === 'totem' || mode === 'autoatendimento') {
        return true;
      }
      const saved = safeStorage.getSession('selected_sales_channel');
      if (saved === 'delivery' || saved === 'instore' || saved === 'kiosk') return true;
    } catch {}
    return true;
  });

  const [isQrValidated, setIsQrValidated] = useState<boolean>(() => {
    try {
      const pathname = window.location.pathname.toLowerCase();
      if (pathname.startsWith('/totem') || pathname.startsWith('/kiosk')) return true;
      if (pathname.startsWith('/delivery') || pathname.startsWith('/entrega')) return true;
      const params = new URLSearchParams(window.location.search);
      const mode = params.get('mode') || params.get('channel') || params.get('tipo');
      if (mode === 'delivery' || mode === 'entrega' || mode === 'kiosk' || mode === 'totem') return true;
      const tableParam = params.get('mesa') || params.get('table') || params.get('mesa_num');
      const qrParam = params.get('qr') || params.get('src') || params.get('origem') || params.get('source');
      if (tableParam || qrParam === 'true' || qrParam === 'qrcode' || qrParam === 'qr') {
        safeStorage.setSession('balbec_qr_validated', 'true');
        return true;
      }
    } catch {}
    return safeStorage.getSession('balbec_qr_validated') === 'true';
  });

  const isChannelActive = 
    salesChannel === 'delivery' ? isDeliveryActive :
    salesChannel === 'kiosk' ? isKioskActive :
    isInStoreActive;

  // Se o cliente leu o QR Code da mesa, desbloqueia o pedido imediatamente
  const isQrTableScan = selectedTableNumber !== null && selectedTableNumber > 0;

  // A exigência de QR Code é restrita ao consumo presencial em loja/mesa (nunca deve bloquear pedidos no Totem)
  const requireQrCode = salesChannel === 'instore' && !selectedTableNumber && initialEntryChoice !== 'view' && storeInfo?.requireQrCodeForOrdering !== false;
  
  //canBuy: O canal deve estar ativo e a loja aberta (ou força aberta), ou liberado por leitura de QR Code na mesa.
  const canBuy = (isChannelActive || isQrTableScan) && (currentStatus.isOpenNow || !!storeInfo.forceOpen || isQrTableScan) && (!requireQrCode || isQrValidated);


  useEffect(() => {
    let mode: string | null = null;
    let tableParam: string | null = null;
    try {
      const pathname = window.location.pathname.toLowerCase();
      if (pathname.startsWith('/totem') || pathname.startsWith('/kiosk')) {
        setIsQrValidated(true);
        safeStorage.setSession('balbec_qr_validated', 'true');
        setSalesChannel('kiosk');
        setDeliveryType('pickup');
        setHasChosenChannel(true);
        safeStorage.setSession('selected_sales_channel', 'kiosk');
        return;
      }
      if (pathname.startsWith('/delivery') || pathname.startsWith('/entrega')) {
        setIsQrValidated(true);
        safeStorage.setSession('balbec_qr_validated', 'true');
        setSalesChannel('instore');
        setDeliveryType('pickup');
        setHasChosenChannel(true);
        safeStorage.setSession('selected_sales_channel', 'instore');
        return;
      }
      const params = new URLSearchParams(window.location.search);
      mode = params.get('mode') || params.get('channel') || params.get('tipo');
      tableParam = params.get('mesa') || params.get('table') || params.get('mesa_num');
      const qrParam = params.get('qr') || params.get('src') || params.get('origem') || params.get('source');
      if (qrParam === 'true' || qrParam === 'qrcode' || qrParam === 'qr') {
        setIsQrValidated(true);
        safeStorage.setSession('balbec_qr_validated', 'true');
      }
    } catch {}
    
    // Se acessou via QR Code da mesa (?mesa=X)
    if (tableParam && !isNaN(parseInt(tableParam, 10))) {
      const tableNum = parseInt(tableParam, 10);
      setSelectedTableNumber(tableNum);
      safeStorage.setSession('balbec_selected_table', String(tableNum));
      setIsQrValidated(true);
      safeStorage.setSession('balbec_qr_validated', 'true');
      setSalesChannel('instore');
      setDeliveryType('pickup');
      setHasChosenChannel(true);
      safeStorage.setSession('selected_sales_channel', 'instore');
      return;
    }

    if (mode === 'kiosk' || mode === 'totem' || mode === 'autoatendimento') {
      setSalesChannel('kiosk');
      setDeliveryType('pickup');
      setHasChosenChannel(true);
      safeStorage.setSession('selected_sales_channel', 'kiosk');
    } else {
      setSalesChannel('instore');
      setDeliveryType('pickup');
      setHasChosenChannel(true);
      safeStorage.setSession('selected_sales_channel', 'instore');
    }
  }, [storeInfo.deliveryEnabled, storeInfo.inStoreEnabled, storeInfo.kioskEnabled, hasDeliveryCategories, hasInStoreCategories]);

  // Controlar classe totem-mode no documento
  useEffect(() => {
    const isKioskMode = salesChannel === 'kiosk' || isTotemPath;
    if (isKioskMode) {
      document.documentElement.classList.add('totem-mode');
      document.body.classList.add('totem-mode');
    } else {
      document.documentElement.classList.remove('totem-mode');
      document.body.classList.remove('totem-mode');
    }
  }, [salesChannel, isTotemPath]);

  // Garantir que sempre fique em Retirada (instore), exceto no Totem
  useEffect(() => {
    if (isTotemPath || salesChannel === 'kiosk') return;
    if (salesChannel === 'delivery') {
      setSalesChannel('instore');
      setDeliveryType('pickup');
      safeStorage.setSession('selected_sales_channel', 'instore');
    }
  }, [salesChannel, isTotemPath]);

  // Se houver apenas 1 opção disponível para o cliente, auto-selecionar sem obrigar modal
  useEffect(() => {
    if (isTotemPath) return;
    if (visibleChannels.length === 1 && !hasChosenChannel) {
      handleSelectChannel(visibleChannels[0]);
    }
  }, [visibleChannels, hasChosenChannel, isTotemPath]);

  const handleSelectChannel = (channel: 'delivery' | 'instore' | 'kiosk') => {
    const resolvedChannel = channel === 'delivery' ? 'instore' : channel;
    setSalesChannel(resolvedChannel);
    setHasChosenChannel(true);
    setInitialEntryChoice('view');
    setShowChannelSelection(false);
    safeStorage.setSession('selected_sales_channel', resolvedChannel);

    // If there was a product waiting to be added, add it now
    if (pendingAddToCart) {
      initiateAddToCart(pendingAddToCart);
      setPendingAddToCart(null);
    }
    setDeliveryType('pickup');
    setSelectedTableNumber(null);
    safeStorage.removeSession('balbec_selected_table');
    try {
      const url = new URL(window.location.href);
      url.searchParams.set('mode', resolvedChannel);
      window.history.replaceState({}, '', url.toString());
    } catch {}
  };
  const [cart, setCart] = useState<OrderItem[]>(() => {
    try {
      const saved = safeStorage.getItem('balbec_active_cart');
      if (saved) {
        const parsed = JSON.parse(saved);
        if (Array.isArray(parsed)) return parsed;
      }
    } catch (e) {
      console.warn('Erro ao carregar carrinho persistente:', e);
    }
    return [];
  });
  const [isSendingOrder, setIsSendingOrder] = useState(false);

  // Helper central para detecção de itens congelados no carrinho
  const isCartItemFrozen = useCallback((item: any): boolean => {
    if (!item) return false;
    if (item.isFrozen === true) return true;
    if (item.prepType && String(item.prepType).startsWith('congelado')) return true;
    if (item.prepLabel && String(item.prepLabel).toLowerCase().includes('congelad')) return true;
    if (Array.isArray(item.addons) && item.addons.some((a: any) => a.isFrozen || a.productId === 'prod_congelado' || (a.name && a.name.toLowerCase().includes('congelad')))) return true;
    if (Array.isArray(item.options) && item.options.some((o: any) => o.isFrozen || (o.name && o.name.toLowerCase().includes('congelad')))) return true;
    return false;
  }, []);

  const hasFrozenInCart = useMemo(() => {
    return cart.some(isCartItemFrozen);
  }, [cart, isCartItemFrozen]);

  const hasNormalInCart = useMemo(() => {
    return cart.some(it => !isCartItemFrozen(it));
  }, [cart, isCartItemFrozen]);

  // Validador de elegibilidade para acréscimo:
  // 1. Status ainda não mudou para preparando (apenas 'pending')
  // 2. Pedido ainda NÃO foi impresso (pelo atendente ou impressão automática)
  // 3. Condição de pagamento é presencial na retirada (não pagamento online aprovado)
  const isOrderEligibleForAppend = useCallback((order: any): boolean => {
    if (!order) return false;
    if (order.status !== 'pending') return false;
    if (order.isPrinted || order.printedAt || order.autoPrinted90Min) return false;
    const isOnlineApproved = (order.paymentMethod && order.paymentMethod.includes('Online')) || order.paymentStatus === 'approved';
    if (isOnlineApproved) return false;
    return true;
  }, []);

  const targetOrderIsFrozen = useMemo(() => {
    if (!appendOrderTarget || !Array.isArray(appendOrderTarget.items)) return false;
    return appendOrderTarget.items.some(isCartItemFrozen);
  }, [appendOrderTarget, isCartItemFrozen]);

  const appendCartSubtotal = useMemo(() => {
    return appendCart.reduce((sum, item) => {
      const addonsTotal = item.addons?.reduce((addonSum, addon) => addonSum + addon.price, 0) || 0;
      const flavorTotal = item.flavor?.price || 0;
      return sum + ((item.price + flavorTotal + addonsTotal) * item.quantity);
    }, 0);
  }, [appendCart]);

  const handleStartAppendOrder = useCallback((order: Order) => {
    if (!isOrderEligibleForAppend(order)) {
      setCartToastMessage('⚠️ Este pedido já foi impresso para produção ou mudou de etapa e não aceita mais acréscimos.');
      return;
    }
    setAppendOrderTarget(order);
    setAppendCart([]);
    setIsTrackOrderModalOpen(false);
    setIsProfileModalOpen(false);
    setTrackingOrderId(null);
    setIsCartOpen(false);
    setIsAppendReviewModalOpen(false);
    setAppendErrorMessage(null);
    try {
      window.scrollTo({ top: 0, behavior: 'smooth' });
    } catch {}
  }, [isOrderEligibleForAppend]);

  const handleCancelAppendOrder = useCallback(() => {
    if (appendCart.length > 0) {
      if (!confirm('Deseja cancelar o modo de acréscimo e descartar os itens adicionados?')) return;
    }
    setAppendOrderTarget(null);
    setAppendCart([]);
    setIsAppendReviewModalOpen(false);
    setAppendErrorMessage(null);
  }, [appendCart.length]);

  // Se o pedido em modo de acréscimo for impresso ou mudar de status em tempo real, encerra o modo de acréscimo automaticamente
  useEffect(() => {
    if (!appendOrderTarget) return;
    const liveOrder = orders.find(o => String(o.id).trim() === String(appendOrderTarget.id).trim());
    if (!liveOrder) return;
    if (!isOrderEligibleForAppend(liveOrder)) {
      setAppendOrderTarget(null);
      setAppendCart([]);
      setIsAppendReviewModalOpen(false);
      setAppendErrorMessage(null);
      setCartToastMessage('⚠️ Este pedido já foi impresso ou entrou em preparo e não aceita mais acréscimos.');
      return;
    }
    if (
      Number(liveOrder.updatedAt || 0) > Number(appendOrderTarget.updatedAt || 0) &&
      (liveOrder.items?.length !== appendOrderTarget.items?.length || liveOrder.total !== appendOrderTarget.total)
    ) {
      setAppendOrderTarget(liveOrder);
    }
  }, [orders, appendOrderTarget, isOrderEligibleForAppend]);

  // Persistir carrinho no localStorage sempre que houver alterações
  useEffect(() => {
    try {
      if (cart.length > 0) {
        safeStorage.setItem('balbec_active_cart', JSON.stringify(cart));
      } else {
        safeStorage.removeItem('balbec_active_cart');
      }
    } catch (e) {
      console.warn('Erro ao salvar carrinho no storage:', e);
    }
  }, [cart]);

  const [customerEmail, setCustomerEmail] = useState(() => safeStorage.getItem('balbec_customer_email') || '');
  const [customerCpf, setCustomerCpf] = useState(() => safeStorage.getItem('balbec_customer_cpf') || '');
  const [deliveryStreet, setDeliveryStreet] = useState(() => safeStorage.getItem('balbec_customer_street') || '');
  const [deliveryNumber, setDeliveryNumber] = useState(() => safeStorage.getItem('balbec_customer_number') || '');
  const [deliveryComplement, setDeliveryComplement] = useState(() => safeStorage.getItem('balbec_customer_complement') || '');
  const [deliveryReference, setDeliveryReference] = useState(() => safeStorage.getItem('balbec_customer_reference') || '');
  const [onlinePaymentData, setOnlinePaymentData] = useState<{ qrCode: string; paymentId: string; status: string } | null>(null);
  const [isCheckingPayment, setIsCheckingPayment] = useState(false);

  // Estados do fluxo de pagamento online com liberação segura
  const [activePixPayment, setActivePixPayment] = useState<{
    paymentId: string;
    qrCode: string;
    brCode?: string;
    amount: number;
    totalOrderAmount?: number;
    isPartialPayment?: boolean;
    remainingAmount?: number;
    copied?: boolean;
  } | null>(null);
  const [isVerifyingPix, setIsVerifyingPix] = useState(false);
  const [pixTimeRemaining, setPixTimeRemaining] = useState(900);
  const [pixShareFeedback, setPixShareFeedback] = useState<string | null>(null);
  const [isSharingPix, setIsSharingPix] = useState(false);

  const [activeCardPayment, setActiveCardPayment] = useState<{
    type: 'credit' | 'debit';
    amount: number;
    totalOrderAmount?: number;
    isPartialPayment?: boolean;
    remainingAmount?: number;
  } | null>(null);
  const [cardFormData, setCardFormData] = useState({
    number: '',
    holderName: '',
    expiry: '',
    cvv: '',
    cpf: '',
    installments: 1
  });
  const [isProcessingCard, setIsProcessingCard] = useState(false);
  const [cardPaymentError, setCardPaymentError] = useState<string | null>(null);

  const [deliveryCep, setDeliveryCep] = useState(() => safeStorage.getItem('balbec_customer_cep') || '');
  const [deliveryNeighborhood, setDeliveryNeighborhood] = useState(() => safeStorage.getItem('balbec_customer_neighborhood') || '');
  const [deliveryFee, setDeliveryFee] = useState(() => Number(safeStorage.getItem('balbec_delivery_fee')) || 0);
  const [cepValidStatus, setCepValidStatus] = useState<'idle' | 'checking' | 'valid' | 'invalid'>(() => {
    return safeStorage.getItem('balbec_delivery_cep_verified') === 'true' ? 'valid' : 'idle';
  });
  const [cepErrorMessage, setCepErrorMessage] = useState('');


  const [isAuthModalOpen, setIsAuthModalOpen] = useState(false);
  const [authMode, setAuthMode] = useState<'login' | 'register' | 'forgot'>('login');
  const [authIdentifier, setAuthIdentifier] = useState('');
  const [authPassword, setAuthPassword] = useState('');
  const [authName, setAuthName] = useState('');
  const [authPhone, setAuthPhone] = useState('');
  const [authRegEmail, setAuthRegEmail] = useState('');
  const [authRegCpf, setAuthRegCpf] = useState('');
  const [pickupCreateAccount, setPickupCreateAccount] = useState(false);
  const [pickupPassword, setPickupPassword] = useState('');
  const [isSystemIntroModalOpen, setIsSystemIntroModalOpen] = useState(false);
  const [activeDriver, setActiveDriver] = useState<any>(null); // For tracking

  // Estados para Troca Obrigatória de Senha (Primeiro Acesso)
  const [mustChangePasswordModal, setMustChangePasswordModal] = useState(false);
  const [newCustPassword, setNewCustPassword] = useState('');
  const [confirmCustPassword, setConfirmCustPassword] = useState('');
  const [showNewCustPassword, setShowNewCustPassword] = useState(false);
  const [showConfirmCustPassword, setShowConfirmCustPassword] = useState(false);
  const [changePassLoading, setChangePassLoading] = useState(false);
  const [changePassError, setChangePassError] = useState('');
  const [changePassSuccess, setChangePassSuccess] = useState('');

  // Estados para Gestão de Dados do Cliente
  const [customerAddresses, setCustomerAddresses] = useState<CustomerAddress[]>(() => {
    try {
      const savedCustRaw = safeStorage.getItem('balbec_logged_customer');
      const savedCust = savedCustRaw ? JSON.parse(savedCustRaw) : null;
      if (savedCust?.id) {
        const cached = safeStorage.getItem(`balbec_customer_addresses_${savedCust.id}`);
        if (cached) {
          const parsed = JSON.parse(cached);
          if (Array.isArray(parsed)) return parsed;
        }
      }
    } catch {}
    return [];
  });
  const [isSavingAddress, setIsSavingAddress] = useState(false);
  const [addressSaveMsg, setAddressSaveMsg] = useState<string | null>(null);
  const [customerOrders, setCustomerOrders] = useState<any[]>([]);
  const [trackingOrderId, setTrackingOrderId] = useState<string | null>(null);

  // Pedido ativo mais recente deste cliente (Delivery ou Retirada) para acompanhar status
  const latestActiveOrder = useMemo(() => {
    // 1. Pedido colocado nesta sessão
    if (lastPlacedOrder && lastPlacedOrder.status !== 'completed' && lastPlacedOrder.status !== 'cancelled') {
      return lastPlacedOrder;
    }
    // 2. Procura nos pedidos da loja aquele que pertence a este cliente/aparelho
    const savedLastId = (
      safeStorage.getItem('balbec_last_order_id') || 
      safeStorage.getItem('balbec_tracking_order_id') || 
      (typeof localStorage !== 'undefined' ? localStorage.getItem('balbec_last_order_id') : null) || 
      ''
    ).trim();
    const savedPhone = (
      safeStorage.getItem('balbec_customer_phone') || 
      (typeof localStorage !== 'undefined' ? localStorage.getItem('balbec_customer_phone') : null) || 
      ''
    ).replace(/\D/g, '');
    const currentOrders = orders || [];
    
    if (savedLastId) {
      const match = currentOrders.find((o: any) => {
        const sId = String(o.id).trim();
        return (sId === savedLastId || sId.endsWith(savedLastId) || savedLastId.endsWith(sId)) && o.status !== 'completed' && o.status !== 'cancelled';
      });
      if (match) return match;
    }

    if (savedPhone.length >= 8) {
      const match = currentOrders.find((o: any) => {
        const oPhone = String(o.customerPhone || '').replace(/\D/g, '');
        return oPhone.length >= 8 && (oPhone === savedPhone || oPhone.slice(-8) === savedPhone.slice(-8)) && o.status !== 'completed' && o.status !== 'cancelled';
      });
      if (match) return match;
    }

    if (activeCustomer?.id) {
      const match = currentOrders.find((o: any) => o.customerId === activeCustomer.id && o.status !== 'completed' && o.status !== 'cancelled');
      if (match) return match;
    }

    return null;
  }, [lastPlacedOrder, orders, activeCustomer]);

  // Lista de todos os pedidos ativos deste cliente para contagem no sininho
  const customerActiveOrders = useMemo(() => {
    const savedLastId = (
      safeStorage.getItem('balbec_last_order_id') || 
      safeStorage.getItem('balbec_tracking_order_id') || 
      (typeof localStorage !== 'undefined' ? localStorage.getItem('balbec_last_order_id') : null) || 
      ''
    ).trim();
    const savedPhone = (
      safeStorage.getItem('balbec_customer_phone') || 
      (typeof localStorage !== 'undefined' ? localStorage.getItem('balbec_customer_phone') : null) || 
      ''
    ).replace(/\D/g, '');
    const currentOrders = orders || [];

    const activeList = currentOrders.filter((o: any) => {
      if (!o || o.status === 'completed' || o.status === 'cancelled') return false;
      const sId = String(o.id || '').trim();
      if (lastPlacedOrder && String(lastPlacedOrder.id).trim() === sId) return true;
      if (savedLastId && (sId === savedLastId || sId.endsWith(savedLastId) || savedLastId.endsWith(sId))) return true;
      if (savedPhone.length >= 8) {
        const oPhone = String(o.customerPhone || '').replace(/\D/g, '');
        if (oPhone.length >= 8 && (oPhone === savedPhone || oPhone.slice(-8) === savedPhone.slice(-8))) return true;
      }
      if (activeCustomer?.id && o.customerId === activeCustomer.id) return true;
      return false;
    });

    if (lastPlacedOrder && lastPlacedOrder.status !== 'completed' && lastPlacedOrder.status !== 'cancelled') {
      if (!activeList.some((o: any) => String(o.id) === String(lastPlacedOrder.id))) {
        activeList.unshift(lastPlacedOrder);
      }
    }

    return activeList;
  }, [lastPlacedOrder, orders, activeCustomer]);

  const activeOrdersCount = customerActiveOrders.length > 0 
    ? customerActiveOrders.length 
    : (latestActiveOrder ? 1 : 0);

  // Mantém compatibilidade com latestActiveDeliveryOrder para telas específicas de delivery
  const latestActiveDeliveryOrder = useMemo(() => {
    if (latestActiveOrder && (latestActiveOrder.type === 'delivery' || latestActiveOrder.deliveryType === 'delivery')) {
      return latestActiveOrder;
    }
    return null;
  }, [latestActiveOrder]);

  const [isTrackOrderModalOpen, setIsTrackOrderModalOpen] = useState(() => {
    if (typeof window !== 'undefined') {
      const urlParams = new URLSearchParams(window.location.search);
      if (urlParams.get('acompanhar') === '1' || urlParams.get('pedidos') === '1' || urlParams.get('notificacoes') === '1') {
        return true;
      }
      return sessionStorage.getItem('balbec_track_modal_open') === '1';
    }
    return false;
  });

  const openTrackOrderModal = () => {
    setIsTrackOrderModalOpen(true);
    setTrackSearchFeedback(null);
    if (typeof window !== 'undefined') {
      try {
        sessionStorage.setItem('balbec_track_modal_open', '1');
        const url = new URL(window.location.href);
        url.searchParams.set('pedidos', '1');
        window.history.replaceState({}, '', url.toString());
      } catch {}
    }
  };

  const closeTrackOrderModal = () => {
    setIsTrackOrderModalOpen(false);
    setTrackSearchFeedback(null);
    if (typeof window !== 'undefined') {
      try {
        sessionStorage.removeItem('balbec_track_modal_open');
        const url = new URL(window.location.href);
        url.searchParams.delete('pedidos');
        url.searchParams.delete('acompanhar');
        url.searchParams.delete('notificacoes');
        window.history.replaceState({}, '', url.toString());
      } catch {}
    }
  };

  const [trackSearchInput, setTrackSearchInput] = useState('');
  const [trackSearchFeedback, setTrackSearchFeedback] = useState<string | null>(null);

  const handleConnectOrder = (searchQuery: string) => {
    const query = searchQuery.trim();
    if (!query) {
      setTrackSearchFeedback('Por favor, informe o número do pedido (ex: 0001) ou seu telefone.');
      return;
    }
    const cleanDigits = query.replace(/\D/g, '');
    const currentOrders = orders || [];
    
    const found = currentOrders.find((o: any) => {
      const sId = String(o.id).trim();
      if (sId === query || sId.endsWith(query) || query.endsWith(sId)) return true;
      if (cleanDigits.length >= 4 && sId.slice(-4) === cleanDigits.slice(-4)) return true;
      const oPhone = String(o.customerPhone || '').replace(/\D/g, '');
      if (cleanDigits.length >= 8 && oPhone.length >= 8) {
        return oPhone === cleanDigits || oPhone.slice(-8) === cleanDigits.slice(-8);
      }
      return false;
    });

    if (found) {
      safeStorage.setItem('balbec_last_order_id', String(found.id));
      safeStorage.setItem('balbec_tracking_order_id', String(found.id));
      if (found.customerPhone) safeStorage.setItem('balbec_customer_phone', String(found.customerPhone));
      if (found.customerName) safeStorage.setItem('balbec_customer_name', String(found.customerName));
      try {
        localStorage.setItem('balbec_last_order_id', String(found.id));
        if (found.customerPhone) localStorage.setItem('balbec_customer_phone', String(found.customerPhone));
        if (found.customerName) localStorage.setItem('balbec_customer_name', String(found.customerName));
      } catch {}
      setLastPlacedOrder(found);
      setTrackSearchFeedback(`✅ Pedido #${String(found.id).slice(-4).padStart(4, '0')} conectado com sucesso a este celular!`);
      if (found.type === 'delivery' || found.deliveryType === 'delivery') {
        setTimeout(() => {
          closeTrackOrderModal();
          setTrackingOrderId(found.id);
        }, 1200);
      }
    } else {
      setTrackSearchFeedback('Nenhum pedido em aberto encontrado. Verifique o número ou telefone digitado.');
    }
  };

  const [isLoadingCustomerData, setIsLoadingCustomerData] = useState(false);
  const [isProfileModalOpen, setIsProfileModalOpen] = useState(false);
  const [profileView, setProfileView] = useState<'menu' | 'addresses' | 'orders'>('menu');
  const [isEditingAddress, setIsEditingAddress] = useState<CustomerAddress | null>(null);
  const [addressFormData, setAddressFormData] = useState({
    alias: 'Casa',
    street: '',
    number: '',
    complement: '',
    neighborhood: '',
    cep: '',
    reference: '',
    isDefault: false
  });

  const fetchCustomerAddressesFromServer = useCallback(async (cust: any) => {
    if (!cust?.id) return;
    const cacheKey = `balbec_customer_addresses_${cust.id}`;
    try {
      const params = new URLSearchParams();
      if (cust.cpf) params.set('cpf', String(cust.cpf));
      if (cust.phone) params.set('phone', String(cust.phone));
      const addrRes = await fetch(`/api/db/customers/${encodeURIComponent(cust.id)}/addresses?${params.toString()}`, {
        cache: 'no-store'
      });
      if (addrRes.ok) {
        const addrs = await addrRes.json();
        if (Array.isArray(addrs)) {
          setCustomerAddresses(addrs);
          safeStorage.setItem(cacheKey, JSON.stringify(addrs));
          if (addrs.length > 0) {
            const def = addrs.find((a: any) => a.isDefault) || addrs[0];
            setDeliveryStreet(def.street);
            setDeliveryNumber(def.number);
            setDeliveryComplement(def.complement || '');
            setDeliveryNeighborhood(def.neighborhood);
            setDeliveryCep(def.cep);
            setDeliveryReference(def.reference || '');
          }
        }
      }
    } catch (err) {
      console.warn('Erro ao buscar endereços do cliente:', err);
    }
  }, []);

  // Efeito para carregar dados do cliente logado e sincronizar META / Status
  useEffect(() => {
    if (activeCustomer?.id) {
      // Restaura cache local imediato deste cliente antes da resposta de rede
      try {
        const cached = safeStorage.getItem(`balbec_customer_addresses_${activeCustomer.id}`);
        if (cached) {
          const parsed = JSON.parse(cached);
          if (Array.isArray(parsed) && parsed.length > 0) {
            setCustomerAddresses(parsed);
          }
        }
      } catch {}

      const fetchCustomerData = async () => {
        setIsLoadingCustomerData(true);
        try {
          const [, ordRes, profRes] = await Promise.all([
            fetchCustomerAddressesFromServer(activeCustomer),
            fetch(`/api/db/customers/${encodeURIComponent(activeCustomer.id)}/orders`, { cache: 'no-store' }),
            fetch(`/api/db/customer-profile/${encodeURIComponent(activeCustomer.id)}`, { cache: 'no-store' })
          ]);
          if (ordRes.ok) setCustomerOrders(await ordRes.json());
          if (profRes.ok) {
            const profData = await profRes.json();
            if (profData.success && profData.customer) {
              if (profData.customer.status === 'pending' || profData.customer.status === 'rejected') {
                handleCustomerLogout();
                return;
              }
              const updatedCust = {
                ...activeCustomer,
                ...profData.customer,
                currentMonthSpent: profData.currentMonthSpent ?? profData.customer.currentMonthSpent ?? activeCustomer.currentMonthSpent
              };
              if (
                updatedCust.id !== activeCustomer.id ||
                updatedCust.monthlyGoal !== activeCustomer.monthlyGoal ||
                updatedCust.currentMonthSpent !== activeCustomer.currentMonthSpent ||
                updatedCust.status !== activeCustomer.status ||
                updatedCust.name !== activeCustomer.name
              ) {
                setActiveCustomer(updatedCust);
                safeStorage.setItem('balbec_logged_customer', JSON.stringify(updatedCust));
              }
            }
          }
        } catch (err) {
          console.error('Erro ao carregar dados do cliente:', err);
        } finally {
          setIsLoadingCustomerData(false);
        }
      };
      fetchCustomerData();
    } else {
      setCustomerAddresses([]);
      setCustomerOrders([]);
    }
  }, [activeCustomer?.id, fetchCustomerAddressesFromServer]);

  // Recarrega endereços atualizados do servidor ao abrir o modal de Perfil
  useEffect(() => {
    if (isProfileModalOpen && activeCustomer?.id) {
      fetchCustomerAddressesFromServer(activeCustomer);
    }
  }, [isProfileModalOpen, activeCustomer?.id, fetchCustomerAddressesFromServer]);

  // Estado de Meta Mensal Customizada
  const [customMonthlyGoal, setCustomMonthlyGoal] = useState<number>(() => {
    const saved = safeStorage.getItem('balbec_custom_monthly_goal');
    if (saved) {
      const parsed = parseFloat(saved);
      if (!isNaN(parsed) && parsed > 0) return parsed;
    }
    return 1000;
  });
  const [isEditGoalModalOpen, setIsEditGoalModalOpen] = useState(false);
  const [newGoalInput, setNewGoalInput] = useState('1000');

  // Cálculo em tempo real da META mensal do cliente
  const customerMonthlyGoalInfo = useMemo(() => {
    const cleanActiveCpf = activeCustomer ? String(activeCustomer.cpf || '').replace(/\D/g, '') : '';
    const cleanActivePhone = activeCustomer ? String(activeCustomer.phone || '').replace(/\D/g, '') : '';

    const storeCustomer = activeCustomer ? (customers || []).find((c: any) =>
      c.id === activeCustomer.id ||
      (cleanActiveCpf && String(c.cpf || '').replace(/\D/g, '') === cleanActiveCpf)
    ) : null;

    const goal = Number(storeCustomer?.monthlyGoal ?? activeCustomer?.monthlyGoal ?? customMonthlyGoal ?? 1000) || 1000;

    const now = new Date();
    const currentYear = now.getFullYear();
    const currentMonth = now.getMonth();

    const seenOrderIds = new Set<string>();
    let calculatedSpent = 0;
    let monthOrderCount = 0;

    const allOrdersToScan = [...(orders || []), ...(customerOrders || [])];
    for (const o of allOrdersToScan) {
      if (!o || !o.id || seenOrderIds.has(o.id)) continue;
      if (o.status === 'cancelled') continue;
      const d = new Date(o.createdAt);
      if (isNaN(d.getTime()) || d.getFullYear() !== currentYear || d.getMonth() !== currentMonth) continue;

      const oCpf = String((o as any).customerCpf || '').replace(/\D/g, '');
      const oPhone = String(o.customerPhone || '').replace(/\D/g, '');

      const sessionPhone = String(customerPhone || '').replace(/\D/g, '');
      const sessionName = (customerName || '').trim().toLowerCase();

      const matchesCustomer = activeCustomer ? (
        (o as any).customerId === activeCustomer.id ||
        (cleanActiveCpf && oCpf === cleanActiveCpf) ||
        (cleanActivePhone.length >= 8 && oPhone === cleanActivePhone)
      ) : (
        (sessionPhone.length >= 8 && oPhone === sessionPhone) ||
        (sessionName && sessionName !== 'cliente' && String(o.customerName || '').trim().toLowerCase() === sessionName)
      );

      if (matchesCustomer) {
        seenOrderIds.add(o.id);
        calculatedSpent += Number(o.total) || 0;
        monthOrderCount++;
      }
    }

    const spent = Math.max(calculatedSpent, Number(activeCustomer?.currentMonthSpent || 0));
    const rawPct = goal > 0 ? (spent / goal) * 100 : 0;
    const pct = Math.min(100, Math.round(rawPct));
    const remaining = Math.max(0, goal - spent);

    return { goal, spent, pct, rawPct, remaining, orderCount: monthOrderCount };
  }, [activeCustomer, customers, orders, customerOrders, customMonthlyGoal]);

  const handleSaveMonthlyGoal = async () => {
    const numGoal = parseFloat(newGoalInput);
    if (isNaN(numGoal) || numGoal <= 0) {
      alert('Por favor, insira um valor de meta válido.');
      return;
    }

    safeStorage.setItem('balbec_custom_monthly_goal', String(numGoal));
    setCustomMonthlyGoal(numGoal);

    if (activeCustomer?.id) {
      const updatedCustomer = { ...activeCustomer, monthlyGoal: numGoal };
      setActiveCustomer(updatedCustomer);
      safeStorage.setItem('balbec_logged_customer', JSON.stringify(updatedCustomer));

      try {
        await fetch(`/api/db/customers/${activeCustomer.id}`, {
          method: 'PUT',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ monthlyGoal: numGoal })
        });
      } catch (e) {
        console.warn('Erro ao salvar meta no servidor:', e);
      }
    }

    setIsEditGoalModalOpen(false);
  };

  const renderMonthlyGoalCard = () => {
    const { goal, spent, pct, orderCount } = customerMonthlyGoalInfo;
    return (
      <div className="bg-white p-4 sm:p-5 rounded-3xl border border-stone-200/90 shadow-xs space-y-3 my-4 text-left">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2">
            <span className="text-lg">🎯</span>
            <span className="text-sm sm:text-base font-black text-stone-900 tracking-tight">
              META DO MÊS: {formatCurrency(goal)}
            </span>
          </div>
          <span className="bg-amber-100 text-amber-900 font-black text-xs px-2.5 py-1 rounded-lg border border-amber-300/60">
            {pct}%
          </span>
        </div>

        {/* Barra de Progresso em Laranja */}
        <div className="w-full bg-stone-100 h-3.5 rounded-full overflow-hidden p-0.5 border border-stone-200/60">
          <div
            className="bg-orange-500 h-full rounded-full transition-all duration-500"
            style={{ width: `${Math.max(0, Math.min(100, pct))}%` }}
          />
        </div>

        <div className="flex items-center justify-between text-xs sm:text-sm font-bold pt-0.5">
          <span className="text-stone-500">
            Comprado no mês: <strong className="text-stone-900">{formatCurrency(spent)}</strong>
          </span>
          <button
            type="button"
            onClick={() => {
              setNewGoalInput(String(goal));
              setIsEditGoalModalOpen(true);
            }}
            className="text-xs font-black text-red-600 hover:text-red-700 transition-colors cursor-pointer hover:underline"
          >
            Alterar Meta
          </button>
        </div>

        <div className="border-t border-stone-100 pt-2 flex items-center gap-1.5 text-xs sm:text-sm font-black text-stone-900">
          <span>Total: {orderCount} {orderCount === 1 ? 'pedido' : 'pedidos'}</span>
          <span className="text-stone-300">•</span>
          <span className="text-emerald-600">{formatCurrency(spent)}</span>
        </div>
      </div>
    );
  };

  const formatCpfCnpj = (value: string) => {
    const digits = value.replace(/\D/g, '').slice(0, 14);
    if (digits.length <= 11) {
      return digits
        .replace(/(\d{3})(\d)/, '$1.$2')
        .replace(/(\d{3})(\d)/, '$1.$2')
        .replace(/(\d{3})(\d{1,2})$/, '$1-$2');
    }
    return digits
      .replace(/^(\d{2})(\d)/, '$1.$2')
      .replace(/^(\d{2})\.(\d{3})(\d)/, '$1.$2.$3')
      .replace(/\.(\d{3})(\d)/, '.$1/$2')
      .replace(/(\d{4})(\d)/, '$1-$2');
  };

  const handleReorder = (order: any) => {
    if (order.items && order.items.length > 0) {
      setCart(order.items);
      setIsProfileModalOpen(false);
    }
  };

  const handleSaveAddress = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!activeCustomer?.id || isSavingAddress) return;

    setIsSavingAddress(true);
    setAddressSaveMsg(null);
    try {
      const payload = {
        ...addressFormData,
        id: isEditingAddress?.id || undefined,
        customerSnapshot: {
          name: activeCustomer.name,
          phone: activeCustomer.phone,
          cpf: activeCustomer.cpf,
          email: activeCustomer.email,
          source: activeCustomer.source,
          status: activeCustomer.status,
        },
      };

      const res = await fetch(`/api/db/customers/${encodeURIComponent(activeCustomer.id)}/addresses`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload)
      });
      const data = await res.json().catch(() => ({}));
      if (res.ok && data?.success && data?.address) {
        const saved = data.address as CustomerAddress;
        const effectiveCustId = data.resolvedCustomerId || activeCustomer.id;

        setCustomerAddresses(prev => {
          const exists = prev.some(a => a.id === saved.id);
          const updated = exists
            ? prev.map(a => (a.id === saved.id ? saved : (saved.isDefault ? { ...a, isDefault: false } : a)))
            : [saved, ...prev.map(a => (saved.isDefault ? { ...a, isDefault: false } : a))];
          safeStorage.setItem(`balbec_customer_addresses_${effectiveCustId}`, JSON.stringify(updated));
          if (effectiveCustId !== activeCustomer.id) {
            safeStorage.setItem(`balbec_customer_addresses_${activeCustomer.id}`, JSON.stringify(updated));
          }
          return updated;
        });

        if (saved.isDefault || customerAddresses.length === 0) {
          setDeliveryStreet(saved.street);
          setDeliveryNumber(saved.number);
          setDeliveryComplement(saved.complement || '');
          setDeliveryNeighborhood(saved.neighborhood);
          setDeliveryCep(saved.cep);
          setDeliveryReference(saved.reference || '');
          safeStorage.setItem('balbec_customer_street', saved.street);
          safeStorage.setItem('balbec_customer_number', saved.number);
          safeStorage.setItem('balbec_customer_complement', saved.complement || '');
          safeStorage.setItem('balbec_customer_neighborhood', saved.neighborhood);
          safeStorage.setItem('balbec_customer_cep', saved.cep);
          safeStorage.setItem('balbec_customer_reference', saved.reference || '');

          const updatedActiveCustomer = {
            ...activeCustomer,
            id: effectiveCustId,
            street: saved.street,
            number: saved.number,
            complement: saved.complement || '',
            neighborhood: saved.neighborhood,
            cep: saved.cep,
            address: `${saved.street}, ${saved.number}${saved.complement ? ` (${saved.complement})` : ''} - ${saved.neighborhood} - CEP: ${saved.cep}`,
          };
          setActiveCustomer(updatedActiveCustomer);
          safeStorage.setItem('balbec_logged_customer', JSON.stringify(updatedActiveCustomer));
        } else if (effectiveCustId !== activeCustomer.id) {
          const updatedActiveCustomer = { ...activeCustomer, id: effectiveCustId };
          setActiveCustomer(updatedActiveCustomer);
          safeStorage.setItem('balbec_logged_customer', JSON.stringify(updatedActiveCustomer));
        }

        setIsEditingAddress(null);
        setAddressFormData({
          alias: 'Casa',
          street: '',
          number: '',
          complement: '',
          neighborhood: '',
          cep: '',
          reference: '',
          isDefault: false
        });
        setAddressSaveMsg('Endereço salvo com sucesso!');
        setTimeout(() => setAddressSaveMsg(null), 3500);
      } else {
        alert(data?.error || 'Não foi possível salvar o endereço. Verifique os campos e tente novamente.');
      }
    } catch (err) {
      alert('Erro de conexão ao salvar o endereço. Tente novamente.');
    } finally {
      setIsSavingAddress(false);
    }
  };

  const handleDeleteAddress = async (id: string) => {
    if (!confirm('Deseja excluir este endereço?')) return;
    try {
      const res = await fetch(`/api/db/customers/addresses/${encodeURIComponent(id)}`, { method: 'DELETE' });
      if (res.ok) {
        setCustomerAddresses(prev => {
          const next = prev.filter(a => a.id !== id);
          if (activeCustomer?.id) {
            safeStorage.setItem(`balbec_customer_addresses_${activeCustomer.id}`, JSON.stringify(next));
          }
          return next;
        });
      }
    } catch (err) {}
  };
  const [authRegPassword, setAuthRegPassword] = useState('');
  const [authCep, setAuthCep] = useState('');
  const [authAddress, setAuthAddress] = useState('');
  const [authLoading, setAuthLoading] = useState(false);
  const [authError, setAuthError] = useState('');
  const [authSuccessMsg, setAuthSuccessMsg] = useState('');

  useEffect(() => {
    if (activeCustomer) {
      if (activeCustomer.name && !customerName) setCustomerName(activeCustomer.name);
      if (activeCustomer.phone && !customerPhone) setCustomerPhone(activeCustomer.phone);
      if (activeCustomer.email && !customerEmail) setCustomerEmail(activeCustomer.email);
      if (activeCustomer.cpf && !customerCpf) setCustomerCpf(activeCustomer.cpf);
      if (activeCustomer.street && !deliveryStreet) setDeliveryStreet(activeCustomer.street);
      if (activeCustomer.number && !deliveryNumber) setDeliveryNumber(activeCustomer.number);
      if (activeCustomer.complement && !deliveryComplement) setDeliveryComplement(activeCustomer.complement);
      if (activeCustomer.neighborhood && !deliveryNeighborhood) setDeliveryNeighborhood(activeCustomer.neighborhood);
      if (activeCustomer.cep && !deliveryCep) {
        setDeliveryCep(activeCustomer.cep);
        setCepValidStatus('valid');
        safeStorage.setItem('balbec_delivery_cep_verified', 'true');
      }
    }
  }, [activeCustomer]);

  // Se o cliente logado estiver no primeiro acesso com a senha padrão (5 primeiros dígitos), força o modal de troca
  useEffect(() => {
    if (activeCustomer) {
      const cleanCpfDigits = String(activeCustomer.cpf || '').replace(/\D/g, '');
      const first5 = cleanCpfDigits.slice(0, 5);
      const isInitialPass = Boolean(
        activeCustomer.mustChangePassword === true ||
        (!activeCustomer.passwordChangedAt && first5.length >= 5 && (activeCustomer.password === first5 || !activeCustomer.password))
      );
      if (isInitialPass) {
        setMustChangePasswordModal(true);
      }
    }
  }, [activeCustomer]);

  const handleCustomerLogin = async (e: React.FormEvent) => {
    e.preventDefault();
    if (activeCustomer) {
      setAuthError(`Você já está conectado como ${activeCustomer.name}. É necessário desconectar primeiro para trocar de usuário.`);
      return;
    }
    setAuthLoading(true);
    setAuthError('');
    setAuthSuccessMsg('');
    try {
      const res = await fetch('/api/db/customer-login', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ identifier: authIdentifier, password: authPassword })
      });
      const data = await res.json();
      if (res.ok && data.success) {
        const cleanCpfDigits = String(data.customer.cpf || authIdentifier || '').replace(/\D/g, '');
        const first5Cpf = cleanCpfDigits.slice(0, 5);
        const requiresPasswordChange = Boolean(
          data.mustChangePassword ||
          data.customer.mustChangePassword ||
          !data.customer.passwordChangedAt ||
          (first5Cpf.length >= 5 && (data.customer.password === first5Cpf || authPassword.trim() === first5Cpf))
        );

        const updatedCustomer = {
          ...data.customer,
          mustChangePassword: requiresPasswordChange
        };

        setActiveCustomer(updatedCustomer);
        safeStorage.setItem('balbec_logged_customer', JSON.stringify(updatedCustomer));
        safeStorage.setItem('balbec_customer_name', data.customer.name || '');
        safeStorage.setItem('balbec_customer_phone', data.customer.phone || '');
        safeStorage.setItem('balbec_customer_cpf', data.customer.cpf || '');
        safeStorage.setSession('selected_sales_channel', 'instore');
        setCustomerName(data.customer.name || '');
        setCustomerPhone(data.customer.phone || '');
        setCustomerCpf(data.customer.cpf || '');

        setIsAuthModalOpen(false);
        setAuthIdentifier('');
        setAuthPassword('');

        if (requiresPasswordChange) {
          setMustChangePasswordModal(true);
          setChangePassError('');
          setChangePassSuccess('');
          setNewCustPassword('');
          setConfirmCustPassword('');
        } else {
          setHasName(true);
          setHasChosenChannel(true);
          if (hasFrozenInCart) {
            updateOrderModalityPreference('frozen');
            if (storeInfo.deliveryScheduleEnabled) {
              if (!isDateAllowedForFrozenOrder(selectedScheduleDate)) {
                clearScheduleSelection();
              }
              setScheduleStepMode('pickup');
              setShowScheduleSelectionStep(true);
            }
          } else {
            clearScheduleSelection();
            updateOrderModalityPreference(null);
            setShowOrderTypeChoiceModal(true);
          }
        }
      } else {
        setAuthError(data.error || 'CNPJ/CPF ou senha inválidos.');
      }
    } catch (e) {
      setAuthError('Erro de conexão ao realizar login.');
    } finally {
      setAuthLoading(false);
    }
  };

  const handleCustomerChangePassword = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!activeCustomer) return;
    setChangePassLoading(true);
    setChangePassError('');
    setChangePassSuccess('');

    const cleanCpfDigits = String(activeCustomer.cpf || '').replace(/\D/g, '');
    const first5 = cleanCpfDigits.slice(0, 5);

    if (newCustPassword.trim().length < 5) {
      setChangePassError('A nova senha deve ter no mínimo 5 caracteres.');
      setChangePassLoading(false);
      return;
    }

    if (newCustPassword !== confirmCustPassword) {
      setChangePassError('A confirmação de senha não coincide com a nova senha digitada.');
      setChangePassLoading(false);
      return;
    }

    if (first5.length >= 5 && newCustPassword.trim() === first5) {
      setChangePassError(`A nova senha não pode ser os 5 primeiros dígitos do seu CNPJ ou CPF (${first5}). Escolha uma senha pessoal diferente.`);
      setChangePassLoading(false);
      return;
    }

    try {
      const res = await fetch('/api/db/customer-change-password', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          customerId: activeCustomer.id,
          identifier: activeCustomer.cpf,
          newPassword: newCustPassword.trim(),
          confirmPassword: confirmCustPassword.trim()
        })
      });
      const data = await res.json();
      if (res.ok && data.success) {
        const updatedCustomer = {
          ...activeCustomer,
          password: newCustPassword.trim(),
          mustChangePassword: false,
          passwordChangedAt: Date.now()
        };
        setActiveCustomer(updatedCustomer);
        safeStorage.setItem('balbec_logged_customer', JSON.stringify(updatedCustomer));
        setChangePassSuccess('Senha alterada com sucesso! Seu acesso está liberado.');
        setTimeout(() => {
          setMustChangePasswordModal(false);
          setNewCustPassword('');
          setConfirmCustPassword('');
          setHasName(true);
          setHasChosenChannel(true);
          if (hasFrozenInCart) {
            updateOrderModalityPreference('frozen');
            if (storeInfo.deliveryScheduleEnabled) {
              if (!isDateAllowedForFrozenOrder(selectedScheduleDate)) {
                clearScheduleSelection();
              }
              setScheduleStepMode('pickup');
              setShowScheduleSelectionStep(true);
            }
          } else {
            clearScheduleSelection();
            updateOrderModalityPreference(null);
            setShowOrderTypeChoiceModal(true);
          }
        }, 1200);
      } else {
        setChangePassError(data.error || 'Erro ao alterar a senha. Tente novamente.');
      }
    } catch (err: any) {
      setChangePassError('Erro de conexão ao alterar a senha. Tente novamente.');
    } finally {
      setChangePassLoading(false);
    }
  };

  const handleCustomerRegister = async (e: React.FormEvent) => {
    e.preventDefault();
    if (activeCustomer) {
      setAuthError(`Você já está conectado como ${activeCustomer.name}. É necessário desconectar primeiro para cadastrar outra conta.`);
      return;
    }
    setAuthLoading(true);
    setAuthError('');
    setAuthSuccessMsg('');
    try {
      const cleanCpf = authRegCpf.replace(/\D/g, '');
      if (cleanCpf.length < 11) {
        setAuthError('Informe um CNPJ ou CPF válido (mínimo 11 dígitos).');
        setAuthLoading(false);
        return;
      }
      const autoPassword = cleanCpf.slice(0, 5);
      const res = await fetch('/api/db/customer-register', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          name: authName,
          phone: authPhone,
          email: authRegEmail,
          cpf: authRegCpf,
          password: autoPassword,
          address: authAddress,
          cep: authCep,
          source: 'self_registration'
        })
      });
      const data = await res.json();
      if (res.ok && data.success) {
        setAuthSuccessMsg(
          data.message ||
          `Cadastro enviado com sucesso! Seu cadastro está PENDENTE de aprovação pelo Administrador. Sua senha de acesso será os 5 primeiros dígitos do seu CNPJ/CPF (${autoPassword}).`
        );
        setAuthName('');
        setAuthPhone('');
        setAuthRegEmail('');
        setAuthRegCpf('');
        setAuthAddress('');
        setAuthCep('');
        await fetchData();
      } else {
        setAuthError(data.error || 'Erro ao realizar cadastro.');
      }
    } catch (e) {
      setAuthError('Erro de conexão ao cadastrar.');
    } finally {
      setAuthLoading(false);
    }
  };


  const handleCustomerForgot = async (e: React.FormEvent) => {
    e.preventDefault();
    setAuthLoading(true);
    setAuthError('');
    setAuthSuccessMsg('');
    try {
      const res = await fetch('/api/db/customer-forgot', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ identifier: authIdentifier })
      });
      const data = await res.json();
      if (res.ok && data.success) {
        setAuthSuccessMsg(`✅ ${data.message || `Sua senha é: ${data.password}`}`);
        if (data.password) {
          setAuthPassword(data.password);
        }
      } else {
        setAuthError(data.error || 'Nenhum cadastro encontrado para este CNPJ ou CPF.');
      }
    } catch (e) {
      setAuthError('Erro de conexão.');
    } finally {
      setAuthLoading(false);
    }
  };

  const formatCep = (value: string) => {
    const numbers = value.replace(/\D/g, '').slice(0, 8);
    if (numbers.length > 5) {
      return `${numbers.slice(0, 5)}-${numbers.slice(5)}`;
    }
    return numbers;
  };

  const handleCepChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const formatted = formatCep(e.target.value);
    setDeliveryCep(formatted);
    if (cepValidStatus !== 'idle') {
      setCepValidStatus('idle');
      setCepErrorMessage('');
    }
    const clean = formatted.replace(/\D/g, '');
    if (clean.length === 8) {
      handleCheckCep(clean);
    }
  };

  const handleCheckCep = async (cepVal: string) => {
    const clean = cepVal.replace(/\D/g, '');
    if (clean.length < 8) {
      setCepValidStatus('invalid');
      setCepErrorMessage('Por favor, informe um CEP válido com 8 dígitos.');
      setDeliveryFee(0);
      return;
    }

    setCepValidStatus('checking');
    setIsCheckingDeliveryCep(true);
    try {
      const res = await fetch('/api/db/check-cep', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ cep: clean })
      });
      const data = await res.json();
      if (data.success && data.valid) {
        setCepValidStatus('valid');
        const newNeighborhood = data.neighborhood || '';
        const newStreet = data.street || '';
        
        setDeliveryNeighborhood(newNeighborhood);
        setDeliveryFee(data.fee);
        
        if (newStreet) {
          setDeliveryStreet(newStreet);
          safeStorage.setItem('balbec_customer_street', newStreet);
        }
        
        setCepErrorMessage('');
        safeStorage.setItem('balbec_customer_cep', clean);
        safeStorage.setItem('balbec_customer_neighborhood', newNeighborhood);
        safeStorage.setItem('balbec_delivery_fee', String(data.fee));
      } else {
        setCepValidStatus('invalid');
        setCepErrorMessage(data.message || 'INFELIZMENTE NÃO ATENDEMOS ESSA REGIÃO NO MOMENTO.');
        setDeliveryFee(0);
      }
    } catch (e) {
      setCepValidStatus('invalid');
      setCepErrorMessage('Erro ao consultar CEP. Verifique sua conexão.');
      setDeliveryFee(0);
    } finally {
      setIsCheckingDeliveryCep(false);
    }
  };
  
  // In-Store Security & Geolocation Validation State
  const [customerPinInput, setCustomerPinInput] = useState('');
  const [gpsStatus, setGpsStatus] = useState<'idle' | 'checking' | 'verified' | 'out_of_range' | 'denied'>('idle');
  const [gpsDistance, setGpsDistance] = useState<number | null>(null);
  const [gpsError, setGpsError] = useState<string | null>(null);

  const verifyInStoreGps = async (): Promise<boolean> => {
    if (!storeInfo.inStoreGpsValidation) {
      setGpsStatus('verified');
      return true;
    }
    
    setGpsStatus('checking');
    setGpsError(null);
    
    try {
      const position = await getCurrentPosition({ enableHighAccuracy: true, timeout: 12000 });
      const userLat = position.coords.latitude;
      const userLon = position.coords.longitude;
      const storeLat = storeInfo.inStoreLatitude ?? -19.7478;
      const storeLon = storeInfo.inStoreLongitude ?? -47.9392;
      const maxRadius = storeInfo.inStoreMaxRadiusMeters || 150;
      
      const dist = calculateDistanceMeters(userLat, userLon, storeLat, storeLon);
      setGpsDistance(dist);
      
      if (dist <= maxRadius) {
        setGpsStatus('verified');
        return true;
      } else {
        setGpsStatus('out_of_range');
        return false;
      }
    } catch (err: any) {
      console.error('Erro na geolocalização do cliente:', err);
      setGpsStatus('denied');
      setGpsError('Não foi possível obter sua localização via GPS. Verifique se o GPS está ativo e autorize o acesso no seu navegador.');
      return false;
    }
  };
  const [isBakeryLoading, setIsBakeryLoading] = useState(false);
  const [renderedCategoryCount, setRenderedCategoryCount] = useState(4);
  const [showFormSuccess, setShowFormSuccess] = useState(false);
  const [isMobile, setIsMobile] = useState(false);
  const [isCartOpen, setIsCartOpen] = useState(false);
  const [addonModal, setAddonModal] = useState<{ 
    isOpen: boolean; 
    product: any | null; 
    selectedAddons: any[]; 
    selectedFlavor: any | null;
    availableAddons: any[];
    availableFlavors: any[];
  }>({ 
    isOpen: false, 
    product: null, 
    selectedAddons: [], 
    selectedFlavor: null,
    availableAddons: [],
    availableFlavors: []
  });

  const [frozenModal, setFrozenModal] = useState<{
    isOpen: boolean;
    product: any;
    quantity: number;
    mode?: 'pronto' | 'congelado';
  }>({
    isOpen: false,
    product: null,
    quantity: 1,
    mode: 'pronto'
  });

  // Modal active group tab: 'pronto' | 'congelado' | null
  const [frozenModalActiveTab, setFrozenModalActiveTab] = useState<'pronto' | 'congelado' | null>(null);

  // 4 Quantidades de Preparo (todas iniciando rigorosamente em 0):
  // 1. Salgados Prontos (Normais):
  const [prontoFritoQty, setProntoFritoQty] = useState<number>(0);
  const [prontoCruQty, setProntoCruQty] = useState<number>(0);
  // 2. Salgados Congelados (Prazo até 48h):
  const [congeladoCruQty, setCongeladoCruQty] = useState<number>(0);
  const [congeladoFritoQty, setCongeladoFritoQty] = useState<number>(0);

  // Modal de Conflito de Carrinho / Modalidade (quando tenta misturar ou sair de congelados)
  const [cartConflictModal, setCartConflictModal] = useState<{
    isOpen: boolean;
    type: 'has_frozen_blocked_normal' | 'has_normal_blocked_frozen' | 'frozen_mode_blocked_normal';
    product?: any;
    qty?: number;
    isFrozenContext?: boolean;
    prepType?: string;
  }>({
    isOpen: false,
    type: 'has_frozen_blocked_normal'
  });

  const switchFromFrozenToNormalAndReschedule = useCallback(() => {
    setCart([]);
    safeStorage.removeItem('balbec_active_cart');
    setProntoFritoQty(0);
    setProntoCruQty(0);
    setCongeladoCruQty(0);
    setCongeladoFritoQty(0);
    setFrozenPrepChoices({});
    setFrozenPrepErrors({});
    setFrozenPaymentPlan(null);
    updateOrderModalityPreference('normal');
    clearScheduleSelection();
    setCartConflictModal(prev => ({ ...prev, isOpen: false }));
    setIsCartOpen(false);
    setIsCheckout(false);
    setScheduleStepMode('pickup');
    setShowScheduleSelectionStep(true);
  }, [clearScheduleSelection, updateOrderModalityPreference]);

  const openFrozenModal = (product: any, qty: number = 1, mode: 'pronto' | 'congelado' = 'pronto') => {
    // Buscar se já existem itens deste produto no carrinho ou no appendCart
    const sourceList = appendOrderTarget ? appendCart : cart;
    const cartItemsForProd = sourceList.filter(ci => ci.productId === product.id);
    const exProntoFrito = cartItemsForProd.filter(ci => ci.prepType === 'pronto_frito' || (!ci.isFrozen && !ci.prepType && !ci.addons?.some((a: any) => a.isFrozen || a.productId === 'prod_congelado'))).reduce((s, ci) => s + ci.quantity, 0);
    const exProntoCru = cartItemsForProd.filter(ci => ci.prepType === 'pronto_cru').reduce((s, ci) => s + ci.quantity, 0);
    const exCongeladoCru = cartItemsForProd.filter(ci => ci.prepType === 'congelado_cru' || (ci.isFrozen && !ci.prepType)).reduce((s, ci) => s + ci.quantity, 0);
    const exCongeladoFrito = cartItemsForProd.filter(ci => ci.prepType === 'congelado_frito').reduce((s, ci) => s + ci.quantity, 0);

    if (mode === 'congelado') {
      const minRequired = Number(product.minFrozenQuantity) > 1 ? Number(product.minFrozenQuantity) : 1;
      setProntoFritoQty(0);
      setProntoCruQty(0);
      if (exCongeladoCru > 0 || exCongeladoFrito > 0) {
        setCongeladoCruQty(exCongeladoCru);
        setCongeladoFritoQty(exCongeladoFrito);
      } else {
        setCongeladoCruQty(Math.max(minRequired, qty));
        setCongeladoFritoQty(0);
      }
      setFrozenModalActiveTab('congelado');
    } else {
      setProntoFritoQty(exProntoFrito > 0 ? exProntoFrito : 0);
      setProntoCruQty(exProntoCru > 0 ? exProntoCru : 0);
      setCongeladoCruQty(0);
      setCongeladoFritoQty(0);
      setFrozenModalActiveTab('pronto');
    }

    setFrozenModal({ isOpen: true, product, quantity: qty, mode });
  };
  
  const categoryRefs = useRef<{ [key: string]: HTMLDivElement | null }>({});
  const categoryBarRef = useRef<HTMLDivElement | null>(null);
  const categoryButtonRefs = useRef<{ [key: string]: HTMLButtonElement | null }>({});
  const isManualScrolling = useRef(false);
  const productsContainerRef = useRef<HTMLDivElement | null>(null);
  const containerRef = useRef<HTMLDivElement>(null);

  const scrollCategoryButtonToCenter = useCallback((categoryId: string) => {
    const container = categoryBarRef.current;
    const button = categoryButtonRefs.current[categoryId];
    if (container && button) {
      const containerWidth = container.clientWidth;
      const buttonLeft = button.offsetLeft;
      const buttonWidth = button.clientWidth;
      const targetScrollLeft = buttonLeft - (containerWidth / 2) + (buttonWidth / 2);
      container.scrollTo({
        left: Math.max(0, targetScrollLeft),
        behavior: 'smooth'
      });
    }
  }, []);

  const scrollToCategory = (categoryId: string) => {
    isManualScrolling.current = true;
    setActiveCategory(categoryId);
    setRenderedCategoryCount(999);
    scrollCategoryButtonToCenter(categoryId);

    // Permitir que o DOM monte a categoria caso ainda estivesse em carregamento progressivo
    setTimeout(() => {
      const container = productsContainerRef.current;
      const element = categoryRefs.current[categoryId];
      if (container && element) {
        const containerTop = container.getBoundingClientRect().top;
        const elementTop = element.getBoundingClientRect().top;
        const currentScrollTop = container.scrollTop;
        const targetScrollTop = currentScrollTop + (elementTop - containerTop) - 12;
        container.scrollTo({
          top: Math.max(0, targetScrollTop),
          behavior: 'smooth'
        });
      }
    }, 10);

    setTimeout(() => {
      isManualScrolling.current = false;
    }, 800);
  };

  // Carregamento progressivo ultrarrápido: monta as categorias iniciais imediatamente (<50ms)
  // e expande o restante suavemente, eliminando travamentos de layout no celular.
  useEffect(() => {
    const t1 = setTimeout(() => {
      setRenderedCategoryCount(16);
    }, 200);
    const t2 = setTimeout(() => {
      setRenderedCategoryCount(999);
    }, 600);
    return () => {
      clearTimeout(t1);
      clearTimeout(t2);
    };
  }, []);

  useEffect(() => {
    if (isInitialized) {
      setIsBakeryLoading(false);
    }
    const fallbackTimer = setTimeout(() => {
      setIsBakeryLoading(false);
    }, 2000);
    return () => clearTimeout(fallbackTimer);
  }, [isInitialized]);

  useEffect(() => {
    const checkMobile = () => setIsMobile(window.innerWidth < 768);
    checkMobile();
    window.addEventListener('resize', checkMobile);
    return () => window.removeEventListener('resize', checkMobile);
  }, []);

  useEffect(() => {
    if (Array.isArray(categories) && categories.length > 0 && !activeCategory) {
      const firstValidCategory = [...categories]
        .filter(c => c && c.id && typeof c.name === 'string')
        .filter(c => {
          const isExcluded = isExcludedCategory(c.name) || isAddonCategory(c.name);
          const isVisible = c.isVisible !== false;
          const matchesChannel = salesChannel === 'delivery'
            ? c.availableForDelivery !== false
            : salesChannel === 'kiosk'
              ? c.availableForKiosk !== false
              : c.availableInStore !== false;

      return !isExcluded && 
             isVisible && 
             matchesChannel &&
             Array.isArray(products) && 
             products.some(p => (p.categoryId === c.id || p.frozenCategoryId === c.id) && p.isActive && !p.isAddon && !p.isFlavor && !isAddonItem(p, categories));
        })
        .sort((a, b) => (a.name || '').localeCompare(b.name || '', 'pt-BR', { sensitivity: 'base' }))[0];
      if (firstValidCategory) {
        setActiveCategory(firstValidCategory.id);
      }
    }
  }, [categories, products, activeCategory, salesChannel]);

  const isAddonProduct = useCallback((p: any) => {
    return isAddonItem(p, categories);
  }, [categories]);

  // Final Filter Logic (Otimizado com busca O(1) e pré-processamento de strings)
  const filteredProducts = useMemo(() => {
    if (!Array.isArray(products) || products.length === 0) return [];
    
    const rawTerm = (searchTerm || '').trim();
    const term = rawTerm ? normalizeText(rawTerm) : '';
    const lowerTerm = rawTerm ? rawTerm.toLowerCase() : '';

    const catMap = new Map<string, any>();
    if (Array.isArray(categories)) {
      for (let i = 0; i < categories.length; i++) {
        const c = categories[i];
        if (c && c.id) catMap.set(c.id, c);
      }
    }

    return products.filter(p => {
      if (!p || !p.isActive || p.isFlavor) return false;

      // Ocultar produtos que são adicionais/opcionais da tela inicial (eles aparecem apenas ao clicar no lanche)
      if (isAddonItem(p, categories)) return false;

      if (term) {
        const normName = normalizeText(p.name || '');
        const expandedName = normalizeText(expandAbbreviations(p.name || ''));
        const normDesc = normalizeText(p.description || '');
        const expandedDesc = normalizeText(expandAbbreviations(p.description || ''));
        const rawCode = (p.externalId || '').toString().toLowerCase();

        const matchesSearch = 
          normName.includes(term) || 
          expandedName.includes(term) || 
          normDesc.includes(term) || 
          expandedDesc.includes(term) || 
          rawCode.includes(lowerTerm);

        if (!matchesSearch) return false;
      }

      if (shouldExcludeProduct(p, categories)) return false;

      const prodCat = (p.categoryId && p.categoryId !== 'none') ? catMap.get(p.categoryId) : undefined;
      const frozenCat = (p.frozenCategoryId && p.frozenCategoryId !== 'none') ? catMap.get(p.frozenCategoryId) : undefined;

      const checkCatChannel = (c: any) => {
        if (!c) return false;
        if (c.isVisible === false) return false;
        return salesChannel === 'delivery'
          ? c.availableForDelivery !== false
          : salesChannel === 'kiosk'
            ? c.availableForKiosk !== false
            : c.availableInStore !== false;
      };

      const hasValidPrimaryCat = Boolean(p.categoryId && p.categoryId !== 'none' && checkCatChannel(prodCat));
      const hasValidFrozenCat = Boolean(p.frozenCategoryId && p.frozenCategoryId !== 'none' && checkCatChannel(frozenCat));

      if (!hasValidPrimaryCat && !hasValidFrozenCat) return false;

      const matchesChannel = salesChannel === 'delivery'
        ? p.availableForDelivery !== false
        : salesChannel === 'kiosk'
          ? p.availableForKiosk !== false
          : p.availableInStore !== false;
      if (!matchesChannel) return false;

      if ((p as any).trackStock && ((p as any).stockQuantity ?? 0) <= 0) return false;

      return (p as any).isVisible !== false;
    });
  }, [products, searchTerm, categories, salesChannel]);

  // Agrupamento pré-calculado em um único passo O(N) para indexação instantânea no render
  const { productsByCategory, categoryCountMap } = useMemo(() => {
    const map: Record<string, typeof filteredProducts> = {};
    const counts: Record<string, number> = {};

    for (let i = 0; i < filteredProducts.length; i++) {
      const p = filteredProducts[i];
      const catId = p.categoryId;
      if (catId && catId !== 'none') {
        if (!map[catId]) {
          map[catId] = [];
        }
        map[catId].push(p);
      }

      const frozenCatId = p.frozenCategoryId;
      if (frozenCatId && frozenCatId !== 'none' && frozenCatId !== catId) {
        if (!map[frozenCatId]) {
          map[frozenCatId] = [];
        }
        map[frozenCatId].push(p);
      }
    }

    for (const catId in map) {
      map[catId].sort((a, b) => {
        const orderA = a.order ?? 0;
        const orderB = b.order ?? 0;
        if (orderA !== orderB) return orderA - orderB;
        return (a.name || '').localeCompare(b.name || '', 'pt-BR', { sensitivity: 'base' });
      });
      counts[catId] = map[catId].length;
    }

    return { productsByCategory: map, categoryCountMap: counts };
  }, [filteredProducts]);

  const availableCategories = useMemo(() => {
    return [...(Array.isArray(categories) ? categories : [])]
      .filter(c => c && c.id && typeof c.name === 'string')
      .filter(c => {
        const isExcluded = isExcludedCategory(c.name) || isAddonCategory(c.name);
        const isVisible = c.isVisible !== false;
        const matchesChannel = salesChannel === 'delivery'
          ? c.availableForDelivery !== false
          : salesChannel === 'kiosk'
            ? c.availableForKiosk !== false
            : c.availableInStore !== false;

        return !isExcluded && 
               isVisible && 
               matchesChannel &&
               Boolean(categoryCountMap[c.id]);
      })
      .sort((a, b) => {
        const orderA = a.order ?? 0;
        const orderB = b.order ?? 0;
        if (orderA !== orderB) return orderA - orderB;
        return (a.name || '').localeCompare(b.name || '', 'pt-BR', { sensitivity: 'base' });
      });
  }, [categories, categoryCountMap, salesChannel]);

  const displayedCategories = useMemo(() => {
    if (searchTerm.trim() !== '') {
      return availableCategories;
    }
    return availableCategories.slice(0, renderedCategoryCount);
  }, [availableCategories, searchTerm, renderedCategoryCount]);

  // Auto-select first category if active one is missing or disappears after channel change or search
  useEffect(() => {
    if (availableCategories.length > 0 && (!activeCategory || !availableCategories.some(c => c.id === activeCategory))) {
      setActiveCategory(availableCategories[0].id);
    }
  }, [availableCategories, activeCategory]);

  // Center active category button in mobile category bar when activeCategory changes
  useEffect(() => {
    if (activeCategory) {
      scrollCategoryButtonToCenter(activeCategory);
    }
  }, [activeCategory, scrollCategoryButtonToCenter]);

  // Scroll spy to update activeCategory as user scrolls products feed
  useEffect(() => {
    const container = productsContainerRef.current;
    if (!container) return;

    const handleScroll = () => {
      if (isManualScrolling.current) return;

      const containerTop = container.getBoundingClientRect().top;
      let currentCatId = '';

      for (const cat of availableCategories) {
        const el = categoryRefs.current[cat.id];
        if (el) {
          const rect = el.getBoundingClientRect();
          if (rect.top - containerTop <= 120) {
            currentCatId = cat.id;
          }
        }
      }

      if (currentCatId && currentCatId !== activeCategory) {
        setActiveCategory(currentCatId);
      }
    };

    container.addEventListener('scroll', handleScroll, { passive: true });
    return () => container.removeEventListener('scroll', handleScroll);
  }, [availableCategories, activeCategory]);

  const scroll = (direction: 'left' | 'right') => {
    if (containerRef.current) {
      const { scrollLeft, clientWidth } = containerRef.current;
      const scrollTo = direction === 'left' ? scrollLeft - clientWidth / 2 : scrollLeft + clientWidth / 2;
      containerRef.current.scrollTo({ left: scrollTo, behavior: 'smooth' });
    }
  };

  const addToCart = (product: any, addons: any[] = [], flavor: any = null, quantity: number = 1, prepType?: string, prepLabel?: string, bypassConflictCheck: boolean = false) => {
    const prodCategory = categories.find(c => c.id === product?.categoryId);
    const isFrozenChoice = Boolean(
      (prepType && prepType.startsWith('congelado')) ||
      (prepLabel && prepLabel.toLowerCase().includes('congelad')) ||
      (addons || []).some((a: any) => 
        a.isFrozen || 
        a.productId === 'prod_congelado' || 
        (a.name && a.name.toLowerCase().includes('congelad'))
      ) ||
      (!prepType && prodCategory && isCategoryFrozenModality(prodCategory))
    );

    // FLUXO DO MODO ACRÉSCIMO EM PEDIDO EXISTENTE:
    if (appendOrderTarget) {
      // Validação Estrita de Modalidade:
      // Se o pedido original é de congelados, só pode acrescentar congelados!
      if (targetOrderIsFrozen && !isFrozenChoice) {
        setModalidadeConflictModal({
          isOpen: true,
          productName: product.name,
          targetOrderIsFrozen: true,
          attemptedIsFrozen: false
        });
        return;
      }
      // Se o pedido original é de salgados prontos, só pode acrescentar prontos!
      if (!targetOrderIsFrozen && isFrozenChoice) {
        setModalidadeConflictModal({
          isOpen: true,
          productName: product.name,
          targetOrderIsFrozen: false,
          attemptedIsFrozen: true
        });
        return;
      }

      const prodCode = (product.externalId || product.code || '').toString().trim();
      const descWithCode = formatProductDescriptionWithCode(product.description, prodCode);

      const enrichedFlavor = flavor ? {
        ...flavor,
        externalId: flavor.externalId || flavor.code || (products.find(p => p.id === flavor.productId)?.externalId) || '',
        code: flavor.code || flavor.externalId || (products.find(p => p.id === flavor.productId)?.externalId) || ''
      } : null;

      const enrichedAddons = (addons || []).map((a: any) => ({
        ...a,
        externalId: a.externalId || a.code || (products.find(p => p.id === a.productId)?.externalId) || '',
        code: a.code || a.externalId || (products.find(p => p.id === a.productId)?.externalId) || '',
        isFrozen: a.isFrozen || a.productId === 'prod_congelado' || (a.name && a.name.toLowerCase().includes('congelad'))
      }));

      setAppendCart(prev => {
        const existing = prev.find(item => 
          item.productId === product.id && 
          (item.prepType || '') === (prepType || '') &&
          Boolean(item.isFrozen) === isFrozenChoice &&
          JSON.stringify(item.addons) === JSON.stringify(addons) &&
          JSON.stringify(item.flavor) === JSON.stringify(flavor)
        );
        if (existing) {
          return prev.map(item => 
            (item.productId === product.id && (item.prepType || '') === (prepType || '') && Boolean(item.isFrozen) === isFrozenChoice && JSON.stringify(item.addons) === JSON.stringify(addons) && JSON.stringify(item.flavor) === JSON.stringify(flavor))
              ? { ...item, quantity: item.quantity + quantity, isFrozen: isFrozenChoice, prepType: prepType || item.prepType, prepLabel: prepLabel || item.prepLabel } 
              : item
          );
        }

        return [...prev, { 
          productId: product.id, 
          externalId: prodCode, 
          code: prodCode, 
          name: product.name, 
          description: descWithCode, 
          price: product.price, 
          quantity: Math.max(1, quantity), 
          imageUrl: product.imageUrl, 
          isFrozen: isFrozenChoice,
          prepType,
          prepLabel,
          addons: enrichedAddons, 
          flavor: enrichedFlavor 
        }];
      });

      setProductQuantities(prev => {
        const next = { ...prev };
        delete next[product.id];
        delete next[`${product.id}_pronto`];
        delete next[`${product.id}_congelado`];
        return next;
      });

      const orderDisplayNum = `#${String(appendOrderTarget.id).slice(-4).padStart(4, '0')}`;
      setCartToastMessage(`"${product.name}" acrescentado ao Pedido ${orderDisplayNum}! ➕🛒`);
      setTimeout(() => setCartToastMessage(null), 3000);
      setAddonModal({ isOpen: false, product: null, selectedAddons: [], selectedFlavor: null, availableAddons: [], availableFlavors: [] });
      return;
    }

    // FLUXO NORMAL DO CARRINHO:
    if (!bypassConflictCheck) {
      if ((hasFrozenInCart || orderModalityPreference === 'frozen') && !isFrozenChoice) {
        setCartConflictModal({
          isOpen: true,
          type: hasFrozenInCart ? 'has_frozen_blocked_normal' : 'frozen_mode_blocked_normal',
          product,
          qty: quantity,
          isFrozenContext: false
        });
        return;
      }
      if (hasNormalInCart && isFrozenChoice) {
        setCartConflictModal({
          isOpen: true,
          type: 'has_normal_blocked_frozen',
          product,
          qty: quantity,
          isFrozenContext: true,
          prepType: (prepType === 'congelado_frito' ? 'congelado_frito' : 'congelado_cru')
        });
        return;
      }
    }

    if (isFrozenChoice) {
      updateOrderModalityPreference('frozen');
      if (storeInfo.deliveryScheduleEnabled && selectedScheduleTime && !isDateAllowedForFrozenOrder(selectedScheduleDate)) {
        clearScheduleSelection();
        setScheduleStepMode('pickup');
        setShowScheduleSelectionStep(true);
      }
    }

    setCart(prev => {
      const existing = prev.find(item => 
        item.productId === product.id && 
        (item.prepType || '') === (prepType || '') &&
        Boolean(item.isFrozen) === isFrozenChoice &&
        JSON.stringify(item.addons) === JSON.stringify(addons) &&
        JSON.stringify(item.flavor) === JSON.stringify(flavor)
      );
      if (existing) {
        return prev.map(item => 
          (item.productId === product.id && (item.prepType || '') === (prepType || '') && Boolean(item.isFrozen) === isFrozenChoice && JSON.stringify(item.addons) === JSON.stringify(addons) && JSON.stringify(item.flavor) === JSON.stringify(flavor))
            ? { ...item, quantity: item.quantity + quantity, isFrozen: isFrozenChoice, prepType: prepType || item.prepType, prepLabel: prepLabel || item.prepLabel } 
            : item
        );
      }
      const prodCode = (product.externalId || product.code || '').toString().trim();
      const descWithCode = formatProductDescriptionWithCode(product.description, prodCode);

      const enrichedFlavor = flavor ? {
        ...flavor,
        externalId: flavor.externalId || flavor.code || (products.find(p => p.id === flavor.productId)?.externalId) || '',
        code: flavor.code || flavor.externalId || (products.find(p => p.id === flavor.productId)?.externalId) || ''
      } : null;

      const enrichedAddons = (addons || []).map((a: any) => ({
        ...a,
        externalId: a.externalId || a.code || (products.find(p => p.id === a.productId)?.externalId) || '',
        code: a.code || a.externalId || (products.find(p => p.id === a.productId)?.externalId) || '',
        isFrozen: a.isFrozen || a.productId === 'prod_congelado' || (a.name && a.name.toLowerCase().includes('congelad'))
      }));

      return [...prev, { 
        productId: product.id, 
        externalId: prodCode, 
        code: prodCode, 
        name: product.name, 
        description: descWithCode, 
        price: product.price, 
        quantity: Math.max(1, quantity), 
        imageUrl: product.imageUrl, 
        isFrozen: isFrozenChoice,
        prepType,
        prepLabel,
        addons: enrichedAddons, 
        flavor: enrichedFlavor 
      }];
    });
    setProductQuantities(prev => {
      const next = { ...prev };
      delete next[product.id];
      delete next[`${product.id}_pronto`];
      delete next[`${product.id}_congelado`];
      return next;
    });
    setCartToastMessage(`"${product.name}" adicionado com sucesso! 🛒✨`);
    setTimeout(() => setCartToastMessage(null), 3000);
    setAddonModal({ isOpen: false, product: null, selectedAddons: [], selectedFlavor: null, availableAddons: [], availableFlavors: [] });
  };

  const initiateAddToCartWithQty = (
    product: any,
    qty: number = 1,
    isFrozenContext: boolean = false,
    bypassConflictCheck: boolean = false,
    selectedPrepType?: PrepChoiceType
  ) => {
    if (!hasChosenChannel) {
      setHasChosenChannel(true);
      safeStorage.setSession('selected_sales_channel', salesChannel || 'delivery');
    }

    if (!canBuy || isAddonProduct(product)) {
      return;
    }

    // 1. Verificação de conflito de modalidade no Modo Acréscimo:
    if (appendOrderTarget) {
      if (targetOrderIsFrozen !== isFrozenContext) {
        setModalidadeConflictModal({
          isOpen: true,
          productName: product.name,
          targetOrderIsFrozen: targetOrderIsFrozen,
          attemptedIsFrozen: isFrozenContext
        });
        return;
      }
    } else if (!bypassConflictCheck) {
      // 2. Verificação de conflito de modalidade no Carrinho Normal ou Preferência Congelado:
      if ((hasFrozenInCart || orderModalityPreference === 'frozen') && !isFrozenContext) {
        setCartConflictModal({
          isOpen: true,
          type: hasFrozenInCart ? 'has_frozen_blocked_normal' : 'frozen_mode_blocked_normal',
          product,
          qty,
          isFrozenContext: false,
          prepType: selectedPrepType
        });
        return;
      }
      if (hasNormalInCart && isFrozenContext) {
        setCartConflictModal({
          isOpen: true,
          type: 'has_normal_blocked_frozen',
          product,
          qty,
          isFrozenContext: true,
          prepType: selectedPrepType
        });
        return;
      }
    }

    if (isAddonProduct(product)) {
      return;
    }

    const category = categories.find(c => c.id === product.categoryId);
    const catName = normalizeText(category?.name || '');
    const prodName = normalizeText(product?.name || '');

    // Regra de Negócio BALBEC: Apenas lanches na chapa possuem adicionais!
    const isExplicitlyNonLanche = 
      prodName.includes('caldo') || 
      prodName.includes('sopa') || 
      prodName.includes('suco') || 
      prodName.includes('cafe') || 
      prodName.includes('refrigerante') || 
      prodName.includes('cerveja') || 
      prodName.includes('agua') || 
      prodName.includes('bolo') || 
      prodName.includes('pudim') || 
      prodName.includes('sorvete') || 
      prodName.includes('vitamina') ||
      prodName.includes('salgado') ||
      prodName.includes('coxinha') ||
      prodName.includes('esfirra') ||
      prodName.includes('torta') ||
      prodName.includes('pizza') ||
      prodName.includes('pastel') ||
      prodName.includes('pao de queijo') ||
      catName.includes('caldo') ||
      catName.includes('sopa') ||
      catName.includes('bebida') ||
      catName.includes('salgado') ||
      catName.includes('doce') ||
      catName.includes('confeitaria') ||
      catName.includes('mercearia') ||
      catName.includes('cigarro');

    const isChapaCategory = 
      product.categoryId === 'tesmosw' || 
      product.categoryId === '56fnn1f' ||
      catName.includes('especiais na chapa') || 
      catName.includes('tradicionais na chapa') ||
      catName.includes('lanches na chapa') ||
      catName.includes('na chapa');

    const isChapaProduct = 
      (catName.includes('lanche') || catName.includes('chapa')) && (
        prodName.includes('na chapa') ||
        prodName.includes('pao na chapa') ||
        prodName.includes('misto quente') ||
        prodName.includes('tostex') ||
        prodName.includes('bauru') ||
        prodName.includes('hamburguer') ||
        prodName.includes('sanduiche')
      );

    const isEligibleForAddons = !isExplicitlyNonLanche && (isChapaCategory || isChapaProduct);

    let availableAddons: any[] = [];
    if (isEligibleForAddons) {
      if (product.addonIds && product.addonIds.length > 0) {
        availableAddons = products.filter(p => {
          const cat = categories.find(c => c.id === p.categoryId);
          const isExcluded = cat && isExcludedCategory(cat.name);
          return p.isActive && product.addonIds.includes(p.id) && !isExcluded;
        });
      } else {
        availableAddons = products.filter(p => {
          const cat = categories.find(c => c.id === p.categoryId);
          const isExcluded = cat && isExcludedCategory(cat.name);
          return isAddonItem(p, categories) && p.isActive && !isExcluded;
        });
      }
    }

    let availableFlavors = [];
    if (product.flavorIds && product.flavorIds.length > 0) {
      availableFlavors = products.filter(p => {
        const category = categories.find(c => c.id === p.categoryId);
        const isExcluded = category && isExcludedCategory(category.name);
        return p.isActive && product.flavorIds.includes(p.id) && !isExcluded;
      });
    } else {
      const category = categories.find(c => c.id === product.categoryId);
      const isJuiceCategory = category && (
        category.name.toLowerCase().includes('suco') || 
        category.name.toLowerCase().includes('polpa')
      );
      if (isJuiceCategory) {
        availableFlavors = products.filter(p => {
          const cat = categories.find(c => c.id === p.categoryId);
          const isExcluded = cat && isExcludedCategory(cat.name);
          return p.isFlavor && p.isActive && !isExcluded;
        });
      }
    }

    if (availableFlavors.length > 0) {
      availableAddons = [];
    }

    if (availableAddons.length > 0 || availableFlavors.length > 0) {
      setAddonModal({ 
        isOpen: true, 
        product, 
        selectedAddons: [], 
        selectedFlavor: null,
        availableAddons,
        availableFlavors
      });
      return;
    }
    
    const minRequired = (isFrozenContext && Number(product.minFrozenQuantity) > 1) 
      ? Number(product.minFrozenQuantity) 
      : 1;
    const finalQty = Math.max(minRequired, qty);

    if (isFrozenContext) {
      const chosenPrepType = selectedPrepType;
      const chosenPrepLabel = chosenPrepType ? (getPrepChoiceLabel(chosenPrepType) || undefined) : undefined;
      const foundCong = products.find(p => p.id === 'prod_congelado');
      const pVal = foundCong && foundCong.price && foundCong.price < 2.0 ? Number(foundCong.price) : 0.30;
      const congeladoProd = foundCong || { id: 'prod_congelado', name: 'Salgado Congelado', price: pVal, externalId: '9999' };
      const isSalgado = isSalgadoProduct(product, categories) || isFrozenContext;
      const frozenAddons = isSalgado ? [{
        productId: congeladoProd.id,
        name: 'Acréscimo Congelado',
        price: pVal,
        externalId: (congeladoProd as any).externalId || '9999',
        isFrozen: true
      }] : [];
      addToCart(product, frozenAddons, null, finalQty, chosenPrepType, chosenPrepLabel, bypassConflictCheck);
    } else {
      const chosenPrepType = selectedPrepType;
      const chosenPrepLabel = chosenPrepType ? getPrepChoiceLabel(chosenPrepType) : undefined;
      addToCart(product, [], null, finalQty, chosenPrepType, chosenPrepLabel || undefined, bypassConflictCheck);
    }
  };

  const initiateAddToCart = (product: any) => {
    const prodCat = categories.find(c => c.id === product?.categoryId);
    const isFrozenCat = prodCat ? isCategoryFrozenModality(prodCat) : false;
    const minRequired = (isFrozenCat && Number(product.minFrozenQuantity) > 1) ? Number(product.minFrozenQuantity) : 1;
    initiateAddToCartWithQty(product, minRequired, isFrozenCat);
  };

  // Carrossel de Mais Vendidos calculado sobre o histórico real de pedidos + catálogo ativo
  const bestSellerEntries = useMemo<BestSellerEntry[]>(() => {
    if (!Array.isArray(products) || products.length === 0) return [];

    const catMap = new Map<string, Category>();
    if (Array.isArray(categories)) {
      for (const c of categories) {
        if (c && c.id) catMap.set(c.id, c);
      }
    }

    const soldByProductId: Record<string, number> = {};
    for (const o of (orders || [])) {
      if (!o || o.status === 'cancelled' || (o as any).status === 'canceled') continue;
      let orderItems: any[] = [];
      if (Array.isArray(o.items)) {
        orderItems = o.items;
      } else if (typeof (o as any).items === 'string' && (o as any).items.trim() !== '') {
        try {
          const parsed = JSON.parse((o as any).items);
          if (Array.isArray(parsed)) orderItems = parsed;
        } catch {
          orderItems = [];
        }
      }
      for (const it of orderItems) {
        if (!it || !it.productId) continue;
        const q = Math.max(1, Number(it.quantity) || 1);
        soldByProductId[it.productId] = (soldByProductId[it.productId] || 0) + q;
      }
    }

    const checkCatChannel = (c?: Category) => {
      if (!c || c.isVisible === false) return false;
      if (isExcludedCategory(c.name) || isAddonCategory(c.name)) return false;
      return salesChannel === 'delivery'
        ? c.availableForDelivery !== false
        : salesChannel === 'kiosk'
          ? c.availableForKiosk !== false
          : c.availableInStore !== false;
    };

    const entries: BestSellerEntry[] = [];
    for (const p of products) {
      if (!p || !p.isActive || p.isFlavor || (p as any).isVisible === false) continue;
      if (isAddonItem(p, categories) || shouldExcludeProduct(p, categories)) continue;
      if ((p as any).trackStock && ((p as any).stockQuantity ?? 0) <= 0) continue;

      const matchesChannel = salesChannel === 'delivery'
        ? p.availableForDelivery !== false
        : salesChannel === 'kiosk'
          ? p.availableForKiosk !== false
          : p.availableInStore !== false;
      if (!matchesChannel) continue;

      const prodCat = (p.categoryId && p.categoryId !== 'none') ? catMap.get(p.categoryId) : undefined;
      const frozenCat = (p.frozenCategoryId && p.frozenCategoryId !== 'none') ? catMap.get(p.frozenCategoryId) : undefined;

      const validProdCat = checkCatChannel(prodCat) ? prodCat : undefined;
      const validFrozenCat = checkCatChannel(frozenCat) ? frozenCat : undefined;
      const resolvedCat = validProdCat || validFrozenCat;
      if (!resolvedCat) continue;

      const isFrozenCategory = isCategoryFrozenModality(resolvedCat);
      entries.push({
        product: p,
        category: resolvedCat,
        soldCount: soldByProductId[p.id] || 0,
        isFrozenCategory,
      });
    }

    entries.sort((a, b) => {
      if (b.soldCount !== a.soldCount) return b.soldCount - a.soldCount;
      const ordA = a.product.order ?? 0;
      const ordB = b.product.order ?? 0;
      if (ordA !== ordB) return ordA - ordB;
      return (a.product.name || '').localeCompare(b.product.name || '', 'pt-BR', { sensitivity: 'base' });
    });

    return entries.slice(0, 10);
  }, [products, categories, orders, salesChannel]);

  const cartProductIds = useMemo(() => {
    return new Set(cart.map(i => i.productId));
  }, [cart]);

  const queuedProductIds = useMemo(() => {
    return new Set(queuedImpulseProducts.map(p => p.id));
  }, [queuedImpulseProducts]);

  const handleAddCarouselProductNormally = (product: Product, cat?: Category, forceNormal: boolean = false) => {
    const targetCat = cat || categories.find(c => c.id === product.categoryId);
    const isFrozenContext = forceNormal ? false : Boolean(targetCat && isCategoryFrozenModality(targetCat));
    const normCatName = normalizeText(targetCat?.name || '');
    const isBakedCategory = normCatName.includes('assad');
    const isFriedNormalCategory = !isFrozenContext && !isBakedCategory && (
      normCatName.includes('frit') ||
      (normCatName.includes('grande') && normCatName.includes('norma')) ||
      normCatName.includes('salgad')
    );
    const isPrepEnabled = isBakedCategory
      ? (isFrozenContext ? storeInfo.salgadoPrepAssadoCongeladoEnabled !== false : storeInfo.salgadoPrepAssadoEnabled !== false)
      : (isFrozenContext ? storeInfo.salgadoPrepFritoCongeladoEnabled !== false : (isFriedNormalCategory ? storeInfo.salgadoPrepFritoEnabled !== false : false));
    const needsPrep = isPrepEnabled && (isFrozenContext || isBakedCategory || isFriedNormalCategory) && !isAddonProduct(product) && canBuy;
    const minReq = isFrozenContext ? Math.max(1, Number(product.minFrozenQuantity) || 1) : 1;

    if (needsPrep) {
      openFrozenModal(product, minReq, isFrozenContext ? 'congelado' : 'pronto');
      return;
    }

    initiateAddToCartWithQty(product, minReq, isFrozenContext, forceNormal);
  };

  const processImpulseProducts = (prods: Product[], forceNormal: boolean = true) => {
    if (!prods || prods.length === 0) return;
    let openedModal = false;
    let addedSimpleCount = 0;

    for (const prod of prods) {
      const targetCat = categories.find(c => c.id === prod.categoryId);
      const isFrozenContext = forceNormal ? false : Boolean(targetCat && isCategoryFrozenModality(targetCat));
      const normCatName = normalizeText(targetCat?.name || '');
      const isBakedCategory = normCatName.includes('assad');
      const isFriedNormalCategory = !isFrozenContext && !isBakedCategory && (
        normCatName.includes('frit') ||
        (normCatName.includes('grande') && normCatName.includes('norma')) ||
        normCatName.includes('salgad')
      );
      const isPrepEnabled = isBakedCategory
        ? (isFrozenContext ? storeInfo.salgadoPrepAssadoCongeladoEnabled !== false : storeInfo.salgadoPrepAssadoEnabled !== false)
        : (isFrozenContext ? storeInfo.salgadoPrepFritoCongeladoEnabled !== false : (isFriedNormalCategory ? storeInfo.salgadoPrepFritoEnabled !== false : false));
      const needsPrep = isPrepEnabled && (isFrozenContext || isBakedCategory || isFriedNormalCategory) && !isAddonProduct(prod) && canBuy;

      if (needsPrep) {
        if (!openedModal) {
          openedModal = true;
          openFrozenModal(prod, isFrozenContext ? Math.max(1, Number(prod.minFrozenQuantity) || 1) : 1, isFrozenContext ? 'congelado' : 'pronto');
        }
        continue;
      }

      const catName = normalizeText(targetCat?.name || '');
      const prodName = normalizeText(prod.name || '');
      const isExplicitlyNonLanche =
        prodName.includes('caldo') || prodName.includes('sopa') || prodName.includes('suco') ||
        prodName.includes('cafe') || prodName.includes('refrigerante') || prodName.includes('cerveja') ||
        prodName.includes('agua') || prodName.includes('bolo') || prodName.includes('pudim') ||
        prodName.includes('sorvete') || prodName.includes('vitamina') || prodName.includes('salgado') ||
        prodName.includes('coxinha') || prodName.includes('esfirra') || prodName.includes('torta') ||
        prodName.includes('pizza') || prodName.includes('pastel') || prodName.includes('pao de queijo') ||
        catName.includes('caldo') || catName.includes('sopa') || catName.includes('bebida') ||
        catName.includes('salgado') || catName.includes('doce') || catName.includes('confeitaria') ||
        catName.includes('mercearia') || catName.includes('cigarro');
      const isChapaCategory =
        prod.categoryId === 'tesmosw' || prod.categoryId === '56fnn1f' ||
        catName.includes('especiais na chapa') || catName.includes('tradicionais na chapa') ||
        catName.includes('lanches na chapa') || catName.includes('na chapa');
      const isChapaProduct =
        (catName.includes('lanche') || catName.includes('chapa')) && (
          prodName.includes('na chapa') || prodName.includes('pao na chapa') ||
          prodName.includes('misto quente') || prodName.includes('tostex') ||
          prodName.includes('bauru') || prodName.includes('hamburguer') || prodName.includes('sanduiche')
        );
      const hasCustomOptions = Boolean(
        (!isExplicitlyNonLanche && (isChapaCategory || isChapaProduct)) ||
        (prod.flavorIds && prod.flavorIds.length > 0) ||
        catName.includes('suco') ||
        catName.includes('polpa')
      );

      if (hasCustomOptions) {
        if (openedModal) continue;
        openedModal = true;
      } else {
        addedSimpleCount += 1;
      }

      initiateAddToCartWithQty(
        prod,
        isFrozenContext ? Math.max(1, Number(prod.minFrozenQuantity) || 1) : 1,
        isFrozenContext,
        forceNormal
      );
    }

    if (addedSimpleCount > 0 && !openedModal) {
      setIsCartOpen(true);
    }
  };

  const handleSelectBestSeller = (entry: BestSellerEntry) => {
    const isFrozenActive = !appendOrderTarget && (orderModalityPreference === 'frozen' || hasFrozenInCart);
    if (isFrozenActive && !entry.isFrozenCategory) {
      setImpulseFrozenModal({ isOpen: true, entry });
      return;
    }
    handleAddCarouselProductNormally(entry.product, entry.category);
  };

  const switchFromFrozenToNormalAndAddImpulse = (product: Product) => {
    setCart([]);
    safeStorage.removeItem('balbec_active_cart');
    setFrozenPrepChoices({});
    setFrozenPrepErrors({});
    setFrozenPaymentPlan(null);
    updateOrderModalityPreference('normal');
    clearScheduleSelection();
    setImpulseFrozenModal({ isOpen: false, entry: null });
    setIsCartOpen(false);
    setIsCheckout(false);

    if (storeInfo.deliveryScheduleEnabled) {
      setPendingImpulseProducts([product]);
      setScheduleStepMode('pickup');
      setShowScheduleSelectionStep(true);
    } else {
      handleAddCarouselProductNormally(product, undefined, true);
    }
  };

  const startNewOrderWithImpulseProducts = (prods: Product[]) => {
    const uniqueProds: Product[] = [];
    const seen = new Set<string>();
    for (const p of prods) {
      if (p && p.id && !seen.has(p.id)) {
        seen.add(p.id);
        uniqueProds.push(p);
      }
    }

    updateQueuedImpulseProducts([]);
    setImpulseFrozenModal({ isOpen: false, entry: null });
    setIsSuccess(false);
    setIsCheckout(false);
    setOnlinePaymentData(null);
    setLastPlacedOrder(null);
    setFrozenPaymentPlan(null);
    setPaymentMode(null);
    setPaymentMethod('');
    setCart([]);
    safeStorage.removeItem('balbec_active_cart');
    setIsCartOpen(false);
    updateOrderModalityPreference('normal');
    clearScheduleSelection();
    setHasName(true);
    setHasChosenChannel(true);

    if (storeInfo.deliveryScheduleEnabled) {
      setPendingImpulseProducts(uniqueProds);
      setScheduleStepMode('pickup');
      setShowScheduleSelectionStep(true);
    } else {
      setTimeout(() => {
        processImpulseProducts(uniqueProds, true);
      }, 60);
    }
  };

  const updateQuantity = (productId: string, addons: any[] | undefined, flavor: any | undefined, delta: number, prepType?: string) => {
    setCart(prev => prev.map(item => {
      if (item.productId === productId && (item.prepType || '') === (prepType || '') && JSON.stringify(item.addons) === JSON.stringify(addons) && JSON.stringify(item.flavor) === JSON.stringify(flavor)) {
        const newQuantity = Math.max(0, item.quantity + delta);
        return { ...item, quantity: newQuantity };
      }
      return item;
    }).filter(item => item.quantity > 0));
    setProductQuantities(prev => {
      if (
        prev[productId] === undefined &&
        prev[`${productId}_pronto`] === undefined &&
        prev[`${productId}_congelado`] === undefined
      ) {
        return prev;
      }
      const next = { ...prev };
      delete next[productId];
      delete next[`${productId}_pronto`];
      delete next[`${productId}_congelado`];
      return next;
    });
  };

  const subtotal = cart.reduce((sum, item) => {
    const addonsTotal = item.addons?.reduce((addonSum, addon) => addonSum + addon.price, 0) || 0;
    const flavorTotal = item.flavor?.price || 0;
    return sum + ((item.price + flavorTotal + addonsTotal) * item.quantity);
  }, 0);

  const isKioskMode = salesChannel === 'kiosk' || isTotemPath;
  const isTableOrder = Boolean((salesChannel === 'instore' || deliveryType === 'pickup') && selectedTableNumber !== null);
  // Delivery desabilitado: operação exclusivamente voltada para Retirada no Balcão
  const isDeliveryOrder = false;
  const showDeliveryFeatures = !isTotemPath && selectedTableNumber === null;

  const currentDeliveryFee = 0;
  const total = subtotal;
  const partialFrozenAmount = Number((total * 0.5).toFixed(2));
  const remainingFrozenAmount = Number((total - partialFrozenAmount).toFixed(2));

  useEffect(() => {
    if (!hasFrozenInCart) {
      setFrozenPaymentPlan(null);
    }
  }, [hasFrozenInCart]);

  // Validação de CEP para Delivery (Desabilitado)
  const isCustomerWithSavedAddress = Boolean(activeCustomer?.address || customerAddresses.length > 0);
  const isCepVerified = true;
  const requireCepStep = false;

  // Adiciona ao carrinho o produto pendente assim que a identificação e canal/CEP forem concluídos
  useEffect(() => {
    if (pendingAddToCart && (activeCustomer || hasName) && hasChosenChannel && !requireCepStep) {
      const item = pendingAddToCart;
      setPendingAddToCart(null);
      initiateAddToCart(item);
    }
  }, [pendingAddToCart, activeCustomer, hasName, hasChosenChannel, requireCepStep]);

  // Polling automático para confirmação do Pix online
  useEffect(() => {
    if (!activePixPayment) return;

    const interval = setInterval(async () => {
      try {
        const res = await fetch(`/api/mercadopago/check-status/${activePixPayment.paymentId}`);
        const data = await res.json();
        if (data && data.approved) {
          clearInterval(interval);
          const pixLabel = activePixPayment.isPartialPayment
            ? `Pix (Online - 50% Entrada: ${formatCurrency(activePixPayment.amount)} | Saldo na Retirada: ${formatCurrency(activePixPayment.remainingAmount || 0)})`
            : 'Pix (Online)';
          handlePaymentApproved(pixLabel, activePixPayment.paymentId, activePixPayment.isPartialPayment ? {
            plan: 'parcial',
            paidAmount: activePixPayment.amount,
            remainingAmount: activePixPayment.remainingAmount || 0
          } : (hasFrozenInCart ? { plan: 'integral', paidAmount: activePixPayment.amount, remainingAmount: 0 } : undefined));
        }
      } catch (err) {
        console.warn('Erro ao verificar status do Pix:', err);
      }
    }, 3500);

    const timer = setInterval(() => {
      setPixTimeRemaining(prev => {
        if (prev <= 1) {
          clearInterval(interval);
          clearInterval(timer);
          alert('Tempo limite para o pagamento Pix expirou. Por favor, gere um novo pedido.');
          setActivePixPayment(null);
          return 0;
        }
        return prev - 1;
      });
    }, 1000);

    return () => {
      clearInterval(interval);
      clearInterval(timer);
    };
  }, [activePixPayment, hasFrozenInCart]);

  const handleCheckPixManual = async () => {
    if (!activePixPayment || isVerifyingPix) return;
    setIsVerifyingPix(true);
    const pixLabel = activePixPayment.isPartialPayment
      ? `Pix (Online - 50% Entrada: ${formatCurrency(activePixPayment.amount)} | Saldo na Retirada: ${formatCurrency(activePixPayment.remainingAmount || 0)})`
      : 'Pix (Online)';
    const pixDetails = activePixPayment.isPartialPayment
      ? {
          plan: 'parcial' as const,
          paidAmount: activePixPayment.amount,
          remainingAmount: activePixPayment.remainingAmount || 0
        }
      : (hasFrozenInCart ? { plan: 'integral' as const, paidAmount: activePixPayment.amount, remainingAmount: 0 } : undefined);
    try {
      const checkRes = await fetch(`/api/mercadopago/check-status/${activePixPayment.paymentId}`);
      const checkData = await checkRes.json();
      if (checkData && checkData.approved) {
        handlePaymentApproved(pixLabel, activePixPayment.paymentId, pixDetails);
        return;
      }

      const confRes = await fetch(`/api/mercadopago/confirm-pix/${activePixPayment.paymentId}`, {
        method: 'POST'
      });
      const confData = await confRes.json();
      if (confData && confData.approved) {
        handlePaymentApproved(pixLabel, activePixPayment.paymentId, pixDetails);
      } else {
        alert('Aguardando compensação do Pix pelo sistema bancário. Se você já transferiu, aguarde alguns instantes que a confirmação é automática.');
      }
    } catch {
      alert('Erro ao verificar status do pagamento. Tente novamente.');
    } finally {
      setIsVerifyingPix(false);
    }
  };

  const handlePaymentApproved = async (
    method: string,
    paymentId?: string,
    paymentDetails?: { plan?: 'integral' | 'parcial'; paidAmount?: number; remainingAmount?: number }
  ) => {
    setActivePixPayment(null);
    setActiveCardPayment(null);
    await executeFinalOrderPlacement(method, paymentId, 'approved', paymentDetails);
  };

  const handleProcessCardPayment = async () => {
    if (!activeCardPayment) return;
    const cleanNum = cardFormData.number.replace(/\D/g, '');
    if (cleanNum.length < 13 || cleanNum.length > 19) {
      setCardPaymentError('Número do cartão inválido. Por favor, preencha todos os dígitos.');
      return;
    }
    if (!cardFormData.holderName.trim()) {
      setCardPaymentError('Nome do titular é obrigatório como impresso no cartão.');
      return;
    }
    const cleanExpiry = cardFormData.expiry.replace(/\D/g, '');
    if (cleanExpiry.length !== 4) {
      setCardPaymentError('Data de validade inválida. Preencha com 4 números (MM/AA).');
      return;
    }
    const month = cleanExpiry.slice(0, 2);
    const year = cleanExpiry.slice(2, 4);
    const cleanCvv = cardFormData.cvv.replace(/\D/g, '');
    if (cleanCvv.length < 3 || cleanCvv.length > 4) {
      setCardPaymentError('Código de segurança (CVV) inválido.');
      return;
    }

    setIsProcessingCard(true);
    setCardPaymentError(null);

    try {
      const res = await fetch('/api/mercadopago/process-card', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          amount: activeCardPayment.amount,
          cardType: activeCardPayment.type,
          card: {
            number: cleanNum,
            holderName: cardFormData.holderName.trim(),
            expiryMonth: month,
            expiryYear: year,
            cvv: cleanCvv,
            cpf: cardFormData.cpf.replace(/\D/g, '') || customerCpf.replace(/\D/g, ''),
            installments: cardFormData.installments
          },
          payer: {
            name: customerName,
            email: customerEmail,
            phone: customerPhone,
            cpf: customerCpf
          }
        })
      });
      const data = await res.json();
      if (!data.success || data.status === 'rejected') {
        setCardPaymentError(data.message || 'Cartão recusado pela operadora. Verifique os dados ou tente outro cartão.');
        setIsProcessingCard(false);
        return;
      }

      const brandName = data.cardBrand || detectCardBrand(cleanNum);
      const baseMethodName = activeCardPayment.type === 'credit'
        ? `Cartão de Crédito (Online - ${brandName})`
        : `Cartão de Débito (Online - ${brandName})`;
      const methodName = activeCardPayment.isPartialPayment
        ? `Cartão de Débito (Online - ${brandName} | 50% Entrada: ${formatCurrency(activeCardPayment.amount)} • Saldo na Retirada: ${formatCurrency(activeCardPayment.remainingAmount || 0)})`
        : baseMethodName;
      const cardDetails = activeCardPayment.isPartialPayment
        ? {
            plan: 'parcial' as const,
            paidAmount: activeCardPayment.amount,
            remainingAmount: activeCardPayment.remainingAmount || 0
          }
        : (hasFrozenInCart ? { plan: 'integral' as const, paidAmount: activeCardPayment.amount, remainingAmount: 0 } : undefined);

      setActiveCardPayment(null);
      setIsProcessingCard(false);
      await executeFinalOrderPlacement(methodName, data.paymentId, 'approved', cardDetails);
    } catch (err: any) {
      setCardPaymentError('Falha ao processar pagamento com o cartão. Tente novamente.');
      setIsProcessingCard(false);
    }
  };

  const executeFinalOrderPlacement = async (
    confirmedPaymentMethod: string,
    confirmedPaymentId?: string,
    confirmedPaymentStatus: 'approved' | 'pending' = 'approved',
    paymentDetails?: { plan?: 'integral' | 'parcial'; paidAmount?: number; remainingAmount?: number }
  ) => {
    setIsSendingOrder(true);
    
    // Obter o nome de identificação do cliente para imprimir no cupom
    const savedCustomerName = safeStorage.getItem('balbec_customer_name') || '';
    const finalCustomerName = isKioskMode 
      ? '' 
      : (customerName.trim() || savedCustomerName.trim() || 'Cliente');

    const savedCustomerPhone = safeStorage.getItem('balbec_customer_phone') || '';
    const finalCustomerPhone = isKioskMode 
      ? '' 
      : (customerPhone.trim() || savedCustomerPhone.trim());

    const fullAddress = undefined;

    try {
      const isTotemOrDineIn = isKioskMode || isTableOrder;
      const hasFrozenInOrder = cart.some(it => 
        Boolean(it.isFrozen) || 
        (Array.isArray(it.addons) && it.addons.some((a: any) => a.isFrozen || a.productId === 'prod_congelado' || (a.name && a.name.toLowerCase().includes('congelad')))) ||
        (it.options && Array.isArray(it.options) && it.options.some((o: any) => o.isFrozen || (o.name && o.name.toLowerCase().includes('congelad'))))
      );
      const normalPrepMins = Number(storeInfo.schedulePrepTimeNormalMinutes) || 40;
      const frozenPrepMins = Number(storeInfo.schedulePrepTimeFrozenMinutes) || 90;
      const computedPickup = selectedScheduleTime 
        ? calculatePickupTime(selectedScheduleTime, hasFrozenInOrder, normalPrepMins, frozenPrepMins) 
        : '';
      const formattedScheduledTime = selectedScheduleTime 
        ? (computedPickup ? `${selectedScheduleTime} (Retirada às ${computedPickup})` : selectedScheduleTime) 
        : undefined;

      const createdOrder = await placeOrder({
        items: cart,
        total,
        status: isTotemOrDineIn ? 'completed' : 'pending',
        deliveryStatus: isTotemOrDineIn ? 'delivered' : 'pending',
        type: isKioskMode ? 'kiosk' : (isTableOrder ? 'dine_in' : 'online'),
        paymentMethod: isKioskMode ? 'Balcão' : (isTableOrder ? 'No Caixa / Na Saída' : confirmedPaymentMethod),
        paymentStatus: confirmedPaymentStatus,
        paymentId: confirmedPaymentId,
        customerName: finalCustomerName,
        customerPhone: finalCustomerPhone,
        customerId: activeCustomer?.id,
        customerEmail: activeCustomer?.email || customerEmail.trim(),
        customerCpf: activeCustomer?.cpf || customerCpf.trim(),
        deliveryType: isTotemOrDineIn ? 'dine_in' : 'pickup',
        deliveryAddress: fullAddress,
        deliveryCep: undefined,
        deliveryNeighborhood: undefined,
        deliveryFee: 0,
        tableNumber: isTableOrder ? String(selectedTableNumber) : undefined,
        tableId: isTableOrder ? `table-${selectedTableNumber}` : undefined,
        scheduledTime: formattedScheduledTime,
        scheduledDate: selectedScheduleDate || undefined,
        scheduledDay: selectedScheduleDay || undefined,
        hasFrozenItems: hasFrozenInOrder,
        isFrozen: hasFrozenInOrder,
        paymentPlan: paymentDetails?.plan,
        paidAmount: paymentDetails?.paidAmount,
        remainingAmount: paymentDetails?.remainingAmount,
        paymentConfirmedByOperator:
          !isTotemOrDineIn &&
          (paymentDetails?.plan === 'parcial' ||
            confirmedPaymentStatus === 'approved' ||
            confirmedPaymentMethod.toLowerCase().includes('online') ||
            confirmedPaymentMethod.toLowerCase().includes('pix mp'))
            ? false
            : undefined,
      });

      if (createdOrder) {
        setLastPlacedOrder(createdOrder);
        setCustomerOrders(prev => [createdOrder, ...prev]);
        setCart([]);
        setFrozenPaymentPlan(null);
        setPaymentMode(null);
        setPaymentMethod('');
        safeStorage.removeItem('balbec_active_cart');
        safeStorage.removeItem('balbec_selected_schedule_time');
        safeStorage.removeItem('balbec_selected_schedule_date');
        safeStorage.removeItem('balbec_selected_schedule_day');
        setSelectedScheduleTime('');
        setSelectedScheduleDate('');
        setSelectedScheduleDay('');
        updateOrderModalityPreference(null);

        // Persistir dados do cliente e último pedido para notificações em tempo real
        safeStorage.setItem('balbec_last_order_id', String(createdOrder.id));
        safeStorage.setItem('balbec_customer_name', finalCustomerName);
        safeStorage.setItem('balbec_customer_phone', finalCustomerPhone);
        safeStorage.setItem('balbec_last_order_id', String(createdOrder.id));
        try {
          localStorage.setItem('balbec_last_order_id', String(createdOrder.id));
          localStorage.setItem('balbec_customer_name', finalCustomerName);
          localStorage.setItem('balbec_customer_phone', finalCustomerPhone);

          const rawRecent = safeStorage.getItem('balbec_recent_order_ids') || localStorage.getItem('balbec_recent_order_ids');
          const recentList: string[] = rawRecent ? JSON.parse(rawRecent) : [];
          if (!recentList.includes(String(createdOrder.id))) {
            recentList.unshift(String(createdOrder.id));
            const trimmedList = recentList.slice(0, 10);
            safeStorage.setItem('balbec_recent_order_ids', JSON.stringify(trimmedList));
            localStorage.setItem('balbec_recent_order_ids', JSON.stringify(trimmedList));
          }
        } catch {}

        // OPÇÃO A: Disparo automático de impressão na impressora térmica da loja (via TCP Socket de Rede)
        if (isTotemOrDineIn && (createdOrder.status === 'completed' || isKioskMode)) {
          try {
            const netConfig = getNetworkPrinterConfig(storeInfo);
            if (netConfig.ip) {
              console.log(`[Opção A] Disparando impressão direta para impressora de rede (${netConfig.ip}) com o Pedido #${createdOrder.id} e Cliente: ${createdOrder.customerName}...`);
              printViaNetworkIp(createdOrder, storeInfo).then(result => {
                if (result.success) {
                  console.log('[Opção A] Pedido impresso com sucesso na impressora térmica da loja:', result.message);
                } else {
                  console.log('[Opção A] Status de envio para impressora de rede:', result.message);
                }
              }).catch(printErr => {
                console.warn('[Opção A] Erro ao chamar impressão de rede:', printErr);
              });
            }
          } catch (netErr) {
            console.warn('Erro ao processar impressão direta via rede:', netErr);
          }
        }

        // Notificação e impressão do Totem são processadas em segundo plano (via IP de Rede / Agente de Impressão) sem abrir caixa de diálogo nativa do navegador.

        // Enviar notificação de Novo Pedido no NTFY
        try {
          const safeOrderItems = Array.isArray(createdOrder.items) ? createdOrder.items : [];
          const itemsSummary = safeOrderItems.map(it => `${it.quantity}x ${it.name}`).join(', ');
          const typeLabel = isTableOrder 
            ? `🍽️ Consumo no Local (Mesa ${selectedTableNumber})` 
            : '🥡 Retirada/Balcão';

          sendNtfyNotification({
            enabled: storeInfo.ntfyEnabled !== false,
            topic: storeInfo.ntfyTopic || 'balbecrevenda_pedidos',
            title: `🔔 Novo Pedido #${String(createdOrder.id).slice(-4).padStart(4, '0')}${isTableOrder ? ` (Mesa ${selectedTableNumber})` : isKioskMode ? ' (Totem - Entregue)' : (createdOrder.customerName ? ` (${createdOrder.customerName})` : '')}`,
            message: `Total: ${formatCurrency(createdOrder.total)}\nItens: ${itemsSummary}\nPagamento: ${createdOrder.paymentMethod}\nTipo: ${typeLabel}${isKioskMode ? '\nStatus: Entregue (Totem Autoatendimento)' : ''}`,
            priority: 5,
            tags: ['bell', 'shopping_cart', 'moneybag']
          }).catch(e => console.warn('[NTFY] Order error:', e));
        } catch (ntfyOrderErr) {
          console.warn('[NTFY] Order alert error:', ntfyOrderErr);
        }
      }

      setIsSuccess(true);
      setCart([]);
      setActivePixPayment(null);
      setActiveCardPayment(null);
      try {
        window.scrollTo({ top: 0, behavior: 'smooth' });
      } catch {}
    } catch (error) {
      console.error('Erro ao finalizar pedido:', error);
      alert('Ocorreu um erro ao enviar seu pedido. Por favor, tente novamente.');
    } finally {
      setIsSendingOrder(false);
    }
  };

  const handleCheckout = async () => {
    if (cart.length === 0) return;
    
    if (!currentStatus.isOpenNow || !canBuy) {
      if ((salesChannel === 'kiosk' || salesChannel === 'instore') && !currentStatus.isOpenNow) {
        alert(`Desculpe, o atendimento presencial (${salesChannel === 'kiosk' ? 'Totem Autoatendimento' : 'Retirada'}) está indisponível no momento.\n${currentStatus.details}`);
        return;
      }
      alert(storeInfo.closedMessage || currentStatus.details || 'Desculpe, a loja está fechada ou o canal de atendimento selecionado está indisponível no momento.');
      return;
    }

    // Validação obrigatória de agendamento de retirada (regra de +2 dias para congelados e expediente do dia)
    const frozenNeedsLaterDate = storeInfo.deliveryScheduleEnabled && hasFrozenInCart && !isDateAllowedForFrozenOrder(selectedScheduleDate);
    const slotInvalidForDay = storeInfo.deliveryScheduleEnabled && Boolean(selectedScheduleTime) && !isSlotAllowedForDate(storeInfo, selectedScheduleDate, selectedScheduleTime);
    if (storeInfo.deliveryScheduleEnabled && (!selectedScheduleTime || frozenNeedsLaterDate || slotInvalidForDay)) {
      if (frozenNeedsLaterDate) {
        updateOrderModalityPreference('frozen');
        clearScheduleSelection();
      } else if (slotInvalidForDay) {
        setSelectedScheduleTime('');
        safeStorage.removeItem('balbec_selected_schedule_time');
      }
      setScheduleStepMode('pickup');
      setShowScheduleSelectionStep(true);
      alert(frozenNeedsLaterDate
        ? '❄️ Pedidos com itens congelados precisam de 48h (disponível a partir de +2 dias). Por favor, selecione uma nova data e horário de retirada.'
        : slotInvalidForDay
          ? '⏰ O horário selecionado anteriormente não está mais disponível para este dia. Por favor, escolha um novo horário.'
          : '⏰ O agendamento do horário de retirada é obrigatório. Por favor, escolha um dos horários disponíveis para continuar.');
      return;
    }

    // Auto-cadastro de conta para Retirada no Balcão se o cliente definiu uma senha
    if (deliveryType === 'pickup' && !activeCustomer && pickupCreateAccount) {
      if (pickupPassword.trim().length < 4) {
        alert('Por favor, crie uma senha de pelo menos 4 caracteres para salvar sua conta.');
        return;
      }
      try {
        const regRes = await fetch('/api/db/customer-register', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            name: customerName.trim(),
            phone: customerPhone.trim(),
            password: pickupPassword.trim()
          })
        });
        const regData = await regRes.json();
        if (regRes.ok && regData.success && regData.customer) {
          setActiveCustomer(regData.customer);
          safeStorage.setItem('balbec_logged_customer', JSON.stringify(regData.customer));
        }
      } catch (err) {
        console.warn('Erro ao cadastrar cliente na retirada:', err);
      }
    }

    // Pedidos de Atendimento Presencial (Mesas ou Totem)
    if (isTableOrder || isKioskMode) {
      await executeFinalOrderPlacement(isKioskMode ? 'Balcão' : 'No Caixa / Na Saída');
      return;
    }

    if (hasFrozenInCart && !frozenPaymentPlan) {
      alert('❄️ Para pedidos com salgados congelados, selecione primeiro entre PAGAMENTO INTEGRAL ou PAGAMENTO PARCIAL (50% de entrada via Pix ou Cartão de Débito).');
      checkoutPaymentRef.current?.scrollIntoView({ behavior: 'smooth', block: 'start' });
      return;
    }

    if (!paymentMethod) {
      alert(hasFrozenInCart
        ? 'Por favor, selecione Pix ou Cartão de Débito para concluir o pagamento do seu pedido com congelados.'
        : 'Por favor, selecione uma forma de pagamento (Online ou na Entrega) para continuar.');
      checkoutPaymentRef.current?.scrollIntoView({ behavior: 'smooth', block: 'start' });
      return;
    }

    const isPartialFrozenPlan = hasFrozenInCart && frozenPaymentPlan === 'parcial';
    const chargeAmount = isPartialFrozenPlan ? partialFrozenAmount : total;
    const remainingBalance = isPartialFrozenPlan ? remainingFrozenAmount : 0;

    // Pagamento Online: Pix, Crédito ou Débito
    const isPixOnline = paymentMethod === 'Pix (Online)' || paymentMethod === 'Pagamento Online (Pix MP)';
    const isCreditOnline = paymentMethod === 'Cartão de Crédito (Online)';
    const isDebitOnline = paymentMethod === 'Cartão de Débito (Online)';

    if (hasFrozenInCart && !isPixOnline && !isDebitOnline && !isCreditOnline) {
      alert('❄️ Para pedidos com congelados, mesmo optando por pagar na retirada, é necessário realizar o pagamento de 50% (ou integral) via Pix ou Cartão de Débito.');
      setPaymentMode(null);
      setPaymentMethod('');
      checkoutPaymentRef.current?.scrollIntoView({ behavior: 'smooth', block: 'start' });
      return;
    }

    // REGRA DE NEGÓCIO: No Pagamento Online (ou Entrada 50% Congelados), o pedido NÃO pode ser enviado antes da aprovação!
    if (isPixOnline) {
      if (!storeInfo.mercadoPagoEnabled && !hasFrozenInCart) {
        alert('O módulo de pagamento online está desativado pelo estabelecimento. Por favor, selecione uma opção de pagamento na entrega.');
        return;
      }
      setIsSendingOrder(true);
      try {
        const pixRes = await fetch('/api/mercadopago/create-pix', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            amount: chargeAmount,
            description: isPartialFrozenPlan
              ? `Entrada 50% Congelados BALBEC #${Date.now().toString().slice(-4)}`
              : `Pedido BALBEC #${Date.now().toString().slice(-4)}`,
            payer: {
              email: customerEmail.trim(),
              first_name: customerName.split(' ')[0],
              identification: { type: 'CPF', number: customerCpf.replace(/\D/g, '') }
            }
          })
        });
        const pixData = await pixRes.json();
        if (pixData.error || !pixData.success) {
          throw new Error(pixData.error || 'Não foi possível gerar a cobrança Pix.');
        }

        setActivePixPayment({
          paymentId: pixData.paymentId,
          qrCode: pixData.qrCodeBase64 ? `data:image/png;base64,${pixData.qrCodeBase64}` : pixData.qrCode,
          brCode: pixData.qrCode,
          amount: chargeAmount,
          totalOrderAmount: total,
          isPartialPayment: isPartialFrozenPlan,
          remainingAmount: remainingBalance,
          copied: false
        });
        setPixTimeRemaining(900); // 15 minutos
      } catch (pixErr: any) {
        alert(pixErr.message || 'Erro ao gerar Pix online. Tente novamente ou selecione outra opção.');
      } finally {
        setIsSendingOrder(false);
      }
      return; // CRÍTICO: NÃO EXECUTA O PEDIDO AQUI! AGUARDA CONFIRMAÇÃO DO PIX!
    }

    if (isCreditOnline || isDebitOnline) {
      if (!storeInfo.mercadoPagoEnabled && !hasFrozenInCart) {
        alert('O módulo de pagamento online está desativado pelo estabelecimento. Por favor, selecione uma opção de pagamento na entrega.');
        return;
      }
      // Abre o modal de cartão online para o cliente preencher dados com segurança
      setActiveCardPayment({
        type: isCreditOnline ? 'credit' : 'debit',
        amount: chargeAmount,
        totalOrderAmount: total,
        isPartialPayment: isPartialFrozenPlan,
        remainingAmount: remainingBalance
      });
      setCardFormData({
        number: '',
        holderName: customerName.trim().toUpperCase(),
        expiry: '',
        cvv: '',
        cpf: customerCpf.replace(/\D/g, ''),
        installments: 1
      });
      setCardPaymentError(null);
      return; // CRÍTICO: NÃO EXECUTA O PEDIDO AQUI! AGUARDA APROVAÇÃO DO CARTÃO!
    }

    // Pagamentos no Balcão (apenas pedidos sem congelados)
    await executeFinalOrderPlacement(paymentMethod, undefined, 'pending');
  };

  useEffect(() => {
    if (isSuccess) {
      try {
        window.scrollTo(0, 0);
        document.documentElement.scrollTop = 0;
        document.body.scrollTop = 0;
        
        const t1 = setTimeout(() => {
          window.scrollTo(0, 0);
          const banner = document.getElementById('order-attention-banner') || document.getElementById('success-order-screen');
          if (banner) {
            banner.scrollIntoView({ behavior: 'instant', block: 'start' });
          }
        }, 50);

        const t2 = setTimeout(() => {
          window.scrollTo(0, 0);
        }, 200);

        return () => {
          clearTimeout(t1);
          clearTimeout(t2);
        };
      } catch {}
    }
  }, [isSuccess]);

  if (isSuccess) {
    const orderNumber = lastPlacedOrder?.id ? String(lastPlacedOrder.id).slice(-4).padStart(4, '0') : '0001';
    const isKioskMode = salesChannel === 'kiosk' || isTotemPath;
    const clientNameDisplay = (lastPlacedOrder?.customerName || customerName || safeStorage.getItem('balbec_customer_name') || 'CLIENTE').trim().toUpperCase();
    const successPaymentBreakdown = getOrderPaymentBreakdown(lastPlacedOrder);
    const awaitingFinancialConfirm = lastPlacedOrder ? requiresOperatorPaymentConfirmation(lastPlacedOrder) : false;

    const orderHasFrozen = lastPlacedOrder?.items?.some((it: any) => 
      Boolean(it.isFrozen) || 
      (it.prepType && String(it.prepType).startsWith('congelado')) ||
      (it.prepLabel && String(it.prepLabel).toLowerCase().includes('congelad')) ||
      (Array.isArray(it.addons) && it.addons.some((a: any) => a.isFrozen || a.productId === 'prod_congelado' || (a.name && a.name.toLowerCase().includes('congelad'))))
    );

    return (
      <div id="success-order-screen" className="min-h-screen bg-stone-900 text-stone-100 flex flex-col items-center justify-start sm:justify-center p-2 sm:p-6 pt-2 sm:pt-6">
        <div className="bg-white text-stone-900 rounded-3xl shadow-2xl max-w-lg w-full overflow-hidden border border-stone-200 animate-in fade-in zoom-in duration-200 my-0 sm:my-auto">
          
          {/* Header de Sucesso (VERDE) */}
          <div className="bg-[#00a65a] text-white p-6 sm:p-8 text-center flex flex-col items-center justify-center">
            <div className="w-16 h-16 bg-white/20 rounded-full flex items-center justify-center mb-3">
              <CheckCircle2 className="w-10 h-10 text-white" />
            </div>
            <h2 className="text-2xl sm:text-4xl font-black tracking-tight uppercase leading-tight">PEDIDO REALIZADO!</h2>
            <p className="text-white/90 text-sm sm:text-base font-bold mt-1">
              Recebemos seu pedido com sucesso!
            </p>
          </div>

          {/* Seção de ATENÇÃO (LARANJA) */}
          <div className="bg-[#ff851b] text-white p-6 sm:p-8 text-center flex flex-col items-center">
            <div className="w-16 h-16 bg-white rounded-full flex items-center justify-center mb-4 shadow-lg">
              <UserCheck className="w-9 h-9 text-[#ff851b] stroke-[2.5]" />
            </div>
            <h3 className="text-xl sm:text-3xl font-black uppercase tracking-tight mb-4 drop-shadow-sm">
              ATENÇÃO PREZADO {clientNameDisplay || 'CLIENTE'}
            </h3>
            
            <div className="w-full bg-white/10 backdrop-blur-sm rounded-3xl p-5 sm:p-7 border border-white/30 shadow-inner mb-6 space-y-4">
              {lastPlacedOrder?.scheduledTime && (
                <div className="bg-white text-stone-900 px-5 py-3 rounded-2xl shadow-md border border-white/50 flex items-center justify-center gap-3">
                  <span className="text-2xl">📅</span>
                  <div className="text-left">
                    <p className="text-[10px] font-black uppercase tracking-widest text-orange-700">Data e Horário Agendado</p>
                    <p className="text-base sm:text-lg font-black text-stone-950 uppercase">
                      {lastPlacedOrder.scheduledDay ? `${formatDateBR(lastPlacedOrder.scheduledDay)} às ` : ''}{lastPlacedOrder.scheduledTime}{lastPlacedOrder.scheduledPickupTime ? ` (Retirada às ${lastPlacedOrder.scheduledPickupTime})` : ''}
                    </p>
                  </div>
                </div>
              )}
              <p className="text-lg sm:text-2xl font-black text-white leading-tight">
                {awaitingFinancialConfirm
                  ? (lastPlacedOrder?.scheduledTime
                      ? 'Recebemos seu pedido agendado! Ele está aguardando a confirmação do pagamento pela nossa equipe do financeiro para entrar na fila de preparação.'
                      : 'Recebemos seu pedido! Ele está aguardando a confirmação do pagamento pela nossa equipe do financeiro para entrar na fila de preparação.')
                  : lastPlacedOrder?.scheduledTime 
                  ? `Seu pedido foi agendado com sucesso. Aguarde ser chamado pelo seu nome no balcão.` 
                  : `Aguarde ser chamado pelo seu nome pelo atendente. Seu pedido está em preparação.`}
              </p>
            </div>

            {/* Aviso Especial de Salgados Congelados (Prazo até 48 horas / Pode ficar pronto antes) */}
            {orderHasFrozen && (
              <div className="w-full bg-blue-950/90 border-2 border-blue-400 rounded-3xl p-5 sm:p-6 shadow-xl mb-6 space-y-2 text-center text-white animate-in zoom-in-95">
                <div className="flex items-center justify-center gap-2 text-2xl mb-1">
                  <span>❄️</span>
                  <span>⏱️</span>
                </div>
                <h4 className="text-base sm:text-lg font-black uppercase tracking-tight text-blue-200">
                  Prazo de Produção: Salgados Congelados (Até 48 Horas)
                </h4>
                <p className="text-xs sm:text-sm text-blue-100 font-medium leading-relaxed">
                  Os salgados congelados têm prazo estimado de produção e congelamento de <strong>até 48 horas</strong>.<br/>
                  <strong className="text-white bg-blue-800 px-2 py-0.5 rounded-md inline-block my-1.5 border border-blue-600">
                    Apesar deste prazo, o seu pedido pode ficar pronto antes!
                  </strong><br/>
                  Assim que estiver pronto para retirada no balcão, você será avisado aqui na tela e via notificações no seu celular!
                </p>
              </div>
            )}

            <div className="inline-flex items-center gap-2 bg-black/30 backdrop-blur-md px-5 py-2.5 rounded-full border border-white/20 shadow-lg animate-pulse">
              <Printer className="w-4 h-4 text-white" />
              <span className="text-xs sm:text-sm font-black uppercase tracking-wide">
                {awaitingFinancialConfirm
                  ? `Pedido #${orderNumber} recebido • Aguardando confirmação do financeiro`
                  : `Pedido #${orderNumber} já impresso no balcão da loja!`}
              </span>
            </div>
          </div>

          {/* SUA SENHA DE CHAMADA (CARD BRANCO) */}
          <div className="p-6 sm:p-8 bg-white space-y-5">
            {/* Aviso claro de situação do pagamento no resumo do cliente */}
            {lastPlacedOrder && (
              <div className={`rounded-2xl p-4 border-2 shadow-xs space-y-1.5 ${
                successPaymentBreakdown.kind === 'partial_50'
                  ? 'bg-amber-50 border-amber-400 text-amber-950'
                  : successPaymentBreakdown.kind === 'paid_full'
                  ? 'bg-emerald-50 border-emerald-400 text-emerald-950'
                  : 'bg-orange-50 border-orange-300 text-orange-950'
              }`}>
                <div className="flex items-center justify-between gap-2 flex-wrap">
                  <span className="text-xs sm:text-sm font-black uppercase tracking-tight">
                    {successPaymentBreakdown.kind === 'partial_50'
                      ? '⚠️ Pagamento Parcial (50% Pago)'
                      : successPaymentBreakdown.kind === 'paid_full'
                      ? '✅ Pagamento Integral Confirmado'
                      : '🏪 Pagamento na Retirada'}
                  </span>
                  <span className={`text-[10px] font-black px-2.5 py-0.5 rounded-full uppercase ${
                    successPaymentBreakdown.kind === 'partial_50'
                      ? 'bg-amber-500 text-white'
                      : successPaymentBreakdown.kind === 'paid_full'
                      ? 'bg-emerald-600 text-white'
                      : 'bg-orange-600 text-white'
                  }`}>
                    {successPaymentBreakdown.customerBadge}
                  </span>
                </div>
                {successPaymentBreakdown.kind === 'partial_50' && (
                  <div className="grid grid-cols-3 gap-2 pt-1 text-center">
                    <div className="bg-white rounded-xl p-2 border border-amber-200">
                      <span className="block text-[9px] font-bold uppercase text-stone-500">Total</span>
                      <span className="text-xs font-black font-mono text-stone-800">{formatCurrency(successPaymentBreakdown.totalAmount)}</span>
                    </div>
                    <div className="bg-emerald-600 text-white rounded-xl p-2">
                      <span className="block text-[9px] font-bold uppercase text-emerald-100">Pago (50%)</span>
                      <span className="text-xs font-black font-mono">{formatCurrency(successPaymentBreakdown.paidAmount)}</span>
                    </div>
                    <div className="bg-red-600 text-white rounded-xl p-2">
                      <span className="block text-[9px] font-bold uppercase text-red-100">Falta Retirada</span>
                      <span className="text-xs font-black font-mono">{formatCurrency(successPaymentBreakdown.remainingAmount)}</span>
                    </div>
                  </div>
                )}
                <p className="text-xs font-bold leading-relaxed pt-0.5">
                  {successPaymentBreakdown.customerMessage}
                </p>
              </div>
            )}

            <div className="relative p-6 sm:p-8 rounded-[40px] border-2 border-stone-100 shadow-xl overflow-hidden bg-gradient-to-b from-white to-stone-50/50">
              <div className="flex flex-col sm:flex-row items-center justify-between gap-6 relative z-10">
                <div className="text-center sm:text-left">
                  <span className="text-[10px] font-black uppercase tracking-widest text-orange-600 block mb-1">Sua Senha de Chamada</span>
                  <h3 className="text-5xl sm:text-7xl font-black text-stone-950 tracking-tighter">#{orderNumber}</h3>
                  <div className="mt-4 inline-flex flex-col gap-1">
                    <div className="bg-orange-500 text-white px-4 py-2 rounded-xl text-xs font-black uppercase tracking-wide flex items-center gap-2 shadow-md">
                      <Clock className="w-4 h-4" />
                      <span>{lastPlacedOrder?.scheduledDay ? `${formatDateBR(lastPlacedOrder.scheduledDay)} ` : ''}{lastPlacedOrder?.scheduledTime}{lastPlacedOrder?.scheduledPickupTime ? ` (Retirada às ${lastPlacedOrder.scheduledPickupTime})` : ''}</span>
                    </div>
                    <span className="text-xs font-bold text-stone-500 ml-1 mt-1">Cliente: {clientNameDisplay}</span>
                  </div>
                </div>

                <div className="w-full sm:w-40 bg-[#fffde7] p-5 rounded-[32px] border-2 border-[#fff9c4] text-center flex flex-col items-center justify-center shadow-sm">
                  <div className="w-12 h-12 bg-white rounded-2xl flex items-center justify-center mb-2 shadow-xs border border-[#fff9c4]">
                    <Monitor className="w-6 h-6 text-[#fbc02d]" />
                  </div>
                  <p className="text-[11px] font-black text-stone-800 leading-tight">Acompanhe na TV da Loja</p>
                </div>
              </div>
            </div>
          </div>

          {/* Card Meta do Mês */}
          <div className="px-4 sm:px-5">
            {renderMonthlyGoalCard()}
          </div>

          {/* Card de Notificações no Smartphone (Mesmo com tela desligada / app fechado) */}
          <div className="p-4 sm:p-5 bg-amber-50 border-b border-amber-200">
            <div className="bg-white rounded-2xl p-4 sm:p-5 border border-amber-200 shadow-sm space-y-3">
              <div className="flex items-start gap-3">
                <div className="w-10 h-10 rounded-xl bg-orange-100 text-orange-600 flex items-center justify-center shrink-0">
                  <BellRing className="w-5 h-5 animate-pulse" />
                </div>
                <div className="flex-1 min-w-0">
                  <h4 className="text-sm font-black text-stone-900 leading-tight">
                    Acompanhamento do Pedido no Smartphone
                  </h4>
                  <p className="text-xs text-stone-600 mt-1 leading-relaxed">
                    Você receberá alertas com aviso sonoro e vibração assim que seu pedido for colocado em preparo e ficar pronto para retirada no balcão.
                  </p>
                </div>
              </div>

              {typeof window !== 'undefined' && 'Notification' in window && Notification.permission !== 'granted' && (
                <button
                  type="button"
                  onClick={async () => {
                    try {
                      const res = await Notification.requestPermission();
                      if (res === 'granted') {
                        try {
                          if ('serviceWorker' in navigator) {
                            const reg = await navigator.serviceWorker.ready;
                            reg.showNotification('BALBEC Salgados', {
                              body: `Notificações ativadas! Avisaremos você sobre o Pedido #${orderNumber}.`,
                              icon: '/balbec-logo.png?v=3',
                              badge: '/balbec-logo.png?v=3',
                              vibrate: [250, 100, 250]
                            } as any);
                          } else {
                            new Notification('BALBEC Salgados', {
                              body: `Notificações ativadas! Avisaremos você sobre o Pedido #${orderNumber}.`,
                              icon: '/balbec-logo.png?v=3'
                            });
                          }
                        } catch {}
                        alert('✅ Notificações ativadas com sucesso! Você receberá alertas na barra do seu celular.');
                      }
                    } catch {}
                  }}
                  className="w-full py-3 px-4 bg-orange-600 hover:bg-orange-700 active:scale-[0.98] text-white rounded-xl text-xs font-black uppercase tracking-wider flex items-center justify-center gap-2 shadow-md cursor-pointer transition-all"
                >
                  <BellRing className="w-4 h-4" />
                  <span>Ativar Avisos na Barra de Notificações do Celular</span>
                </button>
              )}

              <div className="p-3 bg-stone-50 rounded-xl border border-stone-200 text-[11px] text-stone-500 leading-relaxed space-y-1">
                <p className="font-semibold text-stone-700">📱 Como funcionam os alertas:</p>
                <p>• <strong>Com o site aberto:</strong> A janela de aviso surge na hora e fica fixa na tela com som e vibração até você fechar.</p>
                <p>• <strong>Se fechar a aba ou bloquear a tela:</strong> Assim que você reabrir o site ou desbloquear o aparelho, a janela de aviso surge imediatamente com o status atualizado!</p>
              </div>
            </div>
          </div>

          {/* Senha e TV Chamada */}
          <div className="p-5 bg-orange-50 border-b border-orange-100">

            <div className="flex flex-col sm:flex-row items-center justify-between gap-3 text-center sm:text-left bg-white p-4 rounded-2xl border border-orange-200 shadow-xs">
              <div>
                <p className="text-xs font-black uppercase tracking-wider text-orange-600">Sua Senha de Chamada</p>
                <p className="text-3xl sm:text-4xl font-black text-stone-900 font-mono tracking-tight">#{orderNumber}</p>
                {lastPlacedOrder?.tableNumber ? (
                  <div className="inline-flex items-center gap-1.5 mt-1 px-2.5 py-0.5 bg-amber-100 text-amber-900 rounded-lg text-xs font-black border border-amber-300">
                    <UtensilsCrossed className="w-3.5 h-3.5 text-amber-700" />
                    <span>MESA {lastPlacedOrder.tableNumber}</span>
                  </div>
                ) : null}
                {lastPlacedOrder?.scheduledTime ? (
                  <div className="inline-flex items-center gap-1.5 mt-1 px-3 py-1 bg-amber-500 text-stone-900 rounded-lg text-xs font-black shadow-xs">
                    <Clock className="w-3.5 h-3.5 text-stone-950" />
                    <span>HORÁRIO AGENDADO RETIRADA: {lastPlacedOrder.scheduledDay ? `${lastPlacedOrder.scheduledDay} ` : ''}{lastPlacedOrder.scheduledTime}</span>
                  </div>
                ) : null}
                {!isKioskMode && clientNameDisplay && (
                  <p className="text-xs text-stone-500 font-semibold mt-0.5">Cliente: <span className="text-stone-800 font-bold uppercase">{clientNameDisplay}</span></p>
                )}
              </div>
              <div className="flex items-center gap-2 bg-amber-100 text-amber-900 px-3 py-2 rounded-xl text-xs font-bold border border-amber-300/60">
                <Tv className="w-4 h-4 text-amber-700 shrink-0" />
                <span>{lastPlacedOrder?.tableNumber ? 'Entregaremos na sua mesa' : 'Acompanhe na TV da Loja'}</span>
              </div>
            </div>
          </div>

          {/* Visual do Cupom / Comprovante para Impressão */}
          {lastPlacedOrder && (() => {
            let previewItems: any[] = [];
            if (Array.isArray(lastPlacedOrder.items)) {
              previewItems = lastPlacedOrder.items;
            } else if (typeof (lastPlacedOrder as any).items === 'string' && (lastPlacedOrder as any).items.trim() !== '') {
              try {
                const parsed = JSON.parse((lastPlacedOrder as any).items);
                if (Array.isArray(parsed)) previewItems = parsed;
              } catch {
                previewItems = [];
              }
            }

            let previewCustomerText = 'CLIENTE: BALCÃO / RETIRADA';
            if (lastPlacedOrder.customerName && lastPlacedOrder.customerName.trim() !== '' && lastPlacedOrder.customerName.trim().toUpperCase() !== 'CLIENTE' && lastPlacedOrder.customerName.trim().toUpperCase() !== 'CLIENTE TOTEM') {
              previewCustomerText = `CLIENTE: ${lastPlacedOrder.customerName.trim().toUpperCase()}`;
            } else if (isKioskMode || lastPlacedOrder.type === 'kiosk') {
              previewCustomerText = 'CLIENTE: TOTEM / AUTOATENDIMENTO';
            } else if (lastPlacedOrder.tableNumber) {
              previewCustomerText = `CLIENTE: MESA ${lastPlacedOrder.tableNumber}`;
            } else {
              previewCustomerText = 'CLIENTE: BALCÃO / RETIRADA';
            }

            return (
              <div className="p-4 sm:p-5 bg-stone-100 max-h-[34vh] overflow-y-auto border-b border-stone-200">
                <div className="bg-white p-4 rounded-xl shadow-xs border border-stone-300/70 font-mono text-xs text-stone-900 leading-relaxed max-w-sm mx-auto">
                  <div className="text-center text-[10px] text-stone-500 mb-2">*** {lastPlacedOrder.tableNumber ? `CONSUMO NO LOCAL - MESA ${lastPlacedOrder.tableNumber}` : isKioskMode ? 'AUTOATENDIMENTO' : 'PEDIDO ONLINE'} ***</div>

                  {/* PEDIDO E CLIENTE EM DESTAQUE (FUNDO PRETO / TEXTO BRANCO) */}
                  <div className="bg-black text-white p-2.5 text-center rounded-md my-2 space-y-1">
                    <div className="font-black text-sm tracking-wider">
                      PEDIDO #{orderNumber}
                    </div>
                    <div className="font-black text-xs uppercase tracking-wide break-words border-t border-stone-700 pt-1">
                      {previewCustomerText}
                    </div>
                    {lastPlacedOrder.tableNumber && (
                      <div className="font-black text-xs tracking-widest text-amber-300 uppercase">
                        🍽️ MESA {lastPlacedOrder.tableNumber}
                      </div>
                    )}
                    {lastPlacedOrder.scheduledTime && (
                      <div className="bg-amber-400 text-black px-2 py-1 rounded text-xs font-black tracking-wide uppercase mt-1">
                        ⏰ RETIRADA AGENDADA: {lastPlacedOrder.scheduledDay ? `${lastPlacedOrder.scheduledDay} ` : ''}{lastPlacedOrder.scheduledTime}
                      </div>
                    )}
                  </div>

                  <div className="border-t border-dashed border-stone-400 my-2"></div>

                  <div className="space-y-1.5 my-2">
                    {previewItems.map((item: any, idx: number) => {
                      const itemCode = resolveItemCode(item);
                      return (
                        <div key={idx} className="border-b border-stone-100 pb-1.5 last:border-b-0">
                          <div className="flex justify-between items-start text-[11px]">
                            <span className="font-semibold">
                              {item.quantity}x {item.name}
                              {itemCode && (
                                <span className="ml-1.5 text-[10px] font-mono font-bold text-white bg-black px-1.5 py-0.5 rounded">
                                  CÓD: {itemCode}
                                </span>
                              )}
                            </span>
                            <span className="font-bold">{formatCurrency(((item.price || 0) + (item.flavor?.price || 0) + (item.addons?.reduce((s: number, a: any) => s + (a.price || 0), 0) || 0)) * (item.quantity || 1))}</span>
                          </div>
                          {item.flavor && (
                            <div className={`text-[10px] pl-2 py-0.5 rounded-sm my-0.5 ${
                              (item.flavor.name || '').toLowerCase().includes('congelado') || (item.flavor.name || '').toLowerCase().includes('normal')
                                ? 'text-red-700 font-black bg-red-50 border-l-2 border-red-500'
                                : 'text-stone-600'
                            }`}>
                              • Sabor: {item.flavor.name}
                              {resolveAddonCode(item.flavor) && (
                                <span className="font-mono font-bold text-white bg-black px-1 py-0.5 rounded text-[9px] ml-1">
                                  CÓD: {resolveAddonCode(item.flavor)}
                                </span>
                              )}
                            </div>
                          )}
                          {item.addons && item.addons.length > 0 && (
                            <div className="text-[10px] pl-2 space-y-0.5 mt-0.5">
                              {item.addons.map((a: any, aIdx: number) => {
                                const aCode = resolveAddonCode(a);
                                const isHighlight = (a.name || '').toLowerCase().includes('congelado') || (a.name || '').toLowerCase().includes('normal');
                                return (
                                  <div key={aIdx} className={`flex items-center gap-1 py-0.5 rounded-sm px-1 ${isHighlight ? 'text-red-700 font-black bg-red-50 border-l-2 border-red-500' : 'text-stone-600'}`}>
                                    + <span>{a.name}</span>
                                    {aCode && (
                                      <span className="font-mono font-bold text-white bg-black px-1 py-0.5 rounded text-[9px] ml-1">
                                        CÓD: {aCode}
                                      </span>
                                    )}
                                  </div>
                                );
                              })}
                            </div>
                          )}
                          {item.description && (
                            <div className="text-[10px] pl-2 text-stone-500 font-light italic leading-tight mt-0.5">
                              {item.description}
                            </div>
                          )}
                        </div>
                      );
                    })}
                  </div>

                  <div className="border-t border-dashed border-stone-400 my-2"></div>

                <div className="flex justify-between items-center font-black text-xs sm:text-sm">
                  <span>TOTAL :</span>
                  <span>{formatCurrency(lastPlacedOrder.total || 0)}</span>
                </div>

                <div className="text-center text-[10px] text-stone-600 mt-1">
                  Pagamento: <span className="font-bold text-stone-900">{lastPlacedOrder.paymentMethod || 'No Balcão'}</span>
                </div>
                <div className="mt-1.5 border border-stone-800 bg-stone-50 p-1.5 text-center text-[10px] font-black uppercase text-stone-900">
                  {successPaymentBreakdown.receiptLine}
                </div>

                <div className="text-center text-[9px] text-stone-400 mt-2">
                  {lastPlacedOrder.createdAt ? new Date(lastPlacedOrder.createdAt).toLocaleString('pt-BR') : new Date().toLocaleString('pt-BR')}
                </div>
              </div>
            </div>
            );
          })()}

          {/* Temporizador regressivo (Oculto se for delivery) */}
          {successCountdown > 0 && (
            <div className="px-5 pt-4 pb-1 bg-white">
              <div className="bg-amber-50 border border-amber-200/90 p-3 rounded-2xl text-center">
                <div className="flex items-center justify-center gap-2 text-xs font-black text-amber-950 mb-1.5">
                  <Clock className="w-4 h-4 text-amber-600 animate-spin" />
                  <span>
                    {isKioskMode 
                      ? <>Voltando para a tela inicial em <strong className="text-amber-700 text-sm font-mono">{successCountdown}s</strong> para o próximo cliente</>
                      : <>Retornando ao cardápio em <strong className="text-amber-700 text-sm font-mono">{successCountdown}s</strong></>
                    }
                  </span>
                </div>
                <div className="w-full bg-amber-200/70 h-2.5 rounded-full overflow-hidden">
                  <div 
                    className="bg-amber-500 h-full transition-all duration-1000 ease-linear rounded-full"
                    style={{ width: `${Math.max(0, Math.min(100, (successCountdown / (isKioskMode ? 15 : 45)) * 100))}%` }}
                  />
                </div>
              </div>
            </div>
          )}


          {/* Itens Sugeridos Reservados e Carrossel de Mais Vendidos para 2º Pedido */}
          {!isKioskMode && (queuedImpulseProducts.length > 0 || orderHasFrozen) && (
            <div className="px-5 py-4 bg-orange-50/60 border-t border-orange-200/80 space-y-4 text-left">
              {queuedImpulseProducts.length > 0 && (
                <div className="bg-white rounded-2xl p-4 border border-orange-200 shadow-xs space-y-3">
                  <div className="flex items-start justify-between gap-2">
                    <div>
                      <h4 className="text-sm font-black text-stone-900">
                        Itens Reservados para o Seu Próximo Pedido
                      </h4>
                      <p className="text-xs text-stone-600 mt-0.5">
                        Você separou estes itens enquanto comprava congelados. Toque abaixo para iniciar o 2º pedido agora.
                      </p>
                    </div>
                  </div>

                  <div className="space-y-2">
                    {queuedImpulseProducts.map(qp => (
                      <div
                        key={`queued_${qp.id}`}
                        className="flex items-center justify-between gap-2.5 p-2 rounded-xl bg-stone-50 border border-stone-200"
                      >
                        <div className="flex items-center gap-2.5 min-w-0">
                          <div className="w-10 h-10 rounded-lg overflow-hidden bg-white border border-stone-200 shrink-0">
                            <ProductImage src={qp.imageUrl} alt={qp.name} className="w-full h-full object-cover" />
                          </div>
                          <div className="min-w-0">
                            <p className="text-xs font-black text-stone-900 truncate">
                              {formatCapitalized(qp.name)}
                            </p>
                            <p className="text-xs font-bold text-orange-700 tabular-nums">
                              {formatCurrency(qp.price)}
                            </p>
                          </div>
                        </div>
                        <button
                          type="button"
                          onClick={() => updateQueuedImpulseProducts(prev => prev.filter(item => item.id !== qp.id))}
                          aria-label={`Remover ${qp.name} da reserva`}
                          className="p-1.5 text-stone-400 hover:text-red-600 rounded-lg transition-colors cursor-pointer shrink-0"
                        >
                          <X className="w-4 h-4" />
                        </button>
                      </div>
                    ))}
                  </div>

                  <button
                    type="button"
                    onClick={() => startNewOrderWithImpulseProducts(queuedImpulseProducts)}
                    className="w-full py-3.5 px-4 bg-orange-600 hover:bg-orange-700 active:scale-[0.98] text-white rounded-xl font-black text-xs sm:text-sm flex items-center justify-center gap-2 shadow-md transition-all cursor-pointer"
                  >
                    <ShoppingBag className="w-4 h-4" />
                    <span>Fazer 2º Pedido com Itens Reservados ({queuedImpulseProducts.length})</span>
                    <ArrowRight className="w-4 h-4" />
                  </button>
                </div>
              )}

              {bestSellerEntries.some(e => !e.isFrozenCategory) && (
                <BestSellersCarousel
                  items={bestSellerEntries.filter(e => !e.isFrozenCategory)}
                  isFrozenOrderActive={false}
                  canBuy={true}
                  cartProductIds={cartProductIds}
                  queuedProductIds={queuedProductIds}
                  variant="success"
                  themeColor={storeInfo.themeColor || '#ea580c'}
                  onSelectProduct={(entry) => {
                    const combined = [
                      entry.product,
                      ...queuedImpulseProducts.filter(q => q.id !== entry.product.id),
                    ];
                    startNewOrderWithImpulseProducts(combined);
                  }}
                />
              )}
            </div>
          )}

          {/* Botões de Ação: Compartilhar Comprovante Pix + Totem/Smartphone */}
          <div className="p-5 space-y-3 bg-white">
            {lastPlacedOrder && successPaymentBreakdown.isPix && (
              <div className="space-y-2 pb-1">
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                  <button
                    type="button"
                    disabled={isSharingPix}
                    onClick={async () => {
                      setIsSharingPix(true);
                      try {
                        const res = await sharePixReceipt(lastPlacedOrder, storeInfo);
                        setPixShareFeedback(res.message);
                        setTimeout(() => setPixShareFeedback(null), 6000);
                      } finally {
                        setIsSharingPix(false);
                      }
                    }}
                    className="w-full py-3.5 px-4 bg-blue-600 hover:bg-blue-700 active:scale-[0.98] text-white rounded-2xl font-black text-xs sm:text-sm uppercase tracking-wider flex items-center justify-center gap-2 shadow-md shadow-blue-600/20 transition-all cursor-pointer disabled:opacity-50"
                  >
                    <Share2 className="w-4 h-4" />
                    <span>{isSharingPix ? 'Gerando...' : 'Compartilhar Comprovante Pix'}</span>
                  </button>

                  <a
                    href={`https://wa.me/?text=${encodeURIComponent(buildPixReceiptShareText(lastPlacedOrder, storeInfo))}`}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="w-full py-3.5 px-4 bg-emerald-50 hover:bg-emerald-100 text-emerald-800 border-2 border-emerald-300 rounded-2xl font-black text-xs sm:text-sm uppercase tracking-wider flex items-center justify-center gap-2 transition-all"
                  >
                    <MessageCircle className="w-4 h-4 text-emerald-600" />
                    <span>Enviar no WhatsApp</span>
                  </a>
                </div>
                {pixShareFeedback && (
                  <p className="text-xs font-bold text-emerald-800 bg-emerald-50 border border-emerald-200 rounded-xl px-3 py-2 text-center">
                    {pixShareFeedback}
                  </p>
                )}
              </div>
            )}

            {isKioskMode ? (
              <>
                <button 
                  type="button"
                  onClick={() => {
                    if (lastPlacedOrder) {
                      printReceipt(lastPlacedOrder, storeInfo);
                    }
                  }}
                  className="w-full py-4 px-5 bg-blue-600 hover:bg-blue-700 active:scale-[0.98] text-white rounded-2xl font-black text-base sm:text-lg flex items-center justify-center gap-2.5 shadow-lg shadow-blue-600/30 transition-all cursor-pointer select-none"
                >
                  <Printer className="w-6 h-6" />
                  <span>IMPRIMIR COMPROVANTE</span>
                </button>

                <button 
                  type="button"
                  onClick={handleResetForNewCustomer}
                  className="w-full py-3.5 bg-emerald-600 hover:bg-emerald-700 text-white active:scale-[0.99] rounded-2xl font-bold text-sm sm:text-base transition-colors shadow-sm cursor-pointer flex items-center justify-center gap-2"
                >
                  <CheckCircle2 className="w-5 h-5" />
                  <span>Novo Pedido</span>
                </button>
              </>
            ) : (
              <button 
                type="button"
                onClick={handleResetForNewCustomer}
                className="w-full py-4 px-5 bg-emerald-600 hover:bg-emerald-700 active:bg-emerald-800 active:scale-[0.98] text-white rounded-2xl font-black text-base sm:text-lg flex items-center justify-center gap-2.5 shadow-lg shadow-emerald-600/30 transition-all cursor-pointer select-none"
              >
                <CheckCircle2 className="w-6 h-6" />
                <span>Entendi / Fazer Novo Pedido</span>
              </button>
            )}
          </div>
        </div>
      </div>
    );
  }

  // Etapa Inicial após Login: Perguntar se o pedido será de Congelados ou Outros Produtos
  if (showOrderTypeChoiceModal && !isTotemPath && salesChannel !== 'kiosk') {
    const minFrozenDateKey = getMinFrozenScheduleDateKey();
    const minFrozenFormatted = minFrozenDateKey.split('-').reverse().join('/');

    return (
      <div className="min-h-screen bg-[#f8f7f5] flex flex-col items-center justify-center p-4 sm:p-6 animate-fadeIn">
        <div className="bg-white p-6 sm:p-8 rounded-3xl shadow-xl max-w-lg w-full text-center border border-stone-200 relative overflow-hidden">
          <div className="h-1.5 w-full bg-orange-600 rounded-full mb-5" />

          <h2 className="text-xl sm:text-2xl font-black text-stone-900 tracking-tight text-balance">
            Como será o seu pedido hoje?
          </h2>
          <p className="text-stone-600 text-xs sm:text-sm mt-1.5 mb-6 leading-relaxed">
            Escolha a modalidade abaixo para mostrarmos os dias disponíveis de agendamento e os produtos compatíveis no cardápio.
          </p>

          <div className="space-y-3.5 text-left">
            <button
              type="button"
              onClick={() => {
                updateOrderModalityPreference('frozen');
                if (!isDateAllowedForFrozenOrder(selectedScheduleDate)) {
                  clearScheduleSelection();
                }
                setShowOrderTypeChoiceModal(false);
                if (storeInfo.deliveryScheduleEnabled) {
                  setScheduleStepMode('pickup');
                  setShowScheduleSelectionStep(true);
                } else {
                  setHasName(true);
                  setHasChosenChannel(true);
                  const firstFrozenCat = availableCategories.find(c => isCategoryFrozenModality(c));
                  if (firstFrozenCat) {
                    setTimeout(() => scrollToCategory(firstFrozenCat.id), 150);
                  }
                }
              }}
              className="w-full p-4 sm:p-5 rounded-2xl border-2 border-blue-200 bg-blue-50/70 hover:bg-blue-50 hover:border-blue-500 transition-all text-left flex items-start gap-3.5 cursor-pointer group active:scale-[0.99]"
            >
              <div className="w-12 h-12 rounded-xl bg-blue-600 text-white flex items-center justify-center text-2xl shrink-0 shadow-xs">
                ❄️
              </div>
              <div className="flex-1 min-w-0">
                <div className="flex items-center justify-between gap-2">
                  <span className="text-base font-black text-blue-950 group-hover:text-blue-700">
                    Pedido de Congelados
                  </span>
                  <ArrowRight className="w-4 h-4 text-blue-600 shrink-0" />
                </div>
                <p className="text-xs text-blue-900 font-semibold mt-1 leading-relaxed">
                  Produção de até 48 horas — agendamento disponível a partir de <strong>{minFrozenFormatted}</strong> (+2 dias).
                </p>
                <p className="text-[11px] text-blue-800/90 mt-1 leading-snug">
                  Caso fique pronto antes, você será avisado pelas notificações. Neste pedido entram apenas itens congelados.
                </p>
              </div>
            </button>

            <button
              type="button"
              onClick={() => {
                updateOrderModalityPreference('normal');
                clearScheduleSelection();
                setShowOrderTypeChoiceModal(false);
                if (storeInfo.deliveryScheduleEnabled) {
                  setScheduleStepMode('pickup');
                  setShowScheduleSelectionStep(true);
                } else {
                  setHasName(true);
                  setHasChosenChannel(true);
                }
              }}
              className="w-full p-4 sm:p-5 rounded-2xl border-2 border-amber-200 bg-amber-50/70 hover:bg-amber-50 hover:border-orange-500 transition-all text-left flex items-start gap-3.5 cursor-pointer group active:scale-[0.99]"
            >
              <div className="w-12 h-12 rounded-xl bg-orange-600 text-white flex items-center justify-center text-2xl shrink-0 shadow-xs">
                🥖
              </div>
              <div className="flex-1 min-w-0">
                <div className="flex items-center justify-between gap-2">
                  <span className="text-base font-black text-stone-900 group-hover:text-orange-700">
                    Outros Produtos (Prontos / Normal)
                  </span>
                  <ArrowRight className="w-4 h-4 text-orange-600 shrink-0" />
                </div>
                <p className="text-xs text-stone-700 font-semibold mt-1 leading-relaxed">
                  Salgados assados ou fritos, lanches, bebidas e demais itens — agendamento a partir de hoje, sem espera de 2 dias.
                </p>
              </div>
            </button>
          </div>
        </div>
      </div>
    );
  }

  // Etapa de Agendamento de Horários (respeitando dias abertos/fechados e expediente de abertura/fechamento de cada dia)
  if (showScheduleSelectionStep) {
    const slotCapacitiesMap = parseSlotCapacities(storeInfo.scheduleSlotCapacities);

    // Carregar os dias de funcionamento configurados no Painel (Horários de Atendimento por Dia)
    const storeWeeklySchedule = parseWeeklySchedule(storeInfo.weeklySchedule);
    const brazilDate = getBrazilNowDate();
    const currentHours = brazilDate.getHours();
    const currentMinutes = brazilDate.getMinutes();
    const currentTimeInMinutes = (currentHours * 60) + currentMinutes;

    const isFrozenOrderActive = hasFrozenInCart || orderModalityPreference === 'frozen';

    // Gerar dias da semana disponíveis: se for congelado, inicia em +2 dias corridos (48h)
    const availableWeekDays = getAvailableScheduleDays(storeWeeklySchedule, {
      isFrozenOrder: isFrozenOrderActive,
      daysCount: 6,
      referenceDate: brazilDate,
    });

    // Dia ativo selecionado (garantindo que nunca fique em data anterior ao mínimo quando for congelado)
    const activeDay = availableWeekDays.find(d => d.dateStr === selectedScheduleDate) || availableWeekDays[0];
    const isTodaySelected = activeDay?.isToday || false;

    // Filtrar os horários configurados respeitando o horário de abertura, fechamento e intervalo do dia selecionado
    const { slots, daySchedule: activeDayConfig } = getScheduleSlotsForDay({
      rawSlots: storeInfo.deliveryScheduleSlots,
      weeklyScheduleRaw: storeWeeklySchedule,
      dayOfWeek: activeDay ? activeDay.dayOfWeek : brazilDate.getDay(),
      scheduleStartTime: storeInfo.scheduleStartTime,
      scheduleEndTime: storeInfo.scheduleEndTime,
    });

    const closedDaysLabel = storeWeeklySchedule
      .filter(d => !d.isOpen)
      .map(d => d.dayName)
      .join(', ');

    // Tempos de retirada configuráveis no Painel (padrão: 40 min normal, 90 min congelado)
    const normalPrepMinutes = Number(storeInfo.schedulePrepTimeNormalMinutes) || 40;
    const frozenPrepMinutes = Number(storeInfo.schedulePrepTimeFrozenMinutes) || 90;
    const activePrepBuffer = isFrozenOrderActive ? frozenPrepMinutes : normalPrepMinutes;

    // Capacidade padrão de salgados por horário (usada quando o horário não tem limite próprio configurado)
    const defaultSlotCapacity = storeInfo.scheduleSlotItemCapacity !== undefined ? Number(storeInfo.scheduleSlotItemCapacity) : 100;

    // Helper para verificar status e capacidade individual de um slot no dia ativo
    const getSlotStatus = (slot: string) => {
      const slotCap = slotCapacitiesMap[slot] !== undefined ? slotCapacitiesMap[slot] : defaultSlotCapacity;
      const bookedUnits = activeDay ? (slotBookedItemsMap[`${activeDay.dateStr}_${slot}`] || 0) : 0;
      const remainingUnits = Math.max(0, slotCap - bookedUnits);
      const isFull = remainingUnits <= 0;

      let isPast = false;
      if (isTodaySelected) {
        const [sh, sm] = slot.split(':').map(Number);
        const slotMinutes = (sh * 60) + sm;
        isPast = slotMinutes <= (currentTimeInMinutes + activePrepBuffer);
      }

      return {
        isPast,
        isFull,
        isDisabled: isPast || isFull,
        bookedUnits,
        remainingUnits,
        slotCap
      };
    };

    // Auto-avanço para o próximo horário disponível se o horário atual estiver fora do expediente do dia, desabilitado ou expirado
    const isSelectedValidForDay = Boolean(selectedScheduleTime && slots.includes(selectedScheduleTime));
    const currentSlotStatus = isSelectedValidForDay ? getSlotStatus(selectedScheduleTime) : null;
    let effectiveSelectedTime = isSelectedValidForDay ? selectedScheduleTime : '';
    if (!effectiveSelectedTime || currentSlotStatus?.isDisabled) {
      const firstAvailableSlot = slots.find(s => !getSlotStatus(s).isDisabled);
      effectiveSelectedTime = firstAvailableSlot || '';
    }

    const previewPickup = effectiveSelectedTime 
      ? calculatePickupTime(effectiveSelectedTime, isFrozenOrderActive, normalPrepMinutes, frozenPrepMinutes) 
      : '';

    const canGoBackWithoutChange = Boolean(
      ((selectedScheduleTime && isSelectedValidForDay) || isCheckout) &&
      (!isFrozenOrderActive || isDateAllowedForFrozenOrder(selectedScheduleDate, brazilDate))
    );

    return (
      <div className="min-h-screen bg-[#f8f7f5] flex flex-col items-center justify-center p-3 sm:p-6 animate-fadeIn">
        <div className="bg-white p-5 sm:p-8 rounded-3xl shadow-xl max-w-lg w-full text-center border border-stone-200 relative overflow-hidden">
          <div className="absolute top-0 left-0 right-0 h-2 bg-gradient-to-r from-orange-500 to-amber-500"></div>

          {canGoBackWithoutChange && (
            <button
              type="button"
              onClick={() => {
                setPendingImpulseProducts([]);
                setShowScheduleSelectionStep(false);
              }}
              className="absolute top-4 right-4 p-2 bg-stone-100 hover:bg-stone-200 text-stone-600 rounded-full transition-colors cursor-pointer"
              title="Voltar"
            >
              <X className="w-5 h-5" />
            </button>
          )}

          <div className={`w-14 h-14 mx-auto mb-3 rounded-2xl flex items-center justify-center text-2xl shadow-xs border ${
            isFrozenOrderActive
              ? 'bg-blue-100 text-blue-700 border-blue-200'
              : 'bg-orange-100 text-orange-700 border-orange-200'
          }`}>
            {isFrozenOrderActive ? '❄️' : '⏰'}
          </div>

          <h2 className="text-xl sm:text-2xl font-black text-stone-900 uppercase tracking-tight mb-1 text-balance">
            {isFrozenOrderActive ? 'Agendamento — Congelados (48h)' : 'Agende a Retirada do Pedido'}
          </h2>
          <p className="text-stone-600 text-xs sm:text-sm mb-3">
            {isFrozenOrderActive
              ? `Dias liberados a partir de ${availableWeekDays[0]?.dateFormatted || '+2 dias'} (prazo de produção de 48 horas)`
              : 'Escolha o dia da semana (Segunda a Sábado) e o horário de retirada no balcão'}
          </p>

          {/* Seletor rápido do tipo de pedido dentro do agendamento */}
          <div className="flex items-center gap-1.5 p-1 bg-stone-100 rounded-xl border border-stone-200 mb-4">
            <button
              type="button"
              onClick={() => {
                if (!isFrozenOrderActive) {
                  updateOrderModalityPreference('frozen');
                  if (!isDateAllowedForFrozenOrder(selectedScheduleDate, brazilDate)) {
                    clearScheduleSelection();
                  }
                }
              }}
              className={`flex-1 py-2 px-2.5 rounded-lg text-xs font-black transition-all cursor-pointer flex items-center justify-center gap-1.5 whitespace-nowrap ${
                isFrozenOrderActive
                  ? 'bg-blue-600 text-white shadow-xs'
                  : 'text-stone-600 hover:text-stone-900'
              }`}
            >
              <span>❄️ Congelados (+2 dias)</span>
            </button>
            <button
              type="button"
              onClick={() => {
                if (hasFrozenInCart) {
                  if (confirm('Seu carrinho já possui itens congelados. Deseja limpar o carrinho para agendar outros produtos sem espera de 2 dias?')) {
                    switchFromFrozenToNormalAndReschedule();
                  }
                } else {
                  updateOrderModalityPreference('normal');
                  clearScheduleSelection();
                }
              }}
              className={`flex-1 py-2 px-2.5 rounded-lg text-xs font-black transition-all cursor-pointer flex items-center justify-center gap-1.5 whitespace-nowrap ${
                !isFrozenOrderActive
                  ? 'bg-orange-600 text-white shadow-xs'
                  : 'text-stone-600 hover:text-stone-900'
              }`}
            >
              <span>🥖 Outros Produtos</span>
            </button>
          </div>

          {isFrozenOrderActive && (
            <div className="mb-4 p-3.5 bg-blue-50 border border-blue-200 rounded-2xl text-left text-xs text-blue-950 space-y-1">
              <p className="font-black text-blue-900 text-xs">
                Prazo de 48h para Congelados (a partir de {availableWeekDays[0]?.dateFormatted})
              </p>
              <p className="text-[11px] text-blue-900/90 leading-relaxed font-medium">
                Os pedidos de congelados precisam de 48 horas para ficarem prontos, por isso os dias disponíveis começam 2 dias à frente. <strong>Caso seu pedido fique pronto antes, você será avisado pelas notificações.</strong>
              </p>
            </div>
          )}

          {/* 1. SELEÇÃO DOS DIAS DA SEMANA */}
          <div ref={scheduleDaysSectionRef} className="mb-4 text-left">
            <label className="block text-xs font-black text-stone-700 uppercase tracking-wider mb-2">
              {isFrozenOrderActive
                ? `1. Selecione o Dia da Retirada (a partir de ${availableWeekDays[0]?.dateFormatted || ''}):`
                : '1. Selecione o Dia da Retirada:'}
            </label>
            <div className="grid grid-cols-3 sm:grid-cols-6 gap-1.5">
              {availableWeekDays.map(day => {
                const isSelected = activeDay?.dateStr === day.dateStr;
                return (
                  <button
                    key={day.dateStr}
                    type="button"
                    onClick={() => {
                      setSelectedScheduleDate(day.dateStr);
                      setSelectedScheduleDay(day.dayName);
                      safeStorage.setItem('balbec_selected_schedule_date', day.dateStr);
                      safeStorage.setItem('balbec_selected_schedule_day', day.dayName);

                      // Se o horário selecionado anteriormente não pertencer ao expediente deste dia, limpa para auto-selecionar um válido
                      const { slots: daySlots } = getScheduleSlotsForDay({
                        rawSlots: storeInfo.deliveryScheduleSlots,
                        weeklyScheduleRaw: storeWeeklySchedule,
                        dayOfWeek: day.dayOfWeek,
                        scheduleStartTime: storeInfo.scheduleStartTime,
                        scheduleEndTime: storeInfo.scheduleEndTime,
                      });
                      if (selectedScheduleTime && !daySlots.includes(selectedScheduleTime)) {
                        setSelectedScheduleTime('');
                        safeStorage.removeItem('balbec_selected_schedule_time');
                      }

                      // Rolagem automática suave para os horários disponíveis
                      setTimeout(() => {
                        scheduleSlotsSectionRef.current?.scrollIntoView({ behavior: 'smooth', block: 'start' });
                      }, 150);
                    }}
                    className={`py-2 px-1 rounded-xl border text-center transition-all cursor-pointer flex flex-col items-center justify-center gap-0.5 ${
                      isSelected
                        ? (isFrozenOrderActive ? 'bg-blue-600 text-white border-blue-600 shadow-sm scale-102 font-black' : 'bg-orange-600 text-white border-orange-600 shadow-sm scale-102 font-black')
                        : 'bg-stone-50 hover:bg-orange-50 text-stone-700 border-stone-200 font-semibold'
                    }`}
                  >
                    <span className={`text-[10px] uppercase tracking-wider font-extrabold ${isSelected ? 'text-white/90' : 'text-stone-500'}`}>
                      {day.isToday ? 'Hoje' : day.shortDayName}
                    </span>
                    <span className="text-xs font-mono font-bold leading-tight tabular-nums">
                      {day.dateFormatted}
                    </span>
                  </button>
                );
              })}
            </div>
            {closedDaysLabel && (
              <div className="mt-1 text-right">
                <span className="text-[10px] text-stone-500 italic">* Fechado: {closedDaysLabel}</span>
              </div>
            )}
          </div>

          {/* 2. AVISO SOBRE O TEMPO DE PREPARO (Normal 40m vs Congelados 90m) */}
          <div className="p-3.5 bg-amber-50 border border-amber-300 rounded-2xl text-left text-xs text-amber-950 font-medium mb-4 flex items-start gap-2.5 shadow-xs">
            <span className="text-xl shrink-0 mt-0.5">⏳</span>
            <div className="space-y-1">
              <div className="flex items-center gap-2 flex-wrap">
                <strong className="text-amber-900 font-bold uppercase text-[11px] tracking-wider">Tempo Estimado para Retirada</strong>
                {isFrozenOrderActive ? (
                  <span className="text-[11px] font-black text-blue-800">
                    · ❄️ Pedido Congelado (48h / +{frozenPrepMinutes} min no dia)
                  </span>
                ) : (
                  <span className="text-[11px] font-black text-amber-900">
                    · 🥖 Pedido Padrão ({normalPrepMinutes} min)
                  </span>
                )}
              </div>
              <p className="leading-relaxed text-[11px] text-stone-700">
                Pedido normal: <strong>{normalPrepMinutes} min</strong> para retirada. Pedidos com congelados: prazo de produção de até <strong>48 horas</strong> (agendamento +2 dias).
              </p>
              {effectiveSelectedTime && previewPickup && (
                <div className="mt-1.5 p-2 bg-amber-100/80 rounded-xl border border-amber-300 text-amber-950 font-black text-xs flex items-center gap-1.5">
                  <span>🎯</span>
                  <span>Agendando {effectiveSelectedTime} → Retirada às <strong>{previewPickup}h</strong></span>
                </div>
              )}
            </div>
          </div>

          {/* 3. GRADE DE HORÁRIOS DISPONÍVEIS POR CAPACIDADE DE SALGADOS */}
          <div ref={scheduleSlotsSectionRef} className="space-y-2 text-left mb-5">
            <div className="flex items-center justify-between gap-2 flex-wrap">
              <label className="block text-xs font-black text-stone-700 uppercase tracking-wider">
                2. Horários ({activeDay?.dayName}):
              </label>
              <div className="flex items-center gap-1.5 flex-wrap">
                {activeDayConfig && activeDayConfig.isOpen && (
                  <span className="text-[10px] font-bold text-amber-800 bg-amber-50 px-2 py-0.5 rounded-md border border-amber-200">
                    Expediente: {activeDayConfig.openTime} às {activeDayConfig.closeTime}
                    {activeDayConfig.hasBreak && activeDayConfig.breakStart && activeDayConfig.breakEnd
                      ? ` (Pausa ${activeDayConfig.breakStart}–${activeDayConfig.breakEnd})`
                      : ''}
                  </span>
                )}
                <span className="text-[10px] font-bold text-stone-500 bg-stone-100 px-2 py-0.5 rounded-md border border-stone-200">
                  {Number(storeInfo.scheduleIntervalMinutes) === 60 ? 'Intervalo: 1 em 1 hora' : 'Intervalo: 30 em 30 min'}
                </span>
              </div>
            </div>

            {slots.length === 0 ? (
              <div className="p-4 rounded-2xl border border-stone-200 bg-stone-50 text-center text-xs font-semibold text-stone-600">
                Nenhum horário disponível neste dia dentro do expediente configurado. Por favor, selecione outro dia acima.
              </div>
            ) : (
            <div className="grid grid-cols-2 sm:grid-cols-3 gap-2 max-h-56 overflow-y-auto p-1.5 border border-stone-100 rounded-2xl bg-stone-50/50">
              {slots.map(slot => {
                const status = getSlotStatus(slot);
                const isSelected = effectiveSelectedTime === slot;

                return (
                  <button
                    key={slot}
                    type="button"
                    disabled={status.isDisabled}
                    onClick={() => {
                      if (!status.isDisabled && activeDay) {
                        setSelectedScheduleTime(slot);
                        setSelectedScheduleDate(activeDay.dateStr);
                        setSelectedScheduleDay(activeDay.dayName);
                        safeStorage.setItem('balbec_selected_schedule_time', slot);
                        safeStorage.setItem('balbec_selected_schedule_date', activeDay.dateStr);
                        safeStorage.setItem('balbec_selected_schedule_day', activeDay.dayName);
                        // Rolagem automática suave para o botão de confirmação
                        setTimeout(() => {
                          scheduleConfirmBtnRef.current?.scrollIntoView({ behavior: 'smooth', block: 'center' });
                        }, 150);
                      }
                    }}
                    className={`p-2.5 rounded-xl border text-xs font-black transition-all flex flex-col items-center justify-center gap-1 ${
                      status.isDisabled 
                        ? 'bg-stone-100 text-stone-400 border-stone-200 cursor-not-allowed opacity-60' 
                        : isSelected 
                          ? (isFrozenOrderActive ? 'bg-blue-600 text-white border-blue-600 shadow-xs scale-102 cursor-pointer ring-2 ring-blue-300' : 'bg-orange-600 text-white border-orange-600 shadow-xs scale-102 cursor-pointer ring-2 ring-orange-300')
                          : 'bg-white text-stone-800 border-stone-200 hover:bg-orange-50 cursor-pointer'
                    }`}
                  >
                    <div className="flex items-center gap-1.5 font-mono text-sm">
                      <span>{status.isPast ? '❌' : status.isFull ? '🔒' : '🕐'}</span>
                      <span className={status.isDisabled ? 'line-through opacity-50' : ''}>{slot}</span>
                    </div>
                    <span className={`text-[9px] px-2 py-0.5 rounded-md uppercase font-black ${
                      status.isFull 
                        ? 'bg-red-100 text-red-700' 
                        : status.isPast 
                          ? 'bg-stone-200 text-stone-500' 
                          : isSelected
                            ? 'bg-white/20 text-white'
                            : 'bg-emerald-100 text-emerald-800'
                    }`}>
                      {status.isFull 
                        ? `Esgotado (${status.slotCap}/${status.slotCap})` 
                        : status.isPast 
                          ? 'Encerrado' 
                          : `${status.remainingUnits} de ${status.slotCap} un.`}
                    </span>
                  </button>
                );
              })}
            </div>
            )}
          </div>

          <button
            ref={scheduleConfirmBtnRef}
            type="button"
            disabled={!effectiveSelectedTime || !activeDay}
            onClick={() => {
              if (!effectiveSelectedTime || !activeDay) {
                alert('O agendamento do horário de retirada é obrigatório. Por favor, escolha um dos horários disponíveis acima.');
                return;
              }
              setSelectedScheduleTime(effectiveSelectedTime);
              setSelectedScheduleDate(activeDay.dateStr);
              setSelectedScheduleDay(activeDay.dayName);
              safeStorage.setItem('balbec_selected_schedule_time', effectiveSelectedTime);
              safeStorage.setItem('balbec_selected_schedule_date', activeDay.dateStr);
              safeStorage.setItem('balbec_selected_schedule_day', activeDay.dayName);

              setShowScheduleSelectionStep(false);
              safeStorage.setSession('selected_sales_channel', 'instore');
              safeStorage.setSession('balbec_qr_validated', 'true');
              setIsQrValidated(true);
              setSalesChannel('instore');
              setDeliveryType('pickup');
              setHasChosenChannel(true);
              setHasName(true);

              if (pendingImpulseProducts.length > 0) {
                const toProcess = [...pendingImpulseProducts];
                setPendingImpulseProducts([]);
                setTimeout(() => {
                  processImpulseProducts(toProcess, !isFrozenOrderActive);
                }, 80);
              } else if (isFrozenOrderActive) {
                const firstFrozenCat = availableCategories.find(c => isCategoryFrozenModality(c));
                if (firstFrozenCat) {
                  setTimeout(() => scrollToCategory(firstFrozenCat.id), 150);
                }
              }
            }}
            className={`w-full py-3.5 sm:py-4 text-white rounded-2xl font-black text-sm sm:text-base transition-all flex items-center justify-center gap-2 ${
              !effectiveSelectedTime || !activeDay
                ? 'bg-stone-300 text-stone-500 cursor-not-allowed shadow-none' 
                : isFrozenOrderActive
                  ? 'hover:scale-[1.01] active:scale-[0.98] shadow-lg shadow-blue-600/25 cursor-pointer bg-blue-600 hover:bg-blue-700'
                  : 'hover:scale-[1.01] active:scale-[0.98] shadow-lg shadow-orange-600/25 cursor-pointer bg-orange-600 hover:bg-orange-700'
            }`}
          >
            <span>{effectiveSelectedTime && activeDay ? `CONFIRMAR PARA ${activeDay.shortDayName.toUpperCase()} (${activeDay.dateFormatted}) ÀS ${effectiveSelectedTime}${previewPickup ? ` (RETIRADA ÀS ${previewPickup}H)` : ''}` : 'SELECIONE UM HORÁRIO ACIMA'}</span>
          </button>

          {canGoBackWithoutChange && (
            <button
              type="button"
              onClick={() => {
                setPendingImpulseProducts([]);
                setShowScheduleSelectionStep(false);
              }}
              className="mt-3 w-full py-2.5 bg-stone-100 hover:bg-stone-200 text-stone-700 rounded-xl font-bold text-xs transition-colors cursor-pointer"
            >
              Voltar sem alterar
            </button>
          )}
        </div>
      </div>
    );
  }

  if (isCheckout) {
    const isKioskMode = salesChannel === 'kiosk' || isTotemPath;
    const isTableOrder = Boolean((salesChannel === 'instore' || deliveryType === 'pickup') && selectedTableNumber !== null);
    const hasFrozenInCart = cart.some(it => 
      Boolean(it.isFrozen) || 
      (Array.isArray(it.addons) && it.addons.some((a: any) => a.isFrozen || a.productId === 'prod_congelado' || (a.name && a.name.toLowerCase().includes('congelad')))) ||
      (it.options && Array.isArray(it.options) && it.options.some((o: any) => o.isFrozen || (o.name && o.name.toLowerCase().includes('congelad'))))
    );
    const normalPrepMins = Number(storeInfo.schedulePrepTimeNormalMinutes) || 40;
    const frozenPrepMins = Number(storeInfo.schedulePrepTimeFrozenMinutes) || 90;
    const checkoutPickupTime = selectedScheduleTime 
      ? calculatePickupTime(selectedScheduleTime, hasFrozenInCart, normalPrepMins, frozenPrepMins) 
      : '';

    return (
      <div className="min-h-screen bg-stone-50 flex flex-col">
        {isSendingOrder && (
          <div className="fixed inset-0 z-[100] flex flex-col items-center justify-center bg-stone-900/90 text-white p-6 text-center">
            <div className="w-16 h-16 border-4 border-orange-500 border-t-transparent rounded-full animate-spin mb-6"></div>
            <h2 className="text-3xl font-bold animate-pulse">
              {isKioskMode ? 'IMPRIMINDO SEU PEDIDO...' : 'ENVIANDO SEU PEDIDO...'}
            </h2>
          </div>
        )}
        <header className="bg-white p-4 shadow-sm flex items-center gap-4">
          <button onClick={() => setIsCheckout(false)} className="p-2 hover:bg-stone-100 rounded-full">
            <ArrowLeft className="w-6 h-6" />
          </button>
          <h1 className="text-2xl font-bold">
            {isKioskMode ? 'Confirmar Pedido' : 'Finalizar Pedido'}
          </h1>
        </header>

        <div className="flex-1 max-w-3xl w-full mx-auto p-3.5 sm:p-6 grid grid-cols-1 md:grid-cols-2 gap-5 sm:gap-8">
          <div>
            <h2 className="text-xl font-bold mb-4">Resumo do Pedido</h2>
            {hasFrozenInCart && (
              <div className="bg-blue-50 border-2 border-blue-300 rounded-2xl p-4 text-blue-950 mb-3 space-y-1 shadow-xs animate-in fade-in">
                <div className="flex items-center gap-2 text-xs sm:text-sm font-black text-blue-900 uppercase">
                  <span>❄️</span>
                  <span>Pedido de Salgados Congelados (Prazo até 48h)</span>
                </div>
                <p className="text-[11px] sm:text-xs text-blue-800 font-medium leading-relaxed">
                  Os salgados congelados têm prazo estimado de produção e congelamento de <strong>até 48 horas</strong>, mas <strong>o seu pedido pode ficar pronto antes</strong>! Você receberá avisos assim que estiver disponível.
                </p>
              </div>
            )}
            <div className="bg-white rounded-xl shadow-sm p-4 space-y-4">
              {cart.map(item => (
                <div key={item.productId + (item.prepType || '') + JSON.stringify(item.addons) + JSON.stringify(item.flavor)} className="flex gap-4 items-center">
                  <div className="w-16 h-16 bg-stone-50 rounded-xl overflow-hidden shrink-0 border border-stone-100">
                    <ProductImage 
                      src={item.imageUrl} 
                      alt={item.name}
                      className="w-full h-full object-cover"
                    />
                  </div>
                  <div className="flex-1 flex justify-between items-center">
                    <div>
                      <span className="font-medium">{item.quantity}x</span> <span className="uppercase font-bold">{item.name}</span>
                      {item.prepLabel ? (
                        <div className={`inline-flex items-center gap-1 px-2.5 py-0.5 rounded-md text-xs font-black uppercase tracking-wider my-1 border ${
                          item.isFrozen || item.prepType?.startsWith('congelado')
                            ? 'bg-blue-50 border-blue-200 text-blue-700'
                            : 'bg-amber-50 border-amber-200 text-amber-800'
                        }`}>
                          <span>{item.isFrozen || item.prepType?.startsWith('congelado') ? '❄️' : '🔥'}</span>
                          <span>{item.prepLabel}</span>
                        </div>
                      ) : (item.isFrozen || item.addons?.some((a: any) => a.isFrozen || a.productId === 'prod_congelado' || (a.name && a.name.toLowerCase().includes('congelad')))) ? (
                        <div className="inline-flex items-center gap-1 px-2 py-0.5 rounded-md bg-blue-50 border border-blue-200 text-blue-600 animate-pulse text-xs font-black uppercase tracking-wider my-1">
                          <span>❄️</span>
                          <span>CONGELADO</span>
                        </div>
                      ) : null}
                      {item.description && (
                        <div className="text-xs text-red-600 italic font-medium mt-0.5">
                          {formatCapitalized(item.description)}
                        </div>
                      )}
                      {item.flavor && (
                        <div className={`text-sm uppercase py-0.5 rounded-sm my-0.5 pl-2 border-l-2 ${
                          (item.flavor.name || '').toLowerCase().includes('congelado') || (item.flavor.name || '').toLowerCase().includes('normal')
                            ? 'text-red-700 font-black bg-red-50 border-red-500'
                            : 'text-stone-500 border-stone-200'
                        }`}>
                          Sabor: {item.flavor.name}
                          {resolveAddonCode(item.flavor) && (
                            <span className="font-mono font-bold text-stone-700 ml-1.5">[CÓD: {resolveAddonCode(item.flavor)}]</span>
                          )}
                        </div>
                      )}
                      {item.addons && item.addons.length > 0 && (
                        <div className="text-sm uppercase space-y-0.5 mt-1">
                          {item.addons.map((a, aIdx) => {
                            const aCode = a.externalId || a.code || resolveAddonCode(a);
                            const isHighlight = (a.name || '').toLowerCase().includes('congelado') || (a.name || '').toLowerCase().includes('normal');
                            return (
                              <div key={aIdx} className={`py-0.5 rounded-sm pl-2 border-l-2 ${isHighlight ? 'text-red-700 font-black bg-red-50 border-red-500' : 'text-stone-500 border-stone-200'}`}>
                                + {a.name}
                                {aCode && (
                                  <span className="font-mono font-bold text-stone-700 ml-1.5">[CÓD: {aCode}]</span>
                                )}
                              </div>
                            );
                          })}
                        </div>
                      )}
                    </div>
                    <div className="flex items-center gap-2 shrink-0">
                      <div className="font-bold text-stone-900">{formatCurrency((item.price + (item.flavor?.price || 0) + (item.addons?.reduce((sum, a) => sum + a.price, 0) || 0)) * item.quantity)}</div>
                      <button
                        type="button"
                        onClick={() => {
                          setCart(prev => prev.filter(ci => !(ci.productId === item.productId && (ci.prepType || '') === (item.prepType || '') && JSON.stringify(ci.addons) === JSON.stringify(item.addons) && JSON.stringify(ci.flavor) === JSON.stringify(item.flavor))));
                        }}
                        className="p-1 text-stone-400 hover:text-red-600 hover:bg-red-50 rounded-lg transition-colors cursor-pointer"
                        title="Excluir item do pedido"
                      >
                        <Trash2 className="w-4 h-4 text-red-500" />
                      </button>
                    </div>
                  </div>
                </div>
              ))}
              <div className="border-t pt-4 flex justify-between items-center text-xl font-black text-stone-900">
                <span>Total do Pedido</span>
                <span style={{ color: storeInfo.themeColor }}>{formatCurrency(total)}</span>
              </div>

              {hasFrozenInCart && frozenPaymentPlan === 'parcial' && (
                <div className="bg-blue-50 border-2 border-blue-200 rounded-2xl p-3.5 space-y-1.5 animate-in fade-in">
                  <div className="flex items-center justify-between text-xs font-black text-blue-900">
                    <span>💳 Entrada Agora (50% Pix/Débito)</span>
                    <span className="text-sm text-blue-700 font-mono">{formatCurrency(partialFrozenAmount)}</span>
                  </div>
                  <div className="flex items-center justify-between text-xs font-bold text-stone-600">
                    <span>🏪 Saldo na Retirada (50%)</span>
                    <span className="font-mono">{formatCurrency(remainingFrozenAmount)}</span>
                  </div>
                </div>
              )}

              {storeInfo.deliveryScheduleEnabled && (
                <div ref={checkoutScheduleRef} className={`mt-4 p-3.5 rounded-2xl border-2 transition-all ${
                  selectedScheduleTime ? 'bg-amber-50/90 border-amber-300' : 'bg-red-50 border-red-300'
                }`}>
                  <div className="flex items-center justify-between gap-2">
                    <div className="flex items-center gap-2.5">
                      <Clock className={`w-5 h-5 shrink-0 ${selectedScheduleTime ? 'text-amber-600' : 'text-red-600 animate-bounce'}`} />
                      <div>
                        <p className="text-[10px] font-black uppercase tracking-wider text-stone-500">
                          Horário Agendado Retirada {selectedScheduleTime ? '✓' : '(Obrigatório)'}
                        </p>
                        <p className={`text-sm font-black ${selectedScheduleTime ? 'text-stone-900' : 'text-red-600 font-extrabold'}`}>
                          {selectedScheduleTime ? `⏰ ${selectedScheduleDay ? `${selectedScheduleDay} às ` : 'Às '}${selectedScheduleTime}` : 'Nenhum horário selecionado'}
                        </p>
                        {selectedScheduleTime && checkoutPickupTime && (
                          <p className="text-xs font-bold text-amber-900 mt-0.5">
                            {hasFrozenInCart ? '❄️ Retirada estimada: ' : '🥖 Retirada estimada: '}<strong>{checkoutPickupTime}h</strong> ({hasFrozenInCart ? `${frozenPrepMins} min` : `${normalPrepMins} min`})
                          </p>
                        )}
                      </div>
                    </div>
                    <button
                      type="button"
                      onClick={() => {
                        setScheduleStepMode('pickup');
                        setShowScheduleSelectionStep(true);
                        window.scrollTo(0, 0);
                      }}
                      className="px-3 py-1.5 bg-white hover:bg-amber-100 text-stone-800 rounded-xl text-xs font-black border border-stone-300 shadow-2xs cursor-pointer transition-colors"
                    >
                      {selectedScheduleTime ? 'Alterar Horário 🕒' : 'Escolher'}
                    </button>
                  </div>
                </div>
              )}
            </div>
          </div>

          <div>
            {/* Opções de Entrega / Retirada */}
            {isKioskMode ? (
              <div className="space-y-6">
                <div>
                  <h2 className="text-xl font-bold mb-3 flex items-center gap-2 text-stone-800">
                    <span>🏪</span> Modalidade do Pedido
                  </h2>
                  <div className="p-4 bg-orange-50 border-2 border-orange-500 rounded-2xl flex items-center gap-3 text-orange-900 shadow-xs">
                    <div className="w-10 h-10 rounded-xl bg-orange-200/70 flex items-center justify-center text-xl shrink-0">
                      🛍️
                    </div>
                    <div>
                      <div className="font-black text-sm uppercase tracking-wide">Retirada no Balcão (Totem)</div>
                      <div className="text-xs text-orange-800">Ao clicar em imprimir, será gerado o seu cupom com o número do pedido.</div>
                    </div>
                  </div>
                </div>

                <div className="p-4 bg-emerald-50 border border-emerald-200 rounded-2xl text-emerald-900 text-xs sm:text-sm font-medium">
                  <p className="font-bold text-emerald-950 mb-1 flex items-center gap-1.5">
                    <Printer className="w-4 h-4 text-emerald-600 shrink-0" />
                    <span>Impressão Direta do Comprovante</span>
                  </p>
                  <span>Retire seu cupom impresso e acompanhe a chamada da sua senha na TV da loja.</span>
                </div>

                {/* Botão Final Totem: Apenas Imprimir */}
                <button 
                  onClick={() => handleCheckout()}
                  disabled={isSendingOrder}
                  className="w-full py-4.5 px-6 bg-emerald-600 hover:bg-emerald-700 active:bg-emerald-800 active:scale-[0.98] text-white rounded-2xl font-black text-xl transition-all disabled:opacity-50 cursor-pointer shadow-xl shadow-emerald-600/30 flex items-center justify-center gap-3 select-none"
                >
                  <Printer className="w-7 h-7 animate-pulse" />
                  <span>{isSendingOrder ? 'Imprimindo...' : 'Imprimir'}</span>
                </button>

                <button
                  type="button"
                  onClick={() => setIsCheckout(false)}
                  className="w-full py-3 bg-stone-100 hover:bg-stone-200 text-stone-700 rounded-xl font-bold text-sm transition-colors cursor-pointer border border-stone-200 flex items-center justify-center gap-2"
                >
                  <ArrowLeft className="w-4 h-4 text-orange-600" />
                  <span>Voltar ao Cardápio e Escolher Mais Itens</span>
                </button>
              </div>
            ) : (
              <div>
                {/* Modalidade do Pedido (Exclusivo Retirada no Balcão) */}
                {!selectedTableNumber && (
                  <div className="mb-6">
                    <h2 className="text-xl font-bold mb-3 flex items-center gap-2 text-stone-800">
                      <Store className="w-5 h-5 text-orange-600" />
                      <span>Modalidade do Pedido</span>
                    </h2>
                    <div className="p-4 bg-orange-50 border-2 border-orange-500 rounded-2xl flex items-center gap-3.5 shadow-xs">
                      <div className="w-11 h-11 rounded-2xl bg-orange-600 text-white flex items-center justify-center font-bold text-xl shrink-0 shadow-sm shadow-orange-600/30">
                        🛍️
                      </div>
                      <div>
                        <p className="font-black text-stone-900 text-sm uppercase tracking-tight">Retirada no Balcão da Loja</p>
                        <p className="text-xs text-stone-600 font-medium mt-0.5">
                          Seu pedido será preparado e embalado com todo o cuidado para você retirar diretamente no balcão da loja.
                        </p>
                      </div>
                    </div>
                  </div>
                )}

                {/* Bloco de Mesa para Consumo na Loja - APENAS se já estiver com mesa identificada (via QR) */}
                {deliveryType === 'pickup' && selectedTableNumber && (
                  <div className="bg-amber-50/80 border-2 border-amber-300 rounded-2xl p-4 sm:p-5 mb-8 space-y-3 shadow-xs">
                    <div className="flex items-center justify-between">
                      <div className="flex items-center gap-2.5">
                        <div className="w-9 h-9 rounded-xl bg-amber-500 text-white flex items-center justify-center font-black shadow-sm shrink-0">
                          <UtensilsCrossed className="w-5 h-5" />
                        </div>
                        <div>
                          <h3 className="text-sm sm:text-base font-black text-stone-900">
                            {selectedTableNumber ? `Mesa ${selectedTableNumber} Selecionada` : 'Onde você está sentado?'}
                          </h3>
                          <p className="text-xs text-stone-600">
                            {selectedTableNumber 
                              ? 'Seu pedido será entregue diretamente nesta mesa.' 
                              : 'Selecione a sua mesa ou informe se é para retirada no balcão.'}
                          </p>
                        </div>
                      </div>
                      {selectedTableNumber ? (
                        <button
                          type="button"
                          onClick={() => setShowTableSelectModal(true)}
                          className="text-xs font-bold text-amber-900 bg-white px-2.5 py-1.5 rounded-lg border border-amber-300 shadow-2xs hover:bg-amber-100 cursor-pointer shrink-0"
                        >
                          Trocar Mesa
                        </button>
                      ) : null}
                    </div>

                    {selectedTableNumber ? (
                      <div className="flex items-center justify-between gap-2 p-3 bg-white rounded-xl border border-amber-200 text-xs font-bold text-amber-900">
                        <div className="flex items-center gap-2">
                          <span className="w-2.5 h-2.5 rounded-full bg-emerald-500 animate-pulse"></span>
                          <span>🍽️ Mesa #{selectedTableNumber} identificada! Os atendentes levarão seu pedido até a mesa.</span>
                        </div>
                        <button
                          type="button"
                          onClick={() => {
                            setSelectedTableNumber(null);
                            safeStorage.removeItem('balbec_selected_table');
                          }}
                          className="text-[11px] text-stone-400 hover:text-red-600 underline cursor-pointer"
                        >
                          Retirada no Balcão
                        </button>
                      </div>
                    ) : (
                      <div className="space-y-2.5 pt-1">
                        <div className="flex flex-wrap gap-2">
                          {tables && tables.filter(t => t.isActive).length > 0 ? (
                            tables.filter(t => t.isActive).map(tbl => (
                              <button
                                key={tbl.id}
                                type="button"
                                onClick={() => {
                                  setSelectedTableNumber(tbl.number);
                                  safeStorage.setSession('balbec_selected_table', String(tbl.number));
                                }}
                                className={`px-3.5 py-2 rounded-xl text-xs font-black transition-all cursor-pointer border ${
                                  selectedTableNumber === tbl.number
                                    ? 'bg-amber-600 text-white border-amber-700 shadow-sm'
                                    : 'bg-white text-stone-700 border-stone-200 hover:border-amber-400 hover:bg-amber-50'
                                }`}
                              >
                                Mesa {tbl.number}
                              </button>
                            ))
                          ) : (
                            <div className="flex items-center gap-2 w-full">
                              <input
                                type="number"
                                min="1"
                                max="999"
                                placeholder="Digite o número da mesa (ex: 5)"
                                value={selectedTableNumber || ''}
                                onChange={(e) => {
                                  const val = parseInt(e.target.value, 10);
                                  setSelectedTableNumber(isNaN(val) ? null : val);
                                  if (!isNaN(val)) safeStorage.setSession('balbec_selected_table', String(val));
                                }}
                                className="w-full sm:w-56 p-2.5 bg-white border border-stone-300 rounded-xl text-sm font-bold text-stone-800"
                              />
                            </div>
                          )}
                        </div>
                        <p className="text-[11px] text-stone-500 italic">
                          💡 Dica: Você também pode escanear o QR Code em cima da sua mesa para identificar automaticamente!
                        </p>
                      </div>
                    )}
                  </div>
                )}

                {/* Validação de Presença para Consumo na Loja (GPS e/ou PIN do Balcão) */}
                {deliveryType === 'pickup' && (storeInfo.inStoreGpsValidation || storeInfo.inStorePinValidation) && (
                  <div className="bg-amber-50/70 border border-amber-300/80 rounded-2xl p-4 sm:p-5 mb-8 space-y-4 shadow-xs">
                    <div className="flex items-center gap-2.5">
                      <div className="w-8 h-8 rounded-xl bg-amber-200/80 flex items-center justify-center text-amber-900 shrink-0">
                        <ShieldCheck className="w-4 h-4 text-amber-800" />
                      </div>
                      <div>
                        <h3 className="text-sm font-extrabold text-stone-900">
                          Validação de Presença no Local
                        </h3>
                        <p className="text-xs text-stone-600">
                          O consumo na loja é exclusivo para clientes presentes no estabelecimento.
                        </p>
                      </div>
                    </div>

                    {/* Bloco 1: Validação GPS se ativada */}
                    {storeInfo.inStoreGpsValidation && (
                      <div className="bg-white p-3.5 rounded-xl border border-amber-200 space-y-2.5">
                        <div className="flex items-center justify-between">
                          <div className="flex items-center gap-2">
                            <MapPin className="w-4 h-4 text-amber-600 shrink-0" />
                            <span className="text-xs font-bold text-stone-800">
                              Localização / GPS da Loja
                            </span>
                          </div>
                          {gpsStatus === 'verified' && (
                            <span className="text-[11px] font-bold text-emerald-700 bg-emerald-50 px-2 py-0.5 rounded-md border border-emerald-200 flex items-center gap-1">
                              <CheckCircle2 className="w-3 h-3 text-emerald-600" />
                              Presença Confirmada
                            </span>
                          )}
                        </div>

                        {gpsStatus === 'idle' && (
                          <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2">
                            <p className="text-xs text-stone-500">
                              Verifique sua localização para liberar o pedido de consumo na loja.
                            </p>
                            <button
                              type="button"
                              onClick={() => verifyInStoreGps()}
                              className="px-3 py-1.5 bg-amber-600 hover:bg-amber-700 text-white rounded-lg text-xs font-bold transition-colors cursor-pointer flex items-center justify-center gap-1.5 shrink-0 shadow-xs"
                            >
                              <LocateFixed className="w-3.5 h-3.5" />
                              <span>Verificar GPS</span>
                            </button>
                          </div>
                        )}

                        {gpsStatus === 'checking' && (
                          <div className="flex items-center gap-2 text-xs text-amber-800 font-semibold p-2 bg-amber-50 rounded-lg">
                            <RefreshCw className="w-4 h-4 animate-spin text-amber-600" />
                            <span>Consultando GPS e calculando distância até a loja...</span>
                          </div>
                        )}

                        {gpsStatus === 'verified' && gpsDistance !== null && (
                          <div className="p-2.5 bg-emerald-50 rounded-lg border border-emerald-200 text-xs text-emerald-900 flex items-center justify-between">
                            <span>
                              📍 Você está a <strong>{formatDistance(gpsDistance)}</strong> da loja (dentro do limite permitido de {formatDistance(storeInfo.inStoreMaxRadiusMeters || 150)}).
                            </span>
                            <button
                              type="button"
                              onClick={() => verifyInStoreGps()}
                              className="text-[11px] text-emerald-700 underline hover:text-emerald-800 font-bold ml-2 shrink-0 cursor-pointer"
                            >
                              Recalcular
                            </button>
                          </div>
                        )}

                        {gpsStatus === 'out_of_range' && gpsDistance !== null && (
                          <div className="p-3 bg-red-50 rounded-xl border border-red-200 text-xs text-red-900 space-y-2">
                            <div className="flex items-start gap-2">
                              <AlertTriangle className="w-4 h-4 text-red-600 shrink-0 mt-0.5" />
                              <div>
                                <p className="font-bold">Você está fora do raio da loja ({formatDistance(gpsDistance)})</p>
                                <p className="text-red-700 text-[11px] mt-0.5">
                                  O consumo na mesa requer que você esteja no estabelecimento (até {formatDistance(storeInfo.inStoreMaxRadiusMeters || 150)}). Aproxime-se do local ou faça seu pedido diretamente para retirada no balcão.
                                </p>
                              </div>
                            </div>
                            <div className="flex items-center gap-2">
                              <button
                                type="button"
                                onClick={() => verifyInStoreGps()}
                                className="px-3 py-1.5 bg-red-600 text-white rounded-lg font-bold text-xs hover:bg-red-700 transition-colors cursor-pointer"
                              >
                                Tentar GPS Novamente
                              </button>
                            </div>
                          </div>
                        )}

                        {gpsStatus === 'denied' && (
                          <div className="p-3 bg-red-50 rounded-xl border border-red-200 text-xs text-red-900 space-y-2">
                            <div className="flex items-start gap-2">
                              <ShieldAlert className="w-4 h-4 text-red-600 shrink-0 mt-0.5" />
                              <div>
                                <p className="font-bold">Permissão de GPS necessária</p>
                                <p className="text-red-700 text-[11px] mt-0.5">
                                  {gpsError || 'Não foi possível obter sua localização. Autorize a localização no navegador para confirmar que você está na loja.'}
                                </p>
                              </div>
                            </div>
                            <div className="flex items-center gap-2">
                              <button
                                type="button"
                                onClick={() => verifyInStoreGps()}
                                className="px-3 py-1.5 bg-amber-600 text-white rounded-lg font-bold text-xs hover:bg-amber-700 transition-colors cursor-pointer flex items-center gap-1"
                              >
                                <LocateFixed className="w-3.5 h-3.5" />
                                <span>Autorizar e Tentar Novamente</span>
                              </button>
                            </div>
                          </div>
                        )}
                      </div>
                    )}

                    {/* Bloco 2: Validação por Código / PIN do Balcão se ativada */}
                    {storeInfo.inStorePinValidation && (
                      <div className="bg-white p-3.5 rounded-xl border border-amber-200 space-y-2.5">
                        <div className="flex items-center gap-2">
                          <KeyRound className="w-4 h-4 text-amber-600 shrink-0" />
                          <span className="text-xs font-bold text-stone-800">
                            Código / PIN do Balcão ou Mesa
                          </span>
                        </div>
                        <p className="text-xs text-stone-500">
                          Informe o código de validação exibido no balcão ou na mesa para confirmar seu pedido no local.
                        </p>
                        <div className="flex items-center gap-2">
                          <input
                            type="text"
                            maxLength={10}
                            value={customerPinInput}
                            onChange={(e) => setCustomerPinInput(e.target.value.toUpperCase())}
                            placeholder="DIGITE O CÓDIGO (EX: 1234)"
                            className="w-full sm:w-64 p-2.5 bg-stone-50 border border-stone-300 rounded-xl text-center font-mono font-black tracking-widest text-stone-900 focus:bg-white focus:ring-2 focus:ring-amber-500 uppercase text-base"
                          />
                          {customerPinInput.trim() && (
                            <span className="text-xs text-stone-500 font-medium">
                              {customerPinInput.trim().toUpperCase() === (storeInfo.inStorePinCode || '1234').trim().toUpperCase() ? (
                                <span className="text-emerald-700 font-bold flex items-center gap-1">
                                  <CheckCircle2 className="w-3.5 h-3.5 text-emerald-600" /> Código Válido
                                </span>
                              ) : (
                                <span className="text-stone-400">Verifique o código</span>
                              )}
                            </span>
                          )}
                        </div>
                      </div>
                    )}
                  </div>
                )}

                <h2 ref={checkoutCustomerRef} className="text-xl font-bold mb-4 flex items-center gap-2 text-stone-800">
                  <UserIcon className="w-5 h-5 text-orange-600" />
                  Identificação do Cliente (Preparo & Retirada)
                </h2>
                <div className="bg-orange-50/60 border border-orange-200 rounded-xl shadow-sm p-4 mb-8 space-y-4">
                  {/* Status da Conta do Cliente */}
                  {activeCustomer ? (
                    <div className="bg-emerald-50 border border-emerald-200 rounded-xl p-3 flex items-center justify-between shadow-2xs">
                      <div className="flex items-center gap-2.5 text-emerald-900">
                        <div className="w-8 h-8 rounded-full bg-emerald-600 text-white flex items-center justify-center shrink-0 font-bold shadow-xs">
                          <UserCheck className="w-4 h-4" />
                        </div>
                        <div>
                          <p className="text-xs font-black uppercase tracking-tight">Conectado: {activeCustomer.name}</p>
                          <p className="text-[11px] text-emerald-700 font-medium">{activeCustomer.phone || activeCustomer.email}</p>
                        </div>
                      </div>
                      <button
                        type="button"
                        onClick={() => {
                          if (confirm(`Deseja desconectar da conta de ${activeCustomer.name}?`)) {
                            handleCustomerLogout();
                          }
                        }}
                        className="text-xs font-bold text-red-600 hover:text-red-700 hover:underline cursor-pointer bg-white px-2.5 py-1.5 rounded-lg border border-red-200 shadow-2xs"
                      >
                        Desconectar
                      </button>
                    </div>
                  ) : (
                    <div className="flex items-center justify-between bg-white p-3 rounded-xl border border-stone-200 shadow-2xs">
                      <div className="flex items-center gap-2 text-stone-700 text-xs font-medium">
                        <UserIcon className="w-4 h-4 text-stone-500 shrink-0" />
                        <span>Já possui cadastro em nossa loja?</span>
                      </div>
                      <button
                        type="button"
                        onClick={() => {
                          setAuthMode('login');
                          setAuthError('');
                          setAuthSuccessMsg('');
                          setIsAuthModalOpen(true);
                        }}
                        className="text-xs font-bold text-orange-600 hover:text-orange-700 hover:underline cursor-pointer flex items-center gap-1 bg-orange-50 px-2.5 py-1.5 rounded-lg border border-orange-200 shadow-2xs"
                      >
                        <LogIn className="w-3.5 h-3.5" />
                        <span>Entrar / Login</span>
                      </button>
                    </div>
                  )}

                  <div>
                    <label className="block text-sm font-bold text-stone-800 mb-1">
                      Nome do Cliente <span className="text-xs font-normal text-stone-500">(Identificação)</span> *
                    </label>
                    <input 
                      type="text" 
                      value={customerName} 
                      onChange={(e) => setCustomerName(e.target.value)}
                      className="w-full p-3 border border-stone-300 rounded-lg focus:ring-2 focus:ring-orange-500 font-semibold text-stone-800 uppercase bg-white"
                      placeholder="Digite seu nome completo"
                      required
                    />
                  </div>
                  
                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                    <div>
                      <label className="block text-sm font-medium text-stone-700 mb-1">WhatsApp de Contato (Seu Usuário) *</label>
                      <input 
                        type="tel" 
                        value={customerPhone} 
                        onChange={handlePhoneChange}
                        className="w-full p-3 border border-stone-300 rounded-lg focus:ring-2 focus:ring-orange-500 bg-white font-medium"
                        placeholder="(00) 00000-0000"
                        required
                      />
                    </div>
                  </div>

                  {deliveryType === 'pickup' && !activeCustomer && (
                    <div className="pt-3 border-t border-orange-200 space-y-3">
                      <label className="flex items-center gap-2 cursor-pointer select-none">
                        <input
                          type="checkbox"
                          checked={pickupCreateAccount}
                          onChange={(e) => setPickupCreateAccount(e.target.checked)}
                          className="w-4 h-4 text-orange-600 rounded focus:ring-orange-500 border-stone-300 cursor-pointer"
                        />
                        <span className="text-xs font-bold text-stone-800 flex items-center gap-1.5">
                          <UserPlus className="w-4 h-4 text-orange-600 shrink-0" />
                          Criar senha para salvar sua conta e agilizar pedidos futuros
                        </span>
                      </label>

                      {pickupCreateAccount && (
                        <div className="bg-white p-3.5 rounded-xl border border-orange-300 shadow-2xs space-y-3 animate-fadeIn">
                          <div>
                            <label className="block text-xs font-bold text-stone-700 mb-1">
                              Senha de Acesso *
                            </label>
                            <input
                              type="password"
                              value={pickupPassword}
                              onChange={(e) => setPickupPassword(e.target.value)}
                              placeholder="Crie uma senha (mínimo 4 dígitos)"
                              className="w-full p-2.5 border border-stone-300 rounded-lg text-sm focus:ring-2 focus:ring-orange-500 bg-stone-50 focus:bg-white"
                            />
                          </div>
                          <p className="text-[11px] text-stone-500 leading-relaxed italic">
                            💡 Ao cadastrar sua senha, seus dados (Nome e WhatsApp) ficarão salvos com segurança para facilitar todos os seus próximos pedidos!
                          </p>
                        </div>
                      )}
                    </div>
                  )}
                </div>

                {/* Condições de Pagamento: Ocultadas para Atendimento de Mesas e Totem */}
                {!isTableOrder ? (
                  <div>
                    <div className="flex items-center justify-between mb-4 gap-2">
                      <h2 ref={checkoutPaymentRef} className="text-xl font-bold flex items-center gap-2 text-stone-800">
                        <CreditCard className="w-5 h-5 text-orange-600" />
                        Forma de Pagamento
                      </h2>
                      {(paymentMode !== null || frozenPaymentPlan !== null) && (
                        <button
                          type="button"
                          onClick={() => {
                            setFrozenPaymentPlan(null);
                            setPaymentMode(null);
                            setPaymentMethod('');
                          }}
                          className="text-[10px] font-black text-orange-600 hover:text-orange-700 bg-orange-50 hover:bg-orange-100 px-2.5 py-1.5 rounded-xl border border-orange-200 transition-all flex items-center gap-1.5 cursor-pointer shadow-2xs uppercase tracking-wider shrink-0"
                        >
                          <ArrowLeft className="w-3.5 h-3.5" />
                          <span>{hasFrozenInCart ? 'Voltar e Refazer Escolhas' : 'Voltar / Mudar'}</span>
                        </button>
                      )}
                    </div>

                    {hasFrozenInCart ? (
                      <div className="space-y-4">
                        {/* Regra obrigatória para pedidos com produtos congelados */}
                        <div className="bg-blue-50 border-2 border-blue-300 rounded-2xl p-4 space-y-2 shadow-xs">
                          <div className="flex items-center justify-between gap-2">
                            <span className="text-xs font-black uppercase tracking-wider text-blue-900 flex items-center gap-1.5">
                              <span>❄️</span>
                              <span>Pagamento para Produtos Congelados</span>
                            </span>
                            {frozenPaymentPlan && (
                              <span className={`text-[10px] font-black uppercase px-2.5 py-0.5 rounded-full ${
                                frozenPaymentPlan === 'parcial'
                                  ? 'bg-emerald-600 text-white'
                                  : 'bg-blue-700 text-white'
                              }`}>
                                {frozenPaymentPlan === 'parcial' ? 'Parcial (50%)' : 'Integral (100%)'}
                              </span>
                            )}
                          </div>
                          <p className="text-xs text-blue-900 font-medium leading-relaxed">
                            Para pedidos com itens congelados, mesmo optando por pagar na retirada, é necessário confirmar com <strong>50% de entrada via Pix ou Cartão de Débito</strong> (Pagamento Parcial) ou quitar <strong>100% agora</strong> (Pagamento Integral).
                          </p>
                        </div>

                        {frozenPaymentPlan === null ? (
                          <div className="grid grid-cols-1 gap-3">
                            {/* Opção 1: PAGAMENTO INTEGRAL */}
                            <button
                              type="button"
                              onClick={() => {
                                setFrozenPaymentPlan('integral');
                                setPaymentMode('online');
                                setPaymentMethod('');
                              }}
                              className="w-full text-left p-4 rounded-2xl border-2 border-stone-200 bg-white hover:border-blue-500 hover:bg-blue-50/40 transition-all cursor-pointer shadow-xs group"
                            >
                              <div className="flex items-center justify-between gap-2 mb-1.5">
                                <span className="font-black text-sm sm:text-base text-stone-900 uppercase tracking-tight flex items-center gap-2">
                                  <CheckCircle2 className="w-5 h-5 text-blue-600 shrink-0" />
                                  <span>PAGAMENTO INTEGRAL</span>
                                </span>
                                <span className="bg-blue-600 text-white text-xs font-black px-2.5 py-1 rounded-xl font-mono shrink-0">
                                  {formatCurrency(total)}
                                </span>
                              </div>
                              <p className="text-xs text-stone-600 font-medium leading-relaxed">
                                Pague <strong>100% do valor do pedido</strong> agora no <strong>Pix</strong> ou <strong>Cartão de Débito</strong> e finalize sua compra normalmente.
                              </p>
                            </button>

                            {/* Opção 2: PAGAMENTO PARCIAL (50%) */}
                            <button
                              type="button"
                              onClick={() => {
                                setFrozenPaymentPlan('parcial');
                                setPaymentMode('online');
                                setPaymentMethod('');
                              }}
                              className="w-full text-left p-4 rounded-2xl border-2 border-emerald-300 bg-emerald-50/50 hover:border-emerald-600 hover:bg-emerald-50 transition-all cursor-pointer shadow-xs group"
                            >
                              <div className="flex items-center justify-between gap-2 mb-1.5">
                                <span className="font-black text-sm sm:text-base text-emerald-950 uppercase tracking-tight flex items-center gap-2">
                                  <QrCode className="w-5 h-5 text-emerald-600 shrink-0" />
                                  <span>PAGAMENTO PARCIAL (50%)</span>
                                </span>
                                <span className="bg-emerald-600 text-white text-xs font-black px-2.5 py-1 rounded-xl font-mono shrink-0">
                                  50%: {formatCurrency(partialFrozenAmount)}
                                </span>
                              </div>
                              <p className="text-xs text-emerald-900 font-medium leading-relaxed">
                                Pague na retirada garantindo com <strong>50% de entrada agora ({formatCurrency(partialFrozenAmount)})</strong> via <strong>Pix</strong> ou <strong>Cartão de Débito</strong>, e os <strong>50% restantes ({formatCurrency(remainingFrozenAmount)})</strong> no balcão ao retirar.
                              </p>
                            </button>
                          </div>
                        ) : (
                          <div className="space-y-4 animate-in fade-in duration-150">
                            {/* Resumo dos valores conforme plano escolhido */}
                            {frozenPaymentPlan === 'parcial' ? (
                              <div className="bg-emerald-50 border-2 border-emerald-400 rounded-2xl p-4 space-y-2 shadow-xs">
                                <div className="flex items-center justify-between gap-2">
                                  <span className="text-[11px] font-black uppercase tracking-wider text-emerald-800">
                                    Pagamento Parcial Selecionado (50% Entrada)
                                  </span>
                                  <button
                                    type="button"
                                    onClick={() => {
                                      setFrozenPaymentPlan(null);
                                      setPaymentMode(null);
                                      setPaymentMethod('');
                                    }}
                                    className="text-[11px] font-black text-emerald-900 bg-white hover:bg-emerald-100 px-2.5 py-1 rounded-lg border border-emerald-300 flex items-center gap-1 cursor-pointer transition-colors"
                                  >
                                    <RefreshCw className="w-3 h-3" />
                                    <span>Voltar e Refazer Escolhas</span>
                                  </button>
                                </div>
                                <div className="grid grid-cols-3 gap-2 pt-1 text-center">
                                  <div className="bg-white rounded-xl p-2 border border-emerald-200">
                                    <span className="block text-[9px] font-bold uppercase text-stone-500">Total Pedido</span>
                                    <span className="text-xs sm:text-sm font-black text-stone-800 font-mono">{formatCurrency(total)}</span>
                                  </div>
                                  <div className="bg-emerald-600 text-white rounded-xl p-2 shadow-xs">
                                    <span className="block text-[9px] font-black uppercase text-emerald-100">Pagar Agora (50%)</span>
                                    <span className="text-sm sm:text-base font-black font-mono">{formatCurrency(partialFrozenAmount)}</span>
                                  </div>
                                  <div className="bg-white rounded-xl p-2 border border-emerald-200">
                                    <span className="block text-[9px] font-bold uppercase text-stone-500">Na Retirada (50%)</span>
                                    <span className="text-xs sm:text-sm font-black text-stone-800 font-mono">{formatCurrency(remainingFrozenAmount)}</span>
                                  </div>
                                </div>
                              </div>
                            ) : (
                              <div className="bg-blue-50 border-2 border-blue-400 rounded-2xl p-4 flex flex-col sm:flex-row sm:items-center justify-between gap-2 shadow-xs">
                                <div>
                                  <span className="text-[11px] font-black uppercase tracking-wider text-blue-800 block">
                                    Pagamento Integral Selecionado (100%)
                                  </span>
                                  <span className="text-sm font-black text-blue-950 font-mono">
                                    Valor Total a Pagar: {formatCurrency(total)}
                                  </span>
                                </div>
                                <button
                                  type="button"
                                  onClick={() => {
                                    setFrozenPaymentPlan(null);
                                    setPaymentMode(null);
                                    setPaymentMethod('');
                                  }}
                                  className="text-[11px] font-black text-blue-900 bg-white hover:bg-blue-100 px-3 py-1.5 rounded-xl border border-blue-300 flex items-center gap-1.5 cursor-pointer transition-colors self-start sm:self-center shrink-0"
                                >
                                  <RefreshCw className="w-3.5 h-3.5" />
                                  <span>Voltar e Refazer Escolhas</span>
                                </button>
                              </div>
                            )}

                            {/* Escolha entre PIX ou Cartão de Débito para o valor calculado (100% ou 50%) */}
                            <div className={`p-4 rounded-2xl border-2 transition-all ${
                              paymentMethod
                                ? (frozenPaymentPlan === 'parcial' ? 'border-emerald-600 bg-emerald-50/30 shadow-sm' : 'border-blue-600 bg-blue-50/30 shadow-sm')
                                : 'border-stone-200 bg-white'
                            }`}>
                              <div className="flex items-center justify-between pl-1 mb-2.5">
                                <span className={`text-[10px] font-black uppercase tracking-widest ${
                                  frozenPaymentPlan === 'parcial' ? 'text-emerald-700' : 'text-blue-700'
                                }`}>
                                  {frozenPaymentPlan === 'parcial'
                                    ? `Escolha como pagar a entrada de 50% (${formatCurrency(partialFrozenAmount)})`
                                    : `Escolha como pagar o valor integral (${formatCurrency(total)})`}
                                </span>
                              </div>

                              <div className="grid grid-cols-1 gap-2.5">
                                {/* Pix */}
                                <label
                                  className={`flex items-start p-3.5 sm:p-4 border-2 rounded-2xl cursor-pointer transition-all ${
                                    paymentMethod === 'Pix (Online)'
                                      ? 'border-emerald-600 bg-emerald-50/90 shadow-md scale-[1.01]'
                                      : 'border-stone-200 bg-white hover:bg-stone-50'
                                  }`}
                                >
                                  <input
                                    type="radio"
                                    name="payment"
                                    value="Pix (Online)"
                                    checked={paymentMethod === 'Pix (Online)'}
                                    onChange={(e) => {
                                      setPaymentMode('online');
                                      setPaymentMethod(e.target.value);
                                    }}
                                    className="w-5 h-5 text-emerald-600 focus:ring-emerald-500 mt-0.5"
                                  />
                                  <div className="ml-3 flex flex-col flex-1">
                                    <div className="flex items-center justify-between gap-2">
                                      <span className="font-black text-stone-900 flex items-center gap-1.5 uppercase tracking-tight text-sm">
                                        <QrCode className="w-4 h-4 text-emerald-600" />
                                        <span>{frozenPaymentPlan === 'parcial' ? 'Pix (50% Entrada)' : 'Pix'}</span>
                                      </span>
                                      <span className="bg-emerald-600 text-white text-[10px] px-2.5 py-0.5 rounded-full font-black font-mono">
                                        {formatCurrency(frozenPaymentPlan === 'parcial' ? partialFrozenAmount : total)}
                                      </span>
                                    </div>
                                    <span className="text-[11px] text-stone-500 font-medium leading-tight mt-0.5">
                                      {frozenPaymentPlan === 'parcial'
                                        ? `QR Code e Copia e Cola de 50% agora + ${formatCurrency(remainingFrozenAmount)} na retirada.`
                                        : 'QR Code e Copia e Cola com aprovação imediata.'}
                                    </span>
                                  </div>
                                </label>

                                {/* Cartão de Débito */}
                                <label
                                  className={`flex items-start p-3.5 sm:p-4 border-2 rounded-2xl cursor-pointer transition-all ${
                                    paymentMethod === 'Cartão de Débito (Online)'
                                      ? 'border-purple-600 bg-purple-50/90 shadow-md scale-[1.01]'
                                      : 'border-stone-200 bg-white hover:bg-stone-50'
                                  }`}
                                >
                                  <input
                                    type="radio"
                                    name="payment"
                                    value="Cartão de Débito (Online)"
                                    checked={paymentMethod === 'Cartão de Débito (Online)'}
                                    onChange={(e) => {
                                      setPaymentMode('online');
                                      setPaymentMethod(e.target.value);
                                    }}
                                    className="w-5 h-5 text-purple-600 focus:ring-purple-500 mt-0.5"
                                  />
                                  <div className="ml-3 flex flex-col flex-1">
                                    <div className="flex items-center justify-between gap-2">
                                      <span className="font-black text-stone-900 flex items-center gap-1.5 uppercase tracking-tight text-sm">
                                        <CreditCard className="w-4 h-4 text-purple-600" />
                                        <span>{frozenPaymentPlan === 'parcial' ? 'Cartão de Débito (50% Entrada)' : 'Cartão de Débito'}</span>
                                      </span>
                                      <span className="bg-purple-600 text-white text-[10px] px-2.5 py-0.5 rounded-full font-black font-mono">
                                        {formatCurrency(frozenPaymentPlan === 'parcial' ? partialFrozenAmount : total)}
                                      </span>
                                    </div>
                                    <span className="text-[11px] text-stone-500 font-medium leading-tight mt-0.5">
                                      {frozenPaymentPlan === 'parcial'
                                        ? `Débito de 50% agora + ${formatCurrency(remainingFrozenAmount)} na retirada no balcão.`
                                        : 'Débito virtual seguro com aprovação imediata.'}
                                    </span>
                                  </div>
                                </label>
                              </div>
                            </div>
                          </div>
                        )}
                      </div>
                    ) : (
                      <>
                        <p className="text-[10px] text-stone-500 mb-4 -mt-3 italic">Escolha uma modalidade abaixo para habilitar as opções específicas.</p>

                        <div className="space-y-4">
                          {/* Seção 1: Pagamento Online (Mercado Pago: Pix, Crédito e Débito) */}
                          {paymentMode === 'delivery' ? (
                            /* Se o cliente escolheu Pagamento na Entrega, a seção online fica desabilitada e travada */
                            <div className="p-4 bg-stone-100/80 border-2 border-dashed border-stone-300 rounded-2xl flex flex-col sm:flex-row items-center justify-between gap-3 text-stone-500 opacity-60">
                              <div className="flex items-center gap-2.5 text-center sm:text-left">
                                <div className="w-8 h-8 rounded-full bg-stone-200 text-stone-500 flex items-center justify-center shrink-0">
                                  <Lock className="w-4 h-4" />
                                </div>
                                <div>
                                  <p className="text-xs font-black uppercase tracking-wider text-stone-600">
                                    Pagamento Online Desabilitado
                                  </p>
                                  <p className="text-[11px] text-stone-500 font-medium">
                                    Você selecionou pagamento no balcão ({paymentMethod}).
                                  </p>
                                </div>
                              </div>
                              <button
                                type="button"
                                onClick={() => {
                                  setPaymentMode(null);
                                  setPaymentMethod('');
                                }}
                                className="px-3.5 py-2 bg-white hover:bg-stone-50 border border-stone-300 text-stone-700 hover:text-orange-600 rounded-xl text-xs font-bold flex items-center gap-1.5 transition-all shadow-2xs cursor-pointer shrink-0"
                              >
                                <RefreshCw className="w-3.5 h-3.5 text-blue-600" />
                                <span>Mudar para Online</span>
                              </button>
                            </div>
                          ) : storeInfo.mercadoPagoEnabled ? (
                            <div className={`p-4 rounded-2xl border-2 transition-all ${
                              paymentMode === 'online' 
                                ? 'border-blue-600 bg-blue-50/40 shadow-sm' 
                                : 'border-stone-200 bg-white hover:border-blue-200'
                            }`}>
                              <div className="flex items-center justify-between pl-1 mb-2.5">
                                <span className="text-[10px] font-black text-blue-600 uppercase tracking-widest flex items-center gap-1.5">
                                  Pagamento Online (Liberação Imediata)
                                  {paymentMode === 'online' && (
                                    <span className="bg-blue-600 text-white text-[9px] px-2 py-0.5 rounded-full font-black">
                                      Ativo
                                    </span>
                                  )}
                                </span>
                                <span className="text-[10px] bg-blue-100 text-blue-700 font-bold px-2 py-0.5 rounded-full">
                                  Mercado Pago
                                </span>
                              </div>
                              
                              <div className="grid grid-cols-1 gap-2.5">
                                {/* Pix Online */}
                                <label 
                                  className={`flex items-start p-3.5 sm:p-4 border-2 rounded-2xl cursor-pointer transition-all ${
                                    paymentMethod === 'Pix (Online)' 
                                      ? 'border-blue-600 bg-blue-50/90 shadow-md scale-[1.01]' 
                                      : 'border-stone-200 bg-white hover:bg-stone-50'
                                  }`}
                                >
                                  <input 
                                    type="radio" 
                                    name="payment" 
                                    value="Pix (Online)"
                                    checked={paymentMethod === 'Pix (Online)'}
                                    onChange={(e) => {
                                      setPaymentMode('online');
                                      setPaymentMethod(e.target.value);
                                    }}
                                    className="w-5 h-5 text-blue-600 focus:ring-blue-500 mt-0.5"
                                  />
                                  <div className="ml-3 flex flex-col flex-1">
                                    <div className="flex items-center justify-between">
                                      <span className="font-black text-stone-900 flex items-center gap-1.5 uppercase tracking-tight text-sm">
                                        <QrCode className="w-4 h-4 text-emerald-600" />
                                        Pix
                                      </span>
                                      <span className="bg-emerald-600 text-white text-[9px] px-2 py-0.5 rounded-full font-black">
                                        Aprovação Imediata
                                      </span>
                                    </div>
                                    <span className="text-[11px] text-stone-500 font-medium leading-tight mt-0.5">
                                      QR Code e Copia e Cola.
                                    </span>
                                  </div>
                                </label>

                                {/* Cartão de Débito Online */}
                                <label 
                                  className={`flex items-start p-3.5 sm:p-4 border-2 rounded-2xl cursor-pointer transition-all ${
                                    paymentMethod === 'Cartão de Débito (Online)'
                                      ? 'border-blue-600 bg-blue-50/90 shadow-md scale-[1.01]' 
                                      : 'border-stone-200 bg-white hover:bg-stone-50'
                                  }`}
                                >
                                  <input 
                                    type="radio" 
                                    name="payment" 
                                    value="Cartão de Débito (Online)"
                                    checked={paymentMethod === 'Cartão de Débito (Online)'}
                                    onChange={(e) => {
                                      setPaymentMode('online');
                                      setPaymentMethod(e.target.value);
                                    }}
                                    className="w-5 h-5 text-blue-600 focus:ring-blue-500 mt-0.5"
                                  />
                                  <div className="ml-3 flex flex-col flex-1">
                                    <div className="flex items-center justify-between">
                                      <span className="font-black text-stone-900 flex items-center gap-1.5 uppercase tracking-tight text-sm">
                                        <CreditCard className="w-4 h-4 text-purple-600" />
                                        Cartão de Débito
                                      </span>
                                      <span className="bg-purple-600 text-white text-[9px] px-2 py-0.5 rounded-full font-black">
                                        Débito Imediato
                                      </span>
                                    </div>
                                    <span className="text-[11px] text-stone-500 font-medium leading-tight mt-0.5">
                                      Débito virtual seguro.
                                    </span>
                                  </div>
                                </label>
                              </div>
                            </div>
                          ) : (
                            <div className="bg-stone-100 p-3.5 rounded-2xl border border-stone-200 text-stone-600 text-xs flex items-center gap-2.5">
                              <AlertTriangle className="w-4 h-4 text-amber-500 shrink-0" />
                              <span>Pagamento Online desativado no momento. Escolha uma opção de pagamento no balcão.</span>
                            </div>
                          )}

                          {/* Seção 2: Pagamento no Balcão */}
                          {paymentMode === 'online' ? (
                            /* Se o cliente escolheu Pagamento Online, a seção no balcão fica desabilitada e travada */
                            <div className="p-4 bg-stone-100/80 border-2 border-dashed border-stone-300 rounded-2xl flex flex-col sm:flex-row items-center justify-between gap-3 text-stone-500 opacity-60">
                              <div className="flex items-center gap-2.5 text-center sm:text-left">
                                <div className="w-8 h-8 rounded-full bg-stone-200 text-stone-500 flex items-center justify-center shrink-0">
                                  <Lock className="w-4 h-4" />
                                </div>
                                <div>
                                  <p className="text-xs font-black uppercase tracking-wider text-stone-600">
                                    Pagamento no Balcão Desabilitado
                                  </p>
                                  <p className="text-[11px] text-stone-500 font-medium">
                                    Você selecionou pagamento online ({paymentMethod}).
                                  </p>
                                </div>
                              </div>
                              <button
                                type="button"
                                onClick={() => {
                                  setPaymentMode(null);
                                  setPaymentMethod('');
                                }}
                                className="px-3.5 py-2 bg-white hover:bg-stone-50 border border-stone-300 text-stone-700 hover:text-orange-600 rounded-xl text-xs font-bold flex items-center gap-1.5 transition-all shadow-2xs cursor-pointer shrink-0"
                              >
                                <RefreshCw className="w-3.5 h-3.5 text-orange-600" />
                                <span>Mudar para Pagamento na Retirada</span>
                              </button>
                            </div>
                          ) : (
                            <div className={`p-4 rounded-2xl border-2 transition-all ${
                              paymentMode === 'delivery' 
                                ? 'border-orange-600 bg-orange-50/40 shadow-sm' 
                                : 'border-stone-200 bg-white hover:border-orange-200'
                            }`}>
                              <div className="flex items-center justify-between pl-1 mb-2.5">
                                <span className="text-[10px] font-black text-orange-600 uppercase tracking-widest flex items-center gap-1.5">
                                  Pagamento no Balcão
                                  {paymentMode === 'delivery' && (
                                    <span className="bg-orange-600 text-white text-[9px] px-2 py-0.5 rounded-full font-black">
                                      Ativo
                                    </span>
                                  )}
                                </span>
                                <span className="text-[10px] bg-orange-100 text-orange-700 font-bold px-2 py-0.5 rounded-full">
                                  Presencial
                                </span>
                              </div>

                              <div className="grid grid-cols-1 gap-2.5">
                                {['Pix', 'Dinheiro', 'Débito'].map(method => (
                                  <label 
                                    key={method} 
                                    className={`flex items-center p-3.5 sm:p-4 border-2 rounded-2xl cursor-pointer transition-all ${
                                      paymentMethod === method ? 'border-orange-600 bg-orange-50/90 shadow-sm' : 'border-stone-200 bg-white hover:bg-stone-50'
                                    }`}
                                  >
                                    <input 
                                      type="radio" 
                                      name="payment" 
                                      value={method}
                                      checked={paymentMethod === method}
                                      onChange={(e) => {
                                        setPaymentMode('delivery');
                                        setPaymentMethod(e.target.value);
                                      }}
                                      className="w-5 h-5 text-orange-600 focus:ring-orange-500"
                                    />
                                    <span className="ml-3 font-black text-stone-800 uppercase tracking-tight text-sm">{method}</span>
                                  </label>
                                ))}
                              </div>
                            </div>
                          )}
                        </div>
                      </>
                    )}
                  </div>
                ) : (
                  <div className="bg-amber-50/90 border-2 border-amber-300 rounded-2xl p-4 sm:p-5 mb-4 text-amber-950 shadow-xs">
                    <div className="flex items-center gap-3">
                      <div className="w-10 h-10 rounded-xl bg-amber-500 text-white flex items-center justify-center font-black shadow-sm shrink-0">
                        <UtensilsCrossed className="w-5 h-5" />
                      </div>
                      <div>
                        <h3 className="text-sm sm:text-base font-black text-stone-900">
                          Pagamento no Fechamento da Conta (Mesa #{selectedTableNumber})
                        </h3>
                        <p className="text-xs text-amber-800 mt-0.5">
                          Não é necessário escolher forma de pagamento agora. O seu pedido será enviado diretamente para a cozinha e lançado na comanda da sua mesa. O pagamento é realizado na saída ou diretamente com o atendente/caixa.
                        </p>
                      </div>
                    </div>
                  </div>
                )}

                {/* Card Meta do Mês */}
                {renderMonthlyGoalCard()}

                <button 
                  onClick={async () => {
                    if (!customerName.trim()) {
                      alert('Favor preencher o seu nome.');
                      return;
                    }
                    const phoneDigits = customerPhone.replace(/\D/g, '');
                    if (phoneDigits.length < 10) {
                      alert('Favor preencher um WhatsApp válido com DDD.');
                      return;
                    }
                    // Validações de presença para Consumo na Loja
                    if (deliveryType === 'pickup') {
                      if (storeInfo.inStoreGpsValidation) {
                        if (gpsStatus !== 'verified') {
                          const isGpsOk = await verifyInStoreGps();
                          if (!isGpsOk) {
                            alert('Não foi possível confirmar sua presença no local pelo GPS. Por favor, autorize sua localização para concluir o pedido.');
                            return;
                          }
                        }
                      }

                      if (storeInfo.inStorePinValidation) {
                        const enteredPin = customerPinInput.trim().toUpperCase();
                        const expectedPin = (storeInfo.inStorePinCode || '1234').trim().toUpperCase();
                        if (!enteredPin) {
                          alert('Por favor, digite o Código/PIN do balcão ou da mesa para liberar o pedido de consumo no local.');
                          return;
                        }
                        if (enteredPin !== expectedPin) {
                          alert('Código do balcão incorreto! Por favor, consulte o atendente da loja ou o código exibido na mesa.');
                          return;
                        }
                      }
                    }

                    // Validação obrigatória de agendamento de retirada (regra de +2 dias para congelados e expediente do dia)
                    const frozenNeedsLaterDate = storeInfo.deliveryScheduleEnabled && hasFrozenInCart && !isDateAllowedForFrozenOrder(selectedScheduleDate);
                    const slotInvalidForDay = storeInfo.deliveryScheduleEnabled && Boolean(selectedScheduleTime) && !isSlotAllowedForDate(storeInfo, selectedScheduleDate, selectedScheduleTime);
                    if (storeInfo.deliveryScheduleEnabled && (!selectedScheduleTime || frozenNeedsLaterDate || slotInvalidForDay)) {
                      if (frozenNeedsLaterDate) {
                        updateOrderModalityPreference('frozen');
                        clearScheduleSelection();
                      } else if (slotInvalidForDay) {
                        setSelectedScheduleTime('');
                        safeStorage.removeItem('balbec_selected_schedule_time');
                      }
                      setScheduleStepMode('pickup');
                      setShowScheduleSelectionStep(true);
                      alert(frozenNeedsLaterDate
                        ? '❄️ Pedidos com itens congelados precisam de 48h (disponível a partir de +2 dias). Por favor, escolha uma nova data de retirada.'
                        : slotInvalidForDay
                          ? '⏰ O horário selecionado anteriormente não está mais disponível para este dia. Por favor, escolha um novo horário.'
                          : '⏰ O agendamento do horário de retirada é obrigatório. Por favor, escolha um dos horários disponíveis para continuar.');
                      return;
                    }

                    handleCheckout();
                  }}
                  disabled={isSendingOrder}
                  ref={checkoutFinalizeRef}
                  className="w-full mt-8 py-4.5 px-6 bg-emerald-600 hover:bg-emerald-700 active:bg-emerald-800 text-white rounded-2xl font-black text-xl transition-all disabled:opacity-50 cursor-pointer shadow-xl shadow-emerald-600/30 flex items-center justify-center gap-3 select-none"
                >
                  <CheckCircle2 className="w-6 h-6" />
                  <span>
                    {isSendingOrder ? 'Processando...' : (
                      isTableOrder ? 'Confirmar Pedido da Mesa' : (
                        hasFrozenInCart && !frozenPaymentPlan
                          ? 'Escolha Pagamento Integral ou Parcial'
                          : (hasFrozenInCart && frozenPaymentPlan === 'parcial'
                              ? (paymentMethod === 'Pix (Online)'
                                  ? `Pagar 50% no Pix (${formatCurrency(partialFrozenAmount)})`
                                  : paymentMethod === 'Cartão de Débito (Online)'
                                    ? `Pagar 50% no Débito (${formatCurrency(partialFrozenAmount)})`
                                    : 'Selecione Pix ou Débito (50%)')
                              : (paymentMethod === 'Pix (Online)' || paymentMethod === 'Pagamento Online (Pix MP)' 
                                  ? `Ir para Pagamento Pix (${formatCurrency(total)})` 
                                  : (paymentMethod.includes('Online') ? `Pagar com Cartão Online (${formatCurrency(total)})` : 'Finalizar Pedido')))
                      )
                    )}
                  </span>
                </button>

                <button
                  type="button"
                  onClick={() => setIsCheckout(false)}
                  className="w-full mt-3 py-3 bg-stone-100 hover:bg-stone-200 text-stone-700 rounded-xl font-bold text-sm transition-colors cursor-pointer border border-stone-200 flex items-center justify-center gap-2"
                >
                  <ArrowLeft className="w-4 h-4 text-orange-600" />
                  <span>Voltar ao Cardápio e Escolher Mais Itens</span>
                </button>
              </div>
            )}
          </div>
        </div>

        {/* MODAL 1: Pagamento Pix Online (Pedido só é enviado após aprovação) */}
        {activePixPayment && (
          <div className="fixed inset-0 z-[120] bg-black/80 backdrop-blur-sm flex items-center justify-center p-3 sm:p-4 overflow-y-auto animate-in fade-in duration-200">
            <div className="bg-white rounded-3xl max-w-md w-full p-5 sm:p-7 shadow-2xl border border-stone-200 flex flex-col items-center my-auto animate-in zoom-in-95 duration-200">
              
              {/* Top Tag & Status */}
              <div className="w-full flex items-center justify-between mb-4 pb-3 border-b border-stone-100">
                <div className="flex items-center gap-2">
                  <div className="w-9 h-9 rounded-2xl bg-emerald-100 text-emerald-700 flex items-center justify-center font-bold shadow-xs">
                    <QrCode className="w-5 h-5" />
                  </div>
                  <div>
                    <h3 className="text-sm font-black text-stone-900 uppercase tracking-tight">Pagamento Pix Online</h3>
                    <p className="text-[10px] text-stone-500 font-semibold">Mercado Pago Integrado</p>
                  </div>
                </div>
                <div className="text-right">
                  <span className="text-xs font-mono font-black text-orange-600 bg-orange-50 px-2.5 py-1 rounded-full border border-orange-200">
                    ⏱️ {Math.floor(pixTimeRemaining / 60)}:{(pixTimeRemaining % 60).toString().padStart(2, '0')}
                  </span>
                </div>
              </div>

              {/* Total Amount Notice */}
              <div className="w-full bg-emerald-50/80 border border-emerald-200 rounded-2xl p-3.5 mb-4 text-center">
                <p className="text-[11px] font-bold text-emerald-800 uppercase tracking-wider">
                  {activePixPayment.isPartialPayment ? 'Valor da Entrada (50% - Congelados)' : 'Valor do Pedido'}
                </p>
                <p className="text-3xl font-black text-emerald-950 font-mono mt-0.5">{formatCurrency(activePixPayment.amount)}</p>
                {activePixPayment.isPartialPayment && (
                  <p className="text-[11px] font-bold text-stone-700 mt-1">
                    Total: {formatCurrency(activePixPayment.totalOrderAmount || total)} • Saldo 50% na Retirada: {formatCurrency(activePixPayment.remainingAmount || 0)}
                  </p>
                )}
                <p className="text-[11px] font-bold text-emerald-800 mt-1.5 flex items-center justify-center gap-1.5">
                  <AlertTriangle className="w-3.5 h-3.5 text-amber-600 shrink-0" />
                  <span>O pedido só será enviado à loja após a confirmação do Pix</span>
                </p>
              </div>

              {/* QR Code */}
              <div className="bg-white p-3 rounded-2xl border-2 border-stone-200 shadow-sm mb-4">
                <img 
                  src={activePixPayment.qrCode} 
                  alt="QR Code Pix" 
                  className="w-52 h-52 rounded-xl object-contain"
                />
              </div>

              {/* Pix Copia e Cola */}
              <div className="w-full space-y-2 mb-4">
                <label className="text-[11px] font-black text-stone-700 uppercase tracking-wider block">Código Pix Copia e Cola:</label>
                <div className="flex gap-2">
                  <input 
                    type="text" 
                    readOnly 
                    value={activePixPayment.brCode || activePixPayment.paymentId}
                    className="flex-1 bg-stone-100 border border-stone-300 rounded-xl px-3 py-2 text-xs font-mono text-stone-600 select-all truncate"
                  />
                  <button 
                    type="button"
                    onClick={() => {
                      navigator.clipboard.writeText(activePixPayment.brCode || activePixPayment.paymentId);
                      setActivePixPayment(prev => prev ? { ...prev, copied: true } : null);
                      setTimeout(() => {
                        setActivePixPayment(prev => prev ? { ...prev, copied: false } : null);
                      }, 3000);
                    }}
                    className={`px-4 py-2 rounded-xl text-xs font-black uppercase transition-all flex items-center gap-1.5 shrink-0 ${
                      activePixPayment.copied 
                        ? 'bg-emerald-600 text-white' 
                        : 'bg-blue-600 hover:bg-blue-700 text-white shadow-sm'
                    }`}
                  >
                    {activePixPayment.copied ? (
                      <>
                        <CheckCircle2 className="w-3.5 h-3.5" />
                        Copiado!
                      </>
                    ) : (
                      <>
                        <Copy className="w-3.5 h-3.5" />
                        Copiar
                      </>
                    )}
                  </button>
                </div>
              </div>

              {/* Live Polling Status */}
              <div className="w-full bg-stone-50 border border-stone-200 rounded-2xl p-3 mb-4 flex items-center justify-center gap-2.5">
                <RefreshCw className="w-4 h-4 text-blue-600 animate-spin" />
                <span className="text-xs font-bold text-stone-700">Aguardando pagamento... Verificando a cada 3 segundos</span>
              </div>

              {/* Action Buttons */}
              <div className="w-full space-y-2.5">
                <button
                  type="button"
                  onClick={handleCheckPixManual}
                  disabled={isVerifyingPix}
                  className="w-full py-3.5 px-4 bg-emerald-600 hover:bg-emerald-700 active:bg-emerald-800 text-white rounded-2xl font-black text-sm uppercase tracking-wider transition-all flex items-center justify-center gap-2 shadow-lg shadow-emerald-600/20 cursor-pointer disabled:opacity-50"
                >
                  {isVerifyingPix ? (
                    <>
                      <RefreshCw className="w-4 h-4 animate-spin" />
                      <span>Verificando com o Banco...</span>
                    </>
                  ) : (
                    <>
                      <CheckCircle2 className="w-4 h-4" />
                      <span>Já Fiz o Pix! Verificar Pagamento Agora</span>
                    </>
                  )}
                </button>

                <button
                  type="button"
                  onClick={() => {
                    setActivePixPayment(null);
                    setFrozenPaymentPlan(null);
                    setPaymentMode(null);
                    setPaymentMethod('');
                  }}
                  className="w-full py-2.5 text-stone-600 hover:text-stone-900 text-xs font-bold transition-colors cursor-pointer text-center bg-stone-100 hover:bg-stone-200 rounded-xl"
                >
                  ← Voltar e Refazer Escolhas
                </button>
              </div>

            </div>
          </div>
        )}

        {/* MODAL 2: Pagamento com Cartão Online (Crédito ou Débito) */}
        {activeCardPayment && (
          <div className="fixed inset-0 z-[120] bg-black/80 backdrop-blur-sm flex items-center justify-center p-3 sm:p-4 overflow-y-auto animate-in fade-in duration-200">
            <div className="bg-white rounded-3xl max-w-md w-full p-5 sm:p-7 shadow-2xl border border-stone-200 flex flex-col my-auto animate-in zoom-in-95 duration-200">
              
              {/* Header */}
              <div className="flex items-center justify-between pb-3 mb-4 border-b border-stone-100">
                <div className="flex items-center gap-2.5">
                  <div className={`w-9 h-9 rounded-2xl flex items-center justify-center text-white font-black shadow-sm ${
                    activeCardPayment.type === 'credit' ? 'bg-blue-600' : 'bg-purple-600'
                  }`}>
                    <CreditCard className="w-5 h-5" />
                  </div>
                  <div>
                    <h3 className="text-base font-black text-stone-900 leading-tight">
                      {activeCardPayment.type === 'credit' ? 'Cartão de Crédito Online' : 'Cartão de Débito Online'}
                    </h3>
                    <p className="text-[11px] text-stone-500 font-semibold">
                      {activeCardPayment.isPartialPayment ? 'Entrada 50% • Saldo na Retirada' : 'Pagamento Seguro com Criptografia'}
                    </p>
                  </div>
                </div>
                <button 
                  type="button"
                  onClick={() => setActiveCardPayment(null)}
                  className="p-1.5 text-stone-400 hover:text-stone-700 rounded-full hover:bg-stone-100"
                >
                  <X className="w-5 h-5" />
                </button>
              </div>

              {/* Amount banner */}
              <div className="bg-blue-50/70 border border-blue-200 rounded-2xl p-3.5 mb-4 text-center">
                <span className="text-[10px] font-black uppercase tracking-wider text-blue-700">
                  {activeCardPayment.isPartialPayment ? 'Entrada 50% a Pagar Agora' : 'Total a Pagar'}
                </span>
                <div className="text-2xl font-black text-blue-950 font-mono mt-0.5">{formatCurrency(activeCardPayment.amount)}</div>
                {activeCardPayment.isPartialPayment && (
                  <div className="text-[11px] font-bold text-stone-700 mt-1">
                    Total do Pedido: {formatCurrency(activeCardPayment.totalOrderAmount || total)} • Restante na Retirada: {formatCurrency(activeCardPayment.remainingAmount || 0)}
                  </div>
                )}
                <span className="text-[11px] font-bold text-stone-600 mt-1.5 flex items-center justify-center gap-1.5">
                  <AlertTriangle className="w-3.5 h-3.5 text-amber-600 shrink-0" />
                  <span>O pedido só será enviado à loja após aprovação da operadora</span>
                </span>
              </div>

              {cardPaymentError && (
                <div className="mb-4 p-3 bg-red-50 border border-red-200 rounded-xl text-red-700 text-xs font-bold flex items-center gap-2">
                  <AlertTriangle className="w-4 h-4 shrink-0 text-red-500" />
                  <span>{cardPaymentError}</span>
                </div>
              )}

              {/* Card Form */}
              <div className="space-y-3.5">
                <div>
                  <div className="flex items-center justify-between mb-1">
                    <label className="text-[11px] font-black text-stone-700 uppercase tracking-wider">Número do Cartão</label>
                    <span className="text-[10px] font-black uppercase text-blue-600 bg-blue-50 px-2 py-0.5 rounded-md border border-blue-100">
                      {detectCardBrand(cardFormData.number)}
                    </span>
                  </div>
                  <div className="relative">
                    <input 
                      type="text" 
                      value={cardFormData.number}
                      onChange={(e) => {
                        const raw = e.target.value.replace(/\D/g, '').slice(0, 16);
                        const formatted = raw.replace(/(\d{4})(?=\d)/g, '$1 ');
                        setCardFormData(prev => ({ ...prev, number: formatted }));
                      }}
                      placeholder="0000 0000 0000 0000"
                      className="w-full p-3 bg-stone-50 border border-stone-300 rounded-xl text-sm font-mono tracking-wider focus:ring-2 focus:ring-blue-500 focus:bg-white"
                    />
                    <CreditCard className="w-4 h-4 text-stone-400 absolute right-3 top-1/2 -translate-y-1/2" />
                  </div>
                </div>

                <div>
                  <label className="text-[11px] font-black text-stone-700 uppercase tracking-wider block mb-1">Nome no Cartão</label>
                  <input 
                    type="text" 
                    value={cardFormData.holderName}
                    onChange={(e) => setCardFormData(prev => ({ ...prev, holderName: e.target.value.toUpperCase() }))}
                    placeholder="COMO IMPRESSO NO CARTÃO"
                    className="w-full p-3 bg-stone-50 border border-stone-300 rounded-xl text-sm font-bold uppercase focus:ring-2 focus:ring-blue-500 focus:bg-white"
                  />
                </div>

                <div className="grid grid-cols-2 gap-3">
                  <div>
                    <label className="text-[11px] font-black text-stone-700 uppercase tracking-wider block mb-1">Validade (MM/AA)</label>
                    <input 
                      type="text" 
                      value={cardFormData.expiry}
                      onChange={(e) => {
                        const raw = e.target.value.replace(/\D/g, '').slice(0, 4);
                        let formatted = raw;
                        if (raw.length >= 3) {
                          formatted = `${raw.slice(0, 2)}/${raw.slice(2, 4)}`;
                        }
                        setCardFormData(prev => ({ ...prev, expiry: formatted }));
                      }}
                      placeholder="MM/AA"
                      className="w-full p-3 bg-stone-50 border border-stone-300 rounded-xl text-sm font-mono text-center focus:ring-2 focus:ring-blue-500 focus:bg-white"
                    />
                  </div>

                  <div>
                    <label className="text-[11px] font-black text-stone-700 uppercase tracking-wider block mb-1">CVV / Cód. Segurança</label>
                    <input 
                      type="password" 
                      maxLength={4}
                      value={cardFormData.cvv}
                      onChange={(e) => setCardFormData(prev => ({ ...prev, cvv: e.target.value.replace(/\D/g, '').slice(0, 4) }))}
                      placeholder="123"
                      className="w-full p-3 bg-stone-50 border border-stone-300 rounded-xl text-sm font-mono text-center focus:ring-2 focus:ring-blue-500 focus:bg-white"
                    />
                  </div>
                </div>

                <div>
                  <label className="text-[11px] font-black text-stone-700 uppercase tracking-wider block mb-1">CPF do Titular</label>
                  <input 
                    type="text" 
                    value={cardFormData.cpf}
                    onChange={(e) => {
                      const raw = e.target.value.replace(/\D/g, '').slice(0, 11);
                      let formatted = raw;
                      if (raw.length > 9) {
                        formatted = `${raw.slice(0, 3)}.${raw.slice(3, 6)}.${raw.slice(6, 9)}-${raw.slice(9, 11)}`;
                      } else if (raw.length > 6) {
                        formatted = `${raw.slice(0, 3)}.${raw.slice(3, 6)}.${raw.slice(6, 9)}`;
                      } else if (raw.length > 3) {
                        formatted = `${raw.slice(0, 3)}.${raw.slice(3, 6)}`;
                      }
                      setCardFormData(prev => ({ ...prev, cpf: formatted }));
                    }}
                    placeholder="000.000.000-00"
                    className="w-full p-3 bg-stone-50 border border-stone-300 rounded-xl text-sm font-mono focus:ring-2 focus:ring-blue-500 focus:bg-white"
                  />
                </div>

                {activeCardPayment.type === 'credit' && (
                  <div>
                    <label className="text-[11px] font-black text-stone-700 uppercase tracking-wider block mb-1">Parcelamento</label>
                    <select
                      value={cardFormData.installments}
                      onChange={(e) => setCardFormData(prev => ({ ...prev, installments: Number(e.target.value) }))}
                      className="w-full p-3 bg-stone-50 border border-stone-300 rounded-xl text-xs font-bold text-stone-800 focus:ring-2 focus:ring-blue-500 focus:bg-white"
                    >
                      <option value={1}>1x de {formatCurrency(activeCardPayment.amount)} (sem juros)</option>
                      {activeCardPayment.amount >= 60 && (
                        <option value={2}>2x de {formatCurrency(activeCardPayment.amount / 2)} (sem juros)</option>
                      )}
                      {activeCardPayment.amount >= 90 && (
                        <option value={3}>3x de {formatCurrency(activeCardPayment.amount / 3)} (sem juros)</option>
                      )}
                    </select>
                  </div>
                )}
              </div>

              {/* Submit Button */}
              <div className="mt-6 space-y-2.5">
                <button
                  type="button"
                  onClick={handleProcessCardPayment}
                  disabled={isProcessingCard}
                  className={`w-full py-4 px-5 text-white rounded-2xl font-black text-base uppercase tracking-wider transition-all flex items-center justify-center gap-2 shadow-xl cursor-pointer disabled:opacity-50 ${
                    activeCardPayment.type === 'credit'
                      ? 'bg-blue-600 hover:bg-blue-700 active:bg-blue-800 shadow-blue-600/30'
                      : 'bg-purple-600 hover:bg-purple-700 active:bg-purple-800 shadow-purple-600/30'
                  }`}
                >
                  {isProcessingCard ? (
                    <>
                      <RefreshCw className="w-5 h-5 animate-spin" />
                      <span>Processando com Segurança...</span>
                    </>
                  ) : (
                    <>
                      <CheckCircle2 className="w-5 h-5" />
                      <span>Pagar {formatCurrency(activeCardPayment.amount)} e Enviar Pedido</span>
                    </>
                  )}
                </button>

                <button
                  type="button"
                  onClick={() => {
                    setActiveCardPayment(null);
                    setFrozenPaymentPlan(null);
                    setPaymentMode(null);
                    setPaymentMethod('');
                  }}
                  disabled={isProcessingCard}
                  className="w-full py-2.5 text-stone-600 hover:text-stone-900 text-xs font-bold transition-colors cursor-pointer text-center bg-stone-100 hover:bg-stone-200 rounded-xl"
                >
                  ← Voltar e Refazer Escolhas
                </button>
              </div>

            </div>
          </div>
        )}
      </div>
    );
  }

  if (isBakeryLoading) {
    return <BakeryLoader isLoading={true} />;
  }




  // Se a loja estiver configurada em Modo de Manutenção
  // Modal de Perfil do Cliente (Endereços e Pedidos)
  const renderProfileModal = () => {
    if (!isProfileModalOpen || !activeCustomer) return null;

    return (
      <div className="fixed inset-0 z-[110] bg-stone-900/80 backdrop-blur-sm flex items-center justify-center p-3 sm:p-6 overflow-hidden">
        <div className="bg-white rounded-3xl max-w-2xl w-full flex flex-col shadow-2xl border border-stone-200 overflow-hidden max-h-[90vh] animate-in slide-in-from-bottom-4 duration-300">
          {/* Header do Modal */}
          <div className="p-4 sm:p-6 border-b border-stone-100 flex items-center justify-between bg-stone-50">
            <div className="flex items-center gap-3">
              <div className="w-10 h-10 bg-orange-100 rounded-full flex items-center justify-center text-orange-600">
                <UserIcon className="w-6 h-6" />
              </div>
              <div>
                <h2 className="text-lg font-black text-stone-900 uppercase tracking-tight leading-tight">{activeCustomer.name}</h2>
                <p className="text-xs text-stone-500 font-medium">
                  {activeCustomer.cpf ? `CNPJ/CPF: ${activeCustomer.cpf}` : activeCustomer.phone}
                </p>
              </div>
            </div>
            <button 
              onClick={() => setIsProfileModalOpen(false)}
              className="p-2 hover:bg-stone-200 rounded-full transition-colors"
            >
              <X className="w-6 h-6 text-stone-400" />
            </button>
          </div>

          {/* Navegação Interna */}
          <div className="flex border-b border-stone-100">
            <button 
              onClick={() => setProfileView('menu')}
              className={`flex-1 py-3 text-xs font-black uppercase tracking-wider transition-all ${profileView === 'menu' ? 'border-b-2 border-orange-500 text-orange-600 bg-orange-50/30' : 'text-stone-400 hover:text-stone-600'}`}
            >
              Início
            </button>
            <button 
              onClick={() => setProfileView('addresses')}
              className={`flex-1 py-3 text-xs font-black uppercase tracking-wider transition-all ${profileView === 'addresses' ? 'border-b-2 border-orange-500 text-orange-600 bg-orange-50/30' : 'text-stone-400 hover:text-stone-600'}`}
            >
              Meus Endereços
            </button>
            <button 
              onClick={() => setProfileView('orders')}
              className={`flex-1 py-3 text-xs font-black uppercase tracking-wider transition-all ${profileView === 'orders' ? 'border-b-2 border-orange-500 text-orange-600 bg-orange-50/30' : 'text-stone-400 hover:text-stone-600'}`}
            >
              Meus Pedidos
            </button>
          </div>

          {/* Conteúdo do Modal */}
          <div className="flex-1 overflow-y-auto p-4 sm:p-6 bg-white">
            {profileView === 'menu' && (
              <div className="space-y-4">
                {customerMonthlyGoalInfo.goal > 0 && (
                  <div className={`p-4 rounded-2xl border-2 space-y-2.5 ${
                    customerMonthlyGoalInfo.pct >= 100
                      ? 'bg-emerald-50 border-emerald-200'
                      : 'bg-orange-50/70 border-orange-200'
                  }`}>
                    <div className="flex items-center justify-between">
                      <div>
                        <p className="text-[11px] font-black uppercase tracking-wider text-stone-700">🎯 Sua Meta de Compras no Mês</p>
                        <p className="text-xs font-bold text-stone-600 mt-0.5">
                          Comprado: <strong className="text-stone-900">{formatCurrency(customerMonthlyGoalInfo.spent)}</strong> de <strong className="text-stone-900">{formatCurrency(customerMonthlyGoalInfo.goal)}</strong>
                        </p>
                      </div>
                      <span className={`px-3 py-1 rounded-full text-sm font-black ${
                        customerMonthlyGoalInfo.pct >= 100
                          ? 'bg-emerald-600 text-white'
                          : 'bg-orange-600 text-white'
                      }`}>
                        {customerMonthlyGoalInfo.pct}%
                      </span>
                    </div>
                    <div className="w-full h-3 bg-white rounded-full overflow-hidden border border-stone-200">
                      <div
                        className={`h-full rounded-full transition-all duration-500 ${
                          customerMonthlyGoalInfo.pct >= 100 ? 'bg-emerald-500' : 'bg-orange-500'
                        }`}
                        style={{ width: `${Math.min(100, customerMonthlyGoalInfo.pct)}%` }}
                      />
                    </div>
                    <p className="text-[11px] font-bold text-stone-600">
                      {customerMonthlyGoalInfo.pct >= 100
                        ? '🎉 Parabéns! Você atingiu 100% da sua meta mensal!'
                        : `Faltam ${formatCurrency(customerMonthlyGoalInfo.remaining)} para atingir 100% da sua meta do mês.`}
                    </p>
                  </div>
                )}

                <div className="grid grid-cols-2 gap-3">
                  <button 
                    onClick={() => setProfileView('addresses')}
                    className="p-4 bg-stone-50 hover:bg-orange-50 border border-stone-100 rounded-2xl text-center space-y-2 transition-all cursor-pointer group"
                  >
                    <div className="w-10 h-10 bg-white rounded-xl mx-auto flex items-center justify-center shadow-sm group-hover:bg-orange-100 transition-colors">
                      <MapPin className="w-5 h-5 text-orange-600" />
                    </div>
                    <span className="block text-[11px] font-black text-stone-700 uppercase">Endereços</span>
                  </button>
                  <button 
                    onClick={() => setProfileView('orders')}
                    className="p-4 bg-stone-50 hover:bg-orange-50 border border-stone-100 rounded-2xl text-center space-y-2 transition-all cursor-pointer group"
                  >
                    <div className="w-10 h-10 bg-white rounded-xl mx-auto flex items-center justify-center shadow-sm group-hover:bg-orange-100 transition-colors">
                      <Clock className="w-5 h-5 text-orange-600" />
                    </div>
                    <span className="block text-[11px] font-black text-stone-700 uppercase">Pedidos</span>
                  </button>
                </div>
                
                <div className="p-4 bg-orange-50 border border-orange-200 rounded-2xl space-y-1">
                  <p className="text-xs font-bold text-orange-900">Total de Pedidos Realizados</p>
                  <p className="text-2xl font-black text-orange-600">{activeCustomer.totalOrders || customerOrders.length || 0}</p>
                </div>

                <button 
                  type="button"
                  onClick={() => {
                    setIsProfileModalOpen(false);
                    setChangePassError('');
                    setChangePassSuccess('');
                    setNewCustPassword('');
                    setConfirmCustPassword('');
                    setMustChangePasswordModal(true);
                  }}
                  className="w-full py-3.5 bg-stone-100 hover:bg-stone-200 border border-stone-200 text-stone-800 rounded-2xl font-black text-xs uppercase tracking-wider transition-all flex items-center justify-center gap-2 cursor-pointer shadow-xs"
                >
                  <Lock className="w-4 h-4 text-orange-600" />
                  Trocar Minha Senha
                </button>

                <button 
                  onClick={() => {
                    if (confirm('Deseja realmente sair da sua conta?')) {
                      handleCustomerLogout();
                    }
                  }}
                  className="w-full py-4 border-2 border-red-100 text-red-600 rounded-2xl font-black text-xs uppercase tracking-widest hover:bg-red-50 transition-all flex items-center justify-center gap-2 cursor-pointer"
                >
                  <X className="w-4 h-4" />
                  Sair da Conta
                </button>
              </div>
            )}

            {profileView === 'addresses' && (
              <div className="space-y-4">
                {addressSaveMsg && (
                  <div className="p-3 bg-emerald-50 border border-emerald-200 text-emerald-800 rounded-xl text-xs font-bold flex items-center gap-2">
                    <CheckCircle2 className="w-4 h-4 text-emerald-600 shrink-0" />
                    <span>{addressSaveMsg}</span>
                  </div>
                )}

                {isEditingAddress ? (
                  <form onSubmit={handleSaveAddress} className="space-y-3 bg-stone-50 p-4 rounded-2xl border border-stone-200 animate-fadeIn">
                    <div className="flex items-center justify-between mb-2">
                      <h3 className="text-xs font-black text-stone-900 uppercase">
                        {isEditingAddress?.id ? 'Editar Endereço' : 'Novo Endereço'}
                      </h3>
                      <button type="button" onClick={() => setIsEditingAddress(null)} className="text-stone-400 hover:text-stone-600"><X className="w-4 h-4" /></button>
                    </div>
                    <div className="grid grid-cols-2 gap-3">
                      <div className="col-span-2">
                        <label className="text-[10px] font-black text-stone-500 uppercase">Identificação (ex: Casa, Trabalho)</label>
                        <input type="text" value={addressFormData.alias} onChange={e => setAddressFormData(prev => ({...prev, alias: e.target.value}))} className="w-full p-2.5 border border-stone-200 rounded-xl text-sm font-bold bg-white" required />
                      </div>
                      <div className="col-span-2">
                        <label className="text-[10px] font-black text-stone-500 uppercase">CEP</label>
                        <input type="text" value={addressFormData.cep} onChange={e => setAddressFormData(prev => ({...prev, cep: e.target.value}))} className="w-full p-2.5 border border-stone-200 rounded-xl text-sm font-bold bg-white" required />
                      </div>
                      <div className="col-span-2">
                        <label className="text-[10px] font-black text-stone-500 uppercase">Rua</label>
                        <input type="text" value={addressFormData.street} onChange={e => setAddressFormData(prev => ({...prev, street: e.target.value}))} className="w-full p-2.5 border border-stone-200 rounded-xl text-sm font-bold bg-white" required />
                      </div>
                      <div>
                        <label className="text-[10px] font-black text-stone-500 uppercase">Número</label>
                        <input type="text" value={addressFormData.number} onChange={e => setAddressFormData(prev => ({...prev, number: e.target.value}))} className="w-full p-2.5 border border-stone-200 rounded-xl text-sm font-bold bg-white" required />
                      </div>
                      <div>
                        <label className="text-[10px] font-black text-stone-500 uppercase">Bairro</label>
                        <input type="text" value={addressFormData.neighborhood} onChange={e => setAddressFormData(prev => ({...prev, neighborhood: e.target.value}))} className="w-full p-2.5 border border-stone-200 rounded-xl text-sm font-bold bg-white" required />
                      </div>
                      <div>
                        <label className="text-[10px] font-black text-stone-500 uppercase">Complemento (Opcional)</label>
                        <input type="text" value={addressFormData.complement} onChange={e => setAddressFormData(prev => ({...prev, complement: e.target.value}))} className="w-full p-2.5 border border-stone-200 rounded-xl text-sm font-bold bg-white" placeholder="Apto, Sala..." />
                      </div>
                      <div>
                        <label className="text-[10px] font-black text-stone-500 uppercase">Referência (Opcional)</label>
                        <input type="text" value={addressFormData.reference} onChange={e => setAddressFormData(prev => ({...prev, reference: e.target.value}))} className="w-full p-2.5 border border-stone-200 rounded-xl text-sm font-bold bg-white" placeholder="Próx. a..." />
                      </div>
                      <div className="col-span-2 pt-1">
                        <label className="flex items-center gap-2 text-xs font-bold text-stone-700 cursor-pointer select-none">
                          <input
                            type="checkbox"
                            checked={Boolean(addressFormData.isDefault)}
                            onChange={e => setAddressFormData(prev => ({...prev, isDefault: e.target.checked}))}
                            className="w-4 h-4 rounded text-orange-600 focus:ring-orange-500"
                          />
                          <span>Definir como endereço principal</span>
                        </label>
                      </div>
                    </div>
                    <button
                      type="submit"
                      disabled={isSavingAddress}
                      className="w-full py-3 bg-orange-600 hover:bg-orange-700 disabled:opacity-60 text-white rounded-xl font-black text-xs uppercase tracking-wider shadow-lg shadow-orange-600/20 cursor-pointer"
                    >
                      {isSavingAddress ? 'Salvando...' : 'Salvar Endereço'}
                    </button>
                  </form>
                ) : (
                  <>
                    <button 
                      onClick={() => {
                        setAddressSaveMsg(null);
                        setIsEditingAddress({} as any);
                        setAddressFormData({
                          alias: 'Casa',
                          street: '',
                          number: '',
                          complement: '',
                          neighborhood: '',
                          cep: '',
                          reference: '',
                          isDefault: customerAddresses.length === 0
                        });
                      }}
                      className="w-full py-3 border-2 border-dashed border-stone-200 text-stone-500 hover:text-orange-600 hover:border-orange-200 rounded-2xl flex items-center justify-center gap-2 font-bold text-sm transition-all cursor-pointer"
                    >
                      <Plus className="w-4 h-4" />
                      Adicionar Novo Endereço
                    </button>

                    {customerAddresses.length === 0 && !isLoadingCustomerData && (
                      <div className="text-center py-8">
                        <MapPin className="w-10 h-10 text-stone-200 mx-auto mb-2" />
                        <p className="text-xs text-stone-400 font-medium">Nenhum endereço cadastrado.</p>
                      </div>
                    )}

                    <div className="space-y-3">
                      {customerAddresses.map(addr => (
                        <div key={addr.id} className="p-4 bg-stone-50 border border-stone-200 rounded-2xl relative group">
                          <div className="flex items-start justify-between mb-1">
                            <div className="flex items-center gap-2">
                              <span className="text-xs font-black text-stone-900 uppercase tracking-tight">{addr.alias}</span>
                              {addr.isDefault && <span className="bg-orange-100 text-orange-700 text-[8px] font-black px-1.5 py-0.5 rounded uppercase">Principal</span>}
                            </div>
                            <div className="flex items-center gap-1">
                              <button
                                type="button"
                                onClick={() => {
                                  setAddressSaveMsg(null);
                                  setIsEditingAddress(addr);
                                  setAddressFormData({
                                    alias: addr.alias || 'Casa',
                                    street: addr.street || '',
                                    number: addr.number || '',
                                    complement: addr.complement || '',
                                    neighborhood: addr.neighborhood || '',
                                    cep: addr.cep || '',
                                    reference: addr.reference || '',
                                    isDefault: Boolean(addr.isDefault)
                                  });
                                }}
                                title="Editar endereço"
                                className="p-1.5 text-stone-400 hover:text-orange-600 transition-colors cursor-pointer"
                              >
                                <Pencil className="w-4 h-4" />
                              </button>
                              <button
                                type="button"
                                onClick={() => handleDeleteAddress(addr.id)}
                                title="Excluir endereço"
                                className="p-1.5 text-stone-300 hover:text-red-500 transition-colors cursor-pointer"
                              >
                                <Trash2 className="w-4 h-4" />
                              </button>
                            </div>
                          </div>
                          <p className="text-[11px] text-stone-600 font-medium leading-relaxed">
                            {addr.street}, {addr.number} {addr.complement && `(${addr.complement})`}<br />
                            {addr.neighborhood} - {addr.cep}
                            {addr.reference ? <><br />Ref: {addr.reference}</> : null}
                          </p>
                          <button 
                            onClick={() => {
                              setDeliveryStreet(addr.street);
                              setDeliveryNumber(addr.number);
                              setDeliveryComplement(addr.complement || '');
                              setDeliveryNeighborhood(addr.neighborhood);
                              setDeliveryCep(addr.cep);
                              setDeliveryReference(addr.reference || '');
                              safeStorage.setItem('balbec_customer_street', addr.street);
                              safeStorage.setItem('balbec_customer_number', addr.number);
                              safeStorage.setItem('balbec_customer_complement', addr.complement || '');
                              safeStorage.setItem('balbec_customer_neighborhood', addr.neighborhood);
                              safeStorage.setItem('balbec_customer_cep', addr.cep);
                              safeStorage.setItem('balbec_customer_reference', addr.reference || '');
                              alert(`Endereço "${addr.alias}" selecionado para o pedido atual!`);
                              setIsProfileModalOpen(false);
                            }}
                            className="mt-3 w-full py-2 bg-white border border-stone-200 text-stone-600 hover:text-orange-600 hover:border-orange-200 rounded-xl text-[10px] font-black uppercase tracking-wider transition-all cursor-pointer"
                          >
                            Usar para este pedido
                          </button>
                        </div>
                      ))}
                    </div>
                  </>
                )}
              </div>
            )}

            {profileView === 'orders' && (
              <div className="space-y-4">
                {customerOrders.length === 0 && !isLoadingCustomerData && (
                  <div className="text-center py-8">
                    <Clock className="w-10 h-10 text-stone-200 mx-auto mb-2" />
                    <p className="text-xs text-stone-400 font-medium">Você ainda não fez nenhum pedido.</p>
                  </div>
                )}

                <div className="space-y-3">
                  {customerOrders.map(order => (
                    <div key={order.id} className="p-4 bg-stone-50 border border-stone-200 rounded-2xl space-y-3">
                      <div className="flex items-center justify-between">
                        <span className="text-[10px] font-black text-stone-400 uppercase tracking-widest">#{order.id.slice(-6)}</span>
                        <span className={`text-[9px] font-black px-2 py-0.5 rounded-full uppercase tracking-tighter ${
                          order.status === 'completed' ? 'bg-emerald-100 text-emerald-700' :
                          order.status === 'canceled' ? 'bg-red-100 text-red-700' :
                          'bg-orange-100 text-orange-700'
                        }`}>
                          {order.status === 'pending' ? 'Pendente' : 
                           order.status === 'preparing' ? 'Preparando' :
                           (order.status === 'ready' || order.status === 'ready_for_pickup' || order.status === 'ready_for_delivery' || order.status === 'out_for_delivery' || order.status === 'in_transit') ? 'Pronto p/ Retirada' :
                           order.status === 'completed' ? 'Finalizado' : 'Cancelado'}
                        </span>
                      </div>
                      
                      <div className="space-y-1">
                        {order.items.slice(0, 2).map((it: any, idx: number) => (
                          <p key={idx} className="text-xs font-bold text-stone-800 flex justify-between">
                            <span>{it.quantity}x {it.name}</span>
                            <span className="text-stone-400">{formatCurrency(it.price * it.quantity)}</span>
                          </p>
                        ))}
                        {order.items.length > 2 && <p className="text-[10px] text-stone-400 italic">+ {order.items.length - 2} itens</p>}
                      </div>

                      <div className="pt-2 border-t border-stone-200 flex items-center justify-between gap-2 flex-wrap">
                        <div className="text-stone-900 font-black text-sm">Total: {formatCurrency(order.total)}</div>
                        <div className="flex items-center gap-2">
                          {isOrderEligibleForAppend(order) && (
                            <button 
                              type="button"
                              onClick={() => handleStartAppendOrder(order)}
                              className="px-3.5 py-2 bg-orange-600 hover:bg-orange-700 text-white rounded-xl text-[10px] font-black uppercase tracking-wider transition-colors shadow-sm flex items-center gap-1 cursor-pointer active:scale-95"
                            >
                              <Plus className="w-3.5 h-3.5" />
                              <span>Fazer Acréscimo</span>
                            </button>
                          )}
                          <button 
                            onClick={() => handleReorder(order)}
                            className="px-4 py-2 bg-stone-800 text-white rounded-xl text-[10px] font-black uppercase tracking-wider hover:bg-orange-600 transition-colors shadow-sm"
                          >
                            Repetir Pedido
                          </button>
                        </div>
                      </div>

                      {/* Acompanhamento do Pedido (Retirada no Balcão) */}
                      {(order.status === 'pending' || order.status === 'preparing' || order.status === 'ready' || order.status === 'ready_for_pickup') && (
                        <div className="bg-amber-50 border border-amber-300 p-3 rounded-2xl flex items-center justify-between gap-2">
                          <div className="flex items-center gap-2">
                            <div className="w-8 h-8 rounded-xl bg-orange-600 text-white flex items-center justify-center font-bold text-sm shadow-xs">
                              🛍️
                            </div>
                            <div>
                              <span className="text-xs font-black text-stone-900 uppercase tracking-tight block">
                                {order.status === 'ready' || order.status === 'ready_for_pickup'
                                  ? 'Pronto para Retirada no Balcão'
                                  : order.status === 'preparing'
                                  ? 'Em Preparo na Cozinha'
                                  : requiresOperatorPaymentConfirmation(order)
                                  ? 'Aguardando Confirmação do Financeiro'
                                  : 'Pedido Recebido na Fila'}
                              </span>
                              <span className="text-[10px] text-stone-500 font-medium">
                                Retirada na loja • Pedido #{String(order.id).slice(-4).padStart(4, '0')}
                              </span>
                            </div>
                          </div>
                          <button
                            type="button"
                            onClick={() => {
                              setIsProfileModalOpen(false);
                              setTrackingOrderId(order.id);
                            }}
                            className="px-3 py-1.5 bg-orange-600 hover:bg-orange-700 text-white rounded-xl text-[10px] font-black uppercase tracking-wider transition-colors cursor-pointer"
                          >
                            Ver Status
                          </button>
                        </div>
                      )}
                    </div>
                  ))}
                </div>
              </div>
            )}
          </div>
        </div>
      </div>
    );
  };

  const hasBypassMaintenance = typeof window !== 'undefined' && (
    window.location.search.includes('bypass_maintenance=1') || 
    window.location.search.includes('admin_preview=1')
  );

  if (storeInfo.isMaintenance && !hasBypassMaintenance) {
    return <MaintenancePage />;
  }

  // FLUXO DE ENTRADA OBRIGATÓRIO:
  // Ao acessar o sistema (exceto Totem), a primeira tela exibida é a tela de Login (CNPJ/CPF + 5 primeiros dígitos),
  // com opção de Recuperar Senha (pelo CNPJ/CPF) e Novo Cadastro (que fica Pendente até aprovação do Administrador).
  const isTotemCustomer = isTotemPath || salesChannel === 'kiosk';
  const requireAuthStep = !activeCustomer && !isTotemCustomer;

  if (requireAuthStep) {
    const cleanRegCpfPreview = authRegCpf.replace(/\D/g, '');
    const previewAutoPass = cleanRegCpfPreview.length >= 5 ? cleanRegCpfPreview.slice(0, 5) : '';

    return (
      <div className="min-h-screen bg-[#f8f7f5] flex flex-col items-center justify-center p-4 sm:p-6">
        <div className="bg-white p-6 sm:p-10 rounded-3xl shadow-xl max-w-md w-full text-center border border-stone-200 relative overflow-hidden animate-fadeIn">
          <div className="absolute top-0 left-0 right-0 h-2 bg-gradient-to-r from-orange-500 to-amber-500"></div>

          <div className="flex flex-col items-center mb-5">
            {storeInfo.logoUrl ? (
              <img
                src={storeInfo.logoUrl}
                alt="Logo"
                className="w-32 h-32 sm:w-36 sm:h-36 aspect-square object-cover rounded-full shadow-md border-2 border-stone-100 mb-3"
                referrerPolicy="no-referrer"
              />
            ) : (
              <div className="w-16 h-16 mb-3 bg-orange-100 text-orange-700 rounded-full flex items-center justify-center text-3xl shadow-xs border border-orange-200">
                🥖
              </div>
            )}
            <h2 className="text-xl sm:text-2xl font-black text-stone-900 uppercase tracking-tight">
              {authMode === 'login'
                ? 'Acesso do Cliente'
                : authMode === 'register'
                ? 'Novo Cadastro'
                : 'Recuperar Senha'}
            </h2>
            <p className="text-stone-500 font-medium text-xs mt-1">
              {authMode === 'login'
                ? 'Informe seu CNPJ ou CPF e os 5 primeiros dígitos como senha'
                : authMode === 'register'
                ? 'Solicite seu cadastro (sujeito à aprovação do administrador)'
                : 'Informe seu CNPJ ou CPF para recuperar sua senha'}
            </p>
          </div>

          {/* Abas Login / Novo Cadastro */}
          {authMode !== 'forgot' && (
            <div className="flex bg-stone-100 p-1.5 rounded-2xl border border-stone-200 mb-5">
              <button
                type="button"
                onClick={() => {
                  setAuthMode('login');
                  setAuthError('');
                  setAuthSuccessMsg('');
                }}
                className={`flex-1 py-2.5 rounded-xl text-xs font-black uppercase tracking-wider transition-all flex items-center justify-center gap-1.5 cursor-pointer ${
                  authMode === 'login'
                    ? 'bg-orange-600 text-white shadow-sm'
                    : 'text-stone-600 hover:text-stone-900'
                }`}
              >
                <LogIn className="w-3.5 h-3.5" />
                <span>Fazer Login</span>
              </button>
              <button
                type="button"
                onClick={() => {
                  setAuthMode('register');
                  setAuthError('');
                  setAuthSuccessMsg('');
                }}
                className={`flex-1 py-2.5 rounded-xl text-xs font-black uppercase tracking-wider transition-all flex items-center justify-center gap-1.5 cursor-pointer ${
                  authMode === 'register'
                    ? 'bg-orange-600 text-white shadow-sm'
                    : 'text-stone-600 hover:text-stone-900'
                }`}
              >
                <UserPlus className="w-3.5 h-3.5" />
                <span>Novo Cadastro</span>
              </button>
            </div>
          )}

          {authError && (
            <div className="mb-4 p-3.5 bg-red-50 border border-red-200 rounded-2xl text-xs font-bold text-red-700 text-left flex items-start gap-2">
              <AlertTriangle className="w-4 h-4 text-red-600 shrink-0 mt-0.5" />
              <span>{authError}</span>
            </div>
          )}

          {authSuccessMsg && (
            <div className="mb-4 p-4 bg-emerald-50 border-2 border-emerald-200 rounded-2xl text-xs font-bold text-emerald-800 text-left space-y-2.5">
              <div className="flex items-start gap-2">
                <CheckCircle2 className="w-4 h-4 text-emerald-600 shrink-0 mt-0.5" />
                <span className="leading-relaxed">{authSuccessMsg}</span>
              </div>
              {authMode !== 'login' && (
                <button
                  type="button"
                  onClick={() => {
                    setAuthMode('login');
                    setAuthError('');
                    setAuthSuccessMsg('');
                  }}
                  className="w-full py-2.5 bg-emerald-600 hover:bg-emerald-700 text-white rounded-xl font-black text-xs uppercase tracking-wider transition-all cursor-pointer"
                >
                  Ir para Tela de Login
                </button>
              )}
            </div>
          )}

          {/* MODO LOGIN */}
          {authMode === 'login' && (
            <form onSubmit={handleCustomerLogin} className="space-y-4 text-left">
              <div>
                <label className="block text-[11px] font-black text-stone-700 mb-1.5 uppercase tracking-wider">
                  Usuário (CNPJ ou CPF) *
                </label>
                <input
                  type="text"
                  value={authIdentifier}
                  onChange={(e) => setAuthIdentifier(formatCpfCnpj(e.target.value))}
                  placeholder="00.000.000/0000-00 ou 000.000.000-00"
                  className="w-full p-3.5 bg-stone-50 border-2 border-stone-200 rounded-2xl focus:ring-2 focus:ring-orange-500 focus:bg-white transition-all font-mono font-bold text-stone-900"
                  required
                />
              </div>

              <div>
                <div className="flex justify-between items-center mb-1.5">
                  <label className="block text-[11px] font-black text-stone-700 uppercase tracking-wider">
                    Senha (5 primeiros dígitos do CNPJ/CPF) *
                  </label>
                </div>
                <input
                  type="password"
                  value={authPassword}
                  onChange={(e) => setAuthPassword(e.target.value)}
                  placeholder="5 primeiros dígitos do CNPJ ou CPF"
                  className="w-full p-3.5 bg-stone-50 border-2 border-stone-200 rounded-2xl focus:ring-2 focus:ring-orange-500 focus:bg-white transition-all font-mono font-bold text-stone-900"
                  required
                />
              </div>

              <button
                type="submit"
                disabled={authLoading}
                className="w-full py-4 text-white rounded-2xl font-black text-base transition-all shadow-lg shadow-orange-500/25 flex items-center justify-center gap-2 cursor-pointer disabled:opacity-50"
                style={{ backgroundColor: storeInfo.themeColor || '#ea580c' }}
              >
                {authLoading ? (
                  <RefreshCw className="w-5 h-5 animate-spin" />
                ) : (
                  <>
                    <span>ENTRAR NO SISTEMA</span>
                    <ArrowRight className="w-5 h-5" />
                  </>
                )}
              </button>

              <div className="pt-3 border-t border-stone-100 flex flex-col sm:flex-row items-center justify-between gap-2">
                <button
                  type="button"
                  onClick={() => {
                    setAuthMode('forgot');
                    setAuthError('');
                    setAuthSuccessMsg('');
                  }}
                  className="w-full sm:w-auto py-2 px-3 bg-stone-100 hover:bg-stone-200 text-stone-700 rounded-xl text-xs font-bold transition-colors flex items-center justify-center gap-1.5 cursor-pointer"
                >
                  <KeyRound className="w-3.5 h-3.5 text-orange-600" />
                  <span>Recuperar Senha</span>
                </button>

                <button
                  type="button"
                  onClick={() => {
                    setAuthMode('register');
                    setAuthError('');
                    setAuthSuccessMsg('');
                  }}
                  className="w-full sm:w-auto py-2 px-3 bg-orange-50 hover:bg-orange-100 text-orange-700 border border-orange-200 rounded-xl text-xs font-black transition-colors flex items-center justify-center gap-1.5 cursor-pointer"
                >
                  <UserPlus className="w-3.5 h-3.5 text-orange-600" />
                  <span>Novo Cadastro</span>
                </button>
              </div>
            </form>
          )}

          {/* MODO NOVO CADASTRO (FICA PENDENTE ATÉ APROVAÇÃO DO ADMIN) */}
          {authMode === 'register' && (
            <form onSubmit={handleCustomerRegister} className="space-y-3.5 text-left">
              <div className="p-3 bg-amber-50 border border-amber-200 rounded-2xl text-[11px] text-amber-900 font-medium leading-relaxed">
                🔒 <strong>Atenção:</strong> Após o envio, seu cadastro ficará <strong>Pendente</strong> até que o Administrador aprove seu acesso.
              </div>

              <div>
                <label className="block text-[10px] font-black text-stone-700 mb-1 uppercase tracking-wider">
                  Nome Completo ou Razão Social *
                </label>
                <input
                  type="text"
                  value={authName}
                  onChange={(e) => setAuthName(e.target.value)}
                  placeholder="Nome da Empresa ou Cliente"
                  className="w-full p-3 bg-stone-50 border-2 border-stone-200 rounded-xl focus:ring-2 focus:ring-orange-500 transition-all font-bold text-sm"
                  required
                />
              </div>

              <div>
                <label className="block text-[10px] font-black text-stone-700 mb-1 uppercase tracking-wider">
                  CNPJ ou CPF (Será seu Usuário de Login) *
                </label>
                <input
                  type="text"
                  value={authRegCpf}
                  onChange={(e) => setAuthRegCpf(formatCpfCnpj(e.target.value))}
                  placeholder="00.000.000/0000-00 ou 000.000.000-00"
                  className="w-full p-3 bg-stone-50 border-2 border-stone-200 rounded-xl focus:ring-2 focus:ring-orange-500 transition-all font-mono font-bold text-sm"
                  required
                />
                {previewAutoPass && (
                  <p className="text-[11px] text-orange-700 font-bold mt-1">
                    🔑 Sua senha automática será os 5 primeiros dígitos: <span className="font-mono bg-orange-100 px-1.5 py-0.5 rounded">{previewAutoPass}</span>
                  </p>
                )}
              </div>

              <div>
                <label className="block text-[10px] font-black text-stone-700 mb-1 uppercase tracking-wider">
                  WhatsApp / Telefone (com DDD) *
                </label>
                <input
                  type="tel"
                  value={authPhone}
                  onChange={(e) => setAuthPhone(formatPhone(e.target.value))}
                  placeholder="(00) 00000-0000"
                  className="w-full p-3 bg-stone-50 border-2 border-stone-200 rounded-xl focus:ring-2 focus:ring-orange-500 transition-all font-mono font-bold text-sm"
                  required
                />
              </div>

              <div>
                <label className="block text-[10px] font-black text-stone-700 mb-1 uppercase tracking-wider">
                  E-mail (Opcional)
                </label>
                <input
                  type="email"
                  value={authRegEmail}
                  onChange={(e) => setAuthRegEmail(e.target.value)}
                  placeholder="contato@empresa.com.br"
                  className="w-full p-3 bg-stone-50 border-2 border-stone-200 rounded-xl focus:ring-2 focus:ring-orange-500 transition-all text-sm font-medium"
                />
              </div>

              <div>
                <label className="block text-[10px] font-black text-stone-700 mb-1 uppercase tracking-wider">
                  Endereço (Opcional)
                </label>
                <input
                  type="text"
                  value={authAddress}
                  onChange={(e) => setAuthAddress(e.target.value)}
                  placeholder="Rua, Número, Bairro, Cidade"
                  className="w-full p-3 bg-stone-50 border-2 border-stone-200 rounded-xl focus:ring-2 focus:ring-orange-500 transition-all text-sm font-medium"
                />
              </div>

              <button
                type="submit"
                disabled={authLoading}
                className="w-full py-4 text-white rounded-2xl font-black text-sm uppercase tracking-wider transition-all shadow-lg flex items-center justify-center gap-2 cursor-pointer disabled:opacity-50"
                style={{ backgroundColor: storeInfo.themeColor || '#ea580c' }}
              >
                {authLoading ? (
                  <RefreshCw className="w-5 h-5 animate-spin" />
                ) : (
                  <>
                    <span>SOLICITAR CADASTRO</span>
                    <ArrowRight className="w-4 h-4" />
                  </>
                )}
              </button>
            </form>
          )}

          {/* MODO RECUPERAÇÃO DE SENHA PELO CNPJ OU CPF */}
          {authMode === 'forgot' && (
            <form onSubmit={handleCustomerForgot} className="space-y-4 text-left">
              <div>
                <label className="block text-[11px] font-black text-stone-700 mb-1.5 uppercase tracking-wider">
                  CNPJ ou CPF Cadastrado *
                </label>
                <input
                  type="text"
                  value={authIdentifier}
                  onChange={(e) => setAuthIdentifier(formatCpfCnpj(e.target.value))}
                  placeholder="Digite seu CNPJ ou CPF"
                  className="w-full p-3.5 bg-stone-50 border-2 border-stone-200 rounded-2xl focus:ring-2 focus:ring-orange-500 transition-all font-mono font-bold text-stone-900"
                  required
                />
                <p className="text-[11px] text-stone-500 mt-1">
                  A recuperação utiliza o próprio CNPJ ou CPF cadastrado (sua senha padrão corresponde aos 5 primeiros dígitos).
                </p>
              </div>

              <div className="flex flex-col gap-3">
                <button
                  type="submit"
                  disabled={authLoading}
                  className="w-full py-4 text-white rounded-2xl font-black text-base transition-all shadow-lg flex items-center justify-center gap-2 cursor-pointer disabled:opacity-50"
                  style={{ backgroundColor: storeInfo.themeColor || '#ea580c' }}
                >
                  {authLoading ? <RefreshCw className="w-5 h-5 animate-spin" /> : <span>RECUPERAR SENHA</span>}
                </button>
                <button
                  type="button"
                  onClick={() => {
                    setAuthMode('login');
                    setAuthError('');
                    setAuthSuccessMsg('');
                  }}
                  className="w-full py-2.5 text-stone-600 hover:text-stone-900 text-xs font-black uppercase transition-colors cursor-pointer"
                >
                  ← Voltar para o Login
                </button>
              </div>
            </form>
          )}

          <div className="mt-6 pt-4 border-t border-stone-100">
            <p className="text-[10px] text-stone-400 font-bold uppercase tracking-widest">
              {storeInfo.name || 'BALBEC - REVENDA'}
            </p>
          </div>
        </div>
      </div>
    );
  }



  return (
    <div className="h-screen flex bg-[#f8f7f5] overflow-hidden font-sans">
      {isSendingOrder && (
        <div className="fixed inset-0 z-[100] flex flex-col items-center justify-center bg-stone-900/90 text-white p-6 text-center">
          <div className="w-16 h-16 border-4 border-orange-500 border-t-transparent rounded-full animate-spin mb-6"></div>
          <h2 className="text-3xl font-bold animate-pulse">ENVIANDO SEU PEDIDO...</h2>
        </div>
      )}
      <BakeryLoader isLoading={isBakeryLoading} />

      {/* Main Content Area */}
      <div className="flex-1 flex flex-col h-full overflow-hidden relative">
        {/* Top Header Menu Bar */}
        <div className="min-h-9 py-1 px-3 sm:px-6 shrink-0 w-full bg-[#5c4033] text-stone-100 z-40 border-b border-[#473127] shadow-xs">
          <div className="max-w-7xl mx-auto flex items-center justify-between gap-2 text-xs">
            {/* Quick Links Menu: Agendamento & Pedidos Anteriores */}
            <div className="flex items-center gap-2 sm:gap-3 overflow-x-auto no-scrollbar py-0.5">
              {/* Botão de Agendamento */}
              <button
                type="button"
                onClick={() => {
                  setScheduleStepMode('pickup');
                  setShowScheduleSelectionStep(true);
                }}
                className="inline-flex items-center gap-1.5 px-3 py-1 bg-amber-500/25 hover:bg-amber-500/40 text-amber-200 hover:text-white rounded-lg font-bold text-[11px] sm:text-xs transition-all cursor-pointer border border-amber-400/35 shadow-2xs whitespace-nowrap active:scale-95"
                title="Clique para alterar seu horário de retirada"
              >
                <Clock className="w-3.5 h-3.5 text-amber-300 shrink-0" />
                <span>
                  {selectedScheduleTime ? `Retirada: ${selectedScheduleDay ? `${selectedScheduleDay.split(',')[0]} às ` : ''}${selectedScheduleTime}` : '⏰ Agendar Horário de Retirada'}
                </span>
                <span className="text-[10px] bg-amber-400 text-stone-900 px-1.5 py-0.5 rounded font-black uppercase ml-1">
                  Alterar
                </span>
              </button>

              {/* Botão Pedidos Anteriores */}
              <button
                type="button"
                onClick={() => {
                  console.log('[UI] Pedidos Anteriores clicado. ActiveCustomer:', activeCustomer);
                  if (activeCustomer && activeCustomer.id) {
                    setProfileView('orders');
                    setIsProfileModalOpen(true);
                  } else {
                    console.log('[UI] Redirecionando para Login Modal');
                    setAuthMode('login');
                    setIsAuthModalOpen(true);
                  }
                }}
                className="inline-flex items-center gap-1.5 px-3 py-1 bg-white/10 hover:bg-white/20 text-stone-200 hover:text-white rounded-lg font-bold text-[11px] sm:text-xs transition-all cursor-pointer border border-white/20 shadow-2xs whitespace-nowrap active:scale-95"
                title="Ver pedidos anteriores e repetir pedido"
              >
                <ShoppingBag className="w-3.5 h-3.5 text-orange-400 shrink-0" />
                <span>📋 Pedidos Anteriores</span>
                {customerOrders.length > 0 && (
                  <span className="text-[10px] bg-orange-600 text-white px-1.5 py-0.2 rounded-full font-black">
                    {customerOrders.length}
                  </span>
                )}
              </button>
            </div>

            {/* Informação do Balcão */}
            <div className="hidden sm:flex items-center gap-3 text-[11px] text-stone-300">
              <span className="flex items-center gap-1">
                <Store className="w-3.5 h-3.5 text-amber-400" />
                <span className="font-semibold">Balcão &amp; Retirada</span>
              </span>
              <span>•</span>
              <span className="truncate max-w-[200px]">{storeInfo.headerPhrase || 'Salgados Especiais e Revenda'}</span>
            </div>
          </div>
        </div>

        {/* Modern Header */}
        <header className="bg-white border-b border-stone-200 shrink-0 z-30 pt-2 sm:pt-3 md:pt-4 pb-2 md:pb-3">
          <div className="max-w-7xl mx-auto px-3 sm:px-4 md:px-6 min-h-[4.5rem] md:min-h-[7.5rem] flex items-center justify-between gap-2.5 sm:gap-3 md:gap-4">
            <div className="flex flex-col items-center sm:items-start shrink-0">
              {storeInfo.logoUrl ? (
                <img 
                  src={storeInfo.logoUrl} 
                  alt="Logo" 
                  className="w-20 h-20 sm:w-[104px] sm:h-[104px] md:w-[132px] md:h-[132px] aspect-square object-cover rounded-full shrink-0 shadow-sm border border-stone-200"
                  referrerPolicy="no-referrer"
                />
              ) : null}

            </div>

            {/* Search Bar - Center/Right */}
            <div className="flex-1 max-w-md relative group">
              <div className="absolute left-3 top-1/2 -translate-y-1/2 text-stone-400 group-focus-within:text-orange-500 transition-colors">
                <Search className="w-4 h-4 sm:w-5 sm:h-5" />
              </div>
              <input 
                type="text"
                placeholder="O que você procura hoje?"
                value={searchTerm}
                onChange={(e) => setSearchTerm(e.target.value)}
                className="w-full pl-9 sm:pl-10 pr-8 sm:pr-10 py-1.5 sm:py-2 md:py-3 bg-stone-100 border-none rounded-xl sm:rounded-2xl focus:ring-2 focus:ring-orange-500 focus:bg-white transition-all text-xs sm:text-sm md:text-base font-medium"
              />
              {searchTerm && (
                <button 
                  onClick={() => setSearchTerm('')}
                  className="absolute right-2.5 top-1/2 -translate-y-1/2 text-stone-400 hover:text-stone-600"
                >
                  <X className="w-4 h-4 sm:w-5 sm:h-5" />
                </button>
              )}
            </div>

            {/* Desktop Cart Button & Status */}
            {!isMobile && (
              <div className="flex items-center gap-3">
                <button
                  type="button"
                  onClick={handleManualSync}
                  disabled={isRefreshing}
                  title="Atualizar Cardápio Agora"
                  className="flex items-center gap-1.5 px-3.5 py-2.5 bg-stone-100 hover:bg-stone-200 active:scale-95 text-stone-700 font-semibold rounded-xl text-xs transition-all shadow-sm cursor-pointer shrink-0 disabled:opacity-50"
                >
                  <RefreshCw className={`w-4 h-4 text-stone-600 ${isRefreshing ? 'animate-spin' : ''}`} />
                  <span>{isRefreshing ? 'Atualizando...' : 'Atualizar'}</span>
                </button>

                <button
                  type="button"
                  onClick={openTrackOrderModal}
                  className={`relative flex items-center gap-1.5 px-3.5 py-2.5 rounded-xl text-xs font-black transition-all shadow-sm cursor-pointer shrink-0 ${
                    activeOrdersCount > 0 
                      ? 'bg-emerald-600 hover:bg-emerald-700 text-white animate-pulse' 
                      : 'bg-stone-100 hover:bg-stone-200 text-stone-700'
                  }`}
                  title="Acompanhar Pedido / Notificações"
                >
                  <BellRing className="w-4 h-4 text-inherit" />
                  <span>{latestActiveOrder ? `Pedido #${String(latestActiveOrder.id).slice(-4)}` : 'Acompanhar'}</span>
                  {activeOrdersCount > 0 && (
                    <span className="absolute -top-1.5 -right-1.5 bg-red-600 text-white text-[10px] font-black min-w-[20px] h-[20px] px-1 rounded-full flex items-center justify-center shadow-md border-2 border-white animate-bounce">
                      {activeOrdersCount}
                    </span>
                  )}
                </button>

                {showDeliveryFeatures && (
                  (activeCustomer || hasName) ? (
                    <div className="flex items-center gap-2">
                      <button 
                        onClick={() => activeCustomer ? setIsProfileModalOpen(true) : setIsAuthModalOpen(true)}
                        className="flex items-center gap-2.5 px-4 py-2.5 bg-orange-50 hover:bg-orange-100 text-orange-700 font-bold rounded-xl text-xs transition-all border border-orange-200 cursor-pointer shrink-0 shadow-xs"
                      >
                        <UserIcon className="w-4 h-4 text-orange-600" />
                        <span className="truncate max-w-[120px] font-black">{activeCustomer?.name || customerName}</span>
                      </button>
                      <button 
                        onClick={() => {
                          const name = activeCustomer?.name || customerName;
                          if (confirm(`Deseja realmente sair da conta de ${name}?`)) {
                            handleCustomerLogout();
                          }
                        }}
                        className="p-2.5 bg-red-50 hover:bg-red-100 text-red-600 rounded-xl transition-all border border-red-200 cursor-pointer"
                        title="Sair da Conta"
                      >
                        <X className="w-4 h-4" />
                      </button>
                    </div>
                  ) : (
                    <button
                      onClick={() => {
                        setAuthMode('login');
                        setIsAuthModalOpen(true);
                      }}
                      className="flex items-center gap-1.5 px-3.5 py-2.5 bg-orange-50 hover:bg-orange-100 text-orange-700 font-bold rounded-xl text-xs transition-all border border-orange-200 cursor-pointer shrink-0"
                      title="Login / Cadastrar Cliente"
                    >
                      <UserIcon className="w-4 h-4 text-orange-600" />
                      <span>Entrar / Cadastrar</span>
                    </button>
                  )
                )}

                <div className={`px-3 py-1.5 rounded-full text-xs font-bold uppercase tracking-wider ${currentStatus.isOpenNow ? 'bg-green-100 text-green-700' : 'bg-red-100 text-red-700'}`}>
                  {currentStatus.isOpenNow ? 'Aberto' : 'Fechado'}
                </div>

                <button 
                  onClick={() => setIsCartOpen(prev => !prev)}
                  className="relative flex items-center gap-2 px-4 py-2.5 bg-red-600 hover:bg-red-700 active:scale-95 text-white font-bold rounded-xl shadow transition-all cursor-pointer"
                  title="Ver Carrinho"
                >
                  <ShoppingCart className="w-5 h-5 text-white" />
                  <span className="text-sm">Carrinho</span>
                  {cart.length > 0 && (
                    <span className="ml-1 bg-white text-red-600 text-xs font-black px-2 py-0.5 rounded-full shadow-sm">
                      {cart.reduce((sum, item) => sum + item.quantity, 0)}
                    </span>
                  )}
                </button>
              </div>
            )}
            
            {/* Mobile Header Actions */}
            {isMobile && (
              <div className="flex items-center gap-2 shrink-0">
                <button
                  type="button"
                  onClick={handleManualSync}
                  disabled={isRefreshing}
                  title="Atualizar Cardápio"
                  className="p-2 bg-stone-100 hover:bg-stone-200 active:scale-95 text-stone-700 rounded-xl transition-all shadow-sm flex items-center justify-center disabled:opacity-50"
                >
                  <RefreshCw className={`w-4 h-4 sm:w-5 sm:h-5 text-stone-600 ${isRefreshing ? 'animate-spin' : ''}`} />
                </button>

                <button
                  type="button"
                  onClick={openTrackOrderModal}
                  className={`relative p-2 rounded-xl transition-all shadow-sm flex items-center justify-center cursor-pointer ${
                    activeOrdersCount > 0 
                      ? 'bg-emerald-600 text-white animate-pulse' 
                      : 'bg-stone-100 text-stone-700 hover:bg-stone-200'
                  }`}
                  title="Acompanhar Pedido / Notificações"
                >
                  <BellRing className="w-4 h-4 sm:w-5 sm:h-5 text-inherit" />
                  {activeOrdersCount > 0 && (
                    <span className="absolute -top-1.5 -right-1.5 bg-red-600 text-white text-[10px] font-black min-w-[18px] h-[18px] px-1 rounded-full flex items-center justify-center shadow-md border-2 border-white animate-bounce">
                      {activeOrdersCount}
                    </span>
                  )}
                </button>

                {showDeliveryFeatures && (
                  (activeCustomer || hasName) ? (
                    <div className="flex items-center gap-1.5">
                      <button
                        onClick={() => activeCustomer ? setIsProfileModalOpen(true) : setIsAuthModalOpen(true)}
                        className="flex flex-col items-end mr-1 active:scale-95 transition-all"
                      >
                        <span className="text-[9px] font-black text-orange-600 uppercase leading-none tracking-tighter">Olá, {(activeCustomer?.name || customerName).split(' ')[0]}</span>
                        <div className="flex items-center gap-1">
                          <UserIcon className="w-3 h-3 text-stone-400" />
                          <span className="text-[11px] font-extrabold text-stone-800 leading-tight">{activeCustomer ? 'Ver Perfil' : 'Entrar'}</span>
                        </div>
                      </button>
                      <button
                        type="button"
                        onClick={() => {
                          const name = activeCustomer?.name || customerName;
                          if (confirm(`Deseja realmente sair da conta de ${name}?`)) {
                            handleCustomerLogout();
                          }
                        }}
                        className="p-1.5 bg-red-50 hover:bg-red-100 text-red-600 rounded-lg border border-red-200 transition-colors"
                        title="Desconectar"
                      >
                        <X className="w-3.5 h-3.5" />
                      </button>
                    </div>
                  ) : (
                    <button
                      onClick={() => {
                        setAuthMode('login');
                        setIsAuthModalOpen(true);
                      }}
                      title="Entrar / Cadastrar"
                      className="p-2 bg-orange-50 hover:bg-orange-100 text-orange-700 rounded-xl transition-all shadow-sm flex items-center justify-center border border-orange-200"
                    >
                      <UserIcon className="w-4 h-4 sm:w-5 sm:h-5 text-orange-600" />
                    </button>
                  )
                )}

                {cart.length > 0 && (
                  <button 
                    onClick={() => setIsCartOpen(true)}
                    className="relative p-2 bg-red-600 hover:bg-red-700 text-white rounded-xl shadow transition-all"
                  >
                    <ShoppingCart className="w-4 h-4 sm:w-5 sm:h-5 text-white" />
                    <span className="absolute -top-1.5 -right-1.5 bg-stone-900 text-white text-[10px] font-black w-4.5 h-4.5 rounded-full flex items-center justify-center border border-white">
                      {cart.reduce((sum, item) => sum + item.quantity, 0)}
                    </span>
                  </button>
                )}
              </div>
            )}
          </div>
        </header>

        {/* Barra de Progresso da META Mensal do Cliente (exibida apenas quando o cliente possui META definida > 0) */}
        {activeCustomer && customerMonthlyGoalInfo.goal > 0 && (
          <div className={`px-4 py-2.5 shrink-0 z-25 border-b transition-colors ${
            customerMonthlyGoalInfo.pct >= 100
              ? 'bg-emerald-950 text-emerald-50 border-emerald-800'
              : 'bg-gradient-to-r from-amber-950 via-stone-900 to-orange-950 text-amber-50 border-orange-900/60'
          }`}>
            <div className="max-w-7xl mx-auto flex flex-col sm:flex-row sm:items-center justify-between gap-2">
              <div className="flex items-center justify-between sm:justify-start gap-3">
                <span className={`inline-flex items-center gap-1.5 px-2.5 py-0.5 rounded-full text-[11px] font-black uppercase tracking-wider ${
                  customerMonthlyGoalInfo.pct >= 100
                    ? 'bg-emerald-500 text-white'
                    : 'bg-orange-500 text-white'
                }`}>
                  🎯 Meta do Mês: {customerMonthlyGoalInfo.pct}%
                </span>
                <span className="text-xs font-bold text-stone-200">
                  Comprado: <strong className="text-white">{formatCurrency(customerMonthlyGoalInfo.spent)}</strong> / Meta: <strong className="text-amber-300">{formatCurrency(customerMonthlyGoalInfo.goal)}</strong>
                </span>
              </div>

              <div className="flex items-center gap-3 flex-1 sm:max-w-xs md:max-w-md">
                <div className="flex-1 h-2.5 bg-black/40 rounded-full overflow-hidden border border-white/15">
                  <div
                    className={`h-full rounded-full transition-all duration-500 ${
                      customerMonthlyGoalInfo.pct >= 100
                        ? 'bg-emerald-400'
                        : 'bg-gradient-to-r from-orange-500 to-amber-400'
                    }`}
                    style={{ width: `${Math.min(100, customerMonthlyGoalInfo.pct)}%` }}
                  />
                </div>
                <span className="text-[11px] font-black whitespace-nowrap text-amber-200">
                  {customerMonthlyGoalInfo.pct >= 100
                    ? '🎉 Meta Atingida!'
                    : `Faltam ${formatCurrency(customerMonthlyGoalInfo.remaining)}`}
                </span>
              </div>
            </div>
          </div>
        )}

        {/* Channel Info Bar (when selected) */}
        {hasChosenChannel && (
          <div className="bg-stone-900 text-stone-100 py-2.5 px-4 shrink-0 z-20 border-b border-stone-800 text-xs font-medium">
            <div className="max-w-7xl mx-auto flex flex-wrap items-center justify-between gap-2">
              <div className="flex items-center gap-2">
                <span className="text-stone-400 font-semibold">Modo de Pedido:</span>
                {salesChannel === 'kiosk' ? (
                  <span className={`inline-flex items-center gap-1.5 px-3 py-1 rounded-full font-bold text-xs ${
                    canBuy 
                      ? 'bg-blue-500/20 text-blue-300 border border-blue-500/40' 
                      : 'bg-amber-500/20 text-amber-300 border border-amber-500/40'
                  }`}>
                    <span className={`w-2 h-2 rounded-full ${canBuy ? 'bg-blue-400 animate-pulse' : 'bg-amber-400'}`}></span>
                    📱 Autoatendimento {canBuy ? '(Totem / Tablet)' : '(Apenas Visualização 👁️)'}
                  </span>
                ) : (
                  <div className="flex items-center gap-2">
                    <span className={`inline-flex items-center gap-1.5 px-3 py-1 rounded-full font-bold text-xs ${
                      canBuy 
                        ? 'bg-amber-500/20 text-amber-300 border border-amber-500/40' 
                        : 'bg-stone-500/20 text-stone-300 border border-stone-500/40'
                    }`}>
                      <span className={`w-2 h-2 rounded-full ${canBuy ? 'bg-amber-400 animate-pulse' : 'bg-stone-400'}`}></span>
                      {selectedTableNumber ? (
                        <>🍽️ Mesa {selectedTableNumber}</>
                      ) : (
                        <>🛍️ RETIRADA NO BALCÃO {!canBuy && '(Apenas Visualização 👁️)'}</>
                      )}
                    </span>
                    {selectedTableNumber && (
                      <button
                        type="button"
                        onClick={() => setShowTableSelectModal(true)}
                        className="text-[11px] bg-amber-500/20 text-amber-300 hover:bg-amber-500/30 px-2 py-0.5 rounded-md font-bold transition-colors cursor-pointer border border-amber-500/40 flex items-center gap-1"
                      >
                        <UtensilsCrossed className="w-3 h-3" />
                        <span>Mesa {selectedTableNumber}</span>
                      </button>
                    )}
                  </div>
                )}
              </div>
            </div>
          </div>
        )}

        {/* Read-only viewing mode notice banner */}
        {hasChosenChannel && !canBuy && (
          <div className="bg-amber-500 text-stone-950 font-bold text-xs sm:text-sm py-2.5 px-4 text-center flex items-center justify-center gap-2 shadow-sm border-b border-amber-600">
            <span className="text-base">👁️</span>
            <span>
              {!storeInfo.isOpen 
                ? 'A loja está fechada temporariamente no painel de controle. Navegando em modo de apenas visualização.' 
                : !currentStatus.isOpenNow
                  ? (currentStatus.details || 'Fora do horário de atendimento da loja. Navegando em modo de apenas visualização.')
                  : requireQrCode && !isQrValidated
                    ? 'Cardápio em Modo Apenas Visualização. Para fazer um pedido, escaneie o QR Code na mesa do estabelecimento!'
                    : `A modalidade ${salesChannel === 'kiosk' ? 'Autoatendimento (Totem)' : 'Retirada'} está em modo de apenas visualização.`}
            </span>
          </div>
        )}

        {/* Informational banner when store is manually forced open outside schedule */}
        {hasChosenChannel && canBuy && storeInfo.forceOpen && !currentStatus.isWithinSchedule && (
          <div className="bg-emerald-600 text-white font-bold text-xs py-2 px-4 text-center flex items-center justify-center gap-2 shadow-xs border-b border-emerald-700">
            <span>⚡ Abertura manual ativa no painel • Pedidos liberados</span>
          </div>
        )}

        {/* Banner do Modo Acréscimo no Pedido */}
        {appendOrderTarget && (
          <div className="bg-gradient-to-r from-orange-600 via-amber-600 to-orange-700 text-white px-3 sm:px-6 py-2.5 shrink-0 z-30 shadow-md border-b border-orange-800 animate-in slide-in-from-top-3 duration-200">
            <div className="max-w-7xl mx-auto flex flex-col sm:flex-row items-center justify-between gap-2.5">
              <div className="flex items-center gap-2.5 text-left w-full sm:w-auto">
                <span className="w-9 h-9 rounded-xl bg-white/20 flex items-center justify-center text-lg shrink-0">
                  {targetOrderIsFrozen ? '❄️' : '🥐'}
                </span>
                <div className="min-w-0">
                  <div className="flex items-center gap-2 flex-wrap">
                    <span className="bg-black/30 text-amber-200 text-[10px] font-black uppercase px-2 py-0.5 rounded-md tracking-wider">
                      Modo Acréscimo
                    </span>
                    <strong className="text-xs sm:text-sm font-black uppercase tracking-tight font-mono">
                      Pedido #{String(appendOrderTarget.id).slice(-4).padStart(4, '0')}
                    </strong>
                    <span className="text-[11px] text-orange-100 hidden md:inline">
                      • Pagamento Presencial na Retirada
                    </span>
                  </div>
                  <p className="text-[11px] text-white/90 font-medium truncate">
                    {targetOrderIsFrozen ? (
                      <>Exclusivo: <strong>Salgados Congelados (até 48h)</strong>. Não adicione itens prontos neste pedido.</>
                    ) : (
                      <>Exclusivo: <strong>Salgados Prontos (Consumo Imediato)</strong>. Não adicione congelados neste pedido.</>
                    )}
                  </p>
                </div>
              </div>

              <div className="flex items-center gap-2 w-full sm:w-auto justify-end shrink-0">
                {appendCart.length > 0 && (
                  <button
                    type="button"
                    onClick={() => setIsAppendReviewModalOpen(true)}
                    className="px-3.5 py-1.5 bg-emerald-600 hover:bg-emerald-700 text-white rounded-xl text-xs font-black uppercase tracking-wider shadow-sm transition-all cursor-pointer flex items-center gap-1.5 active:scale-95"
                  >
                    <span>Revisar Acréscimo ({appendCart.reduce((s, it) => s + it.quantity, 0)})</span>
                    <span className="bg-black/20 px-1.5 py-0.5 rounded text-[10px]">+{formatCurrency(appendCartSubtotal)}</span>
                  </button>
                )}
                <button
                  type="button"
                  onClick={handleCancelAppendOrder}
                  className="px-3 py-1.5 bg-white/15 hover:bg-white/25 text-white rounded-xl text-xs font-bold uppercase tracking-wider transition-all cursor-pointer border border-white/25"
                >
                  Cancelar Acréscimo
                </button>
              </div>
            </div>
          </div>
        )}

        {/* Banner Modo Congelados Ativo */}
        {!appendOrderTarget && (orderModalityPreference === 'frozen' || hasFrozenInCart) && (
          <div className="bg-blue-700 text-white px-3 sm:px-6 py-2 shrink-0 z-30 border-b border-blue-800 shadow-xs">
            <div className="max-w-7xl mx-auto flex flex-wrap items-center justify-between gap-2 text-xs">
              <div className="flex items-center gap-2 min-w-0">
                <span className="shrink-0">❄️</span>
                <p className="font-bold truncate">
                  Pedido de Congelados ativo (prazo de 48h) — somente itens congelados neste pedido.
                </p>
              </div>
              <div className="flex items-center gap-2 shrink-0">
                {availableCategories.some(c => isCategoryFrozenModality(c)) && (
                  <button
                    type="button"
                    onClick={() => {
                      const firstFrozenCat = availableCategories.find(c => isCategoryFrozenModality(c));
                      if (firstFrozenCat) scrollToCategory(firstFrozenCat.id);
                    }}
                    className="px-2.5 py-1 bg-white/15 hover:bg-white/25 text-white rounded-lg font-black text-[11px] transition-colors cursor-pointer whitespace-nowrap"
                  >
                    Ver Congelados
                  </button>
                )}
                <button
                  type="button"
                  onClick={() => {
                    if (hasFrozenInCart) {
                      setCartConflictModal({
                        isOpen: true,
                        type: 'has_frozen_blocked_normal',
                      });
                    } else {
                      switchFromFrozenToNormalAndReschedule();
                    }
                  }}
                  className="px-2.5 py-1 bg-white text-blue-900 hover:bg-blue-50 rounded-lg font-black text-[11px] transition-colors cursor-pointer whitespace-nowrap"
                >
                  Mudar para Outros Produtos
                </button>
              </div>
            </div>
          </div>
        )}

        {/* Categories Bar (Sticky sub-header on Top for All Devices) */}
        <div className="bg-white border-b border-stone-200 shrink-0 z-20 shadow-xs">
          <div className="max-w-4xl lg:max-w-7xl mx-auto px-2.5 sm:px-6">
            <div 
              ref={categoryBarRef}
              className="relative overflow-x-auto no-scrollbar md:desktop-custom-scrollbar scroll-smooth py-1.5 sm:py-2 md:pb-2.5"
            >
              <div className="flex gap-2 sm:gap-3 items-center w-max">
                {availableCategories.map(cat => {
                  const count = categoryCountMap[cat.id] || 0;
                  return (
                    <button
                      key={cat.id}
                      ref={el => { categoryButtonRefs.current[cat.id] = el; }}
                      onClick={() => scrollToCategory(cat.id)}
                      className={`px-3.5 sm:px-5 py-2 sm:py-3 rounded-xl sm:rounded-2xl whitespace-nowrap text-xs sm:text-base font-black transition-all flex items-center gap-1.5 sm:gap-2 shrink-0 cursor-pointer ${
                        activeCategory === cat.id 
                          ? 'text-white shadow-md shadow-orange-500/25 ring-2 ring-orange-500/30' 
                          : 'bg-stone-50 text-stone-700 hover:bg-stone-100 border border-stone-200'
                      }`}
                      style={activeCategory === cat.id ? { backgroundColor: storeInfo.themeColor || '#ea580c' } : {}}
                    >
                      <span>{formatCapitalized(cat.name)}</span>
                      <span className={`text-[11px] sm:text-sm px-1.5 sm:px-2 py-0.5 rounded-full font-bold ${
                        activeCategory === cat.id 
                          ? 'bg-black/20 text-white' 
                          : 'bg-stone-200 text-stone-700'
                      }`}>
                        {count}
                      </span>
                    </button>
                  );
                })}
              </div>
            </div>
          </div>
        </div>

        {/* Content Body: Product Feed (1 per line on Mobile/Tablet, 2 per line on Desktop) */}
        <div className="flex-1 flex overflow-hidden">
          {/* Product Feed */}
          <main ref={productsContainerRef} className="flex-1 overflow-y-auto p-3 sm:p-6 md:p-8 scroll-smooth" id="product-feed">
            {availableCategories.length === 0 ? (
              <div className="flex flex-col items-center justify-center h-full text-stone-400">
                <Search className="w-16 h-16 mb-4 opacity-20" />
                <h3 className="text-xl font-bold mb-1">Nenhum produto encontrado</h3>
                <p className="text-sm">Tente buscar por termos diferentes ou confira outras categorias.</p>
                <button 
                  onClick={() => setSearchTerm('')}
                  className="mt-4 px-6 py-2 bg-white border border-stone-200 rounded-xl font-bold text-stone-600 hover:bg-stone-50"
                >
                  Limpar Busca
                </button>
              </div>
            ) : (
              <>
                {!appendOrderTarget && searchTerm.trim() === '' && bestSellerEntries.length > 0 && (
                  <BestSellersCarousel
                    items={bestSellerEntries}
                    isFrozenOrderActive={orderModalityPreference === 'frozen' || hasFrozenInCart}
                    canBuy={canBuy}
                    cartProductIds={cartProductIds}
                    queuedProductIds={queuedProductIds}
                    variant="feed"
                    themeColor={storeInfo.themeColor || '#ea580c'}
                    onSelectProduct={handleSelectBestSeller}
                    onFinishFrozenNow={() => {
                      const frozenNeedsLaterDate = storeInfo.deliveryScheduleEnabled && hasFrozenInCart && !isDateAllowedForFrozenOrder(selectedScheduleDate);
                      const slotInvalidForDay = storeInfo.deliveryScheduleEnabled && Boolean(selectedScheduleTime) && !isSlotAllowedForDate(storeInfo, selectedScheduleDate, selectedScheduleTime);
                      if (storeInfo.deliveryScheduleEnabled && (!selectedScheduleTime || frozenNeedsLaterDate || slotInvalidForDay)) {
                        if (frozenNeedsLaterDate) {
                          updateOrderModalityPreference('frozen');
                          clearScheduleSelection();
                        } else if (slotInvalidForDay) {
                          setSelectedScheduleTime('');
                          safeStorage.removeItem('balbec_selected_schedule_time');
                        }
                        setScheduleStepMode('pickup');
                        setShowScheduleSelectionStep(true);
                        return;
                      }
                      setIsCheckout(true);
                    }}
                  />
                )}
                {displayedCategories.map(category => {
                const categoryProducts = productsByCategory[category.id] || [];
                if (categoryProducts.length === 0) return null;

                return (
                  <div 
                    key={category.id} 
                    ref={el => { categoryRefs.current[category.id] = el; }}
                    className="mb-8 sm:mb-12 max-w-4xl lg:max-w-7xl mx-auto scroll-mt-4 md:scroll-mt-8"
                    style={{ contentVisibility: 'auto', containIntrinsicSize: '0 400px' }}
                  >
                    <div className="flex flex-wrap items-center gap-3 sm:gap-4 mb-4 sm:mb-8">
                      <h2 className="text-base sm:text-xl md:text-2xl font-black text-red-600 tracking-wider">{formatCapitalized(category.name)}</h2>
                      {isCategoryFrozenModality(category) && (
                        <span className="text-xs font-extrabold text-blue-800 tracking-wide">
                          · ❄️ Modalidade Congelados (48h)
                        </span>
                      )}
                      {!appendOrderTarget && isCategoryFrozenModality(category) && hasNormalInCart && (
                        <span className="text-xs font-extrabold text-amber-800">
                          · ⚠️ Seu carrinho possui itens prontos (finalize antes de pedir congelados)
                        </span>
                      )}
                      {!appendOrderTarget && !isCategoryFrozenModality(category) && (hasFrozenInCart || orderModalityPreference === 'frozen') && (
                        <span className="text-xs font-extrabold text-blue-800">
                          · ⚠️ Nesse pedido, só poderá ter itens congelados
                        </span>
                      )}
                      <div className="flex-1 h-px bg-stone-200"></div>
                      <span className="text-xs sm:text-sm font-bold text-stone-400 uppercase tracking-widest">{categoryProducts.length} {categoryProducts.length === 1 ? 'item' : 'itens'}</span>
                    </div>

                    <div className="grid grid-cols-1 lg:grid-cols-2 gap-3 sm:gap-6">
                      {categoryProducts.map(product => {
                        const isFrozenCategoryContext = Boolean(
                          (product.frozenCategoryId && product.frozenCategoryId === category.id) ||
                          isCategoryFrozenModality(category)
                        );
                        const isSalgado = isSalgadoProduct(product, categories) || isFrozenCategoryContext;
                        const foundCong = products.find(p => p.id === 'prod_congelado');
                        const frozenExtraVal = foundCong && foundCong.price && foundCong.price < 2.0 ? Number(foundCong.price) : 0.30;
                        const displayUnitPrice = (isFrozenCategoryContext && isSalgado) ? (product.price + frozenExtraVal) : product.price;
                        const qtyKey = `${product.id}_${isFrozenCategoryContext ? 'congelado' : 'pronto'}`;

                        const normCatName = normalizeText(category.name || '');
                        const isBakedCategory = normCatName.includes('assad');
                        const isFriedNormalCategory = !isFrozenCategoryContext && !isBakedCategory && (
                          normCatName.includes('frit') ||
                          (normCatName.includes('grande') && normCatName.includes('norma')) ||
                          normCatName.includes('salgad')
                        );
                        const isPrepOptionEnabledForCard = isBakedCategory
                          ? (isFrozenCategoryContext
                              ? storeInfo.salgadoPrepAssadoCongeladoEnabled !== false
                              : storeInfo.salgadoPrepAssadoEnabled !== false)
                          : (isFrozenCategoryContext
                              ? storeInfo.salgadoPrepFritoCongeladoEnabled !== false
                              : (isFriedNormalCategory ? storeInfo.salgadoPrepFritoEnabled !== false : false));
                        const needsPrepChoice = isPrepOptionEnabledForCard && (isFrozenCategoryContext || isBakedCategory || isFriedNormalCategory) && !isAddonProduct(product) && canBuy;
                        const prepChoiceKey = `${category.id}_${product.id}`;

                        const prepOption1: { key: PrepChoiceType; label: string } = isBakedCategory
                          ? { key: isFrozenCategoryContext ? 'congelado_pre_assado' : 'pronto_pre_assado', label: 'PRÉ-ASSADO' }
                          : isFrozenCategoryContext
                            ? { key: 'congelado_cru', label: 'CRU CONGELADO' }
                            : { key: 'pronto_cru', label: 'CRU' };
                        const prepOption2: { key: PrepChoiceType; label: string } = isBakedCategory
                          ? { key: isFrozenCategoryContext ? 'congelado_assado_pronto' : 'pronto_assado_pronto', label: 'ASSADO PRONTO' }
                          : isFrozenCategoryContext
                            ? { key: 'congelado_frito', label: 'FRITO CONGELADO' }
                            : { key: 'pronto_frito', label: 'FRITO' };

                        const isItemFrozenHelper = (ci: any) => Boolean(
                          ci.isFrozen || ci.prepType?.startsWith('congelado') || ci.addons?.some((a: any) => a.isFrozen || a.productId === 'prod_congelado' || (a.name && a.name.toLowerCase().includes('congelad')))
                        );
                        const activeCartList = appendOrderTarget ? appendCart : cart;
                        const setActiveCartList = appendOrderTarget ? setAppendCart : setCart;
                        const cartItemsForProd = activeCartList.filter(ci => ci.productId === product.id && isItemFrozenHelper(ci) === isFrozenCategoryContext);
                        const totalCartQty = cartItemsForProd.reduce((sum, ci) => sum + ci.quantity, 0);
                        const rawSelectedPrep = needsPrepChoice ? frozenPrepChoices[prepChoiceKey] : undefined;
                        const mainCartItem = (rawSelectedPrep
                          ? cartItemsForProd.find(ci => (ci.prepType || '') === rawSelectedPrep)
                          : undefined) || cartItemsForProd[0];

                        const isSameCartItem = (ci: any, target: any) => Boolean(
                          target &&
                          ci.productId === target.productId &&
                          (ci.prepType || '') === (target.prepType || '') &&
                          isItemFrozenHelper(ci) === isFrozenCategoryContext &&
                          JSON.stringify(ci.addons || []) === JSON.stringify(target.addons || []) &&
                          JSON.stringify(ci.flavor || null) === JSON.stringify(target.flavor || null)
                        );

                        const validKeysForCard: PrepChoiceType[] = [prepOption1.key, prepOption2.key];
                        const rawCartPrep = mainCartItem?.prepType as PrepChoiceType | undefined;
                        const selectedPrepChoice: PrepChoiceType | null = needsPrepChoice
                          ? (frozenPrepChoices[prepChoiceKey] ||
                              (rawCartPrep && validKeysForCard.includes(rawCartPrep) ? rawCartPrep : null))
                          : null;

                        const missingPrepToast = isBakedCategory
                          ? 'Selecione PRÉ-ASSADO ou ASSADO PRONTO!'
                          : isFrozenCategoryContext
                            ? 'Selecione CRU CONGELADO ou FRITO CONGELADO! ❄️'
                            : 'Selecione CRU ou FRITO!';

                        const isFrozenBlockedCard = Boolean(
                          !isFrozenCategoryContext &&
                          !appendOrderTarget &&
                          !isAddonProduct(product) &&
                          canBuy &&
                          (orderModalityPreference === 'frozen' || hasFrozenInCart)
                        );

                        const openFrozenOnlyWarning = (qtyVal: number = 1) => {
                          setCartConflictModal({
                            isOpen: true,
                            type: hasFrozenInCart ? 'has_frozen_blocked_normal' : 'frozen_mode_blocked_normal',
                            product,
                            qty: qtyVal,
                            isFrozenContext: false
                          });
                        };

                        const handleSelectPrepChoice = (choice: PrepChoiceType) => {
                          if (isFrozenBlockedCard) {
                            openFrozenOnlyWarning(1);
                            return;
                          }
                          setFrozenPrepChoices(prev => ({ ...prev, [prepChoiceKey]: choice }));
                          setFrozenPrepErrors(prev => ({ ...prev, [prepChoiceKey]: false }));
                          if (cartItemsForProd.length === 1 && mainCartItem) {
                            const newLabel = getPrepChoiceLabel(choice);
                            setActiveCartList(prev => prev.map(ci => (
                              isSameCartItem(ci, mainCartItem)
                                ? { ...ci, prepType: choice, prepLabel: newLabel }
                                : ci
                            )));
                          }
                        };

                        return (
                        <div 
                          key={`${category.id}_${product.id}`} 
                          onClick={() => {
                            if (isFrozenBlockedCard) {
                              openFrozenOnlyWarning(1);
                            }
                          }}
                          className={`bg-white rounded-2xl sm:rounded-3xl border border-stone-200/90 p-3 sm:p-5 md:p-6 lg:p-5 flex gap-3 sm:gap-6 lg:gap-4 hover:shadow-xl hover:shadow-stone-200/50 transition-all group items-center ${isFrozenBlockedCard ? 'cursor-pointer opacity-90 hover:border-blue-300' : ''}`}
                        >
                          <div className="w-22 h-22 sm:w-36 sm:h-36 md:w-44 md:h-44 lg:w-32 lg:h-32 xl:w-36 xl:h-36 shrink-0 bg-stone-50 rounded-xl sm:rounded-2xl overflow-hidden relative flex items-center justify-center border border-stone-100">
                            <ProductImage 
                              src={product.imageUrl} 
                              alt={product.name}
                              className="w-full h-full object-cover transition-transform group-hover:scale-105 duration-500"
                            />
                          </div>

                          <div className="flex-1 flex flex-col justify-between self-stretch min-w-0 py-0.5 sm:py-1">
                            <div>
                              <div className="flex flex-wrap items-center gap-1.5 mb-1">
                                <h3 className="text-sm sm:text-xl md:text-2xl lg:text-lg xl:text-xl font-black text-[#5c4033] leading-snug tracking-tight line-clamp-2">
                                  {formatCapitalized(product.name)}
                                </h3>
                              </div>
                              {isFrozenCategoryContext && (
                                <span className="inline-flex items-center gap-1 text-[10px] sm:text-xs font-extrabold text-blue-800 bg-blue-50 border border-blue-200 px-2 py-0.5 rounded-md mb-1.5">
                                  ❄️ Congelado (Prazo até 48h)
                                </span>
                              )}
                              {(product.externalId || product.description) && (
                                <p className="text-xs sm:text-base lg:text-xs xl:text-sm text-red-600 line-clamp-2 sm:line-clamp-3 mb-2 leading-relaxed font-medium italic">
                                  {formatCapitalized(formatProductDescriptionWithCode(product.description, product.externalId))}
                                </p>
                              )}

                              {/* Opções de preparo com quantidades independentes (ex: 10 cru e 10 frito simultaneamente) */}
                              {needsPrepChoice && (
                                <div className="space-y-2 mb-2">
                                  {[prepOption1, prepOption2].map(opt => {
                                    const optCartItem = cartItemsForProd.find(ci => (ci.prepType || '') === opt.key);
                                    const optQty = optCartItem ? optCartItem.quantity : 0;
                                    const optQtyKey = `${qtyKey}_${opt.key}`;
                                    const localInputVal = productQuantities[optQtyKey] !== undefined ? productQuantities[optQtyKey] : (optQty > 0 ? optQty : 1);
                                    const numericOptQty = Math.max(1, parseInt(String(localInputVal), 10) || 1);

                                    return (
                                      <div 
                                        key={opt.key}
                                        onClick={(e) => e.stopPropagation()}
                                        className={`p-2 rounded-xl border flex items-center justify-between gap-2 ${
                                          optQty > 0
                                            ? (isFrozenCategoryContext ? 'bg-blue-50/80 border-blue-300 shadow-2xs' : 'bg-amber-50/80 border-amber-300 shadow-2xs')
                                            : 'bg-stone-50 border-stone-200 hover:border-stone-300'
                                        }`}
                                      >
                                        <div className="flex items-center gap-1.5 min-w-0">
                                          <span className="text-xs shrink-0">
                                            {isFrozenCategoryContext ? '❄️' : '🔥'}
                                          </span>
                                          <div className="min-w-0">
                                            <span className="text-xs font-black uppercase tracking-tight text-stone-900 block truncate">
                                              {opt.label}
                                            </span>
                                            {optQty > 0 && (
                                              <span className="text-[10px] font-bold text-emerald-700 block leading-none mt-0.5">
                                                No carrinho: {optQty} un.
                                              </span>
                                            )}
                                          </div>
                                        </div>

                                        <div className="flex items-center gap-1 bg-white rounded-xl p-1 border border-stone-200 shrink-0">
                                          {optQty > 0 && (
                                            <button
                                              type="button"
                                              onClick={() => {
                                                setActiveCartList(prev => prev.filter(ci => !isSameCartItem(ci, optCartItem)));
                                                setProductQuantities(prev => {
                                                  const next = { ...prev };
                                                  delete next[optQtyKey];
                                                  return next;
                                                });
                                              }}
                                              className="p-1 hover:bg-red-50 rounded-lg text-red-500 hover:text-red-700 transition-colors cursor-pointer"
                                              title="Remover esta modalidade"
                                            >
                                              <Trash2 className="w-3.5 h-3.5" />
                                            </button>
                                          )}

                                          <button
                                            type="button"
                                            onClick={() => {
                                              if (optQty > 0 && optCartItem) {
                                                const newQ = optCartItem.quantity - 1;
                                                if (newQ <= 0) {
                                                  setActiveCartList(prev => prev.filter(ci => !isSameCartItem(ci, optCartItem)));
                                                } else {
                                                  setActiveCartList(prev => prev.map(ci => isSameCartItem(ci, optCartItem) ? { ...ci, quantity: newQ } : ci));
                                                }
                                              } else {
                                                const cur = numericOptQty;
                                                if (cur > 1) {
                                                  setProductQuantities(prev => ({ ...prev, [optQtyKey]: cur - 1 }));
                                                }
                                              }
                                            }}
                                            className="p-1 hover:bg-stone-100 rounded-lg text-stone-600 transition-colors cursor-pointer"
                                            title="Diminuir"
                                          >
                                            <Minus className="w-3.5 h-3.5" />
                                          </button>

                                          <input
                                            type="text"
                                            inputMode="numeric"
                                            pattern="[0-9]*"
                                            value={optQty > 0 ? optQty : localInputVal}
                                            onChange={(e) => {
                                              const raw = e.target.value.replace(/\D/g, '');
                                              setProductQuantities(prev => ({ ...prev, [optQtyKey]: raw }));
                                              if (raw !== '' && optQty > 0 && optCartItem) {
                                                const val = Math.max(1, parseInt(raw, 10) || 1);
                                                setActiveCartList(prev => prev.map(ci => isSameCartItem(ci, optCartItem) ? { ...ci, quantity: val } : ci));
                                              }
                                            }}
                                            className="font-black text-xs w-10 text-center py-0.5 rounded bg-stone-50 text-stone-900 border border-stone-300 font-mono"
                                          />

                                          <button
                                            type="button"
                                            onClick={() => {
                                              if (isFrozenBlockedCard) {
                                                openFrozenOnlyWarning(1);
                                                return;
                                              }
                                              if (optQty > 0 && optCartItem) {
                                                const newQ = optCartItem.quantity + 1;
                                                setActiveCartList(prev => prev.map(ci => isSameCartItem(ci, optCartItem) ? { ...ci, quantity: newQ } : ci));
                                              } else {
                                                initiateAddToCartWithQty(product, numericOptQty, isFrozenCategoryContext, false, opt.key);
                                                setProductQuantities(prev => {
                                                  const next = { ...prev };
                                                  delete next[optQtyKey];
                                                  return next;
                                                });
                                              }
                                            }}
                                            className="p-1 hover:bg-orange-50 rounded-lg text-orange-600 transition-colors cursor-pointer"
                                            title="Adicionar / Aumentar"
                                          >
                                            <Plus className="w-3.5 h-3.5" />
                                          </button>
                                        </div>
                                      </div>
                                    );
                                  })}
                                </div>
                              )}
                            </div>
                            
                            <div className="mt-auto pt-1 sm:pt-2 flex items-center justify-between gap-2 sm:gap-3">
                              <span className="text-base sm:text-2xl md:text-3xl lg:text-xl xl:text-2xl font-black text-orange-600">
                                {formatCurrency(displayUnitPrice)}
                              </span>
                              {isAddonProduct(product) ? (
                                <span className="text-[11px] sm:text-sm font-bold text-amber-800 bg-amber-50 border border-amber-200/80 px-2.5 py-1 sm:px-3 sm:py-2 rounded-xl select-none">
                                  Apenas nos lanches
                                </span>
                              ) : !canBuy ? (
                                <span className="text-[11px] sm:text-sm font-bold text-stone-500 bg-stone-100 border border-stone-200/80 px-2 py-1 sm:px-3 sm:py-2 rounded-xl select-none flex items-center gap-1">
                                  👁️ Apenas visualização
                                </span>
                              ) : (
                                (() => {
                                  const minRequired = (isFrozenCategoryContext && Number(product.minFrozenQuantity) > 1) 
                                    ? Number(product.minFrozenQuantity) 
                                    : 1;

                                  const displayedQty = productQuantities[qtyKey] !== undefined
                                    ? productQuantities[qtyKey]
                                    : (totalCartQty > 0 ? totalCartQty : minRequired);
                                  const numericQty = (() => {
                                    const parsed = parseInt(String(displayedQty), 10);
                                    return isNaN(parsed) || parsed < minRequired ? minRequired : parsed;
                                  })();

                                  return (
                                    <div className="flex flex-col items-end gap-1">
                                      {/* Informação visual de quantidade mínima caso configurada */}
                                      {isFrozenCategoryContext && minRequired > 1 && (
                                        <span className="text-[10px] font-black text-blue-700 bg-blue-50 border border-blue-200 px-1.5 py-0.5 rounded">
                                          Mínimo: {minRequired} un
                                        </span>
                                      )}

                                      {totalCartQty > 0 && isFrozenCategoryContext && (
                                        <span className="text-[10px] sm:text-[11px] font-black text-blue-700 bg-blue-50 border border-blue-200 px-2.5 py-0.5 rounded-md uppercase tracking-wider flex items-center gap-1 shadow-2xs">
                                          <span>❄️ {mainCartItem?.prepLabel || 'CONGELADO'} ({totalCartQty})</span>
                                        </span>
                                      )}

                                      {totalCartQty > 0 && !isFrozenCategoryContext && (
                                        <span className="text-[10px] sm:text-[11px] font-black text-amber-800 bg-amber-50 border border-amber-200 px-2.5 py-0.5 rounded-md uppercase tracking-wider flex items-center gap-1 shadow-2xs">
                                          <span>🔥 {mainCartItem?.prepLabel || 'PRONTO'} ({totalCartQty})</span>
                                        </span>
                                      )}

                                      <div className="flex items-center gap-1 sm:gap-1.5 bg-stone-100 rounded-xl p-1">
                                        <button 
                                          type="button"
                                          onClick={() => {
                                            if (totalCartQty > 0) {
                                              setActiveCartList(prev => prev.filter(ci => !(ci.productId === product.id && isItemFrozenHelper(ci) === isFrozenCategoryContext)));
                                            }
                                            setProductQuantities(prev => {
                                              const next = { ...prev };
                                              delete next[qtyKey];
                                              return next;
                                            });
                                            if (needsPrepChoice) {
                                              setFrozenPrepChoices(prev => {
                                                const next = { ...prev };
                                                delete next[prepChoiceKey];
                                                return next;
                                              });
                                              setFrozenPrepErrors(prev => {
                                                const next = { ...prev };
                                                delete next[prepChoiceKey];
                                                return next;
                                              });
                                            }
                                          }}
                                          className="p-1 hover:bg-red-50 rounded-lg text-red-500 hover:text-red-700 transition-colors cursor-pointer"
                                          title={totalCartQty > 0 ? "Excluir item do pedido" : "Zerar quantidade"}
                                        >
                                          <Trash2 className="w-4 h-4 text-red-500" />
                                        </button>

                                        <button 
                                          type="button"
                                          onClick={() => {
                                            const step = minRequired > 1 ? minRequired : 1;
                                            if (totalCartQty > 0 && mainCartItem) {
                                              const newQ = mainCartItem.quantity - step;
                                              if (newQ < minRequired) {
                                                setActiveCartList(prev => prev.filter(ci => !isSameCartItem(ci, mainCartItem)));
                                              } else {
                                                setActiveCartList(prev => prev.map(ci => isSameCartItem(ci, mainCartItem) ? { ...ci, quantity: newQ } : ci));
                                              }
                                              setProductQuantities(prev => {
                                                if (prev[qtyKey] === undefined) return prev;
                                                const next = { ...prev };
                                                delete next[qtyKey];
                                                return next;
                                              });
                                            } else {
                                              const nextQty = Math.max(minRequired, numericQty - step);
                                              setProductQuantities(prev => ({
                                                ...prev,
                                                [qtyKey]: nextQty
                                              }));
                                            }
                                          }}
                                          className="p-1 hover:bg-white rounded-lg text-stone-600 hover:text-stone-900 transition-colors cursor-pointer"
                                          title="Diminuir"
                                        >
                                          <Minus className="w-4 h-4" />
                                        </button>

                                        <input
                                          type="text"
                                          inputMode="numeric"
                                          pattern="[0-9]*"
                                          readOnly={minRequired > 1}
                                          value={displayedQty}
                                          onFocus={(e) => { if (minRequired === 1) e.target.select(); }}
                                          onChange={(e) => {
                                            if (minRequired > 1) return;
                                            const raw = e.target.value.replace(/\D/g, '');
                                            setProductQuantities(prev => ({ ...prev, [qtyKey]: raw }));
                                            if (raw !== '') {
                                              const val = parseInt(raw, 10);
                                              if (!isNaN(val) && val >= minRequired && totalCartQty > 0 && mainCartItem) {
                                                const otherVariantsQty = totalCartQty - mainCartItem.quantity;
                                                const updatedMainQty = Math.max(minRequired, val - otherVariantsQty);
                                                setActiveCartList(prev => prev.map(ci => isSameCartItem(ci, mainCartItem) ? { ...ci, quantity: updatedMainQty } : ci));
                                              }
                                            }
                                          }}
                                          onBlur={() => {
                                            if (minRequired > 1) return;
                                            const raw = productQuantities[qtyKey];
                                            if (totalCartQty > 0) {
                                              if (raw !== '' && raw !== undefined && mainCartItem) {
                                                const parsed = parseInt(String(raw), 10);
                                                const safe = isNaN(parsed) || parsed < minRequired ? minRequired : parsed;
                                                const otherVariantsQty = totalCartQty - mainCartItem.quantity;
                                                const updatedMainQty = Math.max(minRequired, safe - otherVariantsQty);
                                                setActiveCartList(prev => prev.map(ci => isSameCartItem(ci, mainCartItem) ? { ...ci, quantity: updatedMainQty } : ci));
                                              }
                                              setProductQuantities(prev => {
                                                if (prev[qtyKey] === undefined) return prev;
                                                const next = { ...prev };
                                                delete next[qtyKey];
                                                return next;
                                              });
                                            } else if (raw === '' || raw === undefined) {
                                              setProductQuantities(prev => {
                                                if (prev[qtyKey] === undefined) return prev;
                                                const next = { ...prev };
                                                delete next[qtyKey];
                                                return next;
                                              });
                                            } else {
                                              const parsed = parseInt(String(raw), 10);
                                              const safe = isNaN(parsed) || parsed < minRequired ? minRequired : parsed;
                                              setProductQuantities(prev => ({ ...prev, [qtyKey]: safe }));
                                            }
                                          }}
                                          onKeyDown={(e) => {
                                            if (e.key === 'Enter') {
                                              (e.target as HTMLInputElement).blur();
                                              if (isFrozenBlockedCard) {
                                                openFrozenOnlyWarning(numericQty || 1);
                                                return;
                                              }
                                              if (minRequired > 1) return;
                                              const raw = productQuantities[qtyKey];
                                              const parsed = parseInt(String(raw ?? displayedQty), 10);
                                              const qty = isNaN(parsed) || parsed < minRequired ? minRequired : parsed;
                                              if (totalCartQty === 0) {
                                                if (needsPrepChoice && !selectedPrepChoice) {
                                                  setFrozenPrepErrors(prev => ({ ...prev, [prepChoiceKey]: true }));
                                                  setCartToastMessage(missingPrepToast);
                                                  setTimeout(() => setCartToastMessage(null), 3000);
                                                  return;
                                                }
                                                initiateAddToCartWithQty(product, qty, isFrozenCategoryContext, false, selectedPrepChoice || undefined);
                                              }
                                            }
                                          }}
                                          placeholder={String(minRequired)}
                                          className={`font-black text-xs sm:text-sm w-12 sm:w-14 text-center py-1 rounded-lg bg-white text-stone-900 border border-stone-300 focus:ring-2 focus:ring-orange-500 focus:outline-none shadow-2xs font-mono ${minRequired > 1 ? 'cursor-not-allowed bg-stone-50' : ''}`}
                                          title={minRequired > 1 ? `Quantidade mínima de ${minRequired} un (multiplicada pelos botões + / -)` : "Digite a quantidade (pode apagar tudo)"}
                                        />

                                        <button 
                                          type="button"
                                          onClick={(e) => {
                                            e.stopPropagation();
                                            if (isFrozenBlockedCard) {
                                              openFrozenOnlyWarning(numericQty > 0 ? numericQty : minRequired);
                                              return;
                                            }
                                            const step = minRequired > 1 ? minRequired : 1;
                                            setProductQuantities(prev => {
                                              if (prev[qtyKey] === undefined) return prev;
                                              const next = { ...prev };
                                              delete next[qtyKey];
                                              return next;
                                            });
                                            if (totalCartQty > 0) {
                                              const matchingPrepItem = (needsPrepChoice && selectedPrepChoice)
                                                ? cartItemsForProd.find(ci => (ci.prepType || '') === selectedPrepChoice)
                                                : mainCartItem;
                                              if (matchingPrepItem) {
                                                const newQ = matchingPrepItem.quantity + step;
                                                setActiveCartList(prev => prev.map(ci => isSameCartItem(ci, matchingPrepItem) ? { ...ci, quantity: newQ } : ci));
                                              } else {
                                                if (needsPrepChoice && !selectedPrepChoice) {
                                                  setFrozenPrepErrors(prev => ({ ...prev, [prepChoiceKey]: true }));
                                                  setCartToastMessage(missingPrepToast);
                                                  setTimeout(() => setCartToastMessage(null), 3000);
                                                  return;
                                                }
                                                initiateAddToCartWithQty(product, step, isFrozenCategoryContext, false, selectedPrepChoice || undefined);
                                              }
                                            } else {
                                              if (needsPrepChoice && !selectedPrepChoice) {
                                                setFrozenPrepErrors(prev => ({ ...prev, [prepChoiceKey]: true }));
                                                setCartToastMessage(missingPrepToast);
                                                setTimeout(() => setCartToastMessage(null), 3000);
                                                return;
                                              }
                                              initiateAddToCartWithQty(product, numericQty > 0 ? numericQty : minRequired, isFrozenCategoryContext, false, selectedPrepChoice || undefined);
                                            }
                                          }}
                                          className="p-1 hover:bg-white rounded-lg text-stone-600 hover:text-stone-900 transition-colors cursor-pointer"
                                          title={totalCartQty > 0 ? "Aumentar / Alterar preparo" : "Adicionar ao pedido"}
                                        >
                                          <Plus className="w-4 h-4" />
                                        </button>
                                      </div>
                                    </div>
                                  );
                                })()
                              )}
                            </div>
                          </div>
                        </div>
                        );
                      })}
                    </div>
                  </div>
                );
              })}
              </>
            )}

            {/* Redesigned Footer */}
            <footer className="mt-12 py-12 border-t border-stone-200 flex flex-col items-center text-center">
              {storeInfo.logoUrl ? (
                <img 
                  src={storeInfo.logoUrl} 
                  alt="Logo" 
                  className="w-12 h-12 aspect-square object-cover rounded-full opacity-20 mb-6"
                  referrerPolicy="no-referrer"
                />
              ) : null}
              <p className="text-stone-400 text-[10px] font-black uppercase tracking-[0.2em] mb-4">
                © {new Date().getFullYear()} {storeInfo.name}
              </p>
              <nav className="flex flex-wrap items-center justify-center gap-x-6 gap-y-2">
                <Link to="/privacidade" className="text-stone-400 hover:text-amber-600 transition-colors text-xs font-medium">
                  Privacidade & LGPD
                </Link>
                <Link to="/admin" className="text-stone-400 hover:text-orange-500 transition-colors flex items-center gap-1.5 text-xs font-medium">
                  <Settings className="w-4 h-4" />
                  <span>Painel de Controle</span>
                </Link>
                {storeInfo.whatsapp && (
                  <a 
                    href={`https://wa.me/55${storeInfo.whatsapp.replace(/\D/g, '').replace(/^55/, '')}`} 
                    target="_blank" 
                    rel="noopener noreferrer" 
                    className="text-stone-400 hover:text-emerald-600 transition-colors text-xs font-medium"
                  >
                    Fale Conosco
                  </a>
                )}
              </nav>
            </footer>
          </main>
        </div>
      </div>

      {/* Sticky Bottom Red Checkout Bar (For All Screens: Mobile, Tablet & Desktop) */}
      {!isCartOpen && cart.length > 0 && !isCheckout && !appendOrderTarget && (
        <div className="fixed bottom-0 left-0 right-0 p-3 sm:p-4 z-[40] max-w-xl mx-auto pointer-events-auto">
          <button
            onClick={() => setIsCartOpen(true)}
            className="w-full h-14 sm:h-16 bg-red-600 hover:bg-red-700 active:bg-red-800 text-white rounded-2xl shadow-2xl flex items-center justify-between px-4 sm:px-6 transform active:scale-[0.98] transition-all cursor-pointer border-2 border-red-500/60"
          >
            <div className="flex items-center gap-2 sm:gap-3">
              <div className="bg-red-900/80 px-2.5 py-1 sm:px-3 sm:py-1.5 rounded-xl text-xs sm:text-sm font-black tracking-wide border border-red-400/40">
                {cart.reduce((sum, item) => sum + item.quantity, 0)} {cart.reduce((sum, item) => sum + item.quantity, 0) === 1 ? 'item' : 'itens'}
              </div>
              <span className="font-extrabold text-xs sm:text-base uppercase tracking-tight">Ver Carrinho</span>
            </div>
            <div className="flex items-center gap-1.5 sm:gap-2">
              <span className="text-base sm:text-xl font-black">{formatCurrency(total)}</span>
              <ChevronRight className="w-5 h-5 sm:w-6 sm:h-6" />
            </div>
          </button>
        </div>
      )}

      {/* Sticky Bottom Append Mode Review Bar (Quando em Modo Acréscimo e com itens) */}
      {appendOrderTarget && appendCart.length > 0 && (
        <div className="fixed bottom-0 left-0 right-0 p-3 sm:p-4 z-[40] max-w-xl mx-auto pointer-events-auto animate-in slide-in-from-bottom-3 duration-200">
          <button
            onClick={() => setIsAppendReviewModalOpen(true)}
            className="w-full h-14 sm:h-16 bg-gradient-to-r from-emerald-600 to-teal-600 hover:from-emerald-700 hover:to-teal-700 text-white rounded-2xl shadow-2xl flex items-center justify-between px-4 sm:px-6 transform active:scale-[0.98] transition-all cursor-pointer border-2 border-emerald-400/60"
          >
            <div className="flex items-center gap-2 sm:gap-3">
              <div className="bg-emerald-950/70 px-2.5 py-1 sm:px-3 sm:py-1.5 rounded-xl text-xs sm:text-sm font-black tracking-wide border border-emerald-400/40">
                +{appendCart.reduce((sum, item) => sum + item.quantity, 0)} {appendCart.reduce((sum, item) => sum + item.quantity, 0) === 1 ? 'item' : 'itens'}
              </div>
              <div className="text-left">
                <span className="font-extrabold text-xs sm:text-base uppercase tracking-tight block leading-tight">
                  Revisar Acréscimo
                </span>
                <span className="text-[10px] text-emerald-100 font-mono block">
                  Pedido #{String(appendOrderTarget.id).slice(-4).padStart(4, '0')}
                </span>
              </div>
            </div>
            <div className="flex items-center gap-1.5 sm:gap-2">
              <span className="text-base sm:text-xl font-black">+{formatCurrency(appendCartSubtotal)}</span>
              <ChevronRight className="w-5 h-5 sm:w-6 sm:h-6" />
            </div>
          </button>
        </div>
      )}

      {/* Cart Drawer Modal Backdrop */}
      {isCartOpen && (
        <div 
          className="fixed inset-0 bg-black/60 backdrop-blur-xs z-50 transition-opacity"
          onClick={() => setIsCartOpen(false)}
        />
      )}

      {/* Cart Drawer (Sliding Panel for Desktop, Tablet & Mobile) */}
      <div className={`
        bg-white flex flex-col h-full shrink-0 z-50 fixed inset-y-0 right-0 w-full sm:w-112 md:w-120 shadow-2xl transform transition-transform duration-300 ease-out
        ${isCartOpen ? 'translate-x-0' : 'translate-x-full pointer-events-none'}
      `}>
        {/* Top Header: "Voltar às Compras" + Close Button */}
        <div className="p-4 bg-stone-900 text-white border-b border-stone-800 flex items-center justify-between">
          <button 
            onClick={() => setIsCartOpen(false)}
            className="px-3.5 py-2 bg-stone-800 hover:bg-stone-700 text-orange-400 rounded-xl font-bold text-xs flex items-center gap-2 transition-colors cursor-pointer"
          >
            <ArrowLeft className="w-4 h-4" />
            <span>Voltar às Compras</span>
          </button>

          <button 
            onClick={() => setIsCartOpen(false)} 
            className="w-8 h-8 rounded-full bg-stone-800 text-stone-300 flex items-center justify-center hover:bg-stone-700 hover:text-white transition-colors cursor-pointer"
            title="Fechar Carrinho"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Cart Title Bar */}
        <div className="px-6 py-4 border-b border-stone-100 bg-stone-50 flex items-center justify-between">
          <div className="flex items-center gap-3">
            <ShoppingCart className="w-6 h-6" style={{ color: storeInfo.themeColor || '#ea580c' }} />
            <h2 className="text-xl font-black text-stone-900">Seu Pedido ({cart.reduce((sum, item) => sum + item.quantity, 0)})</h2>
          </div>
          {cart.length > 0 && (
            <button
              onClick={() => {
                setCart([]);
                safeStorage.removeItem('balbec_active_cart');
                setFrozenPrepChoices({});
                setFrozenPrepErrors({});
              }}
              className="text-xs text-stone-500 hover:text-red-600 font-bold transition-colors cursor-pointer"
            >
              Limpar Pedido
            </button>
          )}
        </div>

        <div className="flex-1 overflow-y-auto p-4 space-y-4">
          {cart.length === 0 ? (
            <div className="h-full flex flex-col items-center justify-center text-stone-400 p-8 text-center">
              <ShoppingCart className="w-16 h-16 mb-4 opacity-20 text-stone-600" />
              <p className="font-bold text-stone-700 text-base mb-1">Seu carrinho está vazio</p>
              <p className="text-xs text-stone-500 mb-6">Navegue pelo cardápio e adicione seus itens favoritos.</p>
              <button
                onClick={() => setIsCartOpen(false)}
                className="px-5 py-2.5 bg-orange-600 text-white rounded-xl font-bold text-sm hover:bg-orange-700 transition-colors cursor-pointer flex items-center gap-2"
              >
                <ArrowLeft className="w-4 h-4" />
                <span>Ver Cardápio</span>
              </button>
            </div>
          ) : (
            <>
              {hasFrozenInCart && (
                <div className="bg-blue-50 border border-blue-200 rounded-xl p-3 text-xs text-blue-900 font-medium space-y-1">
                  <div className="flex items-center gap-1.5 font-bold text-blue-950">
                    <span>❄️</span>
                    <span>Carrinho de Congelados (Prazo até 48h)</span>
                  </div>
                  <p className="text-[11px] text-blue-800 leading-snug">
                    Este pedido contém salgados congelados com prazo de produção de até 48h (podendo ficar pronto antes).
                  </p>
                </div>
              )}
              {cart.map(item => {
                const itemKey = item.productId + (item.prepType || '') + JSON.stringify(item.addons || []) + JSON.stringify(item.flavor || null);
                return (
                  <div key={itemKey} className="bg-white p-4 rounded-2xl border border-stone-200 shadow-xs flex gap-4 items-center">
                    <div className="w-16 h-16 bg-stone-50 rounded-xl overflow-hidden shrink-0 border border-stone-100">
                      <ProductImage 
                        src={item.imageUrl} 
                        alt={item.name}
                        className="w-full h-full object-cover"
                      />
                    </div>
                    <div className="flex-1 min-w-0">
                      <div className="flex justify-between font-bold mb-1">
                        <span className="line-clamp-1 pr-2 text-stone-900">{formatCapitalized(item.name)}</span>
                        <span className="text-orange-600 font-black">{formatCurrency((item.price + (item.flavor?.price || 0) + (item.addons?.reduce((sum, a) => sum + a.price, 0) || 0)) * item.quantity)}</span>
                      </div>
                      {item.prepLabel ? (
                        <div className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-md text-[11px] font-black uppercase tracking-wider my-0.5 border ${
                          item.isFrozen || item.prepType?.startsWith('congelado')
                            ? 'bg-blue-50 border-blue-200 text-blue-700 animate-pulse'
                            : 'bg-amber-50 border-amber-200 text-amber-800'
                        }`}>
                          <span>{item.isFrozen || item.prepType?.startsWith('congelado') ? '❄️' : '🔥'}</span>
                          <span>{item.prepLabel} {item.isFrozen ? '(+R$ 0,30/un)' : ''}</span>
                        </div>
                      ) : (item.isFrozen || item.addons?.some((a: any) => a.isFrozen || a.productId === 'prod_congelado' || (a.name && a.name.toLowerCase().includes('congelad')))) ? (
                        <div className="inline-flex items-center gap-1 px-2 py-0.5 rounded-md bg-blue-50 border border-blue-200 text-blue-600 animate-pulse text-[11px] font-black uppercase tracking-wider my-0.5">
                          <span>❄️</span>
                          <span>CONGELADO (+R$ 0,30/un)</span>
                        </div>
                      ) : null}
                      {item.description && (
                        <div className="text-xs text-red-600 italic font-medium line-clamp-1 mb-0.5">
                          {formatCapitalized(item.description)}
                        </div>
                      )}
                      {item.flavor && (
                        <div className="text-xs text-stone-500 mb-0.5 truncate">
                          Sabor: {formatCapitalized(item.flavor.name)}
                          {resolveAddonCode(item.flavor) && (
                            <span className="font-mono text-[10px] font-bold text-stone-700 ml-1">[CÓD: {resolveAddonCode(item.flavor)}]</span>
                          )}
                        </div>
                      )}
                      {item.addons && item.addons.length > 0 && (
                        <div className="text-xs text-stone-500 mb-0.5 space-y-0.5">
                          {item.addons.map((a, aIdx) => {
                            const aCode = a.externalId || a.code || resolveAddonCode(a);
                            return (
                              <div key={aIdx} className="truncate">
                                + {formatCapitalized(a.name)}
                                {aCode && (
                                  <span className="font-mono text-[10px] font-bold text-stone-700 ml-1">[CÓD: {aCode}]</span>
                                )}
                              </div>
                            );
                          })}
                        </div>
                      )}
                      <div className="flex items-center justify-between mt-2 pt-2 border-t border-stone-100">
                        <div className="flex flex-col">
                          <span className="text-xs text-stone-400 font-medium">{formatCurrency(item.price + (item.flavor?.price || 0) + (item.addons?.reduce((sum, a) => sum + a.price, 0) || 0))} un</span>
                          {(() => {
                            const prod = products.find(p => p.id === item.productId);
                            const isFrozen = item.isFrozen || item.prepType?.startsWith('congelado') || item.addons?.some((a: any) => a.isFrozen || a.productId === 'prod_congelado');
                            const minQ = (isFrozen && prod && Number(prod.minFrozenQuantity) > 1) ? Number(prod.minFrozenQuantity) : 1;
                            return minQ > 1 ? (
                              <span className="text-[9px] font-bold text-blue-700">Mín: {minQ} un</span>
                            ) : null;
                          })()}
                        </div>
                        <div className="flex items-center gap-1 sm:gap-1.5 bg-stone-100 rounded-xl p-1">
                          <button 
                            type="button"
                            onClick={() => {
                              setCart(prev => prev.filter(ci => !(ci.productId === item.productId && (ci.prepType || '') === (item.prepType || '') && JSON.stringify(ci.addons) === JSON.stringify(item.addons) && JSON.stringify(ci.flavor) === JSON.stringify(item.flavor))));
                            }}
                            className="p-1 hover:bg-red-50 rounded-lg text-red-500 hover:text-red-700 transition-colors cursor-pointer"
                            title="Excluir item do pedido"
                          >
                            <Trash2 className="w-4 h-4 text-red-500" />
                          </button>
                          <button 
                            type="button"
                            onClick={() => {
                              const prod = products.find(p => p.id === item.productId);
                              const isFrozen = item.isFrozen || item.prepType?.startsWith('congelado') || item.addons?.some((a: any) => a.isFrozen || a.productId === 'prod_congelado');
                              const minQ = (isFrozen && prod && Number(prod.minFrozenQuantity) > 1) ? Number(prod.minFrozenQuantity) : 1;
                              const step = minQ > 1 ? minQ : 1;
                              if (item.quantity - step < minQ) {
                                setCart(prev => prev.filter(ci => !(ci.productId === item.productId && (ci.prepType || '') === (item.prepType || '') && JSON.stringify(ci.addons) === JSON.stringify(item.addons) && JSON.stringify(ci.flavor) === JSON.stringify(item.flavor))));
                              } else {
                                updateQuantity(item.productId, item.addons, item.flavor, -step, item.prepType);
                              }
                            }}
                            className="p-1 hover:bg-white rounded-lg text-stone-600 hover:text-stone-900 transition-colors cursor-pointer"
                            title="Diminuir"
                          >
                            <Minus className="w-4 h-4" />
                          </button>
                          <input
                            type="text"
                            inputMode="numeric"
                            pattern="[0-9]*"
                            readOnly={(() => {
                              const prod = products.find(p => p.id === item.productId);
                              const isFrozen = item.isFrozen || item.prepType?.startsWith('congelado') || item.addons?.some((a: any) => a.isFrozen || a.productId === 'prod_congelado');
                              const minQ = (isFrozen && prod && Number(prod.minFrozenQuantity) > 1) ? Number(prod.minFrozenQuantity) : 1;
                              return minQ > 1;
                            })()}
                            value={cartItemInputMap[itemKey] ?? item.quantity}
                            onFocus={(e) => {
                              const prod = products.find(p => p.id === item.productId);
                              const isFrozen = item.isFrozen || item.prepType?.startsWith('congelado') || item.addons?.some((a: any) => a.isFrozen || a.productId === 'prod_congelado');
                              const minQ = (isFrozen && prod && Number(prod.minFrozenQuantity) > 1) ? Number(prod.minFrozenQuantity) : 1;
                              if (minQ === 1) e.target.select();
                            }}
                            onChange={(e) => {
                              const prod = products.find(p => p.id === item.productId);
                              const isFrozen = item.isFrozen || item.prepType?.startsWith('congelado') || item.addons?.some((a: any) => a.isFrozen || a.productId === 'prod_congelado');
                              const minQ = (isFrozen && prod && Number(prod.minFrozenQuantity) > 1) ? Number(prod.minFrozenQuantity) : 1;
                              if (minQ > 1) return;
                              const raw = e.target.value.replace(/\D/g, '');
                              setCartItemInputMap(prev => ({ ...prev, [itemKey]: raw }));
                              if (raw !== '') {
                                const val = parseInt(raw, 10);
                                if (!isNaN(val) && val >= minQ) {
                                  setCart(prev => prev.map(ci => (ci.productId === item.productId && (ci.prepType || '') === (item.prepType || '') && JSON.stringify(ci.addons) === JSON.stringify(item.addons) && JSON.stringify(ci.flavor) === JSON.stringify(item.flavor)) ? { ...ci, quantity: val } : ci));
                                }
                              }
                            }}
                            onBlur={() => {
                              const prod = products.find(p => p.id === item.productId);
                              const isFrozen = item.isFrozen || item.prepType?.startsWith('congelado') || item.addons?.some((a: any) => a.isFrozen || a.productId === 'prod_congelado');
                              const minQ = (isFrozen && prod && Number(prod.minFrozenQuantity) > 1) ? Number(prod.minFrozenQuantity) : 1;
                              if (minQ > 1) return;
                              const raw = cartItemInputMap[itemKey];
                              const parsed = parseInt(String(raw ?? item.quantity), 10);
                              const safe = isNaN(parsed) || parsed < minQ ? minQ : parsed;
                              setCart(prev => prev.map(ci => (ci.productId === item.productId && (ci.prepType || '') === (item.prepType || '') && JSON.stringify(ci.addons) === JSON.stringify(item.addons) && JSON.stringify(ci.flavor) === JSON.stringify(item.flavor)) ? { ...ci, quantity: safe } : ci));
                              setCartItemInputMap(prev => {
                                const next = { ...prev };
                                delete next[itemKey];
                                return next;
                              });
                            }}
                            onKeyDown={(e) => {
                              if (e.key === 'Enter') {
                                (e.target as HTMLInputElement).blur();
                              }
                            }}
                            placeholder="1"
                            className={`font-black text-xs sm:text-sm w-12 sm:w-14 text-center py-1 rounded-lg bg-white text-stone-900 border border-stone-300 focus:ring-2 focus:ring-orange-500 focus:outline-none shadow-2xs font-mono ${(() => {
                              const prod = products.find(p => p.id === item.productId);
                              const isFrozen = item.isFrozen || item.prepType?.startsWith('congelado') || item.addons?.some((a: any) => a.isFrozen || a.productId === 'prod_congelado');
                              const minQ = (isFrozen && prod && Number(prod.minFrozenQuantity) > 1) ? Number(prod.minFrozenQuantity) : 1;
                              return minQ > 1 ? 'cursor-not-allowed bg-stone-50' : '';
                            })()}`}
                            title={(() => {
                              const prod = products.find(p => p.id === item.productId);
                              const isFrozen = item.isFrozen || item.prepType?.startsWith('congelado') || item.addons?.some((a: any) => a.isFrozen || a.productId === 'prod_congelado');
                              const minQ = (isFrozen && prod && Number(prod.minFrozenQuantity) > 1) ? Number(prod.minFrozenQuantity) : 1;
                              return minQ > 1 ? `Mínimo de ${minQ} un (controlado pelos botões + / -)` : "Digite a quantidade diretamente (pode apagar tudo)";
                            })()}
                          />
                          <button 
                            type="button"
                            onClick={() => {
                              const prod = products.find(p => p.id === item.productId);
                              const isFrozen = item.isFrozen || item.prepType?.startsWith('congelado') || item.addons?.some((a: any) => a.isFrozen || a.productId === 'prod_congelado');
                              const minQ = (isFrozen && prod && Number(prod.minFrozenQuantity) > 1) ? Number(prod.minFrozenQuantity) : 1;
                              const step = minQ > 1 ? minQ : 1;
                              updateQuantity(item.productId, item.addons, item.flavor, step, item.prepType);
                            }}
                            className="p-1 hover:bg-white rounded-lg text-stone-600 hover:text-stone-900 transition-colors cursor-pointer"
                            title="Aumentar"
                          >
                            <Plus className="w-4 h-4" />
                          </button>
                        </div>
                      </div>
                    </div>
                  </div>
                );
              })}
              {!appendOrderTarget && bestSellerEntries.length > 0 && (
                <BestSellersCarousel
                  items={bestSellerEntries}
                  isFrozenOrderActive={orderModalityPreference === 'frozen' || hasFrozenInCart}
                  canBuy={canBuy}
                  cartProductIds={cartProductIds}
                  queuedProductIds={queuedProductIds}
                  variant="compact"
                  themeColor={storeInfo.themeColor || '#ea580c'}
                  onSelectProduct={handleSelectBestSeller}
                  onFinishFrozenNow={() => {
                    const frozenNeedsLaterDate = storeInfo.deliveryScheduleEnabled && hasFrozenInCart && !isDateAllowedForFrozenOrder(selectedScheduleDate);
                    const slotInvalidForDay = storeInfo.deliveryScheduleEnabled && Boolean(selectedScheduleTime) && !isSlotAllowedForDate(storeInfo, selectedScheduleDate, selectedScheduleTime);
                    if (storeInfo.deliveryScheduleEnabled && (!selectedScheduleTime || frozenNeedsLaterDate || slotInvalidForDay)) {
                      if (frozenNeedsLaterDate) {
                        updateOrderModalityPreference('frozen');
                        clearScheduleSelection();
                      } else if (slotInvalidForDay) {
                        setSelectedScheduleTime('');
                        safeStorage.removeItem('balbec_selected_schedule_time');
                      }
                      setScheduleStepMode('pickup');
                      setShowScheduleSelectionStep(true);
                      setIsCartOpen(false);
                      return;
                    }
                    setIsCartOpen(false);
                    setIsCheckout(true);
                  }}
                />
              )}
            </>
          )}
        </div>

        {cart.length > 0 && (
          <div className="p-5 border-t border-stone-200 bg-stone-50 space-y-3 shrink-0">
            <div className="flex justify-between items-center">
              <span className="text-sm font-bold text-stone-600">Total do Pedido</span>
              <span className="text-2xl font-black text-stone-900">{formatCurrency(total)}</span>
            </div>

            {/* Primary Finish Button */}
            <button 
              onClick={() => {
                const frozenNeedsLaterDate = storeInfo.deliveryScheduleEnabled && hasFrozenInCart && !isDateAllowedForFrozenOrder(selectedScheduleDate);
                const slotInvalidForDay = storeInfo.deliveryScheduleEnabled && Boolean(selectedScheduleTime) && !isSlotAllowedForDate(storeInfo, selectedScheduleDate, selectedScheduleTime);
                if (storeInfo.deliveryScheduleEnabled && (!selectedScheduleTime || frozenNeedsLaterDate || slotInvalidForDay)) {
                  if (frozenNeedsLaterDate) {
                    updateOrderModalityPreference('frozen');
                    clearScheduleSelection();
                  } else if (slotInvalidForDay) {
                    setSelectedScheduleTime('');
                    safeStorage.removeItem('balbec_selected_schedule_time');
                  }
                  setScheduleStepMode('pickup');
                  setShowScheduleSelectionStep(true);
                  setIsCartOpen(false);
                  return;
                }
                setIsCartOpen(false);
                setIsCheckout(true);
              }}
              disabled={cart.length === 0 || !canBuy}
              className="w-full py-4 bg-emerald-600 hover:bg-emerald-700 active:bg-emerald-800 disabled:bg-stone-300 text-white rounded-2xl font-black text-base transition-all shadow-lg shadow-emerald-600/30 flex items-center justify-center gap-2 cursor-pointer"
            >
              {!storeInfo.isOpen ? 'Loja Fechada' : !canBuy ? 'Somente Visualização' : (
                <>
                  <span>Finalizar Pedido</span>
                  <ChevronRight className="w-5 h-5" />
                </>
              )}
            </button>

            {/* Secondary "Voltar às Compras" Button */}
            <button
              type="button"
              onClick={() => setIsCartOpen(false)}
              className="w-full py-3 px-4 bg-white hover:bg-stone-100 text-stone-700 rounded-xl font-bold text-sm flex items-center justify-center gap-2 transition-colors cursor-pointer border border-stone-200"
            >
              <ArrowLeft className="w-4 h-4 text-orange-600" />
              <span>Voltar às Compras e Adicionar Mais Itens</span>
            </button>
          </div>
        )}
      </div>

      {/* Addon Modal */}
      {addonModal.isOpen && addonModal.product && (() => {
        const maxAddons = addonModal.product.maxAddons || 3;
        const { availableAddons, availableFlavors } = addonModal;
        const hasFlavors = availableFlavors.length > 0;
        const hasAddons = availableAddons.length > 0;
        const basePrice = addonModal.product.price || 0;
        const addonsTotal = addonModal.selectedAddons.reduce((sum, a) => sum + (a.price || 0), 0);
        const flavorPrice = addonModal.selectedFlavor?.price || 0;
        const currentTotal = basePrice + addonsTotal + flavorPrice;
        const isFlavorMissing = hasFlavors && !addonModal.selectedFlavor;

        const handleAddWithoutAddons = () => {
          addToCart(addonModal.product, [], addonModal.selectedFlavor);
        };

        const handleCancelOrClose = () => {
          // Se tiver apenas adicionais opcionais (sem sabor obrigatório pendente), adiciona o item normalmente como solicitado pelo usuário
          if (!hasFlavors && hasAddons) {
            addToCart(addonModal.product, [], null);
          } else {
            setAddonModal({ isOpen: false, product: null, selectedAddons: [], selectedFlavor: null, availableAddons: [], availableFlavors: [] });
          }
        };

        return (
        <div className="fixed inset-0 bg-stone-950/70 backdrop-blur-xs z-50 flex items-center justify-center p-3 sm:p-4 animate-in fade-in duration-200">
          <div className="bg-white rounded-3xl p-6 sm:p-7 max-w-lg w-full shadow-2xl border border-stone-100 max-h-[90vh] flex flex-col">
            
            {/* Header */}
            <div className="flex items-start justify-between gap-3 pb-3 border-b border-stone-100">
              <div>
                <h2 className="text-xl sm:text-2xl font-black text-stone-900 leading-tight">
                  {hasFlavors && !hasAddons ? 'Escolha o Sabor' : formatCapitalized(addonModal.product.name)}
                </h2>
                {(addonModal.product.externalId || addonModal.product.description) && (
                  <p className="text-xs sm:text-sm text-red-600 font-medium italic mt-1 line-clamp-2">
                    {formatCapitalized(formatProductDescriptionWithCode(addonModal.product.description, addonModal.product.externalId))}
                  </p>
                )}
                <p className="text-xs sm:text-sm text-stone-500 font-medium mt-0.5">
                  {hasFlavors && !hasAddons 
                    ? `Para: ${formatCapitalized(addonModal.product.name)}`
                    : hasAddons 
                      ? `Deseja adicionar algum adicional? (Opcional - até ${maxAddons})`
                      : 'Opções do item'}
                </p>
              </div>

              <button
                type="button"
                onClick={handleCancelOrClose}
                className="p-1.5 hover:bg-stone-100 rounded-full text-stone-400 hover:text-stone-700 transition-colors shrink-0 cursor-pointer"
                title="Fechar e adicionar sem adicionais"
              >
                <X className="w-5 h-5" />
              </button>
            </div>

            {/* Modal Body */}
            <div className="flex-1 overflow-y-auto py-4 space-y-4 pr-1">
              
              {/* Sabores (Obrigatórios quando aplicável, ex: sucos/polpas) */}
              {hasFlavors && (
                <div>
                  <div className="flex items-center justify-between mb-2">
                    <span className="text-xs font-black uppercase tracking-wider text-orange-700">1. Sabor (Obrigatório)</span>
                    {addonModal.selectedFlavor && (
                      <span className="text-[11px] font-bold text-emerald-700 bg-emerald-50 px-2 py-0.5 rounded-md">
                        {addonModal.selectedFlavor.name}
                      </span>
                    )}
                  </div>
                  <div className="space-y-2">
                    {availableFlavors.map(flavor => {
                      const flavorCode = (flavor.externalId || (flavor as any).code || '').toString().trim();
                      return (
                      <label 
                        key={flavor.id} 
                        className={`flex items-center justify-between p-3.5 border-2 rounded-2xl cursor-pointer transition-all ${
                          addonModal.selectedFlavor?.productId === flavor.id 
                            ? 'border-orange-500 bg-orange-50/90 text-orange-950 font-bold shadow-xs' 
                            : 'border-stone-200 hover:border-stone-300 hover:bg-stone-50 text-stone-800'
                        }`}
                      >
                        <div className="flex items-center gap-3">
                          <input 
                            type="radio" 
                            name="flavor" 
                            className="w-5 h-5 text-orange-600 focus:ring-orange-500"
                            checked={addonModal.selectedFlavor?.productId === flavor.id}
                            onChange={() => setAddonModal(prev => ({ 
                              ...prev, 
                              selectedFlavor: { 
                                productId: flavor.id, 
                                name: flavor.name, 
                                price: flavor.price,
                                externalId: flavorCode,
                                code: flavorCode
                              } 
                            }))}
                          />
                          <span className="text-sm font-medium">
                            {formatCapitalized(flavor.name)}
                            {flavorCode && (
                              <span className="ml-1.5 text-[10px] font-mono font-bold bg-stone-100 text-stone-700 px-1.5 py-0.5 rounded border border-stone-200">
                                CÓD: {flavorCode}
                              </span>
                            )}
                          </span>
                        </div>
                      </label>
                    );
                    })}
                  </div>
                </div>
              )}

              {/* Adicionais / Complementos (Totalmente Opcionais) */}
              {hasAddons && (
                <div>
                  <div className="flex items-center justify-between mb-2">
                    <span className="text-xs font-black uppercase tracking-wider text-stone-700">
                      Adicionais na Chapa / Lanche (Opcional - até {maxAddons})
                    </span>
                    {addonModal.selectedAddons.length > 0 && (
                      <span className="text-[11px] font-bold text-orange-700 bg-orange-50 px-2 py-0.5 rounded-md">
                        {addonModal.selectedAddons.length} de {maxAddons}
                      </span>
                    )}
                  </div>

                  <div className="space-y-2 max-h-[35vh] overflow-y-auto pr-1">
                    {availableAddons.map(addon => {
                      const addonCode = (addon.externalId || (addon as any).code || '').toString().trim();
                      const isSelected = addonModal.selectedAddons.some(a => a.productId === addon.id);
                      const isMaxReached = addonModal.selectedAddons.length >= maxAddons;
                      const isDisabled = !isSelected && isMaxReached;
                      
                      return (
                        <label 
                          key={addon.id} 
                          className={`flex items-center justify-between p-3.5 border-2 rounded-2xl transition-all ${
                            isDisabled 
                              ? 'opacity-40 cursor-not-allowed bg-stone-50 border-stone-200' 
                              : isSelected 
                                ? 'border-orange-500 bg-orange-50/90 cursor-pointer shadow-xs font-bold' 
                                : 'border-stone-200 hover:border-stone-300 hover:bg-stone-50 cursor-pointer'
                          }`}
                        >
                          <div className="flex items-center gap-3">
                            <input 
                              type="checkbox"
                              className="w-5 h-5 rounded text-orange-600 focus:ring-orange-500 cursor-pointer disabled:cursor-not-allowed"
                              checked={isSelected}
                              disabled={isDisabled}
                              onChange={(e) => {
                                if (e.target.checked) {
                                  if (!isMaxReached) {
                                    setAddonModal(prev => ({ 
                                      ...prev, 
                                      selectedAddons: [
                                        ...prev.selectedAddons, 
                                        { 
                                          productId: addon.id, 
                                          name: addon.name, 
                                          price: addon.price,
                                          externalId: addonCode,
                                          code: addonCode
                                        }
                                      ] 
                                    }));
                                  }
                                } else {
                                  setAddonModal(prev => ({ ...prev, selectedAddons: prev.selectedAddons.filter(a => a.productId !== addon.id) }));
                                }
                              }}
                            />
                            <span className="text-sm text-stone-900">
                              {formatCapitalized(addon.name)}
                              {addonCode && (
                                <span className="ml-1.5 text-[10px] font-mono font-bold bg-stone-100 text-stone-700 px-1.5 py-0.5 rounded border border-stone-200">
                                  CÓD: {addonCode}
                                </span>
                              )}
                            </span>
                          </div>
                          <span className="text-xs sm:text-sm font-black text-orange-700">
                            {addon.price > 0 ? `+ ${formatCurrency(addon.price)}` : 'Grátis'}
                          </span>
                        </label>
                      );
                    })}
                  </div>
                </div>
              )}
            </div>

            {/* Actions Footer */}
            <div className="pt-4 border-t border-stone-100 flex flex-col sm:flex-row gap-2.5">
              
              {/* Botão para adicionar sem adicionais / lanche puro */}
              {hasAddons && !hasFlavors && (
                <button 
                  type="button"
                  onClick={handleAddWithoutAddons}
                  className="py-3.5 px-4 bg-stone-100 hover:bg-stone-200 text-stone-800 rounded-2xl font-bold text-xs sm:text-sm transition-all border border-stone-300/80 cursor-pointer flex-1 flex items-center justify-center gap-1.5 active:scale-98"
                >
                  <span>Sem Adicionais</span>
                  <span className="text-stone-500">({formatCurrency(basePrice)})</span>
                </button>
              )}

              {/* Botão Cancelar se for sabor */}
              {hasFlavors && (
                <button 
                  type="button"
                  onClick={() => setAddonModal({ isOpen: false, product: null, selectedAddons: [], selectedFlavor: null, availableAddons: [], availableFlavors: [] })} 
                  className="py-3.5 px-4 border-2 border-stone-200 hover:bg-stone-50 text-stone-700 rounded-2xl font-bold text-xs sm:text-sm transition-all cursor-pointer"
                >
                  Cancelar
                </button>
              )}

              {/* Botão Principal de Adicionar */}
              <button 
                type="button"
                onClick={() => addToCart(addonModal.product, addonModal.selectedAddons, addonModal.selectedFlavor)} 
                className={`py-3.5 px-5 text-white rounded-2xl font-extrabold text-sm sm:text-base transition-all shadow-lg flex-1 flex items-center justify-center gap-2 cursor-pointer active:scale-98 disabled:opacity-50 disabled:cursor-not-allowed ${
                  addonModal.selectedAddons.length > 0 ? 'bg-orange-600 hover:bg-orange-700 shadow-orange-600/30' : 'bg-emerald-600 hover:bg-emerald-700 shadow-emerald-600/30'
                }`}
                disabled={!canBuy || isFlavorMissing}
              >
                {!canBuy ? (
                  'Apenas Visualização'
                ) : isFlavorMissing ? (
                  'Selecione um Sabor'
                ) : addonModal.selectedAddons.length > 0 ? (
                  <>
                    <span>Adicionar ({addonModal.selectedAddons.length})</span>
                    <span className="bg-black/20 px-2 py-0.5 rounded-lg text-xs font-black">{formatCurrency(currentTotal)}</span>
                  </>
                ) : (
                  <>
                    <span>Adicionar ao Pedido</span>
                    <span className="bg-black/20 px-2 py-0.5 rounded-lg text-xs font-black">{formatCurrency(basePrice)}</span>
                  </>
                )}
              </button>
            </div>
          </div>
        </div>
      )})()}

      {/* Modal de Variações de Preparo (Exibe APENAS as variações da categoria selecionada: Prontos OU Congelados) */}
      {frozenModal.isOpen && frozenModal.product && (() => {
        const found = products.find(p => p.id === 'prod_congelado');
        const pVal = found && found.price && found.price < 2.0 ? Number(found.price) : 0.30;
        const congeladoProd = found || { id: 'prod_congelado', name: 'Salgado Congelado', price: 0.30 };

        const isFrozenMode = frozenModal.mode === 'congelado';
        const minRequired = (isFrozenMode && Number(frozenModal.product.minFrozenQuantity) > 1) 
          ? Number(frozenModal.product.minFrozenQuantity) 
          : 1;
        const totalProntoSelected = prontoFritoQty + prontoCruQty;
        const totalCongeladoSelected = congeladoCruQty + congeladoFritoQty;
        const grandTotalSelected = isFrozenMode ? totalCongeladoSelected : totalProntoSelected;

        return (
          <div className="fixed inset-0 z-[120] bg-stone-900/80 backdrop-blur-sm flex items-center justify-center p-3 sm:p-4 overflow-y-auto animate-in fade-in duration-200">
            <div className="bg-white rounded-3xl max-w-lg w-full p-5 sm:p-7 shadow-2xl border border-stone-200 space-y-5 my-auto max-h-[94vh] overflow-y-auto">
              {/* Header do Modal */}
              <div className="text-center space-y-1.5">
                <div className={`w-14 h-14 rounded-2xl mx-auto flex items-center justify-center text-2xl shadow-inner border ${
                  isFrozenMode
                    ? 'bg-gradient-to-br from-blue-100 to-cyan-100 text-blue-600 border-blue-200'
                    : 'bg-gradient-to-br from-orange-100 to-amber-100 text-orange-600 border-orange-200'
                }`}>
                  {isFrozenMode ? '❄️' : '🥟'}
                </div>
                <h3 className="text-lg sm:text-xl font-black text-stone-900 uppercase tracking-tight">
                  {frozenModal.product.name}
                </h3>
                {isFrozenMode && minRequired > 1 && (
                  <div className="inline-block bg-blue-100 text-blue-900 border border-blue-300 px-3 py-1 rounded-xl text-xs font-black shadow-xs">
                    ❄️ Quantidade Mínima: {minRequired} unidades
                  </div>
                )}
                <p className="text-xs text-stone-500 leading-relaxed max-w-sm mx-auto">
                  Defina abaixo a quantidade desejada para cada opção de preparo:
                </p>
              </div>

              {!isFrozenMode ? (
                /* MODALIDADE: SALGADOS PRONTOS (NORMAIS) */
                <div className="rounded-2xl border-2 border-amber-300 bg-amber-50/40 shadow-xs p-4">
                  <div className="flex items-center justify-between mb-3 pb-2 border-b border-amber-200/60">
                    <div className="flex items-center gap-2">
                      <span className="text-lg">🔥</span>
                      <div>
                        <h4 className="text-xs sm:text-sm font-black text-amber-950 uppercase tracking-tight">
                          Salgados Prontos (Normais)
                        </h4>
                        <p className="text-[10px] text-amber-800 font-medium">
                          Preparo rápido para consumo imediato
                        </p>
                      </div>
                    </div>
                    <span className="text-[10px] bg-amber-100 text-amber-900 px-2.5 py-0.5 rounded-full font-black uppercase">
                      {formatCurrency(frozenModal.product.price)} un
                    </span>
                  </div>

                  <div className="space-y-3 pt-1">
                    {/* Opção 1: Salgado Pronto FRITO/ASSADO */}
                    <div className="flex items-center justify-between gap-3 p-2.5 bg-white rounded-xl border border-amber-200 shadow-2xs">
                      <div className="min-w-0">
                        <p className="text-xs font-black text-stone-900 uppercase">
                          Salgado Pronto FRITO/ASSADO
                        </p>
                        <p className="text-[11px] text-amber-800 font-bold">
                          {formatCurrency(frozenModal.product.price)}
                        </p>
                      </div>
                      <div className="flex items-center gap-1.5 bg-amber-50 rounded-xl p-1 border border-amber-200">
                        <button
                          type="button"
                          onClick={() => setProntoFritoQty(Math.max(0, prontoFritoQty - 1))}
                          className="w-8 h-8 rounded-lg bg-white hover:bg-amber-100 text-amber-900 font-black flex items-center justify-center cursor-pointer border border-amber-300"
                        >
                          <Minus className="w-3.5 h-3.5" />
                        </button>
                        <input
                          type="text"
                          inputMode="numeric"
                          value={prontoFritoQty}
                          onFocus={(e) => e.target.select()}
                          onChange={(e) => {
                            const val = parseInt(e.target.value.replace(/\D/g, ''), 10);
                            setProntoFritoQty(isNaN(val) ? 0 : val);
                          }}
                          className="w-12 text-center font-black text-sm text-stone-900 bg-transparent outline-none font-mono"
                        />
                        <button
                          type="button"
                          onClick={() => setProntoFritoQty(prontoFritoQty + 1)}
                          className="w-8 h-8 rounded-lg bg-amber-600 hover:bg-amber-700 text-white font-black flex items-center justify-center cursor-pointer shadow-xs"
                        >
                          <Plus className="w-3.5 h-3.5" />
                        </button>
                      </div>
                    </div>

                    {/* Opção 2: Salgado Pronto CRU/PRÉ-ASSADO */}
                    <div className="flex items-center justify-between gap-3 p-2.5 bg-white rounded-xl border border-amber-200 shadow-2xs">
                      <div className="min-w-0">
                        <p className="text-xs font-black text-stone-900 uppercase">
                          Salgado Pronto CRU/PRÉ-ASSADO
                        </p>
                        <p className="text-[11px] text-amber-800 font-bold">
                          {formatCurrency(frozenModal.product.price)}
                        </p>
                      </div>
                      <div className="flex items-center gap-1.5 bg-amber-50 rounded-xl p-1 border border-amber-200">
                        <button
                          type="button"
                          onClick={() => setProntoCruQty(Math.max(0, prontoCruQty - 1))}
                          className="w-8 h-8 rounded-lg bg-white hover:bg-amber-100 text-amber-900 font-black flex items-center justify-center cursor-pointer border border-amber-300"
                        >
                          <Minus className="w-3.5 h-3.5" />
                        </button>
                        <input
                          type="text"
                          inputMode="numeric"
                          value={prontoCruQty}
                          onFocus={(e) => e.target.select()}
                          onChange={(e) => {
                            const val = parseInt(e.target.value.replace(/\D/g, ''), 10);
                            setProntoCruQty(isNaN(val) ? 0 : val);
                          }}
                          className="w-12 text-center font-black text-sm text-stone-900 bg-transparent outline-none font-mono"
                        />
                        <button
                          type="button"
                          onClick={() => setProntoCruQty(prontoCruQty + 1)}
                          className="w-8 h-8 rounded-lg bg-amber-600 hover:bg-amber-700 text-white font-black flex items-center justify-center cursor-pointer shadow-xs"
                        >
                          <Plus className="w-3.5 h-3.5" />
                        </button>
                      </div>
                    </div>
                  </div>
                </div>
              ) : (
                /* MODALIDADE: SALGADOS CONGELADOS */
                <div className="rounded-2xl border-2 border-blue-300 bg-blue-50/40 shadow-xs p-4 space-y-3">
                  <div className="flex items-center justify-between pb-2 border-b border-blue-200/60">
                    <div className="flex items-center gap-2">
                      <span className="text-lg">❄️</span>
                      <div>
                        <h4 className="text-xs sm:text-sm font-black text-blue-950 uppercase tracking-tight">
                          Salgados Congelados
                        </h4>
                        <p className="text-[10px] text-blue-700 font-bold">
                          ⏱️ Prazo de preparo de até 48 horas (pode ficar pronto antes)
                        </p>
                      </div>
                    </div>
                    <span className="text-[10px] bg-blue-100 text-blue-900 px-2.5 py-0.5 rounded-full font-black uppercase">
                      {formatCurrency(frozenModal.product.price + pVal)} un
                    </span>
                  </div>

                  <div className="space-y-3 pt-1">
                    {/* Opção 1: Salgado Congelado CRU/PRÉ-ASSADO */}
                    <div className="flex items-center justify-between gap-3 p-2.5 bg-white rounded-xl border border-blue-200 shadow-2xs">
                      <div className="min-w-0">
                        <p className="text-xs font-black text-stone-900 uppercase">
                          Salgado Congelado CRU/PRÉ-ASSADO
                        </p>
                        <p className="text-[11px] text-blue-800 font-bold">
                          {formatCurrency(frozenModal.product.price + pVal)} <span className="text-[10px] opacity-80 font-normal">(+{formatCurrency(pVal)})</span>
                        </p>
                      </div>
                      <div className="flex items-center gap-1.5 bg-blue-50 rounded-xl p-1 border border-blue-200">
                        <button
                          type="button"
                          onClick={() => {
                            const step = minRequired > 1 ? minRequired : 1;
                            const next = congeladoCruQty - step;
                            setCongeladoCruQty(next < 0 ? 0 : (next < minRequired && next > 0 ? 0 : next));
                          }}
                          className="w-8 h-8 rounded-lg bg-white hover:bg-blue-100 text-blue-900 font-black flex items-center justify-center cursor-pointer border border-blue-300"
                        >
                          <Minus className="w-3.5 h-3.5" />
                        </button>
                        <input
                          type="text"
                          inputMode="numeric"
                          readOnly={minRequired > 1}
                          value={congeladoCruQty}
                          onFocus={(e) => { if (minRequired === 1) e.target.select(); }}
                          onChange={(e) => {
                            if (minRequired > 1) return;
                            const val = parseInt(e.target.value.replace(/\D/g, ''), 10);
                            setCongeladoCruQty(isNaN(val) ? 0 : val);
                          }}
                          className={`w-12 text-center font-black text-sm text-stone-900 bg-transparent outline-none font-mono ${minRequired > 1 ? 'cursor-not-allowed' : ''}`}
                          title={minRequired > 1 ? `Mínimo de ${minRequired} un (controlado por botões)` : "Digite a quantidade"}
                        />
                        <button
                          type="button"
                          onClick={() => {
                            const step = minRequired > 1 ? minRequired : 1;
                            setCongeladoCruQty(congeladoCruQty === 0 ? minRequired : congeladoCruQty + step);
                          }}
                          className="w-8 h-8 rounded-lg bg-blue-600 hover:bg-blue-700 text-white font-black flex items-center justify-center cursor-pointer shadow-xs"
                        >
                          <Plus className="w-3.5 h-3.5" />
                        </button>
                      </div>
                    </div>

                    {/* Opção 2: Salgado Congelado FRITO/ASSADO */}
                    <div className="flex items-center justify-between gap-3 p-2.5 bg-white rounded-xl border border-blue-200 shadow-2xs">
                      <div className="min-w-0">
                        <p className="text-xs font-black text-stone-900 uppercase">
                          Salgado Congelado FRITO/ASSADO
                        </p>
                        <p className="text-[11px] text-blue-800 font-bold">
                          {formatCurrency(frozenModal.product.price + pVal)} <span className="text-[10px] opacity-80 font-normal">(+{formatCurrency(pVal)})</span>
                        </p>
                      </div>
                      <div className="flex items-center gap-1.5 bg-blue-50 rounded-xl p-1 border border-blue-200">
                        <button
                          type="button"
                          onClick={() => {
                            const step = minRequired > 1 ? minRequired : 1;
                            const next = congeladoFritoQty - step;
                            setCongeladoFritoQty(next < 0 ? 0 : (next < minRequired && next > 0 ? 0 : next));
                          }}
                          className="w-8 h-8 rounded-lg bg-white hover:bg-blue-100 text-blue-900 font-black flex items-center justify-center cursor-pointer border border-blue-300"
                        >
                          <Minus className="w-3.5 h-3.5" />
                        </button>
                        <input
                          type="text"
                          inputMode="numeric"
                          readOnly={minRequired > 1}
                          value={congeladoFritoQty}
                          onFocus={(e) => { if (minRequired === 1) e.target.select(); }}
                          onChange={(e) => {
                            if (minRequired > 1) return;
                            const val = parseInt(e.target.value.replace(/\D/g, ''), 10);
                            setCongeladoFritoQty(isNaN(val) ? 0 : val);
                          }}
                          className={`w-12 text-center font-black text-sm text-stone-900 bg-transparent outline-none font-mono ${minRequired > 1 ? 'cursor-not-allowed' : ''}`}
                          title={minRequired > 1 ? `Mínimo de ${minRequired} un (controlado por botões)` : "Digite a quantidade"}
                        />
                        <button
                          type="button"
                          onClick={() => {
                            const step = minRequired > 1 ? minRequired : 1;
                            setCongeladoFritoQty(congeladoFritoQty === 0 ? minRequired : congeladoFritoQty + step);
                          }}
                          className="w-8 h-8 rounded-lg bg-blue-600 hover:bg-blue-700 text-white font-black flex items-center justify-center cursor-pointer shadow-xs"
                        >
                          <Plus className="w-3.5 h-3.5" />
                        </button>
                      </div>
                    </div>
                  </div>

                  <p className="text-xs font-extrabold text-red-600 bg-red-50/90 border border-red-200 rounded-xl p-2.5 text-center leading-relaxed">
                    Obs: Pedidos congelados com entrega em até 48 horas podem ser antecipados e você será avisado pelo aplicativo.
                  </p>
                </div>
              )}

              {/* Botões de Ação do Modal */}
              <div className="space-y-2 pt-1">
                <button
                  type="button"
                  onClick={() => {
                    if (grandTotalSelected === 0) {
                      alert('Por favor, defina a quantidade para pelo menos uma das opções acima.');
                      return;
                    }
                    if (isFrozenMode && grandTotalSelected < minRequired) {
                      alert(`A quantidade mínima para este salgado congelado é de ${minRequired} unidades.`);
                      return;
                    }

                    const isItemFrozenHelper = (ci: any) => Boolean(
                      ci.isFrozen || ci.addons?.some((a: any) => a.isFrozen || a.productId === 'prod_congelado' || (a.name && a.name.toLowerCase().includes('congelad')))
                    );

                    // Limpa versões anteriores deste produto na modalidade atual para aplicar a nova seleção
                    if (appendOrderTarget) {
                      setAppendCart(prev => prev.filter(ci => !(ci.productId === frozenModal.product.id && isItemFrozenHelper(ci) === isFrozenMode)));
                    } else {
                      setCart(prev => prev.filter(ci => !(ci.productId === frozenModal.product.id && isItemFrozenHelper(ci) === isFrozenMode)));
                    }

                    if (!isFrozenMode) {
                      // 1. Salgado Pronto FRITO/ASSADO
                      if (prontoFritoQty > 0) {
                        addToCart(frozenModal.product, [], null, prontoFritoQty, 'pronto_frito', 'Salgado Pronto FRITO/ASSADO', true);
                      }

                      // 2. Salgado Pronto CRU/PRÉ-ASSADO
                      if (prontoCruQty > 0) {
                        addToCart(frozenModal.product, [], null, prontoCruQty, 'pronto_cru', 'Salgado Pronto CRU/PRÉ-ASSADO', true);
                      }
                    } else {
                      // 3. Salgado Congelado CRU/PRÉ-ASSADO
                      if (congeladoCruQty > 0) {
                        const frozenAddon = {
                          productId: congeladoProd.id,
                          name: 'Salgado Congelado CRU/PRÉ-ASSADO',
                          price: pVal,
                          externalId: (congeladoProd as any).externalId || '9999',
                          isFrozen: true
                        };
                        addToCart(frozenModal.product, [frozenAddon], null, congeladoCruQty, 'congelado_cru', 'Salgado Congelado CRU/PRÉ-ASSADO', true);
                      }

                      // 4. Salgado Congelado FRITO/ASSADO
                      if (congeladoFritoQty > 0) {
                        const frozenAddon = {
                          productId: congeladoProd.id,
                          name: 'Salgado Congelado FRITO/ASSADO',
                          price: pVal,
                          externalId: (congeladoProd as any).externalId || '9999',
                          isFrozen: true
                        };
                        addToCart(frozenModal.product, [frozenAddon], null, congeladoFritoQty, 'congelado_frito', 'Salgado Congelado FRITO/ASSADO', true);
                      }
                    }

                    setFrozenModal({ isOpen: false, product: null, quantity: 1, mode: 'pronto' });
                  }}
                  disabled={grandTotalSelected === 0}
                  className="w-full py-4 bg-orange-600 hover:bg-orange-700 active:scale-98 disabled:opacity-50 disabled:cursor-not-allowed text-white rounded-2xl font-black text-xs uppercase tracking-wider shadow-lg shadow-orange-600/30 transition-all cursor-pointer flex items-center justify-center gap-2"
                >
                  <span>Confirmar e Adicionar ({grandTotalSelected} un) 🛒</span>
                </button>

                <button
                  type="button"
                  onClick={() => setFrozenModal({ isOpen: false, product: null, quantity: 1, mode: 'pronto' })}
                  className="w-full py-2.5 text-stone-400 hover:text-stone-600 text-xs font-bold uppercase tracking-wider cursor-pointer"
                >
                  Cancelar
                </button>
              </div>
            </div>
          </div>
        );
      })()}

      {/* Modal de Conflito de Carrinho / Restrição Congelados */}
      {cartConflictModal.isOpen && (() => {
        const isFrozenBlockedNormal = cartConflictModal.type === 'frozen_mode_blocked_normal' || cartConflictModal.type === 'has_frozen_blocked_normal';
        const isOnlyModeLock = cartConflictModal.type === 'frozen_mode_blocked_normal';

        return (
        <div className="fixed inset-0 z-[130] bg-stone-900/80 backdrop-blur-sm flex items-center justify-center p-4 animate-in fade-in duration-200">
          <div className="bg-white rounded-3xl max-w-md w-full p-6 sm:p-7 shadow-2xl border border-stone-200 text-center space-y-4 animate-in zoom-in-95 duration-200">
            <div className={`w-16 h-16 rounded-2xl mx-auto flex items-center justify-center text-3xl shadow-inner border ${
              isFrozenBlockedNormal
                ? 'bg-blue-100 text-blue-600 border-blue-200'
                : 'bg-amber-100 text-amber-600 border-amber-200'
            }`}>
              {isFrozenBlockedNormal ? '❄️' : '🔥'}
            </div>
            
            <div className="space-y-1.5">
              <h3 className="text-lg font-black text-stone-900 uppercase tracking-tight">
                {isOnlyModeLock
                  ? 'Pedido Exclusivo de Congelados'
                  : isFrozenBlockedNormal
                    ? 'Nesse Pedido, Só Poderá Ter Itens Congelados'
                    : 'Carrinho com Produtos Prontos (Normais)'}
              </h3>
              <p className="text-xs sm:text-sm text-stone-700 leading-relaxed font-semibold">
                {isFrozenBlockedNormal
                  ? 'Você escolheu a modalidade de congelados (prazo de 48h, disponível a partir de +2 dias). Nesse pedido, só poderá ter itens congelados.'
                  : 'Devido a prazos de entrega diferentes, não é possível misturar itens normais (prontos) e congelados no mesmo pedido.'}
              </p>
              <p className="text-xs sm:text-sm text-blue-700 font-extrabold pt-1">
                Caso o pedido de congelados fique pronto antes das 48 horas, você será avisado pelas notificações.
              </p>
            </div>

            <div className={`border rounded-2xl p-3.5 text-xs text-left font-medium ${
              isFrozenBlockedNormal
                ? 'bg-blue-50 border-blue-200 text-blue-900'
                : 'bg-amber-50 border-amber-200 text-amber-900'
            }`}>
              {isFrozenBlockedNormal ? (
                <>
                  💡 <strong>Deseja mudar para outros produtos?</strong><br/>
                  Ao escolher <strong>Mudar para Outros Produtos</strong>, {hasFrozenInCart ? 'o carrinho de congelados será limpo e ' : ''}a janela de agendamento será aberta novamente sem a limitação dos 2 dias.
                </>
              ) : (
                <>
                  💡 <strong>Deseja finalizar o pedido atual ou iniciar um novo pedido?</strong><br/>
                  Você pode finalizar os itens prontos primeiro ou limpar o carrinho para iniciar um pedido de congelados (+2 dias).
                </>
              )}
            </div>

            <div className="space-y-2 pt-2">
              {hasFrozenInCart && isFrozenBlockedNormal && (
                <button
                  type="button"
                  onClick={() => {
                    const t = cartConflictModal.type;
                    setCartConflictModal({ isOpen: false, type: t });
                    setIsCartOpen(true);
                  }}
                  className="w-full py-3.5 text-white rounded-xl font-black text-xs uppercase tracking-wider transition-all cursor-pointer shadow-md bg-blue-600 hover:bg-blue-700"
                >
                  Ver Meu Carrinho de Congelados 🛒
                </button>
              )}

              {!isFrozenBlockedNormal && (
                <button
                  type="button"
                  onClick={() => {
                    const t = cartConflictModal.type;
                    setCartConflictModal({ isOpen: false, type: t });
                    setIsCartOpen(true);
                  }}
                  className="w-full py-3.5 text-white rounded-xl font-black text-xs uppercase tracking-wider transition-all cursor-pointer shadow-md bg-amber-600 hover:bg-amber-700"
                >
                  Ver Meu Carrinho e Finalizar 🛒
                </button>
              )}

              {isFrozenBlockedNormal ? (
                <button
                  type="button"
                  onClick={switchFromFrozenToNormalAndReschedule}
                  className="w-full py-3.5 bg-orange-600 hover:bg-orange-700 text-white rounded-xl font-black text-xs uppercase tracking-wider transition-all cursor-pointer shadow-md"
                >
                  Mudar para Outros Produtos (Reagendar sem 2 dias)
                </button>
              ) : (
                <button
                  type="button"
                  onClick={() => {
                    const targetProd = cartConflictModal.product;
                    const targetQty = cartConflictModal.qty || 1;
                    const targetIsFrozen = Boolean(cartConflictModal.isFrozenContext);
                    const targetPrepType = cartConflictModal.prepType as PrepChoiceType | undefined;
                    const t = cartConflictModal.type;
                    setCart([]);
                    safeStorage.removeItem('balbec_active_cart');
                    setProntoFritoQty(0);
                    setProntoCruQty(0);
                    setCongeladoCruQty(0);
                    setCongeladoFritoQty(0);
                    setFrozenPrepChoices({});
                    setFrozenPrepErrors({});
                    updateOrderModalityPreference(targetIsFrozen ? 'frozen' : 'normal');
                    setCartConflictModal({ isOpen: false, type: t });
                    if (targetIsFrozen && storeInfo.deliveryScheduleEnabled && !isDateAllowedForFrozenOrder(selectedScheduleDate)) {
                      clearScheduleSelection();
                      setScheduleStepMode('pickup');
                      setShowScheduleSelectionStep(true);
                    }
                    if (targetProd) {
                      setTimeout(() => {
                        initiateAddToCartWithQty(targetProd, targetQty, targetIsFrozen, true, targetPrepType);
                      }, 100);
                    }
                  }}
                  className="w-full py-3 bg-stone-100 hover:bg-stone-200 text-stone-700 rounded-xl font-bold text-xs uppercase tracking-wider transition-all cursor-pointer border border-stone-200"
                >
                  Limpar Carrinho e Pedir Congelados
                </button>
              )}

              <button
                type="button"
                onClick={() => {
                  const t = cartConflictModal.type;
                  setCartConflictModal({ isOpen: false, type: t });
                  if (isFrozenBlockedNormal) {
                    const firstFrozenCat = availableCategories.find(c => isCategoryFrozenModality(c));
                    if (firstFrozenCat) {
                      scrollToCategory(firstFrozenCat.id);
                    }
                  }
                }}
                className="w-full py-2.5 text-stone-600 hover:text-stone-900 text-xs font-bold uppercase tracking-wider cursor-pointer"
              >
                {isFrozenBlockedNormal ? 'Continuar nos Congelados' : 'Cancelar'}
              </button>
            </div>
          </div>
        </div>
        );
      })()}

      {/* Modal de Sugestão para Compra Separada quando o Cliente está em Pedido de Congelados */}
      {impulseFrozenModal.isOpen && impulseFrozenModal.entry && (() => {
        const suggestedProduct = impulseFrozenModal.entry.product;
        const alreadyQueued = queuedProductIds.has(suggestedProduct.id);

        return (
          <div className="fixed inset-0 z-[135] bg-stone-900/80 backdrop-blur-sm flex items-center justify-center p-4 animate-in fade-in duration-200">
            <div className="bg-white rounded-3xl max-w-md w-full p-6 sm:p-7 shadow-2xl border border-stone-200 text-center space-y-4 animate-in zoom-in-95 duration-200">
              <div className="flex items-center gap-3.5 p-3 rounded-2xl bg-stone-50 border border-stone-200 text-left">
                <div className="w-16 h-16 rounded-xl overflow-hidden bg-white border border-stone-200 shrink-0">
                  <ProductImage
                    src={suggestedProduct.imageUrl}
                    alt={suggestedProduct.name}
                    className="w-full h-full object-cover"
                  />
                </div>
                <div className="min-w-0 flex-1">
                  <p className="text-[11px] font-black uppercase tracking-wider text-orange-700">
                    Sugestão dos Mais Vendidos
                  </p>
                  <h3 className="text-base font-black text-stone-900 leading-snug line-clamp-2">
                    {formatCapitalized(suggestedProduct.name)}
                  </h3>
                  <p className="text-sm font-black text-orange-700 tabular-nums mt-0.5">
                    {formatCurrency(suggestedProduct.price)}
                  </p>
                </div>
              </div>

              <div className="space-y-1.5">
                <h4 className="text-lg font-black text-stone-900 tracking-tight">
                  {hasFrozenInCart
                    ? 'Finalize os Congelados e Faça Outro Pedido'
                    : 'Pedido Atual Configurado para Congelados'}
                </h4>
                <p className="text-xs sm:text-sm text-stone-600 leading-relaxed font-medium">
                  {hasFrozenInCart
                    ? 'Pedidos de congelados têm prazo de até 48h (+2 dias) e são fechados em separado. Sugerimos finalizar seu pedido de congelados primeiro e fazer um novo pedido com este item.'
                    : 'Você iniciou este pedido na modalidade de congelados (48h). Se preferir pedir este item agora, você pode mudar para Outros Produtos e reagendar sem espera de 2 dias.'}
                </p>
              </div>

              <div className="space-y-2.5 pt-1">
                {hasFrozenInCart ? (
                  <>
                    <button
                      type="button"
                      onClick={() => {
                        updateQueuedImpulseProducts(prev =>
                          prev.some(p => p.id === suggestedProduct.id) ? prev : [...prev, suggestedProduct]
                        );
                        setImpulseFrozenModal({ isOpen: false, entry: null });
                        setIsCartOpen(false);
                        const frozenNeedsLaterDate = storeInfo.deliveryScheduleEnabled && !isDateAllowedForFrozenOrder(selectedScheduleDate);
                        const slotInvalidForDay = storeInfo.deliveryScheduleEnabled && Boolean(selectedScheduleTime) && !isSlotAllowedForDate(storeInfo, selectedScheduleDate, selectedScheduleTime);
                        if (storeInfo.deliveryScheduleEnabled && (!selectedScheduleTime || frozenNeedsLaterDate || slotInvalidForDay)) {
                          if (frozenNeedsLaterDate) {
                            updateOrderModalityPreference('frozen');
                            clearScheduleSelection();
                          } else if (slotInvalidForDay) {
                            setSelectedScheduleTime('');
                            safeStorage.removeItem('balbec_selected_schedule_time');
                          }
                          setScheduleStepMode('pickup');
                          setShowScheduleSelectionStep(true);
                        } else {
                          setIsCheckout(true);
                        }
                      }}
                      className="w-full py-3.5 px-4 bg-blue-600 hover:bg-blue-700 text-white rounded-xl font-black text-xs sm:text-sm transition-all cursor-pointer shadow-md flex items-center justify-center gap-2"
                    >
                      <ShoppingBag className="w-4 h-4" />
                      <span>Reservar Item e Finalizar Congelados</span>
                      <ArrowRight className="w-4 h-4" />
                    </button>

                    <button
                      type="button"
                      onClick={() => {
                        if (!alreadyQueued) {
                          updateQueuedImpulseProducts(prev => [...prev, suggestedProduct]);
                        }
                        setImpulseFrozenModal({ isOpen: false, entry: null });
                        setCartToastMessage(`"${formatCapitalized(suggestedProduct.name)}" reservado para o seu 2º pedido!`);
                      }}
                      className="w-full py-3 px-4 bg-orange-50 hover:bg-orange-100 text-orange-900 border border-orange-200 rounded-xl font-black text-xs transition-all cursor-pointer"
                    >
                      {alreadyQueued
                        ? 'Já está Reservado — Continuar nos Congelados'
                        : 'Reservar para o Próximo Pedido e Continuar'}
                    </button>
                  </>
                ) : (
                  <button
                    type="button"
                    onClick={() => switchFromFrozenToNormalAndAddImpulse(suggestedProduct)}
                    className="w-full py-3.5 px-4 bg-orange-600 hover:bg-orange-700 text-white rounded-xl font-black text-xs sm:text-sm transition-all cursor-pointer shadow-md"
                  >
                    Mudar para Outros Produtos e Adicionar Agora
                  </button>
                )}

                <button
                  type="button"
                  onClick={() => setImpulseFrozenModal({ isOpen: false, entry: null })}
                  className="w-full py-2.5 text-stone-600 hover:text-stone-900 text-xs font-bold uppercase tracking-wider cursor-pointer"
                >
                  Continuar nos Congelados
                </button>
              </div>
            </div>
          </div>
        );
      })()}
      {/* Modal de Bloqueio por Incompatibilidade de Modalidade no Modo Acréscimo */}
      {modalidadeConflictModal.isOpen && appendOrderTarget && (
        <div className="fixed inset-0 z-[140] bg-stone-900/80 backdrop-blur-sm flex items-center justify-center p-4 animate-in fade-in duration-200">
          <div className="bg-white rounded-3xl max-w-md w-full p-6 sm:p-7 shadow-2xl border border-stone-200 text-center space-y-4 animate-in zoom-in-95 duration-200">
            <div className={`w-16 h-16 rounded-2xl mx-auto flex items-center justify-center text-3xl shadow-inner border ${
              modalidadeConflictModal.targetOrderIsFrozen 
                ? 'bg-blue-100 text-blue-600 border-blue-200' 
                : 'bg-amber-100 text-amber-600 border-amber-200'
            }`}>
              {modalidadeConflictModal.targetOrderIsFrozen ? '❄️' : '🔥'}
            </div>

            <div className="space-y-1.5">
              <span className="text-[10px] font-black uppercase tracking-wider text-orange-600 bg-orange-100 px-2.5 py-0.5 rounded-full">
                Pedido #{String(appendOrderTarget.id).slice(-4).padStart(4, '0')}
              </span>
              <h3 className="text-lg font-black text-stone-900 uppercase tracking-tight">
                Modalidade Incompatível com este Pedido
              </h3>
              <p className="text-xs text-stone-600 leading-relaxed">
                {modalidadeConflictModal.targetOrderIsFrozen ? (
                  <>
                    O seu Pedido <strong>#{String(appendOrderTarget.id).slice(-4).padStart(4, '0')}</strong> é exclusivo de <strong>Salgados Congelados</strong> (prazo de produção de até 48 horas).<br />
                    Não é possível acrescentar itens prontos / normais neste mesmo pedido.
                  </>
                ) : (
                  <>
                    O seu Pedido <strong>#{String(appendOrderTarget.id).slice(-4).padStart(4, '0')}</strong> é exclusivo de <strong>Salgados Prontos</strong> para consumo imediato.<br />
                    Não é possível acrescentar itens congelados (prazo até 48h) neste mesmo pedido.
                  </>
                )}
              </p>
            </div>

            {/* Mensagem solicitada pelo usuário */}
            <div className="bg-amber-50 border border-amber-200 rounded-2xl p-3.5 text-xs text-amber-900 text-left font-medium space-y-1">
              <p className="font-bold">⚠️ Não é possível misturar categorias neste pedido:</p>
              <p className="text-[11px] leading-relaxed text-amber-800">
                Caso você queira comprar itens dessa outra modalidade, por favor <strong>inicie um novo pedido separado</strong> para que os prazos e preparos sejam organizados corretamente.
              </p>
            </div>

            <div className="space-y-2 pt-2">
              <button
                type="button"
                onClick={() => setModalidadeConflictModal({ isOpen: false, targetOrderIsFrozen: false, attemptedIsFrozen: false })}
                className="w-full py-3.5 bg-orange-600 hover:bg-orange-700 text-white rounded-xl font-black text-xs uppercase tracking-wider transition-all cursor-pointer shadow-md"
              >
                Continuar Acréscimo no Pedido #{String(appendOrderTarget.id).slice(-4).padStart(4, '0')}
              </button>

              <button
                type="button"
                onClick={() => {
                  setModalidadeConflictModal({ isOpen: false, targetOrderIsFrozen: false, attemptedIsFrozen: false });
                  setAppendOrderTarget(null);
                  setAppendCart([]);
                  alert('Modo acréscimo cancelado. Você já pode iniciar um novo pedido normalmente!');
                }}
                className="w-full py-3 bg-stone-100 hover:bg-stone-200 text-stone-700 rounded-xl font-bold text-xs uppercase tracking-wider transition-all cursor-pointer border border-stone-200"
              >
                Sair do Acréscimo e Iniciar Novo Pedido
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Modal de Revisão e Confirmação de Acréscimo no Pedido */}
      {isAppendReviewModalOpen && appendOrderTarget && (
        <div className="fixed inset-0 z-[135] bg-stone-900/80 backdrop-blur-sm flex items-center justify-center p-3 sm:p-4 overflow-y-auto animate-in fade-in duration-200">
          <div className="bg-white rounded-3xl max-w-lg w-full p-5 sm:p-7 shadow-2xl border border-stone-200 space-y-5 my-auto max-h-[94vh] flex flex-col overflow-hidden animate-in zoom-in-95 duration-200">
            {/* Header */}
            <div className="flex items-center justify-between pb-3 border-b border-stone-100 shrink-0">
              <div className="flex items-center gap-2.5">
                <div className="w-10 h-10 rounded-2xl bg-orange-500 text-white flex items-center justify-center font-bold shadow-md shadow-orange-500/20">
                  <Plus className="w-5 h-5" />
                </div>
                <div>
                  <h3 className="text-base sm:text-lg font-black text-stone-900 uppercase tracking-tight">
                    Acréscimo no Pedido #{String(appendOrderTarget.id).slice(-4).padStart(4, '0')}
                  </h3>
                  <p className="text-[11px] text-stone-500 font-medium">
                    Pagamento Presencial na Retirada
                  </p>
                </div>
              </div>
              <button
                type="button"
                onClick={() => setIsAppendReviewModalOpen(false)}
                className="p-2 text-stone-400 hover:text-stone-700 rounded-full hover:bg-stone-100 cursor-pointer"
              >
                <X className="w-5 h-5" />
              </button>
            </div>

            {/* Conteúdo Rolável */}
            <div className="space-y-4 overflow-y-auto flex-1 pr-1 overscroll-contain">
              {/* Aviso da Modalidade */}
              <div className={`p-3 rounded-2xl border text-xs flex items-center gap-2.5 ${
                targetOrderIsFrozen 
                  ? 'bg-blue-50 border-blue-200 text-blue-900' 
                  : 'bg-amber-50 border-amber-200 text-amber-900'
              }`}>
                <span className="text-lg">{targetOrderIsFrozen ? '❄️' : '🥐'}</span>
                <div>
                  <strong className="block uppercase text-[11px]">
                    Modalidade: {targetOrderIsFrozen ? 'Salgados Congelados (até 48h)' : 'Salgados Prontos (Consumo Imediato)'}
                  </strong>
                  <span className="text-[10px] opacity-80">
                    Apenas itens desta mesma modalidade foram permitidos neste acréscimo.
                  </span>
                </div>
              </div>

              {/* Itens Novos do Acréscimo */}
              <div className="space-y-2">
                <div className="flex items-center justify-between">
                  <h4 className="text-xs font-black uppercase text-orange-600 tracking-wider">
                    ➕ Novos Itens a Acrescentar ({appendCart.reduce((s, it) => s + it.quantity, 0)} un)
                  </h4>
                  <span className="text-xs font-black text-stone-900 font-mono">
                    +{formatCurrency(appendCartSubtotal)}
                  </span>
                </div>

                {appendCart.length === 0 ? (
                  <p className="text-xs text-stone-400 italic py-3 text-center border border-dashed rounded-xl">
                    Nenhum novo item adicionado ainda. Escolha produtos no cardápio!
                  </p>
                ) : (
                  <div className="space-y-2">
                    {appendCart.map((item, idx) => (
                      <div key={`${item.productId}-${item.prepType}-${idx}`} className="p-3 bg-orange-50/60 rounded-xl border border-orange-200 flex items-center justify-between gap-3">
                        <div className="min-w-0 flex-1">
                          <p className="text-xs font-black text-stone-900 uppercase truncate">
                            {item.name}
                          </p>
                          {item.prepLabel && (
                            <p className="text-[10px] text-orange-700 font-semibold truncate">
                              {item.prepLabel}
                            </p>
                          )}
                          <p className="text-[11px] text-stone-500 font-mono">
                            {formatCurrency(item.price)} un
                          </p>
                        </div>

                        <div className="flex items-center gap-1.5 shrink-0">
                          <button
                            type="button"
                            onClick={() => {
                              setAppendCart(prev => prev.map((it, i) => i === idx ? { ...it, quantity: it.quantity - 1 } : it).filter(it => it.quantity > 0));
                            }}
                            className="w-7 h-7 rounded-lg bg-white hover:bg-stone-100 text-stone-800 font-black flex items-center justify-center border border-stone-200 cursor-pointer"
                          >
                            <Minus className="w-3 h-3" />
                          </button>
                          <span className="w-8 text-center font-black text-xs font-mono text-stone-900">
                            {item.quantity}
                          </span>
                          <button
                            type="button"
                            onClick={() => {
                              setAppendCart(prev => prev.map((it, i) => i === idx ? { ...it, quantity: it.quantity + 1 } : it));
                            }}
                            className="w-7 h-7 rounded-lg bg-orange-600 hover:bg-orange-700 text-white font-black flex items-center justify-center cursor-pointer shadow-xs"
                          >
                            <Plus className="w-3 h-3" />
                          </button>
                          <button
                            type="button"
                            onClick={() => {
                              setAppendCart(prev => prev.filter((_, i) => i !== idx));
                            }}
                            className="p-1.5 text-stone-400 hover:text-red-600 rounded-lg ml-1 cursor-pointer"
                            title="Remover item"
                          >
                            <Trash2 className="w-3.5 h-3.5" />
                          </button>
                        </div>
                      </div>
                    ))}
                  </div>
                )}
              </div>

              {/* Itens Já Existentes no Pedido (Leitura) */}
              <div className="space-y-2 pt-2 border-t border-stone-100">
                <div className="flex items-center justify-between">
                  <h4 className="text-[11px] font-black uppercase text-stone-500 tracking-wider">
                    📋 Itens Originais do Pedido #{String(appendOrderTarget.id).slice(-4).padStart(4, '0')}
                  </h4>
                  <span className="text-xs font-bold text-stone-500 font-mono">
                    {formatCurrency(appendOrderTarget.total)}
                  </span>
                </div>

                <div className="max-h-32 overflow-y-auto space-y-1.5 pr-1">
                  {(Array.isArray(appendOrderTarget.items) ? appendOrderTarget.items : []).map((it, idx) => (
                    <div key={idx} className="flex justify-between items-center text-xs p-2 bg-stone-50 rounded-lg text-stone-700">
                      <span className="truncate max-w-[240px]">
                        <strong>{it.quantity}x</strong> {it.name} {it.prepLabel ? `(${it.prepLabel.split(' ')[1] || it.prepLabel})` : ''}
                      </span>
                      <span className="font-mono text-stone-500 text-[11px]">
                        {formatCurrency(it.price * it.quantity)}
                      </span>
                    </div>
                  ))}
                </div>
              </div>

              {/* Resumo Financeiro */}
              <div className="p-3.5 bg-stone-900 text-white rounded-2xl space-y-2">
                <div className="flex justify-between text-xs text-stone-300">
                  <span>Valor Original:</span>
                  <span className="font-mono">{formatCurrency(appendOrderTarget.total)}</span>
                </div>
                <div className="flex justify-between text-xs text-orange-400 font-bold">
                  <span>+ Acréscimo Adicional:</span>
                  <span className="font-mono">+{formatCurrency(appendCartSubtotal)}</span>
                </div>
                <div className="pt-2 border-t border-stone-700 flex justify-between items-center text-sm font-black">
                  <span className="uppercase text-amber-300">Novo Total a Pagar na Retirada:</span>
                  <span className="text-base font-mono text-emerald-400">
                    {formatCurrency(Number(appendOrderTarget.total) + appendCartSubtotal)}
                  </span>
                </div>
              </div>

              {appendErrorMessage && (
                <div className="p-3 bg-red-50 border border-red-200 rounded-xl text-xs font-bold text-red-700 flex items-center gap-2">
                  <AlertTriangle className="w-4 h-4 text-red-600 shrink-0" />
                  <span>{appendErrorMessage}</span>
                </div>
              )}
            </div>

            {/* Footer com Botões */}
            <div className="space-y-2 pt-2 border-t border-stone-100 shrink-0">
              <button
                type="button"
                disabled={appendCart.length === 0 || isSubmittingAppend}
                onClick={async () => {
                  if (appendCart.length === 0) {
                    alert('Adicione pelo menos um item para fazer o acréscimo.');
                    return;
                  }
                  setIsSubmittingAppend(true);
                  setAppendErrorMessage(null);
                  try {
                    const result = await appendItemsToOrder(appendOrderTarget.id, appendCart);
                    if (result.success && result.order) {
                      const updated = result.order;
                      const orderNum = `#${String(updated.id).slice(-4).padStart(4, '0')}`;
                      setAppendOrderTarget(null);
                      setAppendCart([]);
                      setIsAppendReviewModalOpen(false);
                      setCartToastMessage(`✅ Acréscimo confirmado com sucesso no Pedido ${orderNum}! Novo total: ${formatCurrency(updated.total)}`);
                      setTrackingOrderId(updated.id);
                    } else {
                      setAppendErrorMessage(result.error || 'Erro ao acrescentar itens ao pedido.');
                      fetchOrdersOnly().catch(() => {});
                    }
                  } catch (err: any) {
                    setAppendErrorMessage('Erro de conexão ao salvar acréscimo. Tente novamente.');
                  } finally {
                    setIsSubmittingAppend(false);
                  }
                }}
                className="w-full py-4 bg-emerald-600 hover:bg-emerald-700 active:scale-98 disabled:opacity-50 disabled:cursor-not-allowed text-white rounded-2xl font-black text-xs uppercase tracking-wider shadow-lg shadow-emerald-600/30 transition-all cursor-pointer flex items-center justify-center gap-2"
              >
                {isSubmittingAppend ? (
                  <>
                    <RefreshCw className="w-4 h-4 animate-spin" />
                    <span>Confirmando Acréscimo...</span>
                  </>
                ) : (
                  <>
                    <CheckCircle2 className="w-4 h-4" />
                    <span>Confirmar Acréscimo (+{formatCurrency(appendCartSubtotal)})</span>
                  </>
                )}
              </button>

              <button
                type="button"
                onClick={() => setIsAppendReviewModalOpen(false)}
                className="w-full py-2.5 text-stone-500 hover:text-stone-800 text-xs font-bold uppercase tracking-wider transition-colors cursor-pointer text-center"
              >
                Continuar Escolhendo Mais Itens
              </button>
            </div>
          </div>
        </div>
      )}
      {/* Modal de Seleção de Mesa */}
      {showTableSelectModal && (
        <div className="fixed inset-0 z-50 bg-black/60 backdrop-blur-xs flex items-center justify-center p-4 animate-in fade-in">
          <div className="bg-white rounded-3xl max-w-md w-full p-5 sm:p-6 shadow-2xl border border-stone-200 animate-in zoom-in-95 duration-150">
            <div className="flex items-center justify-between pb-3 border-b border-stone-100 mb-4">
              <div className="flex items-center gap-2.5">
                <div className="w-10 h-10 rounded-2xl bg-amber-500 text-white flex items-center justify-center font-bold">
                  <UtensilsCrossed className="w-5 h-5" />
                </div>
                <div>
                  <h3 className="text-lg font-black text-stone-900 leading-tight">Identifique sua Mesa</h3>
                  <p className="text-xs text-stone-500">Selecione onde você está sentado no momento</p>
                </div>
              </div>
              <button
                type="button"
                onClick={() => setShowTableSelectModal(false)}
                className="p-2 text-stone-400 hover:text-stone-700 rounded-xl hover:bg-stone-100"
              >
                <X className="w-5 h-5" />
              </button>
            </div>

            <div className="space-y-4">
              {tables && tables.filter(t => t.isActive).length > 0 ? (
                <div>
                  <p className="text-xs font-bold text-stone-600 mb-2 uppercase tracking-wider">Mesas Disponíveis:</p>
                  <div className="grid grid-cols-4 gap-2.5 max-h-56 overflow-y-auto p-1">
                    {tables.filter(t => t.isActive).map(tbl => (
                      <button
                        key={tbl.id}
                        type="button"
                        onClick={() => {
                          setSelectedTableNumber(tbl.number);
                          safeStorage.setSession('balbec_selected_table', String(tbl.number));
                          setShowTableSelectModal(false);
                        }}
                        className={`p-3 rounded-2xl flex flex-col items-center justify-center gap-1 border-2 transition-all cursor-pointer ${
                          selectedTableNumber === tbl.number
                            ? 'bg-amber-600 border-amber-700 text-white shadow-md'
                            : 'bg-stone-50 border-stone-200 text-stone-800 hover:border-amber-400 hover:bg-amber-50'
                        }`}
                      >
                        <UtensilsCrossed className="w-4 h-4 opacity-80" />
                        <span className="text-sm font-black">Mesa {tbl.number}</span>
                      </button>
                    ))}
                  </div>
                </div>
              ) : null}

              {/* Digitação manual da mesa */}
              <div className="pt-2 border-t border-stone-100">
                <label className="block text-xs font-bold text-stone-700 mb-1">
                  Ou digite o número da sua mesa:
                </label>
                <div className="flex gap-2">
                  <input
                    type="number"
                    min="1"
                    max="999"
                    placeholder="Ex: 5"
                    defaultValue={selectedTableNumber || ''}
                    onKeyDown={(e) => {
                      if (e.key === 'Enter') {
                        const target = e.target as HTMLInputElement;
                        const val = parseInt(target.value, 10);
                        if (!isNaN(val) && val > 0) {
                          setSelectedTableNumber(val);
                          safeStorage.setSession('balbec_selected_table', String(val));
                          setShowTableSelectModal(false);
                        }
                      }
                    }}
                    id="manualTableInput"
                    className="flex-1 p-3 bg-stone-50 border-2 border-stone-200 rounded-xl text-base font-bold text-stone-900 focus:bg-white focus:ring-2 focus:ring-amber-500"
                  />
                  <button
                    type="button"
                    onClick={() => {
                      const input = document.getElementById('manualTableInput') as HTMLInputElement;
                      if (input) {
                        const val = parseInt(input.value, 10);
                        if (!isNaN(val) && val > 0) {
                          setSelectedTableNumber(val);
                          safeStorage.setSession('balbec_selected_table', String(val));
                          setShowTableSelectModal(false);
                        }
                      }
                    }}
                    className="px-4 py-3 bg-amber-600 hover:bg-amber-700 text-white rounded-xl font-black text-sm transition-colors cursor-pointer"
                  >
                    Confirmar
                  </button>
                </div>
              </div>

              {selectedTableNumber && (
                <button
                  type="button"
                  onClick={() => {
                    setSelectedTableNumber(null);
                    safeStorage.removeItem('balbec_selected_table');
                    setShowTableSelectModal(false);
                  }}
                  className="w-full py-2.5 text-xs font-bold text-stone-500 hover:text-red-600 border border-stone-200 rounded-xl transition-colors cursor-pointer"
                >
                  Remover Mesa (Retirada no Balcão)
                </button>
              )}
            </div>
          </div>
        </div>
      )}

      {/* Botão Flutuante: "CLIQUE PARA CONHECER ESSE SISTEMA" */}
      {!isCheckout && !isCartOpen && storeInfo.showSystemIntroButton !== false && (
        <div 
          className={`fixed z-40 transition-all duration-300 ${
            cart.length > 0 ? 'bottom-22 sm:bottom-24 left-3 sm:left-6' : 'bottom-4 sm:bottom-6 left-3 sm:left-6'
          }`}
        >
          <button
            type="button"
            onClick={() => setIsSystemIntroModalOpen(true)}
            className="group flex items-center gap-2 sm:gap-2.5 bg-gradient-to-r from-orange-600 via-amber-600 to-amber-700 hover:from-orange-500 hover:to-amber-600 active:scale-95 text-white pl-3 pr-4 py-2.5 sm:pl-3.5 sm:pr-5 sm:py-3 rounded-full shadow-2xl hover:shadow-orange-500/40 hover:scale-105 transition-all border-2 border-white/90 cursor-pointer animate-in fade-in"
            title="Clique para conhecer esse sistema"
          >
            <div className="w-7 h-7 sm:w-8 sm:h-8 rounded-full bg-white/20 backdrop-blur-xs flex items-center justify-center text-white shrink-0 shadow-inner">
              <Sparkles className="w-4 h-4 sm:w-4.5 sm:h-4.5 text-yellow-300 animate-pulse" />
            </div>
            <div className="flex flex-col text-left">
              <span className="text-[9px] sm:text-[10px] font-black uppercase tracking-wider text-yellow-200 leading-none">
                💡 Dúvidas ou Novo Aqui?
              </span>
              <span className="text-xs sm:text-sm font-black text-white tracking-tight uppercase">
                CLIQUE PARA CONHECER ESSE SISTEMA
              </span>
            </div>
          </button>
        </div>
      )}

      {/* Modal de Apresentação: Conheça esse Sistema */}
      {isSystemIntroModalOpen && (
        <div className="fixed inset-0 z-[110] bg-stone-950/80 backdrop-blur-xs flex items-center justify-center p-3 sm:p-4 animate-in fade-in duration-200">
          <div className="bg-white rounded-3xl max-w-xl w-full p-5 sm:p-7 shadow-2xl border border-stone-200 max-h-[92vh] flex flex-col animate-in zoom-in-95 duration-200">
            {/* Header */}
            <div className="flex items-start justify-between pb-4 border-b border-stone-100">
              <div className="flex items-center gap-3">
                {storeInfo.logoUrl ? (
                  <img
                    src={storeInfo.logoUrl}
                    alt={storeInfo.name}
                    className="w-12 h-12 object-contain rounded-2xl bg-stone-50 border border-stone-200 p-1"
                  />
                ) : (
                  <div className="w-12 h-12 rounded-2xl bg-orange-600 text-white flex items-center justify-center font-black text-xl">
                    🥖
                  </div>
                )}
                <div>
                  <div className="inline-flex items-center gap-1.5 px-2.5 py-0.5 rounded-full bg-orange-100 text-orange-800 text-[10px] font-black uppercase tracking-wider mb-1">
                    <Sparkles className="w-3 h-3 text-orange-600" />
                    Guia Rápido & Funcionalidades
                  </div>
                  <h2 className="text-xl sm:text-2xl font-black text-stone-900 leading-tight">
                    Como Funciona o Nosso Sistema
                  </h2>
                  <p className="text-xs text-stone-500 font-medium">
                    Tudo sobre como fazer pedidos, revenda e acompanhar suas encomendas
                  </p>
                </div>
              </div>
              <button
                type="button"
                onClick={() => setIsSystemIntroModalOpen(false)}
                className="p-1.5 text-stone-400 hover:text-stone-700 hover:bg-stone-100 rounded-full transition-colors cursor-pointer shrink-0"
                title="Fechar"
              >
                <X className="w-5 h-5" />
              </button>
            </div>

            {/* Content Body */}
            <div className="flex-1 overflow-y-auto py-4 space-y-3.5 pr-1">
              <div className="bg-amber-50/80 border border-amber-200/80 rounded-2xl p-3.5 text-xs text-amber-950 leading-relaxed font-medium">
                👋 <strong>Seja muito bem-vindo!</strong> Desenvolvemos este sistema para que nossos parceiros, revendedores e clientes façam seus pedidos com <strong>máxima rapidez, transparência e autonomia</strong>, sem filas e com tabela de preços atualizada.
              </div>

              {/* Cards explicativos */}
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                <div className="p-3.5 bg-stone-50 hover:bg-stone-100/80 border border-stone-200 rounded-2xl transition-all">
                  <div className="w-8 h-8 rounded-xl bg-orange-100 text-orange-700 flex items-center justify-center font-bold text-sm mb-2 shadow-2xs">
                    🔢
                  </div>
                  <h4 className="text-sm font-black text-stone-900 mb-1">Digite a Quantidade Direto</h4>
                  <p className="text-xs text-stone-600 leading-relaxed">
                    Vai pedir 50, 100 ou 500 itens? Basta digitar o número na caixinha do produto e clicar em <strong>+</strong>. Não precisa clicar um por um!
                  </p>
                </div>

                <div className="p-3.5 bg-stone-50 hover:bg-stone-100/80 border border-stone-200 rounded-2xl transition-all">
                  <div className="w-8 h-8 rounded-xl bg-red-100 text-red-700 flex items-center justify-center font-bold text-sm mb-2 shadow-2xs">
                    🗑️
                  </div>
                  <h4 className="text-sm font-black text-stone-900 mb-1">Exclusão Instantânea</h4>
                  <p className="text-xs text-stone-600 leading-relaxed">
                    A lixeira fica sempre visível no item e no carrinho. Quer remover um produto com 100 unidades? Um clique e está excluído.
                  </p>
                </div>

                <div className="p-3.5 bg-stone-50 hover:bg-stone-100/80 border border-stone-200 rounded-2xl transition-all">
                  <div className="w-8 h-8 rounded-xl bg-emerald-100 text-emerald-700 flex items-center justify-center font-bold text-sm mb-2 shadow-2xs">
                    🔑
                  </div>
                  <h4 className="text-sm font-black text-stone-900 mb-1">Login Fácil com CNPJ/CPF</h4>
                  <p className="text-xs text-stone-600 leading-relaxed">
                    Seu usuário é o seu CNPJ ou CPF. A senha inicial são os 5 primeiros dígitos. Seus dados e endereços ficam salvos para compras futuras!
                  </p>
                </div>

                <div className="p-3.5 bg-stone-50 hover:bg-stone-100/80 border border-stone-200 rounded-2xl transition-all">
                  <div className="w-8 h-8 rounded-xl bg-blue-100 text-blue-700 flex items-center justify-center font-bold text-sm mb-2 shadow-2xs">
                    🏪
                  </div>
                  <h4 className="text-sm font-black text-stone-900 mb-1">Retirada ou Entrega</h4>
                  <p className="text-xs text-stone-600 leading-relaxed">
                    Você escolhe: retire no balcão da loja com tudo já separado e embalado, ou receba diretamente no seu endereço.
                  </p>
                </div>
              </div>

              <div className="p-3.5 bg-emerald-50/70 border border-emerald-200 rounded-2xl flex items-center gap-3">
                <div className="w-9 h-9 rounded-xl bg-emerald-600 text-white flex items-center justify-center font-black text-sm shrink-0">
                  💳
                </div>
                <div className="text-xs text-emerald-950 leading-relaxed">
                  <strong>Pagamento Seguro & Flexível:</strong> Pague online com aprovação automática imediata (Pix QR Code ou Cartão) ou presencialmente no balcão ao retirar seu pedido.
                </div>
              </div>
            </div>

            {/* Footer Buttons */}
            <div className="pt-3 border-t border-stone-100 flex flex-col sm:flex-row gap-2.5">
              {!activeCustomer && (
                <button
                  type="button"
                  onClick={() => {
                    setIsSystemIntroModalOpen(false);
                    setAuthMode('login');
                    setIsAuthModalOpen(true);
                  }}
                  className="py-3 px-4 bg-orange-600 hover:bg-orange-700 text-white rounded-xl font-black text-xs uppercase tracking-wider transition-all flex items-center justify-center gap-2 cursor-pointer shadow-md"
                >
                  <LogIn className="w-4 h-4" />
                  <span>Entrar / Cadastrar com CNPJ/CPF</span>
                </button>
              )}

              <a
                href={`https://wa.me/5534996320500?text=${encodeURIComponent('Olá! Gostaria de tirar dúvidas sobre o sistema e produtos da Balbec.')}`}
                target="_blank"
                rel="noopener noreferrer"
                className="py-3 px-4 bg-emerald-600 hover:bg-emerald-700 text-white rounded-xl font-black text-xs uppercase tracking-wider transition-all flex items-center justify-center gap-2 cursor-pointer shadow-md"
              >
                <span>💬 Falar no WhatsApp (34 99632-0500)</span>
              </a>

              <button
                type="button"
                onClick={() => setIsSystemIntroModalOpen(false)}
                className="py-3 px-4 bg-stone-100 hover:bg-stone-200 text-stone-700 rounded-xl font-bold text-xs uppercase tracking-wider transition-colors cursor-pointer text-center sm:ml-auto"
              >
                Continuar Navegando
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Floating AI Virtual Agent Assistant - Disabled in Totem (Autoatendimento) mode */}
      {!isTotemPath && salesChannel !== 'kiosk' && (
        <AiAssistantFloatingButton 
          onAddToCart={(p) => initiateAddToCart(p)} 
          onAddDirectToCart={(product, qty) => {
            addToCart(product, [], null, qty);
          }}
          onApplyAiDraftToCart={(draft) => {
            draft.items.forEach((it) => {
              const prod = products.find((p) => p.id === it.productId) || {
                id: it.productId,
                externalId: it.externalId,
                code: it.code,
                name: it.name,
                description: it.description || '',
                price: it.price,
                imageUrl: it.imageUrl,
                isActive: true,
                availableInStore: true,
              };
              addToCart(
                prod,
                it.addons || [],
                it.flavor || null,
                it.quantity,
                it.prepType,
                it.prepLabel,
                false
              );
            });
            if (draft.scheduledDate && draft.scheduledTime) {
              setSelectedScheduleDate(draft.scheduledDate);
              if (draft.scheduledDay) setSelectedScheduleDay(draft.scheduledDay);
              setSelectedScheduleTime(draft.scheduledTime);
              safeStorage.setItem('balbec_selected_schedule_date', draft.scheduledDate);
              if (draft.scheduledDay) safeStorage.setItem('balbec_selected_schedule_day', draft.scheduledDay);
              safeStorage.setItem('balbec_selected_schedule_time', draft.scheduledTime);
            }
          }}
          onOpenCart={() => setIsCartOpen(true)}
          activeCustomer={activeCustomer}
          hasCartItems={cart.length > 0}
        />
      )}

      {/* Customer Auth Modal (Login / Register / Forgot Password) */}
      {isAuthModalOpen && (
        <div className="fixed inset-0 bg-stone-950/80 flex items-center justify-center z-[100] p-4 backdrop-blur-xs">
          <div className="bg-white rounded-3xl shadow-2xl max-w-md w-full overflow-hidden p-6 sm:p-8 relative border border-stone-200">
            <button
              onClick={() => setIsAuthModalOpen(false)}
              className="absolute right-4 top-4 p-2 text-stone-400 hover:text-stone-600 rounded-full hover:bg-stone-100 cursor-pointer"
            >
              <X className="w-5 h-5" />
            </button>

            {activeCustomer ? (
              <div className="text-center py-2 space-y-4">
                <div className="w-16 h-16 bg-orange-100 text-orange-600 rounded-2xl flex items-center justify-center mx-auto shadow-sm">
                  <UserCheck className="w-8 h-8" />
                </div>
                <div>
                  <h3 className="text-xl font-black text-stone-900">Você já está conectado</h3>
                  <p className="text-base font-bold text-orange-600 mt-1">{activeCustomer.name}</p>
                  <p className="text-xs text-stone-500">{activeCustomer.phone || activeCustomer.email}</p>
                </div>
                <div className="bg-amber-50 border border-amber-200 rounded-2xl p-3.5 text-xs text-amber-900 leading-relaxed font-medium text-left">
                  Para entrar com outro usuário, você deve primeiro <strong>desconectar</strong> da conta atual de <strong>{activeCustomer.name}</strong>.
                </div>
                <div className="pt-2 space-y-2.5">
                  <button
                    type="button"
                    onClick={() => {
                      if (confirm(`Deseja realmente desconectar da conta de ${activeCustomer.name}?`)) {
                        handleCustomerLogout();
                      }
                    }}
                    className="w-full py-3.5 bg-red-600 hover:bg-red-700 active:scale-[0.98] text-white rounded-2xl font-black text-xs uppercase tracking-wider transition-all shadow-md cursor-pointer flex items-center justify-center gap-2"
                  >
                    <X className="w-4 h-4" />
                    <span>Desconectar para Trocar de Usuário</span>
                  </button>
                  <button
                    type="button"
                    onClick={() => setIsAuthModalOpen(false)}
                    className="w-full py-3 bg-stone-100 hover:bg-stone-200 active:scale-[0.98] text-stone-700 rounded-2xl font-bold text-xs uppercase tracking-wider transition-all cursor-pointer"
                  >
                    Continuar Conectado
                  </button>
                </div>
              </div>
            ) : (
              <>
                <div className="text-center mb-6">
                  <div className="w-12 h-12 bg-orange-100 text-orange-600 rounded-2xl flex items-center justify-center mx-auto mb-3 font-bold">
                    <UserIcon className="w-6 h-6" />
                  </div>
                  <h2 className="text-2xl font-black text-stone-900">
                    {authMode === 'login' ? 'Entrar na sua Conta' : authMode === 'register' ? 'Novo Cadastro' : 'Recuperar Senha'}
                  </h2>
                  <p className="text-xs text-stone-500 mt-1">
                    {authMode === 'login'
                      ? 'Informe seu CNPJ ou CPF e os 5 primeiros dígitos como senha'
                      : authMode === 'register'
                      ? 'Solicite seu cadastro (sujeito à aprovação do administrador)'
                      : 'Informe seu CNPJ ou CPF para recuperar sua senha'}
                  </p>
                </div>

            {authError && (
              <div className="mb-4 p-3 bg-red-50 border border-red-200 rounded-xl text-xs font-bold text-red-700 text-center">
                {authError}
              </div>
            )}

            {authSuccessMsg && (
              <div className="mb-4 p-3 bg-emerald-50 border border-emerald-200 rounded-xl text-xs font-bold text-emerald-700 text-center space-y-2">
                <p>{authSuccessMsg}</p>
                {authMode !== 'login' && (
                  <button
                    type="button"
                    onClick={() => { setAuthMode('login'); setAuthError(''); setAuthSuccessMsg(''); }}
                    className="w-full py-2 bg-emerald-600 text-white rounded-lg font-black text-xs uppercase cursor-pointer"
                  >
                    Ir para Login
                  </button>
                )}
              </div>
            )}

            {authMode === 'login' && (
              <form onSubmit={handleCustomerLogin} className="space-y-4">
                <div>
                  <label className="block text-xs font-bold text-stone-700 mb-1">Usuário (CNPJ ou CPF)</label>
                  <input
                    type="text"
                    value={authIdentifier}
                    onChange={(e) => setAuthIdentifier(formatCpfCnpj(e.target.value))}
                    placeholder="00.000.000/0000-00 ou 000.000.000-00"
                    className="w-full p-3.5 bg-stone-50 border border-stone-300 rounded-xl text-sm font-mono font-bold text-stone-900 focus:bg-white focus:ring-2 focus:ring-orange-500"
                    required
                  />
                </div>

                <div>
                  <div className="flex items-center justify-between mb-1">
                    <label className="text-xs font-bold text-stone-700">Senha (5 primeiros dígitos do CNPJ/CPF)</label>
                    <button
                      type="button"
                      onClick={() => { setAuthMode('forgot'); setAuthError(''); setAuthSuccessMsg(''); }}
                      className="text-xs text-orange-600 font-bold hover:underline cursor-pointer"
                    >
                      Recuperar senha
                    </button>
                  </div>
                  <input
                    type="password"
                    value={authPassword}
                    onChange={(e) => setAuthPassword(e.target.value)}
                    placeholder="5 primeiros dígitos do CNPJ ou CPF"
                    className="w-full p-3.5 bg-stone-50 border border-stone-300 rounded-xl text-sm font-mono font-bold text-stone-900 focus:bg-white focus:ring-2 focus:ring-orange-500"
                    required
                  />
                </div>

                <button
                  type="submit"
                  disabled={authLoading}
                  className="w-full py-4 bg-orange-600 hover:bg-orange-700 active:bg-orange-800 text-white rounded-xl font-black text-base shadow-lg shadow-orange-600/30 transition-all cursor-pointer flex items-center justify-center gap-2"
                >
                  <span>{authLoading ? 'Entrando...' : 'Entrar'}</span>
                </button>

                <div className="text-center pt-2">
                  <span className="text-xs text-stone-500">Ainda não tem cadastro? </span>
                  <button
                    type="button"
                    onClick={() => { setAuthMode('register'); setAuthError(''); setAuthSuccessMsg(''); }}
                    className="text-xs font-black text-orange-600 hover:underline cursor-pointer"
                  >
                    Novo Cadastro
                  </button>
                </div>
              </form>
            )}

            {authMode === 'register' && (
              <form onSubmit={handleCustomerRegister} className="space-y-3.5">
                <div className="p-3 bg-amber-50 border border-amber-200 rounded-xl text-xs text-amber-900 font-medium">
                  🔒 Seu cadastro ficará <strong>Pendente</strong> até aprovação do Administrador.
                </div>

                <div>
                  <label className="block text-xs font-bold text-stone-700 mb-1">Nome Completo ou Razão Social *</label>
                  <input
                    type="text"
                    value={authName}
                    onChange={(e) => setAuthName(e.target.value)}
                    placeholder="Nome da Empresa ou Cliente"
                    className="w-full p-3 bg-stone-50 border border-stone-300 rounded-xl text-sm font-bold text-stone-900 focus:bg-white focus:ring-2 focus:ring-orange-500"
                    required
                  />
                </div>

                <div>
                  <label className="block text-xs font-bold text-stone-700 mb-1">CNPJ ou CPF *</label>
                  <input
                    type="text"
                    value={authRegCpf}
                    onChange={(e) => setAuthRegCpf(formatCpfCnpj(e.target.value))}
                    placeholder="00.000.000/0000-00 ou 000.000.000-00"
                    className="w-full p-3 bg-stone-50 border border-stone-300 rounded-xl text-sm font-mono font-bold text-stone-900 focus:bg-white focus:ring-2 focus:ring-orange-500"
                    required
                  />
                  {authRegCpf.replace(/\D/g, '').length >= 5 && (
                    <p className="text-[11px] text-orange-700 font-bold mt-1">
                      🔑 Sua senha automática será os 5 primeiros dígitos: <strong>{authRegCpf.replace(/\D/g, '').slice(0, 5)}</strong>
                    </p>
                  )}
                </div>

                <div>
                  <label className="block text-xs font-bold text-stone-700 mb-1">WhatsApp / Telefone (com DDD) *</label>
                  <input
                    type="tel"
                    value={authPhone}
                    onChange={(e) => setAuthPhone(formatPhone(e.target.value))}
                    placeholder="(00) 00000-0000"
                    className="w-full p-3 bg-stone-50 border border-stone-300 rounded-xl text-sm font-mono text-stone-900 focus:bg-white focus:ring-2 focus:ring-orange-500"
                    required
                  />
                </div>

                <div>
                  <label className="block text-xs font-bold text-stone-700 mb-1">E-mail (Opcional)</label>
                  <input
                    type="email"
                    value={authRegEmail}
                    onChange={(e) => setAuthRegEmail(e.target.value)}
                    placeholder="seu@email.com"
                    className="w-full p-3 bg-stone-50 border border-stone-300 rounded-xl text-sm text-stone-900 focus:bg-white focus:ring-2 focus:ring-orange-500"
                  />
                </div>

                <div>
                  <label className="block text-xs font-bold text-stone-700 mb-1">Endereço (Opcional)</label>
                  <input
                    type="text"
                    value={authAddress}
                    onChange={(e) => setAuthAddress(e.target.value)}
                    placeholder="Rua Exemplo, 123, Bairro"
                    className="w-full p-3 bg-stone-50 border border-stone-300 rounded-xl text-sm text-stone-900 focus:bg-white focus:ring-2 focus:ring-orange-500"
                  />
                </div>

                <button
                  type="submit"
                  disabled={authLoading}
                  className="w-full py-4 bg-orange-600 hover:bg-orange-700 active:bg-orange-800 text-white rounded-xl font-black text-base shadow-lg shadow-orange-600/30 transition-all cursor-pointer flex items-center justify-center gap-2 mt-2"
                >
                  <span>{authLoading ? 'Enviando...' : 'Solicitar Cadastro'}</span>
                </button>

                <div className="text-center pt-2">
                  <span className="text-xs text-stone-500">Já tem uma conta? </span>
                  <button
                    type="button"
                    onClick={() => { setAuthMode('login'); setAuthError(''); setAuthSuccessMsg(''); }}
                    className="text-xs font-black text-orange-600 hover:underline cursor-pointer"
                  >
                    Entrar
                  </button>
                </div>
              </form>
            )}

            {authMode === 'forgot' && (
              <form onSubmit={handleCustomerForgot} className="space-y-4">
                <div>
                  <label className="block text-xs font-bold text-stone-700 mb-1">CNPJ ou CPF Cadastrado</label>
                  <input
                    type="text"
                    value={authIdentifier}
                    onChange={(e) => setAuthIdentifier(formatCpfCnpj(e.target.value))}
                    placeholder="Digite seu CNPJ ou CPF"
                    className="w-full p-3.5 bg-stone-50 border border-stone-300 rounded-xl text-sm font-mono font-bold text-stone-900 focus:bg-white focus:ring-2 focus:ring-orange-500"
                    required
                  />
                </div>

                <button
                  type="submit"
                  disabled={authLoading}
                  className="w-full py-4 bg-orange-600 hover:bg-orange-700 active:bg-orange-800 text-white rounded-xl font-black text-base shadow-lg shadow-orange-600/30 transition-all cursor-pointer flex items-center justify-center gap-2"
                >
                  <span>{authLoading ? 'Recuperando...' : 'Recuperar Senha'}</span>
                </button>

                <div className="text-center pt-2">
                  <button
                    type="button"
                    onClick={() => { setAuthMode('login'); setAuthError(''); setAuthSuccessMsg(''); }}
                    className="text-xs font-black text-stone-600 hover:underline cursor-pointer"
                  >
                    ← Voltar para o Login
                  </button>
                </div>
              </form>
            )}
          </>
        )}
          </div>
        </div>
      )}

      {/* Modal de Alteração da Meta do Mês */}
      {isEditGoalModalOpen && (
        <div className="fixed inset-0 z-[120] bg-stone-900/80 backdrop-blur-xs flex items-center justify-center p-4 animate-in fade-in duration-200">
          <div className="bg-white rounded-3xl max-w-md w-full p-6 shadow-2xl border border-stone-200 space-y-5 animate-in zoom-in-95 duration-150">
            <div className="flex items-center justify-between pb-3 border-b border-stone-100">
              <div className="flex items-center gap-2.5">
                <div className="w-10 h-10 rounded-2xl bg-orange-100 text-orange-600 flex items-center justify-center font-bold text-xl">
                  🎯
                </div>
                <div>
                  <h3 className="text-lg font-black text-stone-900 leading-tight">Alterar Meta Mensal</h3>
                  <p className="text-xs text-stone-500 font-medium">Defina seu objetivo de compras do mês</p>
                </div>
              </div>
              <button
                type="button"
                onClick={() => setIsEditGoalModalOpen(false)}
                className="p-1.5 text-stone-400 hover:text-stone-700 rounded-full hover:bg-stone-100 transition-colors cursor-pointer"
              >
                <X className="w-5 h-5" />
              </button>
            </div>

            <div className="space-y-3">
              <label className="block text-xs font-black uppercase text-stone-700 tracking-wider">
                Valor da Meta (R$)
              </label>
              <input
                type="number"
                step="50"
                min="100"
                value={newGoalInput}
                onChange={(e) => setNewGoalInput(e.target.value)}
                placeholder="Ex: 1000"
                className="w-full p-3.5 bg-stone-50 border-2 border-stone-200 rounded-2xl text-lg font-black font-mono text-stone-900 focus:bg-white focus:ring-2 focus:ring-orange-500 focus:border-orange-500 transition-all"
              />
              <p className="text-xs text-stone-500 leading-relaxed font-medium">
                Sua meta ajuda a acompanhar seus gastos e progresso ao longo do mês.
              </p>
            </div>

            <div className="flex gap-2.5 pt-2 border-t border-stone-100">
              <button
                type="button"
                onClick={() => setIsEditGoalModalOpen(false)}
                className="flex-1 py-3 bg-stone-100 hover:bg-stone-200 text-stone-700 rounded-2xl font-bold text-xs uppercase tracking-wider transition-colors cursor-pointer"
              >
                Cancelar
              </button>
              <button
                type="button"
                onClick={handleSaveMonthlyGoal}
                className="flex-1 py-3 bg-orange-600 hover:bg-orange-700 text-white rounded-2xl font-black text-xs uppercase tracking-wider shadow-lg shadow-orange-600/30 transition-all cursor-pointer"
              >
                Salvar Meta
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Modal de Acompanhamento e Status ao Vivo do Pedido */}
      {trackingOrderId && (
        <CustomerOrderTrackerModal 
          orderId={trackingOrderId}
          onClose={() => setTrackingOrderId(null)}
          onStartAppend={handleStartAppendOrder}
        />
      )}

      {/* Modal de Acompanhamento e Conexão de Pedido com o Smartphone */}
      {isTrackOrderModalOpen && (
        <div 
          className="fixed inset-0 z-[130] bg-stone-900/80 backdrop-blur-sm flex items-center justify-center p-3 sm:p-4 overflow-y-auto overscroll-contain animate-in fade-in duration-200"
          onClick={(e) => {
            if (e.target === e.currentTarget) closeTrackOrderModal();
          }}
        >
          <div className="bg-white rounded-3xl max-w-md w-full shadow-2xl border border-stone-200 animate-in zoom-in-95 duration-150 flex flex-col max-h-[90vh] sm:max-h-[85vh] overflow-hidden my-auto">
            {/* Header Fixo */}
            <div className="bg-stone-900 text-white p-4 sm:p-5 flex items-center justify-between shrink-0 shadow-sm z-10">
              <div className="flex items-center gap-3">
                <div className="w-10 h-10 rounded-2xl bg-orange-500 text-white flex items-center justify-center font-bold shadow-md shadow-orange-500/30">
                  <BellRing className="w-5 h-5 animate-pulse" />
                </div>
                <div>
                  <h3 className="text-base font-black uppercase tracking-tight">Acompanhar Pedido</h3>
                  <p className="text-xs text-stone-400">Status em tempo real no seu celular</p>
                </div>
              </div>
              <div className="flex items-center gap-1.5">
                <button
                  type="button"
                  onClick={async () => {
                    await handleManualSync();
                    setTrackSearchFeedback('✅ Status dos pedidos atualizados com sucesso!');
                    setTimeout(() => setTrackSearchFeedback(null), 3000);
                  }}
                  title="Atualizar status dos pedidos agora"
                  className="p-2 text-stone-400 hover:text-white rounded-xl hover:bg-stone-800 active:scale-95 transition-all cursor-pointer flex items-center justify-center"
                >
                  <RefreshCw className={`w-4 h-4 text-orange-400 ${isRefreshing ? 'animate-spin' : ''}`} />
                </button>
                <button
                  type="button"
                  onClick={closeTrackOrderModal}
                  className="p-1.5 text-stone-400 hover:text-white rounded-full hover:bg-stone-800 transition-colors cursor-pointer"
                >
                  <X className="w-5 h-5" />
                </button>
              </div>
            </div>

            {/* Conteúdo rolável com scroll suave no mobile */}
            <div className="p-4 sm:p-6 space-y-5 overflow-y-auto overscroll-contain flex-1 touch-pan-y">
              {/* Barra de ação rápida de atualização */}
              <div className="flex items-center justify-between pb-2 border-b border-stone-100">
                <span className="text-xs font-bold text-stone-600">
                  {customerActiveOrders.length > 0 
                    ? `${customerActiveOrders.length} pedido(s) conectado(s)` 
                    : (latestActiveOrder ? '1 pedido conectado' : 'Nenhum pedido conectado')}
                </span>
                <button
                  type="button"
                  onClick={async () => {
                    await handleManualSync();
                    setTrackSearchFeedback('✅ Pedidos sincronizados!');
                    setTimeout(() => setTrackSearchFeedback(null), 3000);
                  }}
                  disabled={isRefreshing}
                  className="flex items-center gap-1.5 px-3 py-1.5 bg-orange-50 hover:bg-orange-100 active:scale-95 text-orange-700 font-black rounded-lg text-xs transition-all cursor-pointer border border-orange-200"
                >
                  <RefreshCw className={`w-3.5 h-3.5 ${isRefreshing ? 'animate-spin text-orange-600' : ''}`} />
                  <span>{isRefreshing ? 'Atualizando...' : 'Atualizar Pedidos'}</span>
                </button>
              </div>

              {/* Pedidos Ativos Conectados (se houver) */}
              {(customerActiveOrders.length > 0 ? customerActiveOrders : (latestActiveOrder ? [latestActiveOrder] : [])).map((order: any) => (
                <div key={order.id} className="p-4 bg-emerald-50 rounded-2xl border-2 border-emerald-300 space-y-3">
                  <div className="flex items-center justify-between">
                    <div>
                      <span className="text-[10px] font-black uppercase text-emerald-700 bg-emerald-200/80 px-2 py-0.5 rounded-md">
                        Pedido Ativo Conectado
                      </span>
                      <h4 className="text-xl font-black text-stone-900 font-mono mt-1">
                        #{String(order.id).slice(-4).padStart(4, '0')}
                      </h4>
                    </div>
                    <span className="w-3 h-3 rounded-full bg-emerald-500 animate-ping" />
                  </div>

                  <div className="p-3 bg-white rounded-xl border border-emerald-200 text-xs font-semibold text-stone-700 space-y-1">
                    <p>
                      <strong>Status Atual: </strong> 
                      <span className="text-emerald-700 uppercase font-black">
                        {order.status === 'ready' || order.status === 'ready_for_pickup' || order.status === 'ready_for_delivery' ? '🛍️ Pronto para Retirada no Balcão' :
                         order.status === 'preparing' ? '👨‍🍳 Em Preparo na Cozinha' :
                         order.status === 'completed' || order.deliveryStatus === 'delivered' ? '✅ Concluído / Retirado' :
                         requiresOperatorPaymentConfirmation(order) ? '💳 Recebido • Aguardando Financeiro' :
                         '⏳ Pedido Recebido na Fila'}
                      </span>
                    </p>
                    <p className="text-stone-500 text-[11px]">
                      Cliente: {order.customerName || 'Cliente'} • Retirada no Balcão
                    </p>
                    <p className="text-stone-500 text-[11px]">
                      Pagamento: <strong className="text-stone-700">{order.paymentMethod || 'Na Retirada'}</strong> • Total: <strong className="text-emerald-700">{formatCurrency(order.total)}</strong>
                    </p>
                  </div>

                  {/* Botão de Acréscimo no Pedido (Status pendente e pagamento presencial na retirada) */}
                  {isOrderEligibleForAppend(order) && (
                    <button
                      type="button"
                      onClick={() => handleStartAppendOrder(order)}
                      className="w-full py-3 bg-gradient-to-r from-orange-600 to-amber-600 hover:from-orange-700 hover:to-amber-700 text-white rounded-xl font-black text-xs uppercase tracking-wider shadow-md transition-all flex items-center justify-center gap-2 cursor-pointer active:scale-98"
                    >
                      <Plus className="w-4 h-4" />
                      <span>Fazer Acréscimo / Adicionar Mais Itens 🛒</span>
                    </button>
                  )}

                  <button
                    type="button"
                    onClick={() => {
                      closeTrackOrderModal();
                      setTrackingOrderId(order.id);
                    }}
                    className="w-full py-2.5 bg-stone-900 hover:bg-stone-800 text-white rounded-xl font-black text-xs uppercase tracking-wider shadow-sm transition-all flex items-center justify-center gap-2 cursor-pointer"
                  >
                    <span>Ver Detalhes da Retirada 📋</span>
                  </button>
                </div>
              ))}

              {/* Formulário para buscar e conectar outro pedido */}
              <div className="space-y-3">
                <label className="block text-xs font-black uppercase text-stone-700 tracking-wider">
                  Conectar Pedido a este Celular
                </label>
                <p className="text-xs text-stone-500 leading-relaxed">
                  Fez o pedido em outro computador, balcão ou janela? Digite o <strong>número do pedido (ex: 0001)</strong> ou seu <strong>telefone</strong> para vincular a este smartphone e receber os avisos na tela:
                </p>
                <div className="flex gap-2">
                  <input
                    type="text"
                    value={trackSearchInput}
                    onChange={(e) => setTrackSearchInput(e.target.value)}
                    onKeyDown={(e) => e.key === 'Enter' && handleConnectOrder(trackSearchInput)}
                    placeholder="Ex: 0001 ou (11) 99999-9999"
                    className="flex-1 p-3 bg-stone-50 border border-stone-300 rounded-xl text-xs sm:text-sm font-bold text-stone-900 focus:bg-white focus:ring-2 focus:ring-orange-500"
                  />
                  <button
                    type="button"
                    onClick={() => handleConnectOrder(trackSearchInput)}
                    className="px-4 py-3 bg-orange-600 hover:bg-orange-700 text-white rounded-xl font-black text-xs uppercase tracking-wider shrink-0 transition-all cursor-pointer shadow-md"
                  >
                    Buscar
                  </button>
                </div>

                {trackSearchFeedback && (
                  <p className={`text-xs font-bold p-3 rounded-xl ${
                    trackSearchFeedback.startsWith('✅') 
                      ? 'bg-emerald-100 text-emerald-800 border border-emerald-300' 
                      : 'bg-red-50 text-red-700 border border-red-200'
                  }`}>
                    {trackSearchFeedback}
                  </p>
                )}
              </div>

              {/* Botão de Permissão de Notificações do Smartphone */}
              <div className="pt-2 border-t border-stone-200 space-y-2">
                <p className="text-[11px] font-black uppercase text-stone-500 tracking-wider">
                  Notificações na Barra do Celular
                </p>
                <button
                  type="button"
                  onClick={async () => {
                    try {
                      if (typeof window !== 'undefined' && 'Notification' in window) {
                        const res = await Notification.requestPermission();
                        if (res === 'granted') {
                          alert('✅ Notificações do smartphone ativadas com sucesso!');
                        } else {
                          alert('A permissão foi negada no navegador. Para ativar, toque no ícone de cadeado na barra de endereços do seu navegador e marque Notificações como Permitir.');
                        }
                      } else {
                        alert('Este navegador não tem suporte a notificações web. Mas fique tranquilo: com o site aberto, a janela surge na tela com som e vibração!');
                      }
                    } catch (e) {
                      alert('Toque no cadeado na barra de endereços para permitir notificações.');
                    }
                  }}
                  className="w-full py-3 px-4 bg-stone-100 hover:bg-stone-200 active:scale-98 text-stone-800 rounded-xl text-xs font-black uppercase tracking-wider flex items-center justify-center gap-2 border border-stone-300 cursor-pointer transition-all"
                >
                  <BellRing className="w-4 h-4 text-orange-600" />
                  <span>
                    {typeof window !== 'undefined' && 'Notification' in window && Notification.permission === 'granted'
                      ? '✅ Notificações do Sistema Ativadas'
                      : 'Ativar Notificações no Sistema'}
                  </span>
                </button>
                <p className="text-[10px] text-stone-400 leading-tight">
                  No iPhone (iOS), adicione à tela de início (botão Compartilhar ➔ Adicionar à Tela de Início) para ativar avisos na barra do iOS.
                </p>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Toast de Sucesso ao Adicionar ao Carrinho / Acréscimo */}
      {cartToastMessage && (
        <div className="fixed bottom-24 left-1/2 transform -translate-x-1/2 z-[150] bg-emerald-600 text-white font-black px-5 py-3.5 rounded-2xl shadow-2xl animate-in fade-in zoom-in slide-in-from-bottom-5 duration-200 flex items-center gap-3 border border-emerald-400/50 max-w-[92vw]">
          <CheckCircle2 className="w-5 h-5 text-white shrink-0" />
          <span className="text-xs sm:text-sm uppercase tracking-wide">{cartToastMessage}</span>
          <button
            type="button"
            onClick={() => setCartToastMessage(null)}
            className="p-1 hover:bg-white/20 rounded-lg transition-colors cursor-pointer shrink-0"
            aria-label="Fechar notificação"
          >
            <X className="w-4 h-4 text-white" />
          </button>
        </div>
      )}

      {/* Perfil e Pedidos Anteriores */}
      {renderProfileModal()}

      {/* Troca Obrigatória de Senha (Primeiro Acesso) */}
      {mustChangePasswordModal && activeCustomer && (
        <div 
          className="fixed inset-0 z-[99999] bg-stone-950/85 backdrop-blur-md flex items-center justify-center p-4 sm:p-6 overflow-y-auto"
          role="dialog"
          aria-modal="true"
        >
          <div className="bg-white rounded-3xl max-w-md w-full p-6 sm:p-8 shadow-2xl border-2 border-orange-500/30 text-center relative overflow-hidden animate-in zoom-in-95 duration-200 my-auto">
            {/* Faixa decorativa superior */}
            <div className="absolute top-0 left-0 right-0 h-2 bg-gradient-to-r from-orange-500 via-amber-500 to-orange-600" />

            {/* Ícone */}
            <div className="w-16 h-16 mx-auto mb-4 bg-orange-100 text-orange-600 rounded-2xl flex items-center justify-center shadow-inner border border-orange-200">
              <Lock className="w-8 h-8" />
            </div>

            {/* Título e Subtítulo */}
            <h2 className="text-xl sm:text-2xl font-black text-stone-900 uppercase tracking-tight">
              Primeiro Acesso
            </h2>
            <p className="text-[13px] font-black text-orange-600 uppercase tracking-wider mt-0.5">
              Troca Obrigatória de Senha
            </p>

            <p className="text-xs text-stone-600 font-medium mt-3 leading-relaxed">
              Olá, <strong className="text-stone-900">{activeCustomer.name}</strong>! Por questões de segurança, você realizou seu login com a senha provisória padrão (5 primeiros dígitos do seu CNPJ/CPF) e precisa criar uma nova senha pessoal definitiva para continuar.
            </p>

            {/* Badge do Usuário */}
            <div className="mt-4 p-3 bg-stone-50 border border-stone-200 rounded-2xl flex items-center justify-between text-left">
              <div>
                <span className="text-[10px] font-bold text-stone-400 uppercase tracking-wider block">Usuário Conectado</span>
                <span className="text-xs font-black text-stone-800 truncate block max-w-[220px]">{activeCustomer.name}</span>
              </div>
              <span className="text-[11px] font-mono font-bold text-stone-600 bg-white px-2 py-1 rounded-lg border border-stone-200">
                {activeCustomer.cpf || 'CNPJ/CPF'}
              </span>
            </div>

            {/* Feedback de erro e sucesso */}
            {changePassError && (
              <div className="mt-4 p-3.5 bg-red-50 border border-red-200 rounded-2xl text-xs font-bold text-red-700 text-left flex items-start gap-2 animate-in fade-in">
                <AlertTriangle className="w-4 h-4 text-red-600 shrink-0 mt-0.5" />
                <span>{changePassError}</span>
              </div>
            )}

            {changePassSuccess && (
              <div className="mt-4 p-3.5 bg-emerald-50 border-2 border-emerald-300 rounded-2xl text-xs font-bold text-emerald-800 text-left flex items-start gap-2 animate-in fade-in">
                <CheckCircle2 className="w-4 h-4 text-emerald-600 shrink-0 mt-0.5" />
                <span>{changePassSuccess}</span>
              </div>
            )}

            {/* Formulário */}
            <form onSubmit={handleCustomerChangePassword} className="mt-5 space-y-4 text-left">
              <div>
                <label htmlFor="new-customer-password" className="block text-[11px] font-black text-stone-700 mb-1.5 uppercase tracking-wider">
                  Nova Senha Pessoal *
                </label>
                <div className="relative">
                  <input
                    id="new-customer-password"
                    name="newPassword"
                    type={showNewCustPassword ? 'text' : 'password'}
                    value={newCustPassword}
                    onChange={(e) => {
                      setNewCustPassword(e.target.value);
                      if (changePassError) setChangePassError('');
                    }}
                    placeholder="Mínimo 5 caracteres"
                    className="w-full p-3.5 pr-11 bg-stone-50 border-2 border-stone-200 rounded-2xl focus:ring-2 focus:ring-orange-500 focus:bg-white transition-all font-mono font-bold text-stone-900"
                    required
                  />
                  <button
                    type="button"
                    onClick={() => setShowNewCustPassword(prev => !prev)}
                    className="absolute right-3 top-1/2 -translate-y-1/2 p-1.5 text-stone-400 hover:text-stone-600 cursor-pointer"
                  >
                    {showNewCustPassword ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
                  </button>
                </div>
              </div>

              <div>
                <label htmlFor="confirm-customer-password" className="block text-[11px] font-black text-stone-700 mb-1.5 uppercase tracking-wider">
                  Confirmar Nova Senha *
                </label>
                <div className="relative">
                  <input
                    id="confirm-customer-password"
                    name="confirmPassword"
                    type={showConfirmCustPassword ? 'text' : 'password'}
                    value={confirmCustPassword}
                    onChange={(e) => {
                      setConfirmCustPassword(e.target.value);
                      if (changePassError) setChangePassError('');
                    }}
                    placeholder="Digite a nova senha novamente"
                    className="w-full p-3.5 pr-11 bg-stone-50 border-2 border-stone-200 rounded-2xl focus:ring-2 focus:ring-orange-500 focus:bg-white transition-all font-mono font-bold text-stone-900"
                    required
                  />
                  <button
                    type="button"
                    onClick={() => setShowConfirmCustPassword(prev => !prev)}
                    className="absolute right-3 top-1/2 -translate-y-1/2 p-1.5 text-stone-400 hover:text-stone-600 cursor-pointer"
                  >
                    {showConfirmCustPassword ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
                  </button>
                </div>
              </div>

              <div className="p-3 bg-amber-50/80 border border-amber-200 rounded-xl text-[11px] text-amber-900 font-medium space-y-1">
                <p className="font-bold flex items-center gap-1.5 text-amber-950">
                  <ShieldCheck className="w-3.5 h-3.5 text-amber-700" /> Regras da sua nova senha:
                </p>
                <ul className="list-disc pl-4 space-y-0.5 text-[10px] text-amber-800">
                  <li>Deve conter no mínimo 5 caracteres;</li>
                  <li>Não pode ser os 5 primeiros dígitos do seu CNPJ ou CPF ({String(activeCustomer.cpf || '').replace(/\D/g, '').slice(0, 5) || '*****'}).</li>
                </ul>
              </div>

              <button
                type="submit"
                disabled={changePassLoading || Boolean(changePassSuccess)}
                className="w-full py-4 text-white rounded-2xl font-black text-sm uppercase tracking-wider transition-all shadow-lg shadow-orange-500/25 flex items-center justify-center gap-2 cursor-pointer disabled:opacity-50 hover:brightness-105 active:scale-98"
                style={{ backgroundColor: storeInfo.themeColor || '#ea580c' }}
              >
                {changePassLoading ? (
                  <>
                    <RefreshCw className="w-4 h-4 animate-spin" />
                    <span>Salvando nova senha...</span>
                  </>
                ) : (
                  <>
                    <CheckCircle2 className="w-4 h-4" />
                    <span>Salvar Nova Senha e Continuar</span>
                  </>
                )}
              </button>

              <button
                type="button"
                onClick={() => {
                  if (confirm('Deseja realmente desconectar e sair?')) {
                    handleCustomerLogout();
                    setMustChangePasswordModal(false);
                  }
                }}
                className="w-full py-2.5 text-stone-400 hover:text-red-600 font-bold text-xs uppercase tracking-wider transition-colors cursor-pointer text-center"
              >
                Sair da conta / Desconectar
              </button>
            </form>
          </div>
        </div>
      )}
    </div>
  );
}
