(() => {
  "use strict";

  const CONFIG = {
    owner: "sanaisawan63x2",
    repo: "CaeLum",
    branch: "main",
    dataPath: "data/world.json",
    rawDataUrl: "https://raw.githubusercontent.com/sanaisawan63x2/CaeLum/main/data/world.json"
  };

  let db = { schemaVersion:4, version:1, project:{}, novel:{chapters:[]}, sections:[], entries:[] };
  let authorMode = false;
  let adminToken = sessionStorage.getItem("caelum_admin_token") || "";
  let remoteSha = "";
  let editingEntryId = null;
  let editingSectionId = null;
  let editingChapterId = null;
  let searchQuery = "";
  let readingScrollHandler = null;
  let glossaryPopover = null;
  let currentEntryTab = "basic";
  let expandedNav = new Set();
  let routeHistory = [];
  try {
    routeHistory = JSON.parse(sessionStorage.getItem("caelum_route_history") || "[]");
    if (!Array.isArray(routeHistory)) routeHistory = [];
  } catch {
    routeHistory = [];
  }

  try {
    expandedNav = new Set(JSON.parse(localStorage.getItem("caelum_nav_open") || "[]"));
  } catch {
    expandedNav = new Set();
  }

  const SIDEBAR_MIN = 260;
  const SIDEBAR_MAX = 560;
  const SIDEBAR_DEFAULT = 320;
  let sidebarWidth = Number(localStorage.getItem("caelum_sidebar_width") || SIDEBAR_DEFAULT);

  function clampSidebarWidth(value) {
    return Math.max(SIDEBAR_MIN,Math.min(SIDEBAR_MAX,Number(value)||SIDEBAR_DEFAULT));
  }

  function applySidebarWidth(value,persist=true) {
    sidebarWidth = clampSidebarWidth(value);
    document.documentElement.style.setProperty("--sidebar",sidebarWidth + "px");
    if (persist) localStorage.setItem("caelum_sidebar_width",String(sidebarWidth));
  }

  applySidebarWidth(sidebarWidth,false);

  const $ = id => document.getElementById(id);
  const content = $("content");
  const categoryNav = $("categoryNav");
  const searchInput = $("searchInput");
  const sidebarSearch = $("sidebarSearch");
  const adminModal = $("adminModal");
  const editorModal = $("editorModal");
  const sectionModal = $("sectionModal");

  function esc(value) {
    return String(value == null ? "" : value).replace(/[&<>"']/g, ch => ({
      "&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#039;"
    })[ch]);
  }

  function uid(prefix) {
    return prefix + "-" + (crypto.randomUUID ? crypto.randomUUID() : Date.now() + "-" + Math.random().toString(16).slice(2));
  }

  function normalizeDb(value) {
    const safe = value && typeof value === "object" ? value : {};
    safe.project = safe.project || {};
    safe.project.assets = safe.project.assets || {};
    safe.novel = safe.novel && typeof safe.novel === "object" ? safe.novel : {};
    safe.novel.chapters = Array.isArray(safe.novel.chapters) ? safe.novel.chapters : [];
    safe.sections = Array.isArray(safe.sections) ? safe.sections : [];
    safe.entries = Array.isArray(safe.entries) ? safe.entries : [];
    safe.schemaVersion = safe.schemaVersion || 4;
    safe.version = Number(safe.version || 1);
    return safe;
  }

  function sectionById(id) { return db.sections.find(x => x.id === id) || null; }
  function entryById(id) { return db.entries.find(x => x.id === id) || null; }
  function chapterById(id) { return (db.novel.chapters || []).find(x => x.id === id) || null; }
  function isVisible(item) { return authorMode || item.visibility !== "author-only"; }
  function visibleSections() { return db.sections.filter(isVisible); }
  function visibleEntries() { return db.entries.filter(isVisible); }
  function visibleChapters() {
    return (db.novel.chapters || [])
      .filter(ch => authorMode || (ch.visibility !== "author-only" && ch.status === "published"))
      .sort((a,b) => (Number(a.number)||0) - (Number(b.number)||0));
  }

  function childrenOf(parentId) {
    const parent = parentId || null;
    return visibleSections()
      .filter(s => {
        const primary = (s.parentId || null) === parent;
        if (parent === null) return primary;
        const secondary = Array.isArray(s.secondaryParentIds) && s.secondaryParentIds.includes(parent);
        return primary || secondary;
      })
      .sort((a,b) => (Number(a.sort)||0) - (Number(b.sort)||0) || String(a.name).localeCompare(String(b.name),"th"));
  }

  function rootOf(sectionId) {
    let current = sectionById(sectionId);
    const seen = new Set();
    while (current && current.parentId && !seen.has(current.id)) {
      seen.add(current.id);
      current = sectionById(current.parentId);
    }
    return current;
  }

  function descendantSectionIds(sectionId) {
    const ids = new Set([sectionId]);
    let changed = true;
    while (changed) {
      changed = false;
      for (const s of visibleSections()) {
        if (s.parentId && ids.has(s.parentId) && !ids.has(s.id)) {
          ids.add(s.id);
          changed = true;
        }
      }
    }
    return ids;
  }

  function entriesIn(sectionId, deep) {
    const ids = deep ? descendantSectionIds(sectionId) : new Set([sectionId]);
    return visibleEntries().filter(e => ids.has(e.sectionId));
  }

  function countUnder(sectionId) { return entriesIn(sectionId,true).length; }

  function ancestorChain(sectionId) {
    const chain = [];
    let current = sectionById(sectionId);
    const seen = new Set();
    while (current && !seen.has(current.id)) {
      chain.unshift(current);
      seen.add(current.id);
      current = current.parentId ? sectionById(current.parentId) : null;
    }
    return chain;
  }

  function assetFor(sectionOrKey) {
    let key = "";
    if (typeof sectionOrKey === "string") {
      const section = sectionById(sectionOrKey);
      key = section ? section.imageKey : sectionOrKey;
    } else if (sectionOrKey) key = sectionOrKey.imageKey;
    return db.project.assets[key] || db.project.assets.bangkokNight || {};
  }

  function styleBg(url) {
    return url ? "background-image:url('" + String(url).replace(/'/g,"%27") + "')" : "";
  }

  function toast(message,type) {
    const node = document.createElement("div");
    node.className = "toast " + (type || "");
    node.textContent = message;
    $("toastStack").appendChild(node);
    setTimeout(() => node.remove(),3600);
  }

  function setBusy(button,busy,label) {
    if (!button) return;
    if (busy) {
      button.dataset.oldLabel = button.textContent;
      button.textContent = label || "กำลังทำงาน…";
      button.disabled = true;
    } else {
      button.textContent = button.dataset.oldLabel || button.textContent;
      button.disabled = false;
    }
  }

  function updateVersion() {
    $("versionLabel").textContent = "ข้อมูลเวอร์ชัน " + (db.version || 1);
  }

  function updateTopbar(label) {
    $("topbarContext").textContent = label || "หน้าหลัก";
  }

  function route() {
    const raw = location.hash.replace(/^#/,"");
    if (!raw || raw === "home") return {type:"home"};
    if (raw === "novel") return {type:"novel"};
    if (raw === "all") return {type:"all"};
    const parts = raw.split("/");
    const type = parts.shift();
    const id = decodeURIComponent(parts.join("/"));
    if (type === "chapter" && chapterById(id)) return {type:type,id:id};
    if (type === "section" && sectionById(id)) return {type:type,id:id};
    if (type === "entry" && entryById(id)) return {type:type,id:id};
    return {type:"home"};
  }

  function saveRouteHistory() {
    sessionStorage.setItem("caelum_route_history",JSON.stringify(routeHistory.slice(-40)));
  }

  function navigate(type,id,options={}) {
    closeGlossaryPopover();
    if (readingScrollHandler) {
      window.removeEventListener("scroll",readingScrollHandler);
      readingScrollHandler = null;
    }
    let next = "#home";
    if (type === "novel") next = "#novel";
    else if (type === "all") next = "#all";
    else if (id) next = "#" + type + "/" + encodeURIComponent(id);

    const current = location.hash || "#home";
    if (!options.skipHistory && current !== next) {
      routeHistory.push(current);
      saveRouteHistory();
    }

    if (location.hash === next) renderAll();
    else location.hash = next;
    document.body.classList.remove("nav-open");
    window.scrollTo({top:0,behavior:"smooth"});
  }

  function goBack(fallbackType="all",fallbackId=null) {
    while (routeHistory.length) {
      const previous = routeHistory.pop();
      saveRouteHistory();
      if (previous && previous !== (location.hash || "#home")) {
        closeGlossaryPopover();
        location.hash = previous;
        document.body.classList.remove("nav-open");
        window.scrollTo({top:0,behavior:"smooth"});
        return;
      }
    }
    navigate(fallbackType,fallbackId,{skipHistory:true});
  }

  function pageBackHtml(fallbackType="all",fallbackId=null) {
    return '<button class="page-back" data-page-back type="button" data-fallback-type="' + esc(fallbackType) + '"' +
      (fallbackId ? ' data-fallback-id="' + esc(fallbackId) + '"' : '') +
      '><span aria-hidden="true">←</span><span>ย้อนกลับ</span></button>';
  }

  function bindPageBack() {
    content.querySelectorAll("[data-page-back]").forEach(btn => btn.addEventListener("click",() => {
      goBack(btn.dataset.fallbackType || "all",btn.dataset.fallbackId || null);
    }));
  }

  function clearExpandedSubtree(sectionId) {
    descendantSectionIds(sectionId).forEach(id => expandedNav.delete(id));
  }

  function openNavPath(sectionId) {
    const chain = ancestorChain(sectionId);
    chain.slice(0,-1).forEach(section => expandedNav.add(section.id));
  }

  const ROOT_GROUPS = [
    {id:"core",label:"โลกและระบบ",description:"กฎพื้นฐาน ประวัติศาสตร์ และคำสำคัญ"},
    {id:"institutions",label:"สถาบันและผู้คน",description:"องค์กร มหาวิทยาลัย และตัวละคร"},
    {id:"lived",label:"สังคมและชีวิต",description:"สถานที่ กฎหมาย เศรษฐกิจ การเมือง และเทคโนโลยี"},
    {id:"danger",label:"ภัยและเนื้อเรื่อง",description:"มอนสเตอร์ เหตุการณ์ และปมที่เปิดเผยแล้ว"},
    {id:"other",label:"หัวข้ออื่น",description:"ข้อมูลที่ยังไม่เข้ากลุ่มหลัก"}
  ];

  function groupedRootSections() {
    const roots = childrenOf(null);
    return ROOT_GROUPS.map(group => ({
      ...group,
      sections: roots.filter(section => (section.group || "other") === group.id)
    })).filter(group => group.sections.length);
  }

  function navSimple(type,icon,label,active) {
    return '<div class="nav-node-row"><button class="nav-toggle placeholder" tabindex="-1">+</button>' +
      '<button class="nav-btn' + (active ? ' active' : '') + '" data-nav-go="' + esc(type) + '">' +
      '<span class="nav-icon">' + esc(icon) + '</span><span class="nav-label">' + esc(label) + '</span></button></div>';
  }

  function navSectionNode(section,activeSection,depth) {
    const kids = childrenOf(section.id);
    const active = activeSection === section.id;
    const activeChain = activeSection ? ancestorChain(activeSection).map(s => s.id) : [];
    const inPath = !active && activeChain.includes(section.id);
    const open = expandedNav.has(section.id);
    let html = '<div class="nav-node"><div class="nav-node-row">';
    if (kids.length) html += '<button class="nav-toggle' + (open ? ' open' : '') + '" data-nav-toggle="' + esc(section.id) + '" type="button" aria-label="' + (open ? 'ยุบหมวด' : 'ขยายหมวด') + '">' + (open ? '⌄' : '›') + '</button>';
    else html += '<button class="nav-toggle placeholder" tabindex="-1">›</button>';
    html += '<button class="nav-btn nav-indent-' + Math.min(depth,3) + (active ? ' active' : '') + (inPath ? ' in-path' : '') + '" data-section-go="' + esc(section.id) + '">' +
      '<span class="nav-icon">' + esc(section.icon || "·") + '</span><span class="nav-label">' + esc(section.readerLabel || section.name) + '</span><span class="nav-count" title="' + (kids.length ? esc(kids.length + " หมวดย่อย") : esc(countUnder(section.id) + " รายการ")) + '">' + (kids.length ? esc(kids.length + " หมวด") : countUnder(section.id)) + '</span></button></div>';
    if (kids.length && open) html += '<div class="nav-children">' + kids.map(k => navSectionNode(k,activeSection,depth+1)).join("") + '</div>';
    html += '</div>';
    return html;
  }

  function renderNav() {
    const r = route();
    const activeSection = r.type === "section" ? r.id : r.type === "entry" ? (entryById(r.id) || {}).sectionId : null;
    if (activeSection) openNavPath(activeSection);
    localStorage.setItem("caelum_nav_open",JSON.stringify(Array.from(expandedNav)));

    let html = '<div class="nav-tree">';
    html += navSimple("home","⌂","หน้าหลัก",r.type === "home");
    html += navSimple("novel","◫","นิยาย",r.type === "novel" || r.type === "chapter");

    if (r.type === "novel" || r.type === "chapter") {
      const chapters = visibleChapters();
      let navChapters = chapters.slice(0,5);
      if (r.type === "chapter") {
        const currentIndex = chapters.findIndex(ch => ch.id === r.id);
        if (currentIndex >= 0) {
          const start = Math.max(0,Math.min(currentIndex-2,Math.max(0,chapters.length-5)));
          navChapters = chapters.slice(start,start+5);
        }
      }
      const chapterRows = navChapters.map(ch =>
        '<button class="nav-chapter-link' + (r.type === "chapter" && r.id === ch.id ? ' active' : '') + '" data-chapter-go="' + esc(ch.id) + '">' +
        '<span>ตอน ' + esc(ch.number) + '</span><b>' + esc(ch.title) + '</b></button>'
      ).join("");
      if (chapterRows) html += '<div class="nav-novel-chapters">' + chapterRows +
        (chapters.length > navChapters.length ? '<button class="nav-chapter-more" data-nav-go="novel" type="button">ดูสารบัญทั้งหมด · ' + chapters.length + ' ตอน</button>' : '') +
        '</div>';
    }

    html += navSimple("all","☰","คลังโลก",r.type === "all");
    groupedRootSections().forEach(group => {
      html += '<div class="nav-group-label">' + esc(group.label) + '</div>';
      group.sections.forEach(root => { html += navSectionNode(root,activeSection,0); });
    });
    html += '</div>';
    categoryNav.innerHTML = html;

    categoryNav.querySelectorAll("[data-nav-go]").forEach(btn => btn.addEventListener("click",() => navigate(btn.dataset.navGo)));
    categoryNav.querySelectorAll("[data-chapter-go]").forEach(btn => btn.addEventListener("click",() => navigate("chapter",btn.dataset.chapterGo)));
    categoryNav.querySelectorAll("[data-section-go]").forEach(btn => btn.addEventListener("click",() => {
      const id = btn.dataset.sectionGo;
      if (childrenOf(id).length) expandedNav.add(id);
      ancestorChain(id).slice(0,-1).forEach(section => expandedNav.add(section.id));
      localStorage.setItem("caelum_nav_open",JSON.stringify(Array.from(expandedNav)));
      navigate("section",id);
    }));
    categoryNav.querySelectorAll("[data-nav-toggle]").forEach(btn => btn.addEventListener("click",e => {
      e.stopPropagation();
      const id = btn.dataset.navToggle;
      const target = sectionById(id);
      if (!target) return;
      if (expandedNav.has(id)) {
        clearExpandedSubtree(id);
      } else {
        ancestorChain(id).slice(0,-1).forEach(section => expandedNav.add(section.id));
        expandedNav.add(id);
      }
      localStorage.setItem("caelum_nav_open",JSON.stringify(Array.from(expandedNav)));
      renderNav();
    }));
  }

  function authorStripHtml(sectionId) {
    if (!authorMode) return "";
    return '<div class="author-strip"><div class="author-strip-copy"><strong>Author Mode</strong><span>แก้ไขได้เฉพาะบัญชีเจ้าของ CaeLum และบันทึกลง GitHub โดยตรง</span></div>' +
      '<div class="author-tools"><button class="button secondary" data-author-action="chapter" type="button">+ ตอนนิยาย</button>' +
      '<button class="button secondary" data-author-action="section" data-section="' + esc(sectionId || "") + '" type="button">+ หมวด</button>' +
      '<button class="button primary" data-author-action="entry" data-section="' + esc(sectionId || "") + '" type="button">+ ข้อมูล</button>' +
      '<button class="button ghost" data-author-action="export" type="button">Export JSON</button><button class="button ghost" data-author-action="logout" type="button">ออกจากโหมด</button></div></div>';
  }

  function bindAuthorStrip() {
    content.querySelectorAll("[data-author-action]").forEach(btn => btn.addEventListener("click",() => {
      const action = btn.dataset.authorAction;
      if (action === "chapter") openChapterEditor(null);
      if (action === "section") openSectionEditor(null,btn.dataset.section || null);
      if (action === "entry") openEntryEditor(null,btn.dataset.section || null);
      if (action === "export") exportBackup();
      if (action === "logout") logoutAuthor();
    }));
  }

  function novelHomeSpotlightHtml() {
    const chapters = visibleChapters();
    if (!chapters.length) return "";
    const lastId = localStorage.getItem("caelum_last_chapter");
    const last = chapters.find(ch => ch.id === lastId) || chapters[0];
    const p = readProgressMap()[last.id] || 0;
    const buttonLabel = p > .05 && p < .96 ? "อ่านต่อ " + Math.round(p*100) + "%" : "เริ่มอ่านนิยาย";
    return '<section class="novel-spotlight"><div class="novel-spotlight-copy"><span class="novel-label">นิยาย CaeLum</span><h2>' + esc(db.novel.title || "CaeLum") + '</h2>' +
      '<p>' + esc(db.novel.description || "") + '</p><div class="novel-spotlight-actions"><button class="button novel-primary" data-home-chapter="' + esc(last.id) + '" type="button">' + esc(buttonLabel) + '</button>' +
      '<button class="button novel-secondary" data-home-novel type="button">ดูสารบัญนิยาย</button></div></div>' +
      '<div class="novel-spotlight-meta"><span>ตอนที่เปิดอ่าน</span><strong>' + chapters.length + '</strong><small>ตอนล่าสุด · ' + esc(chapters[chapters.length-1].title) + '</small></div></section>';
  }

  function bindHomeNovelSpotlight() {
    const a = content.querySelector("[data-home-chapter]");
    const b = content.querySelector("[data-home-novel]");
    if (a) a.addEventListener("click",() => navigate("chapter",a.dataset.homeChapter));
    if (b) b.addEventListener("click",() => navigate("novel"));
  }

  function sectionCardHtml(section) {
    const asset = assetFor(section);
    const kids = childrenOf(section.id);
    const childPreview = kids.length
      ? '<div class="topic-card-children">' + kids.slice(0,5).map(k => '<button data-section-jump="' + esc(k.id) + '" type="button">' + esc(k.readerLabel || k.name) + '</button>').join("") +
        (kids.length > 5 ? '<span>+' + (kids.length-5) + '</span>' : '') + '</div>'
      : "";
    return '<article class="topic-card' + (kids.length ? ' has-children' : '') + '" data-section-card="' + esc(section.id) + '"><div class="topic-card-image" style="' + styleBg(asset.url) + '"></div><div class="topic-card-copy"><span>' + esc(section.icon || "·") + '</span><h3>' + esc(section.readerLabel || section.name) + '</h3><p>' + esc(section.description || "") + '</p>' + childPreview + '<small>' + countUnder(section.id) + ' รายการ' + (kids.length ? ' · ' + kids.length + ' หมวดย่อย' : '') + '</small></div></article>';
  }

  function bindSectionCards() {
    content.querySelectorAll("[data-section-card]").forEach(card => card.addEventListener("click",() => navigate("section",card.dataset.sectionCard)));
    content.querySelectorAll("[data-section-jump]").forEach(btn => btn.addEventListener("click",event => {
      event.stopPropagation();
      navigate("section",btn.dataset.sectionJump);
    }));
  }

  function subsectionChoiceHtml(section,index) {
    const count=entriesIn(section.id,false).length;
    const number=String(index+1).padStart(2,"0");
    return '<button class="section-choice" data-section-jump="' + esc(section.id) + '" type="button">' +
      '<span class="section-choice-no">' + number + '</span>' +
      '<span class="section-choice-copy"><strong>' + esc(section.readerLabel || section.name) + '</strong><span>' + esc(section.description || "") + '</span></span>' +
      '<span class="section-choice-meta">' + count + ' เรื่อง</span>' +
      '<span class="section-choice-arrow" aria-hidden="true">→</span>' +
    '</button>';
  }

  function formatCharacterAge(value) {
    const v=String(value||"").trim();
    if(!v) return "";
    return /^\d+(?:\s*[–-]\s*\d+)?$/.test(v) ? v + " ปี" : v;
  }

  function characterDisplayName(entry) {
    const c=(entry&&entry.character)||{};
    return String(c.thaiName||entry.title||"").trim();
  }

  function characterEnglishName(entry) {
    const c=(entry&&entry.character)||{};
    return c.thaiName && entry.title && c.thaiName!==entry.title ? entry.title : "";
  }

  function characterQuickMeta(entry) {
    if(!isCharacterSection(entry.sectionId)) return "";
    const c=entry.character||{};
    const items=[c.gender,formatCharacterAge(c.age),c.origin,c.affiliation].filter(Boolean);
    if(!items.length) return "";
    return '<div class="entry-character-meta">' + items.map(x=>'<span>' + esc(x) + '</span>').join("") + '</div>';
  }

  function entryCardHtml(entry) {
    const character=isCharacterSection(entry.sectionId);
    const displayName=character?characterDisplayName(entry):entry.title;
    const englishName=character?characterEnglishName(entry):"";
    return '<article class="entry-card' + (character?' character-entry-card':'') + '" data-entry-card="' + esc(entry.id) + '"><div><span class="entry-section">' + esc((sectionById(entry.sectionId) || {}).readerLabel || (sectionById(entry.sectionId) || {}).name || "CaeLum") + '</span><h3>' + esc(displayName) + '</h3>' + (englishName?'<span class="character-card-english-name">'+esc(englishName)+'</span>':'') + characterQuickMeta(entry) + '<p>' + esc(entry.summary || "") + '</p></div><span class="entry-arrow">→</span></article>';
  }

  function renderHome() {
    const hero = db.project.assets.bangkokNight || {};
    const starts = ["overview","magic","caelum","law","society","technology"].map(sectionById).filter(Boolean).filter(isVisible);
    content.innerHTML =
      '<section class="hero-cover compact-hero"><div class="cover-image" style="' + styleBg(hero.url) + '"></div><div class="hero-cover-content"><p class="eyebrow">CAE LUM · นิยายและคลังโลก</p><h1>CaeLum</h1><p class="lead">' + esc(db.project.readerIntro || "") + '</p></div></section>' +
      authorStripHtml() + novelHomeSpotlightHtml() +
      '<div class="section-heading"><div><h2>สำรวจโลก CaeLum</h2><p>เลือกอ่านเฉพาะเรื่องที่สนใจได้ทันที ไม่จำเป็นต้องไล่ตามลำดับ</p></div><button class="button secondary" data-open-wiki type="button">ดูคลังทั้งหมด</button></div>' +
      '<section class="path-grid">' + starts.map(sectionCardHtml).join("") + '</section>';
    bindSectionCards();
    const all = content.querySelector("[data-open-wiki]");
    if (all) all.addEventListener("click",() => navigate("all"));
    bindAuthorStrip();
    bindHomeNovelSpotlight();
    updateTopbar("หน้าหลัก");
  }

  function readProgressMap() {
    try {
      const obj = JSON.parse(localStorage.getItem("caelum_chapter_progress") || "{}");
      return obj && typeof obj === "object" ? obj : {};
    } catch {
      return {};
    }
  }

  function writeChapterProgress(id,ratio) {
    const map = readProgressMap();
    map[id] = Math.max(0,Math.min(1,Number(ratio)||0));
    localStorage.setItem("caelum_chapter_progress",JSON.stringify(map));
    localStorage.setItem("caelum_last_chapter",id);
  }

  function getReadingPrefs() {
    try {
      const x = JSON.parse(localStorage.getItem("caelum_reading_prefs") || "{}");
      return {
        size:Math.max(16,Math.min(25,Number(x.size)||19)),
        line:[1.72,1.86,2].includes(Number(x.line)) ? Number(x.line) : 1.86,
        theme:["paper","sepia","night"].includes(x.theme) ? x.theme : "paper",
        width:x.width === "wide" ? "wide" : "normal"
      };
    } catch {
      return {size:19,line:1.86,theme:"paper",width:"normal"};
    }
  }

  function setReadingPrefs(p) {
    localStorage.setItem("caelum_reading_prefs",JSON.stringify(p));
    const reader = content.querySelector(".novel-reader");
    if (!reader) return;
    reader.style.setProperty("--novel-font-size",p.size + "px");
    reader.style.setProperty("--novel-line-height",p.line);
    reader.dataset.theme = p.theme;
    reader.classList.toggle("novel-wide",p.width === "wide");
    const t = reader.querySelector("[data-reader-theme]");
    if (t) t.textContent = p.theme === "paper" ? "กระดาษ" : p.theme === "sepia" ? "ซีเปีย" : "กลางคืน";
    const w = reader.querySelector("[data-reader-width]");
    if (w) w.textContent = p.width === "wide" ? "แคบ" : "กว้าง";
  }

  function estimateReadMinutes(body) {
    return Math.max(1,Math.ceil(String(body || "").replace(/\s+/g,"").length/650));
  }

  function glossaryEntries() {
    return visibleEntries().filter(e => e.sectionId === "glossary");
  }

  function glossaryLinkedNovelText(raw,used) {
    const source = String(raw || "");
    const lower = source.toLocaleLowerCase("en");
    const candidates = [];
    glossaryEntries().forEach(entry => {
      if (used.has(entry.id)) return;
      const aliases = Array.isArray(entry.glossaryTerms) && entry.glossaryTerms.length ? entry.glossaryTerms : [entry.title];
      let best = null;
      aliases.forEach(v => {
        const alias = String(v || "").trim();
        if (!alias) return;
        const index = lower.indexOf(alias.toLocaleLowerCase("en"));
        if (index < 0) return;
        if (!best || index < best.index || (index === best.index && alias.length > best.length)) best = {index:index,length:alias.length,entryId:entry.id};
      });
      if (best) candidates.push(best);
    });
    candidates.sort((a,b) => a.index-b.index || b.length-a.length);
    const chosen = [];
    let end = -1;
    candidates.forEach(m => {
      if (m.index < end) return;
      chosen.push(m);
      end = m.index + m.length;
      used.add(m.entryId);
    });
    if (!chosen.length) return esc(source);
    let out = "", cursor = 0;
    chosen.forEach(m => {
      out += esc(source.slice(cursor,m.index));
      const label = source.slice(m.index,m.index+m.length);
      out += '<button class="novel-glossary-term" data-novel-glossary="' + esc(m.entryId) + '" type="button">' + esc(label) + '</button>';
      cursor = m.index + m.length;
    });
    out += esc(source.slice(cursor));
    return out;
  }

  function novelProseHtml(body) {
    const used = new Set();
    return String(body || "").replace(/\r\n|\r/g,"\n").split(/\n\s*\n/).map(x => x.trim()).filter(Boolean).map(block => {
      if (block === "---") return '<div class="novel-scene-break" aria-hidden="true">◆</div>';
      return '<p>' + glossaryLinkedNovelText(block,used).replace(/\n/g,"<br>") + '</p>';
    }).join("");
  }

  function closeGlossaryPopover() {
    if (glossaryPopover) glossaryPopover.remove();
    glossaryPopover = null;
  }

  function showGlossaryPopover(button,entry) {
    closeGlossaryPopover();
    const pop = document.createElement("div");
    pop.className = "novel-glossary-popover";
    pop.setAttribute("role","dialog");
    pop.setAttribute("aria-label","คำอธิบาย " + String(entry.title || ""));
    pop.innerHTML = '<button class="popover-close" type="button" aria-label="ปิด">×</button><span class="popover-label">คำจากโลก CaeLum</span><strong>' + esc(entry.title) + '</strong><p>' + esc(entry.summary || entry.details || "") + '</p><button class="popover-wiki-link" type="button"><span>ดูข้อมูลเพิ่มเติม</span><span aria-hidden="true">→</span></button>';
    document.body.appendChild(pop);
    glossaryPopover = pop;
    const rect = button.getBoundingClientRect();
    const width = Math.min(430,window.innerWidth-32);
    pop.style.width = width + "px";
    pop.style.left = Math.min(window.innerWidth-width-12,Math.max(12,rect.left+rect.width/2-width/2)) + "px";
    let top = rect.bottom + 10;
    if (top + 300 > window.innerHeight) top = Math.max(12,rect.top-300);
    pop.style.top = top + "px";
    pop.querySelector(".popover-close").addEventListener("click",closeGlossaryPopover);
    pop.querySelector(".popover-wiki-link").addEventListener("click",() => { closeGlossaryPopover(); navigate("entry",entry.id); });
  }

  function bindNovelGlossary() {
    content.querySelectorAll("[data-novel-glossary]").forEach(btn => btn.addEventListener("click",e => {
      e.stopPropagation();
      const entry = entryById(btn.dataset.novelGlossary);
      if (entry) showGlossaryPopover(btn,entry);
    }));
  }


  function openNovelMap() {
    const existing = document.querySelector(".map-dialog");
    if (existing) existing.remove();

    const dialog = document.createElement("dialog");
    dialog.className = "map-dialog";
    dialog.setAttribute("aria-label","แผนที่บริเวณรอบ CaeLum");
    dialog.innerHTML =
      '<div class="map-dialog-shell">' +
        '<header class="map-dialog-bar"><div><span>แผนที่ประกอบเรื่อง</span><strong>บริเวณรอบ CaeLum</strong></div><button class="map-dialog-close" type="button" aria-label="ปิดแผนที่">×</button></header>' +
        '<div class="map-dialog-body"><img src="assets/caelum-bang-bua-map.svg" alt="ผังตำแหน่ง CaeLum สถานีบางบัว ถนน และประตูหลัก"></div>' +
      '</div>';

    document.body.appendChild(dialog);
    dialog.querySelector(".map-dialog-close").addEventListener("click",() => dialog.close());
    dialog.addEventListener("click",event => {
      const rect = dialog.getBoundingClientRect();
      const inside = event.clientX >= rect.left && event.clientX <= rect.right && event.clientY >= rect.top && event.clientY <= rect.bottom;
      if (!inside) dialog.close();
    });
    dialog.addEventListener("close",() => dialog.remove(),{once:true});
    dialog.showModal();
  }

  function renderNovelHome() {
    const chapters = visibleChapters();
    const cover = db.project.assets[db.novel.coverAssetKey] || db.project.assets.gothicCampus || {};
    const lastId = localStorage.getItem("caelum_last_chapter");
    const progress = readProgressMap();
    content.innerHTML =
      '<section class="novel-library-hero"><div class="novel-library-cover" style="' + styleBg(cover.url) + '"></div><div class="novel-library-hero-copy"><span class="novel-label">นิยาย</span><h1>' + esc(db.novel.title || "CaeLum") + '</h1><p>' + esc(db.novel.description || "") + '</p>' +
      (chapters.length ? '<button class="button novel-primary" data-open-first type="button">' + (lastId && chapterById(lastId) ? 'อ่านต่อ' : 'เริ่มอ่าน') + '</button>' : '') + '</div></section>' +
      authorStripHtml() +
      '<div class="reader-heading novel-heading"><div><h2>สารบัญนิยาย</h2><p>' + chapters.length + ' ตอนที่เปิดให้อ่าน</p></div>' + (authorMode ? '<button class="button primary" data-add-chapter type="button">+ เพิ่มตอน</button>' : '') + '</div>' +
      '<section class="novel-map-feature" aria-label="แผนที่ CaeLum ก่อนเริ่มตอนที่ 1">' +
        '<div class="novel-map-copy"><span class="novel-map-kicker">แผนที่ประกอบเรื่อง</span><h3>บริเวณรอบ CaeLum</h3><p>ผังคร่าว ๆ ของพื้นที่โดยรอบมหาวิทยาลัยและทางเข้าหลัก สำหรับใช้อ้างอิงตำแหน่งระหว่างอ่านเรื่อง</p><div class="novel-map-meta"><span>ทางเข้าหลัก</span><span>พื้นที่โดยรอบ</span><span>ไม่ใช่มาตราส่วนจริง</span></div><button class="button novel-map-button" data-open-map type="button">เปิดแผนที่เต็ม <span aria-hidden="true">↗</span></button></div>' +
        '<button class="novel-map-preview" data-open-map type="button" aria-label="เปิดแผนที่บริเวณรอบ CaeLum แบบเต็มจอ"><img src="assets/caelum-bang-bua-map.svg" alt="ผังบริเวณรอบ CaeLum" loading="eager"><span class="novel-map-zoom">ดูแผนที่เต็ม</span></button>' +
      '</section>' +
      '<section class="chapter-list">' + (chapters.length ? chapters.map(ch => {
        const p = progress[ch.id] || 0;
        return '<article class="chapter-card" data-open-chapter="' + esc(ch.id) + '"><div class="chapter-no">ตอน ' + esc(ch.number) + '</div><div class="chapter-card-copy"><h3>' + esc(ch.title) + '</h3>' +
          (ch.subtitle ? '<span>' + esc(ch.subtitle) + '</span>' : '') + '<p>' + esc(ch.summary || "") + '</p><div class="chapter-card-meta"><span>≈ ' + estimateReadMinutes(ch.body) + ' นาที</span>' +
          (p > .02 ? '<span>อ่านแล้ว ' + Math.round(p*100) + '%</span>' : '') + (authorMode ? '<span>' + esc(ch.status || "draft") + '</span>' : '') + '</div></div><span class="chapter-arrow">→</span></article>';
      }).join("") : '<div class="empty-state">ยังไม่มีตอนที่เผยแพร่</div>') + '</section>';

    const first = content.querySelector("[data-open-first]");
    if (first) first.addEventListener("click",() => {
      const target = chapters.find(ch => ch.id === lastId) || chapters[0];
      if (target) navigate("chapter",target.id);
    });
    content.querySelectorAll("[data-open-chapter]").forEach(card => card.addEventListener("click",() => navigate("chapter",card.dataset.openChapter)));
    content.querySelectorAll("[data-open-map]").forEach(button => button.addEventListener("click",openNovelMap));
    const add = content.querySelector("[data-add-chapter]");
    if (add) add.addEventListener("click",() => openChapterEditor(null));
    bindAuthorStrip();
    updateTopbar("นิยาย");
  }

  function chapterBottomNav(chapter,chapters) {
    const i = chapters.findIndex(ch => ch.id === chapter.id);
    const prev = i > 0 ? chapters[i-1] : null;
    const next = i >= 0 && i < chapters.length-1 ? chapters[i+1] : null;
    return '<nav class="chapter-bottom-nav">' +
      (prev ? '<button class="chapter-nav-side prev" data-chapter-nav="' + esc(prev.id) + '" type="button"><small>← ตอนก่อนหน้า</small><b>' + esc(prev.title) + '</b></button>' : '<span></span>') +
      '<button class="chapter-nav-toc" data-back-toc type="button">สารบัญ</button>' +
      (next ? '<button class="chapter-nav-side next" data-chapter-nav="' + esc(next.id) + '" type="button"><small>ตอนถัดไป →</small><b>' + esc(next.title) + '</b></button>' : '<span></span>') + '</nav>';
  }

  function renderChapter(id) {
    const chapter = chapterById(id);
    if (!chapter || !(authorMode || (chapter.visibility !== "author-only" && chapter.status === "published"))) return navigate("novel");
    const chapters = visibleChapters();
    const prefs = getReadingPrefs();
    const saved = readProgressMap()[id] || 0;
    const index = chapters.findIndex(ch => ch.id === id);
    const prev = index > 0 ? chapters[index-1] : null;
    const next = index >= 0 && index < chapters.length-1 ? chapters[index+1] : null;
    localStorage.setItem("caelum_last_chapter",id);

    content.innerHTML =
      '<div class="reading-progress-track"><span id="readingProgressBar"></span></div>' +
      '<article class="novel-reader' + (prefs.width === "wide" ? ' novel-wide' : '') + '" data-theme="' + esc(prefs.theme) + '" style="--novel-font-size:' + prefs.size + 'px;--novel-line-height:' + prefs.line + '">' +
      '<div class="novel-reader-toolbar"><button class="reader-menu-toggle" data-reader-menu-toggle type="button" aria-expanded="false">Aa <span>การอ่าน</span></button><div class="reader-tools-panel" id="readerToolsPanel"><button class="reader-tool" data-back-toc type="button">☰ <span>สารบัญ</span></button>' +
      '<label class="chapter-select-wrap"><span>ตอน</span><select data-chapter-select>' + chapters.map(ch => '<option value="' + esc(ch.id) + '"' + (ch.id===id ? ' selected' : '') + '>' + esc(ch.number) + ' · ' + esc(ch.title) + '</option>').join("") + '</select></label>' +
      '<div class="reader-tools-right"><button class="reader-tool compact" data-font-down type="button">A−</button><button class="reader-tool compact" data-font-up type="button">A+</button><button class="reader-tool" data-reader-line type="button">ระยะบรรทัด</button><button class="reader-tool" data-reader-width type="button">' + (prefs.width === "wide" ? 'แคบ' : 'กว้าง') + '</button><button class="reader-tool" data-reader-theme type="button">' + (prefs.theme === "paper" ? 'กระดาษ' : prefs.theme === "sepia" ? 'ซีเปีย' : 'กลางคืน') + '</button><button class="reader-tool" data-share-chapter type="button">แชร์</button></div></div></div>' +
      '<header class="novel-chapter-head"><span class="novel-label">CAE LUM · ตอนที่ ' + esc(chapter.number) + '</span><h1>' + esc(chapter.title) + '</h1>' +
      (chapter.subtitle ? '<p class="chapter-subtitle">' + esc(chapter.subtitle) + '</p>' : '') + '<div class="chapter-reading-meta"><span>ประมาณ ' + estimateReadMinutes(chapter.body) + ' นาที</span><span>ตอน ' + (index+1) + ' จาก ' + chapters.length + '</span>' + (authorMode ? '<span>' + esc(chapter.status) + '</span>' : '') + '</div>' +
      (saved > .06 && saved < .94 ? '<button class="resume-reading" data-resume-reading type="button">อ่านต่อจาก ' + Math.round(saved*100) + '% ↓</button>' : '') + '</header>' +
      '<section class="novel-prose" id="novelProse">' + novelProseHtml(chapter.body) + '</section>' +
      (authorMode ? '<div class="reader-edit-row"><button class="button primary" data-edit-chapter type="button">แก้ไขตอนนี้</button></div>' : '') + chapterBottomNav(chapter,chapters) + '</article>' +
      '<div class="mobile-chapter-nav">' + (prev ? '<button data-chapter-nav="' + esc(prev.id) + '" type="button">←</button>' : '<span></span>') + '<button data-back-toc type="button">ตอน ' + esc(chapter.number) + '</button>' + (next ? '<button data-chapter-nav="' + esc(next.id) + '" type="button">→</button>' : '<span></span>') + '</div>';

    bindNovelGlossary();
    const menuToggle = content.querySelector("[data-reader-menu-toggle]");
    const readerToolsPanel = content.querySelector(".reader-tools-panel");
    let readerMenuOpenedAt = window.scrollY;
    const closeReaderMenu = () => {
      if (!menuToggle || !readerToolsPanel) return;
      menuToggle.setAttribute("aria-expanded","false");
      readerToolsPanel.classList.remove("is-open");
    };
    if (menuToggle && readerToolsPanel) {
      menuToggle.addEventListener("click",() => {
        const isOpen = readerToolsPanel.classList.toggle("is-open");
        menuToggle.setAttribute("aria-expanded",String(isOpen));
        if (isOpen) readerMenuOpenedAt = window.scrollY;
      });
    }
    content.querySelectorAll("[data-back-toc]").forEach(btn => btn.addEventListener("click",() => navigate("novel")));
    content.querySelectorAll("[data-chapter-nav]").forEach(btn => btn.addEventListener("click",() => navigate("chapter",btn.dataset.chapterNav)));
    const chooser = content.querySelector("[data-chapter-select]");
    if (chooser) chooser.addEventListener("change",e => navigate("chapter",e.target.value));
    const edit = content.querySelector("[data-edit-chapter]");
    if (edit) edit.addEventListener("click",() => openChapterEditor(id));

    function changePrefs(fn) {
      const p = getReadingPrefs();
      fn(p);
      setReadingPrefs(p);
    }
    content.querySelector("[data-font-down]").addEventListener("click",() => changePrefs(p => p.size=Math.max(16,p.size-1)));
    content.querySelector("[data-font-up]").addEventListener("click",() => changePrefs(p => p.size=Math.min(25,p.size+1)));
    content.querySelector("[data-reader-line]").addEventListener("click",() => changePrefs(p => p.line=p.line===1.72?1.86:p.line===1.86?2:1.72));
    content.querySelector("[data-reader-width]").addEventListener("click",() => changePrefs(p => p.width=p.width==="wide"?"normal":"wide"));
    content.querySelector("[data-reader-theme]").addEventListener("click",() => changePrefs(p => p.theme=p.theme==="paper"?"sepia":p.theme==="sepia"?"night":"paper"));
    content.querySelector("[data-share-chapter]").addEventListener("click",async () => {
      try {
        const data={title:(db.novel.title||"CaeLum")+" — ตอน "+chapter.number,text:chapter.title,url:location.href};
        if (navigator.share) await navigator.share(data);
        else { await navigator.clipboard.writeText(location.href); toast("คัดลอกลิงก์ตอนแล้ว","success"); }
      } catch {}
    });

    const prose = $("novelProse");
    const resume = content.querySelector("[data-resume-reading]");
    if (resume) resume.addEventListener("click",() => {
      const max=Math.max(1,prose.offsetHeight-window.innerHeight*.55);
      window.scrollTo({top:prose.offsetTop+saved*max,behavior:"smooth"});
    });

    const updateProgress = () => {
      if (readerToolsPanel?.classList.contains("is-open") && Math.abs(window.scrollY-readerMenuOpenedAt)>36) closeReaderMenu();
      const start=prose.offsetTop-90;
      const max=Math.max(1,prose.offsetHeight-window.innerHeight*.55);
      const ratio=Math.max(0,Math.min(1,(window.scrollY-start)/max));
      const bar=$("readingProgressBar");
      if (bar) bar.style.width=(ratio*100).toFixed(1)+"%";
      writeChapterProgress(id,ratio);
    };
    readingScrollHandler=updateProgress;
    window.addEventListener("scroll",readingScrollHandler,{passive:true});
    requestAnimationFrame(updateProgress);
    updateTopbar("ตอน " + chapter.number + " · " + chapter.title);
  }

  function breadcrumbsHtml(sectionId) {
    let html='<button data-crumb-home type="button">คลังโลก</button>';
    ancestorChain(sectionId).forEach(s => {
      html+='<span class="sep">/</span><button data-crumb-section="' + esc(s.id) + '" type="button">' + esc(s.readerLabel || s.name) + '</button>';
    });
    return html;
  }

  function bindBreadcrumbs() {
    content.querySelectorAll("[data-crumb-home]").forEach(btn => btn.addEventListener("click",() => navigate("all")));
    content.querySelectorAll("[data-crumb-section]").forEach(btn => btn.addEventListener("click",() => navigate("section",btn.dataset.crumbSection)));
  }

  function proseHtml(value,currentEntryId) {
    const raw=String(value || "").replace(/\\r\\n|\\n|\\r/g,"\n");
    return raw.split(/\n\s*\n/).map(x=>x.trim()).filter(Boolean).map(block => '<p>' + wikiGlossaryHtml(block,currentEntryId) + '</p>').join("");
  }

  function wikiGlossaryHtml(raw,currentEntryId) {
    const lower=String(raw).toLocaleLowerCase("en");
    let best=null;
    glossaryEntries().forEach(entry => {
      if (entry.id===currentEntryId) return;
      const aliases=entry.glossaryTerms && entry.glossaryTerms.length ? entry.glossaryTerms : [entry.title];
      aliases.forEach(v => {
        const alias=String(v || "").trim();
        const i=lower.indexOf(alias.toLocaleLowerCase("en"));
        if (i>=0 && (!best || i<best.index || (i===best.index && alias.length>best.length))) best={index:i,length:alias.length,id:entry.id};
      });
    });
    if (!best) return esc(raw).replace(/\n/g,"<br>");
    return esc(raw.slice(0,best.index)) + '<button class="glossary-term" data-wiki-glossary="' + esc(best.id) + '" type="button">' + esc(raw.slice(best.index,best.index+best.length)) + '</button>' + esc(raw.slice(best.index+best.length)).replace(/\n/g,"<br>");
  }

  function renderSection(id) {
    const section=sectionById(id);
    if (!section || !isVisible(section)) return navigate("all");
    const asset=assetFor(section);
    const kids=childrenOf(id);
    const entries=entriesIn(id,false).sort((a,b)=>String(a.title).localeCompare(String(b.title),"th"));

    if (kids.length) {
      content.innerHTML =
        '<section class="section-landing">' +
          '<div class="section-page-nav">' + pageBackHtml(section.parentId ? "section" : "all",section.parentId || null) + '<div class="breadcrumbs section-landing-breadcrumbs">' + breadcrumbsHtml(id) + '</div></div>' +
          '<div class="section-landing-copy"><p class="eyebrow">หมวดข้อมูล</p><h1>' + esc(section.readerLabel || section.name) + '</h1><p>' + esc(section.description || "") + '</p></div>' +
          '<div class="section-choice-head"><div><h2>เลือกหัวข้อ</h2><p>เลือกเรื่องที่ต้องการอ่านต่อจากด้านล่าง</p></div><span>' + kids.length + ' หัวข้อ</span></div>' +
          '<div class="section-choice-list">' + kids.map(subsectionChoiceHtml).join("") + '</div>' +
          (entries.length ? '<div class="section-direct"><div class="section-choice-head compact"><div><h2>ข้อมูลทั่วไป</h2><p>ข้อมูลที่อยู่ในหมวดนี้โดยตรง</p></div><span>' + entries.length + ' เรื่อง</span></div><section class="library-list">' + entries.map(entryCardHtml).join("") + '</section></div>' : '') +
          (authorMode ? '<div class="section-actions section-landing-actions"><button class="button secondary" data-edit-section type="button">แก้หมวดนี้</button></div>' : '') +
        '</section>';
    } else {
      content.innerHTML =
        '<div class="section-page-nav standalone">' + pageBackHtml(section.parentId ? "section" : "all",section.parentId || null) + '<div class="breadcrumbs">' + breadcrumbsHtml(id) + '</div></div>' +
        '<section class="section-hero simple-section-hero"><div class="section-hero-bg" style="' + styleBg(asset.url) + '"></div><div class="section-hero-content"><h1>' + esc(section.readerLabel || section.name) + '</h1><p>' + esc(section.description || "") + '</p>' +
        (authorMode ? '<div class="section-actions"><button class="button secondary" data-edit-section type="button">แก้หมวดนี้</button></div>' : '') + '</div></section>' +
        authorStripHtml(id) +
        (entries.length ? '<div class="reader-heading"><div><h2>ข้อมูลในหมวดนี้</h2><p>' + entries.length + ' รายการ</p></div></div><section class="library-list">' + entries.map(entryCardHtml).join("") + '</section>' : '') +
        (!entries.length ? '<div class="empty-state">หมวดนี้ยังไม่มีข้อมูล</div>' : '');
    }

    bindBreadcrumbs();
    bindPageBack();
    bindAuthorStrip();
    content.querySelectorAll("[data-section-jump]").forEach(btn => btn.addEventListener("click",() => navigate("section",btn.dataset.sectionJump)));
    content.querySelectorAll("[data-entry-card]").forEach(card => card.addEventListener("click",() => navigate("entry",card.dataset.entryCard)));
    const edit=content.querySelector("[data-edit-section]");
    if(edit) edit.addEventListener("click",() => openSectionEditor(id));
    updateTopbar(section.readerLabel || section.name);
  }

  function relationTarget(value) {
    return entryById(value) || visibleEntries().find(e => e.title===value) || sectionById(value) || visibleSections().find(s => s.name===value || s.readerLabel===value);
  }

  function characterFact(label,value) {
    const raw=String(value||"").trim();
    const display=label==="อายุ" ? formatCharacterAge(raw) : raw;
    const empty=!display;
    return '<div class="character-fact' + (empty?' is-empty':'') + '"><span>' + esc(label) + '</span><strong>' + esc(display||"—") + '</strong></div>';
  }

  function characterSectionHtml(title,value,entryId) {
    if(!value) return "";
    return '<section class="character-profile-section"><h2>' + esc(title) + '</h2><div>' + proseHtml(value,entryId) + '</div></section>';
  }

  function characterEntryHtml(entry,section,related) {
    const c=entry.character||{};
    const displayName=characterDisplayName(entry);
    const englishName=characterEnglishName(entry);
    const initial=(displayName||entry.title||"?").trim().slice(0,1).toUpperCase();
    const portrait=c.portrait
      ? '<figure class="character-portrait has-image"><img src="' + esc(c.portrait) + '" alt="ภาพตัวละคร ' + esc(displayName) + '" loading="eager"></figure>'
      : '<div class="character-portrait character-portrait-empty" aria-hidden="true"><span>' + esc(initial) + '</span></div>';

    const facts=[
      characterFact("เพศ",c.gender),
      characterFact("อายุ",c.age),
      c.origin ? characterFact("ถิ่นที่มา",c.origin) : "",
      characterFact("สังกัด / สถานะ",c.affiliation),
      c.handedness ? characterFact("มือข้างถนัด",c.handedness) : "",
      c.firstAppearance ? characterFact("ปรากฏตัวครั้งแรก",c.firstAppearance) : ""
    ].join("");

    const lifestyleItems=[
      c.hobbies ? ["งานอดิเรก",c.hobbies] : null,
      c.favoriteMusic ? ["เพลง / แนวเพลงที่ชอบ",c.favoriteMusic] : null,
      c.favoriteFood ? ["อาหารที่ชอบ",c.favoriteFood] : null,
      c.likes ? ["สิ่งที่ชอบ",c.likes] : null,
      c.dislikes ? ["สิ่งที่ไม่ชอบ",c.dislikes] : null,
      c.habits ? ["นิสัยเล็ก ๆ",c.habits] : null
    ].filter(Boolean);

    const lifestyle=lifestyleItems.length
      ? '<section class="character-about-card character-lifestyle-card"><span class="character-info-kicker">Daily life</span><h2>ชีวิตประจำวันและความชอบ</h2><div class="character-lifestyle-grid">' +
        lifestyleItems.map(item=>'<div class="character-lifestyle-item"><span>'+esc(item[0])+'</span><strong>'+esc(item[1])+'</strong></div>').join("") +
        '</div></section>'
      : '';

    const cards=[
      c.personality ? '<section class="character-info-card"><span class="character-info-kicker">Personality</span><h2>บุคลิก</h2><div>' + proseHtml(c.personality,entry.id) + '</div></section>' : '',
      c.background ? '<section class="character-info-card"><span class="character-info-kicker">Background</span><h2>พื้นหลัง</h2><div>' + proseHtml(c.background,entry.id) + '</div></section>' : '',
      c.appearance ? '<section class="character-info-card"><span class="character-info-kicker">Appearance</span><h2>ลักษณะภายนอก</h2><div>' + proseHtml(c.appearance,entry.id) + '</div></section>' : '',
      c.abilities ? '<section class="character-info-card"><span class="character-info-kicker">Abilities</span><h2>เวทมนตร์และความสามารถ</h2><div>' + proseHtml(c.abilities,entry.id) + '</div></section>' : '',
      c.relationships ? '<section class="character-info-card"><span class="character-info-kicker">Relations</span><h2>ความสัมพันธ์</h2><div>' + proseHtml(c.relationships,entry.id) + '</div></section>' : ''
    ].filter(Boolean).join("");

    return '<div class="section-page-nav character-page-nav">' + pageBackHtml("section",entry.sectionId) +
      '<div class="breadcrumbs article-breadcrumbs">' + breadcrumbsHtml(entry.sectionId) + '<span class="sep">/</span><span>' + esc(displayName) + '</span></div></div>' +
      authorStripHtml(entry.sectionId) +
      '<article class="character-page">' +
        '<header class="character-profile-hero">' +
          '<div class="character-visual">' + portrait + '</div>' +
          '<div class="character-profile-intro">' +
            '<p class="reader-category">' + esc(section ? section.readerLabel || section.name : "ตัวละคร") + '</p>' +
            (entry.kicker ? '<p class="reader-kicker">' + esc(entry.kicker) + '</p>' : '') +
            '<h1>' + esc(displayName) + '</h1>' +
            (englishName ? '<p class="character-english-name">' + esc(englishName) + '</p>' : '') +
            (c.role ? '<p class="character-role">' + esc(c.role) + '</p>' : '') +
            (entry.summary ? '<p class="reader-lead">' + esc(entry.summary) + '</p>' : '') +
            '<section class="character-basics"><div class="character-basics-head"><span>ข้อมูลพื้นฐาน</span><small>ข้อมูลที่เปิดเผยในปัจจุบัน</small></div><div class="character-facts">' + facts + '</div></section>' +
          '</div>' +
        '</header>' +
        (entry.details ? '<section class="character-about-card"><span class="character-info-kicker">Profile</span><h2>เกี่ยวกับตัวละคร</h2><div>' + proseHtml(entry.details,entry.id) + '</div></section>' : '') +
        lifestyle +
        (cards ? '<div class="character-public-grid">' + cards + '</div>' : '') +
        (entry.publicKnowledge ? '<section class="character-about-card character-public-knowledge"><span class="character-info-kicker">Known information</span><h2>ข้อมูลที่เปิดเผยแล้ว</h2><div>' + proseHtml(entry.publicKnowledge,entry.id) + '</div></section>' : '') +
        (authorMode && entry.storyUse ? '<section class="reader-section author-reader-section"><h2>ใช้กับเนื้อเรื่องอย่างไร</h2><div class="reader-section-copy">' + proseHtml(entry.storyUse,entry.id) + '</div></section>' : '') +
        (authorMode && entry.continuityNotes ? '<section class="reader-section author-reader-section"><h2>ข้อควรจำเวลาเขียน</h2><div class="reader-section-copy">' + proseHtml(entry.continuityNotes,entry.id) + '</div></section>' : '') +
        (authorMode && entry.openQuestions ? '<section class="reader-section author-reader-section"><h2>สิ่งที่ยังไม่ล็อก</h2><div class="reader-section-copy">' + proseHtml(entry.openQuestions,entry.id) + '</div></section>' : '') +
        (related.length ? '<section class="reader-related character-related"><h2>อ่านต่อ</h2><div class="reader-related-list">' + related.map(x => '<button data-related="' + esc(x.id) + '" data-related-type="' + (x.sectionId ? 'entry':'section') + '" type="button">' + esc(x.title || x.readerLabel || x.name) + '</button>').join("") + '</div></section>' : '') +
        (authorMode ? '<div class="reader-edit-row character-edit-row"><button class="button primary" data-edit-entry type="button">แก้ไขข้อมูลนี้</button></div>' : '') +
      '</article>';
  }

  function renderEntry(id) {
    const entry=entryById(id);
    if(!entry || !isVisible(entry)) return navigate("all");
    const section=sectionById(entry.sectionId);
    const related=(entry.links || []).map(relationTarget).filter(Boolean);
    if(isCharacterSection(entry.sectionId)) {
      content.innerHTML=characterEntryHtml(entry,section,related);
      bindBreadcrumbs();
      bindPageBack();
      bindAuthorStrip();
      content.querySelectorAll("[data-wiki-glossary]").forEach(btn => btn.addEventListener("click",() => navigate("entry",btn.dataset.wikiGlossary)));
      content.querySelectorAll("[data-related]").forEach(btn => btn.addEventListener("click",() => navigate(btn.dataset.relatedType,btn.dataset.related)));
      const edit=content.querySelector("[data-edit-entry]");
      if(edit) edit.addEventListener("click",() => openEntryEditor(id));
      updateTopbar(characterDisplayName(entry));
      return;
    }
    const mapFigure=entry.id==="caelum-bang-bua-map" ? '<figure class="location-map"><img src="assets/caelum-bang-bua-map.svg" alt="ผังตั้งต้น แสดง CaeLum ถนนหน้าเมือง รางรถไฟฟ้ายกระดับ สถานีบางบัว บันไดลง และทางข้ามเข้าสู่ประตูหลัก"><figcaption>จุดยืนยันของผัง: สถานีบางบัว → บันไดลง → ทางเท้า → ทางข้ามถนน → ประตูหลัก</figcaption></figure>' : "";
    content.innerHTML =
      '<div class="section-page-nav article-page-nav">' + pageBackHtml("section",entry.sectionId) + '<div class="breadcrumbs article-breadcrumbs">' + breadcrumbsHtml(entry.sectionId) + '<span class="sep">/</span><span>' + esc(entry.title) + '</span></div></div>' + authorStripHtml(entry.sectionId) +
      '<article class="reader-article"><header class="reader-article-head"><p class="reader-category">' + esc(section ? section.readerLabel || section.name : "CaeLum") + '</p>' +
      (entry.kicker ? '<p class="reader-kicker">' + esc(entry.kicker) + '</p>' : '') + '<h1>' + esc(entry.title) + '</h1><p class="reader-lead">' + esc(entry.summary || "") + '</p></header>' +
      mapFigure +
      '<section class="reader-body">' + proseHtml(entry.details || "—",entry.id) + '</section>' +
      (entry.publicKnowledge ? '<section class="reader-section"><h2>สิ่งที่คนในโลกรับรู้</h2><div class="reader-section-copy">' + proseHtml(entry.publicKnowledge,entry.id) + '</div></section>' : '') +
      (authorMode && entry.storyUse ? '<section class="reader-section author-reader-section"><h2>ใช้กับเนื้อเรื่องอย่างไร</h2><div class="reader-section-copy">' + proseHtml(entry.storyUse,entry.id) + '</div></section>' : '') +
      (authorMode && entry.continuityNotes ? '<section class="reader-section author-reader-section"><h2>ข้อควรจำเวลาเขียน</h2><div class="reader-section-copy">' + proseHtml(entry.continuityNotes,entry.id) + '</div></section>' : '') +
      (authorMode && entry.openQuestions ? '<section class="reader-section author-reader-section"><h2>สิ่งที่ยังไม่ล็อก</h2><div class="reader-section-copy">' + proseHtml(entry.openQuestions,entry.id) + '</div></section>' : '') +
      (related.length ? '<section class="reader-related"><h2>อ่านต่อ</h2><div class="reader-related-list">' + related.map(x => '<button data-related="' + esc(x.id) + '" data-related-type="' + (x.sectionId ? 'entry':'section') + '" type="button">' + esc(x.title || x.readerLabel || x.name) + '</button>').join("") + '</div></section>' : '') +
      (authorMode ? '<div class="reader-edit-row"><button class="button primary" data-edit-entry type="button">แก้ไขข้อมูลนี้</button></div>' : '') + '</article>';
    bindBreadcrumbs();
    bindPageBack();
    bindAuthorStrip();
    content.querySelectorAll("[data-wiki-glossary]").forEach(btn => btn.addEventListener("click",() => navigate("entry",btn.dataset.wikiGlossary)));
    content.querySelectorAll("[data-related]").forEach(btn => btn.addEventListener("click",() => navigate(btn.dataset.relatedType,btn.dataset.related)));
    const edit=content.querySelector("[data-edit-entry]");
    if(edit) edit.addEventListener("click",() => openEntryEditor(id));
    updateTopbar(entry.title);
  }

  function renderAllTopics() {
    const sections=visibleSections();
    const entries=visibleEntries();
    const groups=groupedRootSections();
    content.innerHTML =
      '<div class="search-head archive-index-head"><p class="eyebrow">คลังโลก CaeLum</p><h1>เลือกหัวข้อที่ต้องการสำรวจ</h1><p>ข้อมูลถูกแบ่งตามความหมายของมันในโลกเรื่อง เพื่อให้เห็นตั้งแต่แรกว่ามีอะไรให้อ่านบ้าง</p></div>' +
      authorStripHtml() +
      groups.map(group => '<section class="archive-group"><header class="archive-group-head"><div><h2>' + esc(group.label) + '</h2><p>' + esc(group.description) + '</p></div><span>' + group.sections.length + ' หมวด</span></header><div class="topic-grid archive-root-grid">' + group.sections.map(sectionCardHtml).join("") + '</div></section>').join("") +
      (authorMode ? '<div class="reader-heading"><div><h2>ข้อมูลทั้งหมดสำหรับผู้แต่ง</h2><p>' + entries.length + ' รายการ</p></div></div><section class="library-list">' + entries.map(entryCardHtml).join("") + '</section>' : '');
    bindSectionCards();
    content.querySelectorAll("[data-entry-card]").forEach(card => card.addEventListener("click",() => navigate("entry",card.dataset.entryCard)));
    bindAuthorStrip();
    updateTopbar("คลังโลก");
  }

  function renderSearch(query) {
    const q=String(query).toLowerCase();
    const chapters=visibleChapters().filter(ch => [ch.title,ch.subtitle,ch.summary,ch.body].join(" ").toLowerCase().includes(q));
    const sections=visibleSections().filter(s => [s.name,s.readerLabel,s.description,s.importance].join(" ").toLowerCase().includes(q));
    const entries=visibleEntries().filter(e => [e.title,e.character&&e.character.thaiName,e.kicker,e.summary,e.details,e.publicKnowledge].concat(authorMode?[e.storyUse,e.continuityNotes,e.openQuestions]:[]).concat(e.tags||[]).join(" ").toLowerCase().includes(q));
    const items=[];
    chapters.forEach(ch => items.push({type:"chapter",id:ch.id,title:"ตอน "+ch.number+" — "+ch.title,text:ch.summary}));
    sections.forEach(s => items.push({type:"section",id:s.id,title:s.readerLabel||s.name,text:s.description}));
    entries.forEach(e => {
      const char=isCharacterSection(e.sectionId);
      const primary=char?characterDisplayName(e):e.title;
      const secondary=char?characterEnglishName(e):"";
      items.push({type:"entry",id:e.id,title:primary+(secondary?" ("+secondary+")":""),text:e.summary});
    });
    content.innerHTML='<div class="search-head"><p class="eyebrow">ค้นหา</p><h1>ผลการค้นหา “' + esc(query) + '”</h1><p>พบ ' + items.length + ' รายการจากนิยายและคลังโลก</p></div><section class="search-results">' +
      (items.length ? items.map(item => '<article class="search-result" data-search-type="' + item.type + '" data-search-id="' + esc(item.id) + '"><div class="search-copy"><h3>' + esc(item.title) + '</h3><p>' + esc(item.text || "") + '</p></div><span class="search-type">' + (item.type==="chapter"?"นิยาย":item.type==="section"?"หมวด":"ข้อมูล") + '</span></article>').join("") : '<div class="empty-state">ยังไม่พบข้อมูลที่ตรงกับคำค้นนี้</div>') + '</section>';
    content.querySelectorAll("[data-search-id]").forEach(row => row.addEventListener("click",() => {
      searchQuery="";
      syncSearchInputs("");
      navigate(row.dataset.searchType,row.dataset.searchId);
    }));
    updateTopbar("ค้นหา");
  }

  function renderPage() {
    if(searchQuery.trim()) return renderSearch(searchQuery.trim());
    const r=route();
    if(r.type==="home") return renderHome();
    if(r.type==="novel") return renderNovelHome();
    if(r.type==="chapter") return renderChapter(r.id);
    if(r.type==="all") return renderAllTopics();
    if(r.type==="section") return renderSection(r.id);
    if(r.type==="entry") return renderEntry(r.id);
    renderHome();
  }

  function renderAll() {
    renderNav();
    renderPage();
    setModeUi();
  }

  async function loadPublicData() {
    const response=await fetch(CONFIG.rawDataUrl+"?v="+Date.now(),{cache:"no-store"});
    if(!response.ok) throw new Error("โหลดข้อมูล CaeLum ไม่สำเร็จ");
    db=normalizeDb(await response.json());
    updateVersion();
  }

  async function verifyToken(token) {
    const response=await fetch("https://api.github.com/user",{headers:{"Accept":"application/vnd.github+json","Authorization":"Bearer "+token,"X-GitHub-Api-Version":"2022-11-28"}});
    if(!response.ok) throw new Error("Token ใช้งานไม่ได้หรือหมดอายุ");
    const user=await response.json();
    if(user.login!==CONFIG.owner) throw new Error("Author Mode อนุญาตเฉพาะเจ้าของ CaeLum");
    return user;
  }

  function utf8ToBase64(text) {
    const bytes=new TextEncoder().encode(text);
    let binary="";
    for(let i=0;i<bytes.length;i+=0x8000) binary+=String.fromCharCode(...bytes.subarray(i,i+0x8000));
    return btoa(binary);
  }

  function base64ToUtf8(value) {
    const binary=atob(value);
    return new TextDecoder().decode(Uint8Array.from(binary,ch=>ch.charCodeAt(0)));
  }

  async function githubFile() {
    const response=await fetch("https://api.github.com/repos/"+CONFIG.owner+"/"+CONFIG.repo+"/contents/"+CONFIG.dataPath+"?ref="+encodeURIComponent(CONFIG.branch)+"&t="+Date.now(),{cache:"no-store",headers:{"Accept":"application/vnd.github+json","Authorization":"Bearer "+adminToken,"X-GitHub-Api-Version":"2022-11-28"}});
    if(!response.ok) throw new Error("อ่านข้อมูลล่าสุดจาก GitHub ไม่สำเร็จ");
    return response.json();
  }

  async function loadLatestFromGitHub() {
    const file=await githubFile();
    remoteSha=file.sha;
    db=normalizeDb(JSON.parse(base64ToUtf8(file.content.replace(/\n/g,""))));
    updateVersion();
  }

  async function saveDatabase(message) {
    if(!authorMode || !adminToken) throw new Error("ต้องเข้า Author Mode ก่อน");
    const remote=await githubFile();
    const remoteDb=normalizeDb(JSON.parse(base64ToUtf8(remote.content.replace(/\n/g,""))));
    if(Number(remoteDb.version||0)>Number(db.version||0)) throw new Error("ข้อมูลบน GitHub ใหม่กว่า กรุณารีเฟรชก่อนบันทึก");
    remoteSha=remote.sha;
    db.version=(Number(db.version)||1)+1;
    db.project.updatedAt=new Date().toISOString();
    if(db.novel) db.novel.updatedAt=new Date().toISOString();
    const response=await fetch("https://api.github.com/repos/"+CONFIG.owner+"/"+CONFIG.repo+"/contents/"+CONFIG.dataPath,{method:"PUT",headers:{"Accept":"application/vnd.github+json","Authorization":"Bearer "+adminToken,"X-GitHub-Api-Version":"2022-11-28","Content-Type":"application/json"},body:JSON.stringify({message:message||"Update CaeLum",content:utf8ToBase64(JSON.stringify(db,null,2)),sha:remoteSha,branch:CONFIG.branch})});
    if(!response.ok) {
      let detail="";
      try{detail=(await response.json()).message||"";}catch{}
      throw new Error("GitHub บันทึกไม่สำเร็จ"+(detail?": "+detail:""));
    }
    const result=await response.json();
    remoteSha=result.content && result.content.sha ? result.content.sha : "";
    updateVersion();
  }

  async function saveEntryMerged(next,message) {
    let lastError=null;
    for(let attempt=0;attempt<2;attempt++) {
      const remote=await githubFile();
      const remoteDb=normalizeDb(JSON.parse(base64ToUtf8(remote.content.replace(/\n/g,""))));
      if(next.featured) remoteDb.entries.forEach(e=>{if(e.sectionId===next.sectionId&&e.id!==next.id)e.featured=false;});
      const index=remoteDb.entries.findIndex(e=>e.id===next.id);
      if(index>=0) remoteDb.entries[index]=next; else remoteDb.entries.push(next);
      remoteDb.version=(Number(remoteDb.version)||1)+1;
      remoteDb.project.updatedAt=new Date().toISOString();
      if(remoteDb.novel) remoteDb.novel.updatedAt=new Date().toISOString();

      const response=await fetch("https://api.github.com/repos/"+CONFIG.owner+"/"+CONFIG.repo+"/contents/"+CONFIG.dataPath,{
        method:"PUT",
        headers:{"Accept":"application/vnd.github+json","Authorization":"Bearer "+adminToken,"X-GitHub-Api-Version":"2022-11-28","Content-Type":"application/json"},
        body:JSON.stringify({message:message||"Update CaeLum entry",content:utf8ToBase64(JSON.stringify(remoteDb,null,2)),sha:remote.sha,branch:CONFIG.branch})
      });

      if(response.status===409 && attempt===0) {
        lastError=new Error("ข้อมูลเปลี่ยนพร้อมกัน กำลังลองบันทึกกับไฟล์ล่าสุดอีกครั้ง");
        continue;
      }
      if(!response.ok) {
        let detail="";
        try{detail=(await response.json()).message||"";}catch{}
        throw new Error("GitHub บันทึกไม่สำเร็จ"+(detail?": "+detail:""));
      }

      const result=await response.json();
      remoteSha=result.content && result.content.sha ? result.content.sha : "";

      const verified=await githubFile();
      const verifiedDb=normalizeDb(JSON.parse(base64ToUtf8(verified.content.replace(/\n/g,""))));
      const saved=verifiedDb.entries.find(e=>e.id===next.id);
      if(!saved || saved.updatedAt!==next.updatedAt) throw new Error("GitHub รับไฟล์แล้วแต่ตรวจสอบข้อมูลที่บันทึกกลับมาไม่ตรง กรุณาลองอีกครั้ง");

      db=verifiedDb;
      remoteSha=verified.sha;
      updateVersion();
      return saved;
    }
    throw lastError||new Error("บันทึกไม่สำเร็จ");
  }

  async function enterAuthorMode() {
    const token=$("tokenInput").value.trim();
    if(!token) return toast("ใส่ GitHub Token ก่อน","error");
    const btn=$("loginButton");
    setBusy(btn,true,"กำลังตรวจสอบ…");
    try{
      await verifyToken(token);
      adminToken=token;
      sessionStorage.setItem("caelum_admin_token",token);
      authorMode=true;
      await loadLatestFromGitHub();
      adminModal.close();
      $("tokenInput").value="";
      renderAll();
      toast("Author Mode พร้อมใช้งาน","success");
    }catch(error){toast(error.message||"เข้าสู่ระบบไม่สำเร็จ","error");}
    finally{setBusy(btn,false);}
  }

  async function restoreSession() {
    if(!adminToken) return;
    try{
      await verifyToken(adminToken);
      authorMode=true;
      await loadLatestFromGitHub();
      renderAll();
    }catch{
      authorMode=false; adminToken=""; sessionStorage.removeItem("caelum_admin_token"); setModeUi();
    }
  }

  function logoutAuthor() {
    authorMode=false; adminToken=""; remoteSha="";
    sessionStorage.removeItem("caelum_admin_token");
    loadPublicData().then(renderAll);
    toast("กลับสู่ Reader Mode");
  }

  function setModeUi() {
    $("modeBadge").textContent=authorMode?"Author":"Reader";
    $("modeBadge").classList.toggle("author",authorMode);
    $("modeBadge").hidden=!authorMode;
    document.body.classList.toggle("author-mode",authorMode);
    $("adminButton").classList.toggle("active",authorMode);
    $("adminButton").querySelector("strong").textContent=authorMode?"Author Mode ✓":"สำหรับผู้ดูแล";
    const helper=$("adminButton").querySelector("small");
    if(helper) helper.textContent=authorMode?"กำลังแก้ไขข้อมูลหลังบ้าน":"เข้าสู่โหมดแก้ไข";
  }

  function sectionOptions(selectedId,excludeId,includeRoot) {
    let html=includeRoot?'<option value="">— หมวดหลัก —</option>':"";
    function walk(parent,depth){
      db.sections.filter(s=>(s.parentId||null)===(parent||null)).sort((a,b)=>(a.sort||0)-(b.sort||0)).forEach(s=>{
        if(s.id===excludeId) return;
        html+='<option value="'+esc(s.id)+'"'+(s.id===selectedId?' selected':'')+'>'+("— ".repeat(depth))+esc(s.name)+'</option>';
        walk(s.id,depth+1);
      });
    }
    walk(null,0);
    return html;
  }

  function hiddenSectionInPath(sectionId) {
    let current=sectionById(sectionId);
    const seen=new Set();
    while(current && !seen.has(current.id)) {
      if(current.visibility==="author-only") return current;
      seen.add(current.id);
      current=current.parentId ? sectionById(current.parentId) : null;
    }
    return null;
  }

  function updateEntryVisibilityHint() {
    const hint=$("entryVisibilityHint");
    if(!hint) return;
    const sectionId=$("entrySection").value;
    const hidden=hiddenSectionInPath(sectionId);
    const publicSelected=$("entryVisibility").value==="public";
    hint.classList.toggle("warning",Boolean(publicSelected && hidden));
    hint.textContent=publicSelected && hidden
      ? 'หมวด “' + (hidden.readerLabel || hidden.name) + '” เป็น Author Only — รายการนี้จะไม่แสดงในหน้า Public'
      : 'Public จะแสดงได้เมื่อหมวดที่เลือกและหมวดแม่เป็น Public ด้วย';
  }

  function isCharacterSection(sectionId) {
    let current=sectionById(sectionId);
    const seen=new Set();
    while(current && !seen.has(current.id)) {
      if(current.id==="characters") return true;
      seen.add(current.id);
      current=current.parentId ? sectionById(current.parentId) : null;
    }
    return false;
  }

  function setEntryEditorTab(tab) {
    const isCharacter=isCharacterSection($("entrySection").value);
    if(tab==="character" && !isCharacter) tab="basic";
    currentEntryTab=tab;
    document.querySelectorAll("[data-entry-tab]").forEach(btn=>{
      const active=btn.dataset.entryTab===tab;
      btn.classList.toggle("active",active);
      btn.setAttribute("aria-selected",active?"true":"false");
    });
    document.querySelectorAll("[data-entry-pane]").forEach(pane=>{
      const active=pane.dataset.entryPane===tab;
      pane.classList.toggle("active",active);
      pane.hidden=!active;
    });
  }

  function setCharacterEditorVisibility(sectionId) {
    const isCharacter=isCharacterSection(sectionId);
    const tab=$("characterTabButton");
    if(tab) tab.hidden=!isCharacter;
    if(!isCharacter && currentEntryTab==="character") setEntryEditorTab("basic");
  }

  function setEntrySaveFeedback(kind,text) {
    const state=$("entryEditorSaveState");
    if(!state) return;
    state.dataset.state=kind||"neutral";
    state.textContent=text||"";
  }

  function updateEntrySaveState() {
    const section=sectionById($("entrySection").value);
    const visibility=$("entryVisibility").value==="public" ? "Public" : "Author Only";
    const type=isCharacterSection($("entrySection").value) ? "ตัวละคร" : "ข้อมูลโลก";
    setEntrySaveFeedback("neutral",(section ? (section.readerLabel || section.name) : "ยังไม่เลือกหมวด") + " · " + type + " · " + visibility);
  }

  function markEntryDirty() {
    if(!editorModal.open) return;
    setEntrySaveFeedback("dirty","มีการแก้ไขที่ยังไม่ได้บันทึก");
  }

  function fillCharacterFields(entry) {
    const c=(entry && entry.character) || {};
    $("characterThaiName").value=c.thaiName||"";
    $("characterGender").value=c.gender||"";
    $("characterAge").value=c.age||"";
    $("characterOrigin").value=c.origin||"";
    $("characterAffiliation").value=c.affiliation||"";
    $("characterHandedness").value=c.handedness||"";
    $("characterRole").value=c.role||"";
    $("characterPortrait").value=c.portrait||"";
    $("characterAppearance").value=c.appearance||"";
    $("characterPersonality").value=c.personality||"";
    $("characterHobbies").value=c.hobbies||"";
    $("characterHabits").value=c.habits||"";
    $("characterFavoriteMusic").value=c.favoriteMusic||"";
    $("characterFavoriteFood").value=c.favoriteFood||"";
    $("characterLikes").value=c.likes||"";
    $("characterDislikes").value=c.dislikes||"";
    $("characterBackground").value=c.background||"";
    $("characterAbilities").value=c.abilities||"";
    $("characterRelationships").value=c.relationships||"";
    $("characterFirstAppearance").value=c.firstAppearance||"";
  }

  function readCharacterFields() {
    return {
      thaiName:$("characterThaiName").value.trim(),
      gender:$("characterGender").value.trim(),
      age:$("characterAge").value.trim(),
      origin:$("characterOrigin").value.trim(),
      affiliation:$("characterAffiliation").value.trim(),
      handedness:$("characterHandedness").value.trim(),
      role:$("characterRole").value.trim(),
      portrait:$("characterPortrait").value.trim(),
      appearance:$("characterAppearance").value.trim(),
      personality:$("characterPersonality").value.trim(),
      hobbies:$("characterHobbies").value.trim(),
      habits:$("characterHabits").value.trim(),
      favoriteMusic:$("characterFavoriteMusic").value.trim(),
      favoriteFood:$("characterFavoriteFood").value.trim(),
      likes:$("characterLikes").value.trim(),
      dislikes:$("characterDislikes").value.trim(),
      background:$("characterBackground").value.trim(),
      abilities:$("characterAbilities").value.trim(),
      relationships:$("characterRelationships").value.trim(),
      firstAppearance:$("characterFirstAppearance").value.trim()
    };
  }

  function openEntryEditor(id,defaultSectionId) {
    if(!authorMode) return;
    editingEntryId=id||null;
    const entry=id?entryById(id):null;
    $("editorHeading").textContent=entry?"แก้ไขข้อมูล":"เพิ่มข้อมูล";
    $("entryTitle").value=entry?entry.title:"";
    $("entrySection").innerHTML=sectionOptions(entry?entry.sectionId:(defaultSectionId||((db.sections[0]||{}).id||"")),null,false);
    $("entryStatus").value=entry?entry.status:"draft";
    $("entryVisibility").value=entry?entry.visibility:"public";
    $("entryTags").value=entry?(entry.tags||[]).join(", "):"";
    $("entryFeatured").checked=Boolean(entry&&entry.featured);
    $("entryKicker").value=entry?entry.kicker||"":"";
    $("entrySummary").value=entry?entry.summary||"":"";
    $("entryDetails").value=entry?entry.details||"":"";
    $("entryPublicKnowledge").value=entry?entry.publicKnowledge||"":"";
    $("entryStoryUse").value=entry?entry.storyUse||"":"";
    $("entryContinuity").value=entry?entry.continuityNotes||"":"";
    $("entryLinks").value=entry?(entry.links||[]).join(", "):"";
    $("entryQuestions").value=entry?entry.openQuestions||"":"";
    fillCharacterFields(entry);
    setCharacterEditorVisibility($("entrySection").value);
    updateEntryVisibilityHint();
    updateEntrySaveState();
    setEntryEditorTab("basic");
    $("deleteEntryButton").style.visibility=entry?"visible":"hidden";
    editorModal.showModal();
  }

  async function saveEntry() {
    const title=$("entryTitle").value.trim(), sectionId=$("entrySection").value;
    if(!title) return toast("ใส่ชื่อหัวข้อก่อน","error");
    if(!sectionId) return toast("เลือกหมวดก่อน","error");
    const existing=editingEntryId?entryById(editingEntryId):null;
    const hiddenParent=$("entryVisibility").value==="public" ? hiddenSectionInPath(sectionId) : null;
    if(hiddenParent) return toast('รายการตั้งเป็น Public แต่หมวด “' + (hiddenParent.readerLabel || hiddenParent.name) + '” ยังเป็น Author Only กรุณาย้ายรายการหรือเปิดหมวดก่อน',"error");

    const next=Object.assign({},existing||{},{
      id:editingEntryId||uid("entry"),sectionId:sectionId,title:title,visibility:$("entryVisibility").value,status:$("entryStatus").value,
      tags:$("entryTags").value.split(",").map(x=>x.trim()).filter(Boolean),featured:$("entryFeatured").checked,kicker:$("entryKicker").value.trim(),
      summary:$("entrySummary").value.trim(),details:$("entryDetails").value.trim(),publicKnowledge:$("entryPublicKnowledge").value.trim(),
      storyUse:$("entryStoryUse").value.trim(),continuityNotes:$("entryContinuity").value.trim(),links:$("entryLinks").value.split(",").map(x=>x.trim()).filter(Boolean),
      openQuestions:$("entryQuestions").value.trim(),updatedAt:new Date().toISOString()
    });
    if(isCharacterSection(sectionId)) next.character=readCharacterFields();
    else if(next.character) delete next.character;

    const btn=$("saveEntryButton");
    setBusy(btn,true,"กำลังบันทึก…");
    setEntrySaveFeedback("saving","กำลังบันทึกและตรวจสอบกับ GitHub…");
    try{
      const saved=await saveEntryMerged(next,(existing?"Update entry: ":"Add entry: ")+title);
      setEntrySaveFeedback("saved","บันทึกขึ้น GitHub แล้ว · World v"+db.version);
      editorModal.close();
      editingEntryId=null;
      navigate("entry",saved.id);
      renderAll();
      toast("บันทึกขึ้น GitHub แล้ว · World v"+db.version,"success");
    }catch(error){
      setEntrySaveFeedback("error","บันทึกไม่สำเร็จ — "+(error.message||"เกิดข้อผิดพลาด"));
      toast(error.message||"บันทึกไม่สำเร็จ","error");
    }finally{
      setBusy(btn,false);
    }
  }

  async function deleteEntry() {
    const entry=entryById(editingEntryId);
    if(!entry||!confirm('ลบ "'+entry.title+'" ?')) return;
    const backup=JSON.parse(JSON.stringify(db));
    db.entries=db.entries.filter(e=>e.id!==entry.id);
    const btn=$("deleteEntryButton");setBusy(btn,true,"กำลังลบ…");
    try{await saveDatabase("Delete entry: "+entry.title);editorModal.close();editingEntryId=null;navigate("section",entry.sectionId);toast("ลบข้อมูลแล้ว","success");}
    catch(error){db=backup;toast(error.message||"ลบไม่สำเร็จ","error");}
    finally{setBusy(btn,false);}
  }

  function openSectionEditor(id,parentId) {
    if(!authorMode) return;
    editingSectionId=id||null;
    const s=id?sectionById(id):null;
    $("sectionHeading").textContent=s?"แก้ไขหมวด":"เพิ่มหมวด";
    $("sectionName").value=s?s.name:"";
    $("sectionParent").innerHTML=sectionOptions(s?s.parentId:(parentId||""),id||null,true);
    $("sectionGroup").value=s?s.group||"other":"other";
    $("sectionIcon").value=s?s.icon||"":"";
    $("sectionVisibility").value=s?s.visibility||"public":"public";
    $("sectionSort").value=s?Number(s.sort||100):100;
    $("sectionImageKey").value=s?s.imageKey||"bangkokNight":"bangkokNight";
    $("sectionDescription").value=s?s.description||"":"";
    $("sectionImportance").value=s?s.importance||"":"";
    $("deleteSectionButton").style.visibility=s?"visible":"hidden";
    sectionModal.showModal();
  }

  async function saveSection() {
    const name=$("sectionName").value.trim();
    if(!name) return toast("ใส่ชื่อหมวดก่อน","error");
    const existing=editingSectionId?sectionById(editingSectionId):null;
    const next=Object.assign({},existing||{},{
      id:editingSectionId||uid("section"),name:name,parentId:$("sectionParent").value||null,group:$("sectionGroup").value,icon:$("sectionIcon").value.trim()||"·",
      visibility:$("sectionVisibility").value,sort:Number($("sectionSort").value)||100,imageKey:$("sectionImageKey").value,description:$("sectionDescription").value.trim(),
      importance:$("sectionImportance").value.trim(),updatedAt:new Date().toISOString()
    });
    const backup=JSON.parse(JSON.stringify(db));
    const i=db.sections.findIndex(s=>s.id===next.id);
    if(i>=0) db.sections[i]=next; else db.sections.push(next);
    const btn=$("saveSectionButton");setBusy(btn,true,"กำลังบันทึก…");
    try{await saveDatabase((existing?"Update section: ":"Add section: ")+name);sectionModal.close();editingSectionId=null;navigate("section",next.id);renderAll();toast("บันทึกหมวดแล้ว","success");}
    catch(error){db=backup;toast(error.message||"บันทึกหมวดไม่สำเร็จ","error");}
    finally{setBusy(btn,false);}
  }

  async function deleteSection() {
    const s=sectionById(editingSectionId);
    if(!s) return;
    if(db.sections.some(x=>x.parentId===s.id)||db.entries.some(e=>e.sectionId===s.id)) return toast("ย้ายหรือลบข้อมูลภายในหมวดก่อน","error");
    if(!confirm('ลบหมวด "'+s.name+'" ?')) return;
    const backup=JSON.parse(JSON.stringify(db));
    db.sections=db.sections.filter(x=>x.id!==s.id);
    const btn=$("deleteSectionButton");setBusy(btn,true,"กำลังลบ…");
    try{await saveDatabase("Delete section: "+s.name);sectionModal.close();editingSectionId=null;navigate("all");toast("ลบหมวดแล้ว","success");}
    catch(error){db=backup;toast(error.message||"ลบหมวดไม่สำเร็จ","error");}
    finally{setBusy(btn,false);}
  }

  function ensureChapterEditor() {
    let dialog=$("chapterEditorModal");
    if(dialog) return dialog;
    dialog=document.createElement("dialog");
    dialog.id="chapterEditorModal";
    dialog.className="modal wide chapter-editor-modal";
    dialog.innerHTML='<form method="dialog" class="modal-card" onsubmit="return false;"><header class="modal-header"><div><span class="modal-kicker">NOVEL CHAPTER</span><h2 id="chapterEditorHeading">แก้ไขตอน</h2></div><button class="icon-button" data-chapter-close type="button">×</button></header><div class="modal-body form-grid"><label class="field"><span>ตอนที่</span><input id="chapterNumber" type="number" min="1"></label><label class="field"><span>สถานะ</span><select id="chapterStatus"><option value="published">Published — เปิดอ่าน</option><option value="draft">Draft — หลังบ้าน</option></select></label><label class="field span-2"><span>ชื่อตอน</span><input id="chapterTitle"></label><label class="field span-2"><span>คำโปรยใต้ชื่อตอน</span><input id="chapterSubtitle"></label><label class="field span-2"><span>สรุปตอน</span><textarea id="chapterSummary" rows="3"></textarea></label><label class="field span-2"><span>เนื้อหานิยาย</span><textarea id="chapterBody" rows="24" class="chapter-body-editor"></textarea><small>เว้นบรรทัดเพื่อขึ้นย่อหน้าใหม่ และใช้ --- เป็นจุดแบ่งฉาก</small></label></div><footer class="modal-footer split"><button class="button danger" id="deleteChapterButton" type="button">ลบตอน</button><div class="button-row"><button class="button secondary" data-chapter-close type="button">ยกเลิก</button><button class="button primary" id="saveChapterButton" type="button">บันทึกลง GitHub</button></div></footer></form>';
    document.body.appendChild(dialog);
    dialog.querySelectorAll("[data-chapter-close]").forEach(btn=>btn.addEventListener("click",()=>dialog.close()));
    $("saveChapterButton").addEventListener("click",saveChapter);
    $("deleteChapterButton").addEventListener("click",deleteChapter);
    return dialog;
  }

  function openChapterEditor(id) {
    if(!authorMode) return;
    editingChapterId=id||null;
    const ch=id?chapterById(id):null;
    const dialog=ensureChapterEditor();
    $("chapterEditorHeading").textContent=ch?"แก้ไขตอนนิยาย":"เพิ่มตอนนิยาย";
    $("chapterNumber").value=ch?ch.number:(db.novel.chapters.length+1);
    $("chapterStatus").value=ch?ch.status:"draft";
    $("chapterTitle").value=ch?ch.title:"";
    $("chapterSubtitle").value=ch?ch.subtitle||"":"";
    $("chapterSummary").value=ch?ch.summary||"":"";
    $("chapterBody").value=ch?ch.body||"":"";
    $("deleteChapterButton").style.visibility=ch?"visible":"hidden";
    dialog.showModal();
  }

  async function saveChapter() {
    const title=$("chapterTitle").value.trim(), body=$("chapterBody").value.trim();
    if(!title) return toast("ใส่ชื่อตอนก่อน","error");
    if(!body) return toast("ใส่เนื้อหาตอนก่อน","error");
    const existing=editingChapterId?chapterById(editingChapterId):null;
    const number=Math.max(1,Number($("chapterNumber").value)||1);
    const status=$("chapterStatus").value;
    const next=Object.assign({},existing||{},{
      id:editingChapterId||("chapter-"+number+"-"+Date.now()),number:number,title:title,subtitle:$("chapterSubtitle").value.trim(),status:status,
      visibility:status==="published"?"public":"author-only",summary:$("chapterSummary").value.trim(),body:body,
      publishedAt:(existing&&existing.publishedAt)||(status==="published"?new Date().toISOString():""),updatedAt:new Date().toISOString()
    });
    const backup=JSON.parse(JSON.stringify(db));
    const i=db.novel.chapters.findIndex(ch=>ch.id===next.id);
    if(i>=0) db.novel.chapters[i]=next; else db.novel.chapters.push(next);
    const btn=$("saveChapterButton");setBusy(btn,true,"กำลังบันทึก…");
    try{await saveDatabase((existing?"Update novel chapter: ":"Add novel chapter: ")+title);$("chapterEditorModal").close();editingChapterId=null;navigate("chapter",next.id);renderAll();toast("บันทึกตอนนิยายแล้ว","success");}
    catch(error){db=backup;toast(error.message||"บันทึกตอนนิยายไม่สำเร็จ","error");}
    finally{setBusy(btn,false);}
  }

  async function deleteChapter() {
    const ch=chapterById(editingChapterId);
    if(!ch||!confirm('ลบตอน "'+ch.title+'" ?')) return;
    const backup=JSON.parse(JSON.stringify(db));
    db.novel.chapters=db.novel.chapters.filter(x=>x.id!==ch.id);
    const btn=$("deleteChapterButton");setBusy(btn,true,"กำลังลบ…");
    try{await saveDatabase("Delete novel chapter: "+ch.title);$("chapterEditorModal").close();editingChapterId=null;navigate("novel");toast("ลบตอนแล้ว","success");}
    catch(error){db=backup;toast(error.message||"ลบตอนไม่สำเร็จ","error");}
    finally{setBusy(btn,false);}
  }

  function exportBackup() {
    const blob=new Blob([JSON.stringify(db,null,2)],{type:"application/json"});
    const url=URL.createObjectURL(blob);
    const a=document.createElement("a");
    a.href=url;a.download="caelum-world-v"+db.version+".json";a.click();
    setTimeout(()=>URL.revokeObjectURL(url),1000);
  }

  function syncSearchInputs(value) {
    searchInput.value=value;
    sidebarSearch.value=value;
  }

  function onSearch(value) {
    searchQuery=value;
    syncSearchInputs(value);
    renderPage();
  }

  const collapseNavButton = $("collapseNavButton");
  if (collapseNavButton) collapseNavButton.addEventListener("click",() => {
    expandedNav.clear();
    localStorage.setItem("caelum_nav_open","[]");
    renderNav();
  });

  const sidebarResizer = $("sidebarResizer");
  if (sidebarResizer) {
    let resizing = false;
    const move = event => {
      if (!resizing || window.innerWidth <= 1040) return;
      applySidebarWidth(event.clientX,true);
    };
    const stop = () => {
      if (!resizing) return;
      resizing = false;
      document.body.classList.remove("resizing-sidebar");
    };
    sidebarResizer.addEventListener("pointerdown",event => {
      if (window.innerWidth <= 1040) return;
      resizing = true;
      document.body.classList.add("resizing-sidebar");
      sidebarResizer.setPointerCapture?.(event.pointerId);
      event.preventDefault();
    });
    sidebarResizer.addEventListener("pointermove",move);
    sidebarResizer.addEventListener("pointerup",stop);
    sidebarResizer.addEventListener("pointercancel",stop);
    sidebarResizer.addEventListener("dblclick",() => applySidebarWidth(SIDEBAR_DEFAULT,true));
    sidebarResizer.addEventListener("keydown",event => {
      if (event.key === "ArrowLeft") { event.preventDefault(); applySidebarWidth(sidebarWidth-20,true); }
      if (event.key === "ArrowRight") { event.preventDefault(); applySidebarWidth(sidebarWidth+20,true); }
      if (event.key === "Home") { event.preventDefault(); applySidebarWidth(SIDEBAR_DEFAULT,true); }
    });
  }

  document.querySelectorAll("[data-entry-tab]").forEach(btn=>btn.addEventListener("click",()=>setEntryEditorTab(btn.dataset.entryTab)));
  editorModal.addEventListener("input",markEntryDirty);
  editorModal.addEventListener("change",markEntryDirty);
  $("entrySection").addEventListener("change",e=>{
    setCharacterEditorVisibility(e.target.value);
    updateEntryVisibilityHint();
    updateEntrySaveState();
  });
  $("entryVisibility").addEventListener("change",()=>{
    updateEntryVisibilityHint();
    updateEntrySaveState();
  });
  document.querySelectorAll("[data-close]").forEach(btn=>btn.addEventListener("click",()=>$(btn.dataset.close).close()));
  $("menuButton").addEventListener("click",()=>document.body.classList.add("nav-open"));
  $("sidebarCloseButton").addEventListener("click",()=>document.body.classList.remove("nav-open"));
  $("mobileBackdrop").addEventListener("click",()=>document.body.classList.remove("nav-open"));
  searchInput.addEventListener("input",e=>onSearch(e.target.value));
  sidebarSearch.addEventListener("input",e=>onSearch(e.target.value));
  $("refreshButton").addEventListener("click",async()=>{try{if(authorMode)await loadLatestFromGitHub();else await loadPublicData();renderAll();toast("โหลดข้อมูลล่าสุดแล้ว","success");}catch(error){toast(error.message,"error");}});
  $("adminButton").addEventListener("click",()=>{if(authorMode)return toast("Author Mode เปิดอยู่แล้ว");adminModal.showModal();setTimeout(()=>$("tokenInput").focus(),30);});
  $("loginButton").addEventListener("click",enterAuthorMode);
  $("tokenInput").addEventListener("keydown",e=>{if(e.key==="Enter"){e.preventDefault();enterAuthorMode();}});
  $("saveEntryButton").addEventListener("click",saveEntry);
  $("deleteEntryButton").addEventListener("click",deleteEntry);
  $("saveSectionButton").addEventListener("click",saveSection);
  $("deleteSectionButton").addEventListener("click",deleteSection);

  document.addEventListener("click",e=>{
    if(glossaryPopover && !glossaryPopover.contains(e.target) && !(e.target.closest && e.target.closest("[data-novel-glossary]"))) closeGlossaryPopover();
  });

  window.addEventListener("hashchange",()=>{
    closeGlossaryPopover();
    if(readingScrollHandler){window.removeEventListener("scroll",readingScrollHandler);readingScrollHandler=null;}
    searchQuery="";syncSearchInputs("");renderAll();
  });

  (async()=>{
    try{
      await loadPublicData();
      renderAll();
      await restoreSession();
    }catch(error){
      content.innerHTML='<div class="empty-state">ไม่สามารถโหลด CaeLum ได้</div>';
      toast(error.message||"เริ่มต้นเว็บไม่สำเร็จ","error");
    }
  })();
})();