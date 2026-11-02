import React, { useEffect, useRef } from 'react';
import { useStore } from '../store/useStore';
import { MessageSquare, X, Bell, CheckCircle2, Clock, ChefHat, Bike, AlertTriangle } from 'lucide-react';
import { formatAllDatesBR } from '../lib/utils';

export const SmsNotification: React.FC = () => {
  const { currentNotification, setCurrentNotification } = useStore();
  const playedNotifIdRef = useRef<string | null>(null);

  // Efeito sonoro e vibração ao receber nova notificação no smartphone
  useEffect(() => {
    if (currentNotification && currentNotification.id !== playedNotifIdRef.current) {
      playedNotifIdRef.current = currentNotification.id;

      // Vibração no smartphone (se suportado pelo navegador)
      try {
        if (typeof navigator !== 'undefined' && 'vibrate' in navigator) {
          navigator.vibrate([200, 100, 200]);
        }
      } catch {}

      // Alerta sonoro agradável e nítido
      try {
        const audio = new Audio('https://assets.mixkit.co/active_storage/sfx/2358/2358-preview.mp3');
        audio.volume = 0.5;
        audio.play().catch(() => {});
      } catch {}
    }
  }, [currentNotification]);

  // NÃO há auto-dismiss com setTimeout! A mensagem permanece fixa na tela do smartphone até o cliente fechar.
  if (!currentNotification) return null;

  const isSuccess = currentNotification.type === 'success';
  const isWarning = currentNotification.type === 'warning';

  return (
    <div className="fixed inset-0 z-[9999] flex items-center justify-center p-4 bg-stone-900/40 backdrop-blur-sm animate-in fade-in duration-200">
      <div 
        className="w-full max-w-md bg-white rounded-3xl shadow-2xl border-2 border-stone-200 overflow-hidden ring-1 ring-black/10 animate-in zoom-in-95 slide-in-from-bottom-4 duration-300"
        role="alertdialog"
        aria-modal="true"
      >
        {/* Barra superior de identificação */}
        <div className={`px-5 py-3 flex items-center justify-between text-xs font-black tracking-wider uppercase ${
          isSuccess ? 'bg-emerald-600 text-white' :
          isWarning ? 'bg-amber-600 text-white' :
          'bg-stone-900 text-white'
        }`}>
          <div className="flex items-center gap-2">
            <span className="w-2.5 h-2.5 rounded-full bg-white animate-ping"></span>
            <span>{currentNotification.badge || 'Aviso do Seu Pedido'}</span>
          </div>

          <button
            onClick={() => setCurrentNotification(null)}
            className="p-1 hover:bg-black/20 rounded-full transition-colors cursor-pointer text-white"
            title="Fechar Notificação"
            aria-label="Fechar Notificação"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Corpo da mensagem */}
        <div className="p-5 sm:p-6 space-y-4">
          <div className="flex items-start gap-4">
            <div className={`w-14 h-14 rounded-2xl flex items-center justify-center shrink-0 shadow-inner ${
              isSuccess ? 'bg-emerald-100 text-emerald-700' :
              isWarning ? 'bg-amber-100 text-amber-700' :
              'bg-blue-100 text-blue-700'
            }`}>
              {isSuccess ? (
                <CheckCircle2 className="w-8 h-8 animate-bounce" />
              ) : isWarning ? (
                <Clock className="w-8 h-8 animate-pulse" />
              ) : (
                <ChefHat className="w-8 h-8" />
              )}
            </div>

            <div className="flex-1 min-w-0">
              <h3 className="text-lg font-black text-stone-900 leading-tight">
                {formatAllDatesBR(currentNotification.title)}
              </h3>
              <p className="mt-2 text-stone-700 text-sm sm:text-base font-medium leading-relaxed">
                {formatAllDatesBR(currentNotification.message)}
              </p>
            </div>
          </div>

          <div className="pt-2 border-t border-stone-100 flex items-center justify-between text-xs text-stone-400">
            <span className="flex items-center gap-1.5 font-semibold text-stone-500">
              <span className="w-2 h-2 rounded-full bg-emerald-500"></span>
              Mensagem em tempo real da Loja
            </span>
            <span className="font-mono text-[11px] text-stone-400">
              Permanece até você fechar
            </span>
          </div>

          {/* Botão de confirmação/fechamento claro para smartphone */}
          <div className="pt-2">
            <button
              onClick={() => setCurrentNotification(null)}
              className={`w-full py-3.5 px-4 rounded-2xl font-black text-sm uppercase tracking-wider text-white shadow-lg transition-all active:scale-[0.98] cursor-pointer flex items-center justify-center gap-2 ${
                isSuccess ? 'bg-emerald-600 hover:bg-emerald-700 shadow-emerald-600/30' :
                isWarning ? 'bg-amber-600 hover:bg-amber-700 shadow-amber-600/30' :
                'bg-stone-900 hover:bg-stone-800 shadow-stone-900/30'
              }`}
            >
              <span>OK, Entendido / Fechar Janela</span>
            </button>
          </div>
        </div>
      </div>
    </div>
  );
};
