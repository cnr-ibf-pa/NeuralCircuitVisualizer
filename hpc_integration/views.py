from http.client import BAD_REQUEST, OK
import shutil
import os

from django.http import FileResponse, HttpResponseForbidden, HttpResponseServerError
from django.http.response import JsonResponse, HttpResponseBadRequest, HttpResponse, HttpResponseNotAllowed

from hpc_integration import forms
from hpc_integration.forms import HPC_LIST
from hpc_integration.utils import messages, get_tmp_working_dir
from hpc_integration.utils.decorators import login_required
from hpc_integration.helper.job_helper import JobHelper
from hpc_integration.utils.errors import ForbiddenException, HPCException, UnicoreClientException, JobAlreadySubmittedException

from neural_circuit_visualizer.settings import MEDIA_ROOT


import logging
logger = logging.getLogger(__name__)


@login_required
def submit_job(request):
    if request.method != 'POST':
        return HttpResponseNotAllowed('POST')

    form = None
    circuit = request.POST.get('circuit')
    if circuit == 'human':
        form = forms.HumanSimulationForm(request.POST)
    elif circuit == 'mouse':
        form = forms.MouseSimulationForm(request.POST)
    else:
        return HttpResponse(status=400, content=messages.INVALID_CIRCUIT)

    if not form.is_valid():
        logging.error(f'Invalid form: {form.errors.get_json_data(escape_html=True)}')
        return JsonResponse(status=BAD_REQUEST, data=form.errors.get_json_data(escape_html=True), safe=False)

    data = form.cleaned_data
    logger.info(f'Form data: {data}')

    try:
        if request.session.get('job_already_submitted'):
            return HttpResponse(status=510, content=messages.JOB_ALREADY_SUBMITTED)
        JobHelper().submit_job(data.pop("hpc"), data, request.session['oidc_access_token'], job_name=request.session.get('workflow_id'))
        request.session['job_already_submitted'] = True
        return HttpResponse(status=OK, content=messages.JOB_SUBMITTED.format(data.get('hpc')))

    except UnicoreClientException as err:
        logger.error(f'AUTH Error while trying to submit job: {err}')
        return HttpResponse(status=401, content=str(err))
    except ForbiddenException as err:
        logger.error(f'AUTH Error while trying to submit job: {err}')
        return HttpResponseForbidden(content=str(err))
    except HPCException as err:
        logger.error(f'HPC Error while trying to submit job: {err}')
        return HttpResponse(status=509, content=str(err))
    except Exception as err:
        logger.error(f'GENERAL Error while trying to submit job: {err}')
        return HttpResponseServerError(content=str(err))


@login_required
def fetch_jobs(request):
    if request.method != 'GET':
        return HttpResponseNotAllowed('GET')

    hpc = request.GET.get('hpc')
    if not hpc:
        logger.error('No hpc provided')
        return HttpResponseBadRequest(content=messages.HPC_NOT_PROVIDED)

    if not hpc in [h[0] for h in HPC_LIST]:
        logger.error(f'Invalid hpc value provided: {hpc}')
        return HttpResponseBadRequest(content=messages.HPC_NOT_VALID)

    request.session['hpc'] = hpc

    try:
        jobs_list = JobHelper().fetch_jobs_list(hpc, request.session['oidc_access_token'])
        return JsonResponse(data=jobs_list)

    except UnicoreClientException as err:
        logger.error(f'AUTH Error while trying to fetch jobs: {err}')
        return HttpResponse(status=401, content=str(err))
    except ForbiddenException as err:
        logger.error(f'AUTH Error while trying to fetch jobs: {err}')
        return HttpResponseForbidden(content=str(err))
    except HPCException as err:
        logger.error(f'HPC Error while trying to fetch jobs: {err}')
        return HttpResponse(status=509, content=str(err))
    except Exception as err:
        logger.error(f'GENERAL Error while trying to fetch jobs: {err}')
        return HttpResponseServerError(content=str(err))


@login_required
def download_job_results(request):
    if request.method != 'GET':
        return HttpResponseNotAllowed('GET')

    job_id = request.GET.get('job_id')

    if not job_id:
        return HttpResponseBadRequest(content=messages.JOB_ID_NOT_PROVIDED)

    hpc = request.session.get('hpc')
    if not hpc:
        logger.error('HPC not found in session')
        return HttpResponseServerError()

    download_dir = request.session.get('download_dir')
    if not download_dir or not os.path.exists(download_dir):
        logger.info('Download directory not found, creating a new one')
        download_dir = get_tmp_working_dir()
        request.session['download_dir'] = download_dir

    try:
        output_file_path = JobHelper().download_output_job_files(hpc, job_id, request.session['oidc_access_token'], download_dir)
        response = None
        if output_file_path.endswith('.tar.gz'):
            response = HttpResponse(content_type='application/tar+gzip')
        elif output_file_path.endswith('.zip'):
            response = HttpResponse(content_type='application/zip')
        else:
            raise Exception('Invalid output file path: ' + output_file_path)
        response['Content-Disposition'] = f'attachment; filename={os.path.split(output_file_path)[1]}'
        with open(output_file_path, 'rb') as f:
            response.write(f.read())
        shutil.rmtree(download_dir)
        return response
    except KeyError:
                return HttpResponse(status=511, content=messages.JOB_OUTPUT_NOT_FOUND)
    except UnicoreClientException as err:
        logger.error(f'AUTH Error while downloading job results: {err}')
        return HttpResponse(status=401, content=str(err))
    except ForbiddenException as err:
        logger.error(f'AUTH Error while downloading job results: {err}')
        return HttpResponseForbidden(content=str(err))
    except HPCException as err:
        logger.error(f'HPC Error while downloading job results: {err}')
        return HttpResponse(status=509, content=str(err))
    except Exception as err:
        logger.error(f'GENERAL Error while downloading job results: {err}')
        return HttpResponseServerError(content=str(err))


@login_required
def download_activity_network(request):
    if request.method != 'GET':
        return HttpResponseNotAllowed('GET')

    job_id = request.GET.get('job_id')

    if not job_id:
        return HttpResponseBadRequest(content=messages.JOB_ID_NOT_PROVIDED)

    hpc = request.session.get('hpc')
    if not hpc:
        logger.error('HPC not found in session')
        return HttpResponseServerError()

    download_dir = os.path.join(str(MEDIA_ROOT), request.user.mitreid_sub, job_id)
    if not os.path.exists(download_dir):
        try:
            os.makedirs(download_dir)
        except Exception as err:
            logger.error(f'Error creating download directory: {err}')
            return HttpResponseServerError(content=str(err))

    activity_file_name = 'activity_network.hdf5'
    activity_file_path = os.path.join(download_dir, activity_file_name)
    if not os.path.exists(activity_file_path):
        try:
            activity_file_path = JobHelper().download_activity_network_file(hpc, job_id, request.session['oidc_access_token'], download_dir)
        except UnicoreClientException as err:
            logger.error(f'AUTH Error while trying to download activity network: {err}')
            return HttpResponse(status=401, content=str(err))
        except ForbiddenException as err:
            logger.error(f'AUTH Error while trying to download activity network: {err}')
            return HttpResponseForbidden(content=str(err))
        except HPCException as err:
            logger.error(f'HPC Error while trying to download activity network: {err}')
            return HttpResponse(status=509, content=str(err))
        except Exception as err:
            logger.error(f'GENERAL Error while trying to download activity network: {err}')
            return HttpResponseServerError(content=str(err))

    response = FileResponse(open(activity_file_path, 'rb'), content_type='application/octet-stream')
    response['Content-Disposition'] = f'attachment; filename="{activity_file_name}"'
    return response
