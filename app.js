(() => {
  "use strict";

  const CONFIG = {
    owner: "sanaisawan63x2",
    repo: "CaeLum",
    branch: "main",
    dataPath: "data/world.json",
    rawDataUrl: "./data/world.json"
  };

  const CATEGORY_GROUPS = [
    {
      label: "แกนโลก",
      items: [
        ["overview","ภาพรวมโลก","◈","Premise, กฎพื้นฐาน, สิ่งที่สังคมเชื่อ และสิ่งที่ผู้เขียนรู้"],
        ["timeline","ประวัติศาสตร์ / Timeline","◷","เหตุการณ์สำคัญ ลำดับเวลา สาเหตุ ผลกระทบ และความทรงจำของสังคม"],
        ["magic","ระบบเวทมนตร์","✦","Mana, กฎการใช้เวท, ข้อจำกัด, การฟื้นฟู และผลต่อโลก"],
        ["disciplines","ศาสตร์และแขนงเวท","⌘","รูน ยันต์ ธาตุ วิญญาณ คำสาป และศาสตร์เฉพาะวัฒนธรรม"]
      ]
    },
    {
      label: "สถาบันและผู้คน",
      items: [
        ["education","CaeLum / การศึกษา","▣","คณะ สาขา วิชา การสอบ กฎ อาคาร และชีวิตนักศึกษา"],
        ["organizations","องค์กร / I.A.D.C.","◇","โครงสร้าง แผนก อำนาจ ขั้นตอนปฏิบัติ และสาขาระหว่างประเทศ"],
        ["characters","ตัวละคร","◉","ภูมิหลัง บุคลิก เป้าหมาย ความสัมพันธ์ สิ่งที่รู้ และสิ่งที่เข้าใจผิด"]
      ]
    },
    {
      label: "โลกที่ใช้ชีวิต",
      items: [
        ["locations","สถานที่","⌂","เมือง เขต อาคาร พื้นที่อันตราย จุดสำคัญ และบรรยากาศ"],
        ["society","สังคม / วัฒนธรรม","◎","ชีวิตประจำวัน สื่อ ความเชื่อ กีฬา บันเทิง ชนชั้น และวัฒนธรรม"],
        ["economy","เศรษฐกิจ / อุตสาหกรรม","◫","สินค้า ราคา อาชีพ บริษัท Supply chain ตลาดแรงงาน และ Demand/Supply"],
        ["law","กฎหมาย / การปกครอง","⚖","กฎหมายเวท ใบอนุญาต หน่วยงานบังคับใช้ อำนาจรัฐ และความร่วมมือระหว่างประเทศ"],
        ["technology","เทคโนโลยี / Magitech","⚙","อุปกรณ์เวท ระบบรักษาความปลอดภัย การขนส่ง การแพทย์ และงานวิจัย"],
        ["items","ไอเทม / Artifact","▱","ของใช้ เครื่องราง ยา อาวุธ วัตถุพิเศษ ผู้ผลิต ราคา และข้อจำกัด"]
      ]
    },
    {
      label: "ภัยและเนื้อเรื่อง",
      items: [
        ["monsters","มอนสเตอร์","◆","ประเภท ระดับภัย พฤติกรรม จุดอ่อน แหล่งกำเนิด และผลกระทบต่อสังคม"],
        ["story","เหตุการณ์ / ปมเรื่อง","◌","เหตุการณ์สำคัญ คดี ความขัดแย้ง เบาะแส และผลที่ตามมา"],
        ["secrets","Author Secrets","☒","ความจริงที่คนอ่านยังไม่ควรรู้ ใครรู้ความลับ หลักฐาน และจังหวะการเฉลย"]
      ]
    }
  ];

  const CATEGORY_MAP = Object.fromEntries(
    CATEGORY_GROUPS.flatMap(group =>
      group.items.map(([id,name,icon,prompt]) => [id,{id,name,icon,prompt}])
    )
  );

  let db = {version:1, project:{name:"CaeLum"}, entries:[]};
  let currentCategory = "all";
  let currentEntryId = null;
  let editingId = null;
  let adminToken = sessionStorage.getItem("caelum_admin_token") || "";
  let authorMode = false;
  let remoteSha = "";

  const $ = (id) => document.getElementById(id);
  const content = $("content");
  const categoryNav = $("categoryNav");
  const searchInput = $("searchInput");
  const adminModal = $("adminModal");
  const editorModal = $("editorModal");

  function escapeHtml(value="") {
    return String(value).replace(/[&<>"']/g, c => ({
      "&":"&amp;","<":"&lt;",">":"&gt;","\"":"&quot;","'":"&#039;"
    })[c]);
  }

  function newId() {
    return (crypto.randomUUID ? crypto.randomUUID() : "entry-" + Date.now() + "-" + Math.random().toString(16).slice(2));
  }

  function cat(id) {
    return CATEGORY_MAP[id] || {id,name:"อื่น ๆ",icon:"•",prompt:""};
  }

  function visibleEntries() {
    return (db.entries || []).filter(entry => authorMode || entry.visibility !== "author-only");
  }

  function statusLabel(status) {
    return status === "canon" ? "Canon" : status === "idea" ? "Idea" : "Draft";
  }

  function showToast(message, type="") {
    const node = document.createElement("div");
    node.className = "toast " + type;
    node.textContent = message;
    $("toastStack").appendChild(node);
    setTimeout(() => node.remove(), 3600);
  }

  function setBusy(button, busy, label) {
    if (!button) return;
    if (busy) {
      button.dataset.oldText = button.textContent;
      button.textContent = label || "กำลังทำงาน…";
      button.disabled = true;
    } else {
      button.textContent = button.dataset.oldText || button.textContent;
      button.disabled = false;
    }
  }

  async function loadData() {
    try {
      const response = await fetch(CONFIG.rawDataUrl + "?v=" + Date.now(), {cache:"no-store"});
      if (!response.ok) throw new Error("โหลดฐานข้อมูลไม่สำเร็จ");
      db = await response.json();
      $("versionLabel").textContent = "Data v" + (db.version || 1);
      renderNav();
      render();
    } catch (error) {
      content.innerHTML = '<div class="empty">ไม่สามารถโหลด data/world.json ได้<br><small>ลองกดรีเฟรชอีกครั้ง</small></div>';
      showToast(error.message, "error");
    }
  }

  function renderNav() {
    const visible = visibleEntries();
    const total = visible.length;
    let html = '<button class="nav-btn ' + (currentCategory === "all" ? "active" : "") + '" data-category="all"><span class="nav-icon">▦</span><span class="nav-label">ทั้งหมด</span><span class="nav-count">' + total + '</span></button>';

    for (const group of CATEGORY_GROUPS) {
      html += '<div class="nav-section">' + escapeHtml(group.label) + '</div>';
      for (const [id,name,icon] of group.items) {
        const count = visible.filter(e => e.category === id).length;
        html += '<button class="nav-btn ' + (currentCategory === id ? "active" : "") + '" data-category="' + id + '"><span class="nav-icon">' + icon + '</span><span class="nav-label">' + escapeHtml(name) + '</span><span class="nav-count">' + count + '</span></button>';
      }
    }
    categoryNav.innerHTML = html;
    categoryNav.querySelectorAll("[data-category]").forEach(button => {
      button.addEventListener("click", () => {
        currentCategory = button.dataset.category;
        currentEntryId = null;
        closeMobileNav();
        renderNav();
        render();
      });
    });
  }

  function filteredEntries() {
    const query = searchInput.value.trim().toLowerCase();
    return visibleEntries()
      .filter(e => currentCategory === "all" || e.category === currentCategory)
      .filter(e => {
        if (!query) return true;
        const haystack = [
          e.title,e.summary,e.details,e.openQuestions,
          ...(e.tags || []),...(e.links || [])
        ].join(" ").toLowerCase();
        return haystack.includes(query);
      })
      .sort((a,b) => String(a.title).localeCompare(String(b.title),"th"));
  }

  function render() {
    if (currentEntryId) return renderDetail(currentEntryId);

    const entries = filteredEntries();
    const category = currentCategory === "all" ? null : cat(currentCategory);
    const visible = visibleEntries();
    const canon = visible.filter(e => e.status === "canon").length;
    const drafts = visible.filter(e => e.status === "draft").length;
    const secretCount = authorMode ? visible.filter(e => e.visibility === "author-only").length : 0;

    content.innerHTML = `
      <section class="hero">
        <div class="hero-copy">
          <p class="eyebrow">${category ? "WORLD CATEGORY" : "CAE LUM ARCHIVE"}</p>
          <h1>${category ? escapeHtml(category.name) : "World Bible"}</h1>
          <p>${category ? escapeHtml(category.prompt) : "คลังข้อมูลกลางของโลก CaeLum — เก็บรายละเอียดหลังบ้านให้มากพอที่จะทำให้เรื่องราว ตัวละคร สังคม และสถาบันต่าง ๆ ทำงานอย่างสอดคล้องกัน"}</p>
          ${category ? '<div class="prompt-box"><b>สิ่งที่ควรคิดในหมวดนี้:</b> ' + escapeHtml(category.prompt) + '</div>' : ""}
        </div>
        <div class="hero-actions">
          ${authorMode ? '<button class="secondary-btn" id="backupButton" type="button">Export Backup</button><button class="primary-btn" id="newEntryButton" type="button">+ เพิ่มข้อมูล</button>' : ""}
        </div>
      </section>

      ${authorMode ? `
        <div class="author-panel">
          <div><strong>Author Mode เปิดอยู่</strong><span>คุณเห็นข้อมูล Author Only และสามารถบันทึกการแก้ไขกลับเข้า GitHub ได้</span></div>
          <button class="secondary-btn" id="logoutButton" type="button">ออกจาก Author Mode</button>
        </div>
      ` : ""}

      <section class="stats">
        <div class="stat-card"><span>ข้อมูลที่มองเห็น</span><strong>${visible.length}</strong></div>
        <div class="stat-card"><span>Canon</span><strong>${canon}</strong></div>
        <div class="stat-card"><span>Draft</span><strong>${drafts}</strong></div>
        <div class="stat-card"><span>${authorMode ? "Author Only" : "หมวดข้อมูล"}</span><strong>${authorMode ? secretCount : Object.keys(CATEGORY_MAP).length}</strong></div>
      </section>

      <div class="section-head">
        <div>
          <h2>${category ? escapeHtml(category.name) : "รายการทั้งหมด"}</h2>
          <p>${entries.length} รายการ${searchInput.value ? " จากผลการค้นหา" : ""}</p>
        </div>
      </div>

      <section class="cards" id="cards">
        ${entries.length ? entries.map(entryCardHtml).join("") : '<div class="empty">ยังไม่มีข้อมูลในหมวดนี้</div>'}
      </section>
    `;

    content.querySelectorAll("[data-entry-id]").forEach(cardEl => {
      cardEl.addEventListener("click", () => {
        currentEntryId = cardEl.dataset.entryId;
        render();
        window.scrollTo({top:0,behavior:"smooth"});
      });
    });

    $("newEntryButton")?.addEventListener("click", () => openEditor());
    $("logoutButton")?.addEventListener("click", logoutAuthor);
    $("backupButton")?.addEventListener("click", exportBackup);
  }

  function entryCardHtml(entry) {
    const category = cat(entry.category);
    const tags = (entry.tags || []).slice(0,4).map(tag => '<span class="badge">' + escapeHtml(tag) + '</span>').join("");
    return `
      <article class="entry-card" data-entry-id="${escapeHtml(entry.id)}">
        <div class="card-top">
          <span class="category-chip">${category.icon} ${escapeHtml(category.name)}</span>
          ${entry.visibility === "author-only" ? '<span class="visibility-lock">Author Only</span>' : ""}
        </div>
        <h3>${escapeHtml(entry.title)}</h3>
        <p>${escapeHtml(entry.summary || "ยังไม่มีสรุป")}</p>
        <div class="badges">
          <span class="badge ${escapeHtml(entry.status || "draft")}">${statusLabel(entry.status)}</span>
          ${tags}
        </div>
      </article>
    `;
  }

  function renderDetail(id) {
    const entry = visibleEntries().find(e => e.id === id);
    if (!entry) {
      currentEntryId = null;
      return render();
    }
    const category = cat(entry.category);
    const links = (entry.links || []).map(link => '<span class="link-pill">' + escapeHtml(link) + '</span>').join("");
    const tags = (entry.tags || []).map(tag => '<span class="badge">' + escapeHtml(tag) + '</span>').join("");

    content.innerHTML = `
      <div class="detail-shell">
        <button class="back-btn" id="backButton" type="button">← กลับไปยังรายการ</button>
        <article class="detail-card">
          <div class="detail-title-row">
            <div>
              <p class="eyebrow">${category.icon} ${escapeHtml(category.name)}</p>
              <h1>${escapeHtml(entry.title)}</h1>
              <div class="badges">
                <span class="badge ${escapeHtml(entry.status || "draft")}">${statusLabel(entry.status)}</span>
                ${entry.visibility === "author-only" ? '<span class="badge">Author Only</span>' : ""}
                ${tags}
              </div>
            </div>
            ${authorMode ? '<button class="primary-btn" id="editEntryButton" type="button">แก้ไข</button>' : ""}
          </div>

          <p class="detail-summary">${escapeHtml(entry.summary || "—")}</p>

          <section class="detail-section">
            <h3>รายละเอียด</h3>
            <div class="prose">${escapeHtml(entry.details || "—")}</div>
          </section>

          ${links ? `<section class="detail-section"><h3>เชื่อมโยงกับ</h3><div class="detail-links">${links}</div></section>` : ""}

          ${authorMode && entry.openQuestions ? `
            <section class="detail-section">
              <h3>คำถามที่ยังไม่ล็อก / ช่องโหว่</h3>
              <div class="prose">${escapeHtml(entry.openQuestions)}</div>
            </section>
          ` : ""}
        </article>
      </div>
    `;

    $("backButton").addEventListener("click", () => {
      currentEntryId = null;
      render();
    });
    $("editEntryButton")?.addEventListener("click", () => openEditor(entry.id));
  }

  async function verifyToken(token) {
    const response = await fetch("https://api.github.com/user", {
      headers:{
        "Accept":"application/vnd.github+json",
        "Authorization":"Bearer " + token,
        "X-GitHub-Api-Version":"2022-11-28"
      }
    });
    if (!response.ok) throw new Error("Token ใช้งานไม่ได้หรือหมดอายุ");
    const user = await response.json();
    if (user.login !== CONFIG.owner) throw new Error("บัญชีนี้ไม่ใช่เจ้าของ CaeLum");
    return user;
  }

  async function enterAuthorMode() {
    const token = $("tokenInput").value.trim();
    if (!token) return showToast("ใส่ GitHub Token ก่อน", "error");

    const button = $("loginButton");
    setBusy(button,true,"กำลังตรวจสอบ…");
    try {
      await verifyToken(token);
      adminToken = token;
      sessionStorage.setItem("caelum_admin_token", token);
      authorMode = true;
      adminModal.close();
      $("tokenInput").value = "";
      setModeUi();
      await loadLatestFromGitHub();
      currentEntryId = null;
      renderNav();
      render();
      showToast("เข้าสู่ Author Mode แล้ว", "success");
    } catch (error) {
      showToast(error.message || "เข้าสู่ระบบไม่สำเร็จ", "error");
    } finally {
      setBusy(button,false);
    }
  }

  function logoutAuthor() {
    adminToken = "";
    authorMode = false;
    remoteSha = "";
    sessionStorage.removeItem("caelum_admin_token");
    currentEntryId = null;
    setModeUi();
    loadData();
    showToast("ออกจาก Author Mode แล้ว");
  }

  function setModeUi() {
    $("modeBadge").textContent = authorMode ? "Author" : "Public";
    $("modeBadge").classList.toggle("author", authorMode);
    $("adminButton").textContent = authorMode ? "Author Mode ✓" : "Author Mode";
  }

  async function loadLatestFromGitHub() {
    if (!adminToken) return;
    const url = "https://api.github.com/repos/" + CONFIG.owner + "/" + CONFIG.repo + "/contents/" + CONFIG.dataPath + "?ref=" + encodeURIComponent(CONFIG.branch);
    const response = await fetch(url, {
      headers:{
        "Accept":"application/vnd.github+json",
        "Authorization":"Bearer " + adminToken,
        "X-GitHub-Api-Version":"2022-11-28"
      }
    });
    if (!response.ok) throw new Error("อ่านข้อมูลล่าสุดจาก GitHub ไม่สำเร็จ");
    const file = await response.json();
    remoteSha = file.sha;
    db = JSON.parse(base64ToUtf8(file.content.replace(/\n/g,"")));
    $("versionLabel").textContent = "Data v" + (db.version || 1);
  }

  async function saveDatabase(commitMessage) {
    if (!authorMode || !adminToken) throw new Error("ต้องเข้า Author Mode ก่อน");

    // อ่าน SHA ล่าสุดทุกครั้งเพื่อป้องกันการเขียนทับ revision เก่า
    await loadLatestShaOnly();

    db.project = db.project || {};
    db.project.updatedAt = new Date().toISOString();
    db.version = (Number(db.version) || 1) + 1;

    const url = "https://api.github.com/repos/" + CONFIG.owner + "/" + CONFIG.repo + "/contents/" + CONFIG.dataPath;
    const response = await fetch(url, {
      method:"PUT",
      headers:{
        "Accept":"application/vnd.github+json",
        "Authorization":"Bearer " + adminToken,
        "X-GitHub-Api-Version":"2022-11-28",
        "Content-Type":"application/json"
      },
      body:JSON.stringify({
        message:commitMessage || "Update CaeLum world bible",
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
    $("versionLabel").textContent = "Data v" + db.version;
    return result;
  }

  async function loadLatestShaOnly() {
    const url = "https://api.github.com/repos/" + CONFIG.owner + "/" + CONFIG.repo + "/contents/" + CONFIG.dataPath + "?ref=" + encodeURIComponent(CONFIG.branch);
    const response = await fetch(url, {
      headers:{
        "Accept":"application/vnd.github+json",
        "Authorization":"Bearer " + adminToken,
        "X-GitHub-Api-Version":"2022-11-28"
      }
    });
    if (!response.ok) throw new Error("ตรวจสอบ revision ล่าสุดไม่ได้");
    const file = await response.json();
    remoteSha = file.sha;
  }

  function utf8ToBase64(text) {
    const bytes = new TextEncoder().encode(text);
    let binary = "";
    const chunk = 0x8000;
    for (let i=0;i<bytes.length;i+=chunk) {
      binary += String.fromCharCode(...bytes.subarray(i,i+chunk));
    }
    return btoa(binary);
  }

  function base64ToUtf8(value) {
    const binary = atob(value);
    const bytes = Uint8Array.from(binary, c => c.charCodeAt(0));
    return new TextDecoder().decode(bytes);
  }

  function populateCategorySelect() {
    $("entryCategory").innerHTML = CATEGORY_GROUPS.flatMap(group =>
      group.items.map(([id,name]) => '<option value="' + id + '">' + escapeHtml(name) + '</option>')
    ).join("");
  }

  function openEditor(id=null) {
    if (!authorMode) return;
    editingId = id;
    const entry = id ? db.entries.find(e => e.id === id) : null;

    $("editorHeading").textContent = entry ? "แก้ไขข้อมูล" : "เพิ่มข้อมูล";
    $("entryTitle").value = entry?.title || "";
    $("entryCategory").value = entry?.category || (currentCategory !== "all" ? currentCategory : "overview");
    $("entryStatus").value = entry?.status || "draft";
    $("entryVisibility").value = entry?.visibility || "public";
    $("entryTags").value = (entry?.tags || []).join(", ");
    $("entrySummary").value = entry?.summary || "";
    $("entryDetails").value = entry?.details || "";
    $("entryLinks").value = (entry?.links || []).join(", ");
    $("entryQuestions").value = entry?.openQuestions || "";
    $("deleteEntryButton").style.visibility = entry ? "visible" : "hidden";
    updatePrompt();
    editorModal.showModal();
  }

  function updatePrompt() {
    $("categoryPrompt").textContent = cat($("entryCategory").value).prompt;
  }

  async function saveEntry() {
    const title = $("entryTitle").value.trim();
    if (!title) return showToast("ใส่ชื่อหัวข้อก่อน", "error");

    const entry = {
      id: editingId || newId(),
      category: $("entryCategory").value,
      title,
      visibility: $("entryVisibility").value,
      status: $("entryStatus").value,
      tags: $("entryTags").value.split(",").map(v => v.trim()).filter(Boolean),
      summary: $("entrySummary").value.trim(),
      details: $("entryDetails").value.trim(),
      links: $("entryLinks").value.split(",").map(v => v.trim()).filter(Boolean),
      openQuestions: $("entryQuestions").value.trim(),
      updatedAt: new Date().toISOString()
    };

    const previousDb = JSON.parse(JSON.stringify(db));
    if (editingId) {
      const index = db.entries.findIndex(e => e.id === editingId);
      if (index >= 0) db.entries[index] = entry;
    } else {
      db.entries.push(entry);
    }

    const button = $("saveEntryButton");
    setBusy(button,true,"กำลังบันทึก…");
    try {
      await saveDatabase((editingId ? "Update: " : "Add: ") + title);
      editingId = entry.id;
      currentEntryId = entry.id;
      editorModal.close();
      renderNav();
      render();
      showToast("บันทึกลง GitHub แล้ว", "success");
    } catch (error) {
      db = previousDb;
      showToast(error.message || "บันทึกไม่สำเร็จ", "error");
    } finally {
      setBusy(button,false);
    }
  }

  async function deleteEntry() {
    if (!editingId) return;
    const entry = db.entries.find(e => e.id === editingId);
    if (!entry || !confirm('ลบ "' + entry.title + '" ออกจากฐานข้อมูล?')) return;

    const previousDb = JSON.parse(JSON.stringify(db));
    db.entries = db.entries.filter(e => e.id !== editingId);
    const button = $("deleteEntryButton");
    setBusy(button,true,"กำลังลบ…");
    try {
      await saveDatabase("Delete: " + entry.title);
      editorModal.close();
      currentEntryId = null;
      editingId = null;
      renderNav();
      render();
      showToast("ลบและบันทึกลง GitHub แล้ว", "success");
    } catch (error) {
      db = previousDb;
      showToast(error.message || "ลบไม่สำเร็จ", "error");
    } finally {
      setBusy(button,false);
    }
  }

  function exportBackup() {
    const blob = new Blob([JSON.stringify(db,null,2)], {type:"application/json"});
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = url;
    link.download = "CaeLum_World_Bible_" + new Date().toISOString().slice(0,10) + ".json";
    document.body.appendChild(link);
    link.click();
    link.remove();
    URL.revokeObjectURL(url);
  }

  async function tryRestoreSession() {
    if (!adminToken) return;
    try {
      await verifyToken(adminToken);
      authorMode = true;
      setModeUi();
      await loadLatestFromGitHub();
      renderNav();
      render();
    } catch {
      sessionStorage.removeItem("caelum_admin_token");
      adminToken = "";
      authorMode = false;
      setModeUi();
    }
  }

  function closeMobileNav() { document.body.classList.remove("nav-open"); }

  $("menuButton").addEventListener("click", () => document.body.classList.toggle("nav-open"));
  $("mobileBackdrop").addEventListener("click", closeMobileNav);
  searchInput.addEventListener("input", () => { currentEntryId = null; render(); });
  $("refreshButton").addEventListener("click", async () => {
    if (authorMode) {
      try {
        await loadLatestFromGitHub();
        renderNav(); render();
        showToast("โหลดข้อมูลล่าสุดแล้ว", "success");
      } catch (error) { showToast(error.message,"error"); }
    } else {
      await loadData();
    }
  });
  $("adminButton").addEventListener("click", () => {
    if (authorMode) return showToast("Author Mode เปิดอยู่แล้ว");
    adminModal.showModal();
    setTimeout(() => $("tokenInput").focus(), 30);
  });
  $("loginButton").addEventListener("click", enterAuthorMode);
  $("tokenInput").addEventListener("keydown", e => {
    if (e.key === "Enter") { e.preventDefault(); enterAuthorMode(); }
  });
  $("entryCategory").addEventListener("change", updatePrompt);
  $("saveEntryButton").addEventListener("click", saveEntry);
  $("deleteEntryButton").addEventListener("click", deleteEntry);

  populateCategorySelect();
  setModeUi();
  loadData().then(tryRestoreSession);
})();