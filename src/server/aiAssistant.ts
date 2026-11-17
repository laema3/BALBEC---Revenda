import { FunctionDeclaration, GoogleGenAI, Type } from '@google/genai';
import { Request, Response } from 'express';
import {
  getStoreCurrentStatus,
  parseWeeklySchedule,
  formatWeeklyScheduleSummary,
  parseScheduleSlots,
  parseSlotCapacities,
  calculatePickupTime,
} from '../utils/scheduleHelper';
import {
  isExcludedCategory,
  shouldExcludeProduct,
  isCategoryFrozenModality,
  isSalgadoProduct,
  isAddonItem,
  normalizeText,
  formatProductDescriptionWithCode,
} from '../constants';

export interface LiveDbContext {
  categories: any[];
  products: any[];
  storeInfo: any;
  orders: any[];
  customers: any[];
  createOrder: (data: any) => Promise<any>;
}

export interface AiDraftItem {
  productId: string;
  externalId: string;
  code: string;
  name: string;
  description: string;
  imageUrl?: string;
  price: number; // base product price
  quantity: number;
  isFrozen: boolean;
  prepType?: string;
  prepLabel?: string;
  addons: Array<{
    productId: string;
    name: string;
    price: number;
    externalId?: string;
    code?: string;
    isFrozen?: boolean;
  }>;
  flavor: {
    productId: string;
    name: string;
    price: number;
    externalId?: string;
    code?: string;
  } | null;
}

export interface AiSessionState {
  sessionId: string;
  items: AiDraftItem[];
  scheduledDate: string | null;
  scheduledDay: string | null;
  scheduledTime: string | null;
  scheduledPickupTime: string | null;
  customerId: string | null;
  customerName: string;
  customerPhone: string;
  customerCpf: string;
  paymentMethod: string;
  cashChange: string;
  notes: string;
  lastPlacedOrder: {
    orderId: string;
    total: number;
    items: AiDraftItem[];
    scheduledDate?: string | null;
    scheduledDay?: string | null;
    scheduledTime?: string | null;
    scheduledPickupTime?: string | null;
    paymentMethod: string;
    customerName: string;
    customerPhone: string;
  } | null;
  updatedAt: number;
}

const aiSessions = new Map<string, AiSessionState>();

const SESSION_TTL_MS = 6 * 60 * 60 * 1000;

function pruneExpiredSessions() {
  const now = Date.now();
  for (const [key, sess] of aiSessions.entries()) {
    if (now - sess.updatedAt > SESSION_TTL_MS) {
      aiSessions.delete(key);
    }
  }
}

function getOrCreateSession(sessionId: string, customerContext?: any): AiSessionState {
  pruneExpiredSessions();
  const cleanId = (sessionId || 'default').trim() || 'default';
  let session = aiSessions.get(cleanId);
  if (!session) {
    session = {
      sessionId: cleanId,
      items: [],
      scheduledDate: null,
      scheduledDay: null,
      scheduledTime: null,
      scheduledPickupTime: null,
      customerId: customerContext?.id || null,
      customerName: customerContext?.name || '',
      customerPhone: customerContext?.phone || '',
      customerCpf: customerContext?.cpf || '',
      paymentMethod: '',
      cashChange: '',
      notes: '',
      lastPlacedOrder: null,
      updatedAt: Date.now(),
    };
    aiSessions.set(cleanId, session);
  } else {
    session.updatedAt = Date.now();
    if (customerContext) {
      if (!session.customerId && customerContext.id) session.customerId = customerContext.id;
      if (!session.customerName && customerContext.name) session.customerName = customerContext.name;
      if (!session.customerPhone && customerContext.phone) session.customerPhone = customerContext.phone;
      if (!session.customerCpf && customerContext.cpf) session.customerCpf = customerContext.cpf;
    }
  }
  return session;
}

function getPrepChoiceLabel(prepType?: string): string {
  switch (prepType) {
    case 'congelado_cru':
      return 'CRU CONGELADO';
    case 'congelado_frito':
      return 'FRITO CONGELADO';
    case 'congelado_pre_assado':
    case 'pronto_pre_assado':
      return 'PRÉ-ASSADO';
    case 'congelado_assado_pronto':
    case 'pronto_assado_pronto':
      return 'ASSADO PRONTO';
    case 'pronto_cru':
      return 'CRU';
    case 'pronto_frito':
      return 'FRITO';
    default:
      return '';
  }
}

function getFrozenExtraValue(products: any[]): number {
  const foundCong = products.find((p: any) => p && p.id === 'prod_congelado');
  if (foundCong && Number(foundCong.price) > 0 && Number(foundCong.price) < 2.0) {
    return Number(foundCong.price);
  }
  return 0.3;
}

function computeDraftTotal(items: AiDraftItem[]): number {
  return items.reduce((sum, item) => {
    const addonsSum = (item.addons || []).reduce((aSum, a) => aSum + (Number(a.price) || 0), 0);
    const flavorPrice = item.flavor ? Number(item.flavor.price) || 0 : 0;
    return sum + (Number(item.price) + flavorPrice + addonsSum) * Number(item.quantity || 1);
  }, 0);
}

function computeDraftUnits(items: AiDraftItem[]): number {
  return items.reduce((sum, item) => sum + (Number(item.quantity) || 1), 0);
}

function getCategoryPrepConfig(category: any, isFrozenContext: boolean, storeInfo: any) {
  const normCatName = normalizeText(category?.name || '');
  const isBakedCategory = normCatName.includes('assad');
  const isFriedNormalCategory =
    !isFrozenContext &&
    !isBakedCategory &&
    (normCatName.includes('frit') ||
      (normCatName.includes('grande') && normCatName.includes('norma')) ||
      normCatName.includes('salgad'));

  const isPrepEnabled = isBakedCategory
    ? isFrozenContext
      ? storeInfo.salgadoPrepAssadoCongeladoEnabled !== false
      : storeInfo.salgadoPrepAssadoEnabled !== false
    : isFrozenContext
    ? storeInfo.salgadoPrepFritoCongeladoEnabled !== false
    : isFriedNormalCategory
    ? storeInfo.salgadoPrepFritoEnabled !== false
    : false;

  if (!isPrepEnabled || !(isFrozenContext || isBakedCategory || isFriedNormalCategory)) {
    return {
      needsPrepChoice: false,
      isBakedCategory,
      allowedOptions: [] as Array<{ prepType: string; label: string }>,
    };
  }

  const opt1 = isBakedCategory
    ? { prepType: isFrozenContext ? 'congelado_pre_assado' : 'pronto_pre_assado', label: 'PRÉ-ASSADO' }
    : isFrozenContext
    ? { prepType: 'congelado_cru', label: 'CRU CONGELADO' }
    : { prepType: 'pronto_cru', label: 'CRU' };

  const opt2 = isBakedCategory
    ? { prepType: isFrozenContext ? 'congelado_assado_pronto' : 'pronto_assado_pronto', label: 'ASSADO PRONTO' }
    : isFrozenContext
    ? { prepType: 'congelado_frito', label: 'FRITO CONGELADO' }
    : { prepType: 'pronto_frito', label: 'FRITO' };

  return {
    needsPrepChoice: true,
    isBakedCategory,
    allowedOptions: [opt1, opt2],
  };
}

function buildActiveCatalog(db: LiveDbContext) {
  const rawCategories = db.categories || [];
  const rawProducts = db.products || [];
  const storeInfo = db.storeInfo || {};
  const frozenExtraVal = getFrozenExtraValue(rawProducts);

  const visibleCategories = rawCategories.filter(
    (c: any) =>
      c &&
      c.id &&
      typeof c.name === 'string' &&
      c.isVisible !== false &&
      c.availableInStore !== false &&
      !isExcludedCategory(c.name)
  );
  const visibleCategoryIds = new Set(visibleCategories.map((c: any) => c.id));

  const activeProducts = rawProducts.filter(
    (p: any) =>
      p &&
      p.isActive !== false &&
      p.availableInStore !== false &&
      !p.isAddon &&
      !p.isFlavor &&
      !isAddonItem(p, rawCategories) &&
      !shouldExcludeProduct(p, rawCategories) &&
      (visibleCategoryIds.has(p.categoryId) ||
        (p.frozenCategoryId && p.frozenCategoryId !== 'none' && visibleCategoryIds.has(p.frozenCategoryId)))
  );

  const availableAddons = rawProducts.filter(
    (p: any) =>
      p &&
      p.isActive !== false &&
      p.availableInStore !== false &&
      (p.isAddon || isAddonItem(p, rawCategories)) &&
      p.id !== 'prod_congelado' &&
      !shouldExcludeProduct(p, rawCategories)
  );

  const availableFlavors = rawProducts.filter(
    (p: any) =>
      p &&
      p.isActive !== false &&
      p.availableInStore !== false &&
      p.isFlavor &&
      !shouldExcludeProduct(p, rawCategories)
  );

  return {
    visibleCategories,
    activeProducts,
    availableAddons,
    availableFlavors,
    frozenExtraVal,
    storeInfo,
  };
}

function resolveProductContext(
  product: any,
  requestedModality: 'pronto' | 'congelado' | undefined,
  visibleCategories: any[],
  storeInfo: any,
  frozenExtraVal: number
) {
  const primaryCat = visibleCategories.find((c: any) => c.id === product.categoryId);
  const frozenCat =
    product.frozenCategoryId && product.frozenCategoryId !== 'none'
      ? visibleCategories.find((c: any) => c.id === product.frozenCategoryId)
      : null;

  const isSalgado = isSalgadoProduct(product, visibleCategories);
  const primaryIsFrozen = primaryCat ? isCategoryFrozenModality(primaryCat) : false;

  const supportsNormal = Boolean(primaryCat && !primaryIsFrozen);
  const supportsFrozen = Boolean(frozenCat || primaryIsFrozen || (isSalgado && product.allowFrozen !== false));

  let isFrozenContext = false;
  if (requestedModality === 'congelado') {
    if (supportsFrozen) {
      isFrozenContext = true;
    } else {
      return { error: `O produto "${product.name}" não possui opção congelada disponível, apenas pronto.` };
    }
  } else if (requestedModality === 'pronto') {
    if (supportsNormal) {
      isFrozenContext = false;
    } else if (supportsFrozen && !supportsNormal) {
      return { error: `O produto "${product.name}" está cadastrado apenas na modalidade congelada.` };
    }
  } else {
    isFrozenContext = !supportsNormal && supportsFrozen;
  }

  const effectiveCategory = isFrozenContext ? frozenCat || primaryCat : primaryCat || frozenCat;
  const prepConfig = getCategoryPrepConfig(effectiveCategory, isFrozenContext, storeInfo);
  const minRequired = isFrozenContext && Number(product.minFrozenQuantity) > 1 ? Number(product.minFrozenQuantity) : 1;
  const displayUnitPrice = isFrozenContext && isSalgado ? Number(product.price) + frozenExtraVal : Number(product.price);

  return {
    isFrozenContext,
    isSalgado,
    effectiveCategory,
    prepConfig,
    minRequired,
    displayUnitPrice,
    supportsNormal,
    supportsFrozen,
  };
}

function normalizeForMatch(str: string): string {
  return normalizeText(str || '')
    .replace(/\bcoxinhas\b/g, 'coxinha')
    .replace(/\besfirras\b/g, 'esfirra')
    .replace(/\besfihas\b/g, 'esfiha')
    .replace(/\brisoles\b/g, 'risole')
    .replace(/\brisolis\b/g, 'risole')
    .replace(/\bkibes\b/g, 'kibe')
    .replace(/\bquibes\b/g, 'kibe')
    .replace(/\bempadas\b/g, 'empada')
    .replace(/\bpasteis\b/g, 'pastel')
    .replace(/\bbolinhos\b/g, 'bolinho')
    .replace(/\bcroquetes\b/g, 'croquete')
    .replace(/\benroladinhos\b/g, 'enroladinho')
    .replace(/\bpaoes\b/g, 'pao')
    .replace(/\bpaes\b/g, 'pao')
    .replace(/\bsalgados\b/g, 'salgado')
    .replace(/\bsucos\b/g, 'suco')
    .replace(/\brefrigerantes\b/g, 'refrigerante')
    .trim();
}

function findBestProductMatch(queryOrId: string, activeProducts: any[]): any | null {
  if (!queryOrId) return null;
  const trimmed = String(queryOrId).trim();
  const byId = activeProducts.find(
    (p: any) => p.id === trimmed || (p.externalId && String(p.externalId).trim() === trimmed)
  );
  if (byId) return byId;

  const qNorm = normalizeForMatch(trimmed);
  if (!qNorm) return null;

  const exactName = activeProducts.find((p: any) => normalizeForMatch(p.name) === qNorm);
  if (exactName) return exactName;

  const cleanQ = qNorm
    .replace(/\b(congelado|congelada|frito|frita|cru|crua|assado|assada|pre assado|pronto|salgado|cod|codigo)\b/g, '')
    .replace(/\s+/g, ' ')
    .trim();

  if (cleanQ) {
    const exactClean = activeProducts.find((p: any) => normalizeForMatch(p.name) === cleanQ);
    if (exactClean) return exactClean;
  }

  const tokens = (cleanQ || qNorm).split(' ').filter((w) => w.length >= 2);
  let bestProd: any = null;
  let bestScore = 0;

  for (const p of activeProducts) {
    const pNorm = normalizeForMatch(p.name);
    if (pNorm.includes(cleanQ || qNorm)) {
      const score = 100 - Math.abs(pNorm.length - (cleanQ || qNorm).length);
      if (score > bestScore) {
        bestScore = score;
        bestProd = p;
      }
      continue;
    }
    if (tokens.length > 0) {
      const pWords = pNorm.split(' ');
      const matchedTokens = tokens.filter((t) => pNorm.includes(t));
      if (matchedTokens.length === tokens.length) {
        const score = 70 + matchedTokens.length * 5 - Math.max(0, pWords.length - tokens.length);
        if (score > bestScore) {
          bestScore = score;
          bestProd = p;
        }
      } else if (matchedTokens.length > 0) {
        const ratio = matchedTokens.length / tokens.length;
        if (ratio >= 0.6) {
          const score = Math.round(ratio * 50) + matchedTokens.length;
          if (score > bestScore) {
            bestScore = score;
            bestProd = p;
          }
        }
      }
    }
  }

  return bestScore >= 40 ? bestProd : null;
}

function resolvePrepChoiceFromText(
  requestedPrep: string | undefined,
  allowedOptions: Array<{ prepType: string; label: string }>,
  isBakedCategory: boolean
): { prepType: string; label: string } | { disabledReason: string } | null {
  if (!requestedPrep || !requestedPrep.trim()) return null;
  const norm = normalizeText(requestedPrep);

  const exact = allowedOptions.find(
    (o) => normalizeText(o.prepType) === norm || normalizeText(o.label) === norm
  );
  if (exact) return exact;

  if (isBakedCategory) {
    if (norm.includes('pre') || norm.includes('preassado')) {
      return allowedOptions.find((o) => o.prepType.includes('pre_assado')) || null;
    }
    if (norm.includes('pronto') || norm === 'assado') {
      return allowedOptions.find((o) => o.prepType.includes('assado_pronto')) || null;
    }
  } else {
    if (norm.includes('cru')) {
      return allowedOptions.find((o) => o.prepType.includes('_cru')) || null;
    }
    if (norm.includes('frit')) {
      return allowedOptions.find((o) => o.prepType.includes('_frito')) || null;
    }
  }

  return {
    disabledReason: `A opção "${requestedPrep}" não se aplica ou não está habilitada no momento. As opções ativas para este item são: ${allowedOptions.map((o) => o.label).join(' ou ')}.`,
  };
}

function getBrazilNowDate(): Date {
  const now = new Date();
  try {
    const brazilDateStr = now.toLocaleString('en-US', { timeZone: 'America/Sao_Paulo' });
    return new Date(brazilDateStr);
  } catch {
    return now;
  }
}

function computeScheduleAvailability(
  db: LiveDbContext,
  hasFrozenItems: boolean,
  requestedUnits: number,
  targetDateStr?: string
) {
  const storeInfo = db.storeInfo || {};
  const scheduleEnabled = storeInfo.deliveryScheduleEnabled !== false;
  const slots = parseScheduleSlots(storeInfo.deliveryScheduleSlots);
  const slotCapacitiesMap = parseSlotCapacities(storeInfo.scheduleSlotCapacities);
  const weeklySchedule = parseWeeklySchedule(storeInfo.weeklySchedule);

  const normalPrepMinutes = Number(storeInfo.schedulePrepTimeNormalMinutes) || 40;
  const frozenPrepMinutes = Number(storeInfo.schedulePrepTimeFrozenMinutes) || 90;
  const activePrepBuffer = hasFrozenItems ? frozenPrepMinutes : normalPrepMinutes;
  const defaultSlotCapacity =
    storeInfo.scheduleSlotItemCapacity !== undefined ? Number(storeInfo.scheduleSlotItemCapacity) : 100;

  const brazilNow = getBrazilNowDate();
  const currentTimeInMinutes = brazilNow.getHours() * 60 + brazilNow.getMinutes();

  // Compute booked salgado units per `${dateStr}_${slot}` from live orders
  const slotBookedMap: Record<string, number> = {};
  const todayIso = `${brazilNow.getFullYear()}-${String(brazilNow.getMonth() + 1).padStart(2, '0')}-${String(brazilNow.getDate()).padStart(2, '0')}`;

  for (const o of db.orders || []) {
    if (!o || !o.scheduledTime || o.status === 'cancelled') continue;
    const orderDate =
      o.scheduledDate || (o.createdAt ? new Date(o.createdAt).toISOString().slice(0, 10) : todayIso);
    const key = `${orderDate}_${o.scheduledTime}`;
    let items: any[] = [];
    if (Array.isArray(o.items)) {
      items = o.items;
    } else if (typeof o.items === 'string' && o.items.trim()) {
      try {
        const parsed = JSON.parse(o.items);
        if (Array.isArray(parsed)) items = parsed;
      } catch {
        items = [];
      }
    }
    const units = items.reduce((s, it) => s + (Number(it.quantity) || 1), 0);
    slotBookedMap[key] = (slotBookedMap[key] || 0) + units;
  }

  const dayShortNames = ['Dom', 'Seg', 'Ter', 'Qua', 'Qui', 'Sex', 'Sáb'];
  const dayFullNames = [
    'Domingo',
    'Segunda-feira',
    'Terça-feira',
    'Quarta-feira',
    'Quinta-feira',
    'Sexta-feira',
    'Sábado',
  ];

  const availableDays: Array<{
    dateStr: string;
    dayOfWeek: number;
    shortDayName: string;
    dayName: string;
    dateFormatted: string;
    isToday: boolean;
    openTime: string;
    closeTime: string;
    availableSlots: Array<{
      slot: string;
      estimatedPickupTime: string;
      slotCap: number;
      bookedUnits: number;
      remainingUnits: number;
      fitsOrder: boolean;
    }>;
  }> = [];

  const cursor = new Date(brazilNow);
  let guard = 0;
  while (availableDays.length < 6 && guard < 14) {
    guard++;
    const dOfWeek = cursor.getDay();
    const dayConfig = weeklySchedule.find((s) => Number(s.dayOfWeek) === Number(dOfWeek));
    let isDayOpen = dOfWeek !== 0;
    if (dayConfig) {
      isDayOpen = dayConfig.isOpen === true || String((dayConfig as any).isOpen) === 'true';
    }

    if (isDayOpen) {
      const y = cursor.getFullYear();
      const m = String(cursor.getMonth() + 1).padStart(2, '0');
      const d = String(cursor.getDate()).padStart(2, '0');
      const dateStr = `${y}-${m}-${d}`;
      const isToday = cursor.toDateString() === brazilNow.toDateString();

      const daySlots = slots
        .map((slot) => {
          const slotCap = slotCapacitiesMap[slot] !== undefined ? slotCapacitiesMap[slot] : defaultSlotCapacity;
          const bookedUnits = slotBookedMap[`${dateStr}_${slot}`] || 0;
          const remainingUnits = Math.max(0, slotCap - bookedUnits);

          let isPast = false;
          if (isToday) {
            const [sh, sm] = slot.split(':').map(Number);
            const slotMinutes = sh * 60 + sm;
            isPast = slotMinutes <= currentTimeInMinutes + activePrepBuffer;
          }

          if (isPast || remainingUnits <= 0) return null;

          const estimatedPickupTime = calculatePickupTime(
            slot,
            hasFrozenItems,
            normalPrepMinutes,
            frozenPrepMinutes
          );

          return {
            slot,
            estimatedPickupTime,
            slotCap,
            bookedUnits,
            remainingUnits,
            fitsOrder: requestedUnits <= 0 || remainingUnits >= requestedUnits,
          };
        })
        .filter((s): s is NonNullable<typeof s> => s !== null);

      availableDays.push({
        dateStr,
        dayOfWeek: dOfWeek,
        shortDayName: dayShortNames[dOfWeek],
        dayName: `${dayFullNames[dOfWeek]}, ${d}/${m}`,
        dateFormatted: `${d}/${m}`,
        isToday,
        openTime: dayConfig?.openTime || '08:00',
        closeTime: dayConfig?.closeTime || '19:30',
        availableSlots: daySlots,
      });
    }
    cursor.setDate(cursor.getDate() + 1);
  }

  const filteredDays = targetDateStr
    ? availableDays.filter(
        (d) =>
          d.dateStr === targetDateStr ||
          d.dateFormatted === targetDateStr ||
          normalizeText(d.dayName).includes(normalizeText(targetDateStr)) ||
          (normalizeText(targetDateStr) === 'hoje' && d.isToday) ||
          (normalizeText(targetDateStr) === 'amanha' && !d.isToday && availableDays.indexOf(d) === (availableDays[0]?.isToday ? 1 : 0))
      )
    : availableDays;

  return {
    scheduleEnabled,
    intervalMinutes: Number(storeInfo.scheduleIntervalMinutes) === 60 ? 60 : 30,
    normalPrepMinutes,
    frozenPrepMinutes,
    activePrepBuffer,
    todayBrazilTime: `${String(brazilNow.getHours()).padStart(2, '0')}:${String(brazilNow.getMinutes()).padStart(2, '0')}`,
    days: filteredDays.length > 0 ? filteredDays : availableDays,
  };
}

function formatDraftForResponse(session: AiSessionState) {
  if (!session.items.length && !session.scheduledTime) return null;
  return {
    items: session.items.map((it) => ({
      productId: it.productId,
      externalId: it.externalId,
      code: it.code,
      name: it.name,
      description: it.description,
      imageUrl: it.imageUrl,
      price: it.price,
      quantity: it.quantity,
      isFrozen: it.isFrozen,
      prepType: it.prepType,
      prepLabel: it.prepLabel,
      addons: it.addons,
      flavor: it.flavor,
    })),
    total: computeDraftTotal(session.items),
    totalUnits: computeDraftUnits(session.items),
    hasFrozen: session.items.some((it) => it.isFrozen),
    scheduledDate: session.scheduledDate,
    scheduledDay: session.scheduledDay,
    scheduledTime: session.scheduledTime,
    scheduledPickupTime: session.scheduledPickupTime,
    customerName: session.customerName,
    customerPhone: session.customerPhone,
    paymentMethod: session.paymentMethod,
  };
}

// =========================================================================
// GEMINI FUNCTION DECLARATIONS (LIVE SYSTEM TOOLS)
// =========================================================================

const AI_TOOL_DECLARATIONS: FunctionDeclaration[] = [
  {
    name: 'consultar_cardapio_e_opcoes',
    description:
      'Consulta categorias ativas, produtos, preços (normal e congelado), quantidades mínimas de congelados, opções de preparo habilitadas (CRU/FRITO, PRÉ-ASSADO/ASSADO PRONTO, CRU/FRITO CONGELADO), adicionais e sabores em tempo real.',
    parameters: {
      type: Type.OBJECT,
      properties: {
        busca: {
          type: Type.STRING,
          description: 'Termo de busca opcional (ex: "coxinha", "assado", "bolinho", "suco", "106"). Deixe vazio para listar resumo das categorias e destaques.',
        },
        categoria: {
          type: Type.STRING,
          description: 'Nome opcional da categoria para filtrar (ex: "Salgados Fritos", "Congelados", "Assados", "Bebidas").',
        },
      },
    },
  },
  {
    name: 'gerenciar_pedido_rascunho',
    description:
      'Adiciona, altera quantidade, remove ou limpa itens do pedido em andamento do cliente. Valida automaticamente modalidade (congelado vs pronto - não permite misturar), opções de preparo ativas no painel e quantidade mínima.',
    parameters: {
      type: Type.OBJECT,
      properties: {
        acao: {
          type: Type.STRING,
          description: 'Ação: "adicionar", "alterar_quantidade", "remover", "limpar" ou "ver".',
        },
        itens: {
          type: Type.ARRAY,
          description: 'Lista de itens para adicionar, alterar ou remover.',
          items: {
            type: Type.OBJECT,
            properties: {
              produto: {
                type: Type.STRING,
                description: 'Nome ou código do produto conforme cardápio.',
              },
              quantidade: {
                type: Type.INTEGER,
                description: 'Quantidade desejada (padrão 1, ou respeitando o mínimo se congelado).',
              },
              modalidade: {
                type: Type.STRING,
                description: '"pronto" para consumo/retirada pronto ou "congelado" para congelados.',
              },
              preparo: {
                type: Type.STRING,
                description:
                  'Tipo de preparo quando aplicável: "CRU", "FRITO", "PRÉ-ASSADO", "ASSADO PRONTO", "CRU CONGELADO" ou "FRITO CONGELADO".',
              },
              sabor: {
                type: Type.STRING,
                description: 'Nome do sabor (para sucos/polpas quando aplicável).',
              },
              adicionais: {
                type: Type.ARRAY,
                items: { type: Type.STRING },
                description: 'Nomes de adicionais para lanches na chapa, se solicitados.',
              },
            },
            required: ['produto'],
          },
        },
      },
      required: ['acao'],
    },
  },
  {
    name: 'consultar_dias_e_horarios_disponiveis',
    description:
      'Consulta os próximos dias úteis abertos e horários disponíveis para retirada no balcão, já descontando o tempo de preparo (normal ou congelado) e mostrando o saldo restante de salgados em cada horário.',
    parameters: {
      type: Type.OBJECT,
      properties: {
        dataOuDia: {
          type: Type.STRING,
          description: 'Opcional: data YYYY-MM-DD, DD/MM, "hoje", "amanha" ou nome do dia da semana (ex: "segunda", "sexta").',
        },
      },
    },
  },
  {
    name: 'definir_dados_retirada_cliente_pagamento',
    description:
      'Registra ou atualiza o dia/horário agendado escolhido, identifica cliente por telefone ou CPF/CNPJ se cadastrado, define nome, WhatsApp, forma de pagamento (PIX, Cartão de Crédito/Débito, Dinheiro) e observações.',
    parameters: {
      type: Type.OBJECT,
      properties: {
        dataStr: {
          type: Type.STRING,
          description: 'Data escolhida no formato YYYY-MM-DD (ex: "2026-11-18") retornada por consultar_dias_e_horarios_disponiveis.',
        },
        horario: {
          type: Type.STRING,
          description: 'Horário escolhido no formato HH:MM (ex: "14:00").',
        },
        nomeCliente: {
          type: Type.STRING,
          description: 'Nome completo ou Razão Social do cliente.',
        },
        telefoneWhatsApp: {
          type: Type.STRING,
          description: 'Telefone/WhatsApp do cliente com DDD.',
        },
        cpfOuCnpj: {
          type: Type.STRING,
          description: 'CPF ou CNPJ do cliente para consulta/identificação automática de cadastro, se informado.',
        },
        formaPagamento: {
          type: Type.STRING,
          description: 'Forma de pagamento: "PIX", "Cartão de Crédito", "Cartão de Débito" ou "Dinheiro".',
        },
        trocoPara: {
          type: Type.STRING,
          description: 'Valor para troco caso pagamento em Dinheiro (opcional).',
        },
        observacoes: {
          type: Type.STRING,
          description: 'Observações adicionais do cliente sobre o pedido (opcional).',
        },
      },
    },
  },
  {
    name: 'finalizar_e_enviar_pedido',
    description:
      'Envia e grava o pedido definitivo no sistema da loja (Painel, Cozinha e Impressora), SOMENTE após o cliente confirmar expressamente o resumo final com itens, preparo, dia/horário de retirada, nome, WhatsApp e pagamento.',
    parameters: {
      type: Type.OBJECT,
      properties: {
        clienteConfirmou: {
          type: Type.BOOLEAN,
          description: 'Deve ser true somente quando o cliente confirmou explicitamente que deseja enviar/fechar o pedido.',
        },
      },
      required: ['clienteConfirmou'],
    },
  },
];

function executeToolCall(
  name: string,
  args: any,
  session: AiSessionState,
  db: LiveDbContext
): Promise<any> | any {
  const { visibleCategories, activeProducts, availableAddons, availableFlavors, frozenExtraVal, storeInfo } =
    buildActiveCatalog(db);

  if (name === 'consultar_cardapio_e_preparo') {
    const buscaNorm = normalizeForMatch(args?.busca || '');
    const catNorm = normalizeForMatch(args?.categoria || '');

    const prepStatusSummary = {
      cruEFritoNormal: storeInfo.salgadoPrepFritoEnabled !== false,
      preAssadoEAssadoProntoNormal: storeInfo.salgadoPrepAssadoEnabled !== false,
      fritosCongelados: storeInfo.salgadoPrepFritoCongeladoEnabled !== false,
      assadosCongelados: storeInfo.salgadoPrepAssadoCongeladoEnabled !== false,
    };

    let filteredCats = visibleCategories.filter((c: any) =>
      activeProducts.some((p: any) => p.categoryId === c.id || p.frozenCategoryId === c.id)
    );
    if (catNorm) {
      filteredCats = filteredCats.filter((c: any) => normalizeForMatch(c.name).includes(catNorm));
    }

    let matchedProducts = activeProducts;
    if (catNorm) {
      const catIds = new Set(filteredCats.map((c: any) => c.id));
      matchedProducts = matchedProducts.filter(
        (p: any) => catIds.has(p.categoryId) || (p.frozenCategoryId && catIds.has(p.frozenCategoryId))
      );
    }

    if (buscaNorm) {
      const tokens = buscaNorm.split(' ').filter((t) => t.length >= 2);
      matchedProducts = matchedProducts.filter((p: any) => {
        const pNorm = normalizeForMatch(p.name);
        const code = String(p.externalId || '').toLowerCase();
        return (
          (code && code === buscaNorm) ||
          pNorm.includes(buscaNorm) ||
          (tokens.length > 0 && tokens.every((t) => pNorm.includes(t)))
        );
      });
    }

    const itemsFormatted = matchedProducts.slice(0, buscaNorm || catNorm ? 40 : 30).map((p: any) => {
      const normalCtx = resolveProductContext(p, 'pronto', visibleCategories, storeInfo, frozenExtraVal);
      const frozenCtx = resolveProductContext(p, 'congelado', visibleCategories, storeInfo, frozenExtraVal);
      const primaryCat = visibleCategories.find((c: any) => c.id === p.categoryId);

      const itemInfo: any = {
        id: p.id,
        codigo: p.externalId || undefined,
        nome: p.name,
        categoria: primaryCat?.name || '',
        descricao: p.description || '',
      };

      if (!('error' in normalCtx) && normalCtx.supportsNormal) {
        itemInfo.opcaoPronto = {
          preco: Number(normalCtx.displayUnitPrice.toFixed(2)),
          preparoObrigatorio: normalCtx.prepConfig.needsPrepChoice
            ? normalCtx.prepConfig.allowedOptions.map((o) => o.label)
            : [],
        };
      }

      if (!('error' in frozenCtx) && frozenCtx.supportsFrozen) {
        itemInfo.opcaoCongelado = {
          precoUnitarioComAcrescimo: Number(frozenCtx.displayUnitPrice.toFixed(2)),
          quantidadeMinima: frozenCtx.minRequired,
          preparoObrigatorio: frozenCtx.prepConfig.needsPrepChoice
            ? frozenCtx.prepConfig.allowedOptions.map((o) => o.label)
            : [],
        };
      }

      return itemInfo;
    });

    return {
      opcoesDePreparoAtivasNoPainel: prepStatusSummary,
      categoriasAtivas: filteredCats.map((c: any) => ({
        nome: c.name,
        modalidade: isCategoryFrozenModality(c) ? 'congelado' : 'pronto',
      })),
      totalProdutosEncontrados: matchedProducts.length,
      produtos: itemsFormatted,
      saboresSucoDisponiveis: availableFlavors.slice(0, 20).map((f: any) => f.name),
      adicionaisChapaDisponiveis: availableAddons.slice(0, 20).map((a: any) => ({
        nome: a.name,
        preco: Number(a.price),
      })),
    };
  }

  if (name === 'gerenciar_pedido_rascunho') {
    const acao = String(args?.acao || 'ver').toLowerCase();

    if (acao === 'ver') {
      return {
        status: 'OK',
        rascunho: formatDraftForResponse(session) || { items: [], total: 0, totalUnits: 0 },
      };
    }

    if (acao === 'limpar') {
      session.items = [];
      session.scheduledDate = null;
      session.scheduledDay = null;
      session.scheduledTime = null;
      session.scheduledPickupTime = null;
      return {
        status: 'CARRINHO_LIMPO',
        rascunho: formatDraftForResponse(session) || { items: [], total: 0, totalUnits: 0 },
      };
    }

    const reqItems = Array.isArray(args?.itens) ? args.itens : [];
    if (reqItems.length === 0) {
      return { status: 'ERRO', mensagem: 'Nenhum item informado para atualizar no rascunho.' };
    }

    const warnings: string[] = [];
    const addedOrUpdated: string[] = [];

    for (const reqItem of reqItems) {
      const prod = findBestProductMatch(reqItem.produto, activeProducts);
      if (!prod) {
        warnings.push(`Não encontrei o produto "${reqItem.produto}" no cardápio ativo.`);
        continue;
      }

      if (acao === 'remover') {
        const before = session.items.length;
        session.items = session.items.filter((it) => it.productId !== prod.id);
        if (session.items.length < before) {
          addedOrUpdated.push(`Removido: ${prod.name}`);
        } else {
          warnings.push(`"${prod.name}" não estava no pedido.`);
        }
        continue;
      }

      const requestedModalityRaw = normalizeText(reqItem.modalidade || '');
      const requestedModality: 'pronto' | 'congelado' | undefined =
        requestedModalityRaw.includes('congelad')
          ? 'congelado'
          : requestedModalityRaw.includes('pronto') || requestedModalityRaw.includes('normal')
          ? 'pronto'
          : normalizeText(reqItem.preparo || '').includes('congelad')
          ? 'congelado'
          : undefined;

      const ctx = resolveProductContext(prod, requestedModality, visibleCategories, storeInfo, frozenExtraVal);
      if ('error' in ctx) {
        warnings.push(ctx.error);
        continue;
      }

      // Check modality conflict with existing items in draft
      if (session.items.length > 0) {
        const draftHasFrozen = session.items.some((it) => it.isFrozen);
        if (draftHasFrozen && !ctx.isFrozenContext) {
          warnings.push(
            `CONFLITO_MODALIDADE: O pedido atual já contém salgados CONGELADOS (prazo até 48h). Não é possível misturar "${prod.name}" pronto no mesmo pedido. Pergunte ao cliente se deseja concluir os congelados primeiro ou limpar o carrinho para fazer só de prontos.`
          );
          continue;
        }
        if (!draftHasFrozen && ctx.isFrozenContext) {
          warnings.push(
            `CONFLITO_MODALIDADE: O pedido atual contém itens PRONTOS. Não é possível misturar "${prod.name}" CONGELADO no mesmo pedido. Pergunte ao cliente se deseja fazer separado.`
          );
          continue;
        }
      }

      // Validate prep option if required for this item
      let chosenPrepType: string | undefined;
      let chosenPrepLabel: string | undefined;
      if (ctx.prepConfig.needsPrepChoice) {
        const resolvedPrep = resolvePrepChoiceFromText(
          reqItem.preparo,
          ctx.prepConfig.allowedOptions,
          ctx.prepConfig.isBakedCategory
        );
        if (!resolvedPrep) {
          warnings.push(
            `PRECISA_ESCOLHER_PREPARO: Para "${prod.name}" (${ctx.isFrozenContext ? 'Congelado' : 'Pronto'}), pergunte ao cliente como deseja o preparo: ${ctx.prepConfig.allowedOptions.map((o) => o.label).join(' ou ')}.`
          );
          continue;
        }
        if ('disabledReason' in resolvedPrep) {
          warnings.push(resolvedPrep.disabledReason);
          continue;
        }
        chosenPrepType = resolvedPrep.prepType;
        chosenPrepLabel = resolvedPrep.label;
      }

      let qty = Math.max(1, parseInt(String(reqItem.quantidade || 1), 10) || 1);
      if (ctx.isFrozenContext && qty < ctx.minRequired) {
        qty = ctx.minRequired;
        warnings.push(
          `Quantidade ajustada para o mínimo obrigatório de ${ctx.minRequired} unidades congeladas para "${prod.name}".`
        );
      }

      // Resolve flavor if specified
      let resolvedFlavor: AiDraftItem['flavor'] = null;
      if (reqItem.sabor) {
        const sNorm = normalizeForMatch(reqItem.sabor);
        const foundF = availableFlavors.find((f: any) => normalizeForMatch(f.name).includes(sNorm));
        if (foundF) {
          resolvedFlavor = {
            productId: foundF.id,
            name: foundF.name,
            price: Number(foundF.price) || 0,
            externalId: foundF.externalId || foundF.code || '',
            code: foundF.code || foundF.externalId || '',
          };
        }
      }

      // Resolve addons (including frozen extra addon if frozen salgado)
      const resolvedAddons: AiDraftItem['addons'] = [];
      if (ctx.isFrozenContext && ctx.isSalgado) {
        const foundCong = db.products.find((p: any) => p && p.id === 'prod_congelado');
        resolvedAddons.push({
          productId: foundCong?.id || 'prod_congelado',
          name: 'Acréscimo Congelado',
          price: frozenExtraVal,
          externalId: foundCong?.externalId || '9999',
          code: foundCong?.externalId || '9999',
          isFrozen: true,
        });
      }
      if (Array.isArray(reqItem.adicionais)) {
        for (const adName of reqItem.adicionais) {
          const aNorm = normalizeForMatch(adName);
          const foundA = availableAddons.find((a: any) => normalizeForMatch(a.name).includes(aNorm));
          if (foundA) {
            resolvedAddons.push({
              productId: foundA.id,
              name: foundA.name,
              price: Number(foundA.price) || 0,
              externalId: foundA.externalId || foundA.code || '',
              code: foundA.code || foundA.externalId || '',
              isFrozen: false,
            });
          }
        }
      }

      const prodCode = String(prod.externalId || prod.code || '').trim();
      const descWithCode = formatProductDescriptionWithCode(prod.description, prodCode);

      const existingIdx = session.items.findIndex(
        (it) =>
          it.productId === prod.id &&
          (it.prepType || '') === (chosenPrepType || '') &&
          it.isFrozen === ctx.isFrozenContext &&
          JSON.stringify(it.addons) === JSON.stringify(resolvedAddons) &&
          JSON.stringify(it.flavor) === JSON.stringify(resolvedFlavor)
      );

      if (acao === 'alterar_quantidade') {
        if (existingIdx >= 0) {
          session.items[existingIdx].quantity = qty;
          addedOrUpdated.push(`Atualizado: ${qty}x ${prod.name}`);
        } else {
          session.items.push({
            productId: prod.id,
            externalId: prodCode,
            code: prodCode,
            name: prod.name,
            description: descWithCode,
            imageUrl: prod.imageUrl,
            price: Number(prod.price) || 0,
            quantity: qty,
            isFrozen: ctx.isFrozenContext,
            prepType: chosenPrepType,
            prepLabel: chosenPrepLabel || getPrepChoiceLabel(chosenPrepType) || undefined,
            addons: resolvedAddons,
            flavor: resolvedFlavor,
          });
          addedOrUpdated.push(`Adicionado: ${qty}x ${prod.name}`);
        }
      } else {
        // adicionar
        if (existingIdx >= 0) {
          session.items[existingIdx].quantity += qty;
          addedOrUpdated.push(`Somado +${qty}x ${prod.name} (total ${session.items[existingIdx].quantity}x)`);
        } else {
          session.items.push({
            productId: prod.id,
            externalId: prodCode,
            code: prodCode,
            name: prod.name,
            description: descWithCode,
            imageUrl: prod.imageUrl,
            price: Number(prod.price) || 0,
            quantity: qty,
            isFrozen: ctx.isFrozenContext,
            prepType: chosenPrepType,
            prepLabel: chosenPrepLabel || getPrepChoiceLabel(chosenPrepType) || undefined,
            addons: resolvedAddons,
            flavor: resolvedFlavor,
          });
          addedOrUpdated.push(
            `Adicionado: ${qty}x ${prod.name}${chosenPrepLabel ? ` (${chosenPrepLabel})` : ''}`
          );
        }
      }
    }

    // Re-validate scheduled slot capacity if already chosen
    if (session.scheduledDate && session.scheduledTime) {
      const avail = computeScheduleAvailability(
        db,
        session.items.some((it) => it.isFrozen),
        computeDraftUnits(session.items),
        session.scheduledDate
      );
      const dayMatch = avail.days.find((d) => d.dateStr === session.scheduledDate);
      const slotMatch = dayMatch?.availableSlots.find((s) => s.slot === session.scheduledTime);
      if (!slotMatch || !slotMatch.fitsOrder) {
        const oldTime = session.scheduledTime;
        session.scheduledDate = null;
        session.scheduledDay = null;
        session.scheduledTime = null;
        session.scheduledPickupTime = null;
        warnings.push(
          `Atenção: O horário ${oldTime} que estava selecionado não comporta a nova quantidade de itens ou expirou. Peça ao cliente para escolher outro horário disponível.`
        );
      }
    }

    return {
      status: warnings.length > 0 && addedOrUpdated.length === 0 ? 'PENDENCIA_OU_VALIDACAO' : 'OK',
      acoesRealizadas: addedOrUpdated,
      avisos: warnings,
      rascunho: formatDraftForResponse(session),
    };
  }

  if (name === 'consultar_dias_e_horarios_disponiveis') {
    const hasFrozen = session.items.some((it) => it.isFrozen);
    const totalUnits = computeDraftUnits(session.items);
    const avail = computeScheduleAvailability(db, hasFrozen, totalUnits, args?.dataOuDia);
    return {
      agendamentoObrigatorio: avail.scheduleEnabled,
      horaAtualBrasilia: avail.todayBrazilTime,
      intervaloMinutos: avail.intervalMinutes,
      tempoPreparoAplicadoMinutos: avail.activePrepBuffer,
      modalidadeAtual: hasFrozen ? 'CONGELADO' : 'NORMAL / PRONTO',
      quantidadeTotalNoPedido: totalUnits,
      diasDisponiveis: avail.days.map((d) => ({
        dataStr: d.dateStr,
        diaFormatado: d.dayName,
        hoje: d.isToday,
        abre: d.openTime,
        fecha: d.closeTime,
        horarios: d.availableSlots.map((s) => ({
          horario: s.slot,
          retiradaEstimada: s.estimatedPickupTime,
          salgadosRestantesNoHorario: s.remainingUnits,
          cabeQuantidadeDoPedido: s.fitsOrder,
        })),
      })),
    };
  }

  if (name === 'definir_dados_retirada_cliente_pagamento') {
    const updates: string[] = [];
    const errors: string[] = [];

    // Customer lookup by CPF/CNPJ or phone
    const cleanCpf = String(args?.cpfOuCnpj || '').replace(/\D/g, '');
    const cleanPhone = String(args?.telefoneWhatsApp || '').replace(/\D/g, '');

    if (cleanCpf.length >= 5 || cleanPhone.length >= 8) {
      const foundCustomer = (db.customers || []).find((c: any) => {
        const cCpf = String(c.cpf || '').replace(/\D/g, '');
        const cPhone = String(c.phone || '').replace(/\D/g, '');
        return (
          (cleanCpf.length >= 5 && cCpf && (cCpf === cleanCpf || cCpf.replace(/^0+/, '') === cleanCpf.replace(/^0+/, ''))) ||
          (cleanPhone.length >= 8 && cPhone && (cPhone.endsWith(cleanPhone.slice(-8)) || cleanPhone.endsWith(cPhone.slice(-8))))
        );
      });
      if (foundCustomer) {
        session.customerId = foundCustomer.id;
        if (!session.customerName && foundCustomer.name) session.customerName = foundCustomer.name;
        if (!session.customerPhone && foundCustomer.phone) session.customerPhone = foundCustomer.phone;
        if (!session.customerCpf && foundCustomer.cpf) session.customerCpf = foundCustomer.cpf;
        updates.push(`Cliente reconhecido no cadastro: ${foundCustomer.name}`);
      }
    }

    if (args?.nomeCliente && String(args.nomeCliente).trim()) {
      session.customerName = String(args.nomeCliente).trim();
      updates.push(`Nome: ${session.customerName}`);
    }
    if (args?.telefoneWhatsApp && String(args.telefoneWhatsApp).trim()) {
      session.customerPhone = String(args.telefoneWhatsApp).trim();
      updates.push(`WhatsApp: ${session.customerPhone}`);
    }
    if (args?.cpfOuCnpj && String(args.cpfOuCnpj).trim()) {
      session.customerCpf = String(args.cpfOuCnpj).trim();
    }
    if (args?.formaPagamento && String(args.formaPagamento).trim()) {
      const pNorm = normalizeText(args.formaPagamento);
      if (pNorm.includes('pix')) session.paymentMethod = 'PIX';
      else if (pNorm.includes('dinheir')) session.paymentMethod = 'Dinheiro';
      else if (pNorm.includes('deb')) session.paymentMethod = 'Cartão de Débito';
      else if (pNorm.includes('cred') || pNorm.includes('cart')) session.paymentMethod = 'Cartão de Crédito / Débito';
      else session.paymentMethod = String(args.formaPagamento).trim();
      updates.push(`Pagamento: ${session.paymentMethod}`);
    }
    if (args?.trocoPara !== undefined) {
      session.cashChange = String(args.trocoPara).trim();
    }
    if (args?.observacoes !== undefined) {
      session.notes = String(args.observacoes).trim();
    }

    // Validate & set schedule date/time
    if (args?.dataStr || args?.horario) {
      const hasFrozen = session.items.some((it) => it.isFrozen);
      const totalUnits = computeDraftUnits(session.items);
      const avail = computeScheduleAvailability(db, hasFrozen, totalUnits);

      let chosenDay = args?.dataStr
        ? avail.days.find(
            (d) =>
              d.dateStr === String(args.dataStr).trim() ||
              d.dateFormatted === String(args.dataStr).trim() ||
              normalizeText(d.dayName).includes(normalizeText(String(args.dataStr)))
          )
        : session.scheduledDate
        ? avail.days.find((d) => d.dateStr === session.scheduledDate)
        : avail.days[0];

      if (!chosenDay) {
        errors.push('Data de retirada informada não está disponível ou loja fechada neste dia.');
      } else if (args?.horario) {
        const cleanSlot = String(args.horario).trim().replace(/h$/i, '').padStart(5, '0');
        const slotInfo = chosenDay.availableSlots.find((s) => s.slot === cleanSlot);
        if (!slotInfo) {
          errors.push(
            `O horário ${cleanSlot} não está disponível em ${chosenDay.dayName}. Horários disponíveis: ${chosenDay.availableSlots
              .slice(0, 8)
              .map((s) => s.slot)
              .join(', ')}.`
          );
        } else if (!slotInfo.fitsOrder) {
          errors.push(
            `O horário ${cleanSlot} tem apenas ${slotInfo.remainingUnits} vagas restantes, mas o pedido possui ${totalUnits} salgados/itens. Escolha outro horário.`
          );
        } else {
          session.scheduledDate = chosenDay.dateStr;
          session.scheduledDay = chosenDay.dayName;
          session.scheduledTime = slotInfo.slot;
          session.scheduledPickupTime = slotInfo.estimatedPickupTime;
          updates.push(
            `Agendado para ${chosenDay.dayName} às ${slotInfo.slot} (retirada estimada às ${slotInfo.estimatedPickupTime}h)`
          );
        }
      } else {
        session.scheduledDate = chosenDay.dateStr;
        session.scheduledDay = chosenDay.dayName;
        updates.push(`Dia selecionado: ${chosenDay.dayName} (agora falta definir o horário)`);
      }
    }

    return {
      status: errors.length > 0 ? 'ERRO_VALIDACAO' : 'OK',
      atualizacoes: updates,
      erros: errors,
      rascunho: formatDraftForResponse(session),
    };
  }

  if (name === 'finalizar_e_enviar_pedido') {
    if (!args?.clienteConfirmou) {
      return {
        status: 'AGUARDANDO_CONFIRMACAO',
        mensagem: 'Apresente o resumo completo ao cliente e peça confirmação explícita antes de enviar.',
      };
    }

    const missing: string[] = [];
    if (!session.items.length) missing.push('itens no pedido');
    if (storeInfo.deliveryScheduleEnabled !== false && (!session.scheduledDate || !session.scheduledTime)) {
      missing.push('dia e horário de retirada');
    }
    if (!session.customerName.trim()) missing.push('nome do cliente');
    if (!session.customerPhone.trim()) missing.push('telefone/WhatsApp do cliente');
    if (!session.paymentMethod.trim()) missing.push('forma de pagamento (PIX, Cartão ou Dinheiro)');

    if (missing.length > 0) {
      return {
        status: 'FALTANDO_DADOS',
        camposFaltantes: missing,
        mensagem: `Ainda faltam os seguintes dados obrigatórios para enviar o pedido: ${missing.join(', ')}.`,
      };
    }

    // Re-check live slot capacity right before committing!
    const hasFrozen = session.items.some((it) => it.isFrozen);
    const totalUnits = computeDraftUnits(session.items);
    if (session.scheduledDate && session.scheduledTime) {
      const avail = computeScheduleAvailability(db, hasFrozen, totalUnits, session.scheduledDate);
      const dayMatch = avail.days.find((d) => d.dateStr === session.scheduledDate);
      const slotMatch = dayMatch?.availableSlots.find((s) => s.slot === session.scheduledTime);
      if (!slotMatch || !slotMatch.fitsOrder) {
        return {
          status: 'HORARIO_ESGOTADO',
          mensagem: `O horário ${session.scheduledTime} em ${session.scheduledDay} acabou de atingir o limite. Peça ao cliente para escolher outro horário disponível.`,
        };
      }
    }

    const finalTotal = computeDraftTotal(session.items);
    const finalPayment =
      session.paymentMethod === 'Dinheiro' && session.cashChange
        ? `Dinheiro (Troco para ${session.cashChange})`
        : session.paymentMethod;

    const orderPayload = {
      items: session.items,
      total: Number(finalTotal.toFixed(2)),
      type: 'online',
      deliveryType: 'pickup',
      paymentMethod: finalPayment,
      customerId: session.customerId || undefined,
      customerName: session.customerName.trim(),
      customerPhone: session.customerPhone.trim(),
      customerCpf: session.customerCpf || '',
      scheduledDate: session.scheduledDate,
      scheduledDay: session.scheduledDay,
      scheduledTime: session.scheduledTime,
      scheduledPickupTime: session.scheduledPickupTime,
      notes: session.notes || undefined,
    };

    return db
      .createOrder(orderPayload)
      .then((created) => {
        const placedSummary = {
          orderId: String(created?.id || ''),
          total: Number(finalTotal.toFixed(2)),
          items: [...session.items],
          scheduledDate: session.scheduledDate,
          scheduledDay: session.scheduledDay,
          scheduledTime: session.scheduledTime,
          scheduledPickupTime: session.scheduledPickupTime,
          paymentMethod: finalPayment,
          customerName: session.customerName.trim(),
          customerPhone: session.customerPhone.trim(),
        };
        session.lastPlacedOrder = placedSummary;
        session.items = [];
        session.scheduledDate = null;
        session.scheduledDay = null;
        session.scheduledTime = null;
        session.scheduledPickupTime = null;

        return {
          status: 'PEDIDO_ENVIADO_COM_SUCESSO',
          pedidoId: placedSummary.orderId,
          total: placedSummary.total,
          diaRetirada: placedSummary.scheduledDay,
          horarioAgendado: placedSummary.scheduledTime,
          retiradaEstimada: placedSummary.scheduledPickupTime,
          pagamento: placedSummary.paymentMethod,
          mensagem: `Pedido #${placedSummary.orderId} registrado com sucesso no sistema!`,
        };
      })
      .catch((err: any) => ({
        status: 'ERRO_AO_SALVAR',
        mensagem: err?.message || 'Erro interno ao registrar o pedido.',
      }));
  }

  return { status: 'ERRO', mensagem: `Ferramenta desconhecida: ${name}` };
}

function buildSystemInstruction(db: LiveDbContext, session: AiSessionState): string {
  const storeInfo = db.storeInfo || {};
  const weeklySchedule = parseWeeklySchedule(storeInfo.weeklySchedule);
  const currentStatus = getStoreCurrentStatus(
    storeInfo.weeklySchedule,
    storeInfo.isOpen !== false,
    storeInfo.autoOpenClose !== false,
    !!storeInfo.forceOpen
  );

  const agentName = storeInfo.aiAgentName || 'Balbec IA';
  const agentTone = storeInfo.aiAgentTone || 'amigavel';
  const customPrompt = storeInfo.aiAgentCustomPrompt || '';
  const knowledgeBase = storeInfo.aiAgentKnowledgeBase || '';
  const forbiddenPhrases = storeInfo.aiAgentForbiddenPhrases || '';
  const whatsappNumber = storeInfo.aiAgentWhatsAppPhone || storeInfo.whatsapp || '';

  let parsedTrainingExamples: Array<{ question: string; answer: string; active?: boolean }> = [];
  try {
    if (typeof storeInfo.aiAgentTrainingExamples === 'string' && storeInfo.aiAgentTrainingExamples.trim()) {
      parsedTrainingExamples = JSON.parse(storeInfo.aiAgentTrainingExamples);
    } else if (Array.isArray(storeInfo.aiAgentTrainingExamples)) {
      parsedTrainingExamples = storeInfo.aiAgentTrainingExamples;
    }
  } catch {
    parsedTrainingExamples = [];
  }

  const activeExamples = parsedTrainingExamples.filter(
    (ex) => ex && ex.active !== false && ex.question && ex.answer
  );
  const examplesText =
    activeExamples.length > 0
      ? activeExamples
          .map(
            (ex, idx) =>
              `[EXEMPLO ${idx + 1}]\nCliente: "${ex.question}"\nResposta ideal: "${ex.answer}"`
          )
          .join('\n\n')
      : '';

  const toneDescription =
    agentTone === 'direto'
      ? 'Seja direto, rápido, natural e cordial, sem enrolação.'
      : agentTone === 'especialista'
      ? 'Seja um atendente experiente e simpático, explicando bem os diferenciais de cada salgado e preparo.'
      : 'Seja caloroso, simpático, natural e humano, como o melhor atendente de WhatsApp da loja.';

  const draftSummary = formatDraftForResponse(session);

  return `Você é "${agentName}", atendente virtual oficial da "${storeInfo.name || 'BALBEC - REVENDA'}".
Converse de forma natural em Português do Brasil, exatamente como um atendente humano atencioso no WhatsApp.

DADOS DA LOJA:
- Nome: ${storeInfo.name || 'BALBEC - REVENDA'}
- Endereço: ${storeInfo.address || 'Praça Dr. Jorge Frange, 72 - São Benedito, Uberaba - MG'}
- WhatsApp/Telefone: ${whatsappNumber || '(34) 3338-3795'}
- Status em tempo real: ${currentStatus.isOpenNow ? 'ABERTO AGORA' : 'FECHADO NO MOMENTO'} (${currentStatus.details})
- Funcionamento semanal: ${weeklySchedule.map((d) => `${d.dayName}: ${d.isOpen ? `${d.openTime}-${d.closeTime}` : 'Fechado'}`).join(' | ')}
- Modalidade exclusiva: SOMENTE Retirada no Balcão da Loja (NÃO trabalhamos com Delivery).
- Pagamentos aceitos: PIX, Cartão de Crédito/Débito ou Dinheiro (com troco se precisar).

${customPrompt ? `SOBRE A LOJA:\n${customPrompt}\n` : ''}
${knowledgeBase ? `POLÍTICAS E BASE DE CONHECIMENTO:\n${knowledgeBase}\n` : ''}
${forbiddenPhrases ? `RESTRIÇÕES (NUNCA DIZER):\n${forbiddenPhrases}\n` : ''}
${examplesText ? `EXEMPLOS DE ESTILO:\n${examplesText}\n` : ''}

COMO CONDUZIR O ATENDIMENTO COM AS FERRAMENTAS (REGRAS OBRIGATÓRIAS):
1. NUNCA invente produtos, preços, opções de preparo ou horários. Sempre chame \`consultar_cardapio_e_opcoes\` antes de citar itens/preços e \`consultar_dias_e_horarios_disponiveis\` antes de informar dias/horários disponíveis.
2. Quando o cliente pedir salgados/itens, use \`gerenciar_pedido_rascunho\` (acao: "adicionar").
   - Se o produto tiver escolha de preparo ativa (CRU ou FRITO, PRÉ-ASSADO ou ASSADO PRONTO, CRU CONGELADO ou FRITO CONGELADO) e o cliente não informou qual quer, pergunte de forma natural antes de adicionar!
   - Nunca ofereça opções de preparo que não estejam ativas no retorno das ferramentas.
   - Se o cliente tentar misturar CONGELADO com PRONTO/NORMAL no mesmo pedido, explique educadamente que congelados (prazo de preparo maior / 48h) e prontos não podem ser misturados no mesmo pedido e ajude-o a escolher.
   - Respeite a quantidade mínima de congelados quando aplicável.
3. Depois de montar os itens, pergunte se deseja mais alguma coisa e conduza naturalmente para:
   - Escolha do **dia e horário de retirada** (mostre apenas dias abertos e horários com saldo suficiente usando \`consultar_dias_e_horarios_disponiveis\`, citando também o horário estimado de retirada se relevante);
   - **Nome e WhatsApp** (se já informado ou reconhecido via \`definir_dados_retirada_cliente_pagamento\`, confirme sem pedir de novo);
   - **Forma de pagamento** (PIX, Cartão ou Dinheiro). IMPORTANTE: para pedidos com **produtos congelados**, mesmo que o cliente opte por pagar na retirada, informe que há duas opções no fechamento: **Pagamento Integral (100%)** ou **Pagamento Parcial (50% de entrada via PIX ou Cartão de Débito + 50% na retirada)**.
4. Sempre que o cliente informar dia, horário, nome, telefone, CPF/CNPJ ou pagamento, salve usando \`definir_dados_retirada_cliente_pagamento\`.
5. Antes de enviar o pedido definitivo, mostre um **resumo completo e claro** (itens + preparo + dia/horário + cliente + pagamento + total) e peça confirmação final ("Posso confirmar e enviar o seu pedido?").
6. Somente após o cliente confirmar expressamente ("sim", "pode enviar", "confirmo", "fechado", etc.), chame \`finalizar_e_enviar_pedido(clienteConfirmou: true)\` para gravar o pedido de verdade no sistema e informe o número do pedido!
7. Nunca repita saudações como "Olá!" se a conversa já estiver em andamento. Seja objetivo, claro e agradável.
8. Tom de voz: ${toneDescription}

ESTADO ATUAL DO RASCUNHO DESTA CONVERSA:
${draftSummary ? JSON.stringify(draftSummary) : 'Nenhum item no rascunho ainda.'}`;
}

export async function processAiConversationTurn(params: {
  sessionId: string;
  userMessage: string;
  history?: Array<{ role?: string; sender?: string; content?: string; text?: string }>;
  customerContext?: any;
  db: LiveDbContext;
}): Promise<{
  sessionId: string;
  reply: string;
  draftOrder: any | null;
  placedOrder: any | null;
  structuredOrder: { items: Array<{ name: string; quantity: number; price: number }>; total: number } | null;
  whatsappLink: string;
  agentName: string;
}> {
  const { sessionId, userMessage, history = [], customerContext, db } = params;
  const session = getOrCreateSession(sessionId, customerContext);
  const storeInfo = db.storeInfo || {};
  const agentName = storeInfo.aiAgentName || 'Balbec IA';
  const whatsappNumber = storeInfo.aiAgentWhatsAppPhone || storeInfo.whatsapp || '';
  const cleanPhone = whatsappNumber.replace(/\D/g, '');
  const whatsappLink = cleanPhone
    ? `https://wa.me/55${cleanPhone.replace(/^55/, '')}?text=${encodeURIComponent(`Olá! Estava conversando com ${agentName} sobre meu pedido.`)}`
    : '';

  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey) {
    const fallback = generateConversationalFallback(userMessage, db, agentName);
    return {
      sessionId: session.sessionId,
      reply: fallback,
      draftOrder: formatDraftForResponse(session),
      placedOrder: null,
      structuredOrder: null,
      whatsappLink,
      agentName,
    };
  }

  const ai = new GoogleGenAI({
    apiKey,
    httpOptions: {
      headers: {
        'User-Agent': 'aistudio-build',
      },
    },
  });

  // Normalize alternating conversation history
  const rawTurns: Array<{ role: 'user' | 'model'; text: string }> = [];
  if (Array.isArray(history)) {
    for (const msg of history) {
      const role: 'user' | 'model' =
        msg.role === 'assistant' || msg.role === 'model' || msg.sender === 'assistant' ? 'model' : 'user';
      const text = (msg.content || msg.text || '').trim();
      if (text) rawTurns.push({ role, text });
    }
  }

  if (userMessage && userMessage.trim()) {
    const lastTurn = rawTurns[rawTurns.length - 1];
    if (!lastTurn || lastTurn.role !== 'user' || lastTurn.text !== userMessage.trim()) {
      rawTurns.push({ role: 'user', text: userMessage.trim() });
    }
  }

  while (rawTurns.length > 0 && rawTurns[0].role === 'model') {
    rawTurns.shift();
  }
  if (rawTurns.length === 0) {
    rawTurns.push({ role: 'user', text: userMessage?.trim() || 'Olá!' });
  }

  const alternatingTurns: Array<{ role: 'user' | 'model'; text: string }> = [];
  for (const turn of rawTurns) {
    if (alternatingTurns.length === 0) {
      alternatingTurns.push({ ...turn });
    } else {
      const prev = alternatingTurns[alternatingTurns.length - 1];
      if (prev.role === turn.role) {
        prev.text += `\n${turn.text}`;
      } else {
        alternatingTurns.push({ ...turn });
      }
    }
  }
  if (alternatingTurns[alternatingTurns.length - 1]?.role !== 'user') {
    alternatingTurns.push({ role: 'user', text: userMessage?.trim() || 'Pode continuar?' });
  }

  const contents: any[] = alternatingTurns.map((t) => ({
    role: t.role,
    parts: [{ text: t.text }],
  }));

  const prevPlacedId = session.lastPlacedOrder?.orderId || null;
  let finalReply = '';
  const MAX_TOOL_STEPS = 6;
  let activeModel = 'gemini-4-hydrogen';

  for (let step = 0; step < MAX_TOOL_STEPS; step++) {
    let response: any;
    try {
      response = await ai.models.generateContent({
        model: activeModel,
        contents,
        config: {
          systemInstruction: buildSystemInstruction(db, session),
          tools: [{ functionDeclarations: AI_TOOL_DECLARATIONS }],
        },
      });
    } catch (err: any) {
      console.warn(`[AI Agent] Model ${activeModel} error on step ${step}:`, err?.message || err);
      if (activeModel === 'gemini-4-hydrogen') {
        activeModel = 'gemini-3.1-flash-lite';
        try {
          response = await ai.models.generateContent({
            model: activeModel,
            contents,
            config: {
              systemInstruction: buildSystemInstruction(db, session),
              tools: [{ functionDeclarations: AI_TOOL_DECLARATIONS }],
            },
          });
        } catch (fallbackErr: any) {
          console.error('[AI Agent] Secondary model failed:', fallbackErr?.message || fallbackErr);
          finalReply = generateConversationalFallback(userMessage, db, agentName);
          break;
        }
      } else {
        finalReply = generateConversationalFallback(userMessage, db, agentName);
        break;
      }
    }

    const candidateContent = response?.candidates?.[0]?.content;
    const functionCalls = response?.functionCalls;

    if (functionCalls && functionCalls.length > 0 && candidateContent) {
      contents.push(candidateContent);
      const responseParts: any[] = [];

      for (const fc of functionCalls) {
        const result = await executeToolCall(fc.name, fc.args || {}, session, db);
        responseParts.push({
          functionResponse: {
            id: fc.id,
            name: fc.name,
            response: { result },
          },
        });
      }

      contents.push({
        role: 'user',
        parts: responseParts,
      });
      continue;
    }

    finalReply = (response?.text || '').trim();
    break;
  }

  if (!finalReply) {
    finalReply = 'Como posso te ajudar com seu pedido hoje?';
  }

  const newlyPlacedOrder =
    session.lastPlacedOrder && session.lastPlacedOrder.orderId !== prevPlacedId
      ? session.lastPlacedOrder
      : null;

  const draftOrder = formatDraftForResponse(session);
  const structuredOrder = draftOrder?.items?.length
    ? {
        items: draftOrder.items.map((it: any) => ({
          name: it.prepLabel ? `${it.name} (${it.prepLabel})` : it.name,
          quantity: it.quantity,
          price:
            Number(it.price) +
            (it.flavor ? Number(it.flavor.price) || 0 : 0) +
            (it.addons || []).reduce((s: number, a: any) => s + (Number(a.price) || 0), 0),
        })),
        total: draftOrder.total,
      }
    : null;

  return {
    sessionId: session.sessionId,
    reply: finalReply,
    draftOrder,
    placedOrder: newlyPlacedOrder,
    structuredOrder,
    whatsappLink,
    agentName,
  };
}

function generateConversationalFallback(userQuery: string, db: LiveDbContext, agentName: string): string {
  const { visibleCategories, activeProducts, frozenExtraVal, storeInfo } = buildActiveCatalog(db);
  const avail = computeScheduleAvailability(db, false, 0);
  const q = normalizeForMatch(userQuery || '');

  if (q.includes('horario') || q.includes('dia') || q.includes('retirada') || q.includes('agend')) {
    const firstDay = avail.days[0];
    const slotsPreview = firstDay
      ? firstDay.availableSlots
          .slice(0, 6)
          .map((s) => `${s.slot} (${s.remainingUnits} un livres)`)
          .join(', ')
      : 'Consulte o cardápio';
    return `Próximos dias abertos para retirada no balcão:\n${avail.days
      .slice(0, 4)
      .map((d) => `• ${d.dayName} (${d.availableSlots.length} horários disponíveis)`)
      .join('\n')}\n\n${firstDay ? `Exemplos em ${firstDay.dayName}: ${slotsPreview}` : ''}`;
  }

  const sample = activeProducts.slice(0, 6).map((p: any) => {
    const frozenCtx = resolveProductContext(p, 'congelado', visibleCategories, storeInfo, frozenExtraVal);
    const extra = !('error' in frozenCtx) && frozenCtx.supportsFrozen ? ` | Congelado: R$ ${frozenCtx.displayUnitPrice.toFixed(2).replace('.', ',')}` : '';
    return `• **${p.name}** — R$ ${Number(p.price).toFixed(2).replace('.', ',')}${extra}`;
  });

  return `Olá! Sou **${agentName}**. No momento estou operando no modo resumido, mas posso te mostrar nossos destaques:\n\n${sample.join('\n')}\n\nQual item você gostaria de pedir e para qual dia/horário de retirada?`;
}

export function registerAiRoutes(app: any, getLiveDbState: () => LiveDbContext) {
  app.post('/api/ai/chat', async (req: Request, res: Response) => {
    try {
      const { sessionId, messages, userMessage, customerContext } = req.body || {};
      const db = getLiveDbState();
      const result = await processAiConversationTurn({
        sessionId: sessionId || `web_${req.ip || 'anon'}`,
        userMessage: String(userMessage || ''),
        history: Array.isArray(messages) ? messages : [],
        customerContext,
        db,
      });
      return res.json(result);
    } catch (error: any) {
      console.error('[AI Route Error /api/ai/chat]:', error?.message || error);
      return res.status(500).json({
        error: 'Não foi possível processar a resposta do atendente virtual no momento.',
        details: error?.message || String(error),
      });
    }
  });

  app.post('/api/ai/reset', (req: Request, res: Response) => {
    const sessionId = String(req.body?.sessionId || '').trim();
    if (sessionId) {
      aiSessions.delete(sessionId);
    }
    return res.json({ success: true });
  });

  // Direct endpoint to generate clean WhatsApp links with complete order details
  app.post('/api/ai/format-whatsapp-order', (req: Request, res: Response) => {
    try {
      const {
        items,
        customerName,
        customerPhone,
        paymentMethod,
        notes,
        scheduledDay,
        scheduledTime,
        scheduledPickupTime,
        orderId,
      } = req.body || {};
      const dbState = getLiveDbState();
      const storeInfo = dbState.storeInfo || {};
      const agentName = storeInfo.aiAgentName || 'Balbec IA';
      const phone = (storeInfo.aiAgentWhatsAppPhone || storeInfo.whatsapp || '').replace(/\D/g, '');

      if (!phone) {
        return res.status(400).json({ error: 'Número de WhatsApp da loja não configurado.' });
      }

      let total = 0;
      const itemsText = (items || [])
        .map((item: any) => {
          const addonsSum = (item.addons || []).reduce((s: number, a: any) => s + (Number(a.price) || 0), 0);
          const flavorPrice = item.flavor ? Number(item.flavor.price) || 0 : 0;
          const unitVal = Number(item.price) + flavorPrice + addonsSum;
          const itemTotal = unitVal * Number(item.quantity || 1);
          total += itemTotal;
          const prepText = item.prepLabel ? ` (${item.prepLabel})` : '';
          return `• ${item.quantity}x *${item.name}*${prepText} - R$ ${itemTotal.toFixed(2).replace('.', ',')}`;
        })
        .join('\n');

      const scheduleLine = scheduledTime
        ? `⏰ *Retirada Agendada:* ${scheduledDay ? `${scheduledDay} às ` : ''}${scheduledTime}${scheduledPickupTime ? ` (estimativa ${scheduledPickupTime}h)` : ''}\n`
        : '';

      const message = `🥟 *PEDIDO VIA ATENDENTE VIRTUAL (${agentName})* 🥟
*${storeInfo.name || 'BALBEC - REVENDA'}*
${orderId ? `🔢 *Pedido:* #${orderId}\n` : ''}
📋 *Itens do Pedido:*
${itemsText || '• (Itens a combinar)'}

💰 *Total:* R$ ${total.toFixed(2).replace('.', ',')}

👤 *Cliente:* ${customerName || 'Não informado'}
📞 *Telefone:* ${customerPhone || 'Não informado'}
📍 *Modalidade:* 🏬 Retirada no Balcão
${scheduleLine}💳 *Pagamento:* ${paymentMethod || 'A combinar'}
${notes ? `📝 *Observação:* ${notes}\n` : ''}
Pedido confirmado pelo atendente virtual! 😊`;

      const cleanPhone = phone.startsWith('55') ? phone : `55${phone}`;
      const whatsappUrl = `https://wa.me/${cleanPhone}?text=${encodeURIComponent(message)}`;

      return res.json({
        success: true,
        whatsappUrl,
        formattedMessage: message,
        total,
      });
    } catch (err: any) {
      return res.status(500).json({ error: err.message });
    }
  });
}
