import * as THREE from 'three';
import Application from '../Application';
import Debug from '../Utils/Debug';
import Time from '../Utils/Time';
import UIEventBus from '../UI/EventBus';

/**
 * Night room: the CRT is the only light in the room.
 *
 * The three room models are baked (lighting painted into their textures), so
 * they are shaded with a per-pixel lit material + computed normals (see
 * Utils/BakedModel.ts) and lit here with a dim cool ambient plus two point
 * lights parked just in front of the screen: a teal one that carries the
 * colour of the Windows-95 desktop, and a weak warm one so paper and keys
 * read off-white rather than cyan.
 *
 * "Day" is the same rig with a white ambient at full and the point lights off:
 * Phong × white ambient renders the baked textures exactly as the original
 * unlit look, so switching theme is only a lerp of light values.
 */
export const NIGHT = true;

export type RoomTheme = 'night' | 'day';
const STORAGE_KEY = 'room-theme';

export const NIGHT_TOKENS = {
    ink: '#0b0e13', // page / backdrop behind the scene
    ambient: '#2a3140', // what unlit surfaces read as
    glow: '#8fd9d3', // OS desktop teal, lifted two stops
    spill: '#f2e8d0', // the "paper" of the OS windows
};

const DEFAULTS = {
    ambientIntensity: 0.16,
    glowIntensity: 3.4,
    spillIntensity: 0.8,
    distance: 2000,
    decay: 2,
    // Screen centre is (0, 950, 255) facing +z; the lights sit a little in
    // front of it so the keyboard and desk catch the falloff.
    x: 0,
    y: 860,
    z: 600,
};

const DAY = {
    ambientColor: '#ffffff',
    ambientIntensity: 1.0,
};

// Cross-fade time constant; ~1.2 s to settle.
const TAU = 0.35;
// Entering night, the glow overshoots briefly like a CRT warming up.
const OVERSHOOT = 1.25;
const OVERSHOOT_MS = 300;

/**
 * Query-string overrides for tuning without a rebuild, e.g.
 * ?ambient=0.2&glow=3&spill=0.6&distance=1800&decay=2&ly=850&lz=600
 */
function tuned(): typeof DEFAULTS {
    const q = new URLSearchParams(window.location.search);
    const num = (key: string, fallback: number) => {
        const v = q.get(key);
        return v !== null && !isNaN(Number(v)) ? Number(v) : fallback;
    };
    return {
        ambientIntensity: num('ambient', DEFAULTS.ambientIntensity),
        glowIntensity: num('glow', DEFAULTS.glowIntensity),
        spillIntensity: num('spill', DEFAULTS.spillIntensity),
        distance: num('distance', DEFAULTS.distance),
        decay: num('decay', DEFAULTS.decay),
        x: num('lx', DEFAULTS.x),
        y: num('ly', DEFAULTS.y),
        z: num('lz', DEFAULTS.z),
    };
}

export function storedTheme(): RoomTheme {
    try {
        const v = window.localStorage.getItem(STORAGE_KEY);
        if (v === 'day' || v === 'night') return v;
    } catch (e) {}
    const q = new URLSearchParams(window.location.search).get('theme');
    return q === 'day' ? 'day' : 'night';
}

export function storeTheme(theme: RoomTheme) {
    try {
        window.localStorage.setItem(STORAGE_KEY, theme);
    } catch (e) {}
}

interface LightTargets {
    ambientColor: THREE.Color;
    ambientIntensity: number;
    glowIntensity: number;
    spillIntensity: number;
}

export default class Lighting {
    application: Application;
    scene: THREE.Scene;
    debug: Debug;
    time: Time;
    ambient: THREE.AmbientLight;
    glow: THREE.PointLight;
    spill: THREE.PointLight;
    theme: RoomTheme;
    nightAmbient: THREE.Color;
    nightAmbientIntensity: number;
    nightGlow: number;
    nightSpill: number;
    glowScale: number;
    target: LightTargets;
    overshootUntil: number;
    reduceMotion: boolean;

    constructor() {
        this.application = new Application();
        this.scene = this.application.scene;
        this.debug = this.application.debug;
        this.time = this.application.time;
        const t = tuned();

        this.nightAmbient = new THREE.Color(NIGHT_TOKENS.ambient);
        this.nightAmbientIntensity = t.ambientIntensity;
        this.nightGlow = t.glowIntensity;
        this.nightSpill = t.spillIntensity;
        this.glowScale = 1;
        this.overshootUntil = 0;
        this.reduceMotion =
            window.matchMedia &&
            window.matchMedia('(prefers-reduced-motion: reduce)').matches;

        this.ambient = new THREE.AmbientLight(
            NIGHT_TOKENS.ambient,
            t.ambientIntensity
        );

        this.glow = new THREE.PointLight(
            NIGHT_TOKENS.glow,
            t.glowIntensity,
            t.distance,
            t.decay
        );
        this.glow.position.set(t.x, t.y, t.z);

        this.spill = new THREE.PointLight(
            NIGHT_TOKENS.spill,
            t.spillIntensity,
            t.distance,
            t.decay
        );
        this.spill.position.copy(this.glow.position);

        this.scene.add(this.ambient, this.glow, this.spill);

        this.theme = storedTheme();
        this.target = this.targetsFor(this.theme);
        this.snap();

        UIEventBus.on('themeToggle', (theme: RoomTheme) => {
            this.setTheme(theme);
        });

        if (this.debug.active) this.setDebug();
    }

    targetsFor(theme: RoomTheme): LightTargets {
        if (theme === 'day') {
            return {
                ambientColor: new THREE.Color(DAY.ambientColor),
                ambientIntensity: DAY.ambientIntensity,
                glowIntensity: 0,
                spillIntensity: 0,
            };
        }
        return {
            ambientColor: this.nightAmbient.clone(),
            ambientIntensity: this.nightAmbientIntensity,
            glowIntensity: this.nightGlow * this.glowScale,
            spillIntensity: this.nightSpill,
        };
    }

    setTheme(theme: RoomTheme) {
        const entering = theme === 'night' && this.theme !== 'night';
        this.theme = theme;
        this.target = this.targetsFor(theme);
        storeTheme(theme);
        if (this.reduceMotion) {
            this.snap();
            return;
        }
        this.overshootUntil = entering ? Date.now() + OVERSHOOT_MS : 0;
    }

    /** The OS tells us what colour its desktop is; the room takes that light. */
    setGlowColor(hex: string, scale: number = 1) {
        this.glow.color.set(hex);
        this.glowScale = scale;
        this.target = this.targetsFor(this.theme);
    }

    snap() {
        this.ambient.color.copy(this.target.ambientColor);
        this.ambient.intensity = this.target.ambientIntensity;
        this.glow.intensity = this.target.glowIntensity;
        this.spill.intensity = this.target.spillIntensity;
    }

    update() {
        const dt = Math.min(this.time.delta, 100) / 1000;
        const k = 1 - Math.exp(-dt / TAU);

        const glowTarget =
            Date.now() < this.overshootUntil
                ? this.target.glowIntensity * OVERSHOOT
                : this.target.glowIntensity;

        this.ambient.color.lerp(this.target.ambientColor, k);
        this.ambient.intensity +=
            (this.target.ambientIntensity - this.ambient.intensity) * k;
        this.glow.intensity += (glowTarget - this.glow.intensity) * k;
        this.spill.intensity +=
            (this.target.spillIntensity - this.spill.intensity) * k;
    }

    setDebug() {
        const folder = this.debug.ui.addFolder('Night lighting');
        folder.add(this, 'nightAmbientIntensity', 0, 2, 0.01).name('ambient');
        folder.add(this, 'nightGlow', 0, 6, 0.01).name('glow');
        folder.add(this, 'nightSpill', 0, 3, 0.01).name('spill');
        folder.addColor(this.glow, 'color').name('glow colour');
        folder.addColor(this.spill, 'color').name('spill colour');
        folder.add(this.glow, 'distance', 500, 8000, 10).name('distance');
        folder.add(this.glow, 'decay', 0, 3, 0.05).name('decay');
        folder
            .add(this.glow.position, 'x', -1500, 1500, 5)
            .onChange(() => this.spill.position.copy(this.glow.position));
        folder
            .add(this.glow.position, 'y', 0, 2000, 5)
            .onChange(() => this.spill.position.copy(this.glow.position));
        folder
            .add(this.glow.position, 'z', -500, 2000, 5)
            .onChange(() => this.spill.position.copy(this.glow.position));
        folder.onChange(() => {
            this.target = this.targetsFor(this.theme);
        });
    }
}
