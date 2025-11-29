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
//  Helpers
// ----------------------------------------------------
document.querySelectorAllContains = function(tag, text) {
    return Array.from(document.querySelectorAll(tag))
        .filter(el => el && el.innerText && el.innerText.toLowerCase().includes(text.toLowerCase()));
};
function safeInnerText(el){ try { return el && el.innerText ? el.innerText : ""; } catch { return ""; } }

// ----------------------------------------------------
//  UI (icon + panel) - injected early
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

document.body.appendChild(icon);
document.body.appendChild(panel);

const btnScroll = panel.querySelector("#btn-toggle-scroll");
const btnAutoNext = panel.querySelector("#btn-auto-next");
const btnMode = panel.querySelector("#btn-reading-mode");
const slider = panel.querySelector("#speed-slider");
const speedText = panel.querySelector("#speed-value");

icon.addEventListener("click", () => panel.classList.toggle("open"));

// ----------------------------------------------------
//  State defaults
// ----------------------------------------------------
let readingMode = "glide";     // 'glide' or 'eye'
let scrolling = false;         // user-intended on/off
let autoNext = false;
let speed = 50;

let pauseToken = 0;
let carry = 0;
let lastTimestamp = null;
let isEyePaused = false;

let smoothFactor = 1;
let targetFactor = 1;

// manual interaction flags for soft resume
let activePausedByUser = false;   // user scrolled -> temporary pause
let allowAutoResume = true;       // set false if user scrolled backward or big jump
let lastUserScrollTime = 0;
let lastUserScrollPos = window.scrollY;
let lastWheelTimestamp = 0;
let userScrollQuietTimeout = null;

// visibility pause
let autoPausedByVisibility = false;

// -----------------------
// Restore settings & resume flag on load
// -----------------------
(async function init() {
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
        // If resume flag is present, wait for stable layout then start from top and ramp-in
        if (saved.resumeScrolling) {
            // clear flag immediately to avoid double triggers
            storage.set({ resumeScrolling: false }).catch(()=>{});
            // wait for stable layout then start
            await waitForStableLayout({stableMs:400, timeout:5000});
            scrollToTopImmediate();
            await rampIn(300);
            scrolling = true;
            btnScroll.textContent = "Stop Scrolling";
            requestAnimationFrame(autoScroll);
            return;
        }
        // otherwise restore explicit scrolling preference
        if (saved.scrolling) {
            scrolling = !!saved.scrolling;
            btnScroll.textContent = scrolling ? "Stop Scrolling" : "Start Scrolling";
            if (scrolling) {
                // small delay to let page settle a little
                await waitForStableLayout({stableMs:200, timeout:2000});
                requestAnimationFrame(autoScroll);
            }
        }
    } catch (e) {
        console.warn("init failed:", e);
    }
})();

// ----------------------------------------------------
// Wait for stable layout: resolve when document.body.scrollHeight hasn't changed for stableMs ms
// ----------------------------------------------------
function waitForStableLayout({stableMs = 400, timeout = 4000} = {}) {
    return new Promise((resolve) => {
        const start = Date.now();
        let lastHeight = document.body ? document.body.scrollHeight : 0;
        let lastChange = Date.now();

        const check = () => {
            const now = Date.now();
            const currentHeight = document.body ? document.body.scrollHeight : 0;
            if (currentHeight !== lastHeight) {
                lastHeight = currentHeight;
                lastChange = now;
            }
            if (now - lastChange >= stableMs) {
                resolve();
                return;
            }
            if (now - start > timeout) {
                resolve();
                return;
            }
            setTimeout(check, 150);
        };
        // small initial delay to allow immediate changes
        setTimeout(check, 120);
    });
}

// ----------------------------------------------------
// Jump-to-top (immediate) and ramp-in
// ----------------------------------------------------
function scrollToTopImmediate() {
    try {
        window.scrollTo(0, 0);
    } catch {}
}

function rampIn(duration = 300) {
    return new Promise(res => {
        const start = performance.now();
        const startVal = 0.05;
        function step(t) {
            const p = Math.min(1, (t - start) / duration);
            smoothFactor = startVal + (1 - startVal) * p;
            if (p < 1) requestAnimationFrame(step);
            else res();
        }
        requestAnimationFrame(step);
    });
}

// ----------------------------------------------------
// Text density & smooth factor
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
    smoothFactor = Math.max(0.05, Math.min(1, smoothFactor)); // allow lower during ramp
}

// ----------------------------------------------------
// Find next chapter button (heuristic)
 // ----------------------------------------------------
function findNextChapterButton() {
    const candidates = Array.from(document.querySelectorAll("a, button"));
    let best = null; let bestScore = 0;
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
        if (t.length < 40) score += 1;
        const rect = el.getBoundingClientRect();
        if (rect.width < 10 || rect.height < 10) score -= 2;
        if (rect.top < 0 && rect.bottom < 0) score -= 1;
        if (score > bestScore) { bestScore = score; best = el; }
    }
    return best;
}

// ----------------------------------------------------
// Bounce animation (medium): +8px then -5px
// ----------------------------------------------------
function animateBounce({down = 8, up = 5, downMs = 90, upMs = 90} = {}) {
    return new Promise(resolve => {
        const startY = window.scrollY;
        const downStart = performance.now();
        function stepDown(t) {
            const p = Math.min(1, (t - downStart) / downMs);
            window.scrollTo(0, startY + Math.round(down * p));
            if (p < 1) requestAnimationFrame(stepDown);
            else {
                const upStart = performance.now();
                function stepUp(u) {
                    const q = Math.min(1, (u - upStart) / upMs);
                    window.scrollTo(0, startY + down - Math.round(up * q));
                    if (q < 1) requestAnimationFrame(stepUp);
                    else { resolve(); }
                }
                requestAnimationFrame(stepUp);
            }
        }
        requestAnimationFrame(stepDown);
    });
}

// ----------------------------------------------------
// Soft-resume user interaction logic
// ----------------------------------------------------
function onUserWheel(e) {
    // if auto-scroll is not enabled, do nothing
    if (!scrolling) return;
    const delta = e.deltaY;
    lastWheelTimestamp = Date.now();
    lastUserScrollPos = window.scrollY;
    lastUserScrollTime = Date.now();

    // mark paused by user
    activePausedByUser = true;

    // if user scrolled up/backwards, disallow auto-resume until user toggles
    if (delta < 0) allowAutoResume = false;

    // if large jump, disallow resume
    if (Math.abs(delta) > 300) allowAutoResume = false;

    // clear previous timeout
    if (userScrollQuietTimeout) clearTimeout(userScrollQuietTimeout);

    // set quiet timeout for resume
    userScrollQuietTimeout = setTimeout(() => {
        // only resume if allowed
        if (!allowAutoResume) {
            // remain paused; do not auto-resume
            activePausedByUser = true;
            return;
        }
        // resume only if user hasn't scrolled back (we check recent delta)
        // and user didn't cause large jump
        activePausedByUser = false;
        // restart autoScroll loop
        lastTimestamp = null;
        rampIn(220).then(()=> {
            if (scrolling && !isEyePaused && !autoPausedByVisibility) requestAnimationFrame(autoScroll);
        });
    }, 120);
}

function onUserTouchStart() {
    if (!scrolling) return;
    activePausedByUser = true;
    allowAutoResume = true;
    if (userScrollQuietTimeout) clearTimeout(userScrollQuietTimeout);
}
function onUserTouchEnd() {
    if (!scrolling) return;
    if (userScrollQuietTimeout) clearTimeout(userScrollQuietTimeout);
    userScrollQuietTimeout = setTimeout(() => {
        if (!allowAutoResume) { activePausedByUser = true; return; }
        activePausedByUser = false;
        lastTimestamp = null;
        rampIn(220).then(() => {
            if (scrolling && !isEyePaused && !autoPausedByVisibility) requestAnimationFrame(autoScroll);
        });
    }, 150);
}

// attach listeners
window.addEventListener("wheel", onUserWheel, {passive: true});
window.addEventListener("touchstart", onUserTouchStart, {passive: true});
window.addEventListener("touchend", onUserTouchEnd, {passive: true});

// Pause when tab not visible or window blurred (Firefox-compatible)
document.addEventListener("visibilitychange", () => {
    if (document.hidden) {
        autoPausedByVisibility = true;
    } else {
        // resume if needed
        autoPausedByVisibility = false;
        if (scrolling && !activePausedByUser && !isEyePaused) {
            lastTimestamp = null;
            requestAnimationFrame(autoScroll);
        }
    }
});
window.addEventListener("blur", () => { autoPausedByVisibility = true; });
window.addEventListener("focus", () => {
    autoPausedByVisibility = false;
    if (scrolling && !activePausedByUser && !isEyePaused) {
        lastTimestamp = null;
        requestAnimationFrame(autoScroll);
    }
});

// ----------------------------------------------------
//  Auto scroll engine (main loop)
// ----------------------------------------------------
function autoScroll(timestamp) {
    // global gating
    if (!scrolling || activePausedByUser || autoPausedByVisibility) {
        lastTimestamp = null;
        return;
    }
    if (isEyePaused) {
        lastTimestamp = null;
        return;
    }

    if (!lastTimestamp) lastTimestamp = timestamp;
    const elapsed = timestamp - lastTimestamp;
    lastTimestamp = timestamp;

    // adaptive glide mode: text density -> target factor
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

    // Eye-follow pause
    if (readingMode === "eye") {
        const text = safeInnerText(document.elementFromPoint(window.innerWidth/2, window.innerHeight*0.55) || "");
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

    // End of page: bounce then next logic
    if (window.innerHeight + window.scrollY + 2 >= document.body.scrollHeight) {
        // stop auto scrolling locally
        scrolling = false;
        carry = 0;
        isEyePaused = false;
        storage.set({ scrolling: false }).catch(()=>{});
        btnScroll.textContent = "Start Scrolling";

        // perform medium bounce
        animateBounce({down:8, up:5, downMs:90, upMs:90}).then(async () => {
            // after bounce, if autoNext is OFF, do nothing
            if (!autoNext) return;

            // set resume flag so next page can resume (user preference preserved)
            await storage.set({ resumeScrolling: true });

            // small natural delay then click next if found
            const delay = 350 + Math.random()*70;
            setTimeout(() => {
                const next = findNextChapterButton();
                if (next) {
                    try {
                        next.scrollIntoView({behavior:'smooth', block:'center'});
                    } catch {}
                    setTimeout(()=> {
                        try { next.click(); } catch(e){ console.warn("click next failed", e); }
                    }, 220);
                } else {
                    // no next found -> clear resume flag
                    storage.set({ resumeScrolling: false }).catch(()=>{});
                }
            }, delay);
        });

        return;
    }

    requestAnimationFrame(autoScroll);
}

// ----------------------------------------------------
// UI interactions + persistence
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
    activePausedByUser = false;
    allowAutoResume = true;
    btnScroll.textContent = scrolling ? "Stop Scrolling" : "Start Scrolling";
    storage.set({ scrolling }).catch(()=>{});
    if (scrolling) {
        lastTimestamp = null;
        requestAnimationFrame(autoScroll);
    }
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

panel.querySelector(".slow").addEventListener("click", () => {
    speed = 15; slider.value = 15; speedText.textContent = 15; storage.set({ speed }).catch(()=>{});
});
panel.querySelector(".medium").addEventListener("click", () => {
    speed = 50; slider.value = 50; speedText.textContent = 50; storage.set({ speed }).catch(()=>{});
});
panel.querySelector(".fast").addEventListener("click", () => {
    speed = 90; slider.value = 90; speedText.textContent = 90; storage.set({ speed }).catch(()=>{});
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
updateProgressBar();
