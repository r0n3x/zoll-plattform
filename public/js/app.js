// HS Suche
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

// News laden
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

    document.getElementById("news-container").innerHTML = html;
}

// Feed laden
async function loadFeed() {
    const res = await fetch("/api/posts/feed");
    const data = await res.json();

    let html = "";
    data.forEach(p => {
        html += `
            <div class="post">
                <strong>${p.full_name}</strong> (@${p.username})<br>
                <p>${p.content}</p>
            </div>
        `;
    });

    document.getElementById("feed-container").innerHTML = html;
}

loadNews();
loadFeed();

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
        html += `<div class="post"><strong>${p.full_name}</strong> (@${p.username})<p>${p.content}</p></div>`;
    });
    document.getElementById("profile-posts").innerHTML = html;
}

async function loadFriends(userId) {
    const res = await fetch(`/api/friends/${userId}`);
    const data = await res.json();
    let html = "";
    data.forEach(f => {
        html += `<div>${f.full_name || f.username}</div>`;
    });
    document.getElementById("friends-list").innerHTML = html;
}

// Post vom Profil erstellen (Dummy user_id = 1)
async function createPost() {
    const content = document.getElementById("post-content").value;
    if (!content) return;
    await fetch("/api/posts", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ user_id: 1, content })
    });
    document.getElementById("post-content").value = "";
    loadProfilePosts(1);
}

// Feed-Seite
async function loadFeedPage() {
    const res = await fetch("/api/posts/feed");
    const data = await res.json();
    let html = "";
    data.forEach(p => {
        html += `<div class="post"><strong>${p.full_name}</strong> (@${p.username})<p>${p.content}</p></div>`;
    });
    document.getElementById("feed-page-container").innerHTML = html;
}

async function createFeedPost() {
    const content = document.getElementById("feed-post-content").value;
    if (!content) return;
    await fetch("/api/posts", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ user_id: 1, content })
    });
    document.getElementById("feed-post-content").value = "";
    loadFeedPage();
}

// News-Seite
async function loadNewsPage() {
    const res = await fetch("/api/news");
    const data = await res.json();
    let html = "";
    data.forEach(n => {
        html += `<div class="news-item"><strong>${n.title}</strong><br><small>${n.date} – ${n.source}</small><p>${n.summary}</p></div>`;
    });
    document.getElementById("news-page-container").innerHTML = html;
}

// HS-Seite
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

