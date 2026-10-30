import * as THREE from 'three';
import { CSS3DObject } from 'three/examples/jsm/renderers/CSS3DRenderer.js';
import GUI from 'lil-gui';
import Application from '../Application';
import Debug from '../Utils/Debug';
import Resources from '../Utils/Resources';
import Sizes from '../Utils/Sizes';
import Camera from '../Camera/Camera';
import EventEmitter from '../Utils/EventEmitter';
import UIEventBus from '../UI/EventBus';
import { RoomTheme, storedTheme } from './Lighting';

// A 16:10 panel on the modern monitor (see Workstation.ts), in world units
export const SCREEN_SIZE = { w: 1920, h: 1200 };
// The OS renders at this CSS size and is scaled up onto the panel, so its
// text reads larger when the camera zooms in
const SCREEN_PX = { w: 1280, h: 800 };
const PX_SCALE = SCREEN_SIZE.w / SCREEN_PX.w;
const IFRAME_PADDING = 24;
const IFRAME_SIZE = {
    w: SCREEN_PX.w - IFRAME_PADDING,
    h: SCREEN_PX.h - IFRAME_PADDING,
};

export default class MonitorScreen extends EventEmitter {
    application: Application;
    scene: THREE.Scene;
    cssScene: THREE.Scene;
    resources: Resources;
    debug: Debug;
    sizes: Sizes;
    debugFolder: GUI;
    screenSize: THREE.Vector2;
    position: THREE.Vector3;
    rotation: THREE.Euler;
    camera: Camera;
    prevInComputer: boolean;
    shouldLeaveMonitor: boolean;
    inComputer: boolean;
    mouseClickInProgress: boolean;
    dimmingPlane: THREE.Mesh;
    screenOff: THREE.Mesh;
    powered: boolean;
    iframe: HTMLIFrameElement;
    powerOnTime: number;

    constructor() {
        super();
        this.application = new Application();
        this.scene = this.application.scene;
        this.cssScene = this.application.cssScene;
        this.sizes = this.application.sizes;
        this.resources = this.application.resources;
        this.screenSize = new THREE.Vector2(SCREEN_SIZE.w, SCREEN_SIZE.h);
        this.camera = this.application.camera;
        this.position = new THREE.Vector3(0, 950, 255);
        this.rotation = new THREE.Euler(-3 * THREE.MathUtils.DEG2RAD, 0, 0);
        this.mouseClickInProgress = false;
        this.shouldLeaveMonitor = false;
        this.powered = false;
        this.powerOnTime = -1;

        // Create screen
        this.initializeScreenEvents();
        this.createIframe();
        const maxOffset = this.createTextureLayers();
        this.createPerspectiveDimmer(maxOffset);
        this.createScreenOff();
    }

    initializeScreenEvents() {
        document.addEventListener(
            'mousemove',
            (event) => {
                // @ts-ignore
                const id = event.target.id;
                if (id === 'computer-screen') {
                    // @ts-ignore
                    event.inComputer = true;
                }

                // @ts-ignore
                this.inComputer = event.inComputer;

                if (
                    this.inComputer &&
                    !this.prevInComputer &&
                    this.powered
                ) {
                    this.camera.trigger('enterMonitor');
                }

                if (
                    !this.inComputer &&
                    this.prevInComputer &&
                    !this.mouseClickInProgress
                ) {
                    this.camera.trigger('leftMonitor');
                }

                if (
                    !this.inComputer &&
                    this.mouseClickInProgress &&
                    this.prevInComputer
                ) {
                    this.shouldLeaveMonitor = true;
                } else {
                    this.shouldLeaveMonitor = false;
                }

                this.application.mouse.trigger('mousemove', [event]);

                this.prevInComputer = this.inComputer;
            },
            false
        );
        document.addEventListener(
            'mousedown',
            (event) => {
                // @ts-ignore
                this.inComputer = event.inComputer;
                this.application.mouse.trigger('mousedown', [event]);

                this.mouseClickInProgress = true;
                this.prevInComputer = this.inComputer;
            },
            false
        );
        document.addEventListener(
            'mouseup',
            (event) => {
                // @ts-ignore
                this.inComputer = event.inComputer;
                this.application.mouse.trigger('mouseup', [event]);

                if (this.shouldLeaveMonitor) {
                    this.camera.trigger('leftMonitor');
                    this.shouldLeaveMonitor = false;
                }

                this.mouseClickInProgress = false;
                this.prevInComputer = this.inComputer;
            },
            false
        );
    }

    /**
     * Creates the iframe for the computer screen
     */
    createIframe() {
        // Create container
        const container = document.createElement('div');
        container.style.width = SCREEN_PX.w + 'px';
        container.style.height = SCREEN_PX.h + 'px';
        container.style.opacity = '1';
        container.style.background = '#1d2e2f';

        // Create iframe
        const iframe = document.createElement('iframe');
        this.iframe = iframe;

        // Bubble mouse move events to the main application, so we can affect the camera
        iframe.onload = () => {
            if (iframe.contentWindow) {
                // Room <-> OS bridge. The OS learns the room theme; the room
                // takes the colour of whatever wallpaper the OS is showing.
                const sendTheme = (theme: RoomTheme) =>
                    iframe.contentWindow?.postMessage(
                        { type: 'room-theme', theme },
                        '*'
                    );
                sendTheme(storedTheme());
                UIEventBus.on('themeToggle', sendTheme);

                window.addEventListener('message', (event) => {
                    if (!event.data || typeof event.data.type !== 'string')
                        return;
                    // the OS boots when the monitor is on; tell it if it
                    // already is by the time it has loaded
                    if (event.data.type === 'os-ready') {
                        if (this.powered) this.sendPowerOn();
                        return;
                    }
                    if (event.data.type === 'os-wallpaper') {
                        const lighting = this.application.world?.lighting;
                        if (lighting && typeof event.data.lightColor === 'string')
                            lighting.setGlowColor(
                                event.data.lightColor,
                                typeof event.data.intensityScale === 'number'
                                    ? event.data.intensityScale
                                    : 1
                            );
                        return;
                    }
                    var evt = new CustomEvent(event.data.type, {
                        bubbles: true,
                        cancelable: false,
                    });

                    // @ts-ignore
                    evt.inComputer = true;
                    if (event.data.type === 'mousemove') {
                        var clRect = iframe.getBoundingClientRect();
                        const { top, left, width, height } = clRect;
                        const widthRatio = width / IFRAME_SIZE.w;
                        const heightRatio = height / IFRAME_SIZE.h;

                        // @ts-ignore
                        evt.clientX = Math.round(
                            event.data.clientX * widthRatio + left
                        );
                        //@ts-ignore
                        evt.clientY = Math.round(
                            event.data.clientY * heightRatio + top
                        );
                    } else if (event.data.type === 'keydown') {
                        // @ts-ignore
                        evt.key = event.data.key;
                    } else if (event.data.type === 'keyup') {
                        // @ts-ignore
                        evt.key = event.data.key;
                    }

                    iframe.dispatchEvent(evt);
                });
                // in case the screen came on before the OS was listening
                if (this.powered) this.sendPowerOn();
            }
        };

        // Set iframe attributes
        // PROD
        iframe.src = 'https://samarjeet-os.vercel.app/';
        /**
         * Use dev server is query params are present
         *
         * Warning: This will not work unless the dev server is running on localhost:3000
         * Also running the dev server causes browsers to freak out over unsecure connections
         * in the iframe, so it will flag a ton of issues.
         */
        const urlParams = new URLSearchParams(window.location.search);
        if (urlParams.has('dev')) {
            iframe.src = 'http://localhost:3000/';
        }
        iframe.style.width = SCREEN_PX.w + 'px';
        iframe.style.height = SCREEN_PX.h + 'px';
        iframe.style.padding = IFRAME_PADDING + 'px';
        iframe.style.boxSizing = 'border-box';
        iframe.style.opacity = '1';
        iframe.className = 'jitter';
        iframe.id = 'computer-screen';
        iframe.frameBorder = '0';
        iframe.title = 'SamOS';

        // Add iframe to container
        container.appendChild(iframe);

        // Create CSS plane
        this.createCssPlane(container);
    }

    /**
     * Creates a CSS plane and GL plane to properly occlude the CSS plane
     * @param element the element to create the css plane for
     */
    createCssPlane(element: HTMLElement) {
        // Create CSS3D object
        const object = new CSS3DObject(element);

        // copy monitor position and rotation
        object.position.copy(this.position);
        object.rotation.copy(this.rotation);
        object.scale.setScalar(PX_SCALE);

        // Add to CSS scene
        this.cssScene.add(object);

        // Create GL plane. Unlit black: with scene lights present a lit
        // material would write lit rgb at alpha 0, which the browser composites
        // as added light over the CSS screen (premultiplied alpha).
        const material = new THREE.MeshBasicMaterial({ color: 0x000000 });
        material.side = THREE.DoubleSide;
        material.opacity = 0;
        material.transparent = true;
        // NoBlending allows the GL plane to occlude the CSS plane
        material.blending = THREE.NoBlending;

        // Create plane geometry (CSS pixels; scaled like the CSS object)
        const geometry = new THREE.PlaneGeometry(SCREEN_PX.w, SCREEN_PX.h);

        // Create the GL plane mesh
        const mesh = new THREE.Mesh(geometry, material);

        // Copy the position, rotation and scale of the CSS plane to the GL plane
        mesh.position.copy(object.position);
        mesh.rotation.copy(object.rotation);
        mesh.scale.copy(object.scale);

        // Add to gl scene
        this.scene.add(mesh);
    }

    /**
     * The glass in front of the flat panel: just a faint sheen of smudges.
     * @returns the maximum offset of the texture layers
     */
    createTextureLayers() {
        const offset = 8;
        this.addTextureLayer(
            this.resources.items.texture.monitorSmudgeTexture,
            THREE.AdditiveBlending,
            0.04,
            offset
        );
        return offset;
    }

    /**
     * Adds a texture layer to the screen
     * @param texture the texture to add
     * @param blending the blending mode
     * @param opacity the opacity of the texture
     * @param offset the offset of the texture, higher values are further from the screen
     */
    addTextureLayer(
        texture: THREE.Texture,
        blendingMode: THREE.Blending,
        opacity: number,
        offset: number
    ) {
        // Create material
        const material = new THREE.MeshBasicMaterial({
            map: texture,
            blending: blendingMode,
            side: THREE.DoubleSide,
            opacity,
            transparent: true,
        });

        // Create geometry
        const geometry = new THREE.PlaneGeometry(
            this.screenSize.width,
            this.screenSize.height
        );

        // Create mesh
        const mesh = new THREE.Mesh(geometry, material);

        // Copy position and apply the depth offset
        mesh.position.copy(
            this.offsetPosition(this.position, new THREE.Vector3(0, 0, offset))
        );

        // Copy rotation
        mesh.rotation.copy(this.rotation);

        this.scene.add(mesh);
    }

    createPerspectiveDimmer(maxOffset: number) {
        const material = new THREE.MeshBasicMaterial({
            side: THREE.DoubleSide,
            color: 0x000000,
            transparent: true,
            blending: THREE.AdditiveBlending,
        });

        const plane = new THREE.PlaneGeometry(
            this.screenSize.width,
            this.screenSize.height
        );

        const mesh = new THREE.Mesh(plane, material);

        mesh.position.copy(
            this.offsetPosition(
                this.position,
                new THREE.Vector3(0, 0, maxOffset - 5)
            )
        );

        mesh.rotation.copy(this.rotation);

        this.dimmingPlane = mesh;

        this.scene.add(mesh);
    }

    /**
     * Black plane just in front of the screen: the monitor starts switched
     * off and the cat turns it on (see Cat.ts).
     */
    createScreenOff() {
        this.screenOff = new THREE.Mesh(
            new THREE.PlaneGeometry(this.screenSize.width, this.screenSize.height),
            new THREE.MeshBasicMaterial({
                color: 0x000000,
                transparent: true,
                opacity: 1,
            })
        );
        this.screenOff.position.copy(
            this.offsetPosition(this.position, new THREE.Vector3(0, 0, 4))
        );
        this.screenOff.rotation.copy(this.rotation);
        this.scene.add(this.screenOff);
    }

    powerOn() {
        if (this.powered) return;
        this.powered = true;
        this.powerOnTime = 0;
        this.application.world.lighting?.setScreenOn();
        UIEventBus.dispatch('screenPowerOn', {});
        this.sendPowerOn();
    }

    sendPowerOn() {
        this.iframe?.contentWindow?.postMessage({ type: 'power-on' }, '*');
    }

    /**
     * Offsets a position vector by another vector
     * @param position the position to offset
     * @param offset the offset to apply
     * @returns the new offset position
     */
    offsetPosition(position: THREE.Vector3, offset: THREE.Vector3) {
        const newPosition = new THREE.Vector3();
        newPosition.copy(position);
        newPosition.add(offset);
        return newPosition;
    }

    update() {
        // Panel wake-up: the black plane fades out
        if (this.powerOnTime >= 0) {
            this.powerOnTime += Math.min(this.application.time.delta, 100) / 1000;
            const t = this.powerOnTime;
            const material = this.screenOff.material as THREE.MeshBasicMaterial;
            material.opacity = Math.max(0, 1 - t / 0.6);
            if (t > 0.6) {
                this.screenOff.visible = false;
                this.powerOnTime = -1;
            }
        }

        if (this.dimmingPlane) {
            const planeNormal = new THREE.Vector3(0, 0, 1);
            const viewVector = new THREE.Vector3();
            viewVector.copy(this.camera.instance.position);
            viewVector.sub(this.position);
            viewVector.normalize();

            const dot = viewVector.dot(planeNormal);

            // calculate the distance from the camera vector to the plane vector
            const dimPos = this.dimmingPlane.position;
            const camPos = this.camera.instance.position;

            const distance = Math.sqrt(
                (camPos.x - dimPos.x) ** 2 +
                    (camPos.y - dimPos.y) ** 2 +
                    (camPos.z - dimPos.z) ** 2
            );

            const opacity = 1 / (distance / 10000);

            const DIM_FACTOR = 0.7;

            // @ts-ignore
            this.dimmingPlane.material.opacity =
                (1 - opacity) * DIM_FACTOR + (1 - dot) * DIM_FACTOR;
        }
    }
}
