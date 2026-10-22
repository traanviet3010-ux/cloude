/**
 * D3D9 Silkroad blend factors mapped to WebGL2.
 * Values and validity rules originate from the pinned OpenSRO
 * foundation/rendering/blend-state.ts. Do not substitute an assumed
 * SRC_ALPHA / ONE_MINUS_SRC_ALPHA for effect materials.
 */
import {validBlend,type BlendPair} from "@/engine/foundation/rendering/blend-state";

export function originalBlendPair(
  gl:WebGL2RenderingContext,
  blend:boolean,
  pair:BlendPair|undefined
){
  if(!blend){gl.disable(gl.BLEND);return;}
  const actual=pair??{source:5,destination:6}; // OpenSRO DEFAULT_BLEND.
  if(!validBlend(actual))throw Error("Invalid original D3D9 Silkroad blend factor pair");
  // Original retail X8R8G8B8: DESTALPHA always reads 1. WebGL2
  // default canvas has an alpha plane; map those factors explicitly.
  const factor=(v:number,source:boolean):number=>{
    switch(v){
      case 1:return gl.ZERO;
      case 2:return gl.ONE;
      case 3:return gl.SRC_COLOR;
      case 4:return gl.ONE_MINUS_SRC_COLOR;
      case 5:return gl.SRC_ALPHA;
      case 6:return gl.ONE_MINUS_SRC_ALPHA;
      case 7:return gl.ONE; // X8R8G8B8 DESTALPHA
      case 8:return gl.ZERO;
      case 9:return gl.DST_COLOR;
      case 10:return gl.ONE_MINUS_DST_COLOR;
      case 11:
        if(!source)throw Error("D3D9 destination SRCALPHASAT is invalid");
        return gl.SRC_ALPHA_SATURATE;
      case 12:
        if(!source)throw Error("D3D9 destination BOTHSRCALPHA is invalid");
        return gl.SRC_ALPHA;
      case 13:
        if(!source)throw Error("D3D9 destination BOTHINVSRCALPHA is invalid");
        return gl.ONE_MINUS_SRC_ALPHA;
      case 14:return gl.CONSTANT_COLOR;
      case 15:return gl.ONE_MINUS_CONSTANT_COLOR;
      default:throw Error("Unknown original Silkroad D3D9 blend factor");
    }
  };
  const sf=actual.source===12?gl.SRC_ALPHA:
    actual.source===13?gl.ONE_MINUS_SRC_ALPHA:factor(actual.source,true);
  const df=actual.source===12?gl.ONE_MINUS_SRC_ALPHA:
    actual.source===13?gl.SRC_ALPHA:factor(actual.destination,false);
  // Native BLENDFACTOR defaults to white. The original GPU frame changes
  // this after bloom; that state must be supplied before enabling bloom.
  gl.enable(gl.BLEND);
  gl.blendColor(1,1,1,1);
  gl.blendFunc(sf,df);
}
