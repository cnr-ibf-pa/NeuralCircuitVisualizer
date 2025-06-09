from django.urls import path, include

from neural_circuit_visualizer import views

urlpatterns = [
    path('oidc/', include('mozilla_django_oidc.urls')),
    path('api/', include('api.urls')),
    path('hpc-integration/', include('hpc_integration.urls')),

    path('', views.index),
    path('reset', views.reset),
    path('docs', views.docs),
]
