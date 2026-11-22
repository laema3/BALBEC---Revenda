import { jsPDF } from 'jspdf';

export function buildBalbecDocumentationPdf(): jsPDF {
  const doc = new jsPDF({
    orientation: 'portrait',
    unit: 'mm',
    format: 'a4'
  });

  const pageWidth = doc.internal.pageSize.getWidth();
  const pageHeight = doc.internal.pageSize.getHeight();
  const margin = 14;
  const contentWidth = pageWidth - margin * 2;
  let currentY = margin;

  const checkPageBreak = (neededHeight: number) => {
    if (currentY + neededHeight > pageHeight - margin) {
      doc.addPage();
      currentY = margin;
      drawHeader();
    }
  };

  const drawHeader = () => {
    doc.setFillColor(234, 88, 12); // Orange #ea580c
    doc.rect(margin, currentY, contentWidth, 2, 'F');
    currentY += 6;
  };

  // --- CAPA / CABEÇALHO ---
  doc.setFillColor(30, 27, 25); // Stone 900
  doc.rect(margin, currentY, contentWidth, 26, 'F');

  doc.setTextColor(255, 255, 255);
  doc.setFont('helvetica', 'bold');
  doc.setFontSize(16);
  doc.text('BALBEC - REVENDA', margin + 6, currentY + 9);

  doc.setFontSize(9);
  doc.setFont('helvetica', 'normal');
  doc.setTextColor(253, 186, 116); // Orange 300
  doc.text('DOCUMENTAÇÃO TÉCNICA E MANUAL OPERACIONAL COMPLETO DO SISTEMA', margin + 6, currentY + 16);

  doc.setTextColor(200, 200, 200);
  doc.setFontSize(7.5);
  doc.text('Versão: 3.0.0 Production | Lançamento Oficial: Nov/2026 | Arquitetura: Web PWA / KDS / TV / ERP', margin + 6, currentY + 22);

  currentY += 32;

  // --- SUMÁRIO EXECUTIVO ---
  doc.setFillColor(245, 245, 244);
  doc.rect(margin, currentY, contentWidth, 22, 'F');
  doc.setTextColor(68, 64, 60);
  doc.setFont('helvetica', 'bold');
  doc.setFontSize(8.5);
  doc.text('SUMÁRIO EXECUTIVO DE MÓDULOS E FUNCIONALIDADES IMPLEMENTADAS:', margin + 4, currentY + 5);

  doc.setFont('helvetica', 'normal');
  doc.setFontSize(7.5);
  doc.text('1. Visão Geral da Plataforma | 2. Gestão de Venda por Lote vs. Unitária | 3. Regras de Preços & Conversão de Pacotes', margin + 4, currentY + 10);
  doc.text('4. Modalidades (Prontos vs. Congelados) | 5. Pagamentos, Alerta Pulsante & Confirmação de Retirada', margin + 4, currentY + 14);
  doc.text('6. Smart TV com Voz Sincronizada | 7. Segurança Master & Auditoria Crítica | 8. Acréscimos & Backups', margin + 4, currentY + 18);

  currentY += 28;

  const printSectionHeader = (numberStr: string, title: string) => {
    checkPageBreak(16);
    doc.setFillColor(234, 88, 12);
    doc.rect(margin, currentY, 6, 6, 'F');

    doc.setTextColor(255, 255, 255);
    doc.setFont('helvetica', 'bold');
    doc.setFontSize(8);
    doc.text(numberStr, margin + 1.8, currentY + 4.2);

    doc.setTextColor(28, 25, 23);
    doc.setFontSize(10.5);
    doc.setFont('helvetica', 'bold');
    doc.text(title, margin + 9, currentY + 4.8);

    currentY += 8;
    doc.setDrawColor(231, 229, 228);
    doc.setLineWidth(0.3);
    doc.line(margin, currentY, margin + contentWidth, currentY);
    currentY += 4;
  };

  const printParagraph = (text: string, isBold = false) => {
    doc.setFont('helvetica', isBold ? 'bold' : 'normal');
    doc.setFontSize(8.5);
    doc.setTextColor(50, 45, 40);
    const lines = doc.splitTextToSize(text, contentWidth);
    const needed = lines.length * 4.2;
    checkPageBreak(needed + 2);
    doc.text(lines, margin, currentY);
    currentY += needed + 2;
  };

  const printBullet = (label: string, desc: string) => {
    checkPageBreak(8);
    doc.setFont('helvetica', 'bold');
    doc.setFontSize(8.5);
    doc.setTextColor(28, 25, 23);
    doc.text('• ' + label + ': ', margin + 2, currentY);

    const labelWidth = doc.getTextWidth('• ' + label + ': ');
    doc.setFont('helvetica', 'normal');
    doc.setTextColor(68, 64, 60);
    const remainingWidth = contentWidth - labelWidth - 4;
    const lines = doc.splitTextToSize(desc, remainingWidth);
    
    if (lines.length > 0) {
      doc.text(lines[0], margin + 2 + labelWidth, currentY);
      currentY += 4.2;
      for (let i = 1; i < lines.length; i++) {
        checkPageBreak(4.2);
        doc.text(lines[i], margin + 6, currentY);
        currentY += 4.2;
      }
    } else {
      currentY += 4.2;
    }
  };

  // --- SEÇÃO 1 ---
  printSectionHeader('1', 'Visão Geral da Plataforma BALBEC - REVENDA');
  printParagraph('Desenvolvida sob medida para automação de salgaderias, revendas e consumo imediato, a plataforma integra vendas digitais (PWA), cozinha (KDS), painel de chamadas na TV e retaguarda administrativa.');
  printBullet('Cardápio Digital PWA', 'Interface web de alta performance para smartphones e desktops com navegação por categorias, fotos em alta resolução e cálculo automático de taxas.');
  printBullet('Painel Smart TV (/tv)', 'Exibição de senhas prontas, chamadas por voz sintetizada, letreiro de novidades e carrossel multimídia.');
  printBullet('Painel Administrativo (/admin)', 'Central de controle com KDS em tempo real, impressoras térmicas, relatórios e gestão de usuários.');
  currentY += 3;

  // --- SEÇÃO 2 ---
  printSectionHeader('2', 'Gestão de Categorias: Venda por Lote vs. Venda Unitária');
  printParagraph('O painel de controle administrativo agora permite definir o modo de venda de cada categoria de forma independente, oferecendo total flexibilidade ao lojista:');
  printBullet('Modo por Quantidade / Lote', 'Ideal para pacotes de salgados (ex: 20 ou 25 unidades). O sistema aplica a quantidade pré-definida no painel como padrão e multiplicador automático.');
  printBullet('Modo Unitário (1 por 1)', 'Permite a venda peça a peça (unidade livre), onde o cliente escolhe exatamente quantas unidades deseja levar sem travamento de lotes.');
  printBullet('Configuração Dinâmica no Painel', 'Em Admin > Categorias, ao selecionar o modo de venda por lote, um campo interativo surge para o lojista digitar a quantidade exata por pacote.');
  currentY += 3;

  // --- SEÇÃO 3 ---
  printSectionHeader('3', 'Regras de Preços & Conversão de Pacotes (BlueFocus ERP)');
  printParagraph('Integração inteligente com os códigos de cadastro da BlueFocus ERP para garantir precisão absoluta nos valores:');
  printBullet('Lotes de 25 Unidades (Códigos 1413–1418, 1425–1427)', 'O preço cadastrado (ex: R$ 24,50) já refere-se ao pacote fechado de 25 unidades. O sistema calcula proporcionalmente sem multiplicar incorretamente.');
  printBullet('Lotes de 20 Unidades (Códigos 1416, 1419–1424)', 'Mesma regra aplicada para pacotes de 20 unidades.');
  printBullet('Salgados Fritos, Assados e Congelados Unitários', 'Para produtos vendidos unitariamente mas com quantidade mínima por grupo (ex: Bolinho de bacalhau a R$ 4,60 com mínimo de 10 unidades), o sistema multiplica automaticamente o preço unitário pela quantidade mínima ao adicionar ao carrinho.');
  currentY += 3;

  // --- SEÇÃO 4 ---
  printSectionHeader('4', 'Modalidades: Salgados Prontos vs. Salgados Congelados');
  printParagraph('Bloqueio inteligente para evitar erros operacionais na linha de produção:');
  printBullet('Salgados Prontos (Consumo Imediato)', 'Fritos ou assados na hora. Não podem ser misturados com congelados no mesmo pedido.');
  printBullet('Salgados Congelados (Prazo até 48h)', 'Possuem taxa de congelamento (+R$ 0,30/un) e prazo de entrega estipulado. O carrinho avisa caso o cliente tente misturar com produtos prontos.');
  currentY += 3;

  // --- SEÇÃO 5 ---
  printSectionHeader('5', 'Pagamento Híbrido, Cobrança na Retirada & Alerta Pulsante');
  printParagraph('Mecanismos avançados para controle financeiro no caixa e balcão:');
  printBullet('Alerta Pulsante em Vermelho', 'Sempre que houver valores a serem recebidos na retirada (integral ou parcial 50%), a mensagem "COBRAR INTEGRAL / PARCIAL NA RETIRADA" pisca em destaque vermelho nos pedidos até o status mudar para "Entregue".');
  printBullet('Confirmação de Recebimento ao Entregar', 'Ao alterar o status do pedido para "Entregue" (se houver saldo pendente na retirada), o sistema abre um modal de confirmação obrigatória destacando o valor exato devido e perguntando se o operador já recebeu o pagamento.');
  printBullet('Isenção para Cartão Online Integral', 'Pedidos pagos 100% online via Pix ou Cartão ignoram automaticamente essa pergunta de recebimento presencial.');
  currentY += 3;

  // --- SEÇÃO 6 ---
  printSectionHeader('6', 'Smart TV com Voz Sincronizada & Ciclos de Chamada');
  printParagraph('Aprimoramento do sistema de chamadas para a televisão da loja:');
  printBullet('Abertura Otimizada', 'A frase inicial foi encurtada de "atenção, pedido pronto..." para um objetivo **"ATENÇÃO..."**, seguida pelo número do pedido.');
  printBullet('Ciclo de Anúncio Inteligente', 'Quando um pedido fica pronto, a voz o anuncia **3 vezes seguidas de 10 em 10 segundos**, com pausa respiratória de 5 segundos entre números.');
  printBullet('Repetição Contínua', 'Esse ciclo de 3 chamadas se repete a cada **6 minutos** ininterruptamente até que o status do pedido seja alterado para "Entregue".');
  currentY += 3;

  // --- SEÇÃO 7 ---
  printSectionHeader('7', 'Segurança Master, Reversão Protegida & Auditoria Crítica');
  printParagraph('Rigorous controle de segurança para proteger o caixa e o catálogo:');
  printBullet('Senha Master de Proteção (MASTERBALBEC)', 'Qualquer avanço ou retrocesso de status de pedidos exige autorização com senha Master quando configurado, evitando fraudes.');
  printBullet('Nova aba de Auditoria Crítica', 'Exclusiva para usuários *Admin* e *Master*. Registra automaticamente e exibe em tabela detalhada quem excluiu pedidos, quem confirmou recebimentos pendentes, e quem aprovou novos cadastros de usuários.');
  currentY += 3;

  // --- SEÇÃO 8 ---
  printSectionHeader('8', 'Acréscimos em Pedidos & Sistema de Backups');
  printBullet('Acréscimo de Itens', 'Clientes podem adicionar itens extras a pedidos em status "Pendente" antes do início do preparo na cozinha.');
  printBullet('Backups Automáticos & Restauração', 'Snapshots horários gravados no banco PostgreSQL e opção de exportação/importação em JSON.');
  currentY += 3;

  // --- SEÇÃO 9 ---
  printSectionHeader('9', 'Roteiro Operacional Diário para a Loja');
  printBullet('1. Abertura', 'Abra o Painel Admin (/admin) e verifique se o som de novos pedidos está ativo.');
  printBullet('2. Produção', 'Quando o alerta tocar, imprima a comanda e mude o status para "Preparando".');
  printBullet('3. Chamada na TV', 'Ao finalizar, mude para "Pronto" e clique em "Chamar TV" para anunciar o número.');
  printBullet('4. Conclusão', 'Confirme o recebimento do saldo devido (se houver) e mude para "Entregue".');

  // --- RODAPÉ ---
  const totalPages = doc.getNumberOfPages();
  for (let i = 1; i <= totalPages; i++) {
    doc.setPage(i);
    doc.setFont('helvetica', 'normal');
    doc.setFontSize(7.5);
    doc.setTextColor(150, 150, 150);
    doc.text(`BALBEC - REVENDA • Documentação Oficial para o Proprietário • Versão 3.0 • Página ${i} de ${totalPages}`, margin, pageHeight - 6);
  }

  return doc;
}
