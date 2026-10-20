/*
 * Native Silkroad NTX v1.150 texture adapter for Babylon/WebGL2.
 * Format informed by pinned OpenSRO native-texture.ts, adapted to not hold
 * original GPU and CPU buffers after upload. BC1/BC2/BC3 fallback to RGBA8
 * so Safari without S3TC extensions can still display authored terrain.
 */
export type NativeFormat="bgra"|"bc1"|"bc2"|"bc3";
export type NativeImage={width:number;height:number;pixels:Uint8Array};
const LIMIT=2048,MAX=32*1024*1024;
const formatCode=(c:number):NativeFormat=>{
  if(c===21)return"bgra";
  if(c===0x31545844)return"bc1";
  if(c===0x33545844)return"bc2";
  if(c===0x35545844)return"bc3";
  throw Error("Native SRO texture format không hỗ trợ");
};
function levelSize(fmt:NativeFormat,w:number,h:number){
  return fmt==="bgra"?w*h*4:Math.ceil(w/4)*Math.ceil(h/4)*(fmt==="bc1"?8:16);
}
const colors=(c:number)=>[(c>>>11&31)*255/31,(c>>>5&63)*255/63,(c&31)*255/31].map(Math.round);
function alphaBC3(data:Uint8Array,base:number,p:number){
  const a=data[base]!,b=data[base+1]!;
  const bit=p*3,off=base+2+(bit>>3);
  const n=((data[off]??0)|((data[off+1]??0)<<8))>>(bit%8)&7;
  if(n===0)return a;if(n===1)return b;
  if(a>b)return Math.floor(((8-n)*a+(n-1)*b)/7);
  if(n===6)return 0;if(n===7)return 255;
  return Math.floor(((6-n)*a+(n-1)*b)/5);
}
export function decodeSroNativeTexture(bytes:Uint8Array,halve=false):NativeImage{
  if(bytes.byteLength<20||bytes.byteLength>MAX)throw Error("Sai dung lượng NTX");
  const view=new DataView(bytes.buffer,bytes.byteOffset,bytes.byteLength);
  if(view.getUint32(0,true)!==0x3158544e)throw Error("Không phải NTX của Silkroad");
  const width=view.getUint32(4,true),height=view.getUint32(8,true),
    fmt=formatCode(view.getUint32(12,true)),mips=view.getUint32(16,true);
  if(!width||!height||width>8192||height>8192||
     (width&(width-1))||(height&(height-1))||!mips||mips>14)
    throw Error("Kích thước hoặc mip NTX không hợp lệ");
  let off=20,chosen:Uint8Array|null=null,chosenW=0,chosenH=0;
  const target=halve && mips>1?1:0;
  for(let m=0;m<mips;m++){
    const w=Math.max(1,width>>m),h=Math.max(1,height>>m),n=levelSize(fmt,w,h);
    if(off+n>bytes.byteLength)throw Error("NTX bị cắt");
    if(m===target){chosen=bytes.subarray(off,off+n);chosenW=w;chosenH=h;}
    off+=n;
  }
  if(off!==bytes.byteLength||!chosen)throw Error("Sai độ dài NTX");
  if(chosenW>LIMIT||chosenH>LIMIT)throw Error("Mip texture quá lớn cho WebGL2 TEST");
  const pixels=new Uint8Array(chosenW*chosenH*4);
  if(fmt==="bgra"){
    for(let p=0;p<pixels.length;p+=4){
      pixels[p]=chosen[p+2]!;pixels[p+1]=chosen[p+1]!;
      pixels[p+2]=chosen[p]!;pixels[p+3]=chosen[p+3]!;
    }
    return {width:chosenW,height:chosenH,pixels};
  }
  const stride=fmt==="bc1"?8:16,columns=Math.ceil(chosenW/4);
  for(let by=0;by<Math.ceil(chosenH/4);by++)for(let bx=0;bx<columns;bx++){
    const start=(by*columns+bx)*stride,base=start+(fmt==="bc1"?0:8);
    const c0=chosen[base]!|(chosen[base+1]!<<8),c1=chosen[base+2]!|(chosen[base+3]!<<8);
    const a=colors(c0),b=colors(c1),pal=[
      [...a,255],[...b,255],
      [...a.map((v,i)=>Math.floor((2*v+b[i]!)/3)),255],
      [...a.map((v,i)=>Math.floor((v+2*b[i]!)/3)),255]
    ];
    if(fmt==="bc1" && c0<=c1){
      pal[2]=[...a.map((v,i)=>Math.floor((v+b[i]!)/2)),255];
      pal[3]=[0,0,0,0];
    }
    const select=(chosen[base+4]!|(chosen[base+5]!<<8)|
      (chosen[base+6]!<<16)|(chosen[base+7]!<<24))>>>0;
    for(let py=0;py<4;py++)for(let px=0;px<4;px++){
      const x=bx*4+px,y=by*4+py;
      if(x>=chosenW||y>=chosenH)continue;
      const p=py*4+px,col=pal[(select>>>(p*2))&3]!;
      const dest=(y*chosenW+x)*4;
      for(let c=0;c<4;c++)pixels[dest+c]=col[c]!;
      if(fmt==="bc2")pixels[dest+3]=((chosen[start+(p>>1)]!>>>((p%2)*4))&15)*17;
      if(fmt==="bc3")pixels[dest+3]=alphaBC3(chosen,start,p);
    }
  }
  return {width:chosenW,height:chosenH,pixels};
}
