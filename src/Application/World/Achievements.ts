import * as THREE from 'three';
import Application from '../Application';
import Camera, { CameraKey } from '../Camera/Camera';
import Sizes from '../Utils/Sizes';
import Time from '../Utils/Time';
import { ROOM } from './Room';

/**
 * A gallery on the right wall, each frame under a small brass picture
 * light that throws a warm pool on the wall. The top row is profiles:
 * clicking one opens it in a new tab. Hovering any frame lifts it off the
 * wall and turns its light up.
 *
 * The wall's inner face is at x = ROOM.right facing -x, so frames are
 * turned to face -x and their local +x runs along world +z.
 */
type Achievement = {
    kicker: string; // small caps line at the top
    big: string; // the number
    label: string; // what the number is
    note?: string;
    accent: string;
    plaque?: boolean; // brass plaque instead of a poster
    url?: string; // opens on click
};

const TOP_ROW: Achievement[] = [
    { kicker: 'CODEFORCES', big: '@zyab', label: 'Specialist · 1562', note: 'open profile ↗', accent: '#4f8fd6', url: 'https://codeforces.com/profile/zyab' },
    { kicker: 'GITHUB', big: '@Smr0303', label: 'code & side projects', note: 'open profile ↗', accent: '#9aa4b2', url: 'https://github.com/Smr0303' },
    { kicker: 'LEETCODE', big: '@Smohite3', label: 'Knight · 1860', note: 'open profile ↗', accent: '#e8a23a', url: 'https://leetcode.com/u/Smohite3/' },
    { kicker: 'LINKEDIN', big: 'in/smr0x03', label: 'say hi', note: 'open profile ↗', accent: '#4b8fc9', url: 'https://www.linkedin.com/in/smr0x03/' },
];
const BOTTOM_ROW: Achievement[] = [
    { kicker: 'CODEFORCES ROUND 760', big: '#38', label: 'Rank in the round', accent: '#c4483f' },
    { kicker: 'IIT JEE ADVANCED', big: '9085', label: 'General Rank', accent: '#6c8f6a' },
    { kicker: 'NURIX AI · FORWARD-DEPLOYED', big: '$200K+', label: 'ARR on conversational agents', accent: '#c9a46a', plaque: true },
];

const TOP = { y: 3750, width: 1150, height: 1450, z0: -900, gap: 1450 };
const BOTTOM = { y: 1650, width: 1650, height: 1250, z0: -600, gap: 2050 };
const FRAME_DEPTH = 60;
const BORDER = 70;
const LIFT = 90; // how far a hovered frame comes off the wall

const COLORS = {
    wood: '#2a1f18',
    mat: '#ece6d8',
    ink: '#1b1f27',
    brass: '#d9b56a',
    bulb: '#ffe2a8',
    pool: '255,214,150',
};

type Frame = {
    url?: string;
    group: THREE.Group;
    poster: THREE.Mesh;
    pool: THREE.Mesh;
    hover: number;
};

export default class Achievements {
    application: Application;
    scene: THREE.Scene;
    camera: Camera;
    sizes: Sizes;
    time: Time;
    raycaster: THREE.Raycaster;
    pointer: THREE.Vector2 | null;
    frames: Frame[];
    hovered: Frame | null;

    constructor() {
        this.application = new Application();
        this.scene = this.application.scene;
        this.camera = this.application.camera;
        this.sizes = this.application.sizes;
        this.time = this.application.time;
        this.raycaster = new THREE.Raycaster();
        this.pointer = null;
        this.frames = [];
        this.hovered = null;

        const poolTexture = this.createPoolTexture();
        TOP_ROW.forEach((a, i) =>
            this.addFrame(a, TOP.z0 + i * TOP.gap, TOP.y, TOP.width, TOP.height, poolTexture)
        );
        BOTTOM_ROW.forEach((a, i) =>
            this.addFrame(a, BOTTOM.z0 + i * BOTTOM.gap, BOTTOM.y, BOTTOM.width, BOTTOM.height, poolTexture)
        );

        // panels over the scene (the call panel) are not the wall
        const inUi = (event: MouseEvent) =>
            !!(event.target as HTMLElement).closest?.('[data-ui]');
        window.addEventListener('mousemove', (event) => {
            this.pointer = inUi(event) ? null : this.toPointer(event);
        });
        // Capture phase, like the cat, so a click on a profile doesn't also
        // move the camera; the tab opens on click (a user gesture)
        window.addEventListener(
            'mousedown',
            (event) => {
                // @ts-ignore
                if (!inUi(event) && this.frameAt(this.toPointer(event))?.url) event.catHandled = true;
            },
            true
        );
        window.addEventListener('click', (event) => {
            const url = !inUi(event) && this.frameAt(this.toPointer(event))?.url;
            if (url) window.open(url, '_blank', 'noopener');
        });
    }

    toPointer(event: MouseEvent) {
        return new THREE.Vector2(
            (event.clientX / this.sizes.width) * 2 - 1,
            -(event.clientY / this.sizes.height) * 2 + 1
        );
    }

    /** The frame under the pointer, unless the camera is in the monitor. */
    frameAt(pointer: THREE.Vector2): Frame | null {
        if (this.camera.currentKeyframe === CameraKey.MONITOR) return null;
        this.raycaster.setFromCamera(pointer, this.camera.instance);
        const hits = this.raycaster.intersectObjects(this.frames.map((f) => f.poster));
        if (!hits.length) return null;
        return this.frames.find((f) => f.poster === hits[0].object) || null;
    }

    addFrame(
        a: Achievement,
        z: number,
        y: number,
        width: number,
        height: number,
        poolTexture: THREE.Texture
    ) {
        const group = new THREE.Group();
        group.position.set(ROOM.right - 4, y, z);
        group.rotation.y = -Math.PI / 2;
        this.scene.add(group);

        // Wooden frame (lit by the room) around a poster that carries its
        // own picture-light shading
        const wood = new THREE.MeshPhongMaterial({
            color: a.plaque ? '#3a2a1c' : COLORS.wood,
            specular: 0x000000,
            shininess: 0,
        });
        const frame = new THREE.Mesh(
            new THREE.BoxGeometry(width + BORDER * 2, height + BORDER * 2, FRAME_DEPTH),
            wood
        );
        frame.position.z = FRAME_DEPTH / 2;
        group.add(frame);

        const posterMaterial = new THREE.MeshBasicMaterial({
            map: this.createPosterTexture(a, width, height),
        });
        posterMaterial.color.setScalar(0.85);
        const poster = new THREE.Mesh(new THREE.PlaneGeometry(width, height), posterMaterial);
        // far enough off the frame face to avoid z-fighting from the idle camera
        poster.position.z = FRAME_DEPTH + 8;
        group.add(poster);

        // Brass picture light: an arm and a bar with a glowing underside
        const brass = new THREE.MeshPhongMaterial({ color: COLORS.brass, specular: 0x222222, shininess: 30 });
        const top = height / 2 + BORDER;
        const arm = new THREE.Mesh(new THREE.BoxGeometry(24, 24, 180), brass);
        arm.position.set(0, top + 90, 90);
        group.add(arm);
        const bar = new THREE.Mesh(
            new THREE.CylinderGeometry(32, 32, width * 0.55, 16),
            brass
        );
        bar.rotation.z = Math.PI / 2;
        bar.position.set(0, top + 90, 190);
        group.add(bar);
        const bulb = new THREE.Mesh(
            new THREE.PlaneGeometry(width * 0.5, 14),
            new THREE.MeshBasicMaterial({ color: COLORS.bulb })
        );
        bulb.rotation.x = Math.PI / 2;
        bulb.position.set(0, top + 57, 190);
        group.add(bulb);

        // Warm pool of light on the wall around the frame
        const pool = new THREE.Mesh(
            new THREE.PlaneGeometry(width * 2.1, height * 1.7),
            new THREE.MeshBasicMaterial({
                map: poolTexture,
                transparent: true,
                opacity: 0.55,
                blending: THREE.AdditiveBlending,
                depthWrite: false,
            })
        );
        pool.position.set(0, height * 0.18, 2);
        group.add(pool);

        this.frames.push({ url: a.url, group, poster, pool, hover: 0 });
    }

    /** Radial warm glow, strongest just under the lamp. */
    createPoolTexture() {
        const w = 256;
        const h = 256;
        const canvas = document.createElement('canvas');
        canvas.width = w;
        canvas.height = h;
        const ctx = canvas.getContext('2d') as CanvasRenderingContext2D;
        const g = ctx.createRadialGradient(w / 2, h * 0.18, 4, w / 2, h * 0.45, w * 0.55);
        g.addColorStop(0, `rgba(${COLORS.pool},0.55)`);
        g.addColorStop(0.35, `rgba(${COLORS.pool},0.22)`);
        g.addColorStop(1, `rgba(${COLORS.pool},0)`);
        ctx.fillStyle = g;
        ctx.fillRect(0, 0, w, h);
        return new THREE.CanvasTexture(canvas);
    }

    /**
     * Poster: cream mat, a dark card with a coloured rule, the kicker, a big
     * number and its label. The plaque variant is brass with engraved text.
     * The top is lit and it falls off downward, as under a picture light.
     */
    createPosterTexture(a: Achievement, width: number, height: number) {
        const scale = 512 / width;
        const w = 512;
        const h = Math.round(height * scale);
        const canvas = document.createElement('canvas');
        canvas.width = w;
        canvas.height = h;
        const ctx = canvas.getContext('2d') as CanvasRenderingContext2D;
        const serif = 'Georgia, "Times New Roman", serif';
        const mono = '"Courier New", Courier, monospace';

        if (a.plaque) {
            const brass = ctx.createLinearGradient(0, 0, w, h);
            brass.addColorStop(0, '#e9cd8c');
            brass.addColorStop(0.5, '#b88f4c');
            brass.addColorStop(1, '#d9b56a');
            ctx.fillStyle = brass;
            ctx.fillRect(0, 0, w, h);
            ctx.strokeStyle = 'rgba(70,45,15,0.6)';
            ctx.lineWidth = 6;
            ctx.strokeRect(18, 18, w - 36, h - 36);
            ctx.fillStyle = '#3b2610';
        } else {
            ctx.fillStyle = COLORS.mat;
            ctx.fillRect(0, 0, w, h);
            const m = 34;
            ctx.fillStyle = COLORS.ink;
            ctx.fillRect(m, m, w - m * 2, h - m * 2);
            ctx.fillStyle = a.accent;
            ctx.fillRect(m, m, w - m * 2, 10);
            ctx.fillStyle = '#f3efe6';
        }

        ctx.textAlign = 'center';
        ctx.textBaseline = 'middle';
        const fit = (text: string, font: (px: number) => string, px: number, maxW: number) => {
            ctx.font = font(px);
            while (ctx.measureText(text).width > maxW && px > 10) {
                px -= 2;
                ctx.font = font(px);
            }
        };

        fit(a.kicker, (px) => `bold ${px}px ${mono}`, 26, w - 110);
        ctx.globalAlpha = 0.8;
        ctx.fillText(a.kicker, w / 2, h * 0.2);
        ctx.globalAlpha = 1;

        fit(a.big, (px) => `bold ${px}px ${serif}`, Math.min(150, h * 0.25), w - 110);
        if (!a.plaque) ctx.fillStyle = a.accent;
        ctx.fillText(a.big, w / 2, h * 0.47);

        ctx.fillStyle = a.plaque ? '#3b2610' : '#f3efe6';
        fit(a.label, (px) => `italic ${px}px ${serif}`, Math.min(40, h * 0.08), w - 110);
        ctx.fillText(a.label, w / 2, h * 0.68);
        if (a.note) {
            fit(a.note, (px) => `${px}px ${mono}`, 22, w - 110);
            ctx.globalAlpha = 0.6;
            ctx.fillText(a.note, w / 2, h * 0.79);
            ctx.globalAlpha = 1;
        }

        // picture-light falloff
        const light = ctx.createLinearGradient(0, 0, 0, h);
        light.addColorStop(0, 'rgba(255,225,170,0.12)');
        light.addColorStop(0.5, 'rgba(0,0,0,0)');
        light.addColorStop(1, 'rgba(0,0,0,0.35)');
        ctx.fillStyle = light;
        ctx.fillRect(0, 0, w, h);

        const texture = new THREE.CanvasTexture(canvas);
        texture.encoding = THREE.sRGBEncoding;
        texture.anisotropy = 4;
        return texture;
    }

    update() {
        const dt = Math.min(this.time.delta, 100) / 1000;

        const hit = this.pointer ? this.frameAt(this.pointer) : null;
        if (hit !== this.hovered) {
            this.hovered = hit;
            document.body.style.cursor = hit?.url ? 'pointer' : '';
        }

        const k = 1 - Math.exp(-dt * 10);
        this.frames.forEach((f) => {
            f.hover += ((f === hit ? 1 : 0) - f.hover) * k;
            // lift off the wall along its facing (-x)
            f.group.position.x = ROOM.right - 4 - f.hover * LIFT;
            f.group.scale.setScalar(1 + f.hover * 0.04);
            (f.pool.material as THREE.MeshBasicMaterial).opacity = 0.55 + f.hover * 0.4;
            (f.poster.material as THREE.MeshBasicMaterial).color.setScalar(0.85 + f.hover * 0.15);
        });
    }
}
