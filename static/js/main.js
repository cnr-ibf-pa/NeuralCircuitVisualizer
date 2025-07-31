import * as THREE from "three";
import { TrackballControls } from "three/addons/controls/TrackballControls.js";
import { GUI } from "three/addons/libs/lil-gui.module.min.js";

let firstLastKeys;
var chkpanle = false;
var total_neurons = 0;
let NetworkArray = [];
let ca3toca1connections = [];
let formStepsNum = 0;
let Networks = [];
var countactivities = 0;
var Activitys;
let total_activity_files;
let particleIndexes = [];
let activity_file_no = 0;
let activity_directory;
let camera, scene, renderer, material, controls;
let geometry;
let lasttime;
let timeRanges;
let customRanges;
let flag = false;
let ishuman = false;
let ishalf = false;
let flagact = false;
let count = 0.0;
let x = 0.0;
var isPaused = false;
let spikeNeuronSize = 60;
let interval;
let gIDs = [];
let gids_activity_indexes = {};
var neuron_class = [];
var lastKey;
var firstKey;
var counter_check = 0;
var selectedChunkNumber = -1;
var positions = [];
var sizes = [];
let totalParticles = 0; // Initialize counter
let xcord, ycord, zcord;
let total_excitatory;
let total_inhibitory;
let totalX = 0,
  totalY = 0,
  totalZ = 0;
const params = { Backgound: "#000000" };
const parameters = {
  Neuron_Size: 30,
  Firing_Neuron_Size: 100,
};
let pt = 2;
let colorsArray;
let vertexColors = [];
let particles;
// const scalingFactor = 0.1;
let r = 0;
let spikeTimes = new Map();

// Global playback config
const playbackConfig = {
  simTimestep: parseFloat(document.getElementById("simTimestepValue").value),
  stepDuration: parseInt(document.getElementById("stepDurationValue").value),
};
let mediaRecorder = null;
let recordingIntervalId = null;
let combinedCanvas = null;
let combinedCtx = null;
let recordedChunks = [];
const startBtn = document.getElementById("startRecordingBtn");
const stopBtn = document.getElementById("stopRecordingBtn");

let isConnection = false;
let container;
container = document.getElementById("container");
let previousTimeDisplay;
const progressbar = document.querySelector(".progressbar");
progressbar.style.visibility = "hidden";
const progress = document.getElementById("progress");
const timebar = document.getElementById("timebar");
timebar.max = lasttime;
const currentTimeDisplay = document.getElementById("current-time");
const totalTimeDisplay = document.getElementById("total-time");
const startTimeInput = document.getElementById("start-time");
const endTimeInput = document.getElementById("end-time");
let progressSteps;
const numberofneurosButton = document.getElementById("txtnumberofneuros");
const animationtime = document.getElementById("txtanimationtime");
const txtPersistenttime = document.getElementById("txtPersistenttime");
let selectedCheckboxByLayer = [];
let selectedCheckboxIds = [];
const baseURL = "";
const texturePath = "/static/img/disc.png";
const dropdown = document.getElementById("ddactivity_chunks");
const txttimefrom = document.getElementById("txttimefrom");
const txttimeto = document.getElementById("txttimeto");
const networkFileInput = document.getElementById("networkFileInput");
const hdfFileInput = document.getElementById("activityFileInput");

activitySelect.addEventListener("change", loadActivity);

document.getElementById("activitySelect").disabled = true;
document.getElementById("btnLoadConnection").disabled = true;

const btnLoadConnection = document.getElementById("btnLoadConnection");
btnLoadConnection.disabled = true;
btnLoadConnection.addEventListener("click", function () {
  // Initial UI setup
  document.getElementById("msgprogress").innerText = "Building Connection, please wait...\nCA3-PC to CA1-PC";
  document.getElementById("progress-percentage").style.display = "block";
  document.getElementById("progress-percentage").innerText = "Loading connections: 0%";
  document.getElementById("page-loader").style.display = "block";
  fetchConnections();
});

HumanactivitySelect.addEventListener("change", loadHumanActivity);

async function loadActivity() {
  const selectedValue = activitySelect.value;

  if (selectedValue === "1" || selectedValue === "2") {
    await LoadActivityData(selectedValue);
    startBtn.style.display = "block";
  }
}

async function LoadActivityData(file_id) {
  try {
    document.getElementById("page-loader").style.display = "block";
    document.getElementById("progress-percentage").innerText = "0%";
    document.getElementById("msgprogress").innerText = "Loading activity data...";

    const formData = new FormData();

    const ca3checkbox = document.getElementById("AllCA3RegSwitchCheck");
    const eccheckbox = document.getElementById("AllECRegSwitchCheck");
    const selectedActivity = activitySelect.options[activitySelect.selectedIndex].text;

    if (selectedActivity.includes("CA3") && !ca3checkbox.checked) {
      alert("You selected a CA3 activity file. Please enable the CA3 region in the network.");
      activitySelect.selectedIndex = 0;
      return;
    }

    if (selectedActivity.includes("EC") && !eccheckbox.checked) {
      alert("You selected an EC activity file. Please enable the EC region in the network.");
      activitySelect.selectedIndex = 0;
      return;
    }

    if (ca3checkbox.checked || eccheckbox.checked) {
      const gIDs = Array.from(geometry.attributes.gid.array);
      formData.append("gIDs", JSON.stringify(gIDs));
    } else {
      alert("Select spike region from network.");
      activitySelect.selectedIndex = 0;
      return;
    }

    const response = await fetch(`${baseURL}/api/LoadActivityData/?dir=${file_id}`, {
      method: "POST",
      body: formData,
    });

    if (response.ok) {
      const response_data = await response.json();

      // Process the received data
      Activitys = response_data.data;
      timeRanges = response_data.keys;
      const number_of_spikes = response_data.number_of_spikes;

      gids_activity_indexes = response_data.gids_activity_indexes;

      document.getElementById("lblspikes").innerText = "# spikes: " + number_of_spikes;

      //   const lasttime = parseFloat(timeRanges[timeRanges.length - 1]).toFixed(1);
      //   //   document.getElementById("lblLasttime").innerHTML =
      //   //     " / " + lasttime + "(ms)";

      //   totalTimeDisplay.textContent = lasttime;
      //   document.getElementById("timebar").max = lasttime;

      //   count = 0.0;
      // Extract and sort keys
      const sortedKeys = Object.keys(Activitys).sort((a, b) => parseFloat(a) - parseFloat(b));

      // Print the last key after sorting
      if (sortedKeys.length > 0) {
        lastKey = sortedKeys[sortedKeys.length - 1]; // Get the last key in the sorted array
        //   document.getElementById("lblLasttime").innerHTML =
        //     " / " + lastKey + " (ms)";
        lasttime = parseInt(lastKey);
        totalTimeDisplay.textContent = lasttime;
        document.getElementById("timebar").max = lasttime;
      }

      startButton.disabled = false;
    } else {
      const errorText = await response.text();
      console.error("Server Error:", errorText);
      throw new Error(errorText);
    }
  } catch (error) {
    console.error("Error fetching data:", error);
    alert("An error occurred while loading activity data. Please try again.");
  } finally {
    document.getElementById("page-loader").style.display = "none";
  }
}

// Function to load activity data based on selection human
async function loadHumanActivity() {
  const selectedValue = HumanactivitySelect.value;

  if (selectedValue === "1" || selectedValue === "2") {
    await LoadHumanActivityData(selectedValue);
    startBtn.style.display = "block";
  }
}

async function LoadHumanActivityData(file_id) {
  try {
    document.getElementById("page-loader").style.display = "block";
    document.getElementById("progress-percentage").innerText = "0%";
    document.getElementById("msgprogress").innerText = "Loading Human activity data...";
    document.getElementById("Neurons_firing_attributes").style.visibility = "visible";
    document.getElementById("networkspikes").style.visibility = "visible";

    const response = await fetch(`${baseURL}/api/LoadHumanActivityData/?dir=${file_id}`, {
      method: "POST",
    });

    if (response.ok) {
      const response_data = await response.json();

      // Process the received data
      Activitys = response_data.data;
      timeRanges = response_data.keys;
      const number_of_spikes = response_data.number_of_spikes;

      gids_activity_indexes = response_data.gids_activity_indexes;

      document.getElementById("lblspikes").innerText = "# spikes: " + number_of_spikes;

      //   lasttime = parseFloat(timeRanges[timeRanges.length - 1]).toFixed(1);

      //   totalTimeDisplay.textContent = lasttime;
      //   document.getElementById("timebar").max = lasttime;

      // Extract and sort keys
      const sortedKeys = Object.keys(Activitys).sort((a, b) => parseFloat(a) - parseFloat(b));

      // Print the last key after sorting
      if (sortedKeys.length > 0) {
        lastKey = sortedKeys[sortedKeys.length - 1]; // Get the last key in the sorted array
        //   document.getElementById("lblLasttime").innerHTML =
        //     " / " + lastKey + " (ms)";
        lasttime = parseInt(lastKey);
        totalTimeDisplay.textContent = lasttime;
        document.getElementById("timebar").max = lasttime;
        // spikeNeuronSize = 300;
      }

      startButton.disabled = false;
    } else {
      const errorText = await response.text();
      console.error("Server Error:", errorText);
      throw new Error(errorText);
    }
  } catch (error) {
    console.error("Error fetching data:", error);
    alert("An error occurred while loading activity data. Please try again.");
  } finally {
    document.getElementById("page-loader").style.display = "none";
  }
}

async function LoadHipForm() {
  try {
    document.getElementById("HumanactivitySelect").selectedIndex = 0;

    document.getElementById("HumanactivitySelect").disabled = true;
    clearScene();
    resetSpikeState();
    resetPlaybackConfig();
    resetTimeUI();
    flag = false;
    // Fetch the data from the server
    const response = await fetch(`${baseURL}/api/LoadAllLayers/`);
    const data = await response.json();

    const files = data.files;

    const totalFiles = files.length;

    // Function to process each file
    const processFile = async (file, index) => {
      document.getElementById("msgprogress").innerText = `Please wait a moment while we process data for visualization. Your patience is appreciated. \n` + file.filename;

      // Calculate and display progress
      const percentage = Math.round(((index + 1) / totalFiles) * 100);
      document.getElementById("progress-percentage").innerText = `${percentage}%`;

      // Simulate network delay or file processing
      await new Promise((resolve) => setTimeout(resolve, 100)); // Adjust timeout as needed

      const fileData = file.fileData;
      NetworkArray.push(fileData);
      total_neurons += file.total_neurons;

      //ca3toca1connections = data.connections;
      //console.log(ca3toca1connections);
    };

    // Process each file sequentially
    for (let i = 0; i < totalFiles; i++) {
      await processFile(files[i], i);
    }

    document.getElementById("page-loader").style.display = "none";
    btnLoadConnection.disabled = false;

    document.getElementById("activitySelect").disabled = false;
  } catch (error) {
    console.error("Error fetching data:", error);
    document.getElementById("page-loader").style.display = "none";
  }
}

window.addEventListener("load", function () {
  const btnLoadHumanNetwork_full = document.getElementById("btnLoadHumanNetwork_full");
  btnLoadHumanNetwork_full.addEventListener("click", function () {
    document.getElementById("msgprogress").innerText = `Loading full circuit, please wait...`;
    document.getElementById("progress-percentage").style.display = "none";
    document.getElementById("page-loader").style.display = "block";
    LoadHumanHipForm("full"); // Pass "full"
    dropdown.innerHTML = "";
  });

  const btnLoadHumanNetwork_half = document.getElementById("btnLoadHumanNetwork_half");
  btnLoadHumanNetwork_half.addEventListener("click", function () {
    document.getElementById("msgprogress").innerText = `Loading half circuit, please wait...`;
    document.getElementById("progress-percentage").style.display = "none";
    document.getElementById("page-loader").style.display = "block";
    LoadHumanHipForm("half"); // Pass "half"
    ishalf = true;
    dropdown.innerHTML = "";
  });
});

async function LoadHumanHipForm(mode = "full") {
  try {
    document.getElementById("activitySelect").selectedIndex = 0;
    document.getElementById("HumanactivitySelect").selectedIndex = 0;
    document.getElementById("HumanactivitySelect").disabled = false;

    btnLoadConnection.disabled = true;
    document.getElementById("activitySelect").disabled = true;

    resetSpikeState();
    resetPlaybackConfig();
    resetTimeUI();
    clearScene();

    const response = await fetch(`${baseURL}/api/LoadHumanHipForm/?mode=${mode}`);
    const data = await response.json();

    const fileData = data.fileData;
    NetworkArray.push(fileData);
    total_neurons = data.total_neurons;

    document.getElementById("page-loader").style.display = "none";
    resetAndDisableAllCheckboxes();
    flag = true;

    ishuman = true;
    VisualizateNeurons();
    resetCamera();
    centerCameraToObject(particles);

    document.getElementById("HumanactivitySelect").disabled = false;
  } catch (error) {
    console.error("Error fetching data:", error);
    document.getElementById("page-loader").style.display = "none";
  }
}

async function fetchConnections() {
  let page = 1;
  let hasMore = true;
  let totalKeys = 1; // fallback to avoid division by zero
  let loadedKeys = 0;

  try {
    while (hasMore) {
      const response = await fetch(`${baseURL}/api/fetchConnections/?page=${page}&chunk_size=10000`);
      const jsonData = await response.json();

      if (jsonData && jsonData.connections_chunk) {
        Object.assign(ca3toca1connections, jsonData.connections_chunk);

        // On first page, get totalKeys
        if (page === 1) {
          totalKeys = jsonData.total_keys || 1;
        }

        loadedKeys += Object.keys(jsonData.connections_chunk).length;

        // Calculate precise % based on keys loaded
        const percentage = Math.min(Math.round((loadedKeys / totalKeys) * 100), 100);
        document.getElementById("progress-percentage").innerText = `${percentage}%`;

        hasMore = jsonData.has_more;
        page++;
      } else {
        hasMore = false;
      }
    }

    // Final 100% after full load
    document.getElementById("progress-percentage").innerText = `100%`;
    await new Promise((resolve) => setTimeout(resolve, 500));
    document.getElementById("page-loader").style.display = "none";

    isConnection = true;
  } catch (error) {
    console.error("Error fetching data:", error);
    document.getElementById("page-loader").style.display = "none";
    document.getElementById("progress-percentage").innerText = `Error loading connections`;
  }
}

const uniqueDirectory = getTimestampDirectory(); // generate once per session

networkFileInput.addEventListener("change", async (event) => {
  const files = event.target.files;
  if (!files.length) return;

  const chunkSize = 10 * 1024 * 1024; // 10 MB
  const uploadPromises = [];

  resetSpikeState();
  resetPlaybackConfig();
  resetTimeUI();
  clearScene();

  resetAndDisableAllCheckboxes();

  const progressBar = document.getElementById("progress-percentage");
  const loader = document.getElementById("page-loader");
  const msg = document.getElementById("msgprogress");

  loader.style.display = "block";
  progressBar.innerText = "0%";
  msg.innerText = "Uploading your file, please wait...";

  let overallChunks = 0;
  let overallUploaded = 0;

  // Count total number of chunks across all files
  for (const file of files) {
    overallChunks += Math.ceil(file.size / chunkSize);
  }

  try {
    for (const file of files) {
      const fileType = file.name.split(".").pop().toLowerCase();
      const totalChunks = Math.ceil(file.size / chunkSize);

      for (let start = 0; start < file.size; start += chunkSize) {
        const chunk = file.slice(start, start + chunkSize);
        const formData = new FormData();
        formData.append("file", chunk, file.name);
        formData.append("chunkIndex", Math.floor(start / chunkSize));
        formData.append("totalChunks", totalChunks);
        formData.append("uniqueDirectory", uniqueDirectory);
        formData.append("fileType", fileType);

        const uploadPromise = fetch(`${baseURL}/api/upload_and_save_Network_file/`, {
          method: "POST",
          body: formData,
          headers: { "X-Requested-With": "XMLHttpRequest" },
        }).then(() => {
          overallUploaded++;
          const progress = Math.round((overallUploaded / overallChunks) * 100);
          progressBar.innerText = `${progress}%`;
        });

        uploadPromises.push(uploadPromise);
      }
    }

    await Promise.all(uploadPromises);

    // After uploads complete, reset progress for fetch phase
    progressBar.innerText = "0%";
    msg.innerText = "Processing your data for visualizing Circuit, please wait...";

    let fetchProgress = 0;
    const percentInterval = setInterval(() => {
      if (fetchProgress < 99) {
        fetchProgress += 1;
        progressBar.innerText = `${fetchProgress}%`;
      }
    }, 100); // progress every 100ms = ~10s

    const response = await fetch(`${baseURL}/api/fetch_user_network_data/?dir=${uniqueDirectory}`);

    if (!response.ok) {
      throw new Error("Failed to fetch processed data.");
    }

    const data = await response.json();
    clearInterval(percentInterval);
    progressBar.innerText = "100%";
    msg.innerText = "Data loaded successfully! Visualizing neurons...";

    if (data.files.length > 0) {
      vertexColors = [];
      NetworkArray = [];
      document.getElementById("Neurons_firing_attributes").style.visibility = "visible";
      document.getElementById("networkspikes").style.visibility = "visible";

      data.files.forEach((file) => {
        NetworkArray.push(file.fileData);
        total_neurons += file.total_neurons;
      });

      if (parseInt(data.flag_check) === 1) {
        document.getElementById("lblspikes").innerText = "# spikes :" + data.lstresponse.total_lines;

        total_activity_files = data.lstresponse.total_activity_files;
        firstLastKeys = data.lstresponse.first_last_keys;

        // const dropdown = document.getElementById("ddactivity_chunks");
        dropdown.innerHTML = "";

        const defaultOption = document.createElement("option");
        defaultOption.textContent = "Activity windows";
        dropdown.appendChild(defaultOption);

        data.lstresponse.chunk_mfr_list.forEach((chunk) => {
          const option = document.createElement("option");
          option.value = chunk.chunk_number;

          const chunkNum = String(chunk.chunk_number);
          const timeRange = `[${chunk.first_key} - ${chunk.last_key}]ms`;
          const mfr = `MFR: ${chunk.MFR} Hz`;
          option.textContent = `Chunk ${chunkNum}\u2003 ${timeRange}\u2003\u2003 ${mfr}`;

          dropdown.appendChild(option);
        });
      } else {
        console.log("No activity data available.");
      }

      flag = true;

      if (total_neurons > 5200000) ishuman = true;
      VisualizateNeurons();
      resetCamera();
      centerCameraToObject(particles);
      startBtn.style.display = "block";
    } else {
      console.log("No files found in the response.");
    }
  } catch (error) {
    console.error("Upload or processing error:", error);
    alert("An error occurred. Please try again.");
    msg.innerText = "Upload failed. Please refresh and try again.";
  } finally {
    loader.style.display = "none";
    networkFileInput.value = "";
  }
});

hdfFileInput.addEventListener("change", async (event) => {
  resetSpikeState();
  resetPlaybackConfig();
  resetTimeUI();
  clearScene();
  resetAndDisableAllCheckboxes();

  const files = event.target.files;

  if (files.length > 0) {
    try {
      const chunkSize = 10 * 1024 * 1024; // 10 MB
      const uploadPromises = [];

      const progressBar = document.getElementById("progress-percentage");
      const loader = document.getElementById("page-loader");
      const msg = document.getElementById("msgprogress");

      progressBar.innerText = "0%";
      loader.style.display = "block";
      msg.innerText = "Uploading your file, please wait...";

      let totalChunksAllFiles = 0;
      let totalUploadedChunks = 0;

      for (const file of files) {
        totalChunksAllFiles += Math.ceil(file.size / chunkSize);
      }

      for (const file of files) {
        const fileType = file.name.split(".").pop().toLowerCase(); // csv or hdf5
        const totalChunks = Math.ceil(file.size / chunkSize);

        for (let start = 0; start < file.size; start += chunkSize) {
          const chunk = file.slice(start, start + chunkSize);
          const formData = new FormData();
          formData.append("file", chunk, file.name);
          formData.append("chunkIndex", Math.floor(start / chunkSize));
          formData.append("totalChunks", totalChunks);
          formData.append("uniqueDirectory", uniqueDirectory);
          formData.append("fileType", fileType);

          uploadPromises.push(
            fetch(`${baseURL}/api/upload_and_save_Network_file/`, {
              method: "POST",
              body: formData,
              headers: {
                "X-Requested-With": "XMLHttpRequest",
              },
            }).then(() => {
              totalUploadedChunks++;
              const uploadProgress = Math.round((totalUploadedChunks / totalChunksAllFiles) * 100);
              progressBar.innerText = `${uploadProgress}%`;
            })
          );
        }
      }

      await Promise.all(uploadPromises);
      // ✅ Simulated fetch progress bar
      progressBar.innerText = "0%";
      msg.innerText = "Processing your data for visualizing Circuit, please wait...";
      let fetchProgress = 0;

      const percentInterval = setInterval(() => {
        if (fetchProgress < 99) {
          fetchProgress += 1;
          progressBar.innerText = `${fetchProgress}%`;
        }
      }, 100); // ~10 seconds to simulate fetch

      const response = await fetch(`${baseURL}/api/fetch_user_network_data/?dir=${uniqueDirectory}`);
      const data = await response.json();

      clearInterval(percentInterval);
      progressBar.innerText = "100%";
      msg.innerText = "Data loaded successfully! Visualizing neurons...";

      if (data.files.length > 0) {
        document.getElementById("Neurons_firing_attributes").style.visibility = "visible";
        document.getElementById("networkspikes").style.visibility = "visible";

        vertexColors = [];
        NetworkArray = [];
        data.files.forEach((file) => {
          NetworkArray.push(file.fileData);
          total_neurons += file.total_neuros;
        });

        if (total_neurons > 5000000) ishuman = true;

        flag = true;
        VisualizateNeurons();
        resetCamera();
        centerCameraToObject(particles);
        startBtn.style.display = "block";

        if (parseInt(data.flag_check) === 1) {
          document.getElementById("lblspikes").innerText = "# spikes :" + data.lstresponse.total_lines;

          total_activity_files = data.lstresponse.total_activity_files;
          firstLastKeys = data.lstresponse.first_last_keys;

          if (!data.lstresponse.chunk_mfr_list || data.lstresponse.chunk_mfr_list.length === 0) {
            return;
          }

          //   const dropdown = document.getElementById("ddactivity_chunks");
          dropdown.innerHTML = "";

          const defaultOption = document.createElement("option");
          defaultOption.textContent = "Activity windows";
          dropdown.appendChild(defaultOption);

          data.lstresponse.chunk_mfr_list.forEach((chunk) => {
            const option = document.createElement("option");
            option.value = chunk.chunk_number;

            const chunkNum = String(chunk.chunk_number);
            const timeRange = `[${chunk.first_key} - ${chunk.last_key}]ms`;
            const mfr = `MFR: ${chunk.MFR} Hz`;
            option.textContent = `Chunk ${chunkNum}\u2003 ${timeRange}\u2003\u2003 ${mfr}`;

            dropdown.appendChild(option);
          });
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
      document.getElementById("page-loader").style.display = "none";
      hdfFileInput.value = "";
    }
  }
});

dropdown.addEventListener("change", async function () {
  resetSpikeState();
  resetPlaybackConfig();
  resetTimeUI();
  counter_check += 1;
  selectedChunkNumber = this.value;

  if (!selectedChunkNumber || selectedChunkNumber === "Select Activity Chunk") return;

  const progressBar = document.getElementById("progress-percentage");
  const loader = document.getElementById("page-loader");
  const msg = document.getElementById("msgprogress");

  let fetchProgress = 0;

  try {
    loader.style.display = "block";
    msg.innerText = "Loading data..., please wait...";
    progressBar.innerText = "0%";

    // Simulated loading
    const percentInterval = setInterval(() => {
      if (fetchProgress < 99) {
        fetchProgress += 1;
        progressBar.innerText = `${fetchProgress}%`;
      }
    }, 100); // ~10s simulated fetch duration

    const response = await fetch(`${baseURL}/api/get_chunk_data/?dir=${uniqueDirectory}&chunk_number=${selectedChunkNumber}`);
    const data = await response.json();

    clearInterval(percentInterval);
    progressBar.innerText = "100%";
    msg.innerText = "Chunk data loaded successfully!";

    if (!data.chunk_data || !data.gids_activity_indexes) {
      throw new Error("Missing chunk_data or gids_activity_indexes in API response.");
    }

    if (data.histogram) {
      document.getElementById("histogramImage").src = "data:image/png;base64," + data.histogram;
      document.getElementById("histogramImage").style.display = "block";
    }

    Activitys = data.chunk_data;

    const sortedKeys = Object.keys(Activitys).sort((a, b) => parseFloat(a) - parseFloat(b));
    if (sortedKeys.length > 0) {
      lastKey = sortedKeys[sortedKeys.length - 1];
      lasttime = parseInt(lastKey);
      totalTimeDisplay.textContent = lasttime;
      document.getElementById("timebar").max = lasttime;
    }

    if (selectedChunkNumber > 0 && sortedKeys.length > 0) {
      firstKey = sortedKeys[0];
      count = parseFloat(firstKey).toFixed(1);
      currentTimeDisplay.textContent = count;
    } else {
      count = 0.0;
      currentTimeDisplay.textContent = count.toFixed(1);
    }

    timeRanges = sortedKeys;
    gids_activity_indexes = data.gids_activity_indexes;

    document.getElementById("lblspikes").innerText = "# spikes :" + data.total_spikes;

    if (counter_check > 1) {
      clearInterval(interval);
      interval = null;
      isPaused = true;
      resetParticles();
    }

    previousTimeDisplay = parseFloat(currentTimeDisplay.textContent).toFixed(1);
    // document.getElementById("playbackcontainer").style.display = "block";

    startButton.disabled = false;
    document.getElementById("Neurons_firing_attributes").style.visibility = "visible";
    document.getElementById("networkspikes").style.visibility = "visible";
  } catch (error) {
    console.error("Error fetching chunk data:", error);
    alert("Failed to fetch chunk data. Please try again.");
    progressBar.innerText = "0%";
    msg.innerText = "Error loading chunk.";
  } finally {
    loader.style.display = "none";
  }
});

/*  Get the modal */
var modal = document.getElementById("myModal");

// Get the image and insert it inside the modal - use its "alt" text as a caption
var img = document.getElementById("histogramImage");
var modalImg = document.getElementById("img01");
var captionText = document.getElementById("caption");
img.onclick = function () {
  modal.style.display = "block";
  modalImg.src = this.src;
  captionText.innerHTML = this.alt;
};

// Get the <span> element that closes the modal
var span = document.getElementsByClassName("close")[0];

// When the user clicks on <span> (x), close the modal
span.onclick = function () {
  modal.style.display = "none";
};

startTimeInput.addEventListener("change", () => {
  let newStart = parseFloat(startTimeInput.value) || 0.0;

  // Validate start time
  if (newStart < 0) {
    alert("Start time cannot be negative");
    startTimeInput.value = ""; // Clear the input field
  } else if (newStart < parseFloat(previousTimeDisplay).toFixed(1)) {
    alert("Start time cannot be less than start simulation time");
    startTimeInput.value = ""; // Clear the input field
  } else if (newStart === 0.0) {
    // Handle case when the start time is 0
    // newStart = Math.max(0, newStart); // Ensure start time is at least 0
    // startTimeInput.value = newStart.toFixed(1); // Update the input with the valid value
    startTimeInput.value = "";

    // Set count to the first key or default to 0
    count = parseFloat(previousTimeDisplay).toFixed(1);
    timebar.value = count;
    currentTimeDisplay.textContent = parseFloat(previousTimeDisplay).toFixed(1);
  } else {
    // For any positive start time
    newStart = Math.max(0, newStart); // Ensure start time is at least 0
    startTimeInput.value = newStart.toFixed(1); // Update the input with the valid value

    count = newStart; // Set count to the start time
    timebar.value = newStart;
    currentTimeDisplay.textContent = newStart.toFixed(1);
  }

  resetParticles(); // Reset particles based on the new start time
});

endTimeInput.addEventListener("change", () => {
  let newEnd = parseFloat(endTimeInput.value) || parseFloat(lasttime); // Use lasttime as fallback

  if (parseFloat(startTimeInput.value) >= parseFloat(endTimeInput.value)) {
    alert("End time can not be less than or equal to start time");
  }
  // Validate end time
  else if (newEnd < 0) {
    alert("End time cannot be negative");
    endTimeInput.value = ""; // Clear the input field
  } else if (newEnd > parseFloat(lasttime)) {
    alert("End time cannot be greater than simulation time");
    endTimeInput.value = ""; // Clear the input field
  } else if (startTimeInput.value == "") {
    endTimeInput.value = ""; // Update the input with the valid value
  }

  resetParticles(); // Reset particles based on the new end time
});

timebar.addEventListener("input", (event) => {
  count = parseFloat(event.target.value);
  currentTimeDisplay.textContent = count.toFixed(1);
  resetParticles();

  if (!particles) return;

  const geometry = particles.geometry;
  const colors = geometry.attributes.color.array;
  const originalColors = geometry.attributes.originalColor.array;
  const sizes = geometry.attributes.size.array;

  for (let i = 0; i < colors.length; i++) {
    colors[i] = originalColors[i]; // restore R, G, B
  }

  for (let i = 0; i < sizes.length; i++) {
    const r = colors[i * 3];
    const g = colors[i * 3 + 1];
    const b = colors[i * 3 + 2];

    // Check if neuron is firing (yellow or white)
    const isFiring = (r === 1 && g === 1 && b === 0) || (r === 1 && g === 1 && b === 1);

    sizes[i] = isFiring
      ? parameters.Firing_Neuron_Size || 100 // fallback if not defined
      : parameters.Neuron_Size || 30;
  }
  geometry.attributes.color.needsUpdate = true;
  geometry.attributes.size.needsUpdate = true;

  if (isPaused) {
    if (isConnection) {
      animateTimeRange_Connection(count, spikeNeuronSize);
      twoMilisecondStay_Connection(count);
    } else {
      animateTimeRange_Without_Connection(count, spikeNeuronSize);
      twoMilisecondStay_Without_Connection(count);
    }
  }
});

//////////////////
const startButton = document.getElementById("startbtn");

startButton.addEventListener("click", () => {
  let startVal = Math.max(0, parseFloat(startTimeInput.value)) || 0.0;
  let endVal = Math.max(0, parseFloat(endTimeInput.value)) || parseFloat(lasttime);

  if (selectedChunkNumber > 0 && isFinished) {
    isFinished = false;

    isPaused = false;
    startVal = parseFloat(firstKey);
    count = parseFloat(startVal).toFixed(1);
    timebar.value = count;
  } else if (!interval || isPaused) {
    isPaused = false;
    count = Math.max(count, startVal); // Ensure within bounds
    timebar.value = count;
  }
  currentTimeDisplay.textContent = parseFloat(count).toFixed(1);
  startButton.disabled = true;
  stopButton.disabled = false;
  restart.disabled = false;
  timebar.min = count;
  timebar.max = endVal;
  startAnimation(startVal, endVal);
});

const stopButton = document.getElementById("pause");

stopButton.addEventListener("click", () => {
  clearInterval(interval);
  interval = null;
  isPaused = true;
  startButton.disabled = false;
  stopButton.disabled = true;
});

const restart = document.getElementById("restart");

restart.addEventListener("click", () => {
  let startVal, endVal;

  if (selectedChunkNumber > 0) {
    spikeTimes.clear();
    spikeTransitions.clear();
    startVal = parseFloat(firstKey).toFixed(1);

    endVal = parseFloat(lasttime).toFixed(1);
    count = startVal;

    currentTimeDisplay.textContent = parseFloat(count).toFixed(1);
  } else {
    startVal = parseFloat(startTimeInput.value) || 0.0;
    endVal = parseFloat(endTimeInput.value) || parseFloat(lasttime);
    count = startVal;
    currentTimeDisplay.textContent = parseFloat(count).toFixed(1);
    //totalTimeDisplay.textContent = count;
  }

  //   const startVal = parseFloat(startTimeInput.value) || 0.0;
  //   const endVal = parseFloat(endTimeInput.value) || parseFloat(lasttime);

  clearInterval(interval);
  interval = null;
  resetParticles();

  //   count = startVal;
  timebar.min = startVal;
  timebar.max = endVal;
  timebar.value = count;
  //   currentTimeDisplay.textContent = count.toFixed(1);

  isPaused = false;
  startButton.disabled = true;
  stopButton.disabled = false;

  startAnimation(startVal, endVal);
});

function resetSpikeState() {
  clearInterval(interval);
  interval = null;
  isPaused = true;
  count = 0;

  Activitys = {};
  gids_activity_indexes = {};
  timeRanges = [];

  // Optional: reset UI
  currentTimeDisplay.textContent = "0.0";
  timebar.value = 0;
}

const visualizeButton = document.getElementById("btnvisualize");
visualizeButton.addEventListener("click", () => {
  if (numberofneurosButton.value.length > 0 || animationtime.value.length > 0 || (txttimefrom.value.length > 0 && txttimeto.value.length > 0)) {
    if (numberofneurosButton.value.length > 0) {
      const number_of_neuros = numberofneurosButton.value;

      document.getElementById("msgprogress").innerText = "Please wait a moment while we fetching your data for visualization. Your patience is appreciated";

      GetNetworkData(number_of_neuros);

      //   fetch_user_network_data_by_number(number_of_neuros);
      //VisualizateNeurons(Networks); //fetchNetworkDataInChunks();
    }
  } else {
    alert("Please fill any Visualization Parameter...");
  }
});

window.addEventListener("resize", onWindowResize, false);
function onWindowResize() {
  camera.aspect = window.innerWidth / window.innerHeight;
  camera.updateProjectionMatrix();
  renderer.setSize(window.innerWidth, window.innerHeight);
  render();
}

let timeSprite;
const hudCanvas = document.getElementById("hudCanvas");
const hudCtx = hudCanvas.getContext("2d");

const canvas = document.getElementById("neuronCanvas");
function CreateScene() {
  // Use your canvas explicitly
  renderer = new THREE.WebGLRenderer({
    canvas: canvas,
    powerPreference: "high-performance",
    alpha: true,
    antialias: true,
    preserveDrawingBuffer: true, //  ADD THIS
    logarithmicDepthBuffer: true,
  });

  renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2)); // Cap at 2 for performance
  renderer.setSize(canvas.clientWidth, canvas.clientHeight, false);
  renderer.setClearColor(0x000000, 0); // Transparent background
  renderer.autoClear = false; // So we can render both scenes

  scene = new THREE.Scene();
  camera = new THREE.PerspectiveCamera(45, canvas.clientWidth / canvas.clientHeight, 1, 100000);
  camera.position.z = 1000;
  controls = new TrackballControls(camera, canvas);
  controls.rotateSpeed = 20.0;
  controls.zoomSpeed = 10;
  controls.panSpeed = 0.8;
  controls.minDistance = 0.1; // Allow very close zoom (default is 0)
  controls.maxDistance = 100000; // Increase if camera hits a limit

  controls.dynamicDampingFactor = 0.25;

  stopButton.disabled = true;
  startButton.disabled = true;
  restart.disabled = true;
}

// === HUD Text ===
function drawHUDTimeToCanvas2D(ctx, count, endVal) {
  ctx.clearRect(0, 0, ctx.canvas.width, ctx.canvas.height);
  ctx.font = "bold 32px sans-serif";
  ctx.textAlign = "center";
  ctx.textBaseline = "top";
  ctx.fillStyle = "white";
  const text = `t = ${parseFloat(count).toFixed(1)} / ${parseFloat(endVal).toFixed(1)} ms`;
  ctx.fillText(text, ctx.canvas.width / 2, 10);
}

const colorPickers = {
  DG: document.getElementById("colorPickerDG"),
  CA3: document.getElementById("colorPickerCA3"),
  CA2: document.getElementById("colorPickerCA2"),
  CA1: document.getElementById("colorPickerCA1"),
  Sub: document.getElementById("colorPickerSub"),
  EC: document.getElementById("colorPickerEC"),
};

let dgRGB = hexToNormalizedRGB(colorPickers.DG.value);
let ca3RGB = hexToNormalizedRGB(colorPickers.CA3.value);
let ca2RGB = hexToNormalizedRGB(colorPickers.CA2.value);
let ca1RGB = hexToNormalizedRGB(colorPickers.CA1.value);
let subRGB = hexToNormalizedRGB(colorPickers.Sub.value);
let ecRGB = hexToNormalizedRGB(colorPickers.EC.value);

Object.entries(colorPickers).forEach(([region, picker]) => {
  picker.addEventListener("input", () => {
    const rgb = hexToNormalizedRGB(picker.value);
    switch (region) {
      case "DG":
        dgRGB = rgb;
        break;
      case "CA3":
        ca3RGB = rgb;
        break;
      case "CA2":
        ca2RGB = rgb;
        break;
      case "CA1":
        ca1RGB = rgb;
        break;
      case "Sub":
        subRGB = rgb;
        break;
      case "EC":
        ecRGB = rgb;
        break;
    }
    VisualizateNeurons(); // Optional re-render
  });
});

function createTextLabel(text) {
  const canvas = document.createElement("canvas");
  const size = 128;
  canvas.width = size;
  canvas.height = size;

  const ctx = canvas.getContext("2d");
  ctx.font = "bold 48px Arial";
  ctx.fillStyle = "white";
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";
  ctx.fillText(text, size / 2, size / 2);

  const texture = new THREE.CanvasTexture(canvas);
  const material = new THREE.SpriteMaterial({ map: texture, transparent: true });
  return new THREE.Sprite(material);
}

let arrowsScene, arrowsCamera;

function addAnatomicalArrowsFromPCA(scene, origin, length, pcaAxes) {
  const labels = [
    { label: "A", dir: pcaAxes[0].clone().negate(), color: 0xff00ff },
    { label: "P", dir: pcaAxes[0], color: 0xffff00 },
    { label: "D", dir: pcaAxes[1], color: 0x00ff00 },
    { label: "V", dir: pcaAxes[1].clone().negate(), color: 0xffffff },
    { label: "L", dir: pcaAxes[2], color: 0xff0000 },
    { label: "M", dir: pcaAxes[2].clone().negate(), color: 0x0000ff },
  ];

  labels.forEach(({ label, dir, color }) => {
    const arrow = new THREE.ArrowHelper(dir.clone().normalize(), origin, length, color, 0.3 * length, 0.2 * length);
    scene.add(arrow);

    const labelSprite = createTextLabel(label);
    labelSprite.position.copy(
      origin.clone().add(
        dir
          .clone()
          .normalize()
          .multiplyScalar(length + 0.4)
      )
    );
    scene.add(labelSprite);
  });
}

function computePCA(positions) {
  // Step 1: Format to matrix [[x, y, z], ...]
  const matrix = [];
  for (let i = 0; i < positions.length; i += 3) {
    matrix.push([positions[i], positions[i + 1], positions[i + 2]]);
  }

  // Step 2: Compute mean of each dimension
  const mean = [0, 0, 0];
  matrix.forEach((p) => {
    mean[0] += p[0];
    mean[1] += p[1];
    mean[2] += p[2];
  });
  mean[0] /= matrix.length;
  mean[1] /= matrix.length;
  mean[2] /= matrix.length;

  // Step 3: Center data
  const centered = matrix.map((p) => [p[0] - mean[0], p[1] - mean[1], p[2] - mean[2]]);

  // Step 4: Compute covariance matrix
  const cov = numeric.dot(numeric.transpose(centered), centered);

  // Step 5: Compute eigenvectors
  const eig = numeric.eig(cov);
  const eigVectors = eig.E.x;

  return eigVectors.map((v) => new THREE.Vector3(...v));
}

function createArrowOverlayFromPCA(pcaAxes) {
  arrowsScene = new THREE.Scene();
  arrowsScene.background = null; // ✅ ensure transparent background
  arrowsCamera = new THREE.PerspectiveCamera(50, 1, 0.1, 100);
  arrowsCamera.position.set(0, 0, 5);
  arrowsCamera.lookAt(0, 0, 0);
  arrowsScene.add(new THREE.AmbientLight(0xffffff, 2));

  addAnatomicalArrowsFromPCA(arrowsScene, new THREE.Vector3(0, 0, 0), 1.0, pcaAxes);
}

function VisualizateNeurons() {
  // Clear previous particles if any
  if (!flag) {
    positions = [];
    sizes = [];
    gIDs = [];
    vertexColors = [];

    if (particles) {
      scene.remove(particles);
      if (particles.geometry) particles.geometry.dispose();
      if (particles.material) Array.isArray(particles.material) ? particles.material.forEach((mat) => mat.dispose()) : particles.material.dispose();
      particles = null;
    }

    document.getElementById("lblnetwork").innerText = "# neurons :";
    document.getElementById("Neurons_firing_attributes").style.visibility = "hidden";
    document.getElementById("networkspikes").style.visibility = "hidden";
    removeTable();
  }

  geometry = new THREE.BufferGeometry();
  total_excitatory = 0;
  total_inhibitory = 0;
  totalParticles = 0;
  totalX = 0;
  totalY = 0;
  totalZ = 0;

  let DG = [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15, 16, 17, 18];
  let CA3 = [19, 20, 21, 22, 23, 24, 25, 26, 27, 28, 29, 30, 31, 32, 33, 34, 35, 36, 37, 38, 39, 40, 41, 42, 43];
  let CA2 = [44, 45, 46, 47, 48];
  let CA1 = [49, 50, 51, 52, 53, 54, 55, 56, 57, 58, 59, 60, 61, 62, 63, 64, 65, 66, 67, 68, 69, 70, 71, 72, 73, 74, 75, 76, 77, 78, 79, 80, 81, 82, 83, 84, 85, 86, 87, 88];
  let SUB = [89, 90, 91];
  let EC = [92, 93, 94, 95, 96, 97, 98, 99, 100, 101, 102, 103, 104, 105, 106, 107, 108, 109, 110, 111, 112, 113, 114, 115, 116, 117, 118, 119, 120, 121, 122];

  if (flag) {
    if (ishuman) {
      if (ishalf) {
        NetworkArray.forEach((net) => {
          net.forEach((p) => {
            // const x = p.x * scalingFactor;
            // const y = p.y * scalingFactor;
            // const z = p.z * scalingFactor;
            const x = p.x;
            const y = p.y;
            const z = p.z;
            positions.push(x, y, z);
            sizes.push(30);
            gIDs.push(p.id);

            p.id < 2400001 ? (vertexColors.push(0, 0, 1), total_excitatory++) : (vertexColors.push(1, 0, 0), total_inhibitory++);

            totalX += x;
            totalY += y;
            totalZ += z;
          });
          totalParticles += net.length;
        });
        ishalf = false;
      } else {
        NetworkArray.forEach((net) => {
          net.forEach((p) => {
            const x = p.x;
            const y = p.y;
            const z = p.z;
            positions.push(x, y, z);
            sizes.push(30);
            gIDs.push(p.id);

            p.id < 4800001 ? (vertexColors.push(0, 0, 1), total_excitatory++) : (vertexColors.push(1, 0, 0), total_inhibitory++);

            totalX += x;
            totalY += y;
            totalZ += z;
          });
          totalParticles += net.length;
        });
      }
      ishuman = false;
    } else {
      NetworkArray.forEach((net) => {
        net.forEach((p) => {
          const x = p.x;
          const y = p.y;
          const z = p.z;
          positions.push(x, y, z);
          sizes.push(30);
          gIDs.push(p.id);

          p.id < 261845 ? (vertexColors.push(0, 0, 1), total_excitatory++) : (vertexColors.push(1, 0, 0), total_inhibitory++);

          totalX += x;
          totalY += y;
          totalZ += z;
        });
        totalParticles += net.length;
      });
    }
  } else if (selectedCheckboxIds.length > 0 || selectedCheckboxByLayer.length > 0) {
    NetworkArray.forEach((net, index) => {
      const filteredParticles = net.filter((p) => {
        const matchByRegion = selectedCheckboxIds.includes(p.ntype.toString());
        const matchByLayer = selectedCheckboxByLayer.includes(index);
        return matchByRegion || matchByLayer;
      });

      totalParticles += filteredParticles.length;

      filteredParticles.forEach((p) => {
        const x = p.x;
        const y = p.y;
        const z = p.z;

        if (p.type === 1) {
          const ntype = Number(p.ntype);
          if (DG.includes(ntype)) vertexColors.push(...dgRGB);
          else if (CA3.includes(ntype)) vertexColors.push(...ca3RGB);
          else if (CA2.includes(ntype)) vertexColors.push(...ca2RGB);
          else if (CA1.includes(ntype)) vertexColors.push(...ca1RGB);
          else if (SUB.includes(ntype)) vertexColors.push(...subRGB);
          else if (EC.includes(ntype)) vertexColors.push(...ecRGB);
          total_excitatory++;
        } else {
          vertexColors.push(1.0, 0.0, 0.0);
          total_inhibitory++;
        }

        positions.push(x, y, z);
        sizes.push(30);
        gIDs.push(p.id);
        neuron_class.push(p.type);
      });
    });
  }

  document.getElementById("Neurons_firing_attributes").style.visibility = "visible";
  document.getElementById("networkspikes").style.visibility = "visible";
  document.getElementById("lblnetwork").innerText = "# neurons :" + totalParticles;
  generateTable(totalParticles, total_excitatory, total_inhibitory);

  geometry.setAttribute("position", new THREE.Float32BufferAttribute(positions, 3));
  geometry.setAttribute("color", new THREE.Float32BufferAttribute(vertexColors, 3));
  geometry.setAttribute("size", new THREE.Float32BufferAttribute(sizes, 1));
  geometry.setAttribute("gid", new THREE.Float32BufferAttribute(gIDs, 1));
  geometry.setAttribute("originalColor", new THREE.Float32BufferAttribute(vertexColors, 3));

  const uniforms = { pointTexture: { value: null } };
  material = new THREE.ShaderMaterial({
    uniforms,
    vertexShader: document.getElementById("vertexshader").textContent,
    fragmentShader: document.getElementById("fragmentshader").textContent,
    transparent: true,
    vertexColors: true,
    depthTest: true,
    depthWrite: true,
    blending: THREE.NormalBlending,
  });
  material.uniforms.uBrightness = { value: 10.0 };
  particles = new THREE.Points(geometry, material);
  scene.add(particles);

  // Initialize raycaster with precise settings
  initRaycaster();
  initOriginalColors();
  // Clear previous listeners
  document.removeEventListener("pointermove", onPointerMove);
  document.addEventListener("pointermove", onPointerMove, { passive: false });

  if (loadmouseflag) {
    resetCamera();
    centerCameraToObject(particles);
    loadmouseflag = false;
  }
  scene.background = new THREE.Color(params.Backgound);

  if (!chkpanle) {
    chkpanle = true;

    let guiCreated = false;
    let guiCreated1 = false;

    document.getElementById("togglePanelBtn").style.display = "block";
    document.getElementById("btnopen").style.display = "block";

    document.getElementById("togglePanelBtn").addEventListener("click", () => {
      const panel = document.getElementById("panel");

      if (!guiCreated) {
        panel.style.display = "block";

        //////GUI panel code below
        var gui = new GUI({ autoPlace: false });
        gui.domElement.id = "gui";
        panel.appendChild(gui.domElement);
        const pm = gui.addFolder("Sphere Material");
        pm.add(parameters, "Neuron_Size", 1, 500).onChange((value) => {
          const sizes = geometry.attributes.size.array;
          for (let i = 0; i < sizes.length; i++) sizes[i] = value;
          geometry.attributes.size.needsUpdate = true;
        });

        pm.add(parameters, "Firing_Neuron_Size", 1, 1000).onChange((value) => {
          const sizes = geometry.attributes.size.array;
          const colors = geometry.attributes.color.array;
          for (let i = 0; i < colors.length; i += 3) {
            const r = colors[i],
              g = colors[i + 1],
              b = colors[i + 2];
            const neuronIndex = i / 3;
            if ((r === 1 && g === 1 && b === 0) || (r === 1 && g === 1 && b === 1)) {
              sizes[neuronIndex] = value;
            }
          }
          geometry.attributes.size.needsUpdate = true;
          geometry.attributes.color.needsUpdate = true;
          spikeNeuronSize = value;
        });

        const bgcolor = gui.addFolder("Background");
        bgcolor.addColor(params, "Backgound").onChange((value) => {
          scene.background.set(value);
        });
        bgcolor.close();

        const cameraFolder = gui.addFolder("Camera");
        cameraFolder.add(camera.position, "x", 0, 1000).listen();
        cameraFolder.add(camera.position, "y", 0, 1000).listen();
        cameraFolder.add(camera.position, "z", 0, 1000).listen();
        cameraFolder.close();

        guiCreated = true;
      } else {
        // Toggle visibility
        panel.style.display = panel.style.display === "none" ? "block" : "none";
      }
    });

    document.getElementById("btnopen").addEventListener("click", () => {
      const playbackcontainer = document.getElementById("playbackcontainer");

      if (!guiCreated1) {
        playbackcontainer.style.display = "block";
        guiCreated1 = true;
      } else {
        // Toggle visibility
        playbackcontainer.style.display = playbackcontainer.style.display === "none" ? "block" : "none";
        guiCreated1 = false;
      }
    });
  }
  const pcaAxes = computePCA(positions);
  createArrowOverlayFromPCA(pcaAxes);

  animate();
}
function generateTable(total_neuros, total_excitatory, total_inhibitory) {
  const containerDiv = document.createElement("div");
  containerDiv.className = "container-fluid px-2 mt-3";

  const row = document.createElement("div");
  row.className = "row";

  // Total Neurons
  const col1 = document.createElement("div");
  col1.className = "col-12 d-flex justify-content-between small py-1 border-bottom";
  col1.innerHTML = `<span><strong>Total Neurons</strong></span><span>${total_neuros}</span>`;
  row.appendChild(col1);

  // Excitatory Neurons
  const col2 = document.createElement("div");
  col2.className = "col-12 d-flex justify-content-between small py-1 border-bottom";
  col2.innerHTML = `<span><strong>Excitatory Neurons</strong></span><span>${total_excitatory}</span>`;
  row.appendChild(col2);

  // Inhibitory Neurons
  const col3 = document.createElement("div");
  col3.className = "col-12 d-flex justify-content-between small py-1";
  col3.innerHTML = `<span><strong>Inhibitory Neurons</strong></span><span>${total_inhibitory}</span>`;
  row.appendChild(col3);

  containerDiv.appendChild(row);

  // Clean previous if needed (optional: only remove old table, not indicators)
  const previous = document.querySelector("#Neurons_firing_attributes .stats-block");
  if (previous) previous.remove();

  containerDiv.classList.add("stats-block"); // to identify this block later
  document.getElementById("Neurons_firing_attributes").appendChild(containerDiv);
}

function removeTable() {
  var containerDiv = document.querySelector(".generateTable");
  if (containerDiv) {
    containerDiv.remove();
  }
}
function render() {
  renderer.render(scene, camera);
}
function animate() {
  requestAnimationFrame(animate);
  if (controls) controls.update();

  // ✅ Reset viewport and scissor for full screen
  const width = renderer.domElement.clientWidth;
  const height = renderer.domElement.clientHeight;

  renderer.setViewport(0, 0, width, height);
  renderer.setScissor(0, 0, width, height);
  renderer.setScissorTest(true);
  renderer.clear();
  renderer.render(scene, camera);

  // 🔁 Mini arrows rendering (inset scene)
  if (arrowsScene && arrowsCamera) {
    renderer.clearDepth(); // allow rendering over existing scene
    arrowsScene.quaternion.copy(camera.quaternion);

    const size = 150;
    const margin = 10;

    // 📌 Bottom-left corner (or you can adjust for top-right)
    const x = margin;
    const y = margin + 110;

    // Now set a smaller viewport just for the arrow scene
    renderer.setViewport(x, y, size, size);
    renderer.setScissor(x, y, size, size);
    renderer.setScissorTest(true);
    renderer.render(arrowsScene, arrowsCamera);
  }
}

let isFinished = false;
function startAnimation(startVal, endVal) {
  if (interval) clearInterval(interval);

  interval = setInterval(() => {
    if (!isPaused) {
      const simTimestep = playbackConfig.simTimestep;

      timebar.value = count;
      currentTimeDisplay.textContent = parseFloat(count).toFixed(1);

      drawHUDTimeToCanvas2D(hudCtx, count, endVal);

      if (isConnection) {
        animateTimeRange_Connection(count, spikeNeuronSize);
        twoMilisecondStay_Connection(count);
      } else {
        animateTimeRange_Without_Connection(count, spikeNeuronSize);
        twoMilisecondStay_Without_Connection(count);
      }

      if (count >= endVal || count >= lasttime) {
        clearInterval(interval);
        interval = null;
        resetParticles();
        count = 0.0;
        if (mediaRecorder && mediaRecorder.state === "recording") {
          stopRecording(); //  Automatically stop and download
          document.getElementById("rec-indicator").style.display = "none";
          stopBtn.style.display = "none";
          startBtn.style.display = "inline-block";
          spikeTimes.clear();
          spikeTransitions.clear();
        }

        isPaused = true; //  allow future play
        stopButton.disabled = true;
        startButton.disabled = false;
        restart.disabled = false; //  allow restarting

        count = startVal; //  reset count for next run
        if (selectedChunkNumber > 0) {
          count = parseFloat(firstKey).toFixed(1);
          currentTimeDisplay.textContent = count;
        }
        isFinished = true;
        return;
      }
      //   console.log("count:", count, "simTimestep:", simTimestep);

      count = parseFloat((parseFloat(count) + parseFloat(simTimestep)).toFixed(1));
    }
  }, playbackConfig.stepDuration);
}
function animateTimeRange_Connection(currentTime, targetSize) {
  const matchKey = parseFloat(currentTime).toFixed(1);
  const particleIds = Activitys[matchKey];
  if (particleIds !== undefined) {
    animateParticles_Connection(particleIds, targetSize);
  }
}

function animateParticles_Connection(particleIds, targetSize) {
  const sizes = geometry.attributes.size.array;
  const colors = geometry.attributes.color.array;
  const gIDs = geometry.attributes.gid.array;

  const gIDsMap = new Map();
  for (let i = 0; i < gIDs.length; i++) {
    gIDsMap.set(gIDs[i], i);
  }

  particleIds.forEach((particleId) => {
    // Fire all CA1 postsynaptic connections
    if (ca3toca1connections[particleId]) {
      ca3toca1connections[particleId].forEach((ca1Id) => {
        const GIDindex = gIDsMap.get(ca1Id);
        if (GIDindex === undefined) return;
        const index = GIDindex * 3;

        spikeTimes.set(ca1Id, count);
        spikeTransitions.set(ca1Id, { startTime: count });

        sizes[GIDindex] = targetSize;

        // Save original color
        if (!originalColors[GIDindex]) {
          originalColors[GIDindex] = {
            r: colors[index],
            g: colors[index + 1],
            b: colors[index + 2],
          };
        }

        if (colors[index] === 1 && colors[index + 1] === 0 && colors[index + 2] === 0) {
          colors[index] = 1;
          colors[index + 1] = 1;
          colors[index + 2] = 1;
        } else {
          colors[index] = 1;
          colors[index + 1] = 1;
          colors[index + 2] = 0;
        }
      });
    }
    // Fire original CA3 particle as well
    const GIDindex = gids_activity_indexes[particleId];
    if (GIDindex !== undefined) {
      const index = GIDindex * 3;
      sizes[GIDindex] = targetSize;

      spikeTimes.set(particleId, count);
      spikeTransitions.set(particleId, { startTime: count });

      sizes[GIDindex] = targetSize;

      if (!originalColors[GIDindex]) {
        originalColors[GIDindex] = {
          r: colors[index],
          g: colors[index + 1],
          b: colors[index + 2],
        };
      }

      if (colors[index] === 1 && colors[index + 1] === 0 && colors[index + 2] === 0) {
        colors[index] = 1;
        colors[index + 1] = 1;
        colors[index + 2] = 1;
      } else {
        colors[index] = 1;
        colors[index + 1] = 1;
        colors[index + 2] = 0;
      }
    }
  });

  geometry.attributes.size.needsUpdate = true;
  geometry.attributes.color.needsUpdate = true;
}

function twoMilisecondStay_Connection(currentTime) {
  const sizes = geometry.attributes.size.array;
  const colors = geometry.attributes.color.array;
  const gIDs = geometry.attributes.gid.array;

  const gIDsMap = new Map();
  for (let i = 0; i < gIDs.length; i++) {
    gIDsMap.set(gIDs[i], i);
  }

  spikeTransitions.forEach((state, gid) => {
    const GIDindex = gids_activity_indexes[gid] ?? gIDsMap.get(gid);
    if (GIDindex === undefined) return;

    const index = GIDindex * 3;
    const elapsed = currentTime - state.startTime;
    const t = Math.min(elapsed / fadeDuration, 1); // normalized 0-1

    const eased = Math.sin(t * Math.PI); // ease in-out
    sizes[GIDindex] = baseSize + (spikeNeuronSize - baseSize) * eased;
    if (t >= 1) {
      // Restore original color
      const original = originalColors[GIDindex];
      if (original) {
        colors[index] = original.r;
        colors[index + 1] = original.g;
        colors[index + 2] = original.b;
      }

      sizes[GIDindex] = baseSize;
      spikeTransitions.delete(gid);
      spikeTimes.delete(gid);
      delete originalColors[GIDindex];
    }
  });

  geometry.attributes.size.needsUpdate = true;
  geometry.attributes.color.needsUpdate = true;
}

function animateTimeRange_Without_Connection(currentTime, targetSize) {
  const simTimestep = playbackConfig.simTimestep;
  const startTime = parseFloat(currentTime);
  const endTime = startTime + simTimestep;

  for (let t = startTime; t < endTime; t += 0.1) {
    const key = t.toFixed(1); // Format to match keys in Activitys, e.g. "8.3"
    const particleIds = Activitys[key];

    if (particleIds !== undefined) {
      animateParticles_Without_Connection(particleIds, targetSize);
    }
  }
}

const baseSize = 30;
const fadeDuration = 2.0;
const spikeTransitions = new Map(); // gid → { startTime }

function animateParticles_Without_Connection(particleIds, targetSize) {
  const sizes = geometry.attributes.size.array;
  const colors = geometry.attributes.color.array;

  particleIds.forEach((gid) => {
    const GIDindex = gids_activity_indexes[gid];
    if (GIDindex === undefined) return;
    if (hoveredIndex === GIDindex) return;

    const index = GIDindex * 3;

    // Save current time for animation tracking
    spikeTimes.set(gid, count);
    spikeTransitions.set(gid, { startTime: count });

    // Set size to max immediately
    sizes[GIDindex] = targetSize;

    // Save original color if not already saved
    if (!originalColors[GIDindex]) {
      originalColors[GIDindex] = {
        r: colors[index],
        g: colors[index + 1],
        b: colors[index + 2],
      };
    }

    // Modify color for visual spike
    if (colors[index] === 1 && colors[index + 1] === 0 && colors[index + 2] === 0) {
      colors[index + 1] = 1;
      colors[index + 2] = 1;
    } else if (colors[index] === 0 && colors[index + 1] === 0 && colors[index + 2] === 1) {
      colors[index] = 1;
      colors[index + 1] = 1;
      colors[index + 2] = 0;
    }
  });

  geometry.attributes.size.needsUpdate = true;
  geometry.attributes.color.needsUpdate = true;
}

function twoMilisecondStay_Without_Connection(currentTime) {
  const sizes = geometry.attributes.size.array;
  const colors = geometry.attributes.color.array;

  spikeTransitions.forEach((state, gid) => {
    const GIDindex = gids_activity_indexes[gid];
    if (GIDindex === undefined) return;

    const index = GIDindex * 3;
    const elapsed = currentTime - state.startTime;

    // Normalize elapsed time from 0 → 1
    const t = Math.min(elapsed / fadeDuration, 1);

    // Full sine wave scale (ease in-out)
    const eased = Math.sin(t * Math.PI);
    sizes[GIDindex] = baseSize + (spikeNeuronSize - baseSize) * eased;

    // Once time is over, reset to original state
    if (t >= 1) {
      const original = originalColors[GIDindex];
      if (original) {
        colors[index] = original.r;
        colors[index + 1] = original.g;
        colors[index + 2] = original.b;
      }

      sizes[GIDindex] = baseSize;
      spikeTransitions.delete(gid);
      spikeTimes.delete(gid);
      delete originalColors[GIDindex];
    }
  });

  geometry.attributes.size.needsUpdate = true;
  geometry.attributes.color.needsUpdate = true;
}

function resetParticles() {
  if (!particles) return;

  const geometry = particles.geometry;
  const colors = geometry.attributes.color.array;
  const originalColors = geometry.attributes.originalColor.array;
  const sizes = geometry.attributes.size.array;

  for (let i = 0; i < colors.length; i++) {
    colors[i] = originalColors[i]; // restore R, G, B
  }

  for (let i = 0; i < sizes.length; i++) {
    sizes[i] = parameters.SphereSize || 30;
  }
  spikeTimes.clear();
  spikeTransitions.clear();
  geometry.attributes.color.needsUpdate = true;
  geometry.attributes.size.needsUpdate = true;
}

let loadmouseflag = false;
window.addEventListener("load", function () {
  const btnLoadAllLayers = document.getElementById("btnLoadAllLayers");
  btnLoadAllLayers.addEventListener("click", function () {
    document.getElementById("msgprogress").innerText = `Loading Hippocampal formation data, please wait...`;

    document.getElementById("progress-percentage").style.display = "none";

    document.getElementById("page-loader").style.display = "block";
    LoadHipForm();
    enableAllElements();
    loadmouseflag = true;
    dropdown.innerHTML = "";
  });
});

function SelectAllByRegion() {
  // 1. Define region-to-layer mappings for disabling
  const regionToLayerMapForDisabling = {
    AllDGRegSwitchCheck: ["DGSG", "DGSMi", "DGSMo", "DGH"],
    AllCA3RegSwitchCheck: ["CA3SL", "CA3SLM", "CA3SO", "CA3SP", "CA3SR"],
    AllCA2RegSwitchCheck: ["CA2SP"],
    AllCA1RegSwitchCheck: ["CA1SLM", "CA1SO", "CA1SP", "CA1SR"],
    AllSubRegSwitchCheck: ["SubSM", "SubSP"],
    AllECRegSwitchCheck: ["LECI", "LECII", "LECIII", "LECIV", "LECV", "LECVI", "MECI", "MECII", "MECIII", "MECIV", "MECV", "MECVI"],
  };

  // 2. Iterate through each region checkbox and attach change listener
  Object.keys(regionToLayerMapForDisabling).forEach((regionId) => {
    const regionCheckbox = document.getElementById(regionId);
    const layerCheckboxIds = regionToLayerMapForDisabling[regionId];

    if (regionCheckbox) {
      regionCheckbox.addEventListener("change", () => {
        const disable = regionCheckbox.checked;
        layerCheckboxIds.forEach((layerId) => {
          const layerCheckbox = document.getElementById(layerId);
          if (layerCheckbox) {
            layerCheckbox.disabled = disable;
          }
        });
      });
    }
  });
  // Handle Regions checkbox selection
  const SelectAll = document.getElementById("SelectAll");
  const UnselectAll = document.getElementById("UnselectAll");

  const AllDGRegSwitchCheck = document.getElementById("AllDGRegSwitchCheck");
  const AllCA3RegSwitchCheck = document.getElementById("AllCA3RegSwitchCheck");
  const AllCA2RegSwitchCheck = document.getElementById("AllCA2RegSwitchCheck");
  const AllCA1RegSwitchCheck = document.getElementById("AllCA1RegSwitchCheck");
  const AllSubRegSwitchCheck = document.getElementById("AllSubRegSwitchCheck");
  const AllECRegSwitchCheck = document.getElementById("AllECRegSwitchCheck");

  const AllNT = document.getElementById("AllNT");
  const RankNT = document.getElementById("RankNT");
  const CanonicalNT = document.getElementById("CanonicalNT");

  const sections = [
    {
      container: ".DG_checkbox_container",
      regSelectAllId: "AllDGRegSwitchCheck",
      selectAllId: "AllDGSwitchCheck",
      specificCheckboxIds_rank: [1, 3, 4, 7, 8, 9, 10, 11, 17],
      specificCheckboxIds_canonical: [1],
    },
    {
      container: ".CA3_checkbox_container",
      regSelectAllId: "AllCA3RegSwitchCheck",
      selectAllId: "AllCA3SwitchCheck",
      specificCheckboxIds_rank: [19, 20, 23, 25, 26, 27, 28, 31, 33, 34, 36, 40, 43],
      specificCheckboxIds_canonical: [19],
    },
    {
      container: ".CA2_checkbox_container",
      regSelectAllId: "AllCA2RegSwitchCheck",
      selectAllId: "AllCA2SwitchCheck",
      specificCheckboxIds_rank: [44, 45, 47],
      specificCheckboxIds_canonical: [0],
    },
    {
      container: ".CA1_checkbox_container",
      regSelectAllId: "AllCA1RegSwitchCheck",
      selectAllId: "AllCA1SwitchCheck",
      specificCheckboxIds_rank: [49, 52, 53, 54, 55, 57, 58, 60, 63, 66, 67, 68, 69, 74, 77, 79, 82, 84, 86, 87],
      specificCheckboxIds_canonical: [49],
    },
    {
      container: ".Sub_checkbox_container",
      regSelectAllId: "AllSubRegSwitchCheck",
      selectAllId: "AllSubSwitchCheck",
      specificCheckboxIds_rank: [90, 91],
      specificCheckboxIds_canonical: [0],
    },
    {
      container: ".EC_checkbox_container",
      regSelectAllId: "AllECRegSwitchCheck",
      selectAllId: "AllECSwitchCheck",
      specificCheckboxIds_rank: [93, 95, 97, 100, 104, 106, 107, 108, 111, 115, 117, 121, 122],
      specificCheckboxIds_canonical: [95],
    },
  ];

  let checkboxesToLog = ["CA1SLM", "CA1SO", "CA1SP", "CA1SR", "CA2SP", "CA3SL", "CA3SLM", "CA3SO", "CA3SP", "CA3SR", "DGSG", "DGSMi", "DGSMo", "DGH", "LECI", "LECII", "LECIII", "LECIV", "LECV", "LECVI", "MECI", "MECII", "MECIII", "MECIV", "MECV", "MECVI", "SubSM", "SubSP"];

  const DGLayer = [10, 11, 12, 13];
  const CA3Layer = [5, 6, 7, 8, 9];
  const CA2Layer = [4];
  const CA1Layer = [0, 1, 2, 3];
  const Sub = [26, 27];
  const LEC = [14, 15, 16, 17, 18, 19];
  const MEC = [20, 21, 22, 23, 24, 25];

  checkboxesToLog.forEach((id, index) => {
    const checkbox = document.getElementById(id);

    if (checkbox) {
      checkbox.addEventListener("change", function () {
        if (checkbox.checked) {
          //   console.log("Checked: " + index);
          if (!selectedCheckboxByLayer.includes(index)) {
            selectedCheckboxByLayer.push(index);

            if (DGLayer.includes(index)) AllDGRegSwitchCheck.disabled = true;
            if (CA3Layer.includes(index)) AllCA3RegSwitchCheck.disabled = true;
            if (CA2Layer.includes(index)) AllCA2RegSwitchCheck.disabled = true;
            if (CA1Layer.includes(index)) AllCA1RegSwitchCheck.disabled = true;
            if (Sub.includes(index)) AllSubRegSwitchCheck.disabled = true;
            if (LEC.includes(index) || MEC.includes(index)) AllECRegSwitchCheck.disabled = true;
            AllNT.disabled = true;
            RankNT.disabled = true;
            CanonicalNT.disabled = true;
          }
        } else {
          // Remove unchecked checkbox index from the array
          selectedCheckboxByLayer = selectedCheckboxByLayer.filter((i) => i !== index);
          // Check for specific conditions

          if (!DGLayer.some((value) => selectedCheckboxByLayer.includes(value))) AllDGRegSwitchCheck.disabled = false;

          if (!CA3Layer.some((value) => selectedCheckboxByLayer.includes(value))) AllCA3RegSwitchCheck.disabled = false;

          if (!CA2Layer.some((value) => selectedCheckboxByLayer.includes(value))) AllCA2RegSwitchCheck.disabled = false;

          if (!CA1Layer.some((value) => selectedCheckboxByLayer.includes(value))) AllCA1RegSwitchCheck.disabled = false;

          if (!Sub.some((value) => selectedCheckboxByLayer.includes(value))) AllSubRegSwitchCheck.disabled = false;

          if (!(LEC.some((value) => selectedCheckboxByLayer.includes(value)) || MEC.some((value) => selectedCheckboxByLayer.includes(value)))) AllECRegSwitchCheck.disabled = false;

          //unselected checkboxes by layers

          if (index === 0) {
            unselectCheckboxes([50, 57, 61, 63, 65, 66, 67, 77, 79, 82, 84]);
          }
          if (index === 1) {
            unselectCheckboxes([52, 53, 54, 55, 56, 57, 58, 60, 68, 79, 70, 71, 73, 74, 75, 85, 86, 87]);
          }
          if (index === 2) {
            unselectCheckboxes([49, 51, 52, 55, 56, 57, 58, 60, 62, 64, 72, 76, 80, 83, 85, 87, 88]);
          }
          if (index === 3) {
            unselectCheckboxes([51, 55, 57, 58, 59, 60, 61, 62, 63, 64, 65, 72, 76, 77, 78, 79, 81, 82, 83, 84, 85, 87, 88]);
          }
          if (index === 4) {
            unselectCheckboxes([44, 45, 46, 47, 48]);
          }
          if (index === 5) {
            unselectCheckboxes([22, 28, 30, 31, 32, 33, 34, 35, 38, 39]);
          }
          if (index === 6) {
            unselectCheckboxes([29]);
          }
          if (index === 7) {
            unselectCheckboxes([23, 24, 27, 35, 36, 37, 38, 39, 42, 43]);
          }
          if (index === 8) {
            unselectCheckboxes([19, 20, 23, 25, 26, 27, 32, 35, 38, 39]);
          }
          if (index === 9) {
            unselectCheckboxes([21, 22, 34, 38, 39, 40, 41]);
          }
          if (index === 10) {
            unselectCheckboxes([1, 2, 7, 8, 10, 11, 14, 15, 16]);
          }
          if (index === 11) {
            unselectCheckboxes([3, 9, 13, 14, 17]);
          }
          if (index === 12) {
            unselectCheckboxes([14, 17, 18]);
          }
          if (index === 13) {
            unselectCheckboxes([4, 5, 6, 10, 11, 12]);
          }
          if (index === 14) {
            unselectCheckboxes([92, 93]);
          }
          if (index === 15) {
            unselectCheckboxes([92, 93, 97, 115, 117]);
          }
          if (index === 16) {
            unselectCheckboxes([97, 98, 100, 101, 104, 105, 106, 118, 121]);
          }
          if (index === 17) {
            unselectCheckboxes([106, 107, 108]);
          }
          if (index === 18) {
            unselectCheckboxes([106, 107, 108, 111]);
          }
          if (index === 19) {
            unselectCheckboxes([106, 107, 108, 111]);
          }
          if (index === 20) {
            unselectCheckboxes([92, 93]);
          }
          if (index === 21) {
            unselectCheckboxes([92, 93, 94, 95, 96, 97, 115, 116, 117]);
          }
          if (index === 22) {
            unselectCheckboxes([96, 97, 99, 100, 102, 103, 104, 105, 106, 119, 120, 121, 122]);
          }
          if (index === 23) {
            unselectCheckboxes([106, 107, 108]);
          }
          if (index === 24) {
            unselectCheckboxes([106, 107, 108, 109, 110, 111, 112, 113]);
          }
          if (index === 25) {
            unselectCheckboxes([108, 113]);
          }
          if (index === 26) {
            unselectCheckboxes([91]);
          }
          if (index === 27) {
            unselectCheckboxes([89, 90, 91]);
          }

          AllNT.disabled = true;
          RankNT.disabled = true;
          CanonicalNT.disabled = true;

          document.getElementById("Neurons_firing_attributes").style.visibility = "hidden";
          document.getElementById("networkspikes").style.visibility = "hidden";
          removeTable();
        }

        if (selectedCheckboxByLayer.length > 0) {
          if (selectedCheckboxByLayer.includes(0)) {
            selectCheckboxes([50, 57, 61, 63, 65, 66, 67, 77, 79, 82, 84]);
          }
          if (selectedCheckboxByLayer.includes(1)) {
            selectCheckboxes([52, 53, 54, 55, 56, 57, 58, 60, 68, 79, 70, 71, 73, 74, 75, 85, 86, 87]);
          }
          if (selectedCheckboxByLayer.includes(2)) {
            selectCheckboxes([49, 51, 52, 55, 56, 57, 58, 60, 62, 64, 72, 76, 80, 83, 85, 87, 88]);
          }
          if (selectedCheckboxByLayer.includes(3)) {
            selectCheckboxes([51, 55, 57, 58, 59, 60, 61, 62, 63, 64, 65, 72, 76, 77, 78, 79, 81, 82, 83, 84, 85, 87, 88]);
          }
          if (selectedCheckboxByLayer.includes(4)) {
            selectCheckboxes([44, 45, 46, 47, 48]);
          }
          if (selectedCheckboxByLayer.includes(5)) {
            selectCheckboxes([22, 28, 30, 31, 32, 33, 34, 35, 38, 39]);
          }
          if (selectedCheckboxByLayer.includes(6)) {
            selectCheckboxes([29]);
          }
          if (selectedCheckboxByLayer.includes(7)) {
            selectCheckboxes([23, 24, 27, 35, 36, 37, 38, 39, 42, 43]);
          }
          if (selectedCheckboxByLayer.includes(8)) {
            selectCheckboxes([19, 20, 23, 25, 26, 27, 32, 35, 38, 39]);
          }
          if (selectedCheckboxByLayer.includes(9)) {
            selectCheckboxes([21, 22, 34, 38, 39, 40, 41]);
          }
          if (selectedCheckboxByLayer.includes(10)) {
            selectCheckboxes([1, 2, 7, 8, 10, 11, 14, 15, 16]);
          }
          if (selectedCheckboxByLayer.includes(11)) {
            selectCheckboxes([3, 9, 13, 14, 17]);
          }
          if (selectedCheckboxByLayer.includes(12)) {
            selectCheckboxes([14, 17, 18]);
          }
          if (selectedCheckboxByLayer.includes(13)) {
            selectCheckboxes([4, 5, 6, 10, 11, 12]);
          }
          if (selectedCheckboxByLayer.includes(14)) {
            selectCheckboxes([92, 93]);
          }
          if (selectedCheckboxByLayer.includes(15)) {
            selectCheckboxes([92, 93, 97, 115, 117]);
          }
          if (selectedCheckboxByLayer.includes(16)) {
            selectCheckboxes([97, 98, 100, 101, 104, 105, 106, 118, 121]);
          }
          if (selectedCheckboxByLayer.includes(17)) {
            selectCheckboxes([106, 107, 108]);
          }
          if (selectedCheckboxByLayer.includes(18)) {
            selectCheckboxes([106, 107, 108, 111]);
          }
          if (selectedCheckboxByLayer.includes(19)) {
            selectCheckboxes([108, 114]);
          }
          if (selectedCheckboxByLayer.includes(20)) {
            selectCheckboxes([92, 93]);
          }
          if (selectedCheckboxByLayer.includes(21)) {
            selectCheckboxes([92, 93, 94, 95, 96, 97, 115, 116, 117]);
          }
          if (selectedCheckboxByLayer.includes(22)) {
            selectCheckboxes([96, 97, 99, 100, 102, 103, 104, 105, 106, 119, 120, 121, 122]);
          }
          if (selectedCheckboxByLayer.includes(23)) {
            selectCheckboxes([106, 107, 108]);
          }
          if (selectedCheckboxByLayer.includes(24)) {
            selectCheckboxes([106, 107, 108, 109, 110, 111, 112, 113]);
          }
          if (selectedCheckboxByLayer.includes(25)) {
            selectCheckboxes([108, 113]);
          }
          if (selectedCheckboxByLayer.includes(26)) {
            selectCheckboxes([91]);
          }
          if (selectedCheckboxByLayer.includes(27)) {
            selectCheckboxes([89, 90, 91]);
          }

          updateSelectedCount(); // Call the function to update the count
          VisualizateNeurons();
        } else {
          AllNT.disabled = false;
          RankNT.disabled = false;
          CanonicalNT.disabled = false;
          selectedCheckboxByLayer = [];
          updateSelectedCount(); // Call the function to update the count
          VisualizateNeurons();
        }
      });
    }
  });

  // Function to select checkboxes by their IDs
  function selectCheckboxes(ids) {
    ids.forEach((id) => {
      const checkbox = document.getElementById(id);
      if (checkbox) {
        checkbox.checked = true;
      }
    });
  }

  // Function to unselect checkboxes by their IDs
  function unselectCheckboxes(ids) {
    ids.forEach((id) => {
      const checkbox = document.getElementById(id);
      if (checkbox) {
        checkbox.checked = false;
        selectedCheckboxByLayer = selectedCheckboxByLayer.filter((i) => i !== id);
      }
    });
  }

  // below code is for individual NT select checkbox
  sections.forEach((section) => {
    const regSelectAllCheckbox = document.getElementById(section.regSelectAllId);

    const selectAllCheckbox = document.getElementById(section.selectAllId);

    if (regSelectAllCheckbox && selectAllCheckbox) {
      const isChecked = regSelectAllCheckbox.checked;
      document.querySelectorAll(section.container + " .form-check-input").forEach((checkbox) => {
        checkbox.checked = isChecked;
      });
      selectAllCheckbox.checked = isChecked;

      getAllCheckboxWithIds(selectAllCheckbox, section.container, section.selectAllId);
    }
    updateSelectedCount(); // Call the function to update the count
  });

  if (SelectAll && SelectAll.checked) {
    const isChecked = SelectAll.checked;
    sections.forEach((section) => {
      document.querySelectorAll(" .form-check-input").forEach((checkbox) => {
        if (checkbox.id !== "UnselectAll") checkbox.checked = isChecked;
      });
      document.getElementById(section.selectAllId).checked = isChecked;
    });

    if (isChecked) {
      AllNT.checked = true;

      // Check all AllRegSwitchCheck checkboxes
      AllDGRegSwitchCheck.checked = true;
      AllCA3RegSwitchCheck.checked = true;
      AllCA2RegSwitchCheck.checked = true;
      AllCA1RegSwitchCheck.checked = true;
      AllSubRegSwitchCheck.checked = true;
      AllECRegSwitchCheck.checked = true;
    }

    // Update the global selectedCheckboxIds array
    updateSelectedCheckboxIds();
    VisualizateNeurons();
    updateSelectedCount(); // Call the function to update the count
  } else if (UnselectAll && UnselectAll.checked) {
    resetSpikeState();
    resetPlaybackConfig();
    resetTimeUI();
    activitySelect.selectedIndex = 0;

    // ✅ Enable all region checkboxes
    AllDGRegSwitchCheck.disabled = false;
    AllCA3RegSwitchCheck.disabled = false;
    AllCA2RegSwitchCheck.disabled = false;
    AllCA1RegSwitchCheck.disabled = false;
    AllSubRegSwitchCheck.disabled = false;
    AllECRegSwitchCheck.disabled = false;

    // ✅ Enable all NT type checkboxes
    AllNT.disabled = false;
    RankNT.disabled = false;
    CanonicalNT.disabled = false;

    // ✅ Enable all layer checkboxes using regionToLayerMapForDisabling
    Object.values(regionToLayerMapForDisabling)
      .flat()
      .forEach((layerId) => {
        const layerCheckbox = document.getElementById(layerId);
        if (layerCheckbox) {
          layerCheckbox.disabled = false;
        }
      });

    sections.forEach((section) => {
      document.querySelectorAll(" .form-check-input").forEach((checkbox) => {
        checkbox.checked = false;
      });
      document.getElementById(section.selectAllId).checked = false;
    });
    const ntid = [];
    for (let i = 1; i <= 122; i++) {
      ntid.push(i);
    }
    selectedCheckboxIds = [];
    unselectCheckboxes(ntid);
    VisualizateNeurons();

    updateSelectedCount(); // Call the function to update the count

    document.getElementById("Neurons_firing_attributes").style.visibility = "hidden";
    document.getElementById("networkspikes").style.visibility = "hidden";
    removeTable();
  } else {
    if (
      (AllDGRegSwitchCheck && AllDGRegSwitchCheck.checked) ||
      (AllCA3RegSwitchCheck && AllCA3RegSwitchCheck.checked) ||
      (AllCA2RegSwitchCheck && AllCA2RegSwitchCheck.checked) ||
      (AllCA1RegSwitchCheck && AllCA1RegSwitchCheck.checked) ||
      (AllSubRegSwitchCheck && AllSubRegSwitchCheck.checked) ||
      (AllECRegSwitchCheck && AllECRegSwitchCheck.checked)
    ) {
      if (
        ((AllDGRegSwitchCheck && AllDGRegSwitchCheck.checked) ||
          (AllCA3RegSwitchCheck && AllCA3RegSwitchCheck.checked) ||
          (AllCA2RegSwitchCheck && AllCA2RegSwitchCheck.checked) ||
          (AllCA1RegSwitchCheck && AllCA1RegSwitchCheck.checked) ||
          (AllSubRegSwitchCheck && AllSubRegSwitchCheck.checked) ||
          (AllECRegSwitchCheck && AllECRegSwitchCheck.checked)) &&
        RankNT.checked
      ) {
        console.log("Region with RankNT checked");

        const isChecked = RankNT.checked;
        // Reset checkboxes under .All_checkbox_container
        const DGCheckboxes = document.querySelectorAll(
          ".DG_checkbox_container .form-check-input, .CA3_checkbox_container .form-check-input, .CA2_checkbox_container .form-check-input, .CA1_checkbox_container .form-check-input, .Sub_checkbox_container .form-check-input, .EC_checkbox_container .form-check-input"
        );
        DGCheckboxes.forEach((checkbox) => {
          checkbox.checked = false;
        });

        sections.forEach((section) => {
          const regSelectAllCheckbox = document.getElementById(section.regSelectAllId);
          if (regSelectAllCheckbox && regSelectAllCheckbox.checked) {
            section.specificCheckboxIds_rank.forEach((id) => {
              const checkbox = document.getElementById(id);
              if (checkbox) {
                checkbox.checked = isChecked;
                // console.log("ID:" + checkbox.id);
              }
            });
          }
        });

        updateSelectedCheckboxIds();
        VisualizateNeurons();
        updateSelectedCount(); // Call the function to update the count
      } else if (
        ((AllDGRegSwitchCheck && AllDGRegSwitchCheck.checked) ||
          (AllCA3RegSwitchCheck && AllCA3RegSwitchCheck.checked) ||
          (AllCA2RegSwitchCheck && AllCA2RegSwitchCheck.checked) ||
          (AllCA1RegSwitchCheck && AllCA1RegSwitchCheck.checked) ||
          (AllSubRegSwitchCheck && AllSubRegSwitchCheck.checked) ||
          (AllECRegSwitchCheck && AllECRegSwitchCheck.checked)) &&
        CanonicalNT.checked
      ) {
        console.log(" Region with CAnonical NT checked");

        const isChecked = CanonicalNT.checked;
        // Reset checkboxes under .All_checkbox_container
        const DGCheckboxes = document.querySelectorAll(
          ".DG_checkbox_container .form-check-input, .CA3_checkbox_container .form-check-input, .CA2_checkbox_container .form-check-input, .CA1_checkbox_container .form-check-input, .Sub_checkbox_container .form-check-input, .EC_checkbox_container .form-check-input"
        );
        DGCheckboxes.forEach((checkbox) => {
          checkbox.checked = false;
        });

        sections.forEach((section) => {
          const regSelectAllCheckbox = document.getElementById(section.regSelectAllId);
          if (regSelectAllCheckbox && regSelectAllCheckbox.checked) {
            section.specificCheckboxIds_canonical.forEach((id) => {
              const checkbox = document.getElementById(id);
              if (checkbox) {
                checkbox.checked = isChecked;
              }
            });
          }
        });

        updateSelectedCheckboxIds();
        VisualizateNeurons();
        updateSelectedCount(); // Call the function to update the count
      } else {
        {
          console.log("Region");
          SelectAll.checked = false;
          UnselectAll.checked = false;

          sections.forEach((section) => {
            const regSelectAllCheckbox = document.getElementById(section.regSelectAllId);
            const selectAllCheckbox = document.getElementById(section.selectAllId);

            if (regSelectAllCheckbox && selectAllCheckbox) {
              const isChecked = regSelectAllCheckbox.checked;
              document.querySelectorAll(section.container + " .form-check-input").forEach((checkbox) => {
                checkbox.checked = isChecked;
              });
              selectAllCheckbox.checked = isChecked;

              if (isChecked) {
                AllNT.checked = true;
              }

              getAllCheckboxWithIds(selectAllCheckbox, section.container, section.selectAllId);
            }
          });
          // Update the global selectedCheckboxIds array
          updateSelectedCheckboxIds();
          VisualizateNeurons();
        }
      }
    } else if (AllNT && AllNT.checked) {
      console.log("All NT checked");
      {
        console.log("AllNT");
        const isChecked = AllNT.checked;
        sections.forEach((section) => {
          document.querySelectorAll(section.container + " .form-check-input").forEach((checkbox) => {
            checkbox.checked = isChecked;
          });
          document.getElementById(section.selectAllId).checked = isChecked;
        });

        // Update the global selectedCheckboxIds array
        updateSelectedCheckboxIds();
        VisualizateNeurons();
        updateSelectedCount(); // Call the function to update the count
      }
    } else if (RankNT && RankNT.checked) {
      console.log("Rank NT checked");
      {
        AllNT.checked = false;
        console.log("Rank NT");
        const specificDGCheckboxIds = [1, 3, 4, 7, 8, 9, 10, 11, 17, 19, 20, 23, 25, 26, 27, 28, 31, 33, 34, 36, 40, 43, 44, 45, 47, 49, 52, 53, 54, 55, 57, 58, 60, 63, 66, 67, 68, 69, 74, 77, 79, 82, 84, 86, 87, 90, 91, 93, 95, 97, 100, 104, 106, 107, 108, 111, 115, 117, 121, 122];
        const isChecked = RankNT.checked;

        document.querySelectorAll(".form-check-input").forEach((checkbox) => {
          checkbox.checked = false;
        });

        specificDGCheckboxIds.forEach((id) => {
          const checkbox = document.getElementById(id);
          if (checkbox) {
            checkbox.checked = isChecked;
          }
        });
        RankNT.checked = isChecked;
        // Update the global selectedCheckboxIds array
        updateSelectedCheckboxIds();
        VisualizateNeurons();
        updateSelectedCount(); // Call the function to update the count
      }
    } else if (CanonicalNT && CanonicalNT.checked) {
      console.log("Canonical NT checked");
      {
        console.log("Canonical NT");
        const specificDGCheckboxIds = [1, 19, 49, 95];
        const isChecked = CanonicalNT.checked;

        document.querySelectorAll(".form-check-input").forEach((checkbox) => {
          checkbox.checked = false;
        });

        specificDGCheckboxIds.forEach((id) => {
          const checkbox = document.getElementById(id);
          if (checkbox) {
            checkbox.checked = isChecked;
          }
        });
        CanonicalNT.checked = isChecked;
        updateSelectedCheckboxIds();
        VisualizateNeurons();
        updateSelectedCount(); // Call the function to update the count
      }
    }
  }
}

document.addEventListener("DOMContentLoaded", function () {
  const SelectAll = document.getElementById("SelectAll");
  const UnselectAll = document.getElementById("UnselectAll");

  const AllDGRegSwitchCheck = document.getElementById("AllDGRegSwitchCheck");
  const AllCA3RegSwitchCheck = document.getElementById("AllCA3RegSwitchCheck");
  const AllCA2RegSwitchCheck = document.getElementById("AllCA2RegSwitchCheck");
  const AllCA1RegSwitchCheck = document.getElementById("AllCA1RegSwitchCheck");
  const AllSubRegSwitchCheck = document.getElementById("AllSubRegSwitchCheck");
  const AllECRegSwitchCheck = document.getElementById("AllECRegSwitchCheck");

  const AllNT = document.getElementById("AllNT");
  const RankNT = document.getElementById("RankNT");
  const CanonicalNT = document.getElementById("CanonicalNT");

  SelectAll.addEventListener("change", SelectAllByRegion);
  UnselectAll.addEventListener("change", SelectAllByRegion);

  AllDGRegSwitchCheck.addEventListener("change", SelectAllByRegion);
  AllCA3RegSwitchCheck.addEventListener("change", SelectAllByRegion);
  AllCA2RegSwitchCheck.addEventListener("change", SelectAllByRegion);
  AllCA1RegSwitchCheck.addEventListener("change", SelectAllByRegion);
  AllSubRegSwitchCheck.addEventListener("change", SelectAllByRegion);
  AllECRegSwitchCheck.addEventListener("change", SelectAllByRegion);

  AllNT.addEventListener("change", SelectAllByRegion);
  RankNT.addEventListener("change", SelectAllByRegion);
  CanonicalNT.addEventListener("change", SelectAllByRegion);

  SelectAllByRegion();
});

function getAllCheckboxWithIds(selectAllCheckbox, checkbox_container, notSelectCheckboxId) {
  if (!selectAllCheckbox) return;

  // Event listener for "Select All" checkbox
  selectAllCheckbox.addEventListener("change", function () {
    const isChecked = selectAllCheckbox.checked;
    const allCheckboxes = document.querySelectorAll(checkbox_container + " .form-check-input");

    allCheckboxes.forEach((checkbox) => {
      checkbox.checked = isChecked;
    });

    // Update the global selectedCheckboxIds array
    updateSelectedCheckboxIds();
    VisualizateNeurons();
    checkAllNTStatus();
    updateSelectedCount(); // Call the function to update the count
  });

  // Event listener for individual checkboxes
  const individualCheckboxes = document.querySelectorAll(checkbox_container + " .form-check-input:not(#" + notSelectCheckboxId + ")");
  individualCheckboxes.forEach((checkbox) => {
    checkbox.addEventListener("change", function () {
      // Update the global selectedCheckboxIds array
      updateSelectedCheckboxIds();
      VisualizateNeurons();
      checkAllNTStatus();
      updateSelectedCount(); // Call the function to update the count
    });
  });
}

function updateSelectedCount() {
  const totalCheckboxesDG = document.querySelectorAll(".DG_checkbox_container .form-check-input:not(#AllDGSwitchCheck)").length;
  const selectedCheckboxesDG = document.querySelectorAll(".DG_checkbox_container .form-check-input:checked:not(#AllDGSwitchCheck)").length;
  const buttonDG = document.getElementById("btnDG");
  buttonDG.textContent = `DG Neuron Types (${selectedCheckboxesDG}/${totalCheckboxesDG})`;

  //   CA3
  const totalCheckboxesCA3 = document.querySelectorAll(".CA3_checkbox_container .form-check-input:not(#AllCA3SwitchCheck)").length;
  const selectedCheckboxesCA3 = document.querySelectorAll(".CA3_checkbox_container .form-check-input:checked:not(#AllCA3SwitchCheck)").length;
  const buttonCA3 = document.getElementById("btnCA3");
  buttonCA3.textContent = `CA3 Neuron Types (${selectedCheckboxesCA3}/${totalCheckboxesCA3})`;

  //   CA2
  const totalCheckboxesCA2 = document.querySelectorAll(".CA2_checkbox_container .form-check-input:not(#AllCA2SwitchCheck)").length;
  const selectedCheckboxesCA2 = document.querySelectorAll(".CA2_checkbox_container .form-check-input:checked:not(#AllCA2SwitchCheck)").length;
  const buttonCA2 = document.getElementById("btnCA2");
  buttonCA2.textContent = `CA2 Neuron Types (${selectedCheckboxesCA2}/${totalCheckboxesCA2})`;

  //   CA1
  const totalCheckboxesCA1 = document.querySelectorAll(".CA1_checkbox_container .form-check-input:not(#AllCA1SwitchCheck)").length;
  const selectedCheckboxesCA1 = document.querySelectorAll(".CA1_checkbox_container .form-check-input:checked:not(#AllCA1SwitchCheck)").length;
  const buttonCA1 = document.getElementById("btnCA1");
  buttonCA1.textContent = `CA1 Neuron Types (${selectedCheckboxesCA1}/${totalCheckboxesCA1})`;

  //   Sub
  const totalCheckboxesSub = document.querySelectorAll(".Sub_checkbox_container .form-check-input:not(#AllSubSwitchCheck)").length;
  const selectedCheckboxesSub = document.querySelectorAll(".Sub_checkbox_container .form-check-input:checked:not(#AllSubSwitchCheck)").length;
  const buttonSub = document.getElementById("btnSub");
  buttonSub.textContent = `Subiculum (Sub) Neuron Types (${selectedCheckboxesSub}/${totalCheckboxesSub})`;

  //   EC
  const totalCheckboxesEC = document.querySelectorAll(".EC_checkbox_container .form-check-input:not(#AllECSwitchCheck)").length;
  const selectedCheckboxesEC = document.querySelectorAll(".EC_checkbox_container .form-check-input:checked:not(#AllECSwitchCheck)").length;
  const buttonEC = document.getElementById("btnEC");
  buttonEC.textContent = `Entrohinal Cortex (EC) Neuron Types (${selectedCheckboxesEC}/${totalCheckboxesEC})`;
}

function updateSelectedCheckboxIds() {
  const allCheckboxes = document.querySelectorAll(".form-check-input");

  // Clear the global array before updating
  selectedCheckboxIds = [];

  allCheckboxes.forEach((checkbox) => {
    if (checkbox.checked && !checkbox.id.startsWith("All")) {
      selectedCheckboxIds.push(checkbox.id);
      //   console.log("ids: " + checkbox.id);
    }
  });

  //console.log("Selected Checkbox IDs:", selectedCheckboxIds);
}

function checkAllNTStatus() {
  const allNTCheckbox = document.getElementById("AllNT");
  const anyChecked = Array.from(
    document.querySelectorAll(".DG_checkbox_container .form-check-input, .CA3_checkbox_container .form-check-input, .CA2_checkbox_container .form-check-input, .CA1_checkbox_container .form-check-input, .Sub_checkbox_container .form-check-input, .EC_checkbox_container .form-check-input")
  ).some((checkbox) => checkbox.checked);

  allNTCheckbox.checked = anyChecked;
}

function disableAllElements() {
  document.getElementById("colorPickerDG").disabled = true;
  document.getElementById("colorPickerCA3").disabled = true;
  document.getElementById("colorPickerCA2").disabled = true;
  document.getElementById("colorPickerCA1").disabled = true;
  document.getElementById("colorPickerSub").disabled = true;
  document.getElementById("colorPickerEC").disabled = true;
  const elementsToDisable = [
    document.getElementById("SelectAll"),
    document.getElementById("UnselectAll"),
    document.getElementById("AllDGRegSwitchCheck"),
    document.getElementById("AllCA3RegSwitchCheck"),
    document.getElementById("AllCA2RegSwitchCheck"),
    document.getElementById("AllCA1RegSwitchCheck"),
    document.getElementById("AllSubRegSwitchCheck"),
    document.getElementById("AllECRegSwitchCheck"),
    document.getElementById("AllNT"),
    document.getElementById("RankNT"),
    document.getElementById("CanonicalNT"),
  ];

  elementsToDisable.forEach((element) => {
    if (element) {
      element.disabled = true;
    }
  });

  // Disable all checkboxes in the sections
  document.querySelectorAll(".form-check-input").forEach((checkbox) => {
    checkbox.disabled = true;
  });
}

function enableAllElements() {
  document.getElementById("colorPickerDG").disabled = false;
  document.getElementById("colorPickerCA3").disabled = false;
  document.getElementById("colorPickerCA2").disabled = false;
  document.getElementById("colorPickerCA1").disabled = false;
  document.getElementById("colorPickerSub").disabled = false;
  document.getElementById("colorPickerEC").disabled = false;
  const elementsToDisable = [
    document.getElementById("SelectAll"),
    document.getElementById("UnselectAll"),
    document.getElementById("AllDGRegSwitchCheck"),
    document.getElementById("AllCA3RegSwitchCheck"),
    document.getElementById("AllCA2RegSwitchCheck"),
    document.getElementById("AllCA1RegSwitchCheck"),
    document.getElementById("AllSubRegSwitchCheck"),
    document.getElementById("AllECRegSwitchCheck"),
    document.getElementById("AllNT"),
    document.getElementById("RankNT"),
    document.getElementById("CanonicalNT"),
  ];

  elementsToDisable.forEach((element) => {
    if (element) {
      element.disabled = false;
    }
  });

  // Disable all checkboxes in the sections
  document.querySelectorAll(".form-check-input").forEach((checkbox) => {
    checkbox.disabled = false;
  });
}

function getTimestampDirectory() {
  const now = new Date();
  const pad = (n) => n.toString().padStart(2, "0");
  const ms = now.getMilliseconds().toString().padStart(3, "0");

  return "NCV_" + now.getFullYear() + pad(now.getMonth() + 1) + pad(now.getDate()) + pad(now.getHours()) + pad(now.getMinutes()) + pad(now.getSeconds()) + +ms;
}

document.addEventListener("DOMContentLoaded", function () {
  const playbackcontainer = document.getElementById("playbackcontainer");
  const btnOpen = document.getElementById("btnopen");

  btnOpen.addEventListener("click", function () {
    playbackcontainer.style.display = "block"; // ✅ make it visible
  });
});

function clearScene() {
  if (particles) {
    scene.remove(particles);

    if (particles.geometry) particles.geometry.dispose();

    if (particles.material) {
      if (Array.isArray(particles.material)) {
        particles.material.forEach((mat) => mat.dispose());
      } else {
        particles.material.dispose();
      }
    }

    particles = null;
  }

  // ✅ Clear all global arrays and counters
  positions = [];
  sizes = [];
  gIDs = [];
  vertexColors = [];
  neuron_class = [];
  NetworkArray = []; // ✅ VERY IMPORTANT!
  totalParticles = 0; // ✅ Reset particle count
  total_neurons = 0; // ✅ If you're displaying this anywhere

  // UI resets
  document.getElementById("lblnetwork").innerText = "# neurons :";

  document.getElementById("Neurons_firing_attributes").style.visibility = "hidden";
  document.getElementById("networkspikes").style.visibility = "hidden";
  removeTable();
  startBtn.style.display = "none";
  //   chkpanle = false;
}

window.addEventListener("resize", () => {
  const width = canvas.clientWidth;
  const height = canvas.clientHeight;
  camera.aspect = width / height;
  camera.updateProjectionMatrix();
  renderer.setSize(width, height, false);
});

function centerCameraToObject(object) {
  const box = new THREE.Box3().setFromObject(object);

  if (box.isEmpty()) {
    console.warn("Bounding box is empty. Cannot center camera.");
    return;
  }

  const center = new THREE.Vector3();
  box.getCenter(center);

  const size = box.getSize(new THREE.Vector3());
  const maxDim = Math.max(size.x, size.y, size.z);

  const fov = camera.fov * (Math.PI / 270);
  const distance = maxDim / (2 * Math.tan(fov / 2));

  // Use current view direction from camera to controls target
  const viewDir = new THREE.Vector3();
  viewDir.subVectors(camera.position, controls.target).normalize();

  const newPosition = center.clone().add(viewDir.multiplyScalar(distance * 1.2));
  camera.position.copy(newPosition);
  camera.lookAt(center);
  camera.updateProjectionMatrix();

  if (controls) {
    controls.target.copy(center);
    controls.update();
  }
}

function resetAndDisableAllCheckboxes() {
  const allCheckboxes = document.querySelectorAll(".form-check-input");

  allCheckboxes.forEach((checkbox) => {
    checkbox.checked = false;
    checkbox.disabled = true;
  });

  // Also reset special category selectors
  const specialSelectors = ["AllNT", "RankNT", "CanonicalNT", "SelectAll", "UnselectAll"];
  specialSelectors.forEach((id) => {
    const el = document.getElementById(id);
    if (el) {
      el.checked = false;
      el.disabled = true;
    }
  });

  // Reset selected ids
  selectedCheckboxIds = [];
  selectedCheckboxByLayer = [];

  // Optional: Hide UI or refresh scene
  updateSelectedCount();

  document.getElementById("Neurons_firing_attributes").style.visibility = "hidden";
  document.getElementById("networkspikes").style.visibility = "hidden";
  removeTable();
}

function updateSliderTrack(slider, value) {
  const min = parseFloat(slider.min);
  const max = parseFloat(slider.max);
  const val = value !== undefined ? parseFloat(value) : parseFloat(slider.value);
  const pct = ((val - min) / (max - min)) * 100;
  slider.style.background = `linear-gradient(to right, #2a6b38 0%, #2a6b38 ${pct}%, #2b2727 ${pct}%, #2b2727 100%)`;
}

function setupPlaybackConfigListeners() {
  const simSlider = document.getElementById("simTimestepRange");
  const simInput = document.getElementById("simTimestepValue");
  const stepSlider = document.getElementById("stepDurationRange");
  const stepInput = document.getElementById("stepDurationValue");

  // Sync simTimestep
  simSlider.addEventListener("input", () => {
    simInput.value = simSlider.value;
    playbackConfig.simTimestep = parseFloat(simSlider.value);
    updateSliderTrack(simSlider);
  });

  simInput.addEventListener("input", () => {
    const val = parseFloat(simInput.value);
    if (!isNaN(val)) {
      simSlider.value = val;
      playbackConfig.simTimestep = val;
      updateSliderTrack(simSlider, val); // ✅ explicitly pass typed value
    }
  });

  stepSlider.addEventListener("input", () => {
    stepInput.value = stepSlider.value;
    playbackConfig.stepDuration = parseInt(stepSlider.value);
    updateSliderTrack(stepSlider);

    // ✅ Restart animation with new stepDuration
    if (interval) {
      clearInterval(interval);
      startAnimation(count, lasttime);
    }
  });

  stepInput.addEventListener("input", () => {
    const val = parseInt(stepInput.value);
    if (!isNaN(val)) {
      stepSlider.value = val;
      playbackConfig.stepDuration = val;
      updateSliderTrack(stepSlider, val);

      // ✅ Restart animation with new stepDuration
      if (interval) {
        clearInterval(interval);
        startAnimation(count, lasttime);
      }
    }
  });

  // Initial visual update
  updateSliderTrack(simSlider);
  updateSliderTrack(stepSlider);
}

window.addEventListener("DOMContentLoaded", setupPlaybackConfigListeners);

function resetPlaybackConfig() {
  // Set default values
  const defaultSimTimestep = 0.1;
  const defaultStepDuration = 0;

  // Update config
  playbackConfig.simTimestep = defaultSimTimestep;
  playbackConfig.stepDuration = defaultStepDuration;

  // Get elements
  const simSlider = document.getElementById("simTimestepRange");
  const simInput = document.getElementById("simTimestepValue");
  const stepSlider = document.getElementById("stepDurationRange");
  const stepInput = document.getElementById("stepDurationValue");

  // Set UI values
  simSlider.value = defaultSimTimestep;
  simInput.value = defaultSimTimestep;
  stepSlider.value = defaultStepDuration;
  stepInput.value = defaultStepDuration;

  // Update visual fill
  updateSliderTrack(simSlider, defaultSimTimestep);
  updateSliderTrack(stepSlider, defaultStepDuration);
}

function resetCamera() {
  camera.position.set(90, 354, 1450); // Restore initial z position
  camera.up.set(0, 1, 0); // Reset up direction
  camera.lookAt(0, 0, 0); // Look at the origin or center point

  document.getElementById("panel").style.display = "none";
  document.getElementById("playbackcontainer").style.display = "none";
  document.getElementById("histogramImage").style.display = "none";
  if (controls) {
    controls.reset(); // Reset TrackballControls
    controls.update();
  }
}
function resetTimeUI() {
  // Reset visible time display
  document.getElementById("current-time").textContent = "0.0";
  document.getElementById("total-time").textContent = "0.0";

  // Reset timebar slider
  const timebar = document.getElementById("timebar");

  timebar.min = 0;
  timebar.max = 100; // You can change this dynamically after loading new data
  timebar.value = 0;

  // Reset start/end time inputs
  document.getElementById("start-time").value = "";
  document.getElementById("end-time").value = "";
}

function hexToNormalizedRGB(hex) {
  const bigint = parseInt(hex.replace("#", ""), 16);
  const r = ((bigint >> 16) & 255) / 255;
  const g = ((bigint >> 8) & 255) / 255;
  const b = (bigint & 255) / 255;
  return [r, g, b];
}

function startRecording(mainCanvas, hudCanvas) {
  combinedCanvas = document.createElement("canvas");
  combinedCanvas.width = mainCanvas.width;
  combinedCanvas.height = mainCanvas.height;
  combinedCtx = combinedCanvas.getContext("2d");

  const fps = 60;
  const stream = combinedCanvas.captureStream(fps);

  let options = { mimeType: "video/webm;codecs=vp9", videoBitsPerSecond: 30_000_000 };

  if (!MediaRecorder.isTypeSupported(options.mimeType)) {
    console.warn("VP9 not supported, trying VP8...");
    options.mimeType = "video/webm;codecs=vp8";
  }

  if (!MediaRecorder.isTypeSupported(options.mimeType)) {
    console.warn("VP8 not supported, falling back to default...");
    delete options.mimeType; // let browser choose
  }

  mediaRecorder = new MediaRecorder(stream, options);

  recordedChunks = [];

  mediaRecorder.ondataavailable = (e) => {
    if (e.data.size > 0) recordedChunks.push(e.data);
  };

  mediaRecorder.onstop = () => {
    const blob = new Blob(recordedChunks, { type: "video/webm" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = "neuron_visualization.webm";
    a.click();
    URL.revokeObjectURL(url);
  };

  let lastTime = 0;
  function drawFrame(time) {
    if (mediaRecorder.state === "recording") {
      if (time - lastTime >= 1000 / fps) {
        combinedCtx.clearRect(0, 0, combinedCanvas.width, combinedCanvas.height);
        combinedCtx.drawImage(mainCanvas, 0, 0);
        combinedCtx.drawImage(hudCanvas, 0, 0);
        lastTime = time;
      }
      requestAnimationFrame(drawFrame);
    }
  }

  mediaRecorder.start();
  requestAnimationFrame(drawFrame);
}

function stopRecording() {
  if (mediaRecorder && mediaRecorder.state !== "inactive") {
    mediaRecorder.stop();
  }
}

startBtn.addEventListener("click", () => {
  startRecording(canvas, hudCanvas);
  document.getElementById("rec-indicator").style.display = "block"; // on start
  startBtn.style.display = "none";
  stopBtn.style.display = "inline-block";
});

stopBtn.addEventListener("click", () => {
  stopRecording();
  document.getElementById("rec-indicator").style.display = "none";

  stopBtn.style.display = "none";
  startBtn.style.display = "inline-block";
});

function initRaycaster() {
  if (!raycaster) {
    raycaster = new THREE.Raycaster();
  }
  raycaster.params.Points.threshold = 3;

  if (particles && particles.geometry) {
    particles.geometry.computeBoundingSphere();
    particles.geometry.computeBoundingBox();
  }
}

function onPointerMove(event) {
  // Check if particles exist and are in the scene
  if (!particles || !scene.children.includes(particles)) {
    hidePopup();
    return;
  }

  // Get pointer position relative to canvas
  const rect = renderer.domElement.getBoundingClientRect();
  pointer.x = ((event.clientX - rect.left) / rect.width) * 2 - 1;
  pointer.y = -((event.clientY - rect.top) / rect.height) * 2 + 1;

  // Update raycaster only if particles exist
  raycaster.setFromCamera(pointer, camera);

  try {
    const intersects = raycaster.intersectObject(particles);

    // Reset previous hover
    if (hoveredIndex !== -1) {
      resetParticleAppearance(hoveredIndex);
      hoveredIndex = -1;
    }

    // Process new hover
    if (intersects.length > 0) {
      const intersection = intersects[0];
      hoveredIndex = intersection.index;
      highlightParticle(hoveredIndex);
      //   enlargeParticle(hoveredIndex, 1.3);
      showNeuronInfo(intersection, event);
    } else if (popupVisible) {
      //   checkMouseLeave(event);
      if (!popupHideTimer) {
        popupHideTimer = setTimeout(hidePopup, POPUP_HIDE_DELAY);
      }
    }
  } catch (error) {
    console.error("Raycasting error:", error);
    hidePopup();
  }
}

function initPopupSystem() {
  document.addEventListener("pointermove", onPointerMove);
  // Add mouse leave check for when pointer leaves window
  document.addEventListener("mouseout", (e) => {
    if (!e.relatedTarget && popupVisible) {
      hidePopup();
    }
  });
}

function highlightParticle(index) {
  const colorAttribute = geometry.attributes.color;
  const colors = colorAttribute.array;

  // Initialize if not exists
  if (!originalColors[index]) {
    originalColors[index] = {
      r: colors[index * 3],
      g: colors[index * 3 + 1],
      b: colors[index * 3 + 2],
      isFiring: false,
      isWhite: false,
    };
  }

  // Detect current state
  const isYellow = colors[index * 3] === 1 && colors[index * 3 + 1] === 1 && colors[index * 3 + 2] === 0;
  const isWhite = colors[index * 3] === 1 && colors[index * 3 + 1] === 1 && colors[index * 3 + 2] === 1;

  // Update state tracking
  originalColors[index].isFiring = isYellow;
  originalColors[index].isWhite = isWhite;

  // Apply hover color (bright cyan)
  colors[index * 3] = hoverColor.r;
  colors[index * 3 + 1] = hoverColor.g;
  colors[index * 3 + 2] = hoverColor.b;

  colorAttribute.needsUpdate = true;
}

function resetParticleAppearance(index) {
  const colorAttribute = geometry.attributes.color;
  const colors = colorAttribute.array;

  if (!originalColors[index]) return;

  // Restore to appropriate state
  if (originalColors[index].isFiring) {
    // Return to yellow if was firing
    colors[index * 3] = 1; // R
    colors[index * 3 + 1] = 1; // G
    colors[index * 3 + 2] = 0; // B (yellow)
  } else if (originalColors[index].isWhite) {
    // Return to white if was white
    colors[index * 3] = 1; // R
    colors[index * 3 + 1] = 1; // G
    colors[index * 3 + 2] = 1; // B (white)
  } else {
    // Return to original color otherwise
    colors[index * 3] = originalColors[index].r;
    colors[index * 3 + 1] = originalColors[index].g;
    colors[index * 3 + 2] = originalColors[index].b;
  }

  colorAttribute.needsUpdate = true;
}

// In your initialization:
function initOriginalColors() {
  const colors = geometry.attributes.color.array;
  originalColors = new Array(colors.length / 3);

  for (let i = 0; i < originalColors.length; i++) {
    const index = i * 3;
    originalColors[i] = {
      r: colors[index],
      g: colors[index + 1],
      b: colors[index + 2],
      isFiring: false,
      isWhite: colors[index] === 1 && colors[index + 1] === 1 && colors[index + 2] === 1,
    };
  }
}
function showNeuronInfo(intersection, event) {
  if (!intersection || !event || !particles) return;

  // Clear any pending hide timer
  if (popupHideTimer) {
    clearTimeout(popupHideTimer);
    popupHideTimer = null;
  }

  const popup = document.getElementById("neuron-popup");
  const gid = particles.geometry.attributes.gid.getX(intersection.index);
  const position = intersection.point;

  // Update values
  document.getElementById("neuron-gid").textContent = gid;
  document.getElementById("neuron-x").textContent = position.x.toFixed(2);
  document.getElementById("neuron-y").textContent = position.y.toFixed(2);
  document.getElementById("neuron-z").textContent = position.z.toFixed(2);

  // Show popup if not already visible
  if (!popupVisible) {
    popup.style.display = "block";
    popup.style.opacity = "1";
    popupVisible = true;
  }
}

function hidePopup() {
  if (!popupVisible) return;

  const popup = document.getElementById("neuron-popup");

  // Start hide animation
  popup.style.opacity = "0";

  // Completely hide after animation completes
  setTimeout(() => {
    popup.style.display = "none";
    popupVisible = false;
  }, 900); // Must match CSS transition duration
}

document.getElementById("neuron-popup").addEventListener("mouseenter", () => {
  if (popupHideTimer) {
    clearTimeout(popupHideTimer);
    popupHideTimer = null;
  }
});

document.getElementById("neuron-popup").addEventListener("mouseleave", () => {
  if (popupVisible) {
    popupHideTimer = setTimeout(hidePopup, POPUP_HIDE_DELAY);
  }
});

CreateScene();
initPopupSystem();
disableAllElements();
//createArrowOverlay();

let raycaster = new THREE.Raycaster();
let hoveredIndex = -1;
let pointer = new THREE.Vector2();
let hoverColor = new THREE.Color(0, 1, 1); // Bright Cyan for hover
let originalColors = [];
let originalSizes = [];

// Add these variables at the top of your file
let popupVisible = false;
let popupHideTimer = null;
const POPUP_HIDE_DELAY = 900; // milliseconds
