(() => {
  const COOKIE = "hieusro_lang";
  const supported = new Set(["vi", "en"]);

  function cookieValue() {
    for (const part of document.cookie.split(";")) {
      const [key, ...rest] = part.trim().split("=");
      if (key === COOKIE) return decodeURIComponent(rest.join("="));
    }
    return "";
  }

  function currentLanguage() {
    const cookie = cookieValue();
    if (supported.has(cookie)) return cookie;
    const stored = localStorage.getItem(COOKIE);
    if (stored && supported.has(stored)) return stored;
    return "vi";
  }

  function setLanguage(language) {
    if (!supported.has(language)) return;
    localStorage.setItem(COOKIE, language);
    document.cookie = `${COOKIE}=${encodeURIComponent(language)}; Path=/; Max-Age=31536000; SameSite=Lax; Secure`;
    location.reload();
  }

  function install() {
    const language = currentLanguage();
    document.documentElement.lang = language;

    // Keep cookie and local preference aligned. The edge defaults to Vietnamese
    // when no cookie exists, so first launch is already localized.
    if (cookieValue() !== language) {
      document.cookie = `${COOKIE}=${encodeURIComponent(language)}; Path=/; Max-Age=31536000; SameSite=Lax; Secure`;
    }

    const style = document.createElement("style");
    style.textContent = `
      #hieusro-language-switch { position: fixed; top: 10px; right: 166px; z-index: 2147483647; font: 600 12px/1.2 Arial,sans-serif; color: #f7e6b4; user-select: none; }
      #hieusro-language-switch button { border: 1px solid #8c733f; background: linear-gradient(#302a1e,#15130f); color: #f7e6b4; min-height: 30px; padding: 5px 10px; border-radius: 4px; box-shadow: 0 2px 8px #0008; cursor: pointer; }
      #hieusro-language-switch button:hover { border-color: #d2af61; color: #fff6d5; }
      #hieusro-language-menu { display: none; position: absolute; right: 0; top: 34px; min-width: 142px; padding: 4px; border: 1px solid #78643a; border-radius: 4px; background: #14120eeF; box-shadow: 0 4px 18px #000b; }
      #hieusro-language-switch.open #hieusro-language-menu { display: grid; gap: 3px; }
      #hieusro-language-menu button { width: 100%; text-align: left; box-shadow: none; background: #211d15; }
      #hieusro-language-menu button.active { color: #ffcf63; border-color: #c69837; }
      @media (max-width: 720px) { #hieusro-language-switch { top: 8px; right: 8px; } #hieusro-language-switch button { min-height: 36px; font-size: 13px; } }
    `;
    document.head.appendChild(style);

    const root = document.createElement("div");
    root.id = "hieusro-language-switch";
    root.innerHTML = `
      <button id="hieusro-language-current" type="button" aria-haspopup="true" aria-expanded="false">🌐 ${language === "vi" ? "Tiếng Việt" : "English"}</button>
      <div id="hieusro-language-menu" role="menu">
        <button type="button" data-language="vi" class="${language === "vi" ? "active" : ""}">🇻🇳 Tiếng Việt</button>
        <button type="button" data-language="en" class="${language === "en" ? "active" : ""}">🇬🇧 English</button>
      </div>
    `;
    document.body.appendChild(root);

    const current = root.querySelector("#hieusro-language-current");
    current.addEventListener("click", event => {
      event.stopPropagation();
      const open = root.classList.toggle("open");
      current.setAttribute("aria-expanded", String(open));
    });
    root.querySelectorAll("[data-language]").forEach(button => {
      button.addEventListener("click", () => setLanguage(button.dataset.language));
    });
    document.addEventListener("click", () => {
      root.classList.remove("open");
      current.setAttribute("aria-expanded", "false");
    });
  }

  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", install, { once: true });
  else install();
})();
