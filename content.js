// =============================
// Auto-scroll / Page-step script
// =============================

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
document.querySelectorAllContains = function(tag, text) {
    return Array.from(document.querySelectorAll(tag))
        .filter(el => el && el.innerText && el.innerText.toLowerCase().includes(text.toLowerCase()));
};
function safeInnerText(el) {
    try { return (el && el.innerText) ? el.innerText : ""; } catch { return ""; }
}

// ----------------------------------------------------
//  ICON + PANEL UI (with reading pace control)
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
    <button id="btn-reading-mode" class="panel-btn secondary">Scrolling Mode: Glide</button>
    <button id="btn-auto-next" class="panel-btn secondary">Auto Next Page: OFF</button>

    <div class="speed-section">
      <label>Speed: <span id="speed-value">50</span></label>
      <div class="speed-control">
        <button id="speed-decrease" class="speed-btn">−</button>
        <input type="range" id="speed-slider" min="1" max="100" value="50">
        <button id="speed-increase" class="speed-btn">+</button>
      </div>
    </div>

    <div id="presets" class="preset-buttons">
      <button class="preset slow">Slow</button>
      <button class="preset medium">Medium</button>
      <button class="preset fast">Fast</button>
    </div>

    <div id="reading-pace-row" style="display:none; margin-top:8px;">
      <label>Reading pace: <span id="pace-value">8</span> ch/sec</label>
      <div class="pace-control">
        <input type="range" id="pace-slider" min="8" max="60" value="25">
      </div>
    </div>

  </div>

`;

document.body.appendChild(icon);
document.body.appendChild(panel);

// Element refs
const btnScroll = panel.querySelector("#btn-toggle-scroll");
const btnAutoNext = panel.querySelector("#btn-auto-next");
const btnMode = panel.querySelector("#btn-reading-mode");
const slider = panel.querySelector("#speed-slider");
const speedText = panel.querySelector("#speed-value");
const presetsEl = panel.querySelector("#presets");
const paceRow = panel.querySelector("#reading-pace-row");
const paceSlider = panel.querySelector("#pace-slider");
const paceText = panel.querySelector("#pace-value");

icon.addEventListener("click", () => panel.classList.toggle("open"));

// ----------------------------------------------------
//  STATE (defaults)
// ----------------------------------------------------
let readingMode = "glide";     // 'glide' or 'page'
let scrolling = false;
let autoNext = false;
let speed = 50;
let readingPace = 25;           // chars/sec, default
let pauseToken = 0;
let carry = 0;
let lastTimestamp = null;
let isEyePaused = false;
let smoothFactor = 1;
let targetFactor = 1;
let autoPausedByVisibility = false;
let pageStepPending = false;
let firstPageStep = true;

// ----------------------------------------------------
//  Show/hide controls depending on mode
// ----------------------------------------------------
function updateModeUI() {
    if (readingMode === "glide") {
        presetsEl.style.display = "";        // show presets
        paceRow.style.display = "none";      // hide reading pace
        btnMode.textContent = "Scrolling Mode: Glide";
    } else {
        presetsEl.style.display = "none";
        paceRow.style.display = "";          // show reading pace
        btnMode.textContent = "Scrolling Mode: Page";
    }
}

// ----------------------------------------------------
//  Pause / Resume on visibility / focus
// ----------------------------------------------------
function pauseForVisibility() {
    if (!scrolling) return;
    autoPausedByVisibility = true;
}
function resumeFromVisibility() {
    if (!scrolling) return;
    autoPausedByVisibility = false;
    lastTimestamp = null;
    // let the user re-orient briefly
    setTimeout(() => {
        if (scrolling && !autoPausedByVisibility) requestAnimationFrame(autoScroll);
    }, 250);
}
document.addEventListener("visibilitychange", () => document.hidden ? pauseForVisibility() : resumeFromVisibility());
window.addEventListener("blur", pauseForVisibility);
window.addEventListener("focus", resumeFromVisibility);

// ----------------------------------------------------
//  Restore saved settings & init UI
// ----------------------------------------------------
(async function initFromStorage() {
    try {
        const saved = await storage.get(["autoNext", "scrolling", "speed", "readingMode", "resumeScrolling", "readingPace"]);
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
        }
        if (saved.readingPace !== undefined) {
            readingPace = saved.readingPace;
            paceSlider.value = readingPace;
            paceText.textContent = readingPace;
        }
        updateModeUI();
        if (saved.resumeScrolling) {
            scrolling = true;
            btnScroll.textContent = "Stop Scrolling";
            storage.set({ resumeScrolling: false }).catch(()=>{});
            requestAnimationFrame(autoScroll);
        } else if (saved.scrolling) {
            scrolling = !!saved.scrolling;
            btnScroll.textContent = scrolling ? "Stop Scrolling" : "Start Scrolling";
            if (scrolling) requestAnimationFrame(autoScroll);
        }
    } catch (e) {
        console.warn("initFromStorage failed:", e);
        updateModeUI();
    }
})();

// ----------------------------------------------------
//  TEXT DENSITY / visible characters estimation
// ----------------------------------------------------
function estimateVisibleChars() {
    // sample several points down the viewport and sum the text lengths we find
    const sampleCount = 5;
    let chars = 0;
    for (let i = 0; i < sampleCount; i++) {
        const y = Math.round(window.innerHeight * (0.15 + i * 0.17));
        const el = document.elementFromPoint(window.innerWidth / 2, y);
        if (!el) continue;
        const txt = safeInnerText(el).trim();
        chars += txt.length;
    }
    // rough scale: the sample covers many lines; normalize
    // Clamp to reasonable min/max to avoid bad estimates
    chars = Math.round(Math.max(80, Math.min(2500, chars * 1.2)));
    return chars;
}

// ----------------------------------------------------
//  Page-mode pause mapping: chars/sec -> ms pause
// ----------------------------------------------------
function pauseMsFromReadingPace(charsPerSec) {
    const visibleChars = estimateVisibleChars();
    const cps = Math.max(1, charsPerSec);
    const ms = Math.round((visibleChars / cps) * 1000);
    // clamp minimum/maximum to keep UX sane
    return Math.max(900, Math.min(40000, ms)); // 0.9s..40s
}

// Backwards fallback if user prefers speed slider mapping
function pauseMsFromSpeed(speedVal) {
    const s = Math.max(1, Math.min(100, speedVal));
    const minPause = 900;
    const maxPause = 16500;
    const ratio = Math.log(s) / Math.log(100);
    const ms = maxPause - ratio * (maxPause - minPause);
    return Math.round(ms);
}

// ----------------------------------------------------
//  Smooth scroll helper (for nicer page jumps)
// ----------------------------------------------------
function smoothScrollTo(targetY, duration) {
    const startY = window.scrollY;
    const diff = targetY - startY;
    const start = performance.now();
    return new Promise(resolve => {
        function step(ts) {
            const t = Math.min(1, (ts - start) / duration);
            const eased = t < 0.5 ? 2 * t * t : -1 + (4 - 2 * t) * t;
            window.scrollTo(0, Math.round(startY + diff * eased));
            if (t < 1) requestAnimationFrame(step);
            else resolve();
        }
        requestAnimationFrame(step);
    });
}

// ----------------------------------------------------
//  Page-step helpers
// ----------------------------------------------------
function computePageStepTarget(overlap = 0.12) {
    const vh = window.innerHeight;
    const step = Math.round(vh * (1 - overlap));
    const maxY = Math.max(0, document.body.scrollHeight - vh);
    const target = Math.min(maxY, window.scrollY + step);
    return target;
}

async function doPageStep() {
    if (pageStepPending) return;
    pageStepPending = true;

    // If we've reached bottom, handle autoNext; doPageStep will early return after handling
    const atBottom = (window.innerHeight + window.scrollY + 2 >= document.body.scrollHeight);
    if (atBottom) {
        pageStepPending = false;
        scrolling = false;
        carry = 0;
        isEyePaused = false;
        storage.set({ scrolling: false }).catch(()=>{});
        btnScroll.textContent = "Start Scrolling";
        if (!autoNext) return;
        await storage.set({ resumeScrolling: true }).catch(()=>{});
        targetFactor = 0.45;
        const delay = 350 + Math.random() * 70;
        setTimeout(() => {
            const nextBtn = findNextChapterButton();
            if (nextBtn) {
                try { nextBtn.scrollIntoView({ behavior: "smooth", block: "center" }); } catch {}
                setTimeout(() => { try { nextBtn.click(); } catch(e){} }, 220);
            } else {
                storage.set({ resumeScrolling: false }).catch(()=>{});
            }
        }, delay);
        return;
    }

    // FIRST STEP: if it's the initial start, give user entire pause time before first jump
    if (firstPageStep) {
        firstPageStep = false;
        const ms = (readingPace ? pauseMsFromReadingPace(readingPace) : pauseMsFromSpeed(speed));
        await new Promise(r => setTimeout(r, ms));
        pageStepPending = false;
        if (scrolling && !autoPausedByVisibility) requestAnimationFrame(autoScroll);
        return;
    }

    // 1) micro-settle so the eye finishes the visible line
    await new Promise(r => setTimeout(r, 130));

    // 2) compute larger overlap to avoid skipping a line (e.g. 20% overlap)
    const targetY = computePageStepTarget(0.20);

    // Let user finish the current line before the jump
    await new Promise(r => setTimeout(r, 180));

    // 3) smooth jump
    try {
        await smoothScrollTo(targetY, 350);
    } catch {
        window.scrollTo(0, targetY);
    }

    lastTimestamp = null;

    // 4) pause based on reading pace or fallback speed
    const ms = (readingPace ? pauseMsFromReadingPace(readingPace) : pauseMsFromSpeed(speed));
    await new Promise(resolve => setTimeout(resolve, ms));

    pageStepPending = false;

    // 5) next cycle
    if (scrolling && !autoPausedByVisibility) requestAnimationFrame(autoScroll);
}

// ----------------------------------------------------
//  FIND NEXT CHAPTER BUTTON (scoring + heuristics)
// ----------------------------------------------------
function findNextChapterButton() {
    const candidates = Array.from(document.querySelectorAll("a, button"));
    let best = null;
    let bestScore = 0;
    const regex = /(chapter|episode|next|continue|>>|>|\bpart\b|section|act|volume)/i;

    for (const el of candidates) {
        const t = safeInnerText(el).trim();
        if (!t) continue;
        if (!t.match(regex)) continue;
        let score = 1;
        const lower = t.toLowerCase();
        if (/next chapter/i.test(t)) score += 5;
        if (/next/i.test(lower)) score += 3;
        if (/continue/i.test(lower)) score += 2;
        if (/^>$|^>>$/.test(lower)) score += 1;
        if (el.matches && el.matches(".btn, button, .next, .nav-next, .pagination-next")) score += 2;
        if (t.length < 40) score += 1;
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
//  AUTO SCROLL ENGINE (glide continuous + page mode)
 // ----------------------------------------------------
function autoScroll(timestamp) {
    if (!scrolling) {
        carry = 0;
        lastTimestamp = null;
        return;
    }
    if (autoPausedByVisibility) {
        lastTimestamp = null;
        return;
    }

    // small safety: if nearly bottom, let page handler deal with it
    if (window.scrollY >= document.body.scrollHeight - window.innerHeight - 5) {
        return;
    }

    // If we're in page mode, run the page-step helper and return
    if (readingMode === 'page') {
        doPageStep();
        return;
    }

    // Glide mode
    if (isEyePaused) return;
    if (!lastTimestamp) lastTimestamp = timestamp;
    const elapsed = timestamp - lastTimestamp;
    lastTimestamp = timestamp;

    // adaptive glide factor based on density
    const density = measureTextDensity();
    const minFactor = 0.6;
    const maxFactor = 1.0;
    targetFactor = minFactor + (1 - density) * (maxFactor - minFactor);

    const normalized = speed / 100;
    const baseSpeed = Math.pow(normalized, 1.7) * 8;
    updateSmoothFactor(elapsed);
    const pixels = baseSpeed * smoothFactor * (elapsed / 16.67);

    carry += pixels;
    const scrollAmount = Math.floor(carry);
    carry -= scrollAmount;
    if (scrollAmount > 0) window.scrollBy(0, scrollAmount);

    // End of page check + Auto Next
    if (window.innerHeight + window.scrollY + 2 >= document.body.scrollHeight) {
        scrolling = false;
        carry = 0;
        isEyePaused = false;
        storage.set({ scrolling: false }).catch(()=>{});
        btnScroll.textContent = "Start Scrolling";
        if (!autoNext) return;
        storage.set({ resumeScrolling: true }).catch(()=>{});
        targetFactor = 0.45;
        const delay = 350 + Math.random() * 70;
        setTimeout(() => {
            const nextBtn = findNextChapterButton();
            if (nextBtn) {
                try { nextBtn.scrollIntoView({ behavior: "smooth", block: "center" }); } catch {}
                setTimeout(() => { try { nextBtn.click(); } catch(e){ console.warn("nextBtn.click failed:", e); } }, 220);
            } else {
                storage.set({ resumeScrolling: false }).catch(()=>{});
            }
        }, delay);
        return;
    }

    requestAnimationFrame(autoScroll);
}

// ----------------------------------------------------
//  SMALL HELPERS (density / smoothing)
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
function updateSmoothFactor(elapsed) {
    const lerpSpeed = 0.12;
    smoothFactor += (targetFactor - smoothFactor) * lerpSpeed * (elapsed / 16.67);
    smoothFactor = Math.max(0.2, Math.min(1, smoothFactor));
}

// ----------------------------------------------------
//  UI Actions & Persistence
// ----------------------------------------------------
btnMode.addEventListener("click", () => {
    readingMode = readingMode === "glide" ? "page" : "glide";
    storage.set({ readingMode }).catch(()=>{});
    updateModeUI();

    if (readingMode === "page") {
        firstPageStep = true;
    }

    if (scrolling) {
        pageStepPending = false;  
        lastTimestamp = null;      
        requestAnimationFrame(autoScroll);
    }
});

btnScroll.addEventListener("click", () => {
    scrolling = !scrolling;
    firstPageStep = true;
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

slider.addEventListener("input", () => {
    speed = Number(slider.value);
    speedText.textContent = speed;
    storage.set({ speed }).catch(()=>{});
});
panel.querySelector("#speed-decrease").addEventListener("click", () => {
    speed = Math.max(1, speed - 1); slider.value = speed; speedText.textContent = speed; storage.set({ speed }).catch(()=>{});
});
panel.querySelector("#speed-increase").addEventListener("click", () => {
    speed = Math.min(100, speed + 1); slider.value = speed; speedText.textContent = speed; storage.set({ speed }).catch(()=>{});
});

// presets (glide only)
panel.querySelector(".slow").addEventListener("click", () => { speed = 15; slider.value = 15; speedText.textContent = 15; storage.set({ speed }).catch(()=>{}); });
panel.querySelector(".medium").addEventListener("click", () => { speed = 50; slider.value = 50; speedText.textContent = 50; storage.set({ speed }).catch(()=>{}); });
panel.querySelector(".fast").addEventListener("click", () => { speed = 90; slider.value = 90; speedText.textContent = 90; storage.set({ speed }).catch(()=>{}); });

// reading pace slider (page mode)
paceSlider.addEventListener("input", () => {
    readingPace = Number(paceSlider.value);
    paceText.textContent = readingPace;
    storage.set({ readingPace }).catch(()=>{});
});

// progress bar
function updateProgressBar() {
    const scrollTop = window.scrollY;
    const scrollMax = document.body.scrollHeight - window.innerHeight;
    const progress = scrollMax > 0 ? (scrollTop / scrollMax) * 100 : 0;
    const el = document.querySelector("#panel-progress");
    if (el) el.style.width = progress + "%";
}
window.addEventListener("scroll", updateProgressBar);

// initial progress update
updateProgressBar();
updateModeUI();

// Expose a tiny API for debugging (optional)
window._readerAssist = {
    estimateVisibleChars,
    pauseMsFromReadingPace,
    pauseMsFromSpeed,
    forceMode: (m) => { readingMode = m; updateModeUI(); }
};
