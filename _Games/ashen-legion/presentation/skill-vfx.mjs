// Presentation-only vocabulary for equipment resonance.
// Gameplay still owns every trigger, number and duration in Luau. This table
// only guarantees that an equipped skill has a legible visual language.
const family = (group, color, pulse = 1) => Object.freeze({group, color, pulse});

export const SKILL_VFX = Object.freeze({
  // Combat events with a distinct hit/readout already have a matching burst.
  pierce: family('motion', 'gold'), landing_spin: family('arc', 'ice'), lightning: family('lightning', 'cyan'),
  critical: family('crit', 'cream'), third_crit: family('crit', 'cream'), crit_power: family('crit', 'gold'), deadly: family('crit', 'red'), king_hunter: family('crit', 'gold'),
  shock: family('shock', 'cyan'), frost_touch: family('frost', 'ice'), shatter: family('frost', 'ice'),
  ember_burst: family('fire', 'ember'), expire_burst: family('fire', 'red'), flame_cloak: family('fire', 'ember'),
  phoenix_fire: family('fire', 'gold'), plague_vial: family('poison', 'jade'), ember_trail: family('fire', 'ember'),
  slick_oil: family('poison', 'violet'), rain_strike: family('water', 'cyan'), storm_touch: family('lightning', 'cyan'),
  oil_legacy: family('poison', 'violet'), storm_payload: family('lightning', 'cyan'), thunder_fan: family('lightning', 'ice'),
  cinder_seal: family('fire', 'ember'), chain_fuse: family('fire', 'red'), echo_blade: family('arc', 'gold'),
  starfall: family('arc', 'violet'), soul_return: family('soul', 'jade'), grave_bloom: family('soul', 'violet'), last_echo: family('frost', 'ice'),
  delayed_bloom: family('arc', 'violet'), third_pulse: family('shock', 'cyan'), resonant_debt: family('arc', 'violet'),
  contact_mine: family('mine', 'gold'), step_orb: family('mine', 'cyan'), gravity_law: family('gravity', 'violet'),
  necromancer: family('soul', 'jade'), legacy_gift: family('bequest', 'gold'), guard_bequest: family('bequest', 'ice'),
  battle_elegy: family('bequest', 'gold'), comrade_oath: family('bequest', 'jade'),

  // Numerical and conditional skills use a quiet persistent attunement mark.
  longlife: family('passive', 'jade'), haste: family('motion', 'cyan'), heavy: family('passive', 'red'),
  bounce_power: family('motion', 'gold'), bounce_life: family('passive', 'jade'), momentum: family('motion', 'gold'),
  finisher: family('crit', 'gold'), frenzy: family('passive', 'red'), last_stand: family('passive', 'red'),
  heat: family('fire', 'ember'), distance: family('motion', 'gold'), wall_quake: family('shock', 'gold'),
  short_fuse: family('fire', 'red'), wide_blade: family('arc', 'ice'), hit_echo: family('arc', 'violet'),
  fracture: family('shock', 'gold'), solo_hunt: family('passive', 'violet'), crowd_ring: family('arc', 'violet'),
  recruit: family('bequest', 'jade'), rally: family('bequest', 'gold'), rapid: family('motion', 'cyan'),
  solitary: family('passive', 'violet'), showdown: family('crit', 'red'), sharp: family('crit', 'gold'),
  giant: family('passive', 'gold'), double_pierce: family('motion', 'gold'), ricochet_precision: family('motion', 'cyan'),
  hunter_vigor: family('soul', 'jade'), piercing_wave: family('motion', 'ice'), slow_force: family('passive', 'violet'),
  spin_master: family('arc', 'ice'), rebound_charge: family('motion', 'gold'),
  firstborn: family('motion', 'cyan'), march_capacitor: family('motion', 'gold'), plunder: family('gold', 'gold'),
  quick_chant: family('passive', 'violet'), overload_script: family('arc', 'violet'),
});

export function skillVfxFamily(id) {
  return SKILL_VFX[id] ?? family('passive', 'violet');
}
