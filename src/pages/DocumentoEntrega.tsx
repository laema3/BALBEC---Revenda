import React from 'react';
import { Printer, ArrowLeft, CheckCircle2 } from 'lucide-react';
import { Link } from 'react-router-dom';

export default function DocumentoEntrega() {
  const handlePrint = () => {
    window.print();
  };

  return (
    <div className="min-h-screen bg-stone-100 text-stone-800 antialiased py-8 px-4 sm:px-6 lg:px-8 print:p-0 print:m-0 print:bg-white print:min-h-0 print:h-auto font-sans">
      
      {/* Injected Print Stylesheet to eliminate blank pages */}
      <style>{`
        @media print {
          @page {
            size: A4 portrait;
            margin: 10mm 12mm;
          }
          html, body {
            background-color: #ffffff !important;
            color: #1c1917 !important;
            height: auto !important;
            min-height: auto !important;
            margin: 0 !important;
            padding: 0 !important;
            -webkit-print-color-adjust: exact !important;
            print-color-adjust: exact !important;
          }
          .print-avoid-break {
            break-inside: avoid !important;
            page-break-inside: avoid !important;
          }
        }
      `}</style>

      {/* Top action bar - Hidden during print */}
      <div className="max-w-4xl mx-auto mb-6 flex flex-wrap items-center justify-between gap-4 bg-stone-900 text-white p-4 rounded-2xl shadow-lg print:hidden">
        <div className="flex items-center gap-3">
          <Link
            to="/admin"
            className="p-2 bg-stone-800 hover:bg-stone-700 text-stone-300 hover:text-white rounded-xl transition-colors flex items-center gap-1.5 text-xs font-bold"
          >
            <ArrowLeft className="w-4 h-4" />
            <span>Voltar ao Painel Admin</span>
          </Link>
          <span className="text-sm font-semibold text-stone-300 hidden sm:inline">
            📄 Termo de Entrega e Manual Técnico do Sistema
          </span>
        </div>

        <button
          type="button"
          onClick={handlePrint}
          className="bg-orange-600 hover:bg-orange-500 active:scale-95 text-white font-bold text-sm px-5 py-2.5 rounded-xl shadow-md transition-all flex items-center gap-2 cursor-pointer"
        >
          <Printer className="w-4 h-4" />
          <span>Salvar em PDF / Imprimir</span>
        </button>
      </div>

      {/* Main printable sheet */}
      <div className="max-w-4xl mx-auto bg-white rounded-2xl shadow-sm border border-stone-200 p-8 sm:p-12 print:shadow-none print:border-none print:p-0 print:m-0 print:rounded-none">
        
        {/* Header */}
        <div className="border-b-2 border-stone-200 pb-5 mb-6 print-avoid-break">
          <div className="flex flex-wrap items-center justify-between gap-2 mb-2">
            <span className="inline-block bg-orange-600 text-white text-[11px] font-black uppercase tracking-wider px-3 py-1 rounded-md">
              Termo de Homologação, Escopo & Entrega Técnica
            </span>
            <span className="text-xs text-stone-400 font-semibold">
              Versão 2.4 - Build Atualizada
            </span>
          </div>
          
          <h1 className="text-2xl sm:text-3xl font-black text-stone-900 tracking-tight leading-tight">
            DOCUMENTAÇÃO OFICIAL DE ENTREGA DO SISTEMA
          </h1>
          <p className="text-stone-600 text-xs sm:text-sm mt-1 font-medium">
            Sistema Integrado de Autoatendimento (Totem), Cardápio Digital Web/PWA, KDS de Cozinha, Painel TV e Retaguarda Administrativa
          </p>

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 mt-4 bg-stone-50 p-4 rounded-xl border border-stone-200 text-xs">
            <div>
              <span className="text-stone-500 block">Estabelecimento / Contratante:</span>
              <strong className="text-stone-900 text-sm">BALBEC - REVENDA</strong>
            </div>
            <div>
              <span className="text-stone-500 block">Responsável pelo Desenvolvimento:</span>
              <strong className="text-stone-900 text-sm">Camilla Sites</strong>
            </div>
            <div>
              <span className="text-stone-500 block">Data de Conclusão e Entrega:</span>
              <strong className="text-stone-900">25 de Agosto de 2026</strong>
            </div>
            <div>
              <span className="text-stone-500 block">Status da Aplicação:</span>
              <strong className="text-emerald-700 font-bold flex items-center gap-1 mt-0.5">
                <CheckCircle2 className="w-4 h-4 inline text-emerald-600" />
                100% Operacional, Homologado e em Produção
              </strong>
            </div>
          </div>
        </div>

        {/* Section 1: Objective */}
        <div className="mb-6 print-avoid-break">
          <h2 className="text-sm font-black uppercase tracking-wider text-orange-600 border-b border-orange-200 pb-1 mb-2.5 flex items-center gap-2">
            <span>1.</span> OBJETIVO DO DOCUMENTO
          </h2>
          <p className="text-stone-700 text-xs sm:text-sm leading-relaxed text-justify">
            Este documento formaliza a entrega, manual de funcionalidades e homologação técnica de todo o ecossistema de software desenvolvido sob medida para a <strong>BALBEC - REVENDA</strong>. Tem como finalidade descrever pontualmente cada módulo da aplicação, detalhar exaustivamente todas as opções e configurações do painel administrativo, documentar os canais de venda e estabelecer os termos de garantia e suporte avulso.
          </p>
        </div>

        {/* Section 2: Architecture & Interfaces */}
        <div className="mb-6 print-avoid-break">
          <h2 className="text-sm font-black uppercase tracking-wider text-orange-600 border-b border-orange-200 pb-1 mb-3 flex items-center gap-2">
            <span>2.</span> ESTRUTURA GERAL DO ECOSSISTEMA ENTREGUE
          </h2>

          <div className="grid grid-cols-1 md:grid-cols-2 gap-3 text-xs text-stone-700">
            <div className="bg-stone-50 p-3 rounded-xl border border-stone-200">
              <h3 className="font-bold text-stone-900 text-sm flex items-center gap-1.5 mb-1 text-orange-700">
                <span>📱</span> 2.1. Cardápio Digital Web & PWA (Clientes)
              </h3>
              <p className="leading-relaxed">
                Interface responsiva e intuitiva para celular e computador. Permite aos clientes explorar produtos com fotos em alta definição, complementos/sabores, busca inteligente, carrinho dinâmico e realização de pedidos via <strong>Delivery</strong> ou consulta em <strong>Consumo na Loja</strong>. Possui suporte a instalação como aplicativo (PWA).
              </p>
            </div>

            <div className="bg-stone-50 p-3 rounded-xl border border-stone-200">
              <h3 className="font-bold text-stone-900 text-sm flex items-center gap-1.5 mb-1 text-orange-700">
                <span>🏬</span> 2.2. Totem de Autoatendimento (/totem)
              </h3>
              <p className="leading-relaxed">
                Modo Kiosk exclusivo em tela cheia voltado para tablets ou terminais touch. Modalidade travada estritamente em <strong>Retirada no Balcão</strong>, geração de senhas sequenciais diárias (ex: #01, #02), identificação por Nome/Telefone, impressão térmica automática e retorno instantâneo à tela inicial.
              </p>
            </div>

            <div className="bg-stone-50 p-3 rounded-xl border border-stone-200">
              <h3 className="font-bold text-stone-900 text-sm flex items-center gap-1.5 mb-1 text-orange-700">
                <span>📺</span> 2.3. Painel Smart TV & Chamada de Senhas (/tv)
              </h3>
              <p className="leading-relaxed">
                Exibição dinâmica para TV no salão com fila de pedidos em preparação e pedidos prontos para retirada. Conta com sinal sonoro agradável e sintetizador de voz (áudio) para anúncio do nome e senha do cliente, além de carrossel de fotos institucionais e vídeos promocionais nos momentos de intervalo.
              </p>
            </div>

            <div className="bg-stone-50 p-3 rounded-xl border border-stone-200">
              <h3 className="font-bold text-stone-900 text-sm flex items-center gap-1.5 mb-1 text-orange-700">
                <span>🖨️</span> 2.4. Motor de Impressão Térmica ESC/POS
              </h3>
              <p className="leading-relaxed">
                Formatação compacta e de alto contraste em 80mm e 58mm. Destaque em bloco sólido preto invertido do <strong>Nome do Cliente</strong> e <strong>Número da Senha</strong> para identificação imediata na expedição, com proteção de corte e prevenção de desperdício de papel contínuo.
              </p>
            </div>
          </div>
        </div>

        {/* Section 3: Detailed Admin Options */}
        <div className="mb-6">
          <h2 className="text-sm font-black uppercase tracking-wider text-orange-600 border-b border-orange-200 pb-1 mb-3 flex items-center gap-2">
            <span>3.</span> DETALHAMENTO COMPLETO DO MENU ADMINISTRATIVO (/admin)
          </h2>
          <p className="text-xs text-stone-600 mb-3">
            Abaixo estão descritas todas as abas e seções configuráveis do painel de retaguarda:
          </p>

          <div className="space-y-3 text-xs text-stone-700">
            
            {/* Aba 1 */}
            <div className="bg-stone-50 p-3.5 rounded-xl border border-stone-200 print-avoid-break">
              <h3 className="font-bold text-stone-900 text-sm flex items-center gap-2 mb-1.5 text-orange-800">
                <span className="p-1 bg-orange-100 text-orange-700 rounded-md">📊</span>
                <span>Aba 1: Visão Geral / Dashboard Analítico</span>
              </h3>
              <ul className="list-disc pl-5 space-y-0.5 text-stone-600 leading-relaxed">
                <li><strong>Receita Total:</strong> Totalizador financeiro em tempo real dos pedidos concluídos no período.</li>
                <li><strong>Volume de Pedidos:</strong> Contagem consolidada de pedidos finalizados com sucesso.</li>
                <li><strong>Ticket Médio:</strong> Cálculo automático da média de valor gasto por pedido.</li>
                <li><strong>Pedidos Pendentes:</strong> Indicador em destaque dos pedidos aguardando confirmação ou preparo.</li>
                <li><strong>Total de Produtos Ativos:</strong> Monitoramento do volume de itens disponíveis para venda.</li>
                <li><strong>Ranking de Mais Vendidos:</strong> Top 5 produtos com maior saída e faturamento no cardápio.</li>
              </ul>
            </div>

            {/* Aba 2 */}
            <div className="bg-stone-50 p-3.5 rounded-xl border border-stone-200 print-avoid-break">
              <h3 className="font-bold text-stone-900 text-sm flex items-center gap-2 mb-1.5 text-orange-800">
                <span className="p-1 bg-orange-100 text-orange-700 rounded-md">📋</span>
                <span>Aba 2: Gestão de Pedidos (KDS / Kanban de Cozinha)</span>
              </h3>
              <ul className="list-disc pl-5 space-y-0.5 text-stone-600 leading-relaxed">
                <li><strong>Filtros por Status:</strong> Visualização rápida por <em>Pendentes</em>, <em>Em Preparo</em>, <em>Prontos</em> e <em>Finalizados</em>.</li>
                <li><strong>Alerta Sonoro de Novo Pedido:</strong> Alarme contínuo em tempo real com botão de silenciar/confirmar.</li>
                <li><strong>Impressão de Cupom (2ª Via):</strong> Botão de reimpressão imediata de comprovante para cozinha ou cliente.</li>
                <li><strong>Transição de Status:</strong> Botões de avanço de etapa com atualização sincronizada no Firebase em tempo real.</li>
                <li><strong>Histórico & Cancelamento:</strong> Registro do motivo de cancelamento e exclusão de pedidos de teste.</li>
              </ul>
            </div>

            {/* Aba 3 */}
            <div className="bg-stone-50 p-3.5 rounded-xl border border-stone-200 print-avoid-break">
              <h3 className="font-bold text-stone-900 text-sm flex items-center gap-2 mb-1.5 text-orange-800">
                <span className="p-1 bg-orange-100 text-orange-700 rounded-md">🗂️</span>
                <span>Aba 3: Categorias de Produtos</span>
              </h3>
              <ul className="list-disc pl-5 space-y-0.5 text-stone-600 leading-relaxed">
                <li><strong>Cadastro e Edição:</strong> Criação de novas categorias com nome personalizado e ordem de exibição no menu.</li>
                <li><strong>Canais por Categoria:</strong> Controle se a categoria inteira deve aparecer no <em>Delivery</em>, <em>Loja/Mesa</em> e <em>Totem</em>.</li>
                <li><strong>Exclusão Segura:</strong> Verificação de produtos vinculados antes de permitir a exclusão de uma categoria.</li>
              </ul>
            </div>

            {/* Aba 4 */}
            <div className="bg-stone-50 p-3.5 rounded-xl border border-stone-200 print-avoid-break">
              <h3 className="font-bold text-stone-900 text-sm flex items-center gap-2 mb-1.5 text-orange-800">
                <span className="p-1 bg-orange-100 text-orange-700 rounded-md">🍔</span>
                <span>Aba 4: Gestão de Produtos</span>
              </h3>
              <ul className="list-disc pl-5 space-y-0.5 text-stone-600 leading-relaxed">
                <li><strong>Cadastro Completo:</strong> Nome, descrição detalhada, preço de venda, categoria e upload/URL de foto.</li>
                <li><strong>Transferência em Lote:</strong> Seleção múltipla de produtos para mover entre categorias com 1 clique.</li>
                <li><strong>Vínculo de Sabores/Adicionais:</strong> Associação com grupos de complementos (ex: ponto da carne, tipo de pão).</li>
                <li><strong>Ativação/Pausa Rápida:</strong> Toggle de disponibilidade imediata de produtos esgotados.</li>
              </ul>
            </div>

            {/* Aba 5 */}
            <div className="bg-stone-50 p-3.5 rounded-xl border border-stone-200 print-avoid-break">
              <h3 className="font-bold text-stone-900 text-sm flex items-center gap-2 mb-1.5 text-orange-800">
                <span className="p-1 bg-orange-100 text-orange-700 rounded-md">🧀</span>
                <span>Aba 5: Sabores e Complementos (Adicionais / Opcionais)</span>
              </h3>
              <ul className="list-disc pl-5 space-y-0.5 text-stone-600 leading-relaxed">
                <li><strong>Grupos de Opcionais:</strong> Configuração de adicionais pagos ou gratuitos com limites de escolha mínimo e máximo.</li>
                <li><strong>Precificação Individual:</strong> Definição de acréscimo de valor por complemento selecionado pelo cliente.</li>
              </ul>
            </div>

            {/* Aba 6 */}
            <div className="bg-stone-50 p-3.5 rounded-xl border border-stone-200 print-avoid-break">
              <h3 className="font-bold text-stone-900 text-sm flex items-center gap-2 mb-1.5 text-orange-800">
                <span className="p-1 bg-orange-100 text-orange-700 rounded-md">🕒</span>
                <span>Aba 6: Histórico de Atualizações / Logs de Sincronização</span>
              </h3>
              <ul className="list-disc pl-5 space-y-0.5 text-stone-600 leading-relaxed">
                <li><strong>Auditoria Completa:</strong> Registro detalhado de cada sincronização realizada (manual ou automática).</li>
                <li><strong>Métricas de Importação:</strong> Quantidade de produtos criados, atualizados, categorias criadas e itens ignorados.</li>
                <li><strong>Filtros por Status:</strong> Busca por data, tipo de execução e visualização da resposta de depuração.</li>
              </ul>
            </div>

            {/* Aba 7 */}
            <div className="bg-stone-50 p-3.5 rounded-xl border border-stone-200 print-avoid-break">
              <h3 className="font-bold text-stone-900 text-sm flex items-center gap-2 mb-1.5 text-orange-800">
                <span className="p-1 bg-orange-100 text-orange-700 rounded-md">🖥️</span>
                <span>Aba 7: Smart TV / Gestão de Mídia do Salão</span>
              </h3>
              <ul className="list-disc pl-5 space-y-0.5 text-stone-600 leading-relaxed">
                <li><strong>Controle de Chamada de Senhas:</strong> Configuração do som de alerta e voz sintetizada ao chamar pedidos.</li>
                <li><strong>Carrossel de Fotos:</strong> Upload e ordenação de banners de ofertas para exibição na TV do estabelecimento.</li>
                <li><strong>Vídeos Institucionais:</strong> Inclusão de vídeos MP4 para reprodução contínua em momentos sem chamadas.</li>
              </ul>
            </div>

            {/* Aba 8 */}
            <div className="bg-stone-50 p-3.5 rounded-xl border border-stone-200 print-avoid-break">
              <h3 className="font-bold text-stone-900 text-sm flex items-center gap-2 mb-1.5 text-orange-800">
                <span className="p-1 bg-orange-100 text-orange-700 rounded-md">⚙️</span>
                <span>Aba 8: Painel de Controle & Configurações da Loja (10 Seções)</span>
              </h3>
              <div className="space-y-1.5 mt-1.5">
                <div className="p-2 bg-white rounded-lg border border-stone-200">
                  <strong className="text-orange-700">1. Informações Gerais:</strong> Nome fantasia, Razão Social, CNPJ, WhatsApp de recebimento, endereço físico e logotipo.
                </div>
                <div className="p-2 bg-white rounded-lg border border-stone-200">
                  <strong className="text-orange-700">2. Notificações Push (NTFY):</strong> Tópico em nuvem para alertas sonoros e visuais nos celulares da equipe.
                </div>
                <div className="p-2 bg-white rounded-lg border border-stone-200">
                  <strong className="text-orange-700">3. Impressora Térmica:</strong> IP de rede (porta 9100 / ESC-POS), formato 80mm/58mm, cabeçalho e rodapé.
                </div>
                <div className="p-2 bg-white rounded-lg border border-stone-200">
                  <strong className="text-orange-700">4. Cores e Identidade:</strong> Paleta personalizada de cores do tema, botões de ação e títulos.
                </div>
                <div className="p-2 bg-white rounded-lg border border-stone-200">
                  <strong className="text-orange-700">5. Canais de Venda:</strong> Ativação/desativação de <em>Delivery</em>, <em>Consumo na Loja</em> e <em>Totem</em>.
                </div>
                <div className="p-2 bg-white rounded-lg border border-stone-200">
                  <strong className="text-orange-700">6. Modo de Manutenção:</strong> Bloqueio temporário com exibição de aviso institucional.
                </div>
                <div className="p-2 bg-white rounded-lg border border-stone-200">
                  <strong className="text-orange-700">7. Horário de Atendimento e Modo Visualização:</strong> Grade semanal de Segunda a Domingo com abertura e fechamento. Fora do horário, bloqueia novos pedidos automaticamente e mantém o cardápio em modo <em>"Apenas Visualização"</em>.
                </div>
                <div className="p-2 bg-white rounded-lg border border-stone-200">
                  <strong className="text-orange-700">8. Agente Virtual de IA (Balbec IA):</strong> Assistente para sugestão de combinações de produtos aos clientes.
                </div>
                <div className="p-2 bg-white rounded-lg border border-stone-200">
                  <strong className="text-orange-700">9. Integração BlueFocus ERP:</strong> Token de API, sincronização imediata e rotina programada às 08h, 14h e 18h.
                </div>
                <div className="p-2 bg-white rounded-lg border border-stone-200">
                  <strong className="text-orange-700">10. Banco de Dados & Nuvem:</strong> Persistência em tempo real via Google Firebase Firestore.
                </div>
              </div>
            </div>

            {/* Aba 9 */}
            <div className="bg-stone-50 p-3.5 rounded-xl border border-stone-200 print-avoid-break">
              <h3 className="font-bold text-stone-900 text-sm flex items-center gap-2 mb-1.5 text-orange-800">
                <span className="p-1 bg-orange-100 text-orange-700 rounded-md">👥</span>
                <span>Aba 9: Gestão de Usuários e Níveis de Acesso (RBAC)</span>
              </h3>
              <ul className="list-disc pl-5 space-y-0.5 text-stone-600 leading-relaxed">
                <li><strong>Perfil Master:</strong> Acesso irrestrito a configurações fiscais, usuários, integrações e orçamentos.</li>
                <li><strong>Perfil Administrador:</strong> Gestão de cardápio, relatórios, produtos, categorias e pedidos.</li>
                <li><strong>Perfil Caixa / Cozinha:</strong> Acesso restrito ao painel operacional KDS para recebimento e despacho de pedidos.</li>
              </ul>
            </div>

          </div>
        </div>

        {/* Section 4: Commercial Terms & Future Maintenance */}
        <div className="mb-6 print-avoid-break">
          <h2 className="text-sm font-black uppercase tracking-wider text-orange-600 border-b border-orange-200 pb-1 mb-2.5 flex items-center gap-2">
            <span>4.</span> TERMO DE ESCOPO, GARANTIA E MANUTENÇÕES FUTURAS
          </h2>
          <p className="text-stone-700 text-xs sm:text-sm leading-relaxed mb-3 text-justify">
            O software é entregue no modelo de <strong>desenvolvimento sob demanda em escopo fechado</strong>, 100% pronto para uso e sem a cobrança de contratos mensais ou mensalidades obrigatórias de licença de uso.
          </p>

          <div className="bg-amber-50 border-l-4 border-amber-600 p-3.5 rounded-r-xl space-y-2 text-xs text-amber-950">
            <p>
              <strong>1. Garantia de Funcionamento (30 Dias):</strong> Fica garantida a assistência gratuita para correção de quaisquer falhas técnicas (bugs) relativas às funcionalidades que compõem o escopo entregue, pelo período de 30 dias a partir da data deste termo.
            </p>
            <p>
              <strong>2. Alterações e Novas Funcionalidades (Cobrança Avulsa):</strong> Como não há cobrança de taxa de manutenção mensal recorrente, toda e qualquer modificação futura — como criação de novas telas, inclusão de novos relatórios, novos meios de pagamento, alterações de regras de negócio, suporte presencial ou suporte a novos modelos de hardware — será analisada, orçada e combinada à parte previamente.
            </p>
            <p>
              <strong>3. Infraestrutura e Serviços Externos:</strong> Custos relativos a servidores em nuvem, links de internet do estabelecimento, licenças do ERP BlueFocus ou substituição de equipamentos físicos (tablets, impressoras térmicas, cabos de rede, roteadores) permanecem sob responsabilidade exclusiva do contratante.
            </p>
          </div>
        </div>

        {/* Signatures */}
        <div className="mt-8 pt-6 border-t border-dashed border-stone-300 print-avoid-break">
          <p className="text-center text-xs text-stone-600 mb-6">
            As partes declaram ciência e pleno acordo com todas as funcionalidades entregues e as condições acima estabelecidas.
          </p>

          <p className="text-center text-xs text-stone-500 mb-10">
            Local e Data: __________________________, _____ de _________________ de 2026.
          </p>

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-10 sm:gap-6 text-center pt-2">
            <div>
              <div className="border-t border-stone-800 w-3/4 mx-auto pt-2">
                <strong className="text-sm text-stone-900 block">BALBEC - REVENDA</strong>
                <span className="text-xs text-stone-500">Contratante / Proprietário</span>
              </div>
            </div>

            <div>
              <div className="border-t border-stone-800 w-3/4 mx-auto pt-2">
                <strong className="text-sm text-stone-900 block">CAMILLA SITES</strong>
                <span className="text-xs text-stone-500">Responsável Técnico / Desenvolvimento</span>
              </div>
            </div>
          </div>
        </div>

      </div>
    </div>
  );
}
