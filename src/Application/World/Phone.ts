import * as THREE from 'three';
import Application from '../Application';
import Camera, { CameraKey } from '../Camera/Camera';
import Sizes from '../Utils/Sizes';
import Time from '../Utils/Time';
import type LiveCall from '../Utils/LiveCall';
import type { CallState } from '../Utils/LiveCall';

/**
 * A smartphone on a dock on the right of the desk. Clicking it calls the AI
 * voice of Samarjeet (a LiveKit agent; see LiveCall and api/call-token): the
 * phone's screen and a call panel show status, captions, mute and hang up.
 * The screen glows in the dark room and pulses its call button to invite a
 * call; a sticky note in front says what it is.
 *
 * Desk top is y -452; the dock sits under the monitor's right corner.
 */
const DESK_Y = -452;
// just below the monitor's lower-right corner, standing on the desk pad
const POSITION = new THREE.Vector3(1180, DESK_Y + 8, 420);
const HEADING = -0.3; // turned toward the chair and the idle camera
const PHONE = { w: 200, h: 420, depth: 22, radius: 34 };
const LEAN = 0.32; // back from upright, resting on the dock
const SCREEN_PX = { w: 380, h: 800 };

const COLORS = {
    body: '#15171c',
    frame: '#7d828c',
    dock: '#9da2ab',
    note: '#ffe27a',
    ink: '#2b2a26',
};

export default class Phone {
    application: Application;
    scene: THREE.Scene;
    camera: Camera;
    sizes: Sizes;
    time: Time;
    raycaster: THREE.Raycaster;

    root: THREE.Group;
    handset: THREE.Group; // the phone itself, lifted off the dock on hover
    screenCanvas: HTMLCanvasElement;
    screenTexture: THREE.CanvasTexture;
    lastDraw: number;
    speaking: boolean;
    hitbox: THREE.Mesh;

    pointer: THREE.Vector2 | null;
    hovered: boolean;
    lift: number;
    state: CallState | 'idle';
    call?: LiveCall;
    startedAt: number;
    seconds: number;

    panel: HTMLDivElement;
    statusEl: HTMLSpanElement;
    timerEl: HTMLSpanElement;
    captionEl: HTMLDivElement;
    muteEl: HTMLButtonElement;

    constructor() {
        this.application = new Application();
        this.scene = this.application.scene;
        this.camera = this.application.camera;
        this.sizes = this.application.sizes;
        this.time = this.application.time;
        this.raycaster = new THREE.Raycaster();
        this.pointer = null;
        this.hovered = false;
        this.lift = 0;
        this.state = 'idle';
        this.startedAt = 0;
        this.seconds = 180;
        this.lastDraw = 0;
        this.speaking = false;

        this.setModel();
        this.setPanel();
        this.setListeners();
    }

    material(color: string, shininess = 40) {
        return new THREE.MeshPhongMaterial({ color, specular: 0x444444, shininess });
    }

    setModel() {
        this.root = new THREE.Group();
        this.root.position.copy(POSITION);
        this.root.rotation.y = HEADING;
        this.scene.add(this.root);

        // Dock: a weighted base and a lip the phone leans on
        const dock = this.material(COLORS.dock, 60);
        const base = new THREE.Mesh(new THREE.BoxGeometry(250, 36, 230), dock);
        base.position.set(0, 18, 20);
        this.root.add(base);
        const lip = new THREE.Mesh(new THREE.BoxGeometry(250, 60, 30), dock);
        lip.position.set(0, 60, 110);
        this.root.add(lip);
        const back = new THREE.Mesh(new THREE.BoxGeometry(160, 300, 26), dock);
        back.position.set(0, 150, -60);
        back.rotation.x = -LEAN;
        this.root.add(back);

        // Phone: rounded slab, metal frame, glass screen with a canvas
        this.handset = new THREE.Group();
        this.handset.position.set(0, 40, 95);
        this.handset.rotation.x = -LEAN;
        this.root.add(this.handset);
        const { w, h, depth, radius } = PHONE;
        const outline = new THREE.Shape();
        outline.moveTo(-w / 2 + radius, 0);
        outline.lineTo(w / 2 - radius, 0);
        outline.quadraticCurveTo(w / 2, 0, w / 2, radius);
        outline.lineTo(w / 2, h - radius);
        outline.quadraticCurveTo(w / 2, h, w / 2 - radius, h);
        outline.lineTo(-w / 2 + radius, h);
        outline.quadraticCurveTo(-w / 2, h, -w / 2, h - radius);
        outline.lineTo(-w / 2, radius);
        outline.quadraticCurveTo(-w / 2, 0, -w / 2 + radius, 0);
        const slab = new THREE.ExtrudeGeometry(outline, {
            depth,
            bevelEnabled: true,
            bevelThickness: 4,
            bevelSize: 4,
            bevelSegments: 3,
        });
        slab.translate(0, 0, -depth);
        const body = new THREE.Mesh(slab, [this.material(COLORS.body, 80), this.material(COLORS.frame, 70)]);
        this.handset.add(body);

        this.screenCanvas = document.createElement('canvas');
        this.screenCanvas.width = SCREEN_PX.w;
        this.screenCanvas.height = SCREEN_PX.h;
        this.screenTexture = new THREE.CanvasTexture(this.screenCanvas);
        this.screenTexture.encoding = THREE.sRGBEncoding;
        const screen = new THREE.Mesh(
            new THREE.PlaneGeometry(w - 16, h - 18),
            new THREE.MeshBasicMaterial({ map: this.screenTexture })
        );
        screen.position.set(0, h / 2, 5);
        this.handset.add(screen);
        this.drawScreen(0);

        // Sticky note in front: CALL ME
        const note = new THREE.Mesh(
            new THREE.PlaneGeometry(240, 240),
            new THREE.MeshBasicMaterial({ map: this.createNoteTexture() })
        );
        note.rotation.x = -Math.PI / 2;
        note.rotation.z = 0.12;
        note.position.set(20, 14, 320); // above the desk pad's edge
        this.root.add(note);

        // Generous invisible click target
        this.hitbox = new THREE.Mesh(
            new THREE.BoxGeometry(420, 560, 640),
            new THREE.MeshBasicMaterial({ visible: false })
        );
        this.hitbox.position.set(0, 230, 120);
        this.root.add(this.hitbox);
    }

    createNoteTexture() {
        const canvas = document.createElement('canvas');
        canvas.width = canvas.height = 240;
        const ctx = canvas.getContext('2d') as CanvasRenderingContext2D;
        ctx.fillStyle = COLORS.note;
        ctx.fillRect(0, 0, 240, 240);
        // a little shade toward the curled bottom edge
        const curl = ctx.createLinearGradient(0, 170, 0, 240);
        curl.addColorStop(0, 'rgba(0,0,0,0)');
        curl.addColorStop(1, 'rgba(0,0,0,0.12)');
        ctx.fillStyle = curl;
        ctx.fillRect(0, 170, 240, 70);
        ctx.fillStyle = COLORS.ink;
        ctx.textAlign = 'center';
        ctx.font = 'bold 46px "Comic Sans MS", "Marker Felt", cursive';
        ctx.fillText('CALL ME', 120, 100);
        ctx.font = '24px "Comic Sans MS", "Marker Felt", cursive';
        ctx.fillText('ask my AI', 120, 150);
        ctx.fillText('anything \u2192', 120, 182);
        const texture = new THREE.CanvasTexture(canvas);
        texture.encoding = THREE.sRGBEncoding;
        return texture;
    }

    /** The phone's screen for the current call state. */
    drawScreen(t: number) {
        const ctx = this.screenCanvas.getContext('2d') as CanvasRenderingContext2D;
        const { w, h } = SCREEN_PX;
        const bg = ctx.createLinearGradient(0, 0, 0, h);
        bg.addColorStop(0, '#1b2a4a');
        bg.addColorStop(1, '#0c1222');
        ctx.fillStyle = bg;
        ctx.fillRect(0, 0, w, h);
        ctx.textAlign = 'center';
        ctx.fillStyle = 'white';

        // status bar and island
        ctx.font = '22px Helvetica, Arial, sans-serif';
        const clock = new Date().toLocaleTimeString('en-IN', { hour: '2-digit', minute: '2-digit', hour12: false });
        ctx.fillText(clock, 60, 40);
        ctx.fillStyle = '#000';
        ctx.beginPath();
        ctx.ellipse(w / 2, 30, 60, 16, 0, 0, Math.PI * 2);
        ctx.fill();

        // contact
        ctx.fillStyle = '#3b4a6b';
        ctx.beginPath();
        ctx.arc(w / 2, 220, 82, 0, Math.PI * 2);
        ctx.fill();
        ctx.fillStyle = 'white';
        ctx.font = 'bold 64px Helvetica, Arial, sans-serif';
        ctx.fillText('SM', w / 2, 243);
        ctx.font = 'bold 36px Helvetica, Arial, sans-serif';
        ctx.fillText('Samarjeet', w / 2, 360);
        ctx.font = '24px Helvetica, Arial, sans-serif';
        ctx.globalAlpha = 0.7;

        const onCall = this.state === 'dialing' || this.state === 'connected';
        let status = 'AI voice \u00b7 tap to call';
        if (this.state === 'dialing') status = 'calling' + '.'.repeat(1 + (Math.floor(t * 2) % 3));
        if (this.state === 'connected') {
            const s = Math.floor((performance.now() - this.startedAt) / 1000);
            status = `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
        }
        ctx.fillText(status, w / 2, 400);
        ctx.globalAlpha = 1;

        // voice waveform while the agent talks
        if (this.state === 'connected') {
            ctx.fillStyle = '#7cf2c4';
            for (let i = 0; i < 9; i++) {
                const amp = this.speaking ? 10 + Math.abs(Math.sin(t * 9 + i * 1.3)) * 50 : 6;
                ctx.fillRect(w / 2 - 100 + i * 24, 500 - amp / 2, 12, amp);
            }
        }

        // call button: green and pulsing to invite, red to end
        const y = h - 140;
        if (!onCall) {
            const pulse = 1 + 0.5 * (0.5 + 0.5 * Math.sin(t * 4));
            ctx.fillStyle = 'rgba(52,199,89,0.25)';
            ctx.beginPath();
            ctx.arc(w / 2, y, 52 * pulse, 0, Math.PI * 2);
            ctx.fill();
        }
        ctx.fillStyle = onCall ? '#ff3b30' : '#34c759';
        ctx.beginPath();
        ctx.arc(w / 2, y, 52, 0, Math.PI * 2);
        ctx.fill();
        ctx.fillStyle = 'white';
        ctx.font = 'bold 44px Helvetica, Arial, sans-serif';
        ctx.fillText('\u260e', w / 2, y + 16);

        this.screenTexture.needsUpdate = true;
    }

    setPanel() {
        const panel = document.createElement('div');
        panel.dataset.ui = 'call';
        Object.assign(panel.style, {
            position: 'fixed',
            left: '50%',
            bottom: '72px',
            transform: 'translateX(-50%)',
            width: 'min(520px, calc(100% - 32px))',
            boxSizing: 'border-box',
            background: 'black',
            color: 'white',
            fontFamily: 'monospace',
            fontSize: '14px',
            padding: '12px 16px',
            zIndex: '1000',
            display: 'none',
            pointerEvents: 'auto',
        } as CSSStyleDeclaration);

        const row = document.createElement('div');
        Object.assign(row.style, { display: 'flex', justifyContent: 'space-between', gap: '12px' });
        this.statusEl = document.createElement('span');
        this.timerEl = document.createElement('span');
        this.timerEl.style.opacity = '0.7';
        row.append(this.statusEl, this.timerEl);

        this.captionEl = document.createElement('div');
        Object.assign(this.captionEl.style, {
            marginTop: '8px',
            minHeight: '2.6em',
            lineHeight: '1.3em',
            opacity: '0.85',
        });

        const buttons = document.createElement('div');
        Object.assign(buttons.style, { display: 'flex', gap: '8px', marginTop: '10px' });
        const button = (label: string, onClick: () => void) => {
            const b = document.createElement('button');
            b.textContent = label;
            Object.assign(b.style, {
                background: 'black',
                color: 'white',
                border: '1px solid white',
                fontFamily: 'monospace',
                fontSize: '13px',
                padding: '4px 12px',
                cursor: 'pointer',
            });
            b.onclick = onClick;
            buttons.append(b);
            return b;
        };
        this.muteEl = button('Mute', () => {
            if (!this.call) return;
            const muted = !this.call.muted;
            this.call.setMuted(muted);
            this.muteEl.textContent = muted ? 'Unmute' : 'Mute';
        });
        button('Hang up', () => this.call?.hangUp());

        panel.append(row, this.captionEl, buttons);
        // keep clicks on the panel out of the room (camera toggles etc.)
        panel.addEventListener('mousedown', (e) => e.stopPropagation());
        document.body.append(panel);
        this.panel = panel;
    }

    setListeners() {
        const toPointer = (event: MouseEvent) =>
            new THREE.Vector2(
                (event.clientX / this.sizes.width) * 2 - 1,
                -(event.clientY / this.sizes.height) * 2 + 1
            );
        const inUi = (event: MouseEvent) =>
            !!(event.target as HTMLElement).closest?.('[data-ui]');

        window.addEventListener('mousemove', (event) => {
            this.pointer = inUi(event) ? null : toPointer(event);
        });
        // capture phase, like the cat, so the camera doesn't also move
        window.addEventListener(
            'mousedown',
            (event) => {
                // @ts-ignore
                if (!inUi(event) && this.isOver(toPointer(event))) event.catHandled = true;
            },
            true
        );
        window.addEventListener('click', (event) => {
            if (inUi(event) || !this.isOver(toPointer(event))) return;
            if (this.state === 'idle' || this.state === 'ended') this.startCall();
            else this.call?.hangUp();
        });
    }

    isOver(pointer: THREE.Vector2) {
        if (this.camera.freeCam) return false;
        if (this.camera.currentKeyframe === CameraKey.MONITOR) return false;
        this.raycaster.setFromCamera(pointer, this.camera.instance);
        return this.raycaster.intersectObject(this.hitbox).length > 0;
    }

    async startCall() {
        this.statusEl.textContent = '☎ Calling Samarjeet’s AI…';
        this.timerEl.textContent = '';
        this.captionEl.textContent = 'You’ll talk to an AI version of me. It uses your mic.';
        this.muteEl.textContent = 'Mute';
        this.panel.style.display = 'block';

        this.state = 'dialing';
        // the LiveKit SDK is only fetched when someone actually calls
        const { default: Call } = await import(/* webpackChunkName: "call" */ '../Utils/LiveCall');
        this.call = new Call({
            onState: (state) => {
                this.state = state;
                if (state === 'connected') {
                    this.startedAt = performance.now();
                    this.statusEl.textContent = '● On the line';
                    this.captionEl.textContent = '';
                }
            },
            onCaption: (who, text) => {
                this.captionEl.textContent = who === 'caller' ? `You: ${text}` : text;
            },
            onSpeaking: (speaking) => (this.speaking = speaking),
            onEnd: (message) => {
                this.statusEl.textContent = message;
                this.timerEl.textContent = '';
                setTimeout(() => {
                    if (this.state === 'ended') this.panel.style.display = 'none';
                }, 3000);
            },
        });
        this.call.start();
    }

    update() {
        const t = this.time.elapsed / 1000;
        const dt = Math.min(this.time.delta, 100) / 1000;

        const over = this.pointer ? this.isOver(this.pointer) : false;
        if (over !== this.hovered) {
            this.hovered = over;
            document.body.style.cursor = over ? 'pointer' : '';
        }

        // Phone: rises off the dock a little on hover and during a call
        const onCall = this.state === 'dialing' || this.state === 'connected';
        const target = onCall ? 1 : over ? 0.6 : 0;
        this.lift += (target - this.lift) * (1 - Math.exp(-dt * 6));
        this.handset.position.y = 40 + this.lift * 50;

        // the screen redraws ~12 times a second
        if (this.time.elapsed - this.lastDraw > 80) {
            this.lastDraw = this.time.elapsed;
            this.drawScreen(t);
        }

        if (this.state === 'connected') {
            const s = Math.floor((performance.now() - this.startedAt) / 1000);
            const fmt = (n: number) => `${Math.floor(n / 60)}:${String(n % 60).padStart(2, '0')}`;
            this.timerEl.textContent = `${fmt(s)} / ${fmt(this.seconds)}`;
        }
    }
}
