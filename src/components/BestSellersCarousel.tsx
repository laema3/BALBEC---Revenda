import { useState, useEffect, useRef } from 'react';
import { ChevronLeft, ChevronRight, Plus, Flame, Snowflake, ShoppingBag, ArrowRight, Check } from 'lucide-react';
import { Product, Category } from '../store/useStore';
import { ProductImage } from './ProductImage';
import { formatCurrency, formatCapitalized } from '../lib/utils';
import { isCategoryFrozenModality } from '../constants';

export interface BestSellerEntry {
  product: Product;
  category?: Category;
  soldCount: number;
  isFrozenCategory: boolean;
}

interface BestSellersCarouselProps {
  items: BestSellerEntry[];
  isFrozenOrderActive: boolean;
  canBuy: boolean;
  cartProductIds: Set<string>;
  queuedProductIds?: Set<string>;
  variant?: 'feed' | 'compact' | 'success';
  onSelectProduct: (entry: BestSellerEntry) => void;
  onFinishFrozenNow?: () => void;
  themeColor?: string;
}

export function BestSellersCarousel({
  items,
  isFrozenOrderActive,
  canBuy,
  cartProductIds,
  queuedProductIds,
  variant = 'feed',
  onSelectProduct,
  onFinishFrozenNow,
  themeColor = '#ea580c',
}: BestSellersCarouselProps) {
  const scrollContainerRef = useRef<HTMLDivElement | null>(null);
  const [isPaused, setIsPaused] = useState(false);

  if (!items || items.length === 0) return null;

  const isCompact = variant === 'compact' || variant === 'success';

  const scrollCarousel = (direction: 'left' | 'right') => {
    const el = scrollContainerRef.current;
    if (!el) return;
    const step = isCompact ? 220 : 320;
    el.scrollBy({
      left: direction === 'left' ? -step : step,
      behavior: 'smooth',
    });
  };

  useEffect(() => {
    if (!items || items.length === 0 || isPaused) return;
    const interval = setInterval(() => {
      const el = scrollContainerRef.current;
      if (!el) return;
      const step = isCompact ? 220 : 320;
      const maxScrollLeft = el.scrollWidth - el.clientWidth;
      if (el.scrollLeft >= maxScrollLeft - 10) {
        el.scrollTo({ left: 0, behavior: 'smooth' });
      } else {
        el.scrollBy({ left: step, behavior: 'smooth' });
      }
    }, 3000);
    return () => clearInterval(interval);
  }, [items, isCompact, isPaused]);

  return (
    <section
      aria-label="Produtos Mais Vendidos"
      onMouseEnter={() => setIsPaused(true)}
      onMouseLeave={() => setIsPaused(false)}
      className={
        variant === 'feed'
          ? 'mb-8 sm:mb-10 max-w-4xl lg:max-w-7xl mx-auto'
          : variant === 'success'
            ? 'mt-4 text-left'
            : 'mt-4 pt-4 border-t border-stone-200 text-left'
      }
    >
      {/* Header Row */}
      <div className="flex items-end justify-between gap-3 mb-3">
        <div className="min-w-0">
          <div className="flex items-center gap-2">
            <Flame className="w-4 h-4 text-orange-600 shrink-0" />
            <h2
              className={`font-black text-stone-900 tracking-tight ${
                isCompact ? 'text-sm sm:text-base' : 'text-base sm:text-xl'
              }`}
            >
              {variant === 'success'
                ? 'Faça Outro Pedido com os Mais Vendidos'
                : isFrozenOrderActive
                  ? 'Mais Vendidos para o Próximo Pedido'
                  : variant === 'compact'
                    ? 'Aproveite e Leve Também'
                    : 'Mais Vendidos'}
            </h2>
          </div>
          <p className="text-xs text-stone-600 font-medium mt-0.5 leading-snug">
            {variant === 'success'
              ? 'Toque em qualquer item abaixo para iniciar um novo pedido imediato.'
              : isFrozenOrderActive
                ? 'Você está comprando congelados (48h). Finalize este pedido e faça outro com estes sucessos de venda.'
                : 'Os campeões de pedidos para deixar seu carrinho ainda mais completo.'}
          </p>
        </div>

        <div className="hidden sm:flex items-center gap-1.5 shrink-0">
          <button
            type="button"
            onClick={() => scrollCarousel('left')}
            aria-label="Ver anteriores"
            className="w-9 h-9 rounded-xl border border-stone-200 bg-white hover:bg-stone-50 text-stone-700 flex items-center justify-center transition-colors cursor-pointer"
          >
            <ChevronLeft className="w-4 h-4" />
          </button>
          <button
            type="button"
            onClick={() => scrollCarousel('right')}
            aria-label="Ver próximos"
            className="w-9 h-9 rounded-xl border border-stone-200 bg-white hover:bg-stone-50 text-stone-700 flex items-center justify-center transition-colors cursor-pointer"
          >
            <ChevronRight className="w-4 h-4" />
          </button>
        </div>
      </div>

      {/* Aviso orientado à ação quando o cliente está em Pedido de Congelados */}
      {isFrozenOrderActive && variant !== 'success' && (
        <div className="mb-3 p-3 rounded-2xl bg-blue-50 border border-blue-200 flex flex-col sm:flex-row sm:items-center justify-between gap-2.5 text-left">
          <div className="flex items-start gap-2.5 min-w-0">
            <Snowflake className="w-4 h-4 text-blue-600 shrink-0 mt-0.5" />
            <p className="text-xs text-blue-950 font-medium leading-relaxed">
              Pedidos de congelados são fechados separadamente. <strong>Finalize esta compra de congelados</strong> e aproveite os itens abaixo em um <strong>novo pedido</strong>.
            </p>
          </div>
          {onFinishFrozenNow && cartProductIds.size > 0 && (
            <button
              type="button"
              onClick={onFinishFrozenNow}
              className="px-3.5 py-2 bg-blue-600 hover:bg-blue-700 text-white rounded-xl font-black text-xs whitespace-nowrap shrink-0 flex items-center justify-center gap-1.5 transition-colors cursor-pointer"
            >
              <ShoppingBag className="w-3.5 h-3.5" />
              <span>Finalizar Congelados</span>
              <ArrowRight className="w-3.5 h-3.5" />
            </button>
          )}
        </div>
      )}

      {/* Horizontal Carousel Track */}
      <div
        ref={scrollContainerRef}
        className="flex gap-3 overflow-x-auto no-scrollbar md:desktop-custom-scrollbar pb-2 snap-x snap-mandatory scroll-smooth"
      >
        {items.map((entry, idx) => {
          const { product, category, soldCount, isFrozenCategory } = entry;
          const isInCart = cartProductIds.has(product.id);
          const isQueued = Boolean(queuedProductIds?.has(product.id));
          const isLockedByFrozen = isFrozenOrderActive && !isFrozenCategory && variant !== 'success';
          const catLabel = category ? formatCapitalized(category.name) : '';
          const frozenCompatible = category ? isCategoryFrozenModality(category) : isFrozenCategory;

          return (
            <div
              key={`best_${variant}_${product.id}_${idx}`}
              onClick={() => {
                if (canBuy) onSelectProduct(entry);
              }}
              className={`snap-start shrink-0 bg-white rounded-2xl border transition-all flex flex-col justify-between overflow-hidden ${
                isCompact ? 'w-44 sm:w-48 p-2.5' : 'w-48 sm:w-56 p-3'
              } ${
                isQueued
                  ? 'border-orange-400 shadow-sm'
                  : 'border-stone-200 hover:border-stone-300 hover:shadow-md'
              } ${canBuy ? 'cursor-pointer' : ''}`}
            >
              <div>
                {/* Image container */}
                <div
                  className={`w-full rounded-xl overflow-hidden bg-stone-50 border border-stone-100 mb-2.5 relative ${
                    isCompact ? 'aspect-[4/3]' : 'aspect-[4/3]'
                  }`}
                >
                  <ProductImage
                    src={product.imageUrl}
                    alt={product.name}
                    className="w-full h-full object-cover transition-transform duration-300 hover:scale-105"
                  />
                </div>

                {/* Unboxed Metadata Line (Zero-Pill Rule) */}
                <div className="text-[11px] font-bold text-stone-500 flex items-center gap-1.5 truncate mb-1">
                  <span className="text-orange-700 font-black tabular-nums">#{idx + 1}</span>
                  <span aria-hidden="true">·</span>
                  <span className="truncate">
                    {soldCount > 0 ? `${soldCount} pedidos` : catLabel || 'Mais pedido'}
                  </span>
                </div>

                {/* Title */}
                <h3
                  className={`font-black text-stone-900 leading-snug line-clamp-2 ${
                    isCompact ? 'text-xs sm:text-sm min-h-[2.25rem]' : 'text-sm sm:text-base min-h-[2.5rem]'
                  }`}
                >
                  {formatCapitalized(product.name)}
                </h3>
              </div>

              {/* Price + Primary Action */}
              <div className="pt-2.5 mt-2 border-t border-stone-100 flex items-center justify-between gap-2">
                <span className="text-sm sm:text-base font-black text-orange-700 tabular-nums whitespace-nowrap">
                  {formatCurrency(product.price)}
                </span>

                {canBuy && (
                  <button
                    type="button"
                    onClick={(e) => {
                      e.stopPropagation();
                      onSelectProduct(entry);
                    }}
                    className={`min-h-[36px] px-2.5 py-1.5 rounded-xl font-black text-[11px] transition-all whitespace-nowrap shrink-0 flex items-center gap-1 cursor-pointer active:scale-95 ${
                      variant === 'success'
                        ? 'bg-emerald-600 hover:bg-emerald-700 text-white'
                        : isLockedByFrozen
                          ? isQueued
                            ? 'bg-orange-100 text-orange-900 border border-orange-300'
                            : 'bg-blue-50 hover:bg-blue-100 text-blue-900 border border-blue-200'
                          : isInCart
                            ? 'bg-emerald-50 hover:bg-emerald-100 text-emerald-800 border border-emerald-200'
                            : 'text-white shadow-xs hover:brightness-105'
                    }`}
                    style={
                      variant !== 'success' && !isLockedByFrozen && !isInCart
                        ? { backgroundColor: frozenCompatible && isFrozenOrderActive ? '#2563eb' : themeColor }
                        : undefined
                    }
                  >
                    {variant === 'success' ? (
                      <>
                        <Plus className="w-3.5 h-3.5" />
                        <span>Pedir Agora</span>
                      </>
                    ) : isLockedByFrozen ? (
                      isQueued ? (
                        <>
                          <Check className="w-3.5 h-3.5" />
                          <span>Reservado</span>
                        </>
                      ) : (
                        <span>Outro Pedido</span>
                      )
                    ) : isInCart ? (
                      <>
                        <Plus className="w-3.5 h-3.5" />
                        <span>Mais 1</span>
                      </>
                    ) : (
                      <>
                        <Plus className="w-3.5 h-3.5" />
                        <span>Adicionar</span>
                      </>
                    )}
                  </button>
                )}
              </div>
            </div>
          );
        })}
      </div>
    </section>
  );
}
