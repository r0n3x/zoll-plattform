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
