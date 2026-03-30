import {
  FaceLandmarker,
  FilesetResolver
} from "https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@0.10.14/vision_bundle.mjs";

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
    sWidth = videoH * destRatio;
    sx = (videoW - sWidth) / 2;
  } else {
    sHeight = videoW / destRatio;
    sy = (videoH - sHeight) / 2;
  }

  context.drawImage(
    sourceVideo,
    sx, sy, sWidth, sHeight,
    0, 0, destW, destH
  );
}

async function createFaceLandmarker() {
  const filesetResolver = await FilesetResolver.forVisionTasks(
    "https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@0.10.14/wasm"
  );

  faceLandmarker = await FaceLandmarker.createFromOptions(filesetResolver, {
    baseOptions: {
      modelAssetPath:
        "https://storage.googleapis.com/mediapipe-models/face_landmarker/face_landmarker/float16/1/face_landmarker.task"
    },
    runningMode: "VIDEO",
    numFaces: 1,
    outputFaceBlendshapes: false
  });

  console.log("FaceLandmarker ready");
}

async function startCamera() {
  const stream = await navigator.mediaDevices.getUserMedia({
    video: { facingMode: "user" },
    audio: false
  });

  video.muted = true;
  video.playsInline = true;
  video.setAttribute("playsinline", "");
  video.setAttribute("webkit-playsinline", "");
  video.srcObject = stream;

  await new Promise((resolve) => {
    video.onloadedmetadata = resolve;
  });

  await video.play();
  resizeCanvas();
  startRenderLoop();
  console.log("Camera started");
}

function updateFaceDetection() {
  if (!faceLandmarker) return;
  if (video.readyState < 2) return;
  if (video.currentTime === lastVideoTime) return;

  lastVideoTime = video.currentTime;
  lastFaceResult = faceLandmarker.detectForVideo(video, performance.now());
}

function getFaceRectOnCanvas(destW, destH) {
  if (!lastFaceResult?.faceLandmarks?.length) return null;

  const landmarks = lastFaceResult.faceLandmarks[0];

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

  // Отражаем по X, потому что базовое видео зеркальное
  const mirroredMinX = 1 - maxX;
  const mirroredMaxX = 1 - minX;

  const x = mirroredMinX * destW;
  const y = minY * destH;
  const width = (mirroredMaxX - mirroredMinX) * destW;
  const height = (maxY - minY) * destH;

  const padX = width * 0.18;
  const padY = height * 0.22;

  return {
    x: x - padX,
    y: y - padY,
    width: width + padX * 2,
    height: height + padY * 2
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

  // Правая часть after
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

    // Зеркалим внутри canvas, чтобы совпадало с видео
    ctx.save();
    ctx.translate(w, 0);
    ctx.scale(-1, 1);
    drawVideoCover(ctx, video, w, h);
    ctx.restore();

    ctx.restore();
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
handle?.addEventListener("pointerdown", startDrag);

document.addEventListener("pointermove", onPointerMove);
document.addEventListener("pointerup", stopDrag);
document.addEventListener("pointercancel", stopDrag);

window.addEventListener("resize", resizeCanvas);
if (window.visualViewport) {
  window.visualViewport.addEventListener("resize", resizeCanvas);
  window.visualViewport.addEventListener("scroll", resizeCanvas);
}

setTimeout(() => {
  hint?.classList.add("hidden");
}, 2500);

async function init() {
  try {
    await createFaceLandmarker();
    await startCamera();
    updateDivider(window.innerWidth / 2);
  } catch (error) {
    console.error("Init error:", error);
    alert("Failed to initialize camera or face tracking. Open console for details.");
  }
}

init();