// Wiring Rules Reader — offline PDF reader with contents, tables, index, search and bookmarks.
// Everything runs on the device. The PDF is never uploaded.
import * as pdfjsLib from './vendor/pdf.min.js';
import { NZ_DATES, TIMELINE, REGS_MODS, TOPICS, BUILT_IN_AMENDMENTS, HIGHLIGHTS } from './changes.js';

pdfjsLib.GlobalWorkerOptions.workerSrc = new URL('./vendor/pdf.worker.min.js', import.meta.url).href;
const STD_FONTS = new URL('./vendor/standard_fonts/', import.meta.url).href;
const ANALYSIS_VERSION = 9;

const $ = (s, r = document) => r.querySelector(s);
const $$ = (s, r = document) => [...r.querySelectorAll(s)];
const esc = s => String(s).replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
const icon = id => `<svg class="icon"><use href="#i-${id}"/></svg>`;
const sleep = ms => new Promise(r => setTimeout(r, ms));
const isPhone = () => matchMedia('(max-width:820px)').matches;

/* ------------------------------------------------------------------ storage */
const prefs = {
  get(k, d) { try { const v = localStorage.getItem('wrr.' + k); return v == null ? d : JSON.parse(v); } catch { return d; } },
  set(k, v) { try { localStorage.setItem('wrr.' + k, JSON.stringify(v)); } catch {} }
};
const db = (() => {
  let p = null;
  const open = () => p ||= new Promise((res, rej) => {
    try {
      const r = indexedDB.open('wiring-rules-reader', 1);
      r.onupgradeneeded = () => { const d = r.result; for (const s of ['files', 'analysis', 'user']) if (!d.objectStoreNames.contains(s)) d.createObjectStore(s); };
      r.onsuccess = () => res(r.result); r.onerror = () => rej(r.error);
    } catch (e) { rej(e); }
  });
  const tx = async (store, mode, fn) => {
    const d = await open();
    return new Promise((res, rej) => { const t = d.transaction(store, mode); const s = t.objectStore(store); const out = fn(s); t.oncomplete = () => res(out && 'result' in out ? out.result : out); t.onerror = () => rej(t.error); t.onabort = () => rej(t.error); });
  };
  return {
    get: (s, k) => tx(s, 'readonly', st => st.get(k)).catch(() => undefined),
    put: (s, k, v) => tx(s, 'readwrite', st => st.put(v, k)).catch(e => { console.warn('store failed', e); return null; }),
    del: (s, k) => tx(s, 'readwrite', st => st.delete(k)).catch(() => null),
    all: async s => { try { const d = await open(); return await new Promise((res, rej) => { const out = []; const c = d.transaction(s).objectStore(s).openCursor(); c.onsuccess = () => { const cur = c.result; if (cur) { out.push({ key: cur.key, value: cur.value }); cur.continue(); } else res(out); }; c.onerror = () => rej(c.error); }); } catch { return []; } }
  };
})();

/* ------------------------------------------------------------------ state */
const S = {
  pdf: null, id: null, name: '', sizes: [], offsets: [], scale: 1, zoom: prefs.get('zoom', 1), fitScale: 1,
  A: null,               // analysis
  user: { bookmarks: [], favTables: [], recent: [], lastPos: null },
  pageText: [], lineStarts: [],
  terms: [], backStack: [], current: 0, rendered: new Set(), tab: prefs.get('tab', 'contents'),
  textCache: new Map()
};
const viewer = $('#viewer'), pagesEl = $('#pages');
let pageEls = [];

/* ------------------------------------------------------------------ helpers */
const normMap = { '‘': "'", '’': "'", '“': '"', '”': '"', '–': '-', '—': '-', '‐': '-', '‑': '-', ' ': ' ', ' ': ' ', ' ': ' ', ' ': ' ' };
const norm1 = s => s.replace(/[‘’“”–—‐‑    ]/g, c => normMap[c]).toLowerCase(); // length-preserving
const clean = s => s.replace(/\s+/g, ' ').trim();
function toast(msg, ms = 2200) { const t = $('#toast'); t.textContent = msg; t.hidden = false; clearTimeout(toast._t); toast._t = setTimeout(() => t.hidden = true, ms); }
const pageLabel = p => (S.A?.labels?.[p]) || String(p + 1);
const cmpPos = (a, b) => a.p - b.p || (a.y || 0) - (b.y || 0);

/* ================================================================== ANALYSIS
   Reads every page's text once, then works out: printed page numbers,
   clause/section/appendix headings, table and figure captions, the printed
   contents + lists of tables/figures, and the back-of-book index.          */
const RX = {
  section: /^SECTION\s+(\d{1,2})\b\s*(.*)$/,
  appendix: /^APPENDIX\s+([A-Z]{1,2})\b\s*(.*)$/,
  clause: /^((?:[A-Z]{1,2})?\d{1,2}(?:\.\d{1,3}){1,6})\s+([A-Z(‘'"“].{1,160})$/,
  appClause: /^([A-Z]\d{1,2})\s+([A-Z][A-Z0-9 ,’'()\-–—/&]{3,})$/,
  caption: /^(TABLE|FIGURE|Table|Figure)\s+([A-Z]{0,2}\d{1,3}(?:\.\d{1,3})*(?:\s?\([A-Z0-9]{1,2}\))?)(?=\s|$)\s*(.*)$/,
  leader: /^(.*?)[\s.·…]*(?:(?:\.\s?){2,}|…)[\s.]*(\d{1,4})\s*$/,
  trailingPage: /^(.*\S)\s+(\d{1,4})\s*$/
};
const REF = String.raw`(?:(?:App(?:endix)?\.?|Tables?|Figures?|Figs?\.?|Sections?|Clauses?)\s+)?(?:[A-Z]{1,2}\d{0,3}(?:\.\d{1,3})*(?:\([a-zA-Z0-9]{1,3}\))?|\d{1,3}(?:\.\d{1,3})+(?:\([a-z0-9]{1,3}\))?)`;
const REF_TAIL = new RegExp(String.raw`^\s*${REF}(?:\s*(?:,|and|to|&)\s*${REF})*\s*,?\s*$`);
const REF_ONE = new RegExp(REF, 'g');

async function analyse(pdf, onProgress) {
  const n = pdf.numPages;
  const raw = [], freq = new Map();
  let labelsFromPdf = null;
  try { labelsFromPdf = await pdf.getPageLabels(); } catch {}
  for (let i = 0; i < n; i++) {
    const page = await pdf.getPage(i + 1);
    const vp = page.getViewport({ scale: 1 });
    const tc = await page.getTextContent();
    const items = [];
    for (const it of tc.items) {
      if (!('str' in it) || !it.str.trim()) continue;
      const t = it.transform;
      const fh = Math.hypot(t[2], t[3]) || 10;
      const [x, y] = vp.convertToViewportPoint(t[4], t[5]);
      const [x2] = vp.convertToViewportPoint(t[4] + (it.width || 0), t[5]);
      items.push([it.str, x, y, Math.max(x2, x + 1), fh]);
    }
    const seen = new Set();
    for (const it of items) { const k = boilKey(it[0]); if (k.length >= 8 && !seen.has(k)) { seen.add(k); freq.set(k, (freq.get(k) || 0) + 1); } }
    raw.push({ w: vp.width, h: vp.height, items });
    page.cleanup();
    if (i % 4 === 0) onProgress(i / n);
  }
  onProgress(1);
  const boilCut = Math.max(5, Math.ceil(n * 0.22));
  const isBoil = s => { const k = boilKey(s); return k.length >= 8 && (freq.get(k) || 0) >= boilCut; };

  // printed page labels from header/footer zones (before boilerplate is removed)
  let labels = new Array(n).fill('');
  if (n < 12) labels = labels.map((_, i) => String(i + 1));
  else if (labelsFromPdf && labelsFromPdf.some((l, i) => l && l !== String(i + 1))) labels = labelsFromPdf.map(l => l || '');
  else {
    for (let i = 0; i < n; i++) {
      const { h, items } = raw[i];
      let best = '';
      for (const it of items) {
        const zone = it[2] < h * 0.09 || it[2] > h * 0.92;
        if (!zone) continue;
        const m = it[0].trim().split(/\s+/).find(tok => /^\d{1,4}$/.test(tok));
        if (m) { best = m; if (it[2] < h * 0.09) break; }
      }
      labels[i] = best;
    }
    // fill gaps / fix odd ones using the dominant offset
    const cnt = new Map();
    labels.forEach((l, i) => { if (l) { const o = +l - i; cnt.set(o, (cnt.get(o) || 0) + 1); } });
    const found = labels.filter(Boolean).length;
    if (found > n * 0.3) {
      const off = [...cnt.entries()].sort((a, b) => b[1] - a[1])[0][0];
      for (let i = 0; i < n; i++) {
        const pred = i + off;
        if (!labels[i]) { if (pred > 0 && localAgrees(labels, i, off)) labels[i] = String(pred); }
        else if (+labels[i] !== pred && localAgrees(labels, i, off, true)) labels[i] = String(pred);
      }
    } else labels = labels.map((_, i) => String(i + 1));
  }

  // lines per page (content-stream order; new line on baseline change or jump left)
  const lines = raw.map(({ items }) => {
    const out = [];
    let cur = null;
    for (const [s, x, y, x2, fh] of items) {
      if (isBoil(s)) continue;
      if (cur && Math.abs(y - cur.y) <= Math.min(fh, cur.fh) * 0.55 && x >= cur.x2 - fh * 0.8) {
        const gap = x - cur.x2;
        cur.t += (gap > fh * 0.18 && !/\s$/.test(cur.t) && !/^\s/.test(s) ? (gap > fh * 2.5 ? '   ' : ' ') : '') + s;
        cur.x2 = x2;
      } else {
        if (cur) out.push(cur);
        cur = { t: s, x, y, x2, fh };
      }
    }
    if (cur) out.push(cur);
    return out.map(l => ({ t: clean(l.t), x: Math.round(l.x * 10) / 10, y: Math.round((l.y - l.fh * 0.95) * 10) / 10, x2: Math.round(l.x2), h: Math.round(l.fh * 1.25 * 10) / 10 })).filter(l => l.t);
  });
  const sizes = raw.map(r => [Math.round(r.w * 100) / 100, Math.round(r.h * 100) / 100]);

  // ---------- printed contents & lists (front matter)
  const tocPages = new Set(), toc = [], tableList = [], figList = [], tocRows = [];
  let mode = null, started = false, pend = null, emptyRun = 0, lastPg = 0;
  S._apx = false;
  const flush = (label = true) => { if (pend && label && mode === 'contents' && pend.t.length < 90) toc.push({ kind: 'label', title: pend.t, rows: [pend.row] }); pend = null; };
  for (let p = 0; p < Math.min(n, 80); p++) {
    const L = lines[p];
    let hits = 0;
    for (const l of L) {
      const t = l.t;
      if (/^CONTENTS$/i.test(t) || /^TABLE OF CONTENTS$/i.test(t)) { mode = 'contents'; started = true; tocPages.add(p); flush(false); continue; }
      if (/^LIST OF TABLES$/i.test(t)) { mode = 'tables'; started = true; tocPages.add(p); flush(false); continue; }
      if (/^LIST OF FIGURES$/i.test(t)) { mode = 'figures'; started = true; tocPages.add(p); flush(false); continue; }
      if (!started) continue;
      if (/^(Page|TABLE\s+Page|FIGURE\s+Page|TABLE|FIGURE)$/i.test(t) || /^AS\/NZS\s/.test(t) || /^\d{1,4}\s+AS\/NZS/.test(t)) continue;
      const row = { p, y: l.y, h: l.h, x: l.x, x2: l.x2 };
      if (mode === 'contents' && /^APPENDI(CES|X)\b/.test(t)) S._apx = true;
      let lm = t.match(RX.leader);
      if (!lm && mode === 'contents' && /^(SECTION\s+\d|APPENDIX\s|(?:[A-Z])?\d{1,2}(?:\.\d+)+\s)/.test(t)) {
        const tm = t.match(RX.trailingPage);
        if (tm && +tm[2] >= lastPg && +tm[2] <= lastPg + 80) lm = tm;
      }
      if (lm) {
        hits++;
        let text = clean(lm[1].replace(/[.\s]+$/, ''));
        let rows = [row];
        if (pend && !startsEntry(text, mode)) { text = pend.t + ' ' + text; rows = [pend.row, row]; pend = null; }
        else flush();
        const e = parseTocEntry(text, lm[2], mode);
        if (e) { e.rows = rows; if (mode === 'contents') lastPg = +lm[2]; (mode === 'tables' ? tableList : mode === 'figures' ? figList : toc).push(e); }
      } else if (mode) {
        if (pend && !startsEntry(t, mode)) { pend.t += ' ' + t; }
        else { flush(); pend = { t, row }; }
      }
    }
    if (started) { if (hits) { tocPages.add(p); emptyRun = 0; } else if (++emptyRun >= 1 && toc.length + tableList.length > 5) break; }
  }
  flush();

  // ---------- index (back matter)
  let ixStart = -1;
  for (let p = n - 1; p >= Math.floor(n * 0.6); p--) if (lines[p].slice(0, 6).some(l => /^INDEX$/i.test(l.t))) { ixStart = p; break; }
  const indexPages = new Set();
  if (ixStart >= 0) for (let p = ixStart; p < n; p++) { if (p > ixStart + 2 && !lines[p].some(l => REF_TAIL.test(tailOf(l.t)))) break; indexPages.add(p); }

  // ---------- body headings & captions
  const clauses = {}, sections = {}, appendices = {}, tables = {}, figures = {};
  const heads = []; // per page array of heading refs [{y,id,title}]
  for (let p = 0; p < n; p++) {
    heads[p] = [];
    if (tocPages.has(p) || indexPages.has(p)) continue;
    const L = lines[p];
    for (let j = 0; j < L.length; j++) {
      const t = L[j].t, y = L[j].y;
      if (RX.leader.test(t)) continue;
      let m;
      if ((m = t.match(RX.section))) {
        const id = m[1]; const title = m[2] || nextCaps(L, j);
        if (!sections[id]) { sections[id] = { p, y, title: titleCase(title) }; heads[p].push({ y, id: 'Section ' + id, title: titleCase(title) }); }
        continue;
      }
      if ((m = t.match(RX.appendix))) {
        const id = m[1]; const title = m[2] && !/^\((in)?formative\)$/i.test(m[2]) ? m[2] : nextCaps(L, j, true);
        if (!appendices[id]) { appendices[id] = { p, y, title: titleCase(title) }; heads[p].push({ y, id: 'Appendix ' + id, title: titleCase(title) }); }
        continue;
      }
      if ((m = t.match(RX.caption))) {
        const upper = m[1] === m[1].toUpperCase();
        const cont = /\(continued\)|\(cont(?:'|’)?d\)/i.test(m[3]);
        const title = clean(m[3].replace(/\(continued\)/i, '')) || nextCaps(L, j);
        if (!upper && !(isCapsLine(title) && title.length > 3)) continue;
        const id = m[2].replace(/\s+/g, '');
        const map = /^t/i.test(m[1]) ? tables : figures;
        if (!map[id]) { if (!cont || true) map[id] = { p, y, title: titleCase(title), last: p, cont }; }
        else { map[id].last = Math.max(map[id].last, p); if (map[id].cont && !cont) Object.assign(map[id], { p, y, cont: false }); }
        continue;
      }
      if ((m = t.match(RX.clause)) || (m = t.match(RX.appClause))) {
        const id = m[1]; const first = +id.replace(/^[A-Z]+/, '').split('.')[0];
        if (/^\d/.test(id) && first > 12) continue;
        if (/\s\d{1,4}$/.test(m[2]) && /\.{3,}/.test(m[2])) continue;
        if (!clauses[id]) { const title = titleCase(clean(m[2])); clauses[id] = { p, y, title }; heads[p].push({ y, id, title }); }
      }
    }
  }

  // ---------- index entries (use indentation to tell headwords from sub-entries)
  const index = [];
  if (ixStart >= 0) {
    let head = null, last = null;
    for (const p of [...indexPages].sort((a, b) => a - b)) {
      const L = lines[p].filter(l => !/^INDEX$/i.test(l.t) && !/^COPYRIGHT$/i.test(l.t) && !/^AS\/NZS/.test(l.t) && !/^\d{1,4}\s+AS\/NZS/.test(l.t) && !/^NOTES?$/i.test(l.t));
      const cols = splitColumns(L, raw[p].w);
      for (const col of cols) {
        const xs = [...new Set(col.map(l => Math.round(l.x)))].sort((a, b) => a - b);
        const base = xs[0] ?? 0;
        const steps = []; for (let k = 1; k < xs.length; k++) if (xs[k] - xs[k - 1] >= 3) steps.push(xs[k] - xs[k - 1]);
        const unit = steps.length ? Math.max(4, Math.min(...steps)) : 0;
        for (const l of col) {
          const t = l.t;
          if (/^[A-Z]$/.test(t)) { index.push({ letter: t }); head = last = null; continue; }
          const lvl = unit ? Math.round((l.x - base) / unit) : -1;
          const { text, refs } = splitRefs(t);
          const pos = { p, y: l.y };
          if (lvl >= 2 && last) { if (text) last.text += ' ' + text; last.refs.push(...refs); continue; }
          if (!text && refs.length && last) { last.refs.push(...refs); continue; }
          if (/^see\b/i.test(text) && head) { const sub = { text, refs, pos, see: true }; head.subs.push(sub); last = sub; continue; }
          if (lvl === 0 || (lvl === -1 && !refs.length && !/^see\b/i.test(text))) {
            head = { head: text, refs, subs: [], pos }; index.push(head); last = head; continue;
          }
          const sub = { text, refs, pos };
          if (!head) { head = { head: text, refs, subs: [], pos }; index.push(head); last = head; continue; }
          head.subs.push(sub); last = sub;
        }
      }
    }
  }

  for (const e of toc) {
    const map = e.kind === 'section' ? sections : e.kind === 'appendix' ? appendices : null;
    const b = map?.[e.id];
    if (b && e.title && e.title.length > (b.title || '').length) {
      b.title = e.title;
      const h = heads[b.p].find(h => h.id === (e.kind === 'section' ? 'Section ' : 'Appendix ') + e.id); if (h) h.title = e.title;
    }
  }
  return {
    v: ANALYSIS_VERSION, n, sizes, labels, lines, tocPages: [...tocPages], indexPages: [...indexPages],
    toc, tableList, figList, clauses, sections, appendices, tables, figures, heads, index
  };
}
function boilKey(s) { return clean(s).toLowerCase().replace(/\d+/g, '#'); }
function localAgrees(labels, i, off, strict) {
  let ok = 0, tot = 0;
  for (const j of [i - 2, i - 1, i + 1, i + 2]) if (labels[j]) { tot++; if (+labels[j] - j === off) ok++; }
  return strict ? tot >= 2 && ok === tot : tot === 0 || ok >= Math.ceil(tot / 2);
}
function startsEntry(t, mode) {
  if (/^(SECTION|APPENDIX|APPENDICES|PREFACE|FOREWORD|INDEX|Part\s+\d|PART\s+\d)\b/.test(t)) return true;
  if (/^(?:[A-Z]{1,2})?\d{1,2}(?:\.\d+)+\s/.test(t)) return true;
  if (mode !== 'contents' && /^[A-Z]{1,2}\d{1,3}(?:\([A-Z]\))?\s/.test(t)) return true;
  if (mode !== 'contents' && /^\d{1,2}(?:\.\d+)?(?:\([A-Z]\))?\s/.test(t)) return true;
  if (mode === 'contents' && S._apx && /^[A-Z]\s+[A-Z][A-Z]/.test(t)) return true;
  return false;
}
function parseTocEntry(text, page, mode) {
  let m;
  if (mode === 'tables' || mode === 'figures') {
    if ((m = text.match(/^((?:[A-Z]{1,2})?\d{1,3}(?:\.\d{1,3})?(?:\s?\([A-Z0-9]{1,2}\))?)\s+(.+)$/))) return { id: m[1].replace(/\s+/g, ''), title: titleCase(m[2]), page };
    return null;
  }
  if ((m = text.match(/^SECTION\s+(\d{1,2})\s+(.+)$/))) return { kind: 'section', id: m[1], title: titleCase(m[2]), page, level: 0 };
  if ((m = text.match(/^APPENDIX\s+([A-Z]{1,2})\s+(.+)$/)) || (S._apx && (m = text.match(/^([A-Z])\s+([A-Z][A-Z].+)$/)))) return { kind: 'appendix', id: m[1], title: titleCase(m[2]), page, level: 0 };
  if ((m = text.match(/^((?:[A-Z]{1,2})?\d{1,2}(?:\.\d{1,3})+)\s+(.+)$/))) return { kind: 'clause', id: m[1], title: titleCase(m[2]), page, level: Math.min(3, m[1].split('.').length - 1) };
  return { kind: 'front', id: '', title: titleCase(text), page, level: 0 };
}
function isCapsLine(t) { const letters = t.replace(/[^A-Za-z]/g, ''); return letters.length > 2 && letters === letters.toUpperCase(); }
function nextCaps(L, j, skipNormative) {
  const out = [];
  for (let k = j + 1; k < Math.min(L.length, j + 4); k++) {
    const t = L[k].t;
    if (skipNormative && /^\((in)?formative\)$/i.test(t)) continue;
    if (isCapsLine(t) && !RX.caption.test(t)) { out.push(t); if (out.join(' ').length > 50) break; } else break;
  }
  return out.join(' ');
}
const SMALL = new Set(['a', 'an', 'and', 'as', 'at', 'by', 'for', 'from', 'in', 'into', 'of', 'on', 'or', 'the', 'to', 'with', 'within', 'per', 'via']);
function titleCase(t) {
  t = clean(t || '');
  if (!isCapsLine(t)) return t;
  return t.toLowerCase().split(' ').map((w, i) => {
    if (/^(rcds?|rcbos?|mens?|elv|lv|hv|ac|dc|a\.c\.|d\.c\.|ip|ipx\d|pv|ups|ev|mpa|mm\d*|kv|kva|kw|zs|ia|ol|sc|nz|as\/nzs|iec|aal|sels|pelv|felv|ii|i)$/i.test(w.replace(/[(),]/g, '')))
      return w.toUpperCase().replace('MM2', 'mm²').replace('MM', 'mm').replace('MPA', 'MPa').replace('KV', 'kV').replace('KW', 'kW').replace('ZS', 'Zs').replace('IA', 'Ia').replace('A.C.', 'a.c.').replace('D.C.', 'd.c.');
    if (i > 0 && SMALL.has(w)) return w;
    return w.replace(/^([("‘']*)(\p{L})/u, (_, a, b) => a + b.toUpperCase()).replace(/-(\p{L})/gu, (_, b) => '-' + b.toUpperCase());
  }).join(' ');
}
function tailOf(t) { return t.replace(/^.*?(?=\s(?:App|Tables?|Figures?|[A-Z]{0,2}\d))/, ''); }
function splitRefs(t) {
  // find the earliest point where the rest of the line is only references
  const words = [...t.matchAll(/\S+/g)];
  for (const w of words) {
    const rest = t.slice(w.index);
    if (REF_TAIL.test(rest)) {
      const refs = [];
      let prefix = '';
      for (const m of rest.matchAll(REF_ONE)) {
        let r = m[0];
        const pm = r.match(/^(App(?:endix)?\.?|Tables?|Figures?|Figs?\.?|Sections?|Clauses?)\s+/);
        if (pm) prefix = pm[1]; else if (prefix) r = prefix + ' ' + r;
        refs.push(r);
      }
      return { text: clean(t.slice(0, w.index).replace(/,\s*$/, '')), refs };
    }
  }
  return { text: t, refs: [] };
}
function splitColumns(L, w) {
  if (!L.length) return [];
  const right = L.filter(l => l.x > w * 0.45), left = L.filter(l => l.x <= w * 0.45);
  if (right.length > 8 && left.length > 8) return [left, right];
  return [L];
}

/* ------------------------------------------------------------------ resolve references */
function resolveRef(kind, id) {
  const A = S.A; if (!A) return null;
  id = String(id).replace(/\s+/g, '');
  const pick = (o, label) => o ? { p: o.p, y: o.y, label } : null;
  if (kind === 'table') return pick(A.tables[id] || A.tables[id.toUpperCase()], 'Table ' + id) || fromList(A.tableList, id, 'Table ');
  if (kind === 'figure') return pick(A.figures[id] || A.figures[id.toUpperCase()], 'Figure ' + id) || fromList(A.figList, id, 'Figure ');
  if (kind === 'section') return pick(A.sections[id], 'Section ' + id) || tocPage(e => e.kind === 'section' && e.id === id, 'Section ' + id);
  if (kind === 'appendix' && /^[A-Z]{1,2}$/.test(id)) return pick(A.appendices[id], 'Appendix ' + id) || tocPage(e => e.kind === 'appendix' && e.id === id, 'Appendix ' + id);
  if (kind === 'page') { const p = labelToPage(id); return p == null ? null : { p, y: 0, label: 'p. ' + id }; }
  // clause (numeric or appendix clause like C2.5.1)
  let cur = id;
  while (cur) {
    if (A.clauses[cur]) return { p: A.clauses[cur].p, y: A.clauses[cur].y, label: (/^[A-Z]/.test(id) ? 'App ' : 'Clause ') + id, approx: cur !== id };
    const t = tocPage(e => e.kind === 'clause' && e.id === cur, 'Clause ' + cur); if (t) return t;
    if (!cur.includes('.')) break;
    cur = cur.replace(/\.\d+$/, '');
  }
  if (/^[A-Z]{1,2}\d/.test(id)) { const L = id.match(/^[A-Z]{1,2}/)[0]; if (A.appendices[L]) return pick(A.appendices[L], 'Appendix ' + L); }
  if (/^\d{1,2}$/.test(id) && A.sections[id]) return pick(A.sections[id], 'Section ' + id);
  return null;
}
function fromList(list, id, pre) { const e = list.find(x => x.id === id); if (!e) return null; const p = labelToPage(e.page); return p == null ? null : { p, y: 0, label: pre + id }; }
function tocPage(fn, label) { const e = S.A.toc.find(fn); if (!e) return null; const p = labelToPage(e.page); return p == null ? null : { p, y: 0, label }; }
function labelToPage(lbl) {
  const L = S.A?.labels; if (!L) return null;
  if (!S._l2p) { S._l2p = new Map(); L.forEach((l, i) => { if (l && !S._l2p.has(l)) S._l2p.set(l, i); }); }
  const v = S._l2p.get(String(lbl));
  if (v != null) return v;
  const n = +lbl; return Number.isInteger(n) && n >= 1 && n <= S.A.n ? n - 1 : null;
}
function refToTarget(ref) {
  let m = ref.match(/^(App(?:endix)?\.?|Tables?|Figures?|Figs?\.?|Sections?|Clauses?)\s+(.+)$/i);
  let kind = 'clause', id = ref;
  if (m) {
    id = m[2]; const k = m[1].toLowerCase();
    kind = k.startsWith('tab') ? 'table' : k.startsWith('fig') ? 'figure' : k.startsWith('sec') ? 'section' : k.startsWith('app') ? (/^[A-Z]{1,2}$/.test(id) ? 'appendix' : 'clause') : 'clause';
  }
  id = id.replace(/\(.*\)$/, m && /^tab|^fig/i.test(m[1]) ? '$&' : '');
  return { kind, id, t: resolveRef(kind, id) || (kind === 'table' || kind === 'figure' ? resolveRef(kind, id.replace(/\(.*\)$/, '')) : null) };
}
function contextAt(p, y = 1e9) {
  const H = S.A?.heads; if (!H) return null;
  let best = null;
  for (let q = p; q >= 0 && q >= p - 40; q--) {
    for (const h of H[q]) if (q < p || h.y <= y + 2) { if (!best || q > best.q || (q === best.q && h.y > best.y)) best = { ...h, q }; }
    if (best) break;
  }
  return best;
}

/* ================================================================== VIEWER */
function buildPages() {
  renderGen++; renderBusy = false; visible.clear();
  pagesEl.innerHTML = '';
  pageEls = S.sizes.map((_, i) => {
    const d = document.createElement('div');
    d.className = 'page'; d.dataset.p = i;
    d.innerHTML = `<span class="ph">${i + 1}</span>`;
    pagesEl.appendChild(d);
    d._tok = 0; d._scale = 0;
    return d;
  });
  io?.disconnect();
  io = new IntersectionObserver(onIntersect, { root: viewer, rootMargin: '120% 0px' });
  pageEls.forEach(d => io.observe(d));
}
let io = null;
const visible = new Set();
function onIntersect(entries) {
  for (const e of entries) { const i = +e.target.dataset.p; if (e.isIntersecting) visible.add(i); else visible.delete(i); }
  queueRender();
}
function computeFit() {
  const maxW = Math.max(...S.sizes.map(s => s[0]));
  const avail = viewer.clientWidth - (isPhone() ? 12 : 24);
  S.fitScale = Math.max(0.2, avail / maxW);
}
function layout(anchor) {
  anchor ||= currentAnchor();
  computeFit();
  S.scale = S.fitScale * S.zoom;
  let off = 0; const gap = isPhone() ? 8 : 12, top = isPhone() ? 8 : 14;
  S.offsets = [];
  pageEls.forEach((d, i) => {
    const [w, h] = S.sizes[i];
    d.style.width = (w * S.scale) + 'px'; d.style.height = (h * S.scale) + 'px';
    d.style.setProperty('--scale-factor', S.scale); d.style.setProperty('--total-scale-factor', S.scale);
    S.offsets.push(top + off); off += h * S.scale + gap;
  });
  $('#zVal').textContent = Math.round(S.zoom * 100) + '%';
  if (anchor) restoreAnchor(anchor);
  for (const i of S.rendered) if (pageEls[i]._scale !== S.scale) pageEls[i].dataset.stale = '1';
  queueRender();
}
function currentAnchor() {
  if (!S.offsets.length) return null;
  const y = viewer.scrollTop + 1;
  const p = pageAtY(y);
  const hgt = S.sizes[p][1] * S.scale;
  return { p, f: (y - S.offsets[p]) / hgt, x: viewer.scrollLeft / Math.max(1, pagesEl.scrollWidth) };
}
function restoreAnchor(a) {
  const p = Math.min(a.p, pageEls.length - 1);
  viewer.scrollTop = S.offsets[p] + a.f * S.sizes[p][1] * S.scale - 1;
  if (a.x != null) viewer.scrollLeft = a.x * pagesEl.scrollWidth;
}
function pageAtY(y) {
  const o = S.offsets; let lo = 0, hi = o.length - 1;
  while (lo < hi) { const mid = (lo + hi + 1) >> 1; if (o[mid] <= y) lo = mid; else hi = mid - 1; }
  return lo;
}
let renderBusy = false, renderGen = 0;
function queueRender() { if (!renderBusy) { renderBusy = true; requestAnimationFrame(renderLoop); } }
async function renderLoop() {
  const gen = renderGen;
  try {
    while (gen === renderGen) {
      const cur = S.current;
      const todo = [...visible].filter(i => pageEls[i]._scale !== S.scale || pageEls[i].dataset.stale).sort((a, b) => Math.abs(a - cur) - Math.abs(b - cur));
      if (!todo.length) break;
      await renderPage(todo[0]);
    }
    // free far-away canvases
    if (S.rendered.size > 14) for (const i of [...S.rendered]) if (Math.abs(i - S.current) > 7 && !visible.has(i)) unrender(i);
  } finally { if (gen === renderGen) renderBusy = false; }
}
function unrender(i) {
  const d = pageEls[i]; d._tok++; d._scale = 0; delete d.dataset.stale;
  d.innerHTML = `<span class="ph">${i + 1}</span>`; S.rendered.delete(i);
}
async function getText(i) {
  if (S.textCache.has(i)) return S.textCache.get(i);
  const page = await S.pdf.getPage(i + 1);
  const tc = await page.getTextContent();
  S.textCache.set(i, tc); if (S.textCache.size > 30) S.textCache.delete(S.textCache.keys().next().value);
  return tc;
}
async function renderPage(i) {
  const d = pageEls[i]; const tok = ++d._tok; const scale = S.scale;
  try {
    const page = await S.pdf.getPage(i + 1);
    if (tok !== d._tok) return;
    const vp = page.getViewport({ scale });
    let ds = Math.min(window.devicePixelRatio || 1, 2.5);
    const px = vp.width * vp.height * ds * ds; if (px > 14e6) ds *= Math.sqrt(14e6 / px);
    const canvas = document.createElement('canvas');
    canvas.width = Math.floor(vp.width * ds); canvas.height = Math.floor(vp.height * ds);
    const ctx = canvas.getContext('2d', { alpha: false });
    await page.render({ canvasContext: ctx, viewport: vp, transform: ds !== 1 ? [ds, 0, 0, ds, 0, 0] : null }).promise;
    if (tok !== d._tok) return;
    const tl = document.createElement('div'); tl.className = 'textLayer';
    const tc = await getText(i);
    if (tok !== d._tok) return;
    const layer = new pdfjsLib.TextLayer({ textContentSource: tc, container: tl, viewport: vp });
    await layer.render();
    if (tok !== d._tok) return;
    const ov = document.createElement('div'); ov.className = 'overlay';
    d.replaceChildren(canvas, tl, ov);
    d._scale = scale; delete d.dataset.stale; S.rendered.add(i);
    decorateText(i);
    buildOverlay(i, page, ov).catch(() => {});
  } catch (e) {
    if (e?.name !== 'RenderingCancelledException') console.warn('render', i, e);
  }
}

/* text-layer decoration: cross-reference links + search highlights */
const XREF = /\b(Clauses?|Sections?|Appendix|Appendices|App\.?|Tables?|Figures?|Figs?\.)\s+((?:[A-Z]{1,2}\d{0,3}(?:\.\d{1,3})*|\d{1,3}(?:\.\d{1,3})*)(?:\([A-Za-z0-9]{1,2}\))?(?:(?:\s*,\s*|\s+(?:and|or|to)\s+)(?:[A-Z]{1,2}\d{0,3}(?:\.\d{1,3})*|\d{1,3}(?:\.\d{1,3})*)(?:\([A-Za-z0-9]{1,2}\))?)*)/g;
const BARE = /(?<![\w.])((?:[A-Z]{1,2}\d{1,3}(?:\.\d{1,3})*)|\d{1,2}(?:\.\d{1,3}){1,6})(?![\w.]*\d)/g;
function findXrefs(text, pageIdx) {
  const out = [];
  if (!S.A) return out;
  for (const m of text.matchAll(XREF)) {
    const kw = m[1].toLowerCase();
    const kind = kw.startsWith('tab') ? 'table' : kw.startsWith('fig') ? 'figure' : kw.startsWith('sec') ? 'section' : kw.startsWith('app') ? 'app' : 'clause';
    const start = m.index + m[0].indexOf(m[2]);
    for (const idm of m[2].matchAll(/[A-Z]{1,2}\d{0,3}(?:\.\d{1,3})*(?:\([A-Za-z0-9]{1,2}\))?|\d{1,3}(?:\.\d{1,3})*(?:\([A-Za-z0-9]{1,2}\))?/g)) {
      let id = idm[0], k = kind;
      if (k === 'app') k = /^[A-Z]{1,2}$/.test(id) ? 'appendix' : 'clause';
      if (k === 'clause' || k === 'section') id = id.replace(/\([a-z0-9]{1,2}\)$/i, '');
      const t = resolveRef(k, id) || (k !== 'clause' ? resolveRef(k, id.replace(/\(.*\)$/, '')) : null);
      if (t && !(t.p === pageIdx && Math.abs(t.y) < 1 && k === 'clause')) out.push([start + idm.index, start + idm.index + idm[0].length, t]);
    }
  }
  if (S.indexSet.has(pageIdx)) {
    for (const m of text.matchAll(BARE)) {
      if (out.some(o => m.index >= o[0] && m.index < o[1])) continue;
      const t = resolveRef('clause', m[1]);
      if (t) out.push([m.index, m.index + m[0].length, t]);
    }
  }
  return out;
}
function decorateText(i) {
  const d = pageEls[i]; const tl = d.querySelector('.textLayer'); if (!tl) return;
  // undo previous highlight decoration
  for (const sp of tl.querySelectorAll('span[data-orig]')) { sp.textContent = sp.dataset.orig; delete sp.dataset.orig; }
  const terms = S.terms;
  for (const sp of tl.querySelectorAll('span:not(.markedContent)')) {
    if (sp.children.length || sp.getAttribute('role') === 'img') continue;
    const text = sp.textContent; if (!text || text.length < 2) continue;
    const segs = [];
    for (const [a, b, t] of findXrefs(text, i)) segs.push({ a, b, x: t });
    if (terms.length) {
      const low = norm1(text);
      for (const term of terms) for (const k of findAll(low, term)) segs.push({ a: k, b: k + term.length, h: 1 });
    }
    if (!segs.length) continue;
    // build boundaries
    const cuts = new Set([0, text.length]); segs.forEach(s => { cuts.add(s.a); cuts.add(s.b); });
    const pts = [...cuts].sort((a, b) => a - b);
    const frag = document.createDocumentFragment();
    for (let k = 0; k < pts.length - 1; k++) {
      const a = pts[k], b = pts[k + 1]; const piece = text.slice(a, b);
      const x = segs.find(s => s.x && s.a <= a && s.b >= b), h = segs.some(s => s.h && s.a <= a && s.b >= b);
      if (!x && !h) { frag.append(piece); continue; }
      const e = document.createElement('span'); e.textContent = piece;
      if (x) { e.className = 'x'; e._t = x.x; e.title = 'Go to ' + x.x.label + ' · p. ' + pageLabel(x.x.p); }
      if (h) e.className += ' h';
      frag.append(e);
    }
    sp.dataset.orig = text; sp.replaceChildren(frag);
  }
}
async function buildOverlay(i, page, ov) {
  const A = S.A; const [w, h] = S.sizes[i];
  const pct = (v, t) => (v / t * 100) + '%';
  if (A && S.tocSet.has(i)) {
    for (const e of S.tocEntries) for (const r of e.rows || []) {
      if (r.p !== i || !e.target) continue;
      const a = document.createElement('a'); a.className = 'rowlink';
      Object.assign(a.style, { left: pct(r.x - 4, w), width: pct(Math.max(r.x2, w * 0.88) - r.x + 8, w), top: pct(r.y - 1, h), height: pct(r.h + 2, h) });
      a.title = 'Go to ' + (e.label || e.title); a._t = e.target; ov.appendChild(a);
    }
  }
  const anns = await page.getAnnotations({ intent: 'display' });
  const vp = page.getViewport({ scale: 1 });
  for (const an of anns) {
    if (an.subtype !== 'Link' || (!an.dest && !an.url)) continue;
    const [x1, y1, x2, y2] = vp.convertToViewportRectangle(an.rect);
    const a = document.createElement('a'); a.className = 'annlink';
    Object.assign(a.style, { left: pct(Math.min(x1, x2), w), top: pct(Math.min(y1, y2), h), width: pct(Math.abs(x2 - x1), w), height: pct(Math.abs(y2 - y1), h) });
    if (an.url) { a.href = an.url; a.target = '_blank'; a.rel = 'noopener'; }
    else a._dest = an.dest;
    ov.prepend(a);
  }
}
async function destToTarget(dest) {
  try {
    const explicit = typeof dest === 'string' ? await S.pdf.getDestination(dest) : dest;
    if (!explicit) return null;
    const p = typeof explicit[0] === 'object' ? await S.pdf.getPageIndex(explicit[0]) : explicit[0];
    let y = 0;
    if (explicit[1]?.name === 'XYZ' && explicit[3] != null) { const page = await S.pdf.getPage(p + 1); const vp = page.getViewport({ scale: 1 }); y = Math.max(0, vp.convertToViewportPoint(0, explicit[3])[1] - 4); }
    return { p, y, label: 'p. ' + pageLabel(p) };
  } catch { return null; }
}

pagesEl.addEventListener('click', async e => {
  const x = e.target.closest('span.x, .rowlink, .annlink');
  if (!x) return;
  if (x._t) { e.preventDefault(); go(x._t); }
  else if (x._dest) { e.preventDefault(); const t = await destToTarget(x._dest); if (t) go(t); }
});

/* navigation */
function go(t, { record = true, flash = true } = {}) {
  if (!t) { toast('That reference could not be found in this PDF'); return; }
  if (record) {
    const a = currentAnchor();
    if (a) { S.backStack.push(a); if (S.backStack.length > 50) S.backStack.shift(); updateBack(); try { history.pushState({ wrr: S.backStack.length }, ''); } catch {} }
    addRecent(t);
  }
  const top = S.offsets[t.p] + (t.y || 0) * S.scale - (t.y ? 18 : 0);
  viewer.scrollTo({ top: Math.max(0, top), behavior: 'auto' });
  if (flash && t.y != null) flashAt(t);
  if (isPhone()) closeDrawer(true);
}
function flashAt(t) {
  const d = pageEls[t.p]; if (!d) return;
  d.querySelector('.landing')?.remove();
  const f = document.createElement('div'); f.className = 'landing';
  const [, h] = S.sizes[t.p];
  const lh = t.h || 14;
  f.style.top = ((t.y || 0) / h * 100) + '%'; f.style.height = (t.y ? (lh + 4) : 16) / h * 100 + '%';
  d.appendChild(f); setTimeout(() => f.remove(), 2600);
}
function goBack() {
  const a = S.backStack.pop(); updateBack();
  if (a) restoreAnchor(a);
}
function updateBack() {
  const b = $('#backBtn'); const a = S.backStack[S.backStack.length - 1];
  b.hidden = !a; if (a) $('#backLbl').textContent = isPhone() ? 'Back' : 'Back to p. ' + pageLabel(a.p);
}
window.addEventListener('popstate', () => {
  if (drawerOpen()) { closeDrawer(false); return; }
  if (S.backStack.length) goBack();
});

/* scroll tracking */
let scrollT = 0;
viewer.addEventListener('scroll', () => {
  const p = pageAtY(viewer.scrollTop + viewer.clientHeight * 0.3);
  if (p !== S.current) { S.current = p; onPageChange(); }
  clearTimeout(scrollT); scrollT = setTimeout(saveLastPos, 600);
}, { passive: true });
function onPageChange() {
  const p = S.current;
  $('#pageChip').textContent = `${pageLabel(p)} · ${p + 1}/${S.sizes.length}`;
  const ctx = S.tocSet?.has(p) ? { id: '', title: 'Contents' } : S.indexSet?.has(p) ? { id: '', title: 'Index' } : contextAt(p);
  $('#docWhere').innerHTML = `p. ${esc(pageLabel(p))}` + (ctx ? ` · <span class="mono">${esc(ctx.id)}</span> ${esc(ctx.title)}` : '');
  const bm = S.user.bookmarks.some(b => b.p === p);
  $('#bmBtn').setAttribute('aria-pressed', bm); $('#bmBtn').title = bm ? 'Remove bookmark (B)' : 'Bookmark this page (B)';
  markCurrentToc();
  updateNotice();
}
function saveLastPos() { const a = currentAnchor(); if (a && S.id) { S.user.lastPos = a; saveUser(); } }

/* zoom */
const ZSTEPS = [0.5, 0.67, 0.8, 0.9, 1, 1.1, 1.25, 1.5, 1.75, 2, 2.5, 3, 4];
function setZoom(z, anchor) { S.zoom = Math.min(4, Math.max(0.4, z)); prefs.set('zoom', S.zoom); layout(anchor); }
$('#zIn').onclick = () => setZoom(ZSTEPS.find(z => z > S.zoom + 0.01) || 4);
$('#zOut').onclick = () => setZoom([...ZSTEPS].reverse().find(z => z < S.zoom - 0.01) || 0.4);
$('#zVal').onclick = () => setZoom(1);
viewer.addEventListener('wheel', e => { if (e.ctrlKey) { e.preventDefault(); setZoom(S.zoom * (e.deltaY < 0 ? 1.1 : 0.9)); } }, { passive: false });
// pinch zoom (touch)
let pinch = null;
viewer.addEventListener('touchstart', e => {
  if (e.touches.length === 2) {
    const [a, b] = e.touches; const r = viewer.getBoundingClientRect();
    const cx = (a.clientX + b.clientX) / 2 - r.left, cy = (a.clientY + b.clientY) / 2 - r.top;
    const y = viewer.scrollTop + cy; const p = pageAtY(y);
    pinch = { d0: Math.hypot(a.clientX - b.clientX, a.clientY - b.clientY), k: 1, cx, cy, ox: viewer.scrollLeft + cx, oy: y, p, f: (y - S.offsets[p]) / (S.sizes[p][1] * S.scale), fx: (viewer.scrollLeft + cx) / pagesEl.scrollWidth };
  }
}, { passive: true });
viewer.addEventListener('touchmove', e => {
  if (!pinch || e.touches.length !== 2) return;
  e.preventDefault();
  const [a, b] = e.touches;
  pinch.k = Math.min(4 / S.zoom, Math.max(0.4 / S.zoom, Math.hypot(a.clientX - b.clientX, a.clientY - b.clientY) / pinch.d0));
  pagesEl.style.transformOrigin = `${pinch.ox}px ${pinch.oy}px`;
  pagesEl.style.transform = `scale(${pinch.k})`;
}, { passive: false });
viewer.addEventListener('touchend', () => {
  if (!pinch) return;
  const pz = pinch; pinch = null;
  pagesEl.style.transform = '';
  if (Math.abs(pz.k - 1) < 0.03) return;
  S.zoom = Math.min(4, Math.max(0.4, S.zoom * pz.k)); prefs.set('zoom', S.zoom);
  layout({ p: pz.p, f: pz.f });
  viewer.scrollTop = S.offsets[pz.p] + pz.f * S.sizes[pz.p][1] * S.scale - pz.cy;
  viewer.scrollLeft = pz.fx * pagesEl.scrollWidth - pz.cx;
});
let resizeT = 0;
window.addEventListener('resize', () => { clearTimeout(resizeT); resizeT = setTimeout(() => { if (S.pdf) layout(); updateBack(); }, 150); });

/* ================================================================== PANELS */
function selectTab(tab, { open = true } = {}) {
  if (tab === 'figures' && !S.A) tab = 'contents';
  S.tab = tab; prefs.set('tab', tab);
  $$('#tabs .tab, #bottombar button').forEach(b => b.setAttribute('aria-selected', b.dataset.tab === tab));
  $$('.panel').forEach(p => p.hidden = p.id !== 'p-' + tab);
  if (isPhone() && open) openDrawer();
  if (tab === 'contents') requestAnimationFrame(() => scrollPanelTo($('#p-contents .row.current')));
}
$$('#tabs .tab').forEach(b => b.onclick = () => selectTab(b.dataset.tab));
$$('#bottombar button').forEach(b => b.onclick = () => { if (drawerOpen() && S.tab === b.dataset.tab) closeDrawer(true); else selectTab(b.dataset.tab); });
$('#menuNav').onclick = () => drawerOpen() ? closeDrawer(true) : selectTab('contents');
const drawerOpen = () => $('#side').classList.contains('show');
function openDrawer() { if (!drawerOpen()) { $('#side').classList.add('show'); $('#scrim').classList.add('show'); try { history.pushState({ drawer: 1 }, ''); } catch {} } }
function closeDrawer(viaUi) { if (!drawerOpen()) return; $('#side').classList.remove('show'); $('#scrim').classList.remove('show'); if (viaUi) { try { if (history.state?.drawer) history.back(); } catch {} } }
$('#scrim').onclick = () => closeDrawer(true);

/* ---- contents */
function renderContents() {
  const el = $('#p-contents');
  const A = S.A;
  let html = `<div class="panel-head"><input class="filter" id="tocFilter" placeholder="Filter contents — e.g. RCD, switchboard, 2.6" aria-label="Filter contents"></div><div id="tocTree">`;
  if (!A) {
    html += S.outline?.length ? outlineHtml(S.outline) : `<p class="hint">Contents will appear here once the document has been indexed.</p>`;
    el.innerHTML = html + '</div>'; return;
  }
  const entries = S.tocEntries;
  if (!entries.some(e => e.kind !== 'listrow')) html += S.outline?.length ? outlineHtml(S.outline) : `<p class="hint">No contents pages were found in this PDF.</p>`;
  else {
    // nest by level
    const stack = []; let out = '';
    const close = lvl => { while (stack.length && stack[stack.length - 1] >= lvl) { out += '</div></div>'; stack.pop(); } };
    entries.forEach((e, k) => {
      if (e.kind === 'listrow') return;
      if (e.kind === 'label') { close(0); out += `<div class="toc-label">${esc(e.title)}</div>`; return; }
      const lvl = e.level || 0; close(lvl);
      const hasKids = entries[k + 1] && entries[k + 1].kind !== 'label' && (entries[k + 1].level || 0) > lvl;
      const num = e.kind === 'section' ? e.id : e.kind === 'appendix' ? e.id : e.id || '';
      out += `<div class="toc-node toc-l${lvl}" data-k="${k}"><button class="row" data-k="${k}">${num ? `<span class="num">${esc(num)}</span>` : ''}<span class="ttl">${esc(e.title)}${amendChip(e.kind === 'section' ? 'section' : e.kind === 'appendix' ? 'appendix' : 'clause', e.id)}</span><span class="pg">${e.target ? esc(pageLabel(e.target.p)) : esc(e.page)}</span>${hasKids ? `<span class="chev" role="button" aria-label="Expand">${icon('chev')}</span>` : ''}</button><div class="toc-kids">`;
      stack.push(lvl);
    });
    close(0); html += out;
  }
  el.innerHTML = html + '</div>';
  $('#tocFilter').oninput = e => filterToc(e.target.value);
  markCurrentToc(true);
}
function scrollPanelTo(el, center = true) {
  const panel = el?.closest('.panel'); if (!panel) return;
  let y = 0, n = el; while (n && n !== panel) { y += n.offsetTop; n = n.offsetParent; }
  panel.scrollTop = center ? y - panel.clientHeight / 2 + el.offsetHeight / 2 : y - 8;
}
function outlineHtml(items, lvl = 0) {
  S._outlineFlat ||= [];
  return items.map(it => { const k = S._outlineFlat.push(it) - 1; return `<div class="toc-node toc-l${Math.min(lvl, 2)} ${lvl ? '' : ''}"><button class="row" data-o="${k}"><span class="ttl">${esc(it.title)}</span>${it.items?.length ? `<span class="chev">${icon('chev')}</span>` : ''}</button><div class="toc-kids">${it.items?.length ? outlineHtml(it.items, lvl + 1) : ''}</div></div>`; }).join('');
}
$('#p-contents').addEventListener('click', async e => {
  const chev = e.target.closest('.chev');
  const node = e.target.closest('.toc-node');
  if (chev && node) { node.classList.toggle('open'); return; }
  const row = e.target.closest('.row'); if (!row) return;
  if (row.dataset.o) { const it = S._outlineFlat[+row.dataset.o]; const t = it.dest ? await destToTarget(it.dest) : null; if (t) go(t); return; }
  const en = S.tocEntries[+row.dataset.k]; if (en?.target) go(en.target); else toast('Page for this entry not found');
});
function filterToc(q) {
  q = norm1(q.trim());
  const nodes = $$('#tocTree .toc-node');
  if (!q) { nodes.forEach(n => { n.hidden = false; n.classList.remove('open'); }); $$('#tocTree .toc-label').forEach(l => l.hidden = false); markCurrentToc(true); return; }
  $$('#tocTree .toc-label').forEach(l => l.hidden = true);
  nodes.forEach(n => n.hidden = true);
  nodes.forEach(n => {
    const e = S.tocEntries[+n.dataset.k]; if (!e) return;
    if (norm1(`${e.id} ${e.title}`).includes(q)) {
      n.hidden = false; let p = n.parentElement.closest('.toc-node');
      while (p) { p.hidden = false; p.classList.add('open'); p = p.parentElement.closest('.toc-node'); }
    }
  });
}
function markCurrentToc(scroll) {
  if (!S.tocEntries?.length) return;
  const pos = { p: S.current, y: 1e6 };
  let best = -1;
  S.tocEntries.forEach((e, k) => { if (e.target && e.kind !== 'label' && e.kind !== 'listrow' && cmpPos(e.target, pos) <= 0 && (best < 0 || cmpPos(e.target, S.tocEntries[best].target) >= 0)) best = k; });
  $$('#p-contents .row.current').forEach(r => r.classList.remove('current'));
  if (best < 0) return;
  const row = $(`#p-contents .row[data-k="${best}"]`); if (!row) return;
  row.classList.add('current');
  let p = row.parentElement.parentElement.closest('.toc-node');
  while (p) { p.classList.add('open'); p = p.parentElement.closest('.toc-node'); }
  if (scroll && !$('#tocFilter')?.value) scrollPanelTo(row);
}

/* ---- tables & figures */
function catalogue(kind) {
  const A = S.A; const map = kind === 'table' ? A.tables : A.figures; const list = kind === 'table' ? A.tableList : A.figList;
  const seen = new Set(), out = [];
  for (const e of list) { const f = map[e.id]; out.push({ id: e.id, title: e.title || f?.title || '', t: resolveRef(kind, e.id), last: f?.last, first: f?.p }); seen.add(e.id); }
  for (const [id, f] of Object.entries(map)) if (!seen.has(id)) out.push({ id, title: f.title, t: { p: f.p, y: f.y, label: (kind === 'table' ? 'Table ' : 'Figure ') + id }, last: f.last, first: f.p });
  out.sort((a, b) => idSort(a.id, b.id));
  return out;
}
function idSort(a, b) {
  const pa = a.match(/^([A-Z]*)(\d*)(?:\.(\d+))?(.*)$/), pb = b.match(/^([A-Z]*)(\d*)(?:\.(\d+))?(.*)$/);
  return (pa[1] ? 1 : 0) - (pb[1] ? 1 : 0) || pa[1].localeCompare(pb[1]) || (+pa[2] - +pb[2]) || ((+pa[3] || 0) - (+pb[3] || 0)) || pa[4].localeCompare(pb[4]);
}
function groupName(id) {
  const A = S.A; const m = id.match(/^([A-Z]{1,2})/);
  if (m) { const ap = A.appendices[m[1]] || A.toc.find(e => e.kind === 'appendix' && e.id === m[1]); return `Appendix ${m[1]}${ap ? ' — ' + ap.title : ''}`; }
  const s = id.split('.')[0]; const sec = A.sections[s] || A.toc.find(e => e.kind === 'section' && e.id === s);
  return `Section ${s}${sec ? ' — ' + sec.title : ''}`;
}
function renderCatalogue(kind) {
  const el = $(kind === 'table' ? '#p-tables' : '#p-figures');
  if (!S.A) { el.innerHTML = `<p class="hint">${kind === 'table' ? 'Tables' : 'Figures'} will be listed once the document has been indexed.</p>`; return; }
  const items = catalogue(kind); S['cat_' + kind] = items;
  if (kind === 'table') $('#nTables').textContent = items.length || '';
  const fid = kind === 'table' ? 'tblFilter' : 'figFilter';
  el.innerHTML = `<div class="panel-head"><input class="filter" id="${fid}" placeholder="${kind === 'table' ? 'Filter tables — e.g. 8.1, earth, demand, conduit' : 'Filter figures — e.g. zones, bathroom'}" aria-label="Filter"></div><div class="catlist"></div>`;
  const draw = q => {
    q = norm1(q.trim()).replace(/^(table|fig(ure)?)\s*/, '');
    const box = el.querySelector('.catlist');
    const favs = kind === 'table' ? S.user.favTables : [];
    let html = '';
    const rowHtml = it => {
      const span = it.last != null && it.first != null && it.last > it.first ? ` · pp. ${esc(pageLabel(it.first))}–${esc(pageLabel(it.last))}` : '';
      return `<div class="row tbl-row" role="button" tabindex="0" data-id="${esc(it.id)}"><span class="num">${esc(it.id)}</span><span class="ttl">${esc(it.title)}${amendChip(kind, it.id)}<span class="sub">p. ${it.t ? esc(pageLabel(it.t.p)) : '?'}${span}</span></span>${kind === 'table' ? `<button class="star" aria-pressed="${favs.includes(it.id)}" aria-label="Star table ${esc(it.id)}">${icon('star')}</button>` : ''}</div>`;
    };
    const match = it => !q || norm1(it.id + ' ' + it.title).includes(q);
    if (!q && favs.length) {
      const fi = items.filter(it => favs.includes(it.id));
      if (fi.length) html += `<div class="group-h">Starred</div>` + fi.map(rowHtml).join('');
    }
    let g = null, any = 0;
    for (const it of items) {
      if (!match(it)) continue; any++;
      const gn = groupName(it.id); if (gn !== g) { g = gn; html += `<div class="group-h">${esc(gn)}</div>`; }
      html += rowHtml(it);
    }
    if (!any) html += `<p class="hint">${items.length ? 'Nothing matches that filter.' : `No ${kind}s were found in this PDF.`}</p>`;
    box.innerHTML = html;
  };
  draw('');
  $('#' + fid).oninput = e => draw(e.target.value);
  el.onclick = e => {
    const star = e.target.closest('.star');
    const row = e.target.closest('.row'); if (!row) return;
    const id = row.dataset.id;
    if (star) { e.stopPropagation(); const f = S.user.favTables; const k = f.indexOf(id); if (k >= 0) f.splice(k, 1); else f.push(id); saveUser(); draw($('#' + fid).value); renderSaved(); toast(k >= 0 ? `Table ${id} unstarred` : `Table ${id} starred`); return; }
    const it = items.find(x => x.id === id); if (it?.t) go(it.t); else toast('Could not find that ' + kind + ' in the PDF');
  };
  el.onkeydown = e => { if (e.key === 'Enter' && e.target.classList.contains('row')) e.target.click(); };
}

/* ---- index */
function renderIndex() {
  const el = $('#p-index');
  if (!S.A) { el.innerHTML = `<p class="hint">The index will appear once the document has been indexed.</p>`; return; }
  const ix = S.A.index;
  if (!ix.length) { el.innerHTML = `<p class="hint">No back-of-book index was found in this PDF. Use Search instead.</p>`; return; }
  const letters = ix.filter(e => e.letter).map(e => e.letter);
  el.innerHTML = `<div class="panel-head"><input class="filter" id="ixFilter" placeholder="Look up a term — e.g. bathrooms, isolation" aria-label="Filter index"><div class="letters">${letters.map(l => `<button data-l="${l}">${l}</button>`).join('')}</div></div><div id="ixList"></div>`;
  const chips = refs => refs.map(r => { const { t } = refToTarget(r); return `<button class="chip${t ? '' : ' dead'}" data-ref="${esc(r)}">${esc(r)}</button>`; }).join('');
  const draw = q => {
    q = norm1(q.trim());
    let html = '', count = 0;
    for (const e of ix) {
      if (e.letter) { if (!q) html += `<div class="ix-letter" id="ixL-${e.letter}">${e.letter}</div>`; continue; }
      const headHit = !q || norm1(e.head).includes(q);
      const subs = headHit ? e.subs : e.subs.filter(s => norm1(s.text).includes(q));
      if (!headHit && !subs.length) continue;
      if (++count > 600 && q) break;
      html += `<div class="ix-entry"><div class="ix-head">${esc(e.head)} ${chips(e.refs)}</div>${subs.map(s => `<div class="ix-sub">${esc(s.text)} ${chips(s.refs)}</div>`).join('')}</div>`;
    }
    $('#ixList').innerHTML = html || `<p class="hint">No index entries match. Try Search for full-text results.</p>`;
  };
  draw('');
  $('#ixFilter').oninput = e => draw(e.target.value);
  el.onclick = e => {
    const l = e.target.closest('.letters button'); if (l) { $('#ixFilter').value = ''; draw(''); scrollPanelTo($('#ixL-' + l.dataset.l), false); return; }
    const c = e.target.closest('.chip'); if (c) { const { t } = refToTarget(c.dataset.ref); if (t) go(t); else toast(c.dataset.ref + ' was not found'); }
  };
}

/* ---- search */
function parseJump(q) {
  q = q.trim(); let m;
  if ((m = q.match(/^(?:cl(?:ause)?\.?\s*)?(\d{1,2}(?:\.\d{1,3}){1,6})$/i))) return { kind: 'clause', id: m[1] };
  if ((m = q.match(/^t(?:able|bl)?\.?\s*([A-Z]{0,2}\d{1,3}(?:\.\d{1,3})?(?:\s?\([A-Z]\))?)$/i))) return { kind: 'table', id: m[1].toUpperCase().replace(/\s/g, '') };
  if ((m = q.match(/^f(?:ig(?:ure)?)?\.?\s*([A-Z]{0,2}\d{1,3}(?:\.\d{1,3})?(?:\s?\([A-Z]\))?)$/i))) return { kind: 'figure', id: m[1].toUpperCase().replace(/\s/g, '') };
  if ((m = q.match(/^(?:p|pg|page)\.?\s*(\d{1,4})$/i)) || (m = q.match(/^(\d{1,4})$/))) return { kind: 'page', id: m[1] };
  if ((m = q.match(/^s(?:ec(?:tion)?)?\.?\s*(\d{1,2})$/i))) return { kind: 'section', id: m[1] };
  if ((m = q.match(/^app(?:endix)?\.?\s*([A-Z]{1,2})$/i))) return { kind: 'appendix', id: m[1].toUpperCase() };
  if ((m = q.match(/^(?:app(?:endix)?\.?\s*)?([A-Z]{1,2}\d{1,2}(?:\.\d{1,3})*)$/i))) return { kind: 'clause', id: m[1].toUpperCase() };
  return null;
}
function jumpLabel(j, t) {
  const A = S.A;
  if (j.kind === 'clause') { const c = A.clauses[j.id]; return `${/^[A-Z]/.test(j.id) ? 'Appendix clause' : 'Clause'} ${j.id}${c ? ' — ' + c.title : ''}`; }
  if (j.kind === 'table') { const c = catalogue('table').find(x => x.id === j.id); return `Table ${j.id}${c ? ' — ' + c.title : ''}`; }
  if (j.kind === 'figure') { const c = catalogue('figure').find(x => x.id === j.id); return `Figure ${j.id}${c ? ' — ' + c.title : ''}`; }
  if (j.kind === 'page') return `Page ${j.id}`;
  if (j.kind === 'section') return `Section ${j.id}${A.sections[j.id] ? ' — ' + A.sections[j.id].title : ''}`;
  return `Appendix ${j.id}${A.appendices[j.id] ? ' — ' + A.appendices[j.id].title : ''}`;
}
function buildSearchText() {
  S.pageText = []; S.lineStarts = [];
  for (const L of S.A.lines) {
    let s = '', st = [];
    for (const l of L) { st.push(s.length); s += norm1(l.t) + ' '; }
    S.pageText.push(s); S.lineStarts.push(st);
  }
}
const reCache = new Map();
function termRe(t) {
  if (reCache.has(t)) return reCache.get(t);
  const e = t.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const r = /^[a-z]{0,2}\d[\d.]*$/.test(t) ? new RegExp(`(?<![\\w.])${e}(?![\\w]|\\.\\d)`, 'g') : new RegExp(e, 'g');
  reCache.set(t, r); return r;
}
function findAll(txt, t) { const out = []; const r = termRe(t); r.lastIndex = 0; let m; while ((m = r.exec(txt))) { out.push(m.index); if (out.length > 500) break; } return out; }
function parseTerms(q) {
  const out = [];
  for (const m of norm1(q).matchAll(/"([^"]+)"|(\S+)/g)) { const t = clean(m[1] || m[2]); if (t.length >= 1) out.push(t); }
  return out;
}
function runSearch(q) {
  const el = $('#p-search');
  q = q.trim();
  const jumpDef = S.A && parseJump(q);
  const jt = jumpDef && resolveRef(jumpDef.kind, jumpDef.id);
  let html = '';
  if (jt) html += `<button class="jump" id="jumpBtn">${icon('back').replace('icon', 'icon" style="transform:scaleX(-1)')}<span><b>Go to ${esc(jumpLabel(jumpDef, jt))}</b><br><span class="mono" style="font-size:12px;color:var(--ink-3)">p. ${esc(pageLabel(jt.p))} · press Enter</span></span></button>`;
  S._jump = jt;
  if (!q) { S.terms = []; refreshHighlights(); el.innerHTML = `<p class="hint">Type words to search every page. Put a phrase in "quotes". Type a clause number (3.4.2), table (T 8.1, Table C1) or page (p 158) to jump straight there.</p>`; return; }
  if (!S.A) { el.innerHTML = html + `<p class="hint">Search will be ready when indexing finishes.</p>`; return; }
  if (jumpDef && jumpDef.kind !== 'clause') { S.terms = []; refreshHighlights(); el.innerHTML = html || `<p class="hint">${esc(jumpLabel(jumpDef, null))} was not found in this PDF.</p>`; bindJump(); return; }
  const terms = parseTerms(q).filter(t => t.length >= 2 || /\d/.test(t));
  S.terms = terms; refreshHighlights();
  if (!terms.length) { el.innerHTML = html; bindJump(); return; }
  const phrase = norm1(clean(q.replace(/"/g, '')));
  const results = []; let total = 0;
  S.pageText.forEach((txt, p) => {
    const hits = terms.map(t => findAll(txt, t));
    if (hits.some(h => !h.length)) return;
    let pos = terms.length > 1 ? txt.indexOf(phrase) : hits[0][0]; const exact = pos >= 0;
    if (pos < 0) pos = hits[0][0];
    const count = hits.reduce((a, h) => a + h.length, 0);
    total += count;
    results.push({ p, pos, exact, count, aux: S.tocSet.has(p) || S.indexSet.has(p) });
  });
  // body pages before contents/index pages; exact phrase first when several words; then page order
  results.sort((a, b) => (a.aux - b.aux) || (terms.length > 1 ? b.exact - a.exact : 0) || a.p - b.p);
  html += `<div class="sum">${results.length ? `${total} match${total === 1 ? '' : 'es'} on ${results.length} page${results.length === 1 ? '' : 's'}` : 'No matches. Check the spelling or try fewer words.'}</div>`;
  const shown = results.slice(0, 250);
  S._results = shown;
  html += shown.map((r, k) => {
    const li = lineIndexAt(r.p, r.pos); const line = S.A.lines[r.p][li];
    const ctx = r.aux ? { id: '', title: S.tocSet.has(r.p) ? 'Contents pages' : 'Index' } : contextAt(r.p, line?.y);
    return `<button class="res" data-k="${k}"><div class="ctx">${ctx ? `<span class="num">${esc(ctx.id)}</span><span>${esc(ctx.title.slice(0, 70))}</span>` : '<span>Front matter</span>'}<span class="pg">p. ${esc(pageLabel(r.p))}</span></div><div class="snip">${snippet(S.pageText[r.p], r.pos, terms, r.p)}</div>${r.count > 1 ? `<div class="more">${r.count} matches on this page</div>` : ''}</button>`;
  }).join('');
  if (results.length > shown.length) html += `<p class="hint">Showing the first ${shown.length} pages. Add another word to narrow it down.</p>`;
  html += searchAmendments(terms, phrase);
  el.innerHTML = html; bindJump();
}
function bindJump() { const b = $('#jumpBtn'); if (b) b.onclick = () => go(S._jump); }
$('#p-search').addEventListener('click', e => {
  const ar = e.target.closest('.res[data-aid]'); if (ar) { openAmendment(ar.dataset.aid, { p: +ar.dataset.p, y: +ar.dataset.y }); return; }
  const r = e.target.closest('.res'); if (!r) return;
  const res = S._results[+r.dataset.k]; const li = lineIndexAt(res.p, res.pos); const line = S.A.lines[res.p][li];
  go({ p: res.p, y: line ? line.y : 0, h: line?.h, label: 'p. ' + pageLabel(res.p) });
});
function lineIndexAt(p, pos) { const st = S.lineStarts[p]; let lo = 0, hi = st.length - 1; while (lo < hi) { const m = (lo + hi + 1) >> 1; if (st[m] <= pos) lo = m; else hi = m - 1; } return lo; }
function snippet(txt, pos, terms, p) {
  // use original-case text for display
  const orig = S.A.lines[p].map(l => l.t).join(' ') + ' ';
  const a = Math.max(0, pos - 60), b = Math.min(orig.length, pos + 140);
  let s = orig.slice(a, b).replace(/(?:\s?\.){4,}\s?/g, ' … ');
  const low = norm1(s);
  const marks = [];
  for (const t of terms) for (const k of findAll(low, t)) marks.push([k, k + t.length]);
  marks.sort((x, y) => x[0] - y[0]);
  let out = '', last = 0;
  for (const [x, y] of marks) { if (x < last) continue; out += esc(s.slice(last, x)) + '<mark>' + esc(s.slice(x, y)) + '</mark>'; last = y; }
  out += esc(s.slice(last));
  return (a > 0 ? '…' : '') + out + (b < orig.length ? '…' : '');
}
function refreshHighlights() { for (const i of S.rendered) decorateText(i); }
let searchT = 0;
$('#q').addEventListener('input', e => {
  $('#qClear').hidden = !e.target.value;
  clearTimeout(searchT);
  searchT = setTimeout(() => { if (S.tab !== 'search') selectTab('search'); runSearch(e.target.value); }, 180);
});
$('#q').addEventListener('focus', () => { if ($('#q').value && S.tab !== 'search') selectTab('search'); });
$('#searchForm').addEventListener('submit', e => {
  e.preventDefault(); clearTimeout(searchT);
  runSearch($('#q').value);
  if (S._jump) { go(S._jump); $('#q').blur(); }
  else if (S._results?.length) { selectTab('search'); if (isPhone()) $('#q').blur(); }
});
$('#qClear').onclick = () => { $('#q').value = ''; $('#qClear').hidden = true; runSearch(''); $('#q').focus(); };

/* ---- saved: bookmarks, starred tables, recent */
function renderSaved() {
  const el = $('#p-saved');
  if (!S.id) { el.innerHTML = ''; return; }
  const U = S.user;
  let html = `<div class="group-h">Bookmarks</div>`;
  if (!U.bookmarks.length) html += `<p class="hint">Tap the bookmark button in the top bar to save the page you're on.</p>`;
  html += U.bookmarks.slice().sort(cmpPos).map(b => `<div class="bm" data-id="${b.id}"><button class="go"><b>${esc(b.title)}</b><span>p. ${esc(pageLabel(b.p))}</span></button><button class="mini" data-act="edit" aria-label="Rename">${icon('edit')}</button><button class="mini" data-act="del" aria-label="Delete bookmark">${icon('trash')}</button></div>`).join('');
  if (S.A) {
    const favs = U.favTables.map(id => ({ id, t: resolveRef('table', id), title: (S.cat_table || []).find(x => x.id === id)?.title || '' }));
    html += `<div class="group-h">Starred tables</div>`;
    html += favs.length ? favs.map(f => `<button class="row" data-table="${esc(f.id)}"><span class="num">${esc(f.id)}</span><span class="ttl">${esc(f.title)}</span><span class="pg">${f.t ? esc(pageLabel(f.t.p)) : ''}</span></button>`).join('') : `<p class="hint">Star tables in the Tables list to keep them here.</p>`;
  }
  if (U.recent.length) {
    html += `<div class="group-h">Recently opened references</div>`;
    html += U.recent.map((r, k) => `<button class="row" data-recent="${k}"><span class="ttl">${esc(r.label)}</span><span class="pg">${esc(pageLabel(r.p))}</span></button>`).join('');
  }
  html += `<div class="group-h">Move to another device</div><div class="btnrow"><button class="btn" id="expBtn">Copy bookmarks</button><button class="btn" id="impBtn">Paste bookmarks</button></div><div class="btnrow" id="impBox" hidden><textarea id="impTxt" rows="4" style="width:100%;border-radius:9px;border:1px solid var(--rule);background:var(--surface-2);padding:8px;font:12px var(--f-mono)" placeholder="Paste copied bookmarks here"></textarea><button class="btn primary" id="impGo">Add bookmarks</button></div>`;
  el.innerHTML = html;
}
$('#p-saved').addEventListener('click', async e => {
  const U = S.user;
  const bm = e.target.closest('.bm');
  if (bm) {
    const b = U.bookmarks.find(x => x.id === bm.dataset.id); if (!b) return;
    const act = e.target.closest('[data-act]')?.dataset.act;
    if (act === 'del') { U.bookmarks = U.bookmarks.filter(x => x !== b); saveUser(); renderSaved(); onPageChange(); toast('Bookmark removed'); return; }
    if (act === 'edit') {
      bm.innerHTML = `<input id="bmEdit" value="${esc(b.title)}" aria-label="Bookmark name"><button class="mini" data-act="ok" aria-label="Save">✓</button>`;
      const inp = $('#bmEdit'); inp.focus(); inp.select();
      const done = () => { b.title = clean(inp.value) || b.title; saveUser(); renderSaved(); };
      inp.onkeydown = ev => { if (ev.key === 'Enter') done(); if (ev.key === 'Escape') renderSaved(); };
      bm.querySelector('[data-act="ok"]').onclick = done; return;
    }
    if (e.target.closest('.go')) go({ p: b.p, y: b.y, label: b.title });
    return;
  }
  const tr = e.target.closest('[data-table]'); if (tr) { go(resolveRef('table', tr.dataset.table)); return; }
  const rr = e.target.closest('[data-recent]'); if (rr) { go(U.recent[+rr.dataset.recent], { record: true }); return; }
  if (e.target.id === 'expBtn') {
    const data = JSON.stringify({ app: 'wiring-rules-reader', bookmarks: U.bookmarks, favTables: U.favTables });
    try { await navigator.clipboard.writeText(data); toast('Bookmarks copied — paste them into the app on your other device'); }
    catch { $('#impBox').hidden = false; $('#impTxt').value = data; $('#impTxt').select(); toast('Select and copy the text shown'); }
  }
  if (e.target.id === 'impBtn') { $('#impBox').hidden = false; $('#impTxt').value = ''; $('#impTxt').focus(); }
  if (e.target.id === 'impGo') {
    try {
      const d = JSON.parse($('#impTxt').value);
      let added = 0;
      for (const b of d.bookmarks || []) if (!U.bookmarks.some(x => x.p === b.p && x.title === b.title)) { U.bookmarks.push({ ...b, id: b.id || crypto.randomUUID?.() || String(Math.random()) }); added++; }
      for (const t of d.favTables || []) if (!U.favTables.includes(t)) U.favTables.push(t);
      saveUser(); renderSaved(); renderCatalogue('table'); onPageChange(); toast(`${added} bookmark${added === 1 ? '' : 's'} added`);
    } catch { toast('That text is not a bookmark export'); }
  }
});
function toggleBookmark() {
  if (!S.id) return;
  const p = S.current; const U = S.user;
  const ex = U.bookmarks.find(b => b.p === p);
  if (ex) { U.bookmarks = U.bookmarks.filter(b => b !== ex); toast('Bookmark removed'); }
  else {
    const a = currentAnchor();
    const y = a && a.p === p ? Math.max(0, a.f * S.sizes[p][1]) : 0;
    const ctx = contextAt(p);
    const tb = S.A && Object.entries(S.A.tables).find(([, t]) => t.p <= p && (t.last ?? t.p) >= p);
    const title = tb ? `Table ${tb[0]} ${tb[1].title}` : ctx ? `${ctx.id} ${ctx.title}` : `Page ${pageLabel(p)}`;
    U.bookmarks.push({ id: crypto.randomUUID?.() || String(Date.now()), p, y, title, created: Date.now() });
    toast('Bookmarked: ' + title.slice(0, 60));
  }
  saveUser(); onPageChange(); renderSaved();
}
$('#bmBtn').onclick = toggleBookmark;
function addRecent(t) {
  if (!t?.label || /^p\. /.test(t.label)) return;
  const R = S.user.recent.filter(r => r.label !== t.label);
  R.unshift({ p: t.p, y: t.y, label: t.label + (S.A?.clauses?.[t.label.replace(/^(Clause|App) /, '')]?.title ? ' — ' + S.A.clauses[t.label.replace(/^(Clause|App) /, '')].title : '') });
  S.user.recent = R.slice(0, 12); saveUser();
  if (S.tab === 'saved') renderSaved();
}
let saveT = 0;
function saveUser() { clearTimeout(saveT); saveT = setTimeout(() => db.put('user', S.id, S.user), 300); }

/* ================================================================== MENU */
$('#moreBtn').onclick = e => { e.stopPropagation(); const m = $('#menu'); m.hidden = !m.hidden; syncMenu(); };
document.addEventListener('click', e => { if (!$('#menu').hidden && !e.target.closest('#menu')) $('#menu').hidden = true; });
function syncMenu() {
  const th = prefs.get('theme', 'auto');
  $$('[data-theme-set]').forEach(b => b.setAttribute('aria-pressed', b.dataset.themeSet === th));
  $('#dimState').textContent = prefs.get('dim', false) ? 'on' : 'off';
}
function applyTheme() {
  const th = prefs.get('theme', 'auto'); const r = document.documentElement;
  if (th === 'auto') r.removeAttribute('data-theme'); else r.setAttribute('data-theme', th);
  r.classList.toggle('dim-pages', !!prefs.get('dim', false));
}
$$('[data-theme-set]').forEach(b => b.onclick = () => { prefs.set('theme', b.dataset.themeSet); applyTheme(); syncMenu(); });
$('#mDim').onclick = () => { prefs.set('dim', !prefs.get('dim', false)); applyTheme(); syncMenu(); };
$('#mFit').onclick = () => { setZoom(1); $('#menu').hidden = true; };
$('#mFigures').onclick = () => { $('#menu').hidden = true; selectTab('figures'); };
$('#mOpen').onclick = () => { $('#menu').hidden = true; $('#fileIn').click(); };
$('#mAmend').onclick = () => { $('#menu').hidden = true; if (S.pdf) $('#amendIn').click(); };
$('#amendIn').onchange = e => { const f = e.target.files[0]; if (f) addAmendment(f); e.target.value = ''; };
$('#mLibrary').onclick = () => { $('#menu').hidden = true; showWelcome(); };
$('#mReindex').onclick = async () => { $('#menu').hidden = true; if (!S.pdf) return; await db.del('analysis', S.id); S.A = null; startAnalysis(); };
$('#backBtn').onclick = () => { try { if (history.state?.wrr) { history.back(); return; } } catch {} goBack(); };
$('#pageChip').onclick = () => { $('#q').value = 'p '; $('#q').focus(); };
document.addEventListener('keydown', e => {
  const typing = /INPUT|TEXTAREA/.test(document.activeElement?.tagName);
  if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'f') { e.preventDefault(); $('#q').focus(); $('#q').select(); return; }
  if (typing) { if (e.key === 'Escape') document.activeElement.blur(); return; }
  if (e.key === '/') { e.preventDefault(); $('#q').focus(); }
  else if (e.key.toLowerCase() === 'b' && !e.ctrlKey) toggleBookmark();
  else if (e.key === 'Backspace' || (e.altKey && e.key === 'ArrowLeft')) { if (S.backStack.length) { e.preventDefault(); goBack(); } }
  else if (e.key === '+' || e.key === '=') setZoom(ZSTEPS.find(z => z > S.zoom + 0.01) || 4);
  else if (e.key === '-') setZoom([...ZSTEPS].reverse().find(z => z < S.zoom - 0.01) || 0.4);
  else if (e.key === 'PageDown' || e.key === 'ArrowRight' && !e.altKey) { if (e.key === 'ArrowRight') { e.preventDefault(); viewer.scrollTop = S.offsets[Math.min(S.current + 1, S.offsets.length - 1)] - 6; } }
  else if (e.key === 'ArrowLeft') { e.preventDefault(); viewer.scrollTop = S.offsets[Math.max(S.current - 1, 0)] - 6; }
});


/* ================================================================== AMENDMENT PDFs
   Extra PDFs (Amendment No. 4, rulings…) attached to the main document. They are
   stored on the device with the main PDF, searched with it, and every clause, table or
   figure they mention gets a marker in Contents, Tables and on the page.            */
const mainId = () => S.parent || S.id;
async function loadAmendments() {
  S.amends = [];
  const pid = mainId(); if (!pid) return;
  const U = S.parent ? (await db.get('user', pid)) || {} : S.user;
  for (const aid of U.amendments || []) {
    const [rec, A] = await Promise.all([db.get('files', aid), db.get('analysis', aid)]);
    if (!rec || !A) continue;
    const pageText = A.lines.map(L => L.map(l => norm1(l.t)).join(' ') + ' ');
    const lineStarts = A.lines.map(L => { let n = 0; return L.map(l => { const s = n; n += norm1(l.t).length + 1; return s; }); });
    S.amends.push({ id: aid, name: rec.name, label: rec.label || rec.name.replace(/\.pdf$/i, ''), short: rec.short || 'Amd', added: rec.added, A, pageText, lineStarts, refs: amendRefs(A) });
  }
  S.amendIdx = new Map();
  for (const am of S.amends) for (const [key, pos] of am.refs) { if (!S.amendIdx.has(key)) S.amendIdx.set(key, []); S.amendIdx.get(key).push({ aid: am.id, label: am.label, short: am.short, ...pos }); }
}
function amendRefs(A) {
  const refs = new Map();
  const add = (kind, id, p, y) => { const k = kind + ':' + id; if (!refs.has(k)) refs.set(k, { p, y }); };
  const rx = /\b(Clauses?|Sections?|Appendix|Appendices|App\.?|Tables?|Figures?|Figs?\.)\s+((?:[A-Z]{1,2}\d{0,3}(?:\.\d{1,3})*|\d{1,3}(?:\.\d{1,3})*)(?:\([A-Za-z0-9]{1,2}\))?(?:(?:\s*,\s*|\s+(?:and|or|to)\s+)(?:[A-Z]{1,2}\d{0,3}(?:\.\d{1,3})*|\d{1,3}(?:\.\d{1,3})*)(?:\([A-Za-z0-9]{1,2}\))?)*)/g;
  A.lines.forEach((L, p) => L.forEach(l => {
    for (const m of l.t.matchAll(rx)) {
      const kw = m[1].toLowerCase();
      const kind = kw.startsWith('tab') ? 'table' : kw.startsWith('fig') ? 'figure' : kw.startsWith('sec') ? 'section' : kw.startsWith('app') ? 'appendix' : 'clause';
      for (const idm of m[2].matchAll(/[A-Z]{1,2}\d{0,3}(?:\.\d{1,3})*(?:\([A-Za-z0-9]{1,2}\))?|\d{1,3}(?:\.\d{1,3})*/g)) {
        let id = idm[0], k = kind;
        if (k === 'appendix' && !/^[A-Z]{1,2}$/.test(id)) k = 'clause';
        if (k === 'clause') id = id.replace(/\([a-z0-9]{1,2}\)$/i, '');
        add(k, id, p, l.y);
      }
    }
    // amendment documents often list the clause number alone at the start of a line
    const m = l.t.match(/^((?:[A-Z])?\d{1,2}(?:\.\d{1,3}){1,6})\s+\S/);
    if (m) add('clause', m[1], p, l.y);
  }));
  return refs;
}
function amendHits(kind, id) {
  if (!S.amendIdx?.size || !id) return [];
  id = String(id);
  const out = [];
  for (const [key, list] of S.amendIdx) {
    const [k, rid] = key.split(':');
    const same = k === kind && rid === id;
    const within = kind === 'clause' && k === 'clause' && (id.startsWith(rid + '.') || rid.startsWith(id + '.'));
    const secApp = (kind === 'section' && k === 'clause' && rid.split('.')[0] === id) || (kind === 'appendix' && (rid === id || rid.startsWith(id)));
    if (same || within || secApp) out.push(...list.map(x => ({ ...x, ref: rid, kind: k })));
  }
  return out;
}
function amendChip(kind, id) {
  if (S.parent) return '';
  const hits = amendHits(kind, id); if (!hits.length) return '';
  const names = [...new Set(hits.map(h => h.short))];
  return ` <span class="amd-chip" title="Mentioned in ${esc([...new Set(hits.map(h => h.label))].join(', '))}">${esc(names.join(' '))}</span>`;
}
function updateNotice() {
  const n = $('#notice'); if (!n) return;
  document.body.classList.toggle('sub-doc', !!S.parent);
  if (S.parent) {
    n.hidden = false;
    n.innerHTML = `<span class="tag amd">Amendment PDF</span><span class="nt">${esc(S.name)}</span><button class="btn" id="ntBack">← Back to the Standard</button>`;
    $('#ntBack').onclick = backToMain; return;
  }
  const p = S.current;
  if (!S.A || !S.amendIdx?.size || p < 0) { n.hidden = true; return; }
  const ids = new Set(S.A.heads[p].map(h => h.id));
  const ctx = contextAt(p); if (ctx) ids.add(ctx.id);
  let hit = null, onId = '';
  for (const id of ids) {
    const kind = /^Section /.test(id) ? 'section' : /^Appendix /.test(id) ? 'appendix' : 'clause';
    const clean = id.replace(/^(Section|Appendix) /, '');
    const hs = amendHits(kind, clean).filter(h => kind !== 'section' || h.ref.split('.').length <= 2);
    const exact = hs.find(h => h.ref === clean || clean.startsWith(h.ref + '.'));
    if (exact) { hit = exact; onId = clean; break; }
  }
  if (!hit) for (const [tid, t] of Object.entries(S.A.tables)) if (t.p <= p && (t.last ?? t.p) >= p) { const hs = amendHits('table', tid); if (hs.length) { hit = hs[0]; onId = 'Table ' + tid; break; } }
  if (!hit) { n.hidden = true; return; }
  n.hidden = false;
  const what = hit.kind === 'table' ? 'Table ' + hit.ref : hit.kind === 'figure' ? 'Figure ' + hit.ref : (/^[A-Z]/.test(hit.ref) ? 'App ' : 'Clause ') + hit.ref;
  const key = hit.aid + what;
  if (S._ntDismissed === key) { n.hidden = true; return; }
  n.innerHTML = `<span class="tag amd">${esc(hit.short)}</span><span class="nt"><b>${esc(what)}</b> is mentioned in ${esc(hit.label)}</span><button class="btn" id="ntView">View change</button><button class="mini" id="ntX" aria-label="Hide this notice">${icon('x')}</button>`;
  $('#ntX').onclick = () => { S._ntDismissed = key; n.hidden = true; };
  $('#ntView').onclick = () => openAmendment(hit.aid, { p: hit.p, y: hit.y, label: hit.label });
}
async function openAmendment(aid, goto) {
  const rec = await db.get('files', aid); if (!rec) { toast('That amendment PDF is no longer on this device'); return; }
  const am = S.amends.find(a => a.id === aid);
  closeDrawer(true);
  await openBlob(rec.blob, rec.name, false, { parent: mainId(), goto, label: am?.label || rec.label });
}
async function backToMain() {
  const pid = S.parent; const rec = pid && await db.get('files', pid);
  if (rec) await openBlob(rec.blob, rec.name, false);
}
async function addAmendment(file) {
  const pid = mainId(); if (!pid) return;
  selectTab('changes');
  const box = $('#amdStatus'); const say = t => { if (box) box.textContent = t; };
  say('Reading ' + file.name + '…');
  let pdf;
  try { pdf = await pdfjsLib.getDocument({ data: new Uint8Array(await file.arrayBuffer()), standardFontDataUrl: STD_FONTS, isEvalSupported: false }).promise; }
  catch { say(''); toast('That file could not be opened as a PDF'); return; }
  const aid = pdf.fingerprints[0] + ':' + pdf.numPages;
  if (aid === pid) { say(''); pdf.destroy(); toast('That is the Standard itself, not an amendment'); return; }
  const savedApx = S._apx;
  const A = await analyse(pdf, f => say(`Indexing ${file.name}… ${Math.round(f * 100)}%`));
  S._apx = savedApx;
  const first = (A.lines[0] || []).concat(A.lines[1] || []).map(l => l.t).join(' ');
  let label = file.name.replace(/\.pdf$/i, ''), short = 'Amd';
  let m;
  if ((m = first.match(/Amendment\s+No\.?\s*(\d+)/i))) { label = 'Amendment No. ' + m[1]; short = 'A' + m[1]; }
  else if ((m = first.match(/Ruling\s*(?:No\.?\s*)?(\d+)/i))) { label = 'Ruling ' + m[1]; short = 'R' + m[1]; }
  else if ((m = first.match(/Corrigendum\s*(?:No\.?\s*)?(\d*)/i))) { label = 'Corrigendum ' + (m[1] || ''); short = 'C' + (m[1] || ''); }
  const dm = first.match(/\b(January|February|March|April|May|June|July|August|September|October|November|December)\s+(20\d\d)\b/);
  if (dm) label += ` (${dm[1].slice(0, 3)} ${dm[2]})`;
  pdf.destroy();
  await db.put('analysis', aid, A);
  await db.put('files', aid, { name: file.name, size: file.size, blob: new Blob([file], { type: 'application/pdf' }), added: Date.now(), parent: pid, label, short });
  const U = S.parent ? Object.assign({ bookmarks: [], favTables: [], recent: [], amendments: [] }, await db.get('user', pid) || {}) : S.user;
  U.amendments ||= [];
  if (!U.amendments.includes(aid)) U.amendments.push(aid);
  if (S.parent) await db.put('user', pid, U); else saveUser();
  await loadAmendments();
  say('');
  const am = S.amends.find(a => a.id === aid);
  toast(`${label} added — it mentions ${am ? am.refs.size : 0} clauses, tables or figures`, 3500);
  renderAllPanels(); onPageChange();
}
async function removeAmendment(aid) {
  const pid = mainId();
  const U = S.parent ? Object.assign({}, await db.get('user', pid) || {}) : S.user;
  U.amendments = (U.amendments || []).filter(x => x !== aid);
  if (S.parent) await db.put('user', pid, U); else saveUser();
  await db.del('files', aid); await db.del('analysis', aid); await db.del('user', aid);
  if (S.id === aid) { await backToMain(); return; }
  await loadAmendments(); renderAllPanels(); onPageChange();
}
function searchAmendments(terms, phrase) {
  if (!S.amends?.length || !terms.length) return '';
  let html = '', n = 0;
  for (const am of S.amends) {
    if (am.id === S.id) continue;
    am.pageText.forEach((txt, p) => {
      const hits = terms.map(t => findAll(txt, t)); if (hits.some(h => !h.length) || n > 60) return;
      n++;
      const pos = hits[0][0];
      const st = am.lineStarts[p]; let li = 0; while (li + 1 < st.length && st[li + 1] <= pos) li++;
      const line = am.A.lines[p][li];
      const orig = am.A.lines[p].map(l => l.t).join(' ') + ' ';
      const a = Math.max(0, pos - 60), s = orig.slice(a, pos + 140);
      const low = norm1(s); const marks = [];
      for (const t of terms) for (const k of findAll(low, t)) marks.push([k, k + t.length]);
      marks.sort((x, y) => x[0] - y[0]);
      let out = '', last = 0; for (const [x, y] of marks) { if (x < last) continue; out += esc(s.slice(last, x)) + '<mark>' + esc(s.slice(x, y)) + '</mark>'; last = y; }
      out += esc(s.slice(last));
      html += `<button class="res" data-aid="${esc(am.id)}" data-p="${p}" data-y="${line ? line.y : 0}"><div class="ctx"><span class="tag amd">${esc(am.short)}</span><span>${esc(am.label)}</span><span class="pg">p. ${p + 1}</span></div><div class="snip">${a > 0 ? '…' : ''}${out}…</div></button>`;
    });
  }
  return html ? `<div class="group-h">In your amendment PDFs</div>${html}` : '';
}

/* ================================================================== CHANGES (NZ quick reference) */
let chFilter = prefs.get('chFilter', 'all');
function daysUntil(iso) { const d = new Date(iso + 'T00:00:00+13:00'); return Math.ceil((d - Date.now()) / 86400000); }
function refChips(refs) {
  return refs.map(r => { const t = S.A && !S.parent ? refToTarget(r).t : null; return `<button class="chip${t ? '' : ' dead'}" data-ref="${esc(r)}">${esc(r.replace(/^Clause /, ''))}</button>`; }).join('');
}
const TAGS = { nz: 'NZ only', regs: 'NZ regs 2025', new: 'New', amd: 'Amended' };
function nzOnlyClauses() {
  const A = S.A; if (!A || S.parent) return [];
  const seen = new Map();
  A.lines.forEach((L, p) => {
    if (S.tocSet.has(p) || S.indexSet.has(p)) return;
    for (const l of L) if (/New Zealand only|NZ only|\bIn New Zealand\b|\(NZ ONLY\)/i.test(l.t)) {
      const c = contextAt(p, l.y); if (c && !seen.has(c.id)) seen.set(c.id, { id: c.id, title: c.title, p: c.q, y: c.y });
    }
  });
  return [...seen.values()].sort(cmpPos);
}
function renderChanges() {
  const el = $('#p-changes'); if (!el) return;
  let html = '';
  if (S.parent) {
    html += `<div class="ch-intro"><h2>Amendment PDF</h2><p>You're viewing <b>${esc(S.name)}</b>. Go back to the Standard to see the quick reference.</p><div class="btnrow" style="padding:0"><button class="btn primary" id="chBack">← Back to the Standard</button></div></div>`;
    el.innerHTML = html; $('#chBack').onclick = backToMain; return;
  }
  const dl = daysUntil(NZ_DATES.mandatory);
  html += `<div class="ch-intro"><h2>2007 → 2018: what changed</h2><p>A New Zealand quick reference. Tap a clause number to open it. This is a summary written for this app, not the Standard's wording, so always read the clause itself.</p></div>`;
  html += `<div class="countdown"><div class="cd-num">${dl > 0 ? dl : '✓'}</div><div><b>${dl > 0 ? `day${dl === 1 ? '' : 's'} until the 2018 edition is mandatory for new work` : 'The 2018 edition is mandatory for new work'}</b><span>${dl > 0 ? 'From 13 November 2026 under the Electricity (Safety) Regulations. You can use it now.' : 'Since 13 November 2026. Work started under the 2007 edition in the transition year had to be finished by 12 November 2026.'}</span></div></div>`;
  html += `<details class="ch-sec"${prefs.get('chOpenTimeline', false) ? ' open' : ''} data-pref="chOpenTimeline"><summary>NZ transition rules</summary>${TIMELINE.map(t => `<div class="tl"><span>${esc(t.when)}</span><p>${esc(t.what)}</p></div>`).join('')}</details>`;
  // pinned highlights
  html += HIGHLIGHTS.map(h => `<div class="ch-alert"><div class="ch-alert-top">${icon('delta')}<span>Check on site</span></div><h3>${esc(h.head)}</h3><p>${esc(h.text)}</p><ul>${h.bullets.map(b => `<li>${esc(b)}</li>`).join('')}</ul><div>${refChips(h.refs)}</div>${h.source ? `<p class="fine">Source: <a href="${esc(h.source.url)}" target="_blank" rel="noopener">${esc(h.source.label)}</a>, checked against the clauses in the Standard.</p>` : ''}</div>`).join('');
  // amendment PDFs
  html += `<div class="group-h">Your amendment PDFs</div>`;
  if (S.amends?.length) html += S.amends.map(a => `<div class="amd-item"><span class="tag amd">${esc(a.short)}</span><button class="go" data-open="${esc(a.id)}"><b>${esc(a.label)}</b><span>${a.A.n} page${a.A.n > 1 ? 's' : ''} · mentions ${a.refs.size} clause${a.refs.size === 1 ? '' : 's'}, tables or figures</span></button><button class="mini" data-rm="${esc(a.id)}" aria-label="Remove ${esc(a.label)}">${icon('trash')}</button></div>`).join('');
  else html += `<p class="hint">When a new amendment, ruling or corrigendum comes out, add its PDF here. The clauses it mentions get a marker in Contents and Tables, a notice appears on those pages, and search covers it too.</p>`;
  html += `<div class="btnrow"><button class="btn" id="amdAdd">${icon('plus')}Add amendment PDF</button><span class="fine" id="amdStatus" aria-live="polite"></span></div>`;
  // filter
  html += `<div class="group-h">Biggest changes</div><div class="seg-f" role="group" aria-label="Filter changes">${[['all', 'All'], ['nz', 'NZ only'], ['regs', 'NZ regs 2025'], ['new', 'New in 2018']].map(([k, l]) => `<button data-f="${k}" aria-pressed="${chFilter === k}">${l}</button>`).join('')}</div>`;
  const show = it => chFilter === 'all' || it.tags.includes(chFilter);
  if (chFilter === 'all' || chFilter === 'regs') {
    html += `<details class="ch-sec regs"${chFilter === 'regs' || prefs.get('chOpenRegs', true) ? ' open' : ''} data-pref="chOpenRegs"><summary>Changed by the NZ regulations <span class="tag regs">2025</span></summary><p class="fine" style="padding:0 16px 6px">The Electricity (Safety) Amendment Regulations 2025 cite the 2018 edition with these NZ modifications. Your PDF does not include them.</p>${REGS_MODS.map(m => `<div class="ch-item"><p>${esc(m.text)}</p><div>${refChips(m.refs)}</div></div>`).join('')}</details>`;
  }
  for (const t of TOPICS) {
    const items = t.items.filter(show); if (!items.length) continue;
    html += `<details class="ch-sec" open><summary>${esc(t.title)} <span class="count">${items.length}</span></summary>${items.map(it => `<div class="ch-item"><div class="ch-h"><b>${esc(it.head)}</b>${it.tags.map(g => `<span class="tag ${g}">${TAGS[g]}</span>`).join('')}</div><p>${esc(it.text)}</p><div>${refChips(it.refs)}</div></div>`).join('')}</details>`;
  }
  // NZ-only clauses found in the user's PDF
  const nz = nzOnlyClauses();
  if (nz.length && (chFilter === 'all' || chFilter === 'nz')) html += `<details class="ch-sec"><summary>Every NZ-only clause in your copy <span class="count">${nz.length}</span></summary><p class="fine" style="padding:0 16px 6px">Found automatically: clauses marked "New Zealand only" or with text that applies "In New Zealand".</p>${nz.map((c, k) => `<button class="row" data-nz="${k}"><span class="num">${esc(c.id.replace(/^(Section|Appendix) /, ''))}</span><span class="ttl">${esc(c.title)}</span><span class="pg">${esc(pageLabel(c.p))}</span></button>`).join('')}</details>`;
  S._nz = nz;
  if (chFilter === 'all' || chFilter === 'amd') html += `<details class="ch-sec"><summary>Amendments already in this edition</summary>${BUILT_IN_AMENDMENTS.map(a => `<div class="ch-item"><div class="ch-h"><b>${esc(a.name)}</b><span class="tag amd">${esc(a.date)}</span></div><p>${esc(a.text)}</p><div>${refChips(a.refs)}</div></div>`).join('')}</details>`;
  html += `<p class="fine" style="padding:14px 16px">Sources: the Standard's preface ("Changes in this edition") and amendment control sheet, <a href="https://www.legislation.govt.nz/regulation/public/2025/0225/latest/whole.html" target="_blank" rel="noopener">Electricity (Safety) Amendment Regulations 2025</a> and <a href="https://www.worksafe.govt.nz/about-us/news-and-media/important-update-changes-to-electricity-safety-regulations-for-electrical-installations/" target="_blank" rel="noopener">WorkSafe guidance</a>. Checked September 2026.</p>`;
  el.innerHTML = html;
}
$('#p-changes').addEventListener('click', e => {
  const t = e.target;
  const chip = t.closest('.chip'); if (chip) { const r = refToTarget(chip.dataset.ref); if (r.t) go(r.t); else toast(S.A ? chip.dataset.ref + ' was not found in this PDF' : 'Clause links work once the document has been indexed'); return; }
  const f = t.closest('[data-f]'); if (f) { chFilter = f.dataset.f; prefs.set('chFilter', chFilter); renderChanges(); return; }
  if (t.closest('#amdAdd')) { $('#amendIn').click(); return; }
  const o = t.closest('[data-open]'); if (o) { openAmendment(o.dataset.open, null); return; }
  const rm = t.closest('[data-rm]');
  if (rm) { if (rm.dataset.confirm !== '1') { rm.dataset.confirm = '1'; rm.classList.add('armed'); rm.title = 'Tap again to remove'; toast('Tap the bin again to remove this PDF'); return; } removeAmendment(rm.dataset.rm); return; }
  const nz = t.closest('[data-nz]'); if (nz) { const c = S._nz[+nz.dataset.nz]; go({ p: c.p, y: c.y, label: c.id }); }
});
$('#p-changes').addEventListener('toggle', e => { const d = e.target; if (d.dataset?.pref) prefs.set(d.dataset.pref, d.open); }, true);


/* ================================================================== Zs CHECK (Table 8.1)
   MCB limits are calculated, not copied: Zs = 230 V ÷ mean instantaneous tripping current
   (Type B 4×In, C 7.5×In, D 12.5×In), rounded to 0.1 Ω. This matches every MCB value in
   Table 8.1 of AS/NZS 3000:2018 (Amendment 3).                                           */
const ZS_K = { B: 4, C: 7.5, D: 12.5 };
const ZS_RATINGS = [6, 10, 16, 20, 25, 32, 40, 50, 63, 80, 100, 125, 160, 200];
const zsMax = (t, In) => Math.floor(230 / (ZS_K[t] * In) * 10 + 0.5 + 1e-9) / 10;
const zs = { t: prefs.get('zsType', 'C'), In: prefs.get('zsIn', 20), log: prefs.get('zsLog', []) };
const fmtO = v => (Math.round(v * 100) / 100).toString();
function renderZs() {
  const el = $('#p-zs');
  el.innerHTML = `<div class="zs">
    <div class="zs-head"><div class="eyebrow">Table 8.1 · 230 V · 0.4 s</div><h2>Earth fault-loop check</h2><p>Pick the MCB, type your measured Zs, and see straight away if it's within the maximum.</p></div>
    <div><div class="zs-lbl">MCB type</div><div class="zs-types" id="zsTypes">${Object.entries(ZS_K).map(([t, k]) => `<button data-t="${t}" aria-pressed="${zs.t === t}"><b>Type ${t}</b><span>${k}× In</span></button>`).join('')}</div></div>
    <div><div class="zs-lbl"><span>Rating (A)</span></div><div class="zs-amps" id="zsAmps">${ZS_RATINGS.map(a => `<button data-a="${a}" aria-pressed="${zs.In === a}">${a}</button>`).join('')}</div></div>
    <div><div class="zs-lbl"><span>Your reading</span></div><div class="zs-read">
      <div class="zs-inwrap"><input id="zsIn" type="text" inputmode="decimal" autocomplete="off" placeholder="0.00" aria-label="Measured earth fault-loop impedance in ohms"><span class="unit">Ω</span></div>
      <div class="zs-max"><span id="zsMaxLbl">Max ${zs.t}${zs.In}</span><b id="zsMax">${zsMax(zs.t, zs.In)} Ω</b></div>
    </div></div>
    <div class="zs-result" id="zsResult" aria-live="polite"></div>
    <div class="zs-actions"><input id="zsCct" placeholder="Circuit name (optional), e.g. Kitchen sockets" aria-label="Circuit name"><button class="btn primary" id="zsAdd">Add to log</button></div>
    <div id="zsLog" class="zs-log"></div>
    <div><div class="zs-lbl"><span>Maximum Zs (Ω), tap a cell to select</span></div><table class="zs-grid" id="zsGrid"><thead><tr><th>Amps</th><th>Type B</th><th>Type C</th><th>Type D</th></tr></thead><tbody>${ZS_RATINGS.map(a => `<tr data-row="${a}"><td>${a} A</td>${['B', 'C', 'D'].map(t => `<td data-t="${t}" data-a="${a}">${zsMax(t, a).toFixed(1)}</td>`).join('')}</tr>`).join('')}</tbody></table></div>
    <p class="zs-note">Values are for MCBs on the final subcircuit, calculated the same way as Table 8.1: 230 V ÷ the mean instantaneous tripping current. They match the table in AS/NZS 3000:2018. A reading equal to the maximum passes. For fuses, EFL tester tolerances (AS/NZS 3017) and the test method, see <button id="zsOpenTbl">Table 8.1</button> and <button id="zsOpenCl">Clause 8.3.9</button> in your PDF.</p>
  </div>`;
  const inp = $('#zsIn');
  inp.value = prefs.get('zsReading', '');
  inp.addEventListener('input', () => { prefs.set('zsReading', inp.value); updateZs(); });
  inp.addEventListener('keydown', e => { if (e.key === 'Enter') { e.preventDefault(); $('#zsAdd').click(); } });
  updateZs(); drawZsLog();
}
function zsReading() { const v = parseFloat(($('#zsIn')?.value || '').replace(',', '.').replace(/[^\d.]/g, '')); return Number.isFinite(v) ? v : null; }
function updateZs() {
  const max = zsMax(zs.t, zs.In);
  $('#zsMax').textContent = max.toFixed(1) + ' Ω'; $('#zsMaxLbl').textContent = `Max ${zs.t}${zs.In}`;
  $$('#zsTypes button').forEach(b => b.setAttribute('aria-pressed', b.dataset.t === zs.t));
  $$('#zsAmps button').forEach(b => b.setAttribute('aria-pressed', +b.dataset.a === zs.In));
  $$('#zsGrid td.sel, #zsGrid tr.sel').forEach(x => x.classList.remove('sel'));
  const row = $(`#zsGrid tr[data-row="${zs.In}"]`); row?.classList.add('sel'); row?.querySelector(`td[data-t="${zs.t}"]`)?.classList.add('sel');
  const r = zsReading(); const box = $('#zsResult');
  box.className = 'zs-result';
  if (r == null) { box.innerHTML = `<div class="zs-verdict"><div class="zs-dot">Ω</div><div><b style="color:var(--ink)">Enter your reading</b><span>Type B/C/D ${zs.In} A MCB: maximum ${max.toFixed(1)} Ω</span></div></div>`; return; }
  const ok = r <= max + 1e-9; box.classList.add(ok ? 'ok' : 'bad');
  const diff = Math.abs(max - r), pct = max ? Math.round(diff / max * 100) : 0;
  const scale = max * 1.25, w = Math.min(100, r / scale * 100);
  box.innerHTML = `<div class="zs-verdict"><div class="zs-dot">${ok ? '✓' : '✕'}</div><div><b>${ok ? 'Pass' : 'Fail: too high'}</b><span>${fmtO(r)} Ω ${ok ? `is within the ${max.toFixed(1)} Ω maximum · ${fmtO(diff)} Ω (${pct}%) to spare` : `is over the ${max.toFixed(1)} Ω maximum by ${fmtO(diff)} Ω (${pct}%)`}</span></div></div>
    <div><div class="zs-gauge"><i style="width:${w}%"></i><em title="Maximum"></em></div><div class="zs-gauge-l"><span>0 Ω</span><span class="mx">max ${max.toFixed(1)}</span></div></div>`;
}
function drawZsLog() {
  const el = $('#zsLog'); if (!el) return;
  if (!zs.log.length) { el.innerHTML = ''; return; }
  el.innerHTML = `<div class="zs-lbl"><span>Test log · this device</span><span><button class="btn" id="zsCopy" style="height:28px;padding:0 10px">${icon('copy')}Copy</button> <button class="btn" id="zsClear" style="height:28px;padding:0 10px">Clear</button></span></div>` +
    zs.log.map(l => `<div class="it"><span class="pill ${l.ok ? 'ok' : 'bad'}">${l.ok ? 'PASS' : 'FAIL'}</span><div>${esc(l.c || 'Circuit')}<small>${l.t}${l.In} · max ${l.max.toFixed(1)} Ω · ${new Date(l.at).toLocaleString([], { dateStyle: 'short', timeStyle: 'short' })}</small></div><b class="mono">${fmtO(l.r)} Ω</b></div>`).join('');
}
$('#p-zs').addEventListener('click', async e => {
  const t = e.target.closest('[data-t]'), a = e.target.closest('[data-a]');
  if (t && t.closest('#zsTypes, #zsGrid')) zs.t = t.dataset.t;
  if (a && a.closest('#zsAmps, #zsGrid')) zs.In = +a.dataset.a;
  if ((t && t.closest('#zsTypes, #zsGrid')) || (a && a.closest('#zsAmps, #zsGrid'))) { prefs.set('zsType', zs.t); prefs.set('zsIn', zs.In); updateZs(); if (e.target.closest('#zsGrid')) $('#zsIn').focus(); return; }
  const id = e.target.closest('button')?.id;
  if (id === 'zsAdd') {
    const r = zsReading(); if (r == null) { toast('Type a reading first'); $('#zsIn').focus(); return; }
    const max = zsMax(zs.t, zs.In);
    zs.log.unshift({ c: clean($('#zsCct').value), t: zs.t, In: zs.In, r, max, ok: r <= max + 1e-9, at: Date.now() });
    zs.log = zs.log.slice(0, 100); prefs.set('zsLog', zs.log); drawZsLog();
    $('#zsCct').value = ''; $('#zsIn').value = ''; prefs.set('zsReading', ''); updateZs(); $('#zsIn').focus();
    toast('Added to log');
  } else if (id === 'zsCopy') {
    const txt = ['Circuit\tMCB\tMeasured Zs (Ω)\tMax Zs (Ω)\tResult\tDate'].concat(zs.log.map(l => `${l.c || 'Circuit'}\t${l.t}${l.In}\t${l.r}\t${l.max.toFixed(1)}\t${l.ok ? 'PASS' : 'FAIL'}\t${new Date(l.at).toLocaleString()}`)).join('\n');
    try { await navigator.clipboard.writeText(txt); toast('Log copied — paste into a spreadsheet or test sheet'); } catch { toast('Copy isn’t available here'); }
  } else if (id === 'zsClear') {
    const b = $('#zsClear'); if (b.dataset.armed !== '1') { b.dataset.armed = '1'; b.textContent = 'Tap to confirm'; return; }
    zs.log = []; prefs.set('zsLog', []); drawZsLog();
  } else if (id === 'zsOpenTbl') { const t = S.A && resolveRef('table', '8.1'); if (t) go(t); else toast('Open your PDF first'); }
  else if (id === 'zsOpenCl') { const t = S.A && resolveRef('clause', '8.3.9'); if (t) go(t); else toast('Open your PDF first'); }
});

/* ================================================================== OPEN / LIBRARY */
async function showWelcome(msg) {
  $('#welcome').hidden = false;
  $('#openMsg').innerHTML = msg || '';
  const all = await db.all('files');
  const files = all.filter(f => !f.value.parent);
  const kids = id => all.filter(f => f.value.parent === id).length;
  const lib = $('#lib');
  lib.hidden = !files.length;
  $('#libList').innerHTML = files.sort((a, b) => (b.value.opened || 0) - (a.value.opened || 0)).map(f => `<div class="lib-item" data-id="${esc(f.key)}"><button class="go"><b>${esc(f.value.name)}</b><span>${(f.value.size / 1048576).toFixed(1)} MB${kids(f.key) ? ` · ${kids(f.key)} amendment PDF${kids(f.key) > 1 ? 's' : ''}` : ''} · last opened ${new Date(f.value.opened || f.value.added).toLocaleDateString()}</span></button><button class="mini" data-act="rm" aria-label="Remove from this device">${icon('trash')}</button></div>`).join('');
  if (S.pdf) $('#libList').insertAdjacentHTML('afterbegin', `<div class="lib-item"><button class="go" id="backToDoc"><b>← Back to ${esc(S.name)}</b><span>currently open</span></button></div>`);
}
$('#libList').addEventListener('click', async e => {
  if (e.target.closest('#backToDoc')) { $('#welcome').hidden = true; return; }
  const it = e.target.closest('.lib-item'); if (!it) return;
  const id = it.dataset.id;
  if (e.target.closest('[data-act="rm"]')) {
    if (it.dataset.confirm !== '1') { it.dataset.confirm = '1'; e.target.closest('.mini').insertAdjacentHTML('beforebegin', `<span class="err" style="font-size:13px">Tap again to remove</span>`); return; }
    for (const k of (await db.all('files')).filter(f => f.value.parent === id)) { await db.del('files', k.key); await db.del('analysis', k.key); await db.del('user', k.key); }
    await db.del('files', id); await db.del('analysis', id); await db.del('user', id);
    if (S.id === id) location.reload(); else showWelcome(); return;
  }
  const rec = await db.get('files', id);
  if (rec) openBlob(rec.blob, rec.name, false);
});
$('#openBtn').onclick = () => $('#fileIn').click();
$('#fileIn').onchange = e => { const f = e.target.files[0]; if (f) openBlob(f, f.name, true); e.target.value = ''; };
const drop = $('#drop');
['dragenter', 'dragover'].forEach(ev => document.addEventListener(ev, e => { e.preventDefault(); drop.classList.add('over'); }));
['dragleave', 'drop'].forEach(ev => document.addEventListener(ev, e => { e.preventDefault(); if (ev === 'dragleave' && e.relatedTarget) return; drop.classList.remove('over'); }));
document.addEventListener('drop', e => { const f = [...(e.dataTransfer?.files || [])].find(f => /pdf$/i.test(f.type) || /\.pdf$/i.test(f.name)); if (f) openBlob(f, f.name, true); });
if ('launchQueue' in window) launchQueue.setConsumer(async p => { if (p.files?.length) { const f = await p.files[0].getFile(); openBlob(f, f.name, true); } });

async function openBlob(blob, name, isNew, opts = {}) {
  $('#openMsg').textContent = 'Opening…';
  if (S.id && S.pdf) { const a = currentAnchor(); if (a) S.user.lastPos = a; clearTimeout(saveT); await db.put('user', S.id, S.user); }
  let pdf;
  try {
    const data = new Uint8Array(await blob.arrayBuffer());
    pdf = await pdfjsLib.getDocument({ data, standardFontDataUrl: STD_FONTS, isEvalSupported: false }).promise;
  } catch (e) {
    const msg = e?.name === 'PasswordException' ? 'This PDF is password-protected. Open it once in another PDF app and save an unprotected copy, then try again.' : 'This file could not be opened as a PDF.';
    if ($('#welcome').hidden) showWelcome(`<span class="err">${msg}</span>`); else $('#openMsg').innerHTML = `<span class="err">${msg}</span>`;
    return;
  }
  if (S.pdf) { try { await S.pdf.destroy(); } catch {} }
  const id = pdf.fingerprints[0] + ':' + pdf.numPages;
  Object.assign(S, { pdf, id, parent: opts.parent || null, name: name.replace(/\.pdf$/i, ''), A: null, backStack: [], rendered: new Set(), textCache: new Map(), terms: [], _l2p: null, _outlineFlat: null, outline: null, tocEntries: [], tocSet: new Set(), indexSet: new Set() });
  if (isNew) {
    const old = await db.get('files', id);
    await db.put('files', id, { name, size: blob.size, blob: blob instanceof File ? new Blob([blob], { type: 'application/pdf' }) : blob, added: old?.added || Date.now(), opened: Date.now() });
    try { navigator.storage?.persist?.(); } catch {}
  } else { const rec = await db.get('files', id); if (rec) { rec.opened = Date.now(); db.put('files', id, rec); } }
  prefs.set('lastDoc', opts.parent || id);
  S.user = Object.assign({ bookmarks: [], favTables: [], recent: [], lastPos: null, amendments: [] }, await db.get('user', id) || {});
  if (opts.label) S.name = opts.label;
  await loadAmendments();
  $('#docName').textContent = S.name; document.title = S.name + ' · Wiring Rules Reader';
  $('#welcome').hidden = true; $('#app').hidden = false;
  // sizes: assume first page size until analysed
  const p1 = await pdf.getPage(1); const vp = p1.getViewport({ scale: 1 });
  const cached = await db.get('analysis', id);
  S.sizes = cached?.v === ANALYSIS_VERSION ? cached.sizes : new Array(pdf.numPages).fill([vp.width, vp.height]);
  $('#q').value = ''; $('#qClear').hidden = true; updateBack();
  buildPages(); layout({ p: 0, f: 0 });
  if (S.user.lastPos && !opts.goto) restoreAnchor(S.user.lastPos);
  S.current = -1; viewer.dispatchEvent(new Event('scroll'));
  S._pendingGoto = opts.goto || null;
  try { S.outline = await pdf.getOutline(); } catch {}
  renderAllPanels(); selectTab(S.tab === 'figures' ? 'contents' : S.tab, { open: false });
  if (cached?.v === ANALYSIS_VERSION) useAnalysis(cached); else startAnalysis();
  if (S._pendingGoto) { const g = S._pendingGoto; S._pendingGoto = null; go(g, { record: false }); }
  updateNotice();
}
async function startAnalysis() {
  const pr = $('#progress'); pr.hidden = false;
  const id = S.id; const t0 = performance.now();
  try {
    const A = await analyse(S.pdf, f => { if (S.id !== id) throw new Error('switched'); $('#progressBar').style.width = (f * 100) + '%'; $('#progressTxt').textContent = f < 1 ? `Building contents, tables and index… ${Math.round(f * S.pdf.numPages)} / ${S.pdf.numPages} pages` : 'Finishing…'; });
    if (S.id !== id) return;
    console.info('analysis', Math.round(performance.now() - t0) + 'ms');
    await db.put('analysis', id, A);
    useAnalysis(A);
    toast(`Ready: ${A.toc.length} contents entries, ${Object.keys(A.tables).length || A.tableList.length} tables, ${A.index.filter(e => !e.letter).length} index terms`, 3500);
  } catch (e) { if (e.message !== 'switched') { console.error(e); $('#progressTxt').textContent = 'Indexing failed: ' + e.message; } return; }
  pr.hidden = true;
}
function useAnalysis(A) {
  S.A = A; S._l2p = null;
  const sizeChanged = A.sizes.some((s, i) => S.sizes[i]?.[0] !== s[0] || S.sizes[i]?.[1] !== s[1]);
  S.sizes = A.sizes;
  S.tocSet = new Set(A.tocPages); S.indexSet = new Set(A.indexPages);
  S.tocEntries = A.toc.map(e => {
    let target = null;
    if (e.kind === 'section') target = resolveRef('section', e.id);
    else if (e.kind === 'appendix') target = resolveRef('appendix', e.id);
    else if (e.kind === 'clause') target = resolveRef('clause', e.id);
    if (target?.approx) target = null;
    if (!target && e.page) { const p = labelToPage(e.page); if (p != null) target = { p, y: 0 }; }
    // body location should be on/after the printed page; if we matched something far earlier, prefer printed page
    if (target && e.page) { const pp = labelToPage(e.page); if (pp != null && Math.abs(target.p - pp) > 3) target = { p: pp, y: 0 }; }
    if (target) target = { ...target, label: e.kind === 'clause' ? 'Clause ' + e.id : e.kind === 'section' ? 'Section ' + e.id : e.kind === 'appendix' ? 'Appendix ' + e.id : e.title };
    return { ...e, target };
  });
  // table/figure list rows on the list pages link to the tables themselves
  for (const [list, kind] of [[A.tableList, 'table'], [A.figList, 'figure']]) for (const e of list) S.tocEntries.push({ kind: 'listrow', rows: e.rows, target: resolveRef(kind, e.id), title: (kind === 'table' ? 'Table ' : 'Figure ') + e.id, hidden: true });
  S.tocEntries = S.tocEntries.filter(e => !e.hidden || e.target).map(e => e);
  const visibleToc = S.tocEntries.filter(e => e.kind !== 'listrow');
  S.tocEntries = [...visibleToc, ...S.tocEntries.filter(e => e.kind === 'listrow')];
  if (!visibleToc.length) {
    // no printed contents: build from headings found in the body
    const auto = [];
    for (let p = 0; p < A.n; p++) for (const h of A.heads[p]) {
      const depth = /^Section|^Appendix/.test(h.id) ? 0 : h.id.split('.').length - 1;
      if (depth <= 2) auto.push({ kind: depth ? 'clause' : 'section', id: h.id.replace(/^(Section|Appendix) /, ''), title: h.title, level: depth, target: { p, y: h.y, label: h.id } });
    }
    S.tocEntries = [...auto, ...S.tocEntries];
  }
  buildSearchText();
  $('#progress').hidden = true;
  if (sizeChanged) layout();
  for (const i of [...S.rendered]) pageEls[i].dataset.stale = '1';
  queueRender();
  renderAllPanels();
  onPageChange();
  if ($('#q').value) runSearch($('#q').value);
}
function renderAllPanels() { renderChanges(); renderContents(); renderCatalogue('table'); renderCatalogue('figure'); renderIndex(); renderSaved(); if (!$('#p-search').innerHTML) runSearch(''); }

/* ================================================================== BOOT */
applyTheme();
renderZs();
matchMedia('(prefers-color-scheme: dark)').addEventListener?.('change', applyTheme);
if ('serviceWorker' in navigator && location.protocol === 'https:' || location.hostname === 'localhost') {
  try { navigator.serviceWorker?.register('sw.js').catch(() => {}); } catch {}
}
(async () => {
  const last = prefs.get('lastDoc', null);
  if (last) {
    const rec = await db.get('files', last);
    if (rec?.blob) { await openBlob(rec.blob, rec.name, false); return; }
  }
  showWelcome();
})();
