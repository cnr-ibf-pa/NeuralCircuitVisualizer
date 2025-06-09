from datetime import datetime
from django.http import HttpResponse
from django.shortcuts import render


def generate_workflow_id():
    return datetime.now().strftime("%Y%m%d%H%M%S%f")


def index(request):
    if request.GET.get('new_wf') or 'workflow_id' not in request.session:
        return HttpResponse(content=generate_workflow_id())
    if not request.session.get('workflow_id'):
        request.session['workflow_id'] = generate_workflow_id()
    workflow_id = request.session['workflow_id']
    return render(request, 'index.html', context={'workflow_id': workflow_id})


def docs(request):
    return render(request, 'docs.html')