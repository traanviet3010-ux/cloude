/*
 * HieuSRO original-client WebGL2 port: convert ORIGINAL OpenSRO UiScene
 * to GL-friendly commands without altering layout, localization or hit testing.
 *
 * This file is overlaid at:
 * apps/client-next/src/engine/runtime/renderer/webgl2/native-ui-commands.ts
 * during integration. NEVER generate a second HTML/CSS retail interface.
 */
import type { UiQuad, UiRect, UiScene } from "@/engine/contracts/ui";

export type NativeUiCommand = {
  readonly texture: string;
  readonly maskTexture: string | null;
  readonly maskRect: UiRect;
  readonly clip: UiRect;
  readonly sampling: "linear" | "nearest";
  readonly alphaCutoff: number;
  readonly vertexData: Float32Array; // 6 x (position.xy, uv.xy, color.rgba)
};
const LIMIT = 8192;
const FINITE = (v: number) => Number.isFinite(v);
function validRect(v: UiRect): boolean {
  return v.length === 4 && v.every(FINITE) && v[2] >= 0 && v[3] >= 0;
}
function vertex(out: number[], x: number, y: number, u: number, v: number, color: readonly number[]) {
  out.push(x,y,u,v,color[0]!,color[1]!,color[2]!,color[3]!);
}
function tile(q: UiQuad): NativeUiCommand | null {
  if (!validRect(q.rect) || !validRect(q.clip) || !q.uv.every(FINITE) ||
      !q.color.every(FINITE) || (q.rightColor && !q.rightColor.every(FINITE))) {
    throw Error("Native UI scene contains invalid geometry or colors");
  }
  if (q.doll || q.portraitGid !== undefined || q.worldAnchor ||
      q.characterAnchor !== undefined || q.occlusion === "scene" ||
      (q.depth !== undefined && q.depth !== 0)) {
    // Port these in the world/portrait pass before accepting these scenes.
    // Silent omission would break inventory dolls or overhead labels.
    throw Error("Native UI command requires missing 3D/occlusion/mask WebGL2 pass");
  }
  if(q.mask && (!q.mask.texture || q.mask.texture.length>1024 ||
      !validRect(q.mask.rect) || !q.mask.rect[2] || !q.mask.rect[3]))
    throw Error("Original Silkroad UI mask invalid");
  const [x,y,w,h] = q.rect;
  if (!w || !h || !q.clip[2] || !q.clip[3]) return null;
  if (q.uvTurn !== undefined && ![0,1,2,3].includes(q.uvTurn))
    throw Error("Unsupported native UI UV rotation");
  const alphaCutoff = q.alphaCutoff ?? 0;
  if (!FINITE(alphaCutoff) || alphaCutoff<0 || alphaCutoff>1)throw Error("Invalid UI alpha cutoff");
  const u=q.uv[0], v=q.uv[1], uw=q.uv[2], vh=q.uv[3];
  const corner:[[number,number],[number,number],[number,number],[number,number]] =
    [[u,v],[u+uw,v],[u+uw,v+vh],[u,v+vh]];
  const steps=q.uvTurn??0;
  const uv=[0,1,2,3].map(i=>corner[(i+steps)&3]!) as [number,number][];
  const centerX=x+w/2,centerY=y+h/2,angle=q.rotation??0;
  if(!FINITE(angle))throw Error("Invalid native UI rotation");
  const cs=Math.cos(angle),sn=Math.sin(angle);
  const xy:[[number,number],[number,number],[number,number],[number,number]]=
    [[x,y],[x+w,y],[x+w,y+h],[x,y+h]];
  const left=q.color,right=q.rightColor??q.color;
  const colors=[left,right,right,left];
  const out:number[]=[];
  for(const i of [0,1,2,0,2,3]){
    let [px,py]=xy[i]!;
    if(angle){const dx=px-centerX,dy=py-centerY;px=centerX+dx*cs-dy*sn;py=centerY+dx*sn+dy*cs;}
    vertex(out,px,py,uv[i]![0],uv[i]![1],colors[i]!);
  }
  return {texture:q.texture,maskTexture:q.mask?.texture??null,
    maskRect:q.mask?.rect??[0,0,1,1],clip:q.clip,
    sampling:q.sampling??"linear",alphaCutoff,
    vertexData:new Float32Array(out)};
}
export function compileNativeUi(scene:UiScene):NativeUiCommand[]{
  if(!Number.isFinite(scene.width)||scene.width<=0||!Number.isFinite(scene.height)||scene.height<=0)
    throw Error("Native UI scene dimensions invalid");
  const result:NativeUiCommand[]=[];
  for(const q of scene.quads){
    if(q.run){
      for(const glyph of q.run.glyphs){
        if(result.length>=LIMIT)throw Error("Native UI record budget exceeded");
        const sub:UiQuad={...q,run:undefined,
          rect:[q.rect[0]+glyph.x,q.rect[1]+glyph.y,glyph.width,glyph.height],
          uv:glyph.uv};
        const command=tile(sub);if(command)result.push(command);
      }
    }else{
      if(result.length>=LIMIT)throw Error("Native UI record budget exceeded");
      const command=tile(q);if(command)result.push(command);
    }
  }
  return result;
}
