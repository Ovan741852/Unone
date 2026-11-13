# @unone/gestures 0.1.0

Official SDK-bundled pure Luau touch recognition, exposed as
`api.input.gestures`. Declare the exact package version in `runtime_packages`
and enable `physical_input: ordered_physical_v1` in the official Web player.
No npm install, network resolver, custom browser host or renderer is required.

Create one recognizer and feed every ordered physical row exactly once. It
recognizes single-finger pan and two-finger centroid translation, pinch and
rotation. It reports lifecycle events and cancels safely on UI-owned contacts,
focus/reset/capture loss, geometry changes and explicit cancellation. The game
owns hit regions, cameras, bounds, commands and whether rotation is meaningful.

See [the complete contract, typed example and host limits](../../docs/input-gestures.md).
`game api search pinch`, `game api search 手勢`, and
`game api describe input.gestures.create` discover the same installed API.

Source is embedded verbatim into Core. Core and portable SDK inventories include
this manifest, source and guide. Recognition works in deterministic Core replay;
live support follows the host's ordered physical input contract. Native/mobile
live touch acceptance is not implied by the package being installed.
