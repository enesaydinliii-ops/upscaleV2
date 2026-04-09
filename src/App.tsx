import React, { useRef, useState, useEffect } from 'react';
import { 
  Upload, 
  Settings, 
  Download, 
  Image as ImageIcon, 
  Check, 
  AlertCircle, 
  Loader2, 
  Trash2, 
  Maximize2,
  ChevronRight,
  Info
} from 'lucide-react';
import { motion, AnimatePresence } from 'motion/react';
import { cn } from './lib/utils';

// Types
interface UpscaledImage {
  id: string;
  name: string;
  blob: Blob;
  preview: string;
  width: number;
  height: number;
  originalWidth: number;
  originalHeight: number;
  status: 'pending' | 'processing' | 'completed' | 'error';
  error?: string;
}

const MAX_FILES = 20;

export default function App() {
  const [files, setFiles] = useState<File[]>([]);
  const [results, setResults] = useState<UpscaledImage[]>([]);
  const [processing, setProcessing] = useState(false);
  const [sharpness, setSharpness] = useState(150);
  const [scale, setScale] = useState(8);
  const [useAI, setUseAI] = useState(true);
  const [hfEndpoint, setHfEndpoint] = useState('https://api-inference.huggingface.co/models/caidas/swin2SR-classical-sr-x4-64');
  const [hfToken, setHfToken] = useState(import.meta.env.VITE_HUGGINGFACE_TOKEN || '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');
  const [showSettings, setShowSettings] = useState(false);
  
  const inputRef = useRef<HTMLInputElement>(null);

  const onSelectFiles = (selected: FileList | null) => {
    if (!selected) return;
    const newFiles = Array.from(selected).slice(0, MAX_FILES);
    setFiles(newFiles);
    
    // Initialize results with pending state
    const initialResults: UpscaledImage[] = newFiles.map(file => ({
      id: Math.random().toString(36).substring(7),
      name: file.name.replace(/\.[^.]+$/, '') + `_${scale}x.png`,
      blob: new Blob(),
      preview: URL.createObjectURL(file),
      width: 0,
      height: 0,
      originalWidth: 0,
      originalHeight: 0,
      status: 'pending'
    }));
    setResults(initialResults);
  };

  const upscaleImage = async (file: File, resultId: string) => {
    updateResultStatus(resultId, 'processing');
    
    try {
      const pica = (await import('pica')).default();
      let finalBlob: Blob | null = null;
      let finalWidth = 0;
      let finalHeight = 0;
      let originalWidth = 0;
      let originalHeight = 0;

      if (useAI) {
        // Step 1: AI 4x Upscale
        const arrayBuffer = await file.arrayBuffer();
        const response = await fetch(hfEndpoint, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/octet-stream',
            ...(hfToken ? { Authorization: `Bearer ${hfToken}` } : {}),
          },
          body: arrayBuffer,
        });

        if (!response.ok) {
          throw new Error('AI upscale failed. Try using Local Pica mode.');
        }

        const aiBlob = await response.blob();
        const aiImg = await new Promise<HTMLImageElement>((resolve, reject) => {
          const image = new Image();
          image.onload = () => resolve(image);
          image.onerror = reject;
          image.src = URL.createObjectURL(aiBlob);
        });

        originalWidth = aiImg.width / 4;
        originalHeight = aiImg.height / 4;

        if (scale === 4) {
          finalBlob = aiBlob;
          finalWidth = aiImg.width;
          finalHeight = aiImg.height;
        } else {
          // Step 2: If scale is 8x, use Pica to double the AI output
          const srcCanvas = document.createElement('canvas');
          srcCanvas.width = aiImg.width;
          srcCanvas.height = aiImg.height;
          srcCanvas.getContext('2d')?.drawImage(aiImg, 0, 0);

          const dstCanvas = document.createElement('canvas');
          const multiplier = scale / 4;
          dstCanvas.width = aiImg.width * multiplier;
          dstCanvas.height = aiImg.height * multiplier;

          await pica.resize(srcCanvas, dstCanvas, {
            quality: 3,
            alpha: true,
            unsharpAmount: sharpness,
            unsharpRadius: 1.5,
            unsharpThreshold: 1,
          });

          finalBlob = await new Promise<Blob | null>((resolve) => dstCanvas.toBlob(resolve, 'image/png', 1));
          finalWidth = dstCanvas.width;
          finalHeight = dstCanvas.height;
        }
      } else {
        // Pure Pica Upscale
        const img = await new Promise<HTMLImageElement>((resolve, reject) => {
          const image = new Image();
          image.onload = () => resolve(image);
          image.onerror = reject;
          image.src = URL.createObjectURL(file);
        });

        originalWidth = img.width;
        originalHeight = img.height;

        const srcCanvas = document.createElement('canvas');
        srcCanvas.width = img.width;
        srcCanvas.height = img.height;
        srcCanvas.getContext('2d')?.drawImage(img, 0, 0);

        const dstCanvas = document.createElement('canvas');
        dstCanvas.width = img.width * scale;
        dstCanvas.height = img.height * scale;

        await pica.resize(srcCanvas, dstCanvas, {
          quality: 3,
          alpha: true,
          unsharpAmount: sharpness,
          unsharpRadius: 1.5,
          unsharpThreshold: 1,
        });

        // Maximize clarity with post-processing
        const ctx = dstCanvas.getContext('2d');
        if (ctx) {
          ctx.filter = `contrast(1.1) saturate(1.05) brightness(1.02)`;
          const temp = document.createElement('canvas');
          temp.width = dstCanvas.width;
          temp.height = dstCanvas.height;
          temp.getContext('2d')?.drawImage(dstCanvas, 0, 0);
          ctx.clearRect(0, 0, dstCanvas.width, dstCanvas.height);
          ctx.drawImage(temp, 0, 0);
          ctx.filter = 'none';
        }

        finalBlob = await new Promise<Blob | null>((resolve) => dstCanvas.toBlob(resolve, 'image/png', 1));
        finalWidth = dstCanvas.width;
        finalHeight = dstCanvas.height;
      }

      if (!finalBlob) throw new Error('Upscale failed');

      setResults(prev => prev.map(r => r.id === resultId ? {
        ...r,
        blob: finalBlob!,
        preview: URL.createObjectURL(finalBlob!),
        width: finalWidth,
        height: finalHeight,
        originalWidth,
        originalHeight,
        status: 'completed'
      } : r));

    } catch (error) {
      console.error('Upscale error:', error);
      updateResultStatus(resultId, 'error', error instanceof Error ? error.message : 'Unknown error');
    }
  };

  const updateResultStatus = (id: string, status: UpscaledImage['status'], error?: string) => {
    setResults(prev => prev.map(r => r.id === id ? { ...r, status, error } : r));
  };

  const processAll = async () => {
    if (!files.length) return;
    setProcessing(true);
    
    // Process sequentially to avoid overwhelming the API/Browser
    for (let i = 0; i < files.length; i++) {
      await upscaleImage(files[i], results[i].id);
    }
    
    setProcessing(false);
  };

  const downloadAll = async () => {
    const JSZip = (await import('jszip')).default;
    const { saveAs } = await import('file-saver');
    const zip = new JSZip();

    const completedResults = results.filter(r => r.status === 'completed');
    completedResults.forEach((r) => zip.file(r.name, r.blob));

    const content = await zip.generateAsync({ type: 'blob' });
    saveAs(content, 'upscaled_4x_images.zip');
  };

  const clearAll = () => {
    setFiles([]);
    setResults([]);
  };

  return (
    <div className="min-h-screen bg-[#F8F9FA] text-[#1A1A1A] font-sans selection:bg-black selection:text-white">
      {/* Header */}
      <header className="sticky top-0 z-50 bg-white/80 backdrop-blur-md border-b border-gray-200 px-6 py-4">
        <div className="max-w-7xl mx-auto flex items-center justify-between">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 bg-black rounded-xl flex items-center justify-center text-white">
              <Maximize2 size={20} />
            </div>
            <div>
              <h1 className="text-xl font-bold tracking-tight">4X Upscaler</h1>
              <p className="text-xs text-gray-500 font-medium uppercase tracking-wider">Batch Image Enhancement</p>
            </div>
          </div>
          
          <div className="flex items-center gap-2">
            <button 
              onClick={() => setShowSettings(!showSettings)}
              className={cn(
                "p-2.5 rounded-xl transition-all duration-200",
                showSettings ? "bg-black text-white" : "hover:bg-gray-100 text-gray-600"
              )}
            >
              <Settings size={20} />
            </button>
            {results.length > 0 && (
              <button 
                onClick={clearAll}
                className="p-2.5 rounded-xl hover:bg-red-50 text-red-600 transition-all duration-200"
                title="Clear all"
              >
                <Trash2 size={20} />
              </button>
            )}
            <a 
              href="/api/download-project"
              target="_blank"
              rel="noopener noreferrer"
              className="p-2.5 rounded-xl bg-blue-50 text-blue-600 hover:bg-blue-100 transition-all duration-200 flex items-center gap-2"
              title="Kaynak Kodlarını İndir"
            >
              <Download size={20} />
              <span className="text-sm font-bold hidden sm:inline">Kaynak ZIP</span>
            </a>
          </div>
        </div>
      </header>

      <main className="max-w-7xl mx-auto p-6 space-y-8">
        {/* Settings Panel */}
        <AnimatePresence>
          {showSettings && (
            <motion.div 
              initial={{ height: 0, opacity: 0 }}
              animate={{ height: 'auto', opacity: 1 }}
              exit={{ height: 0, opacity: 0 }}
              className="overflow-hidden"
            >
              <div className="bg-white rounded-2xl border border-gray-200 p-6 shadow-sm space-y-6">
                <div className="grid grid-cols-1 md:grid-cols-2 gap-8">
                  <div className="space-y-4">
                    <h3 className="text-sm font-bold uppercase tracking-wider text-gray-400">Engine Settings</h3>
                    <div className="space-y-3">
                      <div className="space-y-2">
                        <label className="text-xs font-bold uppercase text-gray-400">Upscale Factor</label>
                        <div className="flex gap-2">
                          {[2, 4, 8].map((s) => (
                            <button
                              key={s}
                              onClick={() => setScale(s)}
                              className={cn(
                                "flex-1 py-2 rounded-lg border text-sm font-bold transition-all",
                                scale === s ? "bg-black text-white border-black" : "bg-white text-gray-600 border-gray-200 hover:border-gray-400"
                              )}
                            >
                              {s}X
                            </button>
                          ))}
                        </div>
                      </div>

                      <label className="flex items-center justify-between p-3 rounded-xl border border-gray-100 hover:border-gray-200 cursor-pointer transition-all">
                        <div className="flex items-center gap-3">
                          <div className={cn("w-4 h-4 rounded-full border-2 flex items-center justify-center", useAI ? "border-black" : "border-gray-300")}>
                            {useAI && <div className="w-2 h-2 bg-black rounded-full" />}
                          </div>
                          <span className="text-sm font-medium">Hugging Face AI (Swin2SR)</span>
                        </div>
                        <input 
                          type="checkbox" 
                          className="hidden" 
                          checked={useAI} 
                          onChange={(e) => setUseAI(e.target.checked)} 
                        />
                      </label>
                      
                      {useAI && (
                        <div className="space-y-3 pl-7">
                          <div className="space-y-1">
                            <label className="text-[10px] font-bold uppercase text-gray-400">Model Endpoint</label>
                            <input
                              type="text"
                              value={hfEndpoint}
                              onChange={(e) => setHfEndpoint(e.target.value)}
                              className="w-full bg-gray-50 border border-gray-200 rounded-lg px-3 py-2 text-xs focus:ring-2 focus:ring-black outline-none"
                            />
                          </div>
                          <div className="space-y-1">
                            <label className="text-[10px] font-bold uppercase text-gray-400">API Token</label>
                            <input
                              type="password"
                              value={hfToken}
                              onChange={(e) => setHfToken(e.target.value)}
                              className="w-full bg-gray-50 border border-gray-200 rounded-lg px-3 py-2 text-xs focus:ring-2 focus:ring-black outline-none"
                              placeholder="hf_..."
                            />
                          </div>
                        </div>
                      )}

                      <label className="flex items-center justify-between p-3 rounded-xl border border-gray-100 hover:border-gray-200 cursor-pointer transition-all">
                        <div className="flex items-center gap-3">
                          <div className={cn("w-4 h-4 rounded-full border-2 flex items-center justify-center", !useAI ? "border-black" : "border-gray-300")}>
                            {!useAI && <div className="w-2 h-2 bg-black rounded-full" />}
                          </div>
                          <span className="text-sm font-medium">Local Pica Resizer (Fast)</span>
                        </div>
                        <input 
                          type="checkbox" 
                          className="hidden" 
                          checked={!useAI} 
                          onChange={(e) => setUseAI(!e.target.checked)} 
                        />
                      </label>
                    </div>
                  </div>

                  <div className="space-y-4">
                    <h3 className="text-sm font-bold uppercase tracking-wider text-gray-400">Enhancement</h3>
                    <div className="space-y-6">
                      <div className="space-y-3">
                        <div className="flex justify-between items-center">
                          <label className="text-sm font-medium">Sharpness Strength</label>
                          <span className="text-xs font-mono bg-gray-100 px-2 py-1 rounded">{sharpness}%</span>
                        </div>
                        <input
                          type="range"
                          min="0"
                          max="200"
                          value={sharpness}
                          onChange={(e) => setSharpness(Number(e.target.value))}
                          className="w-full accent-black h-1.5 bg-gray-200 rounded-lg appearance-none cursor-pointer"
                        />
                        <p className="text-[10px] text-gray-400 italic">Higher values increase edge definition but may introduce artifacts.</p>
                      </div>
                    </div>
                  </div>
                </div>
              </div>
            </motion.div>
          )}
        </AnimatePresence>

        {/* Upload Area */}
        {results.length === 0 ? (
          <motion.div 
            initial={{ y: 20, opacity: 0 }}
            animate={{ y: 0, opacity: 1 }}
            className="flex flex-col items-center justify-center min-h-[60vh] text-center"
          >
            <div 
              onClick={() => inputRef.current?.click()}
              onDragOver={(e) => { e.preventDefault(); e.currentTarget.classList.add('border-black', 'bg-gray-50'); }}
              onDragLeave={(e) => { e.preventDefault(); e.currentTarget.classList.remove('border-black', 'bg-gray-50'); }}
              onDrop={(e) => {
                e.preventDefault();
                e.currentTarget.classList.remove('border-black', 'bg-gray-50');
                onSelectFiles(e.dataTransfer.files);
              }}
              className="group relative w-full max-w-2xl aspect-video border-2 border-dashed border-gray-300 rounded-[32px] flex flex-col items-center justify-center gap-6 cursor-pointer hover:border-black hover:bg-white transition-all duration-300"
            >
              <div className="w-20 h-20 bg-gray-100 rounded-full flex items-center justify-center text-gray-400 group-hover:scale-110 group-hover:bg-black group-hover:text-white transition-all duration-300">
                <Upload size={32} />
              </div>
              <div className="space-y-2">
                <h2 className="text-2xl font-bold tracking-tight">Drop your images here</h2>
                <p className="text-gray-500">Supports PNG, JPG, WEBP • Up to {MAX_FILES} files</p>
              </div>
              <div className="absolute bottom-8 flex items-center gap-2 text-[10px] font-bold uppercase tracking-widest text-gray-400">
                <Info size={12} />
                <span>Images are processed at 400% scale</span>
              </div>
            </div>
            <input
              ref={inputRef}
              type="file"
              accept="image/*"
              multiple
              className="hidden"
              onChange={(e) => onSelectFiles(e.target.files)}
            />
          </motion.div>
        ) : (
          <div className="space-y-6">
            {/* Action Bar */}
            <div className="flex flex-wrap items-center justify-between gap-4 bg-white p-4 rounded-2xl border border-gray-200 shadow-sm">
              <div className="flex items-center gap-4">
                <div className="px-4 py-2 bg-gray-100 rounded-xl text-sm font-bold">
                  {results.length} Files Selected
                </div>
                {processing && (
                  <div className="flex items-center gap-2 text-sm text-gray-500 font-medium">
                    <Loader2 size={16} className="animate-spin" />
                    Processing...
                  </div>
                )}
              </div>
              
              <div className="flex items-center gap-3">
                <button
                  onClick={processAll}
                  disabled={processing || results.every(r => r.status === 'completed')}
                  className="px-6 py-3 bg-black text-white rounded-xl font-bold text-sm hover:bg-gray-800 disabled:opacity-50 transition-all flex items-center gap-2"
                >
                  {processing ? 'Processing...' : `Start ${scale}X Upscale`}
                  <ChevronRight size={16} />
                </button>
                
                <button
                  onClick={downloadAll}
                  disabled={!results.some(r => r.status === 'completed')}
                  className="px-6 py-3 bg-white border border-gray-200 rounded-xl font-bold text-sm hover:bg-gray-50 disabled:opacity-50 transition-all flex items-center gap-2"
                >
                  <Download size={16} />
                  Download ZIP
                </button>
              </div>
            </div>

            {/* Results Grid */}
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-6">
              <AnimatePresence mode="popLayout">
                {results.map((result, index) => (
                  <motion.div
                    key={result.id}
                    layout
                    initial={{ scale: 0.9, opacity: 0 }}
                    animate={{ scale: 1, opacity: 1 }}
                    exit={{ scale: 0.9, opacity: 0 }}
                    transition={{ delay: index * 0.05 }}
                    className="group bg-white rounded-2xl border border-gray-200 overflow-hidden shadow-sm hover:shadow-md transition-all"
                  >
                    <div className="relative aspect-square bg-gray-100 overflow-hidden">
                      <img
                        src={result.preview}
                        alt={result.name}
                        className={cn(
                          "w-full h-full object-contain transition-all duration-500",
                          result.status === 'processing' ? "scale-105 blur-sm opacity-50" : "scale-100"
                        )}
                      />
                      
                      {/* Status Overlay */}
                      <div className="absolute inset-0 flex items-center justify-center">
                        {result.status === 'processing' && (
                          <div className="bg-white/90 p-4 rounded-2xl shadow-xl flex flex-col items-center gap-3">
                            <Loader2 size={24} className="animate-spin text-black" />
                            <span className="text-[10px] font-bold uppercase tracking-widest">Upscaling...</span>
                          </div>
                        )}
                        {result.status === 'completed' && (
                          <div className="absolute top-3 right-3 bg-green-500 text-white p-1.5 rounded-full shadow-lg">
                            <Check size={14} strokeWidth={3} />
                          </div>
                        )}
                        {result.status === 'error' && (
                          <div className="bg-red-50/90 p-4 rounded-2xl border border-red-100 flex flex-col items-center gap-2 text-red-600">
                            <AlertCircle size={24} />
                            <span className="text-[10px] font-bold uppercase tracking-widest">Failed</span>
                          </div>
                        )}
                      </div>

                      {/* Dimensions Badge */}
                      {result.status === 'completed' && (
                        <div className="absolute bottom-3 left-3 bg-black/80 backdrop-blur-md text-white px-2 py-1 rounded-lg text-[10px] font-mono">
                          {result.width} × {result.height}
                        </div>
                      )}
                    </div>

                    <div className="p-4 space-y-3">
                      <div className="flex items-start justify-between gap-2">
                        <div className="min-w-0">
                          <p className="text-sm font-bold truncate">{result.name}</p>
                          <p className="text-[10px] text-gray-400 font-medium">
                            Original: {result.originalWidth || '?'} × {result.originalHeight || '?'}
                          </p>
                        </div>
                        <div className="flex-shrink-0">
                          {result.status === 'completed' ? (
                            <a
                              href={result.preview}
                              download={result.name}
                              className="p-2 bg-gray-50 hover:bg-black hover:text-white rounded-lg transition-all block"
                              title="Download single"
                            >
                              <Download size={14} />
                            </a>
                          ) : (
                            <div className="p-2 text-gray-300">
                              <ImageIcon size={14} />
                            </div>
                          )}
                        </div>
                      </div>

                      {result.error && (
                        <p className="text-[10px] text-red-500 bg-red-50 p-2 rounded-lg leading-tight">
                          {result.error}
                        </p>
                      )}
                    </div>
                  </motion.div>
                ))}
              </AnimatePresence>
            </div>
          </div>
        )}
      </main>

      {/* Footer Info */}
      <footer className="max-w-7xl mx-auto px-6 py-12 border-t border-gray-100 mt-12">
        <div className="grid grid-cols-1 md:grid-cols-3 gap-8">
          <div className="space-y-3">
            <h4 className="text-xs font-bold uppercase tracking-widest text-gray-400">Technology</h4>
            <p className="text-sm text-gray-500 leading-relaxed">
              Utilizes Swin2SR (Swin Transformer for Super-Resolution) models via Hugging Face Inference API for state-of-the-art 4x upscaling.
            </p>
          </div>
          <div className="space-y-3">
            <h4 className="text-xs font-bold uppercase tracking-widest text-gray-400">Privacy</h4>
            <p className="text-sm text-gray-500 leading-relaxed">
              Images are processed via API and not stored permanently. Local processing mode keeps data entirely within your browser.
            </p>
          </div>
          <div className="space-y-3">
            <h4 className="text-xs font-bold uppercase tracking-widest text-gray-400">Limits</h4>
            <p className="text-sm text-gray-500 leading-relaxed">
              Batch limit of {MAX_FILES} files per session. Recommended input resolution under 1000px for best performance.
            </p>
          </div>
        </div>
      </footer>
    </div>
  );
}
