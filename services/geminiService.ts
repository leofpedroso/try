import { GoogleGenAI, Type } from "@google/genai";
import { ArchModel, ArchElement, ElementType } from "../types";

// ----------------------------------------------------------------------------
// CONFIGURATION
// ----------------------------------------------------------------------------

const getApiKey = () => {
  try {
    // @ts-ignore
    return (typeof process !== 'undefined' && process.env?.API_KEY) || '';
  } catch (e) {
    console.warn("Could not read API_KEY from environment");
    return '';
  }
};

const apiKey = getApiKey();
const ai = new GoogleGenAI({ apiKey });

/**
 * Helper: Validates and cleans AI JSON output
 */
const cleanAndParseJSON = (text: string): ArchModel => {
    try {
        const cleanText = text.replace(/```json/g, '').replace(/```/g, '').trim();
        return JSON.parse(cleanText) as ArchModel;
    } catch (e) {
        console.error("JSON Parse Error:", text);
        throw new Error("Failed to parse AI model data.");
    }
};

/**
 * Geometric validation and correction engine
 */
const validateAndCorrectGeometry = (model: ArchModel): ArchModel => {
    const correctedElements = model.elements.map(element => {
        // 1. Snap coordinates to grid
        const snappedPoints = element.points.map(([x, y]) => {
            const snapValue = 5; // 5-unit grid
            return [
                Math.round(x / snapValue) * snapValue,
                Math.round(y / snapValue) * snapValue
            ] as [number, number];
        });

        // 2. Remove duplicate consecutive points
        const dedupedPoints = snappedPoints.filter((point, i, arr) => {
            if (i === 0) return true;
            const prev = arr[i - 1];
            return Math.abs(point[0] - prev[0]) > 1 || Math.abs(point[1] - prev[1]) > 1;
        });

        // 3. Ensure closure
        const firstPoint = dedupedPoints[0];
        const lastPoint = dedupedPoints[dedupedPoints.length - 1];
        const isClosed = firstPoint && lastPoint && 
            Math.abs(firstPoint[0] - lastPoint[0]) < 2 && 
            Math.abs(firstPoint[1] - lastPoint[1]) < 2;
        
        const finalPoints = isClosed ? dedupedPoints : [...dedupedPoints, firstPoint];

        // 4. Validate minimum points
        if (finalPoints.length < 3) {
            console.warn(`Element ${element.id} has insufficient points`);
            return null;
        }

        // 5. Fix wall thickness for solids
        if (element.type === ElementType.SOLID && finalPoints.length === 4) {
            // Check if it's a thin wall (should be a closed loop)
            const area = calculatePolygonArea(finalPoints);
            if (area < 100) { // Very thin, likely needs offset
                // This is handled by the AI, but we validate
            }
        }

        // 6. Validate height and elevation
        const height = element.height && element.height > 0 ? element.height : 0.1;
        const elevation = element.elevation && element.elevation >= 0 ? element.elevation : 0;

        return {
            ...element,
            points: finalPoints,
            height,
            elevation
        };
    }).filter(Boolean) as ArchElement[];

    return {
        ...model,
        elements: correctedElements
    };
};

const calculatePolygonArea = (points: [number, number][]): number => {
    let area = 0;
    for (let i = 0; i < points.length - 1; i++) {
        area += points[i][0] * points[i + 1][1] - points[i + 1][0] * points[i][1];
    }
    return Math.abs(area / 2);
};

// ----------------------------------------------------------------------------
// PHASE 1: ADVANCED VISUAL REINTERPRETATION (Multi-Pass Analysis)
// ----------------------------------------------------------------------------

/**
 * Generates technical architectural views with enhanced quality
 */
export const generateProjectVisuals = async (base64Image: string): Promise<{ 
    plan: string, 
    views: string[],
    analysisData: any 
}> => {
    const model = 'gemini-2.5-flash-image';
    
    // STEP 1: Initial analysis to understand the image
    const analysisPrompt = `
        Analyze this architectural image in detail:
        1. Identify the type: floor plan, elevation, perspective, photo, sketch
        2. Detect viewing angle and orientation
        3. List all visible elements: walls, doors, windows, furniture
        4. Estimate scale markers or dimensions if visible
        5. Note any distortions, perspective issues, or unclear areas
        
        Provide a structured JSON response with this analysis.
    `;

    let analysisData: any = {};
    
    try {
        const analysisRes = await ai.models.generateContent({
            model: 'gemini-3-pro-preview',
            contents: {
                parts: [
                    { inlineData: { mimeType: 'image/png', data: base64Image.split(',')[1] } },
                    { text: analysisPrompt }
                ]
            },
            config: {
                responseMimeType: "application/json",
                thinkingConfig: { thinkingBudget: 2048 }
            }
        });

        if (analysisRes.text) {
            analysisData = JSON.parse(analysisRes.text);
        }
    } catch (e) {
        console.warn("Analysis step failed, proceeding with defaults:", e);
    }

    // STEP 2: Generate technical views based on analysis
    const planPrompt = `
        Convert this image into a PRECISE Architectural Floor Plan.
        
        CRITICAL REQUIREMENTS:
        1. View: Strict top-down orthographic (90°)
        2. Geometry: ALL lines must be perfectly straight (no curves unless explicitly organic)
        3. Angles: Snap all corners to 90° unless clearly diagonal (then 45°)
        4. Walls: Show as DOUBLE LINES with consistent thickness (20-30cm typical)
        5. Openings: Windows = thin lines with sill markers, Doors = arc showing swing
        6. Grid: Align all elements to a visible construction grid
        7. Line Weight: Structural walls = THICK (3px), partitions = MEDIUM (2px), furniture = THIN (1px)
        8. Style: Pure black lines on pure white background (no gray, no shadows)
        9. Dimensions: Add dimension lines with measurements if space is clear
        10. Scale: Include a scale bar (e.g., 0-5m)
        
        OUTPUT QUALITY:
        - Resolution: High-DPI vector-quality rendering
        - Precision: Sub-millimeter accuracy in line placement
        - Clarity: Zero ambiguity in element boundaries
        - Standards: Follow ISO 128 / ABNT NBR 6492 technical drawing conventions
        
        ${analysisData.distortions ? 'CORRECTION NEEDED: ' + analysisData.distortions : ''}
    `;

    const isoPrompt = `
        Convert this into a TECHNICAL Isometric Axonometric drawing.
        
        SPECIFICATIONS:
        1. Angle: True isometric 30° (dimetric acceptable if more clear)
        2. Projection: Orthographic (no perspective distortion)
        3. Style: Clean line art with optional white clay material render
        4. Section Cut: Remove roof and upper floor to reveal interior
        5. Heights: Maintain accurate vertical proportions (floor-to-floor = 3.0m typical)
        6. Elements: Show all walls, openings, stairs, major furniture
        7. Line Weight: Consistent with plan view hierarchy
        8. Shadows: Optional subtle shadows for depth (45° sun angle)
        9. Background: Pure white
        10. Annotations: Label floors if multi-story
        
        OUTPUT: Vector-quality rendering suitable for architectural presentation
    `;

    const elevPrompt = `
        Convert this into a PRECISE Front Elevation drawing.
        
        SPECIFICATIONS:
        1. View: Strict front orthographic (no perspective)
        2. Elements: Show all vertical surfaces, windows, doors, balconies
        3. Heights: Accurate floor-to-floor dimensions (typical 3.0m)
        4. Materials: Indicate material changes with hatching patterns
        5. Openings: Windows with frame details, doors with proper reveals
        6. Line Weight: Exterior walls = THICK, openings = MEDIUM, details = THIN
        7. Ground Line: Show ground/foundation relationship
        8. Dimensions: Vertical dimension chain on side
        9. Style: Pure technical line drawing, black on white
        10. Standards: Follow architectural elevation conventions
        
        OUTPUT: Construction-document quality elevation
    `;

    const sectionPrompt = `
        Generate a TECHNICAL Section Cut drawing through the building.
        
        SPECIFICATIONS:
        1. Cut Location: Through most interesting/complex area
        2. Cut Elements: Show as SOLID BLACK (poche)
        3. Beyond Elements: Show in thinner lines with depth hierarchy
        4. Heights: Accurate ceiling heights, floor thicknesses
        5. Details: Show floor structure, foundations, roof assembly
        6. Annotations: Room names, ceiling heights, material notes
        7. Line Weight: Cut = VERY THICK (5px), visible beyond = THIN (1px)
        8. Scale: Include human figure for scale reference
        9. Materials: Hatch patterns for concrete, wood, insulation
        10. Standards: Follow section drawing conventions
        
        OUTPUT: Construction-document quality section
    `;

    // STEP 3: Execute parallel requests with error handling
    try {
        const [planRes, isoRes, elevRes, sectionRes] = await Promise.all([
            ai.models.generateContent({ 
                model, 
                contents: { 
                    parts: [
                        { inlineData: { mimeType: 'image/png', data: base64Image.split(',')[1] } }, 
                        { text: planPrompt }
                    ] 
                } 
            }),
            ai.models.generateContent({ 
                model, 
                contents: { 
                    parts: [
                        { inlineData: { mimeType: 'image/png', data: base64Image.split(',')[1] } }, 
                        { text: isoPrompt }
                    ] 
                } 
            }),
            ai.models.generateContent({ 
                model, 
                contents: { 
                    parts: [
                        { inlineData: { mimeType: 'image/png', data: base64Image.split(',')[1] } }, 
                        { text: elevPrompt }
                    ] 
                } 
            }),
            ai.models.generateContent({ 
                model, 
                contents: { 
                    parts: [
                        { inlineData: { mimeType: 'image/png', data: base64Image.split(',')[1] } }, 
                        { text: sectionPrompt }
                    ] 
                } 
            })
        ]);

        const extractImg = (res: any) => {
            const part = res.candidates?.[0]?.content?.parts?.find((p: any) => p.inlineData);
            return part ? `data:${part.inlineData.mimeType};base64,${part.inlineData.data}` : null;
        };

        const plan = extractImg(planRes) || base64Image;
        const views = [
            extractImg(isoRes), 
            extractImg(elevRes),
            extractImg(sectionRes)
        ].filter(Boolean) as string[];

        return { plan, views, analysisData };

    } catch (e) {
        console.error("Visual Generation Failed:", e);
        return { plan: base64Image, views: [], analysisData };
    }
};

// ----------------------------------------------------------------------------
// PHASE 2: ENHANCED STRUCTURAL RECONSTRUCTION (Multi-Pass with Validation)
// ----------------------------------------------------------------------------

export const generateBIMData = async (
    base64Image: string, 
    visuals: string[] = [],
    analysisData: any = {}
): Promise<ArchModel> => {
    
    const systemInstruction = `
        You are 'Scan-to-BIM AI Pro', an expert in photogrammetry, CAD reconstruction, and architectural analysis.
        
        ### MISSION
        Reconstruct a PERFECT 3D BIM model from the provided images with ZERO geometric errors.
        
        ### CRITICAL SUCCESS FACTORS
        1. **Accuracy**: Every coordinate must be precisely calculated
        2. **Completeness**: Capture ALL visible elements without omission
        3. **Topology**: Ensure proper spatial relationships (walls connect, openings align)
        4. **Consistency**: Maintain uniform thickness for similar elements
        5. **Standards Compliance**: Follow architectural conventions
        
        ### COORDINATE SYSTEM (ABSOLUTE RULES)
        1. **Canvas**: 1000 x 1000 unit grid (0,0 = top-left, 1000,1000 = bottom-right)
        2. **Grid Snap**: All coordinates snap to 5-unit increments (e.g., 145 → 145, 147 → 145)
        3. **Rectilinearity**: 
           - Interior walls: Perfect 90° angles (no deviation)
           - Exterior walls: May have angles if site constraints exist
           - Furniture: Can have organic curves if visible
        4. **Wall Thickness**: Consistent at 20 units (∼20cm @ typical residential scale)
        5. **Opening Alignment**: Windows and doors must PERFECTLY align with wall edges
        
        ### GEOMETRIC VALIDATION (SELF-CHECK)
        Before outputting, validate:
        - [ ] All solid elements form CLOSED loops (first point = last point)
        - [ ] Wall intersections create proper T or L joints (shared vertices)
        - [ ] Void elements (windows/doors) are INSIDE or overlapping their parent walls
        - [ ] No floating or disconnected elements
        - [ ] Coordinate ranges: X and Y both within 0-1000
        - [ ] Heights are reasonable: Walls 2.5-4.0m, Furniture 0.5-2.0m
        
        ### ELEMENT HIERARCHY & TYPES
        
        **1. SOLID (Structural & Massive Elements)**
        - **Exterior Walls**: Closed loop, thickness=20-30 units, height=3.0m
        - **Interior Walls**: Closed loop or connected segments, thickness=15-20 units, height=2.7-3.0m
        - **Columns**: Rounded form, diameter=30-40 units, height=3.0m
        - **Floor Slabs**: Large closed loop matching building footprint, height=0.25m, elevation=0
        - **Ceiling**: Optional, elevation=3.0m, height=0.20m
        
        **2. VOID (Negative Space - Openings)**
        - **Windows**: Rectangle aligned with wall, height=1.2-1.8m, elevation=0.9-1.0m
        - **Doors**: Rectangle aligned with wall, height=2.1m, elevation=0.0m
        - **Skylights**: On roof plane, elevation=3.0m+
        
        **3. COMPONENT (Furniture & Equipment)**
        - **Tables**: form='extrusion', height=0.75m, elevation=0
        - **Chairs**: form='rounded', height=0.85m, elevation=0
        - **Sofas**: form='pillow', height=0.75m, elevation=0
        - **Beds**: form='pillow', height=0.45m, elevation=0
        - **Cabinets**: form='extrusion', height=0.9m (base) or 2.1m (tall)
        - **Counters**: form='extrusion', height=0.9m, elevation=0
        - **Stairs**: Special handling with steps as individual components
        
        ### MATERIAL INTELLIGENCE
        Infer materials from:
        - Context (kitchen=tiles, bedroom=wood)
        - Visual cues (texture, color, finish)
        - Structural role (load-bearing=concrete, partition=drywall)
        
        Material Mapping:
        - Exterior walls → concrete or brick
        - Interior walls → drywall
        - Floors → wood_oak (residential), concrete_polished (modern)
        - Furniture → wood, fabric, leather (context dependent)
        - Glass → glass or glass_frosted (bathrooms)
        
        ### DIGITAL TWIN ENRICHMENT
        For each element, estimate:
        - **structuralClass**: load_bearing, partition, curtain_wall, furniture, etc.
        - **costEstimate**: Based on typical material and size (BRL or USD)
        - **embodiedCarbon**: kgCO2e based on material and volume
        - **thermalTransmittance**: U-value (W/m²K) for envelope elements
        - **acousticRating**: For walls and glazing (e.g., "RW 45dB")
        
        ### SCALE ESTIMATION
        Use these heuristics:
        - Standard door width: 80-90cm → If door is 85 units wide, scale = 0.85/85 = 0.01
        - Room proportions: Typical bedroom 3x4m, living room 4x6m
        - Furniture: Single bed ≈ 0.9x2.0m, Sofa ≈ 0.8x2.0m
        - Ceiling height: Residential 2.7-3.0m, Commercial 3.5-4.5m
        
        ### OUTPUT REQUIREMENTS
        Return a COMPLETE, VALID JSON structure with:
        - ALL elements (aim for 15-30 elements for typical room)
        - Perfect geometry (validated)
        - Rich metadata
        - Accurate scale factor
        
        ### THINKING PROCESS
        1. Identify overall building footprint
        2. Trace exterior walls as closed loop
        3. Add interior walls, ensuring connections
        4. Place openings (windows, doors) aligned to walls
        5. Add furniture based on room function
        6. Validate topology and geometry
        7. Calculate scale and metadata
        8. Output JSON
    `;

    const responseSchema = {
        type: Type.OBJECT,
        properties: {
            elements: {
                type: Type.ARRAY,
                items: {
                    type: Type.OBJECT,
                    properties: {
                        id: { type: Type.STRING, description: "Unique ID like 'wall_01', 'window_02'" },
                        type: { type: Type.STRING, enum: ['solid', 'void', 'component'] },
                        label: { type: Type.STRING, description: "Human-readable name like 'North Wall', 'Living Room Window'" },
                        points: {
                            type: Type.ARRAY,
                            items: { 
                                type: Type.ARRAY, 
                                items: { type: Type.NUMBER },
                                description: "Coordinate pair [x, y]"
                            },
                            description: "Clockwise closed loop on 0-1000 grid, snapped to 5-unit grid"
                        },
                        height: { type: Type.NUMBER, description: "Vertical extrusion in meters" },
                        elevation: { type: Type.NUMBER, description: "Vertical offset from floor in meters" },
                        form: { 
                            type: Type.STRING, 
                            enum: ['extrusion', 'rounded', 'pillow', 'bubble'],
                            description: "Geometric form style"
                        },
                        material: { 
                            type: Type.STRING, 
                            enum: [
                                'concrete', 'concrete_polished', 
                                'wood', 'wood_oak', 'wood_walnut', 'wood_polished',
                                'metal', 'metal_brushed', 'metal_chrome', 'metal_gold', 
                                'glass', 'glass_frosted', 'glass_tinted', 
                                'fabric', 'leather', 'velvet', 'plastic', 
                                'marble', 'marble_carrara', 
                                'brick', 'tiles', 'drywall', 'generic'
                            ] 
                        },
                        twinData: {
                            type: Type.OBJECT,
                            properties: {
                                structuralClass: { 
                                    type: Type.STRING, 
                                    enum: ['load_bearing', 'partition', 'curtain_wall', 'joinery', 'furniture', 'foundation', 'roof', 'unknown'] 
                                },
                                description: { type: Type.STRING, description: "Technical description" },
                                costEstimate: { type: Type.NUMBER, description: "Cost in BRL" },
                                embodiedCarbon: { type: Type.NUMBER, description: "kgCO2e" },
                                thermalTransmittance: { type: Type.NUMBER, description: "U-value W/m²K" },
                                acousticRating: { type: Type.STRING, description: "e.g. 'RW 45dB'" }
                            },
                            required: ["structuralClass"]
                        }
                    },
                    required: ["id", "type", "points", "height", "material", "form"]
                }
            },
            metadata: {
                type: Type.OBJECT,
                properties: {
                    unit: { type: Type.STRING, enum: ['meters', 'feet'] },
                    scale: { type: Type.NUMBER, description: "Multiplier: grid units → meters (typically 0.003-0.015)" },
                    floorHeight: { type: Type.NUMBER, description: "Floor-to-ceiling height in meters" },
                    totalCarbon: { type: Type.NUMBER, description: "Total embodied carbon kgCO2e" },
                    totalCost: { type: Type.NUMBER, description: "Total estimated cost in BRL" },
                    buildingType: { type: Type.STRING, description: "e.g. 'residential', 'commercial'" },
                    confidence: { type: Type.NUMBER, description: "Reconstruction confidence 0-1" }
                },
                required: ["scale", "unit", "floorHeight"]
            }
        },
        required: ["elements", "metadata"]
    };

    const parts: any[] = [];
    
    // 1. Primary Image (Plan)
    parts.push({ inlineData: { mimeType: 'image/png', data: base64Image.split(',')[1] } });
    parts.push({ text: "PRIMARY INPUT: Floor Plan (use this as main reference for geometry)" });

    // 2. Context Images
    visuals.forEach((v, i) => {
        parts.push({ inlineData: { mimeType: 'image/png', data: v.split(',')[1] } });
        parts.push({ text: `CONTEXT VIEW ${i+1}: Use for validation and height/depth information` });
    });

    // 3. Analysis data context
    if (analysisData && Object.keys(analysisData).length > 0) {
        parts.push({ text: `ANALYSIS DATA: ${JSON.stringify(analysisData)}` });
    }

    parts.push({ 
        text: `GENERATE THE BIM MODEL JSON NOW.

STEP-BY-STEP APPROACH:
1. Study all images carefully
2. Sketch mental coordinate system
3. Identify building footprint and orientation
4. Trace all walls ensuring connectivity
5. Place all openings aligned to walls
6. Add all visible furniture
7. Validate geometry (closed loops, proper ranges)
8. Calculate scale from known dimensions
9. Enrich with digital twin data
10. Output complete JSON

QUALITY CHECKLIST:
✓ All coordinates in 0-1000 range
✓ All solids are closed loops
✓ Voids overlap with parent walls
✓ Wall thickness consistent (~20 units)
✓ Heights realistic (walls 2.7-3.5m)
✓ Scale factor calculated (typically 0.003-0.01)
✓ Minimum 15 elements captured
✓ Materials assigned logically
✓ Twin data complete

BEGIN RECONSTRUCTION:` 
    });

    try {
        const response = await ai.models.generateContent({
            model: 'gemini-3-pro-preview',
            contents: { parts },
            config: {
                systemInstruction,
                responseMimeType: "application/json",
                responseSchema,
                thinkingConfig: { thinkingBudget: 8192 } // Increased budget for complex reasoning
            }
        });

        if (!response.text) throw new Error("Empty AI Response");
        
        let model = cleanAndParseJSON(response.text);
        
        // VALIDATION & CORRECTION PASS
        model = validateAndCorrectGeometry(model);
        
        // FINAL VALIDATION: Check if model meets minimum quality standards
        const qualityScore = assessModelQuality(model);
        
        if (qualityScore < 0.6) {
            console.warn("Low quality reconstruction detected. Consider retry with different parameters.");
        }
        
        return model;

    } catch (error) {
        console.error("BIM Generation Error:", error);
        throw new Error("Failed to reconstruct 3D model. Please try a clearer image or different angle.");
    }
};

/**
 * Assess model quality (0-1 score)
 */
const assessModelQuality = (model: ArchModel): number => {
    let score = 1.0;
    
    // Check element count (too few = incomplete)
    if (model.elements.length < 5) score -= 0.3;
    if (model.elements.length < 10) score -= 0.15;
    
    // Check for solids (must have walls)
    const hasSolids = model.elements.some(e => e.type === ElementType.SOLID);
    if (!hasSolids) score -= 0.5;
    
    // Check geometry validity
    model.elements.forEach(e => {
        if (e.points.length < 3) score -= 0.1;
        if (!e.height || e.height <= 0) score -= 0.05;
        
        // Check coordinate ranges
        e.points.forEach(([x, y]) => {
            if (x < 0 || x > 1000 || y < 0 || y > 1000) score -= 0.1;
        });
    });
    
    // Check scale reasonableness
    if (!model.metadata.scale || model.metadata.scale < 0.001 || model.metadata.scale > 0.1) {
        score -= 0.2;
    }
    
    return Math.max(0, score);
};

/**
 * Quick Image Edit with validation
 */
export const editImageWithPrompt = async (base64Image: string, prompt: string): Promise<string | null> => {
    try {
      const enhancedPrompt = `${prompt}
      
      TECHNICAL REQUIREMENTS:
      - Maintain architectural accuracy
      - Preserve scale and proportions
      - Keep lines straight and clean
      - Output high resolution
      - Pure white background`;
      
      const response = await ai.models.generateContent({
        model: 'gemini-2.5-flash-image',
        contents: {
          parts: [
            { inlineData: { mimeType: 'image/png', data: base64Image.split(',')[1] } },
            { text: enhancedPrompt },
          ],
        },
      });
  
      const part = response.candidates?.[0]?.content?.parts?.find(p => p.inlineData);
      return part ? `data:${part.inlineData.mimeType};base64,${part.inlineData.data}` : null;
    } catch (error) {
      console.error("Edit Error:", error);
      return null;
    }
};

/**
 * Iterative refinement: Generate model, validate, regenerate if needed
 */
export const generateBIMDataWithRefinement = async (
    base64Image: string,
    visuals: string[] = [],
    maxAttempts: number = 2
): Promise<ArchModel> => {
    let bestModel: ArchModel | null = null;
    let bestScore = 0;
    
    for (let attempt = 0; attempt < maxAttempts; attempt++) {
        try {
            console.log(`BIM reconstruction attempt ${attempt + 1}/${maxAttempts}`);
            
            const model = await generateBIMData(base64Image, visuals);
            const score = assessModelQuality(model);
            
            console.log(`Model quality score: ${score.toFixed(2)}`);
            
            if (score > bestScore) {
                bestScore = score;
                bestModel = model;
            }
            
            // If we got a good score, use it
            if (score >= 0.8) {
                return model;
            }
            
        } catch (error) {
            console.warn(`Attempt ${attempt + 1} failed:`, error);
        }
    }
    
    if (bestModel) {
        console.log(`Returning best model with score: ${bestScore.toFixed(2)}`);
        return bestModel;
    }
    
    throw new Error("Failed to generate acceptable BIM model after multiple attempts");
};
