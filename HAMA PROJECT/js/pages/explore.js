(async function () {
  await initAuth();

  let allMembers = [];

  function badgeHtml(m) {
    const chips = [`<span class="badge">${m.generation === 1 ? "1st" : "2nd"} Generation</span>`];
    if (m.role === "founder") chips.push(`<span class="badge founder">Founder</span>`);
    else if (m.role === "admin") chips.push(`<span class="badge admin">Admin</span>`);
    else if (m.badge === "PvP Main") chips.push(`<span class="badge pvp">PvP Main</span>`);
    else chips.push(`<span class="badge hama">Hama</span>`);
    return chips.join("");
  }

  function render(list) {
    const grid = document.getElementById("member-grid");
    const empty = document.getElementById("empty-state");
    if (list.length === 0) {
      grid.innerHTML = "";
      empty.style.display = "block";
      return;
    }
    empty.style.display = "none";
    grid.innerHTML = list.map(m => `
      <a class="member-card" href="profile.html?id=${m.id}">
        <img class="avatar" src="${m.avatar_url || `https://cdn.discordapp.com/embed/avatars/0.png`}" alt="">
        <div class="name">${m.display_name}</div>
        <div class="handle">@${m.discord_username}</div>
        <div class="badge-row">${badgeHtml(m)}</div>
      </a>
    `).join("");
  }

  const { data, error } = await sb
    .from("profiles")
    .select("*")
    .order("generation", { ascending: true })
    .order("display_name", { ascending: true });

  if (error) {
    toast("Could not load members: " + error.message, 5000);
  } else {
    allMembers = data || [];
    render(allMembers);
  }

  document.getElementById("search-input").addEventListener("input", (e) => {
    const q = e.target.value.trim().toLowerCase();
    if (!q) return render(allMembers);
    render(allMembers.filter(m =>
      m.display_name.toLowerCase().includes(q) ||
      m.discord_username.toLowerCase().includes(q)
    ));
  });
})();