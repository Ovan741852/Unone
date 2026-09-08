import assert from "node:assert/strict";
import { test } from "node:test";

import { createFixedStepScheduler } from "../shared/fixed-step-scheduler.mjs";

class FakeClock {
  constructor() {
    this.time = 0;
    this.nextHandle = 1;
    this.rafs = new Map();
    this.timers = new Map();
  }

  requestAnimationFrame(callback) {
    const handle = this.nextHandle++;
    this.rafs.set(handle, callback);
    return handle;
  }

  cancelAnimationFrame(handle) {
    this.rafs.delete(handle);
  }

  setTimeout(callback, delay) {
    const handle = this.nextHandle++;
    this.timers.set(handle, { at: this.time + delay, callback });
    return handle;
  }

  clearTimeout(handle) {
    this.timers.delete(handle);
  }

  nextRaf() {
    const [handle, callback] = this.rafs.entries().next().value ?? [];
    if (handle === undefined) return null;
    this.rafs.delete(handle);
    return callback;
  }

  fireRaf(timestamp = this.time) {
    const callback = this.nextRaf();
    assert.ok(callback, "expected a pending RAF");
    this.time = timestamp;
    callback(timestamp);
  }

  fireNextTimer() {
    const entry = [...this.timers.entries()].sort(([, left], [, right]) => left.at - right.at)[0];
    assert.ok(entry, "expected a pending timer");
    const [handle, { at, callback }] = entry;
    this.timers.delete(handle);
    this.time = at;
    callback();
  }
}

test('wake observer records multi-step RAF and watchdog spans before an error freezes the window',()=>{
 const clock=new FakeClock(),spans=[];let failed=false;
 const {scheduler}=makeScheduler(clock,undefined,{stepMs:10,watchdogMs:20,
  tick:()=>{clock.time+=2;if(failed)throw new Error('test failure');},
  render:()=>{clock.time+=3;},onWake:s=>spans.push(s),
  onError:()=>{assert.equal(spans.at(-1).error,'test failure');},
 });
 scheduler.start();clock.fireRaf(20);
 assert.equal(spans[0].source,'raf');assert.equal(spans[0].result.steps,2);
 assert.equal(spans[0].scheduled_ms,0);assert.equal(spans[0].start_ms,20);assert.equal(spans[0].end_ms,27);
 clock.fireNextTimer();assert.equal(spans[1].source,'watchdog');
 failed=true;clock.fireNextTimer();assert.equal(spans.length,3);assert.equal(spans[2].result,null);
 assert.equal(scheduler.isStarted(),false);
});

class FakeVisibilityTarget {
  constructor() {
    this.visibilityState = "visible";
    this.hidden = false;
    this.listeners = new Set();
  }

  addEventListener(type, listener) {
    if (type === "visibilitychange") this.listeners.add(listener);
  }

  removeEventListener(type, listener) {
    if (type === "visibilitychange") this.listeners.delete(listener);
  }

  setHidden(hidden) {
    this.hidden = hidden;
    this.visibilityState = hidden ? "hidden" : "visible";
    for (const listener of this.listeners) listener();
  }
}

function makeScheduler(clock, visibilityTarget = new FakeVisibilityTarget(), options = {}) {
  const ticks = [];
  const renders = [];
  const scheduler = createFixedStepScheduler({
    tick: (info) => ticks.push(info),
    render: (info) => renders.push(info),
    now: () => clock.time,
    requestAnimationFrame: clock.requestAnimationFrame.bind(clock),
    cancelAnimationFrame: clock.cancelAnimationFrame.bind(clock),
    setTimeout: clock.setTimeout.bind(clock),
    clearTimeout: clock.clearTimeout.bind(clock),
    visibilityTarget,
    ...options,
  });
  return { scheduler, ticks, renders, visibilityTarget };
}

test("each wake settles once and the watchdog still works after a successful RAF", () => {
  const clock = new FakeClock();
  const { scheduler, ticks, renders } = makeScheduler(clock, undefined, {
    stepMs: 10,
    maxCatchUpSteps: 5,
    watchdogMs: 20,
  });

  scheduler.start();
  const firstRaf = clock.nextRaf();
  assert.ok(firstRaf);
  clock.time = 10;
  firstRaf(10);
  assert.equal(ticks.length, 1);
  assert.equal(renders.length, 1);

  const lateRaf = clock.nextRaf();
  assert.ok(lateRaf);
  clock.fireNextTimer();
  assert.equal(renders.length, 2, "watchdog should drive the next wake");
  assert.equal(ticks.length, 3, "elapsed time should produce two fixed ticks");

  lateRaf(30);
  assert.equal(renders.length, 2, "a late RAF must not render a second time");
  assert.equal(ticks.length, 3, "a late RAF must not tick a second time");
  scheduler.stop();
});

test("simulation pacing follows elapsed time and catch-up is bounded", () => {
  const clock = new FakeClock();
  const { scheduler, ticks, renders } = makeScheduler(clock, undefined, {
    stepMs: 10,
    maxCatchUpSteps: 3,
    watchdogMs: 1000,
  });

  scheduler.start();
  clock.fireRaf(10);
  clock.fireRaf(20);
  assert.equal(ticks.length, 2, "two ten-millisecond intervals should produce two ticks");

  clock.fireRaf(100);
  assert.equal(ticks.length, 5, "a long stall must consume no more than three catch-up ticks");
  assert.equal(renders.at(-1).steps, 3);
  assert.equal(renders.at(-1).droppedMs, 50);
  scheduler.stop();
});

test("hidden documents pause without catch-up and resume with one live wake", () => {
  const clock = new FakeClock();
  const visibilityTarget = new FakeVisibilityTarget();
  const { scheduler, ticks, renders } = makeScheduler(clock, visibilityTarget, {
    stepMs: 10,
    watchdogMs: 20,
  });

  scheduler.start();
  clock.fireRaf(10);
  const staleRaf = clock.nextRaf();
  assert.ok(staleRaf);

  visibilityTarget.setHidden(true);
  assert.deepEqual(scheduler.state(), {
    started: true,
    running: false,
    paused: true,
    manuallyPaused: false,
    visibilityPaused: true,
    pendingWake: false,
    accumulatorMs: 0,
  });
  staleRaf(1000);
  assert.equal(ticks.length, 1, "cancelling a hidden wake must cancel its stale RAF");

  clock.time = 1000;
  visibilityTarget.setHidden(false);
  assert.equal(scheduler.state().pendingWake, true);
  clock.fireRaf(1010);
  assert.equal(ticks.length, 2, "resume must not replay hidden wall time");
  assert.equal(renders.length, 2);
  scheduler.stop();
  assert.equal(visibilityTarget.listeners.size, 0, "stop removes the visibility listener");
});

test("fallback policy uses a timer while hidden and remains bounded", () => {
  const clock = new FakeClock();
  const visibilityTarget = new FakeVisibilityTarget();
  visibilityTarget.setHidden(true);
  const { scheduler, ticks, renders } = makeScheduler(clock, visibilityTarget, {
    stepMs: 10,
    maxCatchUpSteps: 2,
    watchdogMs: 50,
    backgroundPolicy: "fallback",
  });

  scheduler.start();
  assert.equal(clock.rafs.size, 0, "hidden fallback should not queue a starved RAF");
  clock.fireNextTimer();
  assert.equal(ticks.length, 2, "hidden fallback is limited to the catch-up budget");
  assert.equal(renders.at(-1).source, "watchdog");
  scheduler.stop();
});

test("hosts receive visibility transitions, including an initially hidden page", () => {
  const clock = new FakeClock();
  const visibilityTarget = new FakeVisibilityTarget();
  visibilityTarget.setHidden(true);
  const events = [];
  const { scheduler } = makeScheduler(clock, visibilityTarget, {
    onVisibilityChange: (event) => events.push(event),
  });

  scheduler.start();
  assert.deepEqual(events, [{ visible: false, reason: "start", backgroundPolicy: "pause" }]);
  visibilityTarget.setHidden(false);
  assert.deepEqual(events.at(-1), { visible: true, reason: "visibilitychange", backgroundPolicy: "pause" });
  scheduler.stop();
});
