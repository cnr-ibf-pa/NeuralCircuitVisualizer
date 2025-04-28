from django.shortcuts import render
from django.http.response import JsonResponse, HttpResponseBadRequest, HttpResponse, HttpResponseNotAllowed
from django.contrib.auth.decorators import login_required
from hpc_integration import forms
from hpc_integration.utils import messages


# @login_required
def submit_job(request):
    if request.method != 'POST':
        return HttpResponseNotAllowed('POST')

    form = forms.OptimizationSettingsForm(request.POST)

    if not form.is_valid():
        return HttpResponseBadRequest(form.errors)

    return HttpResponse(content=messages.OK)


@login_required
def fetch_jobs(request):

    return HttpResponse(content=messages.OK)


@login_required
def download_job_results(request):

    return HttpResponse(content=messages.OK)



