function framePng(video) {
  const canvas = document.createElement("canvas");
  canvas.width = video.videoWidth;
  canvas.height = video.videoHeight;
  canvas.getContext("2d").drawImage(video, 0, 0);
  return new Promise((resolve, reject) => {
    canvas.toBlob((blob) => {
      if (blob) resolve(blob);
      else reject(new Error("Could not encode video frame"));
    }, "image/png");
  });
}

export async function captureVideoFrame(video, time, signal) {
  try {
    return await framePng(video);
  } catch (error) {
    if (error.name !== "SecurityError" || !video.currentSrc) throw error;
  }

  // Some previews use a signed URL on a linked environment. Retry with CORS on a
  // detached player so we can seek with range requests and leave the preview intact.
  const copy = document.createElement("video");
  const loading = AbortSignal.any([signal, AbortSignal.timeout(8000)]);
  copy.crossOrigin = "anonymous";
  copy.preload = "auto";
  try {
    loading.throwIfAborted();
    await new Promise((resolve, reject) => {
      const options = { signal: loading };
      loading.addEventListener("abort", () => reject(loading.reason), { ...options, once: true });
      copy.addEventListener("error", () => reject(new Error("Video could not be loaded for capture")), options);
      copy.addEventListener("loadedmetadata", () => {
        // Seeking to the exact duration may leave some decoders without a frame.
        copy.currentTime = Number.isFinite(copy.duration)
          ? Math.min(time, Math.max(0, copy.duration - 0.001))
          : time;
      }, options);
      function ready() {
        if (!copy.seeking && copy.readyState >= HTMLMediaElement.HAVE_CURRENT_DATA) resolve();
      }
      copy.addEventListener("loadeddata", ready, options);
      copy.addEventListener("seeked", ready, options);
      copy.src = video.currentSrc;
    });
    loading.throwIfAborted();
    return await framePng(copy);
  } finally {
    copy.removeAttribute("src");
    copy.load();
  }
}
