
export type Point = [number, number];

export enum ElementType {
  SOLID = 'solid',      // Positive mass (Walls, Columns, Slabs)
  VOID = 'void',        // Negative space (Windows, Doors, Openings)
  COMPONENT = 'component' // Furniture, Equipment, Loose items
}

export enum ElementForm {
  EXTRUSION = 'extrusion', // Standard sharp edges
  ROUNDED = 'rounded',     // Machined/Filleted edges (NURBS-like)
  PILLOW = 'pillow',       // Inflated/Soft (Cushions, Organic)
  BUBBLE = 'bubble'        // Fully spherical/blob-like
}

export enum MaterialHint {
  CONCRETE = 'concrete',
  CONCRETE_POLISHED = 'concrete_polished',
  WOOD = 'wood',
  WOOD_OAK = 'wood_oak',
  WOOD_WALNUT = 'wood_walnut',
  WOOD_POLISHED = 'wood_polished',
  METAL = 'metal',
  METAL_BRUSHED = 'metal_brushed',
  METAL_CHROME = 'metal_chrome',
  METAL_GOLD = 'metal_gold',
  GLASS = 'glass',
  GLASS_FROSTED = 'glass_frosted',
  GLASS_TINTED = 'glass_tinted',
  FABRIC = 'fabric',
  LEATHER = 'leather',
  VELVET = 'velvet',
  PLASTIC = 'plastic',
  MARBLE = 'marble',
  MARBLE_CARRARA = 'marble_carrara',
  BRICK = 'brick',
  TILES = 'tiles',
  DRYWALL = 'drywall',
  GENERIC = 'generic'
}

export interface DigitalTwinData {
  structuralClass: 'load_bearing' | 'partition' | 'curtain_wall' | 'joinery' | 'furniture' | 'unknown';
  acousticRating?: string; // e.g. "RW 50dB"
  thermalTransmittance?: number; // U-Value (W/m²K)
  embodiedCarbon?: number; // kgCO2e/m² estimation
  costEstimate?: number; // Normalized currency unit
  manufacturer?: string; // AI hallucinated or inferred brand
  description?: string; // Technical spec description
}

export interface ArchElement {
  id: string;
  type: ElementType;
  form?: ElementForm;
  points: Point[]; // Closed polygons
  height?: number; // Vertical thickness
  elevation?: number; // Vertical offset
  label?: string;
  material?: MaterialHint;
  twinData?: DigitalTwinData; // BIM Metadata
}

export interface ArchModel {
  elements: ArchElement[];
  metadata: {
    unit: 'meters' | 'feet';
    scale: number;
    floorHeight: number;
    totalCarbon?: number;
    totalCost?: number;
  };
}

export interface AppError {
  code: string;
  message: string;
}

export interface ImageRevision {
  id: string;
  url: string;
  label: string;
  timestamp: number;
}

export interface LayerVisibility {
  [ElementType.SOLID]: boolean;
  [ElementType.VOID]: boolean;
  [ElementType.COMPONENT]: boolean;
}

export interface ViewState {
  zoom: number;
  pan: { x: number; y: number };
  showGrid: boolean;
  showBackground: boolean;
  cutPlane: number; // For 3D vertical slicing
}

export interface AppState {
  // Data
  image: string | null;
  imageHistory: ImageRevision[];
  generatedViews: string[];
  model: ArchModel | null;
  
  // Selection & UI State
  selectedElementId: string | null;
  layerVisibility: LayerVisibility;
  viewState: ViewState;
  
  // Pipeline Flags
  isProcessing: boolean;       // Global busy state
  isGeneratingViews: boolean;
  isEditingImage: boolean;
  is3DReady: boolean;
  
  // Navigation
  viewMode: '2D' | '3D';
  error: AppError | null;
}
