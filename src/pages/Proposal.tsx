import React, { useState } from 'react';
import { 
  Printer, 
  Download, 
  ArrowLeft, 
  CheckCircle2, 
  ShieldCheck, 
  Tv, 
  Smartphone, 
  Cpu, 
  Layers, 
  DollarSign, 
  Calendar, 
  Sparkles,
  FileText,
  Building2,
  Clock,
  Phone,
  Mail
} from 'lucide-react';
import { Link } from 'react-router-dom';
import { useStore } from '../store/useStore';

export default function Proposal() {
  const { storeInfo } = useStore();
  const [clientName, setClientName] = useState('BALBEC - Revenda de Salgados');
  const [clientContact, setClientContact] = useState('Diretoria / Gestão');
  const [proposalDate] = useState(new Date().toLocaleDateString('pt-BR'));
  const [validityDays] = useState('15 dias');

  const handlePrint = () => {
    window.print();
  };

  return (
    <div className="min-h-screen bg-stone-100 text-stone-900 py-6 px-4 sm:px-6 lg:px-8 font-sans print:p-0 print:bg-white">
      {/* Top action bar (hidden during print) */}
      <div className="max-w-4xl mx-auto mb-6 flex flex-wrap items-center justify-between gap-4 bg-white p-4 rounded-2xl shadow-sm border border-stone-200 print:hidden">
        <div className="flex items-center gap-3">
          <Link 
            to="/admin" 
            className="flex items-center gap-2 px-3 py-2 text-sm font-semibold text-stone-700 hover:text-stone-900 bg-stone-100 hover:bg-stone-200 rounded-xl transition"
          >
            <ArrowLeft className="w-4 h-4" /> Voltar ao Painel
          </Link>
          <span className="text-xs font-semibold text-amber-800 bg-amber-50 px-2.5 py-1 rounded-full border border-amber-200">
            Documento de Proposta Comercial
          </span>
        </div>
        <div className="flex items-center gap-2">
          <button
            onClick={handlePrint}
            className="flex items-center gap-2 px-5 py-2.5 bg-amber-600 hover:bg-amber-700 text-white font-bold text-sm rounded-xl shadow-md transition transform active:scale-95 cursor-pointer"
          >
            <Printer className="w-4 h-4" /> Imprimir / Salvar em PDF
          </button>
        </div>
      </div>

      {/* Main Printable Document Sheet */}
      <div className="max-w-4xl mx-auto bg-white rounded-3xl shadow-xl border border-stone-200 overflow-hidden print:shadow-none print:border-none print:rounded-none">
        
        {/* Header Ribbon / Branding */}
        <div className="bg-stone-900 text-white p-8 sm:p-10 border-b-4 border-amber-500 relative">
          <div className="flex flex-col sm:flex-row justify-between items-start sm:items-center gap-6">
            <div>
              <div className="flex items-center gap-2 text-amber-400 font-black text-xs uppercase tracking-widest mb-1">
                <Sparkles className="w-4 h-4" /> Proposta Comercial de Tecnologia & Software
              </div>
              <h1 className="text-2xl sm:text-3xl font-extrabold text-white tracking-tight">
                Sistema Integrado de Cardápio Digital & Mídia Smart TV
              </h1>
              <p className="text-stone-400 text-sm mt-1">
                Solução completa com integração ERP BlueFocus, Autoatendimento e Painel TV
              </p>
            </div>
            
            <div className="bg-stone-800/90 border border-stone-700 p-3.5 rounded-2xl text-right sm:min-w-[190px]">
              <div className="text-xs text-stone-400">Proposta Nº</div>
              <div className="text-sm font-black text-amber-400 font-mono">PROP-{new Date().getFullYear()}-042</div>
              <div className="text-xs text-stone-400 mt-1">Data: <span className="text-stone-200 font-semibold">{proposalDate}</span></div>
              <div className="text-xs text-stone-400">Validade: <span className="text-stone-200 font-semibold">{validityDays}</span></div>
            </div>
          </div>
        </div>

        <div className="p-8 sm:p-10 space-y-8">
          
          {/* Client & Scope Section */}
          <div className="grid grid-cols-1 md:grid-cols-2 gap-6 bg-stone-50 p-6 rounded-2xl border border-stone-200/80">
            <div>
              <h3 className="text-xs font-black uppercase tracking-wider text-stone-500 mb-2 flex items-center gap-1.5">
                <Building2 className="w-3.5 h-3.5 text-amber-600" /> Cliente / Solicitante
              </h3>
              <p className="font-bold text-stone-900 text-base">{clientName}</p>
              <p className="text-stone-600 text-xs mt-0.5">Aos cuidados: {clientContact}</p>
              <p className="text-stone-500 text-xs mt-0.5">{storeInfo.address || 'Uberaba - MG'}</p>
            </div>
            <div>
              <h3 className="text-xs font-black uppercase tracking-wider text-stone-500 mb-2 flex items-center gap-1.5">
                <Cpu className="w-3.5 h-3.5 text-amber-600" /> Objetivo da Solução
              </h3>
              <p className="text-xs text-stone-700 leading-relaxed">
                Modernização completa do atendimento, catálogo online e em loja, automação de pedidos para o caixa/ERP BlueFocus e ambientação dinâmica com sistema de TV interativo.
              </p>
            </div>
          </div>

          {/* Scope of Included Modules */}
          <div>
            <h2 className="text-lg font-black text-stone-900 mb-4 flex items-center gap-2 border-b border-stone-200 pb-2">
              <Layers className="w-5 h-5 text-amber-600" /> Módulos e Recursos Inclusos na Solução
            </h2>

            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              
              {/* Module 1 */}
              <div className="p-4 rounded-xl border border-stone-200 bg-white shadow-sm hover:border-amber-300 transition">
                <div className="flex items-start gap-3">
                  <div className="p-2.5 bg-amber-100 text-amber-800 rounded-xl shrink-0">
                    <Smartphone className="w-5 h-5" />
                  </div>
                  <div>
                    <h4 className="font-bold text-stone-900 text-sm">1. Cardápio Digital & Autoatendimento</h4>
                    <p className="text-xs text-stone-600 mt-1 leading-relaxed">
                      Catálogo visual responsivo para Celular, Tablet, Totem e Desktop. Suporte a pedidos no Balcão, Mesas e Delivery com envio automatizado para o WhatsApp.
                    </p>
                  </div>
                </div>
              </div>

              {/* Module 2 */}
              <div className="p-4 rounded-xl border border-stone-200 bg-white shadow-sm hover:border-amber-300 transition">
                <div className="flex items-start gap-3">
                  <div className="p-2.5 bg-blue-100 text-blue-800 rounded-xl shrink-0">
                    <Cpu className="w-5 h-5" />
                  </div>
                  <div>
                    <h4 className="font-bold text-stone-900 text-sm">2. Integração com ERP BlueFocus</h4>
                    <p className="text-xs text-stone-600 mt-1 leading-relaxed">
                      Sincronização em tempo real de produtos, preços, descrições e estoque. Envio dos pedidos de balcão e delivery diretamente para o sistema PDV.
                    </p>
                  </div>
                </div>
              </div>

              {/* Module 3 */}
              <div className="p-4 rounded-xl border border-stone-200 bg-white shadow-sm hover:border-amber-300 transition">
                <div className="flex items-start gap-3">
                  <div className="p-2.5 bg-red-100 text-red-800 rounded-xl shrink-0">
                    <Tv className="w-5 h-5" />
                  </div>
                  <div>
                    <h4 className="font-bold text-stone-900 text-sm">3. Sistema de Mídia Smart TV</h4>
                    <p className="text-xs text-stone-600 mt-1 leading-relaxed">
                      Painel para Smart TVs em tela cheia ou tela dividida. Rotação de vídeos institucionais, YouTube, banner de ofertas e chamada sonora de senhas/pedidos prontos.
                    </p>
                  </div>
                </div>
              </div>

              {/* Module 4 */}
              <div className="p-4 rounded-xl border border-stone-200 bg-white shadow-sm hover:border-amber-300 transition">
                <div className="flex items-start gap-3">
                  <div className="p-2.5 bg-emerald-100 text-emerald-800 rounded-xl shrink-0">
                    <ShieldCheck className="w-5 h-5" />
                  </div>
                  <div>
                    <h4 className="font-bold text-stone-900 text-sm">4. Painel de Gestão Administrativa</h4>
                    <p className="text-xs text-stone-600 mt-1 leading-relaxed">
                      Gestão de pedidos em tempo real, controle de status (preparando/pronto), edição de fotos, personalização de cores, horários e notificações sonoras.
                    </p>
                  </div>
                </div>
              </div>

            </div>
          </div>

          {/* Pricing Options Comparison */}
          <div>
            <h2 className="text-lg font-black text-stone-900 mb-4 flex items-center gap-2 border-b border-stone-200 pb-2">
              <DollarSign className="w-5 h-5 text-amber-600" /> Opções Comerciais de Contratação
            </h2>

            <div className="grid grid-cols-1 md:grid-cols-2 gap-6 items-stretch">
              
              {/* Option 1: Full Purchase */}
              <div className="relative flex flex-col justify-between p-6 rounded-2xl border-2 border-amber-500 bg-amber-50/30 shadow-md">
                <div className="absolute -top-3 right-6 bg-amber-600 text-white font-extrabold text-[10px] tracking-wider uppercase px-3 py-1 rounded-full shadow-sm">
                  Opção Mais Econômica a Longo Prazo
                </div>

                <div>
                  <div className="text-xs font-black uppercase text-amber-900 tracking-wider mb-1">
                    Opção 01 — Compra Total do Projeto
                  </div>
                  <h3 className="text-xl font-extrabold text-stone-900">
                    Licença Perpétua (Sem Mensalidade)
                  </h3>
                  <p className="text-xs text-stone-600 mt-1">
                    O cliente adquire o sistema completo em definitivo para seu estabelecimento.
                  </p>

                  <div className="my-5 p-4 bg-white rounded-xl border border-amber-200 shadow-inner">
                    <div className="text-xs text-stone-500 font-medium">Investimento Total:</div>
                    <div className="text-2xl font-black text-stone-900 flex items-baseline gap-1">
                      R$ 2.850,00
                    </div>
                    <div className="mt-2 text-xs font-bold text-amber-800 bg-amber-100/70 p-2 rounded-lg inline-block w-full text-center">
                      Dividido em até 4x de R$ 712,50
                    </div>
                  </div>

                  <ul className="space-y-2 text-xs text-stone-700 mb-4">
                    <li className="flex items-start gap-2">
                      <CheckCircle2 className="w-4 h-4 text-emerald-600 shrink-0 mt-0.5" />
                      <span><strong>Zero mensalidade fixa:</strong> sem custos recorrentes mensais.</span>
                    </li>
                    <li className="flex items-start gap-2">
                      <CheckCircle2 className="w-4 h-4 text-emerald-600 shrink-0 mt-0.5" />
                      <span><strong>Todos os módulos inclusos:</strong> Cardápio, TV, BlueFocus e Admin.</span>
                    </li>
                    <li className="flex items-start gap-2">
                      <CheckCircle2 className="w-4 h-4 text-emerald-600 shrink-0 mt-0.5" />
                      <span><strong>Código e infraestrutura dedicados:</strong> com domínio próprio.</span>
                    </li>
                    <li className="flex items-start gap-2 text-stone-500">
                      <Clock className="w-4 h-4 text-stone-400 shrink-0 mt-0.5" />
                      <span><strong>Suporte sob demanda:</strong> alterações e novas funcionalidades futuras são orçadas por serviço avulso.</span>
                    </li>
                  </ul>
                </div>

                <div className="pt-3 border-t border-amber-200/60 text-[11px] text-stone-500 text-center">
                  Condição de pagamento: 4 parcelas quinzenais ou mensais combinadas.
                </div>
              </div>

              {/* Option 2: Setup + Monthly */}
              <div className="flex flex-col justify-between p-6 rounded-2xl border border-stone-300 bg-white shadow-sm">
                <div>
                  <div className="text-xs font-black uppercase text-stone-500 tracking-wider mb-1">
                    Opção 02 — Implantação + Mensalidade
                  </div>
                  <h3 className="text-xl font-extrabold text-stone-900">
                    Modelo SaaS (Com Suporte Contínuo)
                  </h3>
                  <p className="text-xs text-stone-600 mt-1">
                    Menor investimento inicial com suporte contínuo e manutenção inclusa.
                  </p>

                  <div className="my-5 p-4 bg-stone-50 rounded-xl border border-stone-200">
                    <div className="grid grid-cols-2 gap-3 divide-x divide-stone-200">
                      <div>
                        <div className="text-[11px] text-stone-500 font-medium">Taxa de Implantação:</div>
                        <div className="text-xl font-black text-stone-900">R$ 850,00</div>
                        <div className="text-[10px] text-stone-500 font-semibold">(Pago à vista no início)</div>
                      </div>
                      <div className="pl-3">
                        <div className="text-[11px] text-stone-500 font-medium">Mensalidade:</div>
                        <div className="text-xl font-black text-blue-700">R$ 160,00<span className="text-xs font-normal text-stone-500">/mês</span></div>
                        <div className="text-[10px] text-emerald-700 font-bold">1ª parcela em 30 dias</div>
                      </div>
                    </div>
                  </div>

                  <ul className="space-y-2 text-xs text-stone-700 mb-4">
                    <li className="flex items-start gap-2">
                      <CheckCircle2 className="w-4 h-4 text-emerald-600 shrink-0 mt-0.5" />
                      <span><strong>Implantação completa:</strong> configuração de produtos, BlueFocus e TV.</span>
                    </li>
                    <li className="flex items-start gap-2">
                      <CheckCircle2 className="w-4 h-4 text-emerald-600 shrink-0 mt-0.5" />
                      <span><strong>Primeira mensalidade após 30 dias</strong> da entrega do projeto.</span>
                    </li>
                    <li className="flex items-start gap-2">
                      <CheckCircle2 className="w-4 h-4 text-emerald-600 shrink-0 mt-0.5" />
                      <span><strong>Suporte técnico e atualizações</strong> de manutenção inclusos na mensalidade.</span>
                    </li>
                    <li className="flex items-start gap-2">
                      <CheckCircle2 className="w-4 h-4 text-emerald-600 shrink-0 mt-0.5" />
                      <span><strong>Garantia contínua de funcionamento</strong> em nuvem.</span>
                    </li>
                  </ul>
                </div>

                <div className="pt-3 border-t border-stone-200 text-[11px] text-stone-500 text-center">
                  Contrato de prestação de serviços com renovação periódica.
                </div>
              </div>

            </div>
          </div>

          {/* Delivery Timeline & Terms */}
          <div className="bg-stone-50 p-6 rounded-2xl border border-stone-200 space-y-4">
            <h3 className="text-sm font-bold text-stone-900 flex items-center gap-2">
              <Calendar className="w-4 h-4 text-amber-600" /> Prazos e Condições Gerais
            </h3>
            
            <div className="grid grid-cols-1 sm:grid-cols-3 gap-4 text-xs text-stone-600">
              <div className="bg-white p-3 rounded-xl border border-stone-200">
                <span className="font-bold text-stone-900 block mb-0.5">Prazo de Entrega:</span>
                3 a 7 dias úteis após fornecimento dos acessos da BlueFocus e dados da loja.
              </div>
              <div className="bg-white p-3 rounded-xl border border-stone-200">
                <span className="font-bold text-stone-900 block mb-0.5">Treinamento:</span>
                Instrução remota da equipe para operação do painel de pedidos e TV.
              </div>
              <div className="bg-white p-3 rounded-xl border border-stone-200">
                <span className="font-bold text-stone-900 block mb-0.5">Formas de Pagamento:</span>
                PIX, Transferência Bancária ou Boleto conforme a opção escolhida.
              </div>
            </div>
          </div>

          {/* Signatures / Approval block */}
          <div className="pt-6 border-t border-stone-200 grid grid-cols-1 sm:grid-cols-2 gap-8 text-center">
            <div>
              <div className="border-b border-stone-300 w-48 mx-auto mb-2"></div>
              <p className="text-xs font-bold text-stone-900">Prestador / Responsável Técnico</p>
              <p className="text-[11px] text-stone-500">Desenvolvimento & Integração de Sistemas</p>
            </div>
            <div>
              <div className="border-b border-stone-300 w-48 mx-auto mb-2"></div>
              <p className="text-xs font-bold text-stone-900">De Acordo do Cliente</p>
              <p className="text-[11px] text-stone-500">{clientName}</p>
            </div>
          </div>

        </div>

        {/* Footer */}
        <div className="bg-stone-100 px-8 py-4 border-t border-stone-200 text-center text-xs text-stone-500">
          Proposta confidencial gerada para uso exclusivo de <strong>{clientName}</strong>. Dúvidas ou alterações: entre em contato diretamente.
        </div>

      </div>

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
