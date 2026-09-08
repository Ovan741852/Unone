"""Local release measurement server. Not a production deployment server."""
import argparse, gzip, http.server, json
from pathlib import Path
parser=argparse.ArgumentParser();parser.add_argument('root',type=Path);parser.add_argument('--port',type=int,default=8174);parser.add_argument('--gzip',action='store_true');parser.add_argument('--bind',default='127.0.0.1');args=parser.parse_args()
root=args.root.resolve(strict=True)
class Handler(http.server.SimpleHTTPRequestHandler):
    extensions_map={**http.server.SimpleHTTPRequestHandler.extensions_map,'.mjs':'text/javascript','.js':'text/javascript','.wasm':'application/wasm'}
    def __init__(self,*a,**kw): super().__init__(*a,directory=str(root),**kw)
    def send_head(self):
        path=Path(self.translate_path(self.path))
        if path.is_dir():path=path/'index.html'
        if not path.is_file():return super().send_head()
        raw=path.read_bytes();data=gzip.compress(raw,mtime=0) if args.gzip and 'gzip' in self.headers.get('Accept-Encoding','') else raw
        self.send_response(200);self.send_header('Content-Type',self.guess_type(str(path)));self.send_header('Cache-Control','no-store');self.send_header('Content-Length',str(len(data)))
        if data is not raw:self.send_header('Content-Encoding','gzip')
        self.end_headers()
        import io
        print(json.dumps({'path':self.path,'raw_bytes':len(raw),'body_bytes':len(data)}),flush=True)
        return io.BytesIO(data)
http.server.ThreadingHTTPServer((args.bind,args.port),Handler).serve_forever()
