(async function () {
  await initAuth();

  const loginBtn = document.getElementById("tree-login-btn");
  if (!currentProfile) {
    loginBtn.style.display = "inline-flex";
    loginBtn.addEventListener("click", signInWithDiscord);
  }

  let profiles = [];

  function avatarOf(p) {
    return p.avatar_url || `https://cdn.discordapp.com/embed/avatars/0.png`;
  }

  function badgeHtml(m) {
    const chips = [`<span class="badge">${m.generation === 1 ? "1st" : "2nd"} Generation</span>`];
    if (m.role === "founder") chips.push(`<span class="badge founder">Founder</span>`);
    else if (m.badge === "PvP Main") chips.push(`<span class="badge pvp">PvP Main</span>`);
    else chips.push(`<span class="badge hama">Hama</span>`);
    return chips.join("");
  }

  async function loadAll() {
    const { data, error } = await sb.from("profiles").select("*").order("display_name");
    if (error) { toast("Could not load family tree: " + error.message, 5000); return; }
    profiles = data || [];
  }

  function renderStats() {
    const gen1 = profiles.filter(p => p.generation === 1).length;
    const gens = new Set(profiles.map(p => p.generation)).size;
    document.getElementById("stat-total").textContent = profiles.length;
    document.getElementById("stat-gen1").textContent = gen1;
    document.getElementById("stat-gens").textContent = gens || 0;
  }

  function renderRootGrid() {
    const roots = profiles.filter(p => p.generation === 1);
    const grid = document.getElementById("root-grid");
    grid.innerHTML = roots.map(p => `
      <div class="member-card" data-id="${p.id}">
        <img class="avatar" src="${avatarOf(p)}" alt="">
        <div class="name">${p.display_name}</div>
        <div class="handle">@${p.discord_username}</div>
        <div class="badge-row">${badgeHtml(p)}</div>
      </div>
    `).join("");
    grid.querySelectorAll(".member-card").forEach(card => {
      card.addEventListener("click", () => openFamilyModal(card.dataset.id));
    });
  }

  function canGrow(rootProfile) {
    if (!currentProfile) return false;
    if (currentProfile.role === "founder" || currentProfile.role === "admin") return true;
    return currentProfile.id === rootProfile.id && rootProfile.is_root;
  }

  function miniCard(p, { removable, onRemove } = {}) {
    return `
      <div class="mini-card" data-id="${p.id}">
        <img class="avatar" src="${avatarOf(p)}" alt="">
        <div class="name">${p.display_name}</div>
        <div class="handle">@${p.discord_username}</div>
        <a class="profile-link" href="profile.html?id=${p.id}">Profile ↗</a>
        ${removable ? `<br><button class="remove-x" data-remove="${p.id}">Remove</button>` : ""}
      </div>
    `;
  }

  async function openFamilyModal(rootId) {
    const root = profiles.find(p => p.id === rootId);
    if (!root) return;

    const { data: relations, error } = await sb
      .from("family_relations")
      .select("*")
      .eq("owner_id", rootId);
    if (error) { toast("Could not load relations: " + error.message, 5000); return; }

    const spouseRel = (relations || []).find(r => r.relation_type === "spouse");
    const childRels = (relations || []).filter(r => r.relation_type === "child");
    const spouse = spouseRel ? profiles.find(p => p.id === spouseRel.member_id) : null;
    const children = childRels.map(r => profiles.find(p => p.id === r.member_id)).filter(Boolean);

    const editable = canGrow(root);

    const html = `
      <div class="modal-backdrop" id="modal-backdrop">
        <div class="modal">
          <div class="modal-head">
            <div>
              <h2>${root.display_name}'s Family</h2>
              <p>Spouses beside each generation · children below</p>
            </div>
            <button class="icon-btn" id="modal-close">✕</button>
          </div>

          <div class="tree-row">
            ${miniCard(root)}
            ${spouse ? `<div class="tree-connector"></div>${miniCard(spouse, { removable: editable, onRemove: true })}` : ""}
          </div>

          ${children.length ? `<div class="tree-children">${children.map(c => miniCard(c, { removable: editable })).join("")}</div>` : `<p style="text-align:center;color:var(--muted);font-size:13px;">No children added yet.</p>`}

          ${editable ? `
            <div class="add-form">
              <select id="rel-type">
                <option value="child">Add child</option>
                ${spouse ? "" : `<option value="spouse">Add spouse</option>`}
              </select>
              <select id="link-existing">
                <option value="">— pick an existing member (optional) —</option>
                ${profiles.filter(p => p.id !== root.id).map(p => `<option value="${p.id}">${p.display_name} (@${p.discord_username})</option>`).join("")}
              </select>
              <input type="text" id="new-display-name" placeholder="Or new member's display name">
              <input type="text" id="new-discord-username" placeholder="Their Discord username (lowercase)">
              <button class="btn btn-primary btn-sm" id="add-member-btn">Add</button>
            </div>
          ` : ""}
        </div>
      </div>
    `;

    document.getElementById("modal-root").innerHTML = html;
    document.getElementById("modal-close").addEventListener("click", closeModal);
    document.getElementById("modal-backdrop").addEventListener("click", (e) => {
      if (e.target.id === "modal-backdrop") closeModal();
    });

    document.querySelectorAll("[data-remove]").forEach(btn => {
      btn.addEventListener("click", async () => {
        const memberId = btn.dataset.remove;
        const { error } = await sb.from("family_relations").delete()
          .eq("owner_id", root.id).eq("member_id", memberId);
        if (error) return toast("Could not remove: " + error.message, 4000);
        toast("Removed from family tree.");
        await loadAll();
        renderStats();
        renderRootGrid();
        openFamilyModal(root.id);
      });
    });

    if (editable) {
      document.getElementById("add-member-btn").addEventListener("click", () => addFamilyMember(root));
    }
  }

  async function addFamilyMember(root) {
    const relType = document.getElementById("rel-type").value;
    const existingId = document.getElementById("link-existing").value;
    const newName = document.getElementById("new-display-name").value.trim();
    const newHandle = document.getElementById("new-discord-username").value.trim().toLowerCase();

    let memberId = existingId || null;

    if (!memberId) {
      if (!newName || !newHandle) {
        return toast("Pick an existing member or fill in both name + Discord username.", 4000);
      }
      const { data: created, error: createErr } = await sb.from("profiles").insert({
        display_name: newName,
        discord_username: newHandle,
        generation: relType === "spouse" ? root.generation : root.generation + 1,
        badge: "Hama"
      }).select().single();
      if (createErr) return toast("Could not create member: " + createErr.message, 5000);
      memberId = created.id;
    }

    const { error: relErr } = await sb.from("family_relations").insert({
      owner_id: root.id,
      member_id: memberId,
      relation_type: relType
    });
    if (relErr) return toast("Could not link member: " + relErr.message, 5000);

    toast("Family member added.");
    await loadAll();
    renderStats();
    renderRootGrid();
    openFamilyModal(root.id);
  }

  function closeModal() {
    document.getElementById("modal-root").innerHTML = "";
  }

  await loadAll();
  renderStats();
  renderRootGrid();
})();