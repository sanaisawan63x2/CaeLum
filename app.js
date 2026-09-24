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

  let db = { schemaVersion: 2, version: 1, project: { name: "CaeLum" }, sections: [], entries: [] };
  let currentSectionId = "home";
  let currentEntryId = null;
  let editingEntryId = null;
  let editingSectionId = null;
  let authorMode = false;
  let adminToken = sessionStorage.getItem("caelum_admin_token") || "";
  let remoteSha = "";
  const expanded = new Set();

  const $ = id => document.getElementById(id);
  const content = $("content");
  const categoryNav = $("categoryNav");
  const searchInput = $("searchInput");
  const adminModal = $("adminModal");
  const editorModal = $("editorModal");
  const sectionModal = $("sectionModal");

  function esc(value = "") {
    return String(value).replace(/[&<>"']/g, ch => ({
      "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#039;"
    })[ch]);
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

  function sectionById(id) {
    return (db.sections || []).find(s => s.id === id) || null;
  }

  function entryById(id) {
    return (db.entries || []).find(e => e.id === id) || null;
  }

  function isVisible(item) {
    return authorMode || item.visibility !== "author-only";
  }

  function visibleSections() {
    return (db.sections || []).filter(isVisible);
  }

  function visibleEntries() {
    return (db.entries || []).filter(isVisible);
  }

  function childrenOf(parentId) {
    return visibleSections()
      .filter(s => (s.parentId || null) === (parentId || null))
      .sort((a, b) => (Number(a.sort) || 0) - (Number(b.sort) || 0) || a.name.localeCompare(b.name, "th"));
  }

  function sectionGroupId(sectionId) {
    let cur = sectionById(sectionId);
    const seen = new Set();
    while (cur && cur.parentId && !seen.has(cur.id)) {
      seen.add(cur.id);
      cur = sectionById(cur.parentId);
    }
    return cur?.group || "other";
  }

  function groupedRootsHtml(roots) {
    const used = new Set();
    let html = "";
    for (const group of NAV_GROUPS) {
      const items = roots.filter(s => (s.group || "other") === group.id);
      if (!items.length) continue;
      items.forEach(x => used.add(x.id));
      html += '<section class="home-group"><div class="section-head compact"><div><h2>' + esc(group.label) + '</h2></div></div><div class="section-grid">' + items.map(sectionCardHtml).join("") + '</div></section>';
    }
    const rest = roots.filter(s => !used.has(s.id));
    if (rest.length) html += '<section class="home-group"><div class="section-head compact"><div><h2>อื่น ๆ</h2></div></div><div class="section-grid">' + rest.map(sectionCardHtml).join("") + '</div></section>';
    return html;
  }

  function entriesIn(sectionId, deep = false) {
    const ids = new Set([sectionId]);
    if (deep) {
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
    }
    return visibleEntries().filter(e => ids.has(e.sectionId));
  }

  function countUnder(sectionId) {
    return entriesIn(sectionId, true).length;
  }

  function ancestorChain(sectionId) {
    const chain = [];
    let cur = sectionById(sectionId);
    const seen = new Set();
    while (cur && !seen.has(cur.id)) {
      chain.unshift(cur);
      seen.add(cur.id);
      cur = cur.parentId ? sectionById(cur.parentId) : null;
    }
    return chain;
  }

  function statusLabel(status) {
    return status === "canon" ? "Canon" : status === "idea" ? "Idea" : "Draft";
  }

  function closeMobileNav() {
    document.body.classList.remove("nav-open");
  }

  async function loadPublicData() {
    const response = await fetch(CONFIG.rawDataUrl + "?v=" + Date.now(), { cache: "no-store" });
    if (!response.ok) throw new Error("โหลดข้อมูล CaeLum ไม่สำเร็จ");
    const json = await response.json();
    db = normalizeDb(json);
    $("versionLabel").textContent = "Data v" + (db.version || 1);
  }

  function normalizeDb(json) {
    const safe = json && typeof json === "object" ? json : {};
    safe.sections = Array.isArray(safe.sections) ? safe.sections : [];
    safe.entries = Array.isArray(safe.entries) ? safe.entries : [];
    safe.project = safe.project || { name: "CaeLum" };
    safe.schemaVersion = safe.schemaVersion || 2;
    return safe;
  }

  async function reloadData() {
    try {
      if (authorMode && adminToken) await loadLatestFromGitHub();
      else await loadPublicData();
      ensureCurrentLocation();
      renderAll();
    } catch (error) {
      toast(error.message || "โหลดข้อมูลไม่สำเร็จ", "error");
    }
  }

  function ensureCurrentLocation() {
    if (currentEntryId && !entryById(currentEntryId)) currentEntryId = null;
    if (currentSectionId !== "home" && currentSectionId !== "all" && !sectionById(currentSectionId)) currentSectionId = "home";
  }

  function renderAll() {
    renderNav();
    renderContent();
    setModeUi();
  }

  function renderNav() {
    const roots = childrenOf(null);
    let html = '<div class="nav-tree">';
    html += navButtonHtml("home", "⌂", "ภาพรวม", visibleEntries().length, 0);
    html += navButtonHtml("all", "▦", "ข้อมูลทั้งหมด", visibleEntries().length, 0);

    const used = new Set();
    for (const group of NAV_GROUPS) {
      const items = roots.filter(s => (s.group || "other") === group.id);
      if (!items.length) continue;
      html += '<div class="nav-group-title">' + esc(group.label) + '</div>';
      for (const root of items) {
        used.add(root.id);
        html += renderNavNode(root, 0);
      }
    }
    const rest = roots.filter(s => !used.has(s.id));
    if (rest.length) {
      html += '<div class="nav-group-title">อื่น ๆ</div>';
      for (const root of rest) html += renderNavNode(root, 0);
    }

    html += "</div>";
    categoryNav.innerHTML = html;

    categoryNav.querySelectorAll("[data-nav-section]").forEach(btn => {
      btn.addEventListener("click", () => {
        currentEntryId = null;
        currentSectionId = btn.dataset.navSection;
        const sec = sectionById(currentSectionId);
        if (sec) {
          for (const a of ancestorChain(sec.id)) expanded.add(a.id);
          expanded.add(sec.id);
        }
        closeMobileNav();
        renderAll();
        window.scrollTo({ top: 0, behavior: "smooth" });
      });
    });

    categoryNav.querySelectorAll("[data-toggle-section]").forEach(btn => {
      btn.addEventListener("click", event => {
        event.stopPropagation();
        const id = btn.dataset.toggleSection;
        if (expanded.has(id)) expanded.delete(id); else expanded.add(id);
        renderNav();
      });
    });
  }

  function navButtonHtml(id, icon, label, count, depth) {
    const active = currentSectionId === id && !currentEntryId ? " active" : "";
    return '<div class="nav-node"><div class="nav-node-row">' +
      '<button class="nav-toggle placeholder" tabindex="-1">›</button>' +
      '<button class="nav-btn nav-indent-' + Math.min(depth, 3) + active + '" data-nav-section="' + esc(id) + '">' +
      '<span class="nav-icon">' + esc(icon) + '</span><span class="nav-label">' + esc(label) + '</span><span class="nav-count">' + count + '</span></button>' +
      '</div></div>';
  }

  function renderNavNode(section, depth) {
    const kids = childrenOf(section.id);
    const hasKids = kids.length > 0;
    const open = expanded.has(section.id) || ancestorChain(currentSectionId).some(s => s.id === section.id);
    const active = currentSectionId === section.id && !currentEntryId ? " active" : "";
    let html = '<div class="nav-node"><div class="nav-node-row">';
    if (hasKids) {
      html += '<button class="nav-toggle" data-toggle-section="' + esc(section.id) + '" aria-label="เปิดหมวดย่อย">' + (open ? "⌄" : "›") + '</button>';
    } else {
      html += '<button class="nav-toggle placeholder" tabindex="-1">›</button>';
    }
    html += '<button class="nav-btn nav-indent-' + Math.min(depth, 3) + active + '" data-nav-section="' + esc(section.id) + '">' +
      '<span class="nav-icon">' + esc(section.icon || "•") + '</span>' +
      '<span class="nav-label">' + esc(section.name) + '</span>' +
      '<span class="nav-count">' + countUnder(section.id) + '</span></button></div>';
    if (hasKids && open) {
      for (const kid of kids) html += renderNavNode(kid, depth + 1);
    }
    html += "</div>";
    return html;
  }

  function renderContent() {
    if (currentEntryId) return renderEntryDetail(currentEntryId);
    const query = searchInput.value.trim().toLowerCase();
    if (query) return renderSearch(query);
    if (currentSectionId === "home") return renderHome();
    if (currentSectionId === "all") return renderAllEntries();
    return renderSection(currentSectionId);
  }

  function heroActionsHtml(sectionId = null) {
    if (!authorMode) return "";
    return '<div class="hero-actions structure-actions">' +
      '<button class="secondary-btn" id="addSectionButton" type="button">+ เพิ่มหมวด</button>' +
      '<button class="primary-btn" id="addEntryButton" type="button">+ เพิ่มข้อมูล</button>' +
      (sectionId ? '<button class="secondary-btn" id="editSectionButton" type="button">แก้หมวดนี้</button>' : "") +
      '</div>';
  }

  function bindHeroActions(sectionId = null) {
    $("addSectionButton")?.addEventListener("click", () => openSectionEditor(null, sectionId));
    $("addEntryButton")?.addEventListener("click", () => openEntryEditor(null, sectionId));
    $("editSectionButton")?.addEventListener("click", () => openSectionEditor(sectionId));
  }

  function renderHome() {
    const roots = childrenOf(null);
    const entries = visibleEntries();
    const canon = entries.filter(e => e.status === "canon").length;
    const secret = authorMode ? entries.filter(e => e.visibility === "author-only").length : 0;
    const latest = [...entries].sort((a,b) => String(b.updatedAt || "").localeCompare(String(a.updatedAt || ""))).slice(0, 8);

    content.innerHTML = `
      <section class="hero">
        <div class="hero-copy">
          <p class="eyebrow">CAE LUM ARCHIVE</p>
          <h1>World Bible</h1>
          <p>ฐานข้อมูลหลังบ้านของ CaeLum สำหรับเก็บว่าโลกนี้ทำงานอย่างไร เหตุใดรายละเอียดแต่ละอย่างจึงสำคัญต่อเรื่อง และอะไรคือสิ่งที่ผู้อ่านยังไม่ควรรู้</p>
        </div>
        ${heroActionsHtml()}
      </section>
      ${authorBannerHtml()}
      <section class="stats">
        <div class="stat-card"><span>ข้อมูลที่มองเห็น</span><strong>${entries.length}</strong></div>
        <div class="stat-card"><span>หมวดทั้งหมด</span><strong>${visibleSections().length}</strong></div>
        <div class="stat-card"><span>Canon</span><strong>${canon}</strong></div>
        <div class="stat-card"><span>${authorMode ? "Author Only" : "หมวดหลัก"}</span><strong>${authorMode ? secret : roots.length}</strong></div>
      </section>
      ${groupedRootsHtml(roots)}
      <div class="section-head"><div><h2>ข้อมูลล่าสุด</h2><p>${latest.length} รายการ</p></div></div>
      <section class="cards">${latest.length ? latest.map(entryCardHtml).join("") : '<div class="empty">ยังไม่มีข้อมูล</div>'}</section>
    `;
    bindHeroActions();
    bindCards();
    bindSectionCards();
    bindAuthorBanner();
  }

  function authorBannerHtml() {
    if (!authorMode) return "";
    return '<div class="author-panel"><div><strong>Author Mode เปิดอยู่</strong><span>เพิ่มหมวด หมวดย่อย และข้อมูลใหม่ได้ทั้งหมด การบันทึกจะ Commit กลับ GitHub โดยตรง</span></div>' +
      '<button class="secondary-btn" id="logoutButton" type="button">ออกจาก Author Mode</button></div>';
  }

  function bindAuthorBanner() {
    $("logoutButton")?.addEventListener("click", logoutAuthor);
  }

  function renderAllEntries() {
    const list = visibleEntries().sort((a,b) => a.title.localeCompare(b.title,"th"));
    content.innerHTML = `
      <section class="hero">
        <div class="hero-copy"><p class="eyebrow">ALL ENTRIES</p><h1>ข้อมูลทั้งหมด</h1><p>รายการข้อมูลทั้งหมดที่คุณมองเห็นในตอนนี้</p></div>
        ${heroActionsHtml()}
      </section>
      ${authorBannerHtml()}
      <section class="cards">${list.length ? list.map(entryCardHtml).join("") : '<div class="empty">ยังไม่มีข้อมูล</div>'}</section>
    `;
    bindHeroActions();
    bindCards();
    bindAuthorBanner();
  }

  function renderSection(sectionId) {
    const section = sectionById(sectionId);
    if (!section || !isVisible(section)) {
      currentSectionId = "home";
      return renderHome();
    }
    const children = childrenOf(sectionId);
    const entries = entriesIn(sectionId, false).sort((a,b) => a.title.localeCompare(b.title,"th"));
    const featured = entries.find(e => e.featured) || null;
    const remaining = featured ? entries.filter(e => e.id !== featured.id) : entries;
    const breadcrumbs = breadcrumbHtml(sectionId);

    content.innerHTML = `
      <div class="breadcrumbs">${breadcrumbs}</div>
      <section class="hero">
        <div class="hero-copy">
          <p class="eyebrow">WORLD SECTION</p>
          <h1>${esc(section.icon || "•")} ${esc(section.name)}</h1>
          <p>${esc(section.description || "หมวดข้อมูลของโลก CaeLum")}</p>
        </div>
        ${heroActionsHtml(sectionId)}
      </section>
      ${authorBannerHtml()}
      ${section.importance ? '<section class="world-importance"><p class="eyebrow">WHY IT MATTERS</p><h2>ความสำคัญต่อโลกและเนื้อเรื่อง</h2><div class="prose">' + esc(section.importance) + '</div></section>' : ''}
      ${featured ? featuredEntryHtml(featured) : ''}
      ${children.length ? '<div class="section-head"><div><h2>หัวข้อย่อย</h2><p>ใช้เมื่อเรื่องนี้มีรายละเอียดที่ควรแยกจริง ๆ ไม่ใช่บังคับให้กดหลายชั้น</p></div></div><section class="section-grid">' + children.map(sectionCardHtml).join("") + '</section>' : ''}
      ${remaining.length || (!featured && !entries.length) ? '<div class="section-head"><div><h2>ข้อมูลเพิ่มเติม</h2><p>' + remaining.length + ' รายการ</p></div></div><section class="cards">' + (remaining.length ? remaining.map(entryCardHtml).join("") : '<div class="empty">ยังไม่มีข้อมูลเพิ่มเติมในหมวดนี้' + (authorMode ? '<br><small>กด “+ เพิ่มข้อมูล” เพื่อเริ่มเขียน</small>' : '') + '</div>') + '</section>' : ''}
    `;
    bindHeroActions(sectionId);
    bindCards();
    bindSectionCards();
    bindBreadcrumbs();
    bindAuthorBanner();
    bindFeaturedEntry();
  }

  function featuredEntryHtml(entry) {
    const tags = (entry.tags || []).map(t => '<span class="badge">' + esc(t) + '</span>').join("");
    return `<article class="section-feature">
      <div class="section-feature-head">
        <div>
          <p class="eyebrow">CORE ENTRY</p>
          <h2>${esc(entry.title)}</h2>
          <div class="badges"><span class="badge ${esc(entry.status || "draft")}">${statusLabel(entry.status)}</span>${entry.visibility === "author-only" ? '<span class="badge">Author Only</span>' : ''}${tags}</div>
        </div>
        ${authorMode ? '<button class="secondary-btn" data-edit-feature="' + esc(entry.id) + '" type="button">แก้ไขเนื้อหา</button>' : ''}
      </div>
      <p class="section-feature-summary">${esc(entry.summary || "")}</p>
      <div class="section-feature-prose">${esc(entry.details || "—")}</div>
      ${authorMode && entry.openQuestions ? '<div class="section-feature-questions"><strong>สิ่งที่ยังไม่ล็อก</strong><div>' + esc(entry.openQuestions) + '</div></div>' : ''}
    </article>`;
  }

  function bindFeaturedEntry() {
    content.querySelectorAll("[data-edit-feature]").forEach(btn => {
      btn.addEventListener("click", () => openEntryEditor(btn.dataset.editFeature));
    });
  }

  function breadcrumbHtml(sectionId) {
    const chain = ancestorChain(sectionId);
    let html = '<button data-crumb="home">World Bible</button>';
    for (const s of chain) {
      html += '<span class="breadcrumb-sep">/</span><button data-crumb="' + esc(s.id) + '">' + esc(s.name) + '</button>';
    }
    return html;
  }

  function bindBreadcrumbs() {
    content.querySelectorAll("[data-crumb]").forEach(btn => {
      btn.addEventListener("click", () => {
        currentEntryId = null;
        currentSectionId = btn.dataset.crumb;
        renderAll();
      });
    });
  }

  function sectionCardHtml(section) {
    return `<article class="section-card" data-section-card="${esc(section.id)}">
      <div class="section-card-top">
        <div class="section-card-icon">${esc(section.icon || "•")}</div>
        <h3>${esc(section.name)}</h3>
        <span class="section-count">${countUnder(section.id)}</span>
      </div>
      <p>${esc(section.description || "หมวดย่อยของโลก CaeLum")}</p>
    </article>`;
  }

  function bindSectionCards() {
    content.querySelectorAll("[data-section-card]").forEach(card => {
      card.addEventListener("click", () => {
        currentEntryId = null;
        currentSectionId = card.dataset.sectionCard;
        expanded.add(currentSectionId);
        renderAll();
        window.scrollTo({top:0,behavior:"smooth"});
      });
    });
  }

  function entryCardHtml(entry) {
    const section = sectionById(entry.sectionId);
    const tags = (entry.tags || []).slice(0, 4).map(t => '<span class="badge">' + esc(t) + '</span>').join("");
    return `<article class="entry-card" data-entry-id="${esc(entry.id)}">
      <div class="card-top">
        <span class="category-chip">${esc(section?.icon || "•")} ${esc(section?.name || "ไม่มีหมวด")}</span>
        ${entry.visibility === "author-only" ? '<span class="visibility-lock">Author Only</span>' : ''}
      </div>
      <h3>${esc(entry.title)}</h3>
      <p>${esc(entry.summary || "ยังไม่มีสรุป")}</p>
      <div class="badges"><span class="badge ${esc(entry.status || "draft")}">${statusLabel(entry.status)}</span>${tags}</div>
    </article>`;
  }

  function bindCards() {
    content.querySelectorAll("[data-entry-id]").forEach(card => {
      card.addEventListener("click", () => {
        currentEntryId = card.dataset.entryId;
        renderContent();
        window.scrollTo({top:0,behavior:"smooth"});
      });
    });
  }

  function renderSearch(query) {
    const results = visibleEntries().filter(e => {
      const section = sectionById(e.sectionId);
      const text = [e.title,e.summary,e.details,e.openQuestions,section?.name,section?.description,section?.importance,...(e.tags||[]),...(e.links||[])].join(" ").toLowerCase();
      return text.includes(query);
    }).sort((a,b) => a.title.localeCompare(b.title,"th"));

    content.innerHTML = `
      <section class="hero">
        <div class="hero-copy"><p class="eyebrow">SEARCH</p><h1>ผลการค้นหา</h1><p>ค้นหาจากชื่อ รายละเอียด Tags หมวด และข้อมูลที่เชื่อมโยง</p></div>
        ${heroActionsHtml(currentSectionId !== "home" && currentSectionId !== "all" ? currentSectionId : null)}
      </section>
      <div class="search-summary">พบ ${results.length} รายการสำหรับ “${esc(searchInput.value.trim())}”</div>
      <section class="cards">${results.length ? results.map(entryCardHtml).join("") : '<div class="empty">ไม่พบข้อมูลที่ตรงกับคำค้น</div>'}</section>
    `;
    bindHeroActions(currentSectionId !== "home" && currentSectionId !== "all" ? currentSectionId : null);
    bindCards();
  }

  function renderEntryDetail(id) {
    const entry = entryById(id);
    if (!entry || !isVisible(entry)) {
      currentEntryId = null;
      return renderContent();
    }
    const section = sectionById(entry.sectionId);
    const links = (entry.links || []).map(x => '<span class="link-pill">' + esc(x) + '</span>').join("");
    const tags = (entry.tags || []).map(t => '<span class="badge">' + esc(t) + '</span>').join("");

    content.innerHTML = `
      <div class="detail-shell">
        <div class="breadcrumbs">${section ? breadcrumbHtml(section.id) : '<button data-crumb="home">World Bible</button>'}</div>
        <button class="back-btn" id="backButton" type="button">← กลับ</button>
        <article class="detail-card">
          <div class="detail-title-row">
            <div>
              <p class="eyebrow">${esc(section?.icon || "•")} ${esc(section?.name || "ไม่มีหมวด")}</p>
              <h1>${esc(entry.title)}</h1>
              <div class="badges">
                <span class="badge ${esc(entry.status || "draft")}">${statusLabel(entry.status)}</span>
                ${entry.visibility === "author-only" ? '<span class="badge">Author Only</span>' : ''}
                ${tags}
              </div>
            </div>
            ${authorMode ? '<button class="primary-btn" id="editEntryButton" type="button">แก้ไข</button>' : ''}
          </div>
          <p class="detail-summary">${esc(entry.summary || "—")}</p>
          <section class="detail-section"><h3>รายละเอียด</h3><div class="prose">${esc(entry.details || "—")}</div></section>
          ${links ? '<section class="detail-section"><h3>เชื่อมโยงกับ</h3><div class="detail-links">' + links + '</div></section>' : ''}
          ${authorMode && entry.openQuestions ? '<section class="detail-section"><h3>คำถามที่ยังไม่ล็อก / ช่องโหว่</h3><div class="prose">' + esc(entry.openQuestions) + '</div></section>' : ''}
        </article>
      </div>
    `;
    $("backButton").addEventListener("click", () => {
      currentEntryId = null;
      currentSectionId = entry.sectionId || "home";
      renderAll();
    });
    $("editEntryButton")?.addEventListener("click", () => openEntryEditor(entry.id));
    bindBreadcrumbs();
  }

  async function verifyToken(token) {
    const response = await fetch("https://api.github.com/user", {
      headers: {
        "Accept": "application/vnd.github+json",
        "Authorization": "Bearer " + token,
        "X-GitHub-Api-Version": "2022-11-28"
      }
    });
    if (!response.ok) throw new Error("Token ใช้งานไม่ได้หรือหมดอายุ");
    const user = await response.json();
    if (user.login !== CONFIG.owner) throw new Error("Author Mode อนุญาตเฉพาะเจ้าของ CaeLum");
    return user;
  }

  async function enterAuthorMode() {
    const token = $("tokenInput").value.trim();
    if (!token) return toast("ใส่ GitHub Token ก่อน", "error");
    const button = $("loginButton");
    setBusy(button, true, "กำลังตรวจสอบ…");
    try {
      await verifyToken(token);
      adminToken = token;
      sessionStorage.setItem("caelum_admin_token", token);
      authorMode = true;
      adminModal.close();
      $("tokenInput").value = "";
      await loadLatestFromGitHub();
      renderAll();
      toast("เข้าสู่ Author Mode แล้ว", "success");
    } catch (error) {
      toast(error.message || "เข้าสู่ระบบไม่สำเร็จ", "error");
    } finally {
      setBusy(button, false);
    }
  }

  function logoutAuthor() {
    adminToken = "";
    authorMode = false;
    remoteSha = "";
    sessionStorage.removeItem("caelum_admin_token");
    currentEntryId = null;
    setModeUi();
    reloadData();
    toast("ออกจาก Author Mode แล้ว");
  }

  function setModeUi() {
    $("modeBadge").textContent = authorMode ? "Author" : "Public";
    $("modeBadge").classList.toggle("author", authorMode);
    $("adminButton").textContent = authorMode ? "Author Mode ✓" : "Author Mode";
  }

  async function githubFile() {
    const response = await fetch("https://api.github.com/repos/" + CONFIG.owner + "/" + CONFIG.repo + "/contents/" + CONFIG.dataPath + "?ref=" + encodeURIComponent(CONFIG.branch) + "&t=" + Date.now(), {
      cache: "no-store",
      headers: {
        "Accept": "application/vnd.github+json",
        "Authorization": "Bearer " + adminToken,
        "X-GitHub-Api-Version": "2022-11-28"
      }
    });
    if (!response.ok) throw new Error("อ่านข้อมูลล่าสุดจาก GitHub ไม่สำเร็จ");
    return response.json();
  }

  async function loadLatestFromGitHub() {
    const file = await githubFile();
    remoteSha = file.sha;
    db = normalizeDb(JSON.parse(base64ToUtf8(file.content.replace(/\n/g, ""))));
    $("versionLabel").textContent = "Data v" + (db.version || 1);
  }

  async function saveDatabase(message) {
    if (!authorMode || !adminToken) throw new Error("ต้องเข้า Author Mode ก่อน");

    const file = await githubFile();
    remoteSha = file.sha;
    db.project = db.project || {};
    db.project.updatedAt = new Date().toISOString();
    db.version = (Number(db.version) || 1) + 1;

    const response = await fetch("https://api.github.com/repos/" + CONFIG.owner + "/" + CONFIG.repo + "/contents/" + CONFIG.dataPath, {
      method: "PUT",
      headers: {
        "Accept": "application/vnd.github+json",
        "Authorization": "Bearer " + adminToken,
        "X-GitHub-Api-Version": "2022-11-28",
        "Content-Type": "application/json"
      },
      body: JSON.stringify({
        message: message || "Update CaeLum World Bible",
        content: utf8ToBase64(JSON.stringify(db, null, 2)),
        sha: remoteSha,
        branch: CONFIG.branch
      })
    });

    if (!response.ok) {
      let msg = "";
      try { msg = (await response.json()).message || ""; } catch {}
      throw new Error("GitHub บันทึกไม่สำเร็จ" + (msg ? ": " + msg : ""));
    }
    const result = await response.json();
    remoteSha = result.content?.sha || "";
    $("versionLabel").textContent = "Data v" + db.version;
    return result;
  }

  function utf8ToBase64(text) {
    const bytes = new TextEncoder().encode(text);
    let binary = "";
    for (let i = 0; i < bytes.length; i += 0x8000) binary += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
    return btoa(binary);
  }

  function base64ToUtf8(value) {
    const binary = atob(value);
    return new TextDecoder().decode(Uint8Array.from(binary, ch => ch.charCodeAt(0)));
  }

  function sectionOptions(selectedId = "", excludeId = null, includeRoot = false) {
    let html = includeRoot ? '<option value="">— หมวดหลัก —</option>' : "";
    const walk = (parentId, depth) => {
      for (const s of (db.sections || []).filter(x => (x.parentId || null) === (parentId || null)).sort((a,b)=>(a.sort||0)-(b.sort||0))) {
        if (s.id === excludeId) continue;
        const prefix = "— ".repeat(depth);
        html += '<option value="' + esc(s.id) + '"' + (s.id === selectedId ? " selected" : "") + '>' + prefix + esc(s.name) + '</option>';
        walk(s.id, depth + 1);
      }
    };
    walk(null, 0);
    return html;
  }

  function openEntryEditor(id = null, defaultSectionId = null) {
    if (!authorMode) return;
    editingEntryId = id;
    const entry = id ? entryById(id) : null;
    $("editorHeading").textContent = entry ? "แก้ไขข้อมูล" : "เพิ่มข้อมูล";
    $("entrySection").innerHTML = sectionOptions(entry?.sectionId || defaultSectionId || firstPublicSectionId());
    $("entryTitle").value = entry?.title || "";
    $("entryStatus").value = entry?.status || "draft";
    $("entryVisibility").value = entry?.visibility || "public";
    $("entryTags").value = (entry?.tags || []).join(", ");
    $("entrySummary").value = entry?.summary || "";
    $("entryFeatured").checked = Boolean(entry?.featured);
    $("entryDetails").value = entry?.details || "";
    $("entryLinks").value = (entry?.links || []).join(", ");
    $("entryQuestions").value = entry?.openQuestions || "";
    $("deleteEntryButton").style.visibility = entry ? "visible" : "hidden";
    editorModal.showModal();
  }

  function firstPublicSectionId() {
    return (db.sections || []).find(s => s.visibility !== "author-only")?.id || "";
  }

  async function saveEntry() {
    const title = $("entryTitle").value.trim();
    const sectionId = $("entrySection").value;
    if (!title) return toast("ใส่ชื่อหัวข้อก่อน", "error");
    if (!sectionId) return toast("เลือกหมวดก่อน", "error");

    const next = {
      id: editingEntryId || uid("entry"),
      sectionId,
      title,
      visibility: $("entryVisibility").value,
      status: $("entryStatus").value,
      tags: $("entryTags").value.split(",").map(x => x.trim()).filter(Boolean),
      summary: $("entrySummary").value.trim(),
      details: $("entryDetails").value.trim(),
      links: $("entryLinks").value.split(",").map(x => x.trim()).filter(Boolean),
      openQuestions: $("entryQuestions").value.trim(),
      featured: $("entryFeatured").checked,
      updatedAt: new Date().toISOString()
    };

    const backup = JSON.parse(JSON.stringify(db));
    if (next.featured) {
      for (const e of db.entries) {
        if (e.sectionId === next.sectionId && e.id !== next.id) e.featured = false;
      }
    }
    if (editingEntryId) {
      const i = db.entries.findIndex(e => e.id === editingEntryId);
      if (i >= 0) db.entries[i] = next;
    } else db.entries.push(next);

    const button = $("saveEntryButton");
    setBusy(button, true, "กำลังบันทึก…");
    try {
      await saveDatabase((editingEntryId ? "Update entry: " : "Add entry: ") + title);
      editingEntryId = next.id;
      currentEntryId = next.id;
      currentSectionId = next.sectionId;
      editorModal.close();
      renderAll();
      toast("บันทึกแล้ว — รีเฟรชหน้าเว็บก็จะอ่านข้อมูลล่าสุดจาก GitHub", "success");
    } catch (error) {
      db = backup;
      toast(error.message || "บันทึกไม่สำเร็จ", "error");
    } finally {
      setBusy(button, false);
    }
  }

  async function deleteEntry() {
    const entry = entryById(editingEntryId);
    if (!entry || !confirm('ลบ "' + entry.title + '" ?')) return;
    const backup = JSON.parse(JSON.stringify(db));
    db.entries = db.entries.filter(e => e.id !== editingEntryId);
    const button = $("deleteEntryButton");
    setBusy(button, true, "กำลังลบ…");
    try {
      await saveDatabase("Delete entry: " + entry.title);
      editorModal.close();
      currentEntryId = null;
      editingEntryId = null;
      renderAll();
      toast("ลบข้อมูลแล้ว", "success");
    } catch (error) {
      db = backup;
      toast(error.message || "ลบไม่สำเร็จ", "error");
    } finally {
      setBusy(button, false);
    }
  }

  function openSectionEditor(id = null, defaultParentId = null) {
    if (!authorMode) return;
    editingSectionId = id;
    const section = id ? sectionById(id) : null;
    $("sectionHeading").textContent = section ? "แก้ไขหมวด" : "เพิ่มหมวด";
    $("sectionName").value = section?.name || "";
    $("sectionIcon").value = section?.icon || "•";
    $("sectionVisibility").value = section?.visibility || "public";
    $("sectionSort").value = Number(section?.sort ?? 100);
    $("sectionDescription").value = section?.description || "";
    $("sectionImportance").value = section?.importance || "";
    $("sectionParent").innerHTML = sectionOptions(section?.parentId || defaultParentId || "", id, true);
    $("deleteSectionButton").style.visibility = section ? "visible" : "hidden";
    sectionModal.showModal();
  }

  function wouldCreateCycle(sectionId, parentId) {
    if (!sectionId || !parentId) return false;
    if (sectionId === parentId) return true;
    let cur = sectionById(parentId);
    const seen = new Set();
    while (cur && !seen.has(cur.id)) {
      if (cur.id === sectionId) return true;
      seen.add(cur.id);
      cur = cur.parentId ? sectionById(cur.parentId) : null;
    }
    return false;
  }

  async function saveSection() {
    const name = $("sectionName").value.trim();
    const parentId = $("sectionParent").value || null;
    if (!name) return toast("ใส่ชื่อหมวดก่อน", "error");
    if (wouldCreateCycle(editingSectionId, parentId)) return toast("ไม่สามารถย้ายหมวดเข้าไปอยู่ในหมวดย่อยของตัวเองได้", "error");

    const next = {
      id: editingSectionId || uid("section"),
      name,
      icon: $("sectionIcon").value.trim() || "•",
      parentId,
      visibility: $("sectionVisibility").value,
      sort: Number($("sectionSort").value) || 100,
      description: $("sectionDescription").value.trim(),
      importance: $("sectionImportance").value.trim(),
      group: parentId ? sectionGroupId(parentId) : (sectionById(editingSectionId)?.group || "other")
    };

    const backup = JSON.parse(JSON.stringify(db));
    if (editingSectionId) {
      const i = db.sections.findIndex(s => s.id === editingSectionId);
      if (i >= 0) db.sections[i] = next;
    } else db.sections.push(next);

    const button = $("saveSectionButton");
    setBusy(button, true, "กำลังบันทึก…");
    try {
      await saveDatabase((editingSectionId ? "Update section: " : "Add section: ") + name);
      editingSectionId = next.id;
      currentSectionId = next.id;
      currentEntryId = null;
      expanded.add(next.id);
      if (next.parentId) expanded.add(next.parentId);
      sectionModal.close();
      renderAll();
      toast("บันทึกหมวดแล้ว", "success");
    } catch (error) {
      db = backup;
      toast(error.message || "บันทึกหมวดไม่สำเร็จ", "error");
    } finally {
      setBusy(button, false);
    }
  }

  async function deleteSection() {
    const section = sectionById(editingSectionId);
    if (!section) return;
    const kids = (db.sections || []).filter(s => s.parentId === section.id);
    const entries = (db.entries || []).filter(e => e.sectionId === section.id);
    if (kids.length || entries.length) {
      return toast("ลบไม่ได้: ต้องย้ายหรือลบหมวดย่อยและข้อมูลในหมวดนี้ก่อน", "error");
    }
    if (!confirm('ลบหมวด "' + section.name + '" ?')) return;
    const backup = JSON.parse(JSON.stringify(db));
    db.sections = db.sections.filter(s => s.id !== section.id);
    const button = $("deleteSectionButton");
    setBusy(button, true, "กำลังลบ…");
    try {
      await saveDatabase("Delete section: " + section.name);
      sectionModal.close();
      currentSectionId = section.parentId || "home";
      editingSectionId = null;
      renderAll();
      toast("ลบหมวดแล้ว", "success");
    } catch (error) {
      db = backup;
      toast(error.message || "ลบหมวดไม่สำเร็จ", "error");
    } finally {
      setBusy(button, false);
    }
  }

  async function restoreSession() {
    if (!adminToken) return;
    try {
      await verifyToken(adminToken);
      authorMode = true;
      await loadLatestFromGitHub();
      renderAll();
    } catch {
      sessionStorage.removeItem("caelum_admin_token");
      adminToken = "";
      authorMode = false;
      setModeUi();
    }
  }

  document.querySelectorAll("[data-close]").forEach(btn => {
    btn.addEventListener("click", () => $(btn.dataset.close)?.close());
  });
  $("menuButton").addEventListener("click", () => document.body.classList.toggle("nav-open"));
  $("mobileBackdrop").addEventListener("click", closeMobileNav);
  searchInput.addEventListener("input", () => {
    currentEntryId = null;
    renderContent();
  });
  $("refreshButton").addEventListener("click", async () => {
    await reloadData();
    toast("โหลดข้อมูลล่าสุดแล้ว", "success");
  });
  $("adminButton").addEventListener("click", () => {
    if (authorMode) return toast("Author Mode เปิดอยู่แล้ว");
    adminModal.showModal();
    setTimeout(() => $("tokenInput").focus(), 30);
  });
  $("loginButton").addEventListener("click", enterAuthorMode);
  $("tokenInput").addEventListener("keydown", e => {
    if (e.key === "Enter") { e.preventDefault(); enterAuthorMode(); }
  });
  $("saveEntryButton").addEventListener("click", saveEntry);
  $("deleteEntryButton").addEventListener("click", deleteEntry);
  $("saveSectionButton").addEventListener("click", saveSection);
  $("deleteSectionButton").addEventListener("click", deleteSection);

  (async () => {
    try {
      await loadPublicData();
      for (const root of childrenOf(null).slice(0, 5)) expanded.add(root.id);
      renderAll();
      await restoreSession();
    } catch (error) {
      content.innerHTML = '<div class="empty">ไม่สามารถโหลดฐานข้อมูลได้</div>';
      toast(error.message || "เริ่มต้นเว็บไม่สำเร็จ", "error");
    }
  })();
})();