let input='';for await(const chunk of process.stdin)input+=chunk;
const request=JSON.parse(input);
console.log(JSON.stringify({ok:request.protocol==='unone.plugin.v1'&&request.tool==='plugin.test',value:{fixture:true,version:'1.0.0',cwd:process.cwd(),project:request.project},diagnostics:[]}));
