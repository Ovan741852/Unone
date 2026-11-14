import test from 'node:test';
import assert from 'node:assert/strict';
import {GAMEPAD_BUTTONS, readGamepads} from './player-input.js';
import {createHostInput} from './host-input.js';

const pad = (index, overrides = {}) => ({
  index, connected: true, mapping: 'standard',
  axes: [0, 0, 0, 0],
  buttons: GAMEPAD_BUTTONS.map(() => ({pressed: false, value: 0})),
  ...overrides,
});

test('standard pads map to slots, y-up sticks, triggers and pressed button names', () => {
  const buttons = GAMEPAD_BUTTONS.map(() => ({pressed: false, value: 0}));
  buttons[0] = {pressed: true, value: 1};          // A
  buttons[7] = {pressed: true, value: 0.6};        // RT
  buttons[15] = {pressed: true, value: 1};         // Right
  const states = readGamepads([null, pad(1, {axes: [0.5, -0.25, 2, 0.75], buttons}), pad(0, {connected: false}), pad(5)]);
  assert.deepEqual(states, [{slot: 2, left_x: 0.5, left_y: 0.25, right_x: 1, right_y: -0.75, left_trigger: 0, right_trigger: 0.6,
    buttons: ['A', 'RT', 'Right']}], 'disconnected and fifth pads are skipped; out-of-range axes clamp');
  assert.deepEqual(readGamepads(undefined), []);
});

test('host input turns held pad buttons into any-pad and per-slot actions and carries the axes', () => {
  const input = createHostInput();
  input.queuePhysicalAction('Space', true);
  input.setGamepads([{slot: 1, left_x: 0.2, left_y: 0, right_x: 0, right_y: 0, left_trigger: 0, right_trigger: 1, buttons: ['A']}]);
  const frame = input.consumeFrame();
  assert.deepEqual(Object.keys(frame.actions), ['Gamepad1_A', 'Gamepad_A', 'Space']);
  assert.deepEqual(frame.gamepads, [{slot: 1, left_x: 0.2, left_y: 0, right_x: 0, right_y: 0, left_trigger: 0, right_trigger: 1}]);
  // Held while polled as held; gone once the pad disconnects.
  assert.ok(input.consumeFrame().actions.Gamepad_A);
  input.setGamepads([]);
  const idle = input.consumeFrame();
  assert.equal(idle.actions.Gamepad_A, undefined);
  assert.equal(idle.gamepads, undefined, 'frames without pads keep their old shape');
  assert.throws(() => input.setGamepads(null), /GAMEPAD_INPUT_INVALID/);
});
