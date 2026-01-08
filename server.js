import express from "express";
import http from "http";
import { WebSocketServer } from "ws";
import crypto from "crypto";

const app = express();
app.use(express.static("public"));

const server = http.createServer(app);
const wss = new WebSocketServer({ server });

// ------------------------- In-memory demo DB -------------------------
const db = {
  users: new Map(), // username -> { username, friends:Set<string> }
  groups: new Map(), // groupId -> { id, name, owner, members:Set<string>, alarmCodes: Map<codeId, codeObj> }
};

function uid(prefix = "") {
  return prefix + crypto.randomBytes(8).toString("hex");
}

function ensureUser(username) {
  if (!db.users.has(username)) {
    db.users.set(username, { username, friends: new Set() });
  }
  return db.users.get(username);
}

function safeGroup(group) {
  return {
    id: group.id,
    name: group.name,
    owner: group.owner,
    members: Array.from(group.members),
    alarmCodes: Array.from(group.alarmCodes.values()),
  };
}

// Online sockets by username
const online = new Map(); // username -> ws

function send(ws, data) {
  if (ws && ws.readyState === ws.OPEN) ws.send(JSON.stringify(data));
}

function broadcastToUsers(usernames, data) {
  for (const u of usernames) {
    const sock = online.get(u);
    if (sock) send(sock, data);
  }
}

// ------------------------- WebSocket Protocol -------------------------
wss.on("connection", (ws) => {
  ws.id = uid("sock_");
  ws.username = null;

  ws.on("message", (raw) => {
    let msg;
    try {
      msg = JSON.parse(raw.toString());
    } catch {
      return;
    }

    // ---------- LOGIN ----------
    if (msg.type === "login") {
      const username = String(msg.username || "").trim().toLowerCase();
      if (!username || username.length < 3) {
        return send(ws, { type: "error", message: "Username must be at least 3 characters." });
      }

      ws.username = username;
      ensureUser(username);
      online.set(username, ws);

      const user = db.users.get(username);

      // groups that contain user
      const groups = [];
      for (const g of db.groups.values()) {
        if (g.members.has(username)) groups.push(safeGroup(g));
      }

      return send(ws, {
        type: "state",
        me: username,
        friends: Array.from(user.friends),
        groups,
      });
    }

    if (!ws.username) {
      return send(ws, { type: "error", message: "You must login first." });
    }

    const me = ws.username;

    // ---------- FRIENDS ----------
    if (msg.type === "add_friend") {
      const friend = String(msg.friend || "").trim().toLowerCase();
      if (!friend || friend === me) return;

      ensureUser(me);
      ensureUser(friend);

      db.users.get(me).friends.add(friend);
      db.users.get(friend).friends.add(me);

      broadcastToUsers([me, friend], { type: "friends_updated", userA: me, userB: friend });
      return;
    }

    // ---------- GROUPS ----------
    if (msg.type === "create_group") {
      const name = String(msg.name || "").trim();
      if (!name) return;

      const groupId = uid("grp_");
      const group = {
        id: groupId,
        name,
        owner: me,
        members: new Set([me]),
        alarmCodes: new Map(),
      };

      // Default alarm codes
      const defaults = [
        { title: "SOS", colorHex: "#ff2d2d", soundKey: "sos", mode: "CALL_LIKE", messageText: "I need help now." },
        { title: "Pick Me Up", colorHex: "#ffb020", soundKey: "ping", mode: "MESSAGE", messageText: "Can you pick me up?" },
        { title: "Check In", colorHex: "#2dd4ff", soundKey: "soft", mode: "NOTIFICATION", messageText: "Please check in with me." },
      ];

      for (const c of defaults) {
        const codeId = uid("code_");
        group.alarmCodes.set(codeId, { id: codeId, ...c, createdBy: me, createdAt: Date.now() });
      }

      db.groups.set(groupId, group);

      send(ws, { type: "group_created", group: safeGroup(group) });
      return;
    }

    if (msg.type === "add_member") {
      const groupId = String(msg.groupId || "");
      const member = String(msg.member || "").trim().toLowerCase();
      const g = db.groups.get(groupId);
      if (!g) return;

      if (!g.members.has(me)) return send(ws, { type: "error", message: "Not a member of this group." });

      ensureUser(member);
      g.members.add(member);

      broadcastToUsers(Array.from(g.members), { type: "group_updated", group: safeGroup(g) });
      return;
    }

    if (msg.type === "create_alarm_code") {
      const groupId = String(msg.groupId || "");
      const g = db.groups.get(groupId);
      if (!g) return;
      if (!g.members.has(me)) return;

      const title = String(msg.title || "").trim() || "Alarm";
      const colorHex = String(msg.colorHex || "#ff2d2d");
      const soundKey = String(msg.soundKey || "sos");
      const mode = String(msg.mode || "NOTIFICATION"); // NOTIFICATION | MESSAGE | CALL_LIKE
      const messageText = String(msg.messageText || "").trim();

      const codeId = uid("code_");
      g.alarmCodes.set(codeId, {
        id: codeId,
        title,
        colorHex,
        soundKey,
        mode,
        messageText,
        createdBy: me,
        createdAt: Date.now(),
      });

      broadcastToUsers(Array.from(g.members), { type: "group_updated", group: safeGroup(g) });
      return;
    }

    // ---------- ALARMS ----------
    if (msg.type === "trigger_alarm") {
      const groupId = String(msg.groupId || "");
      const codeId = String(msg.codeId || "");
      const g = db.groups.get(groupId);
      if (!g || !g.members.has(me)) return;

      const code = g.alarmCodes.get(codeId);
      if (!code) return;

      const alarm = {
        id: uid("alarm_"),
        groupId,
        codeId,
        codeTitle: code.title,
        colorHex: code.colorHex,
        soundKey: code.soundKey,
        mode: code.mode,
        messageText: (msg.messageOverride || "").trim() || code.messageText || "",
        triggeredBy: me,
        triggeredAt: Date.now(),
      };

      broadcastToUsers(Array.from(g.members), { type: "alarm", alarm });
      return;
    }

    // ---------- WebRTC SIGNALING ----------
    // { type:"webrtc", groupId, to, payload:{ kind:"offer|answer|ice", ... } }
    if (msg.type === "webrtc") {
      const to = String(msg.to || "");
      const target = online.get(to);
      if (!target) return;

      send(target, {
        type: "webrtc",
        from: me,
        groupId: msg.groupId,
        payload: msg.payload,
      });
      return;
    }

    // Presence: who is online from this group
    if (msg.type === "call_presence") {
      const groupId = String(msg.groupId || "");
      const g = db.groups.get(groupId);
      if (!g || !g.members.has(me)) return;

      const onlineMembers = Array.from(g.members).filter((u) => online.has(u));
      send(ws, { type: "call_presence", groupId, onlineMembers });
      return;
    }
  });

  ws.on("close", () => {
    if (ws.username) online.delete(ws.username);
  });
});

// Use platform port (Render/Railway) or fallback
const PORT = process.env.PORT || 3000;
server.listen(PORT, () => {
  console.log(`✅ SOS Meet Web running on http://localhost:${PORT}`);
});
