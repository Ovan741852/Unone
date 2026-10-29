# Application lifecycle intent

`api.application` is an always-available engine primitive. The game owns pause,
confirmation, save policy and menu content in Luau. The engine stores lifecycle
intent; a presentation host decides how to honor it. No game-specific controls
or rules belong in this namespace.

```luau
function Game.start(api: EngineApi)
    api.application.setEscapeBehavior("action")
end

function Game.update(api: EngineApi, dt: number)
    if api.input.wasPressed("Escape") then
        -- The game opens its own pause/confirmation UI.
    end
    if confirmedExit then
        api.application.requestQuit()
    end
end
```

`setEscapeBehavior` accepts exactly `"action"` or `"quit"`; invalid values fail
with `APPLICATION_ESCAPE_BEHAVIOR_INVALID` and preserve the previous value.
New runtimes default to `"quit"`, retaining native Escape-to-exit behavior for
existing games. In action mode, physical Escape down/up transitions enter the
normal neutral keyboard queue. Key repeat, short taps and focus reset use the
same semantics as the other keys. Insert, Home and PageUp publish neutral action
names `"Insert"`, `"Home"` and `"PageUp"`; P already publishes `"P"`.

`requestQuit()` sets a monotonic, idempotent latch. It does not show a confirmation
dialog or save data. The game calls it after its own explicit confirmation.
Both values persist across scene replacement and are visible in every canonical
world snapshot (and its observation digest):

```json
{"application":{"escape_behavior":"action","quit_requested":true}}
```

The official native player observes the state from Game.start and every update.
Once a quit is requested, it stops additional catch-up ticks, presents that
snapshot, performs configured capture/reporting, then exits. Surface loss or a
timeout does not count as presentation; the same snapshot is retried without
another gameplay tick. The final report includes `application` and
`quit_request_presented`. The latter is true only on the successful native
presentation path. Capture/render failures remain errors in the report.

The kernel and bounded headless runs only publish the latch; they do not claim
GPU work or close an application. Browser hosts retain their host close policy;
this primitive does not promise that a browser can close an arbitrary user tab.
Window close remains host-controlled. Semantic replay supplies action frames;
it does not synthesize an OS Escape event or prove physical-key delivery.

Focused tests cover default compatibility, strict validation, input-versus-quit
separation, repeat requests, scene persistence, digest/discovery, native physical
Escape policy, successful-presentation gating and neutral key mapping. These
tests do not themselves provide a GPU capture; native end-to-end evidence is
recorded separately by games exercising the host.
