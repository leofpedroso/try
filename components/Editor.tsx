
import React, { useState, useEffect } from 'react';
import { useStore } from '../store/useStore';
import Viewer2D from './Viewer2D';
import Viewer3D from './Viewer3D';
import FileUploader from './FileUploader';
import { generateOBJ, generateDXF, generateSVG, generateIFC } from '../utils/exporters';
import { editImageWithPrompt } from '../services/geminiService';
import { ElementType, MaterialHint } from '../types';

const Editor: React.FC = () => {
  const store = useStore();
  const [mobilePanel, setMobilePanel] = useState<'none' | 'layers' | 'source'>('none');
  const [cadView, setCadView] = useState<'PLAN' | 'ELEVATION'>('PLAN');
  const [editPrompt, setEditPrompt] = useState('');
  const [toast, setToast] = useState<string | null>(null);

  // Show toast utility
  const showToast = (msg: string) => {
      setToast(msg);
      setTimeout(() => setToast(null), 3000);
  };

  const downloadFile = (content: string, filename: string, mime: string) => {
    const blob = new Blob([content], { type: mime });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
    showToast(`Exported ${filename}`);
  };

  const handleExport = (format: string) => {
    if (!store.model) return;
    try {
      const exporters: any = { '.obj': generateOBJ, '.dxf': generateDXF, '.svg': generateSVG, '.ifc': generateIFC };
      const mimeTypes: any = { '.obj': 'text/plain', '.dxf': 'application/dxf', '.svg': 'image/svg+xml', '.ifc': 'text/plain' };
      const content = exporters[format](store.model);
      downloadFile(content, `mannz_project${format}`, mimeTypes[format]);
    } catch (e: any) {
      store.setError({ code: 'EXPORT_FAIL', message: e.message });
    }
  };

  const handleMagicEdit = async () => {
      if (!store.image || !editPrompt.trim()) return;
      store.setIsEditingImage(true);
      try {
          const newImage = await editImageWithPrompt(store.image, editPrompt);
          if (newImage) {
              store.addImageRevision(newImage, editPrompt);
              setEditPrompt('');
          } else {
              store.setError({ code: 'AI_NO_RES', message: 'AI returned no image.' });
          }
      } catch (e: any) {
          store.setError({ code: 'AI_EDIT_FAIL', message: e.message });
      } finally {
          store.setIsEditingImage(false);
      }
  };

  // Find selected element
  const selectedElement = store.model?.elements.find(e => e.id === store.selectedElementId);

  // --------------------------------------------------------------------------
  // LANDING SCREEN
  // --------------------------------------------------------------------------
  if (!store.image) {
    return (
      <div className="min-h-screen w-full flex flex-col items-center justify-center bg-[#000000] text-white selection:bg-[#3BD23D] selection:text-black">
        <div className="w-full max-w-xl p-8 flex flex-col gap-12">
          <div className="space-y-2">
             <div className="w-8 h-1 bg-[#3BD23D] mb-6"></div>
             <h1 className="font-brand font-bold text-6xl tracking-tight leading-none">MANNZ<span className="text-zinc-600">.</span></h1>
             <p className="text-xl text-zinc-400 font-light">Digital Twin Architect</p>
          </div>
          <div className="bg-zinc-900 border border-zinc-800">
            <FileUploader />
          </div>
          {store.error && (
            <div className="bg-red-500/10 border-l-2 border-red-500 p-4 text-red-500 text-sm font-mono flex justify-between items-center">
              <span>SYSTEM_ERROR: {store.error.message}</span>
              <button onClick={() => store.setError(null)} className="text-xs underline hover:text-white">DISMISS</button>
            </div>
          )}
        </div>
      </div>
    );
  }

  // --------------------------------------------------------------------------
  // MAIN WORKSPACE
  // --------------------------------------------------------------------------
  return (
    <div className="flex flex-col h-screen w-full bg-[#121212] text-white font-sans overflow-hidden">
      
      {/* 1. APP BAR */}
      <header className="h-16 bg-[#121212] border-b border-white/5 flex items-center justify-between px-6 z-50 shrink-0 shadow-sm relative">
        <div className="flex items-center gap-8">
          <button onClick={store.reset} className="flex items-center gap-3 group">
            <div className="w-8 h-8 bg-black flex items-center justify-center border border-white/10 group-hover:border-[#3BD23D] transition-colors">
                <span className="font-brand font-bold text-lg text-white">M</span>
            </div>
            <div className="flex flex-col items-start leading-none">
                <span className="font-brand font-bold text-sm tracking-wide text-white">MANNZ</span>
                <span className="text-[9px] text-zinc-500 font-bold uppercase tracking-widest">Project 01</span>
            </div>
          </button>
          
          <div className="flex bg-zinc-900 p-1">
             <button 
              onClick={() => store.setViewMode('2D')}
              className={`px-6 py-1.5 text-[11px] font-bold uppercase tracking-wide transition-all ${store.viewMode === '2D' ? 'bg-white text-black shadow-sm' : 'text-zinc-500 hover:text-white'}`}
            >
              2D Plan
            </button>
            <button 
              onClick={() => store.setViewMode('3D')}
              disabled={!store.model}
              className={`px-6 py-1.5 text-[11px] font-bold uppercase tracking-wide transition-all flex items-center gap-2 ${store.viewMode === '3D' ? 'bg-white text-black shadow-sm' : 'text-zinc-500 hover:text-white'}`}
            >
              <span>3D Space</span>
              {store.isProcessing && <span className="w-1.5 h-1.5 bg-[#3BD23D] rounded-full animate-pulse" />}
            </button>
          </div>
        </div>

        {/* Global Toast */}
        {toast && (
            <div className="absolute left-1/2 top-16 -translate-x-1/2 bg-[#3BD23D] text-black px-4 py-2 text-xs font-bold uppercase tracking-wider shadow-lg animate-fade-in-down">
                {toast}
            </div>
        )}

        <div className="flex items-center gap-4">
            <button 
                onClick={() => handleExport('.ifc')}
                className="hidden md:flex h-9 px-4 items-center gap-2 bg-[#3BD23D] hover:bg-[#32b134] text-black text-[11px] font-bold uppercase tracking-wider transition-colors"
            >
                Export IFC
            </button>
            <button 
                onClick={() => setMobilePanel(mobilePanel === 'layers' ? 'none' : 'layers')}
                className="lg:hidden p-2 text-zinc-400 border border-zinc-700"
            >
                <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="square" strokeLinejoin="miter" strokeWidth={1.5} d="M4 6h16M4 12h16m-7 6h7" /></svg>
            </button>
        </div>
      </header>

      {/* 2. CONTENT AREA */}
      <div className="flex-1 flex flex-col lg:flex-row relative overflow-hidden">
        
        {/* LEFT DRAWER (Source & Tools) */}
        <aside className={`
          ${mobilePanel === 'source' ? 'translate-x-0' : '-translate-x-full lg:translate-x-0'} 
          fixed lg:relative inset-y-0 left-0 w-80 bg-[#18181b] border-r border-white/5 z-40 transition-transform duration-300 flex flex-col
        `}>
          <div className="flex-1 overflow-y-auto custom-scrollbar">
             
             {/* Source Image & Revisions */}
             <div className="p-6 border-b border-white/5">
                <h2 className="text-xs font-bold text-zinc-400 uppercase tracking-widest mb-4">Input Source</h2>
                <div className="relative aspect-square bg-black border border-white/10 group overflow-hidden mb-4">
                    <img src={store.image} className="w-full h-full object-cover opacity-80" />
                    {store.isEditingImage && (
                        <div className="absolute inset-0 bg-black/60 backdrop-blur-sm flex items-center justify-center">
                            <span className="text-[#3BD23D] text-[10px] font-bold animate-pulse uppercase">Processing...</span>
                        </div>
                    )}
                </div>

                {/* History Thumbs */}
                {store.imageHistory.length > 1 && (
                    <div className="flex gap-2 overflow-x-auto pb-2">
                        {store.imageHistory.map(rev => (
                            <button 
                                key={rev.id} 
                                onClick={() => store.selectImageRevision(rev.id)}
                                className={`w-12 h-12 shrink-0 border ${store.image === rev.url ? 'border-[#3BD23D]' : 'border-zinc-700'} relative`}
                            >
                                <img src={rev.url} className="w-full h-full object-cover" />
                            </button>
                        ))}
                    </div>
                )}
            </div>

            {/* AI Modification */}
            <div className="p-6 border-b border-white/5">
                <h2 className="text-xs font-bold text-zinc-400 uppercase tracking-widest mb-4">AI Revision</h2>
                <div className="flex flex-col bg-zinc-900 border-b border-white/20 focus-within:border-[#3BD23D] transition-colors">
                    <input 
                        type="text" 
                        value={editPrompt}
                        onChange={(e) => setEditPrompt(e.target.value)}
                        placeholder="Ex: Remove furniture..."
                        className="w-full bg-transparent text-sm text-white p-3 placeholder:text-zinc-600 focus:outline-none font-light"
                    />
                </div>
                <button 
                    onClick={handleMagicEdit}
                    disabled={store.isEditingImage || !editPrompt}
                    className="w-full mt-3 h-9 bg-white hover:bg-zinc-200 disabled:opacity-50 text-black text-[10px] font-bold uppercase tracking-wider transition-colors"
                >
                    Generate Revision
                </button>
            </div>

            {/* View Generation Results */}
            <div className="p-6">
                <h2 className="text-xs font-bold text-zinc-400 uppercase tracking-widest mb-4">Generated Views</h2>
                
                {store.isGeneratingViews ? (
                   <div className="h-1 w-full bg-zinc-800 overflow-hidden mb-2"><div className="h-full bg-[#3BD23D] animate-progress-indeterminate"></div></div>
                ) : null}

                <div className="space-y-3">
                    {store.generatedViews.map((src, i) => (
                        <div key={i} className="flex flex-col gap-2 p-3 bg-zinc-900 border border-white/5">
                            <img src={src} className="w-full h-32 object-contain grayscale hover:grayscale-0 transition-all cursor-pointer" onClick={() => {
                                const w = window.open("");
                                w?.document.write(`<img src="${src}" />`);
                            }}/>
                            <span className="text-[9px] font-bold text-white uppercase text-center block">
                                {i === 0 ? 'ISO View' : 'Elevation'}
                            </span>
                        </div>
                    ))}
                </div>
            </div>
          </div>
          
          <div className="p-6 border-t border-white/5 bg-[#18181b] grid grid-cols-2 gap-2">
             {['.obj', '.dxf'].map(fmt => (
                 <button key={fmt} onClick={() => handleExport(fmt)} className="h-8 border border-zinc-700 text-zinc-400 hover:text-white hover:border-white text-[10px] font-bold uppercase">{fmt}</button>
             ))}
          </div>
        </aside>

        {/* CENTER STAGE */}
        <main className="flex-1 relative flex flex-col bg-[#050505]">
           {/* Progress Bar */}
           {(store.isProcessing) && (
             <div className="absolute top-0 left-0 right-0 h-1 bg-zinc-900 z-50">
                <div className="h-full bg-[#3BD23D] animate-progress-indeterminate"></div>
             </div>
           )}

           {/* View Mode Switcher for 2D */}
           {store.viewMode === '2D' && (
              <div className="absolute top-6 left-1/2 -translate-x-1/2 z-20 flex bg-[#18181b] shadow-lg border border-white/5 p-1 gap-1">
                  <button onClick={() => setCadView('PLAN')} className={`h-8 px-4 text-[10px] font-bold uppercase tracking-wider transition-colors ${cadView === 'PLAN' ? 'bg-[#3BD23D] text-black' : 'text-zinc-500 hover:text-white'}`}>Plan</button>
                  <button onClick={() => setCadView('ELEVATION')} className={`h-8 px-4 text-[10px] font-bold uppercase tracking-wider transition-colors ${cadView === 'ELEVATION' ? 'bg-[#3BD23D] text-black' : 'text-zinc-500 hover:text-white'}`}>Elev</button>
              </div>
           )}

           <div className="flex-1 relative">
             {store.model ? (
                 store.viewMode === '2D' ? <Viewer2D model={store.model} mode={cadView} backgroundImage={store.image} /> : <Viewer3D model={store.model} />
             ) : (
                 <div className="absolute inset-0 flex items-center justify-center">
                    <div className="text-center">
                        <div className="w-12 h-12 border-2 border-zinc-800 border-t-[#3BD23D] rounded-full animate-spin mx-auto mb-4"></div>
                        <span className="text-[10px] text-zinc-600 font-bold uppercase tracking-widest">Awaiting Analysis...</span>
                    </div>
                 </div>
             )}
           </div>

           {/* Mobile Tab Bar */}
           <div className="lg:hidden flex h-14 bg-[#18181b] border-t border-white/5">
              <button onClick={() => setMobilePanel(mobilePanel === 'source' ? 'none' : 'source')} className="flex-1 text-[10px] font-bold uppercase text-zinc-400">Tools</button>
              <div className="w-[1px] bg-white/5 h-full"></div>
              <button onClick={() => setMobilePanel(mobilePanel === 'layers' ? 'none' : 'layers')} className="flex-1 text-[10px] font-bold uppercase text-zinc-400">Properties</button>
           </div>
        </main>

        {/* RIGHT DRAWER (Properties & Layers) */}
        <aside className={`
          ${mobilePanel === 'layers' ? 'translate-x-0' : 'translate-x-full lg:translate-x-0'} 
          fixed lg:relative inset-y-0 right-0 w-80 bg-[#18181b] border-l border-white/5 z-40 transition-transform duration-300 flex flex-col
        `}>
          
          {/* Layer Control */}
          <div className="p-6 border-b border-white/5">
            <h2 className="text-xs font-bold text-zinc-400 uppercase tracking-widest mb-4">Visibility Layers</h2>
            <div className="flex flex-col gap-2">
                {Object.values(ElementType).map(type => (
                    <label key={type} className="flex items-center justify-between cursor-pointer group">
                        <span className="text-[10px] font-bold uppercase text-zinc-500 group-hover:text-white">{type}</span>
                        <input 
                            type="checkbox" 
                            checked={store.layerVisibility[type]} 
                            onChange={() => store.toggleLayer(type)}
                            className="accent-[#3BD23D]"
                        />
                    </label>
                ))}
            </div>
          </div>

          {/* Properties Inspector */}
          <div className="flex-1 overflow-y-auto custom-scrollbar flex flex-col">
             <div className="p-6 border-b border-white/5 sticky top-0 bg-[#18181b]">
                <h2 className="text-xs font-bold text-zinc-400 uppercase tracking-widest">
                    {selectedElement ? 'BIM Inspector' : 'Digital Twin Manifest'}
                </h2>
             </div>
             
             {selectedElement ? (
                 <div className="p-6 space-y-6">
                     <div className="grid grid-cols-2 gap-4">
                        <div>
                            <label className="text-[9px] text-zinc-600 uppercase font-bold block mb-1">ID</label>
                            <div className="font-mono text-[10px] text-white break-all">{selectedElement.id.slice(0,8)}...</div>
                        </div>
                        <div>
                            <label className="text-[9px] text-zinc-600 uppercase font-bold block mb-1">Class</label>
                            <div className="text-[10px] text-[#3BD23D] font-bold uppercase">{selectedElement.twinData?.structuralClass || 'Unknown'}</div>
                        </div>
                     </div>

                     <div>
                         <label className="text-[9px] text-zinc-600 uppercase font-bold block mb-1">Material Specification</label>
                         <select 
                            value={selectedElement.material || 'generic'}
                            onChange={(e) => store.updateElementMaterial(selectedElement.id, e.target.value as MaterialHint)}
                            className="w-full bg-zinc-900 border border-zinc-700 text-xs text-white p-2 focus:border-[#3BD23D] outline-none"
                         >
                            {Object.values(MaterialHint).map(mat => (
                                <option key={mat} value={mat}>{mat}</option>
                            ))}
                         </select>
                     </div>

                     <div className="grid grid-cols-2 gap-4 bg-zinc-900 p-3 border border-white/5">
                         <div>
                             <label className="text-[9px] text-zinc-600 uppercase font-bold block mb-1">Height (m)</label>
                             <div className="font-mono text-xs text-white">{selectedElement.height}</div>
                         </div>
                         <div>
                             <label className="text-[9px] text-zinc-600 uppercase font-bold block mb-1">Elevation (m)</label>
                             <div className="font-mono text-xs text-white">{selectedElement.elevation}</div>
                         </div>
                     </div>

                     {/* DIGITAL TWIN METADATA */}
                     <div className="space-y-3">
                        <h3 className="text-[9px] font-bold text-white border-b border-white/10 pb-1 uppercase tracking-wider">Performance Data</h3>
                        
                        <div className="flex justify-between items-center">
                            <span className="text-[10px] text-zinc-400">Embodied Carbon</span>
                            <span className="text-[10px] font-mono text-white">{selectedElement.twinData?.embodiedCarbon || '--'} kgCO2e</span>
                        </div>
                        <div className="flex justify-between items-center">
                            <span className="text-[10px] text-zinc-400">Thermal (U-Val)</span>
                            <span className="text-[10px] font-mono text-white">{selectedElement.twinData?.thermalTransmittance || '--'} W/m²K</span>
                        </div>
                        <div className="flex justify-between items-center">
                            <span className="text-[10px] text-zinc-400">Cost Est.</span>
                            <span className="text-[10px] font-mono text-white">${selectedElement.twinData?.costEstimate || '--'}</span>
                        </div>
                        <div className="flex justify-between items-center">
                            <span className="text-[10px] text-zinc-400">Acoustic</span>
                            <span className="text-[10px] font-mono text-white">{selectedElement.twinData?.acousticRating || '--'}</span>
                        </div>
                     </div>
                     
                     {selectedElement.twinData?.description && (
                        <div className="p-3 bg-zinc-900 text-[10px] text-zinc-400 italic border-l-2 border-[#3BD23D]">
                            {selectedElement.twinData.description}
                        </div>
                     )}

                     <button onClick={() => store.selectElement(null)} className="w-full text-[10px] uppercase text-zinc-500 hover:text-white py-2 border border-dashed border-zinc-700 mt-4">Deselect</button>
                 </div>
             ) : (
                 <div className="p-2">
                     {store.model?.elements.map((el, i) => (
                        <div 
                            key={el.id} 
                            onClick={() => store.selectElement(el.id)}
                            className="p-3 border-b border-white/5 hover:bg-white/5 transition-colors group cursor-pointer flex items-center justify-between"
                        >
                            <div className="flex flex-col">
                                <span className="text-[10px] font-bold text-zinc-300 group-hover:text-white">{el.label || `Element ${i+1}`}</span>
                                <span className="text-[8px] text-zinc-600 uppercase">{el.twinData?.structuralClass || el.type}</span>
                            </div>
                            <span className="w-2 h-2 rounded-full" style={{ backgroundColor: el.type === ElementType.SOLID ? '#fff' : '#ef4444' }}></span>
                        </div>
                     ))}
                 </div>
             )}
          </div>
        </aside>

      </div>
    </div>
  );
};

export default Editor;
