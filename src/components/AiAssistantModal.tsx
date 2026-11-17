import React, { useState, useEffect, useRef } from 'react';
import { useStore } from '../store/useStore';
import { formatCurrency } from '../lib/utils';
import {
  Bot,
  Send,
  X,
  MessageCircle,
  Sparkles,
  Clock,
  RefreshCw,
  Check,
  CheckCircle2,
  CreditCard,
  DollarSign,
  QrCode,
  Store,
  ShoppingCart,
  Calendar,
} from 'lucide-react';
import { getStoreCurrentStatus } from '../utils/scheduleHelper';
import { generateClientFallbackAnswer } from '../utils/aiClientFallback';

export interface AiDraftItem {
  productId: string;
  externalId?: string;
  code?: string;
  name: string;
  description?: string;
  imageUrl?: string;
  price: number;
  quantity: number;
  isFrozen?: boolean;
  prepType?: string;
  prepLabel?: string;
  addons?: Array<{ productId: string; name: string; price: number; externalId?: string; code?: string; isFrozen?: boolean }>;
  flavor?: { productId: string; name: string; price: number; externalId?: string; code?: string } | null;
}

export interface AiDraftOrder {
  items: AiDraftItem[];
  total: number;
  totalUnits?: number;
  hasFrozen?: boolean;
  scheduledDate?: string | null;
  scheduledDay?: string | null;
  scheduledTime?: string | null;
  scheduledPickupTime?: string | null;
  customerName?: string;
  customerPhone?: string;
  paymentMethod?: string;
}

export interface AiPlacedOrderSummary {
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
}

interface ChatMessage {
  id: string;
  sender: 'user' | 'assistant';
  text: string;
  draftOrder?: AiDraftOrder | null;
  placedOrder?: AiPlacedOrderSummary | null;
  whatsappLink?: string;
  timestamp: string;
}

interface AiAssistantModalProps {
  isOpen: boolean;
  onClose: () => void;
  onAddToCart?: (product: any) => void;
  onAddDirectToCart?: (product: any, quantity: number) => void;
  onApplyAiDraftToCart?: (draft: AiDraftOrder) => void;
  onOpenCart?: () => void;
  activeCustomer?: { id?: string; name?: string; phone?: string; cpf?: string } | null;
}

function renderFormattedLine(text: string): React.ReactNode {
  const parts = text.split(/(\*\*[^*]+\*\*)/g);
  return parts.map((part, idx) => {
    if (part.startsWith('**') && part.endsWith('**') && part.length > 4) {
      return (
        <strong key={idx} className="font-bold">
          {part.slice(2, -2)}
        </strong>
      );
    }
    return <React.Fragment key={idx}>{part}</React.Fragment>;
  });
}

export function AiAssistantModal({
  isOpen,
  onClose,
  onAddToCart,
  onAddDirectToCart,
  onApplyAiDraftToCart,
  onOpenCart,
  activeCustomer,
}: AiAssistantModalProps) {
  const { storeInfo, placeOrder, products, categories } = useStore();
  const [sessionId, setSessionId] = useState(
    () => `web_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`
  );
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [inputText, setInputText] = useState('');
  const [isLoading, setIsLoading] = useState(false);
  const [cartSuccessNotice, setCartSuccessNotice] = useState<string | null>(null);

  // Optional WhatsApp handoff sheet for manual confirmation
  const [activeOrderToSend, setActiveOrderToSend] = useState<AiDraftOrder | null>(null);
  const [customerName, setCustomerName] = useState(
    () => activeCustomer?.name || localStorage.getItem('balbec_customer_name') || ''
  );
  const [customerPhone, setCustomerPhone] = useState(
    () => activeCustomer?.phone || localStorage.getItem('balbec_customer_phone') || ''
  );
  const [paymentMethod, setPaymentMethod] = useState<'pix' | 'card' | 'cash'>('pix');
  const [cashChange, setCashChange] = useState('');
  const [orderNotes, setOrderNotes] = useState('');
  const [formError, setFormError] = useState<string | null>(null);
  const [isSubmittingOrder, setIsSubmittingOrder] = useState(false);

  const messagesEndRef = useRef<HTMLDivElement>(null);

  const agentName = storeInfo.aiAgentName || 'Balbec IA';
  const whatsappNumber = storeInfo.aiAgentWhatsAppPhone || storeInfo.whatsapp || '';
  const currentStatus = getStoreCurrentStatus(
    storeInfo.weeklySchedule,
    storeInfo.isOpen !== false,
    storeInfo.autoOpenClose !== false,
    !!storeInfo.forceOpen
  );

  useEffect(() => {
    if (activeCustomer?.name && !customerName) setCustomerName(activeCustomer.name);
    if (activeCustomer?.phone && !customerPhone) setCustomerPhone(activeCustomer.phone);
  }, [activeCustomer]);

  useEffect(() => {
    if (isOpen && messages.length === 0) {
      setMessages([
        {
          id: 'welcome',
          sender: 'assistant',
          text: `Olá! Sou **${agentName}**, atendente virtual da **${
            storeInfo.name || 'BALBEC - REVENDA'
          }**. 🥟✨\n\nPosso te mostrar nossos salgados (fritos, assados ou congelados), verificar **dias e horários disponíveis** para retirada no balcão e já **fechar e enviar seu pedido** direto por aqui! O que você gostaria hoje?`,
          timestamp: new Date().toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' }),
        },
      ]);
    }
  }, [isOpen, messages.length, agentName, storeInfo.name]);

  useEffect(() => {
    if (isOpen) {
      messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
    }
  }, [messages, isLoading, isOpen]);

  if (!isOpen) return null;

  const quickPrompts = [
    { label: '🥟 Cardápio e Preços', prompt: 'Quais salgados vocês têm no cardápio e os valores?' },
    { label: '❄️ Salgados Congelados', prompt: 'Quais opções de salgados congelados vocês têm?' },
    { label: '🗓️ Horários Disponíveis', prompt: 'Quais dias e horários estão disponíveis para retirada?' },
    { label: '🛒 Fazer um Pedido', prompt: 'Quero montar um pedido para retirada no balcão.' },
  ];

  const handleResetConversation = async () => {
    try {
      await fetch('/api/ai/reset', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ sessionId }),
      });
    } catch {}
    const nextId = `web_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
    setSessionId(nextId);
    setMessages([
      {
        id: `welcome_${Date.now()}`,
        sender: 'assistant',
        text: `Atendimento reiniciado! Sou **${agentName}** — como posso ajudar você a montar seu próximo pedido? 🥟✨`,
        timestamp: new Date().toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' }),
      },
    ]);
  };

  const handleSendMessage = async (customText?: string) => {
    const textToSend = (customText || inputText).trim();
    if (!textToSend || isLoading) return;

    const userMsg: ChatMessage = {
      id: `user_${Date.now()}`,
      sender: 'user',
      text: textToSend,
      timestamp: new Date().toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' }),
    };

    setMessages((prev) => [...prev, userMsg]);
    if (!customText) setInputText('');
    setIsLoading(true);

    const startTime = Date.now();
    let assistantMsg: ChatMessage | null = null;

    try {
      const chatHistory = messages.slice(-12).map((m) => ({
        role: m.sender === 'user' ? 'user' : 'assistant',
        content: m.text,
      }));

      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), 25000);

      const resolvedCustomerContext = activeCustomer
        ? {
            id: activeCustomer.id,
            name: activeCustomer.name,
            phone: activeCustomer.phone,
            cpf: activeCustomer.cpf,
          }
        : customerName || customerPhone
        ? { name: customerName, phone: customerPhone }
        : undefined;

      const res = await fetch('/api/ai/chat', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        signal: controller.signal,
        body: JSON.stringify({
          sessionId,
          messages: chatHistory,
          userMessage: textToSend,
          customerContext: resolvedCustomerContext,
        }),
      });
      clearTimeout(timeoutId);

      if (res.ok) {
        const data = await res.json();
        assistantMsg = {
          id: `ai_${Date.now()}`,
          sender: 'assistant',
          text: data.reply || 'Como posso te ajudar?',
          draftOrder: data.draftOrder || null,
          placedOrder: data.placedOrder || null,
          whatsappLink: data.whatsappLink,
          timestamp: new Date().toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' }),
        };
      } else {
        throw new Error(`Server returned ${res.status}`);
      }
    } catch (err) {
      console.warn('[AI Assistant] Server request failed, activating client fallback:', err);
      const localAnswer = generateClientFallbackAnswer(
        textToSend,
        storeInfo,
        products,
        categories,
        messages
      );
      assistantMsg = {
        id: `ai_${Date.now()}`,
        sender: 'assistant',
        text: localAnswer.reply,
        whatsappLink: localAnswer.whatsappLink,
        timestamp: new Date().toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' }),
      };
    } finally {
      const elapsed = Date.now() - startTime;
      const minDelay = 350;
      if (elapsed < minDelay) {
        await new Promise((resolve) => setTimeout(resolve, minDelay - elapsed));
      }

      if (assistantMsg) {
        setMessages((prev) => [...prev, assistantMsg!]);
      }
      setIsLoading(false);
    }
  };

  const handleTransferDraftToCart = (draft: AiDraftOrder, andOpenCart: boolean = true) => {
    if (!draft || !draft.items.length) return;

    if (onApplyAiDraftToCart) {
      onApplyAiDraftToCart(draft);
    } else {
      draft.items.forEach((it) => {
        const match =
          products.find((p) => p.id === it.productId) ||
          products.find((p) => p.name.toLowerCase() === it.name.toLowerCase()) || {
            id: it.productId || `ai_${Date.now()}_${Math.random()}`,
            name: it.name,
            price: it.price,
            categoryId: 'all',
            isActive: true,
            trackStock: false,
            availableInStore: true,
          };
        if (onAddDirectToCart) {
          onAddDirectToCart(match, it.quantity);
        } else if (onAddToCart) {
          for (let i = 0; i < it.quantity; i++) onAddToCart(match);
        }
      });
    }

    if (andOpenCart) {
      setCartSuccessNotice('Pedido transferido para o seu carrinho!');
      setTimeout(() => {
        setCartSuccessNotice(null);
        onClose();
        if (onOpenCart) onOpenCart();
      }, 300);
    }
  };

  const handleSendPlacedToWhatsApp = async (placed: AiPlacedOrderSummary) => {
    try {
      const res = await fetch('/api/ai/format-whatsapp-order', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          orderId: placed.orderId,
          items: placed.items,
          customerName: placed.customerName,
          customerPhone: placed.customerPhone,
          paymentMethod: placed.paymentMethod,
          scheduledDay: placed.scheduledDay,
          scheduledTime: placed.scheduledTime,
          scheduledPickupTime: placed.scheduledPickupTime,
        }),
      });
      if (res.ok) {
        const data = await res.json();
        if (data.whatsappUrl) {
          window.open(data.whatsappUrl, '_blank');
          return;
        }
      }
    } catch {}
    const cleanPhone = (whatsappNumber || '').replace(/\D/g, '');
    if (cleanPhone) {
      const fullPhone = cleanPhone.startsWith('55') ? cleanPhone : `55${cleanPhone}`;
      window.open(
        `https://wa.me/${fullPhone}?text=${encodeURIComponent(
          `Olá! Acabei de fechar o pedido #${placed.orderId} com ${agentName}.`
        )}`,
        '_blank'
      );
    }
  };

  const handleConfirmAndSendWhatsApp = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!activeOrderToSend || isSubmittingOrder) return;

    if (!customerName.trim()) {
      setFormError('Por favor, informe seu nome para identificar o pedido.');
      return;
    }
    setFormError(null);
    setIsSubmittingOrder(true);

    try {
      localStorage.setItem('balbec_customer_name', customerName.trim());
      localStorage.setItem('balbec_customer_phone', customerPhone.trim());

      const paymentLabels: Record<string, string> = {
        pix: 'PIX',
        card: 'Cartão de Crédito / Débito',
        cash: cashChange ? `Dinheiro (Troco para R$ ${cashChange})` : 'Dinheiro',
      };

      const placed = await placeOrder({
        items: activeOrderToSend.items.map((item) => ({
          productId: item.productId,
          externalId: item.externalId,
          code: item.code,
          quantity: item.quantity,
          price: item.price,
          name: item.name,
          description: item.description || '',
          isFrozen: item.isFrozen,
          prepType: item.prepType,
          prepLabel: item.prepLabel,
          addons: item.addons || [],
          flavor: item.flavor || null,
        })),
        total: activeOrderToSend.total,
        type: 'online',
        paymentMethod: paymentLabels[paymentMethod] || 'A combinar',
        customerName: customerName.trim(),
        customerPhone: customerPhone.trim() || undefined,
        deliveryType: 'pickup',
        scheduledDate: activeOrderToSend.scheduledDate || undefined,
        scheduledDay: activeOrderToSend.scheduledDay || undefined,
        scheduledTime: activeOrderToSend.scheduledTime || undefined,
        scheduledPickupTime: activeOrderToSend.scheduledPickupTime || undefined,
      });

      const summaryObj: AiPlacedOrderSummary = {
        orderId: String(placed?.id || ''),
        total: activeOrderToSend.total,
        items: activeOrderToSend.items,
        scheduledDate: activeOrderToSend.scheduledDate,
        scheduledDay: activeOrderToSend.scheduledDay,
        scheduledTime: activeOrderToSend.scheduledTime,
        scheduledPickupTime: activeOrderToSend.scheduledPickupTime,
        paymentMethod: paymentLabels[paymentMethod] || 'A combinar',
        customerName: customerName.trim(),
        customerPhone: customerPhone.trim(),
      };

      await handleSendPlacedToWhatsApp(summaryObj);

      setMessages((prev) => [
        ...prev,
        {
          id: `success_${Date.now()}`,
          sender: 'assistant',
          text: `🎉 **Pedido #${summaryObj.orderId} confirmado e registrado!**\n\nTambém abri o resumo pronto para o seu WhatsApp.`,
          placedOrder: summaryObj,
          timestamp: new Date().toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' }),
        },
      ]);
      setActiveOrderToSend(null);
    } catch (err) {
      console.error('Erro ao enviar pedido:', err);
      setFormError('Não foi possível registrar o pedido agora. Tente novamente.');
    } finally {
      setIsSubmittingOrder(false);
    }
  };

  const getItemUnitTotal = (it: AiDraftItem) => {
    const addonsSum = (it.addons || []).reduce((s, a) => s + (Number(a.price) || 0), 0);
    const flavorPrice = it.flavor ? Number(it.flavor.price) || 0 : 0;
    return Number(it.price) + flavorPrice + addonsSum;
  };

  return (
    <div className="fixed inset-0 z-50 bg-stone-900/70 backdrop-blur-xs flex items-end sm:items-center justify-center sm:p-4 animate-fade-in">
      <div className="bg-white w-full sm:max-w-lg h-[92vh] sm:h-[700px] rounded-t-3xl sm:rounded-3xl shadow-2xl flex flex-col overflow-hidden border border-stone-200 relative">
        {/* Header */}
        <div className="bg-gradient-to-r from-stone-900 via-stone-800 to-amber-950 text-white p-4 sm:p-5 flex items-center justify-between shadow-md shrink-0">
          <div className="flex items-center gap-3">
            <div className="relative">
              <div className="w-10 h-10 rounded-2xl bg-amber-500 flex items-center justify-center shadow-md border-2 border-amber-300/40">
                <Bot className="w-5 h-5 text-stone-950" />
              </div>
              <span className="absolute -bottom-0.5 -right-0.5 w-3 h-3 bg-emerald-500 border-2 border-stone-900 rounded-full" />
            </div>
            <div>
              <div className="flex items-center gap-2">
                <h3 className="font-black text-sm sm:text-base text-white">{agentName}</h3>
                <span className="bg-amber-500/20 text-amber-300 border border-amber-400/30 text-[10px] font-bold px-2 py-0.5 rounded-full flex items-center gap-1">
                  <Sparkles className="w-3 h-3 text-amber-300" /> Pedidos I.A.
                </span>
              </div>
              <p className="text-xs text-stone-300 flex items-center gap-1.5 mt-0.5">
                <span className="w-1.5 h-1.5 rounded-full bg-emerald-400 animate-pulse" />
                {currentStatus.isOpenNow ? 'Online • Loja Aberta' : 'Online • Agende seu Pedido'}
              </p>
            </div>
          </div>

          <div className="flex items-center gap-1.5">
            <button
              type="button"
              onClick={handleResetConversation}
              className="p-2 hover:bg-white/10 rounded-xl text-stone-300 hover:text-white transition-colors cursor-pointer"
              title="Reiniciar atendimento"
            >
              <RefreshCw className="w-4 h-4" />
            </button>
            {whatsappNumber && (
              <a
                href={`https://wa.me/55${whatsappNumber.replace(/\D/g, '').replace(/^55/, '')}?text=${encodeURIComponent(
                  'Olá! Gostaria de atendimento.'
                )}`}
                target="_blank"
                rel="noreferrer"
                className="p-2 bg-emerald-600/90 hover:bg-emerald-600 text-white rounded-xl transition-colors cursor-pointer"
                title="Chamar no WhatsApp da loja"
              >
                <MessageCircle className="w-4 h-4" />
              </a>
            )}
            <button
              type="button"
              onClick={onClose}
              className="p-2 hover:bg-white/10 rounded-xl text-stone-300 hover:text-white transition-colors cursor-pointer"
              title="Fechar"
            >
              <X className="w-5 h-5" />
            </button>
          </div>
        </div>

        {cartSuccessNotice && (
          <div className="bg-emerald-600 text-white text-xs font-bold px-4 py-2.5 flex items-center justify-center gap-2 shadow-inner animate-fade-in shrink-0">
            <Check className="w-4 h-4" />
            <span>{cartSuccessNotice}</span>
          </div>
        )}

        {/* Operating status bar */}
        <div className="bg-amber-50/90 border-b border-amber-200/80 px-4 py-2 flex items-center justify-between text-xs text-stone-700 shrink-0">
          <div className="flex items-center gap-1.5 font-medium truncate pr-2">
            <Clock className="w-3.5 h-3.5 text-amber-600 shrink-0" />
            <span className="truncate">{currentStatus.details}</span>
          </div>
          <span
            className={`text-[10px] font-bold px-2 py-0.5 rounded-full shrink-0 ${
              currentStatus.isOpenNow
                ? 'bg-emerald-100 text-emerald-800 border border-emerald-300'
                : 'bg-stone-200 text-stone-700'
            }`}
          >
            {currentStatus.statusBadge}
          </span>
        </div>

        {/* Message Thread */}
        <div className="flex-1 overflow-y-auto p-4 space-y-4 bg-stone-50/70">
          {messages.map((msg, msgIdx) => {
            const isUser = msg.sender === 'user';
            const isLatestDraftHolder =
              msg.draftOrder &&
              msg.draftOrder.items.length > 0 &&
              !messages.slice(msgIdx + 1).some((later) => later.draftOrder?.items?.length || later.placedOrder);

            return (
              <div key={msg.id} className={`flex flex-col ${isUser ? 'items-end' : 'items-start'} space-y-2`}>
                <div
                  className={`max-w-[88%] sm:max-w-[84%] p-3.5 sm:p-4 rounded-2xl text-sm leading-relaxed ${
                    isUser
                      ? 'bg-amber-600 text-white rounded-br-xs shadow-sm font-medium'
                      : 'bg-white text-stone-800 border border-stone-200/80 rounded-bl-xs shadow-xs'
                  }`}
                >
                  <div className="whitespace-pre-line break-words space-y-1.5">
                    {msg.text.split('\n').map((line, idx) => {
                      if (line.startsWith('• ') || line.startsWith('* ') || line.startsWith('- ')) {
                        return (
                          <div key={idx} className="flex items-start gap-1.5 ml-1">
                            <span className={isUser ? 'text-amber-200' : 'text-amber-600 font-bold'}>•</span>
                            <span>{renderFormattedLine(line.replace(/^[•*-]\s*/, ''))}</span>
                          </div>
                        );
                      }
                      return <p key={idx}>{renderFormattedLine(line)}</p>;
                    })}
                  </div>

                  <span
                    className={`block text-[10px] mt-2 font-medium ${
                      isUser ? 'text-amber-100 text-right' : 'text-stone-400'
                    }`}
                  >
                    {msg.timestamp}
                  </span>
                </div>

                {/* Live Draft Order Card */}
                {isLatestDraftHolder && msg.draftOrder && (
                  <div className="w-full max-w-[92%] sm:max-w-[88%] bg-amber-50 border border-amber-200 rounded-2xl p-3.5 shadow-xs space-y-2.5 animate-fade-in">
                    <div className="flex items-center justify-between">
                      <span className="text-xs font-black text-amber-900 uppercase tracking-wider flex items-center gap-1.5">
                        <span>📋 Pedido em Montagem</span>
                        {msg.draftOrder.hasFrozen && (
                          <span className="bg-blue-100 text-blue-800 border border-blue-200 px-1.5 py-0.5 rounded text-[10px]">
                            ❄️ Congelado
                          </span>
                        )}
                      </span>
                      <span className="text-sm font-black text-emerald-800">
                        {formatCurrency(msg.draftOrder.total)}
                      </span>
                    </div>

                    <div className="space-y-1.5 text-xs text-stone-700 bg-white/80 p-2.5 rounded-xl border border-amber-200/60">
                      {msg.draftOrder.items.map((it, idx) => (
                        <div key={idx} className="flex justify-between items-start gap-2">
                          <div className="min-w-0">
                            <span className="font-bold text-stone-900">
                              {it.quantity}x {it.name}
                            </span>
                            {it.prepLabel && (
                              <span
                                className={`ml-1.5 inline-block px-1.5 py-0.5 rounded text-[10px] font-black uppercase ${
                                  it.isFrozen
                                    ? 'bg-blue-50 text-blue-700 border border-blue-200'
                                    : 'bg-amber-100 text-amber-900 border border-amber-300'
                                }`}
                              >
                                {it.prepLabel}
                              </span>
                            )}
                            {it.flavor && (
                              <span className="block text-[11px] text-stone-500">Sabor: {it.flavor.name}</span>
                            )}
                          </div>
                          <span className="font-bold text-stone-900 shrink-0">
                            {formatCurrency(getItemUnitTotal(it) * it.quantity)}
                          </span>
                        </div>
                      ))}

                      {msg.draftOrder.scheduledTime && (
                        <div className="pt-1.5 mt-1 border-t border-amber-200/70 flex items-center gap-1.5 text-[11px] font-bold text-amber-950">
                          <Calendar className="w-3.5 h-3.5 text-amber-600 shrink-0" />
                          <span>
                            Retirada: {msg.draftOrder.scheduledDay ? `${msg.draftOrder.scheduledDay} às ` : ''}
                            {msg.draftOrder.scheduledTime}
                            {msg.draftOrder.scheduledPickupTime
                              ? ` (estimativa ${msg.draftOrder.scheduledPickupTime}h)`
                              : ''}
                          </span>
                        </div>
                      )}
                    </div>

                    <div className="flex flex-wrap gap-2 pt-0.5">
                      {(onApplyAiDraftToCart || onAddDirectToCart || onAddToCart) && (
                        <button
                          type="button"
                          onClick={() => handleTransferDraftToCart(msg.draftOrder!, true)}
                          className="flex-1 bg-emerald-600 hover:bg-emerald-700 active:scale-95 text-white font-black py-2.5 px-3 rounded-xl flex items-center justify-center gap-1.5 text-xs shadow-sm transition-all cursor-pointer"
                        >
                          <ShoppingCart className="w-3.5 h-3.5" />
                          <span>Passar p/ Carrinho</span>
                        </button>
                      )}
                      <button
                        type="button"
                        onClick={() => {
                          if (msg.draftOrder?.customerName) setCustomerName(msg.draftOrder.customerName);
                          if (msg.draftOrder?.customerPhone) setCustomerPhone(msg.draftOrder.customerPhone);
                          setActiveOrderToSend(msg.draftOrder!);
                        }}
                        className="bg-white hover:bg-stone-100 text-stone-800 border border-stone-300 font-bold py-2.5 px-3 rounded-xl flex items-center justify-center gap-1.5 text-xs transition-all cursor-pointer shrink-0"
                        title="Finalizar formulário rápido / WhatsApp"
                      >
                        <MessageCircle className="w-3.5 h-3.5 text-emerald-600" />
                        <span>Fechar Formulário</span>
                      </button>
                    </div>
                  </div>
                )}

                {/* Finalized & Saved Order Card */}
                {msg.placedOrder && (
                  <div className="w-full max-w-[92%] sm:max-w-[88%] bg-emerald-50 border-2 border-emerald-400 rounded-2xl p-4 shadow-sm space-y-3 animate-fade-in">
                    <div className="flex items-center justify-between">
                      <div className="flex items-center gap-2">
                        <CheckCircle2 className="w-5 h-5 text-emerald-600" />
                        <span className="text-xs font-black text-emerald-950 uppercase tracking-wider">
                          Pedido #{msg.placedOrder.orderId} Enviado!
                        </span>
                      </div>
                      <span className="text-sm font-black text-emerald-800">
                        {formatCurrency(msg.placedOrder.total)}
                      </span>
                    </div>

                    <div className="bg-white rounded-xl p-2.5 border border-emerald-200 text-xs text-stone-700 space-y-1">
                      {msg.placedOrder.items.map((it, idx) => (
                        <div key={idx} className="flex justify-between gap-2">
                          <span>
                            <strong>{it.quantity}x</strong> {it.name}
                            {it.prepLabel ? ` (${it.prepLabel})` : ''}
                          </span>
                          <span className="font-bold shrink-0">
                            {formatCurrency(getItemUnitTotal(it) * it.quantity)}
                          </span>
                        </div>
                      ))}
                      {msg.placedOrder.scheduledTime && (
                        <div className="pt-1.5 mt-1 border-t border-emerald-100 font-bold text-emerald-900">
                          ⏰ Retirada: {msg.placedOrder.scheduledDay ? `${msg.placedOrder.scheduledDay} às ` : ''}
                          {msg.placedOrder.scheduledTime}
                          {msg.placedOrder.scheduledPickupTime
                            ? ` (estimada ${msg.placedOrder.scheduledPickupTime}h)`
                            : ''}
                        </div>
                      )}
                      <div className="text-[11px] text-stone-600">
                        💳 Pagamento: <strong>{msg.placedOrder.paymentMethod}</strong> • 👤{' '}
                        <strong>{msg.placedOrder.customerName}</strong>
                      </div>
                    </div>

                    {whatsappNumber && (
                      <button
                        type="button"
                        onClick={() => handleSendPlacedToWhatsApp(msg.placedOrder!)}
                        className="w-full bg-emerald-600 hover:bg-emerald-700 text-white font-black py-2.5 px-3 rounded-xl flex items-center justify-center gap-2 text-xs shadow-sm cursor-pointer transition-all"
                      >
                        <MessageCircle className="w-4 h-4" />
                        <span>Enviar Comprovante no WhatsApp</span>
                      </button>
                    )}
                  </div>
                )}
              </div>
            );
          })}

          {isLoading && (
            <div className="flex items-center gap-2.5 text-stone-700 text-xs bg-white p-3 px-4 rounded-2xl border border-amber-200/90 w-fit shadow-xs animate-fade-in">
              <div className="w-5 h-5 rounded-full bg-amber-500/20 flex items-center justify-center shrink-0">
                <Bot className="w-3.5 h-3.5 text-amber-700" />
              </div>
              <span className="font-semibold text-stone-600">{agentName} está consultando o sistema</span>
              <span className="flex items-center gap-1 pl-0.5">
                <span className="w-1.5 h-1.5 bg-amber-600 rounded-full animate-bounce [animation-delay:-0.3s]"></span>
                <span className="w-1.5 h-1.5 bg-amber-600 rounded-full animate-bounce [animation-delay:-0.15s]"></span>
                <span className="w-1.5 h-1.5 bg-amber-600 rounded-full animate-bounce"></span>
              </span>
            </div>
          )}

          <div ref={messagesEndRef} />
        </div>

        {/* Quick Prompts */}
        <div className="bg-white border-t border-stone-100 p-2 overflow-x-auto flex gap-1.5 no-scrollbar shrink-0">
          {quickPrompts.map((item, idx) => (
            <button
              key={idx}
              type="button"
              onClick={() => handleSendMessage(item.prompt)}
              disabled={isLoading}
              className="bg-stone-100 hover:bg-amber-100 hover:text-amber-900 hover:border-amber-300 text-stone-700 text-xs font-semibold px-3 py-1.5 rounded-full border border-stone-200 transition-all shrink-0 cursor-pointer disabled:opacity-50"
            >
              {item.label}
            </button>
          ))}
        </div>

        {/* Message Input Box */}
        <div className="p-3 sm:p-4 bg-white border-t border-stone-200 shrink-0">
          <form
            onSubmit={(e) => {
              e.preventDefault();
              handleSendMessage();
            }}
            className="flex items-center gap-2"
          >
            <input
              type="text"
              value={inputText}
              onChange={(e) => setInputText(e.target.value)}
              placeholder={`Converse ou faça seu pedido com ${agentName}...`}
              disabled={isLoading}
              className="flex-1 p-3 bg-stone-100 border border-stone-200 rounded-2xl text-sm text-stone-800 placeholder-stone-400 outline-none focus:ring-2 focus:ring-amber-500 focus:bg-white transition-all"
            />
            <button
              type="submit"
              disabled={!inputText.trim() || isLoading}
              className="p-3 bg-amber-600 hover:bg-amber-700 disabled:bg-stone-300 text-white rounded-2xl transition-all shadow-md flex items-center justify-center shrink-0 cursor-pointer disabled:cursor-not-allowed"
              title="Enviar mensagem"
            >
              <Send className="w-5 h-5" />
            </button>
          </form>
        </div>

        {/* ORDER CONFIRMATION SHEET (Optional quick form) */}
        {activeOrderToSend && (
          <div className="absolute inset-0 bg-stone-900/80 backdrop-blur-xs z-30 flex flex-col justify-end sm:justify-center p-0 sm:p-4 animate-fade-in">
            <div className="bg-white w-full rounded-t-3xl sm:rounded-3xl max-h-[92vh] overflow-y-auto p-5 shadow-2xl border border-stone-200 space-y-4">
              <div className="flex items-center justify-between pb-3 border-b border-stone-200">
                <div>
                  <h3 className="font-black text-base text-stone-900 flex items-center gap-2">
                    <Store className="w-5 h-5 text-emerald-600" />
                    Finalizar Pedido (Retirada no Balcão)
                  </h3>
                  <p className="text-xs text-stone-500 mt-0.5">
                    Registra o pedido no sistema e gera resumo para WhatsApp.
                  </p>
                </div>
                <button
                  type="button"
                  onClick={() => setActiveOrderToSend(null)}
                  className="p-1.5 text-stone-400 hover:text-stone-700 rounded-xl cursor-pointer"
                >
                  <X className="w-5 h-5" />
                </button>
              </div>

              {formError && (
                <div className="p-2.5 bg-red-50 border border-red-200 text-red-700 rounded-xl text-xs font-bold">
                  {formError}
                </div>
              )}

              <div className="bg-amber-50 p-3.5 rounded-2xl border border-amber-200/80 space-y-2">
                <div className="flex items-center justify-between font-bold text-xs text-stone-800">
                  <span>Itens do Pedido:</span>
                  <span className="text-sm font-black text-amber-700">
                    {formatCurrency(activeOrderToSend.total)}
                  </span>
                </div>
                <div className="text-xs text-stone-600 space-y-1 max-h-24 overflow-y-auto">
                  {activeOrderToSend.items.map((item, idx) => (
                    <div key={idx} className="flex justify-between gap-2">
                      <span className="truncate">
                        {item.quantity}x {item.name}
                        {item.prepLabel ? ` (${item.prepLabel})` : ''}
                      </span>
                      <span className="font-bold shrink-0">
                        {formatCurrency(getItemUnitTotal(item) * item.quantity)}
                      </span>
                    </div>
                  ))}
                </div>
                {activeOrderToSend.scheduledTime && (
                  <div className="text-[11px] font-bold text-amber-900 pt-1 border-t border-amber-200">
                    ⏰ Retirada: {activeOrderToSend.scheduledDay} às {activeOrderToSend.scheduledTime}
                  </div>
                )}
              </div>

              <form onSubmit={handleConfirmAndSendWhatsApp} className="space-y-3">
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                  <div>
                    <label className="block text-xs font-bold text-stone-700 mb-1">Seu Nome *</label>
                    <input
                      type="text"
                      required
                      value={customerName}
                      onChange={(e) => setCustomerName(e.target.value)}
                      placeholder="Ex: Maria Souza"
                      className="w-full p-2.5 border border-stone-300 rounded-xl text-xs font-medium text-stone-800 outline-none focus:ring-2 focus:ring-emerald-500"
                    />
                  </div>

                  <div>
                    <label className="block text-xs font-bold text-stone-700 mb-1">Seu WhatsApp *</label>
                    <input
                      type="tel"
                      required
                      value={customerPhone}
                      onChange={(e) => setCustomerPhone(e.target.value)}
                      placeholder="(00) 00000-0000"
                      className="w-full p-2.5 border border-stone-300 rounded-xl text-xs font-medium text-stone-800 outline-none focus:ring-2 focus:ring-emerald-500 font-mono"
                    />
                  </div>
                </div>

                <div>
                  <label className="block text-xs font-bold text-stone-700 mb-1.5">Forma de Pagamento</label>
                  <div className="grid grid-cols-3 gap-2">
                    <button
                      type="button"
                      onClick={() => setPaymentMethod('pix')}
                      className={`p-2 rounded-xl border text-xs font-bold flex flex-col items-center gap-1 transition-all cursor-pointer ${
                        paymentMethod === 'pix'
                          ? 'bg-emerald-50 border-emerald-500 text-emerald-800 ring-2 ring-emerald-500/20'
                          : 'bg-white border-stone-200 text-stone-600'
                      }`}
                    >
                      <QrCode className="w-4 h-4 text-emerald-600" />
                      <span>PIX</span>
                    </button>

                    <button
                      type="button"
                      onClick={() => setPaymentMethod('card')}
                      className={`p-2 rounded-xl border text-xs font-bold flex flex-col items-center gap-1 transition-all cursor-pointer ${
                        paymentMethod === 'card'
                          ? 'bg-emerald-50 border-emerald-500 text-emerald-800 ring-2 ring-emerald-500/20'
                          : 'bg-white border-stone-200 text-stone-600'
                      }`}
                    >
                      <CreditCard className="w-4 h-4 text-blue-600" />
                      <span>Cartão</span>
                    </button>

                    <button
                      type="button"
                      onClick={() => setPaymentMethod('cash')}
                      className={`p-2 rounded-xl border text-xs font-bold flex flex-col items-center gap-1 transition-all cursor-pointer ${
                        paymentMethod === 'cash'
                          ? 'bg-emerald-50 border-emerald-500 text-emerald-800 ring-2 ring-emerald-500/20'
                          : 'bg-white border-stone-200 text-stone-600'
                      }`}
                    >
                      <DollarSign className="w-4 h-4 text-amber-600" />
                      <span>Dinheiro</span>
                    </button>
                  </div>

                  {paymentMethod === 'cash' && (
                    <div className="mt-2">
                      <input
                        type="text"
                        value={cashChange}
                        onChange={(e) => setCashChange(e.target.value)}
                        placeholder="Troco para quanto? (Ex: R$ 50,00)"
                        className="w-full p-2 border border-stone-300 rounded-xl text-xs outline-none focus:ring-2 focus:ring-emerald-500"
                      />
                    </div>
                  )}
                </div>

                <div>
                  <label className="block text-xs font-bold text-stone-700 mb-1">Observações (Opcional)</label>
                  <input
                    type="text"
                    value={orderNotes}
                    onChange={(e) => setOrderNotes(e.target.value)}
                    placeholder="Ex: Bem quentinho, separar em caixas..."
                    className="w-full p-2 border border-stone-300 rounded-xl text-xs outline-none focus:ring-2 focus:ring-emerald-500"
                  />
                </div>

                <div className="pt-2">
                  <button
                    type="submit"
                    disabled={isSubmittingOrder}
                    className="w-full bg-emerald-600 hover:bg-emerald-700 disabled:bg-stone-300 text-white font-bold py-3 px-4 rounded-xl flex items-center justify-center gap-2 shadow-md transition-all cursor-pointer text-xs uppercase tracking-wider"
                  >
                    {isSubmittingOrder ? (
                      <RefreshCw className="w-4 h-4 animate-spin" />
                    ) : (
                      <CheckCircle2 className="w-4 h-4" />
                    )}
                    <span>Confirmar Pedido</span>
                  </button>
                </div>
              </form>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
