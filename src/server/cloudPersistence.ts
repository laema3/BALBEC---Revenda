import { initializeApp, getApps } from 'firebase/app';
import { getFirestore, doc, getDoc, setDoc } from 'firebase/firestore';
import fs from 'fs';
import path from 'path';
import firebaseConfigJson from '../../firebase-applet-config.json';

const SYNC_KEY = 'balbec_server_sync_v1';
const COLLECTION_NAME = 'balbec_cloud_store';
const MAX_CHUNK_BYTES = 600_000; // Safe margin below Firestore 1MB limit

function loadFirebaseConfig() {
  const candidates = [
    path.join(process.cwd(), 'firebase-applet-config.json'),
    path.join(process.cwd(), '..', 'firebase-applet-config.json'),
  ];
  for (const p of candidates) {
    try {
      if (fs.existsSync(p)) {
        const parsed = JSON.parse(fs.readFileSync(p, 'utf8'));
        if (parsed && parsed.projectId && parsed.apiKey) {
          return parsed;
        }
      }
    } catch {}
  }
  return firebaseConfigJson;
}

let firestoreInstance: ReturnType<typeof getFirestore> | null = null;

export function getCloudFirestore() {
  if (firestoreInstance) return firestoreInstance;
  try {
    const config = loadFirebaseConfig();
    if (!config.apiKey) return null;
    const existingApps = getApps();
    const app = existingApps.length > 0 ? existingApps[0] : initializeApp(config, 'balbec-cloud-persistence');
    firestoreInstance = getFirestore(app, config.firestoreDatabaseId);
    return firestoreInstance;
  } catch (err: any) {
    console.warn('[CloudPersistence] Aviso ao inicializar Firestore:', err?.message || err);
    return null;
  }
}

export interface DeletedIdsRegistry {
  categories: Record<string, number>;
  products: Record<string, number>;
  orders: Record<string, number>;
  customers: Record<string, number>;
  users: Record<string, number>;
  tables: Record<string, number>;
  tvMedia: Record<string, number>;
  totemBackups: Record<string, number>;
  ordersClearedAt?: number;
  updatedAt: number;
}

export function createEmptyDeletedRegistry(): DeletedIdsRegistry {
  return {
    categories: {},
    products: {},
    orders: {},
    customers: {},
    users: {},
    tables: {},
    tvMedia: {},
    totemBackups: {},
    ordersClearedAt: 0,
    updatedAt: 0,
  };
}

export function mergeDeletedRegistries(
  a?: Partial<DeletedIdsRegistry> | null,
  b?: Partial<DeletedIdsRegistry> | null
): DeletedIdsRegistry {
  const result = createEmptyDeletedRegistry();
  const keys: Array<keyof Omit<DeletedIdsRegistry, 'ordersClearedAt' | 'updatedAt'>> = [
    'categories',
    'products',
    'orders',
    'customers',
    'users',
    'tables',
    'tvMedia',
    'totemBackups',
  ];

  for (const k of keys) {
    const mapA = (a && a[k] && typeof a[k] === 'object') ? a[k]! : {};
    const mapB = (b && b[k] && typeof b[k] === 'object') ? b[k]! : {};
    const merged: Record<string, number> = { ...mapA };
    for (const [id, ts] of Object.entries(mapB)) {
      merged[id] = Math.max(Number(merged[id] || 0), Number(ts || 0));
    }
    result[k] = merged;
  }

  result.ordersClearedAt = Math.max(Number(a?.ordersClearedAt || 0), Number(b?.ordersClearedAt || 0));
  result.updatedAt = Math.max(Number(a?.updatedAt || 0), Number(b?.updatedAt || 0), Date.now());
  return result;
}

/**
 * Salva um objeto único (ex: storeInfo ou deletedIds) no Cloud Firestore.
 */
export async function saveSingleToCloud(key: string, data: any): Promise<boolean> {
  const db = getCloudFirestore();
  if (!db || data === undefined || data === null) return false;
  try {
    let payloadJson = JSON.stringify(data);
    // Se exceder o limite seguro por conta de imagem base64 gigante, preserva versão leve na nuvem
    if (Buffer.byteLength(payloadJson, 'utf8') > MAX_CHUNK_BYTES && typeof data === 'object') {
      const copy = { ...data };
      if (copy.logoUrl && copy.logoUrl.startsWith('data:') && copy.logoUrl.length > 250_000) {
        delete copy.logoUrl;
      }
      payloadJson = JSON.stringify(copy);
    }
    const ref = doc(db, COLLECTION_NAME, `single_${key}`);
    await setDoc(ref, {
      syncKey: SYNC_KEY,
      updatedAt: Date.now(),
      payloadJson,
    });
    return true;
  } catch (err: any) {
    console.warn(`[CloudPersistence] Aviso ao salvar single_${key}:`, err?.message || err);
    return false;
  }
}

/**
 * Carrega um objeto único (ex: storeInfo ou deletedIds) do Cloud Firestore.
 */
export async function loadSingleFromCloud<T>(key: string, fallback: T): Promise<T> {
  const db = getCloudFirestore();
  if (!db) return fallback;
  try {
    const ref = doc(db, COLLECTION_NAME, `single_${key}`);
    const snap = await getDoc(ref);
    if (snap.exists()) {
      const d = snap.data();
      if (d && typeof d.payloadJson === 'string') {
        return JSON.parse(d.payloadJson) as T;
      }
    }
  } catch (err: any) {
    console.warn(`[CloudPersistence] Aviso ao carregar single_${key}:`, err?.message || err);
  }
  return fallback;
}

/**
 * Divide e salva uma coleção em chunks no Cloud Firestore para nunca exceder o limite de 1MB por documento.
 */
const activeSaveTimers: Record<string, NodeJS.Timeout> = {};

export function saveCollectionToCloudDebounced(collectionKey: string, items: any[], delayMs = 400): void {
  if (activeSaveTimers[collectionKey]) {
    clearTimeout(activeSaveTimers[collectionKey]);
  }
  activeSaveTimers[collectionKey] = setTimeout(() => {
    saveCollectionToCloud(collectionKey, items).catch(() => {});
  }, delayMs);
}

export async function saveCollectionToCloud(collectionKey: string, items: any[]): Promise<boolean> {
  const db = getCloudFirestore();
  if (!db || !Array.isArray(items)) return false;

  try {
    const chunks: any[][] = [];
    let currentChunk: any[] = [];
    let currentBytes = 2;

    for (const rawItem of items) {
      if (!rawItem || typeof rawItem !== 'object') continue;
      let itemToStore = rawItem;
      let serialized = JSON.stringify(itemToStore);
      let itemBytes = Buffer.byteLength(serialized, 'utf8');

      // Se um único item tiver uma imagem base64 gigante (>450KB), enxuga a imagem apenas no backup da nuvem se necessário
      if (itemBytes > 450_000) {
        itemToStore = { ...rawItem };
        if (itemToStore.imageUrl && String(itemToStore.imageUrl).startsWith('data:')) {
          itemToStore.imageUrl = '';
        }
        if (itemToStore.url && String(itemToStore.url).startsWith('data:')) {
          itemToStore.url = '';
        }
        serialized = JSON.stringify(itemToStore);
        itemBytes = Buffer.byteLength(serialized, 'utf8');
      }

      if (currentChunk.length > 0 && (currentBytes + itemBytes > MAX_CHUNK_BYTES || currentChunk.length >= 100)) {
        chunks.push(currentChunk);
        currentChunk = [];
        currentBytes = 2;
      }

      currentChunk.push(itemToStore);
      currentBytes += itemBytes + 1;
    }

    if (currentChunk.length > 0) {
      chunks.push(currentChunk);
    }

    const now = Date.now();
    // Grava cada chunk em paralelo
    await Promise.all(
      chunks.map((chunk, idx) => {
        const chunkRef = doc(db, COLLECTION_NAME, `${collectionKey}_chunk_${idx}`);
        return setDoc(chunkRef, {
          syncKey: SYNC_KEY,
          updatedAt: now,
          chunkIndex: idx,
          itemCount: chunk.length,
          payloadJson: JSON.stringify(chunk),
        });
      })
    );

    // Grava o metadado da coleção por último (commit atômico lógico)
    const metaRef = doc(db, COLLECTION_NAME, `${collectionKey}_meta`);
    await setDoc(metaRef, {
      syncKey: SYNC_KEY,
      updatedAt: now,
      chunkCount: chunks.length,
      totalItems: items.length,
    });

    return true;
  } catch (err: any) {
    console.warn(`[CloudPersistence] Aviso ao salvar coleção ${collectionKey}:`, err?.message || err);
    return false;
  }
}

/**
 * Carrega uma coleção completa do Cloud Firestore remontando todos os seus chunks.
 */
export async function loadCollectionFromCloud(collectionKey: string): Promise<{ items: any[]; updatedAt: number } | null> {
  const db = getCloudFirestore();
  if (!db) return null;

  try {
    const metaRef = doc(db, COLLECTION_NAME, `${collectionKey}_meta`);
    const metaSnap = await getDoc(metaRef);
    if (!metaSnap.exists()) {
      return null;
    }

    const meta = metaSnap.data();
    const chunkCount = Number(meta?.chunkCount || 0);
    const updatedAt = Number(meta?.updatedAt || 0);

    if (chunkCount <= 0) {
      return { items: [], updatedAt };
    }

    const chunkSnaps = await Promise.all(
      Array.from({ length: chunkCount }, (_, idx) =>
        getDoc(doc(db, COLLECTION_NAME, `${collectionKey}_chunk_${idx}`))
      )
    );

    const allItems: any[] = [];
    for (const snap of chunkSnaps) {
      if (snap.exists()) {
        const d = snap.data();
        if (d && typeof d.payloadJson === 'string') {
          try {
            const parsed = JSON.parse(d.payloadJson);
            if (Array.isArray(parsed)) {
              allItems.push(...parsed);
            }
          } catch {}
        }
      }
    }

    return { items: allItems, updatedAt };
  } catch (err: any) {
    console.warn(`[CloudPersistence] Aviso ao carregar coleção ${collectionKey}:`, err?.message || err);
    return null;
  }
}

/**
 * Faz o Smart Merge inteligente de múltiplas listas de uma coleção (Cloud Firestore, PostgreSQL, Disco, Seed),
 * respeitando os IDs excluídos (tombstones) e priorizando sempre a versão mais recente (updatedAt) ou mais completa de cada registro.
 */
export function smartMergeCollectionItems(
  collectionKey: keyof Omit<DeletedIdsRegistry, 'ordersClearedAt' | 'updatedAt'>,
  sources: any[][],
  deletedRegistry: DeletedIdsRegistry
): any[] {
  const deletedMap = deletedRegistry[collectionKey] || {};
  const ordersClearedAt = collectionKey === 'orders' ? Number(deletedRegistry.ordersClearedAt || 0) : 0;

  const mergedMap = new Map<string, any>();

  for (const list of sources) {
    if (!Array.isArray(list)) continue;
    for (const item of list) {
      if (!item || typeof item !== 'object') continue;
      const rawId = item.id ?? item.uid;
      if (rawId === undefined || rawId === null || String(rawId).trim() === '') continue;
      const id = String(rawId).trim();

      // Verifica se foi explicitamente excluído
      const deletedAt = Number(deletedMap[id] || 0);
      const itemUpdatedAt = Number(item.updatedAt || item.createdAt || 0);
      if (deletedAt > 0 && (itemUpdatedAt === 0 || itemUpdatedAt <= deletedAt)) {
        continue;
      }

      // Se a coleção for pedidos e houve limpeza geral, ignora pedidos anteriores à limpeza
      if (collectionKey === 'orders' && ordersClearedAt > 0) {
        const createdAt = Number(item.createdAt || 0);
        if (createdAt > 0 && createdAt <= ordersClearedAt) {
          continue;
        }
      }

      const existing = mergedMap.get(id);
      if (!existing) {
        mergedMap.set(id, { ...item });
      } else {
        const existingTs = Number(existing.updatedAt || existing.createdAt || 0);
        const incomingTs = Number(item.updatedAt || item.createdAt || 0);

        if (incomingTs > existingTs) {
          // O registro recebido é mais recente: mescla preservando campos importantes como imagem ou vínculos se não vierem nulos
          const merged = { ...existing, ...item };
          if (!merged.imageUrl && existing.imageUrl) merged.imageUrl = existing.imageUrl;
          if (merged.frozenCategoryId === undefined && existing.frozenCategoryId) {
            merged.frozenCategoryId = existing.frozenCategoryId;
          }
          if (merged.minFrozenQuantity === undefined && existing.minFrozenQuantity) {
            merged.minFrozenQuantity = existing.minFrozenQuantity;
          }
          if ((!merged.modality || merged.modality === 'pronto') && existing.modality === 'congelado' && !item.updatedAt) {
            merged.modality = existing.modality;
          }
          mergedMap.set(id, merged);
        } else {
          // O registro existente é mais recente ou igual: apenas preenche campos novos que possam existir no item recebido
          const merged = { ...item, ...existing };
          if (!merged.imageUrl && item.imageUrl) merged.imageUrl = item.imageUrl;
          if (!merged.frozenCategoryId && item.frozenCategoryId) {
            merged.frozenCategoryId = item.frozenCategoryId;
          }
          if (!merged.minFrozenQuantity && item.minFrozenQuantity) {
            merged.minFrozenQuantity = item.minFrozenQuantity;
          }
          if ((!merged.modality || merged.modality === 'pronto') && item.modality === 'congelado' && !existing.updatedAt) {
            merged.modality = item.modality;
          }
          mergedMap.set(id, merged);
        }
      }
    }
  }

  const finalArray = Array.from(mergedMap.values());
  if (collectionKey === 'categories' || collectionKey === 'tvMedia') {
    finalArray.sort((a, b) => (Number(a.order) || 0) - (Number(b.order) || 0));
  } else if (collectionKey === 'orders') {
    finalArray.sort((a, b) => (Number(b.createdAt) || 0) - (Number(a.createdAt) || 0));
  }
  return finalArray;
}
