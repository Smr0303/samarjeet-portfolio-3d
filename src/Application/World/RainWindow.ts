import * as THREE from 'three';
import Application from '../Application';
import Time from '../Utils/Time';
import UIEventBus from '../UI/EventBus';
import { FLOOR_Y, ROOM, WINDOW } from './Room';

/**
 * The window in the room's back wall, onto a rainy night city. The glass
 * is a shader: rain drops and running streaks over a fogged skyline
 * that shows sharper through the water. Every so often lightning flashes
 * the sky and the room, and thunder rolls in a moment later. Rain and
 * thunder are synthesised noise played through the scene's audio listener,
 * so the mute toggle covers them.
 */
const FRAME = 110; // frame bar thickness
const COLORS = {
    frame: '#3a2f28',
    lightning: '#d4ddff',
    cityGlow: '#5d6f99',
};

// Lightning: a strike every MIN..MAX seconds, a few flickers each
const STRIKE_GAP = { min: 9, max: 22 };
const RAIN_VOLUME = 0.12;
const THUNDER_VOLUME = 0.5;

const vertexShader = /* glsl */ `
varying vec2 vUv;
void main() {
    vUv = uv;
    gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
}
`;

const fragmentShader = /* glsl */ `
uniform float uTime;
uniform float uFlash;
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

// One row of buildings: per-column heights, lit windows on a grid. soft
// widens every edge, which reads as the fog on the glass.
vec3 buildings(vec2 uv, float cols, float base, float range, float seed,
               vec3 body, float soft) {
    float x = uv.x * cols;
    float id = floor(x);
    float h = base + hash11(id + seed) * range;
    float inside = smoothstep(h + soft, h - soft, uv.y);
    // windows: 5 across a building, small floors
    vec2 w = vec2(fract(x) * 5.0, uv.y * 60.0);
    vec2 wid = floor(w);
    float lit = step(0.62, hash21(wid + vec2(id * 7.0, seed)));
    vec2 f = fract(w);
    float pane = smoothstep(0.15 - soft * 8.0, 0.35, f.x) * smoothstep(0.85 + soft * 8.0, 0.65, f.x)
               * smoothstep(0.2 - soft * 8.0, 0.4, f.y) * smoothstep(0.8 + soft * 8.0, 0.6, f.y);
    float warm = hash21(wid + id);
    vec3 light = mix(vec3(1.0, 0.72, 0.38), vec3(0.75, 0.85, 1.0), step(0.8, warm));
    vec3 col = body + light * pane * lit * (0.55 + 0.45 * warm);
    return col * inside;
}

vec3 city(vec2 uv, float soft) {
    // night sky with an orange city haze near the horizon
    vec3 col = mix(vec3(0.10, 0.08, 0.10), vec3(0.015, 0.02, 0.045), smoothstep(0.05, 0.8, uv.y));
    col += vec3(0.22, 0.12, 0.06) * smoothstep(0.45, 0.0, uv.y) * 0.8;
    // lightning lights the clouds from above
    col += vec3(0.75, 0.8, 1.0) * uFlash * smoothstep(0.0, 1.0, uv.y) * 1.3;

    vec3 far = buildings(uv, 9.0, 0.18, 0.22, 3.0, vec3(0.035, 0.035, 0.055), soft);
    float farMask = smoothstep(0.0, 0.001, length(far));
    col = mix(col, far * 0.7 + col * 0.15, farMask);
    vec3 near = buildings(uv, 5.0, 0.06, 0.2, 11.0, vec3(0.02, 0.02, 0.03), soft);
    float nearMask = smoothstep(0.0, 0.001, length(near));
    col = mix(col, near, nearMask);
    // buildings catch the flash too
    col += vec3(0.08, 0.09, 0.12) * uFlash * (farMask + nearMask);
    return col;
}

// Small beads that appear, sit and evaporate. Returns the bead's slope in
// xy (for refraction) and its coverage in z.
vec3 beads(vec2 uv, float t) {
    vec2 g = uv * vec2(18.0, 18.0);
    vec2 id = floor(g);
    vec2 st = fract(g) - 0.5;
    float n = hash21(id);
    vec2 c = (vec2(hash21(id + 1.7), hash21(id + 5.3)) - 0.5) * 0.6;
    float r = 0.12 + 0.18 * hash21(id + 9.1);
    float life = fract(t * 0.05 + n);
    float alive = smoothstep(0.0, 0.05, life) * smoothstep(1.0, 0.7, life) * step(0.6, n);
    vec2 d = st - c;
    float m = smoothstep(r, r * 0.6, length(d)) * alive;
    return vec3(d / r * m, m);
}

// Drops running down in columns, wobbling, leaving a wet trail of tiny
// beads behind them.
vec3 runners(vec2 uv, float t, float cols, float seed) {
    vec2 g = vec2(uv.x * cols, uv.y);
    float id = floor(g.x) + seed;
    float n = hash11(id);
    float speed = 0.06 + 0.1 * hash11(id + 3.0);
    // stop-start motion: drops hang, then slip
    float tt = t * speed + n * 10.0;
    float y = 1.15 - fract(tt + 0.25 * sin(tt * 6.2831)) * 1.3;
    float x = 0.5 + 0.25 * (hash11(id + 7.0) - 0.5)
            + 0.08 * sin(uv.y * 23.0 + n * 6.0) * hash11(id + 11.0);
    vec2 st = vec2(fract(g.x), uv.y);
    vec2 d = (st - vec2(x, y)) * vec2(1.0, cols * 0.55 / uAspect);
    float drop = smoothstep(0.22, 0.14, length(d));
    // trail above the drop, fading with distance
    float above = st.y - y;
    float trail = smoothstep(0.07, 0.03, abs(st.x - x)) * step(0.0, above)
                * smoothstep(0.35, 0.0, above);
    float bits = trail * smoothstep(0.75, 0.98, sin(uv.y * 230.0 + n * 40.0));
    float m = max(drop, bits * 0.8);
    vec2 slope = vec2((st.x - x) * 6.0, d.y * 1.5) * m;
    return vec3(slope, max(m, trail * 0.35));
}

void main() {
    vec2 uv = vUv;
    vec2 auv = vec2(uv.x * uAspect, uv.y);
    float t = uTime;

    vec3 a = beads(auv, t);
    vec3 b = runners(uv, t, 11.0, 0.0);
    vec3 c = runners(uv + vec2(0.037, 0.0), t * 1.3, 17.0, 50.0);
    float water = clamp(a.z + b.z + c.z, 0.0, 1.0);
    vec2 slope = a.xy + b.xy + c.xy;

    // Fogged glass shows a soft city; through water it is sharper and
    // flipped a touch like a lens
    vec3 blurred = city(uv, 0.06);
    vec3 sharp = city(uv - slope * 0.03, 0.004);
    vec3 col = mix(blurred, sharp, water);
    // condensation haze, and a highlight on the drops
    col = mix(col, vec3(0.1, 0.11, 0.14), 0.3 * (1.0 - water));
    col += vec3(0.06, 0.07, 0.09) * water;
    col += vec3(0.35) * water * smoothstep(0.15, 0.9, length(slope)) * (0.4 + uFlash);
    // colours above are picked in display space, so no output encoding
    gl_FragColor = vec4(col, 1.0);
}
`;

export default class RainWindow {
    application: Application;
    scene: THREE.Scene;
    time: Time;

    glass: THREE.ShaderMaterial;
    lightning: THREE.DirectionalLight;
    cityLight: THREE.PointLight;
    flash: number;
    strikeAt: number;
    strikeStart: number;
    strikeFlickers: number[];
    reduceMotion: boolean;

    rain?: THREE.Audio;
    thunderBuffer?: AudioBuffer;

    constructor() {
        this.application = new Application();
        this.scene = this.application.scene;
        this.time = this.application.time;
        this.flash = 0;
        this.strikeAt = 6;
        this.strikeStart = -100;
        this.strikeFlickers = [];
        this.reduceMotion =
            window.matchMedia &&
            window.matchMedia('(prefers-reduced-motion: reduce)').matches;

        this.setWindow();
        this.setLights();
        UIEventBus.on('loadingScreenDone', () => setTimeout(() => this.setAudio(), 300));
    }

    setWindow() {
        const w = WINDOW;
        const frame = new THREE.MeshPhongMaterial({
            color: COLORS.frame,
            specular: 0x000000,
            shininess: 0,
        });
        const bar = (x: number, y: number, sx: number, sy: number, sz: number, z = ROOM.back) => {
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
                uFlash: { value: 0 },
                uAspect: { value: w.width / w.height },
            },
        });
        const glass = new THREE.Mesh(new THREE.PlaneGeometry(w.width, w.height), this.glass);
        glass.position.set(w.x, w.y, zMid - 20);
        this.scene.add(glass);
    }

    setLights() {
        // Faint cold city light through the window onto the desk and floor
        this.cityLight = new THREE.PointLight(COLORS.cityGlow, 0.5, 7000, 2);
        this.cityLight.position.set(WINDOW.x, WINDOW.y, ROOM.back + 400);
        // Lightning comes in through the window, across the room
        this.lightning = new THREE.DirectionalLight(COLORS.lightning, 0);
        this.lightning.position.set(WINDOW.x - 1500, WINDOW.y + 3000, ROOM.back - 4000);
        this.lightning.target.position.set(0, FLOOR_Y, 3000);
        this.scene.add(this.cityLight, this.lightning, this.lightning.target);
    }

    /** Rain as a looped band of filtered noise; thunder made per strike. */
    setAudio() {
        const audioManager = this.application.world.audioManager;
        if (!audioManager) return;
        const listener = audioManager.listener;
        const ctx = listener.context;
        // browsers keep audio suspended until a gesture; resume on the next
        if (ctx.state !== 'running') {
            ctx.resume();
            window.addEventListener('mousedown', () => ctx.resume(), { once: true });
        }

        const seconds = 4;
        const buffer = ctx.createBuffer(1, ctx.sampleRate * seconds, ctx.sampleRate);
        const data = buffer.getChannelData(0);
        // pinkish noise with soft random patter, cross-faded at the loop
        let b0 = 0;
        let b1 = 0;
        for (let i = 0; i < data.length; i++) {
            const white = Math.random() * 2 - 1;
            b0 = 0.97 * b0 + white * 0.15;
            b1 = 0.6 * b1 + white * 0.4;
            const patter = Math.random() < 0.0008 ? (Math.random() - 0.5) * 1.5 : 0;
            data[i] = (b0 + b1) * 0.5 + patter;
        }
        const fade = ctx.sampleRate * 0.2;
        for (let i = 0; i < fade; i++) {
            const k = i / fade;
            data[i] = data[i] * k + data[data.length - fade + i] * (1 - k);
        }

        this.rain = new THREE.Audio(listener);
        this.rain.setBuffer(buffer);
        this.rain.setLoop(true);
        this.rain.setVolume(RAIN_VOLUME);
        const filter = ctx.createBiquadFilter();
        filter.type = 'bandpass';
        filter.frequency.value = 1800;
        filter.Q.value = 0.4;
        this.rain.setFilter(filter);
        this.rain.play();

        // thunder: low brown noise with a slow rumble envelope
        const tl = ctx.sampleRate * 5;
        this.thunderBuffer = ctx.createBuffer(1, tl, ctx.sampleRate);
        const td = this.thunderBuffer.getChannelData(0);
        let last = 0;
        for (let i = 0; i < tl; i++) {
            last = (last + 0.02 * (Math.random() * 2 - 1)) / 1.02;
            const s = i / ctx.sampleRate;
            const env = Math.min(s / 0.15, 1) * Math.exp(-s * 0.9) * (0.7 + 0.3 * Math.sin(s * 9));
            td[i] = last * 3.5 * env;
        }
    }

    thunder(delay: number) {
        const audioManager = this.application.world.audioManager;
        if (!audioManager || !this.thunderBuffer) return;
        const sound = new THREE.Audio(audioManager.listener);
        sound.setBuffer(this.thunderBuffer);
        sound.setVolume(THUNDER_VOLUME * (0.6 + Math.random() * 0.4));
        const filter = audioManager.listener.context.createBiquadFilter();
        filter.type = 'lowpass';
        filter.frequency.value = 400;
        sound.setFilter(filter);
        setTimeout(() => sound.play(), delay * 1000);
    }

    strike(t: number) {
        this.strikeStart = t;
        // two to four flickers in the first half second
        const count = 2 + Math.floor(Math.random() * 3);
        this.strikeFlickers = [...Array(count)].map((_, i) => i * (0.08 + Math.random() * 0.12));
        this.strikeAt = t + STRIKE_GAP.min + Math.random() * (STRIKE_GAP.max - STRIKE_GAP.min);
        this.thunder(0.8 + Math.random() * 1.6);
    }

    update() {
        const t = this.time.elapsed / 1000;
        this.glass.uniforms.uTime.value = t;

        if (!this.reduceMotion && t > this.strikeAt) this.strike(t);
        const s = t - this.strikeStart;
        let flash = 0;
        this.strikeFlickers.forEach((start, i) => {
            const k = s - start;
            if (k >= 0) flash = Math.max(flash, Math.exp(-k * 14) * (i === 0 ? 1 : 0.7));
        });
        this.flash = flash;
        this.glass.uniforms.uFlash.value = flash;
        this.lightning.intensity = flash * 1.4;
    }
}
