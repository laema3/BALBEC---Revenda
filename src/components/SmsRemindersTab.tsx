import React, { useState, useEffect } from 'react';
import { MessageSquare, Send, RefreshCw, CheckCircle2, Phone, Calendar, User, BellRing } from 'lucide-react';

export const SmsRemindersTab: React.FC = () => {
  const [reminders, setReminders] = useState<any[]>([]);
  const [isLoading, setIsLoading] = useState(false);
  const [testPhone, setTestPhone] = useState('(34) 99999-9999');
  const [testName, setTestName] = useState('Cliente Exemplo');
  const [testOrderId, setTestOrderId] = useState('0001');
  const [isSendingTest, setIsSendingTest] = useState(false);
  const [testResult, setTestResult] = useState<string | null>(null);

  const fetchReminders = async () => {
    setIsLoading(true);
    try {
      const res = await fetch(`/api/db/sms-reminders?_t=${Date.now()}`);
      if (res.ok) {
        const data = await res.json();
        setReminders(Array.isArray(data) ? data : []);
      }
    } catch (err) {
      console.error('Erro ao buscar histórico de SMS:', err);
    } finally {
      setIsLoading(false);
    }
  };

  useEffect(() => {
    fetchReminders();
    const interval = setInterval(fetchReminders, 15000);
    return () => clearInterval(interval);
  }, []);

  const handleSendTestSms = async (e: React.FormEvent) => {
    e.preventDefault();
    if (isSendingTest) return;
    setIsSendingTest(true);
    setTestResult(null);

    try {
      const res = await fetch('/api/db/sms-reminders/test', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          phone: testPhone.trim(),
          name: testName.trim(),
          orderId: testOrderId.trim()
        })
      });
      const data = await res.json();
      if (res.ok && data.success) {
        setTestResult('Mensagem de teste disparada com sucesso!');
        await fetchReminders();
      } else {
        setTestResult('Erro ao disparar teste de SMS.');
      }
    } catch (err) {
      console.error('Erro ao testar SMS:', err);
      setTestResult('Erro de conexão ao enviar SMS.');
    } finally {
      setIsSendingTest(false);
    }
  };

  return (
    <div className="space-y-6">
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div>
          <h2 className="text-2xl font-black text-stone-900 flex items-center gap-2.5">
            <MessageSquare className="w-7 h-7 text-orange-600" />
            Automação de Lembretes SMS (3x ao Dia)
          </h2>
          <p className="text-xs text-stone-500 mt-1 max-w-2xl">
            O sistema dispara automaticamente 3 SMSs de 3 em 3 horas (Manhã ~09h, Almoço ~12h, Tarde ~15h) para os clientes a cada dia que antecede a retirada, inclusive no dia do agendamento.
          </p>
        </div>
        <button
          type="button"
          onClick={fetchReminders}
          disabled={isLoading}
          className="px-4 py-2.5 bg-stone-100 hover:bg-stone-200 text-stone-700 rounded-xl font-bold text-xs flex items-center gap-2 transition-all cursor-pointer w-fit"
        >
          <RefreshCw className={`w-4 h-4 ${isLoading ? 'animate-spin' : ''}`} />
          <span>Atualizar Histórico</span>
        </button>
      </div>

      {/* Caixa de Teste de Envio */}
      <div className="bg-gradient-to-br from-orange-50 to-amber-50 p-5 rounded-2xl border border-orange-200 shadow-xs">
        <h3 className="text-sm font-black text-stone-900 uppercase tracking-wider mb-3 flex items-center gap-2">
          <Send className="w-4 h-4 text-orange-600" />
          Disparar Teste Manual de SMS
        </h3>
        <form onSubmit={handleSendTestSms} className="grid grid-cols-1 sm:grid-cols-4 gap-3">
          <div>
            <label className="block text-[11px] font-bold text-stone-700 mb-1">Nome do Cliente</label>
            <input
              type="text"
              value={testName}
              onChange={(e) => setTestName(e.target.value)}
              required
              className="w-full p-2.5 bg-white border border-stone-300 rounded-xl text-xs text-stone-800"
              placeholder="Ex: Maria Silva"
            />
          </div>
          <div>
            <label className="block text-[11px] font-bold text-stone-700 mb-1">Telefone / WhatsApp</label>
            <input
              type="text"
              value={testPhone}
              onChange={(e) => setTestPhone(e.target.value)}
              required
              className="w-full p-2.5 bg-white border border-stone-300 rounded-xl text-xs text-stone-800 font-mono"
              placeholder="(34) 99999-9999"
            />
          </div>
          <div>
            <label className="block text-[11px] font-bold text-stone-700 mb-1">Nº do Pedido</label>
            <input
              type="text"
              value={testOrderId}
              onChange={(e) => setTestOrderId(e.target.value)}
              required
              className="w-full p-2.5 bg-white border border-stone-300 rounded-xl text-xs text-stone-800 font-mono"
              placeholder="0001"
            />
          </div>
          <div className="flex items-end">
            <button
              type="submit"
              disabled={isSendingTest}
              className="w-full py-2.5 px-4 bg-orange-600 hover:bg-orange-700 active:scale-98 text-white rounded-xl font-bold text-xs shadow-md shadow-orange-600/30 transition-all cursor-pointer flex items-center justify-center gap-2"
            >
              <Send className="w-3.5 h-3.5" />
              <span>{isSendingTest ? 'Enviando...' : 'Enviar SMS Teste'}</span>
            </button>
          </div>
        </form>
        {testResult && (
          <div className="mt-3 p-2.5 bg-emerald-100 text-emerald-800 rounded-xl text-xs font-bold flex items-center gap-2">
            <CheckCircle2 className="w-4 h-4 text-emerald-600" />
            <span>{testResult}</span>
          </div>
        )}
      </div>

      {/* Histórico de Lembretes Disparados */}
      <div className="bg-white rounded-2xl shadow-sm border border-stone-200 overflow-hidden">
        <div className="p-4 bg-stone-50 border-b border-stone-200 flex items-center justify-between">
          <h3 className="text-sm font-bold text-stone-800 flex items-center gap-2">
            <BellRing className="w-4 h-4 text-orange-600" />
            Log de Lembretes SMS Enviados ({reminders.length})
          </h3>
          <span className="text-xs text-stone-500 font-medium">
            Atualização automática a cada 15s
          </span>
        </div>

        {reminders.length === 0 ? (
          <div className="p-12 text-center text-stone-400">
            <MessageSquare className="w-12 h-12 mx-auto mb-3 opacity-30" />
            <p className="text-sm font-medium">Nenhum SMS disparado ainda.</p>
            <p className="text-xs text-stone-400 mt-1">
              Os lembretes automáticos aparecerão aqui conforme os pedidos agendados entrarem nas janelas horárias.
            </p>
          </div>
        ) : (
          <div className="divide-y divide-stone-100 overflow-x-auto">
            <table className="w-full text-left text-xs">
              <thead className="bg-stone-50/70 text-stone-500 uppercase font-mono text-[10px]">
                <tr>
                  <th className="p-3">Data / Hora Envio</th>
                  <th className="p-3">Cliente / Telefone</th>
                  <th className="p-3">Pedido</th>
                  <th className="p-3">Agendamento</th>
                  <th className="p-3">Janela / Slot</th>
                  <th className="p-3">Mensagem SMS Disparada</th>
                  <th className="p-3 text-center">Status</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-stone-100">
                {reminders.map((r: any) => (
                  <tr key={r.id} className="hover:bg-stone-50/80">
                    <td className="p-3 font-mono text-stone-600 whitespace-nowrap">
                      {new Date(r.sentAt || Date.now()).toLocaleString('pt-BR')}
                    </td>
                    <td className="p-3 font-medium text-stone-900">
                      <div className="flex flex-col">
                        <span className="flex items-center gap-1"><User className="w-3 h-3 text-stone-400" /> {r.customerName}</span>
                        <span className="text-[11px] text-stone-500 font-mono flex items-center gap-1 mt-0.5"><Phone className="w-3 h-3 text-stone-400" /> {r.customerPhone}</span>
                      </div>
                    </td>
                    <td className="p-3 font-mono font-bold text-orange-600 whitespace-nowrap">
                      #{String(r.orderId).slice(-4)}
                    </td>
                    <td className="p-3 text-stone-700 whitespace-nowrap">
                      <div className="flex items-center gap-1 font-medium">
                        <Calendar className="w-3.5 h-3.5 text-stone-400" />
                        <span>{r.scheduledDate} às {r.scheduledTime}</span>
                      </div>
                    </td>
                    <td className="p-3 whitespace-nowrap">
                      <span className="px-2 py-0.5 rounded-md bg-orange-100 text-orange-800 text-[10px] font-black uppercase">
                        {r.slot === 'slot_1_09h' ? 'Manhã (09h)' : r.slot === 'slot_2_12h' ? 'Almoço (12h)' : 'Tarde (15h)'}
                      </span>
                    </td>
                    <td className="p-3 text-stone-700 max-w-xs truncate" title={r.message}>
                      {r.message}
                    </td>
                    <td className="p-3 text-center whitespace-nowrap">
                      <span className="inline-flex items-center gap-1 px-2.5 py-1 rounded-full bg-emerald-100 text-emerald-800 font-bold text-[10px]">
                        <CheckCircle2 className="w-3 h-3 text-emerald-600" />
                        <span>Enviado</span>
                      </span>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  );
};
