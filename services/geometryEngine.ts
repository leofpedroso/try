import * as THREE from 'three';
import { simplify } from 'simplify-js';

// ----------------------------------------------------------------------------
// WORKER SOURCE CODE - ENHANCED WITH ADVANCED OPERATIONS
// ----------------------------------------------------------------------------
const workerScript = `
import * as THREE from 'https://esm.sh/three@0.182.0';

// Advanced geometry operations
const optimizeGeometry = (geometry) => {
    geometry.computeBoundingBox();
    geometry.computeBoundingSphere();
    geometry.computeVertexNormals();
    return geometry;
};

const applyMorphTargets = (geometry, form, intensity = 1.0) => {
    if (form === 'bubble' || form === 'pillow') {
        const positions = geometry.attributes.position.array;
        const center = new THREE.Vector3();
        geometry.computeBoundingBox();
        geometry.boundingBox.getCenter(center);
        
        for (let i = 0; i < positions.length; i += 3) {
            const vertex = new THREE.Vector3(
                positions[i],
                positions[i + 1],
                positions[i + 2]
            );
            const direction = vertex.clone().sub(center).normalize();
            const distance = vertex.distanceTo(center);
            const inflation = Math.sin(distance * Math.PI) * intensity * 0.1;
            
            positions[i] += direction.x * inflation;
            positions[i + 1] += direction.y * inflation;
            positions[i + 2] += direction.z * inflation;
        }
        geometry.attributes.position.needsUpdate = true;
    }
    return geometry;
};

// Adaptive subdivision based on curvature
const subdivideAdaptive = (geometry, maxEdgeLength = 0.5) => {
    const positions = geometry.attributes.position.array;
    const newPositions = [];
    
    for (let i = 0; i < positions.length; i += 9) {
        const v1 = new THREE.Vector3(positions[i], positions[i+1], positions[i+2]);
        const v2 = new THREE.Vector3(positions[i+3], positions[i+4], positions[i+5]);
        const v3 = new THREE.Vector3(positions[i+6], positions[i+7], positions[i+8]);
        
        const edge1 = v1.distanceTo(v2);
        const edge2 = v2.distanceTo(v3);
        const edge3 = v3.distanceTo(v1);
        
        if (edge1 > maxEdgeLength || edge2 > maxEdgeLength || edge3 > maxEdgeLength) {
            const m12 = new THREE.Vector3().addVectors(v1, v2).multiplyScalar(0.5);
            const m23 = new THREE.Vector3().addVectors(v2, v3).multiplyScalar(0.5);
            const m31 = new THREE.Vector3().addVectors(v3, v1).multiplyScalar(0.5);
            
            [v1, m12, m31, m12, v2, m23, m31, m23, v3, m12, m23, m31].forEach(v => {
                newPositions.push(v.x, v.y, v.z);
            });
        } else {
            newPositions.push(...positions.slice(i, i+9));
        }
    }
    
    if (newPositions.length > positions.length) {
        geometry.setAttribute('position', new THREE.Float32BufferAttribute(newPositions, 3));
    }
    
    return geometry;
};

self.onmessage = async (e) => {
    const { id, type, points, form, height, elevation, scaleFactor, offset, quality, adaptive } = e.data;

    try {
        if (!points || points.length < 3) {
            self.postMessage({ id, error: 'Invalid points' });
            return;
        }

        // --- 1. PREPARE 2D SHAPE WITH SIMPLIFICATION ---
        const rawPoints = points.map(p => {
             const x = (p[0] * scaleFactor) - offset.x;
             const y = (p[1] * scaleFactor) - offset.z; 
             return new THREE.Vector2(x, -y);
        });

        // Adaptive simplification for performance
        const tolerance = quality === 'high' ? 0.01 : 0.05;
        const simplifiedPoints = rawPoints.length > 50 
            ? rawPoints.filter((p, i) => i % 2 === 0 || i === rawPoints.length - 1)
            : rawPoints;

        // Ensure closure
        if (simplifiedPoints.length > 0) {
            const start = simplifiedPoints[0];
            const end = simplifiedPoints[simplifiedPoints.length - 1];
            if (start.distanceTo(end) > 0.001) {
                simplifiedPoints.push(start.clone());
            }
        }

        let shape;
        const isOrganic = form === 'rounded' || form === 'pillow' || form === 'bubble';
        const qMult = quality === 'high' ? 2 : 1; 

        if (isOrganic) {
            const v3Points = simplifiedPoints.map(p => new THREE.Vector3(p.x, p.y, 0));
            const tension = form === 'rounded' ? 0.2 : form === 'pillow' ? 0.5 : 0.7;
            const curve = new THREE.CatmullRomCurve3(v3Points, true, 'catmullrom', tension);
            
            const divisions = Math.min(Math.ceil(curve.getLength() * 20 * qMult), 500);
            const sampledPoints = curve.getPoints(divisions);
            shape = new THREE.Shape(sampledPoints.map(v => new THREE.Vector2(v.x, v.y)));
        } else {
            shape = new THREE.Shape(simplifiedPoints);
        }

        // --- 2. EXTRUSION SETTINGS WITH ADVANCED OPTIONS ---
        const h = height > 0 ? height : 0.1;
        
        let extrudeSettings = { 
            depth: h,
            curveSegments: 12 * qMult,
            steps: form === 'bubble' ? 3 : 1,
            bevelEnabled: false 
        };

        if (form === 'rounded' || form === 'pillow' || form === 'bubble' || type === 'void') {
             extrudeSettings.bevelEnabled = true;
             extrudeSettings.bevelThickness = form === 'pillow' || form === 'bubble' ? h * 0.3 : 0.02;
             extrudeSettings.bevelSize = extrudeSettings.bevelThickness;
             extrudeSettings.bevelSegments = form === 'bubble' ? 12 : form === 'pillow' ? 8 : 2;
             
             if (form === 'pillow' || form === 'bubble') {
                extrudeSettings.depth = Math.max(0.001, h - (extrudeSettings.bevelThickness * 2));
             }
        }

        // --- 3. GENERATE AND OPTIMIZE GEOMETRY ---
        let geo = new THREE.ExtrudeGeometry(shape, extrudeSettings);

        // Apply morphing for organic forms
        if (form === 'bubble') {
            geo = applyMorphTargets(geo, form, 1.5);
        } else if (form === 'pillow') {
            geo = applyMorphTargets(geo, form, 0.8);
        }

        // Adaptive subdivision for curved surfaces
        if (adaptive && isOrganic && quality === 'high') {
            geo = subdivideAdaptive(geo, 0.3);
        }

        geo = optimizeGeometry(geo);
        
        // Orient to X-Z plane (Standard Architectural Y-Up)
        geo.rotateX(-Math.PI / 2);
        geo.translate(0, elevation || 0, 0);

        // --- 4. EXTRACT BUFFERS WITH TANGENTS FOR PBR ---
        const position = geo.attributes.position.array;
        const normal = geo.attributes.normal.array;
        const uv = geo.attributes.uv.array;
        const index = geo.index ? geo.index.array : null;

        // Calculate tangents for normal mapping
        geo.computeTangents?.();
        const tangent = geo.attributes.tangent?.array || null;

        const transferList = [position.buffer, normal.buffer, uv.buffer];
        if (index) transferList.push(index.buffer);
        if (tangent) transferList.push(tangent.buffer);

        self.postMessage({
            id,
            success: true,
            data: { position, normal, uv, index, tangent }
        }, transferList);

    } catch (err) {
        self.postMessage({ id, error: err.message || 'Unknown Worker Error' });
    }
};
`;

// ----------------------------------------------------------------------------
// ENHANCED GEOMETRY ENGINE SERVICE
// ----------------------------------------------------------------------------
class GeometryEngine {
    private worker: Worker | null = null;
    private callbacks: Map<string, (data: any) => void> = new Map();
    private geometryCache: Map<string, THREE.BufferGeometry> = new Map();
    private instancedMeshes: Map<string, THREE.InstancedMesh> = new Map();
    private maxCacheSize = 100;

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

    private getCacheKey(props: any, quality: string): string {
        const pointsHash = JSON.stringify(props.points);
        return `${props.id}_${props.form}_${props.height}_${quality}_${pointsHash}`;
    }

    private manageCacheSize() {
        if (this.geometryCache.size > this.maxCacheSize) {
            const firstKey = this.geometryCache.keys().next().value;
            const geo = this.geometryCache.get(firstKey);
            geo?.dispose();
            this.geometryCache.delete(firstKey);
        }
    }

    public requestGeometry(
        props: any, 
        quality: 'low' | 'high' = 'high',
        useCache: boolean = true,
        adaptive: boolean = false
    ): Promise<THREE.BufferGeometry> {
        return new Promise((resolve, reject) => {
            // Check cache first
            if (useCache) {
                const cacheKey = this.getCacheKey(props, quality);
                const cached = this.geometryCache.get(cacheKey);
                if (cached) {
                    resolve(cached.clone());
                    return;
                }
            }

            if (!this.worker) {
                const proxy = this.generateProxy(props);
                resolve(proxy);
                return;
            }
            
            const requestId = `${props.id}_${quality}_${Date.now()}_${Math.random()}`;
            
            const timeout = setTimeout(() => {
                if (this.callbacks.has(requestId)) {
                    this.callbacks.delete(requestId);
                    reject("Worker timeout");
                }
            }, 15000);

            this.callbacks.set(requestId, (data: any) => {
                clearTimeout(timeout);
                const geometry = new THREE.BufferGeometry();
                geometry.setAttribute('position', new THREE.Float32BufferAttribute(data.position, 3));
                geometry.setAttribute('normal', new THREE.Float32BufferAttribute(data.normal, 3));
                geometry.setAttribute('uv', new THREE.Float32BufferAttribute(data.uv, 2));
                
                if (data.index) {
                    geometry.setIndex(new THREE.BufferAttribute(data.index, 1));
                }
                
                if (data.tangent) {
                    geometry.setAttribute('tangent', new THREE.Float32BufferAttribute(data.tangent, 4));
                }

                // Cache the geometry
                if (useCache) {
                    const cacheKey = this.getCacheKey(props, quality);
                    this.geometryCache.set(cacheKey, geometry.clone());
                    this.manageCacheSize();
                }

                resolve(geometry);
            });

            this.worker.postMessage({
                id: requestId,
                quality,
                adaptive,
                ...props
            });
        });
    }

    // Create instanced mesh for repeated elements (columns, windows, etc.)
    public createInstancedMesh(
        geometry: THREE.BufferGeometry,
        material: THREE.Material,
        count: number,
        id: string
    ): THREE.InstancedMesh {
        if (this.instancedMeshes.has(id)) {
            return this.instancedMeshes.get(id)!;
        }

        const instancedMesh = new THREE.InstancedMesh(geometry, material, count);
        instancedMesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
        this.instancedMeshes.set(id, instancedMesh);
        
        return instancedMesh;
    }

    // Batch geometry merging for better performance
    public mergeGeometries(geometries: THREE.BufferGeometry[]): THREE.BufferGeometry {
        if (geometries.length === 0) return new THREE.BufferGeometry();
        if (geometries.length === 1) return geometries[0];
        
        return THREE.BufferGeometryUtils?.mergeGeometries?.(geometries) || geometries[0];
    }

    // LOD (Level of Detail) generation
    public generateLODs(
        props: any,
        levels: number = 3
    ): Promise<THREE.BufferGeometry[]> {
        const promises: Promise<THREE.BufferGeometry>[] = [];
        
        for (let i = 0; i < levels; i++) {
            const quality = i === 0 ? 'high' : 'low';
            const simplificationFactor = Math.pow(0.5, i);
            
            const lodProps = {
                ...props,
                points: this.simplifyPoints(props.points, simplificationFactor)
            };
            
            promises.push(this.requestGeometry(lodProps, quality, true, false));
        }
        
        return Promise.all(promises);
    }

    private simplifyPoints(points: number[][], factor: number): number[][] {
        if (factor >= 1) return points;
        const step = Math.ceil(1 / factor);
        return points.filter((_, i) => i % step === 0 || i === points.length - 1);
    }

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
        geometry.computeVertexNormals();
        
        return geometry;
    }

    public clearCache() {
        this.geometryCache.forEach(geo => geo.dispose());
        this.geometryCache.clear();
        this.instancedMeshes.forEach(mesh => {
            mesh.geometry.dispose();
            if (Array.isArray(mesh.material)) {
                mesh.material.forEach(mat => mat.dispose());
            } else {
                mesh.material.dispose();
            }
        });
        this.instancedMeshes.clear();
    }

    public dispose() {
        this.clearCache();
        this.worker?.terminate();
        this.worker = null;
    }
}

export const geometryEngine = new GeometryEngine();