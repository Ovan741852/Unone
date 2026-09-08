// A browser clock is a presentation signal, not the simulation clock.
// Accumulate elapsed wall time and consume bounded fixed-size simulation steps.
// One wake owns both its RAF and watchdog, so a late RAF cannot run a second
// tick after the watchdog has already taken over.

export const DEFAULT_STEP_MS = 1000 / 60;
export const DEFAULT_MAX_CATCH_UP_STEPS = 5;
export const DEFAULT_WATCHDOG_MS = DEFAULT_STEP_MS * 2;

function defaultNow() {
  return globalThis.performance?.now?.() ?? Date.now();
}

function defaultRequestAnimationFrame(callback) {
  const request = globalThis.requestAnimationFrame;
  if (typeof request !== "function") {
    throw new Error("requestAnimationFrame is not available");
  }
  return request.call(globalThis, callback);
}

function defaultCancelAnimationFrame(handle) {
  globalThis.cancelAnimationFrame?.call(globalThis, handle);
}

function defaultSetTimeout(callback, delay) {
  return globalThis.setTimeout.call(globalThis, callback, delay);
}

function defaultClearTimeout(handle) {
  globalThis.clearTimeout.call(globalThis, handle);
}

function isFiniteNumber(value) {
  return typeof value === "number" && Number.isFinite(value);
}

/**
 * Create a fixed-step browser scheduler.
 *
 * The scheduler has one pending wake at a time. A visible wake races RAF
 * against a watchdog timer; whichever fires first owns that wake and cancels
 * the other source. When `backgroundPolicy` is `"pause"`, a hidden document
 * has no pending wake and resumes with a reset clock. `"fallback"` is also
 * available for hosts that explicitly want bounded timer-driven background
 * simulation.
 *
 * `tick` advances one simulation step. `render` is called once per wake after
 * zero or more ticks, with `{ steps, alpha, elapsedMs, droppedMs, source }`.
 */
export function createFixedStepScheduler({
  tick,
  render = () => {},
  onError = (error) => {
    throw error;
  },
  onVisibilityChange = () => {},
  onWake = null, // Optional development observer; never simulation input.
  stepMs = DEFAULT_STEP_MS,
  maxCatchUpSteps = DEFAULT_MAX_CATCH_UP_STEPS,
  watchdogMs = DEFAULT_WATCHDOG_MS,
  now = defaultNow,
  requestAnimationFrame = defaultRequestAnimationFrame,
  cancelAnimationFrame = defaultCancelAnimationFrame,
  setTimeout = defaultSetTimeout,
  clearTimeout = defaultClearTimeout,
  visibilityTarget = globalThis.document ?? null,
  backgroundPolicy = "pause",
} = {}) {
  if (typeof tick !== "function") throw new TypeError("fixed-step scheduler requires tick()");
  if (typeof render !== "function") throw new TypeError("fixed-step scheduler requires render()");
  if (typeof onError !== "function") throw new TypeError("fixed-step scheduler requires onError()");
  if (typeof onVisibilityChange !== "function") throw new TypeError("fixed-step scheduler requires onVisibilityChange()");
  if (!isFiniteNumber(stepMs) || stepMs <= 0) throw new RangeError("stepMs must be positive");
  if (!Number.isInteger(maxCatchUpSteps) || maxCatchUpSteps <= 0) {
    throw new RangeError("maxCatchUpSteps must be a positive integer");
  }
  if (!isFiniteNumber(watchdogMs) || watchdogMs <= 0) {
    throw new RangeError("watchdogMs must be positive");
  }
  if (backgroundPolicy !== "pause" && backgroundPolicy !== "fallback") {
    throw new RangeError('backgroundPolicy must be "pause" or "fallback"');
  }

  if (onWake !== null && typeof onWake !== "function") throw new TypeError("onWake must be a function or null");
  const maxElapsedMs = stepMs * maxCatchUpSteps;
  let started = false;
  let manuallyPaused = false;
  let visibilityPaused = false;
  let visibilityListenerAttached = false;
  let pendingWake = null;
  let generation = 0;
  let lastTimestamp = null;
  let accumulator = 0;
  let lastResult = null;
  let totalDroppedSteps = 0;

  function documentIsHidden() {
    return visibilityTarget?.visibilityState === "hidden" || visibilityTarget?.hidden === true;
  }

  function isBlocked() {
    return !started
      || manuallyPaused
      || (backgroundPolicy === "pause" && (visibilityPaused || documentIsHidden()));
  }

  function resetClock() {
    lastTimestamp = null;
    accumulator = 0;
  }

  function primeClock() {
    resetClock();
    lastTimestamp = timestampFor(now());
  }

  function notifyVisibility(visible, reason) {
    onVisibilityChange({ visible, reason, backgroundPolicy });
  }

  function cancelPendingWake() {
    generation += 1;
    const wake = pendingWake;
    pendingWake = null;
    wake?.cancel();
  }

  function timestampFor(value) {
    if (isFiniteNumber(value)) return value;
    const current = now();
    return isFiniteNumber(current) ? current : 0;
  }

  function runWake(timestamp, source) {
    const current = timestampFor(timestamp);
    let elapsedMs = 0;
    if (lastTimestamp === null) {
      lastTimestamp = current;
    } else {
      elapsedMs = Math.max(0, current - lastTimestamp);
      lastTimestamp = current;
    }

    const beforeClamp = accumulator + elapsedMs;
    const droppedMs = Math.max(0, beforeClamp - maxElapsedMs);
    const droppedSteps = Math.floor((droppedMs + Number.EPSILON) / stepMs);
    totalDroppedSteps += droppedSteps;
    accumulator = Math.min(maxElapsedMs, beforeClamp);

    let steps = 0;
    while (steps < maxCatchUpSteps && accumulator + Number.EPSILON >= stepMs) {
      // Subtract before calling user code so a tick that pauses/stops the
      // scheduler cannot leave a negative accumulator behind.
      accumulator -= stepMs;
      steps += 1;
      tick({ timestamp: current, stepMs, stepIndex: steps - 1, source });
      if (isBlocked()) break;
    }
    if (accumulator < 0 && accumulator > -Number.EPSILON) accumulator = 0;

    lastResult = {
      timestamp: current,
      elapsedMs,
      simulatedMs: steps * stepMs,
      droppedMs,
      droppedSteps,
      steps,
      alpha: accumulator / stepMs,
      source,
    };
    render(lastResult);
  }

  function scheduleWake() {
    if (isBlocked() || pendingWake) return;

    const wake = {
      scheduledAt: onWake ? now() : null,
      token: generation,
      settled: false,
      rafId: null,
      timerId: null,
      cancel() {
        if (wake.settled) return;
        wake.settled = true;
        if (wake.rafId !== null) cancelAnimationFrame(wake.rafId);
        if (wake.timerId !== null) clearTimeout(wake.timerId);
      },
    };
    pendingWake = wake;

    const settle = (source, timestamp) => {
      if (wake.settled || wake.token !== generation) return;
      wake.settled = true;
      if (wake.timerId !== null) clearTimeout(wake.timerId);
      if (source === "watchdog" && wake.rafId !== null) cancelAnimationFrame(wake.rafId);
      if (pendingWake === wake) pendingWake = null;
      if (isBlocked()) return;

      const callbackStart = onWake ? now() : null;
      let failure = null;
      try {
        runWake(timestamp, source);
      } catch (error) {
        failure = String(error?.message ?? error).slice(0, 256);
        stop();
        if (onWake) onWake({source, scheduled_ms:wake.scheduledAt, start_ms:callbackStart,
          end_ms:now(), timestamp_ms:timestamp, result:null, error:failure});
        onError(error);
        return;
      } finally {
        if (onWake && failure === null) onWake({source, scheduled_ms:wake.scheduledAt, start_ms:callbackStart,
          end_ms:now(), timestamp_ms:timestamp, result:failure ? null : lastResult, error:failure});
      }
      scheduleWake();
    };

    const timerOnly = backgroundPolicy === "fallback" && documentIsHidden();
    try {
      if (!timerOnly) {
        const rafId = requestAnimationFrame((timestamp) => settle("raf", timestamp));
        wake.rafId = rafId;
        // A test double is allowed to invoke RAF synchronously. Do not leave
        // its handle alive if that already settled this wake.
        if (wake.settled) cancelAnimationFrame(rafId);
      }
      if (!wake.settled) {
        const timerId = setTimeout(() => settle("watchdog", now()), watchdogMs);
        wake.timerId = timerId;
        if (wake.settled) clearTimeout(timerId);
      }
    } catch (error) {
      wake.cancel();
      if (pendingWake === wake) pendingWake = null;
      throw error;
    }
  }

  function handleVisibilityChange() {
    if (!started) return;
    const hidden = documentIsHidden();
    if (backgroundPolicy === "pause") {
      if (hidden) {
        if (visibilityPaused) return;
        visibilityPaused = true;
        cancelPendingWake();
        resetClock();
      } else if (visibilityPaused) {
        visibilityPaused = false;
        primeClock();
        if (!manuallyPaused) scheduleWake();
        notifyVisibility(true, "visibilitychange");
      }
      if (hidden && visibilityPaused) notifyVisibility(false, "visibilitychange");
      return;
    }

    // A fallback-policy host can switch back to RAF as soon as it becomes
    // visible. Keep the accumulated elapsed time because background ticks are
    // intentional under this policy.
    if (!hidden && pendingWake?.rafId === null) {
      cancelPendingWake();
      scheduleWake();
    }
    notifyVisibility(!hidden, "visibilitychange");
  }

  function attachVisibilityListener() {
    if (visibilityListenerAttached || typeof visibilityTarget?.addEventListener !== "function") return;
    visibilityTarget.addEventListener("visibilitychange", handleVisibilityChange);
    visibilityListenerAttached = true;
  }

  function detachVisibilityListener() {
    if (!visibilityListenerAttached || typeof visibilityTarget?.removeEventListener !== "function") return;
    visibilityTarget.removeEventListener("visibilitychange", handleVisibilityChange);
    visibilityListenerAttached = false;
  }

  function start() {
    if (started) return;
    started = true;
    manuallyPaused = false;
    visibilityPaused = backgroundPolicy === "pause" && documentIsHidden();
    if (visibilityPaused) resetClock();
    else primeClock();
    attachVisibilityListener();
    notifyVisibility(!documentIsHidden(), "start");
    scheduleWake();
  }

  function stop() {
    started = false;
    manuallyPaused = false;
    visibilityPaused = false;
    cancelPendingWake();
    resetClock();
    detachVisibilityListener();
  }

  function pause() {
    manuallyPaused = true;
    cancelPendingWake();
    resetClock();
  }

  function resume() {
    manuallyPaused = false;
    if (!started) return;
    primeClock();
    scheduleWake();
  }

  function state() {
    const visibilityIsPaused = started
      && backgroundPolicy === "pause"
      && (visibilityPaused || documentIsHidden());
    const paused = started && (manuallyPaused || visibilityIsPaused);
    return {
      started,
      running: started && !paused,
      paused,
      manuallyPaused,
      visibilityPaused: visibilityIsPaused,
      pendingWake: pendingWake !== null,
      accumulatorMs: accumulator,
    };
  }

  return {
    fixedStepSeconds: stepMs / 1000,
    maxCatchUpSteps,
    start,
    stop,
    pause,
    resume,
    isStarted: () => started,
    isRunning: () => started && !isBlocked(),
    isPaused: () => state().paused,
    state,
    get running() {
      return started && !isBlocked();
    },
    get visible() {
      return !documentIsHidden() && !visibilityPaused;
    },
    get lastResult() {
      return lastResult;
    },
    get totalDroppedSteps() {
      return totalDroppedSteps;
    },
  };
}
