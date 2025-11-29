// -----------------------------
// Storage helper (robust fallback)
// -----------------------------
const storage = {
    async get(keys) {
        try {
            if (typeof browser !== "undefined" && browser.storage && browser.storage.local) {
                return await browser.storage.local.get(keys);
            }
            if (typeof chrome !== "undefined" && chrome.storage && chrome.storage.local) {
                return await new Promise(resolve => chrome.storage.local.get(keys, resolve));
            }
            // fallback to localStorage
            const out = {};
            if (Array.isArray(keys)) {
                for (const k of keys) {
                    const raw = localStorage.getItem(k);
                    out[k] = raw === null ? undefined : JSON.parse(raw);
                }
            } else if (typeof keys === "object") {
                for (const k of Object.keys(keys)) {
                    const raw = localStorage.getItem(k);
                    out[k] = raw === null ? keys[k] : JSON.parse(raw);
                }
            } else if (typeof keys === "string") {
                const raw = localStorage.getItem(keys);
                out[keys] = raw === null ? undefined : JSON.parse(raw);
            }
            return out;
        } catch (e) {
            console.warn("storage.get failed, using fallback:", e);
            return {};
        }
    },
    async set(obj) {
        try {
            if (typeof browser !== "undefined" && browser.storage && browser.storage.local) {
                return await browser.storage.local.set(obj);
            }
            if (typeof chrome !== "undefined" && chrome.storage && chrome.storage.local) {
                return await new Promise(resolve => chrome.storage.local.set(obj, resolve));
            }
            for (const k of Object.keys(obj)) {
                localStorage.setItem(k, JSON.stringify(obj[k]));
            }
        } catch (e) {
            console.warn("storage.set failed, using fallback:", e);
        }
    }
};

// ----------------------------------------------------
//  GLOBAL HELPERS
// ----------------------------------------------------

// jQuery-like contains helper
document.querySelectorAllContains = function(tag, text) {
    return Array.from(document.querySelectorAll(tag))
        .filter(el => el && el.innerText && el.innerText.toLowerCase().includes(text.toLowerCase()));
};

// safe getText
function safeInnerText(el) {
    try { return (el && el.innerText) ? el.innerText : ""; } catch { return ""; }
}

// ----------------------------------------------------
//  ICON + PANEL UI
// ----------------------------------------------------
const icon = document.createElement("img");
icon.id = "overlay-icon";
try {
    icon.src = (typeof browser !== "undefined" && browser.runtime && browser.runtime.getURL)
        ? browser.runtime.getURL("icon.png")
        : (typeof chrome !== "undefined" && chrome.runtime && chrome.runtime.getURL)
            ? chrome.runtime.getURL("icon.png")
            : "data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='48' height='48'%3E%3Ccircle cx='24' cy='24' r='20' fill='%2300DC82'/%3E%3C/svg%3E";
} catch (e) {
    icon.src = "data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='48' height='48'%3E%3Ccircle cx='24' cy='24' r='20' fill='%2300DC82'/%3E%3C/svg%3E";
}

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

// Append UI early (so it's visible even while storage resolves)
document.body.appendChild(icon);
document.body.appendChild(panel);

// Element refs (now that panel exists)
const btnScroll = panel.querySelector("#btn-toggle-scroll");
const btnAutoNext = panel.querySelector("#btn-auto-next");
const btnMode = panel.querySelector("#btn-reading-mode");
const slider = panel.querySelector("#speed-slider");
const speedText = panel.querySelector("#speed-value");

// small toggle
icon.addEventListener("click", () => panel.classList.toggle("open"));

// ----------------------------------------------------
//  STATE (defaults)
 // ----------------------------------------------------
let readingMode = "glide";     // 'glide' or 'eye'
let scrolling = false;         // should scroll now?
let autoNext = false;          // auto-next enabled?
let speed = 50;                // 1..100
let pauseToken = 0;
let carry = 0;
let lastTimestamp = null;
let isEyePaused = false;

let smoothFactor = 1;
let targetFactor = 1;

// ----------------------------------------------------
//  Restore saved settings & resume flag
// ----------------------------------------------------
(async function initFromStorage() {
    try {
        const saved = await storage.get(["autoNext", "scrolling", "speed", "readingMode", "resumeScrolling"]);
        if (saved.autoNext !== undefined) {
            autoNext = saved.autoNext;
            btnAutoNext.textContent = autoNext ? "Auto Next Page: ON" : "Auto Next Page: OFF";
        }
        if (saved.speed !== undefined) {
            speed = saved.speed;
            slider.value = speed;
            speedText.textContent = speed;
        }
        if (saved.readingMode !== undefined) {
            readingMode = saved.readingMode;
            btnMode.textContent = readingMode === "glide" ? "Mode: Glide" : "Mode: Eye";
        }
        // If resumeScrolling flag was set (auto-next clicked previous page),
        // restore scrolling state and clear the flag.
        if (saved.resumeScrolling) {
            scrolling = true;
            btnScroll.textContent = "Stop Scrolling";
            // clear resume flag for next time
            storage.set({ resumeScrolling: false }).catch(()=>{});
            requestAnimationFrame(autoScroll);
        } else if (saved.scrolling) {
            // If the user explicitly had scrolling ON, restore it
            scrolling = !!saved.scrolling;
            btnScroll.textContent = scrolling ? "Stop Scrolling" : "Start Scrolling";
            if (scrolling) requestAnimationFrame(autoScroll);
        }
    } catch (e) {
        console.warn("initFromStorage failed:", e);
    }
})();

// ----------------------------------------------------
//  TEXT DENSITY MEASUREMENT
// ----------------------------------------------------
function measureTextDensity() {
    const samples = [];
    const sampleCount = 4;
    for (let i = 1; i <= sampleCount; i++) {
        const y = window.innerHeight * (0.60 + i * 0.05);
        const el = document.elementFromPoint(window.innerWidth / 2, y);
        if (!el) continue;
        const text = safeInnerText(el).trim();
        if (!text) continue;
        samples.push(text);
    }
    if (!samples.length) return 0;
    let totalChars = 0, punct = 0, long = 0;
    for (const s of samples) {
        totalChars += s.length;
        punct += (s.match(/[.,;:!?]/g) || []).length;
        if (s.length > 120) long++;
    }
    const avgLen = totalChars / samples.length;
    let density = (avgLen / 180) * 0.5 + (punct / samples.length) * 0.3 + (long / samples.length) * 0.2;
    return Math.min(1, density);
}

// ----------------------------------------------------
//  SMOOTH FACTOR
// ----------------------------------------------------
function updateSmoothFactor(elapsed) {
    const lerpSpeed = 0.12;
    smoothFactor += (targetFactor - smoothFactor) * lerpSpeed * (elapsed / 16.67);
    smoothFactor = Math.max(0.2, Math.min(1, smoothFactor));
}

// ----------------------------------------------------
//  FIND NEXT CHAPTER BUTTON (scoring + heuristics)
// ----------------------------------------------------
function findNextChapterButton() {
    // gather candidate anchors/buttons
    const candidates = Array.from(document.querySelectorAll("a, button"));
    let best = null;
    let bestScore = 0;

    const regex = /(chapter|episode|next|continue|>>|>|\bpart\b|section|act|volume)/i;

    for (const el of candidates) {
        const t = safeInnerText(el).trim();
        if (!t) continue;

        const m = t.match(regex);
        if (!m) continue;

        let score = 1;

        const lower = t.toLowerCase();
        if (/next chapter/i.test(t)) score += 5;
        if (/next/i.test(lower)) score += 3;
        if (/continue/i.test(lower)) score += 2;
        if (/^>$|^>>$/.test(lower)) score += 1;
        if (el.matches && el.matches(".btn, button, .next, .nav-next, .pagination-next")) score += 2;
        // prefer shorter labels (button-like)
        if (t.length < 40) score += 1;

        // prefer visible and clickable
        const rect = el.getBoundingClientRect();
        if (rect.width < 10 || rect.height < 10) score -= 2;
        if (rect.top < 0 && rect.bottom < 0) score -= 1;

        if (score > bestScore) {
            bestScore = score;
            best = el;
        }
    }

    return best;
}

// ----------------------------------------------------
//  AUTO SCROLL ENGINE
// ----------------------------------------------------
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

    // Adaptive (glide) mode
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

    // Eye-follow pauses at punctuation
    if (readingMode === "eye") {
        const text = safeInnerText(document.elementFromPoint(window.innerWidth / 2, window.innerHeight * 0.55) || "");
        if (/[.,;:!?]/.test(text)) {
            const token = pauseToken;
            targetFactor = 0.45;
            setTimeout(() => {
                isEyePaused = true;
                setTimeout(() => {
                    if (token === pauseToken && scrolling) {
                        isEyePaused = false;
                        targetFactor = 1;
                        requestAnimationFrame(autoScroll);
                    }
                }, 220 + (100 - speed) * 2.5);
            }, 120);
            return;
        }
    }

    // End of page check + Auto Next
    if (window.innerHeight + window.scrollY + 2 >= document.body.scrollHeight) {
        // stop local scrolling state now
        scrolling = false;
        carry = 0;
        isEyePaused = false;

        // persist exact user-visible state: scrolling is false now
        storage.set({ scrolling: false }).catch(()=>{});

        btnScroll.textContent = "Start Scrolling";

        if (!autoNext) return;

        // We want to resume on the next page if user had scrolling ON before clicking next.
        // Set resume flag and then click next.
        storage.set({ resumeScrolling: true }).catch(()=>{});

        targetFactor = 0.45;
        const delay = 350 + Math.random() * 70; // 350..420ms

        setTimeout(() => {
            const nextBtn = findNextChapterButton();
            if (nextBtn) {
                // smooth scroll to button visually
                try {
                    nextBtn.scrollIntoView({ behavior: "smooth", block: "center" });
                } catch (e) { /* ignore */ }

                // slight settle then click
                setTimeout(() => {
                    try {
                        // clicking should navigate in same tab
                        nextBtn.click();
                    } catch (e) {
                        console.warn("nextBtn.click failed:", e);
                    }
                }, 220);
            } else {
                // no next found: clear resume flag
                storage.set({ resumeScrolling: false }).catch(()=>{});
            }
        }, delay);

        return;
    }

    requestAnimationFrame(autoScroll);
}

// ----------------------------------------------------
//  UI Actions & Persistence
// ----------------------------------------------------
btnMode.addEventListener("click", () => {
    readingMode = readingMode === "glide" ? "eye" : "glide";
    btnMode.textContent = readingMode === "glide" ? "Mode: Glide" : "Mode: Eye";
    storage.set({ readingMode }).catch(()=>{});
});

btnScroll.addEventListener("click", () => {
    scrolling = !scrolling;
    pauseToken++;
    isEyePaused = false;
    btnScroll.textContent = scrolling ? "Stop Scrolling" : "Start Scrolling";
    storage.set({ scrolling }).catch(()=>{});
    if (scrolling) requestAnimationFrame(autoScroll);
});

btnAutoNext.addEventListener("click", () => {
    autoNext = !autoNext;
    btnAutoNext.textContent = autoNext ? "Auto Next Page: ON" : "Auto Next Page: OFF";
    storage.set({ autoNext }).catch(()=>{});
});

// speed inputs
slider.addEventListener("input", () => {
    speed = Number(slider.value);
    speedText.textContent = speed;
    storage.set({ speed }).catch(()=>{});
});

panel.querySelector("#speed-decrease").addEventListener("click", () => {
    speed = Math.max(1, speed - 1);
    slider.value = speed;
    speedText.textContent = speed;
    storage.set({ speed }).catch(()=>{});
});
panel.querySelector("#speed-increase").addEventListener("click", () => {
    speed = Math.min(100, speed + 1);
    slider.value = speed;
    speedText.textContent = speed;
    storage.set({ speed }).catch(()=>{});
});

// presets
panel.querySelector(".slow").addEventListener("click", () => {
    speed = 15; slider.value = 15; speedText.textContent = 15;
    storage.set({ speed }).catch(()=>{});
});
panel.querySelector(".medium").addEventListener("click", () => {
    speed = 50; slider.value = 50; speedText.textContent = 50;
    storage.set({ speed }).catch(()=>{});
});
panel.querySelector(".fast").addEventListener("click", () => {
    speed = 90; slider.value = 90; speedText.textContent = 90;
    storage.set({ speed }).catch(()=>{});
});

// progress bar
function updateProgressBar() {
    const scrollTop = window.scrollY;
    const scrollMax = document.body.scrollHeight - window.innerHeight;
    const progress = scrollMax > 0 ? (scrollTop / scrollMax) * 100 : 0;
    const el = document.querySelector("#panel-progress");
    if (el) el.style.width = progress + "%";
}
// ----------------------------------------------------
//  MANUAL USER SCROLL → SOFT PAUSE + CLEAN RESUME
//  (Does NOT touch eye-mode pause logic)
// ----------------------------------------------------
let userOverride = false;
let lastUserY = window.scrollY;
let overrideTimer = null;

window.addEventListener("scroll", () => {
    if (!scrolling) {
        lastUserY = window.scrollY;
        return;
    }

    const currentY = window.scrollY;

    // Detect any user scroll (up/down)
    if (currentY !== lastUserY) {

        userOverride = true;

        // stop ONLY the autoscroll loop, NOT glide speed logic
        lastTimestamp = null;

        clearTimeout(overrideTimer);

        // resume smoothly after user stops touching
        overrideTimer = setTimeout(() => {
            userOverride = false;

            // resume only if auto-scrolling is still ON
            if (scrolling && !isEyePaused) {
                requestAnimationFrame(autoScroll);
            }
        }, 220); // small human pause
    }

    lastUserY = currentY;
});

window.addEventListener("scroll", updateProgressBar);

// initial progress update
updateProgressBar();
