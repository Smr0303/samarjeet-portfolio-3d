import { Room, RoomEvent, Track, RemoteTrack, DisconnectReason } from 'livekit-client';

/**
 * One phone call to the LiveKit voice agent behind /api/call-token.
 *
 * The token puts the caller in a fresh room and dispatches the agent into
 * it; the caller publishes their mic and plays the agent's audio track.
 * Captions arrive on the lk.transcription text stream. An Indian ringback
 * tone plays until the agent's voice comes through (its worker may need a
 * moment to wake). The agent closes the room at the time limit.
 */
const ANSWER_TIMEOUT = 30000; // give up if the agent hasn't answered by then

export type CallState = 'dialing' | 'connected' | 'ended';
export type CallEvents = {
    onState: (state: CallState) => void;
    onCaption: (who: 'agent' | 'caller', text: string) => void;
    onSpeaking: (agentSpeaking: boolean) => void;
    onEnd: (message: string) => void;
};

export default class LiveCall {
    events: CallEvents;
    room?: Room;
    audio?: HTMLMediaElement;
    toneCtx?: AudioContext;
    ring?: { stop: () => void };
    muted: boolean;
    ended: boolean;
    timers: number[];

    constructor(events: CallEvents) {
        this.events = events;
        this.muted = false;
        this.ended = false;
        this.timers = [];
    }

    async start() {
        this.events.onState('dialing');
        // inside the click, so the browser lets us make sound
        this.toneCtx = new AudioContext();
        this.ring = this.ringback(this.toneCtx);

        let data: { url: string; token: string; seconds: number };
        try {
            const r = await fetch('/api/call-token', { method: 'POST' });
            data = await r.json().catch(() => ({}));
            if (!r.ok) {
                const why =
                    r.status === 429
                        ? 'Line busy. Try again in a bit.'
                        : r.status === 503
                        ? 'The line isn’t connected yet.'
                        : 'Couldn’t get through. Try again?';
                return this.end(why);
            }
        } catch (e) {
            return this.end('Couldn’t get through. Try again?');
        }
        if (this.ended) return;

        const room = new Room({
            audioCaptureDefaults: { echoCancellation: true, noiseSuppression: true, autoGainControl: true },
        });
        this.room = room;

        room.on(RoomEvent.TrackSubscribed, (track: RemoteTrack) => {
            if (track.kind !== Track.Kind.Audio) return;
            this.audio = track.attach();
            this.audio.style.display = 'none';
            document.body.append(this.audio);
            this.ring?.stop();
            this.events.onState('connected');
        });
        room.on(RoomEvent.ActiveSpeakersChanged, (speakers) => {
            this.events.onSpeaking(speakers.some((p) => p !== room.localParticipant));
        });
        room.on(RoomEvent.Disconnected, (reason?: DisconnectReason) => {
            this.end(reason === DisconnectReason.ROOM_DELETED ? 'Time’s up. Thanks for calling!' : 'Call ended.');
        });
        room.registerTextStreamHandler('lk.transcription', async (reader, info) => {
            if (!reader.info.attributes?.['lk.transcribed_track_id']) return;
            const text = await reader.readAll();
            if (!text.trim() || this.ended) return;
            this.events.onCaption(info.identity === room.localParticipant.identity ? 'caller' : 'agent', text);
        });

        try {
            await room.connect(data.url, data.token);
        } catch (e) {
            return this.end('Couldn’t get through. Try again?');
        }
        try {
            await room.localParticipant.setMicrophoneEnabled(true);
        } catch (e) {
            return this.end('Mic is blocked. Allow it to talk.');
        }

        this.timers.push(
            window.setTimeout(() => {
                if (!this.audio) this.end('No answer. Try again in a minute.');
            }, ANSWER_TIMEOUT),
            // backstop in case the agent's own goodbye never lands
            window.setTimeout(() => this.end('Time’s up. Thanks for calling!'), (data.seconds + 15) * 1000)
        );
    }

    setMuted(muted: boolean) {
        this.muted = muted;
        this.room?.localParticipant.setMicrophoneEnabled(!muted);
    }

    /** Indian ringback: 400 Hz with a 25 Hz flutter, 0.4 on 0.2 off 0.4 on 2 off. */
    ringback(ctx: AudioContext) {
        const tone = ctx.createOscillator();
        tone.frequency.value = 400;
        const flutter = ctx.createOscillator();
        flutter.frequency.value = 25;
        const depth = ctx.createGain();
        depth.gain.value = 0.35;
        const am = ctx.createGain();
        am.gain.value = 0.65;
        flutter.connect(depth).connect(am.gain);
        const cadence = ctx.createGain();
        cadence.gain.value = 0;
        const level = ctx.createGain();
        level.gain.value = 0.08;
        tone.connect(am).connect(cadence).connect(level).connect(ctx.destination);
        const t0 = ctx.currentTime + 0.3;
        for (let k = 0; k < 15; k++) {
            const t = t0 + k * 3;
            cadence.gain.setValueAtTime(1, t);
            cadence.gain.setValueAtTime(0, t + 0.4);
            cadence.gain.setValueAtTime(1, t + 0.6);
            cadence.gain.setValueAtTime(0, t + 1.0);
        }
        tone.start();
        flutter.start();
        let stopped = false;
        return {
            stop: () => {
                if (stopped) return;
                stopped = true;
                tone.stop();
                flutter.stop();
            },
        };
    }

    hangUp() {
        this.end('Call ended.');
    }

    end(message: string) {
        if (this.ended) return;
        this.ended = true;
        this.timers.forEach((t) => window.clearTimeout(t));
        this.ring?.stop();
        this.toneCtx?.close();
        this.room?.disconnect();
        this.audio?.remove();
        this.events.onSpeaking(false);
        this.events.onState('ended');
        this.events.onEnd(message);
    }
}
