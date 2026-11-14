/* GoldSaucer room runner: public presence and visual gestures only.
 * Financial settlement remains in the per-player server functions. */
"use strict";

var PROTOCOL = "hc-rooms-v1";
var MAX_PLAYERS = 3;
var BET_VALUES = [1, 5, 10, 20, 50];
var WEAPON_VALUES = ["like", "flower", "rocket"];

function roomRecord(value) { return value !== null && typeof value === "object" && !Array.isArray(value); }
function roomWhole(value, min, max) { return Number.isSafeInteger(value) && value >= min && value <= max; }
function roomName(value) {
  return typeof value === "string" ? Array.from(value.replace(/[\u0000-\u001f\u007f-\u009f\u202a-\u202e\u2066-\u2069]/g, " ").trim()).slice(0, 24).join("") || "玩家" : "玩家";
}
function roomMember(room, id) { return room.state.members.find(function (p) { return p.id === id; }); }
function roomNow(room) { return room.state.createdAt + room.state.elapsedMs; }
function roomFailure(room, player, code, message) { room.send(player, "roomError", {code: code, message: message}); }
function roomSnapshot(room, player) {
  var s = room.state;
  return {protocol: PROTOCOL, roomId: room.id, revision: s.revision,
    serverTime: roomNow(room), createdAt: s.createdAt, elapsedMs: s.elapsedMs, you: player.id,
    players: s.members.map(function (p) { return {id: p.id, userId: p.userId, name: p.name,
      seat: p.seat, weapon: p.weapon, bet: p.bet, x: p.x, y: p.y}; })};
}
function roomPublish(room) {
  var s = room.state;
  room.players.forEach(function (p) { if (roomMember(room, p.id)) room.send(p, "state", roomSnapshot(room, p)); });
  s.dirty = false; s.lastPublished = s.elapsedMs;
}
function roomGesture(data) {
  return roomRecord(data) && Object.keys(data).every(function (key) { return ["serial", "x", "y", "weapon", "bet"].indexOf(key) >= 0; }) &&
    roomWhole(data.serial, 1, 2147483647) && typeof data.x === "number" && Number.isFinite(data.x) && data.x >= -8.9 && data.x <= 8.9 &&
    typeof data.y === "number" && Number.isFinite(data.y) && data.y >= -4.5 && data.y <= 4.5 &&
    WEAPON_VALUES.indexOf(data.weapon) >= 0 && BET_VALUES.indexOf(data.bet) >= 0;
}

defineRoom({
  maxPlayers: MAX_PLAYERS,
  tickRate: 10,
  onCreate: function (room) {
    room.state = {createdAt: Date.now(), elapsedMs: 0, revision: 0, shotSerial: 0,
      members: [], dirty: false, lastPublished: 0};
  },
  onJoin: function (room, player) {
    var s = room.state;
    if (roomMember(room, player.id)) return;
    if (s.members.some(function (p) { return p.userId === player.userId; })) {
      roomFailure(room, player, "duplicateUser", "同一帳號已在這個房間。"); room.kick(player); return;
    }
    if (s.members.length >= MAX_PLAYERS) {
      roomFailure(room, player, "roomFull", "這個房間已滿。"); room.kick(player); return;
    }
    var seat = 0;
    while (s.members.some(function (p) { return p.seat === seat; })) seat++;
    s.members.push({id: player.id, userId: player.userId, name: roomName(player.name), seat: seat,
      weapon: "like", bet: 10, x: 0, y: 0, aimSerial: 0, shotSerial: 0, lastAimAt: -1000, lastShotAt: -1000, lastDirtyAt: -1000});
    s.revision++; roomPublish(room);
  },
  onMessage: function (room, player, type, data) {
    var s = room.state, member = roomMember(room, player.id);
    if (!member) return;
    if (type === "hello") {
      if (!roomRecord(data) || data.protocol !== PROTOCOL) return roomFailure(room, player, "protocolMismatch", "房間版本不同，請重新整理。");
      room.send(player, "state", roomSnapshot(room, player)); return;
    }
    if (type === "fieldDirty") {
      // This is an invalidation hint only. Clients must read roomSnapshot via
      // the financial server before changing their shared symbol generations.
      if (!roomRecord(data) || Object.keys(data).some(function (key) { return key !== "revision"; }) ||
          !roomWhole(data.revision, 1, 2147483647) || s.elapsedMs - member.lastDirtyAt < 500) return;
      member.lastDirtyAt = s.elapsedMs;
      room.broadcast("fieldDirty", {protocol: PROTOCOL, roomId: room.id,
        playerId: member.id, revision: data.revision, at: roomNow(room)}, {except: player});
      return;
    }
    if (type !== "aim" && type !== "shot") return;
    if (!roomGesture(data)) return roomFailure(room, player, "invalidGesture", "操作資料不正確。");
    var serialKey = type === "aim" ? "aimSerial" : "shotSerial";
    if (data.serial <= member[serialKey]) return;
    var timeKey = type === "aim" ? "lastAimAt" : "lastShotAt";
    var interval = type === "aim" ? 100 : 80;
    if (s.elapsedMs - member[timeKey] < interval) return;
    member[serialKey] = data.serial; member[timeKey] = s.elapsedMs;
    member.x = data.x; member.y = data.y; member.weapon = data.weapon; member.bet = data.bet;
    s.revision++; s.dirty = true;
    if (type === "shot") {
      s.shotSerial++;
      room.broadcast("shot", {protocol: PROTOCOL, roomId: room.id, serial: s.shotSerial,
        shotId: data.serial, playerId: member.id, seat: member.seat, name: member.name,
        weapon: member.weapon, bet: member.bet, x: member.x, y: member.y, at: roomNow(room)});
    }
  },
  onLeave: function (room, player) {
    var s = room.state, before = s.members.length;
    s.members = s.members.filter(function (p) { return p.id !== player.id; });
    if (s.members.length !== before) { s.revision++; roomPublish(room); }
  },
  onTick: function (room, dtMs) {
    if (typeof dtMs !== "number" || !Number.isFinite(dtMs) || dtMs <= 0) return;
    var s = room.state;
    s.elapsedMs += Math.min(dtMs, 1000);
    if (s.dirty || s.elapsedMs - s.lastPublished >= 2000) roomPublish(room);
  },
});
