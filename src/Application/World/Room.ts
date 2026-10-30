import * as THREE from 'three';
import Application from '../Application';

/**
 * The room around the desk, cut away like a diorama: a back wall (with the
 * window opening), a right wall, a plank floor, a rug under the desk and
 * chair, skirting boards and a cap on the cut wall tops. The idle camera
 * sits at -x/+z, so the walls stand on the far sides and never block it.
 *
 * World units match the GLBs (floor -2980, desk top -452).
 */
export const FLOOR_Y = -2980;
export const ROOM = {
    left: -6500,
    right: 6000,
    back: -2000, // inner face of the back wall
    front: 5500,
    top: 5600,
    wall: 160, // wall thickness
};
// The window opening in the back wall, left of the monitor
export const WINDOW = { x: -1900, y: 1350, width: 2300, height: 3000 };

const COLORS = {
    wall: '#1b2029',
    cap: '#2c3442',
    skirting: '#2e2d33',
    plank: '#6a4c37',
    rug: '#5b2f33',
    rugBorder: '#c9a46a',
};
// One floor texture tile covers this many world units
const PLANK_TILE = 9000;

export default class Room {
    application: Application;
    scene: THREE.Scene;

    constructor() {
        this.application = new Application();
        this.scene = this.application.scene;

        this.setWalls();
        this.setFloor();
        this.setRug();
    }

    material(color: string, map?: THREE.Texture) {
        return new THREE.MeshPhongMaterial({
            color,
            map,
            specular: 0x000000,
            shininess: 0,
        });
    }

    box(
        material: THREE.Material,
        x0: number, x1: number,
        y0: number, y1: number,
        z0: number, z1: number
    ) {
        const mesh = new THREE.Mesh(
            new THREE.BoxGeometry(x1 - x0, y1 - y0, z1 - z0),
            material
        );
        mesh.position.set((x0 + x1) / 2, (y0 + y1) / 2, (z0 + z1) / 2);
        this.scene.add(mesh);
        return mesh;
    }

    setWalls() {
        const r = ROOM;
        const w = WINDOW;
        const wall = this.material(COLORS.wall);

        // Back wall, running past the right wall so the corner is closed
        const shape = new THREE.Shape();
        shape.moveTo(r.left, FLOOR_Y);
        shape.lineTo(r.right + r.wall, FLOOR_Y);
        shape.lineTo(r.right + r.wall, r.top);
        shape.lineTo(r.left, r.top);
        shape.closePath();
        const hole = new THREE.Path();
        hole.moveTo(w.x - w.width / 2, w.y - w.height / 2);
        hole.lineTo(w.x - w.width / 2, w.y + w.height / 2);
        hole.lineTo(w.x + w.width / 2, w.y + w.height / 2);
        hole.lineTo(w.x + w.width / 2, w.y - w.height / 2);
        hole.closePath();
        shape.holes.push(hole);
        const back = new THREE.Mesh(
            new THREE.ExtrudeGeometry(shape, { depth: r.wall, bevelEnabled: false }),
            wall
        );
        back.position.z = r.back - r.wall;
        this.scene.add(back);

        // Right wall
        this.box(wall, r.right, r.right + r.wall, FLOOR_Y, r.top, r.back, r.front);

        // Caps on the cut edges, a shade lighter so the walls read as solid
        const cap = this.material(COLORS.cap);
        const c = 30;
        this.box(cap, r.left, r.right + r.wall, r.top, r.top + c, r.back - r.wall, r.back);
        this.box(cap, r.right, r.right + r.wall, r.top, r.top + c, r.back, r.front);
        this.box(cap, r.left - c, r.left, FLOOR_Y, r.top + c, r.back - r.wall, r.back);
        this.box(cap, r.right, r.right + r.wall, FLOOR_Y, r.top + c, r.front, r.front + c);

        // Skirting boards
        const skirting = this.material(COLORS.skirting);
        const sh = 150;
        const sd = 35;
        this.box(skirting, r.left, r.right, FLOOR_Y, FLOOR_Y + sh, r.back, r.back + sd);
        this.box(skirting, r.right - sd, r.right, FLOOR_Y, FLOOR_Y + sh, r.back, r.front);
    }

    setFloor() {
        const r = ROOM;
        const width = r.right - r.left;
        const depth = r.front - r.back;
        const texture = this.createPlankTexture();
        texture.wrapS = texture.wrapT = THREE.RepeatWrapping;
        texture.repeat.set(width / PLANK_TILE, depth / PLANK_TILE);
        const floor = new THREE.Mesh(
            new THREE.PlaneGeometry(width, depth),
            this.material('#ffffff', texture)
        );
        floor.rotation.x = -Math.PI / 2;
        floor.position.set((r.left + r.right) / 2, FLOOR_Y + 3, (r.back + r.front) / 2);
        this.scene.add(floor);

        // the slab's open edges, so the floor has a little thickness
        const edge = this.material(COLORS.cap);
        this.box(edge, r.left - 30, r.right, FLOOR_Y - 120, FLOOR_Y + 2, r.front, r.front + 30);
        this.box(edge, r.left - 30, r.left, FLOOR_Y - 120, FLOOR_Y + 2, r.back - r.wall, r.front + 30);
    }

    setRug() {
        const rug = new THREE.Mesh(
            new THREE.PlaneGeometry(5600, 3800),
            this.material('#ffffff', this.createRugTexture())
        );
        rug.rotation.x = -Math.PI / 2;
        rug.position.set(-500, FLOOR_Y + 8, 1900);
        this.scene.add(rug);
    }

    /** Planks running along x: rows of random lengths, seams and grain. */
    createPlankTexture() {
        const size = 1024;
        const rows = 16;
        const rowH = size / rows;
        const canvas = document.createElement('canvas');
        canvas.width = canvas.height = size;
        const ctx = canvas.getContext('2d') as CanvasRenderingContext2D;
        const base = new THREE.Color(COLORS.plank);

        for (let row = 0; row < rows; row++) {
            let x = -Math.random() * 300;
            while (x < size) {
                const len = 280 + Math.random() * 380;
                const tint = base.clone().offsetHSL(
                    (Math.random() - 0.5) * 0.02,
                    (Math.random() - 0.5) * 0.08,
                    (Math.random() - 0.5) * 0.08
                );
                ctx.fillStyle = `#${tint.getHexString()}`;
                ctx.fillRect(x, row * rowH, len, rowH);
                // grain
                ctx.strokeStyle = 'rgba(40,24,14,0.18)';
                ctx.lineWidth = 1;
                for (let g = 0; g < 6; g++) {
                    const gy = row * rowH + 4 + Math.random() * (rowH - 8);
                    ctx.beginPath();
                    ctx.moveTo(x, gy);
                    for (let gx = x; gx < x + len; gx += 40)
                        ctx.lineTo(gx, gy + Math.sin(gx * 0.02 + g) * 1.5);
                    ctx.stroke();
                }
                // end seam
                ctx.fillStyle = 'rgba(20,12,8,0.6)';
                ctx.fillRect(x, row * rowH, 2, rowH);
                x += len;
            }
            // long seam between rows
            ctx.fillStyle = 'rgba(20,12,8,0.7)';
            ctx.fillRect(0, row * rowH, size, 2);
        }
        const texture = new THREE.CanvasTexture(canvas);
        texture.encoding = THREE.sRGBEncoding;
        texture.anisotropy = 4;
        return texture;
    }

    /** A worn wool rug: plain field, a border band and a fringe line. */
    createRugTexture() {
        const w = 560;
        const h = 380;
        const canvas = document.createElement('canvas');
        canvas.width = w;
        canvas.height = h;
        const ctx = canvas.getContext('2d') as CanvasRenderingContext2D;
        ctx.fillStyle = COLORS.rug;
        ctx.fillRect(0, 0, w, h);
        // wool speckle
        for (let i = 0; i < 6000; i++) {
            ctx.fillStyle = Math.random() < 0.5 ? 'rgba(0,0,0,0.08)' : 'rgba(255,220,200,0.05)';
            ctx.fillRect(Math.random() * w, Math.random() * h, 2, 2);
        }
        ctx.strokeStyle = COLORS.rugBorder;
        ctx.globalAlpha = 0.55;
        ctx.lineWidth = 6;
        ctx.strokeRect(22, 22, w - 44, h - 44);
        ctx.lineWidth = 2;
        ctx.strokeRect(38, 38, w - 76, h - 76);
        ctx.globalAlpha = 1;
        const texture = new THREE.CanvasTexture(canvas);
        texture.encoding = THREE.sRGBEncoding;
        return texture;
    }
}
