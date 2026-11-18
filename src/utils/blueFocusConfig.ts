export interface BlueFocusIntegrationConfig {
  empresaId: string;
  usuarioId: string;
  pdvCodigo: string;
  pessoaId: string;
  syncUrl: string;
  orderUrl: string;
  tipoAtualizacao: string;
  tipo: string;
  dataInicial: string;
  startCargaNumero: string;
  startCargaSequencia: string;
  startProdutoId: string;
  authToken: string;
  batchSize: string;
  preserveManualPrices: boolean;
  autoExportMode: 'manual' | 'on_create' | 'on_complete';
  defaultClienteId: string;
  formaDinheiroId: string;
  formaPixId: string;
  formaDebitoId: string;
  formaCreditoId: string;
  autoSyncEnabled: boolean;
}

export const DEFAULT_BLUEFOCUS_INTEGRATION_CONFIG: BlueFocusIntegrationConfig = {
  empresaId: 'BALBEC',
  usuarioId: 'CONSULTA',
  pdvCodigo: '1000',
  pessoaId: '0',
  syncUrl: 'http://balbec.ddns.net:8082/valim/servlet/aintegracaofcxexportacadsat',
  orderUrl: 'http://balbec.ddns.net:8082/valim/servlet/aintegracaofcxregistravenda',
  tipoAtualizacao: 'A',
  tipo: '4',
  dataInicial: '30/12/1899',
  startCargaNumero: '0',
  startCargaSequencia: '0',
  startProdutoId: '0',
  authToken: '',
  batchSize: '4',
  preserveManualPrices: true,
  autoExportMode: 'manual',
  defaultClienteId: '100',
  formaDinheiroId: '1',
  formaPixId: '1',
  formaDebitoId: '1',
  formaCreditoId: '1',
  autoSyncEnabled: false,
};

export const BLUEFOCUS_LOCALSTORAGE_KEYS = [
  'bluefocus_empresa_id',
  'bluefocus_usuario_id',
  'bluefocus_pdv_codigo',
  'bluefocus_pessoa_id',
  'bluefocus_sync_url',
  'bluefocus_order_url',
  'bluefocus_tipo_atualizacao',
  'bluefocus_tipo',
  'bluefocus_data_inicial',
  'bluefocus_start_carga_numero',
  'bluefocus_start_carga_sequencia',
  'bluefocus_start_produto_id',
  'bluefocus_auth_token',
  'bluefocus_batch_size',
  'bluefocus_preserve_manual_prices',
  'bluefocus_auto_export_mode',
  'bluefocus_default_cliente_id',
  'bluefocus_forma_dinheiro_id',
  'bluefocus_forma_pix_id',
  'bluefocus_forma_debito_id',
  'bluefocus_forma_credito_id',
  'bluefocus_auto_sync',
] as const;

export function parseServerBlueFocusConfig(
  storeInfoOrRaw?: any
): Partial<BlueFocusIntegrationConfig> & { _fullSyncedAt?: number } {
  if (!storeInfoOrRaw) return {};
  try {
    const raw =
      typeof storeInfoOrRaw === 'string'
        ? storeInfoOrRaw
        : storeInfoOrRaw.blueFocusExportConfig;
    if (!raw) return {};
    const parsed = typeof raw === 'string' ? JSON.parse(raw) : raw;
    if (parsed && typeof parsed === 'object') {
      return parsed;
    }
  } catch {}
  return {};
}

export function hasLegacyLocalStorageBlueFocusConfig(): boolean {
  if (typeof localStorage === 'undefined') return false;
  try {
    return BLUEFOCUS_LOCALSTORAGE_KEYS.some((key) => {
      if (key === 'bluefocus_empresa_id') {
        const v = localStorage.getItem(key);
        return v !== null && v.trim() !== '' && v.trim() !== 'BALBEC';
      }
      const val = localStorage.getItem(key);
      return val !== null && val !== '';
    });
  } catch {
    return false;
  }
}

export function readBlueFocusConfigFromLocalStorage(): Partial<BlueFocusIntegrationConfig> {
  if (typeof localStorage === 'undefined') return {};
  try {
    const ls = localStorage;
    const rawAutoMode = ls.getItem('bluefocus_auto_export_mode');
    const autoExportMode =
      rawAutoMode === 'on_create' || rawAutoMode === 'on_complete'
        ? rawAutoMode
        : rawAutoMode === 'manual'
          ? 'manual'
          : undefined;
    const rawPreserve = ls.getItem('bluefocus_preserve_manual_prices');
    const rawAutoSync = ls.getItem('bluefocus_auto_sync');

    return {
      ...(ls.getItem('bluefocus_empresa_id') ? { empresaId: ls.getItem('bluefocus_empresa_id')! } : {}),
      ...(ls.getItem('bluefocus_usuario_id') ? { usuarioId: ls.getItem('bluefocus_usuario_id')! } : {}),
      ...(ls.getItem('bluefocus_pdv_codigo') ? { pdvCodigo: ls.getItem('bluefocus_pdv_codigo')! } : {}),
      ...(ls.getItem('bluefocus_pessoa_id') !== null ? { pessoaId: ls.getItem('bluefocus_pessoa_id')! } : {}),
      ...(ls.getItem('bluefocus_sync_url') ? { syncUrl: ls.getItem('bluefocus_sync_url')! } : {}),
      ...(ls.getItem('bluefocus_order_url') ? { orderUrl: ls.getItem('bluefocus_order_url')! } : {}),
      ...(ls.getItem('bluefocus_tipo_atualizacao') ? { tipoAtualizacao: ls.getItem('bluefocus_tipo_atualizacao')! } : {}),
      ...(ls.getItem('bluefocus_tipo') ? { tipo: ls.getItem('bluefocus_tipo')! } : {}),
      ...(ls.getItem('bluefocus_data_inicial') ? { dataInicial: ls.getItem('bluefocus_data_inicial')! } : {}),
      ...(ls.getItem('bluefocus_start_carga_numero') !== null ? { startCargaNumero: ls.getItem('bluefocus_start_carga_numero')! } : {}),
      ...(ls.getItem('bluefocus_start_carga_sequencia') !== null ? { startCargaSequencia: ls.getItem('bluefocus_start_carga_sequencia')! } : {}),
      ...(ls.getItem('bluefocus_start_produto_id') !== null ? { startProdutoId: ls.getItem('bluefocus_start_produto_id')! } : {}),
      ...(ls.getItem('bluefocus_auth_token') !== null ? { authToken: ls.getItem('bluefocus_auth_token')! } : {}),
      ...(ls.getItem('bluefocus_batch_size') ? { batchSize: ls.getItem('bluefocus_batch_size')! } : {}),
      ...(rawPreserve !== null ? { preserveManualPrices: rawPreserve !== 'false' } : {}),
      ...(autoExportMode ? { autoExportMode } : {}),
      ...(ls.getItem('bluefocus_default_cliente_id') ? { defaultClienteId: ls.getItem('bluefocus_default_cliente_id')! } : {}),
      ...(ls.getItem('bluefocus_forma_dinheiro_id') ? { formaDinheiroId: ls.getItem('bluefocus_forma_dinheiro_id')! } : {}),
      ...(ls.getItem('bluefocus_forma_pix_id') ? { formaPixId: ls.getItem('bluefocus_forma_pix_id')! } : {}),
      ...(ls.getItem('bluefocus_forma_debito_id') ? { formaDebitoId: ls.getItem('bluefocus_forma_debito_id')! } : {}),
      ...(ls.getItem('bluefocus_forma_credito_id') ? { formaCreditoId: ls.getItem('bluefocus_forma_credito_id')! } : {}),
      ...(rawAutoSync !== null ? { autoSyncEnabled: rawAutoSync === 'true' } : {}),
    };
  } catch {
    return {};
  }
}

export function normalizeFullBlueFocusConfig(
  partial: Partial<BlueFocusIntegrationConfig>
): BlueFocusIntegrationConfig {
  const d = DEFAULT_BLUEFOCUS_INTEGRATION_CONFIG;
  const rawMode = partial.autoExportMode;
  const autoExportMode: 'manual' | 'on_create' | 'on_complete' =
    rawMode === 'on_create' || rawMode === 'on_complete' ? rawMode : 'manual';

  return {
    empresaId: String(partial.empresaId || d.empresaId),
    usuarioId: String(partial.usuarioId || d.usuarioId),
    pdvCodigo: String(partial.pdvCodigo || d.pdvCodigo),
    pessoaId: partial.pessoaId !== undefined && partial.pessoaId !== null && String(partial.pessoaId) !== '' ? String(partial.pessoaId) : d.pessoaId,
    syncUrl: String(partial.syncUrl || d.syncUrl),
    orderUrl: String(partial.orderUrl || d.orderUrl),
    tipoAtualizacao: String(partial.tipoAtualizacao || d.tipoAtualizacao),
    tipo: String(partial.tipo || d.tipo),
    dataInicial: String(partial.dataInicial || d.dataInicial),
    startCargaNumero: partial.startCargaNumero !== undefined && partial.startCargaNumero !== null && String(partial.startCargaNumero) !== '' ? String(partial.startCargaNumero) : d.startCargaNumero,
    startCargaSequencia: partial.startCargaSequencia !== undefined && partial.startCargaSequencia !== null && String(partial.startCargaSequencia) !== '' ? String(partial.startCargaSequencia) : d.startCargaSequencia,
    startProdutoId: partial.startProdutoId !== undefined && partial.startProdutoId !== null && String(partial.startProdutoId) !== '' ? String(partial.startProdutoId) : d.startProdutoId,
    authToken: partial.authToken !== undefined && partial.authToken !== null ? String(partial.authToken) : d.authToken,
    batchSize: String(partial.batchSize || d.batchSize),
    preserveManualPrices: partial.preserveManualPrices !== undefined ? Boolean(partial.preserveManualPrices) : d.preserveManualPrices,
    autoExportMode,
    defaultClienteId: String(partial.defaultClienteId || d.defaultClienteId),
    formaDinheiroId: String(partial.formaDinheiroId || d.formaDinheiroId),
    formaPixId: String(partial.formaPixId || d.formaPixId),
    formaDebitoId: String(partial.formaDebitoId || d.formaDebitoId),
    formaCreditoId: String(partial.formaCreditoId || d.formaCreditoId),
    autoSyncEnabled: Boolean(partial.autoSyncEnabled),
  };
}

export function resolveFullBlueFocusConfig(storeInfo?: any): BlueFocusIntegrationConfig {
  const localCfg = readBlueFocusConfigFromLocalStorage();
  const serverCfg = parseServerBlueFocusConfig(storeInfo);
  // Servidor (PostgreSQL) tem prioridade sobre localStorage para qualquer campo já salvo no banco
  const cleanServerEntries = Object.fromEntries(
    Object.entries(serverCfg).filter(([key, val]) => key !== '_fullSyncedAt' && val !== undefined && val !== null)
  );
  return normalizeFullBlueFocusConfig({
    ...localCfg,
    ...cleanServerEntries,
  });
}

export function mirrorBlueFocusConfigToLocalStorage(cfg: Partial<BlueFocusIntegrationConfig>): void {
  if (typeof localStorage === 'undefined') return;
  try {
    if (cfg.empresaId !== undefined) localStorage.setItem('bluefocus_empresa_id', String(cfg.empresaId));
    if (cfg.usuarioId !== undefined) localStorage.setItem('bluefocus_usuario_id', String(cfg.usuarioId));
    if (cfg.pdvCodigo !== undefined) localStorage.setItem('bluefocus_pdv_codigo', String(cfg.pdvCodigo));
    if (cfg.pessoaId !== undefined) localStorage.setItem('bluefocus_pessoa_id', String(cfg.pessoaId));
    if (cfg.syncUrl !== undefined) localStorage.setItem('bluefocus_sync_url', String(cfg.syncUrl));
    if (cfg.orderUrl !== undefined) localStorage.setItem('bluefocus_order_url', String(cfg.orderUrl));
    if (cfg.tipoAtualizacao !== undefined) localStorage.setItem('bluefocus_tipo_atualizacao', String(cfg.tipoAtualizacao));
    if (cfg.tipo !== undefined) localStorage.setItem('bluefocus_tipo', String(cfg.tipo));
    if (cfg.dataInicial !== undefined) localStorage.setItem('bluefocus_data_inicial', String(cfg.dataInicial));
    if (cfg.startCargaNumero !== undefined) localStorage.setItem('bluefocus_start_carga_numero', String(cfg.startCargaNumero));
    if (cfg.startCargaSequencia !== undefined) localStorage.setItem('bluefocus_start_carga_sequencia', String(cfg.startCargaSequencia));
    if (cfg.startProdutoId !== undefined) localStorage.setItem('bluefocus_start_produto_id', String(cfg.startProdutoId));
    if (cfg.authToken !== undefined) localStorage.setItem('bluefocus_auth_token', String(cfg.authToken));
    if (cfg.batchSize !== undefined) localStorage.setItem('bluefocus_batch_size', String(cfg.batchSize));
    if (cfg.preserveManualPrices !== undefined) localStorage.setItem('bluefocus_preserve_manual_prices', String(Boolean(cfg.preserveManualPrices)));
    if (cfg.autoExportMode !== undefined) localStorage.setItem('bluefocus_auto_export_mode', String(cfg.autoExportMode));
    if (cfg.defaultClienteId !== undefined) localStorage.setItem('bluefocus_default_cliente_id', String(cfg.defaultClienteId));
    if (cfg.formaDinheiroId !== undefined) localStorage.setItem('bluefocus_forma_dinheiro_id', String(cfg.formaDinheiroId));
    if (cfg.formaPixId !== undefined) localStorage.setItem('bluefocus_forma_pix_id', String(cfg.formaPixId));
    if (cfg.formaDebitoId !== undefined) localStorage.setItem('bluefocus_forma_debito_id', String(cfg.formaDebitoId));
    if (cfg.formaCreditoId !== undefined) localStorage.setItem('bluefocus_forma_credito_id', String(cfg.formaCreditoId));
    if (cfg.autoSyncEnabled !== undefined) localStorage.setItem('bluefocus_auto_sync', String(Boolean(cfg.autoSyncEnabled)));
  } catch {}
}

export function serializeBlueFocusConfigForDb(
  cfg: Partial<BlueFocusIntegrationConfig>,
  autoSyncOverride?: boolean
): string {
  const normalized = normalizeFullBlueFocusConfig({
    ...cfg,
    ...(autoSyncOverride !== undefined ? { autoSyncEnabled: autoSyncOverride } : {}),
  });
  return JSON.stringify({
    ...normalized,
    _fullSyncedAt: Date.now(),
  });
}
