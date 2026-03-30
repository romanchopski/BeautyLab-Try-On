const video = document.getElementById("video");
const divider = document.getElementById("divider");
const handle = document.getElementById("handle");

let isDragging = false;
let dividerX = window.innerWidth / 2;

async function startCamera() {
  try {
    const stream = await navigator.mediaDevices.getUserMedia({
      video: {
        facingMode: "user"
      },
      audio: false
    });

    video.muted = true;
    video.playsInline = true;
    video.setAttribute("playsinline", "");
    video.setAttribute("webkit-playsinline", "");

    video.srcObject = stream;

    video.onloadedmetadata = async () => {
      try {
        await video.play();
        console.log("Camera started");
      } catch (e) {
        console.warn("Video play warning:", e);
      }
    };
  } catch (error) {
    console.error("Camera access error:", error);
  }
}

function updateDivider(x) {
  const width = window.innerWidth;
  const clampedX = Math.max(0, Math.min(width, x));
  dividerX = clampedX;
  divider.style.left = `${clampedX}px`;
}

function startDrag(e) {
  isDragging = true;
  e.preventDefault();
}

function stopDrag() {
  isDragging = false;
}

function onPointerMove(e) {
  if (!isDragging) return;
  updateDivider(e.clientX);
}

divider.addEventListener("pointerdown", startDrag);

if (handle) {
  handle.addEventListener("pointerdown", startDrag);
}

document.addEventListener("pointermove", onPointerMove);
document.addEventListener("pointerup", stopDrag);
document.addEventListener("pointercancel", stopDrag);

window.addEventListener("resize", () => {
  updateDivider(Math.min(dividerX, window.innerWidth));
});

startCamera();
updateDivider(window.innerWidth / 2);