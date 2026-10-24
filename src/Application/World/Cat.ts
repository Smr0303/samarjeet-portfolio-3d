import * as THREE from 'three';
import Application from '../Application';
import Camera, { CameraKey } from '../Camera/Camera';
import Sizes from '../Utils/Sizes';
import Time from '../Utils/Time';
import UIEventBus from '../UI/EventBus';

/**
 * An orange tabby built from primitives that runs the intro. It waits on the
 * floor; clicking it makes it walk to the chair, hop up, stand to tap the
 * mouse, the monitor powers on, and the camera zooms into the screen. Until
 * then, clicks elsewhere are swallowed so the intro can't be skipped.
 *
 * The cat is modelled facing local +x in "cat units" and scaled into world
 * space. Heights come from the GLBs (× the 900 model scale): floor -2980,
 * seat cushion top ~-1300, desk top -452.
 */
const SCALE = 426;
const FLOOR_Y = -2980;
const SEAT_Y = -1300;

const WAIT_SPOT = new THREE.Vector3(-2600, FLOOR_Y, 3500);
const WAIT_HEADING = Math.atan2(-1, -1); // facing the idle camera
const JUMP_FROM = new THREE.Vector3(-450, FLOOR_Y, 2050);
// Facing the mouse, far enough back that the front paws land beside it
const SEAT_SPOT = new THREE.Vector3(760, SEAT_Y, 2050);
const SEAT_HEADING = Math.atan2(0.99, 0.139);
const MOUSE_POSITION = new THREE.Vector3(830, -420, 1450);

const WALK_SPEED = 1300; // world units / s
const JUMP_HEIGHT = 1300; // parabola height over the straight floor -> seat line
const ZOOM_DELAY = 1.2; // s after power-on, so the screen lighting up is seen

// seconds spent in each timed state
const DURATIONS = {
    standUp: 0.5,
    crouch: 0.3,
    jump: 0.65,
    settle: 0.7,
    reach: 0.6,
    tap: 0.9,
};

// How bright the cat reads: dim in the dark room, brighter once the screen
// glows, full in the day theme
const BRIGHTNESS = { off: 0.6, on: 0.9, day: 1 };

const COLORS = {
    fur: '#e8954a',
    stripe: '#a95a22',
    white: '#f7efe4',
    iris: '#9cc24a',
    pupil: '#141414',
    pink: '#f0a3a3',
};

type CatState =
    | 'waiting'
    | 'standUp'
    | 'walking'
    | 'crouch'
    | 'jump'
    | 'settle'
    | 'reach'
    | 'tap'
    | 'seated';

/**
 * tailDroop is the tail's angle below horizontal in the cat's frame (not the
 * body's), so a pitched body doesn't swing the tail into the seat. tailFlat
 * bends the next two segments back to level so the tail can lie on a surface.
 */
type Pose = {
    bodyY: number;
    bodyPitch: number;
    headY: number;
    headPitch: number;
    frontLegs: number;
    backLegs: number;
    tailDroop: number;
    tailFlat: number;
    tailBend: number;
    tailCurl: number;
};

const POSES: { [key: string]: Pose } = {
    stand: {
        bodyY: 1.04,
        bodyPitch: 0,
        headY: 0.5,
        headPitch: 0.05,
        frontLegs: 0,
        backLegs: 0,
        tailDroop: -1.1,
        tailFlat: 0,
        tailBend: 0.18,
        tailCurl: 0,
    },
    crouch: {
        bodyY: 0.9,
        bodyPitch: -0.08,
        headY: 0.45,
        headPitch: 0.2,
        frontLegs: 0.5,
        backLegs: -0.5,
        tailDroop: -0.3,
        tailFlat: 0,
        tailBend: 0.05,
        tailCurl: 0,
    },
    // mid-air: stretched out
    jump: {
        bodyY: 1.04,
        bodyPitch: 0.25,
        headY: 0.5,
        headPitch: -0.2,
        frontLegs: 1.0,
        backLegs: -1.0,
        tailDroop: 0.1,
        tailFlat: 0,
        tailBend: 0,
        tailCurl: 0,
    },
    // haunches folded, front legs straight, tail wrapped round on the ground
    sit: {
        bodyY: 0.76,
        bodyPitch: 0.4,
        headY: 0.5,
        headPitch: -0.55,
        frontLegs: -0.4,
        backLegs: Math.PI / 2 - 0.4,
        tailDroop: 0.9,
        tailFlat: 1,
        tailBend: 0,
        tailCurl: 0.38,
    },
    // up on the hind legs, front paws reaching onto the desk
    reach: {
        bodyY: 1.4,
        bodyPitch: 1.0,
        headY: 0.5,
        headPitch: -0.85,
        frontLegs: 1.3,
        backLegs: -1.0,
        tailDroop: 0.6,
        tailFlat: 1,
        tailBend: 0,
        tailCurl: 0.3,
    },
};

export default class Cat {
    application: Application;
    scene: THREE.Scene;
    camera: Camera;
    sizes: Sizes;
    time: Time;

    root: THREE.Group;
    body: THREE.Group;
    head: THREE.Group;
    ears: THREE.Mesh[];
    eyes: THREE.Group[];
    frontLegs: THREE.Group[];
    backLegs: THREE.Group[];
    tail: THREE.Group[];
    shadow: THREE.Mesh;
    hitbox: THREE.Mesh;
    raycaster: THREE.Raycaster;
    materials: THREE.MeshMatcapMaterial[];
    brightness: number;

    state: CatState;
    stateTime: number;
    pose: Pose;
    targetPose: Pose;
    heading: number;
    targetHeading: number;
    walkDistance: number;
    tiltTime: number;
    clicked: boolean;

    constructor() {
        this.application = new Application();
        this.scene = this.application.scene;
        this.camera = this.application.camera;
        this.sizes = this.application.sizes;
        this.time = this.application.time;
        this.raycaster = new THREE.Raycaster();
        this.materials = [];
        this.brightness = BRIGHTNESS.off;

        this.state = 'waiting';
        this.stateTime = 0;
        this.pose = { ...POSES.sit };
        this.targetPose = POSES.sit;
        this.heading = WAIT_HEADING;
        this.targetHeading = WAIT_HEADING;
        this.walkDistance = WAIT_SPOT.distanceTo(JUMP_FROM);
        this.tiltTime = -1;
        this.clicked = false;

        this.setModel();
        this.setClickListener();
    }

    setModel() {
        // Soft clay shading from a matcap, so the cat reads as round even in
        // the dark room; brightness follows the room in update()
        const matcap = this.createMatcap();
        const mat = (color: string, map?: THREE.Texture) => {
            const material = new THREE.MeshMatcapMaterial({ matcap, map });
            material.userData.color = new THREE.Color(color);
            this.materials.push(material);
            return material;
        };
        const tabby = mat('#ffffff', this.createTabbyTexture());
        const fur = mat(COLORS.fur);
        const ringed = mat('#ffffff', this.createTailTexture());
        const white = mat(COLORS.white);
        const pink = mat(COLORS.pink);
        const iris = mat(COLORS.iris);
        const pupil = mat(COLORS.pupil);
        const shine = new THREE.MeshBasicMaterial({ color: '#ffffff' });
        const sphere = new THREE.SphereGeometry(1, 32, 24);

        const part = (
            material: THREE.Material,
            parent: THREE.Object3D,
            pos: [number, number, number],
            scale: [number, number, number],
            geometry: THREE.BufferGeometry = sphere
        ) => {
            const mesh = new THREE.Mesh(geometry, material);
            mesh.position.set(...pos);
            mesh.scale.set(...scale);
            parent.add(mesh);
            return mesh;
        };

        this.root = new THREE.Group();
        this.root.scale.setScalar(SCALE);
        this.root.position.copy(WAIT_SPOT);
        this.scene.add(this.root);

        // Body: round hips, chest, white bib and belly, haunches
        this.body = new THREE.Group();
        this.root.add(this.body);
        part(tabby, this.body, [-0.35, 0, 0], [0.75, 0.66, 0.66]);
        part(tabby, this.body, [0.45, 0.05, 0], [0.62, 0.6, 0.58]);
        part(tabby, this.body, [0.05, 0.03, 0], [0.7, 0.63, 0.62]);
        part(white, this.body, [0.75, -0.12, 0], [0.32, 0.42, 0.4]);
        part(white, this.body, [0.05, -0.28, 0], [0.7, 0.38, 0.5]);
        [-1, 1].forEach((side) =>
            part(tabby, this.body, [-0.55, -0.1, side * 0.33], [0.4, 0.45, 0.26])
        );

        // Head: wide cheeks, white muzzle, pink nose, green eyes, whiskers
        this.head = new THREE.Group();
        this.head.position.set(1.0, 0.5, 0);
        this.body.add(this.head);
        part(tabby, this.head, [0, 0, 0], [0.5, 0.48, 0.56]);
        [-1, 1].forEach((side) => {
            part(fur, this.head, [0.14, -0.13, side * 0.27], [0.32, 0.28, 0.3]);
            part(white, this.head, [0.44, -0.16, side * 0.085], [0.13, 0.11, 0.12]);
        });
        part(white, this.head, [0.38, -0.27, 0], [0.12, 0.08, 0.12]);
        part(pink, this.head, [0.53, -0.06, 0], [0.045, 0.035, 0.065]);

        const ear = new THREE.ConeGeometry(0.2, 0.36, 16);
        this.ears = [-1, 1].map((side) => {
            const e = part(tabby, this.head, [-0.02, 0.42, side * 0.27], [0.45, 1, 1], ear);
            e.rotation.x = side * 0.32;
            part(pink, e, [0.25, -0.05, 0], [0.6, 0.72, 0.68], ear);
            return e;
        });

        this.eyes = [-1, 1].map((side) => {
            const eye = new THREE.Group();
            eye.position.set(0.4, 0.06, side * 0.2);
            eye.rotation.y = -side * 0.35;
            this.head.add(eye);
            part(iris, eye, [0, 0, 0], [0.1, 0.12, 0.1]);
            part(pupil, eye, [0.06, 0, 0], [0.055, 0.09, 0.065]);
            part(shine, eye, [0.1, 0.045, -side * 0.025], [0.022, 0.028, 0.022]);
            return eye;
        });

        const whiskerPoints: THREE.Vector3[] = [];
        [-1, 1].forEach((side) => {
            [-0.05, 0, 0.05].forEach((dy, i) => {
                whiskerPoints.push(
                    new THREE.Vector3(0.48, -0.15 + dy, side * 0.15),
                    new THREE.Vector3(0.5 - i * 0.04, -0.1 + dy * 2.2, side * 0.78)
                );
            });
        });
        this.head.add(
            new THREE.LineSegments(
                new THREE.BufferGeometry().setFromPoints(whiskerPoints),
                new THREE.LineBasicMaterial({
                    color: '#ffffff',
                    transparent: true,
                    opacity: 0.55,
                })
            )
        );

        // Legs: pivot at the hip, leg hangs along -y, white paws
        const legGeometry = new THREE.CylinderGeometry(0.13, 0.1, 0.55, 12);
        const leg = (x: number, z: number) => {
            const pivot = new THREE.Group();
            pivot.position.set(x, -0.35, z);
            this.body.add(pivot);
            part(fur, pivot, [0, -0.275, 0], [1, 1, 1], legGeometry);
            part(white, pivot, [0.04, -0.58, 0], [0.15, 0.11, 0.14]);
            return pivot;
        };
        this.frontLegs = [leg(0.6, 0.3), leg(0.6, -0.3)];
        this.backLegs = [leg(-0.62, 0.3), leg(-0.62, -0.3)];

        // Tail: chain of ringed segments tapering to a fluffy tip
        this.tail = [];
        let parent: THREE.Object3D = this.body;
        let x = -1.0;
        const SEGMENTS = 8;
        for (let i = 0; i < SEGMENTS; i++) {
            const seg = new THREE.Group();
            seg.position.set(x, i === 0 ? 0.25 : 0, 0);
            parent.add(seg);
            const r0 = 0.11 - i * 0.006;
            const g = new THREE.CylinderGeometry(r0 - 0.006, r0, 0.28, 12);
            g.rotateZ(Math.PI / 2);
            g.translate(-0.14, 0, 0);
            part(ringed, seg, [0, 0, 0], [1, 1, 1], g);
            // joint ball keeps the bends smooth
            part(fur, seg, [0, 0, 0], [r0, r0, r0]);
            if (i === SEGMENTS - 1)
                part(fur, seg, [-0.3, 0, 0], [0.1, 0.07, 0.07]);
            this.tail.push(seg);
            parent = seg;
            x = -0.28;
        }

        // Soft contact shadow
        const canvas = document.createElement('canvas');
        canvas.width = canvas.height = 64;
        const ctx = canvas.getContext('2d') as CanvasRenderingContext2D;
        const gradient = ctx.createRadialGradient(32, 32, 0, 32, 32, 32);
        gradient.addColorStop(0, 'rgba(0,0,0,0.45)');
        gradient.addColorStop(1, 'rgba(0,0,0,0)');
        ctx.fillStyle = gradient;
        ctx.fillRect(0, 0, 64, 64);
        this.shadow = new THREE.Mesh(
            new THREE.PlaneGeometry(3, 2),
            new THREE.MeshBasicMaterial({
                map: new THREE.CanvasTexture(canvas),
                transparent: true,
                depthWrite: false,
            })
        );
        this.shadow.rotation.x = -Math.PI / 2;
        this.shadow.position.set(0, 0.01, 0);
        this.root.add(this.shadow);

        // Invisible click target, generous so the small cat is easy to hit
        this.hitbox = new THREE.Mesh(
            new THREE.BoxGeometry(3.6, 3, 2.6),
            new THREE.MeshBasicMaterial({ visible: false })
        );
        this.hitbox.position.set(0.1, 1.3, 0);
        this.root.add(this.hitbox);
    }

    createMatcap() {
        const size = 128;
        const canvas = document.createElement('canvas');
        canvas.width = canvas.height = size;
        const ctx = canvas.getContext('2d') as CanvasRenderingContext2D;
        // key light from the top left, soft falloff, faint rim
        const gradient = ctx.createRadialGradient(46, 40, 4, 64, 64, 64);
        gradient.addColorStop(0, '#ffffff');
        gradient.addColorStop(0.45, '#d9d9d9');
        gradient.addColorStop(0.85, '#8a8a8a');
        gradient.addColorStop(1, '#b0b0b0');
        ctx.fillStyle = gradient;
        ctx.fillRect(0, 0, size, size);
        const texture = new THREE.CanvasTexture(canvas);
        texture.encoding = THREE.sRGBEncoding;
        return texture;
    }

    /**
     * Tabby stripes for the spheres. Sphere UVs run u around the y axis and
     * v from the top pole down, so vertical bands become stripes running
     * from the spine down the flanks, fading out toward the belly.
     */
    createTabbyTexture() {
        const w = 256;
        const h = 128;
        const canvas = document.createElement('canvas');
        canvas.width = w;
        canvas.height = h;
        const ctx = canvas.getContext('2d') as CanvasRenderingContext2D;
        ctx.fillStyle = COLORS.fur;
        ctx.fillRect(0, 0, w, h);

        const fade = ctx.createLinearGradient(0, 0, 0, h);
        fade.addColorStop(0, COLORS.stripe);
        fade.addColorStop(0.55, 'rgba(169,90,34,0.5)');
        fade.addColorStop(0.75, 'rgba(169,90,34,0)');
        ctx.fillStyle = fade;
        ctx.filter = 'blur(1.5px)';
        const STRIPES = 16;
        for (let i = 0; i < STRIPES; i++) {
            const cx = ((i + 0.5) / STRIPES) * w;
            const width = 4 + (i % 3) * 1.5;
            ctx.beginPath();
            for (let y = 0; y <= h; y += 8)
                ctx.lineTo(cx + Math.sin(y * 0.09 + i) * 3 - width / 2, y);
            for (let y = h; y >= 0; y -= 8)
                ctx.lineTo(cx + Math.sin(y * 0.09 + i) * 3 + width / 2, y);
            ctx.fill();
        }
        const texture = new THREE.CanvasTexture(canvas);
        texture.encoding = THREE.sRGBEncoding;
        return texture;
    }

    /** One soft dark ring per tail segment (cylinder v runs along it). */
    createTailTexture() {
        const canvas = document.createElement('canvas');
        canvas.width = 8;
        canvas.height = 64;
        const ctx = canvas.getContext('2d') as CanvasRenderingContext2D;
        const gradient = ctx.createLinearGradient(0, 0, 0, 64);
        gradient.addColorStop(0, COLORS.fur);
        gradient.addColorStop(0.35, COLORS.fur);
        gradient.addColorStop(0.5, COLORS.stripe);
        gradient.addColorStop(0.65, COLORS.fur);
        gradient.addColorStop(1, COLORS.fur);
        ctx.fillStyle = gradient;
        ctx.fillRect(0, 0, 8, 64);
        const texture = new THREE.CanvasTexture(canvas);
        texture.encoding = THREE.sRGBEncoding;
        return texture;
    }

    updateBrightness(dt: number) {
        const lighting = this.application.world.lighting;
        let target = BRIGHTNESS.day;
        if (lighting && lighting.theme === 'night')
            target = lighting.screenOn ? BRIGHTNESS.on : BRIGHTNESS.off;
        this.brightness += (target - this.brightness) * (1 - Math.exp(-dt * 3));
        this.materials.forEach((material) =>
            material.color
                .copy(material.userData.color)
                .multiplyScalar(this.brightness)
        );
    }

    setClickListener() {
        // Capture phase so this runs before Camera's document listener, which
        // skips its idle/desk toggle when the cat has handled the click.
        window.addEventListener(
            'mousedown',
            (event) => {
                if (this.camera.freeCam) return;
                const introRunning = this.state !== 'seated';
                const pointer = new THREE.Vector2(
                    (event.clientX / this.sizes.width) * 2 - 1,
                    -(event.clientY / this.sizes.height) * 2 + 1
                );
                this.raycaster.setFromCamera(pointer, this.camera.instance);
                const hit =
                    this.raycaster.intersectObject(this.hitbox).length > 0;

                // @ts-ignore
                if (hit || introRunning) event.catHandled = true;
                if (!hit) return;

                if (this.state === 'waiting') {
                    this.setState('standUp');
                    this.targetPose = POSES.stand;
                    this.targetHeading = this.headingTo(WAIT_SPOT, JUMP_FROM);
                    UIEventBus.dispatch('catStart', {});
                } else if (this.state === 'seated') {
                    this.tiltTime = 0;
                }
            },
            true
        );
    }

    headingTo(from: THREE.Vector3, to: THREE.Vector3) {
        // rotation.y so local +x points along from -> to
        return Math.atan2(-(to.z - from.z), to.x - from.x);
    }

    setState(state: CatState) {
        this.state = state;
        this.stateTime = 0;
    }

    /** The cat's paw on the mouse: click sound, then the monitor powers on. */
    clickMouse() {
        const world = this.application.world;
        world.audioManager?.playAudio('mouseDown', {
            volume: 0.8,
            position: MOUSE_POSITION,
        });
        setTimeout(
            () =>
                world.audioManager?.playAudio('mouseUp', {
                    volume: 0.8,
                    position: MOUSE_POSITION,
                }),
            120
        );
        world.monitorScreen.powerOn();

        // Zoom in unless the visitor has gone to free cam meanwhile
        setTimeout(() => {
            const key = this.camera.currentKeyframe || this.camera.targetKeyframe;
            if (key === CameraKey.IDLE || key === CameraKey.DESK)
                this.camera.trigger('enterMonitor');
        }, ZOOM_DELAY * 1000);
    }

    updateState(dt: number) {
        this.stateTime += dt;
        const t = this.stateTime;

        if (this.state === 'standUp' && t > DURATIONS.standUp) {
            this.setState('walking');
        } else if (this.state === 'walking') {
            const p = Math.min((t * WALK_SPEED) / this.walkDistance, 1);
            this.root.position.lerpVectors(WAIT_SPOT, JUMP_FROM, p);
            if (p >= 1) {
                this.setState('crouch');
                this.targetPose = POSES.crouch;
                this.targetHeading = this.headingTo(JUMP_FROM, SEAT_SPOT);
            }
        } else if (this.state === 'crouch' && t > DURATIONS.crouch) {
            this.setState('jump');
            this.targetPose = POSES.jump;
        } else if (this.state === 'jump') {
            const p = Math.min(t / DURATIONS.jump, 1);
            this.root.position.lerpVectors(JUMP_FROM, SEAT_SPOT, p);
            this.root.position.y += 4 * JUMP_HEIGHT * p * (1 - p);
            if (p >= 1) {
                this.setState('settle');
                this.targetPose = POSES.sit;
                this.targetHeading = SEAT_HEADING;
            }
        } else if (this.state === 'settle' && t > DURATIONS.settle) {
            this.setState('reach');
            this.targetPose = POSES.reach;
        } else if (this.state === 'reach' && t > DURATIONS.reach) {
            this.setState('tap');
            this.clicked = false;
        } else if (this.state === 'tap') {
            if (!this.clicked && t > DURATIONS.tap / 2) {
                this.clicked = true;
                this.clickMouse();
            }
            if (t > DURATIONS.tap) {
                this.setState('seated');
                this.targetPose = POSES.sit;
            }
        }
    }

    update() {
        const dt = Math.min(this.time.delta, 100) / 1000;
        const t = this.time.current / 1000;
        this.updateState(dt);
        this.updateBrightness(dt);

        // Ease pose and heading toward their targets
        const k = 1 - Math.exp(-dt * (this.state === 'jump' ? 12 : 7));
        const pose = this.pose as { [key: string]: number };
        const target = this.targetPose as { [key: string]: number };
        for (const key in pose) pose[key] += (target[key] - pose[key]) * k;
        let turn = this.targetHeading - this.heading;
        turn = Math.atan2(Math.sin(turn), Math.cos(turn));
        this.heading += turn * k;
        this.root.rotation.y = this.heading;
        this.shadow.visible = this.state !== 'jump';

        // Gait: diagonal pairs swing, body bobs and rolls slightly
        const stride =
            this.state === 'walking' ? Math.sin(this.stateTime * 11) : 0;

        // Body, with breathing
        const p = this.pose;
        const breath = Math.sin(t * 2.4);
        this.body.position.y = p.bodyY + Math.abs(stride) * 0.04;
        this.body.rotation.z = p.bodyPitch;
        this.body.rotation.x = stride * 0.04;
        this.body.scale.set(1, 1 + breath * 0.02, 1 + breath * 0.02);

        // Head: idle glances while waiting, curious tilt when clicked seated
        let tilt = 0;
        if (this.tiltTime >= 0) {
            this.tiltTime += dt;
            tilt = Math.sin(Math.min(this.tiltTime / 1.2, 1) * Math.PI) * 0.35;
            if (this.tiltTime > 1.2) this.tiltTime = -1;
        }
        const glance =
            this.state === 'waiting' ? Math.sin(t * 0.7) * 0.35 : 0;
        this.head.position.y = p.headY;
        this.head.rotation.z = p.headPitch + Math.abs(stride) * 0.04;
        this.head.rotation.y = glance;
        this.head.rotation.x = tilt;

        // Blink every few seconds; an ear twitches now and then
        const blink = t % 4 < 0.12 ? 0.1 : 1;
        this.eyes.forEach((eye) => (eye.scale.y = blink));
        const twitch = t % 5.3 < 0.15 ? 0.25 : 0;
        this.ears[0].rotation.x = -0.32 - twitch;

        // Legs swing in diagonal pairs; one front paw taps the mouse twice
        const swing = stride * 0.45;
        const tap =
            this.state === 'tap'
                ? Math.max(
                      0,
                      Math.sin((this.stateTime / DURATIONS.tap) * Math.PI * 4)
                  ) * 0.45
                : 0;
        this.frontLegs[0].rotation.z = p.frontLegs + swing + tap;
        this.frontLegs[1].rotation.z = p.frontLegs - swing;
        this.backLegs[0].rotation.z = p.backLegs - swing;
        this.backLegs[1].rotation.z = p.backLegs + swing;

        // Tail: base angle is relative to the cat, not the pitched body;
        // the next two segments level it off when it lies on a surface,
        // the rest bend and curl, with a lazy swish toward the tip
        const swish = Math.sin(t * 1.8);
        this.tail.forEach((seg, i) => {
            if (i === 0) {
                seg.rotation.z = p.tailDroop - p.bodyPitch;
                seg.rotation.y = 0;
            } else if (i <= 2) {
                seg.rotation.z = -p.tailDroop * 0.5 * p.tailFlat + p.tailBend;
                seg.rotation.y = p.tailCurl * 0.5;
            } else {
                seg.rotation.z = p.tailBend;
                seg.rotation.y = p.tailCurl + swish * 0.12 * (i / 7);
            }
        });
    }
}
