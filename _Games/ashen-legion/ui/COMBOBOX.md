# Skinnable ComboBox

The settings quality and language controls use the engine's `combobox` node.
This is a controlled selection field: Core validates its identity, action,
selected text and expanded state. The host captures the entire field; Luau
owns the option data, selection changes, persistence and popup visibility.

Hierarchy:

```text
component_settings_quality  (ui.combobox)
  settings_quality_label
  settings_quality_field   (one nine-slice image)
  settings_quality_value
  settings_quality_arrow   (contain image)
  settings_quality         (combobox input node)
component_settings_quality_options  (ui.combobox-popup, while open)
  settings_quality_options_plate
  settings_quality_option_low_label
  settings_quality_option_low
  …
```

The popup is an overlay sibling so it renders above later fields. The field,
value, arrow, popup background and option contents are replaceable visual parts;
there is no baked arrow in the stretchable frame. This uses ordinary component
children, not a new engine slot-binding schema.

`settings-field-v5.png` is the new Imgen hand-painted pine-green/brass skin.
Its nine-slice source is the actual art region `(92,168,1990,370)`, with
76 px side borders and 68 px top/bottom borders. Transparent source padding
must not be used as the border. The simple vector chevrons preserve their
proportions with `contain`. See SETTINGS-SKIN.md for references and generation.

Input: click anywhere on the field to toggle; selecting an option commits it;
click outside or press Escape to dismiss. Switching between fields closes the
previous popup. While a popup is open, underlying sliders cannot start a drag.
Keyboard users can open with Enter/Space or arrow keys, navigate the list using
arrows/Home/End, and select with Enter. Selection returns focus to its field.

Verification: `tools/verify-combobox-controls.cjs` covers full-field input,
selection, outside/Escape dismissal, persistence, keyboard selection and two
landscape viewport sizes. Engine schema and Canvas pointer tests cover the
reusable primitive. `Unone/tests/combobox-parity-project` compares native Core
and the exported Web runtime for closed, open and selected states.

The existing game's older battle parity fixtures still use the former opening
sequence and fail to leave the menu; the focused ComboBox parity test passes.
Those battle fixtures are outside this control change.

Native graphical player compilation was not completed in this pass: its separate
build hit disk exhaustion, then the optional cold build was stopped. Browser
interaction, Core schema, and native-Core/Web-runtime parity passed. The incomplete
build caches were subsequently cleared at the user's request to recover disk space.
