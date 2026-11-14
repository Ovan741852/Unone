/* GoldSaucer executes this file in its server-function sandbox. */
"use strict";

const RULES = Object.freeze({
  schema: 1,
  rtpNumerator: 98,
  rtpDenominator: 100,
  perDiamond: 50,
  initialDemoBalance: 10000,
  maxBatchRounds: 10,
  maxSequence: 2147483647,
  maxWallet: 1099511627775,
  maxBatchWin: 1800000,
  maxStoredPacks: 9999,
  maxCardsPerDraw: 10,
});
const BETS = Object.freeze([1, 5, 10, 20, 50]);
const WEAPONS = Object.freeze({
  like: Object.freeze({cost: 1, targets: 1}),
  flower: Object.freeze({cost: 6, targets: 6}),
  rocket: Object.freeze({cost: 15, targets: 5}),
});
const RANGES = Object.freeze({small: [2, 6], medium: [8, 18], large: [100, 240]});
const CHARACTERS = Object.freeze(["original", "mugi", "jiayi", "yeseul", "eunbi"]);
const CARD_POOLS = Object.freeze({
  N: ["eunbi-n-01", "eunbi-n-02", "yeseul-n-01", "jiayi-n-01", "mugi-n-01", "mugi-n-02"],
  R: ["eunbi-r-01", "eunbi-r-02", "yeseul-r-01", "jiayi-r-01"],
  SR: ["eunbi-sr-01", "yeseul-sr-01", "jiayi-sr-01", "jiayi-sr-02"],
});
const own = (object, name) => Object.prototype.hasOwnProperty.call(object, name);

function isRecord(value) {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function whole(value, minimum, maximum) {
  return Number.isSafeInteger(value) && value >= minimum && value <= maximum;
}

function onlyKeys(value, allowed) {
  return isRecord(value) && Object.keys(value).every(key => allowed.includes(key));
}

function validIdentifier(value) {
  return typeof value === "string" && /^[A-Za-z0-9_.:-]{1,64}$/.test(value);
}

function newProfile() {
  return {
    revision: 0,
    unlockedClipIds: [],
    watchedLargeClipIds: [],
    skipSeenLargeVideos: false,
    preferences: {bet: 10, weapon: "like"},
    stats: {spent: 0, won: 0, settledRounds: 0, captures: 0},
    cards: {
      counts: {}, totalDraws: 0, drawsAvailable: 0, progress: 0,
      drawsEarned: 0, creditedSpend: 0, ignoredSpend: 0, lastBatch: null,
    },
  };
}

function clone(value) {
  return JSON.parse(JSON.stringify(value));
}

function initialState(ctx) {
  return {
    schema: RULES.schema,
    ownerId: ctx.player.id,
    session: 0,
    clientId: "",
    sequence: 0,
    revision: 0,
    demoBalance: RULES.initialDemoBalance,
    profiles: {demo: newProfile(), paid: newProfile()},
    drawSequence: {demo: 0, paid: 0},
    lastDraw: {demo: null, paid: null},
    lastBatch: null,
  };
}

function validState(state, ctx) {
  return isRecord(state) && state.schema === RULES.schema && state.ownerId === ctx.player.id &&
    whole(state.session, 0, RULES.maxSequence) && whole(state.sequence, 0, RULES.maxSequence) &&
    whole(state.revision, 0, Number.MAX_SAFE_INTEGER - 1) && typeof state.clientId === "string" &&
    whole(state.demoBalance, 0, RULES.maxWallet) && isRecord(state.profiles) &&
    isRecord(state.profiles.demo) && isRecord(state.profiles.paid) && isRecord(state.drawSequence);
}

function currencyMatches(ctx) {
  return ctx.currency === null || ctx.currency === undefined || ctx.currency.perDiamond === RULES.perDiamond;
}

function reject(state, input, ctx, code, message) {
  const demo = input && input.mode === "demo";
  const profile = state && state.profiles && input &&
    (input.mode === "demo" || input.mode === "paid") ? state.profiles[input.mode] : undefined;
  return {
    state,
    result: {
      ok: false,
      error: {code, message},
      session: state && state.session,
      batchId: input && input.batchId,
      drawId: input && input.drawId,
      mode: input && input.mode,
      balance: demo ? state && state.demoBalance : ctx.chips,
      profile,
    },
    chips: {bet: 0, win: 0},
  };
}

function normalizedRounds(input) {
  if (!Array.isArray(input.rounds) || input.rounds.length < 1 || input.rounds.length > RULES.maxBatchRounds) {
    return null;
  }
  const ids = new Set();
  const rounds = [];
  for (const round of input.rounds) {
    if (!onlyKeys(round, ["roundId", "weapon", "bet", "targets"]) ||
        !whole(round.roundId, 1, RULES.maxSequence) || ids.has(round.roundId) ||
        typeof round.weapon !== "string" || !own(WEAPONS, round.weapon) || !BETS.includes(round.bet)) {
      return null;
    }
    const weapon = WEAPONS[round.weapon];
    if (!Array.isArray(round.targets) || round.targets.length < 1 || round.targets.length > weapon.targets) {
      return null;
    }
    const targetIds = new Set();
    const targets = [];
    for (const target of round.targets) {
      if (!onlyKeys(target, ["id", "tier", "characterId"]) || !validIdentifier(target.id) ||
          targetIds.has(target.id) || typeof target.tier !== "string" || !own(RANGES, target.tier) ||
          !CHARACTERS.includes(target.characterId)) {
        return null;
      }
      targetIds.add(target.id);
      targets.push({id: target.id, tier: target.tier, characterId: target.characterId});
    }
    ids.add(round.roundId);
    rounds.push({roundId: round.roundId, weapon: round.weapon, bet: round.bet, targets});
  }
  return rounds;
}

function targetAward(target, cost, count, ctx) {
  const range = RANGES[target.tier];
  const denominator = (RULES.rtpDenominator / 2) * (range[0] + range[1]);
  if (ctx.randomInt(1, denominator) > RULES.rtpNumerator) {
    return {id: target.id, captured: false, award: 0, multiplier: 0};
  }
  const multiplier = ctx.randomInt(range[0], range[1]);
  const numerator = cost * multiplier;
  let award = Math.floor(numerator / count);
  const remainder = numerator % count;
  if (remainder > 0 && ctx.randomInt(1, count) <= remainder) award += 1;
  return {id: target.id, captured: true, award, multiplier};
}

function clipStyle(target, baseBet, ctx) {
  if (target.tier === "small" || target.characterId === "original") return "classic";
  const special = [];
  if ((target.characterId === "mugi" || target.characterId === "jiayi") && baseBet >= 50) special.push("christmas");
  if (target.characterId === "eunbi" && baseBet >= 50) special.push("summer");
  if (target.characterId === "yeseul") {
    if (baseBet >= 20) special.push("halloween");
    if (baseBet >= 50 && target.tier === "large") special.push("summer");
  }
  if (special.length === 0) return "classic";
  const choice = ctx.randomInt(1, special.length * 2);
  return choice <= special.length ? "classic" : special[choice - special.length - 1];
}

function addSpend(profile, cost) {
  const cards = profile.cards;
  const room = Math.max(0, (RULES.maxStoredPacks - cards.drawsAvailable) * 1000 - cards.progress);
  const accepted = Math.min(cost, room);
  cards.creditedSpend += accepted;
  cards.ignoredSpend += cost - accepted;
  const total = cards.progress + accepted;
  const earned = Math.floor(total / 1000);
  cards.drawsEarned += earned;
  cards.drawsAvailable += earned;
  cards.progress = total % 1000;
}

function open(state, input, ctx) {
  if (!validState(state, ctx)) return reject(state, input, ctx, "invalidState", "The stored game state needs migration.");
  if (!currencyMatches(ctx)) return reject(state, input, ctx, "currencyMismatch", "This game requires 50 chips per red diamond.");
  const request = input === null || input === undefined ? {} : input;
  if (!onlyKeys(request, ["clientId", "mode"]) ||
      (request.clientId !== undefined && !validIdentifier(request.clientId)) ||
      (request.mode !== undefined && request.mode !== "demo" && request.mode !== "paid")) {
    return reject(state, input, ctx, "invalidRequest", "open accepts an optional stable clientId.");
  }
  if (!whole(ctx.chips, 0, RULES.maxWallet - RULES.maxBatchWin)) {
    return reject(state, input, ctx, "walletLimit", "The wallet exceeds this game's supported range.");
  }
  const clientId = request.clientId || "";
  const repeatedOpen = clientId !== "" && state.session > 0 && state.clientId === clientId;
  if (!repeatedOpen) {
    if (state.session === RULES.maxSequence) {
      return reject(state, input, ctx, "sessionLimit", "The game session counter needs migration.");
    }
    state.session += 1;
    state.clientId = clientId;
    state.sequence = 0;
    state.lastBatch = null;
    state.lastDraw = {demo: null, paid: null};
    state.drawSequence = {demo: 0, paid: 0};
    state.revision += 1;
  }
  return {
    state,
    result: {
      ok: true,
      session: state.session,
      sequence: state.sequence,
      revision: state.revision,
      demoBalance: state.demoBalance,
      balance: ctx.chips,
      rtp: RULES.rtpNumerator / RULES.rtpDenominator,
      rate: RULES.perDiamond,
      profile: state.profiles[request.mode || "paid"],
      profiles: state.profiles,
    },
    chips: {bet: 0, win: 0},
  };
}

function settle(state, input, ctx) {
  if (!validState(state, ctx)) return reject(state, input, ctx, "invalidState", "The stored game state needs migration.");
  if (!currencyMatches(ctx)) return reject(state, input, ctx, "currencyMismatch", "This game requires 50 chips per red diamond.");
  if (!onlyKeys(input, ["session", "batchId", "mode", "rounds", "roomId", "buildId"]) ||
      !whole(input.session, 1, RULES.maxSequence) || !whole(input.batchId, 1, RULES.maxSequence) ||
      (input.mode !== "demo" && input.mode !== "paid") ||
      ((input.roomId !== undefined || input.buildId !== undefined) &&
       (!directoryRoomId(input.roomId) || !directoryBuildId(input.buildId)))) {
    return reject(state, input, ctx, "invalidRequest", "Supply a session, sequential batchId, mode and rounds.");
  }
  if (input.session !== state.session || state.session === 0) {
    return reject(state, input, ctx, "staleSession", "Open the current game session before settling.");
  }
  const rounds = normalizedRounds(input);
  if (rounds === null) {
    return reject(state, input, ctx, "invalidRequest", "The bet, weapon or target selection is invalid.");
  }
  const inRoom = input.roomId !== undefined;
  const fingerprint = JSON.stringify({session: input.session, batchId: input.batchId, mode: input.mode, rounds,
    ...(inRoom ? {roomId: input.roomId, buildId: input.buildId} : {})});
  if (input.batchId === state.sequence) {
    if (!state.lastBatch || state.lastBatch.fingerprint !== fingerprint) {
      return reject(state, input, ctx, "requestConflict", "This batchId was already used with different input.");
    }
    return {state, result: state.lastBatch.result, chips: {bet: 0, win: 0}};
  }
  if (input.batchId !== state.sequence + 1) {
    return reject(state, input, ctx, "staleBatch", "Use the next batchId and retry an uncertain call with its original input.");
  }
  if (input.mode === "paid" && !ctx.currency) {
    return reject(state, input, ctx, "currencyUnavailable", "Paid mode requires the game's platform currency.");
  }
  const balance = input.mode === "demo" ? state.demoBalance : ctx.chips;
  if (!whole(balance, 0, RULES.maxWallet - RULES.maxBatchWin)) {
    return reject(state, input, ctx, "walletLimit", "The wallet exceeds this game's supported range.");
  }
  const boardContext = inRoom ? roomFieldContext(ctx, input.roomId, input.buildId) : null;
  if (boardContext && !boardContext.ok) return reject(state, input, ctx, boardContext.error, "Refresh the room before continuing.");
  if (boardContext && rounds.some(round => round.targets.some(target => !fieldTargetMatches(boardContext.field, target)))) {
    return reject(state, input, ctx, "fieldMismatch", "The target does not match this room's field.");
  }
  // Every target in a batch is rechecked against the same mutable room field.
  // A capture earlier in this batch also excludes that generation from later
  // rounds; platform shared-state CAS makes the same rule atomic across users.
  const initialEligible = round => !boardContext || round.targets.some(target => fieldTargetActive(boardContext.field, target.id, boardContext.elapsed));
  const maximumBet = rounds.reduce((sum, round) => sum + (initialEligible(round) ? round.bet * WEAPONS[round.weapon].cost : 0), 0);
  if (maximumBet > balance) {
    return reject(state, input, ctx, "insufficientFunds", "The wallet cannot cover this complete batch.");
  }
  const outcomes = [];
  const profile = clone(state.profiles[input.mode]);
  let win = 0, bet = 0, settledRounds = 0;
  for (const round of rounds) {
    const eligible = round.targets.map(target => !boardContext || fieldTargetActive(boardContext.field, target.id, boardContext.elapsed));
    const activeCount = eligible.filter(Boolean).length;
    if (activeCount === 0) {
      outcomes.push({roundId: round.roundId, cost: 0, refunded: true, targets: []});
      continue;
    }
    const cost = round.bet * WEAPONS[round.weapon].cost;
    bet += cost; settledRounds++;
    const targets = round.targets.map((target, index) => eligible[index]
      ? targetAward(target, cost, activeCount, ctx)
      : {id: target.id, captured: false, award: 0, multiplier: 0});
    for (let index = 0; index < targets.length; index++) {
      const outcome = targets[index];
      const target = round.targets[index];
      if (boardContext) outcome.eligible = eligible[index];
      outcome.styleId = outcome.captured ? clipStyle(target, round.bet, ctx) : "classic";
      outcome.clipId = outcome.captured && !(target.characterId === "original" && target.tier === "small")
        ? target.characterId + "-" + outcome.styleId + "-" + target.tier : null;
      if (outcome.clipId && !profile.unlockedClipIds.includes(outcome.clipId)) profile.unlockedClipIds.push(outcome.clipId);
      if (outcome.captured) profile.stats.captures += 1;
      if (outcome.captured && boardContext) captureFieldTarget(boardContext, target.id);
    }
    addSpend(profile, cost);
    profile.preferences = {bet: round.bet, weapon: round.weapon};
    win += targets.reduce((sum, target) => sum + target.award, 0);
    outcomes.push({roundId: round.roundId, cost, targets});
  }
  const after = balance - bet + win;
  profile.unlockedClipIds.sort();
  profile.stats.spent += bet;
  profile.stats.won += win;
  profile.stats.settledRounds += settledRounds;
  profile.revision += 1;
  const result = {
    ok: true,
    session: state.session,
    batchId: input.batchId,
    revision: state.revision + 1,
    mode: input.mode,
    balance: after,
    bet,
    win,
    rounds: outcomes,
    profile,
    ...(boardContext ? {board: fieldSnapshot(input.roomId, boardContext.field, boardContext.now)} : {}),
  };
  state.sequence = input.batchId;
  state.revision = result.revision;
  if (input.mode === "demo") state.demoBalance = after;
  state.profiles[input.mode] = profile;
  state.lastBatch = {fingerprint, result};
  return {state, result, chips: input.mode === "paid" ? {bet, win} : {bet: 0, win: 0},
    ...(boardContext && boardContext.changed ? {shared: fieldShared(ctx, boardContext)} : {})};
}

function profileRequest(state, input, ctx, allowed) {
  if (!validState(state, ctx)) return reject(state, input, ctx, "invalidState", "The stored game state needs migration.");
  if (!onlyKeys(input, allowed) || !whole(input.session, 1, RULES.maxSequence) ||
      (input.mode !== "demo" && input.mode !== "paid")) {
    return reject(state, input, ctx, "invalidRequest", "Supply the current session and profile mode.");
  }
  if (input.session !== state.session) return reject(state, input, ctx, "staleSession", "Open the current game session first.");
  return null;
}

function drawCards(state, input, ctx) {
  const invalid = profileRequest(state, input, ctx, ["session", "mode", "drawId"]);
  if (invalid) return invalid;
  if (!whole(input.drawId, 1, RULES.maxSequence)) return reject(state, input, ctx, "invalidRequest", "Supply a sequential drawId.");
  const fingerprint = JSON.stringify({session: input.session, mode: input.mode, drawId: input.drawId});
  if (input.drawId === state.drawSequence[input.mode]) {
    const cached = state.lastDraw && state.lastDraw[input.mode];
    if (!cached || cached.fingerprint !== fingerprint) {
      return reject(state, input, ctx, "requestConflict", "This drawId cannot be replayed.");
    }
    return {state, result: cached.result, chips: {bet: 0, win: 0}};
  }
  if (input.drawId !== state.drawSequence[input.mode] + 1) return reject(state, input, ctx, "staleDraw", "Use the next drawId.");
  const profile = clone(state.profiles[input.mode]);
  const cards = profile.cards;
  if (cards.drawsAvailable < 1) return reject(state, input, ctx, "noPacks", "There are no accumulated card packs.");
  const size = Math.min(cards.drawsAvailable, RULES.maxCardsPerDraw);
  const items = [];
  for (let index = 0; index < size; index++) {
    const roll = ctx.randomInt(1, 100);
    const rarity = roll <= 70 ? "N" : roll <= 95 ? "R" : "SR";
    const pool = CARD_POOLS[rarity];
    const cardId = pool[ctx.randomInt(0, pool.length - 1)];
    const previous = cards.counts[cardId] || 0;
    cards.counts[cardId] = previous + 1;
    cards.totalDraws += 1;
    items.push({serial: cards.totalDraws, cardId, isNew: previous === 0, count: previous + 1});
  }
  cards.drawsAvailable -= size;
  cards.lastBatch = {serial: (cards.lastBatch ? cards.lastBatch.serial : 0) + 1, size, items};
  profile.revision += 1;
  const result = {
    ok: true, session: state.session, drawId: input.drawId, mode: input.mode,
    revision: state.revision + 1,
    balance: input.mode === "demo" ? state.demoBalance : ctx.chips,
    profile, lastBatch: cards.lastBatch,
  };
  state.revision = result.revision;
  state.profiles[input.mode] = profile;
  state.drawSequence[input.mode] = input.drawId;
  state.lastDraw[input.mode] = {fingerprint, result};
  return {state, result, chips: {bet: 0, win: 0}};
}

function saveProgress(state, input, ctx) {
  const invalid = profileRequest(state, input, ctx, ["session", "mode", "expectedRevision", "watchedLargeClipIds", "skipSeenLargeVideos", "bet", "weapon"]);
  if (invalid) return invalid;
  const current = state.profiles[input.mode];
  if (input.expectedRevision !== undefined && input.expectedRevision !== current.revision) {
    return reject(state, input, ctx, "profileConflict", "Refresh the profile before saving these changes.");
  }
  if ((input.skipSeenLargeVideos !== undefined && typeof input.skipSeenLargeVideos !== "boolean") ||
      (input.bet !== undefined && !BETS.includes(input.bet)) ||
      (input.weapon !== undefined && (typeof input.weapon !== "string" || !own(WEAPONS, input.weapon)))) {
    return reject(state, input, ctx, "invalidRequest", "The saved preferences are invalid.");
  }
  if (input.watchedLargeClipIds !== undefined &&
      (!Array.isArray(input.watchedLargeClipIds) || input.watchedLargeClipIds.length > 23 ||
       input.watchedLargeClipIds.some(id => typeof id !== "string" || !id.endsWith("-large") || !current.unlockedClipIds.includes(id)))) {
    return reject(state, input, ctx, "invalidRequest", "Only unlocked large clips can be recorded as watched.");
  }
  const profile = clone(current);
  if (input.watchedLargeClipIds) {
    profile.watchedLargeClipIds = [...new Set(profile.watchedLargeClipIds.concat(input.watchedLargeClipIds))].sort();
  }
  if (input.skipSeenLargeVideos !== undefined) profile.skipSeenLargeVideos = input.skipSeenLargeVideos;
  if (input.bet !== undefined) profile.preferences.bet = input.bet;
  if (input.weapon !== undefined) profile.preferences.weapon = input.weapon;
  profile.revision += 1;
  state.revision += 1;
  state.profiles[input.mode] = profile;
  return {
    state,
    result: {
      ok: true, session: state.session, mode: input.mode, revision: state.revision,
      balance: input.mode === "demo" ? state.demoBalance : ctx.chips,
      profile,
    },
    chips: {bet: 0, win: 0},
  };
}

// Discovery leases complement the room runner's ephemeral WebSocket roster.
// They contain public identity only and never participate in wager settlement.
const ROOM_DIRECTORY = Object.freeze({
  protocol: "hc-rooms-v1", leaseMs: 45000, maxRooms: 16, maxPlayers: 3,
});
const ROOM_FIELD = Object.freeze({slotCount: 27, respawnMs: 1200, maxGeneration: 67108863});

function fieldParameters(seed, slot, generation) {
  const modulus = 2147483647;
  let value = (seed + slot * 104729 + generation * 13007) % modulus;
  if (value < 1) value += modulus - 1;
  const next = () => (value = value * 16807 % modulus);
  const unit = () => (next() - 1) / 2147483646;
  const direction = next() % 2 === 0 ? 1 : -1;
  const lane = -2.65 + unit() * 5.5;
  const phase = unit() * Math.PI * 2;
  const characterId = CHARACTERS[Math.floor(unit() * CHARACTERS.length)];
  const initialProgress = unit();
  return {direction, lane, phase, characterId, initialProgress,
    tier: slot <= 18 ? "small" : slot <= 24 ? "medium" : "large",
    durationMs: 40000 + slot % 7 * 4000};
}

function createRoomField(ctx, now, buildId) {
  const seed = ctx.randomInt(1, 2147483646);
  const slots = [];
  for (let slot = 1; slot <= ROOM_FIELD.slotCount; slot++) {
    const params = fieldParameters(seed, slot, 1);
    slots.push({generation: 1, bornMs: -Math.floor(params.initialProgress * params.durationMs)});
  }
  return {seed, buildId, createdAt: now, revision: 1, slots};
}

function validRoomField(field, now) {
  return isRecord(field) && whole(field.seed, 1, 2147483646) && whole(field.createdAt, 0, now) &&
    whole(field.revision, 1, Number.MAX_SAFE_INTEGER - 100) && Array.isArray(field.slots) &&
    field.slots.length === ROOM_FIELD.slotCount && field.slots.every(slot => isRecord(slot) &&
      whole(slot.generation, 1, ROOM_FIELD.maxGeneration) &&
      whole(slot.bornMs, -64000, now - field.createdAt + ROOM_FIELD.respawnMs));
}

function normalizeRoomField(field, now) {
  const elapsed = Math.max(0, now - field.createdAt);
  let changed = false;
  for (let index = 0; index < field.slots.length; index++) {
    const slot = field.slots[index], duration = 40000 + (index + 1) % 7 * 4000;
    const cycles = Math.floor((elapsed - slot.bornMs) / duration);
    if (cycles >= 1) {
      if (slot.generation + cycles > ROOM_FIELD.maxGeneration) return null;
      slot.generation += cycles; slot.bornMs += cycles * duration; changed = true;
    }
  }
  if (changed) field.revision++;
  return changed;
}

function fieldSnapshot(roomId, field, now) {
  return {protocol: ROOM_DIRECTORY.protocol, roomId, seed: field.seed, createdAt: field.createdAt,
    serverTime: now, elapsedMs: Math.max(0, now - field.createdAt), revision: field.revision,
    slots: field.slots.map(slot => ({generation: slot.generation, bornMs: slot.bornMs}))};
}

function roomFieldContext(ctx, roomId, buildId) {
  const now = Date.now(), leases = directoryLeases(ctx.shared, now);
  if (!leases.some(lease => lease.userId === ctx.player.id && lease.roomId === roomId && lease.buildId === buildId)) return {ok: false, error: "roomUnavailable"};
  const stored = isRecord(ctx.shared) && isRecord(ctx.shared.hotchickRooms) && isRecord(ctx.shared.hotchickRooms.fields)
    ? ctx.shared.hotchickRooms.fields : {};
  const value = own(stored, roomId) ? stored[roomId] : null;
  if (!validRoomField(value, now) || (value.buildId || ROOM_DIRECTORY.protocol) !== buildId) return {ok: false, error: "roomUnavailable"};
  const field = clone(value), changed = normalizeRoomField(field, now);
  if (changed === null) return {ok: false, error: "roomUnavailable"};
  return {ok: true, now, elapsed: Math.max(0, now - field.createdAt), roomId, leases, field, changed};
}

function fieldShared(ctx, context) {
  const shared = isRecord(ctx.shared) ? clone(ctx.shared) : {};
  const saved = isRecord(shared.hotchickRooms) && isRecord(shared.hotchickRooms.fields) ? shared.hotchickRooms.fields : {};
  const fields = {};
  for (const id of new Set(context.leases.map(lease => lease.roomId))) if (own(saved, id)) fields[id] = saved[id];
  fields[context.roomId] = context.field;
  shared.hotchickRooms = {schema: 1, leases: context.leases, fields};
  return shared;
}

function fieldTargetId(id) {
  if (typeof id !== "string" || !/^[1-9][0-9]{1,9}$/.test(id)) return null;
  const value = Number(id), slot = value % 32, generation = Math.floor(value / 32);
  return whole(value, 33, 2147483647) && whole(slot, 1, ROOM_FIELD.slotCount) &&
    whole(generation, 1, ROOM_FIELD.maxGeneration) ? {slot, generation} : null;
}

function fieldTargetMatches(field, target) {
  const id = fieldTargetId(target.id);
  if (!id || id.generation > field.slots[id.slot - 1].generation) return false;
  const params = fieldParameters(field.seed, id.slot, id.generation);
  return target.tier === params.tier && target.characterId === params.characterId;
}

function fieldTargetActive(field, targetId, elapsed) {
  const id = fieldTargetId(targetId);
  if (!id) return false;
  const slot = field.slots[id.slot - 1];
  return id.generation === slot.generation && elapsed >= slot.bornMs;
}

function captureFieldTarget(context, targetId) {
  const id = fieldTargetId(targetId), slot = context.field.slots[id.slot - 1];
  if (slot.generation >= ROOM_FIELD.maxGeneration) throw new RangeError("Room field generation exhausted");
  slot.generation++; slot.bornMs = context.elapsed + ROOM_FIELD.respawnMs;
  context.field.revision++; context.changed = true;
}

function roomSnapshot(state, input, ctx) {
  if (!onlyKeys(input, ["roomId", "buildId"]) || !directoryRoomId(input.roomId) || !directoryBuildId(input.buildId)) {
    return {state, result: {ok: false, error: {code: "invalidRequest", message: "Supply the current room ID."}}, chips: {bet: 0, win: 0}};
  }
  const context = roomFieldContext(ctx, input.roomId, input.buildId);
  if (!context.ok) return {state, result: {ok: false, error: {code: context.error, message: "Refresh the room before continuing."}}, chips: {bet: 0, win: 0}};
  return {state, result: {ok: true, board: fieldSnapshot(input.roomId, context.field, context.now)}, chips: {bet: 0, win: 0},
    ...(context.changed ? {shared: fieldShared(ctx, context)} : {})};
}

function directoryRoomId(value) {
  return typeof value === "string" && /^[A-Za-z0-9][A-Za-z0-9_-]{2,63}$/.test(value) && value !== "new";
}

function directoryBuildId(value) {
  return typeof value === "string" && value.length <= 64 && /^hc-rooms-v1(?::[A-Za-z0-9_.-]{1,48})?$/.test(value);
}

function directoryName(player) {
  const value = typeof player.displayName === "string" && player.displayName.trim()
    ? player.displayName : typeof player.username === "string" ? player.username : "玩家";
  return Array.from(value.replace(/[\u0000-\u001f\u007f-\u009f\u202a-\u202e\u2066-\u2069]/g, " ").trim()).slice(0, 24).join("") || "玩家";
}

function directoryLeases(shared, now) {
  const saved = isRecord(shared) && isRecord(shared.hotchickRooms) && shared.hotchickRooms.schema === 1
    ? shared.hotchickRooms.leases : null;
  if (!Array.isArray(saved)) return [];
  const latest = new Map();
  for (const lease of saved.slice(0, ROOM_DIRECTORY.maxRooms * ROOM_DIRECTORY.maxPlayers)) {
    if (!isRecord(lease) || !directoryBuildId(lease.buildId) || !directoryRoomId(lease.roomId) ||
        !validIdentifier(lease.userId) || typeof lease.name !== "string" || Array.from(lease.name).length > 24 ||
        !whole(lease.updatedAt, 0, Number.MAX_SAFE_INTEGER) || !whole(lease.expiresAt, 0, Number.MAX_SAFE_INTEGER) ||
        lease.updatedAt > now || lease.expiresAt <= now || lease.expiresAt > now + ROOM_DIRECTORY.leaseMs) continue;
    const previous = latest.get(lease.userId);
    if (!previous || previous.updatedAt < lease.updatedAt) latest.set(lease.userId, lease);
  }
  return [...latest.values()];
}

function directorySnapshot(leases, now, callerId, buildId) {
  const rooms = new Map();
  for (const lease of leases) {
    if (lease.buildId !== buildId) continue;
    let room = rooms.get(lease.roomId);
    if (!room) {
      if (rooms.size >= ROOM_DIRECTORY.maxRooms) continue;
      room = {id: lease.roomId, name: "心動房 " + lease.roomId.slice(-6).toUpperCase(),
        players: [], playerCount: 0, maxPlayers: ROOM_DIRECTORY.maxPlayers, updatedAt: 0};
      rooms.set(lease.roomId, room);
    }
    if (room.players.length >= ROOM_DIRECTORY.maxPlayers) continue;
    room.players.push({id: lease.userId, name: lease.name});
    room.playerCount = room.players.length;
    room.updatedAt = Math.max(room.updatedAt, lease.updatedAt);
  }
  const current = leases.find(lease => lease.userId === callerId && lease.buildId === buildId);
  return {ok: true, protocol: ROOM_DIRECTORY.protocol, serverTime: now,
    leaseMs: ROOM_DIRECTORY.leaseMs, maxPlayers: ROOM_DIRECTORY.maxPlayers,
    rooms: [...rooms.values()].sort((a, b) => b.updatedAt - a.updatedAt || a.id.localeCompare(b.id)),
    currentRoomId: current ? current.roomId : null};
}

function roomDirectory(state, input, ctx) {
  const noMoney = {bet: 0, win: 0};
  const invalid = (code, message) => ({state, result: {ok: false,
    protocol: ROOM_DIRECTORY.protocol, error: {code, message}}, chips: noMoney});
  if (!ctx.player || !validIdentifier(ctx.player.id)) return invalid("authenticationRequired", "A platform member is required.");
  if (!onlyKeys(input, ["op", "buildId", "roomId"]) || !directoryBuildId(input.buildId) ||
      !["list", "advertise", "leave"].includes(input.op) ||
      (input.op !== "list" && !directoryRoomId(input.roomId)) ||
      (input.roomId !== undefined && !directoryRoomId(input.roomId))) {
    return invalid("invalidRequest", "Supply a supported directory operation and room ID.");
  }
  const now = Date.now();
  let leases = directoryLeases(ctx.shared, now);
  if (input.op === "list") return {state, result: directorySnapshot(leases, now, ctx.player.id, input.buildId), chips: noMoney};
  if (input.op === "leave") {
    const next = leases.filter(lease => lease.userId !== ctx.player.id || lease.roomId !== input.roomId || lease.buildId !== input.buildId);
    if (next.length === leases.length) return {state, result: directorySnapshot(leases, now, ctx.player.id, input.buildId), chips: noMoney};
    leases = next;
  } else {
    // Remove only the authenticated caller's old lease. Another member's name,
    // seat, presence or balance can never be supplied in this request.
    const next = leases.filter(lease => lease.userId !== ctx.player.id);
    const occupants = next.filter(lease => lease.roomId === input.roomId);
    if (occupants.some(lease => lease.buildId !== input.buildId)) return invalid("roomUnavailable", "The room belongs to a different build.");
    if (occupants.length >= ROOM_DIRECTORY.maxPlayers) return invalid("roomFull", "The room is full.");
    const ids = new Set(next.map(lease => lease.roomId));
    if (!ids.has(input.roomId) && ids.size >= ROOM_DIRECTORY.maxRooms) return invalid("directoryFull", "The room list is currently full.");
    next.push({roomId: input.roomId, buildId: input.buildId, userId: ctx.player.id,
      name: directoryName(ctx.player), updatedAt: now, expiresAt: now + ROOM_DIRECTORY.leaseMs});
    leases = next;
  }
  const saved = isRecord(ctx.shared) && isRecord(ctx.shared.hotchickRooms) && isRecord(ctx.shared.hotchickRooms.fields)
    ? ctx.shared.hotchickRooms.fields : {};
  const fields = {};
  for (const id of new Set(leases.map(lease => lease.roomId))) if (own(saved, id) && validRoomField(saved[id], now)) fields[id] = clone(saved[id]);
  if (input.op === "advertise") {
    if (!own(fields, input.roomId)) fields[input.roomId] = createRoomField(ctx, now, input.buildId);
    if ((fields[input.roomId].buildId || ROOM_DIRECTORY.protocol) !== input.buildId) return invalid("roomUnavailable", "The room belongs to a different build.");
    if (normalizeRoomField(fields[input.roomId], now) === null) return invalid("fieldExpired", "Create a new room to continue.");
  }
  const shared = isRecord(ctx.shared) ? clone(ctx.shared) : {};
  shared.hotchickRooms = {schema: 1, leases, fields};
  const result = directorySnapshot(leases, now, ctx.player.id, input.buildId);
  if (input.op === "advertise") result.board = fieldSnapshot(input.roomId, fields[input.roomId], now);
  return {state, shared, result, chips: noMoney};
}

defineFunctions({init: initialState, open, settle, drawCards, saveProgress, roomDirectory, roomSnapshot});
