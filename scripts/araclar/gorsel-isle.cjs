#!/usr/bin/env node
// Görsel son işleme aracı (saf Node, ek paket yok). Sunucu gerekmez.
// Kullanım:
//   node gorsel-isle.cjs <girdi.png> [secenekler]
//     --arka-plan duz|parlaklik   Düz zemini sil (duz) veya parlaklığı alfaya çevir (parlaklik)
//     --tolerans 32               duz modunda renk toleransı
//     --kazanc 1.25               parlaklik modunda alfa kazancı
//     --kirp                      Görünür içeriğe kırp, kare tuvale ortala
//     --bosluk 0.06               Kırpmada kenar boşluğu oranı
//     --boyutlar 256,128,64,32    Ek boyutlar
//     --ico                       256 ve altındaki kare boyutlardan .ico
//     --cikti <klasor>            Çıktı klasörü (varsayılan: girdinin klasörü)
//   node gorsel-isle.cjs --tablo <cikti.png> <g1.png> <g2.png> ...   Numaralı önizleme ızgarası
"use strict";
const fs = require("fs");
const path = require("path");
const zlib = require("zlib");

// ============================================================================
// PNG YARDIMCILARI (saf Node; ek paket gerekmez)
// ============================================================================
const PNG_IMZA = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
const CRC_TABLOSU = (() => {
  const t = new Uint32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    t[n] = c >>> 0;
  }
  return t;
})();

function crc32(buf) {
  let c = 0xffffffff;
  for (let i = 0; i < buf.length; i++) c = CRC_TABLOSU[(c ^ buf[i]) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

function pngCoz(buf) {
  if (!buf.subarray(0, 8).equals(PNG_IMZA)) throw new Error("PNG değil");
  let p = 8;
  let w = 0, h = 0, derinlik = 0, renkTipi = 0, aralikli = 0;
  const idat = [];
  while (p < buf.length) {
    const boy = buf.readUInt32BE(p);
    const tip = buf.toString("latin1", p + 4, p + 8);
    const veri = buf.subarray(p + 8, p + 8 + boy);
    if (tip === "IHDR") {
      w = veri.readUInt32BE(0); h = veri.readUInt32BE(4);
      derinlik = veri[8]; renkTipi = veri[9]; aralikli = veri[12];
    } else if (tip === "IDAT") idat.push(veri);
    else if (tip === "IEND") break;
    p += 12 + boy;
  }
  if (derinlik !== 8 || aralikli) throw new Error("Desteklenmeyen PNG (yalnızca 8 bit, aralıksız)");
  const kanal = { 0: 1, 2: 3, 4: 2, 6: 4 }[renkTipi];
  if (!kanal) throw new Error("Desteklenmeyen PNG renk tipi: " + renkTipi);
  const ham = zlib.inflateSync(Buffer.concat(idat));
  const satir = w * kanal;
  const cikti = Buffer.alloc(w * h * 4);
  let onceki = Buffer.alloc(satir);
  let q = 0;
  for (let y = 0; y < h; y++) {
    const filtre = ham[q++];
    const s = Buffer.from(ham.subarray(q, q + satir));
    q += satir;
    for (let i = 0; i < satir; i++) {
      const a = i >= kanal ? s[i - kanal] : 0;
      const b = onceki[i];
      const c = i >= kanal ? onceki[i - kanal] : 0;
      let v = s[i];
      if (filtre === 1) v += a;
      else if (filtre === 2) v += b;
      else if (filtre === 3) v += (a + b) >> 1;
      else if (filtre === 4) {
        const pp = a + b - c;
        const pa = Math.abs(pp - a), pb = Math.abs(pp - b), pc = Math.abs(pp - c);
        v += pa <= pb && pa <= pc ? a : pb <= pc ? b : c;
      }
      s[i] = v & 0xff;
    }
    for (let x = 0; x < w; x++) {
      const o = (y * w + x) * 4;
      const i = x * kanal;
      if (kanal === 1) { cikti[o] = cikti[o + 1] = cikti[o + 2] = s[i]; cikti[o + 3] = 255; }
      else if (kanal === 2) { cikti[o] = cikti[o + 1] = cikti[o + 2] = s[i]; cikti[o + 3] = s[i + 1]; }
      else if (kanal === 3) { cikti[o] = s[i]; cikti[o + 1] = s[i + 1]; cikti[o + 2] = s[i + 2]; cikti[o + 3] = 255; }
      else { cikti[o] = s[i]; cikti[o + 1] = s[i + 1]; cikti[o + 2] = s[i + 2]; cikti[o + 3] = s[i + 3]; }
    }
    onceki = s;
  }
  return { w, h, rgba: cikti };
}

function pngParca(tip, veri) {
  const boy = Buffer.alloc(4); boy.writeUInt32BE(veri.length);
  const tv = Buffer.concat([Buffer.from(tip, "latin1"), veri]);
  const crc = Buffer.alloc(4); crc.writeUInt32BE(crc32(tv));
  return Buffer.concat([boy, tv, crc]);
}

function pngKodla(w, h, rgba) {
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(w, 0); ihdr.writeUInt32BE(h, 4);
  ihdr[8] = 8; ihdr[9] = 6; ihdr[10] = 0; ihdr[11] = 0; ihdr[12] = 0;
  const satir = w * 4;
  const ham = Buffer.alloc((satir + 1) * h);
  for (let y = 0; y < h; y++) {
    // Filtre 1 (Sub): düz arka planlarda iyi sıkışır
    const o = y * (satir + 1);
    ham[o] = 1;
    for (let i = 0; i < satir; i++) {
      const v = rgba[y * satir + i];
      const a = i >= 4 ? rgba[y * satir + i - 4] : 0;
      ham[o + 1 + i] = (v - a) & 0xff;
    }
  }
  return Buffer.concat([
    PNG_IMZA,
    pngParca("IHDR", ihdr),
    pngParca("IDAT", zlib.deflateSync(ham, { level: 9 })),
    pngParca("IEND", Buffer.alloc(0)),
  ]);
}

// Alan ortalamalı küçültme (önceden çarpılmış alfa ile; kenarlarda hale oluşmaz)
function yenidenBoyutla(src, w, h, nw, nh) {
  const eksen = (n, yeni) => {
    const liste = [];
    const olcek = n / yeni;
    for (let i = 0; i < yeni; i++) {
      const bas = i * olcek, son = (i + 1) * olcek;
      const agirliklar = [];
      if (olcek >= 1) {
        for (let k = Math.floor(bas); k < Math.ceil(son); k++) {
          const ag = Math.min(son, k + 1) - Math.max(bas, k);
          if (ag > 0) agirliklar.push([Math.min(n - 1, k), ag]);
        }
      } else {
        const m = (i + 0.5) * olcek - 0.5;
        const k0 = Math.max(0, Math.floor(m)), k1 = Math.min(n - 1, k0 + 1);
        const f = Math.min(1, Math.max(0, m - k0));
        agirliklar.push([k0, 1 - f], [k1, f]);
      }
      const top = agirliklar.reduce((s, [, a]) => s + a, 0) || 1;
      liste.push(agirliklar.map(([k, a]) => [k, a / top]));
    }
    return liste;
  };
  const yatay = eksen(w, nw), dikey = eksen(h, nh);
  const ara = new Float32Array(nw * h * 4);
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < nw; x++) {
      let r = 0, g = 0, b = 0, a = 0;
      for (const [k, ag] of yatay[x]) {
        const o = (y * w + k) * 4;
        const al = src[o + 3] / 255;
        r += src[o] * al * ag; g += src[o + 1] * al * ag; b += src[o + 2] * al * ag; a += al * ag;
      }
      const o2 = (y * nw + x) * 4;
      ara[o2] = r; ara[o2 + 1] = g; ara[o2 + 2] = b; ara[o2 + 3] = a;
    }
  }
  const cikti = Buffer.alloc(nw * nh * 4);
  for (let y = 0; y < nh; y++) {
    for (let x = 0; x < nw; x++) {
      let r = 0, g = 0, b = 0, a = 0;
      for (const [k, ag] of dikey[y]) {
        const o = (k * nw + x) * 4;
        r += ara[o] * ag; g += ara[o + 1] * ag; b += ara[o + 2] * ag; a += ara[o + 3] * ag;
      }
      const o2 = (y * nw + x) * 4;
      if (a > 0.0001) {
        cikti[o2] = Math.min(255, Math.round(r / a));
        cikti[o2 + 1] = Math.min(255, Math.round(g / a));
        cikti[o2 + 2] = Math.min(255, Math.round(b / a));
      }
      cikti[o2 + 3] = Math.min(255, Math.round(a * 255));
    }
  }
  return cikti;
}

// Düz renkli arka planı kenarlardan başlayarak şeffaf yapar.
// Prompt'ta "plain white background" gibi tek renk arka plan istenmelidir.
function arkaPlaniSil(src, w, h, tolerans = 32) {
  const rgba = Buffer.from(src);
  const kenar = [];
  const ekle = (x, y) => kenar.push((y * w + x) * 4);
  for (let x = 0; x < w; x++) { ekle(x, 0); ekle(x, h - 1); }
  for (let y = 1; y < h - 1; y++) { ekle(0, y); ekle(w - 1, y); }
  const ortanca = (k) => {
    const d = kenar.map((o) => rgba[o + k]).sort((a, b) => a - b);
    return d[Math.floor(d.length / 2)];
  };
  const zemin = [ortanca(0), ortanca(1), ortanca(2)];
  const uzaklik = (o) => Math.hypot(rgba[o] - zemin[0], rgba[o + 1] - zemin[1], rgba[o + 2] - zemin[2]);
  const uyan = kenar.filter((o) => uzaklik(o) < tolerans).length / kenar.length;
  if (uyan < 0.6) {
    return { rgba: src, basarili: false, zemin, uyan, mesaj: "Kenarlar tek renk değil; arka plan silinemedi. Prompt'a 'plain white background' ekleyin." };
  }
  const zeminMaske = new Uint8Array(w * h);
  const kuyruk = new Int32Array(w * h);
  let bas = 0, son = 0;
  for (const o of kenar) {
    const i = o / 4;
    if (!zeminMaske[i] && uzaklik(o) < tolerans) { zeminMaske[i] = 1; kuyruk[son++] = i; }
  }
  while (bas < son) {
    const i = kuyruk[bas++];
    const x = i % w, y = (i - x) / w;
    const komsular = [x > 0 ? i - 1 : -1, x < w - 1 ? i + 1 : -1, y > 0 ? i - w : -1, y < h - 1 ? i + w : -1];
    for (const k of komsular) {
      if (k < 0 || zeminMaske[k]) continue;
      if (uzaklik(k * 4) < tolerans) { zeminMaske[k] = 1; kuyruk[son++] = k; }
    }
  }
  // Kenar yumuşatma: zemine değen piksellerde kısmi alfa ve renk arındırma
  for (let i = 0; i < w * h; i++) {
    const o = i * 4;
    if (zeminMaske[i]) { rgba[o + 3] = 0; continue; }
    const x = i % w, y = (i - x) / w;
    let komsuZemin = false;
    for (let dy = -2; dy <= 2 && !komsuZemin; dy++) {
      for (let dx = -2; dx <= 2; dx++) {
        const nx = x + dx, ny = y + dy;
        if (nx >= 0 && ny >= 0 && nx < w && ny < h && zeminMaske[ny * w + nx]) { komsuZemin = true; break; }
      }
    }
    if (!komsuZemin) continue;
    const a = Math.min(1, uzaklik(o) / (tolerans * 3));
    if (a < 1) {
      const aa = Math.max(a, 0.05);
      for (let k = 0; k < 3; k++) rgba[o + k] = Math.max(0, Math.min(255, Math.round((rgba[o + k] - (1 - aa) * zemin[k]) / aa)));
      rgba[o + 3] = Math.round(a * 255);
    }
  }
  const silinen = zeminMaske.reduce((s, v) => s + v, 0);
  return { rgba, basarili: true, zemin, uyan, silinenOran: silinen / (w * h) };
}

// Siyah/koyu zemin üzerindeki parlayan çizimler için: parlaklığı alfaya çevirir.
// Sonuç her zemin üzerinde "ışık" gibi görünür. Koyu gölgeli nesnelerde
// gölgeler de şeffaflaşacağı için yalnızca parlama tarzı görsellerde kullanılmalı.
function parlakliktanAlfa(src, w, h, kazanc = 1.25) {
  const rgba = Buffer.from(src);
  const kenar = [];
  for (let x = 0; x < w; x++) { kenar.push(x * 4, ((h - 1) * w + x) * 4); }
  for (let y = 1; y < h - 1; y++) { kenar.push(y * w * 4, (y * w + w - 1) * 4); }
  const zemin = [0, 1, 2].map((k) => {
    const d = kenar.map((o) => src[o + k]).sort((a, b) => a - b);
    return d[Math.floor(d.length / 2)];
  });
  for (let i = 0; i < w * h; i++) {
    const o = i * 4;
    let a = 0;
    for (let k = 0; k < 3; k++) a = Math.max(a, (src[o + k] - zemin[k]) / Math.max(1, 255 - zemin[k]));
    a = Math.max(0, Math.min(1, a * kazanc));
    if (a < 0.01) { rgba[o + 3] = 0; continue; }
    for (let k = 0; k < 3; k++) rgba[o + k] = Math.max(0, Math.min(255, Math.round((src[o + k] - (1 - a) * zemin[k]) / a)));
    rgba[o + 3] = Math.round(a * 255);
  }
  return { rgba, basarili: true, zemin };
}

// Görünür içeriğe kırpar, kenarlara boşluk bırakıp kare tuvale ortalar.
function icerigeKirp(rgba, w, h, boslukOrani = 0.06) {
  let x0 = w, y0 = h, x1 = -1, y1 = -1;
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
    if (rgba[(y * w + x) * 4 + 3] > 16) {
      if (x < x0) x0 = x; if (x > x1) x1 = x; if (y < y0) y0 = y; if (y > y1) y1 = y;
    }
  }
  if (x1 < 0) return { rgba, w, h };
  const iw = x1 - x0 + 1, ih = y1 - y0 + 1;
  const kenar = Math.ceil(Math.max(iw, ih) * (1 + 2 * boslukOrani));
  const cikti = Buffer.alloc(kenar * kenar * 4);
  const ox = Math.floor((kenar - iw) / 2), oy = Math.floor((kenar - ih) / 2);
  for (let y = 0; y < ih; y++) {
    rgba.copy(cikti, ((oy + y) * kenar + ox) * 4, ((y0 + y) * w + x0) * 4, ((y0 + y) * w + x0 + iw) * 4);
  }
  return { rgba: cikti, w: kenar, h: kenar };
}

function icoOlustur(pngler) {
  const bas = Buffer.alloc(6);
  bas.writeUInt16LE(0, 0); bas.writeUInt16LE(1, 2); bas.writeUInt16LE(pngler.length, 4);
  const girisler = [];
  let konum = 6 + 16 * pngler.length;
  for (const { boyut, png } of pngler) {
    const g = Buffer.alloc(16);
    g[0] = boyut >= 256 ? 0 : boyut; g[1] = boyut >= 256 ? 0 : boyut;
    g.writeUInt16LE(1, 4); g.writeUInt16LE(32, 6);
    g.writeUInt32LE(png.length, 8); g.writeUInt32LE(konum, 12);
    konum += png.length;
    girisler.push(g);
  }
  return Buffer.concat([bas, ...girisler, ...pngler.map((p) => p.png)]);
}

// 3×5 piksel rakam yazıtipi (önizleme tablosunda numara yazmak için)
const RAKAMLAR = ["111101101101111", "010110010010111", "111001111100111", "111001111001111", "101101111001001",
  "111100111001111", "111100111101111", "111001001001001", "111101111101111", "111101111001111"];

function numaraCiz(rgba, w, x, y, metin, olcek = 4) {
  const genislik = metin.length * 4 * olcek + olcek;
  for (let yy = 0; yy < 7 * olcek; yy++) for (let xx = 0; xx < genislik; xx++) {
    const o = ((y + yy) * w + (x + xx)) * 4;
    rgba[o] = 15; rgba[o + 1] = 15; rgba[o + 2] = 22; rgba[o + 3] = 255;
  }
  [...metin].forEach((ch, n) => {
    const desen = RAKAMLAR[Number(ch)] || "";
    for (let r = 0; r < 5; r++) for (let c = 0; c < 3; c++) {
      if (desen[r * 3 + c] !== "1") continue;
      for (let a = 0; a < olcek; a++) for (let b = 0; b < olcek; b++) {
        const px = x + olcek + n * 4 * olcek + c * olcek + b;
        const py = y + olcek + r * olcek + a;
        const o = (py * w + px) * 4;
        rgba[o] = 255; rgba[o + 1] = 255; rgba[o + 2] = 255; rgba[o + 3] = 255;
      }
    }
  });
}

// Birden çok görseli numaralı bir ızgarada birleştirir (tek bakışta seçmek için)
function onizlemeTablosu(gorseller, hucre = 256, bosluk = 8) {
  const n = gorseller.length;
  const sutun = Math.ceil(Math.sqrt(n));
  const satir = Math.ceil(n / sutun);
  const W = sutun * hucre + (sutun + 1) * bosluk;
  const H = satir * hucre + (satir + 1) * bosluk;
  const tuval = Buffer.alloc(W * H * 4);
  for (let i = 0; i < W * H; i++) { tuval[i * 4] = 40; tuval[i * 4 + 1] = 40; tuval[i * 4 + 2] = 48; tuval[i * 4 + 3] = 255; }
  gorseller.forEach((g, idx) => {
    const olcek = Math.min(hucre / g.w, hucre / g.h);
    const nw = Math.max(1, Math.round(g.w * olcek)), nh = Math.max(1, Math.round(g.h * olcek));
    const kucuk = yenidenBoyutla(g.rgba, g.w, g.h, nw, nh);
    const cx = bosluk + (idx % sutun) * (hucre + bosluk) + Math.floor((hucre - nw) / 2);
    const cy = bosluk + Math.floor(idx / sutun) * (hucre + bosluk) + Math.floor((hucre - nh) / 2);
    for (let y = 0; y < nh; y++) for (let x = 0; x < nw; x++) {
      const s = (y * nw + x) * 4, d = ((cy + y) * W + (cx + x)) * 4;
      const a = kucuk[s + 3] / 255;
      // Şeffaf alanlar dama deseniyle gösterilir
      const dama = ((x >> 4) + (y >> 4)) % 2 ? 90 : 70;
      for (let k = 0; k < 3; k++) tuval[d + k] = Math.round(kucuk[s + k] * a + dama * (1 - a));
    }
    numaraCiz(tuval, W, bosluk + (idx % sutun) * (hucre + bosluk) + 4, bosluk + Math.floor(idx / sutun) * (hucre + bosluk) + 4, String(idx + 1));
  });
  return { rgba: tuval, w: W, h: H };
}


function main() {
  const arg = process.argv.slice(2);
  if (arg[0] === "--tablo") {
    const cikti = arg[1];
    const girdiler = arg.slice(2);
    const t = onizlemeTablosu(girdiler.map((f) => pngCoz(fs.readFileSync(f))));
    fs.writeFileSync(cikti, pngKodla(t.w, t.h, t.rgba));
    console.log(cikti);
    return;
  }
  const girdi = arg[0];
  if (!girdi || !fs.existsSync(girdi)) { console.error("Girdi PNG bulunamadı"); process.exit(1); }
  const al = (ad, v) => { const i = arg.indexOf(ad); return i >= 0 ? (arg[i + 1] ?? v) : v; };
  const var_ = (ad) => arg.includes(ad);
  const hedef = al("--cikti", path.dirname(girdi));
  fs.mkdirSync(hedef, { recursive: true });
  const taban = path.join(hedef, path.basename(girdi).replace(/\.png$/i, ""));
  let g = pngCoz(fs.readFileSync(girdi));
  const mod = al("--arka-plan", "");
  const yazilan = [];
  if (mod === "parlaklik") g = { ...g, rgba: parlakliktanAlfa(g.rgba, g.w, g.h, Number(al("--kazanc", 1.25))).rgba };
  else if (mod === "duz") {
    const s = arkaPlaniSil(g.rgba, g.w, g.h, Number(al("--tolerans", 32)));
    if (!s.basarili) console.error(s.mesaj);
    g = { ...g, rgba: s.rgba };
  }
  if (var_("--kirp")) g = icerigeKirp(g.rgba, g.w, g.h, Number(al("--bosluk", 0.06)));
  if (mod || var_("--kirp")) {
    const p = taban + "-seffaf.png";
    fs.writeFileSync(p, pngKodla(g.w, g.h, g.rgba));
    yazilan.push(p);
  }
  const boyutlar = String(al("--boyutlar", "")).split(",").map(Number).filter((n) => n >= 8 && n <= 2048);
  const ico = [];
  for (const b of boyutlar) {
    const o = Math.min(b / g.w, b / g.h);
    const nw = Math.max(1, Math.round(g.w * o)), nh = Math.max(1, Math.round(g.h * o));
    const png = pngKodla(nw, nh, yenidenBoyutla(g.rgba, g.w, g.h, nw, nh));
    const p = `${taban}-${b}.png`;
    fs.writeFileSync(p, png);
    yazilan.push(p);
    if (b <= 256 && nw === nh) ico.push({ boyut: b, png });
  }
  if (var_("--ico") && ico.length) {
    const p = taban + ".ico";
    fs.writeFileSync(p, icoOlustur(ico.sort((a, b) => a.boyut - b.boyut)));
    yazilan.push(p);
  }
  console.log(yazilan.join("\n"));
}

main();
