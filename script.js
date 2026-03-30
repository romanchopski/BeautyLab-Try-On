import vision from "https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@0.10.14";

const { FaceLandmarker, FilesetResolver } = vision;

const video = document.getElementById("video");
const canvas = document.getElementById("effectCanvas");
const ctx = canvas.getContext("2d");

const divider = document.getElementById("divider");
const handle = document.getElementById("handle");
const hint = document.getElementById("hint");

let isDragging = false;
let dividerX = window.innerWidth / 2;
let animationFrameId = null;

let faceLandmarker = null;
let lastFaceResult = null;
let lastVideoTime = -1;

async function createFaceLandmarker() {
  const filesetResolver = await FilesetResolver.forVisionTasks(
    "https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@0.10.14/wasm"
  );

  faceLandmarker = await FaceLandmarker.createFromOptions(filesetResolver, {
    baseOptions: {
      modelAssetPath:
        "https://storage.googleapis.com/mediapipe-models/face_landmarker/face_landmarker/float16/1/face_landmarker.task"
    },
    outputFaceBlendshapes: false,
    runningMode: "VIDEO",
    numFaces: 1
  });

  console.log("FaceLandmarker ready");
}

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
function getCoverDrawData(sourceVideo, destW, destH) {
  const videoW = sourceVideo.videoWidth;
  const videoH = sourceVideo.videoHeight;

  if (!videoW || !videoH) {
    return null;
  }

  const videoRatio = videoW / videoH;
  const destRatio = destW / destH;

  let sx = 0;
  let sy = 0;
  let sWidth = videoW;
  let sHeight = videoH;

  if (videoRatio > destRatio) {
    sWidth = videoH * destRatio;
    sx = (videoW - sWidth) / 2;
  } else {
    sHeight = videoW / destRatio;
    sy = (videoH - sHeight) / 2;
  }

  return {
    sx,
    sy,
    sWidth,
    sHeight,
    dx: 0,
    dy: 0,
    dWidth: destW,
    dHeight: destH
  };
}

function drawVideoCover(context, sourceVideo, destW, destH) {
  const drawData = getCoverDrawData(sourceVideo, destW, destH);
  if (!drawData) return;

  context.drawImage(
    sourceVideo,
    drawData.sx,
    drawData.sy,
    drawData.sWidth,
    drawData.sHeight,
    drawData.dx,
    drawData.dy,
    drawData.dWidth,
    drawData.dHeight
  );
}

function updateFaceDetection() {
  if (!faceLandmarker) return;
  if (video.readyState < 2) return;

  if (video.currentTime === lastVideoTime) return;
  lastVideoTime = video.currentTime;

  const nowMs = performance.now();
  lastFaceResult = faceLandmarker.detectForVideo(video, nowMs);
}

function getFaceRectOnCanvas(destW, destH) {
  if (!lastFaceResult?.faceLandmarks?.length) return null;

  const landmarks = lastFaceResult.faceLandmarks[0];
  const drawData = getCoverDrawData(video, destW, destH);
  if (!drawData) return null;

  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;

  for (const p of landmarks) {
    minX = Math.min(minX, p.x);
    minY = Math.min(minY, p.y);
    maxX = Math.max(maxX, p.x);
    maxY = Math.max(maxY, p.y);
  }

  // координаты внутри обрезанного видео-фрагмента
  const faceLeftInSource = minX * video.videoWidth;
  const faceTopInSource = minY * video.videoHeight;
  const faceRightInSource = maxX * video.videoWidth;
  const faceBottomInSource = maxY * video.videoHeight;

  // переводим в координаты обрезанного cover-фрагмента
  const x1 = ((faceLeftInSource - drawData.sx) / drawData.sWidth) * destW;
  const y1 = ((faceTopInSource - drawData.sy) / drawData.sHeight) * destH;
  const x2 = ((faceRightInSource - drawData.sx) / drawData.sWidth) * destW;
  const y2 = ((faceBottomInSource - drawData.sy) / drawData.sHeight) * destH;

  // т.к. базовое видео у нас зеркальное, отражаем прямоугольник по горизонтали
  const mirroredX1 = destW - x2;
  const mirroredX2 = destW - x1;

  const faceWidth = mirroredX2 - mirroredX1;
  const faceHeight = y2 - y1;

  // небольшой запас вокруг лица
  const padX = faceWidth * 0.18;
  const padY = faceHeight * 0.22;

  return {
    x: mirroredX1 - padX,
    y: y1 - padY,
    width: faceWidth + padX * 2,
    height: faceHeight + padY * 2
  };
}

function renderEffect() {
  if (video.readyState < 2) {
    animationFrameId = requestAnimationFrame(renderEffect);
    return;
  }

  const { width: w, height: h } = getViewportSize();

  updateFaceDetection();

  ctx.clearRect(0, 0, w, h);

  // after только справа от линии
  ctx.save();
  ctx.beginPath();
  ctx.rect(dividerX, 0, w - dividerX, h);
  ctx.clip();

  const faceRect = getFaceRectOnCanvas(w, h);

  if (faceRect) {
    ctx.save();
    ctx.beginPath();
    ctx.rect(faceRect.x, faceRect.y, faceRect.width, faceRect.height);
    ctx.clip();

    ctx.filter = "blur(2px) brightness(1.05) contrast(1.06) saturate(1.06)";
    drawVideoCover(ctx, video, w, h);

    ctx.restore();
  } else {
    // если лицо ещё не найдено — временно рисуем старый after на весь правый участок
    ctx.filter = "blur(2px) brightness(1.05) contrast(1.06) saturate(1.06)";
    drawVideoCover(ctx, video, w, h);
  }

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

async function init() {
  await createFaceLandmarker();
  await startCamera();
  updateDivider(window.innerWidth / 2);
}

init();