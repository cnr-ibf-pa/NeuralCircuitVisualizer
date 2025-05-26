from http.client import BAD_REQUEST, OK
import shutil
import os
from pyunicore.client import PathFile as UnicorePathFile

from django.http import FileResponse, HttpResponseForbidden, HttpResponseServerError
from django.http.response import JsonResponse, HttpResponseBadRequest, HttpResponse, HttpResponseNotAllowed

from hpc_integration import forms
from hpc_integration.forms import HPC_LIST
from hpc_integration.utils import messages, get_tmp_dir, get_tmp_working_dir
from hpc_integration.utils.decorators import login_required
from hpc_integration.helper.job_helper import JobHelper
from hpc_integration.utils.errors import ForbiddenException

from neural_circuit_visualizer.settings import MEDIA_ROOT


import logging
logger = logging.getLogger(__name__)


@login_required
def submit_job(request):
    if request.method != 'POST':
        return HttpResponseNotAllowed('POST')

    form = forms.OptimizationSettingsForm(request.POST)

    if not form.is_valid():
        logging.error(f'Invalid form: {form.errors.get_json_data(escape_html=True)}')
        return JsonResponse(status=BAD_REQUEST, data=form.errors.get_json_data(escape_html=True), safe=False)

    data = form.cleaned_data

    try:
        JobHelper().submit_job(data.pop("hpc"), data, request.session['oidc_access_token'])
    except ForbiddenException as err:
        logger.error(f'Error while submitting job: {err}')
        return HttpResponseForbidden(content=str(err))
    except Exception as err:
        logger.error(f'Error while submitting job: {err}')
        return HttpResponseServerError(content=str(err))

    return HttpResponse(content=messages.OK)


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
    except ForbiddenException as err:
        logger.error(f'Error while fetching jobs: {err}')
        return HttpResponseForbidden(content=str(err))
    except Exception as err:
        logger.error(f'Error while fetching jobs: {err}')
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
        file_list = JobHelper().fetch_job_files(hpc, job_id, request.session['oidc_access_token'])
        for f in file_list.keys():
            if type(file_list[f]) == UnicorePathFile:
                file_list[f].download(os.path.join(download_dir, f))
        zip_filename = os.path.join(get_tmp_dir(), f'{job_id}_results.zip')
        shutil.make_archive(base_name=zip_filename.replace('.zip', ''), format='zip', root_dir=download_dir)
        response = HttpResponse(content_type='application/zip')
        response['Content-Disposition'] = f'attachment; filename={os.path.split(zip_filename)[1]}'
        with open(zip_filename, 'rb') as f:
            response.write(f.read())
        os.remove(zip_filename)
        shutil.rmtree(download_dir)
        return response
    except Exception as err:
        logger.error(f'Error while downloading results: {err}')
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

    activity_file = os.path.join(download_dir, 'activity_network.hdf5')
    if not os.path.exists(activity_file):
        try:
            file_list = JobHelper().fetch_job_files(hpc, job_id, request.session['oidc_access_token'])
            for f in file_list:
                if isinstance(f, UnicorePathFile):
                    if f.name == 'activity_network.hdf5':
                        f.download(activity_file)
        except Exception as err:
            logger.error(f'Error while downloading results: {err}')
            return HttpResponseServerError(content=str(err))

    response = FileResponse(open(activity_file, 'rb'), content_type='application/octet-stream')
    response['Content-Disposition'] = 'attachment; filename="activity_network.hdf5"'
    return response
