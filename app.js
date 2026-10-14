const API_BASE_URL = "https://foto-seo-shopee.onrender.com";
const apiUrl = (path) => `${API_BASE_URL}${path}`;
const $ = (selector) => document.querySelector(selector);
const grid = $("#bannerGrid");
const names = { promo: "Promosi", minimal: "Minimalis", lifestyle: "Lifestyle", modern: "Modern" };
const palettes = {
  promo: ["#fff0d8", "#f97316", "#7c2d12"],
  minimal: ["#fffaf0", "#e8d8b8", "#482519"],
  lifestyle: ["#efffdc", "#84cc16", "#14532d"],
  modern: ["#e0f2fe", "#60a5fa", "#1e3a8a"],
};
const SAVED_RESULTS_KEY_PREFIX = "foto-seo-shopee.saved-results.account.v1";
function getSavedResultsKey() {
  const userId = String(window.CEO_AUTH_USER_ID || "").trim();
  return userId ? `${SAVED_RESULTS_KEY_PREFIX}.${encodeURIComponent(userId)}` : null;
}
let image = null;
let imageUrl = null;
let sourceFile = null;
let activeBlob = null;
let activeFileName = "";
let productData = null;
let activeStep = 1;
const AI_PHOTO_VARIANTS = [
  { key: "studio", title: "Foto AI 1 · Studio Profesional", description: "Cahaya softbox, warna akurat, komposisi katalog" },
  { key: "lifestyle", title: "Foto AI 2 · Lifestyle Natural", description: "Suasana relevan, cahaya alami, dekor minimal" },
  { key: "contrast", title: "Foto AI 3 · Editorial Modern", description: "Rim light terarah, aksen kontras, framing premium" },
];
let aiPhotos = Array(AI_PHOTO_VARIANTS.length).fill(null);
let aiPhotoErrors = Array(AI_PHOTO_VARIANTS.length).fill(null);
let aiPhotoUrls = [];
let selectedVariantIndex = null;
let selectedStyle = "promo";
let uploadGeneration = 0;
let seoRequestBusy = false;
let seoGeneration = 0;
let videoExportBusy = false;
let activeVideoDownloadUrl = null;
let videoPreviewFrame = 0;
let videoMotionOrigin = performance.now();
let videoMotionDuration = 10000;
let videoPreviewLastPaint = 0;
let activeMenu = "home";
let previousMenu = "home";
let activeSavedResultId = null;
let cloudSyncBusy = false;
let cloudSyncTimer = 0;

const bannerCard = document.createElement("div");
bannerCard.className = "bannerCard";
bannerCard.innerHTML = `<canvas width="900" height="900"></canvas><div class="bannerMeta"><strong>Banner · Promosi</strong><button class="btn outline" id="downloadBanner" disabled>Unduh Banner PNG</button></div>`;
grid.append(bannerCard);

function setActiveMenu(menuName) {
  activeMenu = menuName;
  document.querySelectorAll(".bottomTab").forEach((tab) => {
    const active = tab.dataset.menu === menuName;
    tab.classList.toggle("active", active);
    if (active) tab.setAttribute("aria-current", "page");
    else tab.removeAttribute("aria-current");
  });
}

function showScreen(step) {
  activeStep = step;
  document.querySelector(".stepper").hidden = step > 3;
  document.querySelectorAll(".screen").forEach((screen, index) => { screen.hidden = index + 1 !== step; });
  document.querySelectorAll(".stepper [data-step]").forEach((item) => {
    const number = Number(item.dataset.step);
    item.classList.toggle("active", number === step);
    item.classList.toggle("done", number < step);
    if (number === step) item.setAttribute("aria-current", "step");
    else item.removeAttribute("aria-current");
  });
  const menuByScreen = { 1: "home", 2: "home", 3: "results", 4: "history", 5: "results" };
  setActiveMenu(menuByScreen[step] || "home");
  if (step !== 3 && !videoExportBusy) stopVideoPreview();
  if (step === 3 && !videoExportBusy) startVideoPreview();
  window.scrollTo({ top: 0, behavior: "smooth" });
}

function readSavedResults() {
  try {
    const storageKey = getSavedResultsKey();
    if (!storageKey) return [];
    const value = JSON.parse(localStorage.getItem(storageKey) || "[]");
    return Array.isArray(value) ? value.filter((item) => item && item.id && item.productData) : [];
  } catch {
    return [];
  }
}

function writeSavedResults(records) {
  const storageKey = getSavedResultsKey();
  if (!storageKey) return false;
  try {
    localStorage.setItem(storageKey, JSON.stringify(records));
    return true;
  } catch {
    return false;
  }
}

function mergeSavedResults(localRecords, cloudRecords) {
  const merged = new Map();
  [...(Array.isArray(localRecords) ? localRecords : []), ...(Array.isArray(cloudRecords) ? cloudRecords : [])].forEach((record) => {
    if (record?.id && record?.productData) merged.set(record.id, record);
  });
  return [...merged.values()].sort((a, b) => String(b.savedAt || "").localeCompare(String(a.savedAt || ""))).slice(0, 20);
}

async function cloudSyncSave() {
  const adapter = window.CEO_SYNC_ADAPTER;
  if (!adapter?.save || cloudSyncBusy || !getSavedResultsKey()) return;
  cloudSyncBusy = true;
  try {
    await adapter.save({ version: 1, results: readSavedResults(), updatedAt: new Date().toISOString() });
  } catch (error) {
    console.warn("Sinkronisasi cloud gagal:", error);
  } finally {
    cloudSyncBusy = false;
  }
}

async function cloudSyncLoad() {
  const adapter = window.CEO_SYNC_ADAPTER;
  if (!adapter?.load || !getSavedResultsKey()) return;
  try {
    const cloud = await adapter.load();
    const merged = mergeSavedResults(readSavedResults(), cloud?.results);
    writeSavedResults(merged);
    renderSavedCollections();
  } catch (error) {
    console.warn("Pemulihan sinkronisasi cloud gagal:", error);
  }
}

function scheduleCloudSync() {
  clearTimeout(cloudSyncTimer);
  cloudSyncTimer = setTimeout(cloudSyncSave, 500);
}

function createResultThumbnail() {
  if (!image) return "";
  const thumbnail = document.createElement("canvas");
  thumbnail.width = 180;
  thumbnail.height = 180;
  drawContain(thumbnail.getContext("2d"), image, 0, 0, thumbnail.width, thumbnail.height);
  return thumbnail.toDataURL("image/webp", 0.68);
}

function saveCurrentResult() {
  if (!productData) return false;
  const storageKey = getSavedResultsKey();
  if (!storageKey) return false;
  let thumbnail = "";
  try {
    thumbnail = createResultThumbnail();
  } catch {
    // Text results may still be saved if this browser cannot encode a thumbnail.
  }
  const result = {
    id: globalThis.crypto?.randomUUID?.() || `${Date.now()}-${Math.random().toString(36).slice(2)}`,
    savedAt: new Date().toISOString(),
    photoLabel: selectedVariantIndex === null ? "Foto produk" : AI_PHOTO_VARIANTS[selectedVariantIndex].title,
    thumbnail,
    productData: {
      title: String(productData.title || ""),
      headline: String(productData.headline || productData.title || ""),
      description: String(productData.description || ""),
      keywords: Array.isArray(productData.keywords) ? productData.keywords.map(String) : [],
      narration: String(productData.narration || ""),
    },
  };
  try {
    const results = [result, ...readSavedResults().filter((item) => item.id !== result.id)].slice(0, 20);
    localStorage.setItem(storageKey, JSON.stringify(results));
    scheduleCloudSync();
    activeSavedResultId = result.id;
    renderSavedCollections();
    return true;
  } catch {
    return false;
  }
}

function makeSavedAction(label, className, handler) {
  const button = document.createElement("button");
  button.type = "button";
  button.className = `btn ${className}`;
  button.textContent = label;
  button.onclick = handler;
  return button;
}

function renderSavedCollections() {
  const records = readSavedResults();
  const historyList = $("#historyList");
  const savedGrid = $("#savedResults");
  if (!historyList || !savedGrid) return;
  historyList.replaceChildren();
  savedGrid.replaceChildren();
  $("#historyEmpty").hidden = records.length > 0;
  $("#savedEmpty").hidden = records.length > 0;

  records.forEach((record) => {
    const date = new Date(record.savedAt || Date.now()).toLocaleString("id-ID", { dateStyle: "medium", timeStyle: "short" });
    const title = record.productData.title || "Hasil SEO produk";
    const historyItem = document.createElement("article");
    historyItem.className = "historyItem";
    if (record.thumbnail) {
      const photo = document.createElement("img");
      photo.src = record.thumbnail;
      photo.alt = "";
      historyItem.append(photo);
    }
    const detail = document.createElement("div");
    detail.className = "historyDetail";
    const name = document.createElement("strong");
    name.textContent = title;
    const time = document.createElement("small");
    time.textContent = `${record.photoLabel || "Foto produk"} · ${date}`;
    detail.append(name, time);
    historyItem.append(detail, makeSavedAction("Buka", "outline", () => restoreSavedResult(record.id)));
    historyList.append(historyItem);

    const card = document.createElement("article");
    card.className = "savedCard";
    if (record.thumbnail) {
      const photo = document.createElement("img");
      photo.src = record.thumbnail;
      photo.alt = `Thumbnail ${title}`;
      card.append(photo);
    }
    const cardTitle = document.createElement("strong");
    cardTitle.textContent = title;
    const cardDate = document.createElement("small");
    cardDate.textContent = date;
    const actions = document.createElement("div");
    actions.className = "savedActions";
    actions.append(
      makeSavedAction("Buka hasil", "primary", () => restoreSavedResult(record.id)),
      makeSavedAction("Hapus", "outline", () => deleteSavedResult(record.id)),
    );
    card.append(cardTitle, cardDate, actions);
    savedGrid.append(card);
  });
}

let activeSavedResultsUserId = "";
window.addEventListener("ceo-auth-user-changed", (event) => {
  const nextUserId = String(event.detail?.userId || "");
  if (nextUserId !== activeSavedResultsUserId) {
    activeSavedResultsUserId = nextUserId;
    $("#changePhoto").click();
  }
  renderSavedCollections();
  cloudSyncLoad();
});

function deleteSavedResult(id) {
  const storageKey = getSavedResultsKey();
  if (!storageKey) return;
  try {
    localStorage.setItem(storageKey, JSON.stringify(readSavedResults().filter((item) => item.id !== id)));
    scheduleCloudSync();
  } catch {
    // The current view remains usable if browser storage is unavailable.
  }
  renderSavedCollections();
}

function makeVideoNarration(title, description) {
  const cleanTitle = String(title || "").replace(/\s+/g, " ").trim().replace(/[.!?]+$/, "");
  const cleanDescription = String(description || "").replace(/\s+/g, " ").trim();
  const fullText = [cleanTitle, cleanDescription].filter(Boolean).join(". ");
  if (fullText.length <= 280) return fullText;
  const clipped = fullText.slice(0, 280);
  const sentenceEnd = Math.max(clipped.lastIndexOf(". "), clipped.lastIndexOf("! "), clipped.lastIndexOf("? "));
  if (sentenceEnd >= Math.min(cleanTitle.length + 30, 200)) return clipped.slice(0, sentenceEnd + 1).trim();
  const wordEnd = clipped.lastIndexOf(" ");
  return `${clipped.slice(0, wordEnd > 0 ? wordEnd : 280).replace(/[ ,;:]+$/, "")}.`;
}

function restoreSavedResult(id) {
  const record = readSavedResults().find((item) => item.id === id);
  if (!record) return;
  const data = {
    ...record.productData,
    headline: record.productData.headline || record.productData.title || "",
    narration: record.productData.narration || makeVideoNarration(record.productData.title, record.productData.description),
  };
  const ready = () => {
    productData = data;
    activeSavedResultId = record.id;
    selectedVariantIndex = null;
    sourceFile = null;
    activeBlob = null;
    activeFileName = "";
    $("#selectedPhotoPreview").src = record.thumbnail || "";
    $("#selectedPhotoLabel").textContent = record.photoLabel || "Hasil dari Histori";
    $("#title").textContent = data.title || "";
    $("#description").textContent = data.description || "";
    $("#count").textContent = `${(data.title || "").length} karakter`;
    $("#downloadVideo").disabled = videoExportBusy || !data.narration || !image;
    $("#backToPhotos").disabled = true;
    $("#videoStatus").textContent = "Hasil dibuka dari penyimpanan lokal perangkat ini.";
    renderAll();
    showScreen(3);
  };
  if (!record.thumbnail) {
    image = null;
    ready();
    return;
  }
  const restoredImage = new Image();
  restoredImage.onload = () => { image = restoredImage; ready(); };
  restoredImage.onerror = () => { image = null; ready(); };
  restoredImage.src = record.thumbnail;
}

function drawCover(ctx, source, x, y, width, height) {
  const scale = Math.max(width / source.width, height / source.height);
  const sourceWidth = width / scale;
  const sourceHeight = height / scale;
  ctx.drawImage(source, (source.width - sourceWidth) / 2, (source.height - sourceHeight) / 2, sourceWidth, sourceHeight, x, y, width, height);
}

function drawContain(ctx, source, x, y, width, height) {
  const scale = Math.min(width / source.width, height / source.height);
  const drawWidth = source.width * scale;
  const drawHeight = source.height * scale;
  ctx.drawImage(source, x + (width - drawWidth) / 2, y + (height - drawHeight) / 2, drawWidth, drawHeight);
}

function wrapText(ctx, text, x, y, maxWidth, lineHeight, maxLines = 3) {
  const words = String(text).split(/\s+/);
  const lines = [];
  let line = "";
  for (const word of words) {
    const candidate = line ? `${line} ${word}` : word;
    if (ctx.measureText(candidate).width > maxWidth && line) {
      lines.push(line);
      line = word;
    } else {
      line = candidate;
    }
  }
  if (line) lines.push(line);
  lines.slice(0, maxLines).forEach((value, index) => ctx.fillText(value, x, y + index * lineHeight));
}

function drawBanner(canvas, style) {
  const ctx = canvas.getContext("2d");
  const { width, height } = canvas;
  const [background, accent, ink] = palettes[style] || palettes.promo;
  ctx.fillStyle = background;
  ctx.fillRect(0, 0, width, height);
  const gradient = ctx.createLinearGradient(0, 0, width, height);
  gradient.addColorStop(0, background);
  gradient.addColorStop(1, `${accent}55`);
  ctx.fillStyle = gradient;
  ctx.fillRect(0, 0, width, height);
  for (let index = 0; index < 8; index += 1) {
    ctx.fillStyle = `${accent}25`;
    ctx.beginPath();
    ctx.arc((index * 177 + 50) % width, (index * 137 + 30) % height, 35 + (index % 3) * 15, 0, Math.PI * 2);
    ctx.fill();
  }

  const title = productData?.headline || $("#facts").value.split(/[,.]/)[0] || "Produk Pilihan Anda";
  ctx.fillStyle = ink;
  ctx.textAlign = "center";
  ctx.font = "900 58px system-ui";
  wrapText(ctx, title, width / 2, height * 0.14, width * 0.86, 65, 2);
  ctx.font = "700 25px system-ui";
  ctx.fillText(style === "promo" ? "PILIHAN MENARIK UNTUK ANDA" : style === "minimal" ? "SIMPLE • BERSIH • ELEGAN" : "TEMANI AKTIVITAS SETIAP HARI", width / 2, height * 0.29);
  if (image) {
    ctx.save();
    ctx.beginPath();
    ctx.roundRect(width * 0.07, height * 0.35, width * 0.86, height * 0.54, 25);
    ctx.clip();
    drawCover(ctx, image, width * 0.07, height * 0.35, width * 0.86, height * 0.54);
    ctx.restore();
  }
  if (style === "promo") {
    ctx.fillStyle = "#dc2626";
    ctx.beginPath();
    ctx.arc(width * 0.79, height * 0.8, 62, 0, Math.PI * 2);
    ctx.fill();
    ctx.fillStyle = "#fff";
    ctx.font = "900 19px system-ui";
    ctx.fillText("PRODUK", width * 0.79, height * 0.79);
    ctx.fillText("PILIHAN", width * 0.79, height * 0.83);
  }
  ctx.fillStyle = ink;
  ctx.font = "800 22px system-ui";
  ctx.fillText("LIHAT DETAIL PRODUK", width / 2, height * 0.96);
  ctx.textAlign = "left";
}

function drawVideo(progress = 0, motionTime = performance.now()) {
  const canvas = $("#videoCanvas");
  const ctx = canvas.getContext("2d");
  const { width, height } = canvas;
  const p = Math.max(0, Math.min(1, progress));
  const cycle = (motionTime % 12000) / 12000;
  const smooth = (value) => value * value * (3 - 2 * value);
  const easeOut = (value) => 1 - (1 - value) ** 3;
  const moveIn = easeOut(Math.min(p / 0.16, 1));
  const reveal = Math.min(p / 0.1, 1);
  const pulse = 1 + Math.sin(cycle * Math.PI * 2) * 0.012;
  ctx.fillStyle = "#211532";
  ctx.fillRect(0, 0, width, height);

  if (image) {
    ctx.save();
    ctx.filter = "blur(28px) brightness(0.48) saturate(0.9)";
    const bgDrift = Math.sin(cycle * Math.PI * 2) * 12;
    drawCover(ctx, image, -14 + bgDrift, -14, width + 28, height + 28);
    ctx.restore();
    ctx.fillStyle = "#120d1a44";
    ctx.fillRect(0, 0, width, height);

    // Vertical Shorts framing: visible camera push, gentle lateral drift, and a restrained breathing motion.
    const pushIn = 1 + 0.2 * smooth(Math.min(p / 0.55, 1));
    const pullBackProgress = Math.max(0, Math.min((p - 0.68) / 0.32, 1));
    const pullBack = 1 - 0.085 * smooth(pullBackProgress);
    const scale = (pushIn * pullBack * pulse);
    const boxWidth = width * 0.82 * scale;
    const boxHeight = height * 0.64 * scale;
    const panX = Math.sin(p * Math.PI * 2) * width * 0.025 + Math.sin(cycle * Math.PI * 2) * width * 0.006;
    const panY = -smooth(p) * height * 0.024;
    ctx.save();
    ctx.beginPath();
    ctx.roundRect(width * 0.035, height * 0.025, width * 0.93, height * 0.72, 42);
    ctx.clip();
    ctx.shadowColor = "#0009";
    ctx.shadowBlur = 28;
    drawContain(ctx, image, (width - boxWidth) / 2 + panX, height * 0.055 + panY, boxWidth, boxHeight);
    ctx.restore();
  } else {
    const gradient = ctx.createLinearGradient(0, 0, width, height);
    gradient.addColorStop(0, "#7c3aed");
    gradient.addColorStop(1, "#10b981");
    ctx.fillStyle = gradient;
    ctx.fillRect(0, 0, width, height);
  }

  const captionShade = ctx.createLinearGradient(0, height * 0.68, 0, height);
  captionShade.addColorStop(0, "#120d1a00");
  captionShade.addColorStop(1, "#120d1aee");
  ctx.fillStyle = captionShade;
  ctx.fillRect(0, height * 0.66, width, height * 0.34);
  const headline = productData?.headline || "Produk Pilihan Anda";
  const headlineY = height * 0.82 + (1 - moveIn) * 95;
  const lineProgress = Math.min(Math.max((reveal - 0.2) / 0.8, 0), 1);
  ctx.save();
  ctx.globalAlpha = reveal;
  ctx.fillStyle = "#c4a6ff";
  ctx.textAlign = "left";
  ctx.font = "800 22px system-ui";
  ctx.fillText("KENALI PRODUKNYA", width * 0.063, height * 0.75 + (1 - moveIn) * 48);
  ctx.fillStyle = "#fff";
  ctx.font = "900 56px system-ui";
  ctx.save();
  ctx.beginPath();
  ctx.rect(width * 0.06, headlineY - 62, width * 0.87 * lineProgress, 150);
  ctx.clip();
  wrapText(ctx, headline, width * 0.06, headlineY, width * 0.87, 66, 2);
  ctx.restore();
  const underlineWidth = width * 0.42 * smooth(lineProgress);
  const underline = ctx.createLinearGradient(width * 0.06, 0, width * 0.06 + underlineWidth, 0);
  underline.addColorStop(0, "#8b5cf6");
  underline.addColorStop(1, "#34d399");
  ctx.fillStyle = underline;
  ctx.fillRect(width * 0.06, headlineY + 20, underlineWidth, 6);
  ctx.font = "700 27px system-ui";
  ctx.fillStyle = "#e9defe";
  ctx.fillText("INFO PRODUK", width * 0.063, height * 0.95 + (1 - moveIn) * 28);
  ctx.restore();

  const progressWidth = width * 0.88;
  ctx.fillStyle = "#ffffff3d";
  ctx.fillRect(width * 0.06, height * 0.985, progressWidth, 6);
  ctx.fillStyle = "#9b6cff";
  ctx.fillRect(width * 0.06, height * 0.985, progressWidth * p, 6);
}

function startVideoPreview() {
  if (videoPreviewFrame || videoExportBusy || activeStep !== 3) return;
  videoMotionOrigin = performance.now();
  const animate = (now) => {
    if (now - videoPreviewLastPaint >= 1000 / 30) {
      drawVideo(((now - videoMotionOrigin) % videoMotionDuration) / videoMotionDuration, now);
      videoPreviewLastPaint = now;
    }
    videoPreviewFrame = requestAnimationFrame(animate);
  };
  videoPreviewFrame = requestAnimationFrame(animate);
}

function stopVideoPreview() {
  if (videoPreviewFrame) cancelAnimationFrame(videoPreviewFrame);
  videoPreviewFrame = 0;
}

function getProductContext() {
  return String($("#productContext")?.value || $("#facts")?.value || "").replace(/\s+/g, " ").trim();
}

function syncProductContext() {
  const context = $("#productContext")?.value || "";
  if ($("#facts")) $("#facts").value = context;
  return context.trim();
}

function getProductName() {
  return String($("#productName")?.value || "").replace(/\s+/g, " ").trim();
}

function ensureProductNameInCopy(productName, title, description) {
  const name = String(productName || "").trim();
  if (!name) return { title: String(title || ""), description: String(description || "") };
  const normalized = (value) => value.toLocaleLowerCase("id-ID").replace(/[^\p{L}\p{N}]+/gu, " ").trim();
  const key = normalized(name);
  const safeTitle = String(title || "").trim();
  const safeDescription = String(description || "").trim();
  return {
    title: normalized(safeTitle).includes(key) ? safeTitle : `${name} | ${safeTitle}`,
    description: normalized(safeDescription).includes(key) ? safeDescription : `${name}. ${safeDescription}`,
  };
}

function renderAiTemplates() {
  const gallery = $("#templateGallery");
  if (!gallery) return;
  const name = getProductName() || productData?.headline || "Produk Pilihan";
  const description = productData?.description || getProductContext() || "Konten promosi produk siap digunakan.";
  const short = description.length > 85 ? `${description.slice(0, 82).replace(/\s+\S*$/, "")}…` : description;
  const templates = [
    ["Promo Unggulan", "Diskon & manfaat utama"],
    ["Natural Fresh", "Cocok untuk katalog"],
    ["Marketplace", "Harga & keunggulan"],
    ["Premium Minimal", "Tampilan elegan"],
  ];
  gallery.replaceChildren(...templates.map(([label, hint]) => {
    const card = document.createElement("article");
    card.className = "templateCard";
    const visual = document.createElement("div");
    visual.className = "templateVisual";
    const title = document.createElement("strong");
    title.textContent = name;
    const copy = document.createElement("small");
    copy.textContent = short;
    visual.append(title, copy);
    const meta = document.createElement("div");
    meta.className = "templateMeta";
    meta.append(document.createTextNode(label));
    const metaHint = document.createElement("small");
    metaHint.textContent = hint;
    meta.append(metaHint);
    card.append(visual, meta);
    return card;
  }));
}

function buildSeoContext(productContext) {
  const productName = getProductName();
  return [
    "INSTRUKSI AKURASI WAJIB:",
    "Gunakan deskripsi pemilik di bawah sebagai sumber kebenaran utama tentang NAMA dan JENIS PRODUK.",
    "Foto bisa menampilkan kantong, botol, kotak, label, atau kemasan; jangan menjadikan kemasan sebagai nama produk.",
    "Jangan mengganti produk dengan benda kemasan. Jika deskripsi menyebut terong kering, maka judul dan deskripsi WAJIB membahas terong kering; kantong hanya boleh disebut sebagai kemasan bila terlihat.",
    "Jangan mengarang jenis produk, bahan, manfaat, ukuran, atau klaim yang tidak didukung deskripsi pemilik atau foto.",
    `NAMA PRODUK PERSIS (WAJIB DIPERTAHANKAN): ${productName}`,
    `DESKRIPSI PEMILIK: ${productContext}`,
  ].join("\n");
}

function renderAll() {
  const canvas = bannerCard.querySelector("canvas");
  const format = $("#format").value;
  [canvas.width, canvas.height] = format === "landscape" ? [1200, 675] : format === "portrait" ? [800, 1000] : [900, 900];
  drawBanner(canvas, selectedStyle);
  bannerCard.querySelector("strong").textContent = `Satu Banner · ${names[selectedStyle]}`;
  const hasAiPhoto = aiPhotos.some(Boolean);
  renderAiTemplates();
  $("#downloadBanner").disabled = !hasAiPhoto;
  $("#downloadBanner").onclick = () => saveCanvas(canvas, `banner-${selectedStyle}.png`);
  $("#generate").disabled = !hasAiPhoto || !getProductContext();
  drawVideo();
}

function saveCanvas(canvas, filename) {
  const anchor = document.createElement("a");
  anchor.href = canvas.toDataURL("image/png");
  anchor.download = filename;
  anchor.click();
}

function setVideoLoading(busy, label = "Buat & unduh video MP4") {
  const button = $("#downloadVideo");
  const spinner = $("#videoLoadingSpinner");
  const text = $("#downloadVideoLabel");
  const status = $("#videoStatus");
  videoExportBusy = busy;
  spinner.hidden = !busy;
  button.setAttribute("aria-busy", String(busy));
  status.classList.toggle("isLoading", busy);
  status.setAttribute("aria-busy", String(busy));
  text.textContent = busy ? label : "Buat & unduh video MP4";
  button.disabled = busy || !productData?.narration;
}

function clearVideoDownload() {
  if (activeVideoDownloadUrl) URL.revokeObjectURL(activeVideoDownloadUrl);
  activeVideoDownloadUrl = null;
  const link = $("#videoDownloadLink");
  const actions = $("#videoDownloadActions");
  if (link) {
    link.hidden = true;
    link.removeAttribute("href");
  }
  if (actions) actions.hidden = true;
}

function resetGeneratedCopy() {
  productData = null;
  clearVideoDownload();
  $("#title").textContent = "Judul SEO muncul di sini.";
  $("#description").textContent = "Deskripsi muncul di sini.";
  $("#count").textContent = "0 karakter";
  $("#downloadVideo").disabled = true;
}

function renderAiPhotoGallery() {
  const gallery = $("#aiPhotoGallery");
  gallery.replaceChildren();
  AI_PHOTO_VARIANTS.forEach((variant, index) => {
    const photo = aiPhotos[index];
    const card = document.createElement("article");
    card.className = `aiPhotoCard${selectedVariantIndex === index ? " selected" : ""}`;
    if (!photo) {
      const placeholder = document.createElement("div");
      placeholder.className = "aiPhotoPlaceholder";
      placeholder.textContent = aiPhotoErrors[index] ? `${variant.title}\n${aiPhotoErrors[index]}` : `${variant.title}\nMenunggu hasil AI…`;
      card.append(placeholder);
      gallery.append(card);
      return;
    }

    const preview = document.createElement("img");
    preview.src = photo.url;
    preview.alt = variant.title;
    const title = document.createElement("strong");
    title.textContent = variant.title;
    const detail = document.createElement("small");
    detail.textContent = variant.description;
    const actions = document.createElement("div");
    actions.className = "photoActions";
    const choose = document.createElement("button");
    choose.className = "btn primary";
    choose.type = "button";
    choose.textContent = selectedVariantIndex === index ? "Dipakai · ketuk untuk ulang" : "Pakai foto ini";
    choose.disabled = seoRequestBusy;
    choose.onclick = () => selectAiPhoto(index);
    const download = document.createElement("button");
    download.className = "btn outline";
    download.type = "button";
    download.textContent = "Unduh foto AI";
    download.onclick = () => downloadBlob(photo.blob, `foto-ai-${variant.key}.jpg`);
    actions.append(choose, download);
    card.append(preview, title, detail, actions);
    gallery.append(card);
  });
}

function downloadBlob(blob, filename) {
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = filename;
  anchor.click();
  setTimeout(() => URL.revokeObjectURL(url), 60_000);
}

function selectAiPhoto(index) {
  if (seoRequestBusy) return;
  const photo = aiPhotos[index];
  if (!photo) return;
  selectedVariantIndex = index;
  image = photo.image;
  activeBlob = photo.blob;
  activeFileName = `foto-ai-${AI_PHOTO_VARIANTS[index].key}.jpg`;
  $("#selectedPhotoPreview").src = photo.url;
  $("#selectedPhotoPreview").alt = AI_PHOTO_VARIANTS[index].title;
  $("#selectedPhotoLabel").textContent = AI_PHOTO_VARIANTS[index].title;
  resetGeneratedCopy();
  $("#bgBadge").textContent = `${AI_PHOTO_VARIANTS[index].title} dipilih`;
  $("#status").textContent = "Membuat SEO dari foto pilihan…";
  $("#videoStatus").textContent = "Judul dan deskripsi sedang disiapkan.";
  $("#generate").hidden = true;
  $("#generate").textContent = "Buat SEO";
  renderAiPhotoGallery();
  renderAll();
  if (syncProductContext()) {
    $("#generate").click();
  } else {
    $("#generate").hidden = false;
    $("#generate").disabled = true;
    $("#status").textContent = "Isi deskripsi atau contoh penggunaan produk di atas agar judul dan deskripsi lebih akurat.";
  }
}

async function generateAiPhotos(file, runId) {
  $("#retryAiEdits").hidden = true;
  $("#retryAiEdits").disabled = true;
  const total = AI_PHOTO_VARIANTS.length;
  $("#editStatus").textContent = `Cloudflare AI sedang menata pencahayaan, komposisi, dan gaya untuk ${total} foto produk profesional…`;
  $("#editStatus").classList.add("isLoading");
  $("#editStatus").style.setProperty("--progress", "0%");
  let finished = 0;
  const jobs = AI_PHOTO_VARIANTS.map(async (variant, index) => {
    if (runId !== uploadGeneration || aiPhotos[index]) return;
    aiPhotoErrors[index] = null;
    try {
      const form = new FormData();
      form.append("photo", file, file.name);
      form.append("style", variant.key);
      const response = await fetch(apiUrl("/api/image-edit"), { method: "POST", body: form });
      if (!response.ok) {
        const result = await response.json().catch(() => ({}));
        throw new Error(result.error || "AI gagal mengedit foto.");
      }
      const blob = await response.blob();
      if (!blob.type.startsWith("image/")) throw new Error("Hasil AI bukan file gambar.");
      if (runId !== uploadGeneration) return;
      const url = URL.createObjectURL(blob);
      const loadedImage = await new Promise((resolve, reject) => {
        const candidate = new Image();
        candidate.onload = () => resolve(candidate);
        candidate.onerror = () => reject(new Error("Foto hasil AI tidak dapat dibuka."));
        candidate.src = url;
      }).catch((error) => {
        URL.revokeObjectURL(url);
        throw error;
      });
      if (runId !== uploadGeneration) {
        URL.revokeObjectURL(url);
        return;
      }
      aiPhotos[index] = { blob, url, image: loadedImage };
      aiPhotoUrls[index] = url;
      renderAiPhotoGallery();
    } catch (error) {
      if (runId === uploadGeneration) aiPhotoErrors[index] = error.message;
    } finally {
      if (runId === uploadGeneration) {
        finished += 1;
        const ready = aiPhotos.filter(Boolean).length;
        $("#editStatus").style.setProperty("--progress", `${Math.round((finished / total) * 100)}%`);
        $("#editStatus").textContent = `Foto AI siap ${ready}/${total}${finished < total ? ` · ${total - finished} masih diproses…` : ""}`;
        renderAiPhotoGallery();
      }
    }
  });

  await Promise.all(jobs);
  if (runId !== uploadGeneration) return;
  $("#editStatus").classList.remove("isLoading");
  const readyCount = aiPhotos.filter(Boolean).length;
  if (readyCount === total) {
    $("#editStatus").textContent = "Tiga foto AI siap. Pilih salah satunya untuk banner, SEO, dan video.";
    $("#retryAiEdits").hidden = true;
  } else if (readyCount > 0) {
    $("#editStatus").textContent = `${readyCount} dari ${total} foto AI siap; ${total - readyCount} variasi gagal. Anda tetap bisa memakai foto yang berhasil.`;
    $("#retryAiEdits").hidden = false;
    $("#retryAiEdits").disabled = false;
  } else {
    $("#editStatus").textContent = aiPhotoErrors.find(Boolean) || "Foto AI gagal dibuat. Periksa koneksi atau kuota gratis harian Cloudflare.";
    $("#retryAiEdits").hidden = false;
    $("#retryAiEdits").disabled = false;
  }
}

$("#photo").onchange = (event) => {
  const file = event.target.files[0];
  if (!file) return;
  if (file.size > 10 * 1024 * 1024) {
    alert("Maksimal 10 MB");
    event.target.value = "";
    return;
  }
  if (!/^image\/(jpeg|png|webp)$/.test(file.type)) {
    alert("Gunakan JPG, PNG, atau WEBP.");
    event.target.value = "";
    return;
  }
  const runId = ++uploadGeneration;
  if (imageUrl) URL.revokeObjectURL(imageUrl);
  aiPhotoUrls.forEach((url) => url && URL.revokeObjectURL(url));
  aiPhotoUrls = [];
  aiPhotos = Array(AI_PHOTO_VARIANTS.length).fill(null);
  aiPhotoErrors = Array(AI_PHOTO_VARIANTS.length).fill(null);
  selectedVariantIndex = null;
  seoGeneration += 1;
  seoRequestBusy = false;
  $("#status").classList.remove("isLoading");
  $("#status").setAttribute("aria-busy", "false");
  $("#generate").hidden = true;
  $("#generate").textContent = "Buat SEO";
  sourceFile = file;
  activeSavedResultId = null;
  $("#backToPhotos").disabled = false;
  $("#uploadError").textContent = "";
  imageUrl = URL.createObjectURL(file);
  const nextImage = new Image();
  nextImage.onload = () => {
    if (runId !== uploadGeneration) return;
    image = nextImage;
    activeBlob = file;
    activeFileName = file.name;
    resetGeneratedCopy();
    $("#photoPreview").src = imageUrl;
    $("#photoPreview").hidden = false;
    $("#uploadTitle").textContent = file.name;
    $("#bgBadge").textContent = "Foto asli · tiga variasi AI sedang dibuat";
    $("#status").textContent = "Pilih foto AI untuk membuat SEO otomatis.";
    $("#videoStatus").textContent = "Buat SEO terlebih dahulu, lalu satu tombol akan membuat video Shorts dengan suara AI.";
    $("#retryAiEdits").hidden = true;
    showScreen(2);
    renderAiPhotoGallery();
    renderAll();
    generateAiPhotos(file, runId);
  };
  nextImage.onerror = () => {
    if (runId !== uploadGeneration) return;
    $("#uploadError").textContent = "Foto tidak dapat dibaca. Pilih gambar lain.";
    showScreen(1);
  };
  nextImage.src = imageUrl;
};

const photoDropZone = $(".upload");
photoDropZone.addEventListener("dragover", (event) => {
  event.preventDefault();
  photoDropZone.classList.add("dragover");
});
photoDropZone.addEventListener("dragleave", (event) => {
  if (!photoDropZone.contains(event.relatedTarget)) photoDropZone.classList.remove("dragover");
});
photoDropZone.addEventListener("drop", (event) => {
  event.preventDefault();
  photoDropZone.classList.remove("dragover");
  const file = event.dataTransfer?.files?.[0];
  if (!file) return;
  const transfer = new DataTransfer();
  transfer.items.add(file);
  $("#photo").files = transfer.files;
  $("#photo").dispatchEvent(new Event("change", { bubbles: true }));
});

$("#retryAiEdits").onclick = async () => {
  if (!sourceFile) return;
  $("#retryAiEdits").disabled = true;
  await generateAiPhotos(sourceFile, uploadGeneration);
};

$("#backToUpload").onclick = () => {
  $("#photo").value = "";
  showScreen(1);
};
$("#backToPhotos").onclick = () => showScreen(2);
$("#changePhoto").onclick = () => {
  $("#photo").value = "";
  sourceFile = null;
  image = null;
  if (imageUrl) URL.revokeObjectURL(imageUrl);
  imageUrl = null;
  activeBlob = null;
  activeFileName = "";
  productData = null;
  selectedVariantIndex = null;
  aiPhotoUrls.forEach((url) => url && URL.revokeObjectURL(url));
  aiPhotoUrls = [];
  aiPhotos = Array(AI_PHOTO_VARIANTS.length).fill(null);
  aiPhotoErrors = Array(AI_PHOTO_VARIANTS.length).fill(null);
  $("#photoPreview").hidden = true;
  renderAiPhotoGallery();
  resetGeneratedCopy();
  renderAll();
  showScreen(1);
};

document.querySelectorAll(".bottomTab").forEach((tab) => {
  tab.onclick = () => {
    const menu = tab.dataset.menu;
    if (menu === "home") showScreen(1);
    else if (menu === "history") {
      renderSavedCollections();
      showScreen(4);
    } else if (menu === "results") {
      renderSavedCollections();
      showScreen(5);
    } else if (menu === "settings") openSettingsMenu();
  };
});

document.querySelectorAll(".style").forEach((button) => {
  button.onclick = () => {
    selectedStyle = button.dataset.style;
    document.querySelectorAll(".style").forEach((item) => item.classList.toggle("active", selectedStyle === item.dataset.style));
    renderAll();
  };
});

const settingsDialog = $("#settingsDialog");
function openSettingsMenu() {
  previousMenu = activeMenu;
  setActiveMenu("settings");
  if (!settingsDialog.open) settingsDialog.showModal();
}
$("#openSettings").onclick = openSettingsMenu;
$("#closeSettings").onclick = () => settingsDialog.close();
settingsDialog.addEventListener("close", () => setActiveMenu(previousMenu));
$("#checkServices").onclick = async () => {
  const button = $("#checkServices");
  const status = $("#settingsStatus");
  button.disabled = true;
  status.textContent = "Memeriksa konfigurasi layanan…";
  try {
    const response = await fetch(apiUrl("/api/health"), { cache: "no-store" });
    const health = await response.json();
    if (!response.ok) throw new Error("Status server tidak tersedia.");
    status.textContent = `Cloudflare: ${health.cloudflareApiConfigured ? "terkonfigurasi" : "belum dikonfigurasi"}. Gemini: ${health.geminiApiKeyConfigured ? "terkonfigurasi" : "belum dikonfigurasi"}. Status kuota tidak dapat dipastikan di sini.`;
  } catch {
    status.textContent = "Tidak dapat memeriksa server. Coba lagi saat koneksi internet tersedia.";
  } finally {
    button.disabled = false;
  }
};

const updateSeoReadiness = () => {
  const context = syncProductContext();
  const name = getProductName();
  const hasAiPhoto = aiPhotos.some(Boolean);
  $("#generate").disabled = !hasAiPhoto || !name || !context;
  if (context && selectedVariantIndex !== null && $("#generate").hidden === false && !seoRequestBusy) {
    $("#status").textContent = "Deskripsi sudah siap. Tekan Buat SEO untuk melanjutkan.";
  }
};
$("#productContext")?.addEventListener("input", updateSeoReadiness);
$("#productName")?.addEventListener("input", updateSeoReadiness);

$("#format").onchange = renderAll;

$("#generate").onclick = async () => {
  if (seoRequestBusy) return;
  if (!image || !activeBlob || selectedVariantIndex === null) {
    $("#status").textContent = "Tunggu foto AI selesai dibuat, lalu pilih foto yang akan digunakan.";
    return;
  }
  const requestId = ++seoGeneration;
  const runId = uploadGeneration;
  seoRequestBusy = true;
  const button = $("#generate");
  const retrying = !button.hidden;
  button.disabled = true;
  if (retrying) button.textContent = "Mencoba lagi…";
  $("#status").textContent = "Membuat judul dan deskripsi singkat…";
  $("#status").classList.add("isLoading");
  $("#status").setAttribute("aria-busy", "true");
  renderAiPhotoGallery();
  try {
    const form = new FormData();
    form.append("photo", activeBlob, activeFileName || sourceFile?.name || "foto-produk.png");
    const productContext = syncProductContext();
    const productName = getProductName();
    if (!productName) {
      button.disabled = true;
      button.hidden = false;
      $("#status").classList.remove("isLoading");
      $("#status").textContent = "Nama produk wajib diisi agar AI tidak salah mengenali kemasan sebagai produk.";
      seoRequestBusy = false;
      return;
    }
    if (!productContext) {
      button.disabled = true;
      button.hidden = false;
      $("#status").classList.remove("isLoading");
      $("#status").textContent = "Deskripsi produk wajib diisi agar hasil CEO lebih akurat.";
      seoRequestBusy = false;
      return;
    }
    form.append("extra", buildSeoContext(productContext));
    form.append("product_context", productContext);
    form.append("product_name", productName);
    const response = await fetch(apiUrl("/api/seo"), { method: "POST", body: form });
    const result = await response.json();
    if (!response.ok) throw new Error(result.error || "Gagal membuat SEO.");
    if (requestId !== seoGeneration || runId !== uploadGeneration) return;
    const faithfulCopy = ensureProductNameInCopy(productName, result.title, result.description);
    productData = {
      title: faithfulCopy.title,
      description: faithfulCopy.description,
      headline: faithfulCopy.title || productName,
      keywords: [],
      narration: makeVideoNarration(result.title, result.description),
    };
    button.hidden = true;
    button.textContent = "Buat SEO";
    const savedLocally = saveCurrentResult();
    $("#title").textContent = faithfulCopy.title;
    $("#description").textContent = faithfulCopy.description;
    $("#count").textContent = `${faithfulCopy.title.length} karakter`;
    renderAll();
    $("#downloadVideo").disabled = videoExportBusy || !productData.narration;
    $("#videoStatus").textContent = "Siap: satu ketukan membuat dan mengunduh video Shorts bersuara AI.";
    $("#status").textContent = savedLocally
      ? "Selesai. Hasil tersimpan di Hasil Saya pada perangkat ini. Tinjau kembali sebelum digunakan."
      : "Selesai. Tinjau kembali sebelum digunakan. Penyimpanan Histori browser tidak tersedia.";
    showScreen(3);
  } catch (error) {
    if (requestId === seoGeneration && runId === uploadGeneration) {
      $("#status").textContent = error.message;
      button.hidden = false;
      button.textContent = "Coba lagi menyiapkan judul";
    }
  } finally {
    if (requestId === seoGeneration) {
      seoRequestBusy = false;
      $("#status").classList.remove("isLoading");
      $("#status").setAttribute("aria-busy", "false");
      button.disabled = !aiPhotos.some(Boolean);
      renderAiPhotoGallery();
    }
  }
};

$("#downloadVideo").onclick = async () => {
  if (!image || !productData?.narration) return;
  if (!$("#videoCanvas").captureStream || !window.MediaRecorder) {
    $("#videoStatus").textContent = "Ekspor video bersuara memerlukan browser Chrome atau Edge terbaru.";
    return;
  }

  const button = $("#downloadVideo");
  clearVideoDownload();
  stopVideoPreview();
  setVideoLoading(true, "Membuat narasi…");
  let audioContext;
  let canvasStream;
  let audioStream;
  let animationFrame;
  try {
    $("#videoStatus").textContent = "Membuat narasi AI, merender video vertikal, lalu mengonversinya ke MP4…";
    const AudioContextClass = window.AudioContext || window.webkitAudioContext;
    if (!AudioContextClass) throw new Error("Browser ini tidak mendukung pemrosesan audio. Coba Chrome terbaru.");
    audioContext = new AudioContextClass();
    try {
      await audioContext.resume();
    } catch {
      throw new Error("Browser memblokir audio. Ketuk tombol Buat & unduh lagi, lalu izinkan audio untuk situs ini.");
    }
    if (audioContext.state !== "running") throw new Error("Aktifkan audio browser lalu coba buat video lagi.");
    const ttsResponse = await fetch(apiUrl("/api/tts"), {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ text: productData.narration }),
      signal: AbortSignal.timeout(150_000),
    });
    if (!ttsResponse.ok) {
      const result = await ttsResponse.json().catch(() => ({}));
      throw new Error(result.error || "Narasi AI gagal dibuat; coba lagi sebentar.");
    }

    const ttsProvider = ttsResponse.headers.get("X-TTS-Provider");
    const voiceBlob = await ttsResponse.blob();
    const audioBuffer = await audioContext.decodeAudioData(await voiceBlob.arrayBuffer());
    videoMotionDuration = audioBuffer.duration * 1000;
    setVideoLoading(true, "Merender video…");
    if (ttsProvider === "cloudflare-aura-1") {
      $("#videoStatus").textContent = "Kuota Gemini habis; memakai Cloudflare Aura-1 dari alokasi Workers AI gratis. Naskah tetap Bahasa Indonesia, tetapi aksen suara dapat terdengar berbeda. Merender video…";
    }
    const source = audioContext.createBufferSource();
    const audioDestination = audioContext.createMediaStreamDestination();
    source.buffer = audioBuffer;
    source.connect(audioDestination);
    source.connect(audioContext.destination);

    const canvas = $("#videoCanvas");
    canvasStream = canvas.captureStream(30);
    audioStream = audioDestination.stream;
    const combinedStream = new MediaStream([...canvasStream.getVideoTracks(), ...audioStream.getAudioTracks()]);
    const mimeType = ["video/webm;codecs=vp9,opus", "video/webm;codecs=vp8,opus", "video/webm"]
      .find((type) => MediaRecorder.isTypeSupported(type));
    const recorder = new MediaRecorder(combinedStream, mimeType ? { mimeType } : undefined);
    const chunks = [];
    const startedAt = performance.now();
    videoMotionOrigin = startedAt;

    recorder.ondataavailable = (event) => { if (event.data.size) chunks.push(event.data); };
    recorder.onerror = () => {
      $("#videoStatus").textContent = "Perekaman gagal. Coba Chrome atau Edge terbaru.";
      setVideoLoading(false);
    };
    recorder.onstop = async () => {
      try {
        const sourceVideo = new Blob(chunks, { type: recorder.mimeType || "video/webm" });
        if (!sourceVideo.size) throw new Error("File video kosong. Coba buat ulang.");
        setVideoLoading(true, "Mengonversi MP4…");
        $("#videoStatus").textContent = "Video selesai dirender. Mengonversi ke MP4…";
        const form = new FormData();
        const uploadVideo = new Blob([sourceVideo], { type: "video/webm" });
        form.append("video", uploadVideo, "video-shorts.webm");
        const response = await fetch(apiUrl("/api/video/mp4"), {
          method: "POST",
          body: form,
          signal: AbortSignal.timeout(210_000),
        });
        if (!response.ok) {
          const result = await response.json().catch(() => ({}));
          throw new Error(result.error || "Konversi MP4 gagal. Coba buat videonya sekali lagi.");
        }
        const mp4Video = await response.blob();
        if (!mp4Video.size || mp4Video.type !== "video/mp4") throw new Error("Server tidak mengembalikan file MP4 yang valid.");
        activeVideoDownloadUrl = URL.createObjectURL(mp4Video);
        const downloadLink = $("#videoDownloadLink");
        downloadLink.href = activeVideoDownloadUrl;
        downloadLink.hidden = false;
        $("#videoDownloadActions").hidden = false;
        downloadLink.click();
        $("#videoStatus").textContent = "MP4 siap. Jika unduhan tidak dimulai otomatis, tekan tombol Unduh MP4.";
      } catch (error) {
        $("#videoStatus").textContent = error.message || "Konversi MP4 gagal. Coba lagi.";
      } finally {
        canvasStream?.getTracks().forEach((track) => track.stop());
        audioStream?.getTracks().forEach((track) => track.stop());
        await audioContext?.close().catch(() => {});
        drawVideo();
        setVideoLoading(false);
        if (activeStep === 3) startVideoPreview();
      }
    };

    const animate = (now) => {
      const progress = Math.min((now - startedAt) / (audioBuffer.duration * 1000), 1);
      drawVideo(progress, now);
      if (progress < 1) animationFrame = requestAnimationFrame(animate);
    };
    recorder.start(500);
    animationFrame = requestAnimationFrame(animate);
    source.onended = () => { if (recorder.state !== "inactive") recorder.stop(); };
    source.start();
  } catch (error) {
    cancelAnimationFrame(animationFrame);
    canvasStream?.getTracks().forEach((track) => track.stop());
    audioStream?.getTracks().forEach((track) => track.stop());
    await audioContext?.close().catch(() => {});
    $("#videoStatus").textContent = error.message || "Tidak dapat membuat video bersuara.";
    setVideoLoading(false);
    if (activeStep === 3) startVideoPreview();
  }
};

document.querySelectorAll("[data-copy]").forEach((button) => {
  button.onclick = async () => {
    const text = $("#" + button.dataset.copy).textContent;
    try {
      await navigator.clipboard.writeText(text);
      button.textContent = "Tersalin";
      setTimeout(() => { button.textContent = "Salin"; }, 1200);
    } catch { alert(text); }
  };
});

$("#copyAll").onclick = async () => {
  const text = ["Judul Produk", $("#title").textContent, "Deskripsi", $("#description").textContent].join("\n\n");
  try {
    await navigator.clipboard.writeText(text);
    $("#copyAll").textContent = "Tersalin";
    setTimeout(() => { $("#copyAll").textContent = "Salin judul dan deskripsi"; }, 1200);
  } catch { alert(text); }
};

showScreen(1);
renderAll();
renderSavedCollections();
fetch(apiUrl("/api/health")).then((response) => response.json()).then((health) => {
  if (!health.cloudflareApiConfigured) $("#uploadError").textContent = "Cloudflare belum tersambung. Tambahkan CLOUDFLARE_ACCOUNT_ID dan CLOUDFLARE_API_TOKEN di Environment Render.";
}).catch(() => {});

const installButton = $("#installPwa");
const installMessage = $("#installMessage");
let installPromptEvent = null;
const isInstalledApp = window.matchMedia("(display-mode: standalone)").matches || window.navigator.standalone === true;
if (isInstalledApp) installButton.hidden = true;

window.addEventListener("beforeinstallprompt", (event) => {
  event.preventDefault();
  installPromptEvent = event;
  installButton.textContent = "Instal Aplikasi";
});

installButton.onclick = async () => {
  if (installPromptEvent) {
    installPromptEvent.prompt();
    const choice = await installPromptEvent.userChoice;
    installMessage.hidden = false;
    installMessage.textContent = choice.outcome === "accepted" ? "Aplikasi sedang dipasang." : "Pemasangan dibatalkan.";
    installPromptEvent = null;
    return;
  }
  installMessage.hidden = false;
  installMessage.textContent = /iPhone|iPad|iPod/.test(navigator.userAgent)
    ? "Di Safari: tekan Bagikan, lalu pilih Tambahkan ke Layar Utama."
    : "Di Android: buka menu ⋮ Chrome, lalu pilih Instal aplikasi atau Tambahkan ke layar utama.";
};

window.addEventListener("appinstalled", () => {
  installButton.hidden = true;
  installMessage.hidden = false;
  installMessage.textContent = "CEO Shopee sudah terpasang.";
});

if ("serviceWorker" in navigator) {
  window.addEventListener("load", () => {
    navigator.serviceWorker.register("./service-worker.js", { scope: "./" }).catch(() => {});
  });
}
