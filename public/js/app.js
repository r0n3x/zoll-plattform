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

// FEED aus /api/posts/feed laden
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

// Auto-Init
document.addEventListener("DOMContentLoaded", () => {
    loadFeed();
});
