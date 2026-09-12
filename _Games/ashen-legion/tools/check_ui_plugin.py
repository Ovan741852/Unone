"""Consumer acceptance through the real Unone CLI; never activates staged UI."""
import hashlib
import argparse
import json
import os
from pathlib import Path
import subprocess
import tempfile

GAME = Path(__file__).resolve().parents[1]
ENGINE = GAME.parents[1]
CLI = ENGINE / 'target/debug/game.exe'
PLUGIN = 'org.koncrate.unone-ui'
ENV = dict(os.environ, UNONE_PLUGIN_PATHS=str(ENGINE.parent))


def active_hashes():
    return {str(p.relative_to(GAME)): hashlib.sha256(p.read_bytes()).hexdigest()
            for p in GAME.rglob('*') if p.is_file()
            and '.unone' not in p.relative_to(GAME).parts}


def run(args):
    result = subprocess.run([str(CLI), '--project', str(GAME), '--json',
                             'plugin', *args], env=ENV, capture_output=True,
                            encoding='utf-8', timeout=60)
    data = json.loads(result.stdout)
    assert data['ok'] == (result.returncode == 0), data
    return data


def call(tool, data):
    with tempfile.TemporaryDirectory(prefix='unone-ui-consumer-') as directory:
        path = Path(directory) / 'input.json'
        path.write_text(json.dumps(data, ensure_ascii=False), encoding='utf-8')
        return run(['call', '--id', PLUGIN, '--tool', tool, '--input', str(path)])


def value(result):
    assert result['ok'], result
    return result['value']


def luau_literal(data):
    if data is None:
        return 'nil'
    if isinstance(data, bool):
        return 'true' if data else 'false'
    if isinstance(data, (int, float)):
        return str(data)
    if isinstance(data, str):
        return json.dumps(data, ensure_ascii=False)
    if isinstance(data, list):
        return '{' + ','.join(luau_literal(item) for item in data) + '}'
    return '{' + ','.join('[' + luau_literal(key) + ']=' + luau_literal(item)
                          for key, item in data.items()) + '}'


def native_projection_smoke(nodes):
    """Check generated transport nodes with the engine's strict parser."""
    tree = {'kind': 'screen', 'id': 'projection', 'node': 'battle', 'children': nodes}
    with tempfile.TemporaryDirectory(prefix='unone-ui-projection-') as directory:
        project = Path(directory)
        (project / 'project.unone.json').write_text(json.dumps({
            'name': 'UI projection smoke', 'entry_script': 'main.luau',
            'main_scene': 'scene.json'}), encoding='utf-8')
        (project / 'scene.json').write_text('{"entities":[]}', encoding='utf-8')
        (project / 'main.luau').write_text(
            'return {start=function(api) api.ui.setRoot(' + luau_literal(tree) +
            ') end,update=function(api,dt)end}', encoding='utf-8')
        result = subprocess.run([str(CLI), '--project', str(project), '--json',
                                 'run', '--frames', '2'], env=ENV,
                                capture_output=True, encoding='utf-8', timeout=60)
        data = json.loads(result.stdout)
        assert result.returncode == 0 and data['ok'], data
        assert len(data['value']['world']['ui']['children']) == len(nodes)


def native_transport_smoke():
    """Use the staged module against api.ui.setRoot, not a mock publisher."""
    module = (GAME / '.unone/staging/unone-ui/luau/unone_ui.luau').read_text(
        encoding='utf-8-sig')
    with tempfile.TemporaryDirectory(prefix='unone-ui-native-') as directory:
        project = Path(directory)
        (project / 'project.unone.json').write_text(json.dumps({
            'name': 'Unone UI consumer smoke', 'entry_script': 'main.luau',
            'main_scene': 'scene.json'}), encoding='utf-8')
        (project / 'scene.json').write_text('{"entities":[]}', encoding='utf-8')
        script = 'local UI=(function()\n' + module + '\nend)()\n' + '''
local Game={}
function Game.start(api)
 local toggle=UI.toggle({id="auto",label="AUTO",action="Auto",checked=true,
  rect={x=40,y=10,width=20,height=8}})
 local tree=UI.screen("consumer", "battle", {
  UI.button({id="fire",label="Fire",action="Fire",
   rect={x=10,y=10,width=20,height=8}}), toggle,
  UI.icon_button({id="disabled-icon",icon="X",label="Close",action="Close",disabled=true,
   rect={x=10,y=30,width=20,height=8}}),
  UI.button({id="disabled-button",label="Next",action="Next",disabled=true,
   rect={x=40,y=30,width=20,height=8}}),
  UI.progress_bar({id="guard",label="Guard",value=168,min=0,max=240,
   rect={x=10,y=50,width=60,height=8}}),
  UI.text({id="title",text="Battle",rect={x=10,y=70,width=60,height=8}})
 })
 UI.publish(api,tree)
 assert(toggle.kind=="toggle" and toggle.checked==true,"publish mutated model")
 UI.publish(api,tree)
 api.observation.set("published",true)
end
function Game.update(api,dt)end
return Game
'''
        (project / 'main.luau').write_text(script, encoding='utf-8')
        result = subprocess.run([str(CLI), '--project', str(project), '--json',
                                 'run', '--frames', '2'], env=ENV,
                                capture_output=True, encoding='utf-8', timeout=60)
        data = json.loads(result.stdout)
        assert result.returncode == 0 and data['ok'], data
        assert data['value']['world']['observations']['published'] is True
        children = data['value']['world']['ui']['children']
        assert len(children) == 6
        assert all(c['kind'] == 'button' for c in children[:2])
        assert all(c['kind'] == 'text' and 'action' not in c for c in children[2:])
        assert '70%' in children[4]['text']


def main(contracts_only=False, replace_staging=False):
    before = active_hashes()
    plugins = value(run(['list']))
    assert any(p['id'] == PLUGIN for p in plugins['plugins'])
    manifest = value(run(['inspect', '--id', PLUGIN]))
    value(run(['test', '--id', PLUGIN]))
    components = value(call('ui.list_components', {}))['components']
    tested = []
    engine_nodes = []
    for component in components:
        name = component['id']
        contract = value(call('ui.inspect_component', {'component': name}))
        assert 'example' in contract, f'{name} needs a copyable example'
        generated = value(call('ui.generate', {
            'component': name, 'spec': contract['example']}))
        tree = {'kind': 'screen', 'id': 'consumer', 'node': 'battle',
                'children': [generated['node']]}
        validated = call('ui.validate', {'tree': tree})
        assert validated['ok'], (name, validated)
        for index, node in enumerate(generated.get('engine_nodes', [])):
            engine_nodes.append({**node, 'id': f'{name}-{index}'})
        tested.append(name)

    assert engine_nodes, 'No examples can be projected into the current engine'
    native_projection_smoke(engine_nodes)

    # Recovery evidence must survive the real CLI boundary.
    invalid = call('ui.generate', {'component': 'button', 'spec': {
        'id': 'missing-action', 'label': 'Test',
        'rect': {'x': 10, 'y': 10, 'width': 20, 'height': 8}}})
    assert not invalid['ok']
    assert invalid['diagnostics'][0]['code'] != 'PLUGIN_TOOL_FAILED', invalid
    assert 'spec.action' in json.dumps(invalid['diagnostics']), invalid
    for diagnostic in invalid['diagnostics']:
        assert all(isinstance(action, dict)
                   for action in diagnostic['suggested_actions'])

    bad_anchor = call('ui.generate', {'component': 'button', 'spec': {
        'id': 'bad-anchor', 'label': 'Test', 'action': 'Test',
        'anchor': 'banana', 'size': {'width': 20, 'height': 8}}})
    assert not bad_anchor['ok'], 'Unknown anchor was accepted'
    disabled_toggle = call('ui.generate', {'component': 'toggle', 'spec': {
        'id': 'disabled-toggle', 'label': 'AUTO', 'action': 'Auto',
        'checked': True, 'disabled': True,
        'rect': {'x': 10, 'y': 10, 'width': 20, 'height': 8}}})
    if disabled_toggle['ok']:
        assert disabled_toggle['value']['node']['disabled'] is True, \
            'Toggle silently dropped disabled'
    disabled_icon = call('ui.generate', {'component': 'icon_button', 'spec': {
        'id': 'disabled-icon', 'icon': 'X', 'label': 'Close', 'action': 'Close',
        'disabled': True, 'rect': {'x': 10, 'y': 10, 'width': 20, 'height': 8}}})
    if disabled_icon['ok']:
        assert all(node['kind'] != 'button' and 'action' not in node
                   for node in disabled_icon['value']['engine_nodes']), \
            'Disabled IconButton remains interactive'
    button = value(call('ui.generate', {'component': 'button', 'spec': {
        'id': 'duplicate', 'label': 'Fire', 'action': 'Fire',
        'rect': {'x': 10, 'y': 10, 'width': 20, 'height': 8}}}))['node']
    duplicate = call('ui.validate', {'tree': {'kind': 'screen', 'id': 'screen',
        'node': 'battle', 'children': [button, button]}})
    assert not duplicate['ok'] and 'children[1]' in json.dumps(duplicate)

    if not contracts_only:
        installation = value(call('ui.install', {'replace': replace_staging}))
        assert installation['active_files_changed'] is False
        for file in installation['files']:
            path = file if isinstance(file, str) else file['path']
            target = (GAME / path).resolve()
            assert target.is_relative_to((GAME / '.unone/staging').resolve()), path
        native_transport_smoke()
    assert before == active_hashes(), 'Plugin calls changed active game files'
    print(json.dumps({'ok': True, 'plugin': PLUGIN,
                      'version': manifest['manifest']['version'],
                      'roundtrip_components': tested,
                      'diagnostics_preserved': True,
                      'native_transport_passed': not contracts_only,
                      'active_files_unchanged': True}, ensure_ascii=False))


if __name__ == '__main__':
    parser = argparse.ArgumentParser()
    parser.add_argument('--contracts-only', action='store_true')
    parser.add_argument('--replace-staging', action='store_true',
                        help='Replace previously reviewed staged package files')
    args = parser.parse_args()
    main(args.contracts_only, args.replace_staging)
