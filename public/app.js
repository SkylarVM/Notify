// Build correct ws:// or wss:// depending on deployment
const WS_PROTO = location.protocol === "https:" ? "wss" : "ws";
const ws = new WebSocket(`${WS_PROTO}://${location.host}`);

// ------------------------- State -------------------------
let ME = null;
let friends = [];
let groups = [];
let activeGroup = null;

// ------------------------- DOM helpers -------------------------
const el = (id) => document.getElementById(id);

const loginView = el("loginView");
const appView = el("appView");

const usernameInput = el("usernameInput");
const loginBtn = el("loginBtn");

const meLabel = el("meLabel");
const enableAlertsBtn = el("enableAlertsBtn");

const friendInput = el("friendInput");
const addFriendBtn = el("addFriendBtn");
const friendsList = el("friendsList");

const groupNameInput = el("groupNameInput");
const createGroupBtn = el("createGroupBtn");
const groupsList = el("groupsList");

const groupPanel = el("groupPanel");
const groupTitle = el("groupTitle");
const memberSelect = el("memberSelect");
const addMemberBtn = el("addMemberBtn");
const membersList = el("membersList");

const codesList = el("codesList");
const codeTitleInput = el("codeTitleInput");
const codeModeInput = el("codeModeInput");
const codeColorInput = el("codeColorInput");
const codeSoundInput = el("codeSoundInput");
const codeMessageInput = el("codeMessageInput");
const createCodeBtn = el("createCodeBtn");

const joinCallBtn = el("joinCallBtn");
const leaveCallBtn = el("leaveCallBtn");
const callTitle = el("callTitle");
const callSubtitle = el("callSubtitle");

const toggleMicBtn = el("toggleMicBtn");
const toggleCamBtn = el("toggleCamBtn");
const shareBtn = el("shareBtn");
const hangupBtn = el("hangupBtn");

const videoGrid = el("videoGrid");

// Alarm overlay
const alarmOverlay = el("alarmOverlay");
const alarmTitle = el("alarmTitle");
const alarmMeta = el("alarmMeta");
const alarmMsg = el("alarmMsg");
const alarmOpenBtn = el("alarmOpenBtn");
const alarmDismissBtn = el("alarmDismissBtn");

// ------------------------- WS send -------------------------
function send(msg) {
  ws.send(JSON.stringify(msg));
}

// ------------------------- Audio (WebAudio) -------------------------
// Browsers require a user gesture before sound.
// Enable using the "Enable Alerts (sound)" button.
let audioEnabled = false;
let audioCtx = null;

function ensureAudio() {
  if (!audioCtx) audioCtx = new (window.AudioContext || window.webkitAudioContext)();
}

function playTonePattern(soundKey) {
  if (!audioEnabled) return;

  ensureAudio();
  const patterns = {
    sos: [880, 880, 880, 660, 660, 660, 880, 880, 880],
    ping: [880, 1320, 880],
    soft: [440, 550, 440],
  };
  const seq = patterns[soundKey] || patterns.sos;

  let t = audioCtx.currentTime;
  for (const f of seq) {
    const o = audioCtx.createOscillator();
    const g = audioCtx.createGain();
    o.frequency.value = f;
    o.type = "sine";
    g.gain.value = 0.0001;

    o.connect(g);
    g.connect(audioCtx.destination);

    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(0.25, t + 0.03);
    g.gain.exponentialRampToValueAtTime(0.0001, t + 0.20);

    o.start(t);
    o.stop(t + 0.22);
    t += 0.24;
  }
}

// ------------------------- UI rendering -------------------------
function renderFriends() {
  friendsList.innerHTML = "";
  for (const f of friends) {
    const div = document.createElement("div");
    div.className = "item";
    div.textContent = f;
    friendsList.appendChild(div);
  }

  memberSelect.innerHTML = "";
  for (const f of friends) {
    const opt = document.createElement("option");
    opt.value = f;
    opt.textContent = f;
    memberSelect.appendChild(opt);
  }
}

function renderGroups() {
  groupsList.innerHTML = "";
  for (const g of groups) {
    const div = document.createElement("div");
    div.className = "item" + (activeGroup?.id === g.id ? " active" : "");
    div.textContent = g.name;
    div.onclick = () => selectGroup(g.id);
    groupsList.appendChild(div);
  }
}

function renderActiveGroup() {
  if (!activeGroup) {
    groupPanel.classList.add("hidden");
    return;
  }

  groupPanel.classList.remove("hidden");
  groupTitle.textContent = activeGroup.name;

  membersList.innerHTML = "";
  for (const m of activeGroup.members) {
    const chip = document.createElement("div");
    chip.className = "chip";
    chip.textContent = m;
    membersList.appendChild(chip);
  }

  codesList.innerHTML = "";
  for (const c of activeGroup.alarmCodes) {
    const row = document.createElement("div");
    row.className = "code";

    const left = document.createElement("div");
    left.className = "codeLeft";

    const title = document.createElement("div");
    title.textContent = c.title;

    const badge = document.createElement("div");
    badge.className = "badge";

    const dot = document.createElement("span");
    dot.className = "dot";
    dot.style.background = c.colorHex || "#ff2d2d";

    const meta = document.createElement("span");
    meta.textContent = `${c.mode} • sound:${c.soundKey}`;

    badge.appendChild(dot);
    badge.appendChild(meta);

    left.appendChild(title);
    left.appendChild(badge);

    const btn = document.createElement("button");
    btn.className = "danger";
    btn.textContent = "Trigger";
    btn.onclick = () => {
      const override = prompt("Optional message override (blank = default):", "");
      send({
        type: "trigger_alarm",
        groupId: activeGroup.id,
        codeId: c.id,
        messageOverride: override || "",
      });
    };

    row.appendChild(left);
    row.appendChild(btn);
    codesList.appendChild(row);
  }
}

function selectGroup(groupId) {
  activeGroup = groups.find((g) => g.id === groupId) || null;
  renderGroups();
  renderActiveGroup();

  if (activeGroup) {
    callTitle.textContent = `Group: ${activeGroup.name}`;
    callSubtitle.textContent = `Room: ${activeGroup.id}`;
  } else {
    callTitle.textContent = "Not in a call";
    callSubtitle.textContent = "Select a group and join call.";
  }
}

// ------------------------- Login + actions -------------------------
loginBtn.onclick = () => {
  const username = usernameInput.value.trim().toLowerCase();
  send({ type: "login", username });
};

enableAlertsBtn.onclick = async () => {
  try {
    ensureAudio();
    await audioCtx.resume();
    audioEnabled = true;
    enableAlertsBtn.textContent = "Alerts Enabled ✅";
    playTonePattern("ping");
  } catch {
    alert("Could not enable audio. Try again.");
  }
};

addFriendBtn.onclick = () => {
  const friend = friendInput.value.trim().toLowerCase();
  if (!friend) return;
  send({ type: "add_friend", friend });
  friendInput.value = "";
};

createGroupBtn.onclick = () => {
  const name = groupNameInput.value.trim();
  if (!name) return;
  send({ type: "create_group", name });
  groupNameInput.value = "";
};

addMemberBtn.onclick = () => {
  if (!activeGroup) return;
  const member = memberSelect.value;
  if (!member) return;
  send({ type: "add_member", groupId: activeGroup.id, member });
};

createCodeBtn.onclick = () => {
  if (!activeGroup) return;
  send({
    type: "create_alarm_code",
    groupId: activeGroup.id,
    title: codeTitleInput.value.trim(),
    mode: codeModeInput.value,
    colorHex: codeColorInput.value,
    soundKey: codeSoundInput.value,
    messageText: codeMessageInput.value.trim(),
  });
  codeTitleInput.value = "";
  codeMessageInput.value = "";
};

// ------------------------- WebRTC Meet-like (mesh) -------------------------
let localStream = null;
let inCall = false;
let peers = new Map(); // username -> RTCPeerConnection
let screenStream = null;

const RTC_CFG = {
  iceServers: [{ urls: "stun:stun.l.google.com:19302" }],
};

async function ensureLocalMedia() {
  if (localStream) return localStream;
  localStream = await navigator.mediaDevices.getUserMedia({ video: true, audio: true });
  addOrUpdateTile(ME, localStream, true);
  return localStream;
}

function addOrUpdateTile(username, stream, isSelf = false) {
  let tile = document.querySelector(`[data-user="${username}"]`);
  if (!tile) {
    tile = document.createElement("div");
    tile.className = "tile";
    tile.dataset.user = username;

    const video = document.createElement("video");
    video.autoplay = true;
    video.playsInline = true;
    if (isSelf) video.muted = true;

    const label = document.createElement("div");
    label.className = "label";
    label.textContent = isSelf ? `${username} (You)` : username;

    tile.appendChild(video);
    tile.appendChild(label);
    videoGrid.appendChild(tile);
  }

  const video = tile.querySelector("video");
  video.srcObject = stream;
}

function removeTile(username) {
  const tile = document.querySelector(`[data-user="${username}"]`);
  if (tile) tile.remove();
}

function setCallUI(active) {
  inCall = active;

  joinCallBtn.classList.toggle("hidden", active);
  leaveCallBtn.classList.toggle("hidden", !active);
  hangupBtn.classList.toggle("hidden", !active);

  toggleMicBtn.disabled = !active;
  toggleCamBtn.disabled = !active;
  shareBtn.disabled = !active;
}

async function createPeerConnection(otherUser) {
  const pc = new RTCPeerConnection(RTC_CFG);

  pc.onicecandidate = (e) => {
    if (e.candidate) {
      send({
        type: "webrtc",
        groupId: activeGroup.id,
        to: otherUser,
        payload: { kind: "ice", candidate: e.candidate },
      });
    }
  };

  pc.ontrack = (e) => {
    const [stream] = e.streams;
    addOrUpdateTile(otherUser, stream, false);
  };

  localStream.getTracks().forEach((t) => pc.addTrack(t, localStream));
  peers.set(otherUser, pc);

  return pc;
}

async function callJoin() {
  if (!activeGroup) return alert("Select a group first.");
  if (inCall) return;

  await ensureLocalMedia();
  setCallUI(true);

  send({ type: "call_presence", groupId: activeGroup.id });
}

async function connectToOnlineMembers(onlineMembers) {
  for (const u of onlineMembers) {
    if (u === ME) continue;
    if (peers.has(u)) continue;

    const pc = await createPeerConnection(u);
    const offer = await pc.createOffer();
    await pc.setLocalDescription(offer);

    send({
      type: "webrtc",
      groupId: activeGroup.id,
      to: u,
      payload: { kind: "offer", sdp: offer },
    });
  }
}

async function handleOffer(from, sdp) {
  if (!localStream) await ensureLocalMedia();

  let pc = peers.get(from);
  if (!pc) pc = await createPeerConnection(from);

  await pc.setRemoteDescription(new RTCSessionDescription(sdp));
  const answer = await pc.createAnswer();
  await pc.setLocalDescription(answer);

  send({
    type: "webrtc",
    groupId: activeGroup.id,
    to: from,
    payload: { kind: "answer", sdp: answer },
  });
}

async function handleAnswer(from, sdp) {
  const pc = peers.get(from);
  if (!pc) return;
  await pc.setRemoteDescription(new RTCSessionDescription(sdp));
}

async function handleIce(from, candidate) {
  const pc = peers.get(from);
  if (!pc) return;
  try {
    await pc.addIceCandidate(new RTCIceCandidate(candidate));
  } catch {}
}

async function callLeave() {
  setCallUI(false);

  for (const [u, pc] of peers.entries()) {
    pc.close();
    removeTile(u);
  }
  peers.clear();

  if (localStream) {
    localStream.getTracks().forEach((t) => t.stop());
    localStream = null;
  }
  if (screenStream) {
    screenStream.getTracks().forEach((t) => t.stop());
    screenStream = null;
  }

  videoGrid.innerHTML = "";
}

joinCallBtn.onclick = callJoin;
leaveCallBtn.onclick = callLeave;
hangupBtn.onclick = callLeave;

toggleMicBtn.onclick = () => {
  if (!localStream) return;
  const track = localStream.getAudioTracks()[0];
  if (!track) return;
  track.enabled = !track.enabled;
  toggleMicBtn.textContent = track.enabled ? "Mic" : "Mic (muted)";
};

toggleCamBtn.onclick = () => {
  if (!localStream) return;
  const track = localStream.getVideoTracks()[0];
  if (!track) return;
  track.enabled = !track.enabled;
  toggleCamBtn.textContent = track.enabled ? "Cam" : "Cam (off)";
};

shareBtn.onclick = async () => {
  if (!inCall) return;

  try {
    screenStream = await navigator.mediaDevices.getDisplayMedia({ video: true, audio: false });
    const screenTrack = screenStream.getVideoTracks()[0];

    for (const pc of peers.values()) {
      const sender = pc.getSenders().find((s) => s.track && s.track.kind === "video");
      if (sender) sender.replaceTrack(screenTrack);
    }

    const mixed = new MediaStream([screenTrack, ...localStream.getAudioTracks()]);
    addOrUpdateTile(ME, mixed, true);

    screenTrack.onended = () => {
      const camTrack = localStream.getVideoTracks()[0];
      for (const pc of peers.values()) {
        const sender = pc.getSenders().find((s) => s.track && s.track.kind === "video");
        if (sender) sender.replaceTrack(camTrack);
      }
      addOrUpdateTile(ME, localStream, true);
    };
  } catch {
    alert("Screen share cancelled.");
  }
};

// ------------------------- Alarm overlay -------------------------
function showAlarm(alarm) {
  alarmOverlay.classList.remove("hidden");

  const card = alarmOverlay.querySelector(".alarmCard");
  card.style.boxShadow = `0 18px 60px rgba(0,0,0,.55), 0 0 0 2px ${alarm.colorHex}66`;
  card.style.borderColor = `${alarm.colorHex}55`;

  alarmTitle.textContent = alarm.codeTitle;
  alarmMeta.textContent = `From: ${alarm.triggeredBy} • Group: ${alarm.groupId}`;
  alarmMsg.textContent = alarm.messageText || "";

  playTonePattern(alarm.soundKey);

  alarmOpenBtn.onclick = async () => {
    alarmOverlay.classList.add("hidden");
    if (alarm.mode === "CALL_LIKE") {
      const g = groups.find((x) => x.id === alarm.groupId);
      if (g) selectGroup(g.id);
      await callJoin();
    }
  };

  alarmDismissBtn.onclick = () => {
    alarmOverlay.classList.add("hidden");
  };
}

// ------------------------- WebSocket events -------------------------
ws.onmessage = async (event) => {
  const msg = JSON.parse(event.data);

  if (msg.type === "error") {
    alert(msg.message);
    return;
  }

  if (msg.type === "state") {
    ME = msg.me;
    friends = (msg.friends || []).slice().sort();
    groups = msg.groups || [];

    meLabel.textContent = `@${ME}`;
    loginView.classList.add("hidden");
    appView.classList.remove("hidden");

    renderFriends();
    renderGroups();
    renderActiveGroup();
    return;
  }

  if (msg.type === "friends_updated") {
    const { userA, userB } = msg;
    if (ME === userA && !friends.includes(userB)) friends.push(userB);
    if (ME === userB && !friends.includes(userA)) friends.push(userA);
    friends = Array.from(new Set(friends)).sort();
    renderFriends();
    return;
  }

  if (msg.type === "group_created") {
    groups.push(msg.group);
    renderGroups();
    selectGroup(msg.group.id);
    return;
  }

  if (msg.type === "group_updated") {
    groups = groups.map((g) => (g.id === msg.group.id ? msg.group : g));
    if (activeGroup?.id === msg.group.id) {
      activeGroup = msg.group;
      renderActiveGroup();
    }
    renderGroups();
    return;
  }

  if (msg.type === "alarm") {
    showAlarm(msg.alarm);
    return;
  }

  if (msg.type === "call_presence") {
    await connectToOnlineMembers(msg.onlineMembers || []);
    return;
  }

  if (msg.type === "webrtc") {
    const { from, payload } = msg;
    if (payload.kind === "offer") await handleOffer(from, payload.sdp);
    if (payload.kind === "answer") await handleAnswer(from, payload.sdp);
    if (payload.kind === "ice") await handleIce(from, payload.candidate);
    return;
  }
};

ws.onclose = () => {
  alert("Disconnected from server. Refresh the page.");
};

// UX shortcuts
usernameInput.addEventListener("keydown", (e) => { if (e.key === "Enter") loginBtn.click(); });
friendInput.addEventListener("keydown", (e) => { if (e.key === "Enter") addFriendBtn.click(); });
groupNameInput.addEventListener("keydown", (e) => { if (e.key === "Enter") createGroupBtn.click(); });
