let currentUser = null;

// Init Auth aus localStorage
(function initAuth() {
    const stored = localStorage.getItem("currentUser");
    if (stored) {
        currentUser = JSON.parse(stored);
        window.currentUser = currentUser;
    }
})();

// LOGIN
async function login() {
    const email = document.getElementById("login-email").value;
    const password = document.getElementById("login-password").value;
    if (!email || !password) return;

    const res = await fetch("/api/auth/login", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email, password })
    });

    if (!res.ok) {
        alert("Login fehlgeschlagen");
        return;
    }

    const data = await res.json();
    currentUser = data;
    window.currentUser = data;
    localStorage.setItem("currentUser", JSON.stringify(data));
    alert("Erfolgreich eingeloggt");
}

// REGISTRIERUNG (simple Prompts)
async function openRegister() {
    const email = prompt("E-Mail:");
    const password = prompt("Passwort:");
    const full_name = prompt("Vollständiger Name:");
    const username = prompt("Username:");

    if (!email || !password) return;

    const res = await fetch("/api/auth/register", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email, password, full_name, username })
    });

    if (!res.ok) {
        alert("Registrierung fehlgeschlagen");
        return;
    }

    alert("Registrierung erfolgreich – bitte einloggen.");
}

// HS Suche (Startseite)
async function searchHS() {
    const q = document.getElementById("hs-search").value;
    const res = await fetch(`/api/hs-codes?q=${encodeURIComponent(q)}`);
    const data = await res.json();

    let html = "";
    data.forEach(item => {
        html += `<div><strong>${item.code}</strong> – ${item.description}</div>`;
    });

    document.getElementById("hs-results").innerHTML = html;
}

// HS Suche (HS-Seite)
async function searchHSPage() {
    const q = document.getElementById("hs-search-page").value;
    const res = await fetch(`/api/hs-codes?q=${encodeURIComponent(q)}`);
    const data = await res.json();
    let html = "";
    data.forEach(item => {
        html += `<div><strong>${item.code}</strong> – ${item.description}</div>`;
    });
    document.getElementById("hs-results-page").innerHTML = html;
}

// News (Startseite)
async function loadNews() {
    const res = await fetch("/api/news");
    const data = await res.json();

    let html = "";
    data.forEach(n => {
        html += `
            <div class="news-item">
                <strong>${n.title}</strong><br>
                <small>${n.date} – ${n.source}</small>
                <p>${n.summary}</p>
            </div>
        `;
    });

    const el = document.getElementById("news-container");
    if (el) el.innerHTML = html;
}

// News (News-Seite)
async function loadNewsPage() {
    const res = await fetch("/api/news");
    const data = await res.json();
    let html = "";
    data.forEach(n => {
        html += `
            <div class="news-item">
                <strong>${n.title}</strong><br>
                <small>${n.date} – ${n.source}</small>
                <p>${n.summary}</p>
            </div>
        `;
    });
    const el = document.getElementById("news-page-container");
    if (el) el.innerHTML = html;
}

// Feed (Startseite)
async function loadFeed() {
    const res = await fetch("/api/posts/feed");
    const data = await res.json();

    let html = "";
    data.forEach(p => {
        html += `
            <div class="post">
                <strong>${p.full_name || p.username || 'User'}</strong> (@${p.username || 'user'})<br>
                <p>${p.content}</p>
            </div>
        `;
    });

    const el = document.getElementById("feed-container");
    if (el) el.innerHTML = html;
}

// Feed (Feed-Seite)
async function loadFeedPage() {
    const res = await fetch("/api/posts/feed");
    const data = await res.json();
    let html = "";
    data.forEach(p => {
        html += `
            <div class="post">
                <strong>${p.full_name || p.username || 'User'}</strong> (@${p.username || 'user'})<br>
                <p>${p.content}</p>
            </div>
        `;
    });
    const el = document.getElementById("feed-page-container");
    if (el) el.innerHTML = html;
}

// Feed-Post erstellen
async function createFeedPost() {
    if (!currentUser || !currentUser.user) {
        alert("Bitte zuerst einloggen.");
        return;
    }
    const content = document.getElementById("feed-post-content").value;
    if (!content) return;
    await fetch("/api/posts", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ user_id: currentUser.user.id, content })
    });
    document.getElementById("feed-post-content").value = "";
    loadFeedPage();
}

// Profil laden
async function loadProfile(username) {
    try {
        const res = await fetch(`/api/profiles/${encodeURIComponent(username)}`);
        if (!res.ok) return;

        const p = await res.json();
        document.getElementById("profile-name").textContent = p.full_name || p.username || p.email;
        document.getElementById("profile-username").textContent = "@" + (p.username || "unbekannt");
        document.getElementById("profile-bio").textContent = p.bio || "";
        document.getElementById("profile-location").textContent = p.location || "";
        document.getElementById("profile-website").textContent = p.website || "";

        loadProfilePosts(p.user_id);
        loadFriends(p.user_id);
    } catch (e) {
        console.error(e);
    }
}

async function loadProfilePosts(userId) {
    const res = await fetch(`/api/posts/user/${userId}`);
    const data = await res.json();
    let html = "";
    data.forEach(p => {
        html += `<div class="post"><strong>${p.full_name || p.username || 'User'}</strong> (@${p.username || 'user'})<p>${p.content}</p></div>`;
    });
    const el = document.getElementById("profile-posts");
    if (el) el.innerHTML = html;
}

async function loadFriends(userId) {
    const res = await fetch(`/api/friends/${userId}`);
    const data = await res.json();
    let html = "";
    data.forEach(f => {
        html += `<div>${f.full_name || f.username}</div>`;
    });
    const el = document.getElementById("friends-list");
    if (el) el.innerHTML = html;
}

// Profil-Post erstellen
async function createPost() {
    if (!currentUser || !currentUser.user) {
        alert("Bitte zuerst einloggen.");
        return;
    }
    const content = document.getElementById("post-content").value;
    if (!content) return;
    await fetch("/api/posts", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ user_id: currentUser.user.id, content })
    });
    document.getElementById("post-content").value = "";
    loadProfilePosts(currentUser.user.id);
}

// Auto-Init auf Seiten, wo Elemente existieren
document.addEventListener("DOMContentLoaded", () => {
    if (document.getElementById("news-container")) loadNews();
    if (document.getElementById("feed-container")) loadFeed();
});
