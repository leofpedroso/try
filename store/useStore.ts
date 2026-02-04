
import { create } from 'zustand';
import { AppState, ArchModel, AppError, ElementType, ImageRevision, MaterialHint } from '../types';

interface StoreActions {
  // Data Setters
  setImage: (image: string | null) => void;
  addImageRevision: (url: string, label: string) => void;
  selectImageRevision: (revisionId: string) => void;
  setGeneratedViews: (views: string[]) => void;
  setModel: (model: ArchModel | null) => void;
  
  // Element Manipulation
  selectElement: (id: string | null) => void;
  updateElementMaterial: (id: string, material: MaterialHint) => void;
  
  // UI & View State
  toggleLayer: (type: ElementType) => void;
  setViewState: (update: Partial<AppState['viewState']>) => void;
  
  // Pipeline Setters
  setIsProcessing: (loading: boolean) => void;
  setIsGeneratingViews: (loading: boolean) => void;
  setIsEditingImage: (loading: boolean) => void;
  setViewMode: (mode: '2D' | '3D') => void;
  setIs3DReady: (ready: boolean) => void;
  setError: (error: AppError | null) => void;
  reset: () => void;
}

const DEFAULT_VIEW_STATE = {
  zoom: 1,
  pan: { x: 0, y: 0 },
  showGrid: true,
  showBackground: true,
  cutPlane: 100 // 100 meters (effectively infinite)
};

const DEFAULT_LAYERS = {
  [ElementType.SOLID]: true,
  [ElementType.VOID]: true,
  [ElementType.COMPONENT]: true,
};

export const useStore = create<AppState & StoreActions>((set, get) => ({
  // Initial State
  image: null,
  imageHistory: [],
  generatedViews: [],
  model: null,
  selectedElementId: null,
  layerVisibility: DEFAULT_LAYERS,
  viewState: DEFAULT_VIEW_STATE,
  isProcessing: false,
  isGeneratingViews: false,
  isEditingImage: false,
  viewMode: '2D',
  is3DReady: false,
  error: null,

  // Actions
  setImage: (image) => {
    set((state) => {
        // If it's a new image (fresh upload), start history
        if (!state.image && image) {
            return { 
                image, 
                imageHistory: [{ id: 'orig', url: image, label: 'Original', timestamp: Date.now() }] 
            };
        }
        return { image };
    });
  },

  addImageRevision: (url, label) => set((state) => ({
    image: url,
    imageHistory: [
        ...state.imageHistory, 
        { id: `rev_${Date.now()}`, url, label, timestamp: Date.now() }
    ]
  })),

  selectImageRevision: (id) => set((state) => {
      const rev = state.imageHistory.find(r => r.id === id);
      return rev ? { image: rev.url } : {};
  }),

  setGeneratedViews: (generatedViews) => set({ generatedViews }),
  setModel: (model) => set({ model }),
  
  selectElement: (selectedElementId) => set({ selectedElementId }),
  
  updateElementMaterial: (id, material) => set((state) => {
      if (!state.model) return {};
      const updatedElements = state.model.elements.map(el => 
          el.id === id ? { ...el, material } : el
      );
      return { model: { ...state.model, elements: updatedElements } };
  }),

  toggleLayer: (type) => set((state) => ({
      layerVisibility: {
          ...state.layerVisibility,
          [type]: !state.layerVisibility[type]
      }
  })),

  setViewState: (update) => set((state) => ({
      viewState: { ...state.viewState, ...update }
  })),

  setIsProcessing: (isProcessing) => set({ isProcessing }),
  setIsGeneratingViews: (isGeneratingViews) => set({ isGeneratingViews }),
  setIsEditingImage: (isEditingImage) => set({ isEditingImage }),
  setViewMode: (viewMode) => set({ viewMode }),
  setIs3DReady: (is3DReady) => set({ is3DReady }),
  setError: (error) => set({ error }),
  
  reset: () => set({ 
      image: null, 
      imageHistory: [],
      model: null, 
      isProcessing: false, 
      error: null, 
      generatedViews: [], 
      is3DReady: false, 
      isEditingImage: false,
      selectedElementId: null,
      layerVisibility: DEFAULT_LAYERS,
      viewState: DEFAULT_VIEW_STATE
  }),
}));
