(() => {
  "use strict";

  const STORAGE_KEY = "attendance-manager-v1";
  const DATA = window.SCHEDULE;
  const WEEKDAYS = ["日", "月", "火", "水", "木", "金", "土"];
  const STATUS_LABEL = { present: "出席", absent: "欠席", excused: "公欠" };

  /* ---------- state ---------- */
  const defaults = () => ({ settings: { threshold: 80, deduct: 2 }, records: {} });
  let state = load();

  function load() {
    try {
      const raw = localStorage.getItem(STORAGE_KEY);
      if (!raw) return defaults();
      const p = JSON.parse(raw);
      return {
        settings: Object.assign(defaults().settings, p.settings || {}),
        records: p.records || {},
      };
    } catch (e) {
      return defaults();
    }
  }
  function save() {
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
    } catch (e) {
      toast("この端末では保存できません（プライベートモードなど）");
    }
  }

  /* ---------- helpers ---------- */
  const esc = (s) => String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
  const pad = (n) => String(n).padStart(2, "0");
  const iso = (d) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
  const parse = (s) => { const [y, m, d] = s.split("-").map(Number); return new Date(y, m - 1, d); };
  const todayIso = () => iso(new Date());
  const key = (slot) => `${slot.date}|${slot.period}`;
  const pct = (x) => (x == null ? "—" : (Math.round(x * 1000) / 10).toFixed(1) + "%");
  const fmtDate = (s) => { const d = parse(s); return `${d.getMonth() + 1}/${d.getDate()}（${WEEKDAYS[d.getDay()]}）`; };

  let toastTimer;
  function toast(msg) {
    const el = document.getElementById("toast");
    el.textContent = msg;
    el.classList.add("show");
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => el.classList.remove("show"), 2200);
  }

  /* ---------- 計算 ---------- */
  const trackedSlots = DATA.slots.filter((s) => s.tracked);

  function calc(subject) {
    const { threshold, deduct } = state.settings;
    const slots = trackedSlots.filter((s) => s.subject === subject.name);
    const total = subject.hours || subject.required * 2;          // 年間の総コマ数（時間）
    const perClass = total / subject.required;                    // 1回の授業あたりのコマ数
    const allowedLoss = total * (1 - threshold / 100);            // 減らしてよい上限コマ数
    const allowed = Math.max(0, Math.floor(allowedLoss / deduct + 1e-9)); // 休める回数

    let present = 0, absent = 0, excused = 0;
    for (const s of slots) {
      const r = state.records[key(s)];
      if (r === "present") present++;
      else if (r === "absent") absent++;
      else if (r === "excused") excused++;
    }
    const recorded = present + absent;
    const lost = absent * deduct;
    const projected = (total - lost) / total;
    const current = recorded ? (recorded * perClass - lost) / (recorded * perClass) : null;
    const remaining = allowed - absent;
    const today = todayIso();
    const upcoming = slots.filter((s) => s.date > today && !state.records[key(s)]).length;

    let level = "ok", badge = "安全";
    if (remaining < 0) { level = "ng"; badge = "不足"; }
    else if (remaining === 0) { level = "warn"; badge = "危険"; }
    else if (remaining === 1) { level = "warn"; badge = "注意"; }

    return { subject, slots, total, allowed, present, absent, excused, recorded, lost, projected, current, remaining, upcoming, level, badge };
  }
  const calcAll = () => DATA.subjects.map(calc);

  /* ---------- tabs ---------- */
  const panels = { home: byId("tab-home"), record: byId("tab-record"), settings: byId("tab-settings") };
  function byId(id) { return document.getElementById(id); }
  let currentTab = "home";
  function showTab(name) {
    currentTab = name;
    for (const [k, el] of Object.entries(panels)) el.hidden = k !== name;
    document.querySelectorAll(".tabs button").forEach((b) => b.setAttribute("aria-selected", String(b.dataset.tab === name)));
    render();
  }
  document.querySelector(".tabs").addEventListener("click", (e) => {
    const b = e.target.closest("button[data-tab]");
    if (b) showTab(b.dataset.tab);
  });

  /* ---------- HOME ---------- */
  function renderHome() {
    const rows = calcAll();
    const rank = { ng: 0, warn: 1, ok: 2 };
    const sorted = rows.slice().sort((a, b) => rank[a.level] - rank[b.level]);
    const ngCount = rows.filter((r) => r.level === "ng").length;
    const warnCount = rows.filter((r) => r.level === "warn").length;

    const today = todayIso();
    const pending = trackedSlots.filter((s) => s.date <= today && !state.records[key(s)]).length;

    let head;
    if (ngCount) head = `<span class="big" style="color:var(--brick)">${ngCount}科目が${state.settings.threshold}%を下回っています</span>`;
    else if (warnCount) head = `<span class="big" style="color:var(--amber)">${warnCount}科目が休めない状態です</span>`;
    else head = `<span class="big" style="color:var(--pine)">すべての科目で余裕があります</span>`;

    let html = `<div class="summary">${head}<span class="muted small">出席率${state.settings.threshold}%未満は不可 ／ 欠席1回で${state.settings.deduct}コマ減</span></div>`;

    if (pending) {
      html += `<div class="pending-note"><span>今日までに記録していない授業が <b class="num">${pending}</b> コマあります。</span>
        <button class="btn small" data-act="fill-present">未入力をすべて出席にする</button></div>`;
    }

    const todaySlots = DATA.slots.filter((s) => s.date === today);
    if (todaySlots.length) html += `<h2>今日</h2>` + dayHtml(today, todaySlots, true) + `<h2 style="margin-top:22px">科目ごとの状況</h2>`;
    else html += `<h2>科目ごとの状況</h2>`;

    html += sorted.map(subjectCard).join("");
    panels.home.innerHTML = html;
  }

  function subjectCard(r) {
    const s = r.subject;
    const maxPips = 60;
    const used = Math.min(r.absent, r.allowed);
    const over = Math.max(0, r.absent - r.allowed);
    let pips = "";
    if (r.allowed <= maxPips) {
      for (let i = 0; i < r.allowed; i++) pips += `<span class="pip${i < used ? " used" : ""}"></span>`;
      for (let i = 0; i < Math.min(over, 10); i++) pips += `<span class="pip over"></span>`;
    }
    let remainHtml;
    if (r.remaining > 0) remainHtml = `<span class="t">あと</span><span class="n num">${r.remaining}</span><span class="t">回 休めます</span>`;
    else if (r.remaining === 0) remainHtml = `<span class="n num">0</span><span class="t">回　次に休むと${state.settings.threshold}%を切ります</span>`;
    else remainHtml = `<span class="t">上限を</span><span class="n num">${-r.remaining}</span><span class="t">回 超えています</span>`;

    return `<article class="subject ${r.level}">
      <div class="subject-head">
        <div><h3>${esc(s.name)}</h3><div class="term">${esc(s.term)}${s.teacher ? " ／ " + esc(s.teacher) : ""}</div></div>
        <span class="badge">${r.badge}</span>
      </div>
      <div class="remain">${remainHtml}</div>
      <div class="pips" aria-label="休める回数 ${r.allowed}回のうち欠席 ${r.absent}回">${pips}</div>
      <dl class="stats">
        <div><dt>現在の出席率</dt><dd class="num">${pct(r.current)}</dd></div>
        <div><dt>年間の見込み（残りは全出席）</dt><dd class="num">${pct(r.projected)}</dd></div>
        <div><dt>欠席</dt><dd class="num">${r.absent}回（${r.lost}コマ減）</dd></div>
        <div><dt>休める上限</dt><dd class="num">${r.allowed}回 ／ 全${s.required}回</dd></div>
        <div><dt>記録済み</dt><dd class="num">出席${r.present}・欠席${r.absent}${r.excused ? "・公欠" + r.excused : ""}</dd></div>
        <div><dt>これからの授業（未入力）</dt><dd class="num">${r.upcoming}コマ</dd></div>
      </dl>
    </article>`;
  }

  /* ---------- RECORD ---------- */
  const weeks = (() => {
    const set = new Set();
    for (const s of DATA.slots) {
      const d = parse(s.date);
      d.setDate(d.getDate() - d.getDay());
      set.add(iso(d));
    }
    return [...set].sort();
  })();
  let weekIdx = (() => {
    const d = new Date(); d.setDate(d.getDate() - d.getDay());
    const t = iso(d);
    let i = weeks.indexOf(t);
    if (i < 0) i = t < weeks[0] ? 0 : weeks.length - 1;
    return i;
  })();

  function renderRecord() {
    const start = parse(weeks[weekIdx]);
    const end = new Date(start); end.setDate(end.getDate() + 6);
    const label = `${start.getMonth() + 1}/${start.getDate()} 〜 ${end.getMonth() + 1}/${end.getDate()}`;

    let html = `<div class="weeknav">
      <button class="btn" data-act="week-prev" ${weekIdx === 0 ? "disabled" : ""}>前の週</button>
      <span class="label num">${label}</span>
      <button class="btn" data-act="week-next" ${weekIdx === weeks.length - 1 ? "disabled" : ""}>次の週</button>
      <button class="btn" data-act="week-today">今日の週</button>
    </div>`;

    let any = false;
    for (let i = 0; i < 7; i++) {
      const d = new Date(start); d.setDate(d.getDate() + i);
      const ds = iso(d);
      const slots = DATA.slots.filter((s) => s.date === ds);
      if (!slots.length) continue;
      any = true;
      html += dayHtml(ds, slots, true);
    }
    if (!any) html += `<div class="empty">この週は授業の予定がありません</div>`;
    panels.record.innerHTML = html;
  }

  function dayHtml(ds, slots, withDayButtons) {
    const tracked = slots.filter((s) => s.tracked);
    const isToday = ds === todayIso();
    let h = `<section class="day${isToday ? " today" : ""}" data-date="${ds}">
      <div class="day-head"><span class="d num">${fmtDate(ds)}${isToday ? '<span class="tag">今日</span>' : ""}</span>`;
    if (withDayButtons && tracked.length) {
      h += `<span><button class="btn small" data-act="day-all" data-date="${ds}" data-status="present">この日は全部出席</button>
        <button class="btn small" data-act="day-all" data-date="${ds}" data-status="absent">全部欠席</button></span>`;
    }
    h += `</div>`;
    const sorted = slots.slice().sort((a, b) => a.period - b.period);
    for (const s of sorted) {
      if (!s.tracked) {
        h += `<div class="slot event"><span class="p">${s.period}コマ</span><span class="s">${esc(s.subject)}${s.teacher ? `<span class="meta">　${esc(s.teacher)}</span>` : ""}</span></div>`;
        continue;
      }
      const cur = state.records[key(s)];
      const btn = (st) => `<button class="${st}" data-act="set" data-key="${key(s)}" data-status="${st}" aria-pressed="${cur === st}">${STATUS_LABEL[st]}</button>`;
      h += `<div class="slot"><span class="p">${s.period}コマ</span>
        <span class="s">${esc(s.subject)}<span class="meta">　${[s.teacher, s.room].filter(Boolean).map(esc).join(" ／ ")}</span></span>
        <span class="seg" role="group" aria-label="${esc(s.subject)} ${s.period}コマ">${btn("present")}${btn("absent")}${btn("excused")}</span></div>`;
    }
    return h + `</section>`;
  }

  /* ---------- SETTINGS ---------- */
  function renderSettings() {
    const rows = calcAll();
    const { threshold, deduct } = state.settings;
    const total = rows.reduce((a, r) => a + r.subject.hours, 0);
    panels.settings.innerHTML = `
      <div class="card">
        <h2>ルール</h2>
        <div class="field"><label for="thr">必要な出席率（%）</label><input id="thr" type="number" min="1" max="100" step="1" value="${threshold}"></div>
        <div class="field"><label for="ded">欠席1回で減るコマ数</label><input id="ded" type="number" min="1" max="10" step="1" value="${deduct}"></div>
        <p class="muted small">出席率 ＝（年間の総コマ数 − 欠席で減ったコマ数）÷ 年間の総コマ数。たとえば総60コマの科目では、欠席1回で2コマ減り、12コマまで（＝6回）休めます。</p>
        <div class="row-btns"><button class="btn primary" data-act="save-settings">保存</button></div>
      </div>

      <div class="card">
        <h2>科目ごとの上限</h2>
        <table class="rules">
          <thead><tr><th>科目</th><th class="r">回数</th><th class="r">総コマ</th><th class="r">休める回数</th></tr></thead>
          <tbody>${rows.map((r) => `<tr><td>${esc(r.subject.name)}</td><td class="r num">${r.subject.required}</td><td class="r num">${r.total}</td><td class="r num">${r.allowed}</td></tr>`).join("")}</tbody>
        </table>
        <p class="muted small">時間割ファイル下部の「回数」「時間」の値を使っています（合計 ${total}コマ）。</p>
      </div>

      <div class="card">
        <h2>データ</h2>
        <p class="muted small">記録はこの端末のブラウザに保存されます。端末を変える前や、ブラウザのデータを消す前にバックアップしてください。</p>
        <div class="row-btns">
          <button class="btn" data-act="export">バックアップを保存</button>
          <button class="btn" data-act="import">バックアップを読み込む</button>
          <button class="btn danger" data-act="reset">記録をすべて消す</button>
        </div>
        <input type="file" id="importFile" accept="application/json,.json" hidden>
      </div>`;
    const f = byId("importFile");
    f.addEventListener("change", () => {
      const file = f.files[0];
      if (!file) return;
      const reader = new FileReader();
      reader.onload = () => {
        try {
          const p = JSON.parse(reader.result);
          if (!p || typeof p.records !== "object") throw new Error("形式が違います");
          state = { settings: Object.assign(defaults().settings, p.settings || {}), records: p.records };
          save(); render(); toast("バックアップを読み込みました");
        } catch (e) { toast("読み込めませんでした：" + e.message); }
      };
      reader.readAsText(file);
    });
  }

  /* ---------- actions ---------- */
  document.addEventListener("click", (e) => {
    const el = e.target.closest("[data-act]");
    if (!el) return;
    const act = el.dataset.act;

    if (act === "set") {
      const k = el.dataset.key, st = el.dataset.status;
      if (state.records[k] === st) delete state.records[k]; else state.records[k] = st;
      save(); render();
    } else if (act === "day-all") {
      const ds = el.dataset.date, st = el.dataset.status;
      DATA.slots.filter((s) => s.date === ds && s.tracked).forEach((s) => (state.records[key(s)] = st));
      save(); render();
    } else if (act === "fill-present") {
      const today = todayIso();
      let n = 0;
      trackedSlots.filter((s) => s.date <= today && !state.records[key(s)]).forEach((s) => { state.records[key(s)] = "present"; n++; });
      save(); render(); toast(`${n}コマを出席にしました`);
    } else if (act === "week-prev") { weekIdx = Math.max(0, weekIdx - 1); render(); }
    else if (act === "week-next") { weekIdx = Math.min(weeks.length - 1, weekIdx + 1); render(); }
    else if (act === "week-today") {
      const d = new Date(); d.setDate(d.getDate() - d.getDay());
      const i = weeks.indexOf(iso(d));
      weekIdx = i >= 0 ? i : (iso(d) < weeks[0] ? 0 : weeks.length - 1);
      render();
    } else if (act === "save-settings") {
      const thr = Number(byId("thr").value), ded = Number(byId("ded").value);
      if (!(thr >= 1 && thr <= 100) || !(ded >= 1)) { toast("数値を確認してください"); return; }
      state.settings = { threshold: thr, deduct: ded };
      save(); render(); toast("保存しました");
    } else if (act === "export") {
      const blob = new Blob([JSON.stringify(state, null, 2)], { type: "application/json" });
      const a = document.createElement("a");
      a.href = URL.createObjectURL(blob);
      a.download = `attendance-backup-${todayIso()}.json`;
      a.click();
      setTimeout(() => URL.revokeObjectURL(a.href), 1000);
    } else if (act === "import") {
      byId("importFile").click();
    } else if (act === "reset") {
      if (confirm("出欠の記録をすべて消します。元に戻せません。よろしいですか？")) {
        state.records = {}; save(); render(); toast("記録を消しました");
      }
    }
  });

  /* ---------- render ---------- */
  function render() {
    byId("subTitle").textContent = `${DATA.year}年度 ${DATA.grade}`;
    if (currentTab === "home") renderHome();
    else if (currentTab === "record") renderRecord();
    else renderSettings();
  }
  render();
})();
