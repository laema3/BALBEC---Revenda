import React, { useEffect } from 'react';
import { useStore } from '../store/useStore';
import { MessageSquare, X, Bell } from 'lucide-react';

export const SmsNotification: React.FC = () => {
  const { currentNotification, setCurrentNotification } = useStore();

  useEffect(() => {
    if (currentNotification) {
      const timer = setTimeout(() => {
        setCurrentNotification(null);
      }, 8000);
      return () => clearTimeout(timer);
    }
  }, [currentNotification, setCurrentNotification]);

  if (!currentNotification) return null;

  return (
    <div className="fixed top-4 left-1/2 -translate-x-1/2 z-[200] w-[92%] max-w-md animate-in slide-in-from-top duration-300">
      <div className="bg-white/95 backdrop-blur-md rounded-2xl shadow-2xl border border-stone-200 p-4 flex items-start gap-4 ring-1 ring-black/5">
        <div className={`w-12 h-12 rounded-xl flex items-center justify-center shrink-0 shadow-sm ${
          currentNotification.type === 'success' ? 'bg-emerald-100 text-emerald-600' :
          currentNotification.type === 'warning' ? 'bg-amber-100 text-amber-600' :
          'bg-blue-100 text-blue-600'
        }`}>
          {currentNotification.type === 'success' ? <Bell className="w-6 h-6" /> : <MessageSquare className="w-6 h-6" />}
        </div>
        
        <div className="flex-1 min-w-0 pt-0.5">
          <h4 className="text-sm font-black text-stone-900 uppercase tracking-tight truncate">
            {currentNotification.title}
          </h4>
          <p className="text-sm text-stone-600 font-medium leading-relaxed mt-0.5">
            {currentNotification.message}
          </p>
          <div className="flex items-center gap-1.5 mt-2 text-[10px] font-bold text-stone-400 uppercase tracking-widest">
            <span className="w-1.5 h-1.5 rounded-full bg-blue-500 animate-pulse"></span>
            Agora mesmo • Mensagem do Sistema
          </div>
        </div>

        <button 
          onClick={() => setCurrentNotification(null)}
          className="p-1.5 hover:bg-stone-100 rounded-full text-stone-400 transition-colors cursor-pointer"
        >
          <X className="w-5 h-5" />
        </button>
      </div>
    </div>
  );
};
