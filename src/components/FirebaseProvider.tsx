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
                    // Verificar se o pedido atualizado pertence ao smartphone do usuário atual
                    const savedPhone = localStorage.getItem('balbec_customer_phone');
                    const savedName = localStorage.getItem('balbec_customer_name');
                    const savedLastOrderId = localStorage.getItem('balbec_last_order_id');
                    const currentOrders = useStore.getState().orders;
                    const updatedOrder = currentOrders.find(o => String(o.id) === String(data.orderId));
                    
                    if (updatedOrder) {
                      const orderPhone = updatedOrder.customerPhone ? String(updatedOrder.customerPhone).replace(/\D/g, '') : '';
                      const userPhone = savedPhone ? String(savedPhone).replace(/\D/g, '') : '';
                      const isOwner = (savedLastOrderId && String(savedLastOrderId) === String(updatedOrder.id)) ||
                                      (userPhone && orderPhone && (orderPhone === userPhone || orderPhone.endsWith(userPhone) || userPhone.endsWith(orderPhone))) || 
                                      (savedName && updatedOrder.customerName && updatedOrder.customerName.trim().toLowerCase() === savedName.trim().toLowerCase());

                      if (isOwner) {
                        if (data.alertType === 'reminder_90min') {
                          useStore.getState().setCurrentNotification({
                            id: `notif_90min_${Date.now()}`,
                            title: `⏰ Atenção: Faltam 90 Minutos!`,
                            message: data.message || `Faltam menos de 90 minutos para a entrega/retirada do seu Pedido #${String(updatedOrder.id).slice(-4)} agendado para às ${updatedOrder.scheduledTime || '09:00'}. Nossa equipe já começou os preparativos!`,
                            type: 'warning',
                            orderId: updatedOrder.id,
                            badge: 'Aviso 90 Minutos'
                          });
                        } else {
                          const statusDetails: Record<string, { title: string; msg: string; type: 'success' | 'warning' | 'info'; badge: string }> = {
                            'pending': {
                              title: `Pedido #${String(updatedOrder.id).slice(-4)}`,
                              msg: `Olá ${updatedOrder.customerName || 'Cliente'}, seu pedido foi recebido e está na fila de atendimento!`,
                              type: 'info',
                              badge: 'Recebido'
                            },
                            'preparing': {
                              title: `👨‍🍳 Pedido em Preparo #${String(updatedOrder.id).slice(-4)}`,
                              msg: `Olá ${updatedOrder.customerName || 'Cliente'}, seu pedido já está sendo preparado com todo carinho na nossa cozinha!`,
                              type: 'info',
                              badge: 'Em Preparo'
                            },
                            'ready': {
                              title: `📦 Pedido Pronto #${String(updatedOrder.id).slice(-4)}`,
                              msg: `Olá ${updatedOrder.customerName || 'Cliente'}, seu pedido está pronto para retirada no balcão da loja!`,
                              type: 'success',
                              badge: 'Pronto no Balcão'
                            },
                            'ready_for_pickup': {
                              title: `🛍️ Pronto para Retirada #${String(updatedOrder.id).slice(-4)}`,
                              msg: `Olá ${updatedOrder.customerName || 'Cliente'}, seu pedido está embalado e disponível para retirada!`,
                              type: 'success',
                              badge: 'Pronto'
                            },
                            'ready_for_delivery': {
                              title: `📦 Pronto para Entrega #${String(updatedOrder.id).slice(-4)}`,
                              msg: `Olá ${updatedOrder.customerName || 'Cliente'}, seu pedido já foi embalado e aguarda saída do entregador!`,
                              type: 'info',
                              badge: 'Aguardando Motoboy'
                            },
                            'out_for_delivery': {
                              title: `🛵 Pedido a Caminho #${String(updatedOrder.id).slice(-4)}`,
                              msg: `Olá ${updatedOrder.customerName || 'Cliente'}, seu pedido acabou de sair para entrega com o entregador! Fique atento(a).`,
                              type: 'success',
                              badge: 'Saiu para Entrega'
                            },
                            'completed': {
                              title: `🎉 Pedido Finalizado #${String(updatedOrder.id).slice(-4)}`,
                              msg: `Olá ${updatedOrder.customerName || 'Cliente'}, seu pedido foi concluído com sucesso. Bom apetite e muito obrigado pela preferência!`,
                              type: 'success',
                              badge: 'Finalizado'
                            },
                            'cancelled': {
                              title: `⚠️ Pedido Cancelado #${String(updatedOrder.id).slice(-4)}`,
                              msg: `Olá ${updatedOrder.customerName || 'Cliente'}, seu pedido foi cancelado pelo estabelecimento. Entre em contato conosco para suporte.`,
                              type: 'warning',
                              badge: 'Cancelado'
                            }
                          };

                          const details = statusDetails[data.status] || {
                            title: `Pedido #${String(updatedOrder.id).slice(-4)}`,
                            msg: `Olá ${updatedOrder.customerName || 'Cliente'}, seu pedido teve uma atualização no status: ${data.status}.`,
                            type: 'info',
                            badge: 'Status Atualizado'
                          };

                          useStore.getState().setCurrentNotification({
                            id: `notif_${Date.now()}`,
                            title: details.title,
                            message: details.msg,
                            type: details.type,
                            orderId: updatedOrder.id,
                            badge: details.badge
                          });
                        }

                        // Vibração no smartphone
                        try {
                          if (typeof navigator !== 'undefined' && 'vibrate' in navigator) {
                            navigator.vibrate([250, 100, 250]);
                          }
                        } catch {}

                        // Alerta sonoro
                        try {
                          const audio = new Audio('https://assets.mixkit.co/active_storage/sfx/2358/2358-preview.mp3');
                          audio.volume = 0.5;
                          audio.play().catch(() => {});
                        } catch {}
                      }
                    }
                  }
                }).catch(() => {});
              } else if (data.target === 'sms_reminders') {
                if (data.action === 'reminder_alert' && data.orderId) {
                  const savedPhone = localStorage.getItem('balbec_customer_phone');
                  const savedName = localStorage.getItem('balbec_customer_name');
                  const savedLastOrderId = localStorage.getItem('balbec_last_order_id');
                  const orderPhone = data.customerPhone ? String(data.customerPhone).replace(/\D/g, '') : '';
                  const userPhone = savedPhone ? String(savedPhone).replace(/\D/g, '') : '';
                  const isOwner = (savedLastOrderId && String(savedLastOrderId) === String(data.orderId)) ||
                                  (userPhone && orderPhone && (orderPhone === userPhone || orderPhone.endsWith(userPhone) || userPhone.endsWith(orderPhone))) || 
                                  (savedName && data.customerName && String(data.customerName).trim().toLowerCase() === savedName.trim().toLowerCase());

                  if (isOwner) {
                    useStore.getState().setCurrentNotification({
                      id: `notif_reminder_${Date.now()}`,
                      title: `⏰ Lembrete do Pedido #${String(data.orderId).slice(-4)}`,
                      message: data.message || `Olá ${data.customerName || 'Cliente'}, temos um aviso sobre o seu pedido agendado!`,
                      type: 'info',
                      orderId: data.orderId,
                      badge: 'Lembrete Automático'
                    });

                    try {
                      if (typeof navigator !== 'undefined' && 'vibrate' in navigator) {
                        navigator.vibrate([250, 100, 250]);
                      }
                    } catch {}
                    try {
                      const audio = new Audio('https://assets.mixkit.co/active_storage/sfx/2358/2358-preview.mp3');
                      audio.volume = 0.5;
                      audio.play().catch(() => {});
                    } catch {}
                  }
                }
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
