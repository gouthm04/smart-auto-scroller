// ICON
const icon = document.createElement("img");
icon.id = "overlay-icon";
icon.src = browser.runtime.getURL("icon.png");

// PANEL
const panel = document.createElement("div");
panel.id = "overlay-panel";

// PANEL UI
panel.innerHTML = `
    <div class="panel-content">

        <button id="btn-toggle-scroll" class="panel-btn">Start Scrolling</button>

        <button id="btn-auto-next" class="panel-btn secondary">Auto Next: OFF</button>

        <div class="speed-section">
            <label>Speed: <span id="speed-value">50</span></label>

            <div class="speed-control">
                <button id="speed-decrease" class="speed-btn">−</button>
                <input type="range" id="speed-slider" min="1" max="100" value="50">
                <button id="speed-increase" class="speed-btn">+</button>
            </div>
        </div>


        <div class="preset-buttons">
            <button class="preset slow">Slow</button>
            <button class="preset medium">Medium</button>
            <button class="preset fast">Fast</button>
        </div>

    </div>
`;

// --- LOGIC ---
let scrolling = false;
let autoNext = false;
let speed = 50; // default

const btnScroll = panel.querySelector("#btn-toggle-scroll");
const btnAutoNext = panel.querySelector("#btn-auto-next");
const slider = panel.querySelector("#speed-slider");
const speedText = panel.querySelector("#speed-value");

// toggle panel
icon.addEventListener("click", () => {
  panel.classList.toggle("open");
});
let lastTimestamp = null;

function autoScroll(timestamp) {
  if (!scrolling) {
    lastTimestamp = null;
    return;
  }

  if (!lastTimestamp) lastTimestamp = timestamp;

  const elapsed = timestamp - lastTimestamp;
  lastTimestamp = timestamp;

  // Movement = speed * time factor
  const pixels = speed * 0.05 * (elapsed / 16.67);
  // 16.67ms = frame time ~60fps

  window.scrollBy(0, pixels);

  // Reach bottom
  if (window.innerHeight + window.scrollY + 2 >= document.body.scrollHeight) {
    scrolling = false;
    btnScroll.textContent = "Start Scrolling";

    if (autoNext) {
      console.log("Auto-next triggered here.");
    }

    return;
  }

  requestAnimationFrame(autoScroll);
}

// START / STOP BUTTON
btnScroll.addEventListener("click", () => {
  scrolling = !scrolling;
  btnScroll.textContent = scrolling ? "Stop Scrolling" : "Start Scrolling";
  if (scrolling) requestAnimationFrame(autoScroll);
});

// AUTO NEXT PAGE BUTTON
btnAutoNext.addEventListener("click", () => {
  autoNext = !autoNext;
  btnAutoNext.textContent = autoNext ? "Auto Next: ON" : "Auto Next: OFF";
});

// SPEED SLIDER → updates live
// + / - buttons
const btnMinus = panel.querySelector("#speed-decrease");
const btnPlus = panel.querySelector("#speed-increase");

btnMinus.addEventListener("click", () => {
    speed = Math.max(1, speed - 1);
    slider.value = speed;
    speedText.textContent = speed;
});

btnPlus.addEventListener("click", () => {
    speed = Math.min(100, speed + 1);
    slider.value = speed;
    speedText.textContent = speed;
});
slider.addEventListener("input", () => {
    speed = Number(slider.value);
    speedText.textContent = speed;
});


// PRESET BUTTONS
panel.querySelector(".slow").addEventListener("click", () => {
  speed = 20;
  slider.value = 20;
  speedText.textContent = 20;
});

panel.querySelector(".medium").addEventListener("click", () => {
  speed = 50;
  slider.value = 50;
  speedText.textContent = 50;
});

panel.querySelector(".fast").addEventListener("click", () => {
  speed = 90;
  slider.value = 90;
  speedText.textContent = 90;
});

// inject
document.body.appendChild(icon);
document.body.appendChild(panel);
