# Gamepad input

Official hosts read up to four gamepads every tick. Buttons are ordinary
actions; sticks and triggers are read with `api.input.getGamepad`.

```luau
local pad = api.input.getGamepad()          -- lowest connected slot, or nil
if pad then
    move(pad.leftStick.x, pad.leftStick.y)  -- -1..1, y up, deadzone applied
    aim(pad.rightStick.x, pad.rightStick.y)
    throttle(pad.rightTrigger)              -- 0..1
end
if api.input.wasPressed("Gamepad_A") or api.input.wasPressed("Space") then jump() end

for _, pad in api.input.getGamepads() do    -- local multiplayer, by slot
    if api.input.isDown("Gamepad" .. pad.slot .. "_X") then fire(pad.slot) end
end
```

## Buttons

Each button is two actions: `Gamepad_<name>` is down while it is down on any
pad, and `Gamepad<slot>_<name>` (slots 1 to 4) for one pad. Names follow the
W3C standard layout:

`A B X Y LB RB LT RT Back Start LS RS Up Down Left Right Home`

`LT` and `RT` are also the triggers as buttons. They read with `isDown`,
`wasPressed` and `wasReleased` like keys, count as host action names for
`INPUT_ACTION_UNKNOWN`, and can be bound alongside keyboard keys.

## Sticks and triggers

`getGamepad(slot?)` returns `{slot, leftStick = {x, y}, rightStick = {x, y},
leftTrigger, rightTrigger}`, or nil when that pad is not connected.
`getGamepads()` lists every connected pad by slot. Sticks have a radial
deadzone of 0.15: inside it they read 0, and the rest of the travel is
rescaled to reach 1. Triggers read 0 to 1 unchanged.

A pad that disconnects simply stops appearing; compare slots between ticks to
notice it.

## Input frames and replay

Hosts send the raw values in the input frame, so recordings, `game replay` and
tests replay the same pads:

```json
{"actions": {"Gamepad_A": true, "Gamepad1_A": true},
 "gamepads": [{"slot": 1, "left_x": 0.4, "left_y": -0.2, "right_trigger": 1}]}
```

`slot` is 1 to 4 and appears once; sticks are -1 to 1 with y up; triggers 0
to 1; omitted values are 0. Anything else fails with `INPUT_GAMEPAD_INVALID`.

## Hosts

- **Official Web player:** polls `navigator.getGamepads()` once per tick;
  pad index N is slot N + 1, using the standard mapping (stick y is flipped
  to point up). Browsers report a pad only after a button is pressed on it.
  The generic development runner (`web/runner`) does not read gamepads.
- **Native player (Windows):** XInput (`xinput1_4`, `1_3` or `9_1_0`, loaded
  at run time). XInput does not report the guide button, so `Home` never
  arrives. Empty slots are checked about every two seconds, because XInput is
  slow to query them. Report and headless runs read no controllers, so their
  results never depend on what is plugged in.
- **Native player (Android):** not read yet; no gamepads are reported.
