from django.urls import path
from hpc_integration import views


urlpatterns = [
    path('submit-job', views.submit_job, name='submit-job'),

]