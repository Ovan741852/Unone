# Ordered physical input (official Web opt-in)

`player.presentation.json` may declare `"physical_input":"ordered_physical_v1"`.
Omission preserves the existing action/pointer/slider snapshot path. The first
live implementation supports the official Web main and Worker backends. Native,
mobile and custom-renderer live declarations fail explicitly. Normalized Core
replay uses the same `InputFrame` JSON without opening a browser.

`api.input.getPhysicalBatch()` returns a detached current-tick batch or nil.
It returns nil during start, reload, inspection and outside a tick. Reading it
does not consume events. Mutating a returned table never changes another read.

The batch contains `profile`, a positive safe-integer `epoch`, `after_sequence`,
`through_sequence`, and dense `events`. Rows retain admitted source order across
keys, pointers, wheel and lifecycle facts. Each row contains `sequence`,
`received_us`, `origin`, `route`, `kind`, and the canonical kind-specific fields
in the SDK typings. Times are floor microseconds from a host monotonic receive
source, not DOM timestamps, simulation time or `api.hostTime`. Equal times are
legal. Core checks nondecreasing time across successfully committed batches.
Physical metadata reaches Luau as exact binary64 numbers through `2^53-1`,
including values above signed/unsigned 32-bit ranges. The detached batch decoder
does not apply the separate portable signed-i32 save-payload restriction.

Keys preserve physical `code`, `location`, down/up, repeat, composition status
and edge modifiers. Pointer rows preserve down/up/move/cancel, button and buttons;
chord button changes remain pointermove rows. Wheel preserves three deltas and
pixel/line/page units. This API supplies no scan-code table, camera speed, click,
double-click, selection, picking, text or IME composition policy.

Pointer/wheel points are continuous physical canvas coordinates, top-left origin:
`(client - rect origin) * backing size / rect CSS size`. There is no rounding,
half-pixel adjustment or second DPR multiplication. Each point copies its
viewport, whose revision changes with backing size, CSS size, DPR **or rect
left/top**. The initial profile supports a borderless/padding-free canvas with
positive axis-aligned CSS scaling/translation; arbitrary transforms are outside
the contract. A viewport control row precedes use of a changed mapping.

Browser signed 32-bit source pointer IDs map to positive epoch-local IDs. A new
down after a quiescent gesture receives a new ID, including browser-ID reuse;
got/lost capture tails retain the preceding ID. Reuse before an outstanding
capture tail is an explicit terminal source ambiguity. Quiescent pointerout
retires mapping storage; live bookkeeping is bounded to 256 source pointers and
256 held keys, with visible capacity failure. IDs are not game entity IDs.

Focus, reset, viewport and capture always have route `control`. Handle all rows
in order, updating common physical/lifecycle state before filtering device
commands by `game`, `engine_ui` or `host_ui`. Never skip lifecycle rows because a
UI owns the next device event. Never move all reset rows ahead of earlier input.
The host calls the existing UI router once and records its receipt; it does not
infer ownership from `defaultPrevented` or perform a second UI hit test.
An admitted down fixes gesture ownership through chord moves, outside release,
UI removal/disable and cancellation. UI-owned right/middle chords bypass the
legacy game mouse queues. A canvas down attempts to restore focus when the
READY/visibility/pause/disposal gates allow it; game admission still requires
confirmed document focus. Held moves and repeated keys without an
admitted start remain host-owned until a fresh start; resume invents no press.

Order is **host admission order**, not raw DOM callback-entry order. An eligible
canvas down runs a focus prelude before pointer admission: it attempts canvas
focus, then confirms current `document.hasFocus()`. Synchronous browser
focus/focusin callbacks (and any reentrant admitted facts) can therefore precede
the outer pointer row. A changed focus query is a `host_synthetic` control fact;
it does not pretend a browser focus event was dispatched. `received_us` is sampled
at each admission, never backfilled with the earlier DOM entry timestamp. Once
pointer admission begins, its reservation still precedes routing and nested
capture facts. This normalization is not original OS/DirectInput ordering.

If focus remains false, that down is not recreated after focus arrives. Without
an admitted start, pointer up/cancel/held move and keyup stay `host_ui`; normal
zero-button hover may still route to the game. Ready, visibility, pause and
disposal barriers also apply before an attempt to acquire focus.

Admission starts at READY with load reset, viewport and focus facts. Blur,
hidden, pause and leaving game focus insert reset barriers while retaining
earlier rows; no fake hardware keyup is generated. Suspended admission resumes
without re-pressing held devices. Capture rows describe actual got/lost events.
Loss with active pointer buttons resets that pointer once. Ordinary pointerup
then capture loss adds no synthetic release. Cancel followed by capture loss
does not reset twice. Typed text/IME is a separate semantic control capability;
the text-input SDK provides it through `text_input` and `ui_text_inputs`, rather
than inventing committed characters from physical key codes. See
[plain text input](ui-text-input.md). Presented-view identity remains separate.
If capture/routing throws, the host cancels the existing UI stream, queues a
pointer reset as fault evidence and becomes terminal. It reports no fake got
capture and does not claim that an uncommitted reset rewound game state. If the
bounded queue cannot admit that reset, the capacity fault remains explicit.

The host leases at most 256 rows / 256 KiB and retains them until a successful
tick returns `world.physical_input_receipt` in the Web observation envelope.
The Core `WorldSnapshot` DTO holds that optional receipt at its own top level.
An exact profile/epoch/through-sequence match commits the prefix. New arrivals
stay behind the in-flight lease. A direct C ABI second input setter rejects a
pending ordered batch without replacing it. Timeout or unknown completion is
terminal; the host does not resend or silently switch to legacy input.

A fresh Core does not borrow an epoch from presentation. Its first valid batch
must start after zero; only successful tick commit pins epoch, cursor and receive
time. Validation rejection has no game effects. An accepted execution failure
is terminal, including the first tick before epoch commit; partial Lua/World
effects remain and the last attempt is retained in diagnostics. Ordinary reload
cannot recover that session. A complete new load establishes a new host epoch.
Healthy reload preserves the session and exposes no active batch to onReload.

Live history is disabled; pending plus in-flight storage is bounded to 4096
rows / 4 MiB. Overflow is a visible terminal fault, with no silent coalescing or
dropping. `data-player-physical-input`, player metrics and player errors expose
admission, epoch, cursor, queue sizes, in-flight prefix and fault. Long-running
applications must consume batches; a suspended simulation can fill the queue.

`record_run`/`diff_run` retain normalized batches and require explicit matching
`physical_input_profile` metadata. They cap physical inputs at 1,000,000 rows /
64 MiB. Developer recording retains its existing stricter 16 MiB, 64 KiB request
and 60,000 tick bounds; a physical step must contain exactly one tick. These are
Unone normalized-input recordings, separate from host-clock tapes and any game's
original replay format. Product Web recording UI and active-gesture checkpoint
restore are not provided. Developer manual input injection is explicitly
unsupported while this live collector owns tick batches.
