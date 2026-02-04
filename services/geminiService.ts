
import { GoogleGenAI, Type } from "@google/genai";
import { ArchModel } from "../types";

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
        // Remove markdown code blocks if present
        const cleanText = text.replace(/```json/g, '').replace(/```/g, '').trim();
        return JSON.parse(cleanText) as ArchModel;
    } catch (e) {
        console.error("JSON Parse Error:", text);
        throw new Error("Failed to parse AI model data.");
    }
};

// ----------------------------------------------------------------------------
// PHASE 1: VISUAL REINTERPRETATION (Image -> Design Pack)
// ----------------------------------------------------------------------------

/**
 * Generates a set of technical views (Plan, Elevation, Isometric) based on the input.
 */
export const generateProjectVisuals = async (base64Image: string): Promise<{ plan: string, views: string[] }> => {
    const model = 'gemini-2.5-flash-image';
    
    // 1. Define Prompts
    const planPrompt = `
        Convert this image into a strict, high-contrast Architectural Floor Plan.
        Style: Blueprint / CAD.
        View: Top-Down Orthographic (90 degrees).
        Details: Clear walls (black), windows (thin lines), furniture (outlined).
        Background: Pure White.
        Correction: Straighten all lines to 90 degrees.
    `;

    const isoPrompt = `
        Convert this image into an Architectural Isometric Axonometric drawing.
        Style: Clean Line Art / White Clay Render.
        View: Isometric 45 degrees.
        Details: Show volume and height. Cutaway roof to show interior.
        Background: Pure White.
    `;

    const elevPrompt = `
        Convert this image into a flat Architectural Front Elevation drawing.
        Style: Technical Line Drawing.
        View: Front Orthographic.
        Details: Show vertical heights, windows, and doors relative to floor.
        Background: Pure White.
    `;

    // 2. Execute Parallel Requests
    try {
        const [planRes, isoRes, elevRes] = await Promise.all([
            ai.models.generateContent({ model, contents: { parts: [{ inlineData: { mimeType: 'image/png', data: base64Image.split(',')[1] } }, { text: planPrompt }] } }),
            ai.models.generateContent({ model, contents: { parts: [{ inlineData: { mimeType: 'image/png', data: base64Image.split(',')[1] } }, { text: isoPrompt }] } }),
            ai.models.generateContent({ model, contents: { parts: [{ inlineData: { mimeType: 'image/png', data: base64Image.split(',')[1] } }, { text: elevPrompt }] } }),
        ]);

        const extractImg = (res: any) => {
            const part = res.candidates?.[0]?.content?.parts?.find((p: any) => p.inlineData);
            return part ? `data:${part.inlineData.mimeType};base64,${part.inlineData.data}` : null;
        };

        const plan = extractImg(planRes) || base64Image;
        const views = [extractImg(isoRes), extractImg(elevRes)].filter(Boolean) as string[];

        return { plan, views };

    } catch (e) {
        console.error("Visual Generation Failed:", e);
        // Fallback: Just use original image
        return { plan: base64Image, views: [] };
    }
};

// ----------------------------------------------------------------------------
// PHASE 2: STRUCTURAL RECONSTRUCTION (Image -> BIM Data)
// ----------------------------------------------------------------------------

export const generateBIMData = async (base64Image: string, visuals: string[] = []): Promise<ArchModel> => {
    
    const systemInstruction = `
        You are 'Scan-to-BIM AI', an expert in architectural photogrammetry and reverse engineering.
        
        ### MISSION
        Reconstruct the 3D BIM geometry from the provided 2D image.
        Output a strict JSON data structure representing the walls, floors, windows, and furniture.

        ### COORDINATE SYSTEM RULES (CRITICAL)
        1.  **Canvas**: Map the image to a **1000 x 1000** coordinate grid.
            -   (0,0) is Top-Left.
            -   (1000,1000) is Bottom-Right.
        2.  **Rectilinearity**: 
            -   Most architectural lines are 90 degrees.
            -   Snap coordinates to the nearest 10 units (e.g., 123 -> 120).
            -   Ensure walls have consistent thickness (e.g., 20 units).

        ### ELEMENT TYPES
        1.  **'solid'**:
            -   Structural Walls (Must be CLOSED LOOPS with thickness).
            -   Columns (Round or Square).
            -   Floor Slabs.
        2.  **'void'**:
            -   Windows and Door openings.
            -   These shapes should overlap or be inside the 'solid' walls.
        3.  **'component'**:
            -   Furniture (Tables, Chairs, Beds).
            -   Millwork (Counters, Cabinets).

        ### ATTRIBUTES
        -   **Height**: Vertical extrusion in meters (e.g., Walls = 3.0, Tables = 0.75).
        -   **Elevation**: Vertical offset from floor (e.g., Walls = 0, Windows = 0.9).
        -   **Form**: 'extrusion' (default), 'rounded' (columns), 'pillow' (sofas).
        -   **Material**: Infer from context (e.g., 'wood_oak', 'concrete', 'glass').

        ### METADATA
        -   Estimate the real-world scale (e.g., if the room looks like a 4m wide bedroom, the scale factor for the 1000px grid is 0.004).
        -   Estimate embodied carbon and cost based on materials.
    `;

    // Schema definition for strictly typed output
    const responseSchema = {
        type: Type.OBJECT,
        properties: {
            elements: {
                type: Type.ARRAY,
                items: {
                    type: Type.OBJECT,
                    properties: {
                        id: { type: Type.STRING },
                        type: { type: Type.STRING, enum: ['solid', 'void', 'component'] },
                        label: { type: Type.STRING },
                        points: {
                            type: Type.ARRAY,
                            items: { type: Type.ARRAY, items: { type: Type.NUMBER } },
                            description: "Clockwise list of [x, y] coordinates on 0-1000 grid."
                        },
                        height: { type: Type.NUMBER },
                        elevation: { type: Type.NUMBER },
                        form: { type: Type.STRING, enum: ['extrusion', 'rounded', 'pillow', 'bubble'] },
                        material: { 
                            type: Type.STRING, 
                            enum: [
                                'concrete', 'concrete_polished', 'wood', 'wood_oak', 'wood_walnut', 'wood_polished',
                                'metal', 'metal_brushed', 'metal_chrome', 'metal_gold', 
                                'glass', 'glass_frosted', 'glass_tinted', 
                                'fabric', 'leather', 'velvet', 'plastic', 
                                'marble', 'marble_carrara', 'brick', 'tiles', 'drywall', 'generic'
                            ] 
                        },
                        twinData: {
                            type: Type.OBJECT,
                            properties: {
                                structuralClass: { type: Type.STRING, enum: ['load_bearing', 'partition', 'curtain_wall', 'joinery', 'furniture', 'unknown'] },
                                description: { type: Type.STRING },
                                costEstimate: { type: Type.NUMBER },
                                embodiedCarbon: { type: Type.NUMBER },
                                thermalTransmittance: { type: Type.NUMBER },
                                acousticRating: { type: Type.STRING }
                            }
                        }
                    },
                    required: ["id", "type", "points", "height", "material"]
                }
            },
            metadata: {
                type: Type.OBJECT,
                properties: {
                    unit: { type: Type.STRING },
                    scale: { type: Type.NUMBER, description: "Multiplier to convert grid units to meters" },
                    floorHeight: { type: Type.NUMBER },
                    totalCarbon: { type: Type.NUMBER },
                    totalCost: { type: Type.NUMBER }
                },
                required: ["scale", "unit"]
            }
        },
        required: ["elements", "metadata"]
    };

    const parts: any[] = [];
    
    // 1. Primary Image (Plan)
    parts.push({ inlineData: { mimeType: 'image/png', data: base64Image.split(',')[1] } });
    parts.push({ text: "Primary Input: Floor Plan" });

    // 2. Context Images
    visuals.forEach((v, i) => {
        parts.push({ inlineData: { mimeType: 'image/png', data: v.split(',')[1] } });
        parts.push({ text: `Context View ${i+1}` });
    });

    parts.push({ text: "Generate the BIM Model JSON. Plan the coordinate system carefully first." });

    try {
        const response = await ai.models.generateContent({
            model: 'gemini-3-pro-preview',
            contents: { parts },
            config: {
                systemInstruction,
                responseMimeType: "application/json",
                responseSchema,
                // Balanced thinking budget for spatial reasoning
                thinkingConfig: { thinkingBudget: 4096 } 
            }
        });

        if (!response.text) throw new Error("Empty AI Response");
        
        return cleanAndParseJSON(response.text);

    } catch (error) {
        console.error("BIM Generation Error:", error);
        throw new Error("Failed to reconstruct 3D model.");
    }
};

/**
 * Quick Image Edit
 */
export const editImageWithPrompt = async (base64Image: string, prompt: string): Promise<string | null> => {
    try {
      const response = await ai.models.generateContent({
        model: 'gemini-2.5-flash-image',
        contents: {
          parts: [
            { inlineData: { mimeType: 'image/png', data: base64Image.split(',')[1] } },
            { text: prompt },
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
