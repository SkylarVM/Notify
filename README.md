# Notify

A desktop web prototype that lets you:
- Add friends
- Create groups and add members
- Create "Alarm Codes" (color + sound + mode)
- Trigger alarms to all group members in real time
- Join Meet-like group calls (WebRTC) inside group rooms

## Tech
- Node.js + Express (static hosting)
- WebSocket (ws) for realtime events and WebRTC signaling
- WebRTC (mesh) for small group video calls

> Note: Mesh calls are best for small groups (2–6). For larger groups, switch to an SFU (mediasoup / LiveKit).

## Run locally
1) Install dependencies
```bash
npm install
