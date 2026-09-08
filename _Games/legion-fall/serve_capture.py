"""Loopback-only player server with three fixed capture destinations."""
import argparse,http.server,json
from pathlib import Path
p=argparse.ArgumentParser();p.add_argument('root',type=Path);p.add_argument('--output',type=Path,required=True);p.add_argument('--port',type=int,default=8195);a=p.parse_args()
root=a.root.resolve(strict=True);out=a.output.resolve();out.mkdir(parents=True,exist_ok=True)
class Handler(http.server.SimpleHTTPRequestHandler):
 extensions_map={**http.server.SimpleHTTPRequestHandler.extensions_map,'.wasm':'application/wasm','.mjs':'text/javascript'}
 def __init__(self,*args,**kw):super().__init__(*args,directory=str(root),**kw)
 def end_headers(self):self.send_header('Cache-Control','no-store');super().end_headers()
 def do_POST(self):
  names={'/__capture/demo.webm':'demo.webm','/__capture/poster.png':'poster.png','/__capture/telemetry.json':'telemetry.json'}
  origin=self.headers.get('Origin','');size=int(self.headers.get('Content-Length','0'))
  if self.path not in names or origin!=f'http://127.0.0.1:{a.port}' or not 0<size<64*1024*1024:self.send_error(400);return
  data=self.rfile.read(size)
  if len(data)!=size:self.send_error(400);return
  target=out/names[self.path];target.write_bytes(data)
  self.send_response(200);self.end_headers();self.wfile.write(b'OK');print(json.dumps({'saved':str(target),'bytes':size}),flush=True)
http.server.ThreadingHTTPServer(('127.0.0.1',a.port),Handler).serve_forever()
