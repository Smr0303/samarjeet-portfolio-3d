import * as THREE from 'three';
import Application from '../Application';
import Camera, { CameraKey } from '../Camera/Camera';
import Sizes from '../Utils/Sizes';
import Time from '../Utils/Time';
import { FLOOR_Y, ROOM } from './Room';

/**
 * An electric guitar leaning against the back wall between the bookshelf and
 * the window: sunburst double-cutaway body, white pickguard, three pickups,
 * maple neck with a rosewood board and six tuners in a line. Click it and it
 * strums an E major chord (Karplus-Strong through an overdrive), played
 * through the scene's audio listener so the mute toggle covers it; the
 * strings shimmer while they ring.
 *
 * Local frame: y runs from the bottom of the body up the neck, the top faces
 * +z. The whole guitar is tipped back so its head rests on the wall.
 */
const BASE = new THREE.Vector3(-3420, FLOOR_Y, ROOM.back + 760);
const LEAN = -0.3; // top toward the wall
const TWIST = 0.12; // a little turned toward the room
const BODY_DEPTH = 150;
const NECK = { bottom: 860, top: 2200, width: 110 };
const BRIDGE_Y = 250;
const CHORD = [82.41, 123.47, 164.81, 207.65, 246.94, 329.63]; // E major
const STRUM_GAP = 0.022;
const RING = 2.6;

const COLORS = {
    edge: '#2a0e08',
    maple: '#e2bf86',
    fretboard: '#2b1d14',
    chrome: '#d8dbe0',
    string: '#e6dfcf',
    knob: '#efe9dc',
};

// Contour of the right half: bottom, waist, horn tip, cutaway into the neck
const OUTLINE: [number, number][] = [
    [0, 0], [250, 30], [355, 130], [390, 330], [335, 520], [265, 640],
    [320, 760], [355, 890], [330, 990], [250, 1015], [170, 950], [95, 880], [55, 860],
];

export default class Guitar {
    application: Application;
    scene: THREE.Scene;
    camera: Camera;
    sizes: Sizes;
    time: Time;
    raycaster: THREE.Raycaster;

    root: THREE.Group;
    strings: THREE.LineSegments;
    stringRest: Float32Array;
    hitbox: THREE.Mesh;
    pointer: THREE.Vector2 | null;
    hovered: boolean;
    hover: number;
    strummedAt: number;
    buffers?: AudioBuffer[];

    constructor() {
        this.application = new Application();
        this.scene = this.application.scene;
        this.camera = this.application.camera;
        this.sizes = this.application.sizes;
        this.time = this.application.time;
        this.raycaster = new THREE.Raycaster();
        this.pointer = null;
        this.hovered = false;
        this.hover = 0;
        this.strummedAt = -10;

        this.setModel();
        this.setListeners();
    }

    material(color: string, map?: THREE.Texture, shininess = 60) {
        return new THREE.MeshPhongMaterial({ color, map, specular: 0x555555, shininess });
    }

    setModel() {
        this.root = new THREE.Group();
        this.root.position.copy(BASE);
        this.root.rotation.set(LEAN, TWIST, 0, 'YXZ');
        this.scene.add(this.root);

        // Body: right-half contour mirrored, extruded, with a painted top
        const right = new THREE.SplineCurve(OUTLINE.map(([r, y]) => new THREE.Vector2(r, y))).getPoints(80);
        const shape = new THREE.Shape([
            ...right,
            ...right.slice().reverse().map((p) => new THREE.Vector2(-p.x, p.y)),
        ]);
        const body = new THREE.Mesh(
            new THREE.ExtrudeGeometry(shape, {
                depth: BODY_DEPTH,
                bevelEnabled: true,
                bevelThickness: 14,
                bevelSize: 12,
                bevelSegments: 4,
                curveSegments: 4,
            }),
            this.material(COLORS.edge)
        );
        body.position.z = -BODY_DEPTH / 2;
        this.root.add(body);

        const topTexture = this.createTopTexture();
        // ShapeGeometry UVs are raw x/y; map them onto the painted box
        topTexture.repeat.set(1 / 800, 1 / 1040);
        topTexture.offset.set(400 / 800, 0);
        const top = new THREE.Mesh(new THREE.ShapeGeometry(shape, 24), this.material('#ffffff', topTexture, 90));
        top.position.z = BODY_DEPTH / 2 + 15;
        this.root.add(top);

        // Bridge
        const chrome = this.material(COLORS.chrome, undefined, 100);
        const bridge = new THREE.Mesh(new THREE.BoxGeometry(150, 90, 20), chrome);
        bridge.position.set(0, BRIDGE_Y, BODY_DEPTH / 2 + 24);
        this.root.add(bridge);

        // Neck (maple) with the rosewood board on it
        const neckLength = NECK.top - NECK.bottom;
        const neck = new THREE.Mesh(new THREE.BoxGeometry(NECK.width, neckLength, 60), this.material(COLORS.maple));
        neck.position.set(0, NECK.bottom + neckLength / 2, BODY_DEPTH / 2 - 10);
        this.root.add(neck);
        const board = new THREE.Mesh(
            new THREE.PlaneGeometry(NECK.width, neckLength),
            this.material('#ffffff', this.createFretboardTexture(), 10)
        );
        board.position.set(0, NECK.bottom + neckLength / 2, BODY_DEPTH / 2 + 22);
        this.root.add(board);

        // Headstock with six tuners in a line on one side
        const head = new THREE.Mesh(new THREE.BoxGeometry(170, 380, 34), this.material(COLORS.maple));
        head.position.set(25, NECK.top + 190, BODY_DEPTH / 2 - 10);
        this.root.add(head);
        for (let i = 0; i < 6; i++) {
            const peg = new THREE.Mesh(new THREE.CylinderGeometry(14, 14, 60, 8), chrome);
            peg.rotation.z = Math.PI / 2;
            peg.position.set(-80, NECK.top + 50 + i * 56, BODY_DEPTH / 2 - 10);
            this.root.add(peg);
        }

        // Strings: bridge to nut
        const points: number[] = [];
        for (let i = 0; i < 6; i++) {
            const t = i / 5 - 0.5;
            points.push(t * 100, BRIDGE_Y, BODY_DEPTH / 2 + 36, t * 76, NECK.top, BODY_DEPTH / 2 + 28);
        }
        const geometry = new THREE.BufferGeometry();
        this.stringRest = new Float32Array(points);
        geometry.setAttribute('position', new THREE.BufferAttribute(new Float32Array(points), 3));
        this.strings = new THREE.LineSegments(
            geometry,
            new THREE.LineBasicMaterial({ color: COLORS.string, transparent: true, opacity: 0.85 })
        );
        this.root.add(this.strings);

        this.hitbox = new THREE.Mesh(
            new THREE.BoxGeometry(820, 2600, 300),
            new THREE.MeshBasicMaterial({ visible: false })
        );
        this.hitbox.position.set(0, 1290, 0);
        this.root.add(this.hitbox);
    }

    /** Sunburst top, white pickguard, three single coils, knobs. */
    createTopTexture() {
        const w = 400;
        const h = 520;
        const canvas = document.createElement('canvas');
        canvas.width = w;
        canvas.height = h;
        const ctx = canvas.getContext('2d') as CanvasRenderingContext2D;
        // body coords: x -400..400, y 0..1040 (canvas y flipped)
        const px = (x: number) => ((x + 400) / 800) * w;
        const py = (y: number) => (1 - y / 1040) * h;
        const s = (v: number) => (v / 800) * w;

        const burst = ctx.createRadialGradient(px(0), py(420), s(40), px(0), py(420), s(470));
        burst.addColorStop(0, '#f2b43a');
        burst.addColorStop(0.55, '#d0611c');
        burst.addColorStop(0.85, '#6a1d0c');
        burst.addColorStop(1, COLORS.edge);
        ctx.fillStyle = burst;
        ctx.fillRect(0, 0, w, h);

        // pickguard: a rounded shape around the pickups, off to one side
        ctx.fillStyle = '#f3efe6';
        ctx.beginPath();
        ctx.moveTo(px(-60), py(900));
        ctx.quadraticCurveTo(px(-260), py(860), px(-280), py(640));
        ctx.quadraticCurveTo(px(-300), py(330), px(-120), py(170));
        ctx.quadraticCurveTo(px(60), py(110), px(170), py(240));
        ctx.lineTo(px(210), py(420));
        ctx.quadraticCurveTo(px(150), py(560), px(80), py(900));
        ctx.closePath();
        ctx.fill();

        // three pickups with pole pieces
        [[0, 760], [0, 590], [0, 380]].forEach(([x, y], i) => {
            ctx.save();
            ctx.translate(px(x), py(y));
            ctx.rotate(i === 2 ? -0.18 : 0);
            ctx.fillStyle = '#1b1b1e';
            ctx.fillRect(-s(85), -s(22), s(170), s(44));
            ctx.fillStyle = '#9ea2a8';
            for (let k = 0; k < 6; k++) ctx.fillRect(-s(70) + k * s(28), -s(5), s(8), s(10));
            ctx.restore();
        });
        // volume and tone knobs, and the selector
        ctx.fillStyle = COLORS.knob;
        [[200, 260], [235, 170], [255, 80]].forEach(([x, y]) => {
            ctx.beginPath();
            ctx.arc(px(x - 40), py(y + 40), s(24), 0, Math.PI * 2);
            ctx.fill();
        });
        ctx.fillRect(px(140), py(470), s(16), s(40));

        const texture = new THREE.CanvasTexture(canvas);
        texture.encoding = THREE.sRGBEncoding;
        return texture;
    }

    /** Rosewood board with frets closing up toward the body, and dots. */
    createFretboardTexture() {
        const w = 64;
        const h = 1024;
        const canvas = document.createElement('canvas');
        canvas.width = w;
        canvas.height = h;
        const ctx = canvas.getContext('2d') as CanvasRenderingContext2D;
        ctx.fillStyle = COLORS.fretboard;
        ctx.fillRect(0, 0, w, h);
        ctx.fillStyle = COLORS.chrome;
        let y = 6;
        let gap = 82;
        for (let fret = 1; fret <= 21 && y < h; fret++) {
            ctx.fillRect(0, y, w, 3);
            if ([3, 5, 7, 9, 12, 15, 17, 19].includes(fret)) {
                ctx.fillStyle = '#e9e2d0';
                ctx.beginPath();
                ctx.arc(w / 2, y + gap * 0.5, 5, 0, Math.PI * 2);
                ctx.fill();
                ctx.fillStyle = COLORS.chrome;
            }
            y += gap;
            gap *= 0.944; // twelfth root of two, roughly
        }
        const texture = new THREE.CanvasTexture(canvas);
        texture.encoding = THREE.sRGBEncoding;
        return texture;
    }

    setListeners() {
        const toPointer = (event: MouseEvent) =>
            new THREE.Vector2(
                (event.clientX / this.sizes.width) * 2 - 1,
                -(event.clientY / this.sizes.height) * 2 + 1
            );
        const inUi = (event: MouseEvent) => !!(event.target as HTMLElement).closest?.('[data-ui]');
        window.addEventListener('mousemove', (event) => {
            this.pointer = inUi(event) ? null : toPointer(event);
        });
        window.addEventListener(
            'mousedown',
            (event) => {
                // @ts-ignore
                if (!inUi(event) && this.isOver(toPointer(event))) event.catHandled = true;
            },
            true
        );
        window.addEventListener('click', (event) => {
            if (!inUi(event) && this.isOver(toPointer(event))) this.strum();
        });
    }

    isOver(pointer: THREE.Vector2) {
        if (this.camera.freeCam || this.camera.currentKeyframe === CameraKey.MONITOR) return false;
        this.raycaster.setFromCamera(pointer, this.camera.instance);
        return this.raycaster.intersectObject(this.hitbox).length > 0;
    }

    /** Karplus-Strong: a noise burst in a delay line that keeps averaging. */
    pluck(ctx: BaseAudioContext, frequency: number) {
        const rate = ctx.sampleRate;
        const buffer = ctx.createBuffer(1, Math.floor(rate * RING), rate);
        const out = buffer.getChannelData(0);
        const period = Math.round(rate / frequency);
        const line = new Float32Array(period);
        for (let i = 0; i < period; i++) line[i] = Math.random() * 2 - 1;
        let k = 0;
        for (let i = 0; i < out.length; i++) {
            const next = (k + 1) % period;
            const sample = line[k];
            line[k] = 0.4988 * (line[k] + line[next]);
            out[i] = sample * 0.3;
            k = next;
        }
        return buffer;
    }

    /** A soft-clipping curve for a little amp grit. */
    overdrive(amount: number) {
        const curve = new Float32Array(1024);
        for (let i = 0; i < curve.length; i++) {
            const x = (i / (curve.length - 1)) * 2 - 1;
            curve[i] = Math.tanh(x * amount) / Math.tanh(amount);
        }
        return curve;
    }

    strum() {
        const audioManager = this.application.world.audioManager;
        if (!audioManager) return;
        const listener = audioManager.listener;
        const ctx = listener.context;
        if (ctx.state !== 'running') ctx.resume();
        if (!this.buffers) this.buffers = CHORD.map((f) => this.pluck(ctx, f));

        // strings -> overdrive -> cabinet-ish lowpass -> listener
        const drive = ctx.createWaveShaper();
        drive.curve = this.overdrive(3.5);
        const cab = ctx.createBiquadFilter();
        cab.type = 'lowpass';
        cab.frequency.value = 3200;
        const level = ctx.createGain();
        level.gain.value = 0.6;
        drive.connect(cab).connect(level).connect(listener.getInput());

        const start = ctx.currentTime + 0.02;
        this.buffers.forEach((buffer, i) => {
            const source = ctx.createBufferSource();
            source.buffer = buffer;
            source.connect(drive);
            source.start(start + i * STRUM_GAP);
        });
        this.strummedAt = this.time.elapsed / 1000;
    }

    update() {
        const t = this.time.elapsed / 1000;
        const dt = Math.min(this.time.delta, 100) / 1000;

        const over = this.pointer ? this.isOver(this.pointer) : false;
        if (over !== this.hovered) {
            this.hovered = over;
            document.body.style.cursor = over ? 'pointer' : '';
        }
        this.hover += ((over ? 1 : 0) - this.hover) * (1 - Math.exp(-dt * 8));
        // it rocks a touch against the wall when hovered or strummed
        const since = t - this.strummedAt;
        const knock = since < 2 ? Math.sin(since * 10) * Math.exp(-since * 3) * 0.015 : 0;
        this.root.rotation.z = this.hover * 0.01 * Math.sin(t * 3) + knock;

        // ringing strings shimmer sideways
        const ring = since < RING ? Math.exp(-since * 1.6) : 0;
        const pos = this.strings.geometry.attributes.position as THREE.BufferAttribute;
        for (let i = 0; i < 6; i++) {
            const wobble = ring * Math.sin(t * (60 + i * 9)) * 5;
            pos.setX(i * 2, this.stringRest[i * 6] + wobble);
            pos.setX(i * 2 + 1, this.stringRest[i * 6 + 3] + wobble * 0.3);
        }
        pos.needsUpdate = true;
    }
}
