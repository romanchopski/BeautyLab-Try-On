const video = document.getElementById("video");
const canvas = document.getElementById("effectCanvas");
const ctx = canvas.getContext("2d");

const divider = document.getElementById("divider");
const handle = document.getElementById("handle");
const hint = document.getElementById("hint");

let isDragging = false;
let dividerX = window.innerWidth / 2;
let animationFrameId = null;

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
        resizeCanvas();
        startRenderLoop();
        console.log("Camera started");
      } catch (e) {
        console.warn("Video play warning:", e);
      }
    };
  } catch (error) {
    console.error("Camera access error:", error);
  }
}

function resizeCanvas() {
  const dpr = window.devicePixelRatio || 1;
  canvas.width = Math.round(window.innerWidth * dpr);
  canvas.height = Math.round(window.innerHeight * dpr);
  canvas.style.width = `${window.innerWidth}px`;
  canvas.style.height = `${window.innerHeight}px`;

  // Работаем в CSS-пикселях
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  updateDivider(dividerX);
}

function updateDivider(x) {
  const width = window.innerWidth;
  const clampedX = Math.max(0, Math.min(width, x));
  dividerX = clampedX;
  divider.style.left = `${clampedX}px`;
}

function renderEffect() {
  if (video.readyState < 2) {
    animationFrameId = requestAnimationFrame(renderEffect);
    return;
  }

  const w = window.innerWidth;
  const h = window.innerHeight;

  ctx.clearRect(0, 0, w, h);

  // Рисуем after только справа от линии
  ctx.save();
  ctx.beginPath();
  ctx.rect(dividerX, 0, w - dividerX, h);
  ctx.clip();

  // Мягкий демонстрационный эффект
  ctx.filter = "blur(2px) brightness(1.05) contrast(1.06) saturate(1.06)";

  // Зеркалим картинку ВНУТРИ canvas, чтобы совпала с зеркальным video
  ctx.save();
  ctx.translate(w, 0);
  ctx.scale(-1, 1);
  ctx.drawImage(video, 0, 0, w, h);
  ctx.restore();

  ctx.restore();

  animationFrameId = requestAnimationFrame(renderEffect);
}

function startRenderLoop() {
  if (animationFrameId) {
    cancelAnimationFrame(animationFrameId);
  }
  renderEffect();
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

window.addEventListener("resize", resizeCanvas);

setTimeout(() => {
  if (hint) {
    hint.classList.add("hidden");
  }
}, 2500);

startCamera();
updateDivider(window.innerWidth / 2);