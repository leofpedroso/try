
import React, { useRef, useState } from 'react';
import { useStore } from '../store/useStore';
import { generateProjectVisuals, generateBIMData } from '../services/geminiService';

const SAMPLE_IMAGE_URL = "https://images.unsplash.com/photo-1592078615290-033ee584e267?auto=format&fit=crop&q=80&w=800"; 

const FileUploader: React.FC = () => {
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [isDragging, setIsDragging] = useState(false);
  const [isLoadingSample, setIsLoadingSample] = useState(false);
  const [status, setStatus] = useState<string>('');
  const store = useStore();

  const handleProcess = async (base64: string) => {
    store.reset(); // Clear previous state
    store.setImage(base64);
    store.setIsProcessing(true);
    
    try {
      // PHASE 1: VISUAL REINTERPRETATION
      setStatus('Generating Architectural Views...');
      store.setIsGeneratingViews(true);
      
      const visuals = await generateProjectVisuals(base64);
      
      // Update UI with the "Clean" plan and extra views
      store.setImage(visuals.plan); 
      store.setGeneratedViews(visuals.views);
      store.setIsGeneratingViews(false);

      // PHASE 2: BIM DATA EXTRACTION
      setStatus('Reconstructing 3D BIM Geometry...');
      
      // We use the CLEAN plan for vectorization, plus the context views
      const model = await generateBIMData(visuals.plan, visuals.views);
      store.setModel(model);

      setStatus('');
    } catch (err: any) {
      console.error(err);
      store.setError({ code: 'PROCESS_FAIL', message: err.message || "Failed to process project." });
    } finally {
      store.setIsProcessing(false);
      setIsLoadingSample(false);
      setStatus('');
    }
  };

  const handleFileUpload = async (file: File) => {
    if (!file.type.startsWith('image/')) {
      store.setError({ code: 'INVALID_TYPE', message: "Please upload a PNG or JPG file." });
      return;
    }
    const reader = new FileReader();
    reader.onload = (e) => {
      const base64 = e.target?.result as string;
      handleProcess(base64);
    };
    reader.readAsDataURL(file);
  };

  const handleLoadSample = async (e: React.MouseEvent) => {
    e.stopPropagation();
    setIsLoadingSample(true);
    try {
      const response = await fetch(SAMPLE_IMAGE_URL);
      const blob = await response.blob();
      const reader = new FileReader();
      reader.onload = (e) => {
        const base64 = e.target?.result as string;
        handleProcess(base64);
      };
      reader.readAsDataURL(blob);
    } catch (err) {
      store.setError({ code: 'SAMPLE_FETCH_FAIL', message: "Could not load sample image." });
      setIsLoadingSample(false);
    }
  };

  const onDrop = (e: React.DragEvent) => {
    e.preventDefault();
    setIsDragging(false);
    if (e.dataTransfer.files?.[0]) {
      handleFileUpload(e.dataTransfer.files[0]);
    }
  };

  return (
    <div className="w-full font-sans">
        <div 
            className={`
                relative h-64 flex flex-col items-center justify-center text-center cursor-pointer transition-colors duration-300 border border-dashed
                ${isDragging ? 'bg-[#3BD23D]/10 border-[#3BD23D]' : 'bg-transparent border-zinc-800 hover:bg-white/5'}
            `}
            onDragOver={(e) => { e.preventDefault(); setIsDragging(true); }}
            onDragLeave={() => setIsDragging(false)}
            onDrop={onDrop}
            onClick={() => fileInputRef.current?.click()}
        >
            <input 
                type="file" 
                className="hidden" 
                ref={fileInputRef} 
                accept="image/*"
                onChange={(e) => e.target.files?.[0] && handleFileUpload(e.target.files[0])}
            />
            
            {store.isProcessing ? (
                <div className="space-y-4">
                    <div className="w-8 h-8 border-2 border-white/20 border-t-[#3BD23D] rounded-full animate-spin mx-auto"></div>
                    <p className="text-[10px] text-[#3BD23D] font-bold uppercase tracking-widest animate-pulse">{status || 'Processing...'}</p>
                </div>
            ) : (
                <div className="space-y-4 pointer-events-none">
                     <div className="w-12 h-12 bg-white/10 rounded-full flex items-center justify-center mx-auto text-zinc-400">
                        <svg className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="square" strokeLinejoin="miter" strokeWidth={1.5} d="M12 4v16m8-8H4" /></svg>
                     </div>
                     <div>
                        <h3 className="text-sm font-bold text-white uppercase tracking-wider">Upload Sketch / Plan</h3>
                        <p className="text-[10px] text-zinc-500 mt-1 uppercase tracking-widest">AI Photogrammetry Engine</p>
                     </div>
                </div>
            )}
        </div>

        <button 
            onClick={handleLoadSample}
            disabled={isLoadingSample || store.isProcessing}
            className="w-full py-4 border-t border-zinc-800 bg-black hover:bg-zinc-900 text-zinc-400 hover:text-white text-[10px] font-bold uppercase tracking-widest transition-colors disabled:opacity-50"
        >
            {isLoadingSample ? 'Loading Sample...' : 'Load Example Project'}
        </button>
    </div>
  );
};

export default FileUploader;
