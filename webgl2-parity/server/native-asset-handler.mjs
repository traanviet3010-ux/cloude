/*
 * Connect authentic OpenSRO /assets/* URL semantics to existing TEST SROPACK2.
 * Mount this *only* on isolated WebGL2 TEST after source/runtime parity gates.
 * /api, /shards and user data are NEVER handled by this asset endpoint.
 */
import {createHash} from "node:crypto";
import {MissingOriginalAsset} from "./native-pack-reader.mjs";
const types={
 ".json":"application/json; charset=utf-8",
 ".png":"image/png",".webp":"image/webp",".jpg":"image/jpeg",".jpeg":"image/jpeg",
 ".dds":"application/octet-stream",".glb":"model/gltf-binary",
 ".bin":"application/octet-stream",".dat":"application/octet-stream",
 ".mp3":"audio/mpeg",".ogg":"audio/ogg",".wav":"audio/wav",
 ".css":"text/css; charset=utf-8",".js":"text/javascript; charset=utf-8",
 ".txt":"text/plain; charset=utf-8",".svg":"image/svg+xml",
 ".woff2":"font/woff2"
};
function contentType(path){
 const ext=path.match(/\.[A-Za-z0-9]+$/)?.[0].toLowerCase();
 return types[ext]??"application/octet-stream";
}
export function createNativeAssetHttpHandler(reader){
 if(!reader||typeof reader.read!=="function"||typeof reader.has!=="function")
   throw Error("Native verified SROPACK2 reader required");
 return async function handle(req,res){
   if(!req.url?.startsWith("/assets/")||req.url.startsWith("/assets/packs/"))
     return false; // Other original HieuSRO runtime owners still route elsewhere.
   if(req.method!=="GET"&&req.method!=="HEAD"){
     res.writeHead(405,{"Allow":"GET, HEAD","Cache-Control":"no-store"});res.end();return true;
   }
   let path;
   try{path=new URL(req.url,"https://webgl2-test.invalid").pathname;}
   catch{res.writeHead(400,{"Cache-Control":"no-store"});res.end();return true;}
   const cancel=new AbortController();
   const abort=()=>cancel.abort();
   req.once("aborted",abort);
   res.once("close",()=>{if(!res.writableEnded)abort();});
   try{
     if(!await reader.has(path))throw new MissingOriginalAsset(path);
     const body=await reader.read(path,{signal:cancel.signal});
     const size=body.byteLength;
     const etag='"'+createHash("sha256").update(body).digest("hex")+'"';
     const common={
       "Content-Type":contentType(path),
       "Cache-Control":"public, max-age=3600",
       "X-Content-Type-Options":"nosniff",
       "ETag":etag,
       "Accept-Ranges":"bytes"
     };
     if(req.headers["if-none-match"]===etag){
       res.writeHead(304,common);res.end();return true;
     }
     let start=0,end=size-1,status=200;
     const range=req.headers.range;
     if(range){
       const m=/^bytes=(\d+)-(\d*)$/.exec(range);
       if(!m||!size){res.writeHead(416,{"Content-Range":`bytes */${size}`});res.end();return true;}
       start=Number(m[1]);end=m[2]?Number(m[2]):size-1;
       if(!Number.isSafeInteger(start)||!Number.isSafeInteger(end)||
         start<0||start>=size||end<start||end>=size){
         res.writeHead(416,{"Content-Range":`bytes */${size}`});res.end();return true;
       }
       status=206;
     }
     const length=size?end-start+1:0;
     const h={...common,"Content-Length":length};
     if(status===206)h["Content-Range"]=`bytes ${start}-${end}/${size}`;
     res.writeHead(status,h);
     if(req.method==="HEAD")res.end();
     else res.end(body.subarray(start,end+1));
   }catch(e){
     if(res.headersSent){res.destroy(e);return true;}
     const status=e instanceof MissingOriginalAsset?404:cancel.signal.aborted?499:502;
     if(status===499){res.destroy();return true;}
     res.writeHead(status,{"Content-Type":"text/plain; charset=utf-8",
       "Cache-Control":"no-store"});
     res.end(status===404?"Original Silkroad asset not found":"Verified TEST asset service unavailable");
   }finally{req.removeListener("aborted",abort);}
   return true;
 };
}
