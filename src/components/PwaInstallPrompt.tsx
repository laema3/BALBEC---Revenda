import { useState, useEffect, useCallback, useRef } from 'react';
import { Download, X, Share2, PlusSquare, Sparkles, Check, Smartphone, Monitor, Copy, ExternalLink, ArrowDown } from 'lucide-react';
import { useStore } from '../store/useStore';
import { useLocation } from 'react-router-dom';

const DECLINED_DAY_STORAGE_KEY = 'balbec_pwa_declined_day';
const DECLINED_DAY_COOKIE_KEY = 'balbec_pwa_declined_day';
const INSTALLED_V2_STORAGE_KEY = 'balbec_pwa_installed_v2';
const INSTALLED_V2_COOKIE_KEY = 'balbec_pwa_installed_v2';

function getLocalCalendarDayKey(date: Date = new Date()): string {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}

function getCookieValue(name: string): string | null {
  if (typeof document === 'undefined') return null;
  try {
    const cookies = document.cookie ? document.cookie.split('; ') : [];
    for (const cookie of cookies) {
      const eqIdx = cookie.indexOf('=');
      if (eqIdx === -1) continue;
      const key = decodeURIComponent(cookie.slice(0, eqIdx).trim());
      if (key === name) {
        return decodeURIComponent(cookie.slice(eqIdx + 1));
      }
    }
  } catch {}
  return null;
}

function setCookieValue(name: string, value: string, maxAgeSeconds: number): void {
  if (typeof document === 'undefined') return;
  try {
    document.cookie = `${encodeURIComponent(name)}=${encodeURIComponent(value)}; path=/; max-age=${maxAgeSeconds}; SameSite=Lax`;
  } catch {}
}

function clearLegacyPoisonedDismissalFlags(): void {
  if (typeof window === 'undefined') return;
  try {
    // Limpa a antiga chave de "Não perguntar mais" para não impedir o novo fluxo de download
    if (localStorage.getItem('pwa_prompt_dismissed_forever') === 'true') {
      localStorage.removeItem('pwa_prompt_dismissed_forever');
      localStorage.removeItem('pwa_app_installed');
      localStorage.removeItem('pwa_installed_permanent');
    }
  } catch {}
}

function hasPermanentInstallFlag(): boolean {
  if (typeof window === 'undefined') return false;
  clearLegacyPoisonedDismissalFlags();
  try {
    if ((window as any).__pwaInstalled === true) return true;
    if (localStorage.getItem(INSTALLED_V2_STORAGE_KEY) === 'true') return true;
  } catch {}
  if (getCookieValue(INSTALLED_V2_COOKIE_KEY) === 'true') return true;
  return false;
}

function persistPermanentInstallFlag(): void {
  if (typeof window === 'undefined') return;
  try {
    (window as any).__pwaInstalled = true;
    localStorage.setItem(INSTALLED_V2_STORAGE_KEY, 'true');
    localStorage.setItem('pwa_app_installed', 'true');
    localStorage.setItem('pwa_installed_permanent', 'true');
    localStorage.removeItem(DECLINED_DAY_STORAGE_KEY);
    localStorage.removeItem('pwa_install_declined_day');
  } catch {}
  // Persistir por ~10 anos para nunca mais exibir após o download
  setCookieValue(INSTALLED_V2_COOKIE_KEY, 'true', 60 * 60 * 24 * 365 * 10);
}

function wasDeclinedToday(): boolean {
  if (typeof window === 'undefined') return false;
  const today = getLocalCalendarDayKey();
  try {
    if (localStorage.getItem(DECLINED_DAY_STORAGE_KEY) === today) {
      return true;
    }
  } catch {}
  return getCookieValue(DECLINED_DAY_COOKIE_KEY) === today;
}

function markDeclinedToday(): void {
  if (typeof window === 'undefined') return;
  const today = getLocalCalendarDayKey();
  try {
    localStorage.setItem(DECLINED_DAY_STORAGE_KEY, today);
  } catch {}
  // Cookie de 48h garante consistência caso o navegador limpe storage temporário no mesmo dia
  setCookieValue(DECLINED_DAY_COOKIE_KEY, today, 60 * 60 * 48);
}

export function PwaInstallPrompt() {
  const { storeInfo, recordAppInstall } = useStore();
  const location = useLocation();
  const [deferredPrompt, setDeferredPrompt] = useState<any>(() => (typeof window !== 'undefined' ? (window as any).__deferredPrompt : null));
  const [isOpen, setIsOpen] = useState(false);
  const [isIOS, setIsIOS] = useState(false);
  const [isInAppBrowser, setIsInAppBrowser] = useState(false);
  const [isDesktop, setIsDesktop] = useState(false);
  const [showGuide, setShowGuide] = useState(false);
  const [isInstalled, setIsInstalled] = useState(() => hasPermanentInstallFlag());
  const [installSuccess, setInstallSuccess] = useState(false);
  const [copiedLink, setCopiedLink] = useState(false);
  const [isInstalling, setIsInstalling] = useState(false);
  const recordedInstallRef = useRef(false);
  const recordAppInstallRef = useRef(recordAppInstall);

  useEffect(() => {
    recordAppInstallRef.current = recordAppInstall;
  }, [recordAppInstall]);

  // Não exibir no modo TV Display nem no painel administrativo
  const isTvRoute = location.pathname.startsWith('/tv');
  const isAdminRoute = location.pathname.startsWith('/admin');
  const isSuppressedRoute = isTvRoute || isAdminRoute;

  const isTotemRoute = location.pathname.startsWith('/totem') || 
                       location.pathname.startsWith('/kiosk') || 
                       location.search.toLowerCase().includes('totem') ||
                       location.search.toLowerCase().includes('kiosk');

  const safeRecordAppInstall = useCallback(async () => {
    if (recordedInstallRef.current) return;
    recordedInstallRef.current = true;
    await recordAppInstallRef.current().catch(() => {});
  }, []);

  // Verificar de forma abrangente se o app já está rodando em modo standalone / instalado
  const checkStandalone = useCallback(() => {
    if (typeof window === 'undefined') return false;

    // 1. Modos de exibição standalone padrão do W3C (somente app instalado na tela inicial)
    const isStandaloneDisplay = 
      window.matchMedia('(display-mode: standalone)').matches ||
      window.matchMedia('(display-mode: fullscreen)').matches;

    // 2. iOS Safari standalone
    const isIosStandalone = (window.navigator as any).standalone === true;

    // 3. Android TWA / WebAPK / referrer
    const isAndroidApp = document.referrer.includes('android-app://');

    // 4. Parâmetros de inicialização via manifesto
    const search = window.location.search.toLowerCase();
    const isPwaSource = search.includes('source=pwa') || 
                        search.includes('source=totem_pwa') || 
                        search.includes('source=homescreen') ||
                        search.includes('source=app') ||
                        search.includes('mode=pwa');

    // 5. Flag permanente salva no localStorage / cookie / window após download real
    const isSavedInstalled = hasPermanentInstallFlag();

    if (isStandaloneDisplay || isIosStandalone || isAndroidApp || isPwaSource || isSavedInstalled) {
      persistPermanentInstallFlag();
      setIsInstalled(true);
      setIsOpen(false);
      setShowGuide(false);
      return true;
    }
    return false;
  }, []);

  useEffect(() => {
    let isCancelled = false;

    // Se já estiver instalado ou identificado como app instalado, abortar definitivamente
    if (checkStandalone()) {
      return;
    }

    // Verificação adicional para Chrome/Edge quando o PWA já foi instalado no dispositivo
    const navAny = window.navigator as any;
    if (typeof navAny?.getInstalledRelatedApps === 'function') {
      navAny.getInstalledRelatedApps()
        .then((apps: any[]) => {
          if (!isCancelled && Array.isArray(apps) && apps.length > 0) {
            persistPermanentInstallFlag();
            setIsInstalled(true);
            setIsOpen(false);
            setShowGuide(false);
          }
        })
        .catch(() => {});
    }

    // Detectar dispositivo e navegador
    const userAgent = (window.navigator.userAgent || '').toLowerCase();
    const isIosDevice = /iphone|ipad|ipod/.test(userAgent) || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);
    const inApp = /instagram|fban|fbav|whatsapp|line|micromessenger|threads|snapchat|tiktok|wv/i.test(userAgent);
    const isDesktopDevice = !/mobile|android|iphone|ipad|ipod|blackberry|opera mini|iemobile/i.test(userAgent);

    setIsIOS(isIosDevice);
    setIsInAppBrowser(inApp);
    setIsDesktop(isDesktopDevice);

    // Capturar se o prompt global já estava pronto
    if ((window as any).__deferredPrompt) {
      setDeferredPrompt((window as any).__deferredPrompt);
    }

    const handlePromptReady = (e: any) => {
      const promptObj = e.detail || (window as any).__deferredPrompt;
      if (promptObj) {
        setDeferredPrompt(promptObj);
      }
    };

    // Capturar evento de instalação nativo
    const handleBeforeInstallPrompt = (e: Event) => {
      e.preventDefault();
      (window as any).__deferredPrompt = e;
      setDeferredPrompt(e);
    };

    // Capturar evento de sucesso após instalação nativa
    const handleAppInstalled = () => {
      persistPermanentInstallFlag();
      safeRecordAppInstall();
      setIsInstalled(true);
      setIsOpen(false);
      setShowGuide(false);
      setDeferredPrompt(null);
      (window as any).__deferredPrompt = null;
      setInstallSuccess(true);
      setTimeout(() => setInstallSuccess(false), 5000);
    };

    window.addEventListener('beforeinstallprompt', handleBeforeInstallPrompt);
    window.addEventListener('pwa-deferred-prompt-ready', handlePromptReady);
    window.addEventListener('appinstalled', handleAppInstalled);
    window.addEventListener('pwa-app-installed', handleAppInstalled);

    // Sugerir a instalação automaticamente ao entrar no site (se não instalado e se não recusou hoje)
    const timer = setTimeout(() => {
      if (isCancelled) return;
      const alreadyInstalled = checkStandalone();
      if (!alreadyInstalled && !wasDeclinedToday() && !isSuppressedRoute) {
        setIsOpen(true);
      }
    }, 400);

    // Caso a aba fique aberta de um dia para o outro, reavaliar ao voltar para o site
    const handleVisibilityChange = () => {
      if (document.visibilityState !== 'visible') return;
      const alreadyInstalled = checkStandalone();
      if (!alreadyInstalled && !wasDeclinedToday() && !isSuppressedRoute) {
        setIsOpen(true);
      }
    };
    document.addEventListener('visibilitychange', handleVisibilityChange);

    return () => {
      isCancelled = true;
      clearTimeout(timer);
      window.removeEventListener('beforeinstallprompt', handleBeforeInstallPrompt);
      window.removeEventListener('pwa-deferred-prompt-ready', handlePromptReady);
      window.removeEventListener('appinstalled', handleAppInstalled);
      window.removeEventListener('pwa-app-installed', handleAppInstalled);
      document.removeEventListener('visibilitychange', handleVisibilityChange);
    };
  }, [isSuppressedRoute, checkStandalone, safeRecordAppInstall]);

  const handleInstallClick = async () => {
    setIsInstalling(true);
    const promptEvent = deferredPrompt || (window as any).__deferredPrompt;

    if (promptEvent && typeof promptEvent.prompt === 'function') {
      try {
        await promptEvent.prompt();
        const choiceResult = await promptEvent.userChoice;
        if (choiceResult && choiceResult.outcome === 'accepted') {
          persistPermanentInstallFlag();
          await safeRecordAppInstall();
          setIsInstalled(true);
          setIsOpen(false);
          setShowGuide(false);
          setInstallSuccess(true);
          setTimeout(() => setInstallSuccess(false), 5000);
          setDeferredPrompt(null);
          (window as any).__deferredPrompt = null;
          setIsInstalling(false);
          return;
        }
        // Se o usuário recusou o diálogo nativo do sistema, limpar referência usada
        setDeferredPrompt(null);
        (window as any).__deferredPrompt = null;
      } catch (err) {
        console.warn('Tentativa de acionar prompt de instalação:', err);
      }
    }

    setIsInstalling(false);
    // Se não houver prompt nativo direto ou em iOS/Navegadores embutidos, abrir o guia visual interativo passo a passo
    setShowGuide(true);
  };

  const handleCopyLink = () => {
    try {
      const url = window.location.origin + (isTotemRoute ? '/totem' : '/');
      navigator.clipboard.writeText(url);
      setCopiedLink(true);
      setTimeout(() => setCopiedLink(false), 3000);
    } catch {
      setCopiedLink(true);
      setTimeout(() => setCopiedLink(false), 3000);
    }
  };

  const handleManualConfirmed = async () => {
    persistPermanentInstallFlag();
    await safeRecordAppInstall();
    setIsInstalled(true);
    setIsOpen(false);
    setShowGuide(false);
    setInstallSuccess(true);
    setTimeout(() => setInstallSuccess(false), 5000);
  };

  // Opção "NÃO QUERO AGORA": oculta hoje e volta a sugerir apenas em um novo acesso em outro dia
  const handleNotNow = () => {
    markDeclinedToday();
    setIsOpen(false);
    setShowGuide(false);
  };

  // Em rotas administrativas/TV não exibimos nada
  if (isSuppressedRoute) {
    return null;
  }

  // Se o app já estiver baixado/instalado, exibe apenas o toast momentâneo de sucesso (se ativo) e remove definitivamente a opção da tela
  if (isInstalled) {
    if (!installSuccess) return null;
    return (
      <div className="fixed top-5 left-1/2 -translate-x-1/2 z-[9999] bg-emerald-700 text-white px-5 py-3 rounded-2xl shadow-2xl flex items-center gap-3 border border-emerald-500 animate-bounce print:hidden">
        <div className="w-8 h-8 rounded-full bg-white/20 flex items-center justify-center shrink-0">
          <Check className="w-5 h-5 text-white" />
        </div>
        <div>
          <p className="font-bold text-sm">Aplicativo Baixado com Sucesso!</p>
          <p className="text-xs text-emerald-100">Agora você pode acessar a BALBEC direto do seu celular.</p>
        </div>
      </div>
    );
  }

  const logoSrc = storeInfo.logoUrl || '/logo.svg';

  return (
    <>
      {/* Botão Flutuante Discreto para baixar quando quiser ainda no mesmo dia */}
      {!isOpen && !showGuide && (
        <button
          type="button"
          onClick={() => {
            setIsOpen(true);
            setShowGuide(false);
          }}
          className="fixed bottom-24 right-4 z-[60] bg-stone-900/95 hover:bg-stone-900 text-white text-xs font-bold py-2.5 px-4 rounded-full shadow-2xl border border-orange-500/50 flex items-center gap-2 backdrop-blur-md transition-all hover:scale-105 active:scale-95 print:hidden cursor-pointer"
          title="Baixar aplicativo no celular"
        >
          <div className="w-6 h-6 rounded-full bg-orange-600 flex items-center justify-center shrink-0">
            <Download className="w-3.5 h-3.5 text-white" />
          </div>
          <span>Baixar App</span>
        </button>
      )}

      {/* Modal Principal de Sugestão de Download do Aplicativo */}
      {isOpen && (
        <div className="fixed inset-0 z-[9990] flex items-end sm:items-center justify-center p-0 sm:p-4 bg-black/60 backdrop-blur-xs print:hidden">
          <div 
            className="bg-white w-full sm:max-w-md rounded-t-3xl sm:rounded-3xl shadow-2xl border border-stone-200 overflow-hidden transform transition-all duration-300 max-h-[92vh] flex flex-col"
            role="dialog"
            aria-modal="true"
            aria-label="Baixar aplicativo BALBEC"
          >
            {/* Faixa decorativa superior */}
            <div className={`p-4 text-white relative shrink-0 ${isTotemRoute ? 'bg-gradient-to-r from-stone-900 via-orange-950 to-stone-900 border-b border-orange-500/30' : 'bg-gradient-to-r from-[#78350f] via-[#b45309] to-[#78350f]'}`}>
              <button
                type="button"
                onClick={handleNotNow}
                className="absolute top-3 right-3 p-1.5 rounded-full bg-black/20 hover:bg-black/40 text-white/90 hover:text-white transition-colors cursor-pointer"
                aria-label="Não quero agora"
              >
                <X className="w-5 h-5" />
              </button>

              <div className="flex items-center gap-3 pr-8">
                <div className="w-14 h-14 rounded-2xl bg-white p-1 shadow-md border-2 border-amber-300 shrink-0 flex items-center justify-center overflow-hidden">
                  <img
                    src={logoSrc}
                    alt={storeInfo.name || 'BALBEC - REVENDA'}
                    className="w-full h-full object-contain"
                  />
                </div>
                <div>
                  <div className="flex items-center gap-1.5">
                    <span className={`text-[10px] uppercase tracking-wider font-extrabold px-2 py-0.5 rounded-full ${isTotemRoute ? 'bg-orange-500 text-white' : 'bg-amber-400 text-stone-950'}`}>
                      {isTotemRoute ? 'Totem / Tablet' : 'App Oficial'}
                    </span>
                    <Sparkles className="w-3.5 h-3.5 text-amber-300" />
                  </div>
                  <h3 className="font-black text-lg text-white leading-tight mt-0.5">
                    {isTotemRoute ? 'Baixar App do Totem' : 'Baixe o Aplicativo no Celular'}
                  </h3>
                  <p className="text-xs text-amber-100/90 font-medium">
                    {isTotemRoute ? 'Instale o atalho direto no modo Totem' : `${storeInfo.name || 'BALBEC - REVENDA'} direto na sua tela inicial`}
                  </p>
                </div>
              </div>
            </div>

            {/* Conteúdo e Benefícios */}
            <div className="p-5 sm:p-6 overflow-y-auto">
              {isInAppBrowser ? (
                /* Alerta especial quando o cliente abre no navegador interno do WhatsApp/Instagram */
                <div className="space-y-4">
                  <div className="p-4 bg-amber-50 rounded-2xl border border-amber-200 text-stone-800 text-xs space-y-2">
                    <div className="flex items-center gap-2 font-black text-amber-900 text-sm">
                      <ExternalLink className="w-4 h-4 text-amber-600" />
                      <span>Abra no seu Navegador Principal</span>
                    </div>
                    <p className="text-stone-600 leading-relaxed">
                      Você está acessando pelo navegador interno do <strong>WhatsApp/Instagram</strong>. Para baixar o aplicativo no seu celular:
                    </p>
                    <ol className="list-decimal list-inside space-y-1.5 text-stone-700 font-semibold pl-1">
                      <li>Toque nos <strong>3 pontinhos (⋮)</strong> no topo da tela</li>
                      <li>Selecione <strong>"Abrir no Chrome"</strong> ou <strong>"Abrir no Safari"</strong></li>
                      <li>No navegador, toque em <strong>Baixar Aplicativo</strong></li>
                    </ol>
                  </div>

                  <div className="flex flex-col gap-2.5">
                    <button
                      type="button"
                      onClick={handleCopyLink}
                      className="w-full py-3.5 bg-orange-600 hover:bg-orange-700 active:scale-[0.98] text-white rounded-2xl font-black text-sm flex items-center justify-center gap-2 shadow-lg shadow-orange-600/30 cursor-pointer"
                    >
                      <Copy className="w-4 h-4" />
                      <span>{copiedLink ? 'Link Copiado com Sucesso!' : 'Copiar Link para Chrome / Safari'}</span>
                    </button>

                    <button
                      type="button"
                      onClick={handleNotNow}
                      className="w-full py-3 px-4 bg-stone-100 hover:bg-stone-200 text-stone-700 rounded-2xl font-extrabold text-xs sm:text-sm tracking-wide transition-colors cursor-pointer"
                    >
                      NÃO QUERO AGORA
                    </button>

                    <div className="text-center pt-0.5">
                      <button
                        type="button"
                        onClick={handleManualConfirmed}
                        className="text-[11px] font-semibold text-stone-500 hover:text-emerald-700 underline cursor-pointer"
                      >
                        Já baixei o aplicativo
                      </button>
                    </div>
                  </div>
                </div>
              ) : !showGuide ? (
                <>
                  <div className="space-y-3 mb-6">
                    <div className="flex items-start gap-3">
                      <div className="w-7 h-7 rounded-xl bg-orange-100 text-orange-700 flex items-center justify-center shrink-0 mt-0.5 font-bold text-xs">
                        ⚡
                      </div>
                      <div>
                        <h4 className="text-xs font-bold text-stone-900">
                          {isTotemRoute ? 'Abertura Direta no Totem' : 'Acesso Instantâneo com 1 Toque'}
                        </h4>
                        <p className="text-[11px] text-stone-500">
                          {isTotemRoute ? 'Abre diretamente no autoatendimento sem barras de navegador.' : 'Abra o cardápio direto da tela inicial do seu celular com 1 toque.'}
                        </p>
                      </div>
                    </div>

                    <div className="flex items-start gap-3">
                      <div className="w-7 h-7 rounded-xl bg-orange-100 text-orange-700 flex items-center justify-center shrink-0 mt-0.5 font-bold text-xs">
                        📱
                      </div>
                      <div>
                        <h4 className="text-xs font-bold text-stone-900">
                          {isTotemRoute ? 'Modo Kiosk / Tela Cheia' : 'Pedidos e Acompanhamento Rápidos'}
                        </h4>
                        <p className="text-[11px] text-stone-500">
                          {isTotemRoute ? 'Oculta barras para uso contínuo e seguro na loja.' : 'Faça seus pedidos com agilidade e acompanhe tudo pelo celular.'}
                        </p>
                      </div>
                    </div>

                    <div className="flex items-start gap-3">
                      <div className="w-7 h-7 rounded-xl bg-orange-100 text-orange-700 flex items-center justify-center shrink-0 mt-0.5 font-bold text-xs">
                        🛡️
                      </div>
                      <div>
                        <h4 className="text-xs font-bold text-stone-900">
                          Ultraleve &amp; Não Ocupa Memória
                        </h4>
                        <p className="text-[11px] text-stone-500">
                          Baixe em segundos sem precisar ir na loja de aplicativos.
                        </p>
                      </div>
                    </div>
                  </div>

                  <div className="flex flex-col gap-2.5">
                    <button
                      type="button"
                      onClick={handleInstallClick}
                      disabled={isInstalling}
                      className="w-full py-3.5 px-4 bg-gradient-to-r from-orange-600 to-amber-600 hover:from-orange-700 hover:to-amber-700 active:scale-[0.98] text-white rounded-2xl font-black text-sm sm:text-base shadow-lg shadow-orange-600/30 transition-all flex items-center justify-center gap-2.5 cursor-pointer disabled:opacity-75"
                    >
                      <Download className="w-5 h-5" />
                      <span>
                        {isInstalling 
                          ? 'Preparando download...' 
                          : isTotemRoute 
                          ? 'BAIXAR APP DO TOTEM' 
                          : isIOS 
                          ? 'BAIXAR NO IPHONE / IPAD' 
                          : 'BAIXAR APLICATIVO'}
                      </span>
                    </button>

                    <button
                      type="button"
                      onClick={handleNotNow}
                      className="w-full py-3 px-4 bg-stone-100 hover:bg-stone-200 active:scale-[0.99] text-stone-700 rounded-2xl font-extrabold text-xs sm:text-sm tracking-wide transition-colors cursor-pointer"
                    >
                      NÃO QUERO AGORA
                    </button>

                    <div className="text-center pt-1">
                      <button
                        type="button"
                        onClick={handleManualConfirmed}
                        className="text-[11px] font-semibold text-stone-500 hover:text-emerald-700 underline cursor-pointer"
                      >
                        Já baixei o aplicativo (não mostrar mais)
                      </button>
                    </div>
                  </div>
                </>
              ) : (
                /* Passo a Passo Visual Conforme o Dispositivo */
                <div className="space-y-4">
                  <div className="text-center pb-1">
                    <h4 className="font-black text-stone-900 text-base">
                      {isIOS ? 'Como Baixar no iPhone / iPad' : isDesktop ? 'Como Baixar no Computador' : 'Como Baixar no Android'}
                    </h4>
                    <p className="text-xs text-stone-500 mt-0.5">
                      {isIOS ? 'No iPhone/iPad, siga os 3 toques no Safari:' : 'Siga os 2 passos rápidos no seu navegador:'}
                    </p>
                  </div>

                  {isIOS ? (
                    <div className="bg-stone-50 p-4 rounded-2xl border border-stone-200 space-y-3.5 text-xs text-stone-700 relative">
                      <div className="flex items-center gap-3">
                        <div className="w-9 h-9 rounded-xl bg-blue-600 text-white flex items-center justify-center shrink-0 shadow-sm font-bold">
                          <Share2 className="w-5 h-5" />
                        </div>
                        <div>
                          <strong className="text-stone-900">1. Toque em Compartilhar</strong>
                          <p className="text-stone-500 text-[11px]">No menu inferior do Safari (ícone do quadrado com a seta para cima).</p>
                        </div>
                      </div>

                      <div className="flex items-center gap-3">
                        <div className="w-9 h-9 rounded-xl bg-stone-900 text-white flex items-center justify-center shrink-0 shadow-sm">
                          <PlusSquare className="w-5 h-5" />
                        </div>
                        <div>
                          <strong className="text-stone-900">2. &quot;Adicionar à Tela de Início&quot;</strong>
                          <p className="text-stone-500 text-[11px]">Role as opções e toque em <strong>&quot;Adicionar à Tela de Início&quot;</strong>.</p>
                        </div>
                      </div>

                      <div className="flex items-center gap-3">
                        <div className="w-9 h-9 rounded-xl bg-emerald-600 text-white flex items-center justify-center shrink-0 font-black text-xs shadow-sm">
                          <Check className="w-5 h-5" />
                        </div>
                        <div>
                          <strong className="text-stone-900">3. Toque em &quot;Adicionar&quot;</strong>
                          <p className="text-stone-500 text-[11px]">No canto superior direito da tela do seu iPhone.</p>
                        </div>
                      </div>

                      <div className="pt-1 flex items-center justify-center text-blue-600 font-bold text-[11px] gap-1 animate-pulse">
                        <ArrowDown className="w-3.5 h-3.5" />
                        <span>O botão de compartilhar fica na barra inferior do Safari</span>
                      </div>
                    </div>
                  ) : isDesktop ? (
                    <div className="bg-stone-50 p-4 rounded-2xl border border-stone-200 space-y-3.5 text-xs text-stone-700">
                      <div className="flex items-center gap-3">
                        <div className="w-9 h-9 rounded-xl bg-orange-600 text-white flex items-center justify-center shrink-0 shadow-sm">
                          <Monitor className="w-5 h-5" />
                        </div>
                        <div>
                          <strong className="text-stone-900">1. Ícone na Barra de Endereços</strong>
                          <p className="text-stone-500 text-[11px]">Clique no ícone de instalação ao lado da estrela de favoritos.</p>
                        </div>
                      </div>

                      <div className="flex items-center gap-3">
                        <div className="w-9 h-9 rounded-xl bg-stone-800 text-white flex items-center justify-center shrink-0 shadow-sm">
                          <Download className="w-5 h-5" />
                        </div>
                        <div>
                          <strong className="text-stone-900">2. Clique em &quot;Instalar&quot;</strong>
                          <p className="text-stone-500 text-[11px]">Ou abra o menu do navegador (⋮) &gt; <strong>&quot;Instalar BALBEC&quot;</strong>.</p>
                        </div>
                      </div>
                    </div>
                  ) : (
                    <div className="bg-stone-50 p-4 rounded-2xl border border-stone-200 space-y-3.5 text-xs text-stone-700">
                      <div className="flex items-center gap-3">
                        <div className="w-9 h-9 rounded-xl bg-orange-600 text-white flex items-center justify-center shrink-0 shadow-sm font-black">
                          <Smartphone className="w-5 h-5" />
                        </div>
                        <div>
                          <strong className="text-stone-900">1. Abra o Menu do Navegador</strong>
                          <p className="text-stone-500 text-[11px]">Toque nos <strong>3 pontinhos (⋮)</strong> no canto superior direito do Chrome.</p>
                        </div>
                      </div>

                      <div className="flex items-center gap-3">
                        <div className="w-9 h-9 rounded-xl bg-stone-800 text-white flex items-center justify-center shrink-0 shadow-sm">
                          <PlusSquare className="w-5 h-5" />
                        </div>
                        <div>
                          <strong className="text-stone-900">2. &quot;Instalar aplicativo&quot;</strong>
                          <p className="text-stone-500 text-[11px]">Toque em <strong>&quot;Instalar aplicativo&quot;</strong> ou <strong>&quot;Adicionar à tela inicial&quot;</strong>.</p>
                        </div>
                      </div>
                    </div>
                  )}

                  <div className="flex flex-col gap-2 pt-2">
                    <button
                      type="button"
                      onClick={handleManualConfirmed}
                      className="w-full py-3.5 bg-emerald-600 hover:bg-emerald-700 text-white rounded-2xl font-bold text-xs flex items-center justify-center gap-2 transition-colors cursor-pointer shadow-md"
                    >
                      <Check className="w-4 h-4" />
                      <span>Concluir (Já baixei o aplicativo)</span>
                    </button>

                    <button
                      type="button"
                      onClick={handleNotNow}
                      className="w-full py-3 bg-stone-100 hover:bg-stone-200 text-stone-700 rounded-2xl text-xs font-extrabold tracking-wide transition-colors cursor-pointer"
                    >
                      NÃO QUERO AGORA
                    </button>
                  </div>
                </div>
              )}
            </div>
          </div>
        </div>
      )}
    </>
  );
}


