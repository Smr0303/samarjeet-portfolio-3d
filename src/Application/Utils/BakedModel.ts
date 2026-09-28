import * as THREE from 'three';
import { NIGHT } from '../World/Lighting';

export default class BakedModel {
    model: LoadedModel;
    texture: LoadedTexture;
    material: THREE.MeshBasicMaterial | THREE.MeshPhongMaterial;

    /**
     * @param lit  shade with a per-pixel lit material so scene lights affect
     *             the baked texture (night room). Phong with no specular is
     *             used rather than Lambert because Lambert lights per vertex,
     *             which cannot show a pool of light on a large desk quad. The
     *             GLBs ship without normals, so they are computed here.
     *             Defaults to the NIGHT flag.
     */
    constructor(
        model: LoadedModel,
        texture: LoadedTexture,
        scale?: number,
        lit: boolean = NIGHT
    ) {
        this.model = model;
        this.texture = texture;

        this.texture.flipY = false;
        this.texture.encoding = THREE.sRGBEncoding;

        this.material = lit
            ? new THREE.MeshPhongMaterial({
                  map: this.texture,
                  specular: 0x000000,
                  shininess: 0,
              })
            : new THREE.MeshBasicMaterial({ map: this.texture });

        this.model.scene.traverse((child) => {
            if (child instanceof THREE.Mesh) {
                if (scale) child.scale.set(scale, scale, scale);
                if (lit && !child.geometry.attributes.normal) {
                    child.geometry.computeVertexNormals();
                }
                child.material.map = this.texture;
                child.material = this.material;
            }
        });

        return this;
    }

    getModel(): THREE.Group {
        return this.model.scene;
    }
}
