import * as THREE from 'three';
import { CameraKey } from './Camera';
import Application from '../Application';
import Mouse from '../Utils/Mouse';
import Sizes from '../Utils/Sizes';

export class CameraKeyframeInstance {
    position: THREE.Vector3;
    focalPoint: THREE.Vector3;

    constructor(keyframe: CameraKeyframe) {
        this.position = keyframe.position;
        this.focalPoint = keyframe.focalPoint;
    }

    update() {}
}

const keys: { [key in CameraKey]: CameraKeyframe } = {
    idle: {
        position: new THREE.Vector3(-20000, 9000, 20000),
        focalPoint: new THREE.Vector3(0, -1000, 0),
    },
    monitor: {
        position: new THREE.Vector3(0, 950, 2000),
        focalPoint: new THREE.Vector3(0, 950, 0),
    },
    desk: {
        position: new THREE.Vector3(0, 1800, 5500),
        focalPoint: new THREE.Vector3(0, 500, 0),
    },
    loading: {
        position: new THREE.Vector3(-35000, 35000, 35000),
        focalPoint: new THREE.Vector3(0, -5000, 0),
    },
    orbitControlsStart: {
        position: new THREE.Vector3(-15000, 10000, 15000),
        focalPoint: new THREE.Vector3(-100, 350, 0),
    },
};

export class MonitorKeyframe extends CameraKeyframeInstance {
    application: Application;
    sizes: Sizes;
    targetPos: THREE.Vector3;
    origin: THREE.Vector3;

    constructor() {
        const keyframe = keys.monitor;
        super(keyframe);
        this.application = new Application();
        this.sizes = this.application.sizes;
        this.origin = new THREE.Vector3().copy(keyframe.position);
        this.targetPos = new THREE.Vector3().copy(keyframe.position);
    }

    update() {
        const aspect = this.sizes.height / this.sizes.width;
        const additionalZoom = this.sizes.width < 768 ? 0 : 600;
        this.targetPos.z = this.origin.z + aspect * 1200 - additionalZoom;
        this.position.copy(this.targetPos);
    }
}

export class LoadingKeyframe extends CameraKeyframeInstance {
    constructor() {
        const keyframe = keys.loading;
        super(keyframe);
    }

    update() {}
}

export class DeskKeyframe extends CameraKeyframeInstance {
    origin: THREE.Vector3;
    application: Application;
    mouse: Mouse;
    sizes: Sizes;
    targetFoc: THREE.Vector3;
    targetPos: THREE.Vector3;

    constructor() {
        const keyframe = keys.desk;
        super(keyframe);
        this.application = new Application();
        this.mouse = this.application.mouse;
        this.sizes = this.application.sizes;
        this.origin = new THREE.Vector3().copy(keyframe.position);
        this.targetFoc = new THREE.Vector3().copy(keyframe.focalPoint);
        this.targetPos = new THREE.Vector3().copy(keyframe.position);
    }

    update() {
        this.targetFoc.x +=
            (this.mouse.x - this.sizes.width / 2 - this.targetFoc.x) * 0.05;
        this.targetFoc.y +=
            (-(this.mouse.y - this.sizes.height) - this.targetFoc.y) * 0.05;

        this.targetPos.x +=
            (this.mouse.x - this.sizes.width / 2 - this.targetPos.x) * 0.025;
        this.targetPos.y +=
            (-(this.mouse.y - this.sizes.height * 2) - this.targetPos.y) *
            0.025;

        const aspect = this.sizes.height / this.sizes.width;
        this.targetPos.z = this.origin.z + aspect * 3000 - 1800;

        this.focalPoint.copy(this.targetFoc);
        this.position.copy(this.targetPos);
    }
}

/**
 * Idle: a fixed view into the room's open corner that leans a little with
 * the mouse and settles back, so the room never drifts away on its own.
 */
export class IdleKeyframe extends CameraKeyframeInstance {
    application: Application;
    mouse: Mouse;
    sizes: Sizes;
    origin: THREE.Vector3;
    lean: THREE.Vector2;

    constructor() {
        const keyframe = keys.idle;
        super(keyframe);
        this.application = new Application();
        this.mouse = this.application.mouse;
        this.sizes = this.application.sizes;
        this.origin = new THREE.Vector3().copy(keyframe.position);
        this.lean = new THREE.Vector2();
    }

    update() {
        // -1..1 from the centre of the screen; nothing until the mouse moves
        const mx = this.mouse.x ? this.mouse.x / this.sizes.width - 0.5 : 0;
        const my = this.mouse.y ? this.mouse.y / this.sizes.height - 0.5 : 0;
        this.lean.x += (mx * 2 - this.lean.x) * 0.04;
        this.lean.y += (my * 2 - this.lean.y) * 0.04;

        // lean sideways around the room (x and z move together) and up/down
        this.position.x = this.origin.x + this.lean.x * 2500;
        this.position.z = this.origin.z + this.lean.x * 2500;
        this.position.y = this.origin.y - this.lean.y * 1500;
    }
}

export class OrbitControlsStart extends CameraKeyframeInstance {
    constructor() {
        const keyframe = keys.orbitControlsStart;
        super(keyframe);
    }

    update() {}
}
