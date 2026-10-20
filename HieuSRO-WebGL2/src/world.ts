import {
  ArcRotateCamera,Color3,Color4,Engine,HemisphericLight,Mesh,MeshBuilder,
  Scene,StandardMaterial,Vector3,VertexData,DynamicTexture,RawTexture,Texture
} from "@babylonjs/core";
import type {PackReader} from "./pack";
import {decodeSroNativeTexture} from "./native-texture";

type Block = {blockX:number;blockZ:number;heights:number[];textureData:number[]};
type Sector={sectorX:number;sectorY:number;blocks:Block[]};
type Bundle={source:{sectorX:number;sectorY:number};terrain:{sectors?:Sector[];blocks?:Block[]};
  terrainTextures?:{tileCatalog?:{referencedTiles?:{textureId:number;imagePublicPath:string}[]}}};
type RegionRow={area?:string;source?:string;bundlePublicPath:string};

function finiteHeights(b: Block) {
  return b.heights?.length===289 && b.heights.every(Number.isFinite) &&
    Number.isSafeInteger(b.blockX) && Number.isSafeInteger(b.blockZ);
}
/** 1 SRO terrain block = 320 x 320 units, 17 x 17 native height samples. */
export function terrainGeometry(block: Block, sectorX=0, sectorZ=0, originX=0, originZ=0) {
  if (!finiteHeights(block)) throw new Error("Terrain SRO không hợp lệ");
  const pos:number[]=[],ind:number[]=[],norm:number[]=[],uvs:number[]=[];
  const x0=((sectorX-originX)*6+block.blockX)*320;
  const z0=((sectorZ-originZ)*6+block.blockZ)*320;
  for(let z=0;z<=16;z++)for(let x=0;x<=16;x++){
    pos.push(x0+x*20,block.heights[z*17+x]!,z0+z*20);
    uvs.push(x/16,z/16);
  }
  for(let z=0;z<16;z++)for(let x=0;x<16;x++){
    const k=z*17+x;
    ind.push(k,k+17,k+1,k+1,k+17,k+18);
  }
  VertexData.ComputeNormals(pos,ind,norm);
  return {positions:pos,indices:ind,normals:norm,uvs,center:new Vector3(x0+160,0,z0+160)};
}
function makeTexture(scene:Scene) {
  // Until SRO's terrain-association material pipeline is ported, use a
  // lightweight debugging checker. Geometry is AUTHENTIC SRO height data.
  const t=new DynamicTexture("temporary-terrain-material",{width:128,height:128},scene,false);
  const ctx=t.getContext(); ctx.fillStyle="#41634b";ctx.fillRect(0,0,128,128);
  ctx.fillStyle="#587159";
  for(let x=0;x<128;x+=32)for(let y=0;y<128;y+=32)if((x+y)%64===0)ctx.fillRect(x,y,32,32);
  t.update();return t;
}
export function createWorld(canvas:HTMLCanvasElement) {
  const engine=new Engine(canvas,true,{adaptToDeviceRatio:true,preserveDrawingBuffer:false,stencil:false});
  if(engine.webGLVersion!==2){engine.dispose();throw Error("Thiết bị không có WebGL2");}
  const ios=/iPhone|iPad|iPod/i.test(navigator.userAgent);
  // Babylon hardware scale divides the backing resolution.
  if(ios) engine.setHardwareScalingLevel(Math.max(1,devicePixelRatio/1.5));
  const scene=new Scene(engine);
  scene.clearColor=new Color4(.11,.17,.21,1);
  scene.fogMode=Scene.FOGMODE_EXP2;scene.fogDensity=.00026;
  scene.fogColor=new Color3(.28,.39,.38);
  const camera=new ArcRotateCamera("region-camera",Math.PI/4,Math.PI/2.9,720,new Vector3(960,0,960),scene);
  camera.lowerRadiusLimit=60;camera.upperRadiusLimit=2400;
  camera.lowerBetaLimit=.12;camera.upperBetaLimit=1.50;
  camera.panningSensibility=22;
  camera.wheelPrecision=3;camera.attachControl(canvas,true);
  const light=new HemisphericLight("sky-light",new Vector3(.3,1,.6),scene);
  light.intensity=1.18;
  const mat=new StandardMaterial("terrain-debug-material",scene);
  mat.diffuseTexture=makeTexture(scene);
  mat.specularColor=new Color3(.05,.05,.05);
  mat.backFaceCulling=false;
  const tiles=new Map<string,{mesh:Mesh,c:Vector3,seen:number}>();
  const realMaterials=new Map<number,StandardMaterial>();
  const nativeGpuTextures=new Set<RawTexture>();
  const tileSources=new Map<number,string>();
  let textureGeneration=0;
  const dominant=(b:Block)=>{
    const counts=new Map<number,number>();
    for(const word of b.textureData??[]){
      const id=word&1023;
      counts.set(id,(counts.get(id)??0)+1);
    }
    return [...counts].sort((a,b)=>b[1]-a[1])[0]?.[0]??-1;
  };
  let blocks:{key:string;block:Block;sx:number;sz:number}[]=[];
  let baseX=0,baseZ=0,refRegion="",active=false,tick=0;
  let disposed=false;
  const maxTiles=ios?16:49;
  function clear() {
    textureGeneration++;
    for(const x of tiles.values())x.mesh.dispose(false,false);
    tiles.clear();blocks=[];active=false;
    for(const mat of realMaterials.values())mat.dispose(false,false);
    realMaterials.clear();
    for(const texture of nativeGpuTextures)texture.dispose();
    nativeGpuTextures.clear();tileSources.clear();
  }
  function sync() {
    if(!active||disposed)return;
    const v=camera.target;
    const order=blocks.map(x=>{
      const cx=((x.sx-baseX)*6+x.block.blockX)*320+160;
      const cz=((x.sz-baseZ)*6+x.block.blockZ)*320+160;
      return {...x,dist:(cx-v.x)**2+(cz-v.z)**2};
    }).sort((a,b)=>a.dist-b.dist);
    const want=new Set(order.slice(0,maxTiles).map(x=>x.key));
    for(const [key,row] of tiles) {
      if(!want.has(key)){row.mesh.dispose(false,false);tiles.delete(key);}
    }
    for(const x of order.slice(0,maxTiles)) {
      if(tiles.has(x.key))continue;
      const data=terrainGeometry(x.block,x.sx,x.sz,baseX,baseZ);
      const mesh=new Mesh(x.key,scene);
      const vd=new VertexData();vd.positions=data.positions;vd.indices=data.indices;
      vd.normals=data.normals;vd.uvs=data.uvs;vd.applyToMesh(mesh,false);
      const id=dominant(x.block);
      mesh.material=realMaterials.get(id)??mat;
      mesh.isPickable=true;mesh.freezeWorldMatrix();
      tiles.set(x.key,{mesh,c:data.center,seen:tick});
    }
  }
  const observer=scene.onBeforeRenderObservable.add(()=>{
    if(!active||disposed)return;
    tick++;
    if(tick%20===0)sync();
  });
  engine.runRenderLoop(()=>{if(!disposed && document.visibilityState!=="hidden")scene.render();});
  const resize=()=>engine.resize();
  window.addEventListener("resize",resize);
  const lost=(e:Event)=>{e.preventDefault();};
  canvas.addEventListener("webglcontextlost",lost);
  const restored=()=>{sync();};canvas.addEventListener("webglcontextrestored",restored);
  return {
    engine,scene,camera,
    stats:()=>({tiles:tiles.size,totalBlocks:blocks.length,nativeTextures:nativeGpuTextures.size,region:refRegion,WebGL:engine.webGLVersion}),
    async loadRegion(pack:PackReader,region:string,entry:RegionRow,signal?:AbortSignal) {
      const bundle=await pack.json<Bundle>(entry.bundlePublicPath,signal);
      if(disposed||signal?.aborted)return;
      if(!bundle?.source || !bundle.terrain)throw Error("Region thiếu dữ liệu địa hình");
      clear();refRegion=region;baseX=bundle.source.sectorX;baseZ=bundle.source.sectorY;
      const sectors=bundle.terrain.sectors?.length?
        bundle.terrain.sectors:[{sectorX:baseX,sectorY:baseZ,blocks:bundle.terrain.blocks??[]}];
      blocks=sectors.flatMap(s=>s.blocks.filter(finiteHeights).map(b=>({
        key:`${s.sectorX}:${s.sectorY}:${b.blockX}:${b.blockZ}`,block:b,sx:s.sectorX,sz:s.sectorY
      })));
      if(!blocks.length)throw Error("Không tìm thấy tile độ cao trong region thật");
      const first=blocks[Math.floor(blocks.length/2)]!;
      const cx=((first.sx-baseX)*6+first.block.blockX)*320+160;
      const cz=((first.sz-baseZ)*6+first.block.blockZ)*320+160;
      const avg=first.block.heights.reduce((a,b)=>a+b,0)/289;
      camera.setTarget(new Vector3(cx,avg,cz));
      camera.radius=ios?530:750;
      active=true;sync();
      // Native tile textures are read lazily and only after geometry can be
      // displayed. GPU textures and material owners live for ONE map generation.
      tileSources.clear();
      for(const row of bundle.terrainTextures?.tileCatalog?.referencedTiles??[]) {
        if(Number.isSafeInteger(row.textureId)&&row.imagePublicPath.startsWith("/assets/"))
          tileSources.set(row.textureId,row.imagePublicPath);
      }
      const thisGeneration=textureGeneration;
      void (async()=>{
        const preferred=[...new Set(blocks.map(x=>dominant(x.block)))].filter(x=>tileSources.has(x)).slice(0,ios?8:16);
        for(const id of preferred) {
          if(signal?.aborted||disposed||thisGeneration!==textureGeneration)break;
          try {
            const image=await pack.read(tileSources.get(id)!,signal);
            const decoded=decodeSroNativeTexture(image,ios);
            if(signal?.aborted||disposed||thisGeneration!==textureGeneration)break;
            // Do not retain raw NTX after the texture has been uploaded.
            const texture=RawTexture.CreateRGBATexture(decoded.pixels,decoded.width,decoded.height,scene,false,false,Texture.BILINEAR_SAMPLINGMODE);
            const material=new StandardMaterial("sro-native-tile-"+id,scene);
            material.diffuseTexture=texture;material.specularColor=new Color3(0,0,0);
            material.backFaceCulling=false;
            nativeGpuTextures.add(texture);realMaterials.set(id,material);
            for(const x of blocks){
              if(dominant(x.block)===id) {
                const mesh=tiles.get(x.key)?.mesh;
                if(mesh)mesh.material=material;
              }
            }
          }catch(error){
            if(!signal?.aborted)console.warn("Optional native tile texture",id,error instanceof Error?error.message:"unavailable");
          }
        }
      })();
      return {tiles:tiles.size,blocks:blocks.length,source:entry.bundlePublicPath};
    },
    move(direction:"left"|"right"|"forward"|"back", delta:number) {
      if(!active)return;
      if(direction==="left"||direction==="right")camera.alpha+=direction==="left"?.065:-.065;
      else {
        const dist=(direction==="forward"?1:-1)*delta;
        const target=camera.target.clone();
        target.x+=Math.sin(camera.alpha)*dist;
        target.z+=Math.cos(camera.alpha)*dist;
        camera.setTarget(target);
        sync();
      }
    },
    dispose() {
      if(disposed)return;disposed=true;
      scene.onBeforeRenderObservable.remove(observer);
      window.removeEventListener("resize",resize);
      canvas.removeEventListener("webglcontextlost",lost);
      canvas.removeEventListener("webglcontextrestored",restored);
      clear();scene.dispose();engine.stopRenderLoop();engine.dispose();
    }
  };
}
export type WorldPreview=ReturnType<typeof createWorld>;
