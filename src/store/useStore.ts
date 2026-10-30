import { create } from 'zustand';
import { cleanProductDescription, getEnrichedProductDescription } from '../constants';
import { safeStorage } from '../utils/storage';

const CATALOG_CATEGORIES_CACHE_KEY = 'balbec_cached_categories_v3';
const CATALOG_PRODUCTS_CACHE_KEY = 'balbec_cached_products_v3';
const ORDERS_CACHE_KEY = 'balbec_cached_orders_v3';
const CUSTOMERS_CACHE_KEY = 'balbec_cached_customers_v3';

// Purge legacy caches once so old company data never resurfaces from browser storage
try {
  if (typeof window !== 'undefined' && localStorage.getItem('balbec_clean_slate_v1') !== 'done') {
    const keysToRemove = [
      'balbec_cached_categories_v1',
      'balbec_cached_categories_v2',
      'balbec_cached_categories_v3',
      'balbec_cached_products_v1',
      'balbec_cached_products_v2',
      'balbec_cached_products_v3',
      'balbec_cached_orders_v1',
      'balbec_cached_orders_v2',
      'balbec_cached_orders_v3',
      'balbec_tv_media',
      'balbec_tv_media_backup',
      'balbec_tv_selected_categories',
      'balbec_sync_logs',
      'bluefocus_start_carga_numero',
      'bluefocus_start_carga_sequencia',
      'bluefocus_start_produto_id',
    ];
    keysToRemove.forEach(k => {
      try { safeStorage.removeItem(k); } catch {}
      try { localStorage.removeItem(k); } catch {}
    });
    localStorage.setItem('balbec_clean_slate_v1', 'done');
  }
} catch {}

const getInitialCategories = (): Category[] => {
  try {
    const raw = safeStorage.getItem(CATALOG_CATEGORIES_CACHE_KEY);
    if (raw) {
      const parsed = JSON.parse(raw);
      if (Array.isArray(parsed)) return parsed;
    }
  } catch {}
  return [];
};

const saveCategoriesToStorage = (list: Category[]): void => {
  try {
    if (Array.isArray(list)) {
      safeStorage.setItem(CATALOG_CATEGORIES_CACHE_KEY, JSON.stringify(list));
    }
  } catch {}
};

const getInitialProducts = (): Product[] => {
  try {
    const raw = safeStorage.getItem(CATALOG_PRODUCTS_CACHE_KEY);
    if (raw) {
      const parsed = JSON.parse(raw);
      if (Array.isArray(parsed)) return parsed;
    }
  } catch {}
  return [];
};

const saveProductsToStorage = (list: Product[]): void => {
  try {
    if (Array.isArray(list)) {
      safeStorage.setItem(CATALOG_PRODUCTS_CACHE_KEY, JSON.stringify(list));
    }
  } catch {}
};

const getInitialOrders = (): Order[] => {
  try {
    const raw = safeStorage.getItem(ORDERS_CACHE_KEY);
    if (raw) {
      const parsed = JSON.parse(raw);
      if (Array.isArray(parsed)) return parsed;
    }
  } catch {}
  return [];
};

const saveOrdersToStorage = (list: Order[]): void => {
  try {
    if (Array.isArray(list)) {
      safeStorage.setItem(ORDERS_CACHE_KEY, JSON.stringify(list));
    }
  } catch {}
};

const getInitialCustomers = (): Customer[] => {
  try {
    const raw = safeStorage.getItem(CUSTOMERS_CACHE_KEY);
    if (raw) {
      const parsed = JSON.parse(raw);
      if (Array.isArray(parsed)) return parsed;
    }
  } catch {}
  return [];
};

const saveCustomersToStorage = (list: Customer[]): void => {
  try {
    if (Array.isArray(list)) {
      safeStorage.setItem(CUSTOMERS_CACHE_KEY, JSON.stringify(list));
    }
  } catch {}
};

export interface Category {
  id: string;
  name: string;
  order: number;
  externalId?: string;
  isVisible?: boolean;
  availableForDelivery?: boolean;
  availableInStore?: boolean;
  availableForKiosk?: boolean;
}

export interface User {
  id: string | number;
  uid?: string;
  name: string;
  email: string;
  password?: string;
  role: 'master' | 'admin' | 'padrao' | 'operator';
}

export interface Product {
  id: string;
  categoryId: string;
  name: string;
  description: string;
  price: number;
  imageUrl: string;
  isActive: boolean;
  isAddon?: boolean;
  isFlavor?: boolean;
  addonIds?: string[];
  maxAddons?: number;
  flavorIds?: string[];
  externalId?: string;
  order?: number;
  allowFrozen?: boolean;
  availableForDelivery?: boolean;
  availableInStore?: boolean;
  availableForKiosk?: boolean;
}

export interface OrderItem {
  productId: string;
  externalId?: string;
  code?: string;
  quantity: number;
  price: number;
  name: string;
  description?: string;
  imageUrl?: string;
  isFrozen?: boolean;
  options?: any[];
  addons?: { productId: string; name: string; price: number; externalId?: string; code?: string; isFrozen?: boolean }[];
  flavor?: { productId: string; name: string; price: number; externalId?: string; code?: string };
}

export interface DiningTable {
  id: string;
  number: number;
  name: string;
  section?: string;
  capacity?: number;
  status: 'available' | 'occupied' | 'reserved';
  isActive: boolean;
  createdAt: number;
}

export interface Order {
  id: string;
  items: OrderItem[];
  total: number;
  status: 'pending' | 'preparing' | 'ready' | 'ready_for_delivery' | 'ready_for_pickup' | 'out_for_delivery' | 'completed' | 'cancelled';
  createdAt: number;
  type: 'kiosk' | 'delivery' | 'online' | 'dine_in';
  paymentMethod: string;
  paymentStatus?: 'pending' | 'approved' | 'rejected';
  paymentId?: string;
  customerName: string;
  customerPhone?: string;
  customerId?: string;
  customerEmail?: string;
  customerCpf?: string;
  deliveryType?: 'pickup' | 'delivery' | 'dine_in';
  tableNumber?: string | number;
  tableId?: string;
  deliveryAddress?: string;
  deliveryCep?: string;
  deliveryNeighborhood?: string;
  deliveryFee?: number;
  deliveryStatus?: 'pending' | 'ready' | 'in_transit' | 'delivered' | 'cancelled';
  driverId?: string | null;
  driverName?: string | null;
  driverVehicle?: string | null;
  driverPhone?: string | null;
  driverCoords?: { lat: number; lng: number; heading?: number; speed?: number; updatedAt: number } | null;
  customerCoords?: { lat: number; lng: number } | null;
  deliveryAcceptedAt?: number | null;
  deliveryCompletedAt?: number | null;
  scheduledTime?: string;
  scheduledDate?: string;
  scheduledDay?: string;
  scheduledPickupTime?: string;
}

export interface TvMediaItem {
  id: string;
  title: string;
  type: 'video' | 'image' | 'youtube';
  url: string;
  durationSeconds?: number;
  order: number;
  showCaptions?: boolean;
  fitMode?: 'fit' | 'vertical_smartphone' | 'cover';
  isActive: boolean;
  createdAt?: string | Date;
}

export interface StoreInfo {
  name: string;
  themeColor: string;
  addButtonColor: string;
  iconColor: string;
  headerPhrase: string;
  logoUrl: string;
  address: string;
  hours: string;
  instagram: string;
  whatsapp: string;
  categoryTitleColor: string;
  deliveryEnabled: boolean;
  inStoreEnabled?: boolean;
  kioskEnabled?: boolean;
  requireQrCodeForOrdering?: boolean;
  isOpen: boolean;
  ntfyTopic?: string;
  ntfyEnabled?: boolean;
  tvTickerText?: string;
  tvMode?: 'fullscreen_media' | 'split_menu' | 'split_orders';
  tvSelectedCategories?: string[] | string;
  tvSoundEnabled?: boolean;
  tvShowClock?: boolean;
  tvShowCaptions?: boolean;
  isMaintenance?: boolean;
  maintenanceMessage?: string;
  weeklySchedule?: any; // DaySchedule[] or JSON string
  autoOpenClose?: boolean;
  forceOpen?: boolean;
  closedMessage?: string;
  aiAgentEnabled?: boolean;
  aiAgentName?: string;
  aiAgentTone?: string;
  aiAgentCustomPrompt?: string;
  aiAgentWhatsAppPhone?: string;
  aiAgentWhatsAppDefaultMessage?: string;
  aiAgentTrainingExamples?: string | AiTrainingExample[];
  aiAgentKnowledgeBase?: string;
  aiAgentForbiddenPhrases?: string;
  aiAgentCreativity?: number; // 0.2 to 0.9 (temperature)
  aiAgentAntiRepeat?: boolean;
  inStoreGpsValidation?: boolean;
  inStoreLatitude?: number;
  inStoreLongitude?: number;
  inStoreMaxRadiusMeters?: number;
  inStorePinValidation?: boolean;
  inStorePinCode?: string;
  preferredPrinterName?: string;
  printerCutMode?: 'partial' | 'full' | 'none';
  printerCopies?: number;
  totemPrinterCutMode?: 'partial' | 'full' | 'none';
  totemPrinterCopies?: number;
  totemPrinterBottomSpaceCm?: number;
  windowsPrinterCutMode?: 'partial' | 'full' | 'none';
  windowsPrinterCopies?: number;
  windowsPrinterBottomSpaceCm?: number;
  configuredPrinters?: PrinterItem[] | string;
  caixaPrinterName?: string;
  autoPrintOrdersOnCaixa?: boolean;
  printerConnectionType?: 'network' | 'windows' | 'usb';
  networkPrinterIp?: string;
  networkPrinterPort?: number;
  mercadoPagoEnabled?: boolean;
  mercadoPagoAccessToken?: string;
  mercadoPagoPublicKey?: string;
  mercadoPagoPixKey?: string;
  deliveryEstimatedTimeMin?: number;
  deliveryEstimatedTimeMax?: number;
  onlinePaymentEnabled?: boolean;
  onlinePaymentOperator?: 'mercadopago' | 'stripe' | 'pagseguro';
  onlinePaymentPublicKey?: string;
  onlinePaymentSecretKey?: string;
  deliveryScheduleEnabled?: boolean;
  deliveryScheduleSlots?: string[] | string;
  scheduleSlotItemCapacity?: number;
  schedulePrepTimeNormalMinutes?: number;
  schedulePrepTimeFrozenMinutes?: number;
  minOrderValue?: number;
  showSystemIntroButton?: boolean;
}

export interface PrinterItem {
  id: string;
  name: string;
  model: string;
  isOrderPrinter: boolean;
  ip?: string;
  port?: number;
}

export interface AiTrainingExample {
  id: string;
  question: string;
  answer: string;
  active?: boolean;
}

export const DEFAULT_AI_TRAINING_EXAMPLES: AiTrainingExample[] = [
  {
    id: 'ex_1',
    question: 'Vocês aceitam encomendas de bolos ou tortas?',
    answer: 'Sim! Aceitamos encomendas personalizadas de bolos, tortas e cento de salgados com pelo menos 24 horas de antecedência. Você pode solicitar direto pelo nosso WhatsApp.',
    active: true,
  },
  {
    id: 'ex_2',
    question: 'Qual o melhor horário para pegar pão francês quentinho?',
    answer: 'Nossas principais fornadas saem fresquinhas pela manhã às 06:30 e à tarde às 16:30, mas temos fornadas contínuas ao longo de todo o dia!',
    active: true,
  },
  {
    id: 'ex_3',
    question: 'Quais as formas de pagamento aceitas?',
    answer: 'Aceitamos PIX instantâneo, Cartões de Crédito, Cartões de Débito e Dinheiro (com opção de troco facilitado para entregas).',
    active: true,
  },
  {
    id: 'ex_4',
    question: 'Vocês fazem entrega em domicílio (delivery)?',
    answer: 'Sim! Entregamos tudo quentinho e bem embalado na sua casa ou trabalho. Basta escolher os itens e informar seu endereço.',
    active: true,
  },
];

export interface AppInstall {
  id: string;
  platform: string;
  browser: string;
  deviceType: string;
  installedAt: number;
  userAgent?: string;
}

export interface Customer {
  id: string;
  externalId?: string;
  name: string;
  phone: string;
  email?: string;
  cpf?: string;
  password?: string;
  address?: string;
  street?: string;
  number?: string;
  complement?: string;
  neighborhood?: string;
  cep?: string;
  source?: string;
  totalOrders: number;
  totalSpent: number;
  lastOrderAt?: number | null;
  createdAt: number;
  tags?: string[] | string;
  notes?: string;
  defaultAddressId?: string;
  status?: 'pending' | 'approved' | 'rejected';
  minOrderValue?: number;
  monthlyGoal?: number;
}

export interface CustomerAddress {
  id: string;
  customerId: string;
  alias: string;
  street: string;
  number: string;
  complement?: string;
  neighborhood: string;
  cep: string;
  reference?: string;
  isDefault: boolean;
  createdAt: number;
}

interface StoreState {
  categories: Category[];
  products: Product[];
  orders: Order[];
  tables: DiningTable[];
  customers: Customer[];
  users: User[];
  tvMediaList: TvMediaItem[];
  storeInfo: StoreInfo;
  appInstallsCount: number;
  appInstallsList: AppInstall[];
  ordersError: string | null;
  isOnline: boolean;
  isInitialized: boolean;
  
  // Setters
  setCategories: (categories: Category[]) => void;
  setProducts: (products: Product[]) => void;
  setOrders: (orders: Order[]) => void;
  setTables: (tables: DiningTable[]) => void;
  setCustomers: (customers: Customer[]) => void;
  setOrdersError: (error: string | null) => void;
  setUsers: (users: User[]) => void;
  setTvMediaList: (list: TvMediaItem[]) => void;
  setStoreInfo: (info: StoreInfo) => void;
  setIsOnline: (isOnline: boolean) => void;
  setIsInitialized: (isInitialized: boolean) => void;
  
  // Cloud SQL Data Load
  fetchData: () => Promise<void>;
  fetchOrdersOnly: () => Promise<void>;
  fetchTables: () => Promise<void>;
  fetchCustomers: () => Promise<void>;
  fetchAppInstalls: () => Promise<void>;
  recordAppInstall: (data?: Partial<AppInstall>) => Promise<void>;

  // Tables / Mesas Actions
  addTable: (table: Omit<DiningTable, 'id' | 'createdAt'>) => Promise<DiningTable | null>;
  addTablesBatch: (tables: Array<Omit<DiningTable, 'id' | 'createdAt'>>) => Promise<void>;
  updateTable: (id: string, table: Partial<DiningTable>) => Promise<void>;
  deleteTable: (id: string) => Promise<void>;

  // Actions (Cloud SQL PostgreSQL API)
  addCategory: (category: Omit<Category, 'id'>) => Promise<void>;
  updateCategory: (id: string, category: Partial<Category>) => Promise<void>;
  deleteCategory: (id: string) => Promise<void>;
  
  addProduct: (product: Omit<Product, 'id'>) => Promise<void>;
  updateProduct: (id: string, product: Partial<Product>) => Promise<void>;
  deleteProduct: (id: string) => Promise<void>;
  cleanAllProductDescriptions: () => Promise<{ success: boolean; count?: number }>;

  // Customer / Leads Actions
  saveCustomer: (customerData: Partial<Customer>) => Promise<Customer | null>;
  updateCustomer: (id: string, customerData: Partial<Customer>) => Promise<Customer | null>;
  deleteCustomer: (id: string) => Promise<boolean>;
  syncCustomersFromOrders: () => Promise<void>;
  
  addUser: (user: Omit<User, 'id'>, id?: string | number) => Promise<void>;
  updateUser: (id: string | number, user: Partial<User>) => Promise<void>;
  deleteUser: (id: string | number) => Promise<void>;
  
  // Smart TV Media Actions
  addTvMedia: (item: Omit<TvMediaItem, 'id'>) => Promise<void>;
  updateTvMedia: (id: string, item: Partial<TvMediaItem>) => Promise<void>;
  deleteTvMedia: (id: string) => Promise<void>;

  placeOrder: (order: Omit<Order, 'id' | 'createdAt' | 'status'> & { status?: Order['status']; deliveryStatus?: Order['deliveryStatus'] }) => Promise<Order>;
  updateOrderStatus: (id: string, status: Order['status']) => Promise<void>;
  deleteOrder: (id: string) => Promise<void>;
  clearAllOrders: () => Promise<void>;
  
  updateStoreInfo: (info: Partial<StoreInfo>) => Promise<void>;
  exportOrderToBlueFocus: (order: Order, config?: any) => Promise<void>;
  
  currentNotification: { id: string; title: string; message: string; type: 'info' | 'success' | 'warning' } | null;
  setCurrentNotification: (notif: { id: string; title: string; message: string; type: 'info' | 'success' | 'warning' } | null) => void;
}

export const defaultStoreInfo: StoreInfo = {
  name: 'BALBEC - REVENDA',
  themeColor: '#e6a800',
  addButtonColor: '#139f09',
  iconColor: '#e6a800',
  headerPhrase: 'Salgados Especiais e Revenda',
  logoUrl: '/logo.svg',
  address: 'Rua São Benedito',
  hours: 'Dom: 07:00 às 13:00 • Seg a Sáb: 06:00 às 20:00',
  instagram: '@balbecrevenda',
  whatsapp: '(34) 3338-3795',
  categoryTitleColor: '#dc2626',
  deliveryEnabled: false,
  inStoreEnabled: true,
  kioskEnabled: false,
  requireQrCodeForOrdering: false,
  isOpen: true,
  ntfyTopic: 'balbecrevenda_pedidos',
  ntfyEnabled: true,
  tvTickerText: '🥟 Salgados fresquinhos e crocantes para revenda e consumo! Peça pelo app ou no balcão!',
  tvMode: 'split_orders',
  tvSelectedCategories: [],
  tvSoundEnabled: false,
  tvShowClock: true,
  tvShowCaptions: false,
  isMaintenance: false,
  maintenanceMessage: 'Estamos atualizando nosso cardápio e sistemas para melhor atendê-lo. Voltaremos em breve!',
  weeklySchedule: JSON.stringify([
    { dayOfWeek: 0, dayName: 'Domingo', shortName: 'Dom', isOpen: true, openTime: '07:00', closeTime: '13:00' },
    { dayOfWeek: 1, dayName: 'Segunda-feira', shortName: 'Seg', isOpen: true, openTime: '06:00', closeTime: '20:00' },
    { dayOfWeek: 2, dayName: 'Terça-feira', shortName: 'Ter', isOpen: true, openTime: '06:00', closeTime: '20:00' },
    { dayOfWeek: 3, dayName: 'Quarta-feira', shortName: 'Qua', isOpen: true, openTime: '06:00', closeTime: '20:00' },
    { dayOfWeek: 4, dayName: 'Quinta-feira', shortName: 'Qui', isOpen: true, openTime: '06:00', closeTime: '20:00' },
    { dayOfWeek: 5, dayName: 'Sexta-feira', shortName: 'Sex', isOpen: true, openTime: '06:00', closeTime: '20:00' },
    { dayOfWeek: 6, dayName: 'Sábado', shortName: 'Sáb', isOpen: true, openTime: '06:00', closeTime: '20:00' },
  ]),
  autoOpenClose: true,
  forceOpen: true,
  closedMessage: 'Estamos fechados no momento. Confira nossos horários de atendimento!',
  aiAgentEnabled: false,
  aiAgentName: 'Balbec IA',
  aiAgentTone: 'amigavel',
  aiAgentCustomPrompt: 'Salgados fresquinhos para festa e revenda. Aceitamos encomendas pelo app e WhatsApp.',
  aiAgentWhatsAppPhone: '',
  aiAgentWhatsAppDefaultMessage: 'Olá! Vim pelo site da Balbec e gostaria de fazer um pedido.',
  aiAgentTrainingExamples: JSON.stringify(DEFAULT_AI_TRAINING_EXAMPLES),
  aiAgentKnowledgeBase: '• Variedades de salgados fritos e assados para revenda e eventos.\n• Encomendas devem ser feitas com antecedência pelo WhatsApp.\n• Não cobramos taxa de entrega para pedidos no mesmo bairro acima de R$ 50.',
  aiAgentForbiddenPhrases: 'Não prometa entrega em tempo menor que 30 minutos; Não prometa fiado ou cheque; Não invente produtos que não estejam no cardápio.',
  aiAgentCreativity: 0.65,
  aiAgentAntiRepeat: true,
  inStoreGpsValidation: false,
  inStoreLatitude: -19.7478,
  inStoreLongitude: -47.9392,
  inStoreMaxRadiusMeters: 150,
  inStorePinValidation: false,
  inStorePinCode: '1234',
  preferredPrinterName: 'HP LaserJet / Epson Padrão',
  printerCutMode: 'partial',
  printerCopies: 2,
  totemPrinterCutMode: 'partial',
  totemPrinterCopies: 2,
  totemPrinterBottomSpaceCm: 2.5,
  windowsPrinterCutMode: 'partial',
  windowsPrinterCopies: 2,
  windowsPrinterBottomSpaceCm: 8.0,
  configuredPrinters: [
    { id: 'p1', name: 'EPSON TM-T20X (Rede 192.168.0.90)', model: 'Epson Térmica 80mm (IP: 192.168.0.90)', isOrderPrinter: true, ip: '192.168.0.90' },
    { id: 'p2', name: 'Elgin i9 (Balcão / Ignorada para Pedidos)', model: 'Térmica 80mm (Ignorada)', isOrderPrinter: false }
  ],
  caixaPrinterName: 'EPSON TM-T20X (Rede 192.168.0.90)',
  autoPrintOrdersOnCaixa: false,
  printerConnectionType: 'network',
  networkPrinterIp: '192.168.0.90',
  networkPrinterPort: 9100,
  deliveryScheduleEnabled: true,
  deliveryScheduleSlots: ['09:30', '10:00', '10:30', '11:00', '11:30', '12:00', '12:30', '13:00', '13:30', '14:00', '14:30', '15:00', '15:30', '16:00', '16:30', '17:00', '17:30', '18:00', '18:30', '19:00', '19:30', '09:00'],
  scheduleSlotItemCapacity: 100,
  schedulePrepTimeNormalMinutes: 40,
  schedulePrepTimeFrozenMinutes: 90,
  minOrderValue: 150,
  showSystemIntroButton: false,
};

const getInitialStoreInfo = (): StoreInfo => {
  try {
    const saved = localStorage.getItem('balbec_store_info');
    let info = { ...defaultStoreInfo };
    if (saved) {
      const parsed = JSON.parse(saved);
      if (parsed && typeof parsed === 'object') {
        info = { 
          ...info, 
          ...parsed,
        };
      }
    }
    info.deliveryEnabled = false;
    info.kioskEnabled = false;
    info.requireQrCodeForOrdering = false;

    // Garantir que a impressora padrão oficial seja a EPSON com IP 192.168.0.90 e que a Elgin i9 seja ignorada
    if (!info.networkPrinterIp || info.networkPrinterIp === '192.168.1.200') {
      info.networkPrinterIp = '192.168.0.90';
    }
    if (!info.caixaPrinterName || /elgin/i.test(info.caixaPrinterName)) {
      info.caixaPrinterName = 'EPSON TM-T20X (Rede 192.168.0.90)';
    }
    if (!info.preferredPrinterName || /elgin/i.test(info.preferredPrinterName)) {
      info.preferredPrinterName = 'EPSON TM-T20X (Rede 192.168.0.90)';
    }
    if (info.configuredPrinters) {
      try {
        const parsedPrinters = typeof info.configuredPrinters === 'string' 
          ? JSON.parse(info.configuredPrinters) 
          : info.configuredPrinters;
        if (Array.isArray(parsedPrinters)) {
          const updated = parsedPrinters.map((p: any) => {
            if (/elgin/i.test(p.name || '')) {
              return { ...p, isOrderPrinter: false, name: 'Elgin i9 (Ignorada para Pedidos)' };
            }
            if (/epson/i.test(p.name || '')) {
              return { ...p, isOrderPrinter: true, ip: '192.168.0.90' };
            }
            return p;
          });
          const hasEpson = updated.some((p: any) => /epson/i.test(p.name || ''));
          if (!hasEpson) {
            updated.unshift({
              id: 'p_epson',
              name: 'EPSON TM-T20X (Rede 192.168.0.90)',
              model: 'Epson Térmica 80mm (IP: 192.168.0.90)',
              isOrderPrinter: true,
              ip: '192.168.0.90'
            });
          }
          info.configuredPrinters = updated;
        }
      } catch (e) {}
    }

    const savedCustomLogo = localStorage.getItem('balbec_custom_logo_url');
    if (savedCustomLogo && (!info.logoUrl || info.logoUrl === '/logo.svg')) {
      info.logoUrl = savedCustomLogo;
    }
    const savedTvCats = localStorage.getItem('balbec_tv_selected_categories');
    if (savedTvCats) {
      const isCatsEmpty = !info.tvSelectedCategories || 
        (Array.isArray(info.tvSelectedCategories) && info.tvSelectedCategories.length === 0) ||
        info.tvSelectedCategories === '[]';
      if (isCatsEmpty) {
        info.tvSelectedCategories = savedTvCats;
      }
    }
    return info;
  } catch (e) {}
  return defaultStoreInfo;
};

export const initialStoreInfo: StoreInfo = getInitialStoreInfo();

const saveStoreInfoToStorage = (info: StoreInfo) => {
  try {
    localStorage.setItem('balbec_store_info', JSON.stringify(info));
    if (info.logoUrl && info.logoUrl !== '/logo.svg' && info.logoUrl.trim() !== '') {
      localStorage.setItem('balbec_custom_logo_url', info.logoUrl);
    }
    if (info.tvSelectedCategories) {
      const isNotEmpty = Array.isArray(info.tvSelectedCategories) 
        ? info.tvSelectedCategories.length > 0
        : (info.tvSelectedCategories !== '[]' && info.tvSelectedCategories.trim() !== '');
      if (isNotEmpty) {
        const catsStr = typeof info.tvSelectedCategories === 'string'
          ? info.tvSelectedCategories
          : JSON.stringify(info.tvSelectedCategories);
        localStorage.setItem('balbec_tv_selected_categories', catsStr);
      }
    }
  } catch (e) {}
};

const getInitialTvMedia = (): TvMediaItem[] => {
  try {
    const savedBackup = localStorage.getItem('balbec_tv_media_backup');
    if (savedBackup) {
      const parsed = JSON.parse(savedBackup);
      if (Array.isArray(parsed) && parsed.length > 0) {
        return parsed.filter((item: any) => !item.url || !item.url.endsWith('...'));
      }
    }
    const saved = localStorage.getItem('balbec_tv_media');
    if (saved) {
      const parsed = JSON.parse(saved);
      if (Array.isArray(parsed) && parsed.length > 0) {
        // Filter out any corrupted entries with truncated URLs
        return parsed.filter((item: any) => !item.url || !item.url.endsWith('...'));
      }
    }
  } catch (e) {}
  return [];
};

const saveTvMediaToStorage = (list: TvMediaItem[]) => {
  try {
    localStorage.setItem('balbec_tv_media_backup', JSON.stringify(list));
    // For localStorage on mobile devices, avoid storing giant base64 data to prevent QuotaExceededError
    const lightList = list.map(item => {
      if (item.url && (item.url.startsWith('data:') || item.url.length > 200000)) {
        return { ...item, url: item.url.startsWith('data:') ? '[BASE64_DATA]' : item.url };
      }
      return item;
    });
    localStorage.setItem('balbec_tv_media', JSON.stringify(lightList));
  } catch (e) {
    try {
      localStorage.setItem('balbec_tv_media', JSON.stringify(list.map(i => ({ id: i.id, title: i.title, type: i.type, order: i.order, isActive: i.isActive }))));
    } catch (err) {}
  }
};

const safeParseResponse = async (res: Response | null): Promise<any | null> => {
  if (!res || !res.ok) return null;
  try {
    const contentType = res.headers.get('content-type');
    if (contentType && contentType.includes('application/json')) {
      return await res.json();
    }
    const text = await res.text();
    if (text && (text.startsWith('{') || text.startsWith('['))) {
      return JSON.parse(text);
    }
  } catch {
    // ignore parse error
  }
  return null;
};

const localHasCustomValues = (local: StoreInfo): boolean => {
  return Boolean(
    (local.whatsapp && local.whatsapp !== '' && local.whatsapp !== '(11) 99999-9999') ||
    (local.address && local.address !== '' && local.address !== 'Rua das Padarias, 123 - Centro') ||
    (local.name && local.name !== 'BALBEC - REVENDA') ||
    (local.aiAgentCustomPrompt && local.aiAgentCustomPrompt !== '') ||
    (local.weeklySchedule && local.weeklySchedule !== '[]' && local.weeklySchedule !== defaultStoreInfo.weeklySchedule)
  );
};

let activeFetchDataPromise: Promise<void> | null = null;

export const useStore = create<StoreState>((set, get) => ({
  categories: getInitialCategories(),
  products: getInitialProducts(),
  orders: getInitialOrders(),
  tables: [],
  customers: getInitialCustomers(),
  users: [],
  tvMediaList: getInitialTvMedia(),
  storeInfo: getInitialStoreInfo(),
  appInstallsCount: 0,
  appInstallsList: [],
  ordersError: null,
  isOnline: true,
  isInitialized: getInitialProducts().length > 0,
  currentNotification: null,
  
  setCategories: (categories) => set({ categories }),
  setProducts: (products) => set({ products }),
  setOrders: (orders) => {
    saveOrdersToStorage(orders);
    set({ orders, ordersError: null });
  },
  setTables: (tables) => set({ tables }),
  setCustomers: (customers) => {
    saveCustomersToStorage(customers);
    set({ customers });
  },
  setOrdersError: (error) => set({ ordersError: error }),
  setUsers: (users) => set({ users }),
  setTvMediaList: (tvMediaList) => {
    saveTvMediaToStorage(tvMediaList);
    set({ tvMediaList });
  },
  setIsOnline: (isOnline) => set({ isOnline }),
  setIsInitialized: (isInitialized) => set({ isInitialized }),
  setStoreInfo: (info) => set((state) => {
    const merged = { ...state.storeInfo, ...info };
    saveStoreInfoToStorage(merged);
    return { storeInfo: merged };
  }),
  setCurrentNotification: (currentNotification) => set({ currentNotification }),

  fetchData: async () => {
    if (activeFetchDataPromise) {
      return activeFetchDataPromise;
    }

    activeFetchDataPromise = (async () => {
      try {
        const fetchWithTimeout = (url: string, timeout = 6000) => {
          const controller = new AbortController();
          const id = setTimeout(() => controller.abort(), timeout);
          return fetch(url, { 
            signal: controller.signal,
            headers: {
              'Accept': 'application/json'
            }
          }).finally(() => clearTimeout(id));
        };

        // 1. Fetch Categories
        const pCat = fetchWithTimeout('/api/db/categories', 6000)
          .then(safeParseResponse)
          .then(async (categories) => {
            if (Array.isArray(categories)) {
              if (categories.length > 0) {
                saveCategoriesToStorage(categories);
                set({ categories });
              } else {
                const localCats = get().categories;
                if (Array.isArray(localCats) && localCats.length > 0) {
                  for (const cat of localCats) {
                    fetch('/api/db/categories', {
                      method: 'POST',
                      headers: { 'Content-Type': 'application/json' },
                      body: JSON.stringify(cat)
                    }).catch(() => {});
                  }
                }
              }
            }
          })
          .catch(() => {});

        // 2. Fetch Products
        const pProd = fetchWithTimeout('/api/db/products', 6000)
          .then(safeParseResponse)
          .then(async (rawProducts) => {
            if (Array.isArray(rawProducts)) {
              if (rawProducts.length > 0) {
                const products = rawProducts.map((p: any) => {
                  let availableForDelivery = p.availableForDelivery !== undefined ? Boolean(p.availableForDelivery) : true;
                  let availableInStore = p.availableInStore !== undefined ? Boolean(p.availableInStore) : true;
                  let availableForKiosk = p.availableForKiosk !== undefined ? Boolean(p.availableForKiosk) : true;

                  if (p.description && typeof p.description === 'string' && p.description.includes('[channels:')) {
                    const match = p.description.match(/\[channels:(.*?)\]/);
                    if (match) {
                      const channels = match[1].split(',');
                      availableForDelivery = channels.includes('delivery');
                      availableInStore = channels.includes('in_store');
                      availableForKiosk = channels.includes('kiosk');
                    }
                  }

                  return {
                    ...p,
                    description: getEnrichedProductDescription(p.name, p.externalId, p.description),
                    availableForDelivery,
                    availableInStore,
                    availableForKiosk,
                  };
                });
                saveProductsToStorage(products);
                set({ products, isInitialized: true });
              } else {
                const localProds = get().products;
                if (Array.isArray(localProds) && localProds.length > 0) {
                  for (let i = 0; i < localProds.length; i += 50) {
                    const chunk = localProds.slice(i, i + 50);
                    fetch('/api/db/products/batch', {
                      method: 'POST',
                      headers: { 'Content-Type': 'application/json' },
                      body: JSON.stringify(chunk)
                    }).catch(() => {});
                  }
                }
                set({ isInitialized: true });
              }
            } else {
              set({ isInitialized: true });
            }
          })
          .catch(() => {
            set({ isInitialized: true });
          });

        // 3. Fetch Store Info
        const pStore = fetchWithTimeout('/api/db/store-info', 6000)
          .then(safeParseResponse)
          .then(storeInfo => {
            if (storeInfo) {
              set(state => {
                const local = state.storeInfo;
                const merged: StoreInfo = {
                  ...defaultStoreInfo,
                  ...local,
                  ...storeInfo,
                  deliveryEnabled: false,
                  kioskEnabled: false,
                  requireQrCodeForOrdering: false,
                };

                if (!storeInfo.whatsapp && local.whatsapp) merged.whatsapp = local.whatsapp;
                if (!storeInfo.address && local.address) merged.address = local.address;
                if (!storeInfo.hours && local.hours) merged.hours = local.hours;
                if (!storeInfo.instagram && local.instagram) merged.instagram = local.instagram;
                if (local.weeklySchedule && local.weeklySchedule !== '[]' && local.weeklySchedule !== defaultStoreInfo.weeklySchedule) {
                  merged.weeklySchedule = local.weeklySchedule;
                }
                if (local.aiAgentCustomPrompt) merged.aiAgentCustomPrompt = local.aiAgentCustomPrompt;
                if (local.aiAgentKnowledgeBase) merged.aiAgentKnowledgeBase = local.aiAgentKnowledgeBase;
                if (local.aiAgentWhatsAppPhone) merged.aiAgentWhatsAppPhone = local.aiAgentWhatsAppPhone;
                if (local.aiAgentName) merged.aiAgentName = local.aiAgentName;
                if (local.aiAgentTone) merged.aiAgentTone = local.aiAgentTone;
                if (local.aiAgentTrainingExamples) merged.aiAgentTrainingExamples = local.aiAgentTrainingExamples;

                const customLogo = localStorage.getItem('balbec_custom_logo_url') || local.logoUrl;
                if (customLogo && customLogo !== '/logo.svg') {
                  merged.logoUrl = customLogo;
                }

                const customTvCats = localStorage.getItem('balbec_tv_selected_categories') || local.tvSelectedCategories;
                if (customTvCats && customTvCats !== '[]') {
                  merged.tvSelectedCategories = customTvCats;
                }

                saveStoreInfoToStorage(merged);

                return { storeInfo: merged };
              });
            }
          })
          .catch(() => {});

        // 4. Fetch Tables
        const pTables = fetchWithTimeout('/api/db/tables', 6000)
          .then(safeParseResponse)
          .then(rawTables => {
            if (Array.isArray(rawTables)) {
              set({ tables: rawTables });
            }
          })
          .catch(() => {});

        // 5. Fetch Orders
        const pOrders = fetchWithTimeout('/api/db/orders', 6000)
          .then(safeParseResponse)
          .then(ordersData => {
            if (Array.isArray(ordersData)) {
              const orders = ordersData.map((o: any) => ({
                ...o,
                status: o.status || ((o.type === 'delivery' || o.type === 'online' || o.deliveryType === 'delivery' || o.deliveryType === 'pickup') ? 'pending' : 'completed'),
                items: typeof o.items === 'string' ? JSON.parse(o.items) : o.items
              }));
              saveOrdersToStorage(orders);
              set({ orders, ordersError: null });
            }
          })
          .catch(() => {
            const cached = getInitialOrders();
            if (cached.length > 0) {
              set({ orders: cached });
            }
          });

        const isAdminRoute = typeof window !== 'undefined' && window.location.pathname.startsWith('/admin');
        const isTvOrOperationRoute = typeof window !== 'undefined' && (
          window.location.pathname.startsWith('/tv') ||
          window.location.pathname.startsWith('/caixa') ||
          window.location.pathname.startsWith('/balcao') ||
          window.location.pathname.startsWith('/pedidos')
        );

        let secondaryPromises: Promise<any>[] = [];
        
        // Somente o Admin precisa da lista completa de clientes, instalacões e usuários do sistema
        if (isAdminRoute) {
          const pUsers = fetchWithTimeout('/api/db/users', 7000)
            .then(safeParseResponse)
            .then(users => {
              if (Array.isArray(users)) set({ users });
            })
            .catch(() => {});

          const pInst = fetchWithTimeout('/api/db/app-installs', 7000)
            .then(safeParseResponse)
            .then(instData => {
              if (instData && typeof instData === 'object') {
                const count = typeof instData.count === 'number' ? instData.count : (Array.isArray(instData.installs) ? instData.installs.length : 0);
                const list = Array.isArray(instData.installs) ? instData.installs : [];
                set({ appInstallsCount: count, appInstallsList: list });
              }
            })
            .catch(() => {});

          const pCust = fetchWithTimeout('/api/db/customers', 9000)
            .then(safeParseResponse)
            .then(rawCust => {
              if (Array.isArray(rawCust)) {
                const customers: Customer[] = rawCust.map((c: any) => ({
                  ...c,
                  tags: Array.isArray(c.tags) ? c.tags : (typeof c.tags === 'string' ? JSON.parse(c.tags || '[]') : [])
                }));
                const currentCusts = get().customers || getInitialCustomers();
                if (customers.length > 0 || currentCusts.length === 0) {
                  saveCustomersToStorage(customers);
                  set({ customers });
                } else if (currentCusts.length > 0) {
                  // Auto-restaurar clientes em cache para o servidor/banco caso tenha zerado no deploy
                  (async () => {
                    const chunkSize = 50;
                    for (let i = 0; i < currentCusts.length; i += chunkSize) {
                      const chunk = currentCusts.slice(i, i + chunkSize);
                      await fetch('/api/db/customers/batch', {
                        method: 'POST',
                        headers: { 'Content-Type': 'application/json' },
                        body: JSON.stringify({ customers: chunk })
                      }).catch(() => {});
                    }
                  })();
                }
              }
            })
            .catch(() => {});
          
          secondaryPromises.push(pUsers, pInst, pCust);
        }

        // TV e Operação precisam apenas das mídias e informações básicas, nunca dos dados de clientes
        if (isAdminRoute || isTvOrOperationRoute) {
          const pTv = fetchWithTimeout('/api/db/tv-media', 10000)
            .then(safeParseResponse)
            .then(rawTvMedia => {
              if (Array.isArray(rawTvMedia)) {
                const fetchedList: TvMediaItem[] = rawTvMedia.map((m: any) => ({
                  id: String(m.id),
                  title: String(m.title || 'Vídeo Smart TV'),
                  type: m.type || (m.url?.includes('youtube') || m.url?.includes('youtu.be') ? 'youtube' : 'video'),
                  url: String(m.url || ''),
                  durationSeconds: Number(m.durationSeconds ?? m.duration_seconds ?? 15),
                  order: Number(m.order ?? 0),
                  showCaptions: m.showCaptions !== undefined ? Boolean(m.showCaptions) : (m.show_captions !== undefined ? Boolean(m.show_captions) : false),
                  fitMode: (m.fitMode || m.fit_mode || (m.url?.includes('/shorts/') ? 'vertical_smartphone' : 'fit')) as any,
                  isActive: m.isActive !== undefined ? Boolean(m.isActive) : (m.is_active !== undefined ? Boolean(m.is_active) : true),
                  createdAt: m.createdAt || m.created_at
                }));

                const currentMemory = get().tvMediaList || getInitialTvMedia() || [];
                if (fetchedList.length > 0 || currentMemory.length === 0) {
                  const finalTvMediaList = fetchedList.map(serverItem => {
                    const memItem = currentMemory.find(m => String(m.id) === String(serverItem.id));
                    // Preserve local URL only if server returns a placeholder for large media
                    if (memItem && memItem.url && (!serverItem.url || serverItem.url === '[LARGE_MEDIA]' || serverItem.url === '[BASE64_DATA]' || serverItem.url === '[URL_TRUNCATED]')) {
                      return { ...serverItem, url: memItem.url };
                    }
                    return serverItem;
                  });
                  
                  if (finalTvMediaList.length > 0 || fetchedList.length === 0) {
                    saveTvMediaToStorage(finalTvMediaList);
                    set({ tvMediaList: finalTvMediaList });
                  }
                } else if (fetchedList.length === 0 && currentMemory.length > 0) {
                  // Se o servidor retornou lista vazia e tínhamos algo, atualizamos para vazio (deleção total)
                  saveTvMediaToStorage([]);
                  set({ tvMediaList: [] });
                }
              }
            })
            .catch(() => {});
          
          secondaryPromises.push(pTv);
        }

        // Use Promise.allSettled so that a slow or failing endpoint NEVER blocks the app or TV display
        await Promise.allSettled([pCat, pProd, pStore, pTables, pOrders, ...secondaryPromises]);
        set({ isOnline: true, isInitialized: true });
      } catch {
        set({ isInitialized: true });
      } finally {
        activeFetchDataPromise = null;
      }
    })();

  return activeFetchDataPromise;
},

  fetchOrdersOnly: async () => {
    try {
      const resOrd = await fetch(`/api/db/orders?_t=${Date.now()}`, {
        cache: 'no-store',
        headers: {
          'Cache-Control': 'no-cache, no-store, must-revalidate',
          'Pragma': 'no-cache',
          'Expires': '0'
        }
      }).catch(() => null);

      const ordersData = await safeParseResponse(resOrd);
      if (Array.isArray(ordersData)) {
        const orders = ordersData.map((o: any) => ({
          ...o,
          status: o.status || ((o.type === 'delivery' || o.type === 'online' || o.deliveryType === 'delivery' || o.deliveryType === 'pickup') ? 'pending' : 'completed'),
          items: typeof o.items === 'string' ? JSON.parse(o.items) : o.items
        }));
        set({ orders, ordersError: null });
      }
    } catch {
      // ignore
    }
  },

  fetchAppInstalls: async () => {
    try {
      const res = await fetch(`/api/db/app-installs?_t=${Date.now()}`, {
        cache: 'no-store',
        headers: {
          'Cache-Control': 'no-cache, no-store, must-revalidate',
          'Pragma': 'no-cache',
          'Expires': '0'
        }
      });
      const data = await safeParseResponse(res);
      if (data && typeof data === 'object') {
        const count = typeof data.count === 'number' ? data.count : (Array.isArray(data.installs) ? data.installs.length : 0);
        const list = Array.isArray(data.installs) ? data.installs : [];
        set({ appInstallsCount: count, appInstallsList: list });
      }
    } catch {
      // ignore
    }
  },

  recordAppInstall: async (data = {}) => {
    try {
      let installId = localStorage.getItem('balbec_pwa_device_install_id');
      if (!installId) {
        installId = `install_${Date.now()}_${Math.random().toString(36).substring(2, 8)}`;
        localStorage.setItem('balbec_pwa_device_install_id', installId);
      }

      const ua = typeof navigator !== 'undefined' ? (navigator.userAgent || '') : '';
      const isAndroid = /Android/i.test(ua);
      const isIOS = /iPhone|iPad|iPod/i.test(ua);
      const isWindows = /Windows/i.test(ua);
      const isMac = /Macintosh|Mac OS/i.test(ua);
      const isLinux = /Linux/i.test(ua) && !isAndroid;

      const platform = data.platform || (isAndroid ? 'Android' : isIOS ? 'iOS' : isWindows ? 'Windows' : isMac ? 'macOS' : isLinux ? 'Linux' : 'Outro');
      const browser = data.browser || (
        /SamsungBrowser/i.test(ua) ? 'Samsung Internet' :
        /Edg/i.test(ua) ? 'Microsoft Edge' :
        /Chrome/i.test(ua) && !/Edg/i.test(ua) ? 'Google Chrome' :
        /Safari/i.test(ua) && !/Chrome/i.test(ua) ? 'Apple Safari' :
        /Firefox/i.test(ua) ? 'Mozilla Firefox' :
        'Navegador'
      );
      const deviceType = data.deviceType || (
        /Mobile|Android|iP(hone|od)/i.test(ua) ? 'Celular' :
        /iPad|Tablet/i.test(ua) ? 'Tablet' :
        'Computador'
      );

      const payload = {
        id: installId,
        platform,
        browser,
        deviceType,
        installedAt: Date.now(),
        userAgent: ua,
        ...data
      };

      const res = await fetch('/api/db/app-installs', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload)
      });
      if (res.ok) {
        const json = await res.json();
        if (json.count !== undefined) {
          set(state => ({
            appInstallsCount: json.count,
            appInstallsList: [json.install || payload, ...state.appInstallsList.filter(i => i.id !== payload.id)]
          }));
        }
      }
    } catch (e) {
      console.warn('Erro ao registrar instalação PWA:', e);
    }
  },

  addCategory: async (category) => {
    const id = Math.random().toString(36).substring(2, 9);
    const newCat = { id, ...category };
    try {
      const res = await fetch('/api/db/categories', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(newCat)
      });
      if (res.ok) {
        const saved = await res.json();
        set(state => ({ categories: [...state.categories, saved] }));
      }
    } catch (error) {
      console.error('Error adding category:', error);
    }
  },
  
  updateCategory: async (id, category) => {
    try {
      const res = await fetch(`/api/db/categories/${id}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(category)
      });
      if (res.ok) {
        set(state => ({
          categories: state.categories.map(c => c.id === id ? { ...c, ...category } : c)
        }));
      }
    } catch (error) {
      console.error('Error updating category:', error);
    }
  },
  
  deleteCategory: async (id) => {
    try {
      const res = await fetch(`/api/db/categories/${id}`, { method: 'DELETE' });
      if (res.ok) {
        set(state => ({
          categories: state.categories.filter(c => c.id !== id),
          products: state.products.filter(p => p.categoryId !== id)
        }));
      }
    } catch (error) {
      console.error('Error deleting category:', error);
    }
  },
  
  addProduct: async (product) => {
    const id = Math.random().toString(36).substring(2, 9);
    const activeChannels: string[] = [];
    if (product.availableForDelivery !== false) activeChannels.push('delivery');
    if (product.availableInStore !== false) activeChannels.push('in_store');
    if (product.availableForKiosk !== false) activeChannels.push('kiosk');

    let cleanDesc = cleanProductDescription(product.description, true);
    if (activeChannels.length < 3) {
      cleanDesc = `${cleanDesc} [channels:${activeChannels.join(',')}]`.trim();
    }

    const payload: any = { id, ...product, description: cleanDesc };
    delete payload.availableForDelivery;
    delete payload.availableInStore;
    delete payload.availableForKiosk;

    try {
      const res = await fetch('/api/db/products', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload)
      });
      if (res.ok) {
        const saved = await res.json();
        set(state => ({ products: [...state.products, { ...saved, ...product, description: cleanDesc }] }));
      }
    } catch (error) {
      console.error('Error adding product:', error);
    }
  },
  
  updateProduct: async (id, product) => {
    const existing = get().products.find(p => p.id === id);
    const merged = existing ? { ...existing, ...product } : { ...product };

    const activeChannels: string[] = [];
    if (merged.availableForDelivery !== false) activeChannels.push('delivery');
    if (merged.availableInStore !== false) activeChannels.push('in_store');
    if (merged.availableForKiosk !== false) activeChannels.push('kiosk');

    let cleanDesc = cleanProductDescription(merged.description, true);
    if (activeChannels.length < 3) {
      cleanDesc = `${cleanDesc} [channels:${activeChannels.join(',')}]`.trim();
    }

    const payload: any = { ...product, description: cleanDesc };
    delete payload.availableForDelivery;
    delete payload.availableInStore;
    delete payload.availableForKiosk;

    try {
      const res = await fetch(`/api/db/products/${id}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload)
      });
      if (res.ok) {
        set(state => ({
          products: state.products.map(p => p.id === id ? { ...p, ...merged, description: cleanDesc } : p)
        }));
      }
    } catch (error) {
      console.error('Error updating product:', error);
    }
  },
  
  cleanAllProductDescriptions: async () => {
    try {
      const res = await fetch('/api/db/products/clean-barcodes', { method: 'POST' });
      if (res.ok) {
        await get().fetchData();
        return { success: true };
      }
      return { success: false };
    } catch (error) {
      console.error('Error cleaning product descriptions:', error);
      return { success: false };
    }
  },

  deleteProduct: async (id) => {
    try {
      const res = await fetch(`/api/db/products/${id}`, { method: 'DELETE' });
      if (res.ok) {
        set(state => ({
          products: state.products.filter(p => p.id !== id)
        }));
      }
    } catch (error) {
      console.error('Error deleting product:', error);
    }
  },
  
  addUser: async (user, customId) => {
    const uid = String(customId || user.uid || `usr_${Date.now()}_${Math.random().toString(36).substring(2, 7)}`);
    const newUser = { uid, ...user };
    try {
      const res = await fetch('/api/db/users', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(newUser)
      });
      if (res.ok) {
        const saved = await res.json();
        set(state => ({
          users: [...state.users.filter(u => u.email?.toLowerCase() !== saved.email?.toLowerCase() && String(u.id) !== String(saved.id)), saved]
        }));
      } else {
        const err = await res.json().catch(() => ({ error: 'Erro ao cadastrar usuário' }));
        throw new Error(err.error || 'Erro ao cadastrar usuário');
      }
    } catch (error) {
      console.error('Error adding user:', error);
      // Fallback local update so user can work immediately
      set(state => ({
        users: [...state.users.filter(u => u.email?.toLowerCase() !== newUser.email?.toLowerCase()), { id: uid, uid, ...user } as User]
      }));
      throw error;
    }
  },
  
  updateUser: async (id, user) => {
    try {
      const res = await fetch(`/api/db/users/${id}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(user)
      });
      if (res.ok) {
        const saved = await res.json().catch(() => ({ id, ...user }));
        set(state => ({
          users: state.users.map(u => (String(u.id) === String(id) || u.uid === id) ? { ...u, ...saved } : u)
        }));
      } else {
        throw new Error('Erro ao atualizar usuário');
      }
    } catch (error) {
      console.error('Error updating user:', error);
      set(state => ({
        users: state.users.map(u => (String(u.id) === String(id) || u.uid === id) ? { ...u, ...user } : u)
      }));
    }
  },
  
  deleteUser: async (id) => {
    try {
      const res = await fetch(`/api/db/users/${id}`, { method: 'DELETE' });
      if (res.ok) {
        set(state => ({
          users: state.users.filter(u => String(u.id) !== String(id))
        }));
      }
    } catch (error) {
      console.error('Error deleting user:', error);
    }
  },

  addTvMedia: async (item) => {
    const id = `tv_${Date.now()}_${Math.random().toString(36).substring(2, 7)}`;
    // Auto detect youtube
    let itemType = item.type || 'video';
    if (item.url && (item.url.includes('youtube.com') || item.url.includes('youtu.be'))) {
      itemType = 'youtube';
    }

    const newMedia: TvMediaItem = {
      id,
      ...item,
      type: itemType,
      order: item.order ?? get().tvMediaList.length,
      isActive: item.isActive ?? true
    };

    // 1. Optimistic instant add so the user sees it immediately
    const nextList = [...(get().tvMediaList || []).filter(m => m.id !== id), newMedia];
    saveTvMediaToStorage(nextList);
    set({ tvMediaList: nextList });

    try {
      const res = await fetch('/api/db/tv-media', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(newMedia)
      });
      if (res.ok) {
        const saved = await res.json();
        if (saved && saved.id) {
          const syncedList = get().tvMediaList.map(m => m.id === id ? { ...m, ...saved } : m);
          saveTvMediaToStorage(syncedList);
          set({ tvMediaList: syncedList });
        }
      } else {
        console.warn('Backend responded non-200 on addTvMedia, kept optimistic entry');
      }
    } catch (error) {
      console.error('Error adding tv media on backend, kept optimistic entry:', error);
    }
  },

  updateTvMedia: async (id, item) => {
    // 1. Optimistic update
    const updatedList = (get().tvMediaList || []).map(m => String(m.id) === String(id) ? { ...m, ...item } : m);
    saveTvMediaToStorage(updatedList);
    set({ tvMediaList: updatedList });

    try {
      const res = await fetch(`/api/db/tv-media/${id}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(item)
      });
      if (res.ok) {
        const updated = await res.json();
        if (updated && updated.id) {
          const syncedList = get().tvMediaList.map(m => String(m.id) === String(id) ? { ...m, ...updated } : m);
          saveTvMediaToStorage(syncedList);
          set({ tvMediaList: syncedList });
        }
      }
    } catch (error) {
      console.error('Error updating tv media:', error);
    }
  },

  deleteTvMedia: async (id) => {
    // 1. Optimistic deletion
    const filteredList = (get().tvMediaList || []).filter(m => String(m.id) !== String(id));
    saveTvMediaToStorage(filteredList);
    set({ tvMediaList: filteredList });
    try {
      const res = await fetch(`/api/db/tv-media/${id}`, { method: 'DELETE' });
      if (!res.ok) {
        console.warn('Backend returned non-200 for tv-media delete');
      }
    } catch (error) {
      console.error('Error deleting tv media on backend:', error);
    }
  },
  
  placeOrder: async (order) => {
    // Calcula o próximo número sequencial garantido (max + 1)
    const currentOrders = get().orders || [];
    const usedNumbers = new Set<number>();
    let maxNum = 0;
    currentOrders.forEach(o => {
      if (!o || !o.id) return;
      const digits = String(o.id).replace(/\D/g, '');
      if (digits) {
        const num = parseInt(digits, 10);
        if (!isNaN(num) && num >= 1 && num <= 99999) {
          usedNumbers.add(num);
          if (num > maxNum) maxNum = num;
        }
      }
    });

    let candidate = maxNum + 1;
    if (candidate > 99999) {
      candidate = 1;
      while (usedNumbers.has(candidate)) {
        candidate++;
      }
    }
    const id = String(candidate).padStart(4, '0');

    // Regra de Negócio:
    // Pedidos do Totem (type === 'kiosk') e Consumo na Loja (Mesa / dine_in) chegam como 'completed' (Entregue).
    // Pedidos de Delivery e Retirada online chegam sempre como 'pending' (Pendente).
    const isKiosk = order.type === 'kiosk' || (order as any).mode === 'kiosk' || (order.customerName && String(order.customerName).toLowerCase().includes('totem'));
    const isDineIn = Boolean(order.tableNumber) || order.type === 'dine_in' || order.deliveryType === 'dine_in';
    const isTotemOrDineIn = isKiosk || isDineIn;
    const initialStatus = isTotemOrDineIn ? (order.status || 'completed') : 'pending';
    const initialDeliveryStatus = isTotemOrDineIn ? (order.deliveryStatus || 'delivered') : 'pending';

    const newOrder: Order = {
      id,
      ...order,
      createdAt: Date.now(),
      status: initialStatus,
      deliveryStatus: initialDeliveryStatus,
      customerName: order.customerName || (isKiosk ? 'Cliente Totem' : 'Cliente')
    };

    
    let createdOrder = newOrder;

    try {
      const res = await fetch('/api/db/orders', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(newOrder)
      });
      
      if (res.ok) {
        const saved = await res.json();
        const parsedSaved = {
          ...saved,
          items: typeof saved.items === 'string' ? JSON.parse(saved.items) : saved.items
        };
        createdOrder = parsedSaved;
        set(state => ({ orders: [parsedSaved, ...state.orders.filter(o => o.id !== parsedSaved.id)] }));

        // Auto-export to BlueFocus
        try {
          await get().exportOrderToBlueFocus(parsedSaved, {});
          console.log('Pedido exportado para BlueFocus automaticamente');
        } catch (bfError) {
          console.error('Erro ao exportar automaticamente para BlueFocus:', bfError);
        }

        // Auto-save or update customer lead record
        // REGRA DE NEGÓCIO: Apenas clientes de delivery e consumo na loja viram leads no sistema.
        // Pedidos feitos pelo totem NÃO viram leads.
        const isTotemOrder = parsedSaved.type === 'kiosk';
        if (!isTotemOrder) {
          const custName = (parsedSaved.customerName || '').trim();
          const custPhone = (parsedSaved.customerPhone || '').trim();
          if (custPhone && custName && custName !== 'Cliente' && custName !== 'Cliente Totem') {
            const isDelivery = parsedSaved.type === 'delivery' || parsedSaved.deliveryType === 'delivery';
            get().saveCustomer({
              name: parsedSaved.customerName,
              phone: parsedSaved.customerPhone,
              address: parsedSaved.deliveryAddress,
              source: isDelivery ? 'delivery' : 'instore',
              tags: isDelivery ? ['Cliente', 'Delivery'] : ['Cliente', 'Consumo Loja']
            }).catch(e => console.warn('Error auto-saving customer from order:', e));
          }
        }
      }
    } catch (error) {
      console.error('Erro ao salvar pedido:', error);
    }

    return createdOrder;
  },
  
  updateOrderStatus: async (id, status) => {
    try {
      const deliveryStatus = 
        status === 'out_for_delivery' ? 'in_transit' :
        status === 'completed' ? 'delivered' :
        status === 'ready_for_delivery' ? 'ready' :
        status === 'cancelled' ? 'cancelled' : undefined;

      const res = await fetch(`/api/db/orders/${id}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ 
          status,
          ...(deliveryStatus ? { deliveryStatus } : {})
        })
      });
      if (res.ok) {
        set(state => ({
          orders: state.orders.map(o => o.id === id ? { 
            ...o, 
            status,
            ...(deliveryStatus ? { deliveryStatus } : {})
          } : o)
        }));
      }
    } catch (error) {
      console.error('Error updating order status:', error);
    }
  },
  
  deleteOrder: async (id) => {
    if (!id) return;
    const targetId = String(id).trim();
    console.log(`[Store] Deleting order: ${targetId}`);
    
    // 1. Optimistic removal
    set(state => {
      const currentOrders = state.orders || [];
      const updated = currentOrders.filter(o => String(o.id).trim() !== targetId);
      
      // If nothing changed, don't trigger unnecessary re-render
      if (updated.length === currentOrders.length) {
        console.warn(`[Store] Order ${targetId} not found in state for deletion.`);
        return state;
      }
      
      saveOrdersToStorage(updated);
      return { orders: updated };
    });

    try {
      const res = await fetch(`/api/db/orders/${encodeURIComponent(targetId)}`, { method: 'DELETE' });
      if (!res.ok) {
        console.warn('Backend returned error when deleting order:', res.status);
        // We could roll back here if needed, but usually we just log
      }
    } catch (error) {
      console.error('Error deleting order:', error);
    }
  },

  clearAllOrders: async () => {
    try {
      const res = await fetch('/api/db/orders', { method: 'DELETE' });
      if (res.ok) {
        saveOrdersToStorage([]);
        set({ orders: [] });
      }
    } catch (error) {
      console.error('Error clearing all orders:', error);
    }
  },
  
  updateStoreInfo: async (info) => {
    const normalizedInfo = { ...info, deliveryEnabled: false };
    // Optimistic update
    set(state => {
      const merged = { ...state.storeInfo, ...normalizedInfo, deliveryEnabled: false };
      saveStoreInfoToStorage(merged);
      return { storeInfo: merged };
    });
    try {
      const res = await fetch('/api/db/store-info', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(normalizedInfo)
      });
      if (res.ok) {
        const updated = await res.json();
        set(state => {
          const local = state.storeInfo;
          const merged = { ...local, ...updated, deliveryEnabled: false };

          const customLogo = localStorage.getItem('balbec_custom_logo_url') || local.logoUrl;
          if (customLogo && customLogo !== '/logo.svg' && customLogo.trim() !== '') {
            merged.logoUrl = customLogo;
          }

          const customTvCats = localStorage.getItem('balbec_tv_selected_categories') || local.tvSelectedCategories;
          if (customTvCats && customTvCats !== '[]') {
            merged.tvSelectedCategories = customTvCats;
          }

          saveStoreInfoToStorage(merged);
          return { storeInfo: merged };
        });
      }
    } catch (error) {
      console.error('Error updating store info:', error);
    }
  },
  
  exportOrderToBlueFocus: async (order, config) => {
    const response = await fetch('/api/bluefocus/export-order', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({ 
        order, 
        empresaId: localStorage.getItem('bluefocus_empresa_id') || 'BALBEC',
        usuarioId: localStorage.getItem('bluefocus_usuario_id') || 'CONSULTA',
        pdvCodigo: localStorage.getItem('bluefocus_pdv_codigo') || '1000',
        orderUrl: localStorage.getItem('bluefocus_order_url') || 'http://balbec.ddns.net:8082/valim/servlet/aintegracaofcxregistravenda',
        authToken: localStorage.getItem('bluefocus_auth_token') || '',
        ...config 
      })
    });
    
    if (!response.ok) {
      const errorData = await response.json();
      throw new Error(errorData.error || 'Erro ao exportar pedido para BlueFocus');
    }
  },

  fetchCustomers: async () => {
    try {
      const res = await fetch(`/api/db/customers?_t=${Date.now()}`, {
        cache: 'no-store',
        headers: {
          'Cache-Control': 'no-cache, no-store, must-revalidate',
          'Pragma': 'no-cache',
          'Expires': '0'
        }
      });
      const data = await safeParseResponse(res);
      if (Array.isArray(data)) {
        const customers: Customer[] = data.map((c: any) => ({
          ...c,
          tags: Array.isArray(c.tags) ? c.tags : (typeof c.tags === 'string' ? JSON.parse(c.tags || '[]') : [])
        }));
        const currentCusts = get().customers || getInitialCustomers();
        if (customers.length > 0 || currentCusts.length === 0) {
          saveCustomersToStorage(customers);
          set({ customers });
        }
      }
    } catch (err) {
      console.warn('Erro ao buscar clientes:', err);
    }
  },

  saveCustomer: async (customerData) => {
    try {
      const res = await fetch('/api/db/customers', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(customerData)
      });
      if (res.ok) {
        const saved = await res.json();
        const parsedSaved: Customer = {
          ...saved,
          tags: Array.isArray(saved.tags) ? saved.tags : (typeof saved.tags === 'string' ? JSON.parse(saved.tags || '[]') : [])
        };
        set(state => {
          const index = state.customers.findIndex(c => c.id === parsedSaved.id);
          if (index >= 0) {
            const updated = [...state.customers];
            updated[index] = parsedSaved;
            return { customers: updated };
          }
          return { customers: [parsedSaved, ...state.customers] };
        });
        return parsedSaved;
      }
    } catch (err) {
      console.error('Erro ao cadastrar lead:', err);
    }
    return null;
  },

  updateCustomer: async (id, customerData) => {
    try {
      const res = await fetch(`/api/db/customers/${id}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(customerData)
      });
      if (res.ok) {
        const updated = await res.json();
        const parsedUpdated: Customer = {
          ...updated,
          tags: Array.isArray(updated.tags) ? updated.tags : (typeof updated.tags === 'string' ? JSON.parse(updated.tags || '[]') : [])
        };
        set(state => ({
          customers: state.customers.map(c => c.id === id ? { ...c, ...parsedUpdated } : c)
        }));
        return parsedUpdated;
      }
    } catch (err) {
      console.error('Erro ao atualizar cliente:', err);
    }
    return null;
  },

  deleteCustomer: async (id) => {
    try {
      const res = await fetch(`/api/db/customers/${id}`, { method: 'DELETE' });
      if (res.ok) {
        set(state => ({
          customers: state.customers.filter(c => c.id !== id)
        }));
        return true;
      }
    } catch (err) {
      console.error('Erro ao excluir cliente:', err);
    }
    return false;
  },

  syncCustomersFromOrders: async () => {
    try {
      const res = await fetch('/api/db/customers/sync-from-orders', { method: 'POST' });
      if (res.ok) {
        await get().fetchCustomers();
      }
    } catch (err) {
      console.error('Erro ao sincronizar clientes dos pedidos:', err);
    }
  },

  // Tables / Mesas CRUD Actions
  fetchTables: async () => {
    try {
      const res = await fetch(`/api/db/tables?_t=${Date.now()}`, {
        cache: 'no-store',
        headers: { 'Cache-Control': 'no-cache', 'Pragma': 'no-cache' }
      });
      if (res.ok) {
        const rawTables = await res.json();
        if (Array.isArray(rawTables)) {
          set({ tables: rawTables });
        }
      }
    } catch (err) {
      console.error('Erro ao buscar mesas:', err);
    }
  },

  addTable: async (tableData) => {
    try {
      const res = await fetch('/api/db/tables', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(tableData)
      });
      if (res.ok) {
        const saved: DiningTable = await res.json();
        set(state => ({
          tables: [...state.tables.filter(t => t.id !== saved.id), saved].sort((a, b) => (a.number || 0) - (b.number || 0))
        }));
        return saved;
      }
    } catch (err) {
      console.error('Erro ao cadastrar mesa:', err);
    }
    return null;
  },

  addTablesBatch: async (tablesList) => {
    try {
      const res = await fetch('/api/db/tables/batch', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ tables: tablesList })
      });
      if (res.ok) {
        const data = await res.json();
        if (Array.isArray(data.tables)) {
          set({ tables: data.tables });
        } else {
          await get().fetchTables();
        }
      }
    } catch (err) {
      console.error('Erro ao cadastrar mesas em lote:', err);
    }
  },

  updateTable: async (id, tableData) => {
    try {
      const res = await fetch(`/api/db/tables/${id}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(tableData)
      });
      if (res.ok) {
        const updated: DiningTable = await res.json();
        set(state => ({
          tables: state.tables.map(t => t.id === id ? { ...t, ...updated } : t).sort((a, b) => (a.number || 0) - (b.number || 0))
        }));
      }
    } catch (err) {
      console.error('Erro ao atualizar mesa:', err);
    }
  },

  deleteTable: async (id) => {
    try {
      const res = await fetch(`/api/db/tables/${id}`, { method: 'DELETE' });
      if (res.ok) {
        set(state => ({
          tables: state.tables.filter(t => t.id !== id)
        }));
      }
    } catch (err) {
      console.error('Erro ao excluir mesa:', err);
    }
  }
}));
