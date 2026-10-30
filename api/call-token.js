// Vercel function: a LiveKit token for one desk-phone call. Each call gets
// a fresh room, and the token dispatches the "samarjeet-phone" agent
// (agent/agent.py, hosted on LiveKit Cloud) into it when the room opens.
// The persona and the three-minute cap live in the agent.
//
// Env: LIVEKIT_URL, LIVEKIT_API_KEY, LIVEKIT_API_SECRET

const { AccessToken } = require('livekit-server-sdk');
const { RoomConfiguration, RoomAgentDispatch } = require('@livekit/protocol');
const crypto = require('crypto');

const AGENT_NAME = 'samarjeet-phone';
const CALL_SECONDS = 180;
const PER_IP_PER_HOUR = 6;
const ALLOWED_ORIGINS = [
    'https://samarjeet-portfolio-3d.vercel.app',
    'http://localhost:8080',
    'http://localhost:8099',
];

// Best effort per instance; enough to stop one visitor hammering the button
const hits = new Map();

module.exports = async (req, res) => {
    const origin = req.headers.origin || '';
    if (ALLOWED_ORIGINS.includes(origin)) res.setHeader('Access-Control-Allow-Origin', origin);
    if (req.method === 'OPTIONS') return res.status(204).end();
    if (req.method !== 'POST') return res.status(405).json({ error: 'POST only' });
    if (!ALLOWED_ORIGINS.includes(origin)) return res.status(403).json({ error: 'origin not allowed' });

    const { LIVEKIT_URL, LIVEKIT_API_KEY, LIVEKIT_API_SECRET } = process.env;
    if (!LIVEKIT_URL || !LIVEKIT_API_KEY || !LIVEKIT_API_SECRET)
        return res.status(503).json({ error: 'line not connected' });

    const ip = (req.headers['x-forwarded-for'] || '').split(',')[0].trim() || 'unknown';
    const now = Date.now();
    const recent = (hits.get(ip) || []).filter((t) => now - t < 3600e3);
    if (recent.length >= PER_IP_PER_HOUR) return res.status(429).json({ error: 'busy, try later' });
    hits.set(ip, [...recent, now]);

    const id = crypto.randomBytes(6).toString('hex');
    const at = new AccessToken(LIVEKIT_API_KEY, LIVEKIT_API_SECRET, {
        identity: `caller-${id}`,
        name: 'Caller',
        ttl: '5m',
    });
    at.addGrant({
        roomJoin: true,
        room: `phone-${id}`,
        canPublish: true,
        canSubscribe: true,
        canPublishData: true,
    });
    at.roomConfig = new RoomConfiguration({
        agents: [new RoomAgentDispatch({ agentName: AGENT_NAME })],
        emptyTimeout: 30,
        departureTimeout: 5,
    });

    return res.status(200).json({ url: LIVEKIT_URL, token: await at.toJwt(), seconds: CALL_SECONDS });
};
