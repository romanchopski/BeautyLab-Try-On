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

function getViewportSize() {
  if (window.visualViewport) {
    return {
      width: Math.round(window.visualViewport.width),
      height: Math.round(window.visualViewport.height)
    };
  }

  return {
    width: window.innerWidth,
    height: window.innerHeight
  };
}

function resizeCanvas() {
  const { width, height } = getViewportSize();
  const dpr = window.devicePixelRatio || 1;

  canvas.width = Math.round(width * dpr);
  canvas.height = Math.round(height * dpr);
  canvas.style.width = `${width}px`;
  canvas.style.height = `${height}px`;

  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);

  updateDivider(dividerX);
}

function updateDivider(x) {
  const { width } = getViewportSize();
  const clampedX = Math.max(0, Math.min(width, x));
  dividerX = clampedX;
  divider.style.left = `${clampedX}px`;
}

/**
 * Рисует video в canvas так же, как object-fit: cover
 */
function drawVideoCover(context, sourceVideo, destW, destH) {
  const videoW = sourceVideo.videoWidth;
  const videoH = sourceVideo.videoHeight;

  if (!videoW || !videoH) return;

  const videoRatio = videoW / videoH;
  const destRatio = destW / destH;

  let sx = 0;
  let sy = 0;
  let sWidth = videoW;
  let sHeight = videoH;

  if (videoRatio > destRatio) {
    // Видео шире контейнера: режем по бокам
    sWidth = videoH * destRatio;
    sx = (videoW - sWidth) / 2;
  } else {
    // Видео выше контейнера: режем сверху/снизу
    sHeight = videoW / destRatio;
    sy = (videoH - sHeight) / 2;
  }

  context.drawImage(
    sourceVideo,
    sx,
    sy,
    sWidth,
    sHeight,
    0,
    0,
    destW,
    destH
  );
}

function renderEffect() {
  if (video.readyState < 2) {
    animationFrameId = requestAnimationFrame(renderEffect);
    return;
  }

  const { width: w, height: h } = getViewportSize();

  ctx.clearRect(0, 0, w, h);

  // Рисуем after только справа от линии
  ctx.save();
  ctx.beginPath();
  ctx.rect(dividerX, 0, w - dividerX, h);
  ctx.clip();

  // Эффект
  ctx.filter = "blur(2px) brightness(1.05) contrast(1.06) saturate(1.06)";

  // Зеркалим внутри canvas, чтобы совпадало с зеркальным video
  ctx.save();
  ctx.translate(w, 0);
  ctx.scale(-1, 1);

  drawVideoCover(ctx, video, w, h);

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

if (window.visualViewport) {
  window.visualViewport.addEventListener("resize", resizeCanvas);
  window.visualViewport.addEventListener("scroll", resizeCanvas);
}

setTimeout(() => {
  if (hint) {
    hint.classList.add("hidden");
  }
}, 2500);

startCamera();
updateDivider(window.innerWidth / 2);