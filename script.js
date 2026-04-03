import {
  FaceLandmarker,
  FilesetResolver
} from "https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@0.10.14/vision_bundle.mjs";

const video = document.getElementById("video");
const canvas = document.getElementById("effectCanvas");
const ctx = canvas.getContext("2d", { alpha: true });

const divider = document.getElementById("divider");
const handle = document.getElementById("handle");
const hint = document.getElementById("hint");

const sourceCanvas = document.createElement("canvas");
const sourceCtx = sourceCanvas.getContext("2d", { alpha: true });

const effectCanvasOffscreen = document.createElement("canvas");
const effectCtx = effectCanvasOffscreen.getContext("2d", { alpha: true });

const maskCanvas = document.createElement("canvas");
const maskCtx = maskCanvas.getContext("2d", { alpha: true });

const rawMaskCanvas = document.createElement("canvas");
const rawMaskCtx = rawMaskCanvas.getContext("2d", { alpha: true });

const glowCanvas = document.createElement("canvas");
const glowCtx = glowCanvas.getContext("2d", { alpha: true });

let isDragging = false;
let dividerX = window.innerWidth / 2;
let animationFrameId = null;

let faceLandmarker = null;
let lastFaceResult = null;
let lastVideoTime = -1;
let smoothedLandmarks = null;

const FACE_OVAL = [
  10, 338, 297, 332, 284, 251, 389, 356, 454, 323, 361, 288,
  397, 365, 379, 378, 400, 377, 152, 148, 176, 149, 150, 136,
  172, 58, 132, 93, 234, 127, 162, 21, 54, 103, 67, 109
];

const LEFT_EYE = [362, 382, 381, 380, 374, 373, 390, 249, 263, 466, 388, 387, 386, 385, 384, 398];
const RIGHT_EYE = [33, 7, 163, 144, 145, 153, 154, 155, 133, 173, 157, 158, 159, 160, 161, 246];
const OUTER_LIPS = [61, 146, 91, 181, 84, 17, 314, 405, 321, 375, 291, 308, 324, 318, 402, 317, 14, 87, 178, 88, 95, 185, 40, 39, 37, 0, 267, 269, 270, 409, 415, 310, 311, 312, 13, 82, 81, 42, 183, 78];

const EFFECT = {
  featherBlurPx: 15,
  landmarkSmoothing: 0.72,
  skinBlurPx: 2.1,
  smoothMix: 0.28,
  toneMix: 0.13,
  highlightMix: 0.08,
  warmMix: 0.08,
  glowMix: 0.12,
  maskExpand: 1.06,
  eyeExpand: 1.22,
  lipExpand: 1.1
};

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

function setCanvasSize(targetCanvas, width, height) {
  targetCanvas.width = width;
  targetCanvas.height = height;
}

function resizeCanvas() {
  const { width, height } = getViewportSize();
  const dpr = window.devicePixelRatio || 1;

  canvas.width = Math.round(width * dpr);
  canvas.height = Math.round(height * dpr);
  canvas.style.width = `${width}px`;
  canvas.style.height = `${height}px`;

  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);

  setCanvasSize(sourceCanvas, width, height);
  setCanvasSize(effectCanvasOffscreen, width, height);
  setCanvasSize(maskCanvas, width, height);
  setCanvasSize(rawMaskCanvas, width, height);
  setCanvasSize(glowCanvas, width, height);

  updateDivider(dividerX);
}

function updateDivider(x) {
  const { width } = getViewportSize();
  const clampedX = Math.max(0, Math.min(width, x));
  dividerX = clampedX;
  divider.style.left = `${clampedX}px`;
}

function getCoverCrop(videoW, videoH, destW, destH) {
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

  return { sx, sy, sWidth, sHeight };
}

function drawVideoCover(context, sourceVideo, destW, destH) {
  const videoW = sourceVideo.videoWidth;
  const videoH = sourceVideo.videoHeight;
  if (!videoW || !videoH) return;

  const { sx, sy, sWidth, sHeight } = getCoverCrop(videoW, videoH, destW, destH);

  context.drawImage(
    sourceVideo,
    sx, sy, sWidth, sHeight,
    0, 0, destW, destH
  );
}

function drawMirroredVideo(context, destW, destH) {
  context.save();
  context.translate(destW, 0);
  context.scale(-1, 1);
  drawVideoCover(context, video, destW, destH);
  context.restore();
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
}

async function startCamera() {
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

  await new Promise((resolve) => {
    video.onloadedmetadata = resolve;
  });

  await video.play();
  resizeCanvas();
  startRenderLoop();
}

function updateFaceDetection() {
  if (!faceLandmarker) return;
  if (video.readyState < 2) return;
  if (video.currentTime === lastVideoTime) return;

  lastVideoTime = video.currentTime;
  lastFaceResult = faceLandmarker.detectForVideo(video, performance.now());

  const landmarks = lastFaceResult?.faceLandmarks?.[0];
  if (!landmarks?.length) {
    smoothedLandmarks = null;
    return;
  }

  if (!smoothedLandmarks || smoothedLandmarks.length !== landmarks.length) {
    smoothedLandmarks = landmarks.map((p) => ({
      x: p.x,
      y: p.y,
      z: p.z ?? 0
    }));
    return;
  }

  const a = EFFECT.landmarkSmoothing;
  const b = 1 - a;

  for (let i = 0; i < landmarks.length; i++) {
    smoothedLandmarks[i].x = smoothedLandmarks[i].x * a + landmarks[i].x * b;
    smoothedLandmarks[i].y = smoothedLandmarks[i].y * a + landmarks[i].y * b;
    smoothedLandmarks[i].z = (smoothedLandmarks[i].z ?? 0) * a + (landmarks[i].z ?? 0) * b;
  }
}

function landmarkToCanvasPoint(landmark, destW, destH) {
  const videoW = video.videoWidth;
  const videoH = video.videoHeight;
  if (!videoW || !videoH) return { x: 0, y: 0 };

  const { sx, sy, sWidth, sHeight } = getCoverCrop(videoW, videoH, destW, destH);

  const px = landmark.x * videoW;
  const py = landmark.y * videoH;

  const unmirroredX = ((px - sx) / sWidth) * destW;
  const y = ((py - sy) / sHeight) * destH;

  return {
    x: destW - unmirroredX,
    y
  };
}

function getPolygon(indices, width, height) {
  if (!smoothedLandmarks?.length) return [];
  return indices.map((index) => landmarkToCanvasPoint(smoothedLandmarks[index], width, height));
}

function getPolygonCenter(points) {
  if (!points.length) return { x: 0, y: 0 };

  let x = 0;
  let y = 0;
  for (const p of points) {
    x += p.x;
    y += p.y;
  }

  return {
    x: x / points.length,
    y: y / points.length
  };
}

function expandPolygon(points, scale = 1) {
  if (!points.length || scale === 1) return points;

  const center = getPolygonCenter(points);
  return points.map((p) => ({
    x: center.x + (p.x - center.x) * scale,
    y: center.y + (p.y - center.y) * scale
  }));
}

function drawPolygonPath(context, points) {
  if (!points.length) return;

  context.beginPath();
  context.moveTo(points[0].x, points[0].y);
  for (let i = 1; i < points.length; i++) {
    context.lineTo(points[i].x, points[i].y);
  }
  context.closePath();
}

function buildSkinMask(width, height) {
  rawMaskCtx.clearRect(0, 0, width, height);

  const faceOval = expandPolygon(getPolygon(FACE_OVAL, width, height), EFFECT.maskExpand);
  const leftEye = expandPolygon(getPolygon(LEFT_EYE, width, height), EFFECT.eyeExpand);
  const rightEye = expandPolygon(getPolygon(RIGHT_EYE, width, height), EFFECT.eyeExpand);
  const lips = expandPolygon(getPolygon(OUTER_LIPS, width, height), EFFECT.lipExpand);

  if (!faceOval.length) {
    maskCtx.clearRect(0, 0, width, height);
    return false;
  }

  rawMaskCtx.fillStyle = "white";
  drawPolygonPath(rawMaskCtx, faceOval);
  rawMaskCtx.fill();

  rawMaskCtx.globalCompositeOperation = "destination-out";

  drawPolygonPath(rawMaskCtx, leftEye);
  rawMaskCtx.fill();

  drawPolygonPath(rawMaskCtx, rightEye);
  rawMaskCtx.fill();

  drawPolygonPath(rawMaskCtx, lips);
  rawMaskCtx.fill();

  rawMaskCtx.globalCompositeOperation = "source-over";

  maskCtx.clearRect(0, 0, width, height);
  maskCtx.save();
  maskCtx.filter = `blur(${EFFECT.featherBlurPx}px)`;
  maskCtx.drawImage(rawMaskCanvas, 0, 0, width, height);
  maskCtx.restore();

  return true;
}

function buildGlowLayer(width, height) {
  glowCtx.clearRect(0, 0, width, height);

  const faceOval = expandPolygon(getPolygon(FACE_OVAL, width, height), 0.96);
  if (!faceOval.length) return;

  const center = getPolygonCenter(faceOval);

  glowCtx.save();
  drawPolygonPath(glowCtx, faceOval);
  glowCtx.clip();

  const gradient = glowCtx.createRadialGradient(
    center.x,
    center.y - height * 0.05,
    Math.max(20, width * 0.03),
    center.x,
    center.y,
    Math.max(width, height) * 0.24
  );

  gradient.addColorStop(0, "rgba(255, 244, 232, 0.30)");
  gradient.addColorStop(0.38, "rgba(255, 240, 224, 0.14)");
  gradient.addColorStop(1, "rgba(255, 240, 224, 0)");

  glowCtx.fillStyle = gradient;
  glowCtx.fillRect(0, 0, width, height);
  glowCtx.restore();

  glowCtx.save();
  glowCtx.globalCompositeOperation = "destination-in";
  glowCtx.drawImage(maskCanvas, 0, 0, width, height);
  glowCtx.restore();
}

function buildBeautyFrame(width, height) {
  sourceCtx.clearRect(0, 0, width, height);
  drawMirroredVideo(sourceCtx, width, height);

  effectCtx.clearRect(0, 0, width, height);
  effectCtx.drawImage(sourceCanvas, 0, 0, width, height);

  effectCtx.save();
  effectCtx.globalAlpha = EFFECT.smoothMix;
  effectCtx.filter = `blur(${EFFECT.skinBlurPx}px) saturate(1.015) contrast(1.015)`;
  effectCtx.drawImage(sourceCanvas, 0, 0, width, height);
  effectCtx.restore();

  effectCtx.save();
  effectCtx.globalAlpha = EFFECT.toneMix;
  effectCtx.filter = "brightness(1.028) contrast(0.992) saturate(1.02)";
  effectCtx.drawImage(sourceCanvas, 0, 0, width, height);
  effectCtx.restore();

  effectCtx.save();
  effectCtx.globalAlpha = EFFECT.highlightMix;
  effectCtx.filter = "brightness(1.05)";
  effectCtx.drawImage(sourceCanvas, 0, 0, width, height);
  effectCtx.restore();

  effectCtx.save();
  effectCtx.globalAlpha = EFFECT.warmMix;
  effectCtx.fillStyle = "rgba(255, 234, 214, 0.55)";
  effectCtx.fillRect(0, 0, width, height);
  effectCtx.restore();

  buildGlowLayer(width, height);

  effectCtx.save();
  effectCtx.globalAlpha = EFFECT.glowMix;
  effectCtx.drawImage(glowCanvas, 0, 0, width, height);
  effectCtx.restore();

  effectCtx.save();
  effectCtx.globalCompositeOperation = "destination-in";
  effectCtx.drawImage(maskCanvas, 0, 0, width, height);
  effectCtx.restore();
}

function renderEffect() {
  if (video.readyState < 2) {
    animationFrameId = requestAnimationFrame(renderEffect);
    return;
  }

  const { width, height } = getViewportSize();
  updateFaceDetection();

  ctx.clearRect(0, 0, width, height);

  if (smoothedLandmarks?.length) {
    const hasMask = buildSkinMask(width, height);

    if (hasMask) {
      buildBeautyFrame(width, height);

      ctx.save();
      ctx.beginPath();
      ctx.rect(dividerX, 0, width - dividerX, height);
      ctx.clip();
      ctx.drawImage(effectCanvasOffscreen, 0, 0, width, height);
      ctx.restore();
    }
  }

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
handle.addEventListener("pointerdown", startDrag);

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
    updateDivider(getViewportSize().width / 2);
  } catch (error) {
    console.error("Init error:", error);
    alert("Failed to initialize camera or face tracking. Open console for details.");
  }
}

init();