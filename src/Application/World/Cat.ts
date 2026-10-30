import * as THREE from 'three';
import Application from '../Application';
import Camera, { CameraKey } from '../Camera/Camera';
import Sizes from '../Utils/Sizes';
import Time from '../Utils/Time';
import UIEventBus from '../UI/EventBus';

/**
 * A chubby white cat built from primitives that runs the intro. It waits on the
 * floor; clicking it makes it walk to the chair, wiggle and hop up, stand to
 * tap the mouse, the monitor powers on, and the camera zooms into the screen.
 * Until then, clicks elsewhere are swallowed so the intro can't be skipped.
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

const WALK_SPEED = 950; // average world units / s, eased in and out
const STRIDE = 390; // world units the body moves per gait cycle
const JUMP_HEIGHT = 1300; // parabola height over the straight floor -> seat line
const ZOOM_DELAY = 1.2; // s after power-on, so the screen lighting up is seen

// seconds spent in each timed state
const DURATIONS = {
    standUp: 0.6,
    crouch: 1.2, // includes the butt wiggle
    jump: 0.65,
    settle: 0.8,
    reach: 0.6,
    tap: 0.9,
};

// How bright the cat reads: dim in the dark room, brighter once the screen
// glows, full in the day theme
const BRIGHTNESS = { off: 0.82, on: 1, day: 1 };

// Fur shells: how many, and how far apart (cat units)
const FUR_SHELLS = 6;
const FUR_LENGTH = 0.011;

const COLORS = {
    fur: '#f3efe9',
    white: '#ffffff',
    iris: '#7fb6e6',
    pupil: '#141414',
    pink: '#f0a3a3',
};

// Leg segments: upper (shoulder / thigh) and lower (forearm / shin)
const LEG = {
    front: { upper: 0.38, lower: 0.4 },
    back: { upper: 0.36, lower: 0.44 },
};

// Walk: lateral sequence (LH, LF, RH, RF a quarter cycle apart); each paw is
// planted for STANCE of the cycle and swings forward, lifted, for the rest
const STANCE = 0.62;
const SWING = 0.34; // hip swing amplitude, radians
const PHASES = { frontL: 0.25, frontR: 0.75, backL: 0, backR: 0.5 };

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
 * Leg angles are rotation.z of the hip and of the knee relative to the hip;
 * positive swings the paw forward (+x). tailDroop is the tail's angle below
 * horizontal in the cat's frame (not the body's), so a pitched body doesn't
 * swing the tail into the seat. tailFlat bends the next two segments back to
 * level so the tail can lie on a surface; tailHook curls the tip forward.
 */
type Pose = {
    bodyY: number;
    bodyPitch: number;
    headY: number;
    headPitch: number;
    front: number;
    frontKnee: number;
    back: number;
    backKnee: number;
    tailDroop: number;
    tailFlat: number;
    tailBend: number;
    tailCurl: number;
    tailHook: number;
};

const POSES: { [key: string]: Pose } = {
    stand: {
        bodyY: 1.1,
        bodyPitch: 0,
        headY: 0.42,
        headPitch: 0.08,
        front: 0,
        frontKnee: 0.06,
        back: 0.3,
        backKnee: -0.6,
        tailDroop: -0.8,
        tailFlat: 0,
        tailBend: 0.07,
        tailCurl: 0,
        tailHook: -0.35,
    },
    // low and coiled, eyes on the seat
    crouch: {
        bodyY: 0.82,
        bodyPitch: -0.04,
        headY: 0.36,
        headPitch: 0.3,
        front: 0.9,
        frontKnee: -1.9,
        back: 0.9,
        backKnee: -1.8,
        tailDroop: 0.15,
        tailFlat: 0,
        tailBend: 0.03,
        tailCurl: 0,
        tailHook: 0,
    },
    // mid-air: stretched out
    jump: {
        bodyY: 1.1,
        bodyPitch: 0.25,
        headY: 0.42,
        headPitch: -0.2,
        front: 1.1,
        frontKnee: 0.2,
        back: -0.9,
        backKnee: 0.3,
        tailDroop: 0.1,
        tailFlat: 0,
        tailBend: 0,
        tailCurl: 0,
        tailHook: 0,
    },
    // haunches down, front legs straight, tail wrapped round on the ground
    sit: {
        bodyY: 0.78,
        bodyPitch: 0.75,
        headY: 0.42,
        headPitch: -0.75,
        front: -0.75,
        frontKnee: 0,
        back: 0.25,
        backKnee: -2.4,
        tailDroop: 0.9,
        tailFlat: 1,
        tailBend: 0,
        tailCurl: 0.32,
        tailHook: 0,
    },
    // up on the hind legs, front paws reaching onto the desk
    reach: {
        bodyY: 1.45,
        bodyPitch: 1.05,
        headY: 0.42,
        headPitch: -0.9,
        front: 1.3,
        frontKnee: 0.3,
        back: -0.75,
        backKnee: -0.6,
        tailDroop: 0.6,
        tailFlat: 1,
        tailBend: 0,
        tailCurl: 0.3,
        tailHook: 0,
    },
};

type Leg = { hip: THREE.Group; knee: THREE.Group };

const smooth = (x: number) => 0.5 - 0.5 * Math.cos(Math.PI * x);

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
    pupils: THREE.Mesh[];
    frontLegs: Leg[];
    backLegs: Leg[];
    tail: THREE.Group[];
    shadow: THREE.Mesh;
    hitbox: THREE.Mesh;
    raycaster: THREE.Raycaster;
    materials: THREE.MeshMatcapMaterial[];
    brightness: number;
    pupilWidth: number;

    state: CatState;
    stateTime: number;
    pose: Pose;
    targetPose: Pose;
    heading: number;
    targetHeading: number;
    walkDistance: number;
    gaitPhase: number;
    gait: number;
    tiltTime: number;
    clicked: boolean;

    // idle life: glances, blinks and ear flicks on random timers
    glance: number;
    glanceTarget: number;
    nextGlance: number;
    blinkStart: number;
    blinkLength: number;
    nextBlink: number;
    twitchEar: number;
    twitchStart: number;
    nextTwitch: number;

    constructor() {
        this.application = new Application();
        this.scene = this.application.scene;
        this.camera = this.application.camera;
        this.sizes = this.application.sizes;
        this.time = this.application.time;
        this.raycaster = new THREE.Raycaster();
        this.materials = [];
        this.brightness = BRIGHTNESS.off;
        this.pupilWidth = 1;

        this.state = 'waiting';
        this.stateTime = 0;
        this.pose = { ...POSES.sit };
        this.targetPose = POSES.sit;
        this.heading = WAIT_HEADING;
        this.targetHeading = WAIT_HEADING;
        this.walkDistance = WAIT_SPOT.distanceTo(JUMP_FROM);
        this.gaitPhase = 0;
        this.gait = 0;
        this.tiltTime = -1;
        this.clicked = false;

        this.glance = 0;
        this.glanceTarget = 0;
        this.nextGlance = 2;
        this.blinkStart = -10;
        this.blinkLength = 0.15;
        this.nextBlink = 3;
        this.twitchEar = 0;
        this.twitchStart = -10;
        this.nextTwitch = 4;

        this.setModel();
        this.setClickListener();
    }

    setModel() {
        // Soft shading from a matcap with a bright rim, so the cat reads as
        // round and furry even in the dark room; brightness follows the room
        const matcap = this.createMatcap();
        // Flat colours go through the same sRGB decode as the fur texture, so
        // the legs match the body
        const mat = (color: string, map?: THREE.Texture) => {
            const material = new THREE.MeshMatcapMaterial({ matcap, map });
            material.userData.color = new THREE.Color(color).convertSRGBToLinear();
            this.materials.push(material);
            return material;
        };
        const coat = mat('#ffffff', this.createFurTexture());
        const fur = mat(COLORS.fur);
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

        // Body: one smooth, well-fed torso turned on a lathe (rump to chest
        // along +x), a belly that hangs a little, round haunches, a thick
        // neck up to the head
        const profile = [
            [0, -1.0], [0.3, -0.95], [0.48, -0.8], [0.57, -0.55],
            [0.6, -0.25], [0.59, 0.05], [0.56, 0.35], [0.52, 0.58],
            [0.44, 0.76], [0.3, 0.88], [0.12, 0.95], [0, 0.97],
        ].map(([r, y]) => new THREE.Vector2(r, y));
        const torso = new THREE.LatheGeometry(
            new THREE.SplineCurve(profile).getPoints(48),
            40
        );
        torso.rotateZ(-Math.PI / 2);
        this.body = new THREE.Group();
        this.root.add(this.body);
        part(coat, this.body, [0, 0, 0], [1, 0.95, 1], torso);
        part(coat, this.body, [-0.1, -0.2, 0], [0.62, 0.42, 0.52]);
        [-1, 1].forEach((side) =>
            part(coat, this.body, [-0.5, -0.12, side * 0.24], [0.4, 0.42, 0.26])
        );
        part(coat, this.body, [0.75, 0.28, 0], [0.32, 0.33, 0.33]);

        // Head: round with chubby cheeks and a short muzzle, big ears,
        // almond eyes, whiskers
        this.head = new THREE.Group();
        this.head.position.set(1.0, 0.42, 0);
        this.body.add(this.head);
        part(coat, this.head, [0, 0, 0], [0.4, 0.36, 0.42]);
        [-1, 1].forEach((side) => {
            part(coat, this.head, [0.1, -0.11, side * 0.21], [0.27, 0.23, 0.25]);
            part(white, this.head, [0.33, -0.14, side * 0.065], [0.1, 0.08, 0.09]);
        });
        part(white, this.head, [0.29, -0.22, 0], [0.09, 0.06, 0.09]);
        part(pink, this.head, [0.41, -0.06, 0], [0.035, 0.028, 0.05]);

        const ear = new THREE.ConeGeometry(0.2, 0.28, 16);
        this.ears = [-1, 1].map((side) => {
            const e = part(fur, this.head, [-0.02, 0.31, side * 0.2], [0.7, 1, 1], ear);
            e.rotation.x = side * 0.3;
            part(pink, e, [0.3, -0.04, 0], [0.5, 0.75, 0.68], ear);
            return e;
        });

        this.pupils = [];
        this.eyes = [-1, 1].map((side) => {
            const eye = new THREE.Group();
            eye.position.set(0.36, 0.05, side * 0.15);
            eye.rotation.y = -side * 0.4;
            this.head.add(eye);
            part(iris, eye, [0, 0, 0], [0.07, 0.068, 0.085]);
            this.pupils.push(part(pupil, eye, [0.045, 0, 0], [0.035, 0.06, 0.06]));
            part(shine, eye, [0.072, 0.03, -side * 0.022], [0.016, 0.018, 0.016]);
            return eye;
        });

        const whiskerPoints: THREE.Vector3[] = [];
        [-1, 1].forEach((side) => {
            [-0.03, 0, 0.03].forEach((dy, i) => {
                whiskerPoints.push(
                    new THREE.Vector3(0.37, -0.13 + dy, side * 0.1),
                    new THREE.Vector3(0.4 - i * 0.03, -0.09 + dy * 2.5, side * 0.64)
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

        // Legs: hip (shoulder) pivot, upper segment, knee pivot, lower
        // segment, white paw. Thighs are thicker than forelegs.
        const leg = (x: number, z: number, front: boolean): Leg => {
            const len = front ? LEG.front : LEG.back;
            const hip = new THREE.Group();
            hip.position.set(x, -0.25, z);
            this.body.add(hip);
            part(fur, hip, [0, -0.05, 0], front ? [0.18, 0.22, 0.16] : [0.24, 0.28, 0.18]);
            const upper = new THREE.CylinderGeometry(
                front ? 0.16 : 0.2,
                0.12,
                len.upper,
                12
            );
            upper.translate(0, -len.upper / 2, 0);
            part(fur, hip, [0, 0, 0], [1, 1, 1], upper);

            const knee = new THREE.Group();
            knee.position.set(0, -len.upper, 0);
            hip.add(knee);
            part(fur, knee, [0, 0, 0], [0.12, 0.12, 0.12]);
            const lower = new THREE.CylinderGeometry(0.12, 0.105, len.lower, 12);
            lower.translate(0, -len.lower / 2, 0);
            part(fur, knee, [0, 0, 0], [1, 1, 1], lower);
            part(white, knee, [0.04, -len.lower + 0.03, 0], [0.14, 0.095, 0.12]);
            return { hip, knee };
        };
        this.frontLegs = [leg(0.6, 0.2, true), leg(0.6, -0.2, true)];
        this.backLegs = [leg(-0.55, 0.2, false), leg(-0.55, -0.2, false)];

        // Tail: long chain of thick segments tapering to a fluffy tip
        this.tail = [];
        let parent: THREE.Object3D = this.body;
        let x = -0.95;
        const SEGMENTS = 10;
        for (let i = 0; i < SEGMENTS; i++) {
            const seg = new THREE.Group();
            seg.position.set(x, i === 0 ? 0.22 : 0, 0);
            parent.add(seg);
            const r0 = 0.12 - i * 0.005;
            const g = new THREE.CylinderGeometry(r0 - 0.003, r0, 0.2, 12);
            g.rotateZ(Math.PI / 2);
            g.translate(-0.1, 0, 0);
            part(coat, seg, [0, 0, 0], [1, 1, 1], g);
            // joint ball keeps the bends smooth
            part(fur, seg, [0, 0, 0], [r0, r0, r0]);
            if (i === SEGMENTS - 1)
                part(fur, seg, [-0.2, 0, 0], [0.09, 0.07, 0.07]);
            this.tail.push(seg);
            parent = seg;
            x = -0.18;
        }

        // Fur: a few see-through shells around every furry part, each a
        // little bigger and sparser, so the silhouette goes soft and fuzzy
        const strands = this.createStrandTexture();
        const furry = [coat, fur, white];
        const shellMaterials = furry.map((base) =>
            [...Array(FUR_SHELLS)].map((_, i) => {
                const m = mat('#ffffff');
                m.userData.color.copy(base.userData.color);
                m.alphaMap = strands;
                m.alphaTest = 0.35 + (i / FUR_SHELLS) * 0.5;
                return m;
            })
        );
        const furryMeshes: THREE.Mesh[] = [];
        this.root.traverse((o) => {
            if (o instanceof THREE.Mesh && furry.includes(o.material as THREE.MeshMatcapMaterial))
                furryMeshes.push(o);
        });
        // Each shell pushes the vertices out along their normals by the same
        // length in cat units whatever the part's scale, so thin legs get as
        // much fur as the body
        furryMeshes.forEach((mesh) => {
            const shells =
                shellMaterials[furry.indexOf(mesh.material as THREE.MeshMatcapMaterial)];
            shells.forEach((material, i) => {
                const geometry = mesh.geometry.clone();
                const position = geometry.attributes.position;
                const normal = geometry.attributes.normal;
                const d = (i + 1) * FUR_LENGTH;
                for (let v = 0; v < position.count; v++)
                    position.setXYZ(
                        v,
                        position.getX(v) + (normal.getX(v) * d) / mesh.scale.x,
                        position.getY(v) + (normal.getY(v) * d) / mesh.scale.y,
                        position.getZ(v) + (normal.getZ(v) * d) / mesh.scale.z
                    );
                mesh.add(new THREE.Mesh(geometry, material));
            });
        });

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

    /** Fine random strands for the fur shells' alpha (green channel). */
    createStrandTexture() {
        const size = 128;
        const canvas = document.createElement('canvas');
        canvas.width = canvas.height = size;
        const ctx = canvas.getContext('2d') as CanvasRenderingContext2D;
        const image = ctx.createImageData(size, size);
        for (let i = 0; i < size * size; i++) {
            const v = Math.random() * 255;
            image.data[i * 4] = image.data[i * 4 + 1] = image.data[i * 4 + 2] = v;
            image.data[i * 4 + 3] = 255;
        }
        ctx.putImageData(image, 0, 0);
        const texture = new THREE.CanvasTexture(canvas);
        texture.wrapS = texture.wrapT = THREE.RepeatWrapping;
        texture.repeat.set(6, 4);
        texture.magFilter = THREE.NearestFilter;
        return texture;
    }

    createMatcap() {
        const size = 128;
        const canvas = document.createElement('canvas');
        canvas.width = canvas.height = size;
        const ctx = canvas.getContext('2d') as CanvasRenderingContext2D;
        // key light from the top left, soft falloff, then a bright fuzzy rim
        // like light catching fur at the silhouette
        const gradient = ctx.createRadialGradient(44, 38, 4, 64, 64, 64);
        gradient.addColorStop(0, '#ffffff');
        gradient.addColorStop(0.45, '#ececec');
        gradient.addColorStop(0.8, '#b0b0b0');
        gradient.addColorStop(0.92, '#bcbcbc');
        gradient.addColorStop(1, '#e2e2e2');
        ctx.fillStyle = gradient;
        ctx.fillRect(0, 0, size, size);
        const texture = new THREE.CanvasTexture(canvas);
        texture.encoding = THREE.sRGBEncoding;
        return texture;
    }

    /**
     * Soft white coat: a faint cream wash with fine light and grey strokes
     * for fur grain, slightly greyer underneath (v runs top to bottom on the
     * spheres and around the torso).
     */
    createFurTexture() {
        const w = 256;
        const h = 128;
        const canvas = document.createElement('canvas');
        canvas.width = w;
        canvas.height = h;
        const ctx = canvas.getContext('2d') as CanvasRenderingContext2D;
        ctx.fillStyle = COLORS.fur;
        ctx.fillRect(0, 0, w, h);

        ctx.lineWidth = 0.8;
        for (let i = 0; i < 2600; i++) {
            const x = Math.random() * w;
            const y = Math.random() * h;
            ctx.strokeStyle =
                i % 2 ? 'rgba(255,255,255,0.5)' : 'rgba(150,140,130,0.14)';
            ctx.beginPath();
            ctx.moveTo(x, y);
            ctx.lineTo(x + (Math.random() - 0.5) * 2, y + 2 + Math.random() * 3);
            ctx.stroke();
        }
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

        // Pupils: wide and round in the dark, narrowing to slits once the
        // screen lights up
        const wide = !lighting || !lighting.screenOn;
        this.pupilWidth +=
            ((wide ? 1 : 0.35) - this.pupilWidth) * (1 - Math.exp(-dt * 2));
        this.pupils.forEach((p) => (p.scale.z = 0.06 * this.pupilWidth));
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
            // ease in and out; the gait phase follows distance so paws
            // don't slide
            const duration = this.walkDistance / WALK_SPEED;
            const p = smooth(Math.min(t / duration, 1));
            this.root.position.lerpVectors(WAIT_SPOT, JUMP_FROM, p);
            this.gaitPhase = (p * this.walkDistance) / STRIDE;
            if (t >= duration) {
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

    /** Idle timers: where to look, when to blink, which ear to flick. */
    updateLife(t: number, dt: number) {
        const idle = this.state === 'waiting' || this.state === 'seated';
        if (t > this.nextGlance) {
            this.glanceTarget = idle ? (Math.random() - 0.5) * 1.0 : 0;
            this.nextGlance = t + 1.5 + Math.random() * 3;
        }
        if (!idle) this.glanceTarget = 0;
        this.glance += (this.glanceTarget - this.glance) * (1 - Math.exp(-dt * 4));

        if (t > this.nextBlink) {
            this.blinkStart = t;
            // now and then a slow, contented blink
            this.blinkLength = idle && Math.random() < 0.3 ? 0.9 : 0.15;
            this.nextBlink = t + 2.5 + Math.random() * 4;
        }
        if (t > this.nextTwitch) {
            this.twitchStart = t;
            this.twitchEar = Math.random() < 0.5 ? 0 : 1;
            this.nextTwitch = t + 3 + Math.random() * 5;
        }
    }

    /** Hip swing and paw lift for one leg at the given gait phase. */
    step(phase: number) {
        const c = phase - Math.floor(phase);
        if (c < STANCE) return { swing: SWING * (1 - (2 * c) / STANCE), lift: 0 };
        const s = (c - STANCE) / (1 - STANCE);
        return { swing: SWING * (2 * smooth(s) - 1), lift: Math.sin(Math.PI * s) };
    }

    update() {
        const dt = Math.min(this.time.delta, 100) / 1000;
        const t = this.time.current / 1000;
        this.updateState(dt);
        this.updateBrightness(dt);
        this.updateLife(t, dt);

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

        // Gait blends in while walking and out at either end
        const walking = this.state === 'walking';
        this.gait += ((walking ? 1 : 0) - this.gait) * (1 - Math.exp(-dt * 6));
        const g = this.gait;
        const phase = this.gaitPhase;

        // Body: slight bob twice a cycle and a roll with the hips, breathing,
        // a butt wiggle before the jump, a squash on landing
        const p = this.pose;
        const breath = Math.sin(t * 2.4);
        const bob = g * Math.cos(phase * Math.PI * 4) * 0.025;
        let wiggle = 0;
        if (this.state === 'crouch') {
            const w = this.stateTime / DURATIONS.crouch;
            wiggle = Math.sin(this.stateTime * 16) * 0.1 * Math.sin(Math.PI * Math.min(w * 1.3, 1));
        }
        const squash =
            this.state === 'settle' ? 0.1 * Math.exp(-this.stateTime * 9) : 0;
        this.body.position.y = p.bodyY + bob;
        this.body.rotation.z = p.bodyPitch;
        this.body.rotation.x = g * Math.sin(phase * Math.PI * 2) * 0.03;
        this.body.rotation.y = wiggle;
        this.body.scale.set(
            1 + squash * 0.5,
            1 + breath * 0.02 - squash,
            1 + breath * 0.02 + squash * 0.5
        );

        // Head stays level and fixed on its target while the body moves;
        // curious tilt when clicked seated
        let tilt = 0;
        if (this.tiltTime >= 0) {
            this.tiltTime += dt;
            tilt = Math.sin(Math.min(this.tiltTime / 1.2, 1) * Math.PI) * 0.35;
            if (this.tiltTime > 1.2) this.tiltTime = -1;
        }
        this.head.position.y = p.headY - bob * 0.8;
        this.head.rotation.z = p.headPitch;
        this.head.rotation.y = this.glance - wiggle;
        this.head.rotation.x = tilt - this.body.rotation.x;

        // Blinks (quick or slow), random ear flicks
        const bt = (t - this.blinkStart) / this.blinkLength;
        const lid = bt >= 0 && bt < 1 ? 1 - Math.sin(Math.PI * bt) * 0.92 : 1;
        this.eyes.forEach((eye) => (eye.scale.y = lid));
        const tw = (t - this.twitchStart) / 0.25;
        const flick = tw >= 0 && tw < 1 ? Math.sin(Math.PI * tw) * 0.35 : 0;
        this.ears.forEach((ear, i) => {
            const side = i === 0 ? -1 : 1;
            ear.rotation.x = side * 0.3 + (i === this.twitchEar ? side * flick : 0);
        });

        // Legs: lateral sequence walk; swinging paws fold up off the floor.
        // One front paw taps the mouse twice.
        const tap =
            this.state === 'tap'
                ? Math.max(
                      0,
                      Math.sin((this.stateTime / DURATIONS.tap) * Math.PI * 4)
                  ) * 0.45
                : 0;
        const legs: [Leg, number, boolean, number][] = [
            [this.frontLegs[0], PHASES.frontL, true, tap],
            [this.frontLegs[1], PHASES.frontR, true, 0],
            [this.backLegs[0], PHASES.backL, false, 0],
            [this.backLegs[1], PHASES.backR, false, 0],
        ];
        legs.forEach(([leg, offset, front, extra]) => {
            const s = this.step(phase + offset);
            leg.hip.rotation.z = (front ? p.front : p.back) + g * s.swing + extra;
            leg.knee.rotation.z =
                (front ? p.frontKnee : p.backKnee) -
                g * s.lift * (front ? 1.1 : 0.8) -
                extra * 0.8;
        });

        // Tail: base angle is relative to the cat, not the pitched body;
        // the next two segments level it off when it lies on a surface,
        // the rest bend and curl, with a wave travelling down to the tip
        const swayAmp = walking ? 0.07 : 0.04;
        this.tail.forEach((seg, i) => {
            const wave =
                Math.sin(t * 2.2 - i * 0.55) * swayAmp * (0.3 + i / 9) +
                // the tip flicks on its own when idle
                (i >= 7 ? Math.sin(t * 3.1) * 0.12 * (1 - g) : 0);
            if (i === 0) {
                seg.rotation.z = p.tailDroop - p.bodyPitch;
                seg.rotation.y = wave;
            } else if (i <= 2) {
                seg.rotation.z = -p.tailDroop * 0.5 * p.tailFlat + p.tailBend;
                seg.rotation.y = p.tailCurl * 0.4 + wave;
            } else {
                seg.rotation.z = p.tailBend + (i >= 7 ? p.tailHook : 0);
                seg.rotation.y = p.tailCurl * 0.8 + wave;
            }
        });
    }
}
