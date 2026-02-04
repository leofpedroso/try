
import React, { useMemo, useState, useRef } from 'react';
import { ArchModel, ElementType, ElementForm } from '../types';
import { useStore } from '../store/useStore';

interface Viewer2DProps {
  model: ArchModel;
  mode: 'PLAN' | 'ELEVATION';
  backgroundImage?: string | null;
}

// ------------------------------------------------------------------
// UTILS: SPLINE INTERPOLATION (Catmull-Rom to SVG Bezier)
// ------------------------------------------------------------------
const catmullRom2bezier = (points: number[][], closed = true) => {
    const d: string[] = [];
    const p = points;
    const len = p.length;
    
    if (len < 2) return "";

    // Helper to calculate control points
    const k = 1; // Tension
    
    // Duplicate points for closure if needed to wrap logic handles it, 
    // but here we index modulo length.
    
    d.push(`M ${p[0][0]} ${p[0][1]}`);

    for (let i = 0; i < (closed ? len : len - 1); i++) {
        const p0 = p[(i - 1 + len) % len];
        const p1 = p[i];
        const p2 = p[(i + 1) % len];
        const p3 = p[(i + 2) % len];

        const cp1x = p1[0] + (p2[0] - p0[0]) / 6 * k;
        const cp1y = p1[1] + (p2[1] - p0[1]) / 6 * k;

        const cp2x = p2[0] - (p3[0] - p1[0]) / 6 * k;
        const cp2y = p2[1] - (p3[1] - p1[1]) / 6 * k;

        d.push(`C ${cp1x} ${cp1y} ${cp2x} ${cp2y} ${p2[0]} ${p2[1]}`);
    }
    
    if (closed) d.push("Z");
    return d.join(" ");
};

const Viewer2D: React.FC<Viewer2DProps> = ({ model, mode, backgroundImage }) => {
  const { 
    selectedElementId, selectElement, 
    layerVisibility, viewState, setViewState 
  } = useStore();
  
  const [opacity, setOpacity] = useState(0.4);
  const containerRef = useRef<HTMLDivElement>(null);
  const isDragging = useRef(false);
  const lastMouse = useRef<{x: number, y: number} | null>(null);

  // Parse Bounds & Paths
  const { viewBox, renderPaths, gridLines, bgImageBounds, bounds } = useMemo(() => {
    const allPoints = model.elements.flatMap(e => e.points);
    if (allPoints.length === 0) return { viewBox: "0 0 100 100", renderPaths: [], gridLines: [], bgImageBounds: null, bounds: null };

    const xs = allPoints.map(p => p[0]);
    const ys = allPoints.map(p => p[1]);
    const minX = Math.min(...xs); const maxX = Math.max(...xs);
    const minY = Math.min(...ys); const maxY = Math.max(...ys);

    const pad = 80;
    
    // Scale estimation (Assuming 1000px = ~15m for context labels)
    const pxPerMeter = 1000 / 15; 
    const widthMeters = (maxX - minX) / pxPerMeter;
    const depthMeters = (maxY - minY) / pxPerMeter;

    const paths: any[] = [];
    
    if (mode === 'PLAN') {
       // --- PLAN VIEW (CUT PLANE @ 1.2m usually) ---
       const vb = `${minX - pad} ${minY - pad} ${maxX - minX + pad * 2} ${maxY - minY + pad * 2}`;
       
       model.elements.forEach(el => {
         if (!layerVisibility[el.type]) return; 
         
         // 1. Determine Geometry Type (Line vs Spline)
         let d = "";
         const isOrganic = [ElementForm.ROUNDED, ElementForm.PILLOW, ElementForm.BUBBLE].includes(el.form || ElementForm.EXTRUSION);

         if (isOrganic && el.points.length > 2) {
             d = catmullRom2bezier(el.points, true);
         } else {
             d = el.points.map((p, i) => `${i === 0 ? 'M' : 'L'} ${p[0]} ${p[1]}`).join(' ') + " Z";
         }

         // 2. Layering & Stacking
         // Solids are cut (black/hatch), Components are below or above
         let zIndex = 0;
         if (el.type === ElementType.SOLID) zIndex = 0; // Cut walls at bottom (or top depending on strategy)
         if (el.type === ElementType.COMPONENT) zIndex = 2; // Furniture on top
         if (el.type === ElementType.VOID) zIndex = 10; // Holes on top
         
         paths.push({ 
             id: el.id, 
             d, 
             type: el.type, 
             form: el.form,
             zIndex 
         });
       });
       
       // Sort: Solid (Background/Cut) -> Components (Mid) -> Voids (Top)
       // Actually in CAD, Cut lines are on top. 
       // Strategy: Draw Fills first, then Outlines.
       
       return { 
           viewBox: vb, 
           renderPaths: paths.sort((a,b) => a.zIndex - b.zIndex), 
           gridLines: generateGrid(minX, maxX, minY, maxY),
           bgImageBounds: { x: 0, y: 0, w: 1000, h: 1000 },
           bounds: { w: widthMeters, d: depthMeters }
       };

    } else {
       // --- ELEVATION VIEW (ORTHOGRAPHIC PROJECTION) ---
       const groundY = maxY + 100; 
       let minElevY = groundY;
       let maxElevY = groundY;
       
       model.elements.forEach(el => {
           if (!layerVisibility[el.type]) return; 
           if (el.type === ElementType.VOID) return; 
           
           const elXs = el.points.map(p => p[0]);
           const elMinX = Math.min(...elXs);
           const elMaxX = Math.max(...elXs);
           
           const elevationPx = (el.elevation || 0) * pxPerMeter;
           const heightPx = (el.height || 2.5) * pxPerMeter;

           const bottomPx = groundY - elevationPx;
           const topPx = bottomPx - heightPx;
           
           minElevY = Math.min(minElevY, topPx);
           maxElevY = Math.max(maxElevY, bottomPx);

           const d = `M ${elMinX} ${bottomPx} L ${elMaxX} ${bottomPx} L ${elMaxX} ${topPx} L ${elMinX} ${topPx} Z`;
           const avgDepth = el.points.reduce((sum, p) => sum + p[1], 0) / el.points.length;
           
           paths.push({ id: el.id, d, type: el.type, form: ElementForm.EXTRUSION, zIndex: avgDepth });
       });

       const heightOfView = maxElevY - minElevY;
       const vbElev = `${minX - pad} ${minElevY - pad} ${maxX - minX + pad * 2} ${heightOfView + pad * 2}`;
       
       return { 
           viewBox: vbElev, 
           renderPaths: paths.sort((a,b) => b.zIndex - a.zIndex), // Depth sort
           gridLines: generateGrid(minX, maxX, minElevY, groundY),
           bgImageBounds: null,
           bounds: { w: widthMeters, d: heightOfView / pxPerMeter }
       };
    }
  }, [model, mode, layerVisibility]);

  function generateGrid(x1:number, x2:number, y1:number, y2:number) {
      const lines = [];
      const step = 100; // 1m roughly
      const pad = 200;
      const startX = Math.floor((x1-pad)/step)*step;
      const startY = Math.floor((y1-pad)/step)*step;
      const endX = x2 + pad;
      const endY = y2 + pad;

      for(let x=startX; x<=endX; x+=step) lines.push({x1:x, y1:y1-pad, x2:x, y2:y2+pad, key:`v${x}`});
      for(let y=startY; y<=endY; y+=step) lines.push({x1:x1-pad, y1:y, x2:x2+pad, y2:y, key:`h${y}`});
      return lines;
  }

  // Zoom/Pan
  const handleWheel = (e: React.WheelEvent) => {
      e.stopPropagation();
      const scaleBy = 1.1;
      const newZoom = e.deltaY < 0 ? viewState.zoom * scaleBy : viewState.zoom / scaleBy;
      setViewState({ zoom: Math.min(Math.max(newZoom, 0.1), 10) });
  };
  const handleMouseDown = (e: React.MouseEvent) => {
      if (e.button === 0 || e.button === 1) { 
          isDragging.current = true;
          lastMouse.current = { x: e.clientX, y: e.clientY };
      }
  };
  const handleMouseMove = (e: React.MouseEvent) => {
      if (isDragging.current && lastMouse.current) {
          const dx = e.clientX - lastMouse.current.x;
          const dy = e.clientY - lastMouse.current.y;
          setViewState({ pan: { x: viewState.pan.x + dx, y: viewState.pan.y + dy } });
          lastMouse.current = { x: e.clientX, y: e.clientY };
      }
  };
  const handleMouseUp = () => { isDragging.current = false; lastMouse.current = null; };

  // CAD STYLES (Rhino Style)
  const getStyles = (type: ElementType, id: string) => {
      const isSelected = id === selectedElementId;
      
      // Default: Black lines on White (or inverted for dark mode)
      let fill = 'none';
      let stroke = '#ffffff';
      let strokeWidth = 1;
      let strokeDash = '0';

      if (type === ElementType.SOLID) {
          // CUT LINE - HEAVY
          fill = isSelected ? 'rgba(59, 210, 61, 0.4)' : 'url(#hatch)';
          stroke = isSelected ? '#3BD23D' : '#ffffff';
          strokeWidth = 3; // 0.35mm equiv
      } else if (type === ElementType.COMPONENT) {
          // PROJECTION LINE - MEDIUM
          fill = isSelected ? 'rgba(59, 210, 61, 0.4)' : 'rgba(20, 20, 20, 0.5)';
          stroke = isSelected ? '#3BD23D' : '#aaaaaa';
          strokeWidth = 1.5; // 0.18mm equiv
      } else if (type === ElementType.VOID) {
          // HIDDEN/OPENING LINE
          fill = 'rgba(255, 0, 0, 0.05)';
          stroke = isSelected ? '#3BD23D' : '#ef4444';
          strokeWidth = 1;
          strokeDash = "4 2";
      }

      return { fill, stroke, strokeWidth, strokeDash };
  };

  return (
    <div 
        ref={containerRef}
        className="w-full h-full bg-[#1e1e1e] relative overflow-hidden flex flex-col select-none cursor-move"
        onWheel={handleWheel}
        onMouseDown={handleMouseDown}
        onMouseMove={handleMouseMove}
        onMouseUp={handleMouseUp}
        onMouseLeave={handleMouseUp}
    >
       {/* UI CONTROLS */}
       <div className="absolute top-4 right-4 z-10 flex flex-col gap-2 items-end">
         <div className="bg-[#2a2a2a] p-3 border border-zinc-700 shadow-xl flex flex-col gap-2 pointer-events-auto">
             <div className="flex items-center justify-between gap-4 text-[9px] font-bold text-zinc-300 uppercase tracking-widest">
                 <span>Grid Snap</span>
                 <input type="checkbox" checked={viewState.showGrid} onChange={e => setViewState({showGrid: e.target.checked})} className="accent-[#3BD23D]" />
             </div>
             {mode === 'PLAN' && (
                 <div className="flex items-center justify-between gap-4 text-[9px] font-bold text-zinc-300 uppercase tracking-widest">
                     <span>Underlay</span>
                     <input type="checkbox" checked={viewState.showBackground} onChange={e => setViewState({showBackground: e.target.checked})} className="accent-[#3BD23D]" />
                 </div>
             )}
         </div>
         {mode === 'PLAN' && viewState.showBackground && (
             <div className="bg-[#2a2a2a] p-3 border border-zinc-700 flex items-center gap-3 pointer-events-auto">
                <span className="text-[9px] font-bold text-zinc-300 uppercase">Opacity</span>
                <input type="range" min="0" max="1" step="0.1" value={opacity} onChange={e => setOpacity(Number(e.target.value))} className="w-20 accent-[#3BD23D] h-1"/>
             </div>
         )}
       </div>

       {/* VIEWPORT */}
       <div className="flex-1 w-full h-full">
           <svg 
                viewBox={viewBox} 
                className="w-full h-full" 
                preserveAspectRatio="xMidYMid meet"
                style={{
                    transform: `translate(${viewState.pan.x}px, ${viewState.pan.y}px) scale(${viewState.zoom})`,
                    transformOrigin: 'center center',
                    transition: isDragging.current ? 'none' : 'transform 0.05s linear'
                }}
            >
                <defs>
                    {/* CAD GRID PATTERN */}
                    <pattern id="grid" width="100" height="100" patternUnits="userSpaceOnUse">
                        <path d="M 100 0 L 0 0 0 100" fill="none" stroke="#333" strokeWidth="0.5"/>
                    </pattern>
                    {/* POCHE HATCH PATTERN (Architectural Concrete) */}
                    <pattern id="hatch" width="8" height="8" patternUnits="userSpaceOnUse" patternTransform="rotate(45)">
                         <line x1="0" y1="0" x2="0" y2="8" stroke="#555" strokeWidth="1" />
                    </pattern>
                </defs>

                {/* BACKGROUND CANVAS */}
                <rect x="-50000" y="-50000" width="100000" height="100000" fill="#1e1e1e" />
                
                {/* GRID SYSTEM */}
                {viewState.showGrid && (
                    <>
                        <rect x="-50000" y="-50000" width="100000" height="100000" fill="url(#grid)" />
                        {/* Axis Lines */}
                        {gridLines.map(l => (
                            <line key={l.key} x1={l.x1} y1={l.y1} x2={l.x2} y2={l.y2} stroke="#333" strokeWidth="1" vectorEffect="non-scaling-stroke" />
                        ))}
                    </>
                )}

                {/* REFERENCE IMAGE */}
                {mode === 'PLAN' && viewState.showBackground && backgroundImage && bgImageBounds && (
                    <image 
                        href={backgroundImage}
                        x={bgImageBounds.x} y={bgImageBounds.y} 
                        width={bgImageBounds.w} height={bgImageBounds.h}
                        opacity={opacity}
                        style={{ filter: 'grayscale(100%) invert(0) contrast(1.2)' }}
                    />
                )}

                {/* GROUND PLANE LINE (Elevation) */}
                {mode === 'ELEVATION' && (
                    <line x1="-10000" y1={viewBox.split(' ')[3].split(' ')[0]} x2="10000" y2={viewBox.split(' ')[3].split(' ')[0]} stroke="#666" strokeWidth="4" vectorEffect="non-scaling-stroke"/>
                )}

                {/* GEOMETRY LAYER */}
                {renderPaths.map(p => {
                    const style = getStyles(p.type, p.id);
                    return (
                        <path 
                            key={p.id} 
                            d={p.d}
                            fill={style.fill}
                            stroke={style.stroke}
                            strokeWidth={style.strokeWidth}
                            strokeDasharray={style.strokeDash}
                            strokeLinecap="round"
                            strokeLinejoin="round"
                            vectorEffect="non-scaling-stroke" // Keep line weights constant despite zoom
                            className="cursor-pointer hover:opacity-80 transition-opacity"
                            onClick={(e) => { e.stopPropagation(); selectElement(p.id); }}
                        />
                    );
                })}
           </svg>
       </div>

       {/* STATUS BAR */}
       <div className="h-6 bg-[#2a2a2a] border-t border-zinc-700 flex items-center px-4 justify-between shrink-0 z-20">
          <div className="text-[9px] font-mono text-zinc-500 uppercase tracking-widest flex items-center gap-2">
             <span className="text-[#3BD23D] font-bold">Rhino-CAD Engine</span>
             <span className="w-[1px] h-3 bg-zinc-600"></span>
             <span>X: {viewState.pan.x.toFixed(0)} Y: {viewState.pan.y.toFixed(0)}</span>
             <span className="w-[1px] h-3 bg-zinc-600"></span>
             <span>Zoom: {(viewState.zoom * 100).toFixed(0)}%</span>
          </div>
          <div className="text-[9px] font-bold text-zinc-400 uppercase tracking-widest">
             {mode} VIEWPORT
          </div>
       </div>
    </div>
  );
};

export default Viewer2D;
