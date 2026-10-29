// Shape validation only; equal to the former grouped regex, without regexp stack growth.
export function isProjectedBase64(s){
 if(typeof s!=='string'||s.length%4)return false;
 const padding=s.indexOf('='),end=padding<0?s.length:padding;
 if(padding>=0&&(s.length-padding>2||s.slice(padding)!=='='.repeat(s.length-padding)))return false;
 for(let n=0;n<end;n++){
  const c=s.charCodeAt(n);
  if(!((c>=65&&c<=90)||(c>=97&&c<=122)||(c>=48&&c<=57)||c===43||c===47))return false;
 }
 return true;
}
