import * as THREE from 'three';
import Application from '../Application';
import { FLOOR_Y, ROOM } from './Room';

/**
 * A walnut bookcase against the back wall, left of the window: five shelves
 * of books (instanced boxes with spine bands; some lean, some lie in
 * stacks), a plant and a small trophy on top, bookends here and there.
 * Placement is seeded so the shelf looks the same on every visit.
 */
const SHELF = { left: -6250, right: -3850, top: 1500, depth: 620, board: 50 };
const ROWS = 5;
const PALETTE = ['#2f3e5c', '#6b2b2e', '#2f5244', '#b08a3e', '#e2d6bd', '#2b5e6b', '#3a3a40', '#8a4b2a', '#5b4a72', '#9c3b3b'];
const COLORS = { wood: '#5b3d2a', back: '#3b281c', pot: '#c96f4a', leaf: '#3f7a4a', gold: '#d8b25a' };

export default class Bookshelf {
    application: Application;
    scene: THREE.Scene;
    seed: number;

    constructor() {
        this.application = new Application();
        this.scene = this.application.scene;
        this.seed = 7;
        this.setCase();
        this.setBooks();
        this.setDecor();
    }

    /** Small seeded random, so the books are the same every load. */
    rand() {
        this.seed = (this.seed * 16807) % 2147483647;
        return (this.seed - 1) / 2147483646;
    }

    material(color: string, map?: THREE.Texture) {
        return new THREE.MeshPhongMaterial({ color, map, specular: 0x111111, shininess: 12 });
    }

    box(material: THREE.Material, x0: number, x1: number, y0: number, y1: number, z0: number, z1: number) {
        const mesh = new THREE.Mesh(new THREE.BoxGeometry(x1 - x0, y1 - y0, z1 - z0), material);
        mesh.position.set((x0 + x1) / 2, (y0 + y1) / 2, (z0 + z1) / 2);
        this.scene.add(mesh);
        return mesh;
    }

    /** Height of the top of shelf i (0 is the bottom board). */
    shelfY(i: number) {
        const bottom = FLOOR_Y + 160;
        return bottom + (i * (SHELF.top - bottom)) / ROWS;
    }

    setCase() {
        const s = SHELF;
        const z0 = ROOM.back;
        const z1 = ROOM.back + s.depth;
        const wood = this.material(COLORS.wood);
        this.box(this.material(COLORS.back), s.left, s.right, FLOOR_Y, s.top, z0, z0 + 20);
        this.box(wood, s.left, s.left + s.board, FLOOR_Y, s.top + s.board, z0, z1);
        this.box(wood, s.right - s.board, s.right, FLOOR_Y, s.top + s.board, z0, z1);
        this.box(wood, s.left, s.right, s.top, s.top + s.board, z0, z1 + 20);
        // plinth and shelves
        this.box(wood, s.left, s.right, FLOOR_Y, FLOOR_Y + 160, z0, z1);
        for (let i = 1; i < ROWS; i++) {
            const y = this.shelfY(i);
            this.box(wood, s.left + s.board, s.right - s.board, y - s.board, y, z0, z1);
        }
    }

    setBooks() {
        type Book = { x: number; y: number; z: number; w: number; h: number; d: number; lean: number; flat: boolean };
        const books: Book[] = [];
        const z = ROOM.back + 40;
        for (let row = 0; row < ROWS; row++) {
            const floor = this.shelfY(row);
            const gap = this.shelfY(row + 1) - SHELF.board - floor;
            let x = SHELF.left + SHELF.board + 30;
            const end = SHELF.right - SHELF.board - 30;
            // leave a slot for decor on two rows
            const holeAt = row === 1 ? SHELF.left + 1700 : row === 3 ? SHELF.left + 400 : Infinity;
            while (x < end - 60) {
                if (x > holeAt && x < holeAt + 520) {
                    x = holeAt + 520;
                    continue;
                }
                const roll = this.rand();
                if (roll < 0.08) {
                    // a stack of books lying flat
                    let y = floor;
                    const w = 380 + this.rand() * 120;
                    if (x + w > end) break;
                    const n = 3 + Math.floor(this.rand() * 3);
                    for (let i = 0; i < n; i++) {
                        const h = 60 + this.rand() * 40;
                        books.push({ x: x + w / 2 + (this.rand() - 0.5) * 30, y: y + h / 2, z: z + 260, w, h, d: 440 + this.rand() * 60, lean: 0, flat: true });
                        y += h;
                    }
                    x += w + 40;
                    continue;
                }
                const w = 55 + this.rand() * 80;
                const h = Math.min(gap - 40, gap * (0.6 + this.rand() * 0.35));
                const d = 420 + this.rand() * 120;
                // now and then one leans against its neighbour
                const lean = roll > 0.93 ? -0.18 : 0;
                books.push({ x: x + w / 2 + (lean ? h * 0.09 : 0), y: floor + h / 2 - (lean ? h * 0.02 : 0), z: z + d / 2, w, h, d, lean, flat: false });
                x += w + (lean ? h * 0.18 : 2 + this.rand() * 6);
                if (this.rand() < 0.06) x += 120 + this.rand() * 150; // a gap
            }
        }

        const spines = new THREE.InstancedMesh(
            new THREE.BoxGeometry(1, 1, 1),
            this.material('#ffffff', this.createSpineTexture()),
            books.length
        );
        const m = new THREE.Matrix4();
        const q = new THREE.Quaternion();
        books.forEach((b, i) => {
            q.setFromEuler(new THREE.Euler(0, 0, b.lean));
            m.compose(new THREE.Vector3(b.x, b.y, b.z), q, new THREE.Vector3(b.w, b.h, b.d));
            spines.setMatrixAt(i, m);
            spines.setColorAt(i, new THREE.Color(PALETTE[Math.floor(this.rand() * PALETTE.length)]).convertSRGBToLinear());
        });
        this.scene.add(spines);
    }

    setDecor() {
        const s = SHELF;
        const top = s.top + s.board;
        const z = ROOM.back + s.depth / 2;

        // plant on top: pot and a few leaf blobs
        const pot = new THREE.Mesh(new THREE.CylinderGeometry(150, 110, 260, 20), this.material(COLORS.pot));
        pot.position.set(s.left + 380, top + 130, z);
        this.scene.add(pot);
        const leaf = this.material(COLORS.leaf);
        for (let i = 0; i < 9; i++) {
            const blob = new THREE.Mesh(new THREE.SphereGeometry(1, 12, 8), leaf);
            const a = (i / 9) * Math.PI * 2;
            blob.scale.set(70, 190, 40);
            blob.position.set(s.left + 380 + Math.cos(a) * 90, top + 380 + this.rand() * 120, z + Math.sin(a) * 90);
            blob.rotation.set(Math.sin(a) * 0.6, a, Math.cos(a) * 0.6);
            this.scene.add(blob);
        }

        // small trophy on the second shelf
        const gold = new THREE.MeshPhongMaterial({ color: COLORS.gold, specular: 0x886622, shininess: 80 });
        const y = this.shelfY(1);
        const base = new THREE.Mesh(new THREE.BoxGeometry(200, 70, 160), this.material('#2a2a2e'));
        base.position.set(s.left + 1960, y + 35, z);
        this.scene.add(base);
        const stem = new THREE.Mesh(new THREE.CylinderGeometry(20, 30, 160, 12), gold);
        stem.position.set(s.left + 1960, y + 150, z);
        this.scene.add(stem);
        const cup = new THREE.Mesh(new THREE.CylinderGeometry(110, 40, 200, 20, 1, true), gold);
        cup.position.set(s.left + 1960, y + 330, z);
        this.scene.add(cup);

        // a framed photo on the fourth shelf, leaning back
        const frame = new THREE.Mesh(new THREE.BoxGeometry(320, 400, 30), this.material('#1d1d22'));
        frame.position.set(s.left + 660, this.shelfY(3) + 200, z - 40);
        frame.rotation.x = -0.12;
        this.scene.add(frame);
        const photo = new THREE.Mesh(new THREE.PlaneGeometry(260, 340), new THREE.MeshPhongMaterial({ color: '#c9a98a' }));
        photo.position.set(0, 0, 16);
        frame.add(photo);
    }

    /** A spine: two thin gold bands near the top, one near the bottom. */
    createSpineTexture() {
        const canvas = document.createElement('canvas');
        canvas.width = 16;
        canvas.height = 128;
        const ctx = canvas.getContext('2d') as CanvasRenderingContext2D;
        ctx.fillStyle = '#ffffff';
        ctx.fillRect(0, 0, 16, 128);
        ctx.fillStyle = 'rgba(0,0,0,0.25)';
        ctx.fillRect(0, 0, 2, 128);
        ctx.fillRect(14, 0, 2, 128);
        ctx.fillStyle = '#e8cf8a';
        [14, 22, 108].forEach((y) => ctx.fillRect(2, y, 12, 3));
        const texture = new THREE.CanvasTexture(canvas);
        texture.encoding = THREE.sRGBEncoding;
        return texture;
    }
}
