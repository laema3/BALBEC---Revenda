import { useState, useEffect, useRef, useMemo, useCallback } from 'react';
import { useStore, OrderItem, Order, CustomerAddress } from '../store/useStore';
import { formatCurrency, formatCapitalized, expandAbbreviations } from '../lib/utils';
import { ShoppingCart, Plus, Minus, Trash2, ArrowLeft, ArrowRight, CheckCircle2, ChevronLeft, ChevronRight, Settings, Droplets, Search, X, Printer, User as UserIcon, RefreshCw, Store, Tv, BellRing, Clock, MapPin, KeyRound, ShieldAlert, ShieldCheck, LocateFixed, AlertTriangle, Navigation, UtensilsCrossed, QrCode, Scissors, UserCheck, CreditCard, Copy, Lock, UserPlus, LogIn, Sparkles } from 'lucide-react';
import { MotorcycleIcon } from '../components/MotorcycleIcon';
import { getCurrentPosition, calculateDistanceMeters, formatDistance } from '../utils/geolocation';
import { ProductImage } from '../components/ProductImage';
import { Link } from 'react-router-dom';
import { BakeryLoader } from '../components/BakeryLoader';
import { MaintenancePage } from '../components/MaintenancePage';
import { shouldExcludeProduct, isExcludedCategory, isAddonCategory, isAddonItem, EXCLUDED_CATEGORIES, normalizeText, cleanProductDescription, formatProductDescriptionWithCode, isSalgadoProduct } from '../constants';
import { getSmartProductImage } from '../utils/imageHelper';
import { printReceipt, printViaNetworkIp, getNetworkPrinterConfig, resolveItemCode, resolveAddonCode } from '../utils/printer';
import { sendNtfyNotification } from '../utils/ntfy';
import { safeStorage } from '../utils/storage';
import { AiAssistantFloatingButton } from '../components/AiAssistantFloatingButton';
import { getStoreCurrentStatus, parseWeeklySchedule, formatWeeklyScheduleSummary } from '../utils/scheduleHelper';
import { CustomerOrderTrackerModal } from '../components/CustomerOrderTrackerModal';

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
  const { categories, products, tables, orders, customers, storeInfo, placeOrder, saveCustomer, isInitialized, fetchData } = useStore();
  const [activeCategory, setActiveCategory] = useState<string>('');
  const [searchTerm, setSearchTerm] = useState('');
  const [isRefreshing, setIsRefreshing] = useState(false);
  const [productQuantities, setProductQuantities] = useState<Record<string, number>>({});

  useEffect(() => {
    fetchData();
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
  const [isCheckout, setIsCheckout] = useState(false);
  const [successCountdown, setSuccessCountdown] = useState<number>(15);
  const [deliveryCountdown, setDeliveryCountdown] = useState<number>(0);
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
  }, []);

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
    setCart([]);
    setIsCartOpen(false);
  }, [isTotemPath, activeCustomer]);

  // Timer na tela de conclusão / impressão do pedido (15s no totem, 45s no celular para dar tempo do cliente ir ao balcão)
  // Se for delivery, NÃO reseta automaticamente para dar tempo do cliente ver o QR code / rastrear
  useEffect(() => {
    if (!isSuccess) return;
    if (salesChannel === 'delivery') {
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
  }, [isSuccess, salesChannel, isTotemPath, handleResetForNewCustomer]);

  // Timer regressivo específico para Delivery (Contagem de tempo de entrega)
  useEffect(() => {
    if (!isSuccess || salesChannel !== 'delivery' || !lastPlacedOrder) {
      setDeliveryCountdown(0);
      return;
    }

    const estimatedMinutes = storeInfo.deliveryEstimatedTimeMax || 50;
    setDeliveryCountdown(estimatedMinutes * 60);

    const interval = setInterval(() => {
      setDeliveryCountdown((prev) => {
        if (prev <= 1) {
          clearInterval(interval);
          return 0;
        }
        return prev - 1;
      });
    }, 1000);

    return () => clearInterval(interval);
  }, [isSuccess, salesChannel, lastPlacedOrder, storeInfo.deliveryEstimatedTimeMax]);

  const formatCountdown = (seconds: number) => {
    const mins = Math.floor(seconds / 60);
    const secs = seconds % 60;
    return `${mins.toString().padStart(2, '0')}:${secs.toString().padStart(2, '0')}`;
  };


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

  // A exigência de QR Code é restrita ao consumo presencial em loja/mesa (nunca deve bloquear pedidos de Delivery ou Totem)
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
  const [paymentMode, setPaymentMode] = useState<'online' | 'delivery' | null>(null);
  const [paymentMethod, setPaymentMethod] = useState('');
  const [deliveryType, setDeliveryType] = useState<'pickup' | 'delivery'>('pickup');
  const [deliveryAddress, setDeliveryAddress] = useState('');
  const [selectedScheduleTime, setSelectedScheduleTime] = useState<string>('');
  const [showScheduleSelectionStep, setShowScheduleSelectionStep] = useState<boolean>(false);
  const [scheduleStepMode, setScheduleStepMode] = useState<'delivery' | 'pickup'>('delivery');
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
    copied?: boolean;
  } | null>(null);
  const [isVerifyingPix, setIsVerifyingPix] = useState(false);
  const [pixTimeRemaining, setPixTimeRemaining] = useState(900);

  const [activeCardPayment, setActiveCardPayment] = useState<{
    type: 'credit' | 'debit';
    amount: number;
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

  // Estados para Gestão de Dados do Cliente
  const [customerAddresses, setCustomerAddresses] = useState<CustomerAddress[]>([]);
  const [customerOrders, setCustomerOrders] = useState<any[]>([]);
  const [trackingOrderId, setTrackingOrderId] = useState<string | null>(null);

  // Pedido de delivery ativo mais recente para acompanhar rota e status
  const latestActiveDeliveryOrder = useMemo(() => {
    if (lastPlacedOrder && (lastPlacedOrder.type === 'delivery' || lastPlacedOrder.deliveryType === 'delivery') && lastPlacedOrder.status !== 'completed' && lastPlacedOrder.status !== 'cancelled') {
      return lastPlacedOrder;
    }
    const foundInCustomer = customerOrders.find((o: any) => 
      (o.type === 'delivery' || o.deliveryType === 'delivery') && 
      o.status !== 'completed' && 
      o.status !== 'cancelled'
    );
    return foundInCustomer || null;
  }, [lastPlacedOrder, customerOrders]);

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

  // Efeito para carregar dados do cliente logado e sincronizar META / Status
  useEffect(() => {
    if (activeCustomer?.id) {
      const fetchCustomerData = async () => {
        setIsLoadingCustomerData(true);
        try {
          const [addrRes, ordRes, profRes] = await Promise.all([
            fetch(`/api/db/customers/${activeCustomer.id}/addresses`),
            fetch(`/api/db/customers/${activeCustomer.id}/orders`),
            fetch(`/api/db/customer-profile/${activeCustomer.id}`)
          ]);
          if (addrRes.ok) {
            const addrs = await addrRes.json();
            setCustomerAddresses(addrs);
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
  }, [activeCustomer?.id]);

  // Cálculo em tempo real da META mensal do cliente logado
  const customerMonthlyGoalInfo = useMemo(() => {
    if (!activeCustomer) return { goal: 0, spent: 0, pct: 0, rawPct: 0, remaining: 0 };
    const cleanActiveCpf = String(activeCustomer.cpf || '').replace(/\D/g, '');
    const storeCustomer = (customers || []).find((c: any) =>
      c.id === activeCustomer.id ||
      (cleanActiveCpf && String(c.cpf || '').replace(/\D/g, '') === cleanActiveCpf)
    );
    const goal = Number(storeCustomer?.monthlyGoal ?? activeCustomer.monthlyGoal ?? 0) || 0;

    const now = new Date();
    const currentYear = now.getFullYear();
    const currentMonth = now.getMonth();
    const cleanActivePhone = String(activeCustomer.phone || '').replace(/\D/g, '');

    // Somar pedidos do mês atual na store + customerOrders (sem duplicar IDs)
    const seenOrderIds = new Set<string>();
    let calculatedSpent = 0;
    const allOrdersToScan = [...(orders || []), ...(customerOrders || [])];
    for (const o of allOrdersToScan) {
      if (!o || !o.id || seenOrderIds.has(o.id)) continue;
      if (o.status === 'cancelled') continue;
      const d = new Date(o.createdAt);
      if (isNaN(d.getTime()) || d.getFullYear() !== currentYear || d.getMonth() !== currentMonth) continue;
      const oCpf = String((o as any).customerCpf || '').replace(/\D/g, '');
      const oPhone = String(o.customerPhone || '').replace(/\D/g, '');
      const matchesCustomer =
        (o as any).customerId === activeCustomer.id ||
        (cleanActiveCpf && oCpf === cleanActiveCpf) ||
        (cleanActivePhone.length >= 8 && oPhone === cleanActivePhone);
      if (matchesCustomer) {
        seenOrderIds.add(o.id);
        calculatedSpent += Number(o.total) || 0;
      }
    }

    const spent = Math.max(calculatedSpent, Number(activeCustomer.currentMonthSpent || 0));
    const rawPct = goal > 0 ? (spent / goal) * 100 : 0;
    const pct = Math.min(100, Math.round(rawPct));
    const remaining = Math.max(0, goal - spent);
    return { goal, spent, pct, rawPct, remaining };
  }, [activeCustomer, customers, orders, customerOrders]);

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
    if (!activeCustomer?.id) return;

    try {
      const res = await fetch(`/api/db/customers/${activeCustomer.id}/addresses`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(addressFormData)
      });
      if (res.ok) {
        const data = await res.json();
        setCustomerAddresses(prev => [data.address, ...prev.filter(a => !data.address.isDefault || !a.isDefault)]);
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
      }
    } catch (err) {}
  };

  const handleDeleteAddress = async (id: string) => {
    if (!confirm('Deseja excluir este endereço?')) return;
    try {
      const res = await fetch(`/api/db/customers/addresses/${id}`, { method: 'DELETE' });
      if (res.ok) {
        setCustomerAddresses(prev => prev.filter(a => a.id !== id));
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
        setActiveCustomer(data.customer);
        safeStorage.setItem('balbec_logged_customer', JSON.stringify(data.customer));
        safeStorage.setItem('balbec_customer_name', data.customer.name || '');
        safeStorage.setItem('balbec_customer_phone', data.customer.phone || '');
        safeStorage.setItem('balbec_customer_cpf', data.customer.cpf || '');
        safeStorage.setSession('selected_sales_channel', 'instore');
        setCustomerName(data.customer.name || '');
        setCustomerPhone(data.customer.phone || '');
        setCustomerCpf(data.customer.cpf || '');
        if (storeInfo.deliveryScheduleEnabled && !selectedScheduleTime) {
          setScheduleStepMode('delivery');
          setShowScheduleSelectionStep(true);
        } else {
          setHasName(true);
          setHasChosenChannel(true);
        }
        setIsAuthModalOpen(false);
        setAuthIdentifier('');
        setAuthPassword('');
      } else {
        setAuthError(data.error || 'CNPJ/CPF ou senha inválidos.');
      }
    } catch (e) {
      setAuthError('Erro de conexão ao realizar login.');
    } finally {
      setAuthLoading(false);
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
  }>({
    isOpen: false,
    product: null,
    quantity: 1
  });
  
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
                 products.some(p => p.categoryId === c.id && p.isActive && !p.isAddon && !p.isFlavor && !isAddonItem(p, categories));
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

      const prodCat = p.categoryId ? catMap.get(p.categoryId) : undefined;
      const catMatchesChannel = !prodCat || (
        salesChannel === 'delivery'
          ? prodCat.availableForDelivery !== false
          : salesChannel === 'kiosk'
            ? prodCat.availableForKiosk !== false
            : prodCat.availableInStore !== false
      );
      if (!catMatchesChannel) return false;

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
      const catId = p.categoryId || 'sem-categoria';
      if (!map[catId]) {
        map[catId] = [];
      }
      map[catId].push(p);
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

  const addToCart = (product: any, addons: any[] = [], flavor: any = null, quantity: number = 1) => {
    setCart(prev => {
      const existing = prev.find(item => 
        item.productId === product.id && 
        JSON.stringify(item.addons) === JSON.stringify(addons) &&
        JSON.stringify(item.flavor) === JSON.stringify(flavor)
      );
      if (existing) {
        return prev.map(item => 
          (item.productId === product.id && JSON.stringify(item.addons) === JSON.stringify(addons) && JSON.stringify(item.flavor) === JSON.stringify(flavor))
            ? { ...item, quantity: item.quantity + quantity } 
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
        code: a.code || a.externalId || (products.find(p => p.id === a.productId)?.externalId) || ''
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
        addons: enrichedAddons, 
        flavor: enrichedFlavor 
      }];
    });
    setAddonModal({ isOpen: false, product: null, selectedAddons: [], selectedFlavor: null, availableAddons: [], availableFlavors: [] });
  };

  const initiateAddToCartWithQty = (product: any, qty: number = 1) => {
    if (!hasChosenChannel) {
      setHasChosenChannel(true);
      safeStorage.setSession('selected_sales_channel', salesChannel || 'delivery');
    }

    if (!canBuy || isAddonProduct(product)) {
      return;
    }

    if (isSalgadoProduct(product, categories)) {
      setFrozenModal({ isOpen: true, product, quantity: qty });
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
    
    addToCart(product, [], null, qty);
  };

  const initiateAddToCart = (product: any) => {
    initiateAddToCartWithQty(product, 1);
  };

  const updateQuantity = (productId: string, addons: any[] | undefined, flavor: any | undefined, delta: number) => {
    setCart(prev => prev.map(item => {
      if (item.productId === productId && JSON.stringify(item.addons) === JSON.stringify(addons) && JSON.stringify(item.flavor) === JSON.stringify(flavor)) {
        const newQuantity = Math.max(0, item.quantity + delta);
        return { ...item, quantity: newQuantity };
      }
      return item;
    }).filter(item => item.quantity > 0));
  };

  const subtotal = cart.reduce((sum, item) => {
    const addonsTotal = item.addons?.reduce((addonSum, addon) => addonSum + addon.price, 0) || 0;
    const flavorTotal = item.flavor?.price || 0;
    return sum + ((item.price + flavorTotal + addonsTotal) * item.quantity);
  }, 0);

  const isKioskMode = salesChannel === 'kiosk' || isTotemPath;
  const isTableOrder = Boolean((salesChannel === 'instore' || deliveryType === 'pickup') && selectedTableNumber !== null);
  const isDeliveryOrder = !isKioskMode && !isTableOrder && deliveryType === 'delivery';
  const showDeliveryFeatures = !isTotemPath && selectedTableNumber === null;

  const currentDeliveryFee = isDeliveryOrder ? deliveryFee : 0;
  const total = subtotal + currentDeliveryFee;

  // Validação de CEP para Delivery
  const isCustomerWithSavedAddress = Boolean(activeCustomer?.address || customerAddresses.length > 0);
  const isCepVerified = Boolean(
    safeStorage.getItem('balbec_delivery_cep_verified') === 'true' || 
    safeStorage.getSession('balbec_delivery_cep_verified') === 'true' ||
    isCustomerWithSavedAddress
  );
  const requireCepStep = Boolean(hasChosenChannel && salesChannel === 'delivery' && !isCepVerified && isCheckout);

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
          handlePaymentApproved('Pix (Online)', activePixPayment.paymentId);
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
  }, [activePixPayment]);

  const handleCheckPixManual = async () => {
    if (!activePixPayment || isVerifyingPix) return;
    setIsVerifyingPix(true);
    try {
      const checkRes = await fetch(`/api/mercadopago/check-status/${activePixPayment.paymentId}`);
      const checkData = await checkRes.json();
      if (checkData && checkData.approved) {
        handlePaymentApproved('Pix (Online)', activePixPayment.paymentId);
        return;
      }

      const confRes = await fetch(`/api/mercadopago/confirm-pix/${activePixPayment.paymentId}`, {
        method: 'POST'
      });
      const confData = await confRes.json();
      if (confData && confData.approved) {
        handlePaymentApproved('Pix (Online)', activePixPayment.paymentId);
      } else {
        alert('Aguardando compensação do Pix pelo sistema bancário. Se você já transferiu, aguarde alguns instantes que a confirmação é automática.');
      }
    } catch {
      alert('Erro ao verificar status do pagamento. Tente novamente.');
    } finally {
      setIsVerifyingPix(false);
    }
  };

  const handlePaymentApproved = async (method: string, paymentId?: string) => {
    setActivePixPayment(null);
    setActiveCardPayment(null);
    await executeFinalOrderPlacement(method, paymentId, 'approved');
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
          amount: total,
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
      const methodName = activeCardPayment.type === 'credit'
        ? `Cartão de Crédito (Online - ${brandName})`
        : `Cartão de Débito (Online - ${brandName})`;

      setActiveCardPayment(null);
      setIsProcessingCard(false);
      await executeFinalOrderPlacement(methodName, data.paymentId, 'approved');
    } catch (err: any) {
      setCardPaymentError('Falha ao processar pagamento com o cartão. Tente novamente.');
      setIsProcessingCard(false);
    }
  };

  const executeFinalOrderPlacement = async (
    confirmedPaymentMethod: string,
    confirmedPaymentId?: string,
    confirmedPaymentStatus: 'approved' | 'pending' = 'approved'
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

    const fullAddress = isDeliveryOrder 
      ? `${deliveryStreet}, ${deliveryNumber}${deliveryComplement ? ` (${deliveryComplement})` : ''} - ${deliveryNeighborhood}${deliveryReference ? ` [Ref: ${deliveryReference}]` : ''}`
      : undefined;

    try {
      const isTotemOrDineIn = isKioskMode || isTableOrder;
      const createdOrder = await placeOrder({
        items: cart,
        total,
        status: isTotemOrDineIn ? 'completed' : 'pending',
        deliveryStatus: isTotemOrDineIn ? 'delivered' : 'pending',
        type: isKioskMode ? 'kiosk' : isDeliveryOrder ? 'delivery' : (isTableOrder ? 'dine_in' : 'online'),
        paymentMethod: isKioskMode ? 'Balcão' : (isTableOrder ? 'No Caixa / Na Saída' : confirmedPaymentMethod),
        paymentStatus: confirmedPaymentStatus,
        paymentId: confirmedPaymentId,
        customerName: finalCustomerName,
        customerPhone: finalCustomerPhone,
        customerId: activeCustomer?.id,
        customerEmail: activeCustomer?.email || customerEmail.trim(),
        customerCpf: activeCustomer?.cpf || customerCpf.trim(),
        deliveryType: isKioskMode ? 'dine_in' : (isTableOrder ? 'dine_in' : deliveryType),
        deliveryAddress: fullAddress,
        deliveryCep: isDeliveryOrder ? deliveryCep.trim() : undefined,
        deliveryNeighborhood: isDeliveryOrder ? deliveryNeighborhood.trim() : undefined,
        deliveryFee: isDeliveryOrder ? deliveryFee : 0,
        tableNumber: isTableOrder ? String(selectedTableNumber) : undefined,
        tableId: isTableOrder ? `table-${selectedTableNumber}` : undefined,
        scheduledTime: selectedScheduleTime || undefined,
      });

      if (createdOrder) {
        setLastPlacedOrder(createdOrder);
        setCustomerOrders(prev => [createdOrder, ...prev]);
        setCart([]);
        safeStorage.removeItem('balbec_active_cart');

        // Persistir dados do cliente para futuros pedidos
        safeStorage.setItem('balbec_customer_name', finalCustomerName);
        safeStorage.setItem('balbec_customer_phone', finalCustomerPhone);
        if (isDeliveryOrder) {
          safeStorage.setItem('balbec_customer_email', customerEmail.trim());
          safeStorage.setItem('balbec_customer_cpf', customerCpf.trim());
          safeStorage.setItem('balbec_customer_cep', deliveryCep.trim());
          safeStorage.setItem('balbec_customer_street', deliveryStreet.trim());
          safeStorage.setItem('balbec_customer_number', deliveryNumber.trim());
          safeStorage.setItem('balbec_customer_complement', deliveryComplement.trim());
          safeStorage.setItem('balbec_customer_reference', deliveryReference.trim());
          safeStorage.setItem('balbec_customer_neighborhood', deliveryNeighborhood.trim());
          safeStorage.setItem('balbec_delivery_cep_verified', 'true');
        }

        // OPÇÃO A: Disparo automático de impressão na impressora térmica da loja (via TCP Socket de Rede)
        // Regra de Negócio BALBEC: Apenas pedidos concluídos imediatamente (Totem e Mesa) disparam impressão automática pelo frontend.
        // Pedidos de Delivery chegam pendentes e aguardam 3 minutos para impressão automática no servidor da cozinha.
        if (isTotemOrDineIn && (createdOrder.status === 'completed' || isKioskMode) && !isDeliveryOrder) {
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
          const itemsSummary = createdOrder.items.map(it => `${it.quantity}x ${it.name}`).join(', ');
          const typeLabel = isTableOrder 
            ? `🍽️ Consumo no Local (Mesa ${selectedTableNumber})` 
            : (createdOrder.deliveryType === 'delivery' ? '🛵 Entrega (Delivery)' : '🥡 Retirada/Balcão');

          sendNtfyNotification({
            enabled: storeInfo.ntfyEnabled !== false,
            topic: storeInfo.ntfyTopic || 'balbecrevenda_pedidos',
            title: `🔔 Novo Pedido #${String(createdOrder.id).slice(-4).padStart(4, '0')}${isTableOrder ? ` (Mesa ${selectedTableNumber})` : isKioskMode ? ' (Totem - Entregue)' : (createdOrder.customerName ? ` (${createdOrder.customerName})` : '')}`,
            message: `Total: ${formatCurrency(createdOrder.total)}\nItens: ${itemsSummary}\nPagamento: ${createdOrder.paymentMethod}\nTipo: ${typeLabel}${isKioskMode ? '\nStatus: Entregue (Totem Autoatendimento)' : ''}${createdOrder.deliveryAddress ? '\nEndereço: ' + createdOrder.deliveryAddress : ''}`,
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
      if (salesChannel === 'delivery' && !isDeliveryActive) {
        alert('Desculpe, os pedidos para Delivery estão pausados no momento pelo estabelecimento.');
        return;
      }
      alert(storeInfo.closedMessage || currentStatus.details || 'Desculpe, a loja está fechada ou o canal de atendimento selecionado está indisponível no momento.');
      return;
    }

    if (isDeliveryOrder) {
      if (!customerEmail.trim()) {
        alert('Por favor, informe seu E-mail.');
        return;
      }
      if (!customerCpf.trim()) {
        alert('Por favor, informe seu CPF.');
        return;
      }
      if (!deliveryCep.trim() || cepValidStatus !== 'valid') {
        alert('Por favor, informe um CEP válido e verifique a entrega para o seu bairro antes de prosseguir.');
        return;
      }
      if (!deliveryStreet.trim() || !deliveryNumber.trim()) {
        alert('Por favor, informe o endereço de entrega completo (Rua e Número).');
        return;
      }
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

    if (!paymentMethod) {
      alert('Por favor, selecione uma forma de pagamento (Online ou na Entrega) para continuar.');
      return;
    }

    // Pagamento Online: Pix, Crédito ou Débito
    const isPixOnline = paymentMethod === 'Pix (Online)' || paymentMethod === 'Pagamento Online (Pix MP)';
    const isCreditOnline = paymentMethod === 'Cartão de Crédito (Online)';
    const isDebitOnline = paymentMethod === 'Cartão de Débito (Online)';

    // REGRA DE NEGÓCIO: No Pagamento Online, o pedido NÃO pode ser enviado antes da aprovação!
    if (isPixOnline) {
      if (!storeInfo.mercadoPagoEnabled) {
        alert('O módulo de pagamento online está desativado pelo estabelecimento. Por favor, selecione uma opção de pagamento na entrega.');
        return;
      }
      setIsSendingOrder(true);
      try {
        const pixRes = await fetch('/api/mercadopago/create-pix', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            amount: total,
            description: `Pedido BALBEC #${Date.now().toString().slice(-4)}`,
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
          amount: total,
          copied: false
        });
        setPixTimeRemaining(900); // 15 minutos
      } catch (pixErr: any) {
        alert(pixErr.message || 'Erro ao gerar Pix online. Tente novamente ou selecione pagamento na entrega.');
      } finally {
        setIsSendingOrder(false);
      }
      return; // CRÍTICO: NÃO EXECUTA O PEDIDO AQUI! AGUARDA CONFIRMAÇÃO DO PIX!
    }

    if (isCreditOnline || isDebitOnline) {
      if (!storeInfo.mercadoPagoEnabled) {
        alert('O módulo de pagamento online está desativado pelo estabelecimento. Por favor, selecione uma opção de pagamento na entrega.');
        return;
      }
      // Abre o modal de cartão online para o cliente preencher dados com segurança
      setActiveCardPayment({
        type: isCreditOnline ? 'credit' : 'debit',
        amount: total
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

    // Pagamentos na Entrega (Pix na Entrega, Cartão na Entrega, Dinheiro)
    // Nos pagamentos na entrega, o pedido é enviado normalmente com status 'pending' para delivery
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

    return (
      <div id="success-order-screen" className="min-h-screen bg-stone-900 text-stone-100 flex flex-col items-center justify-start sm:justify-center p-2 sm:p-6 pt-2 sm:pt-6">
        <div className="bg-white text-stone-900 rounded-3xl shadow-2xl max-w-lg w-full overflow-hidden border border-stone-200 animate-in fade-in zoom-in duration-200 my-0 sm:my-auto">
          
          {/* Header de Sucesso */}
          <div className="bg-emerald-600 text-white p-4 sm:p-5 text-center flex flex-col items-center justify-center">
            <CheckCircle2 className="w-12 h-12 sm:w-14 sm:h-14 mb-1.5 animate-bounce" />
            <h2 className="text-xl sm:text-3xl font-black tracking-tight uppercase">PEDIDO REALIZADO!</h2>
            <p className="text-emerald-100 text-xs sm:text-sm font-medium">
              {isKioskMode ? 'Imprima seu comprovante e retire no balcão' : 'Recebemos seu pedido com sucesso!'}
            </p>
          </div>

          {/* Mensagem em destaque no Smartphone: Atenção prezado (CLIENTE). Aguarde ser chamado... */}
          {!isKioskMode && (
            <div id="order-attention-banner" className="p-4 sm:p-5 bg-gradient-to-br from-amber-500 via-orange-500 to-amber-600 text-white text-center border-b-2 border-orange-600 shadow-md">
              <div className="inline-flex items-center justify-center w-12 h-12 sm:w-14 sm:h-14 rounded-full bg-white text-orange-600 shadow-lg mb-2">
                <UserCheck className="w-7 h-7 sm:w-8 sm:h-8 stroke-[2.5]" />
              </div>
              <h3 className="text-lg sm:text-2xl font-black uppercase tracking-tight text-white drop-shadow-xs">
                Atenção prezado {clientNameDisplay || 'CLIENTE'}
              </h3>
              <div className="mt-2 bg-white/20 backdrop-blur-xs rounded-2xl p-3.5 sm:p-4 border border-white/25">
                <p className="text-sm sm:text-lg font-black text-white leading-snug">
                  {lastPlacedOrder?.type === 'delivery' 
                    ? 'Seu pedido para Delivery foi recebido e está PENDENTE no painel. Ele entrará em preparação para entrega pelo motoboy.' 
                    : 'Aguarde ser chamado pelo seu nome pelo atendente. O pedido ficará pronto no máximo em 10 minutos.'}
                </p>
              </div>
              <div className="mt-2.5 inline-flex items-center justify-center gap-1.5 bg-black/25 px-3 py-1 rounded-full text-xs font-bold text-amber-100 border border-white/10">
                <span>🖨️ Pedido #{orderNumber} {lastPlacedOrder?.type === 'delivery' ? 'enviado para produção de entrega!' : 'já impresso no balcão da loja!'}</span>
              </div>
            </div>
          )}

          {/* Confirmação de Pagamento Online Aprovado */}
          {lastPlacedOrder?.paymentMethod?.includes('Online') && (
            <div className="p-4 bg-emerald-50 border-b border-emerald-100 flex items-center justify-center gap-3 text-emerald-900">
              <div className="w-9 h-9 rounded-full bg-emerald-600 text-white flex items-center justify-center shadow-sm shrink-0">
                <CheckCircle2 className="w-5 h-5" />
              </div>
              <div className="text-left">
                <p className="text-xs font-black uppercase tracking-wider text-emerald-800">Pagamento Online Confirmado</p>
                <p className="text-sm font-bold text-emerald-950">{lastPlacedOrder.paymentMethod}</p>
                <p className="text-[10px] text-emerald-700">O pagamento foi aprovado com sucesso e o pedido já está liberado para a produção.</p>
              </div>
            </div>
          )}

          {/* Horário Agendado em Destaque */}
          {lastPlacedOrder?.scheduledTime && (
            <div className="p-4 bg-amber-50 border-b-2 border-amber-300 flex items-center justify-center gap-3 text-amber-950 animate-fadeIn">
              <div className="w-10 h-10 rounded-2xl bg-amber-500 text-white flex items-center justify-center shadow-xs shrink-0 text-xl">
                ⏰
              </div>
              <div className="text-left">
                <p className="text-[10px] font-black uppercase tracking-wider text-amber-800">Horário Agendado para o Pedido</p>
                <p className="text-base font-black text-amber-950 font-mono">{lastPlacedOrder.scheduledTime}</p>
                <p className="text-[11px] text-amber-800 font-medium">Preparo estimado em aprox. 40 minutos a partir deste horário, podendo ficar pronto ou entregue antes.</p>
              </div>
            </div>
          )}

          {/* Cronômetro e Acompanhamento ao Vivo de Entrega (Apenas para Delivery) */}
          {lastPlacedOrder?.type === 'delivery' && (
            <div className="p-5 sm:p-6 bg-gradient-to-b from-stone-50 to-orange-50/50 border-b border-stone-200 space-y-4">
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-3">
                  <div className="w-12 h-12 bg-orange-500 text-white rounded-2xl flex items-center justify-center shadow-md shadow-orange-500/30 animate-pulse">
                    <MotorcycleIcon className="w-7 h-7" />
                  </div>
                  <div>
                    <h4 className="text-sm font-black text-stone-900 uppercase tracking-tighter">Tempo Estimado de Entrega</h4>
                    <p className="text-2xl font-black text-orange-600 font-mono">
                      {storeInfo.deliveryEstimatedTimeMin || 35}-{storeInfo.deliveryEstimatedTimeMax || 50} min
                    </p>
                    {deliveryCountdown > 0 && (
                      <div className="mt-1 flex items-center gap-1.5 text-[10px] font-black text-orange-500 uppercase tracking-wider animate-pulse">
                        <Clock className="w-3 h-3" />
                        <span>Chega em aprox. {formatCountdown(deliveryCountdown)}</span>
                      </div>
                    )}
                  </div>
                </div>

                <div className="text-right">
                  <span className="text-[10px] font-black uppercase text-stone-400 block">Status ao Vivo</span>
                  <span className="inline-flex items-center gap-1.5 text-xs font-black text-emerald-700 bg-emerald-100 px-2.5 py-1 rounded-full border border-emerald-300">
                    <span className="w-1.5 h-1.5 rounded-full bg-emerald-500 animate-ping" />
                    <span>Conectado</span>
                  </span>
                </div>
              </div>

              {/* Botão de Destaque: Acompanhar Motoboy no Mapa ao Vivo */}
              <button
                type="button"
                onClick={() => setTrackingOrderId(lastPlacedOrder.id)}
                className="w-full py-4 px-4 bg-gradient-to-r from-emerald-600 via-teal-600 to-emerald-600 hover:from-emerald-700 hover:to-teal-700 active:scale-99 text-white rounded-2xl font-black text-sm uppercase tracking-wider flex items-center justify-center gap-2.5 shadow-xl shadow-emerald-600/30 transition-all cursor-pointer border border-emerald-400/50"
              >
                <Navigation className="w-5 h-5 animate-bounce" />
                <span>Acompanhar Rota do Motoboy no Mapa ao Vivo 📍</span>
              </button>

              <p className="text-[11px] text-center text-stone-500 font-medium leading-relaxed">
                Toque no botão acima para ver o mapa com o motoboy se deslocando em tempo real e o progresso em 5 etapas com aviso sonoro!
              </p>
            </div>
          )}

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
            const previewItems = Array.isArray(lastPlacedOrder.items)
              ? lastPlacedOrder.items
              : (typeof (lastPlacedOrder as any).items === 'string' ? JSON.parse((lastPlacedOrder as any).items || '[]') : []);

            const previewItemsSubtotal = previewItems.reduce((sum: number, it: any) => {
              const itPrice = ((Number(it.price) || 0) + (Number(it.flavor?.price) || 0) + (it.addons?.reduce((s: number, a: any) => s + (Number(a.price) || 0), 0) || 0));
              return sum + (itPrice * (Number(it.quantity) || 1));
            }, 0);

            const previewOrderTotal = Number(lastPlacedOrder.total) || 0;
            const previewDifferenceFee = Math.max(0, previewOrderTotal - previewItemsSubtotal);

            const previewIsDelivery = lastPlacedOrder.deliveryType === 'delivery' || 
              lastPlacedOrder.type === 'delivery' || 
              Boolean(lastPlacedOrder.deliveryAddress && String(lastPlacedOrder.deliveryAddress).trim().length > 0) ||
              Boolean((lastPlacedOrder as any).deliveryNeighborhood) ||
              (lastPlacedOrder.deliveryFee !== undefined && lastPlacedOrder.deliveryFee !== null && Number(lastPlacedOrder.deliveryFee) > 0) ||
              (previewDifferenceFee > 0.05 && !lastPlacedOrder.tableNumber && lastPlacedOrder.type !== 'kiosk');

            let previewDeliveryFee = 0;
            if (lastPlacedOrder.deliveryFee !== undefined && lastPlacedOrder.deliveryFee !== null && Number(lastPlacedOrder.deliveryFee) > 0) {
              previewDeliveryFee = Number(lastPlacedOrder.deliveryFee);
            } else if (previewDifferenceFee > 0.05) {
              previewDeliveryFee = previewDifferenceFee;
            }

            let previewCustomerText = 'CLIENTE: BALCÃO / RETIRADA';
            if (lastPlacedOrder.customerName && lastPlacedOrder.customerName.trim() !== '' && lastPlacedOrder.customerName.trim().toUpperCase() !== 'CLIENTE' && lastPlacedOrder.customerName.trim().toUpperCase() !== 'CLIENTE TOTEM') {
              previewCustomerText = `CLIENTE: ${lastPlacedOrder.customerName.trim().toUpperCase()}`;
            } else if (isKioskMode || lastPlacedOrder.type === 'kiosk') {
              previewCustomerText = 'CLIENTE: TOTEM / AUTOATENDIMENTO';
            } else if (lastPlacedOrder.tableNumber) {
              previewCustomerText = `CLIENTE: MESA ${lastPlacedOrder.tableNumber}`;
            } else if (previewIsDelivery) {
              previewCustomerText = 'CLIENTE: ENTREGA / DELIVERY';
            } else {
              previewCustomerText = 'CLIENTE: BALCÃO / RETIRADA';
            }

            return (
              <div className="p-4 sm:p-5 bg-stone-100 max-h-[34vh] overflow-y-auto border-b border-stone-200">
                <div className="bg-white p-4 rounded-xl shadow-xs border border-stone-300/70 font-mono text-xs text-stone-900 leading-relaxed max-w-sm mx-auto">
                  {/* TÍTULO BALBEC EM DESTAQUE (FUNDO PRETO / TEXTO BRANCO) */}
                  <div className="bg-black text-white p-2 text-center rounded-md font-black text-sm tracking-wider uppercase mb-2">
                    {storeInfo.name || 'BALBEC - REVENDA'}
                  </div>
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
                            <div className="text-[10px] pl-2 text-stone-600">
                              • Sabor: {item.flavor.name}
                              {resolveAddonCode(item.flavor) && (
                                <span className="font-mono font-bold text-white bg-black px-1 py-0.5 rounded text-[9px] ml-1">
                                  CÓD: {resolveAddonCode(item.flavor)}
                                </span>
                              )}
                            </div>
                          )}
                          {item.addons && item.addons.length > 0 && (
                            <div className="text-[10px] pl-2 text-stone-600 space-y-0.5 mt-0.5">
                              {item.addons.map((a: any, aIdx: number) => {
                                const aCode = resolveAddonCode(a);
                                return (
                                  <div key={aIdx}>
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

                  {/* BLOCO DA TAXA DE ENTREGA DESTACADO POR ESCRITO */}
                  {previewIsDelivery && (
                    <div className="space-y-1.5 my-2 text-xs">
                      <div className="flex justify-between items-center text-stone-700 font-bold">
                        <span>Subtotal dos Itens:</span>
                        <span>{formatCurrency(previewItemsSubtotal)}</span>
                      </div>
                      <div className="flex justify-between items-center font-black text-xs bg-black text-white p-2 rounded-md tracking-wide">
                        <span>🛵 TAXA DE ENTREGA:</span>
                        <span>{previewDeliveryFee > 0 ? formatCurrency(previewDeliveryFee) : 'GRÁTIS'}</span>
                      </div>
                    </div>
                  )}

                <div className="flex justify-between items-center font-black text-xs sm:text-sm">
                  <span>TOTAL :</span>
                  <span>{formatCurrency(lastPlacedOrder.total || 0)}</span>
                </div>

                <div className="text-center text-[10px] text-stone-600 mt-1">
                  Pagamento: <span className="font-bold text-stone-900">{lastPlacedOrder.paymentMethod || 'No Balcão'}</span>
                </div>

                <div className="text-center text-[9px] text-stone-400 mt-2">
                  {lastPlacedOrder.createdAt ? new Date(lastPlacedOrder.createdAt).toLocaleString('pt-BR') : new Date().toLocaleString('pt-BR')}
                </div>

                <div className="mt-3 pt-2 border-t border-dashed border-stone-400 text-left">
                  <div className="font-black text-[10px] uppercase tracking-wide text-stone-800">OUTROS PRODUTOS</div>
                  <div className="h-[5cm] min-h-[5cm]"></div>
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


          {/* Botões de Ação: Totem (Imprimir) vs Smartphone/Consumo na Loja (Finalizar Pedido) */}
          <div className="p-5 space-y-3 bg-white">
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

  if (isCheckout) {
    const isKioskMode = salesChannel === 'kiosk' || isTotemPath;
    const isTableOrder = Boolean((salesChannel === 'instore' || deliveryType === 'pickup') && selectedTableNumber !== null);

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
            <div className="bg-white rounded-xl shadow-sm p-4 space-y-4">
              {cart.map(item => (
                <div key={item.productId + JSON.stringify(item.addons) + JSON.stringify(item.flavor)} className="flex gap-4 items-center">
                  <div className="w-16 h-16 bg-stone-50 rounded-xl overflow-hidden shrink-0 border border-stone-100">
                    <ProductImage 
                      src={item.imageUrl} 
                      alt={item.name}
                      className="w-full h-full object-cover"
                    />
                  </div>
                  <div className="flex-1 flex justify-between items-center">
                    <div>
                      <span className="font-medium">{item.quantity}x</span> <span className="uppercase">{item.name}</span>
                      {item.description && (
                        <div className="text-xs text-red-600 italic font-medium mt-0.5">
                          {formatCapitalized(item.description)}
                        </div>
                      )}
                      {item.flavor && (
                        <div className="text-sm text-stone-500 uppercase">
                          Sabor: {item.flavor.name}
                          {resolveAddonCode(item.flavor) && (
                            <span className="font-mono font-bold text-stone-700 ml-1.5">[CÓD: {resolveAddonCode(item.flavor)}]</span>
                          )}
                        </div>
                      )}
                      {item.addons && item.addons.length > 0 && (
                        <div className="text-sm text-stone-500 uppercase space-y-0.5">
                          {item.addons.map((a, aIdx) => {
                            const aCode = a.externalId || a.code || resolveAddonCode(a);
                            return (
                              <div key={aIdx}>
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
                          setCart(prev => prev.filter(ci => !(ci.productId === item.productId && JSON.stringify(ci.addons) === JSON.stringify(item.addons) && JSON.stringify(ci.flavor) === JSON.stringify(item.flavor))));
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
              {isDeliveryOrder && (
                <div className="border-t pt-3 space-y-2 text-sm">
                  <div className="flex justify-between items-center text-stone-600 font-medium">
                    <span>Subtotal dos Itens:</span>
                    <span className="font-bold text-stone-900">{formatCurrency(subtotal)}</span>
                  </div>
                  <div className="flex justify-between items-center font-bold bg-orange-100/90 text-orange-950 p-2.5 rounded-xl border border-orange-200 shadow-xs">
                    <span className="flex items-center gap-1.5">
                      <span>🛵</span>
                      <span>Taxa de Entrega:</span>
                    </span>
                    <span className="text-base font-black text-orange-800">
                      {currentDeliveryFee === 0 ? 'Grátis 🎉' : formatCurrency(currentDeliveryFee)}
                    </span>
                  </div>
                </div>
              )}
              <div className="border-t pt-4 flex justify-between items-center text-xl font-black text-stone-900">
                <span>Total do Pedido</span>
                <span style={{ color: storeInfo.themeColor }}>{formatCurrency(total)}</span>
              </div>
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
                {/* Opções de Entrega (Apenas quando NÃO estiver em Consumo na Loja / Mesa) */}
                {!selectedTableNumber && (
                  <div>
                    <h2 className="text-xl font-bold mb-4">Opções de Entrega</h2>
                    <div className="flex gap-4 mb-6">
                      {isInStoreActive && (
                        <label className={`flex-1 flex items-center justify-center p-4 border rounded-xl cursor-pointer transition-colors ${deliveryType === 'pickup' ? 'border-orange-600 bg-orange-50 text-orange-700 font-bold' : 'border-stone-200 bg-white hover:bg-stone-50 font-medium'}`}>
                          <input type="radio" name="deliveryType" value="pickup" checked={deliveryType === 'pickup'} onChange={() => setDeliveryType('pickup')} className="hidden" />
                          <span>Retirada no Balcão</span>
                        </label>
                      )}
                      {isDeliveryActive && (
                        <label className={`flex-1 flex items-center justify-center p-4 border rounded-xl cursor-pointer transition-colors ${deliveryType === 'delivery' ? 'border-orange-600 bg-orange-50 text-orange-700 font-bold' : 'border-stone-200 bg-white hover:bg-stone-50 font-medium'}`}>
                          <input type="radio" name="deliveryType" value="delivery" checked={deliveryType === 'delivery'} onChange={() => setDeliveryType('delivery')} className="hidden" />
                          <span>Entrega (Delivery)</span>
                        </label>
                      )}
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
                                  O consumo na loja só é permitido para quem está a até {formatDistance(storeInfo.inStoreMaxRadiusMeters || 150)} do local. Por favor, mude para "Entrega (Delivery)" ou venha até a loja.
                                </p>
                              </div>
                            </div>
                            <div className="flex items-center gap-2">
                              <button
                                type="button"
                                onClick={() => setDeliveryType('delivery')}
                                className="px-3 py-1 bg-red-600 text-white rounded-lg font-bold text-[11px] hover:bg-red-700 transition-colors cursor-pointer"
                              >
                                Mudar para Entrega (Delivery)
                              </button>
                              <button
                                type="button"
                                onClick={() => verifyInStoreGps()}
                                className="px-2.5 py-1 bg-white border border-red-300 text-red-700 rounded-lg font-bold text-[11px] hover:bg-stone-50 transition-colors cursor-pointer"
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
                                  {gpsError || 'Não foi possível obter sua localização. Autorize a localização no navegador para confirmar que você está na loja, ou escolha "Entrega (Delivery)".'}
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
                              <button
                                type="button"
                                onClick={() => setDeliveryType('delivery')}
                                className="px-3 py-1.5 bg-white border border-stone-300 text-stone-700 rounded-lg font-bold text-xs hover:bg-stone-50 transition-colors cursor-pointer"
                              >
                                Mudar para Entrega
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

                <h2 className="text-xl font-bold mb-4 flex items-center gap-2 text-stone-800">
                  <UserIcon className="w-5 h-5 text-orange-600" />
                  {deliveryType === 'delivery' ? 'Identificação do Cliente & Entrega' : 'Identificação do Cliente (Preparo)'}
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
                    {deliveryType === 'delivery' && (
                      <div>
                        <label className="block text-sm font-medium text-stone-700 mb-1">E-mail *</label>
                        <input 
                          type="email" 
                          value={customerEmail} 
                          onChange={(e) => {
                            setCustomerEmail(e.target.value);
                            safeStorage.setItem('balbec_customer_email', e.target.value);
                          }}
                          className="w-full p-3 border border-stone-300 rounded-lg focus:ring-2 focus:ring-orange-500 bg-white"
                          placeholder="seu@email.com"
                          required
                        />

                      </div>
                    )}
                  </div>

                  {deliveryType === 'delivery' && (
                    <>
                      <div>
                        <label className="block text-sm font-medium text-stone-700 mb-1">CPF *</label>
                        <input 
                          type="text" 
                          value={customerCpf} 
                          onChange={(e) => {
                            setCustomerCpf(e.target.value);
                            safeStorage.setItem('balbec_customer_cpf', e.target.value);
                          }}
                          className="w-full p-3 border border-stone-300 rounded-lg focus:ring-2 focus:ring-orange-500 bg-white"
                          placeholder="000.000.000-00"
                          required
                        />

                      </div>
                      
                      {customerAddresses.length > 0 && (
                        <div className="bg-white p-3.5 rounded-xl border border-orange-200 space-y-2.5 shadow-sm">
                          <p className="text-[10px] font-black text-stone-500 uppercase tracking-widest mb-1 flex items-center gap-1.5">
                            <MapPin className="w-3.5 h-3.5 text-orange-600" /> Meus Endereços Salvos
                          </p>
                          <div className="flex gap-2.5 overflow-x-auto no-scrollbar pb-1">
                            {customerAddresses.map(addr => (
                              <button
                                key={addr.id}
                                type="button"
                                onClick={() => {
                                  setDeliveryStreet(addr.street);
                                  setDeliveryNumber(addr.number);
                                  setDeliveryComplement(addr.complement || '');
                                  setDeliveryNeighborhood(addr.neighborhood);
                                  setDeliveryCep(addr.cep);
                                  setDeliveryReference(addr.reference || '');
                                  handleCheckCep(addr.cep);
                                }}
                                className={`flex-shrink-0 px-3.5 py-2.5 border-2 rounded-2xl text-left transition-all max-w-[160px] ${deliveryCep === addr.cep && deliveryNumber === addr.number ? 'bg-orange-50 border-orange-500 ring-2 ring-orange-500/20' : 'bg-white border-stone-100 hover:border-orange-300'}`}
                              >
                                <p className="text-xs font-black text-stone-900 leading-none truncate mb-1">{addr.alias}</p>
                                <p className="text-[10px] text-stone-500 font-medium leading-tight line-clamp-1">{addr.street}, {addr.number}</p>
                                <p className="text-[9px] text-stone-400 mt-1 uppercase font-bold tracking-tighter">{addr.neighborhood}</p>
                              </button>
                            ))}
                          </div>
                          <p className="text-[9px] text-stone-400 font-medium italic">Clique em um endereço salvo para preencher automaticamente.</p>
                        </div>
                      )}

                      <div className="pt-3 border-t border-orange-200 space-y-3">
                        <div>
                          <label className="block text-sm font-bold text-stone-800 mb-1">CEP de Entrega *</label>
                          <div className="flex gap-2">
                            <input 
                              type="text" 
                              value={deliveryCep} 
                              onChange={handleCepChange}
                              onBlur={(e) => handleCheckCep(e.target.value)}
                              className="flex-1 p-3 border border-stone-300 rounded-lg focus:ring-2 focus:ring-orange-500 bg-white font-mono uppercase"
                              placeholder="00000-000"
                              required
                            />
                            <button
                              type="button"
                              onClick={() => handleCheckCep(deliveryCep)}
                              className="px-4 py-3 bg-stone-800 text-white rounded-lg font-bold text-xs hover:bg-stone-900 transition-colors cursor-pointer"
                            >
                              Verificar CEP
                            </button>
                          </div>
                        </div>

                        {cepValidStatus === 'checking' && (
                          <div className="text-xs text-stone-500 font-medium animate-pulse">Verificando atendimento para este CEP...</div>
                        )}

                        {cepValidStatus === 'valid' && (
                          <div className="p-3 bg-emerald-50 border border-emerald-200 rounded-xl text-xs font-bold text-emerald-900 flex items-center justify-between">
                            <span className="flex items-center gap-1.5">
                              <CheckCircle2 className="w-4 h-4 text-emerald-600" />
                              <span>Bairro: {deliveryNeighborhood} (Taxa de Entrega: {formatCurrency(deliveryFee)})</span>
                            </span>
                          </div>
                        )}

                        {cepValidStatus === 'invalid' && (
                          <div className="p-4 bg-red-50 border border-red-200 rounded-xl space-y-2">
                            <div className="text-xs font-bold text-red-800">
                              {cepErrorMessage}
                            </div>
                            <button
                              type="button"
                              onClick={() => {
                                setDeliveryType('pickup');
                                setDeliveryFee(0);
                              }}
                              className="text-xs font-black text-orange-600 underline cursor-pointer"
                            >
                              Clique aqui para alterar para Retirada no Balcão
                            </button>
                          </div>
                        )}

                        <div className="pt-3 border-t border-orange-200 space-y-3">
                          <div className="grid grid-cols-2 gap-3">
                            <div className="col-span-2">
                              <label className="block text-xs font-bold text-stone-700 mb-1">Rua / Logradouro *</label>
                              <input 
                                type="text" 
                                value={deliveryStreet} 
                                onChange={(e) => {
                                  setDeliveryStreet(e.target.value);
                                  safeStorage.setItem('balbec_customer_street', e.target.value);
                                }}
                                className="w-full p-2.5 border border-stone-300 rounded-lg focus:ring-2 focus:ring-orange-500 bg-white"
                                placeholder="Nome da Rua"
                                required
                              />
                            </div>
                            <div>
                              <label className="block text-xs font-bold text-stone-700 mb-1">Número *</label>
                              <input 
                                type="text" 
                                value={deliveryNumber} 
                                onChange={(e) => {
                                  setDeliveryNumber(e.target.value);
                                  safeStorage.setItem('balbec_customer_number', e.target.value);
                                }}
                                className="w-full p-2.5 border border-stone-300 rounded-lg focus:ring-2 focus:ring-orange-500 bg-white"
                                placeholder="123"
                                required
                              />
                            </div>
                            <div>
                              <label className="block text-xs font-bold text-stone-700 mb-1">Complemento</label>
                              <input 
                                type="text" 
                                value={deliveryComplement} 
                                onChange={(e) => {
                                  setDeliveryComplement(e.target.value);
                                  safeStorage.setItem('balbec_customer_complement', e.target.value);
                                }}
                                className="w-full p-2.5 border border-stone-300 rounded-lg focus:ring-2 focus:ring-orange-500 bg-white"
                                placeholder="Apto, Bloco..."
                              />
                            </div>
                            <div className="col-span-2">
                              <label className="block text-xs font-bold text-stone-700 mb-1">Ponto de Referência</label>
                              <input 
                                type="text" 
                                value={deliveryReference} 
                                onChange={(e) => {
                                  setDeliveryReference(e.target.value);
                                  safeStorage.setItem('balbec_customer_reference', e.target.value);
                                }}
                                className="w-full p-2.5 border border-stone-300 rounded-lg focus:ring-2 focus:ring-orange-500 bg-white"
                                placeholder="Próximo ao mercado..."
                              />
                            </div>
                          </div>
                        </div>

                      </div>
                    </>
                  )}

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
                          Criar senha para salvar sua conta e facilitar compras futuras (Delivery)
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
                            💡 Ao cadastrar sua senha, seus dados (Nome e WhatsApp) ficarão salvos. Em compras futuras com <strong>Entrega (Delivery)</strong>, você só precisará fazer login e informar seu endereço!
                          </p>
                        </div>
                      )}
                    </div>
                  )}
                </div>

                {/* Condições de Pagamento: Ocultadas para Atendimento de Mesas e Totem */}
                {!isTableOrder ? (
                  <div>
                    <div className="flex items-center justify-between mb-4">
                      <h2 className="text-xl font-bold flex items-center gap-2 text-stone-800">
                        <CreditCard className="w-5 h-5 text-orange-600" />
                        Forma de Pagamento
                      </h2>
                      {paymentMode !== null && (
                        <button
                          type="button"
                          onClick={() => {
                            setPaymentMode(null);
                            setPaymentMethod('');
                          }}
                          className="text-[10px] font-black text-orange-600 hover:text-orange-700 bg-orange-50 hover:bg-orange-100 px-2.5 py-1.5 rounded-xl border border-orange-200 transition-all flex items-center gap-1.5 cursor-pointer shadow-2xs uppercase tracking-wider"
                        >
                          <ArrowLeft className="w-3.5 h-3.5" />
                          <span>Voltar / Mudar</span>
                        </button>
                      )}
                    </div>
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
                    if (deliveryType === 'delivery') {
                      if (!deliveryStreet.trim()) {
                        alert('Por favor, informe a Rua/Logradouro para entrega.');
                        return;
                      }
                      if (!deliveryNumber.trim()) {
                        alert('Por favor, informe o Número do endereço para entrega.');
                        return;
                      }
                      if (!deliveryNeighborhood.trim()) {
                        alert('Por favor, informe o Bairro para entrega.');
                        return;
                      }
                    }

                    // Validações de presença para Consumo na Loja
                    if (deliveryType === 'pickup') {
                      if (storeInfo.inStoreGpsValidation) {
                        if (gpsStatus !== 'verified') {
                          const isGpsOk = await verifyInStoreGps();
                          if (!isGpsOk) {
                            alert('Não foi possível confirmar sua presença no local pelo GPS. Por favor, autorize sua localização ou selecione a opção "Entrega (Delivery)".');
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

                    handleCheckout();
                  }}
                  disabled={isSendingOrder}
                  className="w-full mt-8 py-4.5 px-6 bg-emerald-600 hover:bg-emerald-700 active:bg-emerald-800 text-white rounded-2xl font-black text-xl transition-all disabled:opacity-50 cursor-pointer shadow-xl shadow-emerald-600/30 flex items-center justify-center gap-3 select-none"
                >
                  <CheckCircle2 className="w-6 h-6" />
                  <span>
                    {isSendingOrder ? 'Processando...' : (
                      isTableOrder ? 'Confirmar Pedido da Mesa' : (
                        paymentMethod === 'Pix (Online)' || paymentMethod === 'Pagamento Online (Pix MP)' 
                          ? 'Ir para Pagamento Pix' 
                          : (paymentMethod.includes('Online') ? 'Pagar com Cartão Online' : 'Finalizar Pedido')
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
                <p className="text-[11px] font-bold text-emerald-800 uppercase tracking-wider">Valor do Pedido</p>
                <p className="text-3xl font-black text-emerald-950 font-mono mt-0.5">{formatCurrency(activePixPayment.amount)}</p>
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
                    if (confirm('Deseja cancelar a cobrança Pix e voltar para escolher outra forma de pagamento? Seus itens continuarão no carrinho.')) {
                      setActivePixPayment(null);
                    }
                  }}
                  className="w-full py-2.5 text-stone-500 hover:text-stone-800 text-xs font-bold transition-colors cursor-pointer text-center"
                >
                  ← Cancelar e Escolher Outra Forma de Pagamento
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
                    <p className="text-[11px] text-stone-500 font-semibold">Pagamento Seguro com Criptografia</p>
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
                <span className="text-[10px] font-black uppercase tracking-wider text-blue-700">Total a Pagar</span>
                <div className="text-2xl font-black text-blue-950 font-mono mt-0.5">{formatCurrency(activeCardPayment.amount)}</div>
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
                  onClick={() => setActiveCardPayment(null)}
                  disabled={isProcessingCard}
                  className="w-full py-2.5 text-stone-500 hover:text-stone-800 text-xs font-bold transition-colors cursor-pointer text-center"
                >
                  ← Voltar e Trocar Forma de Pagamento
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

  // Etapa de Agendamento de Horários (Delivery ou Retirada)
  if (showScheduleSelectionStep) {
    const rawSlots = storeInfo.deliveryScheduleSlots;
    let slots = ['08:00', '08:30', '09:00', '09:30', '10:00', '10:30', '11:00', '11:30', '12:00', '12:30', '13:00', '13:30', '14:00', '14:30', '15:00', '15:30', '16:00', '16:30', '17:00', '17:30', '18:00', '18:30', '19:00', '19:30'];
    if (Array.isArray(rawSlots) && rawSlots.length > 0) {
      slots = rawSlots;
    } else if (typeof rawSlots === 'string') {
      try {
        const p = JSON.parse(rawSlots);
        if (Array.isArray(p) && p.length > 0) slots = p;
      } catch (e) {}
    }

    // Cálculo de horários passados para desabilitar
    const now = new Date();
    const currentHours = now.getHours();
    const currentMinutes = now.getMinutes();
    const currentTimeInMinutes = (currentHours * 60) + currentMinutes;
    const preparationBuffer = 15; // 15 minutos de antecedência mínima para o horário de agendamento

    return (
      <div className="min-h-screen bg-[#f8f7f5] flex flex-col items-center justify-center p-4 sm:p-6 animate-fadeIn">
        <div className="bg-white p-6 sm:p-10 rounded-3xl shadow-xl max-w-lg w-full text-center border border-stone-200 relative overflow-hidden">
          <div className="absolute top-0 left-0 right-0 h-2 bg-gradient-to-r from-orange-500 to-amber-500"></div>

          <div className="w-16 h-16 mx-auto mb-4 bg-orange-100 text-orange-700 rounded-2xl flex items-center justify-center text-3xl shadow-xs border border-orange-200">
            ⏰
          </div>

          <h2 className="text-xl sm:text-2xl font-black text-stone-900 uppercase tracking-tight mb-1">
            {scheduleStepMode === 'delivery' ? 'Agende o Horário de Entrega' : 'Agende o Horário de Retirada'}
          </h2>
          <p className="text-stone-600 text-xs sm:text-sm mb-4">
            {scheduleStepMode === 'delivery' 
              ? 'Selecione o horário em que prefere receber o seu pedido' 
              : 'Selecione o horário em que virá retirar seu pedido no balcão'}
          </p>

          {/* Aviso importante sobre o tempo de preparo de 40 minutos */}
          <div className="p-4 bg-amber-50 border border-amber-300 rounded-2xl text-left text-xs text-amber-950 font-medium mb-5 flex items-start gap-3 shadow-xs">
            <span className="text-xl shrink-0">⏳</span>
            <div className="space-y-1">
              <strong className="block text-amber-900 font-bold uppercase text-[11px] tracking-wider">Tempo Estimado de Preparo</strong>
              <p className="leading-relaxed">
                Sempre que escolher um horário desses, o estabelecimento terá em média <strong>40 minutos para o preparo</strong>, podendo ficar pronto ou ser entregue antes.
              </p>
            </div>
          </div>

          {/* Grade de Horários */}
          <div className="space-y-3 text-left mb-6">
            <label className="block text-xs font-black text-stone-700 uppercase tracking-wider">
              Horários Disponíveis (Capacidade: 10 pedidos por bloco):
            </label>
            
            <div className="grid grid-cols-2 sm:grid-cols-3 gap-2.5 max-h-64 overflow-y-auto p-1 border border-stone-100 rounded-2xl bg-stone-50/50">
              <button
                type="button"
                onClick={() => setSelectedScheduleTime('')}
                className={`p-3 rounded-xl border text-xs font-bold transition-all cursor-pointer col-span-full text-center ${!selectedScheduleTime ? 'bg-orange-600 text-white border-orange-600 shadow-xs' : 'bg-white text-stone-700 border-stone-200 hover:bg-stone-100'}`}
              >
                ⚡ Imediato / Sem horário específico (Horário mais próximo)
              </button>

              {slots.map(slot => {
                const isSelected = selectedScheduleTime === slot;
                const [sh, sm] = slot.split(':').map(Number);
                const slotMinutes = (sh * 60) + sm;
                const isPast = slotMinutes <= (currentTimeInMinutes + preparationBuffer);
                const count = slotOrderCounts[slot] || 0;
                const isFull = count >= 10;
                const isDisabled = isPast || isFull;

                return (
                  <button
                    key={slot}
                    type="button"
                    disabled={isDisabled}
                    onClick={() => {
                      if (!isDisabled) setSelectedScheduleTime(slot);
                    }}
                    className={`p-3 rounded-xl border text-xs font-black transition-all flex flex-col items-center justify-center gap-1 ${
                      isDisabled 
                        ? 'bg-stone-100 text-stone-400 border-stone-200 cursor-not-allowed opacity-60' 
                        : isSelected 
                          ? 'bg-orange-600 text-white border-orange-600 shadow-xs scale-102 cursor-pointer' 
                          : 'bg-white text-stone-800 border-stone-200 hover:bg-orange-50 cursor-pointer'
                    }`}
                  >
                    <div className="flex items-center gap-1.5 font-mono text-sm">
                      <span>{isPast ? '❌' : isFull ? '🔒' : '🕐'}</span>
                      <span className={isDisabled ? 'line-through opacity-50' : ''}>{slot}</span>
                    </div>
                    <span className={`text-[9px] px-2 py-0.5 rounded-full uppercase font-black ${
                      isFull ? 'bg-red-100 text-red-700' : isPast ? 'bg-stone-200 text-stone-500' : 'bg-emerald-100 text-emerald-800'
                    }`}>
                      {isFull ? 'Lotado (10/10)' : isPast ? 'Encerrado' : `${10 - count} de 10 vagas`}
                    </span>
                  </button>
                );
              })}
            </div>
          </div>

          <button
            type="button"
            onClick={() => {
              setShowScheduleSelectionStep(false);
              if (scheduleStepMode === 'delivery') {
                safeStorage.setItem('balbec_delivery_cep_verified', 'true');
                safeStorage.setSession('selected_sales_channel', 'delivery');
                safeStorage.setSession('balbec_qr_validated', 'true');
                setIsQrValidated(true);
                setSalesChannel('delivery');
                setDeliveryType('delivery');
                setHasChosenChannel(true);
                setShowFormSuccess(true);
                setTimeout(() => {
                  setShowFormSuccess(false);
                  setHasName(true);
                }, 900);
              } else {
                safeStorage.setSession('selected_sales_channel', 'instore');
                setSalesChannel('instore');
                setDeliveryType('pickup');
                setHasChosenChannel(true);
                setHasName(true);
              }
            }}
            className="w-full py-4 text-white rounded-2xl font-black text-base transition-all hover:scale-[1.01] active:scale-[0.98] shadow-lg shadow-orange-600/25 cursor-pointer bg-orange-600 hover:bg-orange-700 flex items-center justify-center gap-2"
          >
            <span>{selectedScheduleTime ? `CONFIRMAR PARA ${selectedScheduleTime} E IR AO CARDÁPIO 🥖` : 'CONTINUAR PARA O CARDÁPIO 🥖'}</span>
          </button>
        </div>
      </div>
    );
  }


  // Se a loja estiver configurada em Modo de Manutenção
  // Modal de Perfil do Cliente (Endereços e Pedidos)
  const ProfileModal = () => {
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
                  onClick={() => {
                    if (confirm('Deseja realmente sair da sua conta?')) {
                      handleCustomerLogout();
                    }
                  }}
                  className="w-full py-4 border-2 border-red-100 text-red-600 rounded-2xl font-black text-xs uppercase tracking-widest hover:bg-red-50 transition-all flex items-center justify-center gap-2"
                >
                  <X className="w-4 h-4" />
                  Sair da Conta
                </button>
              </div>
            )}

            {profileView === 'addresses' && (
              <div className="space-y-4">
                {isEditingAddress ? (
                  <form onSubmit={handleSaveAddress} className="space-y-3 bg-stone-50 p-4 rounded-2xl border border-stone-200 animate-fadeIn">
                    <div className="flex items-center justify-between mb-2">
                      <h3 className="text-xs font-black text-stone-900 uppercase">Novo Endereço</h3>
                      <button type="button" onClick={() => setIsEditingAddress(null)} className="text-stone-400 hover:text-stone-600"><X className="w-4 h-4" /></button>
                    </div>
                    <div className="grid grid-cols-2 gap-3">
                      <div className="col-span-2">
                        <label className="text-[10px] font-black text-stone-500 uppercase">Identificação (ex: Casa, Trabalho)</label>
                        <input type="text" value={addressFormData.alias} onChange={e => setAddressFormData({...addressFormData, alias: e.target.value})} className="w-full p-2.5 border border-stone-200 rounded-xl text-sm font-bold" required />
                      </div>
                      <div className="col-span-2">
                        <label className="text-[10px] font-black text-stone-500 uppercase">CEP</label>
                        <input type="text" value={addressFormData.cep} onChange={e => setAddressFormData({...addressFormData, cep: e.target.value})} className="w-full p-2.5 border border-stone-200 rounded-xl text-sm font-bold" required />
                      </div>
                      <div className="col-span-2">
                        <label className="text-[10px] font-black text-stone-500 uppercase">Rua</label>
                        <input type="text" value={addressFormData.street} onChange={e => setAddressFormData({...addressFormData, street: e.target.value})} className="w-full p-2.5 border border-stone-200 rounded-xl text-sm font-bold" required />
                      </div>
                      <div>
                        <label className="text-[10px] font-black text-stone-500 uppercase">Número</label>
                        <input type="text" value={addressFormData.number} onChange={e => setAddressFormData({...addressFormData, number: e.target.value})} className="w-full p-2.5 border border-stone-200 rounded-xl text-sm font-bold" required />
                      </div>
                      <div>
                        <label className="text-[10px] font-black text-stone-500 uppercase">Bairro</label>
                        <input type="text" value={addressFormData.neighborhood} onChange={e => setAddressFormData({...addressFormData, neighborhood: e.target.value})} className="w-full p-2.5 border border-stone-200 rounded-xl text-sm font-bold" required />
                      </div>
                    </div>
                    <button type="submit" className="w-full py-3 bg-orange-600 text-white rounded-xl font-black text-xs uppercase tracking-wider shadow-lg shadow-orange-600/20">Salvar Endereço</button>
                  </form>
                ) : (
                  <>
                    <button 
                      onClick={() => {
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
                      className="w-full py-3 border-2 border-dashed border-stone-200 text-stone-500 hover:text-orange-600 hover:border-orange-200 rounded-2xl flex items-center justify-center gap-2 font-bold text-sm transition-all"
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
                              <button onClick={() => handleDeleteAddress(addr.id)} className="p-1.5 text-stone-300 hover:text-red-500 transition-colors">
                                <Trash2 className="w-4 h-4" />
                              </button>
                            </div>
                          </div>
                          <p className="text-[11px] text-stone-600 font-medium leading-relaxed">
                            {addr.street}, {addr.number} {addr.complement && `(${addr.complement})`}<br />
                            {addr.neighborhood} - {addr.cep}
                          </p>
                          <button 
                            onClick={() => {
                              setDeliveryStreet(addr.street);
                              setDeliveryNumber(addr.number);
                              setDeliveryComplement(addr.complement || '');
                              setDeliveryNeighborhood(addr.neighborhood);
                              setDeliveryCep(addr.cep);
                              setDeliveryReference(addr.reference || '');
                              alert(`Endereço "${addr.alias}" selecionado para o pedido atual!`);
                              setIsProfileModalOpen(false);
                            }}
                            className="mt-3 w-full py-2 bg-white border border-stone-200 text-stone-600 hover:text-orange-600 hover:border-orange-200 rounded-xl text-[10px] font-black uppercase tracking-wider transition-all"
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
                           order.status === 'in_transit' ? 'Em Entrega' :
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

                      <div className="pt-2 border-t border-stone-200 flex items-center justify-between">
                        <div className="text-stone-900 font-black text-sm">Total: {formatCurrency(order.total)}</div>
                        <button 
                          onClick={() => handleReorder(order)}
                          className="px-4 py-2 bg-stone-800 text-white rounded-xl text-[10px] font-black uppercase tracking-wider hover:bg-orange-600 transition-colors shadow-sm"
                        >
                          Repetir Pedido
                        </button>
                      </div>

                      {/* Rastreamento do Motoboy no Mapa e Status ao Vivo (Delivery) */}
                      {(order.deliveryType === 'delivery' || order.type === 'delivery') && (
                        <div className="bg-gradient-to-r from-emerald-50 via-teal-50 to-emerald-50 border border-emerald-300 p-3.5 rounded-2xl space-y-2.5">
                          <div className="flex items-center justify-between">
                            <div className="flex items-center gap-2">
                              <div className="w-8 h-8 rounded-xl bg-emerald-600 text-white flex items-center justify-center font-bold shadow-xs">
                                <MotorcycleIcon className="w-4 h-4 animate-pulse" />
                              </div>
                              <div>
                                <span className="text-xs font-black text-emerald-950 uppercase tracking-tight block">
                                  {order.status === 'out_for_delivery' || order.deliveryStatus === 'in_transit'
                                    ? '🛵 Motoboy a caminho!'
                                    : order.status === 'completed' || order.deliveryStatus === 'delivered'
                                    ? '✅ Pedido Entregue'
                                    : '📦 Pedido em Andamento'}
                                </span>
                                <span className="text-[10px] text-emerald-700 font-medium">
                                  {order.driverName ? `Entregador: ${order.driverName}` : 'Aguardando saída da loja'}
                                  {order.driverVehicle ? ` (${order.driverVehicle})` : ''}
                                </span>
                              </div>
                            </div>
                            <span className="w-2 h-2 rounded-full bg-emerald-500 animate-ping" />
                          </div>

                          <button 
                            type="button"
                            onClick={() => {
                              setIsProfileModalOpen(false);
                              setTrackingOrderId(order.id);
                            }}
                            className="w-full py-2.5 bg-emerald-600 hover:bg-emerald-700 active:scale-99 text-white rounded-xl text-[10px] font-black uppercase tracking-wider shadow-md shadow-emerald-600/20 flex items-center justify-center gap-2 transition-all cursor-pointer"
                          >
                            <Navigation className="w-3.5 h-3.5" />
                            <span>Rastrear Rota e Ver Status ao Vivo 📍</span>
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



  if (requireCepStep) {
    if (showFormSuccess) {
      return (
        <div className="min-h-screen bg-stone-900 flex flex-col items-center justify-center p-4">
          <div className="bg-white p-8 sm:p-10 rounded-3xl shadow-2xl max-w-md w-full text-center border border-stone-200 animate-in fade-in zoom-in duration-200">
            <div className="w-20 h-20 bg-emerald-100 rounded-full flex items-center justify-center mx-auto mb-6">
              <CheckCircle2 className="w-12 h-12 text-emerald-600 animate-bounce" />
            </div>
            <h2 className="text-2xl sm:text-3xl font-black text-stone-900 mb-2 uppercase tracking-tight">Região Confirmada!</h2>
            <p className="text-stone-600 font-medium text-sm sm:text-base">
              Seja bem-vindo(a), <strong className="text-orange-600">{customerName.split(' ')[0]}</strong>!<br />
              Abrindo o cardápio de entregas para você...
            </p>
          </div>
        </div>
      );
    }

    return (
      <div className="min-h-screen bg-[#f8f7f5] flex flex-col items-center justify-center p-4 sm:p-6">
        <div className="bg-white p-6 sm:p-10 rounded-3xl shadow-xl max-w-md w-full text-center border border-stone-200 relative overflow-hidden animate-fadeIn">
          {/* Barra de destaque superior */}
          <div className="absolute top-0 left-0 right-0 h-2 bg-gradient-to-r from-orange-500 to-amber-500"></div>

          {storeInfo.logoUrl ? (
            <img 
              src={storeInfo.logoUrl} 
              alt="Logo" 
              className="w-32 h-32 sm:w-40 sm:h-40 aspect-square mx-auto mb-4 object-cover rounded-full shadow-md border-2 border-stone-100"
              referrerPolicy="no-referrer"
            />
          ) : (
            <div className="w-16 h-16 mx-auto mb-4 bg-orange-100 text-orange-700 rounded-full flex items-center justify-center text-3xl shadow-xs border border-orange-200">
              🥖
            </div>
          )}

          {/* Indicador visual de Etapas (Apenas CEP) */}
          <div className="flex items-center justify-center gap-2 mb-4">
            <div className="flex items-center gap-1.5 px-3 py-1 rounded-full text-xs font-bold bg-emerald-100 text-emerald-800 border border-emerald-300">
              <CheckCircle2 className="w-3.5 h-3.5" />
              <span>Identificação</span>
            </div>
            <div className="w-4 h-0.5 bg-emerald-500"></div>
            <div className="flex items-center gap-1.5 px-3 py-1 rounded-full text-xs font-bold bg-orange-100 text-orange-800 border border-orange-300">
              <span>2</span>
              <span>Rota de Entrega (CEP)</span>
            </div>
          </div>

          {/* ETAPA DE VALIDAÇÃO DE CEP (Direta, pois a identificação já foi feita no passo anterior) */}
          <div className="space-y-4 animate-fadeIn">
            <div className="text-center">
                <div className="inline-flex items-center gap-1.5 px-3 py-1 bg-orange-100 text-orange-900 rounded-full text-xs font-black uppercase tracking-wider mb-2">
                  <MotorcycleIcon className="w-3.5 h-3.5 text-orange-600" />
                  <span>Rota de Entrega Delivery</span>
                </div>
                <h2 className="text-xl sm:text-2xl font-black text-stone-900 uppercase tracking-tight">
                  Qual é o seu CEP?
                </h2>
                <p className="text-stone-600 text-xs sm:text-sm mt-1">
                  Olá, <strong className="text-orange-600 font-bold">{customerName.split(' ')[0]}</strong>! Digite seu CEP para consultarmos se atendemos seu endereço de entrega.
                </p>
              </div>

              <form
                onSubmit={(e) => {
                  e.preventDefault();
                  handleCheckCep(deliveryCep);
                }}
                className="space-y-3 pt-1"
              >
                <div className="text-left">
                  <label className="block text-xs font-black text-stone-700 mb-1.5 uppercase tracking-wider">
                    CEP de Entrega *
                  </label>
                  <div className="flex gap-2">
                    <input 
                      type="text" 
                      value={deliveryCep}
                      onChange={handleCepChange}
                      placeholder="00000-000"
                      maxLength={9}
                      autoFocus
                      className="flex-1 p-3.5 bg-stone-50 border-2 border-stone-200 rounded-2xl focus:ring-2 focus:ring-orange-500 focus:border-orange-500 transition-all text-base sm:text-lg font-bold text-stone-900 placeholder:text-stone-400 font-mono text-center tracking-widest"
                      required
                    />
                    <button
                      type="submit"
                      disabled={isCheckingDeliveryCep || deliveryCep.replace(/\D/g, '').length < 8}
                      className="px-4 bg-stone-800 hover:bg-stone-900 disabled:opacity-40 text-white rounded-2xl font-bold text-xs sm:text-sm flex items-center justify-center gap-1.5 cursor-pointer transition-all"
                    >
                      {isCheckingDeliveryCep ? (
                        <RefreshCw className="w-4 h-4 animate-spin" />
                      ) : (
                        <Search className="w-4 h-4" />
                      )}
                      <span>Consultar</span>
                    </button>
                  </div>
                  <div className="flex justify-between items-center mt-1 px-1">
                    <p className="text-[11px] text-stone-400">Digite os 8 números do seu CEP</p>
                    <a 
                      href="https://buscacepinter.correios.com.br/app/endereco/index.php" 
                      target="_blank" 
                      rel="noopener noreferrer"
                      className="text-[11px] text-orange-600 hover:underline font-semibold"
                    >
                      Não sei meu CEP
                    </a>
                  </div>
                </div>

                {/* Status: Verificando */}
                {cepValidStatus === 'checking' && (
                  <div className="p-4 bg-amber-50 border border-amber-200 rounded-2xl flex items-center justify-center gap-2.5 text-amber-800 text-xs font-bold animate-pulse">
                    <RefreshCw className="w-4 h-4 animate-spin text-orange-600" />
                    <span>Consultando rotas de entrega para o CEP {deliveryCep}...</span>
                  </div>
                )}

                {/* Status: CEP ATENDIDO (Válido) */}
                {cepValidStatus === 'valid' && (
                  <div className="p-4 bg-emerald-50 border-2 border-emerald-300 rounded-2xl text-left space-y-3 animate-fadeIn">
                    <div className="flex items-center gap-2 text-emerald-800 font-black text-sm uppercase">
                      <CheckCircle2 className="w-5 h-5 text-emerald-600 shrink-0" />
                      <span>Ótima notícia! Atendemos sua região</span>
                    </div>
                    <div className="bg-white/80 p-3 rounded-xl border border-emerald-200 text-xs space-y-1 text-stone-700">
                      <p className="flex justify-between">
                        <span className="text-stone-500">Bairro atendido:</span>
                        <strong className="text-emerald-900 font-bold">{deliveryNeighborhood}</strong>
                      </p>
                      <p className="flex justify-between">
                        <span className="text-stone-500">Taxa de entrega:</span>
                        <strong className="text-emerald-900 font-bold">
                          {deliveryFee === 0 ? 'Entrega Grátis 🎉' : formatCurrency(deliveryFee)}
                        </strong>
                      </p>
                    </div>

                    <button
                      type="button"
                      onClick={() => {
                        if (storeInfo.deliveryScheduleEnabled) {
                          setScheduleStepMode('delivery');
                          setShowScheduleSelectionStep(true);
                        } else {
                          safeStorage.setItem('balbec_delivery_cep_verified', 'true');
                          safeStorage.setSession('selected_sales_channel', 'delivery');
                          safeStorage.setSession('balbec_qr_validated', 'true');
                          setIsQrValidated(true);
                          setSalesChannel('delivery');
                          setDeliveryType('delivery');
                          setHasChosenChannel(true);
                          setShowFormSuccess(true);
                          setTimeout(() => {
                            setShowFormSuccess(false);
                            setHasName(true);
                          }, 900);
                        }
                      }}
                      className="w-full py-4 text-white rounded-2xl font-black text-base transition-all hover:scale-[1.01] active:scale-[0.98] shadow-lg shadow-emerald-600/25 cursor-pointer bg-emerald-600 hover:bg-emerald-700 flex items-center justify-center gap-2"
                    >
                      <span>CONTINUAR PARA O CARDÁPIO 🥖</span>
                    </button>
                  </div>
                )}

                {/* Status: CEP NÃO ATENDIDO (Inválido / Fora da Rota) */}
                {cepValidStatus === 'invalid' && (
                  <div className="p-4 sm:p-5 bg-red-50 border-2 border-red-300 rounded-2xl text-center space-y-3 animate-fadeIn">
                    <div className="w-12 h-12 bg-red-100 rounded-full flex items-center justify-center mx-auto text-red-600">
                      <AlertTriangle className="w-6 h-6" />
                    </div>
                    
                    <div className="space-y-1">
                      <h3 className="text-sm sm:text-base font-black text-red-700 uppercase tracking-tight leading-snug">
                        INFELIZMENTE NÃO ATENDEMOS ESSA REGIÃO NO MOMENTO.
                      </h3>
                      <p className="text-xs text-red-700/80 leading-relaxed">
                        O CEP <strong>{deliveryCep}</strong> não faz parte da nossa rota de entregas atual.
                      </p>
                    </div>

                    <div className="pt-2 flex flex-col gap-2">
                      <button
                        type="button"
                        onClick={() => {
                          setDeliveryCep('');
                          setCepValidStatus('idle');
                          setCepErrorMessage('');
                        }}
                        className="w-full py-3 bg-red-600 hover:bg-red-700 text-white rounded-xl font-black text-xs uppercase tracking-wider transition-all cursor-pointer shadow-sm"
                      >
                        Digitar Outro CEP
                      </button>

                      {/* Opção alternativa amigável: Retirada no balcão da loja */}
                      {hasInStoreCategories && (
                        <button
                          type="button"
                          onClick={() => {
                            safeStorage.setSession('selected_sales_channel', 'instore');
                            setSalesChannel('instore');
                            setDeliveryType('pickup');
                            setHasChosenChannel(true);
                            setHasName(true);
                          }}
                          className="w-full py-2.5 bg-stone-100 hover:bg-stone-200 text-stone-800 rounded-xl font-bold text-xs transition-all cursor-pointer border border-stone-200"
                        >
                          🛍️ Desejo retirar no balcão da loja
                        </button>
                      )}
                    </div>
                  </div>
                )}
              </form>

          </div>
          
          <div className="mt-6 pt-5 border-t border-stone-100 flex flex-col gap-1 items-center">
            <p className="text-xs text-stone-400 uppercase font-bold tracking-widest mb-0.5">{storeInfo.name || 'BALBEC - REVENDA'}</p>
            {storeInfo.address && <p className="text-xs text-stone-500">{storeInfo.address}</p>}
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
        {/* Top Brown Bar */}
        <div className="h-8 shrink-0 w-full bg-[#5c4033]"></div>

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
                {salesChannel === 'delivery' ? (
                  <div className="flex items-center gap-2">
                    <span className={`inline-flex items-center gap-1.5 px-3 py-1 rounded-full font-bold text-xs ${
                      canBuy 
                        ? 'bg-emerald-500/20 text-emerald-300 border border-emerald-500/40' 
                        : 'bg-amber-500/20 text-amber-300 border border-amber-500/40'
                    }`}>
                      <span className={`w-2 h-2 rounded-full ${canBuy ? 'bg-emerald-400 animate-pulse' : 'bg-amber-400'}`}></span>
                      🛵 Delivery {canBuy ? '(Entrega em Domicílio)' : '(Apenas Visualização 👁️)'}
                    </span>
                    {deliveryNeighborhood && (
                      <span className="hidden sm:inline-flex items-center gap-1 px-2.5 py-0.5 rounded-full bg-stone-800 text-[11px] text-stone-300 border border-stone-700">
                        📍 {deliveryNeighborhood} {deliveryFee === 0 ? '• Frete Grátis' : `• Taxa: ${formatCurrency(deliveryFee)}`}
                      </span>
                    )}
                  </div>
                ) : salesChannel === 'kiosk' ? (
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
                        <>🛍️ RETIRADA {!canBuy && '(Apenas Visualização 👁️)'}</>
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

              {/* Botão Trocar Modalidade: oculto quando Delivery está desativado */}
              {isDeliveryActive && !isTotemPath && salesChannel !== 'kiosk' && !selectedTableNumber && (
                <div className="flex items-center gap-2">
                  <button
                    type="button"
                    onClick={() => {
                      setHasChosenChannel(false);
                      setInitialEntryChoice(null);
                      setShowChannelSelection(true);
                      safeStorage.removeSession('selected_sales_channel');
                    }}
                    className="px-2.5 py-1 bg-stone-800 hover:bg-stone-700 text-stone-200 hover:text-white rounded-lg text-xs font-bold border border-stone-700 cursor-pointer transition-colors flex items-center gap-1.5 shadow-2xs"
                    title="Trocar modalidade de atendimento (Delivery, Retirada)"
                  >
                    <RefreshCw className="w-3.5 h-3.5 text-orange-400" />
                    <span>Trocar Modalidade</span>
                  </button>
                </div>
              )}
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
                    : salesChannel === 'delivery' && !isDeliveryActive
                      ? 'O Delivery está pausado temporariamente no painel. Navegando em modo de apenas visualização.'
                      : `A modalidade ${salesChannel === 'delivery' ? 'Delivery' : salesChannel === 'kiosk' ? 'Autoatendimento (Totem)' : 'Retirada'} está em modo de apenas visualização.`}
            </span>
          </div>
        )}

        {/* Informational banner when store is manually forced open outside schedule */}
        {hasChosenChannel && canBuy && storeInfo.forceOpen && !currentStatus.isWithinSchedule && (
          <div className="bg-emerald-600 text-white font-bold text-xs py-2 px-4 text-center flex items-center justify-center gap-2 shadow-xs border-b border-emerald-700">
            <span>⚡ Abertura manual ativa no painel • Pedidos liberados</span>
          </div>
        )}

        {/* Modal Obrigatório de Seleção de Canal de Venda (Only shows when requested or forced) */}
        {isDeliveryActive && !hasChosenChannel && showChannelSelection && (
          <div className="fixed inset-0 z-[100] bg-stone-950/85 backdrop-blur-md flex items-center justify-center p-3 sm:p-6 overflow-y-auto">
            <div className="bg-white rounded-3xl max-w-3xl w-full p-4 sm:p-8 shadow-2xl border border-stone-100 space-y-4 sm:space-y-6 text-center transform transition-all animate-fadeIn my-auto max-h-[95vh] overflow-y-auto relative">
              
              {/* Close Button (X) to allow continuing browsing without choosing */}
              <button 
                onClick={() => setShowChannelSelection(false)}
                className="absolute top-4 right-4 p-2 bg-stone-100 hover:bg-stone-200 text-stone-600 rounded-full transition-colors cursor-pointer"
                title="Continuar apenas visualizando"
              >
                <X className="w-5 h-5" />
              </button>

              {/* Icon / Brand Avatar */}
              <div className="mx-auto w-14 h-14 sm:w-16 sm:h-16 bg-orange-100 border border-orange-200 rounded-2xl flex items-center justify-center text-2xl sm:text-3xl shadow-sm">
                🥐
              </div>

              <div className="space-y-1.5 sm:space-y-2">
                <h2 className="text-xl sm:text-3xl font-black text-stone-900 tracking-tight leading-tight">
                  Como deseja fazer seu pedido?
                </h2>
                <p className="text-stone-600 text-xs sm:text-sm font-medium leading-relaxed max-w-lg mx-auto">
                  Selecione onde você está ou como deseja ser atendido hoje:
                </p>
              </div>

              <div className="grid gap-4 pt-2 grid-cols-1 max-w-md mx-auto">
                {/* 2. Pickup Option (Retirada no Balcão) */}
                <button
                  type="button"
                  onClick={() => handleSelectChannel('instore')}
                  className="group relative flex flex-col items-center p-5 sm:p-6 bg-stone-50 hover:bg-amber-50/80 border-2 border-stone-200 hover:border-amber-500 rounded-2xl transition-all duration-200 text-left cursor-pointer hover:shadow-lg active:scale-98"
                >
                  <div className={`w-14 h-14 rounded-2xl flex items-center justify-center text-3xl mb-3 transition-colors shadow-sm ${
                    isInStoreActive && currentStatus.isOpenNow
                      ? 'bg-amber-100 group-hover:bg-amber-600 group-hover:text-white text-amber-800'
                      : 'bg-stone-200 text-stone-600'
                  }`}>
                    🛍️
                  </div>
                  <span className="font-extrabold text-stone-900 group-hover:text-amber-800 text-lg mb-1 text-center">
                    Retirada
                  </span>
                  <span className="text-xs text-stone-600 group-hover:text-stone-800 text-center leading-relaxed">
                    Faça seu pedido online e venha retirar aqui no balcão da loja quando estiver pronto.
                  </span>

                  <div className="mt-4 text-[11px] uppercase font-extrabold tracking-wider px-3 py-1 bg-amber-100 text-amber-900 border border-amber-200/80 rounded-full flex items-center gap-1.5">
                    <span>⚡</span>
                    <span>Retirada Ativa</span>
                  </div>
                </button>
              </div>

              <div className="pt-2 border-t border-stone-100">
                <p className="text-xs text-stone-600 font-medium leading-relaxed">
                  🥖 Bem-vindo à <strong>{storeInfo.name}</strong>! Escolha como deseja ser atendido hoje.
                </p>
              </div>
            </div>
          </div>
        )}

        {/* Categories Bar (Sticky sub-header on Top for All Devices) */}
        <div 
          ref={categoryBarRef}
          className="bg-white border-b border-stone-200 shrink-0 z-20 overflow-x-auto no-scrollbar scroll-smooth shadow-xs py-1.5 sm:py-2 px-2.5 sm:px-6"
        >
          <div className="flex gap-2 sm:gap-3 items-center relative max-w-4xl lg:max-w-7xl mx-auto">
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
              displayedCategories.map(category => {
                const categoryProducts = productsByCategory[category.id] || [];
                if (categoryProducts.length === 0) return null;

                return (
                  <div 
                    key={category.id} 
                    ref={el => { categoryRefs.current[category.id] = el; }}
                    className="mb-8 sm:mb-12 max-w-4xl lg:max-w-7xl mx-auto scroll-mt-4 md:scroll-mt-8"
                    style={{ contentVisibility: 'auto', containIntrinsicSize: '0 400px' }}
                  >
                    <div className="flex items-center gap-3 sm:gap-4 mb-4 sm:mb-8">
                      <h2 className="text-base sm:text-xl md:text-2xl font-black text-red-600 tracking-wider">{formatCapitalized(category.name)}</h2>
                      <div className="flex-1 h-px bg-stone-200"></div>
                      <span className="text-xs sm:text-sm font-bold text-stone-400 uppercase tracking-widest">{categoryProducts.length} {categoryProducts.length === 1 ? 'item' : 'itens'}</span>
                    </div>

                    <div className="grid grid-cols-1 lg:grid-cols-2 gap-3 sm:gap-6">
                      {categoryProducts.map(product => (
                        <div 
                          key={product.id} 
                          className="bg-white rounded-2xl sm:rounded-3xl border border-stone-200/90 p-3 sm:p-5 md:p-6 lg:p-5 flex gap-3 sm:gap-6 lg:gap-4 hover:shadow-xl hover:shadow-stone-200/50 transition-all group items-center"
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
                              <h3 className="text-sm sm:text-xl md:text-2xl lg:text-lg xl:text-xl font-black text-[#5c4033] leading-snug mb-1 tracking-tight line-clamp-2">
                                {formatCapitalized(product.name)}
                              </h3>
                              {(product.externalId || product.description) && (
                                <p className="text-xs sm:text-base lg:text-xs xl:text-sm text-red-600 line-clamp-2 sm:line-clamp-3 mb-2 leading-relaxed font-medium italic">
                                  {formatCapitalized(formatProductDescriptionWithCode(product.description, product.externalId))}
                                </p>
                              )}
                            </div>
                            
                            <div className="mt-auto pt-1 sm:pt-2 flex items-center justify-between gap-2 sm:gap-3">
                              <span className="text-base sm:text-2xl md:text-3xl lg:text-xl xl:text-2xl font-black text-orange-600">
                                {formatCurrency(product.price)}
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
                                  const cartItem = cart.find(ci => ci.productId === product.id && (!ci.addons || ci.addons.length === 0) && !ci.flavor);
                                  const inCartQty = cartItem?.quantity || 0;
                                  const currentQty = inCartQty > 0 ? inCartQty : (productQuantities[product.id] ?? 1);

                                  return (
                                    <div className="flex items-center gap-1 sm:gap-1.5 bg-stone-100 rounded-xl p-1">
                                      <button 
                                        type="button"
                                        onClick={() => {
                                          if (inCartQty > 0) {
                                            setCart(prev => prev.filter(ci => !(ci.productId === product.id && (!ci.addons || ci.addons.length === 0) && !ci.flavor)));
                                          }
                                          setProductQuantities(prev => ({
                                            ...prev,
                                            [product.id]: 1
                                          }));
                                        }}
                                        className="p-1 hover:bg-red-50 rounded-lg text-red-500 hover:text-red-700 transition-colors cursor-pointer"
                                        title={inCartQty > 0 ? "Excluir item do pedido" : "Zerar quantidade para 1"}
                                      >
                                        <Trash2 className="w-4 h-4 text-red-500" />
                                      </button>

                                      <button 
                                        type="button"
                                        onClick={() => {
                                          if (inCartQty > 0) {
                                            updateQuantity(product.id, cartItem?.addons, cartItem?.flavor, -1);
                                          } else {
                                            setProductQuantities(prev => ({
                                              ...prev,
                                              [product.id]: Math.max(1, (prev[product.id] ?? 1) - 1)
                                            }));
                                          }
                                        }}
                                        className="p-1 hover:bg-white rounded-lg text-stone-600 hover:text-stone-900 transition-colors cursor-pointer"
                                        title="Diminuir"
                                      >
                                        <Minus className="w-4 h-4" />
                                      </button>

                                      <input
                                        type="number"
                                        min="1"
                                        max="9999"
                                        value={currentQty}
                                        onChange={(e) => {
                                          const val = parseInt(e.target.value, 10);
                                          if (inCartQty > 0) {
                                            if (isNaN(val) || val <= 0) {
                                              setCart(prev => prev.filter(ci => !(ci.productId === product.id && (!ci.addons || ci.addons.length === 0) && !ci.flavor)));
                                            } else {
                                              const q = Math.max(1, val);
                                              setCart(prev => prev.map(ci => (ci.productId === product.id && (!ci.addons || ci.addons.length === 0) && !ci.flavor) ? { ...ci, quantity: q } : ci));
                                            }
                                          } else {
                                            setProductQuantities(prev => ({
                                              ...prev,
                                              [product.id]: isNaN(val) ? 1 : Math.max(1, val)
                                            }));
                                          }
                                        }}
                                        onKeyDown={(e) => {
                                          if (e.key === 'Enter') {
                                            if (inCartQty === 0) {
                                              const qty = productQuantities[product.id] ?? 1;
                                              initiateAddToCartWithQty(product, qty);
                                            }
                                          }
                                        }}
                                        className="font-black text-xs sm:text-sm w-11 sm:w-13 text-center py-1 rounded-lg bg-white text-stone-900 border border-stone-300 focus:ring-2 focus:ring-orange-500 focus:outline-none shadow-2xs font-mono"
                                        title="Digite a quantidade"
                                      />

                                      <button 
                                        type="button"
                                        onClick={() => {
                                          if (inCartQty > 0) {
                                            updateQuantity(product.id, cartItem?.addons, cartItem?.flavor, 1);
                                          } else {
                                            const qty = productQuantities[product.id] ?? 1;
                                            initiateAddToCartWithQty(product, qty);
                                          }
                                        }}
                                        className="p-1 hover:bg-white rounded-lg text-stone-600 hover:text-stone-900 transition-colors cursor-pointer"
                                        title={inCartQty > 0 ? "Aumentar" : "Adicionar ao pedido"}
                                      >
                                        <Plus className="w-4 h-4" />
                                      </button>
                                    </div>
                                  );
                                })()
                              )}
                            </div>
                          </div>
                        </div>
                      ))}
                    </div>
                  </div>
                );
              })
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
                {/* {showDeliveryFeatures && (
                  <Link to="/motoboy" className="text-stone-400 hover:text-emerald-500 transition-colors flex items-center gap-1.5 text-xs font-medium">
                    <MotorcycleIcon className="w-4 h-4 text-emerald-500" />
                    <span>Portal do Motoboy</span>
                  </Link>
                )} */}
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
      {/* Barra Flutuante de Pedido Delivery em Rota / Andamento */}
      {latestActiveDeliveryOrder && !trackingOrderId && !isSuccess && (
        <div className={`fixed ${!isCartOpen && cart.length > 0 ? 'bottom-20' : 'bottom-4'} left-4 right-4 z-40 max-w-lg mx-auto animate-in slide-in-from-bottom duration-300`}>
          <div 
            onClick={() => setTrackingOrderId(latestActiveDeliveryOrder.id)}
            className="bg-stone-900/95 backdrop-blur-md text-white p-3 sm:p-3.5 rounded-2xl shadow-2xl border-2 border-emerald-500 flex items-center justify-between gap-3 cursor-pointer hover:bg-stone-800 active:scale-98 transition-all"
          >
            <div className="flex items-center gap-3 min-w-0">
              <div className="w-10 h-10 bg-emerald-600 rounded-xl flex items-center justify-center font-bold text-white shrink-0 shadow-md animate-pulse">
                <MotorcycleIcon className="w-5 h-5" />
              </div>
              <div className="min-w-0">
                <div className="flex items-center gap-2">
                  <span className="text-[10px] font-black uppercase text-emerald-400">
                    Pedido #{String(latestActiveDeliveryOrder.id).slice(-4).padStart(4, '0')}
                  </span>
                  <span className="w-2 h-2 rounded-full bg-emerald-400 animate-ping" />
                </div>
                <div className="text-xs sm:text-sm font-black truncate text-stone-100">
                  {latestActiveDeliveryOrder.status === 'out_for_delivery' || latestActiveDeliveryOrder.deliveryStatus === 'in_transit'
                    ? '🛵 Motoboy a caminho! Toque para ver mapa'
                    : latestActiveDeliveryOrder.status === 'ready' || latestActiveDeliveryOrder.status === 'ready_for_delivery'
                    ? '📦 Pronto! Aguardando saída do motoboy'
                    : '🥟 Em preparo na loja'}
                </div>
              </div>
            </div>

            <button
              type="button"
              className="px-3.5 py-2 bg-emerald-600 hover:bg-emerald-500 text-white rounded-xl text-xs font-black uppercase tracking-wider shrink-0 shadow-md flex items-center gap-1.5 cursor-pointer"
            >
              <Navigation className="w-3.5 h-3.5" />
              <span>Ver Rota 📍</span>
            </button>
          </div>
        </div>
      )}

      {/* Sticky Bottom Red Checkout Bar (For All Screens: Mobile, Tablet & Desktop) */}
      {!isCartOpen && cart.length > 0 && !isCheckout && (
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
            cart.map(item => (
              <div key={item.productId + JSON.stringify(item.addons) + JSON.stringify(item.flavor)} className="bg-white p-4 rounded-2xl border border-stone-200 shadow-xs flex gap-4 items-center">
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
                    <span className="text-xs text-stone-400 font-medium">{formatCurrency(item.price + (item.flavor?.price || 0) + (item.addons?.reduce((sum, a) => sum + a.price, 0) || 0))} un</span>
                     <div className="flex items-center gap-1 sm:gap-1.5 bg-stone-100 rounded-xl p-1">
                      <button 
                        type="button"
                        onClick={() => {
                          setCart(prev => prev.filter(ci => !(ci.productId === item.productId && JSON.stringify(ci.addons) === JSON.stringify(item.addons) && JSON.stringify(ci.flavor) === JSON.stringify(item.flavor))));
                        }}
                        className="p-1 hover:bg-red-50 rounded-lg text-red-500 hover:text-red-700 transition-colors cursor-pointer"
                        title="Excluir item do pedido"
                      >
                        <Trash2 className="w-4 h-4 text-red-500" />
                      </button>
                      <button 
                        type="button"
                        onClick={() => updateQuantity(item.productId, item.addons, item.flavor, -1)}
                        className="p-1 hover:bg-white rounded-lg text-stone-600 hover:text-stone-900 transition-colors cursor-pointer"
                        title="Diminuir"
                      >
                        <Minus className="w-4 h-4" />
                      </button>
                      <input
                        type="number"
                        min="1"
                        max="9999"
                        value={item.quantity}
                        onChange={(e) => {
                          const val = parseInt(e.target.value, 10);
                          const q = isNaN(val) ? 1 : Math.max(1, val);
                          setCart(prev => prev.map(ci => (ci.productId === item.productId && JSON.stringify(ci.addons) === JSON.stringify(item.addons) && JSON.stringify(ci.flavor) === JSON.stringify(item.flavor)) ? { ...ci, quantity: q } : ci));
                        }}
                        className="font-black text-xs sm:text-sm w-11 sm:w-13 text-center py-1 rounded-lg bg-white text-stone-900 border border-stone-300 focus:ring-2 focus:ring-orange-500 focus:outline-none shadow-2xs font-mono"
                        title="Digite a quantidade diretamente"
                      />
                      <button 
                        type="button"
                        onClick={() => updateQuantity(item.productId, item.addons, item.flavor, 1)}
                        className="p-1 hover:bg-white rounded-lg text-stone-600 hover:text-stone-900 transition-colors cursor-pointer"
                        title="Aumentar"
                      >
                        <Plus className="w-4 h-4" />
                      </button>
                    </div>
                  </div>
                </div>
              </div>
            ))
          )}
        </div>

        {cart.length > 0 && (
          <div className="p-5 border-t border-stone-200 bg-stone-50 space-y-3 shrink-0">
            {isDeliveryOrder && (
              <div className="space-y-1.5 text-xs pb-1 border-b border-stone-200">
                <div className="flex justify-between items-center text-stone-600 font-medium">
                  <span>Subtotal itens:</span>
                  <span className="font-bold text-stone-800">{formatCurrency(subtotal)}</span>
                </div>
                <div className="flex justify-between items-center font-bold bg-orange-100 text-orange-950 px-2.5 py-1.5 rounded-lg border border-orange-200">
                  <span className="flex items-center gap-1">🛵 Taxa de Entrega:</span>
                  <span className="font-black text-orange-800">{currentDeliveryFee === 0 ? 'Grátis 🎉' : formatCurrency(currentDeliveryFee)}</span>
                </div>
              </div>
            )}
            <div className="flex justify-between items-center">
              <span className="text-sm font-bold text-stone-600">Total do Pedido</span>
              <span className="text-2xl font-black text-stone-900">{formatCurrency(total)}</span>
            </div>

            {/* Primary Finish Button */}
            <button 
              onClick={() => {
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

      {/* Modal de Opção de Salgado Congelado */}
      {frozenModal.isOpen && frozenModal.product && (
        <div className="fixed inset-0 z-[120] bg-stone-900/80 backdrop-blur-sm flex items-center justify-center p-4 animate-in fade-in duration-200">
          <div className="bg-white rounded-3xl max-w-md w-full p-6 shadow-2xl border border-stone-200 space-y-6">
            <div className="text-center space-y-2">
              <div className="w-16 h-16 bg-orange-100 rounded-2xl mx-auto flex items-center justify-center text-3xl shadow-inner">
                🥟
              </div>
              <h3 className="text-xl font-black text-stone-900 uppercase tracking-tight">Deseja o salgado congelado?</h3>
              <p className="text-xs font-bold text-orange-600 uppercase tracking-wide">
                {frozenModal.product.name} ({frozenModal.quantity}x)
              </p>
              <p className="text-xs text-stone-500 leading-relaxed px-2">
                Salgados congelados possuem um acréscimo unitário de <strong className="text-stone-800">
                  {formatCurrency( (() => {
                    const found = products.find(p => p.id === 'prod_congelado');
                    const pVal = found ? Number(found.price) : 0.30;
                    return (pVal > 0 && pVal < 2.0) ? pVal : 0.30;
                  })() )}
                </strong> por unidade.
              </p>
            </div>

            <div className="grid grid-cols-2 gap-3">
              <button
                type="button"
                onClick={() => {
                  const found = products.find(p => p.id === 'prod_congelado');
                  const pVal = found && found.price && found.price < 2.0 ? Number(found.price) : 0.30;
                  const congeladoProd = found || { id: 'prod_congelado', name: 'Salgado Congelado', price: 0.30 };
                  const frozenAddon = {
                    productId: congeladoProd.id,
                    name: 'Opção: Congelado',
                    price: pVal,
                    externalId: (congeladoProd as any).externalId || '9999'
                  };
                  addToCart(frozenModal.product, [frozenAddon], null, frozenModal.quantity);
                  setFrozenModal({ isOpen: false, product: null, quantity: 1 });
                }}
                className="py-4 px-4 bg-orange-600 hover:bg-orange-700 active:scale-95 text-white rounded-2xl font-black text-xs uppercase tracking-wider shadow-lg shadow-orange-600/20 transition-all flex flex-col items-center justify-center gap-1 cursor-pointer"
              >
                <span className="text-base">❄️ Sim, Congelado</span>
                <span className="text-[10px] opacity-90">+ {formatCurrency( (() => {
                  const found = products.find(p => p.id === 'prod_congelado');
                  const pVal = found && found.price && found.price < 2.0 ? Number(found.price) : 0.30;
                  return pVal * frozenModal.quantity;
                })() )}</span>
              </button>
              <button
                type="button"
                onClick={() => {
                  addToCart(frozenModal.product, [], null, frozenModal.quantity);
                  setFrozenModal({ isOpen: false, product: null, quantity: 1 });
                }}
                className="py-4 px-4 bg-stone-100 hover:bg-stone-200 active:scale-95 text-stone-700 rounded-2xl font-black text-xs uppercase tracking-wider transition-all flex flex-col items-center justify-center gap-1 border border-stone-200 cursor-pointer"
              >
                <span className="text-base">🔥 Não, Frito/Normal</span>
                <span className="text-[10px] text-stone-400">Preço padrão</span>
              </button>
            </div>

            <button
              type="button"
              onClick={() => setFrozenModal({ isOpen: false, product: null, quantity: 1 })}
              className="w-full py-2.5 text-stone-400 hover:text-stone-600 text-xs font-bold uppercase tracking-wider cursor-pointer"
            >
              Cancelar
            </button>
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
            for (let i = 0; i < qty; i++) {
              addToCart(product);
            }
          }}
          onOpenCart={() => setIsCartOpen(true)}
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

      {/* Modal de Rastreamento em Tempo Real do Motoboy no Mapa e Status ao Vivo (Estilo iFood) */}
      {trackingOrderId && (
        <CustomerOrderTrackerModal 
          orderId={trackingOrderId}
          onClose={() => setTrackingOrderId(null)}
        />
      )}
    </div>
  );
}
