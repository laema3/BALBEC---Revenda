import React, { useEffect, useState, useRef } from 'react';
import { onAuthStateChanged } from 'firebase/auth';
import { auth } from '../firebase';
import { useStore } from '../store/useStore';
import { BakeryLoader } from './BakeryLoader';

export function FirebaseProvider({ children }: { children: React.ReactNode }) {
  const { fetchData, fetchOrdersOnly, setIsOnline, isOnline } = useStore();
  const [isReady, setIsReady] = useState(true);
  const offlineTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const consecutiveFailuresRef = useRef<number>(0);

  useEffect(() => {
    console.log('FirebaseProvider mounted');

    fetchData().catch((err) => {
      console.error('Initial data fetch error:', err);
    });

    // Setup Server-Sent Events (SSE) for instant real-time sync across desktop & mobile
    let eventSource: EventSource | null = null;
    let sseTimeout: ReturnType<typeof setTimeout> | null = null;

    const connectSSE = () => {
      if (eventSource) {
        eventSource.close();
      }
      try {
        eventSource = new EventSource('/api/events');
        eventSource.onmessage = (event) => {
          try {
            const data = JSON.parse(event.data);
            if (data.type === 'sync') {
              consecutiveFailuresRef.current = 0;
              setIsOnline(true);
              
              if (data.target === 'orders') {
                fetchOrdersOnly().then(() => {
                  if (data.action === 'status_updated' && data.orderId) {
                    // Verificar se o pedido atualizado pertence ao usuário atual (pelo LocalStorage)
                    const savedPhone = localStorage.getItem('balbec_customer_phone');
                    const savedName = localStorage.getItem('balbec_customer_name');
                    const currentOrders = useStore.getState().orders;
                    const updatedOrder = currentOrders.find(o => String(o.id) === String(data.orderId));
                    
                    if (updatedOrder) {
                      const orderPhone = updatedOrder.customerPhone ? updatedOrder.customerPhone.replace(/\D/g, '') : '';
                      const userPhone = savedPhone ? savedPhone.replace(/\D/g, '') : '';
                      const isOwner = (userPhone && orderPhone === userPhone) || 
                                      (savedName && updatedOrder.customerName === savedName);

                      if (isOwner) {
                        const statusMap: Record<string, string> = {
                          'preparing': 'está sendo preparado agora!',
                          'ready': 'está pronto para retirada no balcão!',
                          'ready_for_pickup': 'está pronto! Pode vir buscar.',
                          'out_for_delivery': 'saiu para entrega!',
                          'completed': 'foi finalizado com sucesso. Obrigado!',
                          'cancelled': 'foi cancelado pelo estabelecimento.'
                        };
                        const statusMsg = statusMap[data.status] || 'teve uma atualização no status.';
                        
                        useStore.getState().setCurrentNotification({
                          id: `notif_${Date.now()}`,
                          title: `Pedido #${updatedOrder.id.slice(-4)}`,
                          message: `Olá ${updatedOrder.customerName}, seu pedido ${statusMsg}`,
                          type: data.status === 'cancelled' ? 'warning' : 'success'
                        });

                        // Play sound if possible
                        try {
                          const audio = new Audio('https://assets.mixkit.co/active_storage/sfx/2358/2358-preview.mp3');
                          audio.volume = 0.4;
                          audio.play().catch(() => {});
                        } catch {}
                      }
                    }
                  }
                }).catch(() => {});
              } else {
                fetchData().catch(() => {});
              }
            }
          } catch (e) {
            // ignore
          }
        };
        eventSource.onerror = () => {
          eventSource?.close();
          // Try reconnecting rapidly
          if (sseTimeout) clearTimeout(sseTimeout);
          sseTimeout = setTimeout(connectSSE, 2000);
        };
      } catch (e) {
        console.warn('SSE not supported or failed:', e);
      }
    };
    connectSSE();

    // Sincronização leve periódica (a cada 30 segundos) e via SSE em tempo real
    const ordersInterval = setInterval(() => {
      if (document.visibilityState === 'visible') {
        fetchOrdersOnly().catch(() => {});
      }
    }, 30000);

    const fullCatalogInterval = setInterval(() => {
      if (document.visibilityState === 'visible') {
        fetchData().catch(() => {});
      }
    }, 10 * 60 * 1000);

    const handleSyncTrigger = () => {
      if (navigator.onLine) {
        connectSSE();
      }
    };

    const handlePageShow = (e: PageTransitionEvent) => {
      if (e.persisted) {
        console.log('[PageShow] Restored from bfcache, refreshing data...');
        connectSSE();
        fetchData().catch(() => {});
        fetchOrdersOnly().catch(() => {});
      }
    };

    window.addEventListener('focus', handleSyncTrigger);
    document.addEventListener('visibilitychange', handleSyncTrigger);
    window.addEventListener('online', handleSyncTrigger);
    window.addEventListener('pageshow', handlePageShow);

    // Auth state listener
    const unsubAuth = onAuthStateChanged(auth, (user) => {
      console.log('Auth state changed:', user ? `User: ${user.email}` : 'No user');
      setIsOnline(true);
    });

    return () => {
      if (eventSource) eventSource.close();
      if (sseTimeout) clearTimeout(sseTimeout);
      if (offlineTimerRef.current) clearTimeout(offlineTimerRef.current);
      if (ordersInterval) clearInterval(ordersInterval);
      clearInterval(fullCatalogInterval);
      window.removeEventListener('focus', handleSyncTrigger);
      document.removeEventListener('visibilitychange', handleSyncTrigger);
      window.removeEventListener('online', handleSyncTrigger);
      window.removeEventListener('pageshow', handlePageShow);
      unsubAuth();
    };
  }, [fetchData, fetchOrdersOnly, setIsOnline]);

  if (!isReady) {
    return <BakeryLoader isLoading={true} />;
  }

  return <>{children}</>;
}
