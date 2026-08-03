(async function () {
  await initAuth();

  const params = new URLSearchParams(window.location.search);
  const id = params.get("id");
  const layout = document.getElementById("profile-layout");

  if (!id) {
    layout.innerHTML = `<div class="empty-state" style="grid-column:1/-1;"><h3>No profile selected</h3><p>Go back to <a href="explore.html">Explore</a>.</p></div>`;
    return;
  }

  const { data: profile, error } = await sb.from("profiles").select("*").eq("id", id).maybeSingle();
  if (error || !profile) {
    layout.innerHTML = `<div class="empty-state" style="grid-column:1/-1;"><h3>Profile not found</h3><p>This member may not exist. <a href="explore.html">Back to Explore</a>.</p></div>`;
    return;
  }

  const isOwner = currentProfile && currentProfile.id === profile.id;
  const avatar = profile.avatar_url || `https://cdn.discordapp.com/embed/avatars/0.png`;
  const banner = profile.banner_url;

  function badgeHtml() {
    const chips = [`<span class="badge">${profile.generation === 1 ? "1st" : "2nd"} Generation</span>`];
    if (profile.role === "founder") chips.push(`<span class="badge founder">Founder</span>`);
    else if (profile.role === "admin") chips.push(`<span class="badge admin">Admin</span>`);
    else if (profile.badge === "PvP Main") chips.push(`<span class="badge pvp">PvP Main</span>`);
    else chips.push(`<span class="badge tubero">Tubero</span>`);
    return chips.join("");
  }

  function linksHtml(links) {
    if (!links || !links.length) return `<p style="color:var(--muted);font-size:13px;">No links added yet.</p>`;
    return links.map(l => `
      <a class="link-row" href="${l.url}" target="_blank" rel="noopener">
        <span>${l.label}</span>
        <span class="lmeta">${l.url.replace(/^https?:\/\//, "")}</span>
      </a>
    `).join("");
  }

  function sectionsHtml(sections) {
    if (!sections || !sections.length) return `<p style="color:var(--muted);font-size:13px;">No custom sections added yet.</p>`;
    return sections.map(s => `
      <div class="panel">
        <h3>${s.title}</h3>
        <div class="section-grid">
          ${(s.items || []).map(it => `
            <div class="item-tile"><div class="k">${it.label}</div><div class="v">${it.value}</div></div>
          `).join("")}
        </div>
      </div>
    `).join("");
  }

  layout.innerHTML = `
    <div>
      <div class="profile-card">
        ${banner ? `<img class="profile-banner" src="${banner}" alt="">` : `<div class="profile-banner"></div>`}
        <div class="body">
          <img class="profile-avatar" src="${avatar}" alt="">
          <div class="pname">${profile.display_name}</div>
          <div class="phandle">@${profile.discord_username}</div>
          <div class="pbio" id="bio-display">${profile.bio ? `"${profile.bio}"` : ""}</div>
          <div class="badge-row">${badgeHtml()}</div>
          <div class="profile-stats">
            <div><b>${(profile.links || []).length}</b><span>LINKS</span></div>
            <div><b>${(profile.sections || []).length}</b><span>SECTIONS</span></div>
          </div>
          ${isOwner ? `<button class="btn btn-ghost btn-sm" id="edit-toggle" style="width:100%;">Edit profile</button>` : ""}
        </div>
      </div>
    </div>

    <div>
      <div class="panel">
        <h3>About Me</h3>
        <div id="about-view">${profile.bio || "No bio yet."}</div>
      </div>

      <div class="panel">
        <h3>Official Links</h3>
        <div id="links-view">${linksHtml(profile.links)}</div>
      </div>

      <div id="sections-view">${sectionsHtml(profile.sections)}</div>

      ${isOwner ? `<div class="panel" id="edit-panel" style="display:none;">
        <h3>Edit your profile</h3>
        <div class="editable-notice">Changes save straight to Supabase and are visible to everyone.</div>

        <label class="field-label">Bio</label>
        <textarea class="field" id="edit-bio" rows="2">${profile.bio || ""}</textarea>

        <label class="field-label">Links (JSON array: label, url)</label>
        <textarea class="raw-json" id="edit-links">${JSON.stringify(profile.links || [], null, 2)}</textarea>

        <label class="field-label">Custom sections (JSON array: title, items[{label,value}])</label>
        <textarea class="raw-json" id="edit-sections">${JSON.stringify(profile.sections || [], null, 2)}</textarea>

        <div style="margin-top:16px;display:flex;gap:10px;">
          <button class="btn btn-primary btn-sm" id="save-btn">Save changes</button>
        </div>
      </div>` : ""}
    </div>
  `;

  if (isOwner) {
    document.getElementById("edit-toggle").addEventListener("click", () => {
      const panel = document.getElementById("edit-panel");
      panel.style.display = panel.style.display === "none" ? "block" : "none";
    });

    document.getElementById("save-btn").addEventListener("click", async () => {
      let links, sections;
      try {
        links = JSON.parse(document.getElementById("edit-links").value || "[]");
        sections = JSON.parse(document.getElementById("edit-sections").value || "[]");
      } catch (e) {
        return toast("Links / sections must be valid JSON.", 4000);
      }
      const bio = document.getElementById("edit-bio").value.trim();

      const { error: updErr } = await sb.from("profiles")
        .update({ bio, links, sections })
        .eq("id", profile.id);

      if (updErr) return toast("Could not save: " + updErr.message, 5000);
      toast("Profile saved.");
      setTimeout(() => window.location.reload(), 800);
    });
  }
})();