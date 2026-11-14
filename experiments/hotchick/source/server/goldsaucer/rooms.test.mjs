import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import test from 'node:test';

const source = fs.readFileSync(new URL('./functions.js', import.meta.url), 'utf8');
const roomSource = fs.readFileSync(new URL('./room.js', import.meta.url), 'utf8');
const plain = value => JSON.parse(JSON.stringify(value));
const PROTOCOL = 'hc-rooms-v1';
function freeze(value) { if (value && typeof value === 'object') { Object.freeze(value); for (const item of Object.values(value)) freeze(item); } return value; }

function directory() {
  let functions, clock = 1000000, shared = null;
  vm.runInNewContext(source, {defineFunctions: value => functions = value, Date: {now: () => clock}});
  const states = new Map();
  return {
    functions,
    get shared() { return shared; },
    set shared(value) { shared = plain(value); },
    tick(ms) { clock += ms; },
    call(id, op, roomId, extra = {}, playerExtra = {}) {
      const ctx = {player: {id, username: id, displayName: id.toUpperCase(), ...playerExtra},
        chips: 12345, currency: {name: '心動幣', perDiamond: 50}, shared: freeze(plain(shared)),
        randomInt(min, max) { assert.equal(min, 1); assert.equal(max, 2147483646); return 123456; }};
      if (!states.has(id)) states.set(id, functions.init(ctx));
      const state = states.get(id), before = plain(state);
      const input = {op, buildId: PROTOCOL, ...(roomId === undefined ? {} : {roomId}), ...extra};
      const result = functions.roomDirectory(state, input, ctx);
      assert.equal(result.state, state);
      assert.deepEqual(plain(result.state), before, 'financial profile must remain unchanged');
      assert.deepEqual(plain(result.chips), {bet: 0, win: 0});
      if (Object.hasOwn(result, 'shared')) shared = plain(result.shared);
      return plain(result);
    },
  };
}

test('directory list reads empty or active leases without writing shared or changing financial state', () => {
  const h = directory();
  const first = h.call('one', 'list');
  assert.equal(first.result.ok, true); assert.deepEqual(first.result.rooms, []);
  assert.equal(Object.hasOwn(first, 'shared'), false);
  h.call('one', 'advertise', 'room-one');
  const listed = h.call('two', 'list');
  assert.equal(listed.result.rooms[0].playerCount, 1);
  assert.deepEqual(listed.result.rooms[0].players, [{id: 'one', name: 'ONE'}]);
  assert.equal(Object.hasOwn(listed, 'shared'), false);
  assert.equal(listed.result.currentRoomId, null);
});

test('directory authenticates public identity, renews leases and moves only the caller', () => {
  const h = directory();
  h.call('one', 'advertise', 'room-one', {}, {displayName: '\u202eAlice\n<script>'});
  h.call('two', 'advertise', 'room-one');
  let own = h.shared.hotchickRooms.leases.find(x => x.userId === 'one');
  assert.equal(own.name, 'Alice <script>');
  assert.equal(own.expiresAt - own.updatedAt, 45000);
  h.tick(15000); h.call('one', 'advertise', 'room-two');
  assert.equal(h.shared.hotchickRooms.leases.filter(x => x.userId === 'one').length, 1);
  const staleLeave = h.call('one', 'leave', 'room-one');
  assert.equal(staleLeave.result.currentRoomId, 'room-two');
  assert.equal(Object.hasOwn(staleLeave, 'shared'), false);
  h.call('two', 'leave', 'room-one');
  assert.deepEqual(h.call('three', 'list').result.rooms.map(x => x.id), ['room-two']);
  const spoof = h.call('one', 'advertise', 'room-one', {userId: 'two', name: 'FAKE'});
  assert.equal(spoof.result.error.code, 'invalidRequest');
});

test('expired or incompatible leases disappear on read and mutations preserve unrelated shared data', () => {
  const h = directory();
  h.shared = {otherFeature: {value: 7}, hotchickRooms: {schema: 1, leases: []}};
  h.call('one', 'advertise', 'room-one');
  h.tick(45000);
  const expired = h.call('two', 'list');
  assert.deepEqual(expired.result.rooms, []); assert.equal(Object.hasOwn(expired, 'shared'), false);
  const shared = plain(h.shared); shared.hotchickRooms.leases[0].buildId = 'other-build'; h.shared = shared;
  h.call('two', 'advertise', 'room-two');
  assert.deepEqual(h.shared.otherFeature, {value: 7});
  assert.deepEqual(h.shared.hotchickRooms.leases.map(x => x.userId), ['two']);
});

test('full room rejection retains the caller old room and room count is bounded', () => {
  const h = directory();
  for (const id of ['one', 'two', 'three']) h.call(id, 'advertise', 'room-full');
  h.call('four', 'advertise', 'room-old');
  const before = plain(h.shared);
  assert.equal(h.call('four', 'advertise', 'room-full').result.error.code, 'roomFull');
  assert.deepEqual(h.shared, before);
  for (let i = 0; i < 14; i++) assert.equal(h.call('extra-' + i, 'advertise', 'extra-room-' + i).result.ok, true);
  assert.equal(h.call('overflow', 'advertise', 'room-overflow').result.error.code, 'directoryFull');
  assert.equal(h.call('reader', 'list').result.rooms.length, 16);
});

test('directory validates operations and identifiers without trusting client clocks or other member fields', () => {
  const h = directory();
  for (const input of [
    ['create', 'room-one', {}], ['advertise', 'new', {}], ['advertise', '../room', {}],
    ['leave', undefined, {}], ['advertise', 'room-one', {buildId: 'wrong'}],
    ['advertise', 'room-one', {expiresAt: 900000000}],
  ]) assert.equal(h.call('one', ...input).result.error.code, 'invalidRequest');
  assert.equal(h.shared, null);
});

test('worst-case directory fits platform result and shared-state byte limits', () => {
  const h = directory();
  for (let room = 0; room < 16; room++) for (let player = 0; player < 3; player++) {
    const id = `${room}-${player}`.padEnd(64, 'x');
    const roomId = `room-${room}`.padEnd(64, 'r');
    assert.equal(h.call(id, 'advertise', roomId, {}, {displayName: '💗'.repeat(24)}).result.ok, true);
  }
  const result = h.call('reader', 'list').result;
  assert.equal(result.rooms.length, 16);
  assert(Buffer.byteLength(JSON.stringify(result)) < 16384);
  assert(Buffer.byteLength(JSON.stringify(h.shared)) < 65536);
});

function roomHarness() {
  let def;
  vm.runInNewContext(roomSource, {defineRoom: value => def = value, Date: {now: () => 1000000}});
  const messages = [], kicked = [];
  const room = {id: 'room-test', players: [], state: {},
    send(p, type, data) { messages.push({to: p.id, type, data: plain(data)}); },
    broadcast(type, data) { messages.push({to: '*', type, data: plain(data)}); },
    kick(p) { kicked.push(p.id); }};
  def.onCreate(room);
  return {def, room, messages, kicked,
    join(id, userId = 'user-' + id, name = id.toUpperCase()) { const p = {id, userId, name}; room.players.push(p); def.onJoin(room, p); return p; },
    leave(p) { room.players = room.players.filter(x => x.id !== p.id); def.onLeave(room, p); },
    tick(ms = 100) { def.onTick(room, ms); },
    message(p, type, data) { def.onMessage(room, p, type, data); },
    state(p) { def.onMessage(room, p, 'hello', {protocol: PROTOCOL}); return messages.findLast(x => x.to === p.id && x.type === 'state')?.data; },
  };
}

test('room join and leave publish stable authenticated seats without financial data', () => {
  const h = roomHarness();
  assert.equal(h.def.maxPlayers, 3); assert.equal(h.def.tickRate, 10);
  const one = h.join('one'), two = h.join('two'), three = h.join('three');
  const initial = h.state(two);
  assert.equal(initial.you, two.id); assert.equal(initial.players.length, 3);
  assert.deepEqual(initial.players.map(x => x.seat), [0, 1, 2]);
  assert.equal(initial.serverTime, 1000000);
  assert.equal('chips' in initial, false); assert.equal('cards' in initial, false);
  h.leave(two);
  assert.deepEqual(h.state(one).players.map(x => x.seat), [0, 2]);
  const replacement = h.join('four');
  assert.equal(h.state(replacement).players.find(x => x.id === replacement.id).seat, 1);
  assert.equal(h.state(three).players.find(x => x.id === three.id).seat, 2);
});

test('room rejects a duplicate member or a fourth seat without replacing existing players', () => {
  const h = roomHarness(), one = h.join('one');
  const duplicate = h.join('duplicate', one.userId);
  assert(h.kicked.includes(duplicate.id)); assert.equal(h.room.state.members.length, 1);
  assert.equal(h.messages.some(x => x.to === duplicate.id && x.type === 'state'), false);
  assert.equal(h.messages.findLast(x => x.to === duplicate.id).data.code, 'duplicateUser');
  h.join('two'); h.join('three'); const fourth = h.join('four');
  assert(h.kicked.includes(fourth.id)); assert.equal(h.room.state.members.length, 3);
  h.leave(duplicate); assert.equal(h.state(one).players.length, 3);
});

test('shot events derive identity and reject malformed, replayed or rate-limited gestures', () => {
  const h = roomHarness(), one = h.join('one'), two = h.join('two');
  const shot = {serial: 1, x: 2, y: 1, weapon: 'rocket', bet: 50};
  h.message(one, 'shot', {...shot, playerId: two.id});
  h.message(one, 'shot', {...shot, x: NaN});
  h.message(one, 'shot', {...shot, weapon: 'money'});
  assert.equal(h.messages.filter(x => x.type === 'shot').length, 0);
  h.message(one, 'shot', shot);
  let event = h.messages.findLast(x => x.type === 'shot').data;
  assert.equal(event.playerId, one.id); assert.equal(event.seat, 0); assert.equal(event.shotId, 1);
  assert.equal(event.serial, 1); assert.equal('balance' in event, false);
  h.message(one, 'shot', shot); h.message(one, 'shot', {...shot, serial: 2});
  assert.equal(h.messages.filter(x => x.type === 'shot').length, 1);
  h.tick(100); h.message(one, 'shot', {...shot, serial: 2});
  event = h.messages.findLast(x => x.type === 'shot').data;
  assert.equal(event.serial, 2); assert.equal(event.shotId, 2);
  h.message(two, 'shot', {...shot, serial: 1});
  assert.equal(h.messages.findLast(x => x.type === 'shot').data.playerId, two.id);
});

test('aim state coalesces into bounded snapshots and a late hello restores full membership', () => {
  const h = roomHarness(), one = h.join('one', 'user-one', '\u202eAlice\nName');
  const before = h.messages.length;
  h.message(one, 'aim', {serial: 1, x: -4, y: 3, weapon: 'flower', bet: 20});
  assert.equal(h.messages.length, before);
  h.tick();
  let snapshot = h.state(one);
  assert.equal(snapshot.players[0].x, -4); assert.equal(snapshot.players[0].weapon, 'flower');
  assert.equal(snapshot.players[0].name, 'Alice Name');
  const revision = snapshot.revision;
  h.message(one, 'aim', {serial: 1, x: 4, y: 1, weapon: 'like', bet: 1});
  snapshot = h.state(one); assert.equal(snapshot.revision, revision);
  assert.equal(snapshot.players[0].x, -4);
  h.tick(1000); h.tick(1000);
  assert(h.messages.filter(x => x.type === 'state').length >= 3);
  assert(Buffer.byteLength(JSON.stringify(snapshot)) < 8192);
});

function fieldHarness() {
  let functions, clock = 1000000, shared = null, sharedRevision = 0, randomCalls = 0;
  const context = vm.createContext({defineFunctions: value => functions = value, Date: {now: () => clock}});
  vm.runInContext(source, context);
  const parameters = vm.runInContext('fieldParameters', context);
  const users = new Map();
  function user(id) { if (!users.has(id)) users.set(id, {state: null, chips: 10000}); return users.get(id); }
  function prepare(id, fn, input, rolls = []) {
    const own = user(id), baseRevision = sharedRevision;
    let draws = 0;
    const ctx = {player: {id, username: id, displayName: id}, currency: {name: '心動幣', perDiamond: 50},
      chips: own.chips, shared: freeze(plain(shared)), randomInt(min, max) {
        randomCalls++; const value = draws < rolls.length ? rolls[draws++] : 123456;
        assert(value >= min && value <= max, `fixture draw ${value} outside${min}..${max}`); return value;
      }};
    const state = own.state ? plain(own.state) : functions.init(ctx);
    const output = plain(functions[fn](state, plain(input), ctx));
    return {id, fn, output, baseRevision};
  }
  function commit(prepared, sharedDependent = true) {
    if (sharedDependent && prepared.baseRevision !== sharedRevision) return false;
    const own = user(prepared.id), out = prepared.output;
    own.state = out.state; own.chips += out.chips.win - out.chips.bet;
    if (Object.hasOwn(out, 'shared')) { shared = out.shared; sharedRevision++; }
    return true;
  }
  function call(id, fn, input, rolls = []) { const prepared = prepare(id, fn, input, rolls); assert(commit(prepared)); return prepared.output; }
  function open(id) { return call(id, 'open', {clientId: 'client-' + id, mode: 'paid'}); }
  function advertise(id, roomId = 'room-shared') { return call(id, 'roomDirectory', {op: 'advertise', buildId: PROTOCOL, roomId}); }
  function snapshot(id, roomId = 'room-shared') { return call(id, 'roomSnapshot', {buildId: PROTOCOL, roomId}); }
  function target(board, slot) {
    const generation = board.slots[slot - 1].generation, p = parameters(board.seed, slot, generation);
    return {id: String(generation * 32 + slot), tier: p.tier, characterId: p.characterId};
  }
  function batch(id, targets, {weapon = 'like', bet = 10, rounds, roomId = 'room-shared'} = {}) {
    const state = user(id).state;
    return {session: state.session, batchId: state.sequence + 1, mode: 'paid', roomId, buildId: PROTOCOL,
      rounds: rounds || [{roundId: state.sequence + 1, weapon, bet, targets}]};
  }
  return {functions, user, prepare, commit, call, open, advertise, snapshot, target, batch,
    tick(ms) { clock += ms; }, get randomCalls() { return randomCalls; }, get shared() { return shared; }};
}

test('all members read the same server-seeded27-slot field and natural expiry advances in constant time', () => {
  const h = fieldHarness(); h.open('one'); h.open('two');
  const first = h.advertise('one').result.board, draws = h.randomCalls;
  const second = h.advertise('two').result.board;
  assert.equal(first.seed, 123456); assert.equal(first.slots.length, 27);
  assert.deepEqual(first, second); assert.equal(h.randomCalls, draws, 'joining an existing field must not reseed it');
  assert.equal(h.target(first, 1).tier, 'small'); assert.equal(h.target(first, 19).tier, 'medium'); assert.equal(h.target(first, 25).tier, 'large');
  const before = h.snapshot('one'); assert.equal(Object.hasOwn(before, 'shared'), false);
  h.tick(15000); const advanced = h.advertise('one').result.board;
  assert(advanced.slots.some((slot, index) => slot.generation > first.slots[index].generation));
  assert.deepEqual(h.snapshot('two').result.board, advanced);
  assert.equal(h.randomCalls, draws);
});

test('one shared fish pays once; another player and uncertain retry cannot award it again', () => {
  const h = fieldHarness(); h.open('one'); h.open('two');
  const board = h.advertise('one').result.board; h.advertise('two'); const target = h.target(board, 1);
  const request = h.batch('one', [target]);
  const captured = h.call('one', 'settle', request, [1, 2]);
  assert.equal(captured.result.bet, 10); assert.equal(captured.result.win, 20);
  assert.equal(captured.result.rounds[0].targets[0].eligible, true);
  assert.equal(captured.result.board.slots[0].generation, 2);
  assert.equal(captured.result.board.slots[0].bornMs, 1200);
  const beforeDraws = h.randomCalls, beforeChips = h.user('one').chips;
  const retried = h.call('one', 'settle', request);
  assert.deepEqual(retried.result, captured.result); assert.deepEqual(retried.chips, {bet: 0, win: 0});
  assert.equal(h.user('one').chips, beforeChips); assert.equal(h.randomCalls, beforeDraws);
  const loser = h.call('two', 'settle', h.batch('two', [target]));
  assert.equal(loser.result.bet, 0); assert.equal(loser.result.win, 0);
  assert.deepEqual(loser.result.rounds, [{roundId: 1, cost: 0, refunded: true, targets: []}]);
  assert.equal(loser.result.profile.stats.spent, 0); assert.equal(loser.result.profile.stats.settledRounds, 0);
  assert.equal(loser.result.profile.cards.progress, 0); assert.equal(h.user('two').chips, 10000);
  assert.equal(h.randomCalls, beforeDraws);
});

test('platform CAS conflict retry sees the winning capture and refunds the competing wager', () => {
  const h = fieldHarness(); h.open('one'); h.open('two');
  const board = h.advertise('one').result.board; h.advertise('two'); const target = h.target(board, 1);
  const one = h.prepare('one', 'settle', h.batch('one', [target]), [1, 2]);
  const two = h.prepare('two', 'settle', h.batch('two', [target]), [1, 2]);
  assert.equal(one.output.result.win, 20); assert.equal(two.output.result.win, 20);
  assert(h.commit(one)); assert.equal(h.commit(two), false, 'stale shared revision must roll back player state and money');
  assert.equal(h.user('two').state.sequence, 0); assert.equal(h.user('two').chips, 10000);
  const retried = h.call('two', 'settle', h.batch('two', [target]));
  assert.equal(retried.result.rounds[0].refunded, true); assert.deepEqual(retried.chips, {bet: 0, win: 0});
});

test('partial eligibility preserves target positions and splits the complete cost only over live hits', () => {
  const h = fieldHarness(); h.open('one'); h.open('two');
  const board = h.advertise('one').result.board; h.advertise('two');
  const dead = h.target(board, 1), alive = h.target(board, 2);
  h.call('one', 'settle', h.batch('one', [dead]), [1, 2]);
  const partial = h.call('two', 'settle', h.batch('two', [dead, alive], {weapon: 'rocket'}), [1, 2]);
  assert.equal(partial.result.bet, 150); assert.equal(partial.result.win, 300);
  const outcomes = partial.result.rounds[0].targets;
  assert.deepEqual(outcomes.map(x => x.id), [dead.id, alive.id]);
  assert.deepEqual(outcomes[0], {id: dead.id, captured: false, award: 0, multiplier: 0, eligible: false, styleId: 'classic', clipId: null});
  assert.equal(outcomes[1].eligible, true); assert.equal(outcomes[1].award, 300);
  assert.equal(partial.result.profile.stats.spent, 150); assert.equal(partial.result.profile.cards.progress, 150);
});

test('a same-batch capture refunds subsequent shots at the old generation and hidden respawns cannot pay', () => {
  const h = fieldHarness(); h.open('one'); const board = h.advertise('one').result.board, target = h.target(board, 1);
  const rounds = [1, 2].map(roundId => ({roundId, weapon: 'like', bet: 10, targets: [target]}));
  const result = h.call('one', 'settle', h.batch('one', [target], {rounds}), [1, 2]);
  assert.equal(result.result.bet, 10); assert.equal(result.result.win, 20);
  assert.equal(result.result.rounds[1].refunded, true); assert.equal(result.result.profile.stats.settledRounds, 1);
  const hidden = h.target(result.result.board, 1), draws = h.randomCalls;
  const hiddenResult = h.call('one', 'settle', h.batch('one', [hidden]));
  assert.equal(hiddenResult.result.rounds[0].refunded, true); assert.equal(h.randomCalls, draws);
  h.tick(1200); assert.equal(h.call('one', 'settle', h.batch('one', [hidden]), [400]).result.bet, 10);
});

test('room membership, canonical metadata and retry room context fail closed without money movement', () => {
  const h = fieldHarness(); h.open('one'); const board = h.advertise('one').result.board, target = h.target(board, 1);
  const original = h.batch('one', [target]);
  const invalid = h.call('one', 'settle', {...original, rounds: [{...original.rounds[0], targets: [{...target, characterId: target.characterId === 'original' ? 'mugi' : 'original'}]}]});
  assert.equal(invalid.result.error.code, 'fieldMismatch'); assert.deepEqual(invalid.chips, {bet: 0, win: 0});
  const first = h.call('one', 'settle', original, [400]); assert.equal(first.result.ok, true);
  const substituted = h.call('one', 'settle', {...original, roomId: 'another-room'});
  assert.equal(substituted.result.error.code, 'requestConflict'); assert.deepEqual(substituted.chips, {bet: 0, win: 0});
  h.tick(45000);
  assert.equal(h.snapshot('one').result.error.code, 'roomUnavailable');
  const expired = h.call('one', 'settle', h.batch('one', [target]));
  assert.equal(expired.result.error.code, 'roomUnavailable'); assert.deepEqual(expired.chips, {bet: 0, win: 0});
});

test('field invalidations are rate-limited hints and cannot carry a client-authored field or award', () => {
  const h = roomHarness(), one = h.join('one');
  h.message(one, 'capture', {targetId: '33', award: 9999});
  h.message(one, 'fieldDirty', {revision: 9, slots: [{generation: 999}]});
  assert.equal(h.messages.filter(x => x.type === 'fieldDirty').length, 0);
  h.message(one, 'fieldDirty', {revision: 9});
  const event = h.messages.findLast(x => x.type === 'fieldDirty').data;
  assert.equal(event.playerId, one.id); assert.equal('slots' in event, false); assert.equal('award' in event, false);
  h.message(one, 'fieldDirty', {revision: 10});
  assert.equal(h.messages.filter(x => x.type === 'fieldDirty').length, 1);
});

test('content-version build scopes keep directories, leases and settlement fields separate', () => {
  const h = fieldHarness(); h.open('one'); h.open('two');
  const buildA = PROTOCOL + ':version-a', buildB = PROTOCOL + ':version-b';
  const one = h.call('one', 'roomDirectory', {op: 'advertise', buildId: buildA, roomId: 'room-build-a'});
  const two = h.call('two', 'roomDirectory', {op: 'advertise', buildId: buildB, roomId: 'room-build-b'});
  assert.equal(h.shared.hotchickRooms.leases.length, 2, 'a new version must not prune another live version');
  assert.deepEqual(h.call('one', 'roomDirectory', {op: 'list', buildId: buildA}).result.rooms.map(x => x.id), ['room-build-a']);
  assert.deepEqual(h.call('two', 'roomDirectory', {op: 'list', buildId: buildB}).result.rooms.map(x => x.id), ['room-build-b']);
  const wrong = h.call('one', 'roomSnapshot', {buildId: buildB, roomId: 'room-build-a'});
  assert.equal(wrong.result.error.code, 'roomUnavailable');
  const stolen = h.call('two', 'roomDirectory', {op: 'advertise', buildId: buildB, roomId: 'room-build-a'});
  assert.equal(stolen.result.error.code, 'roomUnavailable');
  const targetA = h.target(one.result.board, 1), targetB = h.target(two.result.board, 1);
  const capturedA = h.call('one', 'settle', {...h.batch('one', [targetA], {roomId: 'room-build-a'}), buildId: buildA}, [1, 2]);
  const capturedB = h.call('two', 'settle', {...h.batch('two', [targetB], {roomId: 'room-build-b'}), buildId: buildB}, [1, 2]);
  assert.equal(capturedA.result.win, 20); assert.equal(capturedB.result.win, 20);
});
