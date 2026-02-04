
import React, { useMemo, useRef, useState, useEffect } from 'react';
import { Canvas } from '@react-three/fiber';
import { OrbitControls, PerspectiveCamera, Center, MeshTransmissionMaterial, Grid, Environment, ContactShadows } from '@react-three/drei';
import * as THREE from 'three';
import { ArchModel, ElementType, ElementForm, MaterialHint } from '../types';
import { useStore } from '../store/useStore';
import { geometryEngine } from '../services/geometryEngine';

// Robust type augmentation to fix JSX.IntrinsicElements errors for R3F elements
declare global {
  namespace JSX {
    interface IntrinsicElements {
      mesh: any;
      group: any;
      meshStandardMaterial: any;
      meshPhysicalMaterial: any;
      planeGeometry: any;
      shadowMaterial: any;
      primitive: any;
      ambientLight: any;
      directionalLight: any;
    }
  }
  namespace React {
    namespace JSX {
        interface IntrinsicElements {
            mesh: any;
            group: any;
            meshStandardMaterial: any;
            meshPhysicalMaterial: any;
            planeGeometry: any;
            shadowMaterial: any;
            primitive: any;
            ambientLight: any;
            directionalLight: any;
        }
    }
  }
}

interface Viewer3DProps {
  model: ArchModel;
}

// ------------------------------------------------------------------
// ADVANCED MATERIAL EMULATION
// ------------------------------------------------------------------
const SmartMaterial: React.FC<{ hint?: MaterialHint; color?: string; selected?: boolean }> = React.memo(({ hint, color, selected }) => {
  const baseColor = selected ? "#3BD23D" : (color || "#ffffff");
  const emissive = selected ? "#114411" : "#000000";

  if (selected) {
       return <meshPhysicalMaterial color={baseColor} emissive={emissive} roughness={0.3} metalness={0.1} clearcoat={1} />;
  }

  switch (hint) {
    case MaterialHint.METAL_CHROME: return <meshPhysicalMaterial color="#ffffff" metalness={1.0} roughness={0.02} clearcoat={1.0} />;
    case MaterialHint.METAL_BRUSHED: return <meshPhysicalMaterial color="#dddddd" metalness={0.9} roughness={0.35} clearcoat={0.2} />;
    case MaterialHint.METAL_GOLD: return <meshPhysicalMaterial color="#FFD700" metalness={1.0} roughness={0.1} clearcoat={0.5} />;
    
    case MaterialHint.GLASS: return <MeshTransmissionMaterial backside samples={8} thickness={0.02} roughness={0.01} chromaticAberration={0.03} anisotropy={0.1} color="#f0faff" transmission={0.99} />;
    case MaterialHint.GLASS_FROSTED: return <MeshTransmissionMaterial samples={8} thickness={0.05} roughness={0.4} transmission={0.85} color="#ffffff" />;
    case MaterialHint.GLASS_TINTED: return <MeshTransmissionMaterial samples={8} thickness={0.02} roughness={0.01} color="#223344" transmission={0.95} />;

    case MaterialHint.WOOD_POLISHED: return <meshPhysicalMaterial color="#5c4033" roughness={0.1} clearcoat={0.6} />;
    case MaterialHint.WOOD: 
    case MaterialHint.WOOD_OAK: return <meshStandardMaterial color="#c2b280" roughness={0.7} />;
    case MaterialHint.WOOD_WALNUT: return <meshStandardMaterial color="#4a3b32" roughness={0.6} />;
    
    case MaterialHint.LEATHER: return <meshPhysicalMaterial color="#222222" roughness={0.5} clearcoat={0.2} normalScale={new THREE.Vector2(0.5, 0.5)} />;
    case MaterialHint.VELVET: return <meshPhysicalMaterial color="#550000" roughness={0.9} sheen={1.0} sheenColor="#ffaaaa" />;
    case MaterialHint.PLASTIC: return <meshPhysicalMaterial color={baseColor} roughness={0.2} metalness={0.0} clearcoat={0.5} />;
    
    case MaterialHint.MARBLE: 
    case MaterialHint.MARBLE_CARRARA: return <meshPhysicalMaterial color="#fcfcfc" roughness={0.05} metalness={0.1} clearcoat={1.0} />;
    
    case MaterialHint.CONCRETE: return <meshStandardMaterial color="#d4d4d4" roughness={0.95} />;
    case MaterialHint.CONCRETE_POLISHED: return <meshPhysicalMaterial color="#bbbbbb" roughness={0.3} clearcoat={0.4} />;
    
    case MaterialHint.BRICK: return <meshStandardMaterial color="#a05544" roughness={0.9} />;
    case MaterialHint.DRYWALL: return <meshStandardMaterial color="#eeeeee" roughness={0.9} />;
    
    default: return <meshPhysicalMaterial color={baseColor} roughness={0.5} metalness={0.1} />;
  }
});

// ------------------------------------------------------------------
// THREADED GEOMETRY COMPONENT
// ------------------------------------------------------------------
const ArchitecturalPart: React.FC<{ el: any, offset: THREE.Vector3, scaleFactor: number, onSelect: (id: string) => void, isSelected: boolean }> = React.memo(({ el, offset, scaleFactor, onSelect, isSelected }) => {
  const [geometry, setGeometry] = useState<THREE.BufferGeometry | null>(null);
  const mounted = useRef(true);

  useEffect(() => {
    mounted.current = true;
    
    // 1. Instant: Generate Low-Poly Proxy synchronously on main thread
    const proxy = geometryEngine.generateProxy({
        points: el.points,
        height: el.height,
        elevation: el.elevation,
        type: el.type,
        offset,
        scaleFactor
    });
    setGeometry(proxy);

    // 2. Enhance: Request High-Poly mesh from Worker
    geometryEngine.requestGeometry({
        id: el.id,
        points: el.points,
        form: el.form,
        type: el.type,
        height: el.height,
        elevation: el.elevation,
        offset,
        scaleFactor
    }, 'high').then((highPoly) => {
        if (mounted.current) {
            setGeometry(highPoly);
        }
    }).catch(err => {
        console.warn("Worker mesh gen failed, falling back to proxy", err);
    });

    return () => { mounted.current = false; };
  }, [el.points, el.form, el.height, el.elevation, offset, scaleFactor, el.type]);

  if (!geometry) return null;

  return (
    <mesh 
        geometry={geometry} 
        castShadow 
        receiveShadow 
        onClick={(e) => { e.stopPropagation(); onSelect(el.id); }}
    >
       <SmartMaterial hint={el.material} color={el.type === ElementType.SOLID ? '#ffffff' : '#e0e0e0'} selected={isSelected} />
    </mesh>
  );
});

const Viewer3D: React.FC<Viewer3DProps> = ({ model }) => {
  const { 
    selectedElementId, selectElement, 
    layerVisibility, viewState, setViewState 
  } = useStore();
  
  const controlsRef = useRef<any>(null);
  const cameraRef = useRef<any>(null);

  const { offset, validElements, scaleFactor } = useMemo(() => {
    if (!model.elements.length) return { offset: new THREE.Vector3(), validElements: [], scaleFactor: 1 };
    
    const allPoints = model.elements.flatMap(e => e.points);
    const xs = allPoints.map(p => p[0]);
    const ys = allPoints.map(p => p[1]);
    const minX = Math.min(...xs); const maxX = Math.max(...xs);
    const minY = Math.min(...ys); const maxY = Math.max(...ys);
    
    const maxGridDim = Math.max(maxX - minX, maxY - minY);
    const TARGET_SCENE_SIZE_METERS = 20; 
    const scale = TARGET_SCENE_SIZE_METERS / (maxGridDim || 1000); 
    
    const centerX = ((minX + maxX) / 2) * scale;
    const centerZ = ((minY + maxY) / 2) * scale;
    const centerOffset = new THREE.Vector3(centerX, 0, centerZ);

    return { offset: centerOffset, validElements: model.elements, scaleFactor: scale };
  }, [model]);

  const setCameraView = (view: 'ISO' | 'TOP' | 'FRONT') => {
      if (!controlsRef.current || !cameraRef.current) return;
      const controls = controlsRef.current;
      const camera = cameraRef.current;
      controls.reset();
      
      if (view === 'TOP') {
          camera.position.set(0, 30, 0);
          controls.target.set(0, 0, 0);
      } else if (view === 'FRONT') {
          camera.position.set(0, 2, 30);
          controls.target.set(0, 2, 0);
      } else {
          camera.position.set(20, 20, 20);
          controls.target.set(0, 0, 0);
      }
      controls.update();
  };

  return (
    <div className="w-full h-full bg-[#e8e8e8] relative">
      <div className="absolute top-4 right-4 z-10 flex flex-col gap-2 items-end">
         <div className="bg-white/90 p-2 shadow-sm border border-zinc-200 flex gap-1 pointer-events-auto rounded-sm">
             {['ISO', 'TOP', 'FRONT'].map(v => (
                 <button key={v} onClick={() => setCameraView(v as any)} className="w-10 h-8 text-[9px] font-bold text-zinc-600 border border-zinc-200 hover:bg-zinc-100 uppercase tracking-wider">{v}</button>
             ))}
         </div>

         <div className="bg-white/90 p-3 shadow-sm border border-zinc-200 pointer-events-auto min-w-[150px] rounded-sm">
             <div className="flex justify-between mb-1 text-[9px] font-bold uppercase text-zinc-500">
                 <span>Z-Cut Plane</span>
                 <span>{viewState.cutPlane}m</span>
             </div>
             <input 
                type="range" 
                min="0" max="10" step="0.5" 
                value={viewState.cutPlane} 
                onChange={e => setViewState({ cutPlane: Number(e.target.value) })}
                className="w-full accent-[#3BD23D] h-1"
             />
         </div>
      </div>

      <Canvas shadows gl={{ antialias: true, toneMapping: THREE.ACESFilmicToneMapping, toneMappingExposure: 1.2 }} dpr={[1, 1.5]}>
        <PerspectiveCamera ref={cameraRef} makeDefault position={[20, 20, 20]} fov={25} />
        
        <Environment preset="city" environmentIntensity={0.5} />
        <ambientLight intensity={0.6} color="#ffffff" />
        <directionalLight 
            position={[15, 25, 15]} 
            intensity={1.5} 
            castShadow 
            shadow-bias={-0.0001}
            shadow-mapSize={[2048, 2048]} 
        />
        
        <ContactShadows position={[0, -0.01, 0]} opacity={0.4} scale={40} blur={2} far={4} color="#000000" />

        <group position={[0, 0, 0]}>
            <Center top>
                <group>
                    {validElements.map((el, i) => {
                        if (!layerVisibility[el.type]) return null;
                        if ((el.elevation || 0) > viewState.cutPlane) return null;

                        return (
                            <ArchitecturalPart 
                                key={el.id || i} 
                                el={el} 
                                offset={offset} 
                                scaleFactor={scaleFactor}
                                onSelect={selectElement}
                                isSelected={selectedElementId === el.id}
                            />
                        );
                    })}
                </group>
            </Center>
            
            <Grid 
                position={[0, -0.02, 0]} 
                args={[40, 40]} 
                cellSize={1} 
                cellThickness={0.5} 
                cellColor="#bbbbbb" 
                sectionSize={5} 
                sectionThickness={1} 
                sectionColor="#999999" 
                infiniteGrid 
                fadeDistance={40} 
            />
        </group>

        <OrbitControls 
            ref={controlsRef} 
            makeDefault 
            minDistance={2} 
            maxDistance={80} 
            target={[0, 0, 0]} 
            enableDamping={true}
            dampingFactor={0.1}
        />
      </Canvas>
    </div>
  );
};

export default Viewer3D;
