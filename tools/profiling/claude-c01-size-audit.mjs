// Report JS modules over a line budget and functions over a body-line budget.
// Heuristic scanner: skips strings, template literals, regex literals and comments; counts
// `function` declarations/expressions and arrow functions with block bodies.
// Usage: node tools/profiling/claude-c01-size-audit.mjs [--module 600] [--function 60] [--json out.json] dir...
import fs from 'node:fs';
import path from 'node:path';
const args=process.argv.slice(2),opt=(k,d)=>{const i=args.indexOf('--'+k);if(i<0)return d;const v=args[i+1];args.splice(i,2);return v;};
const moduleLimit=Number(opt('module',600)),functionLimit=Number(opt('function',60)),out=opt('json',null);
const roots=args.length?args:['web'];
function files(dir){
 const st=fs.statSync(dir);if(st.isFile())return [dir];
 return fs.readdirSync(dir,{withFileTypes:true}).flatMap(e=>{
  const p=path.join(dir,e.name);
  if(e.isDirectory())return ['vendor','node_modules','fixtures'].includes(e.name)?[]:files(p);
  return /\.(m?js)$/.test(e.name)&&!/\.test\.m?js$/.test(e.name)&&!/\.min\.js$/.test(e.name)?[p]:[];
 });
}
// Blank out strings/comments so brace matching sees code only; keep newlines.
function code(text){
 let o='',i=0;const n=text.length;
 while(i<n){
  const c=text[i],d=text[i+1];
  if(c==='/'&&d==='/'){while(i<n&&text[i]!=='\n'){o+=' ';i++;}continue;}
  if(c==='/'&&d==='*'){while(i<n&&!(text[i]==='*'&&text[i+1]==='/')){o+=text[i]==='\n'?'\n':' ';i++;}o+='  ';i+=2;continue;}
  // Regex literal: `/` where an operand is expected (after an operator/opening punctuation).
  if(c==='/'&&/[(,=:[!&|?{};+\-*%<>~^]$|^$|\breturn$/.test(o.trimEnd().slice(-6))){
   let cls=false;o+=' ';i++;
   while(i<n&&text[i]!=='\n'&&(cls||text[i]!=='/')){if(text[i]==='\\'){o+='  ';i+=2;continue;}if(text[i]==='[')cls=true;else if(text[i]===']')cls=false;o+=' ';i++;}
   o+=' ';i++;continue;
  }
  if(c==='"'||c==="'"||c==='`'){const q=c;o+=' ';i++;while(i<n&&text[i]!==q){if(text[i]==='\\'){o+='  ';i+=2;continue;}o+=text[i]==='\n'?'\n':' ';i++;}o+=' ';i++;continue;}
  o+=c;i++;
 }
 return o;
}
function lineAt(text,index){let n=1;for(let i=0;i<index;i++)if(text.charCodeAt(i)===10)n++;return n;}
function functionsOf(src){
 const s=code(src),found=[];
 const re=/(?:function\s*\*?\s*([A-Za-z_$][\w$]*)?\s*\([^)]*\)\s*\{)|(?:([A-Za-z_$][\w$]*)\s*[:=]\s*(?:async\s*)?\([^)]*\)\s*=>\s*\{)|(?:^|[\s,{])([A-Za-z_$][\w$]*)\s*\([^)]*\)\s*\{(?=)/gm;
 let m;
 while((m=re.exec(s))){
  const name=m[1]??m[2]??m[3]??'(anonymous)';
  if(['if','for','while','switch','catch','with','function','return'].includes(name))continue;
  const open=s.indexOf('{',m.index+m[0].length-1);let depth=0,end=open;
  for(;end<s.length;end++){if(s[end]==='{')depth++;else if(s[end]==='}'&&--depth===0)break;}
  const start=lineAt(s,open),stop=lineAt(s,end);
  found.push({name,start_line:start,end_line:stop,lines:stop-start+1});
 }
 return found;
}
const report={module_limit:moduleLimit,function_limit:functionLimit,roots,modules_over:[],functions_over:[]};
for(const root of roots)for(const file of files(root)){
 const text=fs.readFileSync(file,'utf8'),lines=text.split('\n').length,rel=file.split(path.sep).join('/');
 if(lines>moduleLimit)report.modules_over.push({file:rel,lines});
 for(const f of functionsOf(text))if(f.lines>functionLimit)report.functions_over.push({file:rel,...f});
}
report.functions_over.sort((a,b)=>b.lines-a.lines);report.modules_over.sort((a,b)=>b.lines-a.lines);
if(out)fs.writeFileSync(out,JSON.stringify(report,null,1));
console.log(JSON.stringify({modules_over:report.modules_over,functions_over:report.functions_over.map(f=>`${f.file}:${f.start_line} ${f.name} ${f.lines}`)},null,1));
