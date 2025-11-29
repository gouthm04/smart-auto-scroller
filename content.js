// ICON
const icon = document.createElement("img");
icon.id = "overlay-icon";
icon.src = browser.runtime.getURL("icon.png");

// DEFAULT MODE
let readingMode = "glide";

// GLOBAL STATE
let scrolling = false;
let autoNext = false;
let speed = 50;
let pauseToken = 0;
let carry = 0;
let lastTimestamp = null;
let isEyePaused = false;

// PANEL
const panel = document.createElement("div");
panel.id = "overlay-panel";

panel.innerHTML = `
    <div class="panel-content">

        <button id="btn-toggle-scroll" class="panel-btn">Start Scrolling</button>
        <button id="btn-auto-next" class="panel-btn secondary">Auto Next Page: OFF</button>

        <div class="speed-section">
            <label>Speed: <span id="speed-value">50</span></label>

            <div class="speed-control">
                <button id="speed-decrease" class="speed-btn">−</button>
                <input type="range" id="speed-slider" min="1" max="100" value="50">
                <button id="speed-increase" class="speed-btn">+</button>
            </div>
        </div>

        <button id="btn-reading-mode" class="panel-btn secondary">Mode: Glide</button>

        <div class="preset-buttons">
            <button class="preset slow">Slow</button>
            <button class="preset medium">Medium</button>
            <button class="preset fast">Fast</button>
        </div>
    </div>

    <div id="panel-progress"></div>
`;

// ELEMENTS
const btnScroll = panel.querySelector("#btn-toggle-scroll");
const btnAutoNext = panel.querySelector("#btn-auto-next");
const slider = panel.querySelector("#speed-slider");
const speedText = panel.querySelector("#speed-value");
const btnMode = panel.querySelector("#btn-reading-mode");

// PANEL TOGGLE
icon.addEventListener("click", () => {
    panel.classList.toggle("open");
});

// Smooth decel/accel factors
let smoothFactor = 1;
let targetFactor = 1;

function updateSmoothFactor(elapsed) {
    const lerpSpeed = 0.12;
    smoothFactor += (targetFactor - smoothFactor) * lerpSpeed * (elapsed / 16.67);
    smoothFactor = Math.max(0.2, Math.min(1, smoothFactor));
}

// TEXT DENSITY ANALYSIS
function measureTextDensity() {
    let samples = [];
    const sampleCount = 4;

    for (let i = 1; i <= sampleCount; i++) {
        const elem = document.elementFromPoint(
            window.innerWidth / 2,
            window.innerHeight * (0.60 + i * 0.05)
        );

        if (!elem || !elem.innerText) continue;
        const text = elem.innerText.trim();
        if (!text) continue;

        samples.push(text);
    }

    if (samples.length === 0) return 0;

    let totalChars = 0;
    let punctCount = 0;
    let longLines = 0;

    for (const line of samples) {
        totalChars += line.length;
        punctCount += (line.match(/[.,;:!?]/g) || []).length;
        if (line.length > 120) longLines++;
    }

    const avgLen = totalChars / samples.length;

    let density =
        (avgLen / 180) * 0.5 +
        (punctCount / samples.length) * 0.3 +
        (longLines / samples.length) * 0.2;

    return Math.min(1, density);
}

// AUTO SCROLL
function autoScroll(timestamp) {

    if (!scrolling) {
        carry = 0;
        lastTimestamp = null;
        return;
    }

    if (isEyePaused) return;

    if (!lastTimestamp) lastTimestamp = timestamp;
    const elapsed = timestamp - lastTimestamp;
    lastTimestamp = timestamp;

    // ---- ADAPTIVE SPEED (correct location) ----
    if (readingMode === "glide") {
        const density = measureTextDensity();
        const minFactor = 0.6;
        const maxFactor = 1.0;
        targetFactor = minFactor + (1 - density) * (maxFactor - minFactor);
    }

    const normalized = speed / 100;
    const baseSpeed = Math.pow(normalized, 1.7) * 8;

    updateSmoothFactor(elapsed);
    const pixels = baseSpeed * smoothFactor * (elapsed / 16.67);

    carry += pixels;
    const scrollAmount = Math.floor(carry);
    carry -= scrollAmount;

    if (scrollAmount > 0) window.scrollBy(0, scrollAmount);

    // --- EYE MODE ---
    if (readingMode === "eye") {
        const text = document.elementFromPoint(
            window.innerWidth / 2,
            window.innerHeight * 0.55
        )?.innerText || "";

        if (/[.,;:!?]/.test(text)) {

            const myToken = pauseToken;

            targetFactor = 0.45;

            setTimeout(() => {

                isEyePaused = true;

                setTimeout(() => {
                    const tokenChanged = myToken !== pauseToken;
                    if (!tokenChanged && scrolling) {
                        isEyePaused = false;
                        targetFactor = 1;
                        requestAnimationFrame(autoScroll);
                    }
                }, 220 + (100 - speed) * 2.5);

            }, 120);

            return;
        }
    }

    // END PAGE
    if (window.innerHeight + window.scrollY + 2 >= document.body.scrollHeight) {
        scrolling = false;
        btnScroll.textContent = "Start Scrolling";
        carry = 0;
        isEyePaused = false;
        return;
    }

    requestAnimationFrame(autoScroll);
}

// MODE TOGGLE
btnMode.addEventListener("click", () => {
    readingMode = readingMode === "glide" ? "eye" : "glide";
    btnMode.textContent = readingMode === "glide" ? "Mode: Glide" : "Mode: Eye";
});

// START/STOP
btnScroll.addEventListener("click", () => {
    scrolling = !scrolling;
    pauseToken++;
    isEyePaused = false;
    btnScroll.textContent = scrolling ? "Stop Scrolling" : "Start Scrolling";

    if (scrolling) requestAnimationFrame(autoScroll);
});

// AUTO NEXT
btnAutoNext.addEventListener("click", () => {
    autoNext = !autoNext;
    btnAutoNext.textContent = autoNext ? "Auto Next Page: ON" : "Auto Next Page: OFF";
});

// SPEED SLIDER
slider.addEventListener("input", () => {
    speed = Number(slider.value);
    speedText.textContent = speed;
});

// + / - buttons
panel.querySelector("#speed-decrease").addEventListener("click", () => {
    speed = Math.max(1, speed - 1);
    slider.value = speed;
    speedText.textContent = speed;
});
panel.querySelector("#speed-increase").addEventListener("click", () => {
    speed = Math.min(100, speed + 1);
    slider.value = speed;
    speedText.textContent = speed;
});

// PRESETS
panel.querySelector(".slow").addEventListener("click", () => {
    speed = 15; slider.value = 15; speedText.textContent = 15;
});
panel.querySelector(".medium").addEventListener("click", () => {
    speed = 50; slider.value = 50; speedText.textContent = 50;
});
panel.querySelector(".fast").addEventListener("click", () => {
    speed = 90; slider.value = 90; speedText.textContent = 90;
});

// PROGRESS BAR
function updateProgressBar() {
    const scrollTop = window.scrollY;
    const scrollHeight = document.body.scrollHeight - window.innerHeight;
    const progress = scrollHeight > 0 ? (scrollTop / scrollHeight) * 100 : 0;
    document.querySelector("#panel-progress").style.width = progress + "%";
}
window.addEventListener("scroll", updateProgressBar);

// INJECT UI
document.body.appendChild(icon);
document.body.appendChild(panel);
updateProgressBar();
