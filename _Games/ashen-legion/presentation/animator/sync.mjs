// Generic presentation clock for two or more visual players. Gameplay and
// root movement remain outside this module.

export function createAnimationGroup({ players = [], master = 0 } = {}) {
  if (!Array.isArray(players) || players.length === 0) throw new Error("Animation group needs at least one player.");
  if (!Number.isInteger(master) || !players[master]) throw new Error("Animation group master index is invalid.");
  let disposed = false;
  function ensureLive() { if (disposed) throw new Error("Animation group has been disposed."); }
  function update(dt) {
    ensureLive();
    for (const player of players) player.update(dt);
    // A horse and rider often use clips with different durations. Keep their
    // presentation phase on the master clock without touching gameplay time.
    const normalizedTime = players[master].getState().normalizedTime;
    for (let index = 0; index < players.length; index += 1) {
      if (index === master) continue;
      const player = players[index];
      if (typeof player.seekNormalized === "function") player.seekNormalized(normalizedTime);
      else player.seek(player.getState().duration * normalizedTime);
    }
    return getState();
  }
  function play(state, options) { ensureLive(); return players.map((player) => player.play(state, options)); }
  function pause() { ensureLive(); for (const player of players) player.pause(); }
  function resume() { ensureLive(); for (const player of players) player.resume(); }
  function seek(seconds) {
    ensureLive();
    players[master].seek(seconds);
    const normalizedTime = players[master].getState().normalizedTime;
    for (let index = 0; index < players.length; index += 1) {
      if (index === master) continue;
      const player = players[index];
      if (typeof player.seekNormalized === "function") player.seekNormalized(normalizedTime);
      else player.seek(player.getState().duration * normalizedTime);
    }
    return getState();
  }
  function getState() {
    ensureLive();
    const masterState = players[master].getState();
    return {
      master,
      state: masterState.state,
      normalizedTime: masterState.normalizedTime,
      players: players.map((player) => player.getState()),
      synchronized: players.every((player) => Math.abs(player.getState().normalizedTime - masterState.normalizedTime) < 0.02),
    };
  }
  function dispose() { if (disposed) return; for (const player of players) player.dispose(); disposed = true; }
  return { update, play, pause, resume, seek, getState, dispose };
}
