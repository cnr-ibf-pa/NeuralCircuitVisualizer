# Neural Circuit Visualizer

## Overview

 The Neural Circuit Visualizer (NCV) is a web-based application that enables users to interactively upload, visualize, and analyze large-scale hippocampal neuron circuits. The platform supports a streamlined workflow from network and activity file upload to dynamic 3D circuit visualization and spike playback.

- Data Upload : Upload neural network and spike activity data in supported formats (CSV or HDF5).
- 3D Visualization : Explore neuron distributions and network structure with anatomical orientation.
- Playback and Analysis : Animate spike activity over time and examine firing statistics across simulation chunks.


## Setup

### Create virtual environment

```
python -m venv venv
```

### Activate the environment

- For Windows:
    ```
    venv\Scripts\activate
    ```
- For macOS and Linux:
    ```
    source venv/bin/activate
    ```

### Install requirements

- Install python libraries
    ```
    pip install -r requirements.txt
    ```
- Install [three.js](https://threejs.org/)

    To install the library you can run the automatic script `threejs_setup.sh` (for macOS and Linux) or download the zip from github or from the official page and extract the contents under the folder `static/js/threejs`

### Migrate the database

````
python manage.py makemigrations api hpc_integration
python manage.py migrate
````


### Configuration

The application requires a `.env` file with some environment variables defined.

An example file `.env.example` is provided.

The application also uses `gunicorn` as WSGI server. The configuration file `gunicorn.conf.py.example` is an example of how to configure it.

Please, copy the example file and update it according to your needs renaming the `.env.example` and `gunicorn.conf.py.example` files to `.env` and `gunicorn.conf.py` respectively.


## Run application

There are multiple methods to launch the application:

- Using the Django development server:
  ```
  python manage.py runserver
  ```

- Using `runsslserver` for SSL support:
  ```
  python manage.py runsslserver
  ```

- Using `gunicorn` for a production-like environment:
  First, ensure `gunicorn` is installed with `pip install gunicorn`.

  To launch in a test environment with `gunicorn`, run:
  ```
  gunicorn -c gunicorn.conf.py
  ```