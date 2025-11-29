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
let isEyePaused = false;   // <-- FIX: new state

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

    <!-- PROGRESS BAR OUTSIDE CONTENT BUT INSIDE PANEL -->
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
let smoothFactor = 1;     // dynamic multiplier
let targetFactor = 1;     // where we want factor to move toward

function updateSmoothFactor(elapsed) {
    const lerpSpeed = 0.12; // smoothness (A2 balanced)

    smoothFactor += (targetFactor - smoothFactor) * lerpSpeed * (elapsed / 16.67);

    // clamp
    if (smoothFactor < 0.2) smoothFactor = 0.2;
    if (smoothFactor > 1) smoothFactor = 1;
}

// AUTO SCROLL ENGINE
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

    const normalized = speed / 100;
    const baseSpeed = Math.pow(normalized, 1.7) * 8;

    updateSmoothFactor(elapsed);
    const pixels = baseSpeed * smoothFactor * (elapsed / 16.67);

    carry += pixels;
    const scrollAmount = Math.floor(carry);
    carry -= scrollAmount;

    if (scrollAmount > 0) window.scrollBy(0, scrollAmount);

    // ---------------------------
    // EYE MODE
    // ---------------------------
    if (readingMode === "eye") {
        const text = document.elementFromPoint(
            window.innerWidth / 2,
            window.innerHeight * 0.55
        )?.innerText || "";

        if (/[.,;:!?]/.test(text)) {

            const myToken = pauseToken;

            // 1) Begin slowing down
            targetFactor = 0.45;

            setTimeout(() => {

                // 2) Fully pause
                isEyePaused = true;
                targetFactor = 1; // reset

                setTimeout(() => {

                    const tokenChanged = myToken !== pauseToken;
                    if (!tokenChanged && scrolling) {
                        isEyePaused = false;
                        requestAnimationFrame(autoScroll);
                    }

                }, 220 + (100 - speed) * 2.5);

            }, 120);

            return;
        }
    }

    // END OF PAGE
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

// START/STOP BUTTON
btnScroll.addEventListener("click", () => {
    scrolling = !scrolling;
    pauseToken++;   // cancel eye resumes
    isEyePaused = false;
    btnScroll.textContent = scrolling ? "Stop Scrolling" : "Start Scrolling";

    if (scrolling) requestAnimationFrame(autoScroll);
});

// AUTO NEXT BUTTON
btnAutoNext.addEventListener("click", () => {
    autoNext = !autoNext;
    btnAutoNext.textContent = autoNext ? "Auto Next Page: ON" : "Auto Next Page: OFF";
});

// SPEED SLIDER
slider.addEventListener("input", () => {
    speed = Number(slider.value);
    speedText.textContent = speed;
});

// + / -
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
function updateProgressBar() {
    const scrollTop = window.scrollY;
    const scrollHeight = document.body.scrollHeight - window.innerHeight;

    const progress = scrollHeight > 0
        ? (scrollTop / scrollHeight) * 100
        : 0;

    document.querySelector("#panel-progress").style.width = progress + "%";
}



window.addEventListener("scroll", updateProgressBar);

// INJECT UI
document.body.appendChild(icon);
document.body.appendChild(panel);
updateProgressBar();

