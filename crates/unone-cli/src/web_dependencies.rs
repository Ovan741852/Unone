//! Closure validation of literal ES module specifiers and import.meta URL resources.
//! This is not a JavaScript evaluator. Dynamic custom-renderer URLs remain declared inventory.
use anyhow::{Result,bail,ensure};
use std::collections::BTreeSet;

#[derive(Debug,Clone,PartialEq)]
enum Token {Name(String),Text(String),Punct(u8)}
fn name(t:Option<&Token>,expected:&str)->bool {matches!(t,Some(Token::Name(n)) if n==expected)}
fn punct(t:Option<&Token>,expected:u8)->bool {matches!(t,Some(Token::Punct(n)) if *n==expected)}
fn quoted(bytes:&[u8],i:&mut usize,quote:u8)->String {
    *i+=1;let mut text=Vec::new();
    while *i<bytes.len() {let c=bytes[*i];*i+=1;if c==quote {break;}
        if c==b'\\' && *i<bytes.len() {text.push(bytes[*i]);*i+=1;}else{text.push(c);}}
    String::from_utf8_lossy(&text).into_owned()
}
fn regex_start(tokens:&[Token])->bool {
    match tokens.last() {
        None=>true,Some(Token::Punct(c))=>b"(=:[,!;?{".contains(c),
        Some(Token::Name(n))=>["return","case","throw"].contains(&n.as_str()),_=>false,
    }
}
fn tokens(source:&str)->Vec<Token> {
    let b=source.as_bytes();let mut i=0;let mut out=Vec::new();
    while i<b.len() {let c=b[i];
        if c.is_ascii_whitespace(){i+=1;continue;}
        if c==b'/' && b.get(i+1)==Some(&b'/') {while i<b.len()&&b[i]!=b'\n'{i+=1;}continue;}
        if c==b'/' && b.get(i+1)==Some(&b'*') {i+=2;while i+1<b.len()&& &b[i..i+2]!=b"*/"{i+=1;}i=(i+2).min(b.len());continue;}
        if c==b'\''||c==b'"' {out.push(Token::Text(quoted(b,&mut i,c)));continue;}
        if c==b'`' {quoted(b,&mut i,c);continue;}
        if c==b'/' && regex_start(&out) {i+=1;let mut class=false;
            while i<b.len() {let c=b[i];i+=1;if c==b'\\'{i=(i+1).min(b.len());continue;}
                if c==b'[' {class=true;}else if c==b']'{class=false;}else if c==b'/'&&!class{break;}}
            while i<b.len()&&b[i].is_ascii_alphabetic(){i+=1;}out.push(Token::Punct(b'/'));continue;}
        if c.is_ascii_alphabetic()||c==b'_'||c==b'$' {let start=i;i+=1;while i<b.len()&&(b[i].is_ascii_alphanumeric()||b"_$".contains(&b[i])){i+=1;}
            out.push(Token::Name(source[start..i].into()));continue;}
        out.push(Token::Punct(c));i+=1;
    }out
}
fn specifiers(source:&str)->Vec<String> {
    let t=tokens(source);let mut paths=Vec::new();
    for i in 0..t.len() {
        let import=name(t.get(i),"import")&&!punct(i.checked_sub(1).and_then(|n|t.get(n)),b'.');
        let export=name(t.get(i),"export")&&(punct(t.get(i+1),b'{')||punct(t.get(i+1),b'*'));
        if import||export {
            if let Some(Token::Text(path))=t.get(i+1){paths.push(path.clone());continue;}
            if import&&punct(t.get(i+1),b'('){if let Some(Token::Text(path))=t.get(i+2){paths.push(path.clone());}continue;}
            if punct(t.get(i+1),b'.'){continue;}
            for j in i+1..t.len(){if punct(t.get(j),b';'){break;}if name(t.get(j),"from") {if let Some(Token::Text(path))=t.get(j+1){paths.push(path.clone());}break;}}
        }
        if name(t.get(i),"new")&&name(t.get(i+1),"URL")&&punct(t.get(i+2),b'(')
            &&punct(t.get(i+4),b',')&&name(t.get(i+5),"import")&&punct(t.get(i+6),b'.')
            &&name(t.get(i+7),"meta")&&punct(t.get(i+8),b'.')&&name(t.get(i+9),"url") {
            if let Some(Token::Text(path))=t.get(i+3){paths.push(path.clone());}
        }
    }paths
}
fn resolve(source:&str,specifier:&str)->Result<Option<String>> {
    if specifier.starts_with("https:")||specifier.starts_with("http:")||specifier.starts_with("data:")||specifier.starts_with("blob:"){return Ok(None);}
    ensure!(specifier.starts_with('.'),"WEB_MODULE_SPECIFIER_UNSUPPORTED: {source} -> {specifier}");
    let path=specifier.split(['?','#']).next().unwrap();
    ensure!(!path.contains(['\\','%','\0']),"WEB_MODULE_PATH_INVALID: {source} -> {specifier}");
    let mut parts:Vec<_>=source.rsplit_once('/').map(|(parent,_)|parent.split('/').collect()).unwrap_or_default();
    for part in path.split('/') {match part {""|"."=>{},".."=>{ensure!(parts.pop().is_some(),"WEB_MODULE_PATH_ESCAPE: {source} -> {specifier}");},_=>parts.push(part)}}
    Ok(Some(parts.join("/")))
}
pub(crate) fn validate(files:&[(String,Vec<u8>)])->Result<usize> {
    let available:BTreeSet<_>=files.iter().map(|(path,_)|path.as_str()).collect();let mut edges=0;
    for (path,bytes) in files {
        if !path.ends_with(".js")&&!path.ends_with(".mjs"){continue;}
        let source=std::str::from_utf8(bytes)?;
        for specifier in specifiers(source) {if let Some(target)=resolve(path,&specifier)? {
            if !available.contains(target.as_str()) {bail!("WEB_MODULE_DEPENDENCY_MISSING: {path} -> {specifier} ({target})");}edges+=1;
        }}
    }Ok(edges)
}

#[cfg(test)] mod tests {
    use super::*;
    #[test] fn literal_closure_covers_reexports_workers_queries_cycles_and_negative_controls() {
        let mut files=vec![("web/main.js".into(),b"import './a.mjs?v=1';export {a} from './a.mjs';const w=new Worker(new URL('./worker.js',import.meta.url));const s=await import('./a.mjs');".to_vec()),
            ("web/a.mjs".into(),b"import './main.js';export const a=1;".to_vec()),("web/worker.js".into(),b"// import './missing.js';\nconst s=\"import './missing.js'\";const r=/['\"]/;".to_vec())];
        assert_eq!(validate(&files).unwrap(),5);
        files.pop();assert!(validate(&files).unwrap_err().to_string().contains("WEB_MODULE_DEPENDENCY_MISSING"));
        assert!(resolve("a.js","../outside.js").is_err());assert!(resolve("web/a.js","./%2e%2e/a.js").is_err());
    }
}
