import * as THREE from 'three';
import Application from '../Application';
import Time from '../Utils/Time';
import { FLOOR_Y, ROOM, WINDOW } from './Room';

/**
 * The window in the room's back wall at dawn: a sky going from indigo to
 * peach with the sun just under the skyline, slow clouds and a few city
 * windows still lit. A low warm sun comes in through it: a directional
 * light, a pane-shaped patch on the floor (the cross bars cast their
 * shadow, and the desk blocks the part behind it), a faint shaft of light
 * and some dust drifting in it.
 */
const FRAME = 110; // frame bar thickness
const COLORS = {
    frame: '#3a2f28',
    sun: '#ffc79a',
    patch: '255,196,140',
};
// Sunlight direction: down into the room and a little to the right
const SUN_DIR = new THREE.Vector3(0.2, -1.0, 0.9).normalize();
const DESK_FRONT_Z = 1700; // sun on the floor starts in front of the desk
const DUST = 160;

const vertexShader = /* glsl */ `
varying vec2 vUv;
void main() {
    vUv = uv;
    gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
}
`;

const fragmentShader = /* glsl */ `
uniform float uTime;
uniform float uAspect;
varying vec2 vUv;

float hash11(float p) {
    p = fract(p * 0.1031);
    p *= p + 33.33;
    p *= p + p;
    return fract(p);
}
float hash21(vec2 p) {
    vec3 p3 = fract(vec3(p.xyx) * 0.1031);
    p3 += dot(p3, p3.yzx + 33.33);
    return fract((p3.x + p3.y) * p3.z);
}
float noise(vec2 p) {
    vec2 i = floor(p);
    vec2 f = fract(p);
    vec2 u = f * f * (3.0 - 2.0 * f);
    return mix(mix(hash21(i), hash21(i + vec2(1, 0)), u.x),
               mix(hash21(i + vec2(0, 1)), hash21(i + vec2(1, 1)), u.x), u.y);
}

// A row of buildings in silhouette, a few windows still lit
vec4 buildings(vec2 uv, float cols, float base, float range, float seed, vec3 body) {
    float x = uv.x * cols;
    float id = floor(x);
    float h = base + hash11(id + seed) * range;
    float inside = step(uv.y, h);
    vec2 w = vec2(fract(x) * 5.0, uv.y * 60.0);
    vec2 wid = floor(w);
    float lit = step(0.9, hash21(wid + vec2(id * 7.0, seed)));
    vec2 f = fract(w);
    float pane = step(0.3, f.x) * step(f.x, 0.7) * step(0.3, f.y) * step(f.y, 0.7);
    vec3 col = body + vec3(1.0, 0.78, 0.5) * pane * lit * 0.6;
    return vec4(col, inside);
}

void main() {
    vec2 uv = vUv;
    float t = uTime;

    // indigo overhead, rose in the middle, peach at the horizon
    vec3 sky = mix(vec3(0.98, 0.70, 0.50), vec3(0.88, 0.55, 0.62), smoothstep(0.15, 0.45, uv.y));
    sky = mix(sky, vec3(0.30, 0.32, 0.55), smoothstep(0.45, 0.85, uv.y));
    sky = mix(sky, vec3(0.13, 0.15, 0.32), smoothstep(0.8, 1.0, uv.y));

    // the sun, just under the skyline, and its glow
    vec2 sun = vec2(0.32, 0.26);
    vec2 d = (uv - sun) * vec2(uAspect, 1.0);
    float r = length(d);
    sky += vec3(1.0, 0.85, 0.6) * smoothstep(0.09, 0.07, r);
    sky += vec3(1.0, 0.65, 0.4) * exp(-r * 6.0) * 0.55;

    // slow soft clouds, lit underneath
    vec2 c = vec2(uv.x * uAspect * 2.2 + t * 0.006, uv.y * 4.0);
    float n = noise(c) * 0.6 + noise(c * 2.3) * 0.3 + noise(c * 5.1) * 0.1;
    float cloud = smoothstep(0.55, 0.8, n) * smoothstep(0.35, 0.6, uv.y) * smoothstep(1.0, 0.75, uv.y);
    sky = mix(sky, vec3(1.0, 0.78, 0.72), cloud * 0.55);

    vec3 col = sky;
    vec4 far = buildings(uv, 9.0, 0.16, 0.2, 3.0, vec3(0.32, 0.27, 0.38));
    col = mix(col, far.rgb, far.a * 0.85);
    vec4 near = buildings(uv, 5.0, 0.05, 0.18, 11.0, vec3(0.16, 0.13, 0.2));
    col = mix(col, near.rgb, near.a);

    // a touch of haze and glass
    col = mix(col, vec3(0.95, 0.8, 0.75), 0.06);
    gl_FragColor = vec4(col, 1.0);
}
`;

export default class DawnWindow {
    application: Application;
    scene: THREE.Scene;
    time: Time;

    glass: THREE.ShaderMaterial;
    sun: THREE.DirectionalLight;
    dust: THREE.Points;
    dustSeeds: Float32Array;

    constructor() {
        this.application = new Application();
        this.scene = this.application.scene;
        this.time = this.application.time;

        this.setWindow();
        this.setSun();
    }

    setWindow() {
        const w = WINDOW;
        const frame = new THREE.MeshPhongMaterial({
            color: COLORS.frame,
            specular: 0x000000,
            shininess: 0,
        });
        const bar = (x: number, y: number, sx: number, sy: number, sz: number, z: number) => {
            const mesh = new THREE.Mesh(new THREE.BoxGeometry(sx, sy, sz), frame);
            mesh.position.set(x, y, z);
            this.scene.add(mesh);
        };
        const zMid = ROOM.back - ROOM.wall / 2;
        const d = ROOM.wall + 40;
        // outer frame, a cross mullion, and a sill that sticks out
        bar(w.x, w.y + w.height / 2, w.width + FRAME * 2, FRAME, d, zMid);
        bar(w.x - w.width / 2, w.y, FRAME, w.height, d, zMid);
        bar(w.x + w.width / 2, w.y, FRAME, w.height, d, zMid);
        bar(w.x, w.y, FRAME * 0.6, w.height, d * 0.6, zMid);
        bar(w.x, w.y + w.height * 0.12, w.width, FRAME * 0.6, d * 0.6, zMid);
        bar(w.x, w.y - w.height / 2 - FRAME * 0.4, w.width + FRAME * 3.4, FRAME * 0.8, ROOM.wall + 260, zMid + 100);

        this.glass = new THREE.ShaderMaterial({
            vertexShader,
            fragmentShader,
            uniforms: {
                uTime: { value: 0 },
                uAspect: { value: w.width / w.height },
            },
        });
        const glass = new THREE.Mesh(new THREE.PlaneGeometry(w.width, w.height), this.glass);
        glass.position.set(w.x, w.y, zMid - 20);
        this.scene.add(glass);
    }

    /** Where a point on the window lands on the floor along the sunlight. */
    toFloor(x: number, y: number) {
        const t = (y - FLOOR_Y) / -SUN_DIR.y;
        // just above the rug, so it lies on top of it
        return new THREE.Vector3(x + SUN_DIR.x * t, FLOOR_Y + 25, ROOM.back + SUN_DIR.z * t);
    }

    setSun() {
        const w = WINDOW;
        this.sun = new THREE.DirectionalLight(COLORS.sun, 0.55);
        this.sun.position.copy(new THREE.Vector3(w.x, w.y, ROOM.back).addScaledVector(SUN_DIR, -8000));
        this.sun.target.position.copy(new THREE.Vector3(w.x, w.y, ROOM.back).addScaledVector(SUN_DIR, 4000));
        this.scene.add(this.sun, this.sun.target);

        // Window corners on the glass and where they land on the floor
        const x0 = w.x - w.width / 2;
        const x1 = w.x + w.width / 2;
        const y0 = w.y - w.height / 2;
        const y1 = w.y + w.height / 2;
        const glassCorners = [
            new THREE.Vector3(x0, y0, ROOM.back),
            new THREE.Vector3(x1, y0, ROOM.back),
            new THREE.Vector3(x1, y1, ROOM.back),
            new THREE.Vector3(x0, y1, ROOM.back),
        ];
        const floorCorners = [this.toFloor(x0, y0), this.toFloor(x1, y0), this.toFloor(x1, y1), this.toFloor(x0, y1)];

        // Patch on the floor: the pane pattern, cut off where the desk is
        const near = floorCorners[0].z;
        const far = floorCorners[3].z;
        const deskCut = THREE.MathUtils.clamp((DESK_FRONT_Z - near) / (far - near), 0, 1);
        const patch = new THREE.Mesh(
            this.quad(floorCorners),
            new THREE.MeshBasicMaterial({
                map: this.createPatchTexture(deskCut),
                side: THREE.DoubleSide,
                transparent: true,
                blending: THREE.AdditiveBlending,
                depthWrite: false,
            })
        );
        this.scene.add(patch);

        // Shaft: the four sides of the beam between window and floor, faint
        const shaft = new THREE.BufferGeometry();
        const v: number[] = [];
        const a: number[] = [];
        for (let i = 0; i < 4; i++) {
            const j = (i + 1) % 4;
            const quad = [glassCorners[i], glassCorners[j], floorCorners[j], floorCorners[i]];
            const alpha = [1, 1, 0, 0];
            [0, 1, 2, 0, 2, 3].forEach((k) => {
                v.push(quad[k].x, quad[k].y, quad[k].z);
                a.push(alpha[k]);
            });
        }
        shaft.setAttribute('position', new THREE.Float32BufferAttribute(v, 3));
        shaft.setAttribute('alpha', new THREE.Float32BufferAttribute(a, 1));
        const shaftMaterial = new THREE.ShaderMaterial({
            transparent: true,
            depthWrite: false,
            side: THREE.DoubleSide,
            blending: THREE.AdditiveBlending,
            vertexShader: `attribute float alpha; varying float vA; void main() { vA = alpha; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }`,
            fragmentShader: `varying float vA; void main() { gl_FragColor = vec4(1.0, 0.8, 0.6, 1.0) * (0.05 + 0.06 * vA); }`,
        });
        this.scene.add(new THREE.Mesh(shaft, shaftMaterial));

        // Dust drifting in the beam: seeds are (along beam, across, up/down)
        this.dustSeeds = new Float32Array(DUST * 3).map(() => Math.random());
        const dustGeometry = new THREE.BufferGeometry();
        dustGeometry.setAttribute('position', new THREE.Float32BufferAttribute(new Float32Array(DUST * 3), 3));
        this.dust = new THREE.Points(
            dustGeometry,
            new THREE.PointsMaterial({
                color: '#ffe2bf',
                size: 18,
                map: this.createDotTexture(),
                transparent: true,
                opacity: 0.55,
                blending: THREE.AdditiveBlending,
                depthWrite: false,
            })
        );
        this.scene.add(this.dust);
    }

    quad(c: THREE.Vector3[]) {
        const g = new THREE.BufferGeometry();
        g.setAttribute('position', new THREE.Float32BufferAttribute([
            c[0].x, c[0].y, c[0].z, c[1].x, c[1].y, c[1].z, c[2].x, c[2].y, c[2].z,
            c[0].x, c[0].y, c[0].z, c[2].x, c[2].y, c[2].z, c[3].x, c[3].y, c[3].z,
        ], 3));
        g.setAttribute('uv', new THREE.Float32BufferAttribute([0, 0, 1, 0, 1, 1, 0, 0, 1, 1, 0, 1], 2));
        return g;
    }

    /** Four panes of warm light with soft edges; nothing before deskCut. */
    createPatchTexture(deskCut: number) {
        const w = 256;
        const h = 256;
        const canvas = document.createElement('canvas');
        canvas.width = w;
        canvas.height = h;
        const ctx = canvas.getContext('2d') as CanvasRenderingContext2D;
        ctx.filter = 'blur(6px)';
        ctx.fillStyle = `rgba(${COLORS.patch},0.6)`;
        const fx = FRAME / WINDOW.width;
        const fy = FRAME / WINDOW.height;
        const crossY = 0.5 + 0.12; // the horizontal bar, from the bottom
        // canvas y runs top-down, uv v bottom-up
        const rect = (u0: number, v0: number, u1: number, v1: number) => {
            const a = Math.max(v0, deskCut);
            if (v1 <= a) return;
            ctx.fillRect(u0 * w, (1 - v1) * h, (u1 - u0) * w, (v1 - a) * h);
        };
        rect(fx / 2, fy / 2, 0.5 - fx * 0.3, crossY - fy * 0.3);
        rect(0.5 + fx * 0.3, fy / 2, 1 - fx / 2, crossY - fy * 0.3);
        rect(fx / 2, crossY + fy * 0.3, 0.5 - fx * 0.3, 1 - fy / 2);
        rect(0.5 + fx * 0.3, crossY + fy * 0.3, 1 - fx / 2, 1 - fy / 2);
        const texture = new THREE.CanvasTexture(canvas);
        texture.encoding = THREE.sRGBEncoding;
        return texture;
    }

    createDotTexture() {
        const canvas = document.createElement('canvas');
        canvas.width = canvas.height = 32;
        const ctx = canvas.getContext('2d') as CanvasRenderingContext2D;
        const g = ctx.createRadialGradient(16, 16, 0, 16, 16, 16);
        g.addColorStop(0, 'rgba(255,255,255,1)');
        g.addColorStop(1, 'rgba(255,255,255,0)');
        ctx.fillStyle = g;
        ctx.fillRect(0, 0, 32, 32);
        return new THREE.CanvasTexture(canvas);
    }

    update() {
        const t = this.time.elapsed / 1000;
        this.glass.uniforms.uTime.value = t;

        // dust: each mote rides slowly along the beam, swaying across it
        const w = WINDOW;
        const pos = this.dust.geometry.attributes.position as THREE.BufferAttribute;
        for (let i = 0; i < DUST; i++) {
            const s = this.dustSeeds;
            const along = (s[i * 3] + t * 0.004 * (0.5 + s[i * 3 + 2])) % 1;
            const x = w.x + (s[i * 3 + 1] - 0.5) * w.width * 0.9 + Math.sin(t * 0.3 + i) * 40;
            const y = w.y + (s[i * 3 + 2] - 0.5) * w.height * 0.9 + Math.cos(t * 0.23 + i) * 40;
            const p = new THREE.Vector3(x, y, ROOM.back).lerp(this.toFloor(x, y), along * 0.85);
            pos.setXYZ(i, p.x, p.y, p.z);
        }
        pos.needsUpdate = true;
    }
}
