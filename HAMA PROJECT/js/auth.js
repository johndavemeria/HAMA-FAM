// ------------------------------------------------------------------
// Shared auth + header logic, included on every page after
// supabase-client.js
// ------------------------------------------------------------------

let currentProfile = null; // the signed-in user's row from public.profiles
let currentSession = null;

function toast(msg, ms = 3200) {
  const el = document.createElement("div");
  el.className = "toast";
  el.textContent = msg;
  document.body.appendChild(el);
  setTimeout(() => el.remove(), ms);
}

function discordAvatarFallback(discordId) {
  const idx = discordId ? Number(BigInt(discordId) % 5n) : 0;
  return `https://cdn.discordapp.com/embed/avatars/${idx}.png`;
}

async function signInWithDiscord() {
  await sb.auth.signInWithOAuth({
    provider: "discord",
    options: {
      redirectTo: window.location.origin + window.location.pathname,
      scopes: "identify"
    }
  });
}

async function signOut() {
  await sb.auth.signOut();
  currentProfile = null;
  currentSession = null;
  localStorage.removeItem("hama_profile");
  window.location.href = "index.html";
}

// Pull fresh avatar/banner/username straight from Discord's API using
// the OAuth provider token Supabase hands back right after sign-in.
async function fetchDiscordUser(providerToken) {
  const res = await fetch("https://discord.com/api/users/@me", {
    headers: { Authorization: `Bearer ${providerToken}` }
  });
  if (!res.ok) throw new Error("discord_fetch_failed");
  return res.json();
}

function buildDiscordAssetUrls(du) {
  const avatar_url = du.avatar
    ? `https://cdn.discordapp.com/avatars/${du.id}/${du.avatar}.${du.avatar.startsWith("a_") ? "gif" : "png"}?size=256`
    : discordAvatarFallback(du.id);
  const banner_url = du.banner
    ? `https://cdn.discordapp.com/banners/${du.id}/${du.banner}.${du.banner.startsWith("a_") ? "gif" : "png"}?size=600`
    : null;
  return { avatar_url, banner_url };
}

// Runs once right after a fresh OAuth redirect: pulls the Discord
// profile and tries to claim / refresh the matching row in
// public.profiles. If there is no pre-registered row for this
// Discord username, the person is signed back out — this is what
// enforces "only family members can log in".
async function claimProfileFromSession(session) {
  if (!session.provider_token) return; // no fresh Discord token this load
  let discordUser;
  try {
    discordUser = await fetchDiscordUser(session.provider_token);
  } catch (e) {
    console.warn("Could not read Discord profile", e);
    return;
  }

  const { avatar_url, banner_url } = buildDiscordAssetUrls(discordUser);
  const display_name = discordUser.global_name || discordUser.username;

  const { data, error } = await sb.rpc("handle_discord_login", {
    p_discord_id: discordUser.id,
    p_discord_username: discordUser.username,
    p_display_name: display_name,
    p_avatar_url: avatar_url,
    p_banner_url: banner_url
  });

  if (error) {
    toast("Sign-in failed: " + error.message, 5000);
    await sb.auth.signOut();
    currentProfile = null;
    return;
  }

  const isNewProfile = !currentProfile;
  currentProfile = data;
  localStorage.setItem("hama_profile", JSON.stringify(data));
  if (isNewProfile) toast(`Welcome to Hama, ${data.display_name}.`);
}

// On plain page loads (no fresh provider_token), just re-fetch the
// already-claimed profile so the header can render it.
async function loadOwnProfile(userId) {
  const { data, error } = await sb
    .from("profiles")
    .select("*")
    .eq("user_id", userId)
    .maybeSingle();
  if (!error && data) {
    currentProfile = data;
    localStorage.setItem("hama_profile", JSON.stringify(data));
  }
}

function renderHeaderAuthState() {
  const slot = document.getElementById("auth-slot");
  if (!slot) return;

  if (currentSession && currentProfile) {
    slot.innerHTML = `
      <a href="profile.html?id=${currentProfile.id}" class="user-chip">
        <img src="${currentProfile.avatar_url || discordAvatarFallback(currentProfile.discord_id)}" alt="">
        <span>${currentProfile.display_name}</span>
      </a>
      <button class="btn btn-ghost btn-sm" id="signout-btn">Sign out</button>
    `;
    document.getElementById("signout-btn").addEventListener("click", signOut);
  } else if (currentSession && !currentProfile) {
    slot.innerHTML = `<button class="btn btn-ghost btn-sm" id="signout-btn">Sign out</button>`;
    document.getElementById("signout-btn").addEventListener("click", signOut);
  } else {
    slot.innerHTML = `<button class="btn btn-discord" id="discord-login-btn">Sign in with Discord</button>`;
    document.getElementById("discord-login-btn").addEventListener("click", signInWithDiscord);
  }

  document.querySelectorAll("[data-requires-auth]").forEach(el => {
    el.style.display = currentProfile ? "" : "none";
  });
  document.querySelectorAll("[data-requires-staff]").forEach(el => {
    const ok = currentProfile && (currentProfile.role === "founder" || currentProfile.role === "admin");
    el.style.display = ok ? "" : "none";
  });
}

// Call this at the top of every page. Resolves once auth state is known.
async function initAuth() {
  const cached = localStorage.getItem("hama_profile");
  if (cached) currentProfile = JSON.parse(cached);

  const { data: { session } } = await sb.auth.getSession();
  currentSession = session;

  if (session) {
    if (session.provider_token) {
      await claimProfileFromSession(session);
    } else if (!currentProfile || currentProfile.user_id !== session.user.id) {
      await loadOwnProfile(session.user.id);
    }
  } else {
    currentProfile = null;
    localStorage.removeItem("hama_profile");
  }

  renderHeaderAuthState();

  sb.auth.onAuthStateChange(async (event, session) => {
    currentSession = session;
    if (event === "SIGNED_OUT") {
      currentProfile = null;
      localStorage.removeItem("hama_profile");
      renderHeaderAuthState();
    }
    if (event === "SIGNED_IN" && session) {
      await claimProfileFromSession(session);
      renderHeaderAuthState();
    }
  });

  return { session, profile: currentProfile };
}