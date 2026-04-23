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
    const emailInput = document.getElementById("login-email");
    const passwordInput = document.getElementById("login-password");
    if (!emailInput || !passwordInput) return;

    const email = emailInput.value;
    const password = passwordInput.value;
    if (!email || !password) return;

    try {
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
    } catch (e) {
        console.error(e);
        alert("Fehler beim Login");
    }
}

// REGISTRIERUNG (simple Prompts)
async function openRegister() {
    const email = prompt("E-Mail:");
    const password = prompt("Passwort:");
    const full_name = prompt("Vollständiger Name:");
    const username = prompt("Username:");

    if (!email || !password) return;

    try {
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
    } catch (e) {
        console.error(e);
        alert("Fehler bei der Registrierung");
    }
}

// FEED (Startseite)
async function loadFeed() {
    try {
        const res = await fetch("/api/posts/feed");
        if (!res.ok) return;
        const data = await res.json();

        const container = document.getElementById("feed-container");
        if (!container) return;

        let html = "";
        data.forEach(p => {
            html += `
                <div class="ga-post-item">
                    <div class="ga-post-user">${p.full_name || p.username || "User"}</div>
                    <div class="ga-post-content">${p.content}</div>
                </div>
            `;
        });

        container.innerHTML = html || "<div>Keine Beiträge vorhanden.</div>";
    } catch (e) {
        console.error(e);
    }
}

// FEED (Feed-Seite)
async function loadFeedPage() {
    try {
        const res = await fetch("/api/posts/feed");
        if (!res.ok) return;
        const data = await res.json();

        const container = document.getElementById("feed-page-container");
        if (!container) return;

        let html = "";
        data.forEach(p => {
            html += `
                <div class="ga-post-item">
                    <div class="ga-post-user">${p.full_name || p.username || "User"}</div>
                    <div class="ga-post-content">${p.content}</div>
                </div>
            `;
        });

        container.innerHTML = html || "<div>Keine Beiträge vorhanden.</div>";
    } catch (e) {
        console.error(e);
    }
}

// FEED-Post erstellen
async function createFeedPost() {
    if (!currentUser || !currentUser.user) {
        alert("Bitte zuerst einloggen.");
        return;
    }
    const textarea = document.getElementById("feed-post-content");
    if (!textarea) return;
    const content = textarea.value;
    if (!content) return;

    try {
        await fetch("/api/posts", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ user_id: currentUser.user.id, content })
        });
        textarea.value = "";
        loadFeedPage();
    } catch (e) {
        console.error(e);
    }
}

// PROFIL laden
async function loadProfile(username) {
    try {
        const res = await fetch(`/api/profiles/${encodeURIComponent(username)}`);
        if (!res.ok) return;

        const p = await res.json();

        const nameEl = document.getElementById("profile-name");
        const userEl = document.getElementById("profile-username");
        const bioEl = document.getElementById("profile-bio");
        const locEl = document.getElementById("profile-location");
        const webEl = document.getElementById("profile-website");

        if (nameEl) nameEl.textContent = p.full_name || p.username || p.email;
        if (userEl) userEl.textContent = "@" + (p.username || "unbekannt");
        if (bioEl) bioEl.textContent = p.bio || "";
        if (locEl) locEl.textContent = p.location || "";
        if (webEl) webEl.textContent = p.website || "";

        loadProfilePosts(p.user_id);
        loadFriends(p.user_id);
    } catch (e) {
        console.error(e);
    }
}

async function loadProfilePosts(userId) {
    try {
        const res = await fetch(`/api/posts/user/${userId}`);
        if (!res.ok) return;
        const data = await res.json();

        const container = document.getElementById("profile-posts");
        if (!container) return;

        let html = "";
        data.forEach(p => {
            html += `
                <div class="ga-post-item">
                    <div class="ga-post-user">${p.full_name || p.username || "User"}</div>
                    <div class="ga-post-content">${p.content}</div>
                </div>
            `;
        });

        container.innerHTML = html || "<div>Keine Beiträge vorhanden.</div>";
    } catch (e) {
        console.error(e);
    }
}

async function loadFriends(userId) {
    try {
        const res = await fetch(`/api/friends/${userId}`);
        if (!res.ok) return;
        const data = await res.json();

        const container = document.getElementById("friends-list");
        if (!container) return;

        let html = "";
        data.forEach(f => {
            html += `<div>${f.full_name || f.username || "User"}</div>`;
        });

        container.innerHTML = html || "<div>Keine Freunde gefunden.</div>";
    } catch (e) {
        console.error(e);
    }
}

// Profil-Post erstellen
async function createProfilePost() {
    if (!currentUser || !currentUser.user) {
        alert("Bitte zuerst einloggen.");
        return;
    }
    const textarea = document.getElementById("post-content");
    if (!textarea) return;
    const content = textarea.value;
    if (!content) return;

    try {
        await fetch("/api/posts", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ user_id: currentUser.user.id, content })
        });
        textarea.value = "";
        loadProfilePosts(currentUser.user.id);
    } catch (e) {
        console.error(e);
    }
}

// NEWS (Startseite & News-Seite)
async function loadNews() {
    try {
        const res = await fetch("/api/news");
        if (!res.ok) return;
        const data = await res.json();

        const container = document.getElementById("news-container");
        if (!container) return;

        let html = "";
        data.forEach(n => {
            html += `
                <div class="ga-twitter-item">
                    <p><strong>${n.title}</strong><br>
                    <small>${n.date} – ${n.source}</small></p>
                    <p>${n.summary}</p>
                </div>
            `;
        });

        container.innerHTML = html;
    } catch (e) {
        console.error(e);
    }
}

async function loadNewsPage() {
    try {
        const res = await fetch("/api/news");
        if (!res.ok) return;
        const data = await res.json();

        const container = document.getElementById("news-page-container");
        if (!container) return;

        let html = "";
        data.forEach(n => {
            html += `
                <div class="ga-post-item">
                    <div class="ga-post-user">${n.title}</div>
                    <div class="ga-post-content">
                        <small>${n.date} – ${n.source}</small><br>
                        ${n.summary}
                    </div>
                </div>
            `;
        });

        container.innerHTML = html || "<div>Keine News vorhanden.</div>";
    } catch (e) {
        console.error(e);
    }
}

// HS-Suche (Startseite optional, HS-Seite)
async function searchHSPage() {
    const input = document.getElementById("hs-search-page");
    if (!input) return;
    const q = input.value;
    if (!q) return;

    try {
        const res = await fetch(`/api/hs-codes?q=${encodeURIComponent(q)}`);
        if (!res.ok) return;
        const data = await res.json();

        const container = document.getElementById("hs-results-page");
        if (!container) return;

        let html = "";
        data.forEach(item => {
            html += `<div><strong>${item.code}</strong> – ${item.description}</div>`;
        });

        container.innerHTML = html || "<div>Keine Ergebnisse.</div>";
    } catch (e) {
        console.error(e);
    }
}

// Auto-Init für Seiten
document.addEventListener("DOMContentLoaded", () => {
    if (document.getElementById("feed-container")) {
        loadFeed();
        loadNews(); // optional News in Startseite
    }
});
