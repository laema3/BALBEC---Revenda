import { db } from './src/db/index';
import { orders } from './src/db/schema';
import { desc } from 'drizzle-orm';

async function check() {
  console.log('--- DIAGNÓSTICO DE PEDIDOS NO BANCO DE DADOS ---');
  try {
    const list = await db.select().from(orders).orderBy(desc(orders.createdAt));
    console.log(`Total de pedidos encontrados no PostgreSQL: ${list.length}`);
    if (list.length > 0) {
      console.log('Últimos 3 pedidos:');
      list.slice(0, 3).forEach(o => {
        console.log(`- ID: ${o.id}, Cliente: ${o.customerName}, Total: R$ ${o.total}, Data: ${new Date(Number(o.createdAt)).toLocaleString()}`);
      });
    }
  } catch (err: any) {
    console.error('ERRO AO CONSULTAR BANCO:', err.message);
  }
  process.exit(0);
}

check();
