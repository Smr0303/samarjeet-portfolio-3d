import * as THREE from 'three';
import Application from '../Application';
import Time from '../Utils/Time';
import { ROOM } from './Room';

/**
 * A neon sign high on the back wall in sunrise colours: "Samarjeet" in
 * warm amber script with "software engineer" in soft coral under it. The tubes sit on clear standoffs;
 * a soft halo is painted on the wall behind them and two coloured point
 * lights spill the glow into the room. It flickers on when the room loads
 * and buzzes now and then.
 */
const CENTER = new THREE.Vector3(-300, 4050, ROOM.back + 40);
const SIZE = { w: 5200, h: 1500 };
const FONT = 'Pacifico';
const COLORS = { name: '#ffa94d', nameCore: '#fff0d6', sub: '#ff8a72', subCore: '#ffe4da' };

export default class NeonSign {
    application: Application;
    scene: THREE.Scene;
    time: Time;

    tubes: THREE.MeshBasicMaterial;
    halo: THREE.MeshBasicMaterial;
    lights: THREE.PointLight[];
    level: number;
    nextBuzz: number;

    constructor() {
        this.application = new Application();
        this.scene = this.application.scene;
        this.time = this.application.time;
        this.level = 0;
        this.nextBuzz = 25;

        this.setSign();
        // the script font comes from Google Fonts; redraw once it's in
        document.fonts?.load(`120px ${FONT}`).then(() => this.draw());
    }

    setSign() {
        this.tubes = new THREE.MeshBasicMaterial({ transparent: true, depthWrite: false });
        this.halo = new THREE.MeshBasicMaterial({
            transparent: true,
            depthWrite: false,
            blending: THREE.AdditiveBlending,
        });
        // same size as the tubes so the halo lines up with the letters
        const halo = new THREE.Mesh(new THREE.PlaneGeometry(SIZE.w, SIZE.h), this.halo);
        halo.position.copy(CENTER).add(new THREE.Vector3(0, 0, -20));
        const tubes = new THREE.Mesh(new THREE.PlaneGeometry(SIZE.w, SIZE.h), this.tubes);
        tubes.position.copy(CENTER);
        this.scene.add(halo, tubes);

        // a few clear standoffs holding the tubes off the wall
        const standoff = new THREE.MeshPhongMaterial({ color: '#cfd6e0', transparent: true, opacity: 0.6, shininess: 90 });
        [-0.38, -0.12, 0.14, 0.38].forEach((u) => {
            const s = new THREE.Mesh(new THREE.CylinderGeometry(14, 14, 40, 8), standoff);
            s.rotation.x = Math.PI / 2;
            s.position.copy(CENTER).add(new THREE.Vector3(u * SIZE.w, 120, -20));
            this.scene.add(s);
        });

        const name = new THREE.PointLight(COLORS.name, 0, 7500, 2);
        name.position.copy(CENTER).add(new THREE.Vector3(0, 150, 900));
        const sub = new THREE.PointLight(COLORS.sub, 0, 5000, 2);
        sub.position.copy(CENTER).add(new THREE.Vector3(0, -450, 700));
        this.lights = [name, sub];
        this.scene.add(name, sub);

        this.draw();
    }

    /** Paint the tubes (sharp, bright core) and the halo (wide blur). */
    draw() {
        const w = 2048;
        const h = Math.round((w * SIZE.h) / SIZE.w);
        const paint = (blur: number, core: boolean) => {
            const canvas = document.createElement('canvas');
            canvas.width = w;
            canvas.height = h;
            const ctx = canvas.getContext('2d') as CanvasRenderingContext2D;
            ctx.textAlign = 'center';
            ctx.textBaseline = 'middle';
            const line = (text: string, font: string, y: number, color: string, coreColor: string, width: number) => {
                ctx.font = font;
                ctx.lineJoin = 'round';
                ctx.shadowColor = color;
                ctx.shadowBlur = blur;
                ctx.strokeStyle = color;
                ctx.lineWidth = width;
                ctx.strokeText(text, w / 2, y);
                if (core) {
                    ctx.shadowBlur = blur / 3;
                    ctx.strokeStyle = coreColor;
                    ctx.lineWidth = width * 0.35;
                    ctx.strokeText(text, w / 2, y);
                }
            };
            line('Samarjeet', `300px ${FONT}, "Brush Script MT", cursive`, h * 0.4, COLORS.name, COLORS.nameCore, 16);
            (ctx as any).letterSpacing = '18px'; // newer canvas API; ignored where unsupported
            line('SOFTWARE ENGINEER', `bold 84px "Courier New", monospace`, h * 0.84, COLORS.sub, COLORS.subCore, 6);
            const texture = new THREE.CanvasTexture(canvas);
            texture.encoding = THREE.sRGBEncoding;
            return texture;
        };
        this.tubes.map?.dispose();
        this.halo.map?.dispose();
        this.tubes.map = paint(28, true);
        this.halo.map = paint(90, false);
        this.tubes.needsUpdate = true;
        this.halo.needsUpdate = true;
    }

    update() {
        const t = this.time.elapsed / 1000;

        // switch-on: a few stutters in the first two seconds, then steady,
        // and a short buzz now and then
        let on = 1;
        if (t < 2.2) on = t < 0.4 ? 0 : Math.sin(t * 37) > 0.2 || t > 1.6 ? 1 : 0.15;
        if (t > this.nextBuzz) {
            if (t < this.nextBuzz + 0.35) on = Math.sin(t * 90) > 0 ? 1 : 0.4;
            else this.nextBuzz = t + 18 + Math.random() * 20;
        }
        this.level += (on - this.level) * 0.5;

        this.tubes.opacity = 0.25 + 0.75 * this.level;
        this.halo.opacity = 0.65 * this.level;
        this.lights[0].intensity = 1.1 * this.level;
        this.lights[1].intensity = 0.5 * this.level;
    }
}
