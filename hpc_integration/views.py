from django.shortcuts import render
from django.http.response import JsonResponse, HttpResponseBadRequest, HttpResponse
from django.contrib.auth.decorators import login_required
from hpc_integration.messages import *


@login_required
def submit_job(request):

    return HttpResponse(content=OK)


@login_required
def fetch_jobs(request):

    return HttpResponse(content=OK)


@login_required
def download_job_results(request):

    return HttpResponse(content=OK)



