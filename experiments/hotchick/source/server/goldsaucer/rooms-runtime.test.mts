import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import {pathToFileURL} from 'node:url';

const platformRoot = process.env.GOLDSAUCER_SOURCE || 'D:/TSProject/GoldSaucer';
const roomModule = pathToFileURL(path.join(platformRoot, 'packages/sandbox/src/quickjs-runtime.ts')).href;
const functionModule = pathToFileURL(path.join(platformRoot, 'packages/sandbox/src/functions-runtime.ts')).href;
const {initSandbox, createRoomRuntime, validateRoomScript} = await import(roomModule);
const {initFunctionsRuntime, validateFunctions, runFunction} = await import(functionModule);
const source = await fs.readFile('server/goldsaucer/functions.js', 'utf8');
const roomSource = await fs.readFile('server/goldsaucer/room.js', 'utf8');
await initSandbox(); await initFunctionsRuntime();
const validated = validateFunctions(source);
assert.equal(validated.ok, true, JSON.stringify(validated));
assert(validated.names.includes('roomDirectory') && validated.names.includes('roomSnapshot'));
assert.deepEqual(await validateRoomScript(roomSource), {ok: true, maxPlayers: 3, tickRate: 10});

const runtime = createRoomRuntime(roomSource), players = [
  {id: 'socket-one', userId: 'account-one', name: '第一位'},
  {id: 'socket-two', userId: 'account-two', name: '第二位'},
];
try {
  runtime.dispatch({t: 'create', roomId: 'sandbox-room'});
  for (const player of players) runtime.dispatch({t: 'join', player});
  const commands = runtime.dispatch({t: 'message', playerId: players[1].id, type: 'hello', data: {protocol: 'hc-rooms-v1'}});
  const state = commands.find(c => c.c === 'send' && c.type === 'state')?.data;
  assert.equal(state.players.length, 2); assert.equal(state.you, players[1].id);
  assert.deepEqual(state.players.map(p => p.userId), players.map(p => p.userId));
  const shot = runtime.dispatch({t: 'message', playerId: players[0].id, type: 'shot', data: {serial: 1, x: 1, y: 2, weapon: 'like', bet: 10}});
  assert.equal(shot.find(c => c.c === 'broadcast' && c.type === 'shot')?.data.playerId, players[0].id);
  runtime.dispatch({t: 'leave', playerId: players[0].id});
  const left = runtime.dispatch({t: 'message', playerId: players[1].id, type: 'hello', data: {protocol: 'hc-rooms-v1'}});
  assert.equal(left.find(c => c.c === 'send' && c.type === 'state')?.data.players.length, 1);
} finally { runtime.dispose(); }

let shared = null, calls = 0, maxResultBytes = 0, maxSharedBytes = 0;
const personal = new Map();
function call(userId, name, input, roll = 0) {
  const stored = personal.get(userId) || {state: null, chips: 10000};
  const response = runFunction(source, {name, input, state: stored.state, shared,
    player: {id: userId, username: userId, displayName: userId}, chips: stored.chips,
    currency: {name: '心動幣', perDiamond: 50}, randoms: Array.from({length: 256}, () => roll)});
  assert.equal(response.ok, true, JSON.stringify(response));
  const out = response.out;
  assert.equal(out.result.ok, true, JSON.stringify(out.result));
  if (Object.hasOwn(out, 'shared')) shared = out.shared;
  personal.set(userId, {state: out.state, chips: stored.chips - out.chips.bet + out.chips.win});
  maxResultBytes = Math.max(maxResultBytes, Buffer.byteLength(JSON.stringify(out.result)));
  maxSharedBytes = Math.max(maxSharedBytes, Buffer.byteLength(JSON.stringify(shared)));
  calls++;
  return out;
}
const protocol = 'hc-rooms-v1', roomId = 'sandbox-room';
for (const p of players) call(p.userId, 'open', {clientId: p.id, mode: 'paid'});
const first = call(players[0].userId, 'roomDirectory', {op: 'advertise', buildId: protocol, roomId});
call(players[1].userId, 'roomDirectory', {op: 'advertise', buildId: protocol, roomId});
const snapshot = call(players[1].userId, 'roomSnapshot', {buildId: protocol, roomId});
assert.equal(snapshot.sharedAccessed, true, 'the platform must CAS-guard canonical field reads');
assert.deepEqual(snapshot.result.board.slots, first.result.board.slots);
const board = snapshot.result.board, seed = board.seed, slot = 1;
let random = (seed + slot * 104729 + 13007) % 2147483647;
if (random < 1) random += 2147483646;
for (let i = 0; i < 4; i++) random = random * 16807 % 2147483647;
const characterId = ['original', 'mugi', 'jiayi', 'yeseul', 'eunbi'][Math.floor((random - 1) / 2147483646 * 5)];
const request = {session: 1, batchId: 1, mode: 'paid', roomId, buildId: protocol,
  rounds: [{roundId: 1, weapon: 'like', bet: 10, targets: [{id: '33', tier: 'small', characterId}]}]};
const won = call(players[0].userId, 'settle', request);
assert.equal(won.result.win, 20); assert.equal(won.sharedAccessed, true);
const lostRace = call(players[1].userId, 'settle', request);
assert.equal(lostRace.result.bet, 0); assert.equal(lostRace.result.rounds[0].refunded, true);
assert.deepEqual(lostRace.chips, {bet: 0, win: 0});
const retry = call(players[0].userId, 'settle', request, .99999);
assert.deepEqual(retry.result, won.result); assert.deepEqual(retry.chips, {bet: 0, win: 0});
assert.equal(retry.sharedAccessed, undefined, 'a cached receipt does not need the latest shared field');
assert.equal(personal.get(players[0].userId).chips, 10010);
assert.equal(personal.get(players[1].userId).chips, 10000);
const report = {passed: true, scope: 'Actual GoldSaucer QuickJS room and function runtimes; synthetic users and chips only',
  calls, maxResultBytes, maxSharedBytes, checks: ['room joins, shot relay and leave', 'shared field is CAS-dependent',
    'two players share one canonical field', 'one capture pays once', 'losing race refunds', 'cached receipt does not redraw or read changed field']};
await fs.writeFile('artifacts/goldsaucer/qa/rooms-runtime.json', JSON.stringify(report, null, 2));
console.log(JSON.stringify(report));
