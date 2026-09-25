(() => {
  "use strict";

  const CONFIG = {
    owner: "sanaisawan63x2",
    repo: "CaeLum",
    branch: "main",
    dataPath: "data/world.json",
    rawDataUrl: "https://raw.githubusercontent.com/sanaisawan63x2/CaeLum/main/data/world.json"
  };

  const NAV_GROUPS = [
    { id: "core", label: "แกนของโลก" },
    { id: "institutions", label: "สถาบันและผู้คน" },
    { id: "lived", label: "โลกที่ใช้ชีวิต" },
    { id: "danger", label: "ภัยและเนื้อเรื่อง" },
    { id: "other", label: "อื่น ๆ" }
  ];

  let db = { schemaVersion: 3, version: 1, project: {}, sections: [], entries: [] };
  let authorMode = false;
  let adminToken = sessionStorage.getItem("caelum_admin_token") || "";
  let remoteSha = "";
  let editingEntryId = null;
  let editingSectionId = null;
  let searchQuery = "";
  let lastNavRouteKey = "";
  let expandedNav = new Set();
  try {
    expandedNav = new Set(JSON.parse(localStorage.getItem("caelum_nav_open") || "[]"));
  } catch {
    expandedNav = new Set();
  }

  function saveExpandedNav() {
    localStorage.setItem("caelum_nav_open", JSON.stringify([...expandedNav]));
  }


  const $ = id => document.getElementById(id);
  const content = $("content");
  const categoryNav = $("categoryNav");
  const searchInput = $("searchInput");
  const sidebarSearch = $("sidebarSearch");
  const adminModal = $("adminModal");
  const editorModal = $("editorModal");
  const sectionModal = $("sectionModal");

  function esc(value = "") {
    return String(value).replace(/[&<>"']/g, ch => ({
      "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#039;"
    })[ch]);
  }

  function proseHtml(value = "") {
    const normalized = String(value || "")
      .replace(/\\r\\n|\\n|\\r/g, "\n");
    return normalized
      .split(/\n\s*\n/)
      .map(block => block.trim())
      .filter(Boolean)
      .map(block => '<p>' + esc(block).replace(/\n/g, "<br>") + '</p>')
      .join("");
  }

  function readerMetaHtml(entry) {
    if (!authorMode) return "";
    return '<div class="reader-meta">' +
      '<span>' + esc(statusLabel(entry.status)) + '</span>' +
      (entry.visibility === "author-only" ? '<span>Author Only</span>' : '<span>Public</span>') +
      '</div>';
  }

  function uid(prefix) {
    return prefix + "-" + (crypto.randomUUID ? crypto.randomUUID() : Date.now() + "-" + Math.random().toString(16).slice(2));
  }

  function toast(message, type = "") {
    const node = document.createElement("div");
    node.className = "toast " + type;
    node.textContent = message;
    $("toastStack").appendChild(node);
    setTimeout(() => node.remove(), 3600);
  }

  function setBusy(button, busy, label = "กำลังทำงาน…") {
    if (!button) return;
    if (busy) {
      button.dataset.label = button.textContent;
      button.textContent = label;
      button.disabled = true;
    } else {
      button.textContent = button.dataset.label || button.textContent;
      button.disabled = false;
    }
  }

  function normalizeDb(value) {
    const safe = value && typeof value === "object" ? value : {};
    safe.project = safe.project || {};
    safe.project.assets = safe.project.assets || {};
    safe.sections = Array.isArray(safe.sections) ? safe.sections : [];
    safe.entries = Array.isArray(safe.entries) ? safe.entries : [];
    safe.schemaVersion = safe.schemaVersion || 3;
    return safe;
  }

  function sectionById(id) {
    return db.sections.find(s => s.id === id) || null;
  }

  function entryById(id) {
    return db.entries.find(e => e.id === id) || null;
  }

  function isVisible(item) {
    return authorMode || item.visibility !== "author-only";
  }

  function visibleSections() {
    return db.sections.filter(isVisible);
  }

  function visibleEntries() {
    return db.entries.filter(isVisible);
  }

  function childrenOf(parentId) {
    return visibleSections()
      .filter(s => (s.parentId || null) === (parentId || null))
      .sort((a,b) => (Number(a.sort)||0) - (Number(b.sort)||0) || a.name.localeCompare(b.name, "th"));
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

  function sectionGroupId(sectionId) {
    return rootOf(sectionId)?.group || "other";
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

  function entriesIn(sectionId, deep = false) {
    const ids = deep ? descendantSectionIds(sectionId) : new Set([sectionId]);
    return visibleEntries().filter(e => ids.has(e.sectionId));
  }

  function countUnder(sectionId) {
    return entriesIn(sectionId, true).length;
  }

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
    const key = typeof sectionOrKey === "string"
      ? (sectionById(sectionOrKey)?.imageKey || sectionOrKey)
      : sectionOrKey?.imageKey;
    return db.project.assets?.[key] || db.project.assets?.bangkokNight || {};
  }

  function styleBg(url) {
    return url ? "background-image:url('" + esc(url) + "')" : "";
  }

  function statusLabel(status) {
    return status === "canon" ? "Canon" : status === "idea" ? "Idea" : "Draft";
  }

  function route() {
    const raw = location.hash.replace(/^#/, "");
    if (!raw || raw === "home") return { type: "home" };
    if (raw === "all") return { type: "all" };
    const [type, ...rest] = raw.split("/");
    const id = decodeURIComponent(rest.join("/"));
    if (type === "section" && sectionById(id)) return { type, id };
    if (type === "entry" && entryById(id)) return { type, id };
    return { type: "home" };
  }

  function navigate(type, id = "") {
    const next = type === "home" ? "#home" :
      type === "all" ? "#all" :
      "#" + type + "/" + encodeURIComponent(id);
    if (location.hash === next) renderAll();
    else location.hash = next;
    window.scrollTo({ top: 0, behavior: "smooth" });
  }

  async function loadPublicData() {
    const response = await fetch(CONFIG.rawDataUrl + "?v=" + Date.now(), { cache: "no-store" });
    if (!response.ok) throw new Error("โหลดข้อมูล CaeLum ไม่สำเร็จ");
    db = normalizeDb(await response.json());
    updateVersion();
  }

  function updateVersion() {
    $("versionLabel").textContent = "Archive v" + (db.version || 1);
  }

  async function reloadData() {
    try {
      if (authorMode && adminToken) await loadLatestFromGitHub();
      else await loadPublicData();
      renderAll();
    } catch (error) {
      toast(error.message || "โหลดข้อมูลไม่สำเร็จ", "error");
    }
  }

  function renderAll() {
    renderNav();
    renderPage();
    setModeUi();
  }

  function renderNav() {
    const r = route();
    const activeSection = r.type === "section" ? r.id : r.type === "entry" ? entryById(r.id)?.sectionId : null;

    const routeKey = r.type + ":" + (r.id || "");
    if (routeKey !== lastNavRouteKey && activeSection) {
      for (const section of ancestorChain(activeSection)) expandedNav.add(section.id);
      saveExpandedNav();
    }
    lastNavRouteKey = routeKey;

    const roots = childrenOf(null);
    let html = '<div class="nav-tree">';
    html += navSimple("home", "⌂", "หน้าหลัก", r.type === "home");
    html += navSimple("all", "☰", "สารบัญทั้งหมด", r.type === "all");
    html += '<div class="nav-main-label">หมวดหลัก</div>';

    for (const root of roots) html += navSectionNode(root, activeSection, 0);

    html += "</div>";
    categoryNav.innerHTML = html;

    categoryNav.querySelectorAll("[data-go]").forEach(btn => {
      btn.addEventListener("click", () => {
        const [type, id] = btn.dataset.go.split(":");
        navigate(type, id || "");
      });
    });

    categoryNav.querySelectorAll("[data-nav-toggle]").forEach(btn => {
      btn.addEventListener("click", event => {
        event.stopPropagation();
        const id = btn.dataset.navToggle;
        if (expandedNav.has(id)) expandedNav.delete(id);
        else expandedNav.add(id);
        saveExpandedNav();
        renderNav();
      });
    });
  }

  function navSimple(type, icon, label, active) {
    return '<div class="nav-node-row"><button class="nav-toggle placeholder" tabindex="-1">›</button>' +
      '<button class="nav-btn' + (active ? " active" : "") + '" data-go="' + type + ':">' +
      '<span class="nav-icon">' + icon + '</span><span class="nav-label">' + esc(label) + '</span></button></div>';
  }

  function navSectionNode(section, activeSection, depth) {
    const children = childrenOf(section.id);
    const active = section.id === activeSection;
    const open = expandedNav.has(section.id);
    let html = '<div class="nav-node">';
    html += '<div class="nav-node-row">';
    if (children.length) {
      html += '<button class="nav-toggle' + (open ? " open" : "") + '" data-nav-toggle="' + esc(section.id) + '" type="button" aria-label="' + (open ? "ย่อหมวด" : "ขยายหมวด") + '">' + (open ? "−" : "+") + '</button>';
    } else {
      html += '<button class="nav-toggle placeholder" tabindex="-1">+</button>';
    }
    html += '<button class="nav-btn nav-indent-' + Math.min(depth,3) + (active ? " active" : "") + '" data-go="section:' + esc(section.id) + '">' +
      '<span class="nav-icon">' + esc(section.icon || "•") + '</span><span class="nav-label">' + esc(section.readerLabel || section.name) + '</span></button></div>';

    if (children.length && open) {
      html += '<div class="nav-children">';
      for (const child of children) html += navSectionNode(child, activeSection, depth + 1);
      html += '</div>';
    }

    html += "</div>";
    return html;
  }

  function renderPage() {
    if (searchQuery.trim()) return renderSearch(searchQuery.trim());
    const r = route();
    if (r.type === "home") return renderHome();
    if (r.type === "all") return renderAllTopics();
    if (r.type === "section") return renderSection(r.id);
    if (r.type === "entry") return renderEntry(r.id);
    return renderHome();
  }

  function authorStripHtml(sectionId = null) {
    if (!authorMode) return "";
    return '<div class="author-strip">' +
      '<div class="author-strip-copy"><strong>Author Mode</strong><span>ข้อมูลหลังบ้านถูกเปิดแล้ว — การบันทึกจะ Commit ไปที่ GitHub</span></div>' +
      '<div class="author-tools">' +
        '<button class="button secondary" data-author-action="new-section" data-section="' + esc(sectionId || "") + '" type="button">+ หมวด</button>' +
        '<button class="button primary" data-author-action="new-entry" data-section="' + esc(sectionId || "") + '" type="button">+ ข้อมูล</button>' +
        '<button class="button ghost" data-author-action="export" type="button">Export JSON</button>' +
        '<button class="button ghost" data-author-action="logout" type="button">ออกจากโหมด</button>' +
      '</div></div>';
  }

  function bindAuthorStrip() {
    content.querySelectorAll("[data-author-action]").forEach(btn => {
      btn.addEventListener("click", () => {
        const action = btn.dataset.authorAction;
        const sectionId = btn.dataset.section || null;
        if (action === "new-section") openSectionEditor(null, sectionId);
        if (action === "new-entry") openEntryEditor(null, sectionId);
        if (action === "export") exportBackup();
        if (action === "logout") logoutAuthor();
      });
    });
  }

  function photoCreditHtml(asset) {
    if (!asset?.credit) return "";
    return '<span class="photo-credit">ภาพประกอบ: <a href="' + esc(asset.source || "#") + '" target="_blank" rel="noreferrer">' + esc(asset.credit) + '</a></span>';
  }

  function renderHome() {
    const heroAsset = db.project.assets?.bangkokNight || {};
    const roots = childrenOf(null);
    const starts = ["overview","locations","magic","caelum"].map(sectionById).filter(Boolean).filter(isVisible);

    content.innerHTML = `
      <section class="hero-cover compact-hero">
        <div class="cover-image" style="${styleBg(heroAsset.url)}"></div>
        <div class="hero-cover-content">
          <p class="eyebrow">CAE LUM WORLD BIBLE</p>
          <h1>CaeLum</h1>
          <p class="lead">${esc(db.project.readerIntro || "คลังข้อมูลของโลก CaeLum")}</p>
        </div>
        ${photoCreditHtml(heroAsset)}
      </section>

      ${authorStripHtml()}

      <div class="section-heading">
        <div><h2>เริ่มจากตรงนี้</h2><p>เลือกหัวข้อที่ต้องการ ไม่จำเป็นต้องไล่อ่านตามลำดับ</p></div>
      </div>
      <section class="path-grid">${starts.map(sectionCardHtml).join("")}</section>

      <div class="section-heading">
        <div><h2>หมวดหลัก</h2><p>โครงสร้างใหญ่ของ World Bible</p></div>
      </div>
      <section class="topic-grid root-topic-grid">${roots.map(sectionCardHtml).join("")}</section>
    `;

    bindSectionCards();
    bindAuthorStrip();
    updateTopbar("หน้าหลัก");
  }

  function renderGroupedHome(roots) {
    let html = "";
    for (const group of NAV_GROUPS) {
      const items = roots.filter(s => (s.group || "other") === group.id);
      if (!items.length) continue;
      html += '<section class="group-block"><div class="group-block-header"><h2>' + esc(group.label) + '</h2><span>' + items.length + ' หมวด</span></div><div class="topic-grid">' +
        items.map(sectionCardHtml).join("") + '</div></section>';
    }
    return html;
  }

  function renderAllTopics() {
    const sections = visibleSections();
    const entries = visibleEntries();

    content.innerHTML = `
      <div class="search-head">
        <p class="eyebrow">INDEX</p>
        <h1>สารบัญทั้งหมด</h1>
        <p>รวมหมวดและบทความที่ผู้อ่านสามารถเข้าถึงได้ในตอนนี้</p>
      </div>
      ${authorStripHtml()}
      <section class="topic-grid">${sections.map(sectionCardHtml).join("")}</section>
      <div class="section-heading"><div><h2>บทความ</h2><p>${entries.length} รายการ</p></div></div>
      <section class="topic-grid">${entries.map(entryCardHtml).join("")}</section>
    `;

    bindSectionCards();
    bindEntryCards();
    bindAuthorStrip();
    updateTopbar("สารบัญทั้งหมด");
  }

  function sectionCardHtml(section) {
    return `<article class="library-item section-item" data-section-card="${esc(section.id)}">
      <div class="library-item-icon">${esc(section.icon || "•")}</div>
      <div class="library-item-copy">
        <h3>${esc(section.readerLabel || section.name)}</h3>
        <p>${esc(section.description || "หมวดข้อมูลของโลก CaeLum")}</p>
      </div>
      <span class="library-arrow">→</span>
    </article>`;
  }

  function entryCardHtml(entry) {
    const section = sectionById(entry.sectionId);
    return `<article class="library-item entry-item" data-entry-card="${esc(entry.id)}">
      <div class="library-item-icon">${esc(section?.icon || "•")}</div>
      <div class="library-item-copy">
        <h3>${esc(entry.title)}</h3>
        <p>${esc(entry.summary || "ยังไม่มีสรุป")}</p>
      </div>
      <span class="library-arrow">→</span>
    </article>`;
  }

  function bindSectionCards() {
    content.querySelectorAll("[data-section-card]").forEach(card => {
      card.addEventListener("click", () => navigate("section", card.dataset.sectionCard));
    });
  }

  function bindEntryCards() {
    content.querySelectorAll("[data-entry-card]").forEach(card => {
      card.addEventListener("click", () => navigate("entry", card.dataset.entryCard));
    });
  }

  function breadcrumbsHtml(sectionId) {
    let html = '<button data-crumb="home">World Archive</button>';
    for (const s of ancestorChain(sectionId)) {
      html += '<span class="sep">/</span><button data-crumb="section:' + esc(s.id) + '">' + esc(s.readerLabel || s.name) + '</button>';
    }
    return html;
  }

  function bindBreadcrumbs() {
    content.querySelectorAll("[data-crumb]").forEach(btn => {
      btn.addEventListener("click", () => {
        const value = btn.dataset.crumb;
        if (value === "home") return navigate("home");
        const [type,id] = value.split(":");
        navigate(type,id);
      });
    });
  }

  function renderSection(sectionId) {
    const section = sectionById(sectionId);
    if (!section || !isVisible(section)) return navigate("home");

    const asset = assetFor(section);
    const children = childrenOf(sectionId);
    const entries = entriesIn(sectionId, false).sort((a,b) => a.title.localeCompare(b.title,"th"));
    const featured = entries.find(e => e.featured) || null;
    const rest = featured ? entries.filter(e => e.id !== featured.id) : entries;

    content.innerHTML = `
      <section class="section-hero simple-section-hero">
        <div class="section-hero-bg" style="${styleBg(asset.url)}"></div>
        <div class="section-hero-content">
          <div class="breadcrumbs">${breadcrumbsHtml(sectionId)}</div>
          <h1>${esc(section.readerLabel || section.name)}</h1>
          <p>${esc(section.description || "")}</p>
          ${authorMode ? '<div class="section-actions"><button class="button secondary" data-edit-section="' + esc(section.id) + '" type="button">แก้หมวดนี้</button></div>' : ''}
        </div>
      </section>

      ${authorStripHtml(sectionId)}

      ${featured ? '<section class="section-overview-link" data-entry-card="' + esc(featured.id) + '"><div><span class="section-overview-label">ภาพรวม</span><h2>' + esc(featured.title) + '</h2><p>' + esc(featured.summary || "") + '</p></div><span class="section-overview-arrow">อ่านต่อ →</span></section>' : ''}

      ${children.length ? '<div class="reader-heading"><h2>หัวข้อย่อย</h2><p>เลือกส่วนที่ต้องการอ่านได้เลย</p></div><section class="library-list">' + children.map(sectionCardHtml).join("") + '</section>' : ''}

      ${rest.length ? '<div class="reader-heading"><h2>' + (section.id === "caelum" ? "พื้นที่และข้อมูลของ CaeLum" : "ข้อมูลในหมวดนี้") + '</h2><p>แต่ละเรื่องเปิดอ่านแยกกัน ไม่ต้องไล่อ่านทั้งหน้า</p></div><section class="library-list">' + rest.map(entryCardHtml).join("") + '</section>' : ''}

      ${section.importance ? '<section class="section-note"><h2>อ่านส่วนนี้แล้วจะเข้าใจอะไร</h2><p>' + esc(section.importance) + '</p></section>' : ''}

      ${!featured && !children.length && !rest.length ? '<div class="empty-state">หมวดนี้ยังไม่มีข้อมูล' + (authorMode ? ' — ใช้ปุ่ม “+ ข้อมูล” เพื่อเริ่มเขียน' : '') + '</div>' : ''}
    `;

    bindBreadcrumbs();
    bindSectionCards();
    bindEntryCards();
    bindAuthorStrip();
    content.querySelector("[data-edit-section]")?.addEventListener("click", () => openSectionEditor(sectionId));
    updateTopbar(section.readerLabel || section.name);
  }

  function featuredArticleHtml(entry) {
    return '<section class="section-overview-link" data-entry-card="' + esc(entry.id) + '"><div><span class="section-overview-label">ภาพรวม</span><h2>' + esc(entry.title) + '</h2><p>' + esc(entry.summary || "") + '</p></div><span class="section-overview-arrow">อ่านต่อ →</span></section>';
  }

  function badgesHtml(entry) {
    const tags = (entry.tags || []).slice(0,5).map(t => '<span class="badge">' + esc(t) + '</span>').join("");
    return '<div class="meta-badges"><span class="badge ' + esc(entry.status || "draft") + '">' + statusLabel(entry.status) + '</span>' +
      (entry.visibility === "author-only" ? '<span class="badge author">Author Only</span>' : '') + tags + '</div>';
  }

  function authorContextHtml(entry) {
    const blocks = [];
    if (entry.storyUse) blocks.push('<div class="author-note"><span class="label">Story Role</span><div>' + esc(entry.storyUse) + '</div></div>');
    if (entry.continuityNotes) blocks.push('<div class="author-note"><span class="label">Continuity</span><div>' + esc(entry.continuityNotes) + '</div></div>');
    if (entry.openQuestions) blocks.push('<div class="author-note full"><span class="label">Open Questions</span><div>' + esc(entry.openQuestions) + '</div></div>');
    if (!blocks.length) return "";
    return '<section class="author-context">' + blocks.join("") + '</section>';
  }

  function renderEntry(entryId) {
    const entry = entryById(entryId);
    if (!entry || !isVisible(entry)) return navigate("home");
    const section = sectionById(entry.sectionId);
    const related = (entry.links || []).map(findRelationTarget).filter(Boolean);

    content.innerHTML = `
      <div class="breadcrumbs article-breadcrumbs">${breadcrumbsHtml(entry.sectionId)}<span class="sep">/</span><span>${esc(entry.title)}</span></div>
      ${authorStripHtml(entry.sectionId)}

      <article class="reader-article">
        <header class="reader-article-head">
          <p class="reader-category">${esc(section?.readerLabel || section?.name || "CaeLum")}</p>
          ${entry.kicker ? '<p class="reader-kicker">' + esc(entry.kicker) + '</p>' : ''}
          <h1>${esc(entry.title)}</h1>
          ${readerMetaHtml(entry)}
          <p class="reader-lead">${esc(entry.summary || "")}</p>
        </header>

        <section class="reader-body">
          ${proseHtml(entry.details || "—")}
        </section>

        ${entry.publicKnowledge ? '<section class="reader-section"><h2>คนในโลกรู้อะไรเกี่ยวกับเรื่องนี้</h2><div class="reader-section-copy">' + proseHtml(entry.publicKnowledge) + '</div></section>' : ''}

        ${authorMode && entry.storyUse ? '<section class="reader-section author-reader-section"><h2>ใช้กับเนื้อเรื่องอย่างไร</h2><div class="reader-section-copy">' + proseHtml(entry.storyUse) + '</div></section>' : ''}
        ${authorMode && entry.continuityNotes ? '<section class="reader-section author-reader-section"><h2>ข้อควรจำเวลาเขียน</h2><div class="reader-section-copy">' + proseHtml(entry.continuityNotes) + '</div></section>' : ''}
        ${authorMode && entry.openQuestions ? '<section class="reader-section author-reader-section"><h2>สิ่งที่ยังไม่ล็อก</h2><div class="reader-section-copy">' + proseHtml(entry.openQuestions) + '</div></section>' : ''}

        ${related.length ? '<section class="reader-related"><h2>อ่านต่อ</h2><div class="reader-related-list">' + related.map(relationButtonHtml).join("") + '</div></section>' : ''}

        ${authorMode ? '<div class="reader-edit-row"><button class="button primary" data-edit-current type="button">แก้ไขข้อมูลนี้</button></div>' : ''}
      </article>
    `;

    bindBreadcrumbs();
    bindAuthorStrip();
    bindRelationButtons();
    content.querySelector("[data-edit-current]")?.addEventListener("click", () => openEntryEditor(entry.id));
    updateTopbar(entry.title);
  }

  function normalizeName(value) {
    return String(value || "").trim().toLowerCase();
  }

  function findRelationTarget(label) {
    const name = normalizeName(label);
    const entry = visibleEntries().find(e => normalizeName(e.title) === name || normalizeName(e.id) === name);
    if (entry) return { type:"entry", id:entry.id, label:entry.title };
    const section = visibleSections().find(s => normalizeName(s.name) === name || normalizeName(s.readerLabel) === name || normalizeName(s.id) === name);
    if (section) return { type:"section", id:section.id, label:section.readerLabel || section.name };
    return null;
  }

  function relationButtonHtml(target) {
    return '<button class="relation-link" data-relation="' + esc(target.type) + ':' + esc(target.id) + '" type="button"><span>' + esc(target.label) + '</span><span>→</span></button>';
  }

  function bindRelationButtons() {
    content.querySelectorAll("[data-relation]").forEach(btn => {
      btn.addEventListener("click", () => {
        const [type,id] = btn.dataset.relation.split(":");
        navigate(type,id);
      });
    });
  }

  function renderSearch(query) {
    const q = query.toLowerCase();
    const sectionResults = visibleSections().filter(s =>
      [s.name,s.readerLabel,s.description,s.importance].join(" ").toLowerCase().includes(q)
    );
    const entryResults = visibleEntries().filter(e => {
      const section = sectionById(e.sectionId);
      const fields = authorMode
        ? [e.title,e.kicker,e.summary,e.details,e.publicKnowledge,e.storyUse,e.continuityNotes,e.openQuestions,section?.name,...(e.tags||[]),...(e.links||[])]
        : [e.title,e.kicker,e.summary,e.details,e.publicKnowledge,section?.name,...(e.tags||[]),...(e.links||[])];
      return fields.join(" ").toLowerCase().includes(q);
    });

    const items = [
      ...sectionResults.map(s => ({ type:"section", id:s.id, title:s.readerLabel||s.name, text:s.description, section:s })),
      ...entryResults.map(e => ({ type:"entry", id:e.id, title:e.title, text:e.summary, section:sectionById(e.sectionId) }))
    ];

    content.innerHTML = `
      <div class="search-head">
        <p class="eyebrow">SEARCH</p>
        <h1>ผลการค้นหา “${esc(query)}”</h1>
        <p>พบ ${items.length} รายการจากหมวด บทความ และบันทึกที่คุณมีสิทธิ์มองเห็น</p>
      </div>
      <section class="search-results">
        ${items.length ? items.map(searchResultHtml).join("") : '<div class="empty-state">ยังไม่พบข้อมูลที่ตรงกับคำค้นนี้</div>'}
      </section>
    `;

    content.querySelectorAll("[data-search-result]").forEach(row => {
      row.addEventListener("click", () => {
        const [type,id] = row.dataset.searchResult.split(":");
        searchQuery = "";
        syncSearchInputs("");
        navigate(type,id);
      });
    });
    updateTopbar("ค้นหา");
  }

  function searchResultHtml(item) {
    const asset = assetFor(item.section);
    return `<article class="search-result" data-search-result="${esc(item.type)}:${esc(item.id)}">
      <div class="search-thumb" style="${styleBg(asset.url)}"></div>
      <div class="search-copy"><h3>${esc(item.title)}</h3><p>${esc(item.text || "")}</p></div>
      <span class="search-type">${item.type === "section" ? "หมวด" : "บทความ"}</span>
    </article>`;
  }

  function updateTopbar(label) {
    $("topbarContext").textContent = label || (authorMode ? "Author" : "Reader");
  }

  async function verifyToken(token) {
    const response = await fetch("https://api.github.com/user", {
      headers: {
        "Accept":"application/vnd.github+json",
        "Authorization":"Bearer " + token,
        "X-GitHub-Api-Version":"2022-11-28"
      }
    });
    if (!response.ok) throw new Error("Token ใช้งานไม่ได้หรือหมดอายุ");
    const user = await response.json();
    if (user.login !== CONFIG.owner) throw new Error("Author Mode อนุญาตเฉพาะเจ้าของ CaeLum");
    return user;
  }

  async function githubFile() {
    const response = await fetch("https://api.github.com/repos/" + CONFIG.owner + "/" + CONFIG.repo + "/contents/" + CONFIG.dataPath + "?ref=" + encodeURIComponent(CONFIG.branch) + "&t=" + Date.now(), {
      cache:"no-store",
      headers:{
        "Accept":"application/vnd.github+json",
        "Authorization":"Bearer " + adminToken,
        "X-GitHub-Api-Version":"2022-11-28"
      }
    });
    if (!response.ok) throw new Error("อ่านข้อมูลล่าสุดจาก GitHub ไม่สำเร็จ");
    return response.json();
  }

  function utf8ToBase64(text) {
    const bytes = new TextEncoder().encode(text);
    let binary = "";
    for (let i=0;i<bytes.length;i+=0x8000) binary += String.fromCharCode(...bytes.subarray(i,i+0x8000));
    return btoa(binary);
  }

  function base64ToUtf8(value) {
    const binary = atob(value);
    return new TextDecoder().decode(Uint8Array.from(binary, ch => ch.charCodeAt(0)));
  }

  async function loadLatestFromGitHub() {
    const file = await githubFile();
    remoteSha = file.sha;
    db = normalizeDb(JSON.parse(base64ToUtf8(file.content.replace(/\n/g,""))));
    updateVersion();
  }

  async function saveDatabase(message) {
    if (!authorMode || !adminToken) throw new Error("ต้องเข้า Author Mode ก่อน");
    const remote = await githubFile();
    const remoteDb = normalizeDb(JSON.parse(base64ToUtf8(remote.content.replace(/\n/g,""))));
    if (Number(remoteDb.version || 0) > Number(db.version || 0)) {
      throw new Error("ข้อมูลบน GitHub มีเวอร์ชันใหม่กว่า กรุณากดรีเฟรชก่อนบันทึกเพื่อป้องกันข้อมูลทับกัน");
    }

    remoteSha = remote.sha;
    db.version = (Number(db.version)||1) + 1;
    db.project.updatedAt = new Date().toISOString();

    const response = await fetch("https://api.github.com/repos/" + CONFIG.owner + "/" + CONFIG.repo + "/contents/" + CONFIG.dataPath, {
      method:"PUT",
      headers:{
        "Accept":"application/vnd.github+json",
        "Authorization":"Bearer " + adminToken,
        "X-GitHub-Api-Version":"2022-11-28",
        "Content-Type":"application/json"
      },
      body:JSON.stringify({
        message: message || "Update CaeLum World Archive",
        content:utf8ToBase64(JSON.stringify(db,null,2)),
        sha:remoteSha,
        branch:CONFIG.branch
      })
    });

    if (!response.ok) {
      let detail = "";
      try { detail = (await response.json()).message || ""; } catch {}
      throw new Error("GitHub บันทึกไม่สำเร็จ" + (detail ? ": " + detail : ""));
    }
    const result = await response.json();
    remoteSha = result.content?.sha || "";
    updateVersion();
  }

  async function enterAuthorMode() {
    const token = $("tokenInput").value.trim();
    if (!token) return toast("ใส่ GitHub Token ก่อน", "error");
    const btn = $("loginButton");
    setBusy(btn,true,"กำลังตรวจสอบ…");
    try {
      await verifyToken(token);
      adminToken = token;
      sessionStorage.setItem("caelum_admin_token",token);
      authorMode = true;
      await loadLatestFromGitHub();
      adminModal.close();
      $("tokenInput").value = "";
      renderAll();
      toast("Author Mode พร้อมใช้งาน", "success");
    } catch (error) {
      toast(error.message || "เข้าสู่ระบบไม่สำเร็จ","error");
    } finally {
      setBusy(btn,false);
    }
  }

  function logoutAuthor() {
    authorMode = false;
    adminToken = "";
    remoteSha = "";
    sessionStorage.removeItem("caelum_admin_token");
    reloadData();
    toast("กลับสู่ Reader Mode");
  }

  function setModeUi() {
    $("modeBadge").textContent = authorMode ? "Author" : "Reader";
    $("modeBadge").classList.toggle("author",authorMode);
    $("adminButton").classList.toggle("active",authorMode);
    $("adminButton").querySelector("strong").textContent = authorMode ? "Author Mode ✓" : "Author Mode";
  }

  function sectionOptions(selectedId = "", excludeId = null, includeRoot = false) {
    let html = includeRoot ? '<option value="">— หมวดหลัก —</option>' : "";
    function walk(parentId,depth) {
      for (const s of db.sections.filter(x => (x.parentId||null)===(parentId||null)).sort((a,b)=>(a.sort||0)-(b.sort||0))) {
        if (s.id === excludeId) continue;
        html += '<option value="' + esc(s.id) + '"' + (s.id===selectedId ? " selected" : "") + '>' + "— ".repeat(depth) + esc(s.name) + '</option>';
        walk(s.id,depth+1);
      }
    }
    walk(null,0);
    return html;
  }

  function firstPublicSectionId() {
    return db.sections.find(s => s.visibility !== "author-only")?.id || "";
  }

  function openEntryEditor(id = null, defaultSectionId = null) {
    if (!authorMode) return;
    editingEntryId = id;
    const entry = id ? entryById(id) : null;
    $("editorHeading").textContent = entry ? "แก้ไขข้อมูล" : "เพิ่มข้อมูล";
    $("entryTitle").value = entry?.title || "";
    $("entrySection").innerHTML = sectionOptions(entry?.sectionId || defaultSectionId || firstPublicSectionId());
    $("entryStatus").value = entry?.status || "draft";
    $("entryVisibility").value = entry?.visibility || "public";
    $("entryTags").value = (entry?.tags || []).join(", ");
    $("entryFeatured").checked = Boolean(entry?.featured);
    $("entryKicker").value = entry?.kicker || "";
    $("entrySummary").value = entry?.summary || "";
    $("entryDetails").value = entry?.details || "";
    $("entryPublicKnowledge").value = entry?.publicKnowledge || "";
    $("entryStoryUse").value = entry?.storyUse || "";
    $("entryContinuity").value = entry?.continuityNotes || "";
    $("entryLinks").value = (entry?.links || []).join(", ");
    $("entryQuestions").value = entry?.openQuestions || "";
    $("deleteEntryButton").style.visibility = entry ? "visible" : "hidden";
    editorModal.showModal();
  }

  async function saveEntry() {
    const title = $("entryTitle").value.trim();
    const sectionId = $("entrySection").value;
    if (!title) return toast("ใส่ชื่อหัวข้อก่อน","error");
    if (!sectionId) return toast("เลือกหมวดก่อน","error");

    const next = {
      id: editingEntryId || uid("entry"),
      sectionId,
      title,
      visibility:$("entryVisibility").value,
      status:$("entryStatus").value,
      tags:$("entryTags").value.split(",").map(x=>x.trim()).filter(Boolean),
      featured:$("entryFeatured").checked,
      kicker:$("entryKicker").value.trim(),
      summary:$("entrySummary").value.trim(),
      details:$("entryDetails").value.trim(),
      publicKnowledge:$("entryPublicKnowledge").value.trim(),
      storyUse:$("entryStoryUse").value.trim(),
      continuityNotes:$("entryContinuity").value.trim(),
      links:$("entryLinks").value.split(",").map(x=>x.trim()).filter(Boolean),
      openQuestions:$("entryQuestions").value.trim(),
      updatedAt:new Date().toISOString()
    };

    const backup = JSON.parse(JSON.stringify(db));
    if (next.featured) {
      for (const e of db.entries) if (e.sectionId === sectionId && e.id !== next.id) e.featured = false;
    }

    if (editingEntryId) {
      const index = db.entries.findIndex(e => e.id === editingEntryId);
      if (index >= 0) db.entries[index] = next;
    } else db.entries.push(next);

    const btn = $("saveEntryButton");
    setBusy(btn,true,"กำลังบันทึก…");
    try {
      await saveDatabase((editingEntryId ? "Update entry: " : "Add entry: ") + title);
      editorModal.close();
      editingEntryId = null;
      navigate("entry",next.id);
      renderAll();
      toast("บันทึกแล้ว — รีเฟรชหน้าเว็บจะเห็นข้อมูลล่าสุดทันที","success");
    } catch (error) {
      db = backup;
      toast(error.message || "บันทึกไม่สำเร็จ","error");
    } finally {
      setBusy(btn,false);
    }
  }

  async function deleteEntry() {
    const entry = entryById(editingEntryId);
    if (!entry || !confirm('ลบ "' + entry.title + '" ?')) return;
    const backup = JSON.parse(JSON.stringify(db));
    db.entries = db.entries.filter(e => e.id !== entry.id);
    const btn = $("deleteEntryButton");
    setBusy(btn,true,"กำลังลบ…");
    try {
      await saveDatabase("Delete entry: " + entry.title);
      editorModal.close();
      editingEntryId = null;
      navigate("section",entry.sectionId);
      renderAll();
      toast("ลบข้อมูลแล้ว","success");
    } catch (error) {
      db = backup;
      toast(error.message || "ลบไม่สำเร็จ","error");
    } finally {
      setBusy(btn,false);
    }
  }

  function openSectionEditor(id = null, defaultParentId = null) {
    if (!authorMode) return;
    editingSectionId = id;
    const section = id ? sectionById(id) : null;
    $("sectionHeading").textContent = section ? "แก้ไขหมวด" : "เพิ่มหมวด";
    $("sectionName").value = section?.name || "";
    $("sectionParent").innerHTML = sectionOptions(section?.parentId || defaultParentId || "",id,true);
    $("sectionGroup").value = section?.group || (defaultParentId ? sectionGroupId(defaultParentId) : "other");
    $("sectionIcon").value = section?.icon || "•";
    $("sectionVisibility").value = section?.visibility || "public";
    $("sectionSort").value = Number(section?.sort ?? 100);
    $("sectionImageKey").value = section?.imageKey || (defaultParentId ? rootOf(defaultParentId)?.imageKey : "bangkokNight") || "bangkokNight";
    $("sectionDescription").value = section?.description || "";
    $("sectionImportance").value = section?.importance || "";
    $("deleteSectionButton").style.visibility = section ? "visible" : "hidden";
    sectionModal.showModal();
  }

  function wouldCreateCycle(sectionId,parentId) {
    if (!sectionId || !parentId) return false;
    if (sectionId === parentId) return true;
    let current = sectionById(parentId);
    const seen = new Set();
    while (current && !seen.has(current.id)) {
      if (current.id === sectionId) return true;
      seen.add(current.id);
      current = current.parentId ? sectionById(current.parentId) : null;
    }
    return false;
  }

  async function saveSection() {
    const name = $("sectionName").value.trim();
    const parentId = $("sectionParent").value || null;
    if (!name) return toast("ใส่ชื่อหมวดก่อน","error");
    if (wouldCreateCycle(editingSectionId,parentId)) return toast("ย้ายหมวดเข้าไปอยู่ในหมวดย่อยของตัวเองไม่ได้","error");

    const previous = sectionById(editingSectionId);
    const next = {
      id: editingSectionId || uid("section"),
      name,
      readerLabel: previous?.readerLabel || name,
      icon:$("sectionIcon").value.trim() || "•",
      parentId,
      group: parentId ? sectionGroupId(parentId) : $("sectionGroup").value,
      visibility:$("sectionVisibility").value,
      sort:Number($("sectionSort").value)||100,
      imageKey:$("sectionImageKey").value,
      description:$("sectionDescription").value.trim(),
      importance:$("sectionImportance").value.trim()
    };

    const backup = JSON.parse(JSON.stringify(db));
    if (editingSectionId) {
      const index = db.sections.findIndex(s => s.id === editingSectionId);
      if (index >= 0) db.sections[index] = next;
    } else db.sections.push(next);

    const btn = $("saveSectionButton");
    setBusy(btn,true,"กำลังบันทึก…");
    try {
      await saveDatabase((editingSectionId ? "Update section: " : "Add section: ") + name);
      sectionModal.close();
      editingSectionId = null;
      navigate("section",next.id);
      renderAll();
      toast("บันทึกหมวดแล้ว","success");
    } catch (error) {
      db = backup;
      toast(error.message || "บันทึกหมวดไม่สำเร็จ","error");
    } finally {
      setBusy(btn,false);
    }
  }

  async function deleteSection() {
    const section = sectionById(editingSectionId);
    if (!section) return;
    const children = db.sections.filter(s => s.parentId === section.id);
    const entries = db.entries.filter(e => e.sectionId === section.id);
    if (children.length || entries.length) return toast("ลบไม่ได้: ต้องย้ายหรือลบหัวข้อย่อยและข้อมูลในหมวดนี้ก่อน","error");
    if (!confirm('ลบหมวด "' + section.name + '" ?')) return;

    const backup = JSON.parse(JSON.stringify(db));
    db.sections = db.sections.filter(s => s.id !== section.id);
    const btn = $("deleteSectionButton");
    setBusy(btn,true,"กำลังลบ…");
    try {
      await saveDatabase("Delete section: " + section.name);
      sectionModal.close();
      editingSectionId = null;
      if (section.parentId) navigate("section",section.parentId); else navigate("home");
      renderAll();
      toast("ลบหมวดแล้ว","success");
    } catch (error) {
      db = backup;
      toast(error.message || "ลบหมวดไม่สำเร็จ","error");
    } finally {
      setBusy(btn,false);
    }
  }

  function exportBackup() {
    const blob = new Blob([JSON.stringify(db,null,2)],{type:"application/json"});
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = "CaeLum-world-backup.json";
    a.click();
    setTimeout(() => URL.revokeObjectURL(url),1000);
    toast("สร้างไฟล์ Backup แล้ว","success");
  }

  async function restoreSession() {
    if (!adminToken) return;
    try {
      await verifyToken(adminToken);
      authorMode = true;
      await loadLatestFromGitHub();
      renderAll();
    } catch {
      authorMode = false;
      adminToken = "";
      sessionStorage.removeItem("caelum_admin_token");
      setModeUi();
    }
  }

  function syncSearchInputs(value) {
    searchInput.value = value;
    sidebarSearch.value = value;
  }

  function onSearch(value) {
    searchQuery = value;
    syncSearchInputs(value);
    renderPage();
  }

  document.querySelectorAll("[data-close]").forEach(btn => {
    btn.addEventListener("click", () => $(btn.dataset.close)?.close());
  });

  $("menuButton").addEventListener("click", () => document.body.classList.add("nav-open"));
  $("sidebarCloseButton")?.addEventListener("click", () => document.body.classList.remove("nav-open"));
  $("mobileBackdrop").addEventListener("click", () => document.body.classList.remove("nav-open"));
  searchInput.addEventListener("input", e => onSearch(e.target.value));
  sidebarSearch.addEventListener("input", e => onSearch(e.target.value));

  $("refreshButton").addEventListener("click", async () => {
    await reloadData();
    toast("โหลดข้อมูลล่าสุดแล้ว","success");
  });

  $("adminButton").addEventListener("click", () => {
    if (authorMode) return toast("Author Mode เปิดอยู่แล้ว");
    adminModal.showModal();
    setTimeout(() => $("tokenInput").focus(),30);
  });

  $("loginButton").addEventListener("click", enterAuthorMode);
  $("tokenInput").addEventListener("keydown", e => {
    if (e.key === "Enter") { e.preventDefault(); enterAuthorMode(); }
  });

  $("saveEntryButton").addEventListener("click", saveEntry);
  $("deleteEntryButton").addEventListener("click", deleteEntry);
  $("saveSectionButton").addEventListener("click", saveSection);
  $("deleteSectionButton").addEventListener("click", deleteSection);

  window.addEventListener("hashchange", () => {
    searchQuery = "";
    syncSearchInputs("");
    renderAll();
  });

  (async () => {
    try {
      await loadPublicData();
      renderAll();
      await restoreSession();
    } catch (error) {
      content.innerHTML = '<div class="empty-state">ไม่สามารถโหลด World Archive ได้</div>';
      toast(error.message || "เริ่มต้นเว็บไม่สำเร็จ","error");
    }
  })();
})();