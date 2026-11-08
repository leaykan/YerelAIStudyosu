import React from "react";
import ReactDOM from "react-dom/client";
import App from "./App";

// Oturum düşerse (uygulama yeniden başlatıldı, otomatik kilit, başka sekmede çıkış) açık sayfa
// "Giriş yapmanız gerekiyor" uyarıları göstermek yerine giriş ekranına döner.
{
  const asilFetch = window.fetch.bind(window);
  let yonlendirildi = false;
  window.fetch = async (...args) => {
    const yanit = await asilFetch(...args);
    if (yanit.status === 401 && window.__yasGirisli && !yonlendirildi) {
      try {
        const veri = await yanit.clone().json();
        if (veri && veri.girisGerekli) { yonlendirildi = true; window.location.reload(); }
      } catch (_) {}
    }
    return yanit;
  };
}

ReactDOM.createRoot(document.getElementById("root")).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>,
);
