/*
 * HieuSRO Mobile Lite V2: conservative per-device GPU ledger and crash guard.
 *
 * GPU objects are tracked at creation, and disposal is performed after
 * existing frame-safe owners release their resources. No live frame attachment
 * is ever destroyed just because a guessed byte budget was exceeded.
 *
 * byte counts are estimates of allocated GPU storage, not Safari resident RAM;
 * WebGPU does not expose exact GPU memory usage.
 */
export const GPU_BUDGET_IOS_MB = 450;
export const GPU_BUDGET_IOS_RESCUE_MB = 250;
export const GPU_BUDGET_DESKTOP_MB = 1536;
export const IOS_DPR_LIMIT = 1.5;

const MIB = 1024 * 1024;
const LOAD_MARKER = "hieusro-mobile-v2-loading";
const RESCUE_MARKER = "hieusro-mobile-v2-rescue";
const WARNING = "Trình duyệt vừa bị đầy bộ nhớ. Hãy đóng hẳn tab này rồi mở lại, đừng bấm tải lại liên tục.";

type Tracked = GPUTexture | GPUBuffer;
type Entry = {
  resource: Tracked;
  bytes: number;
  usedAt: number;
  lastFrame: number;
  // An explicit owner must opt in with a safe release callback.
  // Never evict a bindable object without its owner's cooperation.
  evict?: () => void;
  pinned: boolean;
};

export interface MobileMemoryStats {
  totalMB: number;
  assets: number;
  evictions: number;
  budgetMB: number;
  overBudgetMB: number;
  trackingComplete: boolean;
}

function ios(): boolean {
  return typeof navigator !== "undefined" && /iPhone|iPad|iPod/i.test(navigator.userAgent || "");
}
export function rescueMode(): boolean {
  if (!ios()) return false;
  try { return sessionStorage.getItem(RESCUE_MARKER) === "1"; } catch { return false; }
}
export function maxMobilePixelRatio(): number {
  const native = typeof devicePixelRatio === "number" ? devicePixelRatio : 1;
  return ios() ? Math.min(native, rescueMode() ? 1 : IOS_DPR_LIMIT) : native;
}
export function mobileGpuBudgetMB(): number {
  return ios() ? (rescueMode() ? GPU_BUDGET_IOS_RESCUE_MB : GPU_BUDGET_IOS_MB) : GPU_BUDGET_DESKTOP_MB;
}

function estimatedTextureBytes(desc: GPUTextureDescriptor): number {
  const shape = desc.size;
  const size = typeof shape === "number" ? [shape, 1, 1] :
    Array.isArray(shape) ? shape :
    [shape.width, shape.height ?? 1, shape.depthOrArrayLayers ?? 1];
  const [w, h, layers] = size as number[];
  const format = String(desc.format);
  const block = /^bc1|^bc4/.test(format) ? 8 : /^bc[2-7]/.test(format) ? 16 : 0;
  const pixel = /rgba32/.test(format) ? 16 :
    /rgba16/.test(format) ? 8 :
    /rg32/.test(format) ? 8 :
    /rg16/.test(format) ? 4 :
    /r32|depth32|rgba8|bgra8|depth24/.test(format) ? 4 :
    /rg8|r16/.test(format) ? 2 : 4;
  let total = 0, width = Math.max(1,w||1), height=Math.max(1,h||1);
  const levels = Math.max(1, desc.mipLevelCount ?? 1);
  for (let i=0; i<levels; i++) {
    total += block ? Math.ceil(width/4)*Math.ceil(height/4)*block*Math.max(1,layers||1) :
      width*height*pixel*Math.max(1,layers||1);
    width=Math.max(1,width>>1); height=Math.max(1,height>>1);
  }
  return Math.max(0, total) * Math.max(1, desc.sampleCount ?? 1);
}

export function createGpuLedger(budgetMB = mobileGpuBudgetMB()) {
  const tracked = new Map<Tracked, Entry>();
  let total=0, evictions=0, frame=0, frameOpen=false, closed=false, complete=true;
  const budget=Math.max(16,budgetMB)*MIB;
  function forget(obj: Tracked) {
    const row=tracked.get(obj);
    if (!row) return;
    tracked.delete(obj);
    total-=row.bytes;
  }
  function stats(): MobileMemoryStats {
    return {
      totalMB: Math.round(total/MIB*10)/10,
      assets: tracked.size, evictions, budgetMB:budget/MIB,
      overBudgetMB:Math.round(Math.max(0,total-budget)/MIB*10)/10,
      trackingComplete:complete
    };
  }
  function pressure() {
    if (closed || frameOpen || total<=budget) return;
    // Only assets with an owner-provided release callback can be reclaimed.
    const candidates=[...tracked.values()].filter(v=>v.evict && !v.pinned && v.lastFrame!==frame)
      .sort((a,b)=>a.usedAt-b.usedAt);
    for (const row of candidates) {
      if (total<=budget) break;
      if (!tracked.has(row.resource)) continue;
      row.evict!();
      evictions++;
    }
  }
  function track<T extends Tracked>(obj:T,bytes:number):T {
    if (closed) {obj.destroy(); return obj;}
    const row:Entry={resource:obj,bytes:Math.max(0,bytes),usedAt:performance.now(),lastFrame:frame,pinned:true};
    tracked.set(obj,row); total+=row.bytes;
    // Wrap native destroy only if the implementation permits shadow methods.
    // Where it cannot, total remains a conservative upper estimate until dispose.
    try {
      const original=obj.destroy.bind(obj);
      Object.defineProperty(obj,"destroy",{
        configurable:true,
        value:()=>{ forget(obj); original(); }
      });
    } catch {complete=false;}
    pressure();
    return obj;
  }
  return {
    stats,
    registerBuffer<T extends GPUBuffer>(buffer:T, desc:GPUBufferDescriptor):T {
      return track(buffer,Number(desc.size));
    },
    registerTexture<T extends GPUTexture>(texture:T, desc:GPUTextureDescriptor):T {
      return track(texture,estimatedTextureBytes(desc));
    },
    // Call only when an owner has an actual, safe way to release the asset.
    offerEviction(obj:Tracked,callback:()=>void) {
      const row=tracked.get(obj);
      if (!row) return;
      row.evict=callback; row.pinned=false;
    },
    pin(obj:Tracked) {
      const row=tracked.get(obj);
      if (row) {row.pinned=true; row.lastFrame=frame; row.usedAt=performance.now();}
    },
    touch(obj:Tracked) {
      const row=tracked.get(obj);
      if (row) {row.lastFrame=frame; row.usedAt=performance.now();}
    },
    beginFrame() {frame++;frameOpen=true;},
    endFrame() {frameOpen=false;pressure();},
    // May be called after all higher-level owners have disposed; idempotent.
    dispose() {
      if (closed) return;
      closed=true;frameOpen=false;
      for (const obj of [...tracked.keys()]) {
        try{obj.destroy();}catch{}
        forget(obj);
      }
    },
    markIncomplete() {complete=false;}
  };
}
export type GpuLedger = ReturnType<typeof createGpuLedger>;

const ledgers=new Set<GpuLedger>();
export function gpuMemoryStats(): MobileMemoryStats {
  const rows=[...ledgers].map(l=>l.stats());
  const total=rows.reduce((n,r)=>n+r.totalMB,0);
  const budget=mobileGpuBudgetMB();
  return {
    totalMB:Math.round(total*10)/10,
    assets:rows.reduce((n,r)=>n+r.assets,0),
    evictions:rows.reduce((n,r)=>n+r.evictions,0),
    budgetMB:budget, overBudgetMB:Math.round(Math.max(0,total-budget)*10)/10,
    trackingComplete:rows.every(r=>r.trackingComplete)
  };
}
export function registerGpuDevice(device: GPUDevice): GpuLedger {
  const ledger=createGpuLedger();
  ledgers.add(ledger);
  // GPUDevice is a native WebIDL object. Shadowing a method may not be
  // supported by every Safari build; failure is non-fatal and reported.
  try {
    const makeBuffer=device.createBuffer.bind(device);
    Object.defineProperty(device,"createBuffer",{configurable:true,
      value:(d:GPUBufferDescriptor)=>ledger.registerBuffer(makeBuffer(d),d)});
    const makeTexture=device.createTexture.bind(device);
    Object.defineProperty(device,"createTexture",{configurable:true,
      value:(d:GPUTextureDescriptor)=>ledger.registerTexture(makeTexture(d),d)});
  } catch {ledger.markIncomplete();}
  return ledger;
}
export function unregisterGpuDevice(ledger: GpuLedger) {
  ledger.dispose();
  ledgers.delete(ledger);
}

export function markMobileLiteReady():void {
  if (!ios()) return;
  try {sessionStorage.removeItem(LOAD_MARKER);}catch{}
}
export function startMobileMemorySession() {
  if (!ios() || typeof document==="undefined") return {dispose(){}};
  try {
    if (sessionStorage.getItem(LOAD_MARKER)==="loading")
      sessionStorage.setItem(RESCUE_MARKER,"1");
    sessionStorage.setItem(LOAD_MARKER,"loading");
  } catch {}
  let disposed=false;
  const overlay=document.createElement("div");
  const debug=new URLSearchParams(location.search).get("debug")==="1";
  overlay.setAttribute("role","status");
  overlay.style.cssText="position:fixed;z-index:2147483647;top:8px;right:8px;max-width:85vw;padding:8px 10px;font:12px system-ui;background:#15222de6;color:white;border:1px solid #91a4ba;border-radius:8px;pointer-events:none;";
  if (rescueMode()) {
    overlay.style.maxWidth="390px";
    overlay.style.background="#5b271fea";
    overlay.textContent=WARNING;
    document.body.appendChild(overlay);
  } else if(debug) document.body.appendChild(overlay);
  function refresh() {
    if (!debug || !overlay.isConnected || disposed) return;
    const x=gpuMemoryStats();
    overlay.textContent=`GPU ~${x.totalMB}MB / ${x.budgetMB}MB · ${x.assets} tài nguyên · LRU ${x.evictions} · ${x.trackingComplete?"đủ":"ước lượng"}`;
  }
  refresh();
  const timer=debug?setInterval(refresh,2000):null;
  function dispose() {
    if(disposed)return;disposed=true;
    if(timer!==null)clearInterval(timer);
    overlay.remove();
  }
  return {dispose};
}
