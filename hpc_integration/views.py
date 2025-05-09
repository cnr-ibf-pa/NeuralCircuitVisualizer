from http.client import BAD_REQUEST, OK
import shutil
import os
from pyunicore.client import PathFile as UnicorePathFile

from django.http import HttpResponseForbidden, HttpResponseServerError
from django.http.response import JsonResponse, HttpResponseBadRequest, HttpResponse, HttpResponseNotAllowed

from hpc_integration import forms
from hpc_integration.forms import HPC_LIST
from hpc_integration.utils import messages, get_tmp_dir, get_tmp_working_dir
from hpc_integration.utils.decorators import login_required
from hpc_integration.helper.job_helper import JobHelper
from hpc_integration.utils.errors import ForbiddenException

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

    # prepare zip file
    working_dir = request.session.get('working_dir')
    if not working_dir:
        working_dir = get_tmp_working_dir()
        request.session['working_dir'] = working_dir

    zip_filename = os.path.join(get_tmp_dir(), f'{data["job_name"]}.zip')
    if os.path.exists(zip_filename):
        logging.error(f'Job name "{data["job_name"]}" already exists')
        return JsonResponse(status=BAD_REQUEST, data={'job_name': [{'message': messages.JOB_NAME_ALREADY_EXISTS}]})

    shutil.make_archive(base_name=zip_filename.replace('.zip', ''), format='zip', root_dir=working_dir)

    try:
        JobHelper().submit_job(data["hpc"], zip_filename, data, request.session['oidc_access_token'])
    except ForbiddenException as err:
        logger.error(f'Error while fetching jobs: {err}')
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
    if not download_dir:
        download_dir = get_tmp_working_dir()
        request.session['download_dir'] = download_dir

    try:
        file_list = JobHelper().fetch_job_files(hpc, job_id, request.session['oidc_access_token'])
        for f in file_list.keys():
            if type(file_list[f]) == UnicorePathFile:
                dst = os.path.join(download_dir, f)
                file_list[f].download(dst)
        zip_filename = os.path.join(get_tmp_dir(), f'{job_id}_results.zip')
        shutil.make_archive(base_name=zip_filename.replace('.zip', ''), format='zip', root_dir=download_dir)
        return HttpResponse(content=messages)
    except Exception as err:
        logger.error(f'Error while downloading results: {err}')
        return HttpResponseServerError(content=str(err))