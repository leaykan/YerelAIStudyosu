// Arayüz kaynakları (app/frontend/src vb.) derlenmiş kopyadan (app/dist) yeniyse 1, güncelse 0 ile çıkar.
// windows.bat bunu açılışta çalıştırır; 1 dönerse önce derler, böylece eski görüntü açılmaz.
const fs = require("fs");
const path = require("path");
const ROOT = path.resolve(__dirname, "..", "..");
const FE = path.join(ROOT, "app", "frontend");
const DIST = path.join(ROOT, "app", "dist", "index.html");

function enYeni(yol) {
  let en = 0;
  let st;
  try { st = fs.statSync(yol); } catch (_) { return 0; }
  if (st.isFile()) return st.mtimeMs;
  for (const ad of fs.readdirSync(yol)) {
    if (ad === "node_modules" || ad.startsWith(".")) continue;
    en = Math.max(en, enYeni(path.join(yol, ad)));
  }
  return en;
}

let distZamani = 0;
try { distZamani = fs.statSync(DIST).mtimeMs; } catch (_) { process.exit(1); }
const kaynak = Math.max(
  enYeni(path.join(FE, "src")),
  enYeni(path.join(FE, "public")),
  enYeni(path.join(FE, "index.html")),
  enYeni(path.join(FE, "vite.config.js")),
  enYeni(path.join(FE, "package.json")),
);
process.exit(kaynak > distZamani ? 1 : 0);
