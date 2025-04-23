import * as THREE from "three";
import { TrackballControls } from 'three/addons/controls/TrackballControls.js';
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
  SphereSize: 20,
  FiringSphereSize: 100,
};
let pt = 2;
let colorsArray;
let vertexColors = [];
let particles;
const scalingFactor = 0.1;
let r = 0;
// Playback config object
let playbackConfig = {
  simTimestep: 0.1, // ms per simulation step
  stepDuration: 0, // ms per animation frame
};
let dgRGB = [0.0, 0.0, 1.0];
let ca3RGB = [0.0, 0.0, 1.0];
let ca2RGB = [0.0, 0.0, 1.0];
let ca1RGB = [0.0, 0.0, 1.0];
let subRGB = [0.0, 0.0, 1.0];
let ecRGB = [0.0, 0.0, 1.0];
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
const isLocal = window.location.hostname === "127.0.0.1" || window.location.hostname === "localhost";
const baseURL = isLocal ? "https://127.0.0.1:8000" : "https://hcv.ebrains-italy.eu";
const texturePath = isLocal ? "./img/disc.png" : "/static/img/disc.png";
const dropdown = document.getElementById("ddactivity_chunks");
const txttimefrom = document.getElementById("txttimefrom");
const txttimeto = document.getElementById("txttimeto");
const networkFileInput = document.getElementById("networkFileInput");
const hdfFileInput = document.getElementById("activityFileInput");
var ca1RegDiv = document.getElementById("ca1-reg");
activitySelect.addEventListener("change", loadActivity);
document.getElementById("activitySelect").disabled = true;
HumanactivitySelect.addEventListener("change", loadHumanActivity);

async function loadActivity() {
  const selectedValue = activitySelect.value;

  if (selectedValue === "1" || selectedValue === "2") {
    await LoadActivityData(selectedValue);
  }
}

async function LoadActivityData(file_id) {
  try {
    document.getElementById("page-loader").style.display = "block";
    document.getElementById("progress-percentage").innerText = "0%";
    document.getElementById("msgprogress").innerText = "Loading activity data...";

    const formData = new FormData();

    if (geometry && geometry.attributes.gid.array.length > 0) {
      const gIDs = Array.from(geometry.attributes.gid.array); // Convert to array
      formData.append("gIDs", JSON.stringify(gIDs)); // Send gIDs as JSON string
    } else {
      alert("Please select the Network data to visualize.");
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
      //   console.log("gids activity indexes: ", gids_activity_indexes);

      document.getElementById("lblspikes").innerText = "Spikes: " + number_of_spikes;

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
  }
}

async function LoadHumanActivityData(file_id) {
  try {
    document.getElementById("page-loader").style.display = "block";
    document.getElementById("progress-percentage").innerText = "0%";
    document.getElementById("msgprogress").innerText = "Loading Human activity data...";

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

      document.getElementById("lblspikes").innerText = "Spikes: " + number_of_spikes;

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
        spikeNeuronSize = 300;
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
    clearScene();
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
      //   console.log("filename: " + JSON.stringify(file.filename));

      //ca3toca1connections = data.connections;
      //console.log(ca3toca1connections);
    };

    // Process each file sequentially
    for (let i = 0; i < totalFiles; i++) {
      await processFile(files[i], i);
    }

    document.getElementById("page-loader").style.display = "none";

    document.getElementById("activitySelect").disabled = false;
  } catch (error) {
    console.error("Error fetching data:", error);
    document.getElementById("page-loader").style.display = "none";
  }
}

async function LoadHumanHipForm() {
  try {
    clearScene();
    const response = await fetch(`${baseURL}/api/LoadHumanHipForm/`);
    const data = await response.json();

    const fileData = data.fileData;
    NetworkArray.push(fileData);
    total_neurons = data.total_neurons;

    document.getElementById("page-loader").style.display = "none";
    flag = true;
    VisualizateNeurons();
    document.getElementById("HumanactivitySelect").disabled = false;
  } catch (error) {
    console.error("Error fetching data:", error);
    document.getElementById("page-loader").style.display = "none";
  }
}

async function fetchConnections() {
  let page = 1;
  let hasMore = true;

  try {
    while (hasMore) {
      const response = await fetch(`${baseURL}/api/fetchConnections/?page=${page}&chunk_size=1000`);
      const jsonData = await response.json();

      if (jsonData && jsonData.connections_chunk) {
        Object.assign(ca3toca1connections, jsonData.connections_chunk);
        // console.log(
        //   `Received chunk for page ${page}:`,
        //   jsonData.connections_chunk
        // );
        hasMore = jsonData.has_more;
        page++;
      } else {
        console.log("No more data to fetch.");
        hasMore = false;
      }
    }

    // console.log("All connections loaded:", ca3toca1connections);
    isConnection = true;
    document.getElementById("page-loader").style.display = "none";
  } catch (error) {
    console.error("Error fetching data:", error);
    document.getElementById("page-loader").style.display = "none";
  }
}

const uniqueDirectory = getTimestampDirectory(); // generate once per session

networkFileInput.addEventListener("change", async (event) => {
  const files = event.target.files;
  if (files.length > 0) {
    try {
      const chunkSize = 10 * 1024 * 1024; // 10 MB
      const uploadPromises = [];

      document.getElementById("progress-percentage").innerText = "0%";
      document.getElementById("page-loader").style.display = "block";
      document.getElementById("msgprogress").innerText = "Uploading your file, please wait...";

      for (const file of files) {
        const fileType = file.name.split(".").pop().toLowerCase(); // Detect file type (csv or hdf5)
        const totalChunks = Math.ceil(file.size / chunkSize);
        let uploadedChunks = 0;

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
              uploadedChunks++;
              const progress = Math.round((uploadedChunks / totalChunks) * 100);
              document.getElementById("progress-percentage").innerText = `${progress}%`;
            })
          );
        }
      }

      await Promise.all(uploadPromises);

      document.getElementById("progress-percentage").innerText = "99%";
      document.getElementById("msgprogress").innerText = "Processing your data for visualizing Circuit, please wait...";

      const response = await fetch(`${baseURL}/api/fetch_user_network_data/?dir=${uniqueDirectory}`);
      const data = await response.json();

      if (data.files.length > 0) {
        document.getElementById("progress-percentage").innerText = "100%";
        document.getElementById("typeHeading").style.visibility = "visible";

        vertexColors = [];
        NetworkArray = [];
        data.files.forEach((file) => {
          NetworkArray.push(file.fileData);
          total_neurons += file.total_neuros;
        });

        if (total_neurons > 1000000) spikeNeuronSize = 70; // set spike neuron size

        flag = true;
        VisualizateNeurons();

        if (parseInt(data.flag_check) == 1) {
          document.getElementById("lblspikes").innerText = "Spikes :" + data.lstresponse.total_lines;

          total_activity_files = data.lstresponse.total_activity_files;
          firstLastKeys = data.lstresponse.first_last_keys;

          // Ensure chunk_mfr_list exists
          if (!data.lstresponse.chunk_mfr_list || data.lstresponse.chunk_mfr_list.length === 0) {
            return;
          }

          const dropdown = document.getElementById("ddactivity_chunks");
          dropdown.innerHTML = ""; // Clear previous options

          const defaultOption = document.createElement("option");
          defaultOption.textContent = "Select Activity Chunk";

          dropdown.appendChild(defaultOption);

          data.lstresponse.chunk_mfr_list.forEach((chunk) => {
            const option = document.createElement("option");
            option.value = chunk.chunk_number;

            // Convert chunk number to string and apply padding
            const chunkNum = String(chunk.chunk_number);
            const timeRange = `[${chunk.first_key} - ${chunk.last_key}]ms`;
            const mfr = `MFR: ${chunk.MFR} Hz`;

            // Properly spaced columns using Unicode spaces (\u2003)
            option.textContent = `Chunk ${chunkNum}\u2003 ${timeRange}\u2003 \u2003 ${mfr}`;

            dropdown.appendChild(option);
          });
        } else {
          console.log("not available data...");
        }
      } else {
        console.log("No files found in the response.");
      }
    } catch (error) {
      console.error("Error:", error);
      alert("An error occurred. Please try again.");
    } finally {
      document.getElementById("page-loader").style.display = "none";
      networkFileInput.value = "";
    }
  }
});

hdfFileInput.addEventListener("change", async (event) => {
  const files = event.target.files;
  if (files.length > 0) {
    try {
      const chunkSize = 10 * 1024 * 1024; // 10 MB
      const uploadPromises = [];

      document.getElementById("progress-percentage").innerText = "0%";
      document.getElementById("page-loader").style.display = "block";
      document.getElementById("msgprogress").innerText = "Uploading your file, please wait...";

      for (const file of files) {
        const fileType = file.name.split(".").pop().toLowerCase(); // Detect file type (csv or hdf5)
        const totalChunks = Math.ceil(file.size / chunkSize);
        let uploadedChunks = 0;

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
              uploadedChunks++;
              const progress = Math.round((uploadedChunks / totalChunks) * 100);
              document.getElementById("progress-percentage").innerText = `${progress}%`;
            })
          );
        }
      }

      await Promise.all(uploadPromises);

      document.getElementById("progress-percentage").innerText = "99%";
      document.getElementById("msgprogress").innerText = "Processing your data for visualizing Circuit, please wait...";

      const response = await fetch(`${baseURL}/api/fetch_user_network_data/?dir=${uniqueDirectory}`);
      const data = await response.json();

      if (data.files.length > 0) {
        document.getElementById("progress-percentage").innerText = "100%";
        document.getElementById("typeHeading").style.visibility = "visible";

        vertexColors = [];
        NetworkArray = [];
        data.files.forEach((file) => {
          NetworkArray.push(file.fileData);
          total_neurons += file.total_neuros;
        });

        if (total_neurons > 1000000) spikeNeuronSize = 70; // set spike neuron size

        flag = true;
        VisualizateNeurons();

        if (parseInt(data.flag_check) == 1) {
          document.getElementById("lblspikes").innerText = "Spikes :" + data.lstresponse.total_lines;

          total_activity_files = data.lstresponse.total_activity_files;
          firstLastKeys = data.lstresponse.first_last_keys;

          // Ensure chunk_mfr_list exists
          if (!data.lstresponse.chunk_mfr_list || data.lstresponse.chunk_mfr_list.length === 0) {
            return;
          }

          const dropdown = document.getElementById("ddactivity_chunks");
          dropdown.innerHTML = ""; // Clear previous options

          const defaultOption = document.createElement("option");
          defaultOption.textContent = "Select Activity Chunk";

          dropdown.appendChild(defaultOption);

          data.lstresponse.chunk_mfr_list.forEach((chunk) => {
            const option = document.createElement("option");
            option.value = chunk.chunk_number;

            // Convert chunk number to string and apply padding
            const chunkNum = String(chunk.chunk_number);
            const timeRange = `[${chunk.first_key} - ${chunk.last_key}]ms`;
            const mfr = `MFR: ${chunk.MFR} Hz`;

            // Properly spaced columns using Unicode spaces (\u2003)
            option.textContent = `Chunk ${chunkNum}\u2003 ${timeRange}\u2003 \u2003 ${mfr}`;

            dropdown.appendChild(option);
          });
        } else {
          console.log("not available data...");
        }
      } else {
        console.log("No files found in the response.");
      }
    } catch (error) {
      console.error("Error:", error);
      alert("An error occurred. Please try again.");
    } finally {
      document.getElementById("page-loader").style.display = "none";
      networkFileInput.value = "";
    }
  }
});

dropdown.addEventListener("change", async function () {
  counter_check += 1;

  selectedChunkNumber = this.value; // Get selected chunk number

  // Ignore the first (default) option
  if (!selectedChunkNumber || selectedChunkNumber === "Select Activity Chunk") return;

  //   console.log(`Fetching data for Chunk ${selectedChunkNumber}...`);

  try {
    // Show progress UI
    // document.getElementById("progress-percentage").innerText = "0%";
    document.getElementById("page-loader").style.display = "block";
    document.getElementById("msgprogress").innerText = "Loading Data...., please wait...";
    // Determine the base URL dynamically

    const response = await fetch(`${baseURL}/api/get_chunk_data/?dir=${uniqueDirectory}&chunk_number=${selectedChunkNumber}`);

    if (!response.ok) {
      throw new Error(`HTTP error! Status: ${response.status}`);
    }

    const data = await response.json();
    // console.log("Received Chunk Data:", data);

    // Ensure response contains expected data
    if (!data.chunk_data || !data.gids_activity_indexes) {
      throw new Error("Missing chunk_data or gids_activity_indexes in API response.");
    }

    if (data.histogram) {
      document.getElementById("histogramImage").src = "data:image/png;base64," + data.histogram;
      document.getElementById("histogramImage").style.display = "block"; // Show histogram
    } else {
      console.error("No histogram found for chunk:", selectedChunkNumber);
    }

    // if (data.raster_plot) {
    //   document.getElementById("rasterImage").src =
    //     "data:image/png;base64," + data.raster_plot;
    //   document.getElementById("rasterImage").style.display = "block"; // Show histogram
    // } else {
    //   console.error("No raster found for chunk:", selectedChunkNumber);
    // }

    // Assign Activity Data
    Activitys = data.chunk_data;

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
    if (selectedChunkNumber > 0) {
      if (sortedKeys.length > 0) {
        firstKey = sortedKeys[0]; // Get the first key in the sorted array
        // document.getElementById("txtTime").innerHTML =
        //   "t = " + parseFloat(firstKey).toFixed(1);
        count = parseFloat(firstKey).toFixed(1);
        currentTimeDisplay.textContent = count;
      }
    } else {
      //   document.getElementById("txtTime").innerHTML = "t =" + 0.0;
      count = 0.0;
      currentTimeDisplay.textContent = count.toFixed(1);
      //totalTimeDisplay.textContent = count;
    }

    // Store sorted time ranges for further processing
    timeRanges = sortedKeys;

    // Assign GIDs activity indexes
    gids_activity_indexes = data.gids_activity_indexes;
    document.getElementById("lblspikes").innerText = "Spikes :" + data.total_spikes;

    if (counter_check > 1) {
      clearInterval(interval);
      interval = null; // Reset interval variable
      isPaused = true;

      resetParticles();
    }
    previousTimeDisplay = parseFloat(currentTimeDisplay.textContent).toFixed(1);
    document.getElementById("mySidebar").style.display = "block";
    document.getElementById("mySidebar").style.width = "220px";

    startButton.disabled = false;
  } catch (error) {
    console.error("Error fetching chunk data:", error);
    alert("Failed to fetch chunk data. Please try again.");
  } finally {
    document.getElementById("page-loader").style.display = "none";
  }
});

// Get the modal
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
  const startVal = Math.max(0, parseFloat(startTimeInput.value)) || 0.0;
  const endVal = Math.max(0, parseFloat(endTimeInput.value)) || parseFloat(lasttime);

  timebar.min = startVal;
  timebar.max = endVal;

  if (!interval || isPaused) {
    count = Math.max(count, startVal); // Ensure within bounds
    timebar.value = count;
    currentTimeDisplay.textContent = count.toFixed(1);

    isPaused = false;
    startButton.disabled = true;
    stopButton.disabled = false;
    restart.disabled = false;

    startAnimation(startVal, endVal);
  }
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
  const startVal = parseFloat(startTimeInput.value) || 0.0;
  const endVal = parseFloat(endTimeInput.value) || parseFloat(lasttime);

  clearInterval(interval);
  interval = null;
  resetParticles();

  count = startVal;
  timebar.min = startVal;
  timebar.max = endVal;
  timebar.value = count;
  currentTimeDisplay.textContent = count.toFixed(1);

  isPaused = false;
  startButton.disabled = true;
  stopButton.disabled = false;

  startAnimation(startVal, endVal);
});

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
function CreateScene() {
  // set up the options for a perspective camera
  const fav = 45;
  const aspect = container.clientWidth / container.clientHeight;
  const near = 0.01;
  const far = 10000;
  camera = new THREE.PerspectiveCamera(fav, aspect, near, far);
  camera.position.z = 1000;
  scene = new THREE.Scene();
  //   scene.add(new THREE.AxesHelper(200));

  renderer = new THREE.WebGLRenderer({
    antialias: false, // Disable antialiasing for performance
    powerPreference: "high-performance", // Use high-performance GPU settings
  });

  renderer.setPixelRatio(window.devicePixelRatio);
  renderer.setSize(container.clientWidth, container.clientHeight);
  renderer.toneMapping = THREE.ReinhardToneMapping;
  renderer.toneMappingExposure = 1000;
  container.appendChild(renderer.domElement);

  controls = new TrackballControls(camera, renderer.domElement);
  controls.rotateSpeed = 5.0;
  controls.zoomSpeed = 5;
  controls.panSpeed = 0.8;

  controls.dynamicDampingFactor = 0.25;

  stopButton.disabled = true;
  startButton.disabled = true;
  restart.disabled = true;

  //controls = new OrbitControls(camera, renderer.domElement);
  //   controls.enableDamping = true;
  //   controls.enableZoom = true;
  //   controls.dampingFactor = 0.25;
  //   controls.screenSpacePanning = false;

  //controls.enableRotate = true;
}

const colorSelectdg = document.getElementById("colorSelectdg");
colorSelectdg.addEventListener("change", function () {
  const selectedColor = colorSelectdg.value.split(",").map(Number);
  dgRGB = selectedColor; // Get the selected color
  VisualizateNeurons();
});
const colorSelectca3 = document.getElementById("colorSelectca3");
colorSelectca3.addEventListener("change", function () {
  const selectedColor = colorSelectca3.value.split(",").map(Number);
  ca3RGB = selectedColor; // Get the selected color
  VisualizateNeurons();
});

const colorSelectca2 = document.getElementById("colorSelectca2");
colorSelectca2.addEventListener("change", function () {
  const selectedColor = colorSelectca2.value.split(",").map(Number);
  ca2RGB = selectedColor; // Get the selected color
  VisualizateNeurons();
});

const colorSelectca1 = document.getElementById("colorSelectca1");
colorSelectca1.addEventListener("change", function () {
  const selectedColor = colorSelectca1.value.split(",").map(Number);
  ca1RGB = selectedColor; // Get the selected color
  VisualizateNeurons();
});

const colorSelectcasub = document.getElementById("colorSelectsub");
colorSelectcasub.addEventListener("change", function () {
  const selectedColor = colorSelectcasub.value.split(",").map(Number);
  subRGB = selectedColor; // Get the selected color
  VisualizateNeurons();
});
const colorSelectcaec = document.getElementById("colorSelectec");
colorSelectcaec.addEventListener("change", function () {
  const selectedColor = colorSelectcaec.value.split(",").map(Number);
  ecRGB = selectedColor; // Get the selected color
  VisualizateNeurons();
});

function addDirectionalArrows(
  scene,
  camera,
  sceneObject,
  length = 50,
  arrowSize = 5,
  offset = 100 // Offset to position arrows near the object
) {
  // Calculate the bounding box of the scene object
  const boundingBox = new THREE.Box3().setFromObject(sceneObject);
  const objectCenter = boundingBox.getCenter(new THREE.Vector3());
  const objectSize = boundingBox.getSize(new THREE.Vector3());

  // Define positions for the arrows based on the bounding box
  const dorsalPosition = new THREE.Vector3(objectCenter.x, objectCenter.y + objectSize.y / 2 + offset, objectCenter.z);
  const ventralPosition = new THREE.Vector3(objectCenter.x, objectCenter.y - objectSize.y / 2 - offset, objectCenter.z);
  const distalPosition = new THREE.Vector3(objectCenter.x + objectSize.x / 2 + offset, objectCenter.y, objectCenter.z);
  const proximalPosition = new THREE.Vector3(objectCenter.x - objectSize.x / 2 - offset, objectCenter.y, objectCenter.z);

  // Define directional vectors
  const dorsalVector = new THREE.Vector3(0, 1, 0); // Upwards in Y-axis
  const ventralVector = new THREE.Vector3(0, -1, 0); // Downwards in Y-axis
  const distalVector = new THREE.Vector3(1, 0, 0); // Right in X-axis
  const proximalVector = new THREE.Vector3(-1, 0, 0); // Left in X-axis

  // Create and add arrows to the scene
  const dorsalArrow = new THREE.ArrowHelper(dorsalVector, dorsalPosition, length, 0x00ff00, arrowSize, arrowSize);
  const ventralArrow = new THREE.ArrowHelper(ventralVector, ventralPosition, length, 0xff0000, arrowSize, arrowSize);
  const distalArrow = new THREE.ArrowHelper(distalVector, distalPosition, length, 0x0000ff, arrowSize, arrowSize);
  const proximalArrow = new THREE.ArrowHelper(proximalVector, proximalPosition, length, 0xffff00, arrowSize, arrowSize);

  // Add arrows to the scene
  scene.add(dorsalArrow);
  scene.add(ventralArrow);
  scene.add(distalArrow);
  scene.add(proximalArrow);
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

      if (particles.geometry) {
        particles.geometry.dispose();
      }

      if (particles.material) {
        if (Array.isArray(particles.material)) {
          particles.material.forEach((mat) => mat.dispose());
        } else {
          particles.material.dispose();
        }
      }

      particles = null; // Optional: clear reference
    }

    document.getElementById("lblnetwork").innerText = "Network :";
    document.getElementById("typeHeading").style.visibility = "hidden";
    removeTable();
  }

  geometry = new THREE.BufferGeometry();

  total_excitatory = 0;
  total_inhibitory = 0;

  let DG = [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15, 16, 17, 18];
  let CA3 = [19, 20, 21, 22, 23, 24, 25, 26, 27, 28, 29, 30, 31, 32, 33, 34, 35, 36, 37, 38, 39, 40, 41, 42, 43];
  let CA2 = [44, 45, 46, 47, 48];
  let CA1 = [49, 50, 51, 52, 53, 54, 55, 56, 57, 58, 59, 60, 61, 62, 63, 64, 65, 66, 67, 68, 69, 70, 71, 72, 73, 74, 75, 76, 77, 78, 79, 80, 81, 82, 83, 84, 85, 86, 87, 88];
  let SUB = [89, 90, 91];
  let EC = [92, 93, 94, 95, 96, 97, 98, 99, 100, 101, 102, 103, 104, 105, 106, 107, 108, 109, 110, 111, 112, 113, 114, 115, 116, 117, 118, 119, 120, 121, 122];

  if (selectedCheckboxIds.length > 0) {
    NetworkArray.forEach((net) => {
      const filteredParticles = net.filter((particle) => selectedCheckboxIds.includes(particle.ntype.toString()));
      totalParticles += filteredParticles.length;
      filteredParticles.forEach((particle) => {
        if (Number(particle.type) === 1) {
          //if (selectedCheckboxIds.some((id) => DG.includes(Number(id)))) {
          if (DG.includes(Number(particle.ntype))) {
            //vertexColors.push(0.0, 0.0, 1.0); // Blue color for PC
            vertexColors.push(Number(dgRGB[0]), Number(dgRGB[1]), Number(dgRGB[2]));
          }
          if (CA3.includes(Number(particle.ntype))) {
            //vertexColors.push(0.0, 0.0, 1.0); // Blue color for PC
            vertexColors.push(Number(ca3RGB[0]), Number(ca3RGB[1]), Number(ca3RGB[2]));
          }

          if (CA2.includes(Number(particle.ntype))) {
            //vertexColors.push(0.0, 0.0, 1.0); // Blue color for PC
            vertexColors.push(Number(ca2RGB[0]), Number(ca2RGB[1]), Number(ca2RGB[2]));
          }
          if (CA1.includes(Number(particle.ntype))) {
            //vertexColors.push(0.0, 0.0, 1.0); // Blue color for PC
            vertexColors.push(Number(ca1RGB[0]), Number(ca1RGB[1]), Number(ca1RGB[2]));
          }
          if (SUB.includes(Number(particle.ntype))) {
            //vertexColors.push(0.0, 0.0, 1.0); // Blue color for PC
            vertexColors.push(Number(subRGB[0]), Number(subRGB[1]), Number(subRGB[2]));
          }
          if (EC.includes(Number(particle.ntype))) {
            //vertexColors.push(0.0, 0.0, 1.0); // Blue color for PC
            vertexColors.push(Number(ecRGB[0]), Number(ecRGB[1]), Number(ecRGB[2]));
          }

          total_excitatory++;
        } else {
          vertexColors.push(1.0, 0.0, 0.0); // Red color for Interneurons
          total_inhibitory++;
        }

        const x = particle.x * scalingFactor;
        const y = particle.y * scalingFactor;
        const z = particle.z * scalingFactor;
        positions.push(x, y, z);
        sizes.push(30);
        gIDs.push(particle.id);
        neuron_class.push(particle.type);
      });
    });

    //   start

    // end
  } else if (flag) {
    NetworkArray.forEach((net) => {
      for (let i = 0; i < net.length; i++) {
        const x = net[i].x * scalingFactor;
        const y = net[i].y * scalingFactor;
        const z = net[i].z * scalingFactor;

        if (net[i].id < 261845) {
          vertexColors.push(0.0, 0.0, 1.0); // blue color for exci
          total_excitatory++;
        } else {
          vertexColors.push(1.0, 0.0, 0.0); // red for inhi
          total_inhibitory++;
        }
        // if (Number(net[i].type) === 1) {
        //   vertexColors.push(0.0, 0.0, 1.0); // Blue color for PC
        //   total_excitatory += 1;
        // } else {
        //   vertexColors.push(1.0, 0.0, 0.0); // Red color for Interneurons
        //   total_inhibitory += 1;
        // }

        positions.push(x, y, z);
        sizes.push(30);
        gIDs.push(net[i].id);
        //neuron_class.push(net.type);

        // Accumulate coordinates to calculate center
        totalX += x;
        totalY += y;
        totalZ += z;
      }
      totalParticles += net.length;
    });
    // Calculate the center point
    const centerX = totalX / totalParticles;
    const centerY = totalY / totalParticles;
    const centerZ = totalZ / totalParticles;
  } else if (selectedCheckboxByLayer.length > 0) {
    NetworkArray.forEach((net, index) => {
      if (selectedCheckboxByLayer.includes(index)) {
        //console.log("Net index:  " + index);

        net.forEach((particle) => {
          if (Number(particle.type) === 1) {
            vertexColors.push(0.0, 0.0, 1.0); // Blue color for PC
            total_excitatory += 1;
          } else {
            vertexColors.push(1.0, 0.0, 0.0); // Red color for Interneurons
            total_inhibitory += 1;
          }
          const x = particle.x * scalingFactor;
          const y = particle.y * scalingFactor;
          const z = particle.z * scalingFactor;
          positions.push(x, y, z);
          sizes.push(30);
          gIDs.push(particle.id);
          neuron_class.push(particle.type);
        });

        // Update the total particle count
        totalParticles += net.length;
      }
    });
  }

  document.getElementById("typeHeading").style.visibility = "visible";
  document.getElementById("lblnetwork").innerText = "Network :" + totalParticles;

  generateTable(totalParticles, total_excitatory, total_inhibitory);

  //console.log("gIDs length:  " + gIDs.length);
  geometry.setAttribute("position", new THREE.Float32BufferAttribute(positions, 3));
  geometry.setAttribute("color", new THREE.BufferAttribute(new Float32Array(vertexColors), 3));

  geometry.setAttribute("size", new THREE.Float32BufferAttribute(sizes, 1));
  geometry.setAttribute("gid", new THREE.Float32BufferAttribute(gIDs, 1));

  const uniforms = {
    pointTexture: { value: new THREE.TextureLoader().load(texturePath) },
  };
  material = new THREE.ShaderMaterial({
    uniforms: uniforms,
    vertexShader: document.getElementById("vertexshader").textContent,
    fragmentShader: document.getElementById("fragmentshader").textContent,
    //depthTest: true,
    transparent: true,
    vertexColors: true,
    depthWrite: true,
    depthTest: true,

    // blending: THREE.AdditiveBlending,
  });
  particles = new THREE.Points(geometry, material);
  scene.add(particles);

  // Assume `sceneObject` is your hippocampus or main object in the scene
  //addDirectionalArrows(scene, camera, particles, 50, 5, 30);

  // Add lighting
  const ambientLight = new THREE.AmbientLight(0x404040, 10); // Ambient light with intensity 2
  scene.add(ambientLight);

  const directionalLight = new THREE.DirectionalLight(0xffffff, 1); // White directional light with intensity 1
  directionalLight.position.set(1, 1, 1).normalize(); // Set position and normalize
  scene.add(directionalLight);

  const pointLight = new THREE.PointLight(0xffffff, 1, 100); // White point light with intensity 1
  pointLight.position.set(50, 50, 50); // Set position
  scene.add(pointLight);

  const spotLight = new THREE.SpotLight(0xffffff, 1); // White spotlight with intensity 1
  spotLight.position.set(0, 100, 100); // Set position
  spotLight.angle = Math.PI / 6; // Set spotlight angle
  spotLight.penumbra = 0.2; // Softening the spotlight edge
  spotLight.decay = 2; // Distance attenuation
  spotLight.distance = 200; // Light distance
  scene.add(spotLight);

  scene.background = new THREE.Color(params.Backgound);

  if (!chkpanle) {
    chkpanle = true;

    const center = new THREE.Vector3();
    const boundingBox = new THREE.Box3().setFromObject(particles);
    boundingBox.getCenter(center);

    const size = boundingBox.getSize(new THREE.Vector3());
    const maxDimension = Math.max(size.x, size.y, size.z);
    const fov = camera.fov * (Math.PI / 200);
    let distance = maxDimension / Math.tan(fov);
    distance *= 2.0; // Optional: adjust the distance for better view

    const direction = new THREE.Vector3(0, 0, 1);

    direction.normalize();
    direction.multiplyScalar(distance);
    const newPosition = center.clone().add(direction);
    camera.position.copy(newPosition);
    camera.lookAt(center);
    controls.target.copy(center);
    controls.update();

    //////GUI panel code below
    var gui = new GUI({ autoPlace: false });
    gui.domElement.id = "gui";
    document.getElementById("panel").append(gui.domElement);
    gui.addColor(params, "Backgound").onChange(function (value) {
      scene.background.set(value);
    });

    // Add controls to GUI
    const cameraFolder = gui.addFolder("Camera");
    cameraFolder.add(camera.position, "x", 0, 1000).listen();
    cameraFolder.add(camera.position, "y", 0, 1000).listen();
    cameraFolder.add(camera.position, "z", 0, 1000).listen();

    const pm = gui.addFolder("Sphere Material");
    pm.add(parameters, "SphereSize", 1, 200).onChange(function (value) {
      //below commented code is for set size only for without firing neurons blue and red

      //   const sizes = geometry.attributes.size.array;
      //   const colors = geometry.attributes.color.array;

      //   for (let i = 0; i < colors.length; i++) {
      //     const r = colors[i];
      //     const g = colors[i + 1];
      //     const b = colors[i + 2];
      //     const neuronIndex = i / 3;

      //     if (
      //       (r === 0 && g === 0 && b === 1) ||
      //       (r === 1 && g === 0 && b === 0)
      //     ) {
      //       sizes[neuronIndex] = value; // set spike size
      //     }
      //   }

      //   geometry.attributes.size.needsUpdate = true;
      //   geometry.attributes.color.needsUpdate = true;

      const sizes = geometry.attributes.size.array;
      for (let i = 0; i < sizes.length; i++) {
        sizes[i] = value;
      }
      geometry.attributes.size.needsUpdate = true;
    });
    pm.add(parameters, "FiringSphereSize", 1, 500).onChange(function (value) {
      const sizes = geometry.attributes.size.array;
      const colors = geometry.attributes.color.array;

      for (let i = 0; i < colors.length; i += 3) {
        const r = colors[i];
        const g = colors[i + 1];
        const b = colors[i + 2];

        const neuronIndex = i / 3;

        if (r === 1 && g === 1 && b === 0) {
          sizes[neuronIndex] = value; // set spike size
        }
      }

      geometry.attributes.size.needsUpdate = true;
      geometry.attributes.color.needsUpdate = true;
      spikeNeuronSize = value;
    });

    animate();
  } else {
    camera.position.set(xcord, ycord, zcord);
    animate();
  }
}

function generateTable(total_neuros, total_excitatory, total_inhibitory) {
  // start

  var containerDiv = document.createElement("div");
  containerDiv.className = "generateTable";

  var rowDiv2 = document.createElement("div");
  rowDiv2.className = "row border";

  var colDiv2 = document.createElement("div");
  colDiv2.className = "col-sm border";
  colDiv2.style.fontSize = "12px";

  var lblTotalNeurons = document.createElement("label");
  lblTotalNeurons.setAttribute("for", "neurons_total"); // For attribute is used to associate label with an input element
  lblTotalNeurons.textContent = "Neurons: " + total_neuros;
  lblTotalNeurons.style.fontSize = "12px";

  colDiv2.appendChild(lblTotalNeurons);
  rowDiv2.appendChild(colDiv2);
  containerDiv.appendChild(rowDiv2);

  var rowDiv3 = document.createElement("div");
  rowDiv3.className = "row border";
  var colDiv3 = document.createElement("div");
  colDiv3.className = "col-sm border";
  colDiv3.style.fontSize = "12px";

  var lblTotalExcit = document.createElement("label");
  lblTotalExcit.setAttribute("for", "neurons_Excit"); // For attribute is used to associate label with an input element
  lblTotalExcit.textContent = " Excitatory Neurons: " + total_excitatory;
  lblTotalExcit.style.fontSize = "12px";

  colDiv3.appendChild(lblTotalExcit);
  rowDiv3.appendChild(colDiv3);
  containerDiv.appendChild(rowDiv3);

  var rowDiv4 = document.createElement("div");
  rowDiv4.className = "row border";
  var colDiv4 = document.createElement("div");
  colDiv4.className = "col-sm border";
  colDiv4.style.fontSize = "12px";

  var lblTotalInhib = document.createElement("label");
  lblTotalInhib.setAttribute("for", "neurons_Inhib:"); // For attribute is used to associate label with an input element
  lblTotalInhib.textContent = " Inhibitory Neurons: " + total_inhibitory;
  lblTotalInhib.style.fontSize = "12px";

  colDiv4.appendChild(lblTotalInhib);
  rowDiv4.appendChild(colDiv4);
  containerDiv.appendChild(rowDiv4);

  ca1RegDiv.appendChild(containerDiv);

  // end
}
function removeTable() {
  var containerDiv = document.querySelector(".generateTable");
  if (containerDiv) {
    containerDiv.remove();
  }
}
function animate() {
  requestAnimationFrame(animate);
  controls.update();

  xcord = camera.position.x;
  ycord = camera.position.y;
  zcord = camera.position.z;

  render();
}

function render() {
  renderer.render(scene, camera);
}

function startAnimation(startVal, endVal) {
  if (interval) clearInterval(interval);

  interval = setInterval(() => {
    if (!isPaused) {
      const simTimestep = playbackConfig.simTimestep;

      timebar.value = count;
      currentTimeDisplay.textContent = parseFloat(count).toFixed(1);

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
        restartSimulation(); // if this resets your scene

        isPaused = true; // ✅ allow future play
        stopButton.disabled = true;
        startButton.disabled = false;
        restart.disabled = false; // ✅ allow restarting

        count = startVal; // ✅ reset count for next run
        currentTimeDisplay.textContent = 0.0;

        return;
      }

      count = parseFloat((count + simTimestep).toFixed(1));
    }
  }, playbackConfig.stepDuration);
}
function restartSimulation() {
  if (selectedChunkNumber == 0) {
    count = 0.0;
  } else {
    count = parseFloat(firstKey).toFixed(1);
  }
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

  // Create a Map for efficient lookup
  const gIDsMap = new Map();
  for (let i = 0; i < gIDs.length; i++) {
    gIDsMap.set(gIDs[i], i);
  }

  let delay = 0; // Initial delay

  particleIds.forEach((particleId) => {
    if (ca3toca1connections[particleId]) {
      ca3toca1connections[particleId].forEach((ca1Id) => {
        // setTimeout(() => {
        const GIDindex = gIDsMap.get(ca1Id);
        const index = GIDindex * 3;
        sizes[GIDindex] = targetSize;

        // Toggle color logic
        if (colors[index] === 1 && colors[index + 1] === 0 && colors[index + 2] === 0) {
          colors[index] = 1;
          colors[index + 1] = 1;
          colors[index + 2] = 1;
        } else {
          colors[index] = 1;
          colors[index + 1] = 1;
          colors[index + 2] = 0;
        }

        geometry.attributes.size.needsUpdate = true;
        geometry.attributes.color.needsUpdate = true;
        // }, delay);

        // delay += 0.1; // Increment delay (adjust for animation speed)
      });
    }

    const GIDindex = gids_activity_indexes[particleId];
    if (GIDindex !== undefined) {
      const index = GIDindex * 3;
      sizes[GIDindex] = targetSize;

      if (colors[index] === 1 && colors[index + 1] === 0 && colors[index + 2] === 0) {
        colors[index] = 1;
        colors[index + 1] = 1;
        colors[index + 2] = 1;
      } else {
        colors[index] = 1;
        colors[index + 1] = 1;
        colors[index + 2] = 0;
      }

      geometry.attributes.size.needsUpdate = true;
      geometry.attributes.color.needsUpdate = true;
      i += 1;
    }
  });
}
function twoMilisecondStay_Connection(currentTime) {
  const sizes = geometry.attributes.size.array;
  const colors = geometry.attributes.color.array;
  const gIDs = geometry.attributes.gid.array;

  const gIDsMap = new Map();
  for (let i = 0; i < gIDs.length; i++) {
    gIDsMap.set(gIDs[i], i);
  }

  let delay = 0; // Initial delay

  for (const currentRange of timeRanges) {
    if (parseFloat(currentTime).toFixed(1) == parseFloat(currentRange) + pt) {
      const particleIds = Activitys[currentRange];
      if (particleIds !== undefined) {
        particleIds.forEach((particleId) => {
          if (ca3toca1connections[particleId]) {
            ca3toca1connections[particleId].forEach((ca1Id) => {
              // setTimeout(() => {
              const GIDindex = gIDsMap.get(ca1Id);
              const index = GIDindex * 3;
              sizes[GIDindex] = 30;

              // Apply color based on selected color index logic
              if (colorSelectdg.selectedIndex > -1) {
                colors[index] = dgRGB[0];
                colors[index + 1] = dgRGB[1];
                colors[index + 2] = dgRGB[2];
              } else if (colorSelectca3.selectedIndex > -1) {
                colors[index] = ca3RGB[0];
                colors[index + 1] = ca3RGB[1];
                colors[index + 2] = ca3RGB[2];
              } else if (colorSelectca2.selectedIndex > -1) {
                colors[index] = ca2RGB[0];
                colors[index + 1] = ca2RGB[1];
                colors[index + 2] = ca2RGB[2];
              } else if (colorSelectca1.selectedIndex > -1) {
                colors[index] = ca1RGB[0];
                colors[index + 1] = ca1RGB[1];
                colors[index + 2] = ca1RGB[2];
              } else if (colorSelectcasub.selectedIndex > -1) {
                colors[index] = subRGB[0];
                colors[index + 1] = subRGB[1];
                colors[index + 2] = subRGB[2];
              } else if (colorSelectcaec.selectedIndex > -1) {
                colors[index] = ecRGB[0];
                colors[index + 1] = ecRGB[1];
                colors[index + 2] = ecRGB[2];
              }

              geometry.attributes.size.needsUpdate = true;
              geometry.attributes.color.needsUpdate = true;
              // }, delay);

              //  delay += 0.1; // Increment delay for smoother animation
            });
          }

          const GIDindex = gids_activity_indexes[particleId];
          if (GIDindex !== undefined) {
            const index = GIDindex * 3;
            sizes[GIDindex] = 30;

            if (colors[index] === 1 && colors[index + 1] === 1 && colors[index + 2] === 1) {
              colors[index] = 1;
              colors[index + 1] = 0;
              colors[index + 2] = 0;
            } else {
              colors[index] = 0;
              colors[index + 1] = 0;
              colors[index + 2] = 1;
            }

            geometry.attributes.size.needsUpdate = true;
            geometry.attributes.color.needsUpdate = true;
            j += 1;
          }
        });
      }
    }
  }
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
let spikeTimes = new Map(); // gid -> time last spiked

function animateParticles_Without_Connection(particleIds, targetSize) {
  const sizes = geometry.attributes.size.array;
  const colors = geometry.attributes.color.array;

  particleIds.forEach((gid) => {
    const GIDindex = gids_activity_indexes[gid];
    if (GIDindex === undefined) return;

    const index = GIDindex * 3;
    sizes[GIDindex] = targetSize;

    const r = colors[index];
    const g = colors[index + 1];
    const b = colors[index + 2];

    // Inhibitory (red) → white
    if (r === 1 && g === 0 && b === 0) {
      colors[index] = 1;
      colors[index + 1] = 1;
      colors[index + 2] = 1;
    }
    // Excitatory (blue) → yellow
    else if (r === 0 && g === 0 && b === 1) {
      colors[index] = 1;
      colors[index + 1] = 1;
      colors[index + 2] = 0;
    }

    // Store spike time
    spikeTimes.set(gid, count);
  });

  geometry.attributes.size.needsUpdate = true;
  geometry.attributes.color.needsUpdate = true;
}

function twoMilisecondStay_Without_Connection(currentTime) {
  const sizes = geometry.attributes.size.array;
  const colors = geometry.attributes.color.array;
  const fadeDuration = 2.0;

  spikeTimes.forEach((spikeTime, gid) => {
    if (currentTime - spikeTime >= fadeDuration) {
      const GIDindex = gids_activity_indexes[gid];
      if (GIDindex === undefined) return;

      const index = GIDindex * 3;

      sizes[GIDindex] = 30; // Reset size

      const r = colors[index];
      const g = colors[index + 1];
      const b = colors[index + 2];

      // Reset white to red (inhibitory)
      if (r === 1 && g === 1 && b === 1) {
        colors[index] = 1;
        colors[index + 1] = 0;
        colors[index + 2] = 0;
      }
      // Reset yellow to blue (excitatory)
      else if (r === 1 && g === 1 && b === 0) {
        colors[index] = 0;
        colors[index + 1] = 0;
        colors[index + 2] = 1;
      }

      spikeTimes.delete(gid); // Done fading
    }
  });

  geometry.attributes.size.needsUpdate = true;
  geometry.attributes.color.needsUpdate = true;
}

function resetParticles() {
  // Check if particles exist and remove them
  if (particles) {
    scene.remove(particles);
    particles.geometry.dispose();
    particles.material.dispose();
  }

  // Clear arrays for new data
  positions = [];
  sizes = [];
  vertexColors = [];
  gIDs = [];
  neuron_class = [];
  totalParticles = 0; // Initialize counter

  // Reinitialize particle system
  removeTable();
  VisualizateNeurons();
}

function GetActivityData() {
  fetch("https://127.0.0.1:8000/load_Activity_Data/")
    .then((response) => {
      if (!response.ok) {
        throw new Error(`HTTP error! Status: ${response.status}`);
      }
      return response.json();
    })
    .then((data) => {
      Activitys = data.data;
      timeRanges = data.keys;
      // console.log("Activity: " + Activitys[1]);
      //console.log("ranges: " + timeRanges);
    })
    .catch((error) => {
      console.error("Error fetching or storing data:", error);
    });
}

function GetNetworkData(number_of_neuros = 0) {
  if (number_of_neuros > 0) {
    console.log("ok go ahead...");
    const formData = new FormData();
    formData.append("number_of_neuros", number_of_neuros);

    fetch("https://127.0.0.1:8000/load_Network_Data/", {
      method: "POST",
      body: formData,
    })
      .then((response) => {
        if (!response.ok) {
          throw new Error(`HTTP error! Status: ${response.status}`);
        }
        return response.json();
      })
      .then((data) => {
        Networks = data;

        VisualizateNeurons(Networks);
        //GetActivityData();
      });
  } else {
    fetch("https://127.0.0.1:8000/load_Network_Data/")
      .then((response) => {
        if (!response.ok) {
          throw new Error(`HTTP error! Status: ${response.status}`);
        }
        return response.json();
      })
      .then((data) => {
        // Store the fetched data in the global array

        Networks = data;
        // console.log(Networks[0]);}
        VisualizateNeurons(Networks);
        GetActivityData();
      });
  }
}

window.addEventListener("load", function () {
  const btnLoadAllLayers = document.getElementById("btnLoadAllLayers");
  btnLoadAllLayers.addEventListener("click", function () {
    document.getElementById("msgprogress").innerText = `Loading Hippocampal formation data, please wait...`;

    document.getElementById("progress-percentage").style.display = "none";

    document.getElementById("page-loader").style.display = "block";
    LoadHipForm();
    enableAllElements();
  });
});

window.addEventListener("load", function () {
  const btnLoadConnection = document.getElementById("btnLoadConnection");
  btnLoadConnection.addEventListener("click", function () {
    document.getElementById("msgprogress").innerText = `Building Connection, please wait... \n CA3-PC to CA1-PC `;

    document.getElementById("progress-percentage").style.display = "none";

    document.getElementById("page-loader").style.display = "block";
    fetchConnections();
  });
});

window.addEventListener("load", function () {
  const btnLoadHumanNetwork = document.getElementById("btnLoadHumanNetwork");
  btnLoadHumanNetwork.addEventListener("click", function () {
    document.getElementById("msgprogress").innerText = `Loading data for visualization, please wait...`;

    document.getElementById("progress-percentage").style.display = "none";

    document.getElementById("page-loader").style.display = "block";
    LoadHumanHipForm();
  });
});

function SelectAllByRegion() {
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

  ///////// below checkboxesToLog sequence is for fetch json files from local machine

  //   const checkboxesToLog = ["LECIV", "CA3SO", "MECII", "MECIII", "CA1SP", "SubSM", "MECVI", "MECIV", "CA3SP", "LECII", "CA3SLM", "CA1SO", "LECVI", "CA2SP", "DGH", "CA3SR", "DGSMi", "LECV", "MECV", "SubSP", "LECIII", "DGSMo", "LECI", "MECI", "CA1SLM", "CA1SR", "CA3SL", "DGSG"];

  // below checkboxesToLog sequence is for fetch json files from hcv server

  const checkboxesToLog = [
    "CA1SO",
    "MECIV",
    "MECII",
    "CA3SL",
    "CA1SLM",
    "CA3SP",
    "LECI",
    "MECV",
    "LECII",
    "DGSG", //DG_Granule
    "CA3SLM",
    "DGSMo",
    "CA3SR",
    "CA3SO",
    "MECVI",
    "LECV",
    "MECI",
    "LECVI",
    "SubSP",
    "SubSM",
    "CA1SP",
    "LECIV",
    "DGSMi",
    "DGH",
    "MECIII",
    "CA1SR",
    "CA2SP",
    "LECIII",
  ];

  // below checkboxesToLog sequence is for fetch json files from ebrains collab drive server
  //   const checkboxesToLog = [
  //     "CA1SLM",
  //     "CA1SO",
  //     "CA1SP",
  //     "CA1SR",
  //     "CA2SP",
  //     "CA3SL",
  //     "CA3SLM",
  //     "CA3SO",
  //     "CA3SP",
  //     "CA3SR",
  //     "DGSG", //DG_Granule
  //     "DGSMi",
  //     "DGSMo",
  //     "DGH",
  //     "LECI",
  //     "LECII",
  //     "LECIII",
  //     "LECIV",
  //     "LECV",
  //     "LECVI",
  //     "MECI",
  //     "MECII",
  //     "MECIII",
  //     "MECIV",
  //     "MECV",
  //     "MECVI",
  //     "SubSM",
  //     "SubSP",
  //   ];

  const DGLayer = [14, 16, 21, 27];
  const CA3Layer = [10, 15, 26, 8, 1];
  const CA2Layer = [13];
  const CA1Layer = [24, 25, 4, 11];
  const Sub = [5, 19];
  const LEC = [22, 9, 20, 0, 17, 12];
  const MEC = [23, 2, 3, 7, 18, 6];

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

          //   if (index === 0) {
          //     unselectCheckboxes([52, 53, 54, 55, 56, 57, 58, 60, 68, 79, 70, 71, 73, 74, 75, 85, 86, 87]);
          //   }
          //   if (index === 1) {
          //     unselectCheckboxes([106, 107, 108]);
          //   }
          //   if (index === 2) {
          //     unselectCheckboxes([96, 97, 99, 100, 102, 103, 104, 105, 106, 119, 120, 121, 122]);
          //   }
          //   if (index === 3) {
          //     unselectCheckboxes([22, 28, 30, 31, 32, 33, 34, 35, 38, 39]);
          //   }
          //   if (index === 4) {
          //     unselectCheckboxes([50, 57, 61, 63, 65, 66, 67, 77, 79, 82, 84]);
          //   }
          //   if (index === 5) {
          //     unselectCheckboxes([19, 20, 23, 25, 26, 27, 32, 35, 38, 39]);
          //   }
          //   if (index === 6) {
          //     unselectCheckboxes([92, 93]);
          //   }
          //   if (index === 7) {
          //     unselectCheckboxes([106, 107, 108, 109, 110, 111, 112, 113]);
          //   }
          //   if (index === 8) {
          //     unselectCheckboxes([97, 98, 100, 101, 104, 105, 106, 118, 121]);
          //   }
          //   if (index === 9) {
          //     unselectCheckboxes([1, 2, 7, 8, 10, 11, 14, 15, 16]);
          //   }
          //   if (index === 10) {
          //     unselectCheckboxes([29]);
          //   }
          //   if (index === 11) {
          //     unselectCheckboxes([14, 17, 18]);
          //   }
          //   if (index === 12) {
          //     unselectCheckboxes([21, 22, 34, 38, 39, 40, 41]);
          //   }
          //   if (index === 13) {
          //     unselectCheckboxes([23, 24, 27, 35, 36, 37, 38, 39, 42, 43]);
          //   }
          //   if (index === 14) {
          //     unselectCheckboxes([108, 113]);
          //   }
          //   if (index === 15) {
          //     unselectCheckboxes([106, 107, 108, 111]);
          //   }
          //   if (index === 16) {
          //     unselectCheckboxes([92, 93]);
          //   }
          //   if (index === 17) {
          //     unselectCheckboxes([108, 114]);
          //   }
          //   if (index === 18) {
          //     unselectCheckboxes([89, 90, 91]);
          //   }
          //   if (index === 19) {
          //     unselectCheckboxes([91]);
          //   }
          //   if (index === 20) {
          //     unselectCheckboxes([49, 51, 52, 55, 56, 57, 58, 60, 62, 64, 72, 76, 80, 83, 85, 87, 88]);
          //   }
          //   if (index === 21) {
          //     unselectCheckboxes([106, 107, 108]);
          //   }
          //   if (index === 22) {
          //     unselectCheckboxes([3, 9, 13, 14, 17]);
          //   }
          //   if (index === 23) {
          //     unselectCheckboxes([4, 5, 6, 10, 11, 12]);
          //   }
          //   if (index === 24) {
          //     unselectCheckboxes([96, 97, 99, 100, 102, 103, 104, 105, 106, 119, 120, 121, 122]);
          //   }
          //   if (index === 25) {
          //     unselectCheckboxes([51, 55, 57, 58, 59, 60, 61, 62, 63, 64, 65, 72, 76, 77, 78, 79, 81, 82, 83, 84, 85, 87, 88]);
          //   }
          //   if (index === 26) {
          //     unselectCheckboxes([44, 45, 46, 47, 48]);
          //   }
          //   if (index === 27) {
          //     unselectCheckboxes([97, 98, 100, 101, 104, 105, 106, 118, 121]);
          //   }

          const unselectMap = {
            0: [52, 53, 54, 55, 56, 57, 58, 60, 68, 79, 70, 71, 73, 74, 75, 85, 86, 87],
            1: [106, 107, 108],
            2: [96, 97, 99, 100, 102, 103, 104, 105, 106, 119, 120, 121, 122],
            3: [22, 28, 30, 31, 32, 33, 34, 35, 38, 39],
            4: [50, 57, 61, 63, 65, 66, 67, 77, 79, 82, 84],
            5: [19, 20, 23, 25, 26, 27, 32, 35, 38, 39],
            6: [92, 93],
            7: [106, 107, 108, 109, 110, 111, 112, 113],
            8: [97, 98, 100, 101, 104, 105, 106, 118, 121],
            9: [1, 2, 7, 8, 10, 11, 14, 15, 16],
            10: [29],
            11: [14, 17, 18],
            12: [21, 22, 34, 38, 39, 40, 41],
            13: [23, 24, 27, 35, 36, 37, 38, 39, 42, 43],
            14: [108, 113],
            15: [106, 107, 108, 111],
            16: [92, 93],
            17: [108, 114],
            18: [89, 90, 91],
            19: [91],
            20: [49, 51, 52, 55, 56, 57, 58, 60, 62, 64, 72, 76, 80, 83, 85, 87, 88],
            21: [106, 107, 108],
            22: [3, 9, 13, 14, 17],
            23: [4, 5, 6, 10, 11, 12],
            24: [96, 97, 99, 100, 102, 103, 104, 105, 106, 119, 120, 121, 122],
            25: [51, 55, 57, 58, 59, 60, 61, 62, 63, 64, 65, 72, 76, 77, 78, 79, 81, 82, 83, 84, 85, 87, 88],
            26: [44, 45, 46, 47, 48],
            27: [97, 98, 100, 101, 104, 105, 106, 118, 121],
          };

          if (unselectMap[index]) {
            unselectCheckboxes(unselectMap[index]);
          }

          AllNT.disabled = true;
          RankNT.disabled = true;
          CanonicalNT.disabled = true;
          document.getElementById("typeHeading").style.visibility = "hidden";
          removeTable();
        }

        if (selectedCheckboxByLayer.length > 0) {
          //   if (selectedCheckboxByLayer.includes(0)) {
          //     selectCheckboxes([52, 53, 54, 55, 56, 57, 58, 60, 68, 79, 70, 71, 73, 74, 75, 85, 86, 87]);
          //   }
          //   if (selectedCheckboxByLayer.includes(1)) {
          //     selectCheckboxes([106, 107, 108]);
          //   }
          //   if (selectedCheckboxByLayer.includes(2)) {
          //     selectCheckboxes([96, 97, 99, 100, 102, 103, 104, 105, 106, 119, 120, 121, 122]);
          //   }
          //   if (selectedCheckboxByLayer.includes(3)) {
          //     selectCheckboxes([22, 28, 30, 31, 32, 33, 34, 35, 38, 39]);
          //   }
          //   if (selectedCheckboxByLayer.includes(4)) {
          //     selectCheckboxes([50, 57, 61, 63, 65, 66, 67, 77, 79, 82, 84]);
          //   }
          //   if (selectedCheckboxByLayer.includes(5)) {
          //     selectCheckboxes([19, 20, 23, 25, 26, 27, 32, 35, 38, 39]);
          //   }
          //   if (selectedCheckboxByLayer.includes(6)) {
          //     selectCheckboxes([92, 93]);
          //   }
          //   if (selectedCheckboxByLayer.includes(7)) {
          //     selectCheckboxes([106, 107, 108, 109, 110, 111, 112, 113]);
          //   }
          //   if (selectedCheckboxByLayer.includes(8)) {
          //     selectCheckboxes([97, 98, 100, 101, 104, 105, 106, 118, 121]);
          //   }
          //   if (selectedCheckboxByLayer.includes(9)) {
          //     selectCheckboxes([1, 2, 7, 8, 10, 11, 14, 15, 16]);
          //   }
          //   if (selectedCheckboxByLayer.includes(10)) {
          //     selectCheckboxes([29]);
          //   }
          //   if (selectedCheckboxByLayer.includes(11)) {
          //     selectCheckboxes([14, 17, 18]);
          //   }
          //   if (selectedCheckboxByLayer.includes(12)) {
          //     selectCheckboxes([21, 22, 34, 38, 39, 40, 41]);
          //   }
          //   if (selectedCheckboxByLayer.includes(13)) {
          //     selectCheckboxes([23, 24, 27, 35, 36, 37, 38, 39, 42, 43]);
          //   }
          //   if (selectedCheckboxByLayer.includes(14)) {
          //     selectCheckboxes([108, 113]);
          //   }
          //   if (selectedCheckboxByLayer.includes(15)) {
          //     selectCheckboxes([106, 107, 108, 111]);
          //   }
          //   if (selectedCheckboxByLayer.includes(16)) {
          //     selectCheckboxes([92, 93]);
          //   }
          //   if (selectedCheckboxByLayer.includes(17)) {
          //     selectCheckboxes([108, 114]);
          //   }
          //   if (selectedCheckboxByLayer.includes(18)) {
          //     selectCheckboxes([89, 90, 91]);
          //   }
          //   if (selectedCheckboxByLayer.includes(19)) {
          //     selectCheckboxes([91]);
          //   }
          //   if (selectedCheckboxByLayer.includes(20)) {
          //     selectCheckboxes([49, 51, 52, 55, 56, 57, 58, 60, 62, 64, 72, 76, 80, 83, 85, 87, 88]);
          //   }
          //   if (selectedCheckboxByLayer.includes(21)) {
          //     selectCheckboxes([106, 107, 108]);
          //   }
          //   if (selectedCheckboxByLayer.includes(22)) {
          //     selectCheckboxes([3, 9, 13, 14, 17]);
          //   }
          //   if (selectedCheckboxByLayer.includes(23)) {
          //     selectCheckboxes([4, 5, 6, 10, 11, 12]);
          //   }
          //   if (selectedCheckboxByLayer.includes(24)) {
          //     selectCheckboxes([96, 97, 99, 100, 102, 103, 104, 105, 106, 119, 120, 121, 122]);
          //   }
          //   if (selectedCheckboxByLayer.includes(25)) {
          //     selectCheckboxes([51, 55, 57, 58, 59, 60, 61, 62, 63, 64, 65, 72, 76, 77, 78, 79, 81, 82, 83, 84, 85, 87, 88]);
          //   }
          //   if (selectedCheckboxByLayer.includes(26)) {
          //     selectCheckboxes([44, 45, 46, 47, 48]);
          //   }
          //   if (selectedCheckboxByLayer.includes(27)) {
          //     selectCheckboxes([97, 98, 100, 101, 104, 105, 106, 118, 121]);
          //   }

          const selectMap = {
            0: [52, 53, 54, 55, 56, 57, 58, 60, 68, 79, 70, 71, 73, 74, 75, 85, 86, 87],
            1: [106, 107, 108],
            2: [96, 97, 99, 100, 102, 103, 104, 105, 106, 119, 120, 121, 122],
            3: [22, 28, 30, 31, 32, 33, 34, 35, 38, 39],
            4: [50, 57, 61, 63, 65, 66, 67, 77, 79, 82, 84],
            5: [19, 20, 23, 25, 26, 27, 32, 35, 38, 39],
            6: [92, 93],
            7: [106, 107, 108, 109, 110, 111, 112, 113],
            8: [97, 98, 100, 101, 104, 105, 106, 118, 121],
            9: [1, 2, 7, 8, 10, 11, 14, 15, 16],
            10: [29],
            11: [14, 17, 18],
            12: [21, 22, 34, 38, 39, 40, 41],
            13: [23, 24, 27, 35, 36, 37, 38, 39, 42, 43],
            14: [108, 113],
            15: [106, 107, 108, 111],
            16: [92, 93],
            17: [108, 114],
            18: [89, 90, 91],
            19: [91],
            20: [49, 51, 52, 55, 56, 57, 58, 60, 62, 64, 72, 76, 80, 83, 85, 87, 88],
            21: [106, 107, 108],
            22: [3, 9, 13, 14, 17],
            23: [4, 5, 6, 10, 11, 12],
            24: [96, 97, 99, 100, 102, 103, 104, 105, 106, 119, 120, 121, 122],
            25: [51, 55, 57, 58, 59, 60, 61, 62, 63, 64, 65, 72, 76, 77, 78, 79, 81, 82, 83, 84, 85, 87, 88],
            26: [44, 45, 46, 47, 48],
            27: [97, 98, 100, 101, 104, 105, 106, 118, 121],
          };

          selectedCheckboxByLayer.forEach((idx) => {
            if (selectMap[idx]) {
              selectCheckboxes(selectMap[idx]);
            }
          });

          VisualizateNeurons();
          updateSelectedCount(); // Call the function to update the count
        } else {
          AllNT.disabled = false;
          RankNT.disabled = false;
          CanonicalNT.disabled = false;
          selectedCheckboxByLayer = [];
          VisualizateNeurons();
          updateSelectedCount(); // Call the function to update the count
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
    document.getElementById("typeHeading").style.visibility = "hidden";
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
                console.log("ID:" + checkbox.id);
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

  document.getElementById("simTimestep").addEventListener("change", (e) => {
    updateSimTimestep(e.target.value);
  });

  document.getElementById("stepDuration").addEventListener("change", (e) => {
    updateStepDuration(e.target.value);
  });
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

function updateSimTimestep(value) {
  playbackConfig.simTimestep = parseFloat(value);
  autoRestartIfRunning(); // <== Restart with new config
}

function updateStepDuration(value) {
  playbackConfig.stepDuration = parseFloat(value);
  autoRestartIfRunning(); // <== Restart with new config
}
function autoRestartIfRunning() {
  if (interval && !isPaused) {
    clearInterval(interval);
    startAnimation();
  }
}

document.addEventListener("DOMContentLoaded", function () {
  const sidebar = document.getElementById("mySidebar");
  const btnOpen = document.getElementById("btnopen");
  const btnClose = document.getElementById("btnclose");

  btnOpen.addEventListener("click", function () {
    sidebar.style.display = "block"; // ✅ make it visible
    sidebar.style.width = "220px"; // ✅ slide open
  });

  btnClose.addEventListener("click", function () {
    sidebar.style.width = "0"; // ✅ slide close
    setTimeout(() => {
      sidebar.style.display = "none";
      sidebar.style.transition = "0.9s";
    }, 500); // match your CSS transition duration
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
  document.getElementById("lblnetwork").innerText = "Network :";
  document.getElementById("typeHeading").style.visibility = "hidden";
  removeTable();
  chkpanle = false;
}

CreateScene();
disableAllElements();
