console.log("🔥 Index.js loaded");

// ==========================
// UI CREATION FUNCTIONS
// ==========================

function injectFloatingButton() {
  if (document.getElementById("as-floating-button")) return;

  const btn = document.createElement("div");
  btn.id = "as-floating-button";

  const img = document.createElement("img");
  img.src = browser.runtime.getURL("icons/icon-48.png");
  img.style.width = "22px";
  img.style.height = "22px";
  btn.appendChild(img);

  btn.addEventListener("click", () => {
    const panel = document.getElementById("as-panel");
    panel.classList.toggle("as-expanded");
  });

  document.body.appendChild(btn);
}

function injectPanel() {
  if (document.getElementById("as-panel")) return;

  const panel = document.createElement("div");
  panel.id = "as-panel";

  panel.innerHTML = `
    <div class="as-header">
      <span>AutoScroller</span>
    </div>
    <div class="as-section">
  <button id="as-toggle-scroll" class="as-main-btn">Start</button>
</div>

<div class="as-section">
  <label>Speed <span id="as-speed-value">50</span></label>
  <input type="range" id="as-speed-slider" min="1" max="100" value="50">
</div>

<div class="as-section">
  <div class="as-preset-row">
    <button class="as-preset-btn">Slow</button>
    <button class="as-preset-btn">Medium</button>
    <button class="as-preset-btn">Fast</button>
  </div>
</div>

<div class="as-section">
  <label class="as-option"><input type="checkbox" id="as-auto-next"> Auto Next Chapter</label>
  <label class="as-option"><input type="checkbox" id="as-dark-mode"> Dark Mode</label>
</div>

  `;

  document.body.appendChild(panel);

  
}

// ===== RUN UI =====
injectFloatingButton();
injectPanel();
