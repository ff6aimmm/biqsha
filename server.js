const http = require("http");
const fs = require("fs");
const os = require("os");
const path = require("path");
const { WebSocketServer } = require("ws");

const PORT = Number(process.env.PORT) || 8787;
const INDEX = path.join(__dirname, "index.html");
const rooms = new Map();

function makeCode() {
  const alphabet = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
  let code = "";
  for (let i = 0; i < 4; i++) code += alphabet[Math.floor(Math.random() * alphabet.length)];
  return rooms.has(code) ? makeCode() : code;
}

function send(ws, obj) {
  if (ws && ws.readyState === 1) ws.send(JSON.stringify(obj));
}

function relay(room, from, data, binary) {
  for (const peer of [room.host, room.guest]) {
    if (peer && peer !== from && peer.readyState === 1) peer.send(data, { binary: !!binary });
  }
}

const server = http.createServer((req, res) => {
  const url = (req.url || "/").split("?")[0];
  if (url !== "/" && url !== "/index.html") {
    res.writeHead(404, { "Content-Type": "text/plain; charset=utf-8" });
    res.end("Not found");
    return;
  }
  res.writeHead(200, { "Content-Type": "text/html; charset=utf-8", "Cache-Control": "no-store" });
  fs.createReadStream(INDEX).pipe(res);
});

const wss = new WebSocketServer({ server });

wss.on("connection", (ws) => {
  ws.on("message", (data, isBinary) => {
    const room = rooms.get(ws.roomCode);
    if (isBinary) {
      if (room && ws === room.host) relay(room, ws, data, true);
      return;
    }
    let msg;
    try { msg = JSON.parse(data.toString()); } catch { return; }
    if (msg.t === "create") {
      const code = makeCode();
      const name = String(msg.name || "Player 1").slice(0, 16);
      rooms.set(code, { host: ws, guest: null, names: [name, ""] });
      ws.roomCode = code;
      ws.role = "host";
      send(ws, { t: "room", code, role: "host" });
      return;
    }
    if (msg.t === "join") {
      const code = String(msg.code || "").toUpperCase().replace(/[^A-Z0-9]/g, "").slice(0, 4);
      const found = rooms.get(code);
      if (!found || !found.host || found.host.readyState !== 1) {
        send(ws, { t: "err", text: "No open room with that code." });
        return;
      }
      if (found.guest && found.guest.readyState === 1) {
        send(ws, { t: "err", text: "That room already has two diggers." });
        return;
      }
      found.guest = ws;
      found.names[1] = String(msg.name || "Player 2").slice(0, 16);
      ws.roomCode = code;
      ws.role = "guest";
      send(ws, { t: "room", code, role: "guest", names: found.names });
      send(found.host, { t: "peer", names: found.names });
      return;
    }
    if (!room) return;
    relay(room, ws, JSON.stringify(msg), false);
  });

  ws.on("close", () => {
    const room = rooms.get(ws.roomCode);
    if (!room) return;
    const other = ws === room.host ? room.guest : room.host;
    if (other) send(other, { t: "bye" });
    if (ws === room.host) rooms.delete(ws.roomCode);
    else if (room.guest === ws) room.guest = null;
  });
});

server.listen(PORT, "0.0.0.0", () => {
  console.log("Biqsha is ready.");
  console.log("  This PC   http://localhost:" + PORT);
  for (const list of Object.values(os.networkInterfaces())) {
    for (const net of list || []) {
      if ((net.family === "IPv4" || net.family === 4) && !net.internal) console.log("  Same Wi-Fi  http://" + net.address + ":" + PORT);
    }
  }
});
