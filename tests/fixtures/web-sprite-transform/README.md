# Web sprite transform host probe

This synthetic host fixture is not a validation game or package-only blind test.
The default scaffold's two movement tests are retained only as scaffold tests.
This source-mode negative fixture deliberately refers to undeclared
`asset://probe/missing`: strict asset verification must fail. It tests visible
fallbacks and retained errors, not a publishable game or a passing bundle gate.

The camera is centered at (2,1), zoom 2 and view_height 12. A cyan image has
rotation +pi/6 and nonuniform scale (1.5,0.75). A small procedural sprite with
ID `2` must cover the image with ID `10` at the same center/layer: this tests
UTF-8 lexical order rather than numeric object-key enumeration. A layer -2 blue
rectangle belongs behind both. The large hidden sprite must not render.

Expected image center equals the viewport center. Positive rotation points the
arrow upward-right on screen. The collider on the background is independent of
its visual size. Browser screenshots prove only the exercised Web host.

Run the source-mode runner with
`?project=/Unone/tests/fixtures/web-sprite-transform/&bundle=0&seed=42`
from a server rooted at `D:/Projects`.
