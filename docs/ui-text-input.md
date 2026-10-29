# Plain text input

The text-input SDK adds a reusable `text_input` leaf to the official UI and
`kit.textInput(props)` / `api.ui.components.textInput(props)` constructors.
This is a host editing primitive. Name rules, validation messages, confirmation,
window ownership and persistence stay in the game's Luau.

```lua
local edit=api.input.getTextInputInteraction('nickname')
if edit then
    draft=edit.text
    if edit.phase=='submit' and not edit.composing then validateAndSave(draft) end
end
-- In the pure View, retain the same stable ID across ticks:
ui.textInput({id='nickname',rect={x=30,y=45,width=40,height=8},text=draft,
    placeholder='請輸入稱呼',max_length=12,focused=true,enabled=true})
```

`focused=true` requests initial focus; a new tree object does not recreate the
editor or reset an ongoing composition. `max_length` is the committed Unicode
scalar limit (default1024, range1..16384), applied after IME completion. It is not
a byte count or an application validation rule. The host temporarily preserves
composition text beyond that committed limit. The game must not save candidates.

Input frames carry `ui_text_inputs={id={phase,text,composing}}` where phase is
`change`, `submit`, `cancel`, `focus` or `blur`. The read-only per-tick snapshot is
non-consuming; a following empty successful tick clears it. Failed ticks preserve
pending data for retry. Empty retry frames retain unconsumed events; an identical
event may be resubmitted, while a conflicting pending event or accumulated
capacity overflow rejects the whole frame with `INPUT_UI_PENDING`. Complete the
pending tick with `tick()` or unchanged input before admitting its successor.
Hosts retain per-ID event order; they may coalesce adjacent
changes with the same composition state, never submit/cancel/focus/blur boundaries.
Core accepts up to64 IDs per frame, each<=1024 UTF-8 bytes, and single-line text
up to65536 UTF-8 bytes. Submit with `composing=true` is rejected.

The official Web host owns a transparent native editing sink for OS composition,
paste, selection and deletion; Canvas remains the visual UI renderer. No game
HTML control or replacement renderer is needed. Focused editing owns keyboard
events, so WASD/B/C/Space cannot reach gameplay. Candidate Enter commits only the
IME candidate; a later Enter submits. Blur, removal and disposal release editing.

Use the matching SDK/Core/Web templates. Native Windows currently renders the
canonical text field but does not implement an editing/IME adapter. Do not claim
native desktop or mobile editing support from the Core or Web unit tests.
