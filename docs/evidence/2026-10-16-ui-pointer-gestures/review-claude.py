import hashlib
import json
from pathlib import Path
import subprocess
import time

root = Path(__file__).resolve().parents[2]
out = Path(__file__).resolve().parent
scope = ['web/shared/ui-scroll.mjs', 'web/shared/ui-scroll-host.test.mjs',
         'web/player/main.js', 'docs/ui-scroll.md',
         '_Games/harbor-controls/scripts/main.luau']
diff = subprocess.run(['git', 'diff', '--', *scope], cwd=root, capture_output=True, check=True).stdout
(out / 'claude-fixed.diff').write_bytes(diff)
source = '\n'.join('\nFILE: ' + name + '\n' + (root / name).read_text(encoding='utf-8')
                   for name in ['web/shared/ui-scroll.mjs', 'web/shared/canvas-ui.mjs', 'web/player/main.js'])
prompt = ('Independently review this fixed Unone Web UI gesture change. Read-only; do not use tools or edit. '
          'Report only concrete correctness/lifecycle/ownership defects with file/line and a reproducible scenario. '
          'Separate hypotheses and test gaps. Mouse, pen, touch content pans defer row taps; '
          'other controls and world pointer streams must retain complete ownership. '
          'Slider numeric values remain project Luau state. Here is the fixed diff and relevant source:\n' +
          diff.decode('utf-8') + source)
command = ['C:/Users/maverickchiu/.local/bin/claude.exe', '-p', '--tools', '',
           '--strict-mcp-config', '--mcp-config', '{"mcpServers":{}}',
           '--permission-mode', 'plan', '--no-session-persistence',
           '--output-format', 'json', '--max-turns', '2', '--disable-slash-commands']
version = subprocess.run([command[0], '--version'], capture_output=True, text=True, timeout=15).stdout.strip()
began = time.monotonic()
try:
    run = subprocess.run(command, cwd=root, input=prompt.encode('utf-8'), capture_output=True, timeout=55)
    code, stdout, stderr = run.returncode, run.stdout, run.stderr
except subprocess.TimeoutExpired as error:
    code, stdout, stderr = 124, error.stdout or b'', error.stderr or b''
(out / 'claude-stdout.txt').write_bytes(stdout)
(out / 'claude-stderr.txt').write_bytes(stderr)
result = {'baseline': subprocess.run(['git', 'rev-parse', 'HEAD'], cwd=root, capture_output=True, text=True).stdout.strip(),
          'version': version, 'command': command, 'timeout_seconds': 55,
          'duration_seconds': round(time.monotonic() - began, 1), 'exit_code': code,
          'status': 'inspect raw response' if code == 0 else 'not a completed review',
          'diff_sha256': hashlib.sha256(diff).hexdigest(), 'diff_bytes': len(diff),
          'prompt_sha256': hashlib.sha256(prompt.encode('utf-8')).hexdigest(),
          'prompt_bytes': len(prompt.encode('utf-8')), 'scope': scope,
          'stdout_bytes': len(stdout), 'stderr_bytes': len(stderr)}
(out / 'claude-attempt.json').write_text(json.dumps(result, indent=2), encoding='utf-8')
print(json.dumps(result, indent=2))
