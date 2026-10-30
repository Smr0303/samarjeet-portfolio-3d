import * as THREE from 'three';
import Application from '../Application';
import Time from '../Utils/Time';
import { SCREEN_SIZE } from './MonitorScreen';

/**
 * The modern desk setup: a slim monitor on an arm clamped to the back of the
 * desk (its panel is MonitorScreen's OS iframe), a desk mat, a low-profile
 * keyboard and mouse, and a laptop on an aluminium stand typing out code.
 *
 * World units match the GLBs: desk top y -452, desk spans x -3587..2481 and
 * z -1146..1639. The OS panel is centred at (0, 950, 255), tilted back 3°.
 */
const DESK_Y = -452;
const SCREEN = { x: 0, y: 950, z: 255, tilt: -3 * THREE.MathUtils.DEG2RAD };
const BEZEL = 26;
// where the old CRT setup kept them, so the cat's paw still finds the mouse
const KEYBOARD = new THREE.Vector3(-200, DESK_Y, 1290);
const MOUSE = new THREE.Vector3(826, DESK_Y, 1320);
const LAPTOP = { position: new THREE.Vector3(-1720, DESK_Y, -260), heading: 0.55 };

const COLORS = {
    bezel: '#0b0c0f',
    shell: '#24272e',
    arm: '#2b2e35',
    mat: '#1b1d22',
    keyboard: '#1d2026',
    mouse: '#1d2026',
    aluminium: '#a9adb5',
    laptop: '#8d929b',
};

const CODE = [
    '# relay/engine.py: durable execution, effectively once',
    'async def run(workflow_id: str) -> None:',
    '    async with db.transaction():',
    '        run = await claim(workflow_id)  # FOR UPDATE SKIP LOCKED',
    '    for step in run.steps:',
    '        if step.id in run.journal:',
    '            continue  # replay: already done',
    '        result = await step.execute(key=step.idempotency_key)',
    '        await journal.append(run.id, step.id, result)',
    '    await complete(run)',
    '',
    '# chaos test: kill workers mid-run, count the charges',
    'assert charges == 1000',
];
const KEYWORDS = /\b(async|def|await|with|for|in|if|continue|return|assert|None|str)\b/g;

export default class Workstation {
    application: Application;
    scene: THREE.Scene;
    time: Time;

    codeCanvas: HTMLCanvasElement;
    codeTexture: THREE.CanvasTexture;
    typed: number;
    lastDraw: number;

    constructor() {
        this.application = new Application();
        this.scene = this.application.scene;
        this.time = this.application.time;
        this.typed = 0;
        this.lastDraw = 0;

        // the laptop takes this paper stack's spot
        const stack = this.scene.getObjectByName('paper_stack_1');
        if (stack) stack.visible = false;

        this.setMonitor();
        this.setDeskItems();
        this.setLaptop();
    }

    material(color: string, shininess = 20, map?: THREE.Texture) {
        return new THREE.MeshPhongMaterial({ color, map, specular: 0x222222, shininess });
    }

    box(material: THREE.Material, size: [number, number, number], position: [number, number, number], parent: THREE.Object3D = this.scene) {
        const mesh = new THREE.Mesh(new THREE.BoxGeometry(...size), material);
        mesh.position.set(...position);
        parent.add(mesh);
        return mesh;
    }

    /** A round bar from a to b. */
    bar(material: THREE.Material, a: THREE.Vector3, b: THREE.Vector3, radius: number) {
        const length = a.distanceTo(b);
        const mesh = new THREE.Mesh(new THREE.CylinderGeometry(radius, radius, length, 16), material);
        mesh.position.copy(a).add(b).multiplyScalar(0.5);
        mesh.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), b.clone().sub(a).normalize());
        this.scene.add(mesh);
        return mesh;
    }

    setMonitor() {
        const w = SCREEN_SIZE.w + BEZEL * 2;
        const h = SCREEN_SIZE.h + BEZEL * 2;
        const group = new THREE.Group();
        group.position.set(SCREEN.x, SCREEN.y, SCREEN.z);
        group.rotation.x = SCREEN.tilt;
        this.scene.add(group);

        // thin black bezel just behind the panel plane, a slightly smaller
        // housing behind it, and a slim chin with a power light
        this.box(this.material(COLORS.bezel, 40), [w, h, 30], [0, 0, -17], group);
        this.box(this.material(COLORS.shell, 15), [w - 120, h - 120, 50], [0, 0, -55], group);
        const led = this.box(new THREE.MeshBasicMaterial({ color: '#7cf2ff' }), [18, 6, 4], [w / 2 - 70, -h / 2 + 10, 0], group);
        led.name = 'monitor-led';
        // VESA plate
        this.box(this.material(COLORS.arm), [260, 260, 40], [0, -40, -100], group);

        // Arm: clamp at the back edge, a pole, and two links to the plate
        const arm = this.material(COLORS.arm, 30);
        const back = -1080;
        const clamp = new THREE.Vector3(0, DESK_Y, back);
        this.box(arm, [220, 60, 220], [clamp.x, DESK_Y + 30, back]);
        const top = new THREE.Vector3(0, 760, back);
        this.bar(arm, clamp, top, 45);
        const elbow = new THREE.Vector3(260, 820, -430);
        const plate = new THREE.Vector3(0, SCREEN.y - 40, SCREEN.z - 120);
        this.bar(arm, top, elbow, 38);
        this.bar(arm, elbow, plate, 38);
        [top, elbow].forEach((p) => {
            const joint = new THREE.Mesh(new THREE.SphereGeometry(55, 16, 12), arm);
            joint.position.copy(p);
            this.scene.add(joint);
        });
    }

    setDeskItems() {
        // full-size felt desk pad; it also covers the old CRT case's shadow
        // baked into the desk texture
        this.box(this.material(COLORS.mat, 2), [2950, 8, 2520], [275, DESK_Y + 4, 360]);

        // low-profile keyboard, keycaps painted on
        const caps = this.createKeycapTexture();
        const keyboard = new THREE.Group();
        keyboard.position.copy(KEYBOARD).add(new THREE.Vector3(0, 8, 0));
        keyboard.rotation.x = 0.04;
        this.scene.add(keyboard);
        const top = [this.material(COLORS.keyboard), this.material(COLORS.keyboard),
            this.material('#ffffff', 10, caps), this.material(COLORS.keyboard),
            this.material(COLORS.keyboard), this.material(COLORS.keyboard)];
        const board = new THREE.Mesh(new THREE.BoxGeometry(1320, 36, 420), top);
        board.position.y = 18;
        keyboard.add(board);

        // mouse: a low ellipsoid
        const mouse = new THREE.Mesh(new THREE.SphereGeometry(1, 24, 16, 0, Math.PI * 2, 0, Math.PI / 2), this.material(COLORS.mouse, 60));
        mouse.scale.set(115, 70, 175);
        mouse.position.copy(MOUSE).add(new THREE.Vector3(0, 8, 0));
        this.scene.add(mouse);
    }

    setLaptop() {
        const group = new THREE.Group();
        group.position.copy(LAPTOP.position);
        group.rotation.y = LAPTOP.heading;
        this.scene.add(group);
        const alu = this.material(COLORS.aluminium, 50);
        const body = this.material(COLORS.laptop, 40);

        // Stand: two side legs and a deck tilted up toward the back
        const tilt = 0.26;
        const deck = new THREE.Group();
        deck.position.set(0, 230, 0);
        deck.rotation.x = -tilt;
        group.add(deck);
        this.box(alu, [760, 14, 560], [0, 0, 0], deck);
        [-1, 1].forEach((side) => {
            const leg = this.box(alu, [16, 300, 520], [side * 360, -120, -20], group);
            leg.rotation.x = -tilt / 2;
        });

        // Laptop base on the deck, lid hinged at the back edge
        this.box(body, [880, 24, 600], [0, 20, 0], deck);
        const lid = new THREE.Group();
        lid.position.set(0, 32, -300);
        lid.rotation.x = -0.32; // opened a bit past upright
        deck.add(lid);
        this.box(body, [880, 580, 16], [0, 290, -8], lid);
        this.box(this.material('#0d0e11', 10), [860, 560, 4], [0, 290, 2], lid);

        this.codeCanvas = document.createElement('canvas');
        this.codeCanvas.width = 1024;
        this.codeCanvas.height = 640;
        this.codeTexture = new THREE.CanvasTexture(this.codeCanvas);
        this.codeTexture.encoding = THREE.sRGBEncoding;
        const screen = new THREE.Mesh(
            new THREE.PlaneGeometry(820, 512),
            new THREE.MeshBasicMaterial({ map: this.codeTexture })
        );
        (screen.material as THREE.MeshBasicMaterial).color.setScalar(0.9);
        screen.position.set(0, 290, 5);
        lid.add(screen);
        this.drawCode();
    }

    createKeycapTexture() {
        const canvas = document.createElement('canvas');
        canvas.width = 660;
        canvas.height = 210;
        const ctx = canvas.getContext('2d') as CanvasRenderingContext2D;
        ctx.fillStyle = COLORS.keyboard;
        ctx.fillRect(0, 0, 660, 210);
        ctx.fillStyle = '#3a3f48';
        const rows = [14, 14, 13, 12, 8];
        rows.forEach((n, r) => {
            const gap = 4;
            const size = (660 - 20 - gap * 13) / 14;
            const y = 10 + r * (size + gap);
            let x = 10;
            for (let i = 0; i < n; i++) {
                // wider space bar in the bottom row
                const wide = r === 4 && i === 3 ? size * 6 + gap * 5 : size;
                ctx.fillRect(x, y, wide, size);
                x += wide + gap;
            }
        });
        const texture = new THREE.CanvasTexture(canvas);
        texture.encoding = THREE.sRGBEncoding;
        return texture;
    }

    /** Dark editor with the code typed up to this.typed characters. */
    drawCode() {
        const ctx = this.codeCanvas.getContext('2d') as CanvasRenderingContext2D;
        const w = this.codeCanvas.width;
        const h = this.codeCanvas.height;
        ctx.fillStyle = '#1e1f29';
        ctx.fillRect(0, 0, w, h);
        // title bar and tab
        ctx.fillStyle = '#16171f';
        ctx.fillRect(0, 0, w, 44);
        ['#ff5f57', '#febc2e', '#28c840'].forEach((c, i) => {
            ctx.fillStyle = c;
            ctx.beginPath();
            ctx.arc(22 + i * 22, 22, 7, 0, Math.PI * 2);
            ctx.fill();
        });
        ctx.fillStyle = '#1e1f29';
        ctx.fillRect(110, 8, 200, 36);
        ctx.font = '18px "Courier New", monospace';
        ctx.fillStyle = '#c9cbd6';
        ctx.fillText('engine.py', 130, 32);

        ctx.font = '21px "Courier New", monospace';
        let left = this.typed;
        let cursor: [number, number] | null = null;
        CODE.forEach((line, i) => {
            const y = 82 + i * 38;
            ctx.fillStyle = '#4b4e5e';
            ctx.fillText(String(i + 1).padStart(2), 16, y);
            const shown = line.slice(0, Math.max(0, left));
            left -= line.length + 1;
            this.drawLine(ctx, shown, 62, y);
            if (left < 0 && !cursor) cursor = [62 + ctx.measureText(shown).width, y];
        });
        if (!cursor) cursor = [62, 82 + CODE.length * 38];
        if (Math.floor(this.time.elapsed / 500) % 2 === 0) {
            ctx.fillStyle = '#c9cbd6';
            ctx.fillRect(cursor[0] + 2, cursor[1] - 20, 11, 24);
        }
        this.codeTexture.needsUpdate = true;
    }

    /** One line with simple highlighting: comments, keywords, calls. */
    drawLine(ctx: CanvasRenderingContext2D, text: string, x: number, y: number) {
        const hash = text.indexOf('#');
        const code = hash >= 0 ? text.slice(0, hash) : text;
        const comment = hash >= 0 ? text.slice(hash) : '';
        const parts = code.split(/(\b\w+\b)/);
        parts.forEach((part) => {
            KEYWORDS.lastIndex = 0;
            if (KEYWORDS.test(part)) ctx.fillStyle = '#c792ea';
            else if (/^\d+$/.test(part)) ctx.fillStyle = '#f78c6c';
            else if (/^\w+$/.test(part) && /^\(/.test(code.slice(code.indexOf(part) + part.length))) ctx.fillStyle = '#82aaff';
            else ctx.fillStyle = '#c9cbd6';
            ctx.fillText(part, x, y);
            x += ctx.measureText(part).width;
        });
        if (comment) {
            ctx.fillStyle = '#676e95';
            ctx.fillText(comment, x, y);
        }
    }

    update() {
        // type ~28 characters a second, hold the finished file, start over
        const total = CODE.join('\n').length;
        const dt = Math.min(this.time.delta, 100) / 1000;
        this.typed += dt * 28;
        if (this.typed > total + 28 * 5) this.typed = 0;
        if (this.time.elapsed - this.lastDraw > 66) {
            this.lastDraw = this.time.elapsed;
            this.drawCode();
        }
    }
}
