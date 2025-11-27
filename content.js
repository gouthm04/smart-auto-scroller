const icon = document.createElement("img");
icon.id = "overlay-icon";
icon.src = browser.runtime.getURL("icon.png");

icon.addEventListener("click", () => {
    console.log("Overlay icon clicked — add actions later.");
});

document.body.appendChild(icon);
