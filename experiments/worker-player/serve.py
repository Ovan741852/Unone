import argparse,json,re
from pathlib import Path
from http.server import ThreadingHTTPServer,SimpleHTTPRequestHandler
from urllib.parse import urlparse,parse_qs
from functools import partial
p=argparse.ArgumentParser();p.add_argument('directory',type=Path);p.add_argument('--output',type=Path,required=True);p.add_argument('--port',type=int,default=8213);a=p.parse_args();root=a.directory.resolve(strict=True);out=a.output.resolve();out.mkdir(parents=True,exist_ok=True)
class Handler(SimpleHTTPRequestHandler):
 extensions_map={**SimpleHTTPRequestHandler.extensions_map,'.js':'text/javascript','.mjs':'text/javascript','.wasm':'application/wasm'}
 def log_message(self,*args):pass
 def do_POST(self):
  parsed=urlparse(self.path);name=parse_qs(parsed.query).get('name',[''])[0];size=int(self.headers.get('Content-Length','0'))
  if parsed.path!='/__report' or not re.fullmatch(r'[a-z0-9-]{1,60}',name) or not 0<size<=2000000:self.send_error(400);return
  try: data=json.loads(self.rfile.read(size));(out/(name+'.json')).write_text(json.dumps(data,indent=2),encoding='utf-8')
  except Exception as e:self.send_error(400,str(e));return
  self.send_response(200);self.end_headers();self.wfile.write(b'ok');print('Report '+name,flush=True)
print('Serving on port '+str(a.port),flush=True)
ThreadingHTTPServer(('0.0.0.0',a.port),partial(Handler,directory=str(root))).serve_forever()
