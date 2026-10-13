(() => {
  const KEY = "hieusro_mobile_diag_v1";
  const MAX_ERRORS = 8;
  const now = () => Date.now();

  let state = {
    boots: 0,
    bootAt: 0,
    navigationType: "unknown",
    contextLosses: 0,
    contextRestores: 0,
    lastPageHide: null,
    lastPageShow: null,
    lastVisibility: null,
    errors: []
  };

  try {
    const previous = JSON.parse(sessionStorage.getItem(KEY) || "null");
    if (previous && typeof previous === "object") state = { ...state, ...previous };
  } catch {}

  const navigation = performance.getEntriesByType("navigation")[0];
  state.boots = Number(state.boots || 0) + 1;
  state.bootAt = now();
  state.navigationType = navigation && navigation.type ? navigation.type : "unknown";

  function save() {
    try { sessionStorage.setItem(KEY, JSON.stringify(state)); } catch {}
    window.__HIEUSRO_MOBILE_DIAGNOSTICS__ = state;
  }

  function rememberError(kind, value) {
    const row = { at: now(), kind, value: String(value || "unknown").slice(0, 500) };
    state.errors = [...(Array.isArray(state.errors) ? state.errors : []), row].slice(-MAX_ERRORS);
    save();
  }

  addEventListener("pageshow", event => {
    state.lastPageShow = { at: now(), persisted: Boolean(event.persisted) };
    save();
  });

  addEventListener("pagehide", event => {
    state.lastPageHide = { at: now(), persisted: Boolean(event.persisted) };
    save();
  });

  document.addEventListener("visibilitychange", () => {
    state.lastVisibility = { at: now(), value: document.visibilityState };
    save();
  });

  document.addEventListener("webglcontextlost", () => {
    state.contextLosses = Number(state.contextLosses || 0) + 1;
    state.lastContextLossAt = now();
    save();
  }, true);

  document.addEventListener("webglcontextrestored", () => {
    state.contextRestores = Number(state.contextRestores || 0) + 1;
    state.lastContextRestoreAt = now();
    save();
  }, true);

  addEventListener("error", event => {
    rememberError("error", event.message || event.error || event.filename || "window error");
  });

  addEventListener("unhandledrejection", event => {
    rememberError("unhandledrejection", event.reason || "promise rejection");
  });

  save();
  console.info("[HieuSRO mobile diagnostics]", state);
})();
