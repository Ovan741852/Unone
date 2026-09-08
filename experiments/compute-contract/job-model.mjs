// Executable protocol model only. Not imported by the engine or a player.
import {createHash} from 'node:crypto';

const hash = bytes => createHash('sha256').update(bytes).digest('hex');
const fail = (code) => { throw Object.assign(new Error(code), {code}); };
let nextSession = 0; // Host-local identity, never a simulation value or clock.
const bytes = value => {
  if (!(value instanceof Uint8Array)) fail('BYTES_REQUIRED');
  return value;
};

export class JobModel {
  #session;
  #jobs = new Map();
  #sequence = 0;
  #generation = 1;
  #revision = 1;
  #frame = 0;
  #phase = 'idle';
  #input = null;
  #fault = null;
  #submitted = 0;
  #paused = false;
  #singleStep = false;
  #limit;

  constructor(limits = {}) {
    if (nextSession === Number.MAX_SAFE_INTEGER) fail('SESSION_ID_EXHAUSTED');
    this.#session = ++nextSession;
    const defaults = {jobs:64, jobs_per_tick:16, input_bytes:65536,
      output_bytes:65536, retained_bytes:1048576, tick_input_bytes:4096};
    if (Object.keys(limits).some(k => !Object.hasOwn(defaults,k))) fail('UNKNOWN_LIMIT');
    this.#limit = {...defaults,...limits};
    if (Object.values(this.#limit).some(v => !Number.isSafeInteger(v) || v < 1)) fail('INVALID_LIMIT');
  }
  #alive() {
    if (this.#phase === 'closed') fail('SESSION_CLOSED');
    if (this.#phase === 'faulted') fail('SESSION_FAULTED');
  }
  #identity(id) {
    if (typeof id !== 'string' || !/^\d+:\d+:\d+:\d+$/.test(id)) fail('INVALID_JOB');
    const [s,g,r,n] = id.split(':').map(Number);
    if (![s,g,r,n].every(Number.isSafeInteger)) fail('INVALID_JOB');
    if (s !== this.#session || g !== this.#generation || r !== this.#revision) fail('STALE_JOB');
    if (n < 1 || n > this.#sequence) fail('UNKNOWN_JOB');
    const job = this.#jobs.get(id);
    if (!job) fail('JOB_EXPIRED'); // Taken/cancelled handles aren't retained forever.
    return job;
  }
  #used() {
    return (this.#input?.byteLength ?? 0) + [...this.#jobs.values()]
      .reduce((n,j) => n + (j.input?.byteLength ?? 0) + j.output_capacity,0);
  }
  #fit(extra) {
    if (this.#used() + extra > this.#limit.retained_bytes) fail('TOTAL_BYTES_EXCEEDED');
  }
  #waiting() { return [...this.#jobs.values()].some(j => j.state === 'queued'); }
  inspect() {
    return {session:this.#session,frame:this.#frame,generation:this.#generation,revision:this.#revision,
      phase:this.#phase,paused:this.#paused, tick_status:this.#phase === 'waiting' ? (this.#waiting()?'pending':'ready') : null,
      input_hash:this.#input ? hash(this.#input) : null, retained_bytes:this.#used(),
      jobs:[...this.#jobs.values()].map(j => ({id:j.id,state:j.state,submit_tick:j.submit_tick,
        deliver_tick:j.deliver_tick,input_hash:j.input_hash,output_hash:j.output_hash ?? null})),
      fault:this.#fault ? {...this.#fault} : null};
  }
  setPaused(value) {
    this.#alive();
    if (typeof value !== 'boolean') fail('PAUSE_VALUE_REQUIRED');
    if (this.#phase === 'updating') fail('PAUSE_DURING_UPDATE');
    this.#paused=value;
  }
  requestTick(input,mode='auto') {
    this.#alive();
    if (this.#phase !== 'idle') fail('TICK_ALREADY_REQUESTED');
    if (mode !== 'auto' && mode !== 'step') fail('INVALID_TICK_MODE');
    if (mode === 'step' && !this.#paused) fail('STEP_REQUIRES_PAUSE');
    if (mode === 'auto' && this.#paused) fail('TICK_PAUSED');
    bytes(input);
    if (input.byteLength > this.#limit.tick_input_bytes) fail('TICK_INPUT_TOO_LARGE');
    this.#fit(input.byteLength);
    this.#input = new Uint8Array(input); // Buffer.slice() would alias the caller's storage.
    this.#singleStep = mode === 'step';
    this.#phase = 'waiting';
    return this.inspect().tick_status;
  }
  enterTick() {
    this.#alive();
    if (this.#phase !== 'waiting') fail('NO_TICK_REQUEST');
    if (this.#paused && !this.#singleStep) fail('TICK_PAUSED');
    if (this.#waiting()) fail('BARRIER_PENDING');
    const delivered = [];
    // Map order is submission order, independent of completion message order.
    for (const j of this.#jobs.values()) if (j.state === 'ready') {
      j.state = 'delivered'; delivered.push(j.id);
    }
    this.#phase = 'updating';
    this.#submitted = 0;
    return {frame:this.#frame+1,input:new Uint8Array(this.#input),delivered};
  }
  submit(input, outputCapacity) {
    this.#alive();
    if (this.#phase !== 'updating') fail('SUBMIT_OUTSIDE_UPDATE'); // Game.start excluded in v0.
    bytes(input);
    if (input.byteLength > this.#limit.input_bytes) fail('INPUT_TOO_LARGE');
    if (!Number.isSafeInteger(outputCapacity) || outputCapacity < 0 || outputCapacity > this.#limit.output_bytes)
      fail('OUTPUT_CAPACITY_INVALID');
    if (this.#submitted >= this.#limit.jobs_per_tick || this.#jobs.size >= this.#limit.jobs) fail('JOB_LIMIT');
    this.#fit(input.byteLength+outputCapacity);
    if (this.#sequence === Number.MAX_SAFE_INTEGER) fail('JOB_ID_EXHAUSTED');
    const frozen = new Uint8Array(input);
    const id = `${this.#session}:${this.#generation}:${this.#revision}:${++this.#sequence}`;
    this.#jobs.set(id,{id,state:'staged',submit_tick:this.#frame+1,deliver_tick:this.#frame+2,
      input:frozen,input_hash:hash(frozen),output_capacity:outputCapacity});
    this.#submitted++;
    return id;
  }
  finishTick() {
    this.#alive();
    if (this.#phase !== 'updating') fail('UPDATE_NOT_ENTERED');
    if (this.#frame >= Number.MAX_SAFE_INTEGER-2) fail('FRAME_EXHAUSTED');
    for (const j of this.#jobs.values()) if (j.state === 'staged') j.state = 'queued';
    this.#frame++;
    this.#input = null;
    this.#phase = 'idle';
  }
  dispatchInput(id) {
    this.#alive();
    const j = this.#identity(id);
    if (j.state !== 'queued') fail('JOB_NOT_DISPATCHABLE');
    return new Uint8Array(j.input); // Model executor owns this copy, not the frozen original.
  }
  complete(id, output) {
    this.#alive();
    const j = this.#identity(id);
    if (j.state === 'staged') fail('JOB_NOT_DISPATCHABLE');
    bytes(output);
    if (output.byteLength > j.output_capacity) { this.fault('OUTPUT_OVERFLOW',id); return; }
    const frozen = new Uint8Array(output);
    const digest = hash(frozen);
    if (j.state !== 'queued') {
      if (j.output_hash === digest) return 'duplicate';
      this.fault('CONFLICTING_COMPLETION',id); return;
    }
    j.output = frozen; j.output_hash = digest;
    j.input = null; j.state = 'ready';
    return 'accepted';
  }
  take(id) {
    this.#alive();
    if (this.#phase !== 'updating') fail('TAKE_OUTSIDE_UPDATE');
    const j = this.#identity(id);
    if (j.state !== 'delivered') fail('RESULT_NOT_DELIVERED');
    this.#jobs.delete(id);
    return j.output; // Ownership transfer; no mutable alias remains in the model.
  }
  cancel(id) {
    this.#alive();
    this.#identity(id);
    this.#jobs.delete(id); // Removes the barrier obligation, even if completion won the race.
  }
  reset() {
    this.#alive();
    if (this.#phase === 'updating') fail('RESET_DURING_UPDATE');
    if (this.#revision === Number.MAX_SAFE_INTEGER) fail('REVISION_EXHAUSTED');
    this.#revision++; this.#clear(); // Gameplay reset need not recreate the runtime.
  }
  reload(success) {
    this.#alive();
    if (typeof success !== 'boolean') fail('RELOAD_RESULT_REQUIRED');
    if (this.#phase === 'updating') fail('RELOAD_DURING_UPDATE');
    if (success) {
      if (this.#generation === Number.MAX_SAFE_INTEGER) fail('GENERATION_EXHAUSTED');
      this.#generation++; this.#revision=1; this.#clear();
    }
    // Failed reload preserves the old program, frozen input and all jobs.
  }
  #clear() {
    this.#jobs.clear(); this.#sequence=0; this.#input=null; this.#submitted=0; this.#phase='idle';
  }
  fault(code,id=null) {
    this.#alive();
    if (typeof code !== 'string' || !/^[A-Z_]{1,64}$/.test(code)) fail('INVALID_FAULT_CODE');
    if (id !== null) this.#identity(id);
    this.#fault={code,job:id,frame:this.#frame};
    this.#jobs.clear(); this.#input=null; this.#phase='faulted';
  }
  close() { this.#jobs.clear(); this.#input=null; this.#phase='closed'; }
}
