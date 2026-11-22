import axios from 'axios';
import { XMLParser } from 'fast-xml-parser';
import { cleanProductDescription } from '../constants';

export type BlueFocusAutoExportMode = 'manual' | 'on_create' | 'on_complete';

export interface BlueFocusExportConfig {
  empresaId: string;
  usuarioId: string;
  pdvCodigo: string;
  orderUrl: string;
  authToken: string;
  autoExportMode: BlueFocusAutoExportMode;
  defaultClienteId: string;
  formaDinheiroId: string;
  formaPixId: string;
  formaDebitoId: string;
  formaCreditoId: string;
}

export const DEFAULT_BLUEFOCUS_EXPORT_CONFIG: BlueFocusExportConfig = {
  empresaId: 'BALBEC',
  usuarioId: 'CONSULTA',
  pdvCodigo: '1000',
  orderUrl: 'http://balbec.ddns.net:8082/valim/servlet/aintegracaofcxregistravenda',
  authToken: '',
  autoExportMode: 'manual',
  defaultClienteId: '100',
  formaDinheiroId: '1',
  formaPixId: '1',
  formaDebitoId: '1',
  formaCreditoId: '1',
};

export function parseBlueFocusExportConfig(
  storeInfoOrRaw?: any,
  requestOverrides?: Record<string, any>
): BlueFocusExportConfig {
  let storedObj: Record<string, any> = {};

  if (typeof storeInfoOrRaw === 'string') {
    try {
      const parsed = JSON.parse(storeInfoOrRaw);
      if (parsed && typeof parsed === 'object') storedObj = parsed;
    } catch {}
  } else if (storeInfoOrRaw && typeof storeInfoOrRaw === 'object') {
    if (typeof storeInfoOrRaw.blueFocusExportConfig === 'string') {
      try {
        const parsed = JSON.parse(storeInfoOrRaw.blueFocusExportConfig);
        if (parsed && typeof parsed === 'object') storedObj = parsed;
      } catch {}
    } else if (
      storeInfoOrRaw.blueFocusExportConfig &&
      typeof storeInfoOrRaw.blueFocusExportConfig === 'object'
    ) {
      storedObj = storeInfoOrRaw.blueFocusExportConfig;
    } else {
      storedObj = storeInfoOrRaw;
    }
  }

  const ov = requestOverrides && typeof requestOverrides === 'object' ? requestOverrides : {};

  const pick = (key: keyof BlueFocusExportConfig, envFallback?: string) => {
    const fromOv = ov[key];
    if (fromOv !== undefined && fromOv !== null && String(fromOv).trim() !== '') {
      return String(fromOv).trim();
    }
    const fromStored = storedObj[key];
    if (fromStored !== undefined && fromStored !== null && String(fromStored).trim() !== '') {
      return String(fromStored).trim();
    }
    if (envFallback && String(envFallback).trim() !== '') {
      return String(envFallback).trim();
    }
    return String(DEFAULT_BLUEFOCUS_EXPORT_CONFIG[key]);
  };

  const rawMode = pick('autoExportMode');
  const autoExportMode: BlueFocusAutoExportMode =
    rawMode === 'on_create' || rawMode === 'on_complete' ? rawMode : 'manual';

  return {
    empresaId: pick(
      'empresaId',
      process.env.BLUEFOCUS_EMPRESA_ID || process.env.BLUEFOCUS_EMPRESA
    ),
    usuarioId: pick(
      'usuarioId',
      process.env.BLUEFOCUS_USUARIO_ID || process.env.BLUEFOCUS_USUARIO
    ),
    pdvCodigo: pick('pdvCodigo', process.env.BLUEFOCUS_PDV_CODIGO),
    orderUrl: pick('orderUrl', process.env.BLUEFOCUS_ORDER_URL),
    authToken:
      ov.authToken !== undefined && String(ov.authToken).trim() !== ''
        ? String(ov.authToken).trim()
        : storedObj.authToken !== undefined && String(storedObj.authToken).trim() !== ''
          ? String(storedObj.authToken).trim()
          : (
              process.env.BLUE_FOCUS_AUTH_KEY ||
              process.env.BLUEFOCUS_AUTH_KEY ||
              process.env.BLUEFOCUS_AUTH_TOKEN ||
              ''
            ).trim(),
    autoExportMode,
    defaultClienteId: pick('defaultClienteId'),
    formaDinheiroId: pick('formaDinheiroId'),
    formaPixId: pick('formaPixId'),
    formaDebitoId: pick('formaDebitoId'),
    formaCreditoId: pick('formaCreditoId'),
  };
}

export function escapeXml(value: any): string {
  if (value === undefined || value === null) return '';
  return String(value)
    // Strip characters disallowed in XML 1.0
    .replace(/[\x00-\x08\x0B\x0C\x0E-\x1F]/g, '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;');
}

function normalizeDigits(val: any): string {
  return String(val || '').replace(/\D/g, '');
}

function isFrozenMarker(itemOrAddon: any): boolean {
  if (!itemOrAddon) return false;
  const id = String(itemOrAddon.id || itemOrAddon.productId || '').trim();
  const name = String(itemOrAddon.name || '').trim().toLowerCase();
  const price = Number(itemOrAddon.price || 0);
  return id === 'prod_congelado' || (name === 'congelado' && price <= 0);
}

function resolveProductExternalId(
  rawId: any,
  rawExternalId: any,
  rawName: any,
  productsList: any[]
): string {
  const ext = String(rawExternalId || '').trim();
  if (ext && ext !== 'prod_congelado') return ext;

  const idStr = String(rawId || '').trim();
  if (idStr.startsWith('bf_')) {
    return idStr.replace(/^bf_/, '');
  }

  if (Array.isArray(productsList) && productsList.length > 0) {
    if (idStr) {
      const byId = productsList.find((p) => p && String(p.id).trim() === idStr);
      if (byId) {
        if (byId.externalId && String(byId.externalId).trim()) {
          return String(byId.externalId).trim();
        }
        if (String(byId.id).startsWith('bf_')) {
          return String(byId.id).replace(/^bf_/, '');
        }
      }
    }

    const cleanName = cleanProductDescription(String(rawName || ''))
      .trim()
      .toLowerCase();
    if (cleanName) {
      const byName = productsList.find(
        (p) =>
          p &&
          cleanProductDescription(String(p.name || ''))
            .trim()
            .toLowerCase() === cleanName &&
          (p.externalId || String(p.id || '').startsWith('bf_'))
      );
      if (byName) {
        if (byName.externalId && String(byName.externalId).trim()) {
          return String(byName.externalId).trim();
        }
        if (String(byName.id).startsWith('bf_')) {
          return String(byName.id).replace(/^bf_/, '');
        }
      }
    }
  }

  return ext || idStr || '0';
}

function resolveCustomerExternalId(
  order: any,
  customersList: any[],
  defaultClienteId: string
): string {
  if (order?.customerExternalId && String(order.customerExternalId).trim()) {
    return String(order.customerExternalId).trim();
  }
  const custId = String(order?.customerId || '').trim();
  if (custId.startsWith('bf_cust_')) {
    return custId.replace(/^bf_cust_/, '');
  }

  if (Array.isArray(customersList) && customersList.length > 0) {
    if (custId) {
      const byId = customersList.find((c) => c && String(c.id).trim() === custId);
      if (byId) {
        if (byId.externalId && String(byId.externalId).trim()) {
          return String(byId.externalId).trim();
        }
        if (String(byId.id).startsWith('bf_cust_')) {
          return String(byId.id).replace(/^bf_cust_/, '');
        }
      }
    }

    const orderCpf = normalizeDigits(order?.customerCpf);
    if (orderCpf.length >= 11) {
      const byCpf = customersList.find(
        (c) =>
          c &&
          normalizeDigits(c.cpf) === orderCpf &&
          (c.externalId || String(c.id || '').startsWith('bf_cust_'))
      );
      if (byCpf) {
        return byCpf.externalId
          ? String(byCpf.externalId).trim()
          : String(byCpf.id).replace(/^bf_cust_/, '');
      }
    }

    const orderPhone = normalizeDigits(order?.customerPhone);
    if (orderPhone.length >= 8) {
      const orderTail = orderPhone.slice(-9);
      const byPhone = customersList.find((c) => {
        if (!c) return false;
        const cDigits = normalizeDigits(c.phone);
        if (cDigits.length < 8) return false;
        const matches = cDigits === orderPhone || cDigits.slice(-9) === orderTail;
        return matches && Boolean(c.externalId || String(c.id || '').startsWith('bf_cust_'));
      });
      if (byPhone) {
        return byPhone.externalId
          ? String(byPhone.externalId).trim()
          : String(byPhone.id).replace(/^bf_cust_/, '');
      }
    }
  }

  return defaultClienteId || '100';
}

function resolveFormaId(methodStr: string, cfg: BlueFocusExportConfig): string {
  const lower = String(methodStr || '').toLowerCase();
  if (lower.includes('pix')) return cfg.formaPixId || '1';
  if (lower.includes('déb') || lower.includes('deb')) return cfg.formaDebitoId || '1';
  if (lower.includes('créd') || lower.includes('cred') || lower.includes('cart')) {
    return cfg.formaCreditoId || '1';
  }
  if (lower.includes('din') || lower.includes('espéc') || lower.includes('espec')) {
    return cfg.formaDinheiroId || '1';
  }
  return cfg.formaDinheiroId || '1';
}

function formatScheduledDateForXml(rawDate: any, fallbackDate: string): string {
  const raw = String(rawDate || '').trim();
  if (!raw) return fallbackDate;
  if (/^\d{4}-\d{2}-\d{2}$/.test(raw)) return raw;
  const brMatch = raw.match(/^(\d{2})\/(\d{2})\/(\d{4})$/);
  if (brMatch) return `${brMatch[3]}-${brMatch[2]}-${brMatch[1]}`;
  return fallbackDate;
}

function formatPrepLabel(item: any): string {
  if (item?.prepLabel && String(item.prepLabel).trim()) {
    return String(item.prepLabel).trim();
  }
  switch (item?.prepType) {
    case 'congelado_cru':
      return 'CONGELADO (CRU / PRÉ-ASSADO)';
    case 'congelado_frito':
      return 'CONGELADO (FRITO / ASSADO)';
    case 'pronto_cru':
      return 'PRONTO (CRU / PRÉ-ASSADO)';
    case 'pronto_frito':
      return 'PRONTO (FRITO / ASSADO)';
    default:
      return '';
  }
}

export interface BlueFocusExportResult {
  success: boolean;
  saleNumber: string;
  error?: string;
  details?: any;
}

export async function exportOrderToBlueFocusSoap(params: {
  order: any;
  config: BlueFocusExportConfig;
  productsList?: any[];
  customersList?: any[];
}): Promise<BlueFocusExportResult> {
  const { order, config, productsList = [], customersList = [] } = params;

  if (!order || !Array.isArray(order.items) || order.items.length === 0) {
    return {
      success: false,
      saleNumber: '',
      error: 'Pedido inválido ou sem itens para exportar.',
    };
  }

  const now = new Date();
  const dateStr = now.toISOString().split('T')[0];
  const dateTimeStr = now.toISOString().replace(/\.\d{3}Z$/, 'Z');
  const numericOrderDigits = String(order.id || '').replace(/\D/g, '');
  const saleNumber =
    numericOrderDigits.substring(0, 9) || String(Math.floor(1000 + Math.random() * 90000));

  interface ExportLine {
    code: string;
    quantity: number;
    unitPrice: number;
    obs: string;
  }

  const lines: ExportLine[] = [];

  function getProductPackSize(codeOrItem: any): number {
    const code = typeof codeOrItem === 'string' ? codeOrItem : String(codeOrItem?.code || codeOrItem?.externalId || codeOrItem?.productId || '').trim();
    const numericCode = code.replace(/\D/g, '');

    const group25 = ['1413', '1414', '1415', '1417', '1418', '1425', '1426', '1427'];
    const group20 = ['1416', '1419', '1420', '1421', '1422', '1423', '1424'];

    if (group25.some(c => code === c || numericCode === c || code.endsWith(c) || (code.includes(c) && c.length >= 4))) {
      return 25;
    }
    if (group20.some(c => code === c || numericCode === c || code.endsWith(c) || (code.includes(c) && c.length >= 4))) {
      return 20;
    }
    const minFroz = Number(codeOrItem?.minFrozenQuantity);
    if (!isNaN(minFroz) && minFroz > 1) {
      return minFroz;
    }
    return 1;
  }

  for (const item of order.items) {
    if (!item) continue;
    const qty = Math.max(0.001, Number(item.quantity) || 1);
    const mainCode = resolveProductExternalId(
      item.productId || item.id,
      item.externalId,
      item.name,
      productsList
    );

    const obsParts: string[] = [];
    const prepText = formatPrepLabel(item);
    if (prepText) obsParts.push(prepText);
    if (item.flavor && Number(item.flavor.price || 0) <= 0 && item.flavor.name) {
      obsParts.push(`Sabor: ${item.flavor.name}`);
    }
    const freeAddons = Array.isArray(item.addons)
      ? item.addons.filter((a: any) => a && !isFrozenMarker(a) && Number(a.price || 0) <= 0)
      : [];
    if (freeAddons.length > 0) {
      obsParts.push(`+ ${freeAddons.map((a: any) => a.name).join(', ')}`);
    }
    if (item.notes && String(item.notes).trim()) {
      obsParts.push(String(item.notes).trim());
    }

    const packSize = getProductPackSize(mainCode);
    const effectiveUnitPrice = packSize > 1 ? Number(item.price || 0) / packSize : Number(item.price || 0);

    lines.push({
      code: mainCode,
      quantity: qty,
      unitPrice: Math.max(0, effectiveUnitPrice),
      obs: obsParts.join(' | ').substring(0, 200),
    });

    // Sabor pago como linha própria para fechar soma exata no BlueFocus
    if (item.flavor && Number(item.flavor.price || 0) > 0) {
      const flavorCode = resolveProductExternalId(
        item.flavor.productId || item.flavor.id,
        item.flavor.externalId || item.flavor.code,
        item.flavor.name,
        productsList
      );
      lines.push({
        code: flavorCode,
        quantity: qty,
        unitPrice: Number(item.flavor.price),
        obs: `Sabor p/ ${item.name || 'produto'}`.substring(0, 200),
      });
    }

    // Adicionais pagos (ignorando marcador virtual prod_congelado)
    if (Array.isArray(item.addons)) {
      for (const addon of item.addons) {
        if (!addon || isFrozenMarker(addon)) continue;
        const addonPrice = Number(addon.price || 0);
        if (addonPrice > 0) {
          const addonCode = resolveProductExternalId(
            addon.productId || addon.id,
            addon.externalId || addon.code,
            addon.name,
            productsList
          );
          lines.push({
            code: addonCode,
            quantity: qty,
            unitPrice: addonPrice,
            obs: `Adicional p/ ${item.name || 'produto'}`.substring(0, 200),
          });
        }
      }
    }
  }

  if (lines.length === 0) {
    return {
      success: false,
      saleNumber,
      error: 'Nenhum item válido encontrado para gerar o XML do BlueFocus.',
    };
  }

  const itemsXml = lines
    .map(
      (line, index) => `
        <ProdutoItem>
          <SaidaItemSeq>${index + 1}</SaidaItemSeq>
          <SaidaItemLoteProdutoId>${escapeXml(line.code)}</SaidaItemLoteProdutoId>
          <SaidaItemUnidadeId>UN</SaidaItemUnidadeId>
          <SaidaItemCodigoBarras>${escapeXml(line.code)}</SaidaItemCodigoBarras>
          <SaidaItemQuantidade>${line.quantity}</SaidaItemQuantidade>
          <SaidaItemValorUnitario>${line.unitPrice.toFixed(2)}</SaidaItemValorUnitario>
          <SaidaItemCancelado>N</SaidaItemCancelado>
          <SaidaItemTotalizador>T1</SaidaItemTotalizador>
          <SaidaItemTipoTributacao>T</SaidaItemTipoTributacao>${
            line.obs ? `\n          <SaidaItemObservacao>${escapeXml(line.obs)}</SaidaItemObservacao>` : ''
          }
        </ProdutoItem>`
    )
    .join('');

  // Parcelas (suporta pagamento 50% parcial em 2 parcelas ou integral em 1 parcela)
  const orderTotal = Math.max(0, Math.round((Number(order.total) || 0) * 100) / 100);
  const methodStr = String(order.paymentMethod || '');
  const isPartial =
    order.paymentPlan === 'parcial' ||
    /\[PARCIAL\s*50%\]/i.test(methodStr) ||
    /Pago\s*50%/i.test(methodStr) ||
    /Entrada\s*50%/i.test(methodStr);

  let parcelasXml = '';
  if (isPartial && orderTotal > 0) {
    let paidVal = Number(order.paidAmount) || 0;
    if (paidVal <= 0) {
      const mPaid = methodStr.match(/Pago\s*50%\s*\(?R\$\s*([\d.,]+)\)?/i);
      if (mPaid?.[1]) {
        paidVal = parseFloat(mPaid[1].replace(/\./g, '').replace(',', '.')) || 0;
      }
    }
    if (paidVal <= 0 || paidVal >= orderTotal) {
      paidVal = Math.round((orderTotal / 2) * 100) / 100;
    } else {
      paidVal = Math.round(paidVal * 100) / 100;
    }
    const remainingVal = Math.max(0, Math.round((orderTotal - paidVal) * 100) / 100);
    const due2 = formatScheduledDateForXml(order.scheduledDate || order.scheduledDay, dateStr);

    parcelasXml = `
        <ParcelaItem>
          <SaidaPagtoParcelaSequencia>1</SaidaPagtoParcelaSequencia>
          <SaidaPagtoParcelaFormaId>${escapeXml(resolveFormaId(methodStr, config))}</SaidaPagtoParcelaFormaId>
          <SaidaPagtoParcelaValor>${paidVal.toFixed(2)}</SaidaPagtoParcelaValor>
          <SaidaPagtoParcelaVencimento>${dateStr}</SaidaPagtoParcelaVencimento>
        </ParcelaItem>${
          remainingVal > 0
            ? `
        <ParcelaItem>
          <SaidaPagtoParcelaSequencia>2</SaidaPagtoParcelaSequencia>
          <SaidaPagtoParcelaFormaId>${escapeXml(config.formaDinheiroId || '1')}</SaidaPagtoParcelaFormaId>
          <SaidaPagtoParcelaValor>${remainingVal.toFixed(2)}</SaidaPagtoParcelaValor>
          <SaidaPagtoParcelaVencimento>${due2}</SaidaPagtoParcelaVencimento>
        </ParcelaItem>`
            : ''
        }`;
  } else {
    parcelasXml = `
        <ParcelaItem>
          <SaidaPagtoParcelaSequencia>1</SaidaPagtoParcelaSequencia>
          <SaidaPagtoParcelaFormaId>${escapeXml(resolveFormaId(methodStr, config))}</SaidaPagtoParcelaFormaId>
          <SaidaPagtoParcelaValor>${orderTotal.toFixed(2)}</SaidaPagtoParcelaValor>
          <SaidaPagtoParcelaVencimento>${dateStr}</SaidaPagtoParcelaVencimento>
        </ParcelaItem>`;
  }

  const resolvedClienteId = resolveCustomerExternalId(
    order,
    customersList,
    config.defaultClienteId
  );

  const scheduleParts = [order.scheduledDay || order.scheduledDate, order.scheduledTime || order.scheduledPickupTime]
    .filter(Boolean)
    .join(' ');
  const obsSummary = [
    `Pedido #${String(order.id || saleNumber).slice(-4)}`,
    order.customerName ? `Cliente: ${order.customerName}` : '',
    order.customerPhone ? `Tel: ${order.customerPhone}` : '',
    scheduleParts ? `Retirada: ${scheduleParts}` : '',
    methodStr ? `Pagto: ${methodStr}` : '',
  ]
    .filter(Boolean)
    .join(' | ')
    .substring(0, 400);

  const soapEnvelope = `<?xml version="1.0" encoding="utf-8"?>
<SOAP-ENV:Envelope 
xmlns:SOAP-ENV="http://schemas.xmlsoap.org/soap/envelope/" 
xmlns:xsd="http://www.w3.org/2001/XMLSchema" 
xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance">
<SOAP-ENV:Body>
<IntegracaoFcxRegistraVenda.Execute xmlns="Valim">
<Sdtwebserviceentradavenda>
<Venda>
<TipoVenda>P</TipoVenda>
<EmpresaId>${escapeXml(config.empresaId)}</EmpresaId>
<UsuarioId>${escapeXml(config.usuarioId)}</UsuarioId>
<PDVCodigo>${escapeXml(config.pdvCodigo)}</PDVCodigo>
<SaidaSNCancela>N</SaidaSNCancela>
<SaidaDataEmissao>${dateStr}</SaidaDataEmissao>
<SaidaClienteId>${escapeXml(resolvedClienteId)}</SaidaClienteId>
<SaidaDataHoraInclusao>${dateTimeStr}</SaidaDataHoraInclusao>
<SaidaUsuarioInclusao>${escapeXml(config.usuarioId)}</SaidaUsuarioInclusao>
<SaidaNumeroVendaFCX>${escapeXml(saleNumber)}</SaidaNumeroVendaFCX>
<SaidaObservacao>${escapeXml(obsSummary)}</SaidaObservacao>
${itemsXml}
${parcelasXml}
</Venda>
</Sdtwebserviceentradavenda>
</IntegracaoFcxRegistraVenda.Execute>
</SOAP-ENV:Body>
</SOAP-ENV:Envelope>`;

  const isValidToken = (t?: string) => {
    if (!t) return false;
    const clean = String(t).trim();
    return clean.length > 5 && !clean.includes('XXXX') && clean !== 'AGUARDANDO_CHAVE';
  };

  const headers: Record<string, string> = {
    'Content-Type': 'text/xml; charset=utf-8',
  };
  if (isValidToken(config.authToken)) {
    headers['autentica'] = config.authToken.trim();
  }

  try {
    const response = await axios.post(config.orderUrl, soapEnvelope, {
      headers,
      timeout: 15000,
    });

    const parser = new XMLParser();
    const jsonObj = parser.parse(response.data);
    const body = jsonObj['SOAP-ENV:Envelope']?.['SOAP-ENV:Body'] || jsonObj['Envelope']?.['Body'];
    const executeResponse =
      body?.['IntegracaoFcxRegistraVenda.ExecuteResponse'] ||
      body?.['IntegracaoFcxRegPreVendaSat.ExecuteResponse'];
    const saidaVenda = executeResponse?.['Sdtwebservicesaidavenda'];
    const msgErro = saidaVenda?.['MsgErro'];

    if (msgErro && String(msgErro).trim() !== '') {
      return {
        success: false,
        saleNumber,
        error: String(msgErro).trim(),
        details: saidaVenda,
      };
    }

    return {
      success: true,
      saleNumber,
    };
  } catch (error: any) {
    const errorDetail = error?.response?.data || error?.message || 'Erro de comunicação com o servidor BlueFocus';
    return {
      success: false,
      saleNumber,
      error:
        typeof errorDetail === 'string' && errorDetail.length < 300
          ? errorDetail
          : `Erro ao conectar ao BlueFocus (${error?.message || 'timeout/rede'})`,
      details: errorDetail,
    };
  }
}
