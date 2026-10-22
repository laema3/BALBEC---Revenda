import { drizzle } from 'drizzle-orm/node-postgres';
import { Pool } from 'pg';
import * as schema from './schema';

declare global {
  var _postgresPool: Pool | undefined;
}

export const getDatabaseUrl = (): string | undefined => {
  const rawUrl =
    process.env.DATABASE_URL ||
    process.env.SUPABASE_DB_URL ||
    process.env.SUPABASE_DATABASE_URL ||
    process.env.DIRECT_URL ||
    process.env.DATABASE_PUBLIC_URL ||
    process.env.DATABASE_PRIVATE_URL ||
    process.env.POSTGRES_URL ||
    process.env.POSTGRESQL_URL ||
    process.env.RAILWAY_DATABASE_URL ||
    process.env.PGDATABASE_URL ||
    process.env.POSTGRESQL_DATABASE_URL ||
    process.env.DATABASE_URL_UNPOOLED ||
    process.env.POSTGRES_PRISMA_URL ||
    process.env.POSTGRES_URL_NON_POOLING ||
    process.env.STORAGE_URL ||
    process.env.STORAGE_POSTGRES_URL ||
    process.env.BALBEC_URL ||
    process.env.BALBEC_POSTGRES_URL ||
    process.env.balbec;

  if (!rawUrl || !rawUrl.trim()) return undefined;

  // Clean pgbouncer=true or connection_limit params that may interfere with node-postgres (pg) on Supabase Supavisor
  try {
    const trimmed = rawUrl.trim();
    if (trimmed.includes('pgbouncer=') || trimmed.includes('connection_limit=')) {
      const urlObj = new URL(trimmed);
      urlObj.searchParams.delete('pgbouncer');
      urlObj.searchParams.delete('connection_limit');
      return urlObj.toString();
    }
    return trimmed;
  } catch {
    return rawUrl.trim();
  }
};

export const isDatabaseConfigured = (): boolean => {
  const dbUrl = getDatabaseUrl();
  if (dbUrl && dbUrl.trim() !== '') return true;
  if (process.env.PGHOST && process.env.PGHOST !== 'localhost') return true;
  if (process.env.SQL_HOST && process.env.SQL_HOST !== 'localhost' && process.env.SQL_HOST !== '127.0.0.1') return true;
  return false;
};

export const createPool = () => {
  if (!global._postgresPool) {
    const dbUrl = getDatabaseUrl();

    if (dbUrl) {
      const isUnixSocket = dbUrl.includes('/cloudsql') || dbUrl.includes('/app/cloudsql');
      const isLocal = dbUrl.includes('localhost') || dbUrl.includes('127.0.0.1');
      const useSSL = !isUnixSocket && !isLocal && !dbUrl.includes('sslmode=disable');

      const sslConfig = useSSL ? { rejectUnauthorized: false } : false;

      console.log(`[DB] Criando Pool PostgreSQL/Supabase (SSL: ${useSSL}, UnixSocket: ${isUnixSocket})`);
      global._postgresPool = new Pool({
        connectionString: dbUrl,
        max: 10,
        connectionTimeoutMillis: 15000,
        idleTimeoutMillis: 30000,
        keepAlive: true,
        ssl: sslConfig
      });
    } else if (process.env.PGHOST || (process.env.SQL_HOST && process.env.SQL_HOST !== 'localhost')) {
      const host = process.env.PGHOST || process.env.SQL_HOST;
      const user = process.env.PGUSER || process.env.SQL_USER;
      const password = process.env.PGPASSWORD || process.env.SQL_PASSWORD;
      const database = process.env.PGDATABASE || process.env.SQL_DB_NAME;
      const port = process.env.PGPORT ? parseInt(process.env.PGPORT) : (process.env.SQL_PORT ? parseInt(process.env.SQL_PORT) : 5432);

      const isUnixSocket = !!host && (host.startsWith('/') || host.startsWith('/app/cloudsql') || host.startsWith('/cloudsql'));
      const useSSL = !isUnixSocket && (process.env.SQL_SSL === 'true' || (!host?.includes('localhost') && !host?.includes('127.0.0.1')));
      const sslConfig = useSSL ? { rejectUnauthorized: false } : false;

      console.log(`[DB] Criando Pool PG para ${host} (User: ${user}, DB: ${database}, SSL: ${useSSL}, UnixSocket: ${isUnixSocket})`);
      global._postgresPool = new Pool({
        host,
        user,
        password,
        database,
        port,
        max: 10,
        connectionTimeoutMillis: 15000,
        idleTimeoutMillis: 30000,
        keepAlive: true,
        ssl: sslConfig
      });
    } else {
      // Local development dummy pool
      global._postgresPool = new Pool({
        host: 'localhost',
        user: 'postgres',
        password: '',
        database: 'balbecrevenda',
        port: 5432,
        max: 1,
        connectionTimeoutMillis: 500,
        idleTimeoutMillis: 500,
        ssl: false
      });
    }

    global._postgresPool.on('error', (err) => {
      console.warn('[DB Pool Notice] Conexão ociosa reciclada:', err?.message || err);
    });
  }
  return global._postgresPool;
};

export const pool = createPool();

export const db = drizzle(pool, { schema });

/**
 * Executa uma operação no banco de dados com auto-recuperação transparente em caso de socket fechado ou queda transitória.
 */
export async function withDbRetry<T>(fn: () => Promise<T>, retries = 3): Promise<T> {
  for (let attempt = 1; attempt <= retries; attempt++) {
    try {
      return await fn();
    } catch (err: any) {
      const msg = String(err?.message || err?.cause?.message || err?.cause || '');
      const isTransient =
        msg.includes('ECONNRESET') ||
        msg.includes('EPIPE') ||
        msg.includes('Connection terminated') ||
        msg.includes('socket closed') ||
        msg.includes('closed unexpectedly') ||
        msg.includes('terminating connection') ||
        msg.includes('connection reset') ||
        msg.includes('Client has encountered a connection error');
      if (isTransient && attempt < retries) {
        const delay = attempt * 400;
        console.warn(`[DB Retry] Tentativa ${attempt} encontrou socket transitório (${msg}), reconectando em ${delay}ms...`);
        await new Promise(r => setTimeout(r, delay));
        continue;
      }
      throw err;
    }
  }
  return await fn();
}

export async function testDatabaseConnection(): Promise<{ ok: boolean; host?: string; error?: string }> {
  if (!isDatabaseConfigured()) {
    return { ok: false, error: 'Variável de conexão (DATABASE_URL) não configurada.' };
  }
  try {
    const pingPromise = pool.query('SELECT 1 as ping');
    const timeoutPromise = new Promise((_, reject) => setTimeout(() => reject(new Error('Connection timeout (15s)')), 15000));
    const res: any = await Promise.race([pingPromise, timeoutPromise]);
    const dbUrl = getDatabaseUrl() || '';
    let host = 'PostgreSQL / Supabase';
    try {
      if (dbUrl.includes('@')) {
        host = dbUrl.split('@')[1].split('/')[0].split(':')[0];
      }
    } catch {}
    return { ok: Boolean(res && res.rows && res.rows.length > 0), host };
  } catch (err: any) {
    return { ok: false, error: err?.message || String(err) };
  }
}

export async function ensureTablesExist() {
  if (!isDatabaseConfigured()) {
    return;
  }

  let isConnected = false;
  for (let attempt = 1; attempt <= 3; attempt++) {
    try {
      const pingPromise = pool.query('SELECT 1 as ping');
      const timeoutPromise = new Promise((_, reject) => setTimeout(() => reject(new Error('PostgreSQL indisponível ou tempo limite atingido (15s)')), 15000));
      await Promise.race([pingPromise, timeoutPromise]);
      isConnected = true;
      break;
    } catch (pingErr: any) {
      if (attempt < 3) {
        console.warn(`[DB] Tentativa ${attempt} aguardando conexão com Supabase/PostgreSQL, tentando novamente em 1.5s...`);
        await new Promise(r => setTimeout(r, 1500));
      } else {
        console.warn('[DB] PostgreSQL não respondeu ao teste inicial, migrações ignoradas:', pingErr?.message || pingErr);
      }
    }
  }
  if (!isConnected) {
    return;
  }

  const runQuery = async (sql: string) => {
    try {
      await pool.query(sql);
    } catch (e: any) {
      console.warn('[DB Migration Warning]:', e?.message || e);
    }
  };

  // Executa a criação e atualização de todas as tabelas em bloco otimizado para inicialização rápida no Cloud Run + Supabase
  await runQuery(`
    CREATE TABLE IF NOT EXISTS users (
      id SERIAL PRIMARY KEY,
      uid TEXT NOT NULL UNIQUE,
      email TEXT NOT NULL,
      password TEXT,
      name TEXT,
      role TEXT DEFAULT 'operator',
      created_at TIMESTAMP DEFAULT NOW()
    );

    CREATE TABLE IF NOT EXISTS categories (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      "order" INTEGER DEFAULT 0,
      external_id TEXT,
      is_visible BOOLEAN DEFAULT TRUE,
      available_for_delivery BOOLEAN DEFAULT TRUE,
      available_in_store BOOLEAN DEFAULT TRUE,
      available_for_kiosk BOOLEAN DEFAULT TRUE
    );

    CREATE TABLE IF NOT EXISTS products (
      id TEXT PRIMARY KEY,
      category_id TEXT,
      name TEXT NOT NULL,
      description TEXT DEFAULT '',
      price DOUBLE PRECISION NOT NULL DEFAULT 0,
      image_url TEXT DEFAULT '',
      is_active BOOLEAN DEFAULT TRUE,
      is_addon BOOLEAN DEFAULT FALSE,
      is_flavor BOOLEAN DEFAULT FALSE,
      addon_ids JSONB DEFAULT '[]'::jsonb,
      max_addons INTEGER DEFAULT 0,
      flavor_ids JSONB DEFAULT '[]'::jsonb,
      external_id TEXT,
      available_for_delivery BOOLEAN DEFAULT TRUE,
      available_in_store BOOLEAN DEFAULT TRUE,
      available_for_kiosk BOOLEAN DEFAULT TRUE
    );

    CREATE TABLE IF NOT EXISTS customers (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      phone TEXT NOT NULL,
      email TEXT DEFAULT '',
      cpf TEXT DEFAULT '',
      password TEXT DEFAULT '123456',
      address TEXT DEFAULT '',
      street TEXT DEFAULT '',
      number TEXT DEFAULT '',
      complement TEXT DEFAULT '',
      neighborhood TEXT DEFAULT '',
      cep TEXT DEFAULT '',
      source TEXT DEFAULT 'cadastro_cardapio',
      total_orders INTEGER DEFAULT 0,
      total_spent DOUBLE PRECISION DEFAULT 0,
      last_order_at BIGINT,
      created_at BIGINT NOT NULL,
      tags TEXT DEFAULT '[]',
      notes TEXT DEFAULT '',
      default_address_id TEXT,
      status TEXT DEFAULT 'approved',
      min_order_value DOUBLE PRECISION DEFAULT 0
    );

    CREATE TABLE IF NOT EXISTS customer_addresses (
      id TEXT PRIMARY KEY,
      customer_id TEXT,
      alias TEXT DEFAULT 'Principal',
      street TEXT NOT NULL,
      number TEXT NOT NULL,
      complement TEXT,
      neighborhood TEXT NOT NULL,
      cep TEXT NOT NULL,
      reference TEXT,
      is_default BOOLEAN DEFAULT FALSE,
      created_at BIGINT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS orders (
      id TEXT PRIMARY KEY,
      items JSONB NOT NULL,
      total DOUBLE PRECISION NOT NULL DEFAULT 0,
      status TEXT NOT NULL DEFAULT 'pending',
      created_at BIGINT NOT NULL,
      type TEXT DEFAULT 'kiosk',
      payment_method TEXT DEFAULT '',
      customer_name TEXT DEFAULT '',
      customer_phone TEXT,
      customer_id TEXT,
      customer_email TEXT DEFAULT '',
      customer_cpf TEXT DEFAULT '',
      delivery_type TEXT,
      delivery_address TEXT,
      delivery_cep TEXT DEFAULT '',
      delivery_neighborhood TEXT DEFAULT '',
      delivery_fee DOUBLE PRECISION DEFAULT 0,
      table_number TEXT,
      table_id TEXT,
      driver_id TEXT,
      driver_name TEXT,
      delivery_status TEXT DEFAULT 'pending',
      delivery_accepted_at BIGINT,
      delivery_completed_at BIGINT,
      scheduled_time TEXT
    );

    CREATE TABLE IF NOT EXISTS delivery_zones (
      id TEXT PRIMARY KEY,
      neighborhood TEXT NOT NULL,
      cep_start TEXT NOT NULL DEFAULT '38000000',
      cep_end TEXT NOT NULL DEFAULT '38099999',
      fee DOUBLE PRECISION NOT NULL DEFAULT 5.00,
      is_active BOOLEAN DEFAULT TRUE,
      created_at BIGINT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS drivers (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      phone TEXT NOT NULL,
      vehicle TEXT DEFAULT 'Moto (Honda Fan - Placa XXX-0000)',
      pix_key TEXT DEFAULT '',
      status TEXT DEFAULT 'available',
      pin_code TEXT DEFAULT '1234',
      created_at BIGINT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS restaurant_tables (
      id TEXT PRIMARY KEY,
      number INTEGER NOT NULL,
      name TEXT NOT NULL,
      section TEXT DEFAULT 'Salão Principal',
      capacity INTEGER DEFAULT 4,
      status TEXT DEFAULT 'available',
      is_active BOOLEAN DEFAULT TRUE,
      created_at BIGINT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS store_info (
      id TEXT PRIMARY KEY DEFAULT 'default',
      name TEXT DEFAULT 'BALBEC - REVENDA',
      theme_color TEXT DEFAULT '#e6a800',
      add_button_color TEXT DEFAULT '#e6a800',
      icon_color TEXT DEFAULT '#e6a800',
      header_phrase TEXT DEFAULT 'Salgados Especiais e Revenda',
      logo_url TEXT DEFAULT '',
      address TEXT DEFAULT '',
      hours TEXT DEFAULT '',
      instagram TEXT DEFAULT '',
      whatsapp TEXT DEFAULT '',
      category_title_color TEXT DEFAULT '#e6a800',
      delivery_enabled BOOLEAN DEFAULT FALSE,
      delivery_schedule_enabled BOOLEAN DEFAULT FALSE,
      delivery_schedule_slots TEXT DEFAULT '["08:00","08:30","09:00","09:30","10:00","10:30","11:00","11:30","12:00","12:30","13:00","13:30","14:00","14:30","15:00","15:30","16:00","16:30","17:00","17:30","18:00","18:30","19:00","19:30"]',
      min_order_value DOUBLE PRECISION DEFAULT 0,
      in_store_enabled BOOLEAN DEFAULT TRUE,
      kiosk_enabled BOOLEAN DEFAULT FALSE,
      require_qr_code_for_ordering BOOLEAN DEFAULT FALSE,
      is_open BOOLEAN DEFAULT TRUE,
      ntfy_topic TEXT DEFAULT 'balbecrevenda_pedidos',
      ntfy_enabled BOOLEAN DEFAULT TRUE,
      tv_ticker_text TEXT DEFAULT '',
      tv_mode TEXT DEFAULT 'split_menu',
      tv_selected_categories TEXT DEFAULT '[]',
      tv_sound_enabled BOOLEAN DEFAULT FALSE,
      tv_show_clock BOOLEAN DEFAULT TRUE,
      tv_show_captions BOOLEAN DEFAULT FALSE,
      is_maintenance BOOLEAN DEFAULT FALSE,
      maintenance_message TEXT DEFAULT 'Estamos atualizando nosso cardápio e sistemas para melhor atendê-lo. Voltaremos em breve!',
      weekly_schedule TEXT DEFAULT '[]',
      auto_open_close BOOLEAN DEFAULT FALSE,
      force_open BOOLEAN DEFAULT FALSE,
      closed_message TEXT DEFAULT 'Estamos fechados no momento. Confira nossos horários de atendimento!',
      ai_agent_enabled BOOLEAN DEFAULT TRUE,
      ai_agent_name TEXT DEFAULT 'Balbec IA',
      ai_agent_tone TEXT DEFAULT 'amigavel',
      ai_agent_custom_prompt TEXT DEFAULT '',
      ai_agent_whatsapp_phone TEXT DEFAULT '',
      ai_agent_whatsapp_default_message TEXT DEFAULT 'Olá! Gostaria de fazer um pedido ou tirar uma dúvida.',
      ai_agent_training_examples TEXT DEFAULT '[]',
      ai_agent_knowledge_base TEXT DEFAULT '',
      ai_agent_forbidden_phrases TEXT DEFAULT '',
      ai_agent_creativity DOUBLE PRECISION DEFAULT 0.65,
      ai_agent_anti_repeat BOOLEAN DEFAULT TRUE,
      in_store_gps_validation BOOLEAN DEFAULT FALSE,
      in_store_latitude DOUBLE PRECISION DEFAULT -19.7478,
      in_store_longitude DOUBLE PRECISION DEFAULT -47.9392,
      in_store_max_radius_meters INTEGER DEFAULT 150,
      in_store_pin_validation BOOLEAN DEFAULT FALSE,
      in_store_pin_code TEXT DEFAULT '1234',
      preferred_printer_name TEXT DEFAULT 'EPSON TM-T20X (Rede 192.168.0.90)',
      printer_cut_mode TEXT DEFAULT 'partial',
      printer_copies INTEGER DEFAULT 2,
      totem_printer_cut_mode TEXT DEFAULT 'partial',
      totem_printer_copies INTEGER DEFAULT 2,
      totem_printer_bottom_space_cm DOUBLE PRECISION DEFAULT 2.5,
      windows_printer_cut_mode TEXT DEFAULT 'partial',
      windows_printer_copies INTEGER DEFAULT 2,
      windows_printer_bottom_space_cm DOUBLE PRECISION DEFAULT 8.0,
      configured_printers TEXT DEFAULT '[]',
      caixa_printer_name TEXT DEFAULT 'EPSON TM-T20X (Rede 192.168.0.90)',
      auto_print_orders_on_caixa BOOLEAN DEFAULT TRUE,
      printer_connection_type TEXT DEFAULT 'network',
      network_printer_ip TEXT DEFAULT '192.168.0.90',
      network_printer_port INTEGER DEFAULT 9100,
      mercado_pago_enabled BOOLEAN DEFAULT TRUE,
      mercado_pago_access_token TEXT DEFAULT '',
      mercado_pago_public_key TEXT DEFAULT '',
      mercado_pago_pix_key TEXT DEFAULT '3433383795',
      delivery_estimated_time_min INTEGER DEFAULT 35,
      delivery_estimated_time_max INTEGER DEFAULT 50,
      online_payment_enabled BOOLEAN DEFAULT FALSE,
      online_payment_operator TEXT DEFAULT 'mercadopago',
      online_payment_public_key TEXT DEFAULT '',
      online_payment_secret_key TEXT DEFAULT ''
    );

    CREATE TABLE IF NOT EXISTS tv_media (
      id TEXT PRIMARY KEY,
      title TEXT NOT NULL,
      type TEXT NOT NULL,
      url TEXT NOT NULL,
      duration_seconds INTEGER DEFAULT 15,
      "order" INTEGER DEFAULT 1,
      show_captions BOOLEAN DEFAULT FALSE,
      fit_mode TEXT DEFAULT 'fit',
      is_active BOOLEAN DEFAULT TRUE,
      created_at TIMESTAMP DEFAULT NOW()
    );

    CREATE TABLE IF NOT EXISTS app_installs (
      id TEXT PRIMARY KEY,
      platform TEXT DEFAULT 'unknown',
      browser TEXT DEFAULT 'unknown',
      device_type TEXT DEFAULT 'mobile',
      installed_at BIGINT NOT NULL,
      user_agent TEXT DEFAULT ''
    );

    CREATE TABLE IF NOT EXISTS totem_backups (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      created_at TEXT NOT NULL,
      active_categories_count INTEGER DEFAULT 0,
      active_products_count INTEGER DEFAULT 0,
      categories JSONB DEFAULT '[]'::jsonb,
      products JSONB DEFAULT '[]'::jsonb
    );
  `);

  // Garantir colunas incrementais caso o banco já existisse anteriormente
  await runQuery(`
    ALTER TABLE categories ADD COLUMN IF NOT EXISTS is_visible BOOLEAN DEFAULT TRUE;
    ALTER TABLE categories ADD COLUMN IF NOT EXISTS external_id TEXT;
    ALTER TABLE categories ADD COLUMN IF NOT EXISTS available_for_delivery BOOLEAN DEFAULT TRUE;
    ALTER TABLE categories ADD COLUMN IF NOT EXISTS available_in_store BOOLEAN DEFAULT TRUE;
    ALTER TABLE categories ADD COLUMN IF NOT EXISTS available_for_kiosk BOOLEAN DEFAULT TRUE;

    ALTER TABLE products ADD COLUMN IF NOT EXISTS available_for_delivery BOOLEAN DEFAULT TRUE;
    ALTER TABLE products ADD COLUMN IF NOT EXISTS available_in_store BOOLEAN DEFAULT TRUE;
    ALTER TABLE products ADD COLUMN IF NOT EXISTS available_for_kiosk BOOLEAN DEFAULT TRUE;
    ALTER TABLE products ADD COLUMN IF NOT EXISTS is_addon BOOLEAN DEFAULT FALSE;
    ALTER TABLE products ADD COLUMN IF NOT EXISTS is_flavor BOOLEAN DEFAULT FALSE;
    ALTER TABLE products ADD COLUMN IF NOT EXISTS addon_ids JSONB DEFAULT '[]'::jsonb;
    ALTER TABLE products ADD COLUMN IF NOT EXISTS max_addons INTEGER DEFAULT 0;
    ALTER TABLE products ADD COLUMN IF NOT EXISTS flavor_ids JSONB DEFAULT '[]'::jsonb;
    ALTER TABLE products ADD COLUMN IF NOT EXISTS external_id TEXT;

    ALTER TABLE orders ADD COLUMN IF NOT EXISTS customer_id TEXT;
    ALTER TABLE orders ADD COLUMN IF NOT EXISTS customer_email TEXT DEFAULT '';
    ALTER TABLE orders ADD COLUMN IF NOT EXISTS customer_cpf TEXT DEFAULT '';
    ALTER TABLE orders ADD COLUMN IF NOT EXISTS delivery_cep TEXT DEFAULT '';
    ALTER TABLE orders ADD COLUMN IF NOT EXISTS delivery_neighborhood TEXT DEFAULT '';
    ALTER TABLE orders ADD COLUMN IF NOT EXISTS delivery_fee DOUBLE PRECISION DEFAULT 0;
    ALTER TABLE orders ADD COLUMN IF NOT EXISTS driver_id TEXT;
    ALTER TABLE orders ADD COLUMN IF NOT EXISTS driver_name TEXT;
    ALTER TABLE orders ADD COLUMN IF NOT EXISTS delivery_status TEXT DEFAULT 'pending';
    ALTER TABLE orders ADD COLUMN IF NOT EXISTS delivery_accepted_at BIGINT;
    ALTER TABLE orders ADD COLUMN IF NOT EXISTS delivery_completed_at BIGINT;
    ALTER TABLE orders ADD COLUMN IF NOT EXISTS scheduled_time TEXT;

    ALTER TABLE customers ADD COLUMN IF NOT EXISTS email TEXT DEFAULT '';
    ALTER TABLE customers ADD COLUMN IF NOT EXISTS cpf TEXT DEFAULT '';
    ALTER TABLE customers ADD COLUMN IF NOT EXISTS password TEXT DEFAULT '123456';
    ALTER TABLE customers ADD COLUMN IF NOT EXISTS address TEXT DEFAULT '';
    ALTER TABLE customers ADD COLUMN IF NOT EXISTS street TEXT DEFAULT '';
    ALTER TABLE customers ADD COLUMN IF NOT EXISTS number TEXT DEFAULT '';
    ALTER TABLE customers ADD COLUMN IF NOT EXISTS complement TEXT DEFAULT '';
    ALTER TABLE customers ADD COLUMN IF NOT EXISTS neighborhood TEXT DEFAULT '';
    ALTER TABLE customers ADD COLUMN IF NOT EXISTS cep TEXT DEFAULT '';
    ALTER TABLE customers ADD COLUMN IF NOT EXISTS source TEXT DEFAULT 'cadastro_cardapio';
    ALTER TABLE customers ADD COLUMN IF NOT EXISTS total_orders INTEGER DEFAULT 0;
    ALTER TABLE customers ADD COLUMN IF NOT EXISTS total_spent DOUBLE PRECISION DEFAULT 0;
    ALTER TABLE customers ADD COLUMN IF NOT EXISTS last_order_at BIGINT;
    ALTER TABLE customers ADD COLUMN IF NOT EXISTS tags TEXT DEFAULT '[]';
    ALTER TABLE customers ADD COLUMN IF NOT EXISTS notes TEXT DEFAULT '';
    ALTER TABLE customers ADD COLUMN IF NOT EXISTS default_address_id TEXT;
    ALTER TABLE customers ADD COLUMN IF NOT EXISTS status TEXT DEFAULT 'approved';
    ALTER TABLE customers ADD COLUMN IF NOT EXISTS min_order_value DOUBLE PRECISION DEFAULT 0;

    ALTER TABLE store_info ADD COLUMN IF NOT EXISTS min_order_value DOUBLE PRECISION DEFAULT 0;
    ALTER TABLE store_info ADD COLUMN IF NOT EXISTS delivery_schedule_enabled BOOLEAN DEFAULT FALSE;
    ALTER TABLE store_info ADD COLUMN IF NOT EXISTS delivery_schedule_slots TEXT DEFAULT '["08:00","08:30","09:00","09:30","10:00","10:30","11:00","11:30","12:00","12:30","13:00","13:30","14:00","14:30","15:00","15:30","16:00","16:30","17:00","17:30","18:00","18:30","19:00","19:30"]';
    ALTER TABLE store_info ADD COLUMN IF NOT EXISTS online_payment_enabled BOOLEAN DEFAULT FALSE;
    ALTER TABLE store_info ADD COLUMN IF NOT EXISTS online_payment_operator TEXT DEFAULT 'mercadopago';
    ALTER TABLE store_info ADD COLUMN IF NOT EXISTS online_payment_public_key TEXT DEFAULT '';
    ALTER TABLE store_info ADD COLUMN IF NOT EXISTS online_payment_secret_key TEXT DEFAULT '';
    ALTER TABLE store_info ADD COLUMN IF NOT EXISTS mercado_pago_enabled BOOLEAN DEFAULT TRUE;
    ALTER TABLE store_info ADD COLUMN IF NOT EXISTS mercado_pago_access_token TEXT DEFAULT '';
    ALTER TABLE store_info ADD COLUMN IF NOT EXISTS mercado_pago_public_key TEXT DEFAULT '';
    ALTER TABLE store_info ADD COLUMN IF NOT EXISTS mercado_pago_pix_key TEXT DEFAULT '3433383795';
    ALTER TABLE store_info ADD COLUMN IF NOT EXISTS delivery_estimated_time_min INTEGER DEFAULT 35;
    ALTER TABLE store_info ADD COLUMN IF NOT EXISTS delivery_estimated_time_max INTEGER DEFAULT 50;
  `);
}
