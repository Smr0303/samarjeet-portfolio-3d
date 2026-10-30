import Application from '../Application';
import Resources from '../Utils/Resources';
import Workstation from './Workstation';
import MonitorScreen from './MonitorScreen';
import Environment from './Environment';
import Decor from './Decor';
import CoffeeSteam from './CoffeeSteam';
import Cursor from './Cursor';
import Hitboxes from './Hitboxes';
import Cat from './Cat';
import Room from './Room';
import DawnWindow from './DawnWindow';
import Achievements from './Achievements';
import Phone from './Phone';
import Guitar from './Guitar';
import Bookshelf from './Bookshelf';
import NeonSign from './NeonSign';
import AudioManager from '../Audio/AudioManager';
import Lighting, { NIGHT } from './Lighting';
export default class World {
    application: Application;
    scene: THREE.Scene;
    resources: Resources;

    // Objects in the scene
    environment: Environment;
    decor: Decor;
    workstation: Workstation;
    monitorScreen: MonitorScreen;
    coffeeSteam: CoffeeSteam;
    cat: Cat;
    room: Room;
    dawnWindow: DawnWindow;
    achievements: Achievements;
    phone: Phone;
    guitar: Guitar;
    bookshelf: Bookshelf;
    neonSign: NeonSign;
    lighting: Lighting;
    cursor: Cursor;
    audioManager: AudioManager;

    constructor() {
        this.application = new Application();
        this.scene = this.application.scene;
        this.resources = this.application.resources;
        // Wait for resources
        this.resources.on('ready', () => {
            // Setup
            this.environment = new Environment();
            this.decor = new Decor();
            this.workstation = new Workstation();
            this.monitorScreen = new MonitorScreen();
            this.coffeeSteam = new CoffeeSteam();
            this.cat = new Cat();
            this.room = new Room();
            this.dawnWindow = new DawnWindow();
            this.achievements = new Achievements();
            this.phone = new Phone();
            this.guitar = new Guitar();
            this.bookshelf = new Bookshelf();
            this.neonSign = new NeonSign();
            if (NIGHT) this.lighting = new Lighting();
            this.audioManager = new AudioManager();
            // const hb = new Hitboxes();
            // this.cursor = new Cursor();
        });
    }

    update() {
        if (this.lighting) this.lighting.update();
        if (this.monitorScreen) this.monitorScreen.update();
        if (this.environment) this.environment.update();
        if (this.coffeeSteam) this.coffeeSteam.update();
        if (this.cat) this.cat.update();
        if (this.workstation) this.workstation.update();
        if (this.dawnWindow) this.dawnWindow.update();
        if (this.achievements) this.achievements.update();
        if (this.phone) this.phone.update();
        if (this.guitar) this.guitar.update();
        if (this.neonSign) this.neonSign.update();
        if (this.audioManager) this.audioManager.update();
    }
}
