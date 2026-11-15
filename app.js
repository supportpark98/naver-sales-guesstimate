/*!
 * 네이버 판매량 분석 (베타) — 북마클릿 앱
 * 네이버 브랜드스토어 상품 페이지에서 실행해야 동작합니다.
 */
(() => {
  const APP_ID = 'nsa-panel-root';
  const VERSION = '0.1.0-beta';

  // 이미 열려 있으면 닫기(토글)
  const prev = document.getElementById(APP_ID);
  if (prev) { prev.remove(); return; }

  // ───────────────────────── 설정 ─────────────────────────
  const GAP = 2000;           // 상품 사이 간격(ms)
  const SUB_GAP = 800;        // 같은 상품 안에서 요청 간격(ms)
  const BASE_Q = 'currentPurchaseType=Paid&usePurchased=true&basisPurchased=1&usePurchasedIn2Y=false&useRepurchased=false&useBestProduct=false&useNewProduct=false';
  const STORAGE_KEY = 'nsa-items';

  const sleep = ms => new Promise(r => setTimeout(r, ms));
  const onBrand = location.hostname === 'brand.naver.com';
  const store = location.pathname.split('/')[1] || '';
  const currentProductNo = (location.pathname.match(/products\/(\d+)/) || [])[1] || '';

  // ───────────────────────── 데이터 수집 로직 ─────────────────────────
  function findProductObj(state, ch) {
    let found = null;
    const walk = o => {
      if (found || !o || typeof o !== 'object') return;
      const entries = Object.entries(o);
      if (entries.some(([, v]) => String(v) === ch) &&
          entries.some(([k, v]) => /productno/i.test(k) && /^\d{6,}$/.test(String(v)) && String(v) !== ch)) {
        found = o; return;
      }
      for (const [, v] of entries) walk(v);
    };
    walk(state);
    return found;
  }

  function deepGet(o, keys, depth = 4) {
    if (!o || typeof o !== 'object' || depth < 0) return undefined;
    for (const k of keys) if (o[k] !== undefined && o[k] !== null && typeof o[k] !== 'object') return o[k];
    for (const v of Object.values(o)) { const r = deepGet(v, keys, depth - 1); if (r !== undefined) return r; }
    return undefined;
  }

  function nearest(html, ch, key, isNum = true) {
    const pos = [...html.matchAll(new RegExp(ch, 'g'))].map(x => x.index);
    const re = isNum ? new RegExp(`"${key}"\\s*:\\s*"?(\\d+)`, 'g') : new RegExp(`"${key}"\\s*:\\s*"([^"]+)"`, 'g');
    let best = null, bestD = Infinity;
    for (const x of html.matchAll(re)) {
      if (x[1] === ch) continue;
      for (const p of pos) { const d = Math.abs(p - x.index); if (d < bestD) { bestD = d; best = x[1]; } }
    }
    return bestD < 5000 ? best : null;
  }

  async function readProductPage(url, ch) {
    const html = await (await fetch(url, { credentials: 'include' })).text();
    const info = { origin: null, name: '', price: '', salePrice: '' };
    const m = html.match(/__PRELOADED_STATE__\s*=\s*([\s\S]*?)<\/script>/);
    if (m) {
      try {
        const p = findProductObj(JSON.parse(m[1].trim().replace(/;$/, '')), ch);
        if (p) {
          const okey = Object.keys(p).find(k => /productno/i.test(k) && /^\d{6,}$/.test(String(p[k])) && String(p[k]) !== ch);
          info.origin = String(p[okey]);
          info.name = p.name || p.productName || p.dispName || deepGet(p, ['name', 'productName', 'dispName']) || '';
          info.salePrice = deepGet(p, ['salePrice']) ?? '';
          info.price = deepGet(p, ['discountedSalePrice', 'mobileDiscountedSalePrice', 'benefitsViewDiscountedSalePrice']) ?? info.salePrice;
        }
      } catch (e) { /* 아래 예비 경로 사용 */ }
    }
    if (!info.origin) info.origin = nearest(html, ch, 'productNo');
    if (!info.name) {
      const og = html.match(/<meta[^>]+property="og:title"[^>]+content="([^"]*)"/) || html.match(/<title>([^<]*)<\/title>/);
      info.name = og ? og[1].replace(/\s*:\s*[^:]*$/, '').trim() : '';
    }
    if (info.salePrice === '') info.salePrice = nearest(html, ch, 'salePrice') || '';
    if (info.price === '') info.price = nearest(html, ch, 'discountedSalePrice') || info.salePrice;
    return info;
  }

  function originViaIframe(url) {
    return new Promise(resolve => {
      const f = document.createElement('iframe');
      f.style.cssText = 'position:fixed;width:1200px;height:900px;left:0;top:0;opacity:0;pointer-events:none;z-index:-1';
      f.src = url;
      document.body.appendChild(f);
      let n = 0;
      const t = setInterval(() => {
        n++;
        try {
          const u = f.contentWindow.performance.getEntriesByType('resource').map(e => e.name).find(u => u.includes('/marketing-message/'));
          if (u) { clearInterval(t); f.remove(); resolve(u.match(/marketing-message\/(\d+)/)[1]); return; }
        } catch (e) {}
        if (n > 30) { clearInterval(t); f.remove(); resolve(null); }
      }, 500);
    });
  }

  async function ask(origin, basis) {
    const q = BASE_Q.replace('basisPurchased=1', 'basisPurchased=' + basis);
    const r = await fetch(`/n/v1/marketing-message/${origin}?${q}`, { credentials: 'include' });
    if (r.status !== 200) return { status: r.status };
    const j = await r.json();
    return { status: 200, prefix: (j.prefix || '').trim(), n: Number((j.mainPhrase || '').replace(/[^0-9]/g, '')) || 0 };
  }
  const kind = m => !m || m.status !== 200 ? 'none' : m.prefix.includes('오늘') ? 'today' : /1주/.test(m.prefix) ? 'week' : 'total';

  async function extraMessage(origin, q) {
    const r = await fetch(`/n/v1/marketing-message/${origin}?currentPurchaseType=Paid&${q}`, { credentials: 'include' });
    if (r.status !== 200) return `없음(${r.status})`;
    const j = await r.json();
    return ((j.prefix || '') + (j.mainPhrase || '')).trim() || JSON.stringify(j);
  }

  async function analyze(item) {
    const url = /^\d+$/.test(item) ? `${location.origin}/${store}/products/${item}` : item.split('?')[0];
    const ch = (url.match(/products\/(\d+)/) || [])[1] || '';
    const row = { time: new Date().toLocaleString('ko-KR'), url, ch, origin: '', name: '', price: '', salePrice: '',
      today: '', week: '', daily: '', total: '', y2: '', rep: '', memo: '' };

    if (!ch) { row.memo = '상품번호를 찾을 수 없는 주소'; return finish(row); }
    if (new URL(url, location.href).hostname !== location.hostname) {
      row.memo = `다른 사이트 상품(${new URL(url).hostname})은 지금 페이지에서 조회 불가`; return finish(row);
    }
    try {
      const info = await readProductPage(url, ch);
      Object.assign(row, { origin: info.origin || '', name: info.name, price: info.price, salePrice: info.salePrice });
      if (!row.origin) row.origin = (await originViaIframe(url)) || '';
      if (!row.origin) { row.memo = '원상품번호 못 찾음'; return finish(row); }

      let m = await ask(row.origin, 1);
      if (kind(m) === 'none') row.memo = `판매량 배지 없음(${m.status})`;
      if (kind(m) === 'today') { row.today = m.n; await sleep(SUB_GAP); m = await ask(row.origin, m.n + 1); }
      else if (kind(m) !== 'none') row.today = 0;
      if (kind(m) === 'week') { row.week = m.n; row.daily = Math.round(m.n / 7); await sleep(SUB_GAP); m = await ask(row.origin, m.n + 1); }
      if (kind(m) === 'total') row.total = m.n;

      await sleep(SUB_GAP);
      row.y2 = await extraMessage(row.origin, 'usePurchased=false&basisPurchased=1&usePurchasedIn2Y=true&useRepurchased=false&useBestProduct=false&useNewProduct=false');
      await sleep(SUB_GAP);
      row.rep = await extraMessage(row.origin, 'usePurchased=false&usePurchasedIn2Y=false&useRepurchased=true&basisRepurchased=1&useBestProduct=false&useNewProduct=false');
    } catch (e) {
      row.memo = '에러: ' + e.message;
    }
    return finish(row);
  }

  function finish(row) {
    const p = Number(row.price) || 0;
    row.salesNow = p && row.today !== '' ? Math.round(row.today * p) : '';
    row.salesDay = p && row.week !== '' ? Math.round(row.week * p / 7) : '';
    row.salesWeek = p && row.week !== '' ? Math.round(row.week * p) : '';
    row.salesTotal = p && row.total !== '' ? Math.round(row.total * p) : '';
    return row;
  }

  // ───────────────────────── 출력 형식 ─────────────────────────
  const COLUMNS = [
    ['time', '수집시각'], ['name', '상품명'], ['price', '대표가격(할인가)'], ['salePrice', '정가'],
    ['url', '상품주소'], ['ch', '채널상품번호'], ['origin', '원상품번호'],
    ['today', '오늘 구매자'], ['week', '최근1주 구매자'], ['daily', '일평균(1주÷7)'], ['total', '최근 약4개월 구매자(추정·이상)'],
    ['salesNow', '실시간 추정매출(오늘×가격·수집시각까지)'], ['salesDay', '일간 예상매출(1주÷7×가격)'],
    ['salesWeek', '주간 추정매출(1주×가격)'], ['salesTotal', '최근4개월 추정매출(4개월×가격)'],
    ['y2', '2년 구매 메시지'], ['rep', '재구매 메시지'], ['memo', '메모'],
  ];
  const toTSV = rows => [COLUMNS.map(c => c[1]), ...rows.map(r => COLUMNS.map(c => r[c[0]] ?? ''))].map(a => a.join('\t')).join('\n');
  const toCSV = rows => '﻿' + [COLUMNS.map(c => c[1]), ...rows.map(r => COLUMNS.map(c => r[c[0]] ?? ''))]
    .map(a => a.map(v => `"${String(v).replace(/"/g, '""')}"`).join(',')).join('\n');
  const won = v => v === '' || v == null ? '–' : Number(v).toLocaleString('ko-KR');
  const num = v => v === '' || v == null ? '–' : Number(v).toLocaleString('ko-KR');
  const esc = s => String(s ?? '').replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));

  // ───────────────────────── 화면(UI) ─────────────────────────
  const host = document.createElement('div');
  host.id = APP_ID;
  host.style.cssText = 'position:fixed;top:16px;right:16px;z-index:2147483647;';
  const root = host.attachShadow({ mode: 'open' });
  root.innerHTML = `
  <style>
    :host { all: initial; }
    * { box-sizing: border-box; font-family: -apple-system, "Pretendard", "Apple SD Gothic Neo", "Malgun Gothic", sans-serif; }
    .panel { width: min(1100px, calc(100vw - 32px)); max-height: calc(100vh - 32px); display: flex; flex-direction: column;
      background: #fff; color: #1a1a1a; border: 1px solid #dcdfe4; border-radius: 14px; box-shadow: 0 12px 40px rgba(0,0,0,.18); overflow: hidden; }
    .head { display: flex; align-items: center; gap: 8px; padding: 12px 16px; background: #03c75a; color: #fff; cursor: move; user-select: none; }
    .head b { font-size: 15px; } .head small { opacity: .85; font-size: 11px; }
    .head .x { margin-left: auto; background: transparent; border: 0; color: #fff; font-size: 20px; cursor: pointer; line-height: 1; }
    .body { padding: 14px 16px; display: flex; flex-direction: column; gap: 10px; overflow: auto; }
    label { font-size: 12px; color: #555; }
    textarea { width: 100%; min-height: 84px; resize: vertical; padding: 10px; border: 1px solid #dcdfe4; border-radius: 8px; font-size: 13px; font-family: ui-monospace, Consolas, monospace; }
    .row { display: flex; gap: 8px; flex-wrap: wrap; align-items: center; }
    button.btn { padding: 8px 14px; border-radius: 8px; border: 1px solid #dcdfe4; background: #fff; font-size: 13px; cursor: pointer; }
    button.btn:hover { background: #f5f6f8; }
    button.primary { background: #03c75a; border-color: #03c75a; color: #fff; font-weight: 600; }
    button.primary:hover { background: #02b351; }
    button:disabled { opacity: .5; cursor: default; }
    .status { font-size: 12px; color: #555; margin-left: auto; }
    .warn { font-size: 12px; background: #fff4e5; color: #8a5300; padding: 8px 10px; border-radius: 8px; }
    .tablewrap { overflow: auto; border: 1px solid #eceef1; border-radius: 8px; max-height: 50vh; }
    table { border-collapse: collapse; width: 100%; font-size: 12px; }
    th, td { padding: 7px 9px; border-bottom: 1px solid #f0f1f3; white-space: nowrap; text-align: right; }
    th { position: sticky; top: 0; background: #f7f8fa; font-weight: 600; color: #444; z-index: 1; }
    td.l, th.l { text-align: left; }
    td.name { max-width: 260px; overflow: hidden; text-overflow: ellipsis; }
    td.name a { color: #1a1a1a; text-decoration: none; } td.name a:hover { text-decoration: underline; }
    td.hl { font-weight: 700; color: #03a14b; }
    td.memo { color: #b3261e; text-align: left; }
    td.msg { text-align: left; color: #555; }
    .empty { padding: 24px; text-align: center; color: #888; font-size: 13px; }
    .foot { font-size: 11px; color: #888; line-height: 1.5; }
  </style>
  <div class="panel">
    <div class="head"><b>📊 네이버 판매량 분석</b><small>${VERSION}</small><button class="x" title="닫기">×</button></div>
    <div class="body">
      ${onBrand ? '' : '<div class="warn">⚠️ 네이버 브랜드스토어(brand.naver.com) 상품 페이지에서 실행해야 동작해요. 브랜드스토어 상품 페이지를 연 뒤 다시 눌러주세요.</div>'}
      <label>분석할 상품 — 한 줄에 하나씩, 채널상품번호(주소창 숫자) 또는 상품 URL</label>
      <textarea placeholder="11190928899&#10;https://brand.naver.com/usimsa/products/5656333779"></textarea>
      <div class="row">
        <button class="btn add">＋ 지금 보는 상품 추가</button>
        <button class="btn clear">목록 비우기</button>
        <button class="btn primary run">분석 시작 ▶</button>
        <span class="status"></span>
      </div>
      <div class="tablewrap"><div class="empty">상품을 넣고 [분석 시작]을 눌러주세요.</div></div>
      <div class="row">
        <button class="btn copy" disabled>📋 엑셀용 복사</button>
        <button class="btn csv" disabled>💾 CSV 다운로드</button>
      </div>
      <div class="foot">
        · 구매자 수는 네이버 상품 배지 기준(명)이며, 매출은 구매자 × 대표가격으로 계산한 추정치예요. 한 사람이 여러 개를 사거나 비싼 옵션을 사면 실제보다 작게 나와요.<br>
        · '오늘'과 실시간 매출은 수집 시각까지 쌓인 값이라, 하루 판매량 비교에는 일간 예상매출(1주÷7)을 쓰세요. '약 4개월'은 추정 기간이에요.<br>
        · 지금 열려 있는 사이트(${esc(location.hostname)})의 상품만 조회돼요.
      </div>
    </div>
  </div>`;
  document.body.appendChild(host);

  const $ = s => root.querySelector(s);
  const ta = $('textarea'), status = $('.status'), wrap = $('.tablewrap');
  let results = [];

  try { ta.value = localStorage.getItem(STORAGE_KEY) || ''; } catch (e) {}
  const save = () => { try { localStorage.setItem(STORAGE_KEY, ta.value); } catch (e) {} };
  ta.addEventListener('input', save);

  $('.x').onclick = () => host.remove();
  $('.clear').onclick = () => { ta.value = ''; save(); };
  $('.add').onclick = () => {
    if (!currentProductNo) { status.textContent = '지금 페이지는 상품 페이지가 아니에요.'; return; }
    const lines = ta.value.split('\n').map(s => s.trim()).filter(Boolean);
    if (!lines.some(l => l.includes(currentProductNo))) lines.push(currentProductNo);
    ta.value = lines.join('\n'); save();
  };

  function render() {
    if (!results.length) { wrap.innerHTML = '<div class="empty">결과가 없어요.</div>'; return; }
    wrap.innerHTML = `<table>
      <thead><tr>
        <th class="l">상품명</th><th>대표가격</th><th>오늘</th><th>최근1주</th><th>일평균</th><th>약4개월</th>
        <th>실시간 매출</th><th>일간 예상매출</th><th>주간 매출</th><th>4개월 매출</th>
        <th class="l">2년 구매</th><th class="l">재구매</th><th class="l">메모</th>
      </tr></thead>
      <tbody>${results.map(r => `<tr>
        <td class="l name" title="${esc(r.name)}"><a href="${esc(r.url)}" target="_blank">${esc(r.name || r.ch)}</a></td>
        <td>${won(r.price)}</td><td>${num(r.today)}</td><td>${num(r.week)}</td><td>${num(r.daily)}</td><td>${num(r.total)}</td>
        <td>${won(r.salesNow)}</td><td class="hl">${won(r.salesDay)}</td><td>${won(r.salesWeek)}</td><td>${won(r.salesTotal)}</td>
        <td class="msg">${esc(r.y2)}</td><td class="msg">${esc(r.rep)}</td><td class="memo">${esc(r.memo)}</td>
      </tr>`).join('')}</tbody></table>`;
  }

  $('.run').onclick = async () => {
    const items = [...new Set(ta.value.split('\n').map(s => s.trim()).filter(Boolean))];
    if (!items.length) { status.textContent = '상품을 먼저 넣어주세요.'; return; }
    if (!onBrand) { status.textContent = '브랜드스토어 페이지에서 실행해주세요.'; return; }
    const btns = root.querySelectorAll('button.btn');
    btns.forEach(b => b.disabled = true);
    results = [];
    render();
    for (let i = 0; i < items.length; i++) {
      status.textContent = `분석 중… ${i + 1} / ${items.length}`;
      results.push(await analyze(items[i]));
      render();
      if (i < items.length - 1) await sleep(GAP);
    }
    status.textContent = `✅ 완료 (${new Date().toLocaleTimeString('ko-KR')}) — ${results.length}개 상품`;
    btns.forEach(b => b.disabled = false);
  };

  $('.copy').onclick = async () => {
    const tsv = toTSV(results);
    try { await navigator.clipboard.writeText(tsv); status.textContent = '📋 복사 완료! 엑셀에서 Ctrl+V 하세요.'; }
    catch (e) {
      const t = document.createElement('textarea'); t.value = tsv; root.appendChild(t); t.select();
      document.execCommand('copy'); t.remove(); status.textContent = '📋 복사 완료! 엑셀에서 Ctrl+V 하세요.';
    }
  };
  $('.csv').onclick = () => {
    const a = document.createElement('a');
    a.href = URL.createObjectURL(new Blob([toCSV(results)], { type: 'text/csv' }));
    a.download = `네이버_판매량_${new Date().toISOString().slice(0, 10)}.csv`;
    a.click();
  };

  // 머리글 끌어서 창 옮기기
  const head = $('.head');
  head.addEventListener('mousedown', e => {
    if (e.target.closest('.x')) return;
    const r = host.getBoundingClientRect(), dx = e.clientX - r.left, dy = e.clientY - r.top;
    const move = ev => { host.style.left = (ev.clientX - dx) + 'px'; host.style.top = (ev.clientY - dy) + 'px'; host.style.right = 'auto'; };
    const up = () => { document.removeEventListener('mousemove', move); document.removeEventListener('mouseup', up); };
    document.addEventListener('mousemove', move); document.addEventListener('mouseup', up);
  });
})();
