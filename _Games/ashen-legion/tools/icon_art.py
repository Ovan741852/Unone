"""Original faceted illustration icon vocabulary, matching Hazel's portrait.

Equipment = a wearable silhouette + material facets + a small ability engraving.
Skills = a large action silhouette; attributes = uncluttered semantic symbols.
"""
from html import escape
from hazel_icon_style import illustrate
INK='#302d23';CREAM='#efdfbd';GOLD='#cba04e'
PALETTES={
 'steel':('#8b998d','#ded5b9','#405347'), 'fire':('#b14a32','#edb764','#5e3028'),
 'storm':('#468d87','#c4dccb','#274c4a'), 'life':('#788745','#d8cb88','#344e32'),
 'frost':('#82a9a3','#e7e7c8','#4b6868'), 'oil':('#69515f','#b49a99','#362e34'),
 'gold':('#bf913b','#f0d48a','#745033'), 'spirit':('#858ea4','#e0dcca','#514f69')}

def p(d,c=CREAM,stroke=None,w=4):
 return f'<path d="{d}" fill="{c}"'+(f' stroke="{stroke}" stroke-width="{w}" stroke-linejoin="bevel"' if stroke else '')+'/>'
def line(d,c=CREAM,w=6):return p(d,'none',c,w)
def poly(points,c):return f'<polygon points="{points}" fill="{c}"/>'
def group(s,transform):return f'<g transform="{transform}">{s}</g>'
def spark(x,y,r=12,c=CREAM):return p(f'M{x} {y-r}L{x+3} {y-3}L{x+r} {y}L{x+3} {y+3}L{x} {y+r}L{x-3} {y+3}L{x-r} {y}L{x-3} {y-3}Z',c)
def coin(x=50,y=50,r=24):
 return p(f'M{x} {y-r}L{x+r*.8} {y-r*.65}L{x+r} {y}L{x+r*.6} {y+r*.85}L{x-r*.35} {y+r}L{x-r} {y+r*.15}L{x-r*.8} {y-r*.65}Z',GOLD,INK,3)+p(f'M{x} {y-r*.72}L{x+r*.65} {y-r*.45}L{x+r*.72} {y}L{x} {y+r*.7}Z',CREAM)+line(f'M{x-6} {y-8}L{x+4} {y-11}L{x+7} {y+8}L{x-3} {y+10}Z','#96652e',4)

FIRE=p('M47 5L69 30L67 47L84 33L88 63L71 91L34 92L15 70L19 41L32 56Z','#df7944')+p('M50 38L66 59L59 66L66 80L41 91L33 71Z',CREAM)
BOLT=p('M57 3L20 52L43 52L32 96L82 39L57 40L72 3Z','#afe1df')+p('M57 3L43 45L63 45L32 96L47 47H31Z',CREAM)
BLADE=p('M17 87L29 96L44 76L32 65Z','#8e5131',INK,3)+line('M23 86L34 91M28 78L39 84','#c58951',2)+p('M14 88L23 84L31 90L29 99L20 100L13 94Z',GOLD,INK,2)
BLADE+=p('M24 60L31 56L60 77L58 85L48 85L46 78L34 70L26 71L20 65Z',GOLD,INK,3)+p('M25 60L32 59L57 78L49 80L34 67L26 68Z',CREAM)
BLADE+=p('M38 60L64 17L95 2L82 35L51 73Z','#90b1b9',INK,3)+p('M38 60L64 17L95 2L48 64Z',CREAM)+p('M48 64L95 2L82 35L51 73Z','#738e85')+line('M40 58L67 19L90 7',CREAM,1.4)
WING=p('M7 72L22 28L89 5L73 33L39 44L73 34L57 56L32 61L60 56L44 76L20 80L42 77L29 93Z',CREAM)+p('M7 72L26 45L73 18L22 62L29 93Z','#7db9ba')
DROP=p('M50 6L75 40L87 64L79 83L51 94L22 84L14 65L26 39Z','#6ba5b3',INK,3)+p('M50 6L49 76L22 84L14 65L26 39Z','#addede')+line('M63 66L61 77L50 82',CREAM,5)
SKULL=p('M26 14L70 10L89 35L84 60L73 66L69 91H34L30 68L15 58L12 35Z',CREAM,INK,3)+p('M25 39L44 44L40 59L24 55ZM61 42L77 35L75 54L59 57ZM50 57L43 72H55Z',INK)+line('M43 79V94M58 79V93',INK,4)
HOUR=p('M23 8H79V20L60 47L79 76V90H23V76L43 48L23 20Z',GOLD,INK,3)+p('M30 20H71L51 44ZM31 78L50 57L71 78Z',CREAM)+line('M21 9H81M21 90H81',INK,5)
EYE=p('M5 50L29 27L61 24L95 48L72 73L34 78Z',CREAM,INK,4)+p('M48 28L65 40L66 60L50 74L37 60L35 42Z','#c69546')+p('M47 38H56L58 58L48 65Z',INK)
SHIELD=p('M15 17L51 5L88 19L81 65L51 95L21 69Z','#8bb0a8',INK,4)+p('M51 5L51 84L26 61L22 25Z',CREAM)
FLAG=line('M23 3V96','#8a693d',5)+line('M21 5V92','#d3b170',1.4)+p('M29 10L48 6L68 17L86 15L77 39L91 67L70 64L50 54L29 60Z','#aa4430',INK,3)+p('M29 10L48 6L51 54L29 60Z','#c47e4f')+p('M48 6L68 17L70 64L50 54Z','#8f3d2d')+p('M68 17L86 15L77 39L91 67L70 64Z','#b75a37')+line('M32 17L43 14M32 53L46 49',GOLD,1.5)
SPIN=p('M83 14L91 49L61 36L74 31C35 5 2 57 40 75L32 94C-17 70 6 4 52 7L82 20Z','#99d4d0')+p('M18 86L10 51L39 64L26 70C66 96 99 45 61 25L70 7C117 31 95 97 49 94L18 81Z',CREAM)
BURST=p('M49 1L57 32L81 10L70 37L99 45L70 57L89 82L60 70L48 99L38 69L10 85L28 58L0 49L30 39L13 11L40 31Z','#e6b36a')+spark(50,50,30)
BOOT=p('M27 13L60 8L67 21L61 60L77 67L88 77L89 87L74 94L18 91L12 83L14 65L23 56Z','#925e39',INK,3)+p('M27 16L41 17L37 60L28 73L14 72L14 65L23 56Z','#c39a63')+p('M41 17L62 16L58 61L43 69L37 60Z','#704b32')+p('M43 69L58 61L77 67L88 77L71 82L28 79L28 73Z','#af8251')+p('M13 82L71 86L89 78L89 89L74 96L18 94L12 89Z','#4d4634')+line('M19 85L72 89L86 85','#b39961',1.6)+p('M23 10L62 5L67 13L66 26L22 29Z','#7c8550',INK,2)+p('M19 58L60 53L60 63L18 68Z','#665537')+p('M35 55L46 54L48 65L36 67Z',GOLD,INK,1.5)+p('M38 58L43 57L45 63L39 64Z','#614d32')
BOTTLE=p('M35 9H64V25H60V40L82 65L83 85L70 96H29L17 85L18 65L40 39V25H35Z','#87bcb2',INK,3)+p('M25 62H76L78 82L66 89H33L22 79Z','#7e9e53')+p('M39 30H47V46L28 68L30 78L23 75L26 60L40 42Z',CREAM)+p('M32 9H68V23H32Z',GOLD,INK,3)
FIST=p('M21 80L11 60L13 32L25 23L40 25L43 19L59 19L68 24L78 23L88 33L89 54L81 73L72 81L75 93L29 98Z','#845136',INK,3)+p('M15 32L24 26L38 29L38 45L25 48L14 43Z','#bd8e5c')+p('M43 24L58 23L65 29L63 45L43 46Z','#a87a4d')+p('M69 29L78 27L84 36L83 49L67 45Z','#b08a57')+p('M21 49L38 41L65 46L77 57L67 69L48 61L39 65L38 80L24 80L14 60Z','#c19b68')+p('M38 65L48 61L67 69L77 57L80 68L69 81L37 87Z','#64482f')+line('M25 48L35 49M44 47L60 49M69 48L80 51','#563c2a',1.3)+p('M24 82L70 78L75 94L28 99Z','#6d7d49',INK,2)+p('M38 82L57 81L59 95L39 97Z',GOLD,INK,2)+p('M42 85L53 85L55 93L43 94Z','#5e5133')
HEART=p('M9 31L23 12L43 15L51 27L60 13L80 10L94 30L89 54L51 94L14 58Z','#ce6154',INK,3)+p('M23 18L41 21L47 37L37 47L20 40Z','#f6c59a')
SNOW=line('M50 4V96M9 26L91 74M9 74L91 26M34 10L50 23L66 10M34 90L50 77L66 90M8 42L29 38L28 18M72 83L71 62L91 57M8 58L29 62L28 82M72 17L71 38L91 43','#c8e6e0',6)
CHAIN=line('M22 62L43 39M56 59L79 36','#e5bc6e',11)+p('M7 62L29 39L47 41L54 57L32 82L14 80ZM48 40L68 17L87 19L95 35L73 60L57 58Z','none',CREAM,7)

def duplicate(s,n=2):return ''.join(group(s,f'translate({i*19} {i*5}) scale(.68)') for i in range(n))
def glyph(k):
 # Every compound symbol carries a different action: trail, cone, rebound, timer, death.
 m={
 'legacy_gift':group(SKULL,'translate(1 3) scale(.52)')+line('M22 76L38 84L73 47',GOLD,8)+group(FIRE,'translate(46 18) scale(.53)')+spark(73,29,17)+line('M53 87H92',CREAM,5),
 'guard_bequest':group(SHIELD,'translate(15 1) scale(.86)')+line('M63 7L42 36L66 48L37 84',INK,8)+group(SKULL,'translate(0 64) scale(.31)')+spark(87,57,13),
 'comrade_oath':group(FLAG,'translate(-3 0) scale(.8)')+group(SHIELD,'translate(46 42) scale(.51)')+spark(67,16,12),
 'resonant_debt':EYE+''.join(spark(15+i*17,89,7,GOLD) for i in range(5)),
 'contact_mine':p('M12 51L27 35H69L88 53L79 85L51 97L21 83Z','#bda364',INK,4)+p('M12 51L51 66L88 53L69 35H27Z','#ecd496')+p('M32 21L45 45L38 61L26 50ZM58 16L70 42L61 54L53 37Z','#ac5044',INK,3)+spark(51,71,14),
 'step_orb':group(BOOT,'translate(2 29) scale(.66)')+p('M59 6L84 22L93 44L73 65L49 57L36 33Z','#b3bb99',INK,3)+p('M59 6L66 33L36 33Z',CREAM)+spark(71,35,18),
 'gravity_law':SPIN.replace('#99d4d0','#9e8ac1')+p('M49 28L68 38L75 56L52 75L30 65L25 43Z','#373645',INK,3)+spark(78,9,8),
 'quick_chant':HOUR+group(WING,'translate(40 15) scale(.62)'),
 'overload_script':p('M4 15L41 7L53 19L91 8L98 76L56 93L41 83L9 91Z','#7b5363',INK,4)+p('M12 23L38 17L48 30V76L38 72L17 78ZM57 29L84 18L89 67L58 80Z',CREAM)+group(BURST,'translate(31 25) scale(.53)'),
 'storm_payload':group(SHIELD,'translate(1 5) scale(.86)')+group(BOLT,'translate(42 3) scale(.58)')+line('M8 78L30 66L52 75L72 63','#a9cfd0',6),
 'pierce':BLADE+line('M7 37L30 20M16 48L39 31','#deab55',5),
 'landing_spin':group(SPIN,'translate(2 2) scale(.95)')+group(BLADE,'translate(25 25) scale(.55)'),
 'lightning':BOLT+line('M28 29L10 22M73 71L94 77','#77afc4',6),
 'critical':EYE+spark(84,17,13), 'third_crit':EYE+line('M31 5V17M48 2V14M65 2V14',GOLD,5),
 'king_hunter':EYE+group(crown(),'translate(28 -2) scale(.48)'),
 'ember_burst':BURST+group(FIRE,'translate(25 20) scale(.54)'), 'longlife':HEART+line('M46 36V67M32 51H62',CREAM,8),
 'expire_burst':BURST+group(HOUR,'translate(30 21) scale(.5)'),
 'rebound_charge':line('M7 72L51 29L91 69M5 17H96','#9fdad6',8)+spark(51,29,13),
 'haste':WING, 'bounce_life':group(SPIN,'scale(.95)')+group(HEART,'translate(29 30) scale(.46)'),
 'crit_power':FIST+spark(23,22,16), 'finisher':BLADE+group(SKULL,'translate(6 7) scale(.4)'),
 'frost_touch':SNOW, 'frenzy':FLAG+group(BLADE,'translate(45 39) scale(.58)'),
 'momentum':BLADE+line('M4 77L22 60M2 55L24 33M27 99L46 81','#81c1c6',6),
 'shock':BURST+group(FIST,'translate(27 27) scale(.5)'), 'shatter':SNOW+group(BLADE,'translate(31 22) scale(.6)'),
 'ricochet_precision':group(EYE,'translate(14 32) scale(.7)')+line('M8 39L49 10L90 37M3 3H97',GOLD,5),
 'hunter_vigor':group(HEART,'translate(0 20) scale(.8)')+group(BLADE,'translate(45 5) scale(.56)'),
 'piercing_wave':duplicate(BLADE,3), 'slow_force':group(BOOT,'scale(.83)')+line('M63 29L87 21L88 66L65 59Z',GOLD,8),
 'spin_master':SPIN+group(crown(),'translate(32 30) scale(.4)'),
 'last_stand':SHIELD+line('M54 23L42 49L62 56L44 81','#b54947',7),
 'heat':FIST+group(FIRE,'translate(56 -2) scale(.43)'),
 'distance':duplicate(BOOT)+line('M12 98L40 92L57 96L92 89',GOLD,4),
 'heavy':SHIELD+group(FIST,'translate(37 34) scale(.44)'),
 'bounce_power':line('M9 74L49 30L86 76M8 15H91',GOLD,9)+spark(49,30,20),
 'wall_quake':line('M8 9H93M50 15V48M37 37L50 51L63 37',CREAM,7)+line('M49 55L25 70L39 81L18 94M58 55L80 68L65 82L88 94','#ba835a',7),
 'short_fuse':group(FIRE,'translate(4 1) scale(.8)')+group(HOUR,'translate(58 48) scale(.4)'),
 'wide_blade':axe(), 'hit_echo':duplicate(BLADE)+line('M76 66L84 54L91 73L84 91','#9ed8de',5),
 'fracture':SHIELD+line('M58 5L38 35L66 50L35 86',INK,7),
 'solo_hunt':EYE+line('M50 8V0M50 100V88M0 50H14M87 50H100',GOLD,5),
 'crowd_ring':SPIN+duplicate(SKULL,3), 'recruit':FLAG+line('M65 64V94M50 79H80',CREAM,8),
 'rally':duplicate(FLAG,3), 'rapid':WING+group(FLAG,'translate(57 38) scale(.48)'),
 'solitary':SHIELD+group(EYE,'translate(30 33) scale(.43)'),
 'showdown':duplicate(BLADE)+group(crown(),'translate(46 7) scale(.49)'),
 'sharp':BLADE+spark(81,42,11), 'giant':FIST+line('M8 63V16L17 26M93 71V91H76',GOLD,6),
 'double_pierce':duplicate(BLADE), 'deadly':SKULL+spark(82,20,14),
 'flame_cloak':p('M50 8L79 27L95 89L53 77L9 93L24 27Z','#b74436',INK,4)+group(FIRE,'translate(29 31) scale(.48)'),
 'phoenix_fire':p('M49 20L8 5L19 43L40 62L27 94L52 77L74 96L63 61L85 45L98 8L60 25L52 6Z','#e9a358',INK,3)+p('M51 34L60 46L51 73L43 46Z',CREAM),
 'plague_vial':BOTTLE+group(SKULL,'translate(33 58) scale(.35)'),
 'ember_trail':group(FIRE,'translate(5 -1) scale(.7)')+group(BOOT,'translate(38 32) scale(.64)'),
 'slick_oil':DROP.replace('#6ba5b3','#54445d').replace('#addede','#a08ba6')+group(BLADE,'translate(44 48) scale(.49)'),
 'rain_strike':duplicate(DROP,3)+line('M4 91H94','#79b7c3',5),
 'storm_touch':BOLT+group(FIST,'translate(51 50) scale(.49)'),
 'oil_legacy':group(DROP,'translate(7 0) scale(.7)').replace('#6ba5b3','#54445d').replace('#addede','#a08ba6')+group(SKULL,'translate(46 50) scale(.48)'),
 'plunder':coin(59,32,22)+group(FIST,'translate(6 33) scale(.68)'),
 'firstborn':WING+line('M51 20L53 3L66 9L67 30M72 24L91 9L94 22L78 42',GOLD,7),
 'march_capacitor':group(BOOT,'translate(0 14) scale(.73)')+group(BOLT,'translate(47 2) scale(.51)'),
 'delayed_bloom':HOUR+group(FIRE,'translate(50 51) scale(.48)'),
 'third_pulse':BURST+line('M29 39V67M49 27V67M69 15V67','#4f5674',10),
 'battle_elegy':FLAG+group(FIRE,'translate(46 43) scale(.5)'),
 'grave_bloom':FIRE+group(SKULL,'translate(33 47) scale(.43)'),
 'last_echo':SNOW+group(HOUR,'translate(34 31) scale(.37)'),
 'cinder_seal':HOUR+group(FIRE,'translate(50 43) scale(.53)')+spark(16,54,12),
 'chain_fuse':CHAIN+group(FIRE,'translate(51 -6) scale(.48)'),
 'thunder_fan':''.join(group(BOLT,f'translate(50 90) rotate({a}) translate(-13 -77) scale(.29 .8)') for a in [-48,0,48])+spark(50,86,13),
 'echo_blade':group(BLADE,'translate(-2 14) scale(.82)').replace(CREAM,'#857ba4')+group(BLADE,'translate(24 -3) scale(.78)'),
 'starfall':p('M96 0L76 60L52 80L19 63L38 38L59 25L42 49L71 16L65 45Z','#e8b062')+p('M43 48L63 58L58 80L34 89L18 70Z','#c15e47',INK,3)+p('M43 48L42 70L18 70Z',CREAM),
 'soul_return':group(SPIN,'scale(.98)').replace('#99d4d0','#8b9fbf')+group(BLADE,'translate(23 17) scale(.59)'),
 }
 return m.get(k,BURST)
def crown():return p('M10 32L30 48L49 8L69 47L92 29L82 81H21Z',GOLD,INK,4)+p('M21 64H82V81H21Z',CREAM)+p('M50 32L59 51L50 65L40 51Z','#ba5945')
def axe():return line('M24 93L77 16','#af8150',9)+p('M39 9L58 27L88 15L95 44L79 68L60 63L49 43L22 40Z','#89abb5',INK,4)+p('M22 40L39 9L45 28L55 38L49 43Z',CREAM)+p('M88 15L95 44L79 68L70 61L82 39Z',CREAM)

def family(k):
 if k=='legacy_gift':return 'gold'
 if k=='guard_bequest':return 'spirit'
 if k in ['lightning','thunder_fan','storm_touch','march_capacitor','third_pulse','firstborn','momentum','storm_payload','quick_chant']:return 'storm'
 if any(s in k for s in ['fire','flame','ember','fuse','cinder','bloom','heat','starfall']):return 'fire'
 if any(s in k for s in ['frost','shatter','last_echo','rain']):return 'frost'
 if k in ['gravity_law','resonant_debt','overload_script']:return 'spirit'
 if k=='comrade_oath':return 'life'
 if k in ['contact_mine','step_orb']:return 'gold'
 if 'oil' in k or 'plague' in k:return 'oil'
 if any(s in k for s in ['life','vigor','recruit','rally']):return 'life'
 if any(s in k for s in ['soul','echo','elegy']):return 'spirit'
 if any(s in k for s in ['crit','king','plunder','deadly','showdown']):return 'gold'
 return 'steel'

def wearable(k,slot):
 a,b,c=PALETTES[family(k)];edge=INK
 if k=='legacy_gift':
  shape=line('M30 23V11L51 2L74 12V25',GOLD,6)+p('M25 26L51 15L78 28L82 79L51 98L21 80Z',c,edge,4)+p('M29 32L50 24V85L27 75Z',a)+p('M54 25L73 32L76 74L55 86Z',b)+group(FIRE,'translate(34 38) scale(.35)')+line('M51 18V92M25 27L77 27M23 80L79 80',GOLD,5)
 elif k=='guard_bequest':
  shape=p('M14 83L11 42L30 18L63 9L85 30L91 82L65 90L56 54L38 61L33 94Z',a,edge,4)+p('M30 18L48 33L24 46L14 83L11 42Z',b)+line('M64 9L47 30L63 44L43 73',edge,6)+spark(70,64,10)
 elif k=='overload_script':
  shape=glyph(k)
 elif k=='chain_fuse':
  shape=p('M18 22L63 12L85 29L84 86L39 98L14 80Z','#885d43',edge,4)+p('M18 22L39 36L39 98L14 80Z','#d0ad70')+p('M39 36L85 29L84 86L39 98Z','#593f3d')
  for x,y in [(42,40),(66,32),(63,69)]:
   shape+=p(f'M{x-12} {y-6}L{x+4} {y-11}L{x+15} {y+2}L{x+10} {y+19}L{x-7} {y+23}L{x-16} {y+8}Z',a,edge,3)+p(f'M{x-12} {y-6}L{x+4} {y-11}L{x} {y+5}L{x-16} {y+8}Z',b)+line(f'M{x} {y-10}L{x+1} {y-18}L{x+10} {y-23}',GOLD,3)
 elif k=='starfall':
  shape=p('M30 32L51 23L72 30L81 86L53 96L21 83Z',c,edge,4)+p('M30 32L51 23L49 81L21 83Z',a)+p('M5 33L22 12L40 14L46 43L27 55L8 49ZM62 16L80 8L97 27L94 50L76 55L60 40Z',a,edge,4)+p('M5 33L22 12L40 14L27 34ZM62 16L80 8L78 32L60 40Z',b)+p('M36 70L69 66L74 78L34 85Z',GOLD)
 elif k=='thunder_fan':
  shape=''.join(p(f'M{49+n*9} 70L{44+n*11} {13+abs(n)*5}L{55+n*15} {3+abs(n)*5}L{56+n*10} 68Z',b if n%2 else a,edge,2) for n in [-2,-1,0,1,2])+p('M20 59L51 72L83 57L80 84L51 96L22 83Z',GOLD,edge,4)+p('M51 72L83 57L80 70L51 83L20 70L20 59Z',CREAM)
 elif slot==1:
  if any(s in k for s in ['third','spin','thunder','showdown','deadly','recruit']):shape=group(crown(),'translate(0 7) scale(1 .9)')
  elif k=='last_stand':shape=p('M5 30L85 23L89 58L12 62L1 83L26 73L29 53Z',a,edge,4)+p('M17 31L72 28L62 39L18 45Z',b)
  else:shape=p('M14 73L18 29L44 8L74 13L90 39L89 80L66 92L66 53L43 62L43 93L23 85Z',a,edge,4)+p('M20 29L44 8L58 25L45 47L14 60Z',b)+p('M50 26L74 13L88 40L64 46Z',c)+p('M20 60L40 63L39 72L22 68ZM67 53L84 49L84 60L69 66Z',edge)+p('M14 57L89 40L92 47L14 65Z',GOLD)
 elif k=='contact_mine':
  shape=p('M16 21L71 12L90 34L88 84L39 97L9 78Z','#957154',edge,4)+p('M16 21L39 34L39 97L9 78Z','#e6c58d')+group(glyph(k),'translate(23 24) scale(.69)')
 elif slot==2:
  if k in ['frenzy','rally','battle_elegy','comrade_oath']:shape=FLAG+group(glyph(k),'translate(38 18) scale(.38)')
  elif k in ['flame_cloak','solitary']:shape=p('M36 11L69 8L84 29L98 94L60 80L44 97L4 91L18 29Z',a,edge,4)+p('M36 11L47 27L27 81L5 91L18 29Z',b)+p('M69 8L84 29L98 94L62 77L56 25Z',c)+p('M35 23L58 29L72 21L60 37L45 39Z',GOLD)
  else:shape=p('M25 13L40 26H61L75 10L96 36L88 52L77 42L82 91L58 97L22 90L26 45L12 57L3 39Z',a,edge,4)+p('M25 13L40 26L46 83L22 90L26 45L12 57L3 39Z',b)+p('M61 26L75 10L96 36L88 52L77 42L82 91L58 97L54 55Z',c)+p('M24 70L78 65L80 77L23 83Z',GOLD)+p('M44 69L58 67L60 78L46 80Z',edge)
 elif slot==3:shape=group(BOOT.replace('#879b95',c).replace(CREAM,a),'translate(27 -2) scale(.8)')+group(BOOT.replace('#879b95',a).replace(CREAM,b),'translate(-1 15) scale(.86)')
 elif slot==4:
  if k in ['cinder_seal','rain_strike','resonant_debt','quick_chant']:shape=p('M49 15L74 26L87 48L85 74L61 91L33 89L12 70L11 42L28 22ZM47 35L29 47L30 65L44 72L64 68L70 51L61 38Z',GOLD,edge,4)+p('M49 15L74 26L61 38L47 35L28 22Z',CREAM)+p('M57 4L76 20L63 39L44 28L40 12Z',a,edge,3)+p('M57 4L63 24L44 28L40 12Z',b)
  elif k=='plague_vial':shape=group(BOTTLE,'translate(8 -3) scale(.86)')+p('M8 57L73 60L78 92L8 93Z','#996d4e',edge,4)+p('M21 55L30 56V92H21ZM54 58H63V92H54Z',GOLD)
  else:shape=FIST.replace('#b1c2b6',a).replace(CREAM,b)+p('M28 83L66 80L69 96L29 98Z',c)
 else:
  if k in ['wide_blade','third_pulse']:shape=axe()
  elif k in ['landing_spin','momentum','double_pierce','lightning','crowd_ring']:shape=line('M18 95L72 19','#aa7952',7)+p('M65 28L62 7L90 0L88 29L74 37Z',a,edge,3)+p('M62 7L90 0L70 27Z',b)+p('M58 33L78 44L82 35L63 24Z',GOLD)
  elif k=='phoenix_fire':shape=line('M28 94L55 20','#956140',9)+group(glyph(k),'translate(20 -7) scale(.75)')
  elif k=='echo_blade':shape=duplicate(BLADE)
  else:shape=BLADE.replace('#90b1b9',a).replace(CREAM,b)
 # Small engraved glyph off-centre leaves the equipment shape readable.
 return shape+group(glyph(k), 'translate(68 67) scale(.32)')

def svg(name,body,bg=False):
 back=p('M10 6L86 2L98 17L95 89L83 98L8 94L2 77L4 18Z','#343b40')+p('M10 7L54 5L24 28L6 70L5 19Z','#4b5554')+line('M14 8L83 4L94 17M92 86L81 94L14 91','#c29a5f',1.3) if bg else ''
 return f'<svg xmlns="http://www.w3.org/2000/svg" width="256" height="256" viewBox="0 0 100 100" role="img" aria-label="{escape(name)}"><title>{escape(name)}</title>{back}<g stroke-linejoin="bevel">{body}</g></svg>'
def equipment_icon(k,slot,name):return svg(name,group(wearable(k,slot),'translate(7 6) scale(.87)'))
def skill_icon(k,name):return svg(name,group(glyph(k),'translate(7 7) scale(.86)'))

def common_icons():
 simple={'life':HEART,'attack':BLADE,'crit':glyph('critical'),'speed':WING,'pierce':glyph('pierce'),'spin':SPIN,'coin':coin(),'crystal':p('M49 4L78 24L85 65L49 97L14 65L23 22Z','#9c91bf',INK,4)+p('M49 4L49 76L23 22Z','#ded7e8')+p('M49 76L78 24L85 65L49 97Z','#645878'),
 'helmet':wearable('critical',1),'body':wearable('longlife',2),'boots':wearable('haste',3),'gloves':FIST,'weapon':BLADE,'crown':crown(),
 'potion-haste':BOTTLE+group(WING,'translate(37 58) scale(.33)'), 'potion-life':BOTTLE.replace('#7e9e53','#be645b')+group(HEART,'translate(35 60) scale(.33)'),
 'potion-recall':BOTTLE.replace('#7e9e53','#8e7bb0')+group(SPIN,'translate(34 60) scale(.34)'),
 'curse-debt':SKULL+group(coin(),'translate(53 54) scale(.47)'), 'curse-frail':SHIELD+line('M60 4L39 39L64 53L38 85','#bd6267',8),
 'curse-slow':BOOT+group(CHAIN,'translate(39 47) scale(.56)'),
 'rune':p('M33 5L72 12L91 46L75 89L39 98L12 62L18 27Z','#677f78',INK,4)+p('M33 5L43 39L12 62L18 27Z','#b9c9af')+line('M37 23L63 30L42 52L65 69L40 82','#f3dba0',7),
 'refresh':SPIN,'sell':coin()+group(BLADE,'translate(61 60) scale(.3)'),
 'lock':line('M27 44V25L39 13H62L76 27V44',GOLD,9)+p('M20 42H81V89L53 98L19 88Z','#8ca79d',INK,4)+p('M24 46H48V87L24 81Z',CREAM)+p('M50 55L62 60V70L57 76V84H47V75L42 69V60Z',INK),
 'auto':SPIN+group(EYE,'translate(24 35) scale(.52)'), 'pause':p('M23 13H42V88H23ZM59 13H78V88H59Z',CREAM,INK,4),
 'close':line('M23 20L78 79M77 20L22 79',CREAM,12),
 'map':p('M6 20L31 8L63 22L92 9L89 82L65 94L35 81L8 93Z','#d3bb83',INK,4)+p('M31 8L35 81L8 93L6 20Z','#f0ddad')+line('M20 65L42 40L64 58L82 36','#a46b4b',5)+spark(64,58,8,'#874b43'),
 'sound':p('M8 41H27L54 19V85L27 64H8Z',CREAM,INK,4)+line('M67 34L77 44V61L67 72M78 21L93 38V69L80 85',GOLD,5)}
 simple['sword']=BLADE;simple['spear']=wearable('momentum',5);simple['cavalry']=p('M25 89L31 62L17 49L37 23L44 3L56 17L68 13L81 30L94 40L86 63L66 58L57 75L57 93Z','#c4c7b4',INK,4)+p('M44 3L56 17L49 39L31 62L17 49L37 23Z',CREAM)+p('M61 33L70 28L73 38L64 41Z',INK)+line('M79 51L93 45M29 69L60 83','#ab5b48',7)
 return {f'icon-{k}':svg(k,group(s,'translate(6 5) scale(.88)')) for k,s in simple.items()}

def buildings():
 # Miniature places in Hazel's world: plaster, split timber, cloth, moss and
 # warm lit windows. Each shop has its own massing and identifiable silhouette.
 ground=p('M3 82L25 74L78 74L99 85L77 97L27 98L5 91Z','#556a40')+p('M18 87L53 80L83 87L68 96L34 94Z','#9b9570')
 wall=p('M23 44L57 29L83 45V82L52 94L22 82Z','#b39766',INK,3)+p('M23 44L52 57V94L22 82Z','#dac395')+p('M52 57L83 45V82L52 94Z','#687354')
 timbers=line('M24 49V81L51 91V58M55 58L82 47M27 76L48 85','#74573b',3)
 roof=p('M15 45L39 15L63 10L92 41L54 61Z','#994730',INK,3)+p('M15 45L39 15L54 61Z','#d39a61')+p('M39 15L63 10L92 41L54 61Z','#914637')+line('M26 42L49 51M35 30L69 49M52 19L82 39','#b66543',2)
 door=p('M32 66L36 62L44 65L47 71V87L32 80Z','#314a36')+line('M39 67V82',GOLD,1.2)
 lantern=lambda x,y:group(p('M0 1L7-1L12 3L11 14L4 17L0 13Z','#86603a',INK,2)+p('M3 4L8 3V12L3 13Z','#f6cf79')+line('M6-1V-5',GOLD,2),f'translate({x} {y})')
 market=ground+p('M15 51L54 39L88 54V83L53 94L17 84Z','#9b744e',INK,3)+p('M17 66L52 75V93L17 84Z','#c99b61')
 market+=p('M7 46L27 18L69 13L95 40L87 60L48 74L9 60Z','#a4402f',INK,3)+p('M27 18L69 13L48 55L7 46Z','#b95b3a')
 market+=p('M28 18L40 17L22 48L35 51L53 15L64 14L48 55L41 69L28 66L35 51L22 48L18 63L9 60L7 46Z','#e6d4a6')
 market+=p('M69 13L95 40L87 60L48 74L48 55Z','#687744')+line('M10 47L48 57L94 41M49 59V72',GOLD,2)
 market+=line('M12 63V84M88 59V84','#62462e',3)+p('M23 78L36 73L49 78L49 88L35 93L22 88Z','#7f552f',INK,2)+line('M24 79L35 84L48 79M35 84V92',GOLD,1.5)
 market+=group(coin(),'translate(53 67) scale(.31)')+lantern(75,39)+p('M51 81L58 73L65 77L60 85Z','#bc5737')
 forge=ground+wall+timbers+roof+p('M65 7L79 3L88 8L85 45L73 51L65 43Z','#686c59',INK,3)+p('M65 7L73 12V51L65 43Z','#c3b58c')+p('M63 7L78 0L91 5L88 14L74 19L63 14Z','#d4c092',INK,2)
 forge+=p('M28 83V64L36 55L49 57L56 66V89L43 94Z','#54382c',INK,3)+p('M31 82V66L38 60L46 63L51 69V85Z','#bd6534')+group(FIRE,'translate(31 64) scale(.24)')
 forge+=p('M60 68L88 63L95 66L84 75L69 77L70 83L84 86L67 92L57 87L62 79L55 73Z','#596f65',INK,2)+p('M60 68L88 63L95 66L69 73L55 73Z','#d4d7b6')+line('M25 37L38 21',GOLD,2)+lantern(17,50)
 alchemy=ground+wall+timbers+door+p('M17 45L33 26L37 4L55 8L74 23L89 42L56 62Z','#5c7142',INK,3)+p('M17 45L33 26L37 4L45 20L37 41L56 62Z','#a0a367')
 alchemy+=p('M37 4L55 8L53 24L45 20Z','#be8b52')+line('M47 27L72 33M55 44L79 43','#344f36',2)
 alchemy+=p('M59 61L71 54L77 59V71L60 78Z','#e0ba6a',INK,2)+line('M67 58V75M59 65L77 63','#745e38',2)+group(BOTTLE,'translate(1 50) scale(.40)')+lantern(72,40)
 alchemy+=p('M75 83L79 78L84 82L81 90L76 92Z','#755338')+p('M73 80L77 74L85 76L89 81L83 84Z','#b0523b')
 barracks=ground+p('M20 42L52 29L85 45V85L50 95L19 82Z','#c0b38c',INK,3)+p('M50 55L85 45V85L50 95Z','#64725c')
 barracks+=p('M16 35L27 30L29 39L40 35L39 27L53 22L54 30L65 28L66 18L80 25L78 34L90 39L86 54L52 65L18 53Z','#d1c297',INK,2)
 barracks+=p('M29 70L39 60L48 64L50 73V89L29 81Z','#424e39')+p('M62 65L74 61V81L62 86Z','#243d35')+line('M24 58L45 66M56 60L81 52M22 78L27 80',GOLD,1.5)
 barracks+=group(FLAG,'translate(38 -3) scale(.54)')+group(SHIELD,'translate(60 58) scale(.30)')+lantern(18,51)
 keep=ground+p('M28 47L51 34L78 47V85L51 95L28 84Z','#c7b58d',INK,3)+p('M51 59L78 47V85L51 95Z','#7d8465')
 for x,y in [(7,24),(70,16)]:
  keep+=group(p('M3 22L14 15L29 24V62L15 71L2 64Z','#d9c69b',INK,2)+p('M14 15L29 24V62L15 71Z','#73826a')+p('M0 23L12 0L19 0L33 24L15 34Z','#a04931',INK,2)+p('M0 23L12 0L15 34Z','#d5955b')+p('M10 39L17 37V51L10 54Z','#354b3b'),f'translate({x} {y})')
 keep+=p('M23 47L45 15L58 14L83 44L52 61Z','#9e4c34',INK,2)+p('M23 47L45 15L52 61Z','#bd814e')+p('M43 89V74L48 66L58 68L64 77V88L53 93Z','#3c4e36')+group(FLAG,'translate(41 -5) scale(.40)')
 curse=ground+p('M18 55L46 33L78 48L82 85L48 96L17 83Z','#77745d',INK,3)+p('M18 55L48 64V96L17 83Z','#c0ae84')
 curse+=p('M7 53L24 31L25 13L44 7L40 26L65 17L91 49L51 70Z','#594139',INK,3)+p('M7 53L24 31L25 13L35 17L29 38L51 70Z','#92523b')
 curse+=p('M52 72L63 62L73 69L74 86L52 94Z','#343b31')+group(SKULL,'translate(33 45) scale(.31)')+line('M12 90L8 74L14 66L8 53M8 74L2 68M81 88L90 75L86 62L96 50M90 75L98 75','#494830',3)+lantern(24,61)
 return {f'building-{k}':svg(k,group(s,'translate(4 4) scale(.92)')) for k,s in [('market',market),('forge',forge),('alchemy',alchemy),('barracks',barracks),('keep',keep),('curse',curse)]}

def write_all(out,manifest,skill_names=None):
 for g in manifest:
  (out/f"gear-{g['id']}.svg").write_text(illustrate(equipment_icon(g['id'],g['slot'],g['name'])),encoding='utf8')
  (out/f"skill-{g['id']}.svg").write_text(illustrate(skill_icon(g['id'],(skill_names or {}).get(g['id'],g['name']))),encoding='utf8')
 for name,s in {**common_icons(),**buildings()}.items():(out/f'{name}.svg').write_text(illustrate(s),encoding='utf8')
 for name in ['sword','spear','cavalry','lock','auto','pause','coin','crystal']:
  (out/f'symbol-{name}.svg').write_text(illustrate(common_icons()[f'icon-{name}']),encoding='utf8')
 # Retained asset for development viewers; no manual-mode button is exposed.
 (out/'symbol-manual.svg').write_text(illustrate(svg('瞄準準星',group(EYE,'translate(19 25) scale(.62)')+line('M50 8V25M50 76V92M8 50H24M76 50H92',GOLD,5))),encoding='utf8')
