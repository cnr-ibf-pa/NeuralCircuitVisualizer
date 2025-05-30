from django.urls import path
from hpc_integration import views


urlpatterns = [
    path('submit-job', views.submit_job, name='submit-job'),
    path('fetch-jobs', views.fetch_jobs, name='fetch-results'),
    path('download-job-results', views.download_job_results, name='download-job-results'),
    path('download-activity-network', views.download_activity_network, name='download-activity-network'),
]