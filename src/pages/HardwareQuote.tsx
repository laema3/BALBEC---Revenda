import React, { useState, useEffect } from 'react';
import { 
  Printer, 
  ArrowLeft, 
  CheckCircle2, 
  ShieldCheck, 
  DollarSign, 
  Calendar, 
  Building2, 
  Wrench,
  Server,
  HardDrive,
  Plus,
  Trash2,
  Copy,
  Edit3,
  Save,
  FileText,
  RotateCcw,
  Eye,
  Layers,
  Check
} from 'lucide-react';
import { Link } from 'react-router-dom';

export interface HardwareQuoteItem {
  id: string;
  type: 'product' | 'service';
  name: string;
  model?: string;
  serialNumber?: string;
  description?: string;
  quantity: number;
  unit: string;
  unitPrice: number;
}

export interface HardwareQuoteData {
  id: string;
  quoteNumber: string;
  title: string;
  subtitle: string;
  badgeText: string;
  date: string;
  validity: string;
  clientName: string;
  clientAttention: string;
  paymentCondition: string;
  deliveryObservation: string;
  items: HardwareQuoteItem[];
  warrantyTerms: string[];
  technicianTitle: string;
  technicianSubtitle: string;
  clientSignatureTitle: string;
  clientSignatureSubtitle: string;
  footerNote: string;
  createdAt: number;
  updatedAt: number;
}

const STORAGE_KEY = 'balbec_hardware_quotes_v2';
const ACTIVE_ID_KEY = 'balbec_hardware_active_quote_id_v2';

const DEFAULT_QUOTE: HardwareQuoteData = {
  id: 'quote-default-ti-01',
  quoteNumber: 'ORC-2026-0889',
  title: 'ORÇAMENTO DE EQUIPAMENTOS & SERVIÇOS',
  subtitle: 'Infraestrutura de Rede, Armazenamento e Manutenção de PDV',
  badgeText: 'Comprovante & Proposta de Fornecimento',
  date: new Date().toLocaleDateString('pt-BR'),
  validity: '10 dias',
  clientName: 'BALBEC — Revenda de Salgados',
  clientAttention: 'Aos cuidados da Gestão / Caixa',
  paymentCondition: 'À Vista (PIX / Transferência / Cartão)',
  deliveryObservation: 'Equipamentos a pronta-entrega / instalados',
  items: [
    {
      id: 'item-1',
      type: 'product',
      name: 'SWITCH 24 PORTAS GIGABIT 10/100/1000 TP-LINK',
      model: 'TL-SG1024D',
      serialNumber: 'V259027001533',
      description: '24 Portas RJ45 Gigabit de alta capacidade para automação comercial',
      quantity: 1,
      unit: 'un',
      unitPrice: 799.00
    },
    {
      id: 'item-2',
      type: 'product',
      name: 'SSD 256GB SATA III ALTA VELOCIDADE',
      model: '',
      serialNumber: '',
      description: 'Unidade de estado sólido para agilização do sistema operacional e PDV',
      quantity: 1,
      unit: 'un',
      unitPrice: 289.00
    },
    {
      id: 'item-3',
      type: 'service',
      name: 'MÃO DE OBRA ESPECIALIZADA (TERMINAL CAIXA / PDV)',
      model: '',
      serialNumber: '',
      description: 'Montagem física, fixação no rack/caixa, conexão de cabos de rede e testes',
      quantity: 1,
      unit: 'un',
      unitPrice: 80.00
    }
  ],
  warrantyTerms: [
    'Switch TP-Link TL-SG1024D (N/S: V259027001533): Garantia legal e de fábrica contra defeitos de fabricação.',
    'SSD 256GB: Garantia de 12 meses contra defeitos de hardware.',
    'Serviço de Mão de Obra: Garantia de 90 dias sobre a instalação realizada.'
  ],
  technicianTitle: 'Responsável Técnico / Fornecedor',
  technicianSubtitle: 'Suporte & Infraestrutura de TI',
  clientSignatureTitle: 'De Acordo do Cliente',
  clientSignatureSubtitle: 'BALBEC',
  footerNote: `Documento gerado em ${new Date().toLocaleDateString('pt-BR')} • Válido por 10 dias`,
  createdAt: Date.now(),
  updatedAt: Date.now()
};

const formatBRL = (val: number) => {
  return (val || 0).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });
};

export default function HardwareQuote() {
  const [quotes, setQuotes] = useState<HardwareQuoteData[]>(() => {
    try {
      const saved = localStorage.getItem(STORAGE_KEY);
      if (saved) {
        const parsed = JSON.parse(saved);
        if (Array.isArray(parsed) && parsed.length > 0) {
          return parsed;
        }
      }
    } catch (e) {
      console.warn('Erro ao carregar orçamentos salvos do localStorage:', e);
    }
    return [DEFAULT_QUOTE];
  });

  const [activeQuoteId, setActiveQuoteId] = useState<string>(() => {
    try {
      const savedActive = localStorage.getItem(ACTIVE_ID_KEY);
      if (savedActive) return savedActive;
    } catch (e) {}
    return DEFAULT_QUOTE.id;
  });

  const [mode, setMode] = useState<'view' | 'edit' | 'manage'>('view');
  const [saveSuccessMsg, setSaveSuccessMsg] = useState<string | null>(null);

  // Active quote data
  const currentQuote = quotes.find(q => q.id === activeQuoteId) || quotes[0] || DEFAULT_QUOTE;

  // Local editing state for active quote
  const [formData, setFormData] = useState<HardwareQuoteData>(currentQuote);

  // Sync formData whenever currentQuote or activeQuoteId changes
  useEffect(() => {
    setFormData(currentQuote);
  }, [activeQuoteId, quotes]);

  // Persist quotes to localStorage
  useEffect(() => {
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(quotes));
      localStorage.setItem(ACTIVE_ID_KEY, activeQuoteId);
    } catch (e) {
      console.error('Erro ao salvar no localStorage:', e);
    }
  }, [quotes, activeQuoteId]);

  // Flash message helper
  const showToast = (msg: string) => {
    setSaveSuccessMsg(msg);
    setTimeout(() => setSaveSuccessMsg(null), 3500);
  };

  const handlePrint = () => {
    setMode('view');
    setTimeout(() => {
      window.print();
    }, 150);
  };

  // Calculations
  const calculateTotals = (quote: HardwareQuoteData) => {
    let subtotalProducts = 0;
    let subtotalServices = 0;

    quote.items.forEach(item => {
      const itemTotal = (Number(item.unitPrice) || 0) * (Number(item.quantity) || 1);
      if (item.type === 'service') {
        subtotalServices += itemTotal;
      } else {
        subtotalProducts += itemTotal;
      }
    });

    const totalGeneral = subtotalProducts + subtotalServices;
    return { subtotalProducts, subtotalServices, totalGeneral };
  };

  const totals = calculateTotals(mode === 'edit' ? formData : currentQuote);

  // Save changes to current quote
  const handleSaveFormData = () => {
    const updated: HardwareQuoteData = {
      ...formData,
      updatedAt: Date.now()
    };
    setQuotes(prev => prev.map(q => q.id === updated.id ? updated : q));
    showToast('Orçamento salvo com sucesso!');
    setMode('view');
  };

  // Create new quote
  const handleCreateNewQuote = (cloneFromCurrent = false) => {
    const randomSuffix = Math.floor(1000 + Math.random() * 9000);
    const newNumber = `ORC-2026-${randomSuffix}`;
    const newId = `quote-ti-${Date.now()}`;

    let newQuote: HardwareQuoteData;

    if (cloneFromCurrent && currentQuote) {
      newQuote = {
        ...currentQuote,
        id: newId,
        quoteNumber: newNumber,
        title: `${currentQuote.title} (Cópia)`,
        date: new Date().toLocaleDateString('pt-BR'),
        items: currentQuote.items.map(it => ({ ...it, id: `item-${Date.now()}-${Math.random()}` })),
        createdAt: Date.now(),
        updatedAt: Date.now()
      };
    } else {
      newQuote = {
        id: newId,
        quoteNumber: newNumber,
        title: 'NOVA PROPOSTA DE EQUIPAMENTOS & SERVIÇOS',
        subtitle: 'Proposta Comercial de Tecnologia e Infraestrutura',
        badgeText: 'Comprovante & Proposta de Fornecimento',
        date: new Date().toLocaleDateString('pt-BR'),
        validity: '10 dias',
        clientName: currentQuote.clientName || 'BALBEC — Revenda de Salgados',
        clientAttention: 'Aos cuidados da Gestão / Caixa',
        paymentCondition: 'À Vista (PIX / Transferência / Cartão)',
        deliveryObservation: 'Equipamentos a pronta-entrega / instalados',
        items: [
          {
            id: `item-${Date.now()}-1`,
            type: 'product',
            name: 'EQUIPAMENTO / PEÇA DE TI',
            model: 'Modelo do Item',
            serialNumber: '',
            description: 'Descrição detalhada do equipamento ou peça',
            quantity: 1,
            unit: 'un',
            unitPrice: 150.00
          },
          {
            id: `item-${Date.now()}-2`,
            type: 'service',
            name: 'SERVIÇO DE INSTALAÇÃO E CONFIGURAÇÃO',
            model: '',
            serialNumber: '',
            description: 'Mão de obra técnica especializada',
            quantity: 1,
            unit: 'un',
            unitPrice: 100.00
          }
        ],
        warrantyTerms: [
          'Equipamentos: Garantia legal de 90 dias ou conforme fabricante.',
          'Mão de obra: Garantia de 90 dias sobre a instalação realizada.'
        ],
        technicianTitle: 'Responsável Técnico / Fornecedor',
        technicianSubtitle: 'Suporte & Infraestrutura de TI',
        clientSignatureTitle: 'De Acordo do Cliente',
        clientSignatureSubtitle: 'BALBEC',
        footerNote: `Documento gerado em ${new Date().toLocaleDateString('pt-BR')} • Válido por 10 dias`,
        createdAt: Date.now(),
        updatedAt: Date.now()
      };
    }

    setQuotes(prev => [newQuote, ...prev]);
    setActiveQuoteId(newId);
    setFormData(newQuote);
    setMode('edit');
    showToast(cloneFromCurrent ? 'Proposta duplicada com sucesso!' : 'Nova proposta criada! Agora personalize os dados.');
  };

  // Delete quote
  const handleDeleteQuote = (idToDelete: string) => {
    if (quotes.length <= 1) {
      alert('Não é possível excluir a única proposta restante. Você pode editá-la conforme desejar.');
      return;
    }
    const qToDelete = quotes.find(q => q.id === idToDelete);
    const confirmDelete = window.confirm(`Deseja realmente excluir o orçamento "${qToDelete?.quoteNumber || idToDelete}"?`);
    if (!confirmDelete) return;

    const remaining = quotes.filter(q => q.id !== idToDelete);
    setQuotes(remaining);
    if (activeQuoteId === idToDelete) {
      setActiveQuoteId(remaining[0].id);
    }
    showToast('Proposta excluída com sucesso.');
  };

  // Reset to original default quote
  const handleResetToDefault = () => {
    const confirmReset = window.confirm('Deseja restaurar o orçamento original de TI (Switch 24p TP-Link, SSD 256GB e Mão de Obra)? Suas outras propostas serão mantidas.');
    if (!confirmReset) return;

    const exists = quotes.some(q => q.id === DEFAULT_QUOTE.id);
    if (exists) {
      setQuotes(prev => prev.map(q => q.id === DEFAULT_QUOTE.id ? { ...DEFAULT_QUOTE, updatedAt: Date.now() } : q));
    } else {
      setQuotes(prev => [DEFAULT_QUOTE, ...prev]);
    }
    setActiveQuoteId(DEFAULT_QUOTE.id);
    setFormData(DEFAULT_QUOTE);
    setMode('view');
    showToast('Orçamento original de TI restaurado!');
  };

  // Item management in form
  const handleAddItem = (type: 'product' | 'service' = 'product') => {
    const newItem: HardwareQuoteItem = {
      id: `item-${Date.now()}-${Math.random()}`,
      type,
      name: type === 'product' ? 'NOVO PRODUTO / EQUIPAMENTO' : 'SERVIÇO / MÃO DE OBRA',
      model: '',
      serialNumber: '',
      description: '',
      quantity: 1,
      unit: 'un',
      unitPrice: 0
    };
    setFormData(prev => ({
      ...prev,
      items: [...prev.items, newItem]
    }));
  };

  const handleRemoveItem = (itemId: string) => {
    setFormData(prev => ({
      ...prev,
      items: prev.items.filter(it => it.id !== itemId)
    }));
  };

  const handleUpdateItem = (itemId: string, field: keyof HardwareQuoteItem, value: any) => {
    setFormData(prev => ({
      ...prev,
      items: prev.items.map(it => it.id === itemId ? { ...it, [field]: value } : it)
    }));
  };

  // Warranty management in form
  const handleAddWarranty = () => {
    setFormData(prev => ({
      ...prev,
      warrantyTerms: [...prev.warrantyTerms, 'Novo termo de garantia.']
    }));
  };

  const handleRemoveWarranty = (idx: number) => {
    setFormData(prev => ({
      ...prev,
      warrantyTerms: prev.warrantyTerms.filter((_, i) => i !== idx)
    }));
  };

  const handleUpdateWarranty = (idx: number, value: string) => {
    setFormData(prev => ({
      ...prev,
      warrantyTerms: prev.warrantyTerms.map((w, i) => i === idx ? value : w)
    }));
  };

  return (
    <div className="min-h-screen bg-stone-100 text-stone-900 py-6 px-4 sm:px-6 lg:px-8 font-sans print:p-0 print:bg-white">
      
      {/* Toast Alert */}
      {saveSuccessMsg && (
        <div className="fixed top-5 right-5 z-50 bg-emerald-700 text-white px-5 py-3 rounded-2xl shadow-xl flex items-center gap-2 text-sm font-bold animate-bounce print:hidden">
          <CheckCircle2 className="w-5 h-5 text-emerald-200" />
          {saveSuccessMsg}
        </div>
      )}

      {/* Top Action Bar (Hidden when printing/saving PDF) */}
      <div className="max-w-4xl mx-auto mb-6 bg-white p-4 sm:p-5 rounded-2xl shadow-sm border border-stone-200 print:hidden space-y-4">
        
        {/* Row 1: Navigation, Tabs and Main Actions */}
        <div className="flex flex-wrap items-center justify-between gap-3">
          
          <div className="flex items-center gap-2">
            <Link 
              to="/admin" 
              className="flex items-center gap-1.5 px-3 py-2 text-xs font-bold text-stone-700 hover:text-stone-900 bg-stone-100 hover:bg-stone-200 rounded-xl transition"
            >
              <ArrowLeft className="w-4 h-4" /> Voltar ao Painel
            </Link>

            <span className="text-xs font-black text-emerald-800 bg-emerald-50 px-3 py-1.5 rounded-xl border border-emerald-200/80 hidden sm:inline-flex items-center gap-1.5">
              <HardDrive className="w-3.5 h-3.5 text-emerald-600" />
              Gestor de Orçamentos TI
            </span>
          </div>

          {/* Mode Switcher Tabs */}
          <div className="flex items-center bg-stone-100 p-1 rounded-xl border border-stone-200 text-xs font-bold">
            <button
              onClick={() => setMode('view')}
              className={`flex items-center gap-1.5 px-3 py-1.5 rounded-lg transition cursor-pointer ${
                mode === 'view' 
                  ? 'bg-white text-stone-900 shadow-xs' 
                  : 'text-stone-600 hover:text-stone-900'
              }`}
            >
              <Eye className="w-3.5 h-3.5 text-emerald-600" />
              <span>Visualizar</span>
            </button>

            <button
              onClick={() => {
                setFormData(currentQuote);
                setMode('edit');
              }}
              className={`flex items-center gap-1.5 px-3 py-1.5 rounded-lg transition cursor-pointer ${
                mode === 'edit' 
                  ? 'bg-emerald-600 text-white shadow-xs' 
                  : 'bg-emerald-50 text-emerald-800 hover:bg-emerald-100 border border-emerald-300'
              }`}
            >
              <Edit3 className="w-3.5 h-3.5 text-emerald-700" />
              <span>✏️ Editar Orçamento</span>
            </button>

            <button
              onClick={() => setMode('manage')}
              className={`flex items-center gap-1.5 px-3 py-1.5 rounded-lg transition cursor-pointer ${
                mode === 'manage' 
                  ? 'bg-stone-900 text-white shadow-xs' 
                  : 'text-stone-600 hover:text-stone-900'
              }`}
            >
              <Layers className="w-3.5 h-3.5 text-amber-600" />
              <span>Todas as Propostas ({quotes.length})</span>
            </button>
          </div>

          {/* Print/Download Button */}
          <div className="flex items-center gap-2">
            <button
              onClick={handlePrint}
              className="flex items-center gap-2 px-5 py-2.5 bg-stone-900 hover:bg-black active:scale-95 text-white font-bold text-xs sm:text-sm rounded-xl shadow-md transition cursor-pointer"
              title="Abre a caixa de impressão/geração de PDF formatada para A4"
            >
              <Printer className="w-4 h-4 text-emerald-400" /> Baixar PDF / Imprimir
            </button>
          </div>

        </div>

        {/* Row 2: Proposal Selector and Quick Actions */}
        <div className="pt-3 border-t border-stone-100 flex flex-wrap items-center justify-between gap-3 text-xs">
          
          <div className="flex items-center gap-2 flex-wrap">
            <span className="font-bold text-stone-500">Proposta Ativa:</span>
            <select
              value={activeQuoteId}
              onChange={(e) => {
                setActiveQuoteId(e.target.value);
                const selected = quotes.find(q => q.id === e.target.value);
                if (selected) setFormData(selected);
              }}
              className="bg-stone-50 border border-stone-300 rounded-xl px-3 py-1.5 font-bold text-stone-800 text-xs focus:ring-2 focus:ring-emerald-500 outline-hidden max-w-xs sm:max-w-md cursor-pointer"
            >
              {quotes.map(q => {
                const qTotals = calculateTotals(q);
                return (
                  <option key={q.id} value={q.id}>
                    {q.quoteNumber} — {q.title.substring(0, 32)}... ({formatBRL(qTotals.totalGeneral)})
                  </option>
                );
              })}
            </select>
          </div>

          <div className="flex items-center gap-2 flex-wrap">
            <button
              type="button"
              onClick={() => {
                setFormData(currentQuote);
                setMode('edit');
              }}
              className="flex items-center gap-1.5 px-3.5 py-1.5 bg-emerald-600 hover:bg-emerald-700 text-white rounded-xl font-bold transition shadow-xs cursor-pointer"
              title="Editar itens, valores, cliente e garantias deste orçamento"
            >
              <Edit3 className="w-3.5 h-3.5" /> Editar Este Orçamento
            </button>

            <button
              type="button"
              onClick={() => handleCreateNewQuote(false)}
              className="flex items-center gap-1.5 px-3.5 py-1.5 bg-amber-500 hover:bg-amber-600 text-stone-950 rounded-xl font-black transition shadow-xs cursor-pointer"
              title="Criar uma nova proposta comercial em branco"
            >
              <Plus className="w-3.5 h-3.5 text-stone-950" /> + Nova Proposta
            </button>

            <button
              type="button"
              onClick={() => handleCreateNewQuote(true)}
              className="flex items-center gap-1.5 px-3 py-1.5 bg-stone-100 hover:bg-stone-200 text-stone-800 border border-stone-200 rounded-xl font-semibold transition cursor-pointer"
              title="Duplica a proposta atual com um novo número e data de hoje"
            >
              <Copy className="w-3.5 h-3.5 text-stone-600" /> Duplicar Atual
            </button>

            {quotes.length > 1 && (
              <button
                type="button"
                onClick={() => handleDeleteQuote(activeQuoteId)}
                className="flex items-center gap-1.5 px-2.5 py-1.5 text-red-600 hover:bg-red-50 rounded-xl font-semibold transition cursor-pointer"
                title="Excluir este orçamento"
              >
                <Trash2 className="w-3.5 h-3.5" />
              </button>
            )}

            <button
              type="button"
              onClick={handleResetToDefault}
              className="flex items-center gap-1 px-2.5 py-1.5 text-stone-400 hover:text-stone-700 hover:bg-stone-100 rounded-xl font-medium transition cursor-pointer"
              title="Restaurar orçamento original com Switch 24p, SSD e Mão de obra"
            >
              <RotateCcw className="w-3 h-3" /> Restaurar Padrão
            </button>
          </div>

        </div>

      </div>

      {/* ========================================================================= */}
      {/* MODE 1: PROPOSALS MANAGER (LIST OF ALL PROPOSALS) */}
      {/* ========================================================================= */}
      {mode === 'manage' && (
        <div className="max-w-4xl mx-auto bg-white rounded-2xl shadow-xl border border-stone-200 p-6 sm:p-8 space-y-6 print:hidden">
          <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4 border-b border-stone-200 pb-4">
            <div>
              <h2 className="text-xl font-black text-stone-900 flex items-center gap-2">
                <Layers className="w-5 h-5 text-amber-600" />
                Catálogo de Propostas & Orçamentos de TI
              </h2>
              <p className="text-stone-500 text-xs mt-1">
                Gerencie todas as propostas salvas no sistema. Você pode criar novas, editar, duplicar ou imprimir.
              </p>
            </div>
            <button
              onClick={() => handleCreateNewQuote(false)}
              className="flex items-center gap-2 px-4 py-2 bg-emerald-600 hover:bg-emerald-700 text-white font-bold text-xs rounded-xl shadow-md transition cursor-pointer"
            >
              <Plus className="w-4 h-4" /> Criar Nova Proposta
            </button>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            {quotes.map(q => {
              const qTotals = calculateTotals(q);
              const isActive = q.id === activeQuoteId;

              return (
                <div 
                  key={q.id}
                  className={`p-5 rounded-2xl border transition-all flex flex-col justify-between ${
                    isActive 
                      ? 'border-emerald-500 bg-emerald-50/20 shadow-md ring-2 ring-emerald-500/20' 
                      : 'border-stone-200 bg-stone-50/60 hover:bg-white hover:shadow-sm'
                  }`}
                >
                  <div>
                    <div className="flex items-center justify-between gap-2 mb-2">
                      <span className="font-mono font-black text-xs px-2.5 py-1 bg-stone-900 text-emerald-400 rounded-lg">
                        {q.quoteNumber}
                      </span>
                      <span className="text-[11px] text-stone-500 font-medium">
                        Data: {q.date}
                      </span>
                    </div>

                    <h3 className="font-black text-stone-900 text-sm mb-1 leading-snug">
                      {q.title}
                    </h3>
                    <p className="text-xs text-stone-600 mb-3 line-clamp-2">
                      {q.subtitle}
                    </p>

                    <div className="bg-white p-3 rounded-xl border border-stone-200/80 mb-4 space-y-1 text-xs">
                      <div className="flex justify-between text-stone-500">
                        <span>Itens:</span>
                        <span className="font-bold text-stone-700">{q.items.length} itens</span>
                      </div>
                      <div className="flex justify-between text-stone-500">
                        <span>Validade:</span>
                        <span className="font-bold text-stone-700">{q.validity}</span>
                      </div>
                      <div className="flex justify-between items-baseline pt-1 border-t border-stone-100">
                        <span className="font-bold text-stone-800">Total:</span>
                        <span className="text-sm font-black text-emerald-700">{formatBRL(qTotals.totalGeneral)}</span>
                      </div>
                    </div>
                  </div>

                  <div className="flex items-center justify-between gap-2 pt-2 border-t border-stone-200/60">
                    <button
                      onClick={() => {
                        setActiveQuoteId(q.id);
                        setMode('view');
                      }}
                      className="flex-1 flex items-center justify-center gap-1.5 px-3 py-1.5 bg-stone-900 hover:bg-stone-800 text-white rounded-xl text-xs font-bold transition cursor-pointer"
                    >
                      <Eye className="w-3.5 h-3.5 text-emerald-400" /> Abrir
                    </button>

                    <button
                      onClick={() => {
                        setActiveQuoteId(q.id);
                        setFormData(q);
                        setMode('edit');
                      }}
                      className="px-3 py-1.5 bg-stone-100 hover:bg-stone-200 text-stone-800 rounded-xl text-xs font-bold transition cursor-pointer"
                      title="Editar dados desta proposta"
                    >
                      <Edit3 className="w-3.5 h-3.5" />
                    </button>

                    <button
                      onClick={() => {
                        setActiveQuoteId(q.id);
                        handleCreateNewQuote(true);
                      }}
                      className="px-3 py-1.5 bg-stone-100 hover:bg-stone-200 text-stone-800 rounded-xl text-xs font-bold transition cursor-pointer"
                      title="Duplicar esta proposta"
                    >
                      <Copy className="w-3.5 h-3.5" />
                    </button>

                    {quotes.length > 1 && (
                      <button
                        onClick={() => handleDeleteQuote(q.id)}
                        className="px-2.5 py-1.5 text-red-600 hover:bg-red-50 rounded-xl text-xs font-bold transition cursor-pointer"
                        title="Excluir proposta"
                      >
                        <Trash2 className="w-3.5 h-3.5" />
                      </button>
                    )}
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      )}

      {/* ========================================================================= */}
      {/* MODE 2: FORM EDITOR (EDITING ACTIVE QUOTE) */}
      {/* ========================================================================= */}
      {mode === 'edit' && (
        <div className="max-w-4xl mx-auto bg-white rounded-2xl shadow-xl border border-stone-200 p-6 sm:p-8 space-y-8 print:hidden">
          
          <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4 border-b border-stone-200 pb-4">
            <div>
              <div className="text-emerald-600 font-black text-xs uppercase tracking-wider mb-1 flex items-center gap-1.5">
                <Edit3 className="w-4 h-4" /> Editando Orçamento
              </div>
              <h2 className="text-xl font-black text-stone-900">
                Personalizar Dados da Proposta ({formData.quoteNumber})
              </h2>
              <p className="text-stone-500 text-xs mt-0.5">
                Altere textos, itens, quantidades, valores e termos de garantia. O documento final será gerado automaticamente.
              </p>
            </div>

            <div className="flex items-center gap-2">
              <button
                type="button"
                onClick={() => setMode('view')}
                className="px-4 py-2 bg-stone-100 hover:bg-stone-200 text-stone-700 font-bold text-xs rounded-xl transition cursor-pointer"
              >
                Cancelar
              </button>
              <button
                type="button"
                onClick={handleSaveFormData}
                className="flex items-center gap-1.5 px-5 py-2 bg-emerald-600 hover:bg-emerald-700 active:scale-95 text-white font-bold text-xs rounded-xl shadow-md transition cursor-pointer"
              >
                <Save className="w-4 h-4" /> Salvar Alterações
              </button>
            </div>
          </div>

          {/* Section 1: Header / Document Identity */}
          <div className="space-y-4">
            <h3 className="text-sm font-black text-stone-900 uppercase tracking-wider flex items-center gap-2 border-b border-stone-100 pb-2">
              <FileText className="w-4 h-4 text-emerald-600" />
              1. Identificação do Documento
            </h3>

            <div className="grid grid-cols-1 sm:grid-cols-3 gap-4 text-xs">
              <div>
                <label className="block font-bold text-stone-700 mb-1">Número do Orçamento:</label>
                <input
                  type="text"
                  value={formData.quoteNumber}
                  onChange={(e) => setFormData(prev => ({ ...prev, quoteNumber: e.target.value }))}
                  className="w-full bg-stone-50 border border-stone-300 rounded-xl px-3 py-2 font-mono font-bold text-stone-900 focus:ring-2 focus:ring-emerald-500 outline-hidden"
                  placeholder="Ex: ORC-2026-0889"
                />
              </div>

              <div>
                <label className="block font-bold text-stone-700 mb-1">Data:</label>
                <input
                  type="text"
                  value={formData.date}
                  onChange={(e) => setFormData(prev => ({ ...prev, date: e.target.value }))}
                  className="w-full bg-stone-50 border border-stone-300 rounded-xl px-3 py-2 text-stone-900 focus:ring-2 focus:ring-emerald-500 outline-hidden"
                  placeholder="Ex: 19/10/2026"
                />
              </div>

              <div>
                <label className="block font-bold text-stone-700 mb-1">Validade:</label>
                <input
                  type="text"
                  value={formData.validity}
                  onChange={(e) => setFormData(prev => ({ ...prev, validity: e.target.value }))}
                  className="w-full bg-stone-50 border border-stone-300 rounded-xl px-3 py-2 text-stone-900 focus:ring-2 focus:ring-emerald-500 outline-hidden"
                  placeholder="Ex: 10 dias"
                />
              </div>
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 text-xs">
              <div>
                <label className="block font-bold text-stone-700 mb-1">Título Principal do Documento:</label>
                <input
                  type="text"
                  value={formData.title}
                  onChange={(e) => setFormData(prev => ({ ...prev, title: e.target.value }))}
                  className="w-full bg-stone-50 border border-stone-300 rounded-xl px-3 py-2 font-bold text-stone-900 focus:ring-2 focus:ring-emerald-500 outline-hidden"
                  placeholder="Ex: ORÇAMENTO DE EQUIPAMENTOS & SERVIÇOS"
                />
              </div>

              <div>
                <label className="block font-bold text-stone-700 mb-1">Etiqueta Superior (Badge):</label>
                <input
                  type="text"
                  value={formData.badgeText}
                  onChange={(e) => setFormData(prev => ({ ...prev, badgeText: e.target.value }))}
                  className="w-full bg-stone-50 border border-stone-300 rounded-xl px-3 py-2 text-stone-900 focus:ring-2 focus:ring-emerald-500 outline-hidden"
                  placeholder="Ex: Comprovante & Proposta de Fornecimento"
                />
              </div>

              <div className="sm:col-span-2">
                <label className="block font-bold text-stone-700 mb-1">Subtítulo / Descrição da Proposta:</label>
                <input
                  type="text"
                  value={formData.subtitle}
                  onChange={(e) => setFormData(prev => ({ ...prev, subtitle: e.target.value }))}
                  className="w-full bg-stone-50 border border-stone-300 rounded-xl px-3 py-2 text-stone-900 focus:ring-2 focus:ring-emerald-500 outline-hidden"
                  placeholder="Ex: Infraestrutura de Rede, Armazenamento e Manutenção de PDV"
                />
              </div>
            </div>
          </div>

          {/* Section 2: Client & Conditions */}
          <div className="space-y-4">
            <h3 className="text-sm font-black text-stone-900 uppercase tracking-wider flex items-center gap-2 border-b border-stone-100 pb-2">
              <Building2 className="w-4 h-4 text-emerald-600" />
              2. Dados do Cliente e Condições
            </h3>

            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 text-xs">
              <div>
                <label className="block font-bold text-stone-700 mb-1">Cliente / Solicitante:</label>
                <input
                  type="text"
                  value={formData.clientName}
                  onChange={(e) => setFormData(prev => ({ ...prev, clientName: e.target.value }))}
                  className="w-full bg-stone-50 border border-stone-300 rounded-xl px-3 py-2 font-bold text-stone-900 focus:ring-2 focus:ring-emerald-500 outline-hidden"
                  placeholder="Ex: BALBEC — Revenda de Salgados"
                />
              </div>

              <div>
                <label className="block font-bold text-stone-700 mb-1">Aos cuidados de:</label>
                <input
                  type="text"
                  value={formData.clientAttention}
                  onChange={(e) => setFormData(prev => ({ ...prev, clientAttention: e.target.value }))}
                  className="w-full bg-stone-50 border border-stone-300 rounded-xl px-3 py-2 text-stone-900 focus:ring-2 focus:ring-emerald-500 outline-hidden"
                  placeholder="Ex: Aos cuidados da Gestão / Caixa"
                />
              </div>

              <div>
                <label className="block font-bold text-stone-700 mb-1">Condição de Pagamento:</label>
                <input
                  type="text"
                  value={formData.paymentCondition}
                  onChange={(e) => setFormData(prev => ({ ...prev, paymentCondition: e.target.value }))}
                  className="w-full bg-stone-50 border border-stone-300 rounded-xl px-3 py-2 font-bold text-stone-900 focus:ring-2 focus:ring-emerald-500 outline-hidden"
                  placeholder="Ex: À Vista (PIX / Transferência / Cartão)"
                />
              </div>

              <div>
                <label className="block font-bold text-stone-700 mb-1">Observação do Pagamento / Entrega:</label>
                <input
                  type="text"
                  value={formData.deliveryObservation}
                  onChange={(e) => setFormData(prev => ({ ...prev, deliveryObservation: e.target.value }))}
                  className="w-full bg-stone-50 border border-stone-300 rounded-xl px-3 py-2 text-stone-900 focus:ring-2 focus:ring-emerald-500 outline-hidden"
                  placeholder="Ex: Equipamentos a pronta-entrega / instalados"
                />
              </div>
            </div>
          </div>

          {/* Section 3: Items list */}
          <div className="space-y-4">
            <div className="flex items-center justify-between border-b border-stone-100 pb-2">
              <h3 className="text-sm font-black text-stone-900 uppercase tracking-wider flex items-center gap-2">
                <HardDrive className="w-4 h-4 text-emerald-600" />
                3. Discriminação dos Produtos e Serviços
              </h3>
              <div className="flex items-center gap-2">
                <button
                  type="button"
                  onClick={() => handleAddItem('product')}
                  className="flex items-center gap-1 px-3 py-1 bg-blue-50 hover:bg-blue-100 text-blue-700 font-bold text-xs rounded-lg transition cursor-pointer"
                >
                  <Plus className="w-3.5 h-3.5" /> + Produto
                </button>
                <button
                  type="button"
                  onClick={() => handleAddItem('service')}
                  className="flex items-center gap-1 px-3 py-1 bg-amber-50 hover:bg-amber-100 text-amber-800 font-bold text-xs rounded-lg transition cursor-pointer"
                >
                  <Plus className="w-3.5 h-3.5" /> + Serviço / Mão de Obra
                </button>
              </div>
            </div>

            <div className="space-y-4">
              {formData.items.map((item, idx) => {
                const itemTotal = (Number(item.unitPrice) || 0) * (Number(item.quantity) || 1);

                return (
                  <div 
                    key={item.id}
                    className="p-4 bg-stone-50 rounded-2xl border border-stone-200/90 relative space-y-3 text-xs"
                  >
                    <div className="flex items-center justify-between gap-2">
                      <div className="flex items-center gap-2">
                        <span className="font-bold text-stone-400 font-mono">#{String(idx + 1).padStart(2, '0')}</span>
                        <select
                          value={item.type}
                          onChange={(e) => handleUpdateItem(item.id, 'type', e.target.value as any)}
                          className={`font-bold px-2.5 py-1 rounded-lg border text-xs cursor-pointer ${
                            item.type === 'service' 
                              ? 'bg-amber-100/60 text-amber-900 border-amber-300' 
                              : 'bg-blue-100/60 text-blue-900 border-blue-300'
                          }`}
                        >
                          <option value="product">📦 Produto / Equipamento</option>
                          <option value="service">🔧 Serviço / Mão de Obra</option>
                        </select>
                      </div>

                      <div className="flex items-center gap-3">
                        <span className="font-black text-stone-900 text-sm">
                          Subtotal: {formatBRL(itemTotal)}
                        </span>
                        {formData.items.length > 1 && (
                          <button
                            type="button"
                            onClick={() => handleRemoveItem(item.id)}
                            className="p-1 text-red-500 hover:text-red-700 hover:bg-red-50 rounded-lg transition cursor-pointer"
                            title="Remover item"
                          >
                            <Trash2 className="w-4 h-4" />
                          </button>
                        )}
                      </div>
                    </div>

                    <div className="grid grid-cols-1 sm:grid-cols-12 gap-3">
                      <div className="sm:col-span-6">
                        <label className="block font-bold text-stone-600 mb-1">Nome do Item / Título:</label>
                        <input
                          type="text"
                          value={item.name}
                          onChange={(e) => handleUpdateItem(item.id, 'name', e.target.value)}
                          className="w-full bg-white border border-stone-300 rounded-xl px-3 py-1.5 font-bold text-stone-900 focus:ring-2 focus:ring-emerald-500 outline-hidden"
                          placeholder="Ex: SWITCH 24 PORTAS GIGABIT TP-LINK"
                        />
                      </div>

                      <div className="sm:col-span-3">
                        <label className="block font-bold text-stone-600 mb-1">Modelo (Opcional):</label>
                        <input
                          type="text"
                          value={item.model || ''}
                          onChange={(e) => handleUpdateItem(item.id, 'model', e.target.value)}
                          className="w-full bg-white border border-stone-300 rounded-xl px-3 py-1.5 text-stone-800 focus:ring-2 focus:ring-emerald-500 outline-hidden"
                          placeholder="Ex: TL-SG1024D"
                        />
                      </div>

                      <div className="sm:col-span-3">
                        <label className="block font-bold text-stone-600 mb-1">Número de Série N/S (Opcional):</label>
                        <input
                          type="text"
                          value={item.serialNumber || ''}
                          onChange={(e) => handleUpdateItem(item.id, 'serialNumber', e.target.value)}
                          className="w-full bg-white border border-stone-300 rounded-xl px-3 py-1.5 font-mono text-stone-800 focus:ring-2 focus:ring-emerald-500 outline-hidden"
                          placeholder="Ex: V259027001533"
                        />
                      </div>

                      <div className="sm:col-span-6">
                        <label className="block font-bold text-stone-600 mb-1">Descrição / Especificações Técnicas:</label>
                        <input
                          type="text"
                          value={item.description || ''}
                          onChange={(e) => handleUpdateItem(item.id, 'description', e.target.value)}
                          className="w-full bg-white border border-stone-300 rounded-xl px-3 py-1.5 text-stone-700 focus:ring-2 focus:ring-emerald-500 outline-hidden"
                          placeholder="Ex: 24 Portas RJ45 Gigabit de alta capacidade"
                        />
                      </div>

                      <div className="sm:col-span-2">
                        <label className="block font-bold text-stone-600 mb-1">Qtd:</label>
                        <input
                          type="number"
                          min="1"
                          step="1"
                          value={item.quantity}
                          onChange={(e) => handleUpdateItem(item.id, 'quantity', Math.max(1, parseInt(e.target.value) || 1))}
                          className="w-full bg-white border border-stone-300 rounded-xl px-3 py-1.5 font-bold text-center text-stone-900 focus:ring-2 focus:ring-emerald-500 outline-hidden"
                        />
                      </div>

                      <div className="sm:col-span-2">
                        <label className="block font-bold text-stone-600 mb-1">Unidade:</label>
                        <input
                          type="text"
                          value={item.unit || 'un'}
                          onChange={(e) => handleUpdateItem(item.id, 'unit', e.target.value)}
                          className="w-full bg-white border border-stone-300 rounded-xl px-3 py-1.5 text-center text-stone-800 focus:ring-2 focus:ring-emerald-500 outline-hidden"
                          placeholder="un"
                        />
                      </div>

                      <div className="sm:col-span-2">
                        <label className="block font-bold text-stone-600 mb-1">Valor Unit. (R$):</label>
                        <input
                          type="number"
                          min="0"
                          step="0.01"
                          value={item.unitPrice}
                          onChange={(e) => handleUpdateItem(item.id, 'unitPrice', parseFloat(e.target.value) || 0)}
                          className="w-full bg-white border border-stone-300 rounded-xl px-3 py-1.5 font-bold text-right text-stone-900 focus:ring-2 focus:ring-emerald-500 outline-hidden"
                        />
                      </div>
                    </div>
                  </div>
                );
              })}
            </div>

            {/* Real-time Summary Box */}
            <div className="flex justify-end pt-2">
              <div className="w-full sm:w-80 bg-stone-50 p-4 rounded-2xl border border-stone-200 space-y-2 text-xs">
                <div className="flex justify-between text-stone-600">
                  <span>Subtotal Produtos:</span>
                  <span className="font-bold text-stone-800">{formatBRL(totals.subtotalProducts)}</span>
                </div>
                <div className="flex justify-between text-stone-600">
                  <span>Subtotal Serviços:</span>
                  <span className="font-bold text-stone-800">{formatBRL(totals.subtotalServices)}</span>
                </div>
                <div className="pt-2 border-t border-stone-300 flex justify-between items-baseline">
                  <span className="text-sm font-black text-stone-900">TOTAL GERAL:</span>
                  <span className="text-lg font-black text-emerald-700">{formatBRL(totals.totalGeneral)}</span>
                </div>
              </div>
            </div>
          </div>

          {/* Section 4: Warranty Terms */}
          <div className="space-y-4">
            <div className="flex items-center justify-between border-b border-stone-100 pb-2">
              <h3 className="text-sm font-black text-stone-900 uppercase tracking-wider flex items-center gap-2">
                <ShieldCheck className="w-4 h-4 text-emerald-600" />
                4. Termos de Garantia
              </h3>
              <button
                type="button"
                onClick={handleAddWarranty}
                className="flex items-center gap-1 px-3 py-1 bg-emerald-50 hover:bg-emerald-100 text-emerald-800 font-bold text-xs rounded-lg transition cursor-pointer"
              >
                <Plus className="w-3.5 h-3.5" /> + Linha de Garantia
              </button>
            </div>

            <div className="space-y-2 text-xs">
              {formData.warrantyTerms.map((term, idx) => (
                <div key={idx} className="flex items-center gap-2">
                  <span className="text-stone-400 font-bold">•</span>
                  <input
                    type="text"
                    value={term}
                    onChange={(e) => handleUpdateWarranty(idx, e.target.value)}
                    className="flex-1 bg-stone-50 border border-stone-300 rounded-xl px-3 py-2 text-stone-800 focus:ring-2 focus:ring-emerald-500 outline-hidden"
                    placeholder="Ex: Switch TP-Link: Garantia legal e de fábrica..."
                  />
                  {formData.warrantyTerms.length > 1 && (
                    <button
                      type="button"
                      onClick={() => handleRemoveWarranty(idx)}
                      className="p-1.5 text-red-500 hover:text-red-700 hover:bg-red-50 rounded-lg transition cursor-pointer"
                      title="Remover termo"
                    >
                      <Trash2 className="w-4 h-4" />
                    </button>
                  )}
                </div>
              ))}
            </div>
          </div>

          {/* Section 5: Signatures and Footer Note */}
          <div className="space-y-4">
            <h3 className="text-sm font-black text-stone-900 uppercase tracking-wider flex items-center gap-2 border-b border-stone-100 pb-2">
              <Building2 className="w-4 h-4 text-emerald-600" />
              5. Assinaturas e Rodapé
            </h3>

            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 text-xs">
              <div>
                <label className="block font-bold text-stone-700 mb-1">Título do Responsável Técnico:</label>
                <input
                  type="text"
                  value={formData.technicianTitle}
                  onChange={(e) => setFormData(prev => ({ ...prev, technicianTitle: e.target.value }))}
                  className="w-full bg-stone-50 border border-stone-300 rounded-xl px-3 py-2 text-stone-900 focus:ring-2 focus:ring-emerald-500 outline-hidden font-bold"
                />
              </div>

              <div>
                <label className="block font-bold text-stone-700 mb-1">Subtítulo / Função do Técnico:</label>
                <input
                  type="text"
                  value={formData.technicianSubtitle}
                  onChange={(e) => setFormData(prev => ({ ...prev, technicianSubtitle: e.target.value }))}
                  className="w-full bg-stone-50 border border-stone-300 rounded-xl px-3 py-2 text-stone-700 focus:ring-2 focus:ring-emerald-500 outline-hidden"
                />
              </div>

              <div>
                <label className="block font-bold text-stone-700 mb-1">Título da Assinatura do Cliente:</label>
                <input
                  type="text"
                  value={formData.clientSignatureTitle}
                  onChange={(e) => setFormData(prev => ({ ...prev, clientSignatureTitle: e.target.value }))}
                  className="w-full bg-stone-50 border border-stone-300 rounded-xl px-3 py-2 text-stone-900 focus:ring-2 focus:ring-emerald-500 outline-hidden font-bold"
                />
              </div>

              <div>
                <label className="block font-bold text-stone-700 mb-1">Subtítulo do Cliente:</label>
                <input
                  type="text"
                  value={formData.clientSignatureSubtitle}
                  onChange={(e) => setFormData(prev => ({ ...prev, clientSignatureSubtitle: e.target.value }))}
                  className="w-full bg-stone-50 border border-stone-300 rounded-xl px-3 py-2 text-stone-700 focus:ring-2 focus:ring-emerald-500 outline-hidden"
                />
              </div>

              <div className="sm:col-span-2">
                <label className="block font-bold text-stone-700 mb-1">Texto de Rodapé:</label>
                <input
                  type="text"
                  value={formData.footerNote}
                  onChange={(e) => setFormData(prev => ({ ...prev, footerNote: e.target.value }))}
                  className="w-full bg-stone-50 border border-stone-300 rounded-xl px-3 py-2 text-stone-600 focus:ring-2 focus:ring-emerald-500 outline-hidden"
                />
              </div>
            </div>
          </div>

          {/* Bottom Save Bar */}
          <div className="pt-6 border-t border-stone-200 flex flex-wrap items-center justify-between gap-3">
            <button
              type="button"
              onClick={() => setMode('view')}
              className="px-5 py-2.5 bg-stone-100 hover:bg-stone-200 text-stone-700 font-bold text-xs rounded-xl transition cursor-pointer"
            >
              Cancelar e Ver Prévia
            </button>

            <button
              type="button"
              onClick={handleSaveFormData}
              className="flex items-center gap-2 px-8 py-3 bg-emerald-600 hover:bg-emerald-700 active:scale-95 text-white font-black text-sm rounded-xl shadow-lg transition cursor-pointer"
            >
              <Save className="w-4 h-4" /> Salvar Orçamento
            </button>
          </div>

        </div>
      )}

      {/* ========================================================================= */}
      {/* MODE 3: VIEW / PRINTABLE SHEET (FAITHFUL EXECUTIVE PRESENTATION) */}
      {/* ========================================================================= */}
      {mode === 'view' && (
        <div className="space-y-4">
          {/* Quick Action Banner for View Mode */}
          <div className="max-w-3xl mx-auto bg-gradient-to-r from-emerald-950 via-stone-900 to-stone-950 text-white p-4 sm:p-5 rounded-2xl shadow-lg border border-emerald-500/30 flex flex-col md:flex-row items-stretch md:items-center justify-between gap-4 print:hidden">
            <div className="flex items-center gap-3">
              <div className="w-10 h-10 rounded-xl bg-emerald-500/20 border border-emerald-400/30 flex items-center justify-center text-emerald-400 font-black shrink-0">
                <FileText className="w-5 h-5" />
              </div>
              <div>
                <div className="text-xs font-bold text-emerald-300 flex items-center gap-2">
                  <span>Proposta Ativa:</span>
                  <span className="font-mono bg-emerald-950/80 px-2 py-0.5 rounded border border-emerald-500/40 text-white font-bold">{currentQuote.quoteNumber}</span>
                </div>
                <div className="text-xs text-stone-300 mt-0.5 font-medium">
                  {currentQuote.title} — <strong className="text-emerald-400">{formatBRL(totals.totalGeneral)}</strong>
                </div>
              </div>
            </div>

            <div className="flex items-center gap-2 flex-wrap">
              <button
                type="button"
                onClick={() => {
                  setFormData(currentQuote);
                  setMode('edit');
                }}
                className="flex-1 sm:flex-none flex items-center justify-center gap-1.5 px-4 py-2.5 bg-emerald-500 hover:bg-emerald-400 active:scale-95 text-stone-950 font-black text-xs rounded-xl shadow-md transition cursor-pointer"
                title="Editar os equipamentos, serviços, preços e termos desta proposta"
              >
                <Edit3 className="w-4 h-4" /> ✏️ Editar Este Orçamento
              </button>

              <button
                type="button"
                onClick={() => handleCreateNewQuote(false)}
                className="flex-1 sm:flex-none flex items-center justify-center gap-1.5 px-4 py-2.5 bg-amber-500 hover:bg-amber-400 active:scale-95 text-stone-950 font-black text-xs rounded-xl shadow-md transition cursor-pointer"
                title="Criar uma nova proposta comercial em branco"
              >
                <Plus className="w-4 h-4 text-stone-950" /> ➕ Criar Nova Proposta
              </button>

              <button
                type="button"
                onClick={() => handleCreateNewQuote(true)}
                className="flex items-center justify-center gap-1.5 px-3 py-2.5 bg-stone-800 hover:bg-stone-700 text-stone-200 border border-stone-700 font-bold text-xs rounded-xl transition cursor-pointer"
                title="Duplicar proposta como nova"
              >
                <Copy className="w-3.5 h-3.5 text-stone-400" /> Duplicar
              </button>
            </div>
          </div>

          <div className="max-w-3xl mx-auto bg-white rounded-2xl shadow-xl border border-stone-200 overflow-hidden print:shadow-none print:border-none print:rounded-none">
          
          {/* Header */}
          <div className="bg-stone-900 text-white p-8 border-b-4 border-emerald-500">
            <div className="flex flex-col sm:flex-row justify-between items-start sm:items-center gap-4">
              <div>
                <div className="text-emerald-400 font-black text-xs uppercase tracking-widest mb-1">
                  {currentQuote.badgeText || 'Comprovante & Proposta de Fornecimento'}
                </div>
                <h1 className="text-2xl font-black tracking-tight text-white">
                  {currentQuote.title}
                </h1>
                <p className="text-stone-400 text-xs mt-0.5">
                  {currentQuote.subtitle}
                </p>
              </div>
              
              <div className="bg-stone-800 border border-stone-700 p-3 rounded-xl text-right sm:min-w-[170px] shrink-0">
                <div className="text-[11px] text-stone-400">Orçamento Nº</div>
                <div className="text-sm font-black text-emerald-400 font-mono">{currentQuote.quoteNumber}</div>
                <div className="text-[11px] text-stone-400 mt-1">Data: <span className="text-stone-200 font-semibold">{currentQuote.date}</span></div>
                <div className="text-[11px] text-stone-400">Validade: <span className="text-stone-200 font-semibold">{currentQuote.validity}</span></div>
              </div>
            </div>
          </div>

          <div className="p-8 space-y-6">
            
            {/* Customer & Location */}
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 bg-stone-50 p-4 rounded-xl border border-stone-200/80 text-xs">
              <div>
                <span className="font-bold text-stone-500 uppercase tracking-wider block mb-1">Cliente / Solicitante:</span>
                <p className="font-bold text-stone-900 text-sm">{currentQuote.clientName}</p>
                <p className="text-stone-600">{currentQuote.clientAttention}</p>
              </div>
              <div>
                <span className="font-bold text-stone-500 uppercase tracking-wider block mb-1">Condição de Pagamento:</span>
                <p className="font-bold text-stone-900 text-sm">{currentQuote.paymentCondition}</p>
                <p className="text-stone-600">{currentQuote.deliveryObservation}</p>
              </div>
            </div>

            {/* Table of Items */}
            <div>
              <h2 className="text-sm font-black text-stone-900 uppercase tracking-wider mb-3 flex items-center gap-2">
                <HardDrive className="w-4 h-4 text-emerald-600" /> Discriminação dos Produtos e Serviços
              </h2>

              <div className="border border-stone-200 rounded-xl overflow-hidden shadow-sm">
                <table className="w-full text-left text-xs border-collapse">
                  <thead className="bg-stone-100 text-stone-700 font-bold border-b border-stone-200">
                    <tr>
                      <th className="py-3 px-4 w-12 text-center">Item</th>
                      <th className="py-3 px-4">Descrição do Produto / Serviço</th>
                      <th className="py-3 px-3 text-center w-16">Qtd</th>
                      <th className="py-3 px-4 text-right w-28">Valor Unit.</th>
                      <th className="py-3 px-4 text-right w-28">Total</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-stone-200 text-stone-800">
                    
                    {currentQuote.items.map((item, idx) => {
                      const itemTotal = (Number(item.unitPrice) || 0) * (Number(item.quantity) || 1);
                      const isService = item.type === 'service';

                      return (
                        <tr 
                          key={item.id} 
                          className={`hover:bg-stone-50/50 ${isService ? 'bg-stone-50/30' : ''}`}
                        >
                          <td className="py-3.5 px-4 text-center font-bold text-stone-500">
                            {String(idx + 1).padStart(2, '0')}
                          </td>
                          <td className="py-3.5 px-4">
                            <div className="font-bold text-stone-900 text-sm flex items-center gap-1.5">
                              {isService ? (
                                <Wrench className="w-3.5 h-3.5 text-amber-600 shrink-0" />
                              ) : (
                                <Server className="w-3.5 h-3.5 text-blue-600 shrink-0" />
                              )}
                              {item.name}
                            </div>
                            
                            <div className="text-[11px] text-stone-600 mt-1 space-y-0.5">
                              {item.model && (
                                <p>• Modelo: <strong>{item.model}</strong></p>
                              )}
                              {item.serialNumber && (
                                <p className="font-mono bg-stone-100 inline-block px-1.5 py-0.5 rounded border border-stone-200 text-stone-800 font-bold">
                                  N/S: {item.serialNumber}
                                </p>
                              )}
                              {item.description && (
                                <p className="text-stone-500">• {item.description}</p>
                              )}
                            </div>
                          </td>
                          <td className="py-3.5 px-3 text-center font-semibold">
                            {item.quantity} {item.unit || 'un'}
                          </td>
                          <td className="py-3.5 px-4 text-right font-medium text-stone-600">
                            {formatBRL(item.unitPrice)}
                          </td>
                          <td className="py-3.5 px-4 text-right font-black text-stone-900">
                            {formatBRL(itemTotal)}
                          </td>
                        </tr>
                      );
                    })}

                  </tbody>
                </table>
              </div>
            </div>

            {/* Financial Summary */}
            <div className="flex justify-end">
              <div className="w-full sm:w-72 bg-stone-50 p-4 rounded-xl border border-stone-200 space-y-2 text-xs">
                {totals.subtotalProducts > 0 && (
                  <div className="flex justify-between text-stone-600">
                    <span>Subtotal Produtos:</span>
                    <span className="font-semibold">{formatBRL(totals.subtotalProducts)}</span>
                  </div>
                )}
                {totals.subtotalServices > 0 && (
                  <div className="flex justify-between text-stone-600">
                    <span>Subtotal Serviços (Mão de Obra):</span>
                    <span className="font-semibold">{formatBRL(totals.subtotalServices)}</span>
                  </div>
                )}
                <div className="pt-2 border-t border-stone-300 flex justify-between items-baseline">
                  <span className="text-sm font-black text-stone-900">TOTAL GERAL:</span>
                  <span className="text-xl font-black text-emerald-700">{formatBRL(totals.totalGeneral)}</span>
                </div>
              </div>
            </div>

            {/* Warranty Terms */}
            {currentQuote.warrantyTerms && currentQuote.warrantyTerms.length > 0 && (
              <div className="p-4 bg-stone-50 rounded-xl border border-stone-200 text-[11px] text-stone-600 space-y-1.5">
                <h4 className="font-bold text-stone-800 uppercase tracking-wider flex items-center gap-1.5">
                  <ShieldCheck className="w-3.5 h-3.5 text-emerald-600" /> Termos de Garantia
                </h4>
                {currentQuote.warrantyTerms.map((term, tIdx) => (
                  <p key={tIdx}>• {term}</p>
                ))}
              </div>
            )}

            {/* Signatures */}
            <div className="pt-6 border-t border-stone-200 grid grid-cols-2 gap-8 text-center text-xs">
              <div>
                <div className="border-b border-stone-300 w-44 mx-auto mb-2"></div>
                <p className="font-bold text-stone-800">{currentQuote.technicianTitle}</p>
                <p className="text-[10px] text-stone-500">{currentQuote.technicianSubtitle}</p>
              </div>
              <div>
                <div className="border-b border-stone-300 w-44 mx-auto mb-2"></div>
                <p className="font-bold text-stone-800">{currentQuote.clientSignatureTitle}</p>
                <p className="text-[10px] text-stone-500">{currentQuote.clientSignatureSubtitle}</p>
              </div>
            </div>

          </div>

          {/* Footer */}
          <div className="bg-stone-100 px-6 py-3 border-t border-stone-200 text-center text-[10px] text-stone-500">
            {currentQuote.footerNote || `Documento gerado em ${currentQuote.date} • Válido por ${currentQuote.validity}`}
          </div>

        </div>

          {/* Bottom Action Footer for View Mode */}
          <div className="max-w-3xl mx-auto bg-white p-5 rounded-2xl shadow-sm border border-stone-200 flex flex-wrap items-center justify-between gap-4 print:hidden">
            <div>
              <h4 className="text-sm font-black text-stone-900">Gerenciar ou Modificar este Orçamento</h4>
              <p className="text-xs text-stone-500 mt-0.5">
                Altere valores, edite termos de garantia, ou crie uma nova proposta para outro serviço.
              </p>
            </div>

            <div className="flex items-center gap-2 flex-wrap">
              <button
                type="button"
                onClick={() => {
                  setFormData(currentQuote);
                  setMode('edit');
                }}
                className="flex items-center gap-2 px-4 py-2.5 bg-emerald-600 hover:bg-emerald-700 active:scale-95 text-white font-black text-xs rounded-xl shadow-md transition cursor-pointer"
              >
                <Edit3 className="w-4 h-4" /> Editar Este Orçamento
              </button>

              <button
                type="button"
                onClick={() => handleCreateNewQuote(false)}
                className="flex items-center gap-2 px-4 py-2.5 bg-amber-500 hover:bg-amber-600 active:scale-95 text-stone-950 font-black text-xs rounded-xl shadow-md transition cursor-pointer"
              >
                <Plus className="w-4 h-4" /> + Criar Outra Proposta
              </button>

              <button
                type="button"
                onClick={handlePrint}
                className="flex items-center gap-2 px-4 py-2.5 bg-stone-900 hover:bg-black text-white font-bold text-xs rounded-xl transition cursor-pointer"
              >
                <Printer className="w-4 h-4 text-emerald-400" /> Imprimir / PDF
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Print styles */}
      <style>{`
        @media print {
          body {
            background-color: white !important;
            color: black !important;
            margin: 0 !important;
            padding: 0 !important;
          }
          .print\\:hidden {
            display: none !important;
          }
          .print\\:p-0 {
            padding: 0 !important;
          }
          .print\\:shadow-none {
            box-shadow: none !important;
          }
          .print\\:border-none {
            border: none !important;
          }
          .print\\:rounded-none {
            border-radius: 0 !important;
          }
          @page {
            size: A4 portrait;
            margin: 1.2cm;
          }
        }
      `}</style>
    </div>
  );
}
