// Fixed policy for the official Web player, independent of OS animation and
// efficiency preferences. GPU selection remains a browser/driver/OS decision.
export const PRESENTATION_POLICY = Object.freeze({
  ignoreSystemMotionPreferences: true,
  powerPreference: 'high-performance',
});
