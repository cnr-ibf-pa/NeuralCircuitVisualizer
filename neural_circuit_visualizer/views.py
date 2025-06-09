from datetime import datetime
from django.http import HttpResponse
from django.shortcuts import render


def generate_workflow_id():
    return datetime.now().strftime("%Y%m%d_%H%M%S%f")


def index(request):
    if not request.session.get('workflow_id'):
        workflow_id = generate_workflow_id()
        request.session['workflow_id'] = workflow_id
    return render(request, 'index.html', context={'workflow_id': request.session.get('workflow_id')})


def reset(request):
    request.session.pop('workflow_id', None)
    request.session.pop('job_already_submitted', None)
    return HttpResponse()


def docs(request):
    return render(request, 'docs.html')