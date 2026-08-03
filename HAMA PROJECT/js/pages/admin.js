(async function () {
  await initAuth();

  const body = document.getElementById("admin-body");
  const isStaff = currentProfile && (currentProfile.role === "founder" || currentProfile.role === "admin");

  if (!isStaff) {
    body.innerHTML = `
      <div class="access-denied">
        <h1>Founders only</h1>
        <p>This page is for founders and admins. ${currentProfile ? "Your account doesn't have that role." : "Sign in with an account that has founder or admin access."}</p>
      </div>
    `;
    return;
  }

  let allMembers = [];
  const dirty = new Set();

  function avatarOf(m) {
    return m.avatar_url || `https://cdn.discordapp.com/embed/avatars/0.png`;
  }

  function rowHtml(m) {
    return `
      <tr data-id="${m.id}">
        <td>
          <div class="admin-member">
            <img src="${avatarOf(m)}" alt="">
            <div>
              <div class="name">${m.display_name}</div>
              <div class="handle">@${m.discord_username}</div>
            </div>
          </div>
        </td>
        <td>
          <select class="f-role">
            <option value="member" ${m.role === "member" ? "selected" : ""}>Member</option>
            <option value="admin" ${m.role === "admin" ? "selected" : ""}>Admin</option>
            <option value="founder" ${m.role === "founder" ? "selected" : ""}>Founder</option>
          </select>
        </td>
        <td>
          <select class="f-badge">
            <option value="Hama" ${m.badge === "Hama" ? "selected" : ""}>Hama</option>
            <option value="Tubero" ${m.badge === "Tubero" ? "selected" : ""}>Tubero</option>
            <option value="PvP Main" ${m.badge === "PvP Main" ? "selected" : ""}>PvP Main</option>
            <option value="Founder" ${m.badge === "Founder" ? "selected" : ""}>Founder</option>
          </select>
        </td>
        <td><input class="f-generation" type="number" min="1" max="20" value="${m.generation}"></td>
        <td style="text-align:center;"><input class="f-root" type="checkbox" ${m.is_root ? "checked" : ""}></td>
        <td>
          <div class="admin-row-actions">
            <button class="btn btn-ghost btn-sm f-save">Save</button>
            <a class="btn btn-ghost btn-sm" href="profile.html?id=${m.id}">View</a>
            <button class="btn btn-danger btn-sm f-delete">Remove</button>
          </div>
        </td>
      </tr>
    `;
  }

  function render(list) {
    const wrap = document.createElement("div");
    wrap.innerHTML = `
      <div class="admin-toolbar">
        <div class="search-bar"><input type="text" id="admin-search" placeholder="Search by name or @handle…"></div>
      </div>
      <div class="admin-table-wrap">
        <table class="admin-table">
          <thead>
            <tr>
              <th>Member</th>
              <th>Role</th>
              <th>Badge</th>
              <th>Generation</th>
              <th>Root</th>
              <th>Actions</th>
            </tr>
          </thead>
          <tbody id="admin-rows">
            ${list.map(rowHtml).join("")}
          </tbody>
        </table>
      </div>
    `;
    body.innerHTML = "";
    body.appendChild(wrap);
    wireRows();

    document.getElementById("admin-search").addEventListener("input", (e) => {
      const q = e.target.value.trim().toLowerCase();
      const filtered = !q ? allMembers : allMembers.filter(m =>
        m.display_name.toLowerCase().includes(q) || m.discord_username.toLowerCase().includes(q)
      );
      document.getElementById("admin-rows").innerHTML = filtered.map(rowHtml).join("");
      wireRows();
    });
  }

  function wireRows() {
    document.querySelectorAll("#admin-rows tr").forEach(tr => {
      const id = tr.dataset.id;
      tr.querySelectorAll("select, input").forEach(el => {
        el.addEventListener("input", () => tr.classList.add("row-dirty"));
      });
      tr.querySelector(".f-save").addEventListener("click", () => saveRow(id, tr));
      tr.querySelector(".f-delete").addEventListener("click", () => deleteRow(id, tr));
    });
  }

  async function saveRow(id, tr) {
    const role = tr.querySelector(".f-role").value;
    const badge = tr.querySelector(".f-badge").value;
    const generation = parseInt(tr.querySelector(".f-generation").value, 10) || 1;
    const is_root = tr.querySelector(".f-root").checked;

    // A founder demoting themselves to a non-founder role would lock them
    // out of this page immediately — warn before letting that happen.
    if (currentProfile.id === id && role !== "founder" && role !== "admin") {
      if (!confirm("This removes your own founder/admin access. Continue?")) return;
    }

    const { error } = await sb.from("profiles")
      .update({ role, badge, generation, is_root })
      .eq("id", id);

    if (error) return toast("Could not save: " + error.message, 5000);
    toast("Profile updated.");
    tr.classList.remove("row-dirty");
    await loadAll();
  }

  async function deleteRow(id, tr) {
    const name = tr.querySelector(".admin-member .name").textContent;
    if (!confirm(`Remove ${name} from Hama entirely? This also removes them from the family tree. This can't be undone.`)) return;
    const { error } = await sb.from("profiles").delete().eq("id", id);
    if (error) return toast("Could not remove: " + error.message, 5000);
    toast("Member removed.");
    await loadAll();
  }

  async function loadAll() {
    const { data, error } = await sb.from("profiles").select("*")
      .order("generation", { ascending: true })
      .order("display_name", { ascending: true });
    if (error) { toast("Could not load members: " + error.message, 5000); return; }
    allMembers = data || [];
    render(allMembers);
  }

  await loadAll();
})();