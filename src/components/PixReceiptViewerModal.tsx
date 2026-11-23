import React, { useEffect, useMemo, useState } from 'react';
import { X, Download, Paperclip, FileText, ZoomIn, ZoomOut, ExternalLink } from 'lucide-react';

interface PixReceiptViewerModalProps {
  receiptUrl: string | null;
  orderId?: string;
  customerName?: string;
  confirmedBy?: string | null;
  onClose: () => void;
}

function dataUrlToBlob(dataUrl: string): Blob | null {
  try {
    const parts = dataUrl.split(',');
    if (parts.length < 2) return null;
    const mimeMatch = parts[0].match(/:(.*?);/);
    const mime = mimeMatch ? mimeMatch[1] : 'application/octet-stream';
    const bstr = atob(parts[1]);
    let n = bstr.length;
    const u8arr = new Uint8Array(n);
    while (n--) {
      u8arr[n] = bstr.charCodeAt(n);
    }
    return new Blob([u8arr], { type: mime });
  } catch {
    return null;
  }
}

export const PixReceiptViewerModal: React.FC<PixReceiptViewerModalProps> = ({
  receiptUrl,
  orderId,
  customerName,
  confirmedBy,
  onClose,
}) => {
  const [zoomed, setZoomed] = useState(false);

  const isDataUrl = Boolean(receiptUrl && receiptUrl.startsWith('data:'));
  const isPdf = Boolean(
    receiptUrl &&
      (receiptUrl.startsWith('data:application/pdf') ||
        receiptUrl.toLowerCase().endsWith('.pdf'))
  );

  const blobUrl = useMemo(() => {
    if (!receiptUrl || !isDataUrl) return null;
    const blob = dataUrlToBlob(receiptUrl);
    if (!blob) return null;
    return URL.createObjectURL(blob);
  }, [receiptUrl, isDataUrl]);

  useEffect(() => {
    return () => {
      if (blobUrl) {
        URL.revokeObjectURL(blobUrl);
      }
    };
  }, [blobUrl]);

  useEffect(() => {
    if (!receiptUrl) return;
    const handleKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', handleKey);
    return () => window.removeEventListener('keydown', handleKey);
  }, [receiptUrl, onClose]);

  if (!receiptUrl) return null;

  const shortOrderNum = orderId ? String(orderId).slice(-4).padStart(4, '0') : '';
  const extension = isPdf
    ? 'pdf'
    : receiptUrl.includes('image/png')
    ? 'png'
    : receiptUrl.includes('image/webp')
    ? 'webp'
    : 'jpg';
  const downloadFilename = `comprovante-pix${shortOrderNum ? `-pedido-${shortOrderNum}` : ''}.${extension}`;
  const effectiveHref = blobUrl || receiptUrl;

  return (
    <div
      className="fixed inset-0 z-[100] bg-black/80 backdrop-blur-xs flex items-center justify-center p-3 sm:p-5"
      onClick={onClose}
    >
      <div
        className="bg-white rounded-2xl shadow-2xl w-full max-w-2xl max-h-[92vh] flex flex-col overflow-hidden border border-stone-200"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="bg-emerald-700 text-white px-5 py-3.5 flex items-center justify-between gap-3">
          <div className="flex items-center gap-2.5 min-w-0">
            <Paperclip className="w-5 h-5 text-emerald-200 shrink-0" />
            <div className="min-w-0">
              <h3 className="text-sm sm:text-base font-black uppercase tracking-wide truncate">
                Comprovante de Pagamento{shortOrderNum ? ` • Pedido #${shortOrderNum}` : ''}
              </h3>
              {(customerName || confirmedBy) && (
                <p className="text-[11px] text-emerald-100 font-medium truncate">
                  {customerName ? `Cliente: ${customerName}` : ''}
                  {customerName && confirmedBy ? ' • ' : ''}
                  {confirmedBy ? `Confirmado por: ${confirmedBy}` : ''}
                </p>
              )}
            </div>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="p-1.5 rounded-full hover:bg-white/15 transition-colors cursor-pointer shrink-0"
            title="Fechar visualização"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        <div className="flex-1 overflow-auto bg-stone-100 p-4 flex items-center justify-center min-h-[300px]">
          {isPdf ? (
            <div className="w-full h-[65vh] flex flex-col items-center justify-center gap-3">
              {effectiveHref ? (
                <iframe
                  src={effectiveHref}
                  title="Comprovante PDF"
                  className="w-full h-full rounded-xl border border-stone-300 bg-white"
                />
              ) : (
                <div className="text-center text-stone-600 space-y-2">
                  <FileText className="w-12 h-12 mx-auto text-emerald-600" />
                  <p className="text-sm font-bold">Comprovante em PDF anexado</p>
                  <p className="text-xs">Use o botão abaixo para baixar e visualizar o arquivo.</p>
                </div>
              )}
            </div>
          ) : (
            <div className="w-full flex items-center justify-center overflow-auto">
              <img
                src={effectiveHref}
                alt={`Comprovante Pedido #${shortOrderNum}`}
                onClick={() => setZoomed((z) => !z)}
                className={`rounded-xl shadow-md border border-stone-200 bg-white transition-all cursor-zoom-in ${
                  zoomed ? 'max-w-none w-auto max-h-none cursor-zoom-out' : 'max-w-full max-h-[65vh] object-contain'
                }`}
              />
            </div>
          )}
        </div>

        <div className="px-4 py-3 bg-white border-t border-stone-200 flex flex-wrap items-center justify-between gap-2">
          <div className="flex items-center gap-2">
            {!isPdf && (
              <button
                type="button"
                onClick={() => setZoomed((z) => !z)}
                className="px-3 py-2 bg-stone-100 hover:bg-stone-200 text-stone-700 rounded-xl text-xs font-bold flex items-center gap-1.5 transition-colors cursor-pointer"
              >
                {zoomed ? <ZoomOut className="w-4 h-4" /> : <ZoomIn className="w-4 h-4" />}
                <span>{zoomed ? 'Ajustar à Tela' : 'Ampliar'}</span>
              </button>
            )}
            {blobUrl && (
              <a
                href={blobUrl}
                target="_blank"
                rel="noopener noreferrer"
                className="px-3 py-2 bg-stone-100 hover:bg-stone-200 text-stone-700 rounded-xl text-xs font-bold flex items-center gap-1.5 transition-colors cursor-pointer"
              >
                <ExternalLink className="w-4 h-4" />
                <span>Abrir em Nova Aba</span>
              </a>
            )}
          </div>

          <div className="flex items-center gap-2">
            <a
              href={effectiveHref}
              download={downloadFilename}
              className="px-4 py-2 bg-emerald-600 hover:bg-emerald-700 text-white rounded-xl text-xs font-black uppercase tracking-wider flex items-center gap-1.5 shadow-xs transition-colors cursor-pointer"
            >
              <Download className="w-4 h-4" />
              <span>Baixar Comprovante</span>
            </a>
            <button
              type="button"
              onClick={onClose}
              className="px-4 py-2 bg-stone-200 hover:bg-stone-300 text-stone-800 rounded-xl text-xs font-bold transition-colors cursor-pointer"
            >
              Fechar
            </button>
          </div>
        </div>
      </div>
    </div>
  );
};
