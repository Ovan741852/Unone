# LEGACY 90-second scenario generator; current tests are maintained in tests/*.test.json.
from pathlib import Path
import json
root=Path(__file__).resolve().parents[1]
def a(**keys): return {'actions':keys}
def pointer(x=0,z=0,down=False,**keys):return {'actions':keys,'pointer':{'position':{'x':x,'y':z},'screen_position':{'x':50,'y':50},'down':down}}
files=[]
def test(name,frames,inputs,expect):
    path=f'tests/{name}.test.json'
    data={'name':name,'frames':frames,'seed':42,'input_sequence':inputs,'assertions':[{'observation':{'key':k,'equals':v}} for k,v in expect.items()]}
    (root/path).write_text(json.dumps(data,separators=(',',':')))
    files.append(path)
test('menu-does-not-spend',60,[],{'phase':'menu','fired':0,'choices':0,'economy_conserved':True})
test('exactly-one-choice',30,[a(Start=True),{},a(Choice1=True)]*1,{'phase':'battle','round':1,'choices':1,'economy_conserved':True})
test('held-choice-cannot-repeat',120,[a(Start=True),{}]+[a(Choice1=True)]*118,{'phase':'battle','choices':1,'fired':0,'economy_conserved':True})
test('pause-freezes-countdown',5500,[a(Start=True),{},a(Choice1=True),{},a(Pause=True)],{'phase':'battle','fired':0,'economy_conserved':True})
test('timeout-loses',5410,[a(Start=True),{},a(Choice1=True)],{'phase':'defeat','round':1,'economy_conserved':True})
test('missed-shots-bankruptcy',1500,[a(Start=True),{},a(Choice1=True)]+[pointer(-9.7,6,True)]*1497,{'phase':'defeat','breaks':0,'economy_conserved':True})
test('one-click-one-soldier',180,[a(Start=True),{},a(Choice1=True),pointer(0,0,True),pointer(0,0,False)],{'phase':'battle','fired':1,'economy_conserved':True})
test('reset-clears-run',60,[a(Start=True),{},a(Choice1=True),pointer(0,0,True),pointer(0,0,False),a(Home=True)],{'phase':'menu','fired':0,'choices':0,'round':1,'economy_conserved':True})
for seat,x,z in [(1,-9.7,7.3),(2,9.7,7.3),(3,-9.7,-7.3),(4,9.7,-7.3)]:
    test(f'corner-reflection-{seat}',38,[a(**{f'Seat{seat}':True}),a(Start=True),{},a(Choice1=True),pointer(x,z,True),pointer(x,z,False)],{'bounces':1,'troops':1,'expired':0,'troops_in_bounds':True,'economy_conserved':True})
test('bounce-does-not-reset-lifetime',310,[a(Start=True),{},a(Choice1=True),pointer(-9.7,6,True),pointer(-9.7,6,False)],{'troops':0,'expired':1,'refunded':0,'breaks':0,'troops_in_bounds':True,'economy_conserved':True})
test('timeout-refunds-survivor-once',5530,[a(Start=True),{},a(Choice1=True)]+[{}]*5337+[pointer(-9.7,6,True),pointer(-9.7,6,False)],{'phase':'defeat','troops':0,'expired':0,'refunded':4,'breaks':0,'economy_conserved':True})
test('timeout-does-not-refund-expired',5530,[a(Start=True),{},a(Choice1=True)]+[{}]*5087+[pointer(-9.7,6,True),pointer(-9.7,6,False)],{'phase':'defeat','troops':0,'expired':1,'refunded':0,'deployment_cost_conserved':True,'troop_count_conserved':True})
test('boss-delayed-before-final30',3590,[a(Start=True),{},a(Choice1=True)],{'boss_present':False,'phase':'battle'})
test('boss-appears-final30',3610,[a(Start=True),{},a(Choice1=True)],{'boss_present':True,'phase':'battle','lock_exclusive':True})
if (root/'tests/discount-refund.test.json').exists(): files.append('tests/discount-refund.test.json')
if (root/'tests/seven-round-victory.test.json').exists(): files.append('tests/seven-round-victory.test.json')
for name in ['horde-paused-single-surge','horde-optional-quiet-round']:
    if (root/f'tests/{name}.test.json').exists(): files.append(f'tests/{name}.test.json')
p=root/'project.unone.json';c=json.loads(p.read_text(encoding='utf-8'));c['test_files']=files;p.write_text(json.dumps(c,ensure_ascii=False,indent=2),encoding='utf-8')
print(f'Created {len(files)} deterministic Unone input replays')
