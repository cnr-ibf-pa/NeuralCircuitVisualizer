// User uploads: network files (CSV/HDF5) and SONATA circuits, sent in chunks to the backend.
import { state } from "./state.js";
import { baseURL, UPLOAD_CHUNK_SIZE } from "./config.js";
import { $, dropdown, networkFileInput, hdfFileInput, sonataFileInput, startButton, stopButton, recStartBtn, connectionPanel } from "./dom.js";
import { showLoader, hideLoader, setMessage, setProgress, setTransfer, setSpikePanels, populateChunkDropdown, fetchJson, startPhase, nextFrame } from "./ui.js";
import { clearScene, VisualizateNeurons } from "./neurons.js";
import { resetSpikeState, resetTimeUI, resetPlaybackConfig } from "./playback.js";
import { resetCamera, centerCameraToObject } from "./camera.js";
import { resetAndDisableAllCheckboxes } from "./selection.js";
import { populateConnectionDropdown } from "./connections.js";

// id shared by every file of one upload, so the server merges slices and replaces older uploads
const newBatchId = () => `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;

const fileExt = (file) => file.name.split(".").pop().toLowerCase();

// Upload `files` in UPLOAD_CHUNK_SIZE slices.
//   endpoint   - POST url
//   extra      - (formData, file) => void, adds endpoint-specific fields
//   sequential - upload one chunk at a time and throw on a non-OK reply
//   headers    - optional request headers
//   onProgress - (percent) => void
async function uploadChunks(files, { endpoint, extra, sequential = false, headers, onProgress }) {
  const total = files.reduce((n, f) => n + Math.ceil(f.size / UPLOAD_CHUNK_SIZE), 0);
  const totalBytes = files.reduce((n, f) => n + f.size, 0);
  let done = 0;
  let doneBytes = 0;
  const tick = (bytes) => {
    doneBytes += bytes;
    setTransfer(doneBytes, totalBytes); // MB, speed and ETA in the loader
    onProgress(Math.round((++done / total) * 100));
  };

  const pending = [];
  for (const file of files) {
    const totalChunks = Math.ceil(file.size / UPLOAD_CHUNK_SIZE);

    for (let start = 0, idx = 0; start < file.size; start += UPLOAD_CHUNK_SIZE, idx++) {
      const formData = new FormData();
      formData.append("file", file.slice(start, start + UPLOAD_CHUNK_SIZE), file.name);
      formData.append("chunkIndex", idx);
      formData.append("totalChunks", totalChunks);
      formData.append("uniqueDirectory", state.uniqueDirectory);
      extra(formData, file);

      const bytes = Math.min(UPLOAD_CHUNK_SIZE, file.size - start);
      const request = fetch(endpoint, { method: "POST", body: formData, headers });

      if (sequential) {
        const r = await request;
        if (!r.ok) throw new Error(`Upload error ${r.status}: ${await r.text()}`);
        tick(bytes);
      } else {
        pending.push(request.then(() => tick(bytes)));
      }
    }
  }
  await Promise.all(pending);
}

// copy the processed network files from the server reply into state
function applyNetworkFiles(files) {
  state.vertexColors = [];
  state.NetworkArray = [];

  files.forEach((file) => {
    state.NetworkArray.push(file.fileData);
    state.total_neurons += file.total_neurons;
    state.total_excitatory = file.total_excitatory;
    state.total_inhibitory = file.total_inhibitory;
    state.cell_type = file.cell_type;
  });
}

function showNetwork() {
  state.flag = true;
  VisualizateNeurons();
  resetCamera();
  centerCameraToObject(state.particles);
  recStartBtn.style.display = "block";
}

const resetBeforeLoad = () => {
  resetSpikeState();
  resetPlaybackConfig();
  resetTimeUI();
  clearScene();
  resetAndDisableAllCheckboxes();
};

// ----------------- network file (csv / hdf5) -----------------
function initNetworkUpload() {
  networkFileInput.addEventListener("change", async (event) => {
    const files = event.target.files;
    if (!files.length) return;
    const batchId = newBatchId(); // all files chosen together are slices of one circuit

    resetBeforeLoad();
    showLoader({ upload: true, build: true });
    setProgress("0%");
    setMessage("Uploading your file, please wait...");

    try {
      startPhase("Uploading");
      await uploadChunks(Array.from(files), {
        endpoint: `${baseURL}/api/upload_and_save_Network_file/`,
        extra: (fd, file) => {
          fd.append("fileType", fileExt(file));
          fd.append("batchId", batchId);
        },
        headers: { "X-Requested-With": "XMLHttpRequest" },
        onProgress: (p) => setProgress(`${p}%`),
      });

      setMessage("Processing your data for visualizing Circuit, please wait...");
      const data = await fetchJson(`${baseURL}/api/fetch_user_network_data/?dir=${state.uniqueDirectory}`, undefined, "circuit");

      setMessage("Data loaded successfully! Visualizing neurons...");
      startPhase("Building 3D scene");
      await nextFrame();

      if (data.files.length > 0) {
        setSpikePanels(true);
        applyNetworkFiles(data.files);

        if (parseInt(data.flag_check) === 1) {
          $("lblspikes").innerText = "# spikes :" + data.lstresponse.total_lines;
          state.total_activity_files = data.lstresponse.total_activity_files;
          state.firstLastKeys = data.lstresponse.first_last_keys;

          populateChunkDropdown(dropdown, data.lstresponse.chunk_mfr_list);
          state.circuitstatus = 3;
        } else {
          console.log("No activity data available.");
        }

        showNetwork();
      } else {
        console.log("No files found in the response.");
      }
    } catch (error) {
      console.error("Upload or processing error:", error);
      alert("An error occurred. Please try again.");
      setMessage("Upload failed. Please refresh and try again.");
    } finally {
      hideLoader();
      networkFileInput.value = "";
    }
  });
}

// ----------------- activity / hdf file input (also used by the "download" flow) -----------------
function initHdfUpload() {
  hdfFileInput.addEventListener("change", async (event) => {
    resetBeforeLoad();

    const files = event.target.files;
    if (files.length === 0) return;
    const batchId = newBatchId();

    try {
      setProgress("0%");
      showLoader({ upload: true, build: true });
      startPhase("Uploading");
      setMessage("Uploading your file, please wait...");

      await uploadChunks(Array.from(files), {
        endpoint: `${baseURL}/api/upload_and_save_Network_file/`,
        extra: (fd, file) => {
          fd.append("fileType", fileExt(file));
          fd.append("batchId", batchId);
        },
        headers: { "X-Requested-With": "XMLHttpRequest" },
        onProgress: (p) => setProgress(`${p}%`),
      });

      setMessage("Processing your data for visualizing Circuit, please wait...");
      const data = await fetchJson(`${baseURL}/api/fetch_user_network_data/?dir=${state.uniqueDirectory}`, undefined, "circuit");

      setMessage("Data loaded successfully! Visualizing neurons...");
      startPhase("Building 3D scene");
      await nextFrame();

      if (data.files.length > 0) {
        setSpikePanels(true);
        applyNetworkFiles(data.files);
        showNetwork();

        state.isDownloadTriggered = event.target.hasAttribute("data-download-triggered");
        if (state.isDownloadTriggered) {
          event.target.removeAttribute("data-download-triggered");
          populateConnectionDropdown();
          connectionPanel.style.visibility = "visible";
        }

        if (parseInt(data.flag_check) === 1) {
          $("lblspikes").innerText = "# spikes :" + data.lstresponse.total_lines;
          state.total_activity_files = data.lstresponse.total_activity_files;
          state.firstLastKeys = data.lstresponse.first_last_keys;

          const chunks = data.lstresponse.chunk_mfr_list;
          if (!chunks || chunks.length === 0) return;

          startButton.disabled = true;
          stopButton.disable = true; // (sic) original code - has no effect
          populateChunkDropdown(dropdown, chunks);
          state.circuitstatus = 3;
        } else {
          console.log("No activity data available.");
        }
      } else {
        console.log("No files found in the response.");
      }
    } catch (error) {
      console.error("Error:", error);
      alert("An error occurred. Please try again.");
    } finally {
      hideLoader();
      hdfFileInput.value = "";
    }
  });
}

// ----------------- SONATA (nodes h5 + spikes h5 [+ node-types csv]) -----------------
function initSonataUpload() {
  $("btnUploadSonata").addEventListener("click", () => sonataFileInput.click());

  sonataFileInput.addEventListener("change", async (event) => {
    resetBeforeLoad();

    const files = Array.from(event.target.files || []);
    if (!files.length) return;

    // filenames can be anything; the backend detects nodes/spikes from the HDF5 root keys
    const h5Files = files.filter((f) => /\.(h5|hdf5)$/i.test(f.name));
    const csvFiles = files.filter((f) => /\.csv$/i.test(f.name));

    if (h5Files.length < 2) {
      alert("Please select at least two HDF5 files (SONATA nodes + spikes). Filenames can be anything.");
      sonataFileInput.value = "";
      return;
    }

    try {
      showLoader({ upload: true, build: true });
      startPhase("Uploading");
      setProgress("0%");
      setMessage("Uploading SONATA files...");

      await uploadChunks([...h5Files, ...csvFiles], {
        endpoint: `${baseURL}/api/upload_and_save_sonata_anynames/`,
        extra: (fd, file) => {
          fd.append("originalName", file.name);
          fd.append("fileType", "sonata");
        },
        sequential: true,
        onProgress: (p) => setProgress(`${p}%`),
      });

      setMessage("Processing SONATA for visualization...");
      setProgress("0%");

      const data = await fetchJson(`${baseURL}/api/fetch_user_sonata_data/?dir=${state.uniqueDirectory}`, undefined, "SONATA circuit");

      setMessage(data.used_cell_types_csv ? "SONATA loaded! Cell types applied from CSV." : "SONATA loaded! No valid cell-type CSV detected — defaulting to excitatory (0).");

      if (data.files && data.files.length > 0) {
        startPhase("Building 3D scene");
        await nextFrame();
        setSpikePanels(true);

        state.total_neurons = 0;
        state.total_excitatory = 0;
        state.total_inhibitory = 0;
        applyNetworkFiles(data.files);

        // the mtype buffer must match the vertex count
        const nVerts = state.NetworkArray.reduce((sum, net) => sum + (net?.length || 0), 0);
        state.neuron_class = new Float32Array(nVerts);

        showNetwork();

        if (parseInt(data.flag_check) === 1) {
          $("lblspikes").innerText = "# spikes :" + data.lstresponse.total_lines;
          populateChunkDropdown(dropdown, data.lstresponse?.chunk_mfr_list || [], { emptyDefault: true });
          state.circuitstatus = 3;
        }
      }
    } catch (err) {
      console.error(err);
      alert("SONATA upload failed.");
    } finally {
      hideLoader();
      sonataFileInput.value = "";
    }
  });
}

export function initUploads() {
  initNetworkUpload();
  initHdfUpload();
  initSonataUpload();
}
