const MAX_BALANCE = 2 ** 40 - 1;
const MAX_PACKET_ID = 2 ** 31 - 1;
const MAX_BATCH_ROUNDS = 10;
const CALL_INTERVAL = 500;
const STYLES = ['classic', 'christmas', 'halloween', 'summer'];
const BETS = [1, 5, 10, 20, 50];
const WEAPONS = ['like', 'flower', 'rocket'];
const values = value => Array.isArray(value) ? value : Object.values(value || {});
const integer = (value, maximum = MAX_BALANCE) => Number.isSafeInteger(value) && value >= 0 && value <= maximum;

function clientIdentifier() {
  const bytes = new Uint32Array(4);
  globalThis.crypto.getRandomValues(bytes);
  return Array.from(bytes, value => value.toString(16).padStart(8, '0')).join('');
}

/** Transports platform outcomes through native input packets. Luau applies them. */
export function createGoldSaucerServer({
  sdk,
  setAction,
  onStatusChange = () => {},
  now = () => performance.now(),
  clientId = null,
} = {}) {
  const enabled = typeof sdk?.server?.call === 'function' && typeof sdk?.chips?.get === 'function';
  let disposed = false;
  let status = enabled ? 'connecting' : 'local';
  let latest = null;
  let mode = null;
  let preview = false;
  let session = null;
  let serverBalance = 0;
  let nextBatchId = 1;
  let nextPacketId = 1;
  let activePacket = null;
  let currentBatch = null;
  let callInFlight = false;
  let walletBusy = false;
  let walletGate = null;
  let walletRefresh = false;
  let drainingRejected = false;
  let terminalRejection = null;
  let connectingHeld = false;
  let lastCallAt = -Infinity;
  let nextAttemptAt = 0;
  let lastError = null;
  let currencyName = '心動幣';
  let startPromise = null;
  let profileReady = false;
  let savedProgressRevision = 0;
  let savedProgressFingerprint = null;
  let observedProgressFingerprint = null;
  let progressChangedAt = 0;
  let auxiliary = null;
  let roomContext = null;
  let activeRoomCall = null;
  let lastRoomCallAt = -Infinity;
  let latestRoomBoard = null;
  let roomError = null;
  const roomCalls = [];
  const roomFieldListeners = new Set();
  const roomErrorListeners = new Set();
  let confirmedWalletBalance = null;
  let walletEventSerial = 0;
  const unmatchedWalletEvents = [];
  const expectedWalletEchoes = [];
  const packets = [];
  const held = new Set();
  const subscriptions = [];

  function setConnecting(down) {
    if (connectingHeld === down) return;
    connectingHeld = down;
    setAction?.('GSConnecting', down);
  }

  function nativeIsBusy() {
    return !latest || Number(latest.reservedWager) > 0 || Number(latest.pendingWin) > 0 ||
      values(latest.platform?.requests).length > 0 || Boolean(latest.platform?.cardDrawPending);
  }

  function metadata() {
    const ready = status === 'ready' && !connectingHeld;
    return {
      enabled, status, ready, mode, preview, session, lastError, profileReady,
      balanceSynchronized: profileReady && status !== 'error' && !terminalRejection && !currentBatch?.fatal,
      exchangeRate: 50, exchangeAvailable: enabled && ready && mode === 'paid',
      currencyName, serverBalance, pendingRounds: values(latest?.platform?.requests).length,
      pendingPackets: packets.length + Number(Boolean(activePacket)),
      walletBusy, canUseWallet: ready && mode === 'paid' && !walletBusy && !callInFlight &&
        !currentBatch && !activePacket && packets.length === 0 && !nativeIsBusy(),
      walletRefreshPending: walletRefresh,
      roomContext: roomContext ? {...roomContext} : null,
      roomCallsPending: roomCalls.length, roomError,
    };
  }

  function notify() {
    if (!disposed) onStatusChange(metadata());
  }

  function rejectRoomCalls(code) {
    for (const operation of roomCalls.splice(0)) operation.reject(Object.assign(new Error(code), {code}));
    activeRoomCall = null;
  }

  function publishRoomBoard(board) {
    if (!board || !roomContext || board.roomId !== roomContext.roomId) return;
    if (latestRoomBoard?.roomId === board.roomId && latestRoomBoard.seed === board.seed &&
        Number(board.revision) < Number(latestRoomBoard.revision)) return;
    latestRoomBoard = board;
    for (const listener of roomFieldListeners) {
      try { listener(board); } catch { /* A presentation subscriber cannot change settlement. */ }
    }
  }

  function reportRoomError(code) {
    roomError = code;
    for (const listener of roomErrorListeners) {
      try { listener(code); } catch { /* Preserve financial receipts even if UI fails. */ }
    }
    notify();
  }

  function isIdleForRoomSwitch() {
    return enabled && profileReady && status === 'ready' && !connectingHeld &&
      !callInFlight && !walletBusy && !walletRefresh && !currentBatch && !auxiliary &&
      !activePacket && packets.length === 0 && roomCalls.length === 0 && !nativeIsBusy();
  }

  function setRoomContext(context) {
    // A wallet-only refresh can arrive between the native board commit and its
    // ACK. It changes no target intent; permit it without stranding the new
    // board under the old room context. Accepted wagers/profile writes still
    // have to finish, and the controller independently waits for a fresh gate.
    const financialDrained = enabled && profileReady && status !== 'error' && !currentBatch && !auxiliary &&
      !nativeIsBusy() && (!activePacket || activePacket.kind === 3) && packets.every(packet => packet.kind === 3);
    if (!financialDrained) throw Object.assign(new Error('room-switch-not-drained'), {code:'room-switch-not-drained'});
    if (context !== null && (!context || typeof context.roomId !== 'string' ||
        !/^[A-Za-z0-9_-]{1,96}$/.test(context.roomId) || typeof context.buildId !== 'string' ||
        !/^[A-Za-z0-9_.:-]{1,64}$/.test(context.buildId))) throw new Error('room-context-invalid');
    roomContext = context ? {roomId:context.roomId, buildId:context.buildId} : null;
    latestRoomBoard = null;
    roomError = null;
    notify();
  }

  function roomCall(method, input) {
    if (disposed || !enabled || status === 'error') return Promise.reject(new Error('room-connection-unavailable'));
    if (!['roomDirectory','roomSnapshot'].includes(method) || !input || typeof input !== 'object' ||
        Array.isArray(input) || new TextEncoder().encode(JSON.stringify(input)).length > 8192) {
      return Promise.reject(new Error('room-request-invalid'));
    }
    if (roomCalls.length >= 16) return Promise.reject(new Error('room-queue-full'));
    const immutableInput = JSON.parse(JSON.stringify(input));
    return new Promise((resolve,reject) => {
      roomCalls.push({method,input:immutableInput,resolve,reject,attempts:0,retryAt:0});
      notify();
      considerRequests();
    });
  }

  async function submitRoomCall(operation) {
    if (disposed || callInFlight || !roomCalls.includes(operation)) return;
    activeRoomCall = operation;
    callInFlight = true;
    const eventStart = walletEventSerial;
    lastCallAt = now();
    lastRoomCallAt = lastCallAt;
    operation.attempts++;
    try {
      const response = await sdk.server.call(operation.method, operation.input);
      if (disposed || activeRoomCall !== operation) return;
      confirmWalletReply(response, serverBalance, eventStart);
      const result = response?.result;
      if (!result || result.ok !== true) {
        const code = result?.error?.code || 'room-response-invalid';
        const error = Object.assign(new Error(result?.error?.message || code), {code});
        roomCalls.splice(roomCalls.indexOf(operation),1);
        operation.reject(error);
        if (operation.method === 'roomSnapshot') reportRoomError(code);
        return;
      }
      roomCalls.splice(roomCalls.indexOf(operation),1);
      roomError = null;
      if (result.board) publishRoomBoard(result.board);
      operation.resolve(result);
    } catch (error) {
      if (disposed || activeRoomCall !== operation) return;
      if (operation.attempts >= 5) {
        roomCalls.splice(roomCalls.indexOf(operation),1);
        operation.reject(error);
        if (operation.method === 'roomSnapshot') reportRoomError(String(error?.code || 'room-sync-failed'));
      } else {
        operation.retryAt = now() + Math.min(3000, 500 * operation.attempts);
      }
    } finally {
      if (activeRoomCall === operation) activeRoomCall = null;
      callInFlight = false;
      notify();
    }
  }

  function observeWalletEvent(event) {
    if (disposed || mode === 'demo') return;
    const balance = event?.chips;
    const serial = ++walletEventSerial;
    if (!integer(balance)) { walletRefresh = true; notify(); return; }
    if (mode === null) {
      unmatchedWalletEvents.push({balance, serial});
      if (unmatchedWalletEvents.length > 128) { unmatchedWalletEvents.shift(); walletRefresh = true; }
      return;
    }
    // The platform emits one chipsChanged for each server.call response. Match
    // those echoes individually so a delayed old echo cannot replace the wallet.
    const echo = expectedWalletEchoes.indexOf(balance);
    if (echo >= 0) { expectedWalletEchoes.splice(echo, 1); return; }
    if (callInFlight) {
      unmatchedWalletEvents.push({balance, serial});
      if (unmatchedWalletEvents.length > 128) {
        unmatchedWalletEvents.shift();
        walletRefresh = true;
      }
      return;
    }
    if (balance !== confirmedWalletBalance) { walletRefresh = true; notify(); }
  }

  function confirmWalletReply(response, bookBalance, eventStart) {
    if (mode !== 'paid') return;
    if (!integer(response?.chips)) { walletRefresh = true; return; }
    const balance = response.chips;
    confirmedWalletBalance = balance;
    const echo = unmatchedWalletEvents.findIndex(event => event.serial > eventStart && event.balance === balance);
    if (echo >= 0) unmatchedWalletEvents.splice(echo, 1);
    else {
      expectedWalletEchoes.push(balance);
      if (expectedWalletEchoes.length > 128) expectedWalletEchoes.shift();
    }
    // Different-valued events can be external deposits/withdrawals, even when
    // they arrive inside our own RPC. Retain them for a safe idle reconciliation.
    for (const event of unmatchedWalletEvents.splice(0)) {
      if (event.balance !== balance) walletRefresh = true;
    }
    if (balance !== bookBalance) walletRefresh = true;
  }

  function fail(code) {
    if (disposed) return;
    releasePacket();
    walletGate?.(false);
    walletGate = null;
    packets.length = 0;
    lastError = code;
    status = 'error';
    rejectRoomCalls(code);
    setConnecting(true);
    notify();
  }

  function releasePacket() {
    for (const action of held) setAction?.(action, false);
    held.clear();
    activePacket = null;
  }

  function holdField(name, value, width) {
    if (!integer(value, 2 ** width - 1)) throw new Error('packet-value-out-of-range');
    for (let bit = 0; bit < width; bit++) {
      if (Math.floor(value / 2 ** bit) % 2 === 0) continue;
      const action = `${name}Bit${bit}`;
      held.add(action);
      setAction?.(action, true);
    }
  }

  function sendNextPacket() {
    if (disposed || activePacket || packets.length === 0 || status === 'error') return;
    if (packets[0].kind === 4 && (!values(latest?.platform?.cardIds).length || !values(latest?.platform?.clipIds).length)) return;
    const packet = packets.shift();
    if (nextPacketId > MAX_PACKET_ID) { fail('packet-sequence-exhausted'); return; }
    activePacket = {...packet, packetId: nextPacketId++};
    try {
      holdField('GSPacketId', activePacket.packetId, 31);
      holdField('GSKind', packet.kind, 3);
      holdField('GSRound', packet.roundId || 0, 31);
      holdField('GSBalance', packet.balance, 40);
      holdField('GSMode', mode === 'paid' ? 1 : 0, 1);
      for (let index = 0; index < 6; index++) {
        holdField(`GSWin${index}`, packet.targets?.[index]?.award || 0, 20);
        holdField(`GSMult${index}`, packet.targets?.[index]?.multiplier || 0, 8);
        holdField(`GSStyle${index}`, Math.max(0, STYLES.indexOf(packet.targets?.[index]?.styleId || 'classic')), 2);
      }
      if (packet.activeMask !== undefined) {
        holdField('GSActiveMask', packet.activeMask, 6);
        held.add('GSActiveMaskPresent');
        setAction?.('GSActiveMaskPresent', true);
      }
      if (packet.kind === 4) holdProfile(packet);
      held.add('GSReady');
      setAction?.('GSReady', true);
    } catch (error) {
      releasePacket();
      fail(error.message);
    }
  }

  function profileMask(ids, catalog) {
    let mask = 0;
    for (const id of new Set(ids || [])) {
      const index = catalog.indexOf(id);
      if (index < 0 || index >= 32) throw new Error('profile-clip-invalid');
      mask += 2 ** index;
    }
    return mask;
  }

  function holdProfile(packet) {
    const profile = packet.profile;
    const cards = profile?.cards;
    if (!cards || !profile.preferences || !profile.stats) throw new Error('profile-invalid');
    const cardIds = values(latest.platform.cardIds);
    const clipIds = values(latest.platform.clipIds);
    if (cardIds.length !== 14 || clipIds.length > 32) throw new Error('profile-catalog-invalid');
    holdField('GSProfileRevision', profile.revision, 31);
    holdField('GSDrawAck', packet.drawAck || 0, 31);
    holdField('GSProgressAck', packet.progressAck || 0, 31);
    holdField('GSPacks', cards.drawsAvailable, 14);
    holdField('GSProgress', cards.progress, 10);
    holdField('GSEarned', cards.drawsEarned, 32);
    holdField('GSUsed', cards.totalDraws, 32);
    holdField('GSCredited', cards.creditedSpend, 40);
    holdField('GSIgnored', cards.ignoredSpend, 40);
    holdField('GSProfileSpent', profile.stats.spent, 40);
    for (let index = 0; index < cardIds.length; index++) {
      holdField(`GSCard${index}`, cards.counts[cardIds[index]] || 0, 32);
    }
    holdField('GSUnlocked', profileMask(profile.unlockedClipIds, clipIds), 32);
    holdField('GSWatched', profileMask(profile.watchedLargeClipIds, clipIds), 32);
    holdField('GSSkip', profile.skipSeenLargeVideos ? 1 : 0, 1);
    const betIndex = BETS.indexOf(profile.preferences.bet);
    const weaponIndex = WEAPONS.indexOf(profile.preferences.weapon);
    if (betIndex < 0 || weaponIndex < 0) throw new Error('profile-preference-invalid');
    holdField('GSBet', betIndex + 1, 3);
    holdField('GSWeapon', weaponIndex, 2);
    const batch = cards.lastBatch;
    const items = batch ? values(batch.items) : [];
    if (items.length > 10 || items.length !== (batch?.size || 0)) throw new Error('profile-batch-invalid');
    holdField('GSBatchSize', items.length, 4);
    holdField('GSBatchSerial', batch?.serial || 0, 31);
    holdField('GSBatchStart', items[0]?.serial || 0, 32);
    for (let index = 0; index < 10; index++) {
      const item = items[index];
      const cardIndex = item ? cardIds.indexOf(item.cardId) + 1 : 0;
      if (item && cardIndex === 0) throw new Error('profile-card-invalid');
      holdField(`GSBatchCard${index}`, cardIndex, 4);
      holdField(`GSBatchOwned${index}`, item?.count || 0, 32);
      holdField(`GSBatchNew${index}`, item?.isNew ? 1 : 0, 1);
      if (item && item.serial !== items[0].serial + index) throw new Error('profile-batch-sequence-invalid');
    }
  }

  function progressFromProfile(profile) {
    return {
      watchedLargeClipIds: [...(profile.watchedLargeClipIds || [])].sort(),
      skipSeenLargeVideos: Boolean(profile.skipSeenLargeVideos),
      bet: profile.preferences.bet, weapon: profile.preferences.weapon,
    };
  }

  function nativeProgress() {
    const progress = latest?.platform?.progress;
    if (!progress) return null;
    return {watchedLargeClipIds: values(progress.watchedLargeClipIds).sort(),
      skipSeenLargeVideos: Boolean(progress.skipSeenLargeVideos), bet: progress.bet, weapon: progress.weapon};
  }

  function queueProfile(profile, balance, {drawAck = 0, progressAck = savedProgressRevision} = {}) {
    if (!profile) throw new Error('profile-missing');
    savedProgressFingerprint = JSON.stringify(progressFromProfile(profile));
    queuePacket({kind: 4, profile, balance, drawAck, progressAck});
  }

  function queuePacket(packet) {
    packets.push(packet);
    sendNextPacket();
    notify();
  }

  async function refreshWallet() {
    if (disposed || callInFlight || currentBatch || activePacket || packets.length || nativeIsBusy()) return;
    walletRefresh = false;
    walletBusy = true;
    status = 'syncing';
    setConnecting(true);
    notify();
    let queued = false;
    try {
      // Wait for a new native frame to close the fire gate. A shot may have
      // reserved funds since the observation which requested this refresh.
      const gated = await new Promise(resolve => { walletGate = resolve; });
      if (disposed) return;
      if (!gated) { walletRefresh = true; return; }
      const result = await sdk.chips.get();
      if (disposed) return;
      // Never send a wallet replacement while a late in-flight round exists.
      // Release the gate, let its normal receipt drain, then read again.
      if (nativeIsBusy() || currentBatch || activePacket || packets.length) {
        walletRefresh = true;
        return;
      }
      if (!integer(result?.chips)) throw new Error('wallet-balance-invalid');
      if (result.currency?.perDiamond !== 50) throw new Error('currency-rate-mismatch');
      confirmedWalletBalance = result.chips;
      currencyName = typeof result.currency.name === 'string' ? result.currency.name : '心動幣';
      queuePacket({kind: 3, balance: result.chips});
      queued = status !== 'error';
    } catch (error) {
      if (!disposed) fail(error?.code || error?.message || 'wallet-read-failed');
    } finally {
      walletBusy = false;
      if (!disposed && !queued && status !== 'error') {
        status = 'ready';
        setConnecting(false);
      }
      notify();
    }
  }

  function validateSuccess(result, batch, response) {
    if (!result || result.ok !== true || result.session !== session || result.batchId !== batch.input.batchId ||
        !integer(result.balance) || !Array.isArray(result.rounds) || result.rounds.length !== batch.input.rounds.length) {
      throw new Error('settlement-response-invalid');
    }
    let balance = batch.startBalance;
    let totalBet = 0;
    let totalWin = 0;
    const receipts = [];
    for (let index = 0; index < result.rounds.length; index++) {
      const response = result.rounds[index];
      const request = batch.input.rounds[index];
      if (response.roundId !== request.roundId || !integer(response.cost) || !Array.isArray(response.targets)) {
        throw new Error('settlement-round-invalid');
      }
      if (response.refunded === true) {
        if (!batch.input.roomId || response.cost !== 0 || response.targets.length !== 0) throw new Error('settlement-refund-invalid');
        receipts.push({kind:2,roundId:request.roundId,balance});
        continue;
      }
      const expectedCost = request.bet * ({like:1,flower:6,rocket:15}[request.weapon]);
      if (response.cost !== expectedCost || response.targets.length !== request.targets.length) throw new Error('settlement-round-invalid');
      let win = 0;
      let activeMask = 0;
      for (let target = 0; target < response.targets.length; target++) {
        const award = response.targets[target];
        if (award.id !== request.targets[target].id || !integer(award.award, 2 ** 20 - 1) ||
            !integer(award.multiplier, 240) || Boolean(award.captured) !== (award.multiplier > 0) ||
            (award.captured && !STYLES.includes(award.styleId))) {
          throw new Error('settlement-target-invalid');
        }
        if (award.eligible === false) {
          if (!batch.input.roomId || award.captured || award.award !== 0 || award.multiplier !== 0) throw new Error('settlement-ineligible-target-invalid');
        } else {
          if (award.eligible !== undefined && award.eligible !== true) throw new Error('settlement-target-invalid');
          activeMask += 2 ** target;
        }
        win += award.award;
      }
      if (activeMask === 0) throw new Error('settlement-empty-targets-invalid');
      balance = balance - response.cost + win;
      if (!integer(balance)) throw new Error('settlement-balance-invalid');
      totalBet += response.cost;
      totalWin += win;
      receipts.push({kind: 1, roundId: request.roundId, balance, targets: response.targets,
        ...(batch.input.roomId ? {activeMask} : {})});
    }
    // A concurrent external wallet change may alter the server's starting
    // balance. Native receipts still apply only this batch's delta; replace the
    // wallet later, once all local reservations and visual credits have drained.
    const externalWalletDelta = mode === 'paid' && response?.chips === result.balance;
    if ((balance !== result.balance && !externalWalletDelta) || totalBet !== result.bet || totalWin !== result.win) {
      throw new Error('settlement-total-mismatch');
    }
    return receipts;
  }

  async function submitBatch(batch) {
    if (disposed || callInFlight) return;
    callInFlight = true;
    const eventStart = walletEventSerial;
    lastCallAt = now();
    status = batch.attempts > 0 ? 'retrying' : 'settling';
    batch.attempts++;
    notify();
    try {
      const response = await sdk.server.call('settle', batch.input);
      if (disposed || currentBatch !== batch) return;
      const result = response?.result;
      if (result?.ok === false) {
        const code = result.error?.code;
        // staleSession names the server's *current* session, so the mismatch is
        // the rejection's cause rather than a malformed response.
        if ((result.session !== session && code !== 'staleSession') || result.batchId !== batch.input.batchId) {
          throw new Error('settlement-rejection-invalid');
        }
        batch.rejected = true;
        batch.fatal = !['insufficientFunds','roomUnavailable'].includes(result.error?.code);
        lastError = result.error?.code || 'settlement-rejected';
        confirmWalletReply(response, batch.startBalance, eventStart);
        // A known rejection has no platform ledger effect. Release each reservation
        // before reconciling any wallet changes made outside this game instance.
        setConnecting(true);
        status = 'refunding';
        for (const round of batch.input.rounds) {
          queuePacket({kind: 2, roundId: round.roundId, balance: batch.startBalance});
        }
        batch.responded = true;
        if (code === 'roomUnavailable') reportRoomError(code);
        return;
      }
      const receipts = validateSuccess(result, batch, response);
      const bookBalance = receipts[receipts.length - 1].balance;
      confirmWalletReply(response, bookBalance, eventStart);
      batch.responded = true;
      batch.board = result.board || null;
      nextBatchId++;
      lastError = null;
      for (const receipt of receipts) queuePacket(receipt);
      queueProfile(result.profile, bookBalance);
    } catch (error) {
      if (disposed || currentBatch !== batch) return;
      const code = String(error?.code || error?.message || 'settlement-call-failed');
      if (code.startsWith('settlement-') && code !== 'settlement-call-failed') {
        fail(code);
      } else {
        // The response may have been lost after commit. Keep the immutable intent.
        lastError = code;
        status = 'retrying';
        nextAttemptAt = now() + Math.min(5000, 750 * batch.attempts);
      }
    } finally {
      callInFlight = false;
      notify();
    }
  }

  function finishBatch() {
    if (status === 'error' || !currentBatch?.responded || activePacket || packets.length) return;
    const batch = currentBatch;
    currentBatch = null;
    if (batch.board) publishRoomBoard(batch.board);
    if (batch.fatal) {
      terminalRejection = lastError || 'settlement-rejected';
      drainingRejected = true;
      status = 'refunding';
      notify();
      return;
    }
    status = 'ready';
    if (batch.rejected && mode === 'paid') {
      drainingRejected = true;
      walletRefresh = true;
    }
    else setConnecting(false);
    notify();
  }

  async function submitAuxiliary(operation) {
    if (disposed || callInFlight) return;
    callInFlight = true;
    const eventStart = walletEventSerial;
    lastCallAt = now();
    operation.attempts++;
    status = operation.attempts > 1 ? 'retrying' : 'saving';
    notify();
    try {
      const response = await sdk.server.call(operation.method, operation.input);
      if (disposed || auxiliary !== operation) return;
      const result = response?.result;
      const emptyDraw = operation.method === 'drawCards' && result?.error?.code === 'noPacks';
      if (!result || (result.ok !== true && !emptyDraw) || result.session !== session || !result.profile || !integer(result.balance)) {
        fail(result?.error?.code || 'profile-response-invalid');
        return;
      }
      if (operation.method === 'drawCards' && result.drawId !== operation.input.drawId) {
        fail('draw-response-invalid'); return;
      }
      operation.responded = true;
      lastError = emptyDraw ? 'noPacks' : null;
      confirmWalletReply(response, serverBalance, eventStart);
      if (operation.method === 'saveProgress') savedProgressRevision = operation.progressAck;
      queueProfile(result.profile, serverBalance, {
        drawAck: operation.method === 'drawCards' ? operation.input.drawId : 0,
        progressAck: savedProgressRevision,
      });
    } catch (error) {
      if (disposed || auxiliary !== operation) return;
      lastError = String(error?.code || error?.message || 'profile-call-failed');
      status = 'retrying';
      nextAttemptAt = now() + Math.min(5000, 750 * operation.attempts);
    } finally {
      callInFlight = false;
      notify();
    }
  }

  function considerAuxiliary() {
    if (auxiliary) {
      if (auxiliary.responded && !activePacket && packets.length === 0) {
        auxiliary = null;
        status = 'ready';
        setConnecting(false);
        notify();
      } else if (!auxiliary.responded && !callInFlight && now() >= nextAttemptAt && now() - lastCallAt >= CALL_INTERVAL) {
        void submitAuxiliary(auxiliary);
      }
      return true;
    }
    const drawId = Number(latest?.platform?.cardDrawRequest || 0);
    if (latest?.platform?.cardDrawPending && integer(drawId, MAX_PACKET_ID) && drawId > 0) {
      auxiliary = {method: 'drawCards', input: {session, mode, drawId}, attempts: 0, responded: false};
      void submitAuxiliary(auxiliary);
      return true;
    }
    const progress = nativeProgress();
    if (!progress || !profileReady) return false;
    const fingerprint = JSON.stringify(progress);
    if (observedProgressFingerprint !== fingerprint) {
      observedProgressFingerprint = fingerprint;
      progressChangedAt = now();
    }
    if (fingerprint === savedProgressFingerprint || now() - progressChangedAt < 1000) return false;
    auxiliary = {method: 'saveProgress', input: {session, mode, ...progress},
      progressAck: Number(latest.platform.progressRevision || 0), attempts: 0, responded: false};
    void submitAuxiliary(auxiliary);
    return true;
  }

  function considerRequests() {
    if (disposed || !enabled || status === 'error' || !session || walletBusy) return;
    if (currentBatch) {
      if (!currentBatch.responded && !callInFlight && now() >= nextAttemptAt && now() - lastCallAt >= CALL_INTERVAL) {
        void submitBatch(currentBatch);
      }
      return;
    }
    if (callInFlight || activePacket || packets.length) return;
    if (auxiliary) { considerAuxiliary(); return; }
    if (drainingRejected) {
      const rejected = values(latest?.platform?.requests);
      if (rejected.length) {
        for (const request of rejected) queuePacket({kind: 2, roundId: request.roundId, balance: serverBalance});
        return;
      }
      if (Number(latest?.reservedWager) > 0) return;
      drainingRejected = false;
      if (terminalRejection) { fail(terminalRejection); return; }
    }
    if (walletRefresh && mode === 'paid' && !nativeIsBusy()) { void refreshWallet(); return; }
    if (connectingHeld) return;
    const requests = values(latest?.platform?.requests).slice(0, MAX_BATCH_ROUNDS);
    if (now() - lastCallAt < CALL_INTERVAL) return;
    const roomOperation = roomCalls.find(operation => now() >= operation.retryAt);
    if (roomOperation && (requests.length === 0 || now() - lastRoomCallAt >= 1000)) {
      void submitRoomCall(roomOperation);
      return;
    }
    if (requests.length === 0) { considerAuxiliary(); return; }
    const candidates = requests.map(request => ({
      roundId: request.roundId, weapon: request.weapon, bet: request.bet,
      targets: values(request.targets).map(target => ({id: target.id, tier: target.tier, characterId: target.characterId})),
    }));
    const rounds = [];
    for (const candidate of candidates) {
      const input = {session, batchId: nextBatchId, mode, rounds: [...rounds, candidate], ...(roomContext || {})};
      if (new TextEncoder().encode(JSON.stringify(input)).length > 8192) break;
      rounds.push(candidate);
    }
    if (!rounds.length) { fail('settlement-input-too-large'); return; }
    currentBatch = {input: {session, batchId: nextBatchId, mode, rounds, ...(roomContext || {})}, startBalance: serverBalance,
      attempts: 0, responded: false, rejected: false, fatal: false};
    void submitBatch(currentBatch);
  }

  async function start() {
    if (!enabled || disposed) return metadata();
    if (startPromise) return startPromise;
    startPromise = (async () => {
      try {
        const identifier = clientId || clientIdentifier();
        if (typeof sdk.on === 'function') {
          const unsubscribe = sdk.on('chipsChanged', observeWalletEvent);
          if (typeof unsubscribe === 'function') subscriptions.push(unsubscribe);
        }
        const eventStart = walletEventSerial;
        lastCallAt = now();
        const response = await sdk.server.call('open', {clientId: identifier});
        if (disposed) return metadata();
        const result = response?.result;
        if (!integer(result?.session, MAX_PACKET_ID) || result.session === 0 || result.rate !== 50 ||
            !integer(result.sequence, MAX_PACKET_ID)) throw new Error('server-open-invalid');
        session = result.session;
        nextBatchId = result.sequence + 1;
        preview = response.preview === true;
        mode = preview ? 'demo' : 'paid';
        const balance = preview ? result.demoBalance : result.balance;
        if (!integer(balance)) throw new Error('server-open-balance-invalid');
        status = 'bootstrap';
        if (!preview) confirmWalletReply(response, balance, eventStart);
        else unmatchedWalletEvents.length = 0;
        queuePacket({kind: 0, balance});
        queueProfile(result.profiles?.[mode] || result.profile, balance, {progressAck: 0});
        if (typeof sdk.on === 'function') {
          const userUnsubscribe = sdk.on('userChanged', () => fail('account-changed-reload'));
          if (typeof userUnsubscribe === 'function') subscriptions.push(userUnsubscribe);
        }
      } catch (error) {
        if (!disposed) fail(error?.code || error?.message || 'server-open-failed');
      }
      return metadata();
    })();
    return startPromise;
  }

  async function useWallet(method) {
    if (!metadata().canUseWallet) return {ok: false, reason: 'wallet-busy'};
    walletBusy = true;
    setConnecting(true);
    notify();
    try {
      // A click can race the latest rendered shooting frame. Wait until Luau has
      // observed the fire gate, then cancel if a reservation appeared meanwhile.
      const gated = await new Promise(resolve => { walletGate = resolve; });
      if (!gated || disposed) return {ok:false, reason:'wallet-busy'};
      const response = await sdk.chips[method]();
      if (disposed) return {ok: false};
      // Always read the platform ledger after its own confirmation dialog closes.
      walletRefresh = true;
      return response;
    } catch (error) {
      if (!disposed) lastError = String(error?.code || 'wallet-operation-failed');
      return {ok: false};
    } finally {
      walletBusy = false;
      if (!disposed) { setConnecting(false); notify(); }
    }
  }

  if (enabled) setConnecting(true);
  return {
    enabled, start, metadata, fail, roomCall, setRoomContext, isIdleForRoomSwitch,
    onRoomField(listener) {
      roomFieldListeners.add(listener);
      if (latestRoomBoard) listener(latestRoomBoard);
      return () => roomFieldListeners.delete(listener);
    },
    onRoomError(listener) {
      roomErrorListeners.add(listener);
      return () => roomErrorListeners.delete(listener);
    },
    reassert() {
      if (disposed || !enabled) return;
      if (connectingHeld) setAction?.('GSConnecting', true);
      for (const action of held) setAction?.(action, true);
    },
    buyIn: () => useWallet('buyIn'),
    cashOut: () => useWallet('cashOut'),
    sync(state) {
      if (disposed || !enabled) return;
      latest = state;
      if (walletGate && state?.platform?.connecting === true) {
        const resolve = walletGate;
        walletGate = null;
        resolve(!nativeIsBusy() && !currentBatch && !activePacket && packets.length === 0);
      }
      if (activePacket && state?.platform?.packetAck === activePacket.packetId) {
        const applied = activePacket;
        releasePacket();
        if (state.platform.packetError) { fail(String(state.platform.packetError)); return; }
        serverBalance = applied.balance;
        if (applied.kind === 0) {
          status = 'profile';
        } else if (applied.kind === 3) {
          status = 'ready';
          setConnecting(false);
        } else if (applied.kind === 4) {
          profileReady = true;
          status = 'ready';
          setConnecting(false);
        }
        sendNextPacket();
        finishBatch();
        notify();
      }
      if (!activePacket) sendNextPacket();
      considerRequests();
    },
    dispose() {
      if (disposed) return;
      disposed = true;
      rejectRoomCalls('room-connection-disposed');
      roomFieldListeners.clear();
      roomErrorListeners.clear();
      walletGate?.(false);
      walletGate = null;
      releasePacket();
      setConnecting(false);
      packets.length = 0;
      for (const unsubscribe of subscriptions) {
        try { unsubscribe(); } catch { /* Continue releasing other subscriptions. */ }
      }
      status = 'disposed';
    },
  };
}
