from django.urls import path
from api import views


urlpatterns = [
    # Other URL patterns...

    path('upload_and_save_Network_file/', views.upload_and_save_Network_file, name='upload_and_save_Network_file'),
    path('fetch_user_network_data/', views.fetch_user_network_data, name='fetch_user_network_data'),
    path('LoadAllLayers/', views.LoadAllLayers, name='LoadAllLayers'),
    path('LoadActivityData/', views.LoadActivityData, name='LoadActivityData'),
    path('fetchConnections/', views.fetchConnections, name='fetchConnections'),
    path("get_chunk_data/", views.get_chunk_data, name="get_chunk_data"),
    path("LoadHumanHipForm/", views.LoadHumanHipForm, name="LoadHumanHipForm"),
    path("LoadHumanActivityData/", views.LoadHumanActivityData, name="LoadHumanActivityData"),

   ]
