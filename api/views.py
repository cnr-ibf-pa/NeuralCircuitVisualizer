
import base64
from django.http import JsonResponse
from django.views.decorators.csrf import csrf_exempt
import numpy as np
import json, csv
# from io import BytesIO
from django.http import JsonResponse
from django.conf import settings
import ujson
import pandas as pd
import os
import array
import requests
from time import sleep
import time
from django.core.paginator import Paginator
from functools import lru_cache
import h5py
import matplotlib
matplotlib.use('Agg')  # Use non-GUI backend for Matplotlib
import matplotlib.pyplot as plt
import matplotlib.ticker as ticker
import io
import networkx as nx
from collections import defaultdict


@csrf_exempt
def upload_and_save_Network_file(request):
    try:
        if request.method == 'POST' and request.FILES.get('file'):
            uploaded_file = request.FILES.get('file')
            chunk_index = request.POST.get('chunkIndex')
            total_chunks = request.POST.get('totalChunks')
            unique_directory = request.POST.get('uniqueDirectory')
            ext = request.POST.get('fileType')



            if not all([chunk_index, total_chunks, unique_directory,ext]):
                return JsonResponse({'error': 'Missing parameters'}, status=400)

            try:
                chunk_index = int(chunk_index)
                total_chunks = int(total_chunks)
            except ValueError:
                return JsonResponse({'error': 'Invalid parameters'}, status=400)

            file_directory = os.path.join(settings.MEDIA_ROOT, 'csv', unique_directory)
            os.makedirs(file_directory, exist_ok=True)  # Ensure the directory exists

            # Save chunk to a temporary file
            temp_file_path = os.path.join(file_directory, f"{uploaded_file.name}.part{chunk_index}")
            with open(temp_file_path, 'wb+') as temp_file:
                for chunk_data in uploaded_file.chunks():
                    temp_file.write(chunk_data)


            # Process the file after the last chunk is uploaded
            if chunk_index == total_chunks - 1:
                final_file_path = os.path.join(file_directory, uploaded_file.name)
                with open(final_file_path, 'wb') as final_file:
                    for i in range(total_chunks):
                        part_path = os.path.join(file_directory, f"{uploaded_file.name}.part{i}")
                        # Retry mechanism
                        for _ in range(8):  # Retry 5 times
                            if os.path.exists(part_path):
                                with open(part_path, 'rb') as part_file:
                                    final_file.write(part_file.read())
                                os.remove(part_path)  # Optionally, remove the part file after it is read
                                break
                            else:
                                time.sleep(2)  # Wait 0.5 seconds before retrying
                        else:
                            return JsonResponse({'error': f'Part file not found: {part_path}'}, status=500)


                if ext == 'csv':
                    file_type = detect_file_type(final_file_path)
                    if file_type == 'network':
                        process_network_csv(final_file_path)
                    elif file_type == 'activity':
                        # process_activity_csv(final_file_path,json_directory)
                        activity_file_path = os.path.join(file_directory, 'activity.csv')
                        os.rename(final_file_path, activity_file_path)
                elif ext == 'hdf5':
                    # list_hdf5_datasets(final_file_path)
                    process_hdf5_file(final_file_path)

            response_data = {'status': 'success'}
            return JsonResponse(response_data, safe=False, content_type='application/json')

    except Exception as e:
        return JsonResponse({'error': str(e)}, status=500)

def detect_file_type(file_path):
    """ Detects if the file is an activity (2 columns) or network (4 columns) file. """
    with open(file_path, 'r') as csv_file:
        reader = csv.reader(csv_file)
        for row in reader:
            if len(row) == 2:
                return 'activity'
            elif len(row) == 4:
                return 'network'
    return 'unknown'

def process_network_csv(file_path):
    json_directory = os.path.dirname(file_path)


    json_path = os.path.join(json_directory, f"network.json")

   # Read the CSV and write to JSON
    with open(file_path, 'r') as csv_file, open(json_path, 'w') as json_file:
        json_data = []
        csv_reader = csv.reader(csv_file)  # Use csv.reader to avoid treating the first row as a header

        for row in csv_reader:
            try:
                # Ensure the row has at least 4 values
                if len(row) >= 4:
                    json_data.append({
                        'id': int(row[0]),
                        'x': float(row[1]),
                        'y': float(row[2]),
                        'z': float(row[3]),
                        # Uncomment if the `type` column is present in the data
                        # 'type': int(row[4]) if len(row) > 4 else None
                    })

            except (ValueError, IndexError) as e:
                print(f"Error processing row: {row} - {e}")

    # Write all data to JSON in a single valid structure
    with open(json_path, 'w') as json_file:
        json.dump(json_data, json_file)
        # json.dump(json_data, json_file, indent=4)   ## for valid json structure use of indent

    # Delete the original CSV file after processing
    try:
        os.remove(file_path)
    except OSError as e:
        print(f"Error deleting file {file_path}: {e}")


def process_hdf5_file(file_path):
    json_directory = os.path.dirname(file_path)
    network_json_path = os.path.join(json_directory, "network.json")
    activity_csv_path = os.path.join(json_directory, "activity.csv")

    with h5py.File(file_path, 'r') as hdf_file:
        # Process the 'network' dataset
        if 'network' in hdf_file:
            network_data = hdf_file['network'][:]
            if network_data.shape[1] == 4:
                network_json = []
                for record in network_data:
                    try:
                        network_json.append({
                            'id': int(record[0]),
                            'x': float(record[1]),
                            'y': float(record[2]),
                            'z': float(record[3])
                        })
                    except (ValueError, IndexError) as e:
                        print(f"Error processing network record: {e}")

                # Save network JSON
                with open(network_json_path, 'w') as json_file:
                    json.dump(network_json, json_file)
        else:
            print("Dataset 'network' not found in HDF5 file.")

        # Process the 'spikes' or 'activity' dataset
        if 'spikes' in hdf_file or 'activity' in hdf_file:
            dataset_name = 'spikes' if 'spikes' in hdf_file else 'activity'
            spikes_data = hdf_file[dataset_name][:]

            if spikes_data.shape[1] == 2:
                df = pd.DataFrame(spikes_data)
                df.to_csv(activity_csv_path, index=False, header=False)
            else:
                print(f"Dataset '{dataset_name}' does not have 2 columns as expected.")
        else:
            print("Neither 'spikes' nor 'activity' dataset found in HDF5 file.")


@csrf_exempt
def fetch_user_network_data(request):
    try:
        unique_directory = request.GET.get('dir')
        if not unique_directory:
            return JsonResponse({'error': 'Missing directory identifier'}, status=400)

        json_directory = os.path.join(settings.MEDIA_ROOT, 'csv', unique_directory)
        if not os.path.exists(json_directory):
            return JsonResponse({'error': 'Directory not found'}, status=404)

        data_list = []
        lstresponse = []
        total_size = 0
        flag_check = 0

        network_file_path = os.path.join(json_directory, "network.json")
        if os.path.exists(network_file_path):
            with open(network_file_path, 'r') as f:
                file_data = ujson.load(f)
                total_excitatory = sum(1 for neuro in file_data if neuro.get('type') == 1)
                total_inhibitory = sum(1 for neuro in file_data if neuro.get('type') != 1)
                total_neurons = len(file_data)

                data_list.append({
                    'filename': "network.json",
                    'fileData': file_data,
                    'total_neurons': total_neurons,
                    'total_excitatory': total_excitatory,
                    'total_inhibitory': total_inhibitory,
                    'json_directory': json_directory,
                })
                total_size += (os.path.getsize(network_file_path) / (1024 * 1024))

        activity_file_path = os.path.join(json_directory, "activity.csv")
        if os.path.exists(activity_file_path):
            flag_check = 1

            try:
                CHUNK_SIZE = 100 * 1024 * 1024
                try:
                    csv_data = pd.read_csv(activity_file_path, header=None, names=['id', 't'], encoding='utf-8')
                except UnicodeDecodeError:

                    csv_data = pd.read_csv(activity_file_path, header=None, names=['id', 't'], encoding='latin1')

                data_dict = csv_data.groupby('t')['id'].agg(list).to_dict()

                chunk_number = 0
                first_last_keys = []
                chunk_mfr_list = []
                current_chunk_size = 0
                current_data_dict = {}

                for key, values in data_dict.items():
                    entry_size = len(ujson.dumps({key: values}))

                    if current_chunk_size + entry_size > CHUNK_SIZE and current_data_dict:
                        times_in_chunk = list(current_data_dict.keys())
                        t_min = float(times_in_chunk[0])
                        t_max = float(times_in_chunk[-1])
                        total_time_sec = (t_max - t_min) / 1000.0
                        total_spikes = sum(len(v) for v in current_data_dict.values())
                        unique_neurons = set(gid for v in current_data_dict.values() for gid in v)
                        total_neurons = len(unique_neurons)
                        mfr = round((total_spikes / total_neurons) / total_time_sec, 2) if total_neurons > 0 and total_time_sec > 0 else 0

                        chunk_mfr_list.append({
                            "first_key": t_min,
                            "last_key": t_max,
                            "chunk_number": chunk_number,
                            "MFR": mfr
                        })
                        first_last_keys.append({'chunk_number': chunk_number, 'first_key': t_min, 'last_key': t_max})

                        chunk_file_path = os.path.join(json_directory, f'activity_chunk_{chunk_number}.json')
                        with open(chunk_file_path, 'w') as f:
                            ujson.dump(current_data_dict, f)

                        current_data_dict = {}
                        current_chunk_size = 0
                        chunk_number += 1

                    current_data_dict[key] = values
                    current_chunk_size += entry_size

                if current_data_dict:
                    times_in_chunk = list(current_data_dict.keys())
                    t_min = float(times_in_chunk[0])
                    t_max = float(times_in_chunk[-1])
                    total_time_sec = (t_max - t_min) / 1000.0
                    total_spikes = sum(len(v) for v in current_data_dict.values())
                    unique_neurons = set(gid for v in current_data_dict.values() for gid in v)
                    total_neurons = len(unique_neurons)
                    mfr = round((total_spikes / total_neurons) / total_time_sec, 2) if total_neurons > 0 and total_time_sec > 0 else 0

                    chunk_mfr_list.append({
                        "first_key": t_min,
                        "last_key": t_max,
                        "chunk_number": chunk_number,
                        "MFR": mfr
                    })
                    first_last_keys.append({'chunk_number': chunk_number, 'first_key': t_min, 'last_key': t_max})

                    final_chunk_file_path = os.path.join(json_directory, f'activity_chunk_{chunk_number}.json')
                    with open(final_chunk_file_path, 'w') as f:
                        ujson.dump(current_data_dict, f)

                total_activity_files = chunk_number + 1
                lstresponse = {
                    'OUTPUT_FOLDER': json_directory,
                    'total_lines': len(csv_data),
                    'total_activity_files': total_activity_files,
                    'first_last_keys': first_last_keys,
                    'chunk_mfr_list': chunk_mfr_list
                }

            except Exception as e:
                return JsonResponse({'error': f'Error processing activity file: {str(e)}'}, status=500)

        response_data = {
            'files': data_list,
            'lstresponse': lstresponse,
            'total_size': total_size,
            'flag_check': flag_check
        }
        return JsonResponse(response_data, safe=False, content_type='application/json')

    except Exception as e:
        return JsonResponse({'error': str(e)}, status=500)


def get_chunk_data(request):

    chunk_number = request.GET.get("chunk_number")  # Get chunk number from request
    unique_directory = request.GET.get("dir")  # Get chunk number from request

    if not chunk_number:
        return JsonResponse({"error": "No chunk number provided"}, status=400)

    chunk_file_path = os.path.join(settings.MEDIA_ROOT, 'csv', unique_directory)
    unique_directory = os.path.join(settings.MEDIA_ROOT, 'csv', unique_directory)

    activity_file_path = os.path.join(chunk_file_path,  f"activity_chunk_{chunk_number}.json")
    try:
        with open(activity_file_path, "r") as f:
            chunk_data = ujson.load(f)
    except Exception as e:
        return JsonResponse({"error": f"Error loading activity.json: {str(e)}"}, status=500)



    # Process GIDs from network.json
    network_file_path = os.path.join(unique_directory, "network.json")
    Gids_array = extract_ids_from_json(network_file_path)

    gids_activity_indexes = get_activity_indexes(chunk_data, Gids_array)
    # print("length gids:    ",len(gids_activity_indexes))

    # Cache GIDs activity indexes
    cache_file_path = os.path.join(chunk_file_path, 'gids_activity_indexes.json')
    try:
        with open(cache_file_path, 'w') as f:
            ujson.dump(gids_activity_indexes, f)
    except Exception as e:
        return JsonResponse({"error": f"Error saving gids_activity_indexes.json: {str(e)}"}, status=500)


    # Extract `t` values (time) and count spikes per time bin
    try:

        total_spikes = sum(len(activity_ids) for activity_ids in chunk_data.values())
        # Generate visualization images
        # raster_img = generate_raster_plot(chunk_data)
        hist_img = generate_spike_histogram(chunk_data, chunk_number)

       # Return both chunk data and GIDs activity indexes in a single response
        return JsonResponse({
            "chunk_data": chunk_data,
            "total_spikes": total_spikes,  # Total spikes count
            # "raster_plot": raster_img,
            "histogram": hist_img,
            "gids_activity_indexes": gids_activity_indexes
        })

    except Exception as e:
        return JsonResponse({"error": f"Error generating histogram: {str(e)}"}, status=500)


def generate_raster_plot(chunk_data):
    try:
        if not chunk_data:
            return "Error: No data available for plotting."

        spike_times = []
        for t_str, gids in chunk_data.items():
            t = float(t_str)
            for gid in gids:
                spike_times.append((t, gid))

        # Convert to DataFrame
        raster_df = pd.DataFrame(spike_times, columns=["t", "gid"])

        # Create raster plot
        plt.figure(figsize=(12, 6))
        plt.scatter(raster_df["t"], raster_df["gid"], s=2, color="darkred", alpha=0.7)
        plt.title("Raster Plot of Spike Activity")
        plt.xlabel("Time (ms)")
        plt.ylabel("Neuron GID")
        plt.grid(True, linestyle="--", alpha=0.5)
        plt.tight_layout()
        plt.show()

        # Save as High-Resolution Image
        img_buffer = io.BytesIO()
        plt.savefig(img_buffer, format="png", bbox_inches="tight", dpi=900)
        img_buffer.seek(0)
        img_base64 = base64.b64encode(img_buffer.getvalue()).decode("utf-8")




        return img_base64

    except Exception as e:
        return f"Error generating raster plot: {str(e)}"



def generate_spike_histogram(chunk_data, chunk_number, bins=100, color="white"):
    try:
        if not chunk_data or not isinstance(chunk_data, dict):
            return "Error: No data available for plotting."

        # Convert all spike times to float for histogram binning
        all_spike_times = []
        active_neurons = set()
        for t_str, gids in chunk_data.items():
            t = float(t_str)
            all_spike_times.extend([t] * len(gids))  # Repeat time per spiking GID
            active_neurons.update(gids)

        # Compute histogram data
        t_min, t_max = min(all_spike_times), max(all_spike_times)
        bin_edges = np.linspace(t_min, t_max, bins + 1)
        spike_counts, _ = np.histogram(all_spike_times, bins=bin_edges)

        # Compute Mean Firing Rate (MFR)
        total_spikes = len(all_spike_times)
        total_neurons = len(active_neurons)
        total_time_sec = (t_max - t_min) / 1000.0  # convert ms to seconds
        mfr = (total_spikes / total_neurons) / total_time_sec if total_neurons > 0 and total_time_sec > 0 else 0
        # Create figure and axis
        fig, ax = plt.subplots(figsize=(12, 6), dpi=300)
        fig.patch.set_facecolor("#33373d")
        ax.set_facecolor("#33373d")

        # Plot histogram
        bars = ax.bar(bin_edges[:-1], spike_counts, width=np.diff(bin_edges), color=color, alpha=0.7, edgecolor="black")

        # Annotate bars for legend
        legend_labels = {
            "# Max Spike": max(spike_counts),
            "# Min Spike": min(spike_counts),
            "# Spikes": total_spikes,
            "# Neurons": total_neurons,
        }
        legend_text = "\n".join([f"{key}: {value}" for key, value in legend_labels.items()])
        plt.gcf().text(
            0.80, 0.79, legend_text,
            fontsize=8,
            bbox=dict(facecolor='white', alpha=0.5),
            color='black'
        )

        ax.set_xlim(t_min, t_max)
        ax.set_xlabel("Time (ms)", fontsize=16, fontweight="bold", color="white")
        ax.set_ylabel("Number of Firing Neurons", fontsize=16, fontweight="bold", color="white")
        ax.set_title(f"Chunk {chunk_number} - MFR: {mfr:.2f} Hz", fontsize=18, fontweight="bold", color="white")

        ax.tick_params(axis='x', colors='white')
        ax.tick_params(axis='y', colors='white')
        ax.xaxis.set_major_locator(ticker.MaxNLocator(nbins=10))
        ax.grid(True, linestyle="--", alpha=0.4)

        for label in ax.get_xticklabels() + ax.get_yticklabels():
            label.set_color("white")

        img_buffer = io.BytesIO()
        plt.savefig(img_buffer, format="png", bbox_inches="tight", dpi=300, facecolor=fig.get_facecolor())
        img_buffer.seek(0)
        img_base64 = base64.b64encode(img_buffer.getvalue()).decode("utf-8")
        plt.close()

        return img_base64
    except Exception as e:
        return f"Error generating spike histogram: {str(e)}"


def generate_network_graph(network_data):
    try:
        if not network_data:
            print("No network data available.")
            return None
        # Create a directed graph
        G = nx.DiGraph()

        # Add edges (connections)
        for pre_neuron, post_neurons in network_data.items():
            for post_neuron in post_neurons:
                G.add_edge(pre_neuron, post_neuron)

        # Draw the network
        plt.figure(figsize=(8, 6))
        pos = nx.spring_layout(G, seed=42)  # Layout for better visualization
        nx.draw(G, pos, node_size=10, edge_color="gray", width=0.5)
        plt.title("Neuron Connectivity Graph")

        # Convert to Base64
        img_buffer = io.BytesIO()
        plt.savefig(img_buffer, format="png")
        img_buffer.seek(0)
        img_base64 = base64.b64encode(img_buffer.getvalue()).decode("utf-8")

        plt.close()  # Free memory
        return img_base64
    except Exception as e:
        return str(e)


@csrf_exempt
def get_activity_data_by_file_name(request):
    try:


        unique_directory = request.GET.get('dir')
        page = int(request.GET.get('page', 1))
        items_per_page = int(request.GET.get('items_per_page', 300))

        if not unique_directory:
            return JsonResponse({'error': 'Missing directory identifier'}, status=400)

        json_directory = os.path.join(settings.MEDIA_ROOT, 'csv', unique_directory)
        final_json_file_path = os.path.join(json_directory, 'activity_data.json')

        if not os.path.exists(final_json_file_path):
            return JsonResponse({'error': 'JSON file not found'}, status=404)

        with open(final_json_file_path, 'r') as f:
            data_dict = ujson.load(f)

        # Paginate the data dictionary
        paginator = Paginator(list(data_dict.items()), items_per_page)
        paginated_data = paginator.get_page(page)

        paginated_data_dict = {key: value for key, value in paginated_data}

        return JsonResponse(paginated_data_dict, safe=False)

    except Exception as e:
        return JsonResponse({'error': str(e)}, status=500)



# Cache the JSON data in memory
@lru_cache(maxsize=1)
def load_gids_activity_indexes(cache_file_path):
    with open(cache_file_path, 'r') as f:
        return ujson.load(f)


def extract_ids_from_json(json_file_path):
    """Extract IDs from the JSON file."""
    Gids_array = []

    # Read and process the JSON file
    try:
        with open(json_file_path, 'r') as json_file:
            for line in json_file:
                try:
                    json_data = json.loads(line)
                    if isinstance(json_data, list):
                        for node in json_data:
                            Gids_array.append(int(node['id']))
                except (KeyError, ValueError, json.JSONDecodeError) as e:
                    print(f"Error processing JSON line: {line.strip()} - {e}")
    except FileNotFoundError:
        print(f"File not found: {json_file_path}")
    except Exception as e:
        print(f"An error occurred: {e}")

    return array.array('i', Gids_array)


@csrf_exempt
def LoadActivityData(request):
    try:
        if request.method == 'POST':
            Gids_array = []
            gids_activity_indexes = {}
            number_of_spikes = 0

            file_id = request.GET.get('dir')
            if not file_id:
                return JsonResponse({'error': 'Missing file ID'}, status=400)

            json_directory = os.path.join(settings.MEDIA_ROOT, 'hip_form', "activities")
            if file_id == '1':
                final_csv_file_path = os.path.join(json_directory, 'Activity_CA3.csv')
            elif file_id == '2':
                final_csv_file_path = os.path.join(json_directory, 'Activity_MEC.csv')
            else:
                return JsonResponse({'error': 'Invalid file ID'}, status=400)

            # Handle GIDs if they are present
            gIDs_raw = request.POST.get('gIDs')
            if gIDs_raw:
                try:
                    Gids_list = json.loads(gIDs_raw)
                except json.JSONDecodeError:
                    Gids_list = gIDs_raw.split(',')

                try:
                    Gids_array = array.array('i', map(lambda x: int(float(x)), Gids_list))
                except ValueError as e:
                    return JsonResponse({'error': f'Invalid GIDs data: {e}'}, status=400)

            data = parse_activity_csv(final_csv_file_path)
            keys = sorted(data.keys(), key=float)


            gids_activity_indexes = get_activity_indexes(data, Gids_array)
            number_of_spikes = count_csv_lines(final_csv_file_path)

            response_data = {
                'data': data,
                'keys': keys,
                'gids_activity_indexes': gids_activity_indexes,
                'number_of_spikes': number_of_spikes,
            }
            return JsonResponse(response_data, safe=False)

        return JsonResponse({'error': 'Invalid HTTP method'}, status=405)

    except Exception as e:
        print("Error in LoadActivityData:", e)
        return JsonResponse({'error': str(e)}, status=500)


def parse_activity_csv(filepath):
    activity_data = defaultdict(list)
    with open(filepath, newline='') as csvfile:
        reader = csv.reader(csvfile)
        header = next(reader)  # Skip header, if present

        for row in reader:
            gid = int(row[0])
            time = float(row[1])
            activity_data[str(time)].append(gid)

    return dict(activity_data)

@csrf_exempt
def LoadAllLayers(request):
    try:

        json_directory = os.path.join(settings.MEDIA_ROOT, "hip_form")

        data_list = []
        total_size = 0
        # connections = {}
        # Iterate over each JSON file in the directory
        for filename in sorted(os.listdir(json_directory)):
            if filename.endswith(".json"):
                file_path = os.path.join(json_directory, filename)
                filename_without_ext = os.path.splitext(filename)[0]
                try:
                    with open(file_path, 'r') as f:
                        file_data = ujson.load(f)

                        total_excitatory = sum(1 for neuro in file_data if neuro.get('type') == 1)  # Count occurrences of 1 in the 'type' column
                        total_inhibitory = sum(1 for neuro in file_data if neuro.get('type') != 1)  # Count occurrences of 0 in the 'type' column
                        total_neuros = len(file_data)  # Count total neurons

                        data_list.append({
                            'filename': filename_without_ext,
                            'fileData': file_data,
                            'total_neuros': total_neuros,
                            'total_excitatory': total_excitatory,
                            'total_inhibitory': total_inhibitory,
                            # 'connections':connections
                        })
                        total_size += os.path.getsize(file_path)/ (1024 * 1024)  # Calculate total size in MB
                except json.JSONDecodeError as e:
                    print(f"Error decoding JSON from file {file_path}: {e}")
                except Exception as e:
                    print(f"Error reading file {file_path}: {e}")



        # response_data = {'files': "", 'total_size': total_size, 'connections': connections}
        response_data = {'files': data_list, 'total_size': total_size}
        return JsonResponse(response_data, safe=False)

    except requests.RequestException as e:
        print(f"Request error: {e}")
        return JsonResponse({'error': 'Failed to fetch data from EBRAINS'}, status=500)

    except Exception as e:
        print(f"An error occurred: {e}")
        return JsonResponse({'error': 'An unexpected error occurred'}, status=500)

def count_csv_lines(file_path):
    with open(file_path, 'r') as f:
        return sum(1 for line in f)

# @lru_cache(maxsize=1)  # Cache with single entry to avoid recomputation
# def compute_connections():
#     # Perform all setup computations
#     json_directory = os.path.join(settings.MEDIA_ROOT, "hip_form")
#     json_path = os.path.join(json_directory, "connections.json")
#     # print(json_directory)

#     ca3_file_paths = [
#         os.path.join(json_directory, 'CA3-sl.json'),
#         os.path.join(json_directory, 'CA3-slm.json'),
#         os.path.join(json_directory, 'CA3-so.json'),
#         os.path.join(json_directory, 'CA3-sp.json'),
#         os.path.join(json_directory, 'CA3-sr.json')
#     ]
#     ca1_file_paths = [
#         os.path.join(json_directory, 'CA1-slm.json'),
#         os.path.join(json_directory, 'CA1-so.json'),
#         os.path.join(json_directory, 'CA1-sp.json'),
#         os.path.join(json_directory, 'CA1-sr.json')
#     ]

#     ca3_neurons = pd.DataFrame(load_neurons_from_files(ca3_file_paths))
#     ca1_neurons = pd.DataFrame(load_neurons_from_files(ca1_file_paths))

#     ca3_pyramidal = ca3_neurons[ca3_neurons['ntype'] == 19].copy()
#     ca1_pyramidal = ca1_neurons[ca1_neurons['ntype'] == 49].copy()

#     MOUSE_VOLUME_SR = 2.83
#     RAT_VOLUME_SR = 10.95
#     MOUSE_VOLUME_SO = 1.5
#     RAT_VOLUME_SO = 6.47

#     SF_SR = calculate_scaling_factor(RAT_VOLUME_SR, MOUSE_VOLUME_SR)
#     SF_SO = calculate_scaling_factor(RAT_VOLUME_SO, MOUSE_VOLUME_SO)

#     L_SR_mouse = 4465.3 / SF_SR
#     L_SO_mouse = 3795.59 / SF_SO
#     L_SO_adjusted = L_SO_mouse / 2
#     L_total_mouse = L_SR_mouse + L_SO_adjusted
#     Inter_spine_distance = 1.09
#     total_spines = L_total_mouse / Inter_spine_distance
#     CA3_to_CA1_Per_Contacts = 1.62
#     total_synapses = total_spines / CA3_to_CA1_Per_Contacts
#     CA1PC_census = 159341
#     CA3PC_census = 75376
#     average_CA1_contacted_by_CA3 = total_synapses / (CA1PC_census / CA3PC_census)

#     z_median_ca3 = ca3_neurons['z'].median()
#     z_median_ca1 = ca1_neurons['z'].median()
#     reference_point = np.array([ca3_neurons['x'].mean(), ca3_neurons['y'].mean()])

#     ca3_pyramidal['dorsal_ventral'] = np.where(ca3_pyramidal['z'] > z_median_ca3, 'dorsal', 'ventral')
#     ca3_pyramidal['prox_dist'] = np.where(np.linalg.norm(ca3_pyramidal[['x', 'y']].values - reference_point, axis=1) <
#                                           np.median(np.linalg.norm(ca3_pyramidal[['x', 'y']].values - reference_point, axis=1)),
#                                           'proximal', 'distal')

#     ca1_pyramidal['dorsal_ventral'] = np.where(ca1_pyramidal['z'] > z_median_ca1, 'dorsal', 'ventral')
#     ca1_pyramidal['prox_dist'] = np.where(np.linalg.norm(ca1_pyramidal[['x', 'y']].values - reference_point, axis=1) <
#                                           np.median(np.linalg.norm(ca1_pyramidal[['x', 'y']].values - reference_point, axis=1)),
#                                           'proximal', 'distal')

#     # Connect CA3 and CA1 pyramidal cells
#     connections = connect_all_pyramidal(ca3_pyramidal, ca1_pyramidal, average_CA1_contacted_by_CA3)
#     # Save to JSON
#     with open(json_path, 'w') as f:
#         json.dump(connections, f)
        
#     return json_path



@lru_cache(maxsize=1)
def compute_connections():
    json_directory = os.path.join(settings.MEDIA_ROOT, "hip_form")
    json_path = os.path.join(json_directory, "connections.json")

    ca3_file_paths = [
        os.path.join(json_directory, f"CA3-{layer}.json") for layer in ["sl", "slm", "so", "sp", "sr"]
    ]
    ca1_file_paths = [
        os.path.join(json_directory, f"CA1-{layer}.json") for layer in ["slm", "so", "sp", "sr"]
    ]

    ca3_neurons = pd.DataFrame(load_neurons_from_files(ca3_file_paths))
    ca1_neurons = pd.DataFrame(load_neurons_from_files(ca1_file_paths))

    # Select pyramidal cells
    ca3_pyramidal = ca3_neurons[ca3_neurons['ntype'] == 19].copy()
    ca1_pyramidal = ca1_neurons[ca1_neurons['ntype'] == 49].copy()

    # Dendritic length-based synapse estimation
    SF_SR = calculate_scaling_factor(rat_volume=10.95, mouse_volume=2.83)
    SF_SO = calculate_scaling_factor(rat_volume=6.47, mouse_volume=1.5)
    L_SR_mouse = 4465.3 / SF_SR
    L_SO_mouse = (3795.59 / SF_SO) / 2
    L_total_mouse = L_SR_mouse + L_SO_mouse

    total_spines = L_total_mouse / 1.09  # spine spacing
    total_synapses = total_spines / 1.62  # avg. synapses per connection
    avg_targets = total_synapses / (159341 / 75376)  # CA1/CA3 ratio from census

    # Region classification
    z_median_ca3 = ca3_neurons['z'].median()
    z_median_ca1 = ca1_neurons['z'].median()
    xy_ref = np.array([ca3_neurons['x'].mean(), ca3_neurons['y'].mean()])

    ca3_pyramidal['dorsal_ventral'] = np.where(ca3_pyramidal['z'] > z_median_ca3, 'dorsal', 'ventral')
    ca1_pyramidal['dorsal_ventral'] = np.where(ca1_pyramidal['z'] > z_median_ca1, 'dorsal', 'ventral')

    ca3_pyramidal['prox_dist'] = np.where(
        np.linalg.norm(ca3_pyramidal[['x', 'y']].values - xy_ref, axis=1) <
        np.median(np.linalg.norm(ca3_pyramidal[['x', 'y']].values - xy_ref, axis=1)),
        'proximal', 'distal'
    )
    ca1_pyramidal['prox_dist'] = np.where(
        np.linalg.norm(ca1_pyramidal[['x', 'y']].values - xy_ref, axis=1) <
        np.median(np.linalg.norm(ca1_pyramidal[['x', 'y']].values - xy_ref, axis=1)),
        'proximal', 'distal'
    )

    # Build region-constrained connections using Gaussian sampling
    connections = connect_all_pyramidal(ca3_pyramidal, ca1_pyramidal, avg_targets)

    with open(json_path, 'w') as f:
        json.dump(connections, f)

    return json_path




# @csrf_exempt
# def fetchConnections(request):
#     try:
#         connections = compute_connections()  # Retrieve precomputed connections



#         chunk_size = int(request.GET.get("chunk_size", 1000))
#         page = int(request.GET.get("page", 1))

#         keys = list(connections.keys())
#         start = (page - 1) * chunk_size
#         end = start + chunk_size
#         chunk = {k: connections[k] for k in keys[start:end]}

#         response_data = {'connections_chunk': chunk, 'page': page, 'has_more': end < len(keys)}
#         return JsonResponse(response_data)

#     except Exception as e:
#         return JsonResponse({'error': str(e), 'connections': {}}, status=500)

@csrf_exempt
def fetchConnections(request):
    try:
        # Ensure file is generated
        # json_path = compute_connections()
        json_path = os.path.join(settings.MEDIA_ROOT, "hip_form","connections", "connections.json")
        # print("connections built...........")

        # Load full data from file
        with open(json_path, 'r') as f:
            connections = json.load(f)

        # Chunking logic
        chunk_size = int(request.GET.get("chunk_size", 10000))
        page = int(request.GET.get("page", 1))

        keys = list(connections.keys())
        total_pages = (len(keys) + chunk_size - 1) // chunk_size
        start = (page - 1) * chunk_size
        end = start + chunk_size

        chunk = {k: connections[k] for k in keys[start:end]}
        response_data = {
            'connections_chunk': chunk,
            'page': page,
            'has_more': end < len(keys),
            'total_pages': total_pages,
            'total_keys': len(keys)
        }
        return JsonResponse(response_data)

    except Exception as e:
        return JsonResponse({'error': str(e), 'connections': {}}, status=500)


def load_neurons_from_files(file_paths):
    for file_path in file_paths:
        yield from load_json_file_generator(file_path)

# Generator to load JSON files and yield one neuron at a time
def load_json_file_generator(file_path):
    try:
        with open(file_path, 'r') as file:
            data = json.load(file)
            for neuron in data:
                yield {
                    'gid': neuron.get('id'),
                    'x': neuron.get('x'),
                    'y': neuron.get('y'),
                    'z': neuron.get('z'),
                    'type': neuron.get('type'),
                    'ntype': neuron.get('ntype')
                }
    except json.JSONDecodeError as e:
        print(f"Error decoding JSON from {file_path}: {e}")

def calculate_scaling_factor(rat_volume,mouse_volume):
    # Formula: Scaling Factor = (Rat Volume / Mouse Volume)^(1/3)
    scaling_factor = (rat_volume/mouse_volume) ** (1/3)
    return scaling_factor

def connect_all_pyramidal(ca3_neurons, ca1_neurons, average_CA1_contacted_by_CA3):
    connections = {}

    try:
        # Process region-based connections (Dorsal/Ventral, Proximal/Distal)

        # Dorsal-Dorsal connections
        ca3_dorsal = ca3_neurons[ca3_neurons['dorsal_ventral'] == 'dorsal']
        ca1_dorsal = ca1_neurons[ca1_neurons['dorsal_ventral'] == 'dorsal']
        connections.update(connect_regions_regionally(ca3_dorsal, ca1_dorsal, average_CA1_contacted_by_CA3))

        # Ventral-Ventral connections
        ca3_ventral = ca3_neurons[ca3_neurons['dorsal_ventral'] == 'ventral']
        ca1_ventral = ca1_neurons[ca1_neurons['dorsal_ventral'] == 'ventral']
        connections.update(connect_regions_regionally(ca3_ventral, ca1_ventral, average_CA1_contacted_by_CA3))

        # Proximal-Proximal connections
        ca3_proximal = ca3_neurons[ca3_neurons['prox_dist'] == 'proximal']
        ca1_proximal = ca1_neurons[ca1_neurons['prox_dist'] == 'proximal']
        connections.update(connect_regions_regionally(ca3_proximal, ca1_proximal, average_CA1_contacted_by_CA3))

        # Distal-Distal connections
        ca3_distal = ca3_neurons[ca3_neurons['prox_dist'] == 'distal']
        ca1_distal = ca1_neurons[ca1_neurons['prox_dist'] == 'distal']
        connections.update(connect_regions_regionally(ca3_distal, ca1_distal, average_CA1_contacted_by_CA3))

    except Exception as e:
        print(f"Error in connect_all_pyramidal: {e}")

    return connections

# # Helper function to connect neurons within the same region
# def connect_regions_regionally(ca3_subset, ca1_subset, average_CA1_contacted_by_CA3):
#     try:
#         connections = {}
#         # Each CA3 PC contacts approximately average_CA1_contacted_by_CA3 CA1 PCs
#         for _, ca3_neuron in ca3_subset.iterrows():
#             num_contacts = int(average_CA1_contacted_by_CA3)
#             ca1_selected = ca1_subset.sample(n=num_contacts, replace=False)
#             connections[ca3_neuron['gid']] = ca1_selected['gid'].tolist()
#         return connections
#     except Exception as e:
#         print(f"Error in connect_regions_regionally: {e}")
#         return {}



def compute_sigma(ca1_subset, factor=0.3):
    bbox_size = np.max(ca1_subset[['x', 'y', 'z']].values, axis=0) - np.min(ca1_subset[['x', 'y', 'z']].values, axis=0)
    avg_extent = np.mean(bbox_size)
    return factor * avg_extent  # Adaptive σ

def connect_regions_regionally(ca3_subset, ca1_subset, average_CA1_contacted_by_CA3):
    """
    Connects neurons within the same anatomical region using Gaussian-weighted sampling.
    """
    try:
        connections = {}
        sigma = compute_sigma(ca1_subset)  # Dynamic sigma
        d_max = 500  # Optional: maximum radius in micrometers
        for _, ca3_neuron in ca3_subset.iterrows():
            connected_ids = safe_gaussian_connection(
                ca3_neuron, ca1_subset,
                num_targets=int(average_CA1_contacted_by_CA3),
                sigma=sigma,
                d_max=d_max
            )
            connections[ca3_neuron['gid']] = connected_ids
        return connections
    except Exception as e:
        print(f"Error in connect_regions_regionally: {e}")
        return {}



# def connect_regions_regionally(ca3_subset, ca1_subset, average_CA1_contacted_by_CA3):
#     try:
#         connections = {}
#         for _, ca3_neuron in ca3_subset.iterrows():
#             connected_ids = gaussian_weighted_connection(ca3_neuron, ca1_subset, num_targets=int(average_CA1_contacted_by_CA3), sigma=150)
#             connections[ca3_neuron['gid']] = connected_ids
#         return connections
#     except Exception as e:
#         print(f"Error in connect_regions_regionally: {e}")
#         return {}

# def gaussian_weighted_connection(ca3_neuron, ca1_subset, num_targets=10, sigma=200):
#     """
#     Selects CA1 neurons weighted by Gaussian probability based on distance from a CA3 neuron.
#     """
#     ca3_xyz = ca3_neuron[['x', 'y', 'z']].values.astype(float)
#     ca1_xyz = ca1_subset[['x', 'y', 'z']].values.astype(float)

#     distances = np.linalg.norm(ca1_xyz - ca3_xyz, axis=1)
#     weights = np.exp(- (distances ** 2) / (2 * sigma ** 2))

#     # Normalize to get probabilities
#     probs = weights / np.sum(weights)

#     # Randomly sample without replacement using the probabilities
#     selected_indices = np.random.choice(ca1_subset.index, size=min(num_targets, len(ca1_subset)), replace=False, p=probs)
#     return ca1_subset.loc[selected_indices, 'gid'].tolist()


def safe_gaussian_connection(ca3_neuron, ca1_subset, num_targets=10, sigma=150, d_max=None):
    """
    Attempts probabilistic sampling; falls back to nearest-neighbors if necessary.
    """
    ca3_xyz = ca3_neuron[['x', 'y', 'z']].values.astype(float)
    ca1_xyz = ca1_subset[['x', 'y', 'z']].values.astype(float)
    
    distances = np.linalg.norm(ca1_xyz - ca3_xyz, axis=1)
    
    # Optional cutoff to avoid distant targets
    if d_max is not None:
        mask = distances <= d_max
        if not np.any(mask):
            return []
        ca1_xyz = ca1_xyz[mask]
        distances = distances[mask]
        ca1_subset = ca1_subset.iloc[mask]

    # Compute Gaussian weights
    weights = np.exp(- (distances ** 2) / (2 * sigma ** 2))
    probs = weights / np.sum(weights)

    try:
        selected_indices = np.random.choice(
            ca1_subset.index,
            size=min(num_targets, len(ca1_subset)),
            replace=False,
            p=probs
        )
        return ca1_subset.loc[selected_indices, 'gid'].tolist()
    except Exception as e:
        # Fallback to nearest neighbors
        print(f"[Fallback] Gaussian sampling failed: {e}")
        ca1_subset = ca1_subset.copy()
        ca1_subset['distance'] = distances
        nearest = ca1_subset.nsmallest(num_targets, 'distance')
        return nearest['gid'].tolist()









def process_uploaded_file(file_path):
    # Determine paths and filenames
    json_directory = os.path.dirname(file_path)
    original_file_name = os.path.basename(file_path)
    file_name_without_extension = os.path.splitext(original_file_name)[0]
    json_path = os.path.join(json_directory, f"{file_name_without_extension}.json")

    fieldnames = ['id', 'x', 'y', 'z','type']

    # Read the CSV and write to JSON
    with open(file_path, 'r') as csv_file, open(json_path, 'w') as json_file:
        json_data = []
        csv_reader = csv.DictReader(csv_file, fieldnames=fieldnames)
        for row in csv_reader:

            # Convert row values and handle missing or invalid data
            json_data.append({
                'id': int(row['id']),
                'x': float(row['x']),
                'y': float(row['y']),
                'z': float(row['z']),
                'type': int(row['type'])
            })


            # Write to JSON every 1000 records to manage memory usage
            if len(json_data) >= 1000:
                ujson.dump(json_data, json_file)
                json_file.write('\n')
                json_data = []

        # Write any remaining data
        if json_data:
            ujson.dump(json_data, json_file)
            json_file.write('\n')

    # Delete the original CSV file after processing
    try:
        os.remove(file_path)
    except OSError as e:
        print(f"Error deleting file {file_path}: {e}")

def get_activity_indexes_for_SimulationData(activity_file, Gids):
    # Create a dictionary for quick lookup
    gids_dict = {int(float(id_)): index for index, id_ in enumerate(Gids)}

    try:
        with open(activity_file, 'r') as file:
            reader = csv.reader(file)

            # Sort rows based on the second column (index 1) and filter valid rows
            sorted_rows = sorted(
                (row for row in reader if row and len(row) > 1),  # Filter empty or malformed rows
                key=lambda row: float(row[1])
            )

            # Use a generator expression to build the result
            gids_activity_indexes = [
                gids_dict[int(row[0])]  # Map activity_id to its index
                for row in sorted_rows
                if int(row[0]) in gids_dict  # Only include valid activity IDs
            ]

    except ValueError as e:
        # Handle cases where the ID cannot be converted to int
        print(f"Skipping row due to ValueError: {e}")
        return {'error': f'ValueError: {e}'}

    except csv.Error as e:
        return {'error': f'CSV error: {e}'}

    return gids_activity_indexes

def get_activity_indexes(data_dict, Gids):

    """  Returns a dictionary mapping GIDs from spike activity to their index in the Gids list.  """
    # Create a lookup for Gids: {gid: index}
    gids_dict = {int(float(id_)): index for index, id_ in enumerate(Gids)}

    # Create the mapping for all GIDs found in activity data
    activity_index_map = {}

    for t, activity_ids in data_dict.items():
        for activity_id in activity_ids:
            try:
                gid = int(activity_id)
                if gid in gids_dict:
                    activity_index_map[gid] = gids_dict[gid]
            except ValueError as e:
                print(f"Skipping invalid activity_id '{activity_id}': {e}")

    return activity_index_map


@csrf_exempt
def LoadHumanHipForm(request):
    try:
        json_directory = os.path.join(settings.MEDIA_ROOT, "hip_form", "human")
        final_json_file_path = os.path.join(json_directory, 'network.json')

        with open(final_json_file_path, 'r') as f:
            networkdata = ujson.load(f)
            total_neurons = len(networkdata)
            total_size = os.path.getsize(final_json_file_path) / (1024 * 1024)  # in MB

            mode = request.GET.get("mode", "full")

            if mode == "half":
                networkdata = networkdata[:total_neurons // 2]

            return JsonResponse({
                'fileData': networkdata,
                'total_neurons': len(networkdata),
                'total_size': total_size
            })

    except ujson.JSONDecodeError as e:
        print(f"Error decoding JSON from file {final_json_file_path}: {e}")
    except Exception as e:
        print(f"Error reading file {final_json_file_path}: {e}")
        return JsonResponse({'error': str(e)}, status=500)

@csrf_exempt
def LoadHumanActivityData(request):
    try:
        if request.method == 'POST':

            gids_activity_indexes = []
            number_of_spikes = 0

            # Get the file ID from the request
            file_id = request.GET.get('dir')
            if not file_id:
                return JsonResponse({'error': 'Missing file ID'}, status=400)

            # Determine the file path based on the selected value
            json_directory = os.path.join(settings.MEDIA_ROOT, 'hip_form', "human")
            if file_id == '1':
                final_json_file_path = os.path.join(json_directory, 'activity.json')
                final_csv_file_path = os.path.join(json_directory, 'activity.csv')
                final_json_file_path_gids = os.path.join(json_directory, 'gids_activity_indexes.json')
            # elif file_id == '2':
            #     final_json_file_path = os.path.join(json_directory, 'Activity_MEC.json')
            #     final_csv_file_path = os.path.join(json_directory, 'Activity_MEC.csv')
            else:
                return JsonResponse({'error': 'Invalid file ID'}, status=400)


            # Read the JSON file and prepare the response data
            with open(final_json_file_path_gids, "r") as file:
                gids_activity_indexes = ujson.load(file)

            # gids_activity_indexes = get_activity_indexes_for_SimulationData(final_csv_file_path, Gids_array)
            number_of_spikes = count_csv_lines(final_csv_file_path)

            # Read the JSON file and prepare the response data
            with open(final_json_file_path, "r") as file:
                data = ujson.load(file)
                keys = sorted(data.keys(), key=float)  # Sort keys as floats

            # Return the data and keys in a JSON response
            response_data = {
                'data': data,
                'keys': keys,
                'gids_activity_indexes': gids_activity_indexes,
                'number_of_spikes': number_of_spikes,
            }
            return JsonResponse(response_data, safe=False)

        else:
            return JsonResponse({'error': 'Invalid HTTP method'}, status=405)

    except Exception as e:
        print("Error in LoadActivityData:", e)  # Debugging
        return JsonResponse({'error': str(e)}, status=500)
