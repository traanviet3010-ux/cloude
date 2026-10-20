import http from "node:http";
import https from "node:https";
import {createReadStream,statSync} from "node:fs";
import {resolve,extname,sep} from "node:path";
import {fileURLToPath} from "node:url";
import proxyModule from "http-proxy";

const app=resolve(fileURLToPath(new URL(".",import.meta.url)),"dist");
const PORT=Number(process.env.PORT||10000);
const backend="https://hieusro-icons-srweb-stage-20261020.onrender.com";
const cdn="https://hieusro-assets-cdn-test-20261020.onrender.com";
const proxy=proxyModule.createProxyServer({changeOrigin:true,secure:true,xfwd:true,ws:true,timeout:90000,proxyTimeout:90000});
const types={".html":"text/html; charset=utf-8",".js":"text/javascript; charset=utf-8",".css":"text/css; charset=utf-8",
 ".json":"application/json; charset=utf-8",".wasm":"application/wasm",".png":"image/png",".jpg":"image/jpeg",
 ".webp":"image/webp",".svg":"image/svg+xml",".ico":"image/x-icon",".woff2":"font/woff2"};
const targetFor=pathname=>{
 if(pathname.startsWith("/assets/packs/"))return cdn;
 if(pathname.startsWith("/api/")||pathname.startsWith("/shards/")||pathname.startsWith("/gm/")||
    pathname==="/auto-policy.json")return backend;
 return null;
};
proxy.on("proxyReq",(out,req)=>{
 const dest=targetFor(new URL(req.url||"/","http://localhost").pathname);
 if(dest===cdn){
   out.removeHeader("cookie");out.removeHeader("authorization");out.removeHeader("origin");out.removeHeader("referer");
   out.setHeader("Accept-Encoding","identity");
 } else if(dest===backend){
   // Backend explicitly authorizes its own origin; browser cookie domain is
   // still the new TEST URL because this proxy terminates same-origin requests.
   out.setHeader("Origin",backend);
 }
});
proxy.on("proxyReqWs",out=>out.setHeader("Origin",backend));
proxy.on("error",(err,req,res)=>{
 if("writeHead" in res && !res.headersSent){res.writeHead(502,{"Content-Type":"application/json","Cache-Control":"no-store"});res.end(JSON.stringify({ok:false,message:"Backend TEST tạm thời không phản hồi"}));}
 else if("destroy" in res)res.destroy();
});
const server=http.createServer((req,res)=>{
 const url=new URL(req.url||"/","http://localhost"),path=url.pathname;
 if(path==="/__webgl2/health"){
   res.writeHead(200,{"Content-Type":"application/json","Cache-Control":"no-store"});
   res.end(JSON.stringify({status:"ready",renderer:"Babylon.js WebGL2",auth:"HieuSRO TEST",assets:"SROPACK2 Range"}));return;
 }
 const target=targetFor(path);
 if(target){
   if(target===cdn && !["GET","HEAD"].includes(req.method||"GET")){
     res.writeHead(405,{"Allow":"GET, HEAD"});res.end();return;
   }
   proxy.web(req,res,{target});return;
 }
 if(req.method!=="GET"&&req.method!=="HEAD"){res.writeHead(405);res.end();return;}
 // Vite SPA fallback only for browser HTML navigation, NOT missing JS/assets.
 const route=path==="/"?"/index.html":decodeURIComponent(path);
 if(route.includes("\0")||route.split("/").includes("..")||route.includes("\\")){res.writeHead(400);res.end();return;}
 let file=resolve(app,"."+route);
 if(!file.startsWith(app+sep)){res.writeHead(403);res.end();return;}
 let info;
 try{info=statSync(file);if(!info.isFile())throw Error("not file");}
 catch{
   if(path==="/"||req.headers.accept?.includes("text/html")){file=resolve(app,"index.html");try{info=statSync(file);}catch{}}
 }
 if(!info){res.writeHead(404,{"Cache-Control":"no-store"});res.end("Not found");return;}
 res.writeHead(200,{"Content-Type":types[extname(file)]||"application/octet-stream",
   "Cache-Control":extname(file)===".html"?"no-cache":"public, max-age=86400",
   "X-Content-Type-Options":"nosniff",
   "Referrer-Policy":"same-origin"
 });
 if(req.method==="HEAD"){res.end();return;}
 createReadStream(file).on("error",()=>res.destroy()).pipe(res);
});
server.on("upgrade",(req,socket,head)=>{
 const path=new URL(req.url||"/","http://localhost").pathname;
 if(!path.startsWith("/shards/")){socket.destroy();return;}
 proxy.ws(req,socket,head,{target:backend});
});
server.listen(PORT,"0.0.0.0",()=>console.log("HieuSRO WebGL2 TEST listening on",PORT));
