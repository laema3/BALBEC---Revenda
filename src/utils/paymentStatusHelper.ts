import { Order, StoreInfo } from '../store/useStore';

export type OrderPaymentKind = 'partial_50' | 'paid_full' | 'pay_on_pickup';

export interface OrderPaymentBreakdown {
  kind: OrderPaymentKind;
  isPix: boolean;
  isOnline: boolean;
  totalAmount: number;
  paidAmount: number;
  remainingAmount: number;
  methodLabel: string;
  customerBadge: string;
  customerTitle: string;
  customerMessage: string;
  operatorBadge: string;
  operatorTitle: string;
  operatorMessage: string;
  receiptLine: string;
}

export function formatBRL(value: number): string {
  return new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' }).format(Number(value) || 0);
}

function parseBRLFragment(fragment?: string): number | null {
  if (!fragment) return null;
  const cleaned = fragment.replace(/\./g, '').replace(',', '.').trim();
  const parsed = Number(cleaned);
  return Number.isFinite(parsed) && parsed >= 0 ? parsed : null;
}

export function getOrderPaymentBreakdown(order: Partial<Order> | null | undefined): OrderPaymentBreakdown {
  const totalAmount = Number(order?.total) || 0;
  const rawMethod = (order?.paymentMethod || '').trim();
  const lowerMethod = rawMethod.toLowerCase();

  const isPix = lowerMethod.includes('pix');
  const isOnline =
    lowerMethod.includes('online') ||
    lowerMethod.includes('pix mp') ||
    (order?.paymentStatus === 'approved' && order?.type !== 'kiosk' && order?.type !== 'dine_in');

  const isTermPayment = lowerMethod.includes('prazo') || lowerMethod.includes('à prazo') || lowerMethod.includes('faturado');

  if (isTermPayment) {
    return {
      kind: 'pay_on_pickup',
      isPix: false,
      isOnline: false,
      totalAmount,
      paidAmount: 0,
      remainingAmount: totalAmount,
      methodLabel: rawMethod || 'Pagamento à Prazo',
      customerBadge: 'PAGAMENTO À PRAZO • FATURADO',
      customerTitle: 'Pagamento à Prazo (Acerto Diário)',
      customerMessage: 'Seus pagamentos serão feitos em um acerto no final do dia, somando todos os outros pedidos de seus clientes.',
      operatorBadge: '📋 PAGAMENTO À PRAZO (FATURADO)',
      operatorTitle: 'PEDIDO À PRAZO / ACERTO NO FINAL DO DIA',
      operatorMessage: 'Pedido faturado (Pagamento à Prazo). Acerto a ser realizado no final do dia somando todos os pedidos do cliente.',
      receiptLine: 'PAGAMENTO A PRAZO (ACERTO NO FINAL DO DIA)',
    };
  }

  const isExplicitPartial =
    order?.paymentPlan === 'parcial' ||
    lowerMethod.includes('50%') ||
    lowerMethod.includes('entrada:') ||
    lowerMethod.includes('saldo na retirada') ||
    (Number(order?.remainingAmount) > 0 && Number(order?.paidAmount) > 0);

  if (isExplicitPartial) {
    const entradaMatch = rawMethod.match(/50%\s*(?:Entrada|Pago)?:\s*R\$\s*([\d.,]+)/i);
    const saldoMatch = rawMethod.match(/Saldo(?:\s*na\s*Retirada)?:\s*R\$\s*([\d.,]+)/i);

    const parsedPaid =
      Number(order?.paidAmount) > 0
        ? Number(order?.paidAmount)
        : parseBRLFragment(entradaMatch?.[1]) ?? Number((totalAmount * 0.5).toFixed(2));
    const parsedRemaining =
      Number(order?.remainingAmount) > 0
        ? Number(order?.remainingAmount)
        : parseBRLFragment(saldoMatch?.[1]) ?? Math.max(0, Number((totalAmount - parsedPaid).toFixed(2)));

    const shortChannel = isPix
      ? 'Pix Online'
      : lowerMethod.includes('débito') || lowerMethod.includes('debito')
      ? 'Cartão de Débito Online'
      : 'Pagamento Online';

    return {
      kind: 'partial_50',
      isPix,
      isOnline: true,
      totalAmount,
      paidAmount: parsedPaid,
      remainingAmount: parsedRemaining,
      methodLabel: `${shortChannel} (50% Entrada)`,
      customerBadge: '50% PAGO • FALTA 50% NA RETIRADA',
      customerTitle: 'Pagamento Parcial (50% Antecipado)',
      customerMessage: `Você já pagou 50% de entrada (${formatBRL(parsedPaid)}). ATENÇÃO: Será necessário pagar o valor restante de ${formatBRL(parsedRemaining)} na retirada do seu pedido no balcão.`,
      operatorBadge: `⚠️ COBRAR 50% RESTANTE: ${formatBRL(parsedRemaining)}`,
      operatorTitle: `COBRAR RESTANTE NA RETIRADA: ${formatBRL(parsedRemaining)}`,
      operatorMessage: `Cliente pagou 50% antecipado (${formatBRL(parsedPaid)} via ${shortChannel}). Ainda falta pagar ${formatBRL(parsedRemaining)} na entrega/retirada do pedido!`,
      receiptLine: `PAGO 50% (${formatBRL(parsedPaid)}) | COBRAR NA RETIRADA: ${formatBRL(parsedRemaining)}`,
    };
  }

  if (isOnline && order?.type !== 'kiosk' && order?.type !== 'dine_in') {
    const cleanMethod = rawMethod || (isPix ? 'Pix (Online)' : 'Pagamento Online');
    return {
      kind: 'paid_full',
      isPix,
      isOnline: true,
      totalAmount,
      paidAmount: totalAmount,
      remainingAmount: 0,
      methodLabel: cleanMethod,
      customerBadge: '100% PAGO ONLINE',
      customerTitle: 'Pagamento Integral Confirmado (100% Pago)',
      customerMessage: `Seu pedido já foi pago integralmente (${formatBRL(totalAmount)} via ${cleanMethod}). Não há nenhum valor pendente para pagar na retirada.`,
      operatorBadge: '✅ JÁ PAGO INTEGRALMENTE (100%)',
      operatorTitle: 'PEDIDO JÁ PAGO INTEGRALMENTE',
      operatorMessage: `Pagamento integral de ${formatBRL(totalAmount)} já confirmado antecipadamente (${cleanMethod}). Entregar pedido sem nova cobrança.`,
      receiptLine: `PEDIDO JA PAGO INTEGRALMENTE (100% QUITADO - ${formatBRL(totalAmount)})`,
    };
  }

  const fallbackMethod =
    rawMethod ||
    (order?.type === 'kiosk'
      ? 'Balcão (Totem)'
      : order?.tableNumber
      ? `No Caixa / Mesa ${order.tableNumber}`
      : 'Pagamento na Retirada');

  return {
    kind: 'pay_on_pickup',
    isPix,
    isOnline: false,
    totalAmount,
    paidAmount: 0,
    remainingAmount: totalAmount,
    methodLabel: fallbackMethod,
    customerBadge: 'PAGAR NA RETIRADA',
    customerTitle: 'Pagamento Integral na Retirada',
    customerMessage: `Você optou por pagar na retirada (${fallbackMethod}). O valor integral de ${formatBRL(totalAmount)} deverá ser pago no balcão ao retirar o pedido.`,
    operatorBadge: `💰 COBRAR INTEGRAL: ${formatBRL(totalAmount)}`,
    operatorTitle: `COBRAR INTEGRAL NA RETIRADA: ${formatBRL(totalAmount)}`,
    operatorMessage: `Pedido NÃO pago antecipadamente. Cobrar valor integral de ${formatBRL(totalAmount)} (${fallbackMethod}) na entrega/retirada do pedido!`,
    receiptLine: `COBRAR INTEGRAL NA RETIRADA: ${formatBRL(totalAmount)} (${fallbackMethod})`,
  };
}

export function orderContainsFrozenItems(order: Partial<Order> | any | null | undefined): boolean {
  if (!order) return false;
  if (order.hasFrozenItems === true || order.isFrozen === true) return true;
  const items = Array.isArray(order.items) ? order.items : [];
  return items.some((it: any) => {
    if (!it) return false;
    if (Boolean(it.isFrozen)) return true;
    const prepType = String(it.prepType || '').toLowerCase();
    const prepLabel = String(it.prepLabel || '').toLowerCase();
    if (prepType.startsWith('congelad') || prepLabel.includes('congelad')) return true;
    if (Array.isArray(it.addons) && it.addons.some((a: any) =>
      Boolean(a?.isFrozen) || a?.productId === 'prod_congelado' || String(a?.name || '').toLowerCase().includes('congelad')
    )) {
      return true;
    }
    if (Array.isArray(it.options) && it.options.some((o: any) =>
      Boolean(o?.isFrozen) || String(o?.name || '').toLowerCase().includes('congelad')
    )) {
      return true;
    }
    return false;
  });
}

export function requiresOperatorPaymentConfirmation(order: Partial<Order> | any | null | undefined): boolean {
  if (!order) return false;
  if (order.paymentConfirmedByOperator === true || Boolean(order.paymentConfirmedAt)) return false;
  if (order.status === 'cancelled') return false;
  if (order.type === 'kiosk' || order.type === 'dine_in' || order.deliveryType === 'dine_in') return false;

  const breakdown = getOrderPaymentBreakdown(order);
  const isOnlinePayment = breakdown.isOnline || breakdown.kind === 'paid_full' || breakdown.kind === 'partial_50';

  // Pedido criado explicitamente como pendente de confirmação pelo operador
  if (order.paymentConfirmedByOperator === false) {
    return true;
  }

  // Pedidos pendentes com pagamento online (Pix ou Cartão) exigem confirmação por senha pelo operador antes do preparo
  if (order.status === 'pending' && isOnlinePayment) {
    return true;
  }

  return false;
}

export function buildPixReceiptShareText(order: Order, storeInfo?: Partial<StoreInfo>): string {
  const breakdown = getOrderPaymentBreakdown(order);
  const orderNumber = order.id ? String(order.id).slice(-4).padStart(4, '0') : '0001';
  const storeName = (storeInfo?.name || 'BALBEC - REVENDA').toUpperCase();
  const orderDate = order.createdAt
    ? new Date(order.createdAt).toLocaleString('pt-BR')
    : new Date().toLocaleString('pt-BR');

  const items = Array.isArray(order.items) ? order.items : [];
  const itemsText = items
    .map((it: any) => {
      const unit =
        (Number(it.price) || 0) +
        (Number(it.flavor?.price) || 0) +
        (Array.isArray(it.addons) ? it.addons.reduce((s: number, a: any) => s + (Number(a.price) || 0), 0) : 0);
      const lineTotal = unit * (Number(it.quantity) || 1);
      const prep = it.prepLabel ? ` (${it.prepLabel})` : '';
      return `• ${it.quantity || 1}x ${it.name}${prep} - ${formatBRL(lineTotal)}`;
    })
    .join('\n');

  const scheduleLine = order.scheduledTime
    ? `⏰ *Retirada Agendada:* ${order.scheduledDay ? `${order.scheduledDay} às ` : ''}${order.scheduledTime}\n`
    : '';

  const paymentStatusLine =
    breakdown.kind === 'partial_50'
      ? `✅ *Pago via PIX (50% Entrada):* ${formatBRL(breakdown.paidAmount)}\n⚠️ *Restante a pagar na retirada (50%):* ${formatBRL(breakdown.remainingAmount)}`
      : breakdown.kind === 'paid_full'
      ? `✅ *Pagamento PIX Integral Confirmado:* ${formatBRL(breakdown.totalAmount)} (100% Quitado)`
      : `💰 *Forma de Pagamento:* ${breakdown.methodLabel} (${formatBRL(breakdown.totalAmount)} na retirada)`;

  return `*COMPROVANTE DE PEDIDO PIX - ${storeName}*
--------------------------------
🔢 *Pedido:* #${orderNumber}
👤 *Cliente:* ${(order.customerName || 'Cliente').toUpperCase()}
📅 *Data/Hora:* ${orderDate}
${scheduleLine}--------------------------------
*Itens:*
${itemsText || '• Pedido registrado'}
--------------------------------
💵 *Total do Pedido:* ${formatBRL(breakdown.totalAmount)}
${paymentStatusLine}${order.paymentId ? `\n🧾 *ID Transação:* ${order.paymentId}` : ''}`;
}

export async function generatePixReceiptPngBlob(
  order: Order,
  storeInfo?: Partial<StoreInfo>
): Promise<Blob | null> {
  if (typeof document === 'undefined') return null;

  const breakdown = getOrderPaymentBreakdown(order);
  const orderNumber = order.id ? String(order.id).slice(-4).padStart(4, '0') : '0001';
  const storeName = (storeInfo?.name || 'BALBEC - REVENDA').toUpperCase();
  const orderDate = order.createdAt
    ? new Date(order.createdAt).toLocaleString('pt-BR')
    : new Date().toLocaleString('pt-BR');
  const items = Array.isArray(order.items) ? order.items : [];

  const width = 720;
  const rowHeight = 42;
  const extraSchedule = order.scheduledTime ? 38 : 0;
  const extraTx = order.paymentId ? 30 : 0;
  const height = Math.max(660, 470 + items.length * rowHeight + extraSchedule + extraTx);

  const canvas = document.createElement('canvas');
  canvas.width = width;
  canvas.height = height;
  const ctx = canvas.getContext('2d');
  if (!ctx) return null;

  // Fundo branco
  ctx.fillStyle = '#ffffff';
  ctx.fillRect(0, 0, width, height);

  // Header
  ctx.fillStyle = breakdown.kind === 'partial_50' ? '#047857' : '#059669';
  ctx.fillRect(0, 0, width, 128);

  ctx.fillStyle = '#ffffff';
  ctx.textAlign = 'center';
  ctx.font = 'bold 28px sans-serif';
  ctx.fillText(storeName, width / 2, 48);

  ctx.font = 'bold 20px sans-serif';
  ctx.fillText(
    breakdown.kind === 'partial_50'
      ? 'COMPROVANTE PIX • ENTRADA 50%'
      : breakdown.kind === 'paid_full'
      ? 'COMPROVANTE PIX • 100% PAGO'
      : 'COMPROVANTE DE PEDIDO PIX',
    width / 2,
    84
  );

  ctx.font = '15px sans-serif';
  ctx.fillStyle = '#d1fae5';
  ctx.fillText(`Pedido #${orderNumber} • ${orderDate}`, width / 2, 112);

  let y = 165;
  ctx.textAlign = 'left';
  ctx.fillStyle = '#1c1917';
  ctx.font = 'bold 20px sans-serif';
  ctx.fillText(`Cliente: ${(order.customerName || 'Cliente').toUpperCase()}`, 40, y);
  y += 30;

  if (order.customerPhone) {
    ctx.fillStyle = '#57534e';
    ctx.font = '16px sans-serif';
    ctx.fillText(`WhatsApp: ${order.customerPhone}`, 40, y);
    y += 28;
  }

  if (order.scheduledTime) {
    ctx.fillStyle = '#b45309';
    ctx.font = 'bold 17px sans-serif';
    ctx.fillText(
      `Retirada Agendada: ${order.scheduledDay ? `${order.scheduledDay} às ` : ''}${order.scheduledTime}`,
      40,
      y
    );
    y += 32;
  }

  // Divider
  ctx.strokeStyle = '#d6d3d1';
  ctx.setLineDash([6, 4]);
  ctx.beginPath();
  ctx.moveTo(40, y);
  ctx.lineTo(width - 40, y);
  ctx.stroke();
  ctx.setLineDash([]);
  y += 30;

  // Items
  ctx.fillStyle = '#1c1917';
  ctx.font = 'bold 16px sans-serif';
  ctx.fillText('ITENS DO PEDIDO', 40, y);
  y += 28;

  for (const item of items) {
    const unit =
      (Number(item.price) || 0) +
      (Number(item.flavor?.price) || 0) +
      (Array.isArray(item.addons) ? item.addons.reduce((s: number, a: any) => s + (Number(a.price) || 0), 0) : 0);
    const lineTotal = unit * (Number(item.quantity) || 1);
    const prep = item.prepLabel ? ` (${item.prepLabel})` : '';
    const title = `${item.quantity || 1}x ${item.name || ''}${prep}`.slice(0, 44);

    ctx.textAlign = 'left';
    ctx.fillStyle = '#292524';
    ctx.font = '16px sans-serif';
    ctx.fillText(title, 40, y);

    ctx.textAlign = 'right';
    ctx.font = 'bold 16px monospace';
    ctx.fillText(formatBRL(lineTotal), width - 40, y);
    y += rowHeight;
  }

  // Divider
  ctx.strokeStyle = '#d6d3d1';
  ctx.setLineDash([6, 4]);
  ctx.beginPath();
  ctx.moveTo(40, y);
  ctx.lineTo(width - 40, y);
  ctx.stroke();
  ctx.setLineDash([]);
  y += 28;

  // Box Financeiro
  const boxHeight = breakdown.kind === 'partial_50' ? 156 : 114;
  ctx.fillStyle = breakdown.kind === 'partial_50' ? '#fffbeb' : '#ecfdf5';
  ctx.strokeStyle = breakdown.kind === 'partial_50' ? '#f59e0b' : '#10b981';
  ctx.lineWidth = 2;
  ctx.fillRect(40, y, width - 80, boxHeight);
  ctx.strokeRect(40, y, width - 80, boxHeight);

  let boxY = y + 34;
  ctx.textAlign = 'left';
  ctx.fillStyle = '#1c1917';
  ctx.font = 'bold 18px sans-serif';
  ctx.fillText('Total do Pedido:', 60, boxY);
  ctx.textAlign = 'right';
  ctx.font = 'bold 20px monospace';
  ctx.fillText(formatBRL(breakdown.totalAmount), width - 60, boxY);

  boxY += 34;
  ctx.textAlign = 'left';
  ctx.fillStyle = '#047857';
  ctx.font = 'bold 18px sans-serif';
  ctx.fillText(
    breakdown.kind === 'partial_50'
      ? 'Pago via PIX (50% Entrada):'
      : breakdown.kind === 'paid_full'
      ? 'Pago via PIX (100%):'
      : 'Pagamento na Retirada (PIX):',
    60,
    boxY
  );
  ctx.textAlign = 'right';
  ctx.font = 'bold 20px monospace';
  ctx.fillText(
    formatBRL(breakdown.kind === 'pay_on_pickup' ? breakdown.totalAmount : breakdown.paidAmount),
    width - 60,
    boxY
  );

  if (breakdown.kind === 'partial_50') {
    boxY += 38;
    ctx.textAlign = 'left';
    ctx.fillStyle = '#b45309';
    ctx.font = 'bold 18px sans-serif';
    ctx.fillText('Falta Pagar na Retirada (50%):', 60, boxY);
    ctx.textAlign = 'right';
    ctx.font = 'bold 21px monospace';
    ctx.fillText(formatBRL(breakdown.remainingAmount), width - 60, boxY);
  }

  y += boxHeight + 28;

  if (order.paymentId) {
    ctx.textAlign = 'center';
    ctx.fillStyle = '#78716c';
    ctx.font = '13px monospace';
    ctx.fillText(`ID Transação Pix: ${order.paymentId}`, width / 2, y);
    y += 24;
  }

  ctx.textAlign = 'center';
  ctx.fillStyle = '#57534e';
  ctx.font = '14px sans-serif';
  ctx.fillText('Apresente este comprovante no balcão ao retirar seu pedido.', width / 2, y + 6);

  return await new Promise<Blob | null>((resolve) => {
    canvas.toBlob((blob) => resolve(blob), 'image/png');
  });
}

export async function sharePixReceipt(
  order: Order,
  storeInfo?: Partial<StoreInfo>
): Promise<{
  success: boolean;
  mode: 'native_file' | 'native_text' | 'download_and_copy';
  message: string;
}> {
  const orderNumber = order.id ? String(order.id).slice(-4).padStart(4, '0') : '0001';
  const shareText = buildPixReceiptShareText(order, storeInfo);
  const shareTitle = `Comprovante Pix - Pedido #${orderNumber}`;
  const blob = await generatePixReceiptPngBlob(order, storeInfo);

  if (blob && typeof File !== 'undefined' && typeof navigator !== 'undefined' && typeof navigator.share === 'function') {
    try {
      const file = new File([blob], `comprovante-pix-pedido-${orderNumber}.png`, { type: 'image/png' });
      if (!navigator.canShare || navigator.canShare({ files: [file] })) {
        await navigator.share({
          title: shareTitle,
          text: shareText,
          files: [file],
        });
        return {
          success: true,
          mode: 'native_file',
          message: 'Comprovante Pix compartilhado com sucesso!',
        };
      }
    } catch (err: any) {
      if (err?.name === 'AbortError') {
        return { success: false, mode: 'native_file', message: 'Compartilhamento cancelado.' };
      }
    }
  }

  if (typeof navigator !== 'undefined' && typeof navigator.share === 'function') {
    try {
      await navigator.share({
        title: shareTitle,
        text: shareText,
      });
      return {
        success: true,
        mode: 'native_text',
        message: 'Resumo do comprovante Pix compartilhado!',
      };
    } catch (err: any) {
      if (err?.name === 'AbortError') {
        return { success: false, mode: 'native_text', message: 'Compartilhamento cancelado.' };
      }
    }
  }

  // Fallback desktop: baixa o PNG do comprovante e copia o resumo para a área de transferência
  if (blob && typeof document !== 'undefined') {
    try {
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `comprovante-pix-pedido-${orderNumber}.png`;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      setTimeout(() => URL.revokeObjectURL(url), 4000);
    } catch {}
  }

  try {
    await navigator.clipboard.writeText(shareText);
  } catch {}

  return {
    success: true,
    mode: 'download_and_copy',
    message: 'Imagem do comprovante baixada e resumo copiado! Cole no WhatsApp para enviar.',
  };
}
