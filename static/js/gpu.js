// Partial GPU buffer uploads. Re-uploading a multi-million-vertex colour buffer (60 MB for 5 M
// neurons) to change one hovered neuron is wasteful, so single-vertex changes upload only their
// own range. A "full" mark wins over ranges until the next rendered frame.
let fullMarked = new WeakSet();

export function markFull(attr) {
  attr.clearUpdateRanges();
  attr.needsUpdate = true;
  fullMarked.add(attr);
}

export function markRange(attr, start, count) {
  if (fullMarked.has(attr)) return;
  attr.addUpdateRange(start, count);
  attr.needsUpdate = true;
}

// called by the render loop after a frame has been drawn (buffers are uploaded by then)
export function endFrame() {
  fullMarked = new WeakSet();
}
