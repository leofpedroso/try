
import * as THREE from 'three';

// ----------------------------------------------------------------------------
// WORKER SOURCE CODE
// ----------------------------------------------------------------------------
// We use a specific version of Three.js from esm.sh to guarantee worker compatibility
const workerScript = `
import * as THREE from 'https://esm.sh/three@0.182.0';

self.onmessage = async (e) => {
    const { id, type, points, form, height, elevation, scaleFactor, offset, quality } = e.data;

    try {
        if (!points || points.length < 3) {
            self.postMessage({ id, error: 'Invalid points' });
            return;
        }

        // --- 1. PREPARE 2D SHAPE ---
        // Convert [x,y] points into Three.js Vectors, applying scale and centering
        const rawPoints = points.map(p => {
             const x = (p[0] * scaleFactor) - offset.x;
             const y = (p[1] * scaleFactor) - offset.z; 
             return new THREE.Vector2(x, -y); // Flip Y for 3D world (SVG Y is down, 3D Z is up/down)
        });

        // Ensure closure of the shape
        if (rawPoints.length > 0) {
            const start = rawPoints[0];
            const end = rawPoints[rawPoints.length - 1];
            if (start.distanceTo(end) > 0.001) {
                rawPoints.push(start.clone());
            }
        }

        let shape;
        const isOrganic = form === 'rounded' || form === 'pillow' || form === 'bubble';
        const qMult = quality === 'high' ? 2 : 1; 

        if (isOrganic) {
            const v3Points = rawPoints.map(p => new THREE.Vector3(p.x, p.y, 0));
            const tension = form === 'rounded' ? 0.2 : 0.5;
            const curve = new THREE.CatmullRomCurve3(v3Points, true, 'catmullrom', tension);
            
            // Adaptive sampling for smooth curves
            const divisions = Math.ceil(curve.getLength() * 20 * qMult); 
            const sampledPoints = curve.getPoints(divisions);
            shape = new THREE.Shape(sampledPoints.map(v => new THREE.Vector2(v.x, v.y)));
        } else {
            shape = new THREE.Shape(rawPoints);
        }

        // --- 2. EXTRUSION SETTINGS ---
        const h = height > 0 ? height : 0.1;
        
        let extrudeSettings = { 
            depth: h,
            curveSegments: 12 * qMult,
            steps: 1, 
            bevelEnabled: false 
        };

        if (form === 'rounded' || form === 'pillow' || type === 'void') {
             extrudeSettings.bevelEnabled = true;
             extrudeSettings.bevelThickness = form === 'pillow' ? h * 0.3 : 0.02;
             extrudeSettings.bevelSize = extrudeSettings.bevelThickness;
             extrudeSettings.bevelSegments = form === 'pillow' ? 8 : 2;
             
             if (form === 'pillow') {
                extrudeSettings.depth = Math.max(0.001, h - (extrudeSettings.bevelThickness * 2));
             }
        }

        // --- 3. GENERATE GEOMETRY ---
        let geo = new THREE.ExtrudeGeometry(shape, extrudeSettings);

        geo.computeVertexNormals();
        
        // Orient to X-Z plane (Standard Architectural Y-Up)
        geo.rotateX(-Math.PI / 2);
        geo.translate(0, elevation || 0, 0);

        // --- 4. EXTRACT BUFFERS ---
        // We transfer raw TypeArrays to main thread to reconstruct geometry there
        const position = geo.attributes.position.array;
        const normal = geo.attributes.normal.array;
        const uv = geo.attributes.uv.array;
        const index = geo.index ? geo.index.array : null;

        const transferList = [position.buffer, normal.buffer, uv.buffer];
        if (index) transferList.push(index.buffer);

        self.postMessage({
            id,
            success: true,
            data: { position, normal, uv, index }
        }, transferList);

    } catch (err) {
        self.postMessage({ id, error: err.message || 'Unknown Worker Error' });
    }
};
`;

// ----------------------------------------------------------------------------
// GEOMETRY ENGINE SERVICE
// ----------------------------------------------------------------------------
class GeometryEngine {
    private worker: Worker | null = null;
    private callbacks: Map<string, (data: any) => void> = new Map();

    constructor() {
        if (typeof window !== 'undefined') {
            try {
                const blob = new Blob([workerScript], { type: 'application/javascript' });
                this.worker = new Worker(URL.createObjectURL(blob), { type: 'module' });
                
                this.worker.onerror = (e) => {
                    console.error("Geometry Worker Initialization Error:", e);
                };

                this.worker.onmessage = (e) => {
                    const { id, success, data, error } = e.data;
                    const callback = this.callbacks.get(id);
                    if (callback) {
                        if (success) callback(data);
                        else console.warn(`Worker Geometry Gen Warning [${id}]:`, error);
                        this.callbacks.delete(id);
                    }
                };
            } catch (e) {
                console.error("Failed to create geometry worker:", e);
            }
        }
    }

    public requestGeometry(
        props: any, 
        quality: 'low' | 'high' = 'high'
    ): Promise<THREE.BufferGeometry> {
        return new Promise((resolve, reject) => {
            if (!this.worker) {
                resolve(this.generateProxy(props));
                return;
            }
            
            const requestId = `${props.id}_${quality}_${Date.now()}_${Math.random()}`;
            
            // Timeout to prevent hanging promises
            const timeout = setTimeout(() => {
                if (this.callbacks.has(requestId)) {
                    this.callbacks.delete(requestId);
                    reject("Worker timeout");
                }
            }, 10000);

            this.callbacks.set(requestId, (data: any) => {
                clearTimeout(timeout);
                const geometry = new THREE.BufferGeometry();
                geometry.setAttribute('position', new THREE.Float32BufferAttribute(data.position, 3));
                geometry.setAttribute('normal', new THREE.Float32BufferAttribute(data.normal, 3));
                geometry.setAttribute('uv', new THREE.Float32BufferAttribute(data.uv, 2));
                if (data.index) {
                    geometry.setIndex(new THREE.BufferAttribute(data.index, 1));
                }
                resolve(geometry);
            });

            this.worker.postMessage({
                id: requestId,
                quality,
                ...props
            });
        });
    }

    // Synchronous Fallback (Proxy Generation) for Instant LOD
    public generateProxy(props: any): THREE.BufferGeometry {
        const { points, height, elevation, scaleFactor, offset } = props;
        
        if (!points || points.length < 3) return new THREE.BufferGeometry();

        const rawPoints = points.map((p: any) => {
             const x = (p[0] * scaleFactor) - offset.x;
             const y = (p[1] * scaleFactor) - offset.z; 
             return new THREE.Vector2(x, -y);
        });

        const shape = new THREE.Shape(rawPoints);
        const h = height > 0 ? height : 0.1;
        
        const geometry = new THREE.ExtrudeGeometry(shape, {
            depth: h,
            bevelEnabled: false, 
            steps: 1
        });

        geometry.rotateX(-Math.PI / 2);
        geometry.translate(0, elevation || 0, 0);
        return geometry;
    }
}

export const geometryEngine = new GeometryEngine();
