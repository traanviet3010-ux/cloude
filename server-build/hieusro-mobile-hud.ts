/*
 * Minimal diagnostic HUD. Read-only and never reloads a page or writes every
 * frame. The native Silkroad frontend remains independently functional.
 */
import { mobileLiteEnabled } from "@/engine/foundation/rendering/mobile-lite";

type Health = { phase: string; error: string | null };

export function createMobileLiteHud(health: () => Health) {
  if (!mobileLiteEnabled() || typeof document === "undefined") {
    return { dispose() {} };
  }
  const host = document.createElement("div");
  host.id = "hieusro-mobile-lite";
  host.style.cssText = "position:fixed;left:8px;top:54px;z-index:2147482000;pointer-events:none";
  const root = host.attachShadow({ mode:"open" });
  const style = document.createElement("style");
  style.textContent = [
    ":host{all:initial;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif;color:#e3f5f9}",
    "button{font:inherit;cursor:pointer;border:1px solid #6c8ba5;background:#142534e9;color:#e3f5f9;border-radius:9px;min-height:34px;padding:6px 9px;pointer-events:auto;font-size:12px}",
    "button:focus-visible{outline:2px solid #f0d182}",
    ".panel{position:absolute;left:0;top:42px;width:min(320px,calc(100vw - 24px));max-height:55vh;overflow:auto;background:#0e1e2af5;border:1px solid #52728f;border-radius:10px;padding:12px;box-shadow:0 8px 18px #0008;pointer-events:auto;font-size:12px;line-height:1.45}",
    ".panel[hidden]{display:none!important}",
    ".panel p{margin:5px 0}.warn{color:#ffd98b}.good{color:#95e4b9}",
    ".close{float:right;min-height:30px;padding:3px 8px}",
  ].join("");
  root.append(style);
  const toggle=document.createElement("button");
  toggle.type="button"; toggle.textContent="📱 Mobile Lite · 30 FPS"; toggle.setAttribute("aria-expanded","false");
  const panel=document.createElement("section");
  panel.className="panel"; panel.hidden=true; panel.setAttribute("aria-label","Chẩn đoán Mobile Lite");
  const close=document.createElement("button");close.className="close";close.type="button";close.textContent="✕";
  const title=document.createElement("strong");title.textContent="HieuSRO Mobile Stability V1";
  const summary=document.createElement("p");
  const readings=document.createElement("p");
  const advice=document.createElement("p");advice.className="warn";
  const note=document.createElement("p");note.textContent="Chỉ số RAM GPU không được Safari công khai. Chế độ này không tự reload trang và không gửi chẩn đoán về server.";
  panel.append(close,title,summary,readings,advice,note);
  root.append(toggle,panel);
  (document.body || document.documentElement).append(host);

  let reloads=0;
  try {
    const key="hieusro:mobile-lite:opens:v1";
    const previous=Number(sessionStorage.getItem(key) || "0");
    reloads=Number.isFinite(previous)?Math.min(99,Math.max(0,previous+1)):0;
    sessionStorage.setItem(key,String(reloads));
  } catch { /* Safari private-storage denial must not affect the game. */ }
  toggle.addEventListener("click",()=>{
    panel.hidden=!panel.hidden;
    toggle.setAttribute("aria-expanded",String(!panel.hidden));
  });
  close.addEventListener("click",()=>{panel.hidden=true;toggle.setAttribute("aria-expanded","false")});
  function update(){
    const status=health();
    const failed=status.phase==="failed" || !!status.error;
    toggle.textContent=failed?"⚠ Mobile Lite · GPU": "📱 Mobile Lite · 30 FPS";
    summary.textContent="30 FPS · Render 75% · Pack RAM 32 MiB · Mesh cache 384";
    readings.textContent="GPU: "+status.phase+" · Mở trang trong tab: "+reloads+" lần (ước tính)";
    advice.textContent=failed
      ? "WebGPU không sẵn sàng: "+String(status.error || "unknown")+". Không tự tải lại. Đóng bớt tab, để máy nguội rồi thử lại thủ công."
      : "Đang giới hạn tải CPU/GPU. Có thể mở mục này để xem trạng thái khi game giật.";
  }
  const timer=setInterval(update,4000);
  update();
  return {
    dispose() {clearInterval(timer);host.remove();}
  };
}
